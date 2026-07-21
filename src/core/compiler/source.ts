import { statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import {
  POGGERS_IR_VERSION,
  type CapabilityIR,
  type ComponentIR,
  type ExpressionIR,
  type ExpressionValueIR,
  type FeatureIR,
  type FieldIR,
  type FunctionIR,
  type ApplicationIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SourceSpan,
  type StatementIR,
  type TypeIR,
} from "@/core/compiler/ir";
import { compilePresentationSource } from "@/core/compiler/presentation";

export class ApplicationDiagnostic extends Error {
  readonly span: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "ApplicationDiagnostic";
    this.span = span;
  }
}

export type ApplicationPaths = Readonly<{
  directory: string;
  source: string;
  application: string;
}>;

export type ApplicationCompilation = Readonly<{
  ir: ApplicationIR;
  presentationSources: ReadonlySet<string>;
}>;

export type ApplicationCompiler = Readonly<{
  compile(changedFile?: string): ApplicationCompilation;
}>;

/** Resolves the one conventional Application entry without executing it. */
export function resolveApplication(directory: string): ApplicationPaths {
  const root = resolve(directory);
  const source = resolve(root, "src");
  for (const name of ["app.tsx", "app.ts"]) {
    const application = resolve(source, name);
    try {
      if (statSync(application).size > 0) return { directory: root, source, application };
    } catch {
      continue;
    }
  }
  throw new Error(`${source} must contain app.tsx or app.ts.`);
}

export function compileApplication(entry: string): ApplicationIR {
  return compileApplicationProgram(entry).compilation.ir;
}

/** Retains TypeScript's semantic graph across development compilations. */
export function createApplicationCompiler(entry: string): ApplicationCompiler {
  let previous: ts.Program | undefined;
  return {
    compile(changedFile) {
      const result = compileApplicationProgram(entry, previous, changedFile);
      previous = result.program;
      return result.compilation;
    },
  };
}

function compileApplicationProgram(
  entry: string,
  previous?: ts.Program,
  changedFile?: string,
): Readonly<{ compilation: ApplicationCompilation; program: ts.Program }> {
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
  if (!assignment) throw diagnostic(source, "The application must have one default export.");
  const exported = unwrapExpression(assignment.expression);
  const applicationObject = objectExpression(checker, exported);
  if (!applicationObject)
    throw diagnostic(exported, "The default export must be an application object.");
  const contractNode = applicationContractNode(assignment.expression);
  const contract = contractNode
    ? checker.getTypeFromTypeNode(contractNode)
    : checker.getTypeAtLocation(exported);
  const featuresContract = propertyType(checker, contract, "Features", contractNode ?? exported);
  const featuresValue = objectMember(checker, applicationObject, "features");
  if (!featuresContract || !featuresValue) {
    throw diagnostic(
      applicationObject,
      "The application contract and value must declare Features.",
    );
  }

  const metadata = objectExpression(checker, objectMember(checker, applicationObject, "metadata"));
  const applicationName =
    stringMember(checker, metadata, "name") ?? source.fileName.split("/").at(-2) ?? "app";
  const features: FeatureIR[] = [];
  const contributions: UnassembledProgramIR[] = [];
  extractFeatures(
    checker,
    featuresContract,
    requireObject(checker, featuresValue, "Application features must be an object."),
    "",
    features,
    contributions,
  );
  validateProgramEnvironments(contributions);
  const programs = assemblePrograms(contributions);

  const platforms = [...new Set(programs.map(({ environment }) => environment.platform))].sort();

  const root = dirname(file);
  const implementationSources = presentationImplementationSources(
    program,
    checker,
    applicationObject,
    root,
  );
  const presentationIR = [...implementationSources]
    .map((path) => {
      const implementation = program.getSourceFile(path);
      if (!implementation) throw new Error(`Cannot read Presentation source ${path}.`);
      return compilePresentationSource(implementation.text, relative(root, path)).ir;
    })
    .filter(({ animations, declarations }) => animations.length || declarations.length)
    .sort(({ file: left }, { file: right }) => left.localeCompare(right));
  const ir = normalizeSourceFiles(
    {
      version: POGGERS_IR_VERSION,
      application: {
        id: `application/${applicationName}`,
        name: applicationName,
        presentations: presentationNames(checker, contract, contractNode ?? exported),
      },
      platforms,
      features: features.sort(byId),
      programs: programs.sort(byId),
      presentations: presentationIR,
    },
    configuration ? dirname(configuration) : root,
  );
  return {
    compilation: {
      ir,
      presentationSources: implementationSources,
    },
    program,
  };
}

