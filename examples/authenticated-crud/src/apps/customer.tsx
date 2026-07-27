import { createWorkspaceApp } from "@/apps/workspace";
import { createShell } from "@/features/shell";

export const customerShell = createShell({ name: "Customer" });
export const customer = createWorkspaceApp({ shortName: "Customer" });
