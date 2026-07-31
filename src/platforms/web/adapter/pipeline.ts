import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import * as ts from "@typescript/typescript6";
import {
  build,
  createServer,
  defaultClientConditions,
  defaultServerConditions,
  transformWithOxc,
  type HmrContext,
  type Logger,
  type ModuleNode,
  type Plugin,
  type ViteDevServer,
} from "vite";
import { WebSocketServer } from "ws";

import type {
  DevelopmentReporter,
  DevelopmentProgramAttachments,
  HttpAssetExposure,
  ProductionArtifact,
  ProductionReporter,
  SystemCompilationRevision,
  SystemRevisionSource,
} from "@/adapter";
import {
  selectDependencyProviders,
  type SystemIR,
  type PlatformInterfaceIR,
  type ProgramIR,
  type ProgramManifest,
  type SelectedDependencyProviderIR,
} from "@/compiler/ir";
import { collectProgramManifest, linkProgram } from "@/compiler/linker";
import { resolveSystem, type SystemPaths } from "@/compiler/source";
import { packageSourceAliases } from "@/package";
import { createWebResponseCache } from "@/platforms/web/adapter/cache";
import {
  prepareClientWebDocument,
  prepareCompiledWebDocumentStream,
  renderWebDeferredFrame,
  renderWebDocument,
  renderWebMarkdown,
  WEB_MARKDOWN_MEDIA_TYPE,
  WEB_ROUTE_DATA_MEDIA_TYPE,
  webRouteHydrationMetadata,
  type prepareInitialWebPresentation,
  type WebDocumentIR,
  type WebRouteHydrationIR,
} from "@/platforms/web/adapter/document";
import {
  createWebServiceWorkerPlan,
  planWebInstallation,
  renderWebManifest,
  renderWebServiceWorker,
  WEB_MANIFEST_PATH,
  WEB_SERVICE_WORKER_PATH,
  type WebInstallationPlan,
} from "@/platforms/web/adapter/installation";
import {
  collectWebRoutes,
  createWebHotReplacementManifest,
  compiledWebComponentIdentity,
  compiledWebRoute,
  createCompiledWebComponentResolver,
  matchWebRouteBranch,
  matchWebRoute,
  resolveWebDestination,
  validateWebRouteMetadata,
  webInterfaceCompilerIR,
  webRouteBranch,
  webRouteCacheControl,
  webProgramCompilerIR,
  webProgramRoot,
  webProgramUI,
  type CompiledWebComponentIR,
  type CompiledWebRouteIR,
  type WebComponentContractIR,
  type WebRenderNodeIR,
  type WebRouteIR,
  type WebRouteMatch,
  WebRouteValidationError,
} from "@/platforms/web/adapter/lowering";
import {
  validateWebPresentationSource,
  webResetCss,
} from "@/platforms/web/adapter/presentation/compiler";
import { compilePresentationSource } from "@/platforms/web/adapter/presentation/source";
import {
  parseWebRealtimeClientFrame,
  serializeWebRealtimeServerFrames,
  WEB_REALTIME_MAX_FRAME_BYTES,
  WEB_REALTIME_PATH,
  type WebRealtimeServerFrame,
} from "@/platforms/web/adapter/transport";
import { transformComponentSource } from "@/platforms/web/adapter/ui/component/compiler";
import {
  isWebRedirectStatus,
  isWebRouteStatus,
  type WebRedirectStatus,
  type WebRouteMetadataResult,
  type WebRouteStatus,
} from "@/platforms/web/routing";

export type DevelopmentServer = Readonly<{
  port: number;
  stop(): Promise<void>;
}>;

type PreparedInterface = Readonly<{
  candidate: string;
  documentEvaluator?: string;
  entry: string;
  interface: string;
  ir: SystemIR;
  presentationSources: ReadonlySet<string>;
  revision: number;
  crossOriginIsolated: boolean;
  updateKind: WebHotUpdateKind;
  routeEntries: readonly WebRouteEntry[];
  workers: readonly WebWorkerEntry[];
  serviceWorkerBootstrap?: string;
  serviceWorker?: string;
}>;

type WebHotUpdateKind = "full" | "presentation" | "view";

type ProductionPresentationAssets = {
  readonly files: Map<string, Buffer>;
};

type PreparedInterfaceState = {
  current: PreparedInterface;
};

type WebRouteEntry = Readonly<{
  identity: string;
  loader: boolean;
  source: string;
}>;

type WebWorkerEntry = Readonly<{
  identity: string;
  program: string;
  environment: "browser-worker" | "browser-service-worker";
  source: string;
  output: string;
}>;

export type WebBuild = Readonly<{
  directory: string;
  entries: readonly ProductionArtifact[];
}>;

export const WEB_ROUTE_ARTIFACT_VERSION = 7 as const;
const PROJECTED_SOURCE_PREFIX = "\0kit-projected-source:";
const DEVELOPMENT_WEB_CACHE_BYTES = 16 * 1024 * 1024;
const DEVELOPMENT_WEB_CACHE_ENTRIES = 256;
const DEVELOPMENT_WEB_CACHE_REFRESHES = 8;
const DEVELOPMENT_WEB_REQUEST_TIMEOUT_MS = 30_000;

type PreparedRouteDocument = Readonly<{
  route: ReturnType<typeof collectWebRoutes>[number];
  document: WebDocumentIR;
  request:
    | false
    | Readonly<{
        branch: readonly Readonly<{
          route: ReturnType<typeof collectWebRoutes>[number];
          loader: boolean;
          view: WebRenderNodeIR;
        }>[];
      }>;
}>;

export type WebRouteDeliveryIR = Readonly<{
  production: "client" | "precomputed" | "request";
  reasons: readonly string[];
  stream: boolean;
  representations: readonly ("document" | "markdown" | "route-data")[];
  client: Readonly<{
    runtime: boolean;
    hydration: boolean;
  }>;
  worker: Readonly<{
    cacheDocument: boolean;
  }>;
  discovery: Readonly<{
    index: boolean;
    sitemap: boolean;
  }>;
}>;

type DeliveryRouteInput = Readonly<{
  route: WebRouteIR;
  document: WebDocumentIR;
  request: PreparedRouteDocument["request"];
}>;

type DeliveryBranch = readonly Readonly<{ route: WebRouteIR; loader: boolean }>[];

/** Derives one inspectable delivery decision from normalized Route and artifact meaning. */
export function planWebRouteDelivery(input: DeliveryRouteInput): WebRouteDeliveryIR {
  const branch = input.request === false ? [] : input.request.branch;
  const hasLoader = branch.some(({ loader }) => loader);
  const stream =
    input.route.deferred.length > 0 || branch.some(({ route }) => route.deferred.length > 0);
  const production =
    input.route.document === "shell"
      ? "client"
      : input.request === false
        ? "precomputed"
        : "request";
  const reasons = [
    production === "client"
      ? "document:client-shell"
      : production === "precomputed"
        ? "document:request-invariant"
        : "document:request-dependent",
    ...(input.route.params.length ? ["request:path-parameters"] : []),
    ...(input.route.search.length ? ["request:search-parameters"] : []),
    ...(hasLoader ? ["request:loader"] : []),
    ...(stream ? ["response:deferred-stream"] : []),
    input.document.entry === false ? "client:proven-inert" : "client:runtime",
    input.route.cache === false ? "cache:no-store" : `cache:${input.route.cache.scope}`,
  ];
  const markdown =
    input.route.document === "content" &&
    !input.route.metadata.robots
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "noindex") &&
    branch
      .filter(({ loader }) => loader)
      .every(({ route }) => route.cache !== false && route.cache.scope === "public") &&
    !stream;
  const cacheDocument =
    input.route.params.length === 0 &&
    input.route.search.length === 0 &&
    (input.route.document === "shell" ||
      (input.route.cache !== false && input.route.cache.scope === "public"));
  const discovery = planWebRouteDiscovery(input.route, branch);
  return Object.freeze({
    production,
    reasons: Object.freeze(reasons),
    stream,
    representations: Object.freeze([
      "document" as const,
      ...(markdown ? (["markdown"] as const) : []),
      ...(input.request === false ? [] : (["route-data"] as const)),
    ]),
    client: Object.freeze({
      runtime: input.document.entry !== false,
      hydration: input.document.hydration !== false,
    }),
    worker: Object.freeze({ cacheDocument }),
    discovery,
  });
}

function planWebRouteDiscovery(
  route: WebRouteIR,
  branch: DeliveryBranch,
): WebRouteDeliveryIR["discovery"] {
  const publiclyReadable = branch
    .filter(({ loader }) => loader)
    .every(({ route }) => route.cache !== false && route.cache.scope === "public");
  const index =
    route.document === "content" &&
    route.status === 200 &&
    publiclyReadable &&
    !route.metadata.robots?.split(",").some((value) => value.trim().toLowerCase() === "noindex");
  return Object.freeze({
    index,
    sitemap: index && route.params.length === 0 && route.search.length === 0,
  });
}

type WebDiscoveryRoute = Readonly<{
  route: Pick<WebRouteIR, "metadata" | "path">;
  discovery: WebRouteDeliveryIR["discovery"];
}>;

export type WebDiscoveryResources = Readonly<{
  robots: string;
  sitemap: string;
}>;

