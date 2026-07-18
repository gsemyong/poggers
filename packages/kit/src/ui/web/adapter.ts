import type { PlatformAdapter } from "../platform";
import type { WebPlatform } from "./platform";
import { createWebPresentationAdapter } from "./presentation/adapter";
import type { WebPresentationTokens } from "./presentation/language";
import { createApplicationUI, type WebStructureAdapter } from "./structure";

export type WebPlatformAdapter = PlatformAdapter<WebPlatform, WebStructureAdapter, Element>;

/** Creates one paired web structure and Presentation implementation. */
export function createWebPlatformAdapter(): WebPlatformAdapter {
  const presentation = createWebPresentationAdapter<WebPresentationTokens>();
  const structure: WebStructureAdapter = {
    createApplicationUI(options) {
      return createApplicationUI({ ...options, presentationAdapter: presentation });
    },
  };
  return { name: "web", structure, presentation };
}
