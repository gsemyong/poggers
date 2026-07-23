import { createApp } from "@duction/kit";

import { createWorkspaceWeb, type WorkspaceWeb } from "../web";

export const customer = createApp<{ Features: { web: WorkspaceWeb } }>({
  features: { web: createWorkspaceWeb({ shortName: "Customer" }) },
});
