import { createApp } from "kit";

import { createWorkspaceWeb } from "../web";

export const operations = createApp({
  features: { web: createWorkspaceWeb({ shortName: "Operations" }) },
});
