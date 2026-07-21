import { describe, expect, test } from "vitest";

import { transformComponentSource } from "@/adapters/web/ui/component/compiler";

describe("component compiler", () => {
  test("lowers reactive component reads and strips presentation factories from the browser app", () => {
    const output = transformComponentSource(
      `export default {
        ui: {
          components: {
            Counter: {
              state: { count: 0 },
              view({ state, actions, elements: { Root } }) {
                return <Root onClick={actions.increment}>{state.count}</Root>;
              },
            },
          },
        },
        presentations: { clean: () => ({}) },
      };`,
      "app.tsx",
      { stripPresentations: true },
    );

    expect(output).toContain("state: { count: 0 }");
    expect(output).toContain("() => __poggersView.state.count");
    expect(output).not.toContain("presentations:");
  });

  test("rejects view-local snapshots of reactive scope", () => {
    expect(() =>
      transformComponentSource(
        `export default { ui: { components: { Counter: {
          view({ state, elements: { Root } }) {
            const disabled = state.count === 0;
            return <Root aria-disabled={disabled}>{state.count}</Root>;
          },
        } } } };`,
        "app.tsx",
      ),
    ).toThrow("snapshots reactive disabled");
  });
});
