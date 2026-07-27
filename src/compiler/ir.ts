export const SYSTEM_IR_VERSION = 33 as const;

/** Maps semantic source files to the generated outputs affected by each source. */
export type SystemOutputSources = Readonly<Record<string, readonly string[]>>;

/** Work performed by one semantic compilation, reported to development adapters. */
export type SystemCompilationWork = Readonly<{
  features: Readonly<{ compiled: number; reused: number }>;
  durations?: Readonly<{
    diagnostics: number;
    extraction: number;
    linking: number;
    sources: number;
    total: number;
  }>;
}>;

/**
 * Orders providers before consumers while retaining mutually dependent
 * contributions as one deterministic, lazily bound component.
 */
export function orderDependencyGraph(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (node: string): void => {
    const nodeIndex = nextIndex++;
    indices.set(node, nodeIndex);
    lowLinks.set(node, nodeIndex);
    stack.push(node);
    stacked.add(node);
    for (const dependency of [...(graph.get(node) ?? [])].sort()) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (stacked.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      stacked.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort());
  };

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }
  return components.flat();
}

/** Serializable meaning owned and versioned by a compiler extension. */
export type ExtensionIR =
  | null
  | boolean
  | number
  | string
  | readonly ExtensionIR[]
  | Readonly<{ [name: string]: ExtensionIR }>;

export type CompilerExtensionsIR = Readonly<Record<string, ExtensionIR>>;

export type SourceSpan = Readonly<{
  file: string;
  line: number;
  column: number;
}>;

export type TypeIR =
  | Readonly<{ kind: "primitive"; name: "boolean" | "null" | "number" | "string" | "void" }>
  | Readonly<{ kind: "opaque"; name: string }>
  | Readonly<{ kind: "literal"; value: boolean | number | string }>
  | Readonly<{ kind: "array"; element: TypeIR }>
  | Readonly<{ kind: "tuple"; elements: readonly TypeIR[] }>
  | Readonly<{ kind: "option"; value: TypeIR }>
  | Readonly<{ kind: "union"; variants: readonly TypeIR[] }>
  | Readonly<{ kind: "record"; fields: readonly FieldIR[] }>
  | Readonly<{ kind: "promise"; value: TypeIR }>
  | Readonly<{ kind: "stream"; element: TypeIR }>
  | Readonly<{ kind: "function"; parameters: readonly FieldIR[]; result: TypeIR }>;

export type FieldIR = Readonly<{
  name: string;
  optional: boolean;
  type: TypeIR;
}>;

export type LiteralIR = null | boolean | number | string;

