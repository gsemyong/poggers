import type { ProgramHostFactory } from "@/contracts/platform";
import type { Application, ApplicationContract } from "@/core/application";
import { collectProgramManifest } from "@/core/capability";
import type { ProgramIR } from "@/core/compiler/ir";
import { executeLinkedProgramIR, type CapabilityImplementations } from "@/core/development";
import { startProcess } from "@/core/process";

export type RunningServerProgram = AsyncDisposable &
  Readonly<{
    name: string;
    locations: readonly string[];
  }>;

/** Starts one independently deployable server Program as one Process instance. */
export async function startServerProgram<Contract extends ApplicationContract>(
  application: Application<Contract>,
  program: ProgramIR,
  createHost: ProgramHostFactory,
  profile: "development" | "production",
): Promise<RunningServerProgram> {
  const manifest = collectProgramManifest(program);
  const capabilities = await createHost({ program: program.name, profile, manifest });
  if (!isRecord(capabilities)) {
    throw new TypeError(`Program "${program.name}" ${profile} Capabilities must be an object.`);
  }
  if (isPortableProgram(program)) {
    let execution: Awaited<ReturnType<typeof executeLinkedProgramIR>>;
    try {
      execution = await executeLinkedProgramIR(program, capabilities as CapabilityImplementations);
    } catch (error) {
      await disposeCapabilities(capabilities);
      throw error;
    }
    let disposed = false;
    return {
      name: program.name,
      locations: Object.values(capabilities).flatMap(capabilityLocations),
      async [Symbol.asyncDispose]() {
        if (disposed) return;
        disposed = true;
        const results = await Promise.allSettled([
          execution[Symbol.asyncDispose](),
          disposeCapabilities(capabilities),
        ]);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
          throw new AggregateError(errors, "Server Program disposal failed.");
        }
      },
    };
  }
  const process = await startProcess(application, program.name, capabilities, manifest);
  let disposed = false;
  return {
    name: program.name,
    locations: Object.values(process.capabilities).flatMap(capabilityLocations),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await process.dispose();
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

async function disposeCapabilities(capabilities: Readonly<Record<string, unknown>>): Promise<void> {
  const values = [...new Set(Object.values(capabilities))].reverse();
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
  if (errors.length > 1) throw new AggregateError(errors, "Portable Capability disposal failed.");
}

/** Starts each server Program with one adapter-owned host scope per Process instance. */
export async function startServerPrograms<Contract extends ApplicationContract>(
  application: Application<Contract>,
  programs: readonly ProgramIR[],
  createHost: ProgramHostFactory,
  profile: "development" | "production",
): Promise<AsyncDisposable & Readonly<{ locations: readonly string[] }>> {
  const running: RunningServerProgram[] = [];
  try {
    for (const program of programs) {
      running.push(await startServerProgram(application, program, createHost, profile));
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

function capabilityLocations(value: unknown): readonly string[] {
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
