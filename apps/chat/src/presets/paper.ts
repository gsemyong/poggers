import type { Preset } from "@poggers/kit/preset";
import type { App } from "src/app";
import { createChatComponents, type ChatTokens } from "src/presets/chat";

const theme = {
  color: {
    canvas: { l: 0.9588, c: 0.0127, h: 86.83 },
    panel: { l: 0.9862, c: 0.0142, h: 84.58 },
    panelAlt: { l: 0.9186, c: 0.0235, h: 82.12 },
    text: { l: 0.2635, c: 0.0103, h: 260.7 },
    muted: { l: 0.4638, c: 0.0237, h: 69.62 },
    accent: { l: 0.504, c: 0.1426, h: 32.4 },
    success: { l: 0.6094, c: 0.078, h: 161.08 },
    border: { l: 0.8488, c: 0.0297, h: 82.59 },
    field: { l: 0.9939, c: 0.0082, h: 91.48 },
    buttonText: { l: 0.9862, c: 0.0142, h: 84.58 },
    focus: { l: 0.58, c: 0.16, h: 35 },
  },
  space: {
    xs: { kind: "space", value: 7 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 14 },
    lg: { kind: "space", value: 22 },
    xl: { kind: "space", value: 24 },
  },
  radius: { edge: { kind: "radius", value: 8 }, round: { kind: "radius", value: 999 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 780 },
    composerMin: { kind: "size", value: 86 },
    topbarButton: { kind: "size", value: 34 },
  },
  font: {
    body: { fallback: ["ui-serif", "serif"] },
    mono: { fallback: ["ui-monospace", "monospace"] },
  },
  shadow: {
    message: {
      y: 8,
      blur: 28,
      color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 },
    },
    inset: {
      inset: true,
      y: 1,
      blur: 4,
      color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 },
    },
  },
  motion: {
    fast: { duration: 160, easing: "decelerate" },
  },
} satisfies ChatTokens;

export const paperPreset = ((contract) => ({
  theme,
  components: { Shell: () => ({ Root: {} }) },
  features: {
    chat: { components: createChatComponents(contract, "paper") },
  },
})) satisfies Preset<App, "paper", typeof theme>;
