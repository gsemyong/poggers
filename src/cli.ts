#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";

import { platformAdapters } from "@/adapters/registry";
import type { PlatformAdapterImplementation } from "@/contracts/platform";
import { buildSystem, developSystem } from "@/realization";

const valueFlags = new Set(["dir", "kit-version", "name", "outdir", "outfile"]);
const ignoredStarterEntries = new Set([
  ".data",
  ".poggers",
  "coverage",
  "dist",
  "node_modules",
  "nub.lock",
  "target",
]);

export async function runCli(
  arguments_ = process.argv.slice(2),
  adapters: Readonly<Record<string, PlatformAdapterImplementation>> = platformAdapters,
): Promise<void> {
  const [command = "dev", ...commandArguments] = arguments_;
  const directory = readFlag(commandArguments, "dir") ?? process.cwd();
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
  } else if (command === "typecheck") {
    process.exitCode = await run(
      [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
      directory,
    );
  } else if (command === "test") {
    process.exitCode = await run(
      [resolve(directory, "node_modules/.bin/vitest"), "run", "--passWithNoTests"],
      directory,
    );
  } else if (command === "check") {
    const commands = [
      [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
      [resolve(directory, "node_modules/.bin/oxlint"), "src"],
      [resolve(directory, "node_modules/.bin/oxfmt"), "--check"],
      [resolve(directory, "node_modules/.bin/vitest"), "run", "--passWithNoTests"],
    ];
    for (const current of commands) {
      const code = await run(current, directory);
      if (code !== 0) {
        process.exitCode = code;
        break;
      }
    }
  } else {
    console.error("Usage: kit <dev [app]|build [app]|typecheck|test|check|create>");
    process.exitCode = 1;
  }
}

if (import.meta.main) await runCli();

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(positionalArguments(arguments_)[0] ?? "workspace");
  const force = arguments_.includes("--force");
  const install = !arguments_.includes("--no-install");
  const version = readFlag(arguments_, "kit-version") ?? "latest";
  const name = normalizeName(readFlag(arguments_, "name") ?? basename(target));

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

  const source = await findStarter(import.meta.dirname);
  for (const path of await listFiles(source)) {
    const file = resolve(target, path);
    const contents = renderStarter(path, await readFile(resolve(source, path), "utf8"), {
      name,
      version,
    });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  if (install) {
    const code = await run(["nub", "install"], target);
    if (code !== 0) throw new Error("nub install failed.");
  }
  console.log(`created ${name} in ${target}`);
}

async function findStarter(start: string): Promise<string> {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = resolve(directory, "examples/basic");
    try {
      await readdir(candidate);
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate the basic System example.");
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files = await Promise.all(
    (await readdir(resolve(directory, prefix), { withFileTypes: true }))
      .filter((entry) => !ignoredStarterEntries.has(entry.name))
      .map(async (entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listFiles(directory, path) : [path];
      }),
  );
  return files.flat().sort();
}

function renderStarter(
  path: string,
  contents: string,
  values: { readonly name: string; readonly version: string },
): string {
  if (path === "package.json") {
    const manifest = JSON.parse(contents) as {
      name: string;
      dependencies: Record<string, string>;
    };
    manifest.name = values.name;
    manifest.dependencies["@poggers/kit"] = values.version;
    return `${JSON.stringify(manifest, undefined, 2)}\n`;
  }
  if (path === "tsconfig.json") {
    return `{
  "extends": "@poggers/kit/tsconfig",
  "compilerOptions": {
    "paths": {
      "@/*": ["\${configDir}/src/*"]
    },
    "types": ["node"]
  }
}
`;
  }
  if (path === "src/system.ts") {
    return contents.replace('metadata: { name: "Basic" }', `metadata: { name: "${values.name}" }`);
  }
  if (path === "src/features/shell.tsx") {
    return contents.replace("<Title>Basic</Title>", `<Title>${values.name}</Title>`);
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
