import type {
  FeatureDef,
  Submission,
  SubmissionFailure,
  SubmissionSuccess,
  SyncMeta,
} from "@poggers/kit";
import { For, createPress } from "@poggers/kit/ui";
import type { App } from "src/app";

export type Order = {
  readonly id: string;
  readonly title: string;
  readonly total: number;
  readonly createdAt: number;
  readonly status: "pending" | "approved" | "declined";
};

type OrdersState = {
  orders: Order[];
};

type OrdersEvents = {
  created: { order: Order };
  paymentSettled: { orderId: string; status: "approved" | "declined" };
};

type OrdersViews = {
  orders: readonly Order[];
  pending: number;
  inspectors: number;
};

type OrdersCommands = {
  create: {
    Input: { title: string; total: number };
    Event: "created";
    Error: "invalid" | "unauthorized";
  };
  settle: {
    Input: { orderId: string; status: "approved" | "declined" };
    Event: "paymentSettled";
    Error: "missing" | "unauthorized";
  };
};

type SummaryState = {
  approved: number;
  declined: number;
  revenue: number;
};

type SummaryEvents = {
  recorded: { orderId: string; status: "approved" | "declined"; total: number };
};

type SummaryViews = SummaryState;

type SummaryCommands = {
  record: {
    Input: SummaryEvents["recorded"];
    Event: "recorded";
    Error: "unauthorized";
  };
};

export type OrdersDependencies = {
  readonly payments: {
    authorize(input: {
      readonly orderId: string;
      readonly total: number;
      readonly signal: AbortSignal;
    }): Promise<"approved" | "declined">;
  };
};

export type OrdersSession = OrdersViews & {
  readonly sync: SyncMeta;
  create(input: { title: string; total: number }): Submission<"invalid" | "unauthorized">;
  settle(input: {
    orderId: string;
    status: "approved" | "declined";
  }): Submission<"missing" | "unauthorized">;
  inspect(input: { orderId: string | null }): void;
};

export type SummarySession = SummaryViews & {
  readonly sync: SyncMeta;
  record(input: SummaryEvents["recorded"]): Submission<"unauthorized">;
};

export type OrdersFeature = {
  Resources: {
    orders: {
      Key: { ownerId: string };
      State: OrdersState;
      Presence: { inspectingOrderId: string | null };
      Events: OrdersEvents;
      Views: OrdersViews;
      Commands: OrdersCommands;
    };
    summary: {
      Key: { ownerId: string };
      State: SummaryState;
      Events: SummaryEvents;
      Views: SummaryViews;
      Commands: SummaryCommands;
    };
  };
  Dependencies: {
    server: OrdersDependencies;
  };
  Programs: {
    server: {
      authorizePayment: { Events: readonly ["orders.created"] };
    };
  };
  Components: {
    OrdersPanel: {
      State: OrdersViews &
        SummaryViews & {
          ready: boolean;
          title: string;
          canCreate: boolean;
          busy: boolean;
        };
      Context: { title: string; sequence: number; inspectingOrderId: string | null };
      Phases: "active" | "creating" | "inspecting";
      Tasks: {
        create: {
          Input: { title: string; total: number };
          Output: SubmissionSuccess;
          Error: SubmissionFailure<"invalid" | "unauthorized">;
        };
        inspect: {
          Input: { orderId: string | null };
          Output: void;
          Error: never;
        };
      };
      Actions: {
        change(input: { title: string }): void;
        create(): void;
        inspect(input: { orderId: string | null }): void;
      };
      Parts: {
        Root: "section";
        Header: "header";
        Eyebrow: "span";
        Title: "h2";
        Description: "p";
        Composer: "div";
        Input: "input";
        Create: "button";
        Summary: "dl";
        SummaryItem: "div";
        SummaryLabel: "dt";
        SummaryValue: "dd";
        Orders: "ul";
        Order: "li";
        OrderMain: "div";
        OrderTitle: "strong";
        OrderMeta: "span";
        OrderStatus: "span";
        Empty: "li";
      };
    };
  };
  API: {
    readonly orders: OrdersSession;
    readonly summary: SummarySession;
    readonly recordSummary: (
      input: SummaryEvents["recorded"] & { ownerId: string },
    ) => Submission<"unauthorized">;
  };
};

