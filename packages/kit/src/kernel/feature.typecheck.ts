import type { AppDef, FeatureDef } from "#kernel/app";

type CounterResource = {
  Key: string;
  State: { count: number };
  Presence: { cursor: number };
  Events: { incremented: { by: number } };
  Views: { count: number };
  Commands: { increment: { Input: { by: number }; Event: "incremented" } };
};

type CounterFeature = {
  Resources: { counter: CounterResource };
  Components: {
    Counter: { State: { count: number }; Parts: { Root: "button" } };
  };
  API: {
    count: number;
    increment(input: { by: number }): void;
  };
  Dependencies: { server: { clock: { now(): number } } };
  Programs: { server: { increment: {} } };
};

type ProviderFeature = {
  Resources: {};
  Components: {};
  API: { begin(): Promise<void> };
};

type AuthFeature = {
  Resources: {};
  Components: {};
  Features: { passkey: ProviderFeature };
  API: { signIn(): Promise<void> };
};

type FeatureApp = {
  Actor: { id: string };
  Resources: {};
  Features: {
    primary: CounterFeature;
    secondary: CounterFeature;
    auth: AuthFeature;
  };
  API: {
    primaryCount: number;
    signIn(): Promise<void>;
  };
};

type PolicyApp = {
  Resources: {
    synced: CounterResource;
    device: CounterResource & { Policy: "device" };
  };
  Programs: {
    server: { run: {} };
    browser: { run: {} };
  };
};

const policyApp = {
  version: 1,
  resources: {
    synced: {
      state: { count: 0 },
      presence: { cursor: 0 },
      events: { incremented: ({ state, payload }) => void (state.count += payload.by) },
      views: { count: ({ state }) => state.count },
      commands: { increment: (context, { by }) => context.event.incremented({ by }) },
    },
    device: {
      policy: "device",
      state: { count: 0 },
      presence: { cursor: 0 },
      events: { incremented: ({ state, payload }) => void (state.count += payload.by) },
      views: { count: ({ state }) => state.count },
      commands: { increment: (context, { by }) => context.event.incremented({ by }) },
    },
  },
  programs: {
    server: {
      run(context) {
        context.resources.synced("server").setPresence({ cursor: 1 });
        // @ts-expect-error Device resources cannot be consumed by a server program.
        context.resources.device("server");
      },
    },
    browser: {
      run(context) {
        context.resources.device("browser").setPresence({ cursor: 2 });
      },
    },
  },
} satisfies AppDef<PolicyApp>;

const invalidPolicy = {
  version: 1,
  resources: {
    synced: policyApp.resources.synced,
    device: {
      ...policyApp.resources.device,
      // @ts-expect-error The generic contract fixes this resource to device persistence.
      policy: "sync",
    },
  },
} satisfies AppDef<PolicyApp>;

type DurableProgramApp = {
  Actor: { id: string };
  Resources: { counter: CounterResource };
  Programs: {
    server: {
      project: {
        Events: readonly ["counter.incremented"];
        Key: string;
        KeyVersion: 1;
        Replay: "all";
        Version: 1;
      };
    };
  };
};

const durableProgram = {
  version: 1,
  resources: { counter: policyApp.resources.synced },
  programs: {
    server: {
      project: {
        source: {
          events: ["counter.incremented"],
          replay: "all",
          version: 1,
          keyVersion: 1,
          keyBy: ({ event }) => `${event.key}:${event.payload.by}`,
        },
        handle({ event }) {
          const by: number = event.payload.by;
          void by;
        },
      },
    },
  },
} satisfies AppDef<DurableProgramApp>;

const _invalidDurableKey = {
  ...durableProgram,
  programs: {
    server: {
      project: {
        ...durableProgram.programs.server.project,
        source: {
          ...durableProgram.programs.server.project.source,
          // @ts-expect-error The generic Program contract fixes the semantic key type.
          keyBy: () => 1,
        },
      },
    },
  },
} satisfies AppDef<DurableProgramApp>;

type InvalidVersionProgramApp = Omit<DurableProgramApp, "Programs"> & {
  Programs: {
    server: {
      project: {
        Events: readonly ["counter.incremented"];
        Version: 0;
      };
    };
  };
};

const _invalidDurableVersion = {
  version: 1,
  resources: durableProgram.resources,
  programs: {
    server: {
      project: {
        source: {
          events: ["counter.incremented"],
          replay: "all",
          keyBy: "resource",
          // @ts-expect-error Durable Program versions are positive integers.
          version: 0,
        },
        handle() {},
      },
    },
  },
} satisfies AppDef<InvalidVersionProgramApp>;

type InvalidEventProgramApp = Omit<DurableProgramApp, "Programs"> & {
  Programs: { server: { project: { Events: readonly ["counter.missing"] } } };
};

