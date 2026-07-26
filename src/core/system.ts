import type {
  Feature,
  FeatureContract,
  FeatureContractOf,
  FeatureDefinitions,
  FeatureEnvironmentConflict,
} from "@/core/feature";
import type { PlatformContract } from "@/core/program";

type Empty = Record<never, never>;
declare const systemContract: unique symbol;
declare const platformInterfaceContract: unique symbol;

type FeatureValue = Readonly<{ [Name in keyof Feature<FeatureContract>]?: unknown }>;

type FeatureValues = Readonly<Record<string, FeatureValue>>;

type FeatureContracts<Features extends FeatureValues> = {
  readonly [Name in keyof Features]: FeatureContractOf<Features[Name]>;
};

type InferredSystemContract<Features extends FeatureValues> = {
  Features: FeatureContracts<Features>;
};

type FeaturesOf<Contract> = Contract extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;

/** The complete company-level product contract. */
export type SystemContract = FeatureContract;

export type SystemMetadata = Readonly<{ name: string }>;

type SystemDefinition<Contract extends SystemContract> = Readonly<{
  metadata?: SystemMetadata;
  features: FeatureDefinitions<FeaturesOf<Contract>, Contract>;
}>;

/**
 * The one compilation and development root.
 *
 * The private marker preserves the exact inferred contract for tooling.
 */
export type System<Contract extends SystemContract = SystemContract> = Contract extends {
  Programs: Record<string, unknown>;
}
  ? never
  : [FeatureEnvironmentConflict<Contract>] extends [never]
    ? SystemDefinition<Contract> & Readonly<{ [systemContract]?: Contract }>
    : never;

export type SystemContractOf<Value> =
  Value extends Readonly<{ [systemContract]?: infer Contract extends SystemContract }>
    ? Contract
    : never;

export type SystemFeatures<Contract extends SystemContract> = FeaturesOf<Contract>;

/** Infers one System contract from its already typed Feature instances. */
export function createSystem<const Features extends FeatureValues>(
  definition: Readonly<{
    metadata?: SystemMetadata;
    features: Features;
  }> &
    ([FeatureEnvironmentConflict<InferredSystemContract<Features>>] extends [never]
      ? unknown
      : never),
): System<InferredSystemContract<Features>> {
  return definition as unknown as System<InferredSystemContract<Features>>;
}

/** Compiler-readable meaning retained by every adapter-defined Platform interface. */
export type PlatformInterfaceContract<Platform extends PlatformContract> = Readonly<{
  Interface: { Platform: Platform };
}>;

/**
 * Adapter configuration for one Platform over one exact App contract.
 *
 * The marker is type-only. Adapter factories return the configuration value
 * unchanged while preserving its owner and Platform for composition tooling.
 */
export type PlatformInterface<
  Owner extends FeatureContract,
  Platform extends PlatformContract,
  Definition extends object = Empty,
> = Readonly<
  Definition & {
    [platformInterfaceContract]: {
      Owner: Owner;
      Contract: PlatformInterfaceContract<Platform>;
    };
  }
>;

type PlatformInterfaceValue = PlatformInterface<
  FeatureContract,
  PlatformContract,
  Readonly<Record<string, unknown>>
>;
type PlatformInterfaceValues = Readonly<Record<string, PlatformInterfaceValue>>;
type PlatformInterfaceOwner<Value> =
  Value extends PlatformInterface<infer Owner, PlatformContract, object> ? Owner : never;
type PlatformInterfaceMeaning<Value> =
  Value extends PlatformInterface<FeatureContract, infer Platform, object>
    ? PlatformInterfaceContract<Platform>
    : never;
type PlatformInterfaceMeanings<Interfaces extends PlatformInterfaceValues> = {
  readonly [Name in keyof Interfaces]: PlatformInterfaceMeaning<Interfaces[Name]>;
};
type InvalidPlatformInterfaceOwners<
  Contract extends FeatureContract,
  Interfaces extends PlatformInterfaceValues,
> = {
  [Name in keyof Interfaces]: [Contract] extends [PlatformInterfaceOwner<Interfaces[Name]>]
    ? [PlatformInterfaceOwner<Interfaces[Name]>] extends [Contract]
      ? never
      : Name
    : Name;
}[keyof Interfaces];

/** Type-only markers added to an ordinary Feature contract by `createApp`. */
export type AppFeatureContract<
  Contract extends FeatureContract,
  Interfaces extends Readonly<Record<string, PlatformInterfaceContract<PlatformContract>>> = Empty,
> = Readonly<Contract & { App: true; Interfaces: Interfaces }>;

export type AppFeature<
  Contract extends FeatureContract,
  Interfaces extends PlatformInterfaceValues = PlatformInterfaceValues,
> = Feature<AppFeatureContract<Contract, PlatformInterfaceMeanings<Interfaces>>> &
  Readonly<{ interfaces: Interfaces }>;

/**
 * Defines one product App from concrete Feature instances and Platform
 * interfaces. Reusing a Feature value preserves its semantic instance.
 */
export function createApp<
  const Features extends FeatureValues,
  const Interfaces extends PlatformInterfaceValues,
>(
  app: Readonly<{ features: Features; interfaces: Interfaces }> &
    ([InvalidPlatformInterfaceOwners<InferredSystemContract<Features>, Interfaces>] extends [never]
      ? unknown
      : never),
): AppFeature<InferredSystemContract<Features>, Interfaces> {
  return app as unknown as AppFeature<InferredSystemContract<Features>, Interfaces>;
}
