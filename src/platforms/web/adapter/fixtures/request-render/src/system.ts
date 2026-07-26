import { createSystem } from "kit";

import { administration, product } from "@/product";

export default createSystem({
  metadata: { name: "Web request conformance" },
  features: { administration, product },
});
