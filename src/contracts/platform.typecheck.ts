import type { Program } from "../core/application";
import type { PresentationAdapter } from "../core/presentation";
import type { UIElement } from "../core/ui";
import type {
  DevelopmentSession,
  PlatformAdapter,
  PlatformAdapters,
  ProductionArtifacts,
  UIAdapter,
} from "./platform";

type NativeTarget = { readonly kind: "native" };
type OtherTarget = { readonly kind: "other" };

type NativeUI = {
  readonly Name: "native";
  readonly Child: string;
  readonly Elements: {
    readonly stack: UIElement<object, NativeTarget>;
  };
};

type OtherUI = {
  readonly Name: "other";
  readonly Child: number;
  readonly Elements: {
    readonly surface: UIElement<object, OtherTarget>;
  };
};

type NativePresentation = {
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
type NativePlatform = { readonly Name: "native"; readonly UI: NativeUI };
type Server = { readonly Name: "server"; readonly Platform: ServerPlatform };
type NativeMain = {
  readonly Name: "native-main";
  readonly Platform: NativePlatform;
  readonly UI: NativeUI;
};
type NativeWorker = { readonly Name: "native-worker"; readonly Platform: NativePlatform };
type NativeSecondary = {
  readonly Name: "native-secondary";
  readonly Platform: NativePlatform;
  readonly UI: NativeUI;
};

type ServerProgram = Program<Server>;
type NativeProgram = Program<NativeMain, { Components: { Root: { Elements: { Root: "stack" } } } }>;
type NativeWorkerProgram = Program<NativeWorker>;
type NativeSecondaryProgram = Program<NativeSecondary>;

const serverProgram: ServerProgram = { Environment: {} as Server };
const nativeProgram: NativeProgram = {
  Environment: {} as NativeMain,
  Components: { Root: { Elements: { Root: "stack" } } },
};
const nativeWorkerProgram: NativeWorkerProgram = { Environment: {} as NativeWorker };
const nativeSecondaryProgram: NativeSecondaryProgram = { Environment: {} as NativeSecondary };
void [serverProgram, nativeProgram, nativeWorkerProgram, nativeSecondaryProgram];

type WrongUIEnvironment = {
  readonly Name: "wrong";
  readonly Platform: NativePlatform;
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
const nativeComponentAdapter = {
  createApplicationUI() {
    return {
      renderRoot() {
        return "native";
      },
      dispose() {},
    };
  },
};
const nativePresentationAdapter = {} as PresentationAdapter<NativePresentation, NativeTarget>;
const nativeUIAdapter = {
  name: "native",
  component: nativeComponentAdapter,
  presentation: nativePresentationAdapter,
} satisfies UIAdapter<NativeUI, typeof nativeComponentAdapter, typeof nativePresentationAdapter>;

const wrongComponentAdapter = {
  createApplicationUI() {
    return { renderRoot: () => 1, dispose() {} };
  },
};
const wrongComponentUIAdapter = {
  name: "native",
  // @ts-expect-error A Component adapter must render the UI language's Child type.
  component: wrongComponentAdapter,
  presentation: nativePresentationAdapter,
} satisfies UIAdapter<NativeUI, typeof wrongComponentAdapter, typeof nativePresentationAdapter>;
void wrongComponentUIAdapter;

const wrongPresentationLanguage = {} as PresentationAdapter<OtherPresentation, NativeTarget>;
const wrongPresentationUIAdapter = {
  name: "native",
  component: nativeComponentAdapter,
  // @ts-expect-error Presentation declarations and observations must cover the same UI Elements.
  presentation: wrongPresentationLanguage,
} satisfies UIAdapter<NativeUI, typeof nativeComponentAdapter, typeof wrongPresentationLanguage>;
void wrongPresentationUIAdapter;

const wrongPresentationTarget = {} as PresentationAdapter<NativePresentation, OtherTarget>;
const wrongTargetUIAdapter = {
  name: "native",
  component: nativeComponentAdapter,
  // @ts-expect-error Presentation native targets must accept every target exposed by the UI language.
  presentation: wrongPresentationTarget,
} satisfies UIAdapter<NativeUI, typeof nativeComponentAdapter, typeof wrongPresentationTarget>;
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

const nativeAdapter = {
  name: "native",
  ui: nativeUIAdapter,
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
} satisfies PlatformAdapter<NativePlatform, typeof nativeUIAdapter>;

const adapters = {
  native: nativeAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<NativePlatform | ServerPlatform>;
void adapters;

const missingAdapter = {
  native: nativeAdapter,
  // @ts-expect-error Every declared Platform requires an adapter binding.
} satisfies PlatformAdapters<NativePlatform | ServerPlatform>;
void missingAdapter;

const extraAdapter = {
  native: nativeAdapter,
  server: serverAdapter,
  // @ts-expect-error Adapter maps reject undeclared Platform bindings.
  other: nativeAdapter,
} satisfies PlatformAdapters<NativePlatform | ServerPlatform>;
void extraAdapter;

const wrongAdapter = {
  // @ts-expect-error Adapter identity must match its Platform key.
  native: serverAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<NativePlatform | ServerPlatform>;
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
  name: "native",
  ui: crossedUIAdapter,
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
};
// @ts-expect-error A Platform Adapter cannot realize another Platform's UI contract.
const invalidNativeAdapter: PlatformAdapter<NativePlatform> = crossedPlatformAdapter;
void invalidNativeAdapter;

type MultiPlatformPrograms = readonly [ServerProgram, NativeProgram, NativeWorkerProgram];
const multiPlatformPrograms = [] as unknown as MultiPlatformPrograms;
void multiPlatformPrograms;
