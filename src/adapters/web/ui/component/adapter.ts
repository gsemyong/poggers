import {
  applyWebDocumentHead,
  consumeWebRouteHydration,
  isWebDeferredData,
  parseWebRouteData,
  validateWebDeferredFrame,
  WEB_ROUTE_DATA_MEDIA_TYPE,
  type WebRouteHydrationIR,
} from "@/adapters/web/document";
import {
  matchWebRoute,
  validateWebRouteMetadata,
  type WebRouteIR,
  type WebRouteMatch,
} from "@/adapters/web/routing";
import {
  allocatePresenceOwner,
  captureSignalOnHotRefresh,
  createDeferredResource,
  createHydratedDeferredResource,
  currentPresenceGraph,
  currentStructuralKey,
  effect,
  jsx,
  onCleanup,
  onMount,
  runtimeSignal,
  scoped,
  signal,
  isDeferredResource,
  type Child,
  type Component,
  type Props,
  type HotRenderState,
  type Signal,
} from "@/adapters/web/ui/component/runtime";
import { PresenceGraph } from "@/adapters/web/ui/presence";
import { publishWebDeferredState, readWebJSONLines } from "@/adapters/web/ui/stream";
import type { ProgramManifest } from "@/compiler/ir";
import type { PresentationAdapter, PresentationAdapterInstance } from "@/contracts/platform";
import type { System, SystemContract } from "@/core/system";
import type { ComponentProps, ComponentName, ComponentState } from "@/core/ui/component";
import type { WebElementPresentation, WebPresentationLanguage } from "@/platforms/web/presentation";
import type { WebDestination } from "@/platforms/web/routing";
import { createActionEventLedger } from "@/runtime/presentation";
import { assembleProgram, bindDependenciesToScope, ResourceScope } from "@/runtime/process";
import { createReactiveState } from "@/runtime/state";

export type ComponentRuntimeElements<Contract extends SystemContract> = {
  [Name in ComponentName<Contract>]?: {
    readonly elements: Record<string, string>;
    readonly state?: readonly {
      readonly name: keyof ComponentState<Contract, Name> & string;
    }[];
    readonly propCallbacks?: readonly (keyof ComponentProps<Contract, Name> & string)[];
  };
};

export type PresentationDependencyManifest = Readonly<
  Record<
    string,
    readonly Readonly<{
      destination: string;
      animations: readonly Readonly<{ id: string; scope: string }>[];
    }>[]
  >
>;

export type InterfaceUI = Readonly<{
  api: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  components: RuntimeComponentComposition["components"];
  renderRoot(): Child;
  captureHotState(): HotRenderState;
  updatePresentation(presentation: RuntimeConfiguredPresentation): void;
  dispose(): Promise<void>;
}>;

export type CreateInterfaceUIOptions<Contract extends SystemContract> = Readonly<{
  system: System<Contract>;
  interface: string;
  program: string;
  logicalProgram?: string;
  presentation: RuntimeConfiguredPresentation;
  /** @internal Compiler-derived temporal dependencies by runtime Component. */
  presentationDependencies?: PresentationDependencyManifest;
  components?: ComponentRuntimeElements<Contract>;
  hotState?: HotRenderState;
  dependencies?: Readonly<Record<string, unknown>>;
  programManifest?: ProgramManifest;
  routes?: readonly WebRouteIR[];
  /** @internal Lazily resolves the authored implementation for one compiler-known Route. */
  loadRoute?(route: WebRouteIR): Promise<RuntimeRouteDefinition>;
  /** @internal Route identities whose server data can start alongside their code chunk. */
  routeLoaders?: readonly string[];
  boundary: Element;
  presentationAdapter: PresentationAdapter<WebPresentationLanguage, Element>;
}>;

