import { afterEach, describe, expect, it } from "bun:test";

import type { WorkflowClock } from "@poggers/kit";
import { defineApp, testFeature, type TestFeatureRuntime } from "@poggers/kit/testing";
import type { App } from "src/app";
import {
  createOrderFulfillment,
  type OrderFulfillmentDependencies,
} from "src/features/order-fulfillment";

class VirtualClock implements WorkflowClock {
  time = 0;
  readonly sleepers: Array<{
    readonly at: number;
    readonly signal: AbortSignal;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  }> = [];

  now = () => this.time;

  sleepUntil = (at: number, signal: AbortSignal): Promise<void> => {
    if (at <= this.time) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const sleeper = { at, signal, resolve, reject };
      this.sleepers.push(sleeper);
      signal.addEventListener(
        "abort",
        () => {
          const index = this.sleepers.indexOf(sleeper);
          if (index >= 0) this.sleepers.splice(index, 1);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  };

  advance(ms: number): void {
    this.time += ms;
    for (const sleeper of this.sleepers.filter(({ at }) => at <= this.time)) {
      this.sleepers.splice(this.sleepers.indexOf(sleeper), 1);
      sleeper.resolve();
    }
  }
}

type Runtime = TestFeatureRuntime<App, "fulfillment">;
const fixtures: Runtime[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

function createDependencies(
  overrides: Partial<OrderFulfillmentDependencies> = {},
): OrderFulfillmentDependencies {
  return {
    inventory: {
      async reserve(orderId) {
        return { reservationId: `reservation:${orderId}` };
      },
      async release() {
        return null;
      },
    },
    payments: {
      async authorize(orderId) {
        return { authorizationId: `authorization:${orderId}` };
      },
      async void() {
        return null;
      },
    },
    shipping: {
      async create(orderId) {
        return { trackingId: `tracking:${orderId}` };
      },
    },
    notifications: {
      async send() {
        return null;
      },
    },
    ...overrides,
  };
}

async function createFixture(dependencies: OrderFulfillmentDependencies): Promise<Runtime> {
  const app = defineApp<App>({
    version: 1,
    resources: {},
    features: { fulfillment: createOrderFulfillment<App>() },
  });
  const fixture = await testFeature(app, "fulfillment", {
    actor: { id: "owner" },
    dependencies: { server: dependencies },
  });
  fixtures.push(fixture);
  return fixture;
}

async function poll(assertion: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await Bun.sleep(10);
  }
  throw new Error("Condition was not reached.");
}

describe("order fulfillment Feature", () => {
  it("coordinates parallel work, approval, a child workflow, and notification", async () => {
    const clock = new VirtualClock();
    const calls: string[] = [];
    const fixture = await createFixture(
      createDependencies({
        clock,
        inventory: {
          async reserve(orderId) {
            calls.push("inventory.reserve");
            return { reservationId: `reservation:${orderId}` };
          },
          async release() {
            calls.push("inventory.release");
            return null;
          },
        },
        payments: {
          async authorize(orderId) {
            calls.push("payments.authorize");
            return { authorizationId: `authorization:${orderId}` };
          },
          async void() {
            calls.push("payments.void");
            return null;
          },
        },
        shipping: {
          async create(orderId) {
            calls.push("shipping.create");
            return { trackingId: `tracking:${orderId}` };
          },
        },
        notifications: {
          async send() {
            calls.push("notifications.send");
            return null;
          },
        },
      }),
    );
    await fixture.api.send({
      id: "order-1",
      name: "order/placed",
      data: {
        orderId: "order-1",
        total: 2_000,
        address: "Bratislava",
        approvalThreshold: 1_000,
      },
    });
    const order = fixture.api.getFunction("fulfillOrder", "order-1:fulfillOrder");
    await poll(() => order.details?.operations.approval?.status === "scheduled");

    expect(calls.slice(0, 2).sort()).toEqual(["inventory.reserve", "payments.authorize"]);
    await fixture.api.send({
      id: "approval-order-1",
      name: "order/approved",
      data: { orderId: "order-1", reviewerId: "reviewer-1" },
    });
    await fixture.drain();

    expect(order.run).toMatchObject({
      status: "completed",
      output: {
        orderId: "order-1",
        trackingId: "tracking:order-1",
        reviewerId: "reviewer-1",
      },
    });
    expect(calls).toEqual([
      "inventory.reserve",
      "payments.authorize",
      "shipping.create",
      "notifications.send",
    ]);
    expect(clock.sleepers).toHaveLength(0);
    expect(
      fixture.api.getFunction("shipOrder", "order-1:fulfillOrder:ship-order").run,
    ).toMatchObject({
      status: "completed",
      parent: { operationId: "ship-order" },
    });
  });

  it("retries payment and compensates a completed reservation after permanent failure", async () => {
    let paymentAttempts = 0;
    const released: string[] = [];
    const fixture = await createFixture(
      createDependencies({
        inventory: {
          async reserve(orderId) {
            return { reservationId: `reservation:${orderId}` };
          },
          async release(reservationId) {
            released.push(reservationId);
            return null;
          },
        },
        payments: {
          async authorize() {
            paymentAttempts += 1;
            throw new Error("declined");
          },
          async void() {
            return null;
          },
        },
      }),
    );
    await fixture.api.send({
      id: "order-declined",
      name: "order/placed",
      data: {
        orderId: "order-declined",
        total: 20,
        address: "Bratislava",
        approvalThreshold: 1_000,
      },
    });
    const order = fixture.api.getFunction("fulfillOrder", "order-declined:fulfillOrder");
    await fixture.drain();

    expect(paymentAttempts).toBe(3);
    expect(released).toEqual(["reservation:order-declined"]);
    expect(order.run).toMatchObject({
      status: "failed",
      error: { code: "payment_declined" },
    });
  });

  it("times out approval and compensates both completed operations", async () => {
    const clock = new VirtualClock();
    const calls: string[] = [];
    const fixture = await createFixture(
      createDependencies({
        clock,
        inventory: {
          async reserve(orderId) {
            return { reservationId: `reservation:${orderId}` };
          },
          async release() {
            calls.push("inventory.release");
            return null;
          },
        },
        payments: {
          async authorize(orderId) {
            return { authorizationId: `authorization:${orderId}` };
          },
          async void() {
            calls.push("payments.void");
            return null;
          },
        },
      }),
    );
    await fixture.api.send({
      id: "order-timeout",
      name: "order/placed",
      data: {
        orderId: "order-timeout",
        total: 2_000,
        address: "Bratislava",
        approvalThreshold: 1_000,
      },
    });
    const order = fixture.api.getFunction("fulfillOrder", "order-timeout:fulfillOrder");
    await poll(() => clock.sleepers.length === 1);

    clock.advance(24 * 60 * 60 * 1_000);
    await fixture.drain();

    expect(calls.sort()).toEqual(["inventory.release", "payments.void"]);
    expect(clock.sleepers).toHaveLength(0);
    expect(order.run).toMatchObject({
      status: "failed",
      error: { code: "approval_timeout" },
    });
  });

  it("propagates parent cancellation to a running child", async () => {
    let shippingStarted = false;
    let notified = false;
    const fixture = await createFixture(
      createDependencies({
        shipping: {
          create() {
            shippingStarted = true;
            return new Promise(() => undefined);
          },
        },
        notifications: {
          async send() {
            notified = true;
            return null;
          },
        },
      }),
    );
    await fixture.api.send({
      id: "order-cancelled",
      name: "order/placed",
      data: {
        orderId: "order-cancelled",
        total: 20,
        address: "Bratislava",
        approvalThreshold: 1_000,
      },
    });
    const order = fixture.api.getFunction("fulfillOrder", "order-cancelled:fulfillOrder");
    await poll(() => shippingStarted);
    await order.cancel("customer_cancelled");
    await fixture.drain();

    expect(notified).toBe(false);
    expect(order.run).toMatchObject({ status: "cancelled", error: "customer_cancelled" });
    expect(
      fixture.api.getFunction("shipOrder", "order-cancelled:fulfillOrder:ship-order").run,
    ).toMatchObject({ status: "cancelled", error: "parent_cancelled" });
  });
});
