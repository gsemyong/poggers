import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SYSTEM_IR_VERSION, type SystemIR } from "@/compiler/ir";
import { compileSystem, resolveSystem } from "@/compiler/source";
import { serverCompilerExtension } from "@/platforms/server/adapter";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import type { WebDocumentIR } from "@/platforms/web/adapter/document";
import {
  collectWebRoutes,
  WEB_COMPILER_IR_VERSION,
  webInterfaceCompilerIR,
  webProgramCompilerIR,
  type WebRouteIR,
} from "@/platforms/web/adapter/lowering";
import {
  buildWebInterface,
  collectReferencedClientResources,
  collectPresentationDependencies,
  createWebAssetManifest,
  inspectClientManifest,
  isProjectableSourceModule,
  negotiateWebRepresentation,
  planWebRouteDelivery,
  productionPresentationAssetPlugin,
  renderServiceWorkerBootstrap,
  renderWebDiscoveryResources,
  routeSourcePlugin,
  validateProductionWebRoute,
  webInterfaceRequiresClientRuntime,
  webRouteRequiresClientRuntime,
  webDevelopmentWorkspace,
  writeDevelopmentWebStream,
} from "@/platforms/web/adapter/pipeline";
import type { PresentationSourceIR } from "@/platforms/web/adapter/presentation/source";

describe("web representation negotiation", () => {
  it("keeps HTML canonical and selects alternates only when named", () => {
    expect(negotiateWebRepresentation(undefined)).toBeUndefined();
    expect(negotiateWebRepresentation("*/*")).toBeUndefined();
    expect(negotiateWebRepresentation("text/html, text/markdown;q=0")).toBe("document");
    expect(negotiateWebRepresentation("text/markdown, text/html;q=0.8")).toBe("markdown");
    expect(negotiateWebRepresentation("application/vnd.kit.route+json")).toBe("route-data");
    expect(negotiateWebRepresentation("application/json")).toBeUndefined();
  });
});

describe("web development workspace", () => {
  it("keeps a stable isolated cache for each interface", () => {
    const first = webDevelopmentWorkspace("/tmp/company", "interface/operations.web");
    expect(webDevelopmentWorkspace("/tmp/company", "interface/operations.web")).toBe(first);
    expect(webDevelopmentWorkspace("/tmp/company", "interface/customer.web")).not.toBe(first);
    expect(first).toContain("/.kit/cache/web/interface-operations-web-");
  });

  it("projects application and Feature sources without cloning neutral runtime modules", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const application = resolve(root, "examples/authenticated-crud/src");

    expect(isProjectableSourceModule(resolve(application, "features/tasks.tsx"), application)).toBe(
      true,
    );
    expect(
      isProjectableSourceModule(resolve(root, "src/features/data/index.ts"), application),
    ).toBe(true);
    expect(isProjectableSourceModule(resolve(root, "src/core/dependency.ts"), application)).toBe(
      false,
    );
    expect(isProjectableSourceModule(resolve(root, "src/compiler/ir.ts"), application)).toBe(false);
    expect(isProjectableSourceModule(resolve(root, "src/index.ts"), application)).toBe(false);
  });

  it(
    "retains the selected Route when one source Feature is reused by multiple Applications",
    { tags: ["package"], timeout: 30_000 },
    async () => {
      const workspace = resolve(import.meta.dirname, "../../../..", "examples/authenticated-crud");
      const paths = resolveSystem(workspace);
      const ir = compileSystem(paths.system, [serverCompilerExtension, webCompilerExtension]);
      const source = resolve(paths.source, "features/shell.tsx");
      const hook = routeSourcePlugin(paths, ir).transform;
      const handler = (typeof hook === "function" ? hook : hook?.handler) as unknown as (
        code: string,
        id: string,
      ) => Promise<string | Readonly<{ code: string }> | null | undefined>;
      expect(handler).toBeTypeOf("function");

      const authored = await readFile(source, "utf8");
      const result = await handler(authored, `${source}?kit-route=customerShell.auth&lang.tsx`);
      const code = (typeof result === "string" ? result : result?.code) ?? authored;

      expect(code).toContain("view({ children, components: { Layout } })");
      expect(code).not.toMatch(/routes:\s*{\s*auth:\s*{}\s*}/);

      const customerProgram = ir.programs.find(
        ({ interface: owner }) => owner === "customer.web",
      )?.name;
      expect(customerProgram).toBeTruthy();
      const base = await handler(authored, `${source}?kit-program=${customerProgram!}&lang.tsx`);
      const baseCode = (typeof base === "string" ? base : base?.code) ?? authored;
      expect(baseCode).toContain('phase: "loading"');
      expect(baseCode).toMatch(/routes:\s*{\s*workspace:\s*{},\s*auth:\s*{},?\s*}/);

      const tasksSource = resolve(paths.source, "features/tasks.tsx");
      const authoredTasks = await readFile(tasksSource, "utf8");
      const taskRoute = await handler(
        authoredTasks,
        `${tasksSource}?kit-route=tasks.list&lang.tsx`,
      );
      const taskRouteCode = (typeof taskRoute === "string" ? taskRoute : taskRoute?.code) ?? "";
      expect(taskRouteCode).toContain("export const tasks");
      expect(taskRouteCode).not.toContain("taskAggregateDefinition");
      expect(taskRouteCode).not.toContain("taskCompletionDefinition");
      expect(taskRouteCode).not.toContain('from "kit/features/workflow"');

      const tasks = await handler(
        authoredTasks,
        `${tasksSource}?kit-program=${customerProgram!}&lang.tsx`,
      );
      const tasksCode = (typeof tasks === "string" ? tasks : tasks?.code) ?? "";
      expect(tasksCode).toMatch(/features:\s*{\s*data:\s*taskData\s*}/);
      expect(tasksCode).not.toMatch(/features:\s*{[^}]*aggregate:\s*taskAggregate/s);
      expect(tasksCode).not.toContain("createWorkflow(");
    },
  );
});

