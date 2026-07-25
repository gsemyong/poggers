import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  developServerPrograms,
  type ServerDevelopmentOptions,
} from "@/adapters/server/development/session";
import { buildServerProgram } from "@/adapters/server/production/compiler";
import type { ServerProductionDependency } from "@/adapters/server/production/dependencies";
import type { SourceCompilerExtension } from "@/compiler/extension";
import type { ProgramIR } from "@/compiler/ir";
import { SystemDiagnostic } from "@/compiler/source";
import type { PlatformAdapter } from "@/contracts/platform";
import type { ServerPlatform } from "@/platforms/server/platform";

export {
  defineServerProductionDependency,
  jetStreamEventsDependency,
} from "@/adapters/server/production/dependencies";
export type {
  ServerProductionConfiguration,
  ServerProductionDependency,
} from "@/adapters/server/production/dependencies";

export type ServerPlatformAdapter = PlatformAdapter<ServerPlatform>;
export type ServerPlatformAdapterOptions = ServerDevelopmentOptions &
  Readonly<{
    productionDependencies?: readonly ServerProductionDependency[];
  }>;

const serverCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "server",
  validate(ir) {
    assertPortableServerPrograms(ir.programs);
  },
});

/** Creates the complete development and production realization for the server Platform. */
export function createServerPlatformAdapter(
  options: ServerPlatformAdapterOptions = {},
): ServerPlatformAdapter {
  return {
    name: "server",
    compiler: [serverCompilerExtension],
    develop: (input) => developServerPrograms(input, options),
    async build(input) {
      const programs = [...input.programs].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      await rm(input.output, { force: true, recursive: true });
      await mkdir(input.output, { recursive: true });
      const entries = [];
      for (const program of programs) {
        const path = resolve(input.output, artifactName(program.name));
        const result = await buildServerProgram({
          dependencies: options.productionDependencies,
          system: input.ir.system.name,
          ir: input.ir,
          directory: input.directory,
          output: path,
          profile: "release",
          program,
        });
        entries.push({
          identity: program.id,
          kind: "program" as const,
          deployment: "process" as const,
          environment: program.environment.name,
          path,
          entrypoint: path,
          dependencies: Object.freeze(result.requirements.map(({ dependency }) => dependency)),
          configuration: Object.freeze(
            result.requirements.flatMap((requirement) =>
              requirement.configuration.map((field) => ({
                dependency: requirement.dependency,
                implementation: requirement.implementation,
                name: field.name,
                binding: { kind: "environment" as const, name: field.environment },
                required: field.required ?? false,
                ...(field.default === undefined ? {} : { default: field.default }),
                ...(field.allocation ? { allocation: field.allocation } : {}),
                ...(field.source ? { source: field.source } : {}),
              })),
            ),
          ),
          lifecycle: {
            shutdown: { kind: "signal" as const, signal: "SIGINT" as const },
            status: {
              kind: "file" as const,
              environment: "KIT_PROCESS_STATUS_FILE",
            },
          },
          target: {
            operatingSystem: process.platform,
            architecture: process.arch,
          },
        });
        console.log(`[kit] production ${program.name}: cache ${result.cache}`);
      }
      return { directory: input.output, entries };
    },
  };
}

function assertPortableServerPrograms(programs: readonly ProgramIR[]): void {
  for (const program of programs) {
    if (program.environment.platform !== "server") continue;
    for (const contribution of program.contributions) {
      const implementation = contribution.implementation;
      if (implementation.kind !== "source") continue;
      const span = implementation.diagnostic?.span ?? implementation.span;
      const reason = implementation.diagnostic
        ? implementation.diagnostic.message.replace(/^.*:\d+:\d+: /, "")
        : "Its implementation is available only as host source.";
      throw new SystemDiagnostic(
        `Server Program contribution ${JSON.stringify(contribution.id)} must lower completely ` +
          `to portable meaning. ${reason}`,
        span,
      );
    }
  }
}

function artifactName(name: string): string {
  const readable = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return readable || "program";
}
