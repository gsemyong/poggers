import { createApp } from "kit";
import { createWebInterface } from "kit/web";

import { dashboard, type DashboardFeature } from "@/features/dashboard";
import { editorial } from "@/presentations/web";

export type Main = {
  Features: { dashboard: DashboardFeature };
};

const web = createWebInterface<Main>({
  presentation: editorial,
});

export const main = createApp({
  features: { dashboard },
  interfaces: { web },
});
