import { realpathSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { createServer, defaultServerConditions, type ViteDevServer } from "vite";

import { createNodeHost } from "@/adapters/server/host";
import { buildNativeServerProgram } from "@/adapters/server/native";
import type { ServerPlatform } from "@/adapters/server/platform";
import { startServerProgram, type RunningServerProgram } from "@/adapters/server/runtime";
import type { PlatformAdapter, ProgramHostFactory } from "@/contracts/platform";
import type { Application, ApplicationContract } from "@/core/application";
import { collectExternalCapabilityNames } from "@/core/capability";
import type { ProgramIR } from "@/core/compiler/ir";
import { createApplicationCompiler } from "@/core/compiler/source";

export { startServerPrograms } from "@/adapters/server/runtime";
export { createNodeHost } from "@/adapters/server/host";
export type { NodeHost, NodeHostCapability, NodeHostOptions } from "@/adapters/server/host";
export type ServerHostFactory = ProgramHostFactory;

export type ServerPlatformAdapter = PlatformAdapter<ServerPlatform>;
export type ServerPlatformAdapterOptions = Readonly<{
  developmentPort?: number;
  webOrigin?: string;
}>;

/** Creates the development and production realization for headless server Programs. */
export function createServerPlatformAdapter(
  options: ServerPlatformAdapterOptions = {},
): ServerPlatformAdapter {
  return {
    name: "server",
    async develop(input) {
      const vite = await createServer({
        appType: "custom",
        configFile: false,
        root: input.directory,
        resolve: {
          alias: kitAliases(),
          conditions: ["poggers-source", ...defaultServerConditions],
        },
        server: { hmr: false, middlewareMode: true },
      });
      const application = moduleDefault<Application<ApplicationContract>>(
        await vite.ssrLoadModule(input.application),
      );
      const compiler = createApplicationCompiler(input.application);
      compiler.compile();
      let activePrograms = new Map<string, ActiveServerProgram>();
      const initialNames = programNames(input.programs);
      try {
        for (const program of input.programs) {
          activePrograms.set(
            program.name,
            await startDevelopmentProgram(
              application,
              program,
              initialNames,
              input.directory,
              input.ir.application.name,
              options,
            ),
          );
        }
      } catch (error) {
        await disposeActivePrograms(activePrograms.values());
        await vite.close();
        throw error;
      }
      let reload = Promise.resolve();
      let disposed = false;
      let revision = 0;
      const source = resolve(input.directory, "src");
      const observedRevisions = new Map<string, string>();
      vite.watcher.on("change", (file) => {
        if (disposed || !inside(source, file)) return;
        const path = canonicalPath(file);
        const fileRevision = revisionOf(path);
        if (fileRevision && observedRevisions.get(path) === fileRevision) return;
        if (fileRevision) observedRevisions.set(path, fileRevision);
        reload = reload.then(async () => {
          const affectedFiles = affectedModuleFiles(vite, file);
          let nextPrograms: readonly ProgramIR[];
          let candidate: Application<ApplicationContract>;
          try {
            const nextIR = compiler.compile(file).ir;
            nextPrograms = nextIR.programs.filter(
              ({ environment }) => environment.platform === "server",
            );
            const affected = affectedProgramNames(
              activePrograms,
              nextPrograms,
              affectedFiles,
              input.directory,
              input.application,
              nextIR.application.name,
            );
            if (!affected.size) return;
            vite.config.logger.info(
              `[poggers] reloading server Programs: ${[...affected].sort().join(", ")}`,
              { timestamp: true },
            );
            candidate = moduleDefault(
              await vite.ssrLoadModule(`${input.application}?poggers-revision=${++revision}`),
            );

            activePrograms = await replaceDevelopmentPrograms({
              active: activePrograms,
              affected,
              application: candidate,
              programs: nextPrograms,
              directory: input.directory,
              appName: nextIR.application.name,
              options,
            });
          } catch (error) {
            vite.config.logger.error(message(error));
          }
        });
      });
      return {
        get locations() {
          return activeLocations(activePrograms.values());
        },
        async [Symbol.asyncDispose]() {
          if (disposed) return;
          disposed = true;
          await reload;
          await disposeActivePrograms(activePrograms.values());
          await vite.close();
        },
      };
    },
    async build(input) {
      const programs = [...input.programs].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      await rm(input.output, { force: true, recursive: true });
      await mkdir(input.output, { recursive: true });
      const entries = [];
      for (const program of programs) {
        const path = resolve(input.output, programArtifactName(program.name));
        const result = await buildNativeServerProgram({
          application: input.ir.application.name,
          directory: input.directory,
          output: path,
          program,
        });
        entries.push({ program: program.name, environment: program.environment.name, path });
        console.log(`[poggers] native ${program.name}: cache ${result.cache}`);
      }
      return { directory: input.output, entries };
    },
  };
}

type ActiveServerProgram = Readonly<{
  application: Application<ApplicationContract>;
  appName: string;
  program: ProgramIR;
  running: RunningServerProgram;
}>;

async function startDevelopmentProgram(
  application: Application<ApplicationContract>,
  program: ProgramIR,
  names: readonly string[],
  directory: string,
  appName: string,
  options: ServerPlatformAdapterOptions,
): Promise<ActiveServerProgram> {
  const running = await startServerProgram(
    application,
    program,
    async ({ program: name, manifest }) =>
      createNodeHost({
        appName,
        capabilities: collectExternalCapabilityNames(manifest),
        directory,
        port: serverPort(name, names, options.developmentPort),
        webOrigin: options.webOrigin,
      }),
    "development",
  );
  return { application, appName, program, running };
}

async function replaceDevelopmentPrograms(input: {
  active: ReadonlyMap<string, ActiveServerProgram>;
  affected: ReadonlySet<string>;
  application: Application<ApplicationContract>;
  programs: readonly ProgramIR[];
  directory: string;
  appName: string;
  options: ServerPlatformAdapterOptions;
}): Promise<Map<string, ActiveServerProgram>> {
  const previous = new Map(input.active);
  const next = new Map(input.active);
  const previousAffected = [...input.affected]
    .flatMap((name) => (previous.get(name) ? [previous.get(name)!] : []))
    .sort((left, right) => left.program.name.localeCompare(right.program.name));
  await disposeActivePrograms(previousAffected);
  for (const name of input.affected) next.delete(name);

  const names = programNames(input.programs);
  const replacements = input.programs
    .filter(({ name }) => input.affected.has(name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const started: ActiveServerProgram[] = [];
  try {
    for (const program of replacements) {
      const active = await startDevelopmentProgram(
        input.application,
        program,
        names,
        input.directory,
        input.appName,
        input.options,
      );
      started.push(active);
      next.set(program.name, active);
    }
    return next;
  } catch (error) {
    await disposeActivePrograms(started);
    const restored = new Map(next);
    const previousNames = programNames([...previous.values()].map(({ program }) => program));
    for (const active of previousAffected) {
      restored.set(
        active.program.name,
        await startDevelopmentProgram(
          active.application,
          active.program,
          previousNames,
          input.directory,
          active.appName,
          input.options,
        ),
      );
    }
    throw error;
  }
}

function affectedProgramNames(
  active: ReadonlyMap<string, ActiveServerProgram>,
  programs: readonly ProgramIR[],
  affectedFiles: ReadonlySet<string>,
  directory: string,
  application: string,
  appName: string,
): ReadonlySet<string> {
  const previousNames = programNames([...active.values()].map(({ program }) => program));
  const nextNames = programNames(programs);
  if (
    previousNames.join("\n") !== nextNames.join("\n") ||
    [...active.values()].some((program) => program.appName !== appName)
  ) {
    return new Set([...previousNames, ...nextNames]);
  }

  const affected = new Set<string>();
  const next = new Map(programs.map((program) => [program.name, program]));
  for (const name of nextNames) {
    const before = active.get(name)?.program;
    const after = next.get(name)!;
    if (!before || JSON.stringify(before) !== JSON.stringify(after)) {
      affected.add(name);
      continue;
    }
    if (
      after.contributions.some(({ span }) =>
        spanFileCandidates(directory, application, span.file).some((file) =>
          affectedFiles.has(file),
        ),
      )
    ) {
      affected.add(name);
    }
  }
  return affected;
}

function spanFileCandidates(
  directory: string,
  application: string,
  file: string,
): readonly string[] {
  return unique([
    canonicalPath(resolve(directory, file)),
    canonicalPath(resolve(dirname(application), file)),
  ]);
}

function affectedModuleFiles(vite: ViteDevServer, changed: string): ReadonlySet<string> {
  const files = new Set<string>([canonicalPath(changed)]);
  const pending = [...(vite.moduleGraph.getModulesByFile(changed) ?? [])];
  const visited = new Set(pending);
  while (pending.length) {
    const module = pending.pop()!;
    if (module.file) files.add(canonicalPath(module.file));
    for (const importer of module.importers) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      pending.push(importer);
    }
  }
  return files;
}

function canonicalPath(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return resolve(file);
  }
}

function revisionOf(file: string): string | undefined {
  try {
    const value = statSync(file);
    return `${value.mtimeMs}:${value.size}`;
  } catch {
    return undefined;
  }
}

function programNames(programs: readonly ProgramIR[]): readonly string[] {
  return unique(programs.map(({ name }) => name));
}

function activeLocations(programs: Iterable<ActiveServerProgram>): readonly string[] {
  return [...new Set([...programs].flatMap(({ running }) => running.locations))].sort();
}

async function disposeActivePrograms(programs: Iterable<ActiveServerProgram>): Promise<void> {
  const results = await Promise.allSettled(
    [...programs].reverse().map(({ running }) => running[Symbol.asyncDispose]()),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server Program disposal failed.");
}

function moduleDefault<Value>(module: unknown): Value {
  const record = module as Readonly<Record<string, unknown>>;
  return (record.default ?? record) as Value;
}

function message(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function inside(directory: string, file: string): boolean {
  const path = relative(canonicalPath(directory), canonicalPath(file));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function programArtifactName(name: string): string {
  const readable = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return readable || "program";
}

function serverPort(
  program: string,
  programs: readonly string[],
  developmentPort?: number,
): number {
  const configured = developmentPort ?? (process.env.PORT ? Number(process.env.PORT) : 3010);
  const index = programs.indexOf(program);
  return configured + (index < 0 ? 0 : index);
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
