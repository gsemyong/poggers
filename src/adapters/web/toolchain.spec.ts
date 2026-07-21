import { describe, expect, it } from "vitest";

import { collectPresentationDependencies } from "@/adapters/web/toolchain";
import { POGGERS_IR_VERSION, type ApplicationIR } from "@/core/compiler/ir";

describe("web Presentation dependency manifest", () => {
  it("preserves exact destinations and classifies independent Components", () => {
    const manifest = collectPresentationDependencies(applicationIR(), "browser");

    expect(manifest).toEqual({
      "@feature/dashboard/component/Animated": [
        {
          destination: "Dashboard/Animated/Root/paint/opacity",
          animations: [
            {
              id: "Presentation/Dashboard/Animated::opacity",
              scope: "Presentation/Dashboard/Animated",
            },
          ],
        },
      ],
    });
    expect(manifest["@feature/dashboard/component/Static"]).toBeUndefined();
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it("keeps unresolved temporal use conservative instead of guessing static", () => {
    const source = applicationIR();
    const manifest = collectPresentationDependencies(
      {
        ...source,
        presentations: [
          {
            ...source.presentations[0]!,
            declarations: [],
          },
        ],
      },
      "browser",
    );

    expect(Object.keys(manifest)).toEqual([
      "@feature/dashboard/component/Animated",
      "@feature/dashboard/component/Static",
    ]);
    expect(manifest["@feature/dashboard/component/Static"]?.[0]?.destination).toBe("*");
  });
});

function applicationIR(): ApplicationIR {
  const span = { file: "src/presentation.ts", line: 1, column: 1 } as const;
  return {
    version: POGGERS_IR_VERSION,
    application: { id: "application/test", name: "test", presentations: ["clean"] },
    platforms: ["web"],
    features: [],
    programs: [
      {
        id: "program/browser",
        name: "browser",
        environment: { name: "browser-main", platform: "web", ui: "web" },
        ui: { root: { feature: "dashboard", component: "Animated" } },
        contributions: [
          {
            id: "feature/dashboard/program/browser",
            feature: "dashboard",
            requires: [],
            provides: [],
            ui: {
              state: { kind: "record", fields: [] },
              actions: [],
              components: [
                {
                  name: "Animated",
                  propCallbacks: [],
                  state: { kind: "record", fields: [] },
                  actions: [],
                  elements: [{ name: "Root", element: "div" }],
                  implementation: { state: false, actions: false, mount: false, view: true },
                },
                {
                  name: "Static",
                  propCallbacks: [],
                  state: { kind: "record", fields: [] },
                  actions: [],
                  elements: [{ name: "Root", element: "div" }],
                  implementation: { state: false, actions: false, mount: false, view: true },
                },
              ],
              root: "Animated",
            },
            implementation: { kind: "source", reason: "platform-ui", span },
            span,
          },
        ],
      },
    ],
    presentations: [
      {
        file: "src/presentation.ts",
        animations: [
          {
            id: "Presentation/Dashboard/Animated::opacity",
            scope: "Presentation/Dashboard/Animated",
            binding: "opacity",
            source: "state.visible ? 1 : 0",
            animation: "spring()",
            events: [],
            span,
          },
        ],
        declarations: [
          {
            destination: "Dashboard/Animated/Root/paint/opacity",
            expression: "opacity",
            animations: ["Presentation/Dashboard/Animated::opacity"],
            span,
          },
        ],
      },
    ],
  };
}
