import type {
  App,
  AppNavigation,
  AppScreen,
  AppSpec,
  ResourceFor,
  ResourceName,
  UISignal,
} from "./app";
import type { ConnectOpts } from "./client";
import type { HTMLAttributes, SVGAttributes } from "./jsx-types";
import {
  computed,
  createNativeAppRuntime,
  jsx,
  runtimeSignal,
  signal,
  type Child,
  type NativeResource,
  type Props,
  type Signal,
} from "./ui";

type HookName<Name extends string> = `use${Capitalize<Name>}`;
type CreateName<Name extends string> = `create${Capitalize<Name>}`;

type ComponentsOf<Spec extends AppSpec> = Spec extends {
  Components: infer Components extends Record<string, any>;
}
  ? Components
  : Record<string, never>;

type StylesOf<Spec extends AppSpec> = Spec extends {
  Styles: infer Styles extends Record<string, any>;
}
  ? Styles
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
    Actions: infer Actions extends Record<string, any>;
  }
    ? Actions
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

export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => any
  ? Args
  : Action extends readonly [...infer Args]
    ? Args
    : [];

type HasNoKeys<T extends Record<string, any>> = keyof T extends never ? true : false;

export type ComponentStateObject<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [State in keyof ComponentState<Spec, Component>]: ComponentState<Spec, Component>[State];
};

export type ComponentRefs<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Part in ComponentPartName<Spec, Component>]?: Element | null;
};

export type ComponentInstanceContext<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly preset: PresetName<Spec>;
  readonly theme: ThemeValues<Spec>;
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentStateObject<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};

export type ComponentInstanceActionHandlers<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
};

export type ComponentInstanceActionFactory<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (
  ctx: ComponentInstanceContext<Spec, Component>,
) => ComponentInstanceActionHandlers<Spec, Component>;

export type ComponentInstanceDerivedFactory<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (
  ctx: Omit<ComponentInstanceContext<Spec, Component>, "derived">,
) => ComponentDerived<Spec, Component>;

export type ComponentPartBindingForElement<ElementName extends string> =
  ElementName extends keyof HTMLElementTagNameMap
    ? HTMLAttributes<ElementName>
    : ElementName extends keyof SVGElementTagNameMap
      ? SVGAttributes<SVGElementTagNameMap[ElementName]>
      : ElementName extends `${string}-${string}`
        ? Record<string, unknown>
        : Record<string, unknown>;

export type ComponentPartBinding<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentPartBindingForElement<ComponentPartElement<Spec, Component, Part>> & {
  readonly "data-pg-component": Component;
  readonly "data-pg-part": Part;
};

export type ComponentPartComponent<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = (
  props?: Partial<ComponentPartBinding<Spec, Component, Part>> & {
    children?: Child;
  },
) => Child;

export type ComponentInstanceInput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (HasNoKeys<ComponentInput<Spec, Component>> extends true
  ? { input?: ComponentInput<Spec, Component> }
  : { input: ComponentInput<Spec, Component> }) &
  (HasNoKeys<ComponentState<Spec, Component>> extends true
    ? { state?: ComponentState<Spec, Component> }
    : { state: ComponentState<Spec, Component> }) &
  (HasNoKeys<ComponentActions<Spec, Component>> extends true
    ? { actions?: ComponentInstanceActionFactory<Spec, Component> }
    : { actions: ComponentInstanceActionFactory<Spec, Component> }) &
  (HasNoKeys<ComponentDerived<Spec, Component>> extends true
    ? { derived?: ComponentInstanceDerivedFactory<Spec, Component> }
    : { derived: ComponentInstanceDerivedFactory<Spec, Component> });

type ComponentInstanceNeedsInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentInput<Spec, Component>> extends true
    ? HasNoKeys<ComponentState<Spec, Component>> extends true
      ? HasNoKeys<ComponentActions<Spec, Component>> extends true
        ? HasNoKeys<ComponentDerived<Spec, Component>> extends true
          ? false
          : true
        : true
      : true
    : true;

export type ComponentInstanceResult<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Derived in keyof ComponentDerived<Spec, Component>]: ComponentDerived<
    Spec,
    Component
  >[Derived];
} & {
  readonly [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
} & {
  readonly [Part in ComponentPartName<Spec, Component>]: ComponentPartComponent<
    Spec,
    Component,
    Part
  >;
} & {
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentStateObject<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly actions: ComponentInstanceActionHandlers<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};

export type ComponentRuntimeParts<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: Record<string, string>;
};

