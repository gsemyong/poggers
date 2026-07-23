import type {
  DevelopmentSession,
  PresentationAdapter,
  PlatformAdapter,
  PlatformAdapters,
  ProductionArtifacts,
  UIAdapter,
} from "@/contracts/platform";
import type { Program } from "@/core/program";
import type { UIElement } from "@/core/ui/language";

type IOSView = { readonly kind: "ios-view" };
type OtherTarget = { readonly kind: "other" };

type IOSUI = {
  readonly Name: "ios";
  readonly Child: string;
  readonly Elements: {
    readonly stack: UIElement<object, IOSView>;
  };
};

type OtherUI = {
  readonly Name: "other";
  readonly Child: number;
  readonly Elements: {
    readonly surface: UIElement<object, OtherTarget>;
  };
};

type IOSPresentation = {
  readonly Declarations: { readonly stack: Readonly<{ color?: string }> };
  readonly Environment: Readonly<{ scale: number }>;
  readonly Observations: { readonly stack: Readonly<{ size: number }> };
};

type OtherPresentation = {
  readonly Declarations: { readonly surface: Readonly<{ material?: string }> };
  readonly Environment: Readonly<Record<never, never>>;
  readonly Observations: { readonly surface: Readonly<{ visible: boolean }> };
};

type ServerPlatform = { readonly Name: "server" };
type IOSPlatform = { readonly Name: "ios"; readonly UI: IOSUI };
type Server = { readonly Name: "server"; readonly Platform: ServerPlatform };
type IOSForeground = {
  readonly Name: "ios-foreground";
  readonly Platform: IOSPlatform;
  readonly UI: IOSUI;
};
type IOSBackground = { readonly Name: "ios-background"; readonly Platform: IOSPlatform };
type IOSWidget = {
  readonly Name: "ios-widget";
  readonly Platform: IOSPlatform;
  readonly UI: IOSUI;
};

type ServerProgram = Program<Server>;
type IOSProgram = Program<IOSForeground, { Components: { Root: { Elements: { Root: "stack" } } } }>;
type IOSBackgroundProgram = Program<IOSBackground>;
type IOSWidgetProgram = Program<
  IOSWidget,
  { Components: { Root: { Elements: { Root: "stack" } } } }
>;

const serverProgram: ServerProgram = { Environment: {} as Server };
const iosProgram: IOSProgram = {
  Environment: {} as IOSForeground,
  Components: { Root: { Elements: { Root: "stack" } } },
};
const iosBackgroundProgram: IOSBackgroundProgram = { Environment: {} as IOSBackground };
const iosWidgetProgram: IOSWidgetProgram = {
  Environment: {} as IOSWidget,
  Components: { Root: { Elements: { Root: "stack" } } },
};
void [serverProgram, iosProgram, iosBackgroundProgram, iosWidgetProgram];

type WrongUIEnvironment = {
  readonly Name: "wrong";
  readonly Platform: IOSPlatform;
  readonly UI: OtherUI;
};
type WrongUIProgram = Program<WrongUIEnvironment, { Components: {} }>;
// @ts-expect-error An Environment cannot use another Platform's UI language.
const wrongUIProgram: WrongUIProgram = { Environment: {} as WrongUIEnvironment, Components: {} };
void wrongUIProgram;

type HeadlessUIProgram = Program<Server, { Components: {} }>;
// @ts-expect-error A process-only Platform cannot receive UI declarations.
const headlessUIProgram: HeadlessUIProgram = { Environment: {} as Server, Components: {} };
void headlessUIProgram;

const session = {} as DevelopmentSession;
const artifacts = {} as ProductionArtifacts;
const iosComponentAdapter = {
  createApplicationUI() {
    return {
      renderRoot() {
        return "ios";
      },
      dispose() {},
    };
  },
};
const iosPresentationAdapter = {} as PresentationAdapter<IOSPresentation, IOSView>;
const iosUIAdapter = {
  name: "ios",
  component: iosComponentAdapter,
  presentation: iosPresentationAdapter,
} satisfies UIAdapter<IOSUI, typeof iosComponentAdapter, typeof iosPresentationAdapter>;

const wrongComponentAdapter = {
  createApplicationUI() {
    return { renderRoot: () => 1, dispose() {} };
  },
};
const wrongComponentUIAdapter = {
  name: "ios",
  // @ts-expect-error A Component adapter must render the UI language's Child type.
  component: wrongComponentAdapter,
  presentation: iosPresentationAdapter,
} satisfies UIAdapter<IOSUI, typeof wrongComponentAdapter, typeof iosPresentationAdapter>;
void wrongComponentUIAdapter;

const wrongPresentationLanguage = {} as PresentationAdapter<OtherPresentation, IOSView>;
const wrongPresentationUIAdapter = {
  name: "ios",
  component: iosComponentAdapter,
  // @ts-expect-error Presentation declarations and observations must cover the same UI Elements.
  presentation: wrongPresentationLanguage,
} satisfies UIAdapter<IOSUI, typeof iosComponentAdapter, typeof wrongPresentationLanguage>;
void wrongPresentationUIAdapter;

const wrongPresentationTarget = {} as PresentationAdapter<IOSPresentation, OtherTarget>;
const wrongTargetUIAdapter = {
  name: "ios",
  component: iosComponentAdapter,
  // @ts-expect-error Presentation targets must accept every target exposed by the UI language.
  presentation: wrongPresentationTarget,
} satisfies UIAdapter<IOSUI, typeof iosComponentAdapter, typeof wrongPresentationTarget>;
void wrongTargetUIAdapter;

const serverAdapter = {
  name: "server",
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
} satisfies PlatformAdapter<ServerPlatform>;

const iosAdapter = {
  name: "ios",
  ui: iosUIAdapter,
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
} satisfies PlatformAdapter<IOSPlatform, typeof iosUIAdapter>;

const adapters = {
  ios: iosAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<IOSPlatform | ServerPlatform>;
void adapters;

const missingAdapter = {
  ios: iosAdapter,
  // @ts-expect-error Every declared Platform requires an adapter binding.
} satisfies PlatformAdapters<IOSPlatform | ServerPlatform>;
void missingAdapter;

const extraAdapter = {
  ios: iosAdapter,
  server: serverAdapter,
  // @ts-expect-error Adapter maps reject undeclared Platform bindings.
  other: iosAdapter,
} satisfies PlatformAdapters<IOSPlatform | ServerPlatform>;
void extraAdapter;

const wrongAdapter = {
  // @ts-expect-error Adapter identity must match its Platform key.
  ios: serverAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<IOSPlatform | ServerPlatform>;
void wrongAdapter;

const otherComponentAdapter = {
  createApplicationUI() {
    return { renderRoot: () => 1, dispose() {} };
  },
};
const crossedUIAdapter = {
  name: "other",
  component: otherComponentAdapter,
  presentation: {} as PresentationAdapter<OtherPresentation, OtherTarget>,
} satisfies UIAdapter<
  OtherUI,
  typeof otherComponentAdapter,
  PresentationAdapter<OtherPresentation, OtherTarget>
>;

const crossedPlatformAdapter = {
  name: "ios",
  ui: crossedUIAdapter,
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
};
// @ts-expect-error A Platform Adapter cannot realize another Platform's UI contract.
const invalidIOSAdapter: PlatformAdapter<IOSPlatform> = crossedPlatformAdapter;
void invalidIOSAdapter;

type MultiPlatformPrograms = readonly [ServerProgram, IOSProgram, IOSBackgroundProgram];
const multiPlatformPrograms = [] as unknown as MultiPlatformPrograms;
void multiPlatformPrograms;
