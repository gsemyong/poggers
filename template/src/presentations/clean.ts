import type { PresentationRegistration } from "@poggers/kit/presentation";
import type { WebPresentation, WebPresentationTokens } from "@poggers/kit/web/presentation";
import type { App } from "src/app";

const theme = {
  color: {
    canvas: { l: 0.98, c: 0.004, h: 250 },
    text: { l: 0.2, c: 0.01, h: 250 },
  },
  space: {
    page: { kind: "space", value: 24 },
  },
  font: {
    body: { fallback: ["system-ui", "sans-serif"] },
  },
} as const satisfies WebPresentationTokens;

const presentation = ((tokens) => ({
  Shell: {
    Application: () => ({
      Root: {
        layout: {
          flow: { axis: "block", align: "center", distribute: "center" },
          size: { block: { min: { viewport: { axis: "block", percent: 100 } } } },
          padding: tokens.space.page,
        },
        paint: { fill: tokens.color.canvas },
        typography: { font: tokens.font.body, color: tokens.color.text },
      },
      Title: { typography: { size: 32, weight: 650 } },
    }),
  },
})) satisfies WebPresentation<App, typeof theme>;

export const clean = {
  presentation,
  themes: { default: theme },
} satisfies PresentationRegistration<typeof presentation>;
