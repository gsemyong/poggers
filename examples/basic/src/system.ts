import { createSystem } from "kit";

import { main, type Main } from "@/apps/main";

type Basic = {
  Applications: { main: Main };
};

export default createSystem<Basic>({
  metadata: { name: "Basic" },
  applications: { main },
});
