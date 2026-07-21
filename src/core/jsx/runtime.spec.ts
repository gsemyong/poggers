import { describe, expect, test, vi } from "vitest";

import { activateJSXRenderer, jsx } from "@/core/jsx/runtime";

describe("shared JSX protocol", () => {
  test("calls Components and native renderers directly without retaining a tree", () => {
    const nativeNode = { kind: "native" };
    const renderNative = vi.fn(() => nativeNode);
    const activation = activateJSXRenderer(renderNative);

    const componentNode = { kind: "component" };
    const Component = vi.fn(() => componentNode);

    expect(jsx(Component, { value: 1 })).toBe(componentNode);
    expect(Component).toHaveBeenCalledOnce();
    expect(renderNative).not.toHaveBeenCalled();

    expect(jsx("surface", { value: 2 })).toBe(nativeNode);
    expect(renderNative).toHaveBeenCalledWith("surface", { value: 2 });
    activation[Symbol.dispose]();
    expect(() => jsx("surface", {})).toThrow("No UI Platform renderer is active");
  });

  test("retains shared activation until the final owner disposes", () => {
    const renderer = vi.fn(() => ({}));
    const first = activateJSXRenderer(renderer);
    const second = activateJSXRenderer(renderer);

    first[Symbol.dispose]();
    expect(() => jsx("surface", {})).not.toThrow();
    first[Symbol.dispose]();
    second[Symbol.dispose]();
    expect(() => jsx("surface", {})).toThrow("No UI Platform renderer is active");
  });
});
