import type { Program } from "../application";
import type {
  ComponentActionScope,
  ComponentStartScope,
  ComponentStateInitializationScope,
} from "./component";
import type { Presentation, PresentationRegistration, PresentationTarget } from "./presentation";
import type {
  ReferencePresentationDeclaration,
  ReferencePresentationLanguage,
  ReferencePlatform,
} from "./presentation.reference";

type ReferenceMain = { readonly Name: "reference-main"; readonly Platform: ReferencePlatform };

type Fixture = {
  Programs: {
    browser: Program<
      ReferenceMain,
      {
        State: { busy: boolean };
        Actions: { reset(): void };
        Components: {
          Badge: {
            Props: { emphasis: number };
            State: { active: boolean; count: number };
            Actions: { activate(): void };
            Elements: { Root: "surface"; Label: "copy" };
          };
        };
      }
    >;
  };
  Features: {
    child: {
      Programs: {
        browser: Program<
          ReferenceMain,
          {
            Components: {
              Dot: {
                State: { visible: boolean };
                Elements: { Root: "mark" };
              };
            };
          }
        >;
      };
    };
  };
};

type Theme = Readonly<{ emphasis: "neutral" | "accent" }>;

export const referencePresentation = ((theme) => {
  const createLabel = (visible: boolean): ReferencePresentationDeclaration => ({
    visible,
    tone: visible ? theme.emphasis : "neutral",
  });

  return {
    Badge: ({ props, state, targets }) => ({
      Root: {
        tone: state.active ? theme.emphasis : "neutral",
        offset: props.emphasis,
      },
      Label: {
        ...createLabel(state.count > 0 && !state.busy),
        anchor: targets.Root,
      },
    }),
    Child: {
      Dot: ({ state }) => ({ Root: { visible: state.visible } }),
    },
  };
}) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

export const invalidElementPresentation = ((_) => ({
  // @ts-expect-error Unknown is not a named Badge Element.
  Badge: (_) => ({ Unknown: { visible: true } }),
  Child: { Dot: (_) => ({}) },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

export const referenceRegistration = {
  presentation: referencePresentation,
  themes: {
    default: { emphasis: "neutral" },
    accent: { emphasis: "accent" },
  },
} satisfies PresentationRegistration<typeof referencePresentation>;

export const missingDefaultTheme = {
  presentation: referencePresentation,
  // @ts-expect-error Every Presentation registration requires a default Theme.
  themes: { accent: { emphasis: "accent" } },
} satisfies PresentationRegistration<typeof referencePresentation>;

export const incompatibleTheme = {
  presentation: referencePresentation,
  themes: {
    // @ts-expect-error Theme values must satisfy the Presentation token contract.
    default: { emphasis: "loud" },
  },
} satisfies PresentationRegistration<typeof referencePresentation>;

export const materializedDefinitionIsNotARegistration = {
  // @ts-expect-error A materialized definition is not a Presentation program.
  presentation: referencePresentation({ emphasis: "neutral" }),
  themes: { default: { emphasis: "neutral" } },
} satisfies PresentationRegistration<typeof referencePresentation>;

export const invalidDeclarationPresentation = ((_) => ({
  Badge: (_) => ({
    // @ts-expect-error CSS and other platform properties are absent from this language.
    Root: { color: "red" },
  }),
  Child: { Dot: (_) => ({}) },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

type DotRootTarget = PresentationTarget<"Root", readonly [Fixture["Features"]["child"], "Dot"]>;

function acceptDotRoot(_target: DotRootTarget): void {}

export const invalidScopePresentation = ((_) => ({
  Badge: (scope) => {
    // @ts-expect-error Target identities never expose native handles.
    void scope.targets.Root.native;
    // @ts-expect-error Presentation scope cannot invoke Component actions.
    scope.actions.activate();
    // @ts-expect-error Program actions are excluded from structural state.
    scope.state.reset();
    // @ts-expect-error Presentation scope cannot access Capabilities.
    void scope.capabilities;
    // @ts-expect-error A Badge target cannot satisfy a child Dot target.
    acceptDotRoot(scope.targets.Root);
    return {};
  },
  Child: { Dot: (_) => ({}) },
})) satisfies Presentation<Fixture, ReferencePresentationLanguage, Theme>;

type CollisionFixture = {
  Programs: {
    browser: Program<
      ReferenceMain,
      {
        State: { open: boolean };
        Components: {
          Dialog: {
            State: { open: boolean };
            Elements: { Root: "dialog" };
          };
        };
      }
    >;
  };
};

export const invalidCollisionPresentation = ((_) => ({
  Dialog: ({ state }) => {
    // @ts-expect-error Colliding feature and Component state names produce no valid state.
    void state.open;
    return {};
  },
})) satisfies Presentation<CollisionFixture, ReferencePresentationLanguage, Theme>;

function behaviorCannotReadPresentation(
  initialize: ComponentStateInitializationScope<Fixture, Fixture, "Badge">,
  action: ComponentActionScope<Fixture, Fixture, "Badge">,
  start: ComponentStartScope<Fixture, Fixture, "Badge">,
): void {
  // @ts-expect-error Presentation selection is not ambient behavior state.
  void initialize.presentation;
  // @ts-expect-error Theme selection is not ambient behavior state.
  void action.presentation;
  // @ts-expect-error Adapter state is not available to structural lifecycle code.
  void start.presentation;
}

void behaviorCannotReadPresentation;
