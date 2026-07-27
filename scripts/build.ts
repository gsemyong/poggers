import { spawn } from "node:child_process";
import { access, copyFile, glob, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import * as ts from "@typescript/typescript6";
import { build } from "vite";

import { packageSources } from "@/package";

const packageDir = resolve(import.meta.dirname, "..");
const distDir = resolve(packageDir, "dist");
const sourceDir = resolve(packageDir, "src");
const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  bin?: Record<string, unknown>;
};
const targets = [
  ...Object.values(packageJson.exports).flatMap((entry) =>
    typeof entry === "object" && entry && "default" in entry ? [entry.default] : [],
  ),
  ...Object.values(packageJson.bin ?? {}),
];
const isBuildTarget = (target: unknown): target is string =>
  typeof target === "string" && target.startsWith("./dist/") && target.endsWith(".js");
const generatedRuntimeEntrypoints = [
  resolve(packageDir, "src/platforms/web/adapter/document.ts"),
  resolve(packageDir, "src/platforms/web/adapter/host.ts"),
  resolve(packageDir, "src/platforms/web/adapter/ui/adapter.ts"),
  resolve(packageDir, "src/platforms/web/adapter/ui/stream.ts"),
  resolve(packageDir, "src/execution/process.ts"),
];
const entrypoints = [
  ...new Set(
    targets
      .filter(isBuildTarget)
      .map((target) => resolve(packageDir, target.slice("./dist/".length).replace(/\.js$/, ".ts"))),
  ),
  // Generated artifacts import these internal realization boundaries directly.
  ...generatedRuntimeEntrypoints,
];
for (const entrypoint of entrypoints) {
  try {
    await access(entrypoint);
  } catch {
    throw new Error(`Missing source for public entry ${entrypoint}.`);
  }
}

await rm(distDir, { force: true, recursive: true });
const declarationCode = await emitDeclarations();
if (declarationCode !== 0) process.exit(1);

for (const pattern of ["**/*.spec.d.ts", "**/*.typecheck.d.ts"]) {
  for await (const file of glob(pattern, { cwd: distDir })) {
    await rm(resolve(distDir, file));
  }
}
await rm(resolve(distDir, "scripts"), { force: true, recursive: true });
await rewriteDeclarationAliases();
await copySemanticSources();
await copyFeatureProviderSources();
await copyPlatformNativeSources();

