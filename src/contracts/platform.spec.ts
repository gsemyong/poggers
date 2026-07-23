import { describe, expect, test } from "vitest";

import { POGGERS_IR_VERSION, type ApplicationIR } from "@/compiler/ir";
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

    expect(selectPlatformAdapters(application(["server", "web"]), { web, server })).toEqual([
      server,
      web,
    ]);
  });

  test("rejects missing, mismatched, and duplicate bindings", () => {
    expect(() => selectPlatformAdapters(application(["web"]), {})).toThrow(
      'No Platform Adapter is registered for "web".',
    );
    expect(() => selectPlatformAdapters(application(["web"]), { web: adapter("native") })).toThrow(
      'Platform Adapter "web" identifies itself as "native".',
    );
    expect(() =>
      selectPlatformAdapters(
        { ...application(["web"]), platforms: ["web", "web"] },
        {
          web: adapter("web"),
        },
      ),
    ).toThrow("Application IR contains duplicate Platforms.");
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

function application(platforms: readonly string[]): ApplicationIR {
  return {
    version: POGGERS_IR_VERSION,
    application: { id: "application/test", name: "test", presentations: [] },
    platforms,
    features: [],
    programs: [],
    presentations: [],
  };
}