export type ComponentFactoryHooks<Spec extends AppSpec> = {
  [Component in ComponentName<Spec> as CreateName<Component>]: ComponentInstanceNeedsInput<
    Spec,
    Component
  > extends true
    ? (input: ComponentInstanceInput<Spec, Component>) => ComponentInstanceResult<Spec, Component>
    : (input?: ComponentInstanceInput<Spec, Component>) => ComponentInstanceResult<Spec, Component>;
};

export type ApiHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
} & {
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
  readonly screen: UISignal<AppScreen<Spec>>;
  readonly nav: AppNavigation<Spec>;
  useScreen(): AppScreen<Spec>;
};

export type PresetName<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Presets: infer Presets extends string;
  }
    ? Presets
    : "default";

type ThemeParamsOf<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Theme: {
      Params: infer Params extends Record<string, any>;
    };
  }
    ? Params
    : Record<string, never>;

export type ThemeParamName<Spec extends AppSpec> = Extract<keyof ThemeParamsOf<Spec>, string>;

type WidenPrimitive<Value> = Value extends number
  ? number
  : Value extends string
    ? string
    : Value extends boolean
      ? boolean
      : Value;

export type ThemeParamValue<
  Spec extends AppSpec,
  Param extends ThemeParamName<Spec>,
> = ThemeParamsOf<Spec>[Param] extends {
  default: infer Default extends number | string | boolean;
}
  ? WidenPrimitive<Default>
  : ThemeParamsOf<Spec>[Param] extends number | string | boolean
    ? WidenPrimitive<ThemeParamsOf<Spec>[Param]>
    : number;

export type ThemeValues<Spec extends AppSpec> = {
  readonly [Param in ThemeParamName<Spec>]: ThemeParamValue<Spec, Param>;
};

export type StyleContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly preset: PresetName<Spec>;
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentState<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly theme: ThemeValues<Spec>;
};

export type SemanticStyleOutput = Record<string, unknown>;

export type StyleSlotDef<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  | SemanticStyleOutput
  | ((ctx: StyleContext<Spec, Component>) => SemanticStyleOutput);

export type StylePresetDef<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: {
    [Part in ComponentPartName<Spec, Component>]?: StyleSlotDef<Spec, Component>;
  };
};

export type StylesDef<Spec extends AppSpec> = {
  defaultPreset?: PresetName<Spec>;
  presets: {
    [Preset in PresetName<Spec>]?: StylePresetDef<Spec>;
  };
};

export type Styles<Spec extends AppSpec> = {
  readonly def: StylesDef<Spec>;
};

export type StyleControls<Spec extends AppSpec> = {
  readonly preset: Signal<PresetName<Spec>>;
  usePreset(): PresetName<Spec>;
  setPreset(preset: PresetName<Spec>): void;
  useTheme(): ThemeValues<Spec>;
  setThemeParam<Param extends ThemeParamName<Spec>>(
    param: Param,
    value: ThemeParamValue<Spec, Param>,
  ): void;
};

export type AppHooks<Spec extends AppSpec> = ApiHooks<Spec> &
  ComponentFactoryHooks<Spec> &
  StyleControls<Spec> & {
    start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
  };

export type CreateHooksOpts<Spec extends AppSpec> = {
  app: App<Spec>;
  styles: Styles<Spec>;
  components?: ComponentRuntimeParts<Spec>;
};

type RuntimeComponentParts = Record<string, Record<string, string>>;

type RuntimeHookInput = {
  input?: Record<string, unknown>;
  state?: Record<string, unknown>;
  actions?: (ctx: RuntimeComponentInstanceContext) => Record<string, (...args: any[]) => void>;
  derived?: (ctx: Omit<RuntimeComponentInstanceContext, "derived">) => Record<string, unknown>;
};

type RuntimeComponentInstanceContext = {
  readonly preset: string;
  readonly theme: Record<string, unknown>;
  readonly input: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly derived: Record<string, unknown>;
  readonly refs: Record<string, Element | null>;
};

type RuntimeComponentControllerContext = RuntimeComponentInstanceContext & {
  readonly actions: Record<string, (...args: any[]) => void>;
};

export function defineStyles<Spec extends AppSpec>(def: StylesDef<Spec>): Styles<Spec> {
  return { def };
}