await build({
  configFile: false,
  root: packageDir,
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${sourceDir}/$1` }],
  },
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: distDir,
    ssr: true,
    rollupOptions: {
      external: (id) =>
        !id.startsWith(".") &&
        !id.startsWith("/") &&
        !id.startsWith("\0") &&
        !id.startsWith("#") &&
        !id.startsWith("@/"),
      input: entrypoints,
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "[name].js",
        format: "es",
        preserveModules: true,
        preserveModulesRoot: packageDir,
      },
    },
    sourcemap: false,
    target: "node26",
  },
});
const rustCompilerSource = resolve(sourceDir, "compiler/rust");
for (const pattern of ["runtime/Cargo.toml", "runtime/src/**/*.rs"]) {
  for await (const file of glob(pattern, { cwd: rustCompilerSource })) {
    for (const outputRoot of [
      resolve(distDir, "src/compiler/rust"),
      resolve(distDir, "source/compiler/rust"),
    ]) {
      const output = resolve(outputRoot, file);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(resolve(rustCompilerSource, file), output);
    }
  }
}
await assertDistribution();
await assertJavaScriptSyntax();
await assertCommandRuntimes();
await assertGeneratedRuntimeEntrypoints();
await assertNoPrivateAliases();
await assertVocabulary();
await assertServerEnvironment();

async function assertDistribution(): Promise<void> {
  const forbidden: string[] = [];
  for await (const file of glob("**/*", { cwd: distDir })) {
    if (
      file.split("/").includes("target") ||
      file.split("/").includes("fixtures") ||
      file.endsWith("Cargo.lock") ||
      /(?:^|\/)[^/]+\.(?:spec|typecheck)\./.test(file)
    ) {
      forbidden.push(file);
    }
  }
  if (forbidden.length) {
    throw new Error(`Build output contains private files:\n${forbidden.sort().join("\n")}`);
  }
}

async function assertJavaScriptSyntax(): Promise<void> {
  for await (const file of glob("**/*.js", { cwd: distDir })) {
    const source = await readFile(resolve(distDir, file), "utf8");
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const diagnostic = (
      parsed as ts.SourceFile & Readonly<{ parseDiagnostics: readonly ts.Diagnostic[] }>
    ).parseDiagnostics[0];
    if (!diagnostic) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const location = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    throw new Error(
      `Invalid JavaScript in ${file}:${location.line + 1}:${location.character + 1}: ${message}`,
    );
  }
}

async function assertCommandRuntimes(): Promise<void> {
  await Promise.all(
    ["realization.js", "platforms/index.js"].map(
      (file) => import(pathToFileURL(resolve(distDir, "src", file)).href),
    ),
  );
}

async function assertGeneratedRuntimeEntrypoints(): Promise<void> {
  for (const entrypoint of generatedRuntimeEntrypoints) {
    const output = resolve(distDir, relative(packageDir, entrypoint).replace(/\.ts$/, ".js"));
    try {
      await access(output);
    } catch {
      throw new Error(`Package build omitted generated runtime entry ${output}.`);
    }
  }
}

async function rewriteDeclarationAliases(): Promise<void> {
  const files: string[] = [];
  for await (const file of glob("src/**/*.d.ts", { cwd: distDir })) files.push(file);
  const targets = sourceTargets(files, (file) => file.slice("src/".length).replace(/\.d\.ts$/, ""));

  for (const file of files) {
    const path = resolve(distDir, file);
    const contents = await readFile(path, "utf8");
    const rewritten = contents.replaceAll(
      /(["'])@\/([^"']+)\1/g,
      (_match, quote: string, target: string) => {
        const targetFile = targets.get(target);
        if (!targetFile) throw new Error(`Declaration import @/${target} has no emitted target.`);
        let specifier = relative(dirname(path), resolve(distDir, targetFile))
          .replaceAll("\\", "/")
          .replace(/\.d\.ts$/, "");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      },
    );
    if (rewritten !== contents) await writeFile(path, rewritten);
  }
}

async function copySemanticSources(): Promise<void> {
  const files: string[] = [];
  for await (const file of glob("**/*.{ts,tsx}", { cwd: sourceDir })) {
    if (
      !file.split("/").includes("fixtures") &&
      !/(?:^|\/)[^/]+\.(?:spec|typecheck)\./.test(file)
    ) {
      files.push(file);
    }
  }
  const targets = sourceTargets(files, (file) => file.replace(/\.(?:ts|tsx)$/, ""));

  for (const file of files) {
    const output = resolve(distDir, "source", file);
    const contents = await readFile(resolve(sourceDir, file), "utf8");
    const rewritten = contents.replaceAll(
      /(["'])@\/([^"']+)\1/g,
      (_match, quote: string, target: string) => {
        const targetFile = targets.get(target);
        if (!targetFile) return _match;
        let specifier = relative(dirname(output), resolve(distDir, "source", targetFile))
          .replaceAll("\\", "/")
          .replace(/\.(?:ts|tsx)$/, "");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      },
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, rewritten);
  }
}

async function copyFeatureProviderSources(): Promise<void> {
  for (const pattern of [
    "features/*/providers/**/Cargo.toml",
    "features/*/providers/**/src/**/*.rs",
  ]) {
    for await (const file of glob(pattern, { cwd: sourceDir })) {
      const output = resolve(distDir, "source", file);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(resolve(sourceDir, file), output);
    }
  }
}

async function copyPlatformNativeSources(): Promise<void> {
  for (const pattern of [
    "platforms/*/adapter/**/Cargo.toml",
    "platforms/*/adapter/**/src/**/*.rs",
  ]) {
    for await (const file of glob(pattern, { cwd: sourceDir })) {
      if (file.split("/").includes("fixtures")) continue;
      for (const outputRoot of [resolve(distDir, "src"), resolve(distDir, "source")]) {
        const output = resolve(outputRoot, file);
        await mkdir(dirname(output), { recursive: true });
        await copyFile(resolve(sourceDir, file), output);
      }
    }
  }
}

function sourceTargets(
  files: readonly string[],
  name: (file: string) => string,
): Map<string, string> {
  const targets = new Map<string, string>();
  for (const file of files) {
    const target = name(file);
    targets.set(target, file);
    if (target.endsWith("/index")) targets.set(target.slice(0, -"/index".length), file);
  }
  return targets;
}

async function assertNoPrivateAliases(): Promise<void> {
  for await (const file of glob("**/*.{js,ts,tsx}", { cwd: distDir })) {
    const contents = await readFile(resolve(distDir, file), "utf8");
    if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bdeclare\s+module\s*)["']@\//.test(contents)) {
      throw new Error(`Private source alias leaked into ${file}.`);
    }
  }
}

async function assertVocabulary(): Promise<void> {
  for await (const file of glob("**/*.{js,json,rs,ts,tsx}", { cwd: distDir })) {
    const contents = await readFile(resolve(distDir, file), "utf8");
    if (/capabilit(?:y|ies)/i.test(contents)) {
      throw new Error(`Obsolete dependency terminology leaked into ${file}.`);
    }
  }
}

async function assertServerEnvironment(): Promise<void> {
  const production = await readFile(
    resolve(distDir, "src/platforms/server/adapter/rust/compiler.js"),
    "utf8",
  );
  if (!production.includes("process.env.KIT_PRODUCTION_CACHE")) {
    throw new Error("The package build replaced the server environment with a client constant.");
  }
}

async function emitDeclarations(): Promise<number> {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-declarations-"));
  try {
    const config = resolve(directory, "tsconfig.json");
    await writeFile(
      config,
      JSON.stringify(
        {
          extends: resolve(packageDir, "tsconfig.json"),
          files: entrypoints,
          compilerOptions: {
            rootDir: packageDir,
            typeRoots: [resolve(packageDir, "node_modules/@types")],
            paths: {
              "@/*": [resolve(packageDir, "src/*")],
              ...Object.fromEntries(
                Object.entries(packageSources).map(([specifier, source]) => [
                  specifier,
                  [resolve(packageDir, "src", `${source}.ts`)],
                ]),
              ),
            },
          },
        },
        null,
        2,
      ),
    );
    return await run(
      resolve(packageDir, "node_modules/typescript/bin/tsc"),
      [
        "-p",
        config,
        "--declaration",
        "--emitDeclarationOnly",
        "--noEmit",
        "false",
        "--outDir",
        "dist",
        "--allowImportingTsExtensions",
        "true",
        "--pretty",
        "false",
      ],
      packageDir,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
