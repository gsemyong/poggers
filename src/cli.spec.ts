import { spawn } from "node:child_process";
import {
  access,
  chmod,
  glob,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createProject, runCli } from "@/cli";
import type { SourceCompilerExtension } from "@/compiler/extension";
import { SYSTEM_IR_VERSION } from "@/compiler/ir";
import { compileSystem } from "@/compiler/source";
import { platformAdapters } from "@/platforms";
import { WEB_COMPILER_IR_VERSION } from "@/platforms/web/adapter/lowering";
import { validateUIProgramRoot } from "@/platforms/web/adapter/pipeline";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("project template", () => {
  test(
    "creates the complete minimal System convention",
    { tags: ["package"], timeout: 60_000 },
    async () => {
      const parent = await mkdtemp(resolve(tmpdir(), "kit-create-"));
      directories.push(parent);
      const target = resolve(parent, "example");
      await createProject([target, "--no-install"]);

      expect((await readdir(target)).sort()).toEqual([
        ".gitignore",
        ".node-version",
        "README.md",
        "mise.toml",
        "package.json",
        "src",
        "tsconfig.json",
      ]);
      expect((await readdir(resolve(target, "src"))).sort()).toEqual([
        "apps",
        "deployment.ts",
        "features",
        "presentations",
        "system.ts",
      ]);
      expect(await readdir(resolve(target, "src/apps"))).toEqual(["main.tsx"]);
      expect((await readdir(resolve(target, "src/features"))).sort()).toEqual([
        "shell.spec.ts",
        "shell.tsx",
      ]);
      expect(await readdir(resolve(target, "src/presentations"))).toEqual(["web.ts"]);
      expect(await readFile(resolve(target, "src/system.ts"), "utf8")).toContain(
        "export default createSystem<Basic>({",
      );
      expect(await readFile(resolve(target, "src/features/shell.spec.ts"), "utf8")).toContain(
        "program.actions.increment",
      );
      expect(await readFile(resolve(target, "src/features/shell.tsx"), "utf8")).toContain(
        "createFeature<ShellFeature>",
      );
      expect(await readFile(resolve(target, "src/presentations/web.ts"), "utf8")).toContain(
        "satisfies WebPresentation<Main, typeof parameters>",
      );
      const packageJson = JSON.parse(await readFile(resolve(target, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        devEngines: {
          packageManager: { name: string; version: string; onFail: string };
        };
        engines: { node: string };
        scripts: Record<string, string>;
      };
      expect(Object.keys(packageJson.scripts)).toEqual([
        "dev",
        "build",
        "deploy",
        "typecheck",
        "test",
        "format",
        "check",
      ]);
      expect(packageJson.dependencies).toEqual({ kit: "latest" });
      expect(packageJson.devDependencies).toEqual({
        "@types/node": "^26.1.1",
        vitest: "^4.1.10",
      });
      expect(packageJson.engines.node).toBe(">=26.0.0");
      expect(packageJson.devEngines.packageManager).toEqual({
        name: "nub",
        version: "^0.4.13",
        onFail: "warn",
      });
      expect(await readFile(resolve(target, ".node-version"), "utf8")).toBe("26.5.0\n");
      expect(await readFile(resolve(target, "mise.toml"), "utf8")).toContain(
        '"github:nubjs/nub" = "0.4.13"',
      );
      expect(await readFile(resolve(target, "mise.toml"), "utf8")).toContain(
        'rust = { version = "1.97.1", components = ["rustfmt"] }',
      );
      expect(await readFile(resolve(target, ".gitignore"), "utf8")).not.toContain("app.d.ts");
      const modules = resolve(target, "node_modules");
      await mkdir(modules, { recursive: true });
      await symlink(resolve(import.meta.dirname, ".."), resolve(modules, "kit"), "dir");
      await mkdir(resolve(modules, "@types"));
      await symlink(
        resolve(import.meta.dirname, "../node_modules/@types/node"),
        resolve(modules, "@types/node"),
        "dir",
      );
      await symlink(
        resolve(import.meta.dirname, "../node_modules/vitest"),
        resolve(modules, "vitest"),
        "dir",
      );

      expect(
        await run(resolve(import.meta.dirname, "../node_modules/.bin/oxlint"), ["src"], target),
      ).toBe(0);
      expect(
        await run(
          resolve(import.meta.dirname, "../node_modules/.bin/tsc"),
          ["-p", "tsconfig.json"],
          target,
        ),
      ).toBe(0);
      await expect(runCli(["typecheck", "--dir", target])).resolves.toBeUndefined();
      expect(process.exitCode).toBe(0);
      await expect(runCli(["format", "--dir", target])).resolves.toBeUndefined();
      expect(process.exitCode).toBe(0);
      await expect(runCli(["test", "--dir", target])).resolves.toBeUndefined();
      expect(process.exitCode).toBe(0);

      await rm(resolve(target, ".kit"), { force: true, recursive: true });
      await runCli(["build", "--dir", target, "--outdir", "dist"]);
      await expect(access(resolve(target, ".kit"))).rejects.toHaveProperty("code", "ENOENT");
      await expect(access(resolve(target, "dist/system.ir.json"))).rejects.toHaveProperty(
        "code",
        "ENOENT",
      );
      const manifest = compileShippedSystem(resolve(target, "src/system.ts"));
      expect(manifest.version).toBe(SYSTEM_IR_VERSION);
      expect(manifest.platforms).toEqual(["web"]);
      expect(manifest.features.map(({ id }) => id)).toEqual(["feature/shell"]);
      expect(manifest.programs).toHaveLength(1);
      expect(manifest.programs[0]).toMatchObject({
        id: "program/main.web.browser",
        environment: { name: "browser-main", platform: "web" },
        contributions: [
          {
            feature: "shell",
            extensions: {
              web: {
                version: WEB_COMPILER_IR_VERSION,
                ui: { root: "Root" },
              },
            },
          },
        ],
      });
      const webOutput = resolve(target, "dist/interfaces/main.web");
      const html = await readFile(resolve(webOutput, "index.html"), "utf8");
      expect(html).toContain("@layer kit.reset{");
      expect(html).toContain(":where(dialog)::backdrop{background:transparent}");
      expect(html).not.toContain("stylex");
      expect(html).not.toContain('href="/styles.css"');
      const entry = html.match(/<script type="module" async src="([^"]+)"/)?.[1];
      expect(entry).toMatch(/^\/assets\/app-[A-Za-z0-9_-]+\.js$/);
      await expect(access(resolve(webOutput, entry!.slice(1)))).resolves.toBeUndefined();
      expect(html).toContain(`<link rel="modulepreload" href="${entry}">`);
      expect(html.indexOf("@layer kit.reset{")).toBeLessThan(html.indexOf(`src="${entry}"`));
      const webFiles = await readdir(webOutput, { recursive: true });
      expect(webFiles.some((file) => file.endsWith(".wasm"))).toBe(false);
      expect(webFiles.some((file) => file.startsWith("workers/"))).toBe(false);

      expect(() =>
        validateUIProgramRoot({ features: { shell: { programs: { browser: {} } } } }, "browser"),
      ).toThrow("exactly one root Component");
    },
  );

  test("force replaces the target instead of preserving residue", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "kit-create-force-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await mkdir(target);
    await writeFile(resolve(target, "residue.txt"), "remove me");

    await createProject([target, "--no-install", "--force"]);

    await expect(access(resolve(target, "residue.txt"))).rejects.toThrow();
    await expect(access(resolve(target, "src/system.ts"))).resolves.toBeUndefined();
  });

  test("accepts a private package location without changing source identity", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "kit-create-package-"));
    directories.push(parent);
    const target = resolve(parent, "example");

    await createProject([target, "--no-install", "--package", "git+ssh://example.test/kit.git"]);

    const manifest = JSON.parse(await readFile(resolve(target, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({
      kit: "git+ssh://example.test/kit.git",
    });
    expect(await readFile(resolve(target, "src/system.ts"), "utf8")).toContain('from "kit"');
  });

  test("creates any shipped example through the same scaffold", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "kit-create-example-"));
    directories.push(parent);
    const target = resolve(parent, "operations");

    await createProject([target, "--no-install", "--example", "authenticated-crud"]);

    expect((await readdir(resolve(target, "src/apps"))).sort()).toEqual([
      "customer.tsx",
      "operations.tsx",
      "workspace.tsx",
    ]);
    expect(await readFile(resolve(target, "src/system.ts"), "utf8")).toContain(
      'metadata: { name: "operations" }',
    );
    await expect(access(resolve(target, "src/features/tasks.tsx"))).resolves.toBeUndefined();
    expect(await readFile(resolve(target, "tsconfig.json"), "utf8")).toContain(
      '"extends": "kit/tsconfig"',
    );
  });

  test("reports the selectable examples", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "kit-create-unknown-"));
    directories.push(parent);

    await expect(
      createProject([resolve(parent, "example"), "--no-install", "--example", "missing"]),
    ).rejects.toThrow("Available examples: authenticated-crud, basic, presentation");
  });

  test(
    "keeps every executable System on the canonical source convention",
    { tags: ["package"], timeout: 30_000 },
    async () => {
      const examples = resolve(import.meta.dirname, "../examples");
      for (const name of await readdir(examples)) {
        const source = resolve(examples, name, "src");
        await expectCanonicalSourceRoot(source);
        expect(compileShippedSystem(resolve(source, "system.ts")).programs.length).toBeGreaterThan(
          0,
        );
      }
    },
  );

  test("realizes a custom process-only Platform through an injected adapter", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-custom-platform-"));
    directories.push(directory);
    const source = resolve(directory, "src");
    const system = resolve(source, "system.ts");
    await mkdir(source, { recursive: true });
    await writeFile(system, customPlatformSystem());
    let program = "";
    const output: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    try {
      await runCli(["build", "--json", "--dir", directory], {
        edge: {
          name: "edge",
          compiler: [edgeCompilerExtension],
          async develop() {
            throw new Error("The build fixture must not start development.");
          },
          async build(input) {
            program = input.programs[0]?.name ?? "";
            await mkdir(input.output, { recursive: true });
            const artifact = resolve(input.output, "worker.bin");
            await writeFile(artifact, "custom-platform");
            return {
              directory: input.output,
              entries: [
                {
                  identity: input.programs[0]!.id,
                  kind: "program",
                  deployment: "process",
                  environment: "edge-worker",
                  path: artifact,
                },
              ],
            };
          },
        },
      });
    } finally {
      write.mockRestore();
    }

    expect(program).toBe("indexer");
    await expect(readFile(resolve(directory, "dist/worker.bin"), "utf8")).resolves.toBe(
      "custom-platform",
    );
    const records = output
      .join("")
      .trim()
      .split("\n")
      .map(
        (record) =>
          JSON.parse(record) as Readonly<{
            kind: string;
            id?: string;
            status?: string;
            platform?: string;
          }>,
      );
    expect(records).toEqual([
      expect.objectContaining({ kind: "phase", id: "runtime", status: "started" }),
      expect.objectContaining({ kind: "phase", id: "runtime", status: "completed" }),
      expect.objectContaining({
        kind: "phase",
        id: "production:compile:system",
        status: "started",
      }),
      expect.objectContaining({
        kind: "phase",
        id: "production:compile:system",
        status: "completed",
      }),
      expect.objectContaining({
        kind: "phase",
        id: "production:build:edge",
        status: "started",
      }),
      expect.objectContaining({
        kind: "phase",
        id: "production:build:edge",
        status: "completed",
      }),
      expect.objectContaining({
        kind: "phase",
        id: "production:release:system",
        status: "started",
      }),
      expect.objectContaining({
        kind: "phase",
        id: "production:release:system",
        status: "completed",
      }),
      expect.objectContaining({ kind: "built", platform: "edge" }),
    ]);
  });

  test("plans, applies, inspects, and removes through one Deployment command", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-deploy-cli-"));
    directories.push(directory);
    const source = resolve(directory, "src");
    await mkdir(source, { recursive: true });
    await writeFile(resolve(source, "system.ts"), customPlatformSystem());
    await writeFile(
      resolve(source, "deployment.ts"),
      `
import { createDeployment } from "kit/deployment";
import { createLocalDeploymentAdapter } from "kit/adapters/deployment/local";
import system from "@/system";

export default createDeployment(system as never, {
  adapter: createLocalDeploymentAdapter(),
  programs: { indexer: { replicas: 2 } } as never,
});
`,
    );
    const adapter = {
      edge: {
        name: "edge",
        compiler: [edgeCompilerExtension],
        async develop() {
          throw new Error("Deployment must use production artifacts.");
        },
        async build(input: { output: string; programs: readonly { id: string }[] }) {
          await mkdir(input.output, { recursive: true });
          const executable = resolve(input.output, "indexer");
          await writeFile(
            executable,
            `#!/bin/sh
status="$KIT_PROCESS_STATUS_FILE"
write_status() {
  temporary="$status.$$.tmp"
  printf '{"status":"%s","pid":%s}\\n' "$1" "$$" > "$temporary"
  mv "$temporary" "$status"
}
shutdown() {
  write_status draining
  write_status stopped
  exit 0
}
trap shutdown INT TERM
write_status ready
while true; do sleep 1; done
`,
          );
          await chmod(executable, 0o755);
          return {
            directory: input.output,
            entries: [
              {
                identity: input.programs[0]!.id,
                kind: "program" as const,
                deployment: "process" as const,
                environment: "edge-worker",
                path: executable,
                entrypoint: executable,
                lifecycle: {
                  shutdown: { kind: "signal" as const, signal: "SIGINT" as const },
                  status: {
                    kind: "file" as const,
                    environment: "KIT_PROCESS_STATUS_FILE",
                  },
                },
              },
            ],
          };
        },
      },
    };

    try {
      await runCli(["deploy", "--dir", directory], adapter);
      const state = JSON.parse(
        await readFile(resolve(directory, ".kit/deployments/local/state.json"), "utf8"),
      ) as { artifacts: readonly { processes?: readonly unknown[] }[] };
      expect(state.artifacts.flatMap(({ processes = [] }) => processes)).toHaveLength(2);
      await expect(
        runCli(["deploy", "--status", "--dir", directory], adapter),
      ).resolves.toBeUndefined();
    } finally {
      await runCli(["deploy", "--remove", "--dir", directory], adapter);
    }
  });

  test(
    "builds one focused Application with its shared Program and isolated interface",
    { tags: ["package"], timeout: 30_000 },
    async () => {
      const output = await mkdtemp(resolve(tmpdir(), "kit-focused-cli-"));
      directories.push(output);
      const observed = new Map<string, readonly string[]>();
      const adapter = (name: keyof typeof platformAdapters) => ({
        name,
        compiler: platformAdapters[name]!.compiler,
        async develop() {
          throw new Error("The focused build fixture must not start development.");
        },
        async build(input: {
          output: string;
          programs: readonly Readonly<{ id: string }>[];
          interfaces: readonly Readonly<{ id: string }>[];
        }) {
          observed.set(name, [
            ...input.programs.map(({ id }) => id),
            ...input.interfaces.map(({ id }) => id),
          ]);
          return { directory: input.output, entries: [] };
        },
      });

      await runCli(
        [
          "build",
          "operations",
          "--dir",
          resolve(import.meta.dirname, "../examples/authenticated-crud"),
          "--outdir",
          output,
        ],
        { server: adapter("server"), web: adapter("web") },
      );

      expect(observed.get("server")).toEqual(["program/server"]);
      expect(observed.get("web")).toEqual([
        "program/operations.web.browser",
        "interface/operations.web",
      ]);
    },
  );

  test(
    "builds a portable server Program through the normal production path",
    { tags: ["production"], timeout: 120_000 },
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "kit-production-cli-"));
      directories.push(directory);
      await mkdir(resolve(directory, "src"), { recursive: true });
      await writeFile(resolve(directory, "src/system.ts"), portableServerSystem());

      await runCli(["build", "--dir", directory]);

      const artifact = resolve(directory, "dist/worker");
      await expect(access(artifact)).resolves.toBeUndefined();
      await expect(run(artifact, [], directory)).resolves.toBe(0);
    },
  );
});

