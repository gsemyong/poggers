import { accessSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  build,
  createServer,
  defaultClientConditions,
  defaultServerConditions,
  type HmrContext,
  type ModuleNode,
  type Plugin,
} from "vite";

import { transformComponentSource } from "@/adapters/web/ui/component/compiler";
import { validateWebPresentationSource } from "@/adapters/web/ui/presentation/compiler";
import { collectProgramManifest } from "@/core/capability";
import { serializeApplicationIR, type ApplicationIR, type ComponentIR } from "@/core/compiler/ir";
import { compilePresentationSource } from "@/core/compiler/presentation";
import {
  createApplicationCompiler,
  resolveApplication,
  type ApplicationCompiler,
  type ApplicationPaths,
} from "@/core/compiler/source";
import { createHotReplacementManifest } from "@/core/development";

export type DevelopmentServer = Readonly<{
  port: number;
  stop(): Promise<void>;
}>;

type PreparedApplication = Readonly<{
  candidate: string;
  entry: string;
  ir: ApplicationIR;
  presentationSources: ReadonlySet<string>;
  revision: number;
  updateKind: "full" | "presentation";
}>;

type WebComponentEnvironmentContract = Readonly<{
  elements: Readonly<Record<string, string>>;
  state: readonly Readonly<{ name: string }>[];
  propCallbacks: readonly string[];
}>;

function webApplicationContract(ir: ApplicationIR): Readonly<{
  uiProgram: string;
  components: Readonly<Record<string, WebComponentEnvironmentContract>>;
}> {
  const names = new Set(
    ir.programs
      .filter(({ environment, ui }) => environment.name === "browser-main" && ui)
      .map(({ name }) => name),
  );
  if (names.size !== 1) {
    throw new Error(
      `Application must define exactly one BrowserMainThread UI Program; found ${names.size}.`,
    );
  }
  const uiProgram = [...names][0]!;
  const components: Record<string, WebComponentEnvironmentContract> = Object.create(null);
  for (const program of ir.programs) {
    if (program.name !== uiProgram || program.environment.name !== "browser-main" || !program.ui)
      continue;
    for (const component of program.ui.components) {
      const name = runtimeComponentName(program.feature, component.name);
      if (components[name]) throw new Error(`Duplicate runtime Component ${JSON.stringify(name)}.`);
      components[name] = componentEnvironmentContract(component);
    }
  }
  return { uiProgram, components };
}

function runtimeComponentName(feature: string, component: string): string {
  return feature ? `@feature/${feature}/component/${component}` : component;
}

function componentEnvironmentContract(component: ComponentIR): WebComponentEnvironmentContract {
  return {
    elements: Object.fromEntries(component.elements.map(({ name, element }) => [name, element])),
    state:
      component.state.kind === "record" ? component.state.fields.map(({ name }) => ({ name })) : [],
    propCallbacks: component.propCallbacks,
  };
}

export async function buildApplication(options: {
  directory: string;
  outdir: string;
  development?: boolean;
}): Promise<string> {
  const paths = resolveApplication(options.directory);
  const outdir = resolve(paths.directory, options.outdir);
  const work = await realpath(
    await mkdtemp(
      resolve(tmpdir(), options.development ? "poggers-web-dev-build-" : "poggers-web-build-"),
    ),
  );
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  try {
    const prepared = await prepareApplication(paths, work, options.development ?? false);

    await writeFile(resolve(outdir, "application.ir.json"), serializeApplicationIR(prepared.ir));
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
    await writeFile(resolve(outdir, "index.html"), htmlSource("/app.js"));
    return outdir;
  } finally {
    await removeWorkDirectory(work);
  }
}

export async function runApplication(options: {
  directory: string;
  port?: number;
}): Promise<DevelopmentServer> {
  const paths = resolveApplication(options.directory);
  const work = await realpath(await mkdtemp(resolve(tmpdir(), "poggers-web-dev-")));
  const compiler = createApplicationCompiler(paths.application);
  const prepared = await prepareApplication(paths, work, true, "full", compiler);
  await writeFile(resolve(work, "index.html"), htmlSource("/browser.generated.ts"));

  const server = await createServer({
    ...viteConfiguration(paths, true),
    appType: "spa",
    plugins: [presentationContractPlugin(paths, work, compiler, prepared), ...vitePlugins(paths)],
    root: work,
    server: {
      fs: { allow: [work, paths.directory, resolve(import.meta.dirname, "../../..")] },
      host: "localhost",
      port: options.port ?? 3000,
      strictPort: options.port !== undefined,
    },
  });
  await server.listen();
  await server.watcher.unwatch([prepared.candidate, prepared.entry]);
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 3000);
  const cleanupOnExit = () => rmSync(work, { recursive: true, force: true });
  process.once("exit", cleanupOnExit);

  return {
    port,
    async stop() {
      process.off("exit", cleanupOnExit);
      await server.close();
      await removeWorkDirectory(work);
    },
  };
}

