import type { ActorOf, App, AppSpec, EnvironmentDeps, EnvironmentName } from "./app";
import { type ServeOpts, type ServerHandle, type WebLiveReloadOpts } from "./server";
import type { AppProgram, WorkerDef, WorkerDurabilityStore } from "./worker";
export type AppWorker<Spec extends AppSpec, Deps> = {
  worker: WorkerDef<Spec, Deps>;
  deps: Deps;
  workerId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
};
export type AppEnvironmentProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  env: Env;
  program: AppProgram<Spec, Env>;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
};
export type ServeAppOpts<Spec extends AppSpec, Deps = never> = Omit<
  ServeOpts<Spec>,
  "web" | "workers" | "programs"
> & {
  api: App<Spec>;
  ui: string | URL;
  styles?: string;
  plugins?: Bun.BunPlugin[];
  html?: any;
  development?: Bun.Serve.Development;
  title?: string;
  bundle?: string;
  styleBundle?: string;
  assetDir?: string;
  liveReload?: WebLiveReloadOpts;
  worker?: AppWorker<Spec, Deps>;
  program?: AppEnvironmentProgram<Spec, any>;
};
export declare function serveApp<Spec extends AppSpec, Deps = never>({
  api,
  ui,
  styles,
  plugins,
  html,
  development,
  assetDir,
  title,
  bundle,
  styleBundle,
  liveReload,
  worker,
  program,
  ...serveOpts
}: ServeAppOpts<Spec, Deps>): ServerHandle;
export type AppPaths = {
  appDir: string;
  sourceDir: string;
  api: string;
  ui: string;
  types?: string;
  embedded: boolean;
  styles?: string;
  styleSource?: string;
  worker?: string;
  deps?: string;
};
export type LoadedApp<Spec extends AppSpec = AppSpec> = {
  paths: AppPaths;
  api: App<Spec>;
  worker?: AppWorker<Spec, unknown>;
  program?: AppEnvironmentProgram<Spec, any>;
};
export type RunAppOpts = {
  appDir: string;
  port?: number;
  title?: string;
  snapshotIntervalMs?: number;
  liveReload?: boolean;
};
export type BundleAppOpts = {
  appDir: string;
  outdir?: string;
  minify?: boolean;
};
export type BuildAppOpts = {
  appDir: string;
  outfile: string;
  title?: string;
  minify?: boolean;
};
export type AppConventionIssue = {
  file: string;
  message: string;
};
export declare function resolveApp(appDir: string): AppPaths;
export declare function loadApp<Spec extends AppSpec = AppSpec>(
  appDir: string,
): Promise<LoadedApp<Spec>>;
export declare function runApp(opts: RunAppOpts): Promise<ServerHandle>;
export declare function bundleApp(opts: BundleAppOpts): Promise<void>;
export declare function buildApp(opts: BuildAppOpts): Promise<void>;
export declare function writeAppTypes(appDir: string): Promise<string | undefined>;
export declare function checkAppConventions(appDir: string): AppConventionIssue[];
