import type { DependencyImplementations } from "@/core/dependency";
import type {
  EnvironmentContract,
  HasProgramUI,
  ProgramActions,
  ProgramComponents,
  ProgramContract,
  ProgramProvides as ProvidedByProgram,
  ProgramRequires as RequiredByProgram,
  ProgramState,
  ProgramDefinitionKind,
  ValidProgramContract,
} from "@/core/program";
import type { ComponentDefinitions, RootComponentName } from "@/core/ui/component";

type Empty = Record<never, never>;
type ProgramResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ProgramResourceResult = void | ProgramResource | PromiseLike<void | ProgramResource>;
declare const featureContract: unique symbol;

export type FeatureContract = {
  Programs?: Record<string, ProgramContract>;
  Features?: Record<string, FeatureContract>;
  Providers?: Record<string, Record<string, object>>;
};

type StateOf<Contract> = ProgramState<Contract>;
type ActionsOf<Contract> = ProgramActions<Contract>;
type ComponentsOf<Contract> = ProgramComponents<Contract>;
type RequiresOf<Contract> = RequiredByProgram<Contract>;
type ProvidesOf<Contract> = ProvidedByProgram<Contract>;
type HasUI<Contract> = HasProgramUI<Contract>;
type ProgramsOf<Contract> = Contract extends {
  Programs: infer Value extends Record<string, ProgramContract>;
}
  ? Value
  : Empty;
type EnvironmentOf<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Name extends keyof ProgramsOf<Owner>
  ? ProgramsOf<Owner>[Name] extends { Environment: infer Environment extends EnvironmentContract }
    ? Environment
    : never
  : never;
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

type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type ActionArguments<Action> = Action extends (...args: infer Args) => unknown ? Args : never;
type ActionResult<Action> = Action extends (...args: never[]) => infer Result ? Result : never;
type DefinitionField<Name extends PropertyKey, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : { readonly [Key in Name]: Value };

type ActionAPI<Contract> = {
  readonly [Name in keyof ActionsOf<Contract>]: ActionsOf<Contract>[Name];
};

type APICollision<Contract> = Extract<keyof StateOf<Contract>, keyof ActionsOf<Contract>>;

type ProgramNameWithUI<Owner extends FeatureContract> = {
  [Name in keyof ProgramsOf<Owner>]: HasUI<ProgramsOf<Owner>[Name]> extends true ? Name : never;
}[keyof ProgramsOf<Owner>];

/** The direct UI contract for a Program owner or a Feature with one UI Program. */
export type UIOf<Owner extends FeatureContract> =
  HasUI<Owner> extends true
    ? Owner
    : ProgramNameWithUI<Owner> extends infer Name
      ? Name extends keyof ProgramsOf<Owner>
        ? ProgramsOf<Owner>[Name]
        : never
      : never;

export type UIContributionAPI<Owner extends FeatureContract> =
  UIOf<Owner> extends infer UI
    ? [APICollision<UI>] extends [never]
      ? Readonly<StateOf<UI>> & ActionAPI<UI>
      : never
    : Empty;

export type UIState<Owner extends FeatureContract> = Readonly<StateOf<UIOf<Owner>>>;
export type UIActions<Owner extends FeatureContract> = ActionAPI<UIOf<Owner>>;

