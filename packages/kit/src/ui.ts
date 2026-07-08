import {
  computed as alienComputed,
  effect as alienEffect,
  signal as alienSignal,
} from "alien-signals";
import type {
  ActorOf,
  App,
  AppNavigation,
  AppScreen,
  AppSpec,
  AppUIContext,
  CommandReceipt,
  CommandSpec,
  NavigationName,
  NavigationParams,
  ResourceSpec,
  SyncMeta,
} from "./app";
import { connect as connectClient, type ConnectOpts } from "./client";
import type { JsonValue } from "./protocol";
import { scopeId } from "./protocol";
import { createBrowserStore } from "./storage";

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type HookName<Name extends string> = `use${Capitalize<Name>}`;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ErrorFor<Command> = Command extends { error: infer E } ? E : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  readonly [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<
    Spec,
    Resource
  >["Views"][View];
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

type RawResourceHandle<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
} & {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: (
    ...args: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ResourceFor<Spec, Resource>["Commands"][Command]["args"]
      : ResourceFor<Spec, Resource>["Commands"][Command] extends any[]
        ? ResourceFor<Spec, Resource>["Commands"][Command]
        : []
  ) => CommandReceipt<any>;
} & {
  readonly sync: SyncMeta;
  subscribe(fn: (scope: Record<string, unknown>) => void): () => void;
};

export type NativeResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly sync: SyncMeta;
  };

export type NativeUIHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
} & {
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
};

export type NativeAppApi<Spec extends AppSpec> = NativeUIHooks<Spec> & {
  readonly screen: Signal<AppScreen<Spec>>;
  readonly nav: AppNavigation<Spec>;
  useScreen(): AppScreen<Spec>;
};

export type NativeAppRuntime<Spec extends AppSpec> = {
  readonly api: NativeAppApi<Spec>;
  start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
};

export type DefineUIProps<Spec extends AppSpec> = {
  connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>);
};

export type Signal<T> = {
  (): T;
  (value: T): void;
};

export type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);

const reactiveValueRead = Symbol.for("poggers.reactiveValue.read");

type ReactiveValue<T> = {
  readonly [reactiveValueRead]: () => T;
};

export type Props = Record<string, unknown> & {
  children?: Child;
};

export type Component<P extends object = Record<string, never>> = (props: P) => Child;

export type HotRenderState = {
  signals?: Signal<unknown>[];
};

type Owner = {
  cleanups: Array<() => void>;
  hotState?: HotRenderState;
  signalCursor: number;
};

let currentOwner: Owner | null = null;

export function runtimeSignal<T>(initialValue: T): Signal<T> {
  return alienSignal(initialValue) as Signal<T>;
}

export function signal<T>(initialValue: T): Signal<T> {
  const owner = currentOwner;
  if (owner?.hotState) {
    const index = owner.signalCursor++;
    const existing = owner.hotState.signals?.[index] as Signal<T> | undefined;
    if (existing) return existing;

    const next = runtimeSignal(initialValue);
    (owner.hotState.signals ??= [])[index] = next as Signal<unknown>;
    return next;
  }

  return runtimeSignal(initialValue);
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
  return alienComputed(getter);
}

export function effect(fn: () => void | (() => void)): () => void {
  const dispose = alienEffect(fn);
  registerCleanup(dispose);
  return dispose;
}

function runtimeEffect(fn: () => void | (() => void)): () => void {
  return alienEffect(fn);
}

export function onMount(fn: () => void | (() => void)): void {
  queueMicrotask(() => {
    const cleanup = fn();
    if (typeof cleanup === "function") registerCleanup(cleanup);
  });
}

export function defineUI<Spec extends AppSpec, Props extends object = Record<string, never>>(
  app: App<Spec>,
  setup: (hooks: NativeUIHooks<Spec>) => (props: Props) => Child,
) {
  const runtime = createNativeRuntime(app);
  const hooks = createNativeHooks(app, runtime);
  const Inner = setup(hooks);

  function DefinedUI(
    { connect, ...props }: Props & DefineUIProps<Spec> = {} as Props & DefineUIProps<Spec>,
  ) {
    runtime.start(connect ?? createBrowserConnectOptions());
    return Inner(props as Props);
  }

  Object.defineProperty(DefinedUI, "poggersUiRuntime", {
    value: "native",
    enumerable: false,
  });

  return DefinedUI;
}

