import { createApp } from "@poggers/kit";

import { createWorkspaceWeb, type WorkspaceWeb } from "../web";

export const operations = createApp<{ Features: { web: WorkspaceWeb } }>({
  features: { web: createWorkspaceWeb({ shortName: "Operations" }) },
});
