import type { DependencyImplementation, DependencyImplementations } from "#kernel/dependency";
import {
  compileEndpointTable,
  collectRuntimeProgramManifest,
  composeFeaturePrograms,
  composeFeatures,
  instantiateFeatureAPIs,
  type FeatureContribution,
  type EndpointTableEntry,
  type FeatureManifest,
  type RuntimeProgramManifestEntry,
} from "#kernel/feature";
import type { RuntimeAppContract, RuntimeSchemaNode } from "#kernel/manifest";
import type {
  Child as NativeChild,
  IntrinsicElements as NativeIntrinsicElements,
} from "#ui/web/jsx-types";

export type { FeatureManifest, FeatureManifestEntry } from "#kernel/feature";
export type {
  ApplicationManifest,
  RuntimeAppContract,
  RuntimeResourceContract,
  RuntimeSchemaNode,
} from "#kernel/manifest";

export type LocalActor = { id: string };

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SessionData<Actor = unknown, Presence = unknown> = {
  readonly id: string;
  readonly actor: Actor;
  readonly presence: Presence;
};

type MigrationSpec = { Resources: Record<string, unknown> };
type MigrationResourceName<Spec extends MigrationSpec> = Extract<keyof Spec["Resources"], string>;
type MigrationResourceEvents<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = Spec["Resources"][Resource] extends { Events: infer Events extends Record<string, unknown> }
  ? Events
  : Record<string, never>;

export type Migration<From extends MigrationSpec, To extends MigrationSpec> = {
  readonly draft?: false;
  readonly from: string;
  readonly to: string;
  readonly migrate: {
    readonly [Resource in Extract<MigrationResourceName<From>, MigrationResourceName<To>>]?: {
      readonly state?: (
        state: From["Resources"][Resource] extends { State: infer State } ? State : never,
      ) => To["Resources"][Resource] extends { State: infer State } ? State : never;
      readonly event?: <
        Event extends Extract<keyof MigrationResourceEvents<From, Resource>, string>,
      >(
        name: Event,
        payload: MigrationResourceEvents<From, Resource>[Event],
      ) => {
        [Name in Extract<keyof MigrationResourceEvents<To, Resource>, string>]: {
          readonly name: Name;
          readonly payload: MigrationResourceEvents<To, Resource>[Name];
        };
      }[Extract<keyof MigrationResourceEvents<To, Resource>, string>];
    };
  };
};

export type ComponentSpec = {
  Input?: Record<string, unknown>;
  Context?: Record<string, unknown>;
  State?: Record<string, unknown>;
  Phases?: string;
  Output?: unknown;
  Actions?: Record<string, (...args: never[]) => unknown>;
  Parameters?: Record<string, unknown>;
  Tasks?: Record<
    string,
    {
      Input: unknown;
      Output: unknown;
      Error: unknown;
    }
  >;
  Slots?: Record<string, unknown>;
  Parts: Record<string, string>;
};

export type FeatureSpec = {
  Resources?: Record<string, unknown>;
  Components?: Record<string, ComponentSpec>;
  Features?: Record<string, FeatureSpec>;
  Dependencies?: Record<string, Record<string, unknown>>;
  Programs?: Record<string, Record<string, ProgramSpec>>;
  Navigation?: Record<string, Record<string, unknown>>;
  Endpoints?: Record<string, EndpointSpec>;
  Migrations?: Record<string, unknown>;
  API?: Record<string, unknown>;
  Authentication?: unknown;
};

export type ProgramSpec = {
  Events?: readonly [string, ...string[]];
  Key?: JsonValue;
  KeyVersion?: number;
  Replay?: "all" | "new";
  Version?: number;
};

export type EndpointSpec = {
  readonly Method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
};

export type EndpointContext<App extends AppSpec, Deps = RootServerDependencies<App>> = {
  readonly actor: ActorOf<App> | null;
  readonly signal: AbortSignal;
  readonly dependencies: Readonly<Deps>;
};

export type EndpointDef<
  App extends AppSpec,
  Endpoint extends EndpointSpec,
  Deps = RootServerDependencies<App>,
> = {
  readonly method: Endpoint["Method"];
  readonly path: `/${string}`;
  readonly handle: (
    request: Request,
    context: EndpointContext<App, Deps>,
  ) => Response | Promise<Response>;
};

export type AppSpec = FeatureSpec & {
  Actor?: { id: string };
  Resources: Record<string, unknown>;
  Styles?: {
    Presets?: string | Record<string, unknown>;
  };
};

type AppStylesOf<Spec extends AppSpec> = Spec extends {
  Styles: infer Styles extends Record<string, unknown>;
}
  ? Styles
  : Record<never, never>;

type AppPresetsOf<Spec extends AppSpec> =
  AppStylesOf<Spec> extends {
    Presets: infer Presets;
  }
    ? Presets
    : "default";

export type PresetName<Spec extends AppSpec> =
  AppPresetsOf<Spec> extends string
    ? AppPresetsOf<Spec>
    : AppPresetsOf<Spec> extends Record<string, unknown>
      ? Extract<keyof AppPresetsOf<Spec>, string>
      : "default";

type DeclaredThemeName<Spec extends AppSpec, Name extends PresetName<Spec>> =
  AppPresetsOf<Spec> extends Record<string, unknown>
    ? Name extends keyof AppPresetsOf<Spec>
      ? AppPresetsOf<Spec>[Name] extends { Themes: infer Themes extends string }
        ? Themes
        : never
      : never
    : never;

export type PresetThemeName<
  Spec extends AppSpec,
  Name extends PresetName<Spec> = PresetName<Spec>,
> =
  Name extends PresetName<Spec>
    ? AppPresetsOf<Spec> extends string
      ? string
      : "default" | DeclaredThemeName<Spec, Name>
    : never;

export type PresetAppearance<Spec extends AppSpec> = {
  readonly [Name in PresetName<Spec>]: {
    readonly preset: Name;
    readonly theme: PresetThemeName<Spec, Name>;
  };
}[PresetName<Spec>];

export type ActorOf<Spec extends AppSpec> = Spec extends { Actor: infer A extends { id: string } }
  ? A
  : LocalActor;

export type ResourceSpec = {
  Policy?: ResourcePolicy;
  Key: JsonValue;
  State: unknown;
  Presence?: JsonValue;
  Events: Record<string, unknown>;
  Views: Record<string, unknown>;
  Commands: Record<string, unknown>;
};

export type ResourcePolicy = "sync" | "device" | "memory";

export type ResourcePolicyFor<Resource extends ResourceSpec> = Resource extends {
  Policy: infer Policy extends ResourcePolicy;
}
  ? Policy
  : "sync";

export type CommandSpec = {
  Input: Record<string, unknown>;
  Event?: string;
  Error?: string | [string, unknown];
};

type InputFor<C> = C extends { Input: infer Input extends Record<string, unknown> } ? Input : never;

type EventNameFor<C> = C extends { Event: infer Event } ? Event : never;

type ErrorFor<C> = C extends { Error: infer Error } ? Error : never;

export type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

export type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type OwnEnvironmentName<Feature> =
  | (Feature extends { Dependencies: infer Dependencies }
      ? Extract<keyof Dependencies, string>
      : never)
  | (Feature extends { Programs: infer Programs }
      ? Programs extends Record<string, unknown>
        ? Extract<keyof Programs, string>
        : never
      : never);

type NestedEnvironmentName<Feature> = Feature extends {
  Features: infer Features extends Record<string, unknown>;
}
  ? {
      [Name in keyof Features]:
        | OwnEnvironmentName<Features[Name]>
        | NestedEnvironmentName<Features[Name]>;
    }[keyof Features]
  : never;

export type EnvironmentName<Spec extends AppSpec> =
  | OwnEnvironmentName<Spec>
  | NestedEnvironmentName<Spec>;

export type EnvironmentDeps<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = Spec extends { Dependencies: infer Dependencies }
  ? Env extends keyof Dependencies
    ? Dependencies[Env]
    : Record<never, never>
  : Record<never, never>;

export type RootServerDependencies<Spec extends AppSpec> = Spec extends {
  Dependencies: infer Dependencies;
}
  ? "server" extends keyof Dependencies
    ? Dependencies["server"]
    : Record<never, never>
  : Record<never, never>;

export type ActorCredential = { readonly headers: Headers };

export type ActorResolver<Actor extends { id: string }> = {
  readonly resolve: (credential: ActorCredential) => Promise<{ readonly actor: Actor } | null>;
};

export type AuthenticationDef<Spec extends AppSpec> = DependencyImplementation<
  ActorResolver<ActorOf<Spec>>
>;

export type NavigationName<Spec extends AppSpec> = Spec extends {
  Navigation: infer Navigation;
}
  ? Extract<keyof Navigation, string>
  : "home";

export type NavigationParams<
  Spec extends AppSpec,
  Screen extends NavigationName<Spec>,
> = Spec extends { Navigation: infer Navigation }
  ? Screen extends keyof Navigation
    ? Navigation[Screen] extends Record<string, unknown>
      ? Navigation[Screen]
      : Record<string, never>
    : Record<string, never>
  : Record<string, never>;

export type AppScreen<Spec extends AppSpec> = {
  [Screen in NavigationName<Spec>]: {
    readonly name: Screen;
    readonly params: NavigationParams<Spec, Screen>;
  };
}[NavigationName<Spec>];

