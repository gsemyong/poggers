import type { PresetFactoryContract, PresetFactoryResult, Tokens } from "@poggers/kit/preset";
import type { App } from "src/app";
type Direction = "paper" | "mono" | "terminal";
export type ChatTokens = {
  color: Readonly<
    Record<
      | "canvas"
      | "panel"
      | "panelAlt"
      | "text"
      | "muted"
      | "accent"
      | "success"
      | "border"
      | "field"
      | "buttonText"
      | "focus",
      NonNullable<Tokens["color"]>[string]
    >
  >;
  space: Readonly<Record<"xs" | "sm" | "md" | "lg" | "xl", NonNullable<Tokens["space"]>[string]>>;
  radius: Readonly<Record<"edge" | "round", NonNullable<Tokens["radius"]>[string]>>;
  size: Readonly<
    Record<
      "compact" | "messageMax" | "composerMin" | "topbarButton",
      NonNullable<Tokens["size"]>[string]
    >
  >;
  font: Readonly<Record<"body" | "mono", NonNullable<Tokens["font"]>[string]>>;
  shadow: Readonly<Record<"message" | "inset", NonNullable<Tokens["shadow"]>[string]>>;
  motion: Readonly<Record<"fast", NonNullable<Tokens["motion"]>[string]>>;
};
export function createChatComponents<Name extends Direction>(
  { tokens, createRecipe }: PresetFactoryContract<App, Name, ChatTokens>,
  direction: Direction,
): PresetFactoryResult<App, Name, ChatTokens>["features"]["chat"]["components"] {
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
    ChatMessage({ state }) {
      return {
        Root: createMessage({ role: state.role, streaming: state.streaming }),
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
