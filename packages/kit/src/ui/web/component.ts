import { endBatch, startBatch } from "alien-signals";

import {
  defineApp,
  type ActorOf,
  type App,
  type AppDef,
  type AppNavigation,
  type AppScreen,
  type AppSpec,
  type Client,
  type ComponentInput,
  type ComponentName,
  type ComponentRenderScope,
  type ComponentState,
  type FeatureAPIOf,
  type ResourceFor,
  type ResourceName,
  type UISignal,
} from "#kernel/app";
import {
  featureComponentName,
  featureResourceName,
  type InstantiatedFeatureAPIs,
} from "#kernel/feature";
import type { ConnectOpts } from "#substrate/client";
import {
  createComponentActor,
  type ComponentActor,
  type StatechartDefinition,
  type StatechartNode,
  type StatechartSnapshot,
  type StatechartSettlementDriver,
  type StatechartTask,
  type StatechartTransitions,
} from "#ui/machine.xstate";
import type { PresetAppearance, PresetName, PresetThemeName } from "#ui/preset";
import { PresenceScene } from "#ui/web/scene";

declare const __POGGERS_HMR__: boolean;
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
} from "#ui/web/runtime";
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
} from "#ui/web/visual-runtime";

type HookName<Name extends string> = `use${Capitalize<Name>}`;

const STATE_CHANGED_ACTION = "@poggers/state.changed";

export type ComponentRuntimeParts<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: {
    readonly parts: Record<string, string>;
    readonly state?: readonly {
      readonly name: keyof ComponentState<Spec, Component> & string;
      readonly writable?: boolean;
    }[];
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
    readonly api: Readonly<FeatureAPIOf<Spec>>;
    readonly components: {
      readonly [Component in ComponentName<Spec>]: ComponentRenderScope<
        Spec,
        Component
      >["components"][Component];
    };
    start(connect?: ConnectOpts | (() => Promise<Client<Spec>>)): Promise<void>;
    dispose(): void;
    renderRoot(): Child;
  };

export type AppInput<Spec extends AppSpec> = App<Spec> | AppDef<Spec>;

