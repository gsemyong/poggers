import type { Feature, Program } from "@poggers/kit";
import type { ServerProcess } from "@poggers/kit/server";

import type { App } from "../app";

export type CookieCredentials = Readonly<{ cookie?: string }>;
export type User = Readonly<{ id: string; name: string; email: string }>;
export type Session = Readonly<{ user: User }>;

export type IdentityServer = Readonly<{
  authenticate(input: { credentials: CookieCredentials }): Promise<User | undefined>;
}>;

export type AuthenticationServer = IdentityServer &
  Readonly<{ handle(input: { request: Request }): Promise<Response> }>;

export type IdentityClient = Readonly<{
  session(): Promise<Session | undefined>;
  signIn(input: { email: string; password: string }): Promise<Session>;
  signUp(input: { name: string; email: string; password: string }): Promise<Session>;
  signOut(): Promise<void>;
}>;

export type IdentityFeature = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: { authentication: AuthenticationServer };
        Provides: { identity: IdentityServer };
      }
    >;
  };
}>;

export const identity = {
  programs: {
    server: {
      start({ capabilities }) {
        return {
          identity: {
            authenticate: (input) => capabilities.authentication.authenticate(input),
          },
        };
      },
    },
  },
} satisfies Feature<IdentityFeature, App>;
