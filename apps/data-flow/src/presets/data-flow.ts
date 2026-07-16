import type { Preset, Tokens } from "@poggers/kit/preset";
import type { App } from "src/app";

const theme = {
  color: {
    canvas: { l: 0.975, c: 0.006, h: 245 },
    panel: { l: 1, c: 0, h: 0 },
    panelMuted: { l: 0.955, c: 0.009, h: 245 },
    text: { l: 0.19, c: 0.018, h: 255 },
    muted: { l: 0.49, c: 0.018, h: 255 },
    line: { l: 0.885, c: 0.012, h: 245 },
    accent: { l: 0.56, c: 0.19, h: 256 },
    accentSoft: { l: 0.93, c: 0.04, h: 256 },
    focus: { l: 0.62, c: 0.18, h: 255 },
  },
  space: {
    xs: { kind: "space", value: 5 },
    sm: { kind: "space", value: 9 },
    md: { kind: "space", value: 14 },
    lg: { kind: "space", value: 20 },
    xl: { kind: "space", value: 28 },
    twoXl: { kind: "space", value: 40 },
  },
  size: {
    compact: { kind: "size", value: 760 },
    content: { kind: "size", value: 1120 },
    measure: { kind: "size", value: 620 },
    orderList: { kind: "size", value: 480 },
    searchList: { kind: "size", value: 300 },
  },
  radius: {
    control: { kind: "radius", value: 7 },
    panel: { kind: "radius", value: 8 },
    pill: { kind: "radius", value: 999 },
  },
  shadow: {
    panel: {
      y: 22,
      blur: 60,
      spread: -34,
      color: { l: 0.18, c: 0.04, h: 255, alpha: 0.22 },
    },
  },
  font: {
    body: { fallback: ["ui-sans-serif", "system-ui", "sans-serif"] },
    mono: { fallback: ["ui-monospace", "monospace"] },
  },
  motion: {
    quick: { duration: 110, easing: "decelerate" },
  },
} satisfies Tokens;

