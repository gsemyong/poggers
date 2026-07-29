import {
  createUncheckedDependencyClient,
  type Dependency,
  type DependencyImplementation,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import type {
  HttpField,
  HttpRequest,
  HttpResponse,
  HttpServer,
  ServerDependencyProvider,
  ServerProcess,
} from "@/platforms/server";
import type { BrowserMainThread, HttpClient, LocalStore } from "@/platforms/web";

declare const identityModel: unique symbol;

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
export type IdentityService<Model extends IdentityModelDefinition> = Dependency<{
  Operations: {
    authenticate(input: { cookie: string | undefined }): Promise<PrincipalOf<Model> | undefined>;
  };
}>;

/** Host authentication implementation consumed only by the reusable identity Feature. */
export type AuthenticationBackend = Dependency<{
  Operations: {
    authenticate(input: { cookie?: string }): Promise<AuthenticatedUser | undefined>;
    handle(input: { request: HttpRequest; path: string }): Promise<HttpResponse>;
  };
}>;

/** Browser-side semantic identity API. */
export type IdentityClient<Model extends IdentityModelDefinition> = Dependency<{
  Operations: {
    current(input?: never): IdentitySession<Model> | undefined;
    session(input?: never): Promise<IdentitySession<Model> | undefined>;
    signIn(input: { email: string; password: string }): Promise<IdentitySession<Model>>;
    signUp(input: {
      name: string;
      email: string;
      password: string;
    }): Promise<IdentitySession<Model>>;
    signOut(input?: never): Promise<void>;
    subscribe(receive: (session: IdentitySession<Model> | undefined) => void): Disposable;
  };
}>;

type ServerProvision<Model extends IdentityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: IdentityService<Model>;
}>;

type BrowserProvision<Model extends IdentityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: IdentityClient<Model>;
}>;

export type IdentityFeature<Model extends IdentityModelDefinition> = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: { authentication: AuthenticationBackend; http: HttpServer };
      Provides: ServerProvision<Model>;
    };
    browser: {
      Environment: BrowserMainThread;
      Requires: { http: HttpClient; storage: LocalStore };
      Provides: BrowserProvision<Model>;
    };
  };
  Providers: {
    server: { authentication: ServerDependencyProvider<AuthenticationBackend> };
  };
}>;

export type DefinedIdentity<Model extends IdentityModelDefinition> = Feature<
  IdentityFeature<Model>
> &
  Readonly<{ readonly [identityModel]?: Model }>;

type IdentityModelOf<Definition> = Definition extends IdentityModelDefinition
  ? Definition
  : Definition extends Readonly<{
        readonly [identityModel]?: infer Model extends IdentityModelDefinition;
      }>
    ? Model
    : never;

export namespace Identity {
  export type Name<Definition> =
    IdentityModelOf<Definition> extends infer Model extends IdentityModelDefinition
      ? Model["Name"]
      : never;
  export type Principal<Definition> =
    IdentityModelOf<Definition> extends infer Model extends IdentityModelDefinition
      ? Model["Principal"]
      : never;
  export type Service<Definition> =
    IdentityModelOf<Definition> extends infer Model extends IdentityModelDefinition
      ? IdentityService<Model>
      : never;
  export type Client<Definition> =
    IdentityModelOf<Definition> extends infer Model extends IdentityModelDefinition
      ? IdentityClient<Model>
      : never;
}

export type IdentityImplementation<Model extends IdentityModelDefinition> = Readonly<{
  principal(user: AuthenticatedUser): PrincipalOf<Model>;
}>;

/** Creates one reusable identity Feature for every Program environment it supports. */
export function createIdentity<const Model extends IdentityModelDefinition>(
  implementation: IdentityImplementation<Model>,
): DefinedIdentity<Model> {
  return createFeature<IdentityFeature<Model>>({
    providers: { server: { authentication: authenticationProvider } },
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const serverPath = `/api/${name}`;
          const route = dependencies.http.route({
            path: serverPath,
            handle: async (request) =>
              await dependencies.authentication.handle({ request, path: serverPath }),
          });
          const service = Object.freeze({
            async authenticate({ cookie }: { cookie: string | undefined }) {
              const user = await dependencies.authentication.authenticate({
                cookie,
              });
              return user ? implementation.principal(user) : undefined;
            },
            [Symbol.dispose]: () => route[Symbol.dispose](),
          });
          return {
            [name]: Object.freeze({
              authenticate: ({ input }) => service.authenticate(input),
              [Symbol.dispose]: () => service[Symbol.dispose](),
            } satisfies DependencyImplementation<IdentityService<Model>> & Disposable),
          } as unknown as DependencyImplementations<ServerProvision<Model>>;
        },
      },
      browser: {
        async start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const storageKey = `identity:${name}:session`;
          const cached = await dependencies.storage.read<CachedIdentitySession<Model>>({
            key: storageKey,
          });
          const client = createIdentityClient<Model>(
            dependencies.http,
            dependencies.storage,
            storageKey,
            `/api/${name}`,
            implementation.principal,
            cached,
          );
          return {
            [name]: Object.freeze({
              current: () => client.current(),
              session: () => client.session(),
              signIn: ({ input }) => client.signIn(input),
              signUp: ({ input }) => client.signUp(input),
              signOut: () => client.signOut(),
              subscribe: ({ input }) => client.subscribe(input),
            } satisfies DependencyImplementation<IdentityClient<Model>>),
          } as unknown as DependencyImplementations<BrowserProvision<Model>>;
        },
      },
    },
  }) as DefinedIdentity<Model>;
}

