import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, describe, expect, test } from "vitest";

import type { SourceCompilerExtension } from "@/compiler/extension";
import {
  projectDependencyContracts,
  selectSystemOutputs,
  serializeSystemIR,
  type SystemIR,
  type ExpressionIR,
  type ProgramContributionIR,
  type StatementIR,
  type TypeIR,
} from "@/compiler/ir";
import { collectProgramManifest, linkProgram } from "@/compiler/linker";
import { generateRustProgram } from "@/compiler/rust/lowering";
import {
  SystemDiagnostic,
  compileSystem as compileSystemSource,
  createSystemCompiler as createSystemCompilerSource,
} from "@/compiler/source";
import { executePortableFunctionIR } from "@/execution/interpreter";
import { conformExternalDependencies } from "@/execution/process";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import {
  buildRustProgram,
  createRustProgramSession,
  runRustProgram,
} from "@/platforms/server/adapter/rust/fixtures/conformance";
import {
  executeServerLinkedProgramIR as executeLinkedProgramIR,
  executeServerProgramFixtureIR as executeProgramFixtureIR,
  executeServerProgramIR as executeProgramIR,
} from "@/platforms/server/adapter/typescript/runtime";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import { webInterfaceCompilerIR, webProgramUI } from "@/platforms/web/adapter/lowering";

const temporaryDirectories: string[] = [];
const deviceCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "device",
  program: () => ({ ir: { version: 1 } }),
});
const compilerExtensions = Object.freeze([
  serverCompilerExtension,
  webCompilerExtension,
  deviceCompilerExtension,
]);

function compileSystem(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = compilerExtensions,
): SystemIR {
  return compileSystemSource(entry, extensions);
}

