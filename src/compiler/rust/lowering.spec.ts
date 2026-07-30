import { expect, test } from "vitest";

import type {
  FunctionIR,
  PortableProgramExecutionIR,
  ProgramContributionIR,
  ProgramIR,
  TypeIR,
} from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { generateRustProgram } from "@/compiler/rust/lowering";

const span = { file: "feature.ts", line: 1, column: 1 };
const numberType: TypeIR = { kind: "primitive", name: "number" };

test("shares native helpers only when their reachable function graphs are equivalent", () => {
  const shared = functionIR("shared", 1);
  const equivalent = rustSource([execution("first", [shared]), execution("second", [shared])]);
  expect(functionCount(equivalent)).toBe(2);

  const dispatch = callFunction("dispatch", "target");
  const divergent = rustSource([
    execution("first", [dispatch, functionIR("target", 1)], "dispatch"),
    execution("second", [dispatch, functionIR("target", 2)], "dispatch"),
  ]);
  expect(functionCount(divergent)).toBe(6);
});

test("converges and shares equivalent recursive graphs with different local names", () => {
  const first = [
    callFunction("first-entry", "first-loop"),
    callFunction("first-loop", "first-entry"),
  ];
  const second = [
    callFunction("second-entry", "second-loop"),
    callFunction("second-loop", "second-entry"),
  ];
  const source = rustSource([
    execution("first", first, "first-entry"),
    execution("second", second, "second-entry"),
  ]);

  expect(functionCount(source)).toBe(2);
});

function rustSource(executions: readonly PortableProgramExecutionIR[]): string {
  const contributions = executions.map(
    (_, index): ProgramContributionIR => ({
      id: `feature/fixture-${index}/program/server`,
      feature: `fixture-${index}`,
      requires: [],
      provides: [],
      span,
    }),
  );
  const program: ProgramIR = {
    id: "program/server",
    name: "server",
    logicalName: "server",
    environment: { name: "server", platform: "server" },
    contributions,
  };
  const byContribution = new Map(
    contributions.map((contribution, index) => [contribution.id, executions[index]!]),
  );
  return generateRustProgram(linkProgram(program), (contribution) =>
    byContribution.get(contribution.id)!,
  );
}

function execution(
  name: string,
  functions: readonly FunctionIR[],
  target = "shared",
): PortableProgramExecutionIR {
  return {
    kind: "portable",
    entry: callFunction(`start-${name}`, target),
    functions,
  };
}

function callFunction(id: string, target: string): FunctionIR {
  return {
    id,
    name: id,
    asynchronous: false,
    captures: [],
    parameters: [],
    result: numberType,
    body: [
      {
        kind: "return",
        value: {
          kind: "call",
          function: target,
          arguments: [],
          awaited: false,
          type: numberType,
          span,
        },
        span,
      },
    ],
    span,
  };
}

function functionIR(id: string, value: number): FunctionIR {
  return {
    id,
    name: id,
    asynchronous: false,
    captures: [],
    parameters: [],
    result: numberType,
    body: [
      {
        kind: "return",
        value: { kind: "literal", value, type: numberType, span },
        span,
      },
    ],
    span,
  };
}

function functionCount(source: string): number {
  return source.match(/^fn function_/gm)?.length ?? 0;
}
