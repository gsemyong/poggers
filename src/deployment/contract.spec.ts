import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, describe, expect, test } from "vitest";

import type { ProductionArtifacts } from "@/adapter";
import type { System } from "@/core/system";
import {
  applyDeployment,
  createDeployment,
  createRelease,
  planDeployment,
  reconcileReplicas,
  removeDeployment,
  secret,
  type DependencyBinding,
  type DeploymentAdapter,
  type DeploymentPlan,
  type DeploymentState,
  type Release,
} from "@/deployment";
import type { ServerProcess } from "@/platforms/server";

type Program<Environment, Contract extends object = object> = Readonly<
  Contract & { Environment: Environment }
>;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Deployment authoring", () => {
  const lifecycle = {
    async inspect() {
      return undefined;
    },
    async apply({ plan }: Parameters<DeploymentAdapter["apply"]>[0]) {
      return {
        revision: plan.expectedRevision + 1,
        release: plan.release.digest,
        converged: true,
        artifacts: plan.artifacts,
        failures: [],
      };
    },
    async remove({ expectedRevision }: Parameters<DeploymentAdapter["remove"]>[0]) {
      return {
        revision: expectedRevision + 1,
        converged: true,
        artifacts: [],
        failures: [],
      };
    },
  } satisfies Pick<DeploymentAdapter, "inspect" | "apply" | "remove">;
  const adapter = {
    name: "local",
    configuration: {},
    ...lifecycle,
  } satisfies DeploymentAdapter<"local">;
  const system = {} as System<Record<never, never>>;

  test("retains one System and one configured adapter", () => {
    const deployment = createDeployment(system, {
      adapter,
      programs: {},
    });

    expect(deployment).toEqual({ system, adapter, programs: {} });
    expect(Object.isFrozen(deployment)).toBe(true);
  });

  test.each([-1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects an invalid replica count %s",
    (replicas) => {
      expect(() =>
        createDeployment(system, {
          adapter,
          programs: {
            server: { replicas },
          } as never,
        }),
      ).toThrow("replicas must be a non-negative safe integer");
    },
  );

  test("retains only an opaque secret name", () => {
    expect(secret("production/database")).toEqual({
      kind: "secret",
      name: "production/database",
    });
    expect(() => secret("   ")).toThrow("secret name cannot be empty");
  });
});

describe("replica controller", () => {
  test("applies bounds, availability, cooldown, and step limits deterministically", () => {
    expect(
      reconcileReplicas(
        {
          minimum: 1,
          maximum: 10,
          scaleUp: { cooldownMs: 100, maximumStep: 3 },
          scaleDown: { cooldownMs: 1_000, maximumStep: 1 },
        },
        { current: 2, ready: 2, recommended: 9, now: 500, changedAt: 0 },
      ),
    ).toEqual({ replicas: 5, reason: "scale-up" });
    expect(
      reconcileReplicas(
        { minimum: 1, maximum: 10, scaleDown: { cooldownMs: 1_000 } },
        { current: 5, ready: 4, recommended: 1, now: 2_000, changedAt: 0 },
      ),
    ).toEqual({ replicas: 5, reason: "unavailable" });
    expect(
      reconcileReplicas(
        { minimum: 1, maximum: 10, scaleDown: { cooldownMs: 1_000 } },
        { current: 5, ready: 5, recommended: 1, now: 500, changedAt: 0 },
      ),
    ).toEqual({ replicas: 5, reason: "cooldown" });
    expect(
      reconcileReplicas(
        { minimum: 2, maximum: 4 },
        { current: 2, ready: 2, recommended: 0, now: 0 },
      ),
    ).toEqual({ replicas: 2, reason: "bounded" });
  });

  test("never leaves bounds or scales down unavailable capacity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (first, second, current, recommended) => {
          const minimum = Math.min(first, second);
          const maximum = Math.max(first, second);
          const ready = Math.min(current, Math.floor(current / 2));
          const decision = reconcileReplicas(
            { minimum, maximum },
            { current, ready, recommended, now: 0 },
          );
          if (decision.reason === "unavailable") {
            expect(decision.replicas).toBe(current);
          } else {
            expect(decision.replicas).toBeGreaterThanOrEqual(minimum);
            expect(decision.replicas).toBeLessThanOrEqual(maximum);
          }
        },
      ),
    );
  });
});

