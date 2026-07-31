import type { DependencyContractIR, SelectedDependencyProviderIR } from "@/compiler/ir";
import { cloneData } from "@/core/data";
import {
  dependencyInvocation,
  type DependencyContract,
  type DependencyImplementation,
} from "@/core/dependency";
import { resolveFeatureProvider } from "@/core/feature";
import { conformExternalDependencies, dependencyScope } from "@/execution/process";
import type {
  ConnectionContext,
  HttpClient,
  LocalStore,
  Navigation,
  WebHost,
  WebDependencyProvider,
  WebServiceWorkerRuntime,
} from "@/platforms/web";
import { resolveWebDestination, type WebClientRouteIR } from "@/platforms/web/adapter/lowering";
import {
  parseWebRealtimeServerFrame,
  serializeWebRealtimeClientFrame,
  WEB_REALTIME_PATH,
  type WebRealtimeRequestFrame,
  type WebRealtimeServerFrame,
} from "@/platforms/web/adapter/transport";
import type { WebDestination, WebNavigationType } from "@/platforms/web/routing";

export type WebHostOptions<Dependencies extends readonly DependencyContractIR[]> = Readonly<{
  serverOrigin?: string;
  dependencies: Dependencies;
  context?: "service-worker" | "window" | "worker";
  providers?: readonly SelectedDependencyProviderIR[];
  /** Dependencies whose execution is projected exclusively into server Route loaders. */
  routeDependencies?: readonly string[];
  routes?: readonly WebClientRouteIR[];
  system?: Readonly<{ features?: Readonly<Record<string, object>> }>;
}>;

type WebAdapterHost = WebHost;
type WebAdapterHostDependency = keyof WebAdapterHost;
type NavigationImplementation = DependencyImplementation<Navigation> &
  Disposable &
  Readonly<{
    [dependencyScope](scope: Readonly<{ feature: string }>): Navigation;
  }>;
type WebAdapterHostImplementations = Readonly<{
  connection: DependencyImplementation<ConnectionContext>;
  http: DependencyImplementation<HttpClient>;
  navigation: NavigationImplementation;
  storage: DependencyImplementation<LocalStore> & Disposable;
  identifiers: DependencyImplementation<WebHost["identifiers"]>;
  scheduler: DependencyImplementation<WebHost["scheduler"]>;
  serviceWorker: DependencyImplementation<WebServiceWorkerRuntime>;
}>;