/** Projects one named Program through a Feature tree for Components and Presentations. */
export type ProgramOwner<Owner extends FeatureContract, Name extends PropertyKey> = Readonly<
  (Name extends keyof ProgramsOf<Owner>
    ? { readonly Environment: EnvironmentOf<Owner, Name> }
    : { readonly Environment?: never }) &
    DefinitionField<
      "Requires",
      Name extends keyof ProgramsOf<Owner> ? RequiresOf<ProgramsOf<Owner>[Name]> : Empty
    > &
    DefinitionField<
      "Provides",
      Name extends keyof ProgramsOf<Owner> ? ProvidesOf<ProgramsOf<Owner>[Name]> : Empty
    > &
    DefinitionField<
      "State",
      Name extends keyof ProgramsOf<Owner> ? StateOf<ProgramsOf<Owner>[Name]> : Empty
    > &
    DefinitionField<
      "Actions",
      Name extends keyof ProgramsOf<Owner> ? ActionsOf<ProgramsOf<Owner>[Name]> : Empty
    > &
    DefinitionField<
      "Components",
      Name extends keyof ProgramsOf<Owner> ? ComponentsOf<ProgramsOf<Owner>[Name]> : Empty
    > & {
      readonly Features: {
        readonly [FeatureName in keyof FeaturesOf<Owner>]: ProgramOwner<
          Extract<FeaturesOf<Owner>[FeatureName], FeatureContract>,
          Name
        >;
      };
    }
>;

export type FeatureUIAPIs<
  Owner extends FeatureContract,
  ProgramName extends PropertyKey = ProgramNameWithUI<Owner>,
> = {
  readonly [Name in keyof FeaturesOf<Owner>]: UIContributionAPI<
    ProgramOwner<Extract<FeaturesOf<Owner>[Name], FeatureContract>, ProgramName>
  >;
};

export type UIActionContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<{
  dependencies: Readonly<RequiresOf<Contract> & ProvidesOf<Contract>>;
  features: FeatureUIAPIs<Owner, ProgramName>;
  state: Mutable<StateOf<Contract>>;
}>;

type UIActionDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
> = {
  readonly [Name in keyof ActionsOf<Contract>]: (
    context: UIActionContext<Owner, ProgramName, Contract>,
    ...args: ActionArguments<ActionsOf<Contract>[Name]>
  ) => ActionResult<ActionsOf<Contract>[Name]>;
};

type UIComponentDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Root extends FeatureContract,
> = ComponentDefinitions<ProgramOwner<Root, ProgramName>, ProgramOwner<Owner, ProgramName>>;

type ProgramUIFields<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> = DefinitionField<"state", Mutable<StateOf<Contract>>> &
  DefinitionField<"actions", UIActionDefinitions<Owner, ProgramName, Contract>> &
  DefinitionField<"components", UIComponentDefinitions<Owner, ProgramName, Root>> & {
    root?: RootComponentName<ProgramOwner<Owner, ProgramName>>;
  };

export type ProgramStartContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<
  {
    dependencies: RequiredByProgram<Contract>;
  } & (Contract extends { Provides: infer Provides extends object }
    ? { provides: readonly Extract<keyof Provides, string>[] }
    : Empty) &
    (HasUI<Contract> extends true
      ? {
          actions: ActionAPI<Contract>;
          features: FeatureUIAPIs<Owner, ProgramName>;
        }
      : Empty)
>;

type ProgramStartResult<Contract extends ProgramContract> = Contract extends {
  Provides: infer Provides extends object;
}
  ? DependencyImplementations<Provides> | PromiseLike<DependencyImplementations<Provides>>
  : ProgramResourceResult;

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
> =
  ValidProgramContract<Contract> extends true
    ? Readonly<
        (HasUI<Contract> extends true
          ? ProgramUIFields<Owner, ProgramName, Contract, Root>
          : {
              state?: never;
              actions?: never;
              components?: never;
              root?: never;
            }) &
          (Contract extends { Provides: object }
            ? {
                start: (
                  context: ProgramStartContext<Owner, ProgramName, Contract>,
                ) => ProgramStartResult<Contract>;
              }
            : {
                start?: (
                  context: ProgramStartContext<Owner, ProgramName, Contract>,
                ) => ProgramStartResult<Contract>;
              }) &
          PlatformProgramDefinition<Owner, ProgramName, Root, Contract>
      >
    : never;

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
  ? Environment["Platform"] extends { UI: { Name: infer UIName extends string } }
    ? `${EnvironmentName}@${PlatformName}/${UIName}`
    : `${EnvironmentName}@${PlatformName}`
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
