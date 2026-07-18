import { accessSync, statSync } from "node:fs";
import { glob, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import stylex from "@stylexjs/unplugin/vite";
import {
  build,
  createServer,
  defaultClientConditions,
  defaultServerConditions,
  type HmrContext,
  type ModuleNode,
  type Plugin,
} from "vite";

import { emitRustProgram } from "../compiler/backend.rust";
import { compileProduct } from "../compiler/frontend";
import { createHotManifest } from "../compiler/hot";
import { serializeProductIR, type ProductIR } from "../compiler/ir";
import { transformComponentSource } from "../ui/compiler/application";
import {
  analyzeVisualContract,
  bundleVisualFontAssets,
  materializeVisualPresentation,
} from "../ui/compiler/presentation";
import { generateVisualStylexModule } from "../ui/compiler/stylex";

export type ApplicationPaths = Readonly<{
  directory: string;
  source: string;
  application: string;
}>;

export type DevelopmentServer = Readonly<{
  port: number;
  stop(): Promise<void>;
}>;

type PreparedApplication = Readonly<{
  candidate: string;
  entry: string;
  ir: ProductIR;
  updateKind: "full" | "presentation";
  visual: string;
}>;

export function resolveApplication(directory: string): ApplicationPaths {
  const root = resolve(directory);
  const source = resolve(root, "src");
  for (const name of ["app.tsx", "app.ts"]) {
    const application = resolve(source, name);
    try {
      if (statSync(application).size > 0) return { directory: root, source, application };
    } catch {
      continue;
    }
  }
  throw new Error(`${source} must contain app.tsx or app.ts.`);
}

export async function buildApplication(options: {
  directory: string;
  outdir?: string;
  development?: boolean;
}): Promise<string> {
  const paths = resolveApplication(options.directory);
  const outdir = resolve(paths.directory, options.outdir ?? ".poggers/build");
  const work = resolve(paths.directory, ".poggers", options.development ? "dev" : "build");
  await rm(outdir, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const prepared = await prepareApplication(paths, work, options.development ?? false);

  await writeFile(resolve(outdir, "product.ir.json"), serializeProductIR(prepared.ir));
  await build({
    ...viteConfiguration(paths, options.development),
    build: {
      emptyOutDir: false,
      minify: options.development ? false : "oxc",
      outDir: outdir,
      rollupOptions: {
        input: prepared.entry,
        output: {
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith(".css"))
              ? "styles.css"
              : "assets/[name]-[hash][extname]",
          entryFileNames: "app.js",
        },
      },
      sourcemap: options.development ? "inline" : false,
      target: "es2022",
    },
  });
  for await (const asset of glob("**/*.css", { cwd: outdir })) {
    const path = resolve(outdir, asset);
    if (path !== resolve(outdir, "styles.css")) {
      await rename(path, resolve(outdir, "styles.css"));
    }
  }
  await writeFile(resolve(outdir, "index.html"), htmlSource("/app.js", false));
  return outdir;
}

export async function buildRustApplication(options: {
  directory: string;
  outdir?: string;
  program?: string;
  adapter?: string;
}): Promise<string> {
  const paths = resolveApplication(options.directory);
  const ir = compileProduct(paths.application);
  const program = selectRustProgram(ir, options.program);
  const outdir = resolve(paths.directory, options.outdir ?? ".poggers/rust", program.name);
  await rm(outdir, { recursive: true, force: true });
  return emitRustProgram({
    ir,
    program: program.id,
    directory: outdir,
    fixtures: {},
    adapterSource: options.adapter
      ? await readFile(resolve(paths.directory, options.adapter), "utf8")
      : undefined,
  });
}

function selectRustProgram(ir: ProductIR, selector?: string) {
  const portable = ir.programs.filter((program) => !program.ui && program.start);
  if (!selector) {
    if (portable.length === 1) return portable[0]!;
    throw new Error(
      `Select one portable headless Program with --program. Available: ${portable.map(({ id }) => id).join(", ") || "none"}.`,
    );
  }
  const matches = portable.filter(
    (program) =>
      program.id === selector ||
      program.name === selector ||
      `${program.feature}.${program.name}` === selector,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Program selector ${JSON.stringify(selector)} is ambiguous; use its full ID.`);
  }
  throw new Error(`No portable headless Program matches ${JSON.stringify(selector)}.`);
}

export async function runApplication(options: {
  directory: string;
  port?: number;
}): Promise<DevelopmentServer> {
  const paths = resolveApplication(options.directory);
  const work = resolve(paths.directory, ".poggers", "dev");
  await rm(work, { recursive: true, force: true });
  await prepareApplication(paths, work, true);
  await writeFile(resolve(work, "index.html"), htmlSource("/browser.generated.ts", true));

  const server = await createServer({
    ...viteConfiguration(paths, true),
    appType: "spa",
    plugins: [visualContractPlugin(paths, work), ...vitePlugins(paths, true)],
    root: work,
    server: {
      fs: { allow: [paths.directory, resolve(import.meta.dirname, "../../..")] },
      host: "localhost",
      port: options.port ?? 3000,
      strictPort: options.port !== undefined,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 3000);

  return {
    port,
    async stop() {
      await server.close();
      await rm(resolve(paths.directory, ".poggers"), { recursive: true, force: true });
    },
  };
}

async function prepareApplication(
  paths: ApplicationPaths,
  work: string,
  development: boolean,
  updateKind: "full" | "presentation" = "full",
): Promise<PreparedApplication> {
  await mkdir(work, { recursive: true });
  const ir = compileProduct(paths.application);
  const contract = analyzeVisualContract(paths.application);
  const application = await loadApplication(paths, work);
  validateUIProgramRoot(application, contract.uiProgram);
  const authored = record(application.presentations);
  const materialized = await Promise.all(
    contract.presentations.map(async (presentation) => {
      const source = authored[presentation.name];
      if (!source) throw new Error(`Application is missing Presentation "${presentation.name}".`);
      return bundleVisualFontAssets(
        materializeVisualPresentation(presentation.name, source, contract.surface, presentation),
        presentation.location.file,
      );
    }),
  );

  const visualModule = resolve(work, "visual.generated.stylex.ts");
  await writeIfChanged(visualModule, generateVisualStylexModule(materialized));
  const candidate = resolve(work, "application.generated.ts");
  await writeIfChanged(
    candidate,
    candidateSource({
      application: paths.application,
      componentRuntime: resolve(import.meta.dirname, `../ui/web/component${moduleExtension()}`),
      renderer: resolve(import.meta.dirname, `../ui/web/runtime${moduleExtension()}`),
      visualModule,
      program: contract.uiProgram,
      components: contract.surface.components,
      presentations: contract.presentations.map(({ name }) => name),
      hotManifest: createHotManifest(ir),
      updateKind,
    }),
  );
  const entry = resolve(work, "browser.generated.ts");
  await writeIfChanged(
    entry,
    browserSource({
      candidate,
      development,
      hotRuntime: resolve(import.meta.dirname, `../compiler/hot${moduleExtension()}`),
    }),
  );
  return { candidate, entry, ir, updateKind, visual: visualModule };
}

async function writeIfChanged(path: string, contents: string): Promise<boolean> {
  try {
    if ((await readFile(path, "utf8")) === contents) return false;
  } catch {}
  await writeFile(path, contents);
  return true;
}

function viteConfiguration(paths: ApplicationPaths, development = false) {
  return {
    configFile: false as const,
    mode: development ? "development" : "production",
    plugins: vitePlugins(paths, development),
    resolve: {
      alias: kitAliases(),
      conditions: ["poggers-source", ...defaultClientConditions],
    },
    root: paths.directory,
  };
}

function kitAliases() {
  const kit = resolve(import.meta.dirname, "..");
  const ui = resolve(kit, "ui");
  const extension = moduleExtension();
  return [
    { find: "#ui", replacement: ui },
    {
      find: "@poggers/kit/jsx-dev-runtime",
      replacement: resolve(ui, `web/jsx-dev-runtime${extension}`),
    },
    {
      find: "@poggers/kit/jsx-runtime",
      replacement: resolve(ui, `web/jsx-runtime${extension}`),
    },
    { find: "@poggers/kit/presentation", replacement: resolve(ui, `presentation${extension}`) },
    { find: "@poggers/kit/ui", replacement: resolve(ui, `index${extension}`) },
    { find: /^@poggers\/kit$/, replacement: resolve(kit, `index${extension}`) },
  ];
}

function moduleExtension(): ".ts" | ".js" {
  return import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
}

function vitePlugins(paths: ApplicationPaths, development: boolean): Plugin[] {
  return [
    sourceAliasPlugin(paths.source),
    componentTransformPlugin(paths.source),
    stylex({
      devMode: development ? "full" : "off",
      enableMediaQueryOrder: false,
      runtimeInjection: false,
      useCSSLayers: true,
    }) as Plugin,
  ];
}

function componentTransformPlugin(source: string): Plugin {
  return {
    name: "poggers-components",
    enforce: "pre",
    transform(code, rawId) {
      const id = cleanId(rawId);
      if (!id.startsWith(source) || !/\.[cm]?[jt]sx?$/.test(id)) return;
      return {
        code: transformComponentSource(code, id, {
          stripPresentations: basename(id) === "app.tsx" || basename(id) === "app.ts",
        }),
        map: null,
      };
    },
  };
}

function sourceAliasPlugin(source: string): Plugin {
  return {
    name: "poggers-source-alias",
    enforce: "pre",
    resolveId(id) {
      if (!id.startsWith("src/")) return;
      const base = resolve(source, id.slice("src/".length));
      for (const extension of ["", ".tsx", ".ts", ".jsx", ".js"]) {
        const candidate = `${base}${extension}`;
        try {
          accessSync(candidate);
          return candidate;
        } catch {
          continue;
        }
      }
      return base;
    },
  };
}

function visualContractPlugin(paths: ApplicationPaths, work: string): Plugin {
  const generated = [
    resolve(work, "application.generated.ts"),
    resolve(work, "browser.generated.ts"),
    resolve(work, "visual.generated.stylex.ts"),
  ];
  let updates = Promise.resolve();
  const refresh = async (context: HmrContext): Promise<ModuleNode[] | undefined> => {
    if (generated.includes(context.file)) return [];
    if (!context.file.startsWith(paths.source)) return undefined;
    let modules: ModuleNode[] = [];
    updates = updates.then(async () => {
      try {
        const presentationRoot = `${resolve(paths.source, "presentations")}/`;
        const prepared = await prepareApplication(
          paths,
          work,
          true,
          context.file.startsWith(presentationRoot) ? "presentation" : "full",
        );
        const visualModules = [
          ...(context.server.moduleGraph.getModulesByFile(prepared.visual) ?? []),
        ];
        const candidateModules = [
          ...(context.server.moduleGraph.getModulesByFile(prepared.candidate) ?? []),
        ];
        for (const module of [...visualModules, ...candidateModules]) {
          context.server.moduleGraph.invalidateModule(module);
        }
        modules =
          prepared.updateKind === "full"
            ? [...new Set([...context.modules, ...candidateModules])]
            : candidateModules;
      } catch (error) {
        context.server.config.logger.error(error instanceof Error ? error.message : String(error));
        modules = [];
      }
    });
    await updates;
    return modules;
  };
  return {
    name: "poggers-visual-contract",
    async handleHotUpdate(context) {
      return refresh(context);
    },
  };
}

async function loadApplication(
  paths: ApplicationPaths,
  work: string,
): Promise<Record<string, unknown>> {
  const evaluate = resolve(work, "evaluate");
  await rm(evaluate, { recursive: true, force: true });
  await build({
    configFile: false,
    root: paths.directory,
    resolve: {
      alias: kitAliases(),
      conditions: ["poggers-source", ...defaultServerConditions],
    },
    plugins: [sourceAliasPlugin(paths.source)],
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: evaluate,
      rollupOptions: {
        input: paths.application,
        output: { entryFileNames: "application.js", format: "es" },
      },
      ssr: true,
      target: "node24",
    },
    ssr: { noExternal: true },
  });
  const output = resolve(evaluate, "application.js");
  const loaded = (await import(`${pathToFileURL(output).href}?v=${Date.now()}`)) as {
    default?: unknown;
  };
  return record(loaded.default ?? loaded);
}

function candidateSource(input: {
  application: string;
  componentRuntime: string;
  renderer: string;
  visualModule: string;
  program: string;
  components: unknown;
  presentations: readonly string[];
  hotManifest: unknown;
  updateKind: "full" | "presentation";
}): string {
  const presentationMap = Object.fromEntries(input.presentations.map((name) => [name, {}]));
  return `import application from ${JSON.stringify(input.application)};
import { createApplicationUI } from ${JSON.stringify(input.componentRuntime)};
import { render } from ${JSON.stringify(input.renderer)};
import { compiledVisuals } from ${JSON.stringify(input.visualModule)};

export const manifest = ${JSON.stringify(input.hotManifest)};
export const updateKind = ${JSON.stringify(input.updateKind)};
export { compiledVisuals };

export async function activate(root, previous = {}) {
  const hotState = {
    ...previous,
    keyed: { ...previous.keyed },
    programs: Object.fromEntries(
      Object.entries(previous.programs ?? {}).map(([name, state]) => [name, { ...state }]),
    ),
    scroll: { ...previous.scroll },
    values: previous.values?.slice(),
  };
  const ui = createApplicationUI({
    application,
    program: ${JSON.stringify(input.program)},
    presentations: { presentations: ${JSON.stringify(presentationMap)} },
    components: ${JSON.stringify(input.components)},
    compiledVisuals,
    hotState,
  });
  let disposeRender;
  try {
    disposeRender = render(() => ui.renderRoot(), root, hotState);
  } catch (error) {
    await ui.dispose();
    throw error;
  }
  let disposed = false;
  return {
    value: ui,
    get snapshot() {
      disposeRender.capture();
      ui.captureHotState();
      return hotState;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeRender();
      await ui.dispose();
    },
  };
}
`;
}

function browserSource(input: {
  candidate: string;
  development: boolean;
  hotRuntime: string;
}): string {
  const candidate = `./${basename(input.candidate)}`;
  if (!input.development) {
    return `import * as candidate from ${JSON.stringify(candidate)};

const root = document.querySelector("#app");
if (!root) throw new Error("Missing application root.");
const active = await candidate.activate(root);
const dispose = () => void active.dispose();
addEventListener("pagehide", dispose, { once: true });
`;
  }
  return `import * as initialCandidate from ${JSON.stringify(candidate)};
import { HotUpdateCoordinator } from ${JSON.stringify(input.hotRuntime)};

const root = document.querySelector("#app");
if (!root) throw new Error("Missing application root.");
const coordinator = import.meta.hot?.data.coordinator ?? new HotUpdateCoordinator();
const apply = async (candidate) => {
  if (
    candidate.updateKind === "presentation" &&
    coordinator.value?.updateCompiledVisuals(candidate.compiledVisuals)
  ) {
    return;
  }
  const result = await coordinator.replace({
    manifest: candidate.manifest,
    async prepare(previous) {
      return { activate: () => candidate.activate(root, previous) };
    },
  });
  if (result.status === "rejected") {
    if (result.reason === "incompatible-manifest") {
      location.reload();
      return;
    }
    console.error("[poggers] hot update rejected: " + result.reason);
  }
};
await apply(initialCandidate);
const dispose = () => void coordinator.dispose();
addEventListener("pagehide", dispose, { once: true });

if (import.meta.hot) {
  import.meta.hot.data.coordinator = coordinator;
  import.meta.hot.accept(${JSON.stringify(candidate)}, async (next) => {
    if (next) await apply(next);
  });
  import.meta.hot.dispose(() => removeEventListener("pagehide", dispose));
}
`;
}

function htmlSource(entry: string, development: boolean): string {
  const styles = development
    ? '<link rel="stylesheet" href="/virtual:stylex.css"><script type="module">import("virtual:stylex:runtime")</script>'
    : '<link rel="stylesheet" href="/styles.css">';
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>@layer reset{${resetCss()}}</style>${styles}<title>Poggers</title></head><body><div id="app"></div><script type="module" src="${entry}"></script></body></html>`;
}

function resetCss(): string {
  return `*,*::before,*::after{box-sizing:border-box}html{color-scheme:light dark;-webkit-text-size-adjust:100%;text-size-adjust:100%;tab-size:4}html,body,#app{min-block-size:100%;margin:0}body{min-block-size:100dvb}body,h1,h2,h3,h4,p,figure,blockquote,dl,dd{margin:0}button,input,textarea,select{font:inherit;color:inherit}button{border:0;padding:0;background:none}dialog{max-inline-size:none;max-block-size:none;margin:0;border:0;padding:0;color:inherit;background:transparent}dialog::backdrop{background:transparent}img,picture,svg,canvas{display:block;max-inline-size:100%}input,button,textarea,select{margin:0}textarea:not([rows]){min-block-size:10em}:target{scroll-margin-block:5ex}[hidden]{display:none!important}`;
}

function cleanId(id: string): string {
  const query = id.indexOf("?");
  return query < 0 ? id : id.slice(0, query);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function validateUIProgramRoot(application: Record<string, unknown>, program: string): void {
  const roots: string[] = [];
  const visit = (features: unknown, parent: string) => {
    for (const [name, featureValue] of Object.entries(record(features))) {
      const feature = record(featureValue);
      const path = parent ? `${parent}.${name}` : name;
      const programs = record(feature.programs);
      const definition = record(programs[program]);
      if (typeof definition.root === "string") roots.push(`${path}.${definition.root}`);
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  if (roots.length !== 1) {
    throw new Error(
      `UI Program "${program}" must define exactly one root Component; found ${roots.length}.`,
    );
  }
}
