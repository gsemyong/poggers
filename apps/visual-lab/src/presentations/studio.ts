import type {
  WebPresentation,
  WebPresentationDeclaration,
  WebPresentationTheme,
} from "@poggers/kit/presentation/web";
import type { App } from "src/app";

export const studioTheme = {
  color: {
    canvas: { l: 0.115, c: 0.012, h: 255 },
    panel: { l: 0.17, c: 0.014, h: 255 },
    raised: { l: 0.215, c: 0.016, h: 255 },
    control: { l: 0.205, c: 0.015, h: 255 },
    text: { l: 0.955, c: 0.008, h: 245 },
    muted: { l: 0.69, c: 0.015, h: 245 },
    line: { l: 0.34, c: 0.018, h: 250 },
    accent: { l: 0.79, c: 0.135, h: 205 },
    danger: { l: 0.73, c: 0.18, h: 24 },
    dangerSoft: { l: 0.245, c: 0.055, h: 24 },
    overlay: { l: 0.04, c: 0.01, h: 255, alpha: 0.72 },
    focus: { l: 0.79, c: 0.135, h: 205 },
  },
  space: {
    xs: { kind: "space", value: 4 },
    sm: { kind: "space", value: 8 },
    md: { kind: "space", value: 12 },
    lg: { kind: "space", value: 16 },
    xl: { kind: "space", value: 20 },
    twoXl: { kind: "space", value: 24 },
    threeXl: { kind: "space", value: 32 },
  },
  size: {
    phone: { kind: "size", value: 560 },
    drawer: { kind: "size", value: 520 },
    trigger: { kind: "size", value: 42 },
    control: { kind: "size", value: 72 },
    close: { kind: "size", value: 34 },
    closeIcon: { kind: "size", value: 12 },
    optionIcon: { kind: "size", value: 22 },
    viewIcon: { kind: "size", value: 44 },
    bodyLine: { kind: "size", value: 23 },
  },
  radius: {
    panel: { kind: "radius", value: 18 },
    control: { kind: "radius", value: 8 },
    subtle: { kind: "radius", value: 4 },
  },
  shadow: {
    panel: {
      y: 28,
      blur: 90,
      spread: -28,
      color: { l: 0, c: 0, h: 0, alpha: 0.72 },
    },
  },
  font: {
    body: { fallback: ["ui-monospace", "monospace"] },
  },
  motion: {
    sheet: { spring: { mass: 1, stiffness: 520, damping: 34 } },
    dialog: { spring: { mass: 1, stiffness: 900, damping: 56 } },
    content: { spring: { mass: 1, stiffness: 1400, damping: 68 } },
    resize: { spring: { mass: 1, stiffness: 1000, damping: 60 } },
    press: { duration: 90, easing: "decelerate" },
  },
  z: { dialog: { kind: "z", value: 100 } },
} satisfies WebPresentationTheme;

