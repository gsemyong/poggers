import { animate, settled, velocity } from "@poggers/kit";
import {
  createAudioAsset,
  createImageAsset,
  follow,
  pulse,
  spring,
  type ConfiguredWebPresentation,
  type WebColor,
  type WebPresentation,
  type WebStyle,
} from "@poggers/kit/web/presentation";

import type { App } from "./app";
import type { SheetState } from "./dashboard";

const parameters = {
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
  presence: { sheetExitThreshold: 0.005 },
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
  spring: {
    control: spring({ duration: 320, bounce: 0.16 }),
    layout: spring({ stiffness: 520, damping: 42 }),
    sheet: spring({ duration: 460, bounce: 0.08 }),
    dismissButton: spring({ stiffness: 1_000, damping: 64 }),
    dismissBackdrop: spring({ stiffness: 900, damping: 60 }),
    dismissEscape: spring({ stiffness: 1_200, damping: 70 }),
    dismissDrag: spring({ stiffness: 660, damping: 52 }),
  },
  feedback: {
    accent: pulse({
      amplitude: 0.16,
      spring: spring({ stiffness: 620, damping: 34 }),
      overlap: "accumulate",
    }),
  },
} as const;

const createEditorial = (({ parameters: values, environment }) => {
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
    Dashboard: ({ state: featureState, events }) => {
      const accentMotion = animate(featureState.warm ? 1 : 0, values.spring.control);
      const accentPulse = animate(events.toggleAccent.completed, values.feedback.accent);
      return {
        Application: ({ state }) => {
          const sheet = state.sheet;
          const dragging = sheet.status === "open" && sheet.interaction.kind === "dragging";
          const dragDismissal = sheet.status === "closed" && sheet.via.kind === "drag";
          const accent: WebColor = state.warm ? values.color.warm : values.color.cool;
          const gap = featureState.compact ? values.space.compact : values.space.comfortable;
          const desktop =
            environment.input.pointer === "fine" && environment.viewport.inlineSize >= 700;
          const travel = desktop ? 1 : Math.max(environment.viewport.blockSize, 1);
          const dragged = rubberBand(dragging ? sheet.interaction.offset : 0, travel);
          const position = animate(
            dragging ? dragged : sheet.status === "open" ? 0 : travel,
            dragging
              ? follow(sheet.interaction.velocity, { relative: true })
              : selectSheetDynamics(values.spring, sheet),
          );
          const detail = animate(
            sheet.view === "detail" ? 1 : 0,
            dragDismissal ? follow() : values.spring.control,
          );
          const openness = 1 - clamp(position / travel);
          const visibleOpenness =
            sheet.status === "closed" && openness <= values.presence.sheetExitThreshold
              ? 0
              : openness;
          const detailProgress = clamp(detail);
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
              text: { size: featureState.compact ? 40 : 52, weight: 650, lineHeight: 1.04 },
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
              feedback: {
                activate: { audio: state.warm ? values.audio.bright : values.audio.deep },
              },
            },
            Accent: {
              ...control(state.warm),
              feedback: {
                activate: { audio: state.warm ? values.audio.bright : values.audio.deep },
              },
            },
            AccentIcon: {
              image: state.warm ? values.image.warm : values.image.cool,
              layout: { inlineSize: 16, blockSize: 16 },
              transform: {
                scale: interpolate(0.92, 1, accentMotion) + accentPulse,
                rotate: interpolate(-18, 0, accentMotion),
              },
            },
            AccentMode: {
              layout: { item: { align: "center" }, margin: { inlineStart: 4 } },
              text: { color: accent, size: 12, weight: "semibold" },
            },
            Reorder: control(state.reversed),
            OpenSheet: {
              ...control(false),
              feedback: {
                activate: { audio: state.warm ? values.audio.bright : values.audio.deep },
              },
            },
            Sheet: {
              presence: {
                value: visibleOpenness,
                velocity: visibleOpenness === 0 ? 0 : -velocity(position) / travel,
                settled: settled(position) || visibleOpenness === 0,
              },
              layout: {
                model: {
                  kind: "overlay",
                  align: desktop ? "center" : "end",
                  distribute: "center",
                },
                inlineSize: "fill",
                blockSize: "fill",
                maxInlineSize: "fill",
                maxBlockSize: "fill",
                padding: 16,
                position: { kind: "fixed", inset: 0, layer: 20 },
                overflow: { inline: "clip", block: "clip" },
              },
              paint: {
                fill: "transparent",
                stroke: "none",
                radius: 0,
              },
            },
            SheetBackdrop: {
              layout: {
                inlineSize: "fill",
                blockSize: "fill",
                position: { kind: "absolute", inset: 0 },
              },
              paint: {
                fill: { oklch: [0.08, 0.01, 250] },
                opacity: 0.32 * openness,
              },
              affordance: { cursor: "pointer" },
            },
            SheetPanel: {
              layout: {
                model: { kind: "flow", direction: "block", gap: 14 },
                inlineSize: "fill",
                maxInlineSize: 420,
                minBlockSize: 312,
                padding: 24,
                position: { kind: "relative" },
                container: { name: "sheet", axis: "inline" },
              },
              paint: {
                fill: values.color.surface,
                radius: desktop ? values.radius.surface : 28,
                shadow: {
                  y: 18,
                  blur: 50,
                  color: { oklch: [0.08, 0.01, 250, 0.22] },
                },
                opacity: desktop ? openness : 1,
              },
              transform: {
                translate: { y: desktop ? 24 * (1 - openness) : position },
                scale: desktop ? interpolate(0.96, 1, openness) : 1,
              },
            },
            SheetHandle: {
              layout: {
                model: desktop ? { kind: "hidden" } : undefined,
                inlineSize: 48,
                blockSize: 6,
                padding: 0,
                margin: { inline: "auto", blockEnd: 4 },
              },
              paint: { fill: values.color.line, stroke: "none", radius: 6 },
              affordance: { cursor: dragging ? "grabbing" : "grab", selection: "none" },
            },
            SheetTitle: {
              text: { color: values.color.ink, size: 24, weight: 650, lineHeight: 1.1 },
            },
            SheetContent: {
              layout: { model: { kind: "grid" } },
            },
            SheetSummary: {
              layout: { item: { overlay: true } },
              paint: { opacity: 1 - detailProgress },
              transform: { translate: { y: -8 * detailProgress } },
              text: { color: values.color.muted, size: 14, lineHeight: 1.5, wrap: "pretty" },
            },
            SheetDetail: {
              layout: { item: { overlay: true } },
              paint: { opacity: detailProgress },
              transform: { translate: { y: 8 * (1 - detailProgress) } },
              text: { color: values.color.muted, size: 14, lineHeight: 1.5, wrap: "pretty" },
            },
            SheetSwitch: control(sheet.view === "detail"),
            SheetClose: control(false),
            Gallery: {
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
              continuity: {
                identity: `metric:${props.label}`,
                dynamics: values.spring.layout,
                strategy: "position",
              },
              layout: {
                model: { kind: "flow", direction: "block", gap: 10 },
                minBlockSize: featureState.compact ? 180 : 220,
                padding: featureState.compact ? 18 : 24,
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
              text: {
                color: props.tone === "accent" ? accent : values.color.ink,
                size: featureState.compact ? 34 : 42,
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
      };
    },
  };
}) satisfies WebPresentation<App, typeof parameters>;

export const editorial = {
  parameters,
  create: createEditorial,
} satisfies ConfiguredWebPresentation<App, typeof parameters>;

function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rubberBand(offset: number, extent: number): number {
  if (offset >= 0) return offset;
  const dimension = Math.max(1, extent);
  const distance = Math.abs(offset);
  return -((distance * dimension * 0.55) / (dimension + 0.55 * distance));
}

function selectSheetDynamics(springs: typeof parameters.spring, sheet: SheetState) {
  if (sheet.status === "open") return springs.sheet;
  if (sheet.via.kind === "drag") return springs.dismissDrag;
  if (sheet.via.kind === "initial" || sheet.via.source === "button") {
    return springs.dismissButton;
  }
  return sheet.via.source === "backdrop" ? springs.dismissBackdrop : springs.dismissEscape;
}
