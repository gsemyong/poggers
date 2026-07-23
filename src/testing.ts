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
  buildSystem,
  developSystem,
  resolveSystemRealization,
  type BuiltSystem,
  type RunningSystem,
} from "@/realization";

export { createEntityFixture, createMemoryEventStore } from "@/features/entity.testing";
export { createUIContributionInstance } from "@/runtime/process";
export { createPresentationFrame } from "@/runtime/presentation";

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
  directory?: string;
  timeout?: number;
  verify(context: SystemTestContext): void | PromiseLike<void>;
}>;

/** Runs one black-box System specification through development and production realizations. */
export function testSystem(definition: SystemTestDefinition): void {
  const timeout = definition.timeout ?? 240_000;
  describe.sequential(definition.name, () => {
    test("development", { timeout }, () => verifyDevelopment(definition));
    test("production", { timeout }, () => verifyProduction(definition));
  });
}

async function verifyDevelopment(definition: SystemTestDefinition): Promise<void> {
  const directory = resolve(definition.directory ?? process.cwd());
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
  const directory = resolve(definition.directory ?? process.cwd());
  const temporary = await mkdtemp(resolve(tmpdir(), "kit-system-production-"));
  const database = resolve(temporary, "system.sqlite");
  const output = resolve(temporary, "dist");
  let running: ProductionSystem | undefined;

  try {
    const buildStarted = performance.now();
    const built = await buildSystem(directory, output, platformAdapters);
    const buildMs = performance.now() - buildStarted;
    const artifactBytes = await directoryBytes(output);
    const serverCount = built.artifacts.server?.entries.length ?? 0;
    const ports = await availablePortRange(Math.max(serverCount + 1, 1));
    const start = async () => {
      const started = performance.now();
      running = await startProductionSystem(built, directory, database, ports[0]!);
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
        database: input.database,
        host: "localhost",
        secret: "kit-system-test-secret",
        shutdownTimeout: 500,
      },
      webOrigins: [webOrigin],
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
  database: string,
  basePort: number,
): Promise<ProductionSystem> {
  const serverArtifacts = built.artifacts.server?.entries ?? [];
  const interfaceArtifacts =
    built.artifacts.web?.entries.filter(({ kind }) => kind === "interface") ?? [];
  if (!serverArtifacts.length) {
    if (!interfaceArtifacts.length) {
      throw new Error("The production System exposes no public artifact.");
    }
    return startStaticWebArtifacts(interfaceArtifacts, basePort);
  }

  const httpPrograms = new Set(
    built.ir.programs
      .filter(
        (program) =>
          program.environment.platform === "server" &&
          linkProgram(program).external.some(({ name }) => name === "http"),
      )
      .map(({ id }) => id),
  );
  const firstHttpIndex = serverArtifacts.findIndex(({ identity }) => httpPrograms.has(identity));
  const firstHttpPort = firstHttpIndex < 0 ? undefined : basePort + firstHttpIndex;
  const interfaceOrigins = new Map(
    interfaceArtifacts.map((artifact, index) => [
      artifact.identity,
      interfaceArtifacts.length === 1
        ? `http://127.0.0.1:${firstHttpPort}`
        : `http://web-${index + 1}.localhost:${firstHttpPort}`,
    ]),
  );
  const webInterfaces = JSON.stringify(
    interfaceArtifacts.map((artifact) => ({
      identity: artifact.identity,
      origin: interfaceOrigins.get(artifact.identity)!,
      root: artifact.path,
    })),
  );
  const processes: RunningProcess[] = [];
  const locations: Record<string, readonly string[]> = {};
  try {
    for (const [index, artifact] of serverArtifacts.entries()) {
      const port = basePort + index;
      const http = httpPrograms.has(artifact.identity);
      const origin = `http://127.0.0.1:${port}`;
      if (http) locations[artifact.identity] = [origin];
      processes.push(
        startProcess(artifact.path, directory, {
          HOST: "127.0.0.1",
          PORT: String(port),
          KIT_DATABASE: database,
          KIT_HTTP_BODY_LIMIT: "1024",
          KIT_HTTP_TIMEOUT_MS: "2000",
          KIT_HTTP_SHUTDOWN_TIMEOUT_MS: "500",
          KIT_WEB_ORIGIN: interfaceOrigins.values().next().value ?? origin,
          ...(http && interfaceArtifacts.length === 1
            ? { KIT_WEB_ROOT: interfaceArtifacts[0]!.path }
            : {}),
          ...(http && interfaceArtifacts.length > 1 ? { KIT_WEB_INTERFACES: webInterfaces } : {}),
        }),
      );
    }
    if (firstHttpPort === undefined) {
      if (!interfaceArtifacts.length) {
        throw new Error("The production System exposes no public HTTP or web artifact.");
      }
      const web = await startStaticWebArtifacts(
        interfaceArtifacts,
        basePort + serverArtifacts.length,
      );
      return {
        ...web,
        async dispose() {
          await Promise.all([web.dispose(), disposeProcesses(processes)]);
        },
      };
    }
    for (const [identity, origin] of interfaceOrigins) locations[identity] = [origin];
    const location = interfaceOrigins.values().next().value ?? `http://127.0.0.1:${firstHttpPort}`;
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
      dispose: () => disposeProcesses(processes),
    };
  } catch (error) {
    await disposeProcesses(processes);
    throw error;
  }
}

async function startStaticWebArtifacts(
  artifacts: readonly Readonly<{ identity: string; path: string }>[],
  basePort: number,
): Promise<ProductionSystem> {
  const servers = await Promise.all(
    artifacts.map((artifact, index) => startStaticWebArtifact(artifact.path, basePort + index)),
  );
  return {
    location: servers[0]!.location,
    locations: Object.freeze(
      Object.fromEntries(
        artifacts.map((artifact, index) => [
          artifact.identity,
          [servers[index]!.location] as const,
        ]),
      ),
    ),
    async dispose() {
      await Promise.all(servers.map((server) => server.dispose()));
    },
  };
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

async function startStaticWebArtifact(directory: string, port: number): Promise<ProductionSystem> {
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
