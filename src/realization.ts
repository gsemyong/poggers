import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  selectSystemOutputs,
  type PlatformInterfaceIR,
  type ProgramIR,
  type SystemIR,
} from "@/compiler/ir";
import { createSystemCompiler, resolveSystem } from "@/compiler/source";
import {
  selectPlatformAdapters,
  type DevelopmentSession,
  type PlatformAdapterImplementation,
  type ProductionArtifacts,
  type SystemRevisionSource,
} from "@/contracts/platform";

export type SystemRealization<Adapter extends PlatformAdapterImplementation> = Readonly<{
  directory: string;
  system: string;
  ir: SystemIR;
  app?: string;
  programs: readonly ProgramIR[];
  interfaces: readonly PlatformInterfaceIR[];
  revisions: SystemRevisionSource;
  adapters: readonly Adapter[];
}>;

export type SystemRealizationOptions = Readonly<{ app?: string }>;

export type RunningSystem = AsyncDisposable &
  Readonly<{
    ir: SystemIR;
    locations: Readonly<Record<string, readonly string[]>>;
  }>;

export type BuiltSystem = Readonly<{
  ir: SystemIR;
  directory: string;
  artifacts: Readonly<Record<string, ProductionArtifacts>>;
}>;

/** Resolves one authored System into the Platform implementations it requires. */
export function resolveSystemRealization<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
  options: SystemRealizationOptions = {},
): SystemRealization<Adapter> {
  const paths = resolveSystem(directory);
  const extensions = Object.values(adapters).flatMap(({ compiler = [] }) => compiler);
  const revisions = createSystemRevisionSource(paths.system, extensions);
  const outputs = selectSystemOutputs(revisions.current.ir, options.app);
  return {
    directory: paths.directory,
    system: paths.system,
    ir: revisions.current.ir,
    ...(outputs.app ? { app: outputs.app } : {}),
    programs: outputs.programs,
    interfaces: outputs.interfaces,
    revisions,
    adapters: selectPlatformAdapters(outputs.platforms, adapters),
  };
}

/** Starts every required Platform through the canonical development path. */
export async function developSystem<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
  options: SystemRealizationOptions = {},
): Promise<RunningSystem> {
  const realization = resolveSystemRealization(directory, adapters, options);
  const started = await Promise.allSettled(
    realization.adapters.map(async (adapter) => ({
      adapter,
      session: await adapter.develop({
        directory: realization.directory,
        system: realization.system,
        ir: realization.ir,
        ...(realization.app ? { app: realization.app } : {}),
        revisions: realization.revisions,
        platform: adapter.name,
        programs: realization.programs.filter(
          ({ environment }) => environment.platform === adapter.name,
        ),
        interfaces: realization.interfaces.filter(({ platform }) => platform === adapter.name),
      }),
    })),
  );
  const sessions = started.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failures = started.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) {
    const disposal = await disposeDevelopmentSessions(sessions.map(({ session }) => session));
    failures.push(...disposal);
    throwFailures(failures, "System development startup failed.");
  }

  let disposed = false;
  return {
    ir: realization.ir,
    get locations() {
      return collectDevelopmentLocations(sessions);
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      const failures = await disposeDevelopmentSessions(sessions.map(({ session }) => session));
      throwFailures(failures, "System disposal failed.");
    },
  };
}

function createSystemRevisionSource(
  system: string,
  extensions: Parameters<typeof createSystemCompiler>[1],
): SystemRevisionSource {
  const compiler = createSystemCompiler(system, extensions);
  let current = compiler.compile();
  const signatures = new Map<string, string>();
  return {
    get current() {
      return current;
    },
    compile(changedFile) {
      let signature: string;
      try {
        signature = createHash("sha256").update(readFileSync(changedFile)).digest("hex");
      } catch {
        signature = "<missing>";
      }
      if (signatures.get(changedFile) === signature) return current;
      current = compiler.compile(changedFile);
      signatures.set(changedFile, signature);
      return current;
    },
  };
}

/** Builds every required Platform through the canonical production path. */
export async function buildSystem(
  directory: string,
  output: string,
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
  options: SystemRealizationOptions = {},
): Promise<BuiltSystem> {
  const realization = resolveSystemRealization(directory, adapters, options);
  const results = await Promise.all(
    realization.adapters.map(async (adapter) => {
      const platformOutput =
        realization.adapters.length === 1 ? output : resolve(output, adapter.name);
      const artifacts = await adapter.build({
        directory: realization.directory,
        system: realization.system,
        ir: realization.ir,
        ...(realization.app ? { app: realization.app } : {}),
        platform: adapter.name,
        programs: realization.programs.filter(
          ({ environment }) => environment.platform === adapter.name,
        ),
        interfaces: realization.interfaces.filter(({ platform }) => platform === adapter.name),
        output: platformOutput,
      });
      return [adapter.name, artifacts] as const;
    }),
  );
  return {
    ir: realization.ir,
    directory: output,
    artifacts: Object.freeze(Object.fromEntries(results)),
  };
}

function collectDevelopmentLocations(
  sessions: readonly Readonly<{
    adapter: PlatformAdapterImplementation;
    session: DevelopmentSession;
  }>[],
): Readonly<Record<string, readonly string[]>> {
  const locations = new Map<string, readonly string[]>();
  for (const { adapter, session } of sessions) {
    for (const [identity, values] of Object.entries(session.locations)) {
      if (locations.has(identity)) {
        throw new Error(
          `Platform Adapter ${JSON.stringify(adapter.name)} returned duplicate output identity ${JSON.stringify(identity)}.`,
        );
      }
      locations.set(identity, values);
    }
  }
  return Object.freeze(
    Object.fromEntries([...locations].sort(([left], [right]) => left.localeCompare(right))),
  );
}

async function disposeDevelopmentSessions(
  sessions: readonly DevelopmentSession[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const session of [...sessions].reverse()) {
    try {
      await session[Symbol.asyncDispose]();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
