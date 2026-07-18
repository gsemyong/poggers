import type { ComponentContract, ComponentDefinitions, RootComponentName } from "./ui/component";
import type { PlatformContract, PlatformDefinition, PlatformPrimitiveName } from "./ui/platform";
import type { PresentationRegistrationContract } from "./ui/presentation";

type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;
type UIKey = "State" | "Actions" | "Components";
type ProgramResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ProgramResourceResult = void | ProgramResource | PromiseLike<void | ProgramResource>;

/** A semantic execution environment implemented by a target backend. */
export type RuntimeContract = {
  readonly Name: string;
  readonly Platform?: PlatformContract;
};

export type Server = { readonly Name: "server" };

export type ProgramContract = {
  Runtime: RuntimeContract;
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

type SupportsComponents<Runtime extends RuntimeContract, Contract> = Runtime extends {
  Platform: infer Platform extends PlatformContract;
}
  ? Platform extends PlatformDefinition<Platform>
    ? [ComponentPrimitiveNames<Contract>] extends [never]
      ? true
      : Exclude<ComponentPrimitiveNames<Contract>, PlatformPrimitiveName<Platform>> extends never
        ? true
        : false
    : false
  : false;

/** Declares one product participant and the Runtime in which it executes. */
export type Program<
  Runtime extends RuntimeContract,
  Contract extends Omit<ProgramContract, "Runtime"> = Empty,
> =
  HasUI<Contract> extends true
    ? Runtime extends { Platform: PlatformContract }
      ? SupportsComponents<Runtime, Contract> extends true
        ? Readonly<Contract & { Runtime: Runtime }>
        : never
      : never
    : Readonly<Contract & { Runtime: Runtime }>;

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
type RuntimeOf<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Name extends keyof ProgramsOf<Owner>
  ? ProgramsOf<Owner>[Name] extends { Runtime: infer Runtime extends RuntimeContract }
    ? Runtime
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

type ActionSurface<Contract> = {
  readonly [Name in keyof ActionsOf<Contract>]: ActionsOf<Contract>[Name];
};

type SurfaceCollision<Contract> = Extract<keyof StateOf<Contract>, keyof ActionsOf<Contract>>;

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

export type UISurface<Owner extends FeatureContract> =
  UIOf<Owner> extends infer UI
    ? [SurfaceCollision<UI>] extends [never]
      ? Readonly<StateOf<UI>> & ActionSurface<UI>
      : never
    : Empty;

export type UIState<Owner extends FeatureContract> = Readonly<StateOf<UIOf<Owner>>>;
export type UIActions<Owner extends FeatureContract> = ActionSurface<UIOf<Owner>>;

/** Projects one named Program through a Feature tree for Components and Presentations. */
export type ProgramOwner<Owner extends FeatureContract, Name extends PropertyKey> = Readonly<
  (Name extends keyof ProgramsOf<Owner>
    ? { readonly Runtime: RuntimeOf<Owner, Name> }
    : { readonly Runtime?: never }) &
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

export type FeatureUISurfaces<
  Owner extends FeatureContract,
  ProgramName extends PropertyKey = ProgramNameWithUI<Owner>,
> = {
  readonly [Name in keyof FeaturesOf<Owner>]: UISurface<
    ProgramOwner<Extract<FeaturesOf<Owner>[Name], FeatureContract>, ProgramName>
  >;
};

export type ProgramRequires<Contract extends ProgramContract> = Readonly<RequiresOf<Contract>>;
export type ProgramProvides<Contract extends ProgramContract> = Readonly<ProvidesOf<Contract>>;

export type UIActionScope<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<{
  capabilities: Readonly<RequiresOf<Contract> & ProvidesOf<Contract>>;
  features: FeatureUISurfaces<Owner, ProgramName>;
  state: Mutable<StateOf<Contract>>;
}>;

type UIActionDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
> = {
  readonly [Name in keyof ActionsOf<Contract>]: (
    scope: UIActionScope<Owner, ProgramName, Contract>,
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

export type ProgramStartScope<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract = Extract<ProgramsOf<Owner>[ProgramName], ProgramContract>,
> = Readonly<
  {
    capabilities: ProgramRequires<Contract>;
  } & (HasUI<Contract> extends true
    ? {
        actions: ActionSurface<Contract>;
        features: FeatureUISurfaces<Owner, ProgramName>;
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
            scope: ProgramStartScope<Owner, ProgramName, Contract>,
          ) => ProgramStartResult<Contract>;
        }
      : {
          start: (
            scope: ProgramStartScope<Owner, ProgramName, Contract>,
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

export type ApplicationPwa = Readonly<{
  name: string;
  shortName?: string;
  description?: string;
  themeColor?: string;
  backgroundColor?: string;
  display?: "browser" | "fullscreen" | "minimal-ui" | "standalone";
}>;

type ApplicationPresentations<Contract extends ApplicationContract> = Contract extends {
  Presentations: unknown;
}
  ? {
      readonly presentations: Readonly<
        Record<PresentationName<Contract>, PresentationRegistrationContract>
      >;
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

type RuntimeNamesFor<
  Owner extends FeatureContract,
  Name extends PropertyKey,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | (Name extends keyof ProgramsOf<Owner>
          ? ProgramsOf<Owner>[Name] extends { Runtime: { Name: infer RuntimeName extends string } }
            ? RuntimeName
            : never
          : never)
      | {
          [FeatureName in keyof FeaturesOf<Owner>]: RuntimeNamesFor<
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

type RuntimeConflictIn<Owner extends FeatureContract> = string extends keyof FeaturesOf<Owner>
  ? never
  : {
      [Name in ProgramNamesIn<Owner>]: true extends IsUnion<RuntimeNamesFor<Owner, Name>>
        ? Name
        : never;
    }[ProgramNamesIn<Owner>];

type ApplicationDefinition<Contract extends ApplicationContract> = Readonly<
  {
    metadata?: ApplicationMetadata;
    pwa?: ApplicationPwa;
    features: FeatureDefinitions<FeaturesOf<Contract>>;
  } & ApplicationPresentations<Contract>
>;

/** The complete product definition. Programs are derived from its Feature tree. */
export type Application<Contract extends ApplicationContract> = Contract extends {
  Programs: Record<string, ProgramContract>;
}
  ? never
  : [RuntimeConflictIn<Contract>] extends [never]
    ? ApplicationDefinition<Contract>
    : never;

export type ApplicationFeatures<Contract extends ApplicationContract> = FeaturesOf<Contract>;
