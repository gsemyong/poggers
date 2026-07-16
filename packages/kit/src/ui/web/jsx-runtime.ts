export { Fragment, jsx, jsxs } from "#ui/web/runtime";
import type { Child, IntrinsicElements as JSXIntrinsicElements } from "#ui/web/jsx-types";
export type { Child } from "#ui/web/jsx-types";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "#ui/web/jsx-types";

export namespace JSX {
  export type Element = Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = JSXIntrinsicElements;
}
