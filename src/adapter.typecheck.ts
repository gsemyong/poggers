import type {
  ApplicationInterfaceKind,
  DevelopmentSession,
  PlatformAdapter,
  PlatformAdapters,
  ProgramDefinitionKind,
  ProductionArtifacts,
} from "@/adapter";
import { createFeature } from "@/core/feature";
import { createApplication } from "@/core/system";
import type { ServerPlatform } from "@/platforms/server";

type IOSProgramDefinition<Name> = Readonly<{ scene: Extract<Name, string> }>;

interface IOSProgramDefinitionKind extends ProgramDefinitionKind {
  readonly Definition: IOSProgramDefinition<this["ProgramName"]>;
}

interface IOSApplicationInterfaceKind extends ApplicationInterfaceKind {
  readonly Definition: Readonly<{
    navigation: Readonly<{ title: string }>;
    appearance: Readonly<{ tint: string }>;
  }>;
}

type IOSPlatform = {
  readonly Name: "ios";
  readonly Program: IOSProgramDefinitionKind;
  readonly Application: IOSApplicationInterfaceKind;
};
type CanvasProgramDefinition<Contract> = Contract extends {
  World: infer World extends object;
}
  ? Readonly<{ world: World }>
  : never;
interface CanvasProgramDefinitionKind extends ProgramDefinitionKind {
  readonly Definition: CanvasProgramDefinition<this["Contract"]>;
}
interface CanvasApplicationInterfaceKind extends ApplicationInterfaceKind {
  readonly Definition: Readonly<{
    surface: "full-screen" | "embedded";
    shader: Readonly<{ clearColor: readonly [number, number, number, number] }>;
  }>;
}
type CanvasPlatform = {
  readonly Name: "canvas";
  readonly Program: CanvasProgramDefinitionKind;
  readonly Application: CanvasApplicationInterfaceKind;
};

type Server = { readonly Name: "server"; readonly Platform: ServerPlatform };
type IOSForeground = { readonly Name: "ios-foreground"; readonly Platform: IOSPlatform };
type CanvasMain = { readonly Name: "canvas-main"; readonly Platform: CanvasPlatform };

type MultiPlatformFeature = {
  Programs: {
    server: { Environment: Server };
    ios: { Environment: IOSForeground };
    canvas: { Environment: CanvasMain; World: { gravity: number } };
  };
};

const feature = createFeature<MultiPlatformFeature>({
  programs: {
    server: {},
    ios: { scene: "ios" },
    canvas: { world: { gravity: 9.81 } },
  },
});

createFeature<MultiPlatformFeature>({
  programs: {
    server: {},
    // @ts-expect-error The iOS Program language owns and requires its scene declaration.
    ios: {},
    canvas: { world: { gravity: 9.81 } },
  },
});

createFeature<MultiPlatformFeature>({
  programs: {
    server: {},
    ios: { scene: "ios" },
    // @ts-expect-error The Canvas Program language owns its implementation shape.
    canvas: { scene: "canvas" },
  },
});

type HeadlessUIFeature = {
  Programs: {
    server: {
      Environment: Server;
      Scene: {};
    };
  };
};

createFeature<HeadlessUIFeature>({
  // @ts-expect-error The headless language rejects every undeclared dialect field.
  programs: { server: {} },
});

createApplication<{
  Features: { root: MultiPlatformFeature };
  Interfaces: IOSPlatform | CanvasPlatform;
}>({
  interfaces: {
    ios: {
      navigation: { title: "Application" },
      appearance: { tint: "accent" },
    },
    canvas: {
      surface: "full-screen",
      shader: { clearColor: [0, 0, 0, 1] },
    },
  },
});

createApplication<{
  Features: { root: MultiPlatformFeature };
  Interfaces: IOSPlatform;
}>({
  interfaces: {
    ios: {
      navigation: {
        // @ts-expect-error The iOS Application interface owns the title value type.
        title: 42,
      },
      appearance: { tint: "accent" },
    },
  },
});

const session = {} as DevelopmentSession;
const artifacts = {} as ProductionArtifacts;

type IOSAdapter = PlatformAdapter<IOSPlatform> &
  Readonly<{
    ui: Readonly<{
      mount(): Readonly<{ render(view: string): void }>;
    }>;
  }>;
type CanvasAdapter = PlatformAdapter<CanvasPlatform> &
  Readonly<{
    renderer: Readonly<{
      draw(world: Readonly<{ gravity: number }>): void;
    }>;
  }>;

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
  ui: {
    mount() {
      return { render(_view: string) {} };
    },
  },
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
} satisfies IOSAdapter;

const canvasAdapter = {
  name: "canvas",
  renderer: { draw(_world: Readonly<{ gravity: number }>) {} },
  async develop() {
    return session;
  },
  async build() {
    return artifacts;
  },
} satisfies CanvasAdapter;

const adapters = {
  canvas: canvasAdapter,
  ios: iosAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<CanvasPlatform | IOSPlatform | ServerPlatform>;
void [feature, adapters];

const missingAdapter = {
  ios: iosAdapter,
  server: serverAdapter,
  // @ts-expect-error Every declared Platform requires one adapter binding.
} satisfies PlatformAdapters<CanvasPlatform | IOSPlatform | ServerPlatform>;
void missingAdapter;

const wrongAdapter = {
  canvas: canvasAdapter,
  // @ts-expect-error Adapter identity must match its Platform key.
  ios: serverAdapter,
  server: serverAdapter,
} satisfies PlatformAdapters<CanvasPlatform | IOSPlatform | ServerPlatform>;
void wrongAdapter;
