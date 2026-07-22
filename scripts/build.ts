import { spawn } from "node:child_process";
import { access, copyFile, glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

import { build } from "vite";

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
const entrypoints = [
  ...new Set(
    targets
      .filter(isBuildTarget)
      .map((target) => resolve(packageDir, target.slice("./dist/".length).replace(/\.js$/, ".ts"))),
  ),
  // Generated artifacts import these internal realization boundaries directly.
  resolve(packageDir, "src/adapters/web/document.ts"),
  resolve(packageDir, "src/adapters/web/ui/adapter.ts"),
];
for (const entrypoint of entrypoints) {
  try {
    await access(entrypoint);
  } catch {
    throw new Error(`Missing source for public entry ${entrypoint}.`);
  }
}

await rm(distDir, { force: true, recursive: true });
const declarationCode = await run(
  resolve(packageDir, "node_modules/typescript/bin/tsc"),
  [
    "-p",
    "tsconfig.json",
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
if (declarationCode !== 0) process.exit(1);

for (const pattern of ["**/*.spec.d.ts", "**/*.typecheck.d.ts"]) {
  for await (const file of glob(pattern, { cwd: distDir })) {
    await rm(resolve(distDir, file));
  }
}
await rm(resolve(distDir, "scripts"), { force: true, recursive: true });
await rm(resolve(distDir, "examples"), { force: true, recursive: true });
await rewriteDeclarationAliases();
await copySemanticSources();

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
const nativeSource = resolve(sourceDir, "adapters/server/native");
const nativeOutput = resolve(distDir, "src/adapters/server/native");
for (const pattern of [
  "runtime/Cargo.toml",
  "runtime/src/**/*.rs",
  "capabilities/*/Cargo.toml",
  "capabilities/*/src/**/*.rs",
]) {
  for await (const file of glob(pattern, { cwd: nativeSource })) {
    const output = resolve(nativeOutput, file);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(resolve(nativeSource, file), output);
  }
}
await assertDistribution();
await assertNoPrivateAliases();
await assertServerEnvironment();

async function assertDistribution(): Promise<void> {
  const forbidden: string[] = [];
  for await (const file of glob("**/*", { cwd: distDir })) {
    if (
      file.split("/").includes("target") ||
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

async function rewriteDeclarationAliases(): Promise<void> {
  for await (const file of glob("src/**/*.d.ts", { cwd: distDir })) {
    const path = resolve(distDir, file);
    const contents = await readFile(path, "utf8");
    const rewritten = contents.replaceAll(
      /(["'])@\/([^"']+)\1/g,
      (_match, quote: string, target: string) => {
        let specifier = relative(dirname(path), resolve(distDir, "src", target)).replaceAll(
          "\\\\",
          "/",
        );
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      },
    );
    if (rewritten !== contents) await writeFile(path, rewritten);
  }
}

async function copySemanticSources(): Promise<void> {
  for await (const file of glob("**/*.{ts,tsx}", { cwd: sourceDir })) {
    if (/(?:^|\/)[^/]+\.(?:spec|typecheck)\./.test(file)) continue;
    const output = resolve(distDir, "source", file);
    const contents = await readFile(resolve(sourceDir, file), "utf8");
    const rewritten = contents.replaceAll(
      /(["'])@\/([^"']+)\1/g,
      (_match, quote: string, target: string) => {
        let specifier = relative(dirname(output), resolve(distDir, "source", target)).replaceAll(
          "\\",
          "/",
        );
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      },
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, rewritten);
  }
}

async function assertNoPrivateAliases(): Promise<void> {
  for await (const file of glob("**/*.{js,ts,tsx}", { cwd: distDir })) {
    const contents = await readFile(resolve(distDir, file), "utf8");
    if (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bdeclare\s+module\s*)["']@\//.test(contents)) {
      throw new Error(`Private source alias leaked into ${file}.`);
    }
  }
}

async function assertServerEnvironment(): Promise<void> {
  const native = await readFile(resolve(distDir, "src/adapters/server/native.js"), "utf8");
  if (!native.includes("process.env.POGGERS_NATIVE_CACHE")) {
    throw new Error("The package build replaced the server environment with a client constant.");
  }
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
