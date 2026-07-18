import type {
  WebPresentation,
  WebPresentationDeclaration,
  WebPresentationTheme,
} from "@poggers/kit/presentation/web";
import type { App } from "src/app";

export const familyTheme = {
  color: {
    canvas: { l: 0.97, c: 0.003, h: 250 },
    panel: { l: 0.998, c: 0.002, h: 145 },
    control: { l: 0.977, c: 0.003, h: 250 },
    secondary: { l: 0.958, c: 0.005, h: 250 },
    text: { l: 0.252, c: 0, h: 0 },
    muted: { l: 0.683, c: 0, h: 0 },
    line: { l: 0.976, c: 0, h: 0 },
    triggerLine: { l: 0.906, c: 0, h: 0 },
    blue: { l: 0.738, c: 0.154, h: 246 },
    white: { l: 1, c: 0, h: 0 },
    danger: { l: 0.655, c: 0.236, h: 27 },
    dangerSoft: { l: 0.969, c: 0.023, h: 24 },
    overlay: { l: 0, c: 0, h: 0, alpha: 0.3 },
    focus: { l: 0.72, c: 0.16, h: 246 },
  },
  space: {
    seven: { kind: "space", value: 7 },
    eight: { kind: "space", value: 8 },
    ten: { kind: "space", value: 10 },
    twelve: { kind: "space", value: 12 },
    fifteen: { kind: "space", value: 15 },
    sixteen: { kind: "space", value: 16 },
    twentyOne: { kind: "space", value: 21 },
    twentyFour: { kind: "space", value: 24 },
    twentyEight: { kind: "space", value: 28 },
    thirtyTwo: { kind: "space", value: 32 },
  },
  size: {
    phone: { kind: "size", value: 393 },
    drawer: { kind: "size", value: 361 },
    trigger: { kind: "size", value: 44 },
    control: { kind: "size", value: 48 },
    close: { kind: "size", value: 32 },
    closeIcon: { kind: "size", value: 12 },
    optionIcon: { kind: "size", value: 24 },
    viewIcon: { kind: "size", value: 48 },
    bodyLine: { kind: "size", value: 24 },
  },
  radius: {
    drawer: { kind: "radius", value: 36 },
    control: { kind: "radius", value: 16 },
    round: { kind: "radius", value: 999 },
  },
  font: {
    body: { fallback: ["ui-rounded", "system-ui", "sans-serif"] },
  },
  motion: {
    sheet: { spring: { damping: 48, mass: 1, stiffness: 700 } },
    dialog: { spring: { damping: 68, mass: 1, stiffness: 1100 } },
    content: { spring: { mass: 1, stiffness: 1600, damping: 80 } },
    resize: { spring: { mass: 1, stiffness: 1200, damping: 70 } },
    press: { duration: 120, easing: "decelerate" },
  },
  z: { dialog: { kind: "z", value: 100 } },
} satisfies WebPresentationTheme;

