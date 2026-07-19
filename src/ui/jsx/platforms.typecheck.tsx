import type { JSXElement, JSXPlatformRegistration } from "@poggers/kit/jsx-runtime";

import type { Feature, Program } from "../../application";
import type { UIPlatformPrimitive } from "../platform";
import type { BrowserMainThread } from "../web/platform";

type NativeNode = Readonly<{ id: number }>;
type NativeStackProps = Readonly<{
  axis: "horizontal" | "vertical";
  children?: JSXElement;
}>;

type NativeUIPlatform = Readonly<{
  Name: "native-test";
  Child: JSXElement;
  Primitives: {
    stack: UIPlatformPrimitive<NativeStackProps, NativeNode>;
  };
}>;

type NativeMain = Readonly<{ Name: "native-main"; UI: NativeUIPlatform }>;

declare module "@poggers/kit/jsx-runtime" {
  interface JSXPlatforms {
    nativeTest: JSXPlatformRegistration<{
      stack: NativeStackProps;
    }>;
  }
}

type WebFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Components: {
          Page: { Elements: { Root: "main" } };
        };
      }
    >;
  };
};

const webFeature = {
  programs: {
    browser: {
      components: {
        Page: {
          view({ elements: { Root } }) {
            return <Root id="web" />;
          },
        },
      },
      root: "Page",
    },
  },
} satisfies Feature<WebFeature>;

type NativeFeature = {
  Programs: {
    native: Program<
      NativeMain,
      {
        Components: {
          Badge: { Elements: { Root: "stack" } };
          Page: { Elements: { Root: "stack" } };
        };
      }
    >;
  };
};

const nativeFeature = {
  programs: {
    native: {
      components: {
        Badge: {
          view({ elements: { Root } }) {
            return <Root axis="horizontal" />;
          },
        },
        Page: {
          view({ components: { Badge }, elements: { Root } }) {
            return (
              <Root axis="vertical">
                <Badge />
              </Root>
            );
          },
        },
      },
      root: "Page",
    },
  },
} satisfies Feature<NativeFeature>;

const webIntrinsic = <main id="web-intrinsic" />;
const nativeIntrinsic = <stack axis="horizontal" />;

// @ts-expect-error Native-only properties do not cross into the web vocabulary.
const invalidWebIntrinsic = <main axis="vertical" />;
// @ts-expect-error Web-only properties do not cross into the native vocabulary.
const invalidNativeIntrinsic = <stack id="native" axis="vertical" />;

void [
  webFeature,
  nativeFeature,
  webIntrinsic,
  nativeIntrinsic,
  invalidWebIntrinsic,
  invalidNativeIntrinsic,
];