export type AppNavigation<Spec extends AppSpec> = {
  [Screen in NavigationName<Spec>]: keyof NavigationParams<Spec, Screen> extends never
    ? (params?: NavigationParams<Spec, Screen>) => void
    : (params: NavigationParams<Spec, Screen>) => void;
};

export type NavigationDef<Spec extends AppSpec> = {
  [Screen in NavigationName<Spec>]: string;
};

export type UISignal<T> = {
  (): T;
  (value: T): void;
};

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};

type CommandShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: (
    input: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? InputFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never,
  ) => Submission<
    ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ErrorFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never
  >;
};

type PresenceShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> =
  ResourceFor<Spec, Resource> extends { Presence: infer Presence }
    ? { setPresence(value: Presence): void }
    : {};

type ProgramCommandShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: CommandShape<
    Spec,
    Resource
  >[Command] & {
    identified(
      id: string,
      input: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
        ? InputFor<ResourceFor<Spec, Resource>["Commands"][Command]>
        : never,
    ): Submission<
      ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
        ? ErrorFor<ResourceFor<Spec, Resource>["Commands"][Command]>
        : never
    >;
  };
};

type HookName<Name extends string> = `use${Capitalize<Name>}`;

type UIResourceViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  readonly [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<
    Spec,
    Resource
  >["Views"][View];
};

export type UIResource<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = UIResourceViewShape<Spec, Resource> &
  CommandShape<Spec, Resource> & {
    readonly sync: SyncMeta;
  } & PresenceShape<Spec, Resource>;

export type SemanticUIHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => UIResource<Spec, Resource>;
} & {
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => UIResource<Spec, Resource>;
};

export type AppMetadata = {
  name?: string;
};

export type PwaIconDef =
  | string
  | {
      src: string;
      sizes?: string;
      type?: string;
      purpose?: string;
    };

export type PwaDef = {
  name: string;
  shortName?: string;
  description?: string;
  themeColor: string;
  backgroundColor: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation?: string;
  startUrl?: string;
  scope?: string;
  icons?: {
    any?: PwaIconDef | PwaIconDef[];
    maskable?: PwaIconDef | PwaIconDef[];
  };
};

export type ProgramResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  ProgramCommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
    readonly sync: SyncMeta;
    subscribe(observer: (view: ViewShape<Spec, Resource>) => void): () => void;
  } & PresenceShape<Spec, Resource>;

export type ProgramResourceName<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  [Resource in ResourceName<Spec>]: Env extends "server"
    ? ResourcePolicyFor<ResourceFor<Spec, Resource>> extends "sync"
      ? Resource
      : never
    : Resource;
}[ResourceName<Spec>];

export type ProgramResources<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  readonly [Resource in ProgramResourceName<Spec, Env>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ProgramResource<Spec, Resource>;
};

export type AppEventName<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec>]: {
    [Event in keyof ResourceFor<Spec, Resource>["Events"] & string]: `${Resource}.${Event}`;
  }[keyof ResourceFor<Spec, Resource>["Events"] & string];
}[ResourceName<Spec>];

export type ResourceFromEventName<
  Spec extends AppSpec,
  Name extends AppEventName<Spec>,
> = Name extends `${infer Resource}.${string}` ? Resource & ResourceName<Spec> : never;

export type EventFromEventName<
  Spec extends AppSpec,
  Name extends AppEventName<Spec>,
> = Name extends `${ResourceFromEventName<Spec, Name>}.${infer Event}`
  ? Event & keyof ResourceFor<Spec, ResourceFromEventName<Spec, Name>>["Events"] & string
  : never;

export type ProgramEvent<Spec extends AppSpec, Name extends AppEventName<Spec>> = {
  readonly id: string;
  readonly seq: number;
  readonly at: number;
  readonly version: number;
  readonly actor: ActorOf<Spec>;
  readonly resource: ResourceFromEventName<Spec, Name>;
  readonly key: ResourceFor<Spec, ResourceFromEventName<Spec, Name>>["Key"];
  readonly name: EventFromEventName<Spec, Name>;
  readonly payload: ResourceFor<
    Spec,
    ResourceFromEventName<Spec, Name>
  >["Events"][EventFromEventName<Spec, Name>];
};

type ProgramEventItemForName<
  Spec extends AppSpec,
  Name extends AppEventName<Spec>,
  Resource extends ResourceFromEventName<Spec, Name> = ResourceFromEventName<Spec, Name>,
> = {
  readonly event: ProgramEvent<Spec, Name>;
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly view: ViewShape<Spec, Resource>;
  readonly delivery: {
    readonly attempt: number;
    readonly uncertainAttempts: readonly number[];
  };
  /** Stable across retries of this Program delivery. */
  readonly createIdempotencyKey: (label: string) => string;
} & {
  readonly [Current in Resource]: ProgramResource<Spec, Current>;
};

export type ProgramEventItem<Spec extends AppSpec, Name extends AppEventName<Spec>> =
  Name extends AppEventName<Spec> ? ProgramEventItemForName<Spec, Name> : never;

type InternalProgramSubscription = Readonly<{
  close(): void;
}>;

type ProgramPartition<Spec extends AppSpec, Name extends AppEventName<Spec>> =
  | Readonly<{
      partitionBy?: undefined;
      partitionRevision?: never;
    }>
  | Readonly<{
      partitionBy: (input: { readonly event: ProgramEvent<Spec, Name> }) => JsonValue;
      partitionRevision: number;
    }>;

type InternalProgramConsume<Spec extends AppSpec> = <
  const Names extends readonly [AppEventName<Spec>, ...AppEventName<Spec>[]],
>(
  options: {
    readonly id: string;
    readonly events: Names;
    readonly startAt: "origin" | "now";
    readonly version?: number;
    signal?: AbortSignal;
    concurrency?: number;
    run: (item: ProgramEventItem<Spec, Names[number]>) => void | Promise<void>;
  } & ProgramPartition<Spec, Names[number]>,
) => Promise<InternalProgramSubscription>;

export type ProgramContext<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  readonly api: ProgramApplicationAPI<Spec>;
  readonly resources: Readonly<ProgramResources<Spec, Env>>;
  readonly actor: Readonly<ActorOf<Spec>>;
  readonly signal: AbortSignal;
};

export type InternalProgramContext<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = ProgramContext<Spec, Env> & {
  readonly consume: InternalProgramConsume<Spec>;
};

export type ProgramCleanup = () => void | Promise<void>;
export type ProgramResult = void | ProgramCleanup | Promise<void | ProgramCleanup>;

type ProgramsOf<Spec extends AppSpec> = Spec extends {
  Programs: infer Programs extends Record<string, Record<string, ProgramSpec>>;
}
  ? Programs
  : {};

type ProgramSpecFor<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
  Name extends PropertyKey,
> = Env extends keyof ProgramsOf<Spec>
  ? Name extends keyof ProgramsOf<Spec>[Env]
    ? ProgramsOf<Spec>[Env][Name]
    : never
  : never;

type ProgramEvents<Spec extends AppSpec, Program extends ProgramSpec> = Program extends {
  Events: infer Events extends readonly [string, ...string[]];
}
  ? Events extends readonly [AppEventName<Spec>, ...AppEventName<Spec>[]]
    ? Events
    : never
  : never;

type PositiveInteger<Value extends number> = `${Value}` extends
  | "0"
  | `-${string}`
  | `${string}.${string}`
  ? never
  : Value;

type ProgramSource<Spec extends AppSpec, Program extends ProgramSpec> = Readonly<{
  events: ProgramEvents<Spec, Program>;
  replay: Program extends { Replay: infer Replay extends "all" | "new" } ? Replay : "all";
  version: Program extends { Version: infer Version extends number } ? PositiveInteger<Version> : 1;
}> &
  (Program extends { Key: infer Key extends JsonValue }
    ? Readonly<{
        keyBy: (input: {
          readonly event: ProgramEvent<Spec, ProgramEvents<Spec, Program>[number]>;
        }) => Key;
        keyVersion: Program extends { KeyVersion: infer Version extends number }
          ? PositiveInteger<Version>
          : never;
      }>
    : Readonly<{ keyBy: "resource"; keyVersion?: never }>);

export type EventProgramDefinition<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
  Program extends ProgramSpec,
> = Readonly<{
  source: ProgramSource<Spec, Program>;
  handle: (
    context: ProgramContext<Spec, Env> &
      ProgramEventItem<Spec, ProgramEvents<Spec, Program>[number]>,
    deps: EnvironmentDeps<Spec, Env>,
  ) => void | Promise<void>;
}>;

export type ServiceProgramDefinition<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = (
  ctx: ProgramContext<Spec, Env>,
  deps: EnvironmentDeps<Spec, Env>,
) => ProgramResult;

type ProgramDefinition<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
  Program extends ProgramSpec,
> = Program extends { Events: readonly [string, ...string[]] }
  ? EventProgramDefinition<Spec, Env, Program>
  : ServiceProgramDefinition<Spec, Env>;

export type AppPrograms<Spec extends AppSpec> = {
  readonly [Env in Extract<keyof ProgramsOf<Spec>, EnvironmentName<Spec>>]: {
    readonly [Name in keyof ProgramsOf<Spec>[Env]]: ProgramDefinition<
      Spec,
      Env,
      ProgramSpecFor<Spec, Env, Name>
    >;
  };
};

export type AppProgramRunners<Spec extends AppSpec> = {
  readonly [Env in EnvironmentName<Spec>]?: (
    ctx: InternalProgramContext<Spec, Env>,
    deps: EnvironmentDeps<Spec, Env>,
  ) => ProgramResult;
};

