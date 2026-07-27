import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { DevelopmentEvent } from "@/adapter";
import { compileSystem } from "@/compiler/source";
import { createServerPlatformAdapter, serverCompilerExtension } from "@/platforms/server/adapter";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import { createSystemRevisionSource } from "@/realization";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("server Platform adapter", () => {
  test("rejects non-portable server source during semantic compilation", async () => {
    const fixture = await createFixture(
      httpProgramSource("first").replace(
        "return dependencies.http.route({",
        "switch (1) { default: break; }\n        return dependencies.http.route({",
      ),
    );
    const adapter = createServerPlatformAdapter();

    expect(() => compileSystem(fixture.system)).toThrow(
      /Platform "server" has no registered compiler dialect/,
    );
    expect(() => compileSystem(fixture.system, adapter.compiler ?? [])).toThrow(
      /Server Program contribution .* must lower completely to portable meaning.*SwitchStatement/,
    );
  });

  test("emits and launches one independent artifact per named Program", async () => {
    const fixture = await createFixture(twoProgramSource());
    const ir = compileSystem(fixture.system, [serverCompilerExtension]);
    const output = resolve(fixture.directory, "dist");
    const result = await createServerPlatformAdapter().build({
      directory: fixture.directory,
      system: fixture.system,
      ir,
      programs: ir.programs,
      interfaces: [],
      platform: "server",
      output,
    });

    expect(result.entries.map(({ identity }) => identity)).toEqual([
      "program/api",
      "program/worker",
    ]);
    for (const artifact of result.entries) {
      await access(artifact.path);
      expect(artifact.entrypoint).toBe(artifact.path);
      expect(artifact.dependencies).toEqual(artifact.identity === "program/api" ? ["clock"] : []);
      expect(artifact.configuration).toEqual(
        artifact.identity === "program/api"
          ? [
              {
                dependency: "clock",
                implementation: "clock",
                name: "offset",
                binding: { kind: "environment", name: "KIT_CLOCK_OFFSET_MS" },
                required: false,
                default: "0",
              },
            ]
          : [],
      );
      expect(artifact.target).toEqual({
        operatingSystem: process.platform,
        architecture: process.arch,
      });
      expect(artifact.lifecycle).toEqual({
        shutdown: { kind: "signal", signal: "SIGINT" },
        status: { kind: "file", environment: "KIT_PROCESS_STATUS_FILE" },
      });
      await expect(run(artifact.path)).resolves.toBe(0);
    }
  }, 120_000);

  test(
    "serves a headless HTTP Program without web Platform meaning",
    { tags: ["production"], timeout: 120_000 },
    async () => {
      const fixture = await createFixture(httpProgramSource("production"));
      const ir = compileSystem(fixture.system, [serverCompilerExtension]);
      const output = resolve(fixture.directory, "dist");
      const result = await createServerPlatformAdapter().build({
        directory: fixture.directory,
        system: fixture.system,
        ir,
        programs: ir.programs,
        interfaces: [],
        platform: "server",
        output,
      });
      const artifact = result.entries[0]!;
      const port = await availablePort();
      const child = spawn(artifact.path, [], {
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
        stdio: "pipe",
      });
      let diagnostics = "";
      child.stderr.setEncoding("utf8").on("data", (value: string) => (diagnostics += value));
      const exited = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
        (resolvePromise, reject) => {
          child.once("error", reject);
          child.once("exit", (code, signal) => resolvePromise({ code, signal }));
        },
      );
      let shutdownFailure: Error | undefined;
      try {
        await expect
          .poll(() => fetchText(`http://127.0.0.1:${port}/probe`), { timeout: 10_000 })
          .toBe("production");
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
        const stopped = await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            const timeout = setTimeout(() => {
              child.kill("SIGKILL");
              reject(new Error(`Headless HTTP Program did not stop: ${diagnostics}`));
            }, 10_000);
            exited.finally(() => clearTimeout(timeout)).catch(() => undefined);
          }),
        ]);
        if (stopped.signal && stopped.signal !== "SIGINT") {
          shutdownFailure = new Error(
            `Headless HTTP Program exited from ${stopped.signal}: ${diagnostics}`,
          );
        }
        if (stopped.code !== 0 && stopped.code !== null) {
          shutdownFailure = new Error(
            `Headless HTTP Program exited with ${stopped.code}: ${diagnostics}`,
          );
        }
      }
      if (shutdownFailure) throw shutdownFailure;
    },
  );

  test("restarts development Processes after a source update", async () => {
    const fixture = await createFixture(httpProgramSource("first"));
    const port = await availablePort();
    const revisions = revisionSource(fixture.system);
    const ir = revisions.current.ir;
    const events: DevelopmentEvent[] = [];
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      system: fixture.system,
      ir,
      revisions,
      programs: ir.programs,
      interfaces: [],
      platform: "server",
      report: (event) => events.push(event),
    });

    try {
      expect(await fetchText(`http://localhost:${port}/probe`)).toBe("first");
      let sampling = true;
      const observed: string[] = [];
      const requests = (async () => {
        while (sampling) {
          try {
            observed.push(await fetchText(`http://localhost:${port}/probe`));
          } catch (error) {
            observed.push(`error:${error instanceof Error ? error.message : String(error)}`);
          }
        }
      })();
      await writeFile(fixture.system, httpProgramSource("second"));
      await expect
        .poll(() => fetchText(`http://localhost:${port}/probe`), { timeout: 5_000 })
        .toBe("second");
      expect(events).toEqual([
        expect.objectContaining({
          kind: "update",
          platform: "server",
          scope: "program",
          outputs: ["api"],
        }),
      ]);
      sampling = false;
      await requests;
      expect(observed.length).toBeGreaterThan(0);
      expect(
        observed.every((value) => value === "first" || value === "second"),
        `observed responses during replacement: ${JSON.stringify([...new Set(observed)])}`,
      ).toBe(true);
    } finally {
      await session[Symbol.asyncDispose]();
    }
  });

  test("hot-replaces a Feature-owned provider and disposes its previous scope", async () => {
    const fixture = await createProviderFixture("first");
    const port = await availablePort();
    const revisions = revisionSource(fixture.system);
    const ir = revisions.current.ir;
    expect(
      revisions.current.outputSources["program/server"]?.some((source) =>
        source.endsWith("/provider.ts"),
      ),
    ).toBe(true);
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      system: fixture.system,
      ir,
      revisions,
      programs: ir.programs,
      interfaces: [],
      platform: "server",
    });

    try {
      expect(await fetchText(`http://localhost:${port}/probe`)).toBe("first");
      await writeFile(fixture.provider, providerSource("second"));
      await expect
        .poll(() => fetchText(`http://localhost:${port}/probe`), { timeout: 5_000 })
        .toBe("second");
      await expect
        .poll(() => fetchText(`http://localhost:${port}/disposals`), { timeout: 5_000 })
        .toBe("1");
    } finally {
      await session[Symbol.asyncDispose]();
    }
  });

  test("preserves a server Process across browser-only source updates", async () => {
    const fixture = await createSplitFixture();
    const port = await availablePort();
    const revisions = revisionSource(fixture.system);
    const ir = revisions.current.ir;
    const programs = ir.programs.filter(({ environment }) => environment.platform === "server");
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      system: fixture.system,
      ir,
      revisions,
      programs,
      interfaces: [],
      platform: "server",
    });

    try {
      const identity = await fetchText(`http://localhost:${port}/probe`);
      await writeFile(fixture.browser, browserProgramSource("second"));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      expect(await fetchText(`http://localhost:${port}/probe`)).toBe(identity);
    } finally {
      await session[Symbol.asyncDispose]();
    }
  });

  test("restarts server Processes when System metadata changes", async () => {
    const fixture = await createFixture(metadataProgramSource("first"));
    const port = await availablePort();
    const revisions = revisionSource(fixture.system);
    const ir = revisions.current.ir;
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      system: fixture.system,
      ir,
      revisions,
      programs: ir.programs,
      interfaces: [],
      platform: "server",
    });

    try {
      const identity = await fetchText(`http://localhost:${port}/probe`);
      await writeFile(fixture.system, metadataProgramSource("second"));
      await expect
        .poll(() => fetchText(`http://localhost:${port}/probe`), { timeout: 5_000 })
        .not.toBe(identity);
    } finally {
      await session[Symbol.asyncDispose]();
    }
  });
});

