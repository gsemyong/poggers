/** A headless server realization family. */
export type ServerPlatform = Readonly<{ Name: "server" }>;

export type HttpField = Readonly<{ name: string; value: string }>;

/** Finds the first matching value in transport-neutral HTTP fields. */
export function getHttpValue(
  values: readonly HttpField[],
  input: { name: string },
): string | undefined {
  return values.find(({ name }) => name === input.name)?.value;
}

/** Transport-neutral request meaning supplied by an HTTP host adapter. */
export type HttpRequest = Readonly<{
  method: string;
  path: string;
  query: readonly HttpField[];
  headers: readonly HttpField[];
  body: string;
}>;

/** Transport-neutral response meaning consumed by an HTTP host adapter. */
export type HttpResponse = Readonly<{
  status: number;
  headers: readonly HttpField[];
  body: string | undefined;
  stream: AsyncIterable<string> | undefined;
}>;

/** Host HTTP routing available to server Features. */
export type HttpServer = Readonly<{
  route(input: { path: string; handle(request: HttpRequest): Promise<HttpResponse> }): Disposable;
}>;

/** The default long-running server environment. */
export type ServerProcess = Readonly<{
  Name: "server";
  Platform: ServerPlatform;
}>;
