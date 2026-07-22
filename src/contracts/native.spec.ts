import { describe, expect, test } from "vitest";

import {
  defineNativeCapabilityAdapter,
  nativeCapabilityContract,
  resolveNativeCapabilityAdapters,
  type NativeCapabilityAdapter,
} from "@/contracts/native";
import type { CapabilityIR } from "@/core/compiler/ir";

const clock: CapabilityIR = {
  name: "clock",
  type: {
    kind: "record",
    fields: [
      {
        name: "now",
        optional: false,
        type: {
          kind: "function",
          parameters: [{ name: "input", optional: false, type: { kind: "record", fields: [] } }],
          result: { kind: "primitive", name: "number" },
        },
      },
    ],
  },
};

const identifiers: CapabilityIR = {
  name: "identifiers",
  type: {
    kind: "record",
    fields: [
      {
        name: "create",
        optional: false,
        type: {
          kind: "function",
          parameters: [{ name: "input", optional: false, type: { kind: "record", fields: [] } }],
          result: { kind: "primitive", name: "string" },
        },
      },
    ],
  },
};

describe("native Capability adapter contract", () => {
  test("selects structurally compatible adapters in dependency order", () => {
    const adapters = [adapter(identifiers), adapter(clock, { requires: ["identifiers"] })];

    expect(
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock, identifiers],
        adapters,
      }).map(({ capability }) => capability.name),
    ).toEqual(["identifiers", "clock"]);
  });

  test("rejects missing, incompatible, duplicate, and cyclic adapters before Cargo", () => {
    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock],
        adapters: [],
      }),
    ).toThrow('missing Capability "clock"');

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [
          {
            ...clock,
            type: { kind: "record", fields: [] },
          },
        ],
        adapters: [adapter(clock)],
      }),
    ).toThrow('incompatible Capability "clock"');

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock],
        adapters: [adapter(clock), { ...adapter(clock), name: "other-clock" }],
      }),
    ).toThrow("multiple compatible adapters");

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock, identifiers],
        adapters: [
          adapter(clock, { requires: ["identifiers"] }),
          adapter(identifiers, { requires: ["clock"] }),
        ],
      }),
    ).toThrow("adapter cycle: clock, identifiers");

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock],
        adapters: [adapter(clock, { requires: ["identifiers"] })],
      }),
    ).toThrow('requires missing Capability "identifiers"');

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock],
        adapters: [adapter(clock), { ...adapter(identifiers), name: "clock-native" }],
      }),
    ).toThrow('Native adapter "clock-native" is duplicated');
  });

  test("validates descriptor identifiers and configuration", () => {
    expect(() =>
      defineNativeCapabilityAdapter({
        ...adapter(clock),
        configuration: [{ name: "port", environment: "PORT", required: true, default: "3000" }],
      }),
    ).toThrow("cannot be required and defaulted");
  });

  test("rejects a mismatch nested inside an operation contract", () => {
    const incompatible = adapter(clock, {
      contract: {
        name: "clock",
        operations: [
          {
            name: "now",
            mode: "synchronous",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "string" },
          },
        ],
      },
    });

    expect(() =>
      resolveNativeCapabilityAdapters({
        platform: "server",
        capabilities: [clock],
        adapters: [incompatible],
      }),
    ).toThrow('incompatible Capability "clock"');
  });
});

function adapter(
  capability: CapabilityIR,
  overrides: Partial<NativeCapabilityAdapter> = {},
): NativeCapabilityAdapter {
  return defineNativeCapabilityAdapter({
    name: `${capability.name}-native`,
    platform: "server",
    contract: nativeCapabilityContract(capability),
    configuration: [],
    crate: { package: `poggers-${capability.name}`, directory: capability.name },
    rust: {
      type: `poggers_${capability.name}::Capability`,
      constructor: `poggers_${capability.name}::create`,
    },
    ...overrides,
  });
}