export const ordersFeature = {
  resources: {
    orders: {
      state: { orders: [] },
      presence: { inspectingOrderId: null },
      authorize({ actor, key }) {
        return actor.id === key.ownerId;
      },
      events: {
        created({ state, payload }) {
          if (!state.orders.some((order) => order.id === payload.order.id)) {
            state.orders.push(payload.order);
          }
        },
        paymentSettled({ state, payload }) {
          const index = state.orders.findIndex((order) => order.id === payload.orderId);
          const order = state.orders[index];
          if (!order) return;
          state.orders[index] = { ...order, status: payload.status };
        },
      },
      views: {
        orders({ state }) {
          return state.orders;
        },
        pending({ state }) {
          return state.orders.filter((order) => order.status === "pending").length;
        },
        inspectors({ sessions }) {
          return sessions.filter(
            (session) => typeof session.presence.inspectingOrderId === "string",
          ).length;
        },
      },
      commands: {
        create(ctx, input) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          const title = input.title.trim();
          if (!title || !Number.isFinite(input.total) || input.total <= 0) {
            return ctx.error("invalid");
          }
          return ctx.event.created({
            order: {
              id: ctx.id(),
              title,
              total: input.total,
              createdAt: ctx.now(),
              status: "pending",
            },
          });
        },
        settle(ctx, input) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          if (!ctx.state.orders.some((order) => order.id === input.orderId)) {
            return ctx.error("missing");
          }
          return ctx.event.paymentSettled(input);
        },
      },
    },
    summary: {
      state: { approved: 0, declined: 0, revenue: 0 },
      authorize({ actor, key, operation }) {
        if (operation.type === "command" && operation.name === "record") {
          return operation.origin === "program";
        }
        return actor.id === key.ownerId;
      },
      events: {
        recorded({ state, payload }) {
          if (payload.status === "approved") {
            state.approved += 1;
            state.revenue += payload.total;
          } else {
            state.declined += 1;
          }
        },
      },
      views: {
        approved({ state }) {
          return state.approved;
        },
        declined({ state }) {
          return state.declined;
        },
        revenue({ state }) {
          return state.revenue;
        },
      },
      commands: {
        record(ctx, input) {
          return ctx.event.recorded(input);
        },
      },
    },
  },
  dependencies: {
    server: {
      payments: {
        kind: "dependency",
        async start() {
          return {
            async authorize({ orderId, signal }) {
              await wait(420, signal);
              return checksum(orderId) % 5 === 0 ? "declined" : "approved";
            },
          };
        },
      },
    },
  },
  programs: {
    server: {
      authorizePayment: {
        source: {
          events: ["orders.created"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ api, event, orders, signal }, dependencies) {
          const status = await dependencies.payments.authorize({
            orderId: event.payload.order.id,
            total: event.payload.order.total,
            signal,
          });
          await orders.settle({ orderId: event.payload.order.id, status });
          await api.orders.recordSummary({
            ownerId: event.key.ownerId,
            orderId: event.payload.order.id,
            status,
            total: event.payload.order.total,
          });
        },
      },
    },
  },
  components: {
    OrdersPanel: {
      state({ api, context, phase }) {
        const busy = phase === "creating";
        return {
          orders: api.orders.orders,
          pending: api.orders.pending,
          inspectors: api.orders.inspectors,
          approved: api.summary.approved,
          declined: api.summary.declined,
          revenue: api.summary.revenue,
          ready:
            (api.orders.sync.cursor > 0 || !api.orders.sync.syncing) &&
            (api.summary.sync.cursor > 0 || !api.summary.sync.syncing),
          title: context.title,
          canCreate: context.title.trim().length > 0 && !busy,
          busy,
        };
      },
      machine: {
        context: { title: "", sequence: 1, inspectingOrderId: null },
        initial: "active",
        on: {
          change: {
            update: (_scope, input) => ({ title: input.title }),
          },
          inspect: {
            target: "inspecting",
            reenter: true,
            update: (_scope, input) => ({ inspectingOrderId: input.orderId }),
          },
        },
        phases: {
          active: {
            on: {
              create: {
                allow: ({ context }) => context.title.trim().length > 0,
                target: "creating",
              },
            },
          },
          creating: {
            task: {
              run: "create",
              input: ({ context }) => ({
                title: context.title,
                total: 45 + context.sequence * 12,
              }),
              done: {
                target: "active",
                update: ({ context }) => ({ title: "", sequence: context.sequence + 1 }),
              },
              fail: "active",
            },
          },
          inspecting: {
            task: {
              run: "inspect",
              input: ({ context }) => ({ orderId: context.inspectingOrderId }),
              done: "active",
              fail: "active",
            },
          },
        },
        tasks: {
          create({ api, value }) {
            return api.orders.create(value);
          },
          inspect({ api, value }) {
            return api.orders.inspect(value);
          },
        },
      },
      view({
        state,
        actions,
        parts: {
          Root,
          Header,
          Eyebrow,
          Title,
          Description,
          Composer,
          Input,
          Create,
          Summary,
          SummaryItem,
          SummaryLabel,
          SummaryValue,
          Orders,
          Order: OrderRow,
          OrderMain,
          OrderTitle,
          OrderMeta,
          OrderStatus,
          Empty,
        },
      }) {
        return (
          <Root>
            <Header>
              <Eyebrow>Resource event → server program → projection</Eyebrow>
              <Title>Orders pipeline</Title>
              <Description>
                A durable program calls the payment capability and commits its result to two
                synchronized resources.
              </Description>
            </Header>
            <Composer>
              <Input
                value={state.title}
                disabled={state.busy}
                placeholder="Name a new order"
                aria-label="Order name"
                onInput={(event) => actions.change({ title: event.currentTarget.value })}
              />
              <Create type="button" disabled={!state.canCreate} {...createPress(actions.create)}>
                {state.busy ? "Creating" : "Create"}
              </Create>
            </Composer>
            <Summary>
              <SummaryItem>
                <SummaryLabel>Approved</SummaryLabel>
                <SummaryValue>{state.approved}</SummaryValue>
              </SummaryItem>
              <SummaryItem>
                <SummaryLabel>Declined</SummaryLabel>
                <SummaryValue>{state.declined}</SummaryValue>
              </SummaryItem>
              <SummaryItem>
                <SummaryLabel>Revenue</SummaryLabel>
                <SummaryValue>{formatCurrency(state.revenue)}</SummaryValue>
              </SummaryItem>
            </Summary>
            <Orders>
              <For
                each={state.orders}
                by="id"
                fallback={<Empty>{state.ready ? "No orders yet" : "Synchronizing orders"}</Empty>}
              >
                {(order) => (
                  <OrderRow
                    onPointerEnter={() => actions.inspect({ orderId: order.id })}
                    onPointerLeave={() => actions.inspect({ orderId: null })}
                  >
                    <OrderMain>
                      <OrderTitle>{order.title}</OrderTitle>
                      <OrderMeta>{formatCurrency(order.total)}</OrderMeta>
                    </OrderMain>
                    <OrderStatus data-status={order.status}>{order.status}</OrderStatus>
                  </OrderRow>
                )}
              </For>
            </Orders>
            <Description aria-live="polite">
              {state.inspectors > 0
                ? `${state.inspectors} local session inspecting an order`
                : state.pending > 0
                  ? `${state.pending} awaiting payment capability`
                  : "Pipeline idle"}
            </Description>
          </Root>
        );
      },
    },
  },
  api: ({ actor, resources }) => {
    const orders = resources.orders({ ownerId: actor.id });
    const summary = resources.summary({ ownerId: actor.id });
    return {
      orders: {
        get orders() {
          return orders.orders;
        },
        get pending() {
          return orders.pending;
        },
        get inspectors() {
          return orders.inspectors;
        },
        sync: orders.sync,
        create: orders.create,
        settle: orders.settle,
        inspect({ orderId }) {
          orders.setPresence({ inspectingOrderId: orderId });
        },
      },
      summary: {
        get approved() {
          return summary.approved;
        },
        get declined() {
          return summary.declined;
        },
        get revenue() {
          return summary.revenue;
        },
        sync: summary.sync,
        record: summary.record,
      },
      recordSummary: ({ ownerId, ...event }) => resources.summary({ ownerId }).record(event),
    };
  },
} satisfies FeatureDef<App, OrdersFeature>;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function checksum(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
