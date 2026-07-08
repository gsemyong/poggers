export { Fragment } from "./ui";
export type { Child } from "./ui";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./jsx-types";
import { jsx } from "./ui";
export declare function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
): import("./ui").Child;
export declare namespace JSX {
  type Element = import("./ui").Child;
  type ElementClass = never;
  type ElementChildrenAttribute = {
    children: unknown;
  };
  type IntrinsicAttributes = {
    key?: string | number;
  };
  type IntrinsicElements = import("./jsx-types").IntrinsicElements;
}
