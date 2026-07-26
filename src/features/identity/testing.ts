import { expect } from "vitest";

import type { AuthenticationBackend } from "@/features/identity";
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
          name: "Ada",
          email: "ada@example.com",
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
