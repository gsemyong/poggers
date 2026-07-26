import { createSystem } from "kit";

import { main, type Main } from "@/apps/main";

type PresentationSystem = {
  Applications: { main: Main };
};

export default createSystem<PresentationSystem>({
  metadata: { name: "Web Presentation" },
  applications: { main },
});