/** Creates exactly the browser-owned Dependencies required by one Program. */
export function createWebHost<const Dependencies extends readonly DependencyContractIR[]>(
  input: WebHostOptions<Dependencies>,
): Promise<Pick<WebAdapterHost, Extract<Dependencies[number]["name"], keyof WebAdapterHost>>>;
export async function createWebHost(
  input: WebHostOptions<readonly DependencyContractIR[]>,
): Promise<Readonly<Record<string, unknown>>> {
  const dependencies =
    input.routes?.length && !input.dependencies.some(({ name }) => name === "navigation")
      ? [...input.dependencies, routeNavigationContract]
      : input.dependencies;
  const providerSelections = new Map(
    (input.providers ?? []).map((provider) => [provider.dependency, provider]),
  );
  const routeDependencies = new Set(input.routeDependencies ?? []);
  const requested = new Set<string>();
  for (const dependency of dependencies) {
    if (
      !isWebHostDependency(dependency.name) &&
      !providerSelections.has(dependency.name) &&
      !routeDependencies.has(dependency.name)
    ) {
      throw new Error(`The web adapter cannot implement Dependency ${dependency.name}.`);
    }
    requested.add(dependency.name as WebAdapterHostDependency);
  }
  const host: {
    -readonly [Dependency in keyof WebAdapterHostImplementations]?: WebAdapterHostImplementations[Dependency];
  } & Record<string, unknown> = {};

  for (const [dependency, selection] of [...providerSelections].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!input.system) {
      throw new Error(
        `Web Feature provider for Dependency ${JSON.stringify(dependency)} requires its System.`,
      );
    }
    const provider = resolveFeatureProvider<WebDependencyProvider<DependencyContract>>(
      input.system,
      selection,
    );
    const origin = input.serverOrigin ?? location.origin;
    host[dependency] = await provider.development({
      context: input.context ?? "window",
      serverOrigin: origin,
      request: webRequest(origin),
    });
  }
  for (const dependency of dependencies) {
    if (
      isWebHostDependency(dependency.name) ||
      providerSelections.has(dependency.name) ||
      !routeDependencies.has(dependency.name)
    ) {
      continue;
    }
    host[dependency.name] = Object.freeze({
      [dependencyInvocation](operation: string): never {
        throw new Error(
          `Dependency ${JSON.stringify(dependency.name)}.${operation} is available to server ` +
            "Route loaders but has no browser provider.",
        );
      },
    });
  }

  if (requested.has("http")) {
    const origin = input.serverOrigin ?? location.origin;
    host.http = Object.freeze({
      request({
        input: { path, ...init },
      }: Readonly<{ input: Parameters<HttpClient["request"]>[0] }>) {
        return fetch(new URL(path, origin), { ...init, credentials: "include" });
      },
    });
  }
  if (requested.has("connection")) {
    const transport = webRealtimeTransport(new URL(input.serverOrigin ?? location.origin).origin);
    host.connection = Object.freeze({ refresh: () => transport.refresh() });
  }
  if (requested.has("storage")) host.storage = createLocalStore();
  if (requested.has("identifiers")) {
    host.identifiers = Object.freeze({ create: () => crypto.randomUUID() });
  }
  if (requested.has("scheduler")) {
    host.scheduler = Object.freeze({
      after({
        input: { milliseconds, run },
      }: Readonly<{ input: { milliseconds: number; run: () => void } }>) {
        const timer = setTimeout(run, milliseconds);
        return { [Symbol.dispose]: () => clearTimeout(timer) };
      },
    });
  }
  if (requested.has("serviceWorker")) {
    if (input.context !== "service-worker") {
      throw new Error('The "serviceWorker" Dependency is available only in a service worker.');
    }
    host.serviceWorker = serviceWorkerImplementation(
      createWebServiceWorkerRuntime(globalThis as unknown as WebServiceWorkerScope),
    );
  }
  if (!requested.has("navigation")) {
    return conformExternalDependencies(dependencies, host);
  }
  if (input.context !== undefined && input.context !== "window") {
    throw new Error('The "navigation" Dependency is unavailable in a web worker.');
  }

  const listeners = new Set<(location: URL, type: WebNavigationType) => void>();
  const current = () => new URL(location.href);
  const publish = (type: WebNavigationType) => {
    const value = current();
    for (const receive of listeners) receive(value, type);
  };
  const traverse = () => publish("traverse");
  addEventListener("popstate", traverse);

  const createNavigation = (feature: string): Navigation => ({
    current,
    href(destination: WebDestination) {
      return resolveWebDestination(input.routes ?? [], destination, feature);
    },
    navigate({ replace = false, ...destination }: WebDestination & { replace?: boolean }) {
      const path = this.href(destination);
      if (replace) history.replaceState(null, "", path);
      else history.pushState(null, "", path);
      publish(replace ? "replace" : "push");
    },
    back() {
      history.back();
    },
    forward() {
      history.forward();
    },
    reload() {
      publish("reload");
    },
    subscribe(receive: (location: URL, type: WebNavigationType) => void) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
  });
  const navigationClient = createNavigation("");
  const navigation: NavigationImplementation = Object.freeze({
    current: () => navigationClient.current(),
    href: ({ input }: Readonly<{ input: Parameters<Navigation["href"]>[0] }>) =>
      navigationClient.href(input),
    navigate: ({ input }: Readonly<{ input: Parameters<Navigation["navigate"]>[0] }>) =>
      navigationClient.navigate(input),
    back: () => navigationClient.back(),
    forward: () => navigationClient.forward(),
    reload: () => navigationClient.reload(),
    subscribe: ({ input }: Readonly<{ input: Parameters<Navigation["subscribe"]>[0] }>) =>
      navigationClient.subscribe(input),
    [dependencyScope](scope: Readonly<{ feature: string }>) {
      return createNavigation(scope.feature);
    },
    [Symbol.dispose]() {
      removeEventListener("popstate", traverse);
      listeners.clear();
    },
  });
  host.navigation = navigation;
  return conformExternalDependencies(dependencies, host);
}

