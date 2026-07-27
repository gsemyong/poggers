import type { PlatformAdapters } from "@/adapter";
import { selectSystemOutputs } from "@/compiler/ir";
import type { ServerPlatform } from "@/platforms/server";
import {
  createServerPlatformAdapter,
  type ServerPlatformAdapterOptions,
} from "@/platforms/server/adapter";
import type { WebPlatform } from "@/platforms/web";
import { createWebPlatformAdapter, type WebPlatformAdapterOptions } from "@/platforms/web/adapter";
import {
  createDevelopmentWebLoaderRegistry,
  webHttpProductionDependency,
  webRouteLoaderAttachments,
} from "@/platforms/web/adapter/server";

/** Creates one coordinated set of the Platform implementations shipped by this package. */
export function createPlatformAdapters(
  options: Readonly<{
    server?: ServerPlatformAdapterOptions;
    web?: WebPlatformAdapterOptions;
  }> = {},
): PlatformAdapters<ServerPlatform | WebPlatform> {
  const programAttachments = createDevelopmentWebLoaderRegistry();
  const configuredDevelopmentHost = options.server?.developmentHost;
  const webDevelopmentPort = options.web?.developmentPort ?? 3000;
  const configuredProductionDependencies = options.server?.productionDependencies ?? [];
  const productionDependencies = configuredProductionDependencies.some(
    ({ dependency }) => dependency === "http",
  )
    ? configuredProductionDependencies
    : [webHttpProductionDependency, ...configuredProductionDependencies];
  return {
    server: createServerPlatformAdapter({
      ...options.server,
      developmentHost(input) {
        const configured =
          typeof configuredDevelopmentHost === "function"
            ? configuredDevelopmentHost(input)
            : configuredDevelopmentHost;
        return {
          ...configured,
          allowedOrigins:
            configured?.allowedOrigins ??
            selectSystemOutputs(input.ir, input.app)
              .interfaces.filter(({ platform }) => platform === "web")
              .map((_, index) => `http://localhost:${webDevelopmentPort + index}`),
        };
      },
      productionDependencies,
      attachmentSources: [webRouteLoaderAttachments, ...(options.server?.attachmentSources ?? [])],
      programAttachments,
    }),
    web: createWebPlatformAdapter({ ...options.web, programAttachments }),
  };
}

/** The default coordinated Platform implementations. */
export const platformAdapters = createPlatformAdapters();
