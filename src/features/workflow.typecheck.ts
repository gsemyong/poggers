import { createWorkflow, type WorkflowApi, type WorkflowModel } from "@/features/workflow";

type Fulfillment = WorkflowModel<{
  Name: "fulfillment";
  Input: Readonly<{ orderId: string }>;
  Result: Readonly<{ shipmentId: string }>;
  State: {
    phase: "pending" | "reserved" | "shipped" | "cancelled";
    cancellationReason?: string;
  };
  Dependencies: {
    inventory: {
      reserve(input: { orderId: string }): Promise<{ reservationId: string }>;
    };
    shipping: {
      ship(input: { reservationId: string }): Promise<{ shipmentId: string }>;
    };
  };
  Signals: {
    cancel(input: { reason: string }): void;
  };
  Queries: {
    status(input: {}): {
      phase: "pending" | "reserved" | "shipped" | "cancelled";
    };
  };
}>;

createWorkflow<Fulfillment>({
  name: "fulfillment",
  state: () => ({ phase: "pending" }),
  async run({ dependencies, state, sleep, cancelled }, { orderId }) {
    const reservation = await dependencies.inventory.reserve({ orderId });
    state.phase = "reserved";
    await sleep({ milliseconds: 1000 });
    if (cancelled()) return { shipmentId: "cancelled" };
    const shipment = await dependencies.shipping.ship(reservation);
    state.phase = "shipped";
    return shipment;
  },
  signals: {
    cancel({ state }, { reason }) {
      state.phase = "cancelled";
      state.cancellationReason = reason;
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

declare const api: WorkflowApi<Fulfillment>;
api.start({ id: "order-1", input: { orderId: "order-1" } });
api.signals.cancel({ id: "order-1", input: { reason: "customer request" } });
api.queries.status({ id: "order-1", input: {} });

createWorkflow<Fulfillment>({
  name: "fulfillment",
  state: () => ({ phase: "pending" }),
  async run({ dependencies }, input) {
    // @ts-expect-error Dependency operation input is inferred from the model.
    await dependencies.inventory.reserve({ id: input.orderId });
    return { shipmentId: "never" };
  },
  signals: {
    // @ts-expect-error Signal handlers retain their semantic input.
    cancel(_context, input: { code: number }) {
      void input;
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

// @ts-expect-error Workflow start input is inferred from the semantic model.
api.start({ id: "order-2", input: { order: "order-2" } });
