import { createHash } from "node:crypto";

import fc from "fast-check";
import { expect, test } from "vitest";

import {
  SYSTEM_IR_VERSION,
  assertSystemIRVersion,
  compactPortableProgramExecution,
  compactPortableProgramModule,
  dependencyContractIdentity,
  dependencyOperationIdentity,
  expandPortableProgramExecution,
  expandPortableProgramReference,
  selectDependencyProviders,
  serializeSystemIR,
  typeIdentity,
  type SystemIR,
  type DependencyIR,
  type ExtensionIR,
  type FunctionIR,
  type ProgramContributionIR,
  type ProgramIR,
  type TypeIR,
} from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";

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

test("interns portable types deterministically and rejects invalid references", () => {
  const span = { file: "feature.ts", line: 1, column: 1 };
  const shared: TypeIR = {
    kind: "record",
    fields: [
      { name: "id", optional: false, type: { kind: "primitive", name: "string" } },
      {
        name: "status",
        optional: false,
        type: {
          kind: "union",
          variants: [
            { kind: "literal", value: "active" },
            { kind: "literal", value: "paused" },
          ],
        },
      },
    ],
  };
  const entry: FunctionIR = {
    id: "start",
    name: "start",
    asynchronous: false,
    captures: [],
    parameters: [{ name: "input", optional: false, type: shared }],
    result: shared,
    body: Array.from({ length: 100 }, () => ({
      kind: "expression" as const,
      expression: {
        kind: "local" as const,
        name: "input",
        type: shared,
        span,
      },
      span,
    })),
    span,
  };

  const compact = compactPortableProgramExecution({ entry, functions: [] });
  if (compact.kind !== "portable") throw new Error("Expected compact portable meaning.");
  const expanded = expandPortableProgramExecution(compact);

  expect(expanded).toEqual({ kind: "portable", entry, functions: [] });
  expect(
    compactPortableProgramExecution(
      expanded.kind === "portable" ? expanded : { entry, functions: [] },
    ),
  ).toEqual(compact);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(expanded).length / 2);
  if (!compact.entry || typeof compact.entry !== "object" || Array.isArray(compact.entry)) {
    throw new Error("Expected compact entry object.");
  }
  expect(() =>
    expandPortableProgramExecution({
      kind: "portable",
      types: [],
      entry: {
        ...(compact.entry as Readonly<Record<string, ExtensionIR>>),
        result: 999,
      },
      functions: [],
    }),
  ).toThrow("Invalid portable type reference");
});

test("stores one shared portable function module for a whole Program", () => {
  const span = { file: "feature.ts", line: 1, column: 1 };
  const voidType: TypeIR = { kind: "primitive", name: "void" };
  const helper: FunctionIR = {
    id: "shared",
    name: "shared",
    asynchronous: false,
    captures: [],
    parameters: [],
    result: voidType,
    body: [{ kind: "return", span }],
    span,
  };
  const execution = (id: string) =>
    ({
      kind: "portable",
      entry: {
        id,
        name: id,
        asynchronous: false,
        captures: [],
        parameters: [],
        result: voidType,
        body: [
          {
            kind: "expression",
            expression: {
              kind: "call",
              function: helper.id,
              arguments: [],
              awaited: false,
              type: voidType,
              span,
            },
            span,
          },
        ],
        span,
      },
      functions: [helper],
    }) as const;
  const source = [execution("first"), execution("second")];
  const compact = compactPortableProgramModule(source);

  expect(compact.module.functions).toHaveLength(3);
  expect(compact.module.types).toHaveLength(1);
  expect(
    compact.executions.map((value) => expandPortableProgramReference(value, compact.module)),
  ).toEqual(source);
  expect(compactPortableProgramModule(source)).toEqual(compact);
  expect(JSON.stringify(compact.executions).length).toBeLessThan(200);
  expect(() =>
    expandPortableProgramReference({ kind: "portable", entry: 999, functions: [] }, compact.module),
  ).toThrow("Invalid portable function reference");
});

