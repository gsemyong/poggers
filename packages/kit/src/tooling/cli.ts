#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildApp,
  bundleApp,
  checkAppConventions,
  createMigration,
  resolveApp,
  runApp,
  validateAppStyles,
  writeMigrationSnapshot,
} from "#tooling/application";
import { createProject } from "#tooling/create";

type ParsedArgs = {
  command: string;
  appDir: string;
  flags: Map<string, string | true>;
  migrationCommand?: string;
  migrationName?: string;
};

async function main(argv = Bun.argv.slice(2)) {
  if (argv[0] === "create") {
    await createProject(argv.slice(1));
    return;
  }
  const parsed = parseArgs(argv);

  if (parsed.command === "dev") {
    const handle = await runApp({
      appDir: parsed.appDir,
      port: readNumber(parsed.flags.get("port")),
      title: readString(parsed.flags.get("title")),
      durability: readDurability(parsed.flags.get("durability")),
    });
    const stop = async () => {
      await handle.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => {
      void stop();
    });
    process.on("SIGTERM", () => {
      void stop();
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

  if (parsed.command === "lsp") {
    const code = await runLsp(parsed.appDir);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (parsed.command === "typecheck") {
    const code = await typecheckApp(parsed.appDir);
    if (code !== 0) process.exitCode = code;
    return;
  }

  if (parsed.command === "test") {
    const code = await testApp(parsed.appDir);
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

function readDurability(value: string | true | undefined) {
  if (value === undefined) return undefined;
  if (value === true) throw new TypeError("--durability requires a value.");
  if (value === "power-safe" || value === "process-safe") return value;
  throw new TypeError('--durability must be "power-safe" or "process-safe".');
}

function parseArgs(argv: string[]): ParsedArgs {
  const commands = new Set([
    "dev",
    "bundle",
    "build",
    "lsp",
    "typecheck",
    "test",
    "check",
    "migrations",
  ]);
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
  const issues = checkAppConventions(appDir);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`${issue.file}: ${issue.message}`);
    return 1;
  }
  const appCode = await runTsc(appDir, ["--noEmit"]);
  if (appCode !== 0) return appCode;

  return typecheckMigrations(appDir);
}

async function testApp(appDir: string): Promise<number> {
  const paths = resolveApp(appDir);
  const sourceAlias = resolve(paths.appDir, "node_modules/src");
  if (existsSync(sourceAlias)) {
    throw new Error(`Application tests reserve ${sourceAlias} for the distributed src/* alias.`);
  }
  await mkdir(dirname(sourceAlias), { recursive: true });
  await symlink(paths.sourceDir, sourceAlias, "dir");

  try {
    const test = Bun.spawn(
      ["bun", "test", "--jsx-import-source=@poggers/kit", "--jsx-runtime=automatic", "src"],
      {
        cwd: paths.appDir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    return await test.exited;
  } finally {
    await rm(sourceAlias, { force: true });
  }
}

async function runLsp(appDir: string): Promise<number> {
  const paths = resolveApp(appDir);
  const server = Bun.spawn([resolveBin(paths.appDir, "tsc"), "--lsp", "--stdio"], {
    cwd: paths.appDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    return await server.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
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
          types: ["bun"],
          moduleResolution: "bundler",
          verbatimModuleSyntax: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          paths: {
            app: [resolve(paths.sourceDir, "app.tsx")],
            "src/*": [resolve(paths.sourceDir, "*")],
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
  poggers dev <app-dir> [--port 3000] [--title "My App"] [--durability power-safe|process-safe]
  poggers bundle <app-dir> [--outdir .poggers/build/web] [--minify false]
  poggers build <app-dir> --outfile dist/my-app [--title "My App"]
  poggers lsp <app-dir>
  poggers typecheck <app-dir>
  poggers test <app-dir>
  poggers create [directory] [--name my-app] [--no-install]
  poggers migrations snapshot <app-dir>
  poggers migrations create <name> <app-dir>
  poggers check <app-dir>`);
}

if (import.meta.main) {
  await main();
}
