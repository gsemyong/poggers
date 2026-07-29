import type { Dependency } from "@/core/dependency";
import { createSystem } from "@/core/system";
import { createWorkflow, type Workflow } from "@/features/workflow";

export type Payments = Dependency<{
  Operations: {
    charge(
      input: Readonly<{ order: string; amount: number }>,
    ): Promise<Readonly<{ receipt: string }>>;
    refund(input: Readonly<{ receipt: string }>): Promise<Readonly<{ refunded: true }>>;
  };
}>;

export type Shipment = Workflow<{
  Name: "shipment";
  Id: string;
  Input: Readonly<{ order: string }>;
  State: { dispatched: boolean };
  Result: Readonly<{ tracking: string }>;
  Actions: {
    dispatch: Workflow.Action<undefined, Readonly<{ dispatched: true }>>;
  };
}>;

export const shipment = createWorkflow<Shipment>({
  state: () => ({ dispatched: false }),
  actions: {
    dispatch({ state }) {
      state.dispatched = true;
      return { dispatched: true };
    },
  },
  async run({ id, state, wait }) {
    await wait(() => state.dispatched);
    return { tracking: id };
  },
});

export type Fulfillment = Workflow<{
  Name: "fulfillment";
  Id: string;
  Input: Readonly<{
    order: string;
    shipment: string;
    amount: number;
  }>;
  State: {
    phase: "charging" | "approval" | "shipping" | "compensating" | "completed";
    approved: boolean;
    charged: boolean;
    receipt: string;
  };
  Result: Readonly<{ receipt: string; shipment: string }>;
  Dependencies: {
    payments: Payments;
    shipment: Workflow.Reference<Shipment>;
  };
  Actions: {
    approve: Workflow.Action<
      undefined,
      Readonly<{ approved: true }>,
      { unavailable: Readonly<{ phase: string }> }
    >;
  };
}>;

export const fulfillment = createWorkflow<Fulfillment>({
  state: () => ({
    phase: "charging",
    approved: false,
    charged: false,
    receipt: "",
  }),
  actions: {
    approve({ state, fail }) {
      if (state.phase !== "approval") {
        fail({ type: "unavailable", data: { phase: state.phase } });
      }
      state.approved = true;
      return { approved: true };
    },
  },
  async run({ input, state, dependencies, shield, wait }) {
    try {
      const payment = await dependencies.payments.charge(
        { order: input.order, amount: input.amount },
        { retry: { maximumAttempts: 3, initialDelay: 10 } },
      );
      state.charged = true;
      state.receipt = payment.receipt;
      state.phase = "approval";
      await wait(() => state.approved);

      state.phase = "shipping";
      const shipment = dependencies.shipment.get({ id: input.shipment });
      await shipment.start(
        { input: { order: input.order } },
        { cancellation: "wait", parentClose: "cancel" },
      );
      await shipment.dispatch();
      await shipment.join();

      state.phase = "completed";
      return { receipt: state.receipt, shipment: input.shipment };
    } finally {
      if (state.charged && state.phase !== "completed") {
        await shield(async () => {
          state.phase = "compensating";
          await dependencies.payments.refund({ receipt: state.receipt });
        });
      }
    }
  },
});

export default createSystem({
  features: {
    shipment,
    fulfillment,
  },
});
