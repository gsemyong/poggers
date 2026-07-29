import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import type { Aggregate } from "@/features/aggregate";
import type { orders } from "@/features/aggregate/feature.typecheck";
import type { Projection } from "@/features/projection";
import type { operations } from "@/features/projection/feature.typecheck";
import { createReplicaFixture } from "@/features/replica";
import { localOperations, localOperationsDefinition } from "@/features/replica/feature.typecheck";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";

describe("Replica", () => {
  it("lowers its authority as ordinary portable meaning and retains client contracts", () => {
    const compiled = compileSystem(resolve(import.meta.dirname, "feature.typecheck.ts"), [
      serverCompilerExtension,
      webCompilerExtension,
    ]);
    const server = compiled.programs.find(({ name }) => name === "server");
    expect(server).toBeDefined();
    const replica = server?.contributions.find(
      ({ id }) => id === "feature/localOperations/program/server",
    );
    expect(replica && serverProgramExecution(replica).kind).toBe("portable");
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
    const projection = compileSystem(
      resolve(import.meta.dirname, "../projection/feature.typecheck.ts"),
      [serverCompilerExtension],
    ).programs.find(({ name }) => name === "server");
    if (!projection) throw new Error("Projection fixture has no server Program.");
    const linked = linkProgram(projection);
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
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
      await using replica = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: dependencies.operations,
        rows: ["orders"],
        dependencies: { orders: dependencies.orders },
        name: "localOperations",
        version: 2,
        storage,
      });
      await expect(replica.state()).resolves.toMatchObject({
        status: "synchronized",
        data: { orders: [] },
      });

      replica.online(false);
      const admission = await replica.client.placeOrder({
        id: "order-1",
        product: "product-1",
        quantity: 2,
        note: "Handle carefully",
      });
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
      await expect(
        replica.client.orders({
          text: { value: "Handle", fields: ["note"] },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1" }, score: 1 }],
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
      expect((await replica.state()).data).toBeUndefined();
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
      await expect(incompatible.state()).resolves.toMatchObject({
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

  it("converges independent live clients without an explicit pull", async () => {
    const projection = compileSystem(
      resolve(import.meta.dirname, "../projection/feature.typecheck.ts"),
      [serverCompilerExtension],
    ).programs.find(({ name }) => name === "server");
    if (!projection) throw new Error("Projection fixture has no server Program.");
    const linked = linkProgram(projection);
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
    });
    const principal = {
      id: "member-live",
      organization: "company-live",
      roles: ["operator"],
    } as const;

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
      });
      await using second = await createReplicaFixture(localOperations, localOperationsDefinition, {
        principal,
        projection: dependencies.operations,
        rows: ["orders"],
        dependencies: { orders: dependencies.orders },
        name: "localOperations",
        version: 2,
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
    } finally {
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
        "replica:localOperations:member-1",
        {
          version: 1,
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
