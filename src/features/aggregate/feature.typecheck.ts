import { createSystem } from "@/core/system";
import { type Aggregate, createAggregate } from "@/features/aggregate";

type Empty = Record<never, never>;
type Principal = Readonly<{
  id: string;
  organization: string;
  roles: readonly ("operator" | "viewer")[];
}>;

function hasRole(principal: Principal, role: Principal["roles"][number]): boolean {
  for (const candidate of principal.roles) {
    if (candidate === role) return true;
  }
  return false;
}

type PlacedV1 = Readonly<{ product: string; quantity: number }>;
type PlacedV2 = Readonly<{ organization: string; product: string; quantity: number }>;
type PlacedV3 = Readonly<PlacedV2 & { note: string }>;

type Order = Aggregate<{
  Name: "orders";
  Key: string;
  State: Readonly<{
    organization: string;
    status: "empty" | "placed" | "cancelled";
    product?: string;
    quantity: number;
    note: string;
  }>;
  Principal: Principal;
  Commands: {
    place: Aggregate.Command<
      Readonly<{ product: string; quantity: number; note: string }>,
      Readonly<{ revision: number }>,
      { alreadyPlaced: Empty }
    >;
    cancel: Aggregate.Command<
      Readonly<{ reason: string }>,
      Readonly<{ revision: number }>,
      { notPlaced: Empty }
    >;
  };
  Events: {
    placed: Aggregate.Event<3, PlacedV3, { 1: PlacedV1; 2: PlacedV2 }>;
    cancelled: Aggregate.Event<1, Readonly<{ reason: string }>>;
  };
}>;

export const orderDefinition = {
  state: () => ({
    organization: "",
    status: "empty",
    quantity: 0,
    note: "",
  }),
  commands: {
    place({ state, input, principal, fail }) {
      if (state.status !== "empty") fail({ type: "alreadyPlaced", data: {} });
      return {
        events: [
          {
            placed: {
              organization: principal.organization,
              product: input.product,
              quantity: input.quantity,
              note: input.note,
            },
          },
        ],
        result: { revision: 1 },
      };
    },
    cancel({ state, input, fail }) {
      if (state.status !== "placed") fail({ type: "notPlaced", data: {} });
      return {
        events: [{ cancelled: input }],
        result: { revision: 2 },
      };
    },
  },
  events: {
    placed: {
      migrate: {
        1(value) {
          return { ...value, organization: "" };
        },
        2(value) {
          return { ...value, note: "" };
        },
      },
      apply({ state, event }) {
        return {
          ...state,
          organization: event.organization,
          status: "placed",
          product: event.product,
          quantity: event.quantity,
          note: event.note,
        };
      },
    },
    cancelled: {
      apply({ state }) {
        return { ...state, status: "cancelled" };
      },
    },
  },
  authorize: {
    read({ state, principal }) {
      return state.organization === "" || state.organization === principal.organization;
    },
    place({ principal }) {
      return hasRole(principal, "operator");
    },
    cancel({ state, principal }) {
      return state.organization === principal.organization && hasRole(principal, "operator");
    },
  },
} satisfies Aggregate.Definition<Order>;

export const orders = createAggregate<Order>(orderDefinition);

function checkAggregateReference(reference: Aggregate.Reference<typeof orders>): void {
  const order = reference.get({
    key: "order-1",
    principal: {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    },
  });
  order.place({ product: "product-1", quantity: 2, note: "Handle carefully" }) satisfies Promise<
    Aggregate.Outcome<
      Readonly<{ revision: number }>,
      | Readonly<{ type: "alreadyPlaced"; data: Empty }>
      | Readonly<{ type: "forbidden"; data: Empty }>
    >
  >;
  order.place(
    { product: "product-1", quantity: 2, note: "" },
    { wait: "accepted", idempotencyKey: "place-1" },
  ) satisfies Promise<Readonly<{ id: string }>>;
  order.state() satisfies Promise<
    Readonly<{
      revision: number;
      state: Readonly<Order["State"]>;
    }>
  >;
  order.events({}) satisfies Promise<
    Readonly<{
      entries: readonly Aggregate.EventRecord<typeof orders>[];
      cursor: number;
      done: boolean;
    }>
  >;

  // @ts-expect-error Command input is derived from the semantic model.
  order.place({ product: "product-1", quantity: "two", note: "" });
  // @ts-expect-error The principal is bound once and fully typed.
  reference.get({ key: "order-1", principal: { id: "member-1" } });
}

void checkAggregateReference;

export default createSystem({
  features: { orders },
});
