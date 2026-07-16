import { createHash } from "node:crypto";
import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

import {
  assertResourceCommand,
  assertResourceKey,
  type ActorOf,
  type App,
  type AppSpec,
  type EnvironmentDeps,
  type EnvironmentName,
  type JsonValue,
  type SessionData,
} from "#kernel/app";
import { assertRuntimeProgramManifest, type RuntimeProgramManifestEntry } from "#kernel/feature";
import type { ApplicationManifest } from "#kernel/manifest";
import {
  assertSourceTopology,
  sourceCursor,
  type DeploymentRequest,
  type SourceCursor,
  type SubstrateAdapter,
} from "#substrate/adapter";
import { createSqliteSubstrate } from "#substrate/adapter.sqlite";
import { defaultDurabilityProfile, type DurabilityProfile } from "#substrate/durability";
import { IntentMismatchError, type JournalHead, type ResourceAddress } from "#substrate/journal";
import {
  createSubstrateProgramProgressStore,
  startProgram,
  type AppProgram,
  type ProgramCommandResult,
  type ProgramEventRecord,
  type ProgramRuntime,
} from "#substrate/program";
import {
  maxProtocolBatch,
  protocolVersion,
  scopeId,
  validateClientMessage,
  type CommittedEvent,
  type ServerMessage,
  type ServerOperation,
} from "#substrate/protocol";
import {
  authorizeResource,
  createResourceIntent,
  executeResourceCommandFromState,
  loadResourceAuthority,
  verifyResources,
  type ResourceCommandRecord,
  type ResourceCommandResult,
} from "#substrate/resource";
import { computeSync } from "#substrate/sync";

const SNAPSHOT_INTERVAL = 5000;
const SNAPSHOT_RECORDS = 500;
const PING_INTERVAL_MS = 30000;
const DEFAULT_SERVER_LIMITS: ServerLimits = {
  messageBytes: 1_048_576,
  inboundBytes: 4_194_304,
  outboundBytes: 4_194_304,
  decisionBytes: 1_048_576,
  eventsPerDecision: maxProtocolBatch,
  replayEvents: maxProtocolBatch,
  queuedMessages: 128,
  queuedCommandsPerResource: 256,
  loadedResources: 50_000,
  subscriptionsPerClient: 10_000,
  subscribersPerResource: 10_000,
};
const poggersJsx = {
  runtime: "automatic",
  importSource: "@poggers/kit",
} as const;

type ServerSocketData = {
  app?: true;
  liveReload?: true;
  headers?: readonly [string, string][];
  token?: string;
  messageQueue?: Promise<void>;
  queuedMessages?: number;
  queuedBytes?: number;
};

type RuntimeClient = {
  readonly data?: ServerSocketData;
  send(data: string): number | void;
  close(code?: number, reason?: string): void;
  ping(): number | void;
};

type ServerRoute =
  | Response
  | Bun.HTMLBundle
  | ((
      request: Request,
      server: Bun.Server<ServerSocketData>,
    ) => Response | Promise<Response> | undefined);

export type ServeOpts<Spec extends AppSpec = AppSpec> = {
  port?: number;
  substrate: SubstrateAdapter;
  manifest?: ApplicationManifest;
  deployment?: DeploymentRequest;
  routes?: Readonly<Record<string, ServerRoute>>;
  snapshotIntervalMs?: number;
  snapshotRecords?: number;
  web?: WebServeOpts;
  programs?: readonly AnyServeProgramOpts<Spec>[];
  dependencyGroups?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  disposeDependencies?: () => Promise<void>;
  limits?: Partial<ServerLimits>;
};

export type ServerLimits = Readonly<{
  messageBytes: number;
  inboundBytes: number;
  outboundBytes: number;
  decisionBytes: number;
  eventsPerDecision: number;
  replayEvents: number;
  queuedMessages: number;
  queuedCommandsPerResource: number;
  loadedResources: number;
  subscriptionsPerClient: number;
  subscribersPerResource: number;
}>;

export type AppEnvironmentProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  env: Env;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  maxPendingEvents?: number;
  disposeDependencies?: () => Promise<void>;
};

export type AnyServeProgramOpts<Spec extends AppSpec> = {
  [Env in EnvironmentName<Spec>]: AppEnvironmentProgram<Spec, Env>;
}[EnvironmentName<Spec>];

export type ServerHandle = {
  url: URL;
  ready: Promise<void>;
  stop: () => Promise<void>;
};

type RuntimeSubscription = Readonly<{
  closed: Promise<void>;
  stop(): Promise<void>;
}>;

