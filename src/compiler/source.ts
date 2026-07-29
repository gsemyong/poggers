import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import * as ts from "@typescript/typescript6";

import type {
  FeatureSourceContext,
  InterfaceSourceContext,
  PortableCallCompilation,
  ProgramSourceContext,
  SourceCompilerAPI,
  SourceCompilerExtension,
  SourceDialectCompilation,
  SystemSourceContext,
} from "@/compiler/extension";
import {
  SYSTEM_IR_VERSION,
  type DependencyIR,
  type DependencyProviderIR,
  type CompilerExtensionsIR,
  type ExtensionIR,
  type ExpressionIR,
  type ExpressionValueIR,
  type FeatureIR,
  type FieldIR,
  type FunctionIR,
  type PlatformInterfaceIR,
  type SystemIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SourceSpan,
  type StatementIR,
  type SystemCompilationWork,
  type SystemOutputSources,
  type TypeIR,
} from "@/compiler/ir";

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

export type { SystemOutputSources } from "@/compiler/ir";

export type SystemCompilation = Readonly<{
  ir: SystemIR;
  outputSources: SystemOutputSources;
  sourceFiles: readonly string[];
  semanticGraph: SystemSemanticGraph;
  work: SystemCompilationWork;
}>;

export type SystemCompiler = Readonly<{
  prepare(): void;
  restore(compilation: SystemCompilation): void;
  compile(changedFile?: string): SystemCompilation;
}>;

type FeatureCompilationUnit = Readonly<{
  id: string;
  hash: string;
  sourceFiles: readonly string[];
  features: readonly FeatureIR[];
  featureSourceFiles: Readonly<Record<string, readonly string[]>>;
  programs: readonly UnassembledProgramIR[];
  interfaces: readonly InterfaceSource[];
}>;

export type SystemSemanticGraph = Readonly<{
  version: 1;
  features: readonly FeatureCompilationUnit[];
}>;

const SYSTEM_COMPILER_CACHE_VERSION = 4;

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
  const file = resolve(entry);
  const program = ts.createProgram({
    rootNames: [file],
    options: compilerOptions(file),
  });
  return compileSystemProgram(file, program, undefined, extensions).ir;
}

/** Compiles an in-memory source overlay without changing module resolution. */
export function compileSystemSources(
  entry: string,
  sources: Readonly<Record<string, string>>,
  extensions: readonly SourceCompilerExtension[] = [],
): SystemIR {
  const file = resolve(entry);
  const options = compilerOptions(file);
  const overlay = new Map(
    Object.entries(sources).map(([path, source]) => [resolve(path), source] as const),
  );
  const overlayDirectories = new Set<string>();
  for (const path of overlay.keys()) {
    let directory = dirname(path);
    while (!overlayDirectories.has(directory)) {
      overlayDirectories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  if (!overlay.has(file)) {
    throw new Error(`In-memory System source ${file} is missing.`);
  }
  const fallback = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...fallback,
    fileExists(path) {
      return overlay.has(resolve(path)) || fallback.fileExists(path);
    },
    readFile(path) {
      return overlay.get(resolve(path)) ?? fallback.readFile(path);
    },
    directoryExists(path) {
      return overlayDirectories.has(resolve(path)) || fallback.directoryExists?.(path) === true;
    },
    getDirectories(path) {
      const directory = resolve(path);
      return [
        ...new Set([
          ...(fallback.getDirectories?.(path) ?? []),
          ...[...overlayDirectories].filter(
            (candidate) => candidate !== directory && dirname(candidate) === directory,
          ),
        ]),
      ];
    },
    realpath(path) {
      const absolute = resolve(path);
      return overlay.has(absolute) || overlayDirectories.has(absolute)
        ? absolute
        : (fallback.realpath?.(path) ?? absolute);
    },
    getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile) {
      const source = overlay.get(resolve(path));
      return source === undefined
        ? fallback.getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(path, source, languageVersion, true);
    },
  };
  const program = ts.createProgram({
    rootNames: [file],
    options,
    host,
  });
  return compileSystemProgram(file, program, undefined, extensions).ir;
}

