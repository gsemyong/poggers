import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { createServer, defaultServerConditions, type Plugin } from "vite";

import {
  validateProgramAttachmentIR,
  type DevelopmentProgramAttachments,
  type DevelopmentSession,
  type PlatformDevelopmentInput,
  type ProgramAttachmentIR,
  type ProgramAttachmentSource,
} from "@/adapter";
import {
  projectDependencyContracts,
  selectDependencyProviders,
  selectSystemOutputs,
  type DependencyIR,
  type ProgramIR,
  type SelectedDependencyProviderIR,
  type SystemIR,
} from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import type { DependencyContract } from "@/core/dependency";
import { resolveFeatureProvider } from "@/core/feature";
import type { System, SystemContract } from "@/core/system";
import { packageSourceAliases, packageSourceRoot } from "@/package";
import type { ServerDependencyProvider, ServerPlatform } from "@/platforms/server";
import {
  beginNodeFeatureProviderReplacement,
  beginNodeHostReplacement,
  createNodeHost,
  type NodeFeatureDependencyProviders,
  type NodeFeatureProviderReplacement,
  type NodeHostOptions,
} from "@/platforms/server/adapter/typescript/host";
import {
  disposeServerDependencies,
  startServerProgramInstance,
  type RunningServerProgram,
} from "@/platforms/server/adapter/typescript/runtime";

export type ServerDevelopmentOptions = Readonly<{
  developmentPort?: number;
  developmentHost?:
    | NodeHostOptions
    | ((input: PlatformDevelopmentInput<ServerPlatform>) => NodeHostOptions);
  attachmentSources?: readonly ProgramAttachmentSource[];
  programAttachments?: DevelopmentProgramAttachments;
}>;

type ResolvedServerDevelopmentOptions = Omit<ServerDevelopmentOptions, "developmentHost"> &
  Readonly<{ developmentHost?: NodeHostOptions }>;

