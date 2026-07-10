import {
  defineApp,
  type App,
  type AppDef,
  type AppNavigation,
  type AppScreen,
  type AppSpec,
  type ResourceFor,
  type ResourceName,
  type TypedAppDefinition,
  type UISignal,
} from "./app";
import type { ConnectOpts } from "./client";
import {
  createVisualCoordinator,
  isCompiledVisualPreset,
  visualPartAttributes,
  type CompiledVisuals,
} from "./visual-runtime";
import {
  computed,
  createNativeAppRuntime,
  effect,
  isHotRefresh,
  jsx,
  onMount,
  reactiveValue,
  signal,
  untrack,
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

export type ComponentVariants<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Variants: infer Variants extends Record<string, any>;
  }
    ? Variants
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

export type ComponentInstanceActionHandlers<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
};

type ComponentPartValue<T> = T | null | undefined;

type ComponentPartEvent<T extends EventTarget, E extends Event> = {
  bivarianceHack(event: E & { readonly currentTarget: T }): void;
}["bivarianceHack"];

type ComponentPartDataAttributes = {
  [Key in `data-${string}`]?: ComponentPartValue<string | number | boolean>;
};

type ComponentPartAriaAttributes = {
  [Key in `aria-${string}`]?: ComponentPartValue<string | number | boolean>;
};

type ComponentPartPopoverValue = "auto" | "hint" | "manual" | boolean;
type ComponentPartPopoverTargetAction = "hide" | "show" | "toggle";
type ComponentPartPopoverToggleEvent = Event & {
  readonly newState: "closed" | "open";
  readonly oldState: "closed" | "open";
};
type ComponentPartPopoverTargetProps = {
  popovertarget?: ComponentPartValue<string>;
  popovertargetaction?: ComponentPartValue<ComponentPartPopoverTargetAction>;
  popoverTarget?: ComponentPartValue<string>;
  popoverTargetAction?: ComponentPartValue<ComponentPartPopoverTargetAction>;
};

type ComponentPartCommonProps<T extends Element> = ComponentPartDataAttributes &
  ComponentPartAriaAttributes & {
    class?: ComponentPartValue<string | false>;
    className?: ComponentPartValue<string | false>;
    id?: ComponentPartValue<string>;
    hidden?: ComponentPartValue<boolean | "hidden" | "until-found">;
    popover?: ComponentPartValue<ComponentPartPopoverValue>;
    role?: ComponentPartValue<string>;
    tabIndex?: ComponentPartValue<number>;
    tabindex?: ComponentPartValue<number>;
    title?: ComponentPartValue<string>;
    children?: Child;
    ref?: (element: T) => void;
    onBeforeToggle?: ComponentPartEvent<T, ComponentPartPopoverToggleEvent>;
    onBlur?: ComponentPartEvent<T, FocusEvent>;
    onChange?: ComponentPartEvent<T, Event>;
    onClick?: ComponentPartEvent<T, MouseEvent>;
    onFocus?: ComponentPartEvent<T, FocusEvent>;
    onInput?: ComponentPartEvent<T, InputEvent>;
    onKeyDown?: ComponentPartEvent<T, KeyboardEvent>;
    onKeyUp?: ComponentPartEvent<T, KeyboardEvent>;
    onMouseDown?: ComponentPartEvent<T, MouseEvent>;
    onMouseUp?: ComponentPartEvent<T, MouseEvent>;
    onGotPointerCapture?: ComponentPartEvent<T, PointerEvent>;
    onLostPointerCapture?: ComponentPartEvent<T, PointerEvent>;
    onPointerCancel?: ComponentPartEvent<T, PointerEvent>;
    onPointerDown?: ComponentPartEvent<T, PointerEvent>;
    onPointerEnter?: ComponentPartEvent<T, PointerEvent>;
    onPointerLeave?: ComponentPartEvent<T, PointerEvent>;
    onPointerMove?: ComponentPartEvent<T, PointerEvent>;
    onPointerOut?: ComponentPartEvent<T, PointerEvent>;
    onPointerOver?: ComponentPartEvent<T, PointerEvent>;
    onPointerUp?: ComponentPartEvent<T, PointerEvent>;
    onSubmit?: ComponentPartEvent<T, SubmitEvent>;
    onToggle?: ComponentPartEvent<T, ComponentPartPopoverToggleEvent>;
  };

