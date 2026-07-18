import type { Program, WebMain } from "../application";
import type { Presentation } from "./presentation";
import type { ReferencePresentationLanguage } from "./presentation.reference";

type Fixture = {
  Programs: {
    browser: Program<
      WebMain,
      {
        State: { busy: boolean };
        Actions: { reset(): void };
        Components: {
          Badge: {
            State: { active: boolean; count: number };
            Actions: { activate(): void };
            Parts: { Root: "surface"; Label: "copy" };
          };
        };
      }
    >;
  };
  Features: {
    child: {
      Programs: {
        browser: Program<
          WebMain,
          {
            Components: {
              Dot: {
                State: { visible: boolean };
                Parts: { Root: "mark" };
              };
            };
          }
        >;
      };
    };
  };
};

type Theme = Readonly<{ emphasis: "neutral" | "accent" }>;

export const referencePresentation = ((theme) => ({
  components: {
    Badge: ({ state, platform, parts }) => {
      void parts.Root;
      void parts.Label;
      return {
        Root: {
          tone: state.active ? theme.emphasis : "neutral",
          offset: platform.allocatedInlineSize < 320 ? 4 : 8,
        },
        Label: { visible: state.count > 0 && !state.busy && !platform.reducedMotion },
      };
    },
    Child: {
      Dot: ({ state }) => ({ Root: { visible: state.visible } }),
    },
  },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

export const invalidPartPresentation = ((_) => ({
  components: {
    // @ts-expect-error Unknown is not a named Badge Part.
    Badge: (_) => ({
      Unknown: { visible: true },
    }),
    Child: { Dot: (_) => ({}) },
  },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

export const invalidDeclarationPresentation = ((_) => ({
  components: {
    Badge: (_) => ({
      // @ts-expect-error CSS and other platform properties are absent from this language.
      Root: { color: "red" },
    }),
    Child: { Dot: (_) => ({}) },
  },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

export const invalidScopePresentation = ((_) => ({
  components: {
    Badge: (scope) => {
      // @ts-expect-error Presentation scope cannot invoke Component actions.
      scope.actions.activate();
      // @ts-expect-error Program actions are excluded from the combined Presentation state.
      scope.state.reset();
      // @ts-expect-error Presentation scope cannot access Capabilities.
      void scope.capabilities;
      return {};
    },
    Child: { Dot: (_) => ({}) },
  },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;
