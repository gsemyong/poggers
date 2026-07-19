import { installJSXRenderer } from "../jsx/runtime";
import type { UIPlatformAdapter, UIPlatformDefinition, UIPlatformPrimitive } from "../platform";
import type { PresentationAdapter } from "../presentation";
import { createApplicationUI, type WebComponentAdapter } from "./component/adapter";
import type { Child, IntrinsicElements } from "./component/elements";
import { jsx as webJSX } from "./component/runtime";
import { createWebPresentationAdapter } from "./presentation/adapter";
import type { WebPresentationLanguage, WebPresentationTokens } from "./presentation/language";

type WebPrimitiveName = Extract<keyof IntrinsicElements, string>;

type WebTarget<Name extends WebPrimitiveName> = Name extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[Name]
  : Name extends keyof SVGElementTagNameMap
    ? SVGElementTagNameMap[Name]
    : Element;

type WebPrimitive<Name extends WebPrimitiveName> = UIPlatformPrimitive<
  Omit<IntrinsicElements[Name], "class" | "className" | "style">,
  WebTarget<Name>
>;

const renderWebIntrinsic = (type: string, props: Readonly<Record<string, unknown>>) =>
  webJSX(type, props as Parameters<typeof webJSX>[1]);

/** The typed structure and Presentation vocabulary of the web platform. */
export type WebUIPlatform = Readonly<{
  Name: "web";
  Child: Child;
  Primitives: {
    readonly [Name in WebPrimitiveName]: WebPrimitive<Name>;
  };
}>;

export type BrowserMainThread = { readonly Name: "browser-main"; readonly UI: WebUIPlatform };
export type BrowserServiceWorker = { readonly Name: "browser-service-worker" };

type WebUIPlatformSatisfiesContract =
  WebUIPlatform extends UIPlatformDefinition<WebUIPlatform> ? true : never;
const webPlatformSatisfiesContract: WebUIPlatformSatisfiesContract = true;
void webPlatformSatisfiesContract;

export type WebUIPlatformAdapter = UIPlatformAdapter<
  WebUIPlatform,
  WebComponentAdapter,
  PresentationAdapter<WebPresentationLanguage<WebPresentationTokens>, Element>
>;

/** Creates one paired web structure and Presentation implementation. */
export function createWebUIPlatformAdapter(): WebUIPlatformAdapter {
  installJSXRenderer(renderWebIntrinsic);
  const presentation = createWebPresentationAdapter<WebPresentationTokens>();
  const component: WebComponentAdapter = {
    createApplicationUI(options) {
      return createApplicationUI({ ...options, presentationAdapter: presentation });
    },
  };
  return { name: "web", component, presentation };
}
