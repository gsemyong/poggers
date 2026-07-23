import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createWebPlatformAdapter } from "@/adapters/web/adapter";
import { webCompilerExtension } from "@/adapters/web/compiler";
import { SYSTEM_IR_VERSION, type ProgramIR } from "@/compiler/ir";
import { compileSystem } from "@/compiler/source";

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
      presentations: [],
    } as const;

    await expect(
      adapter.develop({
        directory: "/tmp/test",
        system: "/tmp/test/src/system.ts",
        ir,
        revisions: {
          current: { revision: 0, ir, presentationSources: new Set(), outputSources: {} },
          compile: () => ({
            revision: 0,
            ir,
            presentationSources: new Set(),
            outputSources: {},
          }),
        },
        programs: [program],
        interfaces: [],
        platform: "web",
      }),
    ).rejects.toThrow('does not yet realize "program/worker"');
  });

  test("emits the document and worker Programs as explicit artifacts", async () => {
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
    const interfaceRoot = result.entries.find(({ kind }) => kind === "interface")!.path;
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
  });
});

function webProgramsSource(): string {
  return `
type Platform = { Name: "web" };
type UI = { Name: "web" };
type Browser = { Name: "browser-main"; Platform: Platform; UI: UI };
type Worker = { Name: "browser-worker"; Platform: Platform };
type ServiceWorker = { Name: "browser-service-worker"; Platform: Platform };
type HttpClient = { request(input: { path: string }): Promise<Response> };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
declare const featureContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}
type Web = {
  Interface: { Platform: Platform };
  Programs: {
    browser: Program<Browser, { Components: { Root: { Elements: { Root: "div" } } } }>;
    telemetry: Program<Browser>;
    background: Program<Worker, { Requires: { http: HttpClient } }>;
    offline: Program<ServiceWorker>;
  };
};
type Product = { App: true; Features: { web: Web } };
type Root = { Features: { product: Product } };
const web = createFeature<Web>({
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
  presentation: {
    parameters: {},
    create() {
      return { Root: () => ({}) };
    },
  },
});
const product = createFeature<Product>({ features: { web } });
export default createSystem({
  metadata: { name: "web-programs" },
  features: { product },
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
        implementation: {
          kind: "portable",
          start: {
            id: "start",
            name: "start",
            asynchronous: false,
            captures: [],
            parameters: [],
            result: { kind: "primitive", name: "void" },
            body: [],
            span: { file: "system.ts", line: 1, column: 1 },
          },
          functions: [],
        },
        span: { file: "system.ts", line: 1, column: 1 },
      },
    ],
  };
}
