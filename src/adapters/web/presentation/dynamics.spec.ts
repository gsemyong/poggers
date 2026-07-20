import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decay, createDynamicsTrajectory, track, tween, sampleTrack } from "./dynamics";
import { spring } from "./spring";

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
