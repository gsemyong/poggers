import type { ActorOf, App, AppSpec, EnvironmentDeps, EnvironmentName } from "./app";
import { serve, type ServeOpts, type ServerHandle, type WebLiveReloadOpts } from "./server";
import type { AppProgram, WorkerDef, WorkerDurabilityStore } from "./worker";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { $ } from "bun";

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

export function serveApp<Spec extends AppSpec, Deps = never>({
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
}: ServeAppOpts<Spec, Deps>): ServerHandle {
  return serve(api, {
    ...serveOpts,
    web: {
      bundle,
      styleBundle,
      entrypoint: ui,
      html,
      styles,
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
  styles?: string;
  styleSource?: string;
  worker?: string;
};

type BrowserEntrypoint = {
  entrypoint: string;
  styles?: string;
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

const poggersJsx = {
  runtime: "automatic",
  importSource: "@poggers/kit",
} as const;
const kitSourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
    resolve(resolvedAppDir, "src/app.tsx"),
    resolve(resolvedAppDir, "app.tsx"),
  ]);
  const sourceDir = ui ? dirname(ui) : resolve(resolvedAppDir, "src");
  const types = firstExisting([
    resolve(sourceDir, "types.ts"),
    resolve(resolvedAppDir, "types.ts"),
  ]);
  const styles = firstExisting([
    resolve(sourceDir, "styles.css"),
    resolve(sourceDir, "components/theme.css"),
    resolve(resolvedAppDir, "styles.css"),
    resolve(resolvedAppDir, "components/theme.css"),
  ]);
  const styleSource = firstExisting([
    resolve(sourceDir, "styles.ts"),
    resolve(sourceDir, "styles.tsx"),
    resolve(resolvedAppDir, "styles.ts"),
    resolve(resolvedAppDir, "styles.tsx"),
  ]);
  const worker = firstExisting([
    resolve(sourceDir, "worker.ts"),
    resolve(resolvedAppDir, "worker.ts"),
  ]);

  if (!ui) {
    throw new Error(`App is missing src/app.tsx or app.tsx in ${resolvedAppDir}.`);
  }

  const embedded = !api;

  return {
    appDir: resolvedAppDir,
    sourceDir,
    api: api ?? ui,
    ui,
    types,
    embedded,
    styles,
    styleSource,
    worker,
  };
}

export async function loadApp<Spec extends AppSpec = AppSpec>(
  appDir: string,
): Promise<LoadedApp<Spec>> {
  const paths = resolveApp(appDir);
  await writePoggersAppTypes(paths);
  const apiModule = await importBuiltAppModule(paths);
  const api = (apiModule.api ?? apiModule.default) as App<Spec> | undefined;

  if (!api?.def?.resources) {
    throw new Error(`App module must export a Poggers app from ${paths.api}.`);
  }

  const worker = paths.worker ? await loadWorker<Spec>(paths.worker, paths.appDir) : undefined;
  const program = await loadProgram(api, apiModule, selectProgramEnv(api), paths.appDir);

  return { paths, api, worker, program };
}

export async function runApp(opts: RunAppOpts): Promise<ServerHandle> {
  const loaded = await loadApp(opts.appDir);
  const title = opts.title ?? loaded.api.def.app?.name ?? loaded.api.def.pwa?.name;
  const browser = await writeBrowserEntrypoint(loaded.paths, {
    dev: opts.liveReload !== false,
    title,
  });

  return serveApp({
    api: loaded.api,
    ui: browser.entrypoint,
    html: browser.html,
    styles: browser.styles,
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
              await writeChangedDevArtifacts(loaded.paths, changedPath);
            },
          },
    worker: loaded.worker,
    program: loaded.program,
  });
}

export async function bundleApp(opts: BundleAppOpts): Promise<void> {
  const paths = resolveApp(opts.appDir);
  const browser = await writeBrowserEntrypoint(paths);
  const result = await Bun.build({
    entrypoints: [browser.entrypoint],
    format: "esm",
    jsx: poggersJsx,
    minify: opts.minify ?? true,
    outdir: opts.outdir ?? resolve(paths.appDir, ".app/build/web"),
    plugins: browser.plugins,
    target: "browser",
  });

  if (!result.success) {
    throw new Error(result.logs.map(String).join("\n"));
  }
}

