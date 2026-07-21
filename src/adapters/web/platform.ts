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
