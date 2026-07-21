import { accessSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { build, createServer, defaultServerConditions } from "vite";

import type { ServerPlatform } from "@/adapters/server/platform";
import { startServerPrograms } from "@/adapters/server/runtime";
import type { PlatformAdapter } from "@/contracts/platform";
import type { Application, ApplicationContract } from "@/core/application";
import type { ProgramCapabilityModule } from "@/core/capability";
import type { ProgramIR } from "@/core/compiler/ir";

export { startServerPrograms } from "@/adapters/server/runtime";
export type { ServerCapabilityModules } from "@/adapters/server/runtime";

export type ServerPlatformAdapter = PlatformAdapter<ServerPlatform>;

/** Creates the development and production realization for headless server Programs. */
export function createServerPlatformAdapter(): ServerPlatformAdapter {
  return {
    name: "server",
    async develop(input) {
      const source = resolve(input.directory, "src");
      const vite = await createServer({
        appType: "custom",
        configFile: false,
        root: input.directory,
        resolve: {
          alias: kitAliases(),
          conditions: ["poggers-source", ...defaultServerConditions],
        },
        server: { middlewareMode: true },
      });
      const application = moduleDefault<Application<ApplicationContract>>(
        await vite.ssrLoadModule(input.application),
      );
      const modules: Record<string, ProgramCapabilityModule> = Object.create(null);
      for (const name of unique(input.programs.map(({ name }) => name))) {
        const path = resolveCapabilities(source, name);
        if (path) modules[name] = moduleDefault(await vite.ssrLoadModule(path));
      }
      const running = await startServerPrograms(
        application,
        input.programs,
        modules,
        "development",
      );
      let disposed = false;
      return {
        locations: running.locations,
        async [Symbol.asyncDispose]() {
          if (disposed) return;
          disposed = true;
          await running[Symbol.asyncDispose]();
          await vite.close();
        },
      };
    },
    async build(input) {
      const source = resolve(input.directory, "src");
      const capabilities = Object.fromEntries(
        unique(input.programs.map(({ name }) => name)).map((name) => [
          name,
          resolveCapabilities(source, name),
        ]),
      );
      const work = await mkdtemp(resolve(tmpdir(), "poggers-server-build-"));
      const entry = resolve(work, "server.ts");
      await writeFile(
        entry,
        serverEntry({
          application: input.application,
          capabilities,
          programs: input.programs,
          runtime: runtimeSource(),
        }),
      );
      await rm(input.output, { force: true, recursive: true });
      try {
        await build({
          configFile: false,
          root: input.directory,
          resolve: {
            alias: kitAliases(),
            conditions: ["poggers-source", ...defaultServerConditions],
          },
          build: {
            emptyOutDir: true,
            minify: "oxc",
            outDir: input.output,
            rollupOptions: { input: entry, output: { entryFileNames: "app.js", format: "es" } },
            ssr: true,
            target: "node26",
          },
          ssr: { noExternal: true },
        });
      } finally {
        await rm(work, { force: true, recursive: true });
      }
      return {
        directory: input.output,
        entries: [{ environment: "server", path: resolve(input.output, "app.js") }],
      };
    },
  };
}

function resolveCapabilities(source: string, program: string): string | undefined {
  for (const extension of [".ts", ".tsx"]) {
    const candidate = resolve(source, "capabilities", `${program}${extension}`);
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function moduleDefault<Value>(module: unknown): Value {
  const record = module as Readonly<Record<string, unknown>>;
  return (record.default ?? record) as Value;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function runtimeSource(): string {
  const extension = import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
  return resolve(import.meta.dirname, `runtime${extension}`);
}

function serverEntry(input: {
  application: string;
  capabilities: Readonly<Record<string, string | undefined>>;
  programs: readonly ProgramIR[];
  runtime: string;
}): string {
  const entries = Object.entries(input.capabilities);
  const imports = entries
    .flatMap(([_name, path], index) =>
      path ? [`import capabilities${index} from ${JSON.stringify(path)};`] : [],
    )
    .join("\n");
  const capabilities = entries
    .map(
      ([name, path], index) =>
        `${JSON.stringify(name)}: ${path ? `capabilities${index}` : "empty"}`,
    )
    .join(",\n  ");
  return `import application from ${JSON.stringify(input.application)};
import { startServerPrograms } from ${JSON.stringify(input.runtime)};
${imports}

const empty = { development: () => ({}), production: () => ({}) };
await startServerPrograms(application, ${JSON.stringify(input.programs)}, {
  ${capabilities}
}, "production");
`;
}

function kitAliases() {
  const source = resolve(import.meta.dirname, "../..");
  const extension = import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
  return [
    { find: /^@\/(.*)$/, replacement: `${source}/$1` },
    {
      find: /^@poggers\/kit\/jsx-dev-runtime$/,
      replacement: resolve(source, `core/jsx/development${extension}`),
    },
    {
      find: /^@poggers\/kit\/jsx-runtime$/,
      replacement: resolve(source, `core/jsx/runtime${extension}`),
    },
    {
      find: /^@poggers\/kit\/adapters\/server$/,
      replacement: resolve(source, `adapters/server/adapter${extension}`),
    },
    {
      find: /^@poggers\/kit\/server$/,
      replacement: resolve(source, `adapters/server/platform${extension}`),
    },
    { find: /^@poggers\/kit$/, replacement: resolve(source, `index${extension}`) },
  ];
}
