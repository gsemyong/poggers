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

export function jsxDEV(type: Parameters<typeof jsx>[0], props: Parameters<typeof jsx>[1]) {
  return jsx(type, props);
}

export namespace JSX {
  export type Element = import("./infra/ui").Child;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = import("./infra/jsx-types").IntrinsicElements;
}