export const familyPresentation = ((tokens) => {
  const createControl = (
    declaration: WebPresentationDeclaration<typeof familyTheme>,
  ): WebPresentationDeclaration<typeof familyTheme> =>
    mergePresentation(
      {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: {
        scale: { target: 1, transition: tokens.motion.press },
      },
      conditions: {
        hovered: {
          paint: {
            brightness: 0.985,
          },
        },
        pressed: {
          motion: {
            scale: { target: 0.95, transition: tokens.motion.press },
          },
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
                    inset: {
                      blockStart: tokens.space.sixteen,
                      inlineEnd: tokens.space.sixteen,
                    },
                  },
                  size: { block: 36 },
                  padding: { inline: tokens.space.sixteen },
                },
                shape: { radius: tokens.radius.round },
                paint: {
                  fill: tokens.color.panel,
                  stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
                },
                typography: { color: tokens.color.text, size: 13, weight: 500, line: 1 },
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
                target: open ? 0 : compact ? closedOffset : 24,
                velocity: state.dragVelocity,
                transition,
              };
          const backdropOpacity = dragging
            ? 1 - dragProgress
            : { target: open ? 1 : 0, transition };
          const pageScale = dragging
            ? 0.96 + dragProgress * 0.04
            : { target: open ? 0.96 : 1, transition };
          const pageRadius = dragging
            ? 18 * (1 - dragProgress)
            : { target: open ? 18 : 0, transition };
          return {
            Root: {
              layout: {
                overlay: { align: "center", distribute: "center" },
                size: { block: { min: { viewport: { axis: "block", percent: 100 } } } },
              },
              paint: {
                fill: tokens.color.canvas,
              },
              typography: {
                font: tokens.font.body,
                smoothing: "grayscale",
                color: tokens.color.text,
              },
            },
            Page: {
              layout: {
                overlay: { align: "center", distribute: "center" },
                size: { inline: "fill", block: "fill" },
                item: { overlay: true },
              },
              shape: {
                corners: { radius: 0, continuity: 0.7 },
                clip: "content",
              },
              paint: { fill: tokens.color.canvas },
              motion: { scale: pageScale, radius: pageRadius, reduceMotion: "instant" },
            },
            Trigger: createControl({
                shape: { radius: tokens.radius.round },
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { inline: "content", block: tokens.size.trigger },
                  item: { align: "center", distribute: "center" },
                  padding: { inline: tokens.space.sixteen },
                },
                paint: {
                  fill: tokens.color.panel,
                  stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
                },
                typography: {
                  size: 14,
                  weight: 500,
                  line: 1,
                  color: tokens.color.text,
                },
              }),
            Panel: {
              layout: {
                overlay: { align: "end", distribute: "center" },
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
                shape: { radius: tokens.radius.drawer, clip: "content" },
                layout: {
                  size: { inline: tokens.size.drawer },
                  item: { align: "end", distribute: "center" },
                  margin: { blockEnd: tokens.space.sixteen },
                  position: { kind: "relative" },
                },
                paint: {
                  fill: tokens.color.panel,
                },
                motion: {
                  translation: {
                    block: sheet,
                  },
                  layout: tokens.motion.resize,
                  opacity: { target: open ? 1 : 0, transition },
                  scale: { target: open ? 1 : 0.96, transition },
                  presence: {
                    visible: open,
                    enter: {
                      from: compact
                        ? { block: closedOffset }
                        : { block: 24, opacity: 0, scale: 0.96 },
                    },
                    exit: {
                      to: compact
                        ? { block: closedOffset }
                        : { block: 24, opacity: 0, scale: 0.96 },
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
                  margin: 0,
                  position: {
                    kind: "absolute",
                    inset: { inline: tokens.space.sixteen, blockEnd: tokens.space.sixteen },
                  },
                },
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
              layout: { size: { inline: 36, block: 4 } },
              shape: { radius: tokens.radius.round },
              paint: { fill: tokens.color.triggerLine },
            },
            Close: createControl({
                shape: { radius: tokens.radius.round },
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { inline: tokens.size.close, block: tokens.size.close },
                  position: {
                    kind: "absolute",
                    inset: {
                      blockStart: tokens.space.twentyEight,
                      inlineEnd: tokens.space.thirtyTwo,
                    },
                    layer: 2,
                  },
                },
                paint: {
                  fill: tokens.color.control,
                },
              }),
            CloseIcon: {
              layout: {
                size: { inline: tokens.size.closeIcon, block: tokens.size.closeIcon },
              },
            },
            Viewport: {
              layout: {
                size: { inline: "fill" },
                padding: {
                  blockStart: tokens.space.ten,
                  blockEnd: tokens.space.twentyFour,
                  inline: tokens.space.twentyFour,
                },
                position: { kind: "relative" },
              },
            },
            DefaultView: {
              motion: {
                opacity: { target: 1, transition: tokens.motion.content },
                scale: { target: 1, transition: tokens.motion.content },
                presence: {
                  visible: "structure",
                  enter: {
                    from: { opacity: 0, scale: 0.96 },
                  },
                  exit: {
                    to: { opacity: 0, scale: 0.96 },
                  },
                  layout: "pop",
                  transition: tokens.motion.content,
                },
                reduceMotion: "crossfade",
              },
            },
            DefaultHeader: {
              layout: {
                flow: { axis: "inline", align: "center" },
                size: { block: 72 },
                padding: { inlineStart: tokens.space.eight, inlineEnd: tokens.space.thirtyTwo },
                margin: { blockEnd: tokens.space.sixteen },
              },
              paint: {
                stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
            DefaultTitle: {
              layout: {
                margin: 0,
              },
              typography: {
                size: 19,
                weight: 500,
                line: 1.2,
              },
            },
            OptionList: {
              layout: {
                flow: { axis: "block", gap: tokens.space.twelve },
              },
            },
            OptionButton: createControl({
                shape: { radius: tokens.radius.control },
                layout: {
                  flow: { axis: "inline", align: "center", gap: tokens.space.fifteen },
                  size: { inline: "fill", block: tokens.size.control },
                  padding: { inline: tokens.space.sixteen },
                },
                paint: {
                  fill: tokens.color.control,
                },
                typography: {
                  size: 17,
                  weight: 500,
                  line: 1,
                  color: tokens.color.text,
                },
              }),
            DangerOption: createControl({
                shape: { radius: tokens.radius.control },
                layout: {
                  flow: { axis: "inline", align: "center", gap: tokens.space.fifteen },
                  size: { inline: "fill", block: tokens.size.control },
                  padding: { inline: tokens.space.sixteen },
                },
                paint: {
                  fill: tokens.color.dangerSoft,
                },
                typography: {
                  size: 17,
                  weight: 500,
                  line: 1,
                  color: tokens.color.danger,
                },
              }),
            OptionIcon: {
              layout: {
                size: { inline: tokens.size.optionIcon, block: tokens.size.optionIcon },
                item: { flex: { grow: 0, shrink: 0 } },
              },
              paint: {
                media: { fit: "contain" },
              },
            },
            DetailView: {
              layout: {
                padding: { blockEnd: tokens.space.seven },
              },
              motion: {
                opacity: { target: 1, transition: tokens.motion.content },
                scale: { target: 1, transition: tokens.motion.content },
                presence: {
                  visible: "structure",
                  enter: {
                    from: { opacity: 0, scale: 0.96 },
                  },
                  exit: {
                    to: { opacity: 0, scale: 0.96 },
                  },
                  layout: "pop",
                  transition: tokens.motion.content,
                },
                reduceMotion: "crossfade",
              },
            },
            DetailBody: {
              layout: {
                padding: { inline: tokens.space.eight },
              },
            },
            ViewHeader: {
              layout: {
                margin: { blockStart: tokens.space.twentyOne },
              },
            },
            ViewIcon: {
              layout: {
                size: { inline: tokens.size.viewIcon, block: tokens.size.viewIcon },
              },
              paint: {
                media: { fit: "contain" },
              },
            },
            ViewTitle: {
              layout: {
                margin: { blockStart: tokens.space.ten },
              },
              typography: {
                size: 22,
                weight: 500,
                line: 1.2,
              },
            },
            ViewDescription: {
              layout: {
                margin: { blockStart: tokens.space.twelve },
              },
              typography: {
                size: 17,
                weight: 400,
                line: tokens.size.bodyLine,
                wrap: "pretty",
                color: tokens.color.muted,
              },
            },
            AdviceList: {
              layout: {
                flow: { axis: "block", gap: tokens.space.sixteen },
                padding: { blockStart: tokens.space.twentyFour },
                margin: { blockStart: tokens.space.twentyFour },
              },
              paint: {
                stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.line } },
              },
            },
            AdviceItem: {
              layout: {
                flow: { axis: "inline", align: "center", gap: tokens.space.twelve },
              },
              typography: {
                size: 15,
                weight: 500,
                line: 1.2,
                color: tokens.color.muted,
              },
            },
            AdviceIcon: {
              layout: {
                size: { inline: tokens.size.optionIcon, block: tokens.size.optionIcon },
                item: { flex: { grow: 0, shrink: 0 } },
              },
              paint: {
                media: { fit: "contain" },
              },
            },
            Actions: {
              layout: {
                grid: {
                  columns: [{ fraction: 1 }, { fraction: 1 }],
                  gap: tokens.space.sixteen,
                },
                margin: { blockStart: tokens.space.twentyEight },
              },
            },
            DangerActions: {
              layout: {
                grid: {
                  columns: [{ fraction: 1 }, { fraction: 1 }],
                  gap: tokens.space.sixteen,
                },
                margin: {
                  blockStart: tokens.space.twentyEight,
                  inline: tokens.space.eight,
                },
              },
            },
            SecondaryButton: createControl({
                shape: { radius: tokens.radius.round },
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { block: tokens.size.control },
                },
                paint: {
                  fill: tokens.color.secondary,
                },
                typography: {
                  size: 19,
                  weight: 500,
                  line: 1,
                  color: tokens.color.text,
                },
              }),
            PrimaryButton: createControl({
                shape: { radius: tokens.radius.round },
                layout: {
                  flow: {
                    axis: "inline",
                    align: "center",
                    distribute: "center",
                    gap: tokens.space.fifteen,
                  },
                  size: { block: tokens.size.control },
                },
                paint: {
                  fill: tokens.color.blue,
                },
                typography: {
                  size: 19,
                  weight: 500,
                  line: 1,
                  color: tokens.color.white,
                },
              }),
            DangerButton: createControl({
                shape: { radius: tokens.radius.round },
                layout: {
                  flow: { axis: "inline", align: "center", distribute: "center" },
                  size: { block: tokens.size.control },
                },
                paint: {
                  fill: tokens.color.danger,
                },
                typography: {
                  size: 19,
                  weight: 500,
                  line: 1,
                  color: tokens.color.white,
                },
              }),
            PrimaryIcon: {
              layout: {
                size: { inline: 20, block: 19 },
                margin: { inlineEnd: -4 },
              },
              paint: {
                media: { fit: "contain" },
              },
            },
          };
        },
      },
    },
  };
}) satisfies WebPresentation<App, typeof familyTheme>;

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
