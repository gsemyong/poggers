import {
  defineApp,
  installAppMigrations,
  type ActorOf,
  type App,
  type AppSpec,
  type EnvironmentDeps,
  type EnvironmentName,
  type RuntimeMigrationEdge,
} from "./app";
import { serve, type ServeOpts, type ServerHandle, type WebLiveReloadOpts } from "./server";
import {
  analyzeVisualContract,
  analyzeVisualPresetSources,
  materializeVisualPreset,
} from "./visual-compiler";
import { generateVisualStylexModule } from "./visual-stylex";
import type { AppProgram, WorkerDef, WorkerDurabilityStore } from "./worker";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { $ } from "bun";

export { installAppMigrations };
export type { RuntimeMigrationEdge };

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
  styleFiles?: string[];
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

export function serveApp<Spec extends AppSpec, Deps = never>({
  api,
  ui,
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
  worker,
  program,
  ...serveOpts
}: ServeAppOpts<Spec, Deps>): ServerHandle {
  return serve(api, {
    ...serveOpts,
    web: {
      bundle,
      styleBundle,
      entrypoint: ui,
      html,
      styles,
      styleFiles,
      plugins,
      assetDir,
      title,
      development,
      liveReload,
    },
    workers: worker ? [worker] : undefined,
    programs: program ? [program] : undefined,
  });
}

export type AppPaths = {
  appDir: string;
  sourceDir: string;
  api: string;
  ui: string;
  types?: string;
  embedded: boolean;
  worker?: string;
  deps?: string;
};

