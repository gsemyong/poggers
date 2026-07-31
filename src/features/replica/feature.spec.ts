import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import type { Aggregate } from "@/features/aggregate";
import type { orders } from "@/features/aggregate/feature.typecheck";
import type { Projection } from "@/features/projection";
import { operations } from "@/features/projection/feature.typecheck";
import { createReplicaFixture, type Replication } from "@/features/replica";
import { localOperations, localOperationsDefinition } from "@/features/replica/feature.typecheck";
import { replicationConformance, replicationConformanceRecords } from "@/features/replica/testing";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import { compileSystemFixture } from "@/testing/compiler";
import { dependencyImplementationTarget } from "@/testing/dependency";

replicationConformance.test(
  dependencyImplementationTarget("in-process", () => ({
    async pull({ input }) {
      expect(input.replica).toBe("tasks");
      return input.after === 10
        ? replicationConformanceRecords.changed
        : replicationConformanceRecords.initial;
    },
    async command({ input }) {
      expect(input).toEqual({
        replica: "tasks",
        command: "complete",
        value: { id: "task-1" },
        idempotencyKey: "conformance-command",
        after: 11,
      });
      return replicationConformanceRecords.admitted;
    },
    async changes({ input }) {
      expect(input).toMatchObject({
        replica: "tasks",
        observations: { tasks: "10" },
        sequence: 10,
      });
      return (async function* (): AsyncIterable<Awaited<ReturnType<Replication["pull"]>>> {
        yield replicationConformanceRecords.changed;
        yield replicationConformanceRecords.admitted.pull;
      })();
    },
  })),
);

