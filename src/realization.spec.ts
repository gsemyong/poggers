import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  DevelopmentEvent,
  PlatformDevelopmentInput,
  PlatformAdapterImplementation,
  PlatformProductionInput,
  ProductionEvent,
} from "@/adapter";
import type { SourceCompilerExtension } from "@/compiler/extension";
import { serializeSystemIR } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { serverCompilerExtension } from "@/platforms/server/adapter";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import {
  buildSystem,
  createSystemRevisionSource,
  developSystem,
  resolveSystemRealization,
} from "@/realization";

const directories: string[] = [];
const mockCompilerExtensions = Object.freeze([
  mockCompilerExtension("server"),
  mockCompilerExtension("web"),
]);

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("System realization", { tags: ["compiler"] }, () => {
  test("selects whole-System and focused-Application outputs without duplicating shared Programs", async () => {
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
    ).toEqual(["customerService", "operationsService", "shared"]);
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
    ).toEqual(["operationsService", "shared"]);
    expect(focused.interfaces.map(({ id }) => id)).toEqual(["interface/operations.web"]);
  });

  test("compiles once, starts independent adapters concurrently, and disposes in reverse order", async () => {
    const directory = await fixture();
    const events: string[] = [];
    const reports: DevelopmentEvent[] = [];
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

    const running = await developSystem(
      directory,
      {
        server: concurrent("server", [extension]),
        web: concurrent("web"),
      },
      {
        report: (event) => reports.push(event),
      },
    );

    expect(compilations).toBe(1);
    expect(events).toEqual(["start:server", "start:web"]);
    expect(reports.slice(0, 4)).toEqual([
      { kind: "phase", phase: "compile", status: "started" },
      expect.objectContaining({
        kind: "phase",
        phase: "compile",
        status: "completed",
        cache: "miss",
      }),
      {
        kind: "phase",
        phase: "start",
        status: "started",
        platform: "server",
      },
      {
        kind: "phase",
        phase: "start",
        status: "started",
        platform: "web",
      },
    ]);
    expect(reports.slice(4)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "phase",
          phase: "start",
          status: "completed",
          platform: "server",
        }),
        expect.objectContaining({
          kind: "phase",
          phase: "start",
          status: "completed",
          platform: "web",
        }),
      ]),
    );
    expect(reports.slice(4)).toHaveLength(2);
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

  test("identifies exact shared and Application-private outputs from one retained graph", async () => {
    const fixture = await incrementalFixture();
    const revisions = createSystemRevisionSource(fixture.system, mockCompilerExtensions);
    expect(revisions.current.revision).toBe(0);

    expect(
      revisions.current.outputSources["interface/operations.web"]?.some((path) =>
        path.endsWith("/shared-ui.ts"),
      ),
    ).toBe(true);
    expect(
      revisions.current.outputSources["interface/operations.web"]?.some((path) =>
        path.endsWith("/customer.ts"),
      ),
    ).toBe(false);
    expect(
      revisions.current.outputSources["interface/operations.web"]?.some((path) =>
        path.endsWith("/operations-label.ts"),
      ),
    ).toBe(true);
    expect(
      revisions.current.outputSources["interface/customer.web"]?.some((path) =>
        path.endsWith("/operations-label.ts"),
      ),
    ).toBe(false);

    await writeFile(
      fixture.operations,
      fixture.operationsSource.replace('label: "operations"', 'label: "operations-2"'),
    );
    const operationsRevision = revisions.compile(fixture.operations);
    expect(operationsRevision.revision).toBe(1);
    expect(operationsRevision.work.features).toEqual({ compiled: 1, reused: 2 });
    expect(operationsRevision.change?.outputs).toEqual([
      "interface/operations.web",
      "program/operations.web.browser",
    ]);
    expect(serializeSystemIR(operationsRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );
    expect(revisions.compile(fixture.operations)).toBe(operationsRevision);

    await writeFile(
      fixture.operationsType,
      fixture.operationsTypeSource.replace('"operations"', '"operations-typed"'),
    );
    const typeRevision = revisions.compile(fixture.operationsType);
    expect(typeRevision.work.features).toEqual({ compiled: 1, reused: 2 });
    expect(typeRevision.change?.outputs).toEqual([
      "interface/operations.web",
      "program/operations.web.browser",
    ]);
    expect(serializeSystemIR(typeRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );
    expect(revisions.compile(fixture.operationsType)).toBe(typeRevision);

    await writeFile(fixture.sharedUI, 'export const marker = "shared-2";\n');
    const sharedUIRevision = revisions.compile(fixture.sharedUI);
    expect(sharedUIRevision.work.features).toEqual({ compiled: 2, reused: 1 });
    expect(sharedUIRevision.change?.outputs).toEqual([
      "interface/customer.web",
      "interface/operations.web",
      "program/customer.web.browser",
      "program/operations.web.browser",
    ]);
    expect(serializeSystemIR(sharedUIRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );

    await writeFile(
      fixture.shared,
      fixture.sharedSource.replace('label: "shared"', 'label: "shared-2"'),
    );
    const sharedRevision = revisions.compile(fixture.shared);
    expect(sharedRevision.work.features).toEqual({ compiled: 1, reused: 2 });
    expect(sharedRevision.change?.outputs).toEqual(["program/api"]);
    expect(serializeSystemIR(sharedRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );
  });

  test("reuses exact cached System meaning and invalidates it from resolved source changes", async () => {
    const fixture = await incrementalFixture();

    const first = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(first.current.cache).toBe("miss");

    const second = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(second.current.cache).toBe("hit");
    expect(second.current.work.features).toEqual({ compiled: 0, reused: 3 });
    expect(serializeSystemIR(second.current.ir)).toBe(serializeSystemIR(first.current.ir));

    const extensionSource = resolve(fixture.system, "../../cache-extension.ts");
    await writeFile(extensionSource, "export const revision = 1;\n");
    const extension: SourceCompilerExtension = {
      name: "cache-probe",
      cacheSources: [extensionSource],
      system() {
        return { revision: 1 };
      },
    };
    const extended = createSystemRevisionSource(
      fixture.system,
      [...mockCompilerExtensions, extension],
      true,
    );
    expect(extended.current.cache).toBe("miss");
    expect(extended.current.ir.system.extensions).toEqual({
      "cache-probe": { revision: 1 },
    });
    expect(
      createSystemRevisionSource(fixture.system, [...mockCompilerExtensions, extension], true)
        .current.cache,
    ).toBe("hit");
    await writeFile(extensionSource, "export const revision = 2;\n");
    expect(
      createSystemRevisionSource(fixture.system, [...mockCompilerExtensions, extension], true)
        .current.cache,
    ).toBe("miss");

    await writeFile(
      fixture.operations,
      fixture.operationsSource.replaceAll("browser", "browserNext"),
    );
    const changed = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(changed.current.cache).toBe("miss");
    expect(serializeSystemIR(changed.current.ir)).not.toBe(serializeSystemIR(first.current.ir));
  });

  test("restores unaffected semantic units from a stale development cache", async () => {
    const fixture = await incrementalFixture();
    const first = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(first.current.cache).toBe("miss");

    await writeFile(
      fixture.operations,
      fixture.operationsSource.replace('label: "operations"', 'label: "operations-restored"'),
    );
    const restored = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);

    expect(restored.current.cache).toBe("miss");
    expect(restored.current.work.features).toEqual({ compiled: 1, reused: 2 });
    expect(serializeSystemIR(restored.current.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );

    await writeFile(resolve(fixture.system, "../../.kit/cache/compiler/system.json"), "{broken");
    const recovered = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(recovered.current.cache).toBe("miss");
    expect(recovered.current.work.features).toEqual({ compiled: 3, reused: 0 });
    expect(serializeSystemIR(recovered.current.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );
  });

  test("invalidates every semantic unit when shared compiler input changes", async () => {
    const fixture = await incrementalFixture();
    const first = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);
    expect(first.current.work.features).toEqual({ compiled: 3, reused: 0 });

    await writeFile(fixture.contracts, `${fixture.contractsSource}\n`);
    const restored = createSystemRevisionSource(fixture.system, mockCompilerExtensions, true);

    expect(restored.current.cache).toBe("miss");
    expect(restored.current.work.features).toEqual({ compiled: 3, reused: 0 });
    expect(serializeSystemIR(restored.current.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system, mockCompilerExtensions)),
    );
  });

  test(
    "keeps unchanged multi-Application meaning stable across retained compilations",
    { tags: ["package"], timeout: 30_000 },
    () => {
      const system = resolve(import.meta.dirname, "../examples/authenticated-crud/src/system.ts");
      const revisions = createSystemRevisionSource(system, [
        serverCompilerExtension,
        webCompilerExtension,
      ]);
      const initial = serializeSystemIR(revisions.current.ir);

      const revision = revisions.compile(
        resolve(import.meta.dirname, "../examples/authenticated-crud/src/apps/operations.tsx"),
      );

      expect(serializeSystemIR(revision.ir)).toBe(initial);
      expect(revision.change).toBeUndefined();
    },
  );

  test(
    "assigns Application composition sources only to their owned outputs",
    { tags: ["package"], timeout: 30_000 },
    () => {
      const root = resolve(import.meta.dirname, "../examples/authenticated-crud/src");
      const revisions = createSystemRevisionSource(resolve(root, "system.ts"), [
        serverCompilerExtension,
        webCompilerExtension,
      ]);
      const customer = resolve(root, "apps/customer.tsx");
      const operations = resolve(root, "apps/operations.tsx");

      expect(revisions.current.outputSources["interface/customer.web"]).toContain(customer);
      expect(revisions.current.outputSources["program/customer.web.browser"]).toContain(customer);
      expect(revisions.current.outputSources["interface/customer.web"]).not.toContain(operations);
      expect(revisions.current.outputSources["program/customer.web.browser"]).not.toContain(
        operations,
      );

      expect(revisions.current.outputSources["interface/operations.web"]).toContain(operations);
      expect(revisions.current.outputSources["program/operations.web.browser"]).toContain(
        operations,
      );
      expect(revisions.current.outputSources["interface/operations.web"]).not.toContain(customer);
      expect(revisions.current.outputSources["program/operations.web.browser"]).not.toContain(
        customer,
      );
    },
  );

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
    const reports: ProductionEvent[] = [];
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
          await mkdir(input.output, { recursive: true });
          await Promise.all(
            input.programs.map((program) =>
              writeFile(resolve(input.output, program.name), program.id),
            ),
          );
          return {
            directory: input.output,
            entries: input.programs.map((program) => ({
              identity: program.id,
              kind: "program" as const,
              deployment: "process" as const,
              environment: program.environment.name,
              path: resolve(input.output, program.name),
              entrypoint: resolve(input.output, program.name),
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
      report: (event) => reports.push(event),
    });

    expect(development).toEqual(production);
    expect(reports.slice(0, 4)).toEqual([
      { kind: "phase", phase: "compile", status: "started" },
      expect.objectContaining({
        kind: "phase",
        phase: "compile",
        status: "completed",
      }),
      {
        kind: "phase",
        phase: "build",
        status: "started",
        platform: "server",
      },
      {
        kind: "phase",
        phase: "build",
        status: "started",
        platform: "web",
      },
    ]);
    expect(reports.slice(4, 6)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "phase",
          phase: "build",
          status: "completed",
          platform: "server",
        }),
        expect.objectContaining({
          kind: "phase",
          phase: "build",
          status: "completed",
          platform: "web",
        }),
      ]),
    );
    expect(reports.slice(4, 6)).toHaveLength(2);
    expect(reports.slice(6)).toEqual([
      { kind: "phase", phase: "release", status: "started" },
      expect.objectContaining({
        kind: "phase",
        phase: "release",
        status: "completed",
      }),
    ]);
    expect(built.artifacts.server?.entries.map(({ identity }) => identity)).toEqual([
      "program/api",
    ]);
    expect(built.release).toMatchObject({
      version: 2,
      system: "Company",
      app: "operations",
      artifacts: [
        {
          identity: "program/api",
          platform: "server",
          entrypoint: "server/api",
        },
      ],
    });
    await expect(readFile(resolve(directory, "dist/release.json"), "utf8")).resolves.toContain(
      built.release.digest,
    );
  });
});

