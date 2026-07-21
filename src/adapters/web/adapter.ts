import type { WebPlatform } from "@/adapters/web/platform";
import { buildApplication, runApplication } from "@/adapters/web/toolchain";
import { createWebUIAdapter, type WebUIAdapter } from "@/adapters/web/ui/adapter";
import type { PlatformAdapter } from "@/contracts/platform";

export type WebPlatformAdapter = PlatformAdapter<WebPlatform, WebUIAdapter>;

/** Creates the complete development, production, Component, and Presentation web realization. */
export function createWebPlatformAdapter(): WebPlatformAdapter {
  return {
    name: "web",
    ui: createWebUIAdapter(),
    async develop(input) {
      assertWebInput(input.platform, input.programs);
      const server = await runApplication({ directory: input.directory });
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
      const directory = await buildApplication({
        directory: input.directory,
        outdir: input.output,
      });
      return {
        directory,
        entries: [{ environment: "browser-main", path: `${directory}/app.js` }],
      };
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
    ({ environment, ui }) =>
      environment.platform !== "web" || environment.name !== "browser-main" || !ui,
  );
  if (unsupported.length) {
    throw new Error(
      `The web adapter does not yet realize ${unsupported.map(({ id }) => JSON.stringify(id)).join(", ")}.`,
    );
  }
}