type UnassembledProgramIR = ProgramContributionIR &
  Readonly<{
    name: string;
    environment: ProgramIR["environment"];
  }>;

function validateProgramEnvironments(programs: readonly UnassembledProgramIR[]): void {
  const environments = new Map<string, ProgramIR["environment"]>();
  for (const program of programs) {
    const previous = environments.get(program.name);
    if (!previous) {
      environments.set(program.name, program.environment);
      continue;
    }
    if (JSON.stringify(previous) === JSON.stringify(program.environment)) continue;
    throw new ApplicationDiagnostic(
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
      throw new ApplicationDiagnostic(
        `Program ${JSON.stringify(name)} declares multiple UI roots: ${roots
          .map(({ feature, component }) => `${feature}.${component}`)
          .join(", ")}.`,
        members[1]!.span,
      );
    }
    return {
      id: `program/${name}`,
      name,
      environment,
      contributions: members.map(({ name: _name, environment: _environment, ...member }) => member),
      ...(roots[0] ? { ui: { root: roots[0] } } : {}),
    };
  });
}

function presentationImplementationSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  application: ts.ObjectLiteralExpression,
  root: string,
): ReadonlySet<string> {
  const presentations = objectExpression(
    checker,
    objectMember(checker, application, "presentations"),
  );
  if (!presentations) return new Set();
  const sources = new Set<string>();
  const pending: ts.SourceFile[] = [];

  for (const property of presentations.properties) {
    const expression = propertyExpression(property);
    if (!expression) continue;
    for (const declaration of expressionDeclarations(checker, expression)) {
      const source = declaration.getSourceFile();
      if (source.isDeclarationFile || !inside(root, source.fileName)) continue;
      pending.push(source);
    }
  }

  while (pending.length) {
    const source = pending.pop()!;
    const file = resolve(source.fileName);
    if (sources.has(file)) continue;
    sources.add(file);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
      if (
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
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

function propertyExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
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
  programs: UnassembledProgramIR[],
  at: ts.Node = values!,
): void {
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const path = parent ? `${parent}.${name}` : name;
    const location = symbol.valueDeclaration ?? at;
    const contract = checker.getTypeOfSymbolAtLocation(symbol, location);
    const value = values ? resolveObjectMember(checker, values, name) : undefined;
    if (values && !value)
      throw diagnostic(values, `Feature ${JSON.stringify(path)} has no implementation.`);
    const featureValue = value ? objectExpression(checker, value) : undefined;
    const featureLocation = value ?? location;
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
        const expandedProgram =
          value && !featureValue
            ? (resolveStaticPath(checker, value, ["programs", programName]) ??
              resolveStaticPathFromArguments(checker, value, ["programs", programName]))
            : undefined;
        const expandedStart = expandedProgram
          ? resolveStaticMember(checker, expandedProgram, "start")
          : undefined;
        programs.push(
          extractProgram(
            checker,
            programContract,
            programValue,
            path,
            programName,
            featureLocation,
            Boolean((value && !featureValue) || (implementation && !programValue)),
            value,
            expandedProgram,
            expandedStart,
          ),
        );
        programIds.push(id);
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
        programs,
        featureLocation,
      );
    }

    features.push({
      id: `feature/${path}`,
      path,
      children: childIds.sort(),
      programs: programIds.sort(),
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
  featureSource?: ts.Expression,
  expandedProgram?: StaticValue,
  expandedStart?: StaticValue,
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
  const start =
    (value ? objectMemberDeclaration(value, "start") : undefined) ??
    functionNode(expandedStart?.node);
  const root = stringMember(checker, readableValue, "root");
  const featureImplementation =
    platform === "server" && featureSource
      ? portableFeatureImplementation(checker, featureSource, name, feature)
      : undefined;
  const implementation = featureImplementation
    ? ({ kind: "portable-feature", feature: featureImplementation } as const)
    : programImplementation(
        checker,
        start,
        Boolean(state || actions || components),
        factory && !expandedProgram,
        location,
        expandedStart?.bindings,
      );

  return {
    id: `feature/${feature}/program/${name}`,
    feature,
    name,
    environment: { name: environmentName, platform, ...(ui ? { ui } : {}) },
    requires: capabilityList(
      checker,
      propertyType(checker, contract, "Requires", location),
      location,
    ),
    provides: capabilityList(
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
    span: spanOf(location),
  };
}

function portableFeatureImplementation(
  checker: ts.TypeChecker,
  source: ts.Expression,
  program: string,
  feature: string,
):
  | Extract<ProgramContributionIR["implementation"], { kind: "portable-feature" }>["feature"]
  | undefined {
  const invocation = featureFactoryInvocation(checker, source, program, new Set());
  if (!invocation || invocation.program !== "server") return undefined;
  const implementation = objectExpression(checker, invocation.call.arguments[0]);
  if (!implementation) {
    throw diagnostic(invocation.call, `${invocation.name} requires a compiler-readable object.`);
  }
  const name = stringMember(checker, implementation, "name");
  if (!name) throw diagnostic(implementation, `${invocation.name} requires a literal name.`);
  const lowering = createPortableLowering(checker);

  if (invocation.name === "createIdentity") {
    const project = lowerFeatureFunction(
      lowering,
      implementation,
      "principal",
      `feature/${feature}/identity/project`,
    );
    return {
      kind: "identity",
      name,
      principal: project.result,
      project,
      functions: [...lowering.functions.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    };
  }

  if (invocation.name === "createEntity") {
    const modelNode = invocation.call.typeArguments?.[0];
    if (!modelNode) {
      throw diagnostic(
        invocation.call,
        "Portable entity Features require an explicit semantic model type argument.",
      );
    }
    const model = checker.getTypeFromTypeNode(modelNode);
    const modelType = (field: string): TypeIR => {
      const value = propertyType(checker, model, field, modelNode);
      if (!value) throw diagnostic(modelNode, `Entity model requires ${field}.`);
      return lowerType(checker, value, modelNode, new Set(), `Entity.${field}`);
    };
    const create = lowerFeatureFunction(
      lowering,
      implementation,
      "create",
      `feature/${feature}/entity/create`,
    );
    const update = lowerFeatureFunction(
      lowering,
      implementation,
      "update",
      `feature/${feature}/entity/update`,
    );
    const authorize = lowerFeatureFunction(
      lowering,
      implementation,
      "authorize",
      `feature/${feature}/entity/authorize`,
    );
    const matchesMember = objectMemberDeclaration(implementation, "matches");
    const matches = matchesMember
      ? lowerFeatureFunction(
          lowering,
          implementation,
          "matches",
          `feature/${feature}/entity/matches`,
        )
      : undefined;
    return {
      kind: "entity",
      name,
      principal: modelType("Principal"),
      value: modelType("Value"),
      createInput: modelType("Create"),
      updateInput: modelType("Update"),
      filter: modelType("Filter"),
      create,
      update,
      authorize,
      ...(matches ? { matches } : {}),
      functions: [...lowering.functions.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    };
  }
  return undefined;
}

function lowerFeatureFunction(
  lowering: PortableLowering,
  implementation: ts.ObjectLiteralExpression,
  name: string,
  id: string,
): FunctionIR {
  const member = objectMemberDeclaration(implementation, name);
  const functionLike = member ? functionFromMember(member) : undefined;
  if (!functionLike) {
    throw diagnostic(implementation, `Portable Feature implementation requires ${name}().`);
  }
  return lowerFunction(lowering, functionLike, {
    id,
    name,
    capabilitiesName: "@capabilities",
  });
}

type FeatureFactoryInvocation = Readonly<{
  name: "createEntity" | "createIdentity";
  call: ts.CallExpression;
  program: string;
}>;

function featureFactoryInvocation(
  checker: ts.TypeChecker,
  source: ts.Expression,
  program: string,
  active: Set<ts.Node>,
): FeatureFactoryInvocation | undefined {
  const expression = unwrapExpression(source);
  if (active.has(expression)) return undefined;
  active.add(expression);
  try {
    if (ts.isIdentifier(expression)) {
      const resolved = resolveIdentifier(checker, expression);
      return featureFactoryInvocation(checker, resolved, program, active);
    }
    if (!ts.isCallExpression(expression)) return undefined;
    const name = callName(checker, expression);
    if (name === "placePrograms") {
      const feature = expression.arguments[0];
      const placement = objectExpression(checker, expression.arguments[1]);
      if (!feature || !placement) return undefined;
      const logical = placement.properties.find((property) => {
        const value =
          ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
            ? property.initializer.text
            : undefined;
        return value === program;
      });
      return featureFactoryInvocation(
        checker,
        feature,
        (logical ? memberName(logical) : undefined) ?? program,
        active,
      );
    }
    if (name === "createEntity" || name === "createIdentity") {
      return { name, call: expression, program };
    }
    return undefined;
  } finally {
    active.delete(expression);
  }
}

function callName(checker: ts.TypeChecker, call: ts.CallExpression): string | undefined {
  const target = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  if (!ts.isIdentifier(target)) return undefined;
  let symbol = checker.getSymbolAtLocation(target);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
    symbol = checker.getAliasedSymbol(symbol);
  return symbol?.getName() ?? target.text;
}

function programImplementation(
  checker: ts.TypeChecker,
  start: ts.ObjectLiteralElementLike | ts.FunctionLikeDeclaration | undefined,
  ui: boolean,
  factory: boolean,
  at: ts.Node,
  bindings: ReadonlyMap<ts.Symbol, StaticValue> = new Map(),
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
  const lowering = createPortableLowering(checker, bindings);
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
      error instanceof ApplicationDiagnostic &&
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

function capabilityList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  at: ts.Node,
): CapabilityIR[] {
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
): TypeIR {
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
  const native = nativeTypeName(type);
  if (native) return { kind: "opaque", name: native };
  if (type.isUnion()) {
    const defined = type.types.filter((item) => !(item.flags & ts.TypeFlags.Undefined));
    if (defined.length === 1 && defined.length !== type.types.length) {
      return { kind: "option", value: lowerType(checker, defined[0]!, at, active, path) };
    }
    return {
      kind: "union",
      variants: type.types.map((item, index) =>
        lowerType(checker, item, at, active, `${path}[${index}]`),
      ),
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
          .map((item, index) => lowerType(checker, item, at, active, `${path}[${index}]`)),
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
        ),
      };
    }
    if (type.symbol?.getName() === "Promise" && type.aliasTypeArguments?.[0]) {
      return {
        kind: "promise",
        value: lowerType(checker, type.aliasTypeArguments[0], at, active, `${path}.result`),
      };
    }
    if (type.symbol?.getName() === "Promise") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) {
        return {
          kind: "promise",
          value: lowerType(checker, argument, at, active, `${path}.result`),
        };
      }
    }
    if (type.symbol?.getName() === "AsyncIterable") {
      const argument = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (argument) {
        return {
          kind: "stream",
          element: lowerType(checker, argument, at, active, `${path}.item`),
        };
      }
    }
    const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
    if (signatures.length === 1 && type.getProperties().length === 0) {
      const signature = signatures[0]!;
      return {
        kind: "function",
        parameters: signature.parameters.map((parameter) => ({
          name: parameter.getName(),
          optional: Boolean(parameter.flags & ts.SymbolFlags.Optional),
          type: lowerType(
            checker,
            fieldValueType(
              checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration ?? at),
              Boolean(parameter.flags & ts.SymbolFlags.Optional),
            ),
            at,
            active,
            `${path}.${parameter.getName()}`,
          ),
        })),
        result: lowerType(checker, signature.getReturnType(), at, active, `${path}.result`),
      };
    }
    const fields: FieldIR[] = sortedSymbols(type.getProperties()).map((symbol) => {
      const optional = Boolean(symbol.flags & ts.SymbolFlags.Optional);
      return {
        name: symbol.getName(),
        optional,
        type: lowerType(
          checker,
          fieldValueType(
            checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at),
            optional,
          ),
          at,
          active,
          `${path}.${symbol.getName()}`,
        ),
      };
    });
    return { kind: "record", fields };
  } finally {
    active.delete(type);
  }
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
  typeOverrides: Map<ts.Symbol, ts.Type>;
  staticBindings: ReadonlyMap<ts.Symbol, StaticValue>;
}>;

