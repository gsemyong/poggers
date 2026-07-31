import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test, vi } from "vitest";

import { createUncheckedDependencyClient } from "@/core/dependency";
import {
  createIdentity,
  createIdentityFixture,
  type IdentityCredentials,
  type IdentityModel,
} from "@/features/identity";
import {
  authenticationConformance,
  identityCredentialsConformance,
} from "@/features/identity/testing";
import { rustServerDependencyTarget } from "@/platforms/server/adapter/rust/testing";
import { dependencyImplementationTarget } from "@/testing/dependency";

type Users = IdentityModel<{
  Name: "identity";
  Version: 1;
  Principal: Readonly<{ id: string; role: "member" }>;
}>;

const identityImplementation = {
  principal: ({ id }) => ({ id, role: "member" }),
} satisfies Parameters<typeof createIdentity<Users>>[0];

const identity = createIdentity<Users>(identityImplementation);

const credentialKeys = JSON.stringify({
  active: "conformance-v1",
  keys: {
    "conformance-v1": {
      private: "RTwmyUmBkWd3sYLtCgRNYzd5Zle67bS-iP0gshLFMxo",
      public: "naiNPgeB4ao4f2C6uxiYNMyq7c77N35wST2IivKz22c",
    },
  },
});

const rotatedCredentialKeys = JSON.stringify({
  active: "conformance-v2",
  keys: {
    "conformance-v1": {
      public: "naiNPgeB4ao4f2C6uxiYNMyq7c77N35wST2IivKz22c",
    },
    "conformance-v2": {
      private: "Ry_e8Z9RlFXeQJR6Q36iwbqhmaPw9lD7z7Y5Z2tfkJA",
      public: "I6GRQtkmbGgpxOkDYaFvYPh9HAUO5zH69xMK8Hdk_iI",
    },
  },
});

