import { createSystem } from "kit";

import { customer } from "@/apps/customer/app";
import { operations } from "@/apps/operations/app";

export default createSystem({
  metadata: { name: "Authenticated workspace" },
  features: { operations, customer },
});
