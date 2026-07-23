import type { JSXElement } from "@/core/ui/language";

export type { JSXElement } from "@/core/ui/language";

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

type JSXRendererRegistration = Readonly<{
  platform: PropertyKey | JSXNativeRenderer;
  renderer: JSXNativeRenderer;
}>;

const rendererRegistrations: JSXRendererRegistration[] = [];
let nativeRenderer: JSXNativeRenderer | undefined;

/** Activates the native intrinsic renderer for one owned UI lifetime. */
export function activateJSXRenderer(
  renderer: JSXNativeRenderer,
  platform: PropertyKey | JSXNativeRenderer = renderer,
): Disposable {
  const current = rendererRegistrations.at(-1);
  if (current && current.platform !== platform) {
    throw new Error("A different UI Platform JSX renderer is already active in this realm.");
  }
  const registration = { platform, renderer };
  rendererRegistrations.push(registration);
  nativeRenderer = renderer;
  let active = true;
  return {
    [Symbol.dispose]() {
      if (!active) return;
      active = false;
      const index = rendererRegistrations.lastIndexOf(registration);
      if (index >= 0) rendererRegistrations.splice(index, 1);
      nativeRenderer = rendererRegistrations.at(-1)?.renderer;
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
