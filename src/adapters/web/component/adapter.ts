import type { ProgramContributionAddress } from "../../../contracts/capability";
import type { Application, ApplicationContract, PresentationName } from "../../../core/application";
import type { ComponentProps, ComponentName, ComponentState } from "../../../core/component";
import type { PresentationAdapter } from "../../../core/presentation";
import {
  bindCapabilitiesToScope,
  createProgramContributionInstance,
  ResourceScope,
  type ProgramContributionInstance,
} from "../../../core/process";
import { createReactiveState } from "../../../core/state";
import type { WebElementPresentation, WebPresentationLanguage } from "../presentation/language";
import { PresenceGraph } from "./presence";
import {
  allocatePresenceOwner,
  captureSignalOnHotRefresh,
  currentPresenceGraph,
  currentStructuralKey,
  effect,
  jsx,
  onCleanup,
  onMount,
  signal,
  type Child,
  type Component,
  type Props,
  type HotRenderState,
} from "./runtime";

export type ComponentRuntimeElements<Contract extends ApplicationContract> = {
  [Name in ComponentName<Contract>]?: {
    readonly elements: Record<string, string>;
    readonly state?: readonly {
      readonly name: keyof ComponentState<Contract, Name> & string;
    }[];
    readonly propCallbacks?: readonly (keyof ComponentProps<Contract, Name> & string)[];
  };
};

export type PresentationsDefinition<Contract extends ApplicationContract> = Readonly<{
  defaultPresentation?: PresentationName<Contract>;
  presentations: Partial<Record<PresentationName<Contract>, object>>;
}>;

export type ApplicationUI = Readonly<{
  api: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  components: RuntimeComponentComposition["components"];
  renderRoot(): Child;
  captureHotState(): HotRenderState;
  updatePresentations(presentations: Readonly<Record<string, object>>): boolean;
  dispose(): Promise<void>;
}>;

export type CreateApplicationUIOptions<Contract extends ApplicationContract> = Readonly<{
  application: Application<Contract>;
  program: string;
  presentations: PresentationsDefinition<Contract>;
  components?: ComponentRuntimeElements<Contract>;
  hotState?: HotRenderState;
  resolveCapabilities?(address: ProgramContributionAddress): Readonly<Record<string, unknown>>;
  presentationAdapter: PresentationAdapter<WebPresentationLanguage, Element>;
}>;

export type WebComponentAdapter = Readonly<{
  createApplicationUI<Contract extends ApplicationContract>(
    options: Omit<CreateApplicationUIOptions<Contract>, "presentationAdapter">,
  ): ApplicationUI;
}>;

type RuntimeComponentConfig = {
  elements: Record<string, string>;
  state?: readonly { readonly name: string }[];
  propCallbacks?: readonly string[];
};

type RuntimeComponentContracts = Record<string, RuntimeComponentConfig>;
type RuntimeComponentProps = Record<string, unknown>;
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
    | ((input: RuntimeComponentStateInput) => Readonly<Record<string, unknown>>);
  actions?: Readonly<
    Record<string, (scope: Record<string, unknown>, ...args: readonly unknown[]) => unknown>
  >;
  mount?: (scope: Record<string, unknown>) => unknown;
  view?: (context: RuntimeComponentViewContext) => Child;
};

type RuntimeComponentStateInput = {
  readonly props: Record<string, unknown>;
  readonly feature: Readonly<Record<string, unknown>>;
};

type RuntimeComponentComposition = {
  readonly components: Record<string, (props?: RuntimeComponentProps) => Child>;
  readonly componentGroups: Record<
    string,
    Record<string, (props?: RuntimeComponentProps) => Child>
  >;
  readonly componentNamespaces: Record<string, Record<string, unknown>>;
  readonly apis: Record<string, Readonly<Record<string, unknown>>>;
  readonly capabilities: Record<string, Readonly<Record<string, unknown>>>;
  readonly lifecycles: Set<ResourceScope>;
};

type RuntimeComponentViewContext = {
  readonly props: Readonly<Record<string, unknown>>;
  readonly feature: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly actions: Record<string, (...args: unknown[]) => void>;
  readonly slots: Record<string, unknown>;
  readonly elements: Record<string, Component<Props>>;
  readonly components: Record<string, unknown>;
};

