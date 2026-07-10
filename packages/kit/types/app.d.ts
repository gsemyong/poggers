import type { JsonValue, SessionData } from "./protocol";
import type { PresetName, PresetThemeName } from "../src/preset";
export type LocalActor = {
  id: string;
};
export type AppSpec = {
  Actor?: {
    id: string;
  };
  Resources: Record<string, any>;
  Deps?: any;
  Environments?: Record<
    string,
    {
      Deps?: any;
    }
  >;
  Navigation?: Record<string, Record<string, any>>;
  Components?: Record<
    string,
    {
      Input?: Record<string, any>;
      Variants?: Record<string, any>;
      State?: Record<string, any>;
      Derived?: Record<string, any>;
      Actions?: Record<string, (...args: any[]) => any>;
      StyleValues?: Record<string, string>;
      Shared?: string;
      Parts: Record<string, string>;
    }
  >;
  Styles?: {
    Presets?: string | Record<string, any>;
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
  State: any;
  Presence?: any;
  Events: Record<string, any>;
  Views: Record<string, any>;
  Commands: Record<string, any>;
};
export type CommandSpec = {
  args: any[];
  event?: string;
  error?: string | [string, any];
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
        Deps: any;
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
    : Record<string, never>;
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
    ? Navigation[Screen] extends Record<string, any>
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
      : ResourceFor<Spec, Resource>["Commands"][Command] extends any[]
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
export type AppUIContext<Spec extends AppSpec> = SemanticUIHooks<Spec> & {
  readonly screen: UISignal<AppScreen<Spec>>;
  readonly nav: AppNavigation<Spec>;
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
  Components: infer Components extends Record<string, any>;
}
  ? Components
  : Record<string, never>;
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
    Input: infer Input extends Record<string, any>;
  }
    ? Input
    : Record<never, never>;
export type ComponentState<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    State: infer State extends Record<string, any>;
  }
    ? State
    : Record<never, never>;
export type ComponentDerived<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Derived: infer Derived extends Record<string, any>;
  }
    ? Derived
    : Record<never, never>;
export type ComponentActions<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Actions: infer Actions extends Record<string, (...args: any[]) => any>;
  }
    ? Actions
    : Record<never, never>;
export type ComponentStyleValueKind =
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "zIndex"
  | "length"
  | "space"
  | "size"
  | "radius";
type ComponentStyleValueFor<Kind extends string> = Kind extends
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "zIndex"
  ? number
  : Kind extends "length" | "space" | "size" | "radius"
    ? number
    : never;
export type ComponentStyleValues<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    StyleValues: infer Values extends Record<string, string>;
  }
    ? {
        [Value in keyof Values]: ComponentStyleValueFor<Values[Value] & string>;
      }
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
export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => any ? Args : [];
type ComponentControllerEvent<T extends EventTarget, E extends Event> = {
  bivarianceHack(
    event: E & {
      readonly currentTarget: T;
    },
  ): void;
}["bivarianceHack"];
type ComponentControllerChild =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | ComponentControllerChild[]
  | (() => ComponentControllerChild);
type ComponentControllerValue<T> = T | null | undefined;
type ComponentControllerPopoverValue = "auto" | "hint" | "manual" | boolean;
type ComponentControllerPopoverTargetAction = "hide" | "show" | "toggle";
type ComponentControllerPopoverToggleEvent = Event & {
  readonly newState: "closed" | "open";
  readonly oldState: "closed" | "open";
};
type ComponentControllerDataAttributes = {
  [Key in `data-${string}`]?: ComponentControllerValue<string | number | boolean>;
};
type ComponentControllerAriaAttributes = {
  [Key in `aria-${string}`]?: ComponentControllerValue<string | number | boolean>;
};
type ComponentControllerPopoverTargetProps = {
  popovertarget?: ComponentControllerValue<string>;
  popovertargetaction?: ComponentControllerValue<ComponentControllerPopoverTargetAction>;
  popoverTarget?: ComponentControllerValue<string>;
  popoverTargetAction?: ComponentControllerValue<ComponentControllerPopoverTargetAction>;
};
type ComponentControllerCommonProps<T extends Element> = ComponentControllerDataAttributes &
  ComponentControllerAriaAttributes & {
    id?: string;
    children?: ComponentControllerChild;
    hidden?: boolean;
    popover?: ComponentControllerPopoverValue;
    role?: string;
    tabIndex?: number;
    tabindex?: number;
    title?: string;
    onBeforeToggle?: ComponentControllerEvent<T, ComponentControllerPopoverToggleEvent>;
    onCancel?: ComponentControllerEvent<T, Event>;
    onClick?: ComponentControllerEvent<T, MouseEvent>;
    onClose?: ComponentControllerEvent<T, Event>;
    onInput?: ComponentControllerEvent<T, InputEvent>;
    onSubmit?: ComponentControllerEvent<T, SubmitEvent>;
    onToggle?: ComponentControllerEvent<T, ComponentControllerPopoverToggleEvent>;
    onKeyDown?: ComponentControllerEvent<T, KeyboardEvent>;
    onKeyUp?: ComponentControllerEvent<T, KeyboardEvent>;
    onFocus?: ComponentControllerEvent<T, FocusEvent>;
    onBlur?: ComponentControllerEvent<T, FocusEvent>;
    onGotPointerCapture?: ComponentControllerEvent<T, PointerEvent>;
    onLostPointerCapture?: ComponentControllerEvent<T, PointerEvent>;
    onPointerDown?: ComponentControllerEvent<T, PointerEvent>;
    onPointerEnter?: ComponentControllerEvent<T, PointerEvent>;
    onPointerMove?: ComponentControllerEvent<T, PointerEvent>;
    onPointerOut?: ComponentControllerEvent<T, PointerEvent>;
    onPointerOver?: ComponentControllerEvent<T, PointerEvent>;
    onPointerUp?: ComponentControllerEvent<T, PointerEvent>;
    onPointerCancel?: ComponentControllerEvent<T, PointerEvent>;
    onPointerLeave?: ComponentControllerEvent<T, PointerEvent>;
  };
