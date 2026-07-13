import { endBatch, startBatch } from "alien-signals";
import {
  defineApp,
  type App,
  type AppDef,
  type AppNavigation,
  type AppScreen,
  type AppSpec,
  type ComponentInput,
  type ComponentName,
  type ComponentRenderScope,
  type ComponentValues,
  type ResourceFor,
  type ResourceName,
  type TypedAppDefinition,
  type UISignal,
} from "./app";
import type { ConnectOpts } from "./client";
import type { PresetAppearance, PresetName, PresetThemeName } from "./preset";
import { PresenceScene } from "./scene";
import {
  createComponentActor,
  type ComponentActor,
  type StatechartDefinition,
  type StatechartNode,
  type StatechartSnapshot,
  type StatechartSettlementDriver,
  type StatechartTask,
  type StatechartTransitions,
} from "./component-machine";

declare const __POGGERS_HMR__: boolean;
import {
  createVisualCoordinator,
  isCompiledVisualPreset,
  registerVisualHover,
  visualPartAttributes,
  visualPartCollection,
  visualPartDependencies,
  visualPartPresence,
  type VisualCoordinator,
  type CompiledVisuals,
} from "./visual-runtime";
import {
  computed,
  bindVirtualCollectionHost,
  allocateSceneOwner,
  captureSignalOnHotRefresh,
  createNativeAppRuntime,
  currentPresenceScene,
  currentStructuralKey,
  effect,
  isHotRefresh,
  jsx,
  onCleanup,
  onMount,
  reactiveValue,
  signal,
  untrack,
  type Child,
  type Component,
  type NativeResource,
  type Props,
  type Signal,
} from "./ui";

type HookName<Name extends string> = `use${Capitalize<Name>}`;

export type ComponentRuntimeParts<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: {
    readonly parts: Record<string, string>;
    readonly values?: readonly (keyof ComponentValues<Spec, Component> & string)[];
    readonly inputCallbacks?: readonly (keyof ComponentInput<Spec, Component> & string)[];
  };
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

export type StylesDef<Spec extends AppSpec> = {
  readonly defaultPreset?: PresetName<Spec>;
  readonly presets: Partial<Record<PresetName<Spec>, unknown>>;
};

export type StyleControls<Spec extends AppSpec> = {
  readonly appearance: Signal<PresetAppearance<Spec>>;
  useAppearance(): PresetAppearance<Spec>;
  setAppearance(appearance: PresetAppearance<Spec>): void;
};

export type AppHooks<Spec extends AppSpec> = ApiHooks<Spec> &
  StyleControls<Spec> & {
    readonly components: {
      readonly [Component in ComponentName<Spec>]: ComponentRenderScope<
        Spec,
        Component
      >["components"][Component];
    };
    start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
    renderRoot(): Child;
  };

export type AppInput<Spec extends AppSpec> = App<Spec> | AppDef<Spec> | TypedAppDefinition<Spec>;

export type CreateHooksOpts<Spec extends AppSpec> = {
  app: AppInput<Spec>;
  styles: StylesDef<Spec>;
  components?: ComponentRuntimeParts<Spec>;
  compiledVisuals?: CompiledVisuals;
};

type RuntimeComponentConfig = {
  parts: Record<string, string>;
  values?: readonly string[];
  inputCallbacks?: readonly string[];
};

type RuntimeComponentParts = Record<string, RuntimeComponentConfig>;

type RuntimeHookInput = Record<string, unknown>;

type RuntimeComponentDefinition = {
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  initial?: string;
  on?: Readonly<Record<string, StatechartTransitions>>;
  states?: Readonly<Record<string, StatechartNode>>;
  tasks?: Record<string, StatechartTask>;
  derive?: (scope: Omit<RuntimeComponentInstanceScope, "values">) => Record<string, unknown>;
  render?: (scope: RuntimeComponentRenderScope) => Child;
};

type RuntimeComponentState = {
  readonly paths: readonly string[];
  readonly value: unknown;
  readonly active: readonly string[];
  readonly done: boolean;
  readonly output: unknown;
  readonly error: unknown;
  matches(path: string): boolean;
  can(event: string, ...args: readonly unknown[]): boolean;
  subscribe(observer: (state: RuntimeComponentState) => void): () => void;
};

type RuntimeComponentInstanceScope = {
  readonly input: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly state: RuntimeComponentState;
  readonly values: Record<string, unknown>;
  readonly parameters: Record<string, unknown>;
};