/** @internal Renders origin-owned discovery resources from relative Route meaning. */
export function renderWebDiscoveryResources(
  origin: string,
  routes: readonly WebDiscoveryRoute[],
): WebDiscoveryResources {
  const publicOrigin = new URL(origin);
  if (!["http:", "https:"].includes(publicOrigin.protocol)) {
    throw new TypeError(`Web discovery origin ${JSON.stringify(origin)} must use HTTP or HTTPS.`);
  }
  const normalizedOrigin = publicOrigin.origin;
  const locations = new Set<string>();
  for (const { route, discovery } of routes) {
    if (!discovery.sitemap) continue;
    const location = new URL(route.metadata.canonical ?? route.path, normalizedOrigin);
    if (location.origin !== normalizedOrigin) continue;
    locations.add(location.href);
  }
  const sitemap = [...locations]
    .sort()
    .map((location) => `<url><loc>${escapeWebDiscoveryXml(location)}</loc></url>`)
    .join("");
  return Object.freeze({
    robots:
      `User-agent: *\nAllow: /\n` + `Sitemap: ${new URL("/sitemap.xml", normalizedOrigin).href}\n`,
    sitemap:
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap}</urlset>\n`,
  });
}

function escapeWebDiscoveryXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

type PreparedProductionDocuments = Readonly<{
  routes: readonly PreparedRouteDocument[];
  presentation: Awaited<ReturnType<typeof prepareInitialWebPresentation>>;
}>;

export const WEB_ASSET_MANIFEST_VERSION = 2 as const;

export type WebAssetManifest = Readonly<{
  version: typeof WEB_ASSET_MANIFEST_VERSION;
  crossOriginIsolated: boolean;
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

function webInterfaceContract(
  ir: SystemIR,
  interfaceId: string,
): Readonly<{
  interface: SystemIR["interfaces"][number];
  applicationName: string;
  uiProgram: string;
  components: Readonly<Record<string, WebComponentEnvironmentContract>>;
  headless: readonly ProgramIR[];
  workers: readonly ProgramIR[];
  routes: ReturnType<typeof collectWebRoutes>;
  installation?: WebInstallationPlan;
}> {
  const interface_ = ir.interfaces.find(({ id }) => id === interfaceId);
  if (!interface_ || interface_.platform !== "web") {
    throw new Error(`Unknown web interface ${JSON.stringify(interfaceId)}.`);
  }
  const programs = ir.programs.filter(({ interface: owner }) => owner === interface_.path);
  const names = new Set(
    programs
      .filter(
        ({ environment, contributions }) =>
          environment.name === "browser-main" && contributions.some(webProgramUI),
      )
      .map(({ name }) => name),
  );
  if (names.size !== 1) {
    throw new Error(
      `Web interface ${JSON.stringify(interfaceId)} must define exactly one ` +
        `BrowserMainThread UI Program; found ${names.size}.`,
    );
  }
  const uiProgram = [...names][0]!;
  const components: Record<string, WebComponentEnvironmentContract> = Object.create(null);
  for (const program of programs) {
    if (
      program.name !== uiProgram ||
      program.environment.name !== "browser-main" ||
      !program.contributions.some(webProgramUI)
    )
      continue;
    for (const contribution of program.contributions) {
      for (const component of webProgramUI(contribution)?.components ?? []) {
        const name = runtimeComponentName(contribution.feature, component.name);
        if (components[name]) {
          throw new Error(`Duplicate runtime Component ${JSON.stringify(name)}.`);
        }
        components[name] = componentEnvironmentContract(component);
      }
    }
  }
  const headless = programs.filter(
    ({ name, environment }) => environment.name === "browser-main" && name !== uiProgram,
  );
  const workers = programs.filter(({ environment }) =>
    ["browser-worker", "browser-service-worker"].includes(environment.name),
  );
  const routes = collectWebRoutes(ir, uiProgram);
  const installation = planWebInstallation(ir, interface_.id, routes);
  return {
    interface: interface_,
    applicationName: ir.apps.find(({ path }) => path === interface_.app)?.name ?? ir.system.name,
    uiProgram,
    components,
    headless,
    workers,
    routes,
    ...(installation ? { installation } : {}),
  };
}

function webInterfaceRequiresCrossOriginIsolation(ir: SystemIR, interfaceId: string): boolean {
  const interface_ = ir.interfaces.find(({ id }) => id === interfaceId);
  if (!interface_ || interface_.platform !== "web") {
    throw new Error(`Unknown web interface ${JSON.stringify(interfaceId)}.`);
  }
  return ir.programs
    .filter(
      ({ interface: owner, environment }) =>
        owner === interface_.path && environment.platform === "web",
    )
    .some((program) =>
      selectDependencyProviders(
        ir,
        program,
        linkProgram(program).external.map(({ name }) => name),
      ).some(
        ({ requirements }) =>
          requirements !== null &&
          typeof requirements === "object" &&
          !Array.isArray(requirements) &&
          Reflect.get(requirements, "crossOriginIsolation") === true,
      ),
    );
}

function collectCompiledWebComponents(
  ir: SystemIR,
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
      compiledWebComponentIdentity(left).localeCompare(compiledWebComponentIdentity(right)),
    );
  const identities = new Set<string>();
  for (const component of components) {
    const identity = compiledWebComponentIdentity(component);
    if (identities.has(identity)) {
      throw new Error(`Duplicate compiled web Component ${JSON.stringify(identity)}.`);
    }
    identities.add(identity);
  }
  return Object.freeze(components);
}

function runtimeComponentName(feature: string, component: string): string {
  return feature ? `@feature/${feature}/component/${component}` : component;
}

function componentEnvironmentContract(
  component: WebComponentContractIR,
): WebComponentEnvironmentContract {
  return {
    elements: Object.fromEntries(component.elements.map(({ name, element }) => [name, element])),
    state:
      component.state.kind === "record" ? component.state.fields.map(({ name }) => ({ name })) : [],
    propCallbacks: component.propCallbacks,
  };
}

/** Proves whether any Route in one web Interface requires the browser runtime. */
export function webInterfaceRequiresClientRuntime(
  ir: SystemIR,
  interfaceId: string,
  compiledComponents = collectCompiledWebComponents(
    ir,
    webInterfaceContract(ir, interfaceId).uiProgram,
  ),
): boolean {
  const contract = webInterfaceContract(ir, interfaceId);
  if (!contract.routes.length) {
    return interfaceRuntimeBaseline(ir, contract, compiledComponents);
  }
  return contract.routes.some((route) =>
    routeRequiresClientRuntime(ir, contract, route, compiledComponents),
  );
}

/** Proves whether one composed Route branch requires the browser runtime. */
export function webRouteRequiresClientRuntime(
  ir: SystemIR,
  interfaceId: string,
  route: WebRouteIR,
  compiledComponents = collectCompiledWebComponents(
    ir,
    webInterfaceContract(ir, interfaceId).uiProgram,
  ),
): boolean {
  return routeRequiresClientRuntime(
    ir,
    webInterfaceContract(ir, interfaceId),
    route,
    compiledComponents,
  );
}

function routeRequiresClientRuntime(
  ir: SystemIR,
  contract: ReturnType<typeof webInterfaceContract>,
  route: WebRouteIR,
  compiledComponents: readonly CompiledWebComponentIR[],
): boolean {
  if (interfaceRuntimeLifecycle(ir, contract)) return true;
  const program = ir.programs.find(
    ({ name, environment }) =>
      name === contract.uiProgram &&
      environment.name === "browser-main" &&
      environment.platform === "web",
  );
  if (!program || route.document === "shell") return true;
  const branch = webRouteBranch(contract.routes, route);
  if (branch.some(({ deferred }) => deferred.length)) return true;
  const compiledRoutes = branch.map((entry) => compiledWebRoute(ir, contract.uiProgram, entry));
  if (compiledRoutes.some((entry) => !entry)) return true;
  let components: readonly CompiledWebComponentIR[];
  try {
    components = compiledRoutes.flatMap((entry) =>
      compiledComponentClosure(
        routeIdentity(route),
        entry!.implementation.view,
        compiledComponents,
      ),
    );
  } catch {
    return true;
  }
  const animated = collectPresentationDependencies(ir, contract.uiProgram);
  for (const component of components) {
    const contribution = program.contributions.find(({ feature }) => feature === component.feature);
    const meaning = contribution
      ? webProgramUI(contribution)?.components.find(({ name }) => name === component.name)
      : undefined;
    if (
      !meaning ||
      typeCarriesRuntimeState(meaning.state) ||
      meaning.actions.length ||
      meaning.propCallbacks.length ||
      meaning.implementation.state ||
      meaning.implementation.actions ||
      meaning.implementation.mount ||
      (animated[runtimeComponentName(component.feature, component.name)] ?? []).some(
        ({ animations }) => animations.length,
      )
    ) {
      return true;
    }
  }
  return false;
}

function interfaceRuntimeBaseline(
  ir: SystemIR,
  contract: ReturnType<typeof webInterfaceContract>,
  fallbackComponents: readonly CompiledWebComponentIR[],
): boolean {
  if (interfaceRuntimeLifecycle(ir, contract)) return true;
  if (fallbackComponents.some(({ view }) => view === false)) return true;
  const programs = ir.programs.filter(
    ({ name, environment }) =>
      name === contract.uiProgram &&
      environment.name === "browser-main" &&
      environment.platform === "web",
  );
  if (contract.routes.length && fallbackComponents.length === 0) return false;
  return (
    programs.some(({ contributions }) =>
      contributions.some((contribution) => {
        const ui = webProgramUI(contribution);
        return Boolean(
          ui &&
          (typeCarriesRuntimeState(ui.state) ||
            ui.actions.length ||
            ui.components.some(
              (component) =>
                typeCarriesRuntimeState(component.state) ||
                component.actions.length ||
                component.propCallbacks.length ||
                component.implementation.state ||
                component.implementation.actions ||
                component.implementation.mount,
            )),
        );
      }),
    ) ||
    (webInterfaceCompilerIR(contract.interface.extensions?.web).presentations ?? []).some(
      ({ animations }) => animations.length > 0,
    )
  );
}

function interfaceRuntimeLifecycle(
  ir: SystemIR,
  contract: ReturnType<typeof webInterfaceContract>,
): boolean {
  const programs = ir.programs.filter(
    ({ name, environment }) =>
      name === contract.uiProgram &&
      environment.name === "browser-main" &&
      environment.platform === "web",
  );
  return Boolean(
    contract.headless.length ||
    contract.workers.some(({ environment }) => environment.name === "browser-worker") ||
    programs.some(({ contributions }) =>
      contributions.some((contribution) => webProgramUI(contribution)?.start),
    ),
  );
}

function typeCarriesRuntimeState(type: WebComponentContractIR["state"]): boolean {
  return type.kind !== "record" || type.fields.length > 0;
}

/** Builds one independently deployable web interface from already compiled System meaning. */
export async function buildWebInterface(options: {
  directory: string;
  outdir: string;
  interface: string;
  ir: SystemIR;
  development?: boolean;
  report?: ProductionReporter;
}): Promise<WebBuild> {
  const paths = resolveSystem(options.directory);
  const outdir = resolve(paths.directory, options.outdir);
  const workspace = webWorkspace(
    paths.directory,
    options.interface,
    options.development ? "development-build" : "production",
  );
  await mkdir(workspace, { recursive: true });
  const work = await realpath(workspace);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  {
    const presentationAssets: ProductionPresentationAssets = { files: new Map() };
    const cacheDir = await webBuildCacheDirectory(work);
    const prepared = await prepareInterface(
      paths,
      work,
      options.interface,
      options.development ?? false,
      {
        revision: 0,
        inputIdentity: "direct-web-interface-build",
        ir: options.ir,
        outputSources: {},
        sourceFiles: [],
        cache: "miss",
        work: {
          features: { compiled: 0, reused: 0 },
        },
      },
    );
    await pruneGeneratedSources(work, prepared);
    const contract = webInterfaceContract(prepared.ir, prepared.interface);
    const crossOriginIsolated = webInterfaceRequiresCrossOriginIsolation(
      prepared.ir,
      prepared.interface,
    );
    let compiledComponents = collectCompiledWebComponents(prepared.ir, contract.uiProgram);
    const clientRoutes = new Set(
      contract.routes
        .filter((route) =>
          routeRequiresClientRuntime(prepared.ir, contract, route, compiledComponents),
        )
        .map(routeIdentity),
    );
    const clientRequired =
      contract.routes.length > 0
        ? clientRoutes.size > 0
        : webInterfaceRequiresClientRuntime(prepared.ir, prepared.interface, compiledComponents);
    const preparedDocuments = await prepareProductionDocuments(
      paths,
      work,
      prepared.ir,
      prepared.interface,
      compiledComponents,
      presentationAssets,
      options.report,
    );
    let routeDocuments = preparedDocuments.routes;
    compiledComponents = compiledComponents.map((component) => {
      const presentation =
        preparedDocuments.presentation.components[
          runtimeComponentName(component.feature, component.name)
        ];
      return presentation ? Object.freeze({ ...component, presentation }) : component;
    });
    const workerInputs = Object.fromEntries(
      prepared.workers.map(({ output, source }) => [output, source]),
    );
    await build({
      ...viteConfiguration(
        paths,
        options.development,
        prepared.ir,
        presentationAssets,
        options.report,
      ),
      cacheDir,
      build: {
        emptyOutDir: false,
        manifest: "manifest.json",
        minify: options.development ? false : "oxc",
        outDir: outdir,
        rolldownOptions: {
          input: {
            app: prepared.entry,
            ...(prepared.serviceWorkerBootstrap
              ? { "service-worker-bootstrap": prepared.serviceWorkerBootstrap }
              : {}),
            ...workerInputs,
          },
          output: {
            assetFileNames: (asset) =>
              asset.names.some((name) => name.endsWith(".css"))
                ? "styles.css"
                : "assets/[name]-[hash][extname]",
            chunkFileNames(chunk) {
              const routes = [
                ...new Set(
                  chunk.moduleIds
                    .map((id) => sourceProjection(id))
                    .filter(
                      (projection): projection is Readonly<{ kind: "route"; name: string }> =>
                        projection?.kind === "route",
                    )
                    .map(({ name }) => name),
                ),
              ];
              return routes.length === 1
                ? `assets/${routeModuleName(routes[0]!)}.generated-[hash].js`
                : "assets/[name]-[hash].js";
            },
            entryFileNames: ({ name }) =>
              name === "app" || name === "service-worker-bootstrap"
                ? "assets/[name]-[hash].js"
                : "workers/[name]-[hash].js",
          },
        },
        sourcemap: options.development ? "inline" : false,
        target: "es2022",
      },
    });
    await writeProductionPresentationAssets(outdir, presentationAssets);
    const client = await readClientBuild(outdir);
    const serviceWorkerBootstrapEntry = prepared.serviceWorkerBootstrap
      ? client.entries["service-worker-bootstrap"]
      : undefined;
    if (prepared.serviceWorkerBootstrap && !serviceWorkerBootstrapEntry) {
      throw new Error("Web client build did not emit its service-worker bootstrap.");
    }
    const serviceWorkerEntries = prepared.workers
      .filter(({ environment }) => environment === "browser-service-worker")
      .map(({ output }) => client.entries[output])
      .filter((value): value is string => Boolean(value));
    const serviceWorkerResources = prepared.workers
      .filter(({ environment }) => environment === "browser-service-worker")
      .flatMap(({ output }) => client.chunks[output] ?? [])
      .filter((value, index, values) => values.indexOf(value) === index);
    const retainedClientResources = await collectReferencedClientResources(
      outdir,
      new Set([
        ...(clientRequired ? client.resources : []),
        ...(serviceWorkerBootstrapEntry ? [serviceWorkerBootstrapEntry] : []),
        ...serviceWorkerResources,
        ...presentationAssets.files.keys(),
      ]),
    );
    await pruneUnreachableClientAssets(outdir, new Set(retainedClientResources));
    routeDocuments = routeDocuments.map(({ route, document, request }) => ({
      route,
      request,
      document: (contract.routes.length ? clientRoutes.has(routeIdentity(route)) : clientRequired)
        ? Object.freeze({
            ...document,
            entry: client.entry,
            preloads: Object.freeze([
              ...client.preloads,
              ...(client.chunks[`${routeModuleName(routeIdentity(route))}.generated`] ?? []),
            ]),
            scripts: Object.freeze(
              serviceWorkerBootstrapEntry ? [serviceWorkerBootstrapEntry] : [],
            ),
          })
        : Object.freeze({
            ...document,
            rendering: "static" as const,
            entry: false as const,
            preloads: Object.freeze([]),
            scripts: Object.freeze(
              serviceWorkerBootstrapEntry ? [serviceWorkerBootstrapEntry] : [],
            ),
            hydration: false as const,
          }),
    }));
    const deliveredRoutes = routeDocuments.map((entry) =>
      Object.freeze({
        ...entry,
        delivery: planWebRouteDelivery(entry),
      }),
    );
    if (contract.installation) {
      await writeFile(
        resolve(outdir, WEB_MANIFEST_PATH.slice(1)),
        renderWebManifest(contract.installation),
      );
    }
    if (contract.installation || serviceWorkerEntries.length) {
      const assets = await createWebAssetManifest(outdir, crossOriginIsolated);
      const cacheable = assets.assets.filter(({ immutable }) => immutable).map(({ path }) => path);
      const criticalScripts = new Set([client.entry, ...client.preloads]);
      const routeScripts = new Set(
        routeDocuments.flatMap(({ document }) => [
          ...(document.entry === false ? [] : [document.entry]),
          ...document.preloads,
        ]),
      );
      const precache = cacheable.filter((path) => criticalScripts.has(path));
      const plan = createWebServiceWorkerPlan({
        installation: contract.installation,
        assets: cacheable,
        precache,
        warmAssets: cacheable.filter(
          (path) => !criticalScripts.has(path) && routeScripts.has(path),
        ),
        routes: deliveredRoutes
          .filter(({ delivery }) => delivery.worker.cacheDocument)
          .map(({ route }) => route),
        modules: serviceWorkerEntries,
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
      `${JSON.stringify({
        version: WEB_ROUTE_ARTIFACT_VERSION,
        interface: contract.interface.path,
        components: compiledComponents,
        routes: deliveredRoutes,
      })}\n`,
    );
    await writeFile(resolve(outdir, "index.html"), renderWebDocument(document));
    await writePrebuiltWebDocuments(outdir, routeDocuments);
    await rm(resolve(outdir, "manifest.json"), { force: true });
    const assets = await createWebAssetManifest(outdir, crossOriginIsolated);
    await writeFile(resolve(outdir, "assets.ir.json"), `${JSON.stringify(assets)}\n`);
    return {
      directory: outdir,
      entries: [
        {
          identity: contract.interface.id,
          kind: "interface" as const,
          deployment: "asset" as const,
          environment: "browser-main",
          path: outdir,
          entrypoint: resolve(outdir, "index.html"),
          exposure: webHttpAssetExposure(deliveredRoutes, assets),
        },
        ...prepared.workers.map(({ identity, environment, output }) => ({
          identity,
          kind: "program" as const,
          deployment: "asset" as const,
          environment,
          path: resolve(outdir, client.entries[output]!.slice(1)),
          entrypoint: resolve(outdir, client.entries[output]!.slice(1)),
        })),
      ],
    };
  }
}

function webHttpAssetExposure(
  routes: readonly (PreparedRouteDocument & Readonly<{ delivery: WebRouteDeliveryIR }>)[],
  assets: WebAssetManifest,
): HttpAssetExposure {
  const staticDocuments = routes.flatMap(
    ({
      request,
      route,
    }): Readonly<{
      path: string;
      cacheControl: string;
    }>[] => {
      if (request !== false || route.params.length || route.search.length) return [];
      const path =
        route.path === "/"
          ? "index.html"
          : `${route.path
              .split("/")
              .filter(Boolean)
              .map((segment) => decodeURIComponent(segment))
              .join("/")}/index.html`;
      return [{ path, cacheControl: webRouteCacheControl(route.cache) }];
    },
  );
  const files = new Map<string, string>(
    assets.assets.map(({ path, immutable }) => [
      path.slice(1),
      immutable ? "public, max-age=31536000, immutable" : "no-cache",
    ]),
  );
  files.set(
    "index.html",
    staticDocuments.find(({ path }) => path === "index.html")?.cacheControl ?? "no-cache",
  );
  for (const { path, cacheControl } of staticDocuments) files.set(path, cacheControl);

  const placeholderOrigin = "https://kit.invalid";
  const discovery = renderWebDiscoveryResources(
    placeholderOrigin,
    routes.map(({ delivery, route }) => ({ route, discovery: delivery.discovery })),
  );
  return Object.freeze({
    kind: "http-assets",
    fallback: "index.html",
    ...(assets.crossOriginIsolated
      ? {
          headers: Object.freeze({
            "cross-origin-embedder-policy": "require-corp",
            "cross-origin-opener-policy": "same-origin",
          }),
        }
      : {}),
    files: Object.freeze(
      [...files]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, cacheControl]) => Object.freeze({ path, cacheControl })),
    ),
    responses: Object.freeze([
      Object.freeze({
        path: "/robots.txt",
        status: 200,
        headers: Object.freeze({
          "cache-control": "public, max-age=300",
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        }),
        body: discovery.robots.replaceAll(placeholderOrigin, "{{origin}}"),
        substitutions: Object.freeze(["origin" as const]),
      }),
      Object.freeze({
        path: "/sitemap.xml",
        status: 200,
        headers: Object.freeze({
          "cache-control": "public, max-age=300",
          "content-type": "application/xml; charset=utf-8",
          "x-content-type-options": "nosniff",
        }),
        body: discovery.sitemap.replaceAll(placeholderOrigin, "{{origin}}"),
        substitutions: Object.freeze(["origin" as const]),
      }),
    ]),
  });
}

/** Materializes request-independent Routes for direct static delivery. */
async function writePrebuiltWebDocuments(
  directory: string,
  routes: readonly PreparedRouteDocument[],
): Promise<void> {
  for (const { document, request, route } of routes) {
    if (
      request !== false ||
      route.path === "/" ||
      route.params.length > 0 ||
      route.search.length > 0
    ) {
      continue;
    }
    const segments = route.path
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (
      !segments.length ||
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\"),
      )
    ) {
      throw new Error(`Web Route ${JSON.stringify(routeIdentity(route))} has an unsafe path.`);
    }
    const output = resolve(directory, ...segments, "index.html");
    const boundary = relative(resolve(directory), output);
    if (boundary === ".." || boundary.startsWith(`..${sep}`)) {
      throw new Error(`Web Route ${JSON.stringify(routeIdentity(route))} escapes its output.`);
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, renderWebDocument(document));
  }
}

/** @internal Seals every public production file into one exact serving allowlist. */
export async function createWebAssetManifest(
  directory: string,
  crossOriginIsolated = false,
): Promise<WebAssetManifest> {
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
  return Object.freeze({
    version: WEB_ASSET_MANIFEST_VERSION,
    crossOriginIsolated,
    assets: Object.freeze(assets),
  });
}

type ClientManifestChunk = Readonly<{
  assets?: readonly string[];
  css?: readonly string[];
  dynamicImports?: readonly string[];
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
    resources: readonly string[];
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
  resources: readonly string[];
}> {
  const entries = Object.fromEntries(
    Object.values(manifest)
      .filter((chunk) => chunk.isEntry && chunk.name)
      .map((chunk) => [chunk.name!, `/${chunk.file}`]),
  );
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.name === "app");
  if (!entry) throw new Error("Web client build did not emit its entry.");
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
  const resources = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const chunk = manifest[name];
    if (!chunk) throw new Error(`Web client manifest references missing chunk ${name}.`);
    resources.add(`/${chunk.file}`);
    for (const file of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
      resources.add(`/${file}`);
    }
    for (const dependency of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      visit(dependency);
    }
  };
  for (const [name, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) visit(name);
  }
  return Object.freeze({
    entry: `/${entry.file}`,
    preloads: imports(entry),
    entries: Object.freeze(entries),
    chunks: Object.freeze(chunks),
    resources: Object.freeze([...resources].sort()),
  });
}

/**
 * Closes Vite's manifest graph over generated worker and asset URLs.
 *
 * Vite emits `new Worker(new URL(...))` chunks but does not link them from its
 * client manifest. Following emitted URLs keeps reachable workers while the
 * subsequent pruning pass still removes tree-shaken residue.
 */
export async function collectReferencedClientResources(
  directory: string,
  initial: ReadonlySet<string>,
): Promise<readonly string[]> {
  const resources = new Set(initial);
  const pending = [...initial];
  while (pending.length) {
    const resource = pending.pop()!;
    if (!resource.endsWith(".js") && !resource.endsWith(".css")) continue;
    const file = resolve(directory, resource.slice(1));
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\/(?:assets|workers)\/[A-Za-z0-9._-]+/g)) {
      const referenced = match[0];
      if (resources.has(referenced)) continue;
      try {
        await stat(resolve(directory, referenced.slice(1)));
      } catch {
        throw new Error(
          `Generated client resource ${JSON.stringify(resource)} references missing output ` +
            `${JSON.stringify(referenced)}.`,
        );
      }
      resources.add(referenced);
      pending.push(referenced);
    }
  }
  return Object.freeze([...resources].sort());
}

/** Removes assets emitted while transforming modules that final tree-shaking discarded. */
async function pruneUnreachableClientAssets(
  directory: string,
  resources: ReadonlySet<string>,
): Promise<void> {
  const prune = async (root: string): Promise<void> => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = resolve(root, entry.name);
      if (entry.isDirectory()) {
        await prune(file);
      } else if (entry.isFile()) {
        const path = `/${relative(directory, file).split(sep).join("/")}`;
        if (!resources.has(path)) await rm(file);
      }
    }
  };
  for (const name of ["assets", "workers"]) {
    const root = resolve(directory, name);
    try {
      await prune(root);
    } catch (error) {
      if (error !== null && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

/** Runs one web interface while sharing the caller-owned System revision source. */
export async function runWebInterface(options: {
  directory: string;
  interface: string;
  revisions: SystemRevisionSource;
  port?: number;
  serverOrigin?: string;
  programAttachments?: DevelopmentProgramAttachments;
  strictPort?: boolean;
  report?: DevelopmentReporter;
}): Promise<DevelopmentServer> {
  const paths = resolveSystem(options.directory);
  const workspace = webDevelopmentWorkspace(paths.directory, options.interface);
  await mkdir(workspace, { recursive: true });
  const work = await realpath(workspace);
  const prepared = await prepareInterface(
    paths,
    work,
    options.interface,
    true,
    options.revisions.current,
    "full",
    undefined,
    undefined,
  );
  const interfaceState: PreparedInterfaceState = { current: prepared };
  await writeFile(
    resolve(work, "index.html"),
    htmlSource("/browser.generated.ts", prepared.ir.system.name),
  );
  await pruneGeneratedSources(work, prepared);

  const server = await createServer({
    ...viteConfiguration(paths, true, prepared.ir, undefined, options.report),
    appType: "spa",
    cacheDir: resolve(work, ".vite"),
    plugins: [
      ...(options.serverOrigin ? [webRealtimeProxyPlugin(options.serverOrigin)] : []),
      presentationContractPlugin(
        paths,
        work,
        options.revisions,
        interfaceState,
        undefined,
        options.programAttachments,
        options.report,
      ),
      ...vitePlugins(paths, () => interfaceState.current.ir, undefined, true),
    ],
    root: work,
    server: {
      fs: { allow: [work, paths.directory, resolve(import.meta.dirname, "../../..")] },
      host: "localhost",
      port: options.port ?? 3000,
      ...(options.serverOrigin
        ? {
            proxy: {
              "/api": {
                target: options.serverOrigin,
                changeOrigin: true,
                ws: true,
              },
            },
          }
        : {}),
      strictPort: options.strictPort ?? options.port !== undefined,
    },
  });
  try {
    await server.listen();
    await server.watcher.unwatch([
      prepared.candidate,
      ...(prepared.documentEvaluator ? [prepared.documentEvaluator] : []),
      prepared.entry,
      ...(prepared.serviceWorkerBootstrap ? [prepared.serviceWorkerBootstrap] : []),
      ...prepared.routeEntries.map(({ source }) => source),
      ...prepared.workers.map(({ source }) => source),
      ...(prepared.serviceWorker ? [prepared.serviceWorker] : []),
    ]);
  } catch (error) {
    try {
      await server.close();
    } catch (disposalError) {
      throw new AggregateError(
        [error, disposalError],
        "Web development startup and rollback failed.",
      );
    }
    throw error;
  }
  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 3000);

  return {
    port,
    async stop() {
      if (server.httpServer && "closeAllConnections" in server.httpServer) {
        server.httpServer.closeAllConnections();
      }
      await server.close();
    },
  };
}

function webRealtimeProxyPlugin(target: string): Plugin {
  return {
    name: "kit-realtime-proxy",
    configureServer(server) {
      const http = server.httpServer;
      if (!http) return;
      const sockets = new WebSocketServer({
        noServer: true,
        maxPayload: WEB_REALTIME_MAX_FRAME_BYTES,
      });
      const upgrade = (
        request: Parameters<NonNullable<typeof http>["emit"]>[1] & {
          url?: string;
        },
        socket: Parameters<WebSocketServer["handleUpgrade"]>[1],
        head: Parameters<WebSocketServer["handleUpgrade"]>[2],
      ) => {
        const path = new URL(request.url ?? "/", target).pathname;
        if (path !== WEB_REALTIME_PATH) return;
        sockets.handleUpgrade(request as never, socket, head, (webSocket) => {
          sockets.emit("connection", webSocket, request);
        });
      };
      http.on("upgrade", upgrade as never);
      sockets.on("connection", (socket, request) => {
        const active = new Map<string, AbortController>();
        const send = (frame: WebRealtimeServerFrame): void => {
          if (socket.readyState !== socket.OPEN) return;
          for (const value of serializeWebRealtimeServerFrames(frame)) socket.send(value);
        };
        const cancel = (): void => {
          for (const controller of active.values()) controller.abort();
          active.clear();
        };
        socket.on("close", cancel);
        socket.on("error", cancel);
        socket.on("message", (data, binary) => {
          if (binary) {
            socket.close(1003, "Text frames required");
            return;
          }
          let frame;
          try {
            frame = parseWebRealtimeClientFrame(data.toString("utf8"));
          } catch {
            socket.close(1007, "Invalid frame");
            return;
          }
          if (frame.type === "cancel") {
            active.get(frame.id)?.abort();
            active.delete(frame.id);
            return;
          }
          if (active.has(frame.id)) {
            send({
              type: "error",
              id: frame.id,
              message: "Duplicate realtime request identity.",
            });
            return;
          }
          const controller = new AbortController();
          active.set(frame.id, controller);
          void proxyWebRealtimeRequest({
            target,
            frame,
            requestHeaders: request.headers,
            signal: controller.signal,
            send,
          }).finally(() => active.delete(frame.id));
        });
      });
      http.once("close", () => {
        http.off("upgrade", upgrade as never);
        for (const socket of sockets.clients) socket.close(1001, "Development server stopped");
        sockets.close();
      });
    },
  };
}

async function proxyWebRealtimeRequest(input: {
  target: string;
  frame: Extract<ReturnType<typeof parseWebRealtimeClientFrame>, Readonly<{ type: "request" }>>;
  requestHeaders: IncomingHttpHeaders;
  signal: AbortSignal;
  send(frame: WebRealtimeServerFrame): void;
}): Promise<void> {
  try {
    const headers = new Headers(input.frame.headers);
    if (input.requestHeaders.cookie) headers.set("cookie", input.requestHeaders.cookie);
    if (input.requestHeaders.origin) headers.set("origin", input.requestHeaders.origin);
    const response = await fetch(new URL(input.frame.path, input.target), {
      method: input.frame.method,
      headers,
      ...(input.frame.body === undefined ? {} : { body: input.frame.body }),
      redirect: "manual",
      signal: input.signal,
    });
    input.send({
      type: "response",
      id: input.frame.id,
      status: response.status,
      headers: [...response.headers],
    });
    if (response.body) {
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        const value = decoder.decode(chunk, { stream: true });
        if (value) input.send({ type: "chunk", id: input.frame.id, value });
      }
      const remaining = decoder.decode();
      if (remaining) input.send({ type: "chunk", id: input.frame.id, value: remaining });
    }
    input.send({ type: "end", id: input.frame.id });
  } catch (error) {
    if (input.signal.aborted) return;
    input.send({
      type: "error",
      id: input.frame.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** @internal Returns the stable generated-source and Vite cache owner for one interface. */
export function webDevelopmentWorkspace(directory: string, interfaceId: string): string {
  return webWorkspace(directory, interfaceId, "development");
}

function webWorkspace(
  directory: string,
  interfaceId: string,
  purpose: "development" | "development-build" | "production",
): string {
  const root = canonicalSourcePath(directory);
  const readable =
    interfaceId
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "")
      .slice(0, 48) || "interface";
  const identity = createHash("sha256")
    .update(
      purpose === "development" ? `${root}\0${interfaceId}` : `${root}\0${interfaceId}\0${purpose}`,
    )
    .digest("hex")
    .slice(0, 12);
  const name =
    purpose === "development" ? `${readable}-${identity}` : `${purpose}-${readable}-${identity}`;
  return resolve(root, ".kit/cache/web", name);
}

let transformIdentity: Promise<string> | undefined;

async function webBuildCacheDirectory(work: string): Promise<string> {
  transformIdentity ??= Promise.all(
    [
      import.meta.filename,
      resolve(import.meta.dirname, `presentation/source${moduleExtension()}`),
      resolve(import.meta.dirname, `ui/component/compiler${moduleExtension()}`),
    ].map((file) => readFile(file)),
  ).then((sources) => {
    const hash = createHash("sha256");
    for (const source of sources) hash.update(source);
    return hash.digest("hex").slice(0, 16);
  });
  const current = `.vite-${await transformIdentity}`;
  await Promise.all(
    (await readdir(work, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === ".vite" || (entry.name.startsWith(".vite-") && entry.name !== current)),
      )
      .map((entry) => rm(resolve(work, entry.name), { recursive: true, force: true })),
  );
  return resolve(work, current);
}

async function pruneGeneratedSources(work: string, prepared: PreparedInterface): Promise<void> {
  const retained = new Set(
    [
      prepared.candidate,
      prepared.documentEvaluator,
      prepared.entry,
      prepared.serviceWorkerBootstrap,
      prepared.serviceWorker,
      ...prepared.routeEntries.map(({ source }) => source),
      ...prepared.workers.map(({ source }) => source),
    ]
      .filter((path): path is string => Boolean(path))
      .map((path) => resolve(path)),
  );
  await Promise.all(
    (await readdir(work, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".generated.ts") &&
          !retained.has(resolve(work, entry.name)),
      )
      .map((entry) => rm(resolve(work, entry.name), { force: true })),
  );
}

async function prepareInterface(
  paths: SystemPaths,
  work: string,
  interfaceId: string,
  development: boolean,
  compilation: SystemCompilationRevision,
  updateKind: WebHotUpdateKind = "full",
  previous?: PreparedInterface,
  serverOrigin?: string,
): Promise<PreparedInterface> {
  await mkdir(work, { recursive: true });
  const { ir } = compilation;
  const contract = webInterfaceContract(ir, interfaceId);
  const crossOriginIsolated = webInterfaceRequiresCrossOriginIsolation(ir, interfaceId);
  const revision = (previous?.revision ?? -1) + 1;

  const candidate = resolve(work, "interface.generated.ts");
  const documentEvaluator = development
    ? resolve(work, "document-evaluator.generated.ts")
    : undefined;
  const ui = ir.programs.find(({ name }) => name === contract.uiProgram)!;
  const programManifest = collectProgramManifest(ui);
  const routeDependencies = Object.freeze(
    [
      ...new Set(
        contract.routes.flatMap(
          (route) =>
            compiledWebRoute(ir, contract.uiProgram, route)?.dependencies.map(({ name }) => name) ??
            [],
        ),
      ),
    ].sort(),
  );
  if (documentEvaluator) {
    await writeIfChanged(
      documentEvaluator,
      developmentDocumentEvaluatorSource({
        system: paths.system,
        program: contract.uiProgram,
        application: contract.interface.app,
        interface: contract.interface.path,
        applicationName: contract.applicationName,
        features: contract.interface.features,
        routes: contract.routes,
        document: resolve(import.meta.dirname, `document${moduleExtension()}`),
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
          system: paths.system,
          development,
          serverOrigin,
          host: resolve(import.meta.dirname, `host${moduleExtension()}`),
          runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
          processRuntime: resolve(
            import.meta.dirname,
            `../../../execution/process${moduleExtension()}`,
          ),
          program,
          manifest,
          dependencies: linkProgram(program).external.map(({ name }) => name),
          providers: featureProviders(ir, program),
        }),
      );
      return {
        identity: program.id,
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
  const serviceWorkerBootstrapSource = serviceWorkerSource
    ? resolve(work, "service-worker-bootstrap.generated.ts")
    : undefined;
  if (serviceWorkerBootstrapSource && serviceWorkerSource) {
    await writeIfChanged(
      serviceWorkerBootstrapSource,
      renderServiceWorkerBootstrap(
        development ? `./${basename(serviceWorkerSource)}` : WEB_SERVICE_WORKER_PATH,
        development,
        serviceWorkers.length > 0,
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
          system: paths.system,
          program: ui.logicalName,
          route,
        }),
      );
      return Object.freeze({ identity, loader, source });
    }),
  );
  await writeIfChanged(
    candidate,
    candidateSource({
      system: paths.system,
      development,
      serverOrigin,
      host: resolve(import.meta.dirname, `host${moduleExtension()}`),
      runtime: resolve(import.meta.dirname, `./ui/adapter${moduleExtension()}`),
      presentationRuntime: resolve(
        import.meta.dirname,
        `./presentation/adapter${moduleExtension()}`,
      ),
      processRuntime: resolve(
        import.meta.dirname,
        `../../../execution/process${moduleExtension()}`,
      ),
      application: contract.interface.app,
      interface: contract.interface.path,
      features: contract.interface.features,
      program: ui,
      programManifest,
      dependencies: linkProgram(ui).external.map(({ name }) => name),
      routeDependencies,
      providers: featureProviders(ir, ui),
      components: contract.components,
      presentationDependencies: collectPresentationDependencies(ir, contract.uiProgram),
      hotManifest: development ? createWebHotReplacementManifest(ir) : undefined,
      routes: contract.routes,
      routeEntries,
      headless: contract.headless.map((program) => {
        const manifest = collectProgramManifest(program);
        return {
          program: program.name,
          logicalProgram: program.logicalName,
          manifest,
          dependencies: linkProgram(program).external.map(({ name }) => name),
          providers: featureProviders(ir, program),
        };
      }),
      workers: workers
        .filter(({ environment }) => environment === "browser-worker")
        .map(({ output, source }) => ({
          source: development ? `./${basename(source)}` : `/workers/${output}.js`,
        })),
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
    interface: interfaceId,
    presentationSources: new Set(
      (webInterfaceCompilerIR(contract.interface.extensions?.web).presentations ?? []).map(
        ({ file }) => resolve(paths.source, file),
      ),
    ),
    revision,
    crossOriginIsolated,
    updateKind,
    routeEntries,
    workers,
    ...(serviceWorkerBootstrapSource
      ? { serviceWorkerBootstrap: serviceWorkerBootstrapSource }
      : {}),
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

function viteConfiguration(
  paths: SystemPaths,
  development = false,
  ir?: SystemIR,
  presentationAssets?: ProductionPresentationAssets,
  report?: DevelopmentReporter | ProductionReporter,
) {
  return {
    configFile: false as const,
    mode: development ? "development" : "production",
    logLevel: "silent" as const,
    customLogger: viteReporter(report),
    oxc: { jsx: { development } },
    plugins: vitePlugins(paths, ir, presentationAssets, development),
    resolve: {
      alias: packageSourceAliases(),
      conditions: ["source", ...defaultClientConditions],
    },
    root: paths.directory,
  };
}

function viteReporter(report?: DevelopmentReporter | ProductionReporter): Logger {
  const warnings = new Set<string>();
  const errors = new WeakSet<object>();
  let hasWarned = false;
  const diagnostic = (severity: "error" | "warning", raw: string) => {
    if (!report) return;
    report({
      kind: "diagnostic",
      platform: "web",
      severity,
      message: stripVTControlCharacters(raw).trim(),
    });
  };
  return {
    info() {},
    warn(message) {
      hasWarned = true;
      diagnostic("warning", message);
    },
    warnOnce(message) {
      if (warnings.has(message)) return;
      warnings.add(message);
      hasWarned = true;
      diagnostic("warning", message);
    },
    error(message, options) {
      if (options?.error && typeof options.error === "object") errors.add(options.error);
      diagnostic("error", message);
    },
    clearScreen() {},
    hasErrorLogged(error) {
      return errors.has(error);
    },
    get hasWarned() {
      return hasWarned;
    },
  };
}

function moduleExtension(): ".ts" | ".js" {
  return import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
}

function vitePlugins(
  paths: SystemPaths,
  ir?: SystemIR | (() => SystemIR),
  presentationAssets?: ProductionPresentationAssets,
  virtualProjections = false,
): Plugin[] {
  return [
    ...(ir ? [routeSourcePlugin(paths, ir, virtualProjections)] : []),
    systemAliasPlugin(paths.source),
    productionPresentationAssetPlugin(paths.source, presentationAssets),
    presentationTransformPlugin(paths.source),
    componentTransformPlugin(paths.source),
    projectedSourceSyntaxPlugin(),
  ];
}

function projectedSourceSyntaxPlugin(): Plugin {
  return {
    name: "kit-projected-source-syntax",
    enforce: "pre",
    async transform(code, rawId) {
      const source = projectedSourceSpecifier(rawId);
      if (!source) return;
      return transformWithOxc(code, cleanId(source));
    },
  };
}

/** @internal Resolves authored local Presentation assets identically for SSR and the client. */
export function productionPresentationAssetPlugin(
  source: string,
  assets?: ProductionPresentationAssets,
): Plugin {
  return {
    name: "kit-production-presentation-assets",
    enforce: "pre",
    async transform(code, rawId) {
      const id = cleanId(rawId);
      if (!id.startsWith(`${source}${sep}`) || !/\.[cm]?[jt]sx?$/.test(id)) return;
      const file = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, webScriptKind(id));
      const constructors = presentationAssetConstructors(file);
      if (constructors.identifiers.size === 0 && constructors.namespaces.size === 0) return;
      const references: { argument: ts.Expression; specifier: string }[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isPresentationAssetCall(node, constructors)) {
          const argument = node.arguments[0];
          const specifier = argument && localAssetSpecifier(argument);
          if (argument && specifier) references.push({ argument, specifier });
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      const replacements = await Promise.all(
        references.map(async ({ argument, specifier }) => {
          const path = resolve(dirname(id), specifier);
          if (path !== source && !path.startsWith(`${source}${sep}`)) {
            throw new Error(
              `Presentation asset ${JSON.stringify(specifier)} must be inside ${JSON.stringify(source)}.`,
            );
          }
          const contents = await readFile(path);
          return {
            start: argument.getStart(file),
            end: argument.end,
            value: JSON.stringify(productionPresentationAssetSource(path, contents, assets)),
          };
        }),
      );
      if (replacements.length === 0) return;
      let transformed = code;
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        transformed =
          transformed.slice(0, replacement.start) +
          replacement.value +
          transformed.slice(replacement.end);
      }
      return { code: transformed, map: null };
    },
  };
}

type PresentationAssetConstructors = Readonly<{
  identifiers: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
}>;

function presentationAssetConstructors(file: ts.SourceFile): PresentationAssetConstructors {
  const identifiers = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isWebPresentationModule(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (isPresentationAssetConstructor(imported)) identifiers.add(element.name.text);
    }
  }
  return { identifiers, namespaces };
}

function isWebPresentationModule(specifier: string): boolean {
  return (
    specifier === "kit/web" ||
    specifier === "@/platforms/web/presentation" ||
    specifier.endsWith("/platforms/web/presentation")
  );
}

function isPresentationAssetConstructor(name: string): boolean {
  return name === "createAudioAsset" || name === "createImageAsset";
}

function isPresentationAssetCall(
  call: ts.CallExpression,
  constructors: PresentationAssetConstructors,
): boolean {
  if (ts.isIdentifier(call.expression)) return constructors.identifiers.has(call.expression.text);
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    constructors.namespaces.has(call.expression.expression.text) &&
    isPresentationAssetConstructor(call.expression.name.text)
  );
}

function localAssetSpecifier(expression: ts.Expression): string | undefined {
  if (
    !ts.isNewExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "URL" ||
    expression.arguments?.length !== 2
  ) {
    return;
  }
  const [path, base] = expression.arguments;
  if (
    !path ||
    (!ts.isStringLiteral(path) && !ts.isNoSubstitutionTemplateLiteral(path)) ||
    !base ||
    !ts.isPropertyAccessExpression(base) ||
    base.name.text !== "url" ||
    !ts.isMetaProperty(base.expression) ||
    base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword ||
    base.expression.name.text !== "meta" ||
    !path.text.startsWith(".") ||
    path.text.includes("?") ||
    path.text.includes("#")
  ) {
    return;
  }
  return path.text;
}

function productionPresentationAssetSource(
  file: string,
  contents: Buffer,
  assets?: ProductionPresentationAssets,
): string {
  const extension = extname(file).toLowerCase();
  if (contents.byteLength < 4_096 || !assets) {
    return `data:${webAssetMediaType(extension)};base64,${contents.toString("base64")}`;
  }
  const stem =
    basename(file, extension)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "asset";
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  const path = `/assets/${stem}-${hash}${extension}`;
  const previous = assets.files.get(path);
  if (previous && !previous.equals(contents)) {
    throw new Error(`Production Presentation asset collision at ${JSON.stringify(path)}.`);
  }
  assets.files.set(path, contents);
  return path;
}

function webAssetMediaType(extension: string): string {
  return (
    (
      {
        ".avif": "image/avif",
        ".flac": "audio/flac",
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".wav": "audio/wav",
        ".webp": "image/webp",
      } as Readonly<Record<string, string>>
    )[extension] ?? "application/octet-stream"
  );
}

async function writeProductionPresentationAssets(
  directory: string,
  assets: ProductionPresentationAssets,
): Promise<void> {
  for (const [path, contents] of [...assets.files].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const output = resolve(directory, path.slice(1));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents);
  }
}

function webScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** @internal Creates source projections for independently loaded browser Routes and Programs. */
export function routeSourcePlugin(
  paths: SystemPaths,
  system: SystemIR | (() => SystemIR),
  virtual = false,
): Plugin {
  type RouteLocation = Readonly<{
    feature: string;
    identity: string;
    parent?: string;
    program: string;
    span: CompiledWebRouteIR["implementationSpan"];
  }>;
  const projectionCache = new Map<string, Readonly<{ code: string; map: null }>>();
  type ProgramLocation = Readonly<{
    feature: string;
    identity: string;
    span: ProgramIR["contributions"][number]["span"];
  }>;
  const contract = () => {
    const ir = typeof system === "function" ? system() : system;
    const routeLocations = new Map<string, RouteLocation[]>();
    const programLocations = new Map<string, ProgramLocation[]>();
    for (const program of ir.programs) {
      const composedRoutes =
        program.environment.platform === "web" ? collectWebRoutes(ir, program.name) : [];
      const routeParents = new Map(
        composedRoutes.map((route) => [routeIdentity(route), route.parent] as const),
      );
      for (const contribution of program.contributions) {
        const file = canonicalSourcePath(resolve(paths.directory, contribution.span.file));
        const location = {
          feature: contribution.feature,
          identity: program.name,
          span: contribution.span,
        };
        for (const source of projectionSourceAliases(file)) {
          const current = programLocations.get(source) ?? [];
          current.push(location);
          programLocations.set(source, current);
        }
      }
      if (program.environment.platform !== "web") continue;
      for (const contribution of program.contributions) {
        if (!contribution.extensions?.web) continue;
        for (const route of webProgramCompilerIR(contribution.extensions.web).routes) {
          const file = canonicalSourcePath(resolve(paths.source, route.implementationSpan.file));
          const current = routeLocations.get(file) ?? [];
          current.push({
            feature: route.feature,
            identity: routeIdentity(route),
            ...(routeParents.get(routeIdentity(route))
              ? { parent: routeParents.get(routeIdentity(route)) }
              : {}),
            program: program.name,
            span: route.implementationSpan,
          });
          routeLocations.set(file, current);
        }
      }
    }
    return {
      ir,
      routeLocations,
      programLocations,
    };
  };

  return {
    name: "kit-route-source",
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
      if (!isProjectableSourceModule(id, paths.source)) return;
      const parameters = sourceProjection(source)
        ? sourceParameters(source)
        : new URLSearchParams();
      parameters.set(
        projection.kind === "route"
          ? "kit-route"
          : projection.kind === "document"
            ? "kit-document"
            : "kit-program",
        projection.name,
      );
      return virtual ? projectedSourceId(id, parameters) : routeSourceId(id, parameters);
    },
    async load(id) {
      const source = projectedSourceSpecifier(id);
      if (!source) return;
      const file = cleanId(source);
      this.addWatchFile(file);
      return readFile(file, "utf8");
    },
    transform(code, rawId) {
      const projection = sourceProjection(rawId);
      if (!projection) return;
      const { ir, routeLocations, programLocations } = contract();
      const id = canonicalSourcePath(cleanId(rawId));
      const routes = routeLocations.get(id) ?? [];
      const programs = programLocations.get(id) ?? [];
      const source = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true,
        id.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const objects = new Map<string, ts.ObjectLiteralExpression>();
      const expressions = new Map<string, ts.Expression>();
      const projectionRoots = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isExpression(node)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          const location = `${position.line + 1}:${position.character + 1}`;
          const current = expressions.get(location);
          if (!current || node.end > current.end) expressions.set(location, node);
        }
        if (ts.isObjectLiteralExpression(node)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          objects.set(`${position.line + 1}:${position.character + 1}`, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      const replacements: Array<Readonly<{ start: number; end: number; value: string }>> = [];
      const retainedPrograms =
        projection.kind === "route"
          ? new Set(
              [...routeLocations.values()]
                .flat()
                .filter(({ identity }) => identity === projection.name)
                .map(({ program }) => program),
            )
          : new Set([projection.name]);
      const retainedApplications = projectedApplications(ir, retainedPrograms);
      const retainedFeatures =
        projection.kind === "route"
          ? projectedRouteFeaturePaths(routeLocations, projection.name)
          : projectedFeaturePaths(ir, retainedPrograms, retainedApplications);
      const retainedPlatforms = new Set(
        ir.programs
          .filter(({ name }) => retainedPrograms.has(name))
          .map(({ environment }) => environment.platform),
      );
      const projectionCacheKey =
        routes.length === 0
          ? [
              id,
              projection.kind,
              projection.name,
              [...retainedPrograms].sort().join(","),
              createHash("sha256").update(code).digest("base64url"),
            ].join("\0")
          : undefined;
      const cached = projectionCacheKey ? projectionCache.get(projectionCacheKey) : undefined;
      if (cached) return cached;
      const retainedProgramSpans = new Set(
        programs
          .filter(({ identity }) => retainedPrograms.has(identity))
          .map(({ span }) => `${span.line}:${span.column}`),
      );
      for (const program of programs) {
        if (!retainedFeatures.has(program.feature)) continue;
        const node = expressions.get(`${program.span.line}:${program.span.column}`);
        if (node) retainProjectionRoot(node, projectionRoots);
      }
      for (const program of programs) {
        if (!retainedPrograms.has(program.identity)) continue;
        const node = expressions.get(`${program.span.line}:${program.span.column}`);
        if (node) retainProjectionRoot(node, projectionRoots);
      }
      retainApplicationProjectionRoots(source, retainedApplications, projectionRoots);
      let retainedRoutes: ReadonlySet<string> | undefined;
      if (projection.kind === "route" || projection.kind === "document") {
        const routeParents = new Map(
          [...routeLocations.values()]
            .flat()
            .map(({ identity, parent }) => [identity, parent] as const),
        );
        const selectedRoutes = new Set<string>();
        if (projection.kind === "document") {
          for (const route of routes) {
            if (retainedPrograms.has(route.program)) selectedRoutes.add(route.identity);
          }
        } else {
          let current: string | undefined = projection.name;
          while (current && !selectedRoutes.has(current)) {
            selectedRoutes.add(current);
            current = routeParents.get(current);
          }
        }
        retainedRoutes = selectedRoutes;
        for (const route of routes) {
          if (!retainedPrograms.has(route.program)) continue;
          const node = objects.get(`${route.span.line}:${route.span.column}`);
          if (!node) {
            throw new Error(
              `${route.span.file}:${route.span.line}:${route.span.column}: ` +
                `Unable to isolate web Route ${JSON.stringify(route.identity)}.`,
            );
          }
          if (retainedRoutes.has(route.identity)) retainProjectionRoot(node, projectionRoots);
        }
      } else {
        for (const route of routes) {
          if (!retainedPrograms.has(route.program)) continue;
          const node = objects.get(`${route.span.line}:${route.span.column}`);
          if (!node) {
            throw new Error(
              `${route.span.file}:${route.span.line}:${route.span.column}: ` +
                `Unable to isolate web Route ${JSON.stringify(route.identity)}.`,
            );
          }
          replacements.push({ start: node.getStart(source), end: node.end, value: "{}" });
        }
      }
      for (const program of programs) {
        if (retainedPrograms.has(program.identity)) continue;
        const location = `${program.span.line}:${program.span.column}`;
        if (retainedProgramSpans.has(location)) continue;
        const node = expressions.get(location);
        if (!node) {
          throw new Error(
            `${program.span.file}:${program.span.line}:${program.span.column}: ` +
              `Unable to isolate Program ${JSON.stringify(program.identity)}.`,
          );
        }
        replacements.push({ start: node.getStart(source), end: node.end, value: "{}" });
      }
      if (projection.kind === "route" || projection.kind === "document") {
        for (const program of programs) {
          if (!retainedPrograms.has(program.identity)) continue;
          const node = expressions.get(`${program.span.line}:${program.span.column}`);
          if (!node || !ts.isObjectLiteralExpression(node)) continue;
          projectRouteProgramObject(
            source,
            node,
            program.feature,
            retainedRoutes ?? new Set(),
            projection.kind === "route",
            replacements,
          );
        }
      }
      for (const [feature, node] of projectedFeatureObjects(
        expressions,
        programs,
        retainedPrograms,
      )) {
        projectObjectProperty(
          source,
          node,
          "features",
          (name) => retainedFeatures.has(`${feature}.${name}`),
          replacements,
        );
        projectObjectProperty(
          source,
          node,
          "providers",
          (name) => retainedPlatforms.has(name),
          replacements,
        );
      }
      const retainedRoots = new Set(
        [...retainedFeatures].filter((feature) => !feature.includes(".")),
      );
      for (const node of systemDefinitionObjects(source)) {
        projectObjectProperty(
          source,
          node,
          "features",
          (name) => retainedRoots.has(name),
          replacements,
        );
        projectObjectProperty(
          source,
          node,
          "applications",
          (name) => retainedApplications.has(name),
          replacements,
        );
      }
      markFrameworkFactoriesPure(source, replacements);
      if (!replacements.length) return;
      let transformed = code;
      const unique = [
        ...new Map(
          replacements.map((replacement) => [
            `${replacement.start}:${replacement.end}`,
            replacement,
          ]),
        ).values(),
      ];
      for (const replacement of unique.sort((left, right) => right.start - left.start)) {
        transformed = `${transformed.slice(0, replacement.start)}${replacement.value}${transformed.slice(replacement.end)}`;
      }
      const result: Readonly<{ code: string; map: null }> = {
        code: pruneProjectionImports(
          pruneProjectionDeclarations(
            transformed,
            id,
            projectionRoots,
            insideSourceRoot(id, canonicalSourcePath(paths.source)) &&
              (routes.length > 0 || programs.length > 0),
          ),
          id,
        ),
        map: null,
      };
      if (projectionCacheKey) projectionCache.set(projectionCacheKey, result);
      return result;
    },
  };
}

function projectedFeaturePaths(
  ir: SystemIR,
  programs: ReadonlySet<string>,
  applications: ReadonlySet<string>,
): ReadonlySet<string> {
  const retained = new Set([
    ...ir.programs
      .filter(({ name }) => programs.has(name))
      .flatMap(({ contributions }) => contributions.map(({ feature }) => feature)),
    ...ir.interfaces
      .filter(({ app }) => applications.has(app))
      .flatMap(({ features }) => Object.values(features)),
  ]);
  for (const feature of retained) {
    const segments = feature.split(".");
    while (segments.length > 1) {
      segments.pop();
      retained.add(segments.join("."));
    }
  }
  return retained;
}

function projectedRouteFeaturePaths(
  routes: ReadonlyMap<string, readonly Readonly<{ feature: string; identity: string }>[]>,
  identity: string,
): ReadonlySet<string> {
  const retained = new Set(
    [...routes.values()]
      .flat()
      .filter((route) => route.identity === identity)
      .map(({ feature }) => feature),
  );
  for (const feature of retained) {
    const segments = feature.split(".");
    while (segments.length > 1) {
      segments.pop();
      retained.add(segments.join("."));
    }
  }
  return retained;
}

function projectedApplications(ir: SystemIR, programs: ReadonlySet<string>): ReadonlySet<string> {
  const interfaces = new Set(
    ir.programs
      .filter(({ name }) => programs.has(name))
      .flatMap(({ interface: owner }) => (owner ? [owner] : [])),
  );
  return new Set(ir.interfaces.filter(({ path }) => interfaces.has(path)).map(({ app }) => app));
}

function projectedFeatureObjects(
  expressions: ReadonlyMap<string, ts.Expression>,
  programs: readonly Readonly<{
    feature: string;
    identity: string;
    span: ProgramIR["contributions"][number]["span"];
  }>[],
  retainedPrograms: ReadonlySet<string>,
): ReadonlyMap<string, ts.ObjectLiteralExpression> {
  const features = new Map<string, ts.ObjectLiteralExpression>();
  for (const program of programs) {
    if (!retainedPrograms.has(program.identity)) continue;
    const expression = expressions.get(`${program.span.line}:${program.span.column}`);
    if (!expression) continue;
    let current: ts.Node | undefined = expression;
    while (current) {
      if (ts.isObjectLiteralExpression(current) && objectProperty(current, "programs")) {
        features.set(program.feature, current);
        break;
      }
      current = current.parent;
    }
  }
  return features;
}

function systemDefinitionObjects(source: ts.SourceFile): readonly ts.ObjectLiteralExpression[] {
  const definitions: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createSystem" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      definitions.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return definitions;
}

function retainApplicationProjectionRoots(
  source: ts.SourceFile,
  applications: ReadonlySet<string>,
  roots: Set<string>,
): void {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && applications.has(declaration.name.text)) {
        retainProjectionRoot(declaration, roots);
      }
    }
  }
}

function projectObjectProperty(
  source: ts.SourceFile,
  owner: ts.ObjectLiteralExpression,
  name: string,
  retain: (name: string) => boolean,
  replacements: Array<Readonly<{ start: number; end: number; value: string }>>,
): void {
  const property = objectProperty(owner, name);
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return;
  const properties = property.initializer.properties.filter((candidate) => {
    const key = objectPropertyName(candidate.name);
    return key === undefined || retain(key);
  });
  if (properties.length === property.initializer.properties.length) return;
  const projected = ts.factory.updateObjectLiteralExpression(property.initializer, properties);
  replacements.push({
    start: property.initializer.getStart(source),
    end: property.initializer.end,
    value: ts.createPrinter().printNode(ts.EmitHint.Expression, projected, source),
  });
}

function projectRouteProgramObject(
  source: ts.SourceFile,
  owner: ts.ObjectLiteralExpression,
  feature: string,
  retainedRoutes: ReadonlySet<string>,
  routesOnly: boolean,
  replacements: Array<Readonly<{ start: number; end: number; value: string }>>,
): void {
  const routeProperty = objectProperty(owner, "routes");
  if (!routeProperty || !ts.isObjectLiteralExpression(routeProperty.initializer)) return;
  const routes = routeProperty.initializer.properties.filter((candidate) => {
    const name = objectPropertyName(candidate.name);
    return name === undefined || retainedRoutes.has(`${feature}.${name}`);
  });
  const projectedRoutes = ts.factory.updateObjectLiteralExpression(
    routeProperty.initializer,
    routes,
  );
  if (!routesOnly && routes.length === routeProperty.initializer.properties.length) return;
  const projectedRoute = ts.factory.updatePropertyAssignment(
    routeProperty,
    routeProperty.name,
    projectedRoutes,
  );
  const projected = ts.factory.updateObjectLiteralExpression(
    owner,
    routesOnly
      ? [projectedRoute]
      : owner.properties.map((property) =>
          property === routeProperty ? projectedRoute : property,
        ),
  );
  replacements.push({
    start: owner.getStart(source),
    end: owner.end,
    value: ts.createPrinter().printNode(ts.EmitHint.Expression, projected, source),
  });
}

function objectProperty(
  owner: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return owner.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && objectPropertyName(property.name) === name,
  );
}

function objectPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function markFrameworkFactoriesPure(
  source: ts.SourceFile,
  replacements: Array<Readonly<{ start: number; end: number; value: string }>>,
): void {
  const factories = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      (statement.moduleSpecifier.text !== "kit" &&
        !statement.moduleSpecifier.text.startsWith("kit/features/"))
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported.startsWith("create")) factories.add(element.name.text);
    }
  }
  if (!factories.size) return;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      factories.has(node.expression.text)
    ) {
      replacements.push({
        start: node.getStart(source),
        end: node.getStart(source),
        value: "/* @__PURE__ */ ",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function retainProjectionRoot(node: ts.Node, roots: Set<string>): void {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
  if (ts.isVariableStatement(current)) {
    for (const declaration of current.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) roots.add(declaration.name.text);
    }
  } else if (
    (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
    current.name
  ) {
    roots.add(current.name.text);
  }
}

function pruneProjectionDeclarations(
  code: string,
  id: string,
  roots: ReadonlySet<string> = new Set(),
  pruneExports = false,
): string {
  let transformed = code;
  for (;;) {
    const source = ts.createSourceFile(
      id,
      transformed,
      ts.ScriptTarget.Latest,
      true,
      id.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const factories = projectionFactoryNames(source);
    const removals: Array<Readonly<{ start: number; end: number }>> = [];
    const candidates: Array<Readonly<{ names: readonly string[]; statement: ts.Statement }>> = [];
    for (const statement of source.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text.endsWith("Fixture") &&
        hasExportModifier(statement)
      ) {
        removals.push({ start: statement.getStart(source), end: statement.end });
        continue;
      }
      if (hasExportModifier(statement) && !pruneExports) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        candidates.push({ names: [statement.name.text], statement });
        continue;
      }
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.length > 0 &&
        statement.declarationList.declarations.every(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            (!declaration.initializer ||
              pureProjectionInitializer(declaration.initializer, factories)),
        )
      ) {
        candidates.push({
          names: statement.declarationList.declarations.map(
            (declaration) => (declaration.name as ts.Identifier).text,
          ),
          statement,
        });
      }
    }
    const owners = new Map(
      candidates.flatMap((candidate) => candidate.names.map((name) => [name, candidate] as const)),
    );
    const referenced = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (
        ts.isTypeNode(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isImportDeclaration(node)
      ) {
        return;
      }
      if (ts.isIdentifier(node)) {
        const candidate = owners.get(node.text);
        if (
          candidate &&
          (node.getStart(source) < candidate.statement.getStart(source) ||
            node.end > candidate.statement.end)
        ) {
          referenced.add(node.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const candidate of candidates) {
      if (candidate.names.every((name) => !roots.has(name) && !referenced.has(name))) {
        removals.push({
          start: candidate.statement.getStart(source),
          end: candidate.statement.end,
        });
      }
    }
    if (!removals.length) return transformed;
    for (const removal of removals.sort((left, right) => right.start - left.start)) {
      transformed = `${transformed.slice(0, removal.start)}${transformed.slice(removal.end)}`;
    }
  }
}

function projectionFactoryNames(source: ts.SourceFile): ReadonlySet<string> {
  const factories = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported.startsWith("create")) factories.add(element.name.text);
    }
  }
  return factories;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword),
  );
}

function pureProjectionInitializer(
  expression: ts.Expression,
  factories: ReadonlySet<string>,
): boolean {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return pureProjectionInitializer(expression.expression, factories);
  }
  return (
    ts.isArrowFunction(expression) ||
    ts.isFunctionExpression(expression) ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression) ||
    ts.isLiteralExpression(expression) ||
    (ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      factories.has(expression.expression.text)) ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  );
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
    if (
      ts.isTypeNode(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isImportDeclaration(node)
    ) {
      return;
    }
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

/** @internal Restricts semantic projection to authored and reusable Feature sources. */
export function isProjectableSourceModule(id: string, source: string): boolean {
  const file = canonicalSourcePath(id);
  const sourceRoot = canonicalSourcePath(source);
  const sourceModule = /\.[cm]?[jt]sx?$/.test(file);
  if (insideSourceRoot(file, sourceRoot)) return sourceModule;
  const framework = canonicalSourcePath(resolve(import.meta.dirname, "../../.."));
  const features = canonicalSourcePath(resolve(framework, "features"));
  return insideSourceRoot(file, features) && sourceModule;
}

function insideSourceRoot(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}${sep}`);
}

