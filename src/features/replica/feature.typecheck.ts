import { createSystem } from "@/core/system";
import type { Aggregate } from "@/features/aggregate";
import { orders } from "@/features/aggregate/feature.typecheck";
import { createIdentity, type IdentityModel } from "@/features/identity";
import { operations } from "@/features/projection/feature.typecheck";
import { createReplica, type Replica } from "@/features/replica";

type Principal = Readonly<{
  id: string;
  organization: string;
  roles: readonly ("operator" | "viewer")[];
}>;

type Users = IdentityModel<{
  Name: "identity";
  Principal: Principal;
}>;

export const identity = createIdentity<Users>({
  principal(user) {
    return {
      id: user.id,
      organization: "company-1",
      roles: ["operator"],
    };
  },
});

type LocalOperations = Replica<{
  Name: "localOperations";
  Version: 2;
  Identity: Users;
  Projection: typeof operations;
  Rows: "orders";
  History: {
    1: Replica.History<
      Readonly<{
        orders: readonly Readonly<{
          id: string;
          organization: string;
          product: string;
          status: "placed" | "cancelled";
          quantity: number;
          value: number;
          embedding: readonly number[];
        }>[];
      }>,
      {
        placeOrder: Readonly<{
          id: string;
          product: string;
          quantity: number;
        }>;
      }
    >;
  };
  Dependencies: {
    orders: Aggregate.Reference<typeof orders>;
  };
  Commands: {
    placeOrder: Replica.Command<
      Readonly<{
        id: string;
        product: string;
        quantity: number;
        note: string;
      }>,
      Readonly<{ acceptedAt: number }>
    >;
    cancelOrder: Replica.Command<Readonly<{ id: string; reason: string }>>;
  };
}>;

export const localOperationsDefinition = {
  commands: {
    placeOrder: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.orders.get({ key: input.id, principal }).place(
          {
            product: input.product,
            quantity: input.quantity,
            note: input.note,
          },
          { idempotencyKey },
        );
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return { acceptedAt: outcome.value.revision };
      },
    },
    cancelOrder: {
      async commit({ principal, dependencies, input, idempotencyKey }) {
        const outcome = await dependencies.orders
          .get({ key: input.id, principal })
          .cancel({ reason: input.reason }, { idempotencyKey });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return {};
      },
    },
  },
  optimistic: {
    placeOrder({ state, input }) {
      const next = [];
      for (const order of state.orders) next.push(order);
      next.push({
        id: input.id,
        organization: "company-1",
        product: input.product,
        note: input.note,
        status: "placed" as const,
        quantity: input.quantity,
        value: input.quantity * 10,
        embedding: [input.quantity, 1, 0],
      });
      return {
        orders: next,
      };
    },
    cancelOrder({ state, input }) {
      const next = [];
      for (const order of state.orders) {
        next.push(
          order.id === input.id
            ? {
                id: order.id,
                organization: order.organization,
                product: order.product,
                note: order.note,
                status: "cancelled" as const,
                quantity: order.quantity,
                value: order.value,
                embedding: order.embedding,
              }
            : order,
        );
      }
      return {
        orders: next,
      };
    },
  },
  migrate: {
    1: {
      state(state) {
        const orders = [];
        for (const order of state.orders) {
          orders.push({
            id: order.id,
            organization: order.organization,
            product: order.product,
            note: "",
            status: order.status,
            quantity: order.quantity,
            value: order.value,
            embedding: order.embedding,
          });
        }
        return {
          orders,
        };
      },
      commands: {
        placeOrder(input) {
          return {
            command: "placeOrder",
            input: {
              id: input.id,
              product: input.product,
              quantity: input.quantity,
              note: "",
            },
          };
        },
      },
    },
  },
} satisfies Replica.Definition<LocalOperations>;

export const localOperations = createReplica<LocalOperations>(localOperationsDefinition);

function checkClient(client: Replica.Client<typeof localOperations>): void {
  client.orders({
    text: { value: "careful", fields: ["note"] },
  });
  client.placeOrder({
    id: "order-1",
    product: "product-1",
    quantity: 2,
    note: "Handle carefully",
  });
  client.cancelOrder({ id: "order-1", reason: "Changed mind" });
  // @ts-expect-error Command inputs retain their semantic shape.
  client.placeOrder({ id: "order-2", product: "product-1", quantity: "two", note: "" });
}

void checkClient;

export default createSystem({
  features: { identity, orders, operations, localOperations },
});
