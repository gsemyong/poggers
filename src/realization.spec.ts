import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  PlatformDevelopmentInput,
  PlatformProductionInput,
  PlatformAdapterImplementation,
} from "@/adapter";
import type { SourceCompilerExtension } from "@/compiler/extension";
import { serializeSystemIR } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import {
  buildSystem,
  createSystemRevisionSource,
  developSystem,
  resolveSystemRealization,
} from "@/realization";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("System realization", { tags: ["compiler"] }, () => {
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

  test("identifies exact shared and App-private outputs from one retained graph", async () => {
    const fixture = await incrementalFixture();
    const revisions = createSystemRevisionSource(fixture.system, []);
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
    expect(operationsRevision.work.features).toEqual({ compiled: 2, reused: 3 });
    expect(operationsRevision.work.presentations).toEqual({ compiled: 1, reused: 5 });
    expect(operationsRevision.change?.outputs).toEqual([
      "interface/operations.web",
      "program/operations.web.operations.web.browser",
    ]);
    expect(serializeSystemIR(operationsRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );
    expect(revisions.compile(fixture.operations)).toBe(operationsRevision);

    await writeFile(
      fixture.operationsType,
      fixture.operationsTypeSource.replace('"operations"', '"operations-typed"'),
    );
    const typeRevision = revisions.compile(fixture.operationsType);
    expect(typeRevision.work.features).toEqual({ compiled: 2, reused: 3 });
    expect(typeRevision.work.presentations).toEqual({ compiled: 0, reused: 6 });
    expect(typeRevision.change?.outputs).toEqual([
      "interface/operations.web",
      "program/operations.web.operations.web.browser",
    ]);
    expect(serializeSystemIR(typeRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );
    expect(revisions.compile(fixture.operationsType)).toBe(typeRevision);

    await writeFile(fixture.sharedUI, 'export const marker = "shared-2";\n');
    const sharedUIRevision = revisions.compile(fixture.sharedUI);
    expect(sharedUIRevision.work.features).toEqual({ compiled: 4, reused: 1 });
    expect(sharedUIRevision.work.presentations).toEqual({ compiled: 2, reused: 4 });
    expect(sharedUIRevision.change?.outputs).toEqual([
      "interface/customer.web",
      "interface/operations.web",
      "program/customer.web.customer.web.browser",
      "program/operations.web.operations.web.browser",
    ]);
    expect(serializeSystemIR(sharedUIRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );

    await writeFile(
      fixture.shared,
      fixture.sharedSource.replace('label: "shared"', 'label: "shared-2"'),
    );
    const sharedRevision = revisions.compile(fixture.shared);
    expect(sharedRevision.work.features).toEqual({ compiled: 1, reused: 4 });
    expect(sharedRevision.work.presentations).toEqual({ compiled: 0, reused: 6 });
    expect(sharedRevision.change?.outputs).toEqual(["program/api"]);
    expect(serializeSystemIR(sharedRevision.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );
  });

  test("reuses exact cached System meaning and invalidates it from resolved source changes", async () => {
    const fixture = await incrementalFixture();

    const first = createSystemRevisionSource(fixture.system, [], true);
    expect(first.current.cache).toBe("miss");

    const second = createSystemRevisionSource(fixture.system, [], true);
    expect(second.current.cache).toBe("hit");
    expect(second.current.work.features).toEqual({ compiled: 0, reused: 5 });
    expect(second.current.work.presentations).toEqual({ compiled: 0, reused: 6 });
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
    const extended = createSystemRevisionSource(fixture.system, [extension], true);
    expect(extended.current.cache).toBe("miss");
    expect(extended.current.ir.system.extensions).toEqual({
      "cache-probe": { revision: 1 },
    });
    expect(createSystemRevisionSource(fixture.system, [extension], true).current.cache).toBe("hit");
    await writeFile(extensionSource, "export const revision = 2;\n");
    expect(createSystemRevisionSource(fixture.system, [extension], true).current.cache).toBe(
      "miss",
    );

    await writeFile(
      fixture.operations,
      fixture.operationsSource.replace('label: "operations"', 'label: "cached-operations"'),
    );
    const changed = createSystemRevisionSource(fixture.system, [], true);
    expect(changed.current.cache).toBe("miss");
    expect(serializeSystemIR(changed.current.ir)).not.toBe(serializeSystemIR(first.current.ir));
  });

  test("restores unaffected semantic units from a stale development cache", async () => {
    const fixture = await incrementalFixture();
    const first = createSystemRevisionSource(fixture.system, [], true);
    expect(first.current.cache).toBe("miss");

    await writeFile(
      fixture.operations,
      fixture.operationsSource.replace('label: "operations"', 'label: "operations-restored"'),
    );
    const restored = createSystemRevisionSource(fixture.system, [], true);

    expect(restored.current.cache).toBe("miss");
    expect(restored.current.work.features).toEqual({ compiled: 2, reused: 3 });
    expect(restored.current.work.presentations).toEqual({ compiled: 1, reused: 5 });
    expect(serializeSystemIR(restored.current.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );

    await writeFile(resolve(fixture.system, "../../.kit/cache/compiler/system.json"), "{broken");
    const recovered = createSystemRevisionSource(fixture.system, [], true);
    expect(recovered.current.cache).toBe("miss");
    expect(recovered.current.work.features).toEqual({ compiled: 5, reused: 0 });
    expect(serializeSystemIR(recovered.current.ir)).toBe(
      serializeSystemIR(compileSystem(fixture.system)),
    );
  });

  test("keeps unchanged multi-App meaning stable across retained compilations", () => {
    const system = resolve(import.meta.dirname, "../examples/authenticated-crud/src/system.ts");
    const revisions = createSystemRevisionSource(system, [webCompilerExtension]);
    const initial = serializeSystemIR(revisions.current.ir);

    const revision = revisions.compile(
      resolve(import.meta.dirname, "../examples/authenticated-crud/src/apps/operations/app.tsx"),
    );

    expect(serializeSystemIR(revision.ir)).toBe(initial);
    expect(revision.change).toBeUndefined();
  }, 30_000);

  test("assigns App composition sources only to their owned outputs", () => {
    const root = resolve(import.meta.dirname, "../examples/authenticated-crud/src");
    const revisions = createSystemRevisionSource(resolve(root, "system.ts"), [
      webCompilerExtension,
    ]);
    const customer = resolve(root, "apps/customer/app.tsx");
    const operations = resolve(root, "apps/operations/app.tsx");

    expect(revisions.current.outputSources["interface/customer.web"]).toContain(customer);
    expect(revisions.current.outputSources["program/customer.web.browser"]).toContain(customer);
    expect(revisions.current.outputSources["interface/customer.web"]).not.toContain(operations);
    expect(revisions.current.outputSources["program/customer.web.browser"]).not.toContain(
      operations,
    );

    expect(revisions.current.outputSources["interface/operations.web"]).toContain(operations);
    expect(revisions.current.outputSources["program/operations.web.browser"]).toContain(operations);
    expect(revisions.current.outputSources["interface/operations.web"]).not.toContain(customer);
    expect(revisions.current.outputSources["program/operations.web.browser"]).not.toContain(
      customer,
    );
  }, 30_000);

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
    });

    expect(development).toEqual(production);
    expect(built.artifacts.server?.entries.map(({ identity }) => identity)).toEqual([
      "program/api",
    ]);
    expect(built.release).toMatchObject({
      version: 1,
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
  const directory = await mkdtemp(resolve(tmpdir(), "kit-realization-"));
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

async function incrementalFixture(): Promise<{
  system: string;
  shared: string;
  sharedUI: string;
  operations: string;
  operationsType: string;
  customer: string;
  sharedSource: string;
  operationsSource: string;
  operationsTypeSource: string;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-incremental-"));
  directories.push(directory);
  const source = resolve(directory, "src");
  await mkdir(source, { recursive: true });
  const contracts = `
export declare const featureContract: unique symbol;
export type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
export function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
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
import { createFeature, type Browser, type Program } from "./contracts";
import { marker } from "./shared-ui";
${name === "operations" ? 'import type { OperationsLabel } from "./operations-label";' : ""}
void marker;
type Web = {
  Interface: { Platform: { Name: "web" } };
  Programs: {
    "${name}.web.browser": Program<Browser, { State: {
      label: "${name}";
      ${name === "operations" ? "typed: OperationsLabel;" : ""}
    } }>;
  };
};
type App = { App: true; Features: { web: Web } };
const web = createFeature<Web>({
  programs: { "${name}.web.browser": {} },
  presentation: { parameters: {}, create() { return {}; } },
});
export const ${name} = createFeature<App>({ features: { web } });
`;
  const operationsSource = appSource("operations");
  const operationsTypeSource = 'export type OperationsLabel = "operations";\n';
  const files = {
    system: resolve(source, "system.ts"),
    shared: resolve(source, "shared.ts"),
    sharedUI: resolve(source, "shared-ui.ts"),
    operations: resolve(source, "operations.ts"),
    operationsType: resolve(source, "operations-label.ts"),
    customer: resolve(source, "customer.ts"),
  };
  await Promise.all([
    writeFile(resolve(source, "contracts.ts"), contracts),
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
import { operations } from "./operations";
import { shared } from "./shared";
export default createSystem({
  metadata: { name: "Company" },
  features: { shared, operations, customer },
});
`,
    ),
  ]);
  return { ...files, sharedSource, operationsSource, operationsTypeSource };
}
