import { createApp } from "kit";

import { createWorkspaceWeb } from "../web";

export const customer = createApp({
  features: { web: createWorkspaceWeb({ shortName: "Customer" }) },
});
