import { describe, expect, test, vi } from "vitest";

import { installJSXRenderer, jsx } from "./runtime";

describe("shared JSX protocol", () => {
  test("calls Components and native renderers directly without retaining a tree", () => {
    const nativeNode = { kind: "native" };
    const renderNative = vi.fn(() => nativeNode);
    installJSXRenderer(renderNative);

    const componentNode = { kind: "component" };
    const Component = vi.fn(() => componentNode);

    expect(jsx(Component, { value: 1 })).toBe(componentNode);
    expect(Component).toHaveBeenCalledOnce();
    expect(renderNative).not.toHaveBeenCalled();

    expect(jsx("surface", { value: 2 })).toBe(nativeNode);
    expect(renderNative).toHaveBeenCalledWith("surface", { value: 2 });
  });
});
