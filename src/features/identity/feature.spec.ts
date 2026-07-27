import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import {
  createIdentity,
  createIdentityFixture,
  type AuthenticationBackend,
  type IdentityModel,
} from "@/features/identity";
import { authenticationConformance } from "@/features/identity/testing";
import { rustServerDependencyTarget } from "@/platforms/server/adapter/rust/testing";
import { dependencyImplementationTarget } from "@/testing/dependency";

type Users = IdentityModel<{
  Name: "identity";
  Principal: Readonly<{ id: string; role: "member" }>;
}>;

const identity = createIdentity<Users>({
  principal: ({ id }) => ({ id, role: "member" }),
});

authenticationConformance.test(
  dependencyImplementationTarget("Better Auth TypeScript", () =>
    identity.providers!.server.authentication.development({
      appName: "Identity conformance",
      configuration: { database: ":memory:", secret: "identity-conformance-secret" },
      origin: "http://localhost",
      allowedOrigins: ["http://localhost"],
      sqlite: (path) => new DatabaseSync(path),
    }),
  ),
);

authenticationConformance.test(
  rustServerDependencyTarget({
    name: "Authentication Rust",
    provider: {
      name: "authentication",
      dependency: "authentication",
      ...identity.providers!.server.authentication.production,
      crate: {
        ...identity.providers!.server.authentication.production.crate,
        directory: resolve(import.meta.dirname, "providers/server/rust"),
      },
    },
    async configuration() {
      const directory = await mkdtemp(resolve(tmpdir(), "identity-conformance-"));
      return {
        values: {
          database: resolve(directory, "identity.sqlite"),
          secret: "identity-conformance-secret",
        },
        dispose: () => rm(directory, { force: true, recursive: true }),
      };
    },
  }),
);

describe("semantic identity Feature", () => {
  test("provides server identity through the host authentication boundary", async () => {
    const authentication: AuthenticationBackend = {
      authenticate: async ({ cookie }) =>
        cookie ? { id: cookie, name: "Alice", email: "alice@example.com" } : undefined,
      handle: async () => ({ status: 204, headers: [], body: undefined, stream: undefined }),
    };
    await using fixture = await createIdentityFixture(identity, { authentication });

    await expect(fixture.service.authenticate({ cookie: "alice" })).resolves.toEqual({
      id: "alice",
      role: "member",
    });
    await expect(fixture.service.authenticate({ cookie: undefined })).resolves.toBeUndefined();
  });

  test("derives the browser identity API and protocol from the same model", async () => {
    await using fixture = await createIdentityFixture(identity, {
      user: { id: "alice", name: "Alice", email: "alice@example.com" },
    });
    const sessions: Array<Readonly<{ user: Users["Principal"] }> | undefined> = [];
    const subscription = fixture.client.subscribe((session) => sessions.push(session));

    await expect(
      fixture.client.signIn({ email: "alice@example.com", password: "secret" }),
    ).resolves.toEqual({ user: { id: "alice", role: "member" } });
    expect(sessions).toEqual([{ user: { id: "alice", role: "member" } }]);
    expect(fixture.requests).toEqual(["/api/identity/sign-in/email"]);
    subscription[Symbol.dispose]();
  });

  test("coalesces concurrent initial session reads across composed Features", async () => {
    let requests = 0;
    await using fixture = await createIdentityFixture(identity, {
      authentication: {
        authenticate: async () => undefined,
        async handle() {
          requests += 1;
          await Promise.resolve();
          return {
            status: 200,
            headers: [{ name: "content-type", value: "application/json" }],
            body: JSON.stringify({
              user: { id: "alice", name: "Alice", email: "alice@example.com" },
            }),
            stream: undefined,
          };
        },
      },
    });

    await expect(
      Promise.all([fixture.client.session(), fixture.client.session()]),
    ).resolves.toEqual([
      { user: { id: "alice", role: "member" } },
      { user: { id: "alice", role: "member" } },
    ]);
    expect(requests).toBe(1);
  });
});
