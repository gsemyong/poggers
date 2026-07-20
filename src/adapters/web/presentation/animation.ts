import {
  eventCursor,
  readEventOccurrences,
  type Animation,
  type AnimationSample,
  type Event,
  type PresentationAnimationHost,
} from "../../../core/presentation";
import {
  createDynamicsTrajectory,
  type WebPulse,
  type WebScalarAnimation,
  type WebTrajectory,
} from "./dynamics";

export type WebAnimationHostOptions = Readonly<{
  now(): number;
  reducedMotion(): boolean;
  parents?: readonly WebAnimationHost[];
  restore?: WebAnimationHostSnapshot;
}>;

export type WebAnimationHostSnapshot = Readonly<{
  channels: readonly Readonly<{
    identity: string;
    kind: "scalar" | "event";
    source?: number;
    value: number;
    velocity: number;
    settled: boolean;
  }>[];
}>;

export type WebAnimationInspection = Readonly<{
  time: number;
  animations: Readonly<
    Record<
      string,
      Readonly<{
        source: unknown;
        animation: Readonly<object>;
        started: number;
        duration: number;
        endsAt: number;
        value: unknown;
        velocity: unknown;
        settled: boolean;
        consumed?: Readonly<{ after: number; through: number; count: number }>;
      }>
    >
  >;
  settled: boolean;
}>;

export type WebAnimationHost = PresentationAnimationHost &
  Readonly<{
    begin(time?: number, transition?: "animate" | "synchronize"): void;
    used(): boolean;
    end(): boolean;
    reconfigure(): void;
    inspectFrame(time?: number): WebAnimationInspection;
    snapshot(time?: number): WebAnimationHostSnapshot;
    fork(options: Omit<WebAnimationHostOptions, "restore">): WebAnimationHost;
    dispose(): void;
  }>;

type ScalarChannel = {
  kind: "scalar";
  source: number;
  animation: WebScalarAnimation;
  origin: Readonly<{ value: number; velocity: number }>;
  started: number;
  trajectory?: WebTrajectory;
  lastSample: AnimationSample<number, number>;
  touched: boolean;
  sourceOrigin?: number;
  outputOrigin?: number;
};

type EventChannel = {
  kind: "event";
  source: Event<unknown>;
  animation: WebPulse<unknown>;
  cursor: number;
  origin: Readonly<{ value: number; velocity: number }>;
  started: number;
  trajectory?: WebTrajectory;
  lastSample: AnimationSample<number, number>;
  touched: boolean;
  consumed?: Readonly<{ after: number; through: number; count: number }>;
};

type AnimationChannel = ScalarChannel | EventChannel;