describe("Replica", () => {
  it("lowers its authority as ordinary portable meaning and retains client contracts", () => {
    const compiled = compileSystemFixture(resolve(import.meta.dirname, "feature.typecheck.ts"), [
      serverCompilerExtension,
      webCompilerExtension,
    ]);
    const server = compiled.programs.find(({ name }) => name === "server");
    expect(server).toBeDefined();
    const replica = server?.contributions.find(
      ({ id }) => id === "feature/localOperations/program/server",
    );
    expect(replica && serverProgramExecution(replica, server).kind).toBe("portable");
    expect(JSON.stringify(compiled)).not.toContain('"kind":"replica"');

    const browser = compiled.programs.find(({ name }) => name === "browser");
    const client = browser?.contributions.find(
      ({ id }) => id === "feature/localOperations/program/browser",
    );
    const contract = client
      ? projectDependencyContracts(client.provides).find(({ name }) => name === "localOperations")
      : undefined;
    const placeOrder = contract?.operations.find(({ name }) => name === "placeOrder");
    expect(placeOrder?.input.kind).toBe("record");
    if (placeOrder?.input.kind !== "record") {
      throw new Error("Replica command input was not preserved as a semantic record.");
    }
    expect(placeOrder.input.fields.map(({ name }) => name)).toEqual([
      "id",
      "note",
      "product",
      "quantity",
    ]);
    expect(contract?.operations.find(({ name }) => name === "subscribe")?.input.kind).toBe(
      "function",
    );
  });

  it("preserves offline intent, reconciles, persists, and revokes unauthorized rows", async () => {
    const projection = compileSystemFixture(
      resolve(import.meta.dirname, "../projection/feature.typecheck.ts"),
      [serverCompilerExtension],
    ).programs.find(({ name }) => name === "server");
    if (!projection) throw new Error("Projection fixture has no server Program.");
    const linked = linkProgram(projection);
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
      configuration: { database: ":memory:" },
      providers: operations.providers.server,
    });
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;
    const storage = new Map<string, unknown>();

    try {
      await using execution = await executeServerLinkedProgramIR(
        linked,
        host as Parameters<typeof executeServerLinkedProgramIR>[1],
      );
      const dependencies = {
        operations: execution.dependencies.operations as Projection.Reference<typeof operations>,
        orders: execution.dependencies.orders as Aggregate.Reference<typeof orders>,
      };
      await using coldReplica = await createReplicaFixture(
        localOperations,
        localOperationsDefinition,
        {
          principal: {
            id: "cold-member",
            organization: "cold-company",
            roles: ["operator"],
          },
          projection: dependencies.operations,
          rows: ["orders"],
          dependencies: { orders: dependencies.orders },
          name: "localOperations",
          version: 2,
          online: false,
        },
      );
      let coldState: Awaited<ReturnType<typeof coldReplica.state>> | undefined;
      using _coldObservation = coldReplica.client.subscribe((state) => {
        coldState = state;
      });
      const coldAdmission = coldReplica.client.placeOrder({
        id: "cold-order",
        product: "product-cold",
        quantity: 1,
        note: "Admitted before the first network snapshot",
      });
      expect(coldState).toMatchObject({
        data: { orders: [{ id: "cold-order", status: "placed" }] },
        pending: [{ id: "fixture-command-1", command: "placeOrder" }],
      });
      expect(coldAdmission).toEqual({ id: "fixture-command-1" });
      expect(coldReplica.responses).toEqual([]);
      await expect.poll(async () => (await coldReplica.state()).status).toBe("offline");
      coldReplica.online(true);
      coldReplica.client.placeOrder({
        id: "cold-recovery-order",
        product: "product-recovery",
        quantity: 1,
        note: "A successful command clears stale offline state",
      });
      await expect
        .poll(async () => await coldReplica.state(), { interval: 1, timeout: 200 })
        .toMatchObject({
          status: "synchronized",
          error: undefined,
          pending: [],
        });
      await expect(coldReplica.state()).resolves.toMatchObject({
        status: "synchronized",
        pending: [],
        data: {
          orders: [
            { id: "cold-order", status: "placed" },
            { id: "cold-recovery-order", status: "placed" },
          ],
        },
      });
      await using rejectedColdReplica = await createReplicaFixture(
        localOperations,
        localOperationsDefinition,
        {
          principal: {
            id: "cold-viewer",
            organization: "cold-viewer-company",
            roles: ["viewer"],
          },
          projection: dependencies.operations,
          rows: ["orders"],
          dependencies: { orders: dependencies.orders },
          name: "localOperations",
          version: 2,
          online: false,
        },
      );
      await rejectedColdReplica.client.placeOrder({
        id: "rejected-cold-order",
        product: "product-cold",
        quantity: 1,
        note: "Must roll back to the local baseline",
      });
      rejectedColdReplica.online(true);
      await rejectedColdReplica.client.synchronize();
      await expect(rejectedColdReplica.state()).resolves.toMatchObject({
        status: "synchronized",
        pending: [],
        rejected: [{ pending: { id: "fixture-command-1", command: "placeOrder" } }],
        data: { orders: [] },
      });

      await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: dependencies.operations,
        rows: ["orders"],
        dependencies: { orders: dependencies.orders },
        name: "localOperations",
        version: 2,
        storage,
      });
      await expect
        .poll(async () => await replica.state())
        .toMatchObject({ status: "synchronized", data: { orders: [] } });

      let observedState: Awaited<ReturnType<typeof replica.state>> | undefined;
      using _immediateObservation = replica.client.subscribe((state) => {
        observedState = state;
      });
      replica.online(false);
      const pendingAdmission = replica.client.placeOrder({
        id: "order-1",
        product: "product-1",
        quantity: 2,
        note: "Handle carefully",
      });
      expect(observedState).toMatchObject({
        pending: [{ id: "fixture-command-1", command: "placeOrder" }],
        data: { orders: [{ id: "order-1", status: "placed" }] },
      });
      const admission = await pendingAdmission;
      expect(admission.id).toBe("fixture-command-1");
      await expect.poll(async () => (await replica.state()).status).toBe("offline");
      await expect(replica.state()).resolves.toMatchObject({
        pending: [{ id: "fixture-command-1", command: "placeOrder" }],
        data: { orders: [{ id: "order-1", status: "placed" }] },
      });

      replica.online(true);
      await replica.client.synchronize();
      await expect(replica.state()).resolves.toMatchObject({
        status: "synchronized",
        pending: [],
        rejected: [],
        data: { orders: [{ id: "order-1", note: "Handle carefully" }] },
      });
      await expect
        .poll(
          () =>
            (
              storage.get("replica:localOperations:member-1:1") as
                | { committed?: { orders?: readonly Readonly<{ id: string }>[] } }
                | undefined
            )?.committed?.orders,
        )
        .toMatchObject([{ id: "order-1" }]);
      const firstCommandResponse = replica.responses.find(
        ({ method, path }) => method === "POST" && path.endsWith("/placeOrder"),
      );
      expect(firstCommandResponse).toBeDefined();
      const firstCommandPayload = JSON.parse(firstCommandResponse!.body) as {
        pull: {
          snapshot?: object;
          invocations: readonly string[];
          changes: readonly object[];
        };
      };
      expect(firstCommandPayload.pull.snapshot).toBeUndefined();
      expect(firstCommandPayload.pull.invocations).toContain("idempotency:fixture-command-1");
      expect(firstCommandPayload.pull.changes).toMatchObject([
        { row: "orders", upsert: { id: "order-1", note: "Handle carefully" } },
      ]);
      await expect(
        replica.client.orders({
          text: { value: "Handle", fields: ["note"] },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1" }, score: 1 }],
      });

      const observedOrderIds: string[][] = [];
      using _observation = replica.client.subscribe((state) => {
        observedOrderIds.push(state.data?.orders.map(({ id }) => id) ?? []);
      });
      replica.dropNextResponse();
      const uncertain = await replica.client.placeOrder({
        id: "order-2",
        product: "product-2",
        quantity: 1,
        note: "Response may be lost",
      });
      await expect.poll(async () => (await replica.state()).status).toBe("offline");
      await replica.client.synchronize();
      await expect(replica.state()).resolves.toMatchObject({
        status: "synchronized",
        pending: [],
        rejected: [],
        data: {
          orders: [{ id: "order-1" }, { id: "order-2" }],
        },
      });
      expect(
        observedOrderIds.every((ids) => new Set(ids).size === ids.length),
        "authoritative observation must not duplicate an optimistic row",
      ).toBe(true);
      const orderTwo = (execution.dependencies.orders as Aggregate.Reference<typeof orders>).get({
        key: "order-2",
        principal,
      });
      await expect(orderTwo.events({})).resolves.toMatchObject({
        entries: [{ metadata: { invocation: `idempotency:${uncertain.id}` } }],
      });

      await replica.principal({
        ...principal,
        roles: ["viewer"],
      });
      await replica.client.placeOrder({
        id: "order-forbidden",
        product: "product-3",
        quantity: 1,
        note: "Must be rejected",
      });
      await expect.poll(async () => (await replica.state()).rejected.length).toBe(1);
      await expect(replica.state()).resolves.toMatchObject({
        pending: [],
        rejected: [{ pending: { command: "placeOrder" } }],
        data: {
          orders: [{ id: "order-1" }, { id: "order-2" }],
        },
      });

      replica.online(false);
      await replica.client.placeOrder({
        id: "order-revoked-while-offline",
        product: "product-4",
        quantity: 1,
        note: "Must be fenced when authority changes",
      });
      await expect(replica.state()).resolves.toMatchObject({
        pending: [{ id: "fixture-command-4" }],
      });
      await replica.principal({
        ...principal,
        organization: "company-2",
      });
      await expect.poll(async () => (await replica.state()).status).toBe("offline");
      await expect(replica.state()).resolves.toMatchObject({
        status: "offline",
        pending: [],
        rejected: [
          { pending: { command: "placeOrder" } },
          {
            pending: { id: "fixture-command-4", command: "placeOrder" },
            message: "Authorization context changed before the command was committed.",
          },
        ],
      });
      expect((await replica.state()).data).toEqual({ orders: [] });
      replica.online(true);
      await replica.client.synchronize();
      await expect(replica.state()).resolves.toMatchObject({
        status: "synchronized",
        data: { orders: [] },
      });

      await using incompatible = await createReplicaFixture(
        localOperations,
        localOperationsDefinition,
        {
          principal,
          projection: dependencies.operations,
          rows: ["orders"],
          dependencies,
          name: "localOperations",
          version: 2,
          schema: "client-schema",
          authoritySchema: "authority-schema",
        },
      );
      await expect
        .poll(async () => await incompatible.state())
        .toMatchObject({
          status: "upgrade-required",
          compatibility: {
            client: "2:client-schema",
            authority: "2:authority-schema",
          },
        });
    } finally {
      await disposeHost(host);
    }
  });

  it("publishes and returns local admission before durable storage or networking", async () => {
    const principal = {
      id: "member-fast",
      organization: "company-fast",
      roles: ["operator"],
    } as const;
    let releaseStorage!: () => void;
    const storageBlocked = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    let writes = 0;
    await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
      principal,
      projection: {} as Projection.Reference<typeof operations>,
      rows: ["orders"],
      dependencies: {
        orders: {} as Aggregate.Reference<typeof orders>,
      },
      name: "localOperations",
      version: 2,
      online: false,
      async beforeStorageWrite() {
        writes += 1;
        await storageBlocked;
      },
    });
    let observed: Awaited<ReturnType<typeof replica.state>> | undefined;
    using _observation = replica.client.subscribe((state) => {
      observed = state;
    });

    const admitted = replica.client.placeOrder({
      id: "order-fast",
      product: "product-fast",
      quantity: 1,
      note: "Visible immediately",
    });

    expect(admitted).toEqual({ id: "fixture-command-1" });
    expect(observed).toMatchObject({
      data: { orders: [{ id: "order-fast", status: "placed" }] },
      pending: [{ id: "fixture-command-1" }],
    });
    await expect.poll(() => writes).toBeGreaterThan(0);
    expect(replica.responses).toEqual([]);

    releaseStorage();
    await expect.poll(async () => (await replica.state()).status).toBe("offline");
    expect(replica.storage.size).toBe(1);
  });

  it("restores every rapid local intent before reconnecting", async () => {
    const principal = {
      id: "member-restart",
      organization: "company-restart",
      roles: ["operator"],
    } as const;
    const storage = new Map<string, unknown>();
    {
      await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: {} as Projection.Reference<typeof operations>,
        rows: ["orders"],
        dependencies: {
          orders: {} as Aggregate.Reference<typeof orders>,
        },
        name: "localOperations",
        version: 2,
        storage,
        online: false,
      });
      const first = replica.client.placeOrder({
        id: "order-restart-1",
        product: "product-1",
        quantity: 1,
        note: "First",
      });
      const second = replica.client.placeOrder({
        id: "order-restart-2",
        product: "product-2",
        quantity: 2,
        note: "Second",
      });
      expect([first.id, second.id]).toEqual(["fixture-command-1", "fixture-command-2"]);
      await expect
        .poll(
          () =>
            (
              storage.get("replica:localOperations:member-restart:1") as
                | { pending?: readonly object[] }
                | undefined
            )?.pending?.length,
        )
        .toBe(2);
      expect(replica.responses).toEqual([]);
    }

    await using restarted = await createReplicaFixture(localOperations, localOperationsDefinition, {
      principal,
      projection: {} as Projection.Reference<typeof operations>,
      rows: ["orders"],
      dependencies: {
        orders: {} as Aggregate.Reference<typeof orders>,
      },
      name: "localOperations",
      version: 2,
      storage,
      online: false,
    });
    await expect(restarted.state()).resolves.toMatchObject({
      status: "offline",
      pending: [
        { id: "fixture-command-1", command: "placeOrder" },
        { id: "fixture-command-2", command: "placeOrder" },
      ],
      data: {
        orders: [
          { id: "order-restart-1", note: "First" },
          { id: "order-restart-2", note: "Second" },
        ],
      },
    });
    expect(restarted.responses).toEqual([]);
  });

  it("fences pending intent and local persistence across authorization versions", async () => {
    const principal = {
      id: "member-policy",
      organization: "company-policy",
      roles: ["operator"],
    } as const;
    const storage = new Map<string, unknown>();
    await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
      principal,
      authorizationVersion: 1,
      projection: {} as Projection.Reference<typeof operations>,
      rows: ["orders"],
      dependencies: {
        orders: {} as Aggregate.Reference<typeof orders>,
      },
      name: "localOperations",
      version: 2,
      storage,
      online: false,
    });

    replica.client.placeOrder({
      id: "order-policy-1",
      product: "product-policy",
      quantity: 1,
      note: "Issued under policy one",
    });
    await expect
      .poll(
        () =>
          (
            storage.get("replica:localOperations:member-policy:1") as
              | { pending?: readonly object[] }
              | undefined
          )?.pending?.length,
      )
      .toBe(1);

    await replica.principal(principal, 2);
    await expect.poll(async () => (await replica.state()).status).toBe("offline");
    await expect(replica.state()).resolves.toMatchObject({
      status: "offline",
      data: { orders: [] },
      pending: [],
      rejected: [
        {
          pending: { id: "fixture-command-1", command: "placeOrder" },
          message: "Authorization context changed before the command was committed.",
        },
      ],
    });
    expect(storage.has("replica:localOperations:member-policy:2")).toBe(false);
  });

  it("applies the declared sign-out retention policy at the local store boundary", async () => {
    const principal = {
      id: "member-private",
      organization: "company-private",
      roles: ["operator"],
    } as const;
    const storage = new Map<string, unknown>();
    await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
      principal,
      projection: {} as Projection.Reference<typeof operations>,
      rows: ["orders"],
      dependencies: {
        orders: {} as Aggregate.Reference<typeof orders>,
      },
      name: "localOperations",
      version: 2,
      storage,
      online: false,
      retention: "clear-on-sign-out",
    });

    replica.client.placeOrder({
      id: "private-order",
      product: "private-product",
      quantity: 1,
      note: "Clear on sign-out",
    });
    await expect.poll(() => storage.has("replica:localOperations:member-private:1")).toBe(true);

    await replica.principal(undefined);
    await expect.poll(async () => (await replica.state()).status).toBe("signed-out");
    await expect(replica.state()).resolves.toEqual({
      status: "signed-out",
      pending: [],
      rejected: [],
    });
    await expect.poll(() => storage.has("replica:localOperations:member-private:1")).toBe(false);

    await replica.principal(principal);
    await expect.poll(async () => (await replica.state()).status).toBe("offline");
    await expect(replica.state()).resolves.toMatchObject({
      data: { orders: [] },
      pending: [],
      rejected: [],
    });
  });

  it("converges independent live clients without an explicit pull", async () => {
    const projection = compileSystemFixture(
      resolve(import.meta.dirname, "../projection/feature.typecheck.ts"),
      [serverCompilerExtension],
    ).programs.find(({ name }) => name === "server");
    if (!projection) throw new Error("Projection fixture has no server Program.");
    const linked = linkProgram(projection);
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
      configuration: { database: ":memory:" },
      providers: operations.providers.server,
    });
    const principal = {
      id: "member-live",
      organization: "company-live",
      roles: ["operator"],
    } as const;
    let blockSecondCommand = false;
    let releaseSecondCommand!: () => void;
    const secondCommandBlocked = new Promise<void>((resolve) => {
      releaseSecondCommand = resolve;
    });

    try {
      await using execution = await executeServerLinkedProgramIR(
        linked,
        host as Parameters<typeof executeServerLinkedProgramIR>[1],
      );
      const dependencies = {
        operations: execution.dependencies.operations as Projection.Reference<typeof operations>,
        orders: execution.dependencies.orders as Aggregate.Reference<typeof orders>,
      };
      await using first = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: dependencies.operations,
        rows: ["orders"],
        dependencies: { orders: dependencies.orders },
        name: "localOperations",
        version: 2,
        identifierPrefix: "first",
      });
      await using second = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: dependencies.operations,
        rows: ["orders"],
        dependencies: { orders: dependencies.orders },
        name: "localOperations",
        version: 2,
        identifierPrefix: "second",
        beforeCommand() {
          return blockSecondCommand ? secondCommandBlocked : undefined;
        },
      });

      await first.client.placeOrder({
        id: "order-live",
        product: "product-live",
        quantity: 2,
        note: "Created elsewhere",
      });
      await expect
        .poll(async () => (await second.state()).data?.orders)
        .toMatchObject([{ id: "order-live", status: "placed" }]);

      await first.client.cancelOrder({
        id: "order-live",
        reason: "Updated elsewhere",
      });
      await expect
        .poll(async () => (await second.state()).data?.orders)
        .toMatchObject([{ id: "order-live", status: "cancelled" }]);

      await second.principal(undefined);
      await second.principal(principal);
      await expect.poll(async () => (await second.state()).status).toBe("synchronized");

      await first.client.placeOrder({
        id: "order-after-session-replacement",
        product: "product-live",
        quantity: 1,
        note: "Created after immediate sign-out and sign-in",
      });
      await expect
        .poll(async () => (await second.state()).data?.orders)
        .toMatchObject([
          { id: "order-live", status: "cancelled" },
          { id: "order-after-session-replacement", status: "placed" },
        ]);

      const secondAdmission = second.client.cancelOrder({
        id: "order-after-session-replacement",
        reason: "Session remains writable",
      });
      expect(secondAdmission.id).toMatch(/^second-command-/);
      await expect
        .poll(async () => (await first.state()).data?.orders)
        .toMatchObject([
          { id: "order-live", status: "cancelled" },
          { id: "order-after-session-replacement", status: "cancelled" },
        ]);

      blockSecondCommand = true;
      second.client.placeOrder({
        id: "order-local-pending",
        product: "product-local",
        quantity: 1,
        note: "Must survive an authoritative rebase",
      });
      await expect.poll(async () => (await second.state()).pending.length).toBe(1);

      await first.client.placeOrder({
        id: "order-remote-during-pending",
        product: "product-remote",
        quantity: 1,
        note: "Must become visible before the local command finishes",
      });
      await expect
        .poll(async () => {
          const ids = (await second.state()).data?.orders.map(({ id }) => id) ?? [];
          return ids.includes("order-local-pending") && ids.includes("order-remote-during-pending");
        })
        .toBe(true);
      await expect(second.state()).resolves.toMatchObject({
        pending: [{ command: "placeOrder", input: { id: "order-local-pending" } }],
      });

      blockSecondCommand = false;
      releaseSecondCommand();
      await expect.poll(async () => (await second.state()).pending.length).toBe(0);
      await expect
        .poll(async () => {
          const ids = (await first.state()).data?.orders.map(({ id }) => id) ?? [];
          return ids.includes("order-local-pending") && ids.includes("order-remote-during-pending");
        })
        .toBe(true);

      const sharedStorage = new Map<string, unknown>();
      await using firstTab = await createReplicaFixture(
        localOperations,
        localOperationsDefinition,
        {
          principal,
          projection: dependencies.operations,
          rows: ["orders"],
          dependencies: { orders: dependencies.orders },
          name: "localOperations",
          version: 2,
          identifierPrefix: "first-tab",
          storage: sharedStorage,
          online: false,
        },
      );
      await using secondTab = await createReplicaFixture(
        localOperations,
        localOperationsDefinition,
        {
          principal,
          projection: dependencies.operations,
          rows: ["orders"],
          dependencies: { orders: dependencies.orders },
          name: "localOperations",
          version: 2,
          identifierPrefix: "second-tab",
          storage: sharedStorage,
          online: false,
        },
      );
      firstTab.client.placeOrder({
        id: "order-shared-outbox",
        product: "product-shared",
        quantity: 1,
        note: "One durable intent restored by two tabs",
      });
      await expect
        .poll(async () => (await secondTab.state()).pending)
        .toMatchObject([{ id: "first-tab-command-1", command: "placeOrder" }]);
      await expect(secondTab.state()).resolves.toMatchObject({
        data: {
          orders: expect.arrayContaining([
            expect.objectContaining({ id: "order-shared-outbox", status: "placed" }),
          ]),
        },
      });

      firstTab.online(true);
      secondTab.online(true);
      await Promise.all([firstTab.client.synchronize(), secondTab.client.synchronize()]);
      await expect.poll(async () => (await firstTab.state()).pending.length).toBe(0);
      await expect.poll(async () => (await secondTab.state()).pending.length).toBe(0);
      const sharedUploads = [...firstTab.responses, ...secondTab.responses].filter(
        ({ method, path }) => method === "POST" && path.endsWith("/placeOrder"),
      );
      expect(sharedUploads).toHaveLength(1);
      await expect(firstTab.state()).resolves.toMatchObject({
        data: {
          orders: expect.arrayContaining([
            expect.objectContaining({ id: "order-shared-outbox", status: "placed" }),
          ]),
        },
      });
      await expect(secondTab.state()).resolves.toMatchObject({
        data: {
          orders: expect.arrayContaining([
            expect.objectContaining({ id: "order-shared-outbox", status: "placed" }),
          ]),
        },
      });
    } finally {
      releaseSecondCommand();
      await disposeHost(host);
    }
  });

  it("upgrades a persisted previous-version projection before connecting", async () => {
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;
    const storage = new Map<string, unknown>([
      [
        "replica:localOperations:member-1:1",
        {
          version: 1,
          authorization: 1,
          principal,
          cursor: "old",
          committed: {
            orders: [
              {
                id: "order-old",
                organization: "company-1",
                product: "product-1",
                status: "placed",
                quantity: 1,
                value: 10,
                embedding: [1, 1, 0],
              },
            ],
          },
          pending: [
            {
              id: "old-place-command",
              command: "placeOrder",
              input: {
                id: "order-from-old-client",
                product: "product-old",
                quantity: 3,
              },
            },
            {
              id: "old-command",
              command: "cancelOrder",
              input: { id: "order-old", reason: "Changed mind" },
            },
          ],
          rejected: [],
        },
      ],
    ]);
    await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
      principal,
      projection: {} as Projection.Reference<typeof operations>,
      rows: ["orders"],
      dependencies: {
        orders: {} as Aggregate.Reference<typeof orders>,
      },
      name: "localOperations",
      version: 2,
      storage,
      online: false,
    });

    await expect(replica.state()).resolves.toMatchObject({
      status: "offline",
      pending: [
        {
          id: "old-place-command",
          command: "placeOrder",
          input: { note: "" },
        },
        { id: "old-command", command: "cancelOrder" },
      ],
      data: {
        orders: [
          { id: "order-old", note: "", status: "cancelled" },
          { id: "order-from-old-client", note: "", status: "placed" },
        ],
      },
    });
  });
});

async function disposeHost(host: Readonly<Record<string, unknown>>): Promise<void> {
  const disposed = new Set<object>();
  for (const resource of Object.values(host)) {
    if (typeof resource !== "object" || resource === null || disposed.has(resource)) continue;
    disposed.add(resource);
    const asyncDispose = (resource as Partial<AsyncDisposable>)[Symbol.asyncDispose];
    if (typeof asyncDispose === "function") {
      await asyncDispose.call(resource);
      continue;
    }
    const dispose = (resource as Partial<Disposable>)[Symbol.dispose];
    if (typeof dispose === "function") dispose.call(resource);
  }
}
