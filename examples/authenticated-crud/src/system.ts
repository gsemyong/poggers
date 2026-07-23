import { createApp, createSystem, type PlatformInterfaceContract } from "@poggers/kit";
import { createWebInterface, type WebPlatform } from "@poggers/kit/web";

import { identity, type IdentityFeature } from "./features/identity";
import { shell, type ShellFeature } from "./features/shell";
import { tasks, type TasksFeature } from "./features/tasks";
import { clean } from "./presentations/clean";

type WebContract = Readonly<{
  Features: {
    identity: IdentityFeature;
    shell: ShellFeature;
    tasks: TasksFeature;
  };
}>;

export type OperationsWeb = PlatformInterfaceContract<WebContract, WebPlatform>;

const icon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%230d1726'/%3E%3Cpath d='M150 128h124c72 0 116 39 116 104 0 66-44 105-116 105h-48v47h-76V128zm76 64v81h43c29 0 44-14 44-41 0-26-15-40-44-40h-43z' fill='white'/%3E%3C/svg%3E";

const web = createWebInterface<WebContract>({
  features: { identity, shell, tasks },
  presentation: clean,
  installation: {
    shortName: "Poggers",
    start: { to: "tasks.list" },
    icons: [
      { src: icon, sizes: "192x192", type: "image/svg+xml", purpose: ["any"] },
      { src: icon, sizes: "512x512", type: "image/svg+xml", purpose: ["any", "maskable"] },
    ],
    shortcuts: [{ name: "New task", destination: { to: "tasks.create" } }],
    offline: { fallback: { to: "shell.auth" } },
  },
});

const operations = createApp<{ Features: { web: OperationsWeb } }>({
  features: { web },
});

export default createSystem({
  metadata: { name: "Poggers Operations" },
  features: { operations },
});
