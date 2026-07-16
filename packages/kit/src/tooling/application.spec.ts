import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertResourceCommand,
  assertResourceKey,
  defineApp,
  installAppMigrations,
} from "#kernel/app";
import { checkAppConventions, loadApp } from "#tooling/application";
import {
  analyzeAppContract,
  persistentResourceSchemaSource,
  transformComponentSource,
} from "#ui/compiler/application";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("Poggers app virtual modules", () => {
  it("lowers component renders to fine-grained reactive bindings", () => {
    const source = transformComponentSource(
      `export default {
        components: {
          Menu: {
            view({ state, actions, components: { Item }, parts: { Root, Label } }) {
              return (
                <Root aria-expanded={state.open} onClick={actions.open}>
                  <Label>{state.label}</Label>
                  <Show when={state.open}><Item label={state.label} active={state.open} /></Show>
                  <For each={state.items} by="id">
                    {(item, index) => <Label data-index={index}>{index}: {item.label}</Label>}
                  </For>
                </Root>
              );
            },
          },
        },
      };`,
      "/app/src/app.tsx",
    );

    expect(source).toContain("view(__poggersView)");
    expect(source).toContain("aria-expanded={() => __poggersView.state.open}");
    expect(source).toContain("onClick={__poggersView.actions.open}");
    expect(source).toContain("{() => __poggersView.state.label}");
    expect(source).toContain("<Show when={() => __poggersView.state.open}");
    expect(source).toContain("label={() => __poggersView.state.label}");
    expect(source).toMatch(/\(item, index, __poggersForIndex_\d+\) =>/);
    expect(source).toMatch(/data-index=\{\(\) => __poggersForIndex_\d+\(\)\}/);
    expect(source).toMatch(/\{\(\) => __poggersForIndex_\d+\(\)\}: \{\(\) => item.label\}/);
    expect(source).toContain("active={() => __poggersView.state.open}");
    expect(source).toContain("sourceMappingURL=data:application/json;base64,");
  });

  it("lowers nested Feature component renders to fine-grained reactive bindings", () => {
    const source = transformComponentSource(
      `export default {
        resources: {},
        features: {
          chat: {
            resources: {},
            components: {
              Composer: {
                state({ context }) {
                  return { value: context.value, canSubmit: context.value.length > 0 };
                },
                view({ state, actions, parts: { Input, Send } }) {
                  return <><Input value={state.value} onInput={actions.change} />
                    <Send disabled={!state.canSubmit}>Send</Send></>;
                },
              },
            },
          },
        },
        components: {},
      };`,
      "/app/src/app.tsx",
    );

    expect(source).toContain("state(__poggersState)");
    expect(source).toContain("get canSubmit()");
    expect(source).toContain("view(__poggersView)");
    expect(source).toContain("value={() => __poggersView.state.value}");
    expect(source).toContain("onInput={__poggersView.actions.change}");
    expect(source).toContain("disabled={() => !__poggersView.state.canSubmit}");
  });

  it("lowers component methods returned by reusable Feature factories", () => {
    const source = transformComponentSource(
      `export function createAccountFeature() {
        return {
          resources: {},
          features: {},
          components: {
            Account: {
              state({ context, phase }) {
                return { signedIn: phase === "signedIn", loading: phase === "loading", name: context.name };
              },
              view({ state, parts: { Root, Loading, Name, Logout } }) {
                return Root({
                  children: [
                    Loading({ hidden: !state.loading }),
                    Name({ children: state.name }),
                    Logout({ hidden: !state.signedIn }),
                  ],
                });
              },
            },
          },
        };
      }`,
      "/feature/auth.ts",
    );

    expect(source).toContain("state(__poggersState)");
    expect(source).toContain("view(__poggersView)");
    expect(source).toContain("hidden: () => !__poggersView.state.loading");
    expect(source).toContain("children: () => __poggersView.state.name");
    expect(source).toContain("hidden: () => !__poggersView.state.signedIn");
  });

  it("removes nested endpoint implementations from browser-transformed source", () => {
    const source = transformComponentSource(
      `const endpointSecret = "server-endpoint-secret";
       export function createFeature() {
         return {
           resources: {},
           endpoints: {
             callback: { method: "POST", path: "/callback", handle() { return endpointSecret; } },
           },
           features: {
             child: { resources: {}, endpoints: { machine: { handle() { return endpointSecret; } } } },
           },
         };
       }
       export default { resources: {}, endpoints: { root: { handle() { return endpointSecret; } } } };`,
      "/app/src/app.ts",
      { stripEndpoints: true },
    );

    expect(source).not.toContain("endpoints:");
    expect(source).not.toContain("handle()");
    expect(source).toContain("features:");
  });

  it("retains browser dependencies while erasing server implementations", () => {
    const source = transformComponentSource(
      `export default {
        resources: {},
        dependencies: {
          browser: { clock: { now: () => 42 } },
          server: { secret: { token: "server-only" } },
        },
        authentication: { resolve() {} },
        programs: { server() {} },
        components: {},
      };`,
      "/app/src/app.ts",
      { stripEndpoints: true },
    );

    expect(source).toContain("browser:");
    expect(source).toContain("now: () => 42");
    expect(source).not.toContain("server-only");
    expect(source).not.toContain("authentication:");
    expect(source).not.toContain("programs:");
  });

  it("lowers function Features to their shared runtime in browser source", () => {
    const source = transformComponentSource(
      `import { createFunctions } from "@poggers/kit";
       export function createOrderFeature() {
         return createFunctions(
           { dependencies: { payments: { token: "server-adapter-secret" } } },
           ({ createFunction }) => {
             createFunction(
               { id: "order", triggers: { event: "order/placed" } },
               async ({ step }) => step.run("pay", () => "server-function-body"),
             );
           },
         );
       }`,
      "/app/src/features/orders.ts",
      { stripEndpoints: true },
    );

    expect(source).toContain("createFunctionsRuntime as createFunctions");
    expect(source).toContain("return createFunctions();");
    expect(source).not.toContain("server-adapter-secret");
    expect(source).not.toContain("server-function-body");
    expect(source).not.toContain("createFunction(");
  });

  it("omits function handlers and server dependencies from emitted browser code", async () => {
    const marker = "POGGERS_SERVER_HANDLER_PROJECTION_MARKER";
    const entry = `${import.meta.dir}/.app-browser-projection.ts`;
    const transformed = transformComponentSource(
      `import { createFunctions } from "@poggers/kit";
       type Contract = {
         Events: { "projection/run": null };
         Functions: { projected: { Input: null; Output: null } };
         Dependencies: { secret: { run(): Promise<void> } };
       };
       type App = { Actor: { id: string }; Resources: {}; Features: {} };
       export const feature = createFunctions<App, Contract>(
         { dependencies: { secret: { async run() { console.log(${JSON.stringify(marker)}); } } } },
         ({ createFunction, dependencies }) => {
           createFunction(
             { id: "projected", triggers: { event: "projection/run" } },
             async () => { await dependencies.secret.run(); return null; },
           );
         },
       );`,
      entry,
      { stripEndpoints: true },
    ).replace('"@poggers/kit"', '"../features/workflows.ts"');
    const result = await Bun.build({
      entrypoints: ["app-browser-projection"],
      target: "browser",
      format: "esm",
      minify: true,
      conditions: ["poggers-source", "bun"],
      define: { __POGGERS_BROWSER__: "true" },
      plugins: [
        {
          name: "app-browser-projection",
          setup(build) {
            build.onResolve({ filter: /^app-browser-projection$/ }, () => ({ path: entry }));
            build.onLoad({ filter: /\.app-browser-projection\.ts$/ }, () => ({
              contents: transformed,
              loader: "ts",
            }));
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    const output = await result.outputs[0]!.text();
    expect(output).not.toContain(marker);
    expect(output).not.toContain("Workflow scheduler failed to open");
    expect(output).not.toContain("Function admission release failed");
  });

  it("targets only component renders, respects shadowing, and lowers nested reactive input", () => {
    const source = transformComponentSource(
      `export default {
        resources: {
          example: { views: { view({ state }) { return state.value; } } },
        },
        components: {
          Menu: {
            state({ context, api }) {
              const open = context.open;
              const data = api.data({ filter: { open: context.open } });
              return { open, label: context.open ? "Open" : "Closed", staticLabel: "Menu", empty: data.empty };
            },
            view({ state, components: { Item }, parts: { Root, Label } }) {
              const labels = [{ label: "local" }].map((context) => context.label);
              return <Show when={state.open} fallback={<Label>{state.empty}</Label>}>
                <Root data-label={labels[0]}><Item config={{ open: state.open }} /></Root>
              </Show>;
            },
          },
        },
      };`,
      "/app/src/app.tsx",
    );

    expect(source).toContain("view({ state }) { return state.value; }");
    expect(source).toContain("state(__poggersState)");
    expect(source).toContain("get open()");
    expect(source).toContain("get label()");
    expect(source).toContain('staticLabel: "Menu"');
    expect(source).toContain("config={() => ({ open: __poggersView.state.open })}");
    expect(source).toContain("api.data({ filter:");
    expect(source).toContain("(context) => context.label");
    expect(source).toContain("fallback={() => <Label>{() => __poggersView.state.empty}</Label>}");
    const map = JSON.parse(
      Buffer.from(
        source.split("sourceMappingURL=data:application/json;base64,")[1]!,
        "base64",
      ).toString("utf8"),
    ) as { sourceRoot: string; sourcesContent: string[] };
    expect(map.sourceRoot).toBe("/app/src/");
    expect(map.sourcesContent[0]).toContain("components: { Item }");
  });

  it("extracts aliased and imported contracts and invalidates imported source changes", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "poggers-compiler-contract-"));
    createdDirs.push(appDir);
    const shared = join(appDir, "shared.ts");
    const contract = join(appDir, "types.ts");
    await writeFile(
      shared,
      `export type ButtonContract = {
        Input: { label: string };
        Parts: { "Root": "button"; Label: "span" };
      };
      export type ResourceContract = {
        Key: { id: string };
        State: { count: number };
        Events: { changed: { count: number } };
        Views: { count: number };
        Commands: { set: { Input: { count: number }; Event: "changed" } };
      };`,
    );
    await writeFile(
      contract,
      `import type { ButtonContract, ResourceContract } from "./shared";
      type Components = {
        /** Primary control. */
        Button: ButtonContract;
      };
      export type App = {
        Resources: { counter: ResourceContract };
        Components: Components;
        Features: {
          editor: {
            Resources: { draft: ResourceContract };
            Components: {
              Composer: { Parts: { Root: "form"; Input: "textarea"; Send: "button" } };
            };
          };
        };
      };`,
    );

    const first = analyzeAppContract(contract);
    expect(first.components.Button?.parts).toEqual({ Root: "button", Label: "span" });
    expect(first.components.Button?.doc).toBe("Primary control.");
    expect(first.components["@feature/editor/component/Composer"]?.parts).toEqual({
      Root: "form",
      Input: "textarea",
      Send: "button",
    });
    expect(first.resources[0]?.events).toEqual(["changed"]);
    expect(Object.keys(first.manifest.contract.resources)).toEqual([
      "@feature/editor/resource/draft",
      "counter",
    ]);

    type ValidationApp = {
      Actor: { id: string };
      Resources: {
        counter: {
          Key: { id: string };
          State: { count: number };
          Events: { changed: { count: number } };
          Views: { count: number };
          Commands: { set: { Input: { count: number }; Event: "changed" } };
        };
      };
    };
    const validated = installAppMigrations(
      defineApp<ValidationApp>({
        version: 1,
        resources: {
          counter: {
            state: { count: 0 },
            events: { changed: ({ state, payload }) => (state.count = payload.count) },
            views: { count: ({ state }) => state.count },
            commands: { set: (context, { count }) => context.event.changed({ count }) },
          },
        },
      }),
      { hash: first.manifest.contract.hash, contract: first.manifest.contract },
    );
    expect(() => assertResourceKey(validated, "counter", { id: "one" })).not.toThrow();
    expect(() => assertResourceKey(validated, "counter", { id: 1 })).toThrow("counter.key");
    expect(() => assertResourceCommand(validated, "counter", "set", [{ count: 1 }])).not.toThrow();
    expect(() => assertResourceCommand(validated, "counter", "set", [{ count: "one" }])).toThrow(
      "counter.command.set",
    );

    await writeFile(
      shared,
      (await readFile(shared, "utf8")).replace('Label: "span"', 'Copy: "strong"'),
    );
    const second = analyzeAppContract(contract);
    expect(second.components.Button?.parts).toEqual({ Root: "button", Copy: "strong" });
    expect(second.manifest.contract.hash).toBe(first.manifest.contract.hash);

    await writeFile(
      shared,
      (await readFile(shared, "utf8")).replace(
        "State: { count: number }",
        "State: { count: string }",
      ),
    );
    expect(analyzeAppContract(contract).manifest.contract.hash).not.toBe(
      first.manifest.contract.hash,
    );
  }, 15_000);

  it("analyzes the source condition of imported generic Feature contracts", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "poggers-compiler-feature-"));
    createdDirs.push(appDir);
    const packageDir = join(appDir, "node_modules", "@fixture", "feature");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@fixture/feature",
        type: "module",
        exports: {
          ".": {
            "poggers-source": "./src.ts",
            types: "./dist.d.ts",
            default: "./dist.js",
          },
        },
      }),
    );
    await writeFile(
      join(packageDir, "src.ts"),
      `export type Feature<Actor> = {
        Resources: {};
        Components: {
          Account: {
            Input: { changed?: (actor: Actor | null) => void };
            Context: { actor: Actor | null };
            Phases: "loading" | "signedOut" | "signedIn";
            State: { signedIn: boolean; sessionCount: number };
            Parts: { Root: "section"; Loading: "span"; Login: "button"; Logout: "button" };
          };
        };
      };`,
    );
    await writeFile(
      join(packageDir, "dist.d.ts"),
      `export type Feature<Actor> = {
        Resources: {};
        Components: { Account: { Parts: { Root: "section"; Logout: "button" } } };
      };`,
    );
    await writeFile(join(packageDir, "dist.js"), "export {};\n");
    const appPath = join(appDir, "app.tsx");
    await writeFile(
      appPath,
      `import type { Feature } from "@fixture/feature";
      export type App = {
        Resources: {};
        Components: {};
        Features: { auth: Feature<{ id: string }> };
      };`,
    );

    const account = analyzeAppContract(appPath).components["@feature/auth/component/Account"];
    expect(account?.parts).toEqual({
      Root: "section",
      Loading: "span",
      Login: "button",
      Logout: "button",
    });
    expect(account?.phases).toEqual(["loading", "signedOut", "signedIn"]);
    expect(account?.stateNames).toEqual(["signedIn", "sessionCount"]);
    expect(account?.inputCallbacks).toEqual(["changed"]);
  });

  it("inherits application path aliases while analyzing Feature contracts", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "poggers-compiler-paths-"));
    createdDirs.push(appDir);
    const sourceDir = join(appDir, "src");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(appDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "preserve",
          moduleResolution: "bundler",
          paths: { "src/*": ["./src/*"] },
          strict: true,
        },
      }),
    );
    await writeFile(
      join(sourceDir, "feature.ts"),
      `export type Feature = {
        Resources: {};
        Components: { Panel: { Parts: { Root: "aside"; Action: "button" } } };
      };`,
    );
    const appPath = join(sourceDir, "app.tsx");
    await writeFile(
      appPath,
      `import type { Feature } from "src/feature";
      export type App = {
        Resources: {};
        Components: {};
        Features: { panel: Feature };
      };`,
    );

    expect(analyzeAppContract(appPath).components["@feature/panel/component/Panel"]?.parts).toEqual(
      {
        Root: "aside",
        Action: "button",
      },
    );
  });

  it("serializes only persistent resource schema through the TypeScript AST", () => {
    const first = persistentResourceSchemaSource(`
      type Count = number;
      export type App = {
        Resources: {
          counter: {
            Key: { id: string };
            State: { count: Count };
            Events: { changed: { count: Count } };
            Views: { label: string };
          };
        };
        Components: { Button: { Parts: { Root: "button" } } };
      };
    `);
    const second = persistentResourceSchemaSource(`
      type Count = number;
      export type App = {
        Resources: { counter: {
          Key: { id: string };
          State: { count: Count };
          Events: { changed: { count: Count } };
          Views: { label: number };
        } };
      };
    `);

    expect(first).toBe(second);
    expect(first).toContain("type Count = number;");
    expect(first).not.toContain("Components");
    expect(first).not.toContain("Views");
  });

  it("starts and disposes endpoint dependencies without requiring a server program", async () => {
    const appDir = await writeVisualFixture("endpoint-only-dependencies");
    await writeFile(
      join(appDir, "src/app.tsx"),
      `import type { AppDef } from "@poggers/kit";
export type App = {
  Resources: {};
  Components: {};
  Dependencies: { server: { clock: { now(): number } } };
  Endpoints: { ping: { Method: "GET" } };
};
const endpointImplementationMarker = "server-only-endpoint-implementation";
const runtimeGlobal = globalThis as typeof globalThis & {
  __poggersDependencyLifecycle?: { starts: number; stops: number };
};
const lifecycle = (runtimeGlobal.__poggersDependencyLifecycle ??= { starts: 0, stops: 0 });
export default {
  version: 1,
  resources: {},
  dependencies: {
    server: {
      clock: {
        kind: "dependency",
        start() { lifecycle.starts++; return { now: () => 42 }; },
        stop() { lifecycle.stops++; },
      },
    },
  },
  endpoints: {
    ping: {
      method: "GET",
      path: "/ping",
      handle(_request, { dependencies }) {
        void endpointImplementationMarker;
        return Response.json({ now: dependencies.clock.now() });
      },
    },
  },
} satisfies AppDef<App>;\n`,
    );

    const loaded = await loadApp(appDir);
    const dependencies = loaded.dependencyGroups.application as { clock: { now(): number } };
    expect(dependencies.clock.now()).toBe(42);
    const runtimeGlobal = globalThis as typeof globalThis & {
      __poggersDependencyLifecycle?: { starts: number; stops: number };
    };
    const lifecycle = runtimeGlobal.__poggersDependencyLifecycle;
    expect(lifecycle).toEqual({ starts: 1, stops: 0 });
    await loaded.disposeDependencies?.();
    await loaded.disposeDependencies?.();
    expect(lifecycle).toEqual({ starts: 1, stops: 1 });
    delete runtimeGlobal.__poggersDependencyLifecycle;

    const outdir = join(appDir, "browser-dist");
    const build = await runCli(appDir, ["bundle", ".", "--outdir", outdir, "--minify", "false"]);
    expect(build.code, build.stderr).toBe(0);
    const browserFiles = await readdir(outdir);
    const javascript = await Promise.all(
      browserFiles
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFile(join(outdir, file), "utf8")),
    );
    expect(javascript.join("\n")).not.toContain("server-only-endpoint-implementation");
  }, 15_000);

  it("validates and statically bundles the closed v2 visual preset", async () => {
    const appDir = await writeVisualFixture("bundle");
    expect(checkAppConventions(appDir)).toEqual([]);

    const outdir = join(appDir, "dist");
    const build = await runCli(appDir, ["bundle", ".", "--outdir", outdir, "--minify", "false"]);
    expect(build.code, build.stderr).toBe(0);
    const files = await readdir(outdir);
    const cssFile = files.find((file) => file.endsWith(".css"));
    const jsFile = files.find((file) => file.endsWith(".js"));
    expect(cssFile).toBeDefined();
    expect(jsFile).toBeDefined();

    const css = await readFile(join(outdir, cssFile!), "utf8");
    const js = await readFile(join(outdir, jsFile!), "utf8");
    expect(css).toContain("@layer reset, accessibility, motion");
    expect(css).toContain("::file-selector-button");
    expect(css).toContain("dialog::backdrop");
    expect(css).toContain("interpolate-size: allow-keywords");
    expect(css).toContain("dialog:not([open])");
    expect(css).toContain("background-color:");
    expect(css).toContain("border-radius:");
    expect(css).toContain("@container");
    expect(js).not.toContain("stylex.create");
    expect(js).not.toContain("stylex-inject");
    expect(js).not.toContain("data-stylex");
  }, 15_000);

  it("reports compiler diagnostics through the app validation boundary", async () => {
    const appDir = await writeVisualFixture("invalid", { invalidVisualField: true });
    const check = await runCli(appDir, ["check", "."]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('unknown field "mystery"');
  });

  it("validates statechart topology and contract names before bundling", async () => {
    const appDir = await writeVisualFixture("statechart-validation");
    const appPath = join(appDir, "src/app.tsx");
    const validContract = (await readFile(appPath, "utf8"))
      .replace('Phases: "active" | "notifying";', 'Phases: "idle" | "active";')
      .replace("      Tasks: { notify: { Input: boolean; Output: void; Error: never } };\n", "");
    const validSource = validContract.replace(
      `context: { active: false },
        initial: "active",
        phases: {
          active: {
            on: {
              activate: {
                update: ({ context }) => ({ active: !context.active }),
                target: "notifying",
              },
            },
          },
          notifying: {
            task: { run: "notify", input: ({ context }) => context.active, done: "active" },
          },
        },
        tasks: { notify: ({ input }) => input.activate() },`,
      `context: { active: false },
        initial: "idle",
        phases: {
          idle: { on: { activate: { target: "active" } } },
          active: { on: { activate: { target: "idle" } } },
        },`,
    );
    await writeFile(appPath, validSource);
    expect(checkAppConventions(appDir)).toEqual([]);

    await writeFile(
      appPath,
      validSource
        .replace('Phases: "idle" | "active";', 'Phases: "idle" | "active" | "dormant";')
        .replace("          active: {", "          dormant: {},\n          active: {"),
    );
    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Button phase dormant is unreachable.",
    );

    await writeFile(
      appPath,
      validSource
        .replace('Phases: "idle" | "active";', 'Phases: "idle" | "active" | "orphan";')
        .replace('initial: "idle"', 'initial: "missing"')
        .replace('target: "active"', 'target: "missing"')
        .replace('activate: { target: "missing"', 'unknown: "idle", activate: { target: "missing"')
        .replace(
          "          active: {",
          '          ghost: { phases: { child: {} } },\n          active: { type: "final",',
        ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "component Button initial must name a direct child phase path.",
        "component Button phase ghost is absent from Phases.",
        "component Button Phases member orphan is absent from its statechart.",
        "component Button statechart handles undeclared action unknown.",
        "component Button transition targets unknown Phases member missing.",
        "component Button compound phase ghost needs an initial child.",
        "component Button final phase active cannot define on.",
      ]),
    );
  });

  it("serves TypeScript 7 LSP diagnostics directly from source contracts", async () => {
    const appDir = await writeVisualFixture("lsp", { visibleDirectory: true });
    const session = await startLsp(appDir);

    try {
      const appPath = join(appDir, "src/app.tsx");
      expect(await session.diagnostics(appPath)).toEqual([]);

      const completionStarted = performance.now();
      const completion = await session.completion(
        join(appDir, "src/app.tsx"),
        "input.label",
        "input.".length,
      );
      const completionLatency = performance.now() - completionStarted;
      const completionItems = Array.isArray(completion)
        ? completion
        : ((completion as { items?: unknown[] } | null)?.items ?? []);
      expect(completionItems.some((item) => (item as { label?: unknown }).label === "label")).toBe(
        true,
      );
      expect(completionLatency).toBeLessThan(1_000);

      const hoverStarted = performance.now();
      const hover = await session.hover(join(appDir, "src/app.tsx"), "<Button", 2);
      expect(performance.now() - hoverStarted).toBeLessThan(1_000);
      expect(hover).toBeTruthy();

      const definitionStarted = performance.now();
      const definition = await session.definition(join(appDir, "src/app.tsx"), "systemPreset", 2);
      expect(performance.now() - definitionStarted).toBeLessThan(1_000);
      expect(definition).toBeTruthy();

      const renameStarted = performance.now();
      const rename = await session.rename(join(appDir, "src/app.tsx"), "Button, Badge", 10, "Mark");
      expect(performance.now() - renameStarted).toBeLessThan(1_000);
      expect(rename).toBeTruthy();

      const autoImportPath = join(appDir, "src/auto-import.ts");
      await writeFile(autoImportPath, "export const selected = systemPre\n");
      const autoImportStarted = performance.now();
      const autoImport = await session.completion(autoImportPath, "systemPre", "systemPre".length);
      expect(performance.now() - autoImportStarted).toBeLessThan(1_000);
      const autoImportItems = Array.isArray(autoImport)
        ? autoImport
        : ((autoImport as { items?: unknown[] } | null)?.items ?? []);
      expect(
        autoImportItems.some((item) => (item as { label?: unknown }).label === "systemPreset"),
      ).toBe(true);

      const app = await readFile(appPath, "utf8");
      await writeFile(
        appPath,
        app.replace('Parts: { Root: "span" };', 'Parts: { Root: "span"; Detail: "span" };'),
      );
      await session.change(appPath, await readFile(appPath, "utf8"));

      expect(await session.diagnostics(appPath)).toEqual([]);
      expect(await session.diagnostics(join(appDir, "src/presets/system.ts"))).toEqual([]);
    } finally {
      // TypeScript 7 may report a canceled watch as exit 1 after orderly LSP shutdown.
      expect([0, 1]).toContain(await session.close());
    }
  });

  it("rejects raw classes, inline style, and direct backend imports", async () => {
    const appDir = await writeVisualFixture("escapes");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      `import * as stylex from "@stylexjs/stylex";\nimport { render } from "@poggers/kit/host/browser";\nimport { Virtualizer } from "@tanstack/virtual-core";\n${app}`.replace(
        "return <Root><Button",
        'return <Root className={stylex.props({}).className} style={{ color: "red" }}><Button',
      ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "@stylexjs/stylex is owned by presets and the Poggers runtime.",
        "@poggers/kit/host/browser is owned by presets and the Poggers runtime.",
        "@tanstack/virtual-core is owned by presets and the Poggers runtime.",
        "className is visual and belongs in presets.",
        "style is visual and belongs in presets.",
      ]),
    );
  });

  it("requires the canonical app.tsx source", async () => {
    const appDir = await writeVisualFixture("source-name");
    await rename(join(appDir, "src/app.tsx"), join(appDir, "src/app.ts"));
    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "Poggers applications must use src/app.tsx.",
    );
    const bundle = await runCli(appDir, ["bundle", "."]);
    expect(bundle.code).toBe(1);
    expect(bundle.stderr).toContain("Poggers applications must use");
  });

  it("reports reserved input and slot collisions", async () => {
    const appDir = await writeVisualFixture("component-contracts");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      app
        .replace(
          'Input: { label: string; tone: "quiet" | "strong"; activate(): void };',
          'Input: { state: boolean; label: string; tone: "quiet" | "strong"; activate(): void };',
        )
        .replace(
          "Slots: { icon: Child };",
          'Slots: { Root: Child }; Gestures: { activate: "drag" };',
        ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "component Button input state is reserved by component props.",
        "component Button slot Root collides with another component member.",
        "component Button declares unsupported member Gestures.",
      ]),
    );
  });

  it("requires every declared component part in its one registered hierarchy", async () => {
    const appDir = await writeVisualFixture("component-hierarchy");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(appPath, app.replace("<Label>{state.label}</Label>", ""));

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Button view does not use part Label.",
    );
  });

  it("requires renderable namespaces to be destructured at the view boundary", async () => {
    const appDir = await writeVisualFixture("component-namespace-bindings");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      app.replace(
        "view({ components: { Button, Badge }, parts: { Root } }) {",
        "view({ components, parts }) {",
      ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "component AppRoot view must destructure parts at the parameter boundary.",
        "component AppRoot view must destructure components at the parameter boundary.",
      ]),
    );
  });

  it("requires each component hierarchy to be one inline view method", async () => {
    const appDir = await writeVisualFixture("external-component-render");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      `const externalView = () => null;\n${app.replace(
        "view({ state, parts: { Root } }) {\n        return <Root>{state.text}</Root>;\n      },",
        "view: externalView,",
      )}`,
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Badge must define exactly one inline view method.",
    );
  });

  it("rejects raw elements and duplicate static ids", async () => {
    const appDir = await writeVisualFixture("component-composition");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      app.replace(
        'return <Root><Button label="Toggle" tone="strong" activate={() => {}} icon="*" /><Badge text="Stable" /></Root>;',
        'return <Root id="duplicate"><Button label="Toggle" tone="strong" activate={() => {}} icon="*" /><span /><Badge text="Stable" id="duplicate" /></Root>;',
      ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "component AppRoot must declare semantic element span as a typed part.",
        "component AppRoot renders duplicate static id duplicate.",
      ]),
    );
  });
});

