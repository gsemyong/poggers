import { Fragment, jsx, type JSXIntrinsicElements } from "./runtime";
import type { JSXElement } from "./types";

export { Fragment };

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
): JSXElement {
  return jsx(type, props);
}

export namespace JSX {
  export type Element = JSXElement;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = JSXIntrinsicElements;
}

export type { JSXElement } from "./types";
