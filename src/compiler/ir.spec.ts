import fc from "fast-check";
import { expect, test } from "vitest";

import {
  SYSTEM_IR_VERSION,
  assertSystemIRVersion,
  serializeSystemIR,
  type SystemIR,
  type DependencyIR,
  type ProgramContributionIR,
  type ProgramIR,
  type TypeIR,
} from "@/compiler/ir";
import { linkProgram, ProgramLinkError } from "@/compiler/linker";

test("serializes arbitrary valid System IR deterministically", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 20 }),
      (name, paths) => {
        const features = paths
          .map((path) => ({
            id: `feature/${path}`,
            path,
            kind: "feature" as const,
            children: [],
            programs: [],
          }))
          .sort(({ id: left }, { id: right }) => left.localeCompare(right));
        const ir: SystemIR = {
          version: SYSTEM_IR_VERSION,
          system: { id: "system", name },
          platforms: [],
          apps: [],
          interfaces: [],
          features,
          programs: [],
          presentations: [],
        };

        const first = serializeSystemIR(ir);
        const restored = JSON.parse(first) as SystemIR;
        expect(serializeSystemIR(restored)).toBe(first);
        expect(first.endsWith("\n")).toBe(true);
      },
    ),
    { numRuns: 100 },
  );
});

test("rejects System IR from every other schema version", () => {
  expect(() => assertSystemIRVersion({ version: SYSTEM_IR_VERSION - 1 })).toThrow(
    `Unsupported System IR version ${SYSTEM_IR_VERSION - 1}.`,
  );
  expect(() => assertSystemIRVersion({ version: SYSTEM_IR_VERSION + 1 })).toThrow(
    `Unsupported System IR version ${SYSTEM_IR_VERSION + 1}.`,
  );
});

const textType: TypeIR = { kind: "primitive", name: "string" };
const numberType: TypeIR = { kind: "primitive", name: "number" };
const repository: DependencyIR = {
  name: "repository",
  type: {
    kind: "record",
    fields: [
      {
        name: "read",
        optional: false,
        type: {
          kind: "function",
          parameters: [
            {
              name: "input",
              optional: false,
              type: { kind: "record", fields: [{ name: "id", optional: false, type: textType }] },
            },
          ],
          result: { kind: "promise", value: textType },
        },
      },
    ],
  },
};

test("links internal providers and external Dependencies in dependency order", () => {
  const program = fixtureProgram([
    contribution("consumer", [repository, { name: "clock", type: numberType }]),
    contribution("provider", [], [repository]),
  ]);

  const linked = linkProgram(program);

  expect(linked.contributions.map(({ contribution }) => contribution.feature)).toEqual([
    "provider",
    "consumer",
  ]);
  expect(linked.contributions[1]?.dependencies).toEqual(["provider"]);
  expect(linked.external).toEqual([{ name: "clock", type: numberType }]);
  expect(linked.dependencies).toEqual([
    { name: "clock", type: numberType, consumers: ["consumer"] },
    {
      name: "repository",
      type: repository.type,
      consumers: ["consumer"],
      provider: "provider",
    },
  ]);
});

test("links the same Program identically for every contribution permutation", () => {
  const values = [
    contribution("projection", [repository]),
    contribution("repository", [], [repository]),
    contribution("telemetry", [{ name: "clock", type: numberType }]),
  ];
  const expected = linkProgram(fixtureProgram(values));

  fc.assert(
    fc.property(
      fc.shuffledSubarray(values, { minLength: values.length, maxLength: values.length }),
      (items) => {
        expect(linkProgram(fixtureProgram(items))).toEqual({
          ...expected,
          program: fixtureProgram(items),
        });
      },
    ),
    { numRuns: 30 },
  );
});

test("rejects duplicate providers, incompatible contracts, and provider cycles", () => {
  expect(() =>
    linkProgram(
      fixtureProgram([
        contribution("left", [], [repository]),
        contribution("right", [], [repository]),
      ]),
    ),
  ).toThrow(/multiple providers/);

  expect(() =>
    linkProgram(
      fixtureProgram([
        contribution("consumer", [{ ...repository, type: numberType }]),
        contribution("provider", [], [repository]),
      ]),
    ),
  ).toThrow(/incompatible contracts/);

  expect(() =>
    linkProgram(
      fixtureProgram([
        contribution(
          "left",
          [{ name: "right", type: numberType }],
          [{ name: "left", type: numberType }],
        ),
        contribution(
          "right",
          [{ name: "left", type: numberType }],
          [{ name: "right", type: numberType }],
        ),
      ]),
    ),
  ).toThrow(ProgramLinkError);
});

test("treats function parameter names as documentation rather than contract identity", () => {
  if (repository.type.kind !== "record") throw new Error("Repository fixture must be a record.");
  const renamed = {
    ...repository,
    type: {
      kind: "record",
      fields: repository.type.fields.map((field) =>
        field.type.kind === "function"
          ? {
              ...field,
              type: {
                ...field.type,
                parameters: field.type.parameters.map((parameter) => ({
                  ...parameter,
                  name: `renamed_${parameter.name}`,
                })),
              },
            }
          : field,
      ),
    },
  } satisfies DependencyIR;

  expect(() =>
    linkProgram(
      fixtureProgram([
        contribution("consumer", [renamed]),
        contribution("provider", [], [repository]),
      ]),
    ),
  ).not.toThrow();
});

function fixtureProgram(contributions: readonly ProgramContributionIR[]): ProgramIR {
  return {
    id: "program/api",
    name: "api",
    logicalName: "api",
    environment: { name: "server", platform: "server" },
    contributions,
  };
}

function contribution(
  feature: string,
  requires: readonly DependencyIR[] = [],
  provides: readonly DependencyIR[] = [],
): ProgramContributionIR {
  return {
    id: `feature/${feature}/program/api`,
    feature,
    requires,
    provides,
    implementation: { kind: "none" },
    span: { file: `${feature}.ts`, line: 1, column: 1 },
  };
}