export type CreateHooksOpts<Spec extends AppSpec> = {
  app: AppInput<Spec>;
  styles: StylesDef<Spec>;
  components?: ComponentRuntimeParts<Spec>;
  compiledVisuals?: CompiledVisuals;
  dependencyGroups?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

type RuntimeComponentConfig = {
  parts: Record<string, string>;
  state?: readonly { readonly name: string; readonly writable?: boolean }[];
  inputCallbacks?: readonly string[];
};

type RuntimeComponentParts = Record<string, RuntimeComponentConfig>;

type RuntimeHookInput = Record<string, unknown>;

type RuntimeComponentDefinition = {
  state?: (scope: RuntimeComponentStateScope) => Record<string, unknown>;
  machine?: {
    context?: Record<string, unknown>;
    initial?: string;
    on?: Readonly<Record<string, StatechartTransitions>>;
    phases?: Readonly<Record<string, RuntimeComponentPhaseNode>>;
    tasks?: Record<string, StatechartTask>;
  };
  view?: (scope: RuntimeComponentRenderScope) => Child;
};

type RuntimeComponentPhaseNode = Omit<StatechartNode, "states"> & {
  readonly phases?: Readonly<Record<string, RuntimeComponentPhaseNode>>;
};

type RuntimeComponentStateScope = {
  readonly input: Record<string, unknown>;
  readonly api: Readonly<Record<string, unknown>>;
  readonly appearance: Readonly<Record<string, unknown>>;
  readonly screen: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly phase: unknown;
  readonly active: readonly string[];
  readonly parameters: Readonly<Record<string, unknown>>;
};

type RuntimeMachineState = {
  readonly paths: readonly string[];
  readonly value: unknown;
  readonly active: readonly string[];
  readonly done: boolean;
  readonly output: unknown;
  readonly error: unknown;
  matches(path: string): boolean;
  can(event: string, ...args: readonly unknown[]): boolean;
  subscribe(observer: (state: RuntimeMachineState) => void): () => void;
};

type RuntimeComponentComposition = {
  readonly components: Record<string, (props?: RuntimeHookInput) => Child>;
  readonly componentGroups: Readonly<
    Record<string, Record<string, (props?: RuntimeHookInput) => Child>>
  >;
  readonly featureComponents: Readonly<Record<string, Record<string, unknown>>>;
  readonly dependencyGroups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly api: Readonly<Record<string, unknown>>;
  readonly apis: InstantiatedFeatureAPIs;
  readonly navigation: Record<string, (...args: unknown[]) => void>;
  readonly screen: () => unknown;
  readonly featureNavigation: Readonly<
    Record<
      string,
      {
        readonly actions: Record<string, (...args: unknown[]) => void>;
        readonly destinations: Readonly<Record<string, string>>;
      }
    >
  >;
};

type RuntimeComponentRenderScope = {
  readonly state: Readonly<Record<string, unknown>>;
  readonly actions: Record<string, (...args: unknown[]) => void>;
  readonly slots: Record<string, unknown>;
  readonly parts: Record<string, Component<Props>>;
  readonly components: RuntimeComponentComposition["components"];
  readonly features: Record<string, unknown>;
};

export function createHooks<Spec extends AppSpec>({
  app,
  styles,
  components,
  compiledVisuals,
  dependencyGroups = {},
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
    dispose: runtime.dispose,
  };

  const componentRenderers = Object.create(null) as RuntimeComponentComposition["components"];
  const allResources = Object.create(null) as Record<
    string,
    (key: unknown) => Record<string, unknown>
  >;
  for (const resourceName of Object.keys(runtimeApp.def.resources)) {
    allResources[resourceName] = (key) =>
      createDynamicResource(() => runtime.api.useResource(resourceName as never, key as never));
  }
  const apis = runtimeApp.createAPIs({
    actor: { id: "local" } as ActorOf<Spec>,
    resolveResource(path, name) {
      return allResources[path ? featureResourceName(path, name) : name];
    },
  });
  hooks.api = apis.api;
  const componentGroups: Record<string, Record<string, (props?: RuntimeHookInput) => Child>> = {
    "": Object.create(null),
  };
  const featureComponents: Record<string, Record<string, unknown>> = { "": Object.create(null) };
  const composition: RuntimeComponentComposition = {
    components: componentGroups[""]!,
    componentGroups,
    featureComponents,
    dependencyGroups,
    api: apis.api,
    apis,
    navigation: runtime.api.nav as RuntimeComponentComposition["navigation"],
    screen: runtime.api.useScreen,
    featureNavigation: collectFeatureNavigation(
      runtimeApp.def.features as unknown as Record<string, RuntimeFeatureNavigation> | undefined,
      runtime.api.nav as RuntimeComponentComposition["navigation"],
    ),
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
  for (const [name, renderer] of Object.entries(componentRenderers)) {
    if (!name.startsWith("@feature/")) componentGroups[""]![name] = renderer;
  }
  featureComponents[""] = collectFeatureComponentScopes(
    runtimeApp.def.features as unknown as Record<string, RuntimeFeatureComposition> | undefined,
    componentRenderers,
    componentGroups,
    featureComponents,
  );
  hooks.components = componentGroups[""];

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

function createComponentInstance<Spec extends AppSpec>(
  componentName: string,
  options: {
    app: App<Spec>;
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
  const componentEntry = resolveComponentDefinition(options.app, componentName);
  const definition =
    componentEntry && typeof componentEntry === "object"
      ? (componentEntry as RuntimeComponentDefinition)
      : undefined;
  const machine = definition?.machine;
  const statechartDefinition = machine?.phases
    ? {
        initial: machine.initial,
        on: machine.on,
        states: adaptComponentPhases(machine.phases),
      }
    : machine?.on
      ? {
          initial: "active",
          states: { active: { on: machine.on } },
        }
      : undefined;
  const signals = Object.create(null) as Record<string, Signal<unknown>>;
  const refs = Object.create(null) as Record<string, Element | null>;
  const partElements = Object.create(null) as Record<string, Set<Element>>;
  const sharedScene = currentPresenceScene();
  const scene = sharedScene ?? new PresenceScene<Element>();
  const sceneOwner = allocateSceneOwner(componentName);
  const context = createContextObject(signals);
  const initialContext = cloneComponentContext(machine?.context ?? {});

  for (const [name, value] of Object.entries(initialContext)) {
    signals[name] = signal(value, `component:${componentName}:context:${name}`);
  }

  const actions = Object.create(null) as Record<string, (...args: unknown[]) => void>;
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
  const services = componentServices({ ...options, componentName, parameters });
  const machineStateSignal = signal<RuntimeMachineState>(
    createStaticState(),
    `component:${componentName}:machine`,
  );
  const stateScope = Object.assign(pickServices(services, ["api", "appearance", "screen"]), {
    input,
    context,
    parameters,
  }) as RuntimeComponentStateScope;
  Object.defineProperties(stateScope, {
    phase: { enumerable: true, get: () => machineStateSignal().value },
    active: { enumerable: true, get: () => machineStateSignal().active },
  });
  const readStateSource = definition?.state
    ? computed(() => asRecord(definition.state!(stateScope)))
    : () => ({});
  const stateNames =
    options.config.state?.map(({ name }) => name) ??
    Object.keys(Object.getOwnPropertyDescriptors(untrack(readStateSource)));
  const writableStateNames = new Set(
    options.config.state?.filter(({ writable }) => writable).map(({ name }) => name) ?? [],
  );
  const stateRuntime = createReactiveState(
    componentName,
    readStateSource,
    stateNames,
    writableStateNames,
  );
  const state = stateRuntime.read;
  const settlement = createSettlementPort(componentName);
  const actor = statechartDefinition
    ? createRestoredComponentActor(
        {
          id: componentName,
          definition: statechartDefinition,
          input,
          context: { ...context },
          tasks: machine?.tasks,
          settle: settlement.wait,
          services: { state, parameters },
          taskServices: Object.assign(
            pickServices(services, [
              "api",
              "appearance",
              "setAppearance",
              "navigation",
              "dependencies",
            ]),
            { state },
          ),
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
  const machineState = actorController?.state ?? machineStateSignal();
  machineStateSignal(machineState);

  if (actor && statechartDefinition) {
    for (const name of collectStatechartEventNames(statechartDefinition)) {
      actions[name] = (...args: unknown[]) =>
        settlement.transition(() => actor.send(name, ...args));
    }
  }

  const visualState = createComponentValuesObject(stateNames, (name) => state[name]);
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
      state: machineState,
      values: visualState,
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
    if (!definition?.view) {
      throw new Error(`Component ${componentName} does not define view.`);
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
      state: machineState,
      visualValues: visualState,
      writableValues: stateRuntime.writable,
      refs,
      partElements,
      suppressInitialEnter,
      settlement,
      actions,
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
        let disposed = false;
        let scheduled = false;
        const scheduleStateMicrostep = () => {
          if (scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            if (disposed) return;
            settlement.transition(() => actor?.send(STATE_CHANGED_ACTION));
          });
        };
        const stopStateBridges = stateNames.map((name) => {
          let initialized = false;
          let previous: unknown;
          return effect(() => {
            const current = readStateField(readStateSource(), name);
            if (!initialized) {
              initialized = true;
              previous = current;
              return;
            }
            if (Object.is(previous, current)) return;
            previous = current;
            scheduleStateMicrostep();
          });
        });
        return () => {
          disposed = true;
          for (const stop of stopStateBridges) stop();
          actorController.dispose();
        };
      });
    }
    onMount(() => () => {
      for (const partName of Object.keys(refs)) refs[partName] = null;
      for (const elements of Object.values(partElements)) elements.clear();
      if (!sharedScene) scene.dispose();
    });
    const renderScope: RuntimeComponentRenderScope = {
      state,
      actions,
      slots,
      parts,
      features: featureComponentsForComponent(componentName, options.composition),
      components: componentsForComponent(componentName, options.composition),
    };
    return definition.view(renderScope);
  };

  return renderComponent;
}

function adaptComponentPhases(
  phases: Readonly<Record<string, RuntimeComponentPhaseNode>>,
): Readonly<Record<string, StatechartNode>> {
  return Object.fromEntries(
    Object.entries(phases).map(([name, node]) => {
      const { phases: children, ...definition } = node;
      return [
        name,
        children ? { ...definition, states: adaptComponentPhases(children) } : definition,
      ];
    }),
  );
}

function componentServices(options: {
  componentName: string;
  appearance: () => { readonly preset: string; readonly theme: string };
  setAppearance: (appearance: { readonly preset: string; readonly theme: string }) => void;
  composition: RuntimeComponentComposition;
  parameters: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const services = {
    setAppearance: options.setAppearance,
    navigation: componentNavigation(options.componentName, options.composition),
    api: featureAPIForComponent(options.componentName, options.composition),
    dependencies: dependenciesForComponent(options.componentName, options.composition),
  } as Record<string, unknown>;
  Object.defineProperties(services, {
    appearance: { enumerable: true, get: options.appearance },
    screen: {
      enumerable: true,
      get: () => componentScreen(options.componentName, options.composition),
    },
    parameters: { enumerable: true, get: () => options.parameters },
  });
  return services;
}

type RuntimeFeatureNavigation = {
  readonly navigation?: Readonly<Record<string, string>>;
  readonly features?: Readonly<Record<string, RuntimeFeatureNavigation>>;
};

function collectFeatureNavigation(
  features: Readonly<Record<string, RuntimeFeatureNavigation>> | undefined,
  application: RuntimeComponentComposition["navigation"],
): RuntimeComponentComposition["featureNavigation"] {
  const result: Record<
    string,
    {
      actions: Record<string, (...args: unknown[]) => void>;
      destinations: Readonly<Record<string, string>>;
    }
  > = {};
  const visit = (
    children: Readonly<Record<string, RuntimeFeatureNavigation>>,
    parent: string,
  ): void => {
    for (const name of Object.keys(children).sort()) {
      const feature = children[name];
      if (!feature) continue;
      const path = parent ? `${parent}.${name}` : name;
      const destinations = Object.freeze({ ...feature.navigation });
      const actions = Object.fromEntries(
        Object.entries(destinations).map(([local, destination]) => {
          const navigate = application[destination];
          if (!navigate) {
            throw new Error(
              `Feature ${path} navigation ${local} maps to unknown application destination ${destination}.`,
            );
          }
          return [local, navigate];
        }),
      );
      result[path] = { actions, destinations };
      if (feature.features) visit(feature.features, path);
    }
  };
  if (features) visit(features, "");
  return result;
}

function componentOwner(component: string): string | undefined {
  if (!component.startsWith("@feature/")) return;
  const separator = component.indexOf("/component/");
  return separator < 0 ? undefined : component.slice("@feature/".length, separator);
}

type RuntimeFeatureComposition = {
  readonly components?: Readonly<Record<string, unknown>>;
  readonly features?: Readonly<Record<string, RuntimeFeatureComposition>>;
};

function resolveComponentDefinition<Spec extends AppSpec>(
  app: App<Spec>,
  component: string,
): unknown {
  const owner = componentOwner(component);
  if (!owner) {
    return (app.def.components as Readonly<Record<string, unknown>> | undefined)?.[component];
  }

  let feature: RuntimeFeatureComposition | undefined;
  let features = app.def.features as
    | Readonly<Record<string, RuntimeFeatureComposition>>
    | undefined;
  for (const name of owner.split(".")) {
    feature = features?.[name];
    if (!feature) return undefined;
    features = feature.features;
  }

  const separator = component.indexOf("/component/");
  const name = separator < 0 ? component : component.slice(separator + "/component/".length);
  return feature?.components?.[name];
}

function collectFeatureComponentScopes(
  features: Readonly<Record<string, RuntimeFeatureComposition>> | undefined,
  renderers: RuntimeComponentComposition["components"],
  componentGroups: Record<string, Record<string, (props?: RuntimeHookInput) => Child>>,
  featureComponents: Record<string, Record<string, unknown>>,
  parent = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(features ?? {}).sort()) {
    const feature = features?.[name];
    if (!feature) continue;
    const path = parent ? `${parent}.${name}` : name;
    const localComponents: Record<string, (props?: RuntimeHookInput) => Child> =
      Object.create(null);
    for (const component of Object.keys(feature.components ?? {}).sort()) {
      const renderer = renderers[featureComponentName(path, component)];
      if (!renderer)
        throw new Error(`Missing renderer for Feature component ${path}.${component}.`);
      localComponents[component] = renderer;
    }
    const children = collectFeatureComponentScopes(
      feature.features,
      renderers,
      componentGroups,
      featureComponents,
      path,
    );
    for (const child of Object.keys(children)) {
      if (child in localComponents) {
        throw new Error(`Feature ${path} uses ${child} as both a component and child Feature.`);
      }
    }
    componentGroups[path] = localComponents;
    featureComponents[path] = children;
    result[name] = Object.assign(Object.create(null), localComponents, children);
  }
  return result;
}

function componentsForComponent(
  component: string,
  composition: RuntimeComponentComposition,
): RuntimeComponentComposition["components"] {
  return composition.componentGroups[componentOwner(component) ?? ""] ?? {};
}

function featureComponentsForComponent(
  component: string,
  composition: RuntimeComponentComposition,
): Record<string, unknown> {
  return composition.featureComponents[componentOwner(component) ?? ""] ?? {};
}

function componentNavigation(
  component: string,
  composition: RuntimeComponentComposition,
): Record<string, (...args: unknown[]) => void> {
  const owner = componentOwner(component);
  return owner ? (composition.featureNavigation[owner]?.actions ?? {}) : composition.navigation;
}

function componentScreen(component: string, composition: RuntimeComponentComposition): unknown {
  const owner = componentOwner(component);
  if (!owner) return composition.screen();
  const current = composition.screen();
  if (!current || typeof current !== "object") return null;
  const name = (current as { readonly name?: unknown }).name;
  if (typeof name !== "string") return null;
  const destinations = composition.featureNavigation[owner]?.destinations ?? {};
  const local = Object.entries(destinations).find(([, destination]) => destination === name)?.[0];
  return local ? { ...(current as Record<string, unknown>), name: local } : null;
}

function featureAPIForComponent(
  component: string,
  composition: RuntimeComponentComposition,
): Readonly<Record<string, unknown>> {
  const path = componentOwner(component);
  if (!path) return composition.api;
  let current = composition.apis;
  for (const segment of path.split(".")) {
    const child = current.features[segment];
    if (!child) throw new Error(`Missing semantic API for Feature ${path}.`);
    current = child;
  }
  return current.api;
}

function dependenciesForComponent(
  component: string,
  composition: RuntimeComponentComposition,
): Readonly<Record<string, unknown>> {
  return composition.dependencyGroups[componentOwner(component) ?? "application"] ?? {};
}

function mountCompiledVisualComponent(options: {
  componentName: string;
  compiledVisuals?: CompiledVisuals;
  preset: () => string;
  themeName: () => string;
  state: RuntimeMachineState;
  visualValues: Record<string, unknown>;
  writableValues: Record<string, unknown>;
  refs: Record<string, Element | null>;
  partElements: Record<string, Set<Element>>;
  suppressInitialEnter: boolean;
  settlement: SettlementPort;
  actions: Readonly<Record<string, unknown>>;
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
      actions: options.actions,
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
): { state: RuntimeMachineState; start: () => void; dispose: () => void } {
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
  const observers = new Set<(state: RuntimeMachineState) => void>();

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
  const state: RuntimeMachineState = {
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

function createStaticState(): RuntimeMachineState {
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

function pickServices(
  services: Readonly<Record<string, unknown>>,
  names: readonly string[],
): Record<string, unknown> {
  const selected = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(services, name);
    if (descriptor) Object.defineProperty(selected, name, descriptor);
  }
  return selected;
}

function createReactiveState(
  component: string,
  source: () => Record<string, unknown>,
  names: readonly string[],
  writableNames: ReadonlySet<string>,
): {
  readonly read: Readonly<Record<string, unknown>>;
  readonly writable: Record<string, unknown>;
} {
  const read = Object.create(null) as Record<string, unknown>;
  const writable = Object.create(null) as Record<string, unknown>;
  const initialSource = untrack(source);

  for (const name of names) {
    const readSourceValue = () => {
      return readStateField(source(), name);
    };

    if (writableNames.has(name)) {
      const descriptor = Object.getOwnPropertyDescriptor(initialSource, name);
      const initial = descriptor
        ? typeof descriptor.get === "function"
          ? descriptor.get.call(initialSource)
          : descriptor.value
        : undefined;
      const value = signal(initial, `component:${component}:state:${name}`);
      Object.defineProperty(read, name, { enumerable: true, get: value });
      Object.defineProperty(writable, name, {
        enumerable: true,
        get: value,
        set: value,
      });
      continue;
    }

    const value = computed(readSourceValue);
    const initial = value();
    const reactive =
      initial != null && typeof initial === "object" ? reactiveValue(value) : undefined;
    Object.defineProperty(read, name, {
      enumerable: true,
      get() {
        return reactive ?? value();
      },
    });
  }

  return { read: Object.freeze(read), writable };
}

function readStateField(source: Record<string, unknown>, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor) return undefined;
  return typeof descriptor.get === "function" ? descriptor.get.call(source) : descriptor.value;
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
    state: RuntimeMachineState;
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
    state: RuntimeMachineState;
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
    const stateContext = Object.defineProperties(
      {},
      Object.fromEntries(
        options.state.paths.map((path) => [
          path,
          { enumerable: true, get: () => options.state.matches(path) },
        ]),
      ),
    ) as Readonly<Record<string, boolean>>;
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
          states: stateContext,
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
          if (dependsOn("interaction", "hovered")) {
            onCleanup(registerVisualHover(element, hovered));
          }
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
      state: runtimeConfig.state,
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
