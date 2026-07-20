import type { Animation, Event } from "../../../../core/presentation";

const millisecondsPerSecond = 1_000;
const maximumSpringDuration = 60;
const springRestObservation = 0.1;

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
  const initial =
    options.initial === undefined ? undefined : springFinite(options.initial, "initial");
  const restDistance = springPositive(options.restDistance ?? 0.001, "restDistance");
  const restSpeed = springPositive(options.restSpeed ?? 0.001, "restSpeed");

  if ("duration" in options && options.duration !== undefined) {
    const duration = springPositive(options.duration, "duration") / millisecondsPerSecond;
    const bounce = springFinite(options.bounce ?? 0, "bounce");
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
    mass: springPositive(options.mass ?? 1, "mass"),
    stiffness: springPositive(options.stiffness ?? 170, "stiffness"),
    damping: springPositive(options.damping ?? 26, "damping"),
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
  const from = springFinite(input.from, "from");
  const to = springFinite(input.to, "to");
  const initialVelocity = springFinite(input.velocity ?? 0, "velocity");
  const mass = springPositive(input.spring.mass, "mass");
  const stiffness = springPositive(input.spring.stiffness, "stiffness");
  const damping = springPositive(input.spring.damping, "damping");
  springPositive(input.spring.restDistance, "restDistance");
  springPositive(input.spring.restSpeed, "restSpeed");
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
  const solve = springSolver(displacement, initialVelocity, naturalFrequency, dampingRatio);
  const duration = springSettlingDuration(
    solve,
    input.spring.restDistance * scale,
    input.spring.restSpeed * scale,
  );

  return Object.freeze({
    duration: duration * millisecondsPerSecond,
    at(time) {
      const milliseconds = springFinite(time, "time");
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
  const maximumError = springPositive(tolerance, "tolerance");
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

export type WebDecayOptions = Readonly<{
  initial?: number;
  timeConstant?: number;
  restSpeed?: number;
  min?: number;
  max?: number;
}>;

/** Immutable inertial decay parameters. */
export type WebDecay = Animation<number, number, number> &
  Readonly<{
    kind: "decay";
    timeConstant: number;
    restSpeed: number;
    min?: number;
    max?: number;
    initial?: number;
  }>;

export type WebTweenOptions = Readonly<{
  initial?: number;
  duration: number;
  easing?: "linear" | readonly [x1: number, y1: number, x2: number, y2: number];
  iterations?: number | "infinite";
  direction?: "normal" | "alternate";
}>;

/** Immutable finite or repeating curve parameters. */
export type WebTween = Animation<number, number, number> &
  Readonly<{
    kind: "tween";
    duration: number;
    easing: "linear" | readonly [x1: number, y1: number, x2: number, y2: number];
    iterations: number | "infinite";
    direction: "normal" | "alternate";
    initial?: number;
  }>;

export type WebTrackPoint = Readonly<{
  time: number;
  value: number;
  velocity: number;
}>;

export type WebTrackOptions = Readonly<{
  initial?: number;
  samples: readonly Readonly<{ time: number; value: number; velocity?: number }>[];
  interpolation?: "cubic" | "step";
  iterations?: number | "infinite";
  direction?: "normal" | "alternate";
}>;

/** Immutable normalized samples for arbitrary deterministic scalar trajectories. */
export type WebTrack = Animation<number, number, number> &
  Readonly<{
    kind: "track";
    duration: number;
    samples: readonly WebTrackPoint[];
    interpolation: "cubic" | "step";
    iterations: number | "infinite";
    direction: "normal" | "alternate";
    initial?: number;
  }>;

/** Direct manipulation: the output follows the source with supplied velocity. */
export type WebFollow = Animation<number, number, number> &
  Readonly<{
    kind: "follow";
    velocity: number;
    relative: boolean;
  }>;

export type WebPulseOptions<Payload> = Readonly<{
  amplitude: number | ((payload: Payload) => number);
  spring: WebSpring;
  overlap?: "accumulate" | "restart" | "ignore";
}>;

/** Converts every ordered Event occurrence into one scalar impulse. */
export type WebPulse<Payload> = Animation<Event<Payload>, number, number> &
  Readonly<{
    kind: "pulse";
    amplitude: number | ((payload: Payload) => number);
    spring: WebSpring;
    overlap: "accumulate" | "restart" | "ignore";
  }>;

export type WebDynamics = WebSpring | WebDecay | WebTween | WebTrack;
export type WebScalarAnimation = WebDynamics | WebFollow;

export type WebTrajectory = Readonly<{
  duration: number;
  at(time: number): Readonly<{ value: number; velocity: number }>;
}>;

/** Creates deterministic inertial decay parameters without runtime resources. */
export function decay(options: WebDecayOptions = {}): WebDecay {
  const initial =
    options.initial === undefined ? undefined : finite(options.initial, "decay initial");
  const min = options.min === undefined ? undefined : finite(options.min, "decay min");
  const max = options.max === undefined ? undefined : finite(options.max, "decay max");
  if (min !== undefined && max !== undefined && min > max) {
    throw new RangeError("Web decay min cannot be greater than max.");
  }
  return Object.freeze({
    kind: "decay",
    timeConstant: positive(options.timeConstant ?? 325, "decay timeConstant"),
    restSpeed: positive(options.restSpeed ?? 5, "decay restSpeed"),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(initial === undefined ? {} : { initial }),
  }) as WebDecay;
}

/** Creates deterministic duration-based dynamics without runtime resources. */
export function tween(options: WebTweenOptions): WebTween {
  const initial =
    options.initial === undefined ? undefined : finite(options.initial, "tween initial");
  const easing = options.easing ?? "linear";
  if (easing !== "linear") {
    if (easing.length !== 4 || easing.some((value) => !Number.isFinite(value))) {
      throw new TypeError("A web tween cubic Bezier must contain four finite numbers.");
    }
    if (easing[0] < 0 || easing[0] > 1 || easing[2] < 0 || easing[2] > 1) {
      throw new RangeError("A web tween cubic Bezier x coordinates must be between 0 and 1.");
    }
  }
  const iterations = options.iterations ?? 1;
  if (iterations !== "infinite" && (!Number.isInteger(iterations) || iterations <= 0)) {
    throw new TypeError("Web tween iterations must be a positive integer or infinite.");
  }
  if (options.direction !== undefined && !["normal", "alternate"].includes(options.direction)) {
    throw new TypeError("Web tween direction must be normal or alternate.");
  }
  return Object.freeze({
    kind: "tween",
    duration: positive(options.duration, "tween duration"),
    easing:
      easing === "linear" ? easing : Object.freeze([...easing] as [number, number, number, number]),
    iterations,
    direction: options.direction ?? "normal",
    ...(initial === undefined ? {} : { initial }),
  }) as WebTween;
}

/** Validates and freezes a sampled normalized trajectory. */
export function track(options: WebTrackOptions): WebTrack {
  const initial =
    options.initial === undefined ? undefined : finite(options.initial, "track initial");
  if (options.samples.length < 2) {
    throw new TypeError("A web track requires at least two samples.");
  }
  const raw = options.samples.map((point, index) => ({
    time: finite(point.time, `track sample ${index} time`),
    value: finite(point.value, `track sample ${index} value`),
    velocity:
      point.velocity === undefined
        ? undefined
        : finite(point.velocity, `track sample ${index} velocity`),
  }));
  if (raw[0]!.time !== 0 || raw[0]!.value !== 0) {
    throw new TypeError("A web track must start at time 0 and normalized value 0.");
  }
  if (raw.at(-1)!.value !== 1) {
    throw new TypeError("A web track must end at normalized value 1.");
  }
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index]!.time <= raw[index - 1]!.time) {
      throw new TypeError("Web track sample times must be strictly increasing.");
    }
  }
  const interpolation = options.interpolation ?? "cubic";
  if (interpolation !== "cubic" && interpolation !== "step") {
    throw new TypeError("Web track interpolation must be cubic or step.");
  }
  const iterations = options.iterations ?? 1;
  if (iterations !== "infinite" && (!Number.isInteger(iterations) || iterations <= 0)) {
    throw new TypeError("Web track iterations must be a positive integer or infinite.");
  }
  const direction = options.direction ?? "normal";
  if (direction !== "normal" && direction !== "alternate") {
    throw new TypeError("Web track direction must be normal or alternate.");
  }
  const samples = raw.map((point, index) =>
    Object.freeze({
      time: point.time,
      value: point.value,
      velocity: point.velocity ?? estimateTrackVelocity(raw, index),
    }),
  );
  return Object.freeze({
    kind: "track",
    duration: raw.at(-1)!.time,
    samples: Object.freeze(samples),
    interpolation,
    iterations,
    direction,
    ...(initial === undefined ? {} : { initial }),
  }) as WebTrack;
}

/** Creates an immutable direct-follow relation for gesture-controlled values. */
export function follow(velocity = 0, options: Readonly<{ relative?: boolean }> = {}): WebFollow {
  if (!Number.isFinite(velocity)) throw new TypeError("Web follow velocity must be finite.");
  return Object.freeze({
    kind: "follow",
    velocity,
    relative: options.relative ?? false,
  }) as WebFollow;
}

/** Creates an immutable ordered-Event impulse description. */
export function pulse<Payload>(options: WebPulseOptions<Payload>): WebPulse<Payload> {
  const amplitude =
    typeof options.amplitude === "number"
      ? finite(options.amplitude, "pulse amplitude")
      : options.amplitude;
  if (typeof amplitude !== "number" && typeof amplitude !== "function") {
    throw new TypeError("A web pulse amplitude must be a finite number or a function.");
  }
  const overlap = options.overlap ?? "accumulate";
  if (!["accumulate", "restart", "ignore"].includes(overlap)) {
    throw new TypeError("Web pulse overlap must be accumulate, restart, or ignore.");
  }
  return Object.freeze({
    kind: "pulse",
    amplitude,
    spring: options.spring,
    overlap,
  }) as WebPulse<Payload>;
}

/** Bakes a deterministic normalized function into an immutable sampled track. */
export function sampleTrack(
  options: Readonly<{
    duration: number;
    count: number;
    sample(progress: number): number;
    iterations?: number | "infinite";
    direction?: "normal" | "alternate";
  }>,
): WebTrack {
  const duration = positive(options.duration, "track duration");
  if (!Number.isInteger(options.count) || options.count < 2) {
    throw new TypeError("A sampled web track count must be an integer of at least two.");
  }
  const samples = Array.from({ length: options.count }, (_, index) => {
    const progress = index / (options.count - 1);
    return { time: progress * duration, value: finite(options.sample(progress), "track sample") };
  });
  return track({
    samples,
    ...(options.iterations === undefined ? {} : { iterations: options.iterations }),
    ...(options.direction === undefined ? {} : { direction: options.direction }),
  });
}

export function createDynamicsTrajectory(
  input: Readonly<{
    from: number;
    target?: number;
    velocity: number;
    dynamics: WebDynamics;
  }>,
): WebTrajectory {
  const from = finite(input.from, "trajectory from");
  const velocity = finite(input.velocity, "trajectory velocity");
  switch (input.dynamics.kind) {
    case "spring":
      return createSpringTrajectory({
        from,
        to: requiredTarget(input.target, "spring"),
        velocity,
        spring: input.dynamics,
      });
    case "decay":
      return createDecayTrajectory(from, velocity, input.dynamics);
    case "tween":
      return createTweenTrajectory(from, requiredTarget(input.target, "tween"), input.dynamics);
    case "track":
      return createTrackTrajectory(
        from,
        requiredTarget(input.target, "track"),
        velocity,
        input.dynamics,
      );
  }
}

function createTrackTrajectory(
  from: number,
  target: number,
  incomingVelocity: number,
  track: WebTrack,
): WebTrajectory {
  const iterations = track.iterations === "infinite" ? Number.POSITIVE_INFINITY : track.iterations;
  const duration = iterations * track.duration;
  const distance = target - from;
  const physical = track.samples.map((sample, index) => ({
    time: sample.time,
    value: from + distance * sample.value,
    velocity: index === 0 ? incomingVelocity : distance * sample.velocity,
  }));

  return Object.freeze({
    duration,
    at(time) {
      const elapsed = finite(time, "track time");
      if (elapsed <= 0) return Object.freeze({ value: from, velocity: incomingVelocity });
      if (Number.isFinite(duration) && elapsed >= duration) {
        const reversed = track.direction === "alternate" && iterations % 2 === 0;
        return Object.freeze({ value: reversed ? from : target, velocity: 0 });
      }
      const iteration = Math.floor(elapsed / track.duration);
      const local = elapsed % track.duration;
      const reversed = track.direction === "alternate" && iteration % 2 === 1;
      const trackTime = reversed ? track.duration - local : local;
      const sampled = samplePhysicalTrack(physical, trackTime, track.interpolation);
      return Object.freeze({
        value: sampled.value,
        velocity: sampled.velocity * (reversed ? -1 : 1),
      });
    },
  });
}

function samplePhysicalTrack(
  samples: readonly Readonly<{ time: number; value: number; velocity: number }>[],
  time: number,
  interpolation: WebTrack["interpolation"],
): Readonly<{ value: number; velocity: number }> {
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle]!.time <= time) low = middle;
    else high = middle;
  }
  const left = samples[low]!;
  const right = samples[high]!;
  if (time <= left.time) return { value: left.value, velocity: left.velocity };
  if (interpolation === "step") return { value: left.value, velocity: 0 };
  const milliseconds = right.time - left.time;
  const progress = (time - left.time) / milliseconds;
  const p2 = progress * progress;
  const p3 = p2 * progress;
  const leftTangent = (left.velocity * milliseconds) / 1_000;
  const rightTangent = (right.velocity * milliseconds) / 1_000;
  const value =
    (2 * p3 - 3 * p2 + 1) * left.value +
    (p3 - 2 * p2 + progress) * leftTangent +
    (-2 * p3 + 3 * p2) * right.value +
    (p3 - p2) * rightTangent;
  const derivative =
    (6 * p2 - 6 * progress) * left.value +
    (3 * p2 - 4 * progress + 1) * leftTangent +
    (-6 * p2 + 6 * progress) * right.value +
    (3 * p2 - 2 * progress) * rightTangent;
  return { value, velocity: (derivative * 1_000) / milliseconds };
}

