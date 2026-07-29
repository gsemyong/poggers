import type { Dependency } from "@/core/dependency";
import { createSystem } from "@/core/system";
import { createAggregate, type Aggregate } from "@/features/aggregate";
import { createIdentity, type IdentityModel } from "@/features/identity";
import { createProjection, type Projection } from "@/features/projection";
import { createReplica, type Replica } from "@/features/replica";
import { createWorkflow, type Workflow } from "@/features/workflow";

type Empty = Record<never, never>;

export type OperationsPrincipal = Readonly<{
  id: string;
  organization: string;
  roles: readonly ("administrator" | "operator" | "viewer")[];
}>;

function hasRole(
  roles: OperationsPrincipal["roles"],
  role: OperationsPrincipal["roles"][number],
): boolean {
  for (const candidate of roles) {
    if (candidate === role) return true;
  }
  return false;
}

type OperationsIdentity = IdentityModel<{
  Name: "identity";
  Principal: OperationsPrincipal;
}>;

export const operationsIdentity = createIdentity<OperationsIdentity>({
  principal(user) {
    return {
      id: user.id,
      organization: "company-1",
      roles: ["operator"],
    };
  },
});

export type OrderLine = Readonly<{
  product: string;
  quantity: number;
  price: number;
}>;

type OrderState = Readonly<{
  organization: string;
  customer: string;
  status: "empty" | "placed" | "fulfilling" | "shipped" | "cancelled" | "failed";
  lines: readonly OrderLine[];
  note: string;
  total: number;
  tracking: string;
}>;

type Orders = Aggregate<{
  Name: "orders";
  Key: string;
  State: OrderState;
  Principal: OperationsPrincipal;
  Commands: {
    place: Aggregate.Command<
      Readonly<{
        customer: string;
        lines: readonly OrderLine[];
        note: string;
      }>,
      Readonly<{ revision: number }>,
      { alreadyExists: Empty }
    >;
    beginFulfillment: Aggregate.Command<
      undefined,
      Empty,
      { unavailable: Readonly<{ status: OrderState["status"] }> }
    >;
    ship: Aggregate.Command<
      Readonly<{ tracking: string }>,
      Empty,
      { unavailable: Readonly<{ status: OrderState["status"] }> }
    >;
    fail: Aggregate.Command<Readonly<{ reason: string }>>;
    cancel: Aggregate.Command<
      Readonly<{ reason: string }>,
      Empty,
      { unavailable: Readonly<{ status: OrderState["status"] }> }
    >;
  };
  Events: {
    placed: Aggregate.Event<
      2,
      Readonly<{
        organization: string;
        customer: string;
        lines: readonly OrderLine[];
        note: string;
        total: number;
      }>,
      {
        1: Readonly<{
          organization: string;
          customer: string;
          lines: readonly OrderLine[];
          total: number;
        }>;
      }
    >;
    fulfillmentStarted: Aggregate.Event<1, Empty>;
    shipped: Aggregate.Event<1, Readonly<{ tracking: string }>>;
    failed: Aggregate.Event<1, Readonly<{ reason: string }>>;
    cancelled: Aggregate.Event<1, Readonly<{ reason: string }>>;
  };
}>;

