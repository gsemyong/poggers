import { createSystem } from "@duction/kit";

import { product } from "@/product";

export default createSystem({
  metadata: { name: "Web request conformance" },
  features: { product },
});
