import type { DatabaseSync } from "node:sqlite";

import { equalData } from "@/core/data";
import {
  createUncheckedDependencyClient,
  type Dependency,
  type DependencyImplementation,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeLiteral } from "@/core/intrinsic";
import {
  getHttpValue,
  type HttpField,
  type HttpRequest,
  type HttpResponse,
  type HttpServer,
  type ServerDependencyProvider,
  type ServerProcess,
} from "@/platforms/server";
import type { BrowserMainThread, ConnectionContext, HttpClient, LocalStore } from "@/platforms/web";

declare const identityModel: unique symbol;

export type AuthenticatedUser = Readonly<{ id: string; name: string; email: string }>;

export type AuthenticatedIdentity = Readonly<{
  session: string;
  user: AuthenticatedUser;
}>;

export type IdentityModelDefinition = Readonly<{
  Name: string;
  Version: number;
  Principal: Readonly<{ id: string }>;
}>;

/** Validates and preserves the semantic definition consumed by the identity factory. */
export type IdentityModel<Definition extends IdentityModelDefinition> = Readonly<Definition>;

type PrincipalOf<Model extends IdentityModelDefinition> = Model["Principal"];

export type IdentityAuthorization = Readonly<{
  session: string;
  version: number;
  expiresAt: number;
}>;

export type IdentitySession<Model extends IdentityModelDefinition> = Readonly<{
  user: PrincipalOf<Model>;
  authorization: IdentityAuthorization;
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
    authenticate(input: { cookie?: string }): Promise<AuthenticatedIdentity | undefined>;
    handle(input: { request: HttpRequest; path: string }): Promise<HttpResponse>;
  };
}>;

export type ApplicationCredential = Readonly<{
  audience: string;
  expiresAt: number;
  issuedAt: number;
  issuer: string;
  policyVersion: number;
  principal: object;
  session: string;
  subject: string;
  token: string;
}>;

export type IssuedApplicationCredential = Readonly<{
  credential: string;
  claims: ApplicationCredential;
}>;

/**
 * Signed application authorization boundary.
 *
 * JWT is one provider realization; Features consume only this semantic contract.
 */
