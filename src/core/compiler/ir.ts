import type { PresentationSourceIR } from "@/core/compiler/presentation";

export const POGGERS_IR_VERSION = 10 as const;

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
  | Readonly<{ kind: "local"; name: string }>
  | Readonly<{ kind: "array"; values: readonly ExpressionIR[] }>
  | Readonly<{ kind: "record"; fields: readonly Readonly<{ name: string; value: ExpressionIR }>[] }>
  | Readonly<{ kind: "property"; value: ExpressionIR; name: string }>
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
  | Readonly<{ kind: "unary"; operator: "!" | "-"; value: ExpressionIR }>
  | Readonly<{
      kind: "call";
      function: string;
      arguments: readonly ExpressionIR[];
    }>
  | Readonly<{
      kind: "capability-call";
      capability: string;
      operation: string;
      arguments: readonly ExpressionIR[];
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
      operator: "=" | "+=" | "-=" | "*=" | "/=";
      value: ExpressionIR;
      span: SourceSpan;
    }>
  | Readonly<{ kind: "expression"; expression: ExpressionIR; span: SourceSpan }>
  | Readonly<{
      kind: "if";
      condition: ExpressionIR;
      consequent: readonly StatementIR[];
      alternate: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{
      kind: "for-of";
      item: string;
      values: ExpressionIR;
      body: readonly StatementIR[];
      span: SourceSpan;
    }>
  | Readonly<{ kind: "return"; value?: ExpressionIR; span: SourceSpan }>;

export type FunctionIR = Readonly<{
  id: string;
  name: string;
  asynchronous: boolean;
  parameters: readonly FieldIR[];
  result: TypeIR;
  body: readonly StatementIR[];
  span: SourceSpan;
}>;

export type IdentityFeatureImplementationIR = Readonly<{
  kind: "identity";
  name: string;
  principal: TypeIR;
  project: FunctionIR;
  functions: readonly FunctionIR[];
}>;

export type EntityFeatureImplementationIR = Readonly<{
  kind: "entity";
  name: string;
  principal: TypeIR;
  value: TypeIR;
  createInput: TypeIR;
  updateInput: TypeIR;
  filter: TypeIR;
  create: FunctionIR;
  update: FunctionIR;
  authorize: FunctionIR;
  matches?: FunctionIR;
  functions: readonly FunctionIR[];
}>;

export type PortableFeatureImplementationIR =
  | IdentityFeatureImplementationIR
  | EntityFeatureImplementationIR;

export type ProgramImplementationIR =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "portable"; start: FunctionIR; functions: readonly FunctionIR[] }>
  | Readonly<{ kind: "portable-feature"; feature: PortableFeatureImplementationIR }>
  | Readonly<{
      kind: "source";
      reason: "host-source" | "platform-ui";
      diagnostic?: Readonly<{ message: string; span: SourceSpan }>;
      span: SourceSpan;
    }>;

export type CapabilityIR = Readonly<{
  name: string;
  type: TypeIR;
}>;

export type ComponentIR = Readonly<{
  name: string;
  propCallbacks: readonly string[];
  state: TypeIR;
  actions: readonly string[];
  elements: readonly Readonly<{ name: string; element: string }>[];
  implementation: Readonly<{
    state: boolean;
    actions: boolean;
    mount: boolean;
    view: boolean;
  }>;
}>;

export type ProgramContributionIR = Readonly<{
  id: string;
  feature: string;
  requires: readonly CapabilityIR[];
  provides: readonly CapabilityIR[];
  ui?: Readonly<{
    state: TypeIR;
    actions: readonly string[];
    components: readonly ComponentIR[];
    root?: string;
  }>;
  implementation: ProgramImplementationIR;
  span: SourceSpan;
}>;

/** One independently realizable Program assembled from same-named Feature contributions. */
export type ProgramIR = Readonly<{
  id: string;
  name: string;
  environment: Readonly<{ name: string; platform: string; ui?: string }>;
  contributions: readonly ProgramContributionIR[];
  ui?: Readonly<{ root: Readonly<{ feature: string; component: string }> }>;
}>;

