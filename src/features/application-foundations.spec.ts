import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectDependencyContracts } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { dependencyInvocation } from "@/core/dependency";
import type { Aggregate } from "@/features/aggregate";
import {
  default as applicationFoundations,
  localOperations,
  localOperationsDefinition,
  type fulfillment,
  type inventory,
  type operations,
  type operationsIdentity,
  type orders,
} from "@/features/application-foundations.typecheck";
import type { Identity } from "@/features/identity";
import type { Projection } from "@/features/projection";
import { createReplicaFixture } from "@/features/replica";
import type { Workflow } from "@/features/workflow";
import { workflowCompilerExtension } from "@/features/workflow/compiler";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { createNodeHost } from "@/platforms/server/adapter/typescript/host";
import { startServerProgramInstance } from "@/platforms/server/adapter/typescript/runtime";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";

let compiledFixture: ReturnType<typeof compileSystem> | undefined;

function applicationFoundationsServer() {
  compiledFixture ??= compileSystem(
    resolve(import.meta.dirname, "application-foundations.typecheck.ts"),
    [serverCompilerExtension, workflowCompilerExtension, webCompilerExtension],
  );
  const server = compiledFixture.programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Application foundations have no server Program.");
  return server;
}

describe("application foundations", () => {
  it(
    "composes every factory as ordinary portable Program and Dependency meaning",
    { timeout: 30_000 },
    () => {
      const server = applicationFoundationsServer();

      expect(
        server.contributions.map((contribution) => ({
          id: contribution.id,
          kind: serverProgramExecution(contribution).kind,
        })),
      ).toEqual([
        { id: "feature/fulfillment/program/server", kind: "portable" },
        { id: "feature/fulfillment.runtime/program/server", kind: "portable" },
        { id: "feature/fulfillment.schedules/program/server", kind: "portable" },
        { id: "feature/inventory/program/server", kind: "portable" },
        { id: "feature/inventory.runtime/program/server", kind: "portable" },
        { id: "feature/localOperations/program/server", kind: "portable" },
        { id: "feature/operations/program/server", kind: "portable" },
        { id: "feature/operationsIdentity/program/server", kind: "portable" },
        { id: "feature/orders/program/server", kind: "portable" },
        { id: "feature/orders.runtime/program/server", kind: "portable" },
      ]);
      expect(JSON.stringify(server)).not.toMatch(
        /"kind":"(?:actor|aggregate|projection|replica|workflow)"/,
      );
    },
  );

  it(
    "runs an authenticated offline order through fulfillment, projection, and recovery",
    { timeout: 60_000 },
    async () => {
      const linked = linkProgram(applicationFoundationsServer());
      const hostContracts = projectDependencyContracts(linked.external).filter(
        ({ name }) => !["authentication", "http", "shipping"].includes(name),
      );
      const host = await createNodeHost({
        dependencies: hostContracts,
        database: ":memory:",
      });
      const shipments: string[] = [];
      const external = {
        ...host,
        authentication: directDependency({
          async authenticate() {
            return {
              id: "member-1",
              name: "Operations Member",
              email: "member@example.test",
            };
          },
          async handle() {
            return {
              status: 404,
              headers: [],
              body: undefined,
              stream: undefined,
            };
          },
        }),
        http: directDependency({
          route() {
            return { [Symbol.dispose]() {} };
          },
        }),
        shipping: directDependency({
          async create({
            input,
          }: {
            input: Readonly<{
              organization: string;
              order: string;
              warehouse: string;
            }>;
          }) {
            shipments.push(input.order);
            return { tracking: `tracking-${input.order}` };
          },
        }),
      };
      const administrator = {
        id: "member-1",
        organization: "company-1",
        roles: ["administrator"],
      } as const;
      const storage = new Map<string, unknown>();

      try {
        await using first = await startServerProgramInstance(
          applicationFoundations,
          applicationFoundationsServer(),
          external,
        );
        const principal = await (
          first.dependencies.identity as Identity.Service<typeof operationsIdentity>
        ).authenticate({ cookie: "authenticated-session" });
        expect(principal).toEqual({
          id: "member-1",
          organization: "company-1",
          roles: ["operator"],
        });
        if (!principal) throw new Error("Canonical Identity did not establish a principal.");
        const stock = (first.dependencies.inventory as Aggregate.Reference<typeof inventory>).get({
          key: "company-1:warehouse-1:product-1",
          principal: administrator,
        });
        const secondStock = (
          first.dependencies.inventory as Aggregate.Reference<typeof inventory>
        ).get({
          key: "company-1:warehouse-1:product-2",
          principal: administrator,
        });
        await expect(
          stock.stock(
            {
              organization: "company-1",
              warehouse: "warehouse-1",
              product: "product-1",
              quantity: 10,
            },
            { idempotencyKey: "stock-product-1" },
          ),
        ).resolves.toMatchObject({ status: "succeeded" });
        await expect(
          secondStock.stock(
            {
              organization: "company-1",
              warehouse: "warehouse-1",
              product: "product-2",
              quantity: 5,
            },
            { idempotencyKey: "stock-product-2" },
          ),
        ).resolves.toMatchObject({ status: "succeeded" });

        await using replica = await createReplicaFixture(
          localOperations,
          localOperationsDefinition,
          {
            principal,
            projection: first.dependencies.operations as Projection.Reference<typeof operations>,
            rows: ["orders", "inventory"],
            dependencies: {
              fulfillment: first.dependencies.fulfillment as Workflow.Reference<typeof fulfillment>,
              orders: first.dependencies.orders as Aggregate.Reference<typeof orders>,
            },
            name: "localOperations",
            version: 1,
            storage,
          },
        );
        replica.online(false);
        const admission = await replica.client.placeOrder({
          id: "order-1",
          customer: "Ada",
          warehouse: "warehouse-1",
          lines: [
            { product: "product-1", quantity: 2, price: 25 },
            { product: "product-2", quantity: 1, price: 10 },
          ],
          note: "Deliver before noon",
        });
        expect(admission.id).toBe("fixture-command-1");
        await expect.poll(async () => (await replica.state()).status).toBe("offline");
        await expect(replica.state()).resolves.toMatchObject({
          status: "offline",
          pending: [{ id: "fixture-command-1", command: "placeOrder" }],
          data: {
            orders: [
              {
                id: "order-1",
                status: "placed",
                total: 60,
              },
            ],
          },
        });

        replica.online(true);
        await replica.client.synchronize();
        await expect(replica.state()).resolves.toMatchObject({
          status: "synchronized",
          pending: [],
          rejected: [],
        });
        const execution = (
          first.dependencies.fulfillment as Workflow.Reference<typeof fulfillment>
        ).get({ id: "order-1" });
        const result = await settledWorkflow(execution, shipments);
        expect(result).toEqual({
          status: "succeeded",
          value: { tracking: "tracking-order-1" },
        });
        expect(shipments).toEqual(["order-1"]);

        await replica.client.synchronize();
        await expect(replica.state()).resolves.toMatchObject({
          status: "synchronized",
          pending: [],
          rejected: [],
          data: {
            orders: [
              {
                id: "order-1",
                status: "shipped",
                tracking: "tracking-order-1",
              },
            ],
          },
        });
        await expect(stock.state()).resolves.toMatchObject({
          state: {
            available: 8,
            reservations: [],
          },
        });
        await expect(secondStock.state()).resolves.toMatchObject({
          state: {
            available: 4,
            reservations: [],
          },
        });

        const view = (first.dependencies.operations as Projection.Reference<typeof operations>).for(
          { principal },
        );
        await expect(
          view.orders({
            text: { value: "noon", fields: ["customer", "note"] },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [{ row: { id: "order-1", status: "shipped" }, score: 1 }],
        });
        await expect(
          view.orders({
            analytics: {
              groupBy: ["status"],
              measures: {
                count: { count: true },
                value: { sum: "total" },
              },
            },
          }),
        ).resolves.toMatchObject({
          kind: "analytics",
          groups: [
            {
              key: { status: "shipped" },
              measures: { count: 1, value: 60 },
            },
          ],
        });
        await expect(
          view.orders({
            vector: { field: "embedding", value: [60, 2, 1], limit: 1 },
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
              depth: 1,
            },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [
            {
              row: {
                from: "product-1",
                to: "product-1-alternative",
              },
              distance: 1,
            },
          ],
        });
        await expect(
          view.inventory({
            geo: {
              field: "location",
              origin: { latitude: 48.1486, longitude: 17.1077 },
              within: 1,
            },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [
            { row: { id: "company-1:warehouse-1:product-1" }, distance: 0 },
            { row: { id: "company-1:warehouse-1:product-2" }, distance: 0 },
          ],
        });

        const cancellableOrder = (
          first.dependencies.orders as Aggregate.Reference<typeof orders>
        ).get({ key: "order-cancelled-offline", principal });
        await expect(
          cancellableOrder.place(
            {
              customer: "Lin",
              lines: [{ product: "product-1", quantity: 1, price: 25 }],
              note: "Cancel while disconnected",
            },
            { idempotencyKey: "direct-cancellable-order" },
          ),
        ).resolves.toMatchObject({ status: "succeeded" });
        await replica.client.synchronize();
        replica.online(false);
        await replica.client.cancelOrder({
          id: "order-cancelled-offline",
          reason: "Customer changed their mind",
        });
        const offlineCancellation = await replica.state();
        expect(offlineCancellation.pending).toMatchObject([{ command: "cancelOrder" }]);
        expect(offlineCancellation.data?.orders).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "order-cancelled-offline",
              status: "cancelled",
            }),
          ]),
        );
        replica.online(true);
        await replica.client.synchronize();
        await expect(cancellableOrder.state()).resolves.toMatchObject({
          state: { status: "cancelled" },
        });

        await replica.client.placeOrder({
          id: "order-insufficient",
          customer: "Grace",
          warehouse: "warehouse-1",
          lines: [
            { product: "product-1", quantity: 1, price: 25 },
            { product: "product-2", quantity: 100, price: 10 },
          ],
          note: "Must compensate",
        });
        await replica.client.synchronize();
        const failedExecution = (
          first.dependencies.fulfillment as Workflow.Reference<typeof fulfillment>
        ).get({ id: "order-insufficient" });
        await expect(settledWorkflow(failedExecution, shipments)).resolves.toMatchObject({
          status: "failed",
          failure: { type: "inventory" },
        });
        const failedOrder = (first.dependencies.orders as Aggregate.Reference<typeof orders>).get({
          key: "order-insufficient",
          principal,
        });
        await expect(failedOrder.state()).resolves.toMatchObject({
          state: { status: "failed" },
        });
        await expect(stock.state()).resolves.toMatchObject({
          state: { available: 8, reservations: [] },
        });
        await expect(secondStock.state()).resolves.toMatchObject({
          state: { available: 4, reservations: [] },
        });
        expect(shipments).toEqual(["order-1"]);

        const outsider = (
          first.dependencies.operations as Projection.Reference<typeof operations>
        ).for({
          principal: {
            id: "member-2",
            organization: "company-2",
            roles: ["viewer"],
          },
        });
        await expect(outsider.orders({ find: {} })).resolves.toMatchObject({
          kind: "rows",
          matches: [],
        });

        replica.online(false);
        await replica.principal({
          ...principal,
          organization: "company-2",
        });
        await expect.poll(async () => (await replica.state()).status).toBe("offline");
        expect((await replica.state()).data).toBeUndefined();
        replica.online(true);
        await replica.client.synchronize();
        await expect(replica.state()).resolves.toMatchObject({
          status: "synchronized",
          data: { orders: [], inventory: [] },
        });

        await first[Symbol.asyncDispose]();
        await using recovered = await startServerProgramInstance(
          applicationFoundations,
          applicationFoundationsServer(),
          external,
        );
        const recoveredOrder = (
          recovered.dependencies.orders as Aggregate.Reference<typeof orders>
        ).get({ key: "order-1", principal });
        await expect(recoveredOrder.state()).resolves.toMatchObject({
          state: {
            status: "shipped",
            tracking: "tracking-order-1",
          },
        });
      } finally {
        await disposeHost(host);
      }
    },
  );
});

