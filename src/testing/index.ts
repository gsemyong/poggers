import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, test } from "vitest";

import type { PlatformAdapterImplementation, ProductionConfiguration } from "@/adapter";
import type { ReleaseArtifact } from "@/deployment";
import { createPlatformAdapters, platformAdapters } from "@/platforms";
import {
  buildSystem,
  developSystem,
  resolveSystemRealization,
  type BuiltSystem,
  type RunningSystem,
} from "@/realization";

export {
  createEntityBrowserFixture,
  createEntityFixture,
  createMemoryEventStore,
} from "@/features/entity";
export {
  createDataBrowserFixture,
  createDataFixture,
  createMemoryDataStore,
} from "@/features/data";
export { createIdentityFixture } from "@/features/identity";
export { createWebUIContributionInstance } from "@/platforms/web/adapter/ui/process";
export { startFeatureFixture } from "@/execution/process";
export { createPresentationFrame } from "@/platforms/web/presentation/runtime";
export {
  defineDependencyConformance,
  dependencyImplementationTarget,
  type DependencyConformance,
  type DependencyConformanceInstance,
  type DependencyConformanceScenario,
  type DependencyConformanceTarget,
} from "@/testing/dependency";
export {
  clockConformance,
  identifiersConformance,
  timerConformance,
} from "@/platforms/server/testing";

export type SystemTestContext = Readonly<{
  /** Realization under the same black-box specification. */
  realization: "development" | "production";
  /** Public location through which a user reaches the complete System. */
  location: string;
  /** Public locations exposed by the System's semantic Platforms. */
  locations: Readonly<Record<string, readonly string[]>>;
  /** Realization timings and emitted bytes for broad regression budgets. */
  metrics: Readonly<{
    buildMs?: number;
    startupMs: number;
    artifactBytes?: number;
    environment: string;
  }>;
  /** Restarts the realized System while preserving its durable test data. */
  restart(): Promise<void>;
}>;

export type SystemTestDefinition = Readonly<{
  name: string;
  /** Workspace root containing the canonical src/system.ts. Defaults to the current directory. */
  directory?: string | URL;
  /** Optional ownership tags used by the repository verification ladder. */
  tags?: readonly string[];
  timeout?: number;
  verify(context: SystemTestContext): void | PromiseLike<void>;
}>;

export type HttpTestSession = Readonly<{
  get<Value>(path: string, init?: RequestInit): Promise<Value>;
  post<Value>(path: string, body: unknown, init?: RequestInit): Promise<Value>;
  patch<Value>(path: string, body: unknown, init?: RequestInit): Promise<Value>;
  delete<Value>(path: string, init?: RequestInit): Promise<Value>;
  subscribe<Value>(path: string, init?: RequestInit): Promise<HttpTestSubscription<Value>>;
}>;

export type HttpTestSubscription<Value> = AsyncDisposable &
  Readonly<{
    next(): Promise<Value>;
    close(): Promise<void>;
  }>;

export class HttpTestResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Creates a cookie-preserving JSON and newline-delimited JSON test client. */
export function createHttpTestSession(origin: string): HttpTestSession {
  return new TestHttpSession(origin);
}

/** Runs one black-box System specification through development and production realizations. */
export function testSystem(definition: SystemTestDefinition): void {
  const timeout = definition.timeout ?? 240_000;
  const tags = [...(definition.tags ?? [])];
  describe.sequential(definition.name, () => {
    test("development", { tags, timeout }, () => verifyDevelopment(definition));
    test("production", { tags: [...tags, "production"], timeout }, () =>
      verifyProduction(definition),
    );
  });
}

class TestHttpSession implements HttpTestSession {
  readonly #cookies = new Map<string, string>();

  constructor(readonly origin: string) {}

  get<Value>(path: string, init?: RequestInit): Promise<Value> {
    return this.request(path, init);
  }

  post<Value>(path: string, body: unknown, init?: RequestInit): Promise<Value> {
    return this.request(path, { ...init, method: "POST", body: JSON.stringify(body) });
  }

  patch<Value>(path: string, body: unknown, init?: RequestInit): Promise<Value> {
    return this.request(path, { ...init, method: "PATCH", body: JSON.stringify(body) });
  }

  delete<Value>(path: string, init?: RequestInit): Promise<Value> {
    return this.request(path, { ...init, method: "DELETE" });
  }