describe("Release", () => {
  test("canonicalizes provider-owned service requirements once per deployment", async () => {
    const fixture = await releaseFixture("services");
    const nats = {
      service: "nats",
      features: ["jetstream"],
      endpoints: [{ name: "client", transport: "tcp" as const, scheme: "nats" }],
    };
    const server = {
      ...fixture.server,
      entries: fixture.server.entries.map((artifact) => ({
        ...artifact,
        services: [
          nats,
          {
            ...nats,
            features: ["jetstream", "key-value"],
          },
        ],
      })),
    };
    const release = await createRelease({
      directory: fixture.directory,
      system: "commerce",
      artifacts: { server, web: fixture.web },
    });
    const deployment = createDeployment(
      {} as System<Record<never, never>>,
      {
        adapter: memoryAdapter(),
        dependencies: {
          events: dependency("events-jetstream", {
            servers: "nats://127.0.0.1:4222",
          }),
        },
      } as never,
    );
    const plan = planDeployment(deployment, release);

    expect(release.artifacts.find(({ identity }) => identity === "program/api")?.services).toEqual([
      {
        service: "nats",
        features: ["jetstream", "key-value"],
        endpoints: [{ name: "client", transport: "tcp", scheme: "nats" }],
      },
    ]);
    expect(plan.services).toEqual([
      {
        service: "nats",
        features: ["jetstream", "key-value"],
        endpoints: [{ name: "client", transport: "tcp", scheme: "nats" }],
      },
    ]);
  });

  test("seals equivalent Platform outputs into one deterministic manifest", async () => {
    const first = await releaseFixture("first");
    const second = await releaseFixture("second");

    const left = await createRelease({
      directory: first.directory,
      system: "commerce",
      app: "storefront",
      artifacts: {
        web: first.web,
        server: first.server,
      },
    });
    const right = await createRelease({
      directory: second.directory,
      system: "commerce",
      app: "storefront",
      artifacts: {
        server: second.server,
        web: second.web,
      },
    });

    expect(right).toEqual(left);
    expect(right.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(right.files.map(({ path }) => path)).toEqual([
      "server/api",
      "web/assets/app.js",
      "web/index.html",
    ]);
    expect(right.artifacts).toEqual([
      expect.objectContaining({
        identity: "interface/storefront",
        platform: "web",
        entrypoint: "web/index.html",
        files: ["web/assets/app.js", "web/index.html"],
      }),
      expect.objectContaining({
        identity: "program/api",
        platform: "server",
        entrypoint: "server/api",
        files: ["server/api"],
        dependencies: ["clock", "events"],
      }),
    ]);
    const manifest = await readFile(resolve(first.directory, "release.json"), "utf8");
    expect(manifest).not.toContain(first.directory);
    expect(JSON.parse(manifest)).toEqual(left);
  });

  test("changes identity when artifact content changes", async () => {
    const fixture = await releaseFixture("changed");
    const before = await createRelease({
      directory: fixture.directory,
      system: "commerce",
      artifacts: { server: fixture.server, web: fixture.web },
    });
    await writeFile(resolve(fixture.directory, "web/index.html"), "<main>changed</main>");
    const after = await createRelease({
      directory: fixture.directory,
      system: "commerce",
      artifacts: { server: fixture.server, web: fixture.web },
    });

    expect(after.digest).not.toBe(before.digest);
    expect(
      after.artifacts.find(({ identity }) => identity === "interface/storefront")?.digest,
    ).not.toBe(
      before.artifacts.find(({ identity }) => identity === "interface/storefront")?.digest,
    );
  });

  test("rejects duplicate identities and files outside the release", async () => {
    const fixture = await releaseFixture("invalid");
    await expect(
      createRelease({
        directory: fixture.directory,
        system: "commerce",
        artifacts: {
          first: fixture.server,
          second: {
            directory: fixture.directory,
            entries: fixture.server.entries,
          },
        },
      }),
    ).rejects.toThrow("duplicate artifact");

    const outside = await mkdtemp(resolve(tmpdir(), "kit-release-outside-"));
    directories.push(outside);
    const executable = resolve(outside, "api");
    await writeFile(executable, "outside");
    await expect(
      createRelease({
        directory: fixture.directory,
        system: "commerce",
        artifacts: {
          server: {
            directory: fixture.directory,
            entries: [
              {
                identity: "program/outside",
                kind: "program",
                deployment: "process",
                environment: "server",
                path: executable,
                entrypoint: executable,
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("must be inside its output directory");
  });
});

describe("Deployment planning", () => {
  type Store = Readonly<{ read(input: { key: string }): Promise<string | undefined> }>;
  type Contract = Readonly<{
    Features: {
      product: {
        Programs: {
          server: Program<ServerProcess, { Requires: { store: Store } }>;
        };
      };
    };
  }>;
  const system = {} as System<Contract>;

  test("creates, scales, replaces, removes, and converges idempotently", async () => {
    const adapter = memoryAdapter();
    const first = deploymentRelease("release-1", "program-1", true);
    const deployment = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 2 } },
      dependencies: {
        store: dependency<Store>("events-jetstream", {
          servers: secret("production/nats"),
        }),
      },
    });

    const initial = planDeployment(deployment, first);
    expect(initial.target).toEqual({
      adapter: "memory",
      configuration: {},
    });
    expect(initial.operations.map(({ type }) => type)).toEqual(["create", "create"]);
    expect(initial.artifacts).toEqual([
      {
        identity: "interface/web",
        kind: "interface",
        digest: "interface-1",
      },
      {
        identity: "program/server",
        kind: "program",
        digest: "program-1",
        replicas: 2,
      },
    ]);
    expect(initial.dependencies).toEqual([
      {
        name: "store",
        implementation: "events-jetstream",
        configuration: {
          servers: { kind: "secret", name: "production/nats" },
        },
      },
    ]);
    expect(initial.interfaces).toEqual([{ identity: "interface/web", hosts: [] }]);

    const applied = await applyDeployment(deployment, first);
    expect(applied.state).toMatchObject({
      revision: 1,
      release: "release-1",
      converged: true,
    });
    expect(adapter.applies).toBe(1);

    await applyDeployment(deployment, first);
    expect(adapter.applies).toBe(1);

    const scaled = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 3 } },
      dependencies: deployment.dependencies,
    });
    expect(planDeployment(scaled, first, await adapter.inspect()).operations).toEqual([
      expect.objectContaining({
        type: "scale",
        from: 2,
        to: 3,
      }),
    ]);
    await applyDeployment(scaled, first);

    const second = deploymentRelease("release-2", "program-2", false);
    expect(
      planDeployment(scaled, second, await adapter.inspect()).operations.map(
        ({ type, artifact }) => [type, artifact.identity],
      ),
    ).toEqual([
      ["replace", "program/server"],
      ["remove", "interface/web"],
    ]);
    await applyDeployment(scaled, second);

    const removed = await removeDeployment(scaled);
    expect(removed).toMatchObject({
      revision: 4,
      converged: true,
      artifacts: [],
    });
    await expect(removeDeployment(scaled)).resolves.toMatchObject({ revision: 4 });
    expect(adapter.removes).toBe(1);
  });

  test("rejects mismatched, unsafe, and unknown bindings", () => {
    const adapter = memoryAdapter();
    const release = deploymentRelease("release-1", "program-1", false);

    expect(() =>
      planDeployment(
        createDeployment(system, {
          adapter,
          dependencies: {
            store: dependency<Store>("events-sqlite", {
              servers: secret("production/nats"),
            }),
          },
        }),
        release,
      ),
    ).toThrow("embeds");

    expect(() =>
      planDeployment(
        createDeployment(system, {
          adapter,
          dependencies: {
            store: dependency<Store>("events-jetstream", {
              servers: "plaintext-secret",
            }),
          },
        }),
        release,
      ),
    ).toThrow("must be a secret reference");

    expect(() =>
      planDeployment(
        createDeployment(system, {
          adapter,
          dependencies: {
            store: dependency<Store>("events-jetstream", {
              servers: secret("production/nats"),
              invalid: () => "not declarative",
            }),
          },
        }),
        release,
      ),
    ).toThrow("unsupported function data");
  });

  test("plans canonical interface hosts and rejects ambiguous ownership", () => {
    const adapter = memoryAdapter();
    const release = {
      ...deploymentRelease("release-1", "program-1", true),
      artifacts: [
        ...deploymentRelease("release-1", "program-1", true)
          .artifacts.filter(({ kind }) => kind === "interface")
          .map((artifact) => ({ ...artifact, identity: "interface/application.web" })),
        {
          identity: "interface/application.admin",
          kind: "interface" as const,
          deployment: "asset" as const,
          platform: "web",
          environment: "browser-main",
          digest: "interface-admin",
          root: "admin",
          files: [],
          dependencies: [],
          configuration: [],
        },
      ],
    };
    const configured = createDeployment(system, {
      adapter,
      interfaces: {
        application: {
          web: { hosts: ["WWW.EXAMPLE.COM", "example.com"] },
        },
      } as never,
    });

    expect(planDeployment(configured, release).interfaces).toEqual([
      { identity: "interface/application.admin", hosts: [] },
      {
        identity: "interface/application.web",
        hosts: ["example.com", "www.example.com"],
      },
    ]);

    expect(() =>
      planDeployment(
        createDeployment(system, {
          adapter,
          interfaces: {
            application: {
              admin: { hosts: ["example.com"] },
              web: { hosts: ["example.com"] },
            },
          } as never,
        }),
        release,
      ),
    ).toThrow("claimed by");
    expect(() =>
      planDeployment(
        createDeployment(system, {
          adapter,
          interfaces: {
            application: { missing: { hosts: ["missing.example.com"] } },
          } as never,
        }),
        release,
      ),
    ).toThrow("unknown interface");
  });

  test("rejects false convergence and stale observed state", async () => {
    const release = deploymentRelease("release-1", "program-1", false);
    const adapter = memoryAdapter(undefined, true);
    const deployment = createDeployment(system, {
      adapter,
      dependencies: {
        store: dependency<Store>("events-jetstream", {
          servers: secret("production/nats"),
        }),
      },
    });

    await expect(applyDeployment(deployment, release)).rejects.toThrow("claimed convergence");
    expect(() =>
      planDeployment(deployment, release, {
        revision: 1,
        converged: false,
        artifacts: [
          { identity: "program/server", kind: "program", digest: "one" },
          { identity: "program/server", kind: "program", digest: "two" },
        ],
        failures: [],
      }),
    ).toThrow("duplicate artifacts");
  });
});

