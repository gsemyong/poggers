import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import * as ts from "@typescript/typescript6";
import {
  build,
  createServer,
  defaultClientConditions,
  defaultServerConditions,
  type HmrContext,
  type ModuleNode,
  type Plugin,
  type ViteDevServer,
} from "vite";

import type { DevelopmentWebLoaderRegistry } from "@/adapters/integration/web-server";
import { webCompilerExtension } from "@/adapters/web/compiler";
import { createWebResponseCache } from "@/adapters/web/development/cache";
import {
  prepareClientWebDocument,
  prepareCompiledWebDocumentStream,
  renderWebDeferredFrame,
  renderWebDocument,
  renderWebMarkdown,
  WEB_MARKDOWN_MEDIA_TYPE,
  WEB_ROUTE_DATA_MEDIA_TYPE,
  webRouteHydrationMetadata,
  type WebDocumentIR,
} from "@/adapters/web/document";
import {
  createWebServiceWorkerPlan,
  planWebInstallation,
  renderWebManifest,
  renderWebServiceWorker,
  WEB_MANIFEST_PATH,
  WEB_SERVICE_WORKER_PATH,
  type WebInstallationPlan,
} from "@/adapters/web/installation";
import {
  collectWebRoutes,
  compiledWebRoute,
  matchWebRoute,
  resolveWebDestination,
  validateWebRouteMetadata,
  webRouteCacheControl,
  webProgramCompilerIR,
  type CompiledWebComponentIR,
  type CompiledWebRouteIR,
  type WebRenderNodeIR,
  WebRouteValidationError,
} from "@/adapters/web/routing";
import { transformComponentSource } from "@/adapters/web/ui/component/compiler";
import {
  validateWebPresentationSource,
  webResetCss,
} from "@/adapters/web/ui/presentation/compiler";
import type { ApplicationIR, ComponentIR, DependencyContractIR, ProgramIR } from "@/compiler/ir";
import { collectProgramManifest, linkProgram, projectDependencyContracts } from "@/compiler/linker";
import { compilePresentationSource } from "@/compiler/presentation";
import {
  createApplicationCompiler,
  resolveApplication,
  type ApplicationCompiler,
  type ApplicationPaths,
} from "@/compiler/source";
import type { WebRouteMetadataResult } from "@/platforms/web/routing";
import { createHotReplacementManifest } from "@/runtime/interpreter";

export type DevelopmentServer = Readonly<{
  port: number;
  stop(): Promise<void>;
}>;

type PreparedApplication = Readonly<{
  candidate: string;
  documentEvaluator?: string;
  entry: string;
  ir: ApplicationIR;
  presentationSources: ReadonlySet<string>;
  revision: number;
  updateKind: "full" | "presentation";
  routeEntries: readonly WebRouteEntry[];
  workers: readonly WebWorkerEntry[];
  serviceWorker?: string;
}>;

type PreparedApplicationState = {
  current: PreparedApplication;
};

type WebRouteEntry = Readonly<{
  identity: string;
  loader: boolean;
  source: string;
}>;

type WebWorkerEntry = Readonly<{
  program: string;
  environment: "browser-worker" | "browser-service-worker";
  source: string;
  output: string;
}>;

export type WebBuild = Readonly<{
  directory: string;
  entries: readonly Readonly<{ program: string; environment: string; path: string }>[];
}>;

export const WEB_ROUTE_ARTIFACT_VERSION = 3 as const;
const DEVELOPMENT_WEB_CACHE_BYTES = 16 * 1024 * 1024;
const DEVELOPMENT_WEB_CACHE_ENTRIES = 256;
const DEVELOPMENT_WEB_CACHE_REFRESHES = 8;
const DEVELOPMENT_WEB_REQUEST_TIMEOUT_MS = 30_000;

type PreparedRouteDocument = Readonly<{
  route: ReturnType<typeof collectWebRoutes>[number];
  document: WebDocumentIR;
  request: false | Readonly<{ loader: boolean; view: WebRenderNodeIR }>;
}>;

export const WEB_ASSET_MANIFEST_VERSION = 1 as const;

export type WebAssetManifest = Readonly<{
  version: typeof WEB_ASSET_MANIFEST_VERSION;
  assets: readonly Readonly<{
    path: string;
    etag: string;
    size: number;
    immutable: boolean;
  }>[];
}>;

type WebComponentEnvironmentContract = Readonly<{
  elements: Readonly<Record<string, string>>;
  state: readonly Readonly<{ name: string }>[];
  propCallbacks: readonly string[];
}>;

function webApplicationContract(ir: ApplicationIR): Readonly<{
  uiProgram: string;
  components: Readonly<Record<string, WebComponentEnvironmentContract>>;
  headless: readonly ProgramIR[];
  workers: readonly ProgramIR[];
  routes: ReturnType<typeof collectWebRoutes>;
  installation?: WebInstallationPlan;
}> {
  const names = new Set(
    ir.programs
      .filter(
        ({ environment, contributions }) =>
          environment.name === "browser-main" && contributions.some(({ ui }) => ui),
      )
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
    if (
      program.name !== uiProgram ||
      program.environment.name !== "browser-main" ||
      !program.contributions.some(({ ui }) => ui)
    )
      continue;
    for (const contribution of program.contributions) {
      for (const component of contribution.ui?.components ?? []) {
        const name = runtimeComponentName(contribution.feature, component.name);
        if (components[name]) {
          throw new Error(`Duplicate runtime Component ${JSON.stringify(name)}.`);
        }
        components[name] = componentEnvironmentContract(component);
      }
    }
  }
  const headless = ir.programs.filter(
    ({ name, environment }) => environment.name === "browser-main" && name !== uiProgram,
  );
  const workers = ir.programs.filter(({ environment }) =>
    ["browser-worker", "browser-service-worker"].includes(environment.name),
  );
  const routes = collectWebRoutes(ir, uiProgram);
  const installation = planWebInstallation(ir, routes);
  return {
    uiProgram,
    components,
    headless,
    workers,
    routes,
    ...(installation ? { installation } : {}),
  };
}

function collectCompiledWebComponents(
  ir: ApplicationIR,
  program: string,
): readonly CompiledWebComponentIR[] {
  const components = ir.programs
    .filter(({ name, environment }) => name === program && environment.platform === "web")
    .flatMap(({ contributions }) =>
      contributions.flatMap((contribution) =>
        contribution.extensions?.web
          ? webProgramCompilerIR(contribution.extensions.web).components
          : [],
      ),
    )
    .sort((left, right) =>
      componentCompilerIdentity(left).localeCompare(componentCompilerIdentity(right)),
    );
  const identities = new Set<string>();
  for (const component of components) {
    const identity = componentCompilerIdentity(component);
    if (identities.has(identity)) {
      throw new Error(`Duplicate compiled web Component ${JSON.stringify(identity)}.`);
    }
    identities.add(identity);
  }
  return Object.freeze(components);
}

function componentCompilerIdentity(component: CompiledWebComponentIR): string {
  return component.feature ? `${component.feature}.${component.name}` : component.name;
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
}): Promise<WebBuild> {
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
    const contract = webApplicationContract(prepared.ir);
    const compiledComponents = collectCompiledWebComponents(prepared.ir, contract.uiProgram);
    let routeDocuments = await prepareProductionDocuments(
      paths,
      work,
      prepared.ir,
      compiledComponents,
    );
    const workerInputs = Object.fromEntries(
      prepared.workers.map(({ output, source }) => [output, source]),
    );
    await build({
      ...viteConfiguration(paths, options.development, prepared.ir),
      build: {
        emptyOutDir: false,
        manifest: "manifest.json",
        minify: options.development ? false : "oxc",
        outDir: outdir,
        rollupOptions: {
          input: { app: prepared.entry, ...workerInputs },
          output: {
            assetFileNames: (asset) =>
              asset.names.some((name) => name.endsWith(".css"))
                ? "styles.css"
                : "assets/[name]-[hash][extname]",
            chunkFileNames: "assets/[name]-[hash].js",
            entryFileNames: ({ name }) =>
              name === "app" ? "assets/[name]-[hash].js" : "workers/[name]-[hash].js",
          },
        },
        sourcemap: options.development ? "inline" : false,
        target: "es2022",
      },
    });
    const client = await readClientBuild(outdir);
    routeDocuments = routeDocuments.map(({ route, document, request }) => ({
      route,
      request,
      document: Object.freeze({
        ...document,
        entry: client.entry,
        preloads: Object.freeze([
          ...client.preloads,
          ...(client.chunks[`${routeModuleName(routeIdentity(route))}.generated`] ?? []),
        ]),
      }),
    }));
    const serviceWorkerModules = prepared.workers
      .filter(({ environment }) => environment === "browser-service-worker")
      .map(({ output }) => client.entries[output])
      .filter((value): value is string => Boolean(value));
    if (contract.installation) {
      await writeFile(
        resolve(outdir, WEB_MANIFEST_PATH.slice(1)),
        renderWebManifest(contract.installation),
      );
    }
    if (contract.installation || serviceWorkerModules.length) {
      const assets = await createWebAssetManifest(outdir);
      const plan = createWebServiceWorkerPlan({
        installation: contract.installation,
        assets: assets.assets.filter(({ immutable }) => immutable).map(({ path }) => path),
        routes: contract.routes,
        modules: serviceWorkerModules,
      });
      await writeFile(
        resolve(outdir, WEB_SERVICE_WORKER_PATH.slice(1)),
        renderWebServiceWorker(plan),
      );
    }
    const document = defaultRouteDocument(routeDocuments);
    await writeFile(resolve(outdir, "document.ir.json"), `${JSON.stringify(document)}\n`);
    await writeFile(
      resolve(outdir, "routes.ir.json"),
      `${JSON.stringify({ version: WEB_ROUTE_ARTIFACT_VERSION, components: compiledComponents, routes: routeDocuments })}\n`,
    );
    await writeFile(resolve(outdir, "index.html"), renderWebDocument(document));
    await rm(resolve(outdir, "manifest.json"), { force: true });
    await writeFile(
      resolve(outdir, "assets.ir.json"),
      `${JSON.stringify(await createWebAssetManifest(outdir))}\n`,
    );
    return {
      directory: outdir,
      entries: [
        ...prepared.ir.programs
          .filter(({ environment }) => environment.name === "browser-main")
          .map((program) => ({
            program: program.name,
            environment: program.environment.name,
            path: resolve(outdir, client.entry.slice(1)),
          })),
        ...prepared.workers.map(({ program, environment, output }) => ({
          program,
          environment,
          path: resolve(outdir, client.entries[output]!.slice(1)),
        })),
      ],
    };
  } finally {
    await removeWorkDirectory(work);
  }
}

