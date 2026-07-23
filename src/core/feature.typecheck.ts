import {
  createFeature,
  placePrograms,
  type Feature,
  type FeatureContractOf,
  type PlacedFeature,
} from "@/core/feature";
import type { Program } from "@/core/program";
import { createSystem } from "@/core/system";
import type { BrowserMainThread, BrowserServiceWorker } from "@/platforms/web/platform";

type Message = Readonly<{ id: string; text: string }>;
type ServerPlatform = { readonly Name: "server" };
type Server = { readonly Name: "server"; readonly Platform: ServerPlatform };
type Messages = Readonly<{
  list(): Promise<readonly Message[]>;
  send(input: { text: string }): Promise<void>;
  changes(): AsyncIterable<readonly Message[]>;
}>;
type Store = Readonly<{ append(input: { text: string }): Promise<void> }>;
type Navigation = Readonly<{ push(input: { route: "chat" | "about" }): void }>;
type Clock = Readonly<{ subscribe(receive: () => void): Disposable }>;
type DesktopUI = {
  readonly Name: "desktop";
  readonly Child: unknown;
  readonly Elements: {};
};
type DesktopPlatform = { readonly Name: "desktop"; readonly UI: DesktopUI };
type DesktopMain = {
  readonly Name: "desktop-main";
  readonly Platform: DesktopPlatform;
  readonly UI: DesktopUI;
};

type ChatFeature = {
  Programs: {
    cloud: Program<
      Server,
      {
        Requires: { store: Store };
        Provides: { messages: Messages };
      }
    >;
    browser: Program<
      BrowserMainThread,
      {
        Requires: { messages: Messages; clock: Clock };
        State: { messages: readonly Message[] };
        Actions: {
          receive(input: { messages: readonly Message[] }): void;
          send(input: { text: string }): Promise<void>;
        };
        Components: {
          Chat: {
            State: { draft: string };
            Actions: {
              change(input: { value: string }): string;
              clear(): void;
            };
            Elements: { Root: "main"; Send: "button" };
          };
        };
      }
    >;
    worker: Program<BrowserServiceWorker, { Requires: { messages: Messages } }>;
    desktop: Program<DesktopMain>;
  };
};

const chatFeature = {
  programs: {
    cloud: {
      start({ dependencies: { store } }) {
        let closed = false;
        const messages: Messages = {
          async list() {
            return [];
          },
          async send(input) {
            if (!closed) await store.append(input);
          },
          async *changes() {},
        };
        return {
          messages: {
            ...messages,
            [Symbol.dispose]() {
              closed = true;
            },
          },
        };
      },
    },
    browser: {
      start({ actions, dependencies }) {
        dependencies.messages.list() satisfies Promise<readonly Message[]>;
        actions.send satisfies (input: { text: string }) => Promise<void>;
      },
      state: { messages: [] },
      actions: {
        receive({ state }, { messages }) {
          state.messages = messages;
        },
        send({ dependencies }, input) {
          return dependencies.messages.send(input);
        },
      },
      components: {
        Chat: {
          state: { draft: "" },
          actions: {
            change({ state, dependencies }, { value }) {
              dependencies.messages satisfies Messages;
              state.draft = value;
              // @ts-expect-error Components may access only declared Dependencies.
              void dependencies.unknown;
              return state.draft;
            },
            clear({ state }) {
              state.draft = "";
            },
          },
          mount(scope) {
            scope.elements.Send.element satisfies HTMLButtonElement | null;
            scope.state.draft satisfies string;
            // @ts-expect-error Component mount receives readonly state.
            scope.state.draft = "invalid";
            return scope.dependencies.clock.subscribe(scope.actions.clear);
          },
          view({ feature, state, actions, elements: { Root, Send } }) {
            feature.messages satisfies readonly Message[];
            feature.send satisfies (input: { text: string }) => Promise<void>;
            state.draft satisfies string;
            actions.change satisfies (input: { value: string }) => string;
            // @ts-expect-error Component views receive readonly state.
            state.draft = "invalid";
            Root({ role: "main" });
            Send({ type: "button", "aria-label": "Send message", onPointerDown() {} });
            // @ts-expect-error Web button structure cannot use Three camera props.
            Send({ fov: 42 });
            return null;
          },
        },
      },
    },
    worker: {
      async start({ dependencies }) {
        for await (const messages of dependencies.messages.changes()) {
          messages satisfies readonly Message[];
        }
      },
    },
    desktop: {},
  },
} satisfies Feature<ChatFeature>;

type ShellFeature = {
  Features: { chat: ChatFeature };
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: { navigation: Navigation };
        State: { route: "chat" | "about" };
        Actions: { navigate(input: { route: "chat" | "about" }): void };
        Components: { Root: { Elements: { Root: "div" } } };
      }
    >;
  };
};

