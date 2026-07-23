import { resolveWebDestination, type WebRouteIR } from "@/adapters/web/routing";
import type { DependencyContractIR } from "@/compiler/ir";
import type {
  HttpClient,
  LocalStore,
  Navigation,
  WebHost,
  WebHostDependency,
  WebServiceWorkerRuntime,
} from "@/platforms/web/platform";
import type { WebDestination } from "@/platforms/web/routing";
import { conformExternalDependencies, dependencyScope } from "@/runtime/process";

export type WebHostOptions<Dependencies extends readonly DependencyContractIR[]> = Readonly<{
  serverOrigin?: string;
  dependencies: Dependencies;
  context?: "service-worker" | "window" | "worker";
  routes?: readonly WebRouteIR[];
}>;

/** Creates exactly the browser-owned Dependencies required by one Program. */
export function createWebHost<const Dependencies extends readonly DependencyContractIR[]>(
  input: WebHostOptions<Dependencies>,
): Pick<WebHost, Extract<Dependencies[number]["name"], keyof WebHost>>;
export function createWebHost(
  input: WebHostOptions<readonly DependencyContractIR[]>,
): Readonly<Record<string, unknown>> {
  const requested = new Set<WebHostDependency>();
  for (const dependency of input.dependencies) {
    if (!isWebHostDependency(dependency.name)) {
      throw new Error(`The web adapter cannot implement Dependency ${dependency.name}.`);
    }
    requested.add(dependency.name);
  }
  const host: {
    -readonly [Dependency in keyof WebHost]?: WebHost[Dependency];
  } = {};

  if (requested.has("http")) {
    const origin = input.serverOrigin ?? location.origin;
    host.http = Object.freeze({
      request({ path, ...init }: Parameters<HttpClient["request"]>[0]) {
        return fetch(new URL(path, origin), { ...init, credentials: "include" });
      },
    });
  }
  if (requested.has("storage")) host.storage = createLocalStore();
  if (requested.has("identifiers")) {
    host.identifiers = Object.freeze({ create: () => crypto.randomUUID() });
  }
  if (requested.has("scheduler")) {
    host.scheduler = Object.freeze({
      after({ milliseconds, run }: { milliseconds: number; run: () => void }) {
        const timer = setTimeout(run, milliseconds);
        return { [Symbol.dispose]: () => clearTimeout(timer) };
      },
    });
  }
  if (requested.has("serviceWorker")) {
    if (input.context !== "service-worker") {
      throw new Error('The "serviceWorker" Dependency is available only in a service worker.');
    }
    host.serviceWorker = createWebServiceWorkerRuntime(
      globalThis as unknown as WebServiceWorkerScope,
    );
  }
  if (!requested.has("navigation")) {
    return conformExternalDependencies(input.dependencies, host);
  }
  if (input.context !== undefined && input.context !== "window") {
    throw new Error('The "navigation" Dependency is unavailable in a web worker.');
  }

  const listeners = new Set<(location: URL) => void>();
  const current = () => new URL(location.href);
  const publish = () => {
    const value = current();
    for (const receive of listeners) receive(value);
  };
  addEventListener("popstate", publish);

  const createNavigation = (feature: string): Navigation => ({
    current,
    href(destination: WebDestination) {
      return resolveWebDestination(input.routes ?? [], destination, feature);
    },
    navigate({ replace = false, ...destination }: WebDestination & { replace?: boolean }) {
      const path = this.href(destination);
      if (replace) history.replaceState(null, "", path);
      else history.pushState(null, "", path);
      publish();
    },
    back() {
      history.back();
    },
    forward() {
      history.forward();
    },
    subscribe(receive: (location: URL) => void) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
  });
  const navigation: Navigation &
    Disposable & {
      [dependencyScope](scope: Readonly<{ feature: string }>): Navigation;
    } = Object.freeze({
    ...createNavigation(""),
    [dependencyScope](scope: Readonly<{ feature: string }>) {
      return createNavigation(scope.feature);
    },
    [Symbol.dispose]() {
      removeEventListener("popstate", publish);
      listeners.clear();
    },
  });
  host.navigation = navigation;
  return conformExternalDependencies(input.dependencies, host);
}

function isWebHostDependency(value: string): value is WebHostDependency {
  return ["http", "identifiers", "navigation", "scheduler", "serviceWorker", "storage"].includes(
    value,
  );
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
}>;

/** @internal Creates the semantic service-worker Dependency from platform primitives. */
export function createWebServiceWorkerRuntime<Message = string, NotificationData = Message>(
  scope: WebServiceWorkerScope,
): WebServiceWorkerRuntime<Message, NotificationData> {
  return Object.freeze({
    subscribe(handlers) {
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

function createLocalStore(): LocalStore & Disposable {
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
    async read<Value>({ key }: { key: string }) {
      return (await transaction("readonly", (store) => store.get(key))) as Value | undefined;
    },
    async write<Value>({ key, value }: { key: string; value: Value }) {
      await transaction("readwrite", (store) => store.put(value, key));
    },
    async remove({ key }: { key: string }) {
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
    const request = indexedDB.open("poggers", 1);
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