/** Canonical deterministic scalar Animation graph for one mounted temporal scope. */
export function createWebAnimationHost(
  options: WebAnimationHostOptions,
  seed?: ReadonlyMap<string, AnimationChannel>,
): WebAnimationHost {
  const channels = new Map<string, AnimationChannel>(
    [...(seed ?? [])].map(([identity, channel]) => [identity, { ...channel, touched: false }]),
  );
  const restored = new Map(
    (options.restore?.channels ?? []).map((channel) => [channel.identity, channel] as const),
  );
  let frameTime: number | undefined;
  let frameTransition: "animate" | "synchronize" = "animate";
  let reconfiguring = false;
  let frameUsed = false;
  let disposed = false;

  const requireFrame = () => {
    if (disposed) throw new Error("Cannot evaluate a disposed web Animation host.");
    if (frameTime === undefined) {
      throw new Error("Web Animations can only be sampled during a Presentation frame.");
    }
    return frameTime;
  };

  const sample = <Source, Output, Velocity>(
    identity: string,
    source: Source,
    animation: Animation<Source, Output, Velocity>,
  ): AnimationSample<Output, Velocity> => {
    const time = requireFrame();
    frameUsed = true;
    if (!identity) throw new Error("A compiled Animation identity is required.");
    const scalar = typeof source === "number" && isWebScalarAnimation(animation);
    const occurrence = isWebPulse(animation) && isEvent(source);
    if (!scalar && !occurrence) {
      throw new TypeError(
        `The web DOM adapter cannot sample Animation ${JSON.stringify(identity)} in this domain.`,
      );
    }
    let previous = channels.get(identity);
    if (!previous) {
      const seed = restored.get(identity);
      restored.delete(identity);
      if (seed?.kind === "scalar" && scalar) {
        previous = restoredScalarChannel(seed, source, animation);
      } else if (seed?.kind === "event" && occurrence) {
        previous = restoredEventChannel(
          seed,
          source as Event<unknown>,
          animation as WebPulse<unknown>,
        );
      }
    }
    if (previous?.touched) {
      if (previous.source !== source || !sameValue(previous.animation, animation, new WeakMap())) {
        throw new Error(
          `Animation ${JSON.stringify(identity)} received conflicting definitions in one frame.`,
        );
      }
      return previous.lastSample as AnimationSample<Output, Velocity>;
    }

    const next = scalar
      ? updateScalarChannel(
          previous?.kind === "scalar" ? previous : undefined,
          source,
          animation,
          time,
          options.reducedMotion() || frameTransition === "synchronize",
        )
      : updateEventChannel(
          previous?.kind === "event" ? previous : undefined,
          source as Event<unknown>,
          animation as WebPulse<unknown>,
          time,
          options.reducedMotion(),
        );
    next.touched = true;
    channels.set(identity, next);
    return next.lastSample as AnimationSample<Output, Velocity>;
  };

  const inspect = <Output, Velocity>(identity: string): AnimationSample<Output, Velocity> => {
    const time = requireFrame();
    frameUsed = true;
    const local = channels.get(identity);
    if (local) {
      local.touched = true;
      local.lastSample = sampleChannel(local, time);
      return local.lastSample as AnimationSample<Output, Velocity>;
    }
    for (const parent of options.parents ?? []) {
      try {
        return parent.inspect<Output, Velocity>(identity);
      } catch (error) {
        if (!(error instanceof UnknownAnimationError)) throw error;
      }
    }
    throw new UnknownAnimationError(identity);
  };

  return {
    sample,
    inspect,
    begin(time = options.now(), transition = "animate") {
      if (disposed) throw new Error("Cannot begin a disposed web Animation host.");
      if (frameTime !== undefined) throw new Error("Web Animation frames are not reentrant.");
      frameTime = finite(time, "frame time");
      frameTransition = transition;
      frameUsed = false;
      for (const channel of channels.values()) channel.touched = false;
    },
    used() {
      return frameUsed;
    },
    end() {
      const time = requireFrame();
      if (reconfiguring) {
        for (const [identity, channel] of channels) {
          if (!channel.touched) channels.delete(identity);
        }
        reconfiguring = false;
      }
      let active = false;
      for (const channel of channels.values()) {
        if (channel.touched && channel.trajectory && !sampleChannel(channel, time).settled) {
          active = true;
          break;
        }
      }
      frameTime = undefined;
      frameTransition = "animate";
      return active;
    },
    reconfigure() {
      if (disposed) throw new Error("Cannot reconfigure a disposed web Animation host.");
      reconfiguring = true;
    },
    inspectFrame(time = options.now()) {
      const at = finite(time, "inspection time");
      const animations: Record<string, WebAnimationInspection["animations"][string]> = {};
      let allSettled = true;
      for (const [identity, channel] of channels) {
        const sampled = sampleChannel(channel, at);
        animations[identity] = Object.freeze({
          source:
            channel.kind === "event"
              ? Object.freeze({ kind: "event", cursor: channel.cursor })
              : channel.source,
          animation: snapshotAnimation(channel.animation),
          started: channel.started,
          duration: channel.trajectory?.duration ?? 0,
          endsAt: channel.started + (channel.trajectory?.duration ?? 0),
          ...sampled,
          ...(channel.kind === "event" && channel.consumed ? { consumed: channel.consumed } : {}),
        });
        if (!sampled.settled) allSettled = false;
      }
      return Object.freeze({
        time: at,
        animations: Object.freeze(animations),
        settled: allSettled,
      });
    },
    snapshot(time = options.now()) {
      const at = finite(time, "snapshot time");
      return Object.freeze({
        channels: Object.freeze(
          [...channels].map(([identity, channel]) => {
            const sample = sampleChannel(channel, at);
            return Object.freeze({
              identity,
              kind: channel.kind,
              ...(channel.kind === "scalar" ? { source: channel.source } : {}),
              ...sample,
            });
          }),
        ),
      });
    },
    fork(forkOptions) {
      if (disposed) throw new Error("Cannot fork a disposed web Animation host.");
      return createWebAnimationHost(forkOptions, channels);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      frameTime = undefined;
      frameTransition = "animate";
      channels.clear();
      restored.clear();
    },
  };
}

class UnknownAnimationError extends Error {
  constructor(identity: string) {
    super(`Unknown Animation ${JSON.stringify(identity)} in this Presentation scope.`);
  }
}

