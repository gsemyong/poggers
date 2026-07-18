import type { PresentationRegistration } from "@poggers/kit/presentation";
import type { WebPresentation, WebPresentationTokens } from "@poggers/kit/presentation/web";
import type { App } from "src/app";

export const paperTheme = {
  color: {
    canvas: { l: 0.97, c: 0.012, h: 88 },
    panel: { l: 0.995, c: 0.006, h: 88 },
    text: { l: 0.25, c: 0.012, h: 255 },
    muted: { l: 0.54, c: 0.018, h: 70 },
    line: { l: 0.87, c: 0.018, h: 82 },
    accent: { l: 0.56, c: 0.16, h: 35 },
    accentText: { l: 0.99, c: 0.004, h: 88 },
  },
  space: {
    xs: { kind: "space", value: 6 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 16 },
    lg: { kind: "space", value: 24 },
    xl: { kind: "space", value: 32 },
  },
  size: {
    content: { kind: "size", value: 760 },
    message: { kind: "size", value: 620 },
    input: { kind: "size", value: 72 },
  },
  radius: {
    control: { kind: "radius", value: 8 },
    message: { kind: "radius", value: 6 },
  },
  font: {
    body: { fallback: ["system-ui", "sans-serif"] },
    label: { fallback: ["ui-monospace", "monospace"] },
  },
  shadow: {
    surface: {
      y: 10,
      blur: 36,
      color: { l: 0.28, c: 0.03, h: 60, alpha: 0.08 },
    },
  },
  motion: {
    control: { duration: 120, easing: "decelerate" },
  },
} as const satisfies WebPresentationTokens;

export const paperPresentation = ((tokens) => ({
  Shell: {
    Shell: () => ({
      Root: {
        layout: {
          flow: { axis: "block" },
          size: { block: { min: { viewport: { axis: "block", percent: 100 } } } },
        },
        paint: { fill: tokens.color.canvas },
        typography: { font: tokens.font.body, color: tokens.color.text },
      },
      Navigation: {
        layout: {
          flow: { axis: "inline", align: "center", gap: tokens.space.xs },
          padding: { block: tokens.space.sm, inline: tokens.space.lg },
        },
        paint: {
          fill: tokens.color.panel,
          stroke: { width: 1, line: "solid", color: tokens.color.line },
        },
      },
      ChatLink: {
        shape: { radius: tokens.radius.control },
        layout: { size: { block: 36 }, padding: { inline: tokens.space.md } },
        paint: { fill: tokens.color.canvas, cursor: "pointer" },
        typography: { color: tokens.color.text, weight: 650 },
      },
      AboutLink: {
        shape: { radius: tokens.radius.control },
        layout: { size: { block: 36 }, padding: { inline: tokens.space.md } },
        paint: { fill: tokens.color.canvas, cursor: "pointer" },
        typography: { color: tokens.color.text, weight: 650 },
      },
      Content: { layout: { item: { flex: { grow: 1, shrink: 1, basis: 0 } } } },
      About: {
        layout: {
          flow: { axis: "block", gap: tokens.space.md },
          size: { inline: { max: tokens.size.content } },
          padding: { block: tokens.space.xl, inline: tokens.space.lg },
        },
      },
      AboutTitle: { typography: { size: 26, weight: 720, line: 1.1 } },
      AboutText: { typography: { color: tokens.color.muted, line: 1.55, wrap: "pretty" } },
    }),
    Chat: {
      Chat({ state }) {
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.lg },
              size: { inline: { max: tokens.size.content }, block: "fill" },
              padding: { block: tokens.space.xl, inline: tokens.space.lg },
            },
          },
          Header: { layout: { flow: { axis: "block", gap: tokens.space.xs } } },
          Brand: { typography: { size: 26, weight: 720, line: 1.1 } },
          Summary: {
            typography: { color: tokens.color.muted, line: 1.5, wrap: "pretty" },
          },
          Messages: {
            layout: {
              flow: { axis: "block", gap: tokens.space.md },
              item: { flex: { grow: 1, shrink: 1, basis: 0 } },
              scroll: { block: "auto", overscroll: "contain" },
            },
          },
          Empty: { typography: { color: tokens.color.muted } },
          Composer: {
            layout: {
              grid: {
                columns: [{ minmax: [0, { fraction: 1 }] }, "content"],
                align: "end",
                gap: tokens.space.sm,
              },
            },
            conditions: [
              {
                when: { container: { inline: { max: 560 } } },
                use: { layout: { grid: { columns: [{ fraction: 1 }] } } },
              },
            ],
          },
          Input: {
            shape: { radius: tokens.radius.control },
            layout: {
              size: { inline: "fill", block: { min: tokens.size.input } },
              padding: tokens.space.md,
            },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
              shadow: tokens.shadow.surface,
            },
            typography: { line: 1.45, color: tokens.color.text },
          },
          Send: {
            shape: { radius: tokens.radius.control },
            layout: { size: { block: 44 }, padding: { inline: tokens.space.md } },
            paint: {
              fill: tokens.color.accent,
              cursor: state.sending || state.draft.trim().length === 0 ? "default" : "pointer",
              opacity: state.sending || state.draft.trim().length === 0 ? 0.45 : 1,
            },
            typography: { color: tokens.color.accentText, weight: 700 },
          },
          About: {
            layout: { size: { block: 36 }, padding: { inline: tokens.space.sm } },
            paint: { fill: tokens.color.panel, cursor: "pointer" },
            typography: { color: tokens.color.muted, size: 12, weight: 650 },
          },
          Status: {
            layout: { item: { grid: { column: 1 } } },
            paint: { opacity: state.sending ? 0.72 : 1 },
            typography: { font: tokens.font.label, size: 11, color: tokens.color.muted },
          },
        };
      },
      Message({ state }) {
        return {
          Root: {
            shape: { radius: tokens.radius.message },
            layout: {
              flow: { axis: "block", gap: tokens.space.xs },
              size: { inline: { max: tokens.size.message } },
              padding: { block: tokens.space.sm, inline: tokens.space.md },
            },
            paint: {
              fill: state.role === "user" ? tokens.color.canvas : tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
            },
          },
          Role: {
            typography: { font: tokens.font.label, size: 11, color: tokens.color.accent },
          },
          Text: { typography: { line: 1.55, wrap: "pretty" } },
        };
      },
    },
  },
})) satisfies WebPresentation<App, typeof paperTheme>;

export const paper = {
  presentation: paperPresentation,
  themes: { default: paperTheme },
} satisfies PresentationRegistration<typeof paperPresentation>;
