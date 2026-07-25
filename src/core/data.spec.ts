import { describe, expect, test } from "vitest";

import { cloneData, equalData } from "@/core/data";

describe("canonical durable data", () => {
  test("normalizes the values persisted by every EventStore implementation", () => {
    const value = {
      z: undefined,
      a: [{ absent: undefined, value: -0 }, undefined],
    };

    expect(cloneData(value)).toEqual({
      a: [{ value: 0 }, null],
    });
    expect(Object.getPrototypeOf(cloneData(value))).toBeNull();
    expect(Object.keys(cloneData({ z: 1, a: 2 }))).toEqual(["z", "a"]);
    expect(equalData({ second: 2, first: 1 }, { first: 1, second: 2 })).toBe(true);
    expect(cloneData(undefined)).toBeUndefined();
  });

  test.each([
    ["non-finite numbers", { value: Number.NaN }],
    ["functions", { value: () => undefined }],
    ["symbols", { value: Symbol("value") }],
    ["bigints", { value: 1n }],
    ["platform objects", { value: new Date(0) }],
  ])("rejects %s before a host implementation receives them", (_name, value) => {
    expect(() => cloneData(value, "Input")).toThrow(TypeError);
  });

  test("rejects circular data", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => cloneData(value)).toThrow("circular");
  });
});
