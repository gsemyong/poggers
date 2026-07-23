import { readFile } from "node:fs/promises";

import { createPresentationFrame, createUIContributionInstance } from "@poggers/kit/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  planWebPresentationArtifacts,
  validateWebPresentationSource,
} from "@/adapters/web/ui/presentation/compiler";
import { createWebAnimationHost } from "@/adapters/web/ui/presentation/runtime/animation";
import { compilePresentationSource } from "@/compiler/presentation";
import { evaluatePresentationFrame } from "@/core/ui/presentation";
import { createActionEventLedger } from "@/runtime/presentation";

import { editorial } from "../presentations/editorial";
import { dashboard, type SheetState } from "./dashboard";

type DashboardAPI = Readonly<{
  sheet: SheetState;
  openSheet(): void;
  closeSheet(input: { source: "button" | "backdrop" | "escape" }): void;
  beginSheetDrag(): void;
  updateSheetDrag(input: { offset: number; velocity: number }): void;
  releaseSheet(input: { offset: number; velocity: number }): void;
  cancelSheetDrag(): void;
}>;

describe("canonical sheet behavior state", () => {
  it("evaluates the authored behavior through one deterministic frame and artifact plan", () => {
    const environment = {
      viewport: { inlineSize: 1_280, blockSize: 720, scale: 1 },
      safeArea: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      preferences: { reducedMotion: false, contrast: "normal", colorScheme: "light" },
      input: { hover: true, pointer: "fine" },
    } as const;
    const state = {
      compact: false,
      reversed: false,
      warm: true,
      sheet: { status: "closed", view: "summary", via: { kind: "initial" } },
    } as const;
    const events = createActionEventLedger([
      "toggleDensity",
      "reorderMetrics",
      "toggleAccent",
      "openSheet",
      "closeSheet",
      "toggleSheetView",
      "beginSheetDrag",
      "updateSheetDrag",
      "releaseSheet",
      "cancelSheetDrag",
    ]).events;
    const shared = createWebAnimationHost({ now: () => 0, reducedMotion: () => false });
    const local = createWebAnimationHost({
      now: () => 0,
      reducedMotion: () => false,
      parents: [shared],
    });
    const root = editorial.create({
      parameters: editorial.parameters,
      environment,
      state: {} as never,
      events: {} as never,
    });

    shared.begin(0);
    const feature = evaluatePresentationFrame(shared, () =>
      root.Dashboard({ state: state as never, events: events as never }),
    );
    shared.end();
    local.begin(0);
    const declarations = evaluatePresentationFrame(local, () =>
      feature.Overview({
        props: {},
        state: state as never,
        events: events as never,
        elements: {
          SheetPanel: observation("SheetPanel", 280),
        } as never,
      }),
    );
    local.end();
    const frame = createPresentationFrame({
      time: 0,
      input: { behavior: state, parameters: editorial.parameters, environment },
      temporal: { shared: shared.inspectFrame(0), local: local.inspectFrame(0) },
      declarations,
    });
    const plan = planWebPresentationArtifacts(frame.declarations as never, { dynamic: true });

    expect(frame.declarations).toMatchObject({
      Sheet: { presence: { value: 0, settled: true } },
      SheetBackdrop: { paint: { opacity: 0 } },
      SheetPanel: { paint: { opacity: 0 } },
    });
    expect(plan.elements.Sheet).toMatchObject({
      execution: { kind: "canonical", reason: "dynamic-declaration" },
      presence: { value: 0, settled: true },
    });
    expect(plan.elements.SheetPanel?.ownership).toMatchObject({
      opacity: "presentation",
      scale: "presentation",
      translate: "presentation",
    });
    expect(JSON.stringify(frame)).toBe(
      JSON.stringify(
        createPresentationFrame({
          time: 0,
          input: { behavior: state, parameters: editorial.parameters, environment },
          temporal: { shared: shared.inspectFrame(0), local: local.inspectFrame(0) },
          declarations,
        }),
      ),
    );
    local.dispose();
    shared.dispose();
  });

  it("drives sheet presence, backdrop, and panel from one compiled coordinate", async () => {
    const source = await readFile(
      new URL("../presentations/editorial.ts", import.meta.url),
      "utf8",
    );
    const compilation = compilePresentationSource(source, "presentations/editorial.ts");
    expect(() => validateWebPresentationSource(compilation.ir)).not.toThrow();
    const declarations = compilation.ir.declarations;
    const position = "createEditorial/Dashboard/Overview::position";
    const destinations = declarations
      .filter(({ animations }) => animations.includes(position))
      .map(({ destination }) => destination);

    expect(destinations).toEqual(
      expect.arrayContaining([
        "Dashboard/Overview/Sheet/presence/value",
        "Dashboard/Overview/Sheet/presence/velocity",
        "Dashboard/Overview/Sheet/presence/settled",
        "Dashboard/Overview/SheetBackdrop/paint/opacity",
        "Dashboard/Overview/SheetPanel/paint/opacity",
        "Dashboard/Overview/SheetPanel/transform/scale",
        "Dashboard/Overview/SheetPanel/transform/translate/y",
      ]),
    );
    expect(declarations.some(({ destination }) => destination.toLowerCase().includes("blur"))).toBe(
      false,
    );
  }, 30_000);

  it("represents every dismissal source explicitly", async () => {
    for (const source of ["button", "backdrop", "escape"] as const) {
      const instance = createDashboard();
      instance.api.openSheet();
      instance.api.closeSheet({ source });
      expect(instance.api.sheet).toEqual({
        status: "closed",
        view: "summary",
        via: { kind: "dismiss", source },
      });
      await instance.dispose();
    }
  });

  it("preserves direct drag samples and release context atomically", async () => {
    const instance = createDashboard();
    instance.api.openSheet();
    instance.api.beginSheetDrag();
    instance.api.updateSheetDrag({ offset: 80, velocity: 420 });
    expect(instance.api.sheet).toEqual({
      status: "open",
      view: "summary",
      interaction: { kind: "dragging", offset: 80, velocity: 420 },
    });

    instance.api.releaseSheet({ offset: 80, velocity: 420 });
    expect(instance.api.sheet).toEqual({
      status: "open",
      view: "summary",
      interaction: { kind: "released", offset: 80, velocity: 420 },
    });

    instance.api.beginSheetDrag();
    instance.api.updateSheetDrag({ offset: 180, velocity: 900 });
    instance.api.releaseSheet({ offset: 180, velocity: 900 });
    expect(instance.api.sheet).toEqual({
      status: "closed",
      view: "summary",
      via: { kind: "drag", offset: 180, velocity: 900 },
    });
    await instance.dispose();
  });

  it("ignores impossible gesture updates outside an open drag", async () => {
    const instance = createDashboard();
    const initial = instance.api.sheet;
    instance.api.updateSheetDrag({ offset: 200, velocity: 2_000 });
    instance.api.releaseSheet({ offset: 200, velocity: 2_000 });
    expect(instance.api.sheet).toEqual(initial);

    instance.api.openSheet();
    const idle = instance.api.sheet;
    instance.api.releaseSheet({ offset: 200, velocity: 2_000 });
    expect(instance.api.sheet).toEqual(idle);
    instance.api.cancelSheetDrag();
    expect(instance.api.sheet).toEqual({
      status: "open",
      view: "summary",
      interaction: { kind: "idle" },
    });
    await instance.dispose();
  });

  it("keeps repeated open and close commands idempotent", async () => {
    const instance = createDashboard();
    instance.api.closeSheet({ source: "button" });
    expect(instance.api.sheet).toEqual({
      status: "closed",
      view: "summary",
      via: { kind: "initial" },
    });

    instance.api.openSheet();
    instance.api.beginSheetDrag();
    instance.api.updateSheetDrag({ offset: 40, velocity: 200 });
    const dragging = instance.api.sheet;
    instance.api.openSheet();
    expect(instance.api.sheet).toEqual(dragging);

    instance.api.closeSheet({ source: "escape" });
    const closed = instance.api.sheet;
    instance.api.closeSheet({ source: "backdrop" });
    expect(instance.api.sheet).toEqual(closed);
    await instance.dispose();
  });

  it("preserves the SheetState invariant for arbitrary action traces", async () => {
    const command = fc.oneof(
      fc.constant({ kind: "open" } as const),
      fc
        .constantFrom("button", "backdrop", "escape")
        .map((source) => ({ kind: "close", source }) as const),
      fc.constant({ kind: "begin" } as const),
      fc
        .record({
          offset: fc.double({ min: -2_000, max: 2_000, noNaN: true }),
          velocity: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
        })
        .map((sample) => ({ kind: "update", ...sample }) as const),
      fc
        .record({
          offset: fc.double({ min: -2_000, max: 2_000, noNaN: true }),
          velocity: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
        })
        .map((sample) => ({ kind: "release", ...sample }) as const),
      fc.constant({ kind: "cancel" } as const),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(command, { maxLength: 100 }), async (commands) => {
        const instance = createDashboard();
        for (const next of commands) {
          switch (next.kind) {
            case "open":
              instance.api.openSheet();
              break;
            case "close":
              instance.api.closeSheet({ source: next.source });
              break;
            case "begin":
              instance.api.beginSheetDrag();
              break;
            case "update":
              instance.api.updateSheetDrag(next);
              break;
            case "release":
              instance.api.releaseSheet(next);
              break;
            case "cancel":
              instance.api.cancelSheetDrag();
              break;
          }
          expectValidSheet(instance.api.sheet);
        }
        await instance.dispose();
      }),
      { numRuns: 200 },
    );
  });
});

