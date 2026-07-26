import type {
  Dependency,
  DependencyContract,
  DependencyImplementation,
  DependencyProvider,
} from "@/core/dependency";
import type { FeatureContract } from "@/core/feature";
import type { UIDefinition, UIElement } from "@/core/ui/language";
import type {
  WebApplicationInterfaceKind,
  WebNavigation,
  WebProgramDefinitionKind,
  WebRouteContract,
  WebRoutes,
} from "@/platforms/web/routing";
import type { Child, IntrinsicElements } from "@/platforms/web/ui";

type WebPrimitiveName = Extract<keyof IntrinsicElements, string>;
type WebDependency<Operations extends Readonly<Record<string, (input: never) => unknown>>> =
  Dependency<{ Operations: Operations }>;

export type WebProviderContext = Readonly<{
  context: "service-worker" | "window" | "worker";
  serverOrigin: string;
}>;

export type WebProviderRequirements = Readonly<{
  crossOriginIsolation?: true;
}>;

/** One browser realization packaged by the semantic owner of a Dependency. */
export type WebDependencyProvider<Api extends DependencyContract> = DependencyProvider<
  Api,
  (
    context: WebProviderContext,
  ) =>
    | (DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>)
    | PromiseLike<DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>>,
  never,
  WebProviderRequirements
>;

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
export type WebPlatform = {
  readonly Name: "web";
  readonly UI: WebUI;
  readonly Program: WebProgramDefinitionKind;
  readonly Application: WebApplicationInterfaceKind;
};
export type BrowserMainThread = {
  readonly Name: "browser-main";
  readonly Platform: WebPlatform;
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
export type HttpClient = WebDependency<{
  request(input: {
    path: string;
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<Response>;
}>;

/** Browser history exposed without coupling Features to global objects. */
export type Navigation<
  Routes extends Readonly<Record<string, unknown>> = Readonly<Record<string, WebRouteContract>>,
  Owner extends FeatureContract | undefined = undefined,
> = Dependency<
  {
    Operations: WebNavigation<Routes & (Owner extends FeatureContract ? WebRoutes<Owner> : {})>;
  },
  WebNavigation<Routes & (Owner extends FeatureContract ? WebRoutes<Owner> : {})>
>;

/** Durable origin-local values supplied by the browser host. */
export type LocalStore = WebDependency<{
  read<Value>(input: { key: string }): Promise<Value | undefined>;
  write<Value>(input: { key: string; value: Value }): Promise<void>;
  remove(input: { key: string }): Promise<void>;
}>;

/** Browser-owned identifier generation. */
export type Identifiers = WebDependency<{ create(input: {}): string }>;

/** Cancellable deferred work supplied by the browser host. */
export type Scheduler = WebDependency<{
  after(input: { milliseconds: number; run: () => void }): Disposable;
}>;

export type WebServiceWorkerHandlers<Message, NotificationData> = Readonly<{
  message?(
    event: Readonly<{ data: Message; respond(value: Message): void }>,
  ): void | PromiseLike<void>;
  push?(event: Readonly<{ data?: string }>): void | PromiseLike<void>;
  synchronize?(event: Readonly<{ tag: string; lastChance: boolean }>): void | PromiseLike<void>;
  notificationClick?(
    event: Readonly<{ action: string; data?: NotificationData }>,
  ): void | PromiseLike<void>;
}>;

/** Service-worker lifecycle and client communication supplied by the web adapter. */
export type WebServiceWorkerRuntime<Message = string, NotificationData = Message> = WebDependency<{
  subscribe(handlers: WebServiceWorkerHandlers<Message, NotificationData>): Disposable;
  showNotification(
    input: Readonly<{
      title: string;
      body?: string;
      icon?: string;
      badge?: string;
      tag?: string;
      data?: NotificationData;
    }>,
  ): Promise<void>;
  broadcast(message: Message): Promise<void>;
  openWindow(input: Readonly<{ url: string }>): Promise<void>;
}>;

export type WebHost = Readonly<{
  http: HttpClient;
  navigation: Navigation;
  storage: LocalStore;
  identifiers: Identifiers;
  scheduler: Scheduler;
  serviceWorker: WebServiceWorkerRuntime;
}>;

export type WebHostDependency = keyof WebHost;

type WebUISatisfiesContract = WebUI extends UIDefinition<WebUI> ? true : never;
const webUISatisfiesContract: WebUISatisfiesContract = true;
void webUISatisfiesContract;
export {
  Await,
  createPress,
  createShortcut,
  For,
  mountDialog,
  mountDrag,
  Show,
} from "@/platforms/web/ui";
export type {
  Child,
  DialogMode,
  DragOptions,
  DragRelease,
  DragSample,
  PressBindings,
  Shortcut,
  ShortcutBinding,
  VirtualForOptions,
} from "@/platforms/web/ui";
export type {
  Deferred,
  DeferredValue,
  PathParameterName,
  Validate,
  ValidationInput,
  ValidationOutput,
  ValidationRules,
  WebDestination,
  WebInstallation,
  WebInstallationIcon,
  WebJSON,
  WebNavigation,
  WebRouteCache,
  WebRouteContract,
  WebRouteMetadata,
  WebRouteMetadataResult,
  WebRouteOutcome,
  WebRouteSpecification,
  WebRoutes,
  WebServerRouteRequest,
  WebStructuredData,
} from "@/platforms/web/routing";
export * from "@/platforms/web/presentation";
