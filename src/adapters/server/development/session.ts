import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { createServer, defaultServerConditions, type Plugin, type ViteDevServer } from "vite";

import {
  planWebRouteLoaders,
  type DevelopmentWebLoaderRegistry,
  type WebRouteLoaderPlan,
} from "@/adapters/integration/web-server";
import {
  beginNodeHostReplacement,
  createNodeHost,
  type NodeHostOptions,
} from "@/adapters/server/development/host";
import {
  disposeServerDependencies,
  startServerProgramInstance,
  type RunningServerProgram,
} from "@/adapters/server/development/runtime";
import type { ApplicationIR, DependencyIR, ProgramIR } from "@/compiler/ir";
import { linkProgram, projectDependencyContracts } from "@/compiler/linker";
import { createApplicationCompiler } from "@/compiler/source";
import type { DevelopmentSession, PlatformDevelopmentInput } from "@/contracts/platform";
import type { Application, ApplicationContract } from "@/core/application";
import type { ServerPlatform } from "@/platforms/server/platform";

export type ServerDevelopmentOptions = Readonly<{
  developmentPort?: number;
  developmentHost?: NodeHostOptions;
  webLoaders?: DevelopmentWebLoaderRegistry;
  webOrigin?: string;
}>;

/** Starts every server Program and owns their hot-replacement lifecycle. */
export async function developServerPrograms(
  input: PlatformDevelopmentInput<ServerPlatform>,
  options: ServerDevelopmentOptions = {},
): Promise<DevelopmentSession> {
  const source = resolve(input.directory, "src");
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    plugins: [applicationAliasPlugin(source)],
    root: input.directory,
    resolve: {
      alias: kitAliases(),
      conditions: ["poggers-source", ...defaultServerConditions],
    },
    server: { middlewareMode: true, ws: false },
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
          input.ir,
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
          nextIR,
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
          appName: nextIR.application.name,
          ir: nextIR,
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
}

type ActiveServerProgram = Readonly<{
  application: Application<ApplicationContract>;
  directory: string;
  appName: string;
  dependencies: Readonly<Record<string, unknown>>;
  externalDependencies: readonly DependencyIR[];
  loaderPlan: WebRouteLoaderPlan;
  loaderRegistration?: Disposable;
  program: ProgramIR;
  running: RunningServerProgram;
}>;

async function startDevelopmentProgram(
  application: Application<ApplicationContract>,
  program: ProgramIR,
  names: readonly string[],
  directory: string,
  appName: string,
  ir: ApplicationIR,
  options: ServerDevelopmentOptions,
): Promise<ActiveServerProgram> {
  const loaderPlan = planWebRouteLoaders(program, ir);
  const externalDependencies = collectExternalDependencies(program, loaderPlan);
  const dependencies = await createNodeHost({
    ...options.developmentHost,
    appName,
    dependencies: projectDependencyContracts(externalDependencies),
    directory,
    host: options.developmentHost?.host,
    port: serverPort(program.name, names, options.developmentPort),
    webOrigin: options.webOrigin,
  });
  try {
    return await activateDevelopmentProgram({
      application,
      appName,
      dependencies,
      directory,
      externalDependencies,
      loaderPlan,
      loaderRegistry: options.webLoaders,
      program,
    });
  } catch (error) {
    await disposeServerDependencies(dependencies);
    throw error;
  }
}

async function activateDevelopmentProgram(input: {
  application: Application<ApplicationContract>;
  appName: string;
  dependencies: Readonly<Record<string, unknown>>;
  directory: string;
  externalDependencies: readonly DependencyIR[];
  loaderPlan: WebRouteLoaderPlan;
  loaderRegistry?: DevelopmentWebLoaderRegistry;
  program: ProgramIR;
}): Promise<ActiveServerProgram> {
  const running = await startServerProgramInstance(
    input.application,
    input.program,
    input.dependencies,
  );
  let loaderRegistration: Disposable | undefined;
  try {
    if (input.loaderPlan.loaders.length) {
      if (!input.loaderRegistry) {
        throw new Error(
          `Server Program ${JSON.stringify(input.program.name)} owns web Route loaders, but ` +
            "the server and web Platform Adapters do not share a development loader registry.",
        );
      }
      loaderRegistration = input.loaderRegistry.register({
        application: canonicalPath(input.directory),
        owner: input.program.name,
        plan: input.loaderPlan,
        dependencies: running.dependencies,
      });
    }
    return {
      application: input.application,
      directory: canonicalPath(input.directory),
      appName: input.appName,
      dependencies: input.dependencies,
      externalDependencies: input.externalDependencies,
      loaderPlan: input.loaderPlan,
      loaderRegistration,
      program: input.program,
      running,
    };
  } catch (error) {
    loaderRegistration?.[Symbol.dispose]();
    await running[Symbol.asyncDispose]();
    throw error;
  }
}

