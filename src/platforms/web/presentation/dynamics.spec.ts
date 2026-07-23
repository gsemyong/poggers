import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createDynamicsTrajectory,
  createSpringTrajectory,
  decay,
  sampleSpringTrajectory,
  sampleTrack,
  spring,
  track,
  tween,
} from "@/platforms/web/presentation/dynamics";

describe("web Presentation dynamics", () => {
  it("samples bounded inertial decay deterministically", () => {
    const dynamics = decay({ timeConstant: 300, restSpeed: 1, min: 0, max: 100 });
    const trajectory = createDynamicsTrajectory({ from: 40, velocity: 1_000, dynamics });

    expect(trajectory.at(0)).toEqual({ value: 40, velocity: 1_000 });
    expect(trajectory.at(trajectory.duration)).toEqual({ value: 100, velocity: 0 });
    expect(trajectory.at(trajectory.duration + 10_000)).toEqual({ value: 100, velocity: 0 });
  });

  it("supports finite curves and stable autoreversing repetition", () => {
    const dynamics = tween({
      duration: 100,
      easing: [0.25, 0.1, 0.25, 1],
      iterations: 4,
      direction: "alternate",
    });
    const trajectory = createDynamicsTrajectory({ from: 0, target: 1, velocity: 0, dynamics });

    expect(trajectory.at(0).value).toBe(0);
    expect(trajectory.at(100).value).toBe(1);
    expect(trajectory.at(200).value).toBe(0);
    expect(trajectory.at(300).value).toBe(1);
    expect(trajectory.at(400)).toEqual({ value: 0, velocity: 0 });
  });

  it("replays immutable multistage tracks with exact incoming position and velocity", () => {
    const dynamics = track({
      samples: [
        { time: 0, value: 0 },
        { time: 80, value: 1.2, velocity: -2 },
        { time: 180, value: 0.7 },
        { time: 260, value: 1, velocity: 0 },
      ],
    });
    const trajectory = createDynamicsTrajectory({
      from: 40,
      target: 100,
      velocity: 600,
      dynamics,
    });

    expect(trajectory.at(0)).toEqual({ value: 40, velocity: 600 });
    expect(trajectory.at(80).value).toBeCloseTo(112, 10);
    expect(trajectory.at(260)).toEqual({ value: 100, velocity: 0 });
    expect(Object.isFrozen(dynamics.samples)).toBe(true);
    expect(Object.isFrozen(dynamics.samples[1])).toBe(true);
  });

  it("bakes arbitrary deterministic curves and repeats them on one coordinate", () => {
    const dynamics = sampleTrack({
      duration: 200,
      count: 65,
      sample: (progress) => progress + Math.sin(progress * Math.PI * 4) * (1 - progress) * 0.1,
      iterations: 2,
      direction: "alternate",
    });
    const trajectory = createDynamicsTrajectory({
      from: 0,
      target: 1,
      velocity: 0,
      dynamics,
    });

    expect(trajectory.at(100).value).toBeCloseTo(0.5, 2);
    expect(trajectory.at(200).value).toBe(1);
    expect(trajectory.at(400)).toEqual({ value: 0, velocity: 0 });
  });

  it("rejects malformed dynamics and out-of-bounds inertial origins", () => {
    expect(() => decay({ min: 2, max: 1 })).toThrow("greater than max");
    expect(() => tween({ duration: 0 })).toThrow("duration");
    expect(() => track({ samples: [{ time: 0, value: 0 }] })).toThrow("two samples");
    expect(() =>
      track({
        samples: [
          { time: 0, value: 0 },
          { time: 0, value: 1 },
        ],
      }),
    ).toThrow("strictly increasing");
    expect(() =>
      track({
        samples: [
          { time: 0, value: 0 },
          { time: 100, value: 0.5 },
        ],
      }),
    ).toThrow("normalized value 1");
    expect(() => tween({ duration: 100, direction: "sideways" as "normal" })).toThrow("direction");
    expect(() =>
      createDynamicsTrajectory({
        from: 110,
        velocity: -100,
        dynamics: decay({ min: 0, max: 100 }),
      }),
    ).toThrow("use a spring");
  });

  it("keeps all supported trajectories finite for finite inputs and times", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true }),
        fc.double({ min: -10_000, max: 10_000, noNaN: true }),
        fc.double({ min: -20_000, max: 20_000, noNaN: true }),
        fc.integer({ min: 0, max: 20_000 }),
        (from, target, velocity, time) => {
          const trajectories = [
            createDynamicsTrajectory({
              from,
              target,
              velocity,
              dynamics: spring({ stiffness: 420, damping: 36 }),
            }),
            createDynamicsTrajectory({
              from,
              velocity,
              dynamics: decay({ timeConstant: 280, restSpeed: 0.5 }),
            }),
            createDynamicsTrajectory({
              from,
              target,
              velocity,
              dynamics: tween({ duration: 240, iterations: 3, direction: "alternate" }),
            }),
            createDynamicsTrajectory({
              from,
              target,
              velocity,
              dynamics: track({
                samples: [
                  { time: 0, value: 0 },
                  { time: 120, value: 1.1 },
                  { time: 240, value: 1 },
                ],
              }),
            }),
          ];
          for (const trajectory of trajectories) {
            const sample = trajectory.at(Math.min(time, trajectory.duration));
            expect(Number.isFinite(sample.value)).toBe(true);
            expect(Number.isFinite(sample.velocity)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("web spring dynamics", () => {
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
