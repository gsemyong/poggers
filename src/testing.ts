import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";

import { describe, test } from "vitest";

import { createPlatformAdapters, platformAdapters } from "@/adapters/registry";
import { linkProgram } from "@/compiler/linker";
import type { PlatformAdapterImplementation } from "@/contracts/platform";
import {
  buildApplication,
  developApplication,
  resolveApplicationRealization,
  type BuiltApplication,
  type RunningApplication,
} from "@/realization";

export { createEntityFixture, createMemoryEventStore } from "@/features/entity.testing";
export { createUIContributionInstance } from "@/runtime/process";
export { createPresentationFrame } from "@/runtime/presentation";

export type ApplicationTestContext = Readonly<{
  /** Realization under the same black-box specification. */
  realization: "development" | "production";
  /** Public location through which a user reaches the complete application. */
  location: string;
  /** Public locations exposed by the Application's semantic Platforms. */
  locations: Readonly<Record<string, readonly string[]>>;
  /** Realization timings and emitted bytes for broad regression budgets. */
  metrics: Readonly<{
    buildMs?: number;
    startupMs: number;
    artifactBytes?: number;
    environment: string;
  }>;
  /** Restarts the realized application while preserving its durable test data. */
  restart(): Promise<void>;
}>;

export type ApplicationTestDefinition = Readonly<{
  name: string;
  /** Project root containing the canonical src/app.tsx. Defaults to the current directory. */
  directory?: string;
  timeout?: number;
  verify(context: ApplicationTestContext): void | PromiseLike<void>;
}>;

/** Runs one black-box product specification through development and production realizations. */
export function testApplication(definition: ApplicationTestDefinition): void {
  const timeout = definition.timeout ?? 240_000;
  describe.sequential(definition.name, () => {
    test("development", { timeout }, () => verifyDevelopment(definition));
    test("production", { timeout }, () => verifyProduction(definition));
  });
}

async function verifyDevelopment(definition: ApplicationTestDefinition): Promise<void> {
  const directory = resolve(definition.directory ?? process.cwd());
  const temporary = await mkdtemp(resolve(tmpdir(), "poggers-application-development-"));
  const database = resolve(temporary, "application.sqlite");
  const realization = resolveApplicationRealization(directory, platformAdapters);
  const serverCount = realization.ir.programs.filter(
    ({ environment }) => environment.platform === "server",
  ).length;
  const serverPorts = await availablePortRange(Math.max(serverCount, 1));
  const serverPort = serverPorts[0]!;
  const webPort = await availablePort(new Set(serverPorts));
  const adapters = testAdapters({ database, serverPort, webPort });
  let application: RunningApplication | undefined;

  const start = async () => {
    const started = performance.now();
    application = await developApplication(directory, adapters);
    const location = publicLocation(application.locations);
    await ready(location);
    return { location, startupMs: performance.now() - started };
  };

  try {
    const { location, startupMs } = await start();
    const active = application;
    if (!active) throw new Error("The development Application did not start.");
    await definition.verify({
      realization: "development",
      location,
      locations: active.locations,
      metrics: testMetrics({ startupMs }),
      async restart() {
        await application?.[Symbol.asyncDispose]();
        application = undefined;
        await start();
      },
    });
  } finally {
    await application?.[Symbol.asyncDispose]();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyProduction(definition: ApplicationTestDefinition): Promise<void> {
  const directory = resolve(definition.directory ?? process.cwd());
  const temporary = await mkdtemp(resolve(tmpdir(), "poggers-application-production-"));
  const database = resolve(temporary, "application.sqlite");
  const output = resolve(temporary, "dist");
  let running: ProductionApplication | undefined;

  try {
    const buildStarted = performance.now();
    const built = await buildApplication(directory, output, platformAdapters);
    const buildMs = performance.now() - buildStarted;
    const artifactBytes = await directoryBytes(output);
    const serverCount = built.artifacts.server?.entries.length ?? 0;
    const ports = await availablePortRange(Math.max(serverCount + 1, 1));
    const start = async () => {
      const started = performance.now();
      running = await startProductionApplication(built, directory, database, ports[0]!);
      await ready(running.location);
      return { location: running.location, startupMs: performance.now() - started };
    };
    const { location, startupMs } = await start();
    const active = running;
    if (!active) throw new Error("The production Application did not start.");
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
  } finally {
    await running?.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
}

function testMetrics(input: {
  artifactBytes?: number;
  buildMs?: number;
  startupMs: number;
}): ApplicationTestContext["metrics"] {
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
        database: input.database,
        host: "localhost",
        secret: "poggers-application-test-secret",
        shutdownTimeout: 500,
      },
      webOrigin,
    },
    web: {
      developmentPort: input.webPort,
      serverOrigin,
    },
  });
}

