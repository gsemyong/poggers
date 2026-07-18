import type { PlatformAdapter, PlatformDefinition, PlatformPrimitive } from "../platform";
import type { Child, IntrinsicElements } from "./jsx/types";
import type { WebPresentationDeclaration, WebPresentationTokens } from "./presentation/language";
import { createWebPresentationAdapter } from "./presentation/runtime";
import { createApplicationUI, type WebStructureAdapter } from "./structure/language";

type WebPrimitiveName = Extract<keyof IntrinsicElements, string>;

type WebTarget<Name extends WebPrimitiveName> = Name extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[Name]
  : Name extends keyof SVGElementTagNameMap
    ? SVGElementTagNameMap[Name]
    : Element;

type WebPrimitive<Name extends WebPrimitiveName> = PlatformPrimitive<
  Omit<IntrinsicElements[Name], "class" | "className" | "style">,
  WebTarget<Name>,
  WebPresentationDeclaration<WebPresentationTokens>
>;

/** The typed structure and Presentation vocabulary of the web platform. */
export type WebPlatform = Readonly<{
  Name: "web";
  Child: Child;
  Primitives: {
    readonly [Name in WebPrimitiveName]: WebPrimitive<Name>;
  };
}>;

export type WebMain = { readonly Name: "web-main"; readonly Platform: WebPlatform };
export type WebServiceWorker = { readonly Name: "web-service-worker" };

type WebPlatformSatisfiesContract =
  WebPlatform extends PlatformDefinition<WebPlatform> ? true : never;
const webPlatformSatisfiesContract: WebPlatformSatisfiesContract = true;
void webPlatformSatisfiesContract;

export type WebPlatformAdapter = PlatformAdapter<WebPlatform, WebStructureAdapter, Element>;

/** Creates one paired web structure and Presentation implementation. */
export function createWebPlatformAdapter(): WebPlatformAdapter {
  const presentation = createWebPresentationAdapter<WebPresentationTokens>();
  const structure: WebStructureAdapter = {
    createApplicationUI(options) {
      return createApplicationUI({ ...options, presentationAdapter: presentation });
    },
  };
  return { name: "web", structure, presentation };
}