async function removeWorkDirectory(work: string): Promise<void> {
  await rm(work, { recursive: true, force: true });
}

async function prepareApplication(
  paths: ApplicationPaths,
  work: string,
  development: boolean,
  updateKind: "full" | "presentation" = "full",
  compiler: ApplicationCompiler = createApplicationCompiler(paths.application),
  previous?: PreparedApplication,
  changedFile?: string,
): Promise<PreparedApplication> {
  await mkdir(work, { recursive: true });
  const compilation =
    updateKind === "presentation" && previous
      ? { ir: previous.ir, presentationSources: previous.presentationSources }
      : compiler.compile(changedFile);
  const { ir } = compilation;
  const contract = webApplicationContract(ir);
  const revision = (previous?.revision ?? -1) + 1;
  if (!development) {
    const application = await loadApplication(paths, work);
    validateUIProgramRoot(application, contract.uiProgram);
    const authored = record(application.presentations);
    for (const presentation of ir.application.presentations) {
      if (!authored[presentation]) {
        throw new Error(`Application is missing Presentation "${presentation}".`);
      }
    }
  }

  const candidate = resolve(work, "application.generated.ts");
  await writeIfChanged(
    candidate,
    candidateSource({
      application: paths.application,
      capabilityModule: resolveProgramCapabilities(paths, contract.uiProgram),
      development,
      revision,
      runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
      program: contract.uiProgram,
      programManifest: collectProgramManifest(contract.uiProgram, ir.programs),
      components: contract.components,
      presentationDependencies: collectPresentationDependencies(ir, contract.uiProgram),
      hotManifest: createHotReplacementManifest(ir),
    }),
  );
  const entry = resolve(work, "browser.generated.ts");
  await writeIfChanged(
    entry,
    browserSource({
      candidate,
      development,
      runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
    }),
  );
  return {
    candidate,
    entry,
    ir,
    presentationSources: compilation.presentationSources,
    revision,
    updateKind,
  };
}

function resolveProgramCapabilities(paths: ApplicationPaths, program: string): string | undefined {
  for (const extension of [".ts", ".tsx"]) {
    const candidate = resolve(paths.source, "capabilities", `${program}${extension}`);
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
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
    plugins: vitePlugins(paths),
    resolve: {
      alias: kitAliases(),
      conditions: ["poggers-source", ...defaultClientConditions],
    },
    root: paths.directory,
  };
}

function kitAliases() {
  const kit = resolve(import.meta.dirname, "../..");
  const core = resolve(kit, "core");
  const web = resolve(kit, "adapters/web");
  const extension = moduleExtension();
  return [
    { find: /^@\/(.*)$/, replacement: `${kit}/$1` },
    {
      find: /^@poggers\/kit\/jsx-dev-runtime$/,
      replacement: resolve(core, `jsx/development${extension}`),
    },
    {
      find: /^@poggers\/kit\/jsx-runtime$/,
      replacement: resolve(core, `jsx/runtime${extension}`),
    },
    { find: /^@poggers\/kit\/web$/, replacement: resolve(web, `platform${extension}`) },
    { find: /^@poggers\/kit$/, replacement: resolve(kit, `index${extension}`) },
  ];
}

function moduleExtension(): ".ts" | ".js" {
  return import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
}

function vitePlugins(paths: ApplicationPaths): Plugin[] {
  return [
    sourceAliasPlugin(paths.source),
    presentationTransformPlugin(paths.source),
    componentTransformPlugin(paths.source),
  ];
}

function presentationTransformPlugin(source: string): Plugin {
  return {
    name: "poggers-presentations",
    enforce: "pre",
    transform(code, rawId) {
      const id = cleanId(rawId);
      if (!id.startsWith(source) || !/\.[cm]?[jt]sx?$/.test(id) || !code.includes("animate(")) {
        return;
      }
      const compilation = compilePresentationSource(code, id);
      validateWebPresentationSource(compilation.ir);
      return { code: compilation.code, map: null };
    },
  };
}