async function runCli(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cli = resolve(import.meta.dir, "./cli.ts");
  const process = Bun.spawn(["bun", cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

type LspWireMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

async function startLsp(appDir: string): Promise<{
  diagnostics(path: string): Promise<unknown[]>;
  completion(path: string, marker: string, offset: number): Promise<unknown>;
  definition(path: string, marker: string, offset: number): Promise<unknown>;
  hover(path: string, marker: string, offset: number): Promise<unknown>;
  rename(path: string, marker: string, offset: number, name: string): Promise<unknown>;
  change(path: string, text: string): Promise<void>;
  close(): Promise<number>;
}> {
  const cli = resolve(import.meta.dir, "./cli.ts");
  const server = Bun.spawn(["bun", cli, "lsp", appDir], {
    cwd: appDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const serverErrors = new Response(server.stderr).text();
  const serverExit = server.exited.then(async (code) => ({ code, stderr: await serverErrors }));
  const waiters = new Map<number, (message: LspWireMessage) => void>();
  const opened = new Set<string>();
  const logs: string[] = [];
  let nextId = 1;

  const send = async (message: object) => {
    const body = JSON.stringify(message);
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    await server.stdin.flush();
  };
  const request = async (method: string, params: object | null) => {
    const id = nextId;
    nextId += 1;
    const response = new Promise<LspWireMessage>((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        waiters.delete(id);
        rejectResponse(new Error(`TypeScript LSP did not answer ${method}.`));
      }, 5_000);
      waiters.set(id, (message) => {
        clearTimeout(timeout);
        resolveResponse(message);
      });
    });
    await send({ jsonrpc: "2.0", id, method, params });
    return Promise.race([
      response,
      serverExit.then(({ code, stderr }) => {
        throw new Error(
          `TypeScript LSP exited with code ${code} before answering ${method}.${stderr ? `\n${stderr}` : ""}`,
        );
      }),
    ]);
  };

  const readOutput = (async () => {
    let buffer = Buffer.alloc(0);
    for await (const chunk of server.stdout) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buffer.subarray(0, headerEnd).toString();
        const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
        if (!lengthMatch) throw new Error("TypeScript LSP response omitted Content-Length.");
        const bodyLength = Number(lengthMatch[1]);
        if (buffer.length < headerEnd + 4 + bodyLength) break;
        const message = JSON.parse(
          buffer.subarray(headerEnd + 4, headerEnd + 4 + bodyLength).toString(),
        ) as LspWireMessage;
        buffer = buffer.subarray(headerEnd + 4 + bodyLength);

        if (message.method === "window/logMessage") {
          const params = message.params as { message?: unknown } | undefined;
          if (typeof params?.message === "string") logs.push(params.message);
        }

        if (typeof message.id === "number" && waiters.has(message.id)) {
          waiters.get(message.id)!(message);
          waiters.delete(message.id);
        } else if (message.id != null && message.method) {
          await send({ jsonrpc: "2.0", id: message.id, result: null });
        }
      }
    }
  })();

  try {
    await request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(appDir).href,
      workspaceFolders: [{ uri: pathToFileURL(appDir).href, name: "fixture" }],
      capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } },
    });
    await send({ jsonrpc: "2.0", method: "initialized", params: {} });
  } catch (error) {
    server.kill();
    server.stdin.end();
    await Promise.allSettled([serverExit, readOutput]);
    throw error;
  }

  const openDocument = async (path: string) => {
    const uri = pathToFileURL(path).href;
    if (!opened.has(uri)) {
      opened.add(uri);
      await send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: path.endsWith(".tsx") ? "typescriptreact" : "typescript",
            version: 1,
            text: await readFile(path, "utf8"),
          },
        },
      });
      await Bun.sleep(100);
    }
    return uri;
  };

  const markerPosition = async (path: string, marker: string, offset: number) => {
    const text = await readFile(path, "utf8");
    const index = text.indexOf(marker);
    if (index < 0) throw new Error(`LSP fixture is missing marker ${JSON.stringify(marker)}.`);
    const prefix = text.slice(0, index + offset);
    const lines = prefix.split("\n");
    return { line: lines.length - 1, character: lines.at(-1)!.length };
  };

  return {
    async diagnostics(path) {
      const uri = await openDocument(path);
      const response = await request("textDocument/diagnostic", {
        textDocument: { uri },
      });
      const result = response.result as { items?: unknown[] } | undefined;
      return Array.isArray(result?.items) ? result.items : [];
    },
    async completion(path, marker, offset) {
      const uri = await openDocument(path);
      return (
        await request("textDocument/completion", {
          textDocument: { uri },
          position: await markerPosition(path, marker, offset),
        })
      ).result;
    },
    async definition(path, marker, offset) {
      const uri = await openDocument(path);
      return (
        await request("textDocument/definition", {
          textDocument: { uri },
          position: await markerPosition(path, marker, offset),
        })
      ).result;
    },
    async hover(path, marker, offset) {
      const uri = await openDocument(path);
      return (
        await request("textDocument/hover", {
          textDocument: { uri },
          position: await markerPosition(path, marker, offset),
        })
      ).result;
    },
    async rename(path, marker, offset, name) {
      const uri = await openDocument(path);
      return (
        await request("textDocument/rename", {
          textDocument: { uri },
          position: await markerPosition(path, marker, offset),
          newName: name,
        })
      ).result;
    },
    async change(path, text) {
      const uri = pathToFileURL(path).href;
      await send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text }],
        },
      });
      await send({
        jsonrpc: "2.0",
        method: "textDocument/didSave",
        params: { textDocument: { uri }, text },
      });
    },
    async close() {
      await request("shutdown", null);
      await send({ jsonrpc: "2.0", method: "exit" });
      const code = await server.exited;
      server.stdin.end();
      await readOutput;
      await serverErrors;
      return code;
    },
  };
}