function updateScalarChannel(
  previous: ScalarChannel | undefined,
  source: number,
  animation: WebScalarAnimation,
  time: number,
  reducedMotion: boolean,
): ScalarChannel {
  const target = finite(source, "Animation source");
  const current = previous ? sampleScalar(previous, time) : undefined;

  if (animation.kind === "follow") {
    const continuing =
      previous?.animation.kind === "follow" && previous.animation.relative === animation.relative;
    const sourceOrigin = animation.relative
      ? continuing
        ? previous.sourceOrigin
        : target
      : undefined;
    const outputOrigin = animation.relative
      ? continuing
        ? previous.outputOrigin
        : (current?.value ?? target)
      : undefined;
    const value =
      sourceOrigin === undefined || outputOrigin === undefined
        ? target
        : outputOrigin + target - sourceOrigin;
    const sample = Object.freeze({
      value,
      velocity: finite(animation.velocity, "follow velocity"),
      settled: true,
    });
    return {
      kind: "scalar",
      source: target,
      animation,
      origin: sample,
      started: time,
      lastSample: sample,
      touched: false,
      ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
      ...(outputOrigin === undefined ? {} : { outputOrigin }),
    };
  }

  if (
    previous &&
    previous.animation.kind === animation.kind &&
    previous.source === target &&
    sameAnimation(previous.animation, animation) &&
    (previous.trajectory || previous.lastSample.settled)
  ) {
    const sampled = sampleScalar(previous, time);
    previous.lastSample = sampled;
    return previous;
  }

  const from = current?.value ?? initialValue(animation, target);
  const incomingVelocity = current?.velocity ?? 0;
  const trajectory = createDynamicsTrajectory({
    from,
    ...(animation.kind === "decay" ? {} : { target }),
    velocity: animation.kind === "decay" ? target : incomingVelocity,
    dynamics: animation,
  });

  if (reducedMotion) {
    const final = trajectory.at(trajectory.duration);
    const sample = Object.freeze({ value: final.value, velocity: 0, settled: true });
    return {
      kind: "scalar",
      source: target,
      animation,
      origin: sample,
      started: time,
      lastSample: sample,
      touched: false,
    };
  }

  const sample = Object.freeze({ value: from, velocity: incomingVelocity, settled: false });
  return {
    kind: "scalar",
    source: target,
    animation,
    origin: Object.freeze({ value: from, velocity: incomingVelocity }),
    started: time,
    trajectory,
    lastSample: sample,
    touched: false,
  };
}

function updateEventChannel(
  previous: EventChannel | undefined,
  source: Event<unknown>,
  animation: WebPulse<unknown>,
  time: number,
  reducedMotion: boolean,
): EventChannel {
  const sameSource = previous?.source === source;
  const initial = !sameSource
    ? {
        kind: "event" as const,
        source,
        animation,
        cursor: eventCursor(source),
        origin: Object.freeze({ value: 0, velocity: 0 }),
        started: time,
        lastSample: Object.freeze({ value: 0, velocity: 0, settled: true }),
        touched: false,
      }
    : previous;

  let channel = initial;
  const beforeCursor = channel.cursor;
  const batch = readEventOccurrences(source, beforeCursor);
  const animationChanged = !sameValue(channel.animation, animation, new WeakMap());

  if (
    (animationChanged || (!channel.trajectory && !channel.lastSample.settled)) &&
    batch.occurrences.length === 0
  ) {
    const current = sampleEvent(channel, time);
    channel = createPulseChannel(
      channel,
      animation,
      current.value,
      current.velocity,
      time,
      channel.cursor,
    );
  }

  for (const occurrence of batch.occurrences) {
    const current = sampleEvent(channel, time);
    const active = !current.settled;
    const amount = pulseAmplitude(animation, occurrence.payload);
    if (animation.overlap === "ignore" && active) {
      channel = { ...channel, animation, cursor: occurrence.sequence };
      continue;
    }
    const from = animation.overlap === "accumulate" ? current.value + amount : amount;
    const incomingVelocity = animation.overlap === "accumulate" ? current.velocity : 0;
    channel = createPulseChannel(
      channel,
      animation,
      from,
      incomingVelocity,
      time,
      occurrence.sequence,
    );
  }

  if (reducedMotion) {
    channel = {
      ...channel,
      animation,
      trajectory: undefined,
      origin: Object.freeze({ value: 0, velocity: 0 }),
      started: time,
      lastSample: Object.freeze({ value: 0, velocity: 0, settled: true }),
    };
  } else {
    channel.lastSample = sampleEvent(channel, time);
  }

  channel.touched = false;
  channel.consumed =
    batch.occurrences.length === 0
      ? undefined
      : Object.freeze({
          after: beforeCursor,
          through: batch.cursor,
          count: batch.occurrences.length,
        });
  return channel;
}