export type WebServeOpts = {
  bundle?: string;
  styleBundle?: string;
  entrypoint: string | URL;
  html?: Bun.HTMLBundle;
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

export function serve<Spec extends AppSpec>(app: App<Spec>, opts: ServeOpts<Spec>): ServerHandle {
  const port = opts.port ?? 3000;
  const limits = { ...DEFAULT_SERVER_LIMITS, ...opts.limits };
  assertServerLimits(limits);
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? SNAPSHOT_INTERVAL;
  const snapshotRecords = opts.snapshotRecords ?? SNAPSHOT_RECORDS;
  if (!Number.isSafeInteger(snapshotIntervalMs) || snapshotIntervalMs <= 0) {
    throw new RangeError("snapshotIntervalMs must be a positive integer.");
  }
  if (!Number.isSafeInteger(snapshotRecords) || snapshotRecords <= 0) {
    throw new RangeError("snapshotRecords must be a positive integer.");
  }
  const substrate = opts.substrate;
  const manifest = opts.manifest ?? runtimeApplicationManifest(app.def.programManifest);
  assertRuntimeProgramManifest(app.def.programManifest, manifest);
  const ready = substrate
    .validate(manifest, opts.deployment ?? { instances: 1 })
    .then(async () => {
      if ((opts.programs?.length ?? 0) === 0) return;
      const topology = await substrate.events.topology();
      assertSourceTopology(topology);
      if (topology.splits.length !== 1) {
        throw new Error(
          "The current Program executor supports exactly one committed-event source split.",
        );
      }
    })
    .then(() => verifyResources(app, substrate))
    .then(() => {
      for (const program of opts.programs ?? []) startConfiguredProgram(program as never);
    });
  void ready.catch(() => {});
  const serverGeneration = crypto.randomUUID();
  let outboundChunkId = 0;
  const dependencyGroups = opts.dependencyGroups ?? {};
  const authenticationOwner = app.def.authenticationOwner;
  const authentication = authenticationOwner
    ? dependencyGroups[authenticationOwner]?.authentication
    : undefined;
  if (authenticationOwner && !authentication) {
    throw new Error(`Authentication for ${authenticationOwner} is not started.`);
  }

  const resolveActor = async (
    sourceHeaders: Headers,
    token?: string,
  ): Promise<ActorOf<Spec> | null> => {
    if (authentication) {
      const headers = new Headers(sourceHeaders);
      if (token && !headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      const resolver = authentication as {
        readonly resolve: (credential: {
          readonly headers: Headers;
        }) => Promise<{ readonly actor: ActorOf<Spec> } | null>;
      };
      return (await resolver.resolve({ headers }))?.actor ?? null;
    }
    return token ? app.def.identify({ token }) : null;
  };

  const socketCredential = (ws: {
    readonly data: unknown;
  }): { headers: Headers; token: string } => {
    const data = ws.data as {
      readonly headers?: readonly [string, string][];
      readonly token?: string;
    };
    return {
      headers: new Headers((data.headers ?? []).map(([name, value]) => [name, value])),
      token: data.token ?? "",
    };
  };

  const dirtyScopes = new Set<string>();
  const failedSnapshotScopes = new Set<string>();
  let snapshotCycle: Promise<void> | null = null;
  let stopping = false;
  const eventBuffers = new Map<string, unknown[]>();
  const instanceSeqs = new Map<string, number>();
  const streamWriters = new Map<string, Promise<void>>();
  const streamWriterDepth = new Map<string, number>();
  const wsClients = new Map<RuntimeClient, SessionData<ActorOf<Spec>>>();
  const clientSubscriptions = new Map<RuntimeClient, Set<string>>();
  const states = new Map<string, unknown>();
  const subscribers = new Map<string, Set<RuntimeClient>>();
  const resourceAddresses = new Map<string, ResourceAddress>();
  const resourceHeads = new Map<string, JournalHead>();
  const snapshotHeads = new Map<string, JournalHead>();
  const scopeLoads = new Map<string, Promise<unknown>>();
  const scopePresence = new Map<string, Map<string, SessionData<ActorOf<Spec>>>>();
  const programRuntimes: ProgramRuntime<Spec>[] = [];
  const programRuntimeController = new AbortController();
  const web = opts.web;
  const webScriptPath = web?.scriptPath ?? "/client.js";
  const webStylePath = web?.stylePath ?? "/client.css";
  const liveReloadPath = "/__poggers/live";
  const liveReloadPollPath = "/__poggers/live-poll";
  const liveReloadClients = new Set<RuntimeClient>();
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
  const encodedBrowserAssets = new Map<string, Uint8Array>();

  function getEventBuffer(key: string): unknown[] {
    let buf = eventBuffers.get(key);
    if (!buf) {
      buf = [];
      eventBuffers.set(key, buf);
    }
    return buf;
  }

  function enqueueStreamWrite<T>(id: string, task: () => T | Promise<T>): Promise<T> {
    const depth = streamWriterDepth.get(id) ?? 0;
    if (depth >= limits.queuedCommandsPerResource) {
      return Promise.reject(new ServerOverloadError(`Resource ${id} command queue is full.`));
    }
    streamWriterDepth.set(id, depth + 1);
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
      const remaining = (streamWriterDepth.get(id) ?? 1) - 1;
      if (remaining === 0) streamWriterDepth.delete(id);
      else streamWriterDepth.set(id, remaining);
    });
    return next;
  }

  async function loadScope(id: string, resource: string, key: JsonValue): Promise<unknown> {
    if (states.has(id)) return states.get(id);
    const loading = scopeLoads.get(id);
    if (loading) return loading;
    if (states.size + scopeLoads.size >= limits.loadedResources) {
      throw new ServerOverloadError(`Loaded Resource limit ${limits.loadedResources} was reached.`);
    }
    const address = { resource, key } satisfies ResourceAddress;
    const next = loadResourceAuthority(app, substrate.authority, address).then((loaded) => {
      states.set(id, loaded.state);
      instanceSeqs.set(id, loaded.eventCursor);
      resourceAddresses.set(id, address);
      resourceHeads.set(id, loaded.head);
      snapshotHeads.set(id, loaded.snapshotHead);
      const buffer = getEventBuffer(id);
      buffer.push(...loaded.events.slice(-limits.replayEvents));
      scopeLoads.delete(id);
      return loaded.state;
    });
    scopeLoads.set(id, next);
    try {
      return await next;
    } catch (error) {
      scopeLoads.delete(id);
      throw error;
    }
  }

  function subscribe(ws: RuntimeClient, resource: string, key: JsonValue): boolean {
    const id = scopeId(resource, key);
    let set = subscribers.get(id);
    if (set?.has(ws)) return false;
    let owned = clientSubscriptions.get(ws);
    if (!owned) {
      owned = new Set();
      clientSubscriptions.set(ws, owned);
    }
    if (owned.size >= limits.subscriptionsPerClient) {
      throw new ServerOverloadError(
        `Client subscription limit ${limits.subscriptionsPerClient} was reached.`,
      );
    }
    if ((set?.size ?? 0) >= limits.subscribersPerResource) {
      throw new ServerOverloadError(
        `Resource subscriber limit ${limits.subscribersPerResource} was reached.`,
      );
    }
    if (!set) {
      set = new Set();
      subscribers.set(id, set);
    }
    set.add(ws);
    owned.add(id);
    return true;
  }

  function leaveScopePresence(id: string, sessionId: string): void {
    const presences = scopePresence.get(id);
    if (!presences?.delete(sessionId)) return;
    const address = resourceAddresses.get(id);
    if (address) {
      broadcastToSubscribers(id, {
        type: "presenceLeft",
        resource: address.resource,
        key: address.key,
        sessionId,
      });
    }
    if (presences.size === 0) scopePresence.delete(id);
  }

  function unsubscribe(client: RuntimeClient, id: string, sessionId?: string): void {
    const set = subscribers.get(id);
    set?.delete(client);
    if (set?.size === 0) subscribers.delete(id);
    const owned = clientSubscriptions.get(client);
    owned?.delete(id);
    if (owned?.size === 0) clientSubscriptions.delete(client);
    if (sessionId) leaveScopePresence(id, sessionId);
  }

  function evictClient(client: RuntimeClient) {
    const session = wsClients.get(client);
    for (const id of clientSubscriptions.get(client) ?? []) {
      unsubscribe(client, id, session?.id);
    }
    clientSubscriptions.delete(client);
    wsClients.delete(client);
  }

  function safeSendFrame(client: RuntimeClient, data: string) {
    try {
      const result = client.send(data);
      if (result === 0) {
        evictClient(client);
        client.close(1013, "client is falling behind");
        return false;
      }
      return true;
    } catch {
      evictClient(client);
      return false;
    }
  }

  function outboundFrames(data: string): string[] {
    const frameBytes = Math.min(limits.messageBytes, limits.outboundBytes);
    const encoded = Buffer.from(data);
    if (encoded.byteLength <= frameBytes) return [data];
    const rawChunkBytes = Math.floor(((frameBytes - 512) * 3) / 4 / 3) * 3;
    if (rawChunkBytes <= 0) throw new ServerOverloadError("Server frame limit is too small.");
    const total = Math.ceil(encoded.byteLength / rawChunkBytes);
    if (total > 1_024) throw new ServerOverloadError("Server message needs too many frames.");
    const id = `${serverGeneration}:${outboundChunkId++}`;
    return Array.from({ length: total }, (_, index) => {
      const data = encoded
        .subarray(index * rawChunkBytes, Math.min(encoded.byteLength, (index + 1) * rawChunkBytes))
        .toString("base64");
      const frame = JSON.stringify({ type: "poggers:chunk", id, index, total, data });
      if (Buffer.byteLength(frame) > frameBytes) {
        throw new ServerOverloadError("Server chunk exceeded its frame limit.");
      }
      return frame;
    });
  }

  function safeSend(client: RuntimeClient, data: string) {
    try {
      for (const frame of outboundFrames(data)) {
        if (!safeSendFrame(client, frame)) return false;
      }
      return true;
    } catch {
      evictClient(client);
      try {
        client.close(1009, "server message is too large");
      } catch {}
      return false;
    }
  }

  function serverFrames(operations: readonly ServerOperation[]): string[] {
    return Array.from({ length: Math.ceil(operations.length / maxProtocolBatch) }, (_, index) => {
      const batch = operations.slice(index * maxProtocolBatch, (index + 1) * maxProtocolBatch);
      return JSON.stringify(
        batch.length === 1
          ? batch[0]
          : ({ type: "batch", operations: batch } satisfies ServerMessage),
      );
    });
  }

  function safeSendOperations(client: RuntimeClient, operations: readonly ServerOperation[]): void {
    for (const frame of serverFrames(operations)) safeSend(client, frame);
  }

  function broadcastToSubscribers(
    id: string,
    message: ServerMessage | readonly ServerOperation[],
    exclude?: RuntimeClient,
  ) {
    const frames = Array.isArray(message) ? serverFrames(message) : [JSON.stringify(message)];
    const set = subscribers.get(id);
    if (set) {
      const address = resourceAddresses.get(id);
      const state = states.get(id);
      for (const client of set) {
        if (client === exclude) continue;
        const session = wsClients.get(client);
        if (
          !session ||
          (address &&
            state !== undefined &&
            !authorizeResource(app, address.resource, state, session.actor, address.key, {
              type: "read",
            }))
        ) {
          unsubscribe(client, id, session?.id);
          if (address) {
            safeSend(
              client,
              JSON.stringify({
                type: "forbidden",
                resource: address.resource,
                key: address.key,
              } satisfies ServerMessage),
            );
          }
          continue;
        }
        for (const frame of frames) safeSend(client, frame);
      }
      if (set.size === 0) subscribers.delete(id);
    }
  }

  async function runAuthorityCommand(
    resource: string,
    key: JsonValue,
    name: string,
    args: readonly unknown[],
    commandId: string,
    actor: ActorOf<Spec>,
    at: number,
    origin: "client" | "program" = "client",
  ): Promise<ResourceCommandResult<ActorOf<Spec>>> {
    const id = scopeId(resource, key);
    const state = await loadScope(id, resource, key);
    const result = await executeResourceCommandFromState(
      app,
      substrate.authority,
      createResourceIntent(commandId, { resource, key, name, args, actor, at, origin }),
      {
        state,
        eventCursor: instanceSeqs.get(id) ?? 0,
        head: resourceHeads.get(id) ?? { revision: 0, position: 0 },
        snapshotHead: snapshotHeads.get(id) ?? { revision: 0, position: 0 },
        events: [],
      },
      {
        decisionBytes: limits.decisionBytes,
        eventsPerDecision: limits.eventsPerDecision,
      },
    );
    const localRevision = resourceHeads.get(id)?.revision ?? 0;
    if (result.record.revision <= localRevision) return result;
    if (result.record.revision !== localRevision + 1) {
      const loaded = await loadResourceAuthority(app, substrate.authority, { resource, key });
      states.set(id, loaded.state);
      instanceSeqs.set(id, loaded.eventCursor);
      resourceAddresses.set(id, { resource, key });
      resourceHeads.set(id, loaded.head);
      snapshotHeads.set(id, loaded.snapshotHead);
      const buffer = getEventBuffer(id);
      buffer.splice(0, buffer.length, ...loaded.events.slice(-limits.replayEvents));
      const set = subscribers.get(id);
      if (set) {
        const data = JSON.stringify({
          type: "synced",
          resource,
          key,
          snapshot: app.snapshot(loaded.state, loaded.eventCursor),
          sessions: [...(scopePresence.get(id)?.values() ?? [])],
          cursor: loaded.eventCursor,
        } satisfies ServerMessage);
        for (const client of set) {
          const session = wsClients.get(client);
          if (
            !session ||
            !authorizeResource(app, resource, loaded.state, session.actor, key, { type: "read" })
          ) {
            unsubscribe(client, id, session?.id);
            safeSend(
              client,
              JSON.stringify({ type: "forbidden", resource, key } satisfies ServerMessage),
            );
            continue;
          }
          safeSend(client, data);
        }
      }
      return result;
    }

    const currentState = states.get(id);
    for (const event of result.record.decision.events) {
      app.applyEvent(
        resource,
        currentState as never,
        {
          id: event.id,
          seq: event.seq,
          at: event.at,
          actor: event.actor as ActorOf<Spec>,
          name: event.name,
          payload: event.payload,
          hash: event.hash,
        },
        event.version,
        event.hash,
      );
      instanceSeqs.set(id, event.seq);
      getEventBuffer(id).push(event);
    }
    if (result.record.decision.events.length > 0) {
      broadcastToSubscribers(
        id,
        result.record.decision.events.map(
          (event) => ({ type: "event", event, resource, key }) satisfies ServerOperation,
        ),
      );
    }
    resourceHeads.set(id, {
      revision: result.record.revision,
      position: result.record.position,
    });
    dirtyScopes.add(id);
    if (result.record.revision - (snapshotHeads.get(id)?.revision ?? 0) >= snapshotRecords) {
      scheduleSnapshotCycle();
    }
    trimBuffer(id);
    return result;
  }

  function publishPresence(
    session: SessionData<ActorOf<Spec>>,
    resource: string,
    key: JsonValue,
    value: unknown,
    exclude?: RuntimeClient,
  ): SessionData<ActorOf<Spec>> {
    const id = scopeId(resource, key);
    let presences = scopePresence.get(id);
    if (!presences) {
      presences = new Map();
      scopePresence.set(id, presences);
    }
    const next = { ...session, presence: structuredClone(value) };
    presences.set(session.id, next);
    broadcastToSubscribers(id, { type: "presence", resource, key, session: next }, exclude);
    return next;
  }

  function enterPresence(
    client: RuntimeClient,
    session: SessionData<ActorOf<Spec>>,
    resource: string,
    key: JsonValue,
  ): void {
    const definition = app.def.resources[resource];
    if (!definition || !Object.prototype.hasOwnProperty.call(definition, "presence")) return;
    const id = scopeId(resource, key);
    if (scopePresence.get(id)?.has(session.id)) return;
    publishPresence(session, resource, key, definition.presence, client);
  }

  function createProgramEvents(
    resource: string,
    key: JsonValue,
    events: CommittedEvent[],
    position: number,
  ): ProgramEventRecord<Spec>[] {
    return events.map((event, index) => ({
      resource: resource as Extract<keyof Spec["Resources"], string>,
      key,
      event: {
        id: event.id,
        seq: event.seq,
        position,
        index,
        at: event.at,
        version: event.version ?? app.def.version,
        ...(event.hash ? { hash: event.hash } : {}),
        actor: event.actor as ActorOf<Spec>,
        name: event.name,
        payload: event.payload,
      },
    }));
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
      define: { __POGGERS_BROWSER__: "true", __POGGERS_HMR__: "true" },
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

  async function buildBrowserBundle(req: Request): Promise<Response> {
    const assets = await buildBrowserAssets();
    if (assets instanceof Response) return assets;
    return browserAssetResponse(req, "script", assets.script, "text/javascript; charset=utf-8");
  }

  async function buildBrowserStyle(req: Request): Promise<Response> {
    const assets = await buildBrowserAssets();
    if (assets instanceof Response) return assets;
    if (!assets.style) return new Response("", { status: 204 });

    return browserAssetResponse(req, "style", assets.style, "text/css; charset=utf-8");
  }

  function browserAssetResponse(
    req: Request,
    name: "script" | "style",
    body: string,
    contentType: string,
  ): Response {
    const development = Boolean(web?.development || web?.liveReload);
    const etag = `"${body.length.toString(16)}-${Bun.hash(body).toString(16)}"`;
    const baseHeaders = {
      "Cache-Control": development ? "no-store" : "no-cache",
      "Content-Type": contentType,
      ETag: etag,
      Vary: "Accept-Encoding",
    };
    if (!development && req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: baseHeaders });
    }
    if (development) return new Response(body, { headers: baseHeaders });

    const accepted = req.headers.get("accept-encoding") ?? "";
    const encoding = /(?:^|,)\s*br(?:\s*;|\s*,|\s*$)/i.test(accepted)
      ? "br"
      : /(?:^|,)\s*gzip(?:\s*;|\s*,|\s*$)/i.test(accepted)
        ? "gzip"
        : undefined;
    if (!encoding) return new Response(body, { headers: baseHeaders });

    const cacheKey = `${liveReloadVersion}:${name}:${encoding}`;
    let encoded = encodedBrowserAssets.get(cacheKey);
    if (!encoded) {
      encoded =
        encoding === "br"
          ? brotliCompressSync(body, {
              params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
            })
          : gzipSync(body, { level: 6 });
      encodedBrowserAssets.set(cacheKey, encoded);
    }
    return new Response(encoded as BodyInit, {
      headers: { ...baseHeaders, "Content-Encoding": encoding },
    });
  }

  function renderLiveReloadScript(): string {
    if (!web?.liveReload) return "";
    return `<script type="module">
      (() => {
        let version = ${liveReloadVersion};
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
    let assets: { script: string; style?: string } | Response;
    try {
      if (browserAssetsBuild) await browserAssetsBuild.promise;
      await web?.liveReload?.onChange?.(changedPath);
      if (liveReloadPendingPath) return;
      assets = await compileBrowserAssets();
    } catch (error) {
      console.error("poggers live reload rebuild failed", error);
      return;
    }
    if (assets instanceof Response) {
      console.error("poggers live reload browser build failed", await assets.text());
      return;
    }
    if (liveReloadPendingPath) return;
    liveReloadVersion += 1;
    browserAssetsCache = { version: liveReloadVersion, assets };
    encodedBrowserAssets.clear();
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

  function readProgramViews(
    resource: string,
    key: JsonValue,
    actor: ActorOf<Spec>,
  ): Record<string, unknown> {
    const id = scopeId(resource, key);
    const state = states.get(id);
    if (state === undefined) {
      throw new Error(`Program read requires loaded Resource ${id}.`);
    }
    if (!authorizeResource(app, resource, state, actor, key, { type: "read", origin: "program" })) {
      throw new Error(`Program read is forbidden for Resource ${id}.`);
    }
    const resourceDef = app.def.resources[resource as keyof Spec["Resources"]];
    const views: Record<string, unknown> = {};

    const definitions = resourceDef.views as unknown as Readonly<
      Record<
        string,
        (context: {
          state: unknown;
          actor: ActorOf<Spec>;
          sessions: readonly SessionData<ActorOf<Spec>>[];
          key: JsonValue;
        }) => unknown
      >
    >;
    for (const viewName of Object.keys(definitions)) {
      const view = definitions[viewName];
      if (!view) continue;
      views[viewName] = view({
        state,
        actor,
        sessions: [...(scopePresence.get(id)?.values() ?? [])],
        key,
      });
    }

    return views;
  }

  async function runInternalCommand(
    sessionOwner: RuntimeClient,
    session: SessionData<ActorOf<Spec>>,
    resource: string,
    key: JsonValue,
    name: string,
    args: readonly unknown[],
    commandId: string,
    actor: ActorOf<Spec> = session.actor,
    at: number = Date.now(),
  ): ProgramCommandResult {
    if (!(resource in app.def.resources)) {
      return { ok: false, error: "unknown_resource" };
    }

    const id = scopeId(resource, key);
    return enqueueStreamWrite(id, async () => {
      try {
        const result = await runAuthorityCommand(
          resource,
          key,
          name,
          args,
          commandId,
          actor,
          at,
          "program",
        );
        const decision = result.record.decision;
        return decision.ok
          ? {
              ok: true,
              cursor: instanceSeqs.get(id) ?? 0,
              events: [...decision.events],
            }
          : { ok: false, error: decision.error, data: decision.data };
      } catch (error) {
        console.error("Program command failed", error);
        throw error;
      }
    });
  }

  const runtimeIds = new Set<string>();
  let restartRuntimeSubscription: (() => void) | undefined;
  for (const [index, program] of (opts.programs ?? []).entries()) {
    claimRuntimeId(program.programId ?? `${String(program.env)}-program-${index + 1}`);
  }

  function startConfiguredProgram<Env extends EnvironmentName<Spec>>(
    programOpts: AppEnvironmentProgram<Spec, Env>,
  ): void {
    const programId =
      programOpts.programId ?? `${String(programOpts.env)}-program-${programRuntimes.length + 1}`;
    const actor = programOpts.actor ?? ({ id: programId } as ActorOf<Spec>);
    const session: SessionData<ActorOf<Spec>> = {
      id: programId,
      actor,
      presence: {},
    };
    const programClient = {
      data: {},
      send() {},
      close() {},
      ping() {},
    };
    wsClients.set(programClient, session);

    let runtime!: ProgramRuntime<Spec>;
    const program = app.def.programs?.[programOpts.env] as AppProgram<Spec, Env> | undefined;
    if (!program) {
      throw new Error(`App has no Program for environment ${JSON.stringify(programOpts.env)}.`);
    }
    runtime = startProgram(app, program, {
      env: programOpts.env,
      deps: programOpts.deps,
      programId,
      actor,
      maxPendingEvents: programOpts.maxPendingEvents,
      progress: createSubstrateProgramProgressStore(substrate, {
        owner: `${serverGeneration}/${programId}`,
        signal: programRuntimeController.signal,
      }),
      signal: programRuntimeController.signal,
      sourcePosition: currentSourcePosition,
      onConsumersChanged: () => restartRuntimeSubscription?.(),
      readViews(resource, key, commandActor = actor) {
        return readProgramViews(resource, key, commandActor) as never;
      },
      command(resource, key, command, args, commandId, commandActor, commandAt) {
        return runInternalCommand(
          programClient,
          session,
          resource,
          key as JsonValue,
          command,
          args,
          commandId,
          commandActor,
          commandAt,
        );
      },
      setPresence(resource, key, value, presenceActor = actor) {
        const id = scopeId(resource, key);
        void loadScope(id, resource, key).then((state) => {
          if (!authorizeResource(app, resource, state, presenceActor, key, { type: "read" }))
            return;
          publishPresence({ ...session, actor: presenceActor }, resource, key, value);
        });
      },
      onError(error) {
        console.error("program error", error);
        queueMicrotask(() => {
          void runtime.restart().then(
            () => restartRuntimeSubscription?.(),
            (restartError) => {
              if (runtime.health().status !== "stopped") {
                console.error("program restart failed", restartError);
              }
            },
          );
        });
      },
    });
    programRuntimes.push(runtime);
  }

  async function currentSourcePosition(): Promise<number> {
    const splits = (await substrate.events.topology()).splits.map(({ id }) => id);
    if (splits.length !== 1 || !splits[0]) {
      throw new Error("This Program executor requires exactly one committed-event split.");
    }
    return cursorPosition((await substrate.events.bounds(splits[0])).highWater);
  }

  function claimRuntimeId(id: string): void {
    if (id.length === 0) throw new TypeError("A Program runtime id cannot be empty.");
    if (runtimeIds.has(id))
      throw new Error(`Program runtime id ${JSON.stringify(id)} is repeated.`);
    runtimeIds.add(id);
  }

  function createRuntimeSubscription(): RuntimeSubscription {
    let controller: AbortController | undefined;
    let stopped = false;
    let cancelRetry: (() => void) | undefined;
    restartRuntimeSubscription = () => {
      cancelRetry?.();
      controller?.abort(new Error("Program consumers changed."));
    };
    const closed = (async () => {
      while (!stopped) {
        try {
          const positions = new Map<ProgramRuntime<Spec>, number>();
          for (const runtime of programRuntimes) {
            positions.set(runtime, await runtime.sourcePosition());
          }
          const earliest = Math.min(...positions.values());
          const after = Number.isFinite(earliest) ? earliest : await currentSourcePosition();
          const splits = (await substrate.events.topology()).splits.map(({ id }) => id);
          if (splits.length !== 1 || !splits[0]) {
            throw new Error("This Program executor requires exactly one committed-event split.");
          }
          const split = splits[0];
          let cursor = sourceCursor(split, String(after));
          controller = new AbortController();
          while (!stopped && !controller.signal.aborted) {
            const read = await substrate.events.read<ResourceCommandRecord<ActorOf<Spec>>>({
              split,
              after: cursor,
              maxRecords: 256,
              maxBytes: 4 * 1024 * 1024,
              signal: controller.signal,
            });
            if (read.status === "cursor-expired") {
              throw new Error("Program source cursor expired before it was processed.");
            }
            for (const { record } of read.records) {
              const events = [...record.decision.events];
              const runtimeEvents = createProgramEvents(
                record.address.resource,
                record.address.key,
                events,
                record.position,
              );
              if (events.length > 0) {
                await loadScope(
                  scopeId(record.address.resource, record.address.key),
                  record.address.resource,
                  record.address.key,
                );
              }
              for (const runtime of programRuntimes) {
                if ((positions.get(runtime) ?? 0) >= record.position) continue;
                if (runtimeEvents.length > 0) await runtime.enqueue(runtimeEvents);
                await runtime.advanceSource(record.position);
                positions.set(runtime, record.position);
              }
            }
            cursor = read.next;
            if (read.caughtUp) await substrate.events.wait(split, cursor, controller.signal);
          }
        } catch (error) {
          if (stopped) break;
          if (controller?.signal.aborted) continue;
          console.error("Program source paused", error);
          await new Promise<void>((resolveRetry) => {
            const timer = setTimeout(resolveRetry, 100);
            cancelRetry = () => {
              clearTimeout(timer);
              resolveRetry();
            };
          });
          cancelRetry = undefined;
        } finally {
          controller = undefined;
        }
      }
    })();
    return {
      closed,
      async stop() {
        if (stopped) return closed;
        stopped = true;
        restartRuntimeSubscription = undefined;
        cancelRetry?.();
        controller?.abort(new Error("Program source stopped."));
        await closed;
      },
    };
  }

  const journalSubscriptionsReady: Promise<RuntimeSubscription[]> = ready.then(
    async () => {
      if (programRuntimes.length === 0) return [];
      return [createRuntimeSubscription()];
    },
    () => [],
  );

  const handleFetch = async (
    req: Request,
    server: Bun.Server<ServerSocketData>,
  ): Promise<Response | undefined> => {
    await ready;
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
      if (server.upgrade(req, { data: { liveReload: true } })) return;
      return new Response("upgrade failed", { status: 500 });
    }
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { app: true, headers: [...req.headers.entries()] } })) {
        return;
      }
      return new Response("upgrade failed", { status: 500 });
    }
    const endpoint = app.def.endpointTable[`${req.method.toUpperCase()} ${url.pathname}`];
    if (endpoint) {
      const authorization = req.headers.get("authorization") ?? "";
      const token = authorization.toLowerCase().startsWith("bearer ")
        ? authorization.slice(7)
        : authorization;
      return endpoint.handle(req, {
        actor: await resolveActor(req.headers, token),
        signal: req.signal,
        dependencies: dependencyGroups[endpoint.owner] ?? Object.freeze({}),
      });
    }
    const route = opts.routes?.[url.pathname];
    if (route instanceof Response) return route;
    if (typeof route === "function") return route(req, server);
    if (web && (url.pathname === "/" || url.pathname === "/index.html")) {
      return renderIndex();
    }
    if (web && url.pathname === webScriptPath) {
      return buildBrowserBundle(req);
    }
    if (web && url.pathname === webStylePath) {
      return buildBrowserStyle(req);
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
          ...Object.fromEntries(
            Object.values(app.def.endpointTable).map((endpoint) => [endpoint.path, handleFetch]),
          ),
          "/": web.html,
          "/index.html": web.html,
          "/ws": handleFetch,
          "/manifest.webmanifest": handleFetch,
          "/service-worker.js": handleFetch,
          "/_poggers/icon.svg": handleFetch,
          [liveReloadPath]: handleFetch,
          [liveReloadPollPath]: handleFetch,
          "/*": web.html,
        } as Bun.Serve.RoutesWithUpgrade<ServerSocketData, string>);

  const server = Bun.serve<ServerSocketData, string>({
    port,
    development: web?.development,
    routes: htmlRoutes,
    fetch: handleFetch,
    websocket: {
      maxPayloadLength: limits.messageBytes,
      backpressureLimit: limits.outboundBytes,
      closeOnBackpressureLimit: true,
      async open(ws) {
        if (ws.data.liveReload) {
          liveReloadClients.add(ws);
          ws.send(JSON.stringify({ type: "connected", version: liveReloadVersion }));
          return;
        }
        if (!ws.data.app) return;
      },
      close(ws) {
        if (ws.data.liveReload) {
          liveReloadClients.delete(ws);
          return;
        }
        if (!ws.data.app) return;
        evictClient(ws);
      },
      async message(ws, data) {
        if (ws.data.liveReload) return;
        if (!ws.data.app) return;
        const socketData = ws.data;
        const queuedMessages = socketData.queuedMessages ?? 0;
        const messageBytes = Buffer.byteLength(data);
        const queuedBytes = socketData.queuedBytes ?? 0;
        if (
          queuedMessages >= limits.queuedMessages ||
          queuedBytes + messageBytes > limits.inboundBytes
        ) {
          ws.close(1013, "client is sending too quickly");
          return;
        }
        socketData.queuedMessages = queuedMessages + 1;
        socketData.queuedBytes = queuedBytes + messageBytes;
        const previousMessage = socketData.messageQueue ?? Promise.resolve();
        let completeMessage!: () => void;
        socketData.messageQueue = new Promise<void>((resolveMessage) => {
          completeMessage = resolveMessage;
        });
        await previousMessage;
        try {
          await ready;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data as string);
          } catch {
            ws.close(1007, "invalid JSON");
            return;
          }
          if (
            protocolCandidates(parsed).some(
              (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                (candidate as { type?: unknown }).type === "connect" &&
                (candidate as { version?: unknown }).version !== protocolVersion,
            )
          ) {
            return ws.close(4002, "unsupported protocol");
          }
          const message = validateClientMessage(parsed);
          if (!message) return;
          const operations = message.type === "batch" ? message.operations : [message];
          const responses: ServerOperation[] = [];
          const respond = (response: ServerOperation): void => {
            if (message.type === "batch") responses.push(response);
            else safeSendOperations(ws, [response]);
          };

          operationLoop: for (const msg of operations) {
            if (msg.type === "connect") {
              const token = typeof msg.token === "string" ? msg.token : "";
              (ws.data as { token?: string }).token = token;
              const credential = socketCredential(ws);
              const actor = await resolveActor(credential.headers, credential.token);
              if (!actor) return ws.close(4001, "unauthorized");

              const session: SessionData<ActorOf<Spec>> = {
                id: `${actor.id}-${crypto.randomUUID().slice(0, 9)}`,
                actor,
                presence: {},
              };
              wsClients.set(ws, session);

              respond({
                type: "init",
                version: protocolVersion,
                session,
              });
              continue operationLoop;
            }

            if (authentication) {
              const session = wsClients.get(ws);
              if (!session) return ws.close(4001, "unauthorized");
              const credential = socketCredential(ws);
              const actor = await resolveActor(credential.headers, credential.token);
              if (!actor || actor.id !== session.actor.id) {
                return ws.close(4001, "session changed");
              }
              wsClients.set(ws, { ...session, actor });
            }

            if (msg.type === "receipt") {
              const session = wsClients.get(ws);
              if (!session) continue operationLoop;
              if (!(msg.resource in app.def.resources)) continue operationLoop;
              if ((app.def.resources[msg.resource]?.policy ?? "sync") !== "sync")
                continue operationLoop;
              try {
                assertResourceKey(app, msg.resource, msg.key);
              } catch {
                return ws.close(1008, "invalid Resource key");
              }
              const address = { resource: msg.resource, key: msg.key } satisfies ResourceAddress;
              const id = scopeId(msg.resource, msg.key);
              const state = await loadScope(id, msg.resource, msg.key);
              if (
                !authorizeResource(app, msg.resource, state, session.actor, msg.key, {
                  type: "read",
                })
              ) {
                respond({ type: "forbidden", resource: msg.resource, key: msg.key });
                continue operationLoop;
              }
              const receipt = await substrate.authority.receipt<
                ResourceCommandRecord<ActorOf<Spec>>
              >(address, msg.commandId);
              if (!receipt) {
                respond({
                  type: "commandAck",
                  commandId: msg.commandId,
                  known: false,
                  ok: false,
                });
                continue operationLoop;
              }
              const decision = receipt.decision;
              respond({
                type: "commandAck",
                commandId: msg.commandId,
                known: true,
                ok: decision.ok,
                cursor: instanceSeqs.get(id) ?? 0,
                events: decision.events.length > 0 ? [...decision.events] : undefined,
                ...(!decision.ok ? { error: decision.error, data: decision.data } : {}),
              });
              continue operationLoop;
            }

            if (msg.type === "subscribe") {
              const session = wsClients.get(ws);
              if (!session) continue operationLoop;
              if (typeof msg.resource !== "string") continue operationLoop;
              if (!(msg.resource in app.def.resources)) continue operationLoop;
              if ((app.def.resources[msg.resource]?.policy ?? "sync") !== "sync")
                continue operationLoop;
              const cursor = typeof msg.cursor === "number" ? msg.cursor : 0;

              const key = msg.key as JsonValue;
              try {
                assertResourceKey(app, msg.resource, key);
              } catch {
                return ws.close(1008, "invalid Resource key");
              }

              const id = scopeId(msg.resource, key);
              const state = await loadScope(id, msg.resource, key);
              if (
                !authorizeResource(app, msg.resource, state, session.actor, key, { type: "read" })
              ) {
                unsubscribe(ws, id, session.id);
                respond({ type: "forbidden", resource: msg.resource, key });
                continue operationLoop;
              }
              subscribe(ws, msg.resource, key);
              enterPresence(ws, session, msg.resource, key);
              const sync = computeSync(
                msg.resource,
                msg.key,
                cursor,
                eventBuffers,
                states,
                instanceSeqs,
                app,
                serverGeneration,
              );

              respond({
                type: "synced",
                resource: msg.resource,
                key,
                snapshot: sync.snapshot,
                events: sync.events,
                sessions: [...(scopePresence.get(id)?.values() ?? [])],
                cursor: sync.cursor,
                generation: serverGeneration,
              });
              continue operationLoop;
            }

            if (msg.type === "presence") {
              const session = wsClients.get(ws);
              if (!session || !(msg.resource in app.def.resources)) continue operationLoop;
              const definition = app.def.resources[msg.resource];
              if (!Object.prototype.hasOwnProperty.call(definition, "presence")) {
                continue operationLoop;
              }
              const id = scopeId(msg.resource, msg.key);
              if (!clientSubscriptions.get(ws)?.has(id)) continue operationLoop;
              const state = await loadScope(id, msg.resource, msg.key);
              if (
                !authorizeResource(app, msg.resource, state, session.actor, msg.key, {
                  type: "read",
                })
              ) {
                unsubscribe(ws, id, session.id);
                respond({ type: "forbidden", resource: msg.resource, key: msg.key });
                continue operationLoop;
              }
              publishPresence(session, msg.resource, msg.key, msg.value, ws);
              continue operationLoop;
            }

            if (msg.type === "command") {
              const session = wsClients.get(ws);
              if (!session) continue operationLoop;
              if (typeof msg.resource !== "string" || typeof msg.name !== "string")
                continue operationLoop;
              if (!(msg.resource in app.def.resources)) continue operationLoop;
              if ((app.def.resources[msg.resource]?.policy ?? "sync") !== "sync")
                continue operationLoop;
              const args: unknown[] = Array.isArray(msg.args) ? msg.args : [];
              const key = msg.key as JsonValue;
              const commandId: string = msg.commandId as string;
              try {
                assertResourceKey(app, msg.resource, key);
                assertResourceCommand(app, msg.resource, msg.name, args);
              } catch {
                respond({
                  type: "commandAck",
                  commandId,
                  ok: false,
                  error: "invalid_input",
                });
                continue operationLoop;
              }

              const id = scopeId(msg.resource, key);
              void enqueueStreamWrite(id, async () => {
                const result = await runAuthorityCommand(
                  msg.resource,
                  key,
                  msg.name,
                  args,
                  commandId,
                  session.actor,
                  msg.at,
                );
                const decision = result.record.decision;
                safeSend(
                  ws,
                  JSON.stringify({
                    type: "commandAck",
                    commandId,
                    ok: decision.ok,
                    cursor: instanceSeqs.get(id) ?? 0,
                    events: decision.events.length > 0 ? [...decision.events] : undefined,
                    ...(!decision.ok ? { error: decision.error, data: decision.data } : {}),
                  } satisfies ServerMessage),
                );
              }).catch((error) => {
                if (error instanceof IntentMismatchError) {
                  safeSend(
                    ws,
                    JSON.stringify({
                      type: "commandAck",
                      commandId,
                      ok: false,
                      error: "intent_mismatch",
                    } satisfies ServerMessage),
                  );
                  return;
                }
                ws.close(error instanceof ServerOverloadError ? 1013 : 1011, "command unavailable");
              });
              continue operationLoop;
            }
          }
          safeSendOperations(ws, responses);
        } catch (e) {
          console.error("server message error", e);
          ws.close(e instanceof ServerOverloadError ? 1013 : 1011, "server operation failed");
        } finally {
          socketData.queuedMessages = Math.max(0, (socketData.queuedMessages ?? 1) - 1);
          socketData.queuedBytes = Math.max(
            0,
            (socketData.queuedBytes ?? messageBytes) - messageBytes,
          );
          completeMessage();
        }
      },
    },
  });

  function trimBuffer(key: string) {
    const buf = eventBuffers.get(key);
    if (buf && buf.length > limits.replayEvents) {
      eventBuffers.set(key, buf.slice(-limits.replayEvents));
    }
  }

  async function runSnapshotCycle() {
    try {
      const scopesToSnapshot = new Set([...dirtyScopes, ...failedSnapshotScopes]);
      for (const id of scopesToSnapshot) {
        const s = states.get(id);
        const address = resourceAddresses.get(id);
        const head = resourceHeads.get(id);
        if (s === undefined || !address || !head) continue;
        const seq = instanceSeqs.get(id) ?? 0;
        try {
          const state = app.snapshot(s, seq);
          await substrate.authority.saveSnapshot({
            address,
            revision: head.revision,
            position: head.position,
            schema: app.def.migrationHash ?? `version:${app.def.version}`,
            stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
            state,
            storedAt: Date.now(),
          });
          const currentHead = resourceHeads.get(id);
          snapshotHeads.set(id, head);
          if (currentHead?.revision === head.revision && currentHead.position === head.position) {
            dirtyScopes.delete(id);
          }
          failedSnapshotScopes.delete(id);
          trimBuffer(id);
        } catch (error) {
          console.error(`Snapshot failed for ${id}`, error);
          failedSnapshotScopes.add(id);
        }
      }
    } catch (e) {
      console.error("server snapshot error", e);
    }
  }

  function needsBudgetSnapshot(id: string): boolean {
    return (
      (resourceHeads.get(id)?.revision ?? 0) - (snapshotHeads.get(id)?.revision ?? 0) >=
      snapshotRecords
    );
  }

  function scheduleSnapshotCycle(): void {
    if (stopping || snapshotCycle) return;
    snapshotCycle = runSnapshotCycle().finally(() => {
      snapshotCycle = null;
      if (!stopping && [...dirtyScopes].some(needsBudgetSnapshot)) scheduleSnapshotCycle();
    });
  }

  const snapshotInterval = setInterval(() => {
    scheduleSnapshotCycle();
  }, snapshotIntervalMs);

  startLiveReload();

  void ready
    .then(() => console.log(`poggers server running on ws://localhost:${server.port}`))
    .catch(() => {});

  const keepaliveInterval = setInterval(() => {
    for (const [ws] of wsClients) {
      try {
        ws.ping();
      } catch {}
    }
  }, PING_INTERVAL_MS);

  let stopPromise: Promise<void> | undefined;
  return {
    url: server.url,
    ready,
    stop: () => {
      if (stopPromise) return stopPromise;
      stopping = true;
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
      server.stop();
      stopPromise = (async () => {
        programRuntimeController.abort(new Error("Server stopped."));
        const journalSubscriptions = await journalSubscriptionsReady.catch(() => []);
        await settleShutdown(journalSubscriptions.map((subscription) => subscription.stop()));
        await settleShutdown(programRuntimes.map((runtime) => runtime.stop()));

        while (streamWriters.size > 0) {
          await settleShutdown([...streamWriters.values()]);
        }

        if (snapshotCycle) await settleShutdown([snapshotCycle]);
        await settleShutdown([runSnapshotCycle()]);
        await settleShutdown([
          ...(opts.programs ?? []).map((program) => program.disposeDependencies?.()),
          opts.disposeDependencies?.(),
        ]);
      })();
      return stopPromise;
    },
  };
}

