export const SYSTEM_IR_VERSION = 36 as const;

/** Maps semantic source files to the generated outputs affected by each source. */
export type SystemOutputSources = Readonly<Record<string, readonly string[]>>;

/** Work performed by one semantic compilation, reported to development adapters. */
export type SystemCompilationWork = Readonly<{
  features: Readonly<{ compiled: number; reused: number }>;
  files?: Readonly<{ diagnosed: number; total: number }>;
  durations?: Readonly<{
    diagnostics: number;
    extraction: number;
    linking: number;
    sources: number;
    total: number;
  }>;
}>;

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
  | Readonly<{ kind: "data-kind"; value: ExpressionIR }>
  | Readonly<{ kind: "to-string"; value: ExpressionIR }>
  | Readonly<{
      kind: "stream-map";
      source: ExpressionIR;
      transform: ExpressionIR;
    }>
  | Readonly<{
      kind: "stream-filter";
      source: ExpressionIR;
      predicate: ExpressionIR;
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
      options?: ExpressionIR;
      awaited: boolean;
    }>
  | Readonly<{
      kind: "dependency-dispatch";
      dependency: ExpressionIR;
      operation: ExpressionIR;
      input: ExpressionIR;
      options?: ExpressionIR;
      awaited: boolean;
    }>
  | Readonly<{
      kind: "dependency-intercept";
      dependency: ExpressionIR;
      intercept: ExpressionIR;
    }>
  | Readonly<{
      kind: "dependency-reference";
      dependency: string;
      binding: ExpressionIR;
    }>
  | Readonly<{
      kind: "dependency-reference-call";
      reference: ExpressionIR;
      operation: string | ExpressionIR;
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

type PortableTypeNodeIR =
  | Readonly<{ kind: "primitive"; name: "boolean" | "null" | "number" | "string" | "void" }>
  | Readonly<{ kind: "opaque"; name: string }>
  | Readonly<{ kind: "literal"; value: boolean | number | string }>
  | Readonly<{ kind: "array"; element: number }>
  | Readonly<{ kind: "tuple"; elements: readonly number[] }>
  | Readonly<{ kind: "option"; value: number }>
  | Readonly<{ kind: "union"; variants: readonly number[] }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{ name: string; optional: boolean; type: number }>[];
    }>
  | Readonly<{ kind: "promise"; value: number }>
  | Readonly<{ kind: "stream"; element: number }>
  | Readonly<{
      kind: "function";
      parameters: readonly Readonly<{ name: string; optional: boolean; type: number }>[];
      result: number;
    }>;

/**
 * Compact serialized form retained by Program-language extensions.
 *
 * Function objects remain extension-owned JSON. Every compiler TypeIR inside
 * them is replaced by an index into one recursively interned type table.
 */
export type CompactPortableProgramExecutionIR =
  | Exclude<PortableProgramExecutionIR, Readonly<{ kind: "portable" }>>
  | Readonly<{
      kind: "portable";
      types: readonly PortableTypeNodeIR[];
      entry: ExtensionIR;
      functions: readonly ExtensionIR[];
    }>;

export type CompactPortableProgramModuleIR = Readonly<{
  types: readonly PortableTypeNodeIR[];
  functions: readonly ExtensionIR[];
}>;

export type CompactPortableProgramReferenceIR =
  | Exclude<PortableProgramExecutionIR, Readonly<{ kind: "portable" }>>
  | Readonly<{
      kind: "portable";
      entry: number;
      functions: readonly number[];
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
  extensions?: CompilerExtensionsIR;
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
  return semanticFingerprint([
    "kit.dependency.operation",
    1,
    operation.mode,
    canonicalTypeMeaning(operation.input),
    canonicalTypeMeaning(operation.output),
    operation.failures ? canonicalTypeMeaning(operation.failures) : null,
    operation.heartbeat ? canonicalTypeMeaning(operation.heartbeat) : null,
  ]);
}

