import { expect, it } from "vitest";

import type { UIDefinition, UIElement, UIElementProps, UITarget } from "./ui";

type TestUI = {
  Name: "test";
  Child: unknown;
  Elements: {
    surface: UIElement<{ readonly role?: string }, { readonly kind: "surface" }>;
    text: UIElement<{ readonly value: string }, { readonly kind: "text" }>;
  };
};

const definition: UIDefinition<TestUI> = {} as TestUI;
const props: UIElementProps<TestUI, "text"> = { value: "Hello" };
const target = {} as UITarget<TestUI>;

it("validates one complete UI language", () => {
  expect(definition).toBeDefined();
  expect(props.value).toBe("Hello");
  expect(target).toBeDefined();
});

type InvalidUI = {
  Name: "invalid";
  Child: unknown;
  Elements: { surface: { Props: object } };
};

// @ts-expect-error every Element must define props and a native target
const invalid: UIDefinition<InvalidUI> = {} as InvalidUI;
void invalid;
