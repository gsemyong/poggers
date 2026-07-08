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

export function jsxDEV(type: Parameters<typeof jsx>[0], props: Parameters<typeof jsx>[1]) {
  return jsx(type, props);
}

export namespace JSX {
  export type Element = import("./ui").Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = import("./jsx-types").IntrinsicElements;
}
