import { expect, it } from "vitest";

import type {
  PlatformAdapter,
  PlatformDefinition,
  PlatformPresentationLanguage,
  PlatformPrimitive,
  PlatformPrimitiveProps,
  PlatformTarget,
} from "./platform";
import type { PresentationAdapter } from "./presentation";

type TestPlatform = {
  Name: "test";
  Child: unknown;
  Primitives: {
    surface: PlatformPrimitive<
      { readonly role?: string },
      { readonly kind: "surface" },
      { readonly opacity?: number }
    >;
    text: PlatformPrimitive<
      { readonly value: string },
      { readonly kind: "text" },
      { readonly color?: string }
    >;
  };
};

const definition: PlatformDefinition<TestPlatform> = {} as TestPlatform;
const props: PlatformPrimitiveProps<TestPlatform, "text"> = { value: "Hello" };

const presentation = {
  create() {
    return { commit() {}, dispose() {} };
  },
} satisfies PresentationAdapter<
  PlatformPresentationLanguage<TestPlatform>,
  PlatformTarget<TestPlatform>
>;

const adapter = {
  name: "test",
  structure: { mount() {} },
  presentation,
} satisfies PlatformAdapter<TestPlatform, { mount(): void }>;

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

// @ts-expect-error every primitive must define props, a native target, and presentation meaning
const invalid: PlatformDefinition<InvalidPlatform> = {} as InvalidPlatform;
void invalid;