type RuntimeComponentComposition = {
  readonly components: Record<string, (props?: RuntimeHookInput) => Child>;
  readonly resources: Record<string, (key: Record<string, unknown>) => unknown>;
  readonly navigation: Record<string, (...args: any[]) => void>;
  readonly screen: () => unknown;
};

type RuntimeComponentRenderScope = RuntimeComponentInstanceScope & {
  readonly events: Record<string, (...args: any[]) => void>;
  readonly slots: Record<string, unknown>;
  readonly parts: Record<string, Component<Props>>;
  readonly components: RuntimeComponentComposition["components"];
  readonly resources: RuntimeComponentComposition["resources"];
  readonly navigation: RuntimeComponentComposition["navigation"];
  readonly screen: unknown;
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
  const appearance = signal({
    preset: defaultPreset,
    theme: "default",
  } as PresetAppearance<Spec>);
  const preset = () => appearance().preset;
  const themeName = () => appearance().theme as PresetThemeName<Spec>;
  updateRootPreset(preset());
  const runtimeParts = normalizeRuntimeParts(components);
  const selectAppearance = (nextAppearance: PresetAppearance<Spec>) => {
    const nextPreset = String(nextAppearance.preset);
    const nextTheme = String(nextAppearance.theme);
    if (!(nextPreset in styles.presets)) {
      throw new Error(`Unknown Poggers preset "${nextPreset}".`);
    }
    if (!presetSupportsTheme(compiledVisuals, nextPreset, nextTheme)) {
      throw new Error(`Poggers preset "${nextPreset}" does not define theme "${nextTheme}".`);
    }
    appearance(nextAppearance);
    updateRootPreset(nextPreset);
    updateRootTheme(nextTheme);
  };
  const hooks: Record<string, unknown> = {
    ...(runtime.api as Record<string, unknown>),
    appearance,
    useAppearance() {
      return appearance();
    },
    setAppearance: selectAppearance,
    start: runtime.start,
  };

  const componentRenderers = Object.create(null) as RuntimeComponentComposition["components"];
  const resources = Object.create(null) as RuntimeComponentComposition["resources"];
  for (const resourceName of Object.keys(runtimeApp.def.resources)) {
    resources[resourceName] = (key) =>
      createDynamicResource(() => runtime.api.useResource(resourceName as never, key as never));
  }
  const composition: RuntimeComponentComposition = {
    components: componentRenderers,
    resources,
    navigation: runtime.api.nav as RuntimeComponentComposition["navigation"],
    screen: runtime.api.useScreen,
  };

  for (const componentName of collectComponentNames(runtimeApp, runtimeParts)) {
    componentRenderers[componentName] = (props: RuntimeHookInput = {}) => {
      const instance = createComponentInstance(componentName, {
        app: runtimeApp,
        appearance,
        setAppearance(nextAppearance) {
          selectAppearance(nextAppearance as PresetAppearance<Spec>);
        },
        preset,
        themeName,
        config: runtimeParts[componentName] ?? { parts: {} },
        compiledVisuals,
        input: props,
        composition,
      });
      return instance(props as Props);
    };
  }
  hooks.components = componentRenderers;

  hooks.renderRoot = () => {
    const rootName = runtimeApp.def.root;
    if (typeof rootName !== "string") {
      throw new Error("App definition must select a root component by name.");
    }
    const component = componentRenderers[rootName];
    if (!component) throw new Error(`Unknown Poggers root component "${rootName}".`);
    return component();
  };

  return hooks as AppHooks<Spec>;
}