/** @internal Seals every public production file into one exact serving allowlist. */
export async function createWebAssetManifest(directory: string): Promise<WebAssetManifest> {
  const root = resolve(directory);
  const internal = new Set([
    "assets.ir.json",
    "document.ir.json",
    "index.html",
    "manifest.json",
    "routes.ir.json",
  ]);
  const paths: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Web build contains unsupported entry ${JSON.stringify(path)}.`);
    }
  };
  await visit(root);
  const assets = await Promise.all(
    paths
      .map((path) => ({ path, relative: relative(root, path).split(sep).join("/") }))
      .filter(({ relative: path }) => !internal.has(path))
      .sort((left, right) => left.relative.localeCompare(right.relative))
      .map(async ({ path, relative: name }) => {
        if (
          !name ||
          name.startsWith("../") ||
          name.split("/").some((part) => !part || part === "." || part === "..")
        ) {
          throw new Error(`Web asset path ${JSON.stringify(name)} is unsafe.`);
        }
        const bytes = await readFile(path);
        const metadata = await stat(path);
        if (!metadata.isFile()) throw new Error(`Web asset ${JSON.stringify(name)} is not a file.`);
        return Object.freeze({
          path: `/${name}`,
          etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
          size: bytes.byteLength,
          immutable:
            (name.startsWith("assets/") || name.startsWith("workers/")) &&
            /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(name),
        });
      }),
  );
  return Object.freeze({ version: WEB_ASSET_MANIFEST_VERSION, assets: Object.freeze(assets) });
}

type ClientManifestChunk = Readonly<{
  file: string;
  imports?: readonly string[];
  isDynamicEntry?: boolean;
  isEntry?: boolean;
  name?: string;
}>;

async function readClientBuild(outdir: string): Promise<
  Readonly<{
    entry: string;
    preloads: readonly string[];
    entries: Readonly<Record<string, string>>;
    chunks: Readonly<Record<string, readonly string[]>>;
  }>
> {
  const manifest = JSON.parse(await readFile(resolve(outdir, "manifest.json"), "utf8")) as Readonly<
    Record<string, ClientManifestChunk>
  >;
  return inspectClientManifest(manifest);
}

/** @internal Interprets Vite's build manifest into adapter-owned resource identities. */
export function inspectClientManifest(
  manifest: Readonly<Record<string, ClientManifestChunk>>,
): Readonly<{
  entry: string;
  preloads: readonly string[];
  entries: Readonly<Record<string, string>>;
  chunks: Readonly<Record<string, readonly string[]>>;
}> {
  const entries = Object.fromEntries(
    Object.values(manifest)
      .filter((chunk) => chunk.isEntry && chunk.name)
      .map((chunk) => [chunk.name!, `/${chunk.file}`]),
  );
  const app = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.name === "app");
  if (!app) throw new Error("Web client build did not emit its application entry.");
  const imports = (chunk: ClientManifestChunk): readonly string[] => {
    const files: string[] = [];
    const visited = new Set<string>();
    const visit = (current: ClientManifestChunk): void => {
      for (const name of current.imports ?? []) {
        if (visited.has(name)) continue;
        visited.add(name);
        const dependency = manifest[name];
        if (!dependency) throw new Error(`Web client manifest references missing chunk ${name}.`);
        visit(dependency);
        files.push(`/${dependency.file}`);
      }
    };
    visit(chunk);
    return Object.freeze(files);
  };
  const chunks = Object.fromEntries(
    Object.values(manifest)
      .filter((chunk) => chunk.name && (chunk.isEntry || chunk.isDynamicEntry))
      .map((chunk) => [chunk.name!, Object.freeze([`/${chunk.file}`, ...imports(chunk)])]),
  );
  return Object.freeze({
    entry: `/${app.file}`,
    preloads: imports(app),
    entries: Object.freeze(entries),
    chunks: Object.freeze(chunks),
  });
}

export async function runApplication(options: {
  directory: string;
  port?: number;
  serverOrigin?: string;
  webLoaders?: DevelopmentWebLoaderRegistry;
}): Promise<DevelopmentServer> {
  const paths = resolveApplication(options.directory);
  const work = await realpath(await mkdtemp(resolve(tmpdir(), "poggers-web-dev-")));
  const compiler = createApplicationCompiler(paths.application, [webCompilerExtension]);
  const prepared = await prepareApplication(
    paths,
    work,
    true,
    "full",
    compiler,
    undefined,
    undefined,
    options.serverOrigin,
  );
  const applicationState: PreparedApplicationState = { current: prepared };
  await writeFile(resolve(work, "index.html"), htmlSource("/browser.generated.ts"));

  const server = await createServer({
    ...viteConfiguration(paths, true, prepared.ir),
    appType: "spa",
    cacheDir: resolve(work, ".vite"),
    plugins: [
      presentationContractPlugin(
        paths,
        work,
        compiler,
        applicationState,
        options.serverOrigin,
        options.webLoaders,
      ),
      ...vitePlugins(paths, () => applicationState.current.ir),
    ],
    root: work,
    server: {
      fs: { allow: [work, paths.directory, resolve(import.meta.dirname, "../../..")] },
      host: "localhost",
      port: options.port ?? 3000,
      strictPort: options.port !== undefined,
    },
  });
  await server.listen();
  await server.watcher.unwatch([
    prepared.candidate,
    prepared.entry,
    ...prepared.routeEntries.map(({ source }) => source),
    ...prepared.workers.map(({ source }) => source),
    ...(prepared.serviceWorker ? [prepared.serviceWorker] : []),
  ]);
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 3000);
  const cleanupOnExit = () => rmSync(work, { recursive: true, force: true });
  process.once("exit", cleanupOnExit);

  return {
    port,
    async stop() {
      process.off("exit", cleanupOnExit);
      if (server.httpServer && "closeAllConnections" in server.httpServer) {
        server.httpServer.closeAllConnections();
      }
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
  compiler: ApplicationCompiler = createApplicationCompiler(paths.application, [
    webCompilerExtension,
  ]),
  previous?: PreparedApplication,
  changedFile?: string,
  serverOrigin?: string,
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
  const documentEvaluator = development
    ? resolve(work, "document-evaluator.generated.ts")
    : undefined;
  const ui = ir.programs.find(({ name }) => name === contract.uiProgram)!;
  const programManifest = collectProgramManifest(ui);
  if (documentEvaluator) {
    await writeIfChanged(
      documentEvaluator,
      developmentDocumentEvaluatorSource({
        application: paths.application,
        document: resolve(import.meta.dirname, `document${moduleExtension()}`),
        revision,
      }),
    );
  }
  const workers = await Promise.all(
    contract.workers.map(async (program, index): Promise<WebWorkerEntry> => {
      const output = workerName(program.name, index);
      const source = resolve(work, `${output}.generated.ts`);
      const manifest = collectProgramManifest(program);
      await writeIfChanged(
        source,
        workerSource({
          application: paths.application,
          development,
          serverOrigin,
          host: resolve(import.meta.dirname, `host${moduleExtension()}`),
          processRuntime: resolve(import.meta.dirname, `../../runtime/process${moduleExtension()}`),
          revision,
          program,
          manifest,
          dependencies: projectDependencyContracts(linkProgram(program).external),
        }),
      );
      return {
        program: program.name,
        environment: program.environment.name as WebWorkerEntry["environment"],
        source,
        output,
      };
    }),
  );
  const serviceWorkers = workers.filter(
    ({ environment }) => environment === "browser-service-worker",
  );
  const serviceWorkerSource =
    contract.installation || serviceWorkers.length
      ? resolve(work, "service-worker.generated.ts")
      : undefined;
  if (serviceWorkerSource) {
    await writeIfChanged(
      serviceWorkerSource,
      renderWebServiceWorker(
        createWebServiceWorkerPlan({
          installation: contract.installation,
          assets: [],
          routes: contract.routes,
          modules: serviceWorkers.map(({ source }) => `./${basename(source)}`),
          caching: development ? "preview" : "always",
        }),
      ),
    );
  }
  const routeEntries = await Promise.all(
    contract.routes.map(async (route): Promise<WebRouteEntry> => {
      const identity = routeIdentity(route);
      const loader = Boolean(compiledWebRoute(ir, contract.uiProgram, route)?.implementation.load);
      const source = resolve(work, `${routeModuleName(identity)}.generated.ts`);
      await writeIfChanged(
        source,
        routeModuleSource({
          application: paths.application,
          development,
          revision,
          program: contract.uiProgram,
          route,
        }),
      );
      return Object.freeze({ identity, loader, source });
    }),
  );
  await writeIfChanged(
    candidate,
    candidateSource({
      application: paths.application,
      development,
      serverOrigin,
      host: resolve(import.meta.dirname, `host${moduleExtension()}`),
      revision,
      runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
      presentationRuntime: resolve(
        import.meta.dirname,
        `./ui/presentation/adapter${moduleExtension()}`,
      ),
      processRuntime: resolve(import.meta.dirname, `../../runtime/process${moduleExtension()}`),
      program: contract.uiProgram,
      programManifest,
      dependencies: projectDependencyContracts(linkProgram(ui).external),
      components: contract.components,
      presentationDependencies: collectPresentationDependencies(ir, contract.uiProgram),
      hotManifest: createHotReplacementManifest(ir),
      routes: contract.routes,
      routeEntries,
      headless: contract.headless.map((program) => {
        const manifest = collectProgramManifest(program);
        return {
          program: program.name,
          manifest,
          dependencies: projectDependencyContracts(linkProgram(program).external),
        };
      }),
      workers: workers
        .filter(({ environment }) => environment === "browser-worker")
        .map(({ output, source }) => ({
          source: development ? `./${basename(source)}` : `/workers/${output}.js`,
        })),
      ...(serviceWorkerSource
        ? {
            serviceWorker: {
              source: development ? `./${basename(serviceWorkerSource)}` : WEB_SERVICE_WORKER_PATH,
              register: !development || serviceWorkers.length > 0,
            },
          }
        : {}),
    }),
  );
  const entry = resolve(work, "browser.generated.ts");
  await writeIfChanged(
    entry,
    browserSource({
      candidate,
      development,
      runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
      stream: resolve(import.meta.dirname, `./ui/stream${moduleExtension()}`),
    }),
  );
  return {
    candidate,
    ...(documentEvaluator ? { documentEvaluator } : {}),
    entry,
    ir,
    presentationSources: compilation.presentationSources,
    revision,
    updateKind,
    routeEntries,
    workers,
    ...(serviceWorkerSource ? { serviceWorker: serviceWorkerSource } : {}),
  };
}

async function writeIfChanged(path: string, contents: string): Promise<boolean> {
  try {
    if ((await readFile(path, "utf8")) === contents) return false;
  } catch {}
  await writeFile(path, contents);
  return true;
}

function viteConfiguration(paths: ApplicationPaths, development = false, ir?: ApplicationIR) {
  return {
    configFile: false as const,
    mode: development ? "development" : "production",
    oxc: { jsx: { development } },
    ...(development ? { optimizeDeps: { include: [], noDiscovery: true } } : {}),
    plugins: vitePlugins(paths, ir),
    resolve: {
      alias: kitAliases(),
      conditions: ["poggers-source", ...defaultClientConditions],
    },
    root: paths.directory,
  };
}

function kitAliases() {
  const kit = resolve(import.meta.dirname, "../..");
  const extension = moduleExtension();
  return [
    {
      find: /^@poggers\/kit\/jsx-dev-runtime$/,
      replacement: resolve(kit, `jsx/development${extension}`),
    },
    {
      find: /^@poggers\/kit\/jsx-runtime$/,
      replacement: resolve(kit, `jsx/runtime${extension}`),
    },
    {
      find: /^@poggers\/kit\/web$/,
      replacement: resolve(kit, `platforms/web/platform${extension}`),
    },
    { find: /^@poggers\/kit$/, replacement: resolve(kit, `index${extension}`) },
  ];
}

function moduleExtension(): ".ts" | ".js" {
  return import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
}

function vitePlugins(
  paths: ApplicationPaths,
  ir?: ApplicationIR | (() => ApplicationIR),
): Plugin[] {
  return [
    ...(ir ? [routeSourcePlugin(paths, ir)] : []),
    applicationAliasPlugin(paths.source),
    presentationTransformPlugin(paths.source),
    componentTransformPlugin(paths.source),
  ];
}

function routeSourcePlugin(
  paths: ApplicationPaths,
  application: ApplicationIR | (() => ApplicationIR),
): Plugin {
  type RouteLocation = Readonly<{
    identity: string;
    span: CompiledWebRouteIR["implementationSpan"];
  }>;
  const contract = () => {
    const ir = typeof application === "function" ? application() : application;
    const locations = new Map<string, RouteLocation[]>();
    for (const program of ir.programs) {
      if (program.environment.platform !== "web") continue;
      for (const contribution of program.contributions) {
        if (!contribution.extensions?.web) continue;
        for (const route of webProgramCompilerIR(contribution.extensions.web).routes) {
          const file = canonicalSourcePath(resolve(paths.source, route.implementationSpan.file));
          const current = locations.get(file) ?? [];
          current.push({ identity: routeIdentity(route), span: route.implementationSpan });
          locations.set(file, current);
        }
      }
    }
    return {
      locations,
      browserMainPrograms: new Set(
        ir.programs
          .filter(({ environment }) => environment.name === "browser-main")
          .map(({ name }) => name),
      ),
      programNames: new Set(ir.programs.map(({ name }) => name)),
    };
  };

  return {
    name: "poggers-route-source",
    enforce: "pre",
    async resolveId(source, importer) {
      const projection = sourceProjection(source) ?? sourceProjection(importer);
      if (!projection || source.startsWith("\0")) return;
      const resolved = await this.resolve(
        cleanId(source),
        importer ? cleanId(importer) : undefined,
        {
          skipSelf: true,
        },
      );
      if (!resolved) return;
      const id = cleanId(resolved.id);
      if (!isApplicationSourceModule(id, paths.source)) return;
      const parameters = sourceProjection(source)
        ? sourceParameters(source)
        : new URLSearchParams();
      parameters.set(
        projection.kind === "route" ? "poggers-route" : "poggers-program",
        projection.name,
      );
      return routeSourceId(id, parameters);
    },
    transform(code, rawId) {
      const projection = sourceProjection(rawId);
      if (!projection) return;
      const { locations, browserMainPrograms, programNames } = contract();
      const id = canonicalSourcePath(cleanId(rawId));
      const routes = locations.get(id) ?? [];
      const source = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        id.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const objects = new Map<string, ts.ObjectLiteralExpression>();
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          objects.set(`${position.line + 1}:${position.character + 1}`, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      const replacements: Array<Readonly<{ start: number; end: number; value: string }>> = [];
      if (projection.kind === "route") {
        for (const route of routes) {
          const node = objects.get(`${route.span.line}:${route.span.column}`);
          if (!node) {
            throw new Error(
              `${route.span.file}:${route.span.line}:${route.span.column}: ` +
                `Unable to isolate web Route ${JSON.stringify(route.identity)}.`,
            );
          }
          if (projection.name !== route.identity) {
            replacements.push({ start: node.getStart(source), end: node.end, value: "{}" });
          }
        }
      }
      const retainedPrograms =
        projection.kind === "program" ? new Set([projection.name]) : browserMainPrograms;
      replacements.push(
        ...excludedProgramReplacements(
          source,
          new Set([...programNames].filter((name) => !retainedPrograms.has(name))),
        ),
      );
      if (!replacements.length) return;
      let transformed = code;
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${transformed.slice(replacement.end)}`;
      }
      return { code: pruneProjectionImports(transformed, id), map: null };
    },
  };
}

