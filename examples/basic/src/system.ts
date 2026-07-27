import { createSystem } from "kit";

import { main, type Main } from "@/apps/main";
import { shell, type ShellFeature } from "@/features/shell";

type Basic = {
  Features: { shell: ShellFeature };
  Applications: { main: Main };
};

export default createSystem<Basic>({
  metadata: { name: "Basic" },
  features: { shell },
  applications: { main },
});