const shellFeature = {
  features: { chat: chatFeature },
  programs: {
    browser: {
      state: { route: "chat" },
      actions: {
        navigate({ dependencies, state }, input) {
          dependencies.navigation.push(input);
          state.route = input.route;
        },
      },
      components: {
        Root: {
          view({ components: { Chat }, elements: { Root } }) {
            Chat.Chat satisfies (props?: object) => unknown;
            void Root;
            return null;
          },
        },
      },
      root: "Root",
    },
  },
} satisfies Feature<ShellFeature>;

const system = createSystem({
  metadata: { name: "Messages" },
  features: { shell: createFeature<ShellFeature>(shellFeature) },
});

void system;

type InvalidHeadlessUI = Program<Server, { Components: {} }>;
// @ts-expect-error Headless Environments cannot own UI.
const invalidHeadlessUI: InvalidHeadlessUI = {
  Environment: { Name: "server", Platform: { Name: "server" } },
  Components: {},
};

void invalidHeadlessUI;

type BrokenProvider = {
  Programs: {
    cloud: Program<Server, { Provides: { messages: Messages } }>;
  };
};

const brokenProvider: Feature<BrokenProvider> = {
  programs: {
    cloud: {
      // @ts-expect-error Provided Dependency surfaces must be exact.
      start: () => ({ wrong: true }),
    },
  },
};

void brokenProvider;

type ConflictingEnvironments = {
  Features: {
    first: { Programs: { shared: Program<Server> } };
    second: { Programs: { shared: Program<BrowserServiceWorker> } };
  };
};

// @ts-expect-error Contributions sharing a Program name require one Environment.
const conflictingEnvironments = createSystem({
  features: {
    first: createFeature<ConflictingEnvironments["Features"]["first"]>({
      programs: { shared: {} },
    }),
    second: createFeature<ConflictingEnvironments["Features"]["second"]>({
      programs: { shared: {} },
    }),
  },
});

void conflictingEnvironments;

type SameNamedEnvironmentConflict = {
  Features: {
    first: {
      Programs: {
        shared: Program<{ Name: "worker"; Platform: { Name: "server" } }>;
      };
    };
    second: {
      Programs: {
        shared: Program<{ Name: "worker"; Platform: { Name: "device" } }>;
      };
    };
  };
};

// @ts-expect-error Environment identity includes its Platform, not only its local name.
const sameNamedEnvironmentConflict = createSystem({
  features: {
    first: createFeature<SameNamedEnvironmentConflict["Features"]["first"]>({
      programs: { shared: {} },
    }),
    second: createFeature<SameNamedEnvironmentConflict["Features"]["second"]>({
      programs: { shared: {} },
    }),
  },
});

void sameNamedEnvironmentConflict;

type RemovedComponentSurface = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      { Components: { Root: { State: { open: boolean }; Elements: { Root: "main" } } } }
    >;
  };
};

const removedComponentSurface = {
  programs: {
    browser: {
      components: {
        Root: {
          state: { open: false },
          // @ts-expect-error Statecharts are not part of the Component surface.
          machine: { initial: "closed" },
          view: () => null,
        },
      },
    },
  },
} satisfies Feature<RemovedComponentSurface>;

void removedComponentSurface;

type OwnedStartResource = { Programs: { worker: Program<BrowserServiceWorker> } };

const invalidCleanupCallback = {
  programs: {
    worker: {
      // @ts-expect-error Environment ownership accepts resources, not cleanup callbacks.
      start: () => () => undefined,
    },
  },
} satisfies Feature<OwnedStartResource>;

void invalidCleanupCallback;

type LogicalPlacement = {
  Programs: {
    server: Program<Server>;
    browser: Program<BrowserMainThread>;
  };
  Features: {
    child: { Programs: { server: Program<Server> } };
  };
};

const logicalPlacement: Feature<LogicalPlacement> = {
  programs: { server: {}, browser: {} },
  features: { child: { programs: { server: {} } } },
};
const placedPrograms = placePrograms(logicalPlacement, { server: "api" });
const placedProgramsProof: Feature<PlacedFeature<LogicalPlacement, { server: "api" }>> =
  placedPrograms;
const inferredPlacedProgramsProof: Feature<FeatureContractOf<typeof placedPrograms>> =
  placedPrograms;
void placedPrograms.programs.api;
void placedPrograms.programs.browser;
void placedPrograms.features.child.programs.api;
// @ts-expect-error Placement removes the logical role from the realized Feature contract.
void placedPrograms.programs.server;
void placedProgramsProof;
void inferredPlacedProgramsProof;
