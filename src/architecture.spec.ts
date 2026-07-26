import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { packageSources } from "@/package";

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
  { directory: "execution", imports: ["execution", "compiler", "core"] },
  { directory: "jsx", imports: ["jsx", "execution", "core"] },
  { directory: "features", imports: ["features", "platforms", "execution", "core"] },
  { directory: "deployment", imports: ["adapter", "core", "deployment"] },
  {
    directory: "platforms/server",
    imports: [
      "adapter",
      "package",
      "deployment",
      "compiler",
      "core",
      "execution",
      "features",
      "jsx",
      "platforms",
      "platforms/web/adapter/server",
    ],
  },
  {
    directory: "platforms/web",
    imports: [
      "adapter",
      "package",
      "deployment",
      "compiler",
      "core",
      "execution",
      "jsx",
      "platforms",
    ],
  },
] as const;

const modules: readonly ModuleBoundary[] = [
  { file: "index.ts", imports: ["core", "features"] },
  { file: "ui.ts", imports: ["core"] },
  { file: "factory.ts", imports: ["core"] },
  { file: "platforms/server/index.ts", imports: ["core"] },
  { file: "platforms/web/index.ts", imports: ["core", "jsx", "platforms/web"] },
  { file: "adapter.ts", imports: ["adapter", "compiler", "core", "deployment"] },
  { file: "deployment/index.ts", imports: ["adapter", "core", "deployment"] },
  { file: "realization.ts", imports: ["adapter", "compiler", "deployment"] },
  {
    file: "testing/index.ts",
    imports: [
      "adapter",
      "compiler",
      "execution",
      "features",
      "platforms",
      "realization",
      "testing",
    ],
  },
  {
    file: "cli.ts",
    imports: ["adapter", "core", "deployment", "package", "platforms", "realization"],
  },
  {
    file: "platforms.ts",
    imports: ["adapter", "platforms"],
  },
  { file: "package.ts", imports: [] },
  {
    file: "platforms/web/adapter/server.ts",
    imports: ["compiler", "execution", "platforms/web"],
  },
  {
    file: "platforms/server/adapter/rust/compiler.ts",
    imports: ["compiler", "platforms/server/adapter/rust", "platforms/web/adapter/server"],
  },
  { file: "compiler/rust/lowering.ts", imports: ["compiler"] },
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
          if (
            file.endsWith("/testing.ts") &&
            (owns("execution", imported) || owns("testing", imported))
          ) {
            continue;
          }
          if (
            boundary.directory === "execution" &&
            owns("compiler", imported) &&
            imported !== "compiler/ir"
          ) {
            violations.push(
              `${file.slice(source.length + 1)} imports @/${imported}; ` +
                "execution may consume only canonical @/compiler/ir meaning",
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

  test("keeps generic portable lowering free of Feature and deployment vocabulary", async () => {
    const source = import.meta.dirname;
    const typescript = [
      ...(await sourceFiles(resolve(source, "compiler"))).filter(
        (file) => !/\.(?:spec|typecheck)\.tsx?$/.test(file),
      ),
      resolve(source, "execution/interpreter.ts"),
      resolve(source, "platforms/server/adapter/rust/compiler.ts"),
      resolve(source, "compiler/rust/lowering.ts"),
    ];
    const rust = [
      resolve(source, "compiler/rust/runtime/src/lib.rs"),
      resolve(source, "platforms/server/adapter/rust/distribution/src/lib.rs"),
    ];
    const violations: string[] = [];
    for (const file of typescript) {
      if (/\b(?:actor|workflow|deployment|oci|nats)\b/i.test(await readFile(file, "utf8"))) {
        violations.push(file.slice(source.length + 1));
      }
    }
    for (const file of rust) {
      const implementation = (await readFile(file, "utf8")).split("\n#[cfg(test)]")[0]!;
      if (/\b(?:actor|workflow|deployment|oci|nats)\b/i.test(implementation)) {
        violations.push(file.slice(source.length + 1));
      }
    }
    expect(violations).toEqual([]);
  });

  test("uses only explicit architectural directory names", async () => {
    const forbidden = new Set(["compatibility", "helpers", "internal", "types", "utils"]);
    const directories = await sourceDirectories(import.meta.dirname);
    expect(
      directories
        .map((directory) => directory.slice(import.meta.dirname.length + 1))
        .filter((directory) => directory.split("/").some((name) => forbidden.has(name))),
    ).toEqual([]);
  });

  test("keeps public package source resolution consistent", async () => {
    const root = resolve(import.meta.dirname, "..");
    const packageManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      sideEffects?: boolean;
      exports: Readonly<
        Record<string, string | Readonly<{ source?: string; types?: string; default?: string }>>
      >;
    };
    const consumerConfig = JSON.parse(
      await readFile(resolve(root, "config/tsconfig.json"), "utf8"),
    ) as {
      compilerOptions: Readonly<Record<string, unknown>>;
      include?: unknown;
      exclude?: unknown;
    };
    const sourceExports = Object.entries(packageManifest.exports)
      .filter(([, value]) => typeof value === "object" && value.source)
      .map(([name]) => (name === "." ? "kit" : `kit${name.slice(1)}`))
      .sort();
    const aliases = Object.keys(packageSources).sort();

    expect(packageManifest.sideEffects).toBe(false);
    expect(packageManifest.exports["./tsconfig"]).toBe("./config/tsconfig.json");
    expect(consumerConfig.compilerOptions.paths).toEqual({
      "@/*": ["${configDir}/src/*"],
    });
    expect(consumerConfig.include).toBeUndefined();
    expect(consumerConfig.exclude).toBeUndefined();
    expect(aliases).toEqual(sourceExports);
    for (const [specifier, source] of Object.entries(packageSources)) {
      const name = specifier === "kit" ? "." : `.${specifier.slice(3)}`;
      const definition = packageManifest.exports[name];
      expect(typeof definition === "object" ? definition.source : undefined).toBe(
        `./dist/source/${source}.ts`,
      );
    }
  });

  test("keeps every example on the same minimal workspace configuration", async () => {
    const root = resolve(import.meta.dirname, "..");
    const expected = await readFile(resolve(root, "template/tsconfig.json"), "utf8");
    for (const entry of await readdir(resolve(root, "examples"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      expect(await readFile(resolve(root, "examples", entry.name, "tsconfig.json"), "utf8")).toBe(
        expected,
      );
    }
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
    if (entry.isDirectory() && entry.name !== "fixtures") files.push(...(await sourceFiles(path)));
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
