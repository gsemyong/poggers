import type { Application } from "@poggers/kit";
import { shell, type ShellFeature } from "src/features/shell";
import { clean } from "src/presentations/clean";

export type App = {
  Features: { shell: ShellFeature };
  Presentations: "clean";
};

export default {
  metadata: { name: "{{name}}" },
  features: { shell },
  presentations: { clean },
} satisfies Application<App>;
