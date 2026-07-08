export { Fragment, jsx, jsxs } from "./ui";
export type { Child } from "./ui";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./jsx-types";
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
