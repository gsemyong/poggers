import type { JSXElement } from "./types";

export type JSXPlatformRegistration<IntrinsicElements extends object> = Readonly<{
  IntrinsicElements: IntrinsicElements;
}>;

/** UI Platforms extend this registry with their native intrinsic vocabulary. */
export interface JSXPlatforms {}

type RegisteredIntrinsics = JSXPlatforms[keyof JSXPlatforms] extends infer Registration
  ? Registration extends JSXPlatformRegistration<infer Intrinsics>
    ? Intrinsics
    : never
  : never;

type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export type JSXIntrinsicElements = [RegisteredIntrinsics] extends [never]
  ? Record<never, never>
  : UnionToIntersection<RegisteredIntrinsics>;

type JSXProps = Readonly<Record<string, unknown>> & { readonly children?: unknown };
type JSXComponent = (props: JSXProps) => unknown;
type JSXNativeRenderer = (type: string, props: JSXProps) => unknown;

let nativeRenderer: JSXNativeRenderer | undefined;
let rendererOwners = 0;

/** Activates the native intrinsic renderer for one owned UI lifetime. */
export function activateJSXRenderer(renderer: JSXNativeRenderer): Disposable {
  if (nativeRenderer && nativeRenderer !== renderer) {
    throw new Error("A different UI Platform JSX renderer is already active in this realm.");
  }
  nativeRenderer = renderer;
  rendererOwners++;
  let active = true;
  return {
    [Symbol.dispose]() {
      if (!active) return;
      active = false;
      rendererOwners--;
      if (rendererOwners === 0) nativeRenderer = undefined;
    },
  };
}

export function jsx(type: string | JSXComponent, props: JSXProps | null): JSXElement {
  const value =
    typeof type === "function"
      ? type(props ?? {})
      : nativeRenderer
        ? nativeRenderer(type, props ?? {})
        : missingNativeRenderer(type);
  return value as JSXElement;
}

export const jsxs = jsx;

export function Fragment(props: { readonly children?: unknown }): JSXElement {
  return props.children as JSXElement;
}

function missingNativeRenderer(type: string): never {
  throw new Error(
    `No UI Platform renderer is active for intrinsic element ${JSON.stringify(type)}.`,
  );
}

export namespace JSX {
  export type Element = JSXElement;
  export type ElementClass = never;
  export type ElementChildrenAttribute = { children: unknown };
  export type IntrinsicAttributes = { key?: string | number };
  export type IntrinsicElements = JSXIntrinsicElements;
}

export type { JSXElement } from "./types";
