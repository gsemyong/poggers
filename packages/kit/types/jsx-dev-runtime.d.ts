export { Fragment } from "./infra/ui";
export type { Child } from "./infra/ui";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./infra/jsx-types";
import { jsx } from "./infra/ui";
export declare function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
): import("./ui").Child;
export declare namespace JSX {
  type Element = import("./infra/ui").Child;
  type ElementClass = never;
  type ElementChildrenAttribute = {
    children: unknown;
  };
  type IntrinsicAttributes = {
    key?: string | number;
  };
  type IntrinsicElements = import("./infra/jsx-types").IntrinsicElements;
}