export type ExpressionValueIR =
  | Readonly<{ kind: "literal"; value: LiteralIR }>
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "error";
      name: string;
      arguments: readonly ExpressionIR[];
      fields: readonly Readonly<{ name: string; value: ExpressionIR }>[];
    }>
  | Readonly<{ kind: "error-match"; value: ExpressionIR; name: string }>
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "array"; values: readonly ExpressionIR[] }>
  | Readonly<{ kind: "record"; fields: readonly Readonly<{ name: string; value: ExpressionIR }>[] }>
  | Readonly<{
      kind: "record-merge";
      entries: readonly (
        | Readonly<{ kind: "field"; name: string; value: ExpressionIR }>
        | Readonly<{ kind: "spread"; value: ExpressionIR }>
      )[];
    }>
  | Readonly<{ kind: "property"; value: ExpressionIR; name: string; optional?: true }>
  | Readonly<{ kind: "index"; value: ExpressionIR; index: ExpressionIR }>
  | Readonly<{
      kind: "binary";
      operator:
        | "+"
        | "-"
        | "*"
        | "/"
        | "%"
        | "==="
        | "!=="
        | "<"
        | "<="
        | ">"
        | ">="
        | "&&"
        | "||"
        | "??";
      left: ExpressionIR;
      right: ExpressionIR;
    }>
  | Readonly<{ kind: "unary"; operator: "!" | "-" | "present"; value: ExpressionIR }>
  | Readonly<{
      kind: "call";
      function: string;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>
  | Readonly<{
      kind: "invoke";
      callee: ExpressionIR;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>
  | Readonly<{
      kind: "method-call";
      receiver: ExpressionIR;
      method: string;
      arguments: readonly ExpressionIR[];
    }>
  | Readonly<{ kind: "json-parse"; value: ExpressionIR }>
  | Readonly<{ kind: "json-stringify"; value: ExpressionIR }>
  | Readonly<{ kind: "object-keys"; value: ExpressionIR }>
  | Readonly<{ kind: "to-string"; value: ExpressionIR }>
  | Readonly<{
      kind: "stream-map";
      source: ExpressionIR;
      transform: ExpressionIR;
    }>
  | Readonly<{
      kind: "stream-distinct";
      source: ExpressionIR;
      select: ExpressionIR;
    }>
  | Readonly<{
      kind: "closure";
      function: string;
      captures: readonly ExpressionIR[];
      /** Preserves identity when one static function binding is expanded at multiple use sites. */
      stable?: true;
    }>
  | Readonly<{
      kind: "conditional";
      condition: ExpressionIR;
      consequent: ExpressionIR;
      alternate: ExpressionIR;
    }>
  | Readonly<{
      kind: "concurrent";
      operation: "all" | "all-settled" | "race";
      values: readonly ExpressionIR[];
    }>
  | Readonly<{
      kind: "dependency-call";
      dependency: string;
      operation: string;
      arguments: readonly ExpressionIR[];
      awaited: boolean;
    }>
  | Readonly<{
      kind: "dependency-reference";
      dependency: string;
      binding: ExpressionIR;
    }>
  | Readonly<{
      kind: "dependency-reference-call";
      reference: ExpressionIR;
      operation: string;
      input?: ExpressionIR;
      options?: ExpressionIR;
      argument: string;
      awaited: boolean;
    }>;

/** A typed executable value with an exact authoring location. */
export type ExpressionIR = Readonly<{
  type: TypeIR;
  span: SourceSpan;
}> &
  ExpressionValueIR;

export type StatementIR =
  | Readonly<{
      kind: "let";
      name: string;
      mutable: boolean;
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "assign";
      name: string;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "property-assign";
      target: ExpressionIR;
      property: string;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "index-assign";
      target: ExpressionIR;
      index: ExpressionIR;
      operator: "=" | "+=" | "-=" | "*=" | "/=" | "??=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{ kind: "expression"; expression: ExpressionIR; span: SourceSpan }>
  | Readonly<{ kind: "array-push"; array: string; value: ExpressionIR; span: SourceSpan }>
  | Readonly<{
      kind: "throw";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "if";
      condition: ExpressionIR;
      consequent: readonly StatementIR[];
      alternate: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-of";
      asynchronous?: true;
      item: string;
      values: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-range";
      item: string;
      from: ExpressionIR;
      to: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "while";
      condition: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "try";
      body: readonly StatementIR[];
      catch?: Readonly<{
        error?: string;
        body: readonly StatementIR[];
      }>;
      finally: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{ kind: "return"; value?: ExpressionIR; span: SourceSpan }>;

export type FunctionIR = Readonly<{
  id: string;
  name: string;
  asynchronous: boolean;
  captures: readonly FieldIR[];
  parameters: readonly FieldIR[];
  result: TypeIR;
  body: readonly StatementIR[];
  span: SourceSpan;
}>;

/** Target-independent procedural meaning selected by a Program-language extension. */
export type PortableProgramExecutionIR =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "portable"; entry: FunctionIR; functions: readonly FunctionIR[] }>
  | Readonly<{
      kind: "source";
      diagnostic?: Readonly<{ message: string; span: SourceSpan }>;
      span: SourceSpan;
    }>;

export type DependencyIR = Readonly<{
  name: string;
  type: TypeIR;
  failures?: TypeIR;
  heartbeats?: readonly Readonly<{ operation: string; type: TypeIR }>[];
  reference?: DependencyReferenceIR;
}>;

export type DependencyReferenceIR = Readonly<{
  name: string;
  argument: string;
  /** Fields whose canonical values identify the logical referenced instance. */
  bindings: readonly string[];
  inputs: readonly string[];
}>;

export type DependencyOperationIR = Readonly<{
  name: string;
  mode: "asynchronous" | "stream" | "synchronous";
  input: TypeIR;
  output: TypeIR;
  failures?: TypeIR;
  heartbeat?: TypeIR;
}>;

/** Minimal compiler-derived contract required by a running host binding. */
export type DependencyContractIR = Readonly<{
  name: string;
  operations: readonly DependencyOperationIR[];
  reference?: DependencyReferenceIR;
}>;

export type ProgramContributionIR = Readonly<{
  id: string;
  feature: string;
  /** Present when one exact contribution instance is shared by several Applications. */
  apps?: readonly string[];
  requires: readonly DependencyIR[];
  provides: readonly DependencyIR[];
  extensions?: CompilerExtensionsIR;
  span: SourceSpan;
}>;

/** One independently realizable Program assembled from same-named Feature contributions. */
export type ProgramIR = Readonly<{
  id: string;
  name: string;
  logicalName: string;
  environment: Readonly<{ name: string; platform: string }>;
  interface?: string;
  contributions: readonly ProgramContributionIR[];
}>;

export type LinkedProgramContributionIR = Readonly<{
  contribution: ProgramContributionIR;
  dependencies: readonly string[];
}>;

export type LinkedDependencyIR = Readonly<{
  name: string;
  type: TypeIR;
  failures?: TypeIR;
  heartbeats?: readonly Readonly<{ operation: string; type: TypeIR }>[];
  reference?: DependencyReferenceIR;
  consumers: readonly string[];
  provider?: string;
}>;

/** Canonical, backend-independent result of linking every contribution to one Program. */
export type LinkedProgramIR = Readonly<{
  program: ProgramIR;
  contributions: readonly LinkedProgramContributionIR[];
  dependencies: readonly LinkedDependencyIR[];
  external: readonly DependencyIR[];
}>;

/** Compiler-derived dependency meaning for one Feature contribution. */
export type ProgramContributionManifest = Readonly<{
  feature: string;
  requires: readonly string[];
  provides: readonly string[];
}>;

/** Serializable dependency graph consumed by a Process runtime. */
export type ProgramManifest = Readonly<{
  name: string;
  bindings: readonly DependencyContractIR[];
  contributions: readonly ProgramContributionManifest[];
}>;

/** Projects one semantic Dependency into its canonical callable operations. */
export function collectDependencyOperations(
  dependency: DependencyIR,
): readonly DependencyOperationIR[] {
  if (dependency.type.kind !== "record") {
    throw new Error(
      `Dependency ${JSON.stringify(dependency.name)} must be a record of operations.`,
    );
  }
  return dependency.type.fields
    .map((field): DependencyOperationIR => {
      if (field.optional || field.type.kind !== "function") {
        throw new Error(
          `Dependency ${JSON.stringify(dependency.name)} operation ${JSON.stringify(field.name)} ` +
            "must be a required function.",
        );
      }
      if (field.type.parameters.length > 1) {
        throw new Error(
          `Dependency ${JSON.stringify(dependency.name)} operation ${JSON.stringify(field.name)} ` +
            "must accept one input object.",
        );
      }
      return {
        name: field.name,
        mode:
          field.type.result.kind === "promise"
            ? "asynchronous"
            : field.type.result.kind === "stream"
              ? "stream"
              : "synchronous",
        input: field.type.parameters[0]?.type ?? { kind: "primitive", name: "void" },
        output:
          field.type.result.kind === "promise"
            ? field.type.result.value
            : field.type.result.kind === "stream"
              ? field.type.result.element
              : field.type.result,
        ...(dependency.failures ? { failures: dependency.failures } : {}),
        ...(dependency.heartbeats?.find(({ operation }) => operation === field.name)
          ? {
              heartbeat: dependency.heartbeats.find(({ operation }) => operation === field.name)!
                .type,
            }
          : {}),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Projects semantic Dependency types into their minimal runtime binding contracts. */
export function projectDependencyContracts(
  dependencies: readonly DependencyIR[],
): readonly DependencyContractIR[] {
  return dependencies.map((dependency) => ({
    name: dependency.name,
    operations: collectDependencyOperations(dependency),
    ...(dependency.reference ? { reference: dependency.reference } : {}),
  }));
}

/** Stable semantic identity for one exact Dependency operation contract. */
export function dependencyOperationIdentity(operation: DependencyOperationIR): string {
  return JSON.stringify([
    "kit.dependency.operation",
    1,
    operation.mode,
    typeIdentity(operation.input),
    typeIdentity(operation.output),
    operation.failures ? typeIdentity(operation.failures) : null,
    operation.heartbeat ? typeIdentity(operation.heartbeat) : null,
  ]);
}

/** Stable semantic identity for one exact Dependency contract. */
export function dependencyContractIdentity(contract: DependencyContractIR): string {
  const operations = contract.operations
    .map((operation) => [operation.name, dependencyOperationIdentity(operation)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([
    "kit.dependency",
    1,
    contract.name,
    contract.reference
      ? [
          contract.reference.name,
          contract.reference.argument,
          [...contract.reference.bindings],
          [...contract.reference.inputs],
        ]
      : null,
    operations,
  ]);
}

/** Stable identity for canonical portable type meaning. */
export function typeIdentity(type: TypeIR): string {
  return JSON.stringify(canonicalTypeMeaning(type));
}

function canonicalTypeMeaning(type: TypeIR): unknown {
  switch (type.kind) {
    case "primitive":
    case "opaque":
      return [type.kind, type.name];
    case "literal":
      return ["literal", type.value];
    case "array":
      return ["array", canonicalTypeMeaning(type.element)];
    case "tuple":
      return ["tuple", type.elements.map(canonicalTypeMeaning)];
    case "option":
    case "promise":
      return [type.kind, canonicalTypeMeaning(type.value)];
    case "union":
      return ["union", type.variants.map(typeIdentity).sort()];
    case "record":
      return [
        "record",
        [...type.fields]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(({ name, optional, type: value }) => [name, optional, canonicalTypeMeaning(value)]),
      ];
    case "stream":
      return ["stream", canonicalTypeMeaning(type.element)];
    case "function":
      return [
        "function",
        type.parameters.map(({ optional, type: value }) => [optional, canonicalTypeMeaning(value)]),
        canonicalTypeMeaning(type.result),
      ];
  }
}

export type FeatureIR = Readonly<{
  id: string;
  path: string;
  children: readonly string[];
  programs: readonly string[];
  providers?: readonly DependencyProviderIR[];
  extensions?: CompilerExtensionsIR;
}>;

/** Adapter-neutral ownership and static realization meaning for one provider. */
export type DependencyProviderIR = Readonly<{
  dependency: string;
  platform: string;
  development: boolean;
  /** Development implementation sources retained for exact hot replacement. */
  sources?: readonly string[];
  requirements?: ExtensionIR;
  production?: ExtensionIR;
  span: SourceSpan;
}>;

export type SelectedDependencyProviderIR = DependencyProviderIR & Readonly<{ feature: string }>;

export type AppIR = Readonly<{
  id: string;
  path: string;
  name?: string;
  interfaces: readonly string[];
}>;

export type PlatformInterfaceIR = Readonly<{
  id: string;
  path: string;
  app: string;
  platform: string;
  /** Application Feature roles resolved to canonical System Feature paths. */
  features: Readonly<Record<string, string>>;
  programs: readonly string[];
  extensions?: CompilerExtensionsIR;
}>;

export type SystemIR = Readonly<{
  version: typeof SYSTEM_IR_VERSION;
  system: Readonly<{
    id: "system";
    name: string;
    extensions?: CompilerExtensionsIR;
  }>;
  platforms: readonly string[];
  apps: readonly AppIR[];
  interfaces: readonly PlatformInterfaceIR[];
  features: readonly FeatureIR[];
  programs: readonly ProgramIR[];
}>;

/**
 * Selects owner-collocated providers visible to one Program.
 *
 * A provider is visible to contributions owned by the same Feature subtree.
 * Reusing the exact same provider declaration is deduplicated; distinct
 * declarations for one Dependency are rejected before realization.
 */
export function selectDependencyProviders(
  ir: SystemIR,
  program: ProgramIR,
  dependencies: readonly string[],
): readonly SelectedDependencyProviderIR[] {
  const required = new Set(dependencies);
  const candidates: SelectedDependencyProviderIR[] = [];
  for (const feature of ir.features) {
    if (
      !program.contributions.some(
        ({ feature: owner }) => owner === feature.path || owner.startsWith(`${feature.path}.`),
      )
    ) {
      continue;
    }
    for (const provider of feature.providers ?? []) {
      if (
        provider.platform !== program.environment.platform ||
        !required.has(provider.dependency)
      ) {
        continue;
      }
      candidates.push({ ...provider, feature: feature.path });
    }
  }
  const selected = new Map<string, SelectedDependencyProviderIR>();
  for (const provider of candidates) {
    const current = selected.get(provider.dependency);
    if (!current) {
      selected.set(provider.dependency, provider);
      continue;
    }
    if (sameProvider(current, provider)) continue;
    throw new Error(
      `Dependency ${JSON.stringify(provider.dependency)} has conflicting providers from ` +
        `${JSON.stringify(current.feature)} and ${JSON.stringify(provider.feature)}.`,
    );
  }
  return [...selected.values()].sort((left, right) =>
    left.dependency.localeCompare(right.dependency),
  );
}

function sameProvider(
  left: SelectedDependencyProviderIR,
  right: SelectedDependencyProviderIR,
): boolean {
  return (
    left.span.file === right.span.file &&
    left.span.line === right.span.line &&
    left.span.column === right.span.column &&
    JSON.stringify(left.sources ?? []) === JSON.stringify(right.sources ?? []) &&
    JSON.stringify(left.requirements) === JSON.stringify(right.requirements) &&
    JSON.stringify(left.production) === JSON.stringify(right.production)
  );
}

export type SystemOutputSelection = Readonly<{
  app?: string;
  platforms: readonly string[];
  programs: readonly ProgramIR[];
  interfaces: readonly PlatformInterfaceIR[];
}>;

/** Selects whole-System outputs or one Application plus every System-shared contribution. */
export function selectSystemOutputs(ir: SystemIR, app?: string): SystemOutputSelection {
  assertSystemIRVersion(ir);
  const selectedApp = app ? ir.apps.find(({ path }) => path === app) : undefined;
  if (app && !selectedApp) throw new Error(`Unknown Application ${JSON.stringify(app)}.`);
  if (!selectedApp) {
    return {
      platforms: ir.platforms,
      programs: ir.programs,
      interfaces: ir.interfaces,
    };
  }

  const interfaces = ir.interfaces.filter(({ app: owner }) => owner === selectedApp.path);
  const interfacePaths = new Set(interfaces.map(({ path }) => path));
  const features = new Map(ir.features.map((feature) => [feature.path, feature]));
  const programs = ir.programs.flatMap((program): ProgramIR[] => {
    if (program.interface && !interfacePaths.has(program.interface)) return [];
    const contributions = program.contributions.filter((contribution) => {
      if (contribution.apps) return contribution.apps.includes(selectedApp.path);
      const feature = features.get(contribution.feature);
      if (!feature) {
        throw new Error(
          `Program ${JSON.stringify(program.id)} references unknown Feature ${JSON.stringify(contribution.feature)}.`,
        );
      }
      return true;
    });
    if (!contributions.length) return [];
    return [
      {
        ...program,
        contributions,
      },
    ];
  });
  const platforms = [
    ...new Set([
      ...programs.map(({ environment }) => environment.platform),
      ...interfaces.map(({ platform }) => platform),
    ]),
  ].sort();
  return {
    app: selectedApp.path,
    platforms,
    programs,
    interfaces,
  };
}

export function serializeSystemIR(ir: SystemIR): string {
  assertSystemIRVersion(ir);
  return `${JSON.stringify(ir, undefined, 2)}\n`;
}

export function assertSystemIRVersion(ir: Readonly<{ version: number }>): asserts ir is SystemIR {
  if (ir.version !== SYSTEM_IR_VERSION) {
    throw new Error(`Unsupported System IR version ${String(ir.version)}.`);
  }
}