async function createFixture(source: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-server-adapter-"));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, "src");
  const system = resolve(sourceDirectory, "system.ts");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(system, source);
  return { directory, system };
}

async function createSplitFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-server-selective-reload-"));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, "src");
  const system = resolve(sourceDirectory, "system.ts");
  const server = resolve(sourceDirectory, "server.ts");
  const browser = resolve(sourceDirectory, "browser.ts");
  await mkdir(sourceDirectory, { recursive: true });
  await Promise.all([
    writeFile(system, splitSystemSource()),
    writeFile(server, splitServerSource()),
    writeFile(browser, browserProgramSource("first")),
  ]);
  return { directory, system, browser };
}

async function createProviderFixture(value: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-server-provider-reload-"));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, "src");
  const system = resolve(sourceDirectory, "system.ts");
  const provider = resolve(sourceDirectory, "provider.ts");
  await mkdir(sourceDirectory, { recursive: true });
  await Promise.all([
    writeFile(system, providerSystemSource()),
    writeFile(provider, providerSource(value)),
  ]);
  return { directory, system, provider };
}

function revisionSource(system: string) {
  return createSystemRevisionSource(system, [serverCompilerExtension, webCompilerExtension]);
}

function twoProgramSource(): string {
  return `${types()}
type Root = { Features: {
  api: { Programs: { api: Program<Server, { Requires: { clock: Clock } }> } };
  worker: { Programs: { worker: Program<Server> } };
} };
const api = createFeature<Root["Features"]["api"]>({ programs: { api: {} } });
const worker = createFeature<Root["Features"]["worker"]>({ programs: { worker: {} } });
export default createSystem({
  metadata: { name: "server-artifacts" },
  features: { api, worker },
});
`;
}

