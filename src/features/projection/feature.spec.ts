import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import type { Aggregate } from "@/features/aggregate";
import type { orders } from "@/features/aggregate/feature.typecheck";
import { createProjectionFixture, type Projection } from "@/features/projection";
import { operations, operationsDefinition } from "@/features/projection/feature.typecheck";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";

let compiledFixture: ReturnType<typeof compileSystem> | undefined;

function projectionFixtureServer() {
  compiledFixture ??= compileSystem(resolve(import.meta.dirname, "feature.typecheck.ts"), [
    serverCompilerExtension,
  ]);
  const server = compiledFixture.programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Projection fixture has no server Program.");
  return server;
}

describe("Projection", () => {
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
    const fixture = createProjectionFixture(operations, operationsDefinition, {
      dependencies: {},
    });
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

  it("checkpoints migrated Aggregate events and evaluates every declared query meaning", async () => {
    const linked = linkProgram(projectionFixtureServer());
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
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