/** Starts every server Program and owns their hot-replacement lifecycle. */
export async function developServerPrograms(
  input: PlatformDevelopmentInput<ServerPlatform>,
  options: ServerDevelopmentOptions = {},
): Promise<DevelopmentSession> {
  const developmentOptions: ResolvedServerDevelopmentOptions = {
    ...options,
    developmentHost:
      typeof options.developmentHost === "function"
        ? options.developmentHost(input)
        : options.developmentHost,
  };
  const source = resolve(input.directory, "src");
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "warn",
    plugins: [systemAliasPlugin(source)],
    root: input.directory,
    resolve: {
      alias: packageSourceAliases(),
      conditions: ["source", ...defaultServerConditions],
    },
    server: { middlewareMode: true, ws: false },
  });
  let activePrograms = new Map<string, ActiveServerProgram>();
  let system: System<SystemContract>;
  try {
    system = moduleDefault<System<SystemContract>>(await vite.ssrLoadModule(input.system));
    const initialNames = programNames(input.programs);
    for (const program of input.programs) {
      activePrograms.set(
        program.name,
        await startDevelopmentProgram(
          system,
          program,
          initialNames,
          input.directory,
          input.ir.system.name,
          input.ir,
          developmentOptions,
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
      let nextPrograms: readonly ProgramIR[];
      let candidate: System<SystemContract>;
      const started = performance.now();
      try {
        const compilation = input.revisions.compile(file);
        const nextIR = compilation.ir;
        nextPrograms = selectSystemOutputs(nextIR, input.app).programs.filter(
          ({ environment }) => environment.platform === "server",
        );
        const affected = affectedPrograms(
          activePrograms,
          nextPrograms,
          nextIR.system.name,
          nextIR,
          new Set(compilation.change?.outputs ?? []),
          compilation.change?.source,
          developmentOptions.attachmentSources ?? [],
        );
        if (!affected.names.size) return;
        candidate = moduleDefault(
          await vite.ssrLoadModule(`${input.system}?kit-revision=${++revision}`),
        );

        activePrograms = await replaceDevelopmentPrograms({
          active: activePrograms,
          affected: affected.names,
          providerAffected: affected.providers,
          system: candidate,
          programs: nextPrograms,
          appName: nextIR.system.name,
          ir: nextIR,
          options: developmentOptions,
        });
        input.report?.({
          kind: "update",
          platform: "server",
          scope: "program",
          outputs: Object.freeze([...affected.names].sort()),
          durationMs: performance.now() - started,
        });
      } catch (error) {
        const diagnostic = {
          kind: "diagnostic",
          platform: "server",
          severity: "error",
          message: message(error),
        } as const;
        if (input.report) input.report(diagnostic);
        else vite.config.logger.error(diagnostic.message);
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
  system: System<SystemContract>;
  directory: string;
  appName: string;
  dependencies: Readonly<Record<string, unknown>>;
  externalDependencies: readonly DependencyIR[];
  providers: readonly SelectedDependencyProviderIR[];
  attachmentPlans: readonly ProgramAttachmentIR[];
  attachmentRegistrations: readonly Disposable[];
  program: ProgramIR;
  running: RunningServerProgram;
}>;

async function startDevelopmentProgram(
  system: System<SystemContract>,
  program: ProgramIR,
  names: readonly string[],
  directory: string,
  appName: string,
  ir: SystemIR,
  options: ResolvedServerDevelopmentOptions,
): Promise<ActiveServerProgram> {
  const attachmentPlans = projectProgramAttachments(options.attachmentSources ?? [], program, ir);
  const externalDependencies = collectExternalDependencies(program, attachmentPlans);
  const providers = selectedDevelopmentProviders(ir, program, externalDependencies);
  const dependencies = await createNodeHost({
    ...options.developmentHost,
    appName,
    dependencies: projectDependencyContracts(externalDependencies),
    directory: options.developmentHost?.directory ?? directory,
    providers: developmentFeatureProviders(system, providers),
    host: options.developmentHost?.host,
    port: serverPort(program.name, names, options.developmentPort),
    allowedOrigins: options.developmentHost?.allowedOrigins,
  });
  try {
    return await activateDevelopmentProgram({
      system,
      appName,
      dependencies,
      directory,
      externalDependencies,
      providers,
      attachmentPlans,
      attachmentRegistry: options.programAttachments,
      program,
    });
  } catch (error) {
    await disposeServerDependencies(dependencies);
    throw error;
  }
}

function selectedDevelopmentProviders(
  ir: SystemIR,
  program: ProgramIR,
  dependencies: readonly DependencyIR[],
): readonly SelectedDependencyProviderIR[] {
  return selectDependencyProviders(
    ir,
    program,
    dependencies.map(({ name }) => name),
  );
}

function developmentFeatureProviders(
  system: System<SystemContract>,
  providers: readonly SelectedDependencyProviderIR[],
): NodeFeatureDependencyProviders {
  return Object.freeze(
    Object.fromEntries(
      providers.map((provider) => [
        provider.dependency,
        resolveFeatureProvider<ServerDependencyProvider<DependencyContract>>(system, provider),
      ]),
    ),
  );
}

async function activateDevelopmentProgram(input: {
  system: System<SystemContract>;
  appName: string;
  dependencies: Readonly<Record<string, unknown>>;
  directory: string;
  externalDependencies: readonly DependencyIR[];
  providers: readonly SelectedDependencyProviderIR[];
  attachmentPlans: readonly ProgramAttachmentIR[];
  attachmentRegistry?: DevelopmentProgramAttachments;
  program: ProgramIR;
}): Promise<ActiveServerProgram> {
  const running = await startServerProgramInstance(input.system, input.program, input.dependencies);
  const attachmentRegistrations: Disposable[] = [];
  try {
    for (const plan of input.attachmentPlans) {
      if (!plan.exports.length) continue;
      if (!input.attachmentRegistry) {
        throw new Error(
          `Server Program ${JSON.stringify(input.program.name)} owns portable attachment exports, ` +
            "but no development attachment registry is configured.",
        );
      }
      attachmentRegistrations.push(
        input.attachmentRegistry.register({
          system: canonicalPath(input.directory),
          program: input.program.name,
          plan,
          dependencies: running.dependencies,
        }),
      );
    }
    return {
      system: input.system,
      directory: canonicalPath(input.directory),
      appName: input.appName,
      dependencies: input.dependencies,
      externalDependencies: input.externalDependencies,
      providers: input.providers,
      attachmentPlans: input.attachmentPlans,
      attachmentRegistrations: Object.freeze(attachmentRegistrations),
      program: input.program,
      running,
    };
  } catch (error) {
    attachmentRegistrations.reverse().forEach((registration) => registration[Symbol.dispose]());
    await running[Symbol.asyncDispose]();
    throw error;
  }
}

async function replaceDevelopmentPrograms(input: {
  active: ReadonlyMap<string, ActiveServerProgram>;
  affected: ReadonlySet<string>;
  providerAffected: ReadonlySet<string>;
  system: System<SystemContract>;
  programs: readonly ProgramIR[];
  appName: string;
  ir: SystemIR;
  options: ResolvedServerDevelopmentOptions;
}): Promise<Map<string, ActiveServerProgram>> {
  const next = new Map(input.active);
  const replacements = new Map(input.programs.map((program) => [program.name, program]));
  const affected = [...input.affected].sort();
  for (const name of affected) {
    const previous = input.active.get(name);
    const replacement = replacements.get(name);
    const attachmentPlans = replacement
      ? projectProgramAttachments(input.options.attachmentSources ?? [], replacement, input.ir)
      : undefined;
    if (
      !previous ||
      !replacement ||
      JSON.stringify(previous.externalDependencies) !==
        JSON.stringify(collectExternalDependencies(replacement, attachmentPlans))
    ) {
      throw new Error(
        `Server Program ${JSON.stringify(name)} changed its deployment or host Dependency ` +
          "contract. Restart development to apply this structural change.",
      );
    }
  }

  const staged: ActiveServerProgram[] = [];
  const providerReplacements: NodeFeatureProviderReplacement[] = [];
  try {
    for (const name of affected) {
      const previous = input.active.get(name)!;
      const program = replacements.get(name)!;
      const attachmentPlans = projectProgramAttachments(
        input.options.attachmentSources ?? [],
        program,
        input.ir,
      );
      const externalDependencies = collectExternalDependencies(program, attachmentPlans);
      const providers = selectedDevelopmentProviders(input.ir, program, externalDependencies);
      const providerReplacement = input.providerAffected.has(name)
        ? await beginNodeFeatureProviderReplacement(
            previous.dependencies,
            developmentFeatureProviders(input.system, providers),
          )
        : undefined;
      if (providerReplacement) providerReplacements.push(providerReplacement);
      using _replacement = beginNodeHostReplacement(previous.dependencies);
      staged.push(
        await activateDevelopmentProgram({
          system: input.system,
          appName: input.appName,
          dependencies: previous.dependencies,
          directory: previous.directory,
          externalDependencies: previous.externalDependencies,
          providers,
          attachmentPlans,
          attachmentRegistry: input.options.programAttachments,
          program,
        }),
      );
    }
  } catch (error) {
    await disposeRunningPrograms(staged);
    await disposeProviderReplacements(providerReplacements);
    throw error;
  }

  await disposeRunningPrograms(affected.map((name) => input.active.get(name)!));
  for (const replacement of providerReplacements) await replacement.commit();
  for (const active of staged) next.set(active.program.name, active);
  return next;
}

type AffectedServerPrograms = Readonly<{
  names: ReadonlySet<string>;
  providers: ReadonlySet<string>;
}>;

function affectedPrograms(
  active: ReadonlyMap<string, ActiveServerProgram>,
  programs: readonly ProgramIR[],
  appName: string,
  ir: SystemIR,
  affectedOutputs: ReadonlySet<string>,
  changedSource: string | undefined,
  attachmentSources: readonly ProgramAttachmentSource[],
): AffectedServerPrograms {
  const previousNames = programNames([...active.values()].map(({ program }) => program));
  const nextNames = programNames(programs);
  if (
    previousNames.join("\n") !== nextNames.join("\n") ||
    [...active.values()].some((program) => program.appName !== appName)
  ) {
    const names = new Set([...previousNames, ...nextNames]);
    return { names, providers: names };
  }

  const affected = new Set<string>();
  const providerAffected = new Set<string>();
  const next = new Map(programs.map((program) => [program.name, program]));
  for (const name of nextNames) {
    const before = active.get(name)?.program;
    const after = next.get(name)!;
    const attachmentPlans = projectProgramAttachments(attachmentSources, after, ir);
    const dependencies = collectExternalDependencies(after, attachmentPlans);
    const providers = selectedDevelopmentProviders(ir, after, dependencies);
    if (
      providerMeaningChanged(
        active.get(name)?.providers ?? [],
        providers,
        active.get(name)?.directory ?? process.cwd(),
        changedSource,
      )
    ) {
      affected.add(name);
      providerAffected.add(name);
      continue;
    }
    if (
      !before ||
      affectedOutputs.has(after.id) ||
      JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(active.get(name)?.attachmentPlans) !== JSON.stringify(attachmentPlans)
    ) {
      affected.add(name);
      continue;
    }
  }
  return { names: affected, providers: providerAffected };
}

function providerMeaningChanged(
  previous: readonly SelectedDependencyProviderIR[],
  next: readonly SelectedDependencyProviderIR[],
  directory: string,
  changedSource: string | undefined,
): boolean {
  if (JSON.stringify(previous) !== JSON.stringify(next)) return true;
  if (!changedSource) return false;
  const changed = canonicalPath(changedSource);
  return [...previous, ...next].some((provider) =>
    [...(provider.sources ?? []), provider.span.file].some((source) =>
      sourceCandidates(directory, source).has(changed),
    ),
  );
}

function sourceCandidates(directory: string, source: string): ReadonlySet<string> {
  if (isAbsolute(source)) return new Set([canonicalPath(source)]);
  return new Set([
    canonicalPath(resolve(directory, source)),
    canonicalPath(resolve(directory, "src", source)),
  ]);
}

async function disposeProviderReplacements(
  replacements: readonly NodeFeatureProviderReplacement[],
): Promise<void> {
  const results = await Promise.allSettled(
    [...replacements].reverse().map((replacement) => replacement[Symbol.asyncDispose]()),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Feature provider replacement rollback failed.");
  }
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

function activeLocations(
  programs: Iterable<ActiveServerProgram>,
): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      [...programs]
        .sort(({ program: left }, { program: right }) => left.id.localeCompare(right.id))
        .map(({ program, running }) => [program.id, [...new Set(running.locations)].sort()]),
    ),
  );
}

async function disposeActivePrograms(programs: Iterable<ActiveServerProgram>): Promise<void> {
  const values = [...programs].reverse();
  const results = await Promise.allSettled(
    values.map(async ({ attachmentRegistrations, dependencies, running }) => {
      attachmentRegistrations
        .slice()
        .reverse()
        .forEach((registration) => registration[Symbol.dispose]());
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
    [...programs].reverse().map(async ({ attachmentRegistrations, running }) => {
      attachmentRegistrations
        .slice()
        .reverse()
        .forEach((registration) => registration[Symbol.dispose]());
      await running[Symbol.asyncDispose]();
    }),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server Program disposal failed.");
}

function collectExternalDependencies(
  program: ProgramIR,
  attachmentPlans: readonly ProgramAttachmentIR[] = [],
): readonly DependencyIR[] {
  return linkProgram({
    ...program,
    contributions: [
      ...program.contributions,
      ...attachmentPlans.flatMap((plan) =>
        plan.contributions.map(({ contribution }) => contribution),
      ),
    ],
  }).external;
}

function projectProgramAttachments(
  sources: readonly ProgramAttachmentSource[],
  program: ProgramIR,
  ir: SystemIR,
): readonly ProgramAttachmentIR[] {
  return sources
    .map((source) => validateProgramAttachmentIR(source.project(program, ir), source.name))
    .filter(({ contributions, exports, bindings }) =>
      Boolean(contributions.length || exports.length || bindings.length),
    );
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

function systemAliasPlugin(source: string): Plugin {
  return {
    name: "kit-system-alias",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.startsWith("@/")) return;
      const owner = importer?.split("?", 1)[0] ?? "";
      const root =
        inside(source, owner) || !inside(packageSourceRoot, owner) ? source : packageSourceRoot;
      return this.resolve(resolve(root, id.slice(2)), importer, { skipSelf: true });
    },
  };
}
