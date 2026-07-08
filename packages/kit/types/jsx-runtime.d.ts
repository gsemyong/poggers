export { Fragment, jsx, jsxs } from "./infra/ui";
export type { Child } from "./infra/ui";
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./infra/jsx-types";
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
