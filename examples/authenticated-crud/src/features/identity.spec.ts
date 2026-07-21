import { startProcess, type Application, type ProgramManifest } from "@poggers/kit";
import { describe, expect, test } from "vitest";

import { identity, type AuthenticationServer, type IdentityFeature } from "./identity";

describe("identity Feature", () => {
  test("provides semantic identity through the authentication Capability", async () => {
    const authentication: AuthenticationServer = {
      authenticate: async ({ credentials }) =>
        credentials.cookie
          ? { id: credentials.cookie, name: "Alice", email: "alice@example.com" }
          : undefined,
      handle: async () => new Response(),
    };
    type TestApp = Readonly<{ Features: { identity: IdentityFeature } }>;
    const application: Application<TestApp> = { features: { identity } };
    const manifest: ProgramManifest = {
      name: "server",
      contributions: [
        {
          feature: "identity",
          requires: ["authentication"],
          provides: ["identity"],
        },
      ],
    };
    const process = await startProcess(application, "server", { authentication }, manifest);
    const service = process.capabilities.identity as {
      authenticate(input: { credentials: { cookie?: string } }): Promise<unknown>;
    };

    await expect(service.authenticate({ credentials: { cookie: "alice" } })).resolves.toMatchObject(
      { id: "alice" },
    );
    await expect(service.authenticate({ credentials: {} })).resolves.toBeUndefined();
    await process.dispose();
  });
});