function pruneProjectionImports(code: string, id: string): string {
  // Route projections must not retain type-only or now-unreachable runtime dependencies.
  const source = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.Latest,
    true,
    id.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) references.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);

  const replacements: Array<Readonly<{ start: number; end: number; value: string }>> = [];
  const printer = ts.createPrinter();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    const name =
      !clause.isTypeOnly && clause.name && references.has(clause.name.text)
        ? clause.name
        : undefined;
    let bindings = clause.isTypeOnly ? undefined : clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && !references.has(bindings.name.text)) {
      bindings = undefined;
    } else if (bindings && ts.isNamedImports(bindings)) {
      const elements = bindings.elements.filter(
        (element) => !element.isTypeOnly && references.has(element.name.text),
      );
      bindings = elements.length ? ts.factory.updateNamedImports(bindings, elements) : undefined;
    }
    if (name === clause.name && bindings === clause.namedBindings) continue;
    const value =
      name || bindings
        ? printer.printNode(
            ts.EmitHint.Unspecified,
            ts.factory.updateImportDeclaration(
              statement,
              statement.modifiers,
              ts.factory.updateImportClause(clause, clause.isTypeOnly, name, bindings),
              statement.moduleSpecifier,
              statement.attributes,
            ),
            source,
          )
        : "";
    replacements.push({ start: statement.getStart(source), end: statement.end, value });
  }
  let transformed = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}