function createDynamicResource(
  readResource: () => Record<string, unknown>,
): Record<string, unknown> {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      const value = Reflect.get(readResource(), prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const current = Reflect.get(readResource(), prop);
        return typeof current === "function" ? current(...args) : undefined;
      };
    },
    has(_target, prop) {
      return prop in readResource();
    },
    ownKeys() {
      return Reflect.ownKeys(readResource());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (!(prop in readResource())) return undefined;
      return { enumerable: true, configurable: true };
    },
  });
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
    appearance: () => { readonly preset: string; readonly theme: string };
    setAppearance: (appearance: { readonly preset: string; readonly theme: string }) => void;
    preset: () => string;
    themeName: () => string;
    config: RuntimeComponentConfig;
    compiledVisuals?: CompiledVisuals;
    input: RuntimeHookInput;
    composition: RuntimeComponentComposition;
  },
) {
  const suppressInitialEnter = isHotRefresh();
  const callbacks = new Set(options.config.inputCallbacks ?? []);
  const readInput = (name: string, value: unknown) =>
    typeof value === "function" && !callbacks.has(name) ? value() : value;
  const input = Object.create(null) as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(options.input),
  )) {
    Object.defineProperty(input, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        const value = descriptor.get ? descriptor.get.call(options.input) : descriptor.value;
        return readInput(name, value);
      },
    });
  }
  const componentEntry = (options.app.def.components as Record<string, unknown> | undefined)?.[
    componentName
  ];
  const definition =
    componentEntry && typeof componentEntry === "object"
      ? (componentEntry as RuntimeComponentDefinition)
      : undefined;
  const statechartDefinition = definition?.states
    ? {
        initial: definition.initial,
        on: definition.on,
        states: definition.states,
      }
    : definition?.on
      ? {
          initial: "active",
          states: { active: { on: definition.on } },
        }
      : undefined;
  const signals = Object.create(null) as Record<string, Signal<unknown>>;
  const refs = Object.create(null) as Record<string, Element | null>;
  const partElements = Object.create(null) as Record<string, Set<Element>>;
  const sharedScene = currentPresenceScene();
  const scene = sharedScene ?? new PresenceScene<Element>();
  const sceneOwner = allocateSceneOwner(componentName);
  const context = createContextObject(signals);
  const initialContext = cloneComponentContext(definition?.context ?? {});

  for (const [name, value] of Object.entries(initialContext)) {
    signals[name] = signal(value, `component:${componentName}:context:${name}`);
  }

  const events = Object.create(null) as Record<string, (...args: any[]) => void>;
  const parameterSignals = Object.create(null) as Record<string, Signal<unknown>>;
  const parameters = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      return parameterSignals[name]?.();
    },
    ownKeys() {
      return Reflect.ownKeys(parameterSignals);
    },
    getOwnPropertyDescriptor(_target, name) {
      return typeof name === "string" && name in parameterSignals
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });
  const updateParameters = (next: Readonly<Record<string, unknown>>) => {
    startBatch();
    try {
      const names = new Set(Object.keys(next));
      for (const [name, value] of Object.entries(next)) {
        const current = parameterSignals[name];
        if (current) current(value);
        else parameterSignals[name] = signal(value, `component:${componentName}:parameter:${name}`);
      }
      for (const [name, current] of Object.entries(parameterSignals)) {
        if (!names.has(name)) current(undefined);
      }
    } finally {
      endBatch();
    }
  };
  const refreshSnapshot =
    statechartDefinition && (typeof __POGGERS_HMR__ === "undefined" || __POGGERS_HMR__)
      ? signal<unknown | undefined>(undefined, `component:${componentName}:statechart`)
      : undefined;
  const services = componentServices({ ...options, parameters });
  const settlement = createSettlementPort(componentName);
  const actor = statechartDefinition
    ? createRestoredComponentActor(
        {
          id: componentName,
          definition: statechartDefinition,
          input,
          context: { ...context },
          tasks: definition?.tasks,
          settle: settlement.wait,
          services,
        },
        untrack(() => refreshSnapshot?.()),
      )
    : undefined;
  const actorController = actor
    ? createActorController(componentName, actor, signals, refreshSnapshot)
    : undefined;
  if (actor && refreshSnapshot) {
    captureSignalOnHotRefresh(refreshSnapshot, actor.getRefreshSnapshot);
  }
  const state = actorController?.state ?? createStaticState();

  const mutableValueSignals = Object.create(null) as Record<string, Signal<unknown>>;
  const reactiveValues = Object.create(null) as Record<string, unknown>;
  const values = Object.create(null) as Record<string, unknown>;
  for (const [name, initial] of Object.entries(definition?.values ?? {})) {
    const value = signal(initial, `component:${componentName}:value:${name}`);
    mutableValueSignals[name] = value;
    Object.defineProperty(values, name, {
      enumerable: true,
      get: value,
      set: value,
    });
  }
  const baseScope = extendContext<RuntimeComponentInstanceScope>(services, {
    input,
    context,
    state,
  });
  const deriveServices = Object.create(null) as Record<string, unknown>;
  for (const name of ["appearance", "screen", "parameters"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(services, name);
    if (descriptor) Object.defineProperty(deriveServices, name, descriptor);
  }
  const deriveScope = extendContext<RuntimeComponentInstanceScope>(deriveServices, {
    input,
    context,
    state,
  });
  const derive = definition?.derive;
  const readValueSource = derive
    ? computed(() => asRecord(derive(deriveScope as never)))
    : () => ({});
  const valueDescriptors = Object.getOwnPropertyDescriptors(untrack(readValueSource));

  for (const name of Object.keys(valueDescriptors)) {
    if (name in mutableValueSignals) {
      throw new Error(`Component ${componentName} value "${name}" cannot be mutable and derived.`);
    }
    const value = computed(() => {
      const descriptor = Object.getOwnPropertyDescriptor(readValueSource(), name);
      if (!descriptor) return undefined;
      if (typeof descriptor.get === "function") return descriptor.get.call(values);
      if (typeof descriptor.value === "function") return descriptor.value.call(values);
      return descriptor.value;
    });
    const initialValue = value();
    if (initialValue != null && typeof initialValue === "object") {
      reactiveValues[name] = reactiveValue(value);
    }
    Object.defineProperty(values, name, {
      enumerable: true,
      get() {
        return name in reactiveValues ? reactiveValues[name] : value();
      },
    });
  }

  const instanceScope = extendContext<RuntimeComponentInstanceScope>(baseScope, {
    values,
  });
  if (actor && statechartDefinition) {
    for (const name of collectStatechartEventNames(statechartDefinition)) {
      events[name] = (...args: any[]) => settlement.transition(() => actor.send(name, ...args));
    }
  }

  const visualValues = createComponentValuesObject(
    options.config.values ?? [],
    (name) => values[name],
  );
  const motionSignals = Object.create(null) as Record<string, Signal<number | undefined>>;
  const visualMotion = new Proxy(Object.create(null) as Record<string, number | undefined>, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      return (motionSignals[name] ??= signal(
        undefined as number | undefined,
        `component:${componentName}:motion:${name}`,
      ))();
    },
  });
  const parts = Object.create(null) as Record<string, Component<Props>>;

  for (const [partName, elementName] of Object.entries(options.config.parts)) {
    parts[partName] = createComponentPartComponent(componentName, partName, elementName, {
      refs,
      partElements,
      values: visualValues,
      motion: visualMotion,
      compiledVisuals: options.compiledVisuals,
      preset: options.preset,
      themeName: options.themeName,
      scene,
      sceneOwner,
    });
  }

  let renderPending = false;
  let mounted = false;
  const renderComponent = (slots: Props = {}) => {
    if (!definition?.render) {
      throw new Error(`Component ${componentName} does not define render.`);
    }
    if (renderPending || mounted) {
      throw new Error(
        `Component ${componentName} instance is already rendered. Create a separate instance for each owner.`,
      );
    }
    renderPending = true;
    onMount(() => {
      renderPending = false;
      mounted = true;
      return () => {
        mounted = false;
      };
    });
    mountCompiledVisualComponent({
      componentName,
      compiledVisuals: options.compiledVisuals,
      preset: options.preset,
      themeName: options.themeName,
      state,
      visualValues,
      writableValues: values,
      refs,
      partElements,
      suppressInitialEnter,
      settlement,
      events,
      onParametersChange: updateParameters,
      onMotionChange(source, value) {
        (motionSignals[source] ??= signal(
          undefined as number | undefined,
          `component:${componentName}:motion:${source}`,
        ))(value);
      },
    });
    if (actorController) {
      onMount(() => {
        actorController.start();
        return actorController.dispose;
      });
    }
    onMount(() => () => {
      for (const partName of Object.keys(refs)) refs[partName] = null;
      for (const elements of Object.values(partElements)) elements.clear();
      if (!sharedScene) scene.dispose();
    });
    const renderScope = extendContext<RuntimeComponentRenderScope>(instanceScope, {
      events,
      slots,
      parts,
      components: options.composition.components,
      resources: options.composition.resources,
      navigation: options.composition.navigation,
    });
    return definition.render(renderScope);
  };

  return renderComponent;
}