  async subscribe<Value>(
    path: string,
    init: RequestInit = {},
  ): Promise<HttpTestSubscription<Value>> {
    const controller = new AbortController();
    const response = await this.fetch(path, { ...init, signal: controller.signal });
    await this.assert(response);
    if (!response.body) throw new Error("The subscription returned no body.");
    return new TestHttpSubscription<Value>(response.body, controller);
  }

  async request<Value>(path: string, init: RequestInit = {}): Promise<Value> {
    const response = await this.fetch(path, init);
    this.capture(response);
    await this.assert(response);
    return (await response.json()) as Value;
  }

  async fetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("connection", "close");
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const cookie = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    try {
      return await fetch(new URL(path, this.origin), { ...init, headers });
    } catch (cause) {
      throw new Error(`${init.method ?? "GET"} ${path} failed.`, { cause });
    }
  }

  capture(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.slice(0, value.indexOf(";"));
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const cookie = pair.slice(separator + 1);
      if (cookie) this.#cookies.set(name, cookie);
      else this.#cookies.delete(name);
    }
  }

  async assert(response: Response): Promise<void> {
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new HttpTestResponseError(
      response.status,
      body.message ?? `Request failed with ${response.status}.`,
    );
  }
}

class TestHttpSubscription<Value> implements HttpTestSubscription<Value> {
  readonly #decoder = new TextDecoder();
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #buffer = "";

  constructor(
    body: ReadableStream<Uint8Array>,
    readonly controller: AbortController,
  ) {
    this.#reader = body.getReader();
  }

  async next(): Promise<Value> {
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line) return JSON.parse(line) as Value;
      }
      const result = await this.#reader.read();
      if (result.done) throw new Error("The subscription ended before the next value.");
      this.#buffer += this.#decoder.decode(result.value, { stream: true });
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.#reader.cancel().catch(() => undefined);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

