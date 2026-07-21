import { describe, expect, it } from "vitest";

import { needsNativePropertyWrite } from "@/adapters/web/ui/component/runtime";

describe("web Structure native property writes", () => {
  it("materializes an authored empty reflected attribute exactly once", () => {
    expect(needsNativePropertyWrite("", "", null)).toBe(true);
    expect(needsNativePropertyWrite("", "", "")).toBe(false);
    expect(needsNativePropertyWrite("warm.svg", "cool.svg", "warm.svg")).toBe(true);
  });
});
