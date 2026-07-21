import { spawn } from "node:child_process";
import {
  access,
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

import { afterEach, describe, expect, test } from "vitest";

import { validateUIProgramRoot } from "@/adapters/web/toolchain";
import { createProject, runCli } from "@/cli";
import { POGGERS_IR_VERSION } from "@/core/compiler/ir";
import { compileApplication } from "@/core/compiler/source";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("project template", () => {
  test("creates the complete minimal application convention", { timeout: 30_000 }, async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "poggers-create-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await createProject([target, "--no-install"]);

    expect((await readdir(target)).sort()).toEqual([
      ".gitignore",
      ".node-version",
      ".oxfmtrc.json",
      ".oxlintrc.json",
      "mise.toml",
      "package.json",
      "src",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
    expect((await readdir(resolve(target, "src"))).sort()).toEqual([
      "app.tsx",
      "features",
      "presentations",
    ]);
    expect(await readdir(resolve(target, "src/features"))).toEqual(["shell.tsx"]);
    expect(await readdir(resolve(target, "src/presentations"))).toEqual(["clean.ts"]);
    expect(await readFile(resolve(target, "src/app.tsx"), "utf8")).toContain(
      "satisfies Application<App>",
    );
    expect(await readFile(resolve(target, "src/features/shell.tsx"), "utf8")).toContain(
      "satisfies Feature<ShellFeature>",
    );
    expect(await readFile(resolve(target, "src/presentations/clean.ts"), "utf8")).toContain(
      "satisfies WebPresentation<App, typeof parameters>",
    );
    const packageJson = JSON.parse(await readFile(resolve(target, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: { node: string };
      packageManager: string;
      scripts: Record<string, string>;
    };
    expect(Object.keys(packageJson.scripts)).toEqual([
      "dev",
      "build",
      "typecheck",
      "test",
      "lint",
      "fmt",
      "fmt:check",
      "check",
    ]);
    expect(packageJson.dependencies).toEqual({ "@poggers/kit": "latest" });
    expect(packageJson.devDependencies["@types/node"]).toBe("^26.1.1");
    expect(packageJson.engines.node).toBe(">=26.0.0");
    expect(packageJson.packageManager).toBe("nub@0.4.13");
    expect(await readFile(resolve(target, ".node-version"), "utf8")).toBe("26.5.0\n");
    expect(await readFile(resolve(target, "mise.toml"), "utf8")).toContain(
      '"github:nubjs/nub" = "0.4.13"',
    );
    expect(await readFile(resolve(target, "mise.toml"), "utf8")).toContain('rust = "1.97.1"');
    expect(await readFile(resolve(target, ".gitignore"), "utf8")).not.toContain("app.d.ts");
    expect(
      await run(
        resolve(import.meta.dirname, "../node_modules/.bin/oxfmt"),
        ["--check", "."],
        target,
      ),
    ).toBe(0);

    const modules = resolve(target, "node_modules");
    await mkdir(resolve(modules, "@poggers"), { recursive: true });
    await symlink(resolve(import.meta.dirname, ".."), resolve(modules, "@poggers/kit"), "dir");
    await mkdir(resolve(modules, "@types"), { recursive: true });
    await symlink(
      resolve(import.meta.dirname, "../node_modules/@types/node"),
      resolve(modules, "@types/node"),
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

    await runCli(["build", "--dir", target, "--outdir", "dist"]);
    await expect(access(resolve(target, "dist/app.js"))).resolves.toBeUndefined();
    await expect(access(resolve(target, ".poggers"))).rejects.toHaveProperty("code", "ENOENT");
    const manifest = JSON.parse(
      await readFile(resolve(target, "dist/application.ir.json"), "utf8"),
    ) as {
      version: number;
      features: readonly { id: string }[];
      platforms: readonly string[];
      programs: readonly {
        id: string;
        environment: { name: string; platform: string };
        ui?: unknown;
      }[];
    };
    expect(manifest.version).toBe(POGGERS_IR_VERSION);
    expect(manifest.platforms).toEqual(["web"]);
    expect(manifest.features.map(({ id }) => id)).toEqual(["feature/shell"]);
    expect(manifest.programs).toHaveLength(1);
    expect(manifest.programs[0]).toMatchObject({
      id: "program/browser",
      environment: { name: "browser-main", platform: "web" },
      ui: { root: { feature: "shell", component: "Application" } },
    });
    const html = await readFile(resolve(target, "dist/index.html"), "utf8");
    expect(html).toContain("@layer poggers.reset{");
    expect(html).toContain(":where(dialog)::backdrop{background:transparent}");
    expect(html).not.toContain("stylex");
    expect(html).not.toContain('href="/styles.css"');
    expect(html.indexOf("@layer poggers.reset{")).toBeLessThan(html.indexOf('src="/app.js"'));

    expect(() =>
      validateUIProgramRoot({ features: { shell: { programs: { browser: {} } } } }, "browser"),
    ).toThrow("exactly one root Component");
  });

  test("force replaces the target instead of preserving residue", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "poggers-create-force-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await mkdir(target);
    await writeFile(resolve(target, "residue.txt"), "remove me");

    await createProject([target, "--no-install", "--force"]);

    await expect(access(resolve(target, "residue.txt"))).rejects.toThrow();
    await expect(access(resolve(target, "src/app.tsx"))).resolves.toBeUndefined();
  });

  test("keeps every executable application on the canonical source convention", async () => {
    const examples = resolve(import.meta.dirname, "../examples");
    for (const name of await readdir(examples)) {
      const source = resolve(examples, name, "src");
      await expectCanonicalSourceRoot(source);
      expect(compileApplication(resolve(source, "app.tsx")).programs.length).toBeGreaterThan(0);
    }
  }, 15_000);

  test("realizes a custom process-only Platform through an injected adapter", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-custom-platform-"));
    directories.push(directory);
    const source = resolve(directory, "src");
    const application = resolve(source, "app.ts");
    await mkdir(source, { recursive: true });
    await writeFile(application, customPlatformApplication());
    let program = "";

    await runCli(["build", "--dir", directory], {
      edge: {
        name: "edge",
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
            entries: [{ program, environment: "edge-worker", path: artifact }],
          };
        },
      },
    });

    expect(program).toBe("indexer");
    await expect(readFile(resolve(directory, "dist/worker.bin"), "utf8")).resolves.toBe(
      "custom-platform",
    );
  });

  test("builds a portable server Program through the normal production path", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-native-cli-"));
    directories.push(directory);
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "src/app.ts"), portableServerApplication());

    await runCli(["build", "--dir", directory]);

    const artifact = resolve(directory, "dist/worker");
    await expect(access(artifact)).resolves.toBeUndefined();
    await expect(run(artifact, [], directory)).resolves.toBe(0);
  }, 120_000);
});