function compileShippedSystem(source: string) {
  return compileSystem(
    source,
    Object.values(platformAdapters).flatMap(({ compiler = [] }) => compiler),
  );
}

const edgeCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "edge",
  program: () => ({ ir: { version: 1 } }),
});

async function expectCanonicalSourceRoot(source: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  expect(entries.map(({ name }) => name).sort()).toEqual(
    expect.arrayContaining(["apps", "features", "presentations", "system.ts"]),
  );

  const unexpected = entries
    .map(({ name }) => name)
    .filter(
      (name) =>
        ![
          "deployment.ts",
          "system.spec.ts",
          "system.ts",
          "apps",
          "features",
          "presentations",
        ].includes(name),
    );
  expect(unexpected, `${source} has files outside the canonical source convention`).toEqual([]);

  const apps = await readdir(resolve(source, "apps"), { withFileTypes: true });
  expect(apps.every((entry) => entry.isDirectory() || entry.isFile())).toBe(true);
  for (const app of apps.filter((entry) => entry.isDirectory())) {
    const entries = await readdir(resolve(source, "apps", app.name));
    expect(entries).toContain("app.tsx");
    expect(entries.every((entry) => ["app.tsx", "features", "presentations"].includes(entry))).toBe(
      true,
    );
  }

  const features = await readdir(resolve(source, "features"), { withFileTypes: true });
  expect(features.every((entry) => entry.isFile())).toBe(true);
  expect(features.some(({ name }) => name === "feature.tsx")).toBe(false);

  const presentations = await readdir(resolve(source, "presentations"), {
    withFileTypes: true,
  });
  expect(
    presentations.every(
      (entry) => entry.isFile() || (entry.isDirectory() && entry.name === "assets"),
    ),
  ).toBe(true);
  expect(presentations.some(({ name }) => name === "presentation.ts")).toBe(false);

  for await (const file of glob("**/*.{ts,tsx}", { cwd: source })) {
    if (file.endsWith(".spec.ts") && file !== "system.spec.ts") continue;
    const contents = await readFile(resolve(source, file), "utf8");
    if (file !== "deployment.ts") {
      expect(contents, `${file} imports private framework realization code`).not.toMatch(
        /from\s+["'](?:@\/(?:adapters|contracts|core)\/|kit\/adapters\/)/,
      );
    }
    expect(contents, `${file} names a backend implementation detail`).not.toMatch(
      /\b(?:buildServerProgram|compileSystem|createNodeHost|startServerProgram)\b/,
    );
  }
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function customPlatformSystem(): string {
  return `
type EdgePlatform = { Name: "edge" };
type EdgeWorker = { Name: "edge-worker"; Platform: EdgePlatform };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
declare const featureContract: unique symbol;
type Feature<Contract> = { readonly [featureContract]?: Contract; programs: unknown };
const createFeature = <Contract>(value: Feature<Contract>): Feature<Contract> => value;
const createSystem = <Features extends Readonly<Record<string, object>>>(value: {
  metadata?: { name: string };
  features: Features;
}) => value;
type Indexer = { Programs: { indexer: Program<EdgeWorker> } };
const indexer = createFeature<Indexer>({ programs: { indexer: {} } });
export default createSystem({
  metadata: { name: "custom-platform" },
  features: { indexer },
});
`;
}

function portableServerSystem(): string {
  return `
type Server = { Name: "server"; Platform: { Name: "server" } };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
declare const featureContract: unique symbol;
type Feature<Contract> = { readonly [featureContract]?: Contract; programs: unknown };
const createFeature = <Contract>(value: Feature<Contract>): Feature<Contract> => value;
const createSystem = <Features extends Readonly<Record<string, object>>>(value: {
  features: Features;
}) => value;
type Worker = { Programs: { worker: Program<Server> } };
const worker = createFeature<Worker>({
  programs: {
    worker: {
      start() {
        const value = 20 + 22;
        if (value === 42) return;
      },
    },
  },
});
export default createSystem({ features: { worker } });
`;
}
