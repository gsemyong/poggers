import type {
  Feature,
  FeatureContract,
  FeatureContractOf,
  FeatureDefinitions,
  FeatureEnvironmentConflict,
} from "@/core/feature";
import type { ApplicationInterfaceKind, PlatformContract } from "@/core/program";

type Empty = Record<never, never>;
declare const systemContract: unique symbol;
declare const applicationContract: unique symbol;

type FeatureValue = Readonly<{ [Name in keyof Feature<FeatureContract>]?: unknown }>;
type FeatureValues = Readonly<Record<string, FeatureValue>>;
type FeatureContracts<Features extends FeatureValues> = {
  readonly [Name in keyof Features]: FeatureContractOf<Features[Name]>;
};
type FeaturesOf<Contract> = Contract extends {
  Features?: infer Features;
}
  ? Extract<NonNullable<Features>, Record<string, FeatureContract>>
  : Empty;
type DefinitionField<Name extends PropertyKey, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : { readonly [Key in Name]: Value };

type ApplicationFeatures<Contract> = Contract extends {
  Features?: infer Features;
}
  ? Extract<NonNullable<Features>, Record<string, FeatureContract>>
  : Empty;
type ApplicationPlatforms<Contract> = Contract extends {
  Interfaces?: infer Interfaces;
}
  ? Extract<NonNullable<Interfaces>, PlatformContract>
  : never;
type ApplicationInterfaces<Contract> = {
  readonly [Platform in ApplicationPlatforms<Contract> as Platform["Name"]]: Platform;
};
type ApplicationOwner<Contract extends ApplicationContract> = Readonly<{
  Features: ApplicationFeatures<Contract>;
}>;
type ApplyApplicationInterfaceKind<
  Kind extends ApplicationInterfaceKind,
  Owner extends FeatureContract,
> = (Kind & { readonly Owner: Owner })["Definition"];
type ApplicationInterfaceDefinitions<Contract extends ApplicationContract> = {
  readonly [Name in keyof ApplicationInterfaces<Contract>]: ApplicationInterfaces<Contract>[Name] extends {
    Application: infer Kind extends ApplicationInterfaceKind;
  }
    ? ApplyApplicationInterfaceKind<Kind, ApplicationOwner<Contract>>
    : never;
};
type ApplicationCompilerContract<Contract extends ApplicationContract> = Readonly<
  ApplicationOwner<Contract> & {
    Application: Contract;
    Interfaces: {
      readonly [Name in keyof ApplicationInterfaces<Contract>]: Readonly<{
        Interface: {
          Platform: ApplicationInterfaces<Contract>[Name];
        };
      }>;
    };
  }
>;

/** Type-level meaning of one independently addressable product experience. */
export type ApplicationContract = Readonly<{
  Name?: string;
  Features?: Record<string, FeatureContract>;
  Interfaces?: PlatformContract;
}>;

/**
 * One Application implementation.
 *
 * Applications compose Platform interfaces over Feature requirements. Concrete
 * Feature instances are owned once by the System and executable behavior stays
 * in those Features.
 */
export type Application<Contract extends ApplicationContract = ApplicationContract> = Readonly<{
  interfaces: ApplicationInterfaceDefinitions<Contract>;
  [applicationContract]?: ApplicationCompilerContract<Contract>;
}>;

export type ApplicationContractOf<Value> =
  Value extends Readonly<{
    [applicationContract]?: {
      Application: infer Contract extends ApplicationContract;
    };
  }>
    ? Contract
    : never;

/** Validates one Application while retaining its exact semantic contract. */
export function createApplication<Contract extends ApplicationContract>(
  definition: Readonly<{ interfaces: ApplicationInterfaceDefinitions<Contract> }>,
): Application<Contract> {
  return definition;
}

type ApplicationValue = Readonly<{
  [applicationContract]?: ApplicationCompilerContract<ApplicationContract>;
}>;
type ApplicationValues = Readonly<Record<string, ApplicationValue>>;
type ApplicationContracts<Applications extends ApplicationValues> = {
  readonly [Name in keyof Applications]: ApplicationContractOf<Applications[Name]>;
};
type ApplicationsOf<Contract> = Contract extends {
  Applications?: infer Applications;
}
  ? Extract<NonNullable<Applications>, Record<string, ApplicationContract>>
  : Empty;
