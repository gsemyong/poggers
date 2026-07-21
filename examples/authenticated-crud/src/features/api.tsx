import type { EntityService, Feature, Program } from "@poggers/kit";
import type { ServerProcess } from "@poggers/kit/server";

import type { App } from "../app";
import type { AuthenticationServer, CookieCredentials } from "./identity";
import { handleTasks, type Tasks } from "./tasks";

export type HttpServer = Readonly<{
  route(input: { path: string; handle(request: Request): Promise<Response> }): Disposable;
}>;

export type ApiFeature = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: {
          authentication: AuthenticationServer;
          http: HttpServer;
          tasks: EntityService<Tasks>;
        };
      }
    >;
  };
}>;

export const api = {
  programs: {
    server: {
      start({ capabilities }) {
        capabilities.http.route({
          path: "/api/auth",
          handle: (request) => capabilities.authentication.handle({ request }),
        });
        capabilities.http.route({
          path: "/api/tasks",
          handle: handleTasks(
            capabilities.tasks,
            (request): CookieCredentials => ({
              cookie: request.headers.get("cookie") ?? undefined,
            }),
          ),
        });
      },
    },
  },
} satisfies Feature<ApiFeature, App>;