export type FeatureChildrenOf<Feature extends FeatureSpec> = Feature extends {
  Features: infer Children extends Record<string, FeatureSpec>;
}
  ? Children
  : {};

type AsFeature<Value> = Value extends FeatureSpec ? Value : never;

type FeatureResources<Feature extends FeatureSpec> = Feature extends {
  Resources: infer Resources extends Record<string, unknown>;
}
  ? Resources
  : {};

type FeatureComponents<Feature extends FeatureSpec> = Feature extends {
  Components: infer Components extends Record<string, ComponentSpec>;
}
  ? Components
  : {};

type FeatureEnvironments<Feature extends FeatureSpec> = Feature extends {
  Dependencies: infer Environments extends Record<string, Record<string, unknown>>;
}
  ? Environments
  : {};

type FeatureEnvironmentDeps<
  Feature extends FeatureSpec,
  Environment extends keyof FeatureEnvironments<Feature>,
> = FeatureEnvironments<Feature>[Environment];

type FeatureServerDeps<Feature extends FeatureSpec> =
  "server" extends keyof FeatureEnvironments<Feature>
    ? FeatureEnvironmentDeps<Feature, "server">
    : Record<string, never>;

export type FeatureBrowserDependencies<Feature extends FeatureSpec> =
  "browser" extends keyof FeatureEnvironments<Feature>
    ? FeatureEnvironmentDeps<Feature, "browser">
    : Record<string, never>;

type FeatureDependencyDefinitions<Feature extends FeatureSpec> =
  keyof FeatureEnvironments<Feature> extends never
    ? { readonly dependencies?: never }
    : {
        readonly dependencies: {
          readonly [Environment in keyof FeatureEnvironments<Feature>]: DependencyImplementations<
            FeatureEnvironmentDeps<Feature, Environment>
          >;
        };
      };

type FeatureNavigation<Feature extends FeatureSpec> = Feature extends {
  Navigation: infer Navigation extends Record<string, Record<string, unknown>>;
}
  ? Navigation
  : {};

type CompatibleNavigationName<App extends AppSpec, Params extends Record<string, unknown>> = {
  [Screen in NavigationName<App>]: [NavigationParams<App, Screen>] extends [Params]
    ? [Params] extends [NavigationParams<App, Screen>]
      ? Screen
      : never
    : never;
}[NavigationName<App>];

type FeatureAuthentication<Feature extends FeatureSpec> = Feature extends {
  Authentication: infer Authentication;
}
  ? { readonly authentication: DependencyImplementation<Authentication> }
  : { readonly authentication?: never };

type FeatureEndpointDependencies<Feature extends FeatureSpec> = FeatureServerDeps<Feature> &
  (Feature extends { Authentication: infer Authentication }
    ? { readonly authentication: Authentication }
    : Record<never, never>);

type ComponentScreen<Spec extends AppSpec> = Spec extends { FeatureRuntime: true }
  ? AppScreen<Spec> | null
  : AppScreen<Spec>;

export type FeatureAtPath<
  Feature extends FeatureSpec,
  Path extends string,
> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof FeatureChildrenOf<Feature>
    ? FeatureAtPath<AsFeature<FeatureChildrenOf<Feature>[Head]>, Tail>
    : never
  : Path extends keyof FeatureChildrenOf<Feature>
    ? FeatureChildrenOf<Feature>[Path]
    : never;

type ComponentsOf<Spec extends AppSpec> = Spec extends {
  Components: infer Components extends Record<string, unknown>;
}
  ? Components
  : Record<never, never>;

export type ComponentName<Spec extends AppSpec> = Extract<keyof ComponentsOf<Spec>, string>;

export type ComponentFor<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentsOf<Spec>[Component] extends {
  Parts: Record<string, string>;
}
  ? ComponentsOf<Spec>[Component]
  : never;

export type ComponentInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Input: infer Input extends Record<string, unknown>;
  }
    ? Input
    : Record<never, never>;

type ComponentStateContract<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    State: infer State extends Record<string, unknown>;
  }
    ? State
    : Record<never, never>;

export type ComponentContext<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Context: infer Context extends Record<string, unknown>;
  }
    ? Context
    : Record<never, never>;

export type ComponentValueKind =
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "angle"
  | "time"
  | "zIndex"
  | "length"
  | "space"
  | "size"
  | "radius";

export type VisualValue<Kind extends ComponentValueKind> = {
  readonly "poggers.visualValue": Kind;
};

export type Writable<Value> = {
  readonly "poggers.writable": Value;
};

type ComponentStateSource<Value> = Value extends Writable<infer Source> ? Source : Value;

type ComponentStateFor<Value> =
  ComponentStateSource<Value> extends VisualValue<infer Kind>
    ? Kind extends ComponentValueKind
      ? number
      : never
    : ComponentStateSource<Value>;

type ComponentWritableStateName<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentStateContract<Spec, Component>]-?: ComponentStateContract<
    Spec,
    Component
  >[Value] extends Writable<unknown>
    ? Value
    : never;
}[keyof ComponentStateContract<Spec, Component>];

export type ComponentWritableState<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Pick<ComponentState<Spec, Component>, ComponentWritableStateName<Spec, Component>>;

export type ComponentState<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Value in keyof ComponentStateContract<Spec, Component>]: ComponentStateFor<
    ComponentStateContract<Spec, Component>[Value]
  >;
};

export type ComponentVisualState<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentStateContract<Spec, Component> as ComponentStateContract<
    Spec,
    Component
  >[Value] extends VisualValue<ComponentValueKind> | Writable<VisualValue<ComponentValueKind>>
    ? Value
    : never]: ComponentStateFor<ComponentStateContract<Spec, Component>[Value]>;
};

export type ComponentStateKinds<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentStateContract<Spec, Component> as ComponentStateContract<
    Spec,
    Component
  >[Value] extends VisualValue<ComponentValueKind> | Writable<VisualValue<ComponentValueKind>>
    ? Value
    : never]: ComponentStateSource<
    ComponentStateContract<Spec, Component>[Value]
  > extends VisualValue<infer Kind>
    ? Kind
    : never;
};

export type ComponentSlots<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Slots: infer Slots extends Record<string, unknown>;
  }
    ? Slots
    : Record<never, never>;

type ExplicitComponentActions<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Actions: infer Actions extends Record<string, (...args: never[]) => unknown>;
  }
    ? Actions
    : Record<never, never>;

export type ComponentPhasePath<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends { Phases: infer Phases extends string } ? Phases : "active";

type ComponentStateSegment<Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head | ComponentStateSegment<Tail>
  : Path;

type ComponentPhaseValueMap<Path extends string> = {
  readonly [region: string]: ComponentPhaseValue<Path>;
};

export type ComponentPhaseValue<Path extends string> =
  | ComponentStateSegment<Path>
  | ComponentPhaseValueMap<Path>;

export type ComponentOutput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends { Output: infer Output } ? Output : void;

export type ComponentTasks<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Tasks: infer Tasks extends Record<string, { Input: unknown; Output: unknown; Error: unknown }>;
  }
    ? Tasks
    : Record<never, never>;

export type ComponentTaskName<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Extract<keyof ComponentTasks<Spec, Component>, string>;

export type ComponentActions<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ExplicitComponentActions<Spec, Component>;

export type ComponentParameters<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Parameters: infer Parameters extends Record<string, unknown>;
  }
    ? Parameters
    : Record<never, never>;

export type ComponentParts<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Parts: infer Parts extends Record<string, string>;
  }
    ? Parts
    : Record<never, never>;

export type ComponentPartName<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Extract<keyof ComponentParts<Spec, Component>, string>;

export type ComponentPartElement<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentParts<Spec, Component>[Part] & string;

export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => unknown
  ? Args
  : [];

export type ComponentTransitionScope<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly state: Readonly<ComponentState<Spec, Component>>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly parameters: Readonly<ComponentParameters<Spec, Component>>;
};

type ComponentTaskContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly state: Readonly<ComponentState<Spec, Component>>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly dependencies: Readonly<FeatureBrowserDependencies<Spec>>;
  readonly api: Readonly<FeatureAPIOf<Spec>>;
  readonly appearance: PresetAppearance<Spec>;
  readonly setAppearance: (appearance: PresetAppearance<Spec>) => void;
  readonly navigation: AppNavigation<Spec>;
};

export type ComponentContextUpdate<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> = (
  scope: ComponentTransitionScope<Spec, Component>,
  ...args: Args
) => Partial<ComponentContext<Spec, Component>> | void;

type ComponentSettlementInvocation<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly phase: "enter" | "exit";
  readonly done?: ComponentPhasePath<Spec, Component>;
  readonly cancelled?: ComponentPhasePath<Spec, Component>;
};

type ComponentTransitionConfig<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> = {
  readonly target?:
    | ComponentPhasePath<Spec, Component>
    | readonly ComponentPhasePath<Spec, Component>[];
  readonly allow?: (scope: ComponentTransitionScope<Spec, Component>, ...args: Args) => boolean;
  readonly update?: ComponentContextUpdate<Spec, Component, Args>;
  readonly reenter?: boolean;
};

export type ComponentTransition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> = ComponentPhasePath<Spec, Component> | ComponentTransitionConfig<Spec, Component, Args>;

export type ComponentTransitions<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> =
  | ComponentTransition<Spec, Component, Args>
  | readonly ComponentTransition<Spec, Component, Args>[];