async function releaseFixture(name: string): Promise<{
  directory: string;
  server: ProductionArtifacts;
  web: ProductionArtifacts;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), `kit-release-${name}-`));
  directories.push(directory);
  const executable = resolve(directory, "server/api");
  const web = resolve(directory, "web");
  await mkdir(resolve(web, "assets"), { recursive: true });
  await mkdir(resolve(directory, "server"), { recursive: true });
  await writeFile(executable, "native-api");
  await chmod(executable, 0o755);
  await writeFile(resolve(web, "index.html"), "<main>storefront</main>");
  await writeFile(resolve(web, "assets/app.js"), "console.log('storefront')");
  const configuration = [
    {
      dependency: "events",
      implementation: "events-jetstream",
      name: "stream",
      binding: { kind: "environment" as const, name: "KIT_EVENT_STREAM" },
      required: false,
      default: "KIT_EVENTS",
    },
    {
      dependency: "events",
      implementation: "events-jetstream",
      name: "servers",
      binding: { kind: "environment" as const, name: "NATS_URL" },
      required: true,
    },
  ];
  return {
    directory,
    server: {
      directory: resolve(directory, "server"),
      entries: [
        {
          identity: "program/api",
          kind: "program",
          deployment: "process",
          environment: "server",
          path: executable,
          entrypoint: executable,
          dependencies: name === "second" ? ["clock", "events", "clock"] : ["events", "clock"],
          configuration: name === "second" ? configuration.toReversed() : configuration,
          target: { operatingSystem: "linux", architecture: "arm64" },
        },
      ],
    },
    web: {
      directory: web,
      entries: [
        {
          identity: "interface/storefront",
          kind: "interface",
          deployment: "asset",
          environment: "browser-main",
          path: web,
          entrypoint: resolve(web, "index.html"),
        },
      ],
    },
  };
}

