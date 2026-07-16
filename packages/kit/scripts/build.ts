import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageDir = resolve(import.meta.dir, "..");
const distDir = resolve(packageDir, "dist");
const packageJson = await Bun.file(resolve(packageDir, "package.json")).json();
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
];
for (const entrypoint of entrypoints) {
  if (!(await Bun.file(entrypoint).exists())) {
    throw new Error(`Missing source for public entry ${entrypoint}.`);
  }
}

await rm(distDir, { force: true, recursive: true });
const declarations = Bun.spawn(
  [
    resolve(packageDir, "node_modules/typescript/bin/tsc"),
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
  { cwd: packageDir, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
if ((await declarations.exited) !== 0) process.exit(1);

for (const pattern of ["**/*.spec.d.ts", "**/*.typecheck.d.ts"]) {
  for await (const file of new Bun.Glob(pattern).scan({ cwd: distDir, onlyFiles: true })) {
    await rm(resolve(distDir, file));
  }
}
await rm(resolve(distDir, "scripts"), { force: true, recursive: true });

const build = await Bun.build({
  entrypoints,
  outdir: distDir,
  root: packageDir,
  target: "bun",
  format: "esm",
  splitting: true,
  packages: "external",
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