function componentServices(options: {
  appearance: () => { readonly preset: string; readonly theme: string };
  setAppearance: (appearance: { readonly preset: string; readonly theme: string }) => void;
  composition: RuntimeComponentComposition;
  parameters: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const services = {
    setAppearance: options.setAppearance,
    resources: options.composition.resources,
    navigation: options.composition.navigation,
  } as Record<string, unknown>;
  Object.defineProperties(services, {
    appearance: { enumerable: true, get: options.appearance },
    screen: { enumerable: true, get: options.composition.screen },
    parameters: { enumerable: true, get: () => options.parameters },
  });
  return services;
}

function mountCompiledVisualComponent(options: {
  componentName: string;
  compiledVisuals?: CompiledVisuals;
  preset: () => string;
  themeName: () => string;
  state: RuntimeComponentState;
  visualValues: Record<string, unknown>;
  writableValues: Record<string, unknown>;
  refs: Record<string, Element | null>;
  partElements: Record<string, Set<Element>>;
  suppressInitialEnter: boolean;
  settlement: SettlementPort;
  events: Readonly<Record<string, (...args: any[]) => void>>;
  onParametersChange(parameters: Readonly<Record<string, unknown>>): void;
  onMotionChange(source: string, value: number): void;
}) {
  if (!options.compiledVisuals) return;
  onMount(() => {
    const coordinator = createVisualCoordinator({
      compiled: options.compiledVisuals ?? {},
      component: options.componentName,
      refs: options.refs,
      elements: options.partElements,
      suppressInitialEnter: options.suppressInitialEnter,
      onMotionChange: options.onMotionChange,
      events: options.events,
      values: options.writableValues,
      onParametersChange: options.onParametersChange,
    });
    const detachSettlement = options.settlement.attach(coordinator);
    const disposeEffect = effect(() => {
      const preset = options.preset();
      if (!isCompiledVisualPreset(options.compiledVisuals, preset)) return;
      coordinator.update({
        preset,
        theme: options.themeName(),
        states: Object.fromEntries(
          options.state.paths.map((path) => [path, options.state.matches(path)]),
        ),
        values: options.visualValues,
      });
    });
    return () => {
      detachSettlement();
      disposeEffect();
      coordinator.dispose();
    };
  });
}

type SettlementPort = {
  readonly wait: StatechartSettlementDriver;
  attach(coordinator: VisualCoordinator): () => void;
  transition(run: () => void): void;
};

function createSettlementPort(component: string): SettlementPort {
  let coordinator: VisualCoordinator | undefined;
  const wait: StatechartSettlementDriver = ({ phase, state, signal }) => {
    if (!coordinator) {
      throw new Error(`Component ${component} requested visual settlement before it mounted.`);
    }
    return coordinator.settle(phase, state, signal);
  };
  return {
    wait,
    attach(next) {
      if (coordinator && coordinator !== next) {
        throw new Error(`Component ${component} mounted more than one visual coordinator.`);
      }
      coordinator = next;
      return () => {
        if (coordinator === next) coordinator = undefined;
      };
    },
    transition(run) {
      coordinator?.captureLayouts();
      run();
      coordinator?.animateLayouts();
    },
  };
}

function cloneComponentContext(context: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(context);
  } catch {
    return { ...context };
  }
}

