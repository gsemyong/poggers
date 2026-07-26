import { createLocalDeploymentAdapter } from "kit/adapters/deployment/local";
import { createDeployment } from "kit/deployment";

import system from "@/system";

export default createDeployment(system, {
  adapter: createLocalDeploymentAdapter(),
});
