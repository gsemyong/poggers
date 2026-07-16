import { describe, expect, it } from "bun:test";

import { defineApp, type Submission } from "#kernel/app";

describe("application authoring contract", () => {
  it("allows defineApp without Actor or identify", () => {
    const api = defineApp<{
      Resources: {
        note: {
          Key: { noteId: string };
          State: { title: string };
          Events: { renamed: { title: string } };
          Views: { title: string };
          Commands: { rename: { Input: { title: string }; Event: "renamed"; Error: never } };
        };
      };
    }>({
      version: 1,
      resources: {
        note: {
          state: { title: "" },
          events: {
            renamed({ state, payload }) {
              state.title = payload.title;
            },
          },
          views: {
            title({ state }) {
              return state.title;
            },
          },
          commands: {
            rename(ctx, { title }) {
              return ctx.event.renamed({ title });
            },
          },
        },
      },
    });

    expect(api.def.identify({ token: "local-user" })).toEqual({ id: "local-user" });

    const state = api.createState("note");
    const events: Array<{
      id: string;
      seq: number;
      at: number;
      actor: { id: string };
      name: string;
      payload: unknown;
    }> = [];
    api.runCommand(
      "note",
      state,
      { id: "local-user" },
      { noteId: "a" },
      "rename",
      [{ title: "hello" }],
      (event) => events.push(event),
      () => {},
    );

    expect(events).toHaveLength(1);
    api.applyEvent("note", state, events[0]!, api.def.version);
    expect(state.title).toBe("hello");
  });

  it("infers program dependencies from the app environments", () => {
    const api = defineApp<{
      Resources: {
        note: {
          Key: { noteId: string };
          State: { title: string };
          Events: { renamed: { title: string } };
          Views: { title: string };
          Commands: { rename: { Input: { title: string }; Event: "renamed"; Error: never } };
        };
      };
      Dependencies: {
        browser: { audit(title: string): void };
        cloud: { secret: string };
      };
      Programs: {
        browser: {
          audit: { Events: readonly ["note.renamed"] };
        };
      };
      API: {
        note(noteId: string): {
          readonly title: string;
          rename(input: { title: string }): Submission;
        };
      };
    }>({
      version: 1,
      resources: {
        note: {
          state: { title: "" },
          events: {
            renamed({ state, payload }) {
              state.title = payload.title;
            },
          },
          views: {
            title({ state }) {
              return state.title;
            },
          },
          commands: {
            rename(ctx, { title }) {
              return ctx.event.renamed({ title });
            },
          },
        },
      },
      dependencies: {
        browser: { audit() {} },
        cloud: { secret: "secret" },
      },
      api: ({ resources }) => ({ note: (noteId) => resources.note({ noteId }) }),
      programs: {
        browser: {
          audit: {
            source: {
              events: ["note.renamed"],
              replay: "all",
              version: 1,
              keyBy: "resource",
            },
            async handle({ api, event, note }, deps) {
              deps.audit("started");
              deps.audit(api.note("audit").title);
              deps.audit(event.payload.title);
              await note.rename({ title: event.payload.title });
              // @ts-expect-error browser programs cannot access cloud-only dependencies.
              acceptsCloudSecret(deps.secret);
            },
          },
        },
      },
    });

    expect(typeof api.def.programs?.browser).toBe("function");
  });

  it("rejects invalid durable Program source semantics", () => {
    type ProgramApp = {
      Resources: {
        note: {
          Key: string;
          State: null;
          Events: { renamed: { title: string } };
          Views: {};
          Commands: {};
        };
      };
      Programs: {
        server: {
          audit: {
            Events: readonly ["note.renamed"];
            Key: string;
            KeyVersion: 1;
          };
        };
      };
    };
    expect(() =>
      defineApp<ProgramApp>({
        version: 1,
        resources: {
          note: {
            state: null,
            events: { renamed() {} },
          },
        },
        programs: {
          server: {
            audit: {
              source: {
                events: ["note.renamed"],
                replay: "all",
                version: 1,
                keyBy: ({ event }) => event.key,
                // @ts-expect-error A custom key requires a positive numeric version.
                keyVersion: "one",
              },
              handle() {},
            },
          },
        },
      }),
    ).toThrow("invalid durable event definition");
  });

  it("keeps the app definition, navigation, PWA, and dependencies generic-first", () => {
    const api = defineApp<{
      Resources: {
        counter: {
          Key: { id: string };
          State: { count: number };
          Events: { incremented: { by: number } };
          Views: { count: number };
          Commands: { increment: { Input: { by?: number }; Event: "incremented"; Error: never } };
        };
      };
      Dependencies: { server: { now(): number } };
      Programs: { server: { recordTime: {} } };
      Navigation: {
        home: {};
        counter: { id: string };
      };
      Components: {
        App: {
          State: { counterId: string; count: number };
          Parts: { Root: "main" };
        };
      };
      API: {
        counter(id: string): {
          readonly count: number;
          increment(input: { by?: number }): Submission;
        };
      };
    }>({
      version: 1,
      app: { name: "Typed App" },
      pwa: {
        name: "Typed App",
        themeColor: "oklch(21.01% 0.0318 264.66)",
        backgroundColor: "oklch(100% 0 89.88)",
      },
      navigation: {
        home: "/",
        counter: "/counter/:id",
      },
      dependencies: {
        server: {
          now: () => Date.now(),
        },
      },
      resources: {
        counter: {
          state: { count: 0 },
          events: {
            incremented({ state, payload }) {
              state.count += payload.by;
            },
          },
          views: {
            count({ state }) {
              return state.count;
            },
          },
          commands: {
            increment(ctx, { by = 1 }) {
              return ctx.event.incremented({ by });
            },
          },
        },
      },
      programs: {
        server: {
          recordTime(_ctx, deps) {
            deps.now();
          },
        },
      },
      api: ({ resources }) => ({ counter: (id) => resources.counter({ id }) }),
      components: {
        App: {
          state({ api, screen }) {
            const counterId = screen.name === "counter" ? screen.params.id : "main";
            return { counterId, count: api.counter(counterId).count };
          },
          view({ state, parts: { Root } }) {
            void state.counterId;
            void state.count;
            return Root();
          },
        },
      },
      root: "App",
    });

    expect(api.def.app?.name).toBe("Typed App");
    expect(api.def.pwa?.name).toBe("Typed App");
    expect(api.def.navigation?.counter).toBe("/counter/:id");
    expect(api.def.root).toBe("App");
  });
});

function acceptsCloudSecret(_secret: string) {}
