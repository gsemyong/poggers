import type { Preset, VisualFragment } from "../src/visual";

type VisualApp = {
  Resources: {};
  Components: {
    CommandMenu: {
      Variants: {
        density: "compact" | "comfortable";
      };
      State: {
        open: boolean;
        phase: "idle" | "dragging" | "settling";
        query: string;
        resultCount: number;
        nested: { ignored: true };
      };
      StyleValues: {
        dragOffset: "length";
        openness: "progress";
        opacity: "opacity";
      };
      Shared: "active-result";
      Parts: {
        Root: "main";
        Trigger: "button";
        Panel: "div";
        Input: "input";
        Results: "div";
        Result: "button";
      };
    };
  };
  Styles: {
    Presets: {
      precision: {
        Tokens: {
          color: "canvas" | "panel" | "text" | "line" | "focus";
          space: "xs" | "sm" | "md" | "lg";
          size: "panel";
          radius: "control" | "panel";
          shadow: "panel";
          font: "body";
          motion: "fast" | "settle";
        };
        Themes: "default" | "dark";
        Containers: "compact" | "wide";
      };
    };
  };
};

const precision = {
  tokens: {
    color: {
      canvas: { l: 0.98, c: 0.006, h: 260 },
      panel: { l: 1, c: 0, h: 0 },
      text: { l: 0.18, c: 0.01, h: 260 },
      line: { token: "text" },
      focus: { l: 0.58, c: 0.16, h: 250 },
    },
    space: { xs: 4, sm: 8, md: 12, lg: 20 },
    size: { panel: 640 },
    radius: { control: 8, panel: 16 },
    shadow: {
      panel: {
        y: 20,
        blur: 56,
        spread: -24,
        color: { l: 0.12, c: 0.01, h: 260, alpha: 0.24 },
      },
    },
    font: {
      body: { families: ["Inter", "Arial"] },
    },
    motion: {
      fast: { duration: 140, easing: "decelerate" },
      settle: { spring: { duration: 420, bounce: 0.12 } },
    },
  },
  themes: {
    default: {},
    dark: {
      color: {
        canvas: { l: 0.14, c: 0.008, h: 260 },
        panel: { l: 0.19, c: 0.01, h: 260 },
        text: { l: 0.96, c: 0.004, h: 260 },
      },
    },
  },
  containers: {
    compact: { inlineBelow: 560 },
    wide: { inlineAbove: 900 },
  },
  components: ({ tokens }) => {
    const control = {
      frame: { block: 40 },
      shape: { radius: tokens.radius.control },
      text: { font: tokens.font.body, size: 14 },
    } satisfies VisualFragment<typeof tokens>;

    return {
      CommandMenu: ({ values }) => ({
        Root: {
          surface: { fill: tokens.color.canvas, text: tokens.color.text },
        },
        Trigger: {
          use: control,
          padding: { inline: tokens.space.md, block: tokens.space.sm },
          stroke: { width: 1, color: tokens.color.line },
          interaction: {
            cursor: "pointer",
            focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
          },
          when: [
            {
              native: "hover",
              apply: { effect: { opacity: 0.86 } },
            },
            {
              variant: { density: "compact" },
              apply: { frame: { block: 34 } },
            },
          ],
        },
        Panel: {
          layout: { kind: "stack", gap: tokens.space.sm },
          frame: { inline: { max: tokens.size.panel } },
          padding: tokens.space.md,
          surface: { fill: tokens.color.panel, text: tokens.color.text },
          shape: { radius: tokens.radius.panel },
          effect: { shadow: tokens.shadow.panel, opacity: values.opacity },
          transform: { block: values.dragOffset },
          when: [
            {
              state: { open: false },
              apply: {
                effect: { opacity: 0 },
                transform: { block: 20, scale: 0.98 },
              },
            },
            {
              state: { phase: "dragging" },
              apply: { interaction: { cursor: "grabbing" } },
            },
            {
              container: "compact",
              apply: {
                position: {
                  anchor: { part: "Trigger" },
                  kind: "fixed",
                  inset: { inline: 0, blockEnd: 0 },
                },
                frame: { inline: "fill" },
              },
            },
          ],
          motion: {
            change: {
              effect: tokens.motion.fast,
              transform: tokens.motion.settle,
            },
            enter: {
              from: { effect: { opacity: 0 }, transform: { block: 16, scale: 0.98 } },
              using: tokens.motion.settle,
            },
            exit: {
              to: { effect: { opacity: 0 }, transform: { block: 24, scale: 0.98 } },
              using: tokens.motion.fast,
            },
            layout: {
              geometry: "frame",
              content: "preserve",
              using: tokens.motion.settle,
            },
            shared: {
              id: "active-result",
              using: tokens.motion.settle,
            },
            gesture: {
              axis: "block",
              value: values.dragOffset,
              bounds: [0, 500],
              rubberBand: 0.14,
              settle: tokens.motion.settle,
            },
          },
          decor: {
            backdrop: {
              surface: { fill: { l: 0.1, c: 0, h: 0, alpha: 0.42 } },
            },
          },
        },
        Input: { use: control },
        Results: {
          layout: { kind: "stack", gap: tokens.space.xs },
          scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
        },
        Result: {
          use: control,
          place: { flex: { grow: 1, shrink: 1, basis: "content" } },
        },
      }),
    };
  },
} satisfies Preset<VisualApp, "precision">;

