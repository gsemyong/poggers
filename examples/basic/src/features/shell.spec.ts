import { expect, test } from "vitest";

import { shell } from "@/features/shell";

test("increments the visible counter state", () => {
  const program = shell.programs?.browser;
  if (!program) throw new Error("The shell browser Program is missing.");
  const state = structuredClone(program.state);

  expect(state).toEqual({ count: 0 });
  program.actions.increment({ dependencies: {}, features: {}, state });
  expect(state).toEqual({ count: 1 });
});
