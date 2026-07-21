#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";

import { platformAdapters } from "@/adapters/registry";
import {
  selectPlatformAdapters,
  type DevelopmentSession,
  type PlatformAdapterImplementation,
} from "@/contracts/platform";
import { compileApplication, resolveApplication } from "@/core/compiler/source";

export async function runCli(
  arguments_ = process.argv.slice(2),
  adapters: Readonly<Record<string, PlatformAdapterImplementation>> = platformAdapters,
): Promise<void> {
  const [command = "dev", ...commandArguments] = arguments_;
  const directory = readFlag(commandArguments, "dir") ?? process.cwd();

  if (command === "create") {
    await createProject(commandArguments);
  } else if (command === "dev") {
    const realization = resolveRealization(directory, adapters);
    const sessions: DevelopmentSession[] = [];
    try {
      for (const adapter of realization.adapters) {
        sessions.push(
          await adapter.develop({
            ...realization.input,
            platform: adapter.name,
            programs: realization.ir.programs.filter(
              ({ environment }) => environment.platform === adapter.name,
            ),
          }),
        );
      }
    } catch (error) {
      await disposeSessions(sessions);
      throw error;
    }
    for (const location of sessions.flatMap((session) => session.locations)) {
      console.log(`poggers dev running on ${location}`);
    }
    const stop = async () => {
      await disposeSessions(sessions);
      process.exit();
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  } else if (command === "build") {
    const realization = resolveRealization(directory, adapters);
    const root = resolve(
      directory,
      readFlag(commandArguments, "outdir") ?? readFlag(commandArguments, "outfile") ?? "dist",
    );
    for (const adapter of realization.adapters) {
      const output = realization.adapters.length === 1 ? root : resolve(root, adapter.name);
      const artifacts = await adapter.build({
        ...realization.input,
        platform: adapter.name,
        programs: realization.ir.programs.filter(
          ({ environment }) => environment.platform === adapter.name,
        ),
        output,
      });
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
    console.error("Usage: poggers <dev|build|typecheck|test|check|create>");
    process.exitCode = 1;
  }
}

if (import.meta.main) await runCli();

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(arguments_.find((value) => !value.startsWith("--")) ?? "my-app");
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

  const source = await findTemplate(import.meta.dirname);
  for (const path of await listFiles(source)) {
    const file = resolve(target, path);
    const contents = renderTemplate(await readFile(resolve(source, path), "utf8"), {
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

async function findTemplate(start: string): Promise<string> {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = resolve(directory, "template");
    try {
      await readdir(candidate);
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot locate the Poggers application template.");
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files = await Promise.all(
    (await readdir(resolve(directory, prefix), { withFileTypes: true })).map(async (entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(directory, path) : [path];
    }),
  );
  return files.flat().sort();
}

function renderTemplate(
  contents: string,
  values: { readonly name: string; readonly version: string },
): string {
  return contents.replaceAll("{{name}}", values.name).replaceAll("{{kitVersion}}", values.version);
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

function resolveRealization(
  directory: string,
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
) {
  const paths = resolveApplication(directory);
  const ir = compileApplication(paths.application);
  return {
    ir,
    adapters: selectPlatformAdapters(ir, adapters),
    input: {
      directory: paths.directory,
      application: paths.application,
      ir,
    },
  };
}

async function disposeSessions(sessions: readonly DevelopmentSession[]): Promise<void> {
  const results = await Promise.allSettled(
    [...sessions].reverse().map((session) => session[Symbol.asyncDispose]()),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Platform disposal failed.");
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
