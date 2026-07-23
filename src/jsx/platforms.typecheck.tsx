import type { JSXElement, JSXPlatformRegistration } from "kit/jsx-runtime";

import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import type { UIElement } from "@/core/ui/language";
import type { BrowserMainThread } from "@/platforms/web/platform";

type NativeNode = Readonly<{ id: number }>;
type NativeStackProps = Readonly<{
  axis: "horizontal" | "vertical";
  children?: JSXElement;
}>;

type NativeUI = Readonly<{
  Name: "native-test";
  Child: JSXElement;
  Elements: {
    stack: UIElement<NativeStackProps, NativeNode>;
  };
}>;

type NativePlatform = Readonly<{ Name: "native"; UI: NativeUI }>;
type NativeMain = Readonly<{
  Name: "native-main";
  Platform: NativePlatform;
  UI: NativeUI;
}>;

declare module "kit/jsx-runtime" {
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
