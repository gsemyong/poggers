import { createLocalDeploymentAdapter } from "kit/adapters/deployment/local";
import { createDeployment } from "kit/deployment";

import system from "@/system";

export default createDeployment(system, {
  adapter: createLocalDeploymentAdapter(),
  interfaces: {
    customer: {
      web: { hosts: ["customer.localhost"] },
    },
    operations: {
      web: { hosts: ["operations.localhost"] },
    },
  },
  programs: {
    server: { replicas: 1 },
  },
});
