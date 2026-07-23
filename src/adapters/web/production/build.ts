import { buildApplication } from "@/adapters/web/pipeline";
import type { PlatformProductionInput, ProductionArtifacts } from "@/contracts/platform";
import type { WebPlatform } from "@/platforms/web/platform";

/** Emits every deployable browser artifact for one web Platform realization. */
export function buildWebApplication(
  input: PlatformProductionInput<WebPlatform>,
): Promise<ProductionArtifacts> {
  return buildApplication({
    directory: input.directory,
    outdir: input.output,
  });
}
