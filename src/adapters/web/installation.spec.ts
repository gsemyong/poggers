import { describe, expect, it } from "vitest";

import {
  createWebServiceWorkerPlan,
  planWebInstallation,
  renderWebManifest,
  renderWebServiceWorker,
} from "@/adapters/web/installation";
import type { WebRouteIR } from "@/adapters/web/routing";
import { SYSTEM_IR_VERSION, type SystemIR } from "@/compiler/ir";

const routes: readonly WebRouteIR[] = [
  route("tasks.list", "/tasks", { scope: "public", maxAge: "1h" }),
  route("shell.auth", "/auth", false, "shell"),
];
const interfaceId = "interface/app.web";

describe("web installation planning", () => {
  it("resolves one typed application declaration into a conventional manifest", () => {
    const plan = planWebInstallation(system(), interfaceId, routes);
    expect(plan).toMatchObject({
      name: "Tasks",
      shortName: "Tasks",
      start: "/tasks",
      offline: { fallback: "/auth" },
    });
    expect(JSON.parse(renderWebManifest(plan!))).toMatchObject({
      name: "Tasks",
      short_name: "Tasks",
      id: "/tasks",
      start_url: "/tasks",
      scope: "/",
      display: "standalone",
      shortcuts: [{ name: "New task", url: "/tasks" }],
    });
  });

  it("emits one versioned worker without forcing activation", () => {
    const installation = planWebInstallation(system(), interfaceId, routes)!;
    const plan = createWebServiceWorkerPlan({
      installation,
      assets: ["/assets/app-a1b2c3d4.js", "/assets/app-a1b2c3d4.js"],
      routes,
      modules: ["/workers/search-a1b2c3d4.js", "/workers/sync-a1b2c3d4.js"],
    });
    const source = renderWebServiceWorker(plan);

    expect(plan.assets).toEqual(["/assets/app-a1b2c3d4.js"]);
    expect(plan.documents).toEqual(["/auth", "/tasks"]);
    expect(source.match(/^import /gm)).toHaveLength(2);
    expect(source).toContain('event.data === "kit:activate"');
    expect(source).toContain("navigationPreload?.enable()");
    expect(source).not.toContain("clients.claim()");
    expect(source).not.toContain('"install", (event) => event.waitUntil(self.skipWaiting())');
    expect(source).toContain("DOCUMENTS.includes(url.pathname)");
    expect(source).toContain("documents.match(FALLBACK, { ignoreVary: true })");
    expect(source).toContain("assets.match(request, { ignoreVary: true })");

    const changed = createWebServiceWorkerPlan({
      installation,
      assets: ["/assets/app-changed.js"],
      routes,
      modules: ["/workers/search-a1b2c3d4.js", "/workers/sync-a1b2c3d4.js"],
    });
    expect(changed.version).not.toBe(plan.version);
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
    apps: [{ id: "app/app", feature: "app", interfaces: [interfaceId] }],
    interfaces: [
      {
        id: interfaceId,
        feature: "app.web",
        app: "app",
        platform: "web",
        programs: [],
        presentationSources: [],
      },
    ],
    features: [
      {
        id: "feature/app.web",
        path: "app.web",
        kind: "interface",
        app: "app",
        interface: "app.web",
        platform: "web",
        children: [],
        programs: [],
        extensions: {
          web: {
            version: 8,
            installation: {
              shortName: "Tasks",
              start: { to: "tasks.list" },
              display: "standalone",
              icons: [
                { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
              ],
              shortcuts: [{ name: "New task", destination: { to: "tasks.list" }, icons: [] }],
              offline: { fallback: { to: "shell.auth" } },
            },
          },
        },
      },
    ],
    programs: [],
    presentations: [],
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
    document,
    cache,
    metadata: {},
    params: [],
    search: [],
    deferred: [],
  };
}