/** Retains TypeScript's semantic graph across development compilations. */
export function createSystemCompiler(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = [],
): SystemCompiler {
  const file = resolve(entry);
  const options = compilerOptions(file);
  const versions = new Map<string, number>();
  let projectVersion = 0;
  const service = ts.createLanguageService(
    {
      getCompilationSettings: () => options,
      getCurrentDirectory: () => dirname(file),
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      getDirectories: ts.sys.getDirectories,
      getNewLine: () => ts.sys.newLine,
      getProjectVersion: () => String(projectVersion),
      getScriptFileNames: () => [file],
      getScriptSnapshot(path) {
        const source = ts.sys.readFile(path);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: (path) => String(versions.get(resolve(path)) ?? 0),
      readDirectory: ts.sys.readDirectory,
      readFile: ts.sys.readFile,
      fileExists: ts.sys.fileExists,
      directoryExists: ts.sys.directoryExists,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    },
    ts.createDocumentRegistry(),
  );
  const program = (): ts.Program => {
    const current = service.getProgram();
    if (!current) throw new Error(`Cannot create the semantic Program for ${file}.`);
    return current;
  };
  let previous: SystemCompilation | undefined;
  let restored = false;
  return {
    prepare() {
      program();
    },
    restore(compilation) {
      previous = compilation;
      restored = true;
    },
    compile(changedFile) {
      if (changedFile) {
        const changed = resolve(changedFile);
        versions.set(changed, (versions.get(changed) ?? 0) + 1);
        projectVersion++;
      }
      const compilation = compileSystemProgram(
        file,
        program(),
        changedFile,
        extensions,
        previous,
        changedFile !== undefined || restored,
      );
      previous = compilation;
      restored = false;
      return compilation;
    },
  };
}

/** @internal Identifies every implementation that can change compiled System meaning. */
export function systemCompilerIdentity(
  extensions: readonly SourceCompilerExtension[] = [],
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([SYSTEM_COMPILER_CACHE_VERSION, SYSTEM_IR_VERSION, ts.version]));
  hash.update("\0");
  const extension = extname(import.meta.filename);
  for (const name of ["source", "ir", "extension"]) {
    const file = resolve(dirname(import.meta.filename), `${name}${extension}`);
    hash.update(ts.sys.readFile(file) ?? file);
    hash.update("\0");
  }
  for (const compiler of extensions) {
    hash.update(compiler.name);
    hash.update("\0");
    for (const source of compiler.cacheSources ?? []) {
      hash.update(ts.sys.readFile(source) ?? source);
      hash.update("\0");
    }
    for (const hook of [
      compiler.system,
      compiler.feature,
      compiler.constant,
      compiler.call,
      compiler.interface,
      compiler.program,
      compiler.validate,
    ]) {
      hash.update(hook?.toString() ?? "");
      hash.update("\0");
    }
  }
  return hash.digest("hex");
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

function sourceCompilerAPI(
  program: ts.Program,
  checker: ts.TypeChecker,
  scope?: StaticValue,
  root?: string,
  extensions: readonly SourceCompilerExtension[] = [],
): SourceCompilerAPI {
  return Object.freeze({
    properties: (type) => sortedSymbols(type?.getProperties() ?? []),
    property: (type, name, at) => propertyType(checker, type, name, at),
    object(value) {
      const direct = objectExpression(checker, value);
      if (direct || !value) return direct;
      const resolved = resolveStaticValue(
        checker,
        {
          node: value,
          bindings: scope?.bindings ?? new Map(),
          types: scope?.types ?? new Map(),
        },
        new Set(),
      );
      return resolved?.node && ts.isExpression(resolved.node)
        ? objectExpression(checker, resolved.node)
        : undefined;
    },
    member: (object, name) => objectMember(checker, object, name),
    resolveMember(object, name) {
      const member = resolveObjectMember(checker, object, name);
      if (!member) return undefined;
      const resolved = resolveStaticValue(
        checker,
        {
          node: member,
          bindings: scope?.bindings ?? new Map(),
          types: scope?.types ?? new Map(),
        },
        new Set(),
      );
      return resolved?.node && ts.isExpression(resolved.node)
        ? unwrapExpression(resolved.node)
        : member;
    },
    callable(object, name) {
      const member = objectMemberDeclaration(object, name);
      const expression = objectMember(checker, object, name);
      const resolved = expression
        ? resolveStaticValue(
            checker,
            {
              node: expression,
              bindings: scope?.bindings ?? new Map(),
              types: scope?.types ?? new Map(),
            },
            new Set(),
          )
        : undefined;
      if (resolved?.node && isFunctionImplementation(resolved.node)) return resolved.node;
      return member && (isFunctionImplementation(member) || functionFromMember(member))
        ? member
        : undefined;
    },
    sources(value) {
      if (!root) throw diagnostic(value, "Source ownership requires a compiler root.");
      return Object.freeze(
        [
          ...transitiveLocalSources(
            program,
            checker,
            root,
            expressionDeclarations(checker, value).map((declaration) =>
              declaration.getSourceFile(),
            ),
          ),
        ]
          .sort()
          .map((path) => {
            const source = program.getSourceFile(path);
            if (!source) throw new Error(`Cannot read extension source ${path}.`);
            return Object.freeze({ path, text: source.text });
          }),
      );
    },
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
    numberLiteral: (type, name, at) => numberLiteralProperty(checker, type, name, at),
    lower: (type, at) => lowerType(checker, type, at),
    dependencies: (type, at) => dependencyList(checker, type, at),
    portable(declaration, options) {
      const functionLike = isFunctionImplementation(declaration)
        ? declaration
        : functionFromMember(declaration as ts.ObjectLiteralElementLike);
      if (!functionLike?.body) {
        throw diagnostic(declaration, "Portable functions require a statically known body.");
      }
      const contextParameter = options.context ? functionLike.parameters[0] : undefined;
      const providedBinding = options.context?.provides
        ? contextBindingSymbol(checker, contextParameter, options.context.provides)
        : undefined;
      const dependencyName = options.context
        ? (contextBindingName(contextParameter, options.context.dependencies) ?? "@dependencies")
        : (dependencyBinding(functionLike.parameters[0]) ?? "@dependencies");
      const lowering = createPortableLowering(
        checker,
        scope?.bindings,
        scope?.types,
        options.provides,
        (call, awaited, bindings, types) =>
          extensionConstant(program, checker, call, awaited, bindings, types, root, extensions),
        (call, awaited, bindings, types, type, span, lower) =>
          extensionPortableCall(
            program,
            checker,
            call,
            awaited,
            bindings,
            types,
            type,
            span,
            lower,
            root,
            extensions,
          ),
      );
      const entry = lowerFunction(
        {
          ...lowering,
          ...(providedBinding ? { providedBinding } : {}),
        },
        functionLike,
        {
          ...options,
          dependenciesName: dependencyName,
          ...(options.context ? { omitFirstParameter: true } : {}),
        },
      );
      const functions = [...lowering.functions.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const contextBindings = options.context
        ? [
            dependencyName,
            "@dependencies",
            options.context.dependencies,
            ...(options.context.provides ? [options.context.provides] : []),
          ]
        : [];
      validatePortableLocals(entry, contextBindings);
      functions.forEach((function_) => validatePortableLocals(function_));
      return {
        entry: root ? normalizePortableFunction(entry, root) : entry,
        functions: root
          ? functions.map((function_) => normalizePortableFunction(function_, root))
          : functions,
      };
    },
    emptyRecord,
    span: (node) => {
      const span = spanOf(node);
      return root ? { ...span, file: relative(root, span.file).replaceAll("\\", "/") } : span;
    },
    fail(node, message) {
      throw diagnostic(node, message);
    },
  });
}

function extensionPortableCall(
  program: ts.Program,
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  awaited: boolean,
  bindings: ReadonlyMap<ts.Symbol, StaticValue>,
  types: ReadonlyMap<ts.Type, ts.Type>,
  type: TypeIR,
  span: SourceSpan,
  lower: (expression: ts.Expression) => ExpressionIR,
  root: string | undefined,
  extensions: readonly SourceCompilerExtension[],
): PortableCallCompilation | undefined {
  const values: Readonly<{ name: string; value: PortableCallCompilation }>[] = extensions.flatMap(
    (extension) => {
      if (!extension.call) return [];
      const value = extension.call({
        checker,
        source: sourceCompilerAPI(
          program,
          checker,
          { node: call, bindings, types },
          root,
          extensions,
        ),
        call,
        awaited,
        type,
        span,
        lower,
        root: root ?? dirname(call.getSourceFile().fileName),
        resolve: (source) => substitutedType(source, types),
      });
      return value === undefined ? [] : [{ name: extension.name, value }];
    },
  );
  if (values.length > 1) {
    throw diagnostic(
      call,
      `Portable call is lowered by multiple compiler extensions: ${values
        .map(({ name }) => JSON.stringify(name))
        .join(", ")}.`,
    );
  }
  return values[0]?.value;
}

function extensionConstant(
  program: ts.Program,
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  awaited: boolean,
  bindings: ReadonlyMap<ts.Symbol, StaticValue>,
  types: ReadonlyMap<ts.Type, ts.Type>,
  root: string | undefined,
  extensions: readonly SourceCompilerExtension[],
): ExtensionIR | undefined {
  const values: Readonly<{ name: string; value: ExtensionIR }>[] = extensions.flatMap(
    (extension) => {
      if (!extension.constant) return [];
      const value = extension.constant({
        checker,
        source: sourceCompilerAPI(
          program,
          checker,
          { node: call, bindings, types },
          root,
          extensions,
        ),
        call,
        awaited,
        root: root ?? dirname(call.getSourceFile().fileName),
        resolve: (type) => substitutedType(type, types),
      });
      if (value === undefined) return [];
      assertExtensionIR(value, extension.name, new Set());
      return [{ name: extension.name, value }];
    },
  );
  if (values.length > 1) {
    throw diagnostic(
      call,
      `Portable call is claimed by multiple compiler extensions: ${values
        .map(({ name }) => JSON.stringify(name))
        .join(", ")}.`,
    );
  }
  return values[0]?.value;
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
  kind: "system" | "feature",
  context: SystemSourceContext | FeatureSourceContext,
): Readonly<{ extensions?: CompilerExtensionsIR }> {
  const values: Record<string, ExtensionIR> = Object.create(null);
  for (const extension of extensions) {
    const value =
      kind === "system"
        ? extension.system?.(context as SystemSourceContext)
        : extension.feature?.(context as FeatureSourceContext);
    if (value === undefined) continue;
    assertExtensionIR(value, extension.name, new Set());
    values[extension.name] = value;
  }
  return Object.keys(values).length ? { extensions: Object.freeze(values) } : {};
}

function dialectField(
  extensions: readonly SourceCompilerExtension[],
  kind: "interface",
  platform: string,
  context: InterfaceSourceContext,
): Readonly<{ extensions: CompilerExtensionsIR; extensionSources?: readonly string[] }>;
function dialectField(
  extensions: readonly SourceCompilerExtension[],
  kind: "program",
  platform: string,
  context: ProgramSourceContext,
): Readonly<{ extensions: CompilerExtensionsIR; extensionSources?: readonly string[] }>;
function dialectField(
  extensions: readonly SourceCompilerExtension[],
  kind: "interface" | "program",
  platform: string,
  context: InterfaceSourceContext | ProgramSourceContext,
): Readonly<{ extensions: CompilerExtensionsIR; extensionSources?: readonly string[] }> {
  const extension = extensions.find(({ name }) => name === platform);
  if (!extension) {
    throw new SystemDiagnostic(
      `Platform ${JSON.stringify(platform)} has no registered compiler dialect.`,
      spanOf(context.location),
    );
  }
  const compile = kind === "interface" ? extension.interface : extension.program;
  if (!compile) {
    throw new SystemDiagnostic(
      `Platform ${JSON.stringify(platform)} does not compile ${kind} meaning.`,
      spanOf(context.location),
    );
  }
  const result = compile(context as InterfaceSourceContext & ProgramSourceContext);
  assertDialectCompilation(result, platform, kind);
  return {
    extensions: Object.freeze({ [platform]: result.ir }),
    ...(result.sources?.length
      ? {
          extensionSources: Object.freeze(
            [...new Set(result.sources.map(canonicalSourceFile))].sort(),
          ),
        }
      : {}),
  };
}

function assertDialectCompilation(
  result: SourceDialectCompilation,
  platform: string,
  kind: "interface" | "program",
): void {
  assertExtensionIR(result.ir, platform, new Set());
  if (
    !result.ir ||
    typeof result.ir !== "object" ||
    Array.isArray(result.ir) ||
    !Number.isSafeInteger(result.ir.version) ||
    result.ir.version < 1
  ) {
    throw new TypeError(
      `Platform ${JSON.stringify(platform)} returned unversioned ${kind} meaning.`,
    );
  }
  if (result.sources?.some((source) => typeof source !== "string" || source.length === 0)) {
    throw new TypeError(
      `Platform ${JSON.stringify(platform)} returned invalid ${kind} source ownership.`,
    );
  }
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
  program: ts.Program,
  changedFile?: string,
  extensions: readonly SourceCompilerExtension[] = [],
  previous?: SystemCompilation,
  incremental = changedFile !== undefined,
): SystemCompilation {
  const compilationStarted = performance.now();
  validateCompilerExtensions(extensions);
  const file = resolve(entry);
  const configuration = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  const changedSource = changedFile ? program.getSourceFile(resolve(changedFile)) : undefined;
  const diagnostics = changedSource
    ? program.getSyntacticDiagnostics(changedSource)
    : ts.getPreEmitDiagnostics(program);
  const first = diagnostics.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (first) throw new Error(formatTypeScriptDiagnostic(first));
  const diagnosticsCompleted = performance.now();

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
  const applicationsValue = objectMember(checker, systemObject, "applications");
  if (!featuresValue && !applicationsValue) {
    throw diagnostic(systemObject, "The System must compose Features or Applications.");
  }
  const featureValues = featuresValue
    ? requireObject(checker, featuresValue, "System features must be an object.")
    : undefined;
  const applicationValues = applicationsValue
    ? requireObject(checker, applicationsValue, "System applications must be an object.")
    : undefined;

  const metadata = objectExpression(checker, objectMember(checker, systemObject, "metadata"));
  const systemName =
    stringMember(checker, metadata, "name") ?? source.fileName.split("/").at(-2) ?? "system";
  const root = dirname(file);
  const systemExtensions = extensionField(extensions, "system", {
    checker,
    source: sourceCompilerAPI(program, checker, undefined, undefined, extensions),
    contract,
    implementation: systemObject,
    location: exported,
    root,
  });
  const features: FeatureIR[] = [];
  const featureSourceFiles = new Map<string, ReadonlySet<string>>();
  const contributions: UnassembledProgramIR[] = [];
  const interfaceSources: InterfaceSource[] = [];
  const applicationSources: AppSource[] = [];
  const featureUnits: FeatureCompilationUnit[] = [];
  const work = {
    features: { compiled: 0, reused: 0 },
  };
  const extractionStarted = performance.now();
  const previousFeatures = new Map(previous?.semanticGraph.features.map((unit) => [unit.id, unit]));
  const featureCatalog = featureValues
    ? collectSystemFeatureCatalog(checker, featureValues)
    : new Map<string, SystemFeatureSource>();
  const usedFeatures = new Set<string>();
  if (applicationValues) {
    extractApplications({
      program,
      checker,
      values: applicationValues,
      featureCatalog,
      usedFeatures,
      features,
      featureSourceFiles,
      programs: contributions,
      interfaces: interfaceSources,
      applications: applicationSources,
      extensions,
      root,
      systemSource: file,
      incremental: {
        entry: file,
        changedFile: changedFile ? canonicalSourceFile(changedFile) : undefined,
        reuse: incremental,
        previous: previousFeatures,
        semanticSources: new Map(),
        units: featureUnits,
        work: work.features,
      },
    });
  }
  if (featureValues) {
    const standalone = new Set(
      [...featureCatalog.keys()].filter((name) => !usedFeatures.has(name)),
    );
    extractFeatures(
      program,
      checker,
      checker.getTypeAtLocation(featureValues),
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
      undefined,
      {
        entry: file,
        changedFile: changedFile ? canonicalSourceFile(changedFile) : undefined,
        reuse: incremental,
        previous: previousFeatures,
        semanticSources: new Map(),
        units: featureUnits,
        work: work.features,
      },
      standalone,
    );
  }
  const extractionCompleted = performance.now();
  validateProgramEnvironments(contributions);
  const programs = assemblePrograms(contributions);

  const platforms = [
    ...new Set([
      ...programs.map(({ environment }) => environment.platform),
      ...interfaceSources.map(({ platform }) => platform),
    ]),
  ].sort();
  const interfaceSourceFiles = new Map<string, ReadonlySet<string>>();
  const interfaces: PlatformInterfaceIR[] = [];
  for (const item of interfaceSources.sort((left, right) => left.path.localeCompare(right.path))) {
    interfaceSourceFiles.set(
      item.path,
      new Set([...(item.sourceFiles ?? []), ...(item.extensionSources ?? [])]),
    );
    interfaces.push({
      id: `interface/${item.path}`,
      path: item.path,
      app: item.app,
      platform: item.platform,
      features: item.features,
      programs: programs
        .filter((candidate) => candidate.interface === item.path)
        .map(({ id }) => id)
        .sort(),
      ...(item.extensions ? { extensions: item.extensions } : {}),
    });
  }
  const apps = applicationSources
    .map(({ path, name }) => ({
      id: `app/${path}`,
      path,
      ...(name ? { name } : {}),
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
      features: deduplicateFeatures(features).sort(byId),
      programs: programs.sort(byId),
    },
    configuration ? dirname(configuration) : root,
  );
  for (const extension of extensions) extension.validate?.(ir);
  const linkingCompleted = performance.now();
  const outputSources = collectSystemOutputSources({
    checker,
    entry: file,
    featureSourceFiles,
    interfaceSourceFiles,
    interfaces,
    program,
    programs,
    root,
  });
  const sourcesCompleted = performance.now();
  return {
    ir,
    semanticGraph: Object.freeze({
      version: 1,
      features: Object.freeze(featureUnits.sort(byId)),
    }),
    work: Object.freeze({
      features: Object.freeze({ ...work.features }),
      durations: Object.freeze({
        diagnostics: diagnosticsCompleted - compilationStarted,
        extraction: extractionCompleted - extractionStarted,
        linking: linkingCompleted - extractionCompleted,
        sources: sourcesCompleted - linkingCompleted,
        total: sourcesCompleted - compilationStarted,
      }),
    }),
    sourceFiles: Object.freeze(
      program
        .getSourceFiles()
        .filter((source) => !program.isSourceFileDefaultLibrary(source))
        .map(({ fileName }) => canonicalSourceFile(fileName))
        .sort(),
    ),
    outputSources,
  };
}

function compilerOptions(file: string): ts.CompilerOptions {
  const configuration = ts.findConfigFile(dirname(file), ts.sys.fileExists, "tsconfig.json");
  const configured = configuration ? readCompilerOptions(configuration) : undefined;
  return {
    ...configured,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
}

type UnassembledProgramIR = ProgramContributionIR &
  Readonly<{
    instance: string;
    app?: string;
    extensionSources?: readonly string[];
    name: string;
    logicalName: string;
    environment: ProgramIR["environment"];
    interface?: string;
  }>;

type InterfaceSource = Readonly<{
  path: string;
  app: string;
  platform: string;
  features: Readonly<Record<string, string>>;
  sourceFiles?: readonly string[];
  extensionSources?: readonly string[];
  extensions?: CompilerExtensionsIR;
}>;

type InterfaceOwner = Readonly<{ path: string; platform: string }>;
type AppSource = Readonly<{ path: string; name?: string }>;
type SystemFeatureSource = Readonly<{
  name: string;
  contract: ts.Type;
  implementation: StaticValue;
}>;

type IncrementalFeatureExtraction = Readonly<{
  entry: string;
  changedFile?: string;
  reuse: boolean;
  previous: ReadonlyMap<string, FeatureCompilationUnit>;
  semanticSources: Map<string, ReadonlySet<string>>;
  units: FeatureCompilationUnit[];
  work: { compiled: number; reused: number };
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
    throw new SystemDiagnostic(
      `Program ${JSON.stringify(program.name)} has different execution contexts ` +
        `${JSON.stringify(previous.name)} and ${JSON.stringify(program.environment.name)}.`,
      program.span,
    );
  }
}

function assemblePrograms(contributions: readonly UnassembledProgramIR[]): ProgramIR[] {
  const names = [...new Set(contributions.map(({ name }) => name))].sort();
  return names.map((name) => {
    const candidates = contributions
      .filter((contribution) => contribution.name === name)
      .sort((left, right) => left.feature.localeCompare(right.feature));
    const repeated = new Map<string, number>();
    const members: UnassembledProgramIR[] = [];
    for (const contribution of candidates) {
      if (contribution.interface || !contribution.app) {
        members.push(contribution);
        continue;
      }
      const key = `${contribution.logicalName}\0${contribution.instance}`;
      const previousIndex = repeated.get(key);
      if (previousIndex === undefined) {
        repeated.set(key, members.length);
        members.push(contribution);
        continue;
      }
      const previous = members[previousIndex]!;
      const apps = [
        ...new Set(
          [previous.app, contribution.app].filter((value): value is string => value !== undefined),
        ),
      ].sort();
      members[previousIndex] = {
        ...previous,
        ...(apps.length > 1 ? { apps } : {}),
      };
    }
    const environment = members[0]!.environment;
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
          interface: interface_,
          instance: _instance,
          app,
          extensionSources: _extensionSources,
          ...member
        }) => ({
          ...member,
          ...(member.apps ? {} : app && !interface_ ? { apps: [app] } : {}),
        }),
      ),
    };
  });
}

function semanticHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function transitiveLocalSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  initial: Iterable<ts.SourceFile | string>,
): ReadonlySet<string> {
  return transitiveSources(program, checker, root, initial, false);
}

function transitiveSemanticSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  initial: Iterable<ts.SourceFile | string>,
): ReadonlySet<string> {
  return transitiveSources(program, checker, root, initial, true);
}

function transitiveSources(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  initial: Iterable<ts.SourceFile | string>,
  includeTypeOnly: boolean,
): ReadonlySet<string> {
  const sources = new Set<string>();
  const pending = [...initial].flatMap((value): ts.SourceFile[] => {
    const source =
      typeof value === "string"
        ? (program.getSourceFile(resolve(value)) ??
          program
            .getSourceFiles()
            .find(({ fileName }) => canonicalSourceFile(fileName) === canonicalSourceFile(value)))
        : value;
    return source && !source.isDeclarationFile && inside(root, source.fileName) ? [source] : [];
  });
  while (pending.length) {
    const source = pending.pop()!;
    const file = resolve(source.fileName);
    if (sources.has(file)) continue;
    sources.add(file);
    for (const statement of source.statements) {
      const specifier = moduleSpecifier(statement, includeTypeOnly);
      if (!specifier) continue;
      const symbol = checker.getSymbolAtLocation(specifier);
      for (const declaration of symbol?.declarations ?? []) {
        const imported = declaration.getSourceFile();
        if (!imported.isDeclarationFile && inside(root, imported.fileName)) pending.push(imported);
      }
      if (ts.isStringLiteralLike(specifier)) {
        const resolved = ts.resolveModuleName(
          specifier.text,
          source.fileName,
          program.getCompilerOptions(),
          ts.sys,
        ).resolvedModule;
        const imported = resolved ? program.getSourceFile(resolved.resolvedFileName) : undefined;
        if (imported && !imported.isDeclarationFile && inside(root, imported.fileName)) {
          pending.push(imported);
        }
      }
    }
  }

  // Keep only files TypeScript actually included in this Program.
  const included = new Set(program.getSourceFiles().map((source) => resolve(source.fileName)));
  return new Set([...sources].filter((source) => included.has(source)));
}