async function writeVisualFixture(
  name: string,
  options: { invalidVisualField?: boolean; visibleDirectory?: boolean } = {},
): Promise<string> {
  const appDir = await mkdtemp(join(tmpdir(), `poggers-runtime-${name}-`));
  createdDirs.push(appDir);
  await mkdir(join(appDir, "src"), { recursive: true });
  await mkdir(join(appDir, "src/presets"), { recursive: true });

  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({
      name: `@poggers/runtime-${name}`,
      private: true,
      type: "module",
      dependencies: { "@poggers/kit": "workspace:*" },
      devDependencies: { "@types/bun": "^1.3.14", typescript: "^7.0.2" },
    }),
  );
  if (options.visibleDirectory) {
    const scopeDir = join(appDir, "node_modules/@poggers");
    const typesDir = join(appDir, "node_modules/@types");
    const binDir = join(appDir, "node_modules/.bin");
    await mkdir(scopeDir, { recursive: true });
    await mkdir(typesDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await symlink(
      resolve(import.meta.dir, "../.."),
      join(scopeDir, "kit"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      resolve(import.meta.dir, "../../node_modules/@types/bun"),
      join(typesDir, "bun"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(
      resolve(import.meta.dir, "../../node_modules/.bin/tsc"),
      join(binDir, process.platform === "win32" ? "tsc.cmd" : "tsc"),
      "file",
    );
  }
  await writeFile(
    join(appDir, "tsconfig.json"),
    JSON.stringify({
      extends: "@poggers/kit/tsconfig",
      compilerOptions: { paths: { "src/*": ["./src/*"] } },
    }),
  );
  const appContract = `import type { Child } from "@poggers/kit/ui";

export type App = {
  Resources: {};
  Dependencies: { server: { logger: { write(message: string): void } } };
  Components: {
    AppRoot: {
      Parts: { Root: "main" };
    };
    Button: {
      Input: { label: string; tone: "quiet" | "strong"; activate(): void };
      Context: { active: boolean };
      Phases: "active" | "notifying";
      Tasks: { notify: { Input: boolean; Output: void; Error: never } };
      State: { label: string; tone: "quiet" | "strong"; active: boolean };
      Actions: { activate(): void };
      Slots: { icon: Child };
      Parts: { Root: "button"; Label: "span" };
    };
    Badge: {
      Input: { text: string };
      State: { text: string };
      Parts: { Root: "span" };
    };
  };
  Styles: {
    Presets: {
      system: {
        Tokens: {
          color: "canvas" | "text" | "accent" | "focus";
          space: "control";
          size: "compact";
          radius: "control";
          motion: "quick";
        };
        Themes: "default";
      };
    };
  };
};
`;
  await writeFile(
    join(appDir, "src/presets/system.ts"),
    `import type { Preset, PresetTokens } from "@poggers/kit/preset";
import type { App } from "src/app";

const theme = {
    color: {
      canvas: { l: 0.98, c: 0.004, h: 255 },
      text: { l: 0.2, c: 0.01, h: 255 },
      accent: { l: 0.56, c: 0.18, h: 255 },
      focus: { l: 0.64, c: 0.17, h: 250 },
    },
    space: { control: { kind: "space", value: 12 } },
    size: { compact: { kind: "size", value: 420 } },
    radius: { control: { kind: "radius", value: 10 } },
    motion: {
      quick: { duration: 130, easing: "decelerate" },
    },
} satisfies PresetTokens<App, "system">;

export const systemPreset = (({ tokens, createRecipe }) => {
  const button = createRecipe({
    base: {
        layout: {
          flow: { axis: "inline", align: "center", distribute: "center" },
          padding: { inline: tokens.space.control },
        },
        paint: {
          fill: tokens.color.canvas,
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 3, offset: 2 },
        },
        typography: { color: tokens.color.text },
        shape: { radius: tokens.radius.control },
        motion: { transition: { opacity: tokens.motion.quick } },
        ${options.invalidVisualField ? "mystery: true," : ""}
      },
    variants: {
      tone: {
        quiet: {},
        strong: { paint: { fill: tokens.color.accent } },
      },
    },
  });
  return {
    theme,
    components: {
      AppRoot() { return { Root: {} }; },
      Button({ state, geometry }) {
        return {
          Root: [
            button({ tone: state.tone }),
            {
              when: geometry.inlineSize.isBelow(tokens.size.compact),
              layout: { size: { inline: "fill" } },
            },
          ],
          Label: { typography: { size: 14, weight: 650, line: 1 } },
        };
      },
      Badge() { return { Root: { typography: { color: tokens.color.text } } }; },
    },
  };
}) satisfies Preset<App, "system", typeof theme>;
`,
  );
  await writeFile(
    join(appDir, "src/app.tsx"),
    `import type { AppDef as AppDefinition } from "@poggers/kit";
import { systemPreset } from "src/presets/system";
${appContract}

export default {
  version: 1,
  resources: {},
  dependencies: { server: { logger: { write() {} } } },
  components: {
    AppRoot: {
      view({ components: { Button, Badge }, parts: { Root } }) {
        return <Root><Button label="Toggle" tone="strong" activate={() => {}} icon="*" /><Badge text="Stable" /></Root>;
      },
    },
    Button: {
      machine: {
        context: { active: false },
        initial: "active",
        phases: {
          active: {
            on: {
              activate: {
                update: ({ context }) => ({ active: !context.active }),
                target: "notifying",
              },
            },
          },
          notifying: {
            task: { run: "notify", input: ({ context }) => context.active, done: "active" },
          },
        },
        tasks: { notify: ({ input }) => input.activate() },
      },
      state({ input, context }) {
        return { label: input.label, tone: input.tone, active: context.active };
      },
      view({ state, actions, slots, parts: { Root, Label } }) {
        return <Root type="button" onClick={actions.activate} aria-pressed={state.active}>
          {slots.icon}<Label>{state.label}</Label>
        </Root>;
      },
    },
    Badge: {
      state: ({ input }) => ({ text: input.text }),
      view({ state, parts: { Root } }) {
        return <Root>{state.text}</Root>;
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: "AppRoot",
} satisfies AppDefinition<App>;
`,
  );

  return appDir;
}