function estimateTrackVelocity(
  samples: readonly Readonly<{ time: number; value: number }>[],
  index: number,
): number {
  const before = samples[Math.max(0, index - 1)]!;
  const after = samples[Math.min(samples.length - 1, index + 1)]!;
  if (before === after) return 0;
  return ((after.value - before.value) * 1_000) / (after.time - before.time);
}

function createDecayTrajectory(from: number, velocity: number, decay: WebDecay): WebTrajectory {
  const tau = positive(decay.timeConstant, "decay timeConstant");
  positive(decay.restSpeed, "decay restSpeed");
  if (decay.min !== undefined && from < finite(decay.min, "decay min")) {
    throw new RangeError("Web decay cannot start below its minimum bound; use a spring.");
  }
  if (decay.max !== undefined && from > finite(decay.max, "decay max")) {
    throw new RangeError("Web decay cannot start above its maximum bound; use a spring.");
  }
  const projected = from + (velocity * tau) / 1_000;
  const bound =
    velocity > 0 && decay.max !== undefined && projected > decay.max
      ? decay.max
      : velocity < 0 && decay.min !== undefined && projected < decay.min
        ? decay.min
        : undefined;
  const restDuration =
    Math.abs(velocity) <= decay.restSpeed
      ? 0
      : tau * Math.log(Math.abs(velocity) / decay.restSpeed);
  const boundDuration =
    bound === undefined || velocity === 0
      ? Number.POSITIVE_INFINITY
      : -tau * Math.log(1 - ((bound - from) * 1_000) / (velocity * tau));
  const duration = Math.max(0, Math.min(restDuration, boundDuration));
  const raw = (time: number) => {
    const decayFactor = Math.exp(-Math.max(0, time) / tau);
    return {
      value: from + (velocity * tau * (1 - decayFactor)) / 1_000,
      velocity: velocity * decayFactor,
    };
  };
  const final =
    bound !== undefined && boundDuration <= restDuration
      ? { value: bound, velocity: 0 }
      : { value: raw(duration).value, velocity: 0 };

  return Object.freeze({
    duration,
    at(time) {
      const elapsed = finite(time, "decay time");
      if (elapsed <= 0) return Object.freeze({ value: from, velocity });
      if (elapsed >= duration) return Object.freeze(final);
      return Object.freeze(raw(elapsed));
    },
  });
}

