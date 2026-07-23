import type { FeatureContract } from "@/core/feature";
import type { UIDefinition, UIElement } from "@/core/ui/language";
import type { WebNavigation, WebRouteContract, WebRoutes } from "@/platforms/web/routing";
import type { Child, IntrinsicElements } from "@/platforms/web/ui";

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
export type Navigation<
  Routes extends Readonly<Record<string, WebRouteContract>> = Readonly<
    Record<string, WebRouteContract>
  >,
  Owner extends FeatureContract | undefined = undefined,
> = WebNavigation<Routes & (Owner extends FeatureContract ? WebRoutes<Owner> : {})>;

/** Durable origin-local values supplied by the browser host. */
export type LocalStore = Readonly<{
  read<Value>(input: { key: string }): Promise<Value | undefined>;
  write<Value>(input: { key: string; value: Value }): Promise<void>;
  remove(input: { key: string }): Promise<void>;
}>;

/** Browser-owned identifier generation. */
export type Identifiers = Readonly<{ create(input: {}): string }>;

/** Cancellable deferred work supplied by the browser host. */
export type Scheduler = Readonly<{
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
export type WebServiceWorkerRuntime<Message = string, NotificationData = Message> = Readonly<{
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
export { createWebInterface, mountFeature } from "@/platforms/web/routing";
export type {
  Deferred,
  DeferredValue,
  MountedWebFeature,
  PathParameterName,
  Validate,
  ValidationInput,
  ValidationOutput,
  ValidationRules,
  WebDestination,
  WebFeature,
  WebInstallation,
  WebInstallationIcon,
  WebInterfaceFeature,
  WebJSON,
  WebNavigation,
  WebRoute,
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
