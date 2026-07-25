import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createLocalDeploymentAdapter } from "@/adapters/deployment/local";
import type { DeploymentProcessState, Release } from "@/contracts/deployment";
import type { System } from "@/core/system";
import { applyDeployment, createDeployment, planDeployment, removeDeployment } from "@/deployment";

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

describe("local Deployment adapter", () => {
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
            Environment: { Name: "server"; Platform: { Name: "server" } };
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

      process.kill(scaledProcesses[0]!.pid!, "SIGKILL");
      await expect.poll(async () => (await recoveredAdapter.inspect())?.converged).toBe(false);
      const healed = await applyDeployment(three, fixture.release);
      healed.state.artifacts
        .flatMap(({ processes = [] }) => processes)
        .forEach(({ pid }) => pid && pids.add(pid));
      expect(healed.plan.operations).toEqual([
        expect.objectContaining({ type: "scale", from: 2, to: 3 }),
      ]);
      expect(healed.state.converged).toBe(true);

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
      expect(replacementProcesses.every(({ version }) => version === "program-v2")).toBe(true);
      expect(replaced.state.gateways[0]!.location).toBe(created.state.gateways[0]!.location);

      const rolledBack = await applyDeployment(three, fixture.release);
      const rollbackProcesses = rolledBack.state.artifacts.flatMap(
        ({ processes = [] }) => processes,
      );
      rollbackProcesses.forEach(({ pid }) => pid && pids.add(pid));
      expect(rolledBack.plan.operations).toEqual([expect.objectContaining({ type: "replace" })]);
      expect(rollbackProcesses).toHaveLength(3);
      expect(rollbackProcesses.every(({ version }) => version === "program-v1")).toBe(true);
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

  test("rejects an incompatible Process target before replacing healthy replicas", async () => {
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
    const incompatible = {
      ...fixture.release,
      digest: "release-incompatible",
      artifacts: fixture.release.artifacts.map((artifact) =>
        artifact.deployment === "process"
          ? {
              ...artifact,
              digest: "program-incompatible",
              target: {
                operatingSystem: process.platform === "linux" ? "darwin" : "linux",
                architecture: process.arch,
              },
            }
          : artifact,
      ),
    } satisfies Release;

    const rejected = await applyDeployment(deployment, incompatible);
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
          Environment: { Name: "server"; Platform: { Name: "server" } };
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

  test("replaces unchanged artifacts when runtime configuration changes", async () => {
    const fixture = await localFixture();
    const system = {} as System<{
      Programs: {
        server: {
          Environment: { Name: "server"; Platform: { Name: "server" } };
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
  await mkdir(artifacts, { recursive: true });
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
      version: 1,
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
          files: [],
          dependencies: [],
          configuration: [],
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
              default: ".data/system.sqlite",
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
