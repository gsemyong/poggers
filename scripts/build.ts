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
  // Generated applications import the private browser realization directly.
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
await mkdir(resolve(nativeOutput, "src"), { recursive: true });
await copyFile(resolve(nativeSource, "Cargo.toml"), resolve(nativeOutput, "Cargo.toml"));
await copyFile(resolve(nativeSource, "src/lib.rs"), resolve(nativeOutput, "src/lib.rs"));
await assertNoPrivateAliases();
await assertServerEnvironment();

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

async function assertNoPrivateAliases(): Promise<void> {
  for await (const file of glob("**/*.{js,d.ts}", { cwd: distDir })) {
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