type ComponentPartBindingForElement<ElementName extends string> = ElementName extends "button"
  ? ComponentControllerCommonProps<HTMLButtonElement> & {
      disabled?: boolean;
      name?: string;
      value?: string | number;
      type?: "button" | "submit" | "reset";
    } & ComponentControllerPopoverTargetProps
  : ElementName extends "input"
    ? ComponentControllerCommonProps<HTMLInputElement> & {
        checked?: boolean;
        disabled?: boolean;
        max?: number;
        min?: number;
        name?: string;
        placeholder?: string;
        step?: number;
        type?: string;
        value?: string | number | readonly string[];
      } & ComponentControllerPopoverTargetProps
    : ElementName extends "textarea"
      ? ComponentControllerCommonProps<HTMLTextAreaElement> & {
          disabled?: boolean;
          placeholder?: string;
          rows?: number;
          value?: string | number;
        }
      : ElementName extends "select"
        ? ComponentControllerCommonProps<HTMLSelectElement> & {
            disabled?: boolean;
            multiple?: boolean;
            value?: string | number | readonly string[];
          }
        : ElementName extends "dialog"
          ? ComponentControllerCommonProps<HTMLDialogElement> & {
              dialogOpen?: boolean;
            }
          : ElementName extends "img"
            ? ComponentControllerCommonProps<HTMLImageElement> & {
                alt?: string;
                height?: string | number;
                loading?: "eager" | "lazy";
                src?: string;
                width?: string | number;
              }
            : ElementName extends "a"
              ? ComponentControllerCommonProps<HTMLAnchorElement> & {
                  href?: string;
                  target?: string;
                }
              : ElementName extends keyof HTMLElementTagNameMap
                ? ComponentControllerCommonProps<HTMLElementTagNameMap[ElementName]>
                : ElementName extends keyof SVGElementTagNameMap
                  ? ComponentControllerCommonProps<SVGElementTagNameMap[ElementName]>
                  : Record<string, unknown>;
export type ComponentPartBinding<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentPartBindingForElement<ComponentPartElement<Spec, Component, Part>>;
export type ComponentControllerContext<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly preset: PresetName<Spec>;
  readonly setPreset: (preset: PresetName<Spec>) => void;
  readonly theme: PresetThemeName<Spec>;
  readonly setTheme: (theme: PresetThemeName<Spec>) => void;
  readonly input: ComponentInput<Spec, Component>;
  readonly variants: ComponentVariants<Spec, Component>;
  readonly state: ComponentState<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly actions: ComponentActionHandlers<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};
export type ComponentVariants<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Variants: infer Variants extends Record<string, any>;
  }
    ? Variants
    : Record<never, never>;
export type ComponentRefs<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Part in ComponentPartName<Spec, Component>]?: Element | null;
};
export type ComponentActionHandlers<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
};
export type ComponentControllerResult<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  values?: Partial<ComponentStyleValues<Spec, Component>>;
} & Partial<{
  [Part in ComponentPartName<Spec, Component>]: Partial<
    ComponentPartBinding<Spec, Component, Part>
  >;
}>;
export type ComponentStateContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly input: ComponentInput<Spec, Component>;
  readonly variants: ComponentVariants<Spec, Component>;
};
export type ComponentDerivedContext<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentStateContext<Spec, Component> & {
  readonly preset: PresetName<Spec>;
  readonly setPreset: (preset: PresetName<Spec>) => void;
  readonly theme: PresetThemeName<Spec>;
  readonly setTheme: (theme: PresetThemeName<Spec>) => void;
  readonly state: ComponentState<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};
