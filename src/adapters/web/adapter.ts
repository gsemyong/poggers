import { webCompilerExtension } from "@/adapters/web/compiler";
import {
  developWebApplication,
  type WebDevelopmentOptions,
} from "@/adapters/web/development/server";
import { buildWebApplication } from "@/adapters/web/production/build";
import { createWebUIAdapter, type WebUIAdapter } from "@/adapters/web/ui/adapter";
import { createWebPresentationAdapter } from "@/adapters/web/ui/presentation/adapter";
import type { PlatformAdapter } from "@/contracts/platform";
import type { WebPlatform } from "@/platforms/web/platform";

export type WebPlatformAdapter = PlatformAdapter<WebPlatform, WebUIAdapter>;
export type WebPlatformAdapterOptions = WebDevelopmentOptions;

/** Creates the complete development, production, Component, and Presentation web realization. */
export function createWebPlatformAdapter(
  options: WebPlatformAdapterOptions = {},
): WebPlatformAdapter {
  return {
    name: "web",
    compiler: [webCompilerExtension],
    ui: createWebUIAdapter(createWebPresentationAdapter()),
    async develop(input) {
      assertWebInput(input.platform, input.programs);
      return developWebApplication(input, options);
    },
    async build(input) {
      assertWebInput(input.platform, input.programs);
      return buildWebApplication(input);
    },
  };
}

function assertWebInput(
  platform: string,
  programs: readonly Readonly<{
    id: string;
    environment: Readonly<{ name: string; platform: string }>;
    ui?: unknown;
  }>[],
): void {
  if (platform !== "web") throw new Error(`The web adapter cannot realize Platform ${platform}.`);
  const unsupported = programs.filter(
    ({ environment }) =>
      environment.platform !== "web" ||
      !["browser-main", "browser-worker", "browser-service-worker"].includes(environment.name),
  );
  if (unsupported.length) {
    throw new Error(
      `The web adapter does not yet realize ${unsupported.map(({ id }) => JSON.stringify(id)).join(", ")}.`,
    );
  }
}
