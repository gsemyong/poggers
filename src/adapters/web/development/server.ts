import type { DevelopmentWebLoaderRegistry } from "@/adapters/web-server";
import { runWebInterface } from "@/adapters/web/pipeline";
import type { DevelopmentSession, PlatformDevelopmentInput } from "@/contracts/platform";
import type { WebPlatform } from "@/platforms/web/platform";

export type WebDevelopmentOptions = Readonly<{
  developmentPort?: number;
  serverOrigin?: string;
  webLoaders?: DevelopmentWebLoaderRegistry;
}>;

/** Starts every selected web interface and owns their complete lifecycle. */
export async function developWebSystem(
  input: PlatformDevelopmentInput<WebPlatform>,
  options: WebDevelopmentOptions = {},
): Promise<DevelopmentSession> {
  const interfaces = input.interfaces;
  const results = await Promise.allSettled(
    interfaces.map((interface_, index) =>
      runWebInterface({
        directory: input.directory,
        interface: interface_.id,
        revisions: input.revisions,
        port: (options.developmentPort ?? 3000) + index,
        strictPort: true,
        serverOrigin: options.serverOrigin,
        webLoaders: options.webLoaders,
      }),
    ),
  );
  const servers = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) {
    const disposal = await Promise.allSettled(servers.map((server) => server.stop()));
    failures.push(
      ...disposal.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Web development startup failed.");
  }
  let disposed = false;
  return {
    locations: Object.freeze(
      Object.fromEntries(
        interfaces.map((interface_, index) => [
          interface_.id,
          [`http://localhost:${servers[index]!.port}`],
        ]),
      ),
    ),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      const results = await Promise.allSettled(servers.reverse().map((server) => server.stop()));
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Web disposal failed.");
    },
  };
}