function restoredScalarChannel(
  seed: WebAnimationHostSnapshot["channels"][number],
  source: number,
  animation: WebScalarAnimation,
): ScalarChannel {
  const sample = Object.freeze({
    value: finite(seed.value, "restored value"),
    velocity: finite(seed.velocity, "restored velocity"),
    settled: seed.settled,
  });
  return {
    kind: "scalar",
    source: seed.source === undefined ? source : finite(seed.source, "restored source"),
    animation,
    origin: sample,
    started: 0,
    lastSample: sample,
    touched: false,
  };
}

function restoredEventChannel(
  seed: WebAnimationHostSnapshot["channels"][number],
  source: Event<unknown>,
  animation: WebPulse<unknown>,
): EventChannel {
  const sample = Object.freeze({
    value: finite(seed.value, "restored Event value"),
    velocity: finite(seed.velocity, "restored Event velocity"),
    settled: seed.settled,
  });
  return {
    kind: "event",
    source,
    animation,
    cursor: eventCursor(source),
    origin: sample,
    started: 0,
    lastSample: sample,
    touched: false,
  };
}

function createPulseChannel(
  previous: EventChannel,
  animation: WebPulse<unknown>,
  value: number,
  velocity: number,
  time: number,
  cursor: number,
): EventChannel {
  const origin = Object.freeze({ value, velocity });
  return {
    kind: "event",
    source: previous.source,
    animation,
    cursor,
    origin,
    started: time,
    trajectory: createDynamicsTrajectory({
      from: value,
      target: 0,
      velocity,
      dynamics: animation.spring,
    }),
    lastSample: Object.freeze({ value, velocity, settled: false }),
    touched: false,
  };
}

function pulseAmplitude(animation: WebPulse<unknown>, payload: unknown): number {
  return finite(
    typeof animation.amplitude === "function" ? animation.amplitude(payload) : animation.amplitude,
    "pulse amplitude",
  );
}

function sampleEvent(channel: EventChannel, time: number): AnimationSample<number, number> {
  if (!channel.trajectory) return channel.lastSample;
  const elapsed = Math.max(0, time - channel.started);
  const sampled = channel.trajectory.at(elapsed);
  const result = Object.freeze({
    value: sampled.value,
    velocity: sampled.velocity,
    settled: elapsed >= channel.trajectory.duration,
  });
  channel.lastSample = result;
  return result;
}

function sampleChannel(channel: AnimationChannel, time: number): AnimationSample<number, number> {
  return channel.kind === "scalar" ? sampleScalar(channel, time) : sampleEvent(channel, time);
}

function sampleScalar(channel: ScalarChannel, time: number): AnimationSample<number, number> {
  if (!channel.trajectory) return channel.lastSample;
  const elapsed = Math.max(0, time - channel.started);
  const sampled = channel.trajectory.at(elapsed);
  const settled = elapsed >= channel.trajectory.duration;
  const result = Object.freeze({
    value: sampled.value,
    velocity: sampled.velocity,
    settled,
  });
  channel.lastSample = result;
  return result;
}

function initialValue(animation: Exclude<WebScalarAnimation, { kind: "follow" }>, target: number) {
  const configured = "initial" in animation ? animation.initial : undefined;
  return configured === undefined ? target : finite(configured, "Animation initial value");
}

function isWebScalarAnimation(value: unknown): value is WebScalarAnimation {
  if (!value || typeof value !== "object") return false;
  return ["spring", "decay", "tween", "track", "follow"].includes(
    Reflect.get(value, "kind") as string,
  );
}

function isWebPulse(value: unknown): value is WebPulse<unknown> {
  return Boolean(value && typeof value === "object" && Reflect.get(value, "kind") === "pulse");
}

function isEvent(value: unknown): value is Event<unknown> {
  try {
    eventCursor(value as Event<unknown>);
    return true;
  } catch {
    return false;
  }
}

function sameAnimation(left: WebScalarAnimation, right: WebScalarAnimation): boolean {
  return sameValue(left, right, new WeakMap());
}

function sameValue(left: unknown, right: unknown, seen: WeakMap<object, object>): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameValue(Reflect.get(left, key), Reflect.get(right, key), seen),
    )
  );
}

function snapshotAnimation(animation: WebScalarAnimation | WebPulse<unknown>): Readonly<object> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(animation).map(([name, value]) => [
        name,
        Array.isArray(value) ? Object.freeze([...value]) : value,
      ]),
    ),
  );
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Web ${label} must be finite.`);
  return value;
}
