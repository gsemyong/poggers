import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineApp } from "../src/app";
import { validateServerMessage } from "../src/protocol";

describe("app surface", () => {
  it("keeps app materialization behind the internal runtime boundary", async () => {
    const [source, declaration] = await Promise.all([
      readFile(resolve(import.meta.dir, "../src/index.ts"), "utf8"),
      readFile(resolve(import.meta.dir, "../types/index.d.ts"), "utf8"),
    ]);
    expect(source).not.toMatch(/\bdefineApp\b/);
    expect(declaration).not.toMatch(/\bdefineApp\b/);
  });

  it("keeps removed component declarations out of the destructive migration", async () => {
    const source = await readFile(resolve(import.meta.dir, "../types/app.d.ts"), "utf8");
    const forbidden = [
      "ComponentDelayName",
      "ComponentDerived",
      "ComponentDerivedContext",
      "ComponentEffectContext",
      "ComponentEffectName",
      "ComponentEffects",
      "ComponentGuardName",
      "ComponentGuards",
      "ComponentMachineDefinition",
      "ComponentMachineImplementation",
      "ComponentMachineInvocation",
      "ComponentMachineRun",
      "ComponentMachineScope",
      "ComponentMachineStateNode",
      "ComponentMachineTransition",
      "ComponentMachineTransitions",
      "ComponentMachineUpdate",
      "ComponentPublicActionName",
      "ComponentPublicValueName",
      "ComponentState",
      "ComponentStatus",
      "ComponentStatusView",
      "ComponentStyleValues",
      "ComponentView",
      "ComponentViewContext",
      "ComponentViewPart",
    ];
    const names = forbidden.filter((name) =>
      new RegExp(`^export type ${name}(?:<|\\s|=)`, "m").test(source),
    );
    expect(names).toEqual([]);
  });

  it("keeps the public UI declaration intentionally shallow", async () => {
    const source = await readFile(resolve(import.meta.dir, "../types/ui-public.d.ts"), "utf8");
    expect(source).toContain("For, Show, effect");
    expect(source).toContain("Child, VirtualForOptions");
    expect(source).not.toContain("render");
    expect(source).not.toContain("createBrowserConnectOptions");
    expect(source).not.toContain("StyleX");
    expect(source.split("\n")).toHaveLength(3);
  });

  it("keeps the public style surface author-facing rather than backend-facing", async () => {
    const source = await readFile(resolve(import.meta.dir, "../src/preset.ts"), "utf8");
    for (const name of [
      "Preset",
      "VisualFragment",
      "VisualTokenRef",
      "PresetTokens",
      "VisualValueRef",
    ]) {
      expect(source).toContain(name);
    }
    expect(source).not.toContain('export type * from "./visual"');
    expect(source).not.toContain("StyleX");
    expect(source).not.toContain("Anime");
    expect(source).not.toContain("PreText");
  });

  it("keeps semantic accessibility ownership out of the visual runtime", async () => {
    const source = await readFile(resolve(import.meta.dir, "../src/visual-runtime.ts"), "utf8");
    expect(source).not.toMatch(/\b(?:aria-hidden|inert)\b/);
  });

  it("ships declarations for the exact semantic, visual, and collection surface", async () => {
    const [app, visual, ui, jsx] = await Promise.all(
      ["app", "visual", "ui", "jsx-types"].map((name) =>
        readFile(resolve(import.meta.dir, `../types/${name}.d.ts`), "utf8"),
      ),
    );
    expect(app).not.toContain("export type AriaRole");
    expect(app).not.toContain("export type PinchGesture");
    expect(app).not.toContain("export type DragGesture");
    expect(app).toContain("readonly appearance: PresetAppearance<Spec>");
    expect(app).toContain("readonly setAppearance:");
    expect(app).not.toContain("popoverOpen?: boolean");
    expect(app).not.toContain("dialogOpen?:");
    expect(app).toContain('| "angle"');
    expect(app).toContain('| "time"');
    expect(jsx).not.toContain("[Key in `aria-${string}`]");
    expect(jsx).toContain('"aria-expanded"?: AttributeValue<Booleanish>');
    expect(app).not.toContain("onClick?: ComponentEventHandler");
    expect(app).not.toContain("popoverTargetAction");
    expect(app).not.toContain("readonly setPreset:");
    expect(app).not.toContain("readonly setTheme:");
    expect(visual).not.toContain("presentations");
    expect(visual).toContain("readonly delay?");
    expect(visual).not.toContain("type DragGestureVisual");
    expect(visual).not.toContain("type PinchGestureVisual");
    expect(visual).toContain("readonly all?:");
    expect(visual).not.toContain("= Partial<{\n    readonly [Part");
    expect(ui).toContain("virtualItemPosition");
    expect(ui).toContain("NoInfer<Extract<Items[number][Key], ForKey>>");
  });

  it("keeps the private statechart backend out of every public declaration", async () => {
    const declarationNames = ["app", "index", "preset", "runtime", "ui-public", "visual"];
    const declarations = await Promise.all(
      declarationNames.map((name) =>
        readFile(resolve(import.meta.dir, `../types/${name}.d.ts`), "utf8"),
      ),
    );
    expect(declarations.join("\n")).not.toMatch(/xstate/i);
  });

  it("emits no author-facing any and keeps tasks capability-minimal", async () => {
    const declarationNames = ["app", "ui-public", "preset", "visual"];
    const declarations = await Promise.all(
      declarationNames.map((name) =>
        readFile(resolve(import.meta.dir, `../types/${name}.d.ts`), "utf8"),
      ),
    );
    const publicSurface = declarations
      .join("\n")
      .replaceAll("readonly any:", "readonly anySelector:")
      .replaceAll("any?: PwaIconDef", "anyPurpose?: PwaIconDef");
    expect(publicSurface).not.toMatch(/\bany\b/);

    const app = declarations[0]!;
    const taskScope = app.slice(
      app.indexOf("export type ComponentTaskScope"),
      app.indexOf("type ComponentTaskDefinitions"),
    );
    expect(taskScope).toContain("readonly signal: AbortSignal");
    expect(taskScope).not.toContain("setAppearance");
    expect(taskScope).not.toContain("resources");
    expect(taskScope).not.toContain("navigation");
  });

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

  it("keeps the app definition, navigation, PWA, and deps generic-first", () => {
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
      Deps: {
        now(): number;
      };
      Navigation: {
        home: {};
        counter: { id: string };
      };
      Components: {
        App: { Parts: { Root: "main" } };
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
      deps: {
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
      components: {
        App: {
          render({ navigation, parts: { Root }, resources, screen }) {
            navigation.home();
            navigation.counter({ id: "main" });
            // @ts-expect-error counter navigation requires an id.
            navigation.counter();

            if (screen.name === "counter") {
              const counter = resources.counter({ id: screen.params.id });
              void counter.increment();
              void counter.count;
            }
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
