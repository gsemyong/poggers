import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWebInterface } from "@/adapters/web/pipeline";
import type { PlatformProductionInput, ProductionArtifacts } from "@/contracts/platform";
import type { WebPlatform } from "@/platforms/web/platform";

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
    entries: Object.freeze(builds.flatMap(({ entries }) => entries)),
  };
}