function moduleSpecifier(
  statement: ts.Statement,
  includeTypeOnly: boolean,
): ts.Expression | undefined {
  if (ts.isImportDeclaration(statement)) {
    if (!includeTypeOnly && statement.importClause?.isTypeOnly) return undefined;
    if (
      !includeTypeOnly &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
    ) {
      return undefined;
    }
    return statement.moduleSpecifier;
  }
  return ts.isExportDeclaration(statement) && (includeTypeOnly || !statement.isTypeOnly)
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
        ...(program.interface ? (input.interfaceSourceFiles.get(program.interface) ?? []) : []),
        ...program.contributions.flatMap(({ feature }) => [
          ...(input.featureSourceFiles.get(feature) ?? []),
        ]),
      ]),
    );
  }
  for (const interface_ of input.interfaces) {
    output.set(
      interface_.id,
      new Set([
        canonicalSourceFile(input.entry),
        ...(input.featureSourceFiles.get(interface_.app) ?? []),
        ...(input.interfaceSourceFiles.get(interface_.path) ?? []),
        ...input.programs
          .filter(({ interface: owner }) => owner === interface_.path)
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

function collectSystemFeatureCatalog(
  checker: ts.TypeChecker,
  values: ts.ObjectLiteralExpression,
): ReadonlyMap<string, SystemFeatureSource> {
  const catalog = new Map<string, SystemFeatureSource>();
  const contracts = checker.getTypeAtLocation(values);
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const implementation = resolveObjectMember(checker, values, name);
    if (!implementation) {
      throw diagnostic(values, `System Feature ${JSON.stringify(name)} has no implementation.`);
    }
    const location = symbol.valueDeclaration ?? implementation;
    const valueType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const contract = retainedFeatureContract(checker, valueType, location);
    const staticValue = resolveStaticValue(
      checker,
      { node: implementation, bindings: new Map(), types: new Map() },
      new Set(),
    ) ?? { node: implementation, bindings: new Map(), types: new Map() };
    catalog.set(name, { name, contract, implementation: staticValue });
  }
  return catalog;
}

function extractApplications(input: {
  program: ts.Program;
  checker: ts.TypeChecker;
  values: ts.ObjectLiteralExpression;
  featureCatalog: ReadonlyMap<string, SystemFeatureSource>;
  usedFeatures: Set<string>;
  features: FeatureIR[];
  featureSourceFiles: Map<string, ReadonlySet<string>>;
  programs: UnassembledProgramIR[];
  interfaces: InterfaceSource[];
  applications: AppSource[];
  extensions: readonly SourceCompilerExtension[];
  root: string;
  systemSource: string;
  incremental: IncrementalFeatureExtraction;
}): void {
  const {
    program,
    checker,
    values,
    featureCatalog,
    usedFeatures,
    features,
    featureSourceFiles,
    programs,
    interfaces,
    applications,
    extensions,
    root,
    systemSource,
    incremental,
  } = input;
  const applicationValues = checker.getTypeAtLocation(values);
  for (const symbol of sortedSymbols(applicationValues.getProperties())) {
    const path = symbol.getName();
    const implementation = resolveObjectMember(checker, values, path);
    if (!implementation) {
      throw diagnostic(values, `Application ${JSON.stringify(path)} has no implementation.`);
    }
    const location = symbol.valueDeclaration ?? implementation;
    const valueType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const contract = retainedApplicationCompilerContract(checker, valueType, location);
    const staticApplication = resolveStaticValue(
      checker,
      { node: implementation, bindings: new Map(), types: new Map() },
      new Set(),
    ) ?? { node: implementation, bindings: new Map(), types: new Map() };
    const applicationValue = staticObjectValue(checker, staticApplication);
    if (!applicationValue) {
      throw diagnostic(
        implementation,
        `Application ${JSON.stringify(path)} must expose compiler-readable metadata.`,
      );
    }
    const sourceFiles = new Set<string>([
      canonicalSourceFile(systemSource),
      canonicalSourceFile(applicationValue.getSourceFile().fileName),
    ]);
    for (const declaration of expressionDeclarations(checker, implementation)) {
      const source = declaration.getSourceFile();
      if (!source.isDeclarationFile && inside(root, source.fileName)) {
        sourceFiles.add(canonicalSourceFile(source.fileName));
      }
    }
    const required = propertyType(checker, contract, "Features", location);
    const implementations = new Map<string, StaticValue>();
    const paths = new Map<string, string>();
    if (required?.getProperties().length) {
      for (const feature of sortedSymbols(required.getProperties())) {
        const role = feature.getName();
        const roleLocation = feature.valueDeclaration ?? location;
        const roleContract = checker.getTypeOfSymbolAtLocation(feature, roleLocation);
        const matches = [...featureCatalog.values()].filter((candidate) =>
          equivalentType(checker, roleContract, candidate.contract),
        );
        if (!matches.length) {
          throw diagnostic(
            roleLocation,
            `Application ${JSON.stringify(path)} Feature role ${JSON.stringify(role)} ` +
              "has no exact System Feature implementation.",
          );
        }
        if (matches.length > 1) {
          throw diagnostic(
            roleLocation,
            `Application ${JSON.stringify(path)} Feature role ${JSON.stringify(role)} is ` +
              `ambiguous between System Features ${matches
                .map(({ name }) => JSON.stringify(name))
                .join(", ")}. Retain a semantic instance discriminator in the Feature contract.`,
          );
        }
        const selected = matches[0]!;
        usedFeatures.add(selected.name);
        implementations.set(role, selected.implementation);
        paths.set(role, selected.name);
      }
    }
    const featureBindings = Object.freeze(
      Object.fromEntries([...paths].sort(([left], [right]) => left.localeCompare(right))),
    );
    const localInterfaces = extractApplicationInterfaces({
      program,
      checker,
      contract,
      implementation: applicationValue,
      staticApplication,
      location,
      path,
      features: featureBindings,
      interfaces,
      extensions,
      root,
      sourceFiles,
    });
    if (required?.getProperties().length) {
      extractFeatures(
        program,
        checker,
        required,
        undefined,
        "",
        features,
        featureSourceFiles,
        programs,
        interfaces,
        extensions,
        root,
        new Set([canonicalSourceFile(systemSource)]),
        location,
        undefined,
        path,
        localInterfaces,
        false,
        undefined,
        incremental,
        undefined,
        implementations,
        paths,
      );
    }
    const declaredApplication =
      propertyType(checker, contract, "Application", location) ?? contract;
    const applicationName = literalPropertyOptional(checker, declaredApplication, "Name", location);
    applications.push({ path, ...(applicationName ? { name: applicationName } : {}) });
  }
}

function extractApplicationInterfaces(input: {
  program: ts.Program;
  checker: ts.TypeChecker;
  contract: ts.Type;
  implementation: ts.ObjectLiteralExpression;
  staticApplication: StaticValue;
  location: ts.Node;
  path: string;
  features: Readonly<Record<string, string>>;
  interfaces: InterfaceSource[];
  extensions: readonly SourceCompilerExtension[];
  root: string;
  sourceFiles: Set<string>;
}): readonly InterfaceOwner[] {
  const {
    program,
    checker,
    contract,
    implementation,
    staticApplication,
    location,
    path,
    features,
    interfaces,
    extensions,
    root,
    sourceFiles,
  } = input;
  const contracts = propertyType(checker, contract, "Interfaces", location);
  if (!contracts) return [];
  const staticInterfaces = resolveStaticMember(checker, staticApplication, "interfaces");
  const values = objectExpression(checker, objectMember(checker, implementation, "interfaces"));
  if (!values) {
    throw diagnostic(
      implementation,
      `Application ${JSON.stringify(path)} needs compiler-readable interfaces.`,
    );
  }
  const owners: InterfaceOwner[] = [];
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    const interfacePath = `${path}.${name}`;
    const interfaceLocation = symbol.valueDeclaration ?? location;
    const interfaceContract = checker.getTypeOfSymbolAtLocation(symbol, interfaceLocation);
    const marker = propertyType(checker, interfaceContract, "Interface", interfaceLocation);
    const platformContract = marker
      ? propertyType(checker, marker, "Platform", interfaceLocation)
      : undefined;
    if (!platformContract) {
      throw diagnostic(
        interfaceLocation,
        `Interface ${JSON.stringify(interfacePath)} has no Platform.`,
      );
    }
    const platform = literalProperty(checker, platformContract, "Name", interfaceLocation);
    if (owners.some((candidate) => candidate.platform === platform)) {
      throw diagnostic(
        interfaceLocation,
        `Application ${JSON.stringify(path)} has more than one ${JSON.stringify(platform)} interface.`,
      );
    }
    const value = resolveObjectMember(checker, values, name);
    const staticInterface = staticInterfaces
      ? resolveStaticMember(checker, staticInterfaces, name)
      : undefined;
    const interfaceValue =
      staticObjectValue(checker, staticInterface) ??
      (value ? objectExpression(checker, value) : undefined);
    if (!interfaceValue) {
      throw diagnostic(
        value ?? values,
        `Interface ${JSON.stringify(interfacePath)} must expose compiler-readable metadata.`,
      );
    }
    const source = interfaceValue.getSourceFile();
    if (!source.isDeclarationFile && inside(root, source.fileName)) {
      sourceFiles.add(canonicalSourceFile(source.fileName));
    }
    const owner = { path: interfacePath, platform };
    owners.push(owner);
    const dialect = dialectField(extensions, "interface", platform, {
      checker,
      source: sourceCompilerAPI(program, checker, staticInterface, root, extensions),
      contract: interfaceContract,
      implementation: interfaceValue,
      location: value ?? interfaceLocation,
      path: interfacePath,
      root,
      app: path,
      platform,
    });
    interfaces.push({
      path: interfacePath,
      app: path,
      platform,
      features,
      sourceFiles: Object.freeze([...sourceFiles].sort()),
      ...(dialect.extensionSources ? { extensionSources: dialect.extensionSources } : {}),
      extensions: dialect.extensions,
    });
  }
  return owners;
}

function equivalentType(checker: ts.TypeChecker, left: ts.Type, right: ts.Type): boolean {
  return checker.isTypeAssignableTo(left, right) && checker.isTypeAssignableTo(right, left);
}

function deduplicateFeatures(values: readonly FeatureIR[]): FeatureIR[] {
  const features = new Map<string, FeatureIR>();
  for (const value of values) {
    const current = features.get(value.id);
    if (!current) {
      features.set(value.id, value);
      continue;
    }
    const comparable = (feature: FeatureIR) => ({
      ...feature,
      programs: [],
    });
    if (JSON.stringify(comparable(current)) !== JSON.stringify(comparable(value))) {
      throw new Error(`System Feature ${JSON.stringify(value.path)} has conflicting projections.`);
    }
    features.set(value.id, {
      ...current,
      programs: [...new Set([...current.programs, ...value.programs])].sort(),
    });
  }
  return [...features.values()];
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
  program: ts.Program,
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
  interfaceOwners: readonly InterfaceOwner[] = [],
  contractsAreFeatureValues = false,
  ownerStatic?: StaticValue,
  incremental?: IncrementalFeatureExtraction,
  selectedNames?: ReadonlySet<string>,
  implementations?: ReadonlyMap<string, StaticValue>,
  canonicalPaths?: ReadonlyMap<string, string>,
): void {
  const staticChildren = ownerStatic
    ? resolveStaticMember(checker, ownerStatic, "features")
    : undefined;
  for (const symbol of sortedSymbols(contracts.getProperties())) {
    const name = symbol.getName();
    if (selectedNames && !selectedNames.has(name)) continue;
    const segment = canonicalPaths?.get(name) ?? name;
    const path = parent ? `${parent}.${segment}` : segment;
    const unitId = app ? `application/${app}/feature/${path}` : `feature/${path}`;
    const previousUnit = parent ? undefined : incremental?.previous.get(unitId);
    if (
      previousUnit &&
      incremental?.reuse &&
      (!incremental.changedFile || !previousUnit.sourceFiles.includes(incremental.changedFile))
    ) {
      const prefix = `${unitId}.`;
      const reused = [...incremental.previous.values()]
        .filter((unit) => unit.id === unitId || unit.id.startsWith(prefix))
        .sort(byId);
      for (const unit of reused) {
        appendFeatureCompilationUnit(unit, features, featureSourceFiles, programs, interfaces);
      }
      incremental.units.push(...reused);
      incremental.work.reused += reused.length;
      continue;
    }
    const unitStart = {
      programs: programs.length,
      interfaces: interfaces.length,
      units: incremental?.units.length ?? 0,
    };
    const location = symbol.valueDeclaration ?? at;
    const symbolType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const contract = contractsAreFeatureValues
      ? retainedFeatureContract(checker, symbolType, location)
      : symbolType;
    const inherited =
      implementations?.get(name) ??
      (staticChildren ? resolveStaticMember(checker, staticChildren, name) : undefined) ??
      (owner ? resolveFeatureChild(checker, owner, name) : undefined);
    const value = values
      ? resolveObjectMember(checker, values, name)
      : inherited && ts.isExpression(inherited.node)
        ? inherited.node
        : undefined;
    if ((values || owner || implementations) && !value)
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
    const featureLocation = value ?? location;
    const programContracts = propertyType(checker, contract, "Programs", location);
    const programValues = objectExpression(
      checker,
      objectMember(checker, featureValue, "programs"),
    );
    const childContracts = propertyType(checker, contract, "Features", location);
    const childValues = objectExpression(checker, objectMember(checker, featureValue, "features"));
    const providers = extractDependencyProviders(
      program,
      checker,
      contract,
      featureValue,
      (staticFeature ? resolveStaticMember(checker, staticFeature, "providers") : undefined) ??
        (value ? resolveFeatureMember(checker, value, "providers") : undefined),
      featureLocation,
      root,
    );
    for (const provider of providers) {
      for (const source of provider.sources ?? []) sourceFiles.add(canonicalSourceFile(source));
    }
    featureSourceFiles.set(path, sourceFiles);
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
        const expandedPrograms = staticFeature
          ? resolveStaticMember(checker, staticFeature, "programs")
          : undefined;
        const expandedProgram =
          (expandedPrograms
            ? resolveStaticMember(checker, expandedPrograms, programName)
            : undefined) ??
          (value ? resolveFeatureProgram(checker, value, programName) : undefined);
        const extracted = extractProgram(
          program,
          checker,
          programContract,
          programValue,
          path,
          programName,
          featureLocation,
          Boolean((value && !featureValue) || (implementation && !programValue)),
          expandedProgram,
          extensions,
          root,
          interfaceOwners,
          staticValueIdentity(
            staticFeature ?? {
              node: value ?? featureLocation,
              bindings: new Map(),
              types: new Map(),
            },
          ),
          app,
        );
        programs.push(extracted);
        programIds.push(`program/${extracted.name}`);
      }
    }

    const directProgramEnd = programs.length;
    const directInterfaceEnd = interfaces.length;
    if (childContracts) {
      if (featureValue && !childValues)
        throw diagnostic(featureValue, `Feature ${JSON.stringify(path)} needs features.`);
      for (const child of sortedSymbols(childContracts.getProperties())) {
        childIds.push(`feature/${path}.${child.getName()}`);
      }
      extractFeatures(
        program,
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
        app,
        interfaceOwners,
        false,
        staticFeature,
        incremental,
      );
    }

    features.push({
      id: `feature/${path}`,
      path,
      children: childIds.sort(),
      programs: [...new Set(programIds)].sort(),
      ...(providers.length ? { providers } : {}),
      ...extensionField(extensions, "feature", {
        checker,
        source: sourceCompilerAPI(program, checker, staticFeature, root, extensions),
        contract,
        implementation: featureValue,
        location: featureLocation,
        path,
        root,
      }),
    });
    if (incremental) {
      const unit = createFeatureCompilationUnit({
        id: unitId,
        path,
        entry: incremental.entry,
        features: [features.at(-1)!],
        featureSourceFiles,
        programs: programs.slice(unitStart.programs, directProgramEnd),
        interfaces: interfaces.slice(unitStart.interfaces, directInterfaceEnd),
        descendants: incremental.units.slice(unitStart.units),
        program,
        checker,
        root,
        semanticSources: incremental.semanticSources,
      });
      for (const [unitPath, sources] of Object.entries(unit.featureSourceFiles)) {
        featureSourceFiles.set(unitPath, new Set(sources));
      }
      incremental.units.push(unit);
      incremental.work.compiled += 1;
    }
  }
}

