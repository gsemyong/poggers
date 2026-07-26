import type { PlatformAdapter } from "@/adapter";
import type { WebPlatform } from "@/platforms/web";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import type { WebDevelopmentOptions } from "@/platforms/web/adapter/development";
import { createWebPresentationAdapter } from "@/platforms/web/adapter/presentation/adapter";
import { createWebUIAdapter, type WebUIAdapter } from "@/platforms/web/adapter/ui/adapter";

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
      assertWebInput(input.platform, input.programs, input.interfaces);
      const { developWebSystem } = await import("@/platforms/web/adapter/development");
      return developWebSystem(input, options);
    },
    async build(input) {
      assertWebInput(input.platform, input.programs, input.interfaces);
      const { buildWebSystem } = await import("@/platforms/web/adapter/production");
      return buildWebSystem(input);
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
  interfaces: readonly Readonly<{ id: string; platform: string }>[],
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
  const unsupportedInterfaces = interfaces.filter((interface_) => interface_.platform !== "web");
  if (unsupportedInterfaces.length) {
    throw new Error(
      `The web adapter cannot realize ${unsupportedInterfaces.map(({ id }) => JSON.stringify(id)).join(", ")}.`,
    );
  }
}
