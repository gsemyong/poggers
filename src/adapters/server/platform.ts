/** A headless server realization family. */
export type ServerPlatform = Readonly<{ Name: "server" }>;

/** Host HTTP routing available to server Features. */
export type HttpServer = Readonly<{
  route(input: { path: string; handle(request: Request): Promise<Response> }): Disposable;
}>;

/** The default long-running server environment. */
export type ServerProcess = Readonly<{
  Name: "server";
  Platform: ServerPlatform;
}>;
