import type { Application } from "@poggers/kit";

import { identity, type IdentityFeature } from "./features/identity";
import { shell, type ShellFeature } from "./features/shell";
import { tasks, type TasksFeature } from "./features/tasks";
import { clean } from "./presentations/clean";

export type App = Readonly<{
  Features: {
    identity: IdentityFeature;
    shell: ShellFeature;
    tasks: TasksFeature;
  };
  Presentations: "clean";
}>;

export default {
  metadata: { name: "Poggers Operations" },
  features: { identity, shell, tasks },
  presentations: { clean },
} satisfies Application<App>;