function createSystemCompiler(
  entry: string,
  extensions: readonly SourceCompilerExtension[] = compilerExtensions,
) {
  return createSystemCompilerSource(entry, extensions);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("System compiler", { tags: ["compiler"] }, () => {
  test("extracts stable System meaning and portable control flow without executing source", async () => {
    const entry = await fixture(systemSource());
    const first = compileSystem(entry);
    const second = compileSystem(entry);

    expect(serializeSystemIR(second)).toBe(serializeSystemIR(first));
    expect(first.system).toEqual({
      id: "system",
      name: "Portable fixture",
    });
    expect(first.features.map(({ id }) => id)).toEqual([
      "feature/child",
      "feature/worker",
      "feature/worker.child",
    ]);
    expect(first.programs.map(({ id }) => id)).toEqual(["program/cloud"]);
    expect(first.programs[0]?.contributions.map(({ id }) => id)).toEqual([
      "feature/child/program/cloud",
      "feature/worker/program/cloud",
      "feature/worker.child/program/cloud",
    ]);
    const program = first.programs[0];
    const contribution = programContribution(first, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    expect(program).toMatchObject({
      environment: { name: "server", platform: "server" },
    });
    expect(contribution).toMatchObject({
      requires: [{ name: "numbers" }, { name: "output" }],
    });
    expect(implementation).toMatchObject({
      kind: "portable",
      entry: { asynchronous: true },
    });
    expect(
      implementation?.kind === "portable" ? implementation.entry.body.map(({ kind }) => kind) : [],
    ).toEqual(["let", "let", "for-of", "if"]);
    if (implementation?.kind !== "portable") throw new Error("Expected portable IR.");
    const expressions = collectExpressions(implementation.entry.body);
    expect(expressions.length).toBeGreaterThan(10);
    expect(
      expressions.every(({ span, type }) => span.file === "system.ts" && Boolean(type.kind)),
    ).toBe(true);
  });

  test("semantic IDs do not depend on declaration order", async () => {
    const entry = await fixture(systemSource());
    const original = compileSystem(entry);
    await writeFile(
      entry,
      systemSource().replace("child: Child; worker: Worker", "worker: Worker; child: Child"),
    );
    const reordered = compileSystem(entry);

    expect(reordered.features.map(({ id }) => id)).toEqual(original.features.map(({ id }) => id));
    expect(reordered.programs.map(({ id }) => id)).toEqual(original.programs.map(({ id }) => id));
  });

  test("comments and formatting do not change portable function identity or generated meaning", async () => {
    const source = headlessFactorySystemSource();
    const formatted = source
      .replace(
        "function countTasks<Values",
        "// Semantically irrelevant documentation.\n\nfunction countTasks<Values",
      )
      .replace(
        "const count = countTasks(tasks);",
        "const count =\n      countTasks(\n        tasks,\n      );",
      );
    const original = compileSystem(await fixture(source));
    const changed = compileSystem(await fixture(formatted));
    const originalProgram = original.programs.find(({ name }) => name === "server");
    const changedProgram = changed.programs.find(({ name }) => name === "server");
    if (!originalProgram || !changedProgram) throw new Error("Fixture has no server Program.");
    const identities = (ir: SystemIR) =>
      ir.programs.flatMap(({ contributions }) =>
        contributions.flatMap((contribution) => {
          const implementation = serverProgramExecution(contribution);
          return implementation.kind === "portable"
            ? [implementation.entry.id, ...implementation.functions.map(({ id }) => id)]
            : [];
        }),
      );
    const generatedMeaning = (program: typeof originalProgram) =>
      generateRustProgram(linkProgram(program), serverProgramExecution).replace(
        /^\/\/ TypeScript: .*$/gm,
        "// TypeScript source",
      );

    expect(identities(changed)).toEqual(identities(original));
    expect(generatedMeaning(changedProgram)).toBe(generatedMeaning(originalProgram));
  });

  test("lowers two Applications into one shared Program and independent interface outputs", async () => {
    const ir = compileSystem(await fixture(multiAppSystemSource()));

    expect(ir.apps).toEqual([
      {
        id: "app/customer",
        path: "customer",
        name: "Customer",
        interfaces: ["interface/customer.web"],
      },
      {
        id: "app/operations",
        path: "operations",
        name: "Operations",
        interfaces: ["interface/operations.web"],
      },
    ]);
    expect(ir.interfaces).toEqual([
      {
        id: "interface/customer.web",
        path: "customer.web",
        app: "customer",
        platform: "web",
        features: { service: "customerService" },
        programs: ["program/customer.web.browser"],
        extensions: { web: { version: 11 } },
      },
      {
        id: "interface/operations.web",
        path: "operations.web",
        app: "operations",
        platform: "web",
        features: { service: "operationsService" },
        programs: ["program/operations.web.browser"],
        extensions: { web: { version: 11 } },
      },
    ]);
    expect(ir.programs.map(({ id }) => id)).toEqual([
      "program/api",
      "program/customer.web.browser",
      "program/operations.web.browser",
    ]);
    expect(
      ir.programs
        .find(({ id }) => id === "program/api")
        ?.contributions.map(({ feature }) => feature),
    ).toEqual(["customerService", "operationsService", "shared"]);
    expect(ir.features.find(({ path }) => path === "operationsService")).toMatchObject({
      programs: ["program/api", "program/operations.web.browser"],
    });

    const focused = selectSystemOutputs(ir, "operations");
    expect(focused.interfaces.map(({ id }) => id)).toEqual(["interface/operations.web"]);
    expect(focused.programs.map(({ id }) => id)).toEqual([
      "program/api",
      "program/operations.web.browser",
    ]);
    expect(
      focused.programs
        .find(({ id }) => id === "program/api")
        ?.contributions.map(({ feature }) => feature),
    ).toEqual(["operationsService", "shared"]);
    expect(focused.platforms).toEqual(["server", "web"]);
    expect(() => selectSystemOutputs(ir, "missing")).toThrow('Unknown Application "missing".');
  });

  test("retains one exact Feature instance shared by several Applications", async () => {
    const ir = compileSystem(await fixture(sharedApplicationFeatureSystemSource()));
    const program = ir.programs.find(({ id }) => id === "program/api");

    expect(program?.contributions).toEqual([
      expect.objectContaining({
        feature: "shared",
        apps: ["customer", "operations"],
      }),
    ]);
    expect(
      selectSystemOutputs(ir, "operations").programs.find(({ id }) => id === "program/api")
        ?.contributions,
    ).toEqual(program?.contributions);
  });

  test("retains shared Feature identity across Application factory calls", async () => {
    const ir = compileSystem(await fixture(sharedFactoryApplicationFeatureSystemSource()));
    const program = ir.programs.find(({ id }) => id === "program/api");

    expect(program?.contributions).toEqual([
      expect.objectContaining({
        feature: "shared",
        apps: ["customer", "operations"],
      }),
    ]);
  });

  test("keeps Feature and Application names in distinct namespaces", async () => {
    const source = sharedApplicationFeatureSystemSource().replace(
      "applications: { customer, operations },",
      "applications: { shared: customer, operations },",
    );
    const ir = compileSystem(await fixture(source));

    expect(ir.apps.map(({ path }) => path)).toEqual(["operations", "shared"]);
    expect(ir.features.map(({ path }) => path)).toEqual(["shared"]);
    expect(ir.programs[0]?.contributions).toEqual([
      expect.objectContaining({
        feature: "shared",
        apps: ["operations", "shared"],
      }),
    ]);
  });

  test("emits byte-identical System IR for Feature and Application placement permutations", async () => {
    const top = ["shared", "operationsService", "customerService"] as const;
    const app = ["service", "web"] as const;
    const expected = serializeSystemIR(
      compileSystem(await fixture(multiAppSystemSource(top, app, app))),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([...top], { minLength: top.length, maxLength: top.length }),
        fc.shuffledSubarray([...app], { minLength: app.length, maxLength: app.length }),
        fc.shuffledSubarray([...app], { minLength: app.length, maxLength: app.length }),
        async (topOrder, operationsOrder, customerOrder) => {
          const actual = compileSystem(
            await fixture(multiAppSystemSource(topOrder, operationsOrder, customerOrder)),
          );
          expect(serializeSystemIR(actual)).toBe(expected);
        },
      ),
      { numRuns: 12 },
    );
  }, 15_000);

  test("assembles nested same-named contributions and isolates distinct Programs", async () => {
    const ir = compileSystem(await fixture(multiProgramSystemSource()));

    expect(ir.programs.map(({ name, environment }) => [name, environment.name])).toEqual([
      ["api", "server"],
      ["browser", "browser-main"],
      ["browser-worker", "browser-worker"],
      ["worker", "server"],
    ]);
    expect(
      ir.programs.find(({ name }) => name === "api")?.contributions.map(({ id }) => id),
    ).toEqual(["feature/orders/program/api", "feature/orders.shared/program/api"]);
    expect(
      ir.programs.find(({ name }) => name === "browser-worker")?.contributions.map(({ id }) => id),
    ).toEqual([
      "feature/jobs/program/browser-worker",
      "feature/orders.shared/program/browser-worker",
    ]);
  });

  test("rejects one Program name assigned to different execution contexts", async () => {
    const entry = await fixture(
      systemSource().replace(
        'type Child = { Programs: { cloud: Program<{ Name: "server"; Platform: { Name: "server" } }> } };',
        'type Child = { Programs: { cloud: Program<{ Name: "device"; Platform: { Name: "device" } }> } };',
      ),
    );

    let failure: unknown;
    try {
      compileSystem(entry);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemDiagnostic);
    expect(String(failure)).toMatch(
      /system\.ts:\d+:\d+: Program "cloud" has different execution contexts "device" and "server"/,
    );
  });

  test("reports invalid interface metadata at its authored Application", async () => {
    const entry = await fixture(
      componentSystemSource().replace(
        'type Web = { Interface: { Platform: { Name: "web" } } };',
        "type Web = { Interface: {} };",
      ),
    );

    let failure: unknown;
    try {
      compileSystem(entry);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemDiagnostic);
    expect(String(failure)).toMatch(/system\.ts:\d+:\d+: Interface "product\.web" has no Platform/);
  });

  test("extracts deterministic Component state, actions, Elements, and lifecycle", async () => {
    const ir = compileSystem(await fixture(componentSystemSource()));
    const contribution = ir.programs[0]?.contributions[0];
    const component = contribution ? webProgramUI(contribution)?.components[0] : undefined;

    expect(ir.programs[0]?.environment).toEqual({
      name: "browser-main",
      platform: "web",
    });

    expect(component).toEqual({
      name: "Drawer",
      propCallbacks: ["onDismiss"],
      state: record({
        dragOffset: numberType(),
        phase: {
          kind: "union",
          variants: [
            { kind: "literal", value: "closed" },
            { kind: "literal", value: "open" },
          ],
        },
      }),
      actions: ["close", "open"],
      elements: [
        { name: "Root", element: "main" },
        { name: "Surface", element: "section" },
      ],
      implementation: { state: true, actions: true, mount: true, view: true },
    });
  });

  test("carries a non-web Platform compiler extension without knowing its vocabulary", async () => {
    const extension: SourceCompilerExtension = {
      name: "canvas",
      system({ implementation, source }) {
        return source.member(implementation, "metadata") ? { renderer: "gpu" } : undefined;
      },
      interface() {
        return { ir: { version: 1, surface: "canvas" } };
      },
      program({ contract, location, source }) {
        return {
          ir: {
            version: 1,
            scene: source
              .properties(source.property(contract, "Components", location))
              .map((component) => component.getName()),
          },
        };
      },
    };
    const entry = await fixture(
      componentSystemSource().replaceAll('Name: "web"', 'Name: "canvas"'),
    );

    expect(() => compileSystemSource(entry)).toThrow(
      'Platform "canvas" has no registered compiler dialect.',
    );
    const extended = compileSystem(entry, [extension]);

    expect(extended.system.extensions).toEqual({ canvas: { renderer: "gpu" } });
    expect(extended.programs[0]?.contributions[0]?.extensions).toEqual({
      canvas: { version: 1, scene: ["Drawer"] },
    });
  });

  test("lets a Platform extension own transitive Presentation sources", async () => {
    const entry = await fixture(
      `import { clean } from "./presentation";\n${componentSystemSource().replace(
        "presentation,",
        "presentation: clean,",
      )}`,
    );
    const presentation = resolve(entry, "../presentation.ts");
    await writeFile(presentation, 'export const clean = () => ({ tone: "first" });\n');
    const compiler = createSystemCompiler(entry);

    const first = compiler.compile();
    await writeFile(presentation, 'export const clean = () => ({ tone: "second" });\n');
    const second = compiler.compile(presentation);

    expect(second.work.features).toEqual({
      compiled: 0,
      reused: first.semanticGraph.features.length,
    });
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(first.ir));
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(compileSystem(entry)));
  });

  test("recompiles Platform meaning when a UI body can affect SSR", async () => {
    const source = `import { clean } from "./presentation";\n${componentSystemSource().replace(
      "presentation,",
      "presentation: clean,",
    )}`;
    const entry = await fixture(source);
    await writeFile(resolve(entry, "../presentation.ts"), "export const clean = {};\n");
    const compiler = createSystemCompiler(entry);

    const first = compiler.compile();
    await writeFile(
      entry,
      source.replace("view() { return null; }", "view() { void 1; return null; }"),
    );
    const second = compiler.compile(entry);

    expect(second.work.features).toEqual({
      compiled: 1,
      reused: 0,
    });
    expect(serializeSystemIR(second.ir)).not.toBe(serializeSystemIR(first.ir));
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(compileSystem(entry)));
  });

  test("does not classify a co-located behavior edit as Presentation-only", async () => {
    const source = componentSystemSource();
    const entry = await fixture(source);
    const compiler = createSystemCompiler(entry);

    compiler.compile();
    await writeFile(
      entry,
      source.replace("view() { return null; }", 'view() { return "updated"; }'),
    );
    const second = compiler.compile(entry);

    expect(second.work.features.compiled).toBeGreaterThan(0);
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(compileSystem(entry)));
  });

  test("reuses the semantic graph while reading an edited source file", async () => {
    const source = callbackFactorySystemSource();
    const entry = await fixture(source);
    const compiler = createSystemCompiler(entry);
    const first = compiler.compile();

    await writeFile(
      entry,
      source.replace("defineServerFeature<Tasks>(0)", "defineServerFeature<Tasks>(1)"),
    );
    const second = compiler.compile(entry);

    expect(serializeSystemIR(second.ir)).not.toBe(serializeSystemIR(first.ir));
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(compileSystem(entry)));
  });

  test("assigns compiled Presentation meaning to its exact interface output", async () => {
    const entry = await fixture(
      `import { clean } from "./presentation";\n${componentSystemSource().replace(
        "presentation,",
        "presentation: clean,",
      )}`,
    );
    await writeFile(
      resolve(entry, "../presentation.ts"),
      `
declare function animate(value: number, animation: unknown): number;
export const clean = ({ parameters }: { parameters: { sheet: unknown } }) => ({
  Drawer({ state }: { state: { open: boolean } }) {
    const openness = animate(state.open ? 1 : 0, parameters.sheet);
    return { Root: { opacity: openness } };
  },
});
`,
    );

    const ir = compileSystem(entry);

    expect(webInterfaceCompilerIR(ir.interfaces[0]?.extensions?.web).presentations).toEqual([
      expect.objectContaining({
        file: "presentation.ts",
        animations: [expect.objectContaining({ binding: "openness" })],
      }),
    ]);
  });

  test("rejects undeclared runtime calls at their source location", async () => {
    const source = systemSource().replace(
      "const values = await dependencies.numbers.read({ count: 4 });",
      "const values = [Date.now()];",
    );
    const entry = await fixture(source);
    const offset = source.indexOf("Date.now()");
    const before = source.slice(0, offset);
    const expected = {
      file: entry,
      line: before.split("\n").length,
      column: offset - before.lastIndexOf("\n"),
    };

    let failure: unknown;
    try {
      compileSystem(entry);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemDiagnostic);
    expect((failure as SystemDiagnostic).span).toEqual(expected);
    expect(String(failure)).toMatch(/Portable helper calls must resolve/);
  });

  test("classifies unsupported syntax for target-specific adapter validation", async () => {
    const entry = await fixture(
      systemSource().replace(
        "const values = await dependencies.numbers.read({ count: 4 });",
        "const values = await dependencies.numbers.read({ count: 4 });\n" +
          "        switch (values.length) { default: break; }",
      ),
    );

    expect(() => compileSystem(entry)).toThrow(
      /must lower completely to portable meaning.*Unsupported portable statement SwitchStatement/,
    );
  });

  test("distinguishes synchronous and asynchronous Dependency operations", async () => {
    const source = systemSource()
      .replace(
        "read(input: { count: number }): Promise<readonly number[]>;",
        "read(input: { count: number }): Promise<readonly number[]>;\n  offset(input: {}): number;",
      )
      .replace("let total = 0;", "let total = dependencies.numbers.offset({});");
    const ir = compileSystem(await fixture(source));
    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3], offset: () => 4 },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "large", value: 10 }]);

    const unawaited = await fixture(
      systemSource().replace(
        "const values = await dependencies.numbers.read({ count: 4 });",
        "dependencies.numbers.read({ count: 4 });\n        const values: readonly number[] = [];",
      ),
    );
    expect(() => compileSystem(unawaited)).toThrow(/must be awaited/);
  });

  test("extracts a semantic Dependency's consumer and provider contract", async () => {
    const source = systemSource().replace(
      `type Numbers = Dependency<{
  Operations: {
    read(input: { count: number }): Promise<readonly number[]>;
  };
}>;`,
      `type Numbers = Dependency<{
  Operations: {
    read(input: { count: number }): Promise<readonly number[]>;
  };
  Failures: {
    unavailable: { retryAt: number };
  };
  Heartbeats: {
    read: { received: number };
  };
}>;`,
    );
    const ir = compileSystem(await fixture(source));
    const numbers = programContribution(ir, "feature/worker/program/cloud")?.requires.find(
      ({ name }) => name === "numbers",
    );

    expect(numbers).toEqual({
      name: "numbers",
      failures: {
        kind: "record",
        fields: [
          {
            name: "unavailable",
            optional: false,
            type: {
              kind: "record",
              fields: [
                {
                  name: "retryAt",
                  optional: false,
                  type: numberType(),
                },
              ],
            },
          },
        ],
      },
      heartbeats: [
        {
          operation: "read",
          type: {
            kind: "record",
            fields: [
              {
                name: "received",
                optional: false,
                type: numberType(),
              },
            ],
          },
        },
      ],
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
                  type: {
                    kind: "record",
                    fields: [
                      {
                        name: "count",
                        optional: false,
                        type: numberType(),
                      },
                    ],
                  },
                },
              ],
              result: {
                kind: "promise",
                value: { kind: "array", element: numberType() },
              },
            },
          },
        ],
      },
    });
    const program = ir.programs.find(({ contributions }) =>
      contributions.some(({ id }) => id === "feature/worker/program/cloud"),
    );
    if (!program) throw new Error("Expected cloud Program.");
    expect(collectProgramManifest(program).bindings).toEqual([
      {
        name: "numbers",
        operations: [
          expect.objectContaining({
            name: "read",
            mode: "asynchronous",
            failures: numbers?.failures,
            heartbeat: numbers?.heartbeats?.[0]?.type,
          }),
        ],
      },
      {
        name: "output",
        operations: [
          expect.objectContaining({
            name: "write",
            mode: "asynchronous",
          }),
        ],
      },
    ]);

    const invocations: unknown[] = [];
    const writes: unknown[] = [];
    const dependencies = {
      numbers: {
        async read(context: {
          input: { count: number };
          invocation: Readonly<{ id: string; attempt: number }>;
        }) {
          invocations.push(context);
          return [context.input.count];
        },
      },
      output: {
        async write({ input }: { input: unknown }) {
          writes.push(input);
        },
      },
    };
    await executeProgramIR(ir, "feature/worker/program/cloud", dependencies);
    await executeProgramIR(ir, "feature/worker/program/cloud", dependencies);
    expect(invocations).toEqual([
      expect.objectContaining({
        input: { count: 4 },
        invocation: expect.objectContaining({
          id: expect.stringMatching(/^direct:[0-9a-f-]+:numbers:read:1$/),
          attempt: 1,
        }),
      }),
      expect.objectContaining({
        input: { count: 4 },
        invocation: expect.objectContaining({
          id: expect.stringMatching(/^direct:[0-9a-f-]+:numbers:read:1$/),
          attempt: 1,
        }),
      }),
    ]);
    expect(
      new Set(
        invocations.map(
          (value) => (value as { invocation: Readonly<{ id: string }> }).invocation.id,
        ),
      ).size,
    ).toBe(2);
    expect(writes).toEqual([
      { category: "small", value: 4 },
      { category: "small", value: 4 },
    ]);
  });

  test("lowers authored dependency callbacks as portable closures", async () => {
    const entry = await fixture(
      systemSource()
        .replace(
          "read(input: { count: number }): Promise<readonly number[]>;",
          "read(input: { count: number }): Promise<readonly number[]>;\n  subscribe(input: { receive(value: number): void }): Disposable;",
        )
        .replace(
          "const values = await dependencies.numbers.read({ count: 4 });",
          "dependencies.numbers.subscribe({ receive: () => undefined });\n        const values = await dependencies.numbers.read({ count: 4 });",
        ),
    );
    const implementation = serverExecution(
      programContribution(compileSystem(entry), "feature/worker/program/cloud"),
    );
    expect(implementation?.kind).toBe("portable");
    if (implementation?.kind !== "portable") throw new Error("Expected portable IR.");
    expect(
      collectExpressions(implementation.entry.body).some(({ kind }) => kind === "closure"),
    ).toBe(true);
  });

  test("preserves one static function binding across expanded portable use sites", async () => {
    const entry = await fixture(
      systemSource()
        .replace(
          "const child = createFeature<Child>",
          "const stableIncrement = (value: number): number => value + 1;\nconst child = createFeature<Child>",
        )
        .replace(
          "const values = await dependencies.numbers.read({ count: 4 });",
          `const values = await dependencies.numbers.read({ count: 4 });
        const selected = stableIncrement;
        const handlers = { increment: stableIncrement };
        if (handlers.increment !== selected) throw new Error("Static function identity changed.");
        if (selected(1) !== 2) throw new Error("Static function invocation changed.");`,
        ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable static-function fixture.");
    }
    const stable = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ].filter(
      (expression): expression is Extract<ExpressionIR, Readonly<{ kind: "closure" }>> =>
        expression.kind === "closure" && expression.stable === true,
    );
    expect(stable.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stable.map(({ function: function_ }) => function_)).size).toBe(1);

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "small", value: 6 }]);
  });

  test("rejects plain operation records in place of semantic Dependencies", async () => {
    const source = systemSource().replace(
      `type Numbers = Dependency<{
  Operations: {
    read(input: { count: number }): Promise<readonly number[]>;
  };
}>;`,
      `type Numbers = {
  read(input: { count: number }): Promise<readonly number[]>;
};`,
    );
    const entry = await fixture(source);

    expect(() => compileSystem(entry)).toThrow(
      'Dependency "numbers" must use the semantic Dependency type.',
    );
  });

  test("preserves a recursive static function reference without expanding it recursively", async () => {
    const entry = await fixture(
      systemSource()
        .replace(
          "const child = createFeature<Child>",
          `const countDown = (value: number): number => {
  const next = countDown;
  return value <= 0 ? 0 : next(value - 1);
};
const child = createFeature<Child>`,
        )
        .replace(
          "const values = await dependencies.numbers.read({ count: 4 });",
          `const values = await dependencies.numbers.read({ count: 4 });
        if (countDown(3) !== 0) throw new Error("Recursive function identity changed.");`,
        ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable recursive-function fixture.");
    }
    const recursiveReferences = implementation.functions
      .flatMap(({ body }) => collectExpressions(body))
      .filter(
        (expression): expression is Extract<ExpressionIR, Readonly<{ kind: "closure" }>> =>
          expression.kind === "closure" && expression.stable === true,
      );
    expect(recursiveReferences.length).toBeGreaterThanOrEqual(2);
    expect(new Set(recursiveReferences.map(({ function: function_ }) => function_)).size).toBe(1);

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "small", value: 6 }]);
  });

  test("rejects any in portable Dependency contracts", async () => {
    const entry = await fixture(
      systemSource().replace("read(input: { count: number })", "read(input: any)"),
    );

    expect(() => compileSystem(entry)).toThrow(/cannot contain any/);
  });

  test("lowers real-time Dependency streams without exposing iterator machinery", async () => {
    const entry = await fixture(
      systemSource().replace(
        "read(input: { count: number }): Promise<readonly number[]>;",
        "read(input: { count: number }): Promise<readonly number[]>;\n  changes(): AsyncIterable<{ revision: number }>;",
      ),
    );
    const ir = compileSystem(entry);
    const program = programContribution(ir, "feature/worker/program/cloud");
    const numbers = program?.requires.find(({ name }) => name === "numbers");

    expect(numbers?.type).toMatchObject({
      kind: "record",
      fields: expect.arrayContaining([
        {
          name: "changes",
          optional: false,
          type: {
            kind: "function",
            parameters: [],
            result: {
              kind: "stream",
              element: {
                kind: "record",
                fields: [{ name: "revision", optional: false, type: numberType() }],
              },
            },
          },
        },
      ]),
    });
  });

  test("lowers and executes for-await-of over Dependency streams", async () => {
    const entry = await fixture(streamSystemSource());
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(implementation.entry.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "for-of", asynchronous: true, item: "change" }),
      ]),
    );

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      changes: {
        async *subscribe() {
          yield { revision: 2 };
          yield { revision: 3 };
        },
      },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ revision: 2 }]);
  });

  test("rejects for-await-of over a non-stream value", async () => {
    const entry = await fixture(
      streamSystemSource()
        .replace(
          "for await (const change of dependencies.changes.subscribe({}))",
          "for await (const change of [1, 2, 3])",
        )
        .replace("revision: change.revision", "revision: change"),
    );

    expect(() => compileSystem(entry)).toThrow(
      "Portable for-await-of requires an asynchronous stream.",
    );
  });

  test("lowers and executes portable while loops", async () => {
    const entry = await fixture(
      systemSource().replace(
        `for (const value of values) {
          total += value;
        }`,
        `while (total < 10) {
          total += 1;
        }`,
      ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(implementation.entry.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "while" })]),
    );

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "large", value: 10 }]);
  });

  test("composes portable asynchronous operations with standard Promise semantics", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }`,
        `const groups: readonly (readonly number[])[] = await Promise.all([
          dependencies.numbers.read({ count: 1 }),
          dependencies.numbers.read({ count: 2 }),
        ]);
        let total = 0;
        for (const group of groups) {
          for (const groupValue of group) total += groupValue;
        }
        const first = await Promise.race([
          dependencies.numbers.read({ count: 3 }),
          dependencies.numbers.read({ count: 4 }),
        ]);
        for (const raceValue of first) total += raceValue;
        const settled = await Promise.allSettled([
          dependencies.numbers.read({ count: 5 }),
          dependencies.numbers.read({ count: 6 }),
        ]);
        for (const settledResult of settled) {
          if (settledResult.status === "fulfilled") {
            for (const settledValue of settledResult.value) total += settledValue;
          }
        }`,
      ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(
      collectExpressions(implementation.entry.body)
        .filter((expression) => expression.kind === "concurrent")
        .map(({ operation }) => operation),
    ).toEqual(["all", "race", "all-settled"]);

    let resolveSlow!: (value: readonly number[]) => void;
    const slow = new Promise<readonly number[]>((resolvePromise) => {
      resolveSlow = resolvePromise;
    });
    const calls: number[] = [];
    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: {
        async read({ input: { count } }: { input: { count: number } }) {
          calls.push(count);
          if (count === 3) return slow;
          if (count === 6) throw new Error("expected rejection");
          return [count];
        },
      },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    resolveSlow([3]);

    expect(calls).toEqual([1, 2, 3, 4, 5, 6]);
    expect(writes).toEqual([{ category: "large", value: 12 }]);
  });

  test("composes direct portable methods", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }`,
        `const reader = {
          async read() {
            return [2, 3];
          },
        };
        const groups = await Promise.all([reader.read()]);
        let total = 0;
        for (const group of groups) {
          for (const value of group) total += value;
        }`,
      ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(
      collectExpressions(implementation.entry.body).some(
        (expression) => expression.kind === "concurrent",
      ),
    ).toBe(true);

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "small", value: 5 }]);
  });

  test("rejects ambiguous or detached portable Promise composition", async () => {
    const source = systemSource().replace(
      "const values = await dependencies.numbers.read({ count: 4 });",
      `Promise.all([dependencies.numbers.read({ count: 1 })]);
        const values = await dependencies.numbers.read({ count: 4 });`,
    );
    const sourceEntry = await fixture(source);
    expect(() => compileSystem(sourceEntry)).toThrow("Portable Promise.all must be awaited.");

    const emptyRace = systemSource().replace(
      "const values = await dependencies.numbers.read({ count: 4 });",
      "const values: readonly number[] = await Promise.race([]);",
    );
    const raceEntry = await fixture(emptyRace);
    expect(() => compileSystem(raceEntry)).toThrow(
      "Portable Promise.race requires at least one operation.",
    );
  });

  test("preserves host Dependency values as explicit opaque boundaries", async () => {
    const entry = await fixture(
      systemSource().replace(
        "read(input: { count: number }): Promise<readonly number[]>;",
        "read(input: { count: number }): Promise<readonly number[]>;\n  exchange(request: Request): Promise<Response>;",
      ),
    );
    const numbers = programContribution(
      compileSystem(entry),
      "feature/worker/program/cloud",
    )?.requires.find(({ name }) => name === "numbers");

    expect(numbers?.type.kind).toBe("record");
    if (numbers?.type.kind !== "record") return;
    expect(numbers.type.fields.find(({ name }) => name === "exchange")).toEqual({
      name: "exchange",
      optional: false,
      type: {
        kind: "function",
        parameters: [
          {
            name: "request",
            optional: false,
            type: { kind: "opaque", name: "Request" },
          },
        ],
        result: {
          kind: "promise",
          value: { kind: "opaque", name: "Response" },
        },
      },
    });
  });

  test("expands standard mapped types into their portable semantic shape", async () => {
    const entry = await fixture(
      systemSource()
        .replace("Operations: {\n    read", "Operations: Readonly<{\n    read")
        .replace(
          "Promise<readonly number[]>;\n  };\n}>;\ntype Output",
          "Promise<ReadonlyArray<number>>;\n  }>;\n}>;\ntype Output",
        )
        .replace("input: { count: number }", "input: Readonly<{ count: number }>"),
    );
    const numbers = programContribution(
      compileSystem(entry),
      "feature/worker/program/cloud",
    )?.requires.find(({ name }) => name === "numbers");

    expect(numbers?.type).toEqual({
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
                type: {
                  kind: "record",
                  fields: [
                    {
                      name: "count",
                      optional: false,
                      type: numberType(),
                    },
                  ],
                },
              },
            ],
            result: {
              kind: "promise",
              value: { kind: "array", element: numberType() },
            },
          },
        },
      ],
    });
  });

  test("lowers tuples, optional fields, explicit options, null, and literals without ambiguity", async () => {
    const entry = await fixture(
      systemSource().replace(
        "read(input: { count: number }): Promise<readonly number[]>;",
        `read(input: { count: number }): Promise<readonly number[]>;
  shape(input: {
    optional?: number;
    maybe: string | undefined;
    tuple: readonly [string, number];
    enabled: true;
    empty: null;
  }): Promise<void>;`,
      ),
    );
    const numbers = programContribution(
      compileSystem(entry),
      "feature/worker/program/cloud",
    )?.requires.find(({ name }) => name === "numbers");
    if (numbers?.type.kind !== "record") throw new Error("Expected Numbers record.");
    const shape = numbers.type.fields.find(({ name }) => name === "shape");
    if (shape?.type.kind !== "function") throw new Error("Expected shape function.");
    const input = shape.type.parameters[0]?.type;
    if (input?.kind !== "record") throw new Error("Expected shape input.");

    expect(input.fields).toEqual([
      { name: "empty", optional: false, type: { kind: "primitive", name: "null" } },
      { name: "enabled", optional: false, type: { kind: "literal", value: true } },
      {
        name: "maybe",
        optional: false,
        type: { kind: "option", value: { kind: "primitive", name: "string" } },
      },
      { name: "optional", optional: true, type: { kind: "primitive", name: "number" } },
      {
        name: "tuple",
        optional: false,
        type: {
          kind: "tuple",
          elements: [
            { kind: "primitive", name: "string" },
            { kind: "primitive", name: "number" },
          ],
        },
      },
    ]);
  });

  test("expands a headless Feature factory and lowers its supplied implementation", async () => {
    const ir = compileSystem(await fixture(headlessFactorySystemSource()));

    expect(ir.features).toEqual([
      {
        id: "feature/tasks",
        path: "tasks",
        children: [],
        programs: ["program/server"],
      },
    ]);
    expect(ir.programs[0]).toMatchObject({
      id: "program/server",
      environment: { name: "server", platform: "server" },
    });
    expect(ir.programs[0]?.contributions[0]).toMatchObject({
      id: "feature/tasks/program/server",
      requires: [{ name: "repository" }],
      provides: [],
    });
    expect(serverExecution(ir.programs[0]?.contributions[0])).toMatchObject({
      kind: "portable",
      entry: { asynchronous: true },
    });
  });

  test("lowers imported immutable data inside a portable Program", async () => {
    const directory = await temporaryDirectory("kit-imported-data-");
    const entry = resolve(directory, "system.ts");
    await Promise.all([
      writeFile(resolve(directory, "descriptor.ts"), 'export const descriptor = "stable";\n'),
      writeFile(
        entry,
        `
import { descriptor } from "./descriptor";

type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Fixture = {
  Programs: {
    server: Program<{ Name: "server"; Platform: { Name: "server" } }>;
  };
};

const fixture = createFeature<Fixture>({
  programs: {
    server: {
      start() {
        const retained = descriptor;
        if (retained !== "stable") throw new Error("Imported data changed.");
      },
    },
  },
});

export default createSystem({ features: { fixture } });
`,
      ),
    ]);

    const ir = compileSystem(entry);
    const implementation = serverExecution(
      programContribution(ir, "feature/fixture/program/server"),
    );
    if (implementation?.kind !== "portable") throw new Error("Expected portable IR.");
    expect(
      collectExpressions(implementation.entry.body).some(
        (expression) => expression.kind === "literal" && expression.value === "stable",
      ),
    ).toBe(true);
  });

  test("expands nested Feature factories without compiler-specific wrappers", async () => {
    const ir = compileSystem(await fixture(nestedFactorySystemSource()));
    const contribution = programContribution(ir, "feature/parent.child/program/api");

    expect(serverExecution(contribution)).toMatchObject({
      kind: "portable",
      entry: { asynchronous: true },
    });
  });

  test("expands a differently shaped closure factory without a compiler special case", async () => {
    const source = callbackFactorySystemSource();
    const entry = await fixture(source);
    const ir = compileSystem(entry);

    expect(serverExecution(programContribution(ir, "feature/tasks/program/server"))).toMatchObject({
      kind: "portable",
      entry: { asynchronous: true },
    });
    await writeFile(
      entry,
      source.replace("defineServerFeature<Tasks>(0)", "defineServerFeature<Tasks>(1)"),
    );
    const changed = compileSystem(entry);
    expect(serializeSystemIR(changed)).not.toBe(serializeSystemIR(ir));
    expect(
      serverExecution(programContribution(changed, "feature/tasks/program/server"))?.kind,
    ).toBe("portable");
  });

  test("uses a contextually typed callback's own Dependency binding", async () => {
    const ir = compileSystem(await fixture(contextualCallbackFactorySystemSource()));
    const contribution = programContribution(ir, "feature/worker/program/server");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable contextual callback fixture.");
    }
    const expressions = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ];
    expect(
      expressions
        .filter((expression) => expression.kind === "dependency-call")
        .map(({ dependency, operation }) => `${dependency}.${operation}`),
    ).toEqual(["output.write"]);

    const writes: unknown[] = [];
    const invocations: string[] = [];
    await executeProgramIR(ir, "feature/worker/program/server", {
      output: {
        async write({
          input,
          invocation,
        }: Readonly<{ input: unknown; invocation: Readonly<{ id: string }> }>) {
          writes.push(input);
          invocations.push(invocation.id);
        },
      },
    });
    expect(writes).toEqual([{ value: "ready" }]);
    expect(invocations).toEqual(["idempotency:emit-ready"]);
  });

  test("lowers a type-derived local Dependency reference to serializable operations", async () => {
    const ir = compileSystem(await projectFixture(dependencyReferenceSystemSource()));
    const contribution = programContribution(ir, "feature/worker/program/server");
    if (!contribution) throw new Error("Expected portable Dependency reference contribution.");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable Dependency reference fixture.");
    }
    const expressions = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ];

    expect(
      expressions
        .filter((expression) => expression.kind === "dependency-reference")
        .map(({ dependency }) => dependency),
    ).toEqual(["counter"]);
    expect(
      expressions
        .filter((expression) => expression.kind === "dependency-reference-call")
        .map(({ operation }) => operation),
    ).toEqual(["add", "read"]);

    const requests: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/server", {
      counter: {
        async add({ input }: { input: unknown }) {
          requests.push(input);
          return 2;
        },
        async read({ input }: { input: unknown }) {
          requests.push(input);
          return 2;
        },
      },
    });
    expect(requests).toEqual([
      { idempotencyKey: "add-1", key: "counter-1", input: { value: 2 } },
      { key: "counter-1" },
    ]);

    const helper = implementation.functions.find(({ body }) =>
      collectExpressions(body).some(
        (expression) => expression.kind === "dependency-reference-call",
      ),
    );
    if (!helper) throw new Error("Expected a portable Dependency reference helper.");
    const mounted = conformExternalDependencies(projectDependencyContracts(contribution.requires), {
      counter: {
        async add({ input }: { input: unknown }) {
          requests.push(input);
          return 2;
        },
        async read({ input }: { input: unknown }) {
          requests.push(input);
          return 2;
        },
      },
    });
    const liveReference = (
      mounted.counter as Readonly<{
        get(input: { key: string }): object;
      }>
    ).get({ key: "counter-2" });
    await executePortableFunctionIR({
      entry: helper,
      functions: implementation.functions.filter(({ id }) => id !== helper.id),
      arguments: [liveReference],
      dependencies: mounted as Parameters<typeof executePortableFunctionIR>[0]["dependencies"],
    });
    expect(requests.slice(-2)).toEqual([
      { idempotencyKey: "add-1", key: "counter-2", input: { value: 2 } },
      { key: "counter-2" },
    ]);
  });

  test("respects lexical shadowing of the Program Dependency binding in closures", async () => {
    const ir = compileSystem(await fixture(shadowedDependencySystemSource()));
    const contribution = programContribution(ir, "feature/worker/program/server");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable shadowing fixture.");
    }
    const expressions = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ];
    expect(
      expressions
        .filter((expression) => expression.kind === "dependency-call")
        .map(({ dependency, operation }) => `${dependency}.${operation}`),
    ).toEqual(["output.write"]);
    expect(
      expressions
        .filter((expression) => expression.kind === "method-call")
        .map(({ method }) => method),
    ).toContain("write");

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/server", {
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ value: "local" }]);
  });

  test("materializes generic literal meaning without a Feature-specific compiler path", async () => {
    const ir = compileSystem(await projectFixture(typeLiteralFactorySystemSource()));
    const contribution = programContribution(ir, "feature/catalog/program/server");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable named-provider factory.");
    }
    const literals = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ].filter((expression) => expression.kind === "literal");

    expect(contribution?.provides.map(({ name }) => name)).toEqual(["catalog"]);
    expect(literals).toContainEqual(
      expect.objectContaining({
        kind: "literal",
        value: "catalog",
        type: { kind: "literal", value: "catalog" },
      }),
    );
  });

  test("materializes resolved structural types without a Feature-specific compiler path", async () => {
    const ir = compileSystem(await projectFixture(typeSchemaFactorySystemSource()));
    const contribution = programContribution(ir, "feature/catalog/program/server");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable schema-provider factory.");
    }
    const records = [
      ...collectExpressions(implementation.entry.body),
      ...implementation.functions.flatMap(({ body }) => collectExpressions(body)),
    ].filter((expression) => expression.kind === "record");
    const schema = records
      .map(expressionData)
      .find(
        (value): value is Record<string, unknown> =>
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          "kind" in value &&
          "fields" in value &&
          value.kind === "record" &&
          Array.isArray(value.fields),
      );

    expect(schema).toEqual({
      fields: [
        {
          name: "count",
          optional: true,
          type: { kind: "primitive", name: "number" },
        },
        {
          name: "tags",
          optional: false,
          type: { element: { kind: "primitive", name: "string" }, kind: "array" },
        },
        {
          name: "title",
          optional: false,
          type: { kind: "primitive", name: "string" },
        },
      ],
      kind: "record",
    });
  });

  test("composes generic Features through one shared host Dependency contract", async () => {
    const ir = compileSystem(await projectFixture(sharedHostDependencySystemSource()));
    const program = ir.programs[0];
    if (!program) throw new Error("Expected one server Program.");

    const linked = linkProgram(program);

    expect(linked.external.map(({ name }) => name)).toEqual(["events"]);
    expect(linked.dependencies).toEqual([
      expect.objectContaining({
        name: "events",
        consumers: ["orders", "users"],
      }),
    ]);
  });

  test("compiles one generic Dependency dispatcher for a generated provider API", async () => {
    const ir = compileSystem(await projectFixture(dependencyDispatcherSystemSource()));
    const program = ir.programs[0];
    if (!program) throw new Error("Expected one server Program.");
    const writes: unknown[] = [];

    await using _execution = await executeLinkedProgramIR(linkProgram(program), {
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });

    expect(writes).toEqual([{ doubled: 6, tripled: 9 }]);
  });

  test("rejects unresolved generic type materialization", async () => {
    const entry = await projectFixture(
      typeLiteralFactorySystemSource().replace(
        'type Catalog = { Name: "catalog" };',
        "type Catalog = { Name: string };",
      ),
    );

    expect(() => compileSystem(entry)).toThrow(
      /typeLiteral requires one resolved string, number, or boolean literal/,
    );
  });

  test("extracts state and actions from a Component-free UI Feature factory", async () => {
    const ir = compileSystem(await fixture(uiFactorySystemSource()));
    const program = ir.programs[0];
    const contribution = program?.contributions[0];

    expect(program).toMatchObject({
      id: "program/browser",
      environment: { name: "browser", platform: "web" },
    });
    expect(contribution).toMatchObject({
      id: "feature/data/program/browser",
    });
    expect(contribution && webProgramUI(contribution)).toMatchObject({
      actions: ["create", "synchronize"],
      state: { kind: "record" },
    });
  });

  test("executes the extracted process through injected Dependencies", async () => {
    const ir = compileSystem(await fixture(systemSource()));
    const writes: unknown[] = [];
    const execution = await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3, 4] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });

    expect(execution.calls).toEqual([
      { dependency: "numbers", operation: "read", input: { count: 4 } },
      {
        dependency: "output",
        operation: "write",
        input: { category: "large", value: 10 },
      },
    ]);
    expect(writes).toEqual([{ category: "large", value: 10 }]);
  });

  test("lowers and executes authored pure helpers through the portable call graph", async () => {
    const source = `import { sum } from "./math";\n${systemSource()}`.replace(
      `let total = 0;
        for (const value of values) {
          total += value;
        }`,
      "const total = sum(values);",
    );
    const entry = await fixture(source);
    await writeFile(
      resolve(entry, "../math.ts"),
      `export function sum<Values extends readonly number[]>(values: Values): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
`,
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");

    expect(serverExecution(contribution)).toMatchObject({
      kind: "portable",
      functions: [{ name: "sum" }],
    });
    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [2, 4, 6] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "large", value: 12 }]);
  });

  test("preserves Dependency failures from their implementation", async () => {
    const ir = compileSystem(await fixture(systemSource()));
    const calls: string[] = [];
    await expect(
      executeProgramIR(ir, "feature/worker/program/cloud", {
        numbers: {
          async read() {
            calls.push("numbers.read");
            throw new Error("unavailable");
          },
        },
        output: { async write() {} },
      }),
    ).rejects.toThrow("unavailable");
    expect(calls).toEqual(["numbers.read"]);
  });

  test("distinguishes an authored empty catch from an absent catch", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await dependencies.output.write({ category: "large", value: total });
        } else {
          await dependencies.output.write({ category: "small", value: total });
        }`,
        `let total = 0;
        try {
          const values = await dependencies.numbers.read({ count: 4 });
          for (const value of values) total += value;
        } catch {
        } finally {
          total += 10;
        }
        await dependencies.output.write({ category: "large", value: total });`,
      ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(implementation.entry.body).toContainEqual(
      expect.objectContaining({
        kind: "try",
        catch: { body: [] },
      }),
    );

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: {
        async read() {
          throw new Error("handled");
        },
      },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });

    expect(writes).toEqual([{ category: "large", value: 10 }]);
  });

  test("preserves JavaScript Error inheritance in portable catch conditions", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await dependencies.output.write({ category: "large", value: total });
        } else {
          await dependencies.output.write({ category: "small", value: total });
        }`,
        `try {
          await dependencies.numbers.read({ count: 4 });
        } catch (error) {
          await dependencies.output.write({
            category: error instanceof Error ? "large" : "small",
            value: 1,
          });
        }`,
      ),
    );
    const ir = compileSystem(entry);
    const writes: unknown[] = [];
    class ProviderFailure extends Error {
      override name = "ProviderFailure";
    }
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: {
        async read() {
          throw new ProviderFailure("handled subclass");
        },
      },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });

    expect(writes).toEqual([{ category: "large", value: 1 }]);
  });

  test("lowers computed record writes through the portable subset", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await dependencies.output.write({ category: "large", value: total });
        } else {
          await dependencies.output.write({ category: "small", value: total });
        }`,
        `const values: Record<string, number> = {};
        const selected = "total";
        values[selected] = 4;
        values[selected] += 6;
        await dependencies.output.write({ category: "large", value: values[selected] });`,
      ),
    );
    const ir = compileSystem(entry);
    const contribution = programContribution(ir, "feature/worker/program/cloud");
    const implementation = serverExecution(contribution);
    if (implementation?.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(implementation.entry.body).toContainEqual(
      expect.objectContaining({ kind: "index-assign", operator: "=" }),
    );
    expect(implementation.entry.body).toContainEqual(
      expect.objectContaining({ kind: "index-assign", operator: "+=" }),
    );

    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: {
        async read() {
          return [];
        },
      },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });
    expect(writes).toEqual([{ category: "large", value: 10 }]);
  });

  test("does not constant-fold mutable computed reads", async () => {
    const entry = await fixture(
      systemSource().replace(
        `const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await dependencies.output.write({ category: "large", value: total });
        } else {
          await dependencies.output.write({ category: "small", value: total });
        }`,
        `const values: Record<string, number> = {};
        let selected = "first";
        values[selected] = 4;
        selected = "second";
        values[selected] = 6;
        await dependencies.output.write({ category: "large", value: values[selected] });`,
      ),
    );
    const ir = compileSystem(entry);
    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [] },
      output: {
        async write({ input }) {
          writes.push(input);
        },
      },
    });

    expect(writes).toEqual([{ category: "large", value: 6 }]);
  });

  test(
    "generates and runs a standalone Rust artifact from the same portable IR",
    { tags: ["compiler"], timeout: 120_000 },
    async () => {
      const ir = compileSystem(await fixture(systemSource()));
      const program = programContribution(ir, "feature/worker/program/cloud")!;
      const directory = await temporaryDirectory("kit-production-");
      const executable = resolve(directory, "portable-program");

      await buildRustProgram(program, executable);
      const scenario = {
        responses: {
          "numbers.read": [{ ok: [1, 2, 3, 4] }],
          "output.write": [{ ok: null }],
        },
      } as const;
      await using native = await createRustProgramSession(executable);
      const result = await native.run(scenario);
      const reference = await executeProgramFixtureIR(ir, "feature/worker/program/cloud", scenario);

      expect(result).toEqual(reference);
      expect(result).toEqual({
        calls: [
          { dependency: "numbers", operation: "read", input: { count: 4 } },
          {
            dependency: "output",
            operation: "write",
            input: { category: "large", value: 10 },
          },
        ],
        result: { ok: null },
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.integer({ min: -1_000, max: 1_000 }), { maxLength: 32 }),
          async (values) => {
            const generated = {
              responses: {
                "numbers.read": [{ ok: values }],
                "output.write": [{ ok: null }],
              },
            };
            const [javascript, rust] = await Promise.all([
              executeProgramFixtureIR(ir, "feature/worker/program/cloud", generated),
              native.run(generated),
            ]);
            expect(rust).toEqual(javascript);
          },
        ),
        { numRuns: 40 },
      );

      const largeScenario = {
        responses: {
          "numbers.read": [{ ok: Array.from({ length: 10_000 }, () => 1) }],
          "output.write": [{ ok: null }],
        },
      };
      await expect(native.run(largeScenario)).resolves.toEqual(
        await executeProgramFixtureIR(ir, "feature/worker/program/cloud", largeScenario),
      );

      const failureScenario = {
        responses: {
          "numbers.read": [
            { error: { message: "unavailable", data: { retryAfterMilliseconds: 250 } } },
          ],
        },
      } as const;
      await expect(native.run(failureScenario)).resolves.toEqual(
        await executeProgramFixtureIR(ir, "feature/worker/program/cloud", failureScenario),
      );

      const factoryIR = compileSystem(await fixture(headlessFactorySystemSource()));
      const factoryProgram = programContribution(factoryIR, "feature/tasks/program/server")!;
      const factoryExecutable = resolve(directory, "factory-program");
      const factoryScenario = {
        responses: { "repository.read": [{ ok: ["one", "two"] }] },
      } as const;
      await buildRustProgram(factoryProgram, factoryExecutable);
      await expect(runRustProgram(factoryExecutable, factoryScenario)).resolves.toEqual(
        await executeProgramFixtureIR(factoryIR, "feature/tasks/program/server", factoryScenario),
      );
    },
  );

  test(
    "preserves portable failure identity and source context in JavaScript and Rust",
    { tags: ["compiler"], timeout: 120_000 },
    async () => {
      const ir = compileSystem(await projectFixture(throwingSystemSource()));
      const contribution = programContribution(ir, "feature/worker/program/server")!;
      const directory = await temporaryDirectory("kit-failure-");
      const executable = resolve(directory, "failure-program");
      const scenario = { responses: { "output.write": [{ ok: null }] } };

      await buildRustProgram(contribution, executable);
      const [javascript, rust] = await Promise.all([
        executeProgramFixtureIR(ir, contribution.id, scenario),
        runRustProgram(executable, scenario),
      ]);

      expect(rust).toEqual(javascript);
      expect(rust).toMatchObject({
        result: {
          error: {
            message: "intentional failure",
          },
        },
      });
    },
  );
});

async function fixture(source: string): Promise<string> {
  const directory = await temporaryDirectory("kit-ir-");
  const entry = resolve(directory, "system.ts");
  await writeFile(entry, source);
  return entry;
}

async function projectFixture(source: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "compiler-fixture-"));
  temporaryDirectories.push(directory);
  const entry = resolve(directory, "system.ts");
  await Promise.all([
    writeFile(entry, source),
    writeFile(
      resolve(directory, "tsconfig.json"),
      JSON.stringify({
        extends: resolve(import.meta.dirname, "../../tsconfig.json"),
        include: ["system.ts"],
        exclude: [],
        compilerOptions: {
          paths: { "@/*": [resolve(import.meta.dirname, "../*")] },
        },
      }),
    ),
  ]);
  return entry;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function compositionTypes(): string {
  return `