function projectionSourceAliases(path: string): readonly string[] {
  const aliases = new Set([canonicalSourcePath(path)]);
  const marker = `${sep}dist${sep}source${sep}`;
  if (path.includes(marker)) {
    aliases.add(canonicalSourcePath(path.replace(marker, `${sep}src${sep}`)));
  }
  return [...aliases];
}

function sourceParameters(id: string): URLSearchParams {
  const source = projectedSourceSpecifier(id) ?? id;
  const query = source.indexOf("?");
  return new URLSearchParams(query < 0 ? "" : source.slice(query + 1));
}

function sourceProjection(
  id: string | undefined,
): Readonly<{ kind: "document" | "program" | "route"; name: string }> | undefined {
  if (!id) return undefined;
  const parameters = sourceParameters(id);
  const route = parameters.get("kit-route");
  if (route) return { kind: "route", name: route };
  const document = parameters.get("kit-document");
  if (document) return { kind: "document", name: document };
  const program = parameters.get("kit-program");
  return program ? { kind: "program", name: program } : undefined;
}

function routeSystemSpecifier(system: string, route: string): string {
  const parameters = new URLSearchParams({ "kit-route": route });
  return routeSourceId(system, parameters);
}

function programSystemSpecifier(system: string, program: string): string {
  const parameters = new URLSearchParams({ "kit-program": program });
  return routeSourceId(system, parameters);
}