export type ComponentActionContext<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentDerivedContext<Spec, Component> & {
  readonly preset: PresetName<Spec>;
  readonly setPreset: (preset: PresetName<Spec>) => void;
  readonly derived: ComponentDerived<Spec, Component>;
};
type ComponentStateDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  keyof ComponentState<Spec, Component>,
] extends [never]
  ? {
      state?:
        | ComponentState<Spec, Component>
        | ((ctx: ComponentStateContext<Spec, Component>) => ComponentState<Spec, Component>);
    }
  : {
      state:
        | ComponentState<Spec, Component>
        | ((ctx: ComponentStateContext<Spec, Component>) => ComponentState<Spec, Component>);
    };
type ComponentDerivedDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  keyof ComponentDerived<Spec, Component>,
] extends [never]
  ? {
      derived?: (
        ctx: ComponentDerivedContext<Spec, Component>,
      ) => ComponentDerived<Spec, Component>;
    }
  : {
      derived: (ctx: ComponentDerivedContext<Spec, Component>) => ComponentDerived<Spec, Component>;
    };
type ComponentActionsDefinition<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  keyof ComponentActions<Spec, Component>,
] extends [never]
  ? {
      actions?: (
        ctx: ComponentActionContext<Spec, Component>,
      ) => ComponentActionHandlers<Spec, Component>;
    }
  : {
      actions: (
        ctx: ComponentActionContext<Spec, Component>,
      ) => ComponentActionHandlers<Spec, Component>;
    };
export type ComponentDefinition<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentStateDefinition<Spec, Component> &
  ComponentDerivedDefinition<Spec, Component> &
  ComponentActionsDefinition<Spec, Component> & {
    bind?: (
      ctx: ComponentControllerContext<Spec, Component>,
    ) => ComponentControllerResult<Spec, Component>;
    setup?: (ctx: ComponentControllerContext<Spec, Component>) => void | (() => void);
  };
export type ComponentControllers<Spec extends AppSpec> = Partial<{
  [Component in ComponentName<Spec>]:
    | ((
        ctx: ComponentControllerContext<Spec, Component>,
      ) => ComponentControllerResult<Spec, Component>)
    | ComponentDefinition<Spec, Component>;
}>;
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
        : R["Commands"][K] extends any[]
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
  components?: ComponentControllers<Spec>;
  styles?: unknown;
  root?: (ctx: AppUIContext<Spec>) => unknown;
  ui?: (ctx: AppUIContext<Spec>) => unknown;
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
      readonly state?: (state: any) => any;
      readonly event?: (name: string, payload: any) => { name: string; payload: any };
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
  error: ErrorFor<Cmd> extends string | [string, any]
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
      error: E extends string ? E : E extends [infer Code, any] ? Code : never;
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
            : Spec["Resources"][K]["Commands"][CK] extends any[]
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
export type App<Spec extends AppSpec> = {
  def: ResolvedAppDef<Spec>;
  previous?: App<any>;
  createState: (resource: string) => any;
  applyEvent: (
    resource: string,
    state: any,
    event: {
      id: string;
      seq: number;
      at: number;
      actor: ActorOf<Spec>;
      name: string;
      payload: any;
      hash?: string;
    },
    eventVersion?: number,
    eventHash?: string,
  ) => void;
  upcastEvent: (
    resource: string,
    event: {
      name: string;
      payload: any;
      hash?: string;
    },
    eventVersion?: number,
    eventHash?: string,
  ) => {
    name: string;
    payload: any;
    version: number;
    hash?: string;
  };
  snapshot: (
    state: any,
    seq: number,
  ) => {
    version: number;
    seq: number;
    data: unknown;
    hash?: string;
  };
  restore: (
    resource: string,
    snap: {
      version: number;
      data: unknown;
      hash?: string;
    },
  ) => any;
  runCommand: (
    resource: string,
    state: any,
    actor: ActorOf<Spec>,
    key: any,
    name: string,
    args: any[],
    onEvent: (event: {
      id: string;
      seq: number;
      at: number;
      actor: ActorOf<Spec>;
      name: string;
      payload: any;
    }) => void,
    onSetPresence: (patch: any) => void,
    onError: (error: string, data?: any) => void,
  ) => void;
};
export declare function installAppMigrations<Spec extends AppSpec>(
  app: App<Spec>,
  options: {
    hash?: string;
    migrations?: readonly RuntimeMigrationEdge[];
  },
): App<Spec>;
type ResourcesOf<A> =
  A extends App<infer S>
    ? S extends AppSpec & {
        Resources: infer R;
      }
      ? R
      : never
    : never;
type MigrateDef<Prev extends App<any>> = {
  previous: Prev;
  migrate?: {
    state?: {
      [R in keyof ResourcesOf<Prev>]?: (
        data: ResourcesOf<Prev>[R] extends {
          State: infer S;
        }
          ? S
          : never,
      ) => any;
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
      ) => {
        name: string;
        payload: any;
      };
    };
  };
};
export declare function defineApp<Spec extends AppSpec>(def: TypedAppDefinition<Spec>): App<Spec>;
export declare function defineApp<Spec extends AppSpec, Prev extends App<any> = never>(
  def: AppDef<Spec> & ([Prev] extends [never] ? {} : MigrateDef<Prev>),
): App<Spec>;
export {};
