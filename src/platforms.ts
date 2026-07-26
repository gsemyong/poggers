import type { PlatformAdapters } from "@/adapter";
import type { ServerPlatform } from "@/platforms/server";
import {
  createServerPlatformAdapter,
  type ServerPlatformAdapterOptions,
} from "@/platforms/server/adapter";
import type { WebPlatform } from "@/platforms/web";
import { createWebPlatformAdapter, type WebPlatformAdapterOptions } from "@/platforms/web/adapter";
import { createDevelopmentWebLoaderRegistry } from "@/platforms/web/adapter/server";

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
