import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

type Boundary = Readonly<{
  directory: string;
  imports: readonly string[];
}>;

type ModuleBoundary = Readonly<{
  file: string;
  imports: readonly string[];
}>;

const boundaries: readonly Boundary[] = [
  { directory: "core", imports: ["core"] },
  { directory: "compiler", imports: ["compiler", "core"] },
  { directory: "runtime", imports: ["runtime", "compiler", "core"] },
  { directory: "jsx", imports: ["jsx", "runtime", "core"] },
  { directory: "contracts", imports: ["contracts", "compiler", "core"] },
  { directory: "platforms", imports: ["platforms", "core", "jsx"] },
  { directory: "features", imports: ["features", "platforms", "core"] },
  {
    directory: "adapters/integration",
    imports: [
      "adapters/integration",
      "adapters/server",
      "adapters/web",
      "contracts",
      "compiler",
      "runtime",
      "core",
      "jsx",
      "platforms",
    ],
  },
  {
    directory: "adapters/server",
    imports: [
      "adapters/server",
      "adapters/integration",
      "contracts",
      "compiler",
      "runtime",
      "core",
      "jsx",
      "platforms",
    ],
  },
  {
    directory: "adapters/web",
    imports: [
      "adapters/web",
      "adapters/integration",
      "contracts",
      "compiler",
      "runtime",
      "core",
      "jsx",
      "platforms",
    ],
  },
] as const;

const modules: readonly ModuleBoundary[] = [
  { file: "index.ts", imports: ["core", "features"] },
  { file: "realization.ts", imports: ["compiler", "contracts"] },
  {
    file: "testing.ts",
    imports: ["adapters", "compiler", "contracts", "features", "realization", "runtime"],
  },
  { file: "cli.ts", imports: ["adapters", "contracts", "realization"] },
  {
    file: "adapters/registry.ts",
    imports: ["adapters/integration", "adapters/server", "adapters/web", "contracts", "platforms"],
  },
] as const;

describe("architecture import graph", () => {
  test("production modules import only their declared architectural dependencies", async () => {
    const source = import.meta.dirname;
    const violations: string[] = [];

    for (const boundary of boundaries) {
      const directory = resolve(source, boundary.directory);
      for (const file of await sourceFiles(directory)) {
        if (/\.(?:spec|typecheck)\.tsx?$/.test(file)) continue;
        const contents = await readFile(file, "utf8");
        for (const imported of aliasImports(contents)) {
          if (file.endsWith(".testing.ts") && owns("runtime", imported)) continue;
          if (
            boundary.directory === "runtime" &&
            owns("compiler", imported) &&
            imported !== "compiler/ir"
          ) {
            violations.push(
              `${file.slice(source.length + 1)} imports @/${imported}; ` +
                "runtime may consume only canonical @/compiler/ir meaning",
            );
            continue;
          }
          if (boundary.imports.some((allowed) => owns(allowed, imported))) continue;
          violations.push(
            `${file.slice(source.length + 1)} imports @/${imported}; ` +
              `allowed: ${boundary.imports.map((value) => `@/${value}`).join(", ")}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("composition modules import only their declared architectural dependencies", async () => {
    const source = import.meta.dirname;
    const violations: string[] = [];
    for (const boundary of modules) {
      const contents = await readFile(resolve(source, boundary.file), "utf8");
      for (const imported of aliasImports(contents)) {
        if (boundary.imports.some((allowed) => owns(allowed, imported))) continue;
        violations.push(
          `${boundary.file} imports @/${imported}; ` +
            `allowed: ${boundary.imports.map((value) => `@/${value}`).join(", ")}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  test("uses only explicit architectural directory names", async () => {
    const forbidden = new Set(["compatibility", "helpers", "internal", "native", "types", "utils"]);
    const directories = await sourceDirectories(import.meta.dirname);
    expect(
      directories
        .map((directory) => directory.slice(import.meta.dirname.length + 1))
        .filter((directory) => directory.split("/").some((name) => forbidden.has(name))),
    ).toEqual([]);
  });
});

function aliasImports(source: string): readonly string[] {
  const imports = new Set<string>();
  const pattern = /(?:from\s+|import\s*\(\s*)["']@\/([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) imports.add(match[1]!);
  return [...imports].sort();
}

function owns(directory: string, path: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

async function sourceDirectories(directory: string): Promise<string[]> {
  const directories: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "target") continue;
    const path = resolve(directory, entry.name);
    directories.push(path, ...(await sourceDirectories(path)));
  }
  return directories.sort();
}
