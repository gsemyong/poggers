import { createSystem } from "@poggers/kit";

import { product } from "@/product";

export default createSystem({
  metadata: { name: "Web request conformance" },
  features: { product },
});
