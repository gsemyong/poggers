import { spawn } from "node:child_process";
import { access, glob, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "vite";

const packageDir = resolve(import.meta.dirname, "..");
const distDir = resolve(packageDir, "dist");
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
  resolve(packageDir, "src/ui/web/platform.ts"),
  resolve(packageDir, "src/ui/web/structure/runtime.ts"),
  resolve(packageDir, "src/compiler/backend/development.ts"),
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

await build({
  configFile: false,
  root: packageDir,
  resolve: { alias: { "#ui": resolve(packageDir, "src/ui") } },
  build: {
    emptyOutDir: false,
    minify: false,
    outDir: distDir,
    rollupOptions: {
      external: (id) =>
        !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0") && !id.startsWith("#"),
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
    target: "node24",
  },
});

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
