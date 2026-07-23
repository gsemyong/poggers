import { resolve } from "node:path";

export const packageSources = {
  kit: "index",
  "kit/adapter": "contracts/platform",
  "kit/adapters/server": "adapters/server/adapter",
  "kit/adapters/web": "adapters/web/adapter",
  "kit/cli": "cli",
  "kit/jsx-dev-runtime": "jsx/development",
  "kit/jsx-runtime": "jsx/runtime",
  "kit/server": "platforms/server/platform",
  "kit/testing": "testing",
  "kit/ui": "ui",
  "kit/web": "platforms/web/platform",
} as const;

/** Resolves public package imports to the active TypeScript or built JavaScript source tree. */
export function packageSourceAliases(
  source: string,
  extension: ".js" | ".ts",
): readonly Readonly<{ find: RegExp; replacement: string }>[] {
  return Object.entries(packageSources)
    .sort(([left], [right]) => right.length - left.length)
    .map(([specifier, path]) => ({
      find: new RegExp(`^${escapeRegExp(specifier)}$`),
      replacement: resolve(source, `${path}${extension}`),
    }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