function createPortableLowering(
  checker: ts.TypeChecker,
  staticBindings: ReadonlyMap<ts.Symbol, StaticValue> = new Map(),
): PortableLowering {
  return {
    checker,
    functions: new Map(),
    active: new Set(),
    typeOverrides: new Map(),
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
    capabilitiesName: capabilityBinding(functionLike.parameters[0]) ?? "@capabilities",
    omitFirstParameter: true,
  });
}

function lowerFunction(
  lowering: PortableLowering,
  functionLike: ts.FunctionLikeDeclaration,
  options: Readonly<{
    id: string;
    name: string;
    capabilitiesName: string;
    omitFirstParameter?: boolean;
    signature?: ts.Signature;
    parameterTypes?: readonly ts.Type[];
    resultType?: ts.Type;
  }>,
): FunctionIR {
  if (!functionLike.body) throw diagnostic(functionLike, "Portable functions require a body.");
  validatePortableBindings(functionLike);
  const asynchronous = Boolean(
    functionLike.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword),
  );
  if (asynchronous && options.id !== "start") {
    throw diagnostic(functionLike, "Portable helper functions must be synchronous in profile v0.");
  }
  const signature = options.signature ?? lowering.checker.getSignatureFromDeclaration(functionLike);
  if (!signature) throw diagnostic(functionLike, "Cannot resolve portable function signature.");
  const sourceParameters = options.omitFirstParameter
    ? functionLike.parameters.slice(1)
    : functionLike.parameters;
  const signatureParameters = options.omitFirstParameter
    ? signature.parameters.slice(1)
    : signature.parameters;
  const parameters = sourceParameters.map((parameter, index): FieldIR => {
    if (!ts.isIdentifier(parameter.name)) {
      throw diagnostic(parameter, "Portable helper parameters must be named bindings.");
    }
    const symbol = signatureParameters[index];
    return {
      name: parameter.name.text,
      optional: Boolean(parameter.questionToken || parameter.initializer),
      type: lowerType(
        lowering.checker,
        fieldValueType(
          options.parameterTypes?.[index] ??
            (symbol
              ? lowering.checker.getTypeOfSymbolAtLocation(
                  symbol,
                  symbol.valueDeclaration ?? parameter,
                )
              : lowering.checker.getTypeAtLocation(parameter)),
          Boolean(parameter.questionToken || parameter.initializer),
        ),
        parameter,
      ),
    };
  });
  const declaredResult = lowerType(
    lowering.checker,
    options.resultType ?? signature.getReturnType(),
    functionLike,
  );
  const overrides: Array<Readonly<{ symbol: ts.Symbol; previous?: ts.Type }>> = [];
  for (const [index, parameter] of sourceParameters.entries()) {
    const type = options.parameterTypes?.[index];
    if (!type || !ts.isIdentifier(parameter.name)) continue;
    const symbol = lowering.checker.getSymbolAtLocation(parameter.name);
    if (!symbol) continue;
    overrides.push({ symbol, previous: lowering.typeOverrides.get(symbol) });
    lowering.typeOverrides.set(symbol, type);
  }
  let body: StatementIR[];
  try {
    body = ts.isBlock(functionLike.body)
      ? lowerStatements(lowering, functionLike.body.statements, options.capabilitiesName)
      : [
          {
            kind: "return",
            value: lowerExpression(lowering, functionLike.body, options.capabilitiesName),
            span: spanOf(functionLike.body),
          },
        ];
  } finally {
    for (const { symbol, previous } of overrides.reverse()) {
      if (previous) lowering.typeOverrides.set(symbol, previous);
      else lowering.typeOverrides.delete(symbol);
    }
  }
  return {
    id: options.id,
    name: options.name,
    asynchronous,
    parameters,
    result:
      asynchronous && declaredResult.kind === "promise" ? declaredResult.value : declaredResult,
    body,
    span: spanOf(functionLike),
  };
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
  capabilitiesName: string,
): StatementIR[] {
  return statements.flatMap((statement): StatementIR | readonly StatementIR[] => {
    const span = spanOf(statement);
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.map((declaration): StatementIR => {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          throw diagnostic(declaration, "Portable bindings require a name and initializer.");
        }
        return {
          kind: "let",
          name: declaration.name.text,
          mutable: (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          value: lowerExpression(lowering, declaration.initializer, capabilitiesName),
          span: spanOf(declaration),
        };
      });
    }
    if (ts.isExpressionStatement(statement)) {
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
          value: lowerExpression(lowering, statement.expression.right, capabilitiesName),
          span,
        };
      }
      return {
        kind: "expression",
        expression: lowerExpression(lowering, statement.expression, capabilitiesName),
        span,
      };
    }
    if (ts.isIfStatement(statement)) {
      return {
        kind: "if",
        condition: booleanExpression(lowering, statement.expression, capabilitiesName),
        consequent: lowerStatementBody(lowering, statement.thenStatement, capabilitiesName),
        alternate: statement.elseStatement
          ? lowerStatementBody(lowering, statement.elseStatement, capabilitiesName)
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
      const values = lowerExpression(lowering, statement.expression, capabilitiesName);
      if (values.type.kind !== "array") {
        throw diagnostic(statement.expression, "Portable for-of requires an array value.");
      }
      return {
        kind: "for-of",
        item: declaration.name.text,
        values,
        body: lowerStatementBody(lowering, statement.statement, capabilitiesName),
        span,
      };
    }
    if (ts.isReturnStatement(statement)) {
      return {
        kind: "return",
        ...(statement.expression
          ? { value: lowerExpression(lowering, statement.expression, capabilitiesName) }
          : {}),
        span,
      };
    }
    if (ts.isBlock(statement))
      return lowerStatements(lowering, statement.statements, capabilitiesName);
    throw diagnostic(statement, `Unsupported portable statement ${ts.SyntaxKind[statement.kind]}.`);
  });
}

