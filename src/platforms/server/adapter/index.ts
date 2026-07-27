import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { PlatformAdapter } from "@/adapter";
import type { SourceCompilerExtension } from "@/compiler/extension";
import type {
  ExtensionIR,
  PortableProgramExecutionIR,
  ProgramContributionIR,
  ProgramIR,
} from "@/compiler/ir";
import { SystemDiagnostic } from "@/compiler/source";
import type { ServerPlatform } from "@/platforms/server";
import type { ServerProductionDependency } from "@/platforms/server/adapter/rust/providers";
import type { ServerDevelopmentOptions } from "@/platforms/server/adapter/typescript/session";

export {
  defineServerProductionDependency,
  jetStreamEventsDependency,
} from "@/platforms/server/adapter/rust/providers";
export type {
  ServerProductionConfiguration,
  ServerProductionDependency,
} from "@/platforms/server/adapter/rust/providers";

export type ServerPlatformAdapter = PlatformAdapter<ServerPlatform>;
export type ServerPlatformAdapterOptions = ServerDevelopmentOptions &
  Readonly<{
    productionDependencies?: readonly ServerProductionDependency[];
  }>;

export const SERVER_COMPILER_IR_VERSION = 1 as const;

export type ServerProgramCompilerIR = Readonly<{
  version: typeof SERVER_COMPILER_IR_VERSION;
  execution: PortableProgramExecutionIR;
}>;

export function serverProgramCompilerIR(value: ExtensionIR | undefined): ServerProgramCompilerIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing server Program compiler meaning.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.version !== SERVER_COMPILER_IR_VERSION ||
    !record.execution ||
    typeof record.execution !== "object" ||
    Array.isArray(record.execution)
  ) {
    throw new Error("Unsupported server Program compiler meaning.");
  }
  const execution = record.execution as Readonly<Record<string, unknown>>;
  if (!["none", "portable", "source"].includes(String(execution.kind))) {
    throw new Error("Unsupported server Program execution meaning.");
  }
  if (
    execution.kind === "portable" &&
    (!execution.entry || typeof execution.entry !== "object" || !Array.isArray(execution.functions))
  ) {
    throw new Error("Invalid portable server Program execution meaning.");
  }
  return record as ServerProgramCompilerIR;
}

/** Projects one server contribution into the generic portable execution engines. */
export function serverProgramExecution(
  contribution: ProgramContributionIR,
): PortableProgramExecutionIR {
  return serverProgramCompilerIR(contribution.extensions?.server).execution;
}

export const serverCompilerExtension: SourceCompilerExtension = Object.freeze({
  name: "server",
  cacheSources: [import.meta.filename],
  program(context) {
    const span = context.source.span(context.implementation ?? context.location);
    if (context.implementationOrigin === "unresolved") {
      return {
        ir: {
          version: SERVER_COMPILER_IR_VERSION,
          execution: {
            kind: "source",
            diagnostic: {
              message: "Feature factory output could not be expanded by the portable frontend.",
              span,
            },
            span,
          },
        } satisfies ServerProgramCompilerIR,
      };
    }
    const start = context.implementation
      ? context.source.callable(context.implementation, "start")
      : undefined;
    if (!start) {
      return {
        ir: {
          version: SERVER_COMPILER_IR_VERSION,
          execution: { kind: "none" },
        } satisfies ServerProgramCompilerIR,
      };
    }
    try {
      const providesType = context.source.property(context.contract, "Provides", context.location);
      const provides = providesType
        ? context.source.dependencies(providesType, context.location)
        : [];
      const portable = context.source.portable(start, {
        id: "start",
        name: "start",
        context: { dependencies: "dependencies", provides: "provides" },
        provides: provides.map(({ name }) => name),
      });
      return {
        ir: {
          version: SERVER_COMPILER_IR_VERSION,
          execution: { kind: "portable", ...portable },
        } satisfies ServerProgramCompilerIR,
      };
    } catch (error) {
      if (
        error instanceof SystemDiagnostic &&
        /Unsupported portable (expression|statement)/.test(error.message)
      ) {
        return {
          ir: {
            version: SERVER_COMPILER_IR_VERSION,
            execution: {
              kind: "source",
              diagnostic: { message: error.message, span: error.span },
              span,
            },
          } satisfies ServerProgramCompilerIR,
        };
      }
      throw error;
    }
  },
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
    async develop(input) {
      const { developServerPrograms } =
        await import("@/platforms/server/adapter/typescript/session");
      return developServerPrograms(input, options);
    },
    async build(input) {
      const { buildServerProgram } = await import("@/platforms/server/adapter/rust/compiler");
      const programs = [...input.programs].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      await rm(input.output, { force: true, recursive: true });
      await mkdir(input.output, { recursive: true });
      const entries = [];
      for (const program of programs) {
        const path = resolve(input.output, artifactName(program.name));
        const started = performance.now();
        const result = await buildServerProgram({
          attachments: (options.attachmentSources ?? []).map((source) =>
            source.project(program, input.ir),
          ),
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
        input.report?.({
          kind: "artifact",
          platform: "server",
          identity: program.id,
          path,
          cache: result.cache,
          durationMs: performance.now() - started,
        });
      }
      return { directory: input.output, entries };
    },
  };
}

function assertPortableServerPrograms(programs: readonly ProgramIR[]): void {
  for (const program of programs) {
    if (program.environment.platform !== "server") continue;
    for (const contribution of program.contributions) {
      const implementation = serverProgramExecution(contribution);
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