function createActorController(
  componentName: string,
  actor: ComponentActor,
  contextSignals: Record<string, Signal<unknown>>,
  refreshSnapshot: Signal<unknown | undefined> | undefined,
): { state: RuntimeComponentState; start: () => void; dispose: () => void } {
  const initial = actor.getSnapshot();
  const activeSignals = Object.fromEntries(
    actor.paths.map((path) => [
      path,
      signal(initial.matches(path), `component:${componentName}:state:${path}`),
    ]),
  ) as Record<string, Signal<boolean>>;
  const value = signal(initial.value, `component:${componentName}:state:value`);
  const lifecycle = signal(initial.status, `component:${componentName}:state:lifecycle`);
  const output = signal(initial.output, `component:${componentName}:state:output`);
  const error = signal(initial.error, `component:${componentName}:state:error`);
  const version = signal(0, `component:${componentName}:state:version`);
  const observers = new Set<(state: RuntimeComponentState) => void>();

  const project = (snapshot: StatechartSnapshot) => {
    startBatch();
    try {
      const nextKeys = new Set(Object.keys(snapshot.context));
      for (const [name, next] of Object.entries(snapshot.context)) {
        const current = contextSignals[name];
        if (!current) {
          contextSignals[name] = signal(next, `component:${componentName}:context:${name}`);
        } else if (!Object.is(current(), next)) {
          current(next);
        }
      }
      for (const [name, current] of Object.entries(contextSignals)) {
        if (!nextKeys.has(name) && current() !== undefined) current(undefined);
      }
      for (const [path, current] of Object.entries(activeSignals)) {
        const next = snapshot.matches(path);
        if (current() !== next) current(next);
      }
      if (!Object.is(value(), snapshot.value)) value(snapshot.value);
      if (lifecycle() !== snapshot.status) lifecycle(snapshot.status);
      if (!Object.is(output(), snapshot.output)) output(snapshot.output);
      if (!Object.is(error(), snapshot.error)) error(snapshot.error);
      version(version() + 1);
    } finally {
      endBatch();
    }
    for (const observer of observers) observer(state);
  };
  const unsubscribe = actor.subscribe(project);
  let disposed = false;
  const state: RuntimeComponentState = {
    paths: actor.paths,
    get value() {
      return value();
    },
    get active() {
      return actor.paths.filter((path) => activeSignals[path]?.() ?? false);
    },
    get done() {
      return lifecycle() === "done";
    },
    get output() {
      return output();
    },
    get error() {
      return error();
    },
    matches(path) {
      return activeSignals[path]?.() ?? false;
    },
    can(event, ...args) {
      version();
      return actor.getSnapshot().can(event, ...args);
    },
    subscribe(observer) {
      observer(state);
      observers.add(observer);
      return () => observers.delete(observer);
    },
  };

  return {
    state,
    start() {
      if (disposed) return;
      actor.start();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observers.clear();
      refreshSnapshot?.(actor.getRefreshSnapshot());
      unsubscribe();
      actor.stop();
    },
  };
}