function documentSystemSpecifier(system: string, program: string): string {
  return routeSourceId(system, new URLSearchParams({ "kit-document": program }));
}

function routeSourceId(id: string, parameters: URLSearchParams): string {
  for (const name of parameters.keys()) {
    if (name.startsWith("lang.")) parameters.delete(name);
  }
  const extension = id.match(/\.([cm]?[jt]sx?)$/)?.[1] ?? "ts";
  return `${id}?${parameters}&lang.${extension}`;
}

function projectedSourceId(id: string, parameters: URLSearchParams): string {
  return `${PROJECTED_SOURCE_PREFIX}${encodeURIComponent(routeSourceId(id, parameters))}`;
}

function projectedSourceSpecifier(id: string): string | undefined {
  if (!id.startsWith(PROJECTED_SOURCE_PREFIX)) return;
  return decodeURIComponent(id.slice(PROJECTED_SOURCE_PREFIX.length));
}

function projectedSourceFile(id: string): string | undefined {
  const source = projectedSourceSpecifier(id);
  return source ? canonicalSourcePath(cleanId(source)) : undefined;
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
  system: string;
  program: string;
  route: ReturnType<typeof collectWebRoutes>[number];
}): string {
  const system = routeSystemSpecifier(input.system, routeIdentity(input.route));
  return `import system from ${JSON.stringify(system)};

const [root, ...path] = ${JSON.stringify(input.route.feature.split(".").filter(Boolean))};
let feature = system.features?.[root];
for (const name of path) {
  feature = feature?.features?.[name];
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
    name: "kit-presentations",
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
    name: "kit-components",
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

function systemAliasPlugin(source: string): Plugin {
  const kit = resolve(import.meta.dirname, "../../..");
  return {
    name: "kit-system-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer ? cleanId(importer) : "";
      const root = owner.startsWith(`${kit}/`) && !owner.startsWith(`${source}/`) ? kit : source;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}

function developmentWebDiscoveryResources(
  prepared: PreparedInterface,
  origin: string,
): WebDiscoveryResources {
  const contract = webInterfaceContract(prepared.ir, prepared.interface);
  return renderWebDiscoveryResources(
    origin,
    contract.routes.map((route) => {
      const branch = webRouteBranch(contract.routes, route).map((entry) => ({
        route: entry,
        loader: Boolean(
          compiledWebRoute(prepared.ir, contract.uiProgram, entry)?.implementation.load,
        ),
      }));
      return Object.freeze({
        route,
        discovery: planWebRouteDiscovery(route, branch),
      });
    }),
  );
}

function developmentRequestOrigin(headers: IncomingHttpHeaders): string {
  const forwardedProtocol = firstRequestHeader(headers["x-forwarded-proto"])?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  const authority =
    firstRequestHeader(headers["x-forwarded-host"])?.split(",")[0]?.trim() ??
    firstRequestHeader(headers.host) ??
    "localhost";
  try {
    return new URL(`${protocol}://${authority}`).origin;
  } catch {
    return "http://localhost";
  }
}

function firstRequestHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function presentationContractPlugin(
  paths: SystemPaths,
  work: string,
  revisions: SystemRevisionSource,
  state: PreparedInterfaceState,
  serverOrigin?: string,
  programAttachments?: DevelopmentProgramAttachments,
  report?: DevelopmentReporter,
): Plugin {
  let prepared = state.current;
  let observedRevision = revisions.current.revision;
  let updates = Promise.resolve();
  const sourceSnapshots = new Map<string, string>();
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
    const changed = canonicalSourcePath(context.file);
    const previousSource = sourceSnapshots.get(changed);
    const currentSource = await context.read();
    sourceSnapshots.set(changed, currentSource);
    let modules: ModuleNode[] = [];
    updates = updates.then(async () => {
      try {
        const started = performance.now();
        const compilation = revisions.compile(context.file);
        const updateKind = presentationUpdate(context, prepared.presentationSources)
          ? webPresentationOnlyChange(prepared.ir, compilation.ir, prepared.interface)
            ? "presentation"
            : "full"
          : previousSource !== undefined &&
              webComponentViewSourceOnlyChange(previousSource, currentSource, changed)
            ? "view"
            : "full";
        if (compilation.revision === observedRevision) {
          modules = [];
          return;
        }
        observedRevision = compilation.revision;
        if (!compilation.change?.outputs.includes(prepared.interface)) {
          modules = [];
          return;
        }
        prepared = await prepareInterface(
          paths,
          work,
          prepared.interface,
          true,
          compilation,
          updateKind,
          prepared,
          serverOrigin,
        );
        state.current = prepared;
        responseCache.clear();
        const candidateModules = [
          ...(context.server.moduleGraph.getModulesByFile(prepared.candidate) ?? []),
        ];
        const invalidated = new Set<ModuleNode>();
        const timestamp = Date.now();
        for (const module of context.server.moduleGraph.idToModuleMap.values()) {
          if (module.id && projectedSourceFile(module.id) === changed) {
            context.server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
          }
        }
        for (const module of candidateModules) {
          context.server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
        }
        report?.({
          kind: "update",
          platform: "web",
          scope: "interface",
          mode: updateKind,
          outputs: Object.freeze([prepared.interface]),
          durationMs: performance.now() - started,
        });
        context.server.ws.send({
          type: "custom",
          event: "kit:update-kind",
          data: { kind: updateKind },
        });
        // The browser entry accepts the generated candidate, not arbitrary authored leaves.
        // Returning that boundary lets Vite replace Presentation modules without reloading.
        modules = candidateModules;
      } catch (error) {
        const diagnostic = {
          kind: "diagnostic",
          platform: "web",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        } as const;
        if (report) report(diagnostic);
        else context.server.config.logger.error(diagnostic.message);
        modules = [];
      }
    });
    await updates;
    return modules;
  };
  return {
    name: "kit-presentation-contract",
    async transform(_code, id) {
      const file = canonicalSourcePath(cleanId(id));
      if (sourceSnapshots.has(file) || !file.startsWith(paths.source) || file.startsWith(work)) {
        return;
      }
      try {
        sourceSnapshots.set(file, await readFile(file, "utf8"));
      } catch {}
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (state.current.crossOriginIsolated) {
          response.setHeader("cross-origin-embedder-policy", "require-corp");
          response.setHeader("cross-origin-opener-policy", "same-origin");
        }
        const location = new URL(request.url ?? "/", "http://kit.local");
        if (location.pathname.endsWith("/service-worker.generated.ts")) {
          response.setHeader("service-worker-allowed", "/");
          next();
          return;
        }
        if (location.pathname === "/robots.txt" || location.pathname === "/sitemap.xml") {
          if (request.method !== "GET" && request.method !== "HEAD") {
            response.statusCode = 405;
            response.setHeader("allow", "GET, HEAD");
            response.end();
            return;
          }
          const resources = developmentWebDiscoveryResources(
            prepared,
            developmentRequestOrigin(request.headers),
          );
          const robots = location.pathname === "/robots.txt";
          const body = robots ? resources.robots : resources.sitemap;
          response.statusCode = 200;
          response.setHeader("cache-control", "no-store");
          response.setHeader(
            "content-type",
            robots ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8",
          );
          response.setHeader("x-content-type-options", "nosniff");
          response.end(request.method === "HEAD" ? undefined : body);
          return;
        }
        if (location.pathname === WEB_MANIFEST_PATH) {
          const installation = webInterfaceContract(prepared.ir, prepared.interface).installation;
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
            const contract = webInterfaceContract(prepared.ir, prepared.interface);
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
                  programAttachments,
                  routeData,
                  markdown,
                  signal: controller.signal,
                }),
            );
            const result = cached.value;
            response.setHeader("x-kit-cache", cached.status);
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
              server.config.logger.warn(`[kit] invalid web request: ${error.message}`);
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
  paths: SystemPaths;
  prepared: PreparedInterface;
  contract: ReturnType<typeof webInterfaceContract>;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  location: URL;
  match: WebRouteMatch<WebRouteIR>;
  programAttachments?: DevelopmentProgramAttachments;
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
  let status: WebRouteStatus = route.status as WebRouteStatus;
  const branchMatches = matchWebRouteBranch(input.contract.routes, input.match, input.location);
  const staticMetadata = branchMatches.reduce<WebRouteMetadataResult>(
    (result, entry) => Object.freeze({ ...result, ...entry.route.metadata }),
    {},
  );
  const title = staticMetadata.title ?? input.contract.applicationName;
  const metadata = routeDocumentMetadata(staticMetadata);
  let document: WebDocumentIR;
  let markdownAllowed = !staticMetadata.robots
    ?.split(",")
    .some((value) => value.trim() === "noindex");
  let hydrationBranch: NonNullable<WebRouteHydrationIR["branch"]> = Object.freeze(
    branchMatches.map((entry) =>
      Object.freeze({
        route: Object.freeze({ feature: entry.route.feature, name: entry.route.name }),
        params: Object.freeze({ ...entry.params }),
        search: Object.freeze({ ...entry.search }),
        status: entry.route.status,
        loader: false,
        metadata: entry.route.metadata,
      }),
    ),
  );
  let deferredFrames: AsyncIterable<ReturnType<typeof renderWebDeferredFrame>> | undefined;
  let deferredRecords: AsyncIterable<string> | undefined;
  if (route.document === "shell") {
    if (input.routeData) return unavailableWebRepresentation("Route state");
    document = withWebStyles(
      prepareClientWebDocument({
        title,
        language: staticMetadata.language,
        metadata,
        entry: "/browser.generated.ts",
      }),
    );
  } else {
    const evaluatorPath = input.prepared.documentEvaluator;
    if (!evaluatorPath) throw new Error("Development web document evaluator is unavailable.");
    const evaluator = (await input.server.ssrLoadModule(
      `${evaluatorPath}?kit-revision=${input.prepared.revision}`,
    )) as {
      system?: unknown;
      prepare?(input: Readonly<Record<string, unknown>>): Promise<WebDocumentIR>;
    };
    const system = record(evaluator.system);
    if (typeof evaluator.prepare !== "function") {
      throw new Error("Development web document evaluator has no prepare function.");
    }
    const program = input.prepared.ir.programs.find(
      ({ name }) => name === input.contract.uiProgram,
    );
    if (!program)
      throw new Error(`Missing UI Program ${JSON.stringify(input.contract.uiProgram)}.`);
    const resolvedBranch: Array<
      Readonly<{
        match: (typeof branchMatches)[number];
        definition: RuntimeWebRoute;
        data: unknown;
        metadata: WebRouteMetadataResult;
        status: WebRouteStatus;
      }>
    > = [];
    for (const match of branchMatches) {
      const definition = runtimeWebRoute(system, program.logicalName, match.route);
      if (
        definition.load &&
        (match.route.cache === false || match.route.cache.scope !== "public")
      ) {
        markdownAllowed = false;
      }
      const loaded = definition.load
        ? await loadDevelopmentWebRoute(input, routeIdentity(match.route), match)
        : { data: undefined };
      const outcome = validateDevelopmentLoaderOutcome(
        loaded,
        Boolean(definition.load),
        match.route.status,
      );
      if (outcome.kind === "redirect") {
        const location = resolveWebDestination(
          input.contract.routes,
          outcome.redirect as Parameters<typeof resolveWebDestination>[1],
          match.route.feature,
        );
        return {
          status: input.routeData ? 200 : outcome.status,
          headers: {
            "cache-control": "no-store",
            ...(input.routeData ? { "content-type": WEB_ROUTE_DATA_MEDIA_TYPE } : { location }),
          },
          body: input.routeData ? JSON.stringify({ version: 1, redirect: location }) : "",
        };
      }
      if (outcome.explicitStatus) status = outcome.status;
      resolvedBranch.push(
        Object.freeze({
          match,
          definition,
          data: outcome.data,
          status: outcome.status,
          metadata: Object.freeze({
            ...match.route.metadata,
            ...outcome.metadata,
          }),
        }),
      );
    }
    const leaf = resolvedBranch.at(-1)!;
    const definition = leaf.definition;
    const data = leaf.data;
    if (
      input.routeData &&
      !route.params.length &&
      !route.search.length &&
      !resolvedBranch.some((entry) => Boolean(entry.definition.load))
    ) {
      return unavailableWebRepresentation("Route state");
    }
    const routeMetadata = Object.freeze(
      resolvedBranch.reduce<WebRouteMetadataResult>(
        (result, entry) => ({ ...result, ...entry.metadata }),
        {},
      ),
    );
    hydrationBranch = Object.freeze(
      resolvedBranch.map((entry) =>
        Object.freeze({
          route: Object.freeze({
            feature: entry.match.route.feature,
            name: entry.match.route.name,
          }),
          params: Object.freeze({ ...entry.match.params }),
          search: Object.freeze({ ...entry.match.search }),
          status: entry.status,
          loader: entry.definition.load ? Object.freeze({ data: entry.data }) : false,
          metadata: entry.metadata,
        }),
      ),
    );
    document = await evaluator.prepare({
      program: input.contract.uiProgram,
      logicalProgram: program.logicalName,
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
        status,
        data,
        metadata: routeMetadata,
        branch: resolvedBranch.map((entry) => ({
          feature: entry.match.route.feature,
          name: entry.match.route.name,
          params: entry.match.params,
          search: entry.match.search,
          status: entry.status,
          data: entry.data,
          metadata: entry.metadata,
        })),
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
          status,
          loader: definition.load ? Object.freeze({ data }) : false,
          branch: hydrationBranch,
          metadata: webRouteHydrationMetadata(document),
        }),
      }),
    );
    if (resolvedBranch.some((entry) => entry.match.route.deferred.length)) {
      const compiledBranch = resolvedBranch.map((entry) => {
        const view = compiledWebRoute(
          input.prepared.ir,
          input.contract.uiProgram,
          entry.match.route,
        )?.implementation.view;
        if (!view) {
          throw new TypeError(
            `Deferred web Route branch ${routeIdentity(route)} has no compiler-readable view ` +
              `for ${routeIdentity(entry.match.route)}.`,
          );
        }
        return Object.freeze({ entry, view });
      });
      const compiled = compiledBranch.at(-1)!.view;
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
        branch: compiledBranch.map(({ entry, view }) => ({
          route: {
            feature: entry.match.route.feature,
            name: entry.match.route.name,
          },
          view,
          params: entry.match.params,
          search: entry.match.search,
          status: entry.status,
          loader: entry.definition.load ? { data: entry.data } : false,
          deferred: entry.match.route.deferred,
          metadata: entry.metadata,
        })),
        signal: input.signal,
      });
      document = stream.document;
      if (document.hydration !== false) {
        hydrationBranch = document.hydration.branch ?? hydrationBranch;
      }
      deferredFrames = mapAsyncIterable(stream.frames, renderWebDeferredFrame);
      deferredRecords = mapAsyncIterable(stream.frames, (frame) => `${JSON.stringify(frame)}\n`);
    }
  }
  if (input.contract.installation) {
    document = withWebInstallation(document, input.contract.installation);
  }
  const hydration =
    document.hydration === false
      ? {
          version: 1 as const,
          route: { feature: route.feature, name: route.name },
          location: `${input.location.pathname}${input.location.search}`,
          params: input.match.params,
          search: input.match.search,
          status,
          loader: false as const,
          branch: hydrationBranch,
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
      return unavailableWebRepresentation("Public Markdown");
    }
    if (deferredFrames) {
      return unavailableWebRepresentation("Streamed Markdown");
    }
    return {
      status,
      headers: {
        "cache-control": webRouteCacheControl(route.cache),
        "content-type": `${WEB_MARKDOWN_MEDIA_TYPE}; charset=utf-8`,
        vary: "Accept",
      },
      body: renderWebMarkdown(document),
    };
  }
  document = applyDevelopmentWebDocumentDelivery(document, input.prepared, route);
  const html = await input.server.transformIndexHtml(
    input.location.pathname,
    renderWebDocument(document),
  );
  if (deferredFrames) {
    const boundary = html.lastIndexOf("</body>");
    if (boundary < 0) throw new TypeError("Streamed web document has no body terminator.");
    return {
      status,
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
    status,
    headers: {
      "cache-control": webRouteCacheControl(route.cache),
      "content-type": "text/html; charset=utf-8",
      vary: "Accept",
    },
    body: html,
  };
}

