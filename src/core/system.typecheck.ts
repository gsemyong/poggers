import { createFeature, type FeatureEnvironmentConflict } from "@/core/feature";
import { createApplication, createSystem, type SystemContractOf } from "@/core/system";
import type { ServerPlatform } from "@/platforms/server";
import {
  type BrowserMainThread,
  type UUID,
  type WebPlatform,
  type WebPresentationLanguage,
} from "@/platforms/web";
import type {
  ConfiguredPresentationFor,
  PresentationRecipe,
} from "@/platforms/web/presentation/language";

type Server = Readonly<{ Name: "server"; Platform: ServerPlatform }>;

type Principal = Readonly<{ id: string }>;
type Identity = Readonly<{ current(input: {}): Promise<Principal | undefined> }>;
type Tasks = Readonly<{
  list(input: {}): Promise<readonly Readonly<{ id: string; title: string }>[]>;
}>;

type IdentityFeature = {
  Programs: {
    server: {
      Environment: Server;
      Provides: { identity: Identity };
    };
  };
};

type TasksFeature = {
  Programs: {
    server: {
      Environment: Server;
      Requires: { identity: Identity };
      Provides: { tasks: Tasks };
    };
  };
};

type ShellFeature = {
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: { identity: Identity; tasks: Tasks };
      State: { ready: boolean };
      Actions: { refresh(): void };
      Components: { Root: { Elements: { Root: "main" } } };
      Routes: {
        home: { Path: "" };
        task: {
          Path: "tasks/:id";
          Params: { id: UUID };
        };
      };
    };
  };
};

type Operations = {
  Features: {
    identity: IdentityFeature;
    tasks: TasksFeature;
    shell: ShellFeature;
  };
  Interfaces: WebPlatform<{ Mounts: { shell: { Path: "" } } }>;
};

const identity = createFeature<IdentityFeature>({
  programs: {
    server: {
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
    server: {
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

const shell = createFeature<ShellFeature>({
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
          view({ components: { Root } }) {
            return Root({});
          },
        },
        task: {
          view({ components: { Root }, params }) {
            params.id satisfies string;
            return Root({});
          },
        },
      },
    },
  },
});

const operationsPresentation = {
  parameters: {},
  create: () => ({
    Shell: () => ({
      Root: () => ({ Root: {} }),
    }),
  }),
} satisfies ConfiguredPresentationFor<Operations, WebPresentationLanguage>;

const operations = createApplication<Operations>({
  interfaces: {
    web: {
      presentation: operationsPresentation,
      installation: {
        start: { feature: "shell", route: "home" },
        icons: [],
        offline: { fallback: { feature: "shell", route: "home" } },
      },
    },
  },
});

const system = createSystem({
  metadata: { name: "Company" },
  features: { identity, tasks, shell },
  applications: { operations },
});

type Contract = SystemContractOf<typeof system>;
type OperationsProof = Contract["Applications"]["operations"] extends Operations ? true : never;
const operationsProof: OperationsProof = true;
void operationsProof;

export type SystemConflictProbe = FeatureEnvironmentConflict<Contract>;

const surface: PresentationRecipe<
  Readonly<{ emphasized: boolean }>,
  Readonly<{ opacity: number }>
> = ({ emphasized }) => ({ opacity: emphasized ? 1 : 0.72 });
const emphasized = { ...surface({ emphasized: false }), opacity: 1 };
emphasized.opacity satisfies number;

type WrongApplication = {
  Features: { identity: IdentityFeature };
  Interfaces: WebPlatform;
};

const wrongApplication = createApplication<WrongApplication>({
  interfaces: {
    web: {
      presentation: {
        parameters: {},
        create: () => ({ Identity: () => ({}) }),
      },
    },
  },
});

// Ordinary reusable Features have no ambient access to the consuming System.
// @ts-expect-error Identity declares no sibling or System-wide task API.
void identity.features.tasks;

createApplication<Operations>({
  interfaces: {
    web: { presentation: operationsPresentation },
  },
  // @ts-expect-error Applications are composed only by a System, never recursively.
  applications: { nested: operations },
});

createApplication<Operations>({
  interfaces: {
    web: { presentation: operationsPresentation },
  },
  // @ts-expect-error Programs belong to Features, not Applications.
  programs: {},
});

createSystem<{
  Features: { identity: IdentityFeature };
  Applications: { wrong: WrongApplication };
}>({
  // @ts-expect-error Every declared System Feature needs one concrete implementation.
  features: {},
  applications: { wrong: wrongApplication },
});

void system;