export function createHooks<Spec extends AppSpec>({
  app,
  styles,
  components,
}: CreateHooksOpts<Spec>): AppHooks<Spec> {
  const runtime = createNativeAppRuntime(app);
  const defaultPreset = firstPreset(styles) as PresetName<Spec>;
  const preset = runtimeSignal(defaultPreset);
  const theme = runtimeSignal(createInitialTheme<Spec>());
  const runtimeParts = normalizeRuntimeParts(components);
  const hooks: Record<string, unknown> = {
    ...(runtime.api as Record<string, unknown>),
    preset,
    usePreset() {
      return preset();
    },
    setPreset(nextPreset: PresetName<Spec>) {
      if (!(String(nextPreset) in styles.def.presets)) {
        throw new Error(`Unknown Poggers preset "${String(nextPreset)}".`);
      }
      preset(nextPreset);
      updateRootPreset(nextPreset);
    },
    useTheme() {
      return theme();
    },
    setThemeParam(param: string, value: unknown) {
      theme({ ...theme(), [param]: value });
      updateRootThemeParam(param, value);
    },
    start: runtime.start,
  };

  for (const componentName of collectComponentNames(app, styles, runtimeParts)) {
    hooks[`create${capitalize(componentName)}`] = (input: RuntimeHookInput = {}) =>
      createComponentInstance(componentName, {
        app,
        preset,
        theme,
        parts: runtimeParts[componentName] ?? {},
        input,
      });
  }

  return hooks as AppHooks<Spec>;
}

function createComponentInstance(
  componentName: string,
  options: {
    app: App<any>;
    preset: () => string;
    theme: () => Record<string, unknown>;
    parts: Record<string, string>;
    input: RuntimeHookInput;
  },
) {
  const input = options.input.input ?? {};
  const signals = Object.create(null) as Record<string, Signal<unknown>>;
  const refs = Object.create(null) as Record<string, Element | null>;
  const state = createStateObject(signals);

  for (const [name, value] of Object.entries(options.input.state ?? {})) {
    signals[name] = signal(value);
  }

  const derivedSignals = Object.create(null) as Record<string, () => unknown>;
  const derived = Object.create(null) as Record<string, unknown>;
  const baseContext = {
    get preset() {
      return options.preset();
    },
    get theme() {
      return options.theme();
    },
    input,
    state,
    refs,
  };
  const derivedSource = options.input.derived?.(baseContext as never) ?? {};
  const derivedDescriptors = Object.getOwnPropertyDescriptors(derivedSource);

  for (const [name, descriptor] of Object.entries(derivedDescriptors)) {
    const getter =
      typeof descriptor.get === "function"
        ? () => descriptor.get!.call(derived)
        : typeof descriptor.value === "function"
          ? () => descriptor.value.call(derived)
          : () => descriptor.value;
    const value = computed(getter);
    derivedSignals[name] = value;
    Object.defineProperty(derived, name, {
      enumerable: true,
      get() {
        return value();
      },
    });
  }

  const instanceContext: RuntimeComponentInstanceContext = {
    ...baseContext,
    derived,
  };
  const actions = Object.create(null) as Record<string, (...args: any[]) => void>;
  const actionSource = options.input.actions?.(instanceContext) ?? {};
  for (const [name, handler] of Object.entries(actionSource)) {
    actions[name] = (...args: any[]) => handler(...args);
  }

  const controllerContext: RuntimeComponentControllerContext = {
    ...instanceContext,
    actions,
  };
  const controller = options.app.def.components?.[componentName];
  const readControllerPart = (partName: string) => {
    if (typeof controller !== "function") return {};
    return asRecord(controller(controllerContext))[partName];
  };
  const target = Object.create(null) as Record<string, unknown>;

  target.input = input;
  target.state = state;
  target.derived = derived;
  target.actions = actions;
  target.refs = refs;

  for (const name of Object.keys(derivedDescriptors)) {
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        return derived[name];
      },
    });
  }

  for (const [name, handler] of Object.entries(actions)) {
    target[name] = handler;
  }

  for (const [partName, elementName] of Object.entries(options.parts)) {
    target[partName] = createComponentPartComponent(componentName, partName, elementName, {
      refs,
      input,
      state,
      derived,
      preset: options.preset,
      controller: () => readControllerPart(partName),
    });
  }

  return target;
}

function createStateObject(signals: Record<string, Signal<unknown>>): Record<string, unknown> {
  return new Proxy(Object.create(null), {
    get(_target, prop: string) {
      if (typeof prop !== "string") return undefined;
      return signals[prop]?.();
    },
    set(_target, prop: string, value: unknown) {
      if (typeof prop !== "string") return false;
      const existing = signals[prop];
      if (existing) {
        existing(value);
      } else {
        signals[prop] = signal(value);
      }
      return true;
    },
    ownKeys() {
      return Reflect.ownKeys(signals);
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (prop in signals) return { enumerable: true, configurable: true };
      return undefined;
    },
  });
}

