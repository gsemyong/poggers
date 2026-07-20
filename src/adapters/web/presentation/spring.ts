import type { Animation } from "../../../core/presentation";

const millisecondsPerSecond = 1_000;
const maximumDuration = 60;
const restObservation = 0.1;

export type WebPhysicalSpring = Readonly<{
  initial?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  duration?: never;
  bounce?: never;
  restDistance?: number;
  restSpeed?: number;
}>;

export type WebPerceivedSpring = Readonly<{
  initial?: number;
  duration: number;
  bounce?: number;
  mass?: never;
  stiffness?: never;
  damping?: never;
  restDistance?: number;
  restSpeed?: number;
}>;

export type WebSpringOptions = WebPhysicalSpring | WebPerceivedSpring;

/** Immutable spring parameters. Velocity belongs to a value transition. */
export type WebSpring = Animation<number, number, number> &
  Readonly<{
    kind: "spring";
    mass: number;
    stiffness: number;
    damping: number;
    restDistance: number;
    restSpeed: number;
    initial?: number;
  }>;

export type WebSpringTrajectory = Readonly<{
  duration: number;
  at(time: number): Readonly<{ value: number; velocity: number }>;
}>;

export type WebSpringSample = Readonly<{
  offset: number;
  time: number;
  value: number;
  velocity: number;
}>;

/** Creates normalized spring parameters without allocating runtime resources. */
export function spring(options: WebSpringOptions = {}): WebSpring {
  const initial = options.initial === undefined ? undefined : finite(options.initial, "initial");
  const restDistance = positive(options.restDistance ?? 0.001, "restDistance");
  const restSpeed = positive(options.restSpeed ?? 0.001, "restSpeed");

  if ("duration" in options && options.duration !== undefined) {
    const duration = positive(options.duration, "duration") / millisecondsPerSecond;
    const bounce = finite(options.bounce ?? 0, "bounce");
    if (bounce < -1 || bounce > 1) {
      throw new TypeError("A web spring bounce must be between -1 and 1.");
    }
    const stiffness = ((2 * Math.PI) / duration) ** 2;
    const damping =
      bounce >= 0
        ? ((1 - bounce) * 4 * Math.PI) / duration
        : (4 * Math.PI) / (duration * (1 + bounce));
    return Object.freeze({
      kind: "spring",
      mass: 1,
      stiffness,
      damping,
      restDistance,
      restSpeed,
      ...(initial === undefined ? {} : { initial }),
    }) as WebSpring;
  }

  return Object.freeze({
    kind: "spring",
    mass: positive(options.mass ?? 1, "mass"),
    stiffness: positive(options.stiffness ?? 170, "stiffness"),
    damping: positive(options.damping ?? 26, "damping"),
    restDistance,
    restSpeed,
    ...(initial === undefined ? {} : { initial }),
  }) as WebSpring;
}

/** Solves one damped spring analytically in milliseconds and units per second. */
export function createSpringTrajectory(
  input: Readonly<{
    from: number;
    to: number;
    velocity?: number;
    spring: WebSpring;
  }>,
): WebSpringTrajectory {
  const from = finite(input.from, "from");
  const to = finite(input.to, "to");
  const initialVelocity = finite(input.velocity ?? 0, "velocity");
  const mass = positive(input.spring.mass, "mass");
  const stiffness = positive(input.spring.stiffness, "stiffness");
  const damping = positive(input.spring.damping, "damping");
  positive(input.spring.restDistance, "restDistance");
  positive(input.spring.restSpeed, "restSpeed");
  const naturalFrequency = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const displacement = from - to;
  if (displacement === 0 && initialVelocity === 0) {
    return Object.freeze({
      duration: 0,
      at: () => Object.freeze({ value: to, velocity: 0 }),
    });
  }
  const scale = Math.max(
    Math.abs(displacement),
    Math.abs(initialVelocity) / naturalFrequency,
    1e-9,
  );
  const solve = scalarSolver(displacement, initialVelocity, naturalFrequency, dampingRatio);
  const duration = settlingDuration(
    solve,
    input.spring.restDistance * scale,
    input.spring.restSpeed * scale,
  );

  return Object.freeze({
    duration: duration * millisecondsPerSecond,
    at(time) {
      const milliseconds = finite(time, "time");
      if (milliseconds <= 0) return Object.freeze({ value: from, velocity: initialVelocity });
      if (milliseconds >= duration * millisecondsPerSecond) {
        return Object.freeze({ value: to, velocity: 0 });
      }
      const sample = solve(milliseconds / millisecondsPerSecond);
      return Object.freeze({ value: to + sample.value, velocity: sample.velocity });
    },
  });
}

