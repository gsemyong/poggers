import { resolve } from "node:path";

import type { ApplicationIR } from "@/compiler/ir";
import { compileApplication, resolveApplication } from "@/compiler/source";
import {
  selectPlatformAdapters,
  type DevelopmentSession,
  type PlatformAdapterImplementation,
  type ProductionArtifacts,
} from "@/contracts/platform";

export type ApplicationRealization<Adapter extends PlatformAdapterImplementation> = Readonly<{
  directory: string;
  application: string;
  ir: ApplicationIR;
  adapters: readonly Adapter[];
}>;

export type RunningApplication = AsyncDisposable &
  Readonly<{
    ir: ApplicationIR;
    locations: Readonly<Record<string, readonly string[]>>;
  }>;

export type BuiltApplication = Readonly<{
  ir: ApplicationIR;
  directory: string;
  artifacts: Readonly<Record<string, ProductionArtifacts>>;
}>;

/** Resolves one authored Application into the Platform implementations it requires. */
export function resolveApplicationRealization<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
): ApplicationRealization<Adapter> {
  const paths = resolveApplication(directory);
  const extensions = Object.values(adapters).flatMap(({ compiler = [] }) => compiler);
  const ir = compileApplication(paths.application, extensions);
  return {
    directory: paths.directory,
    application: paths.application,
    ir,
    adapters: selectPlatformAdapters(ir, adapters),
  };
}

/** Starts every required Platform through the canonical development path. */
export async function developApplication<Adapter extends PlatformAdapterImplementation>(
  directory: string,
  adapters: Readonly<Record<string, Adapter>>,
): Promise<RunningApplication> {
  const realization = resolveApplicationRealization(directory, adapters);
  const sessions = new Map<string, DevelopmentSession>();
  try {
    for (const adapter of realization.adapters) {
      sessions.set(
        adapter.name,
        await adapter.develop({
          directory: realization.directory,
          application: realization.application,
          ir: realization.ir,
          platform: adapter.name,
          programs: realization.ir.programs.filter(
            ({ environment }) => environment.platform === adapter.name,
          ),
        }),
      );
    }
  } catch (error) {
    await disposeDevelopmentSessions(sessions.values());
    throw error;
  }

  let disposed = false;
  return {
    ir: realization.ir,
    get locations() {
      return Object.fromEntries(
        [...sessions].map(([platform, session]) => [platform, session.locations]),
      );
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await disposeDevelopmentSessions(sessions.values());
    },
  };
}

/** Builds every required Platform through the canonical production path. */
export async function buildApplication(
  directory: string,
  output: string,
  adapters: Readonly<Record<string, PlatformAdapterImplementation>>,
): Promise<BuiltApplication> {
  const realization = resolveApplicationRealization(directory, adapters);
  const artifacts: Record<string, ProductionArtifacts> = {};
  for (const adapter of realization.adapters) {
    const platformOutput =
      realization.adapters.length === 1 ? output : resolve(output, adapter.name);
    artifacts[adapter.name] = await adapter.build({
      directory: realization.directory,
      application: realization.application,
      ir: realization.ir,
      platform: adapter.name,
      programs: realization.ir.programs.filter(
        ({ environment }) => environment.platform === adapter.name,
      ),
      output: platformOutput,
    });
  }
  return { ir: realization.ir, directory: output, artifacts: Object.freeze(artifacts) };
}

async function disposeDevelopmentSessions(sessions: Iterable<DevelopmentSession>): Promise<void> {
  const results = await Promise.allSettled(
    [...sessions].reverse().map((session) => session[Symbol.asyncDispose]()),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Application disposal failed.");
}
