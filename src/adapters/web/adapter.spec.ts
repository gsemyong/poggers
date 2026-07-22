import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createWebPlatformAdapter } from "@/adapters/web/adapter";
import { POGGERS_IR_VERSION, type ProgramIR } from "@/core/compiler/ir";
import { compileApplication } from "@/core/compiler/source";

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
    expect(adapter.ui.component.createApplicationUI).toBeTypeOf("function");
    expect(adapter.ui.presentation.mount).toBeTypeOf("function");
  });

  test("rejects unsupported Environments before starting native work", async () => {
    const adapter = createWebPlatformAdapter();
    const program = programIR("browser-audio-worklet");
    const ir = {
      version: POGGERS_IR_VERSION,
      application: { id: "application/test", name: "test", presentations: [] },
      platforms: ["web"],
      features: [],
      programs: [program],
      presentations: [],
    } as const;

    await expect(
      adapter.develop({
        directory: "/tmp/test",
        application: "/tmp/test/src/app.ts",
        ir,
        programs: [program],
        platform: "web",
      }),
    ).rejects.toThrow('does not yet realize "program/worker"');
  });

  test("emits the document and worker Programs as explicit artifacts", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-web-adapter-"));
    temporaryDirectories.push(directory);
    const source = resolve(directory, "src");
    const application = resolve(source, "app.ts");
    const output = resolve(directory, "dist");
    await mkdir(source, { recursive: true });
    await writeFile(application, webProgramsSource());
    const ir = compileApplication(application);

    const result = await createWebPlatformAdapter().build({
      directory,
      application,
      ir,
      programs: ir.programs,
      platform: "web",
      output,
    });

    expect(result.entries.map(({ program, environment }) => [program, environment])).toEqual([
      ["browser", "browser-main"],
      ["telemetry", "browser-main"],
      ["background", "browser-worker"],
      ["offline", "browser-service-worker"],
    ]);
    await Promise.all(result.entries.map(({ path }) => access(path)));
    const document = await readFile(
      result.entries.find(({ environment }) => environment === "browser-main")!.path,
      "utf8",
    );
    const worker = await readFile(
      result.entries.find(({ environment }) => environment === "browser-worker")!.path,
      "utf8",
    );
    expect(document).toContain("poggers:dispose");
    expect(document).toContain("poggers:disposed");
    expect(worker).toContain("poggers:dispose");
    expect(worker).toContain("poggers:disposed");
    expect(worker).toContain("capabilities:[`http`]");
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
type Application<Contract> = unknown;
type App = { Features: {
  shell: { Programs: { browser: Program<Browser, { Components: { Root: { Elements: { Root: "div" } } } }> } };
  telemetry: { Programs: { telemetry: Program<Browser> } };
  background: { Programs: { background: Program<Worker, { Requires: { http: HttpClient } }> } };
  offline: { Programs: { offline: Program<ServiceWorker> } };
} };
export default {
  metadata: { name: "web-programs" },
  features: {
    shell: { programs: { browser: { components: { Root: { view: () => null } }, root: "Root" } } },
    telemetry: { programs: { telemetry: {} } },
    background: {
      programs: {
        background: {
          start({ capabilities }: { capabilities: { http: HttpClient } }) {
            void capabilities.http.request({ path: "/api/telemetry" });
          },
        },
      },
    },
    offline: { programs: { offline: {} } },
  },
} satisfies Application<App>;
`;
}

function programIR(environment: string): ProgramIR {
  return {
    id: "program/worker",
    name: "worker",
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
            span: { file: "app.ts", line: 1, column: 1 },
          },
          functions: [],
        },
        span: { file: "app.ts", line: 1, column: 1 },
      },
    ],
  };
}