function runtimeApplicationManifest(
  entries: readonly RuntimeProgramManifestEntry[],
): ApplicationManifest {
  const paths = [...new Set(entries.map(({ path }) => path))].sort();
  return {
    format: 1,
    contract: { hash: "runtime-unknown", nodes: [], resources: {} },
    scopes: paths.map((path) => ({
      path,
      resources: [],
      components: [],
      features: [],
      programs: entries
        .filter((entry) => entry.path === path)
        .map(({ id: _id, path: _path, ...program }) => program),
      dependencies: [],
      navigation: [],
      endpoints: [],
      api: [],
    })),
    presets: [],
  };
}

class ServerOverloadError extends Error {}

function cursorPosition(cursor: SourceCursor): number {
  const value = Number(cursor.value);
  if (!Number.isSafeInteger(value) || value < 0 || String(value) !== cursor.value) {
    throw new Error("The current Program executor requires numeric source cursors.");
  }
  return value;
}

function assertServerLimits(limits: ServerLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    const allowsZero = name === "eventsPerDecision";
    if (!Number.isSafeInteger(value) || value < (allowsZero ? 0 : 1)) {
      throw new RangeError(
        `Server limit ${name} must be a ${allowsZero ? "non-negative" : "positive"} integer.`,
      );
    }
  }
  if (limits.eventsPerDecision > maxProtocolBatch) {
    throw new RangeError(
      `Server limit eventsPerDecision cannot exceed the protocol batch bound ${maxProtocolBatch}.`,
    );
  }
  if (limits.replayEvents > maxProtocolBatch) {
    throw new RangeError(
      `Server limit replayEvents cannot exceed the protocol batch bound ${maxProtocolBatch}.`,
    );
  }
}

