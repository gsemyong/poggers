import { createWorkspaceApp } from "@/apps/workspace";
import { createShell } from "@/features/shell";

export const operationsShell = createShell({ name: "Operations" });
export const operations = createWorkspaceApp({ shortName: "Operations" });
