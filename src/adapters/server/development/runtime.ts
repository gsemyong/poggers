import type { ProgramIR, ProgramManifest } from "@/compiler/ir";
import { collectProgramManifest, linkProgram } from "@/compiler/linker";
import type { System, SystemContract } from "@/core/system";
import { executeLinkedProgramIR, type DependencyImplementations } from "@/runtime/interpreter";
import { assembleProgram } from "@/runtime/process";

type ProgramHostFactory = (input: {
  readonly program: string;
  readonly profile: "development" | "production";
  readonly manifest: ProgramManifest;
}) => Readonly<Record<string, unknown>> | PromiseLike<Readonly<Record<string, unknown>>>;

export type RunningServerProgram = AsyncDisposable &
  Readonly<{
    name: string;
    locations: readonly string[];
    dependencies: Readonly<Record<string, unknown>>;
  }>;

/** Starts one Program against an already-owned host Dependency scope. */
export async function startServerProgramInstance<Contract extends SystemContract>(
  system: System<Contract>,
  program: ProgramIR,
  dependencies: Readonly<Record<string, unknown>>,
): Promise<RunningServerProgram> {
  if (isPortableProgram(program)) {
    const execution = await executeLinkedProgramIR(
      linkProgram(program),
      dependencies as DependencyImplementations,
    );
    let disposed = false;
    return {
      name: program.name,
      locations: Object.values(dependencies).flatMap(dependencyLocations),
      dependencies: execution.dependencies,
      async [Symbol.asyncDispose]() {
        if (disposed) return;
        disposed = true;
        await execution[Symbol.asyncDispose]();
      },
    };
  }
  const manifest = collectProgramManifest(program);
  const process = await assembleProgram({
    system,
    name: program.name,
    dependencies,
    manifest,
    ownDependencies: false,
  });
  let disposed = false;
  return {
    name: program.name,
    locations: Object.values(process.dependencies).flatMap(dependencyLocations),
    dependencies: process.dependencies,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await process.dispose();
    },
  };
}

/** Starts one independently deployable server Program as one Process instance. */
export async function startServerProgram<Contract extends SystemContract>(
  system: System<Contract>,
  program: ProgramIR,
  createHost: ProgramHostFactory,
  profile: "development" | "production",
): Promise<RunningServerProgram> {
  const manifest = collectProgramManifest(program);
  const dependencies = await createHost({ program: program.name, profile, manifest });
  if (!isRecord(dependencies)) {
    throw new TypeError(`Program "${program.name}" ${profile} Dependencies must be an object.`);
  }
  let instance: RunningServerProgram;
  try {
    instance = await startServerProgramInstance(system, program, dependencies);
  } catch (error) {
    await disposeServerDependencies(dependencies);
    throw error;
  }
  let disposed = false;
  return {
    name: program.name,
    locations: instance.locations,
    dependencies: instance.dependencies,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        await instance[Symbol.asyncDispose]();
      } catch (error) {
        errors.push(error);
      }
      try {
        await disposeServerDependencies(dependencies);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Server Program disposal failed.");
      }
    },
  };
}

function isPortableProgram(program: ProgramIR): boolean {
  return program.contributions.every(
    (contribution) =>
      !contribution.ui &&
      (contribution.implementation.kind === "none" ||
        contribution.implementation.kind === "portable"),
  );
}

export async function disposeServerDependencies(
  dependencies: Readonly<Record<string, unknown>>,
): Promise<void> {
  const values = [...new Set(Object.values(dependencies))].reverse();
  const errors: unknown[] = [];
  for (const value of values) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
    const disposable = value as Partial<Disposable & AsyncDisposable>;
    try {
      const disposeAsync = disposable[Symbol.asyncDispose];
      const dispose = disposable[Symbol.dispose];
      if (typeof disposeAsync === "function") {
        await disposeAsync.call(disposable);
      } else if (typeof dispose === "function") {
        dispose.call(disposable);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Portable Dependency disposal failed.");
}

/** Starts each server Program with one adapter-owned host scope per Process instance. */
export async function startServerPrograms<Contract extends SystemContract>(
  system: System<Contract>,
  programs: readonly ProgramIR[],
  createHost: ProgramHostFactory,
  profile: "development" | "production",
): Promise<AsyncDisposable & Readonly<{ locations: readonly string[] }>> {
  const running: RunningServerProgram[] = [];
  try {
    for (const program of programs) {
      running.push(await startServerProgram(system, program, createHost, profile));
    }
  } catch (error) {
    await disposeServerPrograms(running);
    throw error;
  }

  const locations = [...new Set(running.flatMap((program) => program.locations))].sort();
  let disposed = false;
  return {
    locations,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await disposeServerPrograms(running);
    },
  };
}

function dependencyLocations(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || !("locations" in value)) return [];
  const locations = (value as { locations?: unknown }).locations;
  return Array.isArray(locations)
    ? locations.filter((location): location is string => typeof location === "string")
    : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function disposeServerPrograms(programs: readonly RunningServerProgram[]): Promise<void> {
  const results = await Promise.allSettled(
    programs
      .slice()
      .reverse()
      .map((program) => program[Symbol.asyncDispose]()),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server process disposal failed.");
}