void precision;

const invalidToken = {
  ...precision,
  tokens: {
    ...precision.tokens,
    color: {
      ...precision.tokens.color,
      // @ts-expect-error colors use the canonical OKLCH structure.
      panel: "#fff",
    },
  },
} satisfies Preset<VisualApp, "precision">;

const invalidState = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: () => ({
      Panel: {
        surface: { fill: tokens.color.panel },
        when: [
          {
            // @ts-expect-error state values derive from the component contract.
            state: { phase: "opening" },
            apply: { effect: { opacity: 0 } },
          },
        ],
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidContainer = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: () => ({
      Panel: {
        surface: { fill: tokens.color.panel },
        when: [
          {
            // @ts-expect-error container names derive from the preset contract.
            container: "phone",
            apply: { frame: { inline: "fill" } },
          },
        ],
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidBroadState = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: () => ({
      Panel: {
        surface: { fill: tokens.color.panel },
        when: [
          {
            // @ts-expect-error arbitrary strings are values, not finite selector state.
            state: { query: "hello" },
            apply: { effect: { opacity: 0 } },
          },
        ],
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidPart = {
  ...precision,
  components: () => ({
    // @ts-expect-error component parts derive from the app contract.
    CommandMenu: () => ({
      Unknown: { effect: { opacity: 0 } },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidRawCss = {
  ...precision,
  components: () => ({
    CommandMenu: () => ({
      Panel: {
        // @ts-expect-error CSS properties are not part of the visual algebra.
        display: "flex",
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidValueKind = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: ({ values }) => ({
      Panel: {
        surface: { fill: tokens.color.panel },
        effect: {
          // @ts-expect-error a length value cannot drive opacity.
          opacity: values.dragOffset,
        },
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidAnchorAndSharedId = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: () => ({
      Panel: {
        position: {
          kind: "absolute",
          // @ts-expect-error anchor parts derive from the component contract.
          anchor: { part: "Anchor" },
        },
        motion: {
          shared: {
            // @ts-expect-error shared identifiers derive from the component contract.
            id: "hero",
            using: tokens.motion.settle,
          },
        },
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

const invalidMotionDomain = {
  ...precision,
  components: ({ tokens }) => ({
    CommandMenu: () => ({
      Panel: {
        motion: {
          change: {
            // @ts-expect-error frame changes are owned by motion.layout.
            frame: tokens.motion.fast,
          },
        },
      },
    }),
  }),
} satisfies Preset<VisualApp, "precision">;

void invalidToken;
void invalidState;
void invalidContainer;
void invalidBroadState;
void invalidPart;
void invalidRawCss;
void invalidValueKind;
void invalidAnchorAndSharedId;
void invalidMotionDomain;
