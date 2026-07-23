import {
  assertApplicationIRVersion,
  type ApplicationIR,
  type DependencyContractIR,
  type DependencyIR,
  type DependencyOperationIR,
  type LinkedDependencyIR,
  type LinkedProgramIR,
  type ProgramContributionIR,
  type ProgramManifest,
  type ProgramIR,
  type SourceSpan,
  type TypeIR,
} from "@/compiler/ir";

export class ProgramLinkError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(`${span.file}:${span.line}:${span.column}: ${message}`);
    this.name = "ProgramLinkError";
  }
}

/** Links a complete Program before any Platform Adapter performs backend work. */
export function linkProgram(program: ProgramIR): LinkedProgramIR {
  const contributions = [...program.contributions].sort((left, right) =>
    left.feature.localeCompare(right.feature),
  );
  const providers = new Map<string, Readonly<{ feature: string; dependency: DependencyIR }>>();
  const requirements = new Map<
    string,
    Array<Readonly<{ feature: string; dependency: DependencyIR }>>
  >();

  for (const contribution of contributions) {
    for (const dependency of contribution.provides) {
      const previous = providers.get(dependency.name);
      if (previous) {
        throw new ProgramLinkError(
          `Program ${JSON.stringify(program.name)} has multiple providers for Dependency ` +
            `${JSON.stringify(dependency.name)}: Features ${JSON.stringify(previous.feature)} and ` +
            `${JSON.stringify(contribution.feature)}.`,
          contribution.span,
        );
      }
      providers.set(dependency.name, { feature: contribution.feature, dependency });
    }
    for (const dependency of contribution.requires) {
      const values = requirements.get(dependency.name) ?? [];
      values.push({ feature: contribution.feature, dependency });
      requirements.set(dependency.name, values);
    }
  }

  const linkedDependencies: LinkedDependencyIR[] = [];
  const external: DependencyIR[] = [];
  const featureDependencies = new Map(
    contributions.map((contribution) => [contribution.feature, new Set<string>()]),
  );
  for (const name of [...new Set([...providers.keys(), ...requirements.keys()])].sort()) {
    const provider = providers.get(name);
    const consumers = [...(requirements.get(name) ?? [])].sort((left, right) =>
      left.feature.localeCompare(right.feature),
    );
    const canonical = provider?.dependency ?? consumers[0]?.dependency;
    if (!canonical) continue;
    for (const consumer of consumers) {
      if (!sameType(canonical.type, consumer.dependency.type)) {
        throw new ProgramLinkError(
          `Program ${JSON.stringify(program.name)} has incompatible contracts for Dependency ` +
            `${JSON.stringify(name)} between ${JSON.stringify(provider?.feature ?? consumers[0]!.feature)} ` +
            `and ${JSON.stringify(consumer.feature)}.`,
          program.contributions.find(({ feature }) => feature === consumer.feature)?.span ??
            program.contributions[0]!.span,
        );
      }
      if (provider && provider.feature !== consumer.feature) {
        featureDependencies.get(consumer.feature)!.add(provider.feature);
      }
    }
    linkedDependencies.push({
      name,
      type: canonical.type,
      consumers: consumers.map(({ feature }) => feature),
      ...(provider ? { provider: provider.feature } : {}),
    });
    if (!provider) external.push(canonical);
  }

  const dependants = new Map<string, Set<string>>();
  for (const [feature, values] of featureDependencies) {
    for (const dependency of values) {
      const items = dependants.get(dependency) ?? new Set<string>();
      items.add(feature);
      dependants.set(dependency, items);
    }
  }
  const ready = [...featureDependencies]
    .filter(([, values]) => values.size === 0)
    .map(([feature]) => feature)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const feature = ready.shift()!;
    order.push(feature);
    for (const dependant of [...(dependants.get(feature) ?? [])].sort()) {
      const values = featureDependencies.get(dependant)!;
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
      `Program ${JSON.stringify(program.name)} has a Dependency provider cycle between Features: ` +
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
    dependencies: linkedDependencies,
    external,
  };
}

export function linkApplicationPrograms(ir: ApplicationIR): readonly LinkedProgramIR[] {
  assertApplicationIRVersion(ir);
  return [...ir.programs]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(linkProgram);
}

/** Projects compiler IR into the dependency manifest consumed by every Process runtime. */
export function collectProgramManifest(program: ProgramIR): ProgramManifest {
  const linked = linkProgram(program);
  return {
    name: program.name,
    contributions: linked.contributions.map(({ contribution }) => ({
      feature: contribution.feature,
      requires: contribution.requires.map((dependency) => dependency.name).sort(),
      provides: contribution.provides.map((dependency) => dependency.name).sort(),
    })),
  };
}

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
  }));
}

function dependenciesFor(
  contributions: readonly ProgramContributionIR[],
  providers: ReadonlyMap<string, Readonly<{ feature: string; dependency: DependencyIR }>>,
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
