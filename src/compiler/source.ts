import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import type {
  SystemSourceContext,
  FeatureSourceContext,
  ProgramSourceContext,
  SourceCompilerAPI,
  SourceCompilerExtension,
} from "@/compiler/extension";
import {
  SYSTEM_IR_VERSION,
  type DependencyIR,
  type ComponentIR,
  type CompilerExtensionsIR,
  type ExtensionIR,
  type ExpressionIR,
  type ExpressionValueIR,
  type FeatureIR,
  type FieldIR,
  type FunctionIR,
  type InterfacePresentationIR,
  type PlatformInterfaceIR,
  type SystemIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SourceSpan,
  type StatementIR,
  type TypeIR,
} from "@/compiler/ir";
import { compilePresentationSource } from "@/compiler/presentation";

export class SystemDiagnostic extends Error {
  readonly span: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "SystemDiagnostic";
    this.span = span;
  }
}

export type SystemPaths = Readonly<{
  directory: string;
  source: string;
  system: string;
}>;

export type SystemOutputSources = Readonly<Record<string, readonly string[]>>;

export type SystemCompilation = Readonly<{
  ir: SystemIR;
  presentationSources: ReadonlySet<string>;
  outputSources: SystemOutputSources;
}>;

export type SystemCompiler = Readonly<{
  compile(changedFile?: string): SystemCompilation;
}>;

/** Resolves the one conventional System entry without executing it. */
export function resolveSystem(directory: string): SystemPaths {
  const root = resolve(directory);
  const source = resolve(root, "src");
  const system = resolve(source, "system.ts");
  try {
    if (statSync(system).size > 0) return { directory: root, source, system };
  } catch {
    // Report the one source convention below.
  }
  throw new Error(`${source} must contain system.ts.`);
}

export function compileSystem(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = [],
): SystemIR {
  return compileSystemProgram(entry, undefined, undefined, extensions).compilation.ir;
}

/** Retains TypeScript's semantic graph across development compilations. */
export function createSystemCompiler(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = [],
): SystemCompiler {
  let previous: ts.Program | undefined;
  return {
    compile(changedFile) {
      const result = compileSystemProgram(entry, previous, changedFile, extensions);
      previous = result.program;
      return result.compilation;
    },
  };
}

function validateCompilerExtensions(extensions: readonly SourceCompilerExtension[]): void {
  const names = new Set<string>();
  for (const extension of extensions) {
    if (!extension.name || !/^[a-z][a-z0-9-]*$/.test(extension.name)) {
      throw new TypeError(`Invalid compiler extension name ${JSON.stringify(extension.name)}.`);
    }
    if (names.has(extension.name)) {
      throw new TypeError(`Duplicate compiler extension ${JSON.stringify(extension.name)}.`);
    }
    names.add(extension.name);
  }
}

