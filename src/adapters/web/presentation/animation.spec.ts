import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createActionEventLedger, type Animation, type Event } from "../../../core/presentation";
import { createWebAnimationHost } from "./animation";
import { decay, follow, pulse, track } from "./dynamics";
import { spring } from "./spring";

const sheetSpring = spring({ initial: 0, stiffness: 520, damping: 42 });

describe("web canonical Animation host", () => {
  it("synchronizes a geometry-driven destination without creating a trajectory", () => {
    let time = 0;
    const host = createWebAnimationHost({ now: () => time, reducedMotion: () => false });
    const motion = spring({ initial: 0, stiffness: 500, damping: 40 });

    host.begin();
    host.sample("Panel::position", 100, motion);
    expect(host.end()).toBe(true);

    time = 32;
    host.begin(time, "synchronize");
    expect(host.sample("Panel::position", 720, motion)).toEqual({
      value: 720,
      velocity: 0,
      settled: true,
    });
    expect(host.end()).toBe(false);

    host.begin(time);
    expect(host.sample("Panel::position", 0, motion)).toEqual({
      value: 720,
      velocity: 0,
      settled: false,
    });
    expect(host.end()).toBe(true);
    host.dispose();
  });

  it("preserves value and velocity through arbitrary retargets", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            elapsed: fc.integer({ min: 0, max: 500 }),
            target: fc.double({ min: -2, max: 2, noNaN: true }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (updates) => {
          const harness = createHarness();
          let time = 0;
          harness.render(time, () => harness.host.sample("Sheet::progress", 1, sheetSpring));

          for (const update of updates) {
            time += update.elapsed;
            const before = harness.host.inspectFrame(time).animations["Sheet::progress"]!;
            const after = harness.render(time, () =>
              harness.host.sample("Sheet::progress", update.target, sheetSpring),
            );
            expect(after.value).toBeCloseTo(before.value as number, 10);
            expect(after.velocity).toBeCloseTo(before.velocity as number, 10);
          }
          harness.host.dispose();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("hands direct manipulation into a spring without a frame jump", () => {
    const harness = createHarness();
    expect(
      harness.render(0, () => harness.host.sample("Sheet::position", 40, follow(1_000))),
    ).toEqual({ value: 40, velocity: 1_000, settled: true });

    const release = harness.render(0, () =>
      harness.host.sample("Sheet::position", 0, spring({ stiffness: 520, damping: 42 })),
    );
    expect(release).toEqual({ value: 40, velocity: 1_000, settled: false });
    expect(harness.host.inspectFrame(16).animations["Sheet::position"]).toMatchObject({
      settled: false,
    });
    expect(harness.host.inspectFrame(100_000).animations["Sheet::position"]).toMatchObject({
      value: 0,
      velocity: 0,
      settled: true,
    });
    harness.host.dispose();
  });

  it("supports re-grab and reverse while preserving the displayed sample", () => {
    const harness = createHarness();
    harness.render(0, () => harness.host.sample("Sheet::position", 0, spring({ initial: 120 })));
    const displayed = harness.host.inspectFrame(80).animations["Sheet::position"]!;
    const grabbed = harness.render(80, () =>
      harness.host.sample("Sheet::position", displayed.value as number, follow(-240)),
    );
    expect(grabbed.value).toBeCloseTo(displayed.value as number, 10);

    const reversed = harness.render(96, () =>
      harness.host.sample("Sheet::position", 120, spring({ stiffness: 520, damping: 42 })),
    );
    expect(reversed.value).toBeCloseTo(displayed.value as number, 10);
    expect(reversed.velocity).toBe(-240);
    harness.host.dispose();
  });

  it("hands a direct gesture sample into bounded inertial decay", () => {
    const harness = createHarness();
    harness.render(0, () => harness.host.sample("Carousel::position", 40, follow(1_000)));
    const released = harness.render(0, () =>
      harness.host.sample(
        "Carousel::position",
        1_000,
        decay({ timeConstant: 300, restSpeed: 1, max: 100 }),
      ),
    );
    expect(released).toEqual({ value: 40, velocity: 1_000, settled: false });
    expect(harness.host.inspectFrame(100_000).animations["Carousel::position"]).toMatchObject({
      value: 100,
      velocity: 0,
      settled: true,
    });
    harness.host.dispose();
  });

  it("samples every channel at one logical time", () => {
    const harness = createHarness();
    const frame = harness.render(64, () => ({
      x: harness.host.sample("Card::x", 100, spring({ initial: 0 })),
      y: harness.host.sample("Card::y", 50, spring({ initial: 0 })),
    }));
    expect(frame.x.value).toBe(0);
    expect(frame.y.value).toBe(0);
    expect(harness.host.inspectFrame(64).time).toBe(64);
    harness.host.dispose();
  });

  it("coordinates dependent stages from physical settlement without a timer", () => {
    const harness = createHarness();
    const render = (time: number, open: boolean) =>
      harness.render(time, () => {
        const panel = harness.host.sample("Sequence::panel", open ? 1 : 0, sheetSpring);
        const content = harness.host.sample(
          "Sequence::content",
          open && panel.settled ? 1 : 0,
          spring({ initial: 0, stiffness: 420, damping: 38 }),
        );
        return { panel, content };
      });

    expect(render(0, true).content.value).toBe(0);
    expect(render(80, true).content.value).toBe(0);
    const settledPanel = render(10_000, true);
    expect(settledPanel.panel.settled).toBe(true);
    expect(settledPanel.content.value).toBe(0);
    expect(render(10_080, true).content.value).toBeGreaterThan(0);
    harness.host.dispose();
  });

  it("retains 10,000 keyed identities without positional coupling", () => {
    const harness = createHarness();
    const identities = Array.from({ length: 10_000 }, (_, index) => `Row:${index}::position`);
    harness.render(0, () => {
      for (const [index, identity] of identities.entries()) {
        harness.host.sample(identity, index, follow());
      }
    });
    const frame = harness.host.inspectFrame(0).animations;
    for (const [index, identity] of [...identities].reverse().entries()) {
      expect(frame[identity]?.value).toBe(identities.length - index - 1);
    }
    harness.host.dispose();
  });

  it("resolves reduced motion at the semantic destination", () => {
    const harness = createHarness(true);
    expect(harness.render(0, () => harness.host.sample("Sheet::open", 1, sheetSpring))).toEqual({
      value: 1,
      velocity: 0,
      settled: true,
    });
    expect(harness.active).toBe(false);
    harness.host.dispose();
  });

  it("rejects an Animation domain the web adapter does not declare", () => {
    const harness = createHarness();
    const vector = Object.freeze({ kind: "vector" }) as unknown as Animation<
      readonly [number, number],
      readonly [number, number],
      readonly [number, number]
    >;
    expect(() =>
      harness.render(0, () => harness.host.sample("Scene::position", [1, 2] as const, vector)),
    ).toThrow('The web DOM adapter cannot sample Animation "Scene::position" in this domain.');
    harness.host.dispose();
  });

  it("preserves samples when switching to and from an arbitrary track", () => {
    const harness = createHarness();
    harness.render(0, () => harness.host.sample("Card::position", 100, sheetSpring));
    const before = harness.host.inspectFrame(64).animations["Card::position"]!;
    const sampledTrack = track({
      samples: [
        { time: 0, value: 0 },
        { time: 80, value: 1.15 },
        { time: 180, value: 1 },
      ],
    });
    const switched = harness.render(64, () =>
      harness.host.sample("Card::position", 180, sampledTrack),
    );
    expect(switched.value).toBeCloseTo(before.value as number, 10);
    expect(switched.velocity).toBeCloseTo(before.velocity as number, 10);
    harness.host.dispose();
  });

  it("disposes removed identities only at an explicit HMR boundary", () => {
    const harness = createHarness();
    harness.render(0, () => harness.host.sample("Sheet::open", 1, sheetSpring));
    const before = harness.host.inspectFrame(80).animations["Sheet::open"]!;

    harness.host.reconfigure();
    const after = harness.render(80, () => harness.host.sample("Sheet::open", 1, sheetSpring));
    expect(after.value).toBeCloseTo(before.value as number, 10);

    harness.host.reconfigure();
    harness.render(100, () => undefined);
    expect(harness.host.inspectFrame(100).animations).toEqual({});
    harness.host.dispose();
  });

  it("restores value and velocity into a new adapter host", () => {
    const first = createHarness();
    first.render(0, () => first.host.sample("Hot::progress", 1, sheetSpring));
    const before = first.host.inspectFrame(70).animations["Hot::progress"]!;
    const snapshot = first.host.snapshot(70);
    first.host.dispose();

    let now = 70;
    const restored = createWebAnimationHost({
      now: () => now,
      reducedMotion: () => false,
      restore: snapshot,
    });
    restored.begin(70);
    const after = restored.sample("Hot::progress", 1, sheetSpring);
    restored.end();
    expect(after.value).toBeCloseTo(before.value as number, 10);
    expect(after.velocity).toBeCloseTo(before.velocity as number, 10);
    now = 140;
    expect(restored.inspectFrame().animations["Hot::progress"]?.value).toBeGreaterThan(after.value);
    restored.dispose();
  });

  it("forks exact live trajectories without coupling planner mutations", () => {
    const harness = createHarness();
    harness.render(0, () => harness.host.sample("Plan::progress", 1, sheetSpring));
    let time = 80;
    const fork = harness.host.fork({ now: () => time, reducedMotion: () => false });

    fork.begin();
    const planned = fork.inspect<number, number>("Plan::progress");
    fork.end();
    const canonical = harness.host.inspectFrame(time).animations["Plan::progress"]!;
    expect(planned.value).toBeCloseTo(canonical.value as number, 10);
    expect(planned.velocity).toBeCloseTo(canonical.velocity as number, 10);

    fork.begin();
    fork.sample("Plan::progress", 0, sheetSpring);
    fork.end();
    time = 120;
    expect(harness.host.inspectFrame(time).animations["Plan::progress"]?.source).toBe(1);
    fork.dispose();
    harness.host.dispose();
  });

  it("consumes every repeated Event occurrence exactly once", () => {
    const ledger = createActionEventLedger(["save"]);
    const completed = ledger.events.save!.completed as Event<Readonly<{ output: number }>>;
    const confirmation = pulse<Readonly<{ output: number }>>({
      amplitude: ({ output }) => output,
      spring: sheetSpring,
    });
    const harness = createHarness();

    expect(
      harness.render(0, () =>
        harness.host.sample("Toolbar::confirmation", completed, confirmation),
      ),
    ).toEqual({ value: 0, velocity: 0, settled: true });

    ledger.invoke("save", [], () => 1);
    ledger.invoke("save", [], () => 2);
    ledger.invoke("save", [], () => 3);
    const first = harness.render(16, () =>
      harness.host.sample("Toolbar::confirmation", completed, confirmation),
    );
    expect(first).toEqual({ value: 6, velocity: 0, settled: false });
    expect(harness.host.inspectFrame(16).animations["Toolbar::confirmation"]).toMatchObject({
      consumed: { after: 0, through: 3, count: 3 },
      value: 6,
    });

    const repeated = harness.render(16, () =>
      harness.host.sample("Toolbar::confirmation", completed, confirmation),
    );
    expect(repeated).toEqual(first);
    expect(
      harness.host.inspectFrame(16).animations["Toolbar::confirmation"]?.consumed,
    ).toBeUndefined();
    harness.host.dispose();
  });

  it("starts a late-mounted Event Animation at the current cursor", () => {
    const ledger = createActionEventLedger(["save"]);
    const completed = ledger.events.save!.completed as Event<unknown>;
    ledger.invoke("save", [], () => undefined);
    ledger.invoke("save", [], () => undefined);
    const harness = createHarness();
    const confirmation = pulse({ amplitude: 1, spring: sheetSpring });

    expect(
      harness.render(20, () => harness.host.sample("Late::confirmation", completed, confirmation)),
    ).toEqual({ value: 0, velocity: 0, settled: true });

    ledger.invoke("save", [], () => undefined);
    expect(
      harness.render(30, () => harness.host.sample("Late::confirmation", completed, confirmation))
        .value,
    ).toBe(1);
    harness.host.dispose();
  });

  it("preserves Event cursors and displayed continuity across HMR tuning", () => {
    const ledger = createActionEventLedger(["save"]);
    const completed = ledger.events.save!.completed as Event<unknown>;
    const harness = createHarness();
    const beforeTuning = pulse({ amplitude: 1, spring: sheetSpring });
    harness.render(0, () => harness.host.sample("HMR::confirmation", completed, beforeTuning));
    ledger.invoke("save", [], () => undefined);
    harness.render(10, () => harness.host.sample("HMR::confirmation", completed, beforeTuning));
    const before = harness.host.inspectFrame(70).animations["HMR::confirmation"]!;

    harness.host.reconfigure();
    const after = harness.render(70, () =>
      harness.host.sample(
        "HMR::confirmation",
        completed,
        pulse({ amplitude: 1, spring: spring({ stiffness: 260, damping: 30 }) }),
      ),
    );
    expect(after.value).toBeCloseTo(before.value as number, 10);
    expect(after.velocity).toBeCloseTo(before.velocity as number, 10);
    expect(harness.host.inspectFrame(70).animations["HMR::confirmation"]?.consumed).toBeUndefined();
    harness.host.dispose();
  });

  it("restores an Event Animation against a fresh ledger without replay or loss", () => {
    const firstLedger = createActionEventLedger(["save"]);
    const firstEvent = firstLedger.events.save!.completed as Event<unknown>;
    const confirmation = pulse({ amplitude: 1, spring: sheetSpring });
    const first = createHarness();
    first.render(0, () => first.host.sample("Hot::event", firstEvent, confirmation));
    firstLedger.invoke("save", [], () => undefined);
    first.render(10, () => first.host.sample("Hot::event", firstEvent, confirmation));
    const before = first.host.inspectFrame(50).animations["Hot::event"]!;
    const snapshot = first.host.snapshot(50);
    first.host.dispose();

    const nextLedger = createActionEventLedger(["save"]);
    const nextEvent = nextLedger.events.save!.completed as Event<unknown>;
    let now = 50;
    const restored = createWebAnimationHost({
      now: () => now,
      reducedMotion: () => false,
      restore: snapshot,
    });
    restored.begin(50);
    const after = restored.sample("Hot::event", nextEvent, confirmation);
    restored.end();
    expect(after.value).toBeCloseTo(before.value as number, 10);
    expect(after.velocity).toBeCloseTo(before.velocity as number, 10);
    expect(restored.inspectFrame(50).animations["Hot::event"]?.consumed).toBeUndefined();

    nextLedger.invoke("save", [], () => undefined);
    now = 60;
    restored.begin(60);
    restored.sample("Hot::event", nextEvent, confirmation);
    restored.end();
    expect(restored.inspectFrame(60).animations["Hot::event"]).toMatchObject({
      consumed: { after: 0, through: 1, count: 1 },
    });
    restored.dispose();
  });

  it("makes overlap behavior explicit in the Event Animation", () => {
    const ledger = createActionEventLedger(["save"]);
    const completed = ledger.events.save!.completed as Event<unknown>;
    const accumulate = createHarness();
    const restart = createHarness();
    const ignored = createHarness();
    const definitions = {
      accumulate: pulse({ amplitude: 1, spring: sheetSpring, overlap: "accumulate" }),
      restart: pulse({ amplitude: 1, spring: sheetSpring, overlap: "restart" }),
      ignore: pulse({ amplitude: 1, spring: sheetSpring, overlap: "ignore" }),
    } as const;
    for (const [name, harness] of Object.entries({ accumulate, restart, ignored })) {
      const key = name === "ignored" ? "ignore" : name;
      harness.render(0, () =>
        harness.host.sample(
          "Feedback::pulse",
          completed,
          definitions[key as keyof typeof definitions],
        ),
      );
    }

    ledger.invoke("save", [], () => undefined);
    for (const [name, harness] of Object.entries({ accumulate, restart, ignored })) {
      const key = name === "ignored" ? "ignore" : name;
      harness.render(10, () =>
        harness.host.sample(
          "Feedback::pulse",
          completed,
          definitions[key as keyof typeof definitions],
        ),
      );
    }
    ledger.invoke("save", [], () => undefined);
    const accumulated = accumulate.render(30, () =>
      accumulate.host.sample("Feedback::pulse", completed, definitions.accumulate),
    );
    const restarted = restart.render(30, () =>
      restart.host.sample("Feedback::pulse", completed, definitions.restart),
    );
    const unchanged = ignored.render(30, () =>
      ignored.host.sample("Feedback::pulse", completed, definitions.ignore),
    );
    expect(accumulated.value).toBeGreaterThan(restarted.value);
    expect(restarted.value).toBe(1);
    expect(unchanged.value).toBeLessThan(1);
    accumulate.host.dispose();
    restart.host.dispose();
    ignored.host.dispose();
  });

  it("is independent of how repeated Event occurrences are batched into frames", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 80 }),
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 30 }),
        (outputs, batchSizes) => {
          const run = (batches: readonly number[]) => {
            const ledger = createActionEventLedger(["save"]);
            const completed = ledger.events.save!.completed as Event<Readonly<{ output: number }>>;
            const harness = createHarness();
            const confirmation = pulse<Readonly<{ output: number }>>({
              amplitude: ({ output }) => output,
              spring: sheetSpring,
            });
            harness.render(0, () =>
              harness.host.sample("Property::pulse", completed, confirmation),
            );
            let emitted = 0;
            for (const batchSize of batches) {
              const through = Math.min(outputs.length, emitted + batchSize);
              while (emitted < through) {
                const output = outputs[emitted++]!;
                ledger.invoke("save", [], () => output);
              }
              harness.render(1, () =>
                harness.host.sample("Property::pulse", completed, confirmation),
              );
            }
            while (emitted < outputs.length) {
              const output = outputs[emitted++]!;
              ledger.invoke("save", [], () => output);
            }
            const sample = harness.render(1, () =>
              harness.host.sample("Property::pulse", completed, confirmation),
            );
            harness.host.dispose();
            return sample;
          };

          const oneFrame = run([outputs.length]);
          const arbitraryFrames = run(batchSizes);
          expect(arbitraryFrames.value).toBeCloseTo(oneFrame.value, 8);
          expect(arbitraryFrames.velocity).toBeCloseTo(oneFrame.velocity, 8);
        },
      ),
      { numRuns: 200 },
    );
  });
});

function createHarness(initialReducedMotion = false) {
  let time = 0;
  let reducedMotion = initialReducedMotion;
  let active = false;
  const host = createWebAnimationHost({ now: () => time, reducedMotion: () => reducedMotion });
  return {
    host,
    get active() {
      return active;
    },
    set reducedMotion(value: boolean) {
      reducedMotion = value;
    },
    render<Value>(at: number, evaluate: () => Value): Value {
      time = at;
      host.begin(at);
      try {
        return evaluate();
      } finally {
        active = host.end();
      }
    },
  };
}