type ComponentPartSvgProps = {
  cx?: ComponentPartValue<string | number>;
  cy?: ComponentPartValue<string | number>;
  d?: ComponentPartValue<string>;
  fill?: ComponentPartValue<string>;
  height?: ComponentPartValue<string | number>;
  r?: ComponentPartValue<string | number>;
  stroke?: ComponentPartValue<string>;
  strokeWidth?: ComponentPartValue<string | number>;
  viewBox?: ComponentPartValue<string>;
  width?: ComponentPartValue<string | number>;
  x?: ComponentPartValue<string | number>;
  y?: ComponentPartValue<string | number>;
};

export type ComponentPartBindingForElement<ElementName extends string> =
  ElementName extends "button"
    ? ComponentPartCommonProps<HTMLButtonElement> &
        ComponentPartPopoverTargetProps & {
          disabled?: ComponentPartValue<boolean>;
          name?: ComponentPartValue<string>;
          type?: ComponentPartValue<"button" | "submit" | "reset">;
          value?: ComponentPartValue<string | number>;
        }
    : ElementName extends "input"
      ? ComponentPartCommonProps<HTMLInputElement> &
          ComponentPartPopoverTargetProps & {
            accept?: ComponentPartValue<string>;
            checked?: ComponentPartValue<boolean>;
            disabled?: ComponentPartValue<boolean>;
            max?: ComponentPartValue<string | number>;
            min?: ComponentPartValue<string | number>;
            multiple?: ComponentPartValue<boolean>;
            name?: ComponentPartValue<string>;
            pattern?: ComponentPartValue<string>;
            placeholder?: ComponentPartValue<string>;
            readOnly?: ComponentPartValue<boolean>;
            readonly?: ComponentPartValue<boolean>;
            required?: ComponentPartValue<boolean>;
            step?: ComponentPartValue<string | number>;
            type?: ComponentPartValue<string>;
            value?: ComponentPartValue<string | number | readonly string[]>;
          }
      : ElementName extends "textarea"
        ? ComponentPartCommonProps<HTMLTextAreaElement> & {
            cols?: ComponentPartValue<number>;
            disabled?: ComponentPartValue<boolean>;
            maxLength?: ComponentPartValue<number>;
            minLength?: ComponentPartValue<number>;
            name?: ComponentPartValue<string>;
            placeholder?: ComponentPartValue<string>;
            readOnly?: ComponentPartValue<boolean>;
            readonly?: ComponentPartValue<boolean>;
            required?: ComponentPartValue<boolean>;
            rows?: ComponentPartValue<number>;
            value?: ComponentPartValue<string | number>;
            wrap?: ComponentPartValue<"hard" | "soft" | "off">;
          }
        : ElementName extends "select"
          ? ComponentPartCommonProps<HTMLSelectElement> & {
              disabled?: ComponentPartValue<boolean>;
              multiple?: ComponentPartValue<boolean>;
              name?: ComponentPartValue<string>;
              required?: ComponentPartValue<boolean>;
              value?: ComponentPartValue<string | number | readonly string[]>;
            }
          : ElementName extends "option"
            ? ComponentPartCommonProps<HTMLOptionElement> & {
                disabled?: ComponentPartValue<boolean>;
                selected?: ComponentPartValue<boolean>;
                value?: ComponentPartValue<string | number>;
              }
            : ElementName extends "a"
              ? ComponentPartCommonProps<HTMLAnchorElement> & {
                  download?: ComponentPartValue<string | boolean>;
                  href?: ComponentPartValue<string>;
                  rel?: ComponentPartValue<string>;
                  target?: ComponentPartValue<string>;
                }
              : ElementName extends "form"
                ? ComponentPartCommonProps<HTMLFormElement> & {
                    action?: ComponentPartValue<string>;
                    method?: ComponentPartValue<"dialog" | "get" | "post">;
                  }
                : ElementName extends "img"
                  ? ComponentPartCommonProps<HTMLImageElement> & {
                      alt?: ComponentPartValue<string>;
                      height?: ComponentPartValue<string | number>;
                      loading?: ComponentPartValue<"eager" | "lazy">;
                      src?: ComponentPartValue<string>;
                      width?: ComponentPartValue<string | number>;
                    }
                  : ElementName extends keyof HTMLElementTagNameMap
                    ? ComponentPartCommonProps<HTMLElementTagNameMap[ElementName]>
                    : ElementName extends keyof SVGElementTagNameMap
                      ? ComponentPartCommonProps<SVGElementTagNameMap[ElementName]> &
                          ComponentPartSvgProps
                      : ComponentPartCommonProps<Element>;

