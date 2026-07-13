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
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeAppContract,
  persistentResourceSchemaSource,
  transformComponentSource,
} from "../src/component-compiler";
import { checkAppConventions, resolveDependencyMount } from "../src/runtime";

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
            render({ context, values, events, components: { Item }, parts: { Root, Label } }) {
              return (
                <Root aria-expanded={context.open} onClick={events.open}>
                  <Label>{values.label}</Label>
                  <Show when={context.open}><Item label={values.label} active={context.open} /></Show>
                  <For each={values.items} by="id">
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

    expect(source).toContain("render(__poggersRender)");
    expect(source).toContain("aria-expanded={() => __poggersRender.context.open}");
    expect(source).toContain("onClick={__poggersRender.events.open}");
    expect(source).toContain("{() => __poggersRender.values.label}");
    expect(source).toContain("<Show when={() => __poggersRender.context.open}");
    expect(source).toContain("label={() => __poggersRender.values.label}");
    expect(source).toMatch(/\(item, index, __poggersForIndex_\d+\) =>/);
    expect(source).toMatch(/data-index=\{\(\) => __poggersForIndex_\d+\(\)\}/);
    expect(source).toMatch(/\{\(\) => __poggersForIndex_\d+\(\)\}: \{\(\) => item.label\}/);
    expect(source).toContain("active={() => __poggersRender.context.open}");
    expect(source).toContain("sourceMappingURL=data:application/json;base64,");
  });

  it("targets only component renders, respects shadowing, and lowers nested reactive input", () => {
    const source = transformComponentSource(
      `export default {
        resources: {
          example: { views: { view({ state }) { return state.value; } } },
        },
        components: {
          Menu: {
            derive({ context }) {
              const open = context.open;
              return { open, label: context.open ? "Open" : "Closed", staticLabel: "Menu" };
            },
            render({ context, components: { Item }, resources: load, parts: { Root, Label } }) {
              const data = load.data({ filter: { open: context.open } });
              const labels = [{ label: "local" }].map((context) => context.label);
              return <Show when={context.open} fallback={<Label>{data.empty}</Label>}>
                <Root data-label={labels[0]}><Item config={{ open: context.open }} /></Root>
              </Show>;
            },
          },
        },
      };`,
      "/app/src/app.tsx",
    );

    expect(source).toContain("view({ state }) { return state.value; }");
    expect(source).toContain("derive(__poggersDerive)");
    expect(source).toContain("get open()");
    expect(source).toContain("get label()");
    expect(source).toContain('staticLabel: "Menu"');
    expect(source).toContain("config={() => ({ open: __poggersRender.context.open })}");
    expect(source).toContain("get filter()");
    expect(source).toContain("(context) => context.label");
    expect(source).toContain("fallback={() => <Label>{() => data.empty}</Label>}");
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
    const appDir = await mkdtemp(resolve(".poggers-compiler-contract-"));
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
        Commands: {};
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
      };`,
    );

    const first = analyzeAppContract(contract);
    expect(first.components.Button?.parts).toEqual({ Root: "button", Label: "span" });
    expect(first.components.Button?.doc).toBe("Primary control.");
    expect(first.resources[0]?.events).toEqual(["changed"]);

    await writeFile(
      shared,
      (await readFile(shared, "utf8")).replace('Label: "span"', 'Copy: "strong"'),
    );
    const second = analyzeAppContract(contract);
    expect(second.components.Button?.parts).toEqual({ Root: "button", Copy: "strong" });
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

  it("resolves values and named production/mock dependency providers", async () => {
    const deps = await resolveDependencyMount<{
      ai: { complete(): string };
      clock: { now(): number };
    }>({
      mode: "mock",
      ai: {
        production: { complete: () => "production" },
        mock: { complete: () => "mock" },
      },
      clock: { now: () => 123 },
    });

    expect(deps.ai.complete()).toBe("mock");
    expect(deps.clock.now()).toBe(123);
  });

  it("uses POGGERS_DEPS as the default dependency mode", async () => {
    const previous = process.env.POGGERS_DEPS;
    process.env.POGGERS_DEPS = "mock";

    try {
      const deps = await resolveDependencyMount<{ ai: { complete(): string } }>({
        ai: {
          production: { complete: () => "production" },
          mock: { complete: () => "mock" },
        },
      });
      expect(deps.ai.complete()).toBe("mock");
    } finally {
      if (previous === undefined) delete process.env.POGGERS_DEPS;
      else process.env.POGGERS_DEPS = previous;
    }
  });

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
  });

  it("reports compiler diagnostics through the app validation boundary", async () => {
    const appDir = await writeVisualFixture("invalid", { invalidVisualField: true });
    const check = await runCli(appDir, ["check", "."]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('unknown field "mystery"');
  });

  it("validates statechart topology and contract names before bundling", async () => {
    const appDir = await writeVisualFixture("statechart-validation");
    const typesPath = join(appDir, "src/types.ts");
    const validTypes = (await readFile(typesPath, "utf8")).replace(
      'States: "active";',
      'States: "idle" | "active";',
    );
    await writeFile(typesPath, validTypes);
    const appPath = join(appDir, "src/app.tsx");
    const validSource = (await readFile(appPath, "utf8")).replace(
      `initial: "active",
      states: {
          active: {
            on: {
              activate: {
                update: ({ context }) => ({ active: !context.active }),
                perform: ({ input }) => input.activate(),
              },
            },
          },
      },`,
      `initial: "idle",
      states: {
        idle: { on: { activate: { target: "active" } } },
        active: { on: { activate: { target: "idle" } } },
      },`,
    );
    await writeFile(appPath, validSource);
    expect(checkAppConventions(appDir)).toEqual([]);

    await writeFile(
      appPath,
      validSource.replace(
        'idle: { on: { activate: { target: "active" } } },',
        'idle: { on: { activate: { target: "active", perform: async () => {} } } },',
      ),
    );
    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Button transition perform must be synchronous; use a task for async work.",
    );

    await writeFile(
      typesPath,
      validTypes.replace('States: "idle" | "active";', 'States: "idle" | "active" | "dormant";'),
    );
    await writeFile(
      appPath,
      validSource.replace("        active: {", "        dormant: {},\n        active: {"),
    );
    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Button state dormant is unreachable.",
    );

    await writeFile(
      typesPath,
      validTypes.replace('States: "idle" | "active";', 'States: "idle" | "active" | "orphan";'),
    );
    await writeFile(
      appPath,
      validSource
        .replace('initial: "idle"', 'initial: "missing"')
        .replace('target: "active"', 'target: "missing"')
        .replace('activate: { target: "missing"', 'unknown: "idle", activate: { target: "missing"')
        .replace(
          "        active: {",
          '        ghost: { states: { child: {} } },\n        active: { type: "final",',
        ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "component Button initial must name a direct child state path.",
        "component Button state ghost is absent from States.",
        "component Button States member orphan is absent from its statechart.",
        "component Button statechart handles undeclared event unknown.",
        "component Button transition targets unknown States member missing.",
        "component Button compound state ghost needs an initial child.",
        "component Button final state active cannot define on.",
      ]),
    );
  });

  it("serves TypeScript 7 LSP diagnostics directly from source contracts", async () => {
    const appDir = await writeVisualFixture("lsp", { visibleDirectory: true });
    const session = await startLsp(appDir);

    try {
      expect(await session.diagnostics(join(appDir, "src/app.tsx"))).toEqual([]);
      expect(await session.diagnostics(join(appDir, "src/types.ts"))).toEqual([]);

      const completionStarted = performance.now();
      const completion = await session.completion(
        join(appDir, "src/app.tsx"),
        "components: { Button",
        "components: { ".length,
      );
      const completionLatency = performance.now() - completionStarted;
      const completionItems = Array.isArray(completion)
        ? completion
        : ((completion as { items?: unknown[] } | null)?.items ?? []);
      expect(completionItems.some((item) => (item as { label?: unknown }).label === "Button")).toBe(
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

      const typesPath = join(appDir, "src/types.ts");
      const types = await readFile(typesPath, "utf8");
      await writeFile(
        typesPath,
        types.replace('Parts: { Root: "span" };', 'Parts: { Root: "span"; Detail: "span" };'),
      );
      await session.change(typesPath, await readFile(typesPath, "utf8"));

      expect(await session.diagnostics(typesPath)).toEqual([]);
      expect(await session.diagnostics(join(appDir, "src/presets.ts"))).toEqual([]);
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
      `import * as stylex from "@stylexjs/stylex";\nimport { render } from "@poggers/kit/internal/ui";\nimport { Virtualizer } from "@tanstack/virtual-core";\n${app}`.replace(
        "return <Root><Button",
        'return <Root className={stylex.props({}).className} style={{ color: "red" }}><Button',
      ),
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "@stylexjs/stylex is owned by presets and the Poggers runtime.",
        "@poggers/kit/internal/ui is owned by presets and the Poggers runtime.",
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
    const typesPath = join(appDir, "src/types.ts");
    const types = await readFile(typesPath, "utf8");
    await writeFile(
      typesPath,
      types
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
    await writeFile(appPath, app.replace("<Label>{values.label}</Label>", ""));

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Button render does not use part Label.",
    );
  });

  it("requires each component hierarchy to be one inline render method", async () => {
    const appDir = await writeVisualFixture("external-component-render");
    const appPath = join(appDir, "src/app.tsx");
    const app = await readFile(appPath, "utf8");
    await writeFile(
      appPath,
      `const externalRender = () => null;\n${app.replace(
        "render({ input, parts: { Root } }) {\n        return <Root>{input.text}</Root>;\n      },",
        "render: externalRender,",
      )}`,
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "component Badge must define exactly one inline render method.",
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
  const cli = resolve(import.meta.dir, "../src/cli.ts");
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
  const cli = resolve(import.meta.dir, "../src/cli.ts");
  const server = Bun.spawn(["bun", cli, "lsp", appDir], {
    cwd: appDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const waiters = new Map<number, (message: LspWireMessage) => void>();
  const opened = new Set<string>();
  const logs: string[] = [];
  let nextId = 1;

  const send = (message: object) => {
    const body = JSON.stringify(message);
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    server.stdin.flush();
  };
  const request = (method: string, params: object | null) => {
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
    send({ jsonrpc: "2.0", id, method, params });
    return response;
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
          send({ jsonrpc: "2.0", id: message.id, result: null });
        }
      }
    }
  })();

  await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(appDir).href,
    workspaceFolders: [{ uri: pathToFileURL(appDir).href, name: "fixture" }],
    capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } },
  });
  send({ jsonrpc: "2.0", method: "initialized", params: {} });

  const openDocument = async (path: string) => {
    const uri = pathToFileURL(path).href;
    if (!opened.has(uri)) {
      opened.add(uri);
      send({
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
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const response = await request("textDocument/diagnostic", {
          textDocument: { uri },
        });
        const result = response.result as { items?: Array<{ code?: number }> } | undefined;
        const items = Array.isArray(result?.items) ? result.items : [];
        const inferredProject = items.some((item) => item.code === 17004 || item.code === 2307);
        if (!inferredProject) return items;
        if (attempt === 39) {
          throw new Error(`TypeScript LSP stayed in an inferred project.\n${logs.join("\n")}`);
        }
        await Bun.sleep(25);
      }
      return [];
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
      send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text }],
        },
      });
      send({
        jsonrpc: "2.0",
        method: "textDocument/didSave",
        params: { textDocument: { uri }, text },
      });
    },
    async close() {
      await request("shutdown", null);
      send({ jsonrpc: "2.0", method: "exit" });
      const code = await server.exited;
      server.stdin.end();
      await readOutput;
      await new Response(server.stderr).text();
      return code;
    },
  };
}

async function writeVisualFixture(
  name: string,
  options: { invalidVisualField?: boolean; visibleDirectory?: boolean } = {},
): Promise<string> {
  const appDir = await mkdtemp(
    options.visibleDirectory
      ? resolve(import.meta.dir, `../../../apps/poggers-runtime-${name}-`)
      : resolve(`.poggers-runtime-${name}-`),
  );
  createdDirs.push(appDir);
  await mkdir(join(appDir, "src"), { recursive: true });

  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({
      name: `@poggers/runtime-${name}`,
      private: true,
      type: "module",
      dependencies: { "@poggers/kit": "workspace:*" },
    }),
  );
  if (options.visibleDirectory) {
    const scopeDir = join(appDir, "node_modules/@poggers");
    await mkdir(scopeDir, { recursive: true });
    await symlink(
      resolve(import.meta.dir, ".."),
      join(scopeDir, "kit"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  await writeFile(join(appDir, "tsconfig.json"), '{"extends":"@poggers/kit/tsconfig"}\n');
  await writeFile(
    join(appDir, "src/types.ts"),
    `import type { Child } from "@poggers/kit/ui";

export type App = {
  Resources: {};
  Deps: { logger: { write(message: string): void } };
  Components: {
    AppRoot: {
      Parts: { Root: "main" };
    };
    Button: {
      Input: { label: string; tone: "quiet" | "strong"; activate(): void };
      Context: { active: boolean };
      States: "active";
      Values: { label: string; tone: "quiet" | "strong" };
      Events: { activate(): void };
      Slots: { icon: Child };
      Parts: { Root: "button"; Label: "span" };
    };
    Badge: {
      Input: { text: string };
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
`,
  );
  await writeFile(
    join(appDir, "src/presets.ts"),
    `import type { Preset, PresetTokens } from "@poggers/kit/style";
import type { App } from "src/types";

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
      Button({ values, geometry }) {
        return {
          Root: [
            button({ tone: values.tone }),
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
import { systemPreset } from "src/presets";
import type { App } from "src/types";

export default {
  version: 1,
  resources: {},
  components: {
    AppRoot: {
      render({ components: { Button, Badge }, parts: { Root } }) {
        return <Root><Button label="Toggle" tone="strong" activate={() => {}} icon="*" /><Badge text="Stable" /></Root>;
      },
    },
    Button: {
      context: { active: false },
      derive({ input }) {
        return {
          get label() { return input.label; },
          get tone() { return input.tone; },
        };
      },
      initial: "active",
      states: {
          active: {
            on: {
              activate: {
                update: ({ context }) => ({ active: !context.active }),
                perform: ({ input }) => input.activate(),
              },
            },
          },
      },
      render({ context, values, events, slots, parts: { Root, Label } }) {
        return <Root type="button" onClick={events.activate} aria-pressed={context.active}>
          {slots.icon}<Label>{values.label}</Label>
        </Root>;
      },
    },
    Badge: {
      render({ input, parts: { Root } }) {
        return <Root>{input.text}</Root>;
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