/** Stable semantic identity for one exact Dependency contract. */
export function dependencyContractIdentity(contract: DependencyContractIR): string {
  const operations = contract.operations
    .map((operation) => [operation.name, dependencyOperationIdentity(operation)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return semanticFingerprint([
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

function semanticFingerprint(value: unknown): string {
  return `sha256:${sha256(JSON.stringify(value))}`;
}

function sha256(value: string): string {
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(length - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotate = (word: number, bits: number): number => (word >>> bits) | (word << (32 - bits));

  for (let offset = 0; offset < length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (h! + sum1 + choice + constants[index]! + words[index]!) >>> 0;
      const sum0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }

  return [...hash].map((part) => part.toString(16).padStart(8, "0")).join("");
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
  /** Content identity of the development implementation and its reachable declarations. */
  developmentIdentity: string;
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
    left.developmentIdentity === right.developmentIdentity &&
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

/** Interns repeated portable types before an extension persists Program meaning. */
export function compactPortableProgramExecution(
  input: Readonly<{ entry: FunctionIR; functions: readonly FunctionIR[] }>,
): CompactPortableProgramExecutionIR {
  const compactor = createPortableCompactor();
  return {
    kind: "portable",
    types: compactor.types,
    entry: compactPortableFunction(input.entry, compactor.type),
    functions: input.functions.map((function_) =>
      compactPortableFunction(function_, compactor.type),
    ),
  };
}

/** Deduplicates portable types and functions across every contribution in one Program. */
export function compactPortableProgramModule(
  input: readonly PortableProgramExecutionIR[],
): Readonly<{
  module: CompactPortableProgramModuleIR;
  executions: readonly CompactPortableProgramReferenceIR[];
}> {
  const compactor = createPortableCompactor();
  const functions: ExtensionIR[] = [];
  const identities = new Map<string, number>();
  const function_ = (value: FunctionIR): number => {
    const compact = compactPortableFunction(value, compactor.type);
    const identity = JSON.stringify(compact);
    const retained = identities.get(identity);
    if (retained !== undefined) return retained;
    const reference = functions.length;
    functions.push(compact);
    identities.set(identity, reference);
    return reference;
  };
  const executions = input.map((execution): CompactPortableProgramReferenceIR => {
    if (execution.kind !== "portable") return execution;
    return {
      kind: "portable",
      entry: function_(execution.entry),
      functions: execution.functions.map(function_),
    };
  });
  return {
    module: {
      types: compactor.types,
      functions,
    },
    executions,
  };
}

/** Restores compact extension meaning for the generic interpreter and lowerers. */
export function expandPortableProgramExecution(
  input: CompactPortableProgramExecutionIR,
): PortableProgramExecutionIR {
  if (input.kind !== "portable") return input;
  const types = expandPortableTypes(input.types);
  return {
    kind: "portable",
    entry: expandPortableFunction(input.entry, types),
    functions: input.functions.map((function_) => expandPortableFunction(function_, types)),
  };
}

/** Expands one contribution reference from a shared portable Program module. */
export function expandPortableProgramReference(
  input: CompactPortableProgramReferenceIR,
  module: CompactPortableProgramModuleIR,
): PortableProgramExecutionIR {
  if (input.kind !== "portable") return input;
  let functions = expandedPortableModules.get(module);
  if (!functions) {
    const types = expandPortableTypes(module.types);
    functions = Object.freeze(
      module.functions.map((function_) => expandPortableFunction(function_, types)),
    );
    expandedPortableModules.set(module, functions);
  }
  const function_ = (reference: number): FunctionIR => {
    const value = functions[reference];
    if (!value) throw new TypeError(`Invalid portable function reference ${String(reference)}.`);
    return value;
  };
  return {
    kind: "portable",
    entry: function_(input.entry),
    functions: input.functions.map(function_),
  };
}

const expandedPortableModules = new WeakMap<object, readonly FunctionIR[]>();

function createPortableCompactor(): Readonly<{
  types: PortableTypeNodeIR[];
  type(value: TypeIR): number;
}> {
  const types: PortableTypeNodeIR[] = [];
  const identities = new Map<string, number>();
  const type = (value: TypeIR): number => {
    const node = compactPortableType(value, type);
    const identity = JSON.stringify(node);
    const retained = identities.get(identity);
    if (retained !== undefined) return retained;
    const reference = types.length;
    types.push(node);
    identities.set(identity, reference);
    return reference;
  };
  return { types, type };
}

function compactPortableType(value: TypeIR, type: (value: TypeIR) => number): PortableTypeNodeIR {
  switch (value.kind) {
    case "primitive":
    case "opaque":
    case "literal":
      return value;
    case "array":
    case "stream":
      return { kind: value.kind, element: type(value.element) };
    case "tuple":
      return { kind: "tuple", elements: value.elements.map(type) };
    case "option":
    case "promise":
      return { kind: value.kind, value: type(value.value) };
    case "union":
      return { kind: "union", variants: value.variants.map(type) };
    case "record":
      return { kind: "record", fields: value.fields.map((field) => compactField(field, type)) };
    case "function":
      return {
        kind: "function",
        parameters: value.parameters.map((field) => compactField(field, type)),
        result: type(value.result),
      };
  }
}

function compactField(
  field: FieldIR,
  type: (value: TypeIR) => number,
): Readonly<{ name: string; optional: boolean; type: number }> {
  return { name: field.name, optional: field.optional, type: type(field.type) };
}

function compactPortableFunction(
  function_: FunctionIR,
  type: (value: TypeIR) => number,
): ExtensionIR {
  return {
    ...function_,
    captures: function_.captures.map((field) => compactField(field, type)),
    parameters: function_.parameters.map((field) => compactField(field, type)),
    result: type(function_.result),
    body: compactPortableValue(function_.body, type),
  } as ExtensionIR;
}

function compactPortableValue(value: unknown, type: (value: TypeIR) => number): ExtensionIR {
  if (Array.isArray(value)) return value.map((item) => compactPortableValue(item, type));
  if (!value || typeof value !== "object") return value as ExtensionIR;
  const record = value as Readonly<Record<string, unknown>>;
  const expression =
    typeof record.kind === "string" && sourceSpan(record.span) && typeIR(record.type);
  return Object.fromEntries(
    Object.entries(record).map(([name, item]) => [
      name,
      expression && name === "type" ? type(item as TypeIR) : compactPortableValue(item, type),
    ]),
  );
}

function expandPortableTypes(nodes: readonly PortableTypeNodeIR[]): readonly TypeIR[] {
  const types: TypeIR[] = [];
  const type = (reference: number): TypeIR => {
    if (!Number.isSafeInteger(reference) || reference < 0 || reference >= types.length) {
      throw new TypeError(`Invalid portable type reference ${String(reference)}.`);
    }
    return types[reference]!;
  };
  for (const node of nodes) {
    let value: TypeIR;
    switch (node.kind) {
      case "primitive":
      case "opaque":
      case "literal":
        value = node;
        break;
      case "array":
      case "stream":
        value = { kind: node.kind, element: type(node.element) };
        break;
      case "tuple":
        value = { kind: "tuple", elements: node.elements.map(type) };
        break;
      case "option":
      case "promise":
        value = { kind: node.kind, value: type(node.value) };
        break;
      case "union":
        value = { kind: "union", variants: node.variants.map(type) };
        break;
      case "record":
        value = { kind: "record", fields: node.fields.map((field) => expandField(field, type)) };
        break;
      case "function":
        value = {
          kind: "function",
          parameters: node.parameters.map((field) => expandField(field, type)),
          result: type(node.result),
        };
        break;
    }
    types.push(Object.freeze(value));
  }
  return Object.freeze(types);
}

function expandField(
  field: Readonly<{ name: string; optional: boolean; type: number }>,
  type: (reference: number) => TypeIR,
): FieldIR {
  return Object.freeze({
    name: field.name,
    optional: field.optional,
    type: type(field.type),
  });
}

function expandPortableFunction(value: ExtensionIR, types: readonly TypeIR[]): FunctionIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid compact portable function.");
  }
  const function_ = value as Readonly<Record<string, ExtensionIR>>;
  if (
    typeof function_.id !== "string" ||
    typeof function_.name !== "string" ||
    typeof function_.asynchronous !== "boolean" ||
    !Array.isArray(function_.captures) ||
    !Array.isArray(function_.parameters) ||
    typeof function_.result !== "number" ||
    !Array.isArray(function_.body) ||
    !sourceSpan(function_.span)
  ) {
    throw new TypeError("Invalid compact portable function.");
  }
  const type = (reference: number): TypeIR => {
    const value = types[reference];
    if (!value) throw new TypeError(`Invalid portable type reference ${String(reference)}.`);
    return value;
  };
  return {
    id: function_.id,
    name: function_.name,
    asynchronous: function_.asynchronous,
    captures: function_.captures.map((field) => expandCompactField(field, type)),
    parameters: function_.parameters.map((field) => expandCompactField(field, type)),
    result: type(function_.result),
    body: expandPortableValue(function_.body, type) as readonly StatementIR[],
    span: function_.span,
  };
}

function expandCompactField(value: ExtensionIR, type: (reference: number) => TypeIR): FieldIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid compact portable field.");
  }
  const field = value as Readonly<Record<string, ExtensionIR>>;
  if (
    typeof field.name !== "string" ||
    typeof field.optional !== "boolean" ||
    typeof field.type !== "number"
  ) {
    throw new TypeError("Invalid compact portable field.");
  }
  return { name: field.name, optional: field.optional, type: type(field.type) };
}

function expandPortableValue(value: ExtensionIR, type: (reference: number) => TypeIR): unknown {
  if (Array.isArray(value)) return value.map((item) => expandPortableValue(item, type));
  if (!value || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, ExtensionIR>>;
  const expression =
    typeof record.kind === "string" && sourceSpan(record.span) && typeof record.type === "number";
  return Object.fromEntries(
    Object.entries(record).map(([name, item]) => [
      name,
      expression && name === "type" ? type(item as number) : expandPortableValue(item, type),
    ]),
  );
}

function sourceSpan(value: unknown): value is SourceSpan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const span = value as Readonly<Record<string, unknown>>;
  return (
    typeof span.file === "string" &&
    typeof span.line === "number" &&
    typeof span.column === "number"
  );
}

function typeIR(value: unknown): value is TypeIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const kind = (value as Readonly<{ kind?: unknown }>).kind;
  return [
    "primitive",
    "opaque",
    "literal",
    "array",
    "tuple",
    "option",
    "union",
    "record",
    "promise",
    "stream",
    "function",
  ].includes(String(kind));
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
