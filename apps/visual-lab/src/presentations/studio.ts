import type { PresentationRegistration } from "@poggers/kit/presentation";
import {
  type WebPresentation,
  type WebPresentationDeclaration,
  type WebPresentationTokens,
} from "@poggers/kit/presentation/web";
import type { App } from "src/app";

const symbol = (body: string) => ({
  kind: "symbol" as const,
  source: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>`,
  )}`,
});

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
  resources: {
    close: symbol(
      '<path d="M7 7 17 17M17 7 7 17" stroke="#9ba7b5" stroke-width="2" stroke-linecap="square"/>',
    ),
    key: symbol(
      '<rect x="4" y="9" width="16" height="11" rx="2" stroke="#77d8e8" stroke-width="2"/><path d="M8 9V7a4 4 0 0 1 8 0v2" stroke="#77d8e8" stroke-width="2"/>',
    ),
    phrase: symbol(
      '<path d="M6 3h9l3 3v15H6V3Z" stroke="#77d8e8" stroke-width="2"/><path d="M9 10h6m-6 4h6m-6 4h4" stroke="#77d8e8" stroke-width="2"/>',
    ),
    remove: symbol(
      '<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5H8Z" stroke="#ff7185" stroke-width="2"/><path d="m9 9 6 6m0-6-6 6" stroke="#ff7185" stroke-width="2"/>',
    ),
    collection: symbol(
      '<path d="M4 5h16v4H4V5Zm0 6h16v4H4v-4Zm0 6h16v2H4v-2Z" stroke="#77d8e8" stroke-width="2"/>',
    ),
    recovery: symbol(
      '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="#77d8e8" stroke-width="2"/><path d="M10 10h4v4h-4z" stroke="#77d8e8" stroke-width="2"/>',
    ),
    danger: symbol(
      '<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5H8Z" stroke="#ff7185" stroke-width="2"/><path d="M12 7v6m0 3v.1" stroke="#ff7185" stroke-width="2.5"/>',
    ),
    notice: symbol(
      '<path d="M5 5h14v14H5V5Z" stroke="#77d8e8" stroke-width="2"/><path d="M8 9h8m-8 3h8m-8 3h5" stroke="#77d8e8" stroke-width="2"/>',
    ),
    material: { kind: "shader", source: "studio-grid-material" },
  },
  motion: {
    sheet: { spring: { mass: 1, stiffness: 520, damping: 34 } },
    dialog: { spring: { mass: 1, stiffness: 900, damping: 56 } },
    content: { spring: { mass: 1, stiffness: 1400, damping: 68 } },
    resize: { spring: { mass: 1, stiffness: 1000, damping: 60 } },
    press: { duration: 90, easing: "decelerate" },
  },
  z: { dialog: { kind: "z", value: 100 } },
} satisfies WebPresentationTokens;