export async function buildApp(opts: BuildAppOpts): Promise<void> {
  const paths = resolveApp(opts.appDir);
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
  );
  if (!browserBundle) throw new Error("Browser bundle produced no output.");

  const buildDir = frameworkBuildDir(paths);
  const appEntrypoint = await writeBuiltAppModule(
    paths.api,
    resolve(buildDir, "app.generated.js"),
    [createPoggersServerAppStubPlugin(paths)],
  );
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
      opts.title,
    ),
    "utf8",
  );

  await $`bun build --compile --target=bun --outfile ${resolve(opts.outfile)} ${serverEntrypoint}`;
}

export async function writeAppTypes(appDir: string): Promise<string | undefined> {
  const paths = resolveApp(appDir);
  return writePoggersAppTypes(paths);
}

export function checkAppConventions(appDir: string): AppConventionIssue[] {
  const paths = resolveApp(appDir);
  if (!paths.styleSource) return [];

  const issues: AppConventionIssue[] = [];
  const appSource = readFileSync(paths.ui, "utf8");
  collectForbiddenGeneratedSurface(paths.ui, appSource, issues);
  collectForbiddenAppStyling(paths.ui, appSource, issues);
  if (appSource.includes("@poggers/kit/style")) {
    issues.push({
      file: paths.ui,
      message: "app.tsx must not import @poggers/kit/style; put presets in styles.ts.",
    });
  }

  for (const file of sourceFiles(resolve(paths.sourceDir, "components"))) {
    const source = readFileSync(file, "utf8");
    collectForbiddenGeneratedSurface(file, source, issues);
    collectForbiddenComponentStyling(file, source, issues);
  }

  if (paths.types) {
    const typesSource = readFileSync(paths.types, "utf8");
    collectForbiddenSpecSurface(paths.types, typesSource, issues);
  }

  if (paths.styleSource) {
    const stylesSource = readFileSync(paths.styleSource, "utf8");
    if (
      /from\s+["']\.\/helpers\//.test(stylesSource) ||
      /from\s+["']\.\.\/helpers\//.test(stylesSource)
    ) {
      issues.push({
        file: paths.styleSource,
        message: "styles.ts must stay visual; do not import app helper/runtime modules.",
      });
    }
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
  env: Env,
  appDir: string,
): Promise<AppEnvironmentProgram<Spec, Env> | undefined> {
  const program = api.def.programs?.[env];
  if (!program) return undefined;

  const envName = String(env);
  const capitalizedEnv = capitalize(envName);
  const depsFactory =
    api.def.deps?.[env] ?? apiModule[`create${capitalizedEnv}Deps`] ?? apiModule.createProgramDeps;
  const deps =
    typeof depsFactory === "function"
      ? await depsFactory()
      : `${envName}Deps` in apiModule
        ? await apiModule[`${envName}Deps`]
        : "programDeps" in apiModule
          ? await apiModule.programDeps
          : {};

  return {
    env,
    program,
    deps,
    programId: apiModule.programId ?? `${titleFromDir(appDir)}-${envName}`,
    actor: apiModule.programActor,
    store: apiModule.programStore,
  };
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

async function writeBrowserEntrypoint(
  paths: AppPaths,
  options: { dev?: boolean; title?: string } = {},
): Promise<BrowserEntrypoint> {
  const buildDir = options.dev ? frameworkDevDir(paths) : frameworkBuildDir(paths);
  const entrypoint = resolve(buildDir, "browser.entry.tsx");
  const uiRuntime = detectUIRuntime(paths.ui);
  const compiledStyles = await compileBrowserStyles(paths, buildDir);
  const plugins = paths.styleSource
    ? [createPoggersKitSourcePlugin(), createPoggersAppPlugin(paths)]
    : [createPoggersKitSourcePlugin()];
  const styleImport = compiledStyles
    ? `import ${JSON.stringify(importSpecifier(entrypoint, compiledStyles))};\n`
    : "";
  await mkdir(buildDir, { recursive: true });
  await writePoggersAppTypes(paths);
  const source = paths.styleSource
    ? nativeBrowserEntrySource(styleImport, {
        rootImport: `import { Root } from "@poggers/app";`,
        rootExpression: "Root({})",
        dev: Boolean(options.dev),
      })
    : paths.embedded
      ? nativeBrowserEntrySource(styleImport, {
          rootImport: `import { createAppUI, render } from "@poggers/kit/ui";
import app from ${JSON.stringify(importSpecifier(entrypoint, paths.api))};

const Root = createAppUI(app);`,
          rootExpression: "Root({})",
          renderImported: true,
          dev: Boolean(options.dev),
        })
      : uiRuntime === "native"
        ? nativeBrowserEntrySource(styleImport, {
            rootImport: `import Root from ${JSON.stringify(importSpecifier(entrypoint, paths.ui))};`,
            rootExpression: "Root({})",
            dev: Boolean(options.dev),
          })
        : reactBrowserEntrySource(
            styleImport,
            importSpecifier(entrypoint, paths.ui),
            Boolean(options.dev),
          );
  await writeFile(entrypoint, source, "utf8");
  return {
    entrypoint,
    styles: compiledStyles,
    plugins,
    html: undefined,
    development: options.dev ? { hmr: true, console: true } : undefined,
  };
}

async function writeChangedDevArtifacts(paths: AppPaths, changedPath: string): Promise<void> {
  const changed = resolve(changedPath);
  if (paths.styleSource && changed === resolve(paths.styleSource)) {
    await compileBrowserStyles(paths, frameworkDevDir(paths));
    return;
  }
  if (paths.styles && changed === resolve(paths.styles)) {
    await compileBrowserStyles(paths, frameworkDevDir(paths));
    return;
  }
  if (paths.types && changed === resolve(paths.types)) {
    await writePoggersAppTypes(paths);
  }
}

async function compileBrowserStyles(
  paths: AppPaths,
  buildDir: string,
): Promise<string | undefined> {
  return paths.styleSource
    ? compilePoggersStyles(paths, buildDir)
    : paths.styles
      ? compileTailwindStyles(paths, buildDir)
      : undefined;
}

function nativeBrowserEntrySource(
  styleImport: string,
  options: {
    rootImport: string;
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

${renderBlock}`;
}

function reactBrowserEntrySource(
  styleImport: string,
  rootImportPath: string,
  dev: boolean,
): string {
  const rootSetup = dev
    ? `type HotData = { root?: ReturnType<typeof createRoot> };
const reactRoot = import.meta.hot
  ? ((import.meta.hot.data as HotData).root ??= createRoot(root))
  : createRoot(root);
`
    : "const reactRoot = createRoot(root);\n";
  const hmr = dev
    ? `
if (import.meta.hot) {
  import.meta.hot.accept();
}
`
    : "";

  return `${styleImport}import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from ${JSON.stringify(rootImportPath)};

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element.");

${rootSetup}reactRoot.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
${hmr}`;
}

async function compileTailwindStyles(paths: AppPaths, buildDir: string): Promise<string> {
  if (!paths.styles) throw new Error("compileStyles called without styles path.");

  const output = resolve(buildDir, "styles.generated.css");
  await mkdir(buildDir, { recursive: true });
  const result = Bun.spawnSync({
    cmd: ["bunx", "tailwindcss", "-i", paths.styles, "-o", output],
    cwd: paths.appDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    throw new Error(`Tailwind CSS build failed.\n${stderr || stdout}`);
  }

  return output;
}

async function compilePoggersStyles(paths: AppPaths, buildDir: string): Promise<string> {
  if (!paths.styleSource) throw new Error("compilePoggersStyles called without styles.ts.");

  const output = resolve(buildDir, "styles.generated.css");
  await mkdir(buildDir, { recursive: true });
  const stylesModule = await importBuiltSourceModule(paths.styleSource, buildDir, "style");
  const styles = stylesModule.default ?? stylesModule.styles;
  const css = renderPoggersCss(styles?.def ?? {});
  await writeFile(output, css, "utf8");
  return output;
}

async function importBuiltAppModule(paths: AppPaths): Promise<Record<string, any>> {
  return importBuiltSourceModule(paths.api, frameworkDevDir(paths), "app", [
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
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    jsx: poggersJsx,
    minify: false,
    plugins: [createPoggersKitSourcePlugin(), ...plugins],
    target: "bun",
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

function createPoggersAppPlugin(paths: AppPaths): Bun.BunPlugin {
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
          contents: poggersAppModuleSource(paths),
        };
      });
    },
  };
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

function poggersAppModuleSource(paths: AppPaths): string {
  const surface = collectAppSurface(paths);
  const stylesImport = paths.styleSource
    ? `import styles from ${JSON.stringify(paths.styleSource)};`
    : `import { defineStyles } from "@poggers/kit/style";
const styles = defineStyles({ presets: { default: {} } });`;
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

  return `import app from ${JSON.stringify(paths.api)};
${stylesImport}
import { createHooks } from "@poggers/kit/style";
import { createBrowserConnectOptions } from "@poggers/kit/ui";

let hooks;
const components = ${componentParts};

function getHooks() {
  if (!hooks) hooks = createHooks({ app, styles, components });
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

export function useTheme() {
  return getHooks().useTheme();
}

export function setThemeParam(param, value) {
  getHooks().setThemeParam(param, value);
}

export function start(connect) {
  getHooks().start(connect ?? createBrowserConnectOptions());
}

export function Root(props = {}) {
  start(props.connect);
  if (!app.def.ui) throw new Error("App definition does not include a ui(ctx) function.");
  return app.def.ui(getHooks());
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
export function useTheme() { throwUnavailable("useTheme"); }
export function setThemeParam() { throwUnavailable("setThemeParam"); }
export function start() {}
export function Root() {
  return null;
}
export default Root;
`;
}

type AppSurfaceResource = {
  name: string;
  doc?: string;
};

type AppSurfaceComponent = {
  name: string;
  parts: Record<string, string>;
  needsInput: boolean;
  doc?: string;
};

type AppSurface = {
  resources: AppSurfaceResource[];
  components: Record<string, AppSurfaceComponent>;
};

function collectAppSurface(paths: AppPaths): AppSurface {
  const fallback: AppSurface = { resources: [], components: {} };
  if (!paths.types || !existsSync(paths.types)) return fallback;

  const source = readFileSync(paths.types, "utf8");
  const resourcesBlock = extractPropertyBlock(source, "Resources");
  const componentsBlock = extractPropertyBlock(source, "Components");
  const resources = resourcesBlock
    ? readObjectMemberEntries(resourcesBlock).map(({ name, doc }) => ({ name, doc }))
    : [];
  const components: Record<string, AppSurfaceComponent> = {};

  if (componentsBlock) {
    const componentMembers = readObjectMemberEntries(componentsBlock);
    for (const { name: componentName, value: componentBlock, doc } of componentMembers) {
      const partsBlock = extractPropertyBlock(componentBlock, "Parts");
      if (!partsBlock) continue;
      components[componentName] = {
        name: componentName,
        parts: readStringMembers(partsBlock),
        needsInput: ["Input", "State", "Derived", "Actions"].some((property) =>
          Boolean(extractPropertyBlock(componentBlock, property)),
        ),
        doc,
      };
    }
  }

  return { resources, components };
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

async function writePoggersAppTypes(paths: AppPaths): Promise<string | undefined> {
  if (!paths.types) return undefined;

  const surface = collectAppSurface(paths);
  const typesDir = resolve(paths.appDir, ".app/types/@poggers/app");
  const output = resolve(typesDir, "index.tsx");
  const appImport = importSpecifier(output, paths.api);
  const stylesImport = paths.styleSource
    ? `import styles from ${JSON.stringify(importSpecifier(output, paths.styleSource))};`
    : `import { defineStyles } from "@poggers/kit/style";
const styles = defineStyles({ presets: { default: {} } });`;
  const appSpecImport = importSpecifier(output, paths.types);
  const styleAccept = paths.styleSource
    ? `  import.meta.hot.accept(${JSON.stringify(importSpecifier(output, paths.styleSource))}, () => {});\n`
    : "";
  await mkdir(typesDir, { recursive: true });
  await rm(resolve(paths.appDir, ".app/types/poggers-app.d.ts"), { force: true });
  await rm(resolve(typesDir, "index.d.ts"), { force: true });
  await rm(resolve(typesDir, "api.d.ts"), { force: true });
  await rm(resolve(typesDir, "ui.d.ts"), { force: true });
  await rm(resolve(typesDir, "api.ts"), { force: true });
  await rm(resolve(typesDir, "ui.ts"), { force: true });
  const componentParts = JSON.stringify(componentPartsRecord(surface));
  const resourceExports = surface.resources
    .map((resource) => {
      const resourceName = resource.name;
      const name = `use${capitalize(resourceName)}`;
      const typeName = pascalIdentifier(resourceName);
      return `${jsDoc(resource.doc, `Access the ${resourceName} resource.`)}
export type ${typeName}ResourceKey = AppSpec["Resources"][${JSON.stringify(resourceName)}]["Key"];
export type ${typeName}Resource = NativeResource<AppSpec, ${JSON.stringify(resourceName)}>;
export function ${name}(key: ${typeName}ResourceKey): ${typeName}Resource {
  return getHooks()[${JSON.stringify(name)}](key);
}`;
    })
    .join("\n\n");
  const componentExports = Object.values(surface.components)
    .map((component) => {
      const componentName = component.name;
      const name = `create${capitalize(componentName)}`;
      const typeName = pascalIdentifier(componentName);
      const inputParam = component.needsInput
        ? `input: ${typeName}Options`
        : `input?: ${typeName}Options`;
      return `${jsDoc(component.doc, `Create a ${componentName} component instance.`)}
export type ${typeName}Options = ComponentInstanceInput<AppSpec, ${JSON.stringify(componentName)}>;
export type ${typeName}Instance = ComponentInstanceResult<AppSpec, ${JSON.stringify(componentName)}>;
export function ${name}(${inputParam}): ${typeName}Instance {
  return getHooks()[${JSON.stringify(name)}](input as never) as ${typeName}Instance;
}`;
    })
    .join("\n\n");
  await writeFile(
    output,
    `import app from ${JSON.stringify(appImport)};
${stylesImport}
import { createHooks } from "@poggers/kit/style";
import { createBrowserConnectOptions } from "@poggers/kit/ui";
import type { App as AppSpec } from ${JSON.stringify(appSpecImport)};
import type { AppNavigation, AppScreen } from "@poggers/kit";
import type { Child, DefineUIProps } from "@poggers/kit/ui";
import type { NativeResource } from "@poggers/kit/ui";
import type {
  AppHooks,
  ComponentInstanceInput,
  ComponentInstanceResult,
  PresetName,
  ThemeParamName,
  ThemeParamValue,
  ThemeValues,
} from "@poggers/kit/style";

let hooks = import.meta.hot
  ? (import.meta.hot.data.hooks as AppHooks<AppSpec> | undefined)
  : undefined;
const components = ${componentParts};

function getHooks(): AppHooks<AppSpec> {
  hooks ??= createHooks<AppSpec>({ app, styles, components });
  return hooks;
}

${resourceExports}

${componentExports}

export const nav: AppNavigation<AppSpec> = new Proxy({} as AppNavigation<AppSpec>, {
  get(_target, prop: keyof AppNavigation<AppSpec>) {
    return getHooks().nav[prop];
  },
});

export function useScreen(): AppScreen<AppSpec> {
  return getHooks().useScreen();
}

export function usePreset(): PresetName<AppSpec> {
  return getHooks().usePreset();
}

export function setPreset(preset: PresetName<AppSpec>): void {
  getHooks().setPreset(preset);
}

export function useTheme(): ThemeValues<AppSpec> {
  return getHooks().useTheme();
}

export function setThemeParam<Param extends ThemeParamName<AppSpec>>(
  param: Param,
  value: ThemeParamValue<AppSpec, Param>,
): void {
  getHooks().setThemeParam(param, value);
}

export type StartConnect = DefineUIProps<AppSpec>["connect"];

export function start(connect?: StartConnect): void {
  getHooks().start(connect ?? createBrowserConnectOptions());
}

export function Root(props: DefineUIProps<AppSpec> = {}): Child {
  start(props.connect);
  if (!app.def.ui) throw new Error("App definition does not include a ui(ctx) function.");
  return app.def.ui(getHooks()) as Child;
}

export default Root;

if (import.meta.hot) {
  import.meta.hot.accept(${JSON.stringify(appImport)}, () => {
    window.dispatchEvent(new CustomEvent("poggers:render"));
  });
${styleAccept}  import.meta.hot.accept(${JSON.stringify(appSpecImport)}, () => {
    window.dispatchEvent(new CustomEvent("poggers:render"));
  });
  import.meta.hot.dispose(() => {
    import.meta.hot.data.hooks = hooks;
  });
}
`,
    "utf8",
  );
  return output;
}

function renderPoggersCss(def: {
  defaultPreset?: string;
  presets?: Record<string, Record<string, Record<string, unknown>>>;
}): string {
  const lines = [
    ":root {",
    "  --pg-density: 0.5;",
    "}",
    "",
    "*, *::before, *::after {",
    "  box-sizing: border-box;",
    "  margin: 0;",
    "  padding: 0;",
    "  min-width: 0;",
    "}",
    "",
    "html {",
    "  height: 100%;",
    "  -webkit-text-size-adjust: 100%;",
    "}",
    "",
    "body, #root { min-height: 100%; }",
    "",
    "body {",
    "  line-height: 1;",
    "  text-rendering: optimizeSpeed;",
    "  -webkit-font-smoothing: antialiased;",
    "  -moz-osx-font-smoothing: grayscale;",
    "}",
    "",
    "a {",
    "  color: inherit;",
    "  text-decoration: none;",
    "}",
    "",
    "ol, ul { list-style: none; }",
    "",
    "h1, h2, h3, h4, h5, h6 { font: inherit; }",
    "",
    "button, input, textarea, select, option {",
    "  appearance: none;",
    "  -webkit-appearance: none;",
    "  border: 0;",
    "  border-radius: 0;",
    "  background: transparent;",
    "  font: inherit;",
    "  color: inherit;",
    "}",
    "",
    "button, select { cursor: pointer; }",
    "",
    "button:disabled, input:disabled, textarea:disabled, select:disabled { cursor: not-allowed; }",
    "",
    "button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {",
    "  outline: 2px solid currentColor;",
    "  outline-offset: 2px;",
    "}",
    "",
    "textarea { resize: vertical; }",
    "",
    "img, picture, video, canvas, svg {",
    "  display: block;",
    "  max-width: 100%;",
    "  height: auto;",
    "}",
    "",
    "table {",
    "  border-collapse: collapse;",
    "  border-spacing: 0;",
    "}",
    "",
    "p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }",
    "",
    "[hidden] { display: none !important; }",
    "",
  ];

  for (const [presetName, preset] of Object.entries(def.presets ?? {})) {
    const isDefaultPreset = presetName === def.defaultPreset;
    const scope = isDefaultPreset ? "" : `:root[data-poggers-preset="${cssEscape(presetName)}"] `;
    for (const [styleName, slots] of Object.entries(preset ?? {})) {
      for (const [slotName, slotDef] of Object.entries(slots ?? {})) {
        const semantic = resolveStyleSlot(slotDef, presetName);
        const declarations = semanticToCss(semantic);
        if (declarations.length === 0) continue;
        lines.push(
          `${scope}.pg-${kebab(styleName)}__${kebab(slotName)}, ${scope}[data-pg-component="${cssEscape(
            styleName,
          )}"][data-pg-part="${cssEscape(slotName)}"] {`,
        );
        for (const declaration of declarations) lines.push(`  ${declaration}`);
        lines.push("}", "");
      }
    }
  }

  if (def.defaultPreset) {
    lines.push(
      `:root:not([data-poggers-preset]) { --pg-active-preset: "${cssEscape(
        String(def.defaultPreset),
      )}"; }`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

function resolveStyleSlot(slotDef: unknown, preset: string): Record<string, unknown> {
  if (typeof slotDef !== "function") return asRecord(slotDef);
  try {
    return asRecord(
      (slotDef as (ctx: unknown) => unknown)({
        preset,
        variants: {},
        state: {},
        theme: {},
      }),
    );
  } catch {
    return {};
  }
}

function semanticToCss(value: Record<string, unknown>): string[] {
  const css: Record<string, string | number> = {};
  collectCss(value, css);
  return Object.entries(css).map(([property, propertyValue]) => `${property}: ${propertyValue};`);
}

function collectCss(value: unknown, css: Record<string, string | number>) {
  if (!value || typeof value !== "object") return;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null || raw === false) continue;
    if (key === "layout") {
      applyLayout(raw, css);
      continue;
    }
    if (key === "surface") {
      applySurface(raw, css);
      continue;
    }
    if (key === "typography") {
      applyTypography(raw, css);
      continue;
    }
    if (key === "shape") {
      applyShape(raw, css);
      continue;
    }
    if (key === "size") {
      applySize(raw, css);
      continue;
    }
    if (key === "motion") {
      applyMotion(raw, css);
      continue;
    }
    if (isCssProperty(key) && isCssValue(raw)) {
      const property = kebab(key);
      css[property] = formatCssValue(property, raw);
      continue;
    }
    collectCss(raw, css);
  }
}

function applyLayout(value: unknown, css: Record<string, string | number>) {
  const layout = asRecord(value);
  const kind = String(layout.kind ?? layout.display ?? "");
  if (kind === "inlineCenter" || kind === "inline-center") {
    css.display = "inline-flex";
    css["align-items"] = "center";
    css["justify-content"] = "center";
  }
  if (isCssValue(layout.display) && !css.display)
    css.display = formatCssValue("display", layout.display);
  if (isCssValue(layout.alignItems))
    css["align-items"] = formatCssValue("align-items", layout.alignItems);
  if (isCssValue(layout.justifyContent))
    css["justify-content"] = formatCssValue("justify-content", layout.justifyContent);
  if (kind === "stack") {
    css.display = "flex";
    css["flex-direction"] = "column";
  }
  if (isCssValue(layout.gap)) css.gap = formatCssValue("gap", layout.gap);
  if (isCssValue(layout.padding)) css.padding = formatCssValue("padding", layout.padding);
}

function applySurface(value: unknown, css: Record<string, string | number>) {
  const surface = asRecord(value);
  if (isCssValue(surface.background))
    css.background = formatCssValue("background", surface.background);
  if (isCssValue(surface.color)) css.color = formatCssValue("color", surface.color);
  if (isCssValue(surface.border)) css.border = formatCssValue("border", surface.border);
  if (isCssValue(surface.shadow)) css["box-shadow"] = formatCssValue("box-shadow", surface.shadow);
}

function applyTypography(value: unknown, css: Record<string, string | number>) {
  const typography = asRecord(value);
  if (isCssValue(typography.size)) css["font-size"] = formatCssValue("font-size", typography.size);
  if (isCssValue(typography.weight))
    css["font-weight"] = formatCssValue("font-weight", typography.weight);
  if (isCssValue(typography.lineHeight))
    css["line-height"] = formatCssValue("line-height", typography.lineHeight);
}

function applyShape(value: unknown, css: Record<string, string | number>) {
  const shape = asRecord(value);
  if (isCssValue(shape.radius))
    css["border-radius"] = formatCssValue("border-radius", shape.radius);
}

function applySize(value: unknown, css: Record<string, string | number>) {
  const size = asRecord(value);
  if (isCssValue(size.width)) css.width = formatCssValue("width", size.width);
  if (isCssValue(size.minWidth)) css["min-width"] = formatCssValue("min-width", size.minWidth);
  if (isCssValue(size.height)) css.height = formatCssValue("height", size.height);
  if (isCssValue(size.minHeight)) css["min-height"] = formatCssValue("min-height", size.minHeight);
  if (isCssValue(size.padding)) css.padding = formatCssValue("padding", size.padding);
}

function applyMotion(value: unknown, css: Record<string, string | number>) {
  const motion = asRecord(value);
  if (motion.pressable || motion.transition) {
    css.transition = "transform 160ms ease, background 160ms ease, border-color 160ms ease";
  }
}

function isCssProperty(key: string): boolean {
  return key.startsWith("--") || /^[a-z][a-zA-Z0-9]*$/.test(key);
}

function isCssValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function formatCssValue(property: string, value: string | number): string | number {
  if (typeof value !== "number" || value === 0) return value;
  if (unitlessCssProperties.has(property)) return value;
  return `${value}px`;
}

const unitlessCssProperties = new Set([
  "flex",
  "font-weight",
  "line-height",
  "opacity",
  "order",
  "z-index",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cssEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function collectForbiddenAppStyling(file: string, source: string, issues: AppConventionIssue[]) {
  if (/\bclassName\s*=|\bclass\s*=/.test(source)) {
    issues.push({
      file,
      message: "app.tsx must not use class/className; style through semantic components.",
    });
  }
  if (/\bstyle\s*=/.test(source)) {
    issues.push({
      file,
      message: "app.tsx must not use inline style; put visual rules in styles.ts.",
    });
  }
}

function collectForbiddenComponentStyling(
  file: string,
  source: string,
  issues: AppConventionIssue[],
) {
  if (/\bclassName\s*=|\bclass\s*=/.test(source)) {
    issues.push({
      file,
      message:
        "components must not use class/className in strict style apps; render generated component parts.",
    });
  }
  if (/\bstyle\s*=/.test(source)) {
    issues.push({
      file,
      message:
        "components must not use inline style in strict style apps; put visual rules in styles.ts.",
    });
  }
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (/\.[cm]?tsx?$/.test(path)) files.push(path);
  }
  return files;
}

function detectUIRuntime(uiPath: string): "native" | "react" {
  const source = readFileSync(uiPath, "utf8");
  return source.includes("@poggers/kit/ui") ? "native" : "react";
}

function serverEntrypointSource(
  paths: AppPaths,
  serverEntrypoint: string,
  appEntrypoint: string,
  browserEntry: string,
  browserBundle: string,
  browserStyle?: string,
  title?: string,
): string {
  const workerImport = paths.worker
    ? `import * as workerModule from ${JSON.stringify(importSpecifier(serverEntrypoint, paths.worker))};
const workerExports = workerModule as Record<string, any>;
const worker = workerExports.default ?? workerExports.worker;
const deps = typeof workerExports.createWorkerDeps === "function"
  ? await workerExports.createWorkerDeps()
  : "deps" in workerExports
    ? await workerExports.deps
    : {};
const workerConfig = worker
  ? {
      worker,
      deps,
      workerId: workerExports.workerId ?? ${JSON.stringify(`${titleFromDir(paths.appDir)}-worker`)},
      actor: workerExports.workerActor,
      store: workerExports.workerStore,
    }
  : undefined;
`
    : "const workerConfig = undefined;\n";

  return `import * as apiModule from ${JSON.stringify(importSpecifier(serverEntrypoint, appEntrypoint))};
import { serveApp } from "@poggers/kit/app";
${workerImport}
const apiExports = apiModule as Record<string, any>;
const api = apiExports.api ?? apiExports.default;
if (!api) throw new Error("App API module must export api or default.");
const browserProgram = api.def?.programs?.browser;
const serverProgram = api.def?.programs?.server;
const programEnv = serverProgram ? "server" : browserProgram ? "browser" : undefined;
const program = serverProgram ?? browserProgram;
const createProgramDeps = programEnv
  ? api.def?.deps?.[programEnv] ??
    apiExports[\`create\${programEnv[0].toUpperCase()}\${programEnv.slice(1)}Deps\`] ??
    apiExports.createProgramDeps
  : undefined;
const programDeps = typeof createProgramDeps === "function"
  ? await createProgramDeps()
  : programEnv && \`\${programEnv}Deps\` in apiExports
    ? await apiExports[\`\${programEnv}Deps\`]
    : "programDeps" in apiExports
      ? await apiExports.programDeps
      : {};
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

async function readBuildOutputs(outputs: Blob[]): Promise<{ script?: string; style?: string }> {
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
  return { script, style };
}

function frameworkBuildDir(paths: AppPaths): string {
  return resolve(paths.appDir, ".app/build");
}

function frameworkDevDir(paths: AppPaths): string {
  return resolve(paths.appDir, ".app/dev");
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

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
