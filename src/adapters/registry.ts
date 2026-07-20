import type { PlatformAdapters } from "../contracts/platform";
import { createWebPlatformAdapter } from "./web/adapter";
import type { WebPlatform } from "./web/platform";

/** The explicit set of Platform implementations shipped by this package. */
export const platformAdapters = {
  web: createWebPlatformAdapter(),
} satisfies PlatformAdapters<WebPlatform>;
