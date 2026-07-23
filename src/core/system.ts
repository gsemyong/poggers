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

/** Type-only marker added to an ordinary Feature contract by `createApp`. */
export type AppFeatureContract<Contract extends FeatureContract> = Readonly<
  Contract & { App: true }
>;

export type AppFeature<Contract extends FeatureContract> = Feature<AppFeatureContract<Contract>>;

/** Creates a product App without introducing another composition primitive. */
export function createApp<Contract extends FeatureContract>(
  feature: Feature<Contract>,
): AppFeature<Contract> {
  return feature as unknown as AppFeature<Contract>;
}

/** Type-only ownership marker added by a Platform's interface Feature factory. */
export type PlatformInterfaceContract<
  Contract extends FeatureContract,
  Platform extends PlatformContract,
> = Readonly<Contract & { Interface: { Platform: Platform } }>;

export type PlatformInterfaceFeature<
  Contract extends FeatureContract,
  Platform extends PlatformContract,
> = Feature<PlatformInterfaceContract<Contract, Platform>>;