/** Adaptively samples a canonical trajectory for native renderers. */
export function sampleSpringTrajectory(
  trajectory: WebSpringTrajectory,
  tolerance = 0.001,
): readonly WebSpringSample[] {
  const maximumError = positive(tolerance, "tolerance");
  if (trajectory.duration === 0) {
    const sample = trajectory.at(0);
    return [Object.freeze({ offset: 1, time: 0, ...sample })];
  }

  const start = trajectory.at(0);
  const end = trajectory.at(trajectory.duration);
  const samples = new Map<number, Readonly<{ value: number; velocity: number }>>([
    [0, start],
    [trajectory.duration, end],
  ]);

  const visit = (
    fromTime: number,
    fromValue: number,
    toTime: number,
    toValue: number,
    depth: number,
  ): void => {
    const span = toTime - fromTime;
    const quarterTime = fromTime + span / 4;
    const middleTime = fromTime + span / 2;
    const threeQuarterTime = fromTime + (span * 3) / 4;
    const quarter = trajectory.at(quarterTime);
    const middle = trajectory.at(middleTime);
    const threeQuarter = trajectory.at(threeQuarterTime);
    const error = Math.max(
      Math.abs(quarter.value - (fromValue * 0.75 + toValue * 0.25)),
      Math.abs(middle.value - (fromValue + toValue) / 2),
      Math.abs(threeQuarter.value - (fromValue * 0.25 + toValue * 0.75)),
    );
    if (depth < 18 && span > 0.25 && error > maximumError) {
      samples.set(middleTime, middle);
      visit(fromTime, fromValue, middleTime, middle.value, depth + 1);
      visit(middleTime, middle.value, toTime, toValue, depth + 1);
    }
  };

  visit(0, start.value, trajectory.duration, end.value, 0);
  return [...samples.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, sample]) =>
      Object.freeze({ offset: time / trajectory.duration, time, ...sample }),
    );
}

type ScalarSample = Readonly<{ value: number; velocity: number }>;

function scalarSolver(
  displacement: number,
  velocity: number,
  naturalFrequency: number,
  dampingRatio: number,
): (time: number) => ScalarSample {
  if (dampingRatio < 1 - 1e-7) {
    const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2);
    const decay = dampingRatio * naturalFrequency;
    const sineCoefficient = (velocity + decay * displacement) / dampedFrequency;
    return (time) => {
      const envelope = Math.exp(-decay * time);
      const cosine = Math.cos(dampedFrequency * time);
      const sine = Math.sin(dampedFrequency * time);
      const wave = displacement * cosine + sineCoefficient * sine;
      const derivative =
        -displacement * dampedFrequency * sine + sineCoefficient * dampedFrequency * cosine;
      return { value: envelope * wave, velocity: envelope * (derivative - decay * wave) };
    };
  }

  if (dampingRatio <= 1 + 1e-7) {
    const coefficient = velocity + naturalFrequency * displacement;
    return (time) => {
      const envelope = Math.exp(-naturalFrequency * time);
      const value = (displacement + coefficient * time) * envelope;
      const nextVelocity =
        (coefficient - naturalFrequency * (displacement + coefficient * time)) * envelope;
      return { value, velocity: nextVelocity };
    };
  }

  const root = naturalFrequency * Math.sqrt(dampingRatio ** 2 - 1);
  const slow = -dampingRatio * naturalFrequency + root;
  const fast = -dampingRatio * naturalFrequency - root;
  const slowCoefficient = (velocity - fast * displacement) / (slow - fast);
  const fastCoefficient = displacement - slowCoefficient;
  return (time) => {
    const slowTerm = slowCoefficient * Math.exp(slow * time);
    const fastTerm = fastCoefficient * Math.exp(fast * time);
    return {
      value: slowTerm + fastTerm,
      velocity: slow * slowTerm + fast * fastTerm,
    };
  };
}

function settlingDuration(
  solve: (time: number) => ScalarSample,
  restDistance: number,
  restSpeed: number,
): number {
  const step = 1 / 240;
  let restStarted: number | undefined;
  for (let time = 0; time <= maximumDuration; time += step) {
    const sample = solve(time);
    const resting =
      Math.abs(sample.value) <= restDistance && Math.abs(sample.velocity) <= restSpeed;
    if (!resting) {
      restStarted = undefined;
      continue;
    }
    restStarted ??= time;
    if (time - restStarted >= restObservation) return time;
  }
  return maximumDuration;
}

function positive(value: number, name: string): number {
  const result = finite(value, name);
  if (result <= 0) throw new TypeError(`A web spring ${name} must be positive.`);
  return result;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`A web spring ${name} must be finite.`);
  return value;
}