function createTweenTrajectory(from: number, target: number, tween: WebTween): WebTrajectory {
  const iterations = tween.iterations === "infinite" ? Number.POSITIVE_INFINITY : tween.iterations;
  const duration = iterations * tween.duration;
  const curve = createCurve(tween.easing);

  return Object.freeze({
    duration,
    at(time) {
      const elapsed = finite(time, "tween time");
      if (elapsed <= 0) return Object.freeze({ value: from, velocity: 0 });
      if (Number.isFinite(duration) && elapsed >= duration) {
        const reversed = tween.direction === "alternate" && iterations % 2 === 0;
        return Object.freeze({ value: reversed ? from : target, velocity: 0 });
      }
      const iteration = Math.floor(elapsed / tween.duration);
      const local = (elapsed % tween.duration) / tween.duration;
      const reversed = tween.direction === "alternate" && iteration % 2 === 1;
      const progress = reversed ? 1 - local : local;
      const sample = curve(progress);
      const distance = target - from;
      return Object.freeze({
        value: from + distance * sample.value,
        velocity: (distance * sample.slope * (reversed ? -1 : 1) * 1_000) / tween.duration,
      });
    },
  });
}

function createCurve(
  easing: WebTween["easing"],
): (progress: number) => Readonly<{ value: number; slope: number }> {
  if (easing === "linear") return (progress) => ({ value: progress, slope: 1 });
  const [x1, y1, x2, y2] = easing;
  return (progress) => {
    if (progress <= 0) return { value: 0, slope: x1 === 0 ? 0 : y1 / x1 };
    if (progress >= 1) return { value: 1, slope: x2 === 1 ? 0 : (1 - y2) / (1 - x2) };
    let low = 0;
    let high = 1;
    let parameter = progress;
    for (let index = 0; index < 20; index += 1) {
      const x = bezier(parameter, x1, x2);
      if (Math.abs(x - progress) < 1e-8) break;
      if (x < progress) low = parameter;
      else high = parameter;
      parameter = (low + high) / 2;
    }
    const dx = bezierDerivative(parameter, x1, x2);
    const dy = bezierDerivative(parameter, y1, y2);
    return { value: bezier(parameter, y1, y2), slope: dx === 0 ? 0 : dy / dx };
  };
}