function httpProgramSource(value: string): string {
  return `${types()}
type Root = { Features: {
  probe: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
const probe = createFeature<Root["Features"]["probe"]>({
  programs: {
    api: {
      start({ dependencies }: { dependencies: { http: Http } }) {
        return dependencies.http.route({
          path: "/probe",
          handle: async () => ({ status: 200, headers: [], body: ${JSON.stringify(value)}, stream: undefined }),
        });
      },
    },
  },
});
export default createSystem({
  metadata: { name: "server-reload" },
  features: { probe },
});
`;
}

function providerSystemSource(): string {
  return `${types()}
import { probeProvider } from "./provider";
type Probe = Dependency<{
  Operations: { read(input: {}): string; disposals(input: {}): string };
}>;
type Root = { Features: {
  probe: {
    Programs: { server: Program<Server, { Requires: { http: Http; probe: Probe } }> };
    Providers: { server: { probe: object } };
  };
} };
const probe = createFeature<Root["Features"]["probe"]>({
  providers: { server: { probe: probeProvider } },
  programs: {
    server: {
      start({ dependencies }: { dependencies: { http: Http; probe: Probe } }) {
        const route = dependencies.http.route({
          path: "/probe",
          async handle() {
            return {
              status: 200,
              headers: [],
              body: dependencies.probe.read({}),
              stream: undefined,
            };
          },
        });
        const disposals = dependencies.http.route({
          path: "/disposals",
          async handle() {
            return {
              status: 200,
              headers: [],
              body: dependencies.probe.disposals({}),
              stream: undefined,
            };
          },
        });
        return {
          [Symbol.dispose]() {
            disposals[Symbol.dispose]();
            route[Symbol.dispose]();
          },
        };
      },
    },
  },
});
export default createSystem({
  metadata: { name: "provider-reload" },
  features: { probe },
});
`;
}