export type ComponentPartBinding<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentPartBindingForElement<ComponentPartElement<Spec, Component, Part>> & {
  readonly class: string;
};

export type ComponentPartComponent<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = (
  props?: Partial<Omit<ComponentPartBinding<Spec, Component, Part>, "class" | "style">> & {
    children?: Child;
  },
) => Child;

export type ComponentInstanceInput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (HasNoKeys<ComponentInput<Spec, Component>> extends true
  ? { input?: ComponentInput<Spec, Component> }
  : { input: ComponentInput<Spec, Component> }) &
  (HasNoKeys<ComponentVariants<Spec, Component>> extends true
    ? { variants?: ComponentVariants<Spec, Component> }
    : { variants: ComponentVariants<Spec, Component> });

type ComponentInstanceNeedsInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentInput<Spec, Component>> extends true
    ? HasNoKeys<ComponentVariants<Spec, Component>> extends true
      ? false
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
  readonly variants: ComponentVariants<Spec, Component>;
  readonly state: ComponentStateObject<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly actions: ComponentInstanceActionHandlers<Spec, Component>;
  readonly values: ComponentStyleValues<Spec, Component>;
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
    : StylesOf<Spec> extends {
          Presets: infer Presets extends Record<string, any>;
        }
      ? Extract<keyof Presets, string>
      : "default";

type PresetSpecsOf<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Presets: infer Presets extends Record<string, any>;
  }
    ? Presets
    : Record<string, never>;

type ThemeNamesOf<Spec extends AppSpec> = {
  [Preset in keyof PresetSpecsOf<Spec>]: PresetSpecsOf<Spec>[Preset] extends {
    Themes: infer Themes extends string;
  }
    ? Themes
    : never;
}[keyof PresetSpecsOf<Spec>];

export type ThemeName<Spec extends AppSpec> = [ThemeNamesOf<Spec>] extends [never]
  ? "default"
  : ThemeNamesOf<Spec> | "default";

export type StylesDef<Spec extends AppSpec> = {
  readonly defaultPreset?: PresetName<Spec>;
  readonly presets: Partial<Record<PresetName<Spec>, unknown>>;
};

export type StyleControls<Spec extends AppSpec> = {
  readonly preset: Signal<PresetName<Spec>>;
  readonly themeName: Signal<ThemeName<Spec>>;
  usePreset(): PresetName<Spec>;
  setPreset(preset: PresetName<Spec>): void;
  useThemeName(): ThemeName<Spec>;
  setTheme(theme: ThemeName<Spec>): void;
};

export type AppHooks<Spec extends AppSpec> = ApiHooks<Spec> &
  ComponentFactoryHooks<Spec> &
  StyleControls<Spec> & {
    start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
  };

export type AppInput<Spec extends AppSpec> = App<Spec> | AppDef<Spec> | TypedAppDefinition<Spec>;

export type CreateHooksOpts<Spec extends AppSpec> = {
  app: AppInput<Spec>;
  styles: StylesDef<Spec>;
  components?: ComponentRuntimeParts<Spec>;
  compiledVisuals?: CompiledVisuals;
};

type RuntimeComponentParts = Record<string, Record<string, string>>;

type RuntimeHookInput = {
  input?: Record<string, unknown>;
  variants?: Record<string, unknown>;
};

type RuntimeComponentDefinition = {
  state?:
    | Record<string, unknown>
    | ((ctx: {
        input: Record<string, unknown>;
        variants: Record<string, unknown>;
      }) => Record<string, unknown>);
  derived?: (ctx: Omit<RuntimeComponentInstanceContext, "derived">) => Record<string, unknown>;
  actions?: (ctx: RuntimeComponentInstanceContext) => Record<string, (...args: any[]) => void>;
  bind?: (ctx: RuntimeComponentControllerContext) => Record<string, unknown>;
  setup?: (ctx: RuntimeComponentControllerContext) => void | (() => void);
};

type RuntimeComponentInstanceContext = {
  readonly preset: string;
  readonly setPreset: (preset: string) => void;
  readonly theme: string;
  readonly setTheme: (theme: string) => void;
  readonly variants: Record<string, unknown>;
  readonly input: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly derived: Record<string, unknown>;
  readonly refs: Record<string, Element | null>;
};