function canonicalSourcePath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function excludedProgramReplacements(
  source: ts.SourceFile,
  excluded: ReadonlySet<string>,
): Array<Readonly<{ start: number; end: number; value: string }>> {
  const replacements: Array<Readonly<{ start: number; end: number; value: string }>> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && sourcePropertyName(node.name) === "programs") {
      const programs = unwrapSourceExpression(node.initializer);
      if (ts.isObjectLiteralExpression(programs)) {
        for (const property of programs.properties) {
          const name = sourcePropertyName(property.name);
          if (!name || !excluded.has(name)) continue;
          if (ts.isPropertyAssignment(property)) {
            replacements.push({
              start: property.initializer.getStart(source),
              end: property.initializer.end,
              value: "{}",
            });
          } else if (ts.isShorthandPropertyAssignment(property)) {
            replacements.push({
              start: property.getStart(source),
              end: property.end,
              value: `${name}: {}`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return replacements;
}

function sourcePropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapSourceExpression(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isApplicationSourceModule(id: string, source: string): boolean {
  const root = resolve(source);
  const file = resolve(id);
  return (file === root || file.startsWith(`${root}${sep}`)) && /\.[cm]?[jt]sx?$/.test(file);
}

function sourceParameters(id: string): URLSearchParams {
  const query = id.indexOf("?");
  return new URLSearchParams(query < 0 ? "" : id.slice(query + 1));
}

function sourceProjection(
  id: string | undefined,
): Readonly<{ kind: "program" | "route"; name: string }> | undefined {
  if (!id) return undefined;
  const parameters = sourceParameters(id);
  const route = parameters.get("poggers-route");
  if (route) return { kind: "route", name: route };
  const program = parameters.get("poggers-program");
  return program ? { kind: "program", name: program } : undefined;
}

function routeApplicationSpecifier(application: string, route: string, revision?: number): string {
  const parameters = new URLSearchParams({ "poggers-route": route });
  if (revision !== undefined) parameters.set("poggers-revision", String(revision));
  return routeSourceId(application, parameters);
}

function programApplicationSpecifier(
  application: string,
  program: string,
  revision?: number,
): string {
  const parameters = new URLSearchParams({ "poggers-program": program });
  if (revision !== undefined) parameters.set("poggers-revision", String(revision));
  return routeSourceId(application, parameters);
}

function routeSourceId(id: string, parameters: URLSearchParams): string {
  for (const name of parameters.keys()) {
    if (name.startsWith("lang.")) parameters.delete(name);
  }
  const extension = id.match(/\.([cm]?[jt]sx?)$/)?.[1] ?? "ts";
  return `${id}?${parameters}&lang.${extension}`;
}

function routeModuleName(identity: string): string {
  const readable = identity
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 10);
  return `route-${readable || "root"}-${hash}`;
}

function routeModuleSource(input: {
  application: string;
  development: boolean;
  revision: number;
  program: string;
  route: ReturnType<typeof collectWebRoutes>[number];
}): string {
  const application = routeApplicationSpecifier(
    input.application,
    routeIdentity(input.route),
    input.development ? input.revision : undefined,
  );
  return `import application from ${JSON.stringify(application)};

let feature = application;
for (const name of ${JSON.stringify(input.route.feature.split(".").filter(Boolean))}) {
  feature = feature.features?.[name];
}
const definition = feature?.programs?.[${JSON.stringify(input.program)}]?.routes?.[${JSON.stringify(input.route.name)}];
if (!definition || typeof definition.view !== "function") {
  throw new Error(${JSON.stringify(`Missing browser Route implementation ${routeIdentity(input.route)}.`)});
}
export default definition;
`;
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

function applicationAliasPlugin(source: string): Plugin {
  const kit = resolve(import.meta.dirname, "../..");
  return {
    name: "poggers-application-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer ? cleanId(importer) : "";
      const root = owner.startsWith(`${kit}/`) && !owner.startsWith(`${source}/`) ? kit : source;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}

function presentationContractPlugin(
  paths: ApplicationPaths,
  work: string,
  compiler: ApplicationCompiler,
  state: PreparedApplicationState,
  serverOrigin?: string,
  webLoaders?: DevelopmentWebLoaderRegistry,
): Plugin {
  let prepared = state.current;
  let updates = Promise.resolve();
  const responseCache = createWebResponseCache<
    Awaited<ReturnType<typeof prepareDevelopmentDocument>>
  >({
    capacity: DEVELOPMENT_WEB_CACHE_ENTRIES,
    maxBytes: DEVELOPMENT_WEB_CACHE_BYTES,
    refreshConcurrency: DEVELOPMENT_WEB_CACHE_REFRESHES,
    cacheable: (value) => !value.frames && value.headers["cache-control"] !== "no-store",
    size: (value) => Buffer.byteLength(value.body) + Buffer.byteLength(value.tail ?? ""),
  });
  const refresh = async (context: HmrContext): Promise<ModuleNode[] | undefined> => {
    if (context.file.startsWith(work)) return [];
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
          serverOrigin,
        );
        state.current = prepared;
        responseCache.clear();
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
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const location = new URL(request.url ?? "/", "http://poggers.local");
        if (location.pathname.endsWith("/service-worker.generated.ts")) {
          response.setHeader("service-worker-allowed", "/");
          next();
          return;
        }
        if (location.pathname === WEB_MANIFEST_PATH) {
          const installation = webApplicationContract(prepared.ir).installation;
          if (!installation) {
            next();
            return;
          }
          if (request.method !== "GET" && request.method !== "HEAD") {
            response.statusCode = 405;
            response.setHeader("allow", "GET, HEAD");
            response.end();
            return;
          }
          const body = renderWebManifest(installation);
          response.statusCode = 200;
          response.setHeader("cache-control", "no-store");
          response.setHeader("content-type", "application/manifest+json; charset=utf-8");
          response.end(request.method === "HEAD" ? undefined : body);
          return;
        }
        const representation = negotiateWebRepresentation(request.headers.accept);
        if (!representation) {
          next();
          return;
        }
        const routeData = representation === "route-data";
        const markdown = representation === "markdown";
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(new DevelopmentWebRequestTimeout()),
          DEVELOPMENT_WEB_REQUEST_TIMEOUT_MS,
        );
        const disconnected = () => {
          if (!response.writableEnded) {
            controller.abort(new DevelopmentWebRequestDisconnected());
          }
        };
        response.once("close", disconnected);
        void abortable(
          (async () => {
            const contract = webApplicationContract(prepared.ir);
            if (!contract.routes.length) {
              next();
              return;
            }
            response.setHeader("x-content-type-options", "nosniff");
            response.setHeader("x-request-id", randomUUID());
            const match = matchWebRoute(contract.routes, location);
            if (!match) {
              response.statusCode = 404;
              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify({ message: "Not found." }));
              return;
            }
            if (request.method !== "GET" && request.method !== "HEAD") {
              response.statusCode = 405;
              response.setHeader("allow", "GET, HEAD");
              response.end();
              return;
            }
            const cached = await responseCache.read(
              `${representation}:${location.pathname}${location.search}`,
              match.route.cache,
              () =>
                prepareDevelopmentDocument({
                  server,
                  paths,
                  prepared,
                  contract,
                  headers: request.headers,
                  location,
                  match,
                  webLoaders,
                  routeData,
                  markdown,
                  signal: controller.signal,
                }),
            );
            const result = cached.value;
            response.setHeader("x-poggers-cache", cached.status);
            response.statusCode = result.status;
            for (const [name, value] of Object.entries(result.headers)) {
              response.setHeader(name, value);
            }
            if (!result.frames) {
              const etag = strongEtag(result.body);
              response.setHeader("etag", etag);
              if (request.headers["if-none-match"] === etag) {
                response.statusCode = 304;
                response.end();
                return;
              }
            }
            if (request.method === "HEAD" || !result.frames) {
              response.end(request.method === "HEAD" ? undefined : result.body);
              return;
            }
            await writeDevelopmentWebStream(
              response,
              result.body,
              result.frames,
              result.tail ?? "",
              controller.signal,
            );
          })(),
          controller.signal,
        )
          .catch((error: unknown) => {
            if (error instanceof DevelopmentWebRequestDisconnected) return;
            if (error instanceof DevelopmentWebRequestTimeout) {
              if (response.writableEnded || response.destroyed) return;
              if (response.headersSent) {
                response.destroy(error);
                return;
              }
              response.statusCode = 408;
              response.setHeader("cache-control", "no-store");
              response.end();
              return;
            }
            if (error instanceof WebRouteValidationError) {
              server.config.logger.warn(`[poggers] invalid web request: ${error.message}`);
              response.statusCode = 400;
              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify({ message: "Invalid request." }));
              return;
            }
            server.config.logger.error(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
            if (response.writableEnded) return;
            if (response.headersSent) {
              response.destroy(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            response.statusCode = 500;
            response.setHeader("cache-control", "no-store");
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ message: "Internal server error." }));
          })
          .finally(() => {
            clearTimeout(timeout);
            response.off("close", disconnected);
          });
      });
    },
    async handleHotUpdate(context) {
      return refresh(context);
    },
  };
}

