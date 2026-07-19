import { expect, it } from "vitest";

import type { Program } from "../../../core/application";
import type { BrowserMainThread } from "../platform";
import type { WebPresentation, WebStyle } from "./language";

type Fixture = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Components: {
          Drawer: {
            State: { open: boolean; selected: boolean };
            Elements: { Root: "main"; Panel: "dialog"; Close: "button" };
          };
        };
      }
    >;
  };
};

const parameters = {
  color: {
    panel: { oklch: [0.99, 0.002, 250] },
    content: { oklch: [0.2, 0.01, 250] },
  },
  space: { panel: 24, control: 12 },
  radius: { panel: 28 },
} as const;

const presentation = ((values) => {
  const control = (selected: boolean): WebStyle => ({
    layout: { padding: { block: values.space.control, inline: values.space.panel } },
    paint: { opacity: selected ? 0.7 : 1 },
  });

  return {
    Drawer: ({ state }) => ({
      Root: {
        layout: { model: { kind: state.open ? "overlay" : "hidden" } },
      },
      Panel: {
        layout: {
          model: { kind: "flow", direction: "block", gap: values.space.control },
          inlineSize: { percent: 100 },
          maxInlineSize: 420,
          padding: values.space.panel,
          container: { name: "drawer", axis: "inline" },
        },
        paint: { fill: values.color.panel, radius: values.radius.panel },
        text: { color: values.color.content, family: "system" },
        rules: [
          {
            when: { container: { name: "drawer", maxInlineSize: 360 } },
            use: { layout: { padding: values.space.control } },
          },
        ],
      },
      Close: control(state.selected),
    }),
  };
}) satisfies WebPresentation<Fixture, typeof parameters>;

it("types arbitrary parameters, Component state, Elements, and native conditions", () => {
  expect(presentation).toBeTypeOf("function");
});
