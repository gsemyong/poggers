import type { AppDef } from "@poggers/kit";
import {
  createOrderFulfillment,
  type OrderFulfillmentFeature,
} from "src/features/order-fulfillment";

export type App = {
  Actor: { readonly id: string };
  Resources: {};
  Features: { fulfillment: OrderFulfillmentFeature };
};

export default {
  version: 1,
  app: { name: "Workflow stress test" },
  features: {
    fulfillment: createOrderFulfillment<App>(),
  },
} satisfies AppDef<App>;
