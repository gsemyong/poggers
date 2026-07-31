import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

export const packageSources = {
  kit: "index",
  "kit/adapter": "adapter",
  "kit/adapters/deployment/local": "deployment/adapters/local/index",
  "kit/adapters/server": "platforms/server/adapter/index",
  "kit/adapters/web": "platforms/web/adapter/index",
  "kit/deployment": "deployment/index",
  "kit/deployment/oci": "deployment/artifacts/oci/index",
  "kit/factory": "factory",
  "kit/features/actor": "features/actor/public",
  "kit/features/aggregate": "features/aggregate/index",
  "kit/features/data": "features/data/public",
  "kit/features/identity": "features/identity/index",
  "kit/features/model": "features/model/index",
  "kit/features/projection": "features/projection/public",
  "kit/features/replica": "features/replica/public",
  "kit/features/workflow": "features/workflow/public",
  "kit/jsx-dev-runtime": "jsx/development",
  "kit/jsx-runtime": "jsx/runtime",
  "kit/server": "platforms/server/index",
  "kit/testing": "testing/index",
  "kit/web": "platforms/web/index",
} as const;

export const packageSourceRoot = import.meta.dirname;

/**
 * Keeps repository source-mode compilation current without performing a package build.
 *
 * Published command runtimes use their packaged semantic sources and skip this path.
 */
export async function synchronizePackageSources(): Promise<number> {
  if (!import.meta.filename.endsWith(".ts")) return 0;
  const packageDirectory = resolve(packageSourceRoot, "..");
  const sourceDirectory = resolve(packageDirectory, "src");
  const outputDirectory = resolve(packageDirectory, "dist/source");
  const files: string[] = [];
  for await (const file of glob("**/*.{ts,tsx}", { cwd: sourceDirectory })) {
    if (
      !file.split("/").includes("fixtures") &&
      !/(?:^|\/)[^/]+\.(?:spec|typecheck)\./.test(file)
    ) {
      files.push(file);
    }
  }
  const targets = sourceTargets(files);
  const expected = new Set(files);
  let changed = 0;
  for (const file of files) {
    const output = resolve(outputDirectory, file);
    const contents = await readFile(resolve(sourceDirectory, file), "utf8");
    const rewritten = contents.replaceAll(
      /(["'])@\/([^"']+)\1/g,
      (_match, quote: string, target: string) => {
        const targetFile = targets.get(target);
        if (!targetFile) return _match;
        let specifier = relative(dirname(output), resolve(outputDirectory, targetFile))
          .replaceAll("\\", "/")
          .replace(/\.(?:ts|tsx)$/, "");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      },
    );
    let current: string | undefined;
    try {
      current = await readFile(output, "utf8");
    } catch {}
    if (current === rewritten) continue;
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, rewritten);
    changed += 1;
  }
  for await (const file of glob("**/*.{ts,tsx}", { cwd: outputDirectory })) {
    if (expected.has(file)) continue;
    await rm(resolve(outputDirectory, file));
    changed += 1;
  }
  return changed;
}

/** Resolves public package imports to the active TypeScript or built JavaScript source tree. */
export function packageSourceAliases(): readonly Readonly<{
  find: RegExp;
  replacement: string;
}>[] {
  const extension = import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
  return Object.entries(packageSources)
    .sort(([left], [right]) => right.length - left.length)
    .map(([specifier, path]) => ({
      find: new RegExp(`^${escapeRegExp(specifier)}$`),
      replacement: resolve(packageSourceRoot, `${path}${extension}`),
    }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceTargets(files: readonly string[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const file of files) {
    const target = file.replace(/\.(?:ts|tsx)$/, "");
    targets.set(target, file);
    if (target.endsWith("/index")) targets.set(target.slice(0, -"/index".length), file);
  }
  return targets;
}