const _invalidDurableEvent = {
  version: 1,
  resources: durableProgram.resources,
  programs: {
    server: {
      project: {
        source: {
          // @ts-expect-error Program event names are closed over the generic application contract.
          events: ["counter.missing"],
          replay: "all",
          keyBy: "resource",
          version: 1,
        },
        handle() {},
      },
    },
  },
} satisfies AppDef<InvalidEventProgramApp>;

declare function createCounter<App extends FeatureApp>(): FeatureDef<App, CounterFeature>;

const primary = {
  resources: {
    counter: {
      state: { count: 0 },
      presence: { cursor: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: { count: ({ state }) => state.count },
      commands: {
        increment(context, { by }) {
          context.event.incremented({ by });
        },
      },
    },
  },
  features: {},
  dependencies: { server: { clock: { now: () => 1 } } },
  programs: {
    server: {
      increment({ resources }, { clock }) {
        resources.counter("primary").increment({ by: clock.now() });
      },
    },
  },
  api: ({ resources }) => {
    const counter = resources.counter("primary");
    counter.setPresence({ cursor: 3 });
    return { count: counter.count, increment: counter.increment };
  },
  components: {
    Counter: {
      state: ({ api }) => ({ count: api.count }),
      view({ state }) {
        void state.count;
        return null;
      },
    },
  },
} satisfies FeatureDef<FeatureApp, CounterFeature>;

const passkey = {
  resources: {},
  features: {},
  api: () => ({ async begin() {} }),
  components: {},
} satisfies FeatureDef<FeatureApp, ProviderFeature>;

const auth = {
  resources: {},
  features: { passkey },
  api: ({ features }) => ({ signIn: features.passkey.begin }),
  components: {},
} satisfies FeatureDef<FeatureApp, AuthFeature>;

const app = {
  version: 1,
  resources: {},
  features: {
    primary,
    secondary: createCounter<FeatureApp>(),
    auth,
  },
  api: ({ features }) => ({
    primaryCount: features.primary.count,
    signIn: features.auth.signIn,
  }),
} satisfies AppDef<FeatureApp>;

const wrongAuth = {
  resources: {},
  features: { passkey },
  // @ts-expect-error A Feature API must exactly implement its generic contract.
  api: () => ({}),
  components: {},
} satisfies FeatureDef<FeatureApp, AuthFeature>;

const wrongDependencyEnvironment = {
  ...primary,
  dependencies: {
    // @ts-expect-error The Feature contract declares this dependency for the server environment.
    browser: { clock: { now: () => 1 } },
  },
} satisfies FeatureDef<FeatureApp, CounterFeature>;

void app;
void wrongAuth;
void wrongDependencyEnvironment;
void policyApp;
void invalidPolicy;

type ScaleLeaf = {
  Resources: {};
  Components: {};
  API: { identify(): string };
};

type ScaleBranch<Children extends Record<string, ScaleLeaf | ScaleBranch<Record<string, never>>>> =
  {
    Resources: {};
    Components: {};
    Features: Children;
    API: { identify(): string };
  };

type DeepScale = ScaleBranch<{
  level2: ScaleBranch<{
    level3: ScaleBranch<{
      level4: ScaleBranch<{
        level5: ScaleBranch<{ level6: ScaleLeaf }>;
      }>;
    }>;
  }>;
}>;

type ScaleApp = {
  Resources: {};
  Features: {
    small: ScaleLeaf;
    medium: ScaleBranch<{ first: ScaleLeaf; second: ScaleLeaf; third: ScaleLeaf }>;
    wide: ScaleBranch<{
      a: ScaleLeaf;
      b: ScaleLeaf;
      c: ScaleLeaf;
      d: ScaleLeaf;
      e: ScaleLeaf;
      f: ScaleLeaf;
      g: ScaleLeaf;
      h: ScaleLeaf;
    }>;
    deep: DeepScale;
    repeatedA: ScaleLeaf;
    repeatedB: ScaleLeaf;
  };
  API: { readonly ready: true };
};

declare function createScaleFeature<
  App extends ScaleApp,
  Feature extends ScaleLeaf | ScaleBranch<Record<string, never>>,
>(): FeatureDef<App, Feature>;

const scaleApp = {
  version: 1,
  resources: {},
  features: {
    small: createScaleFeature<ScaleApp, ScaleApp["Features"]["small"]>(),
    medium: createScaleFeature<ScaleApp, ScaleApp["Features"]["medium"]>(),
    wide: createScaleFeature<ScaleApp, ScaleApp["Features"]["wide"]>(),
    deep: createScaleFeature<ScaleApp, ScaleApp["Features"]["deep"]>(),
    repeatedA: createScaleFeature<ScaleApp, ScaleApp["Features"]["repeatedA"]>(),
    repeatedB: createScaleFeature<ScaleApp, ScaleApp["Features"]["repeatedB"]>(),
  },
  api: () => ({ ready: true }),
} satisfies AppDef<ScaleApp>;

void scaleApp;
