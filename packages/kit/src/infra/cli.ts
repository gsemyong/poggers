#!/usr/bin/env bun
import { buildApp, bundleApp, checkAppConventions, runApp, writeAppTypes } from "./runtime";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

type ParsedArgs = {
  command: string;
  appDir: string;
  flags: Map<string, string | true>;
};

async function main(argv = Bun.argv.slice(2)) {
  const parsed = parseArgs(argv);

  if (parsed.command === "dev") {
    const handle = await runApp({
      appDir: parsed.appDir,
      port: readNumber(parsed.flags.get("port")),
      title: readString(parsed.flags.get("title")),
    });
    process.on("SIGINT", () => {
      handle.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      handle.stop();
      process.exit(0);
    });
    return;
  }

  if (parsed.command === "bundle") {
    await bundleApp({
      appDir: parsed.appDir,
      outdir: readString(parsed.flags.get("outdir")),
      minify: parsed.flags.get("minify") !== "false",
    });
    return;
  }

  if (parsed.command === "build") {
    await buildApp({
      appDir: parsed.appDir,
      outfile: readString(parsed.flags.get("outfile")) ?? "dist/app",
      title: readString(parsed.flags.get("title")),
      minify: parsed.flags.get("minify") !== "false",
    });
    return;
  }

  if (parsed.command === "typecheck") {
    await writeAppTypes(parsed.appDir);
    const tsc = Bun.spawn([resolveBin(parsed.appDir, "tsc"), "--noEmit"], {
      cwd: parsed.appDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await tsc.exited;
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (parsed.command === "check") {
    const issues = checkAppConventions(parsed.appDir);
    if (issues.length > 0) {
      for (const issue of issues) {
        console.error(`${issue.file}: ${issue.message}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const commands = new Set(["dev", "bundle", "build", "typecheck", "check"]);
  const first = argv[0];
  const command = first && commands.has(first) ? first : "dev";
  const rest = command === first ? argv.slice(1) : argv;
  const flags = new Map<string, string | true>();
  let appDir = ".";
  let hasAppDir = false;

  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i]!;
    if (!raw.startsWith("--")) {
      if (!hasAppDir) {
        appDir = raw;
        hasAppDir = true;
      }
      continue;
    }

    const name = raw.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { command, appDir, flags };
}

function readNumber(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readString(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveBin(startDir: string, name: string): string {
  const binName = process.platform === "win32" ? `${name}.cmd` : name;
  let dir = resolve(startDir);

  while (true) {
    const candidate = resolve(dir, "node_modules", ".bin", binName);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return name;
    dir = parent;
  }
}

function printUsage() {
  console.error(`Usage:
  poggers dev <app-dir> [--port 3000] [--title "My App"]
  poggers bundle <app-dir> [--outdir .app/build/web] [--minify false]
  poggers build <app-dir> --outfile dist/my-app [--title "My App"]
  poggers typecheck <app-dir>
  poggers check <app-dir>`);
}

if (import.meta.main) {
  await main();
}
