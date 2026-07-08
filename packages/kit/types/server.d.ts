import type { ActorOf, App, AppSpec, EnvironmentDeps, EnvironmentName } from "./app";
import type { JsonValue, Snapshot } from "./protocol";
import { type Store } from "./storage";
import { type AppProgram, type WorkerDef, type WorkerDurabilityStore } from "./worker";
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
export declare function computeSync(
  resource: string,
  key: JsonValue,
  cursor: number,
  storage: Store,
  eventBuffers: Map<string, unknown[]>,
  states: Map<string, any>,
  instanceSeqs: Map<string, number>,
  app: App<any>,
  generation: string,
): {
  snapshot?: Snapshot;
  events?: unknown[];
  cursor: number;
};
export declare function serve<Spec extends AppSpec>(
  app: App<Spec>,
  opts?: ServeOpts<Spec>,
): ServerHandle;
