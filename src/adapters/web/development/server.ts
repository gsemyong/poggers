import type { DevelopmentWebLoaderRegistry } from "@/adapters/integration/web-server";
import { runApplication } from "@/adapters/web/pipeline";
import type { DevelopmentSession, PlatformDevelopmentInput } from "@/contracts/platform";
import type { WebPlatform } from "@/platforms/web/platform";

export type WebDevelopmentOptions = Readonly<{
  developmentPort?: number;
  serverOrigin?: string;
  webLoaders?: DevelopmentWebLoaderRegistry;
}>;

/** Starts the browser development server and owns its complete lifecycle. */
export async function developWebApplication(
  input: PlatformDevelopmentInput<WebPlatform>,
  options: WebDevelopmentOptions = {},
): Promise<DevelopmentSession> {
  const server = await runApplication({
    directory: input.directory,
    port: options.developmentPort,
    serverOrigin: options.serverOrigin,
    webLoaders: options.webLoaders,
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
}
