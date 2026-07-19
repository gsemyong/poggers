import { describe, expect, test } from "vitest";

import { POGGERS_IR_VERSION, type ProgramIR } from "../../core/compiler/ir";
import { createWebPlatformAdapter } from "./index";

describe("web Platform Adapter", () => {
  test("pairs the web UI implementation with the web realization", () => {
    const adapter = createWebPlatformAdapter();

    expect(adapter.name).toBe("web");
    expect(adapter.ui.name).toBe("web");
    expect(adapter.ui.component.createApplicationUI).toBeTypeOf("function");
    expect(adapter.ui.presentation.create).toBeTypeOf("function");
  });

  test("rejects unsupported Environments before starting native work", async () => {
    const adapter = createWebPlatformAdapter();
    const program = programIR("browser-service-worker");
    const ir = {
      version: POGGERS_IR_VERSION,
      application: { id: "application/test", name: "test", presentations: [] },
      platforms: ["web"],
      features: [],
      programs: [program],
    } as const;

    await expect(
      adapter.develop({
        directory: "/tmp/test",
        application: "/tmp/test/src/app.ts",
        ir,
        programs: [program],
        platform: "web",
      }),
    ).rejects.toThrow('does not yet realize "feature/test/program/worker"');
  });
});

function programIR(environment: string): ProgramIR {
  return {
    id: "feature/test/program/worker",
    feature: "test",
    name: "worker",
    environment: { name: environment, platform: "web" },
    requires: [],
    provides: [],
    start: { asynchronous: false, body: [], span: { file: "app.ts", line: 1, column: 1 } },
    span: { file: "app.ts", line: 1, column: 1 },
  };
}
