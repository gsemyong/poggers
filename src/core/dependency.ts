import type { FeatureContract } from "@/core/feature";
import type { ProgramContract } from "@/core/program";

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

/** Every Dependency required by contributions to one named Program. */
export type ProgramRequiredDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<RequiredIn<Owner, Name>>;

/** Every Dependency supplied by Features contributing to one named Program. */
export type ProgramProvidedDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<ProvidedIn<Owner, Name>>;

/** Dependencies the System host must implement once for one running Program. */
export type ProgramExternalDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<Omit<RequiredIn<Owner, Name>, keyof ProvidedIn<Owner, Name>>>;

/** The stable identity of one Feature contribution to a named Program. */
export type ProgramContributionAddress = Readonly<{
  program: string;
  feature: string;
}>;
