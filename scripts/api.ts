import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

import ts from "@typescript/typescript6";

interface PackageManifest {
  readonly name: string;
  readonly bin?: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, ExportDefinition>>;
}

type ExportDefinition =
  | string
  | {
      readonly default?: string;
      readonly source?: string;
      readonly types?: string;
    };

interface ApiManifest {
  readonly version: 1;
  readonly package: string;
  readonly intent: string;
  readonly fingerprint: string;
  readonly bin: Readonly<Record<string, string>>;
  readonly exports: Readonly<
    Record<
      string,
      {
        readonly target: string;
        readonly symbols: readonly string[];
      }
    >
  >;
  readonly declarations: Readonly<Record<string, string>>;
}

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/api.json");
const write = process.argv.includes("--write");
const intent = readArgument("intent");
const packageManifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as PackageManifest;
const current = await createApiManifest(packageManifest, await readExistingIntent());

if (write) {
  if (!intent) {
    throw new Error("API updates require --intent <change-file>.");
  }
  await validateIntent(intent);
  await writeFile(manifestPath, `${JSON.stringify({ ...current, intent }, undefined, 2)}\n`);
  console.log(`recorded public API with ${intent}`);
} else {
  const recorded = JSON.parse(await readFile(manifestPath, "utf8")) as ApiManifest;
  await validateIntent(recorded.intent);
  if (JSON.stringify(current) !== JSON.stringify(recorded)) {
    throw new Error(
      "The public API differs from docs/api.json. Review the change, add a change file, then run `nub run api:update -- --intent <change-file>`.",
    );
  }
}

async function createApiManifest(
  manifest: PackageManifest,
  recordedIntent: string,
): Promise<ApiManifest> {
  const typeEntries = Object.entries(manifest.exports).flatMap(([name, definition]) =>
    typeof definition === "object" && definition.types
      ? [{ name, file: resolve(root, definition.types) }]
      : [],
  );
  const program = ts.createProgram({
    rootNames: typeEntries.map(({ file }) => file),
    options: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
  const checker = program.getTypeChecker();
  const exports = Object.fromEntries(
    await Promise.all(
      Object.entries(manifest.exports).map(async ([name, definition]) => {
        const target = typeof definition === "string" ? definition : (definition.default ?? "");
        const typeTarget = typeof definition === "object" ? definition.types : undefined;
        if (!typeTarget) return [name, { target, symbols: [] }] as const;
        const source = program.getSourceFile(resolve(root, typeTarget));
        if (!source) throw new Error(`Cannot inspect public declaration ${typeTarget}.`);
        const module = checker.getSymbolAtLocation(source);
        if (!module) throw new Error(`Cannot inspect exports from ${typeTarget}.`);
        const symbols = checker
          .getExportsOfModule(module)
          .map((symbol) => {
            const resolved =
              symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            const type = Boolean(resolved.flags & ts.SymbolFlags.Type);
            const value = Boolean(resolved.flags & ts.SymbolFlags.Value);
            const kind = type && value ? "type+value" : type ? "type" : "value";
            return `${kind} ${symbol.getName()}`;
          })
          .sort();
        return [name, { target, symbols }] as const;
      }),
    ),
  );
  const declarations = await declarationClosure(typeEntries.map(({ file }) => file));
  const surface = {
    version: 1 as const,
    package: manifest.name,
    intent: recordedIntent,
    bin: Object.fromEntries(Object.entries(manifest.bin ?? {}).sort()),
    exports,
    declarations,
  };
  return {
    ...surface,
    fingerprint: createHash("sha256").update(JSON.stringify(surface)).digest("hex"),
  };
}

async function declarationClosure(entries: readonly string[]): Promise<Record<string, string>> {
  const queue = [...entries];
  const files = new Map<string, string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const source = await readFile(file, "utf8");
    files.set(file, createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"));
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const imported of imports) {
      if (!imported.fileName.startsWith(".")) continue;
      const dependency = await resolveDeclaration(dirname(file), imported.fileName);
      if (dependency) queue.push(dependency);
    }
  }
  return Object.fromEntries(
    [...files]
      .map(([file, hash]) => [relative(root, file).replaceAll("\\", "/"), hash] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function resolveDeclaration(
  directory: string,
  specifier: string,
): Promise<string | undefined> {
  const base = resolve(directory, specifier);
  for (const candidate of [
    base,
    `${base}.d.ts`,
    `${base}.ts`,
    `${base}/index.d.ts`,
    `${base}/index.ts`,
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return undefined;
}

async function readExistingIntent(): Promise<string> {
  try {
    return (JSON.parse(await readFile(manifestPath, "utf8")) as ApiManifest).intent;
  } catch {
    return intent ?? "";
  }
}

async function validateIntent(path: string): Promise<void> {
  if (!path.startsWith("changes/") || path.includes("..")) {
    throw new Error(`API intent must be a file under changes/: ${path}`);
  }
  const contents = await readFile(resolve(root, path), "utf8");
  if (!/^kind: (breaking|feature|fix)$/m.test(contents) || !/^summary: .+$/m.test(contents)) {
    throw new Error(`${path} must declare kind and summary.`);
  }
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}