export const orders = createAggregate<Orders>({
  state() {
    return {
      organization: "",
      customer: "",
      status: "empty",
      lines: [],
      note: "",
      total: 0,
      tracking: "",
    };
  },
  commands: {
    place({ state, input, principal, fail }) {
      if (state.status !== "empty") fail({ type: "alreadyExists", data: {} });
      let total = 0;
      for (const line of input.lines) total += line.quantity * line.price;
      return {
        events: [
          {
            placed: {
              organization: principal.organization,
              customer: input.customer,
              lines: input.lines,
              note: input.note,
              total,
            },
          },
        ],
        result: { revision: 1 },
      };
    },
    beginFulfillment({ state, fail }) {
      if (state.status !== "placed") {
        fail({ type: "unavailable", data: { status: state.status } });
      }
      return { events: [{ fulfillmentStarted: {} }], result: {} };
    },
    ship({ state, input, fail }) {
      if (state.status !== "fulfilling") {
        fail({ type: "unavailable", data: { status: state.status } });
      }
      return { events: [{ shipped: input }], result: {} };
    },
    fail({ input }) {
      return { events: [{ failed: input }], result: {} };
    },
    cancel({ state, input, fail }) {
      if (state.status === "shipped" || state.status === "cancelled") {
        fail({ type: "unavailable", data: { status: state.status } });
      }
      return { events: [{ cancelled: input }], result: {} };
    },
  },
  events: {
    placed: {
      migrate: {
        1(value) {
          return {
            organization: value.organization,
            customer: value.customer,
            lines: value.lines,
            note: "",
            total: value.total,
          };
        },
      },
      apply({ state, event }) {
        return {
          organization: event.organization,
          customer: event.customer,
          status: "placed",
          lines: event.lines,
          note: event.note,
          total: event.total,
          tracking: state.tracking,
        };
      },
    },
    fulfillmentStarted: {
      apply({ state }) {
        return {
          organization: state.organization,
          customer: state.customer,
          status: "fulfilling",
          lines: state.lines,
          note: state.note,
          total: state.total,
          tracking: state.tracking,
        };
      },
    },
    shipped: {
      apply({ state, event }) {
        return {
          organization: state.organization,
          customer: state.customer,
          status: "shipped",
          lines: state.lines,
          note: state.note,
          total: state.total,
          tracking: event.tracking,
        };
      },
    },
    failed: {
      apply({ state }) {
        return {
          organization: state.organization,
          customer: state.customer,
          status: "failed",
          lines: state.lines,
          note: state.note,
          total: state.total,
          tracking: state.tracking,
        };
      },
    },
    cancelled: {
      apply({ state }) {
        return {
          organization: state.organization,
          customer: state.customer,
          status: "cancelled",
          lines: state.lines,
          note: state.note,
          total: state.total,
          tracking: state.tracking,
        };
      },
    },
  },
  authorize: {
    read({ principal, state }) {
      return principal.organization === state.organization;
    },
    place({ principal }) {
      return hasRole(principal.roles, "administrator") || hasRole(principal.roles, "operator");
    },
    beginFulfillment({ principal, state }) {
      return principal.organization === state.organization;
    },
    ship({ principal, state }) {
      return principal.organization === state.organization;
    },
    fail({ principal, state }) {
      return principal.organization === state.organization;
    },
    cancel({ principal, state }) {
      return (
        principal.organization === state.organization &&
        (hasRole(principal.roles, "administrator") || hasRole(principal.roles, "operator"))
      );
    },
  },
});

type InventoryState = Readonly<{
  organization: string;
  warehouse: string;
  product: string;
  available: number;
  reservations: readonly Readonly<{ order: string; quantity: number }>[];
}>;

type Inventory = Aggregate<{
  Name: "inventory";
  Key: string;
  State: InventoryState;
  Principal: OperationsPrincipal;
  Commands: {
    stock: Aggregate.Command<
      Readonly<{
        organization: string;
        warehouse: string;
        product: string;
        quantity: number;
      }>
    >;
    reserve: Aggregate.Command<
      Readonly<{ order: string; quantity: number }>,
      Empty,
      { unavailable: Readonly<{ available: number }> }
    >;
    release: Aggregate.Command<Readonly<{ order: string }>>;
    commit: Aggregate.Command<Readonly<{ order: string }>>;
  };
  Events: {
    stocked: Aggregate.Event<
      1,
      Readonly<{
        organization: string;
        warehouse: string;
        product: string;
        quantity: number;
      }>
    >;
    reserved: Aggregate.Event<1, Readonly<{ order: string; quantity: number }>>;
    released: Aggregate.Event<1, Readonly<{ order: string; quantity: number }>>;
    committed: Aggregate.Event<1, Readonly<{ order: string }>>;
  };
}>;

