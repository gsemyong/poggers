import { createSystem } from "@duction/kit";

import { main } from "@/apps/main/app";

export default createSystem({
  metadata: { name: "Basic" },
  features: { main },
});
