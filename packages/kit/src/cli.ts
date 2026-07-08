#!/usr/bin/env bun
import {
  buildApp,
  bundleApp,
  checkAppConventions,
  resolveApp,
  runApp,
  writeAppTypes,
} from "./runtime";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
    const code = await typecheckApp(parsed.appDir);
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

async function typecheckApp(appDir: string): Promise<number> {
  await writeAppTypes(appDir);

  const appCode = await runTsc(appDir, ["--noEmit"]);
  if (appCode !== 0) return appCode;

  return typecheckRootDeps(appDir);
}

async function typecheckRootDeps(appDir: string): Promise<number> {
  const paths = resolveApp(appDir);
  if (!paths.deps || isPathInside(paths.sourceDir, paths.deps)) return 0;

  const configPath = resolve(paths.appDir, ".app/typecheck.deps.tsconfig.json");
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
            "@poggers/app": [resolve(paths.sourceDir, "poggers-app.d.ts")],
          },
        },
        files: [paths.deps],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return runTsc(paths.appDir, ["--noEmit", "-p", configPath]);
}

function runTsc(cwd: string, args: string[]): Promise<number> {
  const tsc = Bun.spawn([resolveBin(cwd, "tsc"), ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return tsc.exited;
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
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
