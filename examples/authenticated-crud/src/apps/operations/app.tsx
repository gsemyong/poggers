import { createApp } from "kit";

import { createWorkspaceWeb } from "@/apps/web";

export const operations = createApp({
  features: { web: createWorkspaceWeb({ shortName: "Operations" }) },
});
