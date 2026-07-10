#!/usr/bin/env bun
import {
  buildApp,
  bundleApp,
  checkAppConventions,
  createMigration,
  resolveApp,
  runApp,
  validateAppStyles,
  writeAppTypes,
  writeMigrationSnapshot,
} from "./runtime";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type ParsedArgs = {
  command: string;
  appDir: string;
  flags: Map<string, string | true>;
  migrationCommand?: string;
  migrationName?: string;
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

  if (parsed.command === "sync") {
    await writeAppTypes(parsed.appDir);
    return;
  }

  if (parsed.command === "typecheck") {
    const code = await typecheckApp(parsed.appDir);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (parsed.command === "migrations") {
    if (parsed.migrationCommand === "snapshot") {
      const snapshot = await writeMigrationSnapshot(parsed.appDir);
      console.log(
        `${snapshot.created ? "Created" : "Found"} migration snapshot ${snapshot.hash} at ${snapshot.path}`,
      );
      return;
    }

    if (parsed.migrationCommand === "create") {
      if (!parsed.migrationName) {
        console.error("Missing migration name.");
        printUsage();
        process.exitCode = 1;
        return;
      }

      const result = await createMigration(parsed.appDir, parsed.migrationName);
      if (result.kind === "initial") {
        console.log(`Created initial migration snapshot ${result.snapshot.hash}.`);
        return;
      }
      if (result.kind === "unchanged") {
        console.log(`No structural changes found. Current snapshot is ${result.snapshot.hash}.`);
        return;
      }
      if (result.kind === "exists") {
        console.log(`Migration already exists from ${result.fromHash} to ${result.toHash}.`);
        console.log(result.path);
        return;
      }

      console.log(`Created draft migration from ${result.fromHash} to ${result.toHash}.`);
      console.log(result.path);
      console.log("Review it, remove the draft marker, then run poggers typecheck.");
      return;
    }

    printUsage();
    process.exitCode = 1;
    return;
  }

  if (parsed.command === "check") {
    let failed = false;
    const issues = checkAppConventions(parsed.appDir);
    if (issues.length > 0) {
      for (const issue of issues) {
        console.error(`${issue.file}: ${issue.message}`);
      }
      failed = true;
    }
    try {
      await validateAppStyles(parsed.appDir);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      failed = true;
    }
    if (failed) process.exitCode = 1;
    return;
  }

  printUsage();
  process.exitCode = 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const commands = new Set(["dev", "bundle", "build", "sync", "typecheck", "check", "migrations"]);
  const first = argv[0];
  const command = first && commands.has(first) ? first : "dev";
  if (command === "migrations") {
    const migrationCommand = argv[1];
    const rest =
      migrationCommand === "create"
        ? argv.slice(3)
        : migrationCommand === "snapshot"
          ? argv.slice(2)
          : argv.slice(1);
    const parsed = parseAppDirAndFlags(rest);
    return {
      command,
      migrationCommand,
      migrationName: migrationCommand === "create" ? argv[2] : undefined,
      appDir: parsed.appDir,
      flags: parsed.flags,
    };
  }

  const rest = command === first ? argv.slice(1) : argv;
  const parsed = parseAppDirAndFlags(rest);
  return { command, appDir: parsed.appDir, flags: parsed.flags };
}

function parseAppDirAndFlags(rest: string[]): {
  appDir: string;
  flags: Map<string, string | true>;
} {
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

  return { appDir, flags };
}

function readNumber(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readString(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function typecheckApp(appDir: string): Promise<number> {
  try {
    await writeAppTypes(appDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const appCode = await runTsc(appDir, ["--noEmit"]);
  if (appCode !== 0) return appCode;

  return typecheckMigrations(appDir);
}

async function typecheckMigrations(appDir: string): Promise<number> {
  const paths = resolveApp(appDir);
  const migrationFiles = await listMigrationEdgeFiles(resolve(paths.sourceDir, "migrations"));
  if (migrationFiles.length === 0) return 0;

  const configPath = resolve(paths.appDir, ".poggers/typecheck.migrations.tsconfig.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022", "DOM"],
          target: "ESNext",
          module: "Preserve",
          moduleDetection: "force",
          jsx: "react-jsx",
          jsxImportSource: "@poggers/kit",
          allowJs: true,
          allowImportingTsExtensions: true,
          types: ["@poggers/kit/globals"],
          moduleResolution: "bundler",
          verbatimModuleSyntax: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          paths: {
            "@poggers/app": [resolve(paths.appDir, ".poggers/types/app.d.ts")],
            app: [resolve(paths.sourceDir, "app.ts")],
            deps: [resolve(paths.sourceDir, "deps.ts")],
            types: [resolve(paths.sourceDir, "types.ts")],
            "src/*": [resolve(paths.sourceDir, "*")],
            "ui/*": [resolve(paths.sourceDir, "ui/*")],
          },
        },
        files: migrationFiles,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return runTsc(paths.appDir, ["--noEmit", "-p", configPath]);
}

async function listMigrationEdgeFiles(migrationsDir: string): Promise<string[]> {
  if (!existsSync(migrationsDir)) return [];
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => resolve(migrationsDir, entry.name))
    .sort();
}

function runTsc(cwd: string, args: string[]): Promise<number> {
  const tsc = Bun.spawn([resolveBin(cwd, "tsc"), ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return tsc.exited;
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
  poggers bundle <app-dir> [--outdir .poggers/build/web] [--minify false]
  poggers build <app-dir> --outfile dist/my-app [--title "My App"]
  poggers sync <app-dir>
  poggers typecheck <app-dir>
  poggers migrations snapshot <app-dir>
  poggers migrations create <name> <app-dir>
  poggers check <app-dir>`);
}

if (import.meta.main) {
  await main();
}
