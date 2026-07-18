#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { buildApplication, buildRustApplication, runApplication } from "./application";
import { createProject } from "./create";

const [command = "dev", ...arguments_] = process.argv.slice(2);
const directory = readFlag(arguments_, "dir") ?? process.cwd();

if (command === "create") {
  await createProject(arguments_);
} else if (command === "dev") {
  const server = await runApplication({
    directory,
    port: numberFlag(readFlag(arguments_, "port")),
  });
  console.log(`poggers dev running on http://localhost:${server.port}`);
  const stop = async () => {
    await server.stop();
    process.exit();
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
} else if (command === "build") {
  const target = readFlag(arguments_, "target") ?? "web";
  if (target === "web") {
    const output = await buildApplication({
      directory,
      outdir: readFlag(arguments_, "outdir") ?? readFlag(arguments_, "outfile") ?? "dist",
    });
    console.log(`built ${output}`);
  } else if (target === "rust") {
    const output = await buildRustApplication({
      directory,
      outdir: readFlag(arguments_, "outdir"),
      program: readFlag(arguments_, "program"),
      adapter: readFlag(arguments_, "adapter"),
    });
    const code = await run(["cargo", "build", "--release"], output);
    process.exitCode = code;
    if (code === 0) console.log(`built ${output}/target/release/poggers_program`);
  } else {
    throw new TypeError(`Unknown build target ${JSON.stringify(target)}.`);
  }
} else if (command === "typecheck") {
  process.exitCode = await run(
    [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
    directory,
  );
} else if (command === "test") {
  process.exitCode = await run(
    [resolve(directory, "node_modules/.bin/vitest"), "run", "--passWithNoTests", "src"],
    directory,
  );
} else if (command === "check") {
  const commands = [
    [resolve(directory, "node_modules/.bin/tsc"), "-p", "tsconfig.json"],
    [resolve(directory, "node_modules/.bin/oxlint"), "src"],
    [resolve(directory, "node_modules/.bin/oxfmt"), "--check"],
    [resolve(directory, "node_modules/.bin/vitest"), "run", "--passWithNoTests", "src"],
  ];
  for (const current of commands) {
    const code = await run(current, directory);
    if (code !== 0) {
      process.exitCode = code;
      break;
    }
  }
} else {
  console.error("Usage: poggers <dev|build|typecheck|test|check|create> [--target web|rust]");
  process.exitCode = 1;
}

function readFlag(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? undefined : arguments_[index + 1];
}

function numberFlag(value: string | undefined): number | undefined {
  if (value === undefined) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`Invalid port ${JSON.stringify(value)}.`);
  }
  return parsed;
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