export function createAppUI<Spec extends AppSpec, Props extends object = Record<string, never>>(
  app: App<Spec>,
) {
  const root = app.def.root ?? app.def.ui;
  if (!root) {
    throw new Error("App definition does not include a root function.");
  }

  const runtime = createNativeAppRuntime(app);
  const appUI = root as (ctx: AppUIContext<Spec>) => Child;

  function DefinedAppUI(
    { connect, ..._props }: Props & DefineUIProps<Spec> = {} as Props & DefineUIProps<Spec>,
  ) {
    runtime.start(connect ?? createBrowserConnectOptions());
    return appUI({
      ...runtime.api,
    } as AppUIContext<Spec>);
  }

  Object.defineProperty(DefinedAppUI, "poggersUiRuntime", {
    value: "native",
    enumerable: false,
  });

  return DefinedAppUI;
}

export function createNativeAppRuntime<Spec extends AppSpec>(
  app: App<Spec>,
): NativeAppRuntime<Spec> {
  const runtime = createNativeRuntime(app);
  const hooks = createNativeHooks(app, runtime);
  const navigation = createNavigation(app);
  const api = {
    ...hooks,
    screen: navigation.screen,
    nav: navigation.nav,
    useScreen() {
      return navigation.screen();
    },
  } as NativeAppApi<Spec>;

  return {
    api,
    start: runtime.start,
  };
}

export function render(child: Child, root: Element, hotState?: HotRenderState): () => void {
  const owner: Owner = { cleanups: [], hotState, signalCursor: 0 };
  const previousOwner = currentOwner;
  currentOwner = owner;
  try {
    root.replaceChildren(...toNodes(resolveChild(child)));
  } finally {
    currentOwner = previousOwner;
  }

  return () => {
    for (const cleanup of owner.cleanups.splice(0)) cleanup();
    root.replaceChildren();
  };
}

export function jsx(type: string | Component<any>, props: Props | null): Child {
  return createNode(type, props ?? {});
}

export const jsxs = jsx;

export function Fragment(props: { children?: Child }): Child {
  return props.children ?? null;
}

export function For<Items extends readonly unknown[]>(props: {
  each: Items;
  children: (item: Items[number], index: number) => Child;
  fallback?: Child;
}): Child {
  const start = document.createComment("poggers:for");
  const end = document.createComment("/poggers:for");
  const parent = document.createDocumentFragment();
  parent.append(start, end);
  let rendered: Node[] = [];

  blockEffect(() => {
    const items = read(props.each);
    const nextNodes =
      items.length === 0 && props.fallback !== undefined
        ? toNodes(resolveChild(props.fallback))
        : items.flatMap((item, index) => toNodes(resolveChild(props.children(item, index))));
    replaceBetween(start, end, nextNodes);
    rendered = nextNodes;
  });

  registerCleanup(() => {
    for (const node of rendered) node.parentNode?.removeChild(node);
    rendered = [];
  });

  return parent;
}

export function Show(props: { when: unknown; children: Child; fallback?: Child }): Child {
  const start = document.createComment("poggers:show");
  const end = document.createComment("/poggers:show");
  const parent = document.createDocumentFragment();
  parent.append(start, end);
  let rendered: Node[] = [];

  blockEffect(() => {
    const visible = Boolean(read(props.when));
    const nextNodes = toNodes(resolveChild(visible ? props.children : props.fallback));
    replaceBetween(start, end, nextNodes);
    rendered = nextNodes;
  });

  registerCleanup(() => {
    for (const node of rendered) node.parentNode?.removeChild(node);
    rendered = [];
  });

  return parent;
}

function createNode(type: string | Component<any>, props: Props): Child {
  if (typeof type === "function") return type(props);

  const element = document.createElement(type);
  const { children, ...attributes } = props;

  for (const [name, value] of Object.entries(attributes)) {
    applyProp(element, name, value);
  }

  element.append(...toNodes(children));
  return element;
}