declare const featureContract: unique symbol;
declare const applicationContract: unique symbol;
declare const dependencyDefinition: unique symbol;
type DependencyCallOptions = Readonly<{ idempotencyKey?: string }>;
type DependencyConsumerOperations<Operations extends Record<string, (...arguments_: never[]) => unknown>> = {
  [Name in keyof Operations]: Parameters<Operations[Name]> extends [unknown, ...unknown[]]
    ? (
        input: Parameters<Operations[Name]>[0],
        options?: DependencyCallOptions,
      ) => ReturnType<Operations[Name]>
    : Operations[Name];
};
type Dependency<Definition extends { Operations: object }> = Readonly<
  Definition["Operations"] &
    DependencyConsumerOperations<
      Extract<Definition["Operations"], Record<string, (...arguments_: never[]) => unknown>>
    > & { readonly [dependencyDefinition]?: Definition }
>;
type Feature<C> = Readonly<{ readonly [featureContract]?: C }>;
type Application<C> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: C;
    Features: C extends { Features: infer Features } ? Features : {};
    Interfaces: C extends { Interfaces: infer Interfaces } ? Interfaces : {};
  };
}>;
function createFeature<C>(definition: object): Feature<C> {
  return definition as Feature<C>;
}
function createApplication<C>(definition: object): Application<C> {
  return definition as Application<C>;
}
function createInterface<C>(definition: object): C {
  return definition as C;
}
function createSystem(definition: object): object {
  return definition;
}
`;
}

function typeLiteralFactorySystemSource(): string {
  return `
