export { Fragment, jsx, jsxs } from "./ui";
export type { Child } from "./ui";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./jsx-types";

export namespace JSX {
  export type Element = import("./ui").Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = import("./jsx-types").IntrinsicElements;
}
