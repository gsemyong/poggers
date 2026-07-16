import type { Preset } from "@poggers/kit/preset";
import type { App } from "src/app";
import { createChatComponents, type ChatTokens } from "src/presets/chat";

const theme = {
  color: {
    canvas: { l: 0.987, c: 0.002, h: 255 },
    panel: { l: 1, c: 0, h: 0 },
    panelAlt: { l: 0.964, c: 0.003, h: 255 },
    text: { l: 0.192, c: 0.004, h: 255 },
    muted: { l: 0.52, c: 0.004, h: 255 },
    accent: { l: 0.24, c: 0.004, h: 255 },
    success: { l: 0.32, c: 0.004, h: 255 },
    border: { l: 0.89, c: 0.004, h: 255 },
    field: { l: 1, c: 0, h: 0 },
    buttonText: { l: 0.995, c: 0.001, h: 255 },
    focus: { l: 0.56, c: 0.1, h: 250 },
  },
  space: {
    xs: { kind: "space", value: 6 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 14 },
    lg: { kind: "space", value: 20 },
    xl: { kind: "space", value: 28 },
  },
  radius: { edge: { kind: "radius", value: 8 }, round: { kind: "radius", value: 999 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 840 },
    composerMin: { kind: "size", value: 76 },
    topbarButton: { kind: "size", value: 32 },
  },
  font: {
    body: { fallback: ["ui-sans-serif", "system-ui", "sans-serif"] },
    mono: { fallback: ["ui-monospace", "monospace"] },
  },
  shadow: {
    inset: {
      inset: true,
      y: 1,
      color: { l: 0.192, c: 0.004, h: 255, alpha: 0.08 },
    },
    message: "none",
  },
  motion: {
    fast: { duration: 140, easing: "decelerate" },
  },
} satisfies ChatTokens;

export const monoPreset = ((contract) => ({
  theme,
  components: { Shell: () => ({ Root: {} }) },
  features: {
    chat: { components: createChatComponents(contract, "mono") },
  },
})) satisfies Preset<App, "mono", typeof theme>;