function appendFeatureCompilationUnit(
  unit: FeatureCompilationUnit,
  features: FeatureIR[],
  featureSourceFiles: Map<string, ReadonlySet<string>>,
  programs: UnassembledProgramIR[],
  interfaces: InterfaceSource[],
): void {
  features.push(...unit.features);
  programs.push(...unit.programs);
  interfaces.push(...unit.interfaces);
  for (const [path, sources] of Object.entries(unit.featureSourceFiles)) {
    featureSourceFiles.set(path, new Set(sources));
  }
}

function createFeatureCompilationUnit(input: {
  id: string;
  path: string;
  entry: string;
  features: readonly FeatureIR[];
  featureSourceFiles: ReadonlyMap<string, ReadonlySet<string>>;
  programs: readonly UnassembledProgramIR[];
  interfaces: readonly InterfaceSource[];
  descendants: readonly FeatureCompilationUnit[];
  program: ts.Program;
  checker: ts.TypeChecker;
  root: string;
  semanticSources: Map<string, ReadonlySet<string>>;
}): FeatureCompilationUnit {
  const path = input.path;
  const directFeatureSourceFiles = Object.fromEntries(
    [...input.featureSourceFiles]
      .filter(([candidate]) => candidate === path)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([candidate, sources]) => [
        candidate,
        Object.freeze([...new Set([...sources].map(canonicalSourceFile))].sort()),
      ]),
  );
  const featureSourceFiles = Object.freeze(directFeatureSourceFiles) as Readonly<
    Record<string, readonly string[]>
  >;
  const direct = new Set<string>([
    input.entry,
    ...Object.values(featureSourceFiles).flat(),
    ...input.programs.flatMap(({ extensionSources }) => extensionSources ?? []),
    ...input.interfaces.flatMap(({ extensionSources, sourceFiles }) => [
      ...(sourceFiles ?? []),
      ...(extensionSources ?? []),
    ]),
  ]);
  const semantic = new Set<string>();
  for (const source of direct) {
    const canonical = canonicalSourceFile(source);
    if (canonical === canonicalSourceFile(input.entry)) continue;
    let closure = input.semanticSources.get(canonical);
    if (!closure) {
      closure = transitiveSemanticSources(input.program, input.checker, input.root, [source]);
      input.semanticSources.set(canonical, closure);
    }
    closure.forEach((dependency) => semantic.add(dependency));
  }
  const ownSourceFiles = Object.freeze(
    [...new Set([input.entry, ...direct, ...semantic].map(canonicalSourceFile))].sort(),
  );
  const sourceFiles = Object.freeze(
    [
      ...new Set([
        ...ownSourceFiles,
        ...input.descendants.flatMap(({ sourceFiles: descendants }) => descendants),
      ]),
    ].sort(),
  );
  const ownedSourceFiles = Object.freeze({
    ...featureSourceFiles,
    [path]: ownSourceFiles,
  });
  const meaning = {
    features: input.features,
    featureSourceFiles: ownedSourceFiles,
    programs: input.programs,
    interfaces: input.interfaces,
  };
  return Object.freeze({
    id: input.id,
    hash: semanticHash(meaning),
    sourceFiles,
    features: Object.freeze([...input.features]),
    featureSourceFiles: ownedSourceFiles,
    programs: Object.freeze([...input.programs]),
    interfaces: Object.freeze([...input.interfaces]),
  });
}

function extractDependencyProviders(
  program: ts.Program,
  checker: ts.TypeChecker,
  contract: ts.Type,
  feature: ts.ObjectLiteralExpression | undefined,
  staticProviders: StaticValue | undefined,
  location: ts.Node,
  root: string,
): readonly DependencyProviderIR[] {
  const providerContracts = propertyType(checker, contract, "Providers", location);
  if (!providerContracts) return [];
  const providerValues =
    staticObjectValue(checker, staticProviders) ??
    objectExpression(checker, objectMember(checker, feature, "providers"));
  if (feature && !providerValues) {
    throw diagnostic(feature, "Feature provider contracts require provider implementations.");
  }
  const providers: DependencyProviderIR[] = [];
  for (const platformSymbol of sortedSymbols(providerContracts.getProperties())) {
    const platform = platformSymbol.getName();
    const platformLocation = platformSymbol.valueDeclaration ?? location;
    const platformContract = checker.getTypeOfSymbolAtLocation(platformSymbol, platformLocation);
    const platformValue = providerValues
      ? staticObjectExpression(checker, resolveObjectMember(checker, providerValues, platform))
      : undefined;
    if (providerValues && !platformValue) {
      throw diagnostic(
        providerValues,
        `Feature provider Platform ${JSON.stringify(platform)} has no implementation.`,
      );
    }
    for (const dependencySymbol of sortedSymbols(platformContract.getProperties())) {
      const dependency = dependencySymbol.getName();
      const providerValue = platformValue
        ? staticObjectExpression(checker, resolveObjectMember(checker, platformValue, dependency))
        : undefined;
      if (platformValue && !providerValue) {
        throw diagnostic(
          platformValue,
          `Feature Dependency provider ${JSON.stringify(dependency)} has no implementation.`,
        );
      }
      const development = providerValue
        ? objectMemberDeclaration(providerValue, "development")
        : undefined;
      if (!development) {
        throw diagnostic(
          providerValue ?? platformValue ?? feature ?? location,
          `Feature Dependency provider ${JSON.stringify(dependency)} has no development implementation.`,
        );
      }
      const requirementsValue = objectMember(checker, providerValue, "requirements");
      const requirements = requirementsValue
        ? staticConstant(
            checker,
            { node: requirementsValue, bindings: new Map(), types: new Map() },
            new Set(),
          )
        : undefined;
      if (requirementsValue && requirements === undefined) {
        throw diagnostic(
          requirementsValue,
          `Feature Dependency provider ${JSON.stringify(dependency)} requirements must be static data.`,
        );
      }
      const productionValue = objectMember(checker, providerValue, "production");
      const production = productionValue
        ? staticConstant(
            checker,
            { node: productionValue, bindings: new Map(), types: new Map() },
            new Set(),
          )
        : undefined;
      if (productionValue && production === undefined) {
        throw diagnostic(
          productionValue,
          `Feature Dependency provider ${JSON.stringify(dependency)} production meaning must be static data.`,
        );
      }
      providers.push({
        dependency,
        platform,
        development: true,
        sources: Object.freeze(
          [
            ...transitiveLocalSources(program, checker, root, [
              development.getSourceFile(),
              ...(providerValue ? [providerValue.getSourceFile()] : []),
            ]),
          ].sort(),
        ),
        ...(requirements === undefined ? {} : { requirements }),
        ...(production === undefined ? {} : { production }),
        span: spanOf(providerValue ?? development),
      });
    }
  }
  return providers.sort((left, right) =>
    `${left.platform}/${left.dependency}`.localeCompare(`${right.platform}/${right.dependency}`),
  );
}

function staticObjectExpression(
  checker: ts.TypeChecker,
  value: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  const direct = objectExpression(checker, value);
  if (direct || !value) return direct;
  const resolved = resolveStaticValue(
    checker,
    { node: value, bindings: new Map(), types: new Map() },
    new Set(),
  );
  return resolved?.node && ts.isExpression(resolved.node)
    ? objectExpression(checker, resolved.node)
    : undefined;
}

function staticObjectValue(
  checker: ts.TypeChecker,
  value: StaticValue | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!value) return undefined;
  const direct = ts.isExpression(value.node) ? objectExpression(checker, value.node) : undefined;
  if (direct) return direct;
  const resolved = resolveStaticValue(checker, value, new Set());
  return resolved?.node && ts.isExpression(resolved.node)
    ? objectExpression(checker, resolved.node)
    : undefined;
}

function extractProgram(
  program: ts.Program,
  checker: ts.TypeChecker,
  contract: ts.Type,
  value: ts.ObjectLiteralExpression | undefined,
  feature: string,
  name: string,
  at: ts.Node = value!,
  factory = false,
  expandedProgram?: StaticValue,
  extensions: readonly SourceCompilerExtension[] = [],
  sourceRoot = dirname(at.getSourceFile().fileName),
  interfaceOwners: readonly InterfaceOwner[] = [],
  instance = sourceIdentity(at),
  app?: string,
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
  const interfaceOwner = interfaceOwners.find((candidate) => candidate.platform === platform);
  const concreteName =
    interfaceOwner && interfaceOwner.platform === platform
      ? `${interfaceOwner.path}.${name}`
      : name;
  const expandedValue =
    expandedProgram && ts.isExpression(expandedProgram.node)
      ? objectExpression(checker, expandedProgram.node)
      : undefined;
  const readableValue = value ?? expandedValue;
  const requires = dependencyList(
    checker,
    propertyType(checker, contract, "Requires", location),
    location,
  );
  const provides = dependencyList(
    checker,
    propertyType(checker, contract, "Provides", location),
    location,
  );
  return {
    id: `feature/${feature}/program/${name}`,
    feature,
    instance,
    ...(app ? { app } : {}),
    name: concreteName,
    logicalName: name,
    environment: { name: environmentName, platform },
    ...(interfaceOwner ? { interface: interfaceOwner.path } : {}),
    requires,
    provides,
    ...dialectField(extensions, "program", platform, {
      checker,
      source: sourceCompilerAPI(program, checker, expandedProgram, sourceRoot, extensions),
      contract,
      implementation: readableValue,
      location,
      path: feature,
      root: sourceRoot,
      ...(app ? { app } : {}),
      feature,
      ...(interfaceOwner ? { interface: interfaceOwner.path } : {}),
      implementationOrigin:
        factory && !expandedProgram ? "unresolved" : value ? "direct" : "expanded",
      name,
      platform,
    }),
    span: spanOf(location),
  };
}

function validatePortableLocals(
  function_: FunctionIR,
  contextBindings: readonly string[] = [],
): void {
  const initial = new Set([
    ...function_.captures.map(({ name }) => name),
    ...function_.parameters.map(({ name }) => name),
    ...contextBindings,
  ]);
  const expression = (value: ExpressionIR, names: ReadonlySet<string>): void => {
    switch (value.kind) {
      case "local":
        if (!names.has(value.name)) {
          throw new SystemDiagnostic(
            `Portable function ${JSON.stringify(function_.name)} (${JSON.stringify(function_.id)}) ` +
              `references undeclared binding ${JSON.stringify(value.name)}; captures are ` +
              `${JSON.stringify(function_.captures.map(({ name }) => name))}.`,
            value.span,
          );
        }
        return;
      case "array":
        value.values.forEach((item) => expression(item, names));
        return;
      case "record":
        value.fields.forEach((field) => expression(field.value, names));
        return;
      case "record-merge":
        value.entries.forEach((entry) => expression(entry.value, names));
        return;
      case "property":
      case "index":
      case "unary":
      case "error-match":
      case "json-parse":
      case "json-stringify":
      case "object-keys":
      case "to-string":
        expression(value.value, names);
        if (value.kind === "index") expression(value.index, names);
        return;
      case "binary":
        expression(value.left, names);
        expression(value.right, names);
        return;
      case "invoke":
        expression(value.callee, names);
        value.arguments.forEach((argument) => expression(argument, names));
        return;
      case "method-call":
        expression(value.receiver, names);
        value.arguments.forEach((argument) => expression(argument, names));
        return;
      case "stream-map":
        expression(value.source, names);
        expression(value.transform, names);
        return;
      case "stream-distinct":
        expression(value.source, names);
        expression(value.select, names);
        return;
      case "conditional":
        expression(value.condition, names);
        expression(value.consequent, names);
        expression(value.alternate, names);
        return;
      case "concurrent":
        value.values.forEach((item) => expression(item, names));
        return;
      case "call":
        value.arguments.forEach((argument) => expression(argument, names));
        return;
      case "dependency-call":
        value.arguments.forEach((argument) => expression(argument, names));
        if (value.options) expression(value.options, names);
        return;
      case "dependency-dispatch":
        expression(value.dependency, names);
        expression(value.operation, names);
        expression(value.input, names);
        if (value.options) expression(value.options, names);
        return;
      case "dependency-intercept":
        expression(value.dependency, names);
        expression(value.intercept, names);
        return;
      case "dependency-reference":
        expression(value.binding, names);
        return;
      case "dependency-reference-call":
        expression(value.reference, names);
        if (value.input) expression(value.input, names);
        if (value.options) expression(value.options, names);
        return;
      case "closure":
        value.captures.forEach((capture) => expression(capture, names));
        return;
      case "error":
        value.arguments.forEach((argument) => expression(argument, names));
        value.fields.forEach((field) => expression(field.value, names));
        return;
      case "literal":
      case "none":
        return;
    }
  };
  const statements = (body: readonly StatementIR[], inherited: ReadonlySet<string>): void => {
    const names = new Set(inherited);
    for (const statement of body) {
      switch (statement.kind) {
        case "let":
          expression(statement.value, names);
          names.add(statement.name);
          break;
        case "assign":
          if (!names.has(statement.name)) {
            throw new SystemDiagnostic(
              `Portable function ${JSON.stringify(function_.name)} assigns undeclared binding ${JSON.stringify(statement.name)}.`,
              statement.span,
            );
          }
          expression(statement.value, names);
          break;
        case "property-assign":
          expression(statement.target, names);
          expression(statement.value, names);
          break;
        case "index-assign":
          expression(statement.target, names);
          expression(statement.index, names);
          expression(statement.value, names);
          break;
        case "array-push":
          if (!names.has(statement.array)) {
            throw new SystemDiagnostic(
              `Portable function ${JSON.stringify(function_.name)} mutates undeclared binding ${JSON.stringify(statement.array)}.`,
              statement.span,
            );
          }
          expression(statement.value, names);
          break;
        case "expression":
          expression(statement.expression, names);
          break;
        case "throw":
          expression(statement.value, names);
          break;
        case "if":
          expression(statement.condition, names);
          statements(statement.consequent, names);
          statements(statement.alternate, names);
          break;
        case "for-of":
          expression(statement.values, names);
          statements(statement.body, new Set([...names, statement.item]));
          break;
        case "for-range":
          expression(statement.from, names);
          expression(statement.to, names);
          statements(statement.body, new Set([...names, statement.item]));
          break;
        case "while":
          expression(statement.condition, names);
          statements(statement.body, names);
          break;
        case "try":
          statements(statement.body, names);
          if (statement.catch) {
            statements(
              statement.catch.body,
              statement.catch.error ? new Set([...names, statement.catch.error]) : names,
            );
          }
          statements(statement.finally, names);
          break;
        case "return":
          if (statement.value) expression(statement.value, names);
          break;
      }
    }
  };
  statements(function_.body, initial);
}

