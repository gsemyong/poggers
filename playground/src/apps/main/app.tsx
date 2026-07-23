import { createApp, type PlatformInterfaceContract } from "@duction/kit";
import { createWebInterface, type WebPlatform } from "@duction/kit/web";

import { dashboard, type DashboardFeature } from "../../features/dashboard";
import { editorial } from "../../presentations/editorial";

type WebContract = {
  Features: { dashboard: DashboardFeature };
};

export type Web = PlatformInterfaceContract<WebContract, WebPlatform>;

const web = createWebInterface<WebContract>({
  features: { dashboard },
  presentation: editorial,
});

export const main = createApp<{ Features: { web: Web } }>({
  features: { web },
});
