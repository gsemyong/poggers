import { createApplication } from "kit";
import type { WebPlatform } from "kit/web";

import { dashboard, type DashboardFeature } from "@/features/dashboard";
import { editorial } from "@/presentations/web";

export type Main = {
  Features: { dashboard: DashboardFeature };
  Interfaces: WebPlatform;
};

export const main = createApplication<Main>({
  features: { dashboard },
  interfaces: {
    web: { presentation: editorial },
  },
});
