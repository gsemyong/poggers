import { expect, test } from "vitest";

import { dashboard } from "@/features/dashboard";

test("models reversible sheet interaction as explicit Feature state", () => {
  const program = dashboard.programs?.browser;
  if (!program) throw new Error("The dashboard browser Program is missing.");
  const state = structuredClone(program.state);
  const context = { dependencies: {}, features: {}, state };

  program.actions.openSheet(context);
  program.actions.beginSheetDrag(context);
  program.actions.updateSheetDrag(context, { offset: 72, velocity: 180 });
  expect(state.sheet).toEqual({
    status: "open",
    view: "summary",
    interaction: { kind: "dragging", offset: 72, velocity: 180 },
  });

  program.actions.releaseSheet(context, { offset: 180, velocity: 900 });
  expect(state.sheet).toEqual({
    status: "closed",
    view: "summary",
    via: { kind: "drag", offset: 180, velocity: 900 },
  });
});
