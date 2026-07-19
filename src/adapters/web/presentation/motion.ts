const seconds = 1_000;
const maximumDuration = 60;
const restObservation = 0.1;

export type WebPhysicalSpring = Readonly<{
  mass?: number;
  stiffness?: number;
  damping?: number;
  duration?: never;
  bounce?: never;
  restDistance?: number;
  restSpeed?: number;
}>;

export type WebPerceivedSpring = Readonly<{
  duration: number;
  bounce?: number;
  mass?: never;
  stiffness?: never;
  damping?: never;
  restDistance?: number;
  restSpeed?: number;
}>;

export type WebSpringOptions = WebPhysicalSpring | WebPerceivedSpring;

/** Immutable spring meaning. Velocity belongs to a transition, not its parameters. */
export type WebSpring = Readonly<{
  kind: "spring";
  mass: number;
  stiffness: number;
  damping: number;
  restDistance: number;
  restSpeed: number;
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

export type WebMotionValue<Value, Velocity = Value> = Readonly<{
  value: Value;
  velocity?: Velocity;
  transition?: WebSpring;
}>;

export type WebMotionTransform = Readonly<{
  translate?: Readonly<{ x?: number; y?: number }>;
  scale?: number | Readonly<{ x: number; y: number }>;
  rotate?: number;
}>;

export type WebMotionTransformVelocity = Readonly<{
  translate?: Readonly<{ x?: number; y?: number }>;
  scale?: number | Readonly<{ x: number; y: number }>;
  rotate?: number;
}>;

export type WebLayoutMotion = Readonly<{ transition: WebSpring; identity?: string }>;

export type WebMotionFrame = Readonly<{
  opacity?: number;
  transform?: WebMotionTransform;
}>;

export type WebPresenceMotion = Readonly<{
  enter?: Readonly<{ from: WebMotionFrame; transition: WebSpring }>;
  exit?: Readonly<{
    to: WebMotionFrame;
    transition: WebSpring;
    layout?: "pop";
  }>;
}>;

/** Desired compositor-friendly visual values for one web Presentation target. */
export type WebMotion = Readonly<{
  opacity?: WebMotionValue<number>;
  transform?: WebMotionValue<WebMotionTransform, WebMotionTransformVelocity>;
  layout?: WebLayoutMotion;
  presence?: WebPresenceMotion;
}>;

export type WebMotionStrategy = "direct" | "waapi" | "frame";

export type WebViewTransitionFacts = Readonly<{
  supported: boolean;
  mutationOwned: boolean;
  interaction: "passive" | "hit-testable";
  continuity: "one-shot" | "reversible" | "retargetable";
  materializable: boolean;
  snapshotArea: number;
  snapshotBudget: number;
}>;

export type WebMotionHost = {
  begin(updates: ReadonlyMap<Element, WebMotion | undefined>): void;
  set(target: Element, motion: WebMotion | undefined): void;
  complete(): void;
  dispose(): void;
};

export type WebMotionEnvironment = Readonly<{
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  queueTask: (callback: () => void) => void;
  reducedMotion: boolean;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (handle: unknown) => void;
}>;

/** Selects realization only from declaration meaning and explicit native capabilities. */
export function planWebMotion(
  input: Readonly<{
    transition: WebSpring | undefined;
    waapi: boolean;
    reducedMotion: boolean;
  }>,
): WebMotionStrategy {
  if (!input.transition || input.reducedMotion) return "direct";
  return input.waapi ? "waapi" : "frame";
}

/** @internal View snapshots are an optimization only when their semantic costs are bounded. */
export function canUseWebViewTransition(facts: WebViewTransitionFacts): boolean {
  return (
    facts.supported &&
    facts.mutationOwned &&
    facts.interaction === "passive" &&
    facts.snapshotArea <= facts.snapshotBudget &&
    (facts.continuity === "one-shot" || facts.materializable)
  );
}

/** Creates normalized spring data without allocating an animation or native resource. */
export function createSpring(options: WebSpringOptions = {}): WebSpring {
  const restDistance = positive(options.restDistance ?? 0.001, "restDistance");
  const restSpeed = positive(options.restSpeed ?? 0.001, "restSpeed");

  if ("duration" in options && options.duration !== undefined) {
    const duration = positive(options.duration, "duration") / seconds;
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
    });
  }

  return Object.freeze({
    kind: "spring",
    mass: positive(options.mass ?? 1, "mass"),
    stiffness: positive(options.stiffness ?? 170, "stiffness"),
    damping: positive(options.damping ?? 26, "damping"),
    restDistance,
    restSpeed,
  });
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
  const { mass, stiffness, damping } = input.spring;
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
    duration: duration * seconds,
    at(time) {
      const milliseconds = finite(time, "time");
      if (milliseconds <= 0) return Object.freeze({ value: from, velocity: initialVelocity });
      if (milliseconds >= duration * seconds) return Object.freeze({ value: to, velocity: 0 });
      const sample = solve(milliseconds / seconds);
      return Object.freeze({ value: to + sample.value, velocity: sample.velocity });
    },
  });
}