export const inventory = createAggregate<Inventory>({
  state() {
    return {
      organization: "",
      warehouse: "",
      product: "",
      available: 0,
      reservations: [],
    };
  },
  commands: {
    stock({ input }) {
      return { events: [{ stocked: input }], result: {} };
    },
    reserve({ state, input, fail }) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }
      return { events: [{ reserved: input }], result: {} };
    },
    release({ state, input }) {
      let quantity = 0;
      for (const reservation of state.reservations) {
        if (reservation.order === input.order) quantity += reservation.quantity;
      }
      return {
        events: [{ released: { order: input.order, quantity } }],
        result: {},
      };
    },
    commit({ input }) {
      return { events: [{ committed: input }], result: {} };
    },
  },
  events: {
    stocked: {
      apply({ state, event }) {
        return {
          organization: event.organization,
          warehouse: event.warehouse,
          product: event.product,
          available: state.available + event.quantity,
          reservations: state.reservations,
        };
      },
    },
    reserved: {
      apply({ state, event }) {
        const reservations = [];
        for (const reservation of state.reservations) reservations.push(reservation);
        reservations.push(event);
        return {
          organization: state.organization,
          warehouse: state.warehouse,
          product: state.product,
          available: state.available - event.quantity,
          reservations,
        };
      },
    },
    released: {
      apply({ state, event }) {
        const reservations = [];
        let available = state.available;
        for (const reservation of state.reservations) {
          if (reservation.order === event.order) available += reservation.quantity;
          else reservations.push(reservation);
        }
        return {
          organization: state.organization,
          warehouse: state.warehouse,
          product: state.product,
          available,
          reservations,
        };
      },
    },
    committed: {
      apply({ state, event }) {
        const reservations = [];
        for (const reservation of state.reservations) {
          if (reservation.order !== event.order) reservations.push(reservation);
        }
        return {
          organization: state.organization,
          warehouse: state.warehouse,
          product: state.product,
          available: state.available,
          reservations,
        };
      },
    },
  },
  authorize: {
    read({ principal, state }) {
      return principal.organization === state.organization;
    },
    stock({ principal, input }) {
      return (
        principal.organization === input.organization && hasRole(principal.roles, "administrator")
      );
    },
    reserve({ principal, state }) {
      return principal.organization === state.organization;
    },
    release({ principal, state }) {
      return principal.organization === state.organization;
    },
    commit({ principal, state }) {
      return principal.organization === state.organization;
    },
  },
});

export type Shipping = Dependency<{
  Operations: {
    create(
      input: Readonly<{
        organization: string;
        order: string;
        warehouse: string;
      }>,
    ): Promise<Readonly<{ tracking: string }>>;
  };
}>;

type Fulfillment = Workflow<{
  Name: "fulfillment";
  Id: string;
  Input: Readonly<{
    order: string;
    warehouse: string;
    principal: OperationsPrincipal;
    lines: readonly OrderLine[];
  }>;
  State: {
    phase: "reserving" | "shipping" | "compensating" | "completed";
    reserved: number;
    tracking: string;
  };
  Visibility: {
    phase: true;
  };
  Result: Readonly<{ tracking: string }>;
  Failures: {
    invalid: Readonly<{ reason: string }>;
    order: Readonly<{ reason: string }>;
    inventory: Readonly<{ reason: string }>;
  };
  Dependencies: {
    inventory: Aggregate.Reference<typeof inventory>;
    orders: Aggregate.Reference<typeof orders>;
    shipping: Shipping;
  };
  Actions: {};
}>;

