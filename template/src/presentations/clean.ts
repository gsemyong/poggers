import type { WebPresentation, WebPresentationTokens } from "@poggers/kit/web/presentation";
import type { App } from "src/app";

const parameters = {
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

const presentation = ((parameters) => ({
  Shell: {
    Application: () => ({
      Root: {
        layout: {
          flow: { axis: "block", align: "center", distribute: "center" },
          size: { block: { min: { viewport: { axis: "block", percent: 100 } } } },
          padding: parameters.space.page,
        },
        paint: { fill: parameters.color.canvas },
        typography: { font: parameters.font.body, color: parameters.color.text },
      },
      Title: { typography: { size: 32, weight: 650 } },
      Increment: {
        layout: { padding: { block: 12, inline: 18 } },
        shape: { radius: 999 },
        paint: { fill: parameters.color.text },
        typography: { color: parameters.color.canvas, weight: 650 },
      },
    }),
  },
})) satisfies WebPresentation<App, typeof parameters>;

export const clean = presentation(parameters);
