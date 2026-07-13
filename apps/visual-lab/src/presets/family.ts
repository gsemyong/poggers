import type { Preset, Tokens } from "@poggers/kit/style";
import type { App } from "src/types";
const theme = {
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
    body: {
      families: ["Open Runde", "Inter", "ui-rounded", "system-ui", "sans-serif"],
    },
  },
  motion: {
    sheet: { spring: { damping: 48, mass: 1, stiffness: 700 } },
    dialog: { spring: { damping: 68, mass: 1, stiffness: 1100 } },
    content: { spring: { mass: 1, stiffness: 1600, damping: 80 } },
    resize: { spring: { mass: 1, stiffness: 1200, damping: 70 } },
    press: { duration: 120, easing: "decelerate" },
  },
  z: { dialog: { kind: "z", value: 100 } },
} satisfies Tokens;
export const familyPreset = (({ tokens, createRecipe, createMotion, interpolate }) => {
  const createControl = createRecipe({
    base: {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: {
        transition: { transform: tokens.motion.press },
      },
    },
    variants: {
      hovered: {
        true: {
          paint: {
            brightness: 0.985,
          },
        },
        false: {},
      },
      pressed: {
        true: {
          motion: {
            scale: 0.95,
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
      Drawer({ values, writableValues, events, parts, interaction, geometry }) {
        const open = values.opened;
        const dragging = values.dragging;
        const compact = geometry.inlineSize.isBelow(tokens.size.phone);
        const dragOffset = dragging.choose(values.dragOffset, 0);
        const surfaceOffset = open.choose(dragOffset, 700);
        const sheet = createMotion({
          target: surfaceOffset,
          velocity: values.dragVelocity,
          transition: dragging.choose(
            "instant",
            compact.choose(tokens.motion.sheet, tokens.motion.dialog),
          ),
          range: [0, 700],
        });
        const backdropOpacity = interpolate(sheet.progress, [0, 1], [1, 0]);
        const pageScale = interpolate(sheet.progress, [0, 1], [0.96, 1]);
        const pageRadius = interpolate<"radius">(sheet.progress, [0, 1], [18, 0]);
        const dismissDistance = compact.choose(0.25, 1);
        const dismissVelocity = compact.choose(0.48, 10);
        const dragThreshold = 3;
        const maxVelocity = 3;
        const dragResistance = 1;
        const control = createControl({
          hovered: interaction.hovered,
          pressed: interaction.pressed,
        });
        return {
          parameters: {
            dismissDistance,
            dismissVelocity,
          },
          interactions: [
            {
              type: "drag",
              trigger: parts.Handle,
              axis: "block",
              enabled: compact.and(open),
              bounds: { block: [0, values.sheetHeight] },
              threshold: dragThreshold,
              maxVelocity,
              resistance: dragResistance,
              cursor: { idle: "grab", active: "grabbing" },
              output: {
                block: writableValues.dragOffset,
                velocityBlock: writableValues.dragVelocity,
                progressBlock: writableValues.dragProgress,
              },
              start: events.startDragging,
              release: events.releaseDragging,
              cancel: events.cancelDragging,
            },
          ],
          Root: {
            layout: {
              overlay: { align: "center", distribute: "center" },
              size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
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
              corners: { radius: pageRadius, continuity: 0.7 },
              clip: "content",
            },
            paint: { fill: tokens.color.canvas },
            motion: { scale: pageScale, reduceMotion: "instant" },
          },
          PresetSwitch: [
            {
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
            },
            control,
          ],
          Trigger: [
            {
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
            },
            control,
          ],
          Panel: {
            layout: {
              overlay: { align: "end", distribute: "center" },
              size: { inline: "fill", block: "fill" },
              position: { kind: "fixed", inset: 0, layer: tokens.z.dialog },
              scroll: { inline: "clip", block: "clip", overscroll: "none" },
            },
          },
          Backdrop: {
            layout: {
              size: { inline: "fill", block: "fill" },
              position: { kind: "fixed", inset: 0 },
            },
            paint: {
              fill: tokens.color.overlay,
              opacity: backdropOpacity,
            },
          },
          Surface: [
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
                reduceMotion: "crossfade",
              },
            },
            {
              when: compact,
              layout: {
                size: { inline: "auto" },
                item: { align: "end", distribute: "stretch" },
                margin: 0,
                position: {
                  kind: "absolute",
                  inset: { inline: tokens.space.sixteen, blockEnd: tokens.space.sixteen },
                },
              },
            },
          ],
          Handle: [
            {
              when: compact,
              layout: {
                flow: { axis: "inline", align: "center", distribute: "center" },
                size: { inline: "fill", block: 24 },
              },
              paint: { cursor: "grab", select: "none" },
            },
            { when: compact.not(), layout: { display: "hidden" } },
          ],
          HandleBar: {
            layout: { size: { inline: 36, block: 4 } },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.triggerLine },
          },
          Close: [
            {
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
            },
            control,
          ],
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
              opacity: 1,
              scale: 1,
              presence: {
                enter: {
                  from: { opacity: 0, scale: 0.96 },
                },
                exit: {
                  to: { opacity: 0, scale: 0.96 },
                },
                layout: "pop",
              },
              transition: {
                opacity: tokens.motion.content,
                transform: tokens.motion.content,
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
          OptionButton: [
            {
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
            },
            control,
          ],
          DangerOption: [
            {
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
            },
            control,
          ],
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
              opacity: 1,
              scale: 1,
              presence: {
                enter: {
                  from: { opacity: 0, scale: 0.96 },
                },
                exit: {
                  to: { opacity: 0, scale: 0.96 },
                },
                layout: "pop",
              },
              transition: {
                opacity: tokens.motion.content,
                transform: tokens.motion.content,
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
          SecondaryButton: [
            {
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
            },
            control,
          ],
          PrimaryButton: [
            {
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
            },
            control,
          ],
          DangerButton: [
            {
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
            },
            control,
          ],
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
  };
}) satisfies Preset<App, "family", typeof theme>;