function providerSource(value: string): string {
  return `const state = globalThis as typeof globalThis & { __kitProviderDisposals?: number };
export const probeProvider = {
  development() {
    return {
      read() {
        return ${JSON.stringify(value)};
      },
      disposals() {
        return String(state.__kitProviderDisposals ?? 0);
      },
      [Symbol.dispose]() {
        state.__kitProviderDisposals = (state.__kitProviderDisposals ?? 0) + 1;
      },
    };
  },
  production: {
    configuration: [],
    crate: { package: "fixture-provider", directory: "." },
    rust: { type: "fixture_provider::Provider", constructor: "fixture_provider::create" },
  },
};
`;
}

function metadataProgramSource(name: string): string {
  return `${types()}
type Root = { Features: {
  probe: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
const identity = ${JSON.stringify(name)};
const probe = createFeature<Root["Features"]["probe"]>({
  programs: {
    api: {
      start({ dependencies }: { dependencies: { http: Http } }) {
        return dependencies.http.route({
          path: "/probe",
          handle: async () => ({ status: 200, headers: [], body: identity, stream: undefined }),
        });
      },
    },
  },
});
export default createSystem({
  metadata: { name: ${JSON.stringify(name)} },
  features: { probe },
});
`;
}

function splitSystemSource(): string {
  return `${types()}
import { browser } from "./browser";
import { server } from "./server";
type BrowserPlatform = { Name: "web" };
type Browser = { Name: "browser-main"; Platform: BrowserPlatform };
type Root = { Features: {
  browser: { Programs: { browser: Program<Browser> } };
  server: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
export default createSystem({
  metadata: { name: "selective-reload" },
  features: {
    browser: createFeature<Root["Features"]["browser"]>(browser),
    server: createFeature<Root["Features"]["server"]>(server),
  },
});
`;
}

function splitServerSource(): string {
  return `
type HttpResponse = { status: number; headers: readonly { name: string; value: string }[]; body: string | undefined; stream: AsyncIterable<string> | undefined };
type Http = { route(input: { path: string; handle(request: { method: string; path: string; query: readonly { name: string; value: string }[]; headers: readonly { name: string; value: string }[]; body: string }): Promise<HttpResponse> }): Disposable };
const identity = "stable-server";
export const server = {
  programs: {
    api: {
      start({ dependencies }: { dependencies: { http: Http } }) {
        return dependencies.http.route({
          path: "/probe",
          handle: async () => ({ status: 200, headers: [], body: identity, stream: undefined }),
        });
      },
    },
  },
};
`;
}

function browserProgramSource(value: string): string {
  return `export const browser = { programs: { browser: { state: { value: ${JSON.stringify(value)} } } } };\n`;
}

function types(): string {
  return `
type Platform = { Name: "server" };
type Server = { Name: "server"; Platform: Platform };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
declare const featureContract: unique symbol;
declare const dependencyDefinition: unique symbol;
type Dependency<Definition extends { Operations: object }> = Readonly<
  Definition["Operations"] & { readonly [dependencyDefinition]?: Definition }
>;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}
type HttpResponse = { status: number; headers: readonly { name: string; value: string }[]; body: string | undefined; stream: AsyncIterable<string> | undefined };
type Http = Dependency<{
  Operations: {
    route(input: { path: string; handle(request: { method: string; path: string; query: readonly { name: string; value: string }[]; headers: readonly { name: string; value: string }[]; body: string }): Promise<HttpResponse> }): Disposable;
  };
}>;
type Clock = Dependency<{ Operations: { now(input: {}): number } }>;
`;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port was assigned.");
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function fetchText(url: string): Promise<string> {
  return (await fetch(url)).text();
}

function run(file: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, [], { stdio: "pipe" });
    let error = "";
    child.stderr.setEncoding("utf8").on("data", (value: string) => (error += value));
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Production Program did not exit: ${error || file}`));
    }, 10_000);
    child.once("error", (spawnError) => {
      clearTimeout(timeout);
      reject(spawnError);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (signal) reject(new Error(`Production Program exited from ${signal}: ${error || file}`));
      else resolvePromise(code ?? 1);
    });
  });
}
