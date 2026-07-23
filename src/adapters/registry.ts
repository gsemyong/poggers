import { createDevelopmentWebLoaderRegistry } from "@/adapters/integration/web-server";
import {
  createServerPlatformAdapter,
  type ServerPlatformAdapterOptions,
} from "@/adapters/server/adapter";
import { createWebPlatformAdapter, type WebPlatformAdapterOptions } from "@/adapters/web/adapter";
import type { PlatformAdapters } from "@/contracts/platform";
import type { ServerPlatform } from "@/platforms/server/platform";
import type { WebPlatform } from "@/platforms/web/platform";

/** Creates one coordinated set of the Platform implementations shipped by this package. */
export function createPlatformAdapters(
  options: Readonly<{
    server?: ServerPlatformAdapterOptions;
    web?: WebPlatformAdapterOptions;
  }> = {},
): PlatformAdapters<ServerPlatform | WebPlatform> {
  const webLoaders = createDevelopmentWebLoaderRegistry();
  return {
    server: createServerPlatformAdapter({
      developmentWebPort:
        options.server?.developmentWebPort ?? options.web?.developmentPort ?? 3000,
      ...options.server,
      webLoaders,
    }),
    web: createWebPlatformAdapter({ ...options.web, webLoaders }),
  };
}

/** The default coordinated Platform implementations. */
export const platformAdapters = createPlatformAdapters();