function dependencyList(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
  at: ts.Node,
): DependencyIR[] {
  return sortedSymbols(type?.getProperties() ?? []).map((symbol) => {
    const api = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? at);
    const definitionMarker = api
      .getProperties()
      .find((property) => property.getName().startsWith("__@dependencyDefinition"));
    const definition = definitionMarker
      ? checker.getNonNullableType(
          checker.getTypeOfSymbolAtLocation(
            definitionMarker,
            definitionMarker.valueDeclaration ?? symbol.valueDeclaration ?? at,
          ),
        )
      : undefined;
    if (!definition) {
      throw diagnostic(
        symbol.valueDeclaration ?? at,
        `Dependency ${JSON.stringify(symbol.getName())} must use the semantic Dependency type.`,
      );
    }
    const operations = propertyType(
      checker,
      definition,
      "Operations",
      symbol.valueDeclaration ?? at,
    );
    if (!operations) {
      throw diagnostic(
        symbol.valueDeclaration ?? at,
        `Dependency ${JSON.stringify(symbol.getName())} has no Operations definition.`,
      );
    }
    const reference = propertyType(checker, definition, "Reference", symbol.valueDeclaration ?? at);
    const referenceName = reference
      ? literalProperty(checker, reference, "Name", symbol.valueDeclaration ?? at)
      : undefined;
    const referenceArgument = reference
      ? literalProperty(checker, reference, "Argument", symbol.valueDeclaration ?? at)
      : undefined;
    const referenceBinding = reference
      ? propertyType(checker, reference, "Binding", symbol.valueDeclaration ?? at)
      : undefined;
    const referenceInputs = reference
      ? propertyType(checker, reference, "Inputs", symbol.valueDeclaration ?? at)
      : undefined;
    const failures = propertyType(checker, definition, "Failures", symbol.valueDeclaration ?? at);
    const heartbeats = propertyType(
      checker,
      definition,
      "Heartbeats",
      symbol.valueDeclaration ?? at,
    );
    return {
      name: symbol.getName(),
      type: lowerType(checker, operations, at, new Set(), symbol.getName()),
      ...(failures
        ? { failures: lowerType(checker, failures, at, new Set(), `${symbol.getName()}Failure`) }
        : {}),
      ...(heartbeats
        ? {
            heartbeats: sortedSymbols(heartbeats.getProperties()).map((heartbeat) => ({
              operation: heartbeat.getName(),
              type: lowerType(
                checker,
                checker.getTypeOfSymbolAtLocation(
                  heartbeat,
                  heartbeat.valueDeclaration ?? symbol.valueDeclaration ?? at,
                ),
                at,
                new Set(),
                `${symbol.getName()}Heartbeat`,
              ),
            })),
          }
        : {}),
      ...(referenceName !== undefined &&
      referenceArgument !== undefined &&
      typeof referenceName === "string" &&
      typeof referenceArgument === "string"
        ? {
            reference: {
              name: referenceName,
              argument: referenceArgument,
              bindings: sortedSymbols(referenceBinding?.getProperties() ?? []).map((binding) =>
                binding.getName(),
              ),
              inputs: sortedSymbols(referenceInputs?.getProperties() ?? []).flatMap((input) => {
                const inputType = checker.getTypeOfSymbolAtLocation(
                  input,
                  input.valueDeclaration ?? symbol.valueDeclaration ?? at,
                );
                return inputType.flags & ts.TypeFlags.Undefined ? [] : [input.getName()];
              }),
            },
          }
        : {}),
    };
  });
}

