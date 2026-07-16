import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRuntimeSubstrate,
  serveApp,
  type AppEnvironmentProgram,
  type ServerHandle,
} from "#host/server";
import {
  defineApp,
  installAppMigrations,
  type ActorOf,
  type App,
  type AppDef,
  type AppSpec,
  type EnvironmentDeps,
  type EnvironmentName,
  type RuntimeMigrationEdge,
} from "#kernel/app";
import { startDependencyGroups } from "#kernel/dependency";
import type { ApplicationManifest } from "#kernel/manifest";
import { defaultDurabilityProfile, type DurabilityProfile } from "#substrate/durability";
import {
  analyzeAppContract,
  analyzeAppContractConventions,
  analyzeAppDefinition,
  transformComponentSource,
  type CompiledAppSurface,
} from "#ui/compiler/application";
import {
  analyzeVisualContract,
  analyzeVisualPresetSources,
  bundleVisualFontAssets,
  materializeVisualPreset,
} from "#ui/compiler/preset";
import { generateVisualStylexModule } from "#ui/compiler/stylex";

export { startDependencies, startDependencyGroups } from "#kernel/dependency";

export { installAppMigrations };
export type { RuntimeMigrationEdge };

type AnyAppEnvironmentProgram<Spec extends AppSpec> = AppEnvironmentProgram<
  Spec,
  EnvironmentName<Spec>
>;

type AppModule = Readonly<
  Record<string, unknown> & {
    api?: unknown;
    default?: unknown;
    programId?: unknown;
    programActor?: unknown;
  }
>;

export type AppPaths = {
  appDir: string;
  sourceDir: string;
  app: string;
};

type BrowserEntrypoint = {
  entrypoint: string;
  styles?: string;
  styleFiles?: string[];
  plugins: Bun.BunPlugin[];
  html?: Bun.HTMLBundle;
  development?: Bun.Serve.Development;
};

export type LoadedApp<Spec extends AppSpec = AppSpec> = {
  paths: AppPaths;
  api: App<Spec>;
  manifest: ApplicationManifest;
  program?: AnyAppEnvironmentProgram<Spec>;
  dependencyGroups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  disposeDependencies?: () => Promise<void>;
};

