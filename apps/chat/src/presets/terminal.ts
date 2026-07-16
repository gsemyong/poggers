import type { Preset } from "@poggers/kit/preset";
import type { App } from "src/app";
import { createChatComponents, type ChatTokens } from "src/presets/chat";

const theme = {
  color: {
    canvas: { l: 0.1386, c: 0.0077, h: 255.5 },
    panel: { l: 0.1764, c: 0.0081, h: 181.88 },
    panelAlt: { l: 0.185, c: 0.0163, h: 124.67 },
    text: { l: 0.9656, c: 0.0513, h: 160.08 },
    muted: { l: 0.9147, c: 0.1405, h: 156.95 },
    accent: { l: 0.8385, c: 0.1319, h: 81.79 },
    success: { l: 0.7614, c: 0.1779, h: 153.55 },
    border: { l: 0.3717, c: 0.0607, h: 160.08 },
    field: { l: 0.1288, c: 0.0085, h: 157.12 },
    buttonText: { l: 0.1693, c: 0.0248, h: 154.85 },
    focus: { l: 0.84, c: 0.16, h: 155 },
  },
  space: {
    xs: { kind: "space", value: 4 },
    sm: { kind: "space", value: 8 },
    md: { kind: "space", value: 10 },
    lg: { kind: "space", value: 14 },
    xl: { kind: "space", value: 16 },
  },
  radius: { edge: { kind: "radius", value: 2 }, round: { kind: "radius", value: 2 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 980 },
    composerMin: { kind: "size", value: 64 },
    topbarButton: { kind: "size", value: 30 },
  },
  font: {
    body: { fallback: ["ui-monospace", "monospace"] },
    mono: { fallback: ["ui-monospace", "monospace"] },
  },
  shadow: {
    inset: {
      inset: true,
      spread: 1,
      color: { l: 0.7614, c: 0.1779, h: 153.55, alpha: 0.12 },
    },
    message: "none",
  },
  motion: {
    fast: { duration: 110, easing: "linear" },
  },
} satisfies ChatTokens;

export const terminalPreset = ((contract) => ({
  theme,
  components: { Shell: () => ({ Root: {} }) },
  features: {
    chat: { components: createChatComponents(contract, "terminal") },
  },
})) satisfies Preset<App, "terminal", typeof theme>;