async function verifyDevelopment(definition: SystemTestDefinition): Promise<void> {
  const directory = testDirectory(definition.directory);
  const temporary = await mkdtemp(resolve(tmpdir(), "kit-system-development-"));
  const database = resolve(temporary, "system.sqlite");
  let system: RunningSystem | undefined;
  let allocation: Readonly<{ serverPort: number; webPort: number }> | undefined;

  const start = async () => {
    const realization = resolveSystemRealization(directory, platformAdapters);
    const serverCount = realization.ir.programs.filter(
      ({ environment }) => environment.platform === "server",
    ).length;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!allocation) {
        const serverPorts = await availablePortRange(Math.max(serverCount, 1));
        allocation = {
          serverPort: serverPorts[0]!,
          webPort: await availablePort(new Set(serverPorts)),
        };
      }
      const adapters = testAdapters({ database, ...allocation });
      const started = performance.now();
      try {
        system = await developSystem(directory, adapters);
        const location = publicLocation(system.locations);
        await ready(location);
        return { location, startupMs: performance.now() - started };
      } catch (error) {
        await system?.[Symbol.asyncDispose]();
        system = undefined;
        if (!hasErrorCode(error, "EADDRINUSE") || attempt === 9) throw error;
        allocation = undefined;
      }
    }
    throw new Error("Development System startup exhausted its port retries.");
  };

  try {
    const { location, startupMs } = await start();
    const active = system;
    if (!active) throw new Error("The development System did not start.");
    await definition.verify({
      realization: "development",
      location,
      locations: active.locations,
      metrics: testMetrics({ startupMs }),
      async restart() {
        await system?.[Symbol.asyncDispose]();
        system = undefined;
        await start();
      },
    });
  } finally {
    await system?.[Symbol.asyncDispose]();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyProduction(definition: SystemTestDefinition): Promise<void> {
  const directory = testDirectory(definition.directory);
  const temporary = await mkdtemp(resolve(tmpdir(), "kit-system-production-"));
  const output = resolve(temporary, "dist");
  let running: ProductionSystem | undefined;

  try {
    const buildStarted = performance.now();
    const built = await buildSystem(directory, output, platformAdapters);
    const buildMs = performance.now() - buildStarted;
    const artifactBytes = await directoryBytes(output);
    const portCount = built.release.artifacts.reduce(
      (count, artifact) =>
        count +
        artifact.configuration.filter(({ allocation }) => allocation?.kind === "port").length,
      built.release.artifacts.filter(
        ({ deployment, kind }) => deployment === "asset" && kind === "interface",
      ).length,
    );
    const ports = await availablePortRange(Math.max(portCount, 1));
    const start = async () => {
      const started = performance.now();
      running = await startProductionSystem(built, directory, temporary, ports);
      await ready(running.location, () => running?.diagnostics?.());
      return { location: running.location, startupMs: performance.now() - started };
    };
    const { location, startupMs } = await start();
    const active = running;
    if (!active) throw new Error("The production System did not start.");
    try {
      await definition.verify({
        realization: "production",
        location,
        locations: active.locations,
        metrics: testMetrics({ artifactBytes, buildMs, startupMs }),
        async restart() {
          await running?.dispose();
          running = undefined;
          await start();
        },
      });
    } catch (error) {
      const diagnostics = running?.diagnostics?.()?.trim();
      if (!diagnostics) throw error;
      throw new Error(`Production System verification failed.\n${diagnostics}`, { cause: error });
    }
  } finally {
    await running?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}

function testDirectory(directory: string | URL | undefined): string {
  return resolve(
    directory instanceof URL ? fileURLToPath(directory) : (directory ?? process.cwd()),
  );
}

function testMetrics(input: {
  artifactBytes?: number;
  buildMs?: number;
  startupMs: number;
}): SystemTestContext["metrics"] {
  return Object.freeze({
    ...input,
    environment: `${process.platform}/${process.arch} ${process.version}`,
  });
}

async function directoryBytes(path: string): Promise<number> {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) return metadata.size;
  const entries = await readdir(path);
  const sizes = await Promise.all(entries.map((entry) => directoryBytes(resolve(path, entry))));
  return sizes.reduce((total, size) => total + size, 0);
}

function testAdapters(input: {
  database: string;
  serverPort: number;
  webPort: number;
}): Readonly<Record<string, PlatformAdapterImplementation>> {
  const webOrigin = `http://localhost:${input.webPort}`;
  const serverOrigin = `http://localhost:${input.serverPort}`;
  return createPlatformAdapters({
    server: {
      developmentPort: input.serverPort,
      developmentHost: {
        configuration: {
          secret: "kit-system-test-secret",
        },
        database: input.database,
        directory: dirname(input.database),
        host: "localhost",
        shutdownTimeout: 500,
        allowedOrigins: [webOrigin],
      },
    },
    web: {
      developmentPort: input.webPort,
      serverOrigin,
    },
  });
}

function publicLocation(locations: Readonly<Record<string, readonly string[]>>): string {
  const entries = Object.entries(locations).sort(([left], [right]) => {
    const rank = (identity: string) => (identity.startsWith("interface/") ? 0 : 1);
    return rank(left) - rank(right) || left.localeCompare(right);
  });
  const location = entries.flatMap(([, values]) => values)[0];
  if (!location) throw new Error("The System exposes no public development location.");
  return location;
}

type ProductionSystem = Readonly<{
  location: string;
  locations: Readonly<Record<string, readonly string[]>>;
  diagnostics?(): string;
  dispose(): Promise<void>;
}>;

async function startProductionSystem(
  built: BuiltSystem,
  directory: string,
  stateDirectory: string,
  ports: readonly number[],
): Promise<ProductionSystem> {
  const artifacts = built.release.artifacts;
  const processArtifacts = artifacts.filter(({ deployment }) => deployment === "process");
  const assetArtifacts = artifacts.filter(({ deployment }) => deployment === "asset");
  const interfaceArtifacts = assetArtifacts.filter(({ kind }) => kind === "interface");
  let portCursor = 0;
  const prepared: PreparedProductionProcess[] = [];
  for (const artifact of processArtifacts) {
    prepared.push(
      await prepareProductionProcess({
        artifact,
        portCursor: () => ports[portCursor++],
        stateDirectory,
      }),
    );
  }
  const interfaceOrigins = new Map<string, string>();
  for (const process of prepared) {
    const origin = process.locations[0];
    if (!origin) continue;
    const selected = uniqueArtifacts(
      process.deferred.flatMap(({ source }) =>
        source?.kind === "assets"
          ? selectAssetArtifacts(assetArtifacts, source).filter(({ kind }) => kind === "interface")
          : [],
      ),
    );
    for (const [index, artifact] of selected.entries()) {
      if (interfaceOrigins.has(artifact.identity)) continue;
      interfaceOrigins.set(
        artifact.identity,
        selected.length === 1 ? origin : interfaceOrigin(origin, index),
      );
    }
  }
  for (const process of prepared) {
    resolveProductionSources(process, assetArtifacts, interfaceOrigins, built.directory);
  }

  const processes: RunningProcess[] = [];
  const staticServers: ProductionSystem[] = [];
  const locations: Record<string, readonly string[]> = {};
  try {
    for (const process of prepared) {
      if (!process.artifact.entrypoint) {
        throw new Error(
          `Production Process ${JSON.stringify(process.artifact.identity)} has no entrypoint.`,
        );
      }
      if (process.locations.length) locations[process.artifact.identity] = process.locations;
      processes.push(
        startProcess(
          resolve(built.directory, process.artifact.entrypoint),
          directory,
          process.environment,
        ),
      );
    }
    await Promise.all(
      prepared.map((process, index) =>
        process.status
          ? readyProcess(process.artifact.identity, process.status, () =>
              processes[index]?.output(),
            )
          : Promise.resolve(),
      ),
    );

    for (const artifact of interfaceArtifacts) {
      if (interfaceOrigins.has(artifact.identity)) continue;
      const port = ports[portCursor++];
      if (port === undefined) {
        throw new Error(`No test port was allocated for ${JSON.stringify(artifact.identity)}.`);
      }
      const server = await startStaticArtifact(
        artifact,
        resolve(built.directory, artifact.root),
        port,
      );
      staticServers.push(server);
      interfaceOrigins.set(artifact.identity, server.location);
    }
    for (const [identity, origin] of interfaceOrigins) locations[identity] = [origin];
    const location =
      interfaceOrigins.values().next().value ??
      prepared.flatMap(({ locations: values }) => values)[0];
    if (!location) throw new Error("The production System exposes no public HTTP location.");
    return {
      location,
      locations: Object.freeze(locations),
      diagnostics: () =>
        processes
          .map(({ child, output }) => {
            const status = child.exitCode ?? child.signalCode ?? "running";
            return `[${status}]\n${output()}`;
          })
          .join("\n"),
      async dispose() {
        await Promise.all([
          disposeProcesses(processes),
          ...staticServers.map((server) => server.dispose()),
        ]);
      },
    };
  } catch (error) {
    await Promise.all([
      disposeProcesses(processes),
      ...staticServers.map((server) => server.dispose()),
    ]);
    throw error;
  }
}

type PreparedProductionProcess = {
  artifact: ReleaseArtifact;
  deferred: ProductionConfiguration[];
  environment: Record<string, string>;
  locations: string[];
  status?: string;
};

async function prepareProductionProcess(input: {
  artifact: ReleaseArtifact;
  portCursor(): number | undefined;
  stateDirectory: string;
}): Promise<PreparedProductionProcess> {
  const environment: Record<string, string> = {};
  const deferred: ProductionConfiguration[] = [];
  const allocatedPorts: string[] = [];
  const processState = resolve(
    input.stateDirectory,
    "processes",
    readableIdentity(input.artifact.identity),
  );

  for (const field of input.artifact.configuration) {
    if (field.source) {
      deferred.push(field);
      continue;
    }
    let value: string | number | boolean | undefined;
    if (field.allocation?.kind === "port") {
      value = input.portCursor();
      if (value === undefined) {
        throw new Error(
          `No test port was allocated for ${JSON.stringify(input.artifact.identity)}.`,
        );
      }
      allocatedPorts.push(String(value));
    } else if (field.allocation?.kind === "storage") {
      const root =
        field.allocation.scope === "deployment"
          ? resolve(input.stateDirectory, "storage")
          : resolve(processState, "storage");
      value = resolve(root, field.allocation.name);
      await mkdir(field.allocation.type === "directory" ? value : dirname(value), {
        recursive: true,
      });
    } else {
      value = process.env[field.binding.name] ?? field.default;
    }
    if (value === undefined) {
      if (field.required) {
        throw new Error(
          `Production Process ${JSON.stringify(input.artifact.identity)} is missing ${JSON.stringify(field.dependency)} configuration ${JSON.stringify(field.name)}.`,
        );
      }
      continue;
    }
    environment[field.binding.name] = String(value);
  }

  const host = environment.HOST ?? "127.0.0.1";
  const locations = allocatedPorts.map((port) => `http://${host}:${port}`);
  let status: string | undefined;
  if (input.artifact.lifecycle?.status) {
    status = resolve(processState, "status.json");
    await mkdir(dirname(status), { recursive: true });
    await rm(status, { force: true });
    environment[input.artifact.lifecycle.status.environment] = status;
  }
  return {
    artifact: input.artifact,
    deferred,
    environment,
    locations,
    ...(status ? { status } : {}),
  };
}

async function readyProcess(
  identity: string,
  statusFile: string,
  diagnostics: () => string | undefined,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let status: string | undefined;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(statusFile, "utf8")) as Readonly<{
        status?: unknown;
      }>;
      status = typeof value.status === "string" ? value.status : undefined;
      if (status === "ready") return;
      if (status === "failed") break;
    } catch {
      // The Process publishes its status atomically after it starts.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  const output = diagnostics()?.trim();
  throw new Error(
    `Production Process ${JSON.stringify(identity)} did not become ready${status ? ` (status: ${status})` : ""}.${output ? `\n${output}` : ""}`,
  );
}

