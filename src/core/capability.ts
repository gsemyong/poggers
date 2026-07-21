import type { ApplicationContract, FeatureContract, ProgramContract } from "@/core/application";

type Empty = Record<never, never>;
type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] };
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type ProgramsOf<Owner> = Owner extends {
  Programs: infer Programs extends Record<string, ProgramContract>;
}
  ? Programs
  : Empty;

type FeaturesOf<Owner> = Owner extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;

type ProgramContractIn<
  Owner extends FeatureContract,
  Name extends PropertyKey,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | (Name extends keyof ProgramsOf<Owner> ? ProgramsOf<Owner>[Name] : never)
      | {
          [Feature in keyof FeaturesOf<Owner>]: ProgramContractIn<
            Extract<FeaturesOf<Owner>[Feature], FeatureContract>,
            Name,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

type RequiresOf<Contract> = Contract extends { Requires: infer Requires extends object }
  ? Requires
  : Empty;

type ProvidesOf<Contract> = Contract extends { Provides: infer Provides extends object }
  ? Provides
  : Empty;

type RequiredIn<Owner extends FeatureContract, Name extends PropertyKey> = UnionToIntersection<
  RequiresOf<ProgramContractIn<Owner, Name>>
>;

type ProvidedIn<Owner extends FeatureContract, Name extends PropertyKey> = UnionToIntersection<
  ProvidesOf<ProgramContractIn<Owner, Name>>
>;

export type ProgramName<
  Owner extends FeatureContract,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 6
  ? never
  :
      | Extract<keyof ProgramsOf<Owner>, PropertyKey>
      | {
          [Feature in keyof FeaturesOf<Owner>]: ProgramName<
            Extract<FeaturesOf<Owner>[Feature], FeatureContract>,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

/** Every Capability required by contributions to one named Program. */
export type ProgramRequiredCapabilities<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<RequiredIn<Owner, Name>>;

/** Every Capability supplied by Features contributing to one named Program. */
export type ProgramProvidedCapabilities<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<ProvidedIn<Owner, Name>>;

/** Capabilities the Application must implement once for one running Program. */
export type ProgramExternalCapabilities<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<Omit<RequiredIn<Owner, Name>, keyof ProvidedIn<Owner, Name>>>;

type CapabilityResult<Value> = Value | PromiseLike<Value>;

/** Build-profile implementations for the external contract inferred from an Application. */
export type ProgramCapabilities<Owner extends ApplicationContract, Name extends PropertyKey> =
  Name extends ProgramName<Owner>
    ? Readonly<{
        development(): CapabilityResult<ProgramExternalCapabilities<Owner, Name>>;
        production(): CapabilityResult<ProgramExternalCapabilities<Owner, Name>>;
      }>
    : never;

export type CapabilityProfile = "development" | "production";

/** Runtime shape of a type-checked Program capability module. */
export type ProgramCapabilityModule = Readonly<{
  development(): CapabilityResult<Readonly<Record<string, unknown>>>;
  production(): CapabilityResult<Readonly<Record<string, unknown>>>;
}>;

/** Compiler-derived dependency meaning for one Feature contribution. */
export type ProgramContributionManifest = Readonly<{
  feature: string;
  requires: readonly string[];
  provides: readonly string[];
}>;

/** Compiler-derived dependency graph for one named Program. */
export type ProgramManifest = Readonly<{
  name: string;
  contributions: readonly ProgramContributionManifest[];
}>;

/** Projects compiler IR into the dependency manifest consumed by every Process runtime. */
export function collectProgramManifest(
  name: string,
  programs: readonly Readonly<{
    feature: string;
    name: string;
    requires: readonly Readonly<{ name: string }>[];
    provides: readonly Readonly<{ name: string }>[];
  }>[],
): ProgramManifest {
  return {
    name,
    contributions: programs
      .filter((program) => program.name === name)
      .map((program) => ({
        feature: program.feature,
        requires: program.requires.map((capability) => capability.name).sort(),
        provides: program.provides.map((capability) => capability.name).sort(),
      }))
      .sort((left, right) => left.feature.localeCompare(right.feature)),
  };
}

/** The stable identity of one Feature contribution to a named Program. */
export type ProgramContributionAddress = Readonly<{
  program: string;
  feature: string;
}>;
