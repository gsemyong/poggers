import type { PlatformDefinition, PlatformPrimitive } from "../../platform";
import type { Child, IntrinsicElements } from "./jsx-types";
import type { WebPresentationDeclaration, WebPresentationTokens } from "./presentation/language";

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

type WebPlatformSatisfiesContract =
  WebPlatform extends PlatformDefinition<WebPlatform> ? true : never;
const webPlatformSatisfiesContract: WebPlatformSatisfiesContract = true;
void webPlatformSatisfiesContract;