describe("web development service worker lifecycle", () => {
  it("keeps an explicit PWA preview active across client redirects in one tab", () => {
    const source = renderServiceWorkerBootstrap("./service-worker.generated.ts", true, false);

    expect(source).toContain('previewParameter === "preview"');
    expect(source).toContain('sessionStorage.setItem("kit:pwa-preview", "active")');
    expect(source).toContain(
      'const preview = development && sessionStorage.getItem("kit:pwa-preview") === "active"',
    );
    expect(source).toContain('previewParameter === "off"');
    expect(source).toContain('sessionStorage.removeItem("kit:pwa-preview")');
    expect(source).toContain('if (stale.length > 0 && "caches" in globalThis)');
  });

  it("activates production updates and reloads an already controlled client once", () => {
    const source = renderServiceWorkerBootstrap("/service-worker.js", false, false);

    expect(source).toContain('updateViaCache: "none"');
    expect(source).toContain(
      'navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate)',
    );
    expect(source).toContain("if (!controlledAtStart || reloading) return");
    expect(source).toContain('registration.waiting?.postMessage("kit:activate")');
    expect(source).toContain('addEventListener("visibilitychange"');
    expect(source).toContain("setInterval(update, 60 * 60 * 1000)");
  });
});

describe("web Presentation dependency manifest", () => {
  it("preserves exact destinations and classifies independent Components", () => {
    const manifest = collectPresentationDependencies(systemIR(), "browser");

    expect(manifest).toEqual({
      "@feature/dashboard/component/Animated": [
        {
          destination: "Dashboard/Animated/Root/paint/opacity",
          animations: [
            {
              id: "Presentation/Dashboard/Animated::opacity",
              scope: "Presentation/Dashboard/Animated",
            },
          ],
        },
      ],
    });
    expect(manifest["@feature/dashboard/component/Static"]).toBeUndefined();
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it("keeps unresolved temporal use conservative instead of guessing static", () => {
    const source = systemIR();
    const manifest = collectPresentationDependencies(
      mapPresentations(source, (presentation) => ({
        ...presentation,
        declarations: [],
      })),
      "browser",
    );

    expect(Object.keys(manifest)).toEqual([
      "@feature/dashboard/component/Animated",
      "@feature/dashboard/component/Static",
    ]);
    expect(manifest["@feature/dashboard/component/Static"]?.[0]?.destination).toBe("*");
  });
});

describe("web client runtime classification", () => {
  it("omits JavaScript only for an Interface proven inert", () => {
    const animated = systemIR();
    expect(webInterfaceRequiresClientRuntime(animated, "interface/product.web")).toBe(true);

    const inert = mapPresentations(animated, (presentation) => ({
      ...presentation,
      animations: [],
      declarations: [],
    }));
    expect(webInterfaceRequiresClientRuntime(inert, "interface/product.web")).toBe(false);

    expect(
      webInterfaceRequiresClientRuntime(
        {
          ...inert,
          programs: inert.programs.map((program) => ({
            ...program,
            contributions: program.contributions.map((contribution) => ({
              ...contribution,
              extensions: {
                ...contribution.extensions,
                web: {
                  ...webProgramCompilerIR(contribution.extensions?.web),
                  ui: {
                    ...webProgramCompilerIR(contribution.extensions?.web).ui!,
                    actions: ["open"],
                  },
                },
              },
            })),
          })),
        },
        "interface/product.web",
      ),
    ).toBe(true);
  });

  it(
    "classifies the exact Route branch instead of every action in its Feature",
    { tags: ["package"] },
    () => {
      const workspace = resolve(import.meta.dirname, "fixtures/request-render");
      const ir = compileSystem(resolveSystem(workspace).system, [
        serverCompilerExtension,
        webCompilerExtension,
      ]);
      const interfaceId = "interface/product.web";
      const program = ir.programs.find(
        ({ interface: owner, environment }) =>
          owner === "product.web" && environment.name === "browser-main",
      )?.name;
      expect(program).toBeTruthy();
      const routes = collectWebRoutes(ir, program!);
      const root = routes.find(({ feature, name }) => feature === "greeting" && name === "root");
      const greeting = routes.find(
        ({ feature, name }) => feature === "greeting" && name === "greeting",
      );
      expect(root).toBeTruthy();
      expect(greeting).toBeTruthy();
      expect(webRouteRequiresClientRuntime(ir, interfaceId, root!)).toBe(false);
      expect(webRouteRequiresClientRuntime(ir, interfaceId, greeting!)).toBe(true);
    },
  );
});

describe("web client build manifest", () => {
  it("collects every transitive preload once and preserves named entries", () => {
    expect(
      inspectClientManifest({
        "src/system.ts": {
          assets: ["assets/shell-icon-a1b2c3d4.svg"],
          css: ["assets/app-a1b2c3d4.css"],
          dynamicImports: ["src/route.ts"],
          file: "assets/app-content.js",
          imports: ["_shared.js", "_vendor.js"],
          isEntry: true,
          name: "app",
        },
        "src/worker.ts": {
          file: "workers/01-indexer-content.js",
          imports: ["_shared.js"],
          isEntry: true,
          name: "01-indexer",
        },
        "src/route.ts": {
          file: "assets/route-content.js",
          imports: ["_shared.js"],
          isDynamicEntry: true,
          name: "route-tasks",
        },
        "_shared.js": {
          file: "assets/shared-content.js",
          imports: ["_vendor.js"],
        },
        "_vendor.js": { file: "assets/vendor-content.js" },
      }),
    ).toEqual({
      entry: "/assets/app-content.js",
      preloads: ["/assets/vendor-content.js", "/assets/shared-content.js"],
      entries: {
        app: "/assets/app-content.js",
        "01-indexer": "/workers/01-indexer-content.js",
      },
      chunks: {
        app: ["/assets/app-content.js", "/assets/vendor-content.js", "/assets/shared-content.js"],
        "01-indexer": [
          "/workers/01-indexer-content.js",
          "/assets/vendor-content.js",
          "/assets/shared-content.js",
        ],
        "route-tasks": [
          "/assets/route-content.js",
          "/assets/vendor-content.js",
          "/assets/shared-content.js",
        ],
      },
      resources: [
        "/assets/app-a1b2c3d4.css",
        "/assets/app-content.js",
        "/assets/route-content.js",
        "/assets/shared-content.js",
        "/assets/shell-icon-a1b2c3d4.svg",
        "/assets/vendor-content.js",
        "/workers/01-indexer-content.js",
      ],
    });
  });

  it("rejects incomplete manifests instead of emitting broken preload links", () => {
    expect(() =>
      inspectClientManifest({
        "src/system.ts": {
          file: "assets/app-content.js",
          imports: ["_missing.js"],
          isEntry: true,
          name: "app",
        },
      }),
    ).toThrow("missing chunk");
  });

  it("retains generated worker and WASM resources omitted from Vite's manifest graph", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-web-client-resources-"));
    try {
      await mkdir(resolve(directory, "assets"), { recursive: true });
      await writeFile(
        resolve(directory, "assets/app-content.js"),
        'new Worker(new URL("/assets/query-worker-content.js", import.meta.url));',
      );
      await writeFile(
        resolve(directory, "assets/query-worker-content.js"),
        'fetch("/assets/database-content.wasm");',
      );
      await writeFile(resolve(directory, "assets/database-content.wasm"), "wasm");
      await writeFile(resolve(directory, "assets/discarded-content.js"), "discarded");

      await expect(
        collectReferencedClientResources(
          directory,
          new Set(["/assets/app-content.js"]),
        ),
      ).resolves.toEqual([
        "/assets/app-content.js",
        "/assets/database-content.wasm",
        "/assets/query-worker-content.js",
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("development web streaming", () => {
  it("does not pull another frame while the response is backpressured", async () => {
    let pulls = 0;
    const response = new TestResponse((write) => write > 1);
    const writing = writeDevelopmentWebStream(
      response as unknown as ServerResponse,
      "shell",
      Object.freeze({
        async *[Symbol.asyncIterator]() {
          pulls += 1;
          yield "frame";
        },
      }),
      "tail",
      new AbortController().signal,
    );
    await Promise.resolve();
    expect(response.chunks).toEqual(["shell"]);
    expect(pulls).toBe(0);
    response.emit("drain");
    await writing;
    expect(response.chunks).toEqual(["shell", "frame", "tail"]);
    expect(response.writableEnded).toBe(true);
  });

  it("closes the frame iterator when the request is canceled", async () => {
    let release!: () => void;
    let closed = false;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const response = new TestResponse(() => true);
    const controller = new AbortController();
    const writing = writeDevelopmentWebStream(
      response as unknown as ServerResponse,
      "shell",
      Object.freeze({
        async *[Symbol.asyncIterator]() {
          try {
            await blocked;
            yield "late";
          } finally {
            closed = true;
          }
        },
      }),
      "tail",
      controller.signal,
    );
    await Promise.resolve();
    const reason = new Error("disconnected");
    controller.abort(reason);
    await expect(writing).rejects.toBe(reason);
    release();
    await expect.poll(() => closed).toBe(true);
    expect(response.chunks).toEqual(["shell"]);
  });
});

class TestResponse extends EventEmitter {
  readonly chunks: string[] = [];
  destroyed = false;
  writableEnded = false;
  #writes = 0;

  constructor(private readonly accepts: (write: number) => boolean) {
    super();
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    this.#writes += 1;
    return this.accepts(this.#writes);
  }

  end(): void {
    this.writableEnded = true;
  }
}

describe("web asset manifest", () => {
  it("resolves local Presentation assets identically for document and client builds", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-web-presentation-assets-"));
    const source = resolve(directory, "src");
    const files = new Map<string, Buffer>();
    try {
      await mkdir(resolve(source, "assets"), { recursive: true });
      const icon = Buffer.from(
        "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0h1v1z'/></svg>",
      );
      const audio = Buffer.alloc(5_000, 7);
      await writeFile(resolve(source, "assets/icon.svg"), icon);
      await writeFile(resolve(source, "assets/control.wav"), audio);
      const plugin = productionPresentationAssetPlugin(source, { files });
      const hook = plugin.transform;
      const handler = (typeof hook === "function" ? hook : hook?.handler) as unknown as (
        code: string,
        id: string,
      ) => Promise<string | Readonly<{ code: string }> | null | undefined>;
      const result = await handler(
        `import { createImageAsset as image } from "kit/web";
import * as web from "kit/web";
export const icon = image(new URL("./assets/icon.svg", import.meta.url));
export const audio = web.createAudioAsset(new URL("./assets/control.wav", import.meta.url));
`,
        resolve(source, "presentation.ts"),
      );
      const code = typeof result === "string" ? result : result?.code;
      const hash = createHash("sha256").update(audio).digest("hex").slice(0, 12);
      const audioPath = `/assets/control-${hash}.wav`;

      expect(code).toContain(`data:image/svg+xml;base64,${icon.toString("base64")}`);
      expect(code).toContain(JSON.stringify(audioPath));
      expect(code).not.toContain("new URL");
      expect([...files]).toEqual([[audioPath, audio]]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("seals public files by content while keeping only proven hashed outputs immutable", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-web-assets-"));
    try {
      await mkdir(resolve(directory, "assets"));
      await mkdir(resolve(directory, "workers"));
      await writeFile(resolve(directory, "assets/app-abcdefgh.js"), "application");
      await writeFile(resolve(directory, "workers/sync-abcdefgh.js"), "worker");
      await writeFile(resolve(directory, "favicon.svg"), "icon");
      await writeFile(resolve(directory, "document.ir.json"), "private");
      await writeFile(resolve(directory, "routes.ir.json"), "private");
      await writeFile(resolve(directory, "index.html"), "private");

      const manifest = await createWebAssetManifest(directory);

      expect(manifest).toEqual({
        version: 2,
        crossOriginIsolated: false,
        assets: [
          {
            path: "/assets/app-abcdefgh.js",
            etag: etag("application"),
            size: 11,
            immutable: true,
          },
          { path: "/favicon.svg", etag: etag("icon"), size: 4, immutable: false },
          {
            path: "/workers/sync-abcdefgh.js",
            etag: etag("worker"),
            size: 6,
            immutable: true,
          },
        ],
      });
      expect((await createWebAssetManifest(directory, true)).crossOriginIsolated).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it(
    "emits byte-identical web artifacts from identical product meaning",
    { tags: ["production"], timeout: 120_000 },
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "kit-web-determinism-"));
      try {
        const workspace = resolve(import.meta.dirname, "fixtures/request-render");
        const ir = compileSystem(resolve(workspace, "src/system.ts"), [
          serverCompilerExtension,
          webCompilerExtension,
        ]);
        const interfaceId = ir.interfaces.find(({ id }) => id === "interface/product.web")?.id;
        if (!interfaceId)
          throw new Error("The request-render fixture has no product web interface.");
        const first = await buildWebInterface({
          directory: workspace,
          outdir: resolve(directory, "first"),
          interface: interfaceId,
          ir,
        });
        const second = await buildWebInterface({
          directory: workspace,
          outdir: resolve(directory, "second"),
          interface: interfaceId,
          ir,
        });
        const firstFiles = await snapshotFiles(first.directory);
        expect(await snapshotFiles(second.directory)).toEqual(firstFiles);
        expect(firstFiles["files/new/index.html"]).toBeDefined();
        const textualArtifacts = Object.entries(firstFiles)
          .filter(([name]) => /\.(?:html|js|json)$/.test(name))
          .map(([, value]) => Buffer.from(value, "base64").toString("utf8"));
        expect(textualArtifacts.every((artifact) => !artifact.includes("file://"))).toBe(true);
        expect(
          textualArtifacts.some((artifact) => artifact.includes("data:image/svg+xml;base64,")),
        ).toBe(true);
        const javascript = Object.entries(firstFiles)
          .filter(([name]) => name.endsWith(".js"))
          .map(([name, value]) => [name, Buffer.from(value, "base64").toString("utf8")] as const);
        const applicationEntry = javascript.find(([name]) => /assets\/app-[^/]+\.js$/.test(name));
        expect(applicationEntry?.[1]).not.toContain("Rendered in the browser");
        expect(
          javascript
            .filter(([, source]) => source.includes("Rendered in the browser"))
            .map(([name]) => name),
        ).toEqual([expect.stringContaining("route-greeting-client-")]);
        expect(
          javascript.every(([, source]) => !source.includes("sensitive fixture failure")),
        ).toBe(true);

        const variant = resolve(directory, "variant");
        await mkdir(resolve(variant, "src"), { recursive: true });
        const marker = "Rendered in the browser";
        const payload = `${marker}:${"x".repeat(160_000)}`;
        const authored = await readFile(resolve(workspace, "src/product.tsx"), "utf8");
        expect(authored).toContain(marker);
        await writeFile(resolve(variant, "src/product.tsx"), authored.replace(marker, payload));
        await writeFile(
          resolve(variant, "src/system.ts"),
          await readFile(resolve(workspace, "src/system.ts"), "utf8"),
        );
        await writeFile(
          resolve(variant, "tsconfig.json"),
          `${JSON.stringify({
            extends: resolve(import.meta.dirname, "../../../..", "tsconfig.json"),
            compilerOptions: {
              paths: {
                "@/*": ["${configDir}/src/*"],
                kit: [resolve(import.meta.dirname, "../../../..", "dist/source/index.ts")],
                "kit/jsx-runtime": [
                  resolve(import.meta.dirname, "../../../..", "dist/source/jsx/runtime.ts"),
                ],
                "kit/jsx-dev-runtime": [
                  resolve(import.meta.dirname, "../../../..", "dist/source/jsx/development.ts"),
                ],
                "kit/server": [
                  resolve(
                    import.meta.dirname,
                    "../../../..",
                    "dist/source/platforms/server/index.ts",
                  ),
                ],
                "kit/web": [
                  resolve(import.meta.dirname, "../../../..", "dist/source/platforms/web/index.ts"),
                ],
              },
              typeRoots: [resolve(import.meta.dirname, "../../../../node_modules/@types")],
              types: ["node"],
            },
            include: ["src/**/*.ts", "src/**/*.tsx"],
          })}\n`,
        );
        const variantIR = compileSystem(resolve(variant, "src/system.ts"), [
          serverCompilerExtension,
          webCompilerExtension,
        ]);
        const variantInterfaceId = variantIR.interfaces.find(
          ({ id }) => id === "interface/product.web",
        )?.id;
        if (!variantInterfaceId) {
          throw new Error("The request-render variant has no product web interface.");
        }
        const variantBuild = await buildWebInterface({
          directory: variant,
          outdir: resolve(directory, "variant-output"),
          interface: variantInterfaceId,
          ir: variantIR,
        });
        const variantFiles = await snapshotFiles(variantBuild.directory);
        const variantJavascript = Object.entries(variantFiles)
          .filter(([name]) => name.endsWith(".js"))
          .map(([name, value]) => [name, Buffer.from(value, "base64").toString("utf8")] as const);
        const baselineClient = javascript.find(([name]) => name.includes("route-greeting-client-"));
        const variantClient = variantJavascript.find(([name]) =>
          name.includes("route-greeting-client-"),
        );
        expect(baselineClient?.[0]).toContain("route-greeting-client-");
        expect(variantClient?.[0]).toContain("route-greeting-client-");
        const baselineClientBytes = await initialRouteClosureBytes(
          first.directory,
          "greeting.client",
        );
        const variantClientBytes = await initialRouteClosureBytes(
          variantBuild.directory,
          "greeting.client",
        );
        expect(variantClientBytes).toBeGreaterThan(baselineClientBytes + 150_000);
        const baselineInitialBytes = await initialRouteClosureBytes(
          first.directory,
          "greeting.greeting",
        );
        const variantInitialBytes = await initialRouteClosureBytes(
          variantBuild.directory,
          "greeting.greeting",
        );
        expect(Math.abs(variantInitialBytes - baselineInitialBytes)).toBeLessThan(1_024);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});

describe("production web Route realization", () => {
  it("accepts request-independent server documents", () => {
    expect(() =>
      validateProductionWebRoute(route(), { hasLoader: false, request: false }),
    ).not.toThrow();
  });

  it("accepts a server loader only with explicit request render meaning", () => {
    expect(() =>
      validateProductionWebRoute(route(), {
        hasLoader: true,
        request: {
          branch: [{ route: route(), loader: true, view: { kind: "none" } }],
        },
      }),
    ).not.toThrow();
  });

  it("accepts parameterized server documents with explicit request render meaning", () => {
    expect(() =>
      validateProductionWebRoute(
        route({
          params: [
            {
              name: "id",
              kind: "string",
              optional: false,
              format: "uuid",
            },
          ],
        }),
        {
          hasLoader: false,
          request: {
            branch: [{ route: route(), loader: false, view: { kind: "none" } }],
          },
        },
      ),
    ).not.toThrow();
  });

  it("accepts public loaders after request authority is removed by the Route contract", () => {
    expect(() =>
      validateProductionWebRoute(route({ cache: { scope: "public", maxAge: "5m" } }), {
        hasLoader: true,
        request: {
          branch: [
            {
              route: route({ cache: { scope: "public", maxAge: "5m" } }),
              loader: true,
              view: { kind: "none" },
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("leaves request-dependent client documents valid", () => {
    expect(() =>
      validateProductionWebRoute(
        route({
          document: "shell",
          search: [
            {
              name: "query",
              kind: "string",
              optional: true,
            },
          ],
        }),
        { hasLoader: true, request: false },
      ),
    ).not.toThrow();
  });
});

describe("web Route delivery planning", () => {
  it("precomputes an inert public content Route and exposes every safe representation", () => {
    expect(
      planWebRouteDelivery({
        route: route({ cache: { scope: "public", maxAge: "1h" } }),
        document: deliveryDocument(),
        request: false,
      }),
    ).toEqual({
      production: "precomputed",
      reasons: ["document:request-invariant", "client:proven-inert", "cache:public"],
      stream: false,
      representations: ["document", "markdown"],
      client: { runtime: false, hydration: false },
      worker: { cacheDocument: true },
      discovery: { index: true, sitemap: true },
    });
  });

  it("keeps request-dependent private Routes out of Markdown and document caches", () => {
    const privateRoute = route({
      params: [{ name: "id", kind: "string", optional: false }],
      deferred: ["details"],
    });
    expect(
      planWebRouteDelivery({
        route: privateRoute,
        document: deliveryDocument({
          entry: "/assets/app.js",
          hydration: {
            version: 1,
            route: { feature: "tasks", name: "list" },
            location: "/tasks/42",
            params: { id: "42" },
            search: {},
            loader: false,
            metadata: {},
          },
        }),
        request: {
          branch: [{ route: privateRoute, loader: true, view: { kind: "none" } }],
        },
      }),
    ).toEqual({
      production: "request",
      reasons: [
        "document:request-dependent",
        "request:path-parameters",
        "request:loader",
        "response:deferred-stream",
        "client:runtime",
        "cache:no-store",
      ],
      stream: true,
      representations: ["document", "route-data"],
      client: { runtime: true, hydration: true },
      worker: { cacheDocument: false },
      discovery: { index: false, sitemap: false },
    });
  });

  it("identifies a client shell without treating it as server content", () => {
    expect(
      planWebRouteDelivery({
        route: route({ document: "shell" }),
        document: deliveryDocument({ entry: "/assets/app.js" }),
        request: false,
      }),
    ).toEqual({
      production: "client",
      reasons: ["document:client-shell", "client:runtime", "cache:no-store"],
      stream: false,
      representations: ["document"],
      client: { runtime: true, hydration: false },
      worker: { cacheDocument: true },
      discovery: { index: false, sitemap: false },
    });
  });

  it("renders deterministic same-origin discovery resources", () => {
    const resources = renderWebDiscoveryResources("https://example.test:443/base", [
      {
        route: route({
          path: "/tasks",
          metadata: { canonical: "/work?kind=open&owner=me" },
        }),
        discovery: { index: true, sitemap: true },
      },
      {
        route: route({
          name: "duplicate",
          path: "/duplicate",
          metadata: { canonical: "/work?kind=open&owner=me" },
        }),
        discovery: { index: true, sitemap: true },
      },
      {
        route: route({
          name: "external",
          path: "/external",
          metadata: { canonical: "https://elsewhere.test/page" },
        }),
        discovery: { index: true, sitemap: true },
      },
      {
        route: route({ name: "private", path: "/private" }),
        discovery: { index: false, sitemap: false },
      },
    ]);

    expect(resources.robots).toBe(
      "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n",
    );
    expect(resources.sitemap).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        "<url><loc>https://example.test/work?kind=open&amp;owner=me</loc></url>" +
        "</urlset>\n",
    );
  });
});

function route(overrides: Partial<WebRouteIR> = {}): WebRouteIR {
  return {
    feature: "tasks",
    name: "list",
    path: "/tasks",
    document: "content",
    cache: false,
    metadata: {},
    params: [],
    search: [],
    deferred: [],
    ...overrides,
    status: overrides.status ?? 200,
  };
}

function deliveryDocument(overrides: Partial<WebDocumentIR> = {}): WebDocumentIR {
  return {
    version: 6,
    rendering: "static",
    language: "en",
    title: "Tasks",
    metadata: {},
    entry: false,
    preloads: [],
    scripts: [],
    root: [],
    styles: [],
    hydration: false,
    ...overrides,
  };
}

function etag(value: string): string {
  return `"${createHash("sha256").update(value).digest("hex")}"`;
}

async function snapshotFiles(directory: string): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  const visit = async (current: string, prefix = ""): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path, name);
      else if (entry.isFile()) files[name] = (await readFile(path)).toString("base64");
    }
  };
  await visit(directory);
  return files;
}

async function initialRouteClosureBytes(directory: string, identity: string): Promise<number> {
  const artifact = JSON.parse(await readFile(resolve(directory, "routes.ir.json"), "utf8")) as {
    routes: Array<{
      route: { feature: string; name: string };
      document: { entry: false | string; preloads: string[] };
    }>;
  };
  const entry = artifact.routes.find(({ route }) => `${route.feature}.${route.name}` === identity);
  if (!entry) throw new Error(`Missing Route artifact ${JSON.stringify(identity)}.`);
  const files = new Set([
    ...(entry.document.entry === false ? [] : [entry.document.entry]),
    ...entry.document.preloads,
  ]);
  const sizes = await Promise.all(
    [...files].map(async (file) => (await stat(resolve(directory, file.replace(/^\//, "")))).size),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function systemIR(): SystemIR {
  const span = { file: "src/presentation.ts", line: 1, column: 1 } as const;
  return {
    version: SYSTEM_IR_VERSION,
    system: { id: "system", name: "test" },
    platforms: ["web"],
    apps: [{ id: "app/product", path: "product", interfaces: ["interface/product.web"] }],
    interfaces: [
      {
        id: "interface/product.web",
        path: "product.web",
        app: "product",
        platform: "web",
        features: { dashboard: "dashboard" },
        programs: ["program/browser"],
        extensions: {
          web: {
            version: WEB_COMPILER_IR_VERSION,
            presentations: [
              {
                file: "src/presentation.ts",
                animations: [
                  {
                    id: "Presentation/Dashboard/Animated::opacity",
                    scope: "Presentation/Dashboard/Animated",
                    binding: "opacity",
                    source: "state.visible ? 1 : 0",
                    animation: "spring()",
                    events: [],
                    span,
                  },
                ],
                declarations: [
                  {
                    destination: "Dashboard/Animated/Root/paint/opacity",
                    expression: "opacity",
                    animations: ["Presentation/Dashboard/Animated::opacity"],
                    span,
                  },
                ],
              },
            ],
          },
        },
      },
    ],
    features: [
      {
        id: "feature/dashboard",
        path: "dashboard",
        children: [],
        programs: ["program/browser"],
      },
    ],
    programs: [
      {
        id: "program/browser",
        name: "browser",
        logicalName: "browser",
        interface: "product.web",
        environment: { name: "browser-main", platform: "web" },
        contributions: [
          {
            id: "feature/dashboard/program/browser",
            feature: "dashboard",
            requires: [],
            provides: [],
            extensions: {
              web: {
                version: WEB_COMPILER_IR_VERSION,
                ui: {
                  state: { kind: "record", fields: [] },
                  actions: [],
                  components: [
                    {
                      name: "Animated",
                      propCallbacks: [],
                      state: { kind: "record", fields: [] },
                      actions: [],
                      elements: [{ name: "Root", element: "div" }],
                      implementation: {
                        state: false,
                        actions: false,
                        mount: false,
                        view: true,
                      },
                    },
                    {
                      name: "Static",
                      propCallbacks: [],
                      state: { kind: "record", fields: [] },
                      actions: [],
                      elements: [{ name: "Root", element: "div" }],
                      implementation: {
                        state: false,
                        actions: false,
                        mount: false,
                        view: true,
                      },
                    },
                  ],
                  root: "Animated",
                },
                components: [],
                routes: [],
              },
            },
            span,
          },
        ],
      },
    ],
  };
}

function mapPresentations(
  ir: SystemIR,
  map: (presentation: PresentationSourceIR) => PresentationSourceIR,
): SystemIR {
  return {
    ...ir,
    interfaces: ir.interfaces.map((interface_) => {
      if (!interface_.extensions?.web) return interface_;
      const web = webInterfaceCompilerIR(interface_.extensions.web);
      return {
        ...interface_,
        extensions: {
          ...interface_.extensions,
          web: {
            ...web,
            presentations: (web.presentations ?? []).map(map),
          },
        },
      };
    }),
  };
}
