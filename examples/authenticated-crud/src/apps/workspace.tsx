import { createApplication } from "kit";
import type { WebPlatform } from "kit/web";

import type { IdentityBrowserFeature } from "@/features/identity";
import type { ShellFeature } from "@/features/shell";
import type { TasksFeature } from "@/features/tasks";
import { clean } from "@/presentations/web";

export type Workspace<Name extends string = string> = Readonly<{
  Name: Name;
  Features: {
    identity: IdentityBrowserFeature;
    shell: ShellFeature<Name>;
    tasks: TasksFeature;
  };
  Interfaces: WebPlatform<{
    Mounts: {
      shell: {
        Path: "";
        Route: "workspace";
        Children: {
          tasks: { Path: "tasks"; Route: "root" };
        };
      };
    };
  }>;
}>;

const icon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%230d1726'/%3E%3Cpath d='M150 128h124c72 0 116 39 116 104 0 66-44 105-116 105h-48v47h-76V128zm76 64v81h43c29 0 44-14 44-41 0-26-15-40-44-40h-43z' fill='white'/%3E%3C/svg%3E";

/** Creates one Application while reusing shared identity and task Features. */
export function createWorkspaceApp<const Name extends string>(
  input: Readonly<{ shortName: Name }>,
) {
  return createApplication<Workspace<Name>>({
    interfaces: {
      web: {
        presentation: clean,
        installation: {
          shortName: input.shortName,
          start: { feature: "tasks", route: "list" },
          icons: [
            { src: icon, sizes: "192x192", type: "image/svg+xml", purpose: ["any"] },
            { src: icon, sizes: "512x512", type: "image/svg+xml", purpose: ["any", "maskable"] },
          ],
          shortcuts: [{ name: "New task", destination: { feature: "tasks", route: "create" } }],
          offline: { fallback: { feature: "shell", route: "auth" } },
        },
      },
    },
  });
}
