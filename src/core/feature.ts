import type {
  EnvironmentContract,
  HasProgramUI,
  ProgramActions,
  ProgramComponents,
  ProgramContract,
  ProgramProvides as ProvidedByProgram,
  ProgramRequires as RequiredByProgram,
  ProgramState,
} from "@/core/program";
import type { ComponentDefinitions, RootComponentName } from "@/core/ui/component";

type Empty = Record<never, never>;
type ProgramResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ProgramResourceResult = void | ProgramResource | PromiseLike<void | ProgramResource>;
declare const featureContract: unique symbol;

export type FeatureContract = {
  Programs?: Record<string, ProgramContract>;
  Features?: Record<string, FeatureContract>;
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
  } & (HasUI<Contract> extends true
    ? {
        actions: ActionAPI<Contract>;
        features: FeatureUIAPIs<Owner, ProgramName>;
      }
    : Empty)
>;

type ProgramStartResult<Contract extends ProgramContract> = keyof ProvidesOf<Contract> extends never
  ? ProgramResourceResult
  : ProvidesOf<Contract> | PromiseLike<ProvidesOf<Contract>>;

export type ProgramDefinition<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Root extends FeatureContract,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<
  (HasUI<Contract> extends true
    ? ProgramUIFields<Owner, ProgramName, Contract, Root>
    : {
        state?: never;
        actions?: never;
        components?: never;
        root?: never;
      }) &
    (keyof ProvidesOf<Contract> extends never
      ? {
          start?: (
            context: ProgramStartContext<Owner, ProgramName, Contract>,
          ) => ProgramStartResult<Contract>;
        }
      : {
          start: (
            context: ProgramStartContext<Owner, ProgramName, Contract>,
          ) => ProgramStartResult<Contract>;
        })
>;

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
      readonly [featureContract]?: Contract;
    }
>;

/** Validates one Feature implementation and retains its exact semantic contract. */
export function createFeature<Contract extends FeatureContract>(
  definition: Feature<Contract>,
): Feature<Contract> {
  return definition;
}

export type ProgramNamesIn<
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

type PlacedPrograms<Programs, Placement> = {
  readonly [Name in keyof Programs as Name extends keyof Placement
    ? Placement[Name] extends PropertyKey
      ? Placement[Name]
      : Name
    : Name]: Programs[Name];
};

/** The Feature contract produced by assigning logical Program roles to concrete Program names. */
export type PlacedFeature<Owner extends FeatureContract, Placement extends object> = Readonly<
  Omit<Owner, "Programs" | "Features"> &
    (Owner extends { Programs: infer Programs extends Record<string, ProgramContract> }
      ? { Programs: PlacedPrograms<Programs, Placement> }
      : Empty) &
    (Owner extends { Features: infer Features extends Record<string, FeatureContract> }
      ? {
          Features: {
            readonly [Name in keyof Features]: PlacedFeature<Features[Name], Placement>;
          };
        }
      : Empty)
>;

/** Assigns reusable logical Program roles throughout one Feature tree to concrete names. */
export function placePrograms<
  Value extends Readonly<{ [featureContract]?: FeatureContract }>,
  const Placement extends Partial<Record<ProgramNamesIn<FeatureContractOf<Value>>, string>>,
>(
  feature: Value,
  placement: Placement,
): Feature<PlacedFeature<FeatureContractOf<Value>, Placement>> &
  Omit<Value, "programs" | "features" | typeof featureContract> {
  return placeFeaturePrograms(
    feature as Readonly<Record<string, unknown>>,
    placement as Readonly<Record<string, string>>,
    "",
  ) as Feature<PlacedFeature<FeatureContractOf<Value>, Placement>> &
    Omit<Value, "programs" | "features" | typeof featureContract>;
}

export type FeatureContractOf<Value> =
  Value extends Readonly<{
    [featureContract]?: infer Contract extends FeatureContract;
  }>
    ? Contract
    : never;

function placeFeaturePrograms(
  feature: Readonly<Record<string, unknown>>,
  placement: Readonly<Record<string, string>>,
  path: string,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...feature };
  const programs = record(feature.programs);
  if (programs) {
    const placed: Record<string, unknown> = Object.create(null);
    for (const [name, program] of Object.entries(programs)) {
      const target = placement[name] ?? name;
      if (Object.hasOwn(placed, target)) {
        throw new Error(
          `Feature ${JSON.stringify(path || "<root>")} maps multiple Programs to ${JSON.stringify(target)}.`,
        );
      }
      placed[target] = program;
    }
    result.programs = placed;
  }
  const features = record(feature.features);
  if (features) {
    result.features = Object.fromEntries(
      Object.entries(features).map(([name, child]) => {
        const childFeature = record(child);
        if (!childFeature)
          throw new TypeError(`Feature ${JSON.stringify(name)} must be an object.`);
        return [
          name,
          placeFeaturePrograms(childFeature, placement, path ? `${path}.${name}` : name),
        ];
      }),
    );
  }
  return result;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

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
