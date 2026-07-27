import { createSystem } from "kit";

import { main, type Main } from "@/apps/main";
import { dashboard, type DashboardFeature } from "@/features/dashboard";

type PresentationSystem = {
  Features: { dashboard: DashboardFeature };
  Applications: { main: Main };
};

export default createSystem<PresentationSystem>({
  metadata: { name: "Web Presentation" },
  features: { dashboard },
  applications: { main },
});