function resolveProductionSources(
  process: PreparedProductionProcess,
  assets: readonly ReleaseArtifact[],
  interfaceOrigins: ReadonlyMap<string, string>,
  output: string,
): void {
  for (const field of process.deferred) {
    const source = field.source!;
    let value: string | undefined;
    if (source.kind === "process-location") {
      const selected = process.deferred.flatMap(({ source: candidate }) =>
        candidate?.kind === "assets"
          ? selectAssetArtifacts(assets, candidate).flatMap(({ identity }) => {
              const origin = interfaceOrigins.get(identity);
              return origin ? [origin] : [];
            })
          : [],
      );
      value = selected[0] ?? process.locations[0];
    } else if (source.kind === "service-location") {
      value = globalThis.process.env[field.binding.name] ?? field.default;
      if (!value) {
        throw new Error(
          `Production test requires service endpoint ${JSON.stringify(
            `${source.service}.${source.endpoint}`,
          )}; provide ${field.binding.name} or use a Deployment adapter that realizes services.`,
        );
      }
    } else {
      const selected = selectAssetArtifacts(assets, source);
      if (source.format === "single" && selected.length === 1) {
        value = resolve(output, selected[0]!.root);
      } else if (source.format === "interfaces" && selected.length > 1) {
        value = JSON.stringify(
          selected.map((artifact) => ({
            identity: artifact.identity,
            ...(interfaceOrigins.has(artifact.identity)
              ? { origin: interfaceOrigins.get(artifact.identity)! }
              : {}),
            root: resolve(output, artifact.root),
          })),
        );
      }
    }
    if (value !== undefined) process.environment[field.binding.name] = value;
  }
}