type ComponentActionTransitions<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Action in keyof ComponentActions<Spec, Component>]?: ComponentTransitions<
    Spec,
    Component,
    ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  >;
};

type ComponentTaskFor<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = ComponentTasks<Spec, Component>[Task];

export type ComponentTaskInput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = ComponentTaskFor<Spec, Component, Task> extends { Input: infer Input } ? Input : never;

export type ComponentTaskOutput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = ComponentTaskFor<Spec, Component, Task> extends { Output: infer Output } ? Output : never;

export type ComponentTaskError<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = ComponentTaskFor<Spec, Component, Task> extends { Error: infer Error } ? Error : never;

type ComponentOutcomeTransition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Value,
> = ComponentTransitions<Spec, Component, readonly [value: Value]>;

export type ComponentTaskInvocation<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Task in ComponentTaskName<Spec, Component>]: {
    readonly run: Task;
    readonly input: (
      scope: ComponentTransitionScope<Spec, Component>,
    ) => ComponentTaskInput<Spec, Component, Task>;
    readonly done?: ComponentOutcomeTransition<
      Spec,
      Component,
      ComponentTaskOutput<Spec, Component, Task>
    >;
    readonly fail?: ComponentOutcomeTransition<
      Spec,
      Component,
      ComponentTaskError<Spec, Component, Task>
    >;
  };
}[ComponentTaskName<Spec, Component>];

export type ComponentDelayedTransition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentTransitionConfig<Spec, Component> & {
  readonly wait: number | ((scope: ComponentTransitionScope<Spec, Component>) => number);
};

export type ComponentStateNode<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly type?: "atomic" | "compound" | "parallel" | "final";
  readonly initial?: ComponentPhasePath<Spec, Component>;
  readonly phases?: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
  readonly on?: ComponentActionTransitions<Spec, Component>;
  readonly always?: ComponentTransitions<Spec, Component>;
  readonly after?:
    | ComponentDelayedTransition<Spec, Component>
    | readonly ComponentDelayedTransition<Spec, Component>[];
  readonly task?:
    | ComponentTaskInvocation<Spec, Component>
    | readonly ComponentTaskInvocation<Spec, Component>[];
  readonly settle?: ComponentSettlementInvocation<Spec, Component>;
  readonly done?: ComponentTransitions<
    Spec,
    Component,
    readonly [value: ComponentOutput<Spec, Component>]
  >;
  readonly output?:
    | ComponentOutput<Spec, Component>
    | ((scope: ComponentTransitionScope<Spec, Component>) => ComponentOutput<Spec, Component>);
};

export type ComponentStatechart<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentStateNode<Spec, Component> & {
  readonly phases: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
};

type ComponentPhaseView<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly value: ComponentPhaseValue<ComponentPhasePath<Spec, Component>>;
  readonly active: readonly ComponentPhasePath<Spec, Component>[];
  readonly done: boolean;
  readonly output: ComponentOutput<Spec, Component> | undefined;
  readonly error: unknown;
};

export type ComponentTaskScope<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = ComponentTaskContext<Spec, Component> & {
  readonly value: ComponentTaskInput<Spec, Component, Task>;
  readonly signal: AbortSignal;
};

type ComponentTaskDefinitions<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  ComponentTaskName<Spec, Component>,
] extends [never]
  ? { tasks?: never }
  : {
      tasks: {
        readonly [Task in ComponentTaskName<Spec, Component>]: (
          scope: ComponentTaskScope<Spec, Component, Task>,
        ) =>
          | ComponentTaskOutput<Spec, Component, Task>
          | Promise<ComponentTaskOutput<Spec, Component, Task>>
          | ComponentTaskSubmission<Spec, Component, Task>;
      };
    };

type ComponentTaskSubmission<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> = [ComponentTaskOutput<Spec, Component, Task>] extends [SubmissionSuccess]
  ? ComponentTaskError<Spec, Component, Task> extends SubmissionFailure<infer Error>
    ? Submission<Error>
    : never
  : never;

type ComponentRenderChild = NativeChild;

type ComponentNativeProps<ElementName extends string> =
  ElementName extends keyof NativeIntrinsicElements
    ? Omit<NativeIntrinsicElements[ElementName], "class" | "className" | "style">
    : Record<string, unknown>;

type ComponentPartBindingForElement<ElementName extends string> = ComponentNativeProps<ElementName>;

export type ComponentPartBinding<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentPartBindingForElement<ComponentPartElement<Spec, Component, Part>>;

type HasNoKeys<Value extends Record<string, unknown>> = keyof Value extends never ? true : false;

export type ComponentInstanceInput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentInput<Spec, Component>;

type ComponentInstanceNeedsInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentInput<Spec, Component>> extends true ? false : true;

type RequiredKeys<Value extends Record<string, unknown>> = {
  [Key in keyof Value]-?: Record<string, never> extends Pick<Value, Key> ? never : Key;
}[keyof Value];

export type ComponentProps<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentInstanceInput<Spec, Component> & ComponentSlots<Spec, Component>;

type ComponentRenderer<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  RequiredKeys<ComponentProps<Spec, Component>>,
] extends [never]
  ? (props?: ComponentProps<Spec, Component>) => ComponentRenderChild
  : (props: ComponentProps<Spec, Component>) => ComponentRenderChild;

export type ComponentRenderers<Spec extends AppSpec> = {
  readonly [Component in ComponentName<Spec>]: ComponentInstanceNeedsInput<
    Spec,
    Component
  > extends true
    ? ComponentRenderer<Spec, Component>
    : ComponentRenderer<Spec, Component>;
};

type FeatureComponentNode<App extends AppSpec, Feature extends FeatureSpec> = ComponentRenderers<
  FeatureRuntimeSpec<App, Feature>
> &
  FeatureComponentTreeFor<App, Feature>;

type FeatureComponentTreeFor<App extends AppSpec, Feature extends FeatureSpec> = {
  readonly [Name in keyof FeatureChildrenOf<Feature>]: FeatureComponentNode<
    App,
    AsFeature<FeatureChildrenOf<Feature>[Name]>
  >;
};

export type FeatureComponentTree<Spec extends AppSpec> = Spec extends {
  FeatureRuntime: true;
  App: infer App extends AppSpec;
}
  ? FeatureComponentTreeFor<App, Spec>
  : FeatureComponentTreeFor<Spec, Spec>;

type ComponentPartNativeElement<ElementName extends string> =
  ElementName extends keyof HTMLElementTagNameMap
    ? HTMLElementTagNameMap[ElementName]
    : ElementName extends keyof SVGElementTagNameMap
      ? SVGElementTagNameMap[ElementName]
      : Element;

export type ComponentPart<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = {
  (props?: ComponentPartBinding<Spec, Component, Part>): ComponentRenderChild;
  readonly element: ComponentPartNativeElement<ComponentPartElement<Spec, Component, Part>> | null;
  readonly elements: readonly ComponentPartNativeElement<
    ComponentPartElement<Spec, Component, Part>
  >[];
};

export type ComponentRenderScope<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly state: Readonly<ComponentState<Spec, Component>>;
  readonly actions: ComponentActionHandlers<Spec, Component>;
  readonly slots: ComponentSlots<Spec, Component>;
  readonly components: ComponentRenderers<Spec>;
  readonly features: FeatureComponentTree<Spec>;
  readonly parts: {
    readonly [Part in ComponentPartName<Spec, Component>]: ComponentPart<Spec, Component, Part>;
  };
};

export type ComponentRender<Spec extends AppSpec, Component extends ComponentName<Spec>> = (
  scope: ComponentRenderScope<Spec, Component>,
) => ComponentRenderChild;

export type ComponentActionHandlers<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
};

export type ComponentStateScope<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly phase: ComponentPhaseView<Spec, Component>["value"];
  readonly active: readonly ComponentPhasePath<Spec, Component>[];
  readonly parameters: Readonly<ComponentParameters<Spec, Component>>;
  readonly api: Readonly<FeatureAPIOf<Spec>>;
  readonly appearance: PresetAppearance<Spec>;
  readonly screen: ComponentScreen<Spec>;
};

type ComponentStateDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentState<Spec, Component>> extends true
    ? { state?: never }
    : {
        state: (scope: ComponentStateScope<Spec, Component>) => ComponentState<Spec, Component>;
      };

type ComponentContextDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentContext<Spec, Component>> extends true
    ? { context?: never }
    : { context: ComponentContext<Spec, Component> };

export type ComponentStatechartDefinition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> =
  ComponentFor<Spec, Component> extends { Phases: string }
    ? ComponentContextDefinition<Spec, Component> &
        ComponentTaskDefinitions<Spec, Component> & {
          initial: ComponentPhasePath<Spec, Component>;
          on?: ComponentActionTransitions<Spec, Component>;
          phases: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
        }
    : keyof ComponentActions<Spec, Component> extends never
      ? {
          context?: never;
          initial?: never;
          on?: never;
          phases?: never;
          tasks?: never;
        }
      : ComponentContextDefinition<Spec, Component> & {
          initial?: never;
          on: ComponentActionTransitions<Spec, Component>;
          phases?: never;
          tasks?: never;
        };

export type ComponentDefinition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentStateDefinition<Spec, Component> &
  (ComponentFor<Spec, Component> extends { Phases: string }
    ? { machine: ComponentStatechartDefinition<Spec, Component> }
    : keyof ComponentActions<Spec, Component> extends never
      ? HasNoKeys<ComponentContext<Spec, Component>> extends true
        ? { machine?: never }
        : { machine: ComponentStatechartDefinition<Spec, Component> }
      : { machine: ComponentStatechartDefinition<Spec, Component> }) & {
    view: ComponentRender<Spec, Component>;
  };