function applyProp(element: HTMLElement, name: string, value: unknown) {
  if (name === "ref" && typeof value === "function") {
    value(element);
    return;
  }

  if (name === "className") {
    bindValue((next) => {
      element.setAttribute("class", stringify(next));
    }, value);
    return;
  }

  if (name === "style") {
    bindStyle(element, value);
    return;
  }

  if (name.startsWith("on") && typeof value === "function") {
    const eventName = eventNameForProp(name);
    element.addEventListener(eventName, value as EventListener);
    registerCleanup(() => element.removeEventListener(eventName, value as EventListener));
    return;
  }

  bindValue((next) => {
    if (next === false || next == null) {
      element.removeAttribute(name);
      return;
    }
    if (name in element) {
      try {
        (element as any)[name] = next;
        return;
      } catch {}
    }
    element.setAttribute(name, next === true ? "" : stringify(next));
  }, value);
}

function eventNameForProp(name: string): string {
  const eventName = name.slice(2).toLowerCase();
  return eventName === "doubleclick" ? "dblclick" : eventName;
}

function bindStyle(element: HTMLElement, value: unknown) {
  bindValue((next) => {
    if (typeof next === "string") {
      element.setAttribute("style", next);
      return;
    }
    if (!next || typeof next !== "object") {
      element.removeAttribute("style");
      return;
    }
    for (const [key, styleValue] of Object.entries(next as Record<string, unknown>)) {
      (element.style as any)[key] = styleValue == null ? "" : String(styleValue);
    }
  }, value);
}

function bindValue(set: (value: unknown) => void, value: unknown) {
  if (typeof value === "function") {
    effect(() => set((value as () => unknown)()));
  } else {
    set(value);
  }
}

function resolveChild(child: Child): Child {
  return typeof child === "function" ? resolveChild(child()) : child;
}

function toNodes(child: Child): Node[] {
  if (typeof child === "function") return dynamicNodes(child);

  const resolved = resolveChild(child);
  if (resolved == null || resolved === false || resolved === true) return [];
  if (Array.isArray(resolved)) return resolved.flatMap(toNodes);
  if (resolved instanceof Node) return [resolved];
  return [document.createTextNode(String(resolved))];
}

function dynamicNodes(readChild: () => Child): Node[] {
  const start = document.createComment("poggers:dynamic");
  const end = document.createComment("/poggers:dynamic");
  let rendered: Node[] = [];

  blockEffect(() => {
    const nextNodes = toNodes(readChild());
    replaceBetween(start, end, nextNodes);
    rendered = nextNodes;
  });

  registerCleanup(() => {
    for (const node of rendered) node.parentNode?.removeChild(node);
    rendered = [];
  });

  return [start, end];
}

function replaceBetween(start: Node, end: Node, nodes: Node[]) {
  let cursor = start.nextSibling;
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    cursor.parentNode?.removeChild(cursor);
    cursor = next;
  }
  start.parentNode?.insertBefore(document.createDocumentFragment(), end);
  for (const node of nodes) {
    end.parentNode?.insertBefore(node, end);
  }
}

function read<T>(value: T): T {
  const reactiveReader = reactiveValueReader<T>(value);
  if (reactiveReader) return reactiveReader();
  return value;
}

export function reactiveValue<T>(source: () => T): T {
  const initial = source();
  if (initial == null || typeof initial !== "object") return initial;

  const emptyTarget = Array.isArray(initial) ? [] : Object.create(null);
  return new Proxy(emptyTarget, {
    get(_target, prop, receiver) {
      if (prop === reactiveValueRead) return source;
      const value = source();
      if (value == null || typeof value !== "object") return undefined;
      const item = Reflect.get(value as object, prop, receiver);
      return typeof item === "function" ? item.bind(value) : item;
    },
    has(_target, prop) {
      const value = source();
      return value != null && typeof value === "object" && prop in value;
    },
    ownKeys() {
      const value = source();
      return value != null && typeof value === "object" ? Reflect.ownKeys(value) : [];
    },
    getOwnPropertyDescriptor(_target, prop) {
      const value = source();
      if (value == null || typeof value !== "object") return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() {
      const value = source();
      return value != null && typeof value === "object" ? Reflect.getPrototypeOf(value) : null;
    },
  }) as T;
}

function reactiveValueReader<T>(value: unknown): (() => T) | undefined {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) return;
  return (value as ReactiveValue<T>)[reactiveValueRead];
}

