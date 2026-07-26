import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { PlatformProductionInput, ProductionArtifacts } from "@/adapter";
import { linkProgram } from "@/compiler/linker";
import type { WebPlatform } from "@/platforms/web";
import { buildWebInterface } from "@/platforms/web/adapter/pipeline";

/** Emits one isolated production tree for every selected web interface. */
export async function buildWebSystem(
  input: PlatformProductionInput<WebPlatform>,
): Promise<ProductionArtifacts> {
  const interfaces = input.interfaces;
  await rm(input.output, { recursive: true, force: true });
  await mkdir(input.output, { recursive: true });
  const builds = await Promise.all(
    interfaces.map((interface_) =>
      buildWebInterface({
        directory: input.directory,
        outdir: resolve(input.output, "interfaces", encodeURIComponent(interface_.feature)),
        interface: interface_.id,
        ir: input.ir,
      }),
    ),
  );
  return {
    directory: input.output,
    entries: Object.freeze(
      builds.flatMap(({ entries }) =>
        entries.map((entry) => {
          if (entry.kind !== "program") return entry;
          const program = input.programs.find(({ id }) => id === entry.identity);
          if (!program) {
            throw new Error(
              `Web production emitted unknown Program ${JSON.stringify(entry.identity)}.`,
            );
          }
          return {
            ...entry,
            dependencies: Object.freeze(
              linkProgram(program)
                .external.map(({ name }) => name)
                .sort(),
            ),
          };
        }),
      ),
    ),
  };
}
