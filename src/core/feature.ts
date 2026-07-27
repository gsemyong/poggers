import type { EnvironmentContract, ProgramContract, ProgramDefinitionKind } from "@/core/program";

type Empty = Record<never, never>;
declare const featureContract: unique symbol;

export type FeatureContract = {
  Programs?: Record<string, ProgramContract>;
  Features?: Record<string, FeatureContract>;
  Providers?: Record<string, Record<string, object>>;
};

type ProgramsOf<Contract> = Contract extends {
  Programs: infer Value extends Record<string, ProgramContract>;
}
  ? Value
  : Empty;
type FeaturesOf<Contract> = Contract extends {
  Features: infer Value extends Record<string, FeatureContract>;
}
  ? Value
  : Empty;
type ProvidersOf<Contract> = Contract extends {
  Providers: infer Value extends Record<string, Record<string, object>>;
}
  ? Value
  : Empty;

type DefinitionField<Name extends PropertyKey, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : { readonly [Key in Name]: Value };

/**
 * Projects one named Program through a Feature tree without interpreting the
 * Program language selected by its Environment.
 */
export type ProgramOwner<Owner extends FeatureContract, Name extends PropertyKey> = Readonly<
  (Name extends keyof ProgramsOf<Owner>
    ? Omit<ProgramsOf<Owner>[Name], "Features">
    : { readonly Environment?: never }) & {
    readonly Features: {
      readonly [FeatureName in keyof FeaturesOf<Owner>]: ProgramOwner<
        Extract<FeaturesOf<Owner>[FeatureName], FeatureContract>,
        Name
      >;
    };
  }
>;

type ApplyProgramDefinitionKind<
  Kind extends ProgramDefinitionKind,
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Root extends FeatureContract,
  Contract extends ProgramContract,
> = (Kind & {
  readonly Owner: Owner;
  readonly ProgramName: ProgramName;
  readonly Root: Root;
  readonly Contract: Contract;
})["Definition"];

type PlatformProgramDefinition<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Root extends FeatureContract,
  Contract extends ProgramContract,
> = Contract["Environment"]["Platform"] extends {
  Program: infer Kind extends ProgramDefinitionKind;
}
  ? ApplyProgramDefinitionKind<Kind, Owner, ProgramName, Root, Contract>
  : Empty;

export type ProgramDefinition<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Root extends FeatureContract,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<PlatformProgramDefinition<Owner, ProgramName, Root, Contract>>;

export type ProgramDefinitions<Owner extends FeatureContract, Root extends FeatureContract> = {
  readonly [Name in keyof ProgramsOf<Owner>]: ProgramDefinition<Owner, Name, Root>;
};

export type FeatureDefinitions<
  Features extends Record<string, FeatureContract>,
  Root extends FeatureContract = { Features: Features },
> = {
  readonly [Name in keyof Features]:
    | Feature<Extract<Features[Name], FeatureContract>, Root>
    | Feature<Extract<Features[Name], FeatureContract>>;
};

/** A reusable vertical slice that contributes to Programs and composes children. */
export type Feature<
  Contract extends FeatureContract,
  Root extends FeatureContract = Contract,
> = Readonly<
  DefinitionField<"programs", ProgramDefinitions<Contract, Root>> &
    DefinitionField<"features", FeatureDefinitions<FeaturesOf<Contract>, Root>> & {
      readonly providers?: ProvidersOf<Contract>;
      readonly [featureContract]?: Contract;
    }
>;

/** Validates one Feature implementation and retains its exact semantic contract. */
export function createFeature<Contract extends FeatureContract>(
  definition: Feature<Contract> &
    ([FeatureEnvironmentConflict<Contract>] extends [never] ? unknown : never),
): Feature<Contract> {
  return definition;
}

type RuntimeFeatureProviderOwner = Readonly<{
  features?: Readonly<Record<string, RuntimeFeatureProviderOwner>>;
  applications?: Readonly<Record<string, RuntimeFeatureProviderOwner>>;
  providers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

/**
 * Resolves one compiler-selected provider from its retained Feature owner.
 *
 * Selection and conflict handling use compiler meaning; this function only
 * recovers the corresponding runtime implementation after loading a System.
 */
export function resolveFeatureProvider<Provider>(
  system: RuntimeFeatureProviderOwner,
  input: Readonly<{ feature: string; platform: string; dependency: string }>,
): Provider {
  const [root, ...path] = input.feature.split(".").filter(Boolean);
  let owner = root
    ? (system.applications?.[root] ?? system.features?.[root])
    : (system as RuntimeFeatureProviderOwner | undefined);
  for (const name of path) {
    owner = owner?.features?.[name];
    if (!owner) {
      throw new Error(
        `Feature provider owner ${JSON.stringify(input.feature)} is unavailable at runtime.`,
      );
    }
  }
  if (!owner) {
    throw new Error(
      `Feature provider owner ${JSON.stringify(input.feature)} is unavailable at runtime.`,
    );
  }
  const provider = owner.providers?.[input.platform]?.[input.dependency];
  if (provider === undefined) {
    throw new Error(
      `Feature ${JSON.stringify(input.feature)} has no ${JSON.stringify(input.platform)} ` +
        `provider for Dependency ${JSON.stringify(input.dependency)}.`,
    );
  }
  return provider as Provider;
}

export type FeatureContractOf<Value> =
  Value extends Readonly<{
    [featureContract]?: infer Contract extends FeatureContract;
  }>
    ? Contract
    : never;

type ProgramNamesIn<
  Owner extends FeatureContract,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | Extract<keyof ProgramsOf<Owner>, PropertyKey>
      | {
          [Name in keyof FeaturesOf<Owner>]: ProgramNamesIn<
            Extract<FeaturesOf<Owner>[Name], FeatureContract>,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

type EnvironmentIdentity<Environment extends EnvironmentContract> = Environment extends {
  Name: infer EnvironmentName extends string;
  Platform: { Name: infer PlatformName extends string };
}
  ? `${EnvironmentName}@${PlatformName}`
  : never;

type EnvironmentIdentitiesFor<
  Owner extends FeatureContract,
  Name extends PropertyKey,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | (Name extends keyof ProgramsOf<Owner>
          ? ProgramsOf<Owner>[Name] extends {
              Environment: infer Environment extends EnvironmentContract;
            }
            ? EnvironmentIdentity<Environment>
            : never
          : never)
      | {
          [FeatureName in keyof FeaturesOf<Owner>]: EnvironmentIdentitiesFor<
            Extract<FeaturesOf<Owner>[FeatureName], FeatureContract>,
            Name,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

type IsUnion<Value, Whole = Value> = Value extends Whole
  ? [Whole] extends [Value]
    ? false
    : true
  : never;

export type FeatureEnvironmentConflict<Owner extends FeatureContract> =
  string extends keyof FeaturesOf<Owner>
    ? never
    : {
        [Name in ProgramNamesIn<Owner>]: true extends IsUnion<EnvironmentIdentitiesFor<Owner, Name>>
          ? Name
          : never;
      }[ProgramNamesIn<Owner>];
