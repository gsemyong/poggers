import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { webCompilerExtension } from "@/adapters/web/compiler";
import {
  buildWebInterface,
  collectPresentationDependencies,
  createWebAssetManifest,
  inspectClientManifest,
  negotiateWebRepresentation,
  validateProductionWebRoute,
  webDevelopmentWorkspace,
  writeDevelopmentWebStream,
} from "@/adapters/web/pipeline";
import type { WebRouteIR } from "@/adapters/web/routing";
import { SYSTEM_IR_VERSION, type SystemIR } from "@/compiler/ir";
import { compileSystem } from "@/compiler/source";

describe("web representation negotiation", () => {
  it("keeps HTML canonical and selects alternates only when named", () => {
    expect(negotiateWebRepresentation(undefined)).toBeUndefined();
    expect(negotiateWebRepresentation("*/*")).toBeUndefined();
    expect(negotiateWebRepresentation("text/html, text/markdown;q=0")).toBe("document");
    expect(negotiateWebRepresentation("text/markdown, text/html;q=0.8")).toBe("markdown");
    expect(negotiateWebRepresentation("application/vnd.poggers.route+json")).toBe("route-data");
    expect(negotiateWebRepresentation("application/json")).toBeUndefined();
  });
});

describe("web development workspace", () => {
  it("keeps a stable isolated cache for each interface", () => {
    const first = webDevelopmentWorkspace("/tmp/company", "interface/operations.web");
    expect(webDevelopmentWorkspace("/tmp/company", "interface/operations.web")).toBe(first);
    expect(webDevelopmentWorkspace("/tmp/company", "interface/customer.web")).not.toBe(first);
    expect(first).toContain("/node_modules/.cache/kit/web/interface-operations-web-");
  });
});

describe("web Presentation dependency manifest", () => {
  it("preserves exact destinations and classifies independent Components", () => {
    const manifest = collectPresentationDependencies(applicationIR(), "browser");

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
    const source = applicationIR();
    const manifest = collectPresentationDependencies(
      {
        ...source,
        presentations: [
          {
            ...source.presentations[0]!,
            declarations: [],
          },
        ],
      },
      "browser",
    );

    expect(Object.keys(manifest)).toEqual([
      "@feature/dashboard/component/Animated",
      "@feature/dashboard/component/Static",
    ]);
    expect(manifest["@feature/dashboard/component/Static"]?.[0]?.destination).toBe("*");
  });
});