import { createSystem, type Feature } from "@/index";
import type { Dependency } from "@/index";
import { typeLiteral } from "@/factory";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type Reader = Dependency<{ Operations: { read(input: {}): Promise<string> } }>;
type Model = { Name: string };
type NamedFeature<Definition extends Model> = {
  Programs: {
    server: {
      Environment: Server;
      Provides: { [Name in Definition["Name"]]: Reader };
    };
  };
};

function createNamedFeature<Definition extends Model>(
  value: string,
): Feature<NamedFeature<Definition>> {
  return createNamedServer<Definition>(value, () => typeLiteral<Definition["Name"]>());
}

function createNamedServer<Definition extends Model>(
  value: string,
  identity: () => Definition["Name"],
): Feature<NamedFeature<Definition>> {
  return {
    programs: {
      server: {
        start() {
          const name = identity();
          return {
            [name]: {
              async read(_context: { input: {} }) {
                return value;
              },
            },
          } as { [Name in Definition["Name"]]: Reader };
        },
      },
    },
  } as unknown as Feature<NamedFeature<Definition>>;
}

type Catalog = { Name: "catalog" };
const catalog = createNamedFeature<Catalog>("ready");

export default createSystem({ features: { catalog } });
`;
}

function typeSchemaFactorySystemSource(): string {
  return `
