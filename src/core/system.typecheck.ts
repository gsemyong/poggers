import { createFeature, type FeatureEnvironmentConflict } from "@/core/feature";
import type { Program } from "@/core/program";
import {
  createApp,
  createSystem,
  type AppFeatureContract,
  type PlatformInterface,
  type SystemContractOf,
} from "@/core/system";
import type { UIElement } from "@/core/ui/language";
import type { ConfiguredPresentationFor, PresentationRecipe } from "@/core/ui/presentation";
import {
  createWebInterface,
  type BrowserMainThread,
  type WebFeature,
  type WebPresentationLanguage,
  type WebRoute,
} from "@/platforms/web";

type ServerPlatform = Readonly<{ Name: "server" }>;
type Server = Readonly<{ Name: "server"; Platform: ServerPlatform }>;
type NativeUI = Readonly<{
  Name: "native";
  Child: unknown;
  Elements: { View: UIElement<{}, unknown> };
}>;
type NativePlatform = Readonly<{ Name: "native"; UI: NativeUI }>;

type Principal = Readonly<{ id: string }>;
type Identity = Readonly<{ current(input: {}): Promise<Principal | undefined> }>;
type Tasks = Readonly<{
  list(input: {}): Promise<readonly Readonly<{ id: string; title: string }>[]>;
}>;

type IdentityFeature = {
  Programs: {
    api: Program<Server, { Provides: { identity: Identity } }>;
  };
};

type TasksFeature = {
  Programs: {
    api: Program<
      Server,
      {
        Requires: { identity: Identity };
        Provides: { tasks: Tasks };
      }
    >;
  };
};

type ShellFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: { identity: Identity; tasks: Tasks };
        State: { ready: boolean };
        Actions: { refresh(): void };
        Components: { Root: { Elements: { Root: "main" } } };
        Routes: { home: WebRoute<{ Path: "" }> };
      }
    >;
  };
};

type Operations = {
  Features: {
    identity: IdentityFeature;
    tasks: TasksFeature;
    shell: ShellFeature;
  };
};

const identity = createFeature<IdentityFeature>({
  programs: {
    api: {
      start: () => ({
        identity: {
          async current() {
            return undefined;
          },
        },
      }),
    },
  },
});

const tasks = createFeature<TasksFeature>({
  programs: {
    api: {
      start: () => ({
        tasks: {
          async list() {
            return [];
          },
        },
      }),
    },
  },
});

const shell: WebFeature<ShellFeature, Operations> = {
  programs: {
    browser: {
      state: { ready: false },
      actions: {
        refresh({ dependencies, state }) {
          dependencies.identity satisfies Identity;
          dependencies.tasks satisfies Tasks;
          state.ready = true;
        },
      },
      components: {
        Root: {
          view({ elements: { Root } }) {
            return Root({});
          },
        },
      },
      root: "Root",
      routes: {
        home: {
          view({ components: { Shell } }) {
            return Shell.Root({});
          },
        },
      },
    },
  },
};

const operationsPresentation = {
  parameters: {},
  create: () => ({
    Shell: () => ({
      Root: () => ({ Root: {} }),
    }),
  }),
} satisfies ConfiguredPresentationFor<Operations, WebPresentationLanguage>;

const web = createWebInterface<Operations>({
  presentation: operationsPresentation,
  installation: {
    start: { to: "shell.home" },
    icons: [],
    offline: { fallback: { to: "shell.home" } },
  },
});

const native = {} as PlatformInterface<Operations, NativePlatform>;

const operations = createApp({
  features: { identity, tasks, shell },
  interfaces: { web, native },
});

const system = createSystem({
  metadata: { name: "Company" },
  features: { operations },
});

type Contract = SystemContractOf<typeof system>;
type OperationsProof =
  Contract["Features"]["operations"] extends AppFeatureContract<Operations> ? true : never;
const operationsProof: OperationsProof = true;
void operationsProof;

export type SystemConflictProbe = FeatureEnvironmentConflict<{
  Features: {
    operations: AppFeatureContract<Operations>;
  };
}>;

const surface: PresentationRecipe<
  Readonly<{ emphasized: boolean }>,
  Readonly<{ opacity: number }>
> = ({ emphasized }) => ({ opacity: emphasized ? 1 : 0.72 });
const emphasized = { ...surface({ emphasized: false }), opacity: 1 };
emphasized.opacity satisfies number;

type Other = { Features: { identity: IdentityFeature } };
const wrongOwner = createWebInterface<Other>({
  presentation: {
    parameters: {},
    create: () => ({ Identity: () => ({}) }),
  },
});

// @ts-expect-error An interface is bound to one exact App Feature contract.
createApp({ features: { identity, tasks, shell }, interfaces: { web: wrongOwner } });

// Ordinary reusable Features have no ambient access to the consuming System.
// @ts-expect-error Identity declares no sibling or System-wide task API.
void identity.features.tasks;

// @ts-expect-error App is a Feature composition, not a second nested App registry.
createApp({ apps: { nested: operations } });

void system;
