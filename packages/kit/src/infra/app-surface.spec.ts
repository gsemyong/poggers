import { describe, expect, it } from "bun:test";
import { defineApp } from "./app";
import { validateServerMessage } from "./protocol";

describe("app surface", () => {
  it("allows defineApp without Actor or identify", () => {
    const api = defineApp<{
      Resources: {
        note: {
          Key: { noteId: string };
          State: { title: string };
          Events: { renamed: { title: string } };
          Views: { title: string };
          Commands: { rename: { args: [title: string]; event: "renamed"; error: never } };
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
            rename(ctx, title) {
              return ctx.event.renamed({ title });
            },
          },
        },
      },
    });

    expect(api.def.identify({ token: "local-user" })).toEqual({ id: "local-user" });

    const state = api.createState("note");
    const events: any[] = [];
    api.runCommand(
      "note",
      state,
      { id: "local-user" },
      { noteId: "a" },
      "rename",
      ["hello"],
      (event) => events.push(event),
      () => {},
      () => {},
    );

    expect(events).toHaveLength(1);
    api.applyEvent("note", state, events[0], api.def.version);
    expect(state.title).toBe("hello");
  });

  it("accepts event versions in server protocol messages", () => {
    const parsed = validateServerMessage({
      type: "event",
      resource: "note",
      key: { noteId: "a" },
      event: {
        id: "e1",
        seq: 1,
        at: 100,
        version: 2,
        actor: { id: "u" },
        name: "renamed",
        payload: { title: "hello" },
      },
    });

    expect(parsed).not.toBeNull();
  });

  it("rejects invalid event versions in server protocol messages", () => {
    const parsed = validateServerMessage({
      type: "event",
      resource: "note",
      key: { noteId: "a" },
      event: {
        id: "e1",
        seq: 1,
        at: 100,
        version: Number.NaN,
        actor: { id: "u" },
        name: "renamed",
        payload: { title: "hello" },
      },
    });

    expect(parsed).toBeNull();
  });

  it("infers program dependencies from the app environments", () => {
    const api = defineApp<{
      Resources: {
        note: {
          Key: { noteId: string };
          State: { title: string };
          Events: { renamed: { title: string } };
          Views: { title: string };
          Commands: { rename: { args: [title: string]; event: "renamed"; error: never } };
        };
      };
      Environments: {
        browser: {
          Deps: {
            audit(title: string): void;
          };
        };
        cloud: {
          Deps: {
            secret: string;
          };
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
            rename(ctx, title) {
              return ctx.event.renamed({ title });
            },
          },
        },
      },
      programs: {
        async browser({ events }, deps) {
          deps.audit("started");
          // @ts-expect-error browser programs cannot access cloud-only dependencies.
          acceptsCloudSecret(deps.secret);

          for await (const { event, note } of events("note.renamed", {
            id: "note.audit",
          })) {
            deps.audit(event.payload.title);
            await note.rename(event.payload.title);
          }
        },
      },
    });

    expect(typeof api.def.programs?.browser).toBe("function");
  });

  it("keeps embedded UI, navigation, PWA, and deps generic-first", () => {
    const api = defineApp<{
      Resources: {
        counter: {
          Key: { id: string };
          State: { count: number };
          Events: { incremented: { by: number } };
          Views: { count: number };
          Commands: { increment: { args: [by?: number]; event: "incremented"; error: never } };
        };
      };
      Environments: {
        server: {
          Deps: {
            now(): number;
          };
        };
      };
      Navigation: {
        home: {};
        counter: { id: string };
      };
    }>({
      version: 1,
      app: { name: "Typed App" },
      pwa: {
        name: "Typed App",
        themeColor: "#111827",
        backgroundColor: "#ffffff",
      },
      navigation: {
        home: "/",
        counter: "/counter/:id",
      },
      deps: {
        server: () => ({
          now: () => Date.now(),
        }),
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
            increment(ctx, by = 1) {
              return ctx.event.incremented({ by });
            },
          },
        },
      },
      programs: {
        server(_ctx, deps) {
          deps.now();
        },
      },
      ui(ctx) {
        ctx.nav.home();
        ctx.nav.counter({ id: "main" });
        // @ts-expect-error counter navigation requires an id.
        ctx.nav.counter();

        const screen = ctx.screen();
        if (screen.name === "counter") {
          const counter = ctx.useCounter({ id: screen.params.id });
          void counter.increment();
          void counter.count;
        }
        return null;
      },
    });

    expect(api.def.app?.name).toBe("Typed App");
    expect(api.def.pwa?.name).toBe("Typed App");
    expect(api.def.navigation?.counter).toBe("/counter/:id");
    expect(typeof api.def.ui).toBe("function");
  });
});

function acceptsCloudSecret(_secret: string) {}