function lowerStatementBody(
  lowering: PortableLowering,
  statement: ts.Statement,
  capabilitiesName: string,
): StatementIR[] {
  return ts.isBlock(statement)
    ? lowerStatements(lowering, statement.statements, capabilitiesName)
    : lowerStatements(lowering, [statement], capabilitiesName);
}

function lowerExpression(
  lowering: PortableLowering,
  node: ts.Expression,
  capabilitiesName: string,
): ExpressionIR {
  const { checker } = lowering;
  const expression = unwrapExpression(node);
  if (ts.isAwaitExpression(expression)) {
    const call = lowerCapabilityCall(lowering, expression.expression, capabilitiesName, true);
    if (!call) throw diagnostic(expression, "Only Capability calls may be awaited.");
    return typedExpression(lowering, expression, { ...call, awaited: true });
  }
  const capabilityCall = lowerCapabilityCall(lowering, expression, capabilitiesName, false);
  if (capabilityCall) return typedExpression(lowering, expression, capabilityCall);
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
    const symbol = checker.getSymbolAtLocation(expression);
    const binding = symbol ? lowering.staticBindings.get(symbol) : undefined;
    if (binding?.node && ts.isExpression(binding.node)) {
      return lowerExpression(lowering, binding.node, capabilitiesName);
    }
    return typedExpression(lowering, expression, { kind: "local", name: expression.text });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "array",
      values: expression.elements.map((item) => lowerExpression(lowering, item, capabilitiesName)),
    });
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "record",
      fields: expression.properties.map((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          return {
            name: property.name.text,
            value: lowerExpression(lowering, property.name, capabilitiesName),
          };
        }
        if (!ts.isPropertyAssignment(property)) {
          throw diagnostic(property, "Portable records require explicit properties.");
        }
        return {
          name: memberName(property)!,
          value: lowerExpression(lowering, property.initializer, capabilitiesName),
        };
      }),
    });
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return typedExpression(lowering, expression, {
      kind: "property",
      value: lowerExpression(lowering, expression.expression, capabilitiesName),
      name: expression.name.text,
    });
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = binaryOperator(expression.operatorToken);
    if (!operator) throw diagnostic(expression.operatorToken, "Unsupported portable operator.");
    validateBinaryExpression(checker, expression, operator);
    return typedExpression(lowering, expression, {
      kind: "binary",
      operator,
      left: lowerExpression(lowering, expression.left, capabilitiesName),
      right: lowerExpression(lowering, expression.right, capabilitiesName),
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
      requireType(checker, expression.operand, "boolean", "Logical negation requires boolean.");
    } else {
      requireType(checker, expression.operand, "number", "Numeric negation requires number.");
    }
    return typedExpression(lowering, expression, {
      kind: "unary",
      operator: expression.operator === ts.SyntaxKind.ExclamationToken ? "!" : "-",
      value: lowerExpression(lowering, expression.operand, capabilitiesName),
    });
  }
  if (ts.isCallExpression(expression)) {
    return lowerPureCall(lowering, expression, capabilitiesName);
  }
  throw diagnostic(
    expression,
    `Unsupported portable expression ${ts.SyntaxKind[expression.kind]}.`,
  );
}