import {
  createSystem,
  type Dependency,
  type Feature,
} from "@/index";
import { typeLiteral, typeSchema } from "@/factory";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type Reader = Dependency<{ Operations: { describe(input: {}): Promise<object> } }>;
type Model = { Name: string; Data: object };
type SchemaFeature<Definition extends Model> = {
  Programs: {
    server: {
      Environment: Server;
      Provides: { [Name in Definition["Name"]]: Reader };
    };
  };
};

function createSchemaFeature<Definition extends Model>(): Feature<SchemaFeature<Definition>> {
  return {
    programs: {
      server: {
        start() {
          const name = typeLiteral<Definition["Name"]>();
          return {
            [name]: {
              async describe(_context: { input: {} }) {
                return typeSchema<Definition["Data"]>() as object;
              },
            },
          } as { [Name in Definition["Name"]]: Reader };
        },
      },
    },
  } as unknown as Feature<SchemaFeature<Definition>>;
}

type Catalog = {
  Name: "catalog";
  Data: { title: string; count?: number; tags: readonly string[] };
};
const catalog = createSchemaFeature<Catalog>();

export default createSystem({ features: { catalog } });
`;
}

function dependencyDispatcherSystemSource(): string {
  return `
import { dependencyInvocation } from "@/core/dependency";
import {
  createSystem,
  type Dependency,
  type Feature,
} from "@/index";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type Math = Dependency<{
  Operations: {
    double(input: { value: number }): Promise<number>;
    triple(input: { value: number }): Promise<number>;
  };
}>;
type Output = Dependency<{
  Operations: {
    write(input: { doubled: number; tripled: number }): Promise<void>;
  };
}>;
type Provider = {
  Programs: { server: { Environment: Server; Provides: { math: Math } } };
};
type Consumer = {
  Programs: {
    server: { Environment: Server; Requires: { math: Math; output: Output } };
  };
};

