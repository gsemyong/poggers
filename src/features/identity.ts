import type {
  HttpRequest,
  HttpResponse,
  HttpServer,
  ServerProcess,
} from "@/adapters/server/platform";
import type { BrowserMainThread, HttpClient } from "@/adapters/web/platform";
import type { Feature, Program } from "@/core/application";

export type AuthenticatedUser = Readonly<{ id: string; name: string; email: string }>;

export type IdentityModelDefinition = Readonly<{
  Name: string;
  Principal: Readonly<{ id: string }>;
}>;

/** Validates and preserves the semantic definition consumed by the identity factory. */
export type IdentityModel<Definition extends IdentityModelDefinition> = Readonly<Definition>;

type PrincipalOf<Model extends IdentityModelDefinition> = Model["Principal"];

export type IdentitySession<Model extends IdentityModelDefinition> = Readonly<{
  user: PrincipalOf<Model>;
}>;

/** Server-side identity authority exposed to other Features. */
export type IdentityService<Model extends IdentityModelDefinition> = Readonly<{
  authenticate(input: { cookie: string | undefined }): Promise<PrincipalOf<Model> | undefined>;
}>;

/** Host authentication implementation consumed only by the reusable identity Feature. */
export type AuthenticationBackend = Readonly<{
  authenticate(input: { cookie?: string }): Promise<AuthenticatedUser | undefined>;
  handle(input: { request: HttpRequest; path: string }): Promise<HttpResponse>;
}>;

/** Browser-side semantic identity API. */
export type IdentityClient<Model extends IdentityModelDefinition> = Readonly<{
  session(): Promise<IdentitySession<Model> | undefined>;
  signIn(input: { email: string; password: string }): Promise<IdentitySession<Model>>;
  signUp(input: { name: string; email: string; password: string }): Promise<IdentitySession<Model>>;
  signOut(): Promise<void>;
  subscribe(receive: (session: IdentitySession<Model> | undefined) => void): Disposable;
}>;

type ServerProvision<Model extends IdentityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: IdentityService<Model>;
}>;

type BrowserProvision<Model extends IdentityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: IdentityClient<Model>;
}>;

export type IdentityFeature<Model extends IdentityModelDefinition> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: { authentication: AuthenticationBackend; http: HttpServer };
        Provides: ServerProvision<Model>;
      }
    >;
    browser: Program<
      BrowserMainThread,
      { Requires: { http: HttpClient }; Provides: BrowserProvision<Model> }
    >;
  };
}>;

export type IdentityImplementation<Model extends IdentityModelDefinition> = Readonly<{
  name: Model["Name"];
  principal(user: AuthenticatedUser): PrincipalOf<Model>;
}>;

/** Creates the complete server and browser identity slice from one semantic model. */
export function createIdentity<Model extends IdentityModelDefinition>(
  implementation: IdentityImplementation<Model>,
): Feature<IdentityFeature<Model>> {
  const path = `/api/${implementation.name}`;
  return {
    programs: {
      server: {
        start({
          capabilities,
        }: {
          capabilities: { authentication: AuthenticationBackend; http: HttpServer };
        }) {
          const serverPath = `/api/${implementation.name}`;
          const route = capabilities.http.route({
            path: serverPath,
            handle: async (request) =>
              await capabilities.authentication.handle({ request, path: serverPath }),
          });
          const service: IdentityService<Model> & Disposable = Object.freeze({
            async authenticate({ cookie }: { cookie: string | undefined }) {
              const user = await capabilities.authentication.authenticate({
                cookie,
              });
              return user ? implementation.principal(user) : undefined;
            },
            [Symbol.dispose]: () => route[Symbol.dispose](),
          });
          return { [implementation.name]: service } as unknown as ServerProvision<Model>;
        },
      },
      browser: {
        start({ capabilities }: { capabilities: { http: HttpClient } }) {
          return {
            [implementation.name]: createIdentityClient<Model>(
              capabilities.http,
              path,
              implementation.principal,
            ),
          } as BrowserProvision<Model>;
        },
      },
    },
  } as Feature<IdentityFeature<Model>>;
}

function createIdentityClient<Model extends IdentityModelDefinition>(
  http: HttpClient,
  path: string,
  principal: (user: AuthenticatedUser) => PrincipalOf<Model>,
): IdentityClient<Model> {
  const listeners = new Set<(session: IdentitySession<Model> | undefined) => void>();
  const publish = (value: IdentitySession<Model> | undefined) => {
    for (const receive of listeners) receive(value);
  };
  const request = async <Value>(endpoint: string, body?: unknown): Promise<Value> => {
    const response = await http.request({
      path: `${path}/${endpoint}`,
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(failure.message ?? `Authentication failed with status ${response.status}.`);
    }
    return (await response.json()) as Value;
  };
  const session = (value: unknown): IdentitySession<Model> => {
    const record = value as Readonly<{ user: AuthenticatedUser }>;
    return { user: principal(record.user) };
  };

  return Object.freeze({
    async session() {
      const value = await request<Readonly<{ user?: AuthenticatedUser }> | null>("get-session");
      const current = value?.user ? session(value) : undefined;
      publish(current);
      return current;
    },
    async signIn(input) {
      const current = session(await request("sign-in/email", input));
      publish(current);
      return current;
    },
    async signUp(input) {
      const current = session(await request("sign-up/email", input));
      publish(current);
      return current;
    },
    async signOut() {
      await request("sign-out", {});
      publish(undefined);
    },
    subscribe(receive) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
  });
}