function createRestoredComponentActor(
  options: Parameters<typeof createComponentActor>[0],
  snapshot: unknown,
): ComponentActor {
  if (snapshot === undefined) return createComponentActor(options);
  try {
    return createComponentActor({ ...options, refreshSnapshot: snapshot });
  } catch (error) {
    console.warn("Poggers could not restore a component statechart after hot refresh.", error);
    return createComponentActor(options);
  }
}

function createStaticState(): RuntimeComponentState {
  return {
    paths: ["active"],
    value: "active",
    active: ["active"],
    done: false,
    output: undefined,
    error: undefined,
    matches(path) {
      return path === "active";
    },
    can() {
      return false;
    },
    subscribe(observer) {
      observer(this);
      return () => {};
    },
  };
}

function collectStatechartEventNames(statechart: StatechartDefinition): string[] {
  const names = new Set<string>();
  const visit = (node: StatechartDefinition | StatechartNode) => {
    for (const name of Object.keys(node.on ?? {})) names.add(name);
    for (const child of Object.values(node.states ?? {})) visit(child);
  };
  visit(statechart);
  return [...names];
}

function createContextObject(signals: Record<string, Signal<unknown>>): Record<string, unknown> {
  return new Proxy(Object.create(null), {
    get(_target, prop: string) {
      if (typeof prop !== "string") return undefined;
      return signals[prop]?.();
    },
    set(_target, prop: string, value: unknown) {
      if (typeof prop !== "string") return false;
      void value;
      throw new TypeError(
        "Component context is readonly. Return a context patch from a transition instead.",
      );
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

function createComponentValuesObject(
  names: readonly string[],
  readValue: (name: string) => unknown,
): Record<string, unknown> {
  const available = new Set(names);
  return new Proxy(Object.create(null), {
    get(_target, prop: string) {
      return typeof prop === "string" && available.has(prop) ? readValue(prop) : undefined;
    },
    ownKeys() {
      return [...names];
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      return typeof prop === "string" && available.has(prop)
        ? { enumerable: true, configurable: true }
        : undefined;
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
    values: Record<string, unknown>;
    motion: Readonly<Record<string, number | undefined>>;
    compiledVisuals?: CompiledVisuals;
    preset: () => string;
    themeName: () => string;
    scene: PresenceScene<Element>;
    sceneOwner: string;
  },
) {
  const part = createCompiledVisualPartComponent(componentName, partName, elementName, {
    ...options,
  }) as Component<Props> & {
    readonly element: Element | null;
    readonly elements: readonly Element[];
  };
  Object.defineProperties(part, {
    element: {
      get: () => options.refs[partName] ?? null,
    },
    elements: {
      get: () => [...(options.partElements[partName] ?? [])],
    },
  });
  return part;
}

function createCompiledVisualPartComponent(
  componentName: string,
  partName: string,
  elementName: string,
  options: {
    refs: Record<string, Element | null>;
    partElements: Record<string, Set<Element>>;
    values: Record<string, unknown>;
    motion: Readonly<Record<string, number | undefined>>;
    preset: () => string;
    themeName: () => string;
    compiledVisuals?: CompiledVisuals;
    scene: PresenceScene<Element>;
    sceneOwner: string;
  },
) {
  return (props: Props = {}) => {
    const { ref: authorRef, ...nativeProps } = props;
    const dependencies = new Set<string>();
    for (const preset of Object.keys(options.compiledVisuals ?? {})) {
      for (const dependency of visualPartDependencies(
        options.compiledVisuals ?? {},
        preset,
        componentName,
        partName,
      )) {
        dependencies.add(dependency);
      }
    }
    const dependsOn = (source: string, name?: string) =>
      dependencies.has(name ? `${source}.${name}` : source) ||
      [...dependencies].some((dependency) => dependency.startsWith(`${source}.`));
    const hovered = signal(false, `${componentName}.${partName}.hovered`);
    const pressed = signal(false, `${componentName}.${partName}.pressed`);
    const focusVisible = signal(false, `${componentName}.${partName}.focusVisible`);
    const focusWithin = signal(false, `${componentName}.${partName}.focusWithin`);
    const inlineSize = signal(0, `${componentName}.${partName}.inlineSize`);
    const blockSize = signal(0, `${componentName}.${partName}.blockSize`);
    const environment = createVisualEnvironment(dependencies, componentName, partName);
    const interactionContext = Object.defineProperties(
      {},
      {
        hovered: { enumerable: true, get: hovered },
        pressed: { enumerable: true, get: pressed },
        focusVisible: { enumerable: true, get: focusVisible },
        focusWithin: { enumerable: true, get: focusWithin },
        selected: {
          enumerable: true,
          get: () =>
            semanticBoolean(
              resolveMaybeSignal(nativeProps["aria-selected"]) ??
                resolveMaybeSignal(nativeProps["aria-pressed"]),
            ),
        },
        disabled: {
          enumerable: true,
          get: () =>
            semanticBoolean(
              resolveMaybeSignal(nativeProps.disabled) ??
                resolveMaybeSignal(nativeProps["aria-disabled"]),
            ),
        },
        expanded: {
          enumerable: true,
          get: () => semanticBoolean(resolveMaybeSignal(nativeProps["aria-expanded"])),
        },
      },
    ) as Readonly<Record<string, unknown>>;
    const geometryContext = Object.defineProperties(
      {},
      {
        inlineSize: { enumerable: true, get: inlineSize },
        blockSize: { enumerable: true, get: blockSize },
      },
    ) as Readonly<Record<string, unknown>>;
    const structuralChildren =
      typeof nativeProps.children === "function" &&
      Boolean(
        visualPartCollection(
          options.compiledVisuals ?? {},
          options.preset(),
          componentName,
          partName,
          options.themeName(),
        ),
      );
    const readAttributes = computed(() =>
      visualPartAttributes(
        options.compiledVisuals ?? {},
        options.preset(),
        componentName,
        partName,
        {
          theme: options.themeName(),
          values: options.values,
          interaction: interactionContext,
          geometry: geometryContext,
          environment,
          motion: options.motion,
        },
      ),
    );
    const base: Record<string, unknown> = {
      __poggersScene: {
        scene: options.scene,
        owner: options.sceneOwner,
        part: partName,
        key: currentStructuralKey(),
      },
      class() {
        return readAttributes().class;
      },
      style() {
        return readAttributes().style;
      },
      "data-motion-lifecycle"() {
        return visualPartPresence(
          options.compiledVisuals ?? {},
          options.preset(),
          componentName,
          partName,
        )?.lifecycle;
      },
      "data-motion-layout"() {
        return visualPartPresence(
          options.compiledVisuals ?? {},
          options.preset(),
          componentName,
          partName,
        )?.layout;
      },
      __poggersStructuralChildren: structuralChildren,
      onPointerDown(event: PointerEvent) {
        if (dependsOn("interaction", "pressed") && !interactionDisabled(event.currentTarget)) {
          pressed(true);
        }
      },
      onPointerUp() {
        if (dependsOn("interaction", "pressed")) pressed(false);
      },
      onPointerCancel() {
        if (dependsOn("interaction", "pressed")) pressed(false);
      },
      onLostPointerCapture() {
        if (dependsOn("interaction", "pressed")) pressed(false);
      },
      onFocus(event: FocusEvent) {
        if (dependsOn("interaction", "focusWithin")) focusWithin(true);
        if (dependsOn("interaction", "focusVisible")) {
          const target = event.currentTarget;
          focusVisible(target instanceof Element && target.matches(":focus-visible"));
        }
      },
      onBlur(event: FocusEvent) {
        const target = event.currentTarget;
        const related = event.relatedTarget;
        if (
          !(target instanceof Element) ||
          !(related instanceof Node) ||
          !target.contains(related)
        ) {
          if (dependsOn("interaction", "focusWithin")) focusWithin(false);
          if (dependsOn("interaction", "focusVisible")) focusVisible(false);
        }
      },
      ref(element: Element) {
        options.refs[partName] = element;
        const elements = (options.partElements[partName] ??= new Set());
        elements.add(element);
        onCleanup(() => {
          elements.delete(element);
          if (options.refs[partName] === element) options.refs[partName] = null;
        });
        if (typeof HTMLElement !== "undefined" && element instanceof HTMLElement) {
          const releaseHover = registerVisualHover(
            element,
            dependsOn("interaction", "hovered") ? hovered : undefined,
          );
          onCleanup(releaseHover);
          if (dependsOn("geometry")) {
            const ResizeObserverClass = element.ownerDocument.defaultView?.ResizeObserver;
            if (ResizeObserverClass) {
              const observer = new ResizeObserverClass(([entry]) => {
                if (!entry) return;
                inlineSize(entry.contentRect.width);
                blockSize(entry.contentRect.height);
              });
              observer.observe(element);
              const rectangle = element.getBoundingClientRect();
              inlineSize(rectangle.width);
              blockSize(rectangle.height);
              onCleanup(() => observer.disconnect());
            }
          }
          bindVirtualCollectionHost(element, () =>
            visualPartCollection(
              options.compiledVisuals ?? {},
              options.preset(),
              componentName,
              partName,
              options.themeName(),
            ),
          );
        }
        return typeof authorRef === "function" ? authorRef(element) : undefined;
      },
    };
    if (typeof __POGGERS_HMR__ === "undefined" || __POGGERS_HMR__) {
      base["data-style-src"] = () => readAttributes()["data-style-src"];
    }
    return jsx(elementName, mergeProps(base, nativeProps));
  };
}

function semanticBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function interactionDisabled(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as EventTarget & {
    disabled?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  return element.disabled === true || element.getAttribute?.("aria-disabled") === "true";
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

function createVisualEnvironment(
  dependencies: ReadonlySet<string>,
  component: string,
  part: string,
): Readonly<Record<string, unknown>> {
  const queries: Readonly<Record<string, string>> = {
    reducedMotion: "(prefers-reduced-motion: reduce)",
    moreContrast: "(prefers-contrast: more)",
    forcedColors: "(forced-colors: active)",
    dark: "(prefers-color-scheme: dark)",
    hover: "(hover: hover)",
    finePointer: "(pointer: fine)",
    coarsePointer: "(pointer: coarse)",
  };
  const values: Record<string, Signal<boolean>> = {};
  for (const [name, query] of Object.entries(queries)) {
    if (!dependencies.has(`environment.${name}`)) continue;
    const media = typeof matchMedia === "function" ? matchMedia(query) : undefined;
    const value = signal(media?.matches ?? false, `${component}.${part}.environment.${name}`);
    values[name] = value;
    if (media) {
      onMount(() => {
        const change = (event: MediaQueryListEvent) => value(event.matches);
        media.addEventListener("change", change);
        return () => media.removeEventListener("change", change);
      });
    }
  }
  return Object.defineProperties(
    {},
    Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, { enumerable: true, get: value }]),
    ),
  ) as Readonly<Record<string, unknown>>;
}

function normalizeRuntimeParts<Spec extends AppSpec>(
  components?: ComponentRuntimeParts<Spec>,
): RuntimeComponentParts {
  const result: RuntimeComponentParts = {};
  for (const [componentName, config] of Object.entries(components ?? {})) {
    const runtimeConfig = config as RuntimeComponentConfig;
    const parts: Record<string, string> = {};
    for (const [partName, elementName] of Object.entries(runtimeConfig.parts ?? {})) {
      if (typeof elementName === "string") parts[partName] = elementName;
    }
    result[componentName] = {
      parts,
      values: runtimeConfig.values,
      inputCallbacks: runtimeConfig.inputCallbacks,
    };
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

function presetSupportsTheme(
  compiled: CompiledVisuals | undefined,
  preset: string,
  theme: string,
): boolean {
  if (theme === "default") return true;
  return Object.hasOwn(compiled?.[preset]?.themes ?? {}, theme);
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
