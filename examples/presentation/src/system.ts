import { createSystem } from "kit";

import { main } from "@/apps/main";

export default createSystem({
  metadata: { name: "Web Presentation" },
  features: { main },
});