export const fulfillment = createWorkflow<Fulfillment>({
  state() {
    return { phase: "reserving", reserved: 0, tracking: "" };
  },
  actions: {},
  async run({ id, input, state, dependencies, shield, fail }) {
    const order = dependencies.orders.get({
      key: input.order,
      principal: input.principal,
    });
    const started = await order.beginFulfillment({
      idempotencyKey: id + ":begin",
    });
    if (started.status === "failed") {
      fail({ type: "order", data: { reason: started.failure.type } });
    }
    try {
      if (input.lines.length === 0) {
        fail({
          type: "invalid",
          data: { reason: "Fulfillment requires at least one line." },
        });
      }
      for (const line of input.lines) {
        const stockKey = input.principal.organization + ":" + input.warehouse + ":" + line.product;
        const reserveStock = dependencies.inventory.get({
          key: stockKey,
          principal: input.principal,
        });
        const reserved = await reserveStock.reserve(
          { order: input.order, quantity: line.quantity },
          { idempotencyKey: id + ":reserve:" + line.product },
        );
        if (reserved.status === "failed") {
          fail({ type: "inventory", data: { reason: reserved.failure.type } });
        }
        state.reserved += 1;
      }
      state.phase = "shipping";
      const shipment = await dependencies.shipping.create({
        organization: input.principal.organization,
        order: input.order,
        warehouse: input.warehouse,
      });
      state.tracking = shipment.tracking;
      for (let commitIndex = 0; commitIndex < state.reserved; commitIndex += 1) {
        const committedLine = input.lines[commitIndex]!;
        const committedKey =
          input.principal.organization + ":" + input.warehouse + ":" + committedLine.product;
        const commitStock = dependencies.inventory.get({
          key: committedKey,
          principal: input.principal,
        });
        await commitStock.commit(
          { order: input.order },
          { idempotencyKey: id + ":commit:" + committedKey },
        );
      }
      const shipped = await order.ship(
        { tracking: state.tracking },
        { idempotencyKey: id + ":ship" },
      );
      if (shipped.status === "failed") {
        fail({ type: "order", data: { reason: shipped.failure.type } });
      }
      state.phase = "completed";
      return { tracking: state.tracking };
    } finally {
      if (state.phase !== "completed") {
        await shield(async () => {
          state.phase = "compensating";
          for (let releaseIndex = 0; releaseIndex < state.reserved; releaseIndex += 1) {
            const releasedLine = input.lines[releaseIndex]!;
            const releasedKey =
              input.principal.organization + ":" + input.warehouse + ":" + releasedLine.product;
            const releaseStock = dependencies.inventory.get({
              key: releasedKey,
              principal: input.principal,
            });
            await releaseStock.release(
              { order: input.order },
              { idempotencyKey: id + ":release:" + releasedKey },
            );
          }
          await order.fail({ reason: "fulfillment failed" }, { idempotencyKey: id + ":fail" });
        });
      }
    }
  },
});

type OrderRow = Readonly<{
  id: string;
  organization: string;
  customer: string;
  status: OrderState["status"];
  note: string;
  total: number;
  tracking: string;
  embedding: readonly number[];
}>;

type InventoryRow = Readonly<{
  id: string;
  organization: string;
  warehouse: string;
  product: string;
  available: number;
  location: Readonly<{ latitude: number; longitude: number }>;
}>;

type Operations = Projection<{
  Name: "operations";
  Version: 1;
  Principal: OperationsPrincipal;
  Sources: {
    orders: Aggregate.Events<typeof orders>;
    inventory: Aggregate.Events<typeof inventory>;
  };
  Rows: {
    orders: OrderRow;
    inventory: InventoryRow;
    substitutions: Readonly<{ id: string; from: string; to: string }>;
  };
  Queries: {
    Text: { orders: "customer" | "note" };
    Vector: { orders: { Field: "embedding"; Dimensions: 3 } };
    Graph: { substitutions: { From: "from"; To: "to" } };
    Geo: { inventory: "location" };
    Analytics: { orders: true; inventory: true };
  };
}>;

export const operations = createProjection<Operations>({
  reduce({ source, event, rows }) {
    if (source === "orders") {
      const previous = rows.orders.find(({ id }) => id === event.key);
      if (event.type === "placed") {
        return [
          {
            upsert: {
              orders: {
                id: event.key,
                organization: event.data.organization,
                customer: event.data.customer,
                status: "placed",
                note: event.data.note,
                total: event.data.total,
                tracking: "",
                embedding: [event.data.total, event.data.lines.length, 1],
              },
            },
          },
        ];
      }
      if (!previous) return [];
      const status =
        event.type === "fulfillmentStarted"
          ? "fulfilling"
          : event.type === "shipped"
            ? "shipped"
            : event.type === "cancelled"
              ? "cancelled"
              : "failed";
      return [
        {
          upsert: {
            orders: {
              id: previous.id,
              organization: previous.organization,
              customer: previous.customer,
              status,
              note: previous.note,
              total: previous.total,
              tracking: event.type === "shipped" ? event.data.tracking : previous.tracking,
              embedding: previous.embedding,
            },
          },
        },
      ];
    }
    const inventoryRow = rows.inventory.find(({ id }) => id === event.key);
    if (event.type === "stocked") {
      return [
        {
          upsert: {
            inventory: {
              id: event.key,
              organization: event.data.organization,
              warehouse: event.data.warehouse,
              product: event.data.product,
              available: (inventoryRow?.available ?? 0) + event.data.quantity,
              location: { latitude: 48.1486, longitude: 17.1077 },
            },
          },
        },
        {
          upsert: {
            substitutions: {
              id: `${event.data.product}:alternative`,
              from: event.data.product,
              to: `${event.data.product}-alternative`,
            },
          },
        },
      ];
    }
    if (!inventoryRow) return [];
    let available = inventoryRow.available;
    if (event.type === "reserved") available -= event.data.quantity;
    if (event.type === "released") available += event.data.quantity;
    return [
      {
        upsert: {
          inventory: {
            id: inventoryRow.id,
            organization: inventoryRow.organization,
            warehouse: inventoryRow.warehouse,
            product: inventoryRow.product,
            available,
            location: inventoryRow.location,
          },
        },
      },
    ];
  },
  authorize: {
    orders({ principal, row }) {
      return principal.organization === row.organization;
    },
    inventory({ principal, row }) {
      return principal.organization === row.organization;
    },
    substitutions() {
      return true;
    },
  },
});