const routeNavigationContract: DependencyContractIR = {
  name: "navigation",
  operations: [
    {
      name: "back",
      mode: "synchronous",
      input: { kind: "primitive", name: "void" },
      output: { kind: "primitive", name: "void" },
    },
    {
      name: "current",
      mode: "synchronous",
      input: { kind: "primitive", name: "void" },
      output: { kind: "opaque", name: "URL" },
    },
    {
      name: "forward",
      mode: "synchronous",
      input: { kind: "primitive", name: "void" },
      output: { kind: "primitive", name: "void" },
    },
    {
      name: "href",
      mode: "synchronous",
      input: { kind: "opaque", name: "WebDestination" },
      output: { kind: "primitive", name: "string" },
    },
    {
      name: "navigate",
      mode: "synchronous",
      input: { kind: "opaque", name: "WebDestination" },
      output: { kind: "primitive", name: "void" },
    },
    {
      name: "reload",
      mode: "synchronous",
      input: { kind: "primitive", name: "void" },
      output: { kind: "primitive", name: "void" },
    },
    {
      name: "subscribe",
      mode: "synchronous",
      input: { kind: "opaque", name: "Subscription" },
      output: { kind: "opaque", name: "Disposable" },
    },
  ],
};

function webRequest(origin: string) {
  const realtime =
    typeof WebSocket === "function" ? webRealtimeTransport(new URL(origin).origin) : undefined;
  return (input: {
    path: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }) =>
    realtime
      ? realtime.request(input)
      : fetch(new URL(input.path, origin), { ...input, credentials: "include" });
}

type RealtimePendingRequest = {
  resolve(response: Response): void;
  reject(error: unknown): void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  responded: boolean;
  removeAbort?(): void;
};

const webRealtimeTransports = new Map<string, WebRealtimeTransport>();

function webRealtimeTransport(origin: string): WebRealtimeTransport {
  let transport = webRealtimeTransports.get(origin);
  if (!transport) {
    transport = new WebRealtimeTransport(origin);
    webRealtimeTransports.set(origin, transport);
  }
  return transport;
}

class WebRealtimeTransport {
  readonly #origin: string;
  readonly #pending = new Map<string, RealtimePendingRequest>();
  readonly #encoder = new TextEncoder();
  #socket: WebSocket | undefined;
  #connecting: WebSocket | undefined;
  #opening: Promise<WebSocket> | undefined;
  #generation = 0;

  constructor(origin: string) {
    this.#origin = origin;
  }