function applyDevelopmentWebDocumentDelivery(
  document: WebDocumentIR,
  prepared: PreparedInterface,
  route: WebRouteIR,
): WebDocumentIR {
  const scripts = Object.freeze(
    prepared.serviceWorkerBootstrap ? ["/service-worker-bootstrap.generated.ts"] : [],
  );
  if (webRouteRequiresClientRuntime(prepared.ir, prepared.interface, route)) {
    return Object.freeze({ ...document, scripts });
  }
  return Object.freeze({
    ...document,
    rendering: "static",
    entry: false,
    preloads: Object.freeze([]),
    scripts,
    hydration: false,
  });
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
  system: Readonly<Record<string, unknown>>,
  program: string,
  route: ReturnType<typeof collectWebRoutes>[number],
): RuntimeWebRoute {
  let feature: unknown = system;
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
    paths: SystemPaths;
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    location: URL;
    programAttachments?: DevelopmentProgramAttachments;
  }>,
  route: string,
  match: WebRouteMatch<WebRouteIR>,
): Promise<unknown> {
  if (!input.programAttachments) {
    throw new Error(
      `Development SSR for web Route ${JSON.stringify(route)} requires the server and web ` +
        "Platform Adapters to share a loader registry.",
    );
  }
  return input.programAttachments.invoke(input.paths.directory, {
    export: route,
    value: {
      route,
      ...(match.route.cache !== false && match.route.cache.scope === "public"
        ? {}
        : {
            request: {
              url: input.location.href,
              headers: normalizeWebRequestHeaders(input.headers),
            },
          }),
      params: match.params,
      search: match.search,
    },
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

type DevelopmentLoaderOutcome =
  | Readonly<{
      kind: "data";
      data: unknown;
      metadata: WebRouteMetadataResult;
      status: WebRouteStatus;
      explicitStatus: boolean;
    }>
  | Readonly<{
      kind: "redirect";
      redirect: unknown;
      status: WebRedirectStatus;
    }>;

function validateDevelopmentLoaderOutcome(
  value: unknown,
  loader: boolean,
  defaultStatus: number,
): DevelopmentLoaderOutcome {
  if (!loader) {
    if (!isWebRouteStatus(defaultStatus)) throw new TypeError("Web Route status is invalid.");
    return {
      kind: "data",
      data: undefined,
      metadata: {},
      status: defaultStatus,
      explicitStatus: false,
    };
  }
  if (!isRecordValue(value)) {
    throw new TypeError("Web Route loader outcome must be an object.");
  }
  const hasData = Object.hasOwn(value, "data");
  const hasRedirect = Object.hasOwn(value, "redirect");
  if (hasData === hasRedirect) {
    throw new TypeError("Web Route loader must return exactly one of data or redirect.");
  }
  if (
    Object.keys(value).some((name) => !["data", "metadata", "redirect", "status"].includes(name))
  ) {
    throw new TypeError("Web Route loader outcome has unsupported fields.");
  }
  const metadata = loaderMetadata(value);
  if (hasRedirect) {
    const status = value.status ?? 302;
    if (!isWebRedirectStatus(status)) {
      throw new TypeError("Web Route redirect status is invalid.");
    }
    return { kind: "redirect", redirect: value.redirect, status };
  }
  const status = value.status ?? defaultStatus;
  if (!isWebRouteStatus(status)) {
    throw new TypeError("Web Route document status is invalid.");
  }
  return {
    kind: "data",
    data: value.data,
    metadata,
    status,
    explicitStatus: value.status !== undefined,
  };
}

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unavailableWebRepresentation(name: string): Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}> {
  return Object.freeze({
    status: 406,
    headers: Object.freeze({
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      vary: "Accept",
    }),
    body: `${name} is not available for this Route.\n`,
  });
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

function webPresentationOnlyChange(
  previous: SystemIR,
  current: SystemIR,
  interfacePath: string,
): boolean {
  const presentationMeaning = (ir: SystemIR) => {
    const interface_ = ir.interfaces.find(({ path }) => path === interfacePath);
    return interface_
      ? (webInterfaceCompilerIR(interface_.extensions?.web).presentations ?? [])
      : [];
  };
  if (
    JSON.stringify(presentationMeaning(previous)) === JSON.stringify(presentationMeaning(current))
  ) {
    return false;
  }
  const withoutPresentations = (ir: SystemIR): unknown => ({
    ...ir,
    interfaces: ir.interfaces.map((interface_) => {
      if (interface_.path !== interfacePath || !interface_.extensions?.web) return interface_;
      const { presentations: _presentations, ...web } = webInterfaceCompilerIR(
        interface_.extensions.web,
      );
      return {
        ...interface_,
        extensions: {
          ...interface_.extensions,
          web,
        },
      };
    }),
  });
  return (
    JSON.stringify(withoutPresentations(previous)) === JSON.stringify(withoutPresentations(current))
  );
}

function webComponentViewSourceOnlyChange(
  previous: string,
  current: string,
  file: string,
): boolean {
  if (previous === current) return false;
  const mask = (sourceText: string): string => {
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const ranges: Array<Readonly<{ start: number; end: number }>> = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        objectPropertyName(node.name) === "components" &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const component of node.initializer.properties) {
          if (
            !ts.isPropertyAssignment(component) ||
            !ts.isObjectLiteralExpression(component.initializer)
          ) {
            continue;
          }
          for (const member of component.initializer.properties) {
            if (objectPropertyName(member.name) !== "view") continue;
            if (ts.isMethodDeclaration(member) && member.body) {
              ranges.push({ start: member.body.getStart(source), end: member.body.end });
            } else if (ts.isPropertyAssignment(member)) {
              ranges.push({
                start: member.initializer.getStart(source),
                end: member.initializer.end,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    let masked = sourceText;
    for (const range of ranges.sort((left, right) => right.start - left.start)) {
      masked = `${masked.slice(0, range.start)}__KIT_COMPONENT_VIEW__${masked.slice(range.end)}`;
    }
    return masked;
  };
  return mask(previous) === mask(current);
}

async function prepareProductionDocuments(
  paths: SystemPaths,
  work: string,
  ir: SystemIR,
  interfaceId: string,
  components: readonly CompiledWebComponentIR[],
  presentationAssets: ProductionPresentationAssets,
  report?: ProductionReporter,
): Promise<PreparedProductionDocuments> {
  const contract = webInterfaceContract(ir, interfaceId);
  const program = ir.programs.find(({ name }) => name === contract.uiProgram);
  if (!program) throw new Error(`Missing UI Program ${JSON.stringify(contract.uiProgram)}.`);
  const entries = contract.routes.map((route) => {
    const branch = webRouteBranch(contract.routes, route);
    const request = requestRouteArtifact(route, branch, ir, contract.uiProgram, components);
    validateProductionWebRoute(route, {
      hasLoader: branch.some((entry) =>
        Boolean(compiledWebRoute(ir, contract.uiProgram, entry)?.implementation.load),
      ),
      request,
    });
    return { route, request };
  });
  const staticRoutes = entries
    .filter(({ request }) => request === false)
    .map(({ route }) => {
      const branch = webRouteBranch(contract.routes, route);
      return Object.freeze({
        route,
        branch,
        metadata: Object.freeze(
          branch.reduce<WebRouteMetadataResult>(
            (result, entry) => ({ ...result, ...entry.metadata }),
            {},
          ),
        ),
      });
    });
  const presentationTargets = requestRenderedPresentationTargets(entries, components);
  const source = resolve(work, "document.generated.ts");
  const staticDocuments = new Map<string, WebDocumentIR>();
  let initialPresentation: PreparedProductionDocuments["presentation"] = Object.freeze({
    components: Object.freeze({}),
    styles: Object.freeze([]),
  });
  if (staticRoutes.length || contract.routes.length === 0 || presentationTargets.length) {
    await writeIfChanged(
      source,
      `import system from ${JSON.stringify(paths.system)};
import { prepareClientWebDocument, prepareInitialWebPresentation, prepareWebDocument } from ${JSON.stringify(resolve(import.meta.dirname, `document${moduleExtension()}`))};

const application = system.applications?.[${JSON.stringify(contract.interface.app)}];
const interfaceDefinition =
  application?.interfaces?.[${JSON.stringify(contract.interface.path.slice(contract.interface.app.length + 1))}];
if (!interfaceDefinition?.presentation) {
  throw new Error(${JSON.stringify(`Web interface ${contract.interface.path} has no Presentation.`)});
}
const routes = ${JSON.stringify(staticRoutes)};
const documents = await Promise.all((routes.length ? routes : ${contract.routes.length ? "[]" : "[undefined]"}).map(async (entry) => ({
  route: entry?.route,
  document: entry?.route.document === "shell"
    ? prepareClientWebDocument({
        title: entry.metadata?.title ?? ${JSON.stringify(contract.applicationName)},
        language: entry.metadata?.language,
        metadata: Object.fromEntries(Object.entries(entry.metadata ?? {}).filter(([name]) => name !== "title" && name !== "language")),
        entry: "/app.js",
      })
    : await prepareWebDocument({
        system,
        interface: ${JSON.stringify(contract.interface.path)},
        applicationName: ${JSON.stringify(contract.applicationName)},
        features: ${JSON.stringify(contract.interface.features)},
        program: ${JSON.stringify(contract.uiProgram)},
        logicalProgram: ${JSON.stringify(program.logicalName)},
        presentation: interfaceDefinition.presentation,
        routes: ${JSON.stringify(contract.routes)},
        manifest: ${JSON.stringify(collectProgramManifest(program))},
        components: ${JSON.stringify(contract.components)},
        presentationDependencies: ${JSON.stringify(collectPresentationDependencies(ir, contract.uiProgram))},
        ...(entry ? { route: {
          feature: entry.route.feature,
          name: entry.route.name,
          status: entry.route.status,
          metadata: entry.metadata,
          params: {},
          search: {},
          branch: entry.branch.map((route) => ({
            feature: route.feature,
            name: route.name,
            status: route.status,
            metadata: route.metadata,
            params: {},
            search: {},
          })),
        } } : {}),
        entry: "/app.js",
      }),
})));
const presentation = await prepareInitialWebPresentation({
  system,
  interface: ${JSON.stringify(contract.interface.path)},
  features: ${JSON.stringify(contract.interface.features)},
  program: ${JSON.stringify(contract.uiProgram)},
  logicalProgram: ${JSON.stringify(program.logicalName)},
  presentation: interfaceDefinition.presentation,
  manifest: ${JSON.stringify(collectProgramManifest(program))},
  components: ${JSON.stringify(contract.components)},
  targets: ${JSON.stringify(presentationTargets)},
  presentationDependencies: ${JSON.stringify(collectPresentationDependencies(ir, contract.uiProgram))},
});
export default { documents, presentation };
`,
    );
    const output = resolve(work, "document-evaluate");
    await rm(output, { recursive: true, force: true });
    await build({
      configFile: false,
      logLevel: "silent",
      customLogger: viteReporter(report),
      root: paths.directory,
      resolve: {
        alias: packageSourceAliases(),
        conditions: ["source", ...defaultServerConditions],
      },
      plugins: vitePlugins(paths, undefined, presentationAssets),
      build: {
        emptyOutDir: true,
        minify: false,
        outDir: output,
        rolldownOptions: {
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
      default?: Readonly<{
        documents: readonly Readonly<{
          route?: ReturnType<typeof collectWebRoutes>[number];
          document: WebDocumentIR;
        }>[];
        presentation: PreparedProductionDocuments["presentation"];
      }>;
    };
    const documents = loaded.default?.documents;
    if (!documents) throw new Error("Web document preparation returned no artifact.");
    for (const { route, document } of documents) {
      staticDocuments.set(routeIdentity(route), withWebStyles(document));
    }
    initialPresentation = loaded.default!.presentation;
  }
  if (!contract.routes.length) {
    const route = fallbackWebRoute();
    const document = staticDocuments.get(routeIdentity(undefined));
    if (!document) throw new Error("Web root document preparation returned no artifact.");
    return Object.freeze({
      routes: Object.freeze([
        Object.freeze({
          route,
          document: contract.installation
            ? withWebInstallation(document, contract.installation)
            : document,
          request: false,
        }),
      ]),
      presentation: initialPresentation,
    });
  }
  const routes = entries.map(({ route, request }) => {
    const document =
      request === false
        ? staticDocuments.get(routeIdentity(route))
        : dynamicRouteDocument(
            webRouteBranch(contract.routes, route),
            initialPresentation.styles,
            contract.applicationName,
          );
    if (!document) {
      throw new Error(`Web Route ${JSON.stringify(routeIdentity(route))} produced no document.`);
    }
    return Object.freeze({
      route,
      document: contract.installation
        ? withWebInstallation(document, contract.installation)
        : document,
      request,
    });
  });
  return Object.freeze({ routes: Object.freeze(routes), presentation: initialPresentation });
}

function requestRenderedPresentationTargets(
  entries: readonly Readonly<{
    route: ReturnType<typeof collectWebRoutes>[number];
    request: PreparedRouteDocument["request"];
  }>[],
  components: readonly CompiledWebComponentIR[],
): readonly string[] {
  const targets = new Set<string>();
  for (const { route, request } of entries) {
    if (request === false) continue;
    for (const entry of request.branch) {
      for (const component of compiledComponentClosure(
        routeIdentity(route),
        entry.view,
        components,
      )) {
        targets.add(runtimeComponentName(component.feature, component.name));
      }
    }
  }
  return Object.freeze([...targets].sort());
}

function requestRouteArtifact(
  route: ReturnType<typeof collectWebRoutes>[number],
  branch: readonly ReturnType<typeof collectWebRoutes>[number][],
  ir: SystemIR,
  program: string,
  components: readonly CompiledWebComponentIR[],
): PreparedRouteDocument["request"] {
  const compiled = branch.map((entry) => ({
    route: entry,
    compiled: compiledWebRoute(ir, program, entry),
  }));
  if (
    route.document !== "content" ||
    (!route.params.length &&
      !route.search.length &&
      !compiled.some(({ compiled: entry }) => Boolean(entry?.implementation.load)))
  ) {
    return false;
  }
  const entries = compiled.map(({ route: entry, compiled: implementation }) => {
    if (!implementation) {
      throw new Error(
        `Request-dependent web Route ${routeIdentity(route)} has no compiler-readable ` +
          `view for branch Route ${routeIdentity(entry)}.`,
      );
    }
    validateRequestRenderClosure(
      routeIdentity(route),
      implementation.implementation.view,
      components,
    );
    return Object.freeze({
      route: entry,
      loader: Boolean(implementation.implementation.load),
      view: implementation.implementation.view,
    });
  });
  return Object.freeze({
    branch: Object.freeze(entries),
  });
}

function validateRequestRenderClosure(
  route: string,
  view: WebRenderNodeIR,
  components: readonly CompiledWebComponentIR[],
): void {
  compiledComponentClosure(route, view, components);
}

function compiledComponentClosure(
  route: string,
  view: WebRenderNodeIR,
  components: readonly CompiledWebComponentIR[],
): readonly CompiledWebComponentIR[] {
  const resolveComponent = createCompiledWebComponentResolver(components);
  const pending = [...renderComponentTargets(view)];
  const visited = new Set<string>();
  const result: CompiledWebComponentIR[] = [];
  while (pending.length) {
    const identity = pending.pop()!;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const component = resolveComponent(identity);
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
    result.push(component);
    pending.push(...renderComponentTargets(component.view));
  }
  return Object.freeze(result);
}

function renderComponentTargets(node: WebRenderNodeIR): readonly string[] {
  switch (node.kind) {
    case "none":
    case "text":
    case "children":
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
  branch: readonly ReturnType<typeof collectWebRoutes>[number][],
  presentationStyles: readonly string[],
  applicationName: string,
): WebDocumentIR {
  const metadata = branch.reduce<WebRouteMetadataResult>(
    (result, entry) => ({ ...result, ...entry.metadata }),
    {},
  );
  return withWebStyles(
    Object.freeze({
      ...prepareClientWebDocument({
        title: metadata.title ?? applicationName,
        language: metadata.language,
        metadata: routeDocumentMetadata(metadata),
        entry: "/app.js",
      }),
      styles: presentationStyles,
      rendering: "hydrate" as const,
    }),
  );
}

function fallbackWebRoute(): ReturnType<typeof collectWebRoutes>[number] {
  return {
    feature: "",
    name: "root",
    path: "/",
    status: 200,
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
    `@layer kit.reset,kit.presentation;@layer kit.reset{${webResetCss}}` +
    `@layer kit.presentation{${document.styles.join("")}}`;
  return Object.freeze({ ...document, styles: Object.freeze([stylesheet]) });
}

function withWebInstallation(
  document: WebDocumentIR,
  installation: WebInstallationPlan,
): WebDocumentIR {
  const icons =
    document.metadata.icons?.length || !installation.icons.length
      ? document.metadata.icons
      : installation.icons.slice(0, 1).map(({ src, sizes, type }) =>
          Object.freeze({
            url: src,
            sizes,
            ...(type ? { type } : {}),
          }),
        );
  return Object.freeze({
    ...document,
    metadata: Object.freeze({
      ...document.metadata,
      ...(icons ? { icons: Object.freeze(icons) } : {}),
      manifest: WEB_MANIFEST_PATH,
    }),
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

function featureProviders(
  ir: SystemIR,
  program: ProgramIR,
): readonly Pick<SelectedDependencyProviderIR, "dependency" | "feature" | "platform">[] {
  return selectDependencyProviders(
    ir,
    program,
    linkProgram(program).external.map(({ name }) => name),
  ).map(({ dependency, feature, platform }) => ({ dependency, feature, platform }));
}

function workerSource(input: {
  system: string;
  development: boolean;
  serverOrigin?: string;
  host: string;
  runtime: string;
  processRuntime: string;
  program: ProgramIR;
  manifest: ProgramManifest;
  dependencies: readonly string[];
  providers: readonly Pick<SelectedDependencyProviderIR, "dependency" | "feature" | "platform">[];
}): string {
  const system = programSystemSpecifier(input.system, input.program.name);
  const serviceWorker = input.program.environment.name === "browser-service-worker";
  const lifecycle = serviceWorker
    ? `const programs = globalThis.__kitServiceWorkerPrograms ??= [];
programs.push(ready);`
    : `let disposed = false;
addEventListener("message", (event) => {
  if (event.data !== "kit:dispose" || disposed) return;
  disposed = true;
  void ready
    .then((process) => process.dispose())
    .catch((error) => console.error("[kit] Browser worker disposal failed", error))
    .finally(() => {
      event.ports[0]?.postMessage("kit:disposed");
      close();
    });
});`;
  const start = serviceWorker
    ? `globalThis.__kitServiceWorkerSubscriptions ??= new Set();
const manifest = ${JSON.stringify(input.manifest)};
const ready = createWebHost({
  dependencies: externalContracts(manifest, ${JSON.stringify(input.dependencies)}),
	  providers: ${JSON.stringify(input.providers)},
	  system,
	  context: "service-worker",
	}).then((dependencies) => startProcess(
  system,
  ${JSON.stringify(input.program.name)},
	  dependencies,
	  manifest,
	  webProgramLanguageRuntime,
	  ${JSON.stringify(input.program.logicalName)},
	));`
    : `const manifest = ${JSON.stringify(input.manifest)};
const dependencies = await createWebHost({
  dependencies: externalContracts(manifest, ${JSON.stringify(input.dependencies)}),
	  providers: ${JSON.stringify(input.providers)},
	  system,
	  context: "worker",
	});
const ready = startProcess(
  system,
  ${JSON.stringify(input.program.name)},
	  dependencies,
	  manifest,
	  webProgramLanguageRuntime,
	  ${JSON.stringify(input.program.logicalName)},
	);`;
  return `import system from ${JSON.stringify(system)};
	import { createWebHost } from ${JSON.stringify(input.host)};
	import { webProgramLanguageRuntime } from ${JSON.stringify(input.runtime)};
	import { startProcess } from ${JSON.stringify(input.processRuntime)};

const externalContracts = (manifest, names) => {
  const requested = new Set(names);
  return manifest.bindings.filter(({ name }) => requested.has(name));
};

${start}
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

/** @internal Emits the minimal non-UI bootstrap used by installable static documents. */
export function renderServiceWorkerBootstrap(
  worker: string,
  development: boolean,
  registerInDevelopment: boolean,
): string {
  return `const development = ${JSON.stringify(development)};
const previewParameter = new URL(location.href).searchParams.get("pwa");
if (development && previewParameter === "preview") {
  sessionStorage.setItem("kit:pwa-preview", "active");
} else if (development && previewParameter === "off") {
  sessionStorage.removeItem("kit:pwa-preview");
}
const preview = development && sessionStorage.getItem("kit:pwa-preview") === "active";
const requested = !development || ${JSON.stringify(registerInDevelopment)} || preview;
const supported = typeof navigator.serviceWorker?.register === "function";
const worker = ${JSON.stringify(worker)};
const source = requested ? new URL(worker, import.meta.url) : undefined;
if (preview) source?.searchParams.set("pwa", "preview");
const controlledAtStart = supported && navigator.serviceWorker.controller !== null;
let reloading = false;
const reloadForUpdate = () => {
  if (!controlledAtStart || reloading) return;
  reloading = true;
  location.reload();
};
if (supported) navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
const resetDevelopmentWorker = async () => {
  if (!development || !supported) return;
  const scope = new URL("/", location.href).href;
  const target = source?.href;
  const controlled = navigator.serviceWorker.controller;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const owned = registrations.filter((registration) => registration.scope === scope);
  const stale = owned.filter((registration) =>
    [registration.active, registration.waiting, registration.installing]
      .filter(Boolean)
      .every((worker) => worker.scriptURL !== target),
  );
  await Promise.all(stale.map((registration) => registration.unregister()));
  if (stale.length > 0 && "caches" in globalThis) {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("kit-")).map((name) => caches.delete(name)),
    );
  }
  const marker = "kit:development-worker-reset";
  if (controlled && controlled.scriptURL !== target && sessionStorage.getItem(marker) !== "complete") {
    sessionStorage.setItem(marker, "complete");
    location.reload();
    await new Promise(() => {});
  }
  sessionStorage.removeItem(marker);
};
const activate = async () => {
  try {
    await resetDevelopmentWorker();
    if (!requested || !supported || !source) return;
    const registration = await navigator.serviceWorker.register(source, {
      type: "module",
      scope: "/",
      updateViaCache: "none",
    });
    registration.waiting?.postMessage("kit:activate");
    const update = () => void registration.update().catch(() => undefined);
    addEventListener("online", update);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") update();
    });
    setInterval(update, 60 * 60 * 1000);
    const connection = navigator.connection;
    if (!connection?.saveData && connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g") {
      (await navigator.serviceWorker.ready).active?.postMessage("kit:warm");
    }
  } catch (error) {
    console.error("[kit] Service worker lifecycle failed.", error);
  }
};
if (development) {
  void activate();
} else {
  const schedule = () => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => void activate(), { timeout: 4000 });
    } else {
      setTimeout(() => void activate(), 1000);
    }
  };
  if (document.readyState === "complete") schedule();
  else addEventListener("load", schedule, { once: true });
}
`;
}

function candidateSource(input: {
  system: string;
  application: string;
  interface: string;
  features: Readonly<Record<string, string>>;
  development: boolean;
  serverOrigin?: string;
  host: string;
  processRuntime: string;
  runtime: string;
  presentationRuntime: string;
  program: ProgramIR;
  programManifest: ProgramManifest;
  providers: readonly Pick<SelectedDependencyProviderIR, "dependency" | "feature" | "platform">[];
  components: unknown;
  presentationDependencies: unknown;
  hotManifest?: unknown;
  routes: readonly WebRouteIR[];
  routeEntries: readonly WebRouteEntry[];
  dependencies: readonly string[];
  routeDependencies: readonly string[];
  headless: readonly Readonly<{
    program: string;
    logicalProgram: string;
    manifest: ProgramManifest;
    dependencies: readonly string[];
    providers: readonly Pick<SelectedDependencyProviderIR, "dependency" | "feature" | "platform">[];
  }>[];
  workers: readonly Readonly<{
    source: string;
  }>[];
}): string {
  const system = programSystemSpecifier(input.system, input.program.name);
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
  const manifest = input.development
    ? `export const manifest = ${JSON.stringify(input.hotManifest)};`
    : "";
  const hotState = input.development
    ? `const hotState = {
    ...previous,
    keyed: { ...previous.keyed },
    programs: Object.fromEntries(
      Object.entries(previous.programs ?? {}).map(([name, state]) => [name, { ...state }]),
    ),
    presentation: previous.presentation,
    scroll: { ...previous.scroll },
    controls: previous.controls?.map((control) => ({
      ...control,
      path: control.path.slice(),
      selected: control.selected?.slice(),
    })),
    values: previous.values?.slice(),
  };`
    : "const hotState = { keyed: {}, programs: {}, scroll: {} };";
  const activation = input.development
    ? `let disposed = false;
  return {
    value: ui,
    get snapshot() {
      disposeRender.capture();
      ui.captureHotState();
      return hotState;
    },
    resume() {
      disposeRender.resume();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeRender();
      await disposeAll([() => ui.dispose(), ...cleanups]);
    },
  };`
    : `let disposed = false;
  return {
    value: ui,
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeRender();
      await disposeAll([() => ui.dispose(), ...cleanups]);
    },
  };`;
  return `import system from ${JSON.stringify(system)};
import { createWebHost } from ${JSON.stringify(input.host)};
		import { createWebUIAdapter, render, webProgramLanguageRuntime } from ${JSON.stringify(input.runtime)};
import { startProcess } from ${JSON.stringify(input.processRuntime)};

${manifest}
export { system };
const application = system.applications?.[${JSON.stringify(input.application)}];
const interfaceDefinition =
  application?.interfaces?.[${JSON.stringify(input.interface.slice(input.application.length + 1))}];
if (!interfaceDefinition?.presentation) {
  throw new Error(${JSON.stringify(`Web interface ${input.interface} has no Presentation.`)});
}
export const presentation = interfaceDefinition.presentation;
const programManifest = ${JSON.stringify(input.programManifest)};
const headlessPrograms = ${JSON.stringify(input.headless)};
const workerPrograms = ${JSON.stringify(input.workers)};
const routeModules = {
  ${routeLoaders}
};
const routeDefinitions = new Map();

const loadRouteIdentity = (identity) => {
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
const loadRoute = (route) =>
  loadRouteIdentity(route.feature + "." + route.name);

const externalContracts = (manifest, names) => {
  const requested = new Set(names);
  return manifest.bindings.filter(({ name }) => requested.has(name));
};

const hostOptions = (definition) => ({
  dependencies: externalContracts(definition.manifest, definition.dependencies),
	  providers: definition.providers,
	  system,
	  routes: ${JSON.stringify(clientWebRoutes(input.routes))},
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
    if (event.data === "kit:disposed") finish();
  };
  worker.postMessage("kit:dispose", [channel.port2]);
});

export async function activate(root${input.development ? ", previous = {}" : ""}) {
  ${hotState}
  const deferUIActivation =
    root.getAttribute("data-kit-rendering") === "hydrate" && root.childNodes.length > 0;
  const cleanups = [];
  try {
    for (const definition of headlessPrograms) {
      const process = await startProcess(
        system,
        definition.program,
	        await createWebHost(hostOptions(definition)),
	        definition.manifest,
	        webProgramLanguageRuntime,
	        definition.logicalProgram,
      );
      cleanups.push(() => process.dispose());
    }
    for (const definition of workerPrograms) {
      const url = new URL(definition.source, import.meta.url);
      const worker = new Worker(url, { type: "module", name: "kit" });
      cleanups.push(() => disposeWorker(worker));
    }
  } catch (error) {
    await disposeAll(cleanups);
    throw error;
  }
  const presentationAdapter =
    (await import(${JSON.stringify(input.presentationRuntime)})).createWebPresentationAdapter();
  const platform = createWebUIAdapter(presentationAdapter);
  const dependencies = await createWebHost({
    ...${JSON.stringify({
      routeDependencies: input.routeDependencies,
      providers: input.providers,
      routes: input.routes,
    })},
    dependencies: externalContracts(programManifest, ${JSON.stringify(input.dependencies)}),
    system,
  });
  let ui;
  try {
    ui = await platform.component.createInterfaceUI({
      system,
      interface: ${JSON.stringify(input.interface)},
      features: ${JSON.stringify(input.features)},
      program: ${JSON.stringify(input.program.name)},
      logicalProgram: ${JSON.stringify(input.program.logicalName)},
      programManifest,
      dependencies,
      presentation,
      components: ${JSON.stringify(input.components)},
      presentationDependencies: ${JSON.stringify(input.presentationDependencies)},
      routes: ${JSON.stringify(input.routes)},
      loadRoute,
      routeLoaders: ${JSON.stringify(routesWithLoaders)},
      hotState,
      deferActivation: deferUIActivation,
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
  try {
    await ui.activate();
  } catch (error) {
    disposeRender();
    await ui.dispose();
    await disposeAll(cleanups);
    throw error;
  }
  ${activation}
}
`;
}

function developmentDocumentEvaluatorSource(input: {
  system: string;
  program: string;
  application: string;
  interface: string;
  applicationName: string;
  features: Readonly<Record<string, string>>;
  routes: readonly WebRouteIR[];
  document: string;
}): string {
  const system = documentSystemSpecifier(input.system, input.program);
  return `import system from ${JSON.stringify(system)};
import { prepareWebDocument } from ${JSON.stringify(input.document)};

const application = system.applications?.[${JSON.stringify(input.application)}];
const interfaceDefinition =
  application?.interfaces?.[${JSON.stringify(input.interface.slice(input.application.length + 1))}];
if (!interfaceDefinition?.presentation) {
  throw new Error(${JSON.stringify(`Web interface ${input.interface} has no Presentation.`)});
}
export { system };
export const prepare = (input) =>
  prepareWebDocument({
    ...input,
    system,
    interface: ${JSON.stringify(input.interface)},
    applicationName: ${JSON.stringify(input.applicationName)},
    features: ${JSON.stringify(input.features)},
    routes: ${JSON.stringify(input.routes)},
    presentation: interfaceDefinition.presentation,
  });
`;
}

/** @internal Lowers source-level temporal provenance to runtime Component identities. */
export function collectPresentationDependencies(
  ir: SystemIR,
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
  const selected = ir.programs.find(({ name }) => name === programName);
  const interface_ = selected?.interface
    ? ir.interfaces.find(({ path }) => path === selected.interface)
    : undefined;
  const presentationSources = interface_
    ? (webInterfaceCompilerIR(interface_.extensions?.web).presentations ?? [])
    : [];
  const components = ir.programs
    .filter(
      (program) =>
        program.name === programName &&
        program.environment.name === "browser-main" &&
        Boolean(webProgramRoot(program)),
    )
    .flatMap((program) =>
      program.contributions.flatMap((contribution) =>
        (webProgramUI(contribution)?.components ?? []).map((component) => {
          const feature = interface_
            ? interfaceFeatureRole(interface_, contribution.feature)
            : contribution.feature;
          const semantic = [
            ...feature.split(".").filter(Boolean).map(capitalize),
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
    presentationSources.flatMap(({ animations }) =>
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
  for (const source of presentationSources) {
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

function interfaceFeatureRole(interface_: PlatformInterfaceIR, feature: string): string {
  const binding = Object.entries(interface_.features)
    .sort(([, left], [, right]) => right.length - left.length)
    .find(([, path]) => feature === path || feature.startsWith(`${path}.`));
  if (!binding) return feature;
  const [role, path] = binding;
  return `${role}${feature.slice(path.length)}`;
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function clientWebRoutes(
  routes: readonly WebRouteIR[],
): readonly Omit<WebRouteIR, "cache" | "status">[] {
  return routes.map(({ cache: _cache, status: _status, ...route }) => Object.freeze(route));
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
if (!root) throw new Error("Missing UI root.");
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
if (!root) throw new Error("Missing UI root.");
const sameWebHotReplacementManifest = (previous, next) =>
  previous.revision === next.revision &&
  JSON.stringify(previous.programs) === JSON.stringify(next.programs);
const coordinator =
  import.meta.hot?.data.coordinator ??
  new HotUpdateCoordinator(sameWebHotReplacementManifest);
let activations = 0;
const apply = async (candidate, updateKind) => {
  const started = performance.now();
  const initial = activations++ === 0;
  let status = "applied";
  try {
    if (
      updateKind === "presentation" &&
      coordinator.value
    ) {
      coordinator.value.updatePresentation(candidate.presentation);
      return;
    }
    if (updateKind === "view" && coordinator.value) {
      coordinator.value.updateImplementation(candidate.system);
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
      if (result.reason === "manifest-changed") {
        location.reload();
        return;
      }
      console.error("[kit] hot update rejected: " + result.reason, result.cause);
    }
  } finally {
    const detail = {
      initial,
      kind: updateKind,
      status,
      milliseconds: Math.round((performance.now() - started) * 100) / 100,
    };
    globalThis.__kitHotUpdate = detail;
    dispatchEvent(new CustomEvent("kit:hot-update", { detail }));
  }
};
await apply(initialCandidate, "full");
const dispose = () => void coordinator.dispose();
addEventListener("pagehide", dispose, { once: true });

if (import.meta.hot) {
  let pendingUpdateKind;
  import.meta.hot.data.coordinator = coordinator;
  import.meta.hot.on("kit:update-kind", ({ kind }) => {
    pendingUpdateKind =
      pendingUpdateKind === "full" || kind === "full"
        ? "full"
        : pendingUpdateKind === "view" || kind === "view"
          ? "view"
          : kind;
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

function htmlSource(entry: string, title: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>@layer kit.reset,kit.presentation;@layer kit.reset{${webResetCss}}</style><title>${escapeHtmlText(title)}</title></head><body><div id="app"></div><script type="module" src="${entry}"></script></body></html>`;
}

function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function cleanId(id: string): string {
  const source = projectedSourceSpecifier(id) ?? id;
  const query = source.indexOf("?");
  return query < 0 ? source : source.slice(0, query);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function validateUIProgramRoot(system: Record<string, unknown>, program: string): void {
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
  visit(system.features, "");
  if ((routes === 0 && roots.length !== 1) || (routes > 0 && roots.length !== 0)) {
    throw new Error(
      routes > 0
        ? `Routed UI Program "${program}" cannot also define a root Component.`
        : `UI Program "${program}" must define exactly one root Component; found ${roots.length}.`,
    );
  }
}
