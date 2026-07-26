import { createSystem } from "kit";

import { customer } from "@/apps/customer";
import { operations } from "@/apps/operations";
import type { Workspace } from "@/apps/workspace";

type AuthenticatedWorkspace = {
  Applications: {
    customer: Workspace;
    operations: Workspace;
  };
};

export default createSystem<AuthenticatedWorkspace>({
  metadata: { name: "Authenticated workspace" },
  applications: { operations, customer },
});
