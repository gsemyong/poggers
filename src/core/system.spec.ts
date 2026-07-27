import { describe, expect, it } from "vitest";

import { createFeature, resolveFeatureProvider } from "@/core/feature";
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
      interfaces: {
        web: {
          presentation: { parameters: {}, create: () => ({ Leaf: () => ({}) }) },
        },
      },
    });
    const system = createSystem({
      metadata: { name: "Company" },
      features: { leaf },
      applications: { leaf: app },
    });

    expect(system).toEqual({
      metadata: { name: "Company" },
      features: { leaf: {} },
      applications: {
        leaf: {
          interfaces: {
            web: {
              presentation: { parameters: {}, create: expect.any(Function) },
            },
          },
        },
      },
    });
    expect(system.applications.leaf).toBe(app);
    expect(system.features.leaf).toBe(leaf);
  });

  it("resolves providers only from the System Feature namespace", () => {
    const provider = Object.freeze({ name: "feature" });
    const applicationProvider = Object.freeze({ name: "application" });
    const system = {
      features: {
        shared: { providers: { server: { storage: provider } } },
      },
      applications: {
        shared: { providers: { server: { storage: applicationProvider } } },
        applicationOnly: { providers: { server: { storage: applicationProvider } } },
      },
    };

    expect(
      resolveFeatureProvider(system, {
        feature: "shared",
        platform: "server",
        dependency: "storage",
      }),
    ).toBe(provider);
    expect(() =>
      resolveFeatureProvider(system, {
        feature: "applicationOnly",
        platform: "server",
        dependency: "storage",
      }),
    ).toThrow('Feature provider owner "applicationOnly" is unavailable at runtime.');
  });
});
