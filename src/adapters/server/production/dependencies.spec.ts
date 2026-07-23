import { describe, expect, test } from "vitest";

import {
  defineServerProductionDependency,
  resolveServerProductionDependencies,
  type ServerProductionDependency,
} from "@/adapters/server/production/dependencies";
import type { DependencyIR } from "@/compiler/ir";
import { collectDependencyOperations } from "@/compiler/linker";

const clock: DependencyIR = {
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

const identifiers: DependencyIR = {
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
          result: { kind: "promise", value: { kind: "primitive", name: "string" } },
        },
      },
    ],
  },
};

describe("server production Dependency binding", () => {
  test("selects implementations in Dependency order without a second API schema", () => {
    const implementations = [
      implementation(identifiers),
      implementation(clock, { requires: ["identifiers"] }),
    ];

    expect(
      resolveServerProductionDependencies({
        dependencies: [clock, identifiers],
        implementations,
      }).map(({ dependency, operations }) => ({
        dependency: dependency.name,
        operations,
      })),
    ).toEqual([
      {
        dependency: "identifiers",
        operations: [
          {
            name: "create",
            mode: "asynchronous",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "string" },
          },
        ],
      },
      {
        dependency: "clock",
        operations: [
          {
            name: "now",
            mode: "synchronous",
            input: { kind: "record", fields: [] },
            output: { kind: "primitive", name: "number" },
          },
        ],
      },
    ]);
  });

  test("rejects missing, duplicate, cyclic, and malformed bindings before Cargo", () => {
    expect(() =>
      resolveServerProductionDependencies({ dependencies: [clock], implementations: [] }),
    ).toThrow('missing Dependency "clock"');

    expect(() =>
      resolveServerProductionDependencies({
        dependencies: [clock],
        implementations: [implementation(clock), { ...implementation(clock), name: "other-clock" }],
      }),
    ).toThrow("multiple implementations");

    expect(() =>
      resolveServerProductionDependencies({
        dependencies: [clock, identifiers],
        implementations: [
          implementation(clock, { requires: ["identifiers"] }),
          implementation(identifiers, { requires: ["clock"] }),
        ],
      }),
    ).toThrow("Dependency cycle: clock, identifiers");

    expect(() =>
      resolveServerProductionDependencies({
        dependencies: [clock],
        implementations: [implementation(clock, { requires: ["identifiers"] })],
      }),
    ).toThrow('requires missing Dependency "identifiers"');

    expect(() =>
      resolveServerProductionDependencies({
        dependencies: [clock],
        implementations: [
          implementation(clock),
          { ...implementation(identifiers), name: implementation(clock).name },
        ],
      }),
    ).toThrow('implementation "clock-production" is duplicated');

    expect(() =>
      collectDependencyOperations({
        name: "invalid",
        type: { kind: "primitive", name: "string" },
      }),
    ).toThrow("must be a record of operations");
  });

  test("validates realization metadata only", () => {
    expect(() =>
      defineServerProductionDependency({
        ...implementation(clock),
        configuration: [{ name: "port", environment: "PORT", required: true, default: "3000" }],
      }),
    ).toThrow("cannot be required and defaulted");
  });
});

function implementation(
  dependency: DependencyIR,
  overrides: Partial<ServerProductionDependency> = {},
): ServerProductionDependency {
  return defineServerProductionDependency({
    name: `${dependency.name}-production`,
    dependency: dependency.name,
    configuration: [],
    crate: { package: `kit-${dependency.name}`, directory: dependency.name },
    rust: {
      type: `kit_${dependency.name}::Dependency`,
      constructor: `kit_${dependency.name}::create`,
    },
    ...overrides,
  });
}
