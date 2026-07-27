import { createApplication } from "kit";
import type { WebPlatform } from "kit/web";

import type { DashboardFeature } from "@/features/dashboard";
import { editorial } from "@/presentations/web";

export type Main = {
  Name: "Presentation";
  Features: { dashboard: DashboardFeature };
  Interfaces: WebPlatform;
};

export const main = createApplication<Main>({
  interfaces: {
    web: { presentation: editorial },
  },
});