function publicLocation(locations: Readonly<Record<string, readonly string[]>>): string {
  const location = locations.web?.[0] ?? locations.server?.[0];
  if (!location) throw new Error("The Application exposes no public development location.");
  return location;
}

type ProductionApplication = Readonly<{
  location: string;
  locations: Readonly<Record<string, readonly string[]>>;
  dispose(): Promise<void>;
}>;

async function startProductionApplication(
  built: BuiltApplication,
  directory: string,
  database: string,
  basePort: number,
): Promise<ProductionApplication> {
  const serverArtifacts = built.artifacts.server?.entries ?? [];
  const webRoot = built.artifacts.web?.directory;
  if (!serverArtifacts.length) {
    if (!webRoot) throw new Error("The production Application exposes no public artifact.");
    return startStaticApplication(webRoot, basePort);
  }

  const httpPrograms = new Set(
    built.ir.programs
      .filter(
        (program) =>
          program.environment.platform === "server" &&
          linkProgram(program).external.some(({ name }) => name === "http"),
      )
      .map(({ name }) => name),
  );
  const processes: RunningProcess[] = [];
  const httpLocations: string[] = [];
  try {
    for (const [index, artifact] of serverArtifacts.entries()) {
      const port = basePort + index;
      if (httpPrograms.has(artifact.program)) httpLocations.push(`http://127.0.0.1:${port}`);
      processes.push(
        startProcess(artifact.path, directory, {
          HOST: "127.0.0.1",
          PORT: String(port),
          POGGERS_DATABASE: database,
          POGGERS_HTTP_BODY_LIMIT: "1024",
          POGGERS_HTTP_TIMEOUT_MS: "2000",
          POGGERS_HTTP_SHUTDOWN_TIMEOUT_MS: "500",
          POGGERS_WEB_ORIGIN: `http://127.0.0.1:${port}`,
          ...(webRoot ? { POGGERS_WEB_ROOT: webRoot } : {}),
        }),
      );
    }
    if (!httpLocations.length) {
      if (!webRoot) {
        throw new Error("The production Application exposes no public HTTP or web artifact.");
      }
      const web = await startStaticApplication(webRoot, basePort + serverArtifacts.length);
      return {
        ...web,
        async dispose() {
          await Promise.all([web.dispose(), disposeProcesses(processes)]);
        },
      };
    }
    return {
      location: httpLocations[0]!,
      locations: {
        server: httpLocations,
        ...(webRoot ? { web: httpLocations } : {}),
      },
      dispose: () => disposeProcesses(processes),
    };
  } catch (error) {
    await disposeProcesses(processes);
    throw error;
  }
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

async function startStaticApplication(
  directory: string,
  port: number,
): Promise<ProductionApplication> {
  const root = resolve(directory);
  const index = await readFile(resolve(root, "index.html"));
  const server = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const candidate = resolve(root, `.${pathname}`);
      const inside = candidate === root || candidate.startsWith(`${root}${sep}`);
      const file = inside && (await isFile(candidate)) ? candidate : resolve(root, "index.html");
      const body = file.endsWith("index.html") ? index : await readFile(file);
      response.statusCode = 200;
      response.setHeader("content-type", contentType(file));
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });
  await listen(server, port);
  return {
    location: `http://127.0.0.1:${port}`,
    locations: { web: [`http://127.0.0.1:${port}`] },
    dispose: () => close(server),
  };
}

async function ready(location: string): Promise<void> {
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
  throw new Error(`Application did not become ready at ${location}.`, { cause: failure });
}

async function availablePort(excluded: ReadonlySet<number> = new Set()): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolvePromise, reject) => {
      const server = createPortServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Cannot allocate an application test port.")));
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
  throw new Error(`Cannot allocate ${size} contiguous application test ports.`);
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
    default:
      return "application/octet-stream";
  }
}
