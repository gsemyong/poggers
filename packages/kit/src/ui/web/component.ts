import { endBatch, startBatch } from "alien-signals";

import { PresenceScene } from "#ui/web/scene";

import type { Application, ApplicationContract } from "../../application";
import {
  createProgramContributionInstance,
  RuntimeScope,
  scopeCapabilities,
  type ProgramAddress,
  type ProgramContributionInstance,
} from "../../runtime";
import type {
  ComponentInput,
  ComponentName,
  ComponentState,
  PresentationAppearance,
  PresentationName,
} from "../component";

declare const __POGGERS_HMR__: boolean;
import {
  computed,
  bindVirtualCollectionHost,
  allocateSceneOwner,
  currentPresenceScene,
  currentStructuralKey,
  effect,
  isHotRefresh,
  jsx,
  onCleanup,
  onMount,
  signal,
  type Child,
  type Component,
  type Props,
  type HotRenderState,
  type Signal,
} from "#ui/web/runtime";
import {
  createVisualCoordinator,
  isCompiledVisualPresentation,
  registerVisualHover,
  visualPartAttributes,
  visualPartCollection,
  visualPartDependencies,
  visualPartPresence,
  type VisualActionMode,
  type VisualActionInvoker,
  type VisualCoordinator,
  type CompiledVisuals,
} from "#ui/web/visual-runtime";

export type ComponentRuntimeParts<Contract extends ApplicationContract> = {
  [Name in ComponentName<Contract>]?: {
    readonly parts: Record<string, string>;
    readonly state?: readonly {
      readonly name: keyof ComponentState<Contract, Name> & string;
    }[];
    readonly inputCallbacks?: readonly (keyof ComponentInput<Contract, Name> & string)[];
  };
};

export type PresentationsDefinition<Contract extends ApplicationContract> = Readonly<{
  defaultPresentation?: PresentationName<Contract>;
  presentations: Partial<Record<PresentationName<Contract>, unknown>>;
}>;

export type ApplicationUI<Contract extends ApplicationContract> = Readonly<{
  process: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  presentation: Signal<PresentationAppearance<Contract>>;
  setPresentation(appearance: PresentationAppearance<Contract>): void;
  components: RuntimeComponentComposition["components"];
  renderRoot(): Child;
  captureHotState(): HotRenderState;
  updateCompiledVisuals(compiled: CompiledVisuals): boolean;
  dispose(): Promise<void>;
}>;

export type CreateApplicationUIOptions<Contract extends ApplicationContract> = Readonly<{
  application: Application<Contract>;
  program: string;
  presentations: PresentationsDefinition<Contract>;
  components?: ComponentRuntimeParts<Contract>;
  compiledVisuals?: CompiledVisuals;
  hotState?: HotRenderState;
  resolveCapabilities?(address: ProgramAddress): Readonly<Record<string, unknown>>;
}>;

type RuntimeComponentConfig = {
  parts: Record<string, string>;
  state?: readonly { readonly name: string }[];
  inputCallbacks?: readonly string[];
};

