import type { Preset, Tokens } from "@poggers/kit/preset";
import type { App } from "src/app";

const theme = {
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
} satisfies Tokens;

export const studioPreset = (({ tokens, createRecipe, createMotion, interpolate }) => {
  const createControl = createRecipe({
    base: {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: { transition: { opacity: tokens.motion.press, transform: tokens.motion.press } },
    },
    variants: {
      hovered: {
        true: { paint: { brightness: 1.16 } },
        false: {},
      },
      pressed: {
        true: { motion: { scale: 0.97 } },
        false: {},
      },
    },
    defaults: { hovered: false, pressed: false },
  });

  return {
    theme,
    components: {
      PresetSwitch({ interaction }) {
        return {
          Root: [
            {
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
            },
            createControl({ hovered: interaction.hovered, pressed: interaction.pressed }),
          ],
        };
      },
      Drawer({ state, actions, parts, interaction, geometry }) {
        const open = state.opened;
        const dragging = state.dragging;
        const compact = geometry.inlineSize.isBelow(tokens.size.phone);
        const dragOffset = dragging.choose(state.dragOffset, 0);
        const surfaceOffset = open.choose(dragOffset, 900);
        const sheet = createMotion({
          target: surfaceOffset,
          velocity: state.dragVelocity,
          transition: dragging.choose(
            "instant",
            compact.choose(tokens.motion.sheet, tokens.motion.dialog),
          ),
          range: [0, 900],
        });
        const backdropOpacity = interpolate(sheet.progress, [0, 1], [1, 0]);
        const pageScale = interpolate(sheet.progress, [0, 1], [0.985, 1]);
        const pageRadius = interpolate<"radius">(sheet.progress, [0, 1], [10, 0]);
        const dismissDistance = compact.choose(0.34, 1);
        const dismissVelocity = compact.choose(0.62, 10);
        const dragThreshold = 5;
        const maxVelocity = 2.4;
        const dragResistance = 0.92;
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
              bounds: { block: [0, state.sheetHeight] },
              threshold: dragThreshold,
              maxVelocity,
              resistance: dragResistance,
              cursor: { idle: "grab", active: "grabbing" },
              output: {
                block: state.dragOffset,
                velocityBlock: state.dragVelocity,
                progressBlock: state.dragProgress,
              },
              start: actions.startDragging,
              release: actions.releaseDragging,
              cancel: actions.cancelDragging,
            },
          ],
          Root: {
            layout: {
              overlay: { align: "center", distribute: "center" },
              size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
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
              corners: { radius: pageRadius, continuity: 0.35 },
              clip: "content",
            },
            paint: { fill: tokens.color.canvas },
            motion: { scale: pageScale, reduceMotion: "instant" },
          },
          Trigger: [
            {
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
            },
            control,
          ],
          Panel: [
            {
              layout: {
                overlay: { align: "center", distribute: "center" },
                size: { inline: "fill", block: "fill" },
                position: { kind: "fixed", inset: 0, layer: tokens.z.dialog },
                scroll: { inline: "clip", block: "clip", overscroll: "none" },
              },
            },
            {
              when: compact,
              layout: { overlay: { align: "end", distribute: "center" } },
            },
          ],
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
              layout: {
                size: { inline: tokens.size.drawer },
                item: { align: "center", distribute: "center" },
                position: { kind: "relative" },
              },
              shape: { corners: { radius: tokens.radius.panel, continuity: 0.4 }, clip: "content" },
              paint: {
                fill: tokens.color.panel,
                stroke: { width: 1, line: "solid", color: tokens.color.line },
                shadow: tokens.shadow.panel,
              },
              motion: {
                translation: { block: sheet },
                layout: tokens.motion.resize,
                reduceMotion: "crossfade",
              },
            },
            {
              when: compact,
              layout: {
                size: { inline: "auto" },
                item: { align: "end", distribute: "stretch" },
                margin: { inline: tokens.space.md, blockEnd: tokens.space.md },
              },
              shape: { corners: { radius: tokens.radius.panel, continuity: 0.75 } },
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
            layout: { size: { inline: 44, block: 3 } },
            shape: { radius: tokens.radius.panel },
            paint: { fill: tokens.color.accent },
          },
          Close: [
            {
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
            },
            control,
          ],
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
              opacity: 1,
              scale: 1,
              presence: {
                enter: { from: { opacity: 0, scale: 0.985 } },
                exit: { to: { opacity: 0, scale: 0.985 } },
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
              size: { block: 60 },
              margin: { blockEnd: tokens.space.lg },
              padding: { inlineStart: tokens.space.xs, inlineEnd: tokens.space.threeXl },
            },
            paint: { stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.line } } },
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
          OptionList: [
            {
              layout: {
                grid: {
                  columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                  gap: tokens.space.sm,
                },
              },
            },
            { when: compact, layout: { flow: { axis: "block", gap: tokens.space.sm } } },
          ],
          OptionButton: [
            {
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
            },
            control,
          ],
          DangerOption: [
            {
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
            },
            control,
          ],
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
              opacity: 1,
              scale: 1,
              presence: {
                enter: { from: { opacity: 0, scale: 0.985 } },
                exit: { to: { opacity: 0, scale: 0.985 } },
                layout: "pop",
              },
              transition: {
                opacity: tokens.motion.content,
                transform: tokens.motion.content,
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
          SecondaryButton: [
            {
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
            },
            control,
          ],
          PrimaryButton: [
            {
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
            },
            control,
          ],
          DangerButton: [
            {
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
            },
            control,
          ],
          PrimaryIcon: {
            layout: { size: { inline: 20, block: 19 }, margin: { inlineEnd: -4 } },
            paint: { media: { fit: "contain" } },
          },
        };
      },
    },
  };
}) satisfies Preset<App, "studio", typeof theme>;