export type RunAppOpts = {
  appDir: string;
  port?: number;
  title?: string;
  durability?: DurabilityProfile;
  snapshotIntervalMs?: number;
  snapshotRecords?: number;
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

export type MigrationSnapshotResult = {
  hash: string;
  path: string;
  created: boolean;
};

export type MigrationCreateResult =
  | {
      kind: "initial";
      snapshot: MigrationSnapshotResult;
    }
  | {
      kind: "unchanged";
      snapshot: MigrationSnapshotResult;
    }
  | {
      kind: "created";
      fromHash: string;
      toHash: string;
      snapshot: MigrationSnapshotResult;
      path: string;
    }
  | {
      kind: "exists";
      fromHash: string;
      toHash: string;
      snapshot: MigrationSnapshotResult;
      path: string;
    };

const poggersJsx = {
  runtime: "automatic",
  importSource: "@poggers/kit",
} as const;
const runtimeModuleDir = dirname(fileURLToPath(import.meta.url));
const kitSourceDir = resolve(runtimeModuleDir, "..");
const alienSignalsEntrypoint = firstExisting([
  resolve(kitSourceDir, "../node_modules/alien-signals/esm/index.mjs"),
  resolve(kitSourceDir, "../../node_modules/alien-signals/esm/index.mjs"),
]);

export function resolveApp(appDir: string): AppPaths {
  const resolvedAppDir = resolve(appDir);
  const app = firstExisting([
    resolve(resolvedAppDir, "src/app.tsx"),
    resolve(resolvedAppDir, "src/app.ts"),
  ]);
  const sourceDir = resolve(resolvedAppDir, "src");
  if (!app) {
    throw new Error(`App is missing canonical src/app.tsx in ${resolvedAppDir}.`);
  }

  return {
    appDir: resolvedAppDir,
    sourceDir,
    app,
  };
}

export async function loadApp<Spec extends AppSpec = AppSpec>(
  appDir: string,
): Promise<LoadedApp<Spec>> {
  const paths = resolveApp(appDir);
  assertCanonicalApp(paths);
  const apiModule = await importBuiltAppModule(paths);
  const api = normalizeLoadedApp<Spec>(apiModule);

  if (!api?.def?.resources) {
    throw new Error(`App module must export a Poggers app from ${paths.app}.`);
  }

  installAppMigrations(api, await loadMigrationRegistry(paths));

  const env = selectRuntimeEnv(api);
  const mounted = await loadDependencies(api, env, paths);
  const program = loadProgram(
    api,
    apiModule,
    env,
    paths.appDir,
    mounted.groups as EnvironmentDeps<Spec, typeof env>,
    mounted.stop,
  );

  return {
    paths,
    api,
    manifest: collectAppSurface(paths).manifest,
    program,
    dependencyGroups: mounted.groups,
    disposeDependencies: program ? undefined : mounted.stop,
  };
}

function normalizeLoadedApp<Spec extends AppSpec>(module: AppModule): App<Spec> | undefined {
  const candidate = module.api ?? module.default;
  if (!candidate) return undefined;
  if (recordValue(recordValue(candidate).def).resources) return candidate as App<Spec>;
  return defineApp(candidate as AppDef<Spec>);
}

export async function runApp(opts: RunAppOpts): Promise<ServerHandle> {
  const loaded = await loadApp(opts.appDir);
  const title = opts.title ?? loaded.api.def.app?.name ?? loaded.api.def.pwa?.name;
  const browserBuildDir = frameworkDevDir(loaded.paths, `server-${opts.port ?? 3000}`);
  const browser = await writeBrowserEntrypoint(loaded.paths, {
    buildDir: browserBuildDir,
    dev: opts.liveReload !== false,
    title,
  });

  const dataDir = resolve(loaded.paths.appDir, ".poggers/data");
  await mkdir(dataDir, { recursive: true });
  const substrate = createRuntimeSubstrate(
    resolve(dataDir, "journal.sqlite"),
    opts.durability ?? defaultDurabilityProfile,
  );
  try {
    const handle = serveApp({
      api: loaded.api,
      entrypoint: browser.entrypoint,
      html: browser.html,
      styles: browser.styles,
      styleFiles: browser.styleFiles,
      plugins: browser.plugins,
      development: browser.development,
      title: opts.title,
      port: opts.port,
      substrate,
      manifest: loaded.manifest,
      snapshotIntervalMs: opts.snapshotIntervalMs,
      snapshotRecords: opts.snapshotRecords,
      assetDir: loaded.paths.appDir,
      liveReload:
        opts.liveReload === false
          ? undefined
          : {
              watchDir: loaded.paths.appDir,
              async onChange(changedPath) {
                await writeChangedDevArtifacts(loaded.paths, changedPath, browserBuildDir);
              },
            },
      program: loaded.program,
      dependencyGroups: loaded.dependencyGroups,
      disposeDependencies: loaded.disposeDependencies,
    });
    return ownSubstrate(handle, substrate);
  } catch (error) {
    await substrate.close();
    throw error;
  }
}

function ownSubstrate(handle: ServerHandle, substrate: { close(): Promise<void> }): ServerHandle {
  let stopping: Promise<void> | undefined;
  return {
    url: handle.url,
    ready: handle.ready,
    stop() {
      stopping ??= handle.stop().finally(() => substrate.close());
      return stopping;
    },
  };
}

export async function bundleApp(opts: BundleAppOpts): Promise<void> {
  const paths = resolveApp(opts.appDir);
  assertCanonicalApp(paths);
  const browser = await writeBrowserEntrypoint(paths);
  const outdir = opts.outdir ?? resolve(paths.appDir, ".poggers/build/web");
  const result = await Bun.build({
    define: { __POGGERS_BROWSER__: "true", __POGGERS_HMR__: "false" },
    entrypoints: [browser.entrypoint],
    format: "esm",
    jsx: poggersJsx,
    minify: opts.minify ?? true,
    outdir,
    plugins: browser.plugins,
    target: "browser",
  });

  if (!result.success) {
    throw new Error(result.logs.map(String).join("\n"));
  }

  await appendStyleFilesToBuildOutput(
    result.outputs,
    browser.styleFiles,
    resolve(outdir, "browser.entry.css"),
  );
}

export async function buildApp(opts: BuildAppOpts): Promise<void> {
  const paths = resolveApp(opts.appDir);
  assertCanonicalApp(paths);
  const browser = await writeBrowserEntrypoint(paths);
  const browserBuild = await Bun.build({
    define: { __POGGERS_BROWSER__: "true", __POGGERS_HMR__: "false" },
    entrypoints: [browser.entrypoint],
    format: "esm",
    jsx: poggersJsx,
    minify: opts.minify ?? true,
    plugins: browser.plugins,
    target: "browser",
  });

  if (!browserBuild.success) {
    throw new Error(browserBuild.logs.map(String).join("\n"));
  }

  const { script: browserBundle, style: browserStyle } = await readBuildOutputs(
    browserBuild.outputs,
    browser.styleFiles,
  );
  if (!browserBundle) throw new Error("Browser bundle produced no output.");

  const buildDir = frameworkBuildDir(paths);
  const serverAppStub = await writeServerAppStubFile(paths, buildDir);
  const serverAppSource = await writeServerAppEntrypoint(paths, buildDir, serverAppStub, {
    stripStyles: true,
  });
  const appEntrypoint = await writeBuiltAppModule(
    serverAppSource,
    resolve(buildDir, "app.generated.js"),
    [createPoggersAppAliasesPlugin(paths), createPoggersServerAppStubPlugin(paths)],
  );
  const migrationRegistry = await writeMigrationRegistry(paths, buildDir);
  const serverEntrypoint = resolve(buildDir, "server.generated.ts");
  await mkdir(buildDir, { recursive: true });
  await mkdir(dirname(resolve(opts.outfile)), { recursive: true });
  await writeGeneratedFile(
    serverEntrypoint,
    serverEntrypointSource(
      paths,
      serverEntrypoint,
      appEntrypoint,
      browser.entrypoint,
      browserBundle,
      browserStyle,
      migrationRegistry,
      opts.title,
    ),
  );

  const executable = await Bun.build({
    entrypoints: [serverEntrypoint],
    target: "bun",
    compile: { outfile: resolve(opts.outfile) },
  });
  if (!executable.success) throw new Error(executable.logs.map(String).join("\n"));
}

export async function writeMigrationSnapshot(appDir: string): Promise<MigrationSnapshotResult> {
  const paths = resolveApp(appDir);
  const appSource = await readFile(paths.app, "utf8");
  const hash = await currentStructuralHash(paths);
  const snapshotsDir = resolve(paths.sourceDir, "migrations/snapshots");
  const snapshotPath = resolve(snapshotsDir, `${hash}.ts`);
  const created = !existsSync(snapshotPath);

  if (created) {
    await mkdir(snapshotsDir, { recursive: true });
    await writeFile(
      snapshotPath,
      `export const hash = ${JSON.stringify(hash)};\n\n${appSource.trimEnd()}\n`,
      "utf8",
    );
  }

  return { hash, path: snapshotPath, created };
}

async function loadMigrationRegistry(paths: AppPaths): Promise<{
  hash?: string;
  migrations: RuntimeMigrationEdge[];
  contract: CompiledAppSurface["manifest"]["contract"];
}> {
  const contract = collectAppSurface(paths).manifest.contract;
  const hash = contract.hash;
  const migrations: RuntimeMigrationEdge[] = [];

  for (const file of await migrationEdgeFiles(paths.sourceDir)) {
    const module = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const edge = module.default ?? module.migration;
    if (edge) migrations.push(edge as RuntimeMigrationEdge);
  }

  return { hash, migrations, contract };
}

async function writeMigrationRegistry(paths: AppPaths, buildDir: string): Promise<string> {
  const output = resolve(buildDir, "migrations.generated.ts");
  const contract = collectAppSurface(paths).manifest.contract;
  const hash = contract.hash;
  const files = await migrationEdgeFiles(paths.sourceDir);
  const imports = files
    .map(
      (file, index) =>
        `import migration${index} from ${JSON.stringify(importSpecifier(output, file))};`,
    )
    .join("\n");
  const migrations = files.map((_, index) => `migration${index}`).join(", ");

  await mkdir(dirname(output), { recursive: true });
  await writeGeneratedFile(
    output,
    `${imports}${imports ? "\n\n" : ""}export const hash = ${hash === undefined ? "undefined" : JSON.stringify(hash)};
export const migrations = [${migrations}];
export const contract = ${JSON.stringify(contract)};
`,
  );

  return output;
}

async function currentStructuralHash(paths: AppPaths): Promise<string> {
  return collectAppSurface(paths).manifest.contract.hash;
}

async function migrationEdgeFiles(sourceDir: string): Promise<string[]> {
  const migrationsDir = resolve(sourceDir, "migrations");
  if (!existsSync(migrationsDir)) return [];

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.[cm]?tsx?$/.test(entry.name))
    .map((entry) => resolve(migrationsDir, entry.name))
    .sort();
}

