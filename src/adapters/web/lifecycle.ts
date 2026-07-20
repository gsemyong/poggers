type PresenceState = {
  value: number;
  velocity: number;
  settledValue: boolean;
  direction: "idle" | "entering" | "exiting";
  readonly settled: Set<() => void>;
};

const presence = new WeakMap<Element, PresenceState>();

/** @internal Connects Presentation settlement to retained web Structure. */
export function setPresentationPresence(
  target: Element,
  sample: Readonly<{ value: number; velocity?: number; settled?: boolean }> | number | undefined,
): void {
  const current = presence.get(target);
  if (sample === undefined) {
    if (!current) return;
    presence.delete(target);
    notify(current);
    return;
  }
  const value = typeof sample === "number" ? sample : sample.value;
  const velocity = typeof sample === "number" ? 0 : (sample.velocity ?? 0);
  const settledValue = typeof sample === "number" ? true : (sample.settled ?? true);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Web Presentation presence must be between 0 and 1; received ${value}.`);
  }
  if (!current) {
    presence.set(target, {
      value,
      velocity,
      settledValue,
      direction: presenceDirection(value, velocity, settledValue),
      settled: new Set(),
    });
    return;
  }
  if (
    current.value === value &&
    current.velocity === velocity &&
    current.settledValue === settledValue
  ) {
    return;
  }
  const finished = value === 0 && settledValue;
  const direction = presenceDirection(value, velocity, settledValue, current);
  current.value = value;
  current.velocity = velocity;
  current.settledValue = settledValue;
  current.direction = direction;
  if (finished) notify(current);
}

/** @internal Reads the last committed Presentation presence sample. */
export function readPresentationPresence(target: Element) {
  const state = presence.get(target);
  if (!state) {
    return Object.freeze({ value: 1, velocity: 0, settled: true, direction: "idle" as const });
  }
  return Object.freeze({
    value: state.value,
    velocity: state.velocity,
    settled: state.settledValue,
    direction: state.direction,
  });
}

/** @internal Reports whether an Element participates in Presentation-owned exit. */
export function hasPresentationPresence(target: Element): boolean {
  return presence.has(target);
}

/** @internal Observes one cancellable visual settlement without exposing time to behavior. */
export function onPresentationExit(target: Element, settled: () => void): () => void {
  const state = presence.get(target);
  if (!state || (state.value === 0 && state.settledValue)) {
    let active = true;
    queueMicrotask(() => {
      const current = presence.get(target);
      if (
        active &&
        (!current || (current === state && current.value === 0 && current.settledValue))
      ) {
        settled();
      }
    });
    return () => {
      active = false;
    };
  }
  state.settled.add(settled);
  return () => state.settled.delete(settled);
}

function notify(state: PresenceState): void {
  const listeners = [...state.settled];
  state.settled.clear();
  for (const listener of listeners) listener();
}

function presenceDirection(
  value: number,
  velocity: number,
  settled: boolean,
  previous?: Readonly<Pick<PresenceState, "value" | "direction">>,
): "idle" | "entering" | "exiting" {
  if (settled && value === 1) return "idle";
  if (settled && value === 0) return "exiting";
  if (velocity > 0) return "entering";
  if (velocity < 0) return "exiting";
  if (previous && value > previous.value) return "entering";
  if (previous && value < previous.value) return "exiting";
  if (!settled && previous && previous.direction !== "idle") return previous.direction;
  if (value === 0) return "exiting";
  return "idle";
}
