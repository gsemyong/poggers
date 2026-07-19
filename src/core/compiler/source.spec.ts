import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { executeProgramIR } from "../development";
import { serializeApplicationIR, type TypeIR } from "./ir";
import { compileApplication, ApplicationDiagnostic } from "./source";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Poggers Application compiler", () => {
  test("extracts stable Application meaning and portable control flow without executing source", async () => {
    const entry = await fixture(applicationSource());
    const first = compileApplication(entry);
    const second = compileApplication(entry);

    expect(serializeApplicationIR(second)).toBe(serializeApplicationIR(first));
    expect(first.application).toEqual({
      id: "application/Portable fixture",
      name: "Portable fixture",
      presentations: ["plain", "rich"],
    });
    expect(first.features.map(({ id }) => id)).toEqual([
      "feature/child",
      "feature/worker",
      "feature/worker.child",
    ]);
    expect(first.programs.map(({ id }) => id)).toEqual([
      "feature/child/program/cloud",
      "feature/worker.child/program/cloud",
      "feature/worker/program/cloud",
    ]);
    const program = first.programs.find(({ id }) => id === "feature/worker/program/cloud");
    expect(program).toMatchObject({
      environment: { name: "server", platform: "server" },
      requires: [{ name: "numbers" }, { name: "output" }],
      start: { asynchronous: true },
    });
    expect(program?.start?.body.map(({ kind }) => kind)).toEqual(["let", "let", "for-of", "if"]);
  });

  test("semantic IDs do not depend on declaration order", async () => {
    const entry = await fixture(applicationSource());
    const original = compileApplication(entry);
    await writeFile(
      entry,
      applicationSource().replace("child: Child; worker: Worker", "worker: Worker; child: Child"),
    );
    const reordered = compileApplication(entry);

    expect(reordered.features.map(({ id }) => id)).toEqual(original.features.map(({ id }) => id));
    expect(reordered.programs.map(({ id }) => id)).toEqual(original.programs.map(({ id }) => id));
  });

  test("extracts deterministic Component state, actions, Elements, and lifecycle", async () => {
    const ir = compileApplication(await fixture(componentApplicationSource()));
    const component = ir.programs[0]?.ui?.components[0];

    expect(ir.programs[0]?.environment).toEqual({
      name: "browser-main",
      platform: "web",
      ui: "web",
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

  test("rejects undeclared runtime calls at their source location", async () => {
    const entry = await fixture(
      applicationSource().replace(
        "const values = await capabilities.numbers.read({ count: 4 });",
        "const values = [Date.now()];",
      ),
    );

    expect(() => compileApplication(entry)).toThrow(ApplicationDiagnostic);
    expect(() => compileApplication(entry)).toThrow(/may call only declared Capabilities/);
  });

  test("rejects any in portable Capability contracts", async () => {
    const entry = await fixture(
      applicationSource().replace("read(input: { count: number })", "read(input: any)"),
    );

    expect(() => compileApplication(entry)).toThrow(/cannot contain any/);
  });

  test("executes the extracted process through injected Capabilities", async () => {
    const ir = compileApplication(await fixture(applicationSource()));
    const writes: unknown[] = [];
    const execution = await executeProgramIR(ir, "feature/worker/program/cloud", {
      numbers: { read: async () => [1, 2, 3, 4] },
      output: {
        async write(input) {
          writes.push(input);
        },
      },
    });

    expect(execution.calls).toEqual(["numbers.read", "output.write"]);
    expect(writes).toEqual([{ category: "large", value: 10 }]);
  });

  test("preserves Capability failures from their implementation", async () => {
    const ir = compileApplication(await fixture(applicationSource()));
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
});

async function fixture(source: string): Promise<string> {
  const directory = await temporaryDirectory("poggers-ir-");
  const entry = resolve(directory, "app.ts");
  await writeFile(entry, source);
  return entry;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function applicationSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;

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

const child = { programs: { cloud: {} } } satisfies Feature<Child>;
const worker = {
  features: { child },
  programs: {
    cloud: {
      async start({ capabilities }: { capabilities: { numbers: Numbers; output: Output } }) {
        const values = await capabilities.numbers.read({ count: 4 });
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total >= 10) {
          await capabilities.output.write({ category: "large", value: total });
        } else {
          await capabilities.output.write({ category: "small", value: total });
        }
      },
    },
  },
} satisfies Feature<Worker>;

throw new Error("The compiler must never execute application source.");
export default {
  metadata: { name: "Portable fixture" },
  features: { child, worker },
} satisfies Application<App>;
`;
}

function componentApplicationSource(): string {
  return `
type UI = { readonly Name: string };
type Platform = { readonly Name: string; readonly UI?: UI };
type Environment = { readonly Name: string; readonly Platform: Platform; readonly UI?: UI };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;

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
type App = { Features: { shell: Shell }; Presentations: "clean" };

const shell = {
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
} satisfies Feature<Shell>;

export default {
  metadata: { name: "Component fixture" },
  features: { shell },
  presentations: { clean: {} },
} satisfies Application<App>;
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
