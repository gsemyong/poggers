import {
  assertSystemIRVersion,
  collectDependencyOperations,
  orderDependencyGraph,
  typeIdentity,
  type SystemIR,
  type DependencyIR,
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
      if (
        canonical.binding !== consumer.dependency.binding ||
        !sameType(canonical.type, consumer.dependency.type) ||
        !sameOptionalType(canonical.failures, consumer.dependency.failures) ||
        !sameHeartbeats(canonical.heartbeats, consumer.dependency.heartbeats) ||
        !sameReference(canonical.reference, consumer.dependency.reference)
      ) {
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
      ...(canonical.failures ? { failures: canonical.failures } : {}),
      ...(canonical.heartbeats ? { heartbeats: canonical.heartbeats } : {}),
      ...(canonical.binding ? { binding: canonical.binding } : {}),
      ...(canonical.reference ? { reference: canonical.reference } : {}),
      consumers: consumers.map(({ feature }) => feature),
      ...(provider ? { provider: provider.feature } : {}),
    });
    if (!provider) external.push(canonical);
  }

  const order = orderDependencyGraph(featureDependencies);
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

export function linkSystemPrograms(ir: SystemIR): readonly LinkedProgramIR[] {
  assertSystemIRVersion(ir);
  return [...ir.programs]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(linkProgram);
}

/** Projects compiler IR into the dependency manifest consumed by every Process runtime. */
export function collectProgramManifest(program: ProgramIR): ProgramManifest {
  const linked = linkProgram(program);
  return {
    name: program.name,
    bindings: linked.dependencies
      .filter(({ binding }) => binding === "envelope")
      .map((dependency) => ({
        name: dependency.name,
        binding: "envelope",
        operations: collectDependencyOperations(dependency),
        ...(dependency.reference ? { reference: dependency.reference } : {}),
      })),
    contributions: linked.contributions.map(({ contribution }) => ({
      feature: contribution.feature,
      requires: contribution.requires.map((dependency) => dependency.name).sort(),
      provides: contribution.provides.map((dependency) => dependency.name).sort(),
    })),
  };
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

function sameOptionalType(left: TypeIR | undefined, right: TypeIR | undefined): boolean {
  return left && right ? sameType(left, right) : left === right;
}

function sameHeartbeats(
  left: DependencyIR["heartbeats"],
  right: DependencyIR["heartbeats"],
): boolean {
  if (!left || !right) return left === right;
  return (
    [...left]
      .sort((first, second) => first.operation.localeCompare(second.operation))
      .map(({ operation, type }) => `${operation}:${typeIdentity(type)}`)
      .join("\n") ===
    [...right]
      .sort((first, second) => first.operation.localeCompare(second.operation))
      .map(({ operation, type }) => `${operation}:${typeIdentity(type)}`)
      .join("\n")
  );
}

function sameReference(left: DependencyIR["reference"], right: DependencyIR["reference"]): boolean {
  if (!left || !right) return left === right;
  return (
    left.name === right.name &&
    left.argument === right.argument &&
    [...left.inputs].sort().join("\n") === [...right.inputs].sort().join("\n")
  );
}