class DevelopmentWebRequestTimeout extends Error {
  constructor() {
    super("The development web request exceeded its deadline.");
  }
}

class DevelopmentWebRequestDisconnected extends Error {
  constructor() {
    super("The development web request disconnected.");
  }
}

async function abortable<Value>(work: PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) throw signal.reason;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

/** @internal Writes the reference stream with Node backpressure and request cancellation. */
export async function writeDevelopmentWebStream(
  response: ServerResponse,
  prefix: string,
  frames: AsyncIterable<string>,
  tail: string,
  signal: AbortSignal,
): Promise<void> {
  response.flushHeaders();
  const iterator = frames[Symbol.asyncIterator]();
  try {
    await writeDevelopmentWebChunk(response, prefix, signal);
    while (true) {
      const frame = await abortable(iterator.next(), signal);
      if (frame.done) break;
      await writeDevelopmentWebChunk(response, frame.value, signal);
    }
    if (tail) await writeDevelopmentWebChunk(response, tail, signal);
    response.end();
  } finally {
    if (signal.aborted && iterator.return) {
      void iterator.return().catch(() => undefined);
    }
  }
}

async function writeDevelopmentWebChunk(
  response: ServerResponse,
  chunk: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw signal.reason;
  if (response.destroyed || response.writableEnded) {
    throw new DevelopmentWebRequestDisconnected();
  }
  if (response.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off("drain", drained);
      signal.removeEventListener("abort", aborted);
    };
    const drained = () => {
      cleanup();
      resolve();
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    response.once("drain", drained);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function prepareDevelopmentDocument(input: {
  server: ViteDevServer;
  paths: ApplicationPaths;
  prepared: PreparedApplication;
  contract: ReturnType<typeof webApplicationContract>;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  location: URL;
  match: NonNullable<ReturnType<typeof matchWebRoute>>;
  webLoaders?: DevelopmentWebLoaderRegistry;
  routeData: boolean;
  markdown: boolean;
  signal: AbortSignal;
}): Promise<
  Readonly<{
    status: number;
    headers: Readonly<Record<string, string>>;
    body: string;
    frames?: AsyncIterable<string>;
    tail?: string;
  }>
> {
  const { route } = input.match;
  const title = route.metadata.title ?? input.prepared.ir.application.name ?? "Poggers";
  const metadata = routeDocumentMetadata(route.metadata);
  let document: WebDocumentIR;
  let markdownAllowed = !route.metadata.robots
    ?.split(",")
    .some((value) => value.trim() === "noindex");
  let deferredFrames: AsyncIterable<ReturnType<typeof renderWebDeferredFrame>> | undefined;
  let deferredRecords: AsyncIterable<string> | undefined;
  if (route.document === "shell") {
    document = withWebStyles(
      prepareClientWebDocument({
        title,
        language: route.metadata.language,
        metadata,
        entry: "/browser.generated.ts",
      }),
    );
  } else {
    const evaluatorPath = input.prepared.documentEvaluator;
    if (!evaluatorPath) throw new Error("Development web document evaluator is unavailable.");
    const evaluator = (await input.server.ssrLoadModule(
      `${evaluatorPath}?poggers-revision=${input.prepared.revision}`,
    )) as {
      application?: unknown;
      prepare?(input: Readonly<Record<string, unknown>>): Promise<WebDocumentIR>;
    };
    const application = record(evaluator.application);
    if (typeof evaluator.prepare !== "function") {
      throw new Error("Development web document evaluator has no prepare function.");
    }
    validateUIProgramRoot(application, input.contract.uiProgram);
    const program = input.prepared.ir.programs.find(
      ({ name }) => name === input.contract.uiProgram,
    );
    if (!program)
      throw new Error(`Missing UI Program ${JSON.stringify(input.contract.uiProgram)}.`);
    const definition = runtimeWebRoute(application, input.contract.uiProgram, route);
    if (definition.load && (route.cache === false || route.cache.scope !== "public")) {
      markdownAllowed = false;
    }
    const loaded = definition.load
      ? await loadDevelopmentWebRoute(input, routeIdentity(route))
      : { data: undefined };
    if (isRecordValue(loaded) && "redirect" in loaded) {
      const location = resolveWebDestination(
        input.contract.routes,
        loaded.redirect as Parameters<typeof resolveWebDestination>[1],
        route.feature,
      );
      return {
        status: input.routeData ? 200 : 302,
        headers: {
          "cache-control": "no-store",
          ...(input.routeData ? { "content-type": WEB_ROUTE_DATA_MEDIA_TYPE } : { location }),
        },
        body: input.routeData ? JSON.stringify({ version: 1, redirect: location }) : "",
      };
    }
    if (definition.load && (!isRecordValue(loaded) || !("data" in loaded))) {
      throw new TypeError(`Web Route loader ${routeIdentity(route)} must return data or redirect.`);
    }
    const dynamicMetadata = loaderMetadata(loaded);
    const routeMetadata = Object.freeze({ ...route.metadata, ...dynamicMetadata });
    const data = isRecordValue(loaded) && "data" in loaded ? loaded.data : undefined;
    document = await evaluator.prepare({
      program: input.contract.uiProgram,
      manifest: collectProgramManifest(program),
      components: input.contract.components,
      presentationDependencies: collectPresentationDependencies(
        input.prepared.ir,
        input.contract.uiProgram,
      ),
      route: {
        feature: route.feature,
        name: route.name,
        params: input.match.params,
        search: input.match.search,
        data,
        metadata: routeMetadata,
      },
      entry: "/browser.generated.ts",
    });
    document = withWebStyles(
      Object.freeze({
        ...document,
        hydration: Object.freeze({
          version: 1 as const,
          route: Object.freeze({ feature: route.feature, name: route.name }),
          location: `${input.location.pathname}${input.location.search}`,
          params: Object.freeze({ ...input.match.params }),
          search: Object.freeze({ ...input.match.search }),
          loader: definition.load ? Object.freeze({ data }) : false,
          metadata: webRouteHydrationMetadata(document),
        }),
      }),
    );
    if (route.deferred.length) {
      const compiled = compiledWebRoute(input.prepared.ir, input.contract.uiProgram, route)
        ?.implementation.view;
      if (!compiled) {
        throw new TypeError(
          `Deferred web Route ${routeIdentity(route)} has no compiler-readable view.`,
        );
      }
      const stream = prepareCompiledWebDocumentStream({
        document,
        route: { feature: route.feature, name: route.name },
        location: `${input.location.pathname}${input.location.search}`,
        view: compiled,
        components: collectCompiledWebComponents(input.prepared.ir, input.contract.uiProgram),
        params: input.match.params,
        search: input.match.search,
        loader: definition.load ? { data } : false,
        deferred: route.deferred,
        metadata: routeMetadata,
        signal: input.signal,
      });
      document = stream.document;
      deferredFrames = mapAsyncIterable(stream.frames, renderWebDeferredFrame);
      deferredRecords = mapAsyncIterable(stream.frames, (frame) => `${JSON.stringify(frame)}\n`);
    }
  }
  if (input.contract.installation) {
    document = withWebInstallation(document);
  }
  const hydration =
    document.hydration === false
      ? {
          version: 1 as const,
          route: { feature: route.feature, name: route.name },
          location: `${input.location.pathname}${input.location.search}`,
          params: input.match.params,
          search: input.match.search,
          loader: false as const,
          metadata: webRouteHydrationMetadata(document),
        }
      : document.hydration;
  if (input.routeData) {
    return {
      status: 200,
      headers: {
        "cache-control": webRouteCacheControl(route.cache),
        "content-type": deferredRecords
          ? `${WEB_ROUTE_DATA_MEDIA_TYPE}; framing=ndjson`
          : WEB_ROUTE_DATA_MEDIA_TYPE,
        vary: "Accept",
      },
      body: `${JSON.stringify(hydration)}${deferredRecords ? "\n" : ""}`,
      ...(deferredRecords ? { frames: deferredRecords, tail: "" } : {}),
    };
  }
  if (input.markdown) {
    if (!markdownAllowed || document.root.length === 0) {
      return {
        status: 406,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          vary: "Accept",
        },
        body: "This Route does not expose a public Markdown representation.\n",
      };
    }
    if (deferredFrames) {
      return {
        status: 406,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          vary: "Accept",
        },
        body: "This Route requires its complete HTML stream.\n",
      };
    }
    return {
      status: 200,
      headers: {
        "cache-control": webRouteCacheControl(route.cache),
        "content-type": `${WEB_MARKDOWN_MEDIA_TYPE}; charset=utf-8`,
        vary: "Accept",
      },
      body: renderWebMarkdown(document),
    };
  }
  const html = await input.server.transformIndexHtml(
    input.location.pathname,
    renderWebDocument(document),
  );
  if (deferredFrames) {
    const boundary = html.lastIndexOf("</body>");
    if (boundary < 0) throw new TypeError("Streamed web document has no body terminator.");
    return {
      status: 200,
      headers: {
        "cache-control": webRouteCacheControl(route.cache),
        "content-type": "text/html; charset=utf-8",
        vary: "Accept",
      },
      body: html.slice(0, boundary),
      frames: deferredFrames,
      tail: html.slice(boundary),
    };
  }
  return {
    status: 200,
    headers: {
      "cache-control": webRouteCacheControl(route.cache),
      "content-type": "text/html; charset=utf-8",
      vary: "Accept",
    },
    body: html,
  };
}