export type LinkedProgramContributionIR = Readonly<{
  contribution: ProgramContributionIR;
  dependencies: readonly string[];
}>;

export type LinkedCapabilityIR = Readonly<{
  name: string;
  type: TypeIR;
  consumers: readonly string[];
  provider?: string;
}>;

/** Canonical, backend-independent result of linking every contribution to one Program. */
export type LinkedProgramIR = Readonly<{
  program: ProgramIR;
  contributions: readonly LinkedProgramContributionIR[];
  capabilities: readonly LinkedCapabilityIR[];
  external: readonly CapabilityIR[];
}>;

export class ProgramLinkError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "ProgramLinkError";
  }
}

export type FeatureIR = Readonly<{
  id: string;
  path: string;
  children: readonly string[];
  programs: readonly string[];
}>;

export type ApplicationIR = Readonly<{
  version: typeof POGGERS_IR_VERSION;
  application: Readonly<{
    id: string;
    name: string;
    presentations: readonly string[];
  }>;
  platforms: readonly string[];
  features: readonly FeatureIR[];
  programs: readonly ProgramIR[];
  presentations: readonly PresentationSourceIR[];
}>;

export function serializeApplicationIR(ir: ApplicationIR): string {
  assertApplicationIRVersion(ir);
  return `${JSON.stringify(ir, undefined, 2)}\n`;
}

export function assertApplicationIRVersion(
  ir: Pick<ApplicationIR, "version">,
): asserts ir is ApplicationIR {
  if (ir.version !== POGGERS_IR_VERSION) {
    throw new Error(`Unsupported Poggers IR version ${String(ir.version)}.`);
  }
}

/** Links a complete Program before any Platform Adapter performs backend work. */
export function linkProgram(program: ProgramIR): LinkedProgramIR {
  const contributions = [...program.contributions].sort((left, right) =>
    left.feature.localeCompare(right.feature),
  );
  const providers = new Map<string, Readonly<{ feature: string; capability: CapabilityIR }>>();
  const requirements = new Map<
    string,
    Array<Readonly<{ feature: string; capability: CapabilityIR }>>
  >();

  for (const contribution of contributions) {
    for (const capability of contribution.provides) {
      const previous = providers.get(capability.name);
      if (previous) {
        throw new ProgramLinkError(
          `Program ${JSON.stringify(program.name)} has multiple providers for Capability ` +
            `${JSON.stringify(capability.name)}: Features ${JSON.stringify(previous.feature)} and ` +
            `${JSON.stringify(contribution.feature)}.`,
          contribution.span,
        );
      }
      providers.set(capability.name, { feature: contribution.feature, capability });
    }
    for (const capability of contribution.requires) {
      const values = requirements.get(capability.name) ?? [];
      values.push({ feature: contribution.feature, capability });
      requirements.set(capability.name, values);
    }
  }

  const capabilities: LinkedCapabilityIR[] = [];
  const external: CapabilityIR[] = [];
  const dependencies = new Map(
    contributions.map((contribution) => [contribution.feature, new Set<string>()]),
  );
  for (const name of [...new Set([...providers.keys(), ...requirements.keys()])].sort()) {
    const provider = providers.get(name);
    const consumers = [...(requirements.get(name) ?? [])].sort((left, right) =>
      left.feature.localeCompare(right.feature),
    );
    const canonical = provider?.capability ?? consumers[0]?.capability;
    if (!canonical) continue;
    for (const consumer of consumers) {
      if (!sameType(canonical.type, consumer.capability.type)) {
        throw new ProgramLinkError(
          `Program ${JSON.stringify(program.name)} has incompatible contracts for Capability ` +
            `${JSON.stringify(name)} between ${JSON.stringify(provider?.feature ?? consumers[0]!.feature)} ` +
            `and ${JSON.stringify(consumer.feature)}.`,
          program.contributions.find(({ feature }) => feature === consumer.feature)?.span ??
            program.contributions[0]!.span,
        );
      }
      if (provider && provider.feature !== consumer.feature) {
        dependencies.get(consumer.feature)!.add(provider.feature);
      }
    }
    capabilities.push({
      name,
      type: canonical.type,
      consumers: consumers.map(({ feature }) => feature),
      ...(provider ? { provider: provider.feature } : {}),
    });
    if (!provider) external.push(canonical);
  }

  const dependants = new Map<string, Set<string>>();
  for (const [feature, values] of dependencies) {
    for (const dependency of values) {
      const items = dependants.get(dependency) ?? new Set<string>();
      items.add(feature);
      dependants.set(dependency, items);
    }
  }
  const ready = [...dependencies]
    .filter(([, values]) => values.size === 0)
    .map(([feature]) => feature)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const feature = ready.shift()!;
    order.push(feature);
    for (const dependant of [...(dependants.get(feature) ?? [])].sort()) {
      const values = dependencies.get(dependant)!;
      values.delete(feature);
      if (!values.size) insertSorted(ready, dependant);
    }
  }
  if (order.length !== contributions.length) {
    const cycle = contributions
      .map(({ feature }) => feature)
      .filter((feature) => !order.includes(feature));
    const first = contributions.find(({ feature }) => cycle.includes(feature))!;
    throw new ProgramLinkError(
      `Program ${JSON.stringify(program.name)} has a Capability provider cycle between Features: ` +
        `${cycle.join(", ")}.`,
      first.span,
    );
  }
  const byFeature = new Map(
    contributions.map((contribution) => [contribution.feature, contribution]),
  );
  return {
    program,
    contributions: order.map((feature) => ({
      contribution: byFeature.get(feature)!,
      dependencies: [...dependenciesFor(contributions, providers, feature)].sort(),
    })),
    capabilities,
    external,
  };
}

