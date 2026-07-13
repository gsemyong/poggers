import type { JsonValue, SessionData } from "./protocol";
import type { PresetAppearance } from "./preset";
import type { IntrinsicElements as NativeIntrinsicElements } from "./jsx-types";
export type LocalActor = {
  id: string;
};
type MigrationSpec = {
  Resources: Record<string, unknown>;
};
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
export type AppSpec = {
  Actor?: {
    id: string;
  };
  Resources: Record<string, unknown>;
  Deps?: unknown;
  Environments?: Record<
    string,
    {
      Deps?: unknown;
    }
  >;
  Navigation?: Record<string, Record<string, unknown>>;
  Components?: Record<
    string,
    {
      Input?: Record<string, unknown>;
      Context?: Record<string, unknown>;
      States?: string;
      Output?: unknown;
      Values?: Record<string, unknown>;
      Events?: Record<string, (...args: never[]) => unknown>;
      Actions?: never;
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
    }
  >;
  Styles?: {
    Presets?: string | Record<string, unknown>;
  };
};
export type ActorOf<Spec extends AppSpec> = Spec extends {
  Actor: infer A extends {
    id: string;
  };
}
  ? A
  : LocalActor;
export type ResourceSpec = {
  Key: JsonValue;
  State: unknown;
  Presence?: unknown;
  Events: Record<string, unknown>;
  Views: Record<string, unknown>;
  Commands: Record<string, unknown>;
};
export type CommandSpec = {
  args: unknown[];
  event?: string;
  error?: string | [string, unknown];
};
type EventNameFor<C> = C extends {
  event: infer E;
}
  ? E
  : never;
type ErrorFor<C> = C extends {
  error: infer E;
}
  ? E
  : never;
export type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;
export type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;
export type EnvironmentName<Spec extends AppSpec> = Spec extends {
  Environments: infer Environments;
}
  ? Extract<keyof Environments, string>
  : Spec extends {
        Deps: unknown;
      }
    ? "server"
    : never;
export type EnvironmentDeps<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
> = Spec extends {
  Environments: infer Environments;
}
  ? Env extends keyof Environments
    ? Environments[Env] extends {
        Deps: infer Deps;
      }
      ? Deps
      : Record<string, never>
    : never
  : Env extends "server"
    ? Spec extends {
        Deps: infer Deps;
      }
      ? Deps
      : Record<string, never>
    : never;
export type AppDependencies<Spec extends AppSpec> = Spec extends {
  Deps: infer Deps;
}
  ? Deps
  : Spec extends {
        Environments: infer Environments;
      }
    ? "server" extends keyof Environments
      ? Environments["server"] extends {
          Deps: infer Deps;
        }
        ? Deps
        : Record<string, never>
      : Record<string, never>
    : Record<never, never>;
export type NavigationName<Spec extends AppSpec> = Spec extends {
  Navigation: infer Navigation;
}
  ? Extract<keyof Navigation, string>
  : "home";
export type NavigationParams<
  Spec extends AppSpec,
  Screen extends NavigationName<Spec>,
> = Spec extends {
  Navigation: infer Navigation;
}
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
    ...args: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ResourceFor<Spec, Resource>["Commands"][Command]["args"]
      : ResourceFor<Spec, Resource>["Commands"][Command] extends unknown[]
        ? ResourceFor<Spec, Resource>["Commands"][Command]
        : []
  ) => CommandReceipt<
    ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ErrorFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never
  >;
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
  };
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
export type AppDepsDef<Spec extends AppSpec> = {
  [Env in EnvironmentName<Spec>]?: DependencyMount<EnvironmentDeps<Spec, Env>>;
};
export type DependencyProvider<Value> = Value | (() => Value | Promise<Value>);
export type DependencyProviderSet<Value> = {
  production: DependencyProvider<Value>;
  mock?: DependencyProvider<Value>;
} & Record<string, DependencyProvider<Value> | undefined>;
export type DependencyEntry<Value> = DependencyProviderSet<Value> | DependencyProvider<Value>;
export type DependencyConfig<Deps> = {
  mode?: string | (() => string | Promise<string>);
  deps?: {
    [Name in keyof Deps]: DependencyEntry<Deps[Name]>;
  };
} & {
  [Name in keyof Deps]?: DependencyEntry<Deps[Name]>;
};
export type DependencyMount<Deps> = (() => Deps | Promise<Deps>) | Deps | DependencyConfig<Deps>;
export type ProgramResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
  };
