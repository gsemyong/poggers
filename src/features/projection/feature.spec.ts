import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import type { DependencyImplementation } from "@/core/dependency";
import type { Aggregate } from "@/features/aggregate";
import type { orders } from "@/features/aggregate/feature.typecheck";
import {
  createMemoryProjectionStore,
  createProjectionFixture,
  createSqliteProjectionStore,
  evaluateIndexedProjectionRows,
  evaluateProjectionRows,
  type Projection,
  type ProjectionStore,
} from "@/features/projection";
import { operations, operationsDefinition } from "@/features/projection/feature.typecheck";
import { projectionStoreConformance } from "@/features/projection/testing";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { rustServerDependencyTarget } from "@/platforms/server/adapter/rust/testing";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";
import { compileSystemFixture } from "@/testing/compiler";
import { dependencyImplementationTarget } from "@/testing/dependency";

let compiledFixture: ReturnType<typeof compileSystemFixture> | undefined;

projectionStoreConformance.test(
  dependencyImplementationTarget("memory reference", createMemoryProjectionStore),
);

projectionStoreConformance.test(
  dependencyImplementationTarget("TypeScript SQLite", () =>
    createSqliteProjectionStore(new DatabaseSync(":memory:")),
  ),
);

projectionStoreConformance.test(
  rustServerDependencyTarget({
    name: "Rust SQLite",
    provider: {
      name: "queries",
      dependency: "queries",
      ...operations.providers!.server.queries.production,
      crate: {
        ...operations.providers!.server.queries.production.crate,
        directory: resolve(import.meta.dirname, "providers/server/rust"),
      },
    },
    async configuration() {
      return {
        values: { database: ":memory:" },
        dispose: () => undefined,
      };
    },
  }),
);

function projectionFixtureServer() {
  compiledFixture ??= compileSystemFixture(resolve(import.meta.dirname, "feature.typecheck.ts"), [
    serverCompilerExtension,
  ]);
  const server = compiledFixture.programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Projection fixture has no server Program.");
  return server;
}

