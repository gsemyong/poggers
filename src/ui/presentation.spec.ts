import { expect, it } from "vitest";

import type { UIPlatformPrimitive } from "./platform";
import type { Presentation, PresentationTarget } from "./presentation";

type TestPlatform = {
  Name: "test";
  Child: unknown;
  Primitives: {
    surface: UIPlatformPrimitive<object, unknown>;
    text: UIPlatformPrimitive<object, unknown>;
  };
};

type TestOwner = {
  Environment: { Name: "test"; UI: TestPlatform };
  State: { ready: boolean };
  Components: {
    Card: {
      Props: { tone: "neutral" | "danger" };
      State: { pressed: boolean };
      Elements: { Root: "surface"; Label: "text" };
    };
  };
};

type Parameters = { readonly foreground: string };
type Language = {
  Declarations: {
    surface: { readonly opacity?: number };
    text: { readonly color?: string };
  };
};

const cardPresentation = ((tokens) => ({
  Card({ props, state, targets }) {
    const root: PresentationTarget<"Root", readonly [TestOwner, "Card"]> = targets.Root;
    void root;
    return {
      Root: { opacity: state.ready && !state.pressed ? 1 : 0.8 },
      Label: { color: props.tone === "danger" ? "red" : tokens.foreground },
    };
  },
})) satisfies Presentation<TestOwner, Language, Parameters>;

const inverted = cardPresentation({ foreground: "white" });

it("maps parameters, props, state, and named targets to platform declarations", () => {
  const declarations = inverted.Card({
    props: { tone: "neutral" },
    state: { ready: true, pressed: false },
    targets: {
      Root: { name: "Root" },
      Label: { name: "Label" },
    },
  });

  expect(declarations).toEqual({ Root: { opacity: 1 }, Label: { color: "white" } });
});

type MultimodalLanguage = {
  Declarations: {
    surface: { readonly sound?: string; readonly haptic?: readonly number[] };
    text: { readonly speech?: string; readonly emphasis?: number };
  };
};

const multimodal = ((parameters) => ({
  Card({ props, state }) {
    return {
      Root: state.pressed ? { haptic: parameters.pressPattern } : {},
      Label: {
        emphasis: state.ready ? 1 : 0,
        speech: props.tone === "danger" ? parameters.warning : undefined,
      },
    };
  },
})) satisfies Presentation<
  TestOwner,
  MultimodalLanguage,
  { readonly pressPattern: readonly number[]; readonly warning: string }
>;

it("accepts adapter-defined meaning unrelated to styling or motion", () => {
  const definition = multimodal({ pressPattern: [8, 24], warning: "Warning" });
  expect(
    definition.Card({
      props: { tone: "danger" },
      state: { ready: true, pressed: true },
      targets: { Root: { name: "Root" }, Label: { name: "Label" } },
    }),
  ).toEqual({
    Root: { haptic: [8, 24] },
    Label: { emphasis: 1, speech: "Warning" },
  });
});