export const studioPresentation = ((tokens) => {
  const createControl = (
    declaration: WebPresentationDeclaration<typeof studioTheme>,
  ): WebPresentationDeclaration<typeof studioTheme> =>
    mergePresentation(
      {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: { scale: { target: 1, transition: tokens.motion.press } },
      conditions: {
        hovered: { paint: { brightness: 1.16 } },
        pressed: {
          motion: { scale: { target: 0.97, transition: tokens.motion.press } },
        },
      },
      },
      declaration,
    );

  return {
    components: {
      Visual: {
        PresentationSwitch() {
          return {
            Root: createControl({
                layout: {
                  position: {
                    kind: "fixed",
                    inset: { blockStart: tokens.space.lg, inlineEnd: tokens.space.lg },
                  },
                  size: { block: 34 },
                  padding: { inline: tokens.space.md },
                },
                shape: { radius: tokens.radius.subtle },
                paint: {
                  fill: tokens.color.raised,
                  stroke: { width: 1, line: "solid", color: tokens.color.line },
                },
                typography: {
                  color: tokens.color.accent,
                  size: 11,
                  weight: 700,
                  line: 1,
                  transform: "uppercase",
                },
              }),
          };
        },
        Drawer({ state, platform }) {
          const open = state.open;
          const dragging = state.dragging;
          const compact = platform.allocated.inlineSize < tokens.size.phone.value;
          const transition = compact ? tokens.motion.sheet : tokens.motion.dialog;
          const closedOffset = Math.max(state.sheetHeight, platform.allocated.blockSize) + 32;
          const dragProgress = Math.min(1, Math.max(0, state.dragProgress));
          const sheet = dragging
            ? state.dragOffset
            : {
                target: open ? 0 : compact ? closedOffset : 18,
                velocity: state.dragVelocity,
                transition,
              };
          const backdropOpacity = dragging
            ? 1 - dragProgress
            : { target: open ? 1 : 0, transition };
          const pageScale = dragging
            ? 0.985 + dragProgress * 0.015
            : { target: open ? 0.985 : 1, transition };
          const pageRadius = dragging
            ? 10 * (1 - dragProgress)
            : { target: open ? 10 : 0, transition };

          return {
            Root: {
              layout: {
                overlay: { align: "center", distribute: "center" },
                size: { block: { min: { viewport: { axis: "block", percent: 100 } } } },
              },
              paint: { fill: tokens.color.canvas },
              typography: {
                color: tokens.color.text,
                font: tokens.font.body,
                smoothing: "grayscale",
              },
            },
            Page: {
              layout: {
                overlay: { align: "center", distribute: "center" },
                size: { inline: "fill", block: "fill" },
                item: { overlay: true },
              },
              shape: {
                corners: { radius: 0, continuity: 0.35 },
                clip: "content",
              },
              paint: { fill: tokens.color.canvas },
              motion: { scale: pageScale, radius: pageRadius, reduceMotion: "instant" },
            },
            Trigger: createControl({
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { inline: "content", block: tokens.size.trigger },
                  item: { align: "center", distribute: "center" },
                  padding: { inline: tokens.space.xl },
                },
                shape: { radius: tokens.radius.subtle },
                paint: {
                  fill: tokens.color.accent,
                  stroke: { width: 1, line: "solid", color: tokens.color.accent },
                },
                typography: {
                  color: tokens.color.canvas,
                  size: 12,
                  weight: 800,
                  line: 1,
                  transform: "uppercase",
                },
              }),
            Panel: mergePresentation(
              {
                layout: {
                  overlay: { align: "center", distribute: "center" },
                  size: { inline: "fill", block: "fill" },
                  position: { kind: "fixed", inset: 0, layer: tokens.z.dialog },
                  scroll: { inline: "clip", block: "clip", overscroll: "none" },
                },
                motion: {
                  opacity: { target: open ? 1 : 0, transition },
                  presence: {
                    visible: open,
                    enter: { from: { opacity: 0 } },
                    exit: { to: { opacity: 0 } },
                    transition,
                  },
                  reduceMotion: "crossfade",
                },
              },
              compact ? { layout: { overlay: { align: "end", distribute: "center" } } } : {},
            ),
            Backdrop: {
              layout: {
                size: { inline: "fill", block: "fill" },
                position: { kind: "fixed", inset: 0 },
              },
              paint: {
                fill: tokens.color.overlay,
              },
              motion: {
                opacity: backdropOpacity,
                presence: {
                  visible: open,
                  enter: { from: { opacity: 0 } },
                  exit: { to: { opacity: 0 } },
                  transition,
                },
              },
            },
            Surface: mergePresentation(
              {
                layout: {
                  size: { inline: tokens.size.drawer },
                  item: { align: "center", distribute: "center" },
                  position: { kind: "relative" },
                },
                shape: {
                  corners: { radius: tokens.radius.panel, continuity: 0.4 },
                  clip: "content",
                },
                paint: {
                  fill: tokens.color.panel,
                  stroke: { width: 1, line: "solid", color: tokens.color.line },
                  shadow: tokens.shadow.panel,
                },
                motion: {
                  translation: { block: sheet },
                  layout: tokens.motion.resize,
                  opacity: { target: open ? 1 : 0, transition },
                  scale: { target: open ? 1 : 0.97, transition },
                  presence: {
                    visible: open,
                    enter: {
                      from: compact
                        ? { block: closedOffset }
                        : { block: 18, opacity: 0, scale: 0.97 },
                    },
                    exit: {
                      to: compact
                        ? { block: closedOffset }
                        : { block: 18, opacity: 0, scale: 0.97 },
                    },
                    transition,
                  },
                  reduceMotion: "crossfade",
                },
              },
              compact
                ? {
                layout: {
                  size: { inline: "auto" },
                  item: { align: "end", distribute: "stretch" },
                  margin: { inline: tokens.space.md, blockEnd: tokens.space.md },
                },
                shape: { corners: { radius: tokens.radius.panel, continuity: 0.75 } },
                  }
                : {},
            ),
            Handle: compact
              ? {
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { inline: "fill", block: 24 },
                },
                paint: { cursor: "grab", select: "none" },
                }
              : { layout: { display: "hidden" } },
            HandleBar: {
              layout: { size: { inline: 44, block: 3 } },
              shape: { radius: tokens.radius.panel },
              paint: { fill: tokens.color.accent },
            },
            Close: createControl({
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { inline: tokens.size.close, block: tokens.size.close },
                  position: {
                    kind: "absolute",
                    inset: { blockStart: tokens.space.xl, inlineEnd: tokens.space.xl },
                    layer: 2,
                  },
                },
                shape: { radius: tokens.radius.subtle },
                paint: {
                  fill: tokens.color.raised,
                  stroke: { width: 1, line: "solid", color: tokens.color.line },
                },
              }),
            CloseIcon: {
              layout: { size: { inline: tokens.size.closeIcon, block: tokens.size.closeIcon } },
            },
            Viewport: {
              layout: {
                size: { inline: "fill" },
                padding: {
                  blockStart: tokens.space.lg,
                  blockEnd: tokens.space.twoXl,
                  inline: tokens.space.twoXl,
                },
              },
            },
            DefaultView: {
              motion: {
                opacity: { target: 1, transition: tokens.motion.content },
                scale: { target: 1, transition: tokens.motion.content },
                presence: {
                  visible: "structure",
                  enter: { from: { opacity: 0, scale: 0.985 } },
                  exit: { to: { opacity: 0, scale: 0.985 } },
                  layout: "pop",
                  transition: tokens.motion.content,
                },
                reduceMotion: "crossfade",
              },
            },
            DefaultHeader: {
              layout: {
                flow: { axis: "inline", align: "center" },
                size: { block: 60 },
                margin: { blockEnd: tokens.space.lg },
                padding: { inlineStart: tokens.space.xs, inlineEnd: tokens.space.threeXl },
              },
              paint: {
                stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
            DefaultTitle: {
              layout: { margin: 0 },
              typography: {
                color: tokens.color.accent,
                size: 13,
                weight: 800,
                line: 1,
                transform: "uppercase",
              },
            },
            OptionList: compact
              ? {
                  layout: { flow: { axis: "block", gap: tokens.space.sm } },
                }
              : {
                layout: {
                  grid: {
                    columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                    gap: tokens.space.sm,
                  },
                },
                },
            OptionButton: createControl({
                layout: {
                  flow: {
                    axis: "block",
                    align: "start",
                    distribute: "between",
                    gap: tokens.space.lg,
                  },
                  size: { inline: "fill", block: tokens.size.control },
                  padding: tokens.space.md,
                },
                shape: { radius: tokens.radius.control },
                paint: {
                  fill: tokens.color.control,
                  stroke: { width: 1, line: "solid", color: tokens.color.line },
                },
                typography: {
                  color: tokens.color.text,
                  size: 12,
                  weight: 650,
                  line: 1.15,
                  align: "start",
                },
              }),
            DangerOption: createControl({
                layout: {
                  flow: {
                    axis: "block",
                    align: "start",
                    distribute: "between",
                    gap: tokens.space.lg,
                  },
                  size: { inline: "fill", block: tokens.size.control },
                  padding: tokens.space.md,
                },
                shape: { radius: tokens.radius.control },
                paint: {
                  fill: tokens.color.dangerSoft,
                  stroke: { width: 1, line: "solid", color: tokens.color.danger },
                },
                typography: {
                  color: tokens.color.danger,
                  size: 12,
                  weight: 700,
                  line: 1.15,
                  align: "start",
                },
              }),
            OptionIcon: {
              layout: {
                size: { inline: tokens.size.optionIcon, block: tokens.size.optionIcon },
                item: { flex: { grow: 0, shrink: 0 } },
              },
              paint: { media: { fit: "contain" } },
            },
            DetailView: {
              layout: { padding: { blockEnd: tokens.space.sm } },
              motion: {
                opacity: { target: 1, transition: tokens.motion.content },
                scale: { target: 1, transition: tokens.motion.content },
                presence: {
                  visible: "structure",
                  enter: { from: { opacity: 0, scale: 0.985 } },
                  exit: { to: { opacity: 0, scale: 0.985 } },
                  layout: "pop",
                  transition: tokens.motion.content,
                },
                reduceMotion: "crossfade",
              },
            },
            DetailBody: { layout: { padding: { inline: tokens.space.sm } } },
            ViewHeader: { layout: { margin: { blockStart: tokens.space.lg } } },
            ViewIcon: {
              layout: { size: { inline: tokens.size.viewIcon, block: tokens.size.viewIcon } },
              paint: { media: { fit: "contain" } },
            },
            ViewTitle: {
              layout: { margin: { blockStart: tokens.space.md } },
              typography: { color: tokens.color.accent, size: 20, weight: 700, line: 1.2 },
            },
            ViewDescription: {
              layout: { margin: { blockStart: tokens.space.md } },
              typography: {
                color: tokens.color.muted,
                size: 14,
                weight: 450,
                line: tokens.size.bodyLine,
                wrap: "pretty",
              },
            },
            AdviceList: {
              layout: {
                flow: { axis: "block", gap: tokens.space.md },
                margin: { blockStart: tokens.space.twoXl },
                padding: { blockStart: tokens.space.twoXl },
              },
              paint: {
                stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
            AdviceItem: {
              layout: { flow: { axis: "inline", align: "center", gap: tokens.space.md } },
              typography: { color: tokens.color.muted, size: 12, weight: 550, line: 1.2 },
            },
            AdviceIcon: {
              layout: {
                size: { inline: tokens.size.optionIcon, block: tokens.size.optionIcon },
                item: { flex: { grow: 0, shrink: 0 } },
              },
              paint: { media: { fit: "contain" } },
            },
            Actions: {
              layout: {
                grid: { columns: [{ fraction: 1 }, { fraction: 1 }], gap: tokens.space.md },
                margin: { blockStart: tokens.space.twoXl },
              },
            },
            DangerActions: {
              layout: {
                grid: { columns: [{ fraction: 1 }, { fraction: 1 }], gap: tokens.space.md },
                margin: { blockStart: tokens.space.twoXl, inline: tokens.space.sm },
              },
            },
            SecondaryButton: createControl({
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { block: 44 },
                },
                shape: { radius: tokens.radius.control },
                paint: {
                  fill: tokens.color.raised,
                  stroke: { width: 1, line: "solid", color: tokens.color.line },
                },
                typography: {
                  color: tokens.color.text,
                  size: 12,
                  weight: 700,
                  line: 1,
                  transform: "uppercase",
                },
              }),
            PrimaryButton: createControl({
                layout: {
                  flow: {
                    axis: "inline",
                    align: "center",
                    distribute: "center",
                    gap: tokens.space.sm,
                  },
                  size: { block: 44 },
                },
                shape: { radius: tokens.radius.control },
                paint: { fill: tokens.color.accent },
                typography: {
                  color: tokens.color.canvas,
                  size: 12,
                  weight: 800,
                  line: 1,
                  transform: "uppercase",
                },
              }),
            DangerButton: createControl({
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { block: 44 },
                },
                shape: { radius: tokens.radius.control },
                paint: { fill: tokens.color.danger },
                typography: {
                  color: tokens.color.canvas,
                  size: 12,
                  weight: 800,
                  line: 1,
                  transform: "uppercase",
                },
              }),
            PrimaryIcon: {
              layout: { size: { inline: 20, block: 19 }, margin: { inlineEnd: -4 } },
              paint: { media: { fit: "contain" } },
            },
          };
        },
      },
    },
  };
}) satisfies WebPresentation<App, typeof studioTheme>;

function mergePresentation<Theme extends WebPresentationTheme>(
  ...declarations: readonly WebPresentationDeclaration<Theme>[]
): WebPresentationDeclaration<Theme> {
  return declarations.reduce(
    (result, declaration) => mergeRecords(result, declaration),
    {} as WebPresentationDeclaration<Theme>,
  );
}

function mergeRecords<Theme extends WebPresentationTheme>(
  base: WebPresentationDeclaration<Theme>,
  override: WebPresentationDeclaration<Theme>,
): WebPresentationDeclaration<Theme> {
  const result = { ...base } as Record<string, unknown>;
  for (const [name, value] of Object.entries(override)) {
    const current = result[name];
    result[name] = isRecord(current) && isRecord(value) ? mergeObject(current, value) : value;
  }
  return result as WebPresentationDeclaration<Theme>;
}

function mergeObject(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [name, value] of Object.entries(override)) {
    const current = result[name];
    result[name] = isRecord(current) && isRecord(value) ? mergeObject(current, value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
