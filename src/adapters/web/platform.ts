import type { Child, IntrinsicElements } from "@/adapters/web/ui/component/language";
import type { UIDefinition, UIElement } from "@/core/ui";

type WebPrimitiveName = Extract<keyof IntrinsicElements, string>;

type WebTarget<Name extends WebPrimitiveName> = Name extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[Name]
  : Name extends keyof SVGElementTagNameMap
    ? SVGElementTagNameMap[Name]
    : Element;

type WebElement<Name extends WebPrimitiveName> = UIElement<
  Omit<IntrinsicElements[Name], "class" | "className" | "style">,
  WebTarget<Name>
>;

/** The typed structure and Presentation vocabulary of the web platform. */
export type WebUI = Readonly<{
  Name: "web";
  Child: Child;
  Elements: {
    readonly [Name in WebPrimitiveName]: WebElement<Name>;
  };
}>;

/** The web realization family. Its main thread may render the web UI language. */
export type WebPlatform = { readonly Name: "web"; readonly UI: WebUI };
export type BrowserMainThread = {
  readonly Name: "browser-main";
  readonly Platform: WebPlatform;
  readonly UI: WebUI;
};
export type BrowserServiceWorker = {
  readonly Name: "browser-service-worker";
  readonly Platform: WebPlatform;
};
export type BrowserWorker = {
  readonly Name: "browser-worker";
  readonly Platform: WebPlatform;
};

/** Origin-aware HTTP access supplied by the browser host. */
export type HttpClient = Readonly<{
  request(input: {
    path: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<Response>;
}>;

/** Browser history exposed without coupling Features to global objects. */
export type Navigation = Readonly<{
  current(): URL;
  navigate(input: { path: string; replace?: boolean }): void;
  subscribe(receive: (location: URL) => void): Disposable;
}>;

/** Durable origin-local values supplied by the browser host. */
export type LocalStore = Readonly<{
  read<Value>(key: string): Promise<Value | undefined>;
  write<Value>(key: string, value: Value): Promise<void>;
  remove(key: string): Promise<void>;
}>;

/** Browser-owned identifier generation. */
export type Identifiers = Readonly<{ create(): string }>;

/** Cancellable deferred work supplied by the browser host. */
export type Scheduler = Readonly<{
  after(milliseconds: number, run: () => void): Disposable;
}>;

export type WebHost = Readonly<{
  http: HttpClient;
  navigation: Navigation;
  storage: LocalStore;
  identifiers: Identifiers;
  scheduler: Scheduler;
}>;
export type WebHostCapability = keyof WebHost;

export type WebHostOptions<Capabilities extends readonly WebHostCapability[] | undefined> =
  Readonly<{
    serverOrigin?: string;
    capabilities?: Capabilities;
    context?: "window" | "worker";
  }>;

/** Creates the browser-owned Capabilities shared by web Features. */
export function createWebHost<const Capabilities extends readonly WebHostCapability[]>(
  input: WebHostOptions<Capabilities> & Readonly<{ capabilities: Capabilities }>,
): Pick<WebHost, Capabilities[number]>;
export function createWebHost(input?: WebHostOptions<undefined>): WebHost;
export function createWebHost(
  input: WebHostOptions<readonly WebHostCapability[] | undefined> = {},
): WebHost | Partial<WebHost> {
  const requested = new Set<WebHostCapability>(
    input.capabilities ?? ["http", "navigation", "storage", "identifiers", "scheduler"],
  );
  const host: {
    -readonly [Capability in keyof WebHost]?: WebHost[Capability];
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
      after(milliseconds: number, run: () => void) {
        const timer = setTimeout(run, milliseconds);
        return { [Symbol.dispose]: () => clearTimeout(timer) };
      },
    });
  }
  if (!requested.has("navigation")) return Object.freeze(host);
  if (input.context === "worker") {
    throw new Error('The "navigation" Capability is unavailable in a web worker.');
  }

  const listeners = new Set<(location: URL) => void>();
  const current = () => new URL(location.href);
  const publish = () => {
    const value = current();
    for (const receive of listeners) receive(value);
  };
  addEventListener("popstate", publish);

  const navigation: Navigation & Disposable = Object.freeze({
    current,
    navigate({ path, replace = false }: { path: string; replace?: boolean }) {
      if (replace) history.replaceState(null, "", path);
      else history.pushState(null, "", path);
      publish();
    },
    subscribe(receive: (location: URL) => void) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
    [Symbol.dispose]() {
      removeEventListener("popstate", publish);
      listeners.clear();
    },
  });
  host.navigation = navigation;
  return Object.freeze(host);
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
    async read<Value>(key: string) {
      return (await transaction("readonly", (store) => store.get(key))) as Value | undefined;
    },
    async write<Value>(key: string, value: Value) {
      await transaction("readwrite", (store) => store.put(value, key));
    },
    async remove(key: string) {
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

type WebUISatisfiesContract = WebUI extends UIDefinition<WebUI> ? true : never;
const webUISatisfiesContract: WebUISatisfiesContract = true;
void webUISatisfiesContract;
export { For, Show } from "@/adapters/web/ui/component/runtime";
export type { Child, VirtualForOptions } from "@/adapters/web/ui/component/runtime";
export {
  createPress,
  createShortcut,
  mountDialog,
  mountDrag,
  type DialogMode,
  type DragOptions,
  type DragRelease,
  type DragSample,
  type PressBindings,
  type Shortcut,
  type ShortcutBinding,
} from "@/adapters/web/ui/component/interaction";
export * from "@/adapters/web/ui/presentation/language";