export async function createMigration(
  appDir: string,
  name: string,
): Promise<MigrationCreateResult> {
  const paths = resolveApp(appDir);
  const previous = await latestMigrationSnapshot(paths.sourceDir);
  const snapshot = await writeMigrationSnapshot(appDir);

  if (!previous) return { kind: "initial", snapshot };
  if (previous.hash === snapshot.hash) return { kind: "unchanged", snapshot };

  const migrationName = `${new Date().toISOString().slice(0, 10)}-${slugifyMigrationName(name)}-${previous.hash}-${snapshot.hash}.ts`;
  const migrationPath = resolve(paths.sourceDir, "migrations", migrationName);

  if (existsSync(migrationPath)) {
    return {
      kind: "exists",
      fromHash: previous.hash,
      toHash: snapshot.hash,
      snapshot,
      path: migrationPath,
    };
  }

  await mkdir(dirname(migrationPath), { recursive: true });
  await writeFile(
    migrationPath,
    `import type { Migration } from "@poggers/kit";
import type { App as From } from "./snapshots/${previous.hash}";
import type { App as To } from "./snapshots/${snapshot.hash}";

export default {
  draft: true,
  from: ${JSON.stringify(previous.hash)},
  to: ${JSON.stringify(snapshot.hash)},
  migrate: {},
} satisfies Migration<From, To>;
`,
    "utf8",
  );

  return {
    kind: "created",
    fromHash: previous.hash,
    toHash: snapshot.hash,
    snapshot,
    path: migrationPath,
  };
}

async function latestMigrationSnapshot(
  sourceDir: string,
): Promise<{ hash: string; path: string } | undefined> {
  const snapshotsDir = resolve(sourceDir, "migrations/snapshots");
  if (!existsSync(snapshotsDir)) return undefined;

  const snapshots: Array<{ hash: string; path: string; mtimeMs: number }> = [];
  for (const entry of await readdir(snapshotsDir)) {
    const hash = /^([a-f0-9]{12})\.ts$/.exec(entry)?.[1];
    if (!hash) continue;
    const path = resolve(snapshotsDir, entry);
    const info = await stat(path);
    snapshots.push({ hash, path, mtimeMs: info.mtimeMs });
  }

  snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs || b.hash.localeCompare(a.hash));
  return snapshots[0];
}

function slugifyMigrationName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "migration"
  );
}

export function checkAppConventions(appDir: string): AppConventionIssue[] {
  const paths = resolveApp(appDir);
  const canonical = resolve(paths.sourceDir, "app.tsx");
  if (paths.app !== canonical) {
    return [{ file: paths.app, message: "Poggers applications must use src/app.tsx." }];
  }
  const surface = collectAppSurface(paths);
  return [
    ...analyzeAppContractConventions(paths.app, surface),
    ...analyzeAppDefinition(paths.app, surface),
  ];
}

function assertCanonicalApp(paths: AppPaths) {
  if (paths.app === resolve(paths.sourceDir, "app.tsx")) return;
  throw new Error("Poggers applications must use src/app.tsx.");
}

function loadProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  api: App<Spec>,
  apiModule: AppModule,
  env: Env,
  appDir: string,
  deps: EnvironmentDeps<Spec, Env>,
  disposeDependencies: () => Promise<void>,
): AppEnvironmentProgram<Spec, Env> | undefined {
  const program = api.def.programs?.[env];
  if (!program) return undefined;
  const envName = String(env);

  return {
    env,
    deps,
    disposeDependencies,
    programId:
      typeof apiModule.programId === "string"
        ? apiModule.programId
        : `${titleFromDir(appDir)}-${envName}`,
    actor: apiModule.programActor as ActorOf<Spec> | undefined,
  };
}

async function loadDependencies<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  api: App<Spec>,
  env: Env,
  paths: AppPaths,
) {
  return startDependencyGroups(api.def.dependencyGroups[String(env)] ?? {}, {
    data: {
      path: resolve(paths.appDir, ".poggers/data/dependencies"),
      namespace: "poggers",
      name: titleFromDir(paths.appDir),
    },
  });
}