export type SemanticProgramHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
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
export type ProgramEventItem<
  Spec extends AppSpec,
  Name extends AppEventName<Spec>,
  Resource extends ResourceFromEventName<Spec, Name> = ResourceFromEventName<Spec, Name>,
> = {
  readonly event: ProgramEvent<Spec, Name>;
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly view: ViewShape<Spec, Resource>;
} & {
  readonly [Current in Resource]: ProgramResource<Spec, Current>;
};
export type ProgramEventStream<Spec extends AppSpec> = <Name extends AppEventName<Spec>>(
  name: Name,
  options: {
    id: string;
    signal?: AbortSignal;
  },
) => AsyncIterable<ProgramEventItem<Spec, Name>>;
export type ProgramContext<Spec extends AppSpec> = SemanticProgramHooks<Spec> & {
  readonly signal: AbortSignal;
  readonly events: ProgramEventStream<Spec>;
};
export type AppPrograms<Spec extends AppSpec> = {
  [Env in EnvironmentName<Spec>]?: (
    ctx: ProgramContext<Spec>,
    deps: EnvironmentDeps<Spec, Env>,
  ) => void | Promise<void>;
};
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
declare const visualValueKind: unique symbol;
declare const writableValueKind: unique symbol;
export type VisualValue<Kind extends ComponentValueKind> = {
  readonly [visualValueKind]: Kind;
};
export type Writable<Value> = {
  readonly [writableValueKind]: Value;
};
type ComponentValueSource<Value> = Value extends Writable<infer Source> ? Source : Value;
type ComponentValueFor<Value> =
  ComponentValueSource<Value> extends VisualValue<infer Kind>
    ? Kind extends ComponentValueKind
      ? number
      : never
    : ComponentValueSource<Value>;
type ComponentValueContract<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Values: infer Values extends Record<string, unknown>;
  }
    ? Values
    : Record<never, never>;
type ComponentWritableValueName<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentValueContract<Spec, Component>]-?: ComponentValueContract<
    Spec,
    Component
  >[Value] extends Writable<unknown>
    ? Value
    : never;
}[keyof ComponentValueContract<Spec, Component>];
export type ComponentWritableValues<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Pick<ComponentValues<Spec, Component>, ComponentWritableValueName<Spec, Component>>;
type ComponentReadableValues<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Value in keyof ComponentValueContract<Spec, Component>]: ComponentValueFor<
    ComponentValueContract<Spec, Component>[Value]
  >;
};
export type ComponentValues<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentReadableValues<Spec, Component> & {
  -readonly [Value in ComponentWritableValueName<Spec, Component>]: ComponentValueFor<
    ComponentValueContract<Spec, Component>[Value]
  >;
};
export type ComponentVisualValues<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentValueContract<Spec, Component> as ComponentValueContract<
    Spec,
    Component
  >[Value] extends VisualValue<ComponentValueKind> | Writable<VisualValue<ComponentValueKind>>
    ? Value
    : never]: ComponentValueFor<ComponentValueContract<Spec, Component>[Value]>;
};
export type ComponentValueKinds<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Value in keyof ComponentValueContract<Spec, Component> as ComponentValueContract<
    Spec,
    Component
  >[Value] extends VisualValue<ComponentValueKind> | Writable<VisualValue<ComponentValueKind>>
    ? Value
    : never]: ComponentValueSource<
    ComponentValueContract<Spec, Component>[Value]
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
type ExplicitComponentEvents<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Events: infer Events extends Record<string, (...args: never[]) => unknown>;
  }
    ? Events
    : Record<never, never>;
export type ComponentStatePath<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    States: infer States extends string;
  }
    ? States
    : "active";
type ComponentStateSegment<Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head | ComponentStateSegment<Tail>
  : Path;
type ComponentStateValueMap<Path extends string> = {
  readonly [region: string]: ComponentStateValue<Path>;
};
export type ComponentStateValue<Path extends string> =
  | ComponentStateSegment<Path>
  | ComponentStateValueMap<Path>;
export type ComponentOutput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Output: infer Output;
  }
    ? Output
    : void;
