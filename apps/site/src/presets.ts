import type { Preset } from "@poggers/kit/style";
import type { App } from "types";

export const docsPreset = {
  tokens: {
    color: {
      canvas: { l: 0.974, c: 0.006, h: 255 },
      panel: { l: 1, c: 0, h: 0 },
      panelMuted: { l: 0.95, c: 0.008, h: 255 },
      text: { l: 0.185, c: 0.018, h: 258 },
      muted: { l: 0.48, c: 0.018, h: 258 },
      line: { l: 0.88, c: 0.012, h: 255 },
      accent: { l: 0.45, c: 0.15, h: 253 },
      accentSoft: { l: 0.92, c: 0.04, h: 253 },
      focus: { l: 0.62, c: 0.17, h: 250 },
    },
    space: { xs: 6, sm: 10, md: 16, lg: 24, xl: 40 },
    size: { sidebar: 232, content: 980, measure: 680 },
    radius: { control: 7, panel: 8 },
    shadow: {
      panel: { y: 16, blur: 50, spread: -28, color: { l: 0.2, c: 0.03, h: 255, alpha: 0.18 } },
    },
    font: {
      body: { families: ["Inter", "system-ui", "sans-serif"] },
      display: { families: ["Inter Display", "Inter", "system-ui", "sans-serif"] },
      mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
    },
    motion: {
      quick: { duration: 130, easing: "decelerate" },
      settle: { spring: { duration: 390, bounce: 0.02 } },
    },
  },
  themes: { default: {} },
  containers: { compact: { inlineBelow: 720 } },
  components: ({ tokens }) => ({
    SiteShell: () => ({
      Root: {
        layout: {
          kind: "grid",
          columns: [tokens.size.sidebar, { minmax: [0, { fraction: 1 }] }],
        },
        frame: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
        surface: { fill: tokens.color.canvas, text: tokens.color.text },
        text: { font: tokens.font.body },
        when: [
          {
            container: "compact",
            apply: { layout: { kind: "stack" } },
          },
        ],
      },
      Sidebar: {
        position: { kind: "sticky", inset: { blockStart: 0 } },
        layout: { kind: "stack", gap: tokens.space.lg },
        frame: { block: { max: { viewport: { axis: "block", percent: 1 } } } },
        padding: tokens.space.lg,
        surface: { fill: tokens.color.panel },
        stroke: { inlineEnd: { width: 1, line: "solid", color: tokens.color.line } },
        when: [
          {
            container: "compact",
            apply: {
              position: { kind: "relative", inset: { blockStart: 0 } },
              frame: { block: "auto" },
              stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
            },
          },
        ],
      },
      Brand: {
        surface: { text: tokens.color.text },
        text: { font: tokens.font.display, size: 17, weight: 720 },
      },
      Nav: { layout: { kind: "stack", gap: tokens.space.xs } },
      Content: {
        layout: { kind: "grid", distribute: "center" },
        padding: { block: tokens.space.xl, inline: tokens.space.xl },
        when: [
          {
            container: "compact",
            apply: { padding: { block: tokens.space.lg, inline: tokens.space.md } },
          },
        ],
      },
    }),
    NavButton: () => ({
      Root: {
        layout: { kind: "row", align: "center" },
        frame: { inline: "fill", block: 38 },
        padding: { inline: tokens.space.sm },
        surface: { fill: "transparent", text: tokens.color.muted },
        stroke: { width: 1, line: "solid", color: "transparent" },
        shape: { radius: tokens.radius.control },
        text: { size: 14, weight: 570, align: "start" },
        interaction: {
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 2, offset: 1 },
        },
        when: [
          {
            variant: { active: "yes" },
            apply: {
              surface: { fill: tokens.color.accentSoft, text: tokens.color.text },
              stroke: { color: tokens.color.line },
            },
          },
          {
            native: "hover",
            apply: { surface: { fill: tokens.color.panelMuted, text: tokens.color.text } },
          },
          { native: "active", apply: { transform: { scale: 0.985 } } },
        ],
        motion: {
          change: { transform: tokens.motion.quick },
        },
      },
    }),
    PageHero: () => ({
      Root: {
        layout: { kind: "stack", gap: tokens.space.lg },
        frame: { inline: { max: tokens.size.content } },
        motion: {
          enter: {
            from: { effect: { opacity: 0 }, transform: { block: 10 } },
            using: tokens.motion.settle,
          },
        },
      },
      Mark: {
        layout: { kind: "row", align: "center", distribute: "center" },
        frame: { inline: 42, block: 42 },
        surface: { fill: tokens.color.text, text: tokens.color.panel },
        shape: { radius: tokens.radius.control },
        text: { font: tokens.font.mono, size: 12, weight: 760 },
      },
      Eyebrow: {
        margin: 0,
        surface: { text: tokens.color.accent },
        text: { font: tokens.font.mono, size: 12, weight: 700, transform: "uppercase" },
      },
      Title: {
        margin: 0,
        text: { font: tokens.font.display, size: 48, weight: 760, line: 1.02, wrap: "balance" },
        when: [{ container: "compact", apply: { text: { size: 36 } } }],
      },
      Summary: {
        frame: { inline: { max: tokens.size.measure } },
        margin: 0,
        surface: { text: tokens.color.muted },
        text: { size: 18, line: 1.55, wrap: "pretty" },
      },
      Sections: {
        layout: {
          kind: "grid",
          columns: [{ minmax: [220, { fraction: 1 }] }, { minmax: [220, { fraction: 1 }] }],
          gap: tokens.space.md,
        },
        margin: { blockStart: tokens.space.sm },
        when: [
          { container: "compact", apply: { layout: { kind: "stack", gap: tokens.space.md } } },
        ],
      },
    }),
    SectionCard: () => ({
      Root: {
        layout: { kind: "stack", gap: tokens.space.sm },
        padding: tokens.space.lg,
        surface: { fill: tokens.color.panel },
        stroke: { width: 1, line: "solid", color: tokens.color.line },
        shape: { radius: tokens.radius.panel },
        effect: { shadow: tokens.shadow.panel },
      },
      Title: { margin: 0, text: { font: tokens.font.display, size: 16, weight: 700 } },
      Body: {
        margin: 0,
        surface: { text: tokens.color.muted },
        text: { size: 14, line: 1.55, wrap: "pretty" },
      },
    }),
  }),
} satisfies Preset<App, "docs">;