const currentCredentialKeys = JSON.stringify({
  active: "conformance-v2",
  keys: {
    "conformance-v2": {
      private: "Ry_e8Z9RlFXeQJR6Q36iwbqhmaPw9lD7z7Y5Z2tfkJA",
      public: "I6GRQtkmbGgpxOkDYaFvYPh9HAUO5zH69xMK8Hdk_iI",
    },
  },
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

identityCredentialsConformance.test(
  dependencyImplementationTarget("Identity credentials TypeScript", () =>
    identity.providers!.server.credentials.development({
      appName: "Identity conformance",
      configuration: {
        issuer: "identity-conformance",
        keys: credentialKeys,
        revocations: ":memory:",
        ttl: "300000",
        poll: "25",
      },
      origin: "http://localhost",
      allowedOrigins: ["http://localhost"],
      sqlite: () => new DatabaseSync(":memory:"),
    }),
  ),
);

identityCredentialsConformance.test(
  rustServerDependencyTarget({
    name: "Identity credentials Rust",
    provider: {
      name: "credentials",
      dependency: "credentials",
      ...identity.providers!.server.credentials.production,
      crate: {
        ...identity.providers!.server.credentials.production.crate,
        directory: resolve(import.meta.dirname, "providers/server/rust"),
      },
    },
    async configuration() {
      return {
        values: {
          issuer: "identity-conformance",
          keys: credentialKeys,
          revocations: ":memory:",
          ttl: "300000",
          poll: "25",
        },
        dispose: () => undefined,
      };
    },
  }),
);

describe("semantic identity Feature", () => {
  test("rotates asymmetric keys and propagates revocation across verifier nodes", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "identity-rotation-"));
    const revocations = resolve(directory, "revocations.sqlite");
    const provider = identity.providers!.server.credentials;
    const create = async (keys: string) => {
      const implementation = await provider.development({
        appName: "Identity rotation",
        configuration: {
          issuer: "identity-rotation",
          keys,
          revocations,
          ttl: "300000",
          poll: "10",
        },
        origin: "http://localhost",
        allowedOrigins: ["http://localhost"],
        sqlite: (path) => new DatabaseSync(path),
      });
      return {
        implementation,
        api: createUncheckedDependencyClient(implementation as never) as IdentityCredentials,
      };
    };

    const old = await create(credentialKeys);
    const rotating = await create(rotatedCredentialKeys);
    const current = await create(currentCredentialKeys);
    try {
      const oldCredential = await old.api.issue({
        audience: "customer",
        policyVersion: 1,
        principal: { id: "ada" },
        session: "session",
        subject: "ada",
      });
      await expect(
        rotating.api.verify({
          audience: "customer",
          credential: oldCredential.credential,
        }),
      ).resolves.toMatchObject({ subject: "ada" });
      await expect(
        current.api.verify({
          audience: "customer",
          credential: oldCredential.credential,
        }),
      ).resolves.toBeUndefined();

      const newCredential = await rotating.api.issue({
        audience: "customer",
        policyVersion: 1,
        principal: { id: "ada" },
        session: "session",
        subject: "ada",
      });
      await expect(
        old.api.verify({
          audience: "customer",
          credential: newCredential.credential,
        }),
      ).resolves.toBeUndefined();
      await expect(
        current.api.verify({
          audience: "customer",
          credential: newCredential.credential,
        }),
      ).resolves.toMatchObject({ subject: "ada" });

      await rotating.api.revoke({
        token: newCredential.claims.token,
        expiresAt: newCredential.claims.expiresAt,
      });
      await expect
        .poll(() =>
          current.api.verify({
            audience: "customer",
            credential: newCredential.credential,
          }),
        )
        .toBeUndefined();
    } finally {
      (old.implementation as Partial<Disposable>)[Symbol.dispose]?.();
      (rotating.implementation as Partial<Disposable>)[Symbol.dispose]?.();
      (current.implementation as Partial<Disposable>)[Symbol.dispose]?.();
      await rm(directory, { force: true, recursive: true });
    }
  });

  test(
    "verifies locally and propagates revocation across generated-Rust provider processes",
    { tags: ["provider"], timeout: 240_000 },
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "identity-rust-replicas-"));
      const revocations = resolve(directory, "revocations.sqlite");
      const target = rustServerDependencyTarget<IdentityCredentials>({
        name: "Identity credential replica",
        provider: {
          name: "credentials",
          dependency: "credentials",
          ...identity.providers!.server.credentials.production,
          crate: {
            ...identity.providers!.server.credentials.production.crate,
            directory: resolve(import.meta.dirname, "providers/server/rust"),
          },
        },
        configuration() {
          return {
            values: {
              issuer: "identity-replicas",
              keys: credentialKeys,
              revocations,
              ttl: "300000",
              poll: "10",
            },
          };
        },
      });
      const first = await target.create();
      const second = await target.create();
      try {
        const issued = await first.api.issue({
          audience: "customer",
          policyVersion: 1,
          principal: { id: "ada" },
          session: "session",
          subject: "ada",
        });
        await expect(
          second.api.verify({
            audience: "customer",
            credential: issued.credential,
          }),
        ).resolves.toMatchObject({ subject: "ada" });

        await first.api.revoke({
          token: issued.claims.token,
          expiresAt: issued.claims.expiresAt,
        });
        await expect
          .poll(() =>
            second.api.verify({
              audience: "customer",
              credential: issued.credential,
            }),
          )
          .toBeUndefined();
      } finally {
        await first.dispose();
        await second.dispose();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  test("provides server identity through a locally verified application credential", async () => {
    await using fixture = await createIdentityFixture(identity, identityImplementation, {
      version: 1,
      user: { id: "alice", name: "Alice", email: "alice@example.com" },
    });

    await fixture.client.signIn({ email: "alice@example.com", password: "secret" });
    await expect(fixture.service.authenticate({ cookie: fixture.cookie() })).resolves.toEqual({
      id: "alice",
      role: "member",
    });
    await expect(fixture.service.authenticate({ cookie: undefined })).resolves.toBeUndefined();
  });

  test("derives the browser identity API and protocol from the same model", async () => {
    const refresh = vi.fn();
    await using fixture = await createIdentityFixture(identity, identityImplementation, {
      version: 1,
      connection: { refresh },
      user: { id: "alice", name: "Alice", email: "alice@example.com" },
    });
    const sessions: Array<
      | Readonly<{
          user: Users["Principal"];
          authorization: Readonly<{ session: string; version: number; expiresAt: number }>;
        }>
      | undefined
    > = [];
    const subscription = fixture.client.subscribe((session) => sessions.push(session));

    await expect(
      fixture.client.signIn({ email: "alice@example.com", password: "secret" }),
    ).resolves.toEqual({
      user: { id: "alice", role: "member" },
      authorization: {
        session: "fixture-session",
        version: 1,
        expiresAt: expect.any(Number),
      },
    });
    expect(sessions).toEqual([
      {
        user: { id: "alice", role: "member" },
        authorization: {
          session: "fixture-session",
          version: 1,
          expiresAt: expect.any(Number),
        },
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(fixture.requests).toEqual(["/api/identity/sign-in/email", "/api/identity/get-session"]);
    await expect(fixture.client.session()).resolves.toMatchObject({
      user: { id: "alice", role: "member" },
    });
    await expect.poll(() => fixture.requests).toHaveLength(3);
    expect(refresh).toHaveBeenCalledOnce();
    subscription[Symbol.dispose]();
  });

  test("coalesces concurrent initial session reads across composed Features", async () => {
    let requests = 0;
    await using fixture = await createIdentityFixture(identity, identityImplementation, {
      version: 1,
      authentication: {
        async authenticate() {
          requests += 1;
          await Promise.resolve();
          return {
            session: "session",
            user: { id: "alice", name: "Alice", email: "alice@example.com" },
          };
        },
        async handle() {
          throw new Error("Initial session lookup must not invoke an authentication endpoint.");
        },
      },
    });

    await expect(
      Promise.all([fixture.client.session(), fixture.client.session()]),
    ).resolves.toEqual([
      {
        user: { id: "alice", role: "member" },
        authorization: {
          session: "session",
          version: 1,
          expiresAt: expect.any(Number),
        },
      },
      {
        user: { id: "alice", role: "member" },
        authorization: {
          session: "session",
          version: 1,
          expiresAt: expect.any(Number),
        },
      },
    ]);
    expect(requests).toBe(1);
  });

  test("restores a cached principal before background authority revalidation", async () => {
    const storage = new Map<string, unknown>();
    {
      await using fixture = await createIdentityFixture(identity, identityImplementation, {
        version: 1,
        user: { id: "alice", name: "Alice", email: "alice@example.com" },
        storage,
      });
      await fixture.client.signIn({ email: "alice@example.com", password: "secret" });
    }

    let requests = 0;
    await using restored = await createIdentityFixture(identity, identityImplementation, {
      version: 1,
      storage,
      authentication: {
        async authenticate() {
          requests += 1;
          throw new Error("Authority is temporarily unavailable.");
        },
        async handle() {
          throw new Error("No authentication endpoint should be invoked.");
        },
      },
    });

    expect(restored.client.current()).toEqual({
      user: { id: "alice", role: "member" },
      authorization: {
        session: "fixture-session",
        version: 1,
        expiresAt: expect.any(Number),
      },
    });
    await expect(restored.client.session()).resolves.toEqual({
      user: { id: "alice", role: "member" },
      authorization: {
        session: "fixture-session",
        version: 1,
        expiresAt: expect.any(Number),
      },
    });
    await expect.poll(() => requests).toBe(1);
  });

  test("refreshes persistent transports when cached authority changes", async () => {
    const storage = new Map<string, unknown>();
    {
      await using fixture = await createIdentityFixture(identity, identityImplementation, {
        version: 1,
        user: { id: "alice", name: "Alice", email: "alice@example.com" },
        storage,
      });
      await fixture.client.signIn({ email: "alice@example.com", password: "secret" });
    }

    const refresh = vi.fn();
    await using restored = await createIdentityFixture(identity, identityImplementation, {
      version: 1,
      connection: { refresh },
      storage,
      user: { id: "alice", name: "Alice", email: "alice@example.com" },
    });

    await expect(restored.client.session()).resolves.toMatchObject({
      user: { id: "alice", role: "member" },
    });
    await expect.poll(() => refresh).toHaveBeenCalledOnce();
  });
});
