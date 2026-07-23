import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createServerPlatformAdapter } from "@/adapters/server/adapter";
import { compileApplication } from "@/compiler/source";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("server Platform adapter", () => {
  test("emits and launches one independent artifact per named Program", async () => {
    const fixture = await createFixture(twoProgramSource());
    const ir = compileApplication(fixture.application);
    const output = resolve(fixture.directory, "dist");
    const result = await createServerPlatformAdapter().build({
      directory: fixture.directory,
      application: fixture.application,
      ir,
      programs: ir.programs,
      platform: "server",
      output,
    });

    expect(result.entries.map(({ program }) => program)).toEqual(["api", "worker"]);
    for (const artifact of result.entries) {
      await access(artifact.path);
      await expect(run(artifact.path)).resolves.toBe(0);
    }
  }, 120_000);

  test("restarts development Processes after a source update", async () => {
    const fixture = await createFixture(httpProgramSource("first"));
    const port = await availablePort();
    const ir = compileApplication(fixture.application);
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      application: fixture.application,
      ir,
      programs: ir.programs,
      platform: "server",
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
      await writeFile(fixture.application, httpProgramSource("second"));
      await expect
        .poll(() => fetchText(`http://localhost:${port}/probe`), { timeout: 5_000 })
        .toBe("second");
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

  test("preserves a server Process across browser-only source updates", async () => {
    const fixture = await createSplitFixture();
    const port = await availablePort();
    const ir = compileApplication(fixture.application);
    const programs = ir.programs.filter(({ environment }) => environment.platform === "server");
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      application: fixture.application,
      ir,
      programs,
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

  test("restarts server Processes when application metadata changes", async () => {
    const fixture = await createFixture(metadataProgramSource("first"));
    const port = await availablePort();
    const ir = compileApplication(fixture.application);
    const session = await createServerPlatformAdapter({ developmentPort: port }).develop({
      directory: fixture.directory,
      application: fixture.application,
      ir,
      programs: ir.programs,
      platform: "server",
    });

    try {
      const identity = await fetchText(`http://localhost:${port}/probe`);
      await writeFile(fixture.application, metadataProgramSource("second"));
      await expect
        .poll(() => fetchText(`http://localhost:${port}/probe`), { timeout: 5_000 })
        .not.toBe(identity);
    } finally {
      await session[Symbol.asyncDispose]();
    }
  });
});

async function createFixture(source: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-server-adapter-"));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, "src");
  const application = resolve(sourceDirectory, "app.ts");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(application, source);
  return { directory, application };
}

async function createSplitFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-server-selective-reload-"));
  temporaryDirectories.push(directory);
  const sourceDirectory = resolve(directory, "src");
  const application = resolve(sourceDirectory, "app.ts");
  const server = resolve(sourceDirectory, "server.ts");
  const browser = resolve(sourceDirectory, "browser.ts");
  await mkdir(sourceDirectory, { recursive: true });
  await Promise.all([
    writeFile(application, splitApplicationSource()),
    writeFile(server, splitServerSource()),
    writeFile(browser, browserProgramSource("first")),
  ]);
  return { directory, application, browser };
}

function twoProgramSource(): string {
  return `${types()}
type App = { Features: {
  api: { Programs: { api: Program<Server> } };
  worker: { Programs: { worker: Program<Server> } };
} };
export default {
  metadata: { name: "server-artifacts" },
  features: {
    api: { programs: { api: {} } },
    worker: { programs: { worker: {} } },
  },
} satisfies Application<App>;
`;
}

function httpProgramSource(value: string): string {
  return `${types()}
type App = { Features: {
  probe: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
export default {
  metadata: { name: "server-reload" },
  features: {
    probe: {
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
    },
  },
} satisfies Application<App>;
`;
}

function metadataProgramSource(name: string): string {
  return `${types()}
type App = { Features: {
  probe: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
const identity = ${JSON.stringify(name)};
export default {
  metadata: { name: ${JSON.stringify(name)} },
  features: {
    probe: {
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
    },
  },
} satisfies Application<App>;
`;
}

function splitApplicationSource(): string {
  return `${types()}
import { browser } from "./browser";
import { server } from "./server";
type BrowserPlatform = { Name: "web" };
type Browser = { Name: "browser-main"; Platform: BrowserPlatform };
type App = { Features: {
  browser: { Programs: { browser: Program<Browser> } };
  server: { Programs: { api: Program<Server, { Requires: { http: Http } }> } };
} };
export default {
  metadata: { name: "selective-reload" },
  features: { browser, server },
} satisfies Application<App>;
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
type Application<Contract> = unknown;
type HttpResponse = { status: number; headers: readonly { name: string; value: string }[]; body: string | undefined; stream: AsyncIterable<string> | undefined };
type Http = { route(input: { path: string; handle(request: { method: string; path: string; query: readonly { name: string; value: string }[]; headers: readonly { name: string; value: string }[]; body: string }): Promise<HttpResponse> }): Disposable };
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