function protocolCandidates(value: unknown): readonly unknown[] {
  if (!value || typeof value !== "object") return [value];
  const record = value as { readonly type?: unknown; readonly operations?: unknown };
  return record.type === "batch" && Array.isArray(record.operations) ? record.operations : [value];
}

async function settleShutdown(tasks: readonly (void | Promise<void>)[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === "rejected") console.error("runtime shutdown error", result.reason);
  }
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
      rel.startsWith(".poggers-") ||
      rel.startsWith(".poggers/") ||
      rel.startsWith("dist/") ||
      rel.startsWith("node_modules/") ||
      rel.startsWith("coverage/") ||
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

type ErasedAppEnvironmentProgram<Spec extends AppSpec> = AppEnvironmentProgram<
  Spec,
  EnvironmentName<Spec>
>;

export type ServeAppOpts<Spec extends AppSpec> = Omit<ServeOpts<Spec>, "web" | "programs"> & {
  api: App<Spec>;
  entrypoint: string | URL;
  styles?: string;
  styleFiles?: string[];
  plugins?: Bun.BunPlugin[];
  html?: Bun.HTMLBundle;
  development?: Bun.Serve.Development;
  title?: string;
  bundle?: string;
  styleBundle?: string;
  assetDir?: string;
  liveReload?: WebLiveReloadOpts;
  program?: ErasedAppEnvironmentProgram<Spec>;
  dependencyGroups?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  disposeDependencies?: () => Promise<void>;
};

