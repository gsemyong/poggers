import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { spring, createSpringTrajectory, sampleSpringTrajectory } from "./spring";

describe("web spring", () => {
  it("normalizes physical and perceived parameters as immutable data", () => {
    const physical = spring({ mass: 2, stiffness: 320, damping: 30 });
    expect(physical).toEqual({
      kind: "spring",
      mass: 2,
      stiffness: 320,
      damping: 30,
      restDistance: 0.001,
      restSpeed: 0.001,
    });
    expect(Object.isFrozen(physical)).toBe(true);

    const perceived = spring({ duration: 500, bounce: 0 });
    expect(perceived.mass).toBe(1);
    expect(perceived.stiffness).toBeCloseTo((2 * Math.PI * 2) ** 2);
    expect(perceived.damping).toBeCloseTo(8 * Math.PI);
  });

  it.each([
    ["under", spring({ stiffness: 100, damping: 10 })],
    ["critical", spring({ stiffness: 100, damping: 20 })],
    ["over", spring({ stiffness: 100, damping: 30 })],
  ])("converges for %s-damped springs", (_name, spring) => {
    const trajectory = createSpringTrajectory({ from: -120, to: 40, velocity: 380, spring });
    expect(trajectory.at(0)).toEqual({ value: -120, velocity: 380 });
    expect(trajectory.duration).toBeGreaterThan(0);
    expect(trajectory.duration).toBeLessThan(60_000);
    expect(trajectory.at(trajectory.duration)).toEqual({ value: 40, velocity: 0 });
  });

  it("preserves position and velocity exactly when retargeted", () => {
    const forward = createSpringTrajectory({
      from: 0,
      to: 300,
      spring: spring({ duration: 420, bounce: 0.18 }),
    });
    const boundary = forward.at(forward.duration * 0.37);
    const reverse = createSpringTrajectory({
      from: boundary.value,
      to: 0,
      velocity: boundary.velocity,
      spring: spring({ stiffness: 650, damping: 46 }),
    });
    expect(reverse.at(0)).toEqual(boundary);
  });

  it("adaptively samples the analytical curve within tolerance", () => {
    const trajectory = createSpringTrajectory({
      from: 0,
      to: 1,
      velocity: 2,
      spring: spring({ duration: 520, bounce: 0.35 }),
    });
    const tolerance = 0.0005;
    const samples = sampleSpringTrajectory(trajectory, tolerance);
    expect(samples[0]?.offset).toBe(0);
    expect(samples.at(-1)?.offset).toBe(1);

    for (let index = 1; index < samples.length; index += 1) {
      const left = samples[index - 1]!;
      const right = samples[index]!;
      const expected = trajectory.at((left.time + right.time) / 2).value;
      const actual = (left.value + right.value) / 2;
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance + 1e-12);
    }
  });

  it.each([
    spring({ stiffness: 100, damping: 10 }),
    spring({ stiffness: 100, damping: 20 }),
    spring({ stiffness: 100, damping: 30 }),
  ])(
    "bounds candidate native keyframe position error against the canonical curve",
    (parameters) => {
      const trajectory = createSpringTrajectory({
        from: -240,
        to: 80,
        velocity: 1_200,
        spring: parameters,
      });
      const tolerance = 0.02;
      const samples = sampleSpringTrajectory(trajectory, tolerance);

      for (let step = 0; step <= 1_000; step += 1) {
        const time = (trajectory.duration * step) / 1_000;
        const expected = trajectory.at(time).value;
        const rightIndex = samples.findIndex((sample) => sample.time >= time);
        const right = samples[Math.max(0, rightIndex)]!;
        const left = samples[Math.max(0, rightIndex - 1)] ?? right;
        const span = right.time - left.time;
        const progress = span === 0 ? 0 : (time - left.time) / span;
        const approximated = left.value + (right.value - left.value) * progress;
        expect(Math.abs(approximated - expected)).toBeLessThanOrEqual(tolerance * 4);
      }
    },
  );

  it("remains finite and continuous for random valid trajectories", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -20_000, max: 20_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 2_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (from, to, velocity, mass, stiffness, damping, progress) => {
          const parameters = spring({ mass, stiffness, damping });
          const trajectory = createSpringTrajectory({ from, to, velocity, spring: parameters });
          const sample = trajectory.at(trajectory.duration * progress);
          expect(Number.isFinite(trajectory.duration)).toBe(true);
          expect(Number.isFinite(sample.value)).toBe(true);
          expect(Number.isFinite(sample.velocity)).toBe(true);

          const retargeted = createSpringTrajectory({
            from: sample.value,
            to: from,
            velocity: sample.velocity,
            spring: parameters,
          });
          expect(retargeted.at(0).value).toBeCloseTo(sample.value, 15);
          expect(retargeted.at(0).velocity).toBeCloseTo(sample.velocity, 15);
          expect(retargeted.at(retargeted.duration)).toEqual({ value: from, velocity: 0 });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("rejects ambiguous or invalid parameters", () => {
    expect(() => spring({ duration: 0 })).toThrow("duration must be positive");
    expect(() => spring({ duration: 300, bounce: 2 })).toThrow("between -1 and 1");
    expect(() => spring({ stiffness: Number.NaN })).toThrow("stiffness must be finite");
  });
});