function createMath(): Feature<Provider> {
  return {
    programs: {
      server: {
        start() {
          const operations = {
            double: ({ value }: { value: number }) => value * 2,
            triple: ({ value }: { value: number }) => value * 3,
          };
          return {
            math: {
              [dependencyInvocation](
                operation: "double" | "triple",
                input: { value: number },
                _invocation: {
                  id: string;
                  attempt: number;
                  scheduledAt: number;
                  startedAt: number;
                },
              ) {
                const handler = operations[operation];
                return handler(input);
              },
            },
          } as unknown as { math: Math };
        },
      },
    },
  } as unknown as Feature<Provider>;
}

const consumer = {
  programs: {
    server: {
      async start({ dependencies }: { dependencies: { math: Math; output: Output } }) {
        const doubled = await dependencies.math.double({ value: 3 });
        const tripled = await dependencies.math.triple({ value: 3 });
        await dependencies.output.write({ doubled, tripled });
      },
    },
  },
} as Feature<Consumer>;

export default createSystem({
  features: {
    math: createMath(),
    consumer,
  },
});
`;
}

function sharedHostDependencySystemSource(): string {
  return `
import { createSystem, type Dependency, type Feature } from "@/index";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type EventStore<Event = object> = Dependency<{
  Operations: {
    append(input: { events: readonly Event[] }): Promise<void>;
  };
}>;
type Model = { Event: object };
type Slice<Definition extends Model> = {
  Programs: {
    server: { Environment: Server; Requires: { events: EventStore } };
  };
};

