import type { Program, WebMain } from "../../application";
import type { VisualValue } from "../component.contract";
import type { WebPresentation, WebPresentationDeclaration, WebPresentationTheme } from "./visual";

type Fixture = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Components: {
          Drawer: {
            State: {
              open: boolean;
              dragging: boolean;
              pressed: boolean;
              dragOffset: VisualValue<"length">;
              dragVelocity: number;
              progress: VisualValue<"progress">;
            };
            Actions: { close(): void };
            Parts: {
              Root: "main";
              Panel: "dialog";
              Backdrop: "div";
              Handle: "button";
              Icon: "img";
            };
          };
        };
      }
    >;
  };
};

const theme = {
  color: {
    panel: { l: 0.99, c: 0.002, h: 250 },
    overlay: { l: 0, c: 0, h: 0, alpha: 0.3 },
  },
  size: {
    compact: { kind: "size", value: 600 },
    panel: { kind: "size", value: 360 },
  },
  radius: { panel: { kind: "radius", value: 28 } },
  motion: {
    sheet: { spring: { mass: 1, stiffness: 900, damping: 62 } },
    fade: { duration: 140, easing: "decelerate" },
  },
  resources: {
    close: { kind: "symbol", source: "close" },
    material: { kind: "shader", source: "frosted-panel" },
  },
} as const satisfies WebPresentationTheme;

export const webPressurePresentation = ((tokens) => {
  const createControl = (pressed: boolean): WebPresentationDeclaration<typeof tokens> => ({
    motion: {
      scale: {
        target: pressed ? 0.96 : 1,
        transition: tokens.motion.sheet,
      },
    },
  });

  return {
    components: {
      Drawer: ({ state, platform, parts }) => {
        const compact = platform.allocated.inlineSize < tokens.size.compact.value;
        const closedOffset = Math.max(platform.allocated.blockSize, tokens.size.panel.value);
        const panelOffset = state.dragging ? state.dragOffset : state.open ? 0 : closedOffset;

        return {
          Root: {
            layout: { size: { inline: "fill", block: "fill" } },
          },
          Panel: {
            layout: {
              size: { inline: compact ? "fill" : tokens.size.panel },
              position: {
                kind: "fixed",
                place: compact ? "block-end" : "center",
                anchor: parts.Root,
              },
            },
            shape: { radius: tokens.radius.panel },
            paint: { fill: tokens.color.panel },
            motion: {
              identity: "drawer-panel",
              translation: {
                block: state.dragging
                  ? panelOffset
                  : {
                      target: compact ? panelOffset : 0,
                      transition: tokens.motion.sheet,
                      velocity: state.dragVelocity,
                    },
              },
              scale: {
                target: compact ? 1 : state.open ? 1 : 0.97,
                transition: tokens.motion.sheet,
              },
              presence: {
                visible: state.open || state.dragging,
                enter: { from: { opacity: 0, scale: 0.97 } },
                exit: { to: { opacity: 0, block: closedOffset } },
                transition: tokens.motion.sheet,
                layout: "pop",
              },
              reduceMotion: "crossfade",
            },
            layers: [
              {
                id: "material",
                placement: "background",
                resource: tokens.resources.material,
                uniforms: { intensity: state.progress },
              },
            ],
          },
          Backdrop: {
            paint: { fill: tokens.color.overlay, opacity: state.open ? 1 : 0 },
            motion: {
              opacity: { target: state.open ? 1 : 0, transition: tokens.motion.fade },
              presence: {
                visible: state.open || state.dragging,
                exit: { to: { opacity: 0 } },
                transition: tokens.motion.fade,
              },
            },
          },
          Handle: createControl(state.pressed),
          Icon: { resource: tokens.resources.close },
        };
      },
    },
  };
}) satisfies WebPresentation<Fixture, typeof theme>;
