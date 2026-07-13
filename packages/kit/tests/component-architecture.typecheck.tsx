import type {
  AppDef,
  ComponentRender,
  ComponentRenderScope,
  ComponentStateValue,
  ComponentValues,
  VisualValue,
  Writable,
} from "../src/app";
import type { PresetAppearance } from "../src/preset";
import type { Preset, Tokens, VisualFragment } from "../src/visual";
import { For, Show, type Child } from "../src/ui";

type AppearanceApp = {
  Resources: {};
  Styles: {
    Presets: {
      paper: { Themes: "default" | "dark" };
      tactile: { Themes: "default" | "dim" };
    };
  };
};

const darkPaper = {
  preset: "paper",
  theme: "dark",
} satisfies PresetAppearance<AppearanceApp>;
// @ts-expect-error Theme names are scoped to their selected preset.
const invalidDarkTactile: PresetAppearance<AppearanceApp> = {
  preset: "tactile",
  theme: "dark",
};
void darkPaper;
void invalidDarkTactile;

type WritableValueApp = {
  Resources: {};
  Components: {
    Surface: {
      Values: {
        offset: Writable<VisualValue<"length">>;
        measured: Writable<number>;
        label: string;
      };
      Parts: { Root: "div" };
    };
  };
};

declare const writableValues: ComponentValues<WritableValueApp, "Surface">;
writableValues.offset = 24;
writableValues.measured = 320;
// @ts-expect-error Derived values are reactive but read-only in structure.
writableValues.label = "changed";
// @ts-expect-error Visual values are unwrapped to their numeric runtime domain.
writableValues.offset = "24px";

type ArchitectureApp = {
  Resources: {};
  Components: {
    Screen: {
      Parts: { Root: "main"; Content: "section" };
    };
    Toggle: {
      Input: { label: string; changed(pressed: boolean): void };
      Context: { pressed: boolean };
      States: "active";
      Values: {
        label: string;
        isPressed: boolean;
        progress: VisualValue<"progress">;
      };
      Events: { toggle(): void; reset(): void };
      Parameters: { resetAt: number };
      Slots: { detail?: Child };
      Parts: { Root: "button"; Label: "span"; Detail: "span" };
    };
    Search: {
      Input: { source: readonly string[] };
      Context: { query: string; results: readonly string[]; error: Error | undefined };
      States: "closed" | "open" | "open.ready" | "open.waiting" | "open.loading" | "open.error";
      Values: { resultCount: number };
      Output: readonly string[];
      Events: {
        open(): void;
        close(): void;
        query(value: string): void;
        move(from: number, to: number): void;
        retry(): void;
      };
      Tasks: {
        search: { Input: string; Output: readonly string[]; Error: Error };
      };
      Parts: { Root: "section"; Input: "input" };
    };
  };
  Styles: { Presets: "clean" | "expressive" };
};

type LegacyActionApp = {
  Resources: {};
  Components: {
    Toggle: {
      Actions: { toggle(): void };
      Parts: { Root: "button" };
    };
  };
};

// @ts-expect-error Legacy Actions are rejected by the generic contract itself.
type RejectLegacyActions = AppDef<LegacyActionApp>;
void (undefined as unknown as RejectLegacyActions);

type SearchState = import("../src/app").ComponentStatePath<ArchitectureApp, "Search">;

function exhaustSearchState(path: SearchState): string {
  switch (path) {
    case "closed":
    case "open":
    case "open.ready":
    case "open.waiting":
    case "open.loading":
    case "open.error":
      return path;
    default:
      return path satisfies never;
  }
}

function rejectIncompleteSearchState(path: SearchState): string {
  switch (path) {
    case "closed":
      return path;
    default:
      // @ts-expect-error Missing state branches do not narrow to never.
      return path satisfies never;
  }
}

void exhaustSearchState;
void rejectIncompleteSearchState;

const contractTheme = {
  color: {
    canvas: { l: 0.98, c: 0.004, h: 250 },
    text: { l: 0.2, c: 0.01, h: 250 },
  },
} satisfies Tokens;