function createSlice<Definition extends Model>(): Feature<Slice<Definition>> {
  return {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: { events: EventStore } }) {
          const events = dependencies.events as EventStore<Definition["Event"]>;
          await events.append({ events: [] as readonly Definition["Event"][] });
        },
      },
    },
  } as unknown as Feature<Slice<Definition>>;
}

type Order = { Event: { type: "order.created"; orderId: string } };
type User = { Event: { type: "user.created"; userId: string } };

export default createSystem({
  features: {
    orders: createSlice<Order>(),
    users: createSlice<User>(),
  },
});
`;
}

function shadowedDependencySystemSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Output = Dependency<{
  Operations: { write(input: { value: string }): Promise<void> };
}>;
type Worker = {
  Programs: {
    server: Program<Environment, { Requires: { output: Output } }>;
  };
};

const local = {
  nested: {
    async write(_input: { value: string }): Promise<void> {},
  },
};

const worker = createFeature<Worker>({
  programs: {
    server: {
      async start({ dependencies }: { dependencies: { output: Output } }) {
        const invoke = async ({ dependencies }: { dependencies: typeof local }) => {
          await dependencies.nested.write({ value: "local" });
        };
        await invoke({
          dependencies: {
            nested: {
              async write(input) {
                await dependencies.output.write(input);
              },
            },
          },
        });
      },
    },
  },
});

export default createSystem({ features: { worker } });
`;
}

function throwingSystemSource(): string {
  return `
import { createFeature, createSystem, type Dependency } from "@/index";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type Output = Dependency<{
  Operations: { write(input: { value: string }): Promise<void> };
}>;
type Worker = {
  Programs: {
    server: { Environment: Server; Requires: { output: Output } };
  };
};

const worker = createFeature<Worker>({
  programs: {
    server: {
      async start({ dependencies }) {
        await dependencies.output.write({ value: "before failure" });
        throw new Error("intentional failure");
      },
    },
  },
});

export default createSystem({ features: { worker } });
`;
}

function systemSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Numbers = Dependency<{
  Operations: {
    read(input: { count: number }): Promise<readonly number[]>;
  };
}>;
type Output = Dependency<{
  Operations: {
    write(input: { category: "large" | "small"; value: number }): Promise<void>;
  };
}>;
type Child = { Programs: { cloud: Program<{ Name: "server"; Platform: { Name: "server" } }> } };
type Worker = {
  Programs: {
    cloud: Program<
      { Name: "server"; Platform: { Name: "server" } },
      { Requires: { numbers: Numbers; output: Output } }
    >;
  };
  Features: { child: Child };
};

const child = createFeature<Child>({ programs: { cloud: {} } });
const worker = createFeature<Worker>({
  features: { child },
  programs: {
    cloud: {
      async start({ dependencies }: { dependencies: { numbers: Numbers; output: Output } }) {
        const values = await dependencies.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await dependencies.output.write({ category: "large", value: total });
        } else {
          await dependencies.output.write({ category: "small", value: total });
        }
      },
    },
  },
});

throw new Error("The compiler must never execute System source.");
export default createSystem({
  metadata: { name: "Portable fixture" },
  features: { child, worker },
});
`;
}

function streamSystemSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}
type Changes = Dependency<{
  Operations: { subscribe(input: {}): AsyncIterable<{ revision: number }> };
}>;
type Output = Dependency<{
  Operations: { write(input: { revision: number }): Promise<void> };
}>;
type Worker = {
  Programs: {
    cloud: Program<Environment, { Requires: { changes: Changes; output: Output } }>;
  };
};

const worker = createFeature<Worker>({
  programs: {
    cloud: {
      async start({ dependencies }: { dependencies: { changes: Changes; output: Output } }) {
        for await (const change of dependencies.changes.subscribe({})) {
          await dependencies.output.write({ revision: change.revision });
          return;
        }
      },
    },
  },
});

export default createSystem({
  metadata: { name: "Stream fixture" },
  features: { worker },
});
`;
}

function componentSystemSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Shell = {
  Programs: {
    browser: Program<
      {
        Name: "browser-main";
        Platform: { Name: "web"; UI: { Name: "web" } };
        UI: { Name: "web" };
      },
      {
        Components: {
          Drawer: {
            Props: { onDismiss?(): void; label: string };
            State: {
              phase: "closed" | "open";
              dragOffset: number;
            };
            Actions: { open(): void; close(): void };
            Elements: { Root: "main"; Surface: "section" };
          };
        };
      }
    >;
  };
};
type Web = { Interface: { Platform: { Name: "web" } } };
type Product = {
  Features: { shell: Shell };
  Interfaces: { web: Web };
};

const shell = createFeature<Shell>({
  programs: {
    browser: {
      components: {
        Drawer: {
          state: { phase: "closed", dragOffset: 0 },
          actions: { open() {}, close() {} },
          mount() {},
          view() { return null; },
        },
      },
    },
  },
});
const presentation = {
  parameters: {},
  create() {
    return { Shell: () => ({ Drawer: () => ({}) }) };
  },
};
const web = createInterface<Web>({
  presentation,
});
const product = createApplication<Product>({
  interfaces: { web },
});

export default createSystem({
  metadata: { name: "Component fixture" },
  features: { shell },
  applications: { product },
});
`;
}

function multiProgramSystemSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Server = { Name: "server"; Platform: { Name: "server" } };
type Browser = {
  Name: "browser-main";
  Platform: { Name: "web"; UI: { Name: "web" } };
  UI: { Name: "web" };
};
type BrowserWorker = { Name: "browser-worker"; Platform: { Name: "web" } };

type Shared = { Programs: { api: Program<Server>; "browser-worker": Program<BrowserWorker> } };
type Orders = {
  Programs: { api: Program<Server>; browser: Program<Browser> };
  Features: { shared: Shared };
};
type Jobs = {
  Programs: { worker: Program<Server>; "browser-worker": Program<BrowserWorker> };
};

const shared = createFeature<Shared>({ programs: { api: {}, "browser-worker": {} } });
const orders = createFeature<Orders>({
  programs: { api: {}, browser: {} },
  features: { shared },
});
const jobs = createFeature<Jobs>({
  programs: { worker: {}, "browser-worker": {} },
});

export default createSystem({ features: { orders, jobs } });
`;
}

function multiAppSystemSource(
  topOrder: readonly ("shared" | "operationsService" | "customerService")[] = [
    "shared",
    "operationsService",
    "customerService",
  ],
  operationsOrder: readonly ("service" | "web")[] = ["service", "web"],
  customerOrder: readonly ("service" | "web")[] = ["service", "web"],
): string {
  const values = (order: readonly ("service" | "web")[], web: "operationsWeb" | "customerWeb") =>
    order
      .flatMap((name) => (name === "web" ? [`interfaces: { web: ${web} }`] : []))
      .join(",\n    ");
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Server = { Name: "server"; Platform: { Name: "server" } };
type Browser = { Name: "browser-main"; Platform: { Name: "web" } };
type Shared = { Programs: { api: Program<Server> } };
  type Service<Name extends string> = {
    Instance: Name;
    Programs: { api: Program<Server>; browser: Program<Browser> };
  };
type Web = { Interface: { Platform: { Name: "web" } } };
type Operations = {
    Name: "Operations";
    Features: { service: Service<"operations"> };
  Interfaces: { web: Web };
};
type Customer = {
    Name: "Customer";
    Features: { service: Service<"customer"> };
  Interfaces: { web: Web };
};

const shared = createFeature<Shared>({ programs: { api: {} } });
  const operationsService = createFeature<Service<"operations">>({
    programs: { api: {}, browser: {} },
  });
const operationsWeb = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
  const operations = createApplication<Operations>({
    ${values(operationsOrder, "operationsWeb")}
});
  const customerService = createFeature<Service<"customer">>({
    programs: { api: {}, browser: {} },
  });
const customerWeb = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
  const customer = createApplication<Customer>({
    ${values(customerOrder, "customerWeb")}
});

export default createSystem({
  metadata: { name: "Company" },
  features: {
    ${topOrder.join(", ")}
  },
  applications: { operations, customer },
});
`;
}

function sharedApplicationFeatureSystemSource(): string {
  return `
declare const featureContract: unique symbol;
declare const applicationContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
type Application<Contract> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: Contract;
    Features: Contract extends { Features: infer Features } ? Features : {};
    Interfaces: {};
  };
}>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createApplication<Contract>(definition: object): Application<Contract> {
  return definition as Application<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}

type Server = { Name: "server"; Platform: { Name: "server" } };
type Shared = { Programs: { api: { Environment: Server } } };
type Product = { Features: { shared: Shared }; Interfaces: {} };

const shared = createFeature<Shared>({ programs: { api: {} } });
const customer = createApplication<Product>({ interfaces: {} });
const operations = createApplication<Product>({ interfaces: {} });

export default createSystem({
  features: { shared },
  applications: { customer, operations },
});
`;
}

function sharedFactoryApplicationFeatureSystemSource(): string {
  return `
declare const featureContract: unique symbol;
declare const applicationContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
type Application<Contract> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: Contract;
    Features: Contract extends { Features: infer Features } ? Features : {};
    Interfaces: {};
  };
}>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createApplication<Contract>(definition: object): Application<Contract> {
  return definition as Application<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}