function selectRuntimeEnv<Spec extends AppSpec>(api: App<Spec>): EnvironmentName<Spec> {
  const programs = api.def.programs ?? {};
  if (
    "server" in programs ||
    "server" in api.def.dependencyGroups ||
    Object.keys(api.def.endpointTable).length > 0
  ) {
    return "server" as EnvironmentName<Spec>;
  }
  if ("browser" in programs) return "browser" as EnvironmentName<Spec>;
  const first = Object.keys(programs)[0];
  return (first ?? "server") as EnvironmentName<Spec>;
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

type StylexBuildOptions = {
  dev: boolean;
  cssOutput: string;
};

function stylexCssOutput(buildDir: string): string {
  return resolve(buildDir, "stylex.generated.css");
}

async function createStylexBuildPlugins(options: StylexBuildOptions): Promise<Bun.BunPlugin[]> {
  const { createStylexBunPlugin } = await import("@stylexjs/unplugin/bun");
  const pluginOptions = {
    dev: options.dev,
    enableMediaQueryOrder: false,
    runtimeInjection: false,
    useCSSLayers: true,
    bunDevCssOutput: options.cssOutput,
  };
  return [
    {
      name: "poggers-stylex",
      async setup(build) {
        await createStylexBunPlugin(pluginOptions).setup(build);
      },
    },
  ];
}

async function writeBrowserEntrypoint(
  paths: AppPaths,
  options: { buildDir?: string; dev?: boolean; title?: string } = {},
): Promise<BrowserEntrypoint> {
  const buildDir =
    options.buildDir ?? (options.dev ? frameworkDevDir(paths) : frameworkBuildDir(paths));
  const entrypoint = resolve(buildDir, "browser.entry.tsx");
  await mkdir(buildDir, { recursive: true });
  const visualModule = await writeVisualStylexModule(paths, buildDir);
  const compiledStyles = await compileBrowserStyles(paths, buildDir, Boolean(visualModule));
  const stylexStyles = visualModule ? stylexCssOutput(buildDir) : undefined;
  const appPlugins = [
    createPoggersKitSourcePlugin(),
    createComponentTransformPlugin(paths),
    createPoggersAppAliasesPlugin(paths),
    createPoggersAppPlugin(paths, visualModule),
  ];
  const plugins = [
    ...appPlugins,
    ...(visualModule
      ? await createStylexBuildPlugins({
          dev: Boolean(options.dev),
          cssOutput: stylexStyles ?? stylexCssOutput(buildDir),
        })
      : []),
  ];
  const styleImport = compiledStyles
    ? `import ${JSON.stringify(importSpecifier(entrypoint, compiledStyles))};\n`
    : "";
  const source = nativeBrowserEntrySource(styleImport, {
    rootImport: `import { Root, dispose as disposePoggersApp, initialize as initializePoggersApp, start as startPoggersApp } from "@poggers/app";`,
    setup: "await initializePoggersApp();\nawait startPoggersApp();",
    rootExpression: "Root({})",
    dev: Boolean(options.dev),
  });
  await writeFile(entrypoint, source, "utf8");
  return {
    entrypoint,
    styles: compiledStyles,
    styleFiles: stylexStyles ? [stylexStyles] : undefined,
    plugins,
    html: undefined,
    development: options.dev ? { hmr: true, console: true } : undefined,
  };
}

async function writeChangedDevArtifacts(
  paths: AppPaths,
  changedPath: string,
  buildDir: string,
): Promise<void> {
  try {
    Object.assign(paths, resolveApp(paths.appDir));
  } catch {
    // Atomic saves can briefly remove the canonical source. The following
    // filesystem event will refresh the paths once the replacement exists.
    return;
  }
  const changed = resolve(changedPath);
  if (shouldRebuildBrowserStyles(paths, changed)) {
    const visualModule = await writeVisualStylexModule(paths, buildDir);
    await compileBrowserStyles(paths, buildDir, Boolean(visualModule));
  }
}

function shouldRebuildBrowserStyles(paths: AppPaths, changed: string): boolean {
  if (!isSourceReloadFile(paths, changed)) return false;
  return true;
}

function isSourceReloadFile(paths: AppPaths, changed: string): boolean {
  const rel = relative(paths.sourceDir, changed).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..")) return false;
  if (rel.startsWith(".poggers/") || rel.startsWith("migrations/")) return false;
  return /\.(css|[cm]?[jt]sx?)$/.test(rel);
}

async function compileBrowserStyles(
  _paths: AppPaths,
  buildDir: string,
  visual = false,
): Promise<string | undefined> {
  return visual ? compileVisualReset(buildDir) : undefined;
}

export async function validateAppStyles(appDir: string): Promise<void> {
  const paths = resolveApp(appDir);
  const buildDir = frameworkDevDir(paths);
  const visualModule = await writeVisualStylexModule(paths, buildDir);
  await compileBrowserStyles(paths, buildDir, Boolean(visualModule));
}

function nativeBrowserEntrySource(
  styleImport: string,
  options: {
    rootImport: string;
    setup?: string;
    rootExpression: string;
    dev: boolean;
  },
): string {
  const renderImport = options.dev
    ? `import { render, type HotRenderState } from "@poggers/kit/host/browser";\n`
    : `import { render } from "@poggers/kit/host/browser";\n`;
  const renderBlock = options.dev
    ? `type HotData = {
  cleanup?: () => void;
  appCleanup?: () => void;
  hotState?: HotRenderState;
};
const hotGlobal = globalThis as typeof globalThis & { __poggersHotData?: HotData };
const hotData = (hotGlobal.__poggersHotData ??= import.meta.hot
  ? (import.meta.hot.data as HotData)
  : {});
if (import.meta.hot) Object.assign(hotData, import.meta.hot.data as HotData);
let cleanup = hotData.cleanup;
const hotState = (hotData.hotState ??= {});

function renderRoot() {
  cleanup?.();
  hotData.appCleanup?.();
  cleanup = render(() => ${options.rootExpression}, root, hotState);
  hotData.cleanup = cleanup;
  hotData.appCleanup = disposePoggersApp;
  hotData.hotState = hotState;
  if (import.meta.hot) {
    Object.assign(import.meta.hot.data as HotData, hotData);
  }
}

renderRoot();

if (import.meta.hot) {
  const rerender = () => renderRoot();
  window.addEventListener("poggers:render", rerender);
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    window.removeEventListener("poggers:render", rerender);
    hotData.cleanup = cleanup;
    hotData.appCleanup = disposePoggersApp;
    hotData.hotState = hotState;
    Object.assign(import.meta.hot.data as HotData, hotData);
  });
}
`
    : `render(() => ${options.rootExpression}, root);
`;

  return `${styleImport}${options.rootImport}
${renderImport}
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element.");
${options.setup ? `\n${options.setup}\n` : ""}

${renderBlock}`;
}

async function writeVisualStylexModule(
  paths: AppPaths,
  buildDir: string,
): Promise<string | undefined> {
  const apiModule = await importBuiltAppModule(paths);
  const api = normalizeLoadedApp(apiModule);
  const styles = recordValue(api?.def?.styles);
  const presets = recordValue(styles.presets);
  if (!Object.keys(presets).length) return undefined;

  const contract = analyzeVisualContract(paths.app);
  const sourceLocations = analyzeVisualPresetSources(paths.app, paths.sourceDir);
  const visualEntries = Object.entries(presets).filter(([, preset]) =>
    looksLikeVisualPreset(preset),
  );
  if (!visualEntries.length) return undefined;
  if (visualEntries.length !== Object.keys(presets).length) {
    throw new Error("Every Poggers preset must be a preset factory.");
  }

  const materialized = await Promise.all(
    visualEntries.map(async ([name, preset]) => {
      const declaration = contract.presets.find((candidate) => candidate.name === name);
      if (!declaration)
        throw new Error(`Visual preset ${JSON.stringify(name)} is missing from App.Styles.`);
      const location = sourceLocations[name] ?? declaration.location;
      try {
        return await bundleVisualFontAssets(
          materializeVisualPreset(name, preset, contract.surface, declaration),
          location.file,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${location.file}:${location.line}:${location.column}: ${message}`);
      }
    }),
  );
  const output = resolve(buildDir, "visual.generated.stylex.ts");
  let generated: string;
  try {
    generated = `${generateVisualStylexModule(materialized)}
export const compiledStyleDefinition = ${JSON.stringify({
      defaultPreset:
        typeof styles.defaultPreset === "string" ? styles.defaultPreset : materialized[0]?.name,
      presets: Object.fromEntries(
        materialized.map((preset) => [
          preset.name,
          {
            themes: Object.fromEntries(
              ["default", ...Object.keys(preset.themes).filter((theme) => theme !== "default")].map(
                (theme) => [theme, {}],
              ),
            ),
          },
        ]),
      ),
    })};
`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preset = visualEntries.find(([name]) => message.includes(name))?.[0];
    const location = preset ? sourceLocations[preset] : undefined;
    throw new Error(
      location ? `${location.file}:${location.line}:${location.column}: ${message}` : message,
    );
  }
  await writeGeneratedFile(output, generated);
  return output;
}

function looksLikeVisualPreset(value: unknown): boolean {
  return typeof value === "function";
}

async function compileVisualReset(buildDir: string): Promise<string> {
  const output = resolve(buildDir, "styles.generated.css");
  await writeGeneratedFile(output, visualResetCss);
  return output;
}

const visualResetCss = `@layer reset, accessibility, motion;

@layer reset {
  *, *::before, *::after, ::backdrop, ::file-selector-button {
    box-sizing: border-box;
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0 solid;
  }

  html {
    min-block-size: 100%;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    tab-size: 4;
    -webkit-tap-highlight-color: transparent;
  }

  body, #root { min-block-size: 100%; }
  #root { container: app / inline-size; isolation: isolate; }
  body { line-height: 1; }

  h1, h2, h3, h4, h5, h6 { font: inherit; text-wrap: balance; }
  p { text-wrap: pretty; }
  p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
  b, strong { font-weight: bolder; }
  small { font-size: 80%; }
  sub, sup { position: relative; vertical-align: baseline; font-size: 75%; line-height: 0; }
  sub { inset-block-end: -0.25em; }
  sup { inset-block-start: -0.5em; }

  a { color: inherit; text-decoration: inherit; }
  ol, ul, menu { list-style: none; }
  blockquote, dl, dd, figure { margin: 0; }
  hr { block-size: 0; color: inherit; border-block-start-width: 1px; }
  abbr:where([title]) { text-decoration: underline dotted; }

  button, input, optgroup, select, textarea, ::file-selector-button {
    appearance: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-feature-settings: inherit;
    font-variation-settings: inherit;
    letter-spacing: inherit;
    opacity: 1;
  }
  button, select, summary, ::file-selector-button { cursor: inherit; }
  textarea { resize: vertical; }
  ::placeholder { color: currentColor; opacity: 0.54; }
  ::-webkit-search-decoration, ::-webkit-search-cancel-button { appearance: none; }
  ::-webkit-inner-spin-button, ::-webkit-outer-spin-button { block-size: auto; }
  ::-webkit-date-and-time-value { min-block-size: 1lh; text-align: inherit; }
  summary { display: list-item; }
  fieldset { min-inline-size: 0; }
  legend { padding: 0; }

  dialog, [popover] {
    max-inline-size: none;
    max-block-size: none;
    color: inherit;
    background: transparent;
  }
  dialog { position: static; inset: auto; inline-size: auto; block-size: auto; }
  dialog::backdrop, [popover]::backdrop { background: transparent; }
  dialog[inert], dialog[inert]::backdrop { pointer-events: none; }
  dialog:not([open]), [popover]:not(:popover-open), [hidden] { display: none !important; }
  [popover] { inset: auto; }

  img, picture, video, canvas, svg, iframe, embed, object {
    display: block;
    max-inline-size: 100%;
  }
  img, picture, video, canvas { block-size: auto; }
  audio:not([controls]) { display: none; }
  svg { overflow: visible; }
  table { border-collapse: collapse; border-color: inherit; border-spacing: 0; text-indent: 0; }
}

@layer accessibility {
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible, [tabindex]:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  :disabled { cursor: not-allowed; }
}

@layer motion {
  @media (prefers-reduced-motion: no-preference) {
    html { interpolate-size: allow-keywords; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 0ms !important; }
  }
}
`;

async function writeGeneratedFile(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    if ((await readFile(path, "utf8")) === source) return;
  } catch {
    // The first generation has no previous file.
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, source, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function importBuiltAppModule(paths: AppPaths): Promise<AppModule> {
  const buildDir = frameworkDevDir(paths);
  const serverAppStub = await writeServerAppStubFile(paths, buildDir);
  const serverAppSource = await writeServerAppEntrypoint(paths, buildDir, serverAppStub);
  return importBuiltSourceModule(serverAppSource, buildDir, "app", [
    createPoggersAppAliasesPlugin(paths),
    createPoggersServerAppStubPlugin(paths),
  ]);
}

async function importBuiltSourceModule(
  entrypoint: string,
  buildDir: string,
  prefix: string,
  plugins: Bun.BunPlugin[] = [],
): Promise<AppModule> {
  const tempFile = resolve(
    buildDir,
    `${prefix}.${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeBuiltAppModule(entrypoint, tempFile, plugins);
  try {
    return (await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)) as AppModule;
  } finally {
    await rm(tempFile, { force: true });
  }
}

async function writeBuiltAppModule(
  entrypoint: string,
  output: string,
  plugins: Bun.BunPlugin[] = [],
): Promise<string> {
  await mkdir(dirname(output), { recursive: true });
  const tsconfig = await writeInternalBuildTsconfig(output);
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    jsx: poggersJsx,
    minify: false,
    plugins: [createPoggersKitSourcePlugin(), ...plugins],
    target: "bun",
    tsconfig,
  });

  if (!result.success) {
    throw new Error(result.logs.map(String).join("\n"));
  }

  const built = result.outputs.find((file) => {
    const path = (file as Blob & { path?: string }).path ?? "";
    return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".ts");
  });

  if (!built) throw new Error(`App build produced no module for ${entrypoint}.`);

  await writeFile(output, await built.text(), "utf8");
  return output;
}

async function writeInternalBuildTsconfig(output: string): Promise<string> {
  const tsconfig = resolve(dirname(output), "tsconfig.generated.json");
  await writeFile(
    tsconfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          jsx: "react-jsx",
          module: "Preserve",
          moduleResolution: "bundler",
          target: "ESNext",
          types: ["bun"],
          verbatimModuleSyntax: true,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return tsconfig;
}

function createPoggersAppPlugin(paths: AppPaths, visualModule?: string): Bun.BunPlugin {
  return {
    name: "poggers-app",
    setup(build) {
      build.onResolve({ filter: /^@poggers\/app$/ }, (args) => ({
        path: args.path,
        namespace: "poggers-app",
      }));

      build.onLoad({ filter: /.*/, namespace: "poggers-app" }, (args) => {
        if (args.path !== "@poggers/app") return;

        return {
          loader: "tsx",
          contents: poggersAppModuleSource(paths, visualModule),
        };
      });
    },
  };
}

function createPoggersAppAliasesPlugin(paths: AppPaths): Bun.BunPlugin {
  return {
    name: "poggers-app-aliases",
    setup(build) {
      build.onResolve({ filter: /^(?:app|deps|src\/.*)$/ }, (args) => {
        const target = resolveAppAlias(paths, args.path);
        return target ? { path: target } : undefined;
      });
    },
  };
}

function createComponentTransformPlugin(paths: AppPaths): Bun.BunPlugin {
  return {
    name: "poggers-component-views",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        const resolvedPath = resolve(args.path);
        const isApp = resolvedPath === resolve(paths.app);
        const isAppSource = resolvedPath.startsWith(`${resolve(paths.sourceDir)}/`);
        if (!isAppSource) return;
        const source = await readFile(args.path, "utf8");
        return {
          contents: transformComponentSource(source, args.path, {
            stripStyles: isApp,
            stripEndpoints: true,
          }),
          loader: args.path.endsWith("x") ? "tsx" : args.path.endsWith(".ts") ? "ts" : "js",
        };
      });
    },
  };
}

function resolveAppAlias(paths: AppPaths, specifier: string): string | undefined {
  if (specifier === "app") return paths.app;
  if (specifier.startsWith("src/")) {
    return resolveSourceModule(resolve(paths.sourceDir, specifier.slice("src/".length)));
  }
}

function resolveSourceModule(path: string): string | undefined {
  return firstExisting([
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.mts`,
    `${path}.cts`,
    resolve(path, "index.ts"),
    resolve(path, "index.tsx"),
    resolve(path, "index.mts"),
    resolve(path, "index.cts"),
  ]);
}

function createPoggersKitSourcePlugin(): Bun.BunPlugin {
  return {
    name: "poggers-kit-source",
    setup(build) {
      build.onResolve({ filter: /^@poggers\/kit(?:\/.*)?$/ }, (args) => {
        const target = resolvePoggersKitSource(args.path);
        return { path: target };
      });
      build.onResolve(
        { filter: /^#(?:features|host|kernel|substrate|testing|tooling|ui)\// },
        (args) => ({
          path: resolveKitModule(args.path.slice(1)),
        }),
      );
      build.onResolve({ filter: /^alien-signals$/ }, () =>
        alienSignalsEntrypoint ? { path: alienSignalsEntrypoint } : undefined,
      );
    },
  };
}

function resolvePoggersKitSource(path: string): string {
  const subpath = path.slice("@poggers/kit".length).replace(/^\//, "");
  const modules: Readonly<Record<string, string>> = {
    "": "index",
    "host/browser": "host/browser",
    "host/server": "host/server",
    "jsx-dev-runtime": "ui/web/jsx-dev-runtime",
    "jsx-runtime": "ui/web/jsx-runtime",
    preset: "ui/preset",
    testing: "testing/index",
    ui: "ui/index",
  };
  const module = modules[subpath];
  if (!module) throw new Error(`Unsupported @poggers/kit subpath ${subpath}.`);
  return resolveKitModule(module);
}

function resolveKitModule(module: string): string {
  return (
    firstExisting([
      resolve(kitSourceDir, `${module}.ts`),
      resolve(kitSourceDir, `${module}.tsx`),
      resolve(kitSourceDir, `${module}.js`),
    ]) ?? resolve(kitSourceDir, `${module}.js`)
  );
}

function createPoggersServerAppStubPlugin(paths: AppPaths): Bun.BunPlugin {
  return {
    name: "poggers-server-app-stub",
    setup(build) {
      build.onResolve({ filter: /^@poggers\/app$/ }, (args) => ({
        path: args.path,
        namespace: "poggers-server-app-stub",
      }));

      build.onLoad({ filter: /.*/, namespace: "poggers-server-app-stub" }, (args) => {
        if (args.path !== "@poggers/app") return;

        return {
          loader: "ts",
          contents: poggersServerAppStubSource(paths),
        };
      });
    },
  };
}

async function writeServerAppStubFile(paths: AppPaths, buildDir: string): Promise<string> {
  const stub = resolve(buildDir, "poggers-app-stub.generated.ts");
  await mkdir(dirname(stub), { recursive: true });
  await writeFile(stub, poggersServerAppStubSource(paths), "utf8");
  return stub;
}

async function writeServerAppEntrypoint(
  paths: AppPaths,
  buildDir: string,
  stubPath: string,
  options: { stripStyles?: boolean } = {},
): Promise<string> {
  const output = resolve(buildDir, "app.source.generated.tsx");
  const appSource = readFileSync(paths.app, "utf8");
  const transformedSource = paths.app.endsWith("x")
    ? transformComponentSource(appSource, paths.app, options)
    : appSource;
  const source = rewriteServerAppImports(transformedSource, dirname(paths.app), stubPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, source, "utf8");
  return output;
}

function rewriteServerAppImports(source: string, appSourceDir: string, stubPath: string): string {
  return source
    .replaceAll(/from\s+["']@poggers\/app["']/g, `from ${JSON.stringify(stubPath)}`)
    .replaceAll(/from\s+["'](\.[^"']*)["']/g, (_match, specifier: string) => {
      return `from ${JSON.stringify(resolve(appSourceDir, specifier))}`;
    });
}

function poggersAppModuleSource(paths: AppPaths, visualModule?: string): string {
  const surface = collectAppSurface(paths);
  const runtimeContract = JSON.stringify(surface.manifest.contract);
  const stylesLoad = "styles = compiledStyleDefinition;";
  const componentParts = JSON.stringify(componentRuntimeConfigRecord(surface));
  const resourceExports = surface.resources
    .map(({ name: resource }) => {
      const name = `use${capitalize(resource)}`;
      return `export function ${name}(key) {
  return getHooks().${name}(key);
}`;
    })
    .join("\n\n");

  const visualImport = visualModule
    ? `import { compiledStyleDefinition, compiledVisuals } from ${JSON.stringify(visualModule)};`
    : "const compiledVisuals = undefined; const compiledStyleDefinition = { presets: { default: { themes: { default: {} } } } };";
  return `import { createBrowserConnectOptions, createHooks, defineApp, installAppMigrations, startDependencyGroups } from "@poggers/kit/host/browser";
${visualImport}

const components = ${componentParts};
let app;
let styles;
let hooks;
let initializePromise;
let mountedDependencies;

export async function initialize() {
  if (app && styles) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      const appModule = await import(${JSON.stringify(paths.app)});
      const rawApp = appModule.default ?? appModule.app ?? appModule;
      app = rawApp?.def?.resources ? rawApp : defineApp(rawApp);
      installAppMigrations(app, { hash: ${JSON.stringify(surface.manifest.contract.hash)}, contract: ${runtimeContract} });
      mountedDependencies = await startDependencyGroups(
        app.def?.dependencyGroups?.browser ?? {},
        { data: { namespace: "poggers", name: ${JSON.stringify(titleFromDir(paths.appDir))} } },
      );
      ${stylesLoad}
    })();
  }
  await initializePromise;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    dispose();
  });
}

