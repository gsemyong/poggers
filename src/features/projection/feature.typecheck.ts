import { createSystem } from "@/core/system";
import type { Aggregate } from "@/features/aggregate";
import { orders } from "@/features/aggregate/feature.typecheck";
import { type Projection, createProjection } from "@/features/projection";

type Operations = Projection<{
  Name: "operations";
  Version: 1;
  Principal: Readonly<{
    id: string;
    organization: string;
    roles: readonly ("operator" | "viewer")[];
  }>;
  Sources: {
    orders: Aggregate.Events<typeof orders>;
  };
  Rows: {
    orders: Readonly<{
      id: string;
      organization: string;
      product: string;
      note: string;
      status: "placed" | "cancelled";
      quantity: number;
      value: number;
      embedding: readonly number[];
    }>;
    substitutions: Readonly<{ id: string; from: string; to: string }>;
    warehouses: Readonly<{
      id: string;
      organization: string;
      location: Readonly<{ latitude: number; longitude: number }>;
    }>;
  };
  Queries: {
    Text: { orders: "product" | "note" };
    Vector: {
      orders: { Field: "embedding"; Dimensions: 3 };
    };
    Graph: {
      substitutions: { From: "from"; To: "to" };
    };
    Geo: {
      warehouses: "location";
    };
    Analytics: { orders: true };
  };
}>;

export const operationsDefinition = {
  reduce({ event, rows }) {
    if (event.type === "placed") {
      return [
        {
          upsert: {
            orders: {
              id: event.key,
              organization: event.data.organization,
              product: event.data.product,
              note: event.data.note,
              status: "placed",
              quantity: event.data.quantity,
              value: event.data.quantity * 10,
              embedding: [event.data.quantity, 1, 0],
            },
          },
        },
        {
          upsert: {
            substitutions: {
              id: `${event.key}:substitution`,
              from: event.data.product,
              to: `${event.data.product}-alternative`,
            },
          },
        },
        {
          upsert: {
            warehouses: {
              id: `${event.key}:warehouse`,
              organization: event.data.organization,
              location: { latitude: 48.1486, longitude: 17.1077 },
            },
          },
        },
      ];
    }
    const previous = rows.orders.find(({ id }) => id === event.key);
    return previous === undefined
      ? []
      : [
          {
            upsert: {
              orders: {
                ...previous,
                status: "cancelled",
              },
            },
          },
        ];
  },
  authorize({ principal }) {
    return {
      orders: { where: { organization: { equal: principal.organization } } },
      substitutions: {},
      warehouses: { where: { organization: { equal: principal.organization } } },
    };
  },
} satisfies Projection.Definition<Operations>;

export const operations = createProjection<Operations>(operationsDefinition);

function checkProjectionReference(reference: Projection.Reference<typeof operations>): void {
  const view = reference.for({
    principal: {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    },
  });
  view.orders({
    find: {
      where: {
        status: { equal: "placed" },
        quantity: { atLeast: 2 },
      },
      order: [{ field: "quantity", direction: "descending" }],
      limit: 20,
    },
  });
  view.orders({
    text: { value: "careful product", fields: ["product", "note"] },
    select: { where: { status: { equal: "placed" } } },
  });
  view.orders({
    vector: { field: "embedding", value: [1, 0, 0], limit: 5 },
  });
  view.substitutions({
    graph: {
      from: "from",
      to: "to",
      start: "product-1",
      depth: 3,
      direction: "outgoing",
    },
  });
  view.warehouses({
    geo: {
      field: "location",
      origin: { latitude: 48.1486, longitude: 17.1077 },
      within: 50_000,
    },
  });
  view.orders({
    analytics: {
      groupBy: ["status"],
      measures: {
        count: { count: true },
        value: { sum: "value" },
      },
    },
  });

  // @ts-expect-error Text search can only address declared text fields.
  view.orders({ text: { value: "x", fields: ["organization"] } });
  // @ts-expect-error Vector search is not declared for warehouses.
  view.warehouses({ vector: { field: "location", value: [1] } });
  // @ts-expect-error Conditions preserve field value types.
  view.orders({ find: { where: { quantity: { atLeast: "two" } } } });
}

void checkProjectionReference;

export default createSystem({
  features: { orders, operations },
});
