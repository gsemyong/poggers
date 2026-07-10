import type { Preset } from "@poggers/kit/style";
import type { App } from "types";

type PaperTokens = Parameters<Preset<App, "paper">["components"]>[0]["tokens"];
type ChatComponents = ReturnType<Preset<App, "paper">["components"]>;
type Direction = "paper" | "mono" | "terminal";

const paperTokens = {
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
  space: { xs: 7, sm: 10, md: 14, lg: 22, xl: 24 },
  radius: { sm: 3, md: 8, round: 999 },
  size: { messageMax: 780, composerMin: 86, topbarButton: 34 },
  font: {
    body: { families: ["Georgia", "Times New Roman", "serif"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    soft: { y: 8, blur: 28, color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 } },
    inset: {
      inset: true,
      y: 1,
      blur: 4,
      color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 },
    },
    none: "none",
  },
  motion: {
    fast: { duration: 160, easing: "decelerate" },
    settle: { spring: { duration: 420, bounce: 0.04 } },
  },
} as const;

const monoTokens = {
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
  space: { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 },
  radius: { sm: 6, md: 8, round: 999 },
  size: { messageMax: 840, composerMin: 76, topbarButton: 32 },
  font: {
    body: { families: ["Inter", "system-ui", "sans-serif"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    soft: { y: 12, blur: 36, color: { l: 0.192, c: 0.004, h: 255, alpha: 0.06 } },
    inset: {
      inset: true,
      y: 1,
      color: { l: 0.192, c: 0.004, h: 255, alpha: 0.08 },
    },
    none: "none",
  },
  motion: {
    fast: { duration: 140, easing: "decelerate" },
    settle: { spring: { duration: 360, bounce: 0 } },
  },
} as const;

const terminalTokens = {
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
  space: { xs: 4, sm: 8, md: 10, lg: 14, xl: 16 },
  radius: { sm: 2, md: 2, round: 2 },
  size: { messageMax: 980, composerMin: 64, topbarButton: 30 },
  font: {
    body: { families: ["SFMono-Regular", "Consolas", "monospace"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    soft: "none",
    inset: {
      inset: true,
      spread: 1,
      color: { l: 0.7614, c: 0.1779, h: 153.55, alpha: 0.12 },
    },
    none: "none",
  },
  motion: {
    fast: { duration: 110, easing: "linear" },
    settle: { spring: { duration: 300, bounce: 0 } },
  },
} as const;

function chatComponents(tokens: PaperTokens, direction: Direction): ChatComponents {
  const terminal = direction === "terminal";
  const mono = direction === "mono";
  const edge = terminal ? tokens.radius.sm : tokens.radius.md;
  const messageFill = mono ? "transparent" : tokens.color.panel;
  const messageShadow = direction === "paper" ? tokens.shadow.soft : tokens.shadow.none;

  return {
    ChatLayout: () => ({
      Root: {
        layout: { kind: "stack" },
        frame: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
        surface: { fill: tokens.color.canvas, text: tokens.color.text },
        text: { font: tokens.font.body },
      },
      Topbar: {
        layout: { kind: "row", align: "center", distribute: "between", gap: tokens.space.md },
        padding: { block: tokens.space.md, inline: tokens.space.lg },
        surface: { fill: tokens.color.panel },
        stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.border } },
        effect: { shadow: direction === "paper" ? tokens.shadow.soft : tokens.shadow.none },
      },
      Brand: { layout: { kind: "row", align: "center", gap: tokens.space.sm } },
      BrandMark: {
        layout: { kind: "row", align: "center", distribute: "center" },
        frame: { inline: { min: tokens.size.topbarButton }, block: tokens.size.topbarButton },
        padding: { inline: tokens.space.xs },
        surface: {
          fill: terminal ? tokens.color.success : mono ? tokens.color.text : tokens.color.panel,
          text: terminal || mono ? tokens.color.buttonText : tokens.color.accent,
        },
        stroke: {
          width: 1,
          line: "solid",
          color: terminal ? tokens.color.success : mono ? tokens.color.text : tokens.color.accent,
        },
        shape: { radius: terminal ? tokens.radius.sm : tokens.radius.round },
        text: { font: tokens.font.mono, size: 12, weight: 800, line: 1 },
      },
      BrandText: {
        surface: { text: tokens.color.muted },
        text: { size: terminal ? 13 : 15, line: 1.3 },
      },
      PresetSwitch: {
        frame: { block: { min: tokens.size.topbarButton } },
        padding: { inline: tokens.space.md },
        surface: {
          fill: terminal ? tokens.color.panelAlt : tokens.color.panel,
          text: terminal ? tokens.color.accent : tokens.color.success,
        },
        stroke: {
          width: 1,
          line: "solid",
          color: terminal ? tokens.color.accent : tokens.color.success,
        },
        shape: { radius: terminal ? tokens.radius.sm : tokens.radius.round },
        text: { font: tokens.font.mono, size: 12, weight: 700 },
        interaction: {
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
        },
        when: [
          { native: "hover", apply: { effect: { opacity: 0.78 } } },
          { native: "active", apply: { transform: { scale: 0.97 } } },
        ],
        motion: { change: { opacity: tokens.motion.fast, transform: tokens.motion.fast } },
      },
      Messages: {
        layout: { kind: "stack", gap: terminal ? tokens.space.md : tokens.space.lg },
        place: { flex: { grow: 1, shrink: 1, basis: 0 } },
        padding: { block: tokens.space.xl, inline: tokens.space.lg },
        surface: { fill: tokens.color.canvas },
        scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
        when: [
          {
            container: "compact",
            apply: {
              padding: { block: tokens.space.md, inline: tokens.space.md },
              layout: { kind: "stack", gap: tokens.space.sm },
            },
          },
        ],
      },
      Empty: {
        padding: tokens.space.lg,
        surface: { fill: tokens.color.panel, text: tokens.color.muted },
        stroke: { width: 1, line: terminal ? "solid" : "dash", color: tokens.color.border },
        shape: { radius: edge },
        text: { line: 1.55, wrap: "pretty" },
      },
      Status: {
        layout: { kind: "row", distribute: "between", gap: tokens.space.md },
        padding: { block: tokens.space.xs, inline: tokens.space.lg },
        surface: { fill: tokens.color.panelAlt },
        stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
        text: { font: tokens.font.mono, size: terminal ? 12 : 13 },
      },
      StatusText: { surface: { text: tokens.color.success } },
      StatusMeta: { surface: { text: terminal ? tokens.color.accent : tokens.color.muted } },
      Understanding: {
        frame: { block: { max: terminal ? 72 : 80 } },
        padding: { block: tokens.space.sm, inline: tokens.space.lg },
        surface: { fill: tokens.color.panelAlt, text: tokens.color.muted },
        stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
        scroll: { block: "auto" },
        text: { size: terminal ? 12 : 13 },
      },
      Composer: {
        padding: { block: tokens.space.md, inline: tokens.space.lg },
        surface: { fill: tokens.color.panel },
        stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
      },
    }),
    ChatMessage: () => ({
      Root: {
        layout: { kind: "stack", gap: tokens.space.xs },
        frame: { inline: { max: tokens.size.messageMax } },
        padding: { block: tokens.space.sm, inline: tokens.space.md },
        surface: { fill: messageFill },
        stroke: { width: 1, line: "solid", color: mono ? "transparent" : tokens.color.border },
        shape: { radius: edge },
        effect: { shadow: messageShadow },
        when: [
          {
            variant: { role: "user" },
            apply: {
              surface: { fill: mono ? tokens.color.panelAlt : messageFill },
              stroke: { color: tokens.color.success },
            },
          },
          { variant: { streaming: "yes" }, apply: { stroke: { color: tokens.color.accent } } },
        ],
        motion: {
          enter: {
            from: { effect: { opacity: 0 }, transform: { block: 8 } },
            using: tokens.motion.settle,
          },
        },
      },
      Role: {
        surface: { text: tokens.color.accent },
        text: { font: tokens.font.mono, size: terminal ? 12 : 13, weight: 700 },
      },
      Content: {
        surface: { text: tokens.color.text },
        text: { size: terminal ? 13 : 15, line: terminal ? 1.45 : 1.6, wrap: "wrap" },
      },
    }),
    Composer: () => ({
      Root: {
        layout: {
          kind: "grid",
          columns: [{ minmax: [0, { fraction: 1 }] }, "content"],
          align: "end",
          gap: tokens.space.sm,
        },
      },
      Input: {
        frame: { inline: "fill", block: { min: tokens.size.composerMin } },
        padding: tokens.space.md,
        surface: { fill: tokens.color.field, text: tokens.color.text },
        stroke: {
          width: 1,
          line: "solid",
          color: terminal ? tokens.color.success : tokens.color.border,
        },
        shape: { radius: edge },
        effect: { shadow: tokens.shadow.inset },
        text: { font: tokens.font.body, line: 1.45 },
        interaction: { focusRing: { color: tokens.color.focus, width: 2, offset: 1 } },
      },
      Send: {
        frame: { block: { min: terminal ? 36 : 42 } },
        padding: { inline: tokens.space.md },
        surface: {
          fill: terminal ? tokens.color.panelAlt : mono ? tokens.color.text : tokens.color.success,
          text: terminal ? tokens.color.accent : tokens.color.buttonText,
        },
        stroke: {
          width: 1,
          line: "solid",
          color: terminal ? tokens.color.accent : mono ? tokens.color.text : tokens.color.success,
        },
        shape: { radius: edge },
        text: { font: tokens.font.body, weight: 800 },
        interaction: {
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
        },
        when: [
          { native: "hover", apply: { effect: { opacity: 0.8 } } },
          { native: "active", apply: { transform: { scale: 0.97 } } },
          {
            native: "disabled",
            apply: { effect: { opacity: 0.45 }, interaction: { cursor: "default" } },
          },
        ],
        motion: { change: { opacity: tokens.motion.fast, transform: tokens.motion.fast } },
      },
    }),
    AIPart: () => ({
      Root: {
        surface: { text: terminal ? tokens.color.muted : tokens.color.text },
        text: { size: terminal ? 13 : 15, line: terminal ? 1.45 : 1.6 },
      },
      Item: { margin: { inlineStart: tokens.space.md }, text: { line: 1.55 } },
    }),
  };
}

export const paperPreset = {
  tokens: paperTokens,
  themes: { default: {} },
  containers: { compact: { inlineBelow: 672 } },
  components: ({ tokens }) => chatComponents(tokens, "paper"),
} satisfies Preset<App, "paper">;

export const monoPreset = {
  tokens: monoTokens,
  themes: { default: {} },
  containers: { compact: { inlineBelow: 672 } },
  components: ({ tokens }) => chatComponents(tokens, "mono"),
} satisfies Preset<App, "mono">;

export const terminalPreset = {
  tokens: terminalTokens,
  themes: { default: {} },
  containers: { compact: { inlineBelow: 672 } },
  components: ({ tokens }) => chatComponents(tokens, "terminal"),
} satisfies Preset<App, "terminal">;
