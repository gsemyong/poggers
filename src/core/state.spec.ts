import { effect, endBatch, signal, startBatch } from "alien-signals";
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { createReactiveState } from "@/core/state";

const createState = (initial: Readonly<Record<string, unknown>>) =>
  createReactiveState(initial, (value) => signal(value));

describe("reactive state", () => {
  test("tracks fixed root fields independently", () => {
    const state = createState({ first: 0, second: 0 });
    const reads: number[] = [];
    effect(() => {
      reads.push(state.read.first as number);
    });

    state.mutable.second = 1;
    state.mutable.first = 2;

    expect(reads).toEqual([0, 2]);
    expect(Object.keys(state.read)).toEqual(["first", "second"]);
  });

  test("tracks nested record fields independently", () => {
    const state = createState({ profile: { name: "Ada", role: "Engineer" } });
    const names: string[] = [];
    const profile = state.mutable.profile as { name: string; role: string };
    effect(() => {
      names.push((state.read.profile as typeof profile).name);
    });

    profile.role = "Architect";
    profile.name = "Grace";

    expect(names).toEqual(["Ada", "Grace"]);
  });

  test("tracks array entries and length independently", () => {
    const state = createState({ items: ["a", "b"] });
    const items = state.mutable.items as string[];
    const first: string[] = [];
    const lengths: number[] = [];
    effect(() => {
      first.push((state.read.items as string[])[0]!);
    });
    effect(() => {
      lengths.push((state.read.items as string[]).length);
    });

    items[1] = "B";
    items.push("c");
    items[0] = "A";

    expect(first).toEqual(["a", "A"]);
    expect(lengths).toEqual([2, 3]);
  });

  test("adopts immutable external snapshots into mutable reactive state", () => {
    const state = createState({ items: [] as ReadonlyArray<{ value: number }> });
    const snapshot = Object.freeze([Object.freeze({ value: 1 })]);

    state.mutable.items = snapshot;
    const items = state.mutable.items as Array<{ value: number }>;
    expect(items[0]?.value).toBe(1);
    items[0]!.value = 2;

    expect(state.snapshot()).toEqual({ items: [{ value: 2 }] });
    expect(snapshot[0]?.value).toBe(1);
  });

  test("batches nested writes and snapshots plain data", () => {
    const state = createState({ settings: { density: 1, contrast: 1 } });
    const settings = state.mutable.settings as { density: number; contrast: number };
    const values: string[] = [];
    effect(() => {
      const current = state.read.settings as typeof settings;
      values.push(`${current.density}:${current.contrast}`);
    });

    startBatch();
    settings.density = 2;
    settings.contrast = 3;
    endBatch();

    expect(values).toEqual(["1:1", "2:3"]);
    expect(state.snapshot()).toEqual({ settings: { density: 2, contrast: 3 } });
  });

  test("ignores writes after its owner becomes inactive", () => {
    let active = true;
    const state = createReactiveState(
      { count: 0, nested: { count: 0 } },
      (value) => signal(value),
      () => active,
    );
    active = false;
    state.mutable.count = 1;
    (state.mutable.nested as { count: number }).count = 1;
    expect(state.snapshot()).toEqual({ count: 0, nested: { count: 0 } });
  });

  test("rejects undeclared root fields", () => {
    const state = createState({ count: 0 });
    expect(() => {
      state.mutable.missing = true;
    }).toThrow();
  });

  test("matches a plain model for random fine-grained mutation traces", () => {
    type Operation = Readonly<{
      target: "left" | "right" | "first" | "second";
      value: number;
    }>;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            target: fc.constantFrom<Operation["target"]>("left", "right", "first", "second"),
            value: fc.integer({ min: -20, max: 20 }),
          }),
          { maxLength: 100 },
        ),
        (operations) => {
          const state = createState({ nested: { left: 0, right: 0 }, items: [0, 0] });
          const nested = state.mutable.nested as { left: number; right: number };
          const items = state.mutable.items as number[];
          const model = { nested: { left: 0, right: 0 }, items: [0, 0] };
          const runs = { left: 0, right: 0, first: 0, second: 0 };
          effect(() => {
            runs.left += observeNumber((state.read.nested as typeof nested).left);
          });
          effect(() => {
            runs.right += observeNumber((state.read.nested as typeof nested).right);
          });
          effect(() => {
            runs.first += observeNumber((state.read.items as number[])[0]);
          });
          effect(() => {
            runs.second += observeNumber((state.read.items as number[])[1]);
          });

          for (const operation of operations) {
            const before = { ...runs };
            if (operation.target === "left" || operation.target === "right") {
              const changed = model.nested[operation.target] !== operation.value;
              nested[operation.target] = operation.value;
              model.nested[operation.target] = operation.value;
              expect(runs[operation.target]).toBe(before[operation.target] + Number(changed));
            } else {
              const index = operation.target === "first" ? 0 : 1;
              const changed = model.items[index] !== operation.value;
              items[index] = operation.value;
              model.items[index] = operation.value;
              expect(runs[operation.target]).toBe(before[operation.target] + Number(changed));
            }
            for (const target of ["left", "right", "first", "second"] as const) {
              if (target !== operation.target) expect(runs[target]).toBe(before[target]);
            }
            expect(state.snapshot()).toEqual(model);
          }
        },
      ),
    );
  });
});

function observeNumber(value: unknown): 1 {
  if (typeof value !== "number") throw new TypeError("Expected a numeric reactive value.");
  return 1;
}