describe("Projection", () => {
  it("keeps every browser-local index semantically identical to the portable evaluator", () => {
    const documents = [
      { id: "one", title: "Durable local task", note: "actor journal" },
      { id: "two", title: "Local search", note: "durable projection" },
      { id: "three", title: "Unrelated", note: "other value" },
    ] as const;
    const queries = [
      { text: { value: "durable", fields: ["title", "note"] } },
      { text: { value: "durable local", fields: ["title", "note"] } },
      {
        text: { value: "durable", fields: ["title", "note"] },
        select: { where: { id: { not: "two" } } },
      },
    ] as const;

    for (const query of queries) {
      expect(evaluateIndexedProjectionRows(documents, query)).toEqual(
        evaluateProjectionRows(documents, query),
      );
    }

    const vectors = [
      { id: "one", embedding: [1, 0, 0] },
      { id: "two", embedding: [0.5, 0.5, 0] },
      { id: "three", embedding: [0, 1, 0] },
    ] as const;
    const vector = { vector: { field: "embedding", value: [1, 0, 0], limit: 2 } } as const;
    expect(evaluateIndexedProjectionRows(vectors, vector)).toEqual(
      evaluateProjectionRows(vectors, vector),
    );

    const edges = [
      { id: "one", from: "a", to: "b" },
      { id: "two", from: "b", to: "c" },
      { id: "three", from: "d", to: "a" },
    ] as const;
    for (const direction of ["outgoing", "incoming", "both"] as const) {
      const graph = { graph: { from: "from", to: "to", start: "a", depth: 2, direction } };
      expect(evaluateIndexedProjectionRows(edges, graph)).toEqual(
        evaluateProjectionRows(edges, graph),
      );
    }

    const places = [
      {
        id: "near",
        location: { latitude: 48.1486, longitude: 17.1077 },
      },
      {
        id: "near-tie",
        location: { latitude: 48.1486, longitude: 17.1077 },
      },
      {
        id: "far",
        location: { latitude: 49.1486, longitude: 18.1077 },
      },
    ] as const;
    const geo = {
      geo: {
        field: "location",
        origin: { latitude: 48.1486, longitude: 17.1077 },
        within: 1_000,
      },
    } as const;
    expect(evaluateIndexedProjectionRows(places, geo)).toEqual(evaluateProjectionRows(places, geo));

    const values = [
      { id: "one", group: "open", value: 4 },
      { id: "two", group: "open", value: 6 },
      { id: "three", group: "closed", value: 9 },
    ] as const;
    const analytics = {
      analytics: {
        groupBy: ["group"],
        measures: {
          count: { count: true },
          sum: { sum: "value" },
          minimum: { minimum: "value" },
          maximum: { maximum: "value" },
          average: { average: "value" },
        },
      },
    } as const;
    expect(evaluateIndexedProjectionRows(values, analytics)).toEqual(
      evaluateProjectionRows(values, analytics),
    );
  });

  it("lowers Projection, Aggregate, and Actor as ordinary portable Programs", () => {
    const server = projectionFixtureServer();

    expect(
      server.contributions.map((contribution) => ({
        id: contribution.id,
        kind: serverProgramExecution(contribution, server).kind,
      })),
    ).toEqual([
      { id: "feature/operations/program/server", kind: "portable" },
      { id: "feature/orders/program/server", kind: "portable" },
      { id: "feature/orders.runtime/program/server", kind: "portable" },
    ]);
    expect(JSON.stringify(server)).not.toContain('"kind":"projection"');
  });

  it("rebuilds deterministically and queries through its fast reference fixture", async () => {
    const fixture = createProjectionFixture(operations, operationsDefinition);
    const placed = {
      id: "placed-1:1",
      aggregate: "orders",
      key: "order-1",
      revision: 1,
      type: "placed",
      version: 3,
      data: {
        organization: "company-1",
        product: "product-1",
        quantity: 2,
        note: "Handle carefully",
      },
      metadata: { command: "place", invocation: "placed-1" },
      at: 1,
    } as const;
    const rows = await fixture.rebuild({ sources: { orders: [placed] } });
    const rebuilt = await fixture.rebuild({ sources: { orders: [placed] } });

    expect(rebuilt).toEqual(rows);
    await expect(
      fixture.query({
        rows,
        row: "orders",
        principal: {
          id: "member-1",
          organization: "company-1",
          roles: ["operator"],
        },
        query: { text: { value: "Handle", fields: ["note"] } },
      }),
    ).resolves.toMatchObject({
      kind: "rows",
      matches: [{ row: { id: "order-1" }, score: 1 }],
    });
  });

  it("checkpoints a projection backlog in bounded event-feed batches", async () => {
    const linked = linkProgram(projectionFixtureServer());
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
      configuration: { database: ":memory:" },
      providers: operations.providers.server,
    });
    const principal = {
      id: "member-batch",
      organization: "company-batch",
      roles: ["operator"],
    } as const;

    try {
      await using execution = await executeServerLinkedProgramIR(
        linked,
        host as Parameters<typeof executeServerLinkedProgramIR>[1],
      );
      const authority = execution.dependencies.orders as Aggregate.Reference<typeof orders>;
      await Promise.all(
        Array.from({ length: 101 }, async (_, index) => {
          const id = `batch-order-${index}`;
          await authority
            .get({ key: id, principal })
            .place(
              { product: `product-${index}`, quantity: 1, note: "Batched projection" },
              { idempotencyKey: `batch-place-${index}` },
            );
        }),
      );

      const view = (
        execution.dependencies.operations as Projection.Reference<typeof operations>
      ).for({ principal });
      await expect(view.orders({ find: { limit: 1 } })).resolves.toMatchObject({
        kind: "rows",
        revision: 2,
        matches: [{ row: { id: expect.any(String) } }],
      });
    } finally {
      await disposeHost(host);
    }
  });

  it("reloads and resumes after another projection runner wins the checkpoint race", async () => {
    const linked = linkProgram(projectionFixtureServer());
    const reference = createMemoryProjectionStore();
    let conflicts = 0;
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
      configuration: { database: ":memory:" },
      providers: {
        ...operations.providers.server,
        queries: {
          ...operations.providers.server.queries,
          development() {
            return {
              ...reference,
              async commit(call) {
                if (conflicts === 0) {
                  conflicts += 1;
                  await reference.commit(call);
                  return undefined;
                }
                return reference.commit(call);
              },
            } satisfies DependencyImplementation<ProjectionStore>;
          },
        },
      },
    });
    const principal = {
      id: "member-race",
      organization: "company-race",
      roles: ["operator"],
    } as const;

    try {
      await using execution = await executeServerLinkedProgramIR(
        linked,
        host as Parameters<typeof executeServerLinkedProgramIR>[1],
      );
      const authority = execution.dependencies.orders as Aggregate.Reference<typeof orders>;
      await authority
        .get({ key: "race-order", principal })
        .place(
          { product: "product-race", quantity: 1, note: "Checkpoint race" },
          { idempotencyKey: "place-race-order" },
        );

      const view = (
        execution.dependencies.operations as Projection.Reference<typeof operations>
      ).for({ principal });
      await expect(view.orders({ find: {} })).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "race-order" } }],
      });
      expect(conflicts).toBe(1);
    } finally {
      await disposeHost(host);
    }
  });

  it("checkpoints migrated Aggregate events and evaluates every declared query meaning", async () => {
    const linked = linkProgram(projectionFixtureServer());
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
      configuration: { database: ":memory:" },
      providers: operations.providers.server,
    });
    const dependencies = host as Parameters<typeof executeServerLinkedProgramIR>[1];
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;

    try {
      await using first = await executeServerLinkedProgramIR(linked, dependencies);
      const order = (first.dependencies.orders as Aggregate.Reference<typeof orders>).get({
        key: "order-1",
        principal,
      });
      await expect(
        order.place(
          { product: "product-1", quantity: 2, note: "Handle carefully" },
          { idempotencyKey: "place-projected-order" },
        ),
      ).resolves.toMatchObject({ status: "succeeded" });

      const view = (first.dependencies.operations as Projection.Reference<typeof operations>).for({
        principal,
      });
      const concurrent = await Promise.all(
        Array.from({ length: 16 }, () =>
          view.orders({
            find: {
              where: { status: { equal: "placed" }, quantity: { atLeast: 2 } },
              order: [{ field: "quantity", direction: "descending" }],
            },
          }),
        ),
      );
      expect(concurrent).toHaveLength(16);
      expect(concurrent[0]).toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1", status: "placed", quantity: 2 } }],
      });
      await expect(
        view.orders({
          find: {
            where: { status: { equal: "placed" }, quantity: { atLeast: 2 } },
            order: [{ field: "quantity", direction: "descending" }],
          },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1", status: "placed", quantity: 2 } }],
      });
      await expect(
        view.orders({
          text: { value: "Handle", fields: ["product", "note"] },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1" }, score: 1 }],
      });
      await expect(
        view.orders({
          vector: { field: "embedding", value: [2, 1, 0], limit: 1 },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1" }, score: 1 }],
      });
      await expect(
        view.substitutions({
          graph: {
            from: "from",
            to: "to",
            start: "product-1",
            depth: 2,
          },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { from: "product-1", to: "product-1-alternative" }, distance: 1 }],
      });
      await expect(
        view.warehouses({
          geo: {
            field: "location",
            origin: { latitude: 48.1486, longitude: 17.1077 },
            within: 1,
          },
        }),
      ).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { organization: "company-1" }, distance: 0 }],
      });
      await expect(
        view.orders({
          analytics: {
            groupBy: ["status"],
            measures: {
              count: { count: true },
              value: { sum: "value" },
            },
          },
        }),
      ).resolves.toMatchObject({
        kind: "analytics",
        groups: [{ key: { status: "placed" }, measures: { count: 1, value: 20 } }],
      });

      const outsider = (
        first.dependencies.operations as Projection.Reference<typeof operations>
      ).for({
        principal: {
          id: "member-2",
          organization: "company-2",
          roles: ["operator"],
        },
      });
      await expect(outsider.orders({ find: {} })).resolves.toMatchObject({
        kind: "rows",
        matches: [],
      });

      await first[Symbol.asyncDispose]();
      await using restarted = await executeServerLinkedProgramIR(linked, dependencies);
      const recovered = (
        restarted.dependencies.operations as Projection.Reference<typeof operations>
      ).for({ principal });
      await expect(recovered.orders({ find: {} })).resolves.toMatchObject({
        kind: "rows",
        matches: [{ row: { id: "order-1" } }],
      });
    } finally {
      await disposeHost(host);
    }
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
