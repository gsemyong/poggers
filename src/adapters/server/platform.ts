/** A headless server realization family. */
export type ServerPlatform = Readonly<{ Name: "server" }>;

/** The default long-running server environment. */
export type ServerProcess = Readonly<{
  Name: "server";
  Platform: ServerPlatform;
}>;
