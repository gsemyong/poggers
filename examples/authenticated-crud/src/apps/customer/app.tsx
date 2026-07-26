import { createApp } from "kit";

import { createWorkspaceWeb } from "@/apps/web";

export const customer = createApp({
  features: { web: createWorkspaceWeb({ shortName: "Customer" }) },
});
