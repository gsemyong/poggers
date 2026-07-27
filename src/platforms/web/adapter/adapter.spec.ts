import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { SYSTEM_IR_VERSION, type ProgramIR } from "@/compiler/ir";
import { compileSystem } from "@/compiler/source";
import { createWebPlatformAdapter } from "@/platforms/web/adapter";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("web Platform Adapter", () => {
  test("pairs the web UI implementation with the web realization", () => {
    const adapter = createWebPlatformAdapter();

    expect(adapter.name).toBe("web");
    expect(adapter.ui.name).toBe("web");
    expect(adapter.ui.component.createInterfaceUI).toBeTypeOf("function");
    expect(adapter.ui.presentation.mount).toBeTypeOf("function");
  });

  test("rejects unsupported Environments before starting platform work", async () => {
    const adapter = createWebPlatformAdapter();
    const program = programIR("browser-audio-worklet");
    const ir = {
      version: SYSTEM_IR_VERSION,
      system: { id: "system", name: "test" },
      platforms: ["web"],
      apps: [],
      interfaces: [],
      features: [],
      programs: [program],
    } as const;

    await expect(
      adapter.develop({
        directory: "/tmp/test",
        system: "/tmp/test/src/system.ts",
        ir,
        revisions: {
          current: {
            revision: 0,
            ir,
            outputSources: {},
            sourceFiles: [],
            cache: "miss",
            work: {
              features: { compiled: 0, reused: 0 },
            },
          },
          compile: () => ({
            revision: 0,
            ir,
            outputSources: {},
            sourceFiles: [],
            cache: "miss",
            work: {
              features: { compiled: 0, reused: 0 },
            },
          }),
        },
        programs: [program],
        interfaces: [],
        platform: "web",
      }),
    ).rejects.toThrow('does not yet realize "program/worker"');
  });

  test(
    "emits the document and worker Programs as explicit artifacts",
    { tags: ["production"], timeout: 120_000 },
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "kit-web-adapter-"));
      temporaryDirectories.push(directory);
      const source = resolve(directory, "src");
      const system = resolve(source, "system.ts");
      const output = resolve(directory, "dist");
      await mkdir(source, { recursive: true });
      await writeFile(system, webProgramsSource());
      const ir = compileSystem(system, [webCompilerExtension]);

      const result = await createWebPlatformAdapter().build({
        directory,
        system,
        ir,
        programs: ir.programs,
        interfaces: ir.interfaces,
        platform: "web",
        output,
      });

      expect(
        result.entries.map(({ identity, kind, environment }) => [identity, kind, environment]),
      ).toEqual([
        ["interface/product.web", "interface", "browser-main"],
        ["program/product.web.background", "program", "browser-worker"],
        ["program/product.web.offline", "program", "browser-service-worker"],
      ]);
      await Promise.all(result.entries.map(({ path }) => access(path)));
      const interfaceArtifact = result.entries.find(({ kind }) => kind === "interface")!;
      const interfaceRoot = interfaceArtifact.path;
      expect(interfaceArtifact.entrypoint).toBe(resolve(interfaceRoot, "index.html"));
      for (const artifact of result.entries.filter(({ kind }) => kind === "program")) {
        expect(artifact.entrypoint).toBe(artifact.path);
        expect(artifact.dependencies).toEqual(
          artifact.environment === "browser-worker" ? ["http"] : [],
        );
      }
      expect(
        JSON.parse(await readFile(resolve(interfaceRoot, "assets.ir.json"), "utf8")),
      ).toMatchObject({
        version: 2,
        crossOriginIsolated: true,
      });
      const browserAssets = (await readdir(resolve(interfaceRoot, "assets")))
        .filter((path) => path.startsWith("app-") && path.endsWith(".js"))
        .map((path) => resolve(interfaceRoot, "assets", path));
      expect(browserAssets).toHaveLength(1);
      const document = await readFile(browserAssets[0]!, "utf8");
      const worker = await readFile(
        result.entries.find(({ environment }) => environment === "browser-worker")!.path,
        "utf8",
      );
      expect(document).toContain("kit:dispose");
      expect(document).toContain("kit:disposed");
      expect(worker).toContain("kit:dispose");
      expect(worker).toContain("kit:disposed");
      expect(worker).toContain(
        "dependencies:[{name:`http`,operations:[{name:`request`,mode:`asynchronous`",
      );
      const bundledJavaScript = await Promise.all(
        (await readdir(output, { recursive: true }))
          .filter((path) => path.endsWith(".js"))
          .map((path) => readFile(resolve(output, path), "utf8")),
      );
      expect(bundledJavaScript.join("\n")).toContain("/api/telemetry");
    },
  );
});

function webProgramsSource(): string {
  return `
type Platform = { Name: "web" };
type UI = { Name: "web" };
type Browser = { Name: "browser-main"; Platform: Platform; UI: UI };
type Worker = { Name: "browser-worker"; Platform: Platform };
type ServiceWorker = { Name: "browser-service-worker"; Platform: Platform };
type HttpClient = { request(input: { path: string }): Promise<Response> };
type DataStore = { query(input: { collection: string }): Promise<string> };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
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
type Runtime = {
  Providers: { web: { dataStore: object } };
  Programs: {
    browser: Program<Browser, {
      Requires: { dataStore: DataStore };
      Components: { Root: { Elements: { Root: "div" } } };
    }>;
    telemetry: Program<Browser>;
    background: Program<Worker, { Requires: { http: HttpClient } }>;
    offline: Program<ServiceWorker>;
  };
};
type Web = {
  Interface: {
    Platform: {
      Name: "web";
      Specification: { Mounts: { runtime: { Path: "" } } };
    };
  };
};
type Product = {
  Features: { runtime: Runtime };
  Interfaces: { web: Web };
};
const runtime = createFeature<Runtime>({
  providers: {
    web: {
      dataStore: {
        requirements: { crossOriginIsolation: true },
        development() {
          return { query: async () => "ready" };
        },
      },
    },
  },
  programs: {
    browser: { components: { Root: { view: () => null } }, root: "Root" },
    telemetry: {},
    background: {
      start({ dependencies }: { dependencies: { http: HttpClient } }) {
        void dependencies.http.request({ path: "/api/telemetry" });
      },
    },
    offline: {},
  },
});
const web = createInterface<Web>({
  presentation: {
    parameters: {},
    create() {
      return { Root: () => ({}) };
    },
  },
});
const product = createApplication<Product>({
  interfaces: { web },
});
export default createSystem({
  metadata: { name: "web-programs" },
  features: { runtime },
  applications: { product },
});
`;
}

function programIR(environment: string): ProgramIR {
  return {
    id: "program/worker",
    name: "worker",
    logicalName: "worker",
    environment: { name: environment, platform: "web" },
    contributions: [
      {
        id: "feature/test/program/worker",
        feature: "test",
        requires: [],
        provides: [],
        span: { file: "system.ts", line: 1, column: 1 },
      },
    ],
  };
}