async function replaceDevelopmentPrograms(input: {
  active: ReadonlyMap<string, ActiveServerProgram>;
  affected: ReadonlySet<string>;
  application: Application<ApplicationContract>;
  programs: readonly ProgramIR[];
  appName: string;
  ir: ApplicationIR;
  options: ServerDevelopmentOptions;
}): Promise<Map<string, ActiveServerProgram>> {
  const next = new Map(input.active);
  const replacements = new Map(input.programs.map((program) => [program.name, program]));
  const affected = [...input.affected].sort();
  for (const name of affected) {
    const previous = input.active.get(name);
    const replacement = replacements.get(name);
    const loaderPlan = replacement ? planWebRouteLoaders(replacement, input.ir) : undefined;
    if (
      !previous ||
      !replacement ||
      JSON.stringify(previous.externalDependencies) !==
        JSON.stringify(collectExternalDependencies(replacement, loaderPlan))
    ) {
      throw new Error(
        `Server Program ${JSON.stringify(name)} changed its deployment or host Dependency ` +
          "contract. Restart development to apply this structural change.",
      );
    }
  }

  const staged: ActiveServerProgram[] = [];
  try {
    for (const name of affected) {
      const previous = input.active.get(name)!;
      const program = replacements.get(name)!;
      const loaderPlan = planWebRouteLoaders(program, input.ir);
      using _replacement = beginNodeHostReplacement(previous.dependencies);
      staged.push(
        await activateDevelopmentProgram({
          application: input.application,
          appName: input.appName,
          dependencies: previous.dependencies,
          directory: previous.directory,
          externalDependencies: previous.externalDependencies,
          loaderPlan,
          loaderRegistry: input.options.webLoaders,
          program,
        }),
      );
    }
  } catch (error) {
    await disposeRunningPrograms(staged);
    throw error;
  }

  await disposeRunningPrograms(affected.map((name) => input.active.get(name)!));
  for (const active of staged) next.set(active.program.name, active);
  return next;
}

function affectedProgramNames(
  active: ReadonlyMap<string, ActiveServerProgram>,
  programs: readonly ProgramIR[],
  affectedFiles: ReadonlySet<string>,
  directory: string,
  application: string,
  appName: string,
  ir: ApplicationIR,
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
    if (
      !before ||
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(active.get(name)?.loaderPlan) !==
        JSON.stringify(planWebRouteLoaders(after, ir))
    ) {
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
  const values = [...programs].reverse();
  const results = await Promise.allSettled(
    values.map(async ({ dependencies, loaderRegistration, running }) => {
      loaderRegistration?.[Symbol.dispose]();
      await running[Symbol.asyncDispose]();
      await disposeServerDependencies(dependencies);
    }),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server Program disposal failed.");
}

async function disposeRunningPrograms(programs: Iterable<ActiveServerProgram>): Promise<void> {
  const results = await Promise.allSettled(
    [...programs].reverse().map(async ({ loaderRegistration, running }) => {
      loaderRegistration?.[Symbol.dispose]();
      await running[Symbol.asyncDispose]();
    }),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server Program disposal failed.");
}

function collectExternalDependencies(
  program: ProgramIR,
  loaderPlan: WebRouteLoaderPlan = { contributions: [], loaders: [] },
): readonly DependencyIR[] {
  return linkProgram({
    ...program,
    contributions: [...program.contributions, ...loaderPlan.contributions],
  }).external;
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
  const source = resolve(import.meta.dirname, "../../..");
  const extension = import.meta.filename.endsWith(".ts") ? ".ts" : ".js";
  return [
    {
      find: /^@poggers\/kit\/jsx-dev-runtime$/,
      replacement: resolve(source, `jsx/development${extension}`),
    },
    {
      find: /^@poggers\/kit\/jsx-runtime$/,
      replacement: resolve(source, `jsx/runtime${extension}`),
    },
    {
      find: /^@poggers\/kit\/adapters\/server$/,
      replacement: resolve(source, `adapters/server/adapter${extension}`),
    },
    {
      find: /^@poggers\/kit\/server$/,
      replacement: resolve(source, `platforms/server/platform${extension}`),
    },
    {
      find: /^@poggers\/kit\/web$/,
      replacement: resolve(source, `platforms/web/platform${extension}`),
    },
    { find: /^@poggers\/kit$/, replacement: resolve(source, `index${extension}`) },
  ];
}

function applicationAliasPlugin(source: string): Plugin {
  const kit = resolve(import.meta.dirname, "../../..");
  return {
    name: "poggers-application-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer?.split("?", 1)[0] ?? "";
      const root = inside(source, owner) || !inside(kit, owner) ? source : kit;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}