function lowerType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  active: Set<ts.Type> = new Set(),
  path = "contract",
  substitutions: ReadonlyMap<ts.Type, ts.Type> = new Map(),
  allowCallbackCycle = false,
): TypeIR {
  const substituted = substitutedType(type, substitutions);
  if (substituted !== type) {
    return lowerType(checker, substituted, at, active, path, substitutions, allowCallbackCycle);
  }
  if (type.flags & ts.TypeFlags.IndexedAccess) {
    const indexed = type as ts.IndexedAccessType;
    const owner = substitutedType(indexed.objectType, substitutions);
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
    throw diagnostic(at, `Portable contract ${path} cannot contain unresolved unknown.`);
  }
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint && constraint !== type) {
      return lowerType(checker, constraint, at, active, path, substitutions, allowCallbackCycle);
    }
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
  if (type.flags & ts.TypeFlags.TemplateLiteral) {
    const template = type as ts.TemplateLiteralType;
    let value = template.texts[0] ?? "";
    for (const [index, substitution] of template.types.entries()) {
      const lowered = lowerType(
        checker,
        substitution,
        at,
        active,
        `${path}.template[${index}]`,
        substitutions,
      );
      if (lowered.kind !== "literal") return primitive("string");
      value += String(lowered.value);
      value += template.texts[index + 1] ?? "";
    }
    return { kind: "literal", value };
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
  if (active.has(type) && allowCallbackCycle) {
    return {
      kind: "opaque",
      name: type.aliasSymbol?.getName() ?? type.symbol?.getName() ?? "CallbackContext",
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
            true,
          ),
        })),
        result: lowerType(
          checker,
          signature.getReturnType(),
          at,
          active,
          `${path}.result`,
          substitutions,
          true,
        ),
      };
    }
    const fields: FieldIR[] = sortedSymbols(type.getProperties())
      .filter(
        (symbol) =>
          !symbol.getName().startsWith("__@dependencyDefinition") &&
          !symbol.getName().startsWith("__@dependencyReferenceDefinition"),
      )
      .map((symbol) => {
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

function substitutedType(type: ts.Type, substitutions: ReadonlyMap<ts.Type, ts.Type>): ts.Type {
  const seen = new Set<ts.Type>();
  let current = type;
  while (!seen.has(current)) {
    seen.add(current);
    const next = substitutions.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
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
  staticBindings: Map<ts.Symbol, StaticValue>;
  providedNames: readonly string[];
  providedBinding?: ts.Symbol;
  constant?: (
    call: ts.CallExpression,
    awaited: boolean,
    bindings: ReadonlyMap<ts.Symbol, StaticValue>,
    types: ReadonlyMap<ts.Type, ts.Type>,
  ) => ExtensionIR | undefined;
  extensionCall?: (
    call: ts.CallExpression,
    awaited: boolean,
    bindings: ReadonlyMap<ts.Symbol, StaticValue>,
    types: ReadonlyMap<ts.Type, ts.Type>,
    type: TypeIR,
    span: SourceSpan,
    lower: (expression: ts.Expression) => ExpressionIR,
  ) => PortableCallCompilation | undefined;
}>;

function lowerPortableType(lowering: PortableLowering, type: ts.Type, at: ts.Node): TypeIR {
  return lowerType(lowering.checker, type, at, new Set(), "contract", lowering.typeSubstitutions);
}

function createPortableLowering(
  checker: ts.TypeChecker,
  staticBindings: ReadonlyMap<ts.Symbol, StaticValue> = new Map(),
  typeSubstitutions: ReadonlyMap<ts.Type, ts.Type> = new Map(),
  providedNames: readonly string[] = [],
  constant?: PortableLowering["constant"],
  extensionCall?: PortableLowering["extensionCall"],
): PortableLowering {
  return {
    checker,
    functions: new Map(),
    active: new Set(),
    activeStatic: new Set(),
    typeOverrides: new Map(),
    irTypeOverrides: new Map(),
    typeSubstitutions: new Map(typeSubstitutions),
    staticBindings: flattenStaticBindings(staticBindings),
    providedNames,
    ...(constant ? { constant } : {}),
    ...(extensionCall ? { extensionCall } : {}),
  };
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
    const irType = options.parameterIRTypes?.[index];
    if (ts.isIdentifier(parameter.name)) {
      const symbol = lowering.checker.getSymbolAtLocation(parameter.name);
      if (!symbol) continue;
      if (type) {
        overrides.push({ symbol, previous: lowering.typeOverrides.get(symbol) });
        lowering.typeOverrides.set(symbol, type);
      }
      if (!irType) continue;
      irOverrides.push({ symbol, previous: lowering.irTypeOverrides.get(symbol) });
      lowering.irTypeOverrides.set(symbol, irType);
      continue;
    }
    if (!ts.isObjectBindingPattern(parameter.name) || irType?.kind !== "record") continue;
    for (const element of parameter.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const property = element.propertyName?.getText() ?? element.name.text;
      const field = irType.fields.find(({ name }) => name === property);
      const symbol = lowering.checker.getSymbolAtLocation(element.name);
      if (!field || !symbol) continue;
      irOverrides.push({ symbol, previous: lowering.irTypeOverrides.get(symbol) });
      lowering.irTypeOverrides.set(symbol, field.type);
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
    return destructuredObjectBindings(
      parameter.name,
      {
        kind: "local",
        name: parameters[index]!.name,
        type: parameterType,
        span: spanOf(parameter),
      },
      parameterType,
    );
  });
}

function destructuredObjectBindings(
  pattern: ts.ObjectBindingPattern,
  source: ExpressionIR,
  sourceType: TypeIR,
): readonly StatementIR[] {
  return pattern.elements.flatMap((element): readonly StatementIR[] => {
    if (element.dotDotDotToken || element.initializer) {
      throw diagnostic(element, "Portable object bindings do not support rest or default values.");
    }
    const property = element.propertyName
      ? ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
        ? element.propertyName.text
        : undefined
      : ts.isIdentifier(element.name)
        ? element.name.text
        : undefined;
    if (!property) throw diagnostic(element, "Portable object binding keys must be static.");
    const field = portableField(sourceType, property);
    if (!field) throw diagnostic(element, `Unknown portable parameter field ${property}.`);
    const value: ExpressionIR = {
      kind: "property",
      value: source,
      name: property,
      type: field.type,
      span: spanOf(element),
    };
    if (ts.isIdentifier(element.name)) {
      return [
        {
          kind: "let",
          name: element.name.text,
          mutable: false,
          value,
          span: spanOf(element),
        },
      ];
    }
    if (ts.isObjectBindingPattern(element.name)) {
      return destructuredObjectBindings(element.name, value, field.type);
    }
    throw diagnostic(element.name, "Portable object bindings may nest only object patterns.");
  });
}

function portableField(type: TypeIR, name: string): FieldIR | undefined {
  if (type.kind === "record") return type.fields.find((field) => field.name === name);
  if (type.kind !== "union") return undefined;
  const fields = type.variants.map((variant) => portableField(variant, name));
  if (fields.some((field) => field === undefined)) return undefined;
  const present = fields as readonly FieldIR[];
  const variants = [
    ...new Map(present.map((field) => [JSON.stringify(field.type), field.type])).values(),
  ];
  return {
    name,
    optional: present.some(({ optional }) => optional),
    type: variants.length === 1 ? variants[0]! : { kind: "union", variants },
  };
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
        const value = declaration.initializer
          ? lowerExpression(lowering, declaration.initializer, dependenciesName)
          : {
              kind: "none" as const,
              type: lowerPortableType(
                lowering,
                lowering.checker.getTypeAtLocation(declaration),
                declaration,
              ),
              span: spanOf(declaration),
            };
        if (value.kind === "concurrent") {
          const symbol = lowering.checker.getSymbolAtLocation(declaration.name);
          if (symbol) lowering.irTypeOverrides.set(symbol, value.type);
        }
        return {
          kind: "let",
          name: declaration.name.text,
          mutable: (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          value,
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
        if (ts.isIdentifier(statement.expression.left)) {
          return {
            kind: "assign",
            name: statement.expression.left.text,
            operator: assignmentOperator(statement.expression.operatorToken)!,
            value: lowerExpression(lowering, statement.expression.right, dependenciesName),
            span,
          };
        }
        if (ts.isPropertyAccessExpression(statement.expression.left)) {
          return {
            kind: "property-assign",
            target: lowerExpression(
              lowering,
              statement.expression.left.expression,
              dependenciesName,
            ),
            property: statement.expression.left.name.text,
            operator: assignmentOperator(statement.expression.operatorToken)!,
            value: lowerExpression(lowering, statement.expression.right, dependenciesName),
            span,
          };
        }
        if (ts.isElementAccessExpression(statement.expression.left)) {
          const category = portableTypeCategory(
            lowering.checker,
            lowering.checker.getTypeAtLocation(statement.expression.left.argumentExpression),
          );
          if (category !== "string" && category !== "number") {
            throw diagnostic(
              statement.expression.left,
              "Portable record indexes must be strings or numbers.",
            );
          }
          return {
            kind: "index-assign",
            target: lowerExpression(
              lowering,
              statement.expression.left.expression,
              dependenciesName,
            ),
            index: lowerExpression(
              lowering,
              statement.expression.left.argumentExpression,
              dependenciesName,
            ),
            operator: assignmentOperator(statement.expression.operatorToken)!,
            value: lowerExpression(lowering, statement.expression.right, dependenciesName),
            span,
          };
        }
        throw diagnostic(
          statement.expression.left,
          "Portable assignment targets must be local bindings or named properties.",
        );
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
      if (
        asynchronous
          ? values.type.kind !== "stream"
          : values.type.kind !== "array" && values.type.kind !== "tuple"
      ) {
        throw diagnostic(
          statement.expression,
          asynchronous
            ? "Portable for-await-of requires an asynchronous stream."
            : "Portable for-of requires an array value.",
        );
      }
      let itemType: TypeIR;
      if (values.type.kind === "stream" || values.type.kind === "array") {
        itemType = values.type.element;
      } else if (values.type.kind === "tuple") {
        itemType =
          values.type.elements.length === 1
            ? values.type.elements[0]!
            : { kind: "union", variants: values.type.elements };
      } else {
        throw new Error("Validated iteration type was lost.");
      }
      const symbol = lowering.checker.getSymbolAtLocation(declaration.name);
      const previous = symbol ? lowering.irTypeOverrides.get(symbol) : undefined;
      if (symbol) lowering.irTypeOverrides.set(symbol, itemType);
      let body: readonly StatementIR[];
      try {
        body = lowerStatementBody(lowering, statement.statement, dependenciesName);
      } finally {
        if (symbol) {
          if (previous) lowering.irTypeOverrides.set(symbol, previous);
          else lowering.irTypeOverrides.delete(symbol);
        }
      }
      return {
        kind: "for-of",
        ...(asynchronous ? { asynchronous: true as const } : {}),
        item: declaration.name.text,
        values,
        body,
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
    if (ts.isWhileStatement(statement)) {
      return {
        kind: "while",
        condition: booleanExpression(lowering, statement.expression, dependenciesName),
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
        ...(statement.catchClause
          ? {
              catch: {
                ...(variable && ts.isIdentifier(variable.name)
                  ? { error: variable.name.text }
                  : {}),
                body: caught,
              },
            }
          : {}),
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
    const referenceCall = lowerDependencyReferenceCall(
      lowering,
      expression.expression,
      dependenciesName,
      true,
    );
    if (referenceCall) return referenceCall;
    const call = lowerDependencyCall(lowering, expression.expression, dependenciesName, true);
    if (call) return typedExpression(lowering, expression, { ...call, awaited: true });
    if (ts.isCallExpression(expression.expression)) {
      return lowerPortableCall(lowering, expression.expression, dependenciesName, true, expression);
    }
    throw diagnostic(expression, "Only portable calls may be awaited.");
  }
  const reference = lowerDependencyReference(lowering, expression, dependenciesName);
  if (reference) return reference;
  const referenceCall = lowerDependencyReferenceCall(lowering, expression, dependenciesName, false);
  if (referenceCall) return referenceCall;
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
    if (symbol && symbol === lowering.providedBinding) {
      const span = spanOf(expression);
      return {
        kind: "array",
        values: lowering.providedNames.map(
          (name): ExpressionIR => ({
            kind: "literal",
            value: name,
            type: { kind: "literal", value: name },
            span,
          }),
        ),
        type: lowerPortableType(lowering, checker.getTypeAtLocation(expression), expression),
        span,
      };
    }
    const binding = symbol ? staticBinding(lowering, symbol) : undefined;
    if (binding?.node && ts.isExpression(binding.node)) {
      return lowerStaticValue(lowering, symbol, binding, dependenciesName, expression);
    }
    const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
    const owner = declaration ? enclosingFunction(declaration) : undefined;
    if (symbol && declaration?.initializer && !owner) {
      const staticValue = resolveStaticValue(
        checker,
        {
          node: declaration.initializer,
          bindings: lowering.staticBindings,
          types: lowering.typeSubstitutions,
        },
        new Set(),
      );
      if (staticValue?.node && ts.isExpression(staticValue.node) && !owner) {
        return lowerStaticValue(lowering, symbol, staticValue, dependenciesName, expression);
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
    const name =
      wellKnownMemberExpression(expression.argumentExpression) ??
      portableComputedName(lowering, expression.argumentExpression);
    if (!name) {
      const index = lowerExpression(lowering, expression.argumentExpression, dependenciesName);
      const category = portableTypeCategory(
        lowering.checker,
        lowering.checker.getTypeAtLocation(expression.argumentExpression),
      );
      if (category !== "string" && category !== "number") {
        throw diagnostic(expression, "Portable record indexes must be strings or numbers.");
      }
      return typedExpression(lowering, expression, {
        kind: "index",
        value: lowerExpression(lowering, expression.expression, dependenciesName),
        index,
      });
    }
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

function lowerStaticValue(
  lowering: PortableLowering,
  symbol: ts.Symbol | undefined,
  binding: StaticValue,
  dependenciesName: string,
  at: ts.Node,
): ExpressionIR {
  if (!ts.isExpression(binding.node)) {
    throw diagnostic(at, "Static portable bindings must resolve to expressions.");
  }
  const value = unwrapExpression(binding.node);
  if (symbol && lowering.activeStatic.has(symbol)) {
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      const captures = capturedSymbols(lowering, value);
      return typedExpression(lowering, at, {
        kind: "closure",
        function: `closure/${semanticNodeKey(value)}`,
        captures: captures.map((capture) => captureExpression(lowering, capture)),
        stable: true,
      });
    }
    throw diagnostic(at, `Recursive static binding ${symbol.getName()}.`);
  }
  if (symbol) lowering.activeStatic.add(symbol);
  const bindingChanges: Array<Readonly<{ symbol: ts.Symbol; previous?: StaticValue }>> = [];
  const typeChanges: Array<Readonly<{ source: ts.Type; previous?: ts.Type }>> = [];
  try {
    for (const [nested, value] of flattenStaticBindings(binding.bindings)) {
      bindingChanges.push({ symbol: nested, previous: lowering.staticBindings.get(nested) });
      lowering.staticBindings.set(nested, value);
    }
    for (const [source, target] of binding.types ?? []) {
      typeChanges.push({ source, previous: lowering.typeSubstitutions.get(source) });
      lowering.typeSubstitutions.set(source, target);
    }
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      return lowerClosure(lowering, value, dependenciesName, true);
    }
    return lowerExpression(lowering, binding.node, dependenciesName);
  } finally {
    for (const { source, previous } of typeChanges.reverse()) {
      if (previous) lowering.typeSubstitutions.set(source, previous);
      else lowering.typeSubstitutions.delete(source);
    }
    for (const { symbol: nested, previous } of bindingChanges.reverse()) {
      if (previous) lowering.staticBindings.set(nested, previous);
      else lowering.staticBindings.delete(nested);
    }
    if (symbol) lowering.activeStatic.delete(symbol);
  }
}

function flattenStaticBindings(
  bindings: ReadonlyMap<ts.Symbol, StaticValue>,
): Map<ts.Symbol, StaticValue> {
  const result = new Map<ts.Symbol, StaticValue>();
  const active = new Set<StaticValue>();
  const visit = (source: ReadonlyMap<ts.Symbol, StaticValue>): void => {
    for (const [symbol, value] of source) {
      if (!result.has(symbol)) result.set(symbol, value);
      if (active.has(value)) continue;
      active.add(value);
      visit(value.bindings);
      active.delete(value);
    }
  };
  visit(bindings);
  return result;
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
  deferred = false,
): Extract<ExpressionIR, { kind: "dependency-call" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const operation = node.expression.name.text;
  const owner = node.expression.expression;
  const dependency = dependencyAccessName(lowering, owner, dependenciesName);
  if (dependency === undefined) return undefined;
  const argument = node.arguments[0];
  const argumentType = argument
    ? lowerPortableType(lowering, lowering.checker.getTypeAtLocation(argument), argument)
    : undefined;
  const options = node.arguments[1];
  const optionsType = options
    ? lowerPortableType(lowering, lowering.checker.getTypeAtLocation(options), options)
    : undefined;
  if (
    argument === undefined ||
    node.arguments.length < 1 ||
    node.arguments.length > 2 ||
    argumentType?.kind !== "record" ||
    (options !== undefined && optionsType?.kind !== "record")
  ) {
    throw diagnostic(
      node,
      "Portable Dependency operations require one object argument and optional call options.",
    );
  }
  const result = lowering.checker.getTypeAtLocation(node);
  const promise = isPromiseType(lowering.checker, result);
  if (promise && !awaited && !deferred) {
    throw diagnostic(node, "Asynchronous Dependency operations must be awaited.");
  }
  return {
    kind: "dependency-call",
    dependency,
    operation,
    arguments: [lowerExpression(lowering, argument, dependenciesName)],
    ...(options === undefined
      ? {}
      : { options: lowerExpression(lowering, options, dependenciesName) }),
    awaited,
    type: lowerPortableType(lowering, result, node),
    span: spanOf(node),
  };
}

function lowerDependencyReference(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
): Extract<ExpressionIR, { kind: "dependency-reference" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const owner = node.expression.expression;
  const dependency = dependencyAccessName(lowering, owner, dependenciesName);
  if (dependency === undefined) return undefined;
  const definition =
    dependencyReferenceType(lowering.checker, lowering.checker.getTypeAtLocation(node), node) ??
    dependencyContractReferenceType(
      lowering.checker,
      lowering.checker.getTypeAtLocation(owner),
      owner,
    );
  if (!definition || definition.name !== node.expression.name.text) return undefined;
  const binding = node.arguments[0];
  if (
    node.arguments.length !== 1 ||
    !binding ||
    lowerPortableType(lowering, lowering.checker.getTypeAtLocation(binding), binding).kind !==
      "record"
  ) {
    throw diagnostic(node, "Dependency references require one binding object.");
  }
  return {
    kind: "dependency-reference",
    dependency,
    binding: lowerExpression(lowering, binding, dependenciesName),
    type: { kind: "opaque", name: "DependencyReference" },
    span: spanOf(node),
  };
}

function dependencyAccessName(
  lowering: PortableLowering,
  owner: ts.Expression,
  dependenciesName: string,
): string | undefined {
  if (ts.isPropertyAccessExpression(owner) && ts.isIdentifier(owner.expression)) {
    return owner.expression.text === dependenciesName ? owner.name.text : undefined;
  }
  if (!ts.isElementAccessExpression(owner) || !ts.isIdentifier(owner.expression)) {
    return undefined;
  }
  if (owner.expression.text !== dependenciesName) return undefined;
  const name = portableComputedName(lowering, owner.argumentExpression);
  if (name === undefined) {
    throw diagnostic(
      owner.argumentExpression,
      "Portable Dependency names must resolve to a compile-time string or number.",
    );
  }
  return name;
}

function lowerDependencyReferenceCall(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
  awaited: boolean,
  deferred = false,
): Extract<ExpressionIR, { kind: "dependency-reference-call" }> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return undefined;
  const receiver = node.expression.expression;
  const definition = dependencyReferenceExpressionType(lowering.checker, receiver);
  if (!definition) return undefined;
  const operation = node.expression.name.text;
  const hasInput =
    definition.inputs.has(operation) ||
    (definition.inputs.size === 0 &&
      lowering.checker.getResolvedSignature(node)?.parameters[0]?.getName() ===
        definition.argument);
  const minimum = hasInput ? 1 : 0;
  const maximum = hasInput ? 2 : 1;
  if (node.arguments.length < minimum || node.arguments.length > maximum) {
    throw diagnostic(
      node,
      hasInput
        ? "Referenced Dependency methods require one product input and optional call options."
        : "Referenced Dependency methods accept only optional call options.",
    );
  }
  for (const argument of node.arguments) {
    if (
      lowerPortableType(lowering, lowering.checker.getTypeAtLocation(argument), argument).kind !==
      "record"
    ) {
      throw diagnostic(node, "Referenced Dependency method arguments must be objects.");
    }
  }
  const result = lowering.checker.getTypeAtLocation(node);
  const promise = isPromiseType(lowering.checker, result);
  if (promise && !awaited && !deferred) {
    throw diagnostic(node, "Asynchronous Dependency operations must be awaited.");
  }
  return {
    kind: "dependency-reference-call",
    reference: lowerExpression(lowering, receiver, dependenciesName),
    operation,
    ...(hasInput && node.arguments[0]
      ? { input: lowerExpression(lowering, node.arguments[0], dependenciesName) }
      : {}),
    ...((hasInput ? node.arguments[1] : node.arguments[0])
      ? {
          options: lowerExpression(
            lowering,
            (hasInput ? node.arguments[1] : node.arguments[0])!,
            dependenciesName,
          ),
        }
      : {}),
    argument: definition.argument,
    awaited,
    type: lowerPortableType(lowering, result, node),
    span: spanOf(node),
  };
}

function dependencyReferenceType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
):
  | Readonly<{
      name: string;
      argument: string;
      inputs: ReadonlySet<string>;
    }>
  | undefined {
  const marker = type
    .getProperties()
    .find((property) => property.getName().startsWith("__@dependencyReferenceDefinition"));
  if (!marker) return undefined;
  const definition = checker.getTypeOfSymbolAtLocation(marker, marker.valueDeclaration ?? at);
  return dependencyReferenceDefinitionType(checker, definition, at);
}

function dependencyReferenceExpressionType(
  checker: ts.TypeChecker,
  expression: ts.Expression,
):
  | Readonly<{
      name: string;
      argument: string;
      inputs: ReadonlySet<string>;
    }>
  | undefined {
  const direct = dependencyReferenceType(
    checker,
    checker.getTypeAtLocation(expression),
    expression,
  );
  if (direct) return direct;
  const value = unwrapExpression(expression);
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)) {
    return undefined;
  }
  const definition = dependencyContractReferenceType(
    checker,
    checker.getTypeAtLocation(value.expression.expression),
    value.expression.expression,
  );
  return definition?.name === value.expression.name.text ? definition : undefined;
}

function dependencyContractReferenceType(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
):
  | Readonly<{
      name: string;
      argument: string;
      inputs: ReadonlySet<string>;
    }>
  | undefined {
  const marker = type
    .getProperties()
    .find((property) => property.getName().startsWith("__@dependencyDefinition"));
  if (!marker) return undefined;
  const definition = checker.getNonNullableType(
    checker.getTypeOfSymbolAtLocation(marker, marker.valueDeclaration ?? at),
  );
  const reference = propertyType(checker, definition, "Reference", at);
  return reference ? dependencyReferenceDefinitionType(checker, reference, at) : undefined;
}

function dependencyReferenceDefinitionType(
  checker: ts.TypeChecker,
  definition: ts.Type,
  at: ts.Node,
):
  | Readonly<{
      name: string;
      argument: string;
      inputs: ReadonlySet<string>;
    }>
  | undefined {
  const name = literalProperty(checker, definition, "Name", at);
  const argument = literalProperty(checker, definition, "Argument", at);
  const inputs = propertyType(checker, definition, "Inputs", at);
  if (typeof name !== "string" || typeof argument !== "string" || !inputs) return undefined;
  return {
    name,
    argument,
    inputs: new Set(
      inputs.getProperties().flatMap((input) => {
        const inputType = checker.getTypeOfSymbolAtLocation(input, input.valueDeclaration ?? at);
        return inputType.flags & ts.TypeFlags.Undefined ? [] : [input.getName()];
      }),
    ),
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
  const composition = standardPromiseComposition(lowering, call.expression);
  if (composition) {
    if (!awaited) {
      throw diagnostic(call, `Portable Promise.${composition} must be awaited.`);
    }
    const argument = call.arguments[0] && unwrapExpression(call.arguments[0]);
    if (call.arguments.length !== 1 || !argument || !ts.isArrayLiteralExpression(argument)) {
      throw diagnostic(call, `Portable Promise.${composition} requires one inline array.`);
    }
    if (argument.elements.some(ts.isSpreadElement)) {
      throw diagnostic(
        argument,
        `Portable Promise.${composition} does not support spread elements.`,
      );
    }
    if (composition === "race" && !argument.elements.length) {
      throw diagnostic(call, "Portable Promise.race requires at least one operation.");
    }
    const values = argument.elements.map((value) =>
      lowerConcurrentOperation(lowering, value, dependenciesName),
    );
    const operation = composition === "allSettled" ? "all-settled" : composition;
    return {
      kind: "concurrent",
      operation,
      values,
      type:
        operation === "all-settled"
          ? settledResultsType(values)
          : lowerPortableType(lowering, lowering.checker.getTypeAtLocation(typeNode), typeNode),
      span: spanOf(typeNode),
    };
  }
  const intrinsic = portableIntrinsic(lowering, call.expression);
  if (intrinsic === "dependency-dispatch") {
    if (!awaited || call.arguments.length < 3 || call.arguments.length > 4) {
      throw diagnostic(
        call,
        "dispatchDependency requires a Dependency, operation, input, optional call options, and must be awaited.",
      );
    }
    return {
      kind: "dependency-dispatch",
      dependency: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
      operation: lowerExpression(lowering, call.arguments[1]!, dependenciesName),
      input: lowerExpression(lowering, call.arguments[2]!, dependenciesName),
      ...(call.arguments[3]
        ? { options: lowerExpression(lowering, call.arguments[3], dependenciesName) }
        : {}),
      awaited: true,
      type: lowerPortableType(lowering, lowering.checker.getTypeAtLocation(typeNode), typeNode),
      span: spanOf(typeNode),
    };
  }
  if (intrinsic === "dependency-intercept") {
    if (awaited || call.arguments.length !== 2) {
      throw diagnostic(
        call,
        "interceptDependency requires a Dependency and interceptor and cannot be awaited.",
      );
    }
    return {
      kind: "dependency-intercept",
      dependency: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
      intercept: lowerExpression(lowering, call.arguments[1]!, dependenciesName),
      type: lowerPortableType(lowering, lowering.checker.getTypeAtLocation(typeNode), typeNode),
      span: spanOf(typeNode),
    };
  }
  if (intrinsic === "data-kind") {
    if (awaited || call.arguments.length !== 1) {
      throw diagnostic(call, "dataKind requires one value and cannot be awaited.");
    }
    return typedExpression(lowering, typeNode, {
      kind: "data-kind",
      value: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
    });
  }
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
    call.expression.expression.text === "Object" &&
    call.expression.name.text === "keys"
  ) {
    if (awaited || call.arguments.length !== 1) {
      throw diagnostic(call, "Portable Object.keys requires one argument and cannot be awaited.");
    }
    return typedExpression(lowering, typeNode, {
      kind: "object-keys",
      value: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
    });
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
  if (intrinsic === "type-literal") {
    if (awaited || call.arguments.length || call.typeArguments?.length !== 1) {
      throw diagnostic(call, "typeLiteral requires one literal type argument and no values.");
    }
    const type = lowerPortableType(
      lowering,
      lowering.checker.getTypeFromTypeNode(call.typeArguments[0]!),
      call,
    );
    if (type.kind !== "literal") {
      throw diagnostic(
        call,
        `typeLiteral requires one resolved string, number, or boolean literal; received ${lowering.checker.typeToString(
          lowering.checker.getTypeFromTypeNode(call.typeArguments[0]!),
        )}.`,
      );
    }
    return {
      kind: "literal",
      value: type.value,
      type,
      span: spanOf(call),
    };
  }
  if (intrinsic === "type-schema") {
    if (awaited || call.arguments.length || call.typeArguments?.length !== 1) {
      throw diagnostic(call, "typeSchema requires one resolved type argument and no values.");
    }
    return portableDataExpression(
      lowerPortableType(
        lowering,
        lowering.checker.getTypeFromTypeNode(call.typeArguments[0]!),
        call,
      ),
      spanOf(call),
    );
  }
  if (intrinsic === "type-keys") {
    if (awaited || call.arguments.length || call.typeArguments?.length !== 1) {
      throw diagnostic(call, "typeKeys requires one resolved record type argument and no values.");
    }
    const source = lowering.checker.getTypeFromTypeNode(call.typeArguments[0]!);
    const type = lowerPortableType(lowering, source, call);
    if (type.kind !== "record") {
      throw diagnostic(
        call,
        `typeKeys requires one resolved record type; received ${lowering.checker.typeToString(
          source,
        )}.`,
      );
    }
    return {
      kind: "array",
      values: type.fields.map(({ name }) => ({
        kind: "literal",
        value: name,
        type: { kind: "literal", value: name },
        span: spanOf(call),
      })),
      type: { kind: "array", element: primitive("string") },
      span: spanOf(call),
    };
  }
  if (intrinsic === "stream-map") {
    if (call.arguments.length !== 2) {
      throw diagnostic(call, "mapStream requires a source and transform.");
    }
    return typedExpression(lowering, typeNode, {
      kind: "stream-map",
      source: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
      transform: lowerExpression(lowering, call.arguments[1]!, dependenciesName),
    });
  }
  if (intrinsic === "stream-distinct") {
    if (call.arguments.length !== 2) {
      throw diagnostic(call, "distinctStream requires a source and selector.");
    }
    return typedExpression(lowering, typeNode, {
      kind: "stream-distinct",
      source: lowerExpression(lowering, call.arguments[0]!, dependenciesName),
      select: lowerExpression(lowering, call.arguments[1]!, dependenciesName),
    });
  }
  const constant = lowering.constant?.(
    call,
    awaited,
    lowering.staticBindings,
    lowering.typeSubstitutions,
  );
  if (constant !== undefined) {
    if (awaited) {
      throw diagnostic(call, "Compiler extension constants cannot be awaited.");
    }
    return portableDataExpression(constant, spanOf(typeNode));
  }
  const extensionCall = lowering.extensionCall?.(
    call,
    awaited,
    lowering.staticBindings,
    lowering.typeSubstitutions,
    lowerPortableType(lowering, lowering.checker.getTypeAtLocation(typeNode), typeNode),
    spanOf(typeNode),
    (expression) => lowerExpression(lowering, expression, dependenciesName),
  );
  if (extensionCall) {
    for (const function_ of extensionCall.functions ?? []) {
      const existing = lowering.functions.get(function_.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(function_)) {
        throw diagnostic(
          call,
          `Compiler extension generated conflicting portable function ${JSON.stringify(function_.id)}.`,
        );
      }
      lowering.functions.set(function_.id, function_);
    }
    return extensionCall.expression;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ["filter", "find", "findIndex", "map", "push", "slice", "some", "sort"].includes(
      call.expression.name.text,
    ) &&
    lowering.checker.isArrayLikeType(lowering.checker.getTypeAtLocation(call.expression.expression))
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
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    dynamicPortableReceiver(lowering, call.expression.expression) &&
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
  const captures = capturedSymbols(lowering, direct.functionLike);
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

function lowerConcurrentOperation(
  lowering: PortableLowering,
  node: ts.Expression,
  dependenciesName: string,
): ExpressionIR {
  const expression = unwrapExpression(node);
  const reference = lowerDependencyReferenceCall(
    lowering,
    expression,
    dependenciesName,
    false,
    true,
  );
  const dependency = lowerDependencyCall(lowering, expression, dependenciesName, false, true);
  const operation =
    reference ??
    dependency ??
    (ts.isCallExpression(expression)
      ? lowerPortableCall(lowering, expression, dependenciesName, false)
      : undefined);
  if (
    !operation ||
    operation.type.kind !== "promise" ||
    ![
      "call",
      "dependency-call",
      "dependency-dispatch",
      "dependency-reference-call",
      "invoke",
      "method-call",
    ].includes(operation.kind)
  ) {
    throw diagnostic(
      node,
      "Portable Promise composition accepts only direct asynchronous operations.",
    );
  }
  return operation;
}

function standardPromiseComposition(
  lowering: PortableLowering,
  expression: ts.Expression,
): "all" | "allSettled" | "race" | undefined {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Promise" ||
    !["all", "allSettled", "race"].includes(expression.name.text)
  ) {
    return undefined;
  }
  const symbol = lowering.checker.getSymbolAtLocation(expression.expression);
  if (
    !symbol?.declarations?.some((declaration) => {
      const source = declaration.getSourceFile();
      return source.hasNoDefaultLib || /(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
    })
  ) {
    return undefined;
  }
  return expression.name.text as "all" | "allSettled" | "race";
}

function settledResultsType(values: readonly ExpressionIR[]): TypeIR {
  const fulfilled = [
    ...new Map(
      values.map(({ type }) => {
        const value = type.kind === "promise" ? type.value : type;
        return [JSON.stringify(value), value] as const;
      }),
    ).values(),
  ];
  const value: TypeIR =
    fulfilled.length === 1 ? fulfilled[0]! : { kind: "union", variants: fulfilled };
  return {
    kind: "array",
    element: {
      kind: "union",
      variants: [
        {
          kind: "record",
          fields: [
            {
              name: "status",
              optional: false,
              type: { kind: "literal", value: "fulfilled" },
            },
            { name: "value", optional: false, type: value },
          ],
        },
        {
          kind: "record",
          fields: [
            {
              name: "status",
              optional: false,
              type: { kind: "literal", value: "rejected" },
            },
            {
              name: "reason",
              optional: false,
              type: { kind: "opaque", name: "Error" },
            },
          ],
        },
      ],
    },
  };
}

function portableMethod(
  lowering: PortableLowering,
  expression: ts.PropertyAccessExpression,
): boolean {
  const owner = lowering.checker.getTypeAtLocation(expression.expression);
  const category = portableTypeCategory(lowering.checker, owner);
  if (category === "string") {
    return ["slice", "startsWith", "trim"].includes(expression.name.text);
  }
  const member = owner.getProperty(expression.name.text);
  return Boolean(
    member?.declarations?.some((declaration) => {
      const source = declaration.getSourceFile();
      return !source.hasNoDefaultLib && !/(^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(source.fileName);
    }),
  );
}

function dynamicPortableReceiver(lowering: PortableLowering, expression: ts.Expression): boolean {
  let root = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
    root = unwrapExpression(root.expression);
  }
  if (!ts.isIdentifier(root)) return false;
  const symbol = valueSymbol(lowering.checker, root);
  if (!symbol || lowering.staticBindings.has(symbol)) return false;
  return Boolean(
    symbol.declarations?.some((declaration) => enclosingFunction(declaration) !== undefined),
  );
}

function portableIntrinsic(
  lowering: PortableLowering,
  expression: ts.Expression,
):
  | "dependency-dispatch"
  | "dependency-intercept"
  | "data-kind"
  | "stream-distinct"
  | "stream-map"
  | "type-keys"
  | "type-literal"
  | "type-schema"
  | undefined {
  const direct = directFunction(lowering, expression);
  if (!direct) return undefined;
  const file = direct.functionLike.getSourceFile().fileName.replaceAll("\\", "/");
  if (file.endsWith("/core/dependency.ts") && direct.symbol.getName() === "dispatchDependency") {
    return "dependency-dispatch";
  }
  if (file.endsWith("/core/dependency.ts") && direct.symbol.getName() === "interceptDependency") {
    return "dependency-intercept";
  }
  if (file.endsWith("/core/data.ts") && direct.symbol.getName() === "dataKind") {
    return "data-kind";
  }
  if (file.endsWith("/core/intrinsic.ts")) {
    if (direct.symbol.getName() === "typeLiteral") return "type-literal";
    if (direct.symbol.getName() === "typeSchema") return "type-schema";
    if (direct.symbol.getName() === "typeKeys") return "type-keys";
  }
  if (!["distinctStream", "mapStream"].includes(direct.symbol.getName())) return undefined;
  if (!file.endsWith("/core/stream.ts")) return undefined;
  return direct.symbol.getName() === "mapStream" ? "stream-map" : "stream-distinct";
}

function portableDataExpression(value: unknown, span: SourceSpan): ExpressionIR {
  if (value === null) {
    return { kind: "literal", value, type: primitive("null"), span };
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "literal", value, type: { kind: "literal", value }, span };
  }
  if (Array.isArray(value)) {
    const values = value.map((item) => portableDataExpression(item, span));
    return {
      kind: "array",
      values,
      type: { kind: "tuple", elements: values.map(({ type }) => type) },
      span,
    };
  }
  if (typeof value === "object") {
    const fields = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => ({ name, value: portableDataExpression(item, span) }));
    return {
      kind: "record",
      fields,
      type: {
        kind: "record",
        fields: fields.map(({ name, value: item }) => ({
          name,
          optional: false,
          type: item.type,
        })),
      },
      span,
    };
  }
  throw new TypeError(`Portable compiler data cannot contain ${typeof value}.`);
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
  const functionLike = symbol?.declarations
    ?.filter(
      (
        candidate,
      ): candidate is
        | ts.FunctionDeclaration
        | ts.VariableDeclaration
        | ts.PropertyAssignment
        | ts.MethodDeclaration =>
        ts.isFunctionDeclaration(candidate) ||
        ts.isVariableDeclaration(candidate) ||
        ts.isPropertyAssignment(candidate) ||
        ts.isMethodDeclaration(candidate),
    )
    .map(functionFromCallableDeclaration)
    .find((candidate): candidate is ts.FunctionLikeDeclaration => candidate !== undefined);
  return symbol && functionLike ? { symbol, functionLike } : undefined;
}

function functionFromDeclaration(
  declaration: ts.FunctionDeclaration | ts.VariableDeclaration,
): ts.FunctionLikeDeclaration | undefined {
  if (ts.isFunctionDeclaration(declaration)) return declaration.body ? declaration : undefined;
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
  stable = false,
): ExpressionIR {
  const signature = lowering.checker.getSignatureFromDeclaration(functionLike);
  if (!signature) throw diagnostic(functionLike, "Cannot resolve portable closure signature.");
  const localDependenciesName = dependencyContractBinding(lowering, functionLike.parameters[0]);
  const scopedDependenciesName =
    localDependenciesName ??
    (ownsBinding(functionLike, dependenciesName) ? "@dependencies" : dependenciesName);
  const captures = capturedSymbols(lowering, functionLike);
  const id = `closure/${semanticNodeKey(functionLike)}`;
  if (!lowering.functions.has(id)) {
    lowering.functions.set(
      id,
      lowerFunction(lowering, functionLike, {
        id,
        name: "closure",
        dependenciesName: scopedDependenciesName,
        signature,
        captures,
      }),
    );
  }
  return typedExpression(lowering, functionLike, {
    kind: "closure",
    function: id,
    captures: captures.map((capture) => captureExpression(lowering, capture)),
    ...(stable ? { stable: true } : {}),
  });
}

function capturedSymbols(
  lowering: PortableLowering,
  functionLike: ts.FunctionLikeDeclaration,
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

function semanticNodeKey(node: ts.Node): string {
  const path: string[] = [];
  let current = node;
  while (!ts.isSourceFile(current)) {
    const parent = current.parent;
    if (!parent) throw diagnostic(current, "Portable declaration has no source ancestry.");
    let childIndex = -1;
    let index = 0;
    parent.forEachChild((child) => {
      if (child === current) childIndex = index;
      index += 1;
    });
    if (childIndex < 0) {
      throw diagnostic(current, "Portable declaration has no semantic source position.");
    }
    path.push(`${current.kind}.${childIndex}`);
    current = parent;
  }
  return `${current.fileName}#${path.reverse().join("/")}`;
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
  const symbol =
    ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? (checker.getShorthandAssignmentValueSymbol(node.parent) ??
        checker.getSymbolAtLocation(node))
      : checker.getSymbolAtLocation(node);
  return symbol?.flags && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function portableFunctionId(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  declaration: ts.FunctionLikeDeclaration,
  parameterTypes: readonly ts.Type[],
): string {
  const parameters = parameterTypes.map((type) => checker.typeToString(type)).join(",");
  return `function/${semanticNodeKey(declaration)}/${symbol.getName()}(${parameters})`;
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
  return contextBindingName(parameter, "dependencies");
}

function contextBindingName(
  parameter: ts.ParameterDeclaration | undefined,
  name: string,
): string | undefined {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  for (const binding of parameter.name.elements) {
    const source = binding.propertyName ? memberName(binding) : memberName(binding);
    if (source === name && ts.isIdentifier(binding.name)) return binding.name.text;
  }
  return undefined;
}

function contextBindingSymbol(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration | undefined,
  name: string,
): ts.Symbol | undefined {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const binding = parameter.name.elements.find(
    (element) =>
      (element.propertyName ? memberName(element) : memberName(element)) === name &&
      ts.isIdentifier(element.name),
  );
  return binding && ts.isIdentifier(binding.name)
    ? checker.getSymbolAtLocation(binding.name)
    : undefined;
}

function dependencyContractBinding(
  lowering: PortableLowering,
  parameter: ts.ParameterDeclaration | undefined,
): string | undefined {
  const name = dependencyBinding(parameter);
  if (!name || !parameter || !ts.isObjectBindingPattern(parameter.name)) return undefined;
  const binding = parameter.name.elements.find(
    (element) =>
      (element.propertyName ? memberName(element) : memberName(element)) === "dependencies" &&
      ts.isIdentifier(element.name),
  );
  if (!binding || !ts.isIdentifier(binding.name)) return undefined;
  return dependencyContractType(
    lowering,
    lowering.checker.getTypeAtLocation(binding.name),
    binding.name,
  )
    ? name
    : undefined;
}

type MappedTypeShape = ts.Type &
  Readonly<{
    target?: MappedTypeShape;
    templateType?: ts.Type;
  }>;

function dependencyContractType(
  lowering: PortableLowering,
  source: ts.Type,
  at: ts.Node,
  active: Set<ts.Type> = new Set(),
): boolean {
  const type = substitutedType(source, lowering.typeSubstitutions);
  if (active.has(type)) return false;
  active.add(type);
  try {
    const values = type.getProperties();
    if (values.length > 0) {
      return values.every((property) =>
        dependencyAPIType(
          lowering,
          lowering.checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? at),
        ),
      );
    }
    const indexed = [type.getStringIndexType(), type.getNumberIndexType()].filter(
      (value): value is ts.Type => value !== undefined,
    );
    if (indexed.length > 0) {
      return indexed.every((value) => dependencyAPIType(lowering, value));
    }

    const mapped = type as MappedTypeShape;
    const template = mapped.templateType ?? mapped.target?.templateType;
    if (!template) return false;
    if (dependencyAPIType(lowering, template)) return true;
    if (!(template.flags & ts.TypeFlags.IndexedAccess)) return false;

    const owner = (template as ts.IndexedAccessType).objectType;
    const alias = type.aliasSymbol;
    const arguments_ = type.aliasTypeArguments;
    const declaration = alias?.declarations?.find(ts.isTypeAliasDeclaration);
    if (!arguments_ || !declaration?.typeParameters) return false;
    const ownerSymbol = owner.symbol;
    const index = declaration.typeParameters.findIndex(
      (parameter) =>
        lowering.checker.getSymbolAtLocation(parameter.name) === ownerSymbol ||
        parameter.name.text === ownerSymbol?.getName(),
    );
    const argument = index >= 0 ? arguments_[index] : undefined;
    return argument ? dependencyContractType(lowering, argument, at, active) : false;
  } finally {
    active.delete(type);
  }
}

function dependencyAPIType(lowering: PortableLowering, source: ts.Type): boolean {
  const type = substitutedType(source, lowering.typeSubstitutions);
  return type
    .getProperties()
    .some((property) => property.getName().startsWith("__@dependencyDefinition"));
}

function ownsBinding(functionLike: ts.FunctionLikeDeclaration, name: string): boolean {
  const contains = (binding: ts.BindingName): boolean => {
    if (ts.isIdentifier(binding)) return binding.text === name;
    return binding.elements.some(
      (element) => !ts.isOmittedExpression(element) && contains(element.name),
    );
  };
  if (functionLike.parameters.some((parameter) => contains(parameter.name))) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== functionLike && ts.isFunctionLike(node))) return;
    if (ts.isVariableDeclaration(node) && contains(node.name)) {
      found = true;
      return;
    }
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      contains(node.variableDeclaration.name)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (functionLike.body) visit(functionLike.body);
  return found;
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

function retainedApplicationCompilerContract(
  checker: ts.TypeChecker,
  application: ts.Type,
  at: ts.Node,
): ts.Type {
  for (const symbol of application.getProperties()) {
    const retained = symbol.declarations?.some((declaration) => {
      if (!ts.isPropertySignature(declaration) || !ts.isComputedPropertyName(declaration.name)) {
        return false;
      }
      return (
        ts.isIdentifier(declaration.name.expression) &&
        declaration.name.expression.text === "applicationContract"
      );
    });
    if (!retained) continue;
    return fieldValueType(checker.getTypeOfSymbolAtLocation(symbol, at), true);
  }
  throw diagnostic(
    at,
    "System Applications must be created by createApplication with an exact contract.",
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

function numberLiteralProperty(
  checker: ts.TypeChecker,
  owner: ts.Type,
  name: string,
  at: ts.Node,
): number {
  const type = propertyType(checker, owner, name, at);
  if (type && type.flags & ts.TypeFlags.NumberLiteral) {
    return (type as ts.NumberLiteralType).value;
  }
  throw diagnostic(at, `${name} must be a number literal.`);
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
  const variable = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (variable?.initializer) return unwrapExpression(variable.initializer);
  const exported = symbol?.declarations?.find(ts.isExportAssignment);
  if (exported) return unwrapExpression(exported.expression);
  throw diagnostic(identifier, `Cannot resolve ${identifier.text}.`);
}

type StaticValue = Readonly<{
  node: ts.Node;
  bindings: ReadonlyMap<ts.Symbol, StaticValue>;
  types?: ReadonlyMap<ts.Type, ts.Type>;
}>;

function sourceIdentity(node: ts.Node): string {
  const source = node.getSourceFile();
  return `${canonicalSourceFile(source.fileName)}:${node.getStart(source)}:${node.getEnd()}`;
}

function staticValueIdentity(value: StaticValue): string {
  const seen = new Set<ts.Node>();
  const visit = (current: StaticValue): string => {
    if (seen.has(current.node)) return sourceIdentity(current.node);
    seen.add(current.node);
    const bindings = [...current.bindings.entries()]
      .sort(([left], [right]) => left.getName().localeCompare(right.getName()))
      .map(([symbol, bound]) => `${symbol.getName()}=${visit(bound)}`)
      .join(",");
    return `${sourceIdentity(current.node)}${bindings ? `{${bindings}}` : ""}`;
  };
  return visit(value);
}

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

function resolveFeatureMember(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  member: string,
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
        ? resolveFeatureMember(checker, declaration.initializer, member, active)
        : undefined;
    }
    return resolveStaticPath(checker, node, [member]);
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
            {
              node: declaration.initializer,
              bindings: visibleStaticBindings(source.bindings, declaration),
              types: source.types,
            },
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
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
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

function visibleStaticBindings(
  bindings: ReadonlyMap<ts.Symbol, StaticValue>,
  node: ts.Node,
): ReadonlyMap<ts.Symbol, StaticValue> {
  return new Map(
    [...bindings].filter(([symbol]) =>
      symbol.declarations?.some((declaration) => {
        const owner = enclosingFunction(declaration);
        return (
          owner !== undefined &&
          owner.getSourceFile() === node.getSourceFile() &&
          containsNode(owner, node)
        );
      }),
    ),
  );
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
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const expression = staticConstant(
          checker,
          { node: span.expression, bindings: value.bindings, types: value.types },
          active,
        );
        if (
          typeof expression !== "string" &&
          typeof expression !== "number" &&
          typeof expression !== "boolean"
        ) {
          return undefined;
        }
        result += String(expression) + span.literal.text;
      }
      return result;
    }
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
    if (argument) types.set(parameter, substitutedType(argument, types));
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
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
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
  const internal = portableInternalMember(lowering, member.name.expression);
  if (internal) return internal;
  const computed = portableComputedName(lowering, member.name.expression);
  if (computed) return computed;
  if (
    lowering.providedNames.length === 1 &&
    ts.isObjectLiteralExpression(member.parent) &&
    member.parent.properties.filter(({ name }) => name && ts.isComputedPropertyName(name))
      .length === 1
  ) {
    return lowering.providedNames[0]!;
  }
  throw diagnostic(
    member.name,
    "Portable computed record keys must resolve to a compile-time string or number. " +
      `Received ${lowering.checker.typeToString(
        lowering.checker.getTypeAtLocation(member.name.expression),
      )}.`,
  );
}

function portableInternalMember(
  lowering: PortableLowering,
  expression: ts.Expression,
): string | undefined {
  const value = unwrapExpression(expression);
  if (!ts.isIdentifier(value)) return undefined;
  let symbol = lowering.checker.getSymbolAtLocation(value);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = lowering.checker.getAliasedSymbol(symbol);
  }
  if (
    !symbol?.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.replaceAll("\\", "/").endsWith("/core/dependency.ts"),
    )
  ) {
    return undefined;
  }
  if (symbol.getName() === "dependencyInvocation") return "@dependencyInvocation";
  return undefined;
}

function portableComputedName(
  lowering: PortableLowering,
  expression: ts.Expression,
): string | undefined {
  const override = portableExpressionTypeOverride(lowering, expression);
  if (
    override?.kind === "literal" &&
    (typeof override.value === "string" || typeof override.value === "number")
  ) {
    return String(override.value);
  }
  const value = mutableVariableReference(lowering.checker, expression)
    ? undefined
    : staticConstant(
        lowering.checker,
        {
          node: expression,
          bindings: lowering.staticBindings,
          types: lowering.typeSubstitutions,
        },
        new Set(),
      );
  if (typeof value === "string" || typeof value === "number") return String(value);
  const type = lowerPortableType(
    lowering,
    lowering.checker.getTypeAtLocation(expression),
    expression,
  );
  return type.kind === "literal" &&
    (typeof type.value === "string" || typeof type.value === "number")
    ? String(type.value)
    : undefined;
}

function portableExpressionTypeOverride(
  lowering: PortableLowering,
  expression: ts.Expression,
): TypeIR | undefined {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) {
    const symbol = valueSymbol(lowering.checker, value);
    return symbol ? lowering.irTypeOverrides.get(symbol) : undefined;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const owner = portableExpressionTypeOverride(lowering, value.expression);
    if (owner?.kind !== "record") return undefined;
    return owner.fields.find(({ name }) => name === value.name.text)?.type;
  }
  return undefined;
}

function mutableVariableReference(checker: ts.TypeChecker, expression: ts.Expression): boolean {
  const value = unwrapExpression(expression);
  if (!ts.isIdentifier(value)) return false;
  let symbol = checker.getSymbolAtLocation(value);
  if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return Boolean(
    symbol?.declarations?.some(
      (declaration) =>
        ts.isVariableDeclaration(declaration) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) === 0,
    ),
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

function normalizePortableFunction(function_: FunctionIR, root: string): FunctionIR {
  const normalizeIdentity = (id: string): string => {
    const prefixEnd = id.indexOf("/");
    const pathEnd = id.indexOf("#", prefixEnd + 1);
    if (prefixEnd >= 0 && pathEnd > prefixEnd) {
      const file = id.slice(prefixEnd + 1, pathEnd);
      return (
        `${id.slice(0, prefixEnd + 1)}` +
        `${relative(root, file).replaceAll("\\", "/")}${id.slice(pathEnd)}`
      );
    }
    const match = /^(function|closure)\/(.+):(\d+):(\d+)(\/.*)?$/.exec(id);
    if (!match) return id;
    return `${match[1]}/${relative(root, match[2]!).replaceAll("\\", "/")}:${match[3]}:${match[4]}${match[5] ?? ""}`;
  };
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const record = value as Readonly<Record<string, unknown>>;
    if (
      typeof record.file === "string" &&
      typeof record.line === "number" &&
      typeof record.column === "number"
    ) {
      return {
        ...record,
        file: relative(root, record.file).replaceAll("\\", "/"),
      };
    }
    const normalized = Object.fromEntries(
      Object.entries(record).map(([name, child]) => [name, normalize(child)]),
    );
    if (
      typeof record.id === "string" &&
      Array.isArray(record.body) &&
      Array.isArray(record.parameters)
    ) {
      normalized.id = normalizeIdentity(record.id);
    }
    if (
      typeof record.function === "string" &&
      (record.kind === "call" || record.kind === "closure")
    ) {
      normalized.function = normalizeIdentity(record.function);
    }
    return normalized;
  };
  return normalize(function_) as FunctionIR;
}

function normalizeSourceFiles(ir: SystemIR, root: string): SystemIR {
  const normalizeSpan = (span: SourceSpan): SourceSpan => ({
    ...span,
    file: relative(root, span.file).replaceAll("\\", "/"),
  });
  return {
    ...ir,
    features: ir.features.map((feature) => ({
      ...feature,
      ...(feature.providers
        ? {
            providers: feature.providers.map((provider) => ({
              ...provider,
              ...(provider.sources
                ? {
                    sources: provider.sources.map((source) =>
                      relative(root, source).replaceAll("\\", "/"),
                    ),
                  }
                : {}),
              span: normalizeSpan(provider.span),
            })),
          }
        : {}),
    })),
    programs: ir.programs.map((program) => ({
      ...program,
      contributions: program.contributions.map((contribution) => ({
        ...contribution,
        span: normalizeSpan(contribution.span),
      })),
    })),
  };
}