export type IdentityCredentials = Dependency<{
  Operations: {
    issue(input: {
      audience: string;
      policyVersion: number;
      principal: object;
      session: string;
      subject: string;
    }): Promise<IssuedApplicationCredential>;
    verify(input: {
      audience: string;
      credential: string;
    }): Promise<ApplicationCredential | undefined>;
    refresh(input: {
      audience: string;
      credential: string;
      expiresWithin: number;
      policyVersion: number;
    }): Promise<IssuedApplicationCredential | undefined>;
    revoke(input: { expiresAt: number; token: string }): Promise<void>;
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
      Requires: {
        authentication: AuthenticationBackend;
        credentials: IdentityCredentials;
        http: HttpServer;
      };
      Provides: ServerProvision<Model>;
    };
    browser: {
      Environment: BrowserMainThread;
      Requires: { connection: ConnectionContext; http: HttpClient; storage: LocalStore };
      Provides: BrowserProvision<Model>;
    };
  };
  Providers: {
    server: {
      authentication: ServerDependencyProvider<AuthenticationBackend>;
      credentials: ServerDependencyProvider<IdentityCredentials>;
    };
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

type IdentityServerDependencies = Readonly<{
  authentication: AuthenticationBackend;
  credentials: IdentityCredentials;
  http: HttpServer;
}>;

/** Creates one reusable identity Feature for every Program environment it supports. */
export function createIdentity<const Model extends IdentityModelDefinition>(
  implementation: IdentityImplementation<Model>,
): DefinedIdentity<Model> {
  return createFeature<IdentityFeature<Model>>({
    providers: {
      server: {
        authentication: authenticationProvider,
        credentials: credentialProvider,
      },
    },
    programs: {
      server: {
        start({ dependencies, provides }) {
          return startIdentityServer(
            implementation,
            typeLiteral<Model["Version"]>(),
            dependencies,
            provides[0] as Model["Name"],
          );
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
            dependencies.connection,
            dependencies.http,
            dependencies.storage,
            storageKey,
            `/api/${name}`,
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

function startIdentityServer<Model extends IdentityModelDefinition>(
  implementation: IdentityImplementation<Model>,
  policyVersion: number,
  dependencies: IdentityServerDependencies,
  name: Model["Name"],
): DependencyImplementations<ServerProvision<Model>> {
  const serverPath = `/api/${name}`;
  const route = dependencies.http.route({
    path: serverPath,
    handle: async (request) => {
      const cookie = getHttpValue(request.headers, { name: "cookie" }) ?? "";
      const endpoint = request.path.slice(serverPath.length);
      if (endpoint === "/get-session") {
        const verified = await dependencies.credentials.verify({
          audience: name,
          credential: cookie,
        });
        if (verified?.policyVersion === policyVersion) {
          const refreshed = await dependencies.credentials.refresh({
            audience: name,
            credential: cookie,
            expiresWithin: 60_000,
            policyVersion,
          });
          const authorization = refreshed?.claims ?? verified;
          return identitySessionResponse(
            authorization.principal as PrincipalOf<Model>,
            authorization,
            refreshed?.credential,
          );
        }
        const authenticated = await dependencies.authentication.authenticate({ cookie });
        if (!authenticated) return jsonResponse(null);
        const principal = implementation.principal(authenticated.user);
        const issued = await dependencies.credentials.issue({
          audience: name,
          subject: authenticated.user.id,
          session: authenticated.session,
          principal,
          policyVersion,
        });
        return identitySessionResponse(principal, issued.claims, issued.credential);
      }
      if (endpoint === "/sign-out") {
        const signingOut = await dependencies.credentials.verify({
          audience: name,
          credential: cookie,
        });
        if (signingOut) {
          await dependencies.credentials.revoke({
            token: signingOut.token,
            expiresAt: signingOut.expiresAt,
          });
        }
        return clearIdentityCredential(
          await dependencies.authentication.handle({
            request,
            path: serverPath,
          }),
        );
      }
      const response = await dependencies.authentication.handle({
        request,
        path: serverPath,
      });
      if (response.status >= 200 && response.status < 400) {
        const completedAuthentication = await dependencies.authentication.authenticate({
          cookie: getHttpValue(response.headers, { name: "set-cookie" }) ?? cookie,
        });
        if (completedAuthentication) {
          const completedPrincipal = implementation.principal(completedAuthentication.user);
          const completedCredential = await dependencies.credentials.issue({
            audience: name,
            subject: completedAuthentication.user.id,
            session: completedAuthentication.session,
            principal: completedPrincipal,
            policyVersion,
          });
          return authenticatedIdentityResponse(
            response,
            completedPrincipal,
            completedCredential.claims,
            completedCredential.credential,
            endpoint === "/sign-in/email" || endpoint === "/sign-up/email",
          );
        }
      }
      return response;
    },
  });
  const service = Object.freeze({
    async authenticate({ cookie }: { cookie: string | undefined }) {
      const verified = await dependencies.credentials.verify({
        audience: name,
        credential: cookie ?? "",
      });
      return verified?.policyVersion === policyVersion
        ? (verified.principal as PrincipalOf<Model>)
        : undefined;
    },
    [Symbol.dispose]: () => route[Symbol.dispose](),
  });
  return {
    [name]: Object.freeze({
      authenticate: ({ input }) => service.authenticate(input),
      [Symbol.dispose]: () => service[Symbol.dispose](),
    } satisfies DependencyImplementation<IdentityService<Model>> & Disposable),
  } as unknown as DependencyImplementations<ServerProvision<Model>>;
}

type CachedIdentitySession<Model extends IdentityModelDefinition> = Readonly<{
  version: 3;
  session?: IdentitySession<Model>;
}>;

function createIdentityClient<Model extends IdentityModelDefinition>(
  connection: ConnectionContext,
  http: HttpClient,
  storage: LocalStore,
  storageKey: string,
  path: string,
  cached: CachedIdentitySession<Model> | undefined,
): IdentityClient<Model> {
  const listeners = new Set<(session: IdentitySession<Model> | undefined) => void>();
  let pendingSession: Promise<IdentitySession<Model> | undefined> | undefined;
  let current = cached?.version === 3 ? cached.session : undefined;
  let restored = cached?.version === 3;
  const publish = async (value: IdentitySession<Model> | undefined) => {
    current = value;
    restored = true;
    await storage.write<CachedIdentitySession<Model>>({
      key: storageKey,
      value: {
        version: 3,
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
    const record = value as IdentitySession<Model>;
    return {
      user: record.user,
      authorization: record.authorization,
    };
  };

  const refresh = () => {
    pendingSession ??= request<IdentitySession<Model> | null>("get-session")
      .then(async (value) => {
        const next = value?.user ? session(value) : undefined;
        const changed = !equalData(current, next);
        if (changed) connection.refresh();
        if (!restored || changed) await publish(next);
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
      await request("sign-in/email", input);
      const next = await refresh();
      if (!next) throw new Error("Authentication succeeded without an application session.");
      return next;
    },
    async signUp(input) {
      await request("sign-up/email", input);
      const next = await refresh();
      if (!next) throw new Error("Registration succeeded without an application session.");
      return next;
    },
    async signOut() {
      await request("sign-out", {});
      if (current !== undefined) connection.refresh();
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
  implementation: IdentityImplementation<Model>,
  input: Readonly<{
    version: Model["Version"];
    user?: AuthenticatedUser;
    authentication?: AuthenticationBackend;
    connection?: ConnectionContext;
    storage?: Map<string, unknown>;
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      service: IdentityService<Model>;
      client: IdentityClient<Model>;
      requests: readonly string[];
      cookie(): string;
    }>
> {
  const [{ startFeatureFixture }, { webProgramLanguageRuntime }, { DatabaseSync }] =
    await Promise.all([
      import("@/execution/process"),
      import("@/platforms/web/adapter/ui/process"),
      import("node:sqlite"),
    ]);
  const name = "identity" as Model["Name"];
  const user = input.user;
  const requests: string[] = [];
  const storage = input.storage ?? new Map<string, unknown>();
  const cookies = new Map<string, string>();
  let routeHandler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
  const authentication: AuthenticationBackend = input.authentication ?? {
    authenticate: async ({ cookie }) =>
      cookie && user ? { session: "fixture-session", user } : undefined,
    handle: async ({ request }) => {
      if (request.path.endsWith("/sign-out")) {
        return {
          ...jsonResponse({}),
          headers: [
            { name: "content-type", value: "application/json" },
            {
              name: "set-cookie",
              value: "kit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            },
          ],
        };
      }
      return user
        ? {
            ...jsonResponse({ user }),
            headers: [
              { name: "content-type", value: "application/json" },
              {
                name: "set-cookie",
                value: "kit_session=fixture; Path=/; HttpOnly; SameSite=Lax",
              },
            ],
          }
        : jsonResponse({ message: "No fixture user is configured." }, 401);
    },
  };
  const credentialImplementation = await credentialProvider.development({
    appName: "Identity fixture",
    configuration: {
      issuer: "identity-fixture",
      revocations: ":memory:",
      ttl: "300000",
      poll: "100",
    },
    origin: "http://localhost",
    allowedOrigins: ["http://localhost"],
    sqlite: (path) => new DatabaseSync(path),
  });
  const credentials = createUncheckedDependencyClient(
    credentialImplementation as never,
  ) as IdentityCredentials;
  const serverProvided = startIdentityServer(
    implementation,
    input.version,
    {
      authentication,
      credentials,
      http: {
        route({ handle }: { handle(request: HttpRequest): Promise<HttpResponse> }) {
          routeHandler = handle;
          return { [Symbol.dispose]: () => (routeHandler = undefined) };
        },
      },
    },
    name,
  );
  const browser = await startFeatureFixture<IdentityFeature<Model>>({
    feature: identity,
    program: "browser",
    language: webProgramLanguageRuntime,
    contributions: [{ feature: "", requires: ["connection", "http", "storage"], provides: [name] }],
    dependencies: {
      connection: input.connection ?? { refresh: () => undefined },
      http: {
        async request({
          path,
          method = "GET",
          body,
          headers: inputHeaders = {},
        }: {
          path: string;
          method?: string;
          body?: string;
          headers?: Readonly<Record<string, string>>;
        }) {
          requests.push(path);
          if (!routeHandler) throw new Error("The Identity fixture route is not mounted.");
          const cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
          const response = await routeHandler({
            method,
            path,
            query: [],
            headers: [
              ...Object.entries(inputHeaders).map(([name, value]) => ({ name, value })),
              ...(cookie ? [{ name: "cookie", value: cookie }] : []),
            ],
            body: body ?? "",
          });
          const headers = new Headers();
          for (const field of response.headers) {
            headers.append(field.name, field.value);
            if (field.name.toLowerCase() === "set-cookie") {
              const [pair] = field.value.split(";", 1);
              const [key, value] = pair!.split("=", 2);
              if (value) cookies.set(key!, value);
              else cookies.delete(key!);
            }
          }
          return new Response(response.body, { status: response.status, headers });
        },
      },
      storage: {
        async read<Value>({ key }: { key: string }) {
          return storage.get(key) as Value | undefined;
        },
        async write<Value>({ key, value }: { key: string; value: Value }) {
          storage.set(key, JSON.parse(JSON.stringify(value)) as Value);
        },
        async remove({ key }: { key: string }) {
          storage.delete(key);
        },
      },
    },
  });
  const serverImplementation = serverProvided[name];
  const browserImplementation = browser.contributions[0]?.provided[name];
  if (
    !serverImplementation ||
    typeof serverImplementation !== "object" ||
    !browserImplementation ||
    typeof browserImplementation !== "object"
  ) {
    await browser.dispose();
    (serverImplementation as Partial<Disposable> | undefined)?.[Symbol.dispose]?.();
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
    cookie: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    async [Symbol.asyncDispose]() {
      await browser.dispose();
      (serverImplementation as Partial<Disposable>)[Symbol.dispose]?.();
      (credentialImplementation as Partial<Disposable>)[Symbol.dispose]?.();
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

function identitySessionResponse<Model extends IdentityModelDefinition>(
  principal: PrincipalOf<Model>,
  claims: ApplicationCredential,
  credential?: string,
): HttpResponse {
  const headers: HttpField[] = [{ name: "content-type", value: "application/json" }];
  if (credential !== undefined) {
    headers.push({
      name: "set-cookie",
      value: `kit_access=${credential}; Path=/; HttpOnly; SameSite=Lax`,
    });
  }
  return {
    status: 200,
    headers,
    body: JSON.stringify({
      user: principal,
      authorization: {
        session: claims.session,
        version: claims.policyVersion,
        expiresAt: claims.expiresAt,
      },
    } satisfies IdentitySession<Model>),
    stream: undefined,
  };
}

function authenticatedIdentityResponse<Model extends IdentityModelDefinition>(
  response: HttpResponse,
  principal: PrincipalOf<Model>,
  claims: ApplicationCredential,
  credential: string,
  sessionBody: boolean,
): HttpResponse {
  const headers = response.headers.slice();
  headers.push({
    name: "set-cookie",
    value: `kit_access=${credential}; Path=/; HttpOnly; SameSite=Lax`,
  });
  return {
    status: response.status,
    headers,
    body: sessionBody
      ? JSON.stringify({
          user: principal,
          authorization: {
            session: claims.session,
            version: claims.policyVersion,
            expiresAt: claims.expiresAt,
          },
        } satisfies IdentitySession<Model>)
      : response.body,
    stream: response.stream,
  };
}

function clearIdentityCredential(response: HttpResponse): HttpResponse {
  const headers = response.headers.slice();
  headers.push({
    name: "set-cookie",
    value: "kit_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  });
  return {
    status: response.status,
    headers,
    body: response.body,
    stream: response.stream,
  };
}

/** Feature-owned password/session realization for the Identity boundary. */
const authenticationProvider: ServerDependencyProvider<AuthenticationBackend> = {
  async development({ configuration, sqlite }) {
    const { randomBytes, randomUUID, scrypt, timingSafeEqual } = await import("node:crypto");
    const path = configuration.database;
    if (!path) throw new Error("The authentication provider requires its database configuration.");
    const database = sqlite(path) as DatabaseSync;
    database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS kit_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS kit_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES kit_users(id) ON DELETE CASCADE
      ) STRICT;
    `);
    const derive = (password: string, salt: string) =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, (error, value) =>
          error ? reject(error) : resolve(Buffer.from(value)),
        );
      });
    const authenticate = ({ cookie }: { cookie?: string }) => {
      const token = authenticationSessionToken(cookie);
      if (!token) return undefined;
      const row = database
        .prepare(
          `SELECT users.id, users.name, users.email
           FROM kit_sessions sessions
           JOIN kit_users users ON users.id = sessions.user_id
           WHERE sessions.token = ?`,
        )
        .get(token) as Readonly<{ id: string; name: string; email: string }> | undefined;
      return row
        ? ({
            session: token,
            user: { id: row.id, name: row.name, email: row.email },
          } satisfies AuthenticatedIdentity)
        : undefined;
    };
    const createSession = (user: AuthenticatedUser): HttpResponse => {
      const token = randomUUID();
      database
        .prepare("INSERT INTO kit_sessions (token, user_id) VALUES (?, ?)")
        .run(token, user.id);
      return authenticationResponse(
        { user },
        200,
        `kit_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
      );
    };
    return Object.freeze({
      authenticate: ({ input }) => Promise.resolve(authenticate(input)),
      async handle({ input: { request, path: mountedPath } }) {
        const endpoint = request.path.startsWith(mountedPath)
          ? request.path.slice(mountedPath.length)
          : request.path;
        if (request.method === "GET" && endpoint === "/get-session") {
          const identity = authenticate({
            cookie: getHttpValue(request.headers, { name: "cookie" }),
          });
          return authenticationResponse(identity ? { user: identity } : null);
        }
        if (request.method === "POST" && endpoint === "/sign-up/email") {
          const input = authenticationBody(request);
          const name = authenticationText(input, "name");
          const email = authenticationText(input, "email").toLowerCase();
          const password = authenticationText(input, "password");
          if (password.length < 8) {
            return authenticationResponse(
              { message: "Password must contain at least eight characters." },
              400,
            );
          }
          const existing = database
            .prepare("SELECT 1 AS present FROM kit_users WHERE email = ?")
            .get(email);
          if (existing) {
            return authenticationResponse(
              { message: "An account with this email already exists." },
              409,
            );
          }
          const id = randomUUID();
          const salt = randomBytes(16).toString("base64url");
          const passwordHash = (await derive(password, salt)).toString("base64url");
          database
            .prepare("INSERT INTO kit_users (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
            .run(id, name, email, `scrypt:${salt}:${passwordHash}`);
          return createSession({ id, name, email });
        }
        if (request.method === "POST" && endpoint === "/sign-in/email") {
          const input = authenticationBody(request);
          const email = authenticationText(input, "email").toLowerCase();
          const password = authenticationText(input, "password");
          const account = database
            .prepare(
              "SELECT id, name, email, password_hash AS passwordHash FROM kit_users WHERE email = ?",
            )
            .get(email) as
            | Readonly<{ id: string; name: string; email: string; passwordHash: string }>
            | undefined;
          const [, salt, expectedValue] = account?.passwordHash.split(":", 3) ?? [];
          const expected = expectedValue ? Buffer.from(expectedValue, "base64url") : undefined;
          const actual = salt ? await derive(password, salt) : undefined;
          if (
            !account ||
            !expected ||
            !actual ||
            expected.length !== actual.length ||
            !timingSafeEqual(expected, actual)
          ) {
            return authenticationResponse({ message: "Invalid email or password." }, 401);
          }
          return createSession({ id: account.id, name: account.name, email: account.email });
        }
        if (request.method === "POST" && endpoint === "/sign-out") {
          const token = authenticationSessionToken(
            getHttpValue(request.headers, { name: "cookie" }),
          );
          if (token) database.prepare("DELETE FROM kit_sessions WHERE token = ?").run(token);
          return authenticationResponse(
            { success: true },
            200,
            "kit_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
          );
        }
        return authenticationResponse({ message: "Not found." }, 404);
      },
    } satisfies DependencyImplementation<AuthenticationBackend>);
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

const DEVELOPMENT_CREDENTIAL_KEYS =
  '{"active":"development-v1","keys":{"development-v1":{"private":"IrN_xGKrVI3ttDf2_D9Rf1ioUdndKNPE_KAA8gIeTZg","public":"YQ8QXvJLJT0mLLUsOe0dsHLOZa2FPffzTtcoTUzoyvA"}}}';

/** Feature-owned signed application-credential realization. */
const credentialProvider: ServerDependencyProvider<IdentityCredentials> = {
  async development({ appName, configuration, sqlite }) {
    const {
      createPrivateKey,
      createPublicKey,
      randomUUID,
      sign: signValue,
      verify: verifyValue,
    } = await import("node:crypto");
    const issuer = configuration.issuer ?? appName;
    const keyRing = parseCredentialKeyRing(configuration.keys ?? DEVELOPMENT_CREDENTIAL_KEYS);
    const ttl = credentialTtl(configuration.ttl);
    const signing = keyRing.keys[keyRing.active]!;
    if (!signing.private) {
      throw new TypeError("The active Identity credential key requires private key material.");
    }
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(signing.private, "base64url"),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const publicKeys = new Map(
      Object.entries(keyRing.keys).map(([id, key]) => [
        id,
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(key.public, "base64url"),
          ]),
          format: "der",
          type: "spki",
        }),
      ]),
    );
    const revocationDatabase = sqlite(configuration.revocations ?? ":memory:") as DatabaseSync;
    revocationDatabase.exec(`
      CREATE TABLE IF NOT EXISTS kit_identity_revocations (
        token TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      ) STRICT
    `);
    const revoked = new Map<string, number>();
    const refreshRevocations = () => {
      const now = Date.now();
      revocationDatabase
        .prepare("DELETE FROM kit_identity_revocations WHERE expires_at <= ?")
        .run(now);
      const rows = revocationDatabase
        .prepare("SELECT token, expires_at FROM kit_identity_revocations WHERE expires_at > ?")
        .all(now) as unknown as readonly Readonly<{ token: string; expires_at: number }>[];
      revoked.clear();
      for (const row of rows) revoked.set(row.token, row.expires_at);
    };
    refreshRevocations();
    const poll = setInterval(refreshRevocations, credentialRevocationPoll(configuration.poll));
    poll.unref();

    const issue = (input: {
      audience: string;
      policyVersion: number;
      principal: object;
      session: string;
      subject: string;
    }): IssuedApplicationCredential => {
      const now = Math.floor(Date.now() / 1000) * 1000;
      const expiresAt = now + ttl;
      const token = randomUUID();
      const payload = {
        iss: issuer,
        sub: input.subject,
        aud: input.audience,
        iat: Math.floor(now / 1000),
        exp: Math.floor(expiresAt / 1000),
        jti: token,
        sid: input.session,
        pv: input.policyVersion,
        principal: input.principal,
      };
      const header = encodeCredentialPart({
        alg: "EdDSA",
        typ: "at+jwt",
        kid: keyRing.active,
      });
      const body = encodeCredentialPart(payload);
      const unsigned = `${header}.${body}`;
      const claims: ApplicationCredential = {
        audience: input.audience,
        expiresAt,
        issuedAt: now,
        issuer,
        policyVersion: input.policyVersion,
        principal: input.principal,
        session: input.session,
        subject: input.subject,
        token,
      };
      return {
        credential: `${unsigned}.${signValue(null, Buffer.from(unsigned), privateKey).toString(
          "base64url",
        )}`,
        claims,
      };
    };
    const verify = (audience: string, received: string): ApplicationCredential | undefined => {
      const credential = applicationAccessToken(received);
      if (!credential) return undefined;
      const [headerPart, payloadPart, signature, extra] = credential.split(".");
      if (!headerPart || !payloadPart || !signature || extra !== undefined) return undefined;
      const header = decodeCredentialPart(headerPart);
      if (header.alg !== "EdDSA" || header.typ !== "at+jwt" || typeof header.kid !== "string") {
        return undefined;
      }
      const publicKey = publicKeys.get(header.kid);
      if (!publicKey) return undefined;
      const unsigned = `${headerPart}.${payloadPart}`;
      if (
        !verifyValue(null, Buffer.from(unsigned), publicKey, Buffer.from(signature, "base64url"))
      ) {
        return undefined;
      }
      const payload = decodeCredentialPart(payloadPart);
      if (
        payload.iss !== issuer ||
        payload.aud !== audience ||
        typeof payload.sub !== "string" ||
        typeof payload.sid !== "string" ||
        typeof payload.jti !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        typeof payload.pv !== "number" ||
        !Number.isSafeInteger(payload.pv) ||
        !payload.principal ||
        typeof payload.principal !== "object"
      ) {
        return undefined;
      }
      const now = Date.now();
      const issuedAt = payload.iat * 1000;
      const expiresAt = payload.exp * 1000;
      if (issuedAt > now + 30_000 || expiresAt <= now || revoked.has(payload.jti)) {
        return undefined;
      }
      return {
        audience,
        expiresAt,
        issuedAt,
        issuer,
        policyVersion: payload.pv,
        principal: payload.principal,
        session: payload.sid,
        subject: payload.sub,
        token: payload.jti,
      };
    };
    const revoke = (input: { expiresAt: number; token: string }) => {
      if (input.expiresAt <= Date.now()) return;
      revocationDatabase
        .prepare(
          `INSERT INTO kit_identity_revocations (token, expires_at)
           VALUES (?, ?)
           ON CONFLICT(token) DO UPDATE SET expires_at = MAX(expires_at, excluded.expires_at)`,
        )
        .run(input.token, input.expiresAt);
      revoked.set(input.token, input.expiresAt);
    };
    return Object.freeze({
      async issue({ input }) {
        return issue(input);
      },
      async verify({ input }) {
        return verify(input.audience, input.credential);
      },
      async refresh({ input }) {
        const claims = verify(input.audience, input.credential);
        if (
          !claims ||
          claims.policyVersion !== input.policyVersion ||
          claims.expiresAt - Date.now() > input.expiresWithin
        ) {
          return undefined;
        }
        const refreshed = issue({
          audience: claims.audience,
          policyVersion: claims.policyVersion,
          principal: claims.principal,
          session: claims.session,
          subject: claims.subject,
        });
        revoke({ token: claims.token, expiresAt: claims.expiresAt });
        return refreshed;
      },
      async revoke({ input }) {
        revoke(input);
      },
      [Symbol.dispose]() {
        clearInterval(poll);
      },
    } satisfies DependencyImplementation<IdentityCredentials> & Disposable);
  },
  production: {
    configuration: [
      {
        name: "issuer",
        environment: "KIT_IDENTITY_ISSUER",
        default: "kit",
      },
      {
        name: "keys",
        environment: "KIT_IDENTITY_KEYS",
        default: DEVELOPMENT_CREDENTIAL_KEYS,
        sensitive: true,
      },
      {
        name: "revocations",
        environment: "KIT_IDENTITY_REVOCATIONS",
        default: ".kit/data/identity-revocations.sqlite",
        allocation: {
          kind: "storage",
          name: "identity-revocations.sqlite",
          scope: "deployment",
          type: "file",
        },
      },
      {
        name: "ttl",
        environment: "KIT_IDENTITY_TTL",
        default: "300000",
      },
      {
        name: "poll",
        environment: "KIT_IDENTITY_REVOCATION_POLL",
        default: "100",
      },
    ],
    crate: {
      package: "kit-server-authentication",
      directory: "./providers/server/rust",
    },
    rust: {
      type: "kit_server_authentication::Credentials",
      constructor: "kit_server_authentication::create_credentials",
    },
  },
};

type CredentialKeyRing = Readonly<{
  active: string;
  keys: Readonly<
    Record<
      string,
      Readonly<{
        private?: string;
        public: string;
      }>
    >
  >;
}>;

function parseCredentialKeyRing(value: string): CredentialKeyRing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Identity credential keys must be valid JSON.");
  }
  const candidate = parsed as Partial<CredentialKeyRing>;
  if (
    typeof candidate.active !== "string" ||
    candidate.active.length === 0 ||
    !candidate.keys ||
    typeof candidate.keys !== "object"
  ) {
    throw new TypeError("Identity credential keys require an active version and key map.");
  }
  const keys: Record<string, { private?: string; public: string }> = {};
  for (const [id, key] of Object.entries(candidate.keys)) {
    if (
      !key ||
      typeof key !== "object" ||
      typeof key.public !== "string" ||
      Buffer.from(key.public, "base64url").byteLength !== 32 ||
      (key.private !== undefined &&
        (typeof key.private !== "string" ||
          Buffer.from(key.private, "base64url").byteLength !== 32))
    ) {
      throw new TypeError(`Identity credential key ${JSON.stringify(id)} is invalid.`);
    }
    keys[id] = {
      public: key.public,
      ...(key.private === undefined ? {} : { private: key.private }),
    };
  }
  if (!keys[candidate.active]) {
    throw new TypeError("The active Identity credential key is not present in the key map.");
  }
  return { active: candidate.active, keys };
}

function credentialTtl(value: string | undefined): number {
  const ttl = Number(value ?? 300_000);
  if (!Number.isSafeInteger(ttl) || ttl < 30_000 || ttl > 3_600_000) {
    throw new TypeError("Identity credential TTL must be between 30 seconds and one hour.");
  }
  return ttl;
}

function credentialRevocationPoll(value: string | undefined): number {
  const interval = Number(value ?? 100);
  if (!Number.isSafeInteger(interval) || interval < 10 || interval > 60_000) {
    throw new TypeError("Identity revocation polling must be between 10ms and one minute.");
  }
  return interval;
}

function encodeCredentialPart(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCredentialPart(value: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    return decoded && typeof decoded === "object"
      ? (decoded as Record<string, unknown>)
      : Object.create(null);
  } catch {
    return Object.create(null);
  }
}

function applicationAccessToken(value: string): string | undefined {
  if (!value.includes("=")) return value || undefined;
  for (const field of value.split(";")) {
    const [name, token] = field.trim().split("=", 2);
    if (name === "kit_access" && token) return token;
  }
  return undefined;
}

function authenticationResponse(value: unknown, status = 200, cookie?: string): HttpResponse {
  const headers: HttpField[] = [{ name: "content-type", value: "application/json" }];
  if (cookie) headers.push({ name: "set-cookie", value: cookie });
  return {
    status,
    headers,
    body: JSON.stringify(value),
    stream: undefined,
  };
}

function authenticationBody(request: HttpRequest): Record<string, unknown> {
  const value = JSON.parse(request.body || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Authentication request body must be a record.");
  }
  return value as Record<string, unknown>;
}

function authenticationText(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== "string" || !field) {
    throw new TypeError(`Authentication ${name} is required.`);
  }
  return field;
}

function authenticationSessionToken(cookie: string | undefined): string | undefined {
  for (const field of cookie?.split(";") ?? []) {
    const [name, token] = field.trim().split("=", 2);
    if (name === "kit_session" && token) return token;
  }
  return undefined;
}
