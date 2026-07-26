import { createHash } from "node:crypto";

import type { SystemIR } from "@/compiler/ir";
import {
  resolveWebDestination,
  webFeatureCompilerIR,
  type WebInstallationIconIR,
  type WebRouteIR,
} from "@/platforms/web/adapter/lowering";

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
  const extension = interface_.extensions?.web;
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
  precache: readonly string[];
  warmAssets: readonly string[];
  documents: readonly string[];
  installDocuments: readonly string[];
  warmDocuments: readonly string[];
  fallback?: string;
  modules: readonly string[];
}>;

export function createWebServiceWorkerPlan(input: {
  installation?: WebInstallationPlan;
  assets: readonly string[];
  precache?: readonly string[];
  warmAssets?: readonly string[];
  routes: readonly WebRouteIR[];
  modules?: readonly string[];
  caching?: "always" | "preview";
}): WebServiceWorkerPlan {
  const assets = uniquePaths(input.assets);
  const precache = uniquePaths(input.precache ?? assets);
  const warmAssets = uniquePaths(input.warmAssets ?? []);
  const available = new Set(assets);
  for (const path of [...precache, ...warmAssets]) {
    if (!available.has(path)) {
      throw new Error(`Planned web asset ${JSON.stringify(path)} is not cacheable.`);
    }
  }
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
  const documents = uniquePaths(cacheable.map(({ path }) => path));
  const installDocuments = uniquePaths(
    input.installation
      ? [
          ...(cacheablePaths.has(input.installation.start) ? [input.installation.start] : []),
          input.installation.offline.fallback,
        ]
      : [],
  );
  const installed = new Set(installDocuments);
  const warmDocuments = documents.filter((path) => !installed.has(path));
  const modules = uniquePaths(input.modules ?? []);
  const caching = input.caching ?? "always";
  const version = createHash("sha256")
    .update(
      JSON.stringify({
        assets,
        precache,
        warmAssets,
        documents,
        installDocuments,
        warmDocuments,
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
    precache: Object.freeze(precache),
    warmAssets: Object.freeze(warmAssets),
    documents: Object.freeze(documents),
    installDocuments: Object.freeze(installDocuments),
    warmDocuments: Object.freeze(warmDocuments),
    ...(input.installation ? { fallback: input.installation.offline.fallback } : {}),
    modules: Object.freeze(modules),
  });
}

/** Emits one physical worker for installation plus every logical service-worker Program. */
export function renderWebServiceWorker(plan: WebServiceWorkerPlan): string {
  const imports = plan.modules.map((module) => `import ${JSON.stringify(module)};`).join("\n");
  return `${imports}${imports ? "\n" : ""}const VERSION = ${JSON.stringify(plan.version)};
const CACHE_ENABLED = ${plan.caching === "always" ? "true" : 'new URL(self.location.href).searchParams.get("pwa") === "preview"'};
const PROGRAMS = self.__kitServiceWorkerPrograms ?? [];
const ASSET_CACHE = "kit-assets-" + VERSION;
const DOCUMENT_CACHE = "kit-documents-" + VERSION;
const ASSETS = ${JSON.stringify(plan.assets)};
const PRECACHE = ${JSON.stringify(plan.precache)};
const WARM_ASSETS = ${JSON.stringify(plan.warmAssets)};
const DOCUMENTS = ${JSON.stringify(plan.documents)};
const INSTALL_DOCUMENTS = ${JSON.stringify(plan.installDocuments)};
const WARM_DOCUMENTS = ${JSON.stringify(plan.warmDocuments)};
const FALLBACK = ${JSON.stringify(plan.fallback ?? null)};

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([
    Promise.all(PROGRAMS),
    ...(CACHE_ENABLED ? [
      caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRECACHE)),
      caches.open(DOCUMENT_CACHE).then((cache) => cache.addAll(INSTALL_DOCUMENTS)),
    ] : []),
  ]));
});

self.addEventListener("activate", (event) => {
  if (!CACHE_ENABLED) return;
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(names
      .filter((name) => name.startsWith("kit-") && name !== ASSET_CACHE && name !== DOCUMENT_CACHE)
      .map((name) => caches.delete(name)))),
    self.registration.navigationPreload?.enable(),
    self.clients.claim(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data === "kit:activate") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data === "kit:warm" && CACHE_ENABLED) {
    event.waitUntil(Promise.all([
      warm(ASSET_CACHE, WARM_ASSETS),
      warm(DOCUMENT_CACHE, WARM_DOCUMENTS),
    ]));
  }
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
    const cached = await assets.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) event.waitUntil(assets.put(request, response.clone()));
    return response;
  })());
});

const warm = async (name, paths) => {
  const cache = await caches.open(name);
  await Promise.allSettled(paths.map(async (path) => {
    if (await cache.match(path, { ignoreVary: true })) return;
    const response = await fetch(path, { credentials: "same-origin" });
    if (response.ok) await cache.put(path, response);
  }));
};
`;
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
