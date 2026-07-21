import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createDynamicsTrajectory,
  createSpringTrajectory,
  sampleTrack,
  spring,
} from "@/adapters/web/ui/presentation/dynamics";
import {
  defaultWebExecutionTolerances,
  planAdaptiveWebExecution,
  planWebExecution,
  startWebNativeExecution,
  type WebNativeExecutionPlan,
} from "@/adapters/web/ui/presentation/runtime/execution";

const target = {} as Element;
const elements = { Panel: () => [target] };

describe("web Presentation execution planner", () => {
  it("adaptively proves a spring trace without fixed-frequency Presentation replay", () => {
    const trajectory = createSpringTrajectory({
      from: 0,
      to: 240,
      velocity: 720,
      spring: spring({ stiffness: 520, damping: 34 }),
    });
    let evaluations = 0;
    const plan = planAdaptiveWebExecution({
      started: 0,
      finished: trajectory.duration,
      sample(time) {
        evaluations += 1;
        return {
          time,
          declarations: {
            Panel: {
              paint: { opacity: Math.max(0, Math.min(1, trajectory.at(time).value / 240)) },
              transform: { translate: { y: trajectory.at(time).value } },
            },
          },
        };
      },
      elements,
    });

    expect(plan.kind).toBe("native");
    if (plan.kind !== "native") return;
    expect(evaluations).toBeLessThan(1_024);
    expect(plan.samples).toBeLessThan(evaluations);
    for (let time = 0; time <= trajectory.duration; time += 1_000 / 240) {
      const expected = trajectory.at(time).value;
      const effect = plan.effects[0]!;
      expect(
        Math.abs(interpolate(effect.keyframes, time / trajectory.duration, "translate") - expected),
      ).toBeLessThanOrEqual(0.126);
      expect(
        Math.abs(
          interpolate(effect.keyframes, time / trajectory.duration, "opacity") -
            Math.max(0, Math.min(1, expected / 240)),
        ),
      ).toBeLessThanOrEqual(0.0011);
    }
  });

  it("rejects a changing residual declaration without exhausting the sample budget", () => {
    let evaluations = 0;
    const plan = planAdaptiveWebExecution({
      started: 0,
      finished: 300,
      sample(time) {
        evaluations += 1;
        return {
          time,
          declarations: {
            Panel: {
              paint: { opacity: time / 300, radius: 8 + time / 30 },
            },
          },
        };
      },
      elements,
    });

    expect(plan).toEqual({ kind: "canonical", reason: "non-compositor-output" });
    expect(evaluations).toBeLessThanOrEqual(5);
  });

  it("falls back deterministically when bounded proof cannot resolve a trajectory", () => {
    const plan = planAdaptiveWebExecution({
      started: 0,
      finished: 1_000,
      maximumSamples: 9,
      sample(time) {
        return {
          time,
          declarations: {
            Panel: { transform: { translate: { y: Math.sin(time) * 100 } } },
          },
        };
      },
      elements,
    });

    expect(plan).toEqual({ kind: "canonical", reason: "planning-limit" });
  });

  it("abandons native planning when its synchronous work exceeds the interaction budget", () => {
    let clock = 0;
    const plan = planAdaptiveWebExecution({
      started: 0,
      finished: 300,
      planning: { budget: 4, now: () => clock },
      sample(time) {
        clock += 5;
        return {
          time,
          declarations: { Panel: { paint: { opacity: time / 300 } } },
        };
      },
      elements,
    });

    expect(plan).toEqual({ kind: "canonical", reason: "planning-budget" });
  });

  it("does not disguise authored evaluation failures as optimizer ineligibility", () => {
    expect(() =>
      planAdaptiveWebExecution({
        started: 0,
        finished: 300,
        sample(time) {
          if (time > 0) throw new Error("authored failure");
          return { time, declarations: { Panel: { paint: { opacity: 0 } } } };
        },
        elements,
      }),
    ).toThrow("authored failure");
  });

  it("proves generated spring families against an independent dense oracle trace", () => {
    fc.assert(
      fc.property(
        fc.record({
          from: fc.integer({ min: -300, max: 300 }),
          distance: fc.integer({ min: 20, max: 300 }),
          direction: fc.constantFrom(-1, 1),
          velocity: fc.integer({ min: -1_500, max: 1_500 }),
          stiffness: fc.integer({ min: 200, max: 900 }),
          damping: fc.integer({ min: 20, max: 100 }),
        }),
        ({ from, distance, direction, velocity, stiffness, damping }) => {
          const trajectory = createSpringTrajectory({
            from,
            to: from + distance * direction,
            velocity,
            spring: spring({ stiffness, damping }),
          });
          const plan = planAdaptiveWebExecution({
            started: 0,
            finished: trajectory.duration,
            sample(time) {
              return {
                time,
                declarations: {
                  Panel: { transform: { translate: { y: trajectory.at(time).value } } },
                },
              };
            },
            elements,
          });

          if (plan.kind !== "native") {
            expect(plan).toEqual({ kind: "canonical", reason: "planning-limit" });
            return;
          }
          for (let time = 0; time <= trajectory.duration; time += 1_000 / 240) {
            expect(
              Math.abs(
                interpolate(plan.effects[0]!.keyframes, time / trajectory.duration, "translate") -
                  trajectory.at(time).value,
              ),
            ).toBeLessThanOrEqual(0.126);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("matches canonical frames across forward, reversal, and retarget histories", () => {
    const forward = createSpringTrajectory({
      from: 620,
      to: 0,
      velocity: -480,
      spring: spring({ stiffness: 520, damping: 42 }),
    });
    const turningPoint = forward.at(92);
    const reversal = createSpringTrajectory({
      from: turningPoint.value,
      to: 620,
      velocity: turningPoint.velocity,
      spring: spring({ stiffness: 760, damping: 48 }),
    });
    const retargetPoint = reversal.at(74);
    const retarget = createSpringTrajectory({
      from: retargetPoint.value,
      to: 180,
      velocity: retargetPoint.velocity,
      spring: spring({ stiffness: 420, damping: 36 }),
    });

    for (const scenario of [
      { name: "forward", trajectory: forward },
      { name: "reversal", trajectory: reversal },
      { name: "retarget", trajectory: retarget },
    ]) {
      const declaration = (time: number) => {
        const value = scenario.trajectory.at(time).value;
        const progress = Math.max(0, Math.min(1, 1 - value / 620));
        return {
          Panel: {
            paint: { opacity: progress },
            transform: {
              translate: { y: value },
              scale: 0.94 + progress * 0.06,
              rotate: -8 + progress * 8,
            },
          },
        } as const;
      };
      const plan = planAdaptiveWebExecution({
        started: 0,
        finished: scenario.trajectory.duration,
        sample: (time) => ({ time, declarations: declaration(time) }),
        elements,
      });
      if (plan.kind !== "native") {
        throw new Error(`${scenario.name}: expected native trace, received ${plan.reason}.`);
      }
      assertEquivalentTrace(scenario.name, plan, scenario.trajectory.duration, declaration);
    }

    expect(reversal.at(0).value).toBeCloseTo(turningPoint.value, 10);
    expect(reversal.at(0).velocity).toBeCloseTo(turningPoint.velocity, 10);
    expect(retarget.at(0).value).toBeCloseTo(retargetPoint.value, 10);
    expect(retarget.at(0).velocity).toBeCloseTo(retargetPoint.velocity, 10);
  });

  it("lowers changing transform and opacity declarations to native keyframes", () => {
    const plan = planWebExecution(
      [
        {
          time: 100,
          declarations: {
            Panel: {
              layout: { inlineSize: 200 },
              paint: { opacity: 0, fill: "transparent" },
              transform: { translate: { y: 80 }, scale: 0.96 },
              presence: { value: 0, velocity: 0, settled: false },
            },
          },
        },
        {
          time: 200,
          declarations: {
            Panel: {
              layout: { inlineSize: 200 },
              paint: { opacity: 0.5, fill: "transparent" },
              transform: { translate: { y: 30 }, scale: 0.99 },
              presence: { value: 0.5, velocity: 4, settled: false },
            },
          },
        },
        {
          time: 300,
          declarations: {
            Panel: {
              layout: { inlineSize: 200 },
              paint: { opacity: 1, fill: "transparent" },
              transform: { translate: { y: 0 }, scale: 1 },
              presence: { value: 1, velocity: 0, settled: true },
            },
          },
        },
      ],
      elements,
    );

    expect(plan).toMatchObject({ kind: "native", started: 100, duration: 200, samples: 3 });
    if (plan.kind !== "native") return;
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({
      target,
      properties: ["opacity", "scale", "translate"],
      keyframes: [
        { offset: 0, opacity: "0", scale: "0.96", translate: "0 80px" },
        { offset: 0.5, opacity: "0.5", scale: "0.99", translate: "0 30px" },
        { offset: 1, opacity: "1", scale: "1", translate: "0 0" },
      ],
    });
  });

  it("rejects paint or layout changes instead of silently moving them off-thread", () => {
    const paint = planWebExecution(
      [
        { time: 0, declarations: { Panel: { paint: { opacity: 0, radius: 8 } } } },
        { time: 100, declarations: { Panel: { paint: { opacity: 1, radius: 16 } } } },
      ],
      elements,
    );
    const layout = planWebExecution(
      [
        { time: 0, declarations: { Panel: { layout: { blockSize: 80 } } } },
        { time: 100, declarations: { Panel: { layout: { blockSize: 120 } } } },
      ],
      elements,
    );

    expect(paint).toEqual({ kind: "canonical", reason: "non-compositor-output" });
    expect(layout).toEqual({ kind: "canonical", reason: "non-compositor-output" });
  });

  it("rejects native property appearance and target replacement", () => {
    expect(
      planWebExecution(
        [
          { time: 0, declarations: { Panel: { paint: { opacity: 0 } } } },
          { time: 100, declarations: { Panel: { transform: { scale: 1 } } } },
        ],
        elements,
      ),
    ).toEqual({ kind: "canonical", reason: "native-property-shape-changed" });

    const replacement = {} as Element;
    let calls = 0;
    const changingElements = { Panel: () => [calls++ === 0 ? target : replacement] };
    const samples = [
      { time: 0, declarations: { Panel: { paint: { opacity: 0 } } } },
      { time: 100, declarations: { Panel: { paint: { opacity: 1 } } } },
    ] as const;
    expect(planWebExecution(samples, changingElements)).toEqual({
      kind: "canonical",
      reason: "target-set-changed",
    });
  });

  it.each([
    ["under-damped", 14],
    ["critical", 40],
    ["over-damped", 72],
  ])("keeps native interpolation within tolerance for %s springs", (_name, damping) => {
    const trajectory = createSpringTrajectory({
      from: 0,
      to: 120,
      velocity: 480,
      spring: spring({ stiffness: 400, damping }),
    });
    const step = 1_000 / 480;
    const times = Array.from(
      { length: Math.floor(trajectory.duration / step) + 1 },
      (_, index) => index * step,
    );
    if (times.at(-1) !== trajectory.duration) times.push(trajectory.duration);
    const plan = planWebExecution(
      times.map((time) => ({
        time,
        declarations: {
          Panel: { transform: { translate: { y: trajectory.at(time).value } } },
        },
      })),
      elements,
    );

    expect(plan.kind).toBe("native");
    if (plan.kind !== "native") return;
    const keyframes = plan.effects[0]!.keyframes;
    let maximumError = 0;
    for (let index = 1; index < keyframes.length; index += 1) {
      const left = keyframes[index - 1]!;
      const right = keyframes[index]!;
      const time = ((left.offset + right.offset) / 2) * trajectory.duration;
      const interpolated = (translate(left.translate!) + translate(right.translate!)) / 2;
      maximumError = Math.max(maximumError, Math.abs(interpolated - trajectory.at(time).value));
    }
    expect(maximumError).toBeLessThan(0.25);
  });

  it("starts every native effect atomically or cancels the partial set", () => {
    const second = {} as Element;
    const plan = planWebExecution(
      [
        {
          time: 0,
          declarations: {
            First: { paint: { opacity: 0 } },
            Second: { transform: { translate: { y: 40 } } },
          },
        },
        {
          time: 100,
          declarations: {
            First: { paint: { opacity: 1 } },
            Second: { transform: { translate: { y: 0 } } },
          },
        },
      ],
      { First: () => [target], Second: () => [second] },
    );
    expect(plan.kind).toBe("native");
    if (plan.kind !== "native") return;

    let calls = 0;
    let cancelled = false;
    const execution = startWebNativeExecution(plan, () => {
      calls += 1;
      if (calls === 2) return;
      return {
        finished: new Promise(() => undefined),
        currentTime: null,
        cancel() {
          cancelled = true;
        },
      };
    });

    expect(execution).toBeUndefined();
    expect(calls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("keeps native interpolation within tolerance for an arbitrary sampled track", () => {
    const dynamics = sampleTrack({
      duration: 480,
      count: 97,
      sample: (progress) => progress + Math.sin(progress * Math.PI * 4) * (1 - progress) * 0.12,
    });
    const trajectory = createDynamicsTrajectory({
      from: 0,
      target: 120,
      velocity: 0,
      dynamics,
    });
    const step = 1_000 / 480;
    const times = Array.from(
      { length: Math.floor(trajectory.duration / step) + 1 },
      (_, index) => index * step,
    );
    if (times.at(-1) !== trajectory.duration) times.push(trajectory.duration);
    const plan = planWebExecution(
      times.map((time) => ({
        time,
        declarations: {
          Panel: { transform: { translate: { y: trajectory.at(time).value } } },
        },
      })),
      elements,
    );

    expect(plan.kind).toBe("native");
    if (plan.kind !== "native") return;
    const keyframes = plan.effects[0]!.keyframes;
    let maximumError = 0;
    for (let index = 1; index < keyframes.length; index += 1) {
      const left = keyframes[index - 1]!;
      const right = keyframes[index]!;
      const time = ((left.offset + right.offset) / 2) * trajectory.duration;
      const interpolated = (translate(left.translate!) + translate(right.translate!)) / 2;
      maximumError = Math.max(maximumError, Math.abs(interpolated - trajectory.at(time).value));
    }
    expect(maximumError).toBeLessThan(0.25);
  });
});

function translate(value: string | number): number {
  const match = String(value).match(/ (-?[\d.]+)(?:px)?$/);
  if (!match) throw new Error(`Unexpected translate keyframe ${String(value)}.`);
  return Number(match[1]);
}

function interpolate(
  keyframes: readonly Readonly<Record<string, string | number>>[],
  progress: number,
  property: "opacity" | "translate",
): number {
  const rightIndex = Math.max(
    1,
    keyframes.findIndex((keyframe) => Number(keyframe.offset) >= progress),
  );
  const left = keyframes[rightIndex - 1]!;
  const right = keyframes[Math.min(rightIndex, keyframes.length - 1)]!;
  const span = Number(right.offset) - Number(left.offset);
  const local = span === 0 ? 1 : (progress - Number(left.offset)) / span;
  const from = property === "translate" ? translate(left[property]!) : Number(left[property]);
  const to = property === "translate" ? translate(right[property]!) : Number(right[property]);
  return from + (to - from) * local;
}

function assertEquivalentTrace(
  scenario: string,
  plan: WebNativeExecutionPlan,
  duration: number,
  canonical: (time: number) => Readonly<{
    Panel: Readonly<{
      paint: Readonly<{ opacity: number }>;
      transform: Readonly<{
        translate: Readonly<{ y: number }>;
        scale: number;
        rotate: number;
      }>;
    }>;
  }>,
): void {
  const effect = plan.effects[0];
  if (!effect) throw new Error(`${scenario}: native plan has no effect.`);
  const tolerances = defaultWebExecutionTolerances;
  for (let time = 0; time <= duration; time += 1_000 / 240) {
    const expected = canonical(time).Panel;
    compareTraceValue(
      scenario,
      time,
      "opacity",
      expected.paint.opacity,
      interpolateProperty(effect.keyframes, time / duration, "opacity"),
      tolerances.opacity,
    );
    compareTraceValue(
      scenario,
      time,
      "translate",
      expected.transform.translate.y,
      interpolateProperty(effect.keyframes, time / duration, "translate"),
      tolerances.translate,
    );
    compareTraceValue(
      scenario,
      time,
      "scale",
      expected.transform.scale,
      interpolateProperty(effect.keyframes, time / duration, "scale"),
      tolerances.scale,
    );
    compareTraceValue(
      scenario,
      time,
      "rotate",
      expected.transform.rotate,
      interpolateProperty(effect.keyframes, time / duration, "rotate"),
      tolerances.rotate,
    );
  }
}

function interpolateProperty(
  keyframes: readonly Readonly<Record<string, string | number>>[],
  progress: number,
  property: "opacity" | "translate" | "scale" | "rotate",
): number {
  const rightIndex = Math.max(
    1,
    keyframes.findIndex((keyframe) => Number(keyframe.offset) >= progress),
  );
  const left = keyframes[rightIndex - 1]!;
  const right = keyframes[Math.min(rightIndex, keyframes.length - 1)]!;
  const span = Number(right.offset) - Number(left.offset);
  const local = span === 0 ? 1 : (progress - Number(left.offset)) / span;
  const read = (value: string | number): number => {
    if (property === "translate") return translate(value);
    if (property === "rotate") return Number(String(value).replace(/deg$/, ""));
    return Number(value);
  };
  return read(left[property]!) + (read(right[property]!) - read(left[property]!)) * local;
}

function compareTraceValue(
  scenario: string,
  time: number,
  property: string,
  expected: number,
  actual: number,
  tolerance: number,
): void {
  const error = Math.abs(actual - expected);
  if (error <= tolerance * 1.01) return;
  throw new Error(
    `${scenario} at ${time.toFixed(3)}ms, Panel.${property}: expected ${expected}, ` +
      `received ${actual}, tolerance ${tolerance}, error ${error}.`,
  );
}