type RuntimeComponentControllerContext = RuntimeComponentInstanceContext & {
  readonly actions: Record<string, (...args: any[]) => void>;
};

export function createHooks<Spec extends AppSpec>({
  app,
  styles,
  components,
  compiledVisuals,
}: CreateHooksOpts<Spec>): AppHooks<Spec> {
  const runtimeApp = normalizeAppInput(app);
  const runtime = createNativeAppRuntime(runtimeApp);
  const defaultPreset = firstPreset(styles) as PresetName<Spec>;
  const preset = signal(defaultPreset);
  const themeName = signal("default" as ThemeName<Spec>);
  updateRootPreset(preset());
  const runtimeParts = normalizeRuntimeParts(components);
  const selectPreset = (nextPreset: PresetName<Spec>) => {
    if (!(String(nextPreset) in styles.presets)) {
      throw new Error(`Unknown Poggers preset "${String(nextPreset)}".`);
    }
    preset(nextPreset);
    updateRootPreset(nextPreset);
  };
  const selectTheme = (nextTheme: ThemeName<Spec>) => {
    themeName(nextTheme);
    updateRootTheme(nextTheme);
  };
  const hooks: Record<string, unknown> = {
    ...(runtime.api as Record<string, unknown>),
    preset,
    themeName,
    usePreset() {
      return preset();
    },
    setPreset: selectPreset,
    useThemeName() {
      return themeName();
    },
    setTheme: selectTheme,
    start: runtime.start,
  };

  for (const componentName of collectComponentNames(runtimeApp, runtimeParts)) {
    hooks[`create${capitalize(componentName)}`] = (input: RuntimeHookInput = {}) =>
      createComponentInstance(componentName, {
        app: runtimeApp,
        preset,
        setPreset(nextPreset) {
          selectPreset(nextPreset as PresetName<Spec>);
        },
        themeName,
        setTheme(nextTheme) {
          selectTheme(nextTheme as ThemeName<Spec>);
        },
        parts: runtimeParts[componentName] ?? {},
        compiledVisuals,
        input,
      });
  }

  return hooks as AppHooks<Spec>;
}

function normalizeAppInput<Spec extends AppSpec>(app: AppInput<Spec>): App<Spec> {
  return isRuntimeApp(app) ? app : defineApp(app as AppDef<Spec>);
}

function isRuntimeApp<Spec extends AppSpec>(app: AppInput<Spec>): app is App<Spec> {
  return Boolean((app as App<Spec>).def?.resources);
}

