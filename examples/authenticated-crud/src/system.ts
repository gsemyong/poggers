import { createSystem } from "kit";

import { customer } from "@/apps/customer";
import { operations } from "@/apps/operations";

export default createSystem({
  metadata: { name: "Authenticated workspace" },
  features: { operations, customer },
});