function mapAsyncIterable<Input, Output>(
  source: AsyncIterable<Input>,
  map: (value: Input) => Output,
): AsyncIterable<Output> {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      for await (const value of source) yield map(value);
    },
  });
}

type RuntimeWebRoute = Readonly<{
  load?(
    context: Readonly<{
      dependencies: Readonly<Record<string, unknown>>;
      request?: Readonly<{
        url: string;
        headers: Readonly<Record<string, string | undefined>>;
      }>;
      params: Readonly<Record<string, unknown>>;
      search: Readonly<Record<string, unknown>>;
    }>,
  ): unknown | PromiseLike<unknown>;
}>;

function runtimeWebRoute(
  application: Readonly<Record<string, unknown>>,
  program: string,
  route: ReturnType<typeof collectWebRoutes>[number],
): RuntimeWebRoute {
  let feature: unknown = application;
  for (const name of route.feature.split(".").filter(Boolean)) {
    feature = record(feature).features;
    feature = record(feature)[name];
  }
  const definition = record(record(record(feature).programs)[program]);
  const implementation = record(record(definition.routes)[route.name]);
  if (!Object.keys(implementation).length) {
    throw new TypeError(`Missing implementation for web Route ${routeIdentity(route)}.`);
  }
  return implementation as RuntimeWebRoute;
}

function loadDevelopmentWebRoute(
  input: Readonly<{
    paths: ApplicationPaths;
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    location: URL;
    match: NonNullable<ReturnType<typeof matchWebRoute>>;
    webLoaders?: DevelopmentWebLoaderRegistry;
  }>,
  route: string,
): Promise<unknown> {
  if (!input.webLoaders) {
    throw new Error(
      `Development SSR for web Route ${JSON.stringify(route)} requires the server and web ` +
        "Platform Adapters to share a loader registry.",
    );
  }
  return input.webLoaders.load(input.paths.directory, {
    route,
    ...(input.match.route.cache !== false && input.match.route.cache.scope === "public"
      ? {}
      : {
          request: {
            url: input.location.href,
            headers: normalizeWebRequestHeaders(input.headers),
          },
        }),
    params: input.match.params,
    search: input.match.search,
  });
}

function normalizeWebRequestHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name.toLowerCase(),
        typeof value === "string" ? value : value?.join(", "),
      ]),
    ),
  );
}

function routeDocumentMetadata(
  metadata: WebRouteMetadataResult,
): Omit<WebRouteMetadataResult, "language" | "title"> {
  const { language: _language, title: _title, ...document } = metadata;
  return Object.freeze(document);
}

function loaderMetadata(value: unknown): WebRouteMetadataResult {
  if (!isRecordValue(value) || value.metadata === undefined) return {};
  if (!isRecordValue(value.metadata)) {
    throw new TypeError("Dynamic web Route metadata must be an object.");
  }
  const result = value.metadata as WebRouteMetadataResult;
  validateWebRouteMetadata(result, "dynamic");
  return Object.freeze(result);
}

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type WebRepresentation = "document" | "markdown" | "route-data";

/** Selects only explicit alternate representations; wildcards retain canonical HTML. */
export function negotiateWebRepresentation(
  accept: string | undefined,
): WebRepresentation | undefined {
  const ranges = (accept ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const [media = "", ...parameters] = value.split(";").map((part) => part.trim());
      const quality = parameters.find((parameter) => parameter.startsWith("q="))?.slice(2);
      return { media: media.toLowerCase(), quality: quality === undefined ? 1 : Number(quality) };
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0);
  if (ranges.some(({ media }) => media === WEB_ROUTE_DATA_MEDIA_TYPE)) return "route-data";
  if (ranges.some(({ media }) => media === WEB_MARKDOWN_MEDIA_TYPE)) return "markdown";
  if (ranges.some(({ media }) => ["application/xhtml+xml", "text/html"].includes(media))) {
    return "document";
  }
  return undefined;
}

