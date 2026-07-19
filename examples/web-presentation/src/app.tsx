import type { Application } from "@poggers/kit";

import { dashboard, type DashboardFeature } from "./dashboard";
import { editorial } from "./presentation";

export type App = {
  Features: { dashboard: DashboardFeature };
  Presentations: "editorial";
};

export default {
  metadata: { name: "Web Presentation" },
  features: { dashboard },
  presentations: { editorial },
} satisfies Application<App>;