function createComponentInstance(
  componentName: string,
  options: {
    app: App<any>;
    preset: () => string;
    setPreset: (preset: string) => void;
    themeName: () => string;
    setTheme: (theme: string) => void;
    parts: Record<string, string>;
    compiledVisuals?: CompiledVisuals;
    input: RuntimeHookInput;
  },
) {
  const suppressInitialEnter = isHotRefresh();
  const input = options.input.input ?? {};
  const variants = options.input.variants ?? {};
  const componentEntry = options.app.def.components?.[componentName];
  const definition =
    componentEntry && typeof componentEntry === "object"
      ? (componentEntry as RuntimeComponentDefinition)
      : undefined;
  const signals = Object.create(null) as Record<string, Signal<unknown>>;
  const refs = Object.create(null) as Record<string, Element | null>;
  const partElements = Object.create(null) as Record<string, Set<Element>>;
  const state = createStateObject(signals);
  const definitionState =
    typeof definition?.state === "function"
      ? definition.state({ input, variants })
      : definition?.state;
  const initialState = cloneComponentState({
    ...definitionState,
  });

  for (const [name, value] of Object.entries(initialState)) {
    signals[name] = signal(value, `component:${componentName}:state:${name}`);
  }

  const derivedSignals = Object.create(null) as Record<string, () => unknown>;
  const derivedValues = Object.create(null) as Record<string, unknown>;
  const derived = Object.create(null) as Record<string, unknown>;
  const baseContext = {
    get preset() {
      return options.preset();
    },
    setPreset: options.setPreset,
    get theme() {
      return options.themeName();
    },
    setTheme: options.setTheme,
    variants,
    input,
    state,
    refs,
  };
  const derivedFactory = definition?.derived;
  const readDerivedSource = derivedFactory
    ? computed(() => asRecord(derivedFactory(baseContext as never)))
    : () => ({});
  const derivedDescriptors = Object.getOwnPropertyDescriptors(untrack(readDerivedSource));

  for (const name of Object.keys(derivedDescriptors)) {
    const value = computed(() => {
      const descriptor = Object.getOwnPropertyDescriptor(readDerivedSource(), name);
      if (!descriptor) return undefined;
      if (typeof descriptor.get === "function") return descriptor.get.call(derived);
      if (typeof descriptor.value === "function") return descriptor.value.call(derived);
      return descriptor.value;
    });
    derivedSignals[name] = value;
    const initialValue = value();
    if (initialValue != null && typeof initialValue === "object") {
      derivedValues[name] = reactiveValue(value);
    }
    Object.defineProperty(derived, name, {
      enumerable: true,
      get() {
        return value();
      },
    });
  }

  const instanceContext = extendContext<RuntimeComponentInstanceContext>(baseContext, {
    derived,
  });
  const actions = Object.create(null) as Record<string, (...args: any[]) => void>;
  const actionsFactory = definition?.actions;
  const actionSource = untrack(() => actionsFactory?.(instanceContext) ?? {});
  for (const name of Object.keys(actionSource)) {
    actions[name] = (...args: any[]) => {
      const handler = actionsFactory?.(instanceContext)?.[name] ?? actionSource[name];
      return handler?.(...args);
    };
  }

  const controllerContext = extendContext<RuntimeComponentControllerContext>(instanceContext, {
    actions,
  });
  const controller = typeof componentEntry === "function" ? componentEntry : definition?.bind;
  const readControllerResult = () => {
    if (typeof controller !== "function") return {};
    return asRecord(
      (controller as (ctx: RuntimeComponentControllerContext) => unknown)(controllerContext),
    );
  };
  const readControllerPart = (partName: string) => {
    return readControllerResult()[partName];
  };
  const readControllerValues = () => asRecord(readControllerResult().values);
  const values = createControllerValuesObject(readControllerValues);
  const target = Object.create(null) as Record<string, unknown>;

  target.input = input;
  target.variants = variants;
  target.state = state;
  target.derived = derived;
  target.actions = actions;
  target.values = values;
  target.refs = refs;

  for (const name of Object.keys(derivedDescriptors)) {
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        return name in derivedValues ? derivedValues[name] : derived[name];
      },
    });
  }

  for (const [name, handler] of Object.entries(actions)) {
    target[name] = handler;
  }

  for (const [partName, elementName] of Object.entries(options.parts)) {
    target[partName] = createComponentPartComponent(componentName, partName, elementName, {
      refs,
      partElements,
      variants,
      state,
      controller: () => readControllerPart(partName),
      values: readControllerValues,
      compiledVisuals: options.compiledVisuals,
      preset: options.preset,
      themeName: options.themeName,
    });
  }

  mountComponentSetup(definition?.setup, controllerContext);

  mountCompiledVisualComponent({
    componentName,
    compiledVisuals: options.compiledVisuals,
    preset: options.preset,
    themeName: options.themeName,
    variants,
    state,
    values,
    refs,
    partElements,
    suppressInitialEnter,
  });

  return target;
}

function mountCompiledVisualComponent(options: {
  componentName: string;
  compiledVisuals?: CompiledVisuals;
  preset: () => string;
  themeName: () => string;
  variants: Record<string, unknown>;
  state: Record<string, unknown>;
  values: Record<string, unknown>;
  refs: Record<string, Element | null>;
  partElements: Record<string, Set<Element>>;
  suppressInitialEnter: boolean;
}) {
  if (!options.compiledVisuals) return;
  onMount(() => {
    const coordinator = createVisualCoordinator({
      compiled: options.compiledVisuals ?? {},
      component: options.componentName,
      refs: options.refs,
      elements: options.partElements,
      suppressInitialEnter: options.suppressInitialEnter,
    });
    const disposeEffect = effect(() => {
      const preset = options.preset();
      if (!isCompiledVisualPreset(options.compiledVisuals, preset)) return;
      coordinator.update({
        preset,
        theme: options.themeName(),
        variants: { ...options.variants },
        state: { ...options.state },
        values: { ...options.values },
      });
    });
    return () => {
      disposeEffect();
      coordinator.dispose();
    };
  });
}

function cloneComponentState(state: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(state);
  } catch {
    return { ...state };
  }
}

