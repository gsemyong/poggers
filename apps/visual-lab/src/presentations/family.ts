import type { PresentationRegistration } from "@poggers/kit/presentation";
import {
  type WebPresentation,
  type WebPresentationDeclaration,
  type WebPresentationTokens,
} from "@poggers/kit/presentation/web";
import type { App } from "src/app";

const symbol = (body: string, viewBox = "0 0 24 24") => ({
  kind: "symbol" as const,
  source: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">${body}</svg>`,
  )}`,
});

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
  resources: {
    close: symbol(
      '<path d="m6 6 12 12M18 6 6 18" stroke="#999" stroke-width="3" stroke-linecap="round"/>',
    ),
    key: symbol(
      '<rect x="4" y="10" width="16" height="11" rx="4" stroke="#8f8f8f" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#8f8f8f" stroke-width="2"/>',
    ),
    phrase: symbol(
      '<rect x="2" y="4" width="20" height="16" rx="4" stroke="#8f8f8f" stroke-width="2"/><path d="M6 8h5M6 12h5M6 16h5m2-8h5m-5 4h5m-5 4h5" stroke="#8f8f8f" stroke-width="2"/>',
    ),
    remove: symbol(
      '<path d="M10.2 3.7a2.1 2.1 0 0 1 3.6 0l8 14A2.2 2.2 0 0 1 19.9 21H4.1a2.2 2.2 0 0 1-1.9-3.3l8-14Z" stroke="#ff3f3f" stroke-width="2"/><path d="M12 8v6m0 3v.1" stroke="#ff3f3f" stroke-width="2.5" stroke-linecap="round"/>',
    ),
    collection: symbol(
      '<path d="M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Zm0 0v6c0 1.1 3.6 2 8 2s8-.9 8-2V6m-16 6v6c0 1.1 3.6 2 8 2s8-.9 8-2v-6" stroke="#8f8f8f" stroke-width="2"/>',
    ),
    recovery: symbol(
      '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" stroke="#999" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="#999" stroke-width="2"/>',
    ),
    danger: symbol(
      '<circle cx="12" cy="12" r="9" stroke="#ff3f3f" stroke-width="2"/><path d="M12 7v6m0 3v.1" stroke="#ff3f3f" stroke-width="2.5" stroke-linecap="round"/>',
    ),
    notice: symbol(
      '<path d="M12 3a7 7 0 0 0-7 7v3l-2 3h18l-2-3v-3a7 7 0 0 0-7-7Z" stroke="#6c8ef5" stroke-width="2"/><path d="M9 19h6" stroke="#6c8ef5" stroke-width="2" stroke-linecap="round"/>',
    ),
    material: { kind: "shader", source: "family-soft-material" },
  },
  motion: {
    sheet: { spring: { damping: 48, mass: 1, stiffness: 700 } },
    dialog: { spring: { damping: 68, mass: 1, stiffness: 1100 } },
    content: { spring: { mass: 1, stiffness: 1600, damping: 80 } },
    resize: { spring: { mass: 1, stiffness: 1200, damping: 70 } },
    press: { duration: 120, easing: "decelerate" },
  },
  z: { dialog: { kind: "z", value: 100 } },
} satisfies WebPresentationTokens;

export const familyVividTheme = {
  ...familyTheme,
  color: {
    ...familyTheme.color,
    canvas: { l: 0.93, c: 0.018, h: 252 },
    panel: { l: 1, c: 0.004, h: 145 },
    blue: { l: 0.66, c: 0.21, h: 252 },
  },
  resources: {
    ...familyTheme.resources,
    close: symbol(
      '<path d="m5 5 14 14M19 5 5 19" stroke="#5068d8" stroke-width="2.5" stroke-linecap="round"/>',
    ),
  },
  motion: {
    ...familyTheme.motion,
    sheet: { spring: { damping: 34, mass: 0.9, stiffness: 520 } },
  },
} satisfies typeof familyTheme;

export const familyPresentation = ((tokens) => {
  const createControl = (
    declaration: WebPresentationDeclaration<typeof familyTheme>,
  ): WebPresentationDeclaration<typeof familyTheme> => {
    const base: WebPresentationDeclaration<typeof familyTheme> = {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: {
        scale: { target: 1, transition: tokens.motion.press },
      },
      conditions: [
        {
          when: { target: { hovered: true } },
          use: {
            paint: {
              brightness: 0.985,
            },
          },
        },
        {
          when: { target: { pressed: true } },
          use: {
            motion: {
              scale: { target: 0.95, transition: tokens.motion.press },
            },
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
      MorphingNotice({ state }) {
        const expanded = state.expanded;
        return {
          Root: {
            layout: { flow: { axis: "inline", align: "center", gap: tokens.space.eight } },
          },
          Toggle: createControl({
            layout: {
              flow: { axis: "inline", align: "center", gap: tokens.space.ten },
              size: { inline: expanded ? 286 : 174, block: expanded ? 72 : 42 },
              padding: { inline: tokens.space.twelve, block: tokens.space.eight },
            },
            shape: { radius: tokens.radius.round, clip: "content" },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
              shadow: {
                y: 8,
                blur: 26,
                spread: -12,
                color: { l: 0.2, c: 0.02, h: 250, alpha: 0.2 },
              },
            },
            motion: {
              radius: {
                target: expanded ? 22 : 999,
                transition: tokens.motion.resize,
              },
              layout: tokens.motion.resize,
            },
          }),
          Symbol: {
            resource: tokens.resources.notice,
            layout: { size: { inline: 24, block: 24 }, item: { flex: { shrink: 0 } } },
          },
          Copy: {
            layout: { flow: { axis: "block", gap: 4 }, item: { flex: { grow: 1 } } },
            typography: { align: "start" },
          },
          Title: { typography: { size: 13, weight: 650, line: 1.1 } },
          Body: {
            typography: { size: 11, line: 1.3, color: tokens.color.muted, wrap: "pretty" },
            motion: {
              opacity: { target: 1, transition: tokens.motion.content },
              presence: {
                visible: "structure",
                enter: { from: { opacity: 0, block: -6 } },
                exit: { to: { opacity: 0, block: -6 } },
                transition: tokens.motion.content,
                layout: "pop",
              },
            },
          },
          Badge: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 22, block: 22 },
              item: { flex: { shrink: 0 } },
            },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.blue },
            typography: { color: tokens.color.white, size: 11, weight: 700, line: 1 },
            motion: { layout: tokens.motion.content },
          },
          Increment: createControl({
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 42, block: 42 },
            },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.secondary },
            typography: { size: 11, weight: 650, line: 1 },
          }),
        };
      },
      TextStream({ state }) {
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.eight },
              size: { inline: 300 },
              padding: tokens.space.twelve,
            },
            shape: { radius: tokens.radius.control },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
            },
          },
          Controls: {
            layout: { flow: { axis: "inline", align: "center", gap: tokens.space.eight } },
          },
          Start: createControl({
            layout: { size: { block: 30 }, padding: { inline: tokens.space.twelve } },
            shape: { radius: tokens.radius.round },
            paint: { fill: state.running ? tokens.color.blue : tokens.color.secondary },
            typography: {
              color: state.running ? tokens.color.white : tokens.color.text,
              size: 11,
              weight: 650,
              line: 1,
            },
          }),
          Reset: createControl({
            layout: { size: { block: 30 }, padding: { inline: tokens.space.twelve } },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.control },
            typography: { size: 11, weight: 600, line: 1 },
          }),
          Text: {
            layout: { margin: 0 },
            typography: {
              size: 12,
              line: 1.42,
              color: tokens.color.muted,
              wrap: "pretty",
            },
            motion: { layout: tokens.motion.resize, reduceMotion: "crossfade" },
          },
        };
      },
      MaterialControl({ state }) {
        const intensity = 0.35 + state.level * 0.25;
        return {
          Root: {
            layout: { flow: { axis: "inline", align: "center", gap: tokens.space.eight } },
          },
          Button: createControl({
            layout: {
              flow: { axis: "inline", align: "center", distribute: "between" },
              size: { inline: 136, block: 48 },
              padding: { inline: tokens.space.sixteen },
              position: { kind: "relative" },
            },
            shape: { radius: tokens.radius.control, clip: "content" },
            paint: {
              fill: tokens.color.control,
              stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
              shadow: [
                { y: 8, blur: 18, color: { l: 0.1, c: 0, h: 0, alpha: 0.18 } },
                { y: 1, blur: 0, color: { l: 1, c: 0, h: 0, alpha: 0.8 }, inset: true },
              ],
            },
            layers: [
              {
                id: "material",
                placement: "overlay",
                resource: tokens.resources.material,
                uniforms: { intensity, phase: state.level },
                visual: {
                  paint: {
                    opacity: 0.2 + state.level * 0.12,
                    blend: "screen",
                  },
                },
              },
            ],
            conditions: [
              {
                when: { target: { disabled: true } },
                use: { paint: { opacity: 0.45, cursor: "default" } },
              },
            ],
          }),
          Label: { typography: { size: 12, weight: 650, line: 1 } },
          Status: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "center" },
              size: { inline: 24, block: 24 },
            },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.panel },
            typography: { size: 11, weight: 700, line: 1 },
            motion: { scale: { target: 1, transition: tokens.motion.content } },
          },
          Disable: createControl({
            layout: { size: { block: 34 }, padding: { inline: tokens.space.ten } },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.secondary },
            typography: { size: 10, weight: 650, line: 1 },
          }),
        };
      },
      ScenePreview() {
        return {
          Root: {
            layout: {
              flow: { axis: "block", gap: tokens.space.eight },
              size: { inline: 236 },
              padding: tokens.space.eight,
            },
            shape: { radius: tokens.radius.control },
            paint: {
              fill: tokens.color.panel,
              stroke: { width: 1, line: "solid", color: tokens.color.triggerLine },
            },
          },
          Canvas: {
            layout: { size: { inline: "fill", block: 116 } },
            shape: { radius: 10, clip: "content" },
            paint: { fill: { l: 0.05, c: 0.02, h: 250 }, cursor: "pointer" },
          },
          Copy: {
            typography: { color: tokens.color.muted, size: 10, weight: 650, line: 1 },
          },
          Toggle: createControl({
            layout: { size: { block: 30 }, padding: { inline: tokens.space.twelve } },
            shape: { radius: tokens.radius.round },
            paint: { fill: tokens.color.secondary },
            typography: { color: tokens.color.text, size: 10, weight: 650, line: 1 },
          }),
        };
      },
      CollectionRecord({ props, state }) {
        return {
          Root: createControl({
            layout: {
              grid: { columns: [24, { fraction: 1 }], gap: tokens.space.ten, align: "center" },
              size: { inline: "fill", block: tokens.size.control },
              padding: { inline: tokens.space.twelve },
            },
            shape: { radius: tokens.radius.control },
            paint: {
              fill: props.selected ? tokens.color.dangerSoft : tokens.color.panel,
              stroke: {
                width: 1,
                line: "solid",
                color: props.selected ? tokens.color.blue : tokens.color.triggerLine,
              },
              cursor: state.dragging ? "grabbing" : "grab",
            },
            typography: { color: tokens.color.text, size: 13, weight: 550, line: 1 },
            motion: {
              identity: `vault-record-${props.item.id}`,
              scale: {
                target: state.dragging ? 1.02 : 1,
                transition: tokens.motion.content,
              },
              translation: {
                inline: {
                  target: state.dragging ? 8 : 0,
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
            typography: { color: tokens.color.muted, size: 11, weight: 700, line: 1 },
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
              target: open ? 0 : 24,
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
          ? 0.96 + dragProgress * 0.04
          : { target: open ? 0.96 : 1, transition: tokens.motion.sheet };
        const sheetPageRadius = dragging
          ? 18 * (1 - dragProgress)
          : { target: open ? 18 : 0, transition: tokens.motion.sheet };
        const optionIcon: WebPresentationDeclaration<typeof familyTheme> = {
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
                gap: tokens.space.twelve,
                wrap: true,
              },
              size: { inline: { max: 980 } },
              position: {
                kind: "fixed",
                inset: {
                  inline: tokens.space.sixteen,
                  blockEnd: tokens.space.sixteen,
                },
              },
            },
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
            shape: { radius: tokens.radius.drawer, clip: "content" },
            layout: {
              size: { inline: tokens.size.drawer },
              item: { align: "center", distribute: "center" },
              position: { kind: "relative" },
            },
            paint: {
              fill: tokens.color.panel,
            },
            motion: {
              translation: {
                block: dialogTranslation,
              },
              layout: tokens.motion.resize,
              opacity: { target: open ? 1 : 0, transition: tokens.motion.dialog },
              scale: { target: open ? 1 : 0.96, transition: tokens.motion.dialog },
              presence: {
                visible: open,
                enter: { from: { block: 24, opacity: 0, scale: 0.96 } },
                exit: { to: { block: 24, opacity: 0, scale: 0.96 } },
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
                    margin: 0,
                    position: {
                      kind: "absolute",
                      inset: { inline: tokens.space.sixteen, blockEnd: tokens.space.sixteen },
                    },
                  },
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
            resource: tokens.resources.close,
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
            resource: state.view === "remove" ? tokens.resources.danger : tokens.resources.recovery,
            layout: {
              size: { inline: tokens.size.viewIcon, block: tokens.size.viewIcon },
            },
            paint: {
              media: { fit: "contain" },
            },
            motion: {
              identity: `wallet-${state.view}`,
              layout: tokens.motion.content,
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
          CollectionView: {
            motion: {
              opacity: { target: 1, transition: tokens.motion.content },
              scale: { target: 1, transition: tokens.motion.content },
              presence: {
                visible: "structure",
                enter: { from: { opacity: 0, scale: 0.96 } },
                exit: { to: { opacity: 0, scale: 0.96 } },
                layout: "pop",
                transition: tokens.motion.content,
              },
              reduceMotion: "crossfade",
            },
          },
          CollectionToolbar: {
            layout: {
              flow: { axis: "inline", align: "center", distribute: "between" },
              margin: { blockStart: tokens.space.ten, blockEnd: tokens.space.twelve },
            },
          },
          PinnedList: {
            layout: {
              flow: { axis: "block", gap: 6, align: "stretch", distribute: "center" },
              size: { inline: "fill", block: { min: 64, max: 118 } },
              padding: tokens.space.eight,
              margin: { blockEnd: tokens.space.eight },
              scroll: { inline: "clip", block: "auto", overscroll: "contain" },
            },
            shape: { radius: tokens.radius.control, clip: "content" },
            paint: {
              fill: tokens.color.dangerSoft,
              stroke: { width: 1, line: "dash", color: tokens.color.blue },
            },
            typography: { color: tokens.color.muted, size: 11, align: "center" },
          },
          CollectionList: {
            layout: {
              size: { inline: "fill", block: 320 },
              scroll: { inline: "clip", block: "auto", overscroll: "contain" },
              collection: { axis: "block", estimate: tokens.size.control, gap: 6, lanes: 1 },
            },
            shape: { radius: tokens.radius.control, clip: "content" },
            paint: {
              fill: tokens.color.control,
              stroke: { width: 1, line: "solid", color: tokens.color.line },
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
  };
}) satisfies WebPresentation<App, typeof familyTheme>;

export const family = {
  presentation: familyPresentation,
  themes: { default: familyTheme, vivid: familyVividTheme },
} satisfies PresentationRegistration<typeof familyPresentation>;

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