export type ComponentTasks<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Tasks: infer Tasks extends Record<
      string,
      {
        Input: unknown;
        Output: unknown;
        Error: unknown;
      }
    >;
  }
    ? Tasks
    : Record<never, never>;
export type ComponentTaskName<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Extract<keyof ComponentTasks<Spec, Component>, string>;
export type ComponentEvents<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ExplicitComponentEvents<Spec, Component>;
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
export type ComponentEventArgs<Event> = Event extends (...args: infer Args) => unknown ? Args : [];
export type ComponentTransitionScope<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly parameters: Readonly<ComponentParameters<Spec, Component>>;
  readonly appearance: PresetAppearance<Spec>;
  readonly setAppearance: (appearance: PresetAppearance<Spec>) => void;
  readonly resources: ComponentResourceFactories<Spec>;
  readonly navigation: AppNavigation<Spec>;
  readonly screen: AppScreen<Spec>;
};
type ComponentTaskContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
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
  readonly done?: ComponentStatePath<Spec, Component>;
  readonly cancelled?: ComponentStatePath<Spec, Component>;
};
type ComponentTransitionConfig<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> = {
  readonly target?:
    | ComponentStatePath<Spec, Component>
    | readonly ComponentStatePath<Spec, Component>[];
  readonly allow?: (scope: ComponentTransitionScope<Spec, Component>, ...args: Args) => boolean;
  readonly update?: ComponentContextUpdate<Spec, Component, Args>;
  readonly perform?: (scope: ComponentTransitionScope<Spec, Component>, ...args: Args) => void;
  readonly reenter?: boolean;
};
export type ComponentTransition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> = ComponentStatePath<Spec, Component> | ComponentTransitionConfig<Spec, Component, Args>;
export type ComponentTransitions<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[] = readonly [],
> =
  | ComponentTransition<Spec, Component, Args>
  | readonly ComponentTransition<Spec, Component, Args>[];
type ComponentEventTransitions<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Action in keyof ComponentEvents<Spec, Component>]?: ComponentTransitions<
    Spec,
    Component,
    ComponentEventArgs<ComponentEvents<Spec, Component>[Action]>
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
> =
  ComponentTaskFor<Spec, Component, Task> extends {
    Input: infer Input;
  }
    ? Input
    : never;
export type ComponentTaskOutput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> =
  ComponentTaskFor<Spec, Component, Task> extends {
    Output: infer Output;
  }
    ? Output
    : never;
export type ComponentTaskError<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Task extends ComponentTaskName<Spec, Component>,
> =
  ComponentTaskFor<Spec, Component, Task> extends {
    Error: infer Error;
  }
    ? Error
    : never;
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
  readonly initial?: ComponentStatePath<Spec, Component>;
  readonly states?: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
  readonly on?: ComponentEventTransitions<Spec, Component>;
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
  readonly states: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
};
export type ComponentStateView<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly value: ComponentStateValue<ComponentStatePath<Spec, Component>>;
  readonly active: readonly ComponentStatePath<Spec, Component>[];
  readonly done: boolean;
  readonly output: ComponentOutput<Spec, Component> | undefined;
  readonly error: unknown;
  matches(state: ComponentStatePath<Spec, Component>): boolean;
  can<Action extends keyof ComponentEvents<Spec, Component>>(
    action: Action,
    ...args: ComponentEventArgs<ComponentEvents<Spec, Component>[Action]>
  ): boolean;
  subscribe(observer: (state: ComponentStateView<Spec, Component>) => void): () => void;
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
  ? {
      tasks?: never;
    }
  : {
      tasks: {
        readonly [Task in ComponentTaskName<Spec, Component>]: (
          scope: ComponentTaskScope<Spec, Component, Task>,
        ) =>
          | ComponentTaskOutput<Spec, Component, Task>
          | Promise<ComponentTaskOutput<Spec, Component, Task>>;
      };
    };