function expectValidSheet(sheet: SheetState): void {
  expect(["summary", "detail"]).toContain(sheet.view);
  if (sheet.status === "open") {
    if (sheet.interaction.kind === "idle") return;
    expect(Number.isFinite(sheet.interaction.offset)).toBe(true);
    expect(Number.isFinite(sheet.interaction.velocity)).toBe(true);
    return;
  }
  if (sheet.via.kind !== "drag") return;
  expect(Number.isFinite(sheet.via.offset)).toBe(true);
  expect(Number.isFinite(sheet.via.velocity)).toBe(true);
}

function createDashboard() {
  const instance = createUIContributionInstance(dashboard.programs.browser as never);
  return {
    api: instance.api as unknown as DashboardAPI,
    dispose: () => instance.dispose(),
  };
}

function observation(name: string, blockSize: number) {
  const box = { inlineStart: 0, blockStart: 0, inlineSize: 420, blockSize };
  return {
    name,
    box,
    scroll: { inlineOffset: 0, blockOffset: 0 },
    visibility: { intersecting: true, ratio: 1 },
    layout: {
      current: box,
      destination: box,
      velocity: { inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 },
      progress: 1,
      kind: "idle",
      settled: true,
    },
    presence: { value: 1, velocity: 0, settled: true, direction: "idle" },
  } as const;
}