function mountComponentSetup(
  setup: RuntimeComponentDefinition["setup"],
  context: RuntimeComponentControllerContext,
) {
  if (!setup) return;
  onMount(() => setup(context));
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

function extendContext<T extends Record<string, unknown>>(
  base: Record<string, unknown>,
  values: Record<string, unknown>,
): T {
  const context = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(context, Object.getOwnPropertyDescriptors(base));
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(context, name, {
      enumerable: true,
      configurable: true,
      value,
    });
  }
  return context as T;
}

function createControllerValuesObject(
  readValues: () => Record<string, unknown>,
): Record<string, unknown> {
  return new Proxy(Object.create(null), {
    get(_target, prop: string) {
      if (typeof prop !== "string") return undefined;
      return readValues()[prop];
    },
    ownKeys() {
      return Reflect.ownKeys(readValues());
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      if (prop in readValues()) return { enumerable: true, configurable: true };
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
    partElements: Record<string, Set<Element>>;
    variants: Record<string, unknown>;
    state: Record<string, unknown>;
    controller: () => unknown;
    values: () => Record<string, unknown>;
    compiledVisuals?: CompiledVisuals;
    preset: () => string;
    themeName: () => string;
  },
) {
  return createCompiledVisualPartComponent(componentName, partName, elementName, options);
}

function createCompiledVisualPartComponent(
  componentName: string,
  partName: string,
  elementName: string,
  options: {
    refs: Record<string, Element | null>;
    partElements: Record<string, Set<Element>>;
    variants: Record<string, unknown>;
    state: Record<string, unknown>;
    controller: () => unknown;
    values: () => Record<string, unknown>;
    preset: () => string;
    themeName: () => string;
    compiledVisuals?: CompiledVisuals;
  },
) {
  return (props: Props = {}) => {
    const readAttributes = computed(() =>
      visualPartAttributes(
        options.compiledVisuals ?? {},
        options.preset(),
        componentName,
        partName,
        {
          theme: options.themeName(),
          variants: options.variants,
          state: options.state,
          values: options.values(),
        },
      ),
    );
    const base: Record<string, unknown> = {
      class() {
        return readAttributes().class;
      },
      style() {
        return readAttributes().style;
      },
      "data-style-src"() {
        return readAttributes()["data-style-src"];
      },
      ref(element: Element) {
        options.refs[partName] = element;
        (options.partElements[partName] ??= new Set()).add(element);
      },
    };
    const controllerProps = createReactiveControllerProps(options.controller);
    return jsx(elementName, mergeProps(base, controllerProps, props));
  };
}

function createReactiveControllerProps(readController: () => unknown): Record<string, unknown> {
  const read = () => asRecord(readController());
  const initial = asRecord(untrack(read));
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

function mergeProps(...sources: Array<Record<string, unknown> | Props>): Props {
  const merged: Record<string, unknown> = {};

  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      const existing = merged[name];
      if (name === "class" || name === "className") {
        const existingClass = merged.class ?? merged.className;
        delete merged.className;
        merged.class = existingClass ? mergeClassValue(existingClass, value) : value;
      } else if (name === "ref" && typeof existing === "function" && typeof value === "function") {
        merged[name] = (element: Element) => {
          (existing as (element: Element) => void)(element);
          value(element);
        };
      } else if (name === "style" && existing) {
        merged[name] = mergeStyleValue(existing, value);
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

function mergeStyleValue(existing: unknown, next: unknown): () => unknown {
  return () => {
    const existingObject = styleObject(existing);
    const nextObject = styleObject(next);
    if (existingObject && nextObject) return { ...existingObject, ...nextObject };
    return nextObject ?? existingObject ?? resolveMaybeSignal(next);
  };
}

function styleObject(value: unknown): Record<string, unknown> | undefined {
  const resolved = resolveMaybeSignal(value);
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
    return resolved as Record<string, unknown>;
  }
  return undefined;
}

function resolveMaybeSignal(value: unknown): unknown {
  return typeof value === "function" ? (value as () => unknown)() : value;
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
  parts: RuntimeComponentParts,
): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(parts)) names.add(name);
  for (const name of Object.keys(app.def.components ?? {})) names.add(name);
  return [...names];
}

function firstPreset<Spec extends AppSpec>(styles: StylesDef<Spec>): string {
  const explicit = styles.defaultPreset;
  if (explicit) return String(explicit);
  return Object.keys(styles.presets)[0] ?? "default";
}

function updateRootPreset(preset: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.preset = String(preset);
}

function updateRootTheme(theme: string) {
  if (typeof document === "undefined") return;
  if (!theme || theme === "default") {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = String(theme);
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