function adapter(
  name: string,
  overrides: Partial<PlatformAdapterImplementation> = {},
): PlatformAdapterImplementation {
  const compiler = [
    mockCompilerExtension(name),
    ...(overrides.compiler ?? []),
  ] satisfies readonly SourceCompilerExtension[];
  return {
    name,
    async develop() {
      return session({});
    },
    async build(input: PlatformProductionInput) {
      return { directory: input.output, entries: [] };
    },
    ...overrides,
    compiler,
  };
}

function mockCompilerExtension(name: string): SourceCompilerExtension {
  return Object.freeze({
    name,
    program: () => ({ ir: { version: 1 } }),
    interface: () => ({ ir: { version: 1 } }),
  });
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
  const directory = await mkdtemp(resolve(tmpdir(), "kit-realization-"));
  directories.push(directory);
  await mkdir(resolve(directory, "src"), { recursive: true });
  await writeFile(
    resolve(directory, "src/system.ts"),
    `
declare const featureContract: unique symbol;
declare const applicationContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
type Application<Contract> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: Contract;
    Features: Contract extends { Features: infer Features } ? Features : {};
    Interfaces: Contract extends { Interfaces: infer Interfaces } ? Interfaces : {};
  };
}>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createApplication<Contract>(definition: object): Application<Contract> {
  return definition as Application<Contract>;
}
function createInterface<Contract>(definition: object): Contract {
  return definition as Contract;
}
function createSystem(definition: object): object {
  return definition;
}
type Program<Environment, Contract extends object = {}> =
  Readonly<Contract & { Environment: Environment }>;
type Server = { Name: "server"; Platform: { Name: "server" } };
type Browser = { Name: "browser-main"; Platform: { Name: "web" } };
type Shared = { Programs: { api: Program<Server> } };
type Service<Name extends string> = {
  Instance: Name;
  Programs: { api: Program<Server>; browser: Program<Browser> };
};
type Web = { Interface: { Platform: { Name: "web" } } };
type Product<Name extends string> = {
  Features: { service: Service<Name> };
  Interfaces: { web: Web };
};
const shared = createFeature<Shared>({ programs: { api: {} } });
const operationsService = createFeature<Service<"operations">>({
  programs: { api: {}, browser: {} },
});
const operationsWeb = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
const operations = createApplication<Product<"operations">>({
  interfaces: { web: operationsWeb },
});
const customerService = createFeature<Service<"customer">>({
  programs: { api: {}, browser: {} },
});
const customerWeb = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
const customer = createApplication<Product<"customer">>({
  interfaces: { web: customerWeb },
});
export default createSystem({
  metadata: { name: "Company" },
  features: { shared, operationsService, customerService },
  applications: { operations, customer },
});
`,
  );
  return directory;
}