export function linkApplicationPrograms(ir: ApplicationIR): readonly LinkedProgramIR[] {
  assertApplicationIRVersion(ir);
  return [...ir.programs]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(linkProgram);
}

function dependenciesFor(
  contributions: readonly ProgramContributionIR[],
  providers: ReadonlyMap<string, Readonly<{ feature: string; capability: CapabilityIR }>>,
  feature: string,
): ReadonlySet<string> {
  const contribution = contributions.find((value) => value.feature === feature)!;
  return new Set(
    contribution.requires.flatMap(({ name }) => {
      const provider = providers.get(name)?.feature;
      return provider && provider !== feature ? [provider] : [];
    }),
  );
}

function sameType(left: TypeIR, right: TypeIR): boolean {
  return typeIdentity(left) === typeIdentity(right);
}

function typeIdentity(type: TypeIR): string {
  switch (type.kind) {
    case "primitive":
    case "opaque":
      return `${type.kind}:${type.name}`;
    case "literal":
      return `literal:${JSON.stringify(type.value)}`;
    case "array":
      return `array:${typeIdentity(type.element)}`;
    case "tuple":
      return `tuple:${type.elements.map(typeIdentity).join(",")}`;
    case "option":
    case "promise":
      return `${type.kind}:${typeIdentity(type.value)}`;
    case "union":
      return `union:${type.variants.map(typeIdentity).sort().join("|")}`;
    case "record":
      return `record:${[...type.fields]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, optional, type: value }) => `${name}:${optional}:${typeIdentity(value)}`)
        .join(",")}`;
    case "stream":
      return `stream:${typeIdentity(type.element)}`;
    case "function":
      return `function:${type.parameters
        .map(({ optional, type: value }) => `${optional}:${typeIdentity(value)}`)
        .join(",")}=>${typeIdentity(type.result)}`;
  }
}

function insertSorted(values: string[], value: string): void {
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
  if (index === -1) values.push(value);
  else values.splice(index, 0, value);
}