export const studioPresentation = ((tokens) => {
  const createControl = (
    declaration: WebPresentationDeclaration<typeof studioTheme>,
  ): WebPresentationDeclaration<typeof studioTheme> => {
    const base: WebPresentationDeclaration<typeof studioTheme> = {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: { scale: { target: 1, transition: tokens.motion.press } },
      conditions: [
        { when: { target: { hovered: true } }, use: { paint: { brightness: 1.16 } } },
        {
          when: { target: { pressed: true } },
          use: {
            motion: { scale: { target: 0.97, transition: tokens.motion.press } },
          },
        },
      ],
    };
    const merged = mergePresentation(base, declaration);
    return {
      ...merged,
      conditions: [...(base.conditions ?? []), ...(declaration.conditions ?? [])],
    };
  };

  return {
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
      MorphingNotice({ state }) {
        const expanded = state.expanded;
        return {
          Root: { layout: { flow: { axis: "inline", align: "center", gap: tokens.space.sm } } },
          Toggle: createControl({
            layout: {
              grid: {
                columns: [24, { fraction: 1 }, 24],
                gap: tokens.space.md,
                align: "center",
              },
              size: { inline: expanded ? 316 : 196, block: expanded ? 78 : 44 },
              padding: { inline: tokens.space.md, block: tokens.space.sm },
            },
            shape: { radius: tokens.radius.subtle, clip: "content" },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
              shadow: tokens.shadow.panel,
            },
            motion: {
              radius: {
                target: expanded ? tokens.radius.control.value : tokens.radius.subtle.value,
                transition: tokens.motion.resize,
              },
              layout: tokens.motion.resize,
            },
          }),
          Symbol: {
            resource: tokens.resources.notice,
            layout: { size: { inline: 22, block: 22 } },
          },
          Copy: {
            layout: { flow: { axis: "block", gap: tokens.space.xs } },
            typography: { align: "start" },
          },
          Title: {
            typography: {
              color: tokens.color.accent,
              size: 11,
              weight: 800,
              line: 1,
              transform: "uppercase",
            },
          },
          Body: {
            typography: { color: tokens.color.muted, size: 10, line: 1.35, wrap: "pretty" },
            motion: {
              opacity: { target: 1, transition: tokens.motion.content },
              presence: {
                visible: "structure",
                enter: { from: { opacity: 0, inline: -8 } },
                exit: { to: { opacity: 0, inline: -8 } },
                transition: tokens.motion.content,
                layout: "pop",
              },
            },
          },
          Badge: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 24, block: 24 },
            },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: tokens.color.accent },
            typography: { color: tokens.color.canvas, size: 10, weight: 800, line: 1 },
            motion: { layout: tokens.motion.content },
          },
          Increment: createControl({
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 44, block: 44 },
            },
            shape: { radius: tokens.radius.subtle },
            paint: {
              fill: tokens.color.raised,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
            },
            typography: {
              color: tokens.color.accent,
              size: 10,
              weight: 800,
              line: 1,
              transform: "uppercase",
            },
          }),
        };
      },
      TextStream({ state }) {
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.sm },
              size: { inline: 318 },
              padding: tokens.space.md,
            },
            shape: { radius: tokens.radius.subtle },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
            },
          },
          Controls: { layout: { flow: { axis: "inline", gap: tokens.space.sm } } },
          Start: createControl({
            layout: { size: { block: 28 }, padding: { inline: tokens.space.md } },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: state.running ? tokens.color.accent : tokens.color.raised },
            typography: {
              color: state.running ? tokens.color.canvas : tokens.color.accent,
              size: 9,
              weight: 800,
              line: 1,
              transform: "uppercase",
            },
          }),
          Reset: createControl({
            layout: { size: { block: 28 }, padding: { inline: tokens.space.md } },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: tokens.color.control },
            typography: {
              color: tokens.color.muted,
              size: 9,
              weight: 700,
              line: 1,
              transform: "uppercase",
            },
          }),
          Text: {
            layout: { margin: 0 },
            typography: { color: tokens.color.muted, size: 10, line: 1.5, wrap: "pretty" },
            motion: { layout: tokens.motion.resize, reduceMotion: "crossfade" },
          },
        };
      },
      MaterialControl({ state }) {
        const intensity = 0.4 + state.level * 0.3;
        return {
          Root: { layout: { flow: { axis: "inline", align: "center", gap: tokens.space.sm } } },
          Button: createControl({
            layout: {
              grid: { columns: [{ fraction: 1 }, 24], gap: tokens.space.md, align: "center" },
              size: { inline: 142, block: 46 },
              padding: { inline: tokens.space.md },
              position: { kind: "relative" },
            },
            shape: { radius: tokens.radius.subtle, clip: "content" },
            paint: {
              fill: tokens.color.raised,
              stroke: { width: 1, line: "solid", color: tokens.color.accent },
              shadow: tokens.shadow.panel,
            },
            layers: [
              {
                id: "material",
                placement: "background",
                resource: tokens.resources.material,
                uniforms: { intensity, phase: state.level },
                visual: {
                  paint: { opacity: 0.28 + state.level * 0.16, blend: "screen" },
                },
              },
            ],
            conditions: [
              {
                when: { target: { disabled: true } },
                use: { paint: { opacity: 0.38, cursor: "default" } },
              },
            ],
          }),
          Label: {
            typography: {
              color: tokens.color.accent,
              size: 10,
              weight: 800,
              line: 1,
              transform: "uppercase",
            },
          },
          Status: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 24, block: 24 },
            },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: tokens.color.accent },
            typography: { color: tokens.color.canvas, size: 10, weight: 800, line: 1 },
            motion: { rotate: { target: state.level * 90, transition: tokens.motion.content } },
          },
          Disable: createControl({
            layout: { size: { block: 32 }, padding: { inline: tokens.space.sm } },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: tokens.color.control },
            typography: {
              color: tokens.color.muted,
              size: 9,
              weight: 700,
              line: 1,
              transform: "uppercase",
            },
          }),
        };
      },
      ScenePreview() {
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.sm },
              size: { inline: 250 },
              padding: tokens.space.sm,
            },
            shape: { radius: tokens.radius.subtle },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
              shadow: tokens.shadow.panel,
            },
          },
          Canvas: {
            layout: { size: { inline: "fill", block: 124 } },
            shape: { radius: tokens.radius.subtle, clip: "content" },
            paint: { fill: tokens.color.canvas, cursor: "pointer" },
          },
          Copy: {
            typography: {
              color: tokens.color.accent,
              size: 9,
              weight: 800,
              line: 1,
              transform: "uppercase",
            },
          },
          Toggle: createControl({
            layout: { size: { block: 30 }, padding: { inline: tokens.space.md } },
            shape: { radius: tokens.radius.subtle },
            paint: { fill: tokens.color.raised },
            typography: {
              color: tokens.color.text,
              size: 9,
              weight: 750,
              line: 1,
              transform: "uppercase",
            },
          }),
        };
      },
      CollectionRecord({ props, state }) {
        return {
          Root: createControl({
            layout: {
              grid: { columns: [22, { fraction: 1 }], gap: tokens.space.sm, align: "center" },
              size: { inline: "fill", block: tokens.size.control },
              padding: { inline: tokens.space.md },
            },
            shape: { radius: tokens.radius.subtle },
            paint: {
              fill: props.selected ? tokens.color.raised : tokens.color.control,
              stroke: {
                width: 1,
                line: "solid",
                color: props.selected ? tokens.color.accent : tokens.color.line,
              },
              cursor: state.dragging ? "grabbing" : "grab",
            },
            typography: { color: tokens.color.text, size: 11, weight: 650, line: 1 },
            motion: {
              identity: `vault-record-${props.item.id}`,
              scale: {
                target: state.dragging ? 1.015 : 1,
                transition: tokens.motion.content,
              },
              translation: {
                inline: {
                  target: state.dragging ? 10 : 0,
                  transition: tokens.motion.content,
                },
                block: state.dragging
                  ? state.dragOffset
                  : { target: 0, transition: tokens.motion.content },
              },
              layout: tokens.motion.resize,
            },
          }),
          Grip: {
            typography: { color: tokens.color.accent, size: 10, weight: 800, line: 1 },
            paint: { select: "none" },
          },
          Label: { typography: { overflow: "ellipsis", wrap: "nowrap" } },
        };
      },
      Drawer({ state }) {
        const open = state.open;
        const dragging = state.dragging;
        const compact = { container: { inline: { max: tokens.size.phone } } } as const;
        const closedOffset = state.sheetHeight + 32;
        const dragProgress = Math.min(1, Math.max(0, state.dragProgress));
        const dialogTranslation = dragging
          ? state.dragOffset
          : {
              target: open ? 0 : 18,
              velocity: state.dragVelocity,
              transition: tokens.motion.dialog,
            };
        const sheetTranslation = dragging
          ? state.dragOffset
          : {
              target: open ? 0 : closedOffset,
              velocity: state.dragVelocity,
              transition: tokens.motion.sheet,
            };
        const dialogBackdropOpacity = dragging
          ? 1 - dragProgress
          : { target: open ? 1 : 0, transition: tokens.motion.dialog };
        const sheetBackdropOpacity = dragging
          ? 1 - dragProgress
          : { target: open ? 1 : 0, transition: tokens.motion.sheet };
        const sheetPageScale = dragging
          ? 0.985 + dragProgress * 0.015
          : { target: open ? 0.985 : 1, transition: tokens.motion.sheet };
        const sheetPageRadius = dragging
          ? 10 * (1 - dragProgress)
          : { target: open ? 10 : 0, transition: tokens.motion.sheet };
        const optionIcon: WebPresentationDeclaration<typeof studioTheme> = {
          layout: {
            size: { inline: tokens.size.optionIcon, block: tokens.size.optionIcon },
            item: { flex: { grow: 0, shrink: 0 } },
          },
          paint: { media: { fit: "contain" } },
        };

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
            motion: { scale: 1, radius: 0, reduceMotion: "instant" },
            conditions: [
              {
                when: compact,
                use: {
                  motion: {
                    scale: sheetPageScale,
                    radius: sheetPageRadius,
                    reduceMotion: "instant",
                  },
                },
              },
            ],
          },
          LabTools: {
            layout: {
              flow: {
                axis: "inline",
                align: "end",
                distribute: "center",
                gap: tokens.space.md,
                wrap: true,
              },
              size: { inline: { max: 1020 } },
              position: {
                kind: "fixed",
                inset: { inline: tokens.space.lg, blockEnd: tokens.space.lg },
              },
            },
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
            conditions: [
              {
                when: compact,
                use: {
                  layout: {
                    position: { kind: "relative", inset: { blockStart: -84 } },
                  },
                },
              },
            ],
          }),
          Panel: {
            layout: {
              overlay: { align: "center", distribute: "center" },
              size: { inline: "fill", block: "fill" },
              position: { kind: "fixed", inset: 0, layer: tokens.z.dialog },
              scroll: { inline: "clip", block: "clip", overscroll: "none" },
            },
            motion: {
              opacity: { target: open ? 1 : 0, transition: tokens.motion.dialog },
              presence: {
                visible: open,
                enter: { from: { opacity: 0 } },
                exit: { to: { opacity: 0 } },
                transition: tokens.motion.dialog,
              },
              reduceMotion: "crossfade",
            },
            conditions: [
              {
                when: compact,
                use: {
                  layout: { overlay: { align: "end", distribute: "center" } },
                  motion: {
                    opacity: { target: open ? 1 : 0, transition: tokens.motion.sheet },
                    presence: {
                      visible: open,
                      enter: { from: { opacity: 0 } },
                      exit: { to: { opacity: 0 } },
                      transition: tokens.motion.sheet,
                    },
                  },
                },
              },
            ],
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
              opacity: dialogBackdropOpacity,
              presence: {
                visible: open,
                enter: { from: { opacity: 0 } },
                exit: { to: { opacity: 0 } },
                transition: tokens.motion.dialog,
              },
            },
            conditions: [
              {
                when: compact,
                use: {
                  motion: {
                    opacity: sheetBackdropOpacity,
                    presence: {
                      visible: open,
                      enter: { from: { opacity: 0 } },
                      exit: { to: { opacity: 0 } },
                      transition: tokens.motion.sheet,
                    },
                  },
                },
              },
            ],
          },
          Surface: {
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
              translation: { block: dialogTranslation },
              layout: tokens.motion.resize,
              opacity: { target: open ? 1 : 0, transition: tokens.motion.dialog },
              scale: { target: open ? 1 : 0.97, transition: tokens.motion.dialog },
              presence: {
                visible: open,
                enter: { from: { block: 18, opacity: 0, scale: 0.97 } },
                exit: { to: { block: 18, opacity: 0, scale: 0.97 } },
                transition: tokens.motion.dialog,
              },
              reduceMotion: "crossfade",
            },
            conditions: [
              {
                when: compact,
                use: {
                  layout: {
                    size: { inline: "auto" },
                    item: { align: "end", distribute: "stretch" },
                    margin: { inline: tokens.space.md, blockEnd: tokens.space.md },
                  },
                  shape: { corners: { radius: tokens.radius.panel, continuity: 0.75 } },
                  motion: {
                    translation: { block: sheetTranslation },
                    opacity: { target: open ? 1 : 0, transition: tokens.motion.sheet },
                    scale: { target: 1, transition: tokens.motion.sheet },
                    presence: {
                      visible: open,
                      enter: { from: { block: closedOffset } },
                      exit: { to: { block: closedOffset } },
                      transition: tokens.motion.sheet,
                    },
                  },
                },
              },
            ],
          },
          Handle: {
            layout: { display: "hidden" },
            conditions: [
              {
                when: compact,
                use: {
                  layout: {
                    flow: { axis: "inline", align: "center", distribute: "center" },
                    size: { inline: "fill", block: 24 },
                    display: "visible",
                  },
                  paint: { cursor: "grab", select: "none" },
                },
              },
            ],
          },
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
            resource: tokens.resources.close,
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
          OptionList: {
            layout: {
              grid: {
                columns: [{ fraction: 1 }, { fraction: 1 }, { fraction: 1 }],
                gap: tokens.space.sm,
              },
            },
            conditions: [
              {
                when: compact,
                use: {
                  layout: {
                    display: "visible",
                    flow: { axis: "block", gap: tokens.space.sm },
                  },
                },
              },
            ],
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
          KeyOptionIcon: mergePresentation(
            mergePresentation(optionIcon, { resource: tokens.resources.key }),
            state.view === "default"
              ? { motion: { identity: "wallet-key", layout: tokens.motion.content } }
              : {},
          ),
          PhraseOptionIcon: mergePresentation(
            mergePresentation(optionIcon, { resource: tokens.resources.phrase }),
            state.view === "default"
              ? { motion: { identity: "wallet-phrase", layout: tokens.motion.content } }
              : {},
          ),
          RemoveOptionIcon: mergePresentation(
            mergePresentation(optionIcon, { resource: tokens.resources.remove }),
            state.view === "default"
              ? { motion: { identity: "wallet-remove", layout: tokens.motion.content } }
              : {},
          ),
          CollectionOptionIcon: mergePresentation(optionIcon, {
            resource: tokens.resources.collection,
          }),
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
            resource: state.view === "remove" ? tokens.resources.danger : tokens.resources.recovery,
            layout: { size: { inline: tokens.size.viewIcon, block: tokens.size.viewIcon } },
            paint: { media: { fit: "contain" } },
            motion: {
              identity: `wallet-${state.view}`,
              layout: tokens.motion.content,
            },
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
          CollectionView: {
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
            },
          },
          CollectionToolbar: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "between" },
              margin: { blockStart: tokens.space.md, blockEnd: tokens.space.md },
            },
          },
          PinnedList: {
            layout: {
              flow: { axis: "block", gap: 6, align: "stretch", distribute: "center" },
              size: { inline: "fill", block: { min: 64, max: 120 } },
              padding: tokens.space.sm,
              margin: { blockEnd: tokens.space.sm },
              scroll: { inline: "clip", block: "auto", overscroll: "contain" },
            },
            shape: { radius: tokens.radius.subtle, clip: "content" },
            paint: {
              fill: tokens.color.raised,
              stroke: { width: 1, line: "dash", color: tokens.color.accent },
            },
            typography: {
              color: tokens.color.muted,
              size: 9,
              weight: 700,
              align: "center",
              transform: "uppercase",
            },
          },
          CollectionList: {
            layout: {
              size: { inline: "fill", block: 320 },
              scroll: {
                inline: "clip",
                block: "auto",
                overscroll: "contain",
                scrollbar: "thin",
              },
              collection: { axis: "block", estimate: tokens.size.control, gap: 6, lanes: 1 },
            },
            shape: { radius: tokens.radius.control, clip: "content" },
            paint: {
              fill: tokens.color.canvas,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
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
  };
}) satisfies WebPresentation<App, typeof studioTheme>;

export const studio = {
  presentation: studioPresentation,
  themes: { default: studioTheme },
} satisfies PresentationRegistration<typeof studioPresentation>;

function mergePresentation<Theme extends WebPresentationTokens>(
  ...declarations: readonly WebPresentationDeclaration<Theme>[]
): WebPresentationDeclaration<Theme> {
  return declarations.reduce(
    (result, declaration) => mergeRecords(result, declaration),
    {} as WebPresentationDeclaration<Theme>,
  );
}

function mergeRecords<Theme extends WebPresentationTokens>(
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
