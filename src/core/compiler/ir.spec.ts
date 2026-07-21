import fc from "fast-check";
import { expect, test } from "vitest";

import {
  linkProgram,
  POGGERS_IR_VERSION,
  ProgramLinkError,
  serializeApplicationIR,
  type ApplicationIR,
  type CapabilityIR,
  type ProgramContributionIR,
  type ProgramIR,
  type TypeIR,
} from "@/core/compiler/ir";

test("serializes arbitrary valid Application IR deterministically", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }), { maxLength: 20 }),
      (name, paths) => {
        const features = paths
          .map((path) => ({ id: `feature/${path}`, path, children: [], programs: [] }))
          .sort(({ id: left }, { id: right }) => left.localeCompare(right));
        const ir: ApplicationIR = {
          version: POGGERS_IR_VERSION,
          application: { id: `application/${name}`, name, presentations: [] },
          platforms: [],
          features,
          programs: [],
          presentations: [],
        };

        const first = serializeApplicationIR(ir);
        const restored = JSON.parse(first) as ApplicationIR;
        expect(serializeApplicationIR(restored)).toBe(first);
        expect(first.endsWith("\n")).toBe(true);
      },
    ),
    { numRuns: 100 },
  );
});

const textType: TypeIR = { kind: "primitive", name: "string" };
const numberType: TypeIR = { kind: "primitive", name: "number" };
const repository: CapabilityIR = {
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

test("links internal providers and external Capabilities in dependency order", () => {
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
  expect(linked.capabilities).toEqual([
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
  } satisfies CapabilityIR;

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
    environment: { name: "server", platform: "server" },
    contributions,
  };
}

function contribution(
  feature: string,
  requires: readonly CapabilityIR[] = [],
  provides: readonly CapabilityIR[] = [],
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
