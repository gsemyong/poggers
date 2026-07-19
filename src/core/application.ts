import type { ComponentContract, ComponentDefinitions, RootComponentName } from "./component";
import type { UIContract, UIDefinition, UIElementName } from "./ui";

type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;
type UIKey = "State" | "Actions" | "Components";
type ProgramResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ProgramResourceResult = void | ProgramResource | PromiseLike<void | ProgramResource>;

/** One technical realization family. Every Platform supports Processes; UI is optional. */
export type PlatformContract = Readonly<{
  Name: string;
  UI?: UIContract;
}>;

/** One authored execution context realized by exactly one Platform. */
export type EnvironmentContract = Readonly<{
  Name: string;
  Platform: PlatformContract;
  UI?: UIContract;
}>;

/** Rejects an Environment whose UI is not the UI language owned by its Platform. */
export type EnvironmentDefinition<Environment extends EnvironmentContract> = Environment extends {
  UI: infer UI extends UIContract;
}
  ? Environment["Platform"] extends { UI: infer PlatformUI extends UIContract }
    ? [UI] extends [PlatformUI]
      ? [PlatformUI] extends [UI]
        ? Environment
        : never
      : never
    : never
  : Environment;

export type ProgramContract = {
  Environment: EnvironmentContract;
  Requires?: object;
  Provides?: object;
  State?: object;
  Actions?: ActionRecord;
  Components?: Record<string, ComponentContract>;
};

type HasUI<Contract> = [Extract<keyof Contract, UIKey>] extends [never] ? false : true;

type ComponentPrimitiveNames<Contract> = [keyof ComponentsOf<Contract>] extends [never]
  ? never
  : ComponentsOf<Contract>[keyof ComponentsOf<Contract>] extends {
        Elements: infer Elements extends Record<string, string>;
      }
    ? Elements[keyof Elements]
    : never;

type SupportsComponents<Environment extends EnvironmentContract, Contract> = Environment extends {
  UI: infer UI extends UIContract;
}
  ? UI extends UIDefinition<UI>
    ? [ComponentPrimitiveNames<Contract>] extends [never]
      ? true
      : Exclude<ComponentPrimitiveNames<Contract>, UIElementName<UI>> extends never
        ? true
        : false
    : false
  : false;

/** Declares one Program and the Environment in which its Processes execute. */
export type Program<
  Environment extends EnvironmentContract,
  Contract extends Omit<ProgramContract, "Environment"> = Empty,
> =
  Environment extends EnvironmentDefinition<Environment>
    ? HasUI<Contract> extends true
      ? Environment extends { UI: UIContract }
        ? SupportsComponents<Environment, Contract> extends true
          ? Readonly<Contract & { Environment: Environment }>
          : never
        : never
      : Readonly<Contract & { Environment: Environment }>
    : never;

export type FeatureContract = {
  Programs?: Record<string, ProgramContract>;
  Features?: Record<string, FeatureContract>;
};

export type ApplicationContract = FeatureContract & {
  Presentations?: string | Record<string, unknown>;
};

type StateOf<Contract> = Contract extends { State: infer Value extends object } ? Value : Empty;
type ActionsOf<Contract> = Contract extends { Actions: infer Value extends ActionRecord }
  ? Value
  : Empty;
type ComponentsOf<Contract> = Contract extends {
  Components: infer Value extends Record<string, ComponentContract>;
}
  ? Value
  : Empty;
type RequiresOf<Contract> = Contract extends { Requires: infer Value extends object }
  ? Value
  : Empty;
type ProvidesOf<Contract> = Contract extends { Provides: infer Value extends object }
  ? Value
  : Empty;
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

export type ProgramRequires<Contract extends ProgramContract> = Readonly<RequiresOf<Contract>>;
export type ProgramProvides<Contract extends ProgramContract> = Readonly<ProvidesOf<Contract>>;

export type UIActionContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<{
  capabilities: Readonly<RequiresOf<Contract> & ProvidesOf<Contract>>;
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
> = ComponentDefinitions<ProgramOwner<Owner, ProgramName>, ProgramOwner<Owner, ProgramName>>;

type ProgramUIFields<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
> = DefinitionField<"state", Mutable<StateOf<Contract>>> &
  DefinitionField<"actions", UIActionDefinitions<Owner, ProgramName, Contract>> &
  DefinitionField<"components", UIComponentDefinitions<Owner, ProgramName>> & {
    root?: RootComponentName<ProgramOwner<Owner, ProgramName>>;
  };

export type ProgramStartContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<
  {
    capabilities: ProgramRequires<Contract>;
  } & (HasUI<Contract> extends true
    ? {
        actions: ActionAPI<Contract>;
        features: FeatureUIAPIs<Owner, ProgramName>;
      }
    : Empty)
>;

type ProgramStartResult<Contract extends ProgramContract> = keyof ProvidesOf<Contract> extends never
  ? ProgramResourceResult
  : ProvidesOf<Contract>;

type ProgramDefinition<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<
  (HasUI<Contract> extends true
    ? ProgramUIFields<Owner, ProgramName, Contract>
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

type ProgramDefinitions<Owner extends FeatureContract> = {
  readonly [Name in keyof ProgramsOf<Owner>]: ProgramDefinition<Owner, Name>;
};

export type FeatureDefinitions<Features extends Record<string, FeatureContract>> = {
  readonly [Name in keyof Features]: Feature<Extract<Features[Name], FeatureContract>>;
};

/** A reusable vertical slice that contributes to Programs and composes children. */
export type Feature<Contract extends FeatureContract> = Readonly<
  DefinitionField<"programs", ProgramDefinitions<Contract>> &
    DefinitionField<"features", FeatureDefinitions<FeaturesOf<Contract>>>
>;

export type PresentationName<Contract extends ApplicationContract> = Contract extends {
  Presentations: infer Presentations;
}
  ? Presentations extends string
    ? Presentations
    : Presentations extends Record<string, unknown>
      ? Extract<keyof Presentations, string>
      : never
  : "default";

export type ApplicationMetadata = Readonly<{ name: string }>;

type ApplicationPresentations<Contract extends ApplicationContract> = Contract extends {
  Presentations: unknown;
}
  ? {
      readonly presentations: Readonly<Record<PresentationName<Contract>, object>>;
    }
  : { readonly presentations?: never };

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
  ? Environment extends { UI: { Name: infer UIName extends string } }
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

type EnvironmentConflictIn<Owner extends FeatureContract> = string extends keyof FeaturesOf<Owner>
  ? never
  : {
      [Name in ProgramNamesIn<Owner>]: true extends IsUnion<EnvironmentIdentitiesFor<Owner, Name>>
        ? Name
        : never;
    }[ProgramNamesIn<Owner>];

type ApplicationDefinition<Contract extends ApplicationContract> = Readonly<
  {
    metadata?: ApplicationMetadata;
    features: FeatureDefinitions<FeaturesOf<Contract>>;
  } & ApplicationPresentations<Contract>
>;

/** The complete Application definition. Programs are derived from its Feature tree. */
export type Application<Contract extends ApplicationContract> = Contract extends {
  Programs: Record<string, ProgramContract>;
}
  ? never
  : [EnvironmentConflictIn<Contract>] extends [never]
    ? ApplicationDefinition<Contract>
    : never;

export type ApplicationFeatures<Contract extends ApplicationContract> = FeaturesOf<Contract>;