const cleanPreset = (({ tokens }) => ({
  theme: contractTheme,
  components: {
    Screen: () => ({ Root: { paint: { fill: tokens.color.canvas } } }),
    Toggle(scope) {
      // @ts-expect-error Component variants were folded into the single input contract.
      void scope.variants;
      return {
        parameters: { resetAt: 0.5 },
        Label: { typography: { color: tokens.color.text } },
      };
    },
    Search: () => ({}),
  },
})) satisfies Preset<ArchitectureApp, "clean", typeof contractTheme>;

const expressivePreset = (({ tokens }) => ({
  theme: contractTheme,
  components: {
    Screen: () => ({ Root: { paint: { fill: tokens.color.canvas } } }),
    Toggle: () => ({
      parameters: { resetAt: 0.75 },
      Root: { typography: { color: tokens.color.text } },
    }),
    Search: () => ({}),
  },
})) satisfies Preset<ArchitectureApp, "expressive", typeof contractTheme>;

void cleanPreset;
void expressivePreset;

const removedVisualDomain: VisualFragment = {
  // @ts-expect-error Paint is authored under the paint algebra, never as a surface bucket.
  surface: { fill: "transparent" },
};
void removedVisualDomain;

const toggleRender: ComponentRender<ArchitectureApp, "Toggle"> = ({
  context,
  state,
  values,
  parameters,
  events,
  slots,
  parts: { Root, Label, Detail },
}) => {
  const active: boolean = state.matches("active");
  const activePaths: readonly "active"[] = state.active;
  const stateValue: ComponentStateValue<"active"> = state.value;
  const canToggle: boolean = state.can("toggle");
  const progress: number = values.progress;
  const resetAt: number = parameters.resetAt;
  void active;
  void activePaths;
  void stateValue;
  void canToggle;
  void progress;
  void resetAt;

  Root({ type: "button", "aria-pressed": context.pressed, onClick: events.toggle });
  // @ts-expect-error The core exposes native events, not a semantic press prop.
  Root({ press: events.toggle });
  // @ts-expect-error Visual properties belong exclusively to presets.
  Root({ className: "legacy" });
  // @ts-expect-error A span does not accept button-only native properties.
  Label({ disabled: true });
  return (
    <Root type="button" aria-pressed={context.pressed} onClick={events.toggle}>
      <Label>{values.label}</Label>
      <Detail hidden={slots.detail == null}>{slots.detail}</Detail>
      {/* @ts-expect-error The core has no gesture-boundary prop. */}
      <Detail drag="sometimes" />
    </Root>
  );
};

function rejectPrivateSend(scope: ComponentRenderScope<ArchitectureApp, "Toggle">): void {
  // @ts-expect-error The state-machine dispatcher is private.
  void scope.send;
}
void rejectPrivateSend;

