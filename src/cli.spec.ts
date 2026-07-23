import { spawn } from "node:child_process";
import {
  access,
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

import { afterEach, describe, expect, test } from "vitest";

import { validateUIProgramRoot } from "@/adapters/web/pipeline";
import { createProject, runCli } from "@/cli";
import { SYSTEM_IR_VERSION } from "@/compiler/ir";
import { compileSystem } from "@/compiler/source";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("project template", () => {
  test("creates the complete minimal System convention", { timeout: 30_000 }, async () => {
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
      "features",
      "presentations",
      "system.spec.ts",
      "system.ts",
    ]);
    expect(await readdir(resolve(target, "src/features"))).toEqual(["shell.tsx"]);
    expect(await readdir(resolve(target, "src/presentations"))).toEqual(["clean.ts"]);
    expect(await readFile(resolve(target, "src/system.ts"), "utf8")).toContain(
      "export default createSystem({",
    );
    expect(await readFile(resolve(target, "src/system.spec.ts"), "utf8")).toContain("testSystem({");
    expect(await readFile(resolve(target, "src/features/shell.tsx"), "utf8")).toContain(
      "satisfies Feature<ShellFeature>",
    );
    expect(await readFile(resolve(target, "src/presentations/clean.ts"), "utf8")).toContain(
      "satisfies WebPresentation<Web, typeof parameters>",
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

    await runCli(["build", "--dir", target, "--outdir", "dist"]);
    await expect(access(resolve(target, ".poggers"))).rejects.toHaveProperty("code", "ENOENT");
    await expect(access(resolve(target, "dist/system.ir.json"))).rejects.toHaveProperty(
      "code",
      "ENOENT",
    );
    const manifest = compileSystem(resolve(target, "src/system.ts"));
    expect(manifest.version).toBe(SYSTEM_IR_VERSION);
    expect(manifest.platforms).toEqual(["web"]);
    expect(manifest.features.map(({ id }) => id)).toEqual([
      "feature/app",
      "feature/app.web",
      "feature/app.web.shell",
    ]);
    expect(manifest.programs).toHaveLength(1);
    expect(manifest.programs[0]).toMatchObject({
      id: "program/app.web.browser",
      environment: { name: "browser-main", platform: "web" },
      ui: { root: { feature: "app.web.shell", component: "Root" } },
    });
    const webOutput = resolve(target, "dist/interfaces/app.web");
    const html = await readFile(resolve(webOutput, "index.html"), "utf8");
    expect(html).toContain("@layer poggers.reset{");
    expect(html).toContain(":where(dialog)::backdrop{background:transparent}");
    expect(html).not.toContain("stylex");
    expect(html).not.toContain('href="/styles.css"');
    const entry = html.match(/<script type="module" async src="([^"]+)"/)?.[1];
    expect(entry).toMatch(/^\/assets\/app-[A-Za-z0-9_-]+\.js$/);
    await expect(access(resolve(webOutput, entry!.slice(1)))).resolves.toBeUndefined();
    expect(html).toContain(`<link rel="modulepreload" href="${entry}">`);
    expect(html.indexOf("@layer poggers.reset{")).toBeLessThan(html.indexOf(`src="${entry}"`));

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
    await expect(access(resolve(target, "src/system.ts"))).resolves.toBeUndefined();
  });

  test("keeps every executable System on the canonical source convention", async () => {
    const examples = resolve(import.meta.dirname, "../examples");
    for (const name of await readdir(examples)) {
      const source = resolve(examples, name, "src");
      await expectCanonicalSourceRoot(source);
      expect(compileSystem(resolve(source, "system.ts")).programs.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test("realizes a custom process-only Platform through an injected adapter", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-custom-platform-"));
    directories.push(directory);
    const source = resolve(directory, "src");
    const system = resolve(source, "system.ts");
    await mkdir(source, { recursive: true });
    await writeFile(system, customPlatformSystem());
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
            entries: [
              {
                identity: input.programs[0]!.id,
                kind: "program",
                environment: "edge-worker",
                path: artifact,
              },
            ],
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
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-production-cli-"));
    directories.push(directory);
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "src/system.ts"), portableServerSystem());

    await runCli(["build", "--dir", directory]);

    const artifact = resolve(directory, "dist/worker");
    await expect(access(artifact)).resolves.toBeUndefined();
    await expect(run(artifact, [], directory)).resolves.toBe(0);
  }, 120_000);
});

async function expectCanonicalSourceRoot(source: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  expect(entries.map(({ name }) => name).sort()).toEqual(
    expect.arrayContaining(["system.ts", "features", "presentations"]),
  );

  const unexpected = entries
    .map(({ name }) => name)
    .filter((name) => !["system.spec.ts", "system.ts", "features", "presentations"].includes(name));
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

  for await (const file of glob("**/*.{ts,tsx}", { cwd: source })) {
    if (file.endsWith(".spec.ts") && file !== "system.spec.ts") continue;
    const contents = await readFile(resolve(source, file), "utf8");
    expect(contents, `${file} imports private framework realization code`).not.toMatch(
      /from\s+["'](?:@\/(?:adapters|contracts|core)\/|@poggers\/kit\/adapters\/)/,
    );
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
