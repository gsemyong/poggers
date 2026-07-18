import { describe, expect, test } from "vitest";

import {
  createHotManifest,
  HotUpdateCoordinator,
  isHotManifestCompatible,
  type HotCandidate,
  type HotManifest,
} from "./hot";
import { POGGERS_IR_VERSION, type ComponentIR, type ProductIR, type TypeIR } from "./ir";

describe("semantic hot updates", () => {
  test("accepts additive and removed state fields but rejects changed fields", () => {
    const before = manifest(record({ count: numberType(), label: stringType() }));
    const added = manifest(
      record({ count: numberType(), label: stringType(), enabled: booleanType() }),
    );
    const removed = manifest(record({ count: numberType() }));
    const changed = manifest(record({ count: stringType(), label: stringType() }));

    expect(isHotManifestCompatible(before, added)).toBe(true);
    expect(isHotManifestCompatible(before, removed)).toBe(true);
    expect(isHotManifestCompatible(before, changed)).toBe(false);
  });

  test("keeps the live revision when prepare or activation fails", async () => {
    const events: string[] = [];
    const coordinator = new HotUpdateCoordinator<string, number>();
    await coordinator.replace(candidate("first", 1, events));
    expect(coordinator.value).toBe("first");

    const prepareFailed: HotCandidate<string, number> = {
      manifest: manifest(record({ count: numberType() })),
      async prepare() {
        throw new Error("invalid source");
      },
    };
    expect(await coordinator.replace(prepareFailed)).toEqual({
      status: "rejected",
      reason: "prepare-failed",
    });
    expect(coordinator.value).toBe("first");

    const activationFailed: HotCandidate<string, number> = {
      manifest: manifest(record({ count: numberType() })),
      async prepare() {
        return {
          async activate() {
            throw new Error("mount failed");
          },
          rollback() {
            events.push("rollback");
          },
        };
      },
    };
    expect(await coordinator.replace(activationFailed)).toEqual({
      status: "rejected",
      reason: "activation-failed",
    });
    expect(coordinator.value).toBe("first");
    expect(events).toEqual(["activate:first:0", "rollback"]);
    await coordinator.dispose();
  });

  test("serializes 100 revisions with one live scope and exact reverse replacement", async () => {
    const events: string[] = [];
    const coordinator = new HotUpdateCoordinator<string, number>();
    for (let revision = 0; revision < 100; revision++) {
      const result = await coordinator.replace(candidate(String(revision), revision, events));
      expect(result.status).toBe("activated");
      expect(coordinator.value).toBe(String(revision));
    }
    await coordinator.dispose();

    expect(events.filter((event) => event.startsWith("activate:"))).toHaveLength(100);
    expect(events.filter((event) => event.startsWith("dispose:"))).toHaveLength(100);
    expect(events.at(-1)).toBe("dispose:99");
  });

  test("derives a stable manifest from semantic IR rather than source spans", () => {
    const first = createHotManifest(product("one.ts"));
    const second = createHotManifest(product("moved.ts"));
    expect(second).toEqual(first);
  });

  test("rejects incompatible Component state, visual units, parameters, and Parts", () => {
    const before = manifest(record({}), [component()]);

    expect(
      isHotManifestCompatible(
        before,
        manifest(record({}), [component({ state: record({ offset: stringType() }) })]),
      ),
    ).toBe(false);
    expect(
      isHotManifestCompatible(
        before,
        manifest(record({}), [component({ visualValues: [{ name: "offset", kind: "size" }] })]),
      ),
    ).toBe(false);
    expect(
      isHotManifestCompatible(
        before,
        manifest(record({}), [component({ parameters: record({ distance: stringType() }) })]),
      ),
    ).toBe(false);
    expect(
      isHotManifestCompatible(
        before,
        manifest(record({}), [component({ parts: [{ name: "Root", element: "main" }] })]),
      ),
    ).toBe(false);
  });

  test("accepts compatible Component state and implementation-only action changes", () => {
    const before = manifest(record({}), [component()]);
    const next = component({
      state: record({ offset: numberType(), dragging: booleanType() }),
      actions: ["drag", "release"],
      implementation: { state: true, actions: true, start: true, view: true },
    });

    expect(isHotManifestCompatible(before, manifest(record({}), [next]))).toBe(true);
  });
});

function candidate(
  value: string,
  snapshot: number,
  events: string[],
): HotCandidate<string, number> {
  return {
    manifest: manifest(record({ count: numberType() })),
    async prepare(previous) {
      return {
        async activate() {
          events.push(`activate:${value}:${previous ?? 0}`);
          return {
            value,
            snapshot,
            dispose() {
              events.push(`dispose:${value}`);
            },
          };
        },
      };
    },
  };
}

function manifest(state: TypeIR, components: readonly ComponentIR[] = []): HotManifest {
  return {
    revision: "test",
    programs: [{ id: "feature/app/program/browser", runtime: "web-main", state, components }],
  };
}

function component(overrides: Partial<ComponentIR> = {}): ComponentIR {
  return {
    name: "Drawer",
    state: record({ offset: numberType() }),
    actions: ["drag"],
    parameters: record({ distance: numberType() }),
    visualValues: [{ name: "offset", kind: "length" }],
    parts: [{ name: "Root", element: "section" }],
    implementation: { state: true, actions: true, start: false, view: true },
    ...overrides,
  };
}

function product(file: string): ProductIR {
  return {
    version: POGGERS_IR_VERSION,
    application: { id: "application/test", name: "test", presentations: [] },
    features: [{ id: "feature/app", path: "app", children: [], programs: [] }],
    programs: [
      {
        id: "feature/app/program/browser",
        feature: "app",
        name: "browser",
        runtime: { name: "web-main", platform: "web" },
        requires: [],
        provides: [],
        ui: { state: record({ count: numberType() }), actions: [], components: [] },
        span: { file, line: 1, column: 1 },
      },
    ],
  };
}

function record(fields: Readonly<Record<string, TypeIR>>): TypeIR {
  return {
    kind: "record",
    fields: Object.entries(fields).map(([name, type]) => ({ name, type, optional: false })),
  };
}

function numberType(): TypeIR {
  return { kind: "primitive", name: "number" };
}

function stringType(): TypeIR {
  return { kind: "primitive", name: "string" };
}

function booleanType(): TypeIR {
  return { kind: "primitive", name: "boolean" };
}