function lowerCapabilityCall(
  lowering: PortableLowering,
  node: ts.Expression,
  capabilitiesName: string,
  awaited: boolean,
): Extract<ExpressionIR, { kind: "capability-call" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const operation = node.expression.name.text;
  const owner = node.expression.expression;
  if (!ts.isPropertyAccessExpression(owner) || !ts.isIdentifier(owner.expression)) return undefined;
  if (owner.expression.text !== capabilitiesName) return undefined;
  const argument = node.arguments[0];
  const argumentType = argument
    ? lowerType(lowering.checker, lowering.checker.getTypeAtLocation(argument), argument)
    : undefined;
  if (node.arguments.length !== 1 || argumentType?.kind !== "record") {
    throw diagnostic(node, "Portable Capability operations require one object argument.");
  }
  const result = lowering.checker.getTypeAtLocation(node);
  const promise = isPromiseType(lowering.checker, result);
  if (promise !== awaited) {
    throw diagnostic(
      node,
      promise
        ? "Asynchronous Capability operations must be awaited."
        : "Synchronous Capability operations cannot be awaited.",
    );
  }
  return {
    kind: "capability-call",
    capability: owner.name.text,
    operation,
    arguments: node.arguments.map((argument) =>
      lowerExpression(lowering, argument, capabilitiesName),
    ),
    awaited,
    type: lowerType(lowering.checker, result, node),
    span: spanOf(node),
  };
}