  request(input: {
    path: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const id = crypto.randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const pending: RealtimePendingRequest = { resolve, reject, responded: false };
      const abort = () => {
        this.#send({ type: "cancel", id });
        this.#fail(id, input.signal?.reason ?? new DOMException("Request aborted.", "AbortError"));
      };
      if (input.signal?.aborted) {
        reject(input.signal.reason ?? new DOMException("Request aborted.", "AbortError"));
        return;
      }
      if (input.signal) {
        input.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => input.signal?.removeEventListener("abort", abort);
      }
      this.#pending.set(id, pending);
      const frame: WebRealtimeRequestFrame = {
        type: "request",
        id,
        method: input.method ?? "GET",
        path: input.path,
        headers: input.headers ?? {},
        ...(input.body === undefined ? {} : { body: input.body }),
      };
      void this.#connect()
        .then(() => {
          if (this.#pending.has(id)) this.#send(frame);
        })
        .catch((error: unknown) => this.#fail(id, error));
    });
  }

  refresh(): void {
    this.#generation += 1;
    const socket = this.#socket;
    const connecting = this.#connecting;
    this.#socket = undefined;
    this.#connecting = undefined;
    this.#opening = undefined;
    this.#failAll(new Error("Realtime transport connection context changed."));
    socket?.close(1000, "Connection context changed");
    if (connecting && connecting !== socket) {
      connecting.close(1000, "Connection context changed");
    }
  }

  #connect(): Promise<WebSocket> {
    if (this.#socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.#socket);
    if (this.#opening) return this.#opening;
    const target = new URL(WEB_REALTIME_PATH, this.#origin);
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const generation = this.#generation;
    let opening: Promise<WebSocket>;
    opening = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(target);
      this.#connecting = socket;
      let opened = false;
      socket.addEventListener("open", () => {
        if (generation !== this.#generation) {
          socket.close(1000, "Connection context changed");
          reject(new Error("Realtime transport connection context changed."));
          return;
        }
        opened = true;
        if (this.#connecting === socket) this.#connecting = undefined;
        this.#socket = socket;
        resolve(socket);
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          this.#failAll(new TypeError("Realtime transport received a non-text frame."));
          socket.close(1003, "Text frames required");
          return;
        }
        try {
          this.#receive(parseWebRealtimeServerFrame(event.data));
        } catch (error) {
          this.#failAll(error);
          socket.close(1007, "Invalid frame");
        }
      });
      socket.addEventListener("close", (event) => {
        if (this.#socket === socket) this.#socket = undefined;
        if (this.#connecting === socket) this.#connecting = undefined;
        const detail = event.reason ? `: ${event.reason}` : "";
        const error = new Error(`Realtime transport disconnected (${event.code})${detail}.`);
        if (!opened) reject(error);
        this.#failAll(error);
      });
      socket.addEventListener("error", () => undefined);
    }).finally(() => {
      if (this.#opening === opening) this.#opening = undefined;
    });
    this.#opening = opening;
    return opening;
  }

  #send(frame: WebRealtimeRequestFrame | Readonly<{ type: "cancel"; id: string }>): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(serializeWebRealtimeClientFrame(frame));
    }
  }

  #receive(frame: WebRealtimeServerFrame): void {
    const pending = this.#pending.get(frame.id);
    if (!pending) return;
    if (frame.type === "response") {
      if (pending.responded) {
        this.#fail(
          frame.id,
          new TypeError("Realtime request received duplicate response headers."),
        );
        return;
      }
      pending.responded = true;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          pending.controller = controller;
        },
        cancel: (reason) => {
          this.#send({ type: "cancel", id: frame.id });
          this.#finish(frame.id);
          return reason;
        },
      });
      pending.resolve(
        new Response(body, {
          status: frame.status,
          headers: frame.headers.map(([name, value]) => [name, value]),
        }),
      );
      return;
    }
    if (frame.type === "chunk") {
      if (!pending.controller) {
        this.#fail(frame.id, new TypeError("Realtime body arrived before response headers."));
        return;
      }
      pending.controller.enqueue(this.#encoder.encode(frame.value));
      return;
    }
    if (frame.type === "end") {
      pending.controller?.close();
      this.#finish(frame.id);
      return;
    }
    this.#fail(frame.id, new Error(frame.message));
  }

  #finish(id: string): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    pending.removeAbort?.();
    this.#pending.delete(id);
  }

  #fail(id: string, error: unknown): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    if (pending.responded) pending.controller?.error(error);
    else pending.reject(error);
    this.#finish(id);
  }

  #failAll(error: unknown): void {
    for (const id of this.#pending.keys()) this.#fail(id, error);
  }
}

function isWebHostDependency(value: string): value is WebAdapterHostDependency {
  return [
    "connection",
    "http",
    "identifiers",
    "navigation",
    "scheduler",
    "serviceWorker",
    "storage",
  ].includes(value);
}

type ExtendableEventLike = Readonly<{
  waitUntil(value: PromiseLike<unknown>): void;
}>;

type WebServiceWorkerScope = Readonly<{
  location: Location;
  registration: Readonly<{
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  }>;
  clients: Readonly<{
    matchAll(
      options: Readonly<{ type: "window"; includeUncontrolled: boolean }>,
    ): Promise<readonly Readonly<{ postMessage(value: unknown): void }>[]>;
    openWindow(url: string): Promise<unknown>;
  }>;
  addEventListener(name: string, listener: (event: never) => void): void;
  removeEventListener(name: string, listener: (event: never) => void): void;
  __kitServiceWorkerSubscriptions?: Set<object>;
}>;

