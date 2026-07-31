import { expect } from "vitest";

import type { AuthenticationBackend, IdentityCredentials } from "@/features/identity";
import { defineDependencyConformance } from "@/testing/dependency";

/** The semantic suite every AuthenticationBackend provider must pass. */
export const authenticationConformance = defineDependencyConformance<AuthenticationBackend>({
  name: "AuthenticationBackend",
  scenarios: [
    {
      name: "signs up, authenticates, rejects invalid credentials, and revokes sessions",
      async verify({ api }) {
        const signUp = await api.handle({
          path: "/auth",
          request: request("/auth/sign-up/email", {
            name: "Ada",
            email: "ADA@example.com",
            password: "correct horse",
          }),
        });
        expect(signUp.status).toBe(200);
        const cookie = header(signUp.headers, "set-cookie");
        expect(cookie).toBeDefined();

        await expect(api.authenticate({ cookie })).resolves.toMatchObject({
          session: expect.any(String),
          user: {
            name: "Ada",
            email: "ada@example.com",
          },
        });

        const invalid = await api.handle({
          path: "/auth",
          request: request("/auth/sign-in/email", {
            email: "ada@example.com",
            password: "incorrect",
          }),
        });
        expect(invalid.status).toBe(401);

        const signOut = await api.handle({
          path: "/auth",
          request: request("/auth/sign-out", {}, cookie),
        });
        expect(signOut.status).toBe(200);
        await expect(api.authenticate({ cookie })).resolves.toBeUndefined();
      },
    },
  ],
});

/** The semantic suite every signed application-credential provider must pass. */
export const identityCredentialsConformance = defineDependencyConformance<IdentityCredentials>({
  name: "IdentityCredentials",
  scenarios: [
    {
      name: "issues, locally verifies, scopes, rejects tampering, and revokes credentials",
      async verify({ api }) {
        const issued = await api.issue({
          audience: "customer",
          policyVersion: 7,
          principal: { id: "ada", role: "operator" },
          session: "session-1",
          subject: "ada",
        });
        expect(issued.credential.split(".")).toHaveLength(3);
        expect(
          JSON.parse(Buffer.from(issued.credential.split(".")[0]!, "base64url").toString("utf8")),
        ).toEqual({
          alg: "EdDSA",
          typ: "at+jwt",
          kid: "conformance-v1",
        });
        await expect(
          api.verify({ audience: "customer", credential: issued.credential }),
        ).resolves.toMatchObject({
          audience: "customer",
          issuer: "identity-conformance",
          policyVersion: 7,
          principal: { id: "ada", role: "operator" },
          session: "session-1",
          subject: "ada",
          token: expect.any(String),
        });
        await expect(
          api.verify({
            audience: "customer",
            credential: `kit_session=external; kit_access=${issued.credential}`,
          }),
        ).resolves.toMatchObject({ subject: "ada" });
        await expect(
          api.verify({ audience: "operations", credential: issued.credential }),
        ).resolves.toBeUndefined();
        const segments = issued.credential.split(".");
        const signature = segments[2]!;
        const forged = [
          segments[0],
          segments[1],
          `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`,
        ].join(".");
        await expect(
          api.verify({ audience: "customer", credential: forged }),
        ).resolves.toBeUndefined();

        await expect(
          api.refresh({
            audience: "customer",
            credential: issued.credential,
            expiresWithin: Number.MAX_SAFE_INTEGER,
            policyVersion: 8,
          }),
        ).resolves.toBeUndefined();
        const refreshed = await api.refresh({
          audience: "customer",
          credential: issued.credential,
          expiresWithin: Number.MAX_SAFE_INTEGER,
          policyVersion: 7,
        });
        expect(refreshed?.credential).not.toBe(issued.credential);
        await expect(
          api.verify({ audience: "customer", credential: issued.credential }),
        ).resolves.toBeUndefined();
        await expect(
          api.verify({ audience: "customer", credential: refreshed!.credential }),
        ).resolves.toMatchObject({
          policyVersion: 7,
          subject: "ada",
          token: expect.not.stringMatching(issued.claims.token),
        });

        await api.revoke({
          token: refreshed!.claims.token,
          expiresAt: refreshed!.claims.expiresAt,
        });
        await expect(
          api.verify({ audience: "customer", credential: refreshed!.credential }),
        ).resolves.toBeUndefined();
      },
    },
  ],
});

function request(path: string, value: object, cookie?: string) {
  return {
    method: "POST",
    path,
    query: [],
    headers: [
      { name: "content-type", value: "application/json" },
      ...(cookie ? [{ name: "cookie", value: cookie }] : []),
    ],
    body: JSON.stringify(value),
  };
}

function header(
  fields: readonly Readonly<{ name: string; value: string }>[],
  name: string,
): string | undefined {
  return fields.find((field) => field.name.toLowerCase() === name)?.value;
}
