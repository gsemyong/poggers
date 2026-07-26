import { describe, expect, it } from "vitest";

import { createFeature } from "@/core/feature";
import { createApplication, createSystem } from "@/core/system";
import type { WebPlatform } from "@/platforms/web";

describe("System authoring", () => {
  it("retains explicit Feature and Application roots without runtime wrappers", () => {
    const leaf = createFeature<{}>({});
    type Product = {
      Features: { leaf: {} };
      Interfaces: WebPlatform;
    };
    const app = createApplication<Product>({
      features: { leaf },
      interfaces: {
        web: {
          presentation: { parameters: {}, create: () => ({ Leaf: () => ({}) }) },
        },
      },
    });
    const system = createSystem({
      metadata: { name: "Company" },
      applications: { app },
    });

    expect(system).toEqual({
      metadata: { name: "Company" },
      applications: {
        app: {
          features: { leaf: {} },
          interfaces: {
            web: {
              presentation: { parameters: {}, create: expect.any(Function) },
            },
          },
        },
      },
    });
    expect(system.applications.app).toBe(app);
    expect(app.features.leaf).toBe(leaf);
  });
});
