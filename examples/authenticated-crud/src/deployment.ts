import { createDeployment } from "kit";
import { createLocalDeploymentAdapter } from "kit/adapters/deployment/local";

import system from "./system";

export default createDeployment(system, {
  adapter: createLocalDeploymentAdapter(),
  programs: {
    api: { replicas: 1 },
  },
});