function stringify(value: unknown): string {
  return value == null ? "" : String(value);
}

function registerCleanup(cleanup: () => void) {
  currentOwner?.cleanups.push(cleanup);
}

function blockEffect(fn: () => void | (() => void)) {
  const owner = currentOwner;
  queueMicrotask(() => {
    const dispose = alienEffect(fn);
    owner?.cleanups.push(dispose);
  });
}

type NativeRuntime<Spec extends AppSpec> = ReturnType<typeof createNativeRuntime<Spec>>;

function createNativeRuntime<Spec extends AppSpec>(app: App<Spec>) {
  let started = false;
  let clientPromise: Promise<import("./app").Client<Spec>> | null = null;
  const client = runtimeSignal<import("./app").Client<Spec> | null>(null);
  const resources = new Map<string, NativeResourceState<Spec, ResourceName<Spec>>>();

  function start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)) {
    if (started) return;
    started = true;
    if (!connect) return;

    clientPromise = Promise.resolve(
      typeof connect === "function" ? connect() : connectClient(app, connect),
    )
      .then((nextClient) => {
        client(nextClient);
        return nextClient;
      })
      .catch((error) => {
        for (const resource of resources.values()) {
          resource.sync({ ...resource.sync(), syncing: false, stale: true, error: String(error) });
        }
        throw error;
      });
  }

  function resource<Resource extends ResourceName<Spec>>(
    resourceName: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) {
    const id = scopeId(resourceName, key as JsonValue);
    const existing = resources.get(id);
    if (existing) return existing.handle as NativeResource<Spec, Resource>;

    const state = createNativeResourceState(app, client, clientPromise, resourceName, key);
    resources.set(id, state as NativeResourceState<Spec, ResourceName<Spec>>);
    return state.handle;
  }

  return { start, resource };
}

type NativeResourceState<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  handle: NativeResource<Spec, Resource>;
  sync: Signal<SyncMeta>;
};

function createNativeResourceState<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  client: Signal<import("./app").Client<Spec> | null>,
  clientPromise: Promise<import("./app").Client<Spec>> | null,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): NativeResourceState<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const actor = { id: "local" } as ActorOf<Spec>;
  const localState = app.createState(resource);
  const views: Record<string, Signal<unknown>> = {};
  const viewValues: Record<string, unknown> = {};
  const sync = runtimeSignal<SyncMeta>({ cursor: 0, syncing: true, stale: true, error: null });
  const syncValue = reactiveValue(() => sync());

  for (const viewName of Object.keys(resourceDef.views ?? {})) {
    const initialView = cloneViewValue(readLocalView(app, resource, key, localState, viewName));
    views[viewName] = runtimeSignal(initialView);
    if (isReactiveObject(initialView)) {
      viewValues[viewName] = reactiveValue(() => views[viewName]!());
    }
  }

  const commands: Record<string, (...args: any[]) => CommandReceipt<any>> = {};
  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    commands[commandName] = async (...args: any[]) => {
      applyLocalCommand(app, resource, key, localState, actor, commandName, args, views);
      const readyClient =
        client() ?? (clientPromise ? await clientPromise.catch(() => null) : null);
      const remote = readyClient?.[resource]?.(key as never) as RawResourceHandle<
        Spec,
        Resource
      > | null;
      const command = remote?.[commandName as keyof typeof remote];
      if (typeof command !== "function") return { ok: true };
      return command(...args);
    };
  }

  const handle = new Proxy(Object.create(null), {
    get(_target, prop: string) {
      if (prop === "sync") return syncValue;
      const command = commands[prop];
      if (command) return command;
      if (prop in viewValues) return viewValues[prop];
      const view = views[prop];
      if (view) return view();
      return undefined;
    },
  }) as NativeResource<Spec, Resource>;

  runtimeEffect(() => {
    const readyClient = client();
    if (!readyClient) return;

    const remote = readyClient[resource]?.(key as never) as RawResourceHandle<Spec, Resource>;
    if (!remote) return;

    const update = () => {
      for (const viewName of Object.keys(views)) {
        views[viewName]!(cloneViewValue(remote[viewName as keyof typeof remote]));
      }
      sync(remote.sync);
    };

    update();
    return remote.subscribe(update);
  });

  return { handle, sync };
}