function componentTransformPlugin(source: string): Plugin {
  return {
    name: "poggers-components",
    enforce: "pre",
    transform(code, rawId) {
      const id = cleanId(rawId);
      if (!id.startsWith(source) || !/\.[cm]?[jt]sx?$/.test(id)) return;
      return {
        code: transformComponentSource(code, id),
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

function presentationContractPlugin(
  paths: ApplicationPaths,
  work: string,
  compiler: ApplicationCompiler,
  initial: PreparedApplication,
): Plugin {
  const generated = [
    resolve(work, "application.generated.ts"),
    resolve(work, "browser.generated.ts"),
  ];
  let prepared = initial;
  let updates = Promise.resolve();
  const refresh = async (context: HmrContext): Promise<ModuleNode[] | undefined> => {
    if (generated.includes(context.file)) return [];
    if (!context.file.startsWith(paths.source)) return undefined;
    let modules: ModuleNode[] = [];
    updates = updates.then(async () => {
      try {
        const started = performance.now();
        const updateKind = presentationUpdate(context, prepared.presentationSources)
          ? "presentation"
          : "full";
        prepared = await prepareApplication(
          paths,
          work,
          true,
          updateKind,
          compiler,
          prepared,
          context.file,
        );
        context.server.config.logger.info(
          `[poggers] ${updateKind} semantic update ${Math.round((performance.now() - started) * 10) / 10}ms`,
          { timestamp: true },
        );
        const candidateModules = [
          ...(context.server.moduleGraph.getModulesByFile(prepared.candidate) ?? []),
        ];
        const invalidated = new Set<ModuleNode>();
        const timestamp = Date.now();
        for (const module of context.modules) {
          context.server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
        }
        for (const module of candidateModules) {
          context.server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
        }
        context.server.ws.send({
          type: "custom",
          event: "poggers:update-kind",
          data: { kind: updateKind },
        });
        // The browser entry accepts the generated candidate, not arbitrary authored leaves.
        // Returning that boundary lets Vite replace Presentation modules without reloading.
        modules = candidateModules;
      } catch (error) {
        context.server.config.logger.error(error instanceof Error ? error.message : String(error));
        modules = [];
      }
    });
    await updates;
    return modules;
  };
  return {
    name: "poggers-presentation-contract",
    async handleHotUpdate(context) {
      return refresh(context);
    },
  };
}

function presentationUpdate(
  context: HmrContext,
  presentationSources: ReadonlySet<string>,
): boolean {
  if (presentationSources.has(resolve(context.file))) return true;
  const pending = [...context.modules];
  const visited = new Set<ModuleNode>();
  while (pending.length) {
    const module = pending.pop()!;
    if (visited.has(module)) continue;
    visited.add(module);
    if (module.file && presentationSources.has(resolve(module.file))) return true;
    pending.push(...module.importers);
  }
  return false;
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
      target: "node26",
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
  capabilityModule?: string;
  development: boolean;
  revision: number;
  runtime: string;
  program: string;
  programManifest: unknown;
  components: unknown;
  presentationDependencies: unknown;
  hotManifest: unknown;
}): string {
  const application = input.development
    ? `${input.application}?poggers-revision=${input.revision}`
    : input.application;
  const capabilityModule = input.capabilityModule
    ? `import capabilityModule from ${JSON.stringify(input.capabilityModule)};`
    : `const capabilityModule = { development: () => ({}), production: () => ({}) };`;
  return `import application from ${JSON.stringify(application)};
import { createWebUIAdapter, render } from ${JSON.stringify(input.runtime)};
${capabilityModule}

export const manifest = ${JSON.stringify(input.hotManifest)};
export const presentations = application.presentations ?? {};

export async function activate(root, previous = {}) {
  const hotState = {
    ...previous,
    keyed: { ...previous.keyed },
    programs: Object.fromEntries(
      Object.entries(previous.programs ?? {}).map(([name, state]) => [name, { ...state }]),
    ),
    presentation: previous.presentation,
    scroll: { ...previous.scroll },
    values: previous.values?.slice(),
  };
  const platform = createWebUIAdapter();
  const capabilities = await capabilityModule.${input.development ? "development" : "production"}();
  const ui = platform.component.createApplicationUI({
    application,
    program: ${JSON.stringify(input.program)},
    programManifest: ${JSON.stringify(input.programManifest)},
    capabilities,
    presentations: { presentations },
    components: ${JSON.stringify(input.components)},
    presentationDependencies: ${JSON.stringify(input.presentationDependencies)},
    hotState,
    boundary: root,
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

/** @internal Lowers source-level temporal provenance to runtime Component identities. */
export function collectPresentationDependencies(
  ir: ApplicationIR,
  programName: string,
): Readonly<
  Record<
    string,
    readonly Readonly<{
      destination: string;
      animations: readonly Readonly<{ id: string; scope: string }>[];
    }>[]
  >
> {
  const components = ir.programs
    .filter(
      ({ name, environment, ui }) =>
        name === programName && environment.name === "browser-main" && Boolean(ui),
    )
    .flatMap((program) =>
      (program.ui?.components ?? []).map((component) => {
        const semantic = [
          ...program.feature.split(".").filter(Boolean).map(capitalize),
          component.name,
        ].join("/");
        return {
          semantic,
          runtime: runtimeComponentName(program.feature, component.name),
        };
      }),
    )
    .sort((left, right) => right.semantic.length - left.semantic.length);
  const animationScopes = new Map(
    ir.presentations.flatMap(({ animations }) =>
      animations.map(({ id, scope }) => [id, scope] as const),
    ),
  );
  const dependencies = new Map<
    string,
    Array<{
      destination: string;
      animations: Array<{ id: string; scope: string }>;
    }>
  >();
  const referenced = new Set<string>();
  for (const source of ir.presentations) {
    for (const declaration of source.declarations) {
      const component = components.find(({ semantic }) =>
        declaration.destination.startsWith(`${semantic}/`),
      );
      if (!component) continue;
      const animations = declaration.animations.flatMap((id) => {
        const scope = animationScopes.get(id);
        if (!scope) return [];
        referenced.add(id);
        return [{ id, scope }];
      });
      if (!animations.length) continue;
      const entries = dependencies.get(component.runtime) ?? [];
      entries.push({ destination: declaration.destination, animations });
      dependencies.set(component.runtime, entries);
    }
  }

  // An Animation used outside a declaration leaf cannot yet be classified
  // precisely. Keep every Component canonical instead of guessing static.
  const unresolved = [...animationScopes].filter(([id]) => !referenced.has(id));
  if (unresolved.length) {
    for (const component of components) {
      const entries = dependencies.get(component.runtime) ?? [];
      entries.push({
        destination: "*",
        animations: unresolved.map(([id, scope]) => ({ id, scope })),
      });
      dependencies.set(component.runtime, entries);
    }
  }

  return Object.freeze(
    Object.fromEntries(
      [...dependencies]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([component, entries]) => [
          component,
          Object.freeze(
            entries
              .sort(({ destination: left }, { destination: right }) => left.localeCompare(right))
              .map(({ destination, animations }) =>
                Object.freeze({
                  destination,
                  animations: Object.freeze(
                    animations
                      .sort(({ id: left }, { id: right }) => left.localeCompare(right))
                      .map((animation) => Object.freeze(animation)),
                  ),
                }),
              ),
          ),
        ]),
    ),
  );
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function browserSource(input: {
  candidate: string;
  development: boolean;
  runtime: string;
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
import { HotUpdateCoordinator } from ${JSON.stringify(input.runtime)};

const root = document.querySelector("#app");
if (!root) throw new Error("Missing application root.");
const coordinator = import.meta.hot?.data.coordinator ?? new HotUpdateCoordinator();
let applications = 0;
const apply = async (candidate, updateKind) => {
  const started = performance.now();
  const initial = applications++ === 0;
  let status = "applied";
  try {
    if (
      updateKind === "presentation" &&
      coordinator.value?.updatePresentations(candidate.presentations)
    ) {
      return;
    }
    const result = await coordinator.replace({
      manifest: candidate.manifest,
      async prepare(previous) {
        return { activate: () => candidate.activate(root, previous) };
      },
    });
    status = result.status;
    if (result.status === "rejected") {
      if (result.reason === "incompatible-manifest") {
        location.reload();
        return;
      }
      console.error("[poggers] hot update rejected: " + result.reason, result.cause);
    }
  } finally {
    const detail = {
      initial,
      kind: updateKind,
      status,
      milliseconds: Math.round((performance.now() - started) * 100) / 100,
    };
    globalThis.__poggersHotUpdate = detail;
    dispatchEvent(new CustomEvent("poggers:hot-update", { detail }));
  }
};
await apply(initialCandidate, "full");
const dispose = () => void coordinator.dispose();
addEventListener("pagehide", dispose, { once: true });

if (import.meta.hot) {
  let pendingUpdateKind;
  import.meta.hot.data.coordinator = coordinator;
  import.meta.hot.on("poggers:update-kind", ({ kind }) => {
    pendingUpdateKind = pendingUpdateKind === "full" || kind === "full" ? "full" : kind;
  });
  import.meta.hot.accept(${JSON.stringify(candidate)}, async (next) => {
    const updateKind = pendingUpdateKind ?? "full";
    pendingUpdateKind = undefined;
    if (next) await apply(next, updateKind);
  });
  import.meta.hot.dispose(() => removeEventListener("pagehide", dispose));
}
`;
}

function htmlSource(entry: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>@layer reset{${resetCss()}}</style><title>Poggers</title></head><body><div id="app"></div><script type="module" src="${entry}"></script></body></html>`;
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