function createComponentPartComponent(
  componentName: string,
  partName: string,
  elementName: string,
  options: {
    refs: Record<string, Element | null>;
    input: Record<string, unknown>;
    state: Record<string, unknown>;
    derived: Record<string, unknown>;
    preset: () => string;
    controller: () => unknown;
  },
) {
  return (props: Props = {}) => {
    const base = createBasePartProps(
      componentName,
      partName,
      options.preset,
      options.input,
      options.state,
      options.derived,
      options.refs,
    );
    const controllerProps = createReactiveControllerProps(options.controller);
    return jsx(elementName, mergeProps(base, controllerProps, props));
  };
}

function createReactiveControllerProps(readController: () => unknown): Record<string, unknown> {
  const read = () => asRecord(readController());
  const initial = asRecord(read());
  const props: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(initial)) {
    if (typeof value === "function") {
      props[name] = value;
    } else {
      props[name] = () => read()[name];
    }
  }

  return props;
}

function createBasePartProps(
  componentName: string,
  partName: string,
  preset: () => string,
  input: Record<string, unknown>,
  state: Record<string, unknown>,
  derived: Record<string, unknown>,
  refs: Record<string, Element | null>,
): Props {
  const className = `pg-${kebab(componentName)}__${kebab(partName)}`;
  const props: Record<string, unknown> = {
    "data-pg-component": componentName,
    "data-pg-part": partName,
    "data-pg-preset": preset,
    class: className,
    ref(element: Element) {
      refs[partName] = element;
    },
  };

  for (const [name, value] of Object.entries(input)) {
    props[`data-pg-input-${kebab(name)}`] = value;
  }
  for (const name of Object.keys(state)) {
    props[`data-pg-state-${kebab(name)}`] = () => state[name];
  }
  for (const name of Object.keys(derived)) {
    props[`data-pg-derived-${kebab(name)}`] = () => derived[name];
  }

  return props;
}

function mergeProps(...sources: Array<Record<string, unknown> | Props>): Props {
  const merged: Record<string, unknown> = {};

  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      const existing = merged[name];
      if ((name === "class" || name === "className") && existing) {
        merged[name] = mergeClassValue(existing, value);
      } else if (name === "ref" && typeof existing === "function" && typeof value === "function") {
        merged[name] = (element: Element) => {
          (existing as (element: Element) => void)(element);
          value(element);
        };
      } else if (
        name.startsWith("on") &&
        typeof existing === "function" &&
        typeof value === "function"
      ) {
        merged[name] = (event: Event) => {
          (existing as (event: Event) => void)(event);
          value(event);
        };
      } else {
        merged[name] = value;
      }
    }
  }

  return merged as Props;
}

function normalizeRuntimeParts<Spec extends AppSpec>(
  components?: ComponentRuntimeParts<Spec>,
): RuntimeComponentParts {
  const result: RuntimeComponentParts = {};
  for (const [componentName, parts] of Object.entries(components ?? {})) {
    result[componentName] = {};
    for (const [partName, elementName] of Object.entries(parts ?? {})) {
      if (typeof elementName === "string") result[componentName]![partName] = elementName;
    }
  }
  return result;
}

function collectComponentNames<Spec extends AppSpec>(
  app: App<Spec>,
  styles: Styles<Spec>,
  parts: RuntimeComponentParts,
): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(parts)) names.add(name);
  for (const name of Object.keys(app.def.components ?? {})) names.add(name);
  for (const preset of Object.values(styles.def.presets) as StylePresetDef<Spec>[]) {
    for (const name of Object.keys(preset ?? {})) names.add(name);
  }
  return [...names];
}

function firstPreset<Spec extends AppSpec>(styles: Styles<Spec>): string {
  const explicit = styles.def.defaultPreset;
  if (explicit) return String(explicit);
  return Object.keys(styles.def.presets)[0] ?? "default";
}

function createInitialTheme<Spec extends AppSpec>(): ThemeValues<Spec> {
  return {} as ThemeValues<Spec>;
}

function updateRootPreset(preset: string) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.poggersPreset = String(preset);
}

function updateRootThemeParam(param: string, value: unknown) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(`--pg-${kebab(param)}`, String(value));
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function mergeClassValue(left: unknown, right: unknown): () => string {
  return () => {
    const leftValue = typeof left === "function" ? (left as () => unknown)() : left;
    const rightValue = typeof right === "function" ? (right as () => unknown)() : right;
    return [leftValue, rightValue].filter(Boolean).join(" ");
  };
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