function strongEtag(value: string): string {
  return `"${createHash("sha256").update(value).digest("hex")}"`;
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
    plugins: [applicationAliasPlugin(paths.source)],
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

async function prepareProductionDocuments(
  paths: ApplicationPaths,
  work: string,
  ir: ApplicationIR,
  components: readonly CompiledWebComponentIR[],
): Promise<readonly PreparedRouteDocument[]> {
  const contract = webApplicationContract(ir);
  const program = ir.programs.find(({ name }) => name === contract.uiProgram);
  if (!program) throw new Error(`Missing UI Program ${JSON.stringify(contract.uiProgram)}.`);
  const entries = contract.routes.map((route) => {
    const compiled = compiledWebRoute(ir, contract.uiProgram, route);
    const request = requestRouteArtifact(route, compiled, components);
    validateProductionWebRoute(route, {
      hasLoader: Boolean(compiled?.implementation.load),
      request,
    });
    return { route, request };
  });
  const staticRoutes = entries.filter(({ request }) => request === false).map(({ route }) => route);
  const source = resolve(work, "document.generated.ts");
  const staticDocuments = new Map<string, WebDocumentIR>();
  if (staticRoutes.length || contract.routes.length === 0) {
    await writeIfChanged(
      source,
      `import application from ${JSON.stringify(paths.application)};
import { prepareClientWebDocument, prepareWebDocument } from ${JSON.stringify(resolve(import.meta.dirname, `document${moduleExtension()}`))};

const routes = ${JSON.stringify(staticRoutes)};
export default await Promise.all((routes.length ? routes : [undefined]).map(async (route) => ({
  route,
  document: route?.document === "shell"
    ? prepareClientWebDocument({
        title: route.metadata?.title ?? application.metadata?.name ?? "Poggers",
        language: route.metadata?.language,
        metadata: Object.fromEntries(Object.entries(route.metadata ?? {}).filter(([name]) => name !== "title" && name !== "language")),
        entry: "/app.js",
      })
    : await prepareWebDocument({
        application,
        program: ${JSON.stringify(contract.uiProgram)},
        manifest: ${JSON.stringify(collectProgramManifest(program))},
        components: ${JSON.stringify(contract.components)},
        presentationDependencies: ${JSON.stringify(collectPresentationDependencies(ir, contract.uiProgram))},
        ...(route ? { route: {
          feature: route.feature,
          name: route.name,
          metadata: route.metadata,
          params: {},
          search: {},
        } } : {}),
        entry: "/app.js",
      }),
})));
`,
    );
    const output = resolve(work, "document-evaluate");
    await rm(output, { recursive: true, force: true });
    await build({
      configFile: false,
      root: paths.directory,
      resolve: {
        alias: kitAliases(),
        conditions: ["poggers-source", ...defaultServerConditions],
      },
      plugins: vitePlugins(paths),
      build: {
        emptyOutDir: true,
        minify: false,
        outDir: output,
        rollupOptions: {
          input: source,
          output: { entryFileNames: "document.js", format: "es" },
        },
        ssr: true,
        target: "node26",
      },
      ssr: { noExternal: true },
    });
    const loaded = (await import(
      `${pathToFileURL(resolve(output, "document.js")).href}?v=${Date.now()}`
    )) as {
      default?: readonly Readonly<{
        route?: ReturnType<typeof collectWebRoutes>[number];
        document: WebDocumentIR;
      }>[];
    };
    const documents = loaded.default;
    if (!documents?.length) throw new Error("Web document preparation returned no artifact.");
    for (const { route, document } of documents) {
      staticDocuments.set(routeIdentity(route), withWebStyles(document));
    }
  }
  if (!contract.routes.length) {
    const route = fallbackWebRoute();
    const document = staticDocuments.get(routeIdentity(undefined));
    if (!document) throw new Error("Web root document preparation returned no artifact.");
    return [
      Object.freeze({
        route,
        document: contract.installation ? withWebInstallation(document) : document,
        request: false,
      }),
    ];
  }
  return entries.map(({ route, request }) => {
    const document =
      request === false
        ? staticDocuments.get(routeIdentity(route))
        : dynamicRouteDocument(ir, route);
    if (!document) {
      throw new Error(`Web Route ${JSON.stringify(routeIdentity(route))} produced no document.`);
    }
    return Object.freeze({
      route,
      document: contract.installation ? withWebInstallation(document) : document,
      request,
    });
  });
}

function requestRouteArtifact(
  route: ReturnType<typeof collectWebRoutes>[number],
  compiled: ReturnType<typeof compiledWebRoute>,
  components: readonly CompiledWebComponentIR[],
): PreparedRouteDocument["request"] {
  if (
    route.document !== "content" ||
    (!route.params.length && !route.search.length && !compiled?.implementation.load)
  ) {
    return false;
  }
  if (!compiled) {
    throw new Error(
      `Request-dependent web Route ${routeIdentity(route)} has no compiler-readable view.`,
    );
  }
  validateRequestRenderClosure(routeIdentity(route), compiled.implementation.view, components);
  return Object.freeze({
    loader: Boolean(compiled.implementation.load),
    view: compiled.implementation.view,
  });
}

function validateRequestRenderClosure(
  route: string,
  view: WebRenderNodeIR,
  components: readonly CompiledWebComponentIR[],
): void {
  const definitions = new Map(
    components.map((component) => [componentCompilerIdentity(component), component] as const),
  );
  const pending = [...renderComponentTargets(view)];
  const visited = new Set<string>();
  while (pending.length) {
    const identity = pending.pop()!;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const component = definitions.get(identity);
    if (!component) {
      throw new Error(
        `Request-rendered web Route ${JSON.stringify(route)} references missing Component ${JSON.stringify(identity)}.`,
      );
    }
    if (component.view === false) {
      const detail = component.diagnostic?.message ?? "its view is not compiler-readable";
      throw new Error(
        `Request-rendered web Route ${JSON.stringify(route)} cannot render Component ${JSON.stringify(identity)}: ${detail}`,
      );
    }
    pending.push(...renderComponentTargets(component.view));
  }
}

function renderComponentTargets(node: WebRenderNodeIR): readonly string[] {
  switch (node.kind) {
    case "none":
    case "text":
      return [];
    case "fragment":
    case "element":
      return node.children.flatMap(renderComponentTargets);
    case "conditional":
      return [
        ...renderComponentTargets(node.consequent),
        ...renderComponentTargets(node.alternate),
      ];
    case "component":
      return [
        node.target,
        ...node.props.flatMap((property) =>
          property.node ? renderComponentTargets(property.value as WebRenderNodeIR) : [],
        ),
      ];
    case "each":
      return renderComponentTargets(node.body);
    case "await":
      return [
        ...renderComponentTargets(node.pending),
        ...renderComponentTargets(node.resolved),
        ...renderComponentTargets(node.error.body),
      ];
  }
}

function dynamicRouteDocument(
  ir: ApplicationIR,
  route: ReturnType<typeof collectWebRoutes>[number],
): WebDocumentIR {
  return withWebStyles(
    Object.freeze({
      ...prepareClientWebDocument({
        title: route.metadata.title ?? ir.application.name ?? "Poggers",
        language: route.metadata.language,
        metadata: routeDocumentMetadata(route.metadata),
        entry: "/app.js",
      }),
      rendering: "hydrate" as const,
    }),
  );
}

function fallbackWebRoute(): ReturnType<typeof collectWebRoutes>[number] {
  return {
    feature: "",
    name: "root",
    path: "/",
    document: "content",
    cache: false,
    metadata: {},
    params: [],
    search: [],
    deferred: [],
  };
}

function routeIdentity(route: ReturnType<typeof collectWebRoutes>[number] | undefined): string {
  return route ? `${route.feature}.${route.name}` : ".root";
}

/** Rejects web request semantics that cannot be realized safely and equivalently. */
export function validateProductionWebRoute(
  route: ReturnType<typeof collectWebRoutes>[number],
  implementation: Readonly<{
    hasLoader: boolean;
    request: PreparedRouteDocument["request"];
  }>,
): void {
  if (route.document !== "content") return;
  if (
    implementation.request === false &&
    (implementation.hasLoader || route.params.length || route.search.length)
  ) {
    throw new Error(
      `Request-dependent server web Route ${routeIdentity(route)} has no request artifact.`,
    );
  }
}

function withWebStyles(document: WebDocumentIR): WebDocumentIR {
  const stylesheet =
    `@layer poggers.reset,poggers.presentation;@layer poggers.reset{${webResetCss}}` +
    `@layer poggers.presentation{${document.styles.join("")}}`;
  return Object.freeze({ ...document, styles: Object.freeze([stylesheet]) });
}

function withWebInstallation(document: WebDocumentIR): WebDocumentIR {
  return Object.freeze({
    ...document,
    metadata: Object.freeze({ ...document.metadata, manifest: WEB_MANIFEST_PATH }),
  });
}

function defaultRouteDocument(
  documents: readonly Readonly<{
    route: ReturnType<typeof collectWebRoutes>[number];
    document: WebDocumentIR;
  }>[],
): WebDocumentIR {
  return [...documents].sort((left, right) => {
    const dynamic = (route: string) =>
      route.split("/").filter((value) => /^[:*]/.test(value)).length;
    return (
      dynamic(left.route.path) - dynamic(right.route.path) ||
      left.route.path.length - right.route.path.length
    );
  })[0]!.document;
}

function workerSource(input: {
  application: string;
  development: boolean;
  serverOrigin?: string;
  host: string;
  processRuntime: string;
  revision: number;
  program: ProgramIR;
  manifest: unknown;
  dependencies: readonly DependencyContractIR[];
}): string {
  const application = programApplicationSpecifier(
    input.application,
    input.program.name,
    input.development ? input.revision : undefined,
  );
  const lifecycle =
    input.program.environment.name === "browser-service-worker"
      ? `const programs = globalThis.__poggersServiceWorkerPrograms ??= [];
programs.push(ready);`
      : `let disposed = false;
addEventListener("message", (event) => {
  if (event.data !== "poggers:dispose" || disposed) return;
  disposed = true;
  void ready
    .then((process) => process.dispose())
    .catch((error) => console.error("[poggers] Browser worker disposal failed", error))
    .finally(() => {
      event.ports[0]?.postMessage("poggers:disposed");
      close();
    });
});`;
  return `import application from ${JSON.stringify(application)};
import { createWebHost } from ${JSON.stringify(input.host)};
import { startProcess } from ${JSON.stringify(input.processRuntime)};

const dependencies = createWebHost({
  dependencies: ${JSON.stringify(input.dependencies)},
  context: ${JSON.stringify(
    input.program.environment.name === "browser-service-worker" ? "service-worker" : "worker",
  )},
  ${input.development ? `serverOrigin: ${JSON.stringify(input.serverOrigin ?? "http://localhost:3010")},` : ""}
});
const ready = startProcess(
  application,
  ${JSON.stringify(input.program.name)},
  dependencies,
  ${JSON.stringify(input.manifest)},
);
${lifecycle}
`;
}

function workerName(program: string, index: number): string {
  const readable = program
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return `${String(index + 1).padStart(2, "0")}-${readable || "worker"}`;
}

function candidateSource(input: {
  application: string;
  development: boolean;
  serverOrigin?: string;
  host: string;
  processRuntime: string;
  revision: number;
  runtime: string;
  presentationRuntime: string;
  program: string;
  programManifest: unknown;
  components: unknown;
  presentationDependencies: unknown;
  hotManifest: unknown;
  routes: unknown;
  routeEntries: readonly WebRouteEntry[];
  dependencies: readonly DependencyContractIR[];
  headless: readonly Readonly<{
    program: string;
    manifest: unknown;
    dependencies: readonly DependencyContractIR[];
  }>[];
  workers: readonly Readonly<{
    source: string;
  }>[];
  serviceWorker?: Readonly<{ source: string; register: boolean }>;
}): string {
  const application = routeApplicationSpecifier(
    input.application,
    "base",
    input.development ? input.revision : undefined,
  );
  const routeEntries = Object.fromEntries(
    input.routeEntries.map(({ identity, source }) => [
      identity,
      `() => import(${JSON.stringify(`./${basename(source)}`)})`,
    ]),
  );
  const routeLoaders = Object.entries(routeEntries)
    .map(([identity, load]) => `${JSON.stringify(identity)}: ${load}`)
    .join(",\n  ");
  const routesWithLoaders = input.routeEntries
    .filter(({ loader }) => loader)
    .map(({ identity }) => identity);
  return `import application from ${JSON.stringify(application)};
import { createWebHost } from ${JSON.stringify(input.host)};
import { createWebUIAdapter, render } from ${JSON.stringify(input.runtime)};
import { startProcess } from ${JSON.stringify(input.processRuntime)};

export const manifest = ${JSON.stringify(input.hotManifest)};
export const presentations = application.presentations ?? {};
const development = ${JSON.stringify(input.development)};
const headlessPrograms = ${JSON.stringify(input.headless)};
const workerPrograms = ${JSON.stringify(input.workers)};
const serviceWorker = ${JSON.stringify(input.serviceWorker ?? false)};
const routeModules = {
  ${routeLoaders}
};
const routeDefinitions = new Map();

const loadRoute = (route) => {
  const identity = route.feature + "." + route.name;
  let pending = routeDefinitions.get(identity);
  if (pending) return pending;
  const load = routeModules[identity];
  if (!load) return Promise.reject(new Error("Missing browser Route module " + JSON.stringify(identity) + "."));
  pending = load()
    .then((module) => module.default)
    .catch((error) => {
      if (routeDefinitions.get(identity) === pending) routeDefinitions.delete(identity);
      throw error;
    });
  routeDefinitions.set(identity, pending);
  return pending;
};

const hostOptions = (dependencies) => ({
  dependencies,
  routes: ${JSON.stringify(input.routes)},
  ${input.development ? `serverOrigin: ${JSON.stringify(input.serverOrigin ?? "http://localhost:3010")},` : ""}
});

const disposeAll = async (values) => {
  const results = await Promise.allSettled(values.slice().reverse().map((value) => value()));
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Browser Program disposal failed.");
};

const disposeWorker = (worker) => new Promise((resolve) => {
  const channel = new MessageChannel();
  let complete = false;
  const finish = () => {
    if (complete) return;
    complete = true;
    clearTimeout(timeout);
    channel.port1.close();
    worker.terminate();
    resolve();
  };
  const timeout = setTimeout(finish, 1000);
  channel.port1.onmessage = (event) => {
    if (event.data === "poggers:disposed") finish();
  };
  worker.postMessage("poggers:dispose", [channel.port2]);
});

const pwaPreview = () =>
  development && new URL(location.href).searchParams.get("pwa") === "preview";

const serviceWorkerUrl = () => {
  if (!serviceWorker) return undefined;
  const url = new URL(serviceWorker.source, import.meta.url);
  if (pwaPreview()) url.searchParams.set("pwa", "preview");
  return url;
};

const serviceWorkerRequested = () =>
  Boolean(serviceWorker && (serviceWorker.register || pwaPreview()));

const serviceWorkerSupported = () =>
  typeof navigator.serviceWorker?.register === "function";

const resetDevelopmentWorker = async () => {
  if (!development || !("serviceWorker" in navigator)) return;
  const scope = new URL("/", location.href).href;
  const target = serviceWorkerRequested() ? serviceWorkerUrl()?.href : undefined;
  const controlled = navigator.serviceWorker.controller;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const owned = registrations.filter((registration) => registration.scope === scope);
  const stale = owned.filter((registration) =>
    [registration.active, registration.waiting, registration.installing]
      .filter(Boolean)
      .every((worker) => worker.scriptURL !== target),
  );
  await Promise.all(
    stale.map((registration) => registration.unregister()),
  );
  if ("caches" in globalThis) {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("poggers-")).map((name) => caches.delete(name)),
    );
  }
  const marker = "poggers:development-worker-reset";
  if (controlled && controlled.scriptURL !== target && sessionStorage.getItem(marker) !== "complete") {
    sessionStorage.setItem(marker, "complete");
    location.reload();
    await new Promise(() => {});
  }
  sessionStorage.removeItem(marker);
};

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
  const cleanups = [];
  try {
    await resetDevelopmentWorker();
    for (const definition of headlessPrograms) {
      const process = await startProcess(
        application,
        definition.program,
        createWebHost(hostOptions(definition.dependencies)),
        definition.manifest,
      );
      cleanups.push(() => process.dispose());
    }
    for (const definition of workerPrograms) {
      const url = new URL(definition.source, import.meta.url);
      const worker = new Worker(url, { type: "module", name: "poggers" });
      cleanups.push(() => disposeWorker(worker));
    }
    if (serviceWorkerRequested() && serviceWorkerSupported()) {
      await navigator.serviceWorker.register(serviceWorkerUrl(), {
        type: "module",
        scope: "/",
      });
    }
  } catch (error) {
    await disposeAll(cleanups);
    throw error;
  }
  const presentation =
    Object.keys(presentations).length === 0
      ? undefined
      : (await import(${JSON.stringify(input.presentationRuntime)})).createWebPresentationAdapter();
  const platform = createWebUIAdapter(presentation);
  const dependencies = createWebHost(${JSON.stringify({
    dependencies: input.dependencies,
    routes: input.routes,
    ...(input.development ? { serverOrigin: input.serverOrigin ?? "http://localhost:3010" } : {}),
  })});
  let ui;
  try {
    ui = await platform.component.createApplicationUI({
      application,
      program: ${JSON.stringify(input.program)},
      programManifest: ${JSON.stringify(input.programManifest)},
      dependencies,
      presentations: { presentations },
      components: ${JSON.stringify(input.components)},
      presentationDependencies: ${JSON.stringify(input.presentationDependencies)},
      routes: ${JSON.stringify(input.routes)},
      loadRoute,
      routeLoaders: ${JSON.stringify(routesWithLoaders)},
      hotState,
      boundary: root,
    });
  } catch (error) {
    await disposeAll(cleanups);
    throw error;
  }
  let disposeRender;
  try {
    disposeRender = render(() => ui.renderRoot(), root, hotState);
  } catch (error) {
    await ui.dispose();
    await disposeAll(cleanups);
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
      await disposeAll([() => ui.dispose(), ...cleanups]);
    },
  };
}
`;
}

function developmentDocumentEvaluatorSource(input: {
  application: string;
  document: string;
  revision: number;
}): string {
  const application = routeSourceId(
    input.application,
    new URLSearchParams({ "poggers-revision": String(input.revision) }),
  );
  return `import application from ${JSON.stringify(application)};
import { prepareWebDocument } from ${JSON.stringify(input.document)};

export { application };
export const prepare = (input) => prepareWebDocument({ ...input, application });
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
      program.contributions.flatMap((contribution) =>
        (contribution.ui?.components ?? []).map((component) => {
          const semantic = [
            ...contribution.feature.split(".").filter(Boolean).map(capitalize),
            component.name,
          ].join("/");
          return {
            semantic,
            runtime: runtimeComponentName(contribution.feature, component.name),
          };
        }),
      ),
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
  stream: string;
}): string {
  const candidate = `./${basename(input.candidate)}`;
  if (!input.development) {
    return `import * as candidate from ${JSON.stringify(candidate)};
import { startWebDeferredStream } from ${JSON.stringify(input.stream)};

startWebDeferredStream();
const root = document.querySelector("#app");
if (!root) throw new Error("Missing application root.");
const active = await candidate.activate(root);
const dispose = () => void active.dispose();
addEventListener("pagehide", dispose, { once: true });
`;
  }
  return `import * as initialCandidate from ${JSON.stringify(candidate)};
import { HotUpdateCoordinator } from ${JSON.stringify(input.runtime)};
import { startWebDeferredStream } from ${JSON.stringify(input.stream)};

startWebDeferredStream();
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
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>@layer poggers.reset,poggers.presentation;@layer poggers.reset{${webResetCss}}</style><title>Poggers</title></head><body><div id="app"></div><script type="module" src="${entry}"></script></body></html>`;
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
  let routes = 0;
  const visit = (features: unknown, parent: string) => {
    for (const [name, featureValue] of Object.entries(record(features))) {
      const feature = record(featureValue);
      const path = parent ? `${parent}.${name}` : name;
      const programs = record(feature.programs);
      const definition = record(programs[program]);
      if (typeof definition.root === "string") roots.push(`${path}.${definition.root}`);
      routes += Object.keys(record(definition.routes)).length;
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  if ((routes === 0 && roots.length !== 1) || (routes > 0 && roots.length !== 0)) {
    throw new Error(
      routes > 0
        ? `Routed UI Program "${program}" cannot also define a root Component.`
        : `UI Program "${program}" must define exactly one root Component; found ${roots.length}.`,
    );
  }
}
