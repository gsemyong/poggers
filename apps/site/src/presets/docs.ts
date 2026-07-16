import type { Preset, Tokens } from "@poggers/kit/preset";
import type { App } from "src/app";
const theme = {
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
  space: {
    xs: { kind: "space", value: 6 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 16 },
    lg: { kind: "space", value: 24 },
    xl: { kind: "space", value: 40 },
  },
  size: {
    compact: { kind: "size", value: 720 },
    sidebar: { kind: "size", value: 232 },
    content: { kind: "size", value: 980 },
    measure: { kind: "size", value: 680 },
  },
  radius: {
    control: { kind: "radius", value: 7 },
    panel: { kind: "radius", value: 8 },
  },
  shadow: {
    panel: { y: 16, blur: 50, spread: -28, color: { l: 0.2, c: 0.03, h: 255, alpha: 0.18 } },
  },
  font: {
    body: { fallback: ["ui-sans-serif", "system-ui", "sans-serif"] },
    display: { fallback: ["ui-sans-serif", "system-ui", "sans-serif"] },
    mono: { fallback: ["ui-monospace", "monospace"] },
  },
  motion: { quick: { duration: 130, easing: "decelerate" } },
} satisfies Tokens;
export const docsPreset = (({ tokens, createRecipe }) => {
  const createNavigationItem = createRecipe({
    base: {
      shape: { radius: tokens.radius.control },
      layout: {
        flow: { axis: "inline", align: "center" },
        size: { inline: "fill", block: 38 },
        padding: { inline: tokens.space.sm },
      },
      paint: {
        fill: "transparent",
        stroke: { width: 1, line: "solid", color: "transparent" },
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 1 },
      },
      typography: {
        size: 14,
        weight: 570,
        align: "start",
        color: tokens.color.muted,
      },
      motion: {
        transition: { transform: tokens.motion.quick },
      },
    },
    variants: {
      active: {
        true: {
          paint: {
            fill: tokens.color.accentSoft,
            stroke: { color: tokens.color.line },
          },
          typography: {
            color: tokens.color.text,
          },
        },
        false: {},
      },
      hovered: {
        true: {
          paint: {
            fill: tokens.color.panelMuted,
          },
          typography: {
            color: tokens.color.text,
          },
        },
        false: {},
      },
      pressed: {
        true: {
          motion: {
            scale: 0.985,
          },
        },
        false: {},
      },
    },
    defaults: { hovered: false, pressed: false },
  });
  return {
    theme,
    components: {
      SiteShell({ geometry }) {
        const compact = geometry.inlineSize.isBelow(tokens.size.compact);
        return {
          Root: [
            {
              layout: {
                grid: {
                  columns: [tokens.size.sidebar, { minmax: [0, { fraction: 1 }] }],
                },
                size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
              },
              paint: {
                fill: tokens.color.canvas,
              },
              typography: {
                font: tokens.font.body,
                color: tokens.color.text,
              },
            },
            {
              when: compact,
              layout: {
                flow: { axis: "block" },
              },
            },
          ],
          Sidebar: [
            {
              layout: {
                flow: { axis: "block", gap: tokens.space.lg },
                size: { block: { max: { viewport: { axis: "block", percent: 1 } } } },
                padding: tokens.space.lg,
                position: { kind: "sticky", inset: { blockStart: 0 } },
              },
              paint: {
                fill: tokens.color.panel,
                stroke: { inlineEnd: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
            {
              when: compact,
              layout: {
                size: { block: "auto" },
                position: { kind: "relative", inset: { blockStart: 0 } },
              },
              paint: {
                stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
          ],
          Brand: {
            typography: {
              font: tokens.font.display,
              size: 17,
              weight: 720,
              color: tokens.color.text,
            },
          },
          Nav: {
            layout: {
              flow: { axis: "block", gap: tokens.space.xs },
            },
          },
          Content: [
            {
              layout: {
                grid: {
                  columns: [{ minmax: [0, tokens.size.content] }],
                  distribute: "center",
                },
                padding: { block: tokens.space.xl, inline: tokens.space.xl },
              },
            },
            {
              when: compact,
              layout: {
                padding: { block: tokens.space.lg, inline: tokens.space.md },
              },
            },
          ],
        };
      },
      NavButton({ state, interaction }) {
        return {
          Root: createNavigationItem({
            active: state.active,
            hovered: interaction.hovered,
            pressed: interaction.pressed,
          }),
        };
      },
      PageHero({ geometry }) {
        const compact = geometry.inlineSize.isBelow(tokens.size.compact);
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.lg },
              size: { inline: "fill" },
            },
          },
          Mark: {
            shape: { radius: tokens.radius.control },
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 42, block: 42 },
            },
            paint: {
              fill: tokens.color.text,
            },
            typography: {
              font: tokens.font.mono,
              size: 12,
              weight: 760,
              color: tokens.color.panel,
            },
          },
          Eyebrow: {
            layout: {
              margin: 0,
            },
            typography: {
              font: tokens.font.mono,
              size: 12,
              weight: 700,
              transform: "uppercase",
              color: tokens.color.accent,
            },
          },
          Title: [
            {
              layout: {
                margin: 0,
              },
              typography: {
                font: tokens.font.display,
                size: 48,
                weight: 760,
                line: 1.02,
                wrap: "balance",
              },
            },
            {
              when: compact,
              typography: {
                size: 36,
              },
            },
          ],
          Summary: {
            layout: {
              size: { inline: { max: tokens.size.measure } },
              margin: 0,
            },
            typography: {
              size: 18,
              line: 1.55,
              wrap: "pretty",
              color: tokens.color.muted,
            },
          },
          Sections: [
            {
              layout: {
                grid: {
                  columns: [{ minmax: [220, { fraction: 1 }] }, { minmax: [220, { fraction: 1 }] }],
                  gap: tokens.space.md,
                },
                margin: { blockStart: tokens.space.sm },
              },
            },
            {
              when: compact,
              layout: {
                flow: { axis: "block", gap: tokens.space.md },
              },
            },
          ],
        };
      },
      SectionCard() {
        return {
          Root: {
            shape: { radius: tokens.radius.panel },
            layout: {
              flow: { axis: "block", gap: tokens.space.sm },
              padding: tokens.space.lg,
            },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
              shadow: tokens.shadow.panel,
            },
          },
          Title: {
            layout: {
              margin: 0,
            },
            typography: {
              font: tokens.font.display,
              size: 16,
              weight: 700,
            },
          },
          Body: {
            layout: {
              margin: 0,
            },
            typography: {
              size: 14,
              line: 1.55,
              wrap: "pretty",
              color: tokens.color.muted,
            },
          },
        };
      },
    },
  };
}) satisfies Preset<App, "docs", typeof theme>;