export function serveApp<Spec extends AppSpec>({
  api,
  entrypoint,
  styles,
  styleFiles,
  plugins,
  html,
  development,
  assetDir,
  title,
  bundle,
  styleBundle,
  liveReload,
  program,
  dependencyGroups,
  disposeDependencies,
  ...serveOpts
}: ServeAppOpts<Spec>): ServerHandle {
  return serve(api, {
    ...serveOpts,
    dependencyGroups:
      dependencyGroups ??
      (program?.deps as Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined),
    disposeDependencies,
    web: {
      bundle,
      styleBundle,
      entrypoint,
      html,
      styles,
      styleFiles,
      plugins,
      assetDir,
      title,
      development,
      liveReload,
    },
    programs: program ? [program as unknown as AnyServeProgramOpts<Spec>] : undefined,
  });
}

export function createRuntimeSubstrate(
  file: string,
  durability: DurabilityProfile = defaultDurabilityProfile,
) {
  return createSqliteSubstrate({
    file,
    durability: durability === "power-safe" ? "strict" : "process",
  });
}

export { defineApp, installAppMigrations } from "#kernel/app";
export { startDependencyGroups } from "#kernel/dependency";
export { parseDurabilityProfile } from "#substrate/durability";
export { verifyResources } from "#substrate/resource";
