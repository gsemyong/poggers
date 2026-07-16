import {
  createFunctions,
  type AppSpec,
  type FeatureDef,
  type FunctionsFeature,
  type WorkflowClock,
} from "@poggers/kit";

export type OrderFulfillment = {
  Events: {
    "order/placed": {
      orderId: string;
      total: number;
      address: string;
      approvalThreshold: number;
    };
    "order/approved": { orderId: string; reviewerId: string };
  };
  Functions: {
    fulfillOrder: {
      Input: {
        orderId: string;
        total: number;
        address: string;
        approvalThreshold: number;
      };
      Output: { orderId: string; trackingId: string; reviewerId?: string };
      Error: {
        code: "approval_timeout" | "payment_declined" | "shipment_failed";
      };
    };
    shipOrder: {
      Input: { orderId: string; address: string };
      Output: { trackingId: string };
    };
  };
  Dependencies: {
    inventory: {
      reserve(orderId: string): Promise<{ reservationId: string }>;
      release(reservationId: string): Promise<null>;
    };
    payments: {
      authorize(orderId: string, total: number): Promise<{ authorizationId: string }>;
      void(authorizationId: string): Promise<null>;
    };
    shipping: {
      create(orderId: string, address: string): Promise<{ trackingId: string }>;
    };
    notifications: {
      send(orderId: string, trackingId: string): Promise<null>;
    };
  };
};

export type OrderFulfillmentDependencies = OrderFulfillment["Dependencies"] & {
  readonly clock?: WorkflowClock;
};

export type OrderFulfillmentFeature = FunctionsFeature<OrderFulfillment>;

export function createOrderFulfillment<App extends AppSpec>(): FeatureDef<
  App,
  OrderFulfillmentFeature
> {
  return createFunctions<App, OrderFulfillment>(
    {
      dependencies: {
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
      },
    },
    ({ createFunction, dependencies }) => {
      const shipOrder = createFunction({ id: "shipOrder" }, async ({ event, step }) =>
        step.run("create-shipment", () =>
          dependencies.shipping.create(event.data.orderId, event.data.address),
        ),
      );

      createFunction(
        {
          id: "fulfillOrder",
          name: "Fulfill order",
          triggers: { event: "order/placed" },
          retries: 2,
        },
        async ({ event, step }) => {
          const input = event.data;
          const reservation = step.run("reserve-inventory", () =>
            dependencies.inventory.reserve(input.orderId),
          );
          const payment = step.run("authorize-payment", () =>
            dependencies.payments.authorize(input.orderId, input.total),
          );

          let reserved: Awaited<typeof reservation>;
          let authorized: Awaited<typeof payment>;
          try {
            [reserved, authorized] = await Promise.all([reservation, payment]);
          } catch {
            const completedReservation = await reservation.catch(() => null);
            if (completedReservation) {
              await step.run("release-inventory", () =>
                dependencies.inventory.release(completedReservation.reservationId),
              );
            }
            throw { code: "payment_declined" } as const;
          }

          let reviewerId: string | undefined;
          if (input.total >= input.approvalThreshold) {
            const approval = await step.waitForEvent("approval", {
              event: "order/approved",
              timeout: "24 hours",
              match: "data.orderId",
            });
            if (!approval) {
              await Promise.all([
                step.run("release-inventory", () =>
                  dependencies.inventory.release(reserved.reservationId),
                ),
                step.run("void-payment", () =>
                  dependencies.payments.void(authorized.authorizationId),
                ),
              ]);
              throw { code: "approval_timeout" } as const;
            }
            reviewerId = approval.data.reviewerId;
          }

          let shipment: { trackingId: string };
          try {
            shipment = await step.invoke("ship-order", {
              function: shipOrder,
              data: { orderId: input.orderId, address: input.address },
            });
          } catch {
            await Promise.all([
              step.run("release-inventory", () =>
                dependencies.inventory.release(reserved.reservationId),
              ),
              step.run("void-payment", () =>
                dependencies.payments.void(authorized.authorizationId),
              ),
            ]);
            throw { code: "shipment_failed" } as const;
          }

          await step.run("notify-customer", () =>
            dependencies.notifications.send(input.orderId, shipment.trackingId),
          );
          return { orderId: input.orderId, trackingId: shipment.trackingId, reviewerId };
        },
      );
    },
  );
}
