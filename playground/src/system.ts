import { createSystem } from "@poggers/kit";

import { main } from "./apps/main/app";

export default createSystem({
  metadata: { name: "Web Presentation" },
  features: { main },
});
