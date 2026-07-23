import { createHash } from "node:crypto";

import {
  resolveWebDestination,
  webFeatureCompilerIR,
  type WebInstallationIconIR,
  type WebRouteIR,
} from "@/adapters/web/routing";
import type { SystemIR } from "@/compiler/ir";

export const WEB_SERVICE_WORKER_PATH = "/service-worker.js";
export { WEB_MANIFEST_PATH } from "@/platforms/web/routing";

export type WebInstallationPlan = Readonly<{
  name: string;
  shortName?: string;
  start: string;
  display: "browser" | "fullscreen" | "minimal-ui" | "standalone";
  icons: readonly WebInstallationIconIR[];
  shortcuts: readonly Readonly<{
    name: string;
    url: string;
    icons: readonly WebInstallationIconIR[];
  }>[];
  offline: Readonly<{ fallback: string }>;
}>;

/** Resolves typed installation destinations only after the complete Route graph exists. */
export function planWebInstallation(
  system: SystemIR,
  interfaceId: string,
  routes: readonly WebRouteIR[],
): WebInstallationPlan | undefined {
  const interface_ = system.interfaces.find(({ id }) => id === interfaceId);
  if (!interface_) throw new Error(`Unknown web interface ${JSON.stringify(interfaceId)}.`);
  const feature = system.features.find(({ path }) => path === interface_.feature);
  const extension = feature?.extensions?.web;
  if (!extension) return undefined;
  const installation = webFeatureCompilerIR(extension).installation;
  if (!installation) return undefined;
  const start = resolveWebDestination(routes, installation.start);
  const fallback = resolveWebDestination(routes, installation.offline.fallback);
  return Object.freeze({
    name: system.system.name,
    ...(installation.shortName ? { shortName: installation.shortName } : {}),
    start,
    display: installation.display,
    icons: installation.icons,
    shortcuts: Object.freeze(
      installation.shortcuts.map((shortcut) =>
        Object.freeze({
          name: shortcut.name,
          url: resolveWebDestination(routes, shortcut.destination),
          icons: shortcut.icons,
        }),
      ),
    ),
    offline: Object.freeze({ fallback }),
  });
}

export function renderWebManifest(plan: WebInstallationPlan): string {
  return `${JSON.stringify(
    {
      name: plan.name,
      ...(plan.shortName ? { short_name: plan.shortName } : {}),
      id: plan.start,
      start_url: plan.start,
      scope: "/",
      display: plan.display,
      icons: plan.icons.map(manifestIcon),
      shortcuts: plan.shortcuts.map((shortcut) => ({
        name: shortcut.name,
        url: shortcut.url,
        ...(shortcut.icons.length ? { icons: shortcut.icons.map(manifestIcon) } : {}),
      })),
    },
    undefined,
    2,
  )}\n`;
}

function manifestIcon(icon: WebInstallationIconIR): Readonly<Record<string, string>> {
  return Object.freeze({
    src: icon.src,
    sizes: icon.sizes,
    ...(icon.type ? { type: icon.type } : {}),
    ...(icon.purpose?.length ? { purpose: icon.purpose.join(" ") } : {}),
  });
}

export type WebServiceWorkerPlan = Readonly<{
  version: string;
  caching: "always" | "preview";
  assets: readonly string[];
  documents: readonly string[];
  fallback?: string;
  modules: readonly string[];
}>;

export function createWebServiceWorkerPlan(input: {
  installation?: WebInstallationPlan;
  assets: readonly string[];
  routes: readonly WebRouteIR[];
  modules?: readonly string[];
  caching?: "always" | "preview";
}): WebServiceWorkerPlan {
  const assets = uniquePaths(input.assets);
  const cacheable = input.routes.filter(
    (route) =>
      !route.params.length &&
      !route.search.length &&
      (route.document === "shell" || (route.cache !== false && route.cache.scope === "public")),
  );
  const cacheablePaths = new Set(cacheable.map(({ path }) => path));
  if (input.installation && !cacheablePaths.has(input.installation.offline.fallback)) {
    throw new Error(
      "The web installation offline fallback must be a public document or a client shell.",
    );
  }
  const documents = uniquePaths([
    ...(input.installation
      ? [
          ...(cacheablePaths.has(input.installation.start) ? [input.installation.start] : []),
          input.installation.offline.fallback,
        ]
      : []),
    ...cacheable.map(({ path }) => path),
  ]);
  const modules = uniquePaths(input.modules ?? []);
  const caching = input.caching ?? "always";
  const version = createHash("sha256")
    .update(
      JSON.stringify({
        assets,
        documents,
        fallback: input.installation?.offline.fallback,
        modules,
        caching,
      }),
    )
    .digest("hex")
    .slice(0, 20);
  return Object.freeze({
    version,
    caching,
    assets: Object.freeze(assets),
    documents: Object.freeze(documents),
    ...(input.installation ? { fallback: input.installation.offline.fallback } : {}),
    modules: Object.freeze(modules),
  });
}

/** Emits one physical worker for installation plus every logical service-worker Program. */
export function renderWebServiceWorker(plan: WebServiceWorkerPlan): string {
  const imports = plan.modules.map((module) => `import ${JSON.stringify(module)};`).join("\n");
  return `${imports}${imports ? "\n" : ""}const VERSION = ${JSON.stringify(plan.version)};
const CACHE_ENABLED = ${plan.caching === "always" ? "true" : 'new URL(self.location.href).searchParams.get("pwa") === "preview"'};
const PROGRAMS = self.__poggersServiceWorkerPrograms ?? [];
const ASSET_CACHE = "poggers-assets-" + VERSION;
const DOCUMENT_CACHE = "poggers-documents-" + VERSION;
const ASSETS = ${JSON.stringify(plan.assets)};
const DOCUMENTS = ${JSON.stringify(plan.documents)};
const FALLBACK = ${JSON.stringify(plan.fallback ?? null)};

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    Promise.all(PROGRAMS),
    ...(CACHE_ENABLED ? [
      caches.open(ASSET_CACHE).then((cache) => cache.addAll(ASSETS)),
      caches.open(DOCUMENT_CACHE).then((cache) => cache.addAll(DOCUMENTS)),
    ] : []),
  ]));
});

self.addEventListener("activate", (event) => {
  if (!CACHE_ENABLED) return;
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(names
      .filter((name) => name.startsWith("poggers-") && name !== ASSET_CACHE && name !== DOCUMENT_CACHE)
      .map((name) => caches.delete(name)))),
    self.registration.navigationPreload?.enable(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data === "poggers:activate") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  if (!CACHE_ENABLED) return;
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && FALLBACK) {
    event.respondWith((async () => {
      try {
        const response = await event.preloadResponse || await fetch(request);
        if (response?.ok && !url.search && DOCUMENTS.includes(url.pathname)) {
          const cache = await caches.open(DOCUMENT_CACHE);
          event.waitUntil(cache.put(request, response.clone()));
          return response;
        }
        if (response) return response;
      } catch {}
      const documents = await caches.open(DOCUMENT_CACHE);
      return await documents.match(request)
        || await documents.match(FALLBACK, { ignoreVary: true })
        || Response.error();
    })());
    return;
  }
  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const assets = await caches.open(ASSET_CACHE);
    return await assets.match(request, { ignoreVary: true }) || fetch(request);
  })());
});
`;
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
