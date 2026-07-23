import { describe, expect, test } from "vitest";

import {
  selectPlatformAdapters,
  type DevelopmentSession,
  type PlatformAdapterImplementation,
  type ProductionArtifacts,
} from "@/contracts/platform";

describe("Platform Adapter selection", () => {
  test("selects required adapters in deterministic Platform order", () => {
    const server = adapter("server");
    const web = adapter("web");

    expect(selectPlatformAdapters(["server", "web"], { web, server })).toEqual([server, web]);
  });

  test("rejects missing, mismatched, and duplicate bindings", () => {
    expect(() => selectPlatformAdapters(["web"], {})).toThrow(
      'No Platform Adapter is registered for "web".',
    );
    expect(() => selectPlatformAdapters(["web"], { web: adapter("native") })).toThrow(
      'Platform Adapter "web" identifies itself as "native".',
    );
    expect(() =>
      selectPlatformAdapters(["web", "web"], {
        web: adapter("web"),
      }),
    ).toThrow("System output selection contains duplicate Platforms.");
  });
});

function adapter(name: string): PlatformAdapterImplementation {
  const session = {} as DevelopmentSession;
  const artifacts = {} as ProductionArtifacts;
  return {
    name,
    async develop() {
      return session;
    },
    async build() {
      return artifacts;
    },
  };
}
