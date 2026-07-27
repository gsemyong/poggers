import type { JSXElement, JSXPlatformRegistration } from "kit/jsx-runtime";

import { createFeature } from "@/core/feature";
import type { ProgramDefinitionKind } from "@/core/program";
import type { BrowserMainThread } from "@/platforms/web";

type NativeStackProps = Readonly<{
  axis: "horizontal" | "vertical";
  children?: JSXElement;
}>;

type NativeProgramDefinition<Contract> = Contract extends {
  Screens: infer Screens extends Readonly<Record<string, object>>;
}
  ? Readonly<{
      screens: {
        readonly [Name in keyof Screens]: Readonly<{ render(): JSXElement }>;
      };
      initial: Extract<keyof Screens, string>;
    }>
  : never;

interface NativeProgramDefinitionKind extends ProgramDefinitionKind {
  readonly Definition: NativeProgramDefinition<this["Contract"]>;
}

type NativePlatform = Readonly<{
  Name: "native";
  Program: NativeProgramDefinitionKind;
}>;
type NativeMain = Readonly<{
  Name: "native-main";
  Platform: NativePlatform;
}>;
type Program<Environment, Contract extends object = object> = Readonly<
  Contract & { Environment: Environment }
>;

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

const webFeature = createFeature<WebFeature>({
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
});

type NativeFeature = {
  Programs: {
    native: Program<
      NativeMain,
      {
        Screens: {
          Badge: {};
          Page: {};
        };
      }
    >;
  };
};

const nativeFeature = createFeature<NativeFeature>({
  programs: {
    native: {
      screens: {
        Badge: {
          render() {
            return <stack axis="horizontal" />;
          },
        },
        Page: {
          render() {
            return <stack axis="vertical" />;
          },
        },
      },
      initial: "Page",
    },
  },
});

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
