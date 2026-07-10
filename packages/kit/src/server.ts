import type {
  ActorOf,
  App,
  AppSpec,
  CommandReceipt,
  EnvironmentDeps,
  EnvironmentName,
} from "./app";
import type { CommittedEvent, JsonValue, ServerMessage, SessionData, Snapshot } from "./protocol";
import { scopeId, validateClientMessage } from "./protocol";
import { createFileStore, type Store } from "./storage";
import {
  createFSWorkerDurabilityStore,
  startProgramRuntime,
  startWorkerRuntime,
  type AppProgram,
  type WorkerDef,
  type WorkerDurabilityStore,
  type WorkerRuntime,
  type WorkerRuntimeEvent,
} from "./worker";
import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, relative, resolve } from "node:path";

const SNAPSHOT_INTERVAL = 5000;
const DELTA_THRESHOLD = 200;
const PING_INTERVAL_MS = 30000;
const poggersJsx = {
  runtime: "automatic",
  importSource: "@poggers/kit",
} as const;

export type ServeOpts<Spec extends AppSpec = AppSpec> = {
  port?: number;
  storage?: Store;
  routes?: Record<string, any>;
  snapshotIntervalMs?: number;
  web?: WebServeOpts;
  workers?: ServeWorkerOpts<Spec, any>[];
  programs?: ServeProgramOpts<Spec, any>[];
};

export type ServeWorkerOpts<Spec extends AppSpec, Deps = any> = {
  worker: WorkerDef<Spec, Deps>;
  deps: Deps;
  workerId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
};

export type ServeProgramOpts<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  env: Env;
  program: AppProgram<Spec, Env>;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
};

export type ServerHandle = {
  url: URL;
  stop: () => void;
};

export type WebServeOpts = {
  bundle?: string;
  styleBundle?: string;
  entrypoint: string | URL;
  html?: any;
  styles?: string;
  styleFiles?: string[];
  plugins?: Bun.BunPlugin[];
  assetDir?: string;
  title?: string;
  scriptPath?: string;
  stylePath?: string;
  indexHtml?: string;
  development?: Bun.Serve.Development;
  liveReload?: WebLiveReloadOpts;
};

export type WebLiveReloadOpts = {
  watchDir: string;
  onChange?: (changedPath: string) => void | Promise<void>;
};

export function computeSync(
  resource: string,
  key: JsonValue,
  cursor: number,
  storage: Store,
  eventBuffers: Map<string, unknown[]>,
  states: Map<string, any>,
  instanceSeqs: Map<string, number>,
  app: App<any>,
  generation: string,
): { snapshot?: Snapshot; events?: unknown[]; cursor: number } {
  const id = scopeId(resource, key);
  const buf = (eventBuffers.get(id) as CommittedEvent[]) ?? [];
  const currentSeq = instanceSeqs.get(id) ?? 0;
  const minBufSeq = buf[0]?.seq ?? 0;

  const firstAfterCursor = (buf as CommittedEvent[]).find((e) => e.seq > cursor);
  const hasGapAfterCursor = firstAfterCursor !== undefined && firstAfterCursor.seq > cursor + 1;

  const needsSnapshot =
    cursor === 0 ||
    cursor < minBufSeq ||
    (buf.length === 0 && cursor !== currentSeq) ||
    hasGapAfterCursor;

  if (needsSnapshot) {
    if (states.has(id)) {
      const state = states.get(id);
      return {
        snapshot: { ...app.snapshot(state, currentSeq), generation },
        cursor: currentSeq,
      };
    }
    const snap = storage.loadSnapshot(id);
    if (snap) {
      const state = app.restore(resource, snap);
      return {
        snapshot: { ...app.snapshot(state, snap.seq), generation },
        cursor: snap.seq,
      };
    }
    const freshState = app.createState(resource);
    states.set(id, freshState);
    instanceSeqs.set(id, 0);
    return {
      snapshot: { ...app.snapshot(freshState, 0), generation },
      cursor: 0,
    };
  }

  const events = buf.filter((e) => e.seq > cursor);
  if (events.length > 0) {
    return { events, cursor: events[events.length - 1]!.seq };
  }
  return { cursor: currentSeq };
}