function typedExpression(
  lowering: PortableLowering,
  node: ts.Expression,
  value: ExpressionValueIR,
): ExpressionIR {
  const symbol = ts.isIdentifier(node) ? lowering.checker.getSymbolAtLocation(node) : undefined;
  return {
    ...value,
    type: lowerType(
      lowering.checker,
      (symbol && lowering.typeOverrides.get(symbol)) ?? lowering.checker.getTypeAtLocation(node),
      node,
    ),
    span: spanOf(node),
  } as ExpressionIR;
}

function booleanExpression(
  lowering: PortableLowering,
  node: ts.Expression,
  capabilitiesName: string,
): ExpressionIR {
  requireType(lowering.checker, node, "boolean", "Portable conditions require boolean.");
  return lowerExpression(lowering, node, capabilitiesName);
}

function lowerPureCall(
  lowering: PortableLowering,
  call: ts.CallExpression,
  capabilitiesName: string,
): ExpressionIR {
  if (!ts.isIdentifier(call.expression)) {
    throw diagnostic(
      call.expression,
      "Portable helper calls must resolve to an authored function name.",
    );
  }
  let symbol = lowering.checker.getSymbolAtLocation(call.expression);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = lowering.checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.declarations?.find(
    (candidate) => ts.isFunctionDeclaration(candidate) || ts.isVariableDeclaration(candidate),
  );
  const functionLike = declaration ? functionFromDeclaration(declaration) : undefined;
  const signature = lowering.checker.getResolvedSignature(call);
  if (!symbol || !functionLike || !signature) {
    throw diagnostic(
      call,
      "Portable code may call only authored pure functions or declared Capabilities.",
    );
  }
  if (isPromiseType(lowering.checker, signature.getReturnType())) {
    throw diagnostic(call, "Portable helper functions must be synchronous in profile v0.");
  }
  const parameterTypes = call.arguments.map((argument) =>
    lowering.checker.getTypeAtLocation(argument),
  );
  const resultType = lowering.checker.getTypeAtLocation(call);
  const id = portableFunctionId(lowering.checker, symbol, functionLike, parameterTypes);
  if (!lowering.functions.has(id)) {
    if (lowering.active.has(id)) {
      throw diagnostic(call, "Recursive portable functions are not supported in profile v0.");
    }
    lowering.active.add(id);
    try {
      lowering.functions.set(
        id,
        lowerFunction(lowering, functionLike, {
          id,
          name: symbol.getName(),
          capabilitiesName: "@capabilities",
          signature,
          parameterTypes,
          resultType,
        }),
      );
    } finally {
      lowering.active.delete(id);
    }
  }
  return typedExpression(lowering, call, {
    kind: "call",
    function: id,
    arguments: call.arguments.map((argument) =>
      lowerExpression(lowering, argument, capabilitiesName),
    ),
  });
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

function capabilityBinding(parameter: ts.ParameterDeclaration | undefined): string | undefined {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  for (const binding of parameter.name.elements) {
    const source = binding.propertyName ? memberName(binding) : memberName(binding);
    if (source === "capabilities" && ts.isIdentifier(binding.name)) return binding.name.text;
  }
  return undefined;
}

function applicationContractNode(expression: ts.Expression): ts.TypeNode | undefined {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (!ts.isSatisfiesExpression(current)) return undefined;
  if (!ts.isTypeReferenceNode(current.type) || current.type.typeArguments?.length !== 1)
    return current.type;
  return current.type.typeArguments[0];
}

function presentationNames(checker: ts.TypeChecker, contract: ts.Type, at: ts.Node): string[] {
  const presentations = propertyType(checker, contract, "Presentations", at);
  if (!presentations) return [];
  if (presentations.flags & ts.TypeFlags.StringLiteral) {
    return [(presentations as ts.StringLiteralType).value];
  }
  if (presentations.isUnion()) {
    return presentations.types
      .filter((type): type is ts.StringLiteralType =>
        Boolean(type.flags & ts.TypeFlags.StringLiteral),
      )
      .map((type) => type.value)
      .sort();
  }
  return sortedSymbols(presentations.getProperties()).map((symbol) => symbol.getName());
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
): "=" | "+=" | "-=" | "*=" | "/=" | undefined {
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

function resolveIdentifier(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Expression {
  return resolveSymbol(checker, checker.getSymbolAtLocation(identifier), identifier);
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
}>;

function resolveStaticPath(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  path: readonly string[],
): StaticValue | undefined {
  let value = resolveStaticValue(checker, { node: expression, bindings: new Map() }, new Set());
  for (const name of path) {
    if (!value) return undefined;
    value = resolveStaticMember(checker, value, name);
  }
  return value;
}

function resolveStaticPathFromArguments(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  path: readonly string[],
): StaticValue | undefined {
  const node = unwrapExpression(expression);
  if (!ts.isCallExpression(node)) return undefined;
  for (const argument of node.arguments) {
    const value = resolveStaticPath(checker, argument, path);
    if (value) return value;
  }
  return undefined;
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
          { node: member.initializer, bindings: value.bindings },
          new Set(),
        );
      }
      if (ts.isShorthandPropertyAssignment(member)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(member);
        const bound = symbol ? value.bindings.get(symbol) : undefined;
        if (bound) return resolveStaticValue(checker, bound, new Set());
        return resolveStaticValue(
          checker,
          { node: member.name, bindings: value.bindings },
          new Set(),
        );
      }
      if (ts.isMethodDeclaration(member)) return { node: member, bindings: value.bindings };
    }
    for (const property of [...value.node.properties].reverse()) {
      if (!ts.isSpreadAssignment(property)) continue;
      const spread = resolveStaticValue(
        checker,
        { node: property.expression, bindings: value.bindings },
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
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      const bound = symbol ? source.bindings.get(symbol) : undefined;
      if (bound) return resolveStaticValue(checker, bound, active);
      const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer
        ? resolveStaticValue(
            checker,
            { node: declaration.initializer, bindings: source.bindings },
            active,
          )
        : undefined;
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = resolveStaticValue(
        checker,
        { node: node.expression, bindings: source.bindings },
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
        bindings.set(symbol, { node: argument, bindings: source.bindings });
      }
      const returned = staticFunctionResult(checker, functionLike, bindings);
      return returned ? resolveStaticValue(checker, returned, active) : undefined;
    }
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      return { node, bindings: source.bindings };
    }
    return undefined;
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

function staticFunctionResult(
  checker: ts.TypeChecker,
  functionLike: ts.FunctionLikeDeclaration,
  initialBindings: ReadonlyMap<ts.Symbol, StaticValue>,
): StaticValue | undefined {
  if (!functionLike.body) return undefined;
  if (!ts.isBlock(functionLike.body)) {
    return { node: functionLike.body, bindings: initialBindings };
  }
  const bindings = new Map(initialBindings);
  for (const statement of functionLike.body.statements) {
    if (ts.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return undefined;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
        const symbol = checker.getSymbolAtLocation(declaration.name);
        if (!symbol) return undefined;
        bindings.set(symbol, { node: declaration.initializer, bindings: new Map(bindings) });
      }
      continue;
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      return { node: statement.expression, bindings };
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
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return objectExpression(checker, resolveIdentifier(checker, unwrapped));
  }
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
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
  return undefined;
}

function spanOf(node: ts.Node): SourceSpan {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName, line: position.line + 1, column: position.character + 1 };
}