export function dispose() {
  hooks?.dispose();
  hooks = undefined;
  void mountedDependencies?.stop();
  mountedDependencies = undefined;
  initializePromise = undefined;
  styles = undefined;
  app = undefined;
}

function requireInitialized() {
  if (!app || !styles) {
    throw new Error("@poggers/app was used before it finished initializing.");
  }
}

function getHooks() {
  requireInitialized();
  if (!hooks) hooks = createHooks({
    app,
    styles,
    components,
    compiledVisuals,
    dependencyGroups: mountedDependencies?.groups,
  });
  return hooks;
}

${resourceExports}

export const nav = new Proxy({}, {
  get(_target, prop) {
    return getHooks().nav[prop];
  },
});

export function useScreen() {
  return getHooks().useScreen();
}

export function useAppearance() {
  return getHooks().useAppearance();
}

export function setAppearance(appearance) {
  getHooks().setAppearance(appearance);
}

export async function start(connect) {
  await getHooks().start(connect ?? createBrowserConnectOptions());
}

export function Root(props = {}) {
  void start(props.connect);
  requireInitialized();
  return getHooks().renderRoot();
}

export default Root;
`;
}

function poggersServerAppStubSource(paths: AppPaths): string {
  const surface = collectAppSurface(paths);
  const unavailableExports = surface.resources
    .map(({ name: resource }) => `use${capitalize(resource)}`)
    .map(
      (name) => `export function ${name}() {
  throwUnavailable(${JSON.stringify(name)});
}`,
    )
    .join("\n\n");

  return `function throwUnavailable(name) {
  throw new Error("@poggers/app." + name + " is only available in the browser UI runtime.");
}

