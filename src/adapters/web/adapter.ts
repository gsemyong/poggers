import type { WebPlatform } from "@/adapters/web/platform";
import { buildApplication, runApplication } from "@/adapters/web/toolchain";
import { createWebUIAdapter, type WebUIAdapter } from "@/adapters/web/ui/adapter";
import type { PlatformAdapter } from "@/contracts/platform";

export type WebPlatformAdapter = PlatformAdapter<WebPlatform, WebUIAdapter>;
export type WebPlatformAdapterOptions = Readonly<{
  developmentPort?: number;
  serverOrigin?: string;
}>;

/** Creates the complete development, production, Component, and Presentation web realization. */
export function createWebPlatformAdapter(
  options: WebPlatformAdapterOptions = {},
): WebPlatformAdapter {
  return {
    name: "web",
    ui: createWebUIAdapter(),
    async develop(input) {
      assertWebInput(input.platform, input.programs);
      const server = await runApplication({
        directory: input.directory,
        port: options.developmentPort,
        serverOrigin: options.serverOrigin,
      });
      let disposed = false;
      return {
        locations: [`http://localhost:${server.port}`],
        async [Symbol.asyncDispose]() {
          if (disposed) return;
          disposed = true;
          await server.stop();
        },
      };
    },
    async build(input) {
      assertWebInput(input.platform, input.programs);
      const build = await buildApplication({
        directory: input.directory,
        outdir: input.output,
      });
      return build;
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