function deploymentRelease(
  digest: string,
  programDigest: string,
  includeInterface: boolean,
): Release {
  return {
    version: 2,
    system: "commerce",
    digest,
    files: [],
    artifacts: [
      ...(includeInterface
        ? [
            {
              identity: "interface/web",
              kind: "interface" as const,
              deployment: "asset" as const,
              platform: "web",
              environment: "browser-main",
              digest: "interface-1",
              root: "web",
              files: [],
              dependencies: [],
              configuration: [],
            },
          ]
        : []),
      {
        identity: "program/server",
        kind: "program",
        deployment: "process",
        platform: "server",
        environment: "server",
        digest: programDigest,
        root: "server",
        files: [],
        dependencies: ["store"],
        configuration: [
          {
            dependency: "store",
            implementation: "events-jetstream",
            name: "servers",
            binding: { kind: "environment", name: "NATS_URL" },
            required: true,
            sensitive: true,
          },
        ],
      },
    ],
  };
}

function dependency<API extends object>(
  implementation: string,
  configuration: object,
): DependencyBinding<API> {
  return { implementation, configuration } as DependencyBinding<API>;
}

function memoryAdapter(initial?: DeploymentState, falseConvergence = false) {
  let state = initial;
  let applies = 0;
  let removes = 0;
  return {
    name: "memory",
    configuration: {},
    get applies() {
      return applies;
    },
    get removes() {
      return removes;
    },
    async inspect() {
      return state;
    },
    async apply({ plan }: { plan: DeploymentPlan }) {
      if ((state?.revision ?? 0) !== plan.expectedRevision) {
        throw new Error("stale deployment plan");
      }
      applies += 1;
      state = {
        revision: plan.expectedRevision + 1,
        release: plan.release.digest,
        desired: plan.desired,
        runtime: plan.runtime,
        converged: true,
        artifacts: falseConvergence ? [] : plan.artifacts,
        failures: [],
      };
      return state;
    },
    async remove({ expectedRevision }: { expectedRevision: number }) {
      if ((state?.revision ?? 0) !== expectedRevision) {
        throw new Error("stale deployment removal");
      }
      removes += 1;
      state = {
        revision: expectedRevision + 1,
        converged: true,
        artifacts: [],
        failures: [],
      };
      return state;
    },
  } as DeploymentAdapter<"memory"> & Readonly<{ applies: number; removes: number }>;
}