${unavailableExports}

export const nav = new Proxy({}, {
  get(_target, prop) {
    throwUnavailable("nav." + String(prop));
  },
});

export function useScreen() { throwUnavailable("useScreen"); }
export function useAppearance() { throwUnavailable("useAppearance"); }
export function setAppearance() { throwUnavailable("setAppearance"); }
export function start() {}
export function Root() {
  return null;
}
export default Root;
`;
}

type AppSurface = CompiledAppSurface;

function collectAppSurface(paths: AppPaths): CompiledAppSurface {
  const surface: CompiledAppSurface = analyzeAppContract(paths.app);
  for (const component of Object.values(surface.components)) {
    for (const value of component.state) {
      if (value.kind) {
        readKnownStyleValueKind(value.kind, `Components.${component.name}.State.${value.name}`);
      }
    }
  }
  for (const preset of surface.stylePresets) {
    for (const token of preset.tokens) {
      readKnownTokenKind(
        token.kind,
        `Styles.Presets.${preset.name}.Tokens.${token.group}.${token.name}`,
      );
    }
  }
  return surface;
}

const knownStyleValueKinds = new Set([
  "number",
  "progress",
  "opacity",
  "ratio",
  "angle",
  "time",
  "zIndex",
  "length",
  "space",
  "size",
  "radius",
]);

const knownTokenKinds = new Set([
  "blur",
  "color",
  "duration",
  "easing",
  "font",
  "gradient",
  "length",
  "motion",
  "opacity",
  "paint",
  "radius",
  "ratio",
  "shadow",
  "size",
  "space",
  "stroke",
  "type",
  "z",
  "zIndex",
]);

function readKnownStyleValueKind(kind: string, path: string): string {
  if (knownStyleValueKinds.has(kind)) return kind;
  throw new Error(`Unknown Poggers component style value kind "${kind}" at ${path}.`);
}

function readKnownTokenKind(kind: string, path: string): string {
  if (knownTokenKinds.has(kind)) return kind;
  throw new Error(`Unknown Poggers token kind "${kind}" at ${path}.`);
}

function componentRuntimeConfigRecord(surface: AppSurface): Record<
  string,
  {
    parts: Record<string, string>;
    state?: Array<{ name: string; writable?: boolean }>;
    inputCallbacks?: string[];
  }
> {
  const components: Record<
    string,
    {
      parts: Record<string, string>;
      state?: Array<{ name: string; writable?: boolean }>;
      inputCallbacks?: string[];
    }
  > = {};
  for (const component of Object.values(surface.components)) {
    components[component.name] = {
      parts: component.parts,
      state: component.state.map(({ name, writable }) => ({ name, writable })),
      inputCallbacks: component.inputCallbacks,
    };
  }
  return components;
}

async function appendStyleFilesToBuildOutput(
  outputs: Blob[],
  styleFiles: string[] | undefined,
  fallbackOutput: string,
): Promise<void> {
  const extraCss = await readStyleFiles(styleFiles);
  if (!extraCss) return;

  const cssOutput = (outputs as Array<Blob & { path?: string }>).find((output) =>
    (output.path ?? "").endsWith(".css"),
  );
  if (cssOutput?.path) {
    const current = existsSync(cssOutput.path) ? await readFile(cssOutput.path, "utf8") : "";
    await writeFile(cssOutput.path, joinCss(current, extraCss), "utf8");
    return;
  }

  await mkdir(dirname(fallbackOutput), { recursive: true });
  await writeFile(fallbackOutput, extraCss, "utf8");
}

function serverEntrypointSource(
  paths: AppPaths,
  serverEntrypoint: string,
  appEntrypoint: string,
  browserEntry: string,
  browserBundle: string,
  browserStyle?: string,
  migrationRegistry?: string,
  title?: string,
): string {
  const migrationImport = migrationRegistry
    ? `import * as migrationRegistry from ${JSON.stringify(importSpecifier(serverEntrypoint, migrationRegistry))};\n`
    : "const migrationRegistry = { hash: undefined, migrations: [] };\n";

  return `import * as apiModule from ${JSON.stringify(importSpecifier(serverEntrypoint, appEntrypoint))};
