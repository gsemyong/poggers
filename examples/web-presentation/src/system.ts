import { createApp, createSystem, type PlatformInterfaceContract } from "@poggers/kit";
import { createWebInterface, type WebPlatform } from "@poggers/kit/web";

import { dashboard, type DashboardFeature } from "./features/dashboard";
import { editorial } from "./presentations/editorial";

type WebContract = {
  Features: { dashboard: DashboardFeature };
};

export type Web = PlatformInterfaceContract<WebContract, WebPlatform>;

const web = createWebInterface<WebContract>({
  features: { dashboard },
  presentation: editorial,
});

const app = createApp<{ Features: { web: Web } }>({
  features: { web },
});

export default createSystem({
  metadata: { name: "Web Presentation" },
  features: { app },
});