async function incrementalFixture(): Promise<{
  system: string;
  contracts: string;
  shared: string;
  sharedUI: string;
  operations: string;
  operationsType: string;
  customer: string;
  sharedSource: string;
  operationsSource: string;
  operationsTypeSource: string;
  contractsSource: string;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-incremental-"));
  directories.push(directory);
  const source = resolve(directory, "src");
  await mkdir(source, { recursive: true });
  const contracts = `
export declare const featureContract: unique symbol;
export declare const applicationContract: unique symbol;
export type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
export type Application<Contract> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: Contract;
    Features: Contract extends { Features: infer Features } ? Features : {};
    Interfaces: Contract extends { Interfaces: infer Interfaces } ? Interfaces : {};
  };
}>;
export function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
export function createApplication<Contract>(definition: object): Application<Contract> {
  return definition as Application<Contract>;
}
export function createInterface<Contract>(definition: object): Contract {
  return definition as Contract;
}
export function createSystem(definition: object): object {
  return definition;
}
export type Program<Environment, Contract extends object = {}> = Readonly<
  Contract & { Environment: Environment }
>;
export type Server = { Name: "server"; Platform: { Name: "server" } };
export type Browser = { Name: "browser-main"; Platform: { Name: "web" } };
`;
  const sharedSource = `
import { createFeature, type Program, type Server } from "./contracts";
type Shared = { Programs: { api: Program<Server, { State: { label: "shared" } }> } };
export const shared = createFeature<Shared>({ programs: { api: {} } });
`;
  const appSource = (name: "operations" | "customer") => `
import { createApplication, createFeature, createInterface, type Browser, type Program } from "./contracts";
import { marker } from "./shared-ui";
${name === "operations" ? 'import type { OperationsLabel } from "./operations-label";' : ""}
void marker;
type Service = {
  Instance: "${name}";
  Programs: {
    browser: Program<Browser, { State: {
      label: "${name}";
      ${name === "operations" ? "typed: OperationsLabel;" : ""}
    } }>;
  };
};
type Web = { Interface: { Platform: { Name: "web" } } };
type Application = {
  Features: { service: Service };
  Interfaces: { web: Web };
};
export const ${name}Service = createFeature<Service>({
  programs: { browser: {} },
});
const web = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
export const ${name} = createApplication<Application>({
  interfaces: { web },
});
`;
  const operationsSource = appSource("operations");
  const operationsTypeSource = 'export type OperationsLabel = "operations";\n';
  const files = {
    system: resolve(source, "system.ts"),
    contracts: resolve(source, "contracts.ts"),
    shared: resolve(source, "shared.ts"),
    sharedUI: resolve(source, "shared-ui.ts"),
    operations: resolve(source, "operations.ts"),
    operationsType: resolve(source, "operations-label.ts"),
    customer: resolve(source, "customer.ts"),
  };
  await Promise.all([
    writeFile(files.contracts, contracts),
    writeFile(files.shared, sharedSource),
    writeFile(files.sharedUI, 'export const marker = "shared";\n'),
    writeFile(files.operations, operationsSource),
    writeFile(files.operationsType, operationsTypeSource),
    writeFile(files.customer, appSource("customer")),
    writeFile(
      files.system,
      `
import { createSystem } from "./contracts";
import { customer } from "./customer";
import { customerService } from "./customer";
import { operations } from "./operations";
import { operationsService } from "./operations";
import { shared } from "./shared";
export default createSystem({
  metadata: { name: "Company" },
  features: { shared, operationsService, customerService },
  applications: { operations, customer },
});
`,
    ),
  ]);
  return {
    ...files,
    sharedSource,
    operationsSource,
    operationsTypeSource,
    contractsSource: contracts,
  };
}