export function createApplicationUI<Contract extends ApplicationContract>({
  application,
  program,
  presentations,
  components,
  hotState,
  resolveCapabilities,
  presentationAdapter,
}: CreateApplicationUIOptions<Contract>): ApplicationUI {
  const runtimeApplication = application as RuntimeApplication;
  const authoredPresentations = {
    ...presentations.presentations,
  } as Record<string, object>;
  validatePresentations(authoredPresentations);
  const presentationRevision = signal(0);
  const defaultPresentation = firstPresentation(presentations);
  const presentationName = () => defaultPresentation;
  const runtimeComponents = normalizeRuntimeComponents(components);
  const renderers: Record<string, (props?: RuntimeComponentProps) => Child> = Object.create(null);
  const componentGroups: RuntimeComponentComposition["componentGroups"] = {
    "": Object.create(null),
  };
  const componentNamespaces: RuntimeComponentComposition["componentNamespaces"] = {
    "": Object.create(null),
  };
  const programUI = createProgramUI(
    runtimeApplication,
    program,
    (address) => ({ ...resolveCapabilities?.(address) }),
    hotState,
  );
  const composition: RuntimeComponentComposition = {
    components: componentGroups[""]!,
    componentGroups,
    componentNamespaces,
    apis: programUI.apis,
    capabilities: programUI.capabilities,
    lifecycles: new Set(),
  };

  for (const componentName of collectComponentNames(
    runtimeApplication,
    program,
    runtimeComponents,
  )) {
    renderers[componentName] = (props: RuntimeComponentProps = {}) =>
      createComponentInstance(componentName, {
        application: runtimeApplication,
        program,
        presentationName,
        config: runtimeComponents[componentName] ?? { elements: {} },
        authoredPresentations,
        presentationRevision,
        presentationAdapter,
        props,
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
    api: programUI.api,
    features: programUI.features,
    components: componentGroups[""]!,
    renderRoot() {
      const rootName = collectProgramRoots(runtimeApplication, program);
      const root = renderers[rootName];
      if (!root) throw new Error(`Unknown root Component "${rootName}".`);
      return root();
    },
    captureHotState: programUI.captureHotState,
    updatePresentations(next) {
      if (
        Object.keys(authoredPresentations).sort().join("\n") !== Object.keys(next).sort().join("\n")
      ) {
        return false;
      }
      validatePresentations(next);
      for (const name of Object.keys(authoredPresentations)) delete authoredPresentations[name];
      Object.assign(authoredPresentations, next);
      presentationRevision(presentationRevision() + 1);
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

function createComponentInstance(
  componentName: string,
  options: {
    application: RuntimeApplication;
    program: string;
    presentationName: () => string;
    config: RuntimeComponentConfig;
    authoredPresentations: Readonly<Record<string, unknown>>;
    presentationRevision: () => number;
    presentationAdapter: PresentationAdapter<WebPresentationLanguage, Element>;
    props: RuntimeComponentProps;
    composition: RuntimeComponentComposition;
  },
) {
  const callbacks = new Set(options.config.propCallbacks ?? []);
  const readProp = (name: string, value: unknown) =>
    typeof value === "function" && !callbacks.has(name) ? value() : value;
  const props = Object.create(null) as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(options.props),
  )) {
    Object.defineProperty(props, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        const value = descriptor.get ? descriptor.get.call(options.props) : descriptor.value;
        return readProp(name, value);
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
  const refs = Object.create(null) as Record<string, Element | null>;
  const mountedTargets = Object.create(null) as Record<string, Set<Element>>;
  const sharedScene = currentPresenceGraph();
  const scene = sharedScene ?? new PresenceGraph<Element>();
  const sceneOwner = allocatePresenceOwner(componentName);
  const owner = componentOwner(componentName) ?? "";
  const lifecycle = new ResourceScope();
  options.composition.lifecycles.add(lifecycle);
  let lifecycleDisposal: Promise<void> | undefined;
  const disposeLifecycle = () => {
    lifecycleDisposal ??= lifecycle.dispose().finally(() => {
      options.composition.lifecycles.delete(lifecycle);
    });
    return lifecycleDisposal;
  };
  const capabilities = bindCapabilitiesToScope(
    options.composition.capabilities[owner] ?? {},
    lifecycle,
  );
  const actions = Object.create(null) as Record<string, (...args: unknown[]) => unknown>;
  const services = componentServices({ ...options, componentName });
  const stateInput = Object.assign(pickServices(services, ["feature"]), {
    props,
  }) as RuntimeComponentStateInput;
  const stateSource =
    typeof definition?.state === "function" ? definition.state(stateInput) : definition?.state;
  const initialState = materializeComponentState(stateSource ?? {});
  const stateNames = options.config.state?.map(({ name }) => name) ?? Object.keys(initialState);
  const stateRuntime = createReactiveState(
    Object.fromEntries(stateNames.map((name) => [name, initialState[name]])),
    (value, path) => signal(value, `component:${componentName}:state:${path}`),
    () => lifecycle.active,
  );
  for (const [name, cell] of Object.entries(stateRuntime.cells)) {
    captureSignalOnHotRefresh(cell, () => stateRuntime.snapshot()[name]);
  }
  const state = stateRuntime.read;
  const elements = Object.create(null) as Record<string, Component<Props>>;

  const actionContext = Object.assign(pickServices(services, ["feature"]), {
    props,
    capabilities,
    state: stateRuntime.mutable,
    elements,
  });
  const invokeAction = (name: string, args: readonly unknown[]) => {
    const implementation = definition?.actions?.[name];
    if (typeof implementation !== "function") return;
    return lifecycle.action(() =>
      Reflect.apply(implementation, undefined, [actionContext, ...args]),
    );
  };
  for (const [name, implementation] of Object.entries(definition?.actions ?? {})) {
    if (typeof implementation === "function") {
      actions[name] = (...args: unknown[]) => invokeAction(name, args);
    }
  }

  for (const [elementName, tagName] of Object.entries(options.config.elements)) {
    elements[elementName] = createComponentElementComponent(componentName, elementName, tagName, {
      refs,
      mountedTargets,
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
    mountAuthoredPresentationComponent({
      componentName,
      presentations: options.authoredPresentations,
      presentationRevision: options.presentationRevision,
      presentation: options.presentationName,
      props,
      state: createPresentationState(services.feature as Readonly<Record<string, unknown>>, state),
      refs,
      mountedTargets,
      targets: Object.fromEntries(
        Object.keys(options.config.elements).map((name) => [name, { name }]),
      ),
      adapter: options.presentationAdapter,
    });
    if (definition.mount) {
      onMount(() => {
        lifecycle.adopt(
          definition.mount?.(
            Object.assign(pickServices(services, ["feature"]), {
              props,
              capabilities,
              state,
              actions,
              elements,
            }),
          ),
        );
        return () => void disposeLifecycle();
      });
    } else {
      onMount(() => () => void disposeLifecycle());
    }
    onMount(() => () => {
      for (const elementName of Object.keys(refs)) refs[elementName] = null;
      for (const targets of Object.values(mountedTargets)) targets.clear();
      if (!sharedScene) scene.dispose();
    });
    const viewContext: RuntimeComponentViewContext = {
      props,
      feature: services.feature as Readonly<Record<string, unknown>>,
      state,
      actions,
      slots,
      elements,
      components: componentsForComponent(componentName, options.composition),
    };
    return definition.view(viewContext);
  };

  return renderComponent;
}

function componentServices(options: {
  componentName: string;
  composition: RuntimeComponentComposition;
}): Readonly<Record<string, unknown>> {
  return {
    feature: options.composition.apis[componentOwner(options.componentName) ?? ""] ?? {},
  };
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
    const local: Record<string, (props?: RuntimeComponentProps) => Child> = Object.create(null);
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

type RuntimePresentationComponent = (scope: {
  readonly props: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly targets: Readonly<Record<string, Readonly<{ name: string }>>>;
}) => Readonly<Record<string, WebElementPresentation>>;

function mountAuthoredPresentationComponent(options: {
  componentName: string;
  presentations: Readonly<Record<string, unknown>>;
  presentationRevision: () => number;
  presentation: () => string;
  props: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  refs: Readonly<Record<string, Element | null>>;
  mountedTargets: Readonly<Record<string, ReadonlySet<Element>>>;
  targets: Readonly<Record<string, Readonly<{ name: string }>>>;
  adapter: PresentationAdapter<WebPresentationLanguage, Element>;
}): void {
  onMount(() => {
    const boundary = options.mountedTargets.Root?.values().next().value ?? options.refs.Root;
    if (!(boundary instanceof Element)) return;
    const targetSources = Object.fromEntries(
      Object.keys(options.targets).map((name) => [
        name,
        () => {
          const repeated = options.mountedTargets[name];
          if (repeated?.size) return [...repeated].filter((element) => element.isConnected);
          const first = options.refs[name];
          return first?.isConnected ? [first] : [];
        },
      ]),
    );
    const session = options.adapter.create({ boundary, targets: targetSources });
    const disposeEffect = effect(() => {
      options.presentationRevision();
      const definition = presentationDefinition(options.presentations, options.presentation());
      if (!definition) return;
      const component = presentationComponent(definition, options.componentName);
      if (!component) {
        session.commit({});
        return;
      }
      session.commit(
        component({
          props: options.props,
          state: options.state,
          targets: options.targets,
        }),
      );
    });
    return () => {
      disposeEffect();
      session.dispose();
    };
  });
}

function presentationDefinition(
  presentations: Readonly<Record<string, unknown>>,
  presentation: string,
): Readonly<Record<string, unknown>> | undefined {
  const definition = record(presentations[presentation]);
  return Object.keys(definition).length ? definition : undefined;
}

function presentationComponent(
  definition: Readonly<Record<string, unknown>>,
  component: string,
): RuntimePresentationComponent | undefined {
  let components = definition;
  const owner = componentOwner(component);
  if (owner) {
    for (const name of owner.split(".")) components = record(components[capitalize(name)]);
  }
  const separator = component.indexOf("/component/");
  const name = separator < 0 ? component : component.slice(separator + "/component/".length);
  const factory = components[name];
  return typeof factory === "function" ? (factory as RuntimePresentationComponent) : undefined;
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

function createComponentElementComponent(
  componentName: string,
  name: string,
  tagName: string,
  options: {
    refs: Record<string, Element | null>;
    mountedTargets: Record<string, Set<Element>>;
    scene: PresenceGraph<Element>;
    sceneOwner: string;
  },
) {
  const element = ((props: Props = {}) => {
    const { ref: authorRef, ...nativeProps } = props;
    return jsx(tagName, {
      __poggersScene: {
        scene: options.scene,
        owner: options.sceneOwner,
        element: name,
        key: currentStructuralKey(),
      },
      ref(target: Element) {
        options.refs[name] = target;
        const targets = (options.mountedTargets[name] ??= new Set());
        targets.add(target);
        onCleanup(() => {
          targets.delete(target);
          if (options.refs[name] === target) options.refs[name] = null;
        });
        return typeof authorRef === "function" ? authorRef(target) : undefined;
      },
      ...nativeProps,
    });
  }) as Component<Props> & {
    readonly element: Element | null;
    readonly elements: readonly Element[];
  };
  Object.defineProperties(element, {
    element: { get: () => options.refs[name] ?? null },
    elements: { get: () => [...(options.mountedTargets[name] ?? [])] },
  });
  return element;
}

function readStateField(source: Record<string, unknown>, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor) return undefined;
  return typeof descriptor.get === "function" ? descriptor.get.call(source) : descriptor.value;
}

function createPresentationState(
  feature: Readonly<Record<string, unknown>>,
  component: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      if (typeof name !== "string") return undefined;
      if (name in component) return component[name];
      const value = feature[name];
      return typeof value === "function" ? undefined : value;
    },
    ownKeys() {
      return [
        ...new Set([
          ...Object.keys(feature).filter((name) => typeof feature[name] !== "function"),
          ...Object.keys(component),
        ]),
      ];
    },
    getOwnPropertyDescriptor(_target, name) {
      return typeof name === "string" &&
        (name in component || (name in feature && typeof feature[name] !== "function"))
        ? { enumerable: true, configurable: true }
        : undefined;
    },
  });
}

function normalizeRuntimeComponents<Contract extends ApplicationContract>(
  components?: ComponentRuntimeElements<Contract>,
): RuntimeComponentContracts {
  const result: RuntimeComponentContracts = {};
  for (const [componentName, config] of Object.entries(components ?? {})) {
    const runtimeConfig = config as RuntimeComponentConfig;
    const elements: Record<string, string> = {};
    for (const [elementName, tagName] of Object.entries(runtimeConfig.elements ?? {})) {
      if (typeof tagName === "string") elements[elementName] = tagName;
    }
    result[componentName] = {
      elements,
      state: runtimeConfig.state,
      propCallbacks: runtimeConfig.propCallbacks,
    };
  }
  return result;
}

function createProgramUI(
  application: RuntimeApplication,
  program: string,
  resolveCapabilities: (address: ProgramContributionAddress) => Readonly<Record<string, unknown>>,
  hotState?: HotRenderState,
): {
  api: Readonly<Record<string, unknown>>;
  features: Record<string, Readonly<Record<string, unknown>>>;
  apis: Record<string, Readonly<Record<string, unknown>>>;
  capabilities: Record<string, Readonly<Record<string, unknown>>>;
  captureHotState(): HotRenderState;
  dispose(): Promise<void>;
} {
  const apis: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
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
      apis[path] = empty;
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
    const api = instance.ui?.api ?? Object.freeze({});
    apis[path] = api;
    return api;
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
  const api = owner ? (apis[owner] ?? Object.freeze({})) : Object.freeze({});

  let disposed = false;
  return {
    api,
    features: Object.fromEntries(
      Object.keys(application.features ?? {}).map((name) => [name, apis[name] ?? {}]),
    ),
    apis,
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
  elements: RuntimeComponentContracts,
): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(elements)) names.add(name);
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

function validatePresentations(presentations: Readonly<Record<string, object>>): void {
  for (const [name, value] of Object.entries(presentations)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`Presentation "${name}" must be a definition object.`);
    }
  }
}

function updateRootPresentation(presentation: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.presentation = presentation;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