export type ComponentDefinitions<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]: ComponentDefinition<Spec, Component>;
};

export type RootComponentName<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]: ComponentInstanceNeedsInput<Spec, Component> extends false
    ? Component
    : never;
}[ComponentName<Spec>];

export type ResourceDef<Spec extends AppSpec, R extends ResourceSpec> = {
  policy?: ResourcePolicyFor<R>;
  state: R["State"];
  presence?: R["Presence"];
  authorize?: (args: {
    readonly state: Readonly<R["State"]>;
    readonly actor: ActorOf<Spec>;
    readonly key: R["Key"];
    readonly operation:
      | Readonly<{ type: "read"; origin: "client" | "program" }>
      | Readonly<{
          type: "command";
          name: Extract<keyof R["Commands"], string>;
          origin: "client" | "program";
        }>;
  }) => boolean;
  events: {
    [K in keyof R["Events"]]: (args: {
      state: R["State"];
      payload: R["Events"][K];
      actor: ActorOf<Spec>;
      at: number;
      seq: number;
    }) => void;
  };
  views?: {
    [K in keyof R["Views"]]: (args: {
      state: R["State"];
      actor: ActorOf<Spec> | null;
      sessions: SessionData<ActorOf<Spec>, R["Presence"]>[];
      key: R["Key"];
    }) => R["Views"][K];
  };
  commands?: {
    [K in keyof R["Commands"]]: (
      ctx: CommandCtx<Spec, R, R["Commands"][K] extends CommandSpec ? R["Commands"][K] : never>,
      input: R["Commands"][K] extends CommandSpec ? InputFor<R["Commands"][K]> : never,
    ) => void;
  };
};

export type FeatureRuntimeSpec<App extends AppSpec, Feature extends FeatureSpec> = {
  FeatureRuntime: true;
  App: App;
  Actor: ActorOf<App>;
  Resources: FeatureResources<Feature>;
  Components: FeatureComponents<Feature>;
  Features: FeatureChildrenOf<Feature>;
  Dependencies: FeatureEnvironments<Feature>;
  Programs: Feature extends { Programs: infer Programs } ? Programs : {};
  API: FeatureAPIOf<Feature>;
  Navigation: FeatureNavigation<Feature>;
  Styles: App extends { Styles: infer Styles extends AppSpec["Styles"] } ? Styles : {};
};

export type FeatureAPIOf<Feature extends FeatureSpec> = Feature extends {
  API: infer API extends Record<string, unknown>;
}
  ? API
  : {};

export type ComposedFeatureAPIOf<Feature extends FeatureSpec, Seen extends FeatureSpec = never> = [
  Feature,
] extends [Seen]
  ? Readonly<FeatureAPIOf<Feature>>
  : Readonly<
      FeatureAPIOf<Feature> & {
        readonly [Name in keyof FeatureChildrenOf<Feature>]: ComposedFeatureAPIOf<
          AsFeature<FeatureChildrenOf<Feature>[Name]>,
          Seen | Feature
        >;
      }
    >;

type ProgramApplicationAPI<Spec extends AppSpec> = Spec extends {
  FeatureRuntime: true;
  App: infer Root extends AppSpec;
}
  ? ComposedFeatureAPIOf<Root>
  : ComposedFeatureAPIOf<Spec>;

export type FeatureAPIContext<App extends AppSpec, Feature extends FeatureSpec> = {
  readonly resources: {
    readonly [Name in ResourceName<FeatureRuntimeSpec<App, Feature>>]: (
      key: ResourceFor<FeatureRuntimeSpec<App, Feature>, Name>["Key"],
    ) => ProgramResource<FeatureRuntimeSpec<App, Feature>, Name>;
  };
  readonly features: {
    readonly [Name in keyof FeatureChildrenOf<Feature>]: ComposedFeatureAPIOf<
      AsFeature<FeatureChildrenOf<Feature>[Name]>
    >;
  };
  readonly actor: ActorOf<App>;
};

type FeatureResourceDefinitions<
  App extends AppSpec,
  Feature extends FeatureSpec,
> = keyof FeatureResources<Feature> extends never
  ? { readonly resources?: Readonly<Record<string, never>> }
  : {
      readonly resources: {
        readonly [Name in keyof FeatureResources<Feature>]: ResourceDef<
          App,
          FeatureResources<Feature>[Name] extends ResourceSpec
            ? FeatureResources<Feature>[Name]
            : never
        >;
      };
    };

type FeatureChildDefinitions<
  App extends AppSpec,
  Feature extends FeatureSpec,
> = keyof FeatureChildrenOf<Feature> extends never
  ? { readonly features?: Readonly<Record<string, never>> }
  : {
      readonly features: {
        readonly [Name in keyof FeatureChildrenOf<Feature>]: FeatureDefinition<
          App,
          AsFeature<FeatureChildrenOf<Feature>[Name]>
        >;
      };
    };

type FeatureSemanticAPI<
  App extends AppSpec,
  Feature extends FeatureSpec,
> = keyof FeatureAPIOf<Feature> extends never
  ? {
      readonly api?: (context: FeatureAPIContext<App, Feature>) => Readonly<Record<string, never>>;
    }
  : {
      readonly api: (context: FeatureAPIContext<App, Feature>) => FeatureAPIOf<Feature>;
    };

type FeatureAPINamespaceCheck<Feature extends FeatureSpec> =
  Extract<keyof FeatureAPIOf<Feature>, keyof FeatureChildrenOf<Feature>> extends never
    ? unknown
    : never;

type FeatureComponentDefinitions<
  App extends AppSpec,
  Feature extends FeatureSpec,
> = keyof FeatureComponents<Feature> extends never
  ? { readonly components?: Readonly<Record<string, never>> }
  : {
      readonly components: ComponentDefinitions<FeatureRuntimeSpec<App, Feature>>;
    };

type FeatureDefinition<App extends AppSpec, Feature extends FeatureSpec> = {
  readonly programs?: AppPrograms<FeatureRuntimeSpec<App, Feature>>;
  readonly navigation?: {
    readonly [Name in keyof FeatureNavigation<Feature>]: CompatibleNavigationName<
      App,
      Extract<FeatureNavigation<Feature>[Name], Record<string, unknown>>
    >;
  };
  readonly endpoints?: Feature extends {
    Endpoints: infer Endpoints extends Record<string, EndpointSpec>;
  }
    ? {
        readonly [Name in keyof Endpoints]: EndpointDef<
          App,
          Endpoints[Name],
          FeatureEndpointDependencies<Feature>
        >;
      }
    : never;
  readonly migrations?: Feature extends {
    Migrations: infer Migrations extends Record<string, unknown>;
  }
    ? Migrations
    : never;
} & FeatureResourceDefinitions<App, Feature> &
  FeatureChildDefinitions<App, Feature> &
  FeatureSemanticAPI<App, Feature> &
  FeatureComponentDefinitions<App, Feature> &
  FeatureDependencyDefinitions<Feature> &
  FeatureAuthentication<Feature> &
  FeatureAPINamespaceCheck<Feature>;

export type FeatureDef<App extends AppSpec, Feature extends FeatureSpec> = FeatureDefinition<
  App,
  Feature
>;

export type RootAPIContext<App extends AppSpec> = FeatureAPIContext<App, App>;

type AppFeatureDefinitions<Spec extends AppSpec> = keyof FeatureChildrenOf<Spec> extends never
  ? { readonly features?: Readonly<Record<string, never>> }
  : {
      readonly features: {
        readonly [Name in keyof FeatureChildrenOf<Spec>]: FeatureDefinition<
          Spec,
          AsFeature<FeatureChildrenOf<Spec>[Name]>
        >;
      };
    };

type AppSemanticAPI<Spec extends AppSpec> = keyof FeatureAPIOf<Spec> extends never
  ? {
      readonly api?: (context: RootAPIContext<Spec>) => Readonly<Record<string, never>>;
    }
  : { readonly api: (context: RootAPIContext<Spec>) => FeatureAPIOf<Spec> };

export type AppDef<Spec extends AppSpec> = {
  version: number;
  app?: AppMetadata;
  pwa?: PwaDef;
  migrationHash?: string;
  migrations?: RuntimeMigrationEdge[];
  navigation?: NavigationDef<Spec>;
  identify?: (opts: { token: string }) => ActorOf<Spec> | null;
  programs?: AppPrograms<Spec>;
  endpoints?: Spec extends { Endpoints: infer Endpoints extends Record<string, EndpointSpec> }
    ? {
        readonly [Name in keyof Endpoints]: EndpointDef<
          Spec,
          Endpoints[Name],
          RootServerDependencies<Spec>
        >;
      }
    : never;
  components?: ComponentDefinitions<Spec>;
  styles?: unknown;
  root?: RootComponentName<Spec>;
  featureManifest?: FeatureManifest;
} & AppFeatureDefinitions<Spec> &
  AppSemanticAPI<Spec> & {
    readonly resources?: {
      [K in keyof Spec["Resources"]]: ResourceDef<
        Spec,
        Spec["Resources"][K] extends ResourceSpec ? Spec["Resources"][K] : never
      >;
    };
  } & FeatureDependencyDefinitions<Spec> &
  FeatureAuthentication<Spec> &
  FeatureAPINamespaceCheck<Spec>;