export const dataFlowPreset = (({ tokens, createRecipe }) => {
  const createControl = createRecipe({
    base: {
      shape: { radius: tokens.radius.control },
      layout: {
        flow: { axis: "inline", align: "center", distribute: "center" },
        size: { block: 40 },
        padding: { inline: tokens.space.md },
      },
      paint: {
        fill: tokens.color.text,
        stroke: { width: 1, line: "solid", color: tokens.color.text },
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      typography: { size: 13, weight: 680, color: tokens.color.panel },
      motion: { transition: { opacity: tokens.motion.quick, transform: tokens.motion.quick } },
    },
    variants: {
      hovered: {
        true: { paint: { opacity: 0.84 } },
        false: {},
      },
      pressed: {
        true: { motion: { scale: 0.98 } },
        false: {},
      },
      disabled: {
        true: { paint: { opacity: 0.4, cursor: "default" } },
        false: {},
      },
    },
    defaults: { hovered: false, pressed: false, disabled: false },
  });

  const field = {
    shape: { radius: tokens.radius.control },
    layout: {
      size: { inline: "fill", block: 40 },
      padding: { inline: tokens.space.md },
    },
    paint: {
      fill: tokens.color.panel,
      stroke: { width: 1, line: "solid", color: tokens.color.line },
      focusRing: { color: tokens.color.focus, width: 2, offset: 0 },
    },
    typography: { size: 14, color: tokens.color.text },
  } as const;

  const panel = {
    shape: { radius: tokens.radius.panel },
    layout: {
      flow: { axis: "block", gap: tokens.space.lg },
      padding: tokens.space.xl,
      size: { inline: "fill" },
    },
    paint: {
      fill: tokens.color.panel,
      stroke: { width: 1, line: "solid", color: tokens.color.line },
      shadow: tokens.shadow.panel,
    },
  } as const;

  const header = {
    layout: { flow: { axis: "block", gap: tokens.space.sm } },
  } as const;

  const eyebrow = {
    typography: {
      font: tokens.font.mono,
      size: 11,
      weight: 700,
      transform: "uppercase",
      color: tokens.color.accent,
    },
  } as const;

  const title = {
    layout: { margin: 0 },
    typography: { size: 22, weight: 740, line: 1.15, color: tokens.color.text },
  } as const;

  const description = {
    layout: { margin: 0, size: { inline: { max: tokens.size.measure } } },
    typography: { size: 13, line: 1.5, wrap: "pretty", color: tokens.color.muted },
  } as const;

  return {
    theme,
    components: {
      Shell({ geometry }) {
        const compact = geometry.inlineSize.isBelow(tokens.size.compact);
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.xl },
              size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
              padding: tokens.space.twoXl,
            },
            paint: { fill: tokens.color.canvas },
            typography: { font: tokens.font.body, color: tokens.color.text },
          },
          Header: {
            layout: {
              flow: { axis: "block", gap: tokens.space.xs },
              size: { inline: { max: tokens.size.content } },
            },
          },
          Brand: { typography: { size: 28, weight: 760 } },
          Description: description,
          Main: [
            {
              layout: {
                grid: {
                  columns: [{ minmax: [0, { fraction: 1 }] }, { minmax: [0, { fraction: 1 }] }],
                  gap: tokens.space.lg,
                  align: "start",
                },
                size: { inline: { max: tokens.size.content } },
              },
            },
            {
              when: compact,
              layout: { flow: { axis: "block", gap: tokens.space.lg } },
            },
          ],
        };
      },
    },
    features: {
      search: {
        components: {
          SearchPanel({ interaction }) {
            return {
              Root: panel,
              Header: header,
              Eyebrow: eyebrow,
              Title: title,
              Description: description,
              Search: {
                layout: {
                  grid: { columns: [{ minmax: [0, { fraction: 1 }] }, 84], gap: tokens.space.sm },
                },
              },
              Input: field,
              Clear: createControl({
                hovered: interaction.hovered,
                pressed: interaction.pressed,
                disabled: false,
              }),
              Status: {
                typography: { font: tokens.font.mono, size: 11, color: tokens.color.muted },
              },
              Results: {
                layout: {
                  flow: { axis: "block", gap: tokens.space.xs },
                  size: { block: { min: tokens.size.searchList } },
                  margin: 0,
                  padding: 0,
                },
              },
              Result: {
                shape: { radius: tokens.radius.control },
                layout: {
                  flow: { axis: "block", gap: tokens.space.xs },
                  padding: tokens.space.md,
                },
                paint: { fill: tokens.color.panelMuted },
              },
              ResultTitle: { typography: { size: 13, weight: 680 } },
              ResultMeta: { typography: { size: 12, color: tokens.color.muted } },
              Empty: {
                layout: { padding: tokens.space.lg },
                typography: { size: 13, align: "center", color: tokens.color.muted },
              },
            };
          },
        },
      },
      orders: {
        components: {
          OrdersPanel({ interaction }) {
            return {
              Root: panel,
              Header: header,
              Eyebrow: eyebrow,
              Title: title,
              Description: description,
              Composer: {
                layout: {
                  grid: { columns: [{ minmax: [0, { fraction: 1 }] }, 84], gap: tokens.space.sm },
                },
              },
              Input: field,
              Create: createControl({
                hovered: interaction.hovered,
                pressed: interaction.pressed,
                disabled: interaction.disabled,
              }),
              Summary: {
                layout: {
                  grid: {
                    columns: [
                      { minmax: [0, { fraction: 1 }] },
                      { minmax: [0, { fraction: 1 }] },
                      { minmax: [0, { fraction: 1 }] },
                    ],
                    gap: tokens.space.sm,
                  },
                  margin: 0,
                },
              },
              SummaryItem: {
                shape: { radius: tokens.radius.control },
                layout: { flow: { axis: "block", gap: tokens.space.xs }, padding: tokens.space.md },
                paint: { fill: tokens.color.panelMuted },
              },
              SummaryLabel: { typography: { size: 11, color: tokens.color.muted } },
              SummaryValue: {
                layout: { margin: 0 },
                typography: { font: tokens.font.mono, size: 16, weight: 720 },
              },
              Orders: {
                layout: {
                  flow: { axis: "block", gap: tokens.space.xs },
                  size: {
                    block: { min: tokens.size.orderList, max: tokens.size.orderList },
                  },
                  scroll: { block: "auto", overscroll: "contain", gutter: "stable" },
                  margin: 0,
                  padding: 0,
                },
              },
              Order: {
                shape: { radius: tokens.radius.control },
                layout: {
                  flow: {
                    axis: "inline",
                    align: "center",
                    distribute: "between",
                    gap: tokens.space.md,
                  },
                  padding: tokens.space.md,
                },
                paint: { fill: tokens.color.panelMuted },
              },
              OrderMain: { layout: { flow: { axis: "block", gap: tokens.space.xs } } },
              OrderTitle: { typography: { size: 13, weight: 680 } },
              OrderMeta: {
                typography: { font: tokens.font.mono, size: 11, color: tokens.color.muted },
              },
              OrderStatus: {
                shape: { radius: tokens.radius.pill },
                layout: { padding: { block: tokens.space.xs, inline: tokens.space.sm } },
                paint: { fill: tokens.color.accentSoft },
                typography: { size: 11, weight: 700, color: tokens.color.accent },
              },
              Empty: {
                layout: { padding: tokens.space.lg },
                typography: { size: 13, align: "center", color: tokens.color.muted },
              },
            };
          },
        },
      },
    },
  };
}) satisfies Preset<App, "system", typeof theme>;
