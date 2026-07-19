import {
  createAudioAsset,
  createImageAsset,
  createSpring,
  type WebColor,
  type WebPresentation,
  type WebStyle,
} from "@poggers/kit/web/presentation";

import type { App } from "./app";

const theme = {
  color: {
    canvas: { oklch: [0.965, 0.008, 250] },
    surface: { oklch: [0.995, 0.003, 250] },
    ink: { oklch: [0.19, 0.018, 250] },
    muted: { oklch: [0.5, 0.025, 250] },
    line: { oklch: [0.87, 0.012, 250] },
    warm: { oklch: [0.67, 0.2, 35] },
    cool: { oklch: [0.62, 0.17, 213] },
  },
  space: { compact: 14, comfortable: 22, page: 32 },
  radius: { control: 6, surface: 8 },
  audio: {
    bright: createAudioAsset(new URL("./control.wav", import.meta.url), {
      gain: 0.16,
      playbackRate: 1.3,
    }),
    deep: createAudioAsset(new URL("./control.wav", import.meta.url), {
      gain: 0.2,
      playbackRate: 0.72,
    }),
  },
  image: {
    warm: createImageAsset(new URL("./accent-warm.svg", import.meta.url)),
    cool: createImageAsset(new URL("./accent-cool.svg", import.meta.url)),
  },
  motion: {
    control: createSpring({ duration: 320, bounce: 0.16 }),
    layout: createSpring({ stiffness: 520, damping: 42 }),
    sheet: createSpring({ duration: 460, bounce: 0.08 }),
    dismiss: createSpring({ stiffness: 560, damping: 38 }),
  },
} as const;

