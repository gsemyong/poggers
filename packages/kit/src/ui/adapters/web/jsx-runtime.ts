export { Fragment, jsx, jsxs } from "#ui/adapters/web/runtime";
import type { Child, IntrinsicElements as JSXIntrinsicElements } from "#ui/adapters/web/jsx-types";
export type { Child } from "#ui/adapters/web/jsx-types";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "#ui/adapters/web/jsx-types";

export namespace JSX {
  export type Element = Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = JSXIntrinsicElements;
}
