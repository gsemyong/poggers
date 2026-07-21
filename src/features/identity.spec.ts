import { describe, expect, test } from "vitest";

import type { Application } from "@/core/application";
import type { ProgramManifest } from "@/core/capability";
import { startProcess } from "@/core/process";
import {
  createIdentity,
  type AuthenticationBackend,
  type IdentityClient,
  type IdentityFeature,
  type IdentityModel,
  type IdentityService,
} from "@/features/identity";

type Users = IdentityModel<{
  Name: "identity";
  Principal: Readonly<{ id: string; role: "member" }>;
}>;

const identity = createIdentity<Users>({
  name: "identity",
  principal: ({ id }) => ({ id, role: "member" }),
});

type Identity = IdentityFeature<Users>;
type TestApplication = Readonly<{ Features: { identity: Identity } }>;
const application: Application<TestApplication> = { features: { identity } };

describe("semantic identity Feature", () => {
  test("provides server identity through the host authentication boundary", async () => {
    const authentication: AuthenticationBackend = {
      authenticate: async ({ cookie }) =>
        cookie ? { id: cookie, name: "Alice", email: "alice@example.com" } : undefined,
      handle: async () => new Response(),
    };
    const process = await startProcess(
      application,
      "server",
      {
        authentication,
        http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
      },
      manifest("server", ["authentication", "http"]),
    );
    const service = process.capabilities.identity as IdentityService<Users>;

    await expect(
      service.authenticate({
        request: new Request("http://test.local", { headers: { cookie: "alice" } }),
      }),
    ).resolves.toEqual({ id: "alice", role: "member" });
    await expect(
      service.authenticate({ request: new Request("http://test.local") }),
    ).resolves.toBeUndefined();
    await process.dispose();
  });

  test("derives the browser identity API and protocol from the same model", async () => {
    const requests: string[] = [];
    const process = await startProcess(
      application,
      "browser",
      {
        http: {
          request({ path }: { path: string }) {
            requests.push(path);
            return Promise.resolve(
              Response.json({ user: { id: "alice", name: "Alice", email: "alice@example.com" } }),
            );
          },
        },
      },
      manifest("browser", ["http"]),
    );
    const client = process.capabilities.identity as IdentityClient<Users>;
    const sessions: Array<Readonly<{ user: Users["Principal"] }> | undefined> = [];
    const subscription = client.subscribe((session) => sessions.push(session));

    await expect(
      client.signIn({ email: "alice@example.com", password: "secret" }),
    ).resolves.toEqual({ user: { id: "alice", role: "member" } });
    expect(sessions).toEqual([{ user: { id: "alice", role: "member" } }]);
    expect(requests).toEqual(["/api/identity/sign-in/email"]);
    subscription[Symbol.dispose]();
    await process.dispose();
  });
});

function manifest(name: string, requires: readonly string[]): ProgramManifest {
  return {
    name,
    contributions: [{ feature: "identity", requires, provides: ["identity"] }],
  };
}