const presentation = ((values) => {
  const control = (active: boolean): WebStyle => ({
    layout: {
      model: { kind: "flow", direction: "inline", gap: 8, align: "center" },
      padding: { block: 10, inline: 14 },
    },
    paint: {
      fill: active ? values.color.ink : values.color.surface,
      stroke: { width: 1, color: active ? values.color.ink : values.color.line },
      radius: values.radius.control,
    },
    text: {
      color: active ? values.color.surface : values.color.ink,
      size: 13,
      weight: "semibold",
    },
    affordance: { cursor: "pointer", selection: "none" },
    rules: [
      {
        when: { pseudo: "hover", pointer: { hover: true } },
        use: { paint: { opacity: 0.76 } },
      },
      {
        when: { pseudo: "focus-visible" },
        use: {
          paint: {
            outline: { width: 2, offset: 2, color: values.color.cool },
          },
        },
      },
    ],
  });

  const mutedText = (size: number): WebStyle => ({
    text: { color: values.color.muted, size, lineHeight: 1.5 },
  });

  return {
    Dashboard: {
      Application: ({ state }) => {
        const accent: WebColor = state.warm ? values.color.warm : values.color.cool;
        const gap = state.compact ? values.space.compact : values.space.comfortable;
        return {
          Root: {
            layout: {
              model: { kind: "flow", direction: "block", gap },
              minBlockSize: { viewport: { axis: "block", percent: 100 } },
              padding: values.space.page,
              container: { name: "workspace", axis: "inline" },
            },
            paint: { fill: values.color.canvas },
            text: { family: ["system", "sans"], color: values.color.ink },
          },
          Header: {
            layout: {
              model: { kind: "flow", direction: "block", gap: 8 },
              maxInlineSize: 780,
            },
            rules: [
              {
                when: { container: { name: "workspace", maxInlineSize: 620 } },
                use: { layout: { maxInlineSize: "fill" } },
              },
            ],
          },
          Kicker: {
            text: { color: accent, size: 12, weight: "bold", case: "uppercase" },
          },
          Title: {
            text: { size: state.compact ? 40 : 52, weight: 650, lineHeight: 1.04 },
            rules: [
              {
                when: { container: { name: "workspace", maxInlineSize: 620 } },
                use: { text: { size: 36 } },
              },
            ],
          },
          Summary: mutedText(16),
          Toolbar: {
            layout: {
              model: { kind: "flow", direction: "inline", gap: 8, wrap: true },
              margin: { blockStart: 12 },
            },
          },
          Density: {
            ...control(state.compact),
            feedback: { activate: { audio: state.warm ? values.audio.bright : values.audio.deep } },
          },
          Accent: {
            ...control(state.warm),
            feedback: { activate: { audio: state.warm ? values.audio.bright : values.audio.deep } },
          },
          AccentIcon: {
            image: state.warm ? values.image.warm : values.image.cool,
            layout: { inlineSize: 16, blockSize: 16 },
            motion: {
              transform: {
                value: {
                  scale: state.warm ? 1 : 0.92,
                  rotate: state.warm ? 0 : -18,
                },
                transition: values.motion.control,
              },
            },
          },
          AccentMode: {
            layout: { item: { align: "center" }, margin: { inlineStart: 4 } },
            text: { color: accent, size: 12, weight: "semibold" },
          },
          OpenSheet: {
            ...control(false),
            feedback: { activate: { audio: state.warm ? values.audio.bright : values.audio.deep } },
          },
          Sheet: {
            layout: {
              model: { kind: "overlay", align: "end", distribute: "center" },
              inlineSize: "fill",
              blockSize: "fill",
              maxInlineSize: "fill",
              maxBlockSize: "fill",
              padding: 16,
              position: { kind: "fixed", inset: 0, layer: 20 },
              overflow: { inline: "clip", block: "clip" },
            },
            paint: {
              fill: { oklch: [0.08, 0.01, 250, 0.32] },
              stroke: "none",
              radius: 0,
            },
            motion: {
              opacity: {
                value: state.sheetOpen ? 1 : 0,
                transition: values.motion.sheet,
              },
              presence: {
                enter: { from: { opacity: 0 }, transition: values.motion.sheet },
                exit: {
                  to: { opacity: 0 },
                  transition: values.motion.dismiss,
                },
              },
            },
          },
          SheetPanel: {
            layout: {
              model: { kind: "flow", direction: "block", gap: 14 },
              inlineSize: "fill",
              maxInlineSize: 420,
              minBlockSize: state.sheetView === "summary" ? 248 : 312,
              padding: 24,
              position: { kind: "relative" },
              container: { name: "sheet", axis: "inline" },
            },
            paint: {
              fill: values.color.surface,
              radius: 28,
              shadow: {
                y: 18,
                blur: 50,
                color: { oklch: [0.08, 0.01, 250, 0.22] },
              },
            },
            motion: {
              transform: {
                value: {
                  translate: {
                    y: state.sheetOpen ? state.sheetOffset : Math.max(state.sheetOffset, 720),
                  },
                },
                velocity: { translate: { y: state.sheetVelocity } },
                transition: state.sheetDragging
                  ? undefined
                  : state.sheetOpen
                    ? values.motion.sheet
                    : values.motion.dismiss,
              },
              layout: { identity: "motion-sheet-panel", transition: values.motion.layout },
            },
          },
          SheetHandle: {
            layout: {
              inlineSize: 48,
              blockSize: 6,
              padding: 0,
              margin: { inline: "auto", blockEnd: 4 },
            },
            paint: { fill: values.color.line, stroke: "none", radius: 6 },
            affordance: { cursor: state.sheetDragging ? "grabbing" : "grab", selection: "none" },
          },
          SheetTitle: {
            text: { color: values.color.ink, size: 24, weight: 650, lineHeight: 1.1 },
          },
          SheetBody: {
            text: { color: values.color.muted, size: 14, lineHeight: 1.5, wrap: "pretty" },
          },
          SheetSwitch: control(state.sheetView === "detail"),
          SheetClose: control(false),
          Gallery: {
            motion: { layout: { transition: values.motion.layout } },
            layout: {
              model: {
                kind: "grid",
                columns: [
                  {
                    repeat: {
                      count: "fit",
                      track: { minmax: [240, { fraction: 1 }] },
                    },
                  },
                ],
                gap,
              },
            },
            rules: [
              {
                when: { container: { name: "workspace", maxInlineSize: 620 } },
                use: {
                  layout: {
                    model: { kind: "grid", columns: [{ fraction: 1 }], gap },
                  },
                },
              },
            ],
          },
        };
      },
      Metric: ({ props, state }) => {
        const accent: WebColor = state.warm ? values.color.warm : values.color.cool;
        return {
          Root: {
            motion: {
              layout: { identity: `metric:${props.label}`, transition: values.motion.layout },
            },
            layout: {
              model: { kind: "flow", direction: "block", gap: 10 },
              minBlockSize: state.compact ? 180 : 220,
              padding: state.compact ? 18 : 24,
              container: { name: "metric", axis: "inline" },
            },
            paint: {
              fill: values.color.surface,
              stroke: { width: 1, color: values.color.line },
              radius: values.radius.surface,
              shadow: {
                y: 12,
                blur: 32,
                color: { oklch: [0.2, 0.02, 250, 0.08] },
              },
            },
            rules: [
              {
                when: { pseudo: "hover", pointer: { hover: true } },
                use: {
                  paint: {
                    shadow: {
                      y: 16,
                      blur: 40,
                      color: { oklch: [0.2, 0.02, 250, 0.14] },
                    },
                  },
                },
              },
            ],
          },
          Label: mutedText(13),
          Value: {
            motion: {
              transform: {
                value: { scale: state.compact ? 0.96 : 1 },
                transition: values.motion.control,
              },
            },
            text: {
              color: props.tone === "accent" ? accent : values.color.ink,
              size: state.compact ? 34 : 42,
              weight: 650,
              lineHeight: 1,
            },
            rules: [
              {
                when: { container: { name: "metric", maxInlineSize: 280 } },
                use: { text: { size: 32 } },
              },
            ],
          },
          Rule: {
            layout: { blockSize: 1, inlineSize: "fill", margin: { block: 6 } },
            paint: { fill: props.tone === "accent" ? accent : values.color.line },
          },
          Detail: mutedText(13),
        };
      },
    },
  };
}) satisfies WebPresentation<App, typeof theme>;

export const editorial = presentation(theme);
