import { expect, it } from "vitest";

import type {
  UIPlatformAdapter,
  UIPlatformDefinition,
  UIPlatformPrimitive,
  UIPlatformPrimitiveProps,
  UIPlatformTarget,
} from "./platform";
import type { PresentationAdapter } from "./presentation";

type TestPlatform = {
  Name: "test";
  Child: unknown;
  Primitives: {
    surface: UIPlatformPrimitive<{ readonly role?: string }, { readonly kind: "surface" }>;
    text: UIPlatformPrimitive<{ readonly value: string }, { readonly kind: "text" }>;
  };
};

const definition: UIPlatformDefinition<TestPlatform> = {} as TestPlatform;
const props: UIPlatformPrimitiveProps<TestPlatform, "text"> = { value: "Hello" };

const presentation = {
  create() {
    return { commit() {}, dispose() {} };
  },
} satisfies PresentationAdapter<
  {
    Declarations: {
      surface: { readonly opacity?: number };
      text: { readonly color?: string };
    };
  },
  UIPlatformTarget<TestPlatform>
>;

const adapter = {
  name: "test",
  component: { mount() {} },
  presentation,
} satisfies UIPlatformAdapter<TestPlatform, { mount(): void }, typeof presentation>;

it("pairs one platform contract with its structure and presentation adapters", () => {
  expect(definition).toBeDefined();
  expect(props.value).toBe("Hello");
  expect(adapter.name).toBe("test");
});

type InvalidPlatform = {
  Name: "invalid";
  Child: unknown;
  Primitives: { surface: { Props: object } };
};

// @ts-expect-error every primitive must define props and a native target
const invalid: UIPlatformDefinition<InvalidPlatform> = {} as InvalidPlatform;
void invalid;