function diagnostic(node: ts.Node, message: string): ApplicationDiagnostic {
  return new ApplicationDiagnostic(message, spanOf(node));
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

function normalizeSourceFiles(ir: ApplicationIR, root: string): ApplicationIR {
  const normalizeSpan = (span: SourceSpan): SourceSpan => ({
    ...span,
    file: relative(root, span.file).replaceAll("\\", "/"),
  });
  const normalizeFunctionId = (id: string): string => {
    const match = /^function\/(.+):(\d+):(\d+)\/(.+)$/.exec(id);
    if (!match) return id;
    return `function/${relative(root, match[1]!).replaceAll("\\", "/")}:${match[2]}:${match[3]}/${match[4]}`;
  };
  const normalizeExpression = (expression: ExpressionIR): ExpressionIR => {
    const span = normalizeSpan(expression.span);
    switch (expression.kind) {
      case "array":
        return { ...expression, values: expression.values.map(normalizeExpression), span };
      case "record":
        return {
          ...expression,
          fields: expression.fields.map((field) => ({
            ...field,
            value: normalizeExpression(field.value),
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
      case "call":
        return {
          ...expression,
          function: normalizeFunctionId(expression.function),
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "capability-call":
        return {
          ...expression,
          arguments: expression.arguments.map(normalizeExpression),
          span,
        };
      case "literal":
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
      if (statement.kind === "let" || statement.kind === "assign") {
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
  const normalizeFeatureImplementation = (
    feature: Extract<
      ProgramContributionIR["implementation"],
      { kind: "portable-feature" }
    >["feature"],
  ): typeof feature =>
    feature.kind === "identity"
      ? {
          ...feature,
          project: normalizeFunction(feature.project),
          functions: feature.functions.map(normalizeFunction),
        }
      : {
          ...feature,
          create: normalizeFunction(feature.create),
          update: normalizeFunction(feature.update),
          authorize: normalizeFunction(feature.authorize),
          ...(feature.matches ? { matches: normalizeFunction(feature.matches) } : {}),
          functions: feature.functions.map(normalizeFunction),
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
            : contribution.implementation.kind === "portable-feature"
              ? {
                  kind: "portable-feature",
                  feature: normalizeFeatureImplementation(contribution.implementation.feature),
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
