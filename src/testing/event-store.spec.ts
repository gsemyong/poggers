import { eventStoreConformance } from "@/platforms/server/testing";
import { createMemoryEventStore } from "@/testing/event-store";

eventStoreConformance.test({
  name: "memory",
  create() {
    return {
      api: createMemoryEventStore(),
      dispose() {},
    };
  },
});