type RuntimeComponentParts = Record<string, RuntimeComponentConfig>;
type RuntimeHookInput = Record<string, unknown>;
type RuntimeFeature = Readonly<{
  programs?: Readonly<Record<string, RuntimeProgramDefinition>>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;
type RuntimeApplication = Readonly<{
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeProgramDefinition = Readonly<{
  start?: (scope: Record<string, unknown>) => unknown;
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<
    Record<string, (scope: Record<string, unknown>, ...args: readonly unknown[]) => unknown>
  >;
  components?: Readonly<Record<string, RuntimeComponentDefinition>>;
  root?: string;
}>;

type RuntimeComponentDefinition = {
  state?:
    | Readonly<Record<string, unknown>>
    | ((scope: RuntimeComponentStateScope) => Readonly<Record<string, unknown>>);
  actions?: Readonly<
    Record<string, (scope: Record<string, unknown>, ...args: readonly unknown[]) => unknown>
  >;
  start?: (scope: Record<string, unknown>) => unknown;
  view?: (scope: RuntimeComponentRenderScope) => Child;
};

type RuntimeComponentStateScope = {
  readonly input: Record<string, unknown>;
  readonly process: Readonly<Record<string, unknown>>;
  readonly presentation: Readonly<Record<string, unknown>>;
};

type RuntimeComponentComposition = {
  readonly components: Record<string, (props?: RuntimeHookInput) => Child>;
  readonly componentGroups: Record<string, Record<string, (props?: RuntimeHookInput) => Child>>;
  readonly componentNamespaces: Record<string, Record<string, unknown>>;
  readonly surfaces: Record<string, Readonly<Record<string, unknown>>>;
  readonly capabilities: Record<string, Readonly<Record<string, unknown>>>;
  readonly lifecycles: Set<RuntimeScope>;
};

type RuntimeComponentRenderScope = {
  readonly input: Readonly<Record<string, unknown>>;
  readonly process: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly actions: Record<string, (...args: unknown[]) => void>;
  readonly slots: Record<string, unknown>;
  readonly parts: Record<string, Component<Props>>;
  readonly components: Record<string, unknown>;
};

export function createApplicationUI<Contract extends ApplicationContract>({
  application,
  program,
  presentations,
  components,
  compiledVisuals,
  hotState,
  resolveCapabilities,
}: CreateApplicationUIOptions<Contract>): ApplicationUI<Contract> {
  const runtimeApplication = application as RuntimeApplication;
  const compiled = { ...compiledVisuals } as Record<string, CompiledVisuals[string]>;
  const visualRevision = signal(0);
  const defaultPresentation = firstPresentation(presentations);
  const presentation = signal({
    presentation: defaultPresentation,
    theme: "default",
  } as PresentationAppearance<Contract>);
  const presentationName = () => String(presentation().presentation);
  const themeName = () => presentation().theme;
  const runtimeParts = normalizeRuntimeParts(components);
  const renderers: Record<string, (props?: RuntimeHookInput) => Child> = Object.create(null);
  const componentGroups: RuntimeComponentComposition["componentGroups"] = {
    "": Object.create(null),
  };
  const componentNamespaces: RuntimeComponentComposition["componentNamespaces"] = {
    "": Object.create(null),
  };
  const selectPresentation = (next: PresentationAppearance<Contract>) => {
    const name = String(next.presentation);
    if (!(name in presentations.presentations)) {
      throw new Error(`Unknown Presentation "${name}".`);
    }
    if (!presentationSupportsTheme(compiled, name, next.theme)) {
      throw new Error(`Presentation "${name}" does not define theme "${next.theme}".`);
    }
    presentation(next);
    updateRootPresentation(name);
    updateRootTheme(next.theme);
  };
  const programUI = createProgramUI(
    runtimeApplication,
    program,
    (address) => ({
      ...resolveCapabilities?.(address),
      presentation: { select: selectPresentation },
    }),
    hotState,
  );
  const composition: RuntimeComponentComposition = {
    components: componentGroups[""]!,
    componentGroups,
    componentNamespaces,
    surfaces: programUI.surfaces,
    capabilities: programUI.capabilities,
    lifecycles: new Set(),
  };

  for (const componentName of collectComponentNames(runtimeApplication, program, runtimeParts)) {
    renderers[componentName] = (props: RuntimeHookInput = {}) =>
      createComponentInstance(componentName, {
        application: runtimeApplication,
        program,
        presentation: () => presentation() as Readonly<Record<string, unknown>>,
        setPresentation: (next) => selectPresentation(next as PresentationAppearance<Contract>),
        presentationName,
        themeName,
        config: runtimeParts[componentName] ?? { parts: {} },
        compiledVisuals: compiled,
        visualRevision,
        input: props,
        composition,
      })(props as Props);
  }

  for (const [name, renderer] of Object.entries(renderers)) {
    if (!name.startsWith("@feature/")) componentGroups[""]![name] = renderer;
  }
  componentNamespaces[""] = collectFeatureComponentScopes(
    runtimeApplication.features,
    program,
    renderers,
    componentGroups,
    componentNamespaces,
  );
  updateRootPresentation(defaultPresentation);

  return {
    process: programUI.surface,
    features: programUI.features,
    presentation,
    setPresentation: selectPresentation,
    components: componentGroups[""]!,
    renderRoot() {
      const rootName = collectProgramRoots(runtimeApplication, program);
      const root = renderers[rootName];
      if (!root) throw new Error(`Unknown root Component "${rootName}".`);
      return root();
    },
    captureHotState: programUI.captureHotState,
    updateCompiledVisuals(next) {
      if (compiledCollectionShape(compiled) !== compiledCollectionShape(next)) return false;
      for (const name of Object.keys(compiled)) delete compiled[name];
      Object.assign(compiled, next);
      visualRevision(visualRevision() + 1);
      return true;
    },
    async dispose() {
      const componentResults = await Promise.allSettled(
        [...composition.lifecycles].map((lifecycle) => lifecycle.dispose()),
      );
      const errors = componentResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      try {
        await programUI.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Application UI disposal failed.");
    },
  };
}

function compiledCollectionShape(compiled: CompiledVisuals): string {
  const collections: string[] = [];
  for (const [presentation, definition] of Object.entries(compiled)) {
    for (const [component, parts] of Object.entries(definition.components)) {
      for (const [part, visual] of Object.entries(parts)) {
        if (visual.collection !== undefined)
          collections.push(`${presentation}.${component}.${part}`);
      }
    }
  }
  return collections.sort().join("\n");
}

function createComponentInstance(
  componentName: string,
  options: {
    application: RuntimeApplication;
    program: string;
    presentation: () => Readonly<Record<string, unknown>>;
    setPresentation: (appearance: Readonly<Record<string, unknown>>) => void;
    presentationName: () => string;
    themeName: () => string;
    config: RuntimeComponentConfig;
    compiledVisuals?: CompiledVisuals;
    visualRevision: () => number;
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
  const componentEntry = resolveComponentDefinition(
    options.application,
    options.program,
    componentName,
  );
  const definition =
    componentEntry && typeof componentEntry === "object"
      ? (componentEntry as RuntimeComponentDefinition)
      : undefined;
  const signals = Object.create(null) as Record<string, Signal<unknown>>;
  const refs = Object.create(null) as Record<string, Element | null>;
  const partElements = Object.create(null) as Record<string, Set<Element>>;
  const sharedScene = currentPresenceScene();
  const scene = sharedScene ?? new PresenceScene<Element>();
  const sceneOwner = allocateSceneOwner(componentName);
  const owner = componentOwner(componentName) ?? "";
  const lifecycle = new RuntimeScope();
  options.composition.lifecycles.add(lifecycle);
  let lifecycleDisposal: Promise<void> | undefined;
  const disposeLifecycle = () => {
    lifecycleDisposal ??= lifecycle.dispose().finally(() => {
      options.composition.lifecycles.delete(lifecycle);
    });
    return lifecycleDisposal;
  };
  let visualCoordinator: VisualCoordinator | undefined;
  const capabilities = scopeCapabilities(options.composition.capabilities[owner] ?? {}, lifecycle);
  const actions = Object.create(null) as Record<string, (...args: unknown[]) => unknown>;
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
  const services = componentServices({ ...options, componentName, parameters });
  const stateScope = Object.assign(pickServices(services, ["process", "presentation"]), {
    input,
  }) as RuntimeComponentStateScope;
  const stateSource =
    typeof definition?.state === "function" ? definition.state(stateScope) : definition?.state;
  const initialState = materializeComponentState(stateSource ?? {});
  const stateNames = options.config.state?.map(({ name }) => name) ?? Object.keys(initialState);
  for (const name of stateNames) {
    signals[name] = signal(initialState[name], `component:${componentName}:state:${name}`);
  }
  const stateRuntime = createComponentState(signals, stateNames, () => lifecycle.active);
  const state = stateRuntime.read;
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

  const actionScope = Object.assign(pickServices(services, ["process", "presentation"]), {
    input,
    capabilities,
    state: stateRuntime.mutable,
    parameters,
    parts,
  });
  const invokeAction = (
    name: string,
    args: readonly unknown[],
    mode: VisualActionMode = "discrete",
  ) => {
    const implementation = definition?.actions?.[name];
    if (typeof implementation !== "function") return;
    if (mode === "discrete") visualCoordinator?.captureLayouts();
    try {
      return lifecycle.action(() =>
        Reflect.apply(implementation, undefined, [actionScope, ...args]),
      );
    } finally {
      if (mode === "discrete") visualCoordinator?.animateLayouts();
    }
  };
  for (const [name, implementation] of Object.entries(definition?.actions ?? {})) {
    if (typeof implementation === "function") {
      actions[name] = (...args: unknown[]) => invokeAction(name, args);
    }
  }

  for (const [partName, elementName] of Object.entries(options.config.parts)) {
    parts[partName] = createComponentPartComponent(componentName, partName, elementName, {
      refs,
      partElements,
      process: services.process as Readonly<Record<string, unknown>>,
      values: visualState,
      motion: visualMotion,
      compiledVisuals: options.compiledVisuals,
      visualRevision: options.visualRevision,
      presentation: options.presentationName,
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
      visualRevision: options.visualRevision,
      presentation: options.presentationName,
      themeName: options.themeName,
      process: services.process as Readonly<Record<string, unknown>>,
      visualValues: visualState,
      refs,
      partElements,
      suppressInitialEnter,
      invokeAction,
      onParametersChange: updateParameters,
      onMotionChange(source, value) {
        (motionSignals[source] ??= signal(
          undefined as number | undefined,
          `component:${componentName}:motion:${source}`,
        ))(value);
      },
      onCoordinator(coordinator) {
        visualCoordinator = coordinator;
      },
    });
    if (definition.start) {
      onMount(() => {
        lifecycle.adopt(
          definition.start?.(
            Object.assign(pickServices(services, ["process", "presentation"]), {
              input,
              capabilities,
              actions,
              parameters,
              parts,
            }),
          ),
        );
        return () => void disposeLifecycle();
      });
    } else {
      onMount(() => () => void disposeLifecycle());
    }
    onMount(() => () => {
      for (const partName of Object.keys(refs)) refs[partName] = null;
      for (const elements of Object.values(partElements)) elements.clear();
      if (!sharedScene) scene.dispose();
    });
    const renderScope: RuntimeComponentRenderScope = {
      input,
      process: services.process as Readonly<Record<string, unknown>>,
      state,
      actions,
      slots,
      parts,
      components: componentsForComponent(componentName, options.composition),
    };
    return definition.view(renderScope);
  };

  return renderComponent;
}

function componentServices(options: {
  componentName: string;
  presentation: () => Readonly<Record<string, unknown>>;
  setPresentation: (appearance: Readonly<Record<string, unknown>>) => void;
  composition: RuntimeComponentComposition;
  parameters: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const services = {
    setPresentation: options.setPresentation,
    process: options.composition.surfaces[componentOwner(options.componentName) ?? ""] ?? {},
  } as Record<string, unknown>;
  Object.defineProperties(services, {
    presentation: { enumerable: true, get: options.presentation },
    parameters: { enumerable: true, get: () => options.parameters },
  });
  return services;
}

function componentOwner(component: string): string | undefined {
  if (!component.startsWith("@feature/")) return;
  const separator = component.indexOf("/component/");
  return separator < 0 ? undefined : component.slice("@feature/".length, separator);
}

function featureComponentName(path: string, component: string): string {
  return `@feature/${path}/component/${component}`;
}

function resolveComponentDefinition(
  application: RuntimeApplication,
  program: string,
  component: string,
): unknown {
  const owner = componentOwner(component);
  if (!owner) return undefined;

  let feature: RuntimeFeature | undefined;
  let features = application.features;
  for (const name of owner.split(".")) {
    feature = features?.[name];
    if (!feature) return undefined;
    features = feature.features;
  }

  const separator = component.indexOf("/component/");
  const name = component.slice(separator + "/component/".length);
  return feature?.programs?.[program]?.components?.[name];
}

function collectFeatureComponentScopes(
  features: Readonly<Record<string, RuntimeFeature>> | undefined,
  program: string,
  renderers: RuntimeComponentComposition["components"],
  componentGroups: RuntimeComponentComposition["componentGroups"],
  componentNamespaces: RuntimeComponentComposition["componentNamespaces"],
  parent = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(features ?? {}).sort()) {
    const feature = features?.[name];
    if (!feature) continue;
    const path = parent ? `${parent}.${name}` : name;
    const local: Record<string, (props?: RuntimeHookInput) => Child> = Object.create(null);
    for (const component of Object.keys(feature.programs?.[program]?.components ?? {}).sort()) {
      const renderer = renderers[featureComponentName(path, component)];
      if (!renderer) throw new Error(`Missing renderer for Component ${path}.${component}.`);
      local[component] = renderer;
    }
    const children = collectFeatureComponentScopes(
      feature.features,
      program,
      renderers,
      componentGroups,
      componentNamespaces,
      path,
    );
    for (const child of Object.keys(children)) {
      if (child in local) throw new Error(`Component namespace collision at ${path}.${child}.`);
    }
    const scope = Object.assign(Object.create(null), local, children);
    componentGroups[path] = local;
    componentNamespaces[path] = scope;
    result[capitalize(name)] = scope;
  }
  return result;
}

function componentsForComponent(
  component: string,
  composition: RuntimeComponentComposition,
): Record<string, unknown> {
  const owner = componentOwner(component) ?? "";
  return Object.assign(
    Object.create(null),
    composition.componentGroups[owner] ?? {},
    composition.componentNamespaces[owner] ?? {},
  );
}

function mountCompiledVisualComponent(options: {
  componentName: string;
  compiledVisuals?: CompiledVisuals;
  visualRevision: () => number;
  presentation: () => string;
  themeName: () => string;
  process: Readonly<Record<string, unknown>>;
  visualValues: Record<string, unknown>;
  refs: Record<string, Element | null>;
  partElements: Record<string, Set<Element>>;
  suppressInitialEnter: boolean;
  invokeAction: VisualActionInvoker;
  onParametersChange(parameters: Readonly<Record<string, unknown>>): void;
  onMotionChange(source: string, value: number): void;
  onCoordinator(coordinator: VisualCoordinator | undefined): void;
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
      invokeAction: options.invokeAction,
      onParametersChange: options.onParametersChange,
    });
    options.onCoordinator(coordinator);
    const disposeEffect = effect(() => {
      options.visualRevision();
      const presentation = options.presentation();
      if (!isCompiledVisualPresentation(options.compiledVisuals, presentation)) return;
      coordinator.update({
        presentation,
        theme: options.themeName(),
        states: {},
        process: options.process,
        values: options.visualValues,
      });
    });
    return () => {
      options.onCoordinator(undefined);
      disposeEffect();
      coordinator.dispose();
    };
  });
}

function materializeComponentState(
  source: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const state = Object.fromEntries(
    Object.keys(Object.getOwnPropertyDescriptors(source)).map((name) => [
      name,
      readStateField(source, name),
    ]),
  );
  try {
    return structuredClone(state);
  } catch {
    return state;
  }
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

function createComponentState(
  signals: Readonly<Record<string, Signal<unknown>>>,
  names: readonly string[],
  active: () => boolean,
): {
  readonly read: Readonly<Record<string, unknown>>;
  readonly mutable: Record<string, unknown>;
} {
  const read = Object.create(null) as Record<string, unknown>;
  const mutable = Object.create(null) as Record<string, unknown>;

  for (const name of names) {
    const value = signals[name];
    if (!value) continue;
    Object.defineProperty(read, name, { enumerable: true, get: value });
    Object.defineProperty(mutable, name, {
      enumerable: true,
      get: value,
      set(next) {
        if (active()) value(next);
      },
    });
  }

  return { read: Object.freeze(read), mutable };
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
    process: Readonly<Record<string, unknown>>;
    values: Record<string, unknown>;
    motion: Readonly<Record<string, number | undefined>>;
    compiledVisuals?: CompiledVisuals;
    visualRevision: () => number;
    presentation: () => string;
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
    process: Readonly<Record<string, unknown>>;
    values: Record<string, unknown>;
    motion: Readonly<Record<string, number | undefined>>;
    presentation: () => string;
    themeName: () => string;
    compiledVisuals?: CompiledVisuals;
    visualRevision: () => number;
    scene: PresenceScene<Element>;
    sceneOwner: string;
  },
) {
  return (props: Props = {}) => {
    const { ref: authorRef, ...nativeProps } = props;
    const dependencies = new Set<string>();
    const refreshDependencies = () => {
      dependencies.clear();
      for (const presentation of Object.keys(options.compiledVisuals ?? {})) {
        for (const dependency of visualPartDependencies(
          options.compiledVisuals ?? {},
          presentation,
          componentName,
          partName,
        )) {
          dependencies.add(dependency);
        }
      }
    };
    refreshDependencies();
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
    effect(() => {
      options.visualRevision();
      refreshDependencies();
      environment.refresh();
    });
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
    const stateContext = Object.freeze({}) as Readonly<Record<string, boolean>>;
    const structuralChildren =
      typeof nativeProps.children === "function" &&
      Boolean(
        visualPartCollection(
          options.compiledVisuals ?? {},
          options.presentation(),
          componentName,
          partName,
          options.themeName(),
        ),
      );
    const readAttributes = computed(() => {
      options.visualRevision();
      return visualPartAttributes(
        options.compiledVisuals ?? {},
        options.presentation(),
        componentName,
        partName,
        {
          theme: options.themeName(),
          states: stateContext,
          process: options.process,
          values: options.values,
          interaction: interactionContext,
          geometry: geometryContext,
          environment: environment.context,
          motion: options.motion,
        },
      );
    });
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
        options.visualRevision();
        return visualPartPresence(
          options.compiledVisuals ?? {},
          options.presentation(),
          componentName,
          partName,
        )?.lifecycle;
      },
      "data-motion-layout"() {
        options.visualRevision();
        return visualPartPresence(
          options.compiledVisuals ?? {},
          options.presentation(),
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
              const view = element.ownerDocument.defaultView;
              let frame: number | undefined;
              const observer = new ResizeObserverClass(([entry]) => {
                if (!entry) return;
                const { width, height } = entry.contentRect;
                if (frame !== undefined) view?.cancelAnimationFrame(frame);
                frame = view?.requestAnimationFrame(() => {
                  frame = undefined;
                  inlineSize(width);
                  blockSize(height);
                });
              });
              observer.observe(element);
              const rectangle = element.getBoundingClientRect();
              inlineSize(rectangle.width);
              blockSize(rectangle.height);
              onCleanup(() => {
                if (frame !== undefined) view?.cancelAnimationFrame(frame);
                observer.disconnect();
              });
            }
          }
          bindVirtualCollectionHost(element, () =>
            visualPartCollection(
              options.compiledVisuals ?? {},
              options.presentation(),
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
): Readonly<{
  context: Readonly<Record<string, unknown>>;
  refresh(): void;
}> {
  const queries: Readonly<Record<string, string>> = {
    reducedMotion: "(prefers-reduced-motion: reduce)",
    moreContrast: "(prefers-contrast: more)",
    forcedColors: "(forced-colors: active)",
    dark: "(prefers-color-scheme: dark)",
    hover: "(hover: hover)",
    finePointer: "(pointer: fine)",
    coarsePointer: "(pointer: coarse)",
  };
  const active = new Set<string>();
  const values = new Map<string, Signal<boolean>>();
  const releases = new Map<string, () => void>();
  let mounted = false;

  const ensureValue = (name: string) => {
    const existing = values.get(name);
    if (existing) return existing;
    const query = queries[name];
    const media = query && typeof matchMedia === "function" ? matchMedia(query) : undefined;
    const value = signal(media?.matches ?? false, `${component}.${part}.environment.${name}`);
    values.set(name, value);
    return value;
  };
  const attach = (name: string) => {
    if (!mounted || releases.has(name)) return;
    const query = queries[name];
    const value = ensureValue(name);
    const media = query && typeof matchMedia === "function" ? matchMedia(query) : undefined;
    if (!media) return;
    value(media.matches);
    const change = (event: MediaQueryListEvent) => value(event.matches);
    media.addEventListener("change", change);
    releases.set(name, () => media.removeEventListener("change", change));
  };
  const detach = (name: string) => {
    releases.get(name)?.();
    releases.delete(name);
  };
  const refresh = () => {
    const next = new Set(
      Object.keys(queries).filter((name) => dependencies.has(`environment.${name}`)),
    );
    for (const name of active) {
      if (next.has(name)) continue;
      active.delete(name);
      detach(name);
    }
    for (const name of next) {
      active.add(name);
      ensureValue(name);
      attach(name);
    }
  };
  const context = new Proxy(Object.create(null), {
    get(_target, property) {
      if (typeof property !== "string" || !active.has(property)) return undefined;
      return values.get(property)?.();
    },
    ownKeys() {
      return [...active];
    },
    getOwnPropertyDescriptor(_target, property) {
      return typeof property === "string" && active.has(property)
        ? { enumerable: true, configurable: true }
        : undefined;
    },
  }) as Readonly<Record<string, unknown>>;

  refresh();
  onMount(() => {
    mounted = true;
    refresh();
    return () => {
      mounted = false;
      for (const name of releases.keys()) detach(name);
    };
  });
  return { context, refresh };
}

function normalizeRuntimeParts<Contract extends ApplicationContract>(
  components?: ComponentRuntimeParts<Contract>,
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

function createProgramUI(
  application: RuntimeApplication,
  program: string,
  resolveCapabilities: (address: ProgramAddress) => Readonly<Record<string, unknown>>,
  hotState?: HotRenderState,
): {
  surface: Readonly<Record<string, unknown>>;
  features: Record<string, Readonly<Record<string, unknown>>>;
  surfaces: Record<string, Readonly<Record<string, unknown>>>;
  capabilities: Record<string, Readonly<Record<string, unknown>>>;
  captureHotState(): HotRenderState;
  dispose(): Promise<void>;
} {
  const surfaces: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const instances: ProgramContributionInstance[] = [];
  const providedCapabilities: Record<string, unknown> = Object.create(null);
  const uiInstances = new Map<string, ProgramContributionInstance["ui"]>();
  const capabilities: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);

  const instantiate = (
    feature: RuntimeFeature,
    path: string,
  ): Readonly<Record<string, unknown>> => {
    const children: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
    for (const [name, child] of Object.entries(feature.features ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      children[name] = instantiate(child, path ? `${path}.${name}` : name);
    }

    const definition = feature.programs?.[program];
    if (!definition) {
      const empty = Object.freeze(Object.create(null) as Record<string, unknown>);
      surfaces[path] = empty;
      return empty;
    }

    const address = { program, feature: path };
    const externalCapabilities = resolveCapabilities(address);
    const instance = createProgramContributionInstance(definition as never, {
      address,
      capabilities: { ...externalCapabilities, ...providedCapabilities },
      features: children,
      initialState: hotState?.programs?.[path],
    });
    instances.push(instance);
    uiInstances.set(path, instance.ui);
    capabilities[path] = instance.capabilities;
    const provided = instance.start();
    for (const [name, capability] of Object.entries(provided)) {
      if (Object.hasOwn(providedCapabilities, name)) {
        throw new Error(`UI Program "${program}" has multiple providers for Capability "${name}".`);
      }
      providedCapabilities[name] = capability;
    }
    const surface = instance.ui?.surface ?? Object.freeze({});
    surfaces[path] = surface;
    return surface;
  };

  try {
    for (const [name, feature] of Object.entries(application.features ?? {}).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      instantiate(feature, name);
    }
  } catch (error) {
    void Promise.allSettled([...instances].reverse().map((instance) => instance.dispose()));
    throw error;
  }

  const root = collectProgramRoots(application, program);
  const owner = componentOwner(root);
  const surface = owner ? (surfaces[owner] ?? Object.freeze({})) : Object.freeze({});

  let disposed = false;
  return {
    surface,
    features: Object.fromEntries(
      Object.keys(application.features ?? {}).map((name) => [name, surfaces[name] ?? {}]),
    ),
    surfaces,
    capabilities,
    captureHotState() {
      const state = hotState ?? {};
      state.programs = Object.fromEntries(
        [...uiInstances].flatMap(([path, ui]) => (ui ? [[path, ui.snapshot()]] : [])),
      );
      return state;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      this.captureHotState();
      const errors: unknown[] = [];
      for (const instance of [...instances].reverse()) {
        try {
          await instance.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "UI Process disposal failed.");
    },
  };
}

function collectComponentNames(
  application: RuntimeApplication,
  program: string,
  parts: RuntimeComponentParts,
): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(parts)) names.add(name);
  const visit = (
    features: Readonly<Record<string, RuntimeFeature>> | undefined,
    parent: string,
  ) => {
    for (const [name, feature] of Object.entries(features ?? {})) {
      const path = parent ? `${parent}.${name}` : name;
      for (const component of Object.keys(feature.programs?.[program]?.components ?? {})) {
        names.add(featureComponentName(path, component));
      }
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  return [...names];
}

function collectProgramRoots(application: RuntimeApplication, program: string): string {
  const roots: string[] = [];
  const visit = (
    features: Readonly<Record<string, RuntimeFeature>> | undefined,
    parent: string,
  ) => {
    for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const path = parent ? `${parent}.${name}` : name;
      const root = feature.programs?.[program]?.root;
      if (root) roots.push(featureComponentName(path, root));
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  if (roots.length !== 1) {
    throw new Error(
      `UI Program "${program}" must define exactly one root Component; found ${roots.length}.`,
    );
  }
  return roots[0]!;
}

function firstPresentation<Contract extends ApplicationContract>(
  presentations: PresentationsDefinition<Contract>,
): string {
  const explicit = presentations.defaultPresentation;
  if (explicit) return String(explicit);
  return Object.keys(presentations.presentations)[0] ?? "default";
}

function presentationSupportsTheme(
  compiled: CompiledVisuals | undefined,
  presentation: string,
  theme: string,
): boolean {
  if (theme === "default") return true;
  return Object.hasOwn(compiled?.[presentation]?.themes ?? {}, theme);
}

function updateRootPresentation(presentation: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.presentation = presentation;
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