export type RuntimeMigrationEdge = {
  readonly from: string;
  readonly to: string;
  readonly migrate?: Record<
    string,
    {
      readonly state?: (state: Readonly<Record<string, unknown>>) => unknown;
      readonly event?: (
        name: string,
        payload: Readonly<Record<string, unknown>>,
      ) => { name: string; payload: unknown };
    }
  >;
};

type EventForCmd<R extends ResourceSpec, Cmd extends CommandSpec> =
  EventNameFor<Cmd> extends string
    ? EventNameFor<Cmd> extends keyof R["Events"]
      ? { [K in EventNameFor<Cmd>]: (payload: R["Events"][K]) => void }
      : {}
    : {};

export type CommandCtx<
  Spec extends AppSpec,
  R extends ResourceSpec,
  Cmd extends CommandSpec = never,
> = {
  readonly state: Readonly<R["State"]>;
  readonly actor: ActorOf<Spec>;
  readonly key: R["Key"];
  event: EventForCmd<R, Cmd>;
  error: ErrorFor<Cmd> extends string | [string, unknown]
    ? ErrorFor<Cmd> extends string
      ? (code: ErrorFor<Cmd>) => void
      : ErrorFor<Cmd> extends [infer Code extends string, infer Data]
        ? (code: Code, data: Data) => void
        : never
    : never;
  id: () => string;
  now: () => number;
};

export type FrameworkCommandError =
  | "forbidden"
  | "decision_limit"
  | "internal"
  | "intent_mismatch"
  | "invalid_input"
  | "overloaded";

export type SubmissionPhase =
  | "preparing"
  | "queued"
  | "submitted"
  | "uncertain"
  | "committed"
  | "rejected";

declare const submissionErrorType: unique symbol;

export type SubmissionSuccess = { readonly ok: true; readonly cursor?: number };

export type SubmissionFailure<E = never> = {
  readonly ok: false;
  readonly error:
    | FrameworkCommandError
    | (E extends string ? E : E extends [infer Code, unknown] ? Code : never);
  readonly data?: E extends [string, infer Data] ? Data : unknown;
  readonly [submissionErrorType]?: E;
};

export type SubmissionOutcome<E = never> = SubmissionSuccess | SubmissionFailure<E>;

export type Submission<E = never> = PromiseLike<SubmissionOutcome<E>> & {
  readonly id: string | undefined;
  readonly phase: SubmissionPhase;
  readonly pending: boolean;
  readonly settled: boolean;
  readonly outcome: SubmissionOutcome<E> | undefined;
  subscribe(listener: (submission: Submission<E>) => void): () => void;
};

export type RunCommandOptions = {
  readonly id: string;
  readonly at: number;
};

export type SyncMeta = {
  cursor: number;
  syncing: boolean;
  stale: boolean;
  error: string | null;
};

export type Client<Spec extends AppSpec> = {
  connected: boolean;
  dispose: () => void;
} & ResourceClient<Spec>;

type ResourceClient<Spec extends AppSpec> = {
  [K in keyof Spec["Resources"]]: (
    key: Spec["Resources"][K] extends ResourceSpec ? Spec["Resources"][K]["Key"] : never,
  ) => Spec["Resources"][K] extends ResourceSpec
    ? {
        [VK in keyof Spec["Resources"][K]["Views"]]: Spec["Resources"][K]["Views"][VK];
      } & {
        [CK in keyof Spec["Resources"][K]["Commands"]]: (
          input: Spec["Resources"][K]["Commands"][CK] extends CommandSpec
            ? InputFor<Spec["Resources"][K]["Commands"][CK]>
            : never,
        ) => Submission<
          Spec["Resources"][K]["Commands"][CK] extends CommandSpec
            ? ErrorFor<Spec["Resources"][K]["Commands"][CK]>
            : never
        >;
      } & {
        sync: SyncMeta;
        subscribe: (
          fn: (scope: {
            [VK in keyof Spec["Resources"][K]["Views"]]: Spec["Resources"][K]["Views"][VK];
          }) => void,
        ) => () => void;
      } & PresenceShape<Spec, K & ResourceName<Spec>>
    : never;
};

export type ResolvedAppDef<Spec extends AppSpec> = Omit<
  AppDef<Spec>,
  "identify" | "programs" | "resources"
> & {
  identify: (opts: { token: string }) => ActorOf<Spec> | null;
  programs?: AppProgramRunners<Spec>;
  readonly resources: {
    [K in keyof Spec["Resources"]]: ResourceDef<
      Spec,
      Spec["Resources"][K] extends ResourceSpec ? Spec["Resources"][K] : never
    >;
  };
  readonly featureEndpoints: readonly FeatureContribution[];
  readonly featureMigrations: readonly FeatureContribution[];
  readonly endpointTable: Readonly<Record<string, EndpointTableEntry>>;
  readonly dependencyGroups: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
  readonly authenticationOwner?: string;
  readonly programManifest: readonly RuntimeProgramManifestEntry[];
  runtimeContract?: RuntimeAppContract;
};

export type InstantiatedFeatureAPIsOf<Feature extends FeatureSpec> = {
  readonly api: ComposedFeatureAPIOf<Feature>;
  readonly features: {
    readonly [Name in keyof FeatureChildrenOf<Feature>]: InstantiatedFeatureAPIsOf<
      AsFeature<FeatureChildrenOf<Feature>[Name]>
    >;
  };
};

type IsAny<Value> = 0 extends 1 & Value ? true : false;
type ResourceStateForName<Spec extends AppSpec, Resource extends string> =
  IsAny<Spec> extends true
    ? unknown
    : AppSpec extends Spec
      ? unknown
      : Resource extends ResourceName<Spec>
        ? ResourceFor<Spec, Extract<Resource, ResourceName<Spec>>>["State"]
        : unknown;

export type App<Spec extends AppSpec> = {
  def: ResolvedAppDef<Spec>;
  previous?: unknown;
  createAPI: (options: {
    readonly actor: ActorOf<Spec>;
    readonly resolveResource: (path: string, name: string) => unknown;
  }) => ComposedFeatureAPIOf<Spec>;
  createAPIs: (options: {
    readonly actor: ActorOf<Spec>;
    readonly resolveResource: (path: string, name: string) => unknown;
  }) => InstantiatedFeatureAPIsOf<Spec>;
  createState: <Resource extends string>(
    resource: Resource,
  ) => ResourceStateForName<Spec, Resource>;
  applyEvent: <Resource extends string>(
    resource: Resource,
    state: ResourceStateForName<Spec, Resource>,
    event: {
      id: string;
      seq: number;
      at: number;
      actor: ActorOf<Spec>;
      name: string;
      payload: unknown;
      hash?: string;
    },
    eventVersion?: number,
    eventHash?: string,
  ) => void;
  upcastEvent: (
    resource: string,
    event: {
      name: string;
      payload: unknown;
      hash?: string;
    },
    eventVersion?: number,
    eventHash?: string,
  ) => { name: string; payload: unknown; version: number; hash?: string };
  snapshot: (
    state: unknown,
    seq: number,
  ) => {
    version: number;
    seq: number;
    data: unknown;
    hash?: string;
  };
  restore: <Resource extends string>(
    resource: Resource,
    snap: { version: number; data: unknown; hash?: string },
  ) => ResourceStateForName<Spec, Resource>;
  runCommand: (
    resource: string,
    state: unknown,
    actor: ActorOf<Spec>,
    key: unknown,
    name: string,
    args: unknown[],
    onEvent: (event: {
      id: string;
      seq: number;
      at: number;
      actor: ActorOf<Spec>;
      name: string;
      payload: unknown;
    }) => void,
    onError: (error: string, data?: unknown) => void,
    options?: RunCommandOptions,
  ) => void;
};

type ResourcesOf<A> =
  A extends App<infer S> ? (S extends AppSpec & { Resources: infer R } ? R : never) : never;

type TargetResourceState<Spec extends AppSpec, Resource> = Resource extends keyof Spec["Resources"]
  ? Spec["Resources"][Resource] extends { State: infer State }
    ? State
    : never
  : never;

type TargetResourceEvent<Spec extends AppSpec, Resource> = Resource extends keyof Spec["Resources"]
  ? Spec["Resources"][Resource] extends { Events: infer Events }
    ? {
        [Event in keyof Events & string]: { name: Event; payload: Events[Event] };
      }[keyof Events & string]
    : never
  : never;

type MigrateDef<Spec extends AppSpec, Prev> = {
  previous: Prev;
  migrate?: {
    state?: {
      [R in keyof ResourcesOf<Prev>]?: (
        data: ResourcesOf<Prev>[R] extends { State: infer S } ? S : never,
      ) => TargetResourceState<Spec, R>;
    };
    event?: {
      [R in keyof ResourcesOf<Prev>]?: <
        E extends keyof (ResourcesOf<Prev>[R] extends { Events: infer EV } ? EV : never) & string,
      >(
        name: E,
        payload: ResourcesOf<Prev>[R] extends { Events: infer EV } ? EV[E & keyof EV] : never,
      ) => TargetResourceEvent<Spec, R> | { name: string; payload: unknown };
    };
  };
};

type ErasedMigrationDefinition = {
  readonly version: number;
  readonly migrate?: {
    readonly state?: Readonly<Record<string, (state: unknown) => unknown>>;
    readonly event?: Readonly<
      Record<string, (name: string, payload: unknown) => { name: string; payload: unknown }>
    >;
  };
};

