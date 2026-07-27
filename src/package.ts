import { resolve } from "node:path";

export const packageSources = {
  kit: "index",
  "kit/adapter": "adapter",
  "kit/adapters/deployment/local": "deployment/adapters/local/index",
  "kit/adapters/server": "platforms/server/adapter/index",
  "kit/adapters/web": "platforms/web/adapter/index",
  "kit/cli": "cli",
  "kit/deployment": "deployment/index",
  "kit/deployment/oci": "deployment/artifacts/oci/index",
  "kit/factory": "factory",
  "kit/features/actor": "features/actor/index",
  "kit/features/data": "features/data/index",
  "kit/features/entity": "features/entity/index",
  "kit/features/identity": "features/identity/index",
  "kit/jsx-dev-runtime": "jsx/development",
  "kit/jsx-runtime": "jsx/runtime",
  "kit/server": "platforms/server/index",
  "kit/testing": "testing/index",
  "kit/ui": "ui",
  "kit/web": "platforms/web/index",
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