function createNativeHooks<Spec extends AppSpec>(
  app: App<Spec>,
  runtime: NativeRuntime<Spec>,
): NativeUIHooks<Spec> {
  const hooks: Record<string, unknown> = {
    useResource: runtime.resource,
  };

  for (const resource of Object.keys(app.def.resources)) {
    hooks[`use${capitalize(resource)}`] = (key: JsonValue) =>
      runtime.resource(resource as ResourceName<Spec>, key as never);
  }

  return hooks as NativeUIHooks<Spec>;
}

function createNavigation<Spec extends AppSpec>(app: App<Spec>) {
  const entries = Object.entries((app.def.navigation ?? { home: "/" }) as Record<string, string>);
  const fallback = entries[0] ?? ["home", "/"];
  const screen = runtimeSignal<AppScreen<Spec>>(parseScreen());
  const nav: Record<string, unknown> = {};

  for (const [name, pattern] of entries) {
    nav[name] = (params: Record<string, unknown> = {}) => {
      const path = pathFor(pattern, params);
      if (typeof history !== "undefined") {
        history.pushState({ poggersScreen: name }, "", path);
      }
      screen({
        name,
        params: params as NavigationParams<Spec, NavigationName<Spec>>,
      } as AppScreen<Spec>);
    };
  }

  if (typeof addEventListener !== "undefined") {
    addEventListener("popstate", () => {
      screen(parseScreen());
    });
  }

  function parseScreen(): AppScreen<Spec> {
    const pathname = typeof location === "undefined" ? "/" : location.pathname;
    for (const [name, pattern] of entries) {
      const params = matchPath(pattern, pathname);
      if (params) {
        return {
          name,
          params,
        } as AppScreen<Spec>;
      }
    }
    return {
      name: fallback[0],
      params: {},
    } as AppScreen<Spec>;
  }

  return {
    screen,
    nav: nav as AppNavigation<Spec>,
  };
}

function pathFor(pattern: string, params: Record<string, unknown>): string {
  return pattern.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params[name];
    if (value == null) {
      throw new Error(`Missing navigation param "${name}" for path "${pattern}".`);
    }
    return encodeURIComponent(String(value));
  });
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index++) {
    const patternPart = patternParts[index]!;
    const pathPart = pathParts[index]!;
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}

function splitPath(path: string): string[] {
  return path.replace(/\/+$/g, "").split("/").filter(Boolean);
}

function applyLocalCommand<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  state: unknown,
  actor: ActorOf<Spec>,
  command: string,
  args: unknown[],
  views: Record<string, Signal<unknown>>,
) {
  const events: Array<{
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }> = [];
  let commandError: { error: string; data?: unknown } | null = null;

  app.runCommand(
    resource,
    state,
    actor,
    key,
    command,
    args,
    (event) => events.push(event),
    () => {},
    (error, data) => {
      commandError = { error, data };
    },
  );

  if (commandError) return;

  for (const event of events) {
    app.applyEvent(resource, state, event, app.def.version);
  }

  for (const viewName of Object.keys(views)) {
    views[viewName]!(cloneViewValue(readLocalView(app, resource, key, state, viewName)));
  }
}

function cloneViewValue<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) return value.slice() as T;
    return { ...(value as Record<string, unknown>) } as T;
  }
}

function isReactiveObject(value: unknown): value is object {
  return value != null && typeof value === "object";
}

function readLocalView<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  state: unknown,
  viewName: string,
) {
  return (app.def.resources[resource].views as any)?.[viewName]?.({
    state,
    actor: null,
    sessions: [],
    key,
  });
}

export function createBrowserConnectOptions(): ConnectOpts | undefined {
  if (typeof location === "undefined") return undefined;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const token = new URLSearchParams(location.search).get("token") ?? "local";
  return {
    wsUrl: `${protocol}://${location.host}/ws`,
    token,
    storage: createBrowserStore(),
  };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./jsx-types";
