import type { Application } from "@poggers/kit";

import { dashboard, type DashboardFeature } from "./features/dashboard";
import { editorial } from "./presentations/editorial";

export type App = {
  Features: { dashboard: DashboardFeature };
  Presentations: "editorial";
};

export default {
  metadata: { name: "Web Presentation" },
  features: { dashboard },
  presentations: { editorial },
} satisfies Application<App>;