export function serve<Spec extends AppSpec>(
  app: App<Spec>,
  opts: ServeOpts<Spec> = {},
): ServerHandle {
  const port = opts.port ?? 3000;
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? SNAPSHOT_INTERVAL;
  const storage = opts.storage ?? createFileStore(".poggers");
  const serverGeneration = crypto.randomUUID();

  const dirtyScopes = new Set<string>();
  const failedSnapshotScopes = new Set<string>();
  const needsCompaction = new Set<string>();
  const compactionSeqs = new Map<string, number>();
  let snapshotCycle: Promise<void> | null = null;
  const eventBuffers = new Map<string, unknown[]>();
  const instanceSeqs = new Map<string, number>();
  const streamWriters = new Map<string, Promise<void>>();
  const wsClients = new Map<any, SessionData<ActorOf<Spec>>>();
  const states = new Map<string, any>();
  const subscribers = new Map<string, Set<any>>();
  const processedCommandIds = new Map<string, Set<string>>();
  const scopePresence = new Map<string, Map<string, any>>();
  const workerRuntimes: WorkerRuntime<Spec>[] = [];
  const web = opts.web;
  const webScriptPath = web?.scriptPath ?? "/client.js";
  const webStylePath = web?.stylePath ?? "/client.css";
  const liveReloadPath = "/__poggers/live";
  const liveReloadPollPath = "/__poggers/live-poll";
  const liveReloadClients = new Set<any>();
  const liveReloadFiles = new Map<string, number>();
  let liveReloadVersion = 0;
  let liveReloadChangedPath = "";
  let liveReloadWatcher: FSWatcher | undefined;
  let liveReloadTimer: ReturnType<typeof setTimeout> | undefined;
  let liveReloadPoll: ReturnType<typeof setInterval> | undefined;
  let liveReloadBuild: Promise<void> | undefined;
  let liveReloadPendingPath: string | undefined;
  let browserAssetsCache:
    | { version: number; assets: { script: string; style?: string } }
    | undefined;
  let browserAssetsBuild:
    | { version: number; promise: Promise<{ script: string; style?: string } | Response> }
    | undefined;

  function getEventBuffer(key: string): unknown[] {
    let buf = eventBuffers.get(key);
    if (!buf) {
      buf = [];
      eventBuffers.set(key, buf);
    }
    return buf;
  }

  function enqueueStreamWrite<T>(id: string, task: () => T | Promise<T>): Promise<T> {
    const previous = streamWriters.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const settled = next.then(
      () => {},
      () => {},
    );
    streamWriters.set(id, settled);
    void settled.finally(() => {
      if (streamWriters.get(id) === settled) {
        streamWriters.delete(id);
      }
    });
    return next;
  }

  function loadScope(id: string, resource: string, key?: JsonValue): any {
    if (states.has(id)) return states.get(id);

    let s: any;
    const snap = storage.loadSnapshot(id);
    if (snap) {
      s = app.restore(resource, snap);
      instanceSeqs.set(id, snap.seq);
    } else {
      s = app.createState(resource);
      instanceSeqs.set(id, 0);
    }
    states.set(id, s);

    const snapshotSeq = snap ? snap.seq : 0;
    const snapshotVersion = snap?.version ?? app.def.version;
    const events = storage.getEvents(id);
    if (!snap && events.length === 0) {
      try {
        storage.clearCommandIds(id);
      } catch {}
    }
    const workerReplayEvents: CommittedEvent[] = [];
    let prevSeq = snapshotSeq;
    for (const ev of events) {
      const e = ev as any;
      const version = e.version ?? snapshotVersion;
      const hash = e.hash ?? snap?.hash;
      if (typeof e.seq === "number") {
        workerReplayEvents.push({ ...e, version, ...(hash ? { hash } : {}) });
      }
      if (e.seq <= prevSeq) continue;
      if (e.seq > prevSeq + 1) break;
      app.applyEvent(
        resource,
        s,
        {
          id: e.id ?? "",
          seq: e.seq ?? 0,
          at: e.at ?? 0,
          actor: e.actor,
          name: e.name,
          payload: e.payload,
        },
        version,
        hash,
      );
      prevSeq = e.seq;
      const cur = instanceSeqs.get(id) ?? 0;
      if (e.seq > cur) instanceSeqs.set(id, e.seq);
      const buf = getEventBuffer(id);
      buf.push(e);
    }

    if (key !== undefined && workerReplayEvents.length > 0) {
      enqueueWorkerEvents(resource, key, workerReplayEvents);
    }

    const storedCids = storage.getCommandIds(id);
    if (storedCids.size > 0) {
      let scopeCommands = processedCommandIds.get(id);
      if (!scopeCommands) {
        scopeCommands = new Set();
        processedCommandIds.set(id, scopeCommands);
      }
      for (const cid of storedCids) {
        scopeCommands.add(cid);
      }
    }
    return s;
  }

  function subscribe(ws: any, resource: string, key: JsonValue) {
    const id = scopeId(resource, key);
    let set = subscribers.get(id);
    if (!set) {
      set = new Set();
      subscribers.set(id, set);
    }
    set.add(ws);
  }

  function evictClient(client: any) {
    wsClients.delete(client);
    for (const [id, set] of subscribers) {
      set.delete(client);
      if (set.size === 0) {
        subscribers.delete(id);
      }
    }
  }

  function safeSend(client: any, data: string) {
    try {
      client.send(data);
    } catch {
      evictClient(client);
    }
  }

  function broadcastToSubscribers(id: string, msg: ServerMessage) {
    const data = JSON.stringify(msg);
    const set = subscribers.get(id);
    if (set) {
      for (const client of set) safeSend(client, data);
    }
  }

  function broadcastExcept(exclude: any, msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const [client] of wsClients) {
      if (client !== exclude) safeSend(client, data);
    }
  }

  function commitBatch(
    events: Array<{
      id: string;
      seq: number;
      at: number;
      actor: ActorOf<Spec>;
      name: string;
      payload: any;
    }>,
    resource: string,
    key: JsonValue,
    commandId?: string,
  ): CommittedEvent[] | null {
    if (events.length === 0) return null;

    const id = scopeId(resource, key);
    const currentState = loadScope(id, resource, key);

    const committed: CommittedEvent[] = [];
    let lastSeq = instanceSeqs.get(id) ?? 0;
    const hash = (app.def as any).migrationHash;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      const seq = lastSeq + 1;
      lastSeq = seq;
      committed.push({
        id: ev.id,
        seq,
        at: ev.at,
        version: app.def.version,
        ...(hash ? { hash } : {}),
        actor: ev.actor,
        name: ev.name,
        payload: ev.payload,
      });
    }

    const nextState = structuredClone(currentState);
    for (const ev of committed) {
      app.applyEvent(
        resource,
        nextState,
        {
          id: ev.id,
          seq: ev.seq,
          at: ev.at,
          actor: ev.actor as ActorOf<Spec>,
          name: ev.name,
          payload: ev.payload,
          hash: ev.hash,
        },
        ev.version,
        ev.hash,
      );
    }

    storage.appendEvents(id, committed, commandId);

    states.set(id, nextState);
    instanceSeqs.set(id, committed[committed.length - 1]!.seq);

    const buf = getEventBuffer(id);
    for (const ev of committed) buf.push(ev);
    dirtyScopes.add(id);

    for (const ev of committed) {
      broadcastToSubscribers(id, {
        type: "event",
        event: ev,
        resource,
        key,
      });
    }

    enqueueWorkerEvents(resource, key, committed);

    return committed;
  }

  function enqueueWorkerEvents(resource: string, key: JsonValue, events: CommittedEvent[]) {
    if (workerRuntimes.length === 0 || events.length === 0) return;

    for (const runtime of workerRuntimes) {
      const runtimeEvents: WorkerRuntimeEvent<Spec>[] = events.map((event) => ({
        resource: resource as Extract<keyof Spec["Resources"], string>,
        key,
        event: {
          id: event.id,
          seq: event.seq,
          at: event.at,
          version: event.version ?? app.def.version,
          actor: event.actor as ActorOf<Spec>,
          name: event.name,
          payload: event.payload,
        },
      }));

      runtime.enqueue(runtimeEvents);
    }
  }

  async function buildBrowserAssets(): Promise<{ script: string; style?: string } | Response> {
    const version = liveReloadVersion;
    if (browserAssetsCache?.version === version) return browserAssetsCache.assets;
    if (browserAssetsBuild) {
      const activeBuild = browserAssetsBuild;
      const result = await activeBuild.promise;
      if (activeBuild.version === version)
        return result instanceof Response ? result.clone() : result;
      return buildBrowserAssets();
    }
    // Publish the in-flight generation before Bun begins compiling so concurrent
    // script and stylesheet requests always share one StyleX build.
    const promise = Promise.resolve().then(() => compileBrowserAssets());
    browserAssetsBuild = { version, promise };
    try {
      const result = await promise;
      if (!(result instanceof Response)) browserAssetsCache = { version, assets: result };
      return result;
    } finally {
      if (browserAssetsBuild?.promise === promise) browserAssetsBuild = undefined;
    }
  }

  async function compileBrowserAssets(): Promise<{ script: string; style?: string } | Response> {
    if (!web) return new Response("not found", { status: 404 });
    if (web.bundle) {
      return { script: web.bundle, style: await appendStyleFiles(web.styleBundle, web.styleFiles) };
    }

    const entrypoint =
      web.entrypoint instanceof URL ? fileURLToPath(web.entrypoint) : web.entrypoint;
    const result = await Bun.build({
      entrypoints: [entrypoint],
      format: "esm",
      jsx: poggersJsx,
      plugins: web.plugins,
      sourcemap: "inline",
      target: "browser",
    });

    if (!result.success) {
      return new Response(result.logs.map(String).join("\n"), {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let script: string | undefined;
    let style: string | undefined;
    for (const output of result.outputs as Array<Blob & { path?: string }>) {
      const path = output.path ?? "";
      if (path.endsWith(".css")) {
        style = `${style ?? ""}${await output.text()}`;
      } else if (path.endsWith(".js") || !script) {
        script = await output.text();
      }
    }

    if (!script) {
      return new Response("browser bundle produced no output", { status: 500 });
    }

    style = await appendStyleFiles(style, web.styleFiles);
    return { script, style };
  }

  async function appendStyleFiles(
    style: string | undefined,
    styleFiles: string[] | undefined,
  ): Promise<string | undefined> {
    let next = style;
    for (const path of styleFiles ?? []) {
      const file = Bun.file(path);
      if (!(await file.exists())) continue;
      const css = await file.text();
      if (!css.trim()) continue;
      next = next ? `${next}\n${css}` : css;
    }
    return next;
  }

  async function buildBrowserBundle(): Promise<Response> {
    const assets = await buildBrowserAssets();
    if (assets instanceof Response) return assets;

    return new Response(assets.script, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
  }

  async function buildBrowserStyle(): Promise<Response> {
    const assets = await buildBrowserAssets();
    if (assets instanceof Response) return assets;
    if (!assets.style) return new Response("", { status: 204 });

    return new Response(assets.style, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/css; charset=utf-8",
      },
    });
  }

  function renderLiveReloadScript(): string {
    if (!web?.liveReload) return "";
    return `<script type="module">
      (() => {
        let version = 0;
        let importing = Promise.resolve();
        const scriptPath = ${JSON.stringify(webScriptPath)};
        const stylePath = ${JSON.stringify(web.styles || web.styleBundle || web.styleFiles?.length ? webStylePath : "")};
        const isCodeChange = (changedPath) =>
          typeof changedPath === "string" &&
          /\\.[cm]?[jt]sx?$/.test(changedPath) &&
          !/(^|\\/)styles\\.tsx?$/.test(changedPath);
        const isStyleChange = (changedPath) =>
          typeof changedPath === "string" &&
          (/\\.css$/.test(changedPath) || /(^|\\/)styles\\.tsx?$/.test(changedPath));
        const refreshStyle = () => {
          if (!stylePath) return Promise.resolve();
          const replacements = [];
          for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
            const href = link.getAttribute("href") || "";
            if (href === stylePath || href.startsWith(stylePath + "?")) {
              replacements.push(new Promise((resolve) => {
                const next = link.cloneNode();
                next.setAttribute("href", stylePath + "?v=" + version);
                next.addEventListener("load", () => {
                  link.remove();
                  resolve();
                }, { once: true });
                next.addEventListener("error", () => {
                  next.remove();
                  console.error("poggers stylesheet refresh failed");
                  resolve();
                }, { once: true });
                link.after(next);
              }));
            }
          }
          return Promise.all(replacements);
        };
        const refreshCode = () => {
          importing = importing
            .then(() => refreshStyle())
            .then(() => import(scriptPath + "?v=" + version))
            .catch((error) => {
              console.error("poggers hot refresh failed", error);
              location.reload();
            });
        };
        const apply = (message) => {
          if (typeof message.version === "number") version = message.version;
          if (message.type !== "reload" && !message.reload) return;
          const changedPath = message.changedPath;
          if (isStyleChange(changedPath)) {
            void refreshStyle();
            return;
          }
          if (isCodeChange(changedPath)) {
            refreshCode();
            return;
          }
          location.reload();
        };
        const connect = () => {
          const protocol = location.protocol === "https:" ? "wss:" : "ws:";
          const socket = new WebSocket(protocol + "//" + location.host + "${liveReloadPath}");
          socket.addEventListener("message", (event) => {
            try {
              const message = JSON.parse(event.data);
              apply(message);
            } catch {}
          });
          socket.addEventListener("close", () => setTimeout(connect, 250));
        };
        const poll = async () => {
          try {
            const response = await fetch("${liveReloadPollPath}?version=" + version, {
              cache: "no-store",
            });
            const message = await response.json();
            apply(message);
          } catch {}
        };
        connect();
        setInterval(poll, 750);
      })();
    </script>`;
  }

  function renderIndex(): Response {
    if (!web) return new Response("not found", { status: 404 });
    const title = web.title ?? app.def.app?.name ?? app.def.pwa?.name ?? "App";
    const pwa = app.def.pwa;
    const hasStyle = Boolean(web.styles || web.styleBundle || web.styleFiles?.length);
    const html =
      web.indexHtml ??
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${
      pwa
        ? `<meta name="theme-color" content="${escapeHtml(pwa.themeColor)}" />
    <meta name="application-name" content="${escapeHtml(pwa.name)}" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${escapeHtml(pwa.shortName ?? pwa.name)}" />
    <link rel="manifest" href="/manifest.webmanifest" />`
        : ""
    }
    ${hasStyle ? `<link rel="stylesheet" href="${escapeHtml(webStylePath)}" />` : ""}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${escapeHtml(webScriptPath)}"></script>
    ${renderLiveReloadScript()}
    ${
      pwa && !web.liveReload
        ? `<script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("/service-worker.js").catch(() => {});
        });
      }
    </script>`
        : ""
    }
  </body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  function startLiveReload() {
    const liveReload = web?.liveReload;
    if (!liveReload) return;

    try {
      scanLiveReloadFiles(liveReload.watchDir, false);
      liveReloadPoll = setInterval(() => {
        scanLiveReloadFiles(liveReload.watchDir, true);
      }, 500);

      liveReloadWatcher = watch(liveReload.watchDir, { recursive: true }, (_event, filename) => {
        const changedPath = filename
          ? resolve(liveReload.watchDir, String(filename))
          : liveReload.watchDir;
        if (!shouldLiveReload(changedPath, liveReload.watchDir)) return;
        try {
          const mtime = statSync(changedPath).mtimeMs;
          if (liveReloadFiles.get(changedPath) === mtime) return;
          liveReloadFiles.set(changedPath, mtime);
        } catch {
          if (!liveReloadFiles.delete(changedPath)) return;
        }
        scheduleLiveReload(changedPath);
      });
    } catch (error) {
      console.warn("poggers live reload disabled", error);
    }
  }

  function scanLiveReloadFiles(watchDir: string, notify: boolean) {
    const seen = new Set<string>();
    for (const file of collectLiveReloadFiles(watchDir, watchDir)) {
      seen.add(file);

      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }

      const previous = liveReloadFiles.get(file);
      liveReloadFiles.set(file, mtime);
      if (notify && previous !== undefined && previous !== mtime) {
        scheduleLiveReload(file);
      }
    }

    for (const file of liveReloadFiles.keys()) {
      if (!seen.has(file)) liveReloadFiles.delete(file);
    }
  }

  function scheduleLiveReload(changedPath: string) {
    liveReloadPendingPath = changedPath;
    if (liveReloadBuild) return;
    if (liveReloadTimer) clearTimeout(liveReloadTimer);
    liveReloadTimer = setTimeout(() => {
      liveReloadTimer = undefined;
      const pendingPath = liveReloadPendingPath;
      liveReloadPendingPath = undefined;
      if (pendingPath) void notifyLiveReload(pendingPath);
    }, 80);
  }

  async function notifyLiveReload(changedPath: string) {
    if (liveReloadBuild) {
      liveReloadPendingPath = changedPath;
      return;
    }
    liveReloadBuild = rebuildAndPublish(changedPath);
    try {
      await liveReloadBuild;
    } finally {
      liveReloadBuild = undefined;
      const pendingPath = liveReloadPendingPath;
      liveReloadPendingPath = undefined;
      if (pendingPath) scheduleLiveReload(pendingPath);
    }
  }

  async function rebuildAndPublish(changedPath: string) {
    try {
      if (browserAssetsBuild) await browserAssetsBuild.promise;
      await web?.liveReload?.onChange?.(changedPath);
    } catch (error) {
      console.error("poggers live reload rebuild failed", error);
      return;
    }
    liveReloadVersion += 1;
    liveReloadChangedPath = relative(web?.liveReload?.watchDir ?? "", changedPath);
    const message = JSON.stringify({
      type: "reload",
      version: liveReloadVersion,
      changedPath: liveReloadChangedPath,
    });

    for (const ws of liveReloadClients) {
      try {
        ws.send(message);
      } catch {
        liveReloadClients.delete(ws);
      }
    }
  }

  function renderManifest(): Response {
    const pwa = app.def.pwa;
    if (!pwa) return new Response("not found", { status: 404 });

    const manifest = {
      name: pwa.name,
      short_name: pwa.shortName ?? pwa.name,
      description: pwa.description,
      start_url: pwa.startUrl ?? "/",
      scope: pwa.scope ?? "/",
      display: pwa.display ?? "standalone",
      orientation: pwa.orientation,
      theme_color: pwa.themeColor,
      background_color: pwa.backgroundColor,
      icons: pwaIcons(pwa.icons),
    };

    return new Response(JSON.stringify(manifest, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/manifest+json; charset=utf-8",
      },
    });
  }

  function renderServiceWorker(): Response {
    if (!app.def.pwa) return new Response("not found", { status: 404 });
    const cacheName = `poggers-${app.def.version}`;
    const urls = ["/", webScriptPath, "/manifest.webmanifest"];
    if (web?.styles || web?.styleBundle || web?.styleFiles?.length) urls.push(webStylePath);
    const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_SHELL = ${JSON.stringify(urls)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
`;

    return new Response(source, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/javascript; charset=utf-8",
      },
    });
  }

  async function serveStaticAsset(pathname: string): Promise<Response | undefined> {
    if (!web?.assetDir || !pathname.startsWith("/assets/")) return undefined;
    const assetPath = resolve(web.assetDir, pathname.slice(1));
    const rel = relative(web.assetDir, assetPath);
    if (rel.startsWith("..") || rel === "") return new Response("not found", { status: 404 });

    const file = Bun.file(assetPath);
    if (!(await file.exists())) return undefined;

    return new Response(file, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType(assetPath),
      },
    });
  }

  function readWorkerViews(resource: string, key: JsonValue): Record<string, unknown> {
    const id = scopeId(resource, key);
    const state = loadScope(id, resource, key);
    const resourceDef = app.def.resources[resource as keyof Spec["Resources"]];
    const views: Record<string, unknown> = {};

    for (const viewName of Object.keys(resourceDef.views ?? {})) {
      views[viewName] = (resourceDef.views as any)[viewName]({
        state,
        actor: null,
        sessions: Array.from(wsClients.values()),
        key,
      });
    }

    return views;
  }

  async function runInternalCommand(
    sessionOwner: any,
    session: SessionData<ActorOf<Spec>>,
    resource: string,
    key: JsonValue,
    name: string,
    args: any[],
    commandId: string,
  ): CommandReceipt<any> {
    if (!(resource in app.def.resources)) {
      return { ok: false, error: "unknown_resource" };
    }

    const id = scopeId(resource, key);
    return enqueueStreamWrite(id, () => {
      const currentState = loadScope(id, resource, key);
      let scopeCommands = processedCommandIds.get(id);
      if (!scopeCommands) {
        scopeCommands = new Set();
        processedCommandIds.set(id, scopeCommands);
      }

      if (scopeCommands.has(commandId)) {
        return { ok: true, cursor: instanceSeqs.get(id) ?? 0 };
      }

      const collectedEvents: Array<{
        id: string;
        seq: number;
        at: number;
        actor: ActorOf<Spec>;
        name: string;
        payload: any;
      }> = [];
      const collectedPresence: Array<any> = [];
      let commandError: { error: string; data?: unknown } | null = null;

      try {
        app.runCommand(
          resource,
          currentState,
          session.actor,
          key,
          name,
          args,
          (event) => collectedEvents.push(event),
          (patch) => collectedPresence.push(patch),
          (error, data) => {
            commandError = { error, data };
          },
        );
      } catch (error) {
        console.error("worker command handler error", error);
        commandError = { error: "internal_error" };
      }

      if (commandError) {
        scopeCommands.add(commandId);
        return {
          ok: false,
          error: commandError.error,
          data: commandError.data,
        };
      }

      let committedEvents: CommittedEvent[] | null = null;
      try {
        committedEvents = commitBatch(collectedEvents, resource, key, commandId);
      } catch (error) {
        console.error("worker command commit error", error);
        return { ok: false, error: "commit_failed" };
      }

      scopeCommands.add(commandId);
      try {
        storage.saveCommandId(id, commandId);
      } catch {}

      if (collectedPresence.length > 0) {
        let presences = scopePresence.get(id);
        if (!presences) {
          presences = new Map();
          scopePresence.set(id, presences);
        }
        let sessionPresence = presences.get(session.id);
        if (!sessionPresence) {
          sessionPresence = {};
          presences.set(session.id, sessionPresence);
        }
        for (const patch of collectedPresence) {
          Object.assign(sessionPresence, patch);
        }
        const nextSession = { ...session, presence: sessionPresence };
        wsClients.set(sessionOwner, nextSession);
        broadcastToSubscribers(id, {
          type: "session",
          session: nextSession,
        });
      }

      return {
        ok: true,
        cursor: instanceSeqs.get(id) ?? 0,
        events: committedEvents ?? undefined,
      } as any;
    });
  }

  for (const workerOpts of opts.workers ?? []) {
    const workerId = workerOpts.workerId ?? `worker-${workerRuntimes.length + 1}`;
    const actor = workerOpts.actor ?? ({ id: workerId } as ActorOf<Spec>);
    const session: SessionData<ActorOf<Spec>> = {
      id: workerId,
      actor,
      presence: {} as any,
    };
    const workerClient = {
      send() {},
      ping() {},
    };
    wsClients.set(workerClient, session);

    workerRuntimes.push(
      startWorkerRuntime(app, workerOpts.worker as WorkerDef<Spec, any>, {
        deps: workerOpts.deps,
        workerId,
        actor,
        store:
          workerOpts.store ??
          createFSWorkerDurabilityStore(`.poggers/workers/${encodeURIComponent(workerId)}.json`),
        readViews(resource, key) {
          return readWorkerViews(resource, key) as any;
        },
        command(resource, key, command, args, commandId) {
          return runInternalCommand(
            workerClient,
            session,
            resource,
            key as JsonValue,
            command,
            args,
            commandId,
          );
        },
        onError(error) {
          console.error("worker handler error", error);
        },
      }),
    );
  }

  for (const programOpts of opts.programs ?? []) {
    const programId =
      programOpts.programId ?? `${String(programOpts.env)}-program-${workerRuntimes.length + 1}`;
    const actor = programOpts.actor ?? ({ id: programId } as ActorOf<Spec>);
    const session: SessionData<ActorOf<Spec>> = {
      id: programId,
      actor,
      presence: {} as any,
    };
    const programClient = {
      send() {},
      ping() {},
    };
    wsClients.set(programClient, session);

    workerRuntimes.push(
      startProgramRuntime(app, programOpts.program as AppProgram<Spec, any>, {
        env: programOpts.env,
        deps: programOpts.deps,
        programId,
        actor,
        store:
          programOpts.store ??
          createFSWorkerDurabilityStore(`.poggers/programs/${encodeURIComponent(programId)}.json`),
        readViews(resource, key) {
          return readWorkerViews(resource, key) as any;
        },
        command(resource, key, command, args, commandId) {
          return runInternalCommand(
            programClient,
            session,
            resource,
            key as JsonValue,
            command,
            args,
            commandId,
          );
        },
        onError(error) {
          console.error("program error", error);
        },
      }),
    );
  }

  const handleFetch = async (
    req: Request,
    server: Bun.Server<any>,
  ): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (web?.liveReload && url.pathname === liveReloadPollPath) {
      scanLiveReloadFiles(web.liveReload.watchDir, true);
      const version = Number(url.searchParams.get("version") ?? 0);
      return Response.json({
        version: liveReloadVersion,
        reload: liveReloadVersion > version,
        changedPath: liveReloadChangedPath,
      });
    }
    if (web?.liveReload && url.pathname === liveReloadPath) {
      if (server.upgrade(req, { data: { liveReload: true } } as any)) return;
      return new Response("upgrade failed", { status: 500 });
    }
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { app: true } } as any)) return;
      return new Response("upgrade failed", { status: 500 });
    }
    const route = opts.routes?.[url.pathname];
    if (route instanceof Response) return route;
    if (typeof route === "function") return route(req);
    if (web && (url.pathname === "/" || url.pathname === "/index.html")) {
      return renderIndex();
    }
    if (web && url.pathname === webScriptPath) {
      return buildBrowserBundle();
    }
    if (web && url.pathname === webStylePath) {
      return buildBrowserStyle();
    }
    if (web && url.pathname === "/manifest.webmanifest") {
      return renderManifest();
    }
    if (web && url.pathname === "/service-worker.js") {
      return renderServiceWorker();
    }
    if (web && url.pathname === "/_poggers/icon.svg") {
      return renderDefaultIcon();
    }
    const asset = await serveStaticAsset(url.pathname);
    if (asset) return asset;
    if (web && acceptsHtml(req)) {
      return renderIndex();
    }
    return new Response("ok", { status: 200 });
  };

  const htmlRoutes =
    web?.html === undefined
      ? undefined
      : ({
          ...opts.routes,
          "/": web.html,
          "/index.html": web.html,
          "/ws": handleFetch,
          "/manifest.webmanifest": handleFetch,
          "/service-worker.js": handleFetch,
          "/_poggers/icon.svg": handleFetch,
          [liveReloadPath]: handleFetch,
          [liveReloadPollPath]: handleFetch,
          "/*": web.html,
        } as Record<string, any>);

  const server = Bun.serve({
    port,
    development: web?.development,
    routes: htmlRoutes,
    fetch: handleFetch,
    websocket: {
      async open(ws) {
        if ((ws.data as any)?.liveReload) {
          liveReloadClients.add(ws);
          ws.send(JSON.stringify({ type: "connected", version: liveReloadVersion }));
          return;
        }
        if (!(ws.data as any)?.app) return;
      },
      close(ws) {
        if ((ws.data as any)?.liveReload) {
          liveReloadClients.delete(ws);
          return;
        }
        if (!(ws.data as any)?.app) return;
        const session = wsClients.get(ws);
        if (!session) return;
        wsClients.delete(ws);
        for (const set of subscribers.values()) set.delete(ws);
        for (const presences of scopePresence.values()) {
          presences.delete(session.id);
        }
        broadcastExcept(ws, { type: "sessionLeft", sessionId: session.id });
      },
      message(ws, data) {
        if ((ws.data as any)?.liveReload) return;
        if (!(ws.data as any)?.app) return;
        try {
          const parsed = JSON.parse(data as string);
          const msg = validateClientMessage(parsed);
          if (!msg) return;

          if (msg.type === "connect") {
            const token = typeof msg.token === "string" ? msg.token : "";
            const actor = app.def.identify({ token });
            if (!actor) return ws.close(4001, "unauthorized");

            const session: SessionData<ActorOf<Spec>> = {
              id: `${actor.id}-${crypto.randomUUID().slice(0, 9)}`,
              actor,
              presence: {} as any,
            };
            wsClients.set(ws, session);

            ws.send(
              JSON.stringify({
                type: "init",
                sessions: Array.from(wsClients.values()),
                selfId: session.id,
              } satisfies ServerMessage),
            );

            broadcastExcept(ws, { type: "session", session });
            return;
          }

          if (msg.type === "subscribe") {
            const session = wsClients.get(ws);
            if (!session) return;
            if (typeof msg.resource !== "string") return;
            if (!(msg.resource in app.def.resources)) return;
            const cursor = typeof msg.cursor === "number" ? msg.cursor : 0;

            const key = msg.key as JsonValue;

            subscribe(ws, msg.resource, key);
            loadScope(scopeId(msg.resource, key), msg.resource, key);
            const sync = computeSync(
              msg.resource,
              msg.key,
              cursor,
              storage,
              eventBuffers,
              states,
              instanceSeqs,
              app,
              serverGeneration,
            );

            ws.send(
              JSON.stringify({
                type: "synced",
                resource: msg.resource,
                key,
                snapshot: sync.snapshot,
                events: sync.events,
                cursor: sync.cursor,
                generation: serverGeneration,
              } satisfies ServerMessage),
            );
            return;
          }

          if (msg.type === "command") {
            const session = wsClients.get(ws);
            if (!session) return;
            if (typeof msg.resource !== "string" || typeof msg.name !== "string") return;
            if (!(msg.resource in app.def.resources)) return;
            const args: any[] = Array.isArray(msg.args) ? msg.args : [];
            const key = msg.key as JsonValue;
            const commandId: string = msg.commandId as string;

            const id = scopeId(msg.resource, key);
            void enqueueStreamWrite(id, () => {
              const currentState = loadScope(id, msg.resource, key);

              let scopeCommands = processedCommandIds.get(id);
              if (!scopeCommands) {
                scopeCommands = new Set();
                processedCommandIds.set(id, scopeCommands);
              }

              if (scopeCommands.has(commandId)) {
                ws.send(
                  JSON.stringify({
                    type: "commandAck",
                    commandId,
                    ok: true,
                    cursor: instanceSeqs.get(id) ?? 0,
                  } satisfies ServerMessage),
                );
                return;
              }

              subscribe(ws, msg.resource, key);

              const collectedEvents: Array<{
                id: string;
                seq: number;
                at: number;
                actor: ActorOf<Spec>;
                name: string;
                payload: any;
              }> = [];

              const collectedPresence: Array<any> = [];

              let handlerError: { error: string; data?: unknown } | null = null;
              let handlerThrew = false;
              try {
                app.runCommand(
                  msg.resource,
                  currentState,
                  session.actor,
                  key,
                  msg.name as string,
                  args,
                  (event) => collectedEvents.push(event),
                  (patch) => collectedPresence.push(patch),
                  (error, data) => {
                    handlerError = { error, data };
                  },
                );
              } catch (e) {
                console.error("server command handler error", e);
                handlerThrew = true;
              }

              if (handlerThrew || handlerError) {
                const err = handlerError as {
                  error: string;
                  data?: unknown;
                } | null;
                scopeCommands.add(commandId);
                ws.send(
                  JSON.stringify({
                    type: "commandAck",
                    commandId,
                    ok: false,
                    cursor: instanceSeqs.get(id) ?? 0,
                    error: err?.error ?? "internal_error",
                    data: err?.data,
                  } satisfies ServerMessage),
                );
                return;
              }

              let allCommitted = true;
              let committedEvents: CommittedEvent[] | null = null;
              if (collectedEvents.length > 0) {
                try {
                  committedEvents = commitBatch(collectedEvents, msg.resource, key, commandId);
                } catch (e) {
                  console.error("server commit error", e);
                  allCommitted = false;
                }
              }

              if (allCommitted) {
                scopeCommands.add(commandId);

                try {
                  storage.saveCommandId(id, commandId);
                } catch {}

                if (collectedPresence.length > 0) {
                  let presences = scopePresence.get(id);
                  if (!presences) {
                    presences = new Map();
                    scopePresence.set(id, presences);
                  }
                  let sessionPresence = presences.get(session.id);
                  if (!sessionPresence) {
                    sessionPresence = {};
                    presences.set(session.id, sessionPresence);
                  }
                  for (const patch of collectedPresence) {
                    Object.assign(sessionPresence, patch);
                  }
                  broadcastToSubscribers(id, {
                    type: "session",
                    session: { ...session, presence: sessionPresence },
                  });
                }
              }

              ws.send(
                JSON.stringify({
                  type: "commandAck",
                  commandId,
                  ok: allCommitted,
                  cursor: instanceSeqs.get(id) ?? 0,
                  events: committedEvents ?? undefined,
                } satisfies ServerMessage),
              );
            }).catch((error) => {
              console.error("server command stream error", error);
            });
            return;
          }
        } catch (e) {
          console.error("server message error", e);
        }
      },
    },
  });

  function trimBuffer(key: string) {
    const buf = eventBuffers.get(key);
    if (buf && buf.length > DELTA_THRESHOLD) {
      eventBuffers.set(key, buf.slice(-DELTA_THRESHOLD));
    }
  }

  async function compactableSeq(id: string, snapshotSeq: number): Promise<number> {
    if (workerRuntimes.length === 0) return snapshotSeq;

    let seq = snapshotSeq;
    for (const runtime of workerRuntimes) {
      const checkpoint = await runtime.checkpoint(id);
      seq = Math.min(seq, checkpoint ?? 0);
    }
    return seq;
  }

  async function runSnapshotCycle() {
    try {
      const scopesToSnapshot = new Set([...dirtyScopes, ...failedSnapshotScopes]);
      for (const id of scopesToSnapshot) {
        const s = states.get(id);
        if (!s) continue;
        const seq = instanceSeqs.get(id) ?? 0;
        try {
          storage.saveSnapshot(id, app.snapshot(s, seq));
          dirtyScopes.delete(id);
          failedSnapshotScopes.delete(id);
          needsCompaction.add(id);
          compactionSeqs.set(id, seq);
        } catch {
          failedSnapshotScopes.add(id);
        }
      }

      for (const id of needsCompaction) {
        const targetSeq = compactionSeqs.get(id) ?? 0;
        const throughSeq = await compactableSeq(id, targetSeq);
        if (throughSeq <= 0) continue;
        try {
          storage.compactEvents(id, throughSeq);
        } catch {
          continue;
        }
        if (throughSeq >= targetSeq) {
          needsCompaction.delete(id);
          compactionSeqs.delete(id);
        }
        trimBuffer(id);
      }
    } catch (e) {
      console.error("server snapshot error", e);
    }
  }

  const snapshotInterval = setInterval(() => {
    if (snapshotCycle) return;
    snapshotCycle = runSnapshotCycle().finally(() => {
      snapshotCycle = null;
    });
  }, snapshotIntervalMs);

  startLiveReload();

  console.log(`poggers server running on ws://localhost:${server.port}`);

  const keepaliveInterval = setInterval(() => {
    for (const [ws] of wsClients) {
      try {
        ws.ping();
      } catch {}
    }
  }, PING_INTERVAL_MS);

  return {
    url: server.url,
    stop: () => {
      clearInterval(snapshotInterval);
      clearInterval(keepaliveInterval);
      if (liveReloadPoll) clearInterval(liveReloadPoll);
      if (liveReloadTimer) clearTimeout(liveReloadTimer);
      liveReloadWatcher?.close();
      for (const ws of liveReloadClients) {
        try {
          ws.close();
        } catch {}
      }
      void Promise.all(workerRuntimes.map((runtime) => runtime.stop())).catch((error) => {
        console.error("runtime shutdown error", error);
      });
      server.stop();
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shouldLiveReload(changedPath: string, watchDir: string): boolean {
  const rel = relative(watchDir, changedPath).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..")) return false;
  if (rel.startsWith(".poggers-")) return false;
  if (rel.startsWith(".poggers/")) return false;
  if (rel.startsWith("dist/")) return false;
  if (rel.startsWith("node_modules/")) return false;
  if (rel.startsWith("coverage/")) return false;
  if (rel.startsWith("playwright-report/")) return false;
  if (rel.startsWith("test-results/")) return false;
  if (rel.includes("/node_modules/")) return false;
  if (rel.endsWith(".jsonl")) return false;
  if (rel.endsWith(".snapshot.json")) return false;
  if (rel.endsWith(".commands.json")) return false;
  return /\.(css|html|js|jsx|json|ts|tsx)$/.test(rel);
}

function collectLiveReloadFiles(dir: string, watchDir: string): string[] {
  const files: string[] = [];
  let entries: Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    const rel = relative(watchDir, path).replaceAll("\\", "/");
    if (
      rel === ".poggers" ||
      rel === "dist" ||
      rel === "node_modules" ||
      rel === "coverage" ||
      rel === "playwright-report" ||
      rel === "test-results" ||
      rel.startsWith(".poggers-") ||
      rel.startsWith(".poggers/") ||
      rel.startsWith("dist/") ||
      rel.startsWith("node_modules/") ||
      rel.startsWith("coverage/") ||
      rel.startsWith("playwright-report/") ||
      rel.startsWith("test-results/") ||
      rel.includes("/node_modules/")
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectLiveReloadFiles(path, watchDir));
      continue;
    }

    if (entry.isFile() && shouldLiveReload(path, watchDir)) {
      files.push(path);
    }
  }

  return files;
}

function acceptsHtml(req: Request): boolean {
  return req.headers.get("accept")?.includes("text/html") ?? false;
}

function pwaIcons(
  icons:
    | {
        any?: unknown;
        maskable?: unknown;
      }
    | undefined,
) {
  const normalized = [
    ...normalizeIconGroup(icons?.any, "any"),
    ...normalizeIconGroup(icons?.maskable, "maskable"),
  ];

  if (normalized.length > 0) return normalized;

  return [
    {
      src: "/_poggers/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ];
}

function normalizeIconGroup(value: unknown, purpose: string) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap((item) => {
    if (typeof item === "string") {
      return [
        {
          src: publicAssetPath(item),
          sizes: "any",
          type: contentType(item),
          purpose,
        },
      ];
    }
    if (!item || typeof item !== "object") return [];
    const icon = item as {
      src?: string;
      sizes?: string;
      type?: string;
      purpose?: string;
    };
    if (!icon.src) return [];
    return [
      {
        src: publicAssetPath(icon.src),
        sizes: icon.sizes ?? "any",
        type: icon.type ?? contentType(icon.src),
        purpose: icon.purpose ?? purpose,
      },
    ];
  });
}

function publicAssetPath(path: string): string {
  if (path.startsWith("/") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `/assets/${path.replace(/^\.\//, "")}`;
}

function renderDefaultIcon(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="108" fill="oklch(21.01% 0.0318 264.66)"/>
  <path d="M136 327V185h126c72 0 114 38 114 96s-42 96-114 96h-56v-50h56c38 0 60-16 60-46s-22-46-60-46h-72v92h-54Z" fill="oklch(98.42% 0.0034 247.86)"/>
</svg>`;
  return new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/svg+xml; charset=utf-8",
    },
  });
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".json":
    case ".webmanifest":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
