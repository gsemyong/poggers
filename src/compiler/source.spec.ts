import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, describe, expect, test } from "vitest";

import {
  buildRustProgram,
  createRustProgramSession,
  runRustProgram,
} from "@/adapters/server/production/fixtures/conformance";
import type { SourceCompilerExtension } from "@/compiler/extension";
import {
  selectSystemOutputs,
  serializeSystemIR,
  type SystemIR,
  type ExpressionIR,
  type ProgramContributionIR,
  type StatementIR,
  type TypeIR,
} from "@/compiler/ir";
import { SystemDiagnostic, compileSystem, createSystemCompiler } from "@/compiler/source";
import { executeProgramFixtureIR, executeProgramIR } from "@/runtime/interpreter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("System compiler", () => {
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
    expect(program).toMatchObject({
      environment: { name: "server", platform: "server" },
    });
    expect(contribution).toMatchObject({
      requires: [{ name: "numbers" }, { name: "output" }],
      implementation: { kind: "portable", start: { asynchronous: true } },
    });
    expect(
      contribution?.implementation.kind === "portable"
        ? contribution.implementation.start.body.map(({ kind }) => kind)
        : [],
    ).toEqual(["let", "let", "for-of", "if"]);
    if (contribution?.implementation.kind !== "portable") throw new Error("Expected portable IR.");
    const expressions = collectExpressions(contribution.implementation.start.body);
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

  test("lowers two Apps into one shared Program and independent interface outputs", async () => {
    const ir = compileSystem(await fixture(multiAppSystemSource()));

    expect(ir.apps).toEqual([
      {
        id: "app/customer",
        feature: "customer",
        interfaces: ["interface/customer.web"],
      },
      {
        id: "app/operations",
        feature: "operations",
        interfaces: ["interface/operations.web"],
      },
    ]);
    expect(ir.interfaces).toEqual([
      {
        id: "interface/customer.web",
        feature: "customer.web",
        app: "customer",
        platform: "web",
        programs: ["program/customer.web.browser"],
        presentationSources: ["system.ts"],
      },
      {
        id: "interface/operations.web",
        feature: "operations.web",
        app: "operations",
        platform: "web",
        programs: ["program/operations.web.browser"],
        presentationSources: ["system.ts"],
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
    ).toEqual(["customer.service", "operations.service", "shared"]);
    expect(ir.features.find(({ path }) => path === "operations.web")).toMatchObject({
      kind: "interface",
      app: "operations",
      interface: "operations.web",
      platform: "web",
      programs: ["program/operations.web.browser"],
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
    ).toEqual(["operations.service", "shared"]);
    expect(focused.platforms).toEqual(["server", "web"]);
    expect(() => selectSystemOutputs(ir, "missing")).toThrow('Unknown App "missing".');
  });

  test("emits byte-identical System IR for Feature and App placement permutations", async () => {
    const top = ["shared", "operations", "customer"] as const;
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

  test("rejects one Program name assigned to incompatible execution contexts", async () => {
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
      /system\.ts:\d+:\d+: Program "cloud" has incompatible execution contexts "device" and "server"/,
    );
  });

  test("reports invalid App and interface ownership at the authored Feature", async () => {
    const entry = await fixture(
      componentSystemSource().replace(
        "type Product = { App: true; Features: { web: Web } };",
        "type Product = { Features: { web: Web } };",
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
      /system\.ts:\d+:\d+: Interface "product\.web" must belong to an App/,
    );
  });

  test("extracts deterministic Component state, actions, Elements, and lifecycle", async () => {
    const ir = compileSystem(await fixture(componentSystemSource()));
    const component = ir.programs[0]?.contributions[0]?.ui?.components[0];

    expect(ir.programs[0]?.environment).toEqual({
      name: "browser-main",
      platform: "web",
      ui: "web",
    });
    expect(ir.programs[0]?.contributions[0]?.implementation).toMatchObject({
      kind: "source",
      reason: "platform-ui",
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
      program({ contract, location, source }) {
        const environment = source.property(contract, "Environment", location);
        const platform = environment
          ? source.property(environment, "Platform", location)
          : undefined;
        if (!platform || source.literal(platform, "Name", location) !== "canvas") return undefined;
        return {
          version: 1,
          scene: source
            .properties(source.property(contract, "Components", location))
            .map((component) => component.getName()),
        };
      },
    };
    const entry = await fixture(
      componentSystemSource().replaceAll('Name: "web"', 'Name: "canvas"'),
    );

    const generic = compileSystem(entry);
    const extended = compileSystem(entry, [extension]);

    expect(generic.programs[0]?.contributions[0]?.extensions).toBeUndefined();
    expect(extended.system.extensions).toEqual({ canvas: { renderer: "gpu" } });
    expect(extended.programs[0]?.contributions[0]?.extensions).toEqual({
      canvas: { version: 1, scene: ["Drawer"] },
    });
  });

  test("retains an incremental Program and identifies Presentation implementation sources", async () => {
    const entry = await fixture(
      `import { clean } from "./presentation";\n${componentSystemSource().replace(
        "presentation,",
        "presentation: clean,",
      )}`,
    );
    const presentation = resolve(entry, "../presentation.ts");
    await writeFile(presentation, "export const clean = {};\n");
    const compiler = createSystemCompiler(entry);

    const first = compiler.compile();
    await writeFile(presentation, "export const clean = Object.freeze({});\n");
    const second = compiler.compile();

    expect(first.presentationSources).toEqual(new Set([presentation]));
    expect(second.presentationSources).toEqual(new Set([presentation]));
    expect(serializeSystemIR(second.ir)).toBe(serializeSystemIR(first.ir));
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

    expect(ir.presentations).toEqual([
      expect.objectContaining({
        interface: "product.web",
        file: "presentation.ts",
        animations: [expect.objectContaining({ binding: "openness" })],
      }),
    ]);
  });

  test("rejects undeclared runtime calls at their source location", async () => {
    const entry = await fixture(
      systemSource().replace(
        "const values = await dependencies.numbers.read({ count: 4 });",
        "const values = [Date.now()];",
      ),
    );

    expect(() => compileSystem(entry)).toThrow(SystemDiagnostic);
    expect(() => compileSystem(entry)).toThrow(/Portable helper calls must resolve/);
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
      output: { write: async (input) => writes.push(input) },
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
    const implementation = programContribution(
      compileSystem(entry),
      "feature/worker/program/cloud",
    )?.implementation;
    expect(implementation?.kind).toBe("portable");
    if (implementation?.kind !== "portable") throw new Error("Expected portable IR.");
    expect(
      collectExpressions(implementation.start.body).some(({ kind }) => kind === "closure"),
    ).toBe(true);
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
    if (contribution?.implementation.kind !== "portable") {
      throw new Error("Expected portable IR.");
    }
    expect(contribution.implementation.start.body).toEqual(
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
      output: { write: async (input) => writes.push(input) },
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
        .replace("type Numbers = {", "type Numbers = Readonly<{")
        .replace("};\ntype Output = {", "}>;\ntype Output = {")
        .replace("input: { count: number }", "input: Readonly<{ count: number }>")
        .replace("Promise<readonly number[]>", "Promise<ReadonlyArray<number>>"),
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
        kind: "feature",
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
    expect(ir.programs[0]?.contributions[0]?.implementation).toMatchObject({
      kind: "portable",
      start: { asynchronous: true },
    });
  });

  test("expands nested Feature factories through mounting and Program placement", async () => {
    const ir = compileSystem(await fixture(nestedFactorySystemSource()));
    const contribution = programContribution(ir, "feature/parent.child/program/api");

    expect(contribution?.implementation).toMatchObject({
      kind: "portable",
      start: { asynchronous: true },
    });
  });

  test("expands a differently shaped closure factory without a compiler special case", async () => {
    const source = callbackFactorySystemSource();
    const entry = await fixture(source);
    const ir = compileSystem(entry);

    expect(programContribution(ir, "feature/tasks/program/server")?.implementation).toMatchObject({
      kind: "portable",
      start: { asynchronous: true },
    });
    await writeFile(
      entry,
      source.replace("defineServerFeature<Tasks>(0)", "defineServerFeature<Tasks>(1)"),
    );
    const changed = compileSystem(entry);
    expect(serializeSystemIR(changed)).not.toBe(serializeSystemIR(ir));
    expect(programContribution(changed, "feature/tasks/program/server")?.implementation.kind).toBe(
      "portable",
    );
  });

  test("extracts state and actions from a Component-free UI Feature factory", async () => {
    const ir = compileSystem(await fixture(uiFactorySystemSource()));
    const program = ir.programs[0];
    const contribution = program?.contributions[0];

    expect(program).toMatchObject({
      id: "program/browser",
      environment: { name: "browser", platform: "web", ui: "web" },
    });
    expect(contribution).toMatchObject({
      id: "feature/data/program/browser",
      implementation: { kind: "source" },
      ui: { actions: ["create", "synchronize"] },
    });
    expect(contribution?.ui?.state).toMatchObject({ kind: "record" });
  });

  test("executes the extracted process through injected Dependencies", async () => {
    const ir = compileSystem(await fixture(systemSource()));
    const writes: unknown[] = [];
    const execution = await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3, 4] },
      output: {
        async write(input) {
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

    expect(contribution?.implementation).toMatchObject({
      kind: "portable",
      functions: [{ name: "sum" }],
    });
    const writes: unknown[] = [];
    await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [2, 4, 6] },
      output: { write: async (input) => writes.push(input) },
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

  test("generates and runs a standalone Rust artifact from the same portable IR", async () => {
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
  }, 120_000);
});

async function fixture(source: string): Promise<string> {
  const directory = await temporaryDirectory("kit-ir-");
  const entry = resolve(directory, "system.ts");
  await writeFile(entry, source);
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
type Feature<C> = Readonly<{ readonly [featureContract]?: C }>;
function createFeature<C>(definition: object): Feature<C> {
  return definition as Feature<C>;
}
function createSystem(definition: object): object {
  return definition;
}
`;
}

function systemSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Numbers = {
  read(input: { count: number }): Promise<readonly number[]>;
};
type Output = {
  write(input: { category: "large" | "small"; value: number }): Promise<void>;
};
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
type App = {
  Features: { child: Child; worker: Worker };
  Presentations: "rich" | "plain";
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
type Changes = { subscribe(input: {}): AsyncIterable<{ revision: number }> };
type Output = { write(input: { revision: number }): Promise<void> };
type Worker = {
  Programs: {
    cloud: Program<Environment, { Requires: { changes: Changes; output: Output } }>;
  };
};
type App = { Features: { worker: Worker } };

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
type Web = {
  Interface: { Platform: { Name: "web" } };
  Features: { shell: Shell };
};
type Product = { App: true; Features: { web: Web } };

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
const web = createFeature<Web>({
  features: { shell },
  presentation,
});
const product = createFeature<Product>({ features: { web } });

export default createSystem({
  metadata: { name: "Component fixture" },
  features: { product },
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
type App = { Features: { orders: Orders; jobs: Jobs } };

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
  topOrder: readonly ("shared" | "operations" | "customer")[] = [
    "shared",
    "operations",
    "customer",
  ],
  operationsOrder: readonly ("service" | "web")[] = ["service", "web"],
  customerOrder: readonly ("service" | "web")[] = ["service", "web"],
): string {
  const fields = (order: readonly ("service" | "web")[]) =>
    order.map((name) => `${name}: ${name === "service" ? "Service" : "Web"}`).join("; ");
  const values = (order: readonly ("service" | "web")[]) => order.join(", ");
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Server = { Name: "server"; Platform: { Name: "server" } };
type Browser = { Name: "browser-main"; Platform: { Name: "web" } };
type Shared = { Programs: { api: Program<Server> } };
type Service = { Programs: { api: Program<Server> } };
type Web = {
  Interface: { Platform: { Name: "web" } };
  Programs: { browser: Program<Browser> };
};
type Operations = {
  App: true;
  Features: { ${fields(operationsOrder)} };
};
type Customer = {
  App: true;
  Features: { ${fields(customerOrder)} };
};

const shared = createFeature<Shared>({ programs: { api: {} } });
const operationsService = createFeature<Service>({ programs: { api: {} } });
const operationsWeb = createFeature<Web>({
  programs: { browser: {} },
  presentation: { parameters: {}, create() { return {}; } },
});
const operations = createFeature<Operations>({
  features: {
    ${values(operationsOrder)
      .replace("service", "service: operationsService")
      .replace("web", "web: operationsWeb")}
  },
});
const customerService = createFeature<Service>({ programs: { api: {} } });
const customerWeb = createFeature<Web>({
  programs: { browser: {} },
  presentation: { parameters: {}, create() { return {}; } },
});
const customer = createFeature<Customer>({
  features: {
    ${values(customerOrder)
      .replace("service", "service: customerService")
      .replace("web", "web: customerWeb")}
  },
});

export default createSystem({
  metadata: { name: "Company" },
  features: {
    ${topOrder.join(", ")}
  },
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
        Requires: { repository: { read(input: {}): Promise<readonly string[]> } };
      }
    >;
  };
};
type App = { Features: { tasks: Tasks } };

function countTasks<Values extends readonly string[]>(values: Values): number {
  return values.length;
}

function createTasksFeature<const Name extends string>(name: Name, implementation: {
  run(input: {
    dependencies: { repository: { read(input: {}): Promise<readonly string[]> } };
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
type App = { Features: { data: Data } };
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
type Repository = { read(input: {}): Promise<readonly string[]> };
type Child = {
  Programs: { api: Program<Environment, { Requires: { repository: Repository } }> };
};
type Parent = { Features: { child: Child }; RoutePath: "parent" };
type App = { Features: { parent: Parent } };

function createChild() {
  return {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: { repository: Repository } }) {
          await dependencies.repository.read({});
        },
      },
    },
  };
}
declare function placePrograms(value: unknown, placement: { server: "api" }): Feature<Child>;
declare function mountFeature(value: unknown, input: { path: "parent" }): Feature<Parent>;
const parent = {
  features: { child: placePrograms(createChild(), { server: "api" }) },
};

export default createSystem({
  features: { parent: mountFeature(parent, { path: "parent" }) },
});
`;
}

function callbackFactorySystemSource(): string {
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionTypes()}

type Repository = { read(input: {}): Promise<readonly string[]> };
type Tasks = {
  Programs: {
    server: Program<
      { Name: "server"; Platform: { Name: "server" } },
      { Requires: { repository: Repository } }
    >;
  };
};
type App = { Features: { tasks: Tasks } };

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

function collectExpressions(statements: readonly StatementIR[]): ExpressionIR[] {
  const expressions: ExpressionIR[] = [];
  const visit = (expression: ExpressionIR): void => {
    expressions.push(expression);
    if (expression.kind === "array") expression.values.forEach(visit);
    else if (expression.kind === "record") expression.fields.forEach(({ value }) => visit(value));
    else if (expression.kind === "property" || expression.kind === "unary") visit(expression.value);
    else if (expression.kind === "binary") {
      visit(expression.left);
      visit(expression.right);
    } else if (expression.kind === "conditional") {
      visit(expression.condition);
      visit(expression.consequent);
      visit(expression.alternate);
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
    } else if (statement.kind === "try") {
      expressions.push(...collectExpressions(statement.body));
      expressions.push(...collectExpressions(statement.catch));
      expressions.push(...collectExpressions(statement.finally));
    } else if (statement.value) visit(statement.value);
  }
  return expressions;
}