/** Adaptively samples the canonical trajectory for native keyframe renderers. */
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

/** @internal Owns native web motion for one Presentation registry. */
export function createNativeMotionHost(
  boundary: Element,
  environment?: Partial<WebMotionEnvironment>,
): WebMotionHost {
  const ownerDocument = boundary.ownerDocument;
  const view = ownerDocument?.defaultView;
  if (!ownerDocument) throw new Error("A web motion boundary must belong to a Document.");
  const clock = environment?.now ?? (() => performance.now());
  const requestFrame =
    environment?.requestFrame ??
    view?.requestAnimationFrame.bind(view) ??
    ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(clock()), 16) as unknown as number);
  const cancelFrame =
    environment?.cancelFrame ??
    view?.cancelAnimationFrame.bind(view) ??
    ((handle: number) => clearTimeout(handle));
  const reducedMotion =
    environment?.reducedMotion ??
    view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false;
  const setTimer = environment?.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = environment?.clearTimer ?? ((handle) => clearTimeout(handle as number));
  const queueTask = environment?.queueTask ?? queueMicrotask;
  const targets = new Map<Element, TargetMotion>();
  let prepared: Map<Element | string, PreparedLayout> | undefined;
  let pending: Map<Element, WebMotion | undefined> | undefined;
  let completionScheduled = false;
  let frame: number | undefined;
  let disposed = false;

  const renderFrames = (time: number): void => {
    frame = undefined;
    let active = false;
    for (const [target, state] of targets) {
      if (state.opacity?.strategy === "frame") {
        const sample = sampleScalar(state.opacity, time);
        setStyle(target, "opacity", `${sample.value}`);
        if (time >= state.opacity.started + state.opacity.trajectory.duration) {
          state.opacity = settledScalar(state.opacity.target);
        } else active = true;
      }
      if (state.transform?.strategy === "frame") {
        const sample = sampleTransform(state.transform, time);
        renderTransform(target, sample.value);
        if (time >= state.transform.started + state.transform.duration) {
          state.transform = settledTransform(state.transform.target);
        } else active = true;
      }
      if (state.layout?.strategy === "frame") {
        const sample = sampleLayout(state.layout, time);
        renderLayout(target, sample.value, state.original);
        if (time >= state.layout.started + state.layout.duration) {
          restoreOriginalLayout(target, state.original);
          state.layout = settledLayout(state.layout.identity, state.layout.rect);
        } else active = true;
      }
    }
    if (active) frame = requestFrame(renderFrames);
  };

  const scheduleFrames = (): void => {
    if (frame === undefined) frame = requestFrame(renderFrames);
  };

  const applyChannels = (target: Element, state: TargetMotion, motion: WebMotion | undefined) => {
    const time = clock();
    const hadOpacity = state.opacity !== undefined;
    const hadTransform = state.transform !== undefined;
    state.opacity = updateScalar(
      target,
      "opacity",
      state.opacity,
      motion?.opacity,
      time,
      reducedMotion,
      scheduleFrames,
    );
    state.transform = updateTransform(
      target,
      state.transform,
      motion?.transform,
      time,
      reducedMotion,
      scheduleFrames,
    );
    if (hadOpacity && !motion?.opacity) setStyle(target, "opacity", state.original.opacity);
    if (hadTransform && !motion?.transform) restoreOriginalTransform(target, state.original);
  };

  const cancelPresenceFinish = (state: TargetMotion) => {
    if (state.presenceTimer === undefined) return;
    clearTimer(state.presenceTimer.handle);
    state.presenceTimer = undefined;
  };

  const schedulePresenceFinish = (target: Element, state: TargetMotion) => {
    cancelPresenceFinish(state);
    const time = clock();
    const ends = [
      state.opacity && state.opacity.strategy !== "direct"
        ? state.opacity.started + state.opacity.trajectory.duration
        : time,
      state.transform && state.transform.strategy !== "direct"
        ? state.transform.started + state.transform.duration
        : time,
    ];
    state.presenceTimer = {
      handle: setTimer(
        () => {
          state.presenceTimer = undefined;
          if (
            targets.get(target) === state &&
            target.getAttribute("data-motion-state") === "exiting"
          ) {
            const EventConstructor = view?.Event ?? Event;
            target.dispatchEvent(new EventConstructor("poggersmotionfinish"));
          }
        },
        Math.max(0, ...ends.map((end) => end - time)),
      ),
    };
  };

  const applyPresence = (target: Element, state: TargetMotion) => {
    const declaration = state.declaration;
    const presence = declaration?.presence;
    const phase = target.getAttribute("data-motion-state");
    if (!presence || !declaration) {
      cancelPresenceFinish(state);
      state.presencePhase = undefined;
      applyChannels(target, state, declaration);
      return;
    }

    if (phase === "exiting" && presence.exit) {
      state.presencePhase = "exiting";
      applyChannels(
        target,
        state,
        presenceMotion(declaration, presence.exit.to, presence.exit.transition),
      );
      schedulePresenceFinish(target, state);
      return;
    }

    cancelPresenceFinish(state);
    if (phase === "entering" && presence.enter && state.presencePhase !== "entering") {
      const reversing = state.presencePhase === "exiting";
      state.presencePhase = "entering";
      if (!reversing) {
        applyChannels(target, state, presenceMotion(declaration, presence.enter.from));
      }
      applyChannels(
        target,
        state,
        presenceMotion(
          declaration,
          presentFrame(declaration, presence.enter.from),
          presence.enter.transition,
        ),
      );
      return;
    }
    if (phase === "entered" && state.presencePhase === "entering") {
      state.presencePhase = "entered";
      return;
    }
    state.presencePhase = phase === "entered" ? "entered" : undefined;
    applyChannels(target, state, declaration);
  };

  const Observer = view?.MutationObserver;
  const observer = Observer
    ? new Observer((mutations) => {
        for (const mutation of mutations) {
          const target = mutation.target as Element;
          const state = targets.get(target);
          if (state) applyPresence(target, state);
        }
      })
    : undefined;
  if (observer && ownerDocument.documentElement) {
    observer.observe(ownerDocument.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-motion-state"],
    });
  }

  return {
    begin(updates) {
      if (disposed) throw new Error("Cannot begin a disposed web motion host transaction.");
      pending ??= new Map();
      prepared ??= new Map();
      const time = clock();
      for (const [target, motion] of updates) {
        pending.set(target, motion);
        const current = targets.get(target)?.layout;
        if (!current) continue;
        if (prepared.has(current.identity)) continue;
        const sample = sampleLayout(current, time);
        const canonical = prepareLayout(current.rect, sample);
        const measured =
          canonical.rect.width > 0 && canonical.rect.height > 0
            ? canonical
            : measuredPreparedLayout(target);
        prepared.set(current.identity, measured);
      }
    },
    set(target, motion) {
      if (disposed) throw new Error("Cannot update a disposed web motion host.");
      let state = targets.get(target);
      if (!state) {
        if (!motion) return;
        state = {
          original: captureOriginalStyle(target),
          originalPresence: captureOriginalPresence(target),
        };
        targets.set(target, state);
      }
      state.declaration = motion;
      configurePresence(target, motion?.presence, state.originalPresence);
      applyPresence(target, state);
      if (!motion?.layout && state.layout) {
        state.layout.animation?.cancel();
        restoreOriginalLayout(target, state.original);
        state.layout = undefined;
      }
      if (!motion) {
        cancelPresenceFinish(state);
        restoreOriginalStyle(target, state.original);
        restoreOriginalPresence(target, state.originalPresence);
        targets.delete(target);
      }
    },
    complete() {
      if (!pending || !prepared) return;
      const hasLayout = prepared.size > 0 || [...pending.values()].some((motion) => motion?.layout);
      if (!hasLayout) {
        prepared = undefined;
        pending = undefined;
        return;
      }
      if (completionScheduled) return;
      completionScheduled = true;
      queueTask(() => {
        completionScheduled = false;
        if (disposed || !pending || !prepared) return;
        const updates = pending;
        const beforeLayouts = prepared;
        pending = undefined;
        prepared = undefined;
        const entries = [...updates].flatMap(([target, motion]) => {
          const declaration = motion?.layout;
          const state = targets.get(target);
          return declaration && state ? [{ target, declaration, state }] : [];
        });
        for (const { target, state } of entries) {
          state.layout?.animation?.cancel();
          restoreOriginalLayout(target, state.original);
        }
        const finalRects = new Map(entries.map(({ target }) => [target, readLayoutRect(target)]));
        const time = clock();
        for (const { target, declaration, state } of entries) {
          const identity = declaration.identity ?? target;
          state.layout = realizeLayout(
            target,
            state.layout,
            identity,
            finalRects.get(target)!,
            beforeLayouts.get(identity),
            declaration.transition,
            time,
            reducedMotion,
            scheduleFrames,
            state.original,
          );
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      if (frame !== undefined) cancelFrame(frame);
      frame = undefined;
      prepared = undefined;
      pending = undefined;
      for (const [target, state] of targets) {
        state.opacity?.animation?.cancel();
        state.transform?.animation?.cancel();
        state.layout?.animation?.cancel();
        cancelPresenceFinish(state);
        restoreOriginalStyle(target, state.original);
        restoreOriginalPresence(target, state.originalPresence);
      }
      targets.clear();
    },
  };
}

type OriginalStyle = Readonly<{
  opacity: string;
  translate: string;
  scale: string;
  rotate: string;
  transform: string;
  transformOrigin: string;
}>;

type OriginalPresence = Readonly<{
  lifecycle: string | null;
  layout: string | null;
}>;

type TargetMotion = {
  readonly original: OriginalStyle;
  readonly originalPresence: OriginalPresence;
  declaration?: WebMotion;
  presencePhase?: string;
  presenceTimer?: Readonly<{ handle: unknown }>;
  opacity?: ScalarMotion;
  transform?: TransformMotion;
  layout?: LayoutMotion;
};

function presenceMotion(
  declaration: WebMotion,
  frame: WebMotionFrame,
  transition?: WebSpring,
): WebMotion {
  return {
    ...declaration,
    opacity:
      frame.opacity === undefined
        ? declaration.opacity
        : { value: frame.opacity, ...(transition ? { transition } : {}) },
    transform:
      frame.transform === undefined
        ? declaration.transform
        : { value: frame.transform, ...(transition ? { transition } : {}) },
  };
}

function presentFrame(declaration: WebMotion, animated: WebMotionFrame): WebMotionFrame {
  return {
    ...(animated.opacity === undefined ? {} : { opacity: declaration.opacity?.value ?? 1 }),
    ...(animated.transform === undefined ? {} : { transform: declaration.transform?.value ?? {} }),
  };
}

function configurePresence(
  target: Element,
  presence: WebPresenceMotion | undefined,
  original: OriginalPresence,
): void {
  if (!presence) {
    restoreOriginalPresence(target, original);
    return;
  }
  const lifecycle = [presence.enter ? "enter" : "", presence.exit ? "exit exit-finished" : ""]
    .filter(Boolean)
    .join(" ");
  if (lifecycle) target.setAttribute("data-motion-lifecycle", lifecycle);
  else target.removeAttribute("data-motion-lifecycle");
  if (presence.exit?.layout === "pop") target.setAttribute("data-motion-layout", "pop");
  else target.removeAttribute("data-motion-layout");
}

function captureOriginalPresence(target: Element): OriginalPresence {
  return {
    lifecycle: target.getAttribute("data-motion-lifecycle"),
    layout: target.getAttribute("data-motion-layout"),
  };
}

function restoreOriginalPresence(target: Element, original: OriginalPresence): void {
  restoreAttribute(target, "data-motion-lifecycle", original.lifecycle);
  restoreAttribute(target, "data-motion-layout", original.layout);
}

function restoreAttribute(target: Element, name: string, value: string | null): void {
  if (value === null) target.removeAttribute(name);
  else target.setAttribute(name, value);
}

type ScalarMotion = {
  readonly target: number;
  readonly velocity: number;
  readonly strategy: WebMotionStrategy;
  readonly started: number;
  readonly trajectory: WebSpringTrajectory;
  readonly spring?: WebSpring;
  readonly animation?: Animation;
};

type MotionTransform = Readonly<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}>;

type TransformMotion = {
  readonly target: MotionTransform;
  readonly velocity: MotionTransform;
  readonly strategy: WebMotionStrategy;
  readonly started: number;
  readonly duration: number;
  readonly trajectories: Readonly<Record<keyof MotionTransform, WebSpringTrajectory>>;
  readonly spring?: WebSpring;
  readonly animation?: Animation;
};

type LayoutRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type PreparedLayout = Readonly<{
  rect: LayoutRect;
  velocity: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

type LayoutMotion = {
  readonly identity: Element | string;
  readonly rect: LayoutRect;
  readonly strategy: WebMotionStrategy;
  readonly started: number;
  readonly duration: number;
  readonly trajectories: Readonly<Record<keyof MotionTransform, WebSpringTrajectory>>;
  readonly animation?: Animation;
};

function updateScalar(
  target: Element,
  property: "opacity",
  current: ScalarMotion | undefined,
  declaration: WebMotionValue<number> | undefined,
  time: number,
  reducedMotion: boolean,
  scheduleFrames: () => void,
): ScalarMotion | undefined {
  if (!declaration) {
    current?.animation?.cancel();
    return;
  }
  const desired = finite(declaration.value, property);
  if (
    current?.target === desired &&
    current.strategy !== "direct" &&
    sameSpring(current.spring, declaration.transition)
  ) {
    return current;
  }
  const sampled = current ? sampleScalar(current, time) : { value: desired, velocity: 0 };
  current?.animation?.cancel();
  const velocity = finite(declaration.velocity ?? sampled.velocity, `${property} velocity`);
  const strategy = planWebMotion({
    transition: declaration.transition,
    waapi: typeof (target as Element & { animate?: unknown }).animate === "function",
    reducedMotion,
  });
  if (strategy === "direct" || !declaration.transition) {
    setStyle(target, property, `${desired}`);
    return settledScalar(desired, velocity);
  }
  const trajectory = createSpringTrajectory({
    from: sampled.value,
    to: desired,
    velocity,
    spring: declaration.transition,
  });
  const next: ScalarMotion = {
    target: desired,
    velocity,
    strategy,
    started: time,
    trajectory,
    spring: declaration.transition,
  };
  setStyle(target, property, `${desired}`);
  if (trajectory.duration === 0) return settledScalar(desired);
  if (strategy === "waapi") {
    const animation = target.animate(
      sampleSpringTrajectory(trajectory).map((sample) => ({
        offset: sample.offset,
        [property]: sample.value,
      })),
      { duration: trajectory.duration, easing: "linear", fill: "both" },
    );
    const owned = { ...next, animation };
    animation.onfinish = () => {
      if (animation === owned.animation) animation.cancel();
    };
    return owned;
  }
  scheduleFrames();
  return next;
}

function updateTransform(
  target: Element,
  current: TransformMotion | undefined,
  declaration: WebMotionValue<WebMotionTransform, WebMotionTransformVelocity> | undefined,
  time: number,
  reducedMotion: boolean,
  scheduleFrames: () => void,
): TransformMotion | undefined {
  if (!declaration) {
    current?.animation?.cancel();
    return;
  }
  const desired = normalizeTransform(declaration.value, "transform");
  if (
    current &&
    sameTransform(current.target, desired) &&
    current.strategy !== "direct" &&
    sameSpring(current.spring, declaration.transition)
  ) {
    return current;
  }
  const sampled = current
    ? sampleTransform(current, time)
    : { value: desired, velocity: zeroTransform() };
  current?.animation?.cancel();
  const velocity = declaration.velocity
    ? normalizeTransform(declaration.velocity, "transform velocity", 0)
    : sampled.velocity;
  const strategy = planWebMotion({
    transition: declaration.transition,
    waapi: typeof (target as Element & { animate?: unknown }).animate === "function",
    reducedMotion,
  });
  if (strategy === "direct" || !declaration.transition) {
    renderTransform(target, desired);
    return settledTransform(desired, velocity);
  }
  const trajectories = mapTransform((key) =>
    createSpringTrajectory({
      from: sampled.value[key],
      to: desired[key],
      velocity: velocity[key],
      spring: declaration.transition!,
    }),
  );
  const duration = Math.max(
    ...Object.values(trajectories).map((trajectory) => trajectory.duration),
  );
  const next: TransformMotion = {
    target: desired,
    velocity,
    strategy,
    started: time,
    duration,
    trajectories,
    spring: declaration.transition,
  };
  renderTransform(target, desired);
  if (duration === 0) return settledTransform(desired);
  if (strategy === "waapi") {
    const times = new Set([0, duration]);
    for (const key of transformKeys) {
      for (const sample of sampleSpringTrajectory(trajectories[key], motionTolerance(key))) {
        times.add(sample.time);
      }
    }
    const animation = target.animate(
      [...times]
        .sort((left, right) => left - right)
        .map((sampleTime) =>
          transformKeyframe(sampleTransform(next, time + sampleTime).value, sampleTime / duration),
        ),
      { duration, easing: "linear", fill: "both" },
    );
    const owned = { ...next, animation };
    animation.onfinish = () => {
      if (animation === owned.animation) animation.cancel();
    };
    return owned;
  }
  scheduleFrames();
  return next;
}

function realizeLayout(
  target: Element,
  current: LayoutMotion | undefined,
  identity: Element | string,
  rect: LayoutRect,
  before: PreparedLayout | undefined,
  spring: WebSpring,
  time: number,
  reducedMotion: boolean,
  scheduleFrames: () => void,
  original: OriginalStyle,
): LayoutMotion {
  current?.animation?.cancel();
  restoreOriginalLayout(target, original);
  if (!before) return settledLayout(identity, rect);

  const inverse: MotionTransform = {
    x: before.rect.left - rect.left,
    y: before.rect.top - rect.top,
    scaleX: rect.width ? before.rect.width / rect.width : 1,
    scaleY: rect.height ? before.rect.height / rect.height : 1,
    rotate: 0,
  };
  if (sameTransform(inverse, identityTransform())) return settledLayout(identity, rect);
  const targetValue = identityTransform();
  const velocity: MotionTransform = {
    x: before.velocity.x,
    y: before.velocity.y,
    scaleX: rect.width ? before.velocity.width / rect.width : 0,
    scaleY: rect.height ? before.velocity.height / rect.height : 0,
    rotate: 0,
  };
  const trajectories = mapTransform((key) =>
    createSpringTrajectory({
      from: inverse[key],
      to: targetValue[key],
      velocity: velocity[key],
      spring,
    }),
  );
  const duration = Math.max(
    ...Object.values(trajectories).map((trajectory) => trajectory.duration),
  );
  const strategy = planWebMotion({
    transition: spring,
    waapi: typeof (target as Element & { animate?: unknown }).animate === "function",
    reducedMotion,
  });
  if (strategy === "direct" || duration === 0) return settledLayout(identity, rect);

  const next: LayoutMotion = {
    identity,
    rect,
    strategy,
    started: time,
    duration,
    trajectories,
  };
  if (strategy === "waapi") {
    const times = new Set([0, duration]);
    for (const key of transformKeys) {
      for (const sample of sampleSpringTrajectory(trajectories[key], motionTolerance(key))) {
        times.add(sample.time);
      }
    }
    const animation = target.animate(
      [...times]
        .sort((left, right) => left - right)
        .map((sampleTime) =>
          layoutKeyframe(sampleLayout(next, time + sampleTime).value, sampleTime / duration),
        ),
      { duration, easing: "linear", fill: "both" },
    );
    const owned = { ...next, animation };
    animation.onfinish = () => {
      if (animation === owned.animation) animation.cancel();
    };
    return owned;
  }
  renderLayout(target, inverse, original);
  scheduleFrames();
  return next;
}

function sampleScalar(
  state: ScalarMotion,
  time: number,
): Readonly<{ value: number; velocity: number }> {
  if (state.strategy === "direct") return { value: state.target, velocity: state.velocity };
  return state.trajectory.at(rendererElapsed(state, time));
}

function sampleTransform(
  state: TransformMotion,
  time: number,
): Readonly<{ value: MotionTransform; velocity: MotionTransform }> {
  if (state.strategy === "direct") return { value: state.target, velocity: state.velocity };
  const elapsed = rendererElapsed(state, time);
  return {
    value: mapTransform((key) => state.trajectories[key].at(elapsed).value),
    velocity: mapTransform((key) => state.trajectories[key].at(elapsed).velocity),
  };
}

function sampleLayout(
  state: LayoutMotion,
  time: number,
): Readonly<{ value: MotionTransform; velocity: MotionTransform }> {
  if (state.strategy === "direct") {
    return { value: identityTransform(), velocity: zeroTransform() };
  }
  const elapsed = rendererElapsed(state, time);
  return {
    value: mapTransform((key) => state.trajectories[key].at(elapsed).value),
    velocity: mapTransform((key) => state.trajectories[key].at(elapsed).velocity),
  };
}

function prepareLayout(
  rect: LayoutRect,
  sample: Readonly<{ value: MotionTransform; velocity: MotionTransform }>,
): PreparedLayout {
  return {
    rect: {
      left: rect.left + sample.value.x,
      top: rect.top + sample.value.y,
      width: rect.width * sample.value.scaleX,
      height: rect.height * sample.value.scaleY,
    },
    velocity: {
      x: sample.velocity.x,
      y: sample.velocity.y,
      width: rect.width * sample.velocity.scaleX,
      height: rect.height * sample.velocity.scaleY,
    },
  };
}

function measuredPreparedLayout(target: Element): PreparedLayout {
  return {
    rect: readLayoutRect(target),
    velocity: { x: 0, y: 0, width: 0, height: 0 },
  };
}

function rendererElapsed(
  state: Readonly<{
    strategy: WebMotionStrategy;
    started: number;
    animation?: Animation;
  }>,
  time: number,
): number {
  const nativeTime = state.animation?.currentTime;
  if (state.strategy === "waapi" && typeof nativeTime === "number" && Number.isFinite(nativeTime)) {
    return Math.max(0, nativeTime);
  }
  return Math.max(0, time - state.started);
}

function settledScalar(target: number, velocity = 0): ScalarMotion {
  return {
    target,
    velocity,
    strategy: "direct",
    started: 0,
    trajectory: { duration: 0, at: () => ({ value: target, velocity }) },
  };
}

function settledTransform(target: MotionTransform, velocity = zeroTransform()): TransformMotion {
  const trajectories = mapTransform((key) => ({
    duration: 0,
    at: () => ({ value: target[key], velocity: velocity[key] }),
  }));
  return { target, velocity, strategy: "direct", started: 0, duration: 0, trajectories };
}

function settledLayout(identity: Element | string, rect: LayoutRect): LayoutMotion {
  const value = identityTransform();
  const trajectories = mapTransform((key) => ({
    duration: 0,
    at: () => ({ value: value[key], velocity: 0 }),
  }));
  return { identity, rect, strategy: "direct", started: 0, duration: 0, trajectories };
}

function normalizeTransform(
  value: WebMotionTransform | WebMotionTransformVelocity,
  name: string,
  scaleDefault = 1,
): MotionTransform {
  const scale = value.scale;
  return {
    x: finite(value.translate?.x ?? 0, `${name} translate x`),
    y: finite(value.translate?.y ?? 0, `${name} translate y`),
    scaleX: finite(
      typeof scale === "number" ? scale : (scale?.x ?? scaleDefault),
      `${name} scale x`,
    ),
    scaleY: finite(
      typeof scale === "number" ? scale : (scale?.y ?? scaleDefault),
      `${name} scale y`,
    ),
    rotate: finite(value.rotate ?? 0, `${name} rotate`),
  };
}

function zeroTransform(): MotionTransform {
  return { x: 0, y: 0, scaleX: 0, scaleY: 0, rotate: 0 };
}

function identityTransform(): MotionTransform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
}

function mapTransform<Value>(
  callback: (key: keyof MotionTransform) => Value,
): Record<keyof MotionTransform, Value> {
  return {
    x: callback("x"),
    y: callback("y"),
    scaleX: callback("scaleX"),
    scaleY: callback("scaleY"),
    rotate: callback("rotate"),
  };
}

const transformKeys = ["x", "y", "scaleX", "scaleY", "rotate"] as const;

function motionTolerance(key: keyof MotionTransform): number {
  if (key === "x" || key === "y") return 0.25;
  if (key === "rotate") return 0.1;
  return 0.001;
}

function sameTransform(left: MotionTransform, right: MotionTransform): boolean {
  return (Object.keys(left) as Array<keyof MotionTransform>).every(
    (key) => left[key] === right[key],
  );
}

function transformKeyframe(value: MotionTransform, offset: number): Keyframe {
  return {
    offset,
    translate: `${value.x}px ${value.y}px`,
    scale: `${value.scaleX} ${value.scaleY}`,
    rotate: `${value.rotate}deg`,
  };
}

function layoutKeyframe(value: MotionTransform, offset: number): Keyframe {
  return {
    offset,
    transform: `translate(${value.x}px,${value.y}px) scale(${value.scaleX},${value.scaleY})`,
    transformOrigin: "top left",
  };
}

function renderTransform(target: Element, value: MotionTransform): void {
  setStyle(target, "translate", `${value.x}px ${value.y}px`);
  setStyle(target, "scale", `${value.scaleX} ${value.scaleY}`);
  setStyle(target, "rotate", `${value.rotate}deg`);
}

function renderLayout(target: Element, value: MotionTransform, original: OriginalStyle): void {
  setStyle(
    target,
    "transform",
    `translate(${value.x}px,${value.y}px) scale(${value.scaleX},${value.scaleY})`,
  );
  setStyle(target, "transform-origin", "top left");
  if (value.x === 0 && value.y === 0 && value.scaleX === 1 && value.scaleY === 1) {
    restoreOriginalLayout(target, original);
  }
}

function captureOriginalStyle(target: Element): OriginalStyle {
  const style = (target as HTMLElement).style;
  return {
    opacity: style?.getPropertyValue("opacity") ?? "",
    translate: style?.getPropertyValue("translate") ?? "",
    scale: style?.getPropertyValue("scale") ?? "",
    rotate: style?.getPropertyValue("rotate") ?? "",
    transform: style?.getPropertyValue("transform") ?? "",
    transformOrigin: style?.getPropertyValue("transform-origin") ?? "",
  };
}

function restoreOriginalStyle(target: Element, original: OriginalStyle): void {
  for (const [property, value] of Object.entries(original)) setStyle(target, property, value);
}

function restoreOriginalTransform(target: Element, original: OriginalStyle): void {
  setStyle(target, "translate", original.translate);
  setStyle(target, "scale", original.scale);
  setStyle(target, "rotate", original.rotate);
}

function restoreOriginalLayout(target: Element, original: OriginalStyle): void {
  setStyle(target, "transform", original.transform);
  setStyle(target, "transform-origin", original.transformOrigin);
}

function readLayoutRect(target: Element): LayoutRect {
  if (typeof target.getBoundingClientRect !== "function") {
    throw new TypeError("Web layout motion requires a measurable Element.");
  }
  const rect = target.getBoundingClientRect();
  return {
    left: finite(rect.left, "layout left"),
    top: finite(rect.top, "layout top"),
    width: finite(rect.width, "layout width"),
    height: finite(rect.height, "layout height"),
  };
}

function sameSpring(left: WebSpring | undefined, right: WebSpring | undefined): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.mass === right.mass &&
      left.stiffness === right.stiffness &&
      left.damping === right.damping &&
      left.restDistance === right.restDistance &&
      left.restSpeed === right.restSpeed)
  );
}

function setStyle(target: Element, property: string, value: string): void {
  const style = (target as HTMLElement).style;
  if (!style) throw new TypeError("Web motion can only target a stylable Element.");
  if (value) style.setProperty(property, value);
  else style.removeProperty(property);
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
