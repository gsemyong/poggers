#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";

import { createServer, defaultServerConditions, type Plugin } from "vite";

import type { PlatformAdapterImplementation } from "@/adapter";
import type { System, SystemContract } from "@/core/system";
import {
  applyDeployment,
  inspectDeployment,
  planDeployment,
  removeDeployment,
  type Deployment,
  type DeploymentAdapter,
} from "@/deployment";
import { packageSourceAliases } from "@/package";
import { platformAdapters } from "@/platforms";
import { buildSystem, developSystem, resolveSystemRealization } from "@/realization";

const valueFlags = new Set([
  "deployment",
  "dir",
  "example",
  "name",
  "outdir",
  "outfile",
  "package",
]);
const ignoredTemplateEntries = new Set([
  ".data",
  ".kit",
  "coverage",
  "dist",
  "node_modules",
  "nub.lock",
  "target",
]);
const ignoredExampleEntries = new Set([
  ...ignoredTemplateEntries,
  "tsconfig.json",
  "tsconfig.tsbuildinfo",
]);
const workspaceDirectories = ["src/apps", "src/features", "src/presentations"] as const;

export async function runCli(
  arguments_ = process.argv.slice(2),
  adapters: Readonly<Record<string, PlatformAdapterImplementation>> = platformAdapters,
): Promise<void> {
  const [command = "dev", ...commandArguments] = arguments_;
  const directory = resolve(readFlag(commandArguments, "dir") ?? process.cwd());
  const app = positionalArguments(commandArguments)[0];

  if (command === "create") {
    await createProject(commandArguments);
  } else if (command === "dev") {
    const system = await developSystem(directory, adapters, app ? { app } : {});
    for (const location of Object.values(system.locations).flat()) {
      console.log(`kit dev running on ${location}`);
    }
    const stop = async () => {
      await system[Symbol.asyncDispose]();
      process.exit();
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  } else if (command === "build") {
    const root = resolve(
      directory,
      readFlag(commandArguments, "outdir") ?? readFlag(commandArguments, "outfile") ?? "dist",
    );
    const system = await buildSystem(directory, root, adapters, app ? { app } : {});
    for (const artifacts of Object.values(system.artifacts)) {
      console.log(`built ${artifacts.directory}`);
    }
  } else if (command === "deploy") {
    await runDeploymentCli(directory, commandArguments, adapters, app);
  } else if (command === "typecheck") {
    const code = await run(
      [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
      directory,
    );
    process.exitCode = code;
    if (code === 0) {
      resolveSystemRealization(directory, adapters, app ? { app } : {});
    }
  } else if (command === "test") {
    const framework = await findPackageDirectory(import.meta.dirname);
    process.exitCode = await run(
      [
        resolve(directory, "node_modules/.bin/vitest"),
        "run",
        "--root",
        directory,
        "--config",
        resolve(framework, "config/vitest.ts"),
        "--passWithNoTests",
      ],
      directory,
    );
  } else if (command === "format") {
    const framework = await findPackageDirectory(import.meta.dirname);
    process.exitCode = await run(
      [
        resolve(directory, "node_modules/.bin/oxfmt"),
        "--config",
        resolve(framework, ".oxfmtrc.json"),
      ],
      directory,
    );
  } else if (command === "check") {
    const framework = await findPackageDirectory(import.meta.dirname);
    const commands = [
      [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
      [
        resolve(directory, "node_modules/.bin/oxlint"),
        "--config",
        resolve(framework, ".oxlintrc.json"),
        "src",
      ],
      [
        resolve(directory, "node_modules/.bin/oxfmt"),
        "--config",
        resolve(framework, ".oxfmtrc.json"),
        "--check",
      ],
      [
        resolve(directory, "node_modules/.bin/vitest"),
        "run",
        "--root",
        directory,
        "--config",
        resolve(framework, "config/vitest.ts"),
        "--passWithNoTests",
      ],
    ];
    for (const current of commands) {
      const code = await run(current, directory);
      if (code !== 0) {
        process.exitCode = code;
        return;
      }
    }
    resolveSystemRealization(directory, adapters, app ? { app } : {});
  } else {
    console.error(
      "Usage: kit <dev [app]|build [app]|deploy [app] [--plan|--status|--remove]|typecheck|test|format|check|create>",
    );
    process.exitCode = 1;
  }
}

async function runDeploymentCli(
  directory: string,
  arguments_: readonly string[],
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
  app: string | undefined,
): Promise<void> {
  const actions = (["plan", "status", "remove"] as const).filter((name) =>
    arguments_.includes(`--${name}`),
  );
  if (actions.length > 1) {
    throw new TypeError("Select at most one of --plan, --status, or --remove.");
  }
  const deployment = await loadDeployment(
    directory,
    readFlag(arguments_, "deployment") ?? "src/deployment.ts",
  );
  const action = actions[0] ?? "apply";
  if (action === "status") {
    console.log(JSON.stringify((await inspectDeployment(deployment)) ?? null, undefined, 2));
    return;
  }
  if (action === "remove") {
    console.log(JSON.stringify(await removeDeployment(deployment), undefined, 2));
    return;
  }
  const output = resolve(
    directory,
    readFlag(arguments_, "outdir") ?? readFlag(arguments_, "outfile") ?? "dist",
  );
  const built = await buildSystem(directory, output, adapters, app ? { app } : {});
  if (action === "plan") {
    const observed = await inspectDeployment(deployment);
    console.log(JSON.stringify(planDeployment(deployment, built.release, observed), undefined, 2));
    return;
  }
  const result = await applyDeployment(deployment, built.release);
  console.log(JSON.stringify(result.state, undefined, 2));
  if (!result.state.converged) process.exitCode = 1;
}

async function loadDeployment(
  directory: string,
  path: string,
): Promise<Deployment<System<SystemContract>, DeploymentAdapter>> {
  const source = resolve(directory, "src");
  const framework = import.meta.dirname;
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    plugins: [sourceAliasPlugin(source, framework)],
    root: directory,
    resolve: {
      alias: packageSourceAliases(framework, moduleExtension()),
      conditions: ["source", ...defaultServerConditions],
    },
    server: { middlewareMode: true, ws: false },
  });
  const workingDirectory = process.cwd();
  try {
    process.chdir(directory);
    const module = (await vite.ssrLoadModule(resolve(directory, path))) as Readonly<
      Record<string, unknown>
    >;
    const deployment = (module.default ?? module) as Partial<
      Deployment<System<SystemContract>, DeploymentAdapter>
    >;
    if (
      !deployment ||
      typeof deployment !== "object" ||
      !deployment.system ||
      !deployment.adapter ||
      typeof deployment.adapter.inspect !== "function" ||
      typeof deployment.adapter.apply !== "function" ||
      typeof deployment.adapter.remove !== "function"
    ) {
      throw new TypeError(`${path} must default-export one Deployment.`);
    }
    return deployment as Deployment<System<SystemContract>, DeploymentAdapter>;
  } finally {
    process.chdir(workingDirectory);
    await vite.close();
  }
}

function moduleExtension(): ".js" | ".ts" {
  return import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
}

function sourceAliasPlugin(project: string, framework: string): Plugin {
  return {
    name: "kit-deployment-source-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer?.split("?", 1)[0] ?? "";
      const root = inside(framework, owner) ? framework : project;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}

function inside(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

if (import.meta.main) await runCli();

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(positionalArguments(arguments_)[0] ?? "workspace");
  const force = arguments_.includes("--force");
  const install = !arguments_.includes("--no-install");
  const packageLocation = readFlag(arguments_, "package") ?? "latest";
  const name = normalizeName(readFlag(arguments_, "name") ?? basename(target));
  const exampleName = readFlag(arguments_, "example") ?? "basic";

  if (!name) throw new TypeError("Project name must contain a letter or number.");

  if (force) {
    await rm(target, { force: true, recursive: true });
  } else {
    try {
      if ((await readdir(target)).length) throw new Error(`${target} is not empty.`);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }

  const framework = await findPackageDirectory(import.meta.dirname);
  const examples = resolve(framework, "examples");
  const available = (await readdir(examples, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  if (!available.includes(exampleName)) {
    throw new TypeError(
      `Unknown example ${JSON.stringify(exampleName)}. Available examples: ${available.join(", ")}.`,
    );
  }
  const example = resolve(examples, exampleName);

  for (const [source, ignored] of [
    [resolve(framework, "template"), ignoredTemplateEntries],
    [example, ignoredExampleEntries],
  ] as const) {
    for (const path of await listFiles(source, "", ignored)) {
      const file = resolve(target, path);
      const contents = renderTemplate(path, await readFile(resolve(source, path), "utf8"), {
        name,
        packageLocation,
      });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
  }
  await Promise.all(
    workspaceDirectories.map((directory) => mkdir(resolve(target, directory), { recursive: true })),
  );

  if (install) {
    const code = await run(["nub", "install"], target);
    if (code !== 0) throw new Error("nub install failed.");
  }
  console.log(`created ${name} in ${target}`);
}

async function findPackageDirectory(start: string): Promise<string> {
  for (let directory = start; ; directory = dirname(directory)) {
    try {
      await Promise.all([
        readdir(resolve(directory, "template")),
        readdir(resolve(directory, "examples")),
      ]);
      return directory;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate Kit package resources.");
  }
}

async function listFiles(
  directory: string,
  prefix = "",
  ignored = ignoredTemplateEntries,
): Promise<string[]> {
  const files = await Promise.all(
    (await readdir(resolve(directory, prefix), { withFileTypes: true }))
      .filter((entry) => !ignored.has(entry.name))
      .map(async (entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(directory, path, ignored) : [path];
      }),
  );
  return files.flat().sort();
}

function renderTemplate(
  path: string,
  contents: string,
  values: { readonly name: string; readonly packageLocation: string },
): string {
  if (path === "package.json") {
    const manifest = JSON.parse(contents) as {
      name: string;
      dependencies: Record<string, string>;
    };
    manifest.name = values.name;
    manifest.dependencies["kit"] = values.packageLocation;
    return `${JSON.stringify(manifest, undefined, 2)}\n`;
  }
  if (path === "src/system.ts") {
    return contents.replace(
      /metadata:\s*{\s*name:\s*"[^"]*"\s*}/,
      `metadata: { name: "${values.name}" }`,
    );
  }
  return contents;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hasCode(error: unknown, code: string): error is { readonly code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function readFlag(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? undefined : arguments_[index + 1];
}

function positionalArguments(arguments_: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]!;
    if (!value.startsWith("--")) {
      values.push(value);
      continue;
    }
    if (valueFlags.has(value.slice(2))) index += 1;
  }
  return values;
}

async function run(command: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const [executable, ...arguments_] = command;
    if (!executable) return resolve(1);
    const child = spawn(executable, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
