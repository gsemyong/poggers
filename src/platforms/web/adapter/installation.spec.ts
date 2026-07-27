import { describe, expect, it } from "vitest";

import { SYSTEM_IR_VERSION, type SystemIR } from "@/compiler/ir";
import {
  createWebServiceWorkerPlan,
  planWebInstallation,
  renderWebManifest,
  renderWebServiceWorker,
} from "@/platforms/web/adapter/installation";
import { WEB_COMPILER_IR_VERSION, type WebRouteIR } from "@/platforms/web/adapter/lowering";

const routes: readonly WebRouteIR[] = [
  route("tasks.list", "/tasks", { scope: "public", maxAge: "1h" }),
  route("shell.auth", "/auth", false, "shell"),
];
const interfaceId = "interface/app.web";

describe("web installation planning", () => {
  it("resolves one typed installation declaration into a conventional manifest", () => {
    const plan = planWebInstallation(system(), interfaceId, routes);
    expect(plan).toMatchObject({
      name: "Task Manager",
      shortName: "Tasks",
      description: "Manage tasks",
      start: "/tasks",
      offline: { fallback: "/auth" },
    });
    expect(JSON.parse(renderWebManifest(plan!))).toMatchObject({
      name: "Task Manager",
      short_name: "Tasks",
      description: "Manage tasks",
      id: "/tasks",
      start_url: "/tasks",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#111111",
      background_color: "#ffffff",
      categories: ["productivity"],
      screenshots: [
        {
          src: "/tasks.webp",
          sizes: "1280x720",
          type: "image/webp",
          form_factor: "wide",
          label: "Task list",
        },
      ],
      shortcuts: [{ name: "New task", url: "/tasks" }],
    });
  });

  it("emits one versioned worker without forcing activation", () => {
    const installation = planWebInstallation(system(), interfaceId, routes)!;
    const plan = createWebServiceWorkerPlan({
      installation,
      assets: ["/assets/app-a1b2c3d4.js", "/assets/database-a1b2c3d4.wasm"],
      precache: ["/assets/app-a1b2c3d4.js", "/assets/app-a1b2c3d4.js"],
      warmAssets: ["/assets/database-a1b2c3d4.wasm"],
      routes,
      modules: ["/workers/search-a1b2c3d4.js", "/workers/sync-a1b2c3d4.js"],
    });
    const source = renderWebServiceWorker(plan);

    expect(plan.assets).toEqual(["/assets/app-a1b2c3d4.js", "/assets/database-a1b2c3d4.wasm"]);
    expect(plan.precache).toEqual(["/assets/app-a1b2c3d4.js"]);
    expect(plan.warmAssets).toEqual(["/assets/database-a1b2c3d4.wasm"]);
    expect(plan.documents).toEqual(["/auth", "/tasks"]);
    expect(plan.installDocuments).toEqual(["/auth", "/tasks"]);
    expect(plan.warmDocuments).toEqual([]);
    expect(source.match(/^import /gm)).toHaveLength(2);
    expect(source).toContain('event.data === "kit:activate"');
    expect(source).toContain('event.data === "kit:warm"');
    expect(source).toContain('dispatch(event, "message"');
    expect(source).toContain('dispatch(event, "push"');
    expect(source).toContain('dispatch(event, "synchronize"');
    expect(source).toContain('dispatch(event, "notificationClick"');
    expect(source).toContain("Promise.all(PROGRAMS)");
    expect(source).toContain("navigationPreload?.enable()");
    expect(source).toContain("clients.claim()");
    expect(source).not.toContain('"install", (event) => event.waitUntil(self.skipWaiting())');
    expect(source).toContain("DOCUMENTS.includes(url.pathname)");
    expect(source).toContain("documents.match(FALLBACK, { ignoreVary: true })");
    expect(source).toContain("assets.match(request, { ignoreVary: true })");
    expect(source).toContain("assets.put(request, response.clone())");
    expect(source).toContain('const PRECACHE = ["/assets/app-a1b2c3d4.js"]');
    expect(source).toContain('const WARM_ASSETS = ["/assets/database-a1b2c3d4.wasm"]');
    expect(source).toContain('"/assets/database-a1b2c3d4.wasm"');

    const changed = createWebServiceWorkerPlan({
      installation,
      assets: ["/assets/app-changed.js"],
      precache: ["/assets/app-changed.js"],
      routes,
      modules: ["/workers/search-a1b2c3d4.js", "/workers/sync-a1b2c3d4.js"],
    });
    expect(changed.version).not.toBe(plan.version);
  });

  it("rejects precache paths outside the immutable cache allowlist", () => {
    expect(() =>
      createWebServiceWorkerPlan({
        assets: ["/assets/app.js"],
        precache: ["/assets/unknown.js"],
        routes,
      }),
    ).toThrow(/not cacheable/);
  });

  it("installs only the application entry and warms other public documents afterward", () => {
    const plan = createWebServiceWorkerPlan({
      installation: planWebInstallation(system(), interfaceId, routes)!,
      assets: [],
      routes: [...routes, route("help.index", "/help", { scope: "public", maxAge: "1d" })],
    });

    expect(plan.documents).toEqual(["/auth", "/help", "/tasks"]);
    expect(plan.installDocuments).toEqual(["/auth", "/tasks"]);
    expect(plan.warmDocuments).toEqual(["/help"]);
  });

  it("refuses to persist a private content document as the offline fallback", () => {
    expect(() =>
      createWebServiceWorkerPlan({
        installation: planWebInstallation(system(), interfaceId, routes)!,
        assets: [],
        routes: routes.map((value) =>
          value.name === "auth" ? { ...value, document: "content" as const } : value,
        ),
      }),
    ).toThrow(/offline fallback/);
  });
});

function system(): SystemIR {
  return {
    version: SYSTEM_IR_VERSION,
    system: { id: "system", name: "Tasks" },
    platforms: ["web"],
    apps: [{ id: "app/app", path: "app", name: "Task Manager", interfaces: [interfaceId] }],
    interfaces: [
      {
        id: interfaceId,
        path: "app.web",
        app: "app",
        platform: "web",
        features: {},
        programs: [],
        extensions: {
          web: {
            version: WEB_COMPILER_IR_VERSION,
            installation: {
              shortName: "Tasks",
              description: "Manage tasks",
              start: { to: "tasks.list" },
              display: "standalone",
              orientation: "portrait",
              themeColor: "#111111",
              backgroundColor: "#ffffff",
              categories: ["productivity"],
              icons: [
                { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
              ],
              screenshots: [
                {
                  src: "/tasks.webp",
                  sizes: "1280x720",
                  type: "image/webp",
                  formFactor: "wide",
                  label: "Task list",
                },
              ],
              shortcuts: [{ name: "New task", destination: { to: "tasks.list" }, icons: [] }],
              offline: { fallback: { to: "shell.auth" } },
            },
          },
        },
      },
    ],
    features: [
      {
        id: "feature/app",
        path: "app",
        children: [],
        programs: [],
      },
    ],
    programs: [],
  };
}

function route(
  identity: string,
  path: string,
  cache: WebRouteIR["cache"],
  document: WebRouteIR["document"] = "content",
): WebRouteIR {
  const separator = identity.lastIndexOf(".");
  return {
    feature: identity.slice(0, separator),
    name: identity.slice(separator + 1),
    path,
    status: 200,
    document,
    cache,
    metadata: {},
    params: [],
    search: [],
    deferred: [],
  };
}