type CachedIdentitySession<Model extends IdentityModelDefinition> = Readonly<{
  version: 1;
  session?: IdentitySession<Model>;
}>;

function createIdentityClient<Model extends IdentityModelDefinition>(
  http: HttpClient,
  storage: LocalStore,
  storageKey: string,
  path: string,
  principal: (user: AuthenticatedUser) => PrincipalOf<Model>,
  cached: CachedIdentitySession<Model> | undefined,
): IdentityClient<Model> {
  const listeners = new Set<(session: IdentitySession<Model> | undefined) => void>();
  let pendingSession: Promise<IdentitySession<Model> | undefined> | undefined;
  let current = cached?.session;
  let restored = cached?.version === 1;
  const publish = async (value: IdentitySession<Model> | undefined) => {
    current = value;
    restored = true;
    await storage.write<CachedIdentitySession<Model>>({
      key: storageKey,
      value: {
        version: 1,
        ...(value === undefined ? {} : { session: value }),
      },
    });
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

  const refresh = () => {
    pendingSession ??= request<Readonly<{ user?: AuthenticatedUser }> | null>("get-session")
      .then(async (value) => {
        const next = value?.user ? session(value) : undefined;
        await publish(next);
        return next;
      })
      .finally(() => {
        pendingSession = undefined;
      });
    return pendingSession;
  };

  return Object.freeze({
    current() {
      return current;
    },
    session() {
      if (!restored) return refresh();
      void refresh().catch(() => undefined);
      return Promise.resolve(current);
    },
    async signIn(input) {
      const next = session(await request("sign-in/email", input));
      await publish(next);
      return next;
    },
    async signUp(input) {
      const next = session(await request("sign-up/email", input));
      await publish(next);
      return next;
    },
    async signOut() {
      await request("sign-out", {});
      await publish(undefined);
    },
    subscribe(receive) {
      listeners.add(receive);
      return { [Symbol.dispose]: () => listeners.delete(receive) };
    },
  });
}

/** Starts the complete Identity Feature with deterministic host boundaries. */
export async function createIdentityFixture<Model extends IdentityModelDefinition>(
  identity: DefinedIdentity<Model>,
  input: Readonly<{
    user?: AuthenticatedUser;
    authentication?: AuthenticationBackend;
    storage?: Map<string, unknown>;
  }> = {},
): Promise<
  AsyncDisposable &
    Readonly<{
      service: IdentityService<Model>;
      client: IdentityClient<Model>;
      requests: readonly string[];
    }>
> {
  const [{ startFeatureFixture }, { serverProgramLanguageRuntime }, { webProgramLanguageRuntime }] =
    await Promise.all([
      import("@/execution/process"),
      import("@/platforms/server/adapter/typescript/runtime"),
      import("@/platforms/web/adapter/ui/process"),
    ]);
  const name = "identity" as Model["Name"];
  const user = input.user;
  const requests: string[] = [];
  const storage = input.storage ?? new Map<string, unknown>();
  const authentication: AuthenticationBackend = input.authentication ?? {
    authenticate: async ({ cookie }) => (cookie && user ? user : undefined),
    handle: async ({ request }) => {
      if (request.path.endsWith("/get-session")) {
        return jsonResponse(user ? { user } : null);
      }
      if (request.path.endsWith("/sign-out")) return jsonResponse({});
      return user
        ? jsonResponse({ user })
        : jsonResponse({ message: "No fixture user is configured." }, 401);
    },
  };
  const server = await startFeatureFixture<IdentityFeature<Model>>({
    feature: identity,
    program: "server",
    language: serverProgramLanguageRuntime,
    contributions: [
      {
        feature: "",
        requires: ["authentication", "http"],
        provides: [name],
      },
    ],
    dependencies: {
      authentication,
      http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
    },
  });
  const browser = await startFeatureFixture<IdentityFeature<Model>>({
    feature: identity,
    program: "browser",
    language: webProgramLanguageRuntime,
    contributions: [{ feature: "", requires: ["http", "storage"], provides: [name] }],
    dependencies: {
      http: {
        async request({ path }: { path: string }) {
          requests.push(path);
          const response = await authentication.handle({
            request: {
              method: path.endsWith("/get-session") ? "GET" : "POST",
              path,
              query: [],
              headers: [],
              body: "",
            },
            path: `/api/${name}`,
          });
          const headers = new Headers();
          for (const field of response.headers) headers.append(field.name, field.value);
          return new Response(response.body, { status: response.status, headers });
        },
      },
      storage: {
        async read<Value>({ key }: { key: string }) {
          return storage.get(key) as Value | undefined;
        },
        async write<Value>({ key, value }: { key: string; value: Value }) {
          storage.set(key, structuredClone(value));
        },
        async remove({ key }: { key: string }) {
          storage.delete(key);
        },
      },
    },
  });
  const serverImplementation = server.contributions[0]?.provided[name];
  const browserImplementation = browser.contributions[0]?.provided[name];
  if (
    !serverImplementation ||
    typeof serverImplementation !== "object" ||
    !browserImplementation ||
    typeof browserImplementation !== "object"
  ) {
    await browser.dispose();
    await server.dispose();
    throw new Error("The Identity fixture did not provide its semantic APIs.");
  }
  return {
    service: createUncheckedDependencyClient(
      serverImplementation as never,
    ) as IdentityService<Model>,
    client: createUncheckedDependencyClient(
      browserImplementation as never,
    ) as IdentityClient<Model>,
    requests,
    async [Symbol.asyncDispose]() {
      await browser.dispose();
      await server.dispose();
    },
  };
}

function jsonResponse(value: unknown, status = 200): HttpResponse {
  return {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    body: JSON.stringify(value),
    stream: undefined,
  };
}

/** Feature-owned Better Auth realization for the Identity boundary. */
const authenticationProvider: ServerDependencyProvider<AuthenticationBackend> = {
  async development({ appName, allowedOrigins, configuration, origin, sqlite }) {
    const [{ betterAuth }, { getMigrations }] = await Promise.all([
      import("better-auth"),
      import("better-auth/db/migration"),
    ]);
    const path = configuration.database;
    if (!path) throw new Error("The authentication provider requires its database configuration.");
    const database = sqlite(path);
    const auth = betterAuth({
      appName,
      baseURL: origin,
      database,
      emailAndPassword: { enabled: true },
      secret: configuration.secret ?? "kit-development-authentication-secret",
      trustedOrigins: [...allowedOrigins],
    });
    await (await getMigrations(auth.options)).runMigrations();
    return Object.freeze({
      async authenticate({ input: { cookie } }) {
        const headers = new Headers();
        if (cookie) headers.set("cookie", cookie);
        const session = await auth.api.getSession({ headers });
        return session
          ? ({
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
            } satisfies AuthenticatedUser)
          : undefined;
      },
      async handle({ input: { request, path: mountedPath } }) {
        const url = new URL(origin);
        url.pathname = `/api/auth${request.path.slice(mountedPath.length)}`;
        for (const { name, value } of request.query) url.searchParams.append(name, value);
        const headers = new Headers();
        for (const { name, value } of request.headers) headers.append(name, value);
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            ...(!["GET", "HEAD"].includes(request.method) && request.body
              ? { body: request.body }
              : {}),
          }),
        );
        return semanticResponse(response);
      },
      [Symbol.dispose]: () => database[Symbol.dispose](),
    } satisfies DependencyImplementation<AuthenticationBackend> & Disposable);
  },
  production: {
    configuration: [
      {
        name: "database",
        environment: "KIT_DATABASE",
        default: ".kit/data/system.sqlite",
        allocation: {
          kind: "storage",
          name: "system.sqlite",
          scope: "deployment",
          type: "file",
        },
      },
      {
        name: "secret",
        environment: "BETTER_AUTH_SECRET",
        default: "kit-development-authentication-secret",
      },
    ],
    crate: {
      package: "kit-server-authentication",
      directory: "./providers/server/rust",
    },
    rust: {
      type: "kit_server_authentication::Authentication",
      constructor: "kit_server_authentication::create",
    },
  },
};

async function semanticResponse(response: Response): Promise<HttpResponse> {
  const headers: HttpField[] = [];
  for (const [name, value] of response.headers) headers.push({ name, value });
  for (const value of response.headers.getSetCookie()) {
    if (!headers.some((field) => field.name === "set-cookie" && field.value === value)) {
      headers.push({ name: "set-cookie", value });
    }
  }
  return {
    status: response.status,
    headers,
    body: response.body ? await response.text() : undefined,
    stream: undefined,
  };
}