type ErasedApp = {
  readonly def: ErasedMigrationDefinition;
  readonly previous?: unknown;
};

type ErasedResourceDefinition = {
  readonly state: unknown;
  readonly events: Readonly<
    Record<
      string,
      (input: { state: unknown; payload: unknown; actor: unknown; at: number; seq: number }) => void
    >
  >;
  readonly commands?: Readonly<
    Record<string, (context: ErasedCommandContext, ...args: unknown[]) => void>
  >;
};

type ErasedCommandContext = {
  readonly state: unknown;
  readonly actor: unknown;
  readonly key: unknown;
  readonly event: Readonly<Record<string, (payload: unknown) => void>>;
  readonly error: (code: string, data?: unknown) => void;
  readonly id: () => string;
  readonly now: () => number;
};

export function defineApp<Spec extends AppSpec, Prev = never>(
  def: AppDef<Spec> & ([Prev] extends [never] ? {} : MigrateDef<Spec, Prev>),
): App<Spec>;
export function defineApp<Spec extends AppSpec, Prev = never>(def: unknown): App<Spec> {
  const appDef = def as AppDef<Spec> & ([Prev] extends [never] ? {} : MigrateDef<Spec, Prev>);
  const previous = (appDef as typeof appDef & { previous?: ErasedApp }).previous;
  const composedFeatures = composeFeatures(
    appDef.features as never,
    new Set(Object.keys(appDef.resources ?? {})),
    new Set(Object.keys(appDef.components ?? {})),
  );
  const dependencyGroups: Record<string, Record<string, Readonly<Record<string, unknown>>>> = {};
  for (const [environment, groups] of Object.entries(composedFeatures.dependencies)) {
    dependencyGroups[environment] = { ...groups };
  }
  for (const [environment, implementations] of Object.entries(appDef.dependencies ?? {})) {
    (dependencyGroups[environment] ??= {}).application = Object.freeze({
      ...(implementations as Record<string, unknown>),
    });
  }
  const featureAuthentication = composedFeatures.authentication;
  if (appDef.authentication && featureAuthentication) {
    throw new Error(
      `Authentication is owned by both application and Feature ${featureAuthentication.owner}.`,
    );
  }
  const authenticationOwner = appDef.authentication ? "application" : featureAuthentication?.owner;
  const authentication = appDef.authentication ?? featureAuthentication?.value;
  if (authenticationOwner && authentication) {
    (dependencyGroups.server ??= {})[authenticationOwner] = Object.freeze({
      ...dependencyGroups.server?.[authenticationOwner],
      authentication,
    });
  }
  const resolvedDef = {
    ...appDef,
    resources: { ...appDef.resources, ...composedFeatures.resources },
    components: { ...appDef.components, ...composedFeatures.components },
    programs: composeFeaturePrograms(appDef.programs as never, composedFeatures.programs) as never,
    programManifest: collectRuntimeProgramManifest(
      appDef.programs as never,
      composedFeatures.programs,
    ),
    featureEndpoints: composedFeatures.endpoints,
    featureMigrations: composedFeatures.migrations,
    endpointTable: compileEndpointTable(appDef.endpoints as never, composedFeatures.endpoints),
    dependencyGroups: Object.freeze(
      Object.fromEntries(
        Object.entries(dependencyGroups).map(([environment, groups]) => [
          environment,
          Object.freeze(groups),
        ]),
      ),
    ),
    authenticationOwner,
    featureManifest: composedFeatures.manifest,
    identify: appDef.identify ?? defaultIdentify,
  } as unknown as ResolvedAppDef<Spec> & ([Prev] extends [never] ? {} : MigrateDef<Spec, Prev>);
  const runtimeDef = resolvedDef as ResolvedAppDef<Spec>;
  return {
    def: resolvedDef,
    previous,
    createAPI: ({ actor, resolveResource }) =>
      instantiateFeatureAPIs({
        features: appDef.features as never,
        api: appDef.api as never,
        resources: appDef.resources ?? {},
        actor,
        resolveResource,
      }).api as ComposedFeatureAPIOf<Spec>,
    createAPIs: ({ actor, resolveResource }) =>
      instantiateFeatureAPIs({
        features: appDef.features as never,
        api: appDef.api as never,
        resources: appDef.resources ?? {},
        actor,
        resolveResource,
      }) as InstantiatedFeatureAPIsOf<Spec>,
    createState: ((r: string) => {
      const res = resolvedDef.resources[r];
      if (!res) return undefined;
      const state = structuredClone(res.state);
      assertRuntimeResourceValue(runtimeDef, r, "state", undefined, state);
      return state;
    }) as App<Spec>["createState"],
    applyEvent: (r: string, s: unknown, e, ev?: number, hash?: string) =>
      applyEventImpl(runtimeDef, r, s, e, ev, hash, previous),
    upcastEvent: (r, e, ev, hash) => upcastEventImpl(runtimeDef, r, e, ev, hash, previous),
    snapshot: (s, seq) => {
      const snapshot = { version: resolvedDef.version, seq, data: structuredClone(s) } as {
        version: number;
        seq: number;
        data: unknown;
        hash?: string;
      };
      if (resolvedDef.migrationHash) snapshot.hash = resolvedDef.migrationHash;
      return snapshot;
    },
    restore: ((r: string, snap: { version: number; data: unknown; hash?: string }) => {
      const state = restoreImpl(runtimeDef, r, snap, previous);
      assertRuntimeResourceValue(runtimeDef, r, "state", undefined, state);
      return state;
    }) as App<Spec>["restore"],
    runCommand: (r, s, a, k, n, args, onEvent, onError, options) =>
      runCommandImpl(runtimeDef, r, s, a, k, n, args, onEvent, onError, options),
  };
}

function defaultIdentify<Spec extends AppSpec>({ token }: { token: string }): ActorOf<Spec> {
  return { id: token || "local" } as ActorOf<Spec>;
}

function restoreImpl<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  snap: { version: number; data: unknown; hash?: string },
  previous?: ErasedApp,
): unknown {
  const res = def.resources[resource];
  if (!res) return undefined;
  const state = structuredClone(res.state);
  if (!snap) return state;
  if (snap.hash && def.migrationHash) {
    if (snap.hash === def.migrationHash) return structuredClone(snap.data);
    return migrateStateByHash(def, resource, snap.hash, def.migrationHash, snap.data);
  }
  if (snap.version === def.version) return structuredClone(snap.data);
  if (snap.version < def.version && previous) {
    const links: ErasedApp[] = [];
    let cur: ErasedApp | undefined = previous;
    while (cur) {
      links.push(cur);
      cur = cur.previous as ErasedApp | undefined;
    }
    links.reverse();
    const defs: ErasedMigrationDefinition[] = [];
    for (const link of links) defs.push(link.def);
    defs.push(def);
    let data = structuredClone(snap.data);
    for (const d of defs) {
      if (d.version > snap.version && d.version <= def.version) {
        const migrate = d.migrate;
        if (migrate?.state?.[resource]) {
          data = migrate.state[resource](data);
        }
      }
    }
    if (data !== undefined) return data;
  }
  return state;
}

function applyEventImpl<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  state: unknown,
  event: {
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<S>;
    name: string;
    payload: unknown;
    hash?: string;
  },
  eventVersion?: number,
  eventHash?: string,
  previous?: ErasedApp,
): void {
  const { name, payload } = upcastEventImpl(
    def,
    resource,
    { name: event.name, payload: event.payload },
    eventVersion,
    eventHash ?? event.hash,
    previous,
  );
  const handler = (
    def.resources[resource]?.events as unknown as ErasedResourceDefinition["events"] | undefined
  )?.[name];
  if (!handler) return;
  assertRuntimeResourceValue(def, resource, "event", name, payload);
  handler({ state, payload, actor: event.actor, at: event.at, seq: event.seq });
}

function upcastEventImpl<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  event: {
    name: string;
    payload: unknown;
    hash?: string;
  },
  eventVersion?: number,
  eventHash?: string,
  previous?: ErasedApp,
): { name: string; payload: unknown; version: number; hash?: string } {
  let name = event.name;
  let payload = event.payload;
  const sourceHash = eventHash ?? event.hash;
  if (sourceHash && def.migrationHash) {
    if (sourceHash !== def.migrationHash) {
      const upcasted = migrateEventByHash(
        def,
        resource,
        sourceHash,
        def.migrationHash,
        name,
        payload,
      );
      name = upcasted.name;
      payload = upcasted.payload;
    }
    return { name, payload, version: def.version, hash: def.migrationHash };
  }
  if (eventVersion !== undefined && eventVersion < def.version && previous) {
    const links: ErasedApp[] = [];
    let cur: ErasedApp | undefined = previous;
    while (cur) {
      links.push(cur);
      cur = cur.previous as ErasedApp | undefined;
    }
    links.reverse();
    const defs: ErasedMigrationDefinition[] = [];
    for (const link of links) defs.push(link.def);
    defs.push(def);
    for (const d of defs) {
      if (d.version > eventVersion && d.version <= def.version) {
        const migrate = d.migrate;
        if (migrate?.event?.[resource]) {
          const upcasted = migrate.event[resource](name, payload);
          name = upcasted.name;
          payload = upcasted.payload;
        }
      }
    }
  }
  return { name, payload, version: def.version };
}

