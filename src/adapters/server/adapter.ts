import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  developServerPrograms,
  type ServerDevelopmentOptions,
} from "@/adapters/server/development/session";
import { buildServerProgram } from "@/adapters/server/production/compiler";
import type { ServerProductionDependency } from "@/adapters/server/production/dependencies";
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

/** Creates the complete development and production realization for the server Platform. */
export function createServerPlatformAdapter(
  options: ServerPlatformAdapterOptions = {},
): ServerPlatformAdapter {
  return {
    name: "server",
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
          application: input.ir.application.name,
          ir: input.ir,
          directory: input.directory,
          output: path,
          program,
        });
        entries.push({ program: program.name, environment: program.environment.name, path });
        console.log(`[poggers] production ${program.name}: cache ${result.cache}`);
      }
      return { directory: input.output, entries };
    },
  };
}

function artifactName(name: string): string {
  const readable = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return readable || "program";
}