type ComponentRenderChild =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | ComponentRenderChild[]
  | (() => ComponentRenderChild);
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
export type ComponentResourceFactories<Spec extends AppSpec> = {
  readonly [Resource in ResourceName<Spec>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => UIResource<Spec, Resource>;
};
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
  readonly input: ComponentInput<Spec, Component>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly state: ComponentStateView<Spec, Component>;
  readonly values: ComponentValues<Spec, Component>;
  readonly parameters: Readonly<ComponentParameters<Spec, Component>>;
  readonly appearance: PresetAppearance<Spec>;
  readonly events: ComponentEventHandlers<Spec, Component>;
  readonly slots: ComponentSlots<Spec, Component>;
  readonly components: ComponentRenderers<Spec>;
  readonly resources: ComponentResourceFactories<Spec>;
  readonly navigation: AppNavigation<Spec>;
  readonly screen: AppScreen<Spec>;
  readonly parts: {
    readonly [Part in ComponentPartName<Spec, Component>]: ComponentPart<Spec, Component, Part>;
  };
};
export type ComponentRender<Spec extends AppSpec, Component extends ComponentName<Spec>> = (
  scope: ComponentRenderScope<Spec, Component>,
) => ComponentRenderChild;
export type ComponentEventHandlers<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Action in keyof ComponentEvents<Spec, Component>]: (
    ...args: ComponentEventArgs<ComponentEvents<Spec, Component>[Action]>
  ) => void;
};
export type ComponentDeriveScope<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly context: Readonly<ComponentContext<Spec, Component>>;
  readonly state: ComponentStateView<Spec, Component>;
  readonly parameters: Readonly<ComponentParameters<Spec, Component>>;
  readonly appearance: PresetAppearance<Spec>;
  readonly screen: AppScreen<Spec>;
};
type ComponentValuesDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  keyof ComponentValues<Spec, Component>,
] extends [never]
  ? {
      values?: never;
      derive?: (scope: ComponentDeriveScope<Spec, Component>) => ComponentValues<Spec, Component>;
    }
  : {
      values?: Partial<
        Pick<ComponentValues<Spec, Component>, ComponentWritableValueName<Spec, Component>>
      >;
      derive?: (
        scope: ComponentDeriveScope<Spec, Component>,
      ) => Partial<
        Omit<ComponentValues<Spec, Component>, ComponentWritableValueName<Spec, Component>>
      >;
    };
type ComponentContextDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentContext<Spec, Component>> extends true
    ? {
        context?: never;
      }
    : {
        context: ComponentContext<Spec, Component>;
      };
export type ComponentStatechartDefinition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> =
  ComponentFor<Spec, Component> extends {
    States: string;
  }
    ? ComponentContextDefinition<Spec, Component> &
        ComponentTaskDefinitions<Spec, Component> & {
          initial: ComponentStatePath<Spec, Component>;
          on?: ComponentEventTransitions<Spec, Component>;
          states: Readonly<Record<string, ComponentStateNode<Spec, Component>>>;
        }
    : keyof ComponentEvents<Spec, Component> extends never
      ? {
          context?: never;
          initial?: never;
          on?: never;
          states?: never;
          tasks?: never;
        }
      : ComponentContextDefinition<Spec, Component> & {
          initial?: never;
          on: ComponentEventTransitions<Spec, Component>;
          states?: never;
          tasks?: never;
        };
export type ComponentDefinition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentValuesDefinition<Spec, Component> &
  ComponentStatechartDefinition<Spec, Component> & {
    render: ComponentRender<Spec, Component>;
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
  state: R["State"];
  presence?: R["Presence"];
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
      ...args: R["Commands"][K] extends CommandSpec
        ? R["Commands"][K]["args"]
        : R["Commands"][K] extends unknown[]
          ? R["Commands"][K]
          : []
    ) => void;
  };
};
export type AppDef<Spec extends AppSpec> = {
  version: number;
  app?: AppMetadata;
  pwa?: PwaDef;
  migrationHash?: string;
  migrations?: RuntimeMigrationEdge[];
  navigation?: NavigationDef<Spec>;
  identify?: (opts: { token: string }) => ActorOf<Spec> | null;
  deps?: AppDepsDef<Spec>;
  programs?: AppPrograms<Spec>;
  components?: ComponentDefinitions<Spec>;
  styles?: unknown;
  root?: RootComponentName<Spec>;
  resources: {
    [K in keyof Spec["Resources"]]: ResourceDef<
      Spec,
      Spec["Resources"][K] extends ResourceSpec ? Spec["Resources"][K] : never
    >;
  };
};
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
      ) => {
        name: string;
        payload: unknown;
      };
    }
  >;
};
type EventForCmd<R extends ResourceSpec, Cmd extends CommandSpec> =
  EventNameFor<Cmd> extends string
    ? EventNameFor<Cmd> extends keyof R["Events"]
      ? {
          [K in EventNameFor<Cmd>]: (payload: R["Events"][K]) => void;
        }
      : {}
    : {};
