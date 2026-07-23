import { describe, expect, it } from "vitest";

import { createFeature } from "@/core/feature";
import { createApp, createSystem } from "@/core/system";

describe("System authoring", () => {
  it("retains one ordinary Feature tree without runtime wrappers", () => {
    const leaf = createFeature<{}>({});
    const app = createApp<{ Features: { leaf: {} } }>({
      features: { leaf },
    });
    const system = createSystem({
      metadata: { name: "Company" },
      features: { app },
    });

    expect(system).toEqual({
      metadata: { name: "Company" },
      features: { app: { features: { leaf: {} } } },
    });
    expect(system.features.app).toBe(app);
    expect(app.features.leaf).toBe(leaf);
  });
});