function selectAssetArtifacts(
  artifacts: readonly ReleaseArtifact[],
  source: Extract<NonNullable<ProductionConfiguration["source"]>, { kind: "assets" }>,
): readonly ReleaseArtifact[] {
  return artifacts.filter(
    ({ deployment, kind, platform }) =>
      deployment === "asset" &&
      (!source.artifact || source.artifact === kind) &&
      (!source.platform || source.platform === platform),
  );
}

function uniqueArtifacts(artifacts: readonly ReleaseArtifact[]): readonly ReleaseArtifact[] {
  return [...new Map(artifacts.map((artifact) => [artifact.identity, artifact])).values()];
}

function interfaceOrigin(processOrigin: string, index: number): string {
  const location = new URL(processOrigin);
  location.hostname = `interface-${index + 1}.localhost`;
  return location.href.replace(/\/$/, "");
}

function readableIdentity(identity: string): string {
  return identity.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}

type RunningProcess = Readonly<{
  child: ChildProcess;
  output(): string;
}>;

function startProcess(
  executable: string,
  directory: string,
  environment: Readonly<Record<string, string>>,
): RunningProcess {
  const child = spawn(executable, [], {
    cwd: directory,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8").on("data", (value: string) => (output += value));
  child.stderr?.setEncoding("utf8").on("data", (value: string) => (output += value));
  return { child, output: () => output };
}

async function disposeProcesses(processes: readonly RunningProcess[]): Promise<void> {
  await Promise.all(
    [...processes].reverse().map(
      ({ child, output }) =>
        new Promise<void>((resolvePromise, reject) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolvePromise();
            return;
          }
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolvePromise();
            else reject(new Error(output() || `Production Program exited ${code ?? signal}.`));
          });
          child.kill("SIGINT");
        }),
    ),
  );
}

