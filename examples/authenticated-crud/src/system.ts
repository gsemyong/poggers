import { createSystem } from "@poggers/kit";

import { customer } from "./apps/customer/app";
import { operations } from "./apps/operations/app";
import { identityServer } from "./features/identity";
import { taskServer } from "./features/tasks";

export default createSystem({
  metadata: { name: "Authenticated workspace" },
  features: { identity: identityServer, tasks: taskServer, operations, customer },
});
