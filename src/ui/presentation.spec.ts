import { expect, it } from "vitest";

import type { PlatformPresentationLanguage, PlatformPrimitive } from "./platform";
import type { Presentation, PresentationRegistration, PresentationTarget } from "./presentation";

type TestPlatform = {
  Name: "test";
  Child: unknown;
  Primitives: {
    surface: PlatformPrimitive<object, unknown, { readonly opacity?: number }>;
    text: PlatformPrimitive<object, unknown, { readonly color?: string }>;
  };
};

type TestOwner = {
  Runtime: { Name: "test"; Platform: TestPlatform };
  State: { ready: boolean };
  Components: {
    Card: {
      Props: { tone: "neutral" | "danger" };
      State: { pressed: boolean };
      Elements: { Root: "surface"; Label: "text" };
    };
  };
};

type Tokens = { readonly foreground: string };
type Language = PlatformPresentationLanguage<TestPlatform>;

const cardPresentation = ((tokens) => ({
  Card({ props, state, targets }) {
    const root: PresentationTarget<"Root", readonly [TestOwner, "Card"]> = targets.Root;
    void root;
    return {
      Root: { opacity: state.ready && !state.pressed ? 1 : 0.8 },
      Label: { color: props.tone === "danger" ? "red" : tokens.foreground },
    };
  },
})) satisfies Presentation<TestOwner, Language, Tokens>;

const registration = {
  presentation: cardPresentation,
  themes: {
    default: { foreground: "black" },
    inverted: { foreground: "white" },
  },
} satisfies PresentationRegistration<typeof cardPresentation>;

it("maps tokens, props, state, and named targets to platform declarations", () => {
  const definition = registration.presentation(registration.themes.inverted);
  const declarations = definition.Card({
    props: { tone: "neutral" },
    state: { ready: true, pressed: false },
    targets: {
      Root: { name: "Root" },
      Label: { name: "Label" },
    },
  });

  expect(declarations).toEqual({ Root: { opacity: 1 }, Label: { color: "white" } });
});