type NormalizedSystemContract<
  Features extends FeatureValues,
  Applications extends ApplicationValues,
> = Readonly<{
  Features: FeatureContracts<Features>;
  Applications: ApplicationContracts<Applications>;
}>;

type SystemApplicationSpecifications<Contract> = Contract extends {
  Applications?: infer Applications;
}
  ? Extract<NonNullable<Applications>, Record<string, ApplicationContract>>
  : Empty;
type NormalizedDeclaredSystemContract<Contract extends SystemDefinitionContract> = Readonly<{
  Features: FeaturesOf<Contract>;
  Applications: SystemApplicationSpecifications<Contract>;
}>;
type SystemFeatureRoot<Contract> = Readonly<{ Features: FeaturesOf<Contract> }>;
type DeclaredSystemConflict<Contract extends SystemDefinitionContract> = FeatureEnvironmentConflict<
  SystemFeatureRoot<Contract>
>;

/** Type-level declaration for one company System before adapter meaning is projected. */
export type SystemDefinitionContract = Readonly<{
  Features?: Record<string, FeatureContract>;
  Applications?: Record<string, ApplicationContract>;
}>;

/** The normalized company-level product contract consumed by realization. */
export type SystemContract = FeatureContract &
  Readonly<{
    Applications?: Record<string, ApplicationContract>;
  }>;

export type SystemMetadata = Readonly<{ name: string }>;

type ExactSystemDefinition<Contract extends SystemContract> = DefinitionField<
  "features",
  FeatureDefinitions<FeaturesOf<Contract>, SystemFeatureRoot<Contract>>
> &
  DefinitionField<
    "applications",
    {
      readonly [Name in keyof ApplicationsOf<Contract>]: Application<
        Extract<ApplicationsOf<Contract>[Name], ApplicationContract>
      >;
    }
  >;

/**
 * The one compilation and development root.
 *
 * The private marker preserves the exact inferred contract for tooling.
 */
export type System<Contract extends SystemContract = SystemContract> = Readonly<
  {
    metadata?: SystemMetadata;
    features?: Readonly<Record<string, object>>;
    applications?: Readonly<Record<string, object>>;
    [systemContract]?: Contract;
  } & (string extends keyof FeaturesOf<Contract> | keyof ApplicationsOf<Contract>
    ? Empty
    : ExactSystemDefinition<Contract>)
>;

export type SystemContractOf<Value> =
  Value extends Readonly<{ [systemContract]?: infer Contract extends SystemContract }>
    ? Contract
    : never;

export type SystemFeatures<Contract extends SystemContract> = FeaturesOf<Contract>;
export type SystemApplications<Contract extends SystemContract> = ApplicationsOf<Contract>;

type DeclaredSystemDefinition<Contract extends SystemDefinitionContract> = Readonly<{
  metadata?: SystemMetadata;
}> &
  DefinitionField<
    "features",
    FeatureDefinitions<FeaturesOf<Contract>, SystemFeatureRoot<Contract>>
  > &
  DefinitionField<
    "applications",
    {
      readonly [Name in keyof SystemApplicationSpecifications<Contract>]: Application<
        SystemApplicationSpecifications<Contract>[Name]
      >;
    }
  >;

/** Defines one company System from concrete Features and Applications. */
export function createSystem<Contract extends SystemDefinitionContract>(
  definition: DeclaredSystemDefinition<Contract> &
    ([DeclaredSystemConflict<Contract>] extends [never] ? unknown : never),
): System<NormalizedDeclaredSystemContract<Contract>>;
/** Infers a System contract from already typed Features and Applications. */
export function createSystem<
  const Features extends FeatureValues = Empty,
  const Applications extends ApplicationValues = Empty,
>(
  definition: Readonly<{
    metadata?: SystemMetadata;
    features?: Features;
    applications?: Applications;
  }> &
    ([FeatureEnvironmentConflict<{ Features: FeatureContracts<Features> }>] extends [never]
      ? unknown
      : never),
): System<NormalizedSystemContract<Features, Applications>>;
export function createSystem(
  definition: Readonly<{
    metadata?: SystemMetadata;
    features?: FeatureValues;
    applications?: ApplicationValues;
  }>,
): System<SystemContract> {
  return definition as System<SystemContract>;
}