describe("web client build manifest", () => {
  it("collects every transitive preload once and preserves named entries", () => {
    expect(
      inspectClientManifest({
        "src/system.ts": {
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
  it("seals public files by content while keeping only proven hashed outputs immutable", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-web-assets-"));
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
        version: 1,
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
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("emits byte-identical web artifacts from identical product meaning", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-web-determinism-"));
    try {
      const application = resolve(import.meta.dirname, "fixtures/request-render");
      const ir = compileSystem(resolve(application, "src/system.ts"), [webCompilerExtension]);
      const interfaceId = ir.interfaces.find(({ id }) => id === "interface/product.web")?.id;
      if (!interfaceId) throw new Error("The request-render fixture has no product web interface.");
      const first = await buildWebInterface({
        directory: application,
        outdir: resolve(directory, "first"),
        interface: interfaceId,
        ir,
      });
      const second = await buildWebInterface({
        directory: application,
        outdir: resolve(directory, "second"),
        interface: interfaceId,
        ir,
      });
      const firstFiles = await snapshotFiles(first.directory);
      expect(await snapshotFiles(second.directory)).toEqual(firstFiles);
      const javascript = Object.entries(firstFiles)
        .filter(([name]) => name.endsWith(".js"))
        .map(([name, value]) => [name, Buffer.from(value, "base64").toString("utf8")] as const);
      const applicationEntry = javascript.find(([name]) => /assets\/app-[^/]+\.js$/.test(name));
      expect(applicationEntry?.[1]).not.toContain("Rendered in the browser");
      expect(
        javascript
          .filter(([, source]) => source.includes("Rendered in the browser"))
          .map(([name]) => name),
      ).toEqual([expect.stringContaining("route-product-web-greeting-client-")]);
      expect(javascript.every(([, source]) => !source.includes("sensitive fixture failure"))).toBe(
        true,
      );

      const variant = resolve(directory, "variant");
      await mkdir(resolve(variant, "src"), { recursive: true });
      const marker = "Rendered in the browser";
      const payload = `${marker}:${"x".repeat(160_000)}`;
      const authored = await readFile(resolve(application, "src/product.tsx"), "utf8");
      expect(authored).toContain(marker);
      await writeFile(resolve(variant, "src/product.tsx"), authored.replace(marker, payload));
      await writeFile(
        resolve(variant, "src/system.ts"),
        await readFile(resolve(application, "src/system.ts"), "utf8"),
      );
      await writeFile(
        resolve(variant, "tsconfig.json"),
        `${JSON.stringify({
          extends: resolve(import.meta.dirname, "../../..", "tsconfig.json"),
          compilerOptions: {
            paths: {
              "@/*": ["./src/*"],
              "@poggers/kit": [resolve(import.meta.dirname, "../../..", "dist/source/index.ts")],
              "@poggers/kit/jsx-runtime": [
                resolve(import.meta.dirname, "../../..", "dist/source/jsx/runtime.ts"),
              ],
              "@poggers/kit/server": [
                resolve(
                  import.meta.dirname,
                  "../../..",
                  "dist/source/platforms/server/platform.ts",
                ),
              ],
              "@poggers/kit/web": [
                resolve(import.meta.dirname, "../../..", "dist/source/platforms/web/platform.ts"),
              ],
            },
            typeRoots: [resolve(import.meta.dirname, "../../../node_modules/@types")],
            types: ["node"],
          },
          include: ["src/**/*.ts", "src/**/*.tsx"],
        })}\n`,
      );
      const variantIR = compileSystem(resolve(variant, "src/system.ts"), [webCompilerExtension]);
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
      const baselineClient = javascript.find(([name]) =>
        name.includes("route-product-web-greeting-client-"),
      );
      const variantClient = variantJavascript.find(([name]) =>
        name.includes("route-product-web-greeting-client-"),
      );
      expect(baselineClient?.[0]).toContain("route-product-web-greeting-client-");
      expect(variantClient?.[0]).toContain("route-product-web-greeting-client-");
      const baselineClientBytes = await initialRouteClosureBytes(
        first.directory,
        "product.web.greeting.client",
      );
      const variantClientBytes = await initialRouteClosureBytes(
        variantBuild.directory,
        "product.web.greeting.client",
      );
      expect(variantClientBytes).toBeGreaterThan(baselineClientBytes + 150_000);
      const baselineInitialBytes = await initialRouteClosureBytes(
        first.directory,
        "product.web.greeting.greeting",
      );
      const variantInitialBytes = await initialRouteClosureBytes(
        variantBuild.directory,
        "product.web.greeting.greeting",
      );
      expect(Math.abs(variantInitialBytes - baselineInitialBytes)).toBeLessThan(1_024);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);
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
        request: { loader: true, view: { kind: "none" } },
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
        { hasLoader: false, request: { loader: false, view: { kind: "none" } } },
      ),
    ).not.toThrow();
  });

  it("accepts public loaders after request authority is removed by the Route contract", () => {
    expect(() =>
      validateProductionWebRoute(route({ cache: { scope: "public", maxAge: "5m" } }), {
        hasLoader: true,
        request: { loader: true, view: { kind: "none" } },
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
      document: { entry: string; preloads: string[] };
    }>;
  };
  const entry = artifact.routes.find(({ route }) => `${route.feature}.${route.name}` === identity);
  if (!entry) throw new Error(`Missing Route artifact ${JSON.stringify(identity)}.`);
  const files = new Set([entry.document.entry, ...entry.document.preloads]);
  const sizes = await Promise.all(
    [...files].map(async (file) => (await stat(resolve(directory, file.replace(/^\//, "")))).size),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function applicationIR(): SystemIR {
  const span = { file: "src/presentation.ts", line: 1, column: 1 } as const;
  return {
    version: SYSTEM_IR_VERSION,
    system: { id: "system", name: "test" },
    platforms: ["web"],
    apps: [{ id: "app/product", feature: "product", interfaces: ["interface/dashboard"] }],
    interfaces: [
      {
        id: "interface/dashboard",
        feature: "dashboard",
        app: "product",
        platform: "web",
        programs: ["program/browser"],
        presentationSources: ["src/presentation.ts"],
      },
    ],
    features: [
      {
        id: "feature/dashboard",
        path: "dashboard",
        kind: "interface",
        app: "product",
        interface: "dashboard",
        platform: "web",
        children: [],
        programs: ["program/browser"],
      },
    ],
    programs: [
      {
        id: "program/browser",
        name: "browser",
        logicalName: "browser",
        interface: "dashboard",
        environment: { name: "browser-main", platform: "web", ui: "web" },
        ui: { root: { feature: "dashboard", component: "Animated" } },
        contributions: [
          {
            id: "feature/dashboard/program/browser",
            feature: "dashboard",
            requires: [],
            provides: [],
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
                  implementation: { state: false, actions: false, mount: false, view: true },
                },
                {
                  name: "Static",
                  propCallbacks: [],
                  state: { kind: "record", fields: [] },
                  actions: [],
                  elements: [{ name: "Root", element: "div" }],
                  implementation: { state: false, actions: false, mount: false, view: true },
                },
              ],
              root: "Animated",
            },
            implementation: { kind: "source", reason: "platform-ui", span },
            span,
          },
        ],
      },
    ],
    presentations: [
      {
        interface: "dashboard",
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
  };
}