export type CommandCtx<
  Spec extends AppSpec,
  R extends ResourceSpec,
  Cmd extends CommandSpec = never,
> = {
  readonly state: R["State"];
  readonly actor: ActorOf<Spec>;
  readonly key: R["Key"];
  event: EventForCmd<R, Cmd>;
  setPresence: (patch: Partial<R["Presence"]>) => void;
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
export type CommandReceipt<E = never> = Promise<
  | {
      ok: true;
      cursor?: number;
    }
  | {
      ok: false;
      error: E extends string ? E : E extends [infer Code, unknown] ? Code : never;
      data?: E extends [string, infer Data] ? Data : never;
    }
>;
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
          ...args: Spec["Resources"][K]["Commands"][CK] extends CommandSpec
            ? Spec["Resources"][K]["Commands"][CK]["args"]
            : Spec["Resources"][K]["Commands"][CK] extends unknown[]
              ? Spec["Resources"][K]["Commands"][CK]
              : []
        ) => CommandReceipt<
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
      }
    : never;
};
export type ResolvedAppDef<Spec extends AppSpec> = Omit<AppDef<Spec>, "identify"> & {
  identify: (opts: { token: string }) => ActorOf<Spec> | null;
};
export type TypedAppDefinition<Spec extends AppSpec> = {
  readonly __poggersAppSpec?: Spec;
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
  ) => {
    name: string;
    payload: unknown;
    version: number;
    hash?: string;
  };
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
    snap: {
      version: number;
      data: unknown;
      hash?: string;
    },
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
    onSetPresence: (patch: unknown) => void,
    onError: (error: string, data?: unknown) => void,
  ) => void;
};
type ResourcesOf<A> =
  A extends App<infer S>
    ? S extends AppSpec & {
        Resources: infer R;
      }
      ? R
      : never
    : never;
type TargetResourceState<Spec extends AppSpec, Resource> = Resource extends keyof Spec["Resources"]
  ? Spec["Resources"][Resource] extends {
      State: infer State;
    }
    ? State
    : never
  : never;
type TargetResourceEvent<Spec extends AppSpec, Resource> = Resource extends keyof Spec["Resources"]
  ? Spec["Resources"][Resource] extends {
      Events: infer Events;
    }
    ? {
        [Event in keyof Events & string]: {
          name: Event;
          payload: Events[Event];
        };
      }[keyof Events & string]
    : never
  : never;
type MigrateDef<Spec extends AppSpec, Prev> = {
  previous: Prev;
  migrate?: {
    state?: {
      [R in keyof ResourcesOf<Prev>]?: (
        data: ResourcesOf<Prev>[R] extends {
          State: infer S;
        }
          ? S
          : never,
      ) => TargetResourceState<Spec, R>;
    };
    event?: {
      [R in keyof ResourcesOf<Prev>]?: <
        E extends keyof (ResourcesOf<Prev>[R] extends {
          Events: infer EV;
        }
          ? EV
          : never) &
          string,
      >(
        name: E,
        payload: ResourcesOf<Prev>[R] extends {
          Events: infer EV;
        }
          ? EV[E & keyof EV]
          : never,
      ) =>
        | TargetResourceEvent<Spec, R>
        | {
            name: string;
            payload: unknown;
          };
    };
  };
};
export declare function defineApp<Spec extends AppSpec>(def: TypedAppDefinition<Spec>): App<Spec>;
export declare function defineApp<Spec extends AppSpec, Prev = never>(
  def: AppDef<Spec> & ([Prev] extends [never] ? {} : MigrateDef<Spec, Prev>),
): App<Spec>;
export declare function installAppMigrations<Spec extends AppSpec>(
  app: App<Spec>,
  options: {
    hash?: string;
    migrations?: readonly RuntimeMigrationEdge[];
  },
): App<Spec>;
export {};
