import { createSystem } from "kit";

import { main } from "@/apps/main/app";

export default createSystem({
  metadata: { name: "Basic" },
  features: { main },
});