function bezier(time: number, first: number, second: number): number {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time ** 3;
}

function bezierDerivative(time: number, first: number, second: number): number {
  const inverse = 1 - time;
  return (
    3 * inverse * inverse * first +
    6 * inverse * time * (second - first) +
    3 * time * time * (1 - second)
  );
}

type SpringScalarSample = Readonly<{ value: number; velocity: number }>;

function springSolver(
  displacement: number,
  velocity: number,
  naturalFrequency: number,
  dampingRatio: number,
): (time: number) => SpringScalarSample {
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

function springSettlingDuration(
  solve: (time: number) => SpringScalarSample,
  restDistance: number,
  restSpeed: number,
): number {
  const step = 1 / 240;
  let restStarted: number | undefined;
  for (let time = 0; time <= maximumSpringDuration; time += step) {
    const sample = solve(time);
    const resting =
      Math.abs(sample.value) <= restDistance && Math.abs(sample.velocity) <= restSpeed;
    if (!resting) {
      restStarted = undefined;
      continue;
    }
    restStarted ??= time;
    if (time - restStarted >= springRestObservation) return time;
  }
  return maximumSpringDuration;
}

function springPositive(value: number, name: string): number {
  const result = springFinite(value, name);
  if (result <= 0) throw new TypeError(`A web spring ${name} must be positive.`);
  return result;
}

function springFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`A web spring ${name} must be finite.`);
  return value;
}

function requiredTarget(target: number | undefined, kind: string): number {
  if (target === undefined) throw new TypeError(`Web ${kind} dynamics require a target.`);
  return finite(target, `${kind} target`);
}

function positive(value: number, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new TypeError(`Web ${label} must be positive.`);
  return result;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Web ${label} must be finite.`);
  return value;
}