type Server = { Name: "server"; Platform: { Name: "server" } };
type Shared = { Programs: { api: { Environment: Server } } };
type Product = { Features: { shared: Shared }; Interfaces: {} };

const shared = createFeature<Shared>({ programs: { api: {} } });
function createProduct(_name: string) {
  return createApplication<Product>({ interfaces: {} });
}
const customer = createProduct("customer");
const operations = createProduct("operations");

export default createSystem({
  features: { shared },
  applications: { customer, operations },
});
`;
}

function headlessFactorySystemSource(): string {
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Tasks = {
  Programs: {
    server: Program<
      { Name: "server"; Platform: { Name: "server" } },
      {
        Requires: { repository: Repository };
      }
    >;
  };
};
type Repository = Dependency<{
  Operations: { read(input: {}): Promise<readonly string[]> };
}>;

function countTasks<Values extends readonly string[]>(values: Values): number {
  return values.length;
}

function createTasksFeature<const Name extends string>(name: Name, implementation: {
  run(input: {
    dependencies: { repository: Repository };
  }): Promise<void>;
}): Feature<Tasks> {
  return {
    programs: {
      server: { start: implementation.run },
    },
  } as Feature<Tasks>;
}

const tasks = createTasksFeature("tasks", {
  async run({ dependencies }) {
    const tasks = await dependencies.repository.read({});
    const count = countTasks(tasks);
    if (count >= 0) return;
  },
});

export default createSystem({
  metadata: { name: "Factory fixture" },
  features: { tasks },
});
`;
}

function uiFactorySystemSource(): string {
  return `
type UI = { readonly Name: "web"; readonly Child: unknown; readonly Elements: {} };
type Platform = { readonly Name: "web"; readonly UI: UI };
type Environment = { readonly Name: "browser"; readonly Platform: Platform; readonly UI: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Data = {
  Programs: {
    browser: Program<
      Environment,
      {
        State: { entities: readonly { id: string }[]; synchronization: "offline" | "online" };
        Actions: { create(input: { title: string }): void; synchronize(): void };
      }
    >;
  };
};
declare function createData(): Feature<Data>;

export default createSystem({
  metadata: { name: "UI factory fixture" },
  features: { data: createData() },
});
`;
}

function nestedFactorySystemSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}
type Repository = Dependency<{
  Operations: { read(input: {}): Promise<readonly string[]> };
}>;
type Child = {
  Programs: { api: Program<Environment, { Requires: { repository: Repository } }> };
};
type Parent = { Features: { child: Child } };

function createChild() {
  return createFeature<Child>({
    programs: {
      api: {
        async start({ dependencies }: { dependencies: { repository: Repository } }) {
          await dependencies.repository.read({});
        },
      },
    },
  });
}
const parent = createFeature<Parent>({
  features: { child: createChild() },
});

export default createSystem({
  features: { parent },
});
`;
}

function callbackFactorySystemSource(): string {
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Repository = Dependency<{
  Operations: { read(input: {}): Promise<readonly string[]> };
}>;
type Tasks = {
  Programs: {
    server: Program<
      { Name: "server"; Platform: { Name: "server" } },
      { Requires: { repository: Repository } }
    >;
  };
};

function defineServerFeature<Contract>(threshold: number): Feature<Tasks> {
  const server = {
    async start({ dependencies }: { dependencies: { repository: Repository } }) {
      const values = await dependencies.repository.read({});
      if (values.length >= threshold) return;
    },
  };
  return {
    programs: {
      server,
      },
  } as Feature<Tasks>;
}

const tasks = defineServerFeature<Tasks>(0);

export default createSystem({ features: { tasks } });
`;
}

function contextualCallbackFactorySystemSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Output = Dependency<{
  Operations: { write(input: { value: string }): Promise<void> };
}>;
type Handler = (
  context: { dependencies: { output: Output } },
  input: { value: string },
) => Promise<void>;
type Handlers = { emit: Handler };
type Worker = {
  Programs: {
    server: Program<Environment, { Requires: { output: Output } }>;
  };
};

function defineWorker(handlers: Handlers): Feature<Worker> {
  return {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: { output: Output } }) {
          await handlers.emit({ dependencies }, { value: "ready" });
        },
      },
    },
  } as Feature<Worker>;
}

const worker = defineWorker({
  async emit({ dependencies }, input) {
    await dependencies.output.write(input, { idempotencyKey: "emit-ready" });
  },
});

export default createSystem({ features: { worker } });
`;
}

function dependencyReferenceSystemSource(): string {
  return `
import {
  createFeature,
  createSystem,
  type Dependency,
  type DependencyReference,
} from "@/index";
import { typeLiteral } from "@/core/intrinsic";
import type { ServerPlatform } from "@/platforms/server";

type Server = { Name: "server"; Platform: ServerPlatform };
type CounterReference = {
  Name: "get";
  Binding: { key: string };
  Inputs: { add: { value: number }; read: undefined };
  Argument: "input";
};
type CounterInstance = DependencyReference<
  CounterReference,
  {
    add(input: { value: number }, options?: { idempotencyKey?: string }): Promise<number>;
    read(): Promise<number>;
  }
>;
type Counter = Dependency<
  {
    Operations: {
      add(input: {
        key: string;
        input: { value: number };
        idempotencyKey?: string;
      }): Promise<number>;
      read(input: { key: string }): Promise<number>;
    };
    Reference: CounterReference;
  },
  { get(input: { key: string }): CounterInstance }
>;
type Worker = {
  Programs: {
    server: { Environment: Server; Requires: { counter: Counter } };
  };
};

async function update(counter: CounterInstance) {
  await counter.add({ value: 2 }, { idempotencyKey: "add-1" });
  await counter.read();
}

type CounterRequirements<Name extends string> = Readonly<{
  [Key in Name]: Counter;
}>;

function createCounterResolver<Name extends "counter">() {
  return ({
    dependencies,
    key,
  }: {
    dependencies: CounterRequirements<Name>;
    key: string;
  }) => dependencies[typeLiteral<Name>()].get({ key });
}

const resolveCounter = createCounterResolver<"counter">();

const worker = createFeature<Worker>({
  programs: {
    server: {
      async start({ dependencies }) {
        await update(resolveCounter({ dependencies, key: "counter-1" }));
      },
    },
  },
});

export default createSystem({ features: { worker } });
`;
}

function record(fields: Readonly<Record<string, TypeIR>>): TypeIR {
  return {
    kind: "record",
    fields: Object.entries(fields).map(([name, type]) => ({ name, type, optional: false })),
  };
}

function numberType(): TypeIR {
  return { kind: "primitive", name: "number" };
}

function programContribution(ir: SystemIR, id: string): ProgramContributionIR | undefined {
  return ir.programs.flatMap(({ contributions }) => contributions).find((item) => item.id === id);
}

function serverExecution(contribution: ProgramContributionIR | undefined) {
  return contribution ? serverProgramExecution(contribution) : undefined;
}

function collectExpressions(statements: readonly StatementIR[]): ExpressionIR[] {
  const expressions: ExpressionIR[] = [];
  const visit = (expression: ExpressionIR): void => {
    expressions.push(expression);
    if (expression.kind === "array") expression.values.forEach(visit);
    else if (expression.kind === "record") expression.fields.forEach(({ value }) => visit(value));
    else if (expression.kind === "property" || expression.kind === "unary") visit(expression.value);
    else if (expression.kind === "index") {
      visit(expression.value);
      visit(expression.index);
    } else if (expression.kind === "binary") {
      visit(expression.left);
      visit(expression.right);
    } else if (expression.kind === "conditional") {
      visit(expression.condition);
      visit(expression.consequent);
      visit(expression.alternate);
    } else if (expression.kind === "concurrent") {
      expression.values.forEach(visit);
    } else if (expression.kind === "call" || expression.kind === "dependency-call") {
      expression.arguments.forEach(visit);
    } else if (expression.kind === "invoke") {
      visit(expression.callee);
      expression.arguments.forEach(visit);
    } else if (expression.kind === "method-call") {
      visit(expression.receiver);
      expression.arguments.forEach(visit);
    } else if (expression.kind === "error") {
      expression.arguments.forEach(visit);
    } else if (expression.kind === "error-match") {
      visit(expression.value);
    } else if (expression.kind === "closure") {
      expression.captures.forEach(visit);
    }
  };
  for (const statement of statements) {
    if (
      statement.kind === "let" ||
      statement.kind === "assign" ||
      statement.kind === "array-push"
    ) {
      visit(statement.value);
    } else if (statement.kind === "property-assign") {
      visit(statement.target);
      visit(statement.value);
    } else if (statement.kind === "index-assign") {
      visit(statement.target);
      visit(statement.index);
      visit(statement.value);
    } else if (statement.kind === "throw") visit(statement.value);
    else if (statement.kind === "expression") visit(statement.expression);
    else if (statement.kind === "if") {
      visit(statement.condition);
      expressions.push(...collectExpressions(statement.consequent));
      expressions.push(...collectExpressions(statement.alternate));
    } else if (statement.kind === "for-of") {
      visit(statement.values);
      expressions.push(...collectExpressions(statement.body));
    } else if (statement.kind === "for-range") {
      visit(statement.from);
      visit(statement.to);
      expressions.push(...collectExpressions(statement.body));
    } else if (statement.kind === "while") {
      visit(statement.condition);
      expressions.push(...collectExpressions(statement.body));
    } else if (statement.kind === "try") {
      expressions.push(...collectExpressions(statement.body));
      if (statement.catch) expressions.push(...collectExpressions(statement.catch.body));
      expressions.push(...collectExpressions(statement.finally));
    } else if (statement.value) visit(statement.value);
  }
  return expressions;
}

function expressionData(expression: ExpressionIR): unknown {
  if (expression.kind === "literal") return expression.value;
  if (expression.kind === "none") return undefined;
  if (expression.kind === "array") return expression.values.map(expressionData);
  if (expression.kind === "record") {
    return Object.fromEntries(
      expression.fields.map(({ name, value }) => [name, expressionData(value)]),
    );
  }
  return undefined;
}
