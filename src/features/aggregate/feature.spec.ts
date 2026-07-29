import { resolve } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { dispatchDependency } from "@/core/dependency";
import { type Aggregate, createAggregateFixture } from "@/features/aggregate";
import { orderDefinition, orders } from "@/features/aggregate/feature.typecheck";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { executeServerLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";

let compiledFixture: ReturnType<typeof compileSystem> | undefined;

function aggregateFixtureServer() {
  compiledFixture ??= compileSystem(resolve(import.meta.dirname, "feature.typecheck.ts"), [
    serverCompilerExtension,
  ]);
  const server = compiledFixture.programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Aggregate fixture has no server Program.");
  return server;
}

describe("Aggregate", () => {
  it("lowers Aggregate and its Actor runtime to ordinary portable Programs", () => {
    const server = aggregateFixtureServer();

    expect(
      server.contributions.map((contribution) => ({
        id: contribution.id,
        kind: serverProgramExecution(contribution).kind,
      })),
    ).toEqual([
      { id: "feature/orders/program/server", kind: "portable" },
      { id: "feature/orders.runtime/program/server", kind: "portable" },
    ]);
    expect(JSON.stringify(server)).not.toContain('"kind":"aggregate"');
    expect(JSON.stringify(server)).not.toContain('"kind":"actor"');
  });

  it("owns a fast pure fixture for decisions, evolution, replay, and migration", async () => {
    const fixture = createAggregateFixture(orders, orderDefinition, { dependencies: {} });
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;
    const initial = fixture.initial({ key: "order-1" });
    const placed = await fixture.execute({
      command: "place",
      key: "order-1",
      principal,
      state: initial,
      input: { product: "product-1", quantity: 2, note: "Handle carefully" },
      invocation: { id: "place-order-1", at: 10 },
    });

    expect(placed).toMatchObject({
      outcome: { status: "succeeded", value: { revision: 1 } },
      snapshot: {
        revision: 1,
        state: {
          organization: "company-1",
          status: "placed",
          product: "product-1",
          quantity: 2,
          note: "Handle carefully",
        },
      },
      events: [
        {
          placed: {
            organization: "company-1",
            product: "product-1",
            quantity: 2,
            note: "Handle carefully",
          },
        },
      ],
    });
    expect(fixture.replay({ key: "order-1", events: placed.events })).toEqual(placed.snapshot);
    expect(
      fixture.migrate({
        type: "placed",
        version: 1,
        data: { product: "legacy-product", quantity: 4 },
      }),
    ).toEqual({
      type: "placed",
      version: 3,
      data: {
        organization: "",
        product: "legacy-product",
        quantity: 4,
        note: "",
      },
    });

    const duplicatePlace = await fixture.execute({
      command: "place",
      key: "order-1",
      principal,
      state: placed.snapshot,
      input: { product: "product-2", quantity: 1, note: "" },
    });
    expect(duplicatePlace).toEqual({
      outcome: {
        status: "failed",
        failure: { type: "alreadyPlaced", data: {} },
      },
      snapshot: placed.snapshot,
      events: [],
    });
  });

  it("keeps incremental evolution equivalent to replay for arbitrary command sequences", async () => {
    const fixture = createAggregateFixture(orders, orderDefinition, { dependencies: {} });
    type OrderEvent = Parameters<typeof fixture.replay>[0]["events"][number];
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;
    const command = fc.oneof(
      fc.record({
        type: fc.constant("place" as const),
        product: fc.string({ minLength: 1, maxLength: 24 }),
        quantity: fc.integer({ min: 1, max: 1_000 }),
        note: fc.string({ maxLength: 80 }),
      }),
      fc.record({
        type: fc.constant("cancel" as const),
        reason: fc.string({ minLength: 1, maxLength: 80 }),
      }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(command, { maxLength: 30 }), async (commands) => {
        let snapshot = fixture.initial({ key: "order-property" });
        const history: OrderEvent[] = [];
        for (const [index, current] of commands.entries()) {
          const execution =
            current.type === "place"
              ? await fixture.execute({
                  command: "place",
                  key: "order-property",
                  principal,
                  state: snapshot,
                  input: {
                    product: current.product,
                    quantity: current.quantity,
                    note: current.note,
                  },
                  invocation: { id: `property-${index}`, at: index },
                })
              : await fixture.execute({
                  command: "cancel",
                  key: "order-property",
                  principal,
                  state: snapshot,
                  input: { reason: current.reason },
                  invocation: { id: `property-${index}`, at: index },
                });
          snapshot = execution.snapshot;
          history.push(...execution.events);
          expect(fixture.replay({ key: "order-property", events: history })).toEqual(snapshot);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("authorizes, evolves, migrates, deduplicates, and recovers through its public Dependency", async () => {
    const linked = linkProgram(aggregateFixtureServer());
    const host = await createNodeHost({
      dependencies: projectDependencyContracts(linked.external),
      database: ":memory:",
    });
    const operator = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;
    const outsider = {
      id: "member-2",
      organization: "company-2",
      roles: ["operator"],
    } as const;

    try {
      const dependencies = host as Parameters<typeof executeServerLinkedProgramIR>[1];
      await using first = await executeServerLinkedProgramIR(linked, dependencies);
      const aggregate = first.dependencies.orders as Aggregate.Reference<typeof orders>;
      const order = aggregate.get({ key: "order-1", principal: operator });

      await expect(
        order.place(
          { product: "product-1", quantity: 2, note: "Handle carefully" },
          { idempotencyKey: "place-order-1" },
        ),
      ).resolves.toEqual({
        status: "succeeded",
        value: { revision: 1 },
      });
      await expect(
        order.place(
          { product: "product-1", quantity: 2, note: "Handle carefully" },
          { idempotencyKey: "place-order-1" },
        ),
      ).resolves.toEqual({
        status: "succeeded",
        value: { revision: 1 },
      });
      await expect(order.state()).resolves.toEqual({
        revision: 1,
        state: {
          organization: "company-1",
          status: "placed",
          product: "product-1",
          quantity: 2,
          note: "Handle carefully",
        },
      });
      await expect(order.events({})).resolves.toMatchObject({
        done: true,
        entries: [
          {
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
            metadata: {
              command: "place",
              invocation: "idempotency:place-order-1",
            },
          },
        ],
      });
      const feed = first.dependencies.ordersEvents as Aggregate.Events<typeof orders>;
      await expect(feed.scan({ limit: 10 })).resolves.toMatchObject({
        done: true,
        entries: [
          {
            aggregate: "orders",
            key: "order-1",
            type: "placed",
            version: 3,
          },
        ],
      });

      const unauthorized = aggregate.get({ key: "order-1", principal: outsider });
      await expect(
        unauthorized.cancel({ reason: "not mine" }, { idempotencyKey: "cancel-order-1" }),
      ).resolves.toEqual({
        status: "failed",
        failure: { type: "forbidden", data: {} },
      });
      await expect(unauthorized.state()).rejects.toMatchObject({
        name: "AggregateError",
        code: "forbidden",
      });

      await first[Symbol.asyncDispose]();
      await using restarted = await executeServerLinkedProgramIR(linked, dependencies);
      const recovered = (restarted.dependencies.orders as Aggregate.Reference<typeof orders>).get({
        key: "order-1",
        principal: operator,
      });
      await expect(recovered.state()).resolves.toMatchObject({
        revision: 1,
        state: { status: "placed", product: "product-1" },
      });

      await dispatchDependency(host.events as object, "append", {
        stream: "actor:16:orders:aggregate:8:legacy-1",
        expectedRevision: 0,
        events: [
          {
            type: "actor.factory.recorded",
            invocation: "legacy-place-1",
            kind: "orders",
            record: {
              id: "legacy-place-1:1",
              aggregate: "orders",
              key: "legacy-1",
              revision: 1,
              type: "placed",
              version: 1,
              data: { product: "legacy-product", quantity: 4 },
              metadata: { command: "place", invocation: "legacy-place-1" },
              at: 1,
            },
            at: 1,
          },
        ],
      });
      const legacy = (restarted.dependencies.orders as Aggregate.Reference<typeof orders>).get({
        key: "legacy-1",
        principal: operator,
      });
      await expect(legacy.events({})).resolves.toMatchObject({
        entries: [
          {
            type: "placed",
            version: 3,
            data: {
              organization: "",
              product: "legacy-product",
              quantity: 4,
              note: "",
            },
          },
        ],
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
