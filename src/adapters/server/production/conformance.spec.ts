import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, expect, test } from "vitest";

import {
  buildRustProgram,
  createRustProgramSession,
} from "@/adapters/server/production/fixtures/conformance";
import { compileApplication } from "@/compiler/source";
import { executeProgramFixtureIR } from "@/runtime/interpreter";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("keeps canonical operators and traces equivalent across JavaScript and Rust", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-rust-conformance-"));
  temporaryDirectories.push(directory);
  const entry = resolve(directory, "app.ts");
  await writeFile(entry, conformanceSource());
  const ir = compileApplication(entry);
  const contribution = ir.programs[0]!.contributions[0]!;
  const executable = resolve(directory, "conformance");
  await buildRustProgram(contribution, executable);
  await using native = await createRustProgramSession(executable);

  type Input = Readonly<{
    left: number;
    right: number;
    first: boolean;
    second: boolean;
    prefix: string;
    suffix: string;
    nested: Readonly<{ value: number; label: string }>;
  }>;
  const verify = async (input: Input) => {
    const scenario = {
      responses: {
        "input.read": [{ ok: input }],
        "output.write": [{ ok: null }],
      },
    };
    const [javascript, rust] = await Promise.all([
      executeProgramFixtureIR(ir, contribution.id, scenario),
      native.run(scenario),
    ]);
    expect(rust).toEqual(javascript);
  };

  await verify({
    left: 0,
    right: 1,
    first: false,
    second: false,
    prefix: "\u2028",
    suffix: "\u2029",
    nested: { value: 0, label: "\0" },
  });

  await fc.assert(
    fc.asyncProperty(
      fc.record({
        left: fc.integer({ min: -10_000, max: 10_000 }),
        right: fc.integer({ min: -10_000, max: 10_000 }).filter((value) => value !== 0),
        first: fc.boolean(),
        second: fc.boolean(),
        prefix: fc.string({ unit: "grapheme", maxLength: 12 }),
        suffix: fc.string({ unit: "grapheme", maxLength: 12 }),
        nested: fc.record({ value: fc.integer(), label: fc.string({ maxLength: 8 }) }),
      }),
      verify,
    ),
    { numRuns: 60 },
  );
}, 120_000);

function conformanceSource(): string {
  return `
type Platform = { readonly Name: string };
type Environment = { readonly Name: string; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;

type Input = {
  left: number;
  right: number;
  first: boolean;
  second: boolean;
  prefix: string;
  suffix: string;
  nested: { value: number; label: string };
};
type Result = {
  sum: number;
  difference: number;
  product: number;
  quotient: number;
  remainder: number;
  equal: boolean;
  different: boolean;
  less: boolean;
  lessOrEqual: boolean;
  greater: boolean;
  greaterOrEqual: boolean;
  both: boolean;
  either: boolean;
  inverse: boolean;
  negative: number;
  text: string;
  assigned: number;
  nestedValue: number;
  nestedLabel: string;
  nanEqual: boolean;
  signedZeroEqual: boolean;
  infinityGreater: boolean;
  nan: number;
  positiveInfinity: number;
  negativeInfinity: number;
  negativeZero: number;
};
type Worker = {
  Programs: {
    worker: Program<
      { Name: "server"; Platform: { Name: "server" } },
      {
        Requires: {
          input: { read(input: {}): Promise<Input> };
          output: { write(input: Result): Promise<void> };
        };
      }
    >;
  };
};
type App = { Features: { worker: Worker } };

const worker = {
  programs: {
    worker: {
      async start({ dependencies }: {
        dependencies: {
          input: { read(input: {}): Promise<Input> };
          output: { write(input: Result): Promise<void> };
        };
      }) {
        const value = await dependencies.input.read({});
        let assigned = value.left;
        assigned += 2;
        assigned -= 1;
        assigned *= 3;
        assigned /= 3;
        const result = {
          sum: value.left + value.right,
          difference: value.left - value.right,
          product: value.left * value.right,
          quotient: value.left / value.right,
          remainder: value.left % value.right,
          equal: value.left === value.right,
          different: value.left !== value.right,
          less: value.left < value.right,
          lessOrEqual: value.left <= value.right,
          greater: value.left > value.right,
          greaterOrEqual: value.left >= value.right,
          both: value.first && value.second,
          either: value.first || value.second,
          inverse: !value.first,
          negative: -value.left,
          text: value.prefix + value.suffix,
          assigned,
          nestedValue: value.nested.value,
          nestedLabel: value.nested.label,
          nanEqual: (0 / 0) === (0 / 0),
          signedZeroEqual: -0 === 0,
          infinityGreater: (1 / 0) > value.left,
          nan: 0 / 0,
          positiveInfinity: 1 / 0,
          negativeInfinity: -1 / 0,
          negativeZero: -0,
        };
        await dependencies.output.write(result);
      },
    },
  },
} satisfies Feature<Worker>;

export default { features: { worker } } satisfies Application<App>;
`;
}