type BrowserEntrypoint = {
  entrypoint: string;
  styles?: string;
  styleFiles?: string[];
  plugins: Bun.BunPlugin[];
  html?: any;
  development?: Bun.Serve.Development;
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
const kitSourceDir = dirname(fileURLToPath(import.meta.url));
const alienSignalsEntrypoint = resolve(kitSourceDir, "../node_modules/alien-signals/esm/index.mjs");

export function resolveApp(appDir: string): AppPaths {
  const resolvedAppDir = resolve(appDir);
  const api = firstExisting([
    resolve(resolvedAppDir, "src/api.ts"),
    resolve(resolvedAppDir, "src/api/index.ts"),
    resolve(resolvedAppDir, "api.ts"),
    resolve(resolvedAppDir, "api/index.ts"),
  ]);
  const ui = firstExisting([
    resolve(resolvedAppDir, "src/app.ts"),
    resolve(resolvedAppDir, "src/app.tsx"),
    resolve(resolvedAppDir, "app.ts"),
    resolve(resolvedAppDir, "app.tsx"),
  ]);
  const sourceDir = ui ? dirname(ui) : resolve(resolvedAppDir, "src");
  const types = firstExisting([
    resolve(sourceDir, "types.ts"),
    resolve(resolvedAppDir, "types.ts"),
  ]);
  const worker = firstExisting([
    resolve(sourceDir, "worker.ts"),
    resolve(resolvedAppDir, "worker.ts"),
  ]);
  const deps = firstExisting([resolve(sourceDir, "deps.ts")]);

  if (!ui) {
    throw new Error(
      `App is missing src/app.ts, src/app.tsx, app.ts, or app.tsx in ${resolvedAppDir}.`,
    );
  }

  const embedded = !api;

  return {
    appDir: resolvedAppDir,
    sourceDir,
    api: api ?? ui,
    ui,
    types,
    embedded,
    worker,
    deps,
  };
}

export async function loadApp<Spec extends AppSpec = AppSpec>(
  appDir: string,
): Promise<LoadedApp<Spec>> {
  const paths = resolveApp(appDir);
  await writeGeneratedTypeArtifacts(paths);
  const apiModule = await importBuiltAppModule(paths);
  const depsModule = paths.deps ? await import(pathToFileURL(paths.deps).href) : {};
  const api = normalizeLoadedApp<Spec>(apiModule);

  if (!api?.def?.resources) {
    throw new Error(`App module must export a Poggers app from ${paths.api}.`);
  }

  installAppMigrations(api, await loadMigrationRegistry(paths));

  const worker = paths.worker ? await loadWorker<Spec>(paths.worker, paths.appDir) : undefined;
  const program = await loadProgram(
    api,
    apiModule,
    depsModule,
    selectProgramEnv(api),
    paths.appDir,
  );

  return { paths, api, worker, program };
}

function normalizeLoadedApp<Spec extends AppSpec>(
  module: Record<string, any>,
): App<Spec> | undefined {
  const candidate = module.api ?? module.default;
  if (!candidate) return undefined;
  if (candidate.def?.resources) return candidate as App<Spec>;
  return defineApp(candidate);
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

  return serveApp({
    api: loaded.api,
    ui: browser.entrypoint,
    html: browser.html,
    styles: browser.styles,
    styleFiles: browser.styleFiles,
    plugins: browser.plugins,
    development: browser.development,
    title: opts.title,
    port: opts.port,
    snapshotIntervalMs: opts.snapshotIntervalMs,
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
    worker: loaded.worker,
    program: loaded.program,
  });
}

export async function bundleApp(opts: BundleAppOpts): Promise<void> {
  const paths = resolveApp(opts.appDir);
  await writeGeneratedTypeArtifacts(paths);
  const browser = await writeBrowserEntrypoint(paths);
  const outdir = opts.outdir ?? resolve(paths.appDir, ".poggers/build/web");
  const result = await Bun.build({
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
  await writeGeneratedTypeArtifacts(paths);
  const browser = await writeBrowserEntrypoint(paths);
  const browserBuild = await Bun.build({
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
  const serverAppSource = await writeServerAppEntrypoint(paths, buildDir, serverAppStub);
  const appEntrypoint = await writeBuiltAppModule(
    serverAppSource,
    resolve(buildDir, "app.generated.js"),
    [createPoggersAppAliasesPlugin(paths), createPoggersServerAppStubPlugin(paths)],
  );
  const migrationRegistry = await writeMigrationRegistry(paths, buildDir);
  const serverEntrypoint = resolve(buildDir, "server.generated.ts");
  await mkdir(buildDir, { recursive: true });
  await mkdir(dirname(resolve(opts.outfile)), { recursive: true });
  await writeFile(
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
    "utf8",
  );

  await $`bun build --compile --target=bun --outfile ${resolve(opts.outfile)} ${serverEntrypoint}`;
}

export async function writeAppTypes(appDir: string): Promise<string | undefined> {
  const paths = resolveApp(appDir);
  return writeGeneratedTypeArtifacts(paths);
}

export async function writeMigrationSnapshot(appDir: string): Promise<MigrationSnapshotResult> {
  const paths = resolveApp(appDir);
  if (!paths.types) throw new Error(`App is missing src/types.ts in ${paths.appDir}.`);

  const typesSource = await readFile(paths.types, "utf8");
  const hash = structuralHash(typesSource);
  const snapshotsDir = resolve(paths.sourceDir, "migrations/snapshots");
  const snapshotPath = resolve(snapshotsDir, `${hash}.ts`);
  const created = !existsSync(snapshotPath);

  if (created) {
    await mkdir(snapshotsDir, { recursive: true });
    await writeFile(
      snapshotPath,
      `export const hash = ${JSON.stringify(hash)};\n\n${typesSource.trimEnd()}\n`,
      "utf8",
    );
  }

  return { hash, path: snapshotPath, created };
}

async function loadMigrationRegistry(paths: AppPaths): Promise<{
  hash?: string;
  migrations: RuntimeMigrationEdge[];
}> {
  const hash = await currentStructuralHash(paths);
  const migrations: RuntimeMigrationEdge[] = [];

  for (const file of await migrationEdgeFiles(paths.sourceDir)) {
    const module = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const edge = module.default ?? module.migration;
    if (edge) migrations.push(edge as RuntimeMigrationEdge);
  }

  return { hash, migrations };
}

async function writeMigrationRegistry(paths: AppPaths, buildDir: string): Promise<string> {
  const output = resolve(buildDir, "migrations.generated.ts");
  const hash = await currentStructuralHash(paths);
  const files = await migrationEdgeFiles(paths.sourceDir);
  const imports = files
    .map(
      (file, index) =>
        `import migration${index} from ${JSON.stringify(importSpecifier(output, file))};`,
    )
    .join("\n");
  const migrations = files.map((_, index) => `migration${index}`).join(", ");

  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${imports}${imports ? "\n\n" : ""}export const hash = ${hash === undefined ? "undefined" : JSON.stringify(hash)};
export const migrations = [${migrations}];
`,
    "utf8",
  );

  return output;
}

async function currentStructuralHash(paths: AppPaths): Promise<string | undefined> {
  if (!paths.types) return undefined;
  return structuralHash(await readFile(paths.types, "utf8"));
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
    `import type { Migration } from "@poggers/app";
import type { App as From } from "./snapshots/${previous.hash}.ts";
import type { App as To } from "./snapshots/${snapshot.hash}.ts";

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

function structuralHash(source: string): string {
  const normalized = persistentResourceSchemaSource(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function persistentResourceSchemaSource(source: string): string {
  const resourcesBlock = extractPropertyBlock(source, "Resources");
  if (!resourcesBlock) return source;

  const resourceParts = readObjectMemberEntries(resourcesBlock).map(({ name, value }) => {
    const fields = ["Key", "State", "Events"]
      .map((field) => `${field}: ${persistentResourceField(value, field)}`)
      .join("; ");
    return `${name}: { ${fields} }`;
  });
  const resourceSource = `Resources: { ${resourceParts.join("; ")} }`;
  const aliases = referencedTypeAliases(source, resourceSource);
  return [resourceSource, ...aliases].join("\n");
}

function persistentResourceField(resourceBlock: string, field: string): string {
  const block = extractPropertyBlock(resourceBlock, field);
  if (block) return `{ ${block} }`;
  return extractPropertyValue(resourceBlock, field) ?? "never";
}

function referencedTypeAliases(source: string, seed: string): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const queue = identifiersInTypeText(seed);

  for (let index = 0; index < queue.length; index++) {
    const name = queue[index]!;
    if (seen.has(name) || builtinTypeIdentifiers.has(name)) continue;
    seen.add(name);

    const alias = extractTypeAliasSource(source, name);
    if (!alias) continue;
    aliases.push(alias);
    for (const identifier of identifiersInTypeText(alias)) {
      if (!seen.has(identifier)) queue.push(identifier);
    }
  }

  return aliases.sort();
}

function identifiersInTypeText(source: string): string[] {
  return [...source.matchAll(/\b[A-Z][A-Za-z0-9_$]*\b/g)].map((match) => match[0]);
}

function extractTypeAliasSource(source: string, alias: string): string | undefined {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b(?:export\\s+)?type\\s+${escaped}(?:\\s*<[^=]+>)?\\s*=`).exec(
    source,
  );
  if (!match) return undefined;

  const end = findTypeAliasEnd(source, match.index + match[0].length);
  return source.slice(match.index, end).trim();
}

function findTypeAliasEnd(source: string, index: number): number {
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedStringEnd(source, index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") depth++;
    if (char === "}" || char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) return index + 1;
    index++;
  }
  return index;
}

const builtinTypeIdentifiers = new Set([
  "Array",
  "Date",
  "Error",
  "Exclude",
  "Extract",
  "Map",
  "NonNullable",
  "Omit",
  "Parameters",
  "Partial",
  "Pick",
  "Promise",
  "Readonly",
  "Record",
  "ReturnType",
  "Set",
]);

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
  const issues: AppConventionIssue[] = [];
  const appSource = readFileSync(paths.ui, "utf8");
  const strictStyles = /\bstyles\s*:/.test(appSource);
  if (!strictStyles) return [];

  collectForbiddenGeneratedSurface(paths.ui, appSource, issues);
  collectForbiddenAppStyling(paths.ui, appSource, issues);
  const uiDir = resolve(paths.sourceDir, "ui");
  for (const file of sourceFiles(uiDir)) {
    const source = readFileSync(file, "utf8");
    collectUiFileConventions(uiDir, file, issues);
    collectForbiddenGeneratedSurface(file, source, issues);
    collectForbiddenUiStyling(file, source, issues);
    if (sourceImportsStylex(source)) {
      issues.push({
        file,
        message:
          "ui files must not import @stylexjs/stylex in strict style apps; put visual rules in app styles.",
      });
    }
  }

  if (paths.types) {
    const typesSource = readFileSync(paths.types, "utf8");
    collectForbiddenSpecSurface(paths.types, typesSource, issues);
  }

  return issues;
}

function collectForbiddenGeneratedSurface(
  file: string,
  source: string,
  issues: AppConventionIssue[],
) {
  if (/import\s*\{[^}]*\b(?:api|ui)\b[^}]*\}\s*from\s*["']@poggers\/app["']/.test(source)) {
    issues.push({
      file,
      message:
        "import direct generated functions from @poggers/app; do not import api or ui namespaces.",
    });
  }
  if (/\bui\.use[A-Z]/.test(source)) {
    issues.push({
      file,
      message: "render semantic UI through generated createX functions; ui.useX is not supported.",
    });
  }
}

function collectForbiddenSpecSurface(file: string, source: string, issues: AppConventionIssue[]) {
  if (/\bUI\s*:/.test(source)) {
    issues.push({
      file,
      message: "app specs must use top-level Components and Styles; do not define UI.",
    });
  }
  if (/\bSlots\s*:/.test(source)) {
    issues.push({
      file,
      message: "component specs must use PascalCase Parts; do not define Slots.",
    });
  }
  const componentsBlock = extractPropertyBlock(source, "Components");
  if (!componentsBlock) return;

  const components = readObjectMembers(componentsBlock);
  for (const [componentName, componentBlock] of Object.entries(components)) {
    const partsBlock = extractPropertyBlock(componentBlock, "Parts");
    if (!partsBlock) continue;
    for (const partName of Object.keys(readStringMembers(partsBlock))) {
      if (!/^[A-Z]/.test(partName)) {
        issues.push({
          file,
          message: `component ${componentName} part ${partName} must be PascalCase.`,
        });
      }
    }
  }
}

async function loadWorker<Spec extends AppSpec>(
  workerPath: string,
  appDir: string,
): Promise<AppWorker<Spec, unknown> | undefined> {
  const workerModule = await import(pathToFileURL(workerPath).href);
  const worker = (workerModule.default ?? workerModule.worker) as
    | WorkerDef<Spec, unknown>
    | undefined;

  if (!worker) return undefined;

  const deps =
    typeof workerModule.createWorkerDeps === "function"
      ? await workerModule.createWorkerDeps()
      : "deps" in workerModule
        ? await workerModule.deps
        : {};

  return {
    worker,
    deps,
    workerId: workerModule.workerId ?? `${titleFromDir(appDir)}-worker`,
    actor: workerModule.workerActor,
    store: workerModule.workerStore,
  };
}

async function loadProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  api: App<Spec>,
  apiModule: Record<string, any>,
  depsModule: Record<string, any>,
  env: Env,
  appDir: string,
): Promise<AppEnvironmentProgram<Spec, Env> | undefined> {
  const program = api.def.programs?.[env];
  if (!program) return undefined;

  const envName = String(env);
  const capitalizedEnv = capitalize(envName);
  const depsDefault = depsModule.default;
  const depsMounts = isRecord(depsDefault) ? depsDefault : {};
  const defaultDepsMount =
    depsDefault !== undefined && !(envName in depsMounts) ? depsDefault : undefined;
  const depsMount =
    api.def.deps?.[env] ??
    depsMounts[envName] ??
    defaultDepsMount ??
    apiModule[`create${capitalizedEnv}Deps`] ??
    apiModule.createProgramDeps ??
    depsModule[`create${capitalizedEnv}Deps`] ??
    depsModule.createProgramDeps;
  const legacyDepsMount =
    `${envName}Deps` in apiModule
      ? apiModule[`${envName}Deps`]
      : `${envName}Deps` in depsModule
        ? depsModule[`${envName}Deps`]
        : envName in depsMounts
          ? depsMounts[envName]
          : (defaultDepsMount ??
            ("programDeps" in apiModule
              ? apiModule.programDeps
              : "programDeps" in depsModule
                ? depsModule.programDeps
                : {}));
  const deps = await resolveDependencyMount<EnvironmentDeps<Spec, Env>>(
    depsMount ?? legacyDepsMount,
  );

  return {
    env,
    program,
    deps,
    programId: apiModule.programId ?? depsModule.programId ?? `${titleFromDir(appDir)}-${envName}`,
    actor: apiModule.programActor ?? depsModule.programActor,
    store: apiModule.programStore ?? depsModule.programStore,
  };
}

export async function resolveDependencyMount<Deps = Record<string, never>>(
  mount: unknown,
): Promise<Deps> {
  const resolved = typeof mount === "function" ? await mount() : await mount;
  if (!isDependencyConfig(resolved)) return (resolved ?? {}) as Deps;

  const mode =
    typeof resolved.mode === "function"
      ? await resolved.mode()
      : (resolved.mode ?? dependencyModeFromEnv() ?? "production");
  const providers =
    resolved.deps ??
    Object.fromEntries(
      Object.entries(resolved).filter(([name]) => name !== "mode" && name !== "deps"),
    );
  const deps: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(providers)) {
    if (isDependencyProviderSet(entry)) {
      const provider = entry[mode] ?? entry.production;
      if (provider === undefined)
        throw new Error(`Dependency ${name} is missing a ${mode} provider.`);
      deps[name] = await resolveDependencyProvider(provider);
    } else {
      deps[name] = await resolveDependencyProvider(entry);
    }
  }
  return deps as Deps;
}

function dependencyModeFromEnv(): string | undefined {
  const env = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return env?.POGGERS_DEPS ?? env?.POGGERS_DEPS_MODE ?? env?.POGGERS_DEPENDENCY_MODE;
}

function isDependencyConfig(value: unknown): value is {
  mode?: string | (() => string | Promise<string>);
  deps?: Record<string, unknown>;
  [name: string]: unknown;
} {
  if (!isRecord(value)) return false;
  if ("mode" in value) return true;
  if ("deps" in value) return isRecord(value.deps);
  return Object.entries(value).some(([, entry]) => isDependencyProviderSet(entry));
}

function isDependencyProviderSet(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "production" in value;
}

async function resolveDependencyProvider(provider: unknown): Promise<unknown> {
  return typeof provider === "function" ? await provider() : provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function selectProgramEnv<Spec extends AppSpec>(api: App<Spec>): EnvironmentName<Spec> {
  const programs = api.def.programs ?? {};
  if ("server" in programs) return "server" as EnvironmentName<Spec>;
  if ("browser" in programs) return "browser" as EnvironmentName<Spec>;
  const first = Object.keys(programs)[0];
  return (first ?? "server") as EnvironmentName<Spec>;
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

type StylexBuildOptions = {
  dev: boolean;
  cssOutput: string;
};

function sourceImportsStylex(source: string): boolean {
  return (
    /from\s+["']@stylexjs\/stylex["']/.test(source) ||
    /import\s*\(\s*["']@stylexjs\/stylex["']\s*\)/.test(source)
  );
}

function stylexCssOutput(buildDir: string): string {
  return resolve(buildDir, "stylex.generated.css");
}

async function createStylexBuildPlugins(options: StylexBuildOptions): Promise<Bun.BunPlugin[]> {
  const { createStylexBunPlugin } = await import("@stylexjs/unplugin/bun");
  const pluginOptions = {
    dev: options.dev,
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
  await writePoggersAppTypes(paths);
  const visualModule = await writeVisualStylexModule(paths, buildDir);
  const compiledStyles = await compileBrowserStyles(paths, buildDir, Boolean(visualModule));
  const stylexStyles = visualModule ? stylexCssOutput(buildDir) : undefined;
  const appPlugins = paths.embedded
    ? [
        createPoggersKitSourcePlugin(),
        createPoggersAppAliasesPlugin(paths),
        createPoggersAppPlugin(paths, visualModule),
      ]
    : [createPoggersKitSourcePlugin(), createPoggersAppAliasesPlugin(paths)];
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
  const source = paths.embedded
    ? nativeBrowserEntrySource(styleImport, {
        rootImport: `import { Root, initialize as initializePoggersApp } from "@poggers/app";`,
        setup: "await initializePoggersApp();",
        rootExpression: "Root({})",
        dev: Boolean(options.dev),
      })
    : nativeBrowserEntrySource(styleImport, {
        rootImport: `import Root from ${JSON.stringify(importSpecifier(entrypoint, paths.ui))};`,
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
  const changed = resolve(changedPath);
  if (shouldRebuildBrowserStyles(paths, changed)) {
    const visualModule = await writeVisualStylexModule(paths, buildDir);
    await compileBrowserStyles(paths, buildDir, Boolean(visualModule));
  }
  if (changed === resolve(paths.api) || (paths.types && changed === resolve(paths.types))) {
    await writeGeneratedTypeArtifacts(paths);
  }
}

function shouldRebuildBrowserStyles(paths: AppPaths, changed: string): boolean {
  if (!isSourceReloadFile(paths, changed)) return false;
  return paths.embedded;
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
  await writePoggersAppTypes(paths);
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
    renderImported?: boolean;
    dev: boolean;
  },
): string {
  const renderImport = options.renderImported
    ? options.dev
      ? `import type { HotRenderState } from "@poggers/kit/ui";\n`
      : ""
    : options.dev
      ? `import { render, type HotRenderState } from "@poggers/kit/ui";\n`
      : `import { render } from "@poggers/kit/ui";\n`;
  const renderBlock = options.dev
    ? `type HotData = { cleanup?: () => void; hotState?: HotRenderState };
const hotGlobal = globalThis as typeof globalThis & { __poggersHotData?: HotData };
const hotData = (hotGlobal.__poggersHotData ??= import.meta.hot
  ? (import.meta.hot.data as HotData)
  : {});
if (import.meta.hot) Object.assign(hotData, import.meta.hot.data as HotData);
let cleanup = hotData.cleanup;
const hotState = (hotData.hotState ??= {});

function renderRoot() {
  cleanup?.();
  cleanup = render(() => ${options.rootExpression}, root, hotState);
  hotData.cleanup = cleanup;
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
  if (!paths.embedded) return undefined;
  const apiModule = await importBuiltAppModule(paths);
  const api = normalizeLoadedApp(apiModule);
  const styles = recordValue(api?.def?.styles);
  const presets = recordValue(styles.presets);
  if (!Object.keys(presets).length) return undefined;

  if (!paths.types) throw new Error("Poggers visual apps require src/types.ts.");
  const contract = analyzeVisualContract(paths.types);
  const sourceLocations = analyzeVisualPresetSources(paths.api, paths.sourceDir);
  const visualEntries = Object.entries(presets).filter(([, preset]) =>
    looksLikeVisualPreset(preset),
  );
  if (!visualEntries.length) return undefined;
  if (visualEntries.length !== Object.keys(presets).length) {
    throw new Error("Every Poggers preset must use the closed visual preset format.");
  }

  const materialized = visualEntries.map(([name, preset]) => {
    const declaration = contract.presets.find((candidate) => candidate.name === name);
    if (!declaration)
      throw new Error(`Visual preset ${JSON.stringify(name)} is missing from App.Styles.`);
    try {
      return materializeVisualPreset(name, preset, contract.surface);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const location = sourceLocations[name] ?? declaration.location;
      throw new Error(`${location.file}:${location.line}:${location.column}: ${message}`);
    }
  });
  const output = resolve(buildDir, "visual.generated.stylex.ts");
  let generated: string;
  try {
    generated = generateVisualStylexModule(materialized);
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
  const preset = recordValue(value);
  if (typeof preset.components !== "function" || !preset.tokens) return false;
  const tokenRefs = Object.fromEntries(
    Object.entries(recordValue(preset.tokens)).map(([group, definitions]) => [
      group,
      Object.fromEntries(
        Object.keys(recordValue(definitions)).map((name) => [
          name,
          { $visual: "token", group, name },
        ]),
      ),
    ]),
  );
  try {
    const components = recordValue(preset.components({ tokens: tokenRefs }));
    const values = Object.values(components);
    return values.length > 0 && values.every((component) => typeof component === "function");
  } catch {
    return false;
  }
}

async function compileVisualReset(buildDir: string): Promise<string> {
  const output = resolve(buildDir, "styles.generated.css");
  await writeGeneratedFile(output, visualResetCss);
  return output;
}

const visualResetCss = `@layer reset {
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; min-inline-size: 0; }
  html { min-block-size: 100%; -webkit-text-size-adjust: 100%; }
  body, #root { min-block-size: 100%; }
  #root { container: app / inline-size; }
  body { line-height: 1; text-rendering: optimizeSpeed; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  a { color: inherit; text-decoration: none; }
  ol, ul { list-style: none; }
  h1, h2, h3, h4, h5, h6 { font: inherit; }
  button, input, textarea, select, option { appearance: none; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; }
  button, select { cursor: pointer; }
  button:disabled, input:disabled, textarea:disabled, select:disabled { cursor: not-allowed; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
  textarea { resize: vertical; }
  img, picture, video, canvas, svg { display: block; max-inline-size: 100%; block-size: auto; }
  table { border-collapse: collapse; border-spacing: 0; }
  p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
  [hidden] { display: none !important; }
  [popover] { inset: auto; }
  [popover]:not(:popover-open) { display: none !important; }
}

@layer motion {
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

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

async function importBuiltAppModule(paths: AppPaths): Promise<Record<string, any>> {
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
): Promise<Record<string, any>> {
  const tempFile = resolve(
    buildDir,
    `${prefix}.${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeBuiltAppModule(entrypoint, tempFile, plugins);
  try {
    return await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`);
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
      build.onResolve({ filter: /^(?:app|deps|types|ui\/.*|src\/.*)$/ }, (args) => {
        const target = resolveAppAlias(paths, args.path);
        return target ? { path: target } : undefined;
      });
    },
  };
}

function resolveAppAlias(paths: AppPaths, specifier: string): string | undefined {
  if (specifier === "app") return paths.api;
  if (specifier === "deps") return paths.deps;
  if (specifier === "types") return paths.types;
  if (specifier.startsWith("ui/")) {
    return resolveSourceModule(resolve(paths.sourceDir, specifier));
  }
  if (specifier.startsWith("src/")) {
    return resolveSourceModule(resolve(paths.sourceDir, specifier.slice("src/".length)));
  }
}

function resolveSourceModule(path: string): string | undefined {
  return firstExisting([path, `${path}.ts`, `${path}.tsx`, `${path}.mts`, `${path}.cts`]);
}

function createPoggersKitSourcePlugin(): Bun.BunPlugin {
  return {
    name: "poggers-kit-source",
    setup(build) {
      build.onResolve({ filter: /^@poggers\/kit(?:\/.*)?$/ }, (args) => {
        const target = resolvePoggersKitSource(args.path);
        return { path: target };
      });
      build.onResolve({ filter: /^alien-signals$/ }, () => ({ path: alienSignalsEntrypoint }));
    },
  };
}

function resolvePoggersKitSource(path: string): string {
  const subpath = path.slice("@poggers/kit".length).replace(/^\//, "");
  if (subpath === "style") return resolve(kitSourceDir, "preset.ts");
  if (subpath === "internal-style") return resolve(kitSourceDir, "component-runtime.ts");
  return subpath ? resolve(kitSourceDir, `${subpath}.ts`) : resolve(kitSourceDir, "index.ts");
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
): Promise<string> {
  const output = resolve(buildDir, "app.source.generated.ts");
  const source = rewriteServerAppImports(
    readFileSync(paths.api, "utf8"),
    dirname(paths.api),
    stubPath,
  );
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
  const stylesLoad = "styles = app.def.styles ?? { presets: { default: {} } };";
  const componentParts = JSON.stringify(componentPartsRecord(surface));
  const resourceExports = surface.resources
    .map(({ name: resource }) => {
      const name = `use${capitalize(resource)}`;
      return `export function ${name}(key) {
  return getHooks().${name}(key);
}`;
    })
    .join("\n\n");
  const componentExports = Object.values(surface.components)
    .map(({ name: component }) => {
      const name = `create${capitalize(component)}`;
      return `export function ${name}(input) {
  return getHooks().${name}(input);
}`;
    })
    .join("\n\n");

  const visualImport = visualModule
    ? `import { compiledVisuals } from ${JSON.stringify(visualModule)};`
    : "const compiledVisuals = undefined;";
  return `import { defineApp } from "@poggers/kit";
import { createHooks } from "@poggers/kit/internal-style";
import { createBrowserConnectOptions } from "@poggers/kit/ui";
${visualImport}

const components = ${componentParts};
let app;
let styles;
let hooks;
let initializePromise;

export async function initialize() {
  if (app && styles) return;
  if (!initializePromise) {
    initializePromise = (async () => {
      const appModule = await import(${JSON.stringify(paths.api)});
      const rawApp = appModule.default ?? appModule.app ?? appModule;
      app = rawApp?.def?.resources ? rawApp : defineApp(rawApp);
      ${stylesLoad}
    })();
  }
  await initializePromise;
}

function requireInitialized() {
  if (!app || !styles) {
    throw new Error("@poggers/app was used before it finished initializing.");
  }
}

function getHooks() {
  requireInitialized();
  if (!hooks) hooks = createHooks({ app, styles, components, compiledVisuals });
  return hooks;
}

${resourceExports}

${componentExports}

export const nav = new Proxy({}, {
  get(_target, prop) {
    return getHooks().nav[prop];
  },
});

export function useScreen() {
  return getHooks().useScreen();
}

export function usePreset() {
  return getHooks().usePreset();
}

export function setPreset(preset) {
  getHooks().setPreset(preset);
}

export function useThemeName() {
  return getHooks().useThemeName();
}

export function setTheme(theme) {
  getHooks().setTheme(theme);
}

export function start(connect) {
  getHooks().start(connect ?? createBrowserConnectOptions());
}

export function Root(props = {}) {
  start(props.connect);
  requireInitialized();
  const root = app.def.root ?? app.def.ui;
  if (!root) throw new Error("App definition does not include a root function.");
  return root(getHooks());
}

export default Root;
`;
}

function poggersServerAppStubSource(paths: AppPaths): string {
  const surface = collectAppSurface(paths);
  const unavailableExports = [
    ...surface.resources.map(({ name: resource }) => `use${capitalize(resource)}`),
    ...Object.values(surface.components).map(
      ({ name: component }) => `create${capitalize(component)}`,
    ),
  ]
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
export function usePreset() { throwUnavailable("usePreset"); }
export function setPreset() { throwUnavailable("setPreset"); }
export function useThemeName() { throwUnavailable("useThemeName"); }
export function setTheme() { throwUnavailable("setTheme"); }
export function start() {}
export function Root() {
  return null;
}
export default Root;
`;
}

type AppSurfaceResource = {
  name: string;
  events: string[];
  views: string[];
  commands: AppSurfaceCommand[];
  doc?: string;
};

type AppSurfaceCommand = {
  name: string;
  hasArgs: boolean;
  hasError: boolean;
  eventName?: string;
};

type AppSurfaceAction = {
  name: string;
  handlerType: string;
};

type AppSurfaceNavigation = {
  name: string;
  hasParams: boolean;
  paramsType: string;
};

type AppSurfaceEnvironment = {
  name: string;
  depsType: string;
};

type AppSurfaceComponent = {
  name: string;
  parts: Record<string, string>;
  variants: AppSurfaceVariant[];
  styleValues: AppSurfaceStyleValue[];
  hasInput: boolean;
  hasState: boolean;
  hasDerived: boolean;
  hasActions: boolean;
  derived: string[];
  actions: AppSurfaceAction[];
  needsInput: boolean;
  doc?: string;
};

type AppSurfaceVariant = {
  name: string;
  values: string[];
};

type AppSurfaceStyleValue = {
  name: string;
  kind: string;
};

type AppSurfaceStyleToken = {
  group: string;
  name: string;
  kind: string;
};

type AppSurfaceStyleContainer = {
  name: string;
  min?: string;
  max?: string;
};

type AppSurfaceStylePreset = {
  name: string;
  tokens: AppSurfaceStyleToken[];
  themes: string[];
  containers: AppSurfaceStyleContainer[];
  visual: boolean;
};

type AppSurface = {
  resources: AppSurfaceResource[];
  environments: AppSurfaceEnvironment[];
  components: Record<string, AppSurfaceComponent>;
  navigation: AppSurfaceNavigation[];
  presetType?: string;
  stylePresets: AppSurfaceStylePreset[];
};

function collectAppSurface(paths: AppPaths): AppSurface {
  const fallback: AppSurface = {
    resources: [],
    environments: [],
    components: {},
    navigation: [{ name: "home", hasParams: false, paramsType: "EmptyObject" }],
    stylePresets: [],
  };
  if (!paths.types || !existsSync(paths.types)) return fallback;

  const source = readFileSync(paths.types, "utf8");
  const resourcesBlock = extractPropertyBlock(source, "Resources");
  const environmentsBlock = extractPropertyBlock(source, "Environments");
  const depsType = extractPropertyValue(source, "Deps");
  const componentsBlock = extractPropertyBlock(source, "Components");
  const navigationBlock = extractPropertyBlock(source, "Navigation");
  const stylesBlock = extractPropertyBlock(source, "Styles");
  const presetsBlock = stylesBlock ? extractPropertyBlock(stylesBlock, "Presets") : undefined;
  const resources = resourcesBlock
    ? readObjectMemberEntries(resourcesBlock).map(({ name, value, doc }) => {
        const viewsBlock = resolveTypePropertyBlock(source, value, "Views");
        const eventsBlock = resolveTypePropertyBlock(source, value, "Events");
        const commandsBlock = resolveTypePropertyBlock(source, value, "Commands");
        const commands = commandsBlock
          ? readTypeMemberEntries(commandsBlock).map((command) => {
              const eventName = stringLiteralValue(extractPropertyValue(command.value, "event"));
              return {
                name: command.name,
                hasArgs: Boolean(extractPropertyValue(command.value, "args")),
                hasError: Boolean(extractPropertyValue(command.value, "error")),
                eventName,
              };
            })
          : [];
        return {
          name,
          events: eventsBlock ? readTypeMemberNames(eventsBlock) : [],
          views: viewsBlock ? readTypeMemberNames(viewsBlock) : [],
          commands,
          doc,
        };
      })
    : [];
  const components: Record<string, AppSurfaceComponent> = {};

  if (componentsBlock) {
    const componentMembers = readObjectMemberEntries(componentsBlock);
    for (const { name: componentName, value: componentBlock, doc } of componentMembers) {
      const partsBlock = extractPropertyBlock(componentBlock, "Parts");
      const variantsBlock = extractPropertyBlock(componentBlock, "Variants");
      const variants = variantsBlock ? readStyleVariants(source, variantsBlock) : [];
      const styleValuesBlock = extractPropertyBlock(componentBlock, "StyleValues");
      const styleValues = styleValuesBlock
        ? readComponentStyleValues(styleValuesBlock, componentName)
        : [];
      const derivedBlock = extractPropertyBlock(componentBlock, "Derived");
      const actionsBlock = extractPropertyBlock(componentBlock, "Actions");
      const actionEntries = actionsBlock ? readTypeMemberEntries(actionsBlock) : [];
      if (!partsBlock) continue;
      const hasInput = Boolean(extractPropertyBlock(componentBlock, "Input"));
      const hasState = Boolean(extractPropertyBlock(componentBlock, "State"));
      const hasDerived = Boolean(derivedBlock);
      const hasActions = Boolean(actionsBlock);
      components[componentName] = {
        name: componentName,
        parts: readStringMembers(partsBlock),
        variants,
        styleValues,
        hasInput,
        hasState,
        hasDerived,
        hasActions,
        derived: derivedBlock ? readTypeMemberNames(derivedBlock) : [],
        actions: actionEntries.map((action) => ({
          name: action.name,
          handlerType: actionHandlerType(action.value),
        })),
        needsInput: hasInput || variants.length > 0,
        doc,
      };
    }
  }

  return {
    resources,
    environments: environmentsBlock
      ? readObjectMemberEntries(environmentsBlock).map(({ name }) => ({
          name,
          depsType: `AppSpec["Environments"][${JSON.stringify(name)}] extends { Deps: infer Deps } ? Deps : EmptyObject`,
        }))
      : depsType
        ? [
            {
              name: "server",
              depsType: `AppSpec extends { Deps: infer Deps } ? Deps : EmptyObject`,
            },
          ]
        : [],
    components,
    navigation: navigationBlock
      ? readObjectMemberEntries(navigationBlock).map(({ name, value }) => ({
          name,
          hasParams: readTypeMemberEntries(value).length > 0,
          paramsType: `AppSpec["Navigation"][${JSON.stringify(name)}]`,
        }))
      : [{ name: "home", hasParams: false, paramsType: "EmptyObject" }],
    presetType: stylePresetType(stylesBlock, presetsBlock),
    stylePresets: presetsBlock ? readStylePresets(source, presetsBlock) : [],
  };
}

function stylePresetType(
  stylesBlock: string | undefined,
  presetsBlock: string | undefined,
): string | undefined {
  if (presetsBlock) {
    const names = readObjectMemberEntries(presetsBlock).map((preset) =>
      JSON.stringify(preset.name),
    );
    return names.length ? names.join(" | ") : undefined;
  }
  return stylesBlock ? extractPropertyValue(stylesBlock, "Presets") : undefined;
}

function styleThemeNameType(surface: AppSurface): string {
  const themes = new Set<string>(["default"]);
  for (const preset of surface.stylePresets) {
    for (const theme of preset.themes) themes.add(theme);
  }
  return [...themes].map((theme) => JSON.stringify(theme)).join(" | ");
}

function readStyleVariants(source: string, block: string): AppSurfaceVariant[] {
  return readTypeMemberEntries(block).map((variant) => ({
    name: variant.name,
    values: stringLiteralsFromType(source, variant.value),
  }));
}

function readComponentStyleValues(block: string, componentName: string): AppSurfaceStyleValue[] {
  return readTypeMemberEntries(block).map((value) => ({
    name: value.name,
    kind: readKnownStyleValueKind(
      stringLiteralValue(value.value) ?? value.value.trim(),
      `Components.${componentName}.StyleValues.${value.name}`,
    ),
  }));
}

function readStylePresets(source: string, block: string): AppSurfaceStylePreset[] {
  return readObjectMemberEntries(block).map(({ name, value }) => {
    const tokensBlock = resolveTypePropertyBlock(source, value, "Tokens");
    const themesValue = extractPropertyValue(value, "Themes");
    const containersBlock = resolveTypePropertyBlock(source, value, "Containers");
    return {
      name,
      tokens: tokensBlock ? readStyleTokens(tokensBlock, name) : [],
      themes: themesValue ? stringLiteralsFromUnion(themesValue) : [],
      containers: containersBlock ? readStyleContainers(containersBlock) : [],
      visual: tokensBlock ? visualTokenContract(tokensBlock) : false,
    };
  });
}

function readStyleTokens(block: string, presetName: string): AppSurfaceStyleToken[] {
  const tokens: AppSurfaceStyleToken[] = [];
  const legacyGroups = readObjectMemberEntries(block);
  if (!legacyGroups.length) {
    for (const group of readTypeMemberEntries(block)) {
      for (const name of stringLiteralsFromUnion(group.value)) {
        tokens.push({ group: group.name, name, kind: group.name });
      }
    }
    return tokens;
  }
  for (const group of legacyGroups) {
    for (const token of readTypeMemberEntries(group.value)) {
      const kind = readKnownTokenKind(
        stringLiteralValue(token.value) ?? token.value.trim(),
        `Styles.Presets.${presetName}.Tokens.${group.name}.${token.name}`,
      );
      tokens.push({ group: group.name, name: token.name, kind });
    }
  }
  return tokens;
}

function visualTokenContract(block: string): boolean {
  const groups = readTypeMemberEntries(block);
  return (
    groups.length > 0 &&
    groups.every(
      (group) =>
        !group.value.trimStart().startsWith("{") && stringLiteralsFromUnion(group.value).length > 0,
    )
  );
}

const knownStyleValueKinds = new Set([
  "number",
  "progress",
  "opacity",
  "ratio",
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

function readStyleContainers(block: string): AppSurfaceStyleContainer[] {
  return readObjectMemberEntries(block).map(({ name, value }) => ({
    name,
    min: stringLiteralValue(extractPropertyValue(value, "min")),
    max: stringLiteralValue(extractPropertyValue(value, "max")),
  }));
}

function stringLiteralsFromUnion(value: string): string[] {
  return [...value.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!).filter(Boolean);
}

function stringLiteralsFromType(source: string, value: string): string[] {
  const direct = stringLiteralsFromUnion(value);
  if (direct.length) return direct;

  const alias = /^([A-Za-z_$][\w$]*)$/.exec(value.trim());
  if (!alias) return [];

  const aliasValue = extractTypeAliasValue(source, alias[1]!);
  return aliasValue ? stringLiteralsFromUnion(aliasValue) : [];
}

function componentPartsRecord(surface: AppSurface): Record<string, Record<string, string>> {
  const components: Record<string, Record<string, string>> = {};
  for (const component of Object.values(surface.components)) {
    components[component.name] = component.parts;
  }
  return components;
}

function extractPropertyBlock(source: string, property: string): string | undefined {
  const match = new RegExp(`\\b${property}\\s*:`).exec(source);
  if (!match) return undefined;
  const openIndex = source.indexOf("{", match.index + match[0].length);
  if (openIndex < 0) return undefined;
  const closeIndex = findMatchingBrace(source, openIndex);
  return closeIndex < 0 ? undefined : source.slice(openIndex + 1, closeIndex);
}

function resolveTypePropertyBlock(
  source: string,
  ownerBlock: string,
  property: string,
): string | undefined {
  const inline = extractPropertyBlock(ownerBlock, property);
  if (inline) return inline;

  const value = extractPropertyValue(ownerBlock, property);
  const alias = /^([A-Za-z_$][\w$]*)$/.exec(value ?? "");
  return alias ? extractTypeAliasBlock(source, alias[1]!) : undefined;
}

function extractTypeAliasBlock(source: string, alias: string): string | undefined {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b(?:export\\s+)?type\\s+${escaped}\\s*=`).exec(source);
  if (!match) return undefined;
  const openIndex = source.indexOf("{", match.index + match[0].length);
  if (openIndex < 0) return undefined;
  const closeIndex = findMatchingBrace(source, openIndex);
  return closeIndex < 0 ? undefined : source.slice(openIndex + 1, closeIndex);
}

function extractTypeAliasValue(source: string, alias: string): string | undefined {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b(?:export\\s+)?type\\s+${escaped}\\s*=`).exec(source);
  if (!match) return undefined;

  const valueStart = skipTrivia(source, match.index + match[0].length);
  const valueEnd = trimMemberValueEnd(source, skipMemberValue(source, valueStart));
  return source.slice(valueStart, valueEnd).trim();
}

function readObjectMembers(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { name, value } of readObjectMemberEntries(block)) {
    result[name] = value;
  }
  return result;
}

function readObjectMemberEntries(
  block: string,
): Array<{ name: string; value: string; doc?: string }> {
  const result: Array<{ name: string; value: string; doc?: string }> = [];
  let index = 0;

  while (index < block.length) {
    const trivia = skipTriviaWithJsDoc(block, index);
    index = trivia.index;
    const key = readMemberKey(block, index);
    if (!key) {
      index++;
      continue;
    }

    index = skipTrivia(block, key.end);
    if (block[index] !== ":") {
      index++;
      continue;
    }

    index = skipTrivia(block, index + 1);
    if (block[index] !== "{") {
      index = skipMemberValue(block, index);
      continue;
    }

    const closeIndex = findMatchingBrace(block, index);
    if (closeIndex < 0) break;
    result.push({
      name: key.name,
      value: block.slice(index + 1, closeIndex),
      doc: trivia.doc,
    });
    index = closeIndex + 1;
  }

  return result;
}

function readTypeMemberEntries(
  block: string,
): Array<{ name: string; value: string; doc?: string }> {
  const result: Array<{ name: string; value: string; doc?: string }> = [];
  let index = 0;

  while (index < block.length) {
    const trivia = skipTriviaWithJsDoc(block, index);
    index = trivia.index;
    const key = readMemberKey(block, index);
    if (!key) {
      index++;
      continue;
    }

    index = skipTrivia(block, key.end);
    const separator = block[index];
    if (separator === ":") {
      const valueStart = skipTrivia(block, index + 1);
      const valueEnd = trimMemberValueEnd(block, skipMemberValue(block, valueStart));
      result.push({
        name: key.name,
        value: block.slice(valueStart, valueEnd).trim(),
        doc: trivia.doc,
      });
      index = valueEnd + 1;
      continue;
    }

    if (separator === "(") {
      const valueEnd = trimMemberValueEnd(block, skipMemberValue(block, index));
      result.push({
        name: key.name,
        value: block.slice(index, valueEnd).trim(),
        doc: trivia.doc,
      });
      index = valueEnd + 1;
      continue;
    }

    index++;
  }

  return result;
}

function readTypeMemberNames(block: string): string[] {
  return readTypeMemberEntries(block).map((member) => member.name);
}

function actionHandlerType(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("(")) {
    const closeIndex = findMatchingParen(trimmed, 0);
    if (closeIndex >= 0) {
      return `(${trimmed.slice(1, closeIndex).trim()}) => void`;
    }
  }

  const arrowIndex = trimmed.indexOf("=>");
  if (arrowIndex >= 0) {
    const params = trimmed.slice(0, arrowIndex).trim();
    return `${params} => void`;
  }

  if (trimmed.startsWith("[")) return `(...args: ${trimmed}) => void`;
  return "() => void";
}

function stringLiteralValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = readQuotedStringEnd(trimmed, 0);
  return end > 0 ? trimmed.slice(1, end) : undefined;
}

function readStringMembers(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  let index = 0;

  while (index < block.length) {
    index = skipTrivia(block, index);
    const key = readMemberKey(block, index);
    if (!key) {
      index++;
      continue;
    }

    index = skipTrivia(block, key.end);
    if (block[index] !== ":") {
      index++;
      continue;
    }

    index = skipTrivia(block, index + 1);
    const quote = block[index];
    if (quote !== '"' && quote !== "'") {
      index = skipMemberValue(block, index);
      continue;
    }

    const end = readQuotedStringEnd(block, index);
    if (end < 0) break;
    result[key.name] = block.slice(index + 1, end);
    index = end + 1;
  }

  return result;
}

function extractPropertyValue(source: string, property: string): string | undefined {
  const match = new RegExp(`\\b${property}\\s*:`).exec(source);
  if (!match) return undefined;
  const valueStart = skipTrivia(source, match.index + match[0].length);
  const valueEnd = trimMemberValueEnd(source, skipMemberValue(source, valueStart));
  return source.slice(valueStart, valueEnd).trim();
}

function trimMemberValueEnd(source: string, index: number): number {
  while (index > 0 && /[\s,;]/.test(source[index - 1] ?? "")) index--;
  return index;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedStringEnd(source, index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readMemberKey(source: string, index: number): { name: string; end: number } | undefined {
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const end = readQuotedStringEnd(source, index);
    if (end < 0) return undefined;
    return { name: source.slice(index + 1, end), end: end + 1 };
  }

  const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
  if (!match) return undefined;
  return { name: match[0], end: index + match[0].length };
}

function skipMemberValue(source: string, index: number): number {
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedStringEnd(source, index);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") depth++;
    if (char === "}" || char === ")" || char === "]") {
      if (depth === 0) return index;
      depth--;
    }
    if ((char === ";" || char === ",") && depth === 0) return index + 1;
    index++;
  }
  return index;
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index++) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedStringEnd(source, index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readQuotedStringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === quote) return index;
  }
  return -1;
}

function skipTrivia(source: string, index: number): number {
  while (index < source.length) {
    const char = source[index];
    if (char === undefined) return index;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function skipTriviaWithJsDoc(source: string, index: number): { index: number; doc?: string } {
  let doc: string | undefined;

  while (index < source.length) {
    const char = source[index];
    if (char === undefined) return { index, doc };
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (source.startsWith("/**", index)) {
      const end = source.indexOf("*/", index + 3);
      if (end < 0) return { index: source.length, doc };
      doc = source.slice(index, end + 2);
      index = end + 2;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }

  return { index, doc };
}

function jsDoc(doc: string | undefined, fallback: string): string {
  const source = doc?.trim();
  if (source?.startsWith("/**")) return source;
  return `/** ${fallback} */`;
}

function resourceTypeDefinitions(resource: AppSurfaceResource): string {
  const resourceName = JSON.stringify(resource.name);
  const typeName = pascalIdentifier(resource.name);
  const viewFields = resource.views.map(
    (view) => `  readonly ${propertyKey(view)}: ${typeName}ResourceViews[${JSON.stringify(view)}];`,
  );
  const commandFields = resource.commands.map((command) => {
    const commandName = JSON.stringify(command.name);
    const commandType = `${typeName}ResourceCommands[${commandName}]`;
    const args = command.hasArgs ? `${commandType}["args"]` : "[]";
    const error = command.hasError ? `${commandType}["error"]` : "never";
    return `  ${propertyKey(command.name)}(
    ...args: ${args}
  ): CommandReceipt<${error}>;`;
  });
  return `${jsDoc(resource.doc, `Access the ${resource.name} resource.`)}
type ${typeName}ResourceSpec = AppSpec["Resources"][${resourceName}];
type ${typeName}ResourceViews = ${typeName}ResourceSpec["Views"];
type ${typeName}ResourceCommands = ${typeName}ResourceSpec["Commands"];
export type ${typeName}ResourceKey = ${typeName}ResourceSpec["Key"];
export type ${typeName}Resource = {
${[...viewFields, ...commandFields, "  readonly sync: SyncMeta;"].join("\n")}
};
export function use${capitalize(resource.name)}(key: ${typeName}ResourceKey): ${typeName}Resource;`;
}

function navigationTypes(surface: AppSurface): string {
  const screens =
    surface.navigation.length === 1
      ? `{ readonly name: ${JSON.stringify(surface.navigation[0]!.name)}; readonly params: ${surface.navigation[0]!.paramsType} }`
      : surface.navigation
          .map(
            (screen) =>
              `  | { readonly name: ${JSON.stringify(screen.name)}; readonly params: ${screen.paramsType} }`,
          )
          .join("\n");
  const navFields = surface.navigation.map((screen) => {
    const params = screen.hasParams
      ? `params: ${screen.paramsType}`
      : `params?: ${screen.paramsType}`;
    return `  ${propertyKey(screen.name)}(${params}): void;`;
  });
  const screenType =
    surface.navigation.length === 1
      ? `export type AppScreen = ${screens};`
      : `export type AppScreen =\n${screens};`;
  return `${screenType}
export type AppNavigation = {
${navFields.join("\n")}
};`;
}

function componentTypeDefinitions(component: AppSurfaceComponent): string {
  const componentName = JSON.stringify(component.name);
  const typeName = pascalIdentifier(component.name);
  const specType = `AppSpec["Components"][${componentName}]`;
  const partNames = Object.keys(component.parts);
  const inputType = component.hasInput ? `${specType}["Input"]` : "EmptyObject";
  const variantsType = component.variants.length ? `${specType}["Variants"]` : "EmptyObject";
  const stateType = component.hasState ? `${specType}["State"]` : "EmptyObject";
  const derivedType = component.hasDerived ? `${specType}["Derived"]` : "EmptyObject";
  const actionsType = component.hasActions ? `${specType}["Actions"]` : "EmptyObject";
  const styleValuesType = component.styleValues.length
    ? `ComponentStyleValues<${specType}["StyleValues"]>`
    : "EmptyObject";
  const actionFields = component.actions.map(
    (action) => `  readonly ${propertyKey(action.name)}: ${action.handlerType};`,
  );
  const actionInstanceFields = component.actions.map(
    (action) =>
      `  readonly ${propertyKey(action.name)}: ${typeName}ActionHandlers[${JSON.stringify(action.name)}];`,
  );
  const derivedFields = component.derived.map(
    (derived) =>
      `  readonly ${propertyKey(derived)}: ${typeName}Derived[${JSON.stringify(derived)}];`,
  );
  const refFields = partNames.map((part) => `  readonly ${propertyKey(part)}?: Element | null;`);
  const partFields = Object.entries(component.parts).map(
    ([partName, elementName]) =>
      `  readonly ${propertyKey(partName)}: (props?: ${partPropsType(elementName)}) => Child;`,
  );
  const optionFields = [
    component.hasInput ? `  input: ${typeName}Input;` : `  input?: ${typeName}Input;`,
    component.variants.length
      ? `  variants: ${typeName}Variants;`
      : `  variants?: ${typeName}Variants;`,
  ];
  const actionHandlerBlock = actionFields.length
    ? `type ${typeName}ActionHandlers = {
${actionFields.join("\n")}
};`
    : `type ${typeName}ActionHandlers = {};`;
  return `${jsDoc(component.doc, `Create a ${component.name} component instance.`)}
type ${typeName}Input = ${inputType};
type ${typeName}Variants = ${variantsType};
type ${typeName}State = ${stateType};
type ${typeName}Derived = ${derivedType};
type ${typeName}Actions = ${actionsType};
type ${typeName}StyleValues = ${styleValuesType};
${actionHandlerBlock}
type ${typeName}Refs = {
${refFields.join("\n")}
};
type ${typeName}DerivedContext = {
  readonly preset: AppPreset;
  readonly setPreset: (preset: AppPreset) => void;
  readonly theme: AppThemeName;
  readonly setTheme: (theme: AppThemeName) => void;
  readonly variants: ${typeName}Variants;
  readonly input: ${typeName}Input;
  readonly state: ${typeName}State;
  readonly refs: ${typeName}Refs;
};
type ${typeName}Context = ${typeName}DerivedContext & {
  readonly derived: ${typeName}Derived;
};
type ${typeName}ActionFactory = (ctx: ${typeName}Context) => ${typeName}ActionHandlers;
type ${typeName}DerivedFactory = (ctx: ${typeName}DerivedContext) => ${typeName}Derived;
export type ${typeName}Options = {
${optionFields.join("\n")}
};
export type ${typeName}Instance = {
  readonly input: ${typeName}Input;
  readonly variants: ${typeName}Variants;
  readonly state: ${typeName}State;
  readonly derived: ${typeName}Derived;
  readonly actions: ${typeName}ActionHandlers;
  readonly values: ${typeName}StyleValues;
  readonly refs: ${typeName}Refs;
${[...derivedFields, ...actionInstanceFields, ...partFields].join("\n")}
};
export function create${capitalize(component.name)}(${component.needsInput ? "input" : "input?"}: ${typeName}Options): ${typeName}Instance;`;
}

function appDefinitionTypes(surface: AppSurface): string {
  const resourceDefinitions = surface.resources.map(resourceDefinitionTypes).join("\n\n");
  const environmentDefinitions = environmentDefinitionTypes(surface);
  const programDefinitions = programDefinitionTypes(surface);
  const componentDefinitions = Object.values(surface.components)
    .map(componentDefinitionTypes)
    .join("\n\n");
  const definitionSections = [
    resourceDefinitions,
    environmentDefinitions,
    migrationDefinitionTypes(),
    programDefinitions,
    componentDefinitions,
  ]
    .filter(Boolean)
    .join("\n\n");
  const appDefinitionFields = [
    navigationDefinitionField(surface),
    depsDefinitionField(surface),
    programsDefinitionField(surface),
    componentsDefinitionField(surface),
  ].join("");
  return `type AppDefinitionSpecMarker<Spec> = {
  readonly __poggersAppSpec?: Spec;
};
type AppActor = AppSpec extends { Actor: infer Actor extends { id: string } }
  ? Actor
  : { id: string };
type SessionData<Actor, Presence> = {
  readonly id: string;
  readonly actor: Actor;
  readonly presence: Presence;
};
type ResourcePresence<Resource> = Resource extends { Presence: infer Presence }
  ? Presence
  : EmptyObject;
type CommandArgs<Command> = Command extends { args: infer Args extends any[] }
  ? Args
  : Command extends any[]
    ? Command
    : [];
type CommandError<Command> = Command extends { error: infer Error } ? Error : never;
type CommandErrorFn<Command> =
  CommandError<Command> extends string
    ? (code: CommandError<Command>) => void
    : CommandError<Command> extends [infer Code extends string, infer Data]
      ? (code: Code, data: Data) => void
      : never;
type AppMetadata = {
  name?: string;
};
type PwaIconDef =
  | string
  | {
      src: string;
      sizes?: string;
      type?: string;
      purpose?: string;
    };
type PwaDef = {
  name: string;
  shortName?: string;
  description?: string;
  themeColor: string;
  backgroundColor: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation?: string;
  startUrl?: string;
  scope?: string;
  icons?: {
    any?: PwaIconDef | PwaIconDef[];
    maskable?: PwaIconDef | PwaIconDef[];
  };
};
type AppUIContext = {
${surface.resources.map((resource) => `  use${capitalize(resource.name)}(key: ${pascalIdentifier(resource.name)}ResourceKey): ${pascalIdentifier(resource.name)}Resource;`).join("\n")}
  readonly screen: Signal<AppScreen>;
  readonly nav: AppNavigation;
};
type AppRoot = (ctx: AppUIContext) => unknown;

${definitionSections}

export type AppDefinition<Spec extends AppSpec = AppSpec> = AppDefinitionSpecMarker<Spec> & {
  version: number;
  app?: AppMetadata;
  pwa?: PwaDef;
${appDefinitionFields}
  styles?: StyleDefinition;
  root?: AppRoot;
  ui?: (ctx: AppUIContext) => unknown;
  resources: {
${surface.resources.map((resource) => `    ${propertyKey(resource.name)}: ${pascalIdentifier(resource.name)}ResourceDefinition;`).join("\n")}
  };
};`;
}

function migrationDefinitionTypes(): string {
  return `type MigrationSpec = { Resources: Record<string, any> };
type MigrationResourceName<Spec extends MigrationSpec> = Extract<keyof Spec["Resources"], string>;
type MigrationResourceState<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = Spec["Resources"][Resource] extends { State: infer State } ? State : never;
type MigrationResourceEvents<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = Spec["Resources"][Resource] extends { Events: infer Events extends Record<string, any> }
  ? Events
  : Record<string, never>;
export type ResourceState<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = MigrationResourceState<Spec, Resource>;
export type ResourceEventName<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = Extract<keyof MigrationResourceEvents<Spec, Resource>, string>;
export type ResourceEventPayload<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
  Event extends ResourceEventName<Spec, Resource>,
> = MigrationResourceEvents<Spec, Resource>[Event];
export type MigratedEvent<
  Spec extends MigrationSpec,
  Resource extends MigrationResourceName<Spec>,
> = {
  [Event in ResourceEventName<Spec, Resource>]: {
    name: Event;
    payload: ResourceEventPayload<Spec, Resource, Event>;
  };
}[ResourceEventName<Spec, Resource>];
export type Migration<From extends MigrationSpec, To extends MigrationSpec> = {
  readonly draft?: false;
  readonly from: string;
  readonly to: string;
  readonly migrate: {
    [Resource in Extract<MigrationResourceName<From>, MigrationResourceName<To>>]?: {
      state?: (state: ResourceState<From, Resource>) => ResourceState<To, Resource>;
      event?: <Event extends ResourceEventName<From, Resource>>(
        name: Event,
        payload: ResourceEventPayload<From, Resource, Event>,
      ) => MigratedEvent<To, Resource>;
    };
  };
};`;
}

function environmentDefinitionTypes(surface: AppSurface): string {
  const helpers = `type DependencyProvider<Value> = Value | (() => Value | Promise<Value>);
export type DependencyProviderSet<Value> = {
  production: DependencyProvider<Value>;
  mock?: DependencyProvider<Value>;
} & Record<string, DependencyProvider<Value> | undefined>;
export type DependencyEntry<Value> = DependencyProviderSet<Value> | DependencyProvider<Value>;
export type DependencyConfig<Deps> = {
  mode?: string | (() => string | Promise<string>);
  deps?: {
    [Name in keyof Deps]: DependencyEntry<Deps[Name]>;
  };
} & {
  [Name in keyof Deps]?: DependencyEntry<Deps[Name]>;
};
export type DependencyMount<Deps> = (() => Deps | Promise<Deps>) | Deps | DependencyConfig<Deps>;`;
  if (surface.environments.length === 0)
    return `${helpers}
export type DependencyMounts = EmptyObject;`;
  const aliases = surface.environments
    .map((env) => `export type ${pascalIdentifier(env.name)}Deps = ${environmentDepsType(env)};`)
    .join("\n");
  const appDependencies =
    surface.environments.length === 1
      ? `export type AppDependencies = ${pascalIdentifier(surface.environments[0]!.name)}Deps;
export type DependencyDefinition = DependencyConfig<AppDependencies>;`
      : "";
  return `${helpers}
${aliases}
${appDependencies}
export type DependencyMounts = {
${surface.environments
  .map((env) => `  ${propertyKey(env.name)}?: DependencyMount<${pascalIdentifier(env.name)}Deps>;`)
  .join("\n")}
};`;
}

function environmentDepsType(env: AppSurfaceEnvironment): string {
  return env.depsType;
}

function styleDefinitionTypes(surface: AppSurface): string {
  if (surface.stylePresets.some((preset) => !preset.visual)) {
    throw new Error("Only v2 visual presets are supported in App.Styles.");
  }
  return `export type StyleDefinition = {
  defaultPreset?: AppPreset;
  presets: { [Preset in AppPreset]: VisualPreset<AppSpec, Preset> };
};`;
}

function navigationDefinitionField(surface: AppSurface): string {
  if (surface.navigation.length === 0) return "";
  return `  navigation?: {\n${surface.navigation
    .map((screen) => `    ${propertyKey(screen.name)}: string;`)
    .join("\n")}\n  };\n`;
}

function depsDefinitionField(surface: AppSurface): string {
  if (surface.environments.length === 0) return "";
  return `  deps?: {\n${surface.environments
    .map(
      (env) => `    ${propertyKey(env.name)}?: DependencyMount<${pascalIdentifier(env.name)}Deps>;`,
    )
    .join("\n")}\n  };\n`;
}

function programsDefinitionField(surface: AppSurface): string {
  if (surface.environments.length === 0) return "";
  return `  programs?: {\n${surface.environments
    .map(
      (env) =>
        `    ${propertyKey(env.name)}?: (ctx: ${pascalIdentifier(env.name)}ProgramContext, deps: ${pascalIdentifier(env.name)}Deps) => void | Promise<void>;`,
    )
    .join("\n")}\n  };\n`;
}

function componentsDefinitionField(surface: AppSurface): string {
  const components = Object.values(surface.components);
  if (components.length === 0) return "";
  return `  components?: {\n${components
    .map(
      (component) =>
        `    ${propertyKey(component.name)}?:
      | ((ctx: ${pascalIdentifier(component.name)}ControllerContext) => ${pascalIdentifier(component.name)}ControllerResult)
      | ${pascalIdentifier(component.name)}Definition;`,
    )
    .join("\n")}\n  };\n`;
}

function resourceDefinitionTypes(resource: AppSurfaceResource): string {
  const typeName = pascalIdentifier(resource.name);
  const eventFields = resource.events.map(
    (event) =>
      `    ${propertyKey(event)}(args: ${typeName}EventArgs<${JSON.stringify(event)}>): void;`,
  );
  const viewFields = resource.views.map(
    (view) =>
      `    ${propertyKey(view)}(args: ${typeName}ViewArgs): ${typeName}ResourceViews[${JSON.stringify(view)}];`,
  );
  const commandFields = resource.commands.map((command) => {
    const commandName = JSON.stringify(command.name);
    return `    ${propertyKey(command.name)}(
      ctx: ${typeName}CommandContext<${commandName}>,
      ...args: CommandArgs<${typeName}ResourceCommands[${commandName}]>
    ): void;`;
  });
  const eventMap = resource.commands
    .filter((command) => command.eventName)
    .map((command) => `  ${propertyKey(command.name)}: ${JSON.stringify(command.eventName)};`)
    .join("\n");
  const commandEvents = eventMap
    ? `type ${typeName}CommandEvents = {
${eventMap}
};`
    : `type ${typeName}CommandEvents = {};`;
  const eventsDefinition = eventFields.length
    ? `events: {
${eventFields.join("\n")}
  };`
    : "events: {};";
  return `type ${typeName}ResourceEvents = ${typeName}ResourceSpec["Events"];
type ${typeName}ResourcePresence = ResourcePresence<${typeName}ResourceSpec>;
type ${typeName}EventArgs<Event extends keyof ${typeName}ResourceEvents> = {
  readonly state: ${typeName}ResourceSpec["State"];
  readonly payload: ${typeName}ResourceEvents[Event];
  readonly actor: AppActor;
  readonly at: number;
  readonly seq: number;
};
type ${typeName}ViewArgs = {
  readonly state: ${typeName}ResourceSpec["State"];
  readonly actor: AppActor | null;
  readonly sessions: SessionData<AppActor, ${typeName}ResourcePresence>[];
  readonly key: ${typeName}ResourceKey;
};
${commandEvents}
type ${typeName}CommandEvent<Command extends keyof ${typeName}ResourceCommands> =
  Command extends keyof ${typeName}CommandEvents
    ? ${typeName}CommandEvents[Command] extends keyof ${typeName}ResourceEvents
      ? {
          [Event in ${typeName}CommandEvents[Command]]: (payload: ${typeName}ResourceEvents[Event]) => void;
        }
      : EmptyObject
    : EmptyObject;
type ${typeName}CommandContext<Command extends keyof ${typeName}ResourceCommands> = {
  readonly state: ${typeName}ResourceSpec["State"];
  readonly actor: AppActor;
  readonly key: ${typeName}ResourceKey;
  event: ${typeName}CommandEvent<Command>;
  setPresence(patch: Partial<${typeName}ResourcePresence>): void;
  error: CommandErrorFn<${typeName}ResourceCommands[Command]>;
  id(): string;
  now(): number;
};
type ${typeName}ResourceDefinition = {
  state: ${typeName}ResourceSpec["State"];
  presence?: ${typeName}ResourcePresence;
  ${eventsDefinition}
  views?: {
${viewFields.join("\n")}
  };
  commands?: {
${commandFields.join("\n")}
  };
};`;
}

function programDefinitionTypes(surface: AppSurface): string {
  if (surface.environments.length === 0) return "";
  const resourceProgramTypes = surface.resources.map(programResourceType).join("\n\n");
  const eventItems = surface.resources.flatMap((resource) =>
    resource.events.map((event) => programEventItemType(surface, resource, event)),
  );
  const contexts = surface.environments
    .map((env) => {
      const eventOverloads = eventItems.length
        ? eventItems
            .map(
              (item) =>
                `  events(
    name: ${JSON.stringify(item.name)},
    options: { id: string; signal?: AbortSignal },
  ): AsyncIterable<${item.typeName}>;`,
            )
            .join("\n")
        : "  events(name: never, options: { id: string; signal?: AbortSignal }): AsyncIterable<never>;";
      return `type ${pascalIdentifier(env.name)}ProgramContext = {
  readonly signal: AbortSignal;
${eventOverloads}
${surface.resources.map((resource) => `  use${capitalize(resource.name)}(key: ${pascalIdentifier(resource.name)}ResourceKey): ${pascalIdentifier(resource.name)}ProgramResource;`).join("\n")}
};`;
    })
    .join("\n\n");
  return `${resourceProgramTypes}

${eventItems.map((item) => item.definition).join("\n\n")}

${contexts}`;
}

function programResourceType(resource: AppSurfaceResource): string {
  const typeName = pascalIdentifier(resource.name);
  const viewFields = resource.views.map(
    (view) => `  readonly ${propertyKey(view)}: ${typeName}ResourceViews[${JSON.stringify(view)}];`,
  );
  const commandFields = resource.commands.map((command) => {
    const commandName = JSON.stringify(command.name);
    const commandType = `${typeName}ResourceCommands[${commandName}]`;
    const args = command.hasArgs ? `${commandType}["args"]` : "[]";
    const error = command.hasError ? `${commandType}["error"]` : "never";
    return `  ${propertyKey(command.name)}(
    ...args: ${args}
  ): CommandReceipt<${error}>;`;
  });
  return `type ${typeName}ProgramResource = {
${[...viewFields, ...commandFields, `  readonly view: ${typeName}ResourceViews;`].join("\n")}
};`;
}

function programEventItemType(
  surface: AppSurface,
  resource: AppSurfaceResource,
  event: string,
): { name: string; typeName: string; definition: string } {
  const typeName = `${pascalIdentifier(resource.name)}${pascalIdentifier(event)}ProgramEventItem`;
  const eventName = `${resource.name}.${event}`;
  const resourceType = pascalIdentifier(resource.name);
  const resourceFields = surface.resources.map((current) =>
    current.name === resource.name
      ? `  readonly ${propertyKey(current.name)}: ${pascalIdentifier(current.name)}ProgramResource;`
      : "",
  );
  return {
    name: eventName,
    typeName,
    definition: `type ${typeName} = {
  readonly event: {
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly version: number;
    readonly actor: AppActor;
    readonly resource: ${JSON.stringify(resource.name)};
    readonly key: ${resourceType}ResourceKey;
    readonly name: ${JSON.stringify(event)};
    readonly payload: ${resourceType}ResourceEvents[${JSON.stringify(event)}];
  };
  readonly resource: ${JSON.stringify(resource.name)};
  readonly key: ${resourceType}ResourceKey;
  readonly view: ${resourceType}ResourceViews;
${resourceFields.filter(Boolean).join("\n")}
};`,
  };
}

function componentDefinitionTypes(component: AppSurfaceComponent): string {
  const typeName = pascalIdentifier(component.name);
  const partFields = Object.entries(component.parts).map(
    ([partName, elementName]) =>
      `  ${propertyKey(partName)}?: Partial<${partPropsType(elementName)}>;`,
  );
  const stateField = component.hasState
    ? `  state: ${typeName}State | ((ctx: ${typeName}StateContext) => ${typeName}State);`
    : `  state?: ${typeName}State | ((ctx: ${typeName}StateContext) => ${typeName}State);`;
  const derivedField = component.hasDerived
    ? `  derived: ${typeName}DerivedFactory;`
    : `  derived?: ${typeName}DerivedFactory;`;
  const actionsField = component.hasActions
    ? `  actions: ${typeName}ActionFactory;`
    : `  actions?: ${typeName}ActionFactory;`;
  return `type ${typeName}ControllerContext = ${typeName}Context & {
  readonly actions: ${typeName}ActionHandlers;
};
type ${typeName}ControllerResult = {
  values?: Partial<${typeName}StyleValues>;
} & Partial<{
${partFields.join("\n")}
}>;
type ${typeName}StateContext = {
  readonly input: ${typeName}Input;
  readonly variants: ${typeName}Variants;
};
type ${typeName}Definition = {
${stateField}
${derivedField}
${actionsField}
  bind?(ctx: ${typeName}ControllerContext): ${typeName}ControllerResult;
  setup?(ctx: ${typeName}ControllerContext): void | (() => void);
};`;
}

function appPartPropsPrelude(): string {
  return `type PartValue<T> = T | null | undefined;
type PartEvent<T extends EventTarget, E extends Event> = {
  bivarianceHack(event: E & { readonly currentTarget: T }): void;
}["bivarianceHack"];
type PartDataAttributes = {
  [Key in \`data-\${string}\`]?: PartValue<string | number | boolean>;
};
type PartAriaAttributes = {
  [Key in \`aria-\${string}\`]?: PartValue<string | number | boolean>;
};
type PartPopoverValue = "auto" | "hint" | "manual" | boolean;
type PartPopoverTargetAction = "hide" | "show" | "toggle";
type PartPopoverToggleEvent = Event & {
  readonly newState: "closed" | "open";
  readonly oldState: "closed" | "open";
};
type PartPopoverTargetProps = {
  popovertarget?: PartValue<string>;
  popovertargetaction?: PartValue<PartPopoverTargetAction>;
  popoverTarget?: PartValue<string>;
  popoverTargetAction?: PartValue<PartPopoverTargetAction>;
};
type PartCommonProps<T extends Element> = PartDataAttributes &
  PartAriaAttributes & {
    id?: PartValue<string>;
    hidden?: PartValue<boolean | "hidden" | "until-found">;
    popover?: PartValue<PartPopoverValue>;
    role?: PartValue<string>;
    tabIndex?: PartValue<number>;
    tabindex?: PartValue<number>;
    title?: PartValue<string>;
    children?: Child;
    ref?: (element: T) => void;
    onBeforeToggle?: PartEvent<T, PartPopoverToggleEvent>;
    onBlur?: PartEvent<T, FocusEvent>;
    onChange?: PartEvent<T, Event>;
    onClick?: PartEvent<T, MouseEvent>;
    onFocus?: PartEvent<T, FocusEvent>;
    onInput?: PartEvent<T, InputEvent>;
    onKeyDown?: PartEvent<T, KeyboardEvent>;
    onKeyUp?: PartEvent<T, KeyboardEvent>;
    onMouseDown?: PartEvent<T, MouseEvent>;
    onMouseUp?: PartEvent<T, MouseEvent>;
    onGotPointerCapture?: PartEvent<T, PointerEvent>;
    onLostPointerCapture?: PartEvent<T, PointerEvent>;
    onPointerCancel?: PartEvent<T, PointerEvent>;
    onPointerDown?: PartEvent<T, PointerEvent>;
    onPointerEnter?: PartEvent<T, PointerEvent>;
    onPointerLeave?: PartEvent<T, PointerEvent>;
    onPointerMove?: PartEvent<T, PointerEvent>;
    onPointerOut?: PartEvent<T, PointerEvent>;
    onPointerOver?: PartEvent<T, PointerEvent>;
    onPointerUp?: PartEvent<T, PointerEvent>;
    onSubmit?: PartEvent<T, SubmitEvent>;
    onToggle?: PartEvent<T, PartPopoverToggleEvent>;
  };
type PartHtmlProps = PartCommonProps<HTMLElement>;
type PartButtonProps = PartCommonProps<HTMLButtonElement> & PartPopoverTargetProps & {
  disabled?: PartValue<boolean>;
  name?: PartValue<string>;
  type?: PartValue<"button" | "submit" | "reset">;
  value?: PartValue<string | number>;
};
type PartInputProps = PartCommonProps<HTMLInputElement> & PartPopoverTargetProps & {
  checked?: PartValue<boolean>;
  disabled?: PartValue<boolean>;
  max?: PartValue<number>;
  min?: PartValue<number>;
  name?: PartValue<string>;
  placeholder?: PartValue<string>;
  step?: PartValue<number>;
  type?: PartValue<string>;
  value?: PartValue<string | number | readonly string[]>;
};
type PartTextareaProps = PartCommonProps<HTMLTextAreaElement> & {
  disabled?: PartValue<boolean>;
  name?: PartValue<string>;
  placeholder?: PartValue<string>;
  rows?: PartValue<number>;
  value?: PartValue<string | number>;
};
type PartSelectProps = PartCommonProps<HTMLSelectElement> & {
  disabled?: PartValue<boolean>;
  multiple?: PartValue<boolean>;
  name?: PartValue<string>;
  value?: PartValue<string | number | readonly string[]>;
};
type PartAnchorProps = PartCommonProps<HTMLAnchorElement> & {
  href?: PartValue<string>;
  rel?: PartValue<string>;
  target?: PartValue<string>;
};
type PartImageProps = PartCommonProps<HTMLImageElement> & {
  alt?: PartValue<string>;
  height?: PartValue<string | number>;
  loading?: PartValue<"eager" | "lazy">;
  src?: PartValue<string>;
  width?: PartValue<string | number>;
};
type PartFormProps = PartCommonProps<HTMLFormElement> & {
  action?: PartValue<string>;
  method?: PartValue<"dialog" | "get" | "post">;
};
type PartSvgProps = PartCommonProps<SVGElement> & {
  d?: PartValue<string>;
  fill?: PartValue<string>;
  height?: PartValue<string | number>;
  stroke?: PartValue<string>;
  strokeWidth?: PartValue<string | number>;
  viewBox?: PartValue<string>;
  width?: PartValue<string | number>;
};`;
}

function partPropsType(elementName: string): string {
  switch (elementName) {
    case "button":
      return "PartButtonProps";
    case "input":
      return "PartInputProps";
    case "textarea":
      return "PartTextareaProps";
    case "select":
      return "PartSelectProps";
    case "a":
      return "PartAnchorProps";
    case "img":
      return "PartImageProps";
    case "form":
      return "PartFormProps";
    case "svg":
    case "path":
    case "circle":
    case "rect":
    case "line":
    case "polyline":
    case "polygon":
    case "g":
      return "PartSvgProps";
    default:
      return "PartHtmlProps";
  }
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

async function writeGeneratedTypeArtifacts(paths: AppPaths): Promise<string | undefined> {
  return writePoggersAppTypes(paths);
}

async function writePoggersAppTypes(paths: AppPaths): Promise<string | undefined> {
  if (!paths.types) return undefined;

  const surface = collectAppSurface(paths);
  const output = resolve(paths.appDir, ".poggers/types/app.d.ts");
  const typesDir = dirname(output);
  const appSpecImport = importSpecifier(output, paths.types);
  await mkdir(typesDir, { recursive: true });
  const resourceExports = surface.resources.map(resourceTypeDefinitions).join("\n\n");
  const navigationExports = navigationTypes(surface);
  const componentExports = Object.values(surface.components)
    .map(componentTypeDefinitions)
    .join("\n\n");
  const appDefinition = appDefinitionTypes(surface);
  const styleDefinition = styleDefinitionTypes(surface);
  const appSchemaHash = structuralHash(readFileSync(paths.types, "utf8"));
  const appPreset = surface.presetType ?? '"default"';
  const appThemeName = styleThemeNameType(surface);
  const componentStyleValueTypes = Object.values(surface.components).some(
    (component) => component.styleValues.length > 0,
  )
    ? `type ComponentStyleValueKind =
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "zIndex"
  | "length"
  | "space"
  | "size"
  | "radius";
type ComponentStyleValueFor<Kind extends string> = Kind extends
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "zIndex"
  ? number
  : Kind extends "length" | "space" | "size" | "radius"
    ? number
    : never;
type ComponentStyleValues<Values extends Record<string, string>> = {
  readonly [Value in keyof Values]: ComponentStyleValueFor<Values[Value] & string>;
};`
    : "";
  await writeFile(
    output,
    `import type { Preset as VisualPreset } from "@poggers/kit/style";
import type { App as AppSpec } from ${JSON.stringify(appSpecImport)};

export const appSchemaHash: ${JSON.stringify(appSchemaHash)};

type EmptyObject = Record<never, never>;
type Signal<T> = {
  (): T;
  (value: T): void;
};
type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);
${componentStyleValueTypes}
type CommandReceipt<E = never> = Promise<
  { ok: true; cursor?: number } | { ok: false; error: E; data?: unknown }
>;
type SyncMeta = {
  cursor: number;
  syncing: boolean;
  stale: boolean;
  error: string | null;
};
type AppPreset = ${appPreset};
export type StartConnect = unknown;
type RootProps = { connect?: StartConnect };
type AppThemeName = ${appThemeName};
${appPartPropsPrelude()}

${navigationExports}

${resourceExports}

${componentExports}

${appDefinition}

${styleDefinition}

export const nav: AppNavigation;

export function useScreen(): AppScreen;

export function usePreset(): AppPreset;

export function setPreset(preset: AppPreset): void;

export function useThemeName(): AppThemeName;

export function setTheme(theme: AppThemeName): void;

export function initialize(): Promise<void>;

export function start(connect?: StartConnect): void;

export function Root(props?: RootProps): Child;

export default Root;
`,
    "utf8",
  );
  return output;
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

function collectForbiddenAppStyling(file: string, source: string, issues: AppConventionIssue[]) {
  if (/\bclassName\s*=|\bclass\s*=/.test(source)) {
    issues.push({
      file,
      message: "app.ts must not use class/className; define visual rules in presets.",
    });
  }
  if (/\bstyle\s*=/.test(source)) {
    issues.push({
      file,
      message: "app.ts must not use inline style; define visual rules in presets.",
    });
  }
}

function collectForbiddenUiStyling(file: string, source: string, issues: AppConventionIssue[]) {
  if (/\bclassName\s*=|\bclass\s*=/.test(source)) {
    issues.push({
      file,
      message: "ui files must not use class/className; render generated component parts.",
    });
  }
  if (/\bstyle\s*=/.test(source)) {
    issues.push({
      file,
      message: "ui files must not use inline style; define visual rules in presets.",
    });
  }
}

function collectUiFileConventions(uiDir: string, file: string, issues: AppConventionIssue[]) {
  const name = basename(file).replace(/\.[cm]?tsx?$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    issues.push({ file, message: "ui file names must be kebab-case." });
  }

  const uiPath = relative(uiDir, file);
  if (uiPath.includes("/") || uiPath.includes("\\")) {
    issues.push({
      file,
      message: "ui files must live directly in src/ui; do not nest ui folders.",
    });
  }
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (/\.[cm]?tsx?$/.test(path)) files.push(path);
  }
  return files;
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
  const workerImport = paths.worker
    ? `import * as workerModule from ${JSON.stringify(importSpecifier(serverEntrypoint, paths.worker))};\n`
    : "";
  const workerSetup = paths.worker
    ? `const workerExports = workerModule as Record<string, any>;
const worker = workerExports.default ?? workerExports.worker;
const workerDeps = typeof workerExports.createWorkerDeps === "function"
  ? await workerExports.createWorkerDeps()
  : "deps" in workerExports
    ? await workerExports.deps
    : {};
const workerConfig = worker
  ? {
      worker,
      deps: workerDeps,
      workerId: workerExports.workerId ?? ${JSON.stringify(`${titleFromDir(paths.appDir)}-worker`)},
      actor: workerExports.workerActor,
      store: workerExports.workerStore,
    }
  : undefined;
`
    : "const workerConfig = undefined;\n";
  const depsImport = paths.deps
    ? `import * as depsModule from ${JSON.stringify(importSpecifier(serverEntrypoint, paths.deps))};\n`
    : "";
  const depsSetup = paths.deps
    ? "const depsExports = depsModule as Record<string, any>;\n"
    : "const depsExports = {} as Record<string, any>;\n";
  const migrationImport = migrationRegistry
    ? `import * as migrationRegistry from ${JSON.stringify(importSpecifier(serverEntrypoint, migrationRegistry))};\n`
    : "const migrationRegistry = { hash: undefined, migrations: [] };\n";

  return `import * as apiModule from ${JSON.stringify(importSpecifier(serverEntrypoint, appEntrypoint))};
import { defineApp } from "@poggers/kit";
import { installAppMigrations, resolveDependencyMount, serveApp } from "@poggers/kit/app";
${workerImport}${depsImport}${migrationImport}${workerSetup}${depsSetup}
const apiExports = apiModule as Record<string, any>;
const rawApi = apiExports.api ?? apiExports.default;
if (!rawApi) throw new Error("App API module must export api or default.");
const api = installAppMigrations(rawApi.def?.resources ? rawApi : defineApp(rawApi), {
  hash: migrationRegistry.hash,
  migrations: migrationRegistry.migrations,
});
const browserProgram = api.def?.programs?.browser;
const serverProgram = api.def?.programs?.server;
const programEnv = serverProgram ? "server" : browserProgram ? "browser" : undefined;
const program = serverProgram ?? browserProgram;
const depsMount = programEnv
  ? api.def?.deps?.[programEnv] ?? depsExports.default ?? {}
  : {};
const programDeps = await resolveDependencyMount(depsMount);
const programConfig = program && programEnv
  ? {
      env: programEnv,
      program,
      deps: programDeps,
      programId: apiExports.programId ?? \`${titleFromDir(paths.appDir)}-\${programEnv}\`,
      actor: apiExports.programActor,
      store: apiExports.programStore,
    }
  : undefined;

const handle = serveApp({
  api,
  ui: new URL(${JSON.stringify(importSpecifier(serverEntrypoint, browserEntry))}, import.meta.url),
  title: ${title === undefined ? "undefined" : JSON.stringify(title)},
  bundle: ${JSON.stringify(browserBundle)},
  styleBundle: ${JSON.stringify(browserStyle)},
  port: process.env.PORT ? Number(process.env.PORT) : undefined,
  worker: workerConfig,
  program: programConfig,
});

process.on("SIGINT", () => {
  handle.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  handle.stop();
  process.exit(0);
});
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

function pascalIdentifier(value: string): string {
  const parts = value.match(/[A-Za-z0-9]+/g) ?? ["Value"];
  const name = parts.map(capitalize).join("");
  return /^[A-Za-z_$]/.test(name) ? name : `Value${name}`;
}