import {
  createRuntimeSubstrate,
  defineApp,
  installAppMigrations,
  parseDurabilityProfile,
  serveApp,
  startDependencyGroups,
} from "@poggers/kit/host/server";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
${migrationImport}
await startApplication();

async function startApplication() {
const apiExports = apiModule as Record<string, unknown>;
const rawApi = apiExports.api ?? apiExports.default;
if (!rawApi) throw new Error("App API module must export api or default.");
const api = installAppMigrations(rawApi.def?.resources ? rawApi : defineApp(rawApi), {
  hash: migrationRegistry.hash,
  migrations: migrationRegistry.migrations,
  contract: migrationRegistry.contract,
});
const browserProgram = api.def?.programs?.browser;
const serverProgram = api.def?.programs?.server;
const endpointServer = Object.keys(api.def?.endpointTable ?? {}).length > 0;
	const runtimeEnv = serverProgram || endpointServer || api.def?.dependencyGroups?.server
  ? "server"
  : browserProgram
    ? "browser"
    : "server";
const program = runtimeEnv === "server" ? serverProgram : browserProgram;
	const mountedDependencies = await startDependencyGroups(
	  api.def?.dependencyGroups?.[runtimeEnv] ?? {},
	  { data: { path: resolve(process.cwd(), ".poggers/data/dependencies"), namespace: "poggers", name: ${JSON.stringify(titleFromDir(paths.appDir))} } },
	);
const programConfig = program
  ? {
      env: runtimeEnv,
	      deps: mountedDependencies.groups,
	      disposeDependencies: mountedDependencies.stop,
      programId: apiExports.programId ?? \`${titleFromDir(paths.appDir)}-\${runtimeEnv}\`,
      actor: apiExports.programActor,
    }
  : undefined;

const dataDir = resolve(process.cwd(), ".poggers/data");
mkdirSync(dataDir, { recursive: true });
const substrate = createRuntimeSubstrate(
  resolve(dataDir, "journal.sqlite"),
  parseDurabilityProfile(process.env.POGGERS_DURABILITY),
);
const manifest = ${JSON.stringify(collectAppSurface(paths).manifest)};

const handle = serveApp({
  api,
  entrypoint: new URL(${JSON.stringify(importSpecifier(serverEntrypoint, browserEntry))}, import.meta.url),
  title: ${title === undefined ? "undefined" : JSON.stringify(title)},
  bundle: ${JSON.stringify(browserBundle)},
  styleBundle: ${JSON.stringify(browserStyle)},
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  substrate,
  manifest,
  program: programConfig,
	  dependencyGroups: mountedDependencies.groups,
	  disposeDependencies: programConfig ? undefined : mountedDependencies.stop,
});

let stopping = false;
async function stopApplication() {
  if (stopping) return;
  stopping = true;
  await handle.stop();
  await substrate.close();
  process.exit(0);
}

process.on("SIGINT", () => void stopApplication());
process.on("SIGTERM", () => void stopApplication());
}
`;
}

async function readBuildOutputs(
  outputs: Blob[],
  styleFiles?: string[],
): Promise<{ script?: string; style?: string }> {
  let script: string | undefined;
  let style: string | undefined;
  for (const output of outputs as Array<Blob & { path?: string }>) {
    const path = output.path ?? "";
    if (path.endsWith(".css")) {
      style = `${style ?? ""}${await output.text()}`;
    } else if (path.endsWith(".js") || !script) {
      script = await output.text();
    }
  }
  return { script, style: await appendStyleFiles(style, styleFiles) };
}

async function appendStyleFiles(
  style: string | undefined,
  styleFiles: string[] | undefined,
): Promise<string | undefined> {
  return joinCss(style, await readStyleFiles(styleFiles)) || undefined;
}

async function readStyleFiles(styleFiles: string[] | undefined): Promise<string | undefined> {
  const chunks: string[] = [];
  for (const path of styleFiles ?? []) {
    if (!existsSync(path)) continue;
    const css = await readFile(path, "utf8");
    if (css.trim()) chunks.push(css);
  }
  return chunks.length ? chunks.join("\n") : undefined;
}

function joinCss(left: string | undefined, right: string | undefined): string {
  if (!left) return right ?? "";
  if (!right) return left;
  return `${left}\n${right}`;
}

function frameworkBuildDir(paths: AppPaths): string {
  return resolve(paths.appDir, ".poggers/build");
}

function frameworkDevDir(paths: AppPaths, scope = "shared"): string {
  return resolve(paths.appDir, ".poggers/dev", scope);
}

function importSpecifier(fromFile: string, targetPath: string): string {
  let specifier = relative(dirname(fromFile), targetPath).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function titleFromDir(appDir: string): string {
  return basename(appDir).replaceAll("-", " ");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