test("selects visible Feature providers once and rejects conflicting ownership", () => {
  const program = fixtureProgram([contribution("owner.consumer", [repository])]);
  const provider = {
    dependency: "repository",
    platform: "server",
    development: true,
    developmentIdentity: "provider-v1",
    span: { file: "provider.ts", line: 1, column: 1 },
  } as const;
  const ir: SystemIR = {
    version: SYSTEM_IR_VERSION,
    system: { id: "system", name: "providers" },
    platforms: ["server"],
    apps: [],
    interfaces: [],
    features: [
      {
        id: "feature/owner",
        path: "owner",
        children: ["feature/owner.consumer"],
        programs: [],
        providers: [provider],
      },
      {
        id: "feature/owner.consumer",
        path: "owner.consumer",
        children: [],
        programs: ["program/api"],
        providers: [provider, { ...provider, platform: "web" }],
      },
      {
        id: "feature/unrelated",
        path: "unrelated",
        children: [],
        programs: [],
        providers: [{ ...provider, span: { file: "unrelated.ts", line: 1, column: 1 } }],
      },
    ],
    programs: [program],
  };

  expect(selectDependencyProviders(ir, program, ["repository"])).toEqual([
    { ...provider, feature: "owner" },
  ]);
  expect(() =>
    selectDependencyProviders(
      {
        ...ir,
        features: ir.features.map((feature) =>
          feature.path === "owner.consumer"
            ? {
                ...feature,
                providers: [
                  {
                    ...provider,
                    span: { file: "conflict.ts", line: 1, column: 1 },
                  },
                ],
              }
            : feature,
        ),
      },
      program,
      ["repository"],
    ),
  ).toThrow(/conflicting providers/);
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
    contribution("consumer", [repository, dependency("clock", numberType)]),
    contribution("provider", [], [repository]),
  ]);

  const linked = linkProgram(program);

  expect(linked.contributions.map(({ contribution }) => contribution.feature)).toEqual([
    "provider",
    "consumer",
  ]);
  expect(linked.contributions[1]?.dependencies).toEqual(["provider"]);
  expect(linked.external).toEqual([dependency("clock", numberType)]);
  expect(linked.dependencies).toEqual([
    { ...dependency("clock", numberType), consumers: ["consumer"] },
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
    contribution("telemetry", [dependency("clock", numberType)]),
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

test("rejects duplicate providers and different contracts while linking provider cycles", () => {
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
  ).toThrow(/different contracts/);
  expect(() =>
    linkProgram(
      fixtureProgram([
        contribution("consumer", [
          {
            ...repository,
            failures: {
              kind: "record",
              fields: [{ name: "missing", optional: false, type: textType }],
            },
          },
        ]),
        contribution("provider", [], [repository]),
      ]),
    ),
  ).toThrow(/different contracts/);

  const linked = linkProgram(
    fixtureProgram([
      contribution("left", [dependency("right", numberType)], [dependency("left", numberType)]),
      contribution("right", [dependency("left", numberType)], [dependency("right", numberType)]),
    ]),
  );
  expect(linked.contributions.map(({ contribution }) => contribution.feature)).toEqual([
    "left",
    "right",
  ]);
});

function dependency(name: string, type: TypeIR): DependencyIR {
  return { name, type };
}

test("derives collision-free Dependency operation identities from canonical meaning", () => {
  const first: TypeIR = {
    kind: "record",
    fields: [
      { name: "a,b", optional: false, type: textType },
      { name: "c", optional: true, type: numberType },
    ],
  };
  const reordered: TypeIR = {
    kind: "record",
    fields: [...first.fields].reverse(),
  };
  const ambiguousUnderDelimiters: TypeIR = {
    kind: "record",
    fields: [
      { name: "a", optional: false, type: textType },
      { name: "b,c", optional: true, type: numberType },
    ],
  };
  expect(typeIdentity(reordered)).toBe(typeIdentity(first));
  expect(typeIdentity(ambiguousUnderDelimiters)).not.toBe(typeIdentity(first));

  const operation = {
    name: "read",
    mode: "asynchronous" as const,
    input: first,
    output: textType,
  };
  expect(dependencyOperationIdentity({ ...operation, input: reordered })).toBe(
    dependencyOperationIdentity(operation),
  );
  expect(
    dependencyOperationIdentity({
      ...operation,
      heartbeat: { kind: "record", fields: [] },
    }),
  ).not.toBe(dependencyOperationIdentity(operation));
  expect(dependencyOperationIdentity(operation)).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(dependencyOperationIdentity(operation)).toBe(
    `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          "kit.dependency.operation",
          1,
          "asynchronous",
          [
            "record",
            [
              ["a,b", false, ["primitive", "string"]],
              ["c", true, ["primitive", "number"]],
            ],
          ],
          ["primitive", "string"],
          null,
          null,
        ]),
      )
      .digest("hex")}`,
  );

  const contract = {
    name: "records",
    operations: [operation],
  };
  expect(dependencyContractIdentity(contract)).toBe(
    dependencyContractIdentity({ ...contract, operations: [...contract.operations].reverse() }),
  );
  expect(
    dependencyContractIdentity({
      ...contract,
      operations: [...contract.operations, { ...operation, name: "inspect" }],
    }),
  ).not.toBe(dependencyContractIdentity(contract));
  expect(dependencyContractIdentity(contract)).toMatch(/^sha256:[0-9a-f]{64}$/);
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
    span: { file: `${feature}.ts`, line: 1, column: 1 },
  };
}
