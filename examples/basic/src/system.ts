import { createSystem } from "kit";

import { main } from "@/apps/main";

export default createSystem({
  metadata: { name: "Basic" },
  features: { main },
});
