import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createNodeHost } from "@/adapters/server/host";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("server Platform host", () => {
  test("allocates only the Capabilities required by one Program instance", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-host-"));
    directories.push(directory);

    const empty = await createNodeHost({ capabilities: [], directory });
    expect(empty).toEqual({});
    await expect(access(resolve(directory, ".data"))).rejects.toHaveProperty("code", "ENOENT");

    const utilities = await createNodeHost({
      capabilities: ["clock", "identifiers"],
      directory,
    });
    expect(Object.keys(utilities).sort()).toEqual(["clock", "identifiers"]);
    expect(typeof utilities.clock.now()).toBe("number");
    expect(utilities.identifiers.create()).toMatch(/^[0-9a-f-]{36}$/);
    await expect(access(resolve(directory, ".data"))).rejects.toHaveProperty("code", "ENOENT");
  });

  test("rejects requirements the Platform cannot supply", async () => {
    await expect(createNodeHost({ capabilities: ["unknown"] })).rejects.toThrow(
      'Server Platform does not implement host Capability "unknown".',
    );
  });

  test("allows browser command identity headers across the development origin", async () => {
    const port = await availablePort();
    const host = await createNodeHost({
      capabilities: ["http"] as const,
      host: "127.0.0.1",
      port,
      webOrigin: "http://localhost:3000",
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-headers": "content-type,x-poggers-command,x-poggers-entity",
        "access-control-request-method": "POST",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("x-poggers-command");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-poggers-entity");
    await host.http[Symbol.asyncDispose]();
  });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate a test port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
