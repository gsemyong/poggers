import { resolve } from "node:path";

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
  "kit/features/identity": "features/identity/index",
  "kit/features/model": "features/model/index",
  "kit/features/projection": "features/projection/index",
  "kit/features/replica": "features/replica/index",
  "kit/features/workflow": "features/workflow/public",
  "kit/jsx-dev-runtime": "jsx/development",
  "kit/jsx-runtime": "jsx/runtime",
  "kit/server": "platforms/server/index",
  "kit/testing": "testing/index",
  "kit/web": "platforms/web/index",
} as const;

export const packageSourceRoot = import.meta.dirname;

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
