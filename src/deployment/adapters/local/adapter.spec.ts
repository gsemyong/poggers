import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";

import type { System } from "@/core/system";
import {
  applyDeployment,
  createDeployment,
  planDeployment,
  removeDeployment,
  type DeploymentProcessState,
  type Release,
} from "@/deployment";
import { createLocalDeploymentAdapter } from "@/deployment/adapters/local";
import type { ServerPlatform } from "@/platforms/server";
import type { WebPlatform } from "@/platforms/web";

const directories: string[] = [];
const pids = new Set<number>();

afterEach(async () => {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The adapter already stopped the Process.
    }
  }
  pids.clear();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local Deployment adapter", { tags: ["production"] }, () => {
  test("forwards WebSocket upgrades to a managed server Process", { timeout: 10_000 }, async () => {
    const fixture = await localFixture();
    const executable = resolve(fixture.artifacts, "server");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const statusFile = process.env.KIT_PROCESS_STATUS_FILE;
const writeStatus = (status) => {
  const temporary = statusFile + "." + process.pid + ".tmp";
  writeFileSync(temporary, JSON.stringify({ status, pid: process.pid }) + "\\n");
  renameSync(temporary, statusFile);
};
const server = createServer((_request, response) => response.writeHead(404).end());
server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\n" +
      "Upgrade: websocket\\r\\n" +
      "Connection: Upgrade\\r\\n" +
      "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
  );
});
const shutdown = () => {
  writeStatus("draining");
  server.close(() => {
    writeStatus("stopped");
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.listen(Number(process.env.PORT), "127.0.0.1", () => writeStatus("ready"));
`,
    );
    await chmod(executable, 0o755);
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 1_000,
    });
    const deployment = createDeployment({} as System<Record<never, never>>, { adapter });
    const created = await applyDeployment(deployment, fixture.release);
    created.state.artifacts
      .flatMap(({ processes = [] }) => processes)
      .forEach(({ pid }) => pid && pids.add(pid));
    created.state.gateways.forEach(({ pid }) => pids.add(pid));
    const location = created.state.gateways[0]?.location;
    if (!location) throw new Error("Local deployment did not create a gateway.");
    const socket = new WebSocket(new URL("/_kit/realtime", location));

    await once(socket, "open");
    socket.terminate();
    await removeDeployment(deployment);
  });

  test("realizes, wires, retains, and removes provider-owned services", async () => {
    const fixture = await localFixture();
    const source = resolve(fixture.artifacts, "service.mjs");
    await writeFile(
      source,
      `import { createServer } from "node:net";
const server = createServer();
server.listen(Number(process.argv[2]), "127.0.0.1");
const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
`,
    );
    const release = {
      ...fixture.release,
      digest: "release-with-service",
      artifacts: fixture.release.artifacts.map((artifact) =>
        artifact.identity === "program/server"
          ? {
              ...artifact,
              digest: "program-with-service",
              services: [
                {
                  service: "probe",
                  features: ["durable"],
                  endpoints: [{ name: "client", transport: "tcp" as const, scheme: "probe" }],
                },
              ],
              configuration: [
                ...artifact.configuration,
                {
                  dependency: "http",
                  implementation: "http",
                  name: "service",
                  binding: { kind: "environment" as const, name: "TEST_SERVICE" },
                  required: false,
                  source: {
                    kind: "service-location" as const,
                    service: "probe",
                    endpoint: "client",
                  },
                },
              ],
            }
          : artifact,
      ),
    } satisfies Release;
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
      startupTimeoutMs: 2_000,
      shutdownTimeoutMs: 1_000,
      services: {
        probe: {
          executable: process.execPath,
          arguments({ endpoints }) {
            return [source, String(endpoints.client!.port)];
          },
        },
      },
    });
    const deployment = createDeployment({} as System<Record<never, never>>, { adapter });

    const first = await applyDeployment(deployment, release);
    const service = first.state.services[0]!;
    pids.add(service.pid);
    expect(service).toMatchObject({
      service: "probe",
      endpoints: [{ name: "client", location: expect.stringMatching(/^probe:\/\//) }],
    });
    await expect(readFile(onlyProcess(first.state).logs!.stdout, "utf8")).resolves.toContain(
      service.endpoints[0]!.location,
    );
    const retained = await applyDeployment(deployment, release);
    expect(retained.state.services[0]?.pid).toBe(service.pid);
    const retainedProcess = onlyProcess(retained.state);
    process.kill(service.pid, "SIGKILL");
    await expect.poll(async () => (await adapter.inspect())?.converged).toBe(false);
    const recovered = await applyDeployment(deployment, release);
    const recoveredService = recovered.state.services[0]!;
    pids.add(recoveredService.pid);
    expect(recoveredService.pid).not.toBe(service.pid);
    expect(onlyProcess(recovered.state).id).not.toBe(retainedProcess.id);
    await expect(readFile(onlyProcess(recovered.state).logs!.stdout, "utf8")).resolves.toContain(
      recoveredService.endpoints[0]!.location,
    );
    await removeDeployment(deployment);
    await expect.poll(() => processAlive(recoveredService.pid)).toBe(false);
  });

  test("fences concurrent applies against one atomically persisted revision", async () => {
    const fixture = await localFixture();
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
    });
    const system = {} as System<Record<never, never>>;
    const deployment = createDeployment(system, { adapter });
    const plan = planDeployment(deployment, fixture.release);

    const results = await Promise.allSettled([adapter.apply({ plan }), adapter.apply({ plan })]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const state = await adapter.inspect();
    state?.artifacts
      .flatMap(({ processes = [] }) => processes)
      .forEach(({ pid }) => pid && pids.add(pid));
    state?.gateways.forEach(({ pid }) => pids.add(pid));
    expect(state).toMatchObject({ revision: 1, converged: true });
    await removeDeployment(deployment);
  });

  test(
    "recovers persisted state and realizes scale, failure, replacement, removal, and redeployment",
    { timeout: 15_000 },
    async () => {
      const fixture = await localFixture();
      const options = {
        artifacts: fixture.artifacts,
        state: fixture.state,
        startupTimeoutMs: 2_000,
        shutdownTimeoutMs: 1_000,
      };
      const firstAdapter = createLocalDeploymentAdapter(options);
      const system = {} as System<{
        Programs: {
          server: {
            Environment: { Name: "server"; Platform: ServerPlatform };
            Requires: {};
            Provides: {};
          };
        };
      }>;
      const one = createDeployment(system, {
        adapter: firstAdapter,
        programs: { server: { replicas: 1 } },
      });

      const created = await applyDeployment(one, fixture.release);
      const firstProcess = onlyProcess(created.state);
      pids.add(firstProcess.pid!);
      created.state.gateways.forEach(({ pid }) => pids.add(pid));
      expect(firstProcess).toMatchObject({ healthy: true, ready: true, status: "ready" });
      const interfaceState = created.state.artifacts.find(
        ({ identity }) => identity === "interface/web",
      );
      expect(interfaceState?.locations).toEqual([
        created.state.gateways.find(({ identity }) => identity === "interface/web")?.location,
      ]);
      await expect(readFile(firstProcess.logs!.stdout, "utf8")).resolves.toContain(
        `${fixture.artifacts}|${interfaceState!.locations![0]}`,
      );
      await expect(readFile(firstProcess.logs!.stderr, "utf8")).resolves.toBe("");
      expect(await readFile(resolve(fixture.state, "state.json"), "utf8")).not.toContain(
        fixture.artifacts,
      );
      const database = resolve(fixture.state, "storage", "system.sqlite");
      await expect(readFile(database, "utf8")).resolves.toContain(firstProcess.id);

      const recoveredAdapter = createLocalDeploymentAdapter(options);
      const recovered = await recoveredAdapter.inspect();
      expect(onlyProcess(recovered!)).toMatchObject({ id: firstProcess.id, ready: true });

      const three = createDeployment(system, {
        adapter: recoveredAdapter,
        programs: { server: { replicas: 3 } },
      });
      const scaled = await applyDeployment(three, fixture.release);
      const scaledProcesses = scaled.state.artifacts.flatMap(({ processes = [] }) => processes);
      scaledProcesses.forEach(({ pid }) => pid && pids.add(pid));
      scaled.state.gateways.forEach(({ pid }) => pids.add(pid));
      expect(new Set(scaledProcesses.map(({ id }) => id)).size).toBe(3);
      expect(scaledProcesses.every(({ ready }) => ready)).toBe(true);
      expect(new Set(scaledProcesses.flatMap(({ locations = [] }) => locations)).size).toBe(3);
      expect(scaled.state.gateways[0]).toMatchObject({
        pid: created.state.gateways[0]!.pid,
        location: created.state.gateways[0]!.location,
      });
      expect(scaled.state.gateways[0]!.targets).toHaveLength(3);
      await expect(readFile(database, "utf8")).resolves.toContain(scaledProcesses[2]!.id);

      const failedLocation = scaledProcesses[0]!.locations![0]!;
      process.kill(scaledProcesses[0]!.pid!, "SIGKILL");
      await expect.poll(async () => (await recoveredAdapter.inspect())?.converged).toBe(false);
      const healed = await applyDeployment(three, fixture.release);
      const healedProcesses = healed.state.artifacts.flatMap(({ processes = [] }) => processes);
      healedProcesses.forEach(({ pid }) => pid && pids.add(pid));
      const originalVersion = healedProcesses[0]!.version;
      expect(healedProcesses.every(({ version }) => version === originalVersion)).toBe(true);
      expect(healed.plan.operations).toEqual([
        expect.objectContaining({ type: "scale", from: 2, to: 3 }),
      ]);
      expect(healed.state.converged).toBe(true);
      expect(healedProcesses.flatMap(({ locations = [] }) => locations)).toContain(failedLocation);

      const replacement = {
        ...fixture.release,
        digest: "release-v2",
        artifacts: fixture.release.artifacts.map((artifact) =>
          artifact.identity === "program/server" ? { ...artifact, digest: "program-v2" } : artifact,
        ),
      } satisfies Release;
      const executable = resolve(fixture.artifacts, "server");
      const validExecutable = await readFile(executable, "utf8");
      await writeFile(executable, "#!/bin/sh\nexit 9\n");
      await chmod(executable, 0o755);
      const rejected = await applyDeployment(three, replacement);
      expect(rejected.state).toMatchObject({ converged: false });
      expect(
        rejected.state.artifacts.flatMap(({ processes = [] }) =>
          processes.filter(({ healthy }) => healthy),
        ),
      ).toHaveLength(3);

      await writeFile(executable, validExecutable);
      await chmod(executable, 0o755);
      const replaced = await applyDeployment(three, replacement);
      const replacementProcesses = replaced.state.artifacts.flatMap(
        ({ processes = [] }) => processes,
      );
      replacementProcesses.forEach(({ pid }) => pid && pids.add(pid));
      replaced.state.gateways.forEach(({ pid }) => pids.add(pid));
      expect(replacementProcesses).toHaveLength(3);
      expect(new Set(replacementProcesses.map(({ version }) => version))).toHaveLength(1);
      expect(replacementProcesses.every(({ version }) => version !== originalVersion)).toBe(true);
      expect(replaced.state.gateways[0]!.location).toBe(created.state.gateways[0]!.location);

      const rolledBack = await applyDeployment(three, fixture.release);
      const rollbackProcesses = rolledBack.state.artifacts.flatMap(
        ({ processes = [] }) => processes,
      );
      rollbackProcesses.forEach(({ pid }) => pid && pids.add(pid));
      expect(rolledBack.plan.operations).toEqual([expect.objectContaining({ type: "replace" })]);
      expect(rollbackProcesses).toHaveLength(3);
      expect(rollbackProcesses.every(({ version }) => version === originalVersion)).toBe(true);
      expect(rolledBack.state.gateways[0]!.location).toBe(created.state.gateways[0]!.location);

      const stale = planDeployment(three, replacement, {
        revision: 0,
        converged: false,
        artifacts: [],
        failures: [],
      });
      await expect(recoveredAdapter.apply({ plan: stale })).rejects.toThrow("Stale Deployment");

      await removeDeployment(three);
      await expect(recoveredAdapter.inspect()).resolves.toMatchObject({
        converged: true,
        artifacts: [],
      });
      await expect(removeDeployment(three)).resolves.toMatchObject({ artifacts: [] });

      const redeployed = await applyDeployment(three, fixture.release);
      redeployed.state.artifacts
        .flatMap(({ processes = [] }) => processes)
        .forEach(({ pid }) => pid && pids.add(pid));
      redeployed.state.gateways.forEach(({ pid }) => pids.add(pid));
      expect(redeployed.state).toMatchObject({ converged: true });
      expect(
        redeployed.state.artifacts
          .flatMap(({ processes = [] }) => processes)
          .every(({ healthy, ready }) => healthy && ready),
      ).toBe(true);
      expect(redeployed.state.gateways).toEqual([
        expect.objectContaining({ identity: "interface/web" }),
      ]);
      await removeDeployment(three);
    },
  );

  test("rejects a mismatched Process target before replacing healthy replicas", async () => {
    const fixture = await localFixture();
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
      startupTimeoutMs: 2_000,
    });
    const system = {} as System<Record<never, never>>;
    const deployment = createDeployment(system, { adapter });
    const initial = await applyDeployment(deployment, fixture.release);
    const original = onlyProcess(initial.state);
    pids.add(original.pid!);
    initial.state.gateways.forEach(({ pid }) => pids.add(pid));
    const mismatched = {
      ...fixture.release,
      digest: "release-mismatched",
      artifacts: fixture.release.artifacts.map((artifact) =>
        artifact.deployment === "process"
          ? {
              ...artifact,
              digest: "program-mismatched",
              target: {
                operatingSystem: process.platform === "linux" ? "darwin" : "linux",
                architecture: process.arch,
              },
            }
          : artifact,
      ),
    } satisfies Release;

    const rejected = await applyDeployment(deployment, mismatched);
    expect(rejected.state).toMatchObject({
      converged: false,
      release: fixture.release.digest,
    });
    expect(rejected.state.failures[0]?.message).toContain("but the local adapter runs");
    expect(onlyProcess(rejected.state)).toMatchObject({
      id: original.id,
      healthy: true,
      ready: true,
    });
    await removeDeployment(deployment);
  });

  test("keeps secret values out of plans and persisted state", async () => {
    const fixture = await localFixture(true);
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
      resolveSecret: (name) => (name === "local/token" ? "plain-secret-value" : undefined),
    });
    const system = {} as System<{
      Programs: {
        server: {
          Environment: { Name: "server"; Platform: ServerPlatform };
          Requires: { token: Readonly<{ value(input: {}): string }> };
          Provides: {};
        };
      };
    }>;
    const deployment = createDeployment(system, {
      adapter,
      dependencies: {
        token: {
          implementation: "token-environment",
          configuration: { value: { kind: "secret", name: "local/token" } },
        } as never,
      },
    });

    const result = await applyDeployment(deployment, fixture.release);
    result.state.artifacts
      .flatMap(({ processes = [] }) => processes)
      .forEach(({ pid }) => pid && pids.add(pid));
    expect(JSON.stringify(result.plan)).not.toContain("plain-secret-value");
    expect(await readFile(resolve(fixture.state, "state.json"), "utf8")).not.toContain(
      "plain-secret-value",
    );
    await removeDeployment(deployment);
  });

  test("realizes typed interface hosts and production cache semantics locally", async () => {
    const fixture = await localFixture();
    const adapter = createLocalDeploymentAdapter({
      artifacts: fixture.artifacts,
      state: fixture.state,
    });
    type Application = { Features: {}; Interfaces: WebPlatform };
    const system = {} as System<{
      Features: {};
      Applications: { app: Application };
    }>;
    const deployment = createDeployment(system, {
      adapter,
      interfaces: {
        app: {
          web: { hosts: ["workspace.localhost", "workspace-alt.localhost"] },
        },
      },
    });
    const release = {
      ...fixture.release,
      artifacts: fixture.release.artifacts
        .filter(({ kind }) => kind === "interface")
        .map((artifact) => ({ ...artifact, identity: "interface/app.web" })),
    };

    const result = await applyDeployment(deployment, release);
    result.state.gateways.forEach(({ pid }) => pids.add(pid));
    expect(result.plan.interfaces).toEqual([
      {
        identity: "interface/app.web",
        hosts: ["workspace-alt.localhost", "workspace.localhost"],
      },
    ]);
    const locations = result.state.artifacts[0]?.locations ?? [];
    expect(locations).toHaveLength(2);
    expect(locations.every((location) => new URL(location).hostname.endsWith(".localhost"))).toBe(
      true,
    );

    const document = await fetch(locations[0]!);
    expect(document.status).toBe(200);
    expect(document.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(new URL("/assets/app-12345678.js", locations[0]));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const prebuilt = await fetch(new URL("/public", locations[0]));
    expect(await prebuilt.text()).toContain("prebuilt delivery");
    expect(prebuilt.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=30",
    );
    const robots = await fetch(new URL("/robots.txt", locations[0]));
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await robots.text()).toContain(`Sitemap: ${locations[0]}/sitemap.xml`);
    const sitemap = await fetch(new URL("/sitemap.xml", locations[0]));
    expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain(`<loc>${locations[0]}/public</loc>`);
    expect(sitemapBody).not.toContain("elsewhere.test");
    await removeDeployment(deployment);
  });

  test("replaces unchanged artifacts when runtime configuration changes", async () => {
    const fixture = await localFixture();
    const system = {} as System<{
      Programs: {
        server: {
          Environment: { Name: "server"; Platform: ServerPlatform };
          Requires: {};
          Provides: {};
        };
      };
    }>;
    const first = createDeployment(system, {
      adapter: createLocalDeploymentAdapter({
        artifacts: fixture.artifacts,
        state: fixture.state,
        startupTimeoutMs: 2_000,
      }),
    });
    const initial = await applyDeployment(first, fixture.release);
    const initialProcess = onlyProcess(initial.state);
    pids.add(initialProcess.pid!);
    initial.state.gateways.forEach(({ pid }) => pids.add(pid));

    const changed = createDeployment(system, {
      adapter: createLocalDeploymentAdapter({
        artifacts: fixture.artifacts,
        state: fixture.state,
        startupTimeoutMs: 2_001,
      }),
    });
    const replaced = await applyDeployment(changed, fixture.release);
    const replacement = onlyProcess(replaced.state);
    pids.add(replacement.pid!);
    replaced.state.gateways.forEach(({ pid }) => pids.add(pid));

    expect(replaced.plan.operations).toEqual([]);
    expect(replacement.id).not.toBe(initialProcess.id);
    expect(() => process.kill(initialProcess.pid!, 0)).toThrow();
    expect(replaced.state.gateways[0]!.location).toBe(initial.state.gateways[0]!.location);
    await removeDeployment(changed);
  });

  test("restarts Processes that consume changed asset artifacts", async () => {
    const fixture = await localFixture();
    const system = {} as System<{
      Programs: {
        server: {
          Environment: { Name: "server"; Platform: ServerPlatform };
          Requires: {};
          Provides: {};
        };
      };
    }>;
    const deployment = createDeployment(system, {
      adapter: createLocalDeploymentAdapter({
        artifacts: fixture.artifacts,
        state: fixture.state,
      }),
    });
    const initial = await applyDeployment(deployment, fixture.release);
    const initialProcess = onlyProcess(initial.state);
    const changedRelease: Release = {
      ...fixture.release,
      digest: "release-v2",
      artifacts: fixture.release.artifacts.map((artifact) =>
        artifact.deployment === "asset" ? { ...artifact, digest: "web-v2" } : artifact,
      ),
    };
    const replaced = await applyDeployment(deployment, changedRelease);
    const replacement = onlyProcess(replaced.state);
    pids.add(replacement.pid!);
    replaced.state.gateways.forEach(({ pid }) => pids.add(pid));

    expect(replacement.id).not.toBe(initialProcess.id);
    expect(replacement.version).not.toBe(initialProcess.version);
    expect(() => process.kill(initialProcess.pid!, 0)).toThrow();
    await removeDeployment(deployment);
  });
});

async function localFixture(withSecret = false): Promise<{
  artifacts: string;
  state: string;
  release: Release;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-local-deployment-"));
  directories.push(directory);
  const artifacts = resolve(directory, "release");
  const state = resolve(directory, "state");
  const executable = resolve(artifacts, "server");
  await mkdir(resolve(artifacts, "assets"), { recursive: true });
  await mkdir(resolve(artifacts, "public"), { recursive: true });
  await writeFile(resolve(artifacts, "index.html"), "<main>local delivery</main>");
  await writeFile(resolve(artifacts, "public/index.html"), "<main>prebuilt delivery</main>");
  await writeFile(resolve(artifacts, "assets/app-12345678.js"), "export {};");
  await writeFile(
    executable,
    `#!/bin/sh
status="$KIT_PROCESS_STATUS_FILE"
write_status() {
  temporary="$status.$$.tmp"
  printf '{"status":"%s","pid":%s}\\n' "$1" "$$" > "$temporary"
  mv "$temporary" "$status"
}

shutdown() {
  write_status draining
  write_status stopped
  exit 0
}
trap shutdown INT TERM
${withSecret ? '[ "$TOKEN" = "plain-secret-value" ] || exit 12' : ""}
printf '%s|%s\\n' "$KIT_WEB_ROOT" "$KIT_WEB_ORIGIN"
printf '%s\\n' "$TEST_SERVICE"
printf '%s\\n' "$KIT_PROCESS_ID" >> "$KIT_DATABASE"
write_status ready
while true; do sleep 1; done
`,
  );
  await chmod(executable, 0o755);
  return {
    artifacts,
    state,
    release: {
      version: 2,
      system: "local-test",
      digest: "release-v1",
      files: [],
      artifacts: [
        {
          identity: "interface/web",
          kind: "interface",
          deployment: "asset",
          platform: "web",
          environment: "browser-main",
          digest: "web-v1",
          root: ".",
          files: ["index.html", "public/index.html", "assets/app-12345678.js"],
          dependencies: [],
          configuration: [],
          exposure: {
            kind: "http-assets",
            fallback: "index.html",
            files: [
              { path: "index.html", cacheControl: "no-cache" },
              {
                path: "public/index.html",
                cacheControl: "public, max-age=60, stale-while-revalidate=30",
              },
              {
                path: "assets/app-12345678.js",
                cacheControl: "public, max-age=31536000, immutable",
              },
            ],
            responses: [
              {
                path: "/robots.txt",
                status: 200,
                headers: {
                  "cache-control": "public, max-age=300",
                  "content-type": "text/plain; charset=utf-8",
                },
                body: "User-agent: *\nAllow: /\nSitemap: {{origin}}/sitemap.xml\n",
                substitutions: ["origin"],
              },
              {
                path: "/sitemap.xml",
                status: 200,
                headers: {
                  "cache-control": "public, max-age=300",
                  "content-type": "application/xml; charset=utf-8",
                },
                body:
                  '<?xml version="1.0" encoding="UTF-8"?>' +
                  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
                  "<url><loc>{{origin}}/public</loc></url></urlset>\n",
                substitutions: ["origin"],
              },
            ],
          },
        },
        {
          identity: "program/server",
          kind: "program",
          deployment: "process",
          platform: "server",
          environment: "server",
          digest: "program-v1",
          root: "server",
          files: ["server"],
          entrypoint: "server",
          dependencies: withSecret ? ["http", "token"] : ["http"],
          configuration: [
            {
              dependency: "http",
              implementation: "http",
              name: "database",
              binding: { kind: "environment", name: "KIT_DATABASE" },
              required: false,
              default: ".kit/data/system.sqlite",
              allocation: {
                kind: "storage",
                name: "system.sqlite",
                scope: "deployment",
                type: "file",
              },
            },
            {
              dependency: "http",
              implementation: "http",
              name: "port",
              binding: { kind: "environment", name: "PORT" },
              required: false,
              default: "3010",
              allocation: { kind: "port" },
            },
            {
              dependency: "http",
              implementation: "http",
              name: "webOrigin",
              binding: { kind: "environment", name: "KIT_WEB_ORIGIN" },
              required: false,
              default: "http://localhost:3000",
              source: { kind: "process-location" },
            },
            {
              dependency: "http",
              implementation: "http",
              name: "webRoot",
              binding: { kind: "environment", name: "KIT_WEB_ROOT" },
              required: false,
              source: { kind: "assets", platform: "web", format: "single" },
            },
            {
              dependency: "http",
              implementation: "http",
              name: "webInterfaces",
              binding: { kind: "environment", name: "KIT_WEB_INTERFACES" },
              required: false,
              source: { kind: "assets", platform: "web", format: "interfaces" },
            },
            ...(withSecret
              ? [
                  {
                    dependency: "token",
                    implementation: "token-environment",
                    name: "value",
                    binding: { kind: "environment" as const, name: "TOKEN" },
                    required: true,
                    sensitive: true as const,
                  },
                ]
              : []),
          ],
          lifecycle: {
            shutdown: { kind: "signal", signal: "SIGINT" },
            status: { kind: "file", environment: "KIT_PROCESS_STATUS_FILE" },
          },
        },
      ],
    },
  };
}

function onlyProcess(state: {
  artifacts: readonly { processes?: readonly DeploymentProcessState[] }[];
}) {
  const processes = state.artifacts.flatMap(({ processes = [] }) => processes);
  expect(processes).toHaveLength(1);
  return processes[0]!;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