function sourceCompilerAPI(checker: ts.TypeChecker, scope?: StaticValue): SourceCompilerAPI {
  return Object.freeze({
    properties: (type) => sortedSymbols(type?.getProperties() ?? []),
    property: (type, name, at) => propertyType(checker, type, name, at),
    object: (value) => objectExpression(checker, value),
    member: (object, name) => objectMember(checker, object, name),
    resolveMember: (object, name) => resolveObjectMember(checker, object, name),
    memberDeclaration: objectMemberDeclaration,
    constant: (value) =>
      staticConstant(
        checker,
        {
          node: value,
          bindings: scope?.bindings ?? new Map(),
          types: scope?.types ?? new Map(),
        },
        new Set(),
      ),
    literal: (type, name, at) => literalProperty(checker, type, name, at),
    optionalLiteral: (type, name, at) => literalPropertyOptional(checker, type, name, at),
    lower: (type, at) => lowerType(checker, type, at),
    portable(declaration, options) {
      const functionLike = isFunctionImplementation(declaration)
        ? declaration
        : functionFromMember(declaration);
      if (!functionLike?.body) {
        throw diagnostic(declaration, "Portable functions require a statically known body.");
      }
      const lowering = createPortableLowering(checker);
      const entry = lowerFunction(lowering, functionLike, {
        ...options,
        dependenciesName: dependencyBinding(functionLike.parameters[0]) ?? "@dependencies",
      });
      return {
        entry,
        functions: [...lowering.functions.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      };
    },
    emptyRecord,
    span: spanOf,
    fail(node, message) {
      throw diagnostic(node, message);
    },
  });
}

function extensionField(
  extensions: readonly SourceCompilerExtension[],
  kind: "system",
  context: SystemSourceContext,
): Readonly<{ extensions?: CompilerExtensionsIR }>;
function extensionField(
  extensions: readonly SourceCompilerExtension[],
  kind: "feature",
  context: FeatureSourceContext,
): Readonly<{ extensions?: CompilerExtensionsIR }>;
function extensionField(
  extensions: readonly SourceCompilerExtension[],
  kind: "program",
  context: ProgramSourceContext,
): Readonly<{ extensions?: CompilerExtensionsIR }>;
function extensionField(
  extensions: readonly SourceCompilerExtension[],
  kind: "system" | "feature" | "program",
  context: SystemSourceContext | FeatureSourceContext | ProgramSourceContext,
): Readonly<{ extensions?: CompilerExtensionsIR }> {
  const values: Record<string, ExtensionIR> = Object.create(null);
  for (const extension of extensions) {
    const value =
      kind === "system"
        ? extension.system?.(context as SystemSourceContext)
        : kind === "feature"
          ? extension.feature?.(context as FeatureSourceContext)
          : extension.program?.(context as ProgramSourceContext);
    if (value === undefined) continue;
    assertExtensionIR(value, extension.name, new Set());
    values[extension.name] = value;
  }
  return Object.keys(values).length ? { extensions: Object.freeze(values) } : {};
}

function assertExtensionIR(
  value: unknown,
  name: string,
  active: Set<object>,
): asserts value is ExtensionIR {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Compiler extension ${JSON.stringify(name)} returned non-JSON meaning.`);
  }
  if (active.has(value)) {
    throw new TypeError(`Compiler extension ${JSON.stringify(name)} returned cyclic meaning.`);
  }
  active.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertExtensionIR(child, name, active);
  }
  active.delete(value);
}

function compileSystemProgram(
  entry: string,
  previous?: ts.Program,
  changedFile?: string,
  extensions: readonly SourceCompilerExtension[] = [],
): Readonly<{ compilation: SystemCompilation; program: ts.Program }> {
  validateCompilerExtensions(extensions);
  const file = resolve(entry);
  const configuration = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  const configured = configuration ? readCompilerOptions(configuration) : undefined;
  const program = ts.createProgram({
    rootNames: [file],
    options: {
      ...configured,
      allowImportingTsExtensions: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
    oldProgram: previous,
  });
  const changedSource = changedFile ? program.getSourceFile(resolve(changedFile)) : undefined;
  const diagnostics = changedSource
    ? [
        ...program.getSyntacticDiagnostics(changedSource),
        ...program.getSemanticDiagnostics(changedSource),
      ]
    : ts.getPreEmitDiagnostics(program);
  const first = diagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (first) throw new Error(formatTypeScriptDiagnostic(first));

  const source = program.getSourceFile(file);
  if (!source) throw new Error(`Cannot read ${file}.`);
  const checker = program.getTypeChecker();
  const assignment = source.statements.find(ts.isExportAssignment);
  if (!assignment) throw diagnostic(source, "The System must have one default export.");
  const exported = unwrapExpression(assignment.expression);
  const systemObject = objectExpression(checker, exported);
  if (!systemObject) throw diagnostic(exported, "The default export must be a System object.");
  const contract = checker.getTypeAtLocation(exported);
  const featuresValue = objectMember(checker, systemObject, "features");
  if (!featuresValue) {
    throw diagnostic(systemObject, "The System must compose Features.");
  }
  const featureValues = requireObject(checker, featuresValue, "System features must be an object.");
  const featuresContract = checker.getTypeAtLocation(featureValues);

  const metadata = objectExpression(checker, objectMember(checker, systemObject, "metadata"));
  const systemName =
    stringMember(checker, metadata, "name") ?? source.fileName.split("/").at(-2) ?? "system";
  const root = dirname(file);
  const systemExtensions = extensionField(extensions, "system", {
    checker,
    source: sourceCompilerAPI(checker),
    contract,
    implementation: systemObject,
    location: exported,
    root,
  });
  const features: FeatureIR[] = [];
  const featureSourceFiles = new Map<string, ReadonlySet<string>>();
  const contributions: UnassembledProgramIR[] = [];
  const interfaceSources: InterfaceSource[] = [];
  extractFeatures(
    checker,
    featuresContract,
    featureValues,
    "",
    features,
    featureSourceFiles,
    contributions,
    interfaceSources,
    extensions,
    root,
    new Set([file]),
    featureValues,
    undefined,
    undefined,
    undefined,
    true,
  );
  validateProgramEnvironments(contributions);
  const programs = assemblePrograms(contributions);

  const platforms = [...new Set(programs.map(({ environment }) => environment.platform))].sort();
  const presentationSources = new Set<string>();
  const interfaceSourceFiles = new Map<string, ReadonlySet<string>>();
  const presentationIR: InterfacePresentationIR[] = [];
  const interfaces: PlatformInterfaceIR[] = [];
  for (const item of interfaceSources.sort((left, right) => left.path.localeCompare(right.path))) {
    const sources = presentationImplementationSources(program, checker, item.implementation, root);
    sources.forEach((path) => presentationSources.add(path));
    interfaceSourceFiles.set(item.path, sources);
    for (const path of sources) {
      const implementation = program.getSourceFile(path);
      if (!implementation) throw new Error(`Cannot read Presentation source ${path}.`);
      const compiled = compilePresentationSource(implementation.text, relative(root, path)).ir;
      if (compiled.animations.length || compiled.declarations.length) {
        presentationIR.push({ interface: item.path, ...compiled });
      }
    }
    interfaces.push({
      id: `interface/${item.path}`,
      feature: item.path,
      app: item.app,
      platform: item.platform,
      programs: programs
        .filter((candidate) => candidate.interface === item.path)
        .map(({ id }) => id)
        .sort(),
      presentationSources: [...sources].map((path) => relative(root, path)).sort(),
    });
  }
  const apps = features
    .filter(({ kind }) => kind === "app")
    .map(({ path }) => ({
      id: `app/${path}`,
      feature: path,
      interfaces: interfaces
        .filter(({ app }) => app === path)
        .map(({ id }) => id)
        .sort(),
    }))
    .sort(byId);
  const ir = normalizeSourceFiles(
    {
      version: SYSTEM_IR_VERSION,
      system: {
        id: "system",
        name: systemName,
        ...systemExtensions,
      },
      platforms,
      apps,
      interfaces: interfaces.sort(byId),
      features: features.sort(byId),
      programs: programs.sort(byId),
      presentations: presentationIR.sort((left, right) =>
        `${left.interface}/${left.file}`.localeCompare(`${right.interface}/${right.file}`),
      ),
    },
    configuration ? dirname(configuration) : root,
  );
  for (const extension of extensions) extension.validate?.(ir);
  return {
    compilation: {
      ir,
      presentationSources,
      outputSources: collectSystemOutputSources({
        checker,
        entry: file,
        featureSourceFiles,
        interfaceSourceFiles,
        interfaces,
        program,
        programs,
        root,
      }),
    },
    program,
  };
}

type UnassembledProgramIR = ProgramContributionIR &
  Readonly<{
    name: string;
    logicalName: string;
    environment: ProgramIR["environment"];
    interface?: string;
  }>;

type InterfaceSource = Readonly<{
  path: string;
  app: string;
  platform: string;
  implementation: ts.ObjectLiteralExpression;
}>;

type InterfaceOwner = Readonly<{ path: string; platform: string }>;

function validateProgramEnvironments(programs: readonly UnassembledProgramIR[]): void {
  const environments = new Map<string, ProgramIR["environment"]>();
  for (const program of programs) {
    const previous = environments.get(program.name);
    if (!previous) {
      environments.set(program.name, program.environment);
      continue;
    }
    if (JSON.stringify(previous) === JSON.stringify(program.environment)) continue;
    throw new SystemDiagnostic(
      `Program ${JSON.stringify(program.name)} has incompatible execution contexts ` +
        `${JSON.stringify(previous.name)} and ${JSON.stringify(program.environment.name)}.`,
      program.span,
    );
  }
}

function assemblePrograms(contributions: readonly UnassembledProgramIR[]): ProgramIR[] {
  const names = [...new Set(contributions.map(({ name }) => name))].sort();
  return names.map((name) => {
    const members = contributions
      .filter((contribution) => contribution.name === name)
      .sort((left, right) => left.feature.localeCompare(right.feature));
    const environment = members[0]!.environment;
    const roots = members.flatMap(({ feature, ui }) =>
      ui?.root ? [{ feature, component: ui.root }] : [],
    );
    if (roots.length > 1) {
      throw new SystemDiagnostic(
        `Program ${JSON.stringify(name)} declares multiple UI roots: ${roots
          .map(({ feature, component }) => `${feature}.${component}`)
          .join(", ")}.`,
        members[1]!.span,
      );
    }
    return {
      id: `program/${name}`,
      name,
      logicalName: members[0]!.logicalName,
      environment,
      ...(members[0]!.interface ? { interface: members[0]!.interface } : {}),
      contributions: members.map(
        ({
          name: _name,
          logicalName: _logicalName,
          environment: _environment,
          interface: _interface,
          ...member
        }) => member,
      ),
      ...(roots[0] ? { ui: { root: roots[0] } } : {}),
    };
  });
}

function presentationImplementationSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  interfaceImplementation: ts.ObjectLiteralExpression,
  root: string,
): ReadonlySet<string> {
  const presentation = objectMember(checker, interfaceImplementation, "presentation");
  if (!presentation) return new Set();
  return transitiveLocalSources(
    program,
    checker,
    root,
    expressionDeclarations(checker, presentation).map((declaration) => declaration.getSourceFile()),
  );
}

function transitiveLocalSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  initial: Iterable<ts.SourceFile | string>,
): ReadonlySet<string> {
  const sources = new Set<string>();
  const pending = [...initial].flatMap((value): ts.SourceFile[] => {
    const source = typeof value === "string" ? program.getSourceFile(resolve(value)) : value;
    return source && !source.isDeclarationFile && inside(root, source.fileName) ? [source] : [];
  });
  while (pending.length) {
    const source = pending.pop()!;
    const file = resolve(source.fileName);
    if (sources.has(file)) continue;
    sources.add(file);
    for (const statement of source.statements) {
      const specifier = runtimeModuleSpecifier(statement);
      if (!specifier) continue;
      const symbol = checker.getSymbolAtLocation(specifier);
      for (const declaration of symbol?.declarations ?? []) {
        const imported = declaration.getSourceFile();
        if (!imported.isDeclarationFile && inside(root, imported.fileName)) pending.push(imported);
      }
    }
  }

  // Keep only files TypeScript actually included in this Program.
  const included = new Set(program.getSourceFiles().map((source) => resolve(source.fileName)));
  return new Set([...sources].filter((source) => included.has(source)));
}

function runtimeModuleSpecifier(statement: ts.Statement): ts.Expression | undefined {
  if (ts.isImportDeclaration(statement)) {
    if (statement.importClause?.isTypeOnly) return undefined;
    if (
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
    ) {
      return undefined;
    }
    return statement.moduleSpecifier;
  }
  return ts.isExportDeclaration(statement) && !statement.isTypeOnly
    ? statement.moduleSpecifier
    : undefined;
}

function collectSystemOutputSources(input: {
  checker: ts.TypeChecker;
  entry: string;
  featureSourceFiles: ReadonlyMap<string, ReadonlySet<string>>;
  interfaceSourceFiles: ReadonlyMap<string, ReadonlySet<string>>;
  interfaces: readonly PlatformInterfaceIR[];
  program: ts.Program;
  programs: readonly ProgramIR[];
  root: string;
}): SystemOutputSources {
  const output = new Map<string, ReadonlySet<string>>();
  for (const program of input.programs) {
    output.set(
      program.id,
      new Set([
        canonicalSourceFile(input.entry),
        ...program.contributions.flatMap(({ feature }) => [
          ...(input.featureSourceFiles.get(feature) ?? []),
        ]),
        ...transitiveLocalSources(
          input.program,
          input.checker,
          input.root,
          program.contributions.flatMap(({ implementation }) =>
            programImplementationSourceFiles(implementation),
          ),
        ),
      ]),
    );
  }
  for (const interface_ of input.interfaces) {
    output.set(
      interface_.id,
      new Set([
        canonicalSourceFile(input.entry),
        ...(input.featureSourceFiles.get(interface_.feature) ?? []),
        ...(input.interfaceSourceFiles.get(interface_.feature) ?? []),
        ...input.programs
          .filter(({ interface: owner }) => owner === interface_.feature)
          .flatMap(({ id }) => [...(output.get(id) ?? [])]),
      ]),
    );
  }
  return Object.freeze(
    Object.fromEntries(
      [...output]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, sources]) => [
          id,
          Object.freeze([...new Set([...sources].map(canonicalSourceFile))].sort()),
        ]),
    ),
  );
}

function programImplementationSourceFiles(
  implementation: ProgramContributionIR["implementation"],
): readonly string[] {
  if (implementation.kind === "none") return [];
  if (implementation.kind === "source") return [implementation.span.file];
  return [implementation.start.span.file, ...implementation.functions.map(({ span }) => span.file)];
}

function canonicalSourceFile(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function expressionDeclarations(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): readonly ts.Node[] {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped) && !ts.isPropertyAccessExpression(unwrapped)) {
    return [unwrapped];
  }
  let symbol =
    ts.isIdentifier(unwrapped) && ts.isShorthandPropertyAssignment(unwrapped.parent)
      ? checker.getShorthandAssignmentValueSymbol(unwrapped.parent)
      : checker.getSymbolAtLocation(
          ts.isPropertyAccessExpression(unwrapped) ? unwrapped.name : unwrapped,
        );
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol?.declarations ?? [unwrapped];
}

function inside(root: string, file: string): boolean {
  const path = relative(root, resolve(file));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function extractFeatures(
  checker: ts.TypeChecker,
  contracts: ts.Type,
  values: ts.ObjectLiteralExpression | undefined,
  parent: string,
  features: FeatureIR[],
  featureSourceFiles: Map<string, ReadonlySet<string>>,
  programs: UnassembledProgramIR[],
  interfaces: InterfaceSource[],
  extensions: readonly SourceCompilerExtension[],
  root: string,
  parentSourceFiles: ReadonlySet<string>,
  at: ts.Node = values!,
  owner?: ts.Expression,
  app?: string,
  interfaceOwner?: InterfaceOwner,
  contractsAreFeatureValues = false,
): void {
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const path = parent ? `${parent}.${name}` : name;
    const location = symbol.valueDeclaration ?? at;
    const symbolType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const contract = contractsAreFeatureValues
      ? retainedFeatureContract(checker, symbolType, location)
      : symbolType;
    const inherited = owner ? resolveFeatureChild(checker, owner, name) : undefined;
    const value = values
      ? resolveObjectMember(checker, values, name)
      : inherited && ts.isExpression(inherited.node)
        ? inherited.node
        : undefined;
    if ((values || owner) && !value)
      throw diagnostic(
        values ?? owner ?? at,
        `Feature ${JSON.stringify(path)} has no implementation.`,
      );
    const staticFeature = value
      ? resolveStaticValue(
          checker,
          {
            node: value,
            bindings: inherited?.bindings ?? new Map(),
            types: inherited?.types ?? new Map(),
          },
          new Set(),
        )
      : inherited;
    const featureValue =
      staticFeature?.node && ts.isObjectLiteralExpression(staticFeature.node)
        ? staticFeature.node
        : value
          ? objectExpression(checker, value)
          : undefined;
    const sourceFiles = new Set(parentSourceFiles);
    for (const node of [value, staticFeature?.node, featureValue]) {
      const source = node?.getSourceFile();
      if (source && !source.isDeclarationFile && inside(root, source.fileName)) {
        sourceFiles.add(canonicalSourceFile(source.fileName));
      }
    }
    featureSourceFiles.set(path, sourceFiles);
    const featureLocation = value ?? location;
    const isApp = booleanLiteralProperty(checker, contract, "App", location) === true;
    const interfaceMarker = propertyType(checker, contract, "Interface", location);
    if (isApp && interfaceMarker) {
      throw diagnostic(
        featureLocation,
        `Feature ${JSON.stringify(path)} cannot be an App and an interface.`,
      );
    }
    if (isApp && app) {
      throw diagnostic(
        featureLocation,
        `App ${JSON.stringify(path)} cannot be nested in another App.`,
      );
    }
    const ownedApp = isApp ? path : app;
    let ownedInterface = interfaceOwner;
    let interfacePlatform: string | undefined;
    if (interfaceMarker) {
      if (!ownedApp) {
        throw diagnostic(
          featureLocation,
          `Interface ${JSON.stringify(path)} must belong to an App.`,
        );
      }
      if (interfaceOwner) {
        throw diagnostic(
          featureLocation,
          `Interface ${JSON.stringify(path)} cannot be nested in another interface.`,
        );
      }
      const platform = propertyType(checker, interfaceMarker, "Platform", location);
      if (!platform) {
        throw diagnostic(featureLocation, `Interface ${JSON.stringify(path)} has no Platform.`);
      }
      interfacePlatform = literalProperty(checker, platform, "Name", location);
      ownedInterface = { path, platform: interfacePlatform };
      if (!featureValue) {
        throw diagnostic(
          featureLocation,
          `Interface ${JSON.stringify(path)} must expose compiler-readable metadata.`,
        );
      }
      interfaces.push({
        path,
        app: ownedApp,
        platform: interfacePlatform,
        implementation: featureValue,
      });
    }
    const programContracts = propertyType(checker, contract, "Programs", location);
    const programValues = objectExpression(
      checker,
      objectMember(checker, featureValue, "programs"),
    );
    const childContracts = propertyType(checker, contract, "Features", location);
    const childValues = objectExpression(checker, objectMember(checker, featureValue, "features"));
    const programIds: string[] = [];
    const childIds: string[] = [];

    if (programContracts) {
      if (featureValue && !programValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs programs.`);
      for (const programSymbol of sortedSymbols(programContracts.getProperties())) {
        const programName = programSymbol.getName();
        const id = `feature/${path}/program/${programName}`;
        const programContract = checker.getTypeOfSymbolAtLocation(
          programSymbol,
          programSymbol.valueDeclaration ?? featureLocation,
        );
        const implementation = programValues
          ? resolveObjectMember(checker, programValues, programName)
          : undefined;
        if (programValues && !implementation) {
          throw diagnostic(programValues, `Program ${JSON.stringify(id)} has no implementation.`);
        }
        const programValue = implementation ? objectExpression(checker, implementation) : undefined;
        const expandedProgram = value
          ? resolveFeatureProgram(checker, value, programName)
          : undefined;
        const expandedStart = expandedProgram
          ? resolveStaticMember(checker, expandedProgram, "start")
          : undefined;
        const extracted = extractProgram(
          checker,
          programContract,
          programValue,
          path,
          programName,
          featureLocation,
          Boolean((value && !featureValue) || (implementation && !programValue)),
          expandedProgram,
          expandedStart,
          extensions,
          root,
          ownedInterface,
        );
        programs.push(extracted);
        programIds.push(`program/${extracted.name}`);
      }
    }

    if (childContracts) {
      if (featureValue && !childValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs features.`);
      for (const child of sortedSymbols(childContracts.getProperties())) {
        childIds.push(`feature/${path}.${child.getName()}`);
      }
      extractFeatures(
        checker,
        childContracts,
        childValues,
        path,
        features,
        featureSourceFiles,
        programs,
        interfaces,
        extensions,
        root,
        sourceFiles,
        featureLocation,
        value,
        ownedApp,
        ownedInterface,
      );
    }

    features.push({
      id: `feature/${path}`,
      path,
      kind: isApp ? "app" : interfaceMarker ? "interface" : "feature",
      ...(ownedApp ? { app: ownedApp } : {}),
      ...(ownedInterface ? { interface: ownedInterface.path } : {}),
      ...(interfacePlatform ? { platform: interfacePlatform } : {}),
      children: childIds.sort(),
      programs: [...new Set(programIds)].sort(),
      ...extensionField(extensions, "feature", {
        checker,
        source: sourceCompilerAPI(checker, staticFeature),
        contract,
        implementation: featureValue,
        location: featureLocation,
        path,
        root,
      }),
    });
  }
}

function extractProgram(
  checker: ts.TypeChecker,
  contract: ts.Type,
  value: ts.ObjectLiteralExpression | undefined,
  feature: string,
  name: string,
  at: ts.Node = value!,
  factory = false,
  expandedProgram?: StaticValue,
  expandedStart?: StaticValue,
  extensions: readonly SourceCompilerExtension[] = [],
  sourceRoot = dirname(at.getSourceFile().fileName),
  interfaceOwner?: InterfaceOwner,
): UnassembledProgramIR {
  const location = value ?? at;
  const environment = propertyType(checker, contract, "Environment", location);
  if (!environment)
    throw diagnostic(location, `Program ${JSON.stringify(name)} has no Environment.`);
  const environmentName = literalProperty(checker, environment, "Name", location);
  const platformContract = propertyType(checker, environment, "Platform", location);
  if (!platformContract) {
    throw diagnostic(location, `Environment ${JSON.stringify(environmentName)} has no Platform.`);
  }
  const platform = literalProperty(checker, platformContract, "Name", location);
  const concreteName =
    interfaceOwner && interfaceOwner.platform === platform
      ? `${interfaceOwner.path}.${name}`
      : name;
  const uiContract = propertyType(checker, environment, "UI", location);
  const ui = uiContract ? literalProperty(checker, uiContract, "Name", location) : undefined;
  const state = propertyType(checker, contract, "State", location);
  const actions = propertyType(checker, contract, "Actions", location);
  const components = propertyType(checker, contract, "Components", location);
  const expandedValue =
    expandedProgram && ts.isExpression(expandedProgram.node)
      ? objectExpression(checker, expandedProgram.node)
      : undefined;
  if (!value && !expandedValue && components?.getProperties().length) {
    throw diagnostic(
      location,
      `UI Program ${JSON.stringify(name)} with Components must expose compiler-readable Feature metadata.`,
    );
  }
  const readableValue = value ?? expandedValue;
  const componentValues = objectExpression(
    checker,
    objectMember(checker, readableValue, "components"),
  );
  const directStart = value ? objectMemberDeclaration(value, "start") : undefined;
  const start =
    directStart && (isFunctionImplementation(directStart) || functionFromMember(directStart))
      ? directStart
      : functionNode(expandedStart?.node);
  const root = stringMember(checker, readableValue, "root");
  const implementation = programImplementation(
    checker,
    start,
    Boolean(state || actions || components),
    factory && !expandedProgram,
    readableValue ?? location,
    expandedStart?.bindings,
    expandedStart?.types,
  );
  return {
    id: `feature/${feature}/program/${name}`,
    feature,
    name: concreteName,
    logicalName: name,
    environment: { name: environmentName, platform, ...(ui ? { ui } : {}) },
    ...(interfaceOwner?.platform === platform ? { interface: interfaceOwner.path } : {}),
    requires: dependencyList(
      checker,
      propertyType(checker, contract, "Requires", location),
      location,
    ),
    provides: dependencyList(
      checker,
      propertyType(checker, contract, "Provides", location),
      location,
    ),
    ...(state || actions || components
      ? {
          ui: {
            state: state ? lowerType(checker, state, location) : emptyRecord(),
            actions: sortedSymbols(actions?.getProperties() ?? []).map((item) => item.getName()),
            components: componentList(checker, components, componentValues, location),
            ...(root ? { root } : {}),
          },
        }
      : {}),
    implementation,
    ...extensionField(extensions, "program", {
      checker,
      source: sourceCompilerAPI(checker, expandedProgram),
      contract,
      implementation: readableValue,
      location,
      path: feature,
      root: sourceRoot,
      feature,
      ...(interfaceOwner ? { interface: interfaceOwner.path } : {}),
      name,
    }),
    span: spanOf(location),
  };
}

function programImplementation(
  checker: ts.TypeChecker,
  start: ts.ObjectLiteralElementLike | ts.FunctionLikeDeclaration | undefined,
  ui: boolean,
  factory: boolean,
  at: ts.Node,
  bindings: ReadonlyMap<ts.Symbol, StaticValue> = new Map(),
  types: ReadonlyMap<ts.Type, ts.Type> = new Map(),
): ProgramContributionIR["implementation"] {
  if (ui) return { kind: "source", reason: "platform-ui", span: spanOf(at) };
  if (factory) {
    return {
      kind: "source",
      reason: "host-source",
      diagnostic: {
        message: "Feature factory output could not be expanded by the portable frontend.",
        span: spanOf(at),
      },
      span: spanOf(at),
    };
  }
  if (!start) return { kind: "none" };
  const lowering = createPortableLowering(checker, bindings, types);
  try {
    return {
      kind: "portable",
      start: lowerStartFunction(lowering, start),
      functions: [...lowering.functions.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    };
  } catch (error) {
    if (
      error instanceof SystemDiagnostic &&
      /Unsupported portable (expression|statement)/.test(error.message)
    ) {
      return {
        kind: "source",
        reason: "host-source",
        diagnostic: { message: error.message, span: error.span },
        span: spanOf(start),
      };
    }
    throw error;
  }
}

function dependencyList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  at: ts.Node,
): DependencyIR[] {
  return sortedSymbols(type?.getProperties() ?? []).map((symbol) => ({
    name: symbol.getName(),
    type: lowerType(
      checker,
      checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at),
      at,
      new Set(),
      symbol.getName(),
    ),
  }));
}

function componentList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  values: ts.ObjectLiteralExpression | undefined,
  at: ts.Node,
): ComponentIR[] {
  return sortedSymbols(type?.getProperties() ?? []).map((symbol) => {
    const location = symbol.valueDeclaration ?? at;
    const component = checker.getTypeOfSymbolAtLocation(symbol, location);
    const props = propertyType(checker, component, "Props", location);
    const state = propertyType(checker, component, "State", location);
    const actions = propertyType(checker, component, "Actions", location);
    const elements = propertyType(checker, component, "Elements", location);
    const implementation = values
      ? objectExpression(checker, resolveObjectMember(checker, values, symbol.getName()))
      : undefined;
    return {
      name: symbol.getName(),
      propCallbacks: sortedSymbols(props?.getProperties() ?? [])
        .filter(
          (field) =>
            checker
              .getNonNullableType(
                checker.getTypeOfSymbolAtLocation(field, field.valueDeclaration ?? location),
              )
              .getCallSignatures().length,
        )
        .map((field) => field.getName()),
      state: state ? lowerType(checker, state, location) : emptyRecord(),
      actions: sortedSymbols(actions?.getProperties() ?? []).map((action) => action.getName()),
      elements: sortedSymbols(elements?.getProperties() ?? []).map((element) => ({
        name: element.getName(),
        element: literalType(
          checker.getTypeOfSymbolAtLocation(element, element.valueDeclaration ?? location),
          element.valueDeclaration ?? location,
          `Component Element ${JSON.stringify(element.getName())}`,
        ),
      })),
      implementation: {
        state: Boolean(implementation && objectMemberDeclaration(implementation, "state")),
        actions: Boolean(implementation && objectMemberDeclaration(implementation, "actions")),
        mount: Boolean(implementation && objectMemberDeclaration(implementation, "mount")),
        view: Boolean(implementation && objectMemberDeclaration(implementation, "view")),
      },
    };
  });
}

function literalType(type: ts.Type, at: ts.Node, label: string): string {
  if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
  throw diagnostic(at, `${label} must be a string literal.`);
}

function lowerType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  active: Set<ts.Type> = new Set(),
  path = "contract",
  substitutions: ReadonlyMap<ts.Type, ts.Type> = new Map(),
): TypeIR {
  const substituted = substitutions.get(type);
  if (substituted && substituted !== type) {
    return lowerType(checker, substituted, at, active, path, substitutions);
  }
  if (type.flags & ts.TypeFlags.IndexedAccess) {
    const indexed = type as ts.IndexedAccessType;
    const owner = substitutions.get(indexed.objectType) ?? indexed.objectType;
    const propertyName =
      indexed.indexType.flags & ts.TypeFlags.StringLiteral
        ? (indexed.indexType as ts.StringLiteralType).value
        : undefined;
    const property = propertyName ? owner.getProperty(propertyName) : undefined;
    if (property) {
      return lowerType(
        checker,
        checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? at),
        at,
        active,
        path,
        substitutions,
      );
    }
  }
  if (type.flags & ts.TypeFlags.Any) {
    throw diagnostic(at, `Portable contract ${path} cannot contain any.`);
  }
  if (type.flags & ts.TypeFlags.Unknown) {
    throw diagnostic(at, "Portable contracts cannot contain unresolved unknown.");
  }
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return { kind: "literal", value: (type as ts.StringLiteralType).value };
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return { kind: "literal", value: (type as ts.NumberLiteralType).value };
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { kind: "literal", value: checker.typeToString(type) === "true" };
  }
  if (type.flags & ts.TypeFlags.Null) return primitive("null");
  if (type.flags & ts.TypeFlags.StringLike) return primitive("string");
  if (type.flags & ts.TypeFlags.NumberLike) return primitive("number");
  if (type.flags & ts.TypeFlags.BooleanLike) return primitive("boolean");
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) {
    return primitive("void");
  }
  if (isErrorType(type)) return { kind: "opaque", name: "Error" };
  const native = nativeTypeName(type);
  if (native) return { kind: "opaque", name: native };
  if (type.isUnion()) {
    const defined = type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined));
    if (defined.length !== type.types.length) {
      return {
        kind: "option",
        value:
          defined.length === 1
            ? lowerType(checker, defined[0]!, at, active, path, substitutions)
            : {
                kind: "union",
                variants: lowerUnionVariants(checker, defined, at, active, path, substitutions),
              },
      };
    }
    return {
      kind: "union",
      variants: lowerUnionVariants(checker, type.types, at, active, path, substitutions),
    };
  }
  if (active.has(type))
    throw diagnostic(at, "Recursive portable contract types are not supported yet.");
  active.add(type);
  try {
    if (checker.isTupleType(type)) {
      const reference = type as ts.TypeReference;
      return {
        kind: "tuple",
        elements: checker
          .getTypeArguments(reference)
          .map((item, index) =>
            lowerType(checker, item, at, active, `${path}[${index}]`, substitutions),
          ),
      };
    }
    if (checker.isArrayType(type)) {
      const reference = type as ts.TypeReference;
      return {
        kind: "array",
        element: lowerType(
          checker,
          checker.getTypeArguments(reference)[0]!,
          at,
          active,
          `${path}[]`,
          substitutions,
        ),
      };
    }
    if (type.symbol?.getName() === "Promise" && type.aliasTypeArguments?.[0]) {
      return {
        kind: "promise",
        value: lowerType(
          checker,
          type.aliasTypeArguments[0],
          at,
          active,
          `${path}.result`,
          substitutions,
        ),
      };
    }
    if (type.symbol?.getName() === "Promise") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) {
        return {
          kind: "promise",
          value: lowerType(checker, argument, at, active, `${path}.result`, substitutions),
        };
      }
    }
    if (type.symbol?.getName() === "AsyncIterable") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) {
        return {
          kind: "stream",
          element: lowerType(checker, argument, at, active, `${path}.item`, substitutions),
        };
      }
    }
    const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
    if (signatures.length === 1 && type.getProperties().length === 0) {
      const signature = signatures[0]!;
      return {
        kind: "function",
        parameters: signature.parameters.map((parameter) => ({
          name: semanticSymbolName(parameter),
          optional: Boolean(parameter.flags & ts.SymbolFlags.Optional),
          type: lowerType(
            checker,
            fieldValueType(
              parameter.valueDeclaration
                ? checker.getTypeAtLocation(parameter.valueDeclaration)
                : checker.getTypeOfSymbolAtLocation(parameter, at),
              Boolean(parameter.flags & ts.SymbolFlags.Optional),
            ),
            at,
            active,
            `${path}.${parameter.getName()}`,
            substitutions,
          ),
        })),
        result: lowerType(
          checker,
          signature.getReturnType(),
          at,
          active,
          `${path}.result`,
          substitutions,
        ),
      };
    }
    const fields: FieldIR[] = sortedSymbols(type.getProperties()).map((symbol) => {
      const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
      return {
        name: semanticSymbolName(symbol),
        optional,
        type: lowerType(
          checker,
          fieldValueType(
            checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at),
            optional,
          ),
          at,
          active,
          `${path}.${semanticSymbolName(symbol)}`,
          substitutions,
        ),
      };
    });
    return { kind: "record", fields };
  } finally {
    active.delete(type);
  }
}

function lowerUnionVariants(
  checker: ts.TypeChecker,
  types: readonly ts.Type[],
  at: ts.Node,
  active: Set<ts.Type>,
  path: string,
  substitutions: ReadonlyMap<ts.Type, ts.Type>,
): readonly TypeIR[] {
  return types
    .map((item, index) => lowerType(checker, item, at, active, `${path}[${index}]`, substitutions))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function isErrorType(type: ts.Type): boolean {
  const declarations = (type.aliasSymbol ?? type.symbol)?.declarations ?? [];
  return declarations.some(
    (declaration) =>
      ts.isClassDeclaration(declaration) &&
      declaration.heritageClauses?.some((clause) =>
        clause.types.some((base) => base.expression.getText() === "Error"),
      ),
  );
}

function nativeTypeName(type: ts.Type): string | undefined {
  const symbol = type.aliasSymbol ?? type.symbol;
  if (!symbol?.declarations?.length) return undefined;
  const name = symbol.getName();
  if (
    [
      "Array",
      "AsyncIterable",
      "Omit",
      "Partial",
      "Pick",
      "Promise",
      "Readonly",
      "ReadonlyArray",
      "Required",
    ].includes(name)
  ) {
    return undefined;
  }
  if (
    [
      "AbortSignal",
      "Blob",
      "FormData",
      "Headers",
      "ReadableStream",
      "Request",
      "Response",
      "URL",
    ].includes(name)
  ) {
    return name;
  }
  if (
    !symbol.declarations.every((declaration) => {
      const source = declaration.getSourceFile();
      return source.hasNoDefaultLib || /(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
    })
  ) {
    return undefined;
  }
  return name.startsWith("__") ? undefined : name;
}

type PortableLowering = Readonly<{
  checker: ts.TypeChecker;
  functions: Map<string, FunctionIR>;
  active: Set<string>;
  activeStatic: Set<ts.Symbol>;
  typeOverrides: Map<ts.Symbol, ts.Type>;
  irTypeOverrides: Map<ts.Symbol, TypeIR>;
  typeSubstitutions: Map<ts.Type, ts.Type>;
  staticBindings: ReadonlyMap<ts.Symbol, StaticValue>;
}>;

function lowerPortableType(lowering: PortableLowering, type: ts.Type, at: ts.Node): TypeIR {
  return lowerType(lowering.checker, type, at, new Set(), "contract", lowering.typeSubstitutions);
}

function createPortableLowering(
  checker: ts.TypeChecker,
  staticBindings: ReadonlyMap<ts.Symbol, StaticValue> = new Map(),
  typeSubstitutions: ReadonlyMap<ts.Type, ts.Type> = new Map(),
): PortableLowering {
  return {
    checker,
    functions: new Map(),
    active: new Set(),
    activeStatic: new Set(),
    typeOverrides: new Map(),
    irTypeOverrides: new Map(),
    typeSubstitutions: new Map(typeSubstitutions),
    staticBindings,
  };
}

function lowerStartFunction(
  lowering: PortableLowering,
  node: ts.ObjectLiteralElementLike | ts.FunctionLikeDeclaration,
): FunctionIR {
  const functionLike = isFunctionImplementation(node) ? node : functionFromMember(node);
  if (!functionLike?.body)
    throw diagnostic(node, "Program start must have a statically known body.");
  return lowerFunction(lowering, functionLike, {
    id: "start",
    name: "start",
    dependenciesName: dependencyBinding(functionLike.parameters[0]) ?? "@dependencies",
    omitFirstParameter: true,
  });
}

function lowerFunction(
  lowering: PortableLowering,
  functionLike: ts.FunctionLikeDeclaration,
  options: Readonly<{
    id: string;
    name: string;
    dependenciesName: string;
    omitFirstParameter?: boolean;
    signature?: ts.Signature;
    parameterTypes?: readonly ts.Type[];
    parameterIRTypes?: readonly TypeIR[];
    resultType?: ts.Type;
    captures?: readonly ts.Symbol[];
  }>,
): FunctionIR {
  if (!functionLike.body) throw diagnostic(functionLike, "Portable functions require a body.");
  validatePortableBindings(functionLike);
  const signature = options.signature ?? lowering.checker.getSignatureFromDeclaration(functionLike);
  if (!signature) throw diagnostic(functionLike, "Cannot resolve portable function signature.");
  const asynchronous =
    Boolean(functionLike.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword)) ||
    isPromiseType(lowering.checker, signature.getReturnType());
  const sourceParameters = options.omitFirstParameter
    ? functionLike.parameters.slice(1)
    : functionLike.parameters;
  const substitutions: Array<Readonly<{ source: ts.Type; previous?: ts.Type }>> = [];
  for (const [index, actual] of (options.parameterTypes ?? []).entries()) {
    const parameter = sourceParameters[index];
    if (!parameter) continue;
    collectTypeSubstitutions(
      lowering,
      lowering.checker.getTypeAtLocation(parameter),
      actual,
      substitutions,
    );
  }
  const parameters = sourceParameters.map((parameter, index): FieldIR => {
    return {
      name: ts.isIdentifier(parameter.name) ? parameter.name.text : `@parameter${index}`,
      optional: Boolean(parameter.questionToken || parameter.initializer),
      type:
        options.parameterIRTypes?.[index] ??
        lowerPortableType(
          lowering,
          fieldValueType(
            options.parameterTypes?.[index] ?? lowering.checker.getTypeAtLocation(parameter),
            Boolean(parameter.questionToken || parameter.initializer),
          ),
          parameter,
        ),
    };
  });
  const captures = (options.captures ?? []).map(
    (symbol): FieldIR => ({
      name: symbol.getName(),
      optional: false,
      type: lowerPortableType(
        lowering,
        lowering.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? functionLike),
        symbol.valueDeclaration ?? functionLike,
      ),
    }),
  );
  const declaredResult = lowerPortableType(
    lowering,
    options.resultType ?? signature.getReturnType(),
    functionLike,
  );
  const overrides: Array<Readonly<{ symbol: ts.Symbol; previous?: ts.Type }>> = [];
  const irOverrides: Array<Readonly<{ symbol: ts.Symbol; previous?: TypeIR }>> = [];
  for (const [index, parameter] of sourceParameters.entries()) {
    const type = options.parameterTypes?.[index];
    if (!type || !ts.isIdentifier(parameter.name)) continue;
    const symbol = lowering.checker.getSymbolAtLocation(parameter.name);
    if (!symbol) continue;
    overrides.push({ symbol, previous: lowering.typeOverrides.get(symbol) });
    lowering.typeOverrides.set(symbol, type);
    const irType = options.parameterIRTypes?.[index];
    if (irType) {
      irOverrides.push({ symbol, previous: lowering.irTypeOverrides.get(symbol) });
      lowering.irTypeOverrides.set(symbol, irType);
    }
  }
  let body: StatementIR[];
  try {
    body = ts.isBlock(functionLike.body)
      ? lowerStatements(lowering, functionLike.body.statements, options.dependenciesName)
      : [
          {
            kind: "return",
            value: lowerExpression(lowering, functionLike.body, options.dependenciesName),
            span: spanOf(functionLike.body),
          },
        ];
    body = [
      ...parameterDefaultBindings(lowering, sourceParameters, options.dependenciesName),
      ...destructuredParameterBindings(lowering, sourceParameters, parameters),
      ...body,
    ];
  } finally {
    for (const { symbol, previous } of overrides.reverse()) {
      if (previous) lowering.typeOverrides.set(symbol, previous);
      else lowering.typeOverrides.delete(symbol);
    }
    for (const { symbol, previous } of irOverrides.reverse()) {
      if (previous) lowering.irTypeOverrides.set(symbol, previous);
      else lowering.irTypeOverrides.delete(symbol);
    }
    for (const { source, previous } of substitutions.reverse()) {
      if (previous) lowering.typeSubstitutions.set(source, previous);
      else lowering.typeSubstitutions.delete(source);
    }
  }
  return {
    id: options.id,
    name: options.name,
    asynchronous,
    captures,
    parameters,
    result:
      asynchronous && declaredResult.kind === "promise" ? declaredResult.value : declaredResult,
    body,
    span: spanOf(functionLike),
  };
}

function collectTypeSubstitutions(
  lowering: PortableLowering,
  source: ts.Type,
  target: ts.Type,
  changes: Array<Readonly<{ source: ts.Type; previous?: ts.Type }>>,
): void {
  if (source.flags & ts.TypeFlags.TypeParameter) {
    if (source === target) return;
    changes.push({ source, previous: lowering.typeSubstitutions.get(source) });
    lowering.typeSubstitutions.set(source, target);
    return;
  }
  const sourceArguments =
    source.aliasTypeArguments ?? typeReferenceArguments(lowering.checker, source);
  const targetArguments =
    target.aliasTypeArguments ?? typeReferenceArguments(lowering.checker, target);
  if (!sourceArguments?.length || sourceArguments.length !== targetArguments?.length) return;
  for (const [index, argument] of sourceArguments.entries()) {
    collectTypeSubstitutions(lowering, argument, targetArguments[index]!, changes);
  }
}

function typeReferenceArguments(
  checker: ts.TypeChecker,
  type: ts.Type,
): readonly ts.Type[] | undefined {
  return type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
    ? checker.getTypeArguments(type as ts.TypeReference)
    : undefined;
}

function destructuredParameterBindings(
  lowering: PortableLowering,
  source: readonly ts.ParameterDeclaration[],
  parameters: readonly FieldIR[],
): readonly StatementIR[] {
  return source.flatMap((parameter, index): readonly StatementIR[] => {
    if (ts.isIdentifier(parameter.name)) return [];
    if (!ts.isObjectBindingPattern(parameter.name)) {
      throw diagnostic(
        parameter.name,
        "Portable parameters support only named or object bindings.",
      );
    }
    const parameterType = parameters[index]!.type;
    return parameter.name.elements.map((element): StatementIR => {
      if (!ts.isIdentifier(element.name) || element.dotDotDotToken) {
        throw diagnostic(element, "Portable object bindings require explicit named fields.");
      }
      const property = element.propertyName
        ? ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
          ? element.propertyName.text
          : undefined
        : element.name.text;
      if (!property) throw diagnostic(element, "Portable object binding keys must be static.");
      const field =
        parameterType.kind === "record"
          ? parameterType.fields.find(({ name }) => name === property)
          : undefined;
      if (!field) throw diagnostic(element, `Unknown portable parameter field ${property}.`);
      return {
        kind: "let",
        name: element.name.text,
        mutable: false,
        value: {
          kind: "property",
          value: {
            kind: "local",
            name: parameters[index]!.name,
            type: parameterType,
            span: spanOf(parameter),
          },
          name: property,
          type: field.type,
          span: spanOf(element),
        },
        span: spanOf(element),
      };
    });
  });
}

function parameterDefaultBindings(
  lowering: PortableLowering,
  parameters: readonly ts.ParameterDeclaration[],
  dependenciesName: string,
): readonly StatementIR[] {
  return parameters.flatMap((parameter): readonly StatementIR[] => {
    if (!parameter.initializer) return [];
    if (!ts.isIdentifier(parameter.name)) {
      throw diagnostic(parameter.name, "Portable default parameters require a named binding.");
    }
    return [
      {
        kind: "assign",
        name: parameter.name.text,
        operator: "??=",
        value: lowerExpression(lowering, parameter.initializer, dependenciesName),
        span: spanOf(parameter),
      },
    ];
  });
}

function validatePortableBindings(functionLike: ts.FunctionLikeDeclaration): void {
  const bindings = new Map<string, ts.Node>();
  const add = (name: ts.BindingName): void => {
    if (!ts.isIdentifier(name)) return;
    const previous = bindings.get(name.text);
    if (previous) {
      throw diagnostic(
        name,
        `Portable binding ${JSON.stringify(name.text)} shadows another binding in the same function.`,
      );
    }
    bindings.set(name.text, name);
  };
  for (const parameter of functionLike.parameters) {
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) add(element.name);
    } else add(parameter.name);
  }
  const visit = (node: ts.Node): void => {
    if (node !== functionLike && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node)) add(node.name);
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body!);
}

function lowerStatements(
  lowering: PortableLowering,
  statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[],
  dependenciesName: string,
): StatementIR[] {
  return statements.flatMap((statement): StatementIR | readonly StatementIR[] => {
    const span = spanOf(statement);
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((declaration): StatementIR => {
        if (!ts.isIdentifier(declaration.name)) {
          throw diagnostic(declaration, "Portable bindings require a name.");
        }
        return {
          kind: "let",
          name: declaration.name.text,
          mutable: (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          value: declaration.initializer
            ? lowerExpression(lowering, declaration.initializer, dependenciesName)
            : {
                kind: "none",
                type: lowerPortableType(
                  lowering,
                  lowering.checker.getTypeAtLocation(declaration),
                  declaration,
                ),
                span: spanOf(declaration),
              },
          span: spanOf(declaration),
        };
      });
    }
    if (ts.isExpressionStatement(statement)) {
      if (
        ts.isCallExpression(statement.expression) &&
        ts.isPropertyAccessExpression(statement.expression.expression) &&
        statement.expression.expression.name.text === "push" &&
        ts.isIdentifier(statement.expression.expression.expression) &&
        statement.expression.arguments.length === 1
      ) {
        return {
          kind: "array-push",
          array: statement.expression.expression.expression.text,
          value: lowerExpression(lowering, statement.expression.arguments[0]!, dependenciesName),
          span,
        };
      }
      if (
        ts.isBinaryExpression(statement.expression) &&
        assignmentOperator(statement.expression.operatorToken)
      ) {
        if (!ts.isIdentifier(statement.expression.left)) {
          throw diagnostic(
            statement.expression.left,
            "Portable assignment targets must be local bindings.",
          );
        }
        return {
          kind: "assign",
          name: statement.expression.left.text,
          operator: assignmentOperator(statement.expression.operatorToken)!,
          value: lowerExpression(lowering, statement.expression.right, dependenciesName),
          span,
        };
      }
      return {
        kind: "expression",
        expression: lowerExpression(lowering, statement.expression, dependenciesName),
        span,
      };
    }
    if (ts.isIfStatement(statement)) {
      return {
        kind: "if",
        condition: booleanExpression(lowering, statement.expression, dependenciesName),
        consequent: lowerStatementBody(lowering, statement.thenStatement, dependenciesName),
        alternate: statement.elseStatement
          ? lowerStatementBody(lowering, statement.elseStatement, dependenciesName)
          : [],
        span,
      };
    }
    if (ts.isForOfStatement(statement)) {
      const declaration = ts.isVariableDeclarationList(statement.initializer)
        ? statement.initializer.declarations[0]
        : undefined;
      if (!declaration || !ts.isIdentifier(declaration.name)) {
        throw diagnostic(statement.initializer, "Portable for-of loops require one named item.");
      }
      const values = lowerExpression(lowering, statement.expression, dependenciesName);
      const asynchronous = statement.awaitModifier !== undefined;
      if (values.type.kind !== (asynchronous ? "stream" : "array")) {
        throw diagnostic(
          statement.expression,
          asynchronous
            ? "Portable for-await-of requires an asynchronous stream."
            : "Portable for-of requires an array value.",
        );
      }
      return {
        kind: "for-of",
        ...(asynchronous ? { asynchronous: true as const } : {}),
        item: declaration.name.text,
        values,
        body: lowerStatementBody(lowering, statement.statement, dependenciesName),
        span,
      };
    }
    if (ts.isForStatement(statement)) {
      const declaration =
        statement.initializer && ts.isVariableDeclarationList(statement.initializer)
          ? statement.initializer.declarations[0]
          : undefined;
      const condition = statement.condition;
      const increment = statement.incrementor;
      if (
        !declaration?.initializer ||
        !ts.isIdentifier(declaration.name) ||
        !condition ||
        !ts.isBinaryExpression(condition) ||
        condition.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
        !ts.isIdentifier(condition.left) ||
        condition.left.text !== declaration.name.text ||
        !increment ||
        !isUnitIncrement(increment, declaration.name.text)
      ) {
        throw diagnostic(statement, "Portable for loops require a fixed increasing range.");
      }
      return {
        kind: "for-range",
        item: declaration.name.text,
        from: lowerExpression(lowering, declaration.initializer, dependenciesName),
        to: lowerExpression(lowering, condition.right, dependenciesName),
        body: lowerStatementBody(lowering, statement.statement, dependenciesName),
        span,
      };
    }
    if (ts.isReturnStatement(statement)) {
      return {
        kind: "return",
        ...(statement.expression
          ? { value: lowerExpression(lowering, statement.expression, dependenciesName) }
          : {}),
        span,
      };
    }
    if (ts.isThrowStatement(statement)) {
      return {
        kind: "throw",
        value: lowerExpression(lowering, statement.expression, dependenciesName),
        span,
      };
    }
    if (ts.isTryStatement(statement)) {
      const variable = statement.catchClause?.variableDeclaration;
      if (variable && !ts.isIdentifier(variable.name)) {
        throw diagnostic(variable, "Portable catch bindings must be named.");
      }
      const symbol = variable ? lowering.checker.getSymbolAtLocation(variable.name) : undefined;
      if (symbol) lowering.irTypeOverrides.set(symbol, { kind: "opaque", name: "Error" });
      const caught = statement.catchClause
        ? lowerStatements(lowering, statement.catchClause.block.statements, dependenciesName)
        : [];
      if (symbol) lowering.irTypeOverrides.delete(symbol);
      return {
        kind: "try",
        body: lowerStatements(lowering, statement.tryBlock.statements, dependenciesName),
        ...(variable && ts.isIdentifier(variable.name) ? { error: variable.name.text } : {}),
        catch: caught,
        finally: statement.finallyBlock
          ? lowerStatements(lowering, statement.finallyBlock.statements, dependenciesName)
          : [],
        span,
      };
    }
    if (ts.isBlock(statement))
      return lowerStatements(lowering, statement.statements, dependenciesName);
    throw diagnostic(statement, `Unsupported portable statement ${ts.SyntaxKind[statement.kind]}.`);
  });
}

function isUnitIncrement(expression: ts.Expression, name: string): boolean {
  if (ts.isPostfixUnaryExpression(expression)) {
    return (
      expression.operator === ts.SyntaxKind.PlusPlusToken &&
      ts.isIdentifier(expression.operand) &&
      expression.operand.text === name
    );
  }
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
    ts.isIdentifier(expression.left) &&
    expression.left.text === name &&
    ts.isNumericLiteral(expression.right) &&
    Number(expression.right.text) === 1
  );
}

function lowerStatementBody(
  lowering: PortableLowering,
  statement: ts.Statement,
  dependenciesName: string,
): StatementIR[] {
  return ts.isBlock(statement)
    ? lowerStatements(lowering, statement.statements, dependenciesName)
    : lowerStatements(lowering, [statement], dependenciesName);
}

function lowerExpression(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
): ExpressionIR {
  const { checker } = lowering;
  const expression = unwrapExpression(node);
  if (ts.isAwaitExpression(expression)) {
    const call = lowerDependencyCall(lowering, expression.expression, dependenciesName, true);
    if (call) return typedExpression(lowering, expression, { ...call, awaited: true });
    if (ts.isCallExpression(expression.expression)) {
      return lowerPortableCall(lowering, expression.expression, dependenciesName, true, expression);
    }
    throw diagnostic(expression, "Only portable calls may be awaited.");
  }
  const dependencyCall = lowerDependencyCall(lowering, expression, dependenciesName, false);
  if (dependencyCall) return typedExpression(lowering, node, dependencyCall);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return typedExpression(lowering, expression, { kind: "literal", value: expression.text });
  }
  if (ts.isNumericLiteral(expression))
    return typedExpression(lowering, expression, {
      kind: "literal",
      value: Number(expression.text),
    });
  if (expression.kind === ts.SyntaxKind.TrueKeyword)
    return typedExpression(lowering, expression, { kind: "literal", value: true });
  if (expression.kind === ts.SyntaxKind.FalseKeyword)
    return typedExpression(lowering, expression, { kind: "literal", value: false });
  if (expression.kind === ts.SyntaxKind.NullKeyword)
    return typedExpression(lowering, expression, { kind: "literal", value: null });
  if (ts.isIdentifier(expression)) {
    if (expression.text === "undefined") {
      return typedExpression(lowering, expression, { kind: "none" });
    }
    const symbol = valueSymbol(checker, expression);
    const binding = symbol ? staticBinding(lowering, symbol) : undefined;
    if (binding?.node && ts.isExpression(binding.node)) {
      return lowerExpression(lowering, binding.node, dependenciesName);
    }
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
    if (
      symbol &&
      declaration?.initializer &&
      !enclosingFunction(declaration) &&
      !lowering.activeStatic.has(symbol)
    ) {
      lowering.activeStatic.add(symbol);
      try {
        return lowerExpression(lowering, declaration.initializer, dependenciesName);
      } finally {
        lowering.activeStatic.delete(symbol);
      }
    }
    return typedExpression(lowering, expression, { kind: "local", name: expression.text });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "array",
      values: expression.elements.map((item) => lowerExpression(lowering, item, dependenciesName)),
    });
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return lowerClosure(lowering, expression, dependenciesName);
  }
  if (ts.isConditionalExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "conditional",
      condition: booleanExpression(lowering, expression.condition, dependenciesName),
      consequent: lowerExpression(lowering, expression.whenTrue, dependenciesName),
      alternate: lowerExpression(lowering, expression.whenFalse, dependenciesName),
    });
  }
  if (ts.isNewExpression(expression)) {
    if (
      !ts.isIdentifier(expression.expression) ||
      !/(?:Error|Failure)$/.test(expression.expression.text)
    ) {
      throw diagnostic(expression, "Unsupported portable expression NewExpression.");
    }
    return {
      kind: "error",
      name: expression.expression.text,
      arguments: (expression.arguments ?? []).map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
      fields: errorFields(lowering, expression, dependenciesName),
      type: { kind: "opaque", name: "Error" },
      span: spanOf(expression),
    };
  }
  if (ts.isTemplateExpression(expression)) {
    return lowerTemplateExpression(lowering, expression, dependenciesName);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    if (expression.properties.some(ts.isSpreadAssignment)) {
      return typedExpression(lowering, expression, {
        kind: "record-merge",
        entries: expression.properties.map((property) => {
          if (ts.isSpreadAssignment(property)) {
            return {
              kind: "spread" as const,
              value: lowerExpression(lowering, property.expression, dependenciesName),
            };
          }
          if (ts.isShorthandPropertyAssignment(property)) {
            return {
              kind: "field" as const,
              name: property.name.text,
              value: lowerExpression(lowering, property.name, dependenciesName),
            };
          }
          if (ts.isMethodDeclaration(property)) {
            const name = portableMemberName(lowering, property);
            if (!name)
              throw diagnostic(property.name, "Portable methods require a named property.");
            return {
              kind: "field" as const,
              name,
              value: lowerClosure(lowering, property, dependenciesName),
            };
          }
          if (!ts.isPropertyAssignment(property)) {
            throw diagnostic(property, "Portable records require explicit properties.");
          }
          return {
            kind: "field" as const,
            name: portableMemberName(lowering, property),
            value: lowerExpression(lowering, property.initializer, dependenciesName),
          };
        }),
      });
    }
    return typedExpression(lowering, expression, {
      kind: "record",
      fields: expression.properties.map((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          return {
            name: property.name.text,
            value: lowerExpression(lowering, property.name, dependenciesName),
          };
        }
        if (ts.isMethodDeclaration(property)) {
          const name = portableMemberName(lowering, property);
          if (!name) throw diagnostic(property.name, "Portable methods require a named property.");
          return { name, value: lowerClosure(lowering, property, dependenciesName) };
        }
        if (!ts.isPropertyAssignment(property)) {
          throw diagnostic(property, "Portable records require explicit properties.");
        }
        return {
          name: portableMemberName(lowering, property),
          value: lowerExpression(lowering, property.initializer, dependenciesName),
        };
      }),
    });
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "property",
      value: lowerExpression(lowering, expression.expression, dependenciesName),
      name: expression.name.text,
      ...(expression.questionDotToken ? { optional: true } : {}),
    });
  }
  if (ts.isElementAccessExpression(expression)) {
    const name = wellKnownMemberExpression(expression.argumentExpression);
    if (!name)
      throw diagnostic(expression, "Portable element access requires a well-known member.");
    return typedExpression(lowering, expression, {
      kind: "property",
      value: lowerExpression(lowering, expression.expression, dependenciesName),
      name,
    });
  }
  if (ts.isBinaryExpression(expression)) {
    if (
      expression.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      ts.isIdentifier(expression.right)
    ) {
      return {
        kind: "error-match",
        value: lowerExpression(lowering, expression.left, dependenciesName),
        name: expression.right.text,
        type: primitive("boolean"),
        span: spanOf(expression),
      };
    }
    const operator = binaryOperator(expression.operatorToken);
    if (!operator) throw diagnostic(expression.operatorToken, "Unsupported portable operator.");
    if (operator === "&&" || operator === "||") {
      return {
        kind: "binary",
        operator,
        left: booleanExpression(lowering, expression.left, dependenciesName),
        right: booleanExpression(lowering, expression.right, dependenciesName),
        type: primitive("boolean"),
        span: spanOf(expression),
      };
    }
    validateBinaryExpression(checker, expression, operator);
    return typedExpression(lowering, expression, {
      kind: "binary",
      operator,
      left: lowerExpression(lowering, expression.left, dependenciesName),
      right: lowerExpression(lowering, expression.right, dependenciesName),
    });
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    if (
      expression.operator !== ts.SyntaxKind.ExclamationToken &&
      expression.operator !== ts.SyntaxKind.MinusToken
    ) {
      throw diagnostic(expression, "Unsupported portable unary operator.");
    }
    if (expression.operator === ts.SyntaxKind.ExclamationToken) {
      return typedExpression(lowering, expression, {
        kind: "unary",
        operator: "!",
        value: booleanExpression(lowering, expression.operand, dependenciesName),
      });
    } else {
      requireType(checker, expression.operand, "number", "Numeric negation requires number.");
    }
    return typedExpression(lowering, expression, {
      kind: "unary",
      operator: "-",
      value: lowerExpression(lowering, expression.operand, dependenciesName),
    });
  }
  if (ts.isCallExpression(expression)) {
    return lowerPortableCall(lowering, expression, dependenciesName, false, node);
  }
  throw diagnostic(
    expression,
    `Unsupported portable expression ${ts.SyntaxKind[expression.kind]}.`,
  );
}

function staticBinding(lowering: PortableLowering, symbol: ts.Symbol): StaticValue | undefined {
  const direct = lowering.staticBindings.get(symbol);
  if (direct) return direct;
  const declarations = new Set(
    (symbol.declarations ?? []).map(
      (declaration) =>
        `${declaration.getSourceFile().fileName}:${declaration.pos}:${declaration.end}`,
    ),
  );
  const candidates = [...lowering.staticBindings].filter(
    ([candidate]) =>
      candidate.getName() === symbol.getName() &&
      (candidate.declarations ?? []).some((declaration) =>
        declarations.has(
          `${declaration.getSourceFile().fileName}:${declaration.pos}:${declaration.end}`,
        ),
      ),
  );
  return candidates.length === 1 ? candidates[0]![1] : undefined;
}

function errorFields(
  lowering: PortableLowering,
  expression: ts.NewExpression,
  dependenciesName: string,
): readonly Readonly<{ name: string; value: ExpressionIR }>[] {
  let symbol = lowering.checker.getSymbolAtLocation(expression.expression);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = lowering.checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
  const constructor = declaration?.members.find(ts.isConstructorDeclaration);
  if (!constructor) return [];
  return constructor.parameters.flatMap((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) {
      throw diagnostic(parameter.name, "Portable Error parameters require named bindings.");
    }
    const argument = expression.arguments?.[index] ?? parameter.initializer;
    if (!argument) return [];
    return [
      {
        name: parameter.name.text,
        value: lowerExpression(lowering, argument, dependenciesName),
      },
    ];
  });
}

function lowerDependencyCall(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
  awaited: boolean,
): Extract<ExpressionIR, { kind: "dependency-call" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const operation = node.expression.name.text;
  const owner = node.expression.expression;
  if (!ts.isPropertyAccessExpression(owner) || !ts.isIdentifier(owner.expression)) return undefined;
  if (owner.expression.text !== dependenciesName) return undefined;
  const argument = node.arguments[0];
  const argumentType = argument
    ? lowerPortableType(lowering, lowering.checker.getTypeAtLocation(argument), argument)
    : undefined;
  if (node.arguments.length !== 1 || argumentType?.kind !== "record") {
    throw diagnostic(node, "Portable Dependency operations require one object argument.");
  }
  const result = lowering.checker.getTypeAtLocation(node);
  const promise = isPromiseType(lowering.checker, result);
  if (promise && !awaited) {
    throw diagnostic(node, "Asynchronous Dependency operations must be awaited.");
  }
  return {
    kind: "dependency-call",
    dependency: owner.name.text,
    operation,
    arguments: node.arguments.map((argument) =>
      lowerExpression(lowering, argument, dependenciesName),
    ),
    awaited,
    type: lowerPortableType(lowering, result, node),
    span: spanOf(node),
  };
}

function typedExpression(
  lowering: PortableLowering,
  node: ts.Node,
  value: ExpressionValueIR,
): ExpressionIR {
  const symbol = ts.isIdentifier(node) ? lowering.checker.getSymbolAtLocation(node) : undefined;
  const override = symbol ? lowering.irTypeOverrides.get(symbol) : undefined;
  return {
    ...value,
    type:
      override ??
      lowerPortableType(
        lowering,
        (symbol && lowering.typeOverrides.get(symbol)) ?? lowering.checker.getTypeAtLocation(node),
        node,
      ),
    span: spanOf(node),
  } as ExpressionIR;
}

function booleanExpression(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
): ExpressionIR {
  const value = lowerExpression(lowering, node, dependenciesName);
  if (
    portableTypeCategory(lowering.checker, lowering.checker.getTypeAtLocation(node)) === "boolean"
  ) {
    return value;
  }
  if (value.type.kind === "option") {
    if (isBooleanIR(value.type.value)) {
      return {
        kind: "binary",
        operator: "??",
        left: value,
        right: {
          kind: "literal",
          value: false,
          type: primitive("boolean"),
          span: spanOf(node),
        },
        type: primitive("boolean"),
        span: spanOf(node),
      };
    }
    return {
      kind: "unary",
      operator: "present",
      value,
      type: primitive("boolean"),
      span: spanOf(node),
    };
  }
  throw diagnostic(node, "Portable conditions require boolean or optional values.");
}

function isBooleanIR(type: TypeIR): boolean {
  if (type.kind === "primitive") return type.name === "boolean";
  if (type.kind === "literal") return typeof type.value === "boolean";
  return type.kind === "union" && type.variants.every(isBooleanIR);
}

function lowerPortableCall(
  lowering: PortableLowering,
  call: ts.CallExpression,
  dependenciesName: string,
  awaited: boolean,
  typeNode: ts.Expression = call,
): ExpressionIR {
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "Object" &&
    call.expression.name.text === "freeze"
  ) {
    if (call.arguments.length !== 1) {
      throw diagnostic(call, "Portable Object.freeze requires one argument.");
    }
    return lowerExpression(lowering, call.arguments[0]!, dependenciesName);
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === "JSON" &&
    (call.expression.name.text === "parse" || call.expression.name.text === "stringify")
  ) {
    if (call.arguments.length !== 1) {
      throw diagnostic(call, `Portable JSON.${call.expression.name.text} requires one argument.`);
    }
    return typedExpression(lowering, typeNode, {
      kind: call.expression.name.text === "parse" ? "json-parse" : "json-stringify",
      value: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
    });
  }
  if (portableIntrinsic(lowering, call.expression) === "stream-map") {
    if (call.arguments.length !== 2) {
      throw diagnostic(call, "mapStream requires a source and transform.");
    }
    return typedExpression(lowering, typeNode, {
      kind: "stream-map",
      source: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
      transform: lowerExpression(lowering, call.arguments[1]!, dependenciesName),
    });
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "find" &&
    lowering.checker.isArrayLikeType(lowering.checker.getTypeAtLocation(call.expression.expression))
  ) {
    return typedExpression(lowering, typeNode, {
      kind: "method-call",
      receiver: lowerExpression(lowering, call.expression.expression, dependenciesName),
      method: "find",
      arguments: call.arguments.map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
    });
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    (call.expression.name.text === "next" || call.expression.name.text === "return")
  ) {
    return typedExpression(lowering, typeNode, {
      kind: "method-call",
      receiver: lowerExpression(lowering, call.expression.expression, dependenciesName),
      method: call.expression.name.text,
      arguments: call.arguments.map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
    });
  }
  if (
    ts.isElementAccessExpression(call.expression) &&
    wellKnownMemberExpression(call.expression.argumentExpression) === "@asyncIterator"
  ) {
    return typedExpression(lowering, typeNode, {
      kind: "method-call",
      receiver: lowerExpression(lowering, call.expression.expression, dependenciesName),
      method: "iterator",
      arguments: [],
    });
  }
  const direct = directFunction(lowering, call.expression);
  if (direct && enclosingFunction(direct.functionLike)) {
    return typedExpression(lowering, typeNode, {
      kind: "invoke",
      callee: lowerExpression(lowering, call.expression, dependenciesName),
      arguments: call.arguments.map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
      awaited,
    });
  }
  if (
    !direct &&
    ts.isPropertyAccessExpression(call.expression) &&
    portableMethod(lowering, call.expression)
  ) {
    return typedExpression(lowering, typeNode, {
      kind: "method-call",
      receiver: lowerExpression(lowering, call.expression.expression, dependenciesName),
      method: call.expression.name.text,
      arguments: call.arguments.map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
    });
  }
  if (!direct && ts.isPropertyAccessExpression(call.expression)) {
    throw diagnostic(
      call,
      "Portable helper calls must resolve to authored code or a supported standard operation.",
    );
  }
  if (!direct) {
    const symbol = lowering.checker.getSymbolAtLocation(call.expression);
    if (
      symbol?.declarations?.every((declaration) => {
        const source = declaration.getSourceFile();
        return source.hasNoDefaultLib || /(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
      })
    ) {
      throw diagnostic(
        call,
        "Portable helper calls must resolve to authored code or a supported standard operation.",
      );
    }
    const calleeType = lowering.checker.getTypeAtLocation(call.expression);
    const signature = calleeType.getCallSignatures()[0];
    if (!signature) {
      throw diagnostic(
        call,
        "Portable code may call only authored functions or declared Dependencies.",
      );
    }
    return typedExpression(lowering, typeNode, {
      kind: "invoke",
      callee: lowerExpression(lowering, call.expression, dependenciesName),
      arguments: call.arguments.map((argument) =>
        lowerExpression(lowering, argument, dependenciesName),
      ),
      awaited,
    });
  }
  let { symbol } = direct;
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = lowering.checker.getAliasedSymbol(symbol);
  }
  const signature = lowering.checker.getResolvedSignature(call);
  if (!symbol || !direct.functionLike || !signature) {
    throw diagnostic(
      call,
      "Portable code may call only authored pure functions or declared Dependencies.",
    );
  }
  const parameterTypes = call.arguments.map((argument) =>
    lowering.checker.getTypeAtLocation(argument),
  );
  const arguments_ = call.arguments.map((argument) =>
    lowerExpression(lowering, argument, dependenciesName),
  );
  const resultType = lowering.checker.getTypeAtLocation(call);
  const captures = capturedSymbols(
    lowering,
    direct.functionLike,
    dependencyParameterName(call, direct.functionLike, dependenciesName),
  );
  const id = portableFunctionId(lowering.checker, symbol, direct.functionLike, parameterTypes);
  if (!lowering.functions.has(id)) {
    if (lowering.active.has(id)) {
      throw diagnostic(call, "Recursive portable functions are not supported in profile v0.");
    }
    lowering.active.add(id);
    try {
      lowering.functions.set(
        id,
        lowerFunction(lowering, direct.functionLike, {
          id,
          name: symbol.getName(),
          dependenciesName: dependencyParameterName(call, direct.functionLike, dependenciesName),
          signature,
          parameterTypes,
          parameterIRTypes: arguments_.map(({ type }) => type),
          resultType,
          captures,
        }),
      );
    } finally {
      lowering.active.delete(id);
    }
  }
  if (captures.length) {
    return typedExpression(lowering, typeNode, {
      kind: "invoke",
      callee: typedExpression(lowering, call.expression, {
        kind: "closure",
        function: id,
        captures: captures.map((capture) => captureExpression(lowering, capture)),
      }),
      arguments: arguments_,
      awaited,
    });
  }
  return typedExpression(lowering, typeNode, {
    kind: "call",
    function: id,
    arguments: arguments_,
    awaited,
  });
}

function portableMethod(
  lowering: PortableLowering,
  expression: ts.PropertyAccessExpression,
): boolean {
  const owner = lowering.checker.getTypeAtLocation(expression.expression);
  const category = portableTypeCategory(lowering.checker, owner);
  if (category === "string") return ["slice", "startsWith"].includes(expression.name.text);
  const member = owner.getProperty(expression.name.text);
  return Boolean(
    member?.declarations?.some((declaration) => {
      const source = declaration.getSourceFile();
      return !source.hasNoDefaultLib && !/(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
    }),
  );
}

function portableIntrinsic(
  lowering: PortableLowering,
  expression: ts.Expression,
): "stream-map" | undefined {
  const direct = directFunction(lowering, expression);
  if (!direct || direct.symbol.getName() !== "mapStream") return undefined;
  const file = direct.functionLike.getSourceFile().fileName.replaceAll("\\", "/");
  return file.endsWith("/core/stream.ts") ? "stream-map" : undefined;
}

function directFunction(
  lowering: PortableLowering,
  expression: ts.Expression,
): Readonly<{ symbol: ts.Symbol; functionLike: ts.FunctionLikeDeclaration }> | undefined {
  const target = unwrapExpression(expression);
  let symbol = lowering.checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(target) ? target.name : target,
  );
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = lowering.checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.declarations?.find(
    (candidate) =>
      ts.isFunctionDeclaration(candidate) ||
      ts.isVariableDeclaration(candidate) ||
      ts.isPropertyAssignment(candidate) ||
      ts.isMethodDeclaration(candidate),
  );
  const functionLike = declaration ? functionFromCallableDeclaration(declaration) : undefined;
  return symbol && functionLike ? { symbol, functionLike } : undefined;
}

function functionFromDeclaration(
  declaration: ts.FunctionDeclaration | ts.VariableDeclaration,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (!declaration.initializer) return undefined;
  const initializer = unwrapExpression(declaration.initializer);
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
    ? initializer
    : undefined;
}

function functionFromCallableDeclaration(
  declaration:
    | ts.FunctionDeclaration
    | ts.VariableDeclaration
    | ts.PropertyAssignment
    | ts.MethodDeclaration,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isMethodDeclaration(declaration)) return declaration.body ? declaration : undefined;
  if (ts.isPropertyAssignment(declaration)) {
    const value = unwrapExpression(declaration.initializer);
    return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
  }
  return functionFromDeclaration(declaration);
}

function lowerClosure(
  lowering: PortableLowering,
  functionLike: ts.ArrowFunction | ts.FunctionExpression | ts.MethodDeclaration,
  dependenciesName: string,
): ExpressionIR {
  const signature = lowering.checker.getSignatureFromDeclaration(functionLike);
  if (!signature) throw diagnostic(functionLike, "Cannot resolve portable closure signature.");
  const captures = capturedSymbols(lowering, functionLike, dependenciesName);
  const id = `closure/${spanKey(functionLike)}`;
  if (!lowering.functions.has(id)) {
    lowering.functions.set(
      id,
      lowerFunction(lowering, functionLike, {
        id,
        name: "closure",
        dependenciesName,
        signature,
        captures,
      }),
    );
  }
  return typedExpression(lowering, functionLike, {
    kind: "closure",
    function: id,
    captures: captures.map((capture) => captureExpression(lowering, capture)),
  });
}

function capturedSymbols(
  lowering: PortableLowering,
  functionLike: ts.FunctionLikeDeclaration,
  dependenciesName: string,
): readonly ts.Symbol[] {
  const captures = new Map<string, ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueIdentifier(node)) {
      let symbol = valueSymbol(lowering.checker, node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = lowering.checker.getAliasedSymbol(symbol);
      }
      if (
        symbol &&
        symbol.getName() !== dependenciesName &&
        !lowering.staticBindings.has(symbol) &&
        symbol.declarations?.some((declaration) => {
          const owner = enclosingFunction(declaration);
          return owner !== undefined && owner !== functionLike && containsNode(owner, functionLike);
        })
      ) {
        captures.set(symbol.getName(), symbol);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionLike.body!);
  return [...captures.values()].sort((left, right) =>
    left.getName().localeCompare(right.getName()),
  );
}

function captureExpression(lowering: PortableLowering, symbol: ts.Symbol): ExpressionIR {
  const at = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!at) throw new Error(`Portable capture ${symbol.getName()} has no declaration.`);
  return {
    kind: "local",
    name: symbol.getName(),
    type: lowerPortableType(lowering, lowering.checker.getTypeOfSymbolAtLocation(symbol, at), at),
    span: spanOf(at),
  };
}

function dependencyParameterName(
  call: ts.CallExpression,
  functionLike: ts.FunctionLikeDeclaration,
  dependenciesName: string,
): string {
  const index = call.arguments.findIndex((argument) => {
    const value = unwrapExpression(argument);
    return ts.isIdentifier(value) && value.text === dependenciesName;
  });
  const parameter = index >= 0 ? functionLike.parameters[index] : undefined;
  return parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : "@dependencies";
}

function lowerTemplateExpression(
  lowering: PortableLowering,
  expression: ts.TemplateExpression,
  dependenciesName: string,
): ExpressionIR {
  let result = typedExpression(lowering, expression, {
    kind: "literal",
    value: expression.head.text,
  });
  for (const span of expression.templateSpans) {
    const value = lowerExpression(lowering, span.expression, dependenciesName);
    result = typedExpression(lowering, expression, {
      kind: "binary",
      operator: "+",
      left: result,
      right: typedExpression(lowering, span.expression, {
        kind: "to-string",
        value,
      }),
    });
    if (span.literal.text) {
      result = typedExpression(lowering, expression, {
        kind: "binary",
        operator: "+",
        left: result,
        right: typedExpression(lowering, expression, {
          kind: "literal",
          value: span.literal.text,
        }),
      });
    }
  }
  return result;
}

function spanKey(node: ts.Node): string {
  const span = spanOf(node);
  return `${span.file}:${span.line}:${span.column}`;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (current) {
    if (isFunctionImplementation(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function containsNode(container: ts.Node, node: ts.Node): boolean {
  return container.pos <= node.pos && container.end >= node.end;
}

function isValueIdentifier(node: ts.Identifier): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isStatement(current) || ts.isExpression(current)) break;
  }
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
    parent.name === node &&
    !ts.isComputedPropertyName(parent.name)
  ) {
    return false;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  return true;
}

function valueSymbol(checker: ts.TypeChecker, node: ts.Identifier): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
    ? (checker.getShorthandAssignmentValueSymbol(node.parent) ?? checker.getSymbolAtLocation(node))
    : checker.getSymbolAtLocation(node);
}

function portableFunctionId(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.FunctionLikeDeclaration,
  parameterTypes: readonly ts.Type[],
): string {
  const span = spanOf(declaration);
  const parameters = parameterTypes.map((type) => checker.typeToString(type)).join(",");
  return `function/${span.file}:${span.line}:${span.column}/${symbol.getName()}(${parameters})`;
}

function isPromiseType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.symbol?.getName() === "Promise") return true;
  return checker.typeToString(type).startsWith("Promise<");
}

function requireType(
  checker: ts.TypeChecker,
  node: ts.Expression,
  expected: "boolean" | "number" | "string",
  message: string,
): void {
  if (portableTypeCategory(checker, checker.getTypeAtLocation(node)) !== expected) {
    throw diagnostic(node, message);
  }
}

function validateBinaryExpression(
  checker: ts.TypeChecker,
  expression: ts.BinaryExpression,
  operator: Extract<ExpressionIR, { kind: "binary" }>["operator"],
): void {
  const left = portableTypeCategory(checker, checker.getTypeAtLocation(expression.left));
  const right = portableTypeCategory(checker, checker.getTypeAtLocation(expression.right));
  if (operator === "+") {
    if ((left === "number" && right === "number") || (left === "string" && right === "string")) {
      return;
    }
    throw diagnostic(expression, "Portable + requires two numbers or two strings.");
  }
  if (["-", "*", "/", "%", "<", "<=", ">", ">="].includes(operator)) {
    if (left === "number" && right === "number") return;
    throw diagnostic(expression, `Portable ${operator} requires two numbers.`);
  }
  if (operator === "&&" || operator === "||") {
    if (left === "boolean" && right === "boolean") return;
    throw diagnostic(expression, `Portable ${operator} requires two booleans.`);
  }
  if (operator === "??") return;
  if (operator === "===" || operator === "!==") return;
  if (left !== right) {
    throw diagnostic(expression, `Portable ${operator} requires operands of the same value kind.`);
  }
}

function portableTypeCategory(
  checker: ts.TypeChecker,
  type: ts.Type,
): "boolean" | "number" | "string" | "other" {
  if (type.flags & ts.TypeFlags.BooleanLike) return "boolean";
  if (type.flags & ts.TypeFlags.NumberLike) return "number";
  if (type.flags & ts.TypeFlags.StringLike) return "string";
  const base = checker.getBaseTypeOfLiteralType(type);
  if (base !== type) return portableTypeCategory(checker, base);
  return "other";
}

function fieldValueType(type: ts.Type, optional: boolean): ts.Type {
  if (!optional || !type.isUnion()) return type;
  const defined = type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined));
  return defined.length === 1 ? defined[0]! : type;
}

function dependencyBinding(parameter: ts.ParameterDeclaration | undefined): string | undefined {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  for (const binding of parameter.name.elements) {
    const source = binding.propertyName ? memberName(binding) : memberName(binding);
    if (source === "dependencies" && ts.isIdentifier(binding.name)) return binding.name.text;
  }
  return undefined;
}

function propertyType(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): ts.Type | undefined {
  const symbol = owner.getProperty(name);
  return symbol
    ? checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at)
    : undefined;
}

function booleanLiteralProperty(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): boolean | undefined {
  const value = propertyType(checker, owner, name, at);
  if (!value || !(value.flags & ts.TypeFlags.BooleanLiteral)) return undefined;
  return checker.typeToString(value, at) === "true";
}

function retainedFeatureContract(checker: ts.TypeChecker, feature: ts.Type, at: ts.Node): ts.Type {
  for (const symbol of feature.getProperties()) {
    const retained = symbol.declarations?.some((declaration) => {
      if (!ts.isPropertySignature(declaration) || !ts.isComputedPropertyName(declaration.name)) {
        return false;
      }
      return (
        ts.isIdentifier(declaration.name.expression) &&
        declaration.name.expression.text === "featureContract"
      );
    });
    if (!retained) continue;
    return fieldValueType(checker.getTypeOfSymbolAtLocation(symbol, at), true);
  }
  throw diagnostic(
    at,
    "System Features must be created by a typed Feature or reusable Feature factory.",
  );
}

function literalProperty(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): string {
  const type = propertyType(checker, owner, name, at);
  if (type && type.flags & ts.TypeFlags.StringLiteral) {
    return (type as ts.StringLiteralType).value;
  }
  throw diagnostic(at, `${name} must be a string literal.`);
}

function literalPropertyOptional(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): string | undefined {
  const type = propertyType(checker, owner, name, at);
  if (!type) return undefined;
  if (type.flags & ts.TypeFlags.StringLiteral) return (type as ts.StringLiteralType).value;
  throw diagnostic(at, `${name} must be a string literal.`);
}

function primitive(name: "boolean" | "null" | "number" | "string" | "void"): TypeIR {
  return { kind: "primitive", name };
}

function emptyRecord(): TypeIR {
  return { kind: "record", fields: [] };
}

function sortedSymbols(symbols: readonly ts.Symbol[]): ts.Symbol[] {
  return [...symbols].sort((left, right) => left.getName().localeCompare(right.getName()));
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function assignmentOperator(
  token: ts.BinaryOperatorToken,
): "=" | "+=" | "-=" | "*=" | "/=" | "??=" | undefined {
  switch (token.kind) {
    case ts.SyntaxKind.EqualsToken:
      return "=";
    case ts.SyntaxKind.PlusEqualsToken:
      return "+=";
    case ts.SyntaxKind.MinusEqualsToken:
      return "-=";
    case ts.SyntaxKind.AsteriskEqualsToken:
      return "*=";
    case ts.SyntaxKind.SlashEqualsToken:
      return "/=";
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return "??=";
    default:
      return undefined;
  }
}

function binaryOperator(
  token: ts.BinaryOperatorToken,
): Extract<ExpressionIR, { kind: "binary" }>["operator"] | undefined {
  switch (token.kind) {
    case ts.SyntaxKind.PlusToken:
      return "+";
    case ts.SyntaxKind.MinusToken:
      return "-";
    case ts.SyntaxKind.AsteriskToken:
      return "*";
    case ts.SyntaxKind.SlashToken:
      return "/";
    case ts.SyntaxKind.PercentToken:
      return "%";
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.LessThanToken:
      return "<";
    case ts.SyntaxKind.LessThanEqualsToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanToken:
      return ">";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return "&&";
    case ts.SyntaxKind.BarBarToken:
      return "||";
    case ts.SyntaxKind.QuestionQuestionToken:
      return "??";
    default:
      return undefined;
  }
}

function objectMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Expression | undefined {
  const member = object?.properties.find((property) => memberName(property) === name);
  if (!member) return undefined;
  if (ts.isPropertyAssignment(member)) return unwrapExpression(member.initializer);
  if (ts.isShorthandPropertyAssignment(member)) {
    return resolveSymbol(checker, checker.getShorthandAssignmentValueSymbol(member), member.name);
  }
  return undefined;
}

function resolveObjectMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  return objectMember(checker, object, name);
}

function objectMemberDeclaration(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => memberName(property) === name);
}

function stringMember(
  checker: ts.TypeChecker,
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): string | undefined {
  const value = objectMember(checker, object, name);
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function resolveSymbol(
  checker: ts.TypeChecker,
  sourceSymbol: ts.Symbol | undefined,
  identifier: ts.Identifier,
): ts.Expression {
  const symbol =
    sourceSymbol && sourceSymbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(sourceSymbol)
      : sourceSymbol;
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (!declaration?.initializer) throw diagnostic(identifier, `Cannot resolve ${identifier.text}.`);
  return unwrapExpression(declaration.initializer);
}

type StaticValue = Readonly<{
  node: ts.Node;
  bindings: ReadonlyMap<ts.Symbol, StaticValue>;
  types?: ReadonlyMap<ts.Type, ts.Type>;
}>;

function resolveStaticPath(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  path: readonly string[],
): StaticValue | undefined {
  let value = resolveStaticValue(
    checker,
    { node: expression, bindings: new Map(), types: new Map() },
    new Set(),
  );
  for (const name of path) {
    if (!value) return undefined;
    value = resolveStaticMember(checker, value, name);
  }
  return value;
}

function resolveFeatureProgram(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  program: string,
  active: Set<ts.Node> = new Set(),
): StaticValue | undefined {
  const node = unwrapExpression(expression);
  if (active.has(node)) return undefined;
  active.add(node);
  try {
    if (ts.isIdentifier(node)) {
      let symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer
        ? resolveFeatureProgram(checker, declaration.initializer, program, active)
        : undefined;
    }
    if (ts.isCallExpression(node) && resolvedCallName(checker, node) === "placePrograms") {
      const feature = node.arguments[0];
      const placement = objectExpression(checker, node.arguments[1]);
      if (!feature || !placement) return undefined;
      const mapped = placement.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === program,
      );
      return resolveFeatureProgram(
        checker,
        feature,
        (mapped ? memberName(mapped) : undefined) ?? program,
        active,
      );
    }
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const feature = node.arguments[0];
      const unwrapped = resolveFeatureProgram(checker, feature, program, active);
      if (unwrapped) return unwrapped;
    }
    return resolveStaticPath(checker, node, ["programs", program]);
  } finally {
    active.delete(node);
  }
}

function resolveFeatureChild(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  child: string,
  active: Set<ts.Node> = new Set(),
): StaticValue | undefined {
  const node = unwrapExpression(expression);
  if (active.has(node)) return undefined;
  active.add(node);
  try {
    if (ts.isIdentifier(node)) {
      let symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer
        ? resolveFeatureChild(checker, declaration.initializer, child, active)
        : undefined;
    }
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const feature = node.arguments[0];
      const unwrapped = resolveFeatureChild(checker, feature, child, active);
      if (unwrapped) return unwrapped;
    }
    const feature = objectExpression(checker, node);
    const children = objectExpression(checker, objectMember(checker, feature, "features"));
    const value = objectMember(checker, children, child);
    if (value) return { node: value, bindings: new Map(), types: new Map() };
    return resolveStaticPath(checker, node, ["features", child]);
  } finally {
    active.delete(node);
  }
}

function resolvedCallName(checker: ts.TypeChecker, call: ts.CallExpression): string | undefined {
  const target = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  if (!ts.isIdentifier(target)) return undefined;
  let symbol = checker.getSymbolAtLocation(target);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol?.getName() ?? target.text;
}

function resolveStaticMember(
  checker: ts.TypeChecker,
  source: StaticValue,
  name: string,
): StaticValue | undefined {
  const value = resolveStaticValue(checker, source, new Set());
  if (!value) return undefined;
  if (ts.isObjectLiteralExpression(value.node)) {
    const member = [...value.node.properties]
      .reverse()
      .find((property) => memberName(property) === name);
    if (member) {
      if (ts.isPropertyAssignment(member)) {
        return resolveStaticValue(
          checker,
          { node: member.initializer, bindings: value.bindings, types: value.types },
          new Set(),
        );
      }
      if (ts.isShorthandPropertyAssignment(member)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(member);
        const bound = symbol ? value.bindings.get(symbol) : undefined;
        if (bound) return resolveStaticValue(checker, bound, new Set());
        return resolveStaticValue(
          checker,
          { node: member.name, bindings: value.bindings, types: value.types },
          new Set(),
        );
      }
      if (ts.isMethodDeclaration(member)) {
        return { node: member, bindings: value.bindings, types: value.types };
      }
    }
    for (const property of [...value.node.properties].reverse()) {
      if (!ts.isSpreadAssignment(property)) continue;
      const spread = resolveStaticValue(
        checker,
        { node: property.expression, bindings: value.bindings, types: value.types },
        new Set(),
      );
      if (!spread) continue;
      const nested = resolveStaticMember(checker, spread, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

function resolveStaticValue(
  checker: ts.TypeChecker,
  source: StaticValue,
  active: Set<ts.Node>,
): StaticValue | undefined {
  let node = source.node;
  if (ts.isExpression(node)) node = unwrapExpression(node);
  if (active.has(node)) return undefined;
  active.add(node);
  try {
    if (ts.isIdentifier(node)) {
      let symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const bound = symbol ? source.bindings.get(symbol) : undefined;
      if (bound) return resolveStaticValue(checker, bound, active);
      const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer
        ? resolveStaticValue(
            checker,
            { node: declaration.initializer, bindings: source.bindings, types: source.types },
            active,
          )
        : undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = resolveStaticValue(
        checker,
        { node: node.expression, bindings: source.bindings, types: source.types },
        active,
      );
      return owner ? resolveStaticMember(checker, owner, node.name.text) : undefined;
    }
    if (ts.isCallExpression(node)) {
      const functionLike = staticCallTarget(checker, node);
      if (!functionLike) return undefined;
      const bindings = new Map(source.bindings);
      for (const [index, parameter] of functionLike.parameters.entries()) {
        if (!ts.isIdentifier(parameter.name)) return undefined;
        const symbol = checker.getSymbolAtLocation(parameter.name);
        const argument = node.arguments[index];
        if (!symbol || !argument) return undefined;
        bindings.set(symbol, { node: argument, bindings: source.bindings, types: source.types });
      }
      const types = staticCallTypes(checker, node, functionLike, source.types);
      const returned = staticFunctionResult(checker, functionLike, bindings, types);
      return returned ? resolveStaticValue(checker, returned, active) : undefined;
    }
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      return { node, bindings: source.bindings, types: source.types };
    }
    return undefined;
  } finally {
    active.delete(node);
  }
}

function staticConstant(
  checker: ts.TypeChecker,
  source: StaticValue,
  active: Set<ts.Node>,
): ExtensionIR | undefined {
  const value = resolveStaticValue(checker, source, new Set()) ?? source;
  const node = value.node;
  if (active.has(node)) return undefined;
  active.add(node);
  try {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const operand = staticConstant(
        checker,
        { node: node.operand, bindings: value.bindings, types: value.types },
        active,
      );
      return typeof operand === "number" ? -operand : undefined;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const result: ExtensionIR[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) return undefined;
        const item = staticConstant(
          checker,
          { node: element, bindings: value.bindings, types: value.types },
          active,
        );
        if (item === undefined) return undefined;
        result.push(item);
      }
      return result;
    }
    if (!ts.isObjectLiteralExpression(node)) return undefined;
    const result: Record<string, ExtensionIR> = Object.create(null);
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = staticConstant(
          checker,
          { node: property.expression, bindings: value.bindings, types: value.types },
          active,
        );
        if (!spread || typeof spread !== "object" || Array.isArray(spread)) return undefined;
        Object.assign(result, spread);
        continue;
      }
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return undefined;
      }
      const name = ts.isComputedPropertyName(property.name)
        ? undefined
        : ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name) ||
            ts.isNumericLiteral(property.name)
          ? property.name.text
          : undefined;
      if (!name) return undefined;
      const child = staticConstant(
        checker,
        {
          node: ts.isPropertyAssignment(property) ? property.initializer : property.name,
          bindings: value.bindings,
          types: value.types,
        },
        active,
      );
      if (child === undefined) return undefined;
      result[name] = child;
    }
    return result;
  } finally {
    active.delete(node);
  }
}

function staticCallTarget(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
): ts.FunctionLikeDeclaration | undefined {
  const target = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  if (!ts.isIdentifier(target)) return undefined;
  let symbol = checker.getSymbolAtLocation(target);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isFunctionDeclaration(declaration) && declaration.body) return declaration;
    if (ts.isVariableDeclaration(declaration)) {
      const functionLike = functionFromDeclaration(declaration);
      if (functionLike) return functionLike;
    }
  }
  return undefined;
}

function staticCallTypes(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  functionLike: ts.FunctionLikeDeclaration,
  inherited: ReadonlyMap<ts.Type, ts.Type> = new Map(),
): ReadonlyMap<ts.Type, ts.Type> {
  const types = new Map(inherited);
  const declared = checker.getSignatureFromDeclaration(functionLike);
  const resolved = checker.getResolvedSignature(call);
  if (!declared?.typeParameters || !resolved) return types;
  const arguments_ = checker.getTypeArgumentsForResolvedSignature(resolved) ?? [];
  for (const [index, parameter] of declared.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument) types.set(parameter, argument);
  }
  return types;
}

function staticFunctionResult(
  checker: ts.TypeChecker,
  functionLike: ts.FunctionLikeDeclaration,
  initialBindings: ReadonlyMap<ts.Symbol, StaticValue>,
  types: ReadonlyMap<ts.Type, ts.Type> = new Map(),
): StaticValue | undefined {
  if (!functionLike.body) return undefined;
  if (!ts.isBlock(functionLike.body)) {
    return { node: functionLike.body, bindings: initialBindings, types };
  }
  const bindings = new Map(initialBindings);
  for (const statement of functionLike.body.statements) {
    if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return undefined;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
        const symbol = checker.getSymbolAtLocation(declaration.name);
        if (!symbol) return undefined;
        bindings.set(symbol, {
          node: declaration.initializer,
          bindings: new Map(bindings),
          types,
        });
      }
      continue;
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      return { node: statement.expression, bindings, types };
    }
    return undefined;
  }
  return undefined;
}

function functionNode(node: ts.Node | undefined): ts.FunctionLikeDeclaration | undefined {
  if (!node) return undefined;
  return isFunctionImplementation(node) ? node : undefined;
}

function isFunctionImplementation(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function objectExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expression) return undefined;
  const resolved = resolveStaticValue(
    checker,
    { node: expression, bindings: new Map(), types: new Map() },
    new Set(),
  );
  const node =
    resolved?.node && ts.isExpression(resolved.node)
      ? unwrapExpression(resolved.node)
      : unwrapExpression(expression);
  return ts.isObjectLiteralExpression(node) ? node : undefined;
}

function requireObject(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  message: string,
): ts.ObjectLiteralExpression {
  const object = objectExpression(checker, expression);
  if (!object) throw diagnostic(expression, message);
  return object;
}

function functionFromMember(
  member: ts.ObjectLiteralElementLike,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isMethodDeclaration(member)) return member;
  if (ts.isPropertyAssignment(member)) {
    const value = unwrapExpression(member.initializer);
    return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function memberName(member: ts.NamedDeclaration): string | undefined {
  const name = member.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name)) return wellKnownMemberExpression(name.expression);
  return undefined;
}

function portableMemberName(lowering: PortableLowering, member: ts.NamedDeclaration): string {
  const name = memberName(member);
  if (name) return name;
  if (!member.name || !ts.isComputedPropertyName(member.name)) {
    throw diagnostic(member, "Portable record properties require a named key.");
  }
  const resolved = resolveStaticValue(
    lowering.checker,
    {
      node: member.name.expression,
      bindings: lowering.staticBindings,
      types: lowering.typeSubstitutions,
    },
    new Set(),
  );
  const value =
    resolved?.node && ts.isExpression(resolved.node) ? unwrapExpression(resolved.node) : undefined;
  if (value && (ts.isStringLiteral(value) || ts.isNumericLiteral(value))) return value.text;
  throw diagnostic(
    member.name,
    "Portable computed record keys must resolve to a compile-time string or number.",
  );
}

function semanticSymbolName(symbol: ts.Symbol): string {
  const name = symbol.getName();
  if (name.startsWith("__@dispose")) return "@dispose";
  if (name.startsWith("__@asyncDispose")) return "@asyncDispose";
  if (name.startsWith("__@asyncIterator")) return "@asyncIterator";
  return name;
}

function wellKnownMemberExpression(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
  if (value.expression.text !== "Symbol") return undefined;
  if (value.name.text === "dispose") return "@dispose";
  if (value.name.text === "asyncDispose") return "@asyncDispose";
  if (value.name.text === "asyncIterator") return "@asyncIterator";
  return undefined;
}

function spanOf(node: ts.Node): SourceSpan {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: position.line + 1, column: position.character + 1 };
}

function diagnostic(node: ts.Node, message: string): SystemDiagnostic {
  return new SystemDiagnostic(message, spanOf(node));
}

function formatTypeScriptDiagnostic(item: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
  if (!item.file || item.start === undefined) return message;
  const position = item.file.getLineAndCharacterOfPosition(item.start);
  return `${item.file.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
}

function readCompilerOptions(configuration: string): ts.CompilerOptions {
  const loaded = ts.readConfigFile(configuration, ts.sys.readFile);
  if (loaded.error) throw new Error(formatTypeScriptDiagnostic(loaded.error));
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(configuration),
    undefined,
    configuration,
  );
  const error = parsed.errors.find((item) => item.category === ts.DiagnosticCategory.Error);
  if (error) throw new Error(formatTypeScriptDiagnostic(error));
  return parsed.options;
}

function normalizeSourceFiles(ir: SystemIR, root: string): SystemIR {
  const normalizeSpan = (span: SourceSpan): SourceSpan => ({
    ...span,
    file: relative(root, span.file).replaceAll("\\", "/"),
  });
  const normalizeFunctionId = (id: string): string => {
    const match = /^(function|closure)\/(.+):(\d+):(\d+)(\/.*)?$/.exec(id);
    if (!match) return id;
    return `${match[1]}/${relative(root, match[2]!).replaceAll("\\", "/")}:${match[3]}:${match[4]}${match[5] ?? ""}`;
  };
  const normalizeExpression = (expression: ExpressionIR): ExpressionIR => {
    const span = normalizeSpan(expression.span);
    switch (expression.kind) {
      case "array":
        return { ...expression, values: expression.values.map(normalizeExpression), span };
      case "error":
        return {
          ...expression,
          arguments: expression.arguments.map(normalizeExpression),
          fields: expression.fields.map((field) => ({
            ...field,
            value: normalizeExpression(field.value),
          })),
          span,
        };
      case "record":
        return {
          ...expression,
          fields: expression.fields.map((field) => ({
            ...field,
            value: normalizeExpression(field.value),
          })),
          span,
        };
      case "record-merge":
        return {
          ...expression,
          entries: expression.entries.map((entry) => ({
            ...entry,
            value: normalizeExpression(entry.value),
          })),
          span,
        };
      case "property":
      case "unary":
        return { ...expression, value: normalizeExpression(expression.value), span };
      case "binary":
        return {
          ...expression,
          left: normalizeExpression(expression.left),
          right: normalizeExpression(expression.right),
          span,
        };
      case "conditional":
        return {
          ...expression,
          condition: normalizeExpression(expression.condition),
          consequent: normalizeExpression(expression.consequent),
          alternate: normalizeExpression(expression.alternate),
          span,
        };
      case "call":
        return {
          ...expression,
          function: normalizeFunctionId(expression.function),
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "invoke":
        return {
          ...expression,
          callee: normalizeExpression(expression.callee),
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "error-match":
        return { ...expression, value: normalizeExpression(expression.value), span };
      case "method-call":
        return {
          ...expression,
          receiver: normalizeExpression(expression.receiver),
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "json-parse":
      case "json-stringify":
      case "to-string":
        return { ...expression, value: normalizeExpression(expression.value), span };
      case "stream-map":
        return {
          ...expression,
          source: normalizeExpression(expression.source),
          transform: normalizeExpression(expression.transform),
          span,
        };
      case "closure":
        return {
          ...expression,
          function: normalizeFunctionId(expression.function),
          captures: expression.captures.map(normalizeExpression),
          span,
        };
      case "dependency-call":
        return {
          ...expression,
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "literal":
      case "none":
      case "local":
        return { ...expression, span };
    }
  };
  const normalizeStatements = (statements: readonly StatementIR[]): StatementIR[] =>
    statements.map((statement): StatementIR => {
      if (statement.kind === "if") {
        return {
          ...statement,
          condition: normalizeExpression(statement.condition),
          consequent: normalizeStatements(statement.consequent),
          alternate: normalizeStatements(statement.alternate),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "for-of") {
        return {
          ...statement,
          values: normalizeExpression(statement.values),
          body: normalizeStatements(statement.body),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "for-range") {
        return {
          ...statement,
          from: normalizeExpression(statement.from),
          to: normalizeExpression(statement.to),
          body: normalizeStatements(statement.body),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "try") {
        return {
          ...statement,
          body: normalizeStatements(statement.body),
          catch: normalizeStatements(statement.catch),
          finally: normalizeStatements(statement.finally),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "let" || statement.kind === "assign") {
        return {
          ...statement,
          value: normalizeExpression(statement.value),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "array-push") {
        return {
          ...statement,
          value: normalizeExpression(statement.value),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "throw") {
        return {
          ...statement,
          value: normalizeExpression(statement.value),
          span: normalizeSpan(statement.span),
        };
      }
      if (statement.kind === "expression") {
        return {
          ...statement,
          expression: normalizeExpression(statement.expression),
          span: normalizeSpan(statement.span),
        };
      }
      return {
        ...statement,
        ...(statement.value ? { value: normalizeExpression(statement.value) } : {}),
        span: normalizeSpan(statement.span),
      };
    });
  const normalizeFunction = (function_: FunctionIR): FunctionIR => {
    const span = normalizeSpan(function_.span);
    return {
      ...function_,
      id: normalizeFunctionId(function_.id),
      span,
      body: normalizeStatements(function_.body),
    };
  };
  return {
    ...ir,
    programs: ir.programs.map((program) => ({
      ...program,
      contributions: program.contributions.map((contribution) => ({
        ...contribution,
        span: normalizeSpan(contribution.span),
        implementation:
          contribution.implementation.kind === "portable"
            ? {
                kind: "portable",
                start: normalizeFunction(contribution.implementation.start),
                functions: contribution.implementation.functions.map(normalizeFunction),
              }
            : contribution.implementation.kind === "source"
              ? {
                  ...contribution.implementation,
                  ...(contribution.implementation.diagnostic
                    ? {
                        diagnostic: {
                          ...contribution.implementation.diagnostic,
                          span: normalizeSpan(contribution.implementation.diagnostic.span),
                        },
                      }
                    : {}),
                  span: normalizeSpan(contribution.implementation.span),
                }
              : contribution.implementation,
      })),
    })),
  };
}
