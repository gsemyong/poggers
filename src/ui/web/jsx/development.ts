export { Fragment } from "#ui/web/structure/runtime";
import type { Child, IntrinsicElements as JSXIntrinsicElements } from "#ui/web/jsx/types";
export type { Child } from "#ui/web/jsx/types";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "#ui/web/jsx/types";

import { jsx } from "#ui/web/structure/runtime";

export function jsxDEV(type: Parameters<typeof jsx>[0], props: Parameters<typeof jsx>[1]) {
  return jsx(type, props);
}

export namespace JSX {
  export type Element = Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = JSXIntrinsicElements;
}
