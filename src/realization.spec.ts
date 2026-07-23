import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { SourceCompilerExtension } from "@/compiler/extension";
import { linkProgram } from "@/compiler/linker";
import type {
  PlatformDevelopmentInput,
  PlatformProductionInput,
  PlatformAdapterImplementation,
} from "@/contracts/platform";
import { buildSystem, developSystem, resolveSystemRealization } from "@/realization";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("System realization", () => {
  test("selects whole-System and focused-App outputs without duplicating shared Programs", async () => {
    const directory = await fixture();
    const adapters = {
      server: adapter("server"),
      web: adapter("web"),
    };

    const complete = resolveSystemRealization(directory, adapters);
    expect(complete.programs.map(({ id }) => id)).toEqual([
      "program/api",
      "program/customer.web.browser",
      "program/operations.web.browser",
    ]);
    expect(
      complete.programs
        .find(({ id }) => id === "program/api")
        ?.contributions.map(({ feature }) => feature),
    ).toEqual(["customer.service", "operations.service", "shared"]);
    expect(complete.interfaces.map(({ id }) => id)).toEqual([
      "interface/customer.web",
      "interface/operations.web",
    ]);

    const focused = resolveSystemRealization(directory, adapters, {
      app: "operations",
    });
    expect(focused.programs.map(({ id }) => id)).toEqual([
      "program/api",
      "program/operations.web.browser",
    ]);
    expect(
      focused.programs
        .find(({ id }) => id === "program/api")
        ?.contributions.map(({ feature }) => feature),
    ).toEqual(["operations.service", "shared"]);
    expect(focused.interfaces.map(({ id }) => id)).toEqual(["interface/operations.web"]);
  });

  test("compiles once, starts independent adapters concurrently, and disposes in reverse order", async () => {
    const directory = await fixture();
    const events: string[] = [];
    let compilations = 0;
    let waiting = 0;
    let release!: () => void;
    const rendezvous = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const extension: SourceCompilerExtension = {
      name: "count",
      system() {
        compilations += 1;
        return undefined;
      },
    };
    const concurrent = (name: string, compiler: readonly SourceCompilerExtension[] = []) =>
      adapter(name, {
        compiler,
        async develop(input) {
          events.push(`start:${name}`);
          waiting += 1;
          if (waiting === 2) release();
          await rendezvous;
          return session(
            Object.fromEntries([
              ...input.programs.map(({ id }) => [id, [`${name}:${id}`]]),
              ...input.interfaces.map(({ id }) => [id, [`${name}:${id}`]]),
            ]),
            () => events.push(`dispose:${name}`),
          );
        },
      });

    const running = await developSystem(directory, {
      server: concurrent("server", [extension]),
      web: concurrent("web"),
    });

    expect(compilations).toBe(1);
    expect(events).toEqual(["start:server", "start:web"]);
    expect(Object.keys(running.locations)).toEqual([
      "interface/customer.web",
      "interface/operations.web",
      "program/api",
      "program/customer.web.browser",
      "program/operations.web.browser",
    ]);

    await running[Symbol.asyncDispose]();
    expect(events.slice(-2)).toEqual(["dispose:web", "dispose:server"]);
  });

  test("disposes every successful owner once when concurrent startup fails", async () => {
    const directory = await fixture();
    const disposals: string[] = [];
    const failure = new Error("web failed");

    await expect(
      developSystem(directory, {
        server: adapter("server", {
          async develop() {
            return session({}, () => disposals.push("server"));
          },
        }),
        web: adapter("web", {
          async develop() {
            await Promise.resolve();
            throw failure;
          },
        }),
      }),
    ).rejects.toBe(failure);
    expect(disposals).toEqual(["server"]);
  });

  test("passes identical linked Program meaning to development and production adapters", async () => {
    const directory = await fixture();
    const development: string[] = [];
    const production: string[] = [];
    const semantic = (programs: PlatformDevelopmentInput["programs"]) =>
      programs.map((program) => JSON.stringify(linkProgram(program)));
    const adapters = {
      server: adapter("server", {
        async develop(input) {
          development.push(...semantic(input.programs));
          return session({});
        },
        async build(input) {
          production.push(...semantic(input.programs));
          return {
            directory: input.output,
            entries: input.programs.map((program) => ({
              identity: program.id,
              kind: "program" as const,
              environment: program.environment.name,
              path: resolve(input.output, program.name),
            })),
          };
        },
      }),
      web: adapter("web"),
    };

    await using running = await developSystem(directory, adapters, {
      app: "operations",
    });
    void running;
    const built = await buildSystem(directory, resolve(directory, "dist"), adapters, {
      app: "operations",
    });

    expect(development).toEqual(production);
    expect(built.artifacts.server?.entries.map(({ identity }) => identity)).toEqual([
      "program/api",
    ]);
  });
});

function adapter(
  name: string,
  overrides: Partial<PlatformAdapterImplementation> = {},
): PlatformAdapterImplementation {
  return {
    name,
    async develop() {
      return session({});
    },
    async build(input: PlatformProductionInput) {
      return { directory: input.output, entries: [] };
    },
    ...overrides,
  };
}

function session(
  locations: Readonly<Record<string, readonly string[]>>,
  dispose: () => void = () => {},
) {
  return {
    locations,
    async [Symbol.asyncDispose]() {
      dispose();
    },
  };
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-realization-"));
  directories.push(directory);
  await mkdir(resolve(directory, "src"), { recursive: true });
  await writeFile(
    resolve(directory, "src/system.ts"),
    `
declare const featureContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}
type Program<Environment, Contract extends object = {}> =
  Readonly<Contract & { Environment: Environment }>;
type Server = { Name: "server"; Platform: { Name: "server" } };
type Browser = { Name: "browser-main"; Platform: { Name: "web" } };
type Shared = { Programs: { api: Program<Server> } };
type Service = { Programs: { api: Program<Server> } };
type Web = {
  Interface: { Platform: { Name: "web" } };
  Programs: { browser: Program<Browser> };
};
type Product = {
  App: true;
  Features: { service: Service; web: Web };
};
const shared = createFeature<Shared>({ programs: { api: {} } });
const operationsService = createFeature<Service>({ programs: { api: {} } });
const operationsWeb = createFeature<Web>({
  programs: { browser: {} },
  presentation: { parameters: {}, create() { return {}; } },
});
const operations = createFeature<Product>({
  features: { service: operationsService, web: operationsWeb },
});
const customerService = createFeature<Service>({ programs: { api: {} } });
const customerWeb = createFeature<Web>({
  programs: { browser: {} },
  presentation: { parameters: {}, create() { return {}; } },
});
const customer = createFeature<Product>({
  features: { service: customerService, web: customerWeb },
});
export default createSystem({
  metadata: { name: "Company" },
  features: { shared, operations, customer },
});
`,
  );
  return directory;
}