async function startStaticArtifact(
  artifact: ReleaseArtifact,
  directory: string,
  port: number,
): Promise<ProductionSystem> {
  const root = resolve(directory);
  const exposure = artifact.exposure;
  if (!exposure || exposure.kind !== "http-assets") {
    throw new Error(
      `Static interface ${JSON.stringify(artifact.identity)} has no HTTP exposure contract.`,
    );
  }
  const policies = new Map(exposure.files.map(({ path, cacheControl }) => [path, cacheControl]));
  const server = createHttpServer(async (request, response) => {
    try {
      for (const [name, value] of Object.entries(exposure.headers ?? {})) {
        response.setHeader(name, value);
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const fixed = exposure.responses.find(({ path }) => path === url.pathname);
      if (fixed) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { allow: "GET, HEAD" }).end();
          return;
        }
        const origin = new URL(`http://${request.headers.host ?? `127.0.0.1:${port}`}`).origin;
        const body = fixed.substitutions?.includes("origin")
          ? fixed.body.replaceAll("{{origin}}", origin)
          : fixed.body;
        response.writeHead(fixed.status, {
          ...exposure.headers,
          ...fixed.headers,
          "content-length": Buffer.byteLength(body),
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      let candidate = resolve(root, `.${pathname}`);
      const inside = candidate === root || candidate.startsWith(`${root}${sep}`);
      if (!inside) {
        response.writeHead(400).end();
        return;
      }
      if (await isDirectory(candidate)) candidate = resolve(candidate, "index.html");
      if (
        !(await isFile(candidate)) &&
        exposure.fallback &&
        (request.headers.accept ?? "").includes("text/html")
      ) {
        candidate = resolve(root, exposure.fallback);
      }
      if (!(await isFile(candidate))) {
        response.writeHead(404).end();
        return;
      }
      const body = await readFile(candidate);
      const path = candidate
        .slice(root.length + 1)
        .split(sep)
        .join("/");
      response.statusCode = 200;
      response.setHeader("cache-control", policies.get(path) ?? "no-cache");
      response.setHeader("content-length", body.byteLength);
      response.setHeader("content-type", contentType(candidate));
      response.setHeader("x-content-type-options", "nosniff");
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });
  await listen(server, port);
  return {
    location: `http://127.0.0.1:${port}`,
    locations: { [artifact.identity]: [`http://127.0.0.1:${port}`] },
    dispose: () => close(server),
  };
}

async function ready(location: string, diagnostics?: () => string | undefined): Promise<void> {
  const deadline = Date.now() + 15_000;
  let failure: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(location);
      await response.arrayBuffer();
      return;
    } catch (error) {
      failure = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  const output = diagnostics?.()?.trim();
  throw new Error(`System did not become ready at ${location}.${output ? `\n${output}` : ""}`, {
    cause: failure,
  });
}

function hasErrorCode(error: unknown, code: string, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  if ("code" in error && error.code === code) return true;
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      if (hasErrorCode(nested, code, seen)) return true;
    }
  }
  return "cause" in error && hasErrorCode(error.cause, code, seen);
}

async function availablePort(excluded: ReadonlySet<number> = new Set()): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolvePromise, reject) => {
      const server = createPortServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Cannot allocate a System test port.")));
          return;
        }
        server.close((error) => (error ? reject(error) : resolvePromise(address.port)));
      });
    });
    if (!excluded.has(port)) return port;
  }
}

async function availablePortRange(size: number): Promise<readonly number[]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Port range size must be positive.");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const first = await availablePort();
    const ports = Array.from({ length: size }, (_, index) => first + index);
    if (ports.at(-1)! > 65_535) continue;
    const reservations: ReturnType<typeof createPortServer>[] = [];
    try {
      for (const port of ports) reservations.push(await reservePort(port));
      return ports;
    } catch {
      // Another listener owns part of this range; choose a fresh range.
    } finally {
      await Promise.all(reservations.map(closePort));
    }
  }
  throw new Error(`Cannot allocate ${size} contiguous System test ports.`);
}

function reservePort(port: number): Promise<ReturnType<typeof createPortServer>> {
  return new Promise((resolvePromise, reject) => {
    const server = createPortServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}

function closePort(server: ReturnType<typeof createPortServer>): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function listen(server: HttpServer, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
}

function close(server: HttpServer): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isDirectory())
    .catch(() => false);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".wasm":
      return "application/wasm";
    case ".webmanifest":
      return "application/manifest+json";
    default:
      return "application/octet-stream";
  }
}
