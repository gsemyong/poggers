import { createSystem } from "kit";

import { customer, customerShell } from "@/apps/customer";
import { operations, operationsShell } from "@/apps/operations";
import type { Workspace } from "@/apps/workspace";
import { identity, type IdentityBrowserFeature } from "@/features/identity";
import type { ShellFeature } from "@/features/shell";
import { tasks, type TasksFeature } from "@/features/tasks";

type AuthenticatedWorkspace = {
  Features: {
    identity: IdentityBrowserFeature;
    customerShell: ShellFeature<"Customer">;
    operationsShell: ShellFeature<"Operations">;
    tasks: TasksFeature;
  };
  Applications: {
    customer: Workspace<"Customer">;
    operations: Workspace<"Operations">;
  };
};

export default createSystem<AuthenticatedWorkspace>({
  metadata: { name: "Authenticated workspace" },
  features: { identity, customerShell, operationsShell, tasks },
  applications: { operations, customer },
});
