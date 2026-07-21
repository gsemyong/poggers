import type { Application, ApplicationContract } from "@/core/application";
import {
  collectProgramManifest,
  type CapabilityProfile,
  type ProgramCapabilityModule,
} from "@/core/capability";
import type { ProgramIR } from "@/core/compiler/ir";
import { startProcess, type Process } from "@/core/process";

export type ServerCapabilityModules = Readonly<Record<string, ProgramCapabilityModule>>;

/** Starts each server Program with its one application-owned Capability implementation. */
export async function startServerPrograms<Contract extends ApplicationContract>(
  application: Application<Contract>,
  programs: readonly ProgramIR[],
  modules: ServerCapabilityModules,
  profile: CapabilityProfile,
): Promise<AsyncDisposable & Readonly<{ locations: readonly string[] }>> {
  const processes: Record<string, Process> = Object.create(null);
  try {
    for (const name of unique(programs.map((program) => program.name))) {
      const module = modules[name] ?? emptyCapabilities;
      const capabilities = await module[profile]();
      if (!isRecord(capabilities)) {
        throw new TypeError(`Program "${name}" ${profile} Capabilities must be an object.`);
      }
      processes[name] = await startProcess(
        application,
        name,
        capabilities,
        collectProgramManifest(name, programs),
      );
    }
  } catch (error) {
    await disposeProcesses(processes);
    throw error;
  }

  const locations = [
    ...new Set(
      Object.values(processes).flatMap((process) =>
        Object.values(process.capabilities).flatMap((capability) =>
          capabilityLocations(capability),
        ),
      ),
    ),
  ].sort();
  let disposed = false;
  return {
    locations,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await disposeProcesses(processes);
    },
  };
}

const emptyCapabilities: ProgramCapabilityModule = Object.freeze({
  development: () => ({}),
  production: () => ({}),
});

function capabilityLocations(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || !("locations" in value)) return [];
  const locations = (value as { locations?: unknown }).locations;
  return Array.isArray(locations)
    ? locations.filter((location): location is string => typeof location === "string")
    : [];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function disposeProcesses(processes: Readonly<Record<string, Process>>): Promise<void> {
  const results = await Promise.allSettled(
    Object.values(processes)
      .reverse()
      .map((process) => process.dispose()),
  );
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Server process disposal failed.");
}
