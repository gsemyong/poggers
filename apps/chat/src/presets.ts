import type {
  Preset,
  PresetFactoryContract,
  PresetFactoryResult,
  Tokens,
} from "@poggers/kit/style";
import type { App } from "src/types";
type Direction = "paper" | "mono" | "terminal";
const paperTokens = {
  color: {
    canvas: { l: 0.9588, c: 0.0127, h: 86.83 },
    panel: { l: 0.9862, c: 0.0142, h: 84.58 },
    panelAlt: { l: 0.9186, c: 0.0235, h: 82.12 },
    text: { l: 0.2635, c: 0.0103, h: 260.7 },
    muted: { l: 0.4638, c: 0.0237, h: 69.62 },
    accent: { l: 0.504, c: 0.1426, h: 32.4 },
    success: { l: 0.6094, c: 0.078, h: 161.08 },
    border: { l: 0.8488, c: 0.0297, h: 82.59 },
    field: { l: 0.9939, c: 0.0082, h: 91.48 },
    buttonText: { l: 0.9862, c: 0.0142, h: 84.58 },
    focus: { l: 0.58, c: 0.16, h: 35 },
  },
  space: {
    xs: { kind: "space", value: 7 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 14 },
    lg: { kind: "space", value: 22 },
    xl: { kind: "space", value: 24 },
  },
  radius: { edge: { kind: "radius", value: 8 }, round: { kind: "radius", value: 999 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 780 },
    composerMin: { kind: "size", value: 86 },
    topbarButton: { kind: "size", value: 34 },
  },
  font: {
    body: { families: ["Georgia", "Times New Roman", "serif"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    message: {
      y: 8,
      blur: 28,
      color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 },
    },
    inset: {
      inset: true,
      y: 1,
      blur: 4,
      color: { l: 0.3337, c: 0.0577, h: 67.24, alpha: 0.08 },
    },
  },
  motion: {
    fast: { duration: 160, easing: "decelerate" },
  },
} satisfies Tokens;
const monoTokens = {
  color: {
    canvas: { l: 0.987, c: 0.002, h: 255 },
    panel: { l: 1, c: 0, h: 0 },
    panelAlt: { l: 0.964, c: 0.003, h: 255 },
    text: { l: 0.192, c: 0.004, h: 255 },
    muted: { l: 0.52, c: 0.004, h: 255 },
    accent: { l: 0.24, c: 0.004, h: 255 },
    success: { l: 0.32, c: 0.004, h: 255 },
    border: { l: 0.89, c: 0.004, h: 255 },
    field: { l: 1, c: 0, h: 0 },
    buttonText: { l: 0.995, c: 0.001, h: 255 },
    focus: { l: 0.56, c: 0.1, h: 250 },
  },
  space: {
    xs: { kind: "space", value: 6 },
    sm: { kind: "space", value: 10 },
    md: { kind: "space", value: 14 },
    lg: { kind: "space", value: 20 },
    xl: { kind: "space", value: 28 },
  },
  radius: { edge: { kind: "radius", value: 8 }, round: { kind: "radius", value: 999 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 840 },
    composerMin: { kind: "size", value: 76 },
    topbarButton: { kind: "size", value: 32 },
  },
  font: {
    body: { families: ["Inter", "system-ui", "sans-serif"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    inset: {
      inset: true,
      y: 1,
      color: { l: 0.192, c: 0.004, h: 255, alpha: 0.08 },
    },
    message: "none",
  },
  motion: {
    fast: { duration: 140, easing: "decelerate" },
  },
} satisfies Tokens;
const terminalTokens = {
  color: {
    canvas: { l: 0.1386, c: 0.0077, h: 255.5 },
    panel: { l: 0.1764, c: 0.0081, h: 181.88 },
    panelAlt: { l: 0.185, c: 0.0163, h: 124.67 },
    text: { l: 0.9656, c: 0.0513, h: 160.08 },
    muted: { l: 0.9147, c: 0.1405, h: 156.95 },
    accent: { l: 0.8385, c: 0.1319, h: 81.79 },
    success: { l: 0.7614, c: 0.1779, h: 153.55 },
    border: { l: 0.3717, c: 0.0607, h: 160.08 },
    field: { l: 0.1288, c: 0.0085, h: 157.12 },
    buttonText: { l: 0.1693, c: 0.0248, h: 154.85 },
    focus: { l: 0.84, c: 0.16, h: 155 },
  },
  space: {
    xs: { kind: "space", value: 4 },
    sm: { kind: "space", value: 8 },
    md: { kind: "space", value: 10 },
    lg: { kind: "space", value: 14 },
    xl: { kind: "space", value: 16 },
  },
  radius: { edge: { kind: "radius", value: 2 }, round: { kind: "radius", value: 2 } },
  size: {
    compact: { kind: "size", value: 672 },
    messageMax: { kind: "size", value: 980 },
    composerMin: { kind: "size", value: 64 },
    topbarButton: { kind: "size", value: 30 },
  },
  font: {
    body: { families: ["SFMono-Regular", "Consolas", "monospace"] },
    mono: { families: ["SFMono-Regular", "Consolas", "monospace"] },
  },
  shadow: {
    inset: {
      inset: true,
      spread: 1,
      color: { l: 0.7614, c: 0.1779, h: 153.55, alpha: 0.12 },
    },
    message: "none",
  },
  motion: {
    fast: { duration: 110, easing: "linear" },
  },
} satisfies Tokens;
type TokenSetShape<Source extends Tokens> = {
  readonly [Group in keyof Source]: Group extends keyof Tokens
    ? {
        readonly [Name in keyof Source[Group]]: NonNullable<Tokens[Group]>[string];
      }
    : never;
};
type SharedTokens = TokenSetShape<typeof paperTokens>;
function createChatComponents<Name extends Direction>(
  { tokens, createRecipe }: PresetFactoryContract<App, Name, SharedTokens>,
  direction: Direction,
): PresetFactoryResult<App, Name, SharedTokens>["components"] {
  const terminal = direction === "terminal";
  const mono = direction === "mono";
  const messageFill = mono ? "transparent" : tokens.color.panel;
  const createControl = createRecipe({
    base: {
      paint: {
        cursor: "pointer",
        focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
      },
      motion: {
        transition: { opacity: tokens.motion.fast, transform: tokens.motion.fast },
      },
    },
    variants: {
      hovered: {
        true: {
          paint: {
            opacity: 0.8,
          },
        },
        false: {},
      },
      pressed: {
        true: {
          motion: {
            scale: 0.97,
          },
        },
        false: {},
      },
      disabled: {
        true: {
          paint: {
            opacity: 0.45,
            cursor: "default",
          },
        },
        false: {},
      },
    },
    defaults: { hovered: false, pressed: false, disabled: false },
  });
  const createMessage = createRecipe({
    base: {
      shape: { radius: tokens.radius.edge },
      layout: {
        flow: { axis: "block", gap: tokens.space.xs },
        size: { inline: { max: tokens.size.messageMax } },
        padding: { block: tokens.space.sm, inline: tokens.space.md },
      },
      paint: {
        fill: messageFill,
        stroke: { width: 1, line: "solid", color: mono ? "transparent" : tokens.color.border },
        shadow: tokens.shadow.message,
      },
    },
    variants: {
      role: {
        user: {
          paint: {
            fill: mono ? tokens.color.panelAlt : messageFill,
            stroke: { color: tokens.color.success },
          },
        },
        assistant: {},
      },
      streaming: {
        true: {
          paint: {
            stroke: { color: tokens.color.accent },
          },
        },
        false: {},
      },
    },
  });
  return {
    ChatLayout({ interaction, geometry }) {
      const compact = geometry.inlineSize.isBelow(tokens.size.compact);
      const control = createControl({
        hovered: interaction.hovered,
        pressed: interaction.pressed,
        disabled: interaction.disabled,
      });
      return {
        Root: {
          layout: {
            flow: { axis: "block" },
            size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
          },
          paint: {
            fill: tokens.color.canvas,
          },
          typography: {
            font: tokens.font.body,
            color: tokens.color.text,
          },
        },
        Topbar: {
          layout: {
            flow: { axis: "inline", align: "center", distribute: "between", gap: tokens.space.md },
            padding: { block: tokens.space.md, inline: tokens.space.lg },
          },
          paint: {
            fill: tokens.color.panel,
            stroke: { blockEnd: { width: 1, line: "solid", color: tokens.color.border } },
            shadow: tokens.shadow.message,
          },
        },
        Brand: {
          layout: {
            flow: { axis: "inline", align: "center", gap: tokens.space.sm },
          },
        },
        BrandMark: {
          shape: { radius: tokens.radius.round },
          layout: {
            flow: { axis: "inline", align: "center", distribute: "center" },
            size: { inline: { min: tokens.size.topbarButton }, block: tokens.size.topbarButton },
            padding: { inline: tokens.space.xs },
          },
          paint: {
            fill: terminal ? tokens.color.success : mono ? tokens.color.text : tokens.color.panel,
            stroke: {
              width: 1,
              line: "solid",
              color: terminal
                ? tokens.color.success
                : mono
                  ? tokens.color.text
                  : tokens.color.accent,
            },
          },
          typography: {
            font: tokens.font.mono,
            size: 12,
            weight: 800,
            line: 1,
            color: terminal || mono ? tokens.color.buttonText : tokens.color.accent,
          },
        },
        BrandText: {
          typography: {
            size: terminal ? 13 : 15,
            line: 1.3,
            color: tokens.color.muted,
          },
        },
        PresetSwitch: [
          {
            shape: { radius: tokens.radius.round },
            layout: {
              size: { block: { min: tokens.size.topbarButton } },
              padding: { inline: tokens.space.md },
            },
            paint: {
              fill: terminal ? tokens.color.panelAlt : tokens.color.panel,
              stroke: {
                width: 1,
                line: "solid",
                color: terminal ? tokens.color.accent : tokens.color.success,
              },
            },
            typography: {
              font: tokens.font.mono,
              size: 12,
              weight: 700,
              color: terminal ? tokens.color.accent : tokens.color.success,
            },
          },
          control,
        ],
        Messages: [
          {
            layout: {
              flow: { axis: "block", gap: terminal ? tokens.space.md : tokens.space.lg },
              item: { flex: { grow: 1, shrink: 1, basis: 0 } },
              padding: { block: tokens.space.xl, inline: tokens.space.lg },
              scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
            },
            paint: {
              fill: tokens.color.canvas,
            },
          },
          {
            when: compact,
            layout: {
              flow: { axis: "block", gap: tokens.space.sm },
              padding: { block: tokens.space.md, inline: tokens.space.md },
            },
          },
        ],
        Empty: {
          shape: { radius: tokens.radius.edge },
          layout: {
            padding: tokens.space.lg,
          },
          paint: {
            fill: tokens.color.panel,
            stroke: { width: 1, line: terminal ? "solid" : "dash", color: tokens.color.border },
          },
          typography: {
            line: 1.55,
            wrap: "pretty",
            color: tokens.color.muted,
          },
        },
        Status: {
          layout: {
            flow: { axis: "inline", distribute: "between", gap: tokens.space.md },
            padding: { block: tokens.space.xs, inline: tokens.space.lg },
          },
          paint: {
            fill: tokens.color.panelAlt,
            stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
          },
          typography: {
            font: tokens.font.mono,
            size: terminal ? 12 : 13,
          },
        },
        StatusText: {
          typography: {
            color: tokens.color.success,
          },
        },
        StatusMeta: {
          typography: {
            color: terminal ? tokens.color.accent : tokens.color.muted,
          },
        },
        Understanding: {
          layout: {
            size: { block: { max: terminal ? 72 : 80 } },
            padding: { block: tokens.space.sm, inline: tokens.space.lg },
            scroll: { block: "auto" },
          },
          paint: {
            fill: tokens.color.panelAlt,
            stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
          },
          typography: {
            size: terminal ? 12 : 13,
            color: tokens.color.muted,
          },
        },
        Composer: {
          layout: {
            padding: { block: tokens.space.md, inline: tokens.space.lg },
          },
          paint: {
            fill: tokens.color.panel,
            stroke: { blockStart: { width: 1, line: "solid", color: tokens.color.border } },
          },
        },
      };
    },
    ChatMessage({ values }) {
      return {
        Root: createMessage({ role: values.role, streaming: values.streaming }),
        Role: {
          typography: {
            font: tokens.font.mono,
            size: terminal ? 12 : 13,
            weight: 700,
            color: tokens.color.accent,
          },
        },
        Content: {
          typography: {
            size: terminal ? 13 : 15,
            line: terminal ? 1.45 : 1.6,
            wrap: "wrap",
            color: tokens.color.text,
          },
        },
      };
    },
    Composer({ interaction }) {
      return {
        Root: {
          layout: {
            grid: {
              columns: [{ minmax: [0, { fraction: 1 }] }, "content"],
              align: "end",
              gap: tokens.space.sm,
            },
          },
        },
        Input: {
          shape: { radius: tokens.radius.edge },
          layout: {
            size: { inline: "fill", block: { min: tokens.size.composerMin } },
            padding: tokens.space.md,
          },
          paint: {
            fill: tokens.color.field,
            stroke: {
              width: 1,
              line: "solid",
              color: terminal ? tokens.color.success : tokens.color.border,
            },
            shadow: tokens.shadow.inset,
            focusRing: { color: tokens.color.focus, width: 2, offset: 1 },
          },
          typography: {
            font: tokens.font.body,
            line: 1.45,
            color: tokens.color.text,
          },
        },
        Send: [
          {
            shape: { radius: tokens.radius.edge },
            layout: {
              size: { block: { min: terminal ? 36 : 42 } },
              padding: { inline: tokens.space.md },
            },
            paint: {
              fill: terminal
                ? tokens.color.panelAlt
                : mono
                  ? tokens.color.text
                  : tokens.color.success,
              stroke: {
                width: 1,
                line: "solid",
                color: terminal
                  ? tokens.color.accent
                  : mono
                    ? tokens.color.text
                    : tokens.color.success,
              },
            },
            typography: {
              font: tokens.font.body,
              weight: 800,
              color: terminal ? tokens.color.accent : tokens.color.buttonText,
            },
          },
          createControl({
            hovered: interaction.hovered,
            pressed: interaction.pressed,
            disabled: interaction.disabled,
          }),
        ],
      };
    },
    AIPart() {
      return {
        Root: {
          typography: {
            size: terminal ? 13 : 15,
            line: terminal ? 1.45 : 1.6,
            color: terminal ? tokens.color.muted : tokens.color.text,
          },
        },
        Item: {
          layout: {
            margin: { inlineStart: tokens.space.md },
          },
          typography: {
            line: 1.55,
          },
        },
      };
    },
  };
}
export const paperPreset = ((contract) => ({
  theme: paperTokens,
  components: createChatComponents(contract, "paper"),
})) satisfies Preset<App, "paper", typeof paperTokens>;
export const monoPreset = ((contract) => ({
  theme: monoTokens,
  components: createChatComponents(contract, "mono"),
})) satisfies Preset<App, "mono", typeof monoTokens>;
export const terminalPreset = ((contract) => ({
  theme: terminalTokens,
  components: createChatComponents(contract, "terminal"),
})) satisfies Preset<App, "terminal", typeof terminalTokens>;
