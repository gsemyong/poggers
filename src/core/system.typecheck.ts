import { createFeature, type FeatureEnvironmentConflict } from "@/core/application";
import type { Program } from "@/core/program";
import {
  createApp,
  createSystem,
  type AppFeatureContract,
  type PlatformInterfaceContract,
  type SystemContractOf,
} from "@/core/system";
import type { UIElement } from "@/core/ui/language";
import type {
  ConfiguredPresentationFor,
  PresentationFactory,
  PresentationRecipe,
} from "@/core/ui/presentation";
import {
  createWebInterface,
  type BrowserMainThread,
  type ConfiguredWebPresentation,
  type WebPresentationLanguage,
  type WebRoute,
  type WebPlatform,
} from "@/platforms/web/platform";

type ServerPlatform = Readonly<{ Name: "server" }>;
type Server = Readonly<{ Name: "server"; Platform: ServerPlatform }>;
type NativeUI = Readonly<{
  Name: "native";
  Child: unknown;
  Elements: { View: UIElement<{}, unknown> };
}>;
type NativePlatform = Readonly<{ Name: "native"; UI: NativeUI }>;
type NativeMain = Readonly<{
  Name: "native-main";
  Platform: NativePlatform;
  UI: NativeUI;
}>;

type Principal = Readonly<{ id: string }>;
type Identity = Readonly<{
  current(input: {}): Promise<Principal | undefined>;
}>;
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

type OperationsWebContract = {
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

type OperationsWeb = PlatformInterfaceContract<OperationsWebContract, WebPlatform>;

type OperationsNative = PlatformInterfaceContract<
  {
    Programs: {
      native: Program<
        NativeMain,
        {
          Requires: { identity: Identity; tasks: Tasks };
          Components: { Root: { Elements: { Root: "View" } } };
        }
      >;
    };
  },
  NativePlatform
>;

type Operations = {
  Features: {
    web: OperationsWeb;
    native: OperationsNative;
  };
};

type CustomerWebContract = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: { identity: Identity };
        Components: { CustomerRoot: { Elements: { Root: "main" } } };
        Routes: { home: WebRoute<{ Path: "" }> };
      }
    >;
  };
};

type CustomerWeb = PlatformInterfaceContract<CustomerWebContract, WebPlatform>;

type Customer = { Features: { web: CustomerWeb } };

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

const operationsPresentationFactory: PresentationFactory<
  OperationsWeb,
  WebPresentationLanguage,
  {}
> = (parameters) => ({
  parameters,
  create: () => ({
    Root: () => ({ Root: {} }),
  }),
});
const operationsPresentation = operationsPresentationFactory({});

const operationsWeb = createWebInterface<OperationsWebContract>({
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
      },
    },
  },
  presentation: operationsPresentation,
  installation: {
    start: { to: "home" },
    icons: [],
    offline: { fallback: { to: "home" } },
  },
});

const operationsNative = createFeature<OperationsNative>({
  programs: {
    native: {
      components: {
        Root: {
          view() {
            return null;
          },
        },
      },
      root: "Root",
    },
  },
});

const operations = createApp<Operations>({
  features: { web: operationsWeb, native: operationsNative },
});

const customerPresentation = {
  parameters: {},
  create: () => ({
    CustomerRoot: () => ({ Root: {} }),
  }),
} satisfies ConfiguredWebPresentation<CustomerWeb>;

const customerWeb = createWebInterface<CustomerWebContract>({
  programs: {
    browser: {
      components: {
        CustomerRoot: {
          view({ elements: { Root } }) {
            return Root({});
          },
        },
      },
      root: "CustomerRoot",
      routes: {
        home: {
          view({ components: { CustomerRoot } }) {
            return CustomerRoot({});
          },
        },
      },
    },
  },
  presentation: customerPresentation,
  installation: {
    start: { to: "home" },
    icons: [],
    offline: { fallback: { to: "home" } },
  },
});

const customer = createApp<Customer>({ features: { web: customerWeb } });

export type SystemConflictProbe = FeatureEnvironmentConflict<{
  Features: {
    identity: IdentityFeature;
    tasks: TasksFeature;
    operations: AppFeatureContract<Operations>;
    customer: AppFeatureContract<Customer>;
  };
}>;

const system = createSystem({
  metadata: { name: "Company" },
  features: { identity, tasks, operations, customer },
});

type Contract = SystemContractOf<typeof system>;
type OperationsProof =
  Contract["Features"]["operations"] extends AppFeatureContract<Operations> ? true : never;
const operationsProof: OperationsProof = true;
void operationsProof;

const surface: PresentationRecipe<
  Readonly<{ emphasized: boolean }>,
  Readonly<{ opacity: number }>
> = ({ emphasized }) => ({ opacity: emphasized ? 1 : 0.72 });
const emphasized = { ...surface({ emphasized: false }), opacity: 1 };
emphasized.opacity satisfies number;

// A Presentation is owned by one exact interface Component contract.
// @ts-expect-error CustomerRoot cannot present the operations Root contract.
const incompatiblePresentation: ConfiguredPresentationFor<OperationsWeb, WebPresentationLanguage> =
  customerPresentation;
void incompatiblePresentation;

// Ordinary reusable Features have no ambient access to their consuming System.
// @ts-expect-error Identity declares no sibling or System-wide task API.
void identity.features.tasks;

// @ts-expect-error App is a Feature factory, not a second nested App registry.
createApp<{ Apps: { nested: Operations } }>({ apps: { nested: operations } });

type DuplicateAppIdentity = { operations: typeof operations } & {
  operations: typeof customer;
};
// @ts-expect-error One Feature key cannot identify two incompatible Apps.
const duplicateApps: DuplicateAppIdentity = { operations };
void duplicateApps;

type DuplicateInterfaceIdentity = { web: typeof operationsWeb } & {
  web: typeof customerWeb;
};
// @ts-expect-error One Feature key cannot identify two incompatible interfaces.
const duplicateInterfaces: DuplicateInterfaceIdentity = { web: operationsWeb };
void duplicateInterfaces;

void system;