async function expectCanonicalSourceRoot(source: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  expect(entries.map(({ name }) => name).sort()).toEqual(
    expect.arrayContaining(["app.tsx", "features", "presentations"]),
  );

  const unexpected = entries
    .map(({ name }) => name)
    .filter((name) => !["app.spec.ts", "app.tsx", "features", "presentations"].includes(name));
  expect(unexpected, `${source} has files outside the canonical source convention`).toEqual([]);

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
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function customPlatformApplication(): string {
  return `
type EdgePlatform = { Name: "edge" };
type EdgeWorker = { Name: "edge-worker"; Platform: EdgePlatform };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
type Application<Contract> = unknown;
type App = { Features: { indexer: { Programs: { indexer: Program<EdgeWorker> } } } };
export default {
  metadata: { name: "custom-platform" },
  features: { indexer: { programs: { indexer: {} } } },
} satisfies Application<App>;
`;
}

function portableServerApplication(): string {
  return `
type Server = { Name: "server"; Platform: { Name: "server" } };
type Program<Environment, Contract extends object = {}> = Contract & { Environment: Environment };
type Feature<Contract> = unknown;
type Application<Contract> = unknown;
type Worker = { Programs: { worker: Program<Server> } };
type App = { Features: { worker: Worker } };
const worker = {
  programs: {
    worker: {
      start() {
        const value = 20 + 22;
        if (value === 42) return;
      },
    },
  },
} satisfies Feature<Worker>;
export default { features: { worker } } satisfies Application<App>;
`;
}