const app = {
  version: 1,
  resources: {},
  components: {
    Screen: {
      render({ components: { Toggle }, parts: { Root, Content } }) {
        return (
          <Root>
            <Content>
              <Show when>
                <Toggle label="Notifications" changed={() => {}} detail="Announces changes" />
              </Show>
              <Toggle label="Sounds" changed={() => {}} />
              {/* @ts-expect-error Component variants are ordinary typed input fields. */}
              <Toggle label="Legacy" changed={() => {}} variants={{ tone: "legacy" }} />
            </Content>
          </Root>
        );
      },
    },
    Toggle: {
      context: { pressed: false },
      initial: "active",
      states: {
        active: {
          on: {
            toggle: {
              update: ({ context }) => ({ pressed: !context.pressed }),
              perform: ({ input, context }) => input.changed(context.pressed),
            },
            reset: { update: () => ({ pressed: false }) },
          },
        },
      },
      derive(scope) {
        const { input, context } = scope;
        // @ts-expect-error Derivation can read reactive facts but cannot issue resource commands.
        void scope.resources;
        // @ts-expect-error Navigation is behavior, not derivation.
        void scope.navigation;
        return {
          label: input.label,
          isPressed: context.pressed,
          progress: context.pressed ? 1 : 0,
        };
      },
      render: toggleRender,
    },
    Search: {
      context: { query: "", results: [], error: undefined },
      initial: "closed",
      states: {
        closed: { on: { open: "open.ready" } },
        open: {
          initial: "open.ready",
          on: { close: "closed" },
          states: {
            ready: {
              on: {
                query: [
                  {
                    allow: (_scope, query) => query.trim().length > 0,
                    target: "open.waiting",
                    update: (_scope, query) => ({ query, error: undefined }),
                  },
                  { update: () => ({ query: "", results: [] }) },
                ],
                move: {
                  update: (_scope, from, to) => ({ query: `${from}:${to}` }),
                },
              },
            },
            waiting: { after: { wait: 120, target: "open.loading" } },
            loading: {
              task: {
                run: "search",
                input: ({ context }) => context.query,
                done: {
                  target: "open.ready",
                  update: (_scope, results) => ({ results }),
                },
                fail: {
                  target: "open.error",
                  update: (_scope, error) => ({ error }),
                },
              },
            },
            error: { on: { retry: "open.loading" } },
          },
        },
      },
      tasks: {
        async search(scope) {
          const { input, value, signal } = scope;
          // @ts-expect-error Tasks cannot mutate presentation policy.
          void scope.setAppearance;
          // @ts-expect-error Tasks cannot perform resource commands.
          void scope.resources;
          // @ts-expect-error Tasks cannot navigate.
          void scope.navigation;
          signal.throwIfAborted();
          return input.source.filter((item) => item.includes(value));
        },
      },
      derive({ context }) {
        return { resultCount: context.results.length };
      },
      render({ context, state, events, parts: { Root, Input } }) {
        const rawBrowserBinding = <Root onClick={events.close} />;
        void rawBrowserBinding;
        return (
          <Root hidden={!state.matches("open")}>
            <Input
              value={context.query}
              onInput={(event) => events.query(event.currentTarget.value)}
            />
          </Root>
        );
      },
    },
  },
  root: "Screen",
} satisfies AppDef<ArchitectureApp>;
void app;

const invalidLegacyApp = {
  version: 1,
  resources: {},
  components: {
    Screen: {
      // @ts-expect-error Components use render; view no longer exists.
      view() {
        return null;
      },
    },
    Toggle: {
      // @ts-expect-error Nested machine objects were removed.
      machine: { initial: "active", states: { active: {} } },
      render: toggleRender,
    },
    Search: {
      // @ts-expect-error Named effect registries were replaced by Tasks.
      effects: { search() {} },
      render() {
        return null;
      },
    },
  },
} satisfies AppDef<ArchitectureApp>;
void invalidLegacyApp;

const invalidTarget = {
  ...app,
  components: {
    ...app.components,
    Toggle: {
      context: { pressed: false },
      initial: "active",
      states: {
        active: {
          on: {
            // @ts-expect-error Targets derive from the explicit States union.
            toggle: "missing",
          },
        },
      },
      derive: app.components.Toggle.derive,
      render: toggleRender,
    },
  },
} satisfies AppDef<ArchitectureApp>;
void invalidTarget;

const virtualRows = [{ id: "one", label: "One" }] as const;
const virtualRowsView: Child = (
  <For each={virtualRows} by="id" virtual active="one">
    {(row) => <div>{row.label}</div>}
  </For>
);
void virtualRowsView;

const invalidVirtualActive: Child = (
  // @ts-expect-error Active identity must match the selected key field.
  <For each={virtualRows} by="id" virtual active={2}>
    {(row) => <div>{row.label}</div>}
  </For>
);
void invalidVirtualActive;

const invalidVirtualRows: Child = (
  // @ts-expect-error Virtual collections require stable keyed identity.
  <For each={virtualRows} virtual>
    {(row) => <div>{row.label}</div>}
  </For>
);
void invalidVirtualRows;