export type WebComponentAdapter = Readonly<{
  createInterfaceUI<Contract extends SystemContract>(
    options: Omit<CreateInterfaceUIOptions<Contract>, "presentationAdapter">,
  ): Promise<InterfaceUI>;
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
type RuntimeSystem = Readonly<{
  metadata?: Readonly<{ name?: string }>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

export type RuntimeConfiguredPresentation = Readonly<{
  parameters: Readonly<Record<string, unknown>>;
  create(configuration: {
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly environment: WebPresentationLanguage["Environment"];
    readonly state: Readonly<Record<string, unknown>>;
    readonly events: Readonly<Record<string, unknown>>;
  }): Readonly<Record<string, unknown>>;
}>;

type RuntimeProgramDefinition = Readonly<{
  start?: (scope: Record<string, unknown>) => unknown;
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<
    Record<string, (scope: Record<string, unknown>, ...args: readonly unknown[]) => unknown>
  >;
  components?: Readonly<Record<string, RuntimeComponentDefinition>>;
  routes?: Readonly<Record<string, RuntimeRouteDefinition>>;
  root?: string;
}>;

type RuntimeRouteDefinition = Readonly<{
  load?: (context: RuntimeRouteLoadContext) => unknown;
  view(context: RuntimeRouteViewContext): Child;
}>;

type RuntimeRouteLoadContext = Readonly<{
  dependencies: Readonly<Record<string, unknown>>;
  url: string;
  signal: AbortSignal;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
}>;

type RuntimeRouteViewContext = Readonly<{
  data: unknown;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  feature: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  components: Record<string, unknown>;
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
  readonly features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

type RuntimeComponentComposition = {
  readonly components: Record<string, (props?: RuntimeComponentProps) => Child>;
  readonly componentGroups: Record<
    string,
    Record<string, (props?: RuntimeComponentProps) => Child>
  >;
  readonly componentNamespaces: Record<string, Record<string, unknown>>;
  readonly apis: Record<string, Readonly<Record<string, unknown>>>;
  readonly dependencies: Record<string, Readonly<Record<string, unknown>>>;
  readonly events: Record<string, Readonly<Record<string, unknown>>>;
  readonly actionEventRevision: () => void;
  readonly lifecycles: Set<ResourceScope>;
};

type RuntimeComponentViewContext = {
  readonly props: Readonly<Record<string, unknown>>;
  readonly feature: Readonly<Record<string, unknown>>;
  readonly features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly actions: Record<string, (...args: unknown[]) => void>;
  readonly slots: Record<string, unknown>;
  readonly elements: Record<string, Component<Props>>;
  readonly components: Record<string, unknown>;
};

export async function createInterfaceUI<Contract extends SystemContract>({
  system,
  interface: interfacePath,
  program,
  logicalProgram = program,
  presentation,
  presentationDependencies,
  components,
  hotState,
  dependencies = {},
  programManifest,
  routes = [],
  loadRoute,
  routeLoaders,
  boundary,
  presentationAdapter,
}: CreateInterfaceUIOptions<Contract>): Promise<InterfaceUI> {
  const runtimeSystem = system as RuntimeSystem;
  let configuredPresentation = presentation;
  validatePresentation(configuredPresentation);
  const presentationInstance = presentationAdapter.mount({
    boundary,
    snapshot: hotState?.presentation,
  });
  const presentationRevision = signal(0);
  const eventRevision = signal(0);
  const notifyActionEvent = () => eventRevision(eventRevision() + 1);
  const runtimeComponents = normalizeRuntimeComponents(components);
  const renderers: Record<string, (props?: RuntimeComponentProps) => Child> = Object.create(null);
  const componentGroups: RuntimeComponentComposition["componentGroups"] = {
    "": Object.create(null),
  };
  const componentNamespaces: RuntimeComponentComposition["componentNamespaces"] = {
    "": Object.create(null),
  };
  const programUI = await createProgramUI(
    runtimeSystem,
    interfacePath,
    program,
    logicalProgram,
    dependencies,
    programManifest ??
      inferEmptyProgramManifest(runtimeSystem, interfacePath, program, logicalProgram),
    hotState,
    notifyActionEvent,
    routes.length > 0,
  );
  const composition: RuntimeComponentComposition = {
    components: componentGroups[""]!,
    componentGroups,
    componentNamespaces,
    apis: programUI.apis,
    dependencies: programUI.dependencies,
    events: programUI.events,
    actionEventRevision: notifyActionEvent,
    lifecycles: new Set(),
  };
  const presentationGraph = createPresentationGraph({
    system: runtimeSystem,
    interface: interfacePath,
    program,
    presentation: () => configuredPresentation,
    presentationRevision,
    adapter: presentationInstance,
    boundary,
    featureAPIs: programUI.apis,
    featureEvents: programUI.events,
    eventRevision,
    rootComponents: Object.keys(
      requireRuntimeFeature(runtimeSystem, interfacePath).programs?.[logicalProgram]?.components ??
        {},
    ).map((name) => featureComponentName(interfacePath, name)),
    dependencies: presentationDependencies,
  });

  for (const componentName of Object.keys(runtimeComponents).sort()) {
    renderers[componentName] = (props: RuntimeComponentProps = {}) =>
      createComponentInstance(componentName, {
        system: runtimeSystem,
        program: logicalProgram,
        config: runtimeComponents[componentName] ?? { elements: {} },
        presentationRevision,
        presentationInstance,
        presentationGraph,
        props,
        composition,
      })(props as Props);
  }

  const interfaceFeature = requireRuntimeFeature(runtimeSystem, interfacePath);
  const localComponents: Record<string, (props?: RuntimeComponentProps) => Child> =
    Object.create(null);
  for (const name of Object.keys(
    interfaceFeature.programs?.[logicalProgram]?.components ?? {},
  ).sort()) {
    const renderer = renderers[featureComponentName(interfacePath, name)];
    if (!renderer) throw new Error(`Missing renderer for Component ${interfacePath}.${name}.`);
    localComponents[name] = renderer;
  }
  componentGroups[interfacePath] = localComponents;
  const childComponents = collectFeatureComponentScopes(
    interfaceFeature.features,
    logicalProgram,
    renderers,
    componentGroups,
    componentNamespaces,
    interfacePath,
  );
  componentNamespaces[interfacePath] = childComponents;
  componentNamespaces[""] = Object.assign(Object.create(null), localComponents, childComponents);
  const router = routes.length
    ? await createRouteRuntime({
        system: runtimeSystem,
        program: logicalProgram,
        routes,
        dependencies,
        apis: programUI.apis,
        featureDependencies: programUI.dependencies,
        components: componentNamespaces[""]!,
        loadRoute,
        routeLoaders,
        boundary,
      })
    : undefined;
  const captureHotState = (): HotRenderState => {
    const state = programUI.captureHotState();
    state.presentation = presentationInstance.snapshot();
    return state;
  };

  return {
    api: programUI.api,
    features: programUI.features,
    components: localComponents,
    renderRoot() {
      if (router) return router.render();
      const rootName = collectProgramRoots(runtimeSystem, interfacePath, logicalProgram);
      if (!rootName)
        throw new Error(`UI Program ${JSON.stringify(program)} has no root Component.`);
      const root = renderers[rootName];
      if (!root) throw new Error(`Unknown root Component "${rootName}".`);
      return root();
    },
    captureHotState,
    updatePresentation(next) {
      validatePresentation(next);
      configuredPresentation = next;
      presentationRevision(presentationRevision() + 1);
    },
    async dispose() {
      captureHotState();
      const componentResults = await Promise.allSettled(
        [...composition.lifecycles].map((lifecycle) => lifecycle.dispose()),
      );
      const errors = componentResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      try {
        presentationGraph.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        router?.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await programUI.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        presentationInstance.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Interface UI disposal failed.");
    },
  };
}

async function createRouteRuntime(options: {
  system: RuntimeSystem;
  program: string;
  routes: readonly WebRouteIR[];
  dependencies: Readonly<Record<string, unknown>>;
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  featureDependencies: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  components: Record<string, unknown>;
  loadRoute?(route: WebRouteIR): Promise<RuntimeRouteDefinition>;
  routeLoaders?: readonly string[];
  boundary: Element;
}): Promise<Readonly<{ render(): Child; dispose(): void }>> {
  const navigation = options.dependencies.navigation as
    | Readonly<{
        current(): URL;
        navigate(destination: WebDestination & Readonly<{ replace?: boolean }>): void;
        subscribe(receive: (location: URL) => void): Disposable;
      }>
    | undefined;
  if (!navigation) throw new Error("A routed web Program requires the navigation Dependency.");
  const revision = signal(0);
  let generation = 0;
  let current:
    | Readonly<{
        match: WebRouteMatch;
        definition: RuntimeRouteDefinition;
        data: unknown;
        metadata: WebRouteIR["metadata"];
      }>
    | undefined;
  let failure: unknown;
  let disposed = false;
  let pending: AbortController | undefined;
  const hydration: WebRouteHydrationIR | undefined = consumeWebRouteHydration();
  const knownLoaders = options.routeLoaders ? new Set(options.routeLoaders) : undefined;
  const definitions = new Map<string, Promise<RuntimeRouteDefinition>>();
  const loadDefinition = (route: WebRouteIR): Promise<RuntimeRouteDefinition> => {
    const identity = routeIdentity(route);
    let definition = definitions.get(identity);
    if (!definition) {
      const requested = options.loadRoute
        ? options.loadRoute(route)
        : Promise.resolve(routeDefinition(options.system, options.program, route));
      definition = requested.catch((error: unknown) => {
        if (definitions.get(identity) === definition) definitions.delete(identity);
        throw error;
      });
      definitions.set(identity, definition);
    }
    return definition;
  };

  const resolve = async (location: URL): Promise<void> => {
    const ownGeneration = ++generation;
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    failure = undefined;
    try {
      let match = matchWebRoute(options.routes, location);
      if (!match) {
        invalidatePendingHydration(options.boundary);
        current = undefined;
        applyRouteMetadata(options.system, {});
        revision(revision() + 1);
        return;
      }
      let activeLocation = location;
      const hydrationPending = options.boundary.getAttribute?.("data-kit-rendering") === "hydrate";
      let seeded =
        hydrationPending && hydrationMatches(hydration, match, location) ? hydration : undefined;
      if (hydrationPending && !seeded) invalidatePendingHydration(options.boundary);
      let outcome: unknown;
      let definition: RuntimeRouteDefinition;
      for (let redirects = 0; ; redirects += 1) {
        if (redirects > 10) throw new Error("The Route state request redirected too many times.");
        const requested = match;
        const identity = routeIdentity(requested.route);
        const definitionTask = loadDefinition(requested.route);
        const serverDataTask =
          !seeded && requested.route.document === "content" && knownLoaders?.has(identity)
            ? requestWebRouteData(activeLocation, controller.signal)
            : undefined;
        definition = await definitionTask;
        if (controller.signal.aborted || disposed || ownGeneration !== generation) return;
        if (knownLoaders && knownLoaders.has(identity) !== Boolean(definition.load)) {
          throw new Error(
            `Browser Route module ${JSON.stringify(identity)} disagrees with its compiler manifest.`,
          );
        }
        if (seeded) {
          outcome = routeHydrationOutcome(seeded);
          break;
        }
        if (definition.load && requested.route.document === "content") {
          const remote = await (serverDataTask ??
            requestWebRouteData(activeLocation, controller.signal));
          if ("redirect" in remote) {
            activeLocation = remote.redirect;
            const remoteMatch = matchWebRoute(options.routes, activeLocation);
            if (!remoteMatch) throw new Error("The server redirected to an unknown Route.");
            history.replaceState(
              null,
              "",
              `${activeLocation.pathname}${activeLocation.search}${activeLocation.hash}`,
            );
            match = remoteMatch;
            continue;
          }
          activeLocation = new URL(remote.hydration.location, remote.url);
          const remoteMatch = matchWebRoute(options.routes, activeLocation);
          if (!remoteMatch || !hydrationMatches(remote.hydration, remoteMatch, activeLocation)) {
            throw new Error("The server returned Route state for a different location.");
          }
          if (
            activeLocation.pathname !== location.pathname ||
            activeLocation.search !== location.search
          ) {
            history.replaceState(
              null,
              "",
              `${activeLocation.pathname}${activeLocation.search}${remote.url.hash}`,
            );
          }
          match = remoteMatch;
          if (routeIdentity(match.route) !== identity)
            definition = await loadDefinition(match.route);
          outcome = routeHydrationOutcome(remote.hydration);
          break;
        }
        if (definition.load) {
          outcome = await definition.load({
            dependencies: options.featureDependencies[requested.route.feature] ?? {},
            url: activeLocation.href,
            signal: controller.signal,
            params: requested.params,
            search: requested.search,
          });
        } else {
          outcome = { data: undefined };
        }
        break;
      }
      if (disposed || ownGeneration !== generation) return;
      if (isRecord(outcome) && "redirect" in outcome) {
        const scoped = options.featureDependencies[match.route.feature]?.navigation as
          | typeof navigation
          | undefined;
        (scoped ?? navigation).navigate({
          ...(outcome.redirect as WebDestination),
          replace: true,
        });
        return;
      }
      current = {
        match,
        definition,
        data:
          isRecord(outcome) && "data" in outcome
            ? prepareDeferredRouteData(outcome.data, match.route.deferred, controller.signal)
            : undefined,
        metadata: mergeRouteMetadata(match.route.metadata, outcome),
      };
      applyRouteMetadata(options.system, current.metadata);
    } catch (error) {
      if (disposed || ownGeneration !== generation) return;
      current = undefined;
      failure = error;
      applyRouteMetadata(options.system, {});
    }
    revision(revision() + 1);
  };

  const routeNavigation = installRouteNavigation(options.boundary, options.routes, loadDefinition);
  let activeResolution: Promise<void> | undefined;
  const beginResolution = (location: URL): Promise<void> => {
    const task = resolve(location);
    activeResolution = task;
    return task;
  };
  const subscription = navigation.subscribe((location) => void beginResolution(location));
  let initialResolution = beginResolution(navigation.current());
  for (;;) {
    await initialResolution;
    if (activeResolution === initialResolution) break;
    initialResolution = activeResolution!;
  }
  const renderCurrent = (): Child => {
    if (failure)
      return `Route failed: ${failure instanceof Error ? failure.message : String(failure)}`;
    if (!current) return "Not found.";
    const feature = current.match.route.feature;
    return current.definition.view({
      data: current.data,
      params: current.match.params,
      search: current.match.search,
      feature: options.apis[feature] ?? {},
      features: childFeatureAPIs(feature, options.apis),
      components: options.components,
    });
  };
  return {
    render() {
      void revision();
      return scoped(renderCurrent);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      pending?.abort();
      pending = undefined;
      subscription[Symbol.dispose]();
      routeNavigation[Symbol.dispose]();
    },
  };
}

function prepareDeferredRouteData(
  value: unknown,
  fields: readonly string[],
  signal: AbortSignal,
): unknown {
  if (!fields.length) return value;
  if (!isRecord(value)) throw new TypeError("Deferred web Route data must be an object.");
  const data: Record<string, unknown> = { ...value };
  for (const field of fields) {
    const run = data[field];
    if (isDeferredResource(run)) continue;
    if (isWebDeferredData(run)) {
      if (run.field !== field) {
        throw new TypeError(`Deferred web Route data ${JSON.stringify(field)} is mismatched.`);
      }
      data[field] = createHydratedDeferredResource(run, signal);
      continue;
    }
    if (typeof run !== "function") {
      throw new TypeError(`Deferred web Route data ${JSON.stringify(field)} must be a function.`);
    }
    data[field] = createDeferredResource(() => Reflect.apply(run, undefined, []), signal);
  }
  return Object.freeze(data);
}

function routeHydrationOutcome(
  hydration: WebRouteHydrationIR,
): Readonly<{ data: unknown; metadata: WebRouteHydrationIR["metadata"] }> {
  return {
    data: hydration.loader === false ? undefined : hydration.loader.data,
    metadata: hydration.metadata,
  };
}

async function requestWebRouteData(
  location: URL,
  signal: AbortSignal,
): Promise<Readonly<{ hydration: WebRouteHydrationIR; url: URL }> | Readonly<{ redirect: URL }>> {
  const response = await fetch(location, {
    credentials: "same-origin",
    headers: { accept: WEB_ROUTE_DATA_MEDIA_TYPE },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Unable to load Route state (${response.status}).`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== WEB_ROUTE_DATA_MEDIA_TYPE) {
    throw new Error(`Unexpected Route state media type ${JSON.stringify(contentType)}.`);
  }
  const framed = response.headers
    .get("content-type")
    ?.split(";")
    .slice(1)
    .some((parameter) => parameter.trim().toLowerCase() === "framing=ndjson");
  const data = framed
    ? await readInitialWebRouteRecord(response, signal)
    : parseWebRouteData(await response.json());
  return "redirect" in data
    ? { redirect: new URL(data.redirect, response.url) }
    : { hydration: data, url: new URL(response.url) };
}

async function readInitialWebRouteRecord(
  response: Response,
  signal: AbortSignal,
): Promise<ReturnType<typeof parseWebRouteData>> {
  if (!response.body) throw new TypeError("Streamed Route state has no response body.");
  const records = readWebJSONLines(response.body)[Symbol.asyncIterator]();
  const initial = await records.next();
  if (initial.done) throw new TypeError("Streamed Route state is empty.");
  const hydration = parseWebRouteData(initial.value);
  if ("redirect" in hydration) return hydration;
  void (async () => {
    try {
      while (!signal.aborted) {
        const record = await records.next();
        if (record.done) return;
        validateWebDeferredFrame(record.value as Parameters<typeof validateWebDeferredFrame>[0]);
        const frame = record.value as Parameters<typeof validateWebDeferredFrame>[0];
        publishWebDeferredState(frame.boundary, frame.state);
      }
    } catch (error) {
      if (!signal.aborted) console.error("[kit] Route state stream failed", error);
    }
  })();
  return hydration;
}

function hydrationMatches(
  hydration: WebRouteHydrationIR | undefined,
  match: WebRouteMatch,
  location: URL,
): hydration is WebRouteHydrationIR {
  return Boolean(
    hydration &&
    hydration.route.feature === match.route.feature &&
    hydration.route.name === match.route.name &&
    hydration.location === `${location.pathname}${location.search}`,
  );
}

function invalidatePendingHydration(boundary: Element): void {
  if (boundary.getAttribute?.("data-kit-rendering") === "hydrate") {
    boundary.setAttribute("data-kit-rendering", "client");
  }
}

function routeDefinition(
  system: RuntimeSystem,
  program: string,
  route: WebRouteIR,
): RuntimeRouteDefinition {
  let feature: RuntimeFeature | undefined;
  let features = system.features;
  for (const name of route.feature.split(".")) {
    feature = features?.[name];
    features = feature?.features;
  }
  const definition = feature?.programs?.[program]?.routes?.[route.name];
  if (!definition)
    throw new Error(`Missing implementation for web Route ${route.feature}.${route.name}.`);
  return definition;
}

function routeIdentity(route: Pick<WebRouteIR, "feature" | "name">): string {
  return `${route.feature}.${route.name}`;
}

function installRouteNavigation(
  boundary: Element,
  routes: readonly WebRouteIR[],
  load: (route: WebRouteIR) => Promise<RuntimeRouteDefinition>,
): Disposable {
  if (typeof boundary.addEventListener !== "function") {
    return { [Symbol.dispose]() {} };
  }
  const timers = new Map<HTMLAnchorElement, ReturnType<typeof setTimeout>>();
  const anchorFrom = (target: EventTarget | null): HTMLAnchorElement | undefined => {
    if (!(target instanceof Element)) return undefined;
    const anchor = target.closest("a[href]");
    return anchor instanceof HTMLAnchorElement && boundary.contains(anchor) ? anchor : undefined;
  };
  const matchAnchor = (anchor: HTMLAnchorElement): WebRouteMatch | undefined => {
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin) return undefined;
    return matchWebRoute(routes, target);
  };
  const prefetch = (anchor: HTMLAnchorElement): void => {
    const connection = (
      navigator as Navigator & {
        connection?: Readonly<{ saveData?: boolean; effectiveType?: string }>;
      }
    ).connection;
    if (
      connection?.saveData ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g"
    ) {
      return;
    }
    const match = matchAnchor(anchor);
    if (match) void load(match.route).catch(() => undefined);
  };
  const onPointerOver = (event: Event): void => {
    const anchor = anchorFrom(event.target);
    if (!anchor || timers.has(anchor)) return;
    timers.set(
      anchor,
      setTimeout(() => {
        timers.delete(anchor);
        prefetch(anchor);
      }, 60),
    );
  };
  const onPointerOut = (event: Event): void => {
    const pointer = event as PointerEvent;
    const anchor = anchorFrom(pointer.target);
    if (
      !anchor ||
      (pointer.relatedTarget instanceof Node && anchor.contains(pointer.relatedTarget))
    ) {
      return;
    }
    const timer = timers.get(anchor);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(anchor);
  };
  const onFocus = (event: Event): void => {
    const anchor = anchorFrom(event.target);
    if (anchor) prefetch(anchor);
  };
  const onClick = (event: Event): void => {
    const click = event as MouseEvent;
    const anchor = anchorFrom(click.target);
    if (
      !anchor ||
      click.defaultPrevented ||
      click.button !== 0 ||
      click.metaKey ||
      click.ctrlKey ||
      click.shiftKey ||
      click.altKey ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    ) {
      return;
    }
    const target = new URL(anchor.href, location.href);
    if (!matchAnchor(anchor)) return;
    if (
      target.pathname === location.pathname &&
      target.search === location.search &&
      target.hash !== location.hash
    ) {
      return;
    }
    click.preventDefault();
    history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  boundary.addEventListener("pointerover", onPointerOver);
  boundary.addEventListener("pointerout", onPointerOut);
  boundary.addEventListener("focusin", onFocus);
  boundary.addEventListener("touchstart", onFocus, { passive: true });
  boundary.addEventListener("click", onClick);
  return {
    [Symbol.dispose]() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      boundary.removeEventListener("pointerover", onPointerOver);
      boundary.removeEventListener("pointerout", onPointerOut);
      boundary.removeEventListener("focusin", onFocus);
      boundary.removeEventListener("touchstart", onFocus);
      boundary.removeEventListener("click", onClick);
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeRouteMetadata(
  base: WebRouteIR["metadata"],
  outcome: unknown,
): WebRouteIR["metadata"] {
  if (!isRecord(outcome) || !isRecord(outcome.metadata)) return base;
  const dynamic = outcome.metadata as WebRouteIR["metadata"];
  validateWebRouteMetadata(dynamic, "dynamic");
  return Object.freeze({ ...base, ...dynamic });
}

function applyRouteMetadata(system: RuntimeSystem, metadata: WebRouteIR["metadata"]): void {
  applyWebDocumentHead({
    title: metadata.title ?? system.metadata?.name ?? "Kit",
    language: metadata.language ?? "en",
    metadata,
  });
}

function inferEmptyProgramManifest(
  system: RuntimeSystem,
  interfacePath: string,
  name: string,
  logicalName: string,
): ProgramManifest {
  const contributions: Array<ProgramManifest["contributions"][number]> = [];
  const visit = (feature: RuntimeFeature, path: string): void => {
    if (feature.programs?.[logicalName]) {
      contributions.push({ feature: path, requires: [], provides: [] });
    }
    for (const [name, child] of Object.entries(feature.features ?? {})) {
      const childPath = `${path}.${name}`;
      visit(child, childPath);
    }
  };
  visit(requireRuntimeFeature(system, interfacePath), interfacePath);
  return { name, contributions };
}

function createComponentInstance(
  componentName: string,
  options: {
    system: RuntimeSystem;
    program: string;
    config: RuntimeComponentConfig;
    presentationRevision: () => number;
    presentationInstance: PresentationAdapterInstance<WebPresentationLanguage, Element>;
    presentationGraph: RuntimePresentationGraph;
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
  const componentEntry = resolveComponentDefinition(options.system, options.program, componentName);
  const definition =
    componentEntry && typeof componentEntry === "object"
      ? (componentEntry as RuntimeComponentDefinition)
      : undefined;
  const refs = Object.create(null) as Record<string, Element | null>;
  const mountedTargets = Object.create(null) as Record<string, Set<Element>>;
  const targetRevision = runtimeSignal(0);
  let targetRevisionValue = 0;
  let targetRevisionQueued = false;
  const invalidateTargets = () => {
    if (targetRevisionQueued) return;
    targetRevisionQueued = true;
    queueMicrotask(() => {
      targetRevisionQueued = false;
      targetRevision(++targetRevisionValue);
    });
  };
  const sharedScene = currentPresenceGraph();
  const scene = sharedScene ?? new PresenceGraph<Element>();
  const structuralKey = currentStructuralKey();
  const sceneOwner = structuralKey
    ? `${componentName}:key:${structuralKey}`
    : allocatePresenceOwner(componentName);
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
  const dependencies = bindDependenciesToScope(
    options.composition.dependencies[owner] ?? {},
    lifecycle,
  );
  const actions = Object.create(null) as Record<string, (...args: unknown[]) => unknown>;
  const eventLedger = createActionEventLedger(
    Object.keys(definition?.actions ?? {}),
    options.composition.actionEventRevision,
  );
  const services = componentServices({ ...options, componentName });
  const stateInput = Object.assign(pickServices(services, ["feature", "features"]), {
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

  const actionContext = Object.assign(pickServices(services, ["feature", "features"]), {
    props,
    dependencies,
    state: stateRuntime.mutable,
    elements,
  });
  const invokeAction = (name: string, args: readonly unknown[]) => {
    const implementation = definition?.actions?.[name];
    if (typeof implementation !== "function") return;
    return eventLedger.invoke(name, args, () =>
      lifecycle.action(() => Reflect.apply(implementation, undefined, [actionContext, ...args])),
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
      invalidateTargets,
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
      identity: sceneOwner,
      presentationRevision: options.presentationRevision,
      props,
      state: createPresentationState(services.feature as Readonly<Record<string, unknown>>, state),
      refs,
      mountedTargets,
      targetRevision,
      elements: Object.fromEntries(
        Object.keys(options.config.elements).map((name) => [name, { name }]),
      ),
      events: Object.assign(
        Object.create(null),
        options.composition.events[owner] ?? {},
        eventLedger.events,
      ),
      adapter: options.presentationInstance,
      graph: options.presentationGraph,
    });
    if (definition.mount) {
      onMount(() => {
        lifecycle.adopt(
          definition.mount?.(
            Object.assign(pickServices(services, ["feature", "features"]), {
              props,
              dependencies,
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
      features: services.features as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
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
    features: childFeatureAPIs(
      componentOwner(options.componentName) ?? "",
      options.composition.apis,
    ),
  };
}

function childFeatureAPIs(
  owner: string,
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const prefix = owner ? `${owner}.` : "";
  return Object.fromEntries(
    Object.entries(apis).flatMap(([path, api]) => {
      if (!path.startsWith(prefix)) return [];
      const name = path.slice(prefix.length);
      return name && !name.includes(".") ? [[name, api] as const] : [];
    }),
  );
}

function componentOwner(component: string): string | undefined {
  if (!component.startsWith("@feature/")) return;
  const separator = component.indexOf("/component/");
  return separator < 0 ? undefined : component.slice("@feature/".length, separator);
}

function featureComponentName(path: string, component: string): string {
  return `@feature/${path}/component/${component}`;
}

function componentLocalName(component: string): string {
  const separator = component.indexOf("/component/");
  return separator < 0 ? component : component.slice(separator + "/component/".length);
}

function resolveRuntimeFeature(system: RuntimeSystem, path: string): RuntimeFeature | undefined {
  let feature: RuntimeFeature | undefined;
  let features = system.features;
  for (const name of path.split(".").filter(Boolean)) {
    feature = features?.[name];
    if (!feature) return undefined;
    features = feature.features;
  }
  return feature;
}

function requireRuntimeFeature(system: RuntimeSystem, path: string): RuntimeFeature {
  const feature = resolveRuntimeFeature(system, path);
  if (!feature) throw new Error(`Missing interface Feature ${JSON.stringify(path)}.`);
  return feature;
}

function resolveComponentDefinition(
  system: RuntimeSystem,
  program: string,
  component: string,
): unknown {
  const owner = componentOwner(component);
  if (!owner) return undefined;
  const feature = resolveRuntimeFeature(system, owner);
  const name = componentLocalName(component);
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
    composition.componentNamespaces[""] ?? {},
    composition.componentGroups[owner] ?? {},
    composition.componentNamespaces[owner] ?? {},
  );
}

type RuntimePresentationComponent = (scope: {
  readonly props: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly events: Readonly<Record<string, unknown>>;
  readonly elements: Readonly<Record<string, Readonly<{ name: string }>>>;
}) => Readonly<Record<string, WebElementPresentation>>;

type RuntimePresentationGraph = Readonly<{
  revision(component: string): number;
  acknowledge(component: string): void;
  dynamic(component: string): boolean;
  mount(): void;
  component(name: string): RuntimePresentationComponent | undefined;
  scopes(component: string): readonly object[];
  dispose(): void;
}>;

function mountAuthoredPresentationComponent(options: {
  componentName: string;
  identity: string;
  presentationRevision: () => number;
  props: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  refs: Readonly<Record<string, Element | null>>;
  mountedTargets: Readonly<Record<string, ReadonlySet<Element>>>;
  targetRevision: Signal<number>;
  elements: Readonly<Record<string, Readonly<{ name: string }>>>;
  events: Readonly<Record<string, unknown>>;
  adapter: PresentationAdapterInstance<WebPresentationLanguage, Element>;
  graph: RuntimePresentationGraph;
}): void {
  onMount(() => {
    const targetSources = Object.fromEntries(
      Object.keys(options.elements).map((name) => [
        name,
        () => ownedPresentationTargets(options.mountedTargets[name], options.refs[name]),
      ]),
    );
    let session: ReturnType<typeof options.adapter.create> | undefined;
    let currentPresentationRevision: number | undefined;
    let currentGraphDynamic: boolean | undefined;
    let currentTargetRevision: number | undefined;
    const disposeEffect = effect(() => {
      const targetRevision = options.targetRevision();
      if (!session) {
        const boundary = options.mountedTargets.Root?.values().next().value ?? options.refs.Root;
        if (!(boundary instanceof Element)) return;
        options.graph.mount();
        session = options.adapter.create({
          boundary,
          identity: options.identity,
          elements: targetSources,
          scopes: options.graph.scopes(options.componentName),
        });
      }
      const revision = options.presentationRevision();
      void options.graph.revision(options.componentName);
      const graphDynamic = options.graph.dynamic(options.componentName);
      if (
        (currentPresentationRevision !== undefined && revision !== currentPresentationRevision) ||
        (currentGraphDynamic !== undefined && graphDynamic !== currentGraphDynamic) ||
        (currentTargetRevision !== undefined && targetRevision !== currentTargetRevision)
      ) {
        session.reconfigure();
      }
      currentPresentationRevision = revision;
      currentGraphDynamic = graphDynamic;
      currentTargetRevision = targetRevision;
      session.render(
        ({ elements }) => {
          const component = options.graph.component(options.componentName);
          if (!component) return {};
          return component({
            props: options.props,
            state: options.state,
            events: options.events,
            elements,
          });
        },
        {
          dynamic: graphDynamic,
          behavior: { state: options.state, props: options.props },
        },
      );
      queueMicrotask(() => options.graph.acknowledge(options.componentName));
    });
    return () => {
      disposeEffect();
      session?.dispose();
    };
  });
}

/** @internal Resolves every live target owned by a Component, connected or not. */
export function ownedPresentationTargets(
  repeated: ReadonlySet<Element> | undefined,
  first: Element | null | undefined,
): readonly Element[] {
  if (repeated?.size) return [...repeated];
  return first ? [first] : [];
}

/** @internal Creates one interface-local Presentation evaluation graph. */
export function createPresentationGraph(options: {
  system: RuntimeSystem;
  interface: string;
  program: string;
  presentation: () => RuntimeConfiguredPresentation;
  presentationRevision: () => number;
  adapter: PresentationAdapterInstance<WebPresentationLanguage, Element>;
  boundary: Element;
  featureAPIs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  featureEvents: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  eventRevision: () => number;
  rootComponents: readonly string[];
  dependencies?: PresentationDependencyManifest;
}): RuntimePresentationGraph {
  const interfaceFeature = requireRuntimeFeature(options.system, options.interface);
  const scopeIdentities = collectPresentationScopes(interfaceFeature, options.interface);
  const scopePaths = Object.keys(scopeIdentities).sort();
  const scopeIndexes = new Map(scopePaths.map((path, index) => [path, index]));
  const revisions = new Map<string, Signal<number>>();
  const acknowledgements = new Map<string, number>();
  const pendingConsumers = new Set<string>();
  const sharedConsumers = sharedPresentationConsumers(options.dependencies);
  let notifyQueued = false;
  let components = new Map<string, RuntimePresentationComponent>();
  let session: ReturnType<typeof options.adapter.create> | undefined;
  let disposeEffect: (() => void) | undefined;
  let currentPresentationRevision: number | undefined;
  let authoredEvaluation = false;
  let disposed = false;
  let generation = 0;

  const revisionFor = (component: string) => {
    let current = revisions.get(component);
    if (!current) {
      current = signal(0);
      revisions.set(component, current);
    }
    return current;
  };
  const notifyConsumers = () => {
    generation += 1;
    for (const component of sharedConsumers) pendingConsumers.add(component);
    if (notifyQueued || pendingConsumers.size === 0) return;
    notifyQueued = true;
    queueMicrotask(() => {
      queueMicrotask(() => {
        notifyQueued = false;
        if (disposed) return;
        for (const component of pendingConsumers) {
          if (acknowledgements.get(component) === generation) continue;
          const current = revisionFor(component);
          current(current() + 1);
        }
        pendingConsumers.clear();
      });
    });
  };

  const mount = () => {
    if (disposed) throw new Error("Cannot mount a disposed Presentation graph.");
    if (session) return;
    session = options.adapter.create({
      boundary: options.boundary,
      identity: "@presentation",
      elements: {},
      scopes: scopePaths.map((path) => scopeIdentities[path]!),
    });
    disposeEffect = effect(() => {
      const nextPresentationRevision = options.presentationRevision();
      void options.eventRevision();
      if (
        currentPresentationRevision !== undefined &&
        nextPresentationRevision !== currentPresentationRevision
      ) {
        session?.reconfigure({ scopes: true });
      }
      currentPresentationRevision = nextPresentationRevision;
      authoredEvaluation = true;
      try {
        session?.render(({ scopes }) => {
          const next = new Map<string, RuntimePresentationComponent>();
          const configured = options.presentation();
          const rootScope = scopes[scopeIndexes.get("")!];
          const tree = rootScope!.evaluate(() =>
            configured.create({
              parameters: configured.parameters,
              environment: options.adapter.environment,
              state: createPresentationState(options.featureAPIs[options.interface] ?? {}, {}),
              events: options.featureEvents[options.interface] ?? {},
            }),
          );
          for (const name of options.rootComponents) {
            const component = tree[componentLocalName(name)];
            if (typeof component === "function") {
              next.set(name, component as RuntimePresentationComponent);
            }
          }
          collectPresentationComponents({
            features: interfaceFeature.features,
            program: options.program,
            tree,
            parent: options.interface,
            scopeIndexes,
            scopes,
            featureAPIs: options.featureAPIs,
            featureEvents: options.featureEvents,
            previous: components,
            refreshAll: authoredEvaluation,
            sharedConsumers,
            result: next,
          });
          components = next;
          notifyConsumers();
          return {};
        });
      } finally {
        authoredEvaluation = false;
      }
    });
  };

  return {
    revision: (component) => revisionFor(component)(),
    acknowledge(component) {
      if (disposed) return;
      acknowledgements.set(component, generation);
    },
    dynamic(component) {
      if (!options.dependencies) return true;
      return Boolean(options.dependencies[component]?.length);
    },
    mount,
    component: (name) => components.get(name),
    scopes(component) {
      const owner = componentOwner(component);
      if (owner === undefined) return [scopeIdentities[""]!];
      const result = [scopeIdentities[""]!];
      let path = "";
      for (const name of owner.split(".")) {
        path = path ? `${path}.${name}` : name;
        const identity = scopeIdentities[path];
        if (identity) result.push(identity);
      }
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeEffect?.();
      disposeEffect = undefined;
      session?.dispose();
      session = undefined;
      components.clear();
      revisions.clear();
      acknowledgements.clear();
      pendingConsumers.clear();
    },
  };
}

function collectPresentationComponents(options: {
  features: Readonly<Record<string, RuntimeFeature>> | undefined;
  program: string;
  tree: Readonly<Record<string, unknown>>;
  parent: string;
  scopeIndexes: ReadonlyMap<string, number>;
  scopes: readonly Readonly<{ evaluate<Value>(read: () => Value): Value }>[];
  featureAPIs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  featureEvents: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  previous: ReadonlyMap<string, RuntimePresentationComponent>;
  refreshAll: boolean;
  sharedConsumers: ReadonlySet<string>;
  result: Map<string, RuntimePresentationComponent>;
}): void {
  for (const [name, feature] of Object.entries(options.features ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const path = options.parent ? `${options.parent}.${name}` : name;
    if (!options.refreshAll && !hasPresentationConsumer(options.sharedConsumers, path)) {
      copyPresentationSubtree(options.previous, options.result, path);
      continue;
    }
    const createFeature = options.tree[capitalize(name)];
    const scopeIndex = options.scopeIndexes.get(path);
    const scope = scopeIndex === undefined ? undefined : options.scopes[scopeIndex];
    if (typeof createFeature !== "function" || !scope) continue;
    const tree = scope.evaluate(
      () =>
        createFeature({
          state: createPresentationState(options.featureAPIs[path] ?? {}, {}),
          events: options.featureEvents[path] ?? {},
        }) as Readonly<Record<string, unknown>>,
    );
    for (const componentName of Object.keys(
      feature.programs?.[options.program]?.components ?? {},
    )) {
      const component = tree[componentName];
      if (typeof component === "function") {
        options.result.set(
          featureComponentName(path, componentName),
          component as RuntimePresentationComponent,
        );
      }
    }
    collectPresentationComponents({ ...options, features: feature.features, tree, parent: path });
  }
}

function hasPresentationConsumer(consumers: ReadonlySet<string>, path: string): boolean {
  for (const component of consumers) {
    const owner = componentOwner(component);
    if (owner === path || owner?.startsWith(`${path}.`)) return true;
  }
  return false;
}

function sharedPresentationConsumers(
  dependencies: PresentationDependencyManifest | undefined,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const [component, declarations] of Object.entries(dependencies ?? {})) {
    const semantic = semanticComponentName(component);
    if (
      declarations.some(({ animations }) =>
        animations.some(({ scope }) => !scope.endsWith(semantic)),
      )
    ) {
      result.add(component);
    }
  }
  return result;
}

function semanticComponentName(component: string): string {
  const match = component.match(/^@feature\/(.+)\/component\/([^/]+)$/);
  if (!match) return component;
  return `${match[1]!.split(".").map(capitalize).join("/")}/${match[2]!}`;
}

function copyPresentationSubtree(
  previous: ReadonlyMap<string, RuntimePresentationComponent>,
  result: Map<string, RuntimePresentationComponent>,
  path: string,
): void {
  for (const [component, declaration] of previous) {
    const owner = componentOwner(component);
    if (owner === path || owner?.startsWith(`${path}.`)) result.set(component, declaration);
  }
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
    invalidateTargets: () => void;
    scene: PresenceGraph<Element>;
    sceneOwner: string;
  },
) {
  const element = ((props: Props = {}) => {
    const { ref: authorRef, ...nativeProps } = props;
    return jsx(tagName, {
      __kitScene: {
        scene: options.scene,
        owner: options.sceneOwner,
        element: name,
        key: currentStructuralKey(),
      },
      ref(target: Element) {
        options.refs[name] = target;
        const targets = (options.mountedTargets[name] ??= new Set());
        if (!targets.has(target)) {
          targets.add(target);
          options.invalidateTargets();
        }
        onCleanup(() => {
          if (targets.delete(target)) options.invalidateTargets();
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

function normalizeRuntimeComponents<Contract extends SystemContract>(
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

async function createProgramUI(
  system: RuntimeSystem,
  interfacePath: string,
  program: string,
  logicalProgram: string,
  externalDependencies: Readonly<Record<string, unknown>>,
  manifest: ProgramManifest,
  hotState?: HotRenderState,
  onActionEvent: () => void = () => undefined,
  routed = false,
): Promise<{
  api: Readonly<Record<string, unknown>>;
  features: Record<string, Readonly<Record<string, unknown>>>;
  apis: Record<string, Readonly<Record<string, unknown>>>;
  dependencies: Record<string, Readonly<Record<string, unknown>>>;
  events: Record<string, Readonly<Record<string, unknown>>>;
  captureHotState(): HotRenderState;
  dispose(): Promise<void>;
}> {
  const assembly = await assembleProgram({
    system,
    name: program,
    logicalName: logicalProgram,
    dependencies: externalDependencies,
    manifest,
    initialState: hotState?.programs,
    onActionEvent,
  });
  const apis = { ...assembly.ui };
  const dependencies: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const events: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  for (const instance of assembly.contributions) {
    dependencies[instance.address.feature] = instance.dependencies;
    events[instance.address.feature] = instance.ui?.events ?? Object.freeze({});
  }

  const root = collectProgramRoots(system, interfacePath, logicalProgram, !routed);
  const owner = root ? componentOwner(root) : undefined;
  const api = apis[owner ?? interfacePath] ?? Object.freeze({});
  const interfaceFeature = requireRuntimeFeature(system, interfacePath);

  let disposed = false;
  const captureHotState = (): HotRenderState => {
    const state = hotState ?? {};
    state.programs = Object.fromEntries(
      assembly.contributions.flatMap((instance) =>
        instance.ui ? [[instance.address.feature, instance.ui.snapshot()]] : [],
      ),
    );
    return state;
  };
  return {
    api,
    features: Object.fromEntries(
      Object.keys(interfaceFeature.features ?? {}).map((name) => [
        name,
        apis[`${interfacePath}.${name}`] ?? {},
      ]),
    ),
    apis,
    dependencies,
    events,
    captureHotState,
    async dispose() {
      if (disposed) return;
      disposed = true;
      captureHotState();
      await assembly.dispose();
    },
  };
}

function collectProgramRoots(
  system: RuntimeSystem,
  interfacePath: string,
  program: string,
  required = true,
): string | undefined {
  const roots: string[] = [];
  const visit = (feature: RuntimeFeature, path: string) => {
    const root = feature.programs?.[program]?.root;
    if (root) roots.push(featureComponentName(path, root));
    const features = feature.features;
    for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      visit(feature, `${path}.${name}`);
    }
  };
  visit(requireRuntimeFeature(system, interfacePath), interfacePath);
  if (roots.length !== 1 && (required || roots.length > 1)) {
    throw new Error(
      `UI Program "${program}" must define exactly one root Component; found ${roots.length}.`,
    );
  }
  return roots[0];
}

function validatePresentation(value: RuntimeConfiguredPresentation): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.create !== "function" ||
    !value.parameters ||
    typeof value.parameters !== "object" ||
    Array.isArray(value.parameters)
  ) {
    throw new TypeError("A Presentation must provide parameters and a create function.");
  }
}

function collectPresentationScopes(
  feature: RuntimeFeature,
  interfacePath: string,
): Record<string, object> {
  const scopes: Record<string, object> = { "": Object.freeze({}) };
  const visit = (
    children: Readonly<Record<string, RuntimeFeature>> | undefined,
    parent: string,
  ) => {
    for (const [name, feature] of Object.entries(children ?? {})) {
      const path = parent ? `${parent}.${name}` : name;
      scopes[path] = Object.freeze({});
      visit(feature.features, path);
    }
  };
  visit(feature.features, interfacePath);
  return scopes;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