export function installAppMigrations<Spec extends AppSpec>(
  app: App<Spec>,
  options: {
    hash?: string;
    migrations?: readonly RuntimeMigrationEdge[];
    contract?: RuntimeAppContract;
  },
): App<Spec> {
  if (options.contract && options.hash && options.contract.hash !== options.hash) {
    throw new TypeError("The generated runtime contract and migration hash disagree.");
  }
  const target = app.def as unknown as {
    runtimeContract?: RuntimeAppContract;
    migrationHash?: string;
    migrations?: RuntimeMigrationEdge[];
  };
  if (options.contract) target.runtimeContract = options.contract;
  if (options.hash) target.migrationHash = options.hash;
  target.migrations = [...(options.migrations ?? [])];
  return app;
}

export function assertResourceKey<Spec extends AppSpec>(
  app: App<Spec>,
  resource: string,
  key: unknown,
): void {
  assertRuntimeResourceValue(app.def, resource, "key", undefined, key);
}

export function assertResourceCommand<Spec extends AppSpec>(
  app: App<Spec>,
  resource: string,
  command: string,
  args: unknown,
): void {
  assertRuntimeResourceValue(app.def, resource, "command", command, args);
}

function assertRuntimeResourceValue<Spec extends AppSpec>(
  def: ResolvedAppDef<Spec>,
  resource: string,
  kind: "key" | "state" | "event" | "command",
  name: string | undefined,
  value: unknown,
): void {
  const contract = def.runtimeContract;
  if (!contract) return;
  const current = contract.resources[resource];
  if (!current) {
    throw new TypeError(`Generated contract is missing Resource ${JSON.stringify(resource)}.`);
  }
  const schema =
    kind === "key"
      ? current.key
      : kind === "state"
        ? current.state
        : name === undefined
          ? undefined
          : current[kind === "event" ? "events" : "commands"][name];
  if (schema === undefined) {
    throw new TypeError(
      `Generated contract is missing ${resource}.${kind}${name ? `.${name}` : ""}.`,
    );
  }
  if (!validateRuntimeValue(contract, schema, value, 0, new WeakSet())) {
    throw new TypeError(`Value does not satisfy ${resource}.${kind}${name ? `.${name}` : ""}.`);
  }
}

function validateRuntimeValue(
  contract: RuntimeAppContract,
  schema: number,
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): boolean {
  if (depth > 128) return false;
  const node = contract.nodes[schema];
  if (!node) return false;
  switch (node.kind) {
    case "unknown":
      return validateUnknownJson(value, depth, ancestors);
    case "never":
      return false;
    case "null":
      return value === null;
    case "undefined":
      return value === undefined;
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "literal":
      return Object.is(value, node.value);
    case "union":
      return node.members.some((member) =>
        validateRuntimeValue(contract, member, value, depth + 1, ancestors),
      );
    case "intersection":
      return node.members.every((member) =>
        validateRuntimeValue(contract, member, value, depth + 1, ancestors),
      );
    case "array":
      return (
        Array.isArray(value) &&
        withRuntimeObject(value, ancestors, () =>
          value.every((item) =>
            validateRuntimeValue(contract, node.item, item, depth + 1, ancestors),
          ),
        )
      );
    case "tuple":
      return validateRuntimeTuple(contract, node, value, depth, ancestors);
    case "object":
      return validateRuntimeObject(contract, node, value, depth, ancestors);
  }
}

function validateRuntimeTuple(
  contract: RuntimeAppContract,
  node: Extract<RuntimeSchemaNode, { kind: "tuple" }>,
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): boolean {
  if (!Array.isArray(value)) return false;
  return withRuntimeObject(value, ancestors, () => {
    let index = 0;
    for (const element of node.elements) {
      if (element.rest) {
        while (index < value.length) {
          if (!validateRuntimeValue(contract, element.schema, value[index], depth + 1, ancestors)) {
            return false;
          }
          index += 1;
        }
        return true;
      }
      if (index >= value.length) {
        if (element.optional) continue;
        return false;
      }
      if (!validateRuntimeValue(contract, element.schema, value[index], depth + 1, ancestors)) {
        return false;
      }
      index += 1;
    }
    return index === value.length;
  });
}

function validateRuntimeObject(
  contract: RuntimeAppContract,
  node: Extract<RuntimeSchemaNode, { kind: "object" }>,
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return withRuntimeObject(value, ancestors, () => {
    const object = value as Record<string, unknown>;
    const properties = new Map(node.properties.map((property) => [property.name, property]));
    for (const property of node.properties) {
      if (!(property.name in object)) {
        if (property.optional) continue;
        return false;
      }
      if (
        !validateRuntimeValue(
          contract,
          property.schema,
          object[property.name],
          depth + 1,
          ancestors,
        )
      ) {
        return false;
      }
    }
    for (const [name, item] of Object.entries(object)) {
      if (properties.has(name)) continue;
      if (
        node.index === undefined ||
        !validateRuntimeValue(contract, node.index, item, depth + 1, ancestors)
      ) {
        return false;
      }
    }
    return true;
  });
}

function validateUnknownJson(value: unknown, depth: number, ancestors: WeakSet<object>): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (!value || typeof value !== "object" || depth > 128) return false;
  return withRuntimeObject(value, ancestors, () =>
    Array.isArray(value)
      ? value.every((item) => validateUnknownJson(item, depth + 1, ancestors))
      : Object.values(value).every((item) => validateUnknownJson(item, depth + 1, ancestors)),
  );
}

function withRuntimeObject(
  value: object,
  ancestors: WeakSet<object>,
  validate: () => boolean,
): boolean {
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    return validate();
  } finally {
    ancestors.delete(value);
  }
}

function migrateStateByHash<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  from: string,
  to: string,
  data: unknown,
): unknown {
  const path = findMigrationPath(def, from, to);
  let current = structuredClone(data);
  for (const edge of path) {
    current =
      edge.migrate?.[resource]?.state?.(current as Readonly<Record<string, unknown>>) ?? current;
  }
  return current;
}

function migrateEventByHash<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  from: string,
  to: string,
  name: string,
  payload: unknown,
): { name: string; payload: unknown } {
  const path = findMigrationPath(def, from, to);
  let current = { name, payload };
  for (const edge of path) {
    current =
      edge.migrate?.[resource]?.event?.(
        current.name,
        current.payload as Readonly<Record<string, unknown>>,
      ) ?? current;
  }
  return current;
}

function findMigrationPath<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  from: string,
  to: string,
): RuntimeMigrationEdge[] {
  const migrations = def.migrations ?? [];
  const queue: Array<{ hash: string; path: RuntimeMigrationEdge[] }> = [{ hash: from, path: [] }];
  const seen = new Set<string>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hash === to) return current.path;

    for (const edge of migrations) {
      if (edge.from !== current.hash || seen.has(edge.to)) continue;
      const nextPath = [...current.path, edge];
      if (edge.to === to) return nextPath;
      seen.add(edge.to);
      queue.push({ hash: edge.to, path: nextPath });
    }
  }

  throw new Error(`No migration path from ${from} to ${to}.`);
}

function runCommandImpl<S extends AppSpec>(
  def: ResolvedAppDef<S>,
  resource: string,
  state: unknown,
  actor: ActorOf<S>,
  key: unknown,
  name: string,
  args: unknown[],
  onEvent: (event: {
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<S>;
    name: string;
    payload: unknown;
  }) => void,
  onError: (error: string, data?: unknown) => void,
  options?: RunCommandOptions,
): void {
  const resDef = def.resources[resource] as unknown as ErasedResourceDefinition | undefined;
  if (!resDef) return;
  const fn = resDef.commands?.[name];
  if (!fn) return;
  assertRuntimeResourceValue(def, resource, "key", undefined, key);
  assertRuntimeResourceValue(def, resource, "command", name, args);

  const readonlyState = createReadonlyView(state);
  let seq = 0;
  let valueSequence = 0;

  const eventMethods: Record<string, (payload: unknown) => void> = {};
  for (const ek of Object.keys(resDef.events)) {
    eventMethods[ek] = (payload: unknown) => {
      assertRuntimeResourceValue(def, resource, "event", ek, payload);
      const eventSequence = seq++;
      onEvent({
        id: options ? `${options.id}:event:${eventSequence}` : nextId(),
        seq: eventSequence,
        at: options?.at ?? Date.now(),
        actor,
        name: ek,
        payload,
      });
    };
  }

  const ctx: ErasedCommandContext = {
    state: readonlyState,
    actor,
    key,
    event: eventMethods,
    error: (code: string, data?: unknown) => {
      onError(code, data);
    },
    id: () => (options ? `${options.id}:value:${valueSequence++}` : nextId()),
    now: () => options?.at ?? Date.now(),
  };

  fn(ctx, ...args);
}

function createReadonlyView<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  const views = new WeakMap<object, object>();
  const protect = (current: object): object => {
    const existing = views.get(current);
    if (existing) return existing;
    const view = new Proxy(current, {
      get(target, property, receiver) {
        const child = Reflect.get(target, property, receiver) as unknown;
        return child !== null && typeof child === "object" ? protect(child) : child;
      },
      defineProperty() {
        throw new TypeError("Resource command state is read-only.");
      },
      deleteProperty() {
        throw new TypeError("Resource command state is read-only.");
      },
      set() {
        throw new TypeError("Resource command state is read-only.");
      },
      setPrototypeOf() {
        throw new TypeError("Resource command state is read-only.");
      },
    });
    views.set(current, view);
    return view;
  };
  return protect(value) as Value;
}

function nextId() {
  return crypto.randomUUID();
}
