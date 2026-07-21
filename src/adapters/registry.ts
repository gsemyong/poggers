import { createServerPlatformAdapter } from "@/adapters/server/adapter";
import type { ServerPlatform } from "@/adapters/server/platform";
import { createWebPlatformAdapter } from "@/adapters/web/adapter";
import type { WebPlatform } from "@/adapters/web/platform";
import type { PlatformAdapters } from "@/contracts/platform";

/** The explicit set of Platform implementations shipped by this package. */
export const platformAdapters = {
  server: createServerPlatformAdapter(),
  web: createWebPlatformAdapter(),
} satisfies PlatformAdapters<ServerPlatform | WebPlatform>;
