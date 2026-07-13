import type { VisualValue } from "../src/app";
import type { Preset } from "../src/visual";

type App = {
  Resources: {};
  Components: {
    CommandMenu: {
      Context: {
        phase: "closed" | "open" | "dragging";
        selected: string | undefined;
      };
      States: "closed" | "open" | "open.dragging";
      Values: {
        phase: "closed" | "open" | "dragging";
        open: boolean;
        dragging: boolean;
        resultCount: number;
        dragOffset: VisualValue<"length">;
        dragProgress: VisualValue<"progress">;
      };
      Parts: {
        Trigger: "button";
        Surface: "section";
        Result: "button";
      };
    };
  };
  Styles: {
    Presets: {
      tactile: {
        Tokens: {
          color: "surface" | "text" | "separator";
          size: "compact";
          radius: "panel" | "sheet";
          stroke: "hairline";
          shadow: "lifted";
          motion: "dialog" | "settle";
        };
        Themes: "default" | "dark";
      };
    };
  };
};

const tactile = (({ tokens, createRecipe, createMotion, interpolate }) => {
  const surface = createRecipe({
    base: {
      paint: {
        fill: tokens.color.surface,
        stroke: { value: tokens.stroke.hairline, alignment: "inside" },
      },
      typography: { color: tokens.color.text },
      shape: {
        corners: {
          radius: tokens.radius.panel,
          continuity: 0.8,
        },
      },
    },
    variants: {
      phase: {
        closed: { paint: { opacity: 0 } },
        open: { paint: { opacity: 1 } },
        dragging: { paint: { shadow: tokens.shadow.lifted } },
      },
      compact: {
        true: { shape: { corners: { radius: tokens.radius.sheet } } },
        false: {},
      },
    },
    combinations: [
      {
        when: { phase: "dragging", compact: true },
        use: { motion: { scale: 0.98 } },
      },
    ],
    defaults: { compact: false },
  });

  surface({ phase: "open" });
  // @ts-expect-error A non-defaulted recipe variant is required.
  surface({});
  // @ts-expect-error Recipe values are inferred from their exact branches.
  surface({ phase: "missing" });

  return {
    theme: {
      color: {
        surface: { l: 0.98, c: 0.004, h: 250 },
        text: { l: 0.2, c: 0.01, h: 250 },
        separator: { l: 0.8, c: 0.01, h: 250 },
      },
      size: { compact: { kind: "size", value: 600 } },
      radius: {
        panel: { kind: "radius", value: 18 },
        sheet: { kind: "radius", value: 26 },
      },
      stroke: {
        hairline: {
          width: 1,
          color: { l: 0.8, c: 0.01, h: 250 },
        },
      },
      shadow: {
        lifted: {
          y: 12,
          blur: 36,
          color: { l: 0.1, c: 0.01, h: 250, alpha: 0.24 },
        },
      },
      motion: {
        settle: { spring: { duration: 240, bounce: 0.08 } },
        dialog: { spring: { stiffness: 900, damping: 56 } },
      },
    },
    themes: {
      dark: {
        color: {
          surface: { l: 0.16, c: 0.008, h: 250 },
          text: { l: 0.94, c: 0.006, h: 250 },
        },
      },
    },
    components: {
      CommandMenu(scope) {
        // @ts-expect-error Presets receive presentation values, not the statechart.
        void scope.state;
        // @ts-expect-error Presets receive no mutable component context.
        void scope.context;
        const { values, interaction, geometry, environment } = scope;
        // @ts-expect-error Geometric comparisons accept numeric and metric operands, not colors.
        geometry.inlineSize.isBelow(tokens.color.surface);
        const sheet = createMotion({
          target: values.open.choose(values.dragOffset, 700),
          transition: geometry.inlineSize
            .isBelow(tokens.size.compact)
            .choose(tokens.motion.settle, tokens.motion.dialog),
          range: [0, 700],
        });
        createMotion({
          target: 0,
          transition: tokens.motion.settle,
          // @ts-expect-error Motion ranges always contain authored start and end values.
          range: [0],
        });
        createMotion({
          target: 0,
          // @ts-expect-error Motion transitions accept only this preset's motion tokens.
          transition: tokens.color.surface,
          range: [0, 1],
        });
        return {
          Trigger: {
            when: interaction.hovered,
            motion: { scale: 1.01 },
          },
          Surface: [
            surface({
              phase: values.phase,
              compact: geometry.inlineSize.isBelow(tokens.size.compact),
            }),
            {
              motion: {
                translation: { block: sheet },
                scale: interpolate(values.dragProgress, [0, 1], [1, 0.98]),
                transition: { transform: tokens.motion.settle },
                reduceMotion: "instant",
              },
              when: values.dragging.and(environment.reducedMotion.not()),
            },
          ],
          Result: {
            paint: {
              opacity: interpolate(sheet.progress, [0, 1], [1, 0.6]),
            },
          },
          gestures: {},
        };
      },
    },
  };
  // @ts-expect-error Gesture recognition is declared as a typed preset interaction.
}) satisfies Preset<App, "tactile">;

void tactile;