/** @internal Creates the semantic service-worker Dependency from platform primitives. */
export function createWebServiceWorkerRuntime<Message = string, NotificationData = Message>(
  scope: WebServiceWorkerScope,
): WebServiceWorkerRuntime<Message, NotificationData> {
  return Object.freeze({
    subscribe(handlers) {
      const routed = scope.__kitServiceWorkerSubscriptions;
      if (routed) {
        const subscription = handlers as object;
        routed.add(subscription);
        return {
          [Symbol.dispose]() {
            routed.delete(subscription);
          },
        };
      }
      const listeners: Array<readonly [string, (event: never) => void]> = [];
      const listen = <Event extends ExtendableEventLike, Value>(
        name: string,
        receive: ((value: Value) => unknown) | undefined,
        project: (event: Event) => Value,
      ): void => {
        if (!receive) return;
        const listener = ((event: Event) => {
          event.waitUntil(Promise.resolve().then(() => receive(project(event))));
        }) as (event: never) => void;
        listeners.push([name, listener]);
        scope.addEventListener(name, listener);
      };

      listen(
        "message",
        handlers.message,
        (
          event: ExtendableEventLike & {
            data: Message;
            source?: Readonly<{ postMessage(value: unknown): void }> | null;
          },
        ) => ({
          data: event.data,
          respond(value: Message) {
            event.source?.postMessage(value);
          },
        }),
      );
      listen(
        "push",
        handlers.push,
        (event: ExtendableEventLike & { data?: Readonly<{ text(): string }> | null }) =>
          event.data ? { data: event.data.text() } : {},
      );
      listen(
        "sync",
        handlers.synchronize,
        (event: ExtendableEventLike & { tag: string; lastChance?: boolean }) => ({
          tag: event.tag,
          lastChance: event.lastChance ?? false,
        }),
      );
      listen(
        "notificationclick",
        handlers.notificationClick,
        (
          event: ExtendableEventLike & {
            action?: string;
            notification: Readonly<{ data?: NotificationData; close(): void }>;
          },
        ) => {
          event.notification.close();
          return { action: event.action ?? "", data: event.notification.data };
        },
      );

      let disposed = false;
      return {
        [Symbol.dispose]() {
          if (disposed) return;
          disposed = true;
          for (const [name, listener] of listeners) scope.removeEventListener(name, listener);
        },
      };
    },
    showNotification({ title, ...options }) {
      return scope.registration.showNotification(title, options);
    },
    async broadcast(message) {
      const clients = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage(message);
    },
    async openWindow({ url }) {
      await scope.clients.openWindow(new URL(url, scope.location.origin).href);
    },
  });
}

function serviceWorkerImplementation<Message, NotificationData>(
  runtime: WebServiceWorkerRuntime<Message, NotificationData>,
): DependencyImplementation<WebServiceWorkerRuntime<Message, NotificationData>> {
  return Object.freeze({
    subscribe: ({ input }) => runtime.subscribe(input),
    showNotification: ({ input }) => runtime.showNotification(input),
    broadcast: ({ input }) => runtime.broadcast(input),
    openWindow: ({ input }) => runtime.openWindow(input),
  });
}

function createLocalStore(): DependencyImplementation<LocalStore> & Disposable {
  const database = openLocalDatabase();
  let disposed = false;
  const transaction = async <Value>(
    mode: IDBTransactionMode,
    execute: (store: IDBObjectStore) => IDBRequest<Value>,
  ): Promise<Value> => {
    if (disposed) throw new Error("The browser local store is disposed.");
    const connection = await database;
    const current = connection.transaction("values", mode);
    const result = await requestResult(execute(current.objectStore("values")));
    await transactionDone(current);
    return result;
  };

  return Object.freeze({
    async read<Value>({ input: { key } }: Readonly<{ input: { key: string } }>) {
      return (await transaction("readonly", (store) => store.get(key))) as Value | undefined;
    },
    async write<Value>({
      input: { key, value },
    }: Readonly<{ input: { key: string; value: Value } }>) {
      await transaction("readwrite", (store) => store.put(cloneData(value), key));
    },
    async remove({ input: { key } }: Readonly<{ input: { key: string } }>) {
      await transaction("readwrite", (store) => store.delete(key));
    },
    [Symbol.dispose]() {
      disposed = true;
      void database.then((connection) => connection.close());
    },
  });
}

function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kit", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("values")) {
        request.result.createObjectStore("values");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local storage."));
  });
}

function requestResult<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Local transaction failed."));
  });
}
