import { expect, test } from "bun:test";

import { defineApp, testFeature } from "@poggers/kit/testing";
import definition, { type App } from "src/app";
import type { OrdersDependencies } from "src/features/orders";

test("the payment program settles an order and updates its projection", async () => {
  const authorizations: Array<{ orderId: string; total: number }> = [];
  const payments: OrdersDependencies["payments"] = {
    async authorize({ orderId, total }) {
      authorizations.push({ orderId, total });
      return "approved";
    },
  };
  const runtime = await testFeature(defineApp<App>(definition), "orders", {
    actor: { id: "owner" },
    dependencies: { server: { payments } },
  });
  const orders = runtime.api.orders;
  const summary = runtime.api.summary;

  orders.inspect({ orderId: "preview" });
  expect(orders.inspectors).toBe(1);
  orders.inspect({ orderId: null });
  expect(orders.inspectors).toBe(0);

  expect(await orders.create({ title: "Launch review", total: 125 })).toMatchObject({ ok: true });
  await runtime.drain();

  const created = orders.orders[0];
  expect(created).toBeDefined();
  expect(authorizations).toEqual([{ orderId: created!.id, total: 125 }]);
  expect(orders.orders).toMatchObject([{ title: "Launch review", total: 125, status: "approved" }]);
  expect({
    approved: summary.approved,
    declined: summary.declined,
    revenue: summary.revenue,
  }).toEqual({ approved: 1, declined: 0, revenue: 125 });
  expect(
    runtime.events().map(({ resource, event }) => `${resource.split("/").at(-1)}.${event.name}`),
  ).toEqual(["orders.created", "orders.paymentSettled", "summary.recorded"]);
  expect(
    await summary.record({
      orderId: created!.id,
      status: "approved",
      total: 1_000,
    }),
  ).toEqual({ ok: false, error: "forbidden" });

  await runtime.dispose();
});

test("the feature fixture replaces production infrastructure and retains authorization", async () => {
  const runtime = await testFeature(defineApp<App>(definition), "orders", {
    actor: { id: "intruder" },
  });
  const orders = runtime.resource("orders", { ownerId: "owner" });

  expect(await orders.create({ title: "Unauthorized", total: 50 })).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(() => orders.orders).toThrow("Read is forbidden");

  await runtime.dispose();
});
