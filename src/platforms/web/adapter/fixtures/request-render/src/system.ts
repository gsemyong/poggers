import { createSystem } from "kit";

import { administration, background, dashboard, greeting, origin, product } from "@/product";

export default createSystem({
  metadata: { name: "Web request conformance" },
  features: { background, dashboard, greeting, origin },
  applications: { administration, product },
});