type LocalOperations = Replica<{
  Name: "localOperations";
  Version: 1;
  Identity: OperationsIdentity;
  Projection: typeof operations;
  Rows: "orders" | "inventory";
  Dependencies: {
    fulfillment: Workflow.Reference<typeof fulfillment>;
    orders: Aggregate.Reference<typeof orders>;
  };
  Commands: {
    placeOrder: Replica.Command<
      Readonly<{
        id: string;
        customer: string;
        warehouse: string;
        lines: readonly OrderLine[];
        note: string;
      }>
    >;
    cancelOrder: Replica.Command<Readonly<{ id: string; reason: string }>>;
  };
}>;

export const localOperationsDefinition = {
  commands: {
    placeOrder: {
      async commit({ principal, input, idempotencyKey, dependencies }) {
        const order = dependencies.orders.get({ key: input.id, principal });
        const placed = await order.place(
          {
            customer: input.customer,
            lines: input.lines,
            note: input.note,
          },
          { idempotencyKey: `${idempotencyKey}:place` },
        );
        if (placed.status === "failed") throw new Error(placed.failure.type);
        await dependencies.fulfillment.get({ id: input.id }).start(
          {
            input: {
              order: input.id,
              warehouse: input.warehouse,
              principal,
              lines: input.lines,
            },
          },
          { idempotencyKey: `${idempotencyKey}:fulfillment` },
        );
        return {};
      },
    },
    cancelOrder: {
      async commit({ principal, input, idempotencyKey, dependencies }) {
        await dependencies.fulfillment
          .get({ id: input.id })
          .cancel({ idempotencyKey: `${idempotencyKey}:workflow` });
        const cancelled = await dependencies.orders
          .get({ key: input.id, principal })
          .cancel({ reason: input.reason }, { idempotencyKey: `${idempotencyKey}:order` });
        if (cancelled.status === "failed") throw new Error(cancelled.failure.type);
        return {};
      },
    },
  },
  optimistic: {
    placeOrder({ state, input }) {
      let total = 0;
      for (const line of input.lines) total += line.quantity * line.price;
      const next = [];
      for (const order of state.orders) next.push(order);
      next.push({
        id: input.id,
        organization: "company-1",
        customer: input.customer,
        status: "placed" as const,
        note: input.note,
        total,
        tracking: "",
        embedding: [total, input.lines.length, 1],
      });
      return { orders: next, inventory: state.inventory };
    },
    cancelOrder({ state, input }) {
      const next = [];
      for (const order of state.orders) {
        next.push(
          order.id === input.id
            ? {
                id: order.id,
                organization: order.organization,
                customer: order.customer,
                status: "cancelled" as const,
                note: order.note,
                total: order.total,
                tracking: order.tracking,
                embedding: order.embedding,
              }
            : order,
        );
      }
      return { orders: next, inventory: state.inventory };
    },
  },
  migrate: {},
} satisfies Replica.Definition<LocalOperations>;

export const localOperations = createReplica<LocalOperations>(localOperationsDefinition);

export default createSystem({
  features: {
    operationsIdentity,
    orders,
    inventory,
    fulfillment,
    operations,
    localOperations,
  },
});