type FulfillmentExecution = Workflow.Instance<typeof fulfillment>;

async function settledWorkflow(
  execution: FulfillmentExecution,
  observations: readonly unknown[],
): Promise<Awaited<ReturnType<FulfillmentExecution["result"]>>> {
  let result = await execution.result();
  for (
    let attempt = 0;
    attempt < 200 && (result.status === "idle" || result.status === "running");
    attempt += 1
  ) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
    result = await execution.result();
  }
  if (result.status === "idle" || result.status === "running") {
    throw new Error(
      JSON.stringify(
        {
          result,
          state: await execution.state(),
          description: await execution.describe(),
          observations,
        },
        undefined,
        2,
      ),
    );
  }
  return result;
}

function directDependency<Api extends object>(
  api: Api,
): Api & {
  [dependencyInvocation](
    operation: string,
    input: unknown,
    invocation: Readonly<{ attempt: number }>,
  ): unknown;
} {
  return Object.assign(api, {
    [dependencyInvocation](
      operation: string,
      input: unknown,
      invocation: Readonly<{ attempt: number }>,
    ) {
      const method = Reflect.get(api, operation);
      if (typeof method !== "function") {
        throw new Error(`Unknown test Dependency operation ${operation}.`);
      }
      return Reflect.apply(method, api, [{ input, invocation }]);
    },
  });
}

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
