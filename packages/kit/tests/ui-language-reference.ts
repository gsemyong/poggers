export type ReferenceTokenValue =
  | boolean
  | number
  | string
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

export type ReferenceToken = {
  readonly type: string;
  readonly value: ReferenceTokenValue | { readonly alias: string };
};

export type ResolvedReferenceToken = {
  readonly type: string;
  readonly value: ReferenceTokenValue;
};

export function resolveReferenceTokens(
  definitions: Readonly<Record<string, ReferenceToken>>,
): Readonly<Record<string, ResolvedReferenceToken>> {
  const resolved = new Map<string, ResolvedReferenceToken>();
  const resolving: string[] = [];

  const resolve = (name: string): ResolvedReferenceToken => {
    const cached = resolved.get(name);
    if (cached) return cached;

    const cycleIndex = resolving.indexOf(name);
    if (cycleIndex >= 0) {
      const cycle = [...resolving.slice(cycleIndex), name];
      throw new Error(`Token alias cycle: ${cycle.join(" -> ")}`);
    }

    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown token alias "${name}".`);
    resolving.push(name);
    try {
      const value = definition.value;
      if (isAlias(value)) {
        const target = resolve(value.alias);
        if (target.type !== definition.type) {
          throw new Error(
            `Token "${name}" has type "${definition.type}" but aliases "${value.alias}" of type "${target.type}".`,
          );
        }
        const result = { type: definition.type, value: target.value };
        resolved.set(name, result);
        return result;
      }

      const result = { type: definition.type, value };
      resolved.set(name, result);
      return result;
    } finally {
      resolving.pop();
    }
  };

  return Object.fromEntries(
    Object.keys(definitions)
      .sort()
      .map((name) => [name, resolve(name)]),
  );
}

function isAlias(value: ReferenceToken["value"]): value is { readonly alias: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { readonly alias?: unknown }).alias === "string"
  );
}

export type ReferenceTargetContribution = {
  readonly identity: string;
  readonly property: string;
  readonly source: string;
  readonly value: unknown;
};

export type ReferenceTarget = ReferenceTargetContribution;

export function resolveReferenceTargets(
  contributions: readonly ReferenceTargetContribution[],
): Readonly<Record<string, ReferenceTarget>> {
  const targets = new Map<string, ReferenceTarget>();
  for (const contribution of contributions) {
    const key = `${contribution.identity}:${contribution.property}`;
    const existing = targets.get(key);
    if (existing) {
      throw new Error(
        `Target "${key}" is owned by both "${existing.source}" and "${contribution.source}".`,
      );
    }
    targets.set(key, contribution);
  }

  return Object.fromEntries([...targets].sort(([left], [right]) => left.localeCompare(right)));
}

export type ReferenceCompositionIdentity = {
  readonly identity: string;
  readonly documentOrder: number;
};

export type ReferenceCompositionRelation = {
  readonly below: string;
  readonly above: string;
};

export function resolveReferenceComposition(
  identities: readonly ReferenceCompositionIdentity[],
  relations: readonly ReferenceCompositionRelation[],
): readonly string[] {
  const byIdentity = new Map(identities.map((entry) => [entry.identity, entry]));
  if (byIdentity.size !== identities.length) {
    const seen = new Set<string>();
    const duplicate = identities.find((entry) => {
      if (seen.has(entry.identity)) return true;
      seen.add(entry.identity);
      return false;
    })!;
    throw new Error(`Duplicate composition identity "${duplicate.identity}".`);
  }
  const incoming = new Map(identities.map((entry) => [entry.identity, 0]));
  const outgoing = new Map(identities.map((entry) => [entry.identity, new Set<string>()]));

  for (const relation of relations) {
    if (!byIdentity.has(relation.below)) {
      throw new Error(`Unknown composition identity "${relation.below}".`);
    }
    if (!byIdentity.has(relation.above)) {
      throw new Error(`Unknown composition identity "${relation.above}".`);
    }
    const edges = outgoing.get(relation.below)!;
    if (edges.has(relation.above)) continue;
    edges.add(relation.above);
    incoming.set(relation.above, incoming.get(relation.above)! + 1);
  }

  const ready = identities.filter((entry) => incoming.get(entry.identity) === 0);
  const result: string[] = [];
  const sortReady = () =>
    ready.sort(
      (left, right) =>
        left.documentOrder - right.documentOrder || left.identity.localeCompare(right.identity),
    );
  sortReady();

  while (ready.length) {
    const next = ready.shift()!;
    result.push(next.identity);
    for (const above of outgoing.get(next.identity)!) {
      const remaining = incoming.get(above)! - 1;
      incoming.set(above, remaining);
      if (remaining === 0) ready.push(byIdentity.get(above)!);
    }
    sortReady();
  }

  if (result.length !== identities.length) {
    const cycle = identities
      .map((entry) => entry.identity)
      .filter((identity) => incoming.get(identity)! > 0)
      .sort();
    throw new Error(`Composition cycle: ${cycle.join(" -> ")}`);
  }

  return result;
}

export type ReferencePresence = "absent" | "entering" | "present" | "exiting";

export function targetReferencePresence(
  current: ReferencePresence,
  present: boolean,
): ReferencePresence {
  if (present) {
    if (current === "present" || current === "entering") return current;
    return "entering";
  }
  if (current === "absent" || current === "exiting") return current;
  return "exiting";
}

export function settleReferencePresence(current: ReferencePresence): ReferencePresence {
  if (current === "entering") return "present";
  if (current === "exiting") return "absent";
  return current;
}

export class ReferencePresenceCoordinator {
  readonly identity: string;
  #phase: ReferencePresence = "absent";
  #revision = 0;
  #pending = new Set<string>();
  #interactive = false;
  #accessible = false;
  #disposed = false;

  constructor(identity: string) {
    if (!identity) throw new Error("Presence identity cannot be empty.");
    this.identity = identity;
  }

  target(present: boolean, targets: readonly string[]): number {
    if (this.#disposed) throw new Error("Presence coordinator is disposed.");
    const next = targetReferencePresence(this.#phase, present);
    if (next === this.#phase) return this.#revision;
    if (targets.length === 0 || new Set(targets).size !== targets.length) {
      throw new Error("Presence transition needs unique settlement targets.");
    }
    for (const target of targets) {
      if (!target.startsWith(`${this.identity}:`)) {
        throw new Error(`Presence identity "${this.identity}" cannot await target "${target}".`);
      }
    }
    this.#phase = next;
    this.#pending = new Set(targets);
    this.#interactive = present;
    this.#accessible = present;
    return ++this.#revision;
  }

  settle(revision: number, target: string): boolean {
    if (this.#disposed || revision !== this.#revision || !this.#pending.delete(target))
      return false;
    if (this.#pending.size > 0) return false;
    this.#phase = settleReferencePresence(this.#phase);
    return true;
  }

  dispose(): boolean {
    if (this.#disposed) return false;
    this.#disposed = true;
    this.#pending.clear();
    this.#phase = "absent";
    this.#interactive = false;
    this.#accessible = false;
    return true;
  }

  get snapshot(): {
    readonly identity: string;
    readonly phase: ReferencePresence;
    readonly revision: number;
    readonly pending: readonly string[];
    readonly mounted: boolean;
    readonly interactive: boolean;
    readonly accessible: boolean;
    readonly disposed: boolean;
  } {
    return {
      identity: this.identity,
      phase: this.#phase,
      revision: this.#revision,
      pending: [...this.#pending].sort(),
      mounted: this.#phase !== "absent",
      interactive: this.#interactive,
      accessible: this.#accessible,
      disposed: this.#disposed,
    };
  }
}

export type ReferenceMotionOutcome = "settled" | "replaced" | "cancelled" | "disposed";

export type ReferenceMotionTarget = {
  readonly revision: number;
  readonly from: number;
  readonly velocity: number;
  readonly to: number;
  readonly policy: string;
};

export class ReferenceMotionChannel {
  readonly key: string;
  readonly owner: string;
  #value: number;
  #velocity = 0;
  #revision = 0;
  #disposed = false;
  #active?: ReferenceMotionTarget;
  #outcomes = new Map<number, ReferenceMotionOutcome>();

  constructor(key: string, owner: string, initial: number) {
    this.key = key;
    this.owner = owner;
    this.#value = initial;
  }

  get value(): number {
    return this.#value;
  }

  get velocity(): number {
    return this.#velocity;
  }

  get active(): ReferenceMotionTarget | undefined {
    return this.#active;
  }

  direct(value: number, velocity: number): void {
    this.#assertUsable();
    this.#replaceActive("replaced");
    this.#value = finite(value, "direct value");
    this.#velocity = finite(velocity, "direct velocity");
  }

  target(to: number, policy: string, velocity = this.#velocity): ReferenceMotionTarget {
    this.#assertUsable();
    this.#replaceActive("replaced");
    const target = {
      revision: ++this.#revision,
      from: this.#value,
      velocity: finite(velocity, "target velocity"),
      to: finite(to, "target value"),
      policy,
    };
    this.#active = target;
    return target;
  }

  sample(revision: number, value: number, velocity: number): boolean {
    this.#assertUsable();
    if (this.#active?.revision !== revision) return false;
    this.#value = finite(value, "sample value");
    this.#velocity = finite(velocity, "sample velocity");
    return true;
  }

  settle(revision: number): boolean {
    this.#assertUsable();
    const active = this.#active;
    if (!active || active.revision !== revision) return false;
    this.#value = active.to;
    this.#velocity = 0;
    this.#active = undefined;
    this.#outcomes.set(revision, "settled");
    return true;
  }

  cancel(): void {
    this.#assertUsable();
    this.#replaceActive("cancelled");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#replaceActive("disposed");
    this.#disposed = true;
  }

  outcome(revision: number): ReferenceMotionOutcome | undefined {
    return this.#outcomes.get(revision);
  }

  #replaceActive(outcome: ReferenceMotionOutcome): void {
    if (!this.#active) return;
    this.#outcomes.set(this.#active.revision, outcome);
    this.#active = undefined;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error(`Reference motion channel "${this.key}" is disposed.`);
  }
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
  return value;
}

export type ReferenceGestureRelease = {
  readonly committed: boolean;
  readonly destination: 0 | 1;
  readonly velocity: number;
};

export function resolveReferenceGestureRelease(options: {
  readonly progress: number;
  readonly velocity: number;
  readonly direction: "negative" | "positive" | "either";
  readonly distanceThreshold: number;
  readonly velocityThreshold: number;
  readonly cancelled?: boolean;
}): ReferenceGestureRelease {
  const progress = finite(options.progress, "gesture progress");
  const velocity = finite(options.velocity, "gesture velocity");
  const allowed =
    options.direction === "either" ||
    (options.direction === "positive" && velocity >= 0) ||
    (options.direction === "negative" && velocity <= 0);
  const directionalProgress =
    options.direction === "negative"
      ? -progress
      : options.direction === "positive"
        ? progress
        : Math.abs(progress);
  const directionalVelocity =
    options.direction === "negative"
      ? -velocity
      : options.direction === "positive"
        ? velocity
        : Math.abs(velocity);
  const committed =
    !options.cancelled &&
    allowed &&
    (directionalProgress >= options.distanceThreshold ||
      directionalVelocity >= options.velocityThreshold);
  return { committed, destination: committed ? 1 : 0, velocity };
}

export type ReferenceGestureEndReason = "commit" | "cancel" | "capture-lost" | "absent";

export class ReferenceGestureSession {
  #revision = 0;
  #pointer?: number;
  #captured = false;
  #disposed = false;
  #value = 0;
  #velocity = 0;
  #outcome?: ReferenceGestureEndReason;

  begin(pointer: number): number {
    if (this.#disposed) throw new Error("Gesture session is disposed.");
    if (this.#captured) throw new Error("Gesture session already owns pointer capture.");
    if (!Number.isSafeInteger(pointer) || pointer < 0) {
      throw new Error("Gesture pointer identity must be a non-negative safe integer.");
    }
    this.#pointer = pointer;
    this.#captured = true;
    this.#outcome = undefined;
    return ++this.#revision;
  }

  sample(revision: number, pointer: number, value: number, velocity: number): boolean {
    if (
      this.#disposed ||
      !this.#captured ||
      revision !== this.#revision ||
      pointer !== this.#pointer
    ) {
      return false;
    }
    this.#value = finite(value, "gesture sample value");
    this.#velocity = finite(velocity, "gesture sample velocity");
    return true;
  }

  end(revision: number, reason: ReferenceGestureEndReason): boolean {
    if (this.#disposed || !this.#captured || revision !== this.#revision) return false;
    this.#captured = false;
    this.#pointer = undefined;
    this.#outcome = reason;
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#captured) {
      this.#captured = false;
      this.#pointer = undefined;
      this.#outcome = "cancel";
    }
    this.#disposed = true;
  }

  get snapshot(): {
    readonly revision: number;
    readonly captured: boolean;
    readonly value: number;
    readonly velocity: number;
    readonly outcome?: ReferenceGestureEndReason;
  } {
    return {
      revision: this.#revision,
      captured: this.#captured,
      value: this.#value,
      velocity: this.#velocity,
      ...(this.#outcome ? { outcome: this.#outcome } : {}),
    };
  }
}

export class ReferenceHoverIntent {
  readonly #dwell: number;
  readonly #speed: number;
  readonly #leaveDelay: number;
  #time = 0;
  #inside = false;
  #hovered = false;
  #focused = false;
  #intent = false;
  #enteredAt = 0;
  #leaveAt?: number;
  #inline = 0;
  #block = 0;
  #sampleAt = 0;
  #speedValue = 0;

  constructor(options: {
    readonly dwell: number;
    readonly maximumSpeed: number;
    readonly leaveDelay: number;
  }) {
    this.#dwell = finite(options.dwell, "hover-intent dwell");
    this.#speed = finite(options.maximumSpeed, "hover-intent maximum speed");
    this.#leaveDelay = finite(options.leaveDelay, "hover-intent leave delay");
    if (this.#dwell < 0 || this.#speed < 0 || this.#leaveDelay < 0) {
      throw new Error("Hover-intent policy values cannot be negative.");
    }
  }

  enter(time: number, inline: number, block: number): void {
    this.#advanceClock(time);
    this.#inside = true;
    this.#hovered = true;
    this.#enteredAt = this.#time;
    this.#leaveAt = undefined;
    this.#inline = finite(inline, "hover inline position");
    this.#block = finite(block, "hover block position");
    this.#sampleAt = this.#time;
    this.#speedValue = 0;
  }

  move(time: number, inline: number, block: number): boolean {
    this.#advanceClock(time);
    if (!this.#inside) return false;
    const nextInline = finite(inline, "hover inline position");
    const nextBlock = finite(block, "hover block position");
    const elapsed = Math.max((this.#time - this.#sampleAt) / 1000, Number.EPSILON);
    this.#speedValue = Math.hypot(nextInline - this.#inline, nextBlock - this.#block) / elapsed;
    this.#inline = nextInline;
    this.#block = nextBlock;
    this.#sampleAt = this.#time;
    return true;
  }

  leave(time: number): void {
    this.#advanceClock(time);
    this.#inside = false;
    this.#hovered = false;
    this.#leaveAt = this.#time;
  }

  focus(time: number): void {
    this.#advanceClock(time);
    this.#focused = true;
  }

  blur(time: number): void {
    this.#advanceClock(time);
    this.#focused = false;
  }

  advance(time: number): void {
    const previous = this.#time;
    this.#advanceClock(time);
    if (this.#inside && this.#time > previous && this.#sampleAt <= previous) {
      this.#speedValue = 0;
    }
    if (
      this.#inside &&
      !this.#intent &&
      this.#time - this.#enteredAt >= this.#dwell &&
      this.#speedValue <= this.#speed
    ) {
      this.#intent = true;
    }
    if (
      !this.#inside &&
      this.#leaveAt !== undefined &&
      this.#time - this.#leaveAt >= this.#leaveDelay
    ) {
      this.#intent = false;
      this.#leaveAt = undefined;
    }
  }

  get snapshot(): {
    readonly hovered: boolean;
    readonly focused: boolean;
    readonly intent: boolean;
    readonly engaged: boolean;
  } {
    return {
      hovered: this.#hovered,
      focused: this.#focused,
      intent: this.#intent,
      engaged: this.#focused || this.#intent,
    };
  }

  #advanceClock(time: number): void {
    const next = finite(time, "hover-intent time");
    if (next < this.#time) throw new Error("Hover-intent time must be monotonic.");
    this.#time = next;
  }
}

export class ReferenceLongPress {
  readonly #duration: number;
  readonly #tolerance: number;
  #phase: "idle" | "possible" | "recognized" | "committed" | "failed" | "cancelled" = "idle";
  #revision = 0;
  #pointer?: number;
  #startedAt = 0;
  #time = 0;
  #inline = 0;
  #block = 0;

  constructor(options: { readonly duration: number; readonly movementTolerance: number }) {
    this.#duration = finite(options.duration, "long-press duration");
    this.#tolerance = finite(options.movementTolerance, "long-press movement tolerance");
    if (this.#duration <= 0) throw new Error("Long-press duration must be positive.");
    if (this.#tolerance < 0) throw new Error("Long-press movement tolerance cannot be negative.");
  }

  down(pointer: number, time: number, inline: number, block: number): number {
    if (this.#phase === "possible" || this.#phase === "recognized") {
      throw new Error("Long press already owns an active pointer.");
    }
    if (!Number.isSafeInteger(pointer) || pointer < 0) {
      throw new Error("Long-press pointer identity must be a non-negative safe integer.");
    }
    this.#time = this.#monotonic(time);
    this.#pointer = pointer;
    this.#startedAt = this.#time;
    this.#inline = finite(inline, "long-press inline position");
    this.#block = finite(block, "long-press block position");
    this.#phase = "possible";
    return ++this.#revision;
  }

  move(revision: number, pointer: number, time: number, inline: number, block: number): boolean {
    this.#time = this.#monotonic(time);
    if (revision !== this.#revision || pointer !== this.#pointer || this.#phase !== "possible") {
      return false;
    }
    const distance = Math.hypot(
      finite(inline, "long-press inline position") - this.#inline,
      finite(block, "long-press block position") - this.#block,
    );
    if (distance > this.#tolerance) {
      this.#phase = "failed";
      this.#pointer = undefined;
    }
    return true;
  }

  advance(time: number): "recognized" | undefined {
    this.#time = this.#monotonic(time);
    if (this.#phase !== "possible" || this.#time - this.#startedAt < this.#duration) {
      return undefined;
    }
    this.#phase = "recognized";
    return "recognized";
  }

  up(revision: number, pointer: number, time: number): "commit" | "fail" | undefined {
    this.#time = this.#monotonic(time);
    if (revision !== this.#revision || pointer !== this.#pointer) return undefined;
    this.#pointer = undefined;
    if (this.#phase === "recognized") {
      this.#phase = "committed";
      return "commit";
    }
    if (this.#phase === "possible") {
      this.#phase = "failed";
      return "fail";
    }
    return undefined;
  }

  cancel(revision: number, pointer: number, time: number): boolean {
    this.#time = this.#monotonic(time);
    if (
      revision !== this.#revision ||
      pointer !== this.#pointer ||
      (this.#phase !== "possible" && this.#phase !== "recognized")
    ) {
      return false;
    }
    this.#phase = "cancelled";
    this.#pointer = undefined;
    return true;
  }

  get snapshot(): {
    readonly revision: number;
    readonly phase: "idle" | "possible" | "recognized" | "committed" | "failed" | "cancelled";
    readonly progress: number;
  } {
    const progress =
      this.#phase === "recognized" || this.#phase === "committed"
        ? 1
        : this.#phase === "possible"
          ? Math.min(1, Math.max(0, (this.#time - this.#startedAt) / this.#duration))
          : 0;
    return { revision: this.#revision, phase: this.#phase, progress };
  }

  #monotonic(time: number): number {
    const next = finite(time, "long-press time");
    if (next < this.#time) throw new Error("Long-press time must be monotonic.");
    return next;
  }
}

export function resolveReferenceRubberBand(options: {
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly extent: number;
  readonly coefficient: number;
}): number {
  const value = finite(options.value, "rubber-band value");
  const minimum = finite(options.minimum, "rubber-band minimum");
  const maximum = finite(options.maximum, "rubber-band maximum");
  const extent = finite(options.extent, "rubber-band extent");
  const coefficient = finite(options.coefficient, "rubber-band coefficient");
  if (minimum > maximum) throw new Error("Rubber-band bounds are reversed.");
  if (extent <= 0) throw new Error("Rubber-band extent must be positive.");
  if (coefficient < 0 || coefficient > 1) {
    throw new Error("Rubber-band coefficient must be within zero and one.");
  }
  if (value >= minimum && value <= maximum) return value;
  const bound = value < minimum ? minimum : maximum;
  const distance = Math.abs(value - bound);
  const compressed = (distance * extent * coefficient) / (extent + coefficient * distance);
  return bound + Math.sign(value - bound) * compressed;
}

export function resolveReferenceSnapSet<Outcome extends string>(options: {
  readonly value: number;
  readonly velocity: number;
  readonly projectionSeconds: number;
  readonly points: readonly { readonly outcome: Outcome; readonly value: number }[];
}): { readonly outcome: Outcome; readonly value: number; readonly velocity: number } {
  const value = finite(options.value, "snap value");
  const velocity = finite(options.velocity, "snap velocity");
  const projectionSeconds = finite(options.projectionSeconds, "snap projection time");
  if (projectionSeconds < 0) throw new Error("Snap projection time cannot be negative.");
  if (options.points.length === 0) throw new Error("Snap set cannot be empty.");
  const outcomes = new Set<string>();
  const values = new Set<number>();
  for (const point of options.points) {
    if (!point.outcome || outcomes.has(point.outcome)) {
      throw new Error(`Snap outcome "${point.outcome}" must be non-empty and unique.`);
    }
    const pointValue = finite(point.value, `snap outcome "${point.outcome}"`);
    if (values.has(pointValue))
      throw new Error(`Snap value ${pointValue} belongs to two outcomes.`);
    outcomes.add(point.outcome);
    values.add(pointValue);
  }
  const projected = value + velocity * projectionSeconds;
  const point = [...options.points].sort(
    (left, right) =>
      Math.abs(left.value - projected) - Math.abs(right.value - projected) ||
      left.value - right.value ||
      left.outcome.localeCompare(right.outcome),
  )[0]!;
  return { outcome: point.outcome, value: point.value, velocity };
}

export function resolveReferenceGestureRebase(options: {
  readonly value: number;
  readonly velocity: number;
  readonly previousExtent: number;
  readonly nextExtent: number;
  readonly available: boolean;
}):
  | { readonly strategy: "cancel" }
  | { readonly strategy: "rebase"; readonly value: number; readonly velocity: number } {
  const value = finite(options.value, "gesture rebase value");
  const velocity = finite(options.velocity, "gesture rebase velocity");
  const previousExtent = finite(options.previousExtent, "previous gesture extent");
  const nextExtent = finite(options.nextExtent, "next gesture extent");
  if (previousExtent <= 0 || nextExtent <= 0) {
    throw new Error("Gesture rebase extents must be positive.");
  }
  if (!options.available) return { strategy: "cancel" };
  return {
    strategy: "rebase",
    value: (value / previousExtent) * nextExtent,
    velocity: (velocity / previousExtent) * nextExtent,
  };
}

export function resolveReferenceScrollCompetition(options: {
  readonly boundary: "start" | "end";
  readonly position: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly movement: "outward" | "inward";
}): "direct" | "scroll" {
  const position = finite(options.position, "scroll position");
  const minimum = finite(options.minimum, "scroll minimum");
  const maximum = finite(options.maximum, "scroll maximum");
  if (minimum > maximum) throw new Error("Scroll bounds are reversed.");
  const atBoundary = options.boundary === "start" ? position <= minimum : position >= maximum;
  return options.movement === "outward" && atBoundary ? "direct" : "scroll";
}

export type ReferenceAutoScrollSample = {
  readonly requestedVelocity: number;
  readonly velocity: number;
  readonly delta: number;
  readonly position: number;
  readonly gestureRebase: number;
};

export function resolveReferenceAutoScroll(options: {
  readonly pointer: number;
  readonly viewportStart: number;
  readonly viewportEnd: number;
  readonly edgeExtent: number;
  readonly maximumSpeed: number;
  readonly seconds: number;
  readonly position: number;
  readonly minimum: number;
  readonly maximum: number;
}): ReferenceAutoScrollSample {
  const pointer = finite(options.pointer, "auto-scroll pointer");
  const viewportStart = finite(options.viewportStart, "auto-scroll viewport start");
  const viewportEnd = finite(options.viewportEnd, "auto-scroll viewport end");
  const edgeExtent = finite(options.edgeExtent, "auto-scroll edge extent");
  const maximumSpeed = finite(options.maximumSpeed, "auto-scroll maximum speed");
  const seconds = finite(options.seconds, "auto-scroll frame duration");
  const position = finite(options.position, "auto-scroll position");
  const minimum = finite(options.minimum, "auto-scroll minimum");
  const maximum = finite(options.maximum, "auto-scroll maximum");
  const viewportExtent = viewportEnd - viewportStart;
  if (viewportExtent <= 0) throw new Error("Auto-scroll viewport must have positive extent.");
  if (edgeExtent <= 0 || edgeExtent * 2 > viewportExtent) {
    throw new Error("Auto-scroll edge extent must be positive and no more than half the viewport.");
  }
  if (maximumSpeed < 0 || seconds < 0) {
    throw new Error("Auto-scroll speed and frame duration cannot be negative.");
  }
  if (minimum > maximum || position < minimum || position > maximum) {
    throw new Error("Auto-scroll position must be within ordered bounds.");
  }

  const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
  const startProximity = clampUnit((viewportStart + edgeExtent - pointer) / edgeExtent);
  const endProximity = clampUnit((pointer - (viewportEnd - edgeExtent)) / edgeExtent);
  const signedProximity = endProximity > 0 ? endProximity : -startProximity;
  const requestedVelocity =
    signedProximity === 0
      ? 0
      : Math.sign(signedProximity) * maximumSpeed * Math.abs(signedProximity) ** 2;
  const next = Math.min(maximum, Math.max(minimum, position + requestedVelocity * seconds));
  const delta = next - position;
  const velocity = seconds > 0 ? delta / seconds : 0;
  return { requestedVelocity, velocity, delta, position: next, gestureRebase: delta };
}

export class ReferenceAutoScrollSession {
  #revision = 0;
  #active = false;
  #disposed = false;

  start(): number {
    if (this.#disposed) throw new Error("Auto-scroll session is disposed.");
    this.#active = true;
    return ++this.#revision;
  }

  step(
    revision: number,
    options: Parameters<typeof resolveReferenceAutoScroll>[0],
  ): ReferenceAutoScrollSample | undefined {
    if (this.#disposed || !this.#active || revision !== this.#revision) return undefined;
    return resolveReferenceAutoScroll(options);
  }

  stop(revision: number): boolean {
    if (this.#disposed || !this.#active || revision !== this.#revision) return false;
    this.#active = false;
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#active = false;
    this.#disposed = true;
    ++this.#revision;
  }
}

export type ReferenceRect = {
  readonly inline: number;
  readonly block: number;
  readonly inlineSize: number;
  readonly blockSize: number;
};

export class ReferenceGeometryRegistry {
  #revision = 0;
  #geometry = new Map<string, ReferenceRect>();

  begin(): number {
    return ++this.#revision;
  }

  commit(
    revision: number,
    entries: readonly { readonly identity: string; readonly rect: ReferenceRect }[],
  ): boolean {
    if (revision !== this.#revision) return false;
    const next = new Map<string, ReferenceRect>();
    for (const entry of entries) {
      if (next.has(entry.identity)) {
        throw new Error(`Duplicate geometry identity "${entry.identity}".`);
      }
      next.set(entry.identity, finiteRect(entry.rect, entry.identity));
    }
    this.#geometry = next;
    return true;
  }

  read(identity: string): ReferenceRect | undefined {
    return this.#geometry.get(identity);
  }
}

export type ReferenceMeasurementOrigin = "content" | "font" | "media" | "container";

export type ReferenceMeasuredExtent = {
  readonly identity: string;
  readonly inlineSize: number;
  readonly blockSize: number;
};

export type ReferenceMeasurementTransaction = {
  readonly accepted: true;
  readonly revision: number;
  readonly cause: "geometry";
  readonly origin: ReferenceMeasurementOrigin;
  readonly semanticChanged: false;
  readonly presenceChanged: false;
  readonly changes: readonly ReferenceMeasuredExtent[];
};

export class ReferenceMeasurementCoordinator {
  #revision = 0;
  #measurements = new Map<string, ReferenceMeasuredExtent>();
  #disposed = false;

  begin(origin: ReferenceMeasurementOrigin): {
    readonly revision: number;
    readonly origin: ReferenceMeasurementOrigin;
  } {
    if (this.#disposed) throw new Error("Measurement coordinator is disposed.");
    return { revision: ++this.#revision, origin };
  }

  commit(
    transaction: { readonly revision: number; readonly origin: ReferenceMeasurementOrigin },
    entries: readonly ReferenceMeasuredExtent[],
  ): ReferenceMeasurementTransaction | { readonly accepted: false } {
    if (this.#disposed || transaction.revision !== this.#revision) return { accepted: false };
    const next = new Map<string, ReferenceMeasuredExtent>();
    for (const entry of entries) {
      if (!entry.identity || next.has(entry.identity)) {
        throw new Error(`Measurement identity "${entry.identity}" must be non-empty and unique.`);
      }
      const inlineSize = finite(entry.inlineSize, `${entry.identity} measured inline size`);
      const blockSize = finite(entry.blockSize, `${entry.identity} measured block size`);
      if (inlineSize <= 0 || blockSize <= 0) {
        throw new Error("Animated intrinsic measurements must have positive size.");
      }
      next.set(entry.identity, { identity: entry.identity, inlineSize, blockSize });
    }
    const changes = [...next.values()]
      .filter((entry) => {
        const previous = this.#measurements.get(entry.identity);
        return (
          !previous ||
          previous.inlineSize !== entry.inlineSize ||
          previous.blockSize !== entry.blockSize
        );
      })
      .sort((left, right) => left.identity.localeCompare(right.identity));
    this.#measurements = next;
    return {
      accepted: true,
      revision: transaction.revision,
      cause: "geometry",
      origin: transaction.origin,
      semanticChanged: false,
      presenceChanged: false,
      changes,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    ++this.#revision;
    this.#measurements.clear();
  }
}

export type ReferenceVirtualItem = {
  readonly key: string;
  readonly offset: number;
  readonly extent: number;
  readonly measured: boolean;
};

export class ReferenceVirtualLayoutRegistry {
  #revision = 0;
  #pending?: {
    readonly revision: number;
    readonly keys: readonly string[];
    readonly estimate: number;
  };
  #measurements = new Map<string, number>();
  #items: readonly ReferenceVirtualItem[] = [];

  begin(keys: readonly string[], estimate: number): number {
    assertUniqueReferenceKeys(keys, "virtual");
    if (!Number.isFinite(estimate) || estimate <= 0) {
      throw new Error("Virtual estimate must be finite and positive.");
    }
    const revision = ++this.#revision;
    this.#pending = { revision, keys: [...keys], estimate };
    return revision;
  }

  commit(
    revision: number,
    entries: readonly { readonly key: string; readonly extent: number }[],
  ): boolean {
    if (revision !== this.#revision || this.#pending?.revision !== revision) return false;
    const nextMeasurements = new Map<string, number>();
    const allowed = new Set(this.#pending.keys);
    for (const entry of entries) {
      if (!allowed.has(entry.key))
        throw new Error(`Unknown virtual measurement key "${entry.key}".`);
      if (nextMeasurements.has(entry.key)) {
        throw new Error(`Duplicate virtual measurement key "${entry.key}".`);
      }
      if (!Number.isFinite(entry.extent) || entry.extent <= 0) {
        throw new Error(`Virtual extent for "${entry.key}" must be finite and positive.`);
      }
      nextMeasurements.set(entry.key, entry.extent);
    }
    for (const key of this.#pending.keys) {
      if (!nextMeasurements.has(key) && this.#measurements.has(key)) {
        nextMeasurements.set(key, this.#measurements.get(key)!);
      }
    }
    let offset = 0;
    this.#items = this.#pending.keys.map((key) => {
      const measurement = nextMeasurements.get(key);
      const extent = measurement ?? this.#pending!.estimate;
      const item = { key, offset, extent, measured: measurement !== undefined };
      offset += extent;
      return item;
    });
    this.#measurements = nextMeasurements;
    this.#pending = undefined;
    return true;
  }

  get items(): readonly ReferenceVirtualItem[] {
    return this.#items;
  }

  get extent(): number {
    return this.#items.reduce((total, item) => total + item.extent, 0);
  }
}

function finiteRect(rect: ReferenceRect, identity: string): ReferenceRect {
  return {
    inline: finite(rect.inline, `${identity} inline position`),
    block: finite(rect.block, `${identity} block position`),
    inlineSize: finite(rect.inlineSize, `${identity} inline size`),
    blockSize: finite(rect.blockSize, `${identity} block size`),
  };
}

export type ReferenceSharedIdentityEntry = {
  readonly identity: string;
  readonly side: "source" | "destination";
  readonly node: string;
};

export type ReferenceSharedIdentityPair = {
  readonly identity: string;
  readonly source: string;
  readonly destination: string;
};

export function resolveReferenceSharedIdentities(
  entries: readonly ReferenceSharedIdentityEntry[],
): readonly ReferenceSharedIdentityPair[] {
  const identities = new Map<
    string,
    { source?: ReferenceSharedIdentityEntry; destination?: ReferenceSharedIdentityEntry }
  >();

  for (const entry of entries) {
    const identity = identities.get(entry.identity) ?? {};
    const existing = identity[entry.side];
    if (existing) {
      throw new Error(
        `Shared identity "${entry.identity}" has two ${entry.side} nodes: "${existing.node}" and "${entry.node}".`,
      );
    }
    identity[entry.side] = entry;
    identities.set(entry.identity, identity);
  }

  return [...identities]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([identity, pair]) =>
      pair.source && pair.destination
        ? [{ identity, source: pair.source.node, destination: pair.destination.node }]
        : [],
    );
}

export type ReferenceTransitionPolicy = {
  readonly target: string;
  readonly policy: string;
};

export type ReferenceTransitionTransaction = {
  readonly targets: readonly string[];
  readonly policies: readonly ReferenceTransitionPolicy[];
};

export function resolveReferenceTransitionTransaction(
  targets: readonly string[],
  policies: readonly ReferenceTransitionPolicy[],
): ReferenceTransitionTransaction {
  const uniqueTargets = [...new Set(targets)].sort();
  if (uniqueTargets.length !== targets.length) {
    throw new Error("A transition transaction contains the same target more than once.");
  }

  const seenPolicies = new Set<string>();
  for (const entry of policies) {
    if (!uniqueTargets.includes(entry.target)) {
      throw new Error(`Transition policy references unknown target "${entry.target}".`);
    }
    if (seenPolicies.has(entry.target)) {
      throw new Error(`Target "${entry.target}" has more than one transition policy.`);
    }
    seenPolicies.add(entry.target);
  }

  return {
    targets: uniqueTargets,
    policies: [...policies].sort((left, right) => left.target.localeCompare(right.target)),
  };
}

export type ReferenceTransitionKind = "instant" | "timing" | "spring" | "layout";

export type ReferenceTransitionDescriptor = {
  readonly name: string;
  readonly kind: ReferenceTransitionKind;
  readonly valueType: string;
};

export type ReferenceTransitionHandoff = {
  readonly from: number;
  readonly velocity: number;
  readonly to: number;
  readonly strategy: "settle" | "retarget" | "replace" | "project";
  readonly cancelPrevious: boolean;
};

export function resolveReferenceTransitionHandoff(options: {
  readonly current: number;
  readonly velocity: number;
  readonly target: number;
  readonly source: "direct" | "transition" | "none";
  readonly previous?: ReferenceTransitionDescriptor;
  readonly next: ReferenceTransitionDescriptor;
  readonly reducedMotion: boolean;
}): ReferenceTransitionHandoff {
  const current = finite(options.current, "handoff current value");
  const velocity = finite(options.velocity, "handoff velocity");
  const target = finite(options.target, "handoff target value");
  if (options.previous && options.previous.valueType !== options.next.valueType) {
    throw new Error(
      `Transition policy changes value type from "${options.previous.valueType}" to "${options.next.valueType}".`,
    );
  }
  const cancelPrevious = options.previous !== undefined;
  if (options.reducedMotion || options.next.kind === "instant") {
    return { from: target, velocity: 0, to: target, strategy: "settle", cancelPrevious };
  }
  if (options.next.kind === "layout") {
    return { from: current, velocity: 0, to: target, strategy: "project", cancelPrevious };
  }
  const preservesVelocity =
    options.next.kind === "spring" &&
    (options.source === "direct" || options.previous?.kind === "spring");
  return {
    from: current,
    velocity: preservesVelocity ? velocity : 0,
    to: target,
    strategy: preservesVelocity ? "retarget" : "replace",
    cancelPrevious,
  };
}

export type ReferenceTransitionBatchEntry = Parameters<
  typeof resolveReferenceTransitionHandoff
>[0] & { readonly targetIdentity: string };

export function resolveReferenceTransitionBatch(
  entries: readonly ReferenceTransitionBatchEntry[],
  transaction: { readonly revision: number; readonly epoch: number },
): readonly {
  readonly targetIdentity: string;
  readonly revision: number;
  readonly epoch: number;
  readonly handoff: ReferenceTransitionHandoff;
}[] {
  if (!Number.isSafeInteger(transaction.revision) || transaction.revision < 0) {
    throw new Error("Transition transaction revision must be a non-negative safe integer.");
  }
  finite(transaction.epoch, "transition transaction epoch");
  const identities = entries.map((entry) => entry.targetIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new Error("A transition batch contains the same target more than once.");
  }
  for (const identity of identities) {
    if (!identity) throw new Error("Transition batch target identity cannot be empty.");
  }
  return [...entries]
    .sort((left, right) => left.targetIdentity.localeCompare(right.targetIdentity))
    .map(({ targetIdentity, ...options }) => ({
      targetIdentity,
      revision: transaction.revision,
      epoch: transaction.epoch,
      handoff: resolveReferenceTransitionHandoff(options),
    }));
}

export type ReferenceTransitionCause =
  | "semantic"
  | "preset"
  | "theme"
  | "environment"
  | "geometry"
  | "reducedMotion";

export type ReferenceTransitionChannelState = {
  readonly target: number;
  readonly policy: ReferenceTransitionDescriptor;
  readonly active: boolean;
  readonly reducedMotion: boolean;
};

export function resolveReferenceTransitionUpdate(options: {
  readonly previous: Readonly<Record<string, ReferenceTransitionChannelState>>;
  readonly next: Readonly<Record<string, ReferenceTransitionChannelState>>;
  readonly presented: Readonly<
    Record<string, { readonly value: number; readonly velocity: number }>
  >;
  readonly transaction: {
    readonly cause: ReferenceTransitionCause;
    readonly revision: number;
    readonly epoch: number;
  };
}): {
  readonly cause: ReferenceTransitionCause;
  readonly revision: number;
  readonly epoch: number;
  readonly changes: readonly {
    readonly targetIdentity: string;
    readonly targetChanged: boolean;
    readonly policyChanged: boolean;
    readonly reducedMotionChanged: boolean;
    readonly handoff?: ReferenceTransitionHandoff;
  }[];
} {
  if (!Number.isSafeInteger(options.transaction.revision) || options.transaction.revision < 0) {
    throw new Error("Transition update revision must be a non-negative safe integer.");
  }
  finite(options.transaction.epoch, "transition update epoch");
  const previousNames = Object.keys(options.previous).sort();
  const nextNames = Object.keys(options.next).sort();
  if (previousNames.join("\0") !== nextNames.join("\0")) {
    throw new Error("Transition channel identity changes require explicit presence semantics.");
  }

  const validated = nextNames.map((targetIdentity) => {
    const previous = options.previous[targetIdentity]!;
    const next = options.next[targetIdentity]!;
    const presented = options.presented[targetIdentity];
    if (!targetIdentity) throw new Error("Transition update target identity cannot be empty.");
    if (!presented)
      throw new Error(`Transition update is missing presented target "${targetIdentity}".`);
    finite(previous.target, `previous target "${targetIdentity}"`);
    finite(next.target, `next target "${targetIdentity}"`);
    finite(presented.value, `presented value "${targetIdentity}"`);
    finite(presented.velocity, `presented velocity "${targetIdentity}"`);
    if (previous.policy.valueType !== next.policy.valueType) {
      throw new Error(
        `Transition target "${targetIdentity}" changes value type from "${previous.policy.valueType}" to "${next.policy.valueType}".`,
      );
    }
    const targetChanged = !Object.is(previous.target, next.target);
    const policyChanged =
      previous.policy.name !== next.policy.name || previous.policy.kind !== next.policy.kind;
    const reducedMotionChanged = previous.reducedMotion !== next.reducedMotion;
    return {
      targetIdentity,
      previous,
      next,
      presented,
      targetChanged,
      policyChanged,
      reducedMotionChanged,
    };
  });

  const changes = validated
    .filter(
      ({ targetChanged, policyChanged, reducedMotionChanged }) =>
        targetChanged || policyChanged || reducedMotionChanged,
    )
    .map((change) => {
      const shouldMove =
        change.targetChanged ||
        (change.previous.active && change.policyChanged) ||
        (change.previous.active && !change.previous.reducedMotion && change.next.reducedMotion);
      return {
        targetIdentity: change.targetIdentity,
        targetChanged: change.targetChanged,
        policyChanged: change.policyChanged,
        reducedMotionChanged: change.reducedMotionChanged,
        ...(shouldMove
          ? {
              handoff: resolveReferenceTransitionHandoff({
                current: change.presented.value,
                velocity: change.presented.velocity,
                target: change.next.target,
                source: change.previous.active ? "transition" : "none",
                ...(change.previous.active ? { previous: change.previous.policy } : {}),
                next: change.next.policy,
                reducedMotion: change.next.reducedMotion,
              }),
            }
          : {}),
      };
    });

  return { ...options.transaction, changes };
}

export type ReferenceDimension = "scalar" | "length" | "angle" | "time";

export type ReferenceQuantity = {
  readonly dimension: ReferenceDimension;
  readonly value: number;
};

export type ReferenceExpressionValue = boolean | string | ReferenceQuantity;

export type ReferenceExpression =
  | { readonly kind: "literal"; readonly value: ReferenceExpressionValue }
  | { readonly kind: "read"; readonly path: string }
  | {
      readonly kind: "equal";
      readonly left: ReferenceExpression;
      readonly right: ReferenceExpression;
    }
  | {
      readonly kind: "and";
      readonly left: ReferenceExpression;
      readonly right: ReferenceExpression;
    }
  | {
      readonly kind: "or";
      readonly left: ReferenceExpression;
      readonly right: ReferenceExpression;
    }
  | { readonly kind: "not"; readonly value: ReferenceExpression }
  | {
      readonly kind: "choose";
      readonly condition: ReferenceExpression;
      readonly whenTrue: ReferenceExpression;
      readonly whenFalse: ReferenceExpression;
    }
  | {
      readonly kind: "add";
      readonly left: ReferenceExpression;
      readonly right: ReferenceExpression;
    }
  | {
      readonly kind: "scale";
      readonly value: ReferenceExpression;
      readonly factor: ReferenceExpression;
    }
  | {
      readonly kind: "compare";
      readonly relation: "less" | "lessOrEqual" | "greater" | "greaterOrEqual";
      readonly left: ReferenceExpression;
      readonly right: ReferenceExpression;
    }
  | {
      readonly kind: "clamp";
      readonly value: ReferenceExpression;
      readonly minimum: ReferenceExpression;
      readonly maximum: ReferenceExpression;
    }
  | {
      readonly kind: "interpolate";
      readonly input: ReferenceExpression;
      readonly inputRange: readonly [number, number];
      readonly outputRange: readonly [ReferenceQuantity, ReferenceQuantity];
      readonly clamp: boolean;
    };

export type ReferenceExpressionResult = {
  readonly value: ReferenceExpressionValue;
  readonly dependencies: readonly string[];
};

export function evaluateReferenceExpression(
  expression: ReferenceExpression,
  scope: Readonly<Record<string, ReferenceExpressionValue>>,
): ReferenceExpressionResult {
  const dependencies = new Set<string>();

  const evaluate = (current: ReferenceExpression): ReferenceExpressionValue => {
    switch (current.kind) {
      case "literal":
        return current.value;
      case "read": {
        if (!Object.hasOwn(scope, current.path)) {
          throw new Error(`Unknown expression dependency "${current.path}".`);
        }
        dependencies.add(current.path);
        return scope[current.path]!;
      }
      case "equal": {
        const left = evaluate(current.left);
        const right = evaluate(current.right);
        assertSameReferenceValueType(left, right, "equality");
        if (isReferenceQuantity(left) && isReferenceQuantity(right)) {
          return left.value === right.value;
        }
        return left === right;
      }
      case "and": {
        const left = expectReferenceBoolean(evaluate(current.left), "and left operand");
        return left ? expectReferenceBoolean(evaluate(current.right), "and right operand") : false;
      }
      case "or": {
        const left = expectReferenceBoolean(evaluate(current.left), "or left operand");
        return left ? true : expectReferenceBoolean(evaluate(current.right), "or right operand");
      }
      case "not":
        return !expectReferenceBoolean(evaluate(current.value), "not operand");
      case "choose":
        return expectReferenceBoolean(evaluate(current.condition), "choose condition")
          ? evaluate(current.whenTrue)
          : evaluate(current.whenFalse);
      case "add": {
        const left = expectReferenceQuantity(evaluate(current.left), "add left operand");
        const right = expectReferenceQuantity(evaluate(current.right), "add right operand");
        assertSameReferenceValueType(left, right, "addition");
        return { dimension: left.dimension, value: left.value + right.value };
      }
      case "scale": {
        const value = expectReferenceQuantity(evaluate(current.value), "scale value");
        const factor = expectReferenceQuantity(evaluate(current.factor), "scale factor");
        if (factor.dimension !== "scalar") {
          throw new TypeError(`Scale factor must be scalar, received "${factor.dimension}".`);
        }
        return { dimension: value.dimension, value: value.value * factor.value };
      }
      case "compare": {
        const left = expectReferenceQuantity(evaluate(current.left), "comparison left operand");
        const right = expectReferenceQuantity(evaluate(current.right), "comparison right operand");
        assertSameReferenceValueType(left, right, "comparison");
        if (current.relation === "less") return left.value < right.value;
        if (current.relation === "lessOrEqual") return left.value <= right.value;
        if (current.relation === "greater") return left.value > right.value;
        return left.value >= right.value;
      }
      case "clamp": {
        const value = expectReferenceQuantity(evaluate(current.value), "clamp value");
        const minimum = expectReferenceQuantity(evaluate(current.minimum), "clamp minimum");
        const maximum = expectReferenceQuantity(evaluate(current.maximum), "clamp maximum");
        assertSameReferenceValueType(value, minimum, "clamp minimum");
        assertSameReferenceValueType(value, maximum, "clamp maximum");
        if (minimum.value > maximum.value) throw new RangeError("Clamp bounds are reversed.");
        return {
          dimension: value.dimension,
          value: Math.min(maximum.value, Math.max(minimum.value, value.value)),
        };
      }
      case "interpolate": {
        const input = expectReferenceQuantity(evaluate(current.input), "interpolation input");
        if (input.dimension !== "scalar") {
          throw new TypeError(`Interpolation input must be scalar, received "${input.dimension}".`);
        }
        const [inputStart, inputEnd] = current.inputRange;
        if (inputStart === inputEnd) {
          throw new RangeError("Interpolation input range must have distinct endpoints.");
        }
        const [outputStart, outputEnd] = current.outputRange;
        assertSameReferenceValueType(outputStart, outputEnd, "interpolation output");
        const rawProgress = (input.value - inputStart) / (inputEnd - inputStart);
        const progress = current.clamp ? Math.min(1, Math.max(0, rawProgress)) : rawProgress;
        return {
          dimension: outputStart.dimension,
          value: outputStart.value + (outputEnd.value - outputStart.value) * progress,
        };
      }
    }
  };

  return { value: evaluate(expression), dependencies: [...dependencies].sort() };
}

function isReferenceQuantity(value: ReferenceExpressionValue): value is ReferenceQuantity {
  return typeof value === "object";
}

function expectReferenceBoolean(value: ReferenceExpressionValue, owner: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${owner} must be boolean, received "${referenceValueType(value)}".`);
  }
  return value;
}

function expectReferenceQuantity(
  value: ReferenceExpressionValue,
  owner: string,
): ReferenceQuantity {
  if (!isReferenceQuantity(value)) {
    throw new TypeError(`${owner} must be a quantity, received "${referenceValueType(value)}".`);
  }
  return { dimension: value.dimension, value: finite(value.value, `${owner} value`) };
}

function assertSameReferenceValueType(
  left: ReferenceExpressionValue,
  right: ReferenceExpressionValue,
  owner: string,
): void {
  const leftType = referenceValueType(left);
  const rightType = referenceValueType(right);
  if (leftType !== rightType) {
    throw new TypeError(
      `${owner} requires equal types, received "${leftType}" and "${rightType}".`,
    );
  }
}

function referenceValueType(value: ReferenceExpressionValue): string {
  return isReferenceQuantity(value) ? value.dimension : typeof value;
}

export function resolveReferenceTokenModes(
  definitions: Readonly<Record<string, ReferenceToken>>,
  modes: Readonly<Record<string, Readonly<Record<string, ReferenceToken["value"]>>>>,
): Readonly<Record<string, Readonly<Record<string, ResolvedReferenceToken>>>> {
  const result: Record<string, Readonly<Record<string, ResolvedReferenceToken>>> = {
    default: resolveReferenceTokens(definitions),
  };

  for (const mode of Object.keys(modes).sort()) {
    const overrides = modes[mode]!;
    const unknown = Object.keys(overrides).filter((name) => !definitions[name]);
    if (unknown.length) {
      throw new Error(`Token mode "${mode}" overrides unknown token "${unknown.sort()[0]}".`);
    }
    const merged = Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => [
        name,
        Object.hasOwn(overrides, name)
          ? { type: definition.type, value: overrides[name]! }
          : definition,
      ]),
    );
    result[mode] = resolveReferenceTokens(merged);
  }

  return result;
}

export type ReferenceKeyReconciliation = {
  readonly retained: readonly string[];
  readonly entered: readonly string[];
  readonly exited: readonly string[];
  readonly moved: readonly { readonly key: string; readonly from: number; readonly to: number }[];
};

export function reconcileReferenceKeys(
  previous: readonly string[],
  next: readonly string[],
): ReferenceKeyReconciliation {
  assertUniqueReferenceKeys(previous, "previous");
  assertUniqueReferenceKeys(next, "next");
  const previousIndex = new Map(previous.map((key, index) => [key, index]));
  const nextIndex = new Map(next.map((key, index) => [key, index]));
  const retained = next.filter((key) => previousIndex.has(key));
  return {
    retained,
    entered: next.filter((key) => !previousIndex.has(key)),
    exited: previous.filter((key) => !nextIndex.has(key)),
    moved: retained.flatMap((key) => {
      const from = previousIndex.get(key)!;
      const to = nextIndex.get(key)!;
      return from === to ? [] : [{ key, from, to }];
    }),
  };
}

function assertUniqueReferenceKeys(keys: readonly string[], owner: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`Duplicate ${owner} collection key "${key}".`);
    seen.add(key);
  }
}

export type ReferenceSpring = {
  readonly from: number;
  readonly to: number;
  readonly velocity: number;
  readonly mass: number;
  readonly stiffness: number;
  readonly damping: number;
};

export type ReferenceSpringSample = {
  readonly value: number;
  readonly velocity: number;
};

export function sampleReferenceSpring(
  spring: ReferenceSpring,
  elapsedSeconds: number,
): ReferenceSpringSample {
  const time = finite(elapsedSeconds, "spring elapsed time");
  if (time < 0) throw new RangeError("Spring elapsed time cannot be negative.");
  const mass = positiveFinite(spring.mass, "spring mass");
  const stiffness = positiveFinite(spring.stiffness, "spring stiffness");
  const damping = positiveFinite(spring.damping, "spring damping", true);
  const from = finite(spring.from, "spring origin");
  const to = finite(spring.to, "spring target");
  const initialVelocity = finite(spring.velocity, "spring velocity");
  if (time === 0) return { value: from, velocity: initialVelocity };
  const displacement = from - to;
  const omega = Math.sqrt(stiffness / mass);
  const ratio = damping / (2 * Math.sqrt(stiffness * mass));

  let offset: number;
  let velocity: number;
  if (ratio < 1 - 1e-9) {
    const damped = omega * Math.sqrt(1 - ratio * ratio);
    const a = displacement;
    const b = (initialVelocity + ratio * omega * displacement) / damped;
    const envelope = Math.exp(-ratio * omega * time);
    const cos = Math.cos(damped * time);
    const sin = Math.sin(damped * time);
    offset = envelope * (a * cos + b * sin);
    velocity = envelope * (-ratio * omega * (a * cos + b * sin) + damped * (-a * sin + b * cos));
  } else if (ratio <= 1 + 1e-9) {
    const b = initialVelocity + omega * displacement;
    const envelope = Math.exp(-omega * time);
    offset = envelope * (displacement + b * time);
    velocity = envelope * (b - omega * (displacement + b * time));
  } else {
    const root = omega * Math.sqrt(ratio * ratio - 1);
    const first = -ratio * omega + root;
    const second = -ratio * omega - root;
    const firstWeight = (initialVelocity - second * displacement) / (first - second);
    const secondWeight = displacement - firstWeight;
    const firstTerm = firstWeight * Math.exp(first * time);
    const secondTerm = secondWeight * Math.exp(second * time);
    offset = firstTerm + secondTerm;
    velocity = first * firstTerm + second * secondTerm;
  }

  return { value: to + offset, velocity };
}

function positiveFinite(value: number, name: string, allowZero = false): number {
  const result = finite(value, name);
  if (allowZero ? result < 0 : result <= 0) {
    throw new RangeError(`${name} must be ${allowZero ? "non-negative" : "positive"}.`);
  }
  return result;
}

export type ReferenceDerivedMapping = {
  readonly target: string;
  readonly scale: number;
  readonly offset: number;
};

export function deriveReferenceChannels(
  source: string,
  value: number,
  mappings: readonly ReferenceDerivedMapping[],
): Readonly<Record<string, number>> {
  const sourceValue = finite(value, `derived source "${source}"`);
  const targets: ReferenceTargetContribution[] = mappings.map((mapping) => ({
    identity: mapping.target,
    property: "value",
    source,
    value:
      sourceValue * finite(mapping.scale, `${mapping.target} scale`) +
      finite(mapping.offset, `${mapping.target} offset`),
  }));
  const resolved = resolveReferenceTargets(targets);
  return Object.fromEntries(
    Object.entries(resolved).map(([key, target]) => [key.slice(0, -":value".length), target.value]),
  ) as Readonly<Record<string, number>>;
}

export type ReferenceProjection = {
  readonly translateInline: number;
  readonly translateBlock: number;
  readonly scaleInline: number;
  readonly scaleBlock: number;
};

export function projectReferenceGeometry(
  previous: ReferenceRect,
  next: ReferenceRect,
): ReferenceProjection {
  if (previous.inlineSize <= 0 || previous.blockSize <= 0) {
    throw new RangeError("Previous projection geometry must have positive size.");
  }
  if (next.inlineSize <= 0 || next.blockSize <= 0) {
    throw new RangeError("Next projection geometry must have positive size.");
  }
  return {
    translateInline: previous.inline - next.inline,
    translateBlock: previous.block - next.block,
    scaleInline: previous.inlineSize / next.inlineSize,
    scaleBlock: previous.blockSize / next.blockSize,
  };
}

export function resolveReferenceLayoutProjection(options: {
  readonly identity: string;
  readonly previousParent: string;
  readonly nextParent: string;
  readonly previous: ReferenceRect;
  readonly next: ReferenceRect;
}): {
  readonly identity: string;
  readonly parentChanged: boolean;
  readonly target: ReferenceRect;
  readonly projection: ReferenceProjection;
} {
  if (!options.identity || !options.previousParent || !options.nextParent) {
    throw new Error("Layout projection identities cannot be empty.");
  }
  return {
    identity: options.identity,
    parentChanged: options.previousParent !== options.nextParent,
    target: finiteRect(options.next, options.identity),
    projection: projectReferenceGeometry(options.previous, options.next),
  };
}

export type ReferenceLayoutVelocity = {
  readonly inline: number;
  readonly block: number;
  readonly logInlineSize: number;
  readonly logBlockSize: number;
};

export function resolveReferenceLayoutTransition(options: {
  readonly identity: string;
  readonly previousParent: string;
  readonly nextParent: string;
  readonly presented: ReferenceRect;
  readonly velocity: ReferenceLayoutVelocity;
  readonly target: ReferenceRect;
  readonly driver: "instant" | "timing" | "spring";
  readonly reducedMotion: boolean;
}): {
  readonly identity: string;
  readonly parentChanged: boolean;
  readonly target: ReferenceRect;
  readonly from: ReferenceRect;
  readonly velocity: ReferenceLayoutVelocity;
  readonly projection: ReferenceProjection;
  readonly strategy: "settle" | "replace" | "retarget";
} {
  if (!options.identity || !options.previousParent || !options.nextParent) {
    throw new Error("Layout transition identities cannot be empty.");
  }
  const presented = finiteRect(options.presented, `${options.identity} presented geometry`);
  const target = finiteRect(options.target, `${options.identity} target geometry`);
  if (
    presented.inlineSize <= 0 ||
    presented.blockSize <= 0 ||
    target.inlineSize <= 0 ||
    target.blockSize <= 0
  ) {
    throw new Error("Layout transition geometry must have positive size.");
  }
  const velocity = {
    inline: finite(options.velocity.inline, "layout inline velocity"),
    block: finite(options.velocity.block, "layout block velocity"),
    logInlineSize: finite(options.velocity.logInlineSize, "layout inline-size velocity"),
    logBlockSize: finite(options.velocity.logBlockSize, "layout block-size velocity"),
  };
  if (options.reducedMotion || options.driver === "instant") {
    return {
      identity: options.identity,
      parentChanged: options.previousParent !== options.nextParent,
      target,
      from: target,
      velocity: { inline: 0, block: 0, logInlineSize: 0, logBlockSize: 0 },
      projection: { translateInline: 0, translateBlock: 0, scaleInline: 1, scaleBlock: 1 },
      strategy: "settle",
    };
  }
  return {
    identity: options.identity,
    parentChanged: options.previousParent !== options.nextParent,
    target,
    from: presented,
    velocity:
      options.driver === "spring"
        ? velocity
        : { inline: 0, block: 0, logInlineSize: 0, logBlockSize: 0 },
    projection: projectReferenceGeometry(presented, target),
    strategy: options.driver === "spring" ? "retarget" : "replace",
  };
}

export type ReferencePathCommand =
  | { readonly kind: "move" | "line"; readonly inline: number; readonly block: number }
  | {
      readonly kind: "curve";
      readonly control1: { readonly inline: number; readonly block: number };
      readonly control2: { readonly inline: number; readonly block: number };
      readonly end: { readonly inline: number; readonly block: number };
    }
  | { readonly kind: "close" };

export type ReferenceShape =
  | {
      readonly kind: "rectangle";
      readonly corners: {
        readonly startStart: ReferenceCorner;
        readonly startEnd: ReferenceCorner;
        readonly endStart: ReferenceCorner;
        readonly endEnd: ReferenceCorner;
      };
    }
  | { readonly kind: "capsule" | "ellipse" }
  | {
      readonly kind: "path";
      readonly viewBox: { readonly inlineSize: number; readonly blockSize: number };
      readonly commands: readonly ReferencePathCommand[];
      readonly fillRule: "nonzero" | "even-odd";
    };

export type ReferenceCorner = {
  readonly radius: { readonly dimension: "length"; readonly value: number };
  readonly smoothing: number;
};

export function interpolateReferenceShape(
  from: ReferenceShape,
  to: ReferenceShape,
  progress: number,
): ReferenceShape {
  if (!Number.isFinite(progress)) throw new Error("Shape progress must be finite.");
  if (from.kind !== to.kind) throw new Error("Shape interpolation requires matching kinds.");
  const interpolate = (left: number, right: number) => left + (right - left) * progress;
  if (from.kind === "rectangle" && to.kind === "rectangle") {
    const corner = (left: ReferenceCorner, right: ReferenceCorner): ReferenceCorner => ({
      radius: {
        dimension: "length",
        value: interpolate(left.radius.value, right.radius.value),
      },
      smoothing: interpolate(left.smoothing, right.smoothing),
    });
    return {
      kind: "rectangle",
      corners: {
        startStart: corner(from.corners.startStart, to.corners.startStart),
        startEnd: corner(from.corners.startEnd, to.corners.startEnd),
        endStart: corner(from.corners.endStart, to.corners.endStart),
        endEnd: corner(from.corners.endEnd, to.corners.endEnd),
      },
    };
  }
  if (from.kind === "capsule" || from.kind === "ellipse") return from;
  const pathFrom = from as Extract<ReferenceShape, { readonly kind: "path" }>;
  const pathTo = to as Extract<ReferenceShape, { readonly kind: "path" }>;
  if (
    pathFrom.fillRule !== pathTo.fillRule ||
    pathFrom.viewBox.inlineSize !== pathTo.viewBox.inlineSize ||
    pathFrom.viewBox.blockSize !== pathTo.viewBox.blockSize
  ) {
    throw new Error("Path interpolation requires matching coordinate and fill semantics.");
  }
  resolveReferencePathMorph(pathFrom.commands, pathTo.commands);
  const point = (
    left: { readonly inline: number; readonly block: number },
    right: { readonly inline: number; readonly block: number },
  ) => ({
    inline: interpolate(left.inline, right.inline),
    block: interpolate(left.block, right.block),
  });
  const commands = pathFrom.commands.map((command, index): ReferencePathCommand => {
    const destination = pathTo.commands[index]!;
    if (command.kind === "close") return command;
    if (command.kind === "move" || command.kind === "line") {
      return { kind: command.kind, ...point(command, destination as typeof command) };
    }
    const sourceCurve = command as Extract<ReferencePathCommand, { readonly kind: "curve" }>;
    const curve = destination as Extract<ReferencePathCommand, { readonly kind: "curve" }>;
    return {
      kind: "curve",
      control1: point(sourceCurve.control1, curve.control1),
      control2: point(sourceCurve.control2, curve.control2),
      end: point(sourceCurve.end, curve.end),
    };
  });
  return { kind: "path", viewBox: pathFrom.viewBox, fillRule: pathFrom.fillRule, commands };
}

export function resolveReferencePathMorph(
  source: readonly ReferencePathCommand[],
  destination: readonly ReferencePathCommand[],
): { readonly compatible: true; readonly commands: number } {
  if (source.length !== destination.length) {
    throw new Error(
      `Path morph command count changes from ${source.length} to ${destination.length}.`,
    );
  }
  for (const [index, command] of source.entries()) {
    if (command.kind !== destination[index]?.kind) {
      throw new Error(
        `Path morph command ${index} changes from "${command.kind}" to "${destination[index]?.kind ?? "missing"}".`,
      );
    }
  }
  return { compatible: true, commands: source.length };
}

export type ReferenceGestureRelation =
  | { readonly kind: "before"; readonly first: string; readonly second: string }
  | { readonly kind: "simultaneous"; readonly first: string; readonly second: string };

export function resolveReferenceGestureArbitration(
  candidates: readonly string[],
  relations: readonly ReferenceGestureRelation[],
): readonly string[] {
  assertUniqueReferenceKeys(candidates, "gesture candidate");
  const known = new Set(candidates);
  const simultaneous = new Set<string>();
  const precedence: ReferenceCompositionRelation[] = [];

  for (const relation of relations) {
    if (!known.has(relation.first)) {
      throw new Error(`Unknown gesture recognizer "${relation.first}".`);
    }
    if (!known.has(relation.second)) {
      throw new Error(`Unknown gesture recognizer "${relation.second}".`);
    }
    if (relation.kind === "simultaneous") {
      simultaneous.add(referencePairKey(relation.first, relation.second));
    } else {
      precedence.push({ below: relation.second, above: relation.first });
    }
  }

  const order = [
    ...resolveReferenceComposition(
      candidates.map((identity, documentOrder) => ({ identity, documentOrder })),
      precedence,
    ),
  ].reverse();
  const winners: string[] = [];
  for (const candidate of order) {
    if (winners.every((winner) => simultaneous.has(referencePairKey(candidate, winner)))) {
      winners.push(candidate);
      continue;
    }
    const orderedAgainstAll = winners.every((winner) =>
      hasReferencePrecedencePath(candidate, winner, precedence),
    );
    if (orderedAgainstAll) winners.splice(0, winners.length, candidate);
  }

  const unresolved = candidates.filter(
    (candidate) =>
      !winners.includes(candidate) &&
      winners.some(
        (winner) =>
          !simultaneous.has(referencePairKey(candidate, winner)) &&
          !hasReferencePrecedencePath(winner, candidate, precedence),
      ),
  );
  if (unresolved.length) {
    throw new Error(
      `Gesture conflict has no explicit relationship: ${[...winners, ...unresolved].sort().join(", ")}.`,
    );
  }
  return winners.sort();
}

function referencePairKey(left: string, right: string): string {
  return [left, right].sort().join("\0");
}

function hasReferencePrecedencePath(
  first: string,
  second: string,
  relations: readonly ReferenceCompositionRelation[],
): boolean {
  const next = new Map<string, string[]>();
  for (const relation of relations) {
    const higher = relation.above;
    const lower = relation.below;
    next.set(higher, [...(next.get(higher) ?? []), lower]);
  }
  const queue = [first];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === second) return true;
    for (const value of next.get(current) ?? []) {
      if (seen.has(value)) continue;
      seen.add(value);
      queue.push(value);
    }
  }
  return false;
}

export type ReferenceChartNodeKind = "atomic" | "compound" | "parallel" | "final";

export type ReferenceChartTransitionTopology = {
  readonly target?: string | readonly string[];
  readonly guard?: string;
  readonly update?: string;
  readonly commands?: readonly { readonly name: string; readonly input?: string }[];
};

export type ReferenceChartAlternative = {
  readonly targets: readonly string[];
  readonly guard?: string;
  readonly update?: string;
  readonly commands?: readonly { readonly name: string; readonly input?: string }[];
};

export type ReferenceChartTaskDefinition =
  | string
  | {
      readonly task: string;
      readonly done?:
        | string
        | ReferenceChartTransitionTopology
        | readonly (string | ReferenceChartTransitionTopology)[];
      readonly fail?:
        | string
        | ReferenceChartTransitionTopology
        | readonly (string | ReferenceChartTransitionTopology)[];
    };

export type ReferenceChartNodeDefinition = {
  readonly type?: ReferenceChartNodeKind;
  readonly initial?: string;
  readonly states?: Readonly<Record<string, ReferenceChartNodeDefinition>>;
  readonly on?: Readonly<
    Record<
      string,
      | string
      | ReferenceChartTransitionTopology
      | readonly (string | ReferenceChartTransitionTopology)[]
    >
  >;
  readonly tasks?: readonly ReferenceChartTaskDefinition[];
  readonly always?:
    | string
    | ReferenceChartTransitionTopology
    | readonly (string | ReferenceChartTransitionTopology)[];
  readonly done?:
    | string
    | ReferenceChartTransitionTopology
    | readonly (string | ReferenceChartTransitionTopology)[];
  readonly after?: readonly {
    readonly wait: number;
    readonly target?: string | readonly string[];
    readonly guard?: string;
  }[];
  readonly output?: unknown;
};

export type ReferenceChartDefinition = ReferenceChartNodeDefinition & {
  readonly states: Readonly<Record<string, ReferenceChartNodeDefinition>>;
};

export type ReferenceChartNodeTopology = {
  readonly path: string;
  readonly parent?: string;
  readonly kind: ReferenceChartNodeKind;
  readonly initial?: string;
  readonly children: readonly string[];
  readonly tasks: readonly string[];
  readonly taskResults: readonly {
    readonly task: string;
    readonly done: readonly ReferenceChartAlternative[];
    readonly fail: readonly ReferenceChartAlternative[];
  }[];
  readonly always: readonly ReferenceChartAlternative[];
  readonly events: readonly {
    readonly event: string;
    readonly alternatives: readonly ReferenceChartAlternative[];
  }[];
  readonly done: readonly ReferenceChartAlternative[];
  readonly delays: readonly ({ readonly wait: number } & ReferenceChartAlternative)[];
  readonly output?: unknown;
};

export type ReferenceChartTopology = {
  readonly kind: "compound" | "parallel";
  readonly initial?: string;
  readonly tasks: readonly string[];
  readonly taskResults: readonly {
    readonly task: string;
    readonly done: readonly ReferenceChartAlternative[];
    readonly fail: readonly ReferenceChartAlternative[];
  }[];
  readonly always: readonly ReferenceChartAlternative[];
  readonly events: readonly {
    readonly event: string;
    readonly alternatives: readonly ReferenceChartAlternative[];
  }[];
  readonly done: readonly ReferenceChartAlternative[];
  readonly delays: readonly ({ readonly wait: number } & ReferenceChartAlternative)[];
  readonly nodes: readonly ReferenceChartNodeTopology[];
};

export function normalizeReferenceChart(
  definition: ReferenceChartDefinition,
  declaredTasks: ReadonlySet<string> = new Set(),
  declaredCommands: ReadonlySet<string> = new Set(),
): ReferenceChartTopology {
  if (definition.type && definition.type !== "compound" && definition.type !== "parallel") {
    throw new Error(`Statechart root cannot be ${definition.type}.`);
  }
  const rootKind = definition.type === "parallel" ? "parallel" : "compound";
  const rootTaskDefinitions = referenceChartTasks("root", definition.tasks, declaredTasks);
  const rootTasks = rootTaskDefinitions.map((task) => task.task);
  const rootEvents = referenceChartEvents("root", definition.on);
  const rootAlways = referenceChartAlternatives("root", "always", definition.always);
  const rootDone = referenceChartAlternatives("root", "completion", definition.done);
  const rootDelays = referenceChartDelays("root", definition.after);
  const nodes = new Map<string, ReferenceChartNodeTopology>();
  const definitions = new Map<string, ReferenceChartNodeDefinition>();
  const visit = (
    states: Readonly<Record<string, ReferenceChartNodeDefinition>>,
    parent: string | undefined,
  ): void => {
    for (const name of Object.keys(states).sort()) {
      if (!name) throw new Error("State name cannot be empty.");
      const node = states[name]!;
      const path = parent ? `${parent}.${name}` : name;
      const childNames = Object.keys(node.states ?? {}).sort();
      const kind = referenceChartNodeKind(node, childNames.length > 0);
      const children = childNames.map((child) => `${path}.${child}`);
      validateReferenceChartNodeShape(path, node, kind, children);
      const taskResults = referenceChartTasks(path, node.tasks, declaredTasks);
      const tasks = taskResults.map((task) => task.task);
      const events = referenceChartEvents(path, node.on);
      const always = referenceChartAlternatives(path, "always", node.always);
      const done = referenceChartAlternatives(path, "completion", node.done);
      const delays = referenceChartDelays(path, node.after);
      nodes.set(path, {
        path,
        ...(parent ? { parent } : {}),
        kind,
        ...(node.initial ? { initial: node.initial } : {}),
        children,
        tasks,
        taskResults,
        always,
        events,
        done,
        delays,
        ...(node.output !== undefined ? { output: node.output } : {}),
      });
      definitions.set(path, node);
      if (node.states) visit(node.states, path);
    }
  };
  if (Object.keys(definition.states).length === 0) {
    throw new Error("A statechart needs at least one state.");
  }
  visit(definition.states, undefined);
  validateReferenceChartInitial("root", definition.initial, rootKind, [
    ...Object.keys(definition.states).sort(),
  ]);
  for (const event of rootEvents) {
    for (const alternative of event.alternatives) {
      validateReferenceChartAlternative(
        "root",
        alternative,
        nodes,
        rootKind,
        false,
        declaredCommands,
      );
    }
  }
  for (const alternative of rootAlways) {
    validateReferenceChartAlternative("root", alternative, nodes, rootKind, true, declaredCommands);
  }
  for (const alternative of rootDone) {
    validateReferenceChartAlternative("root", alternative, nodes, rootKind, true);
  }
  for (const task of rootTaskDefinitions) {
    for (const alternative of [...task.done, ...task.fail]) {
      validateReferenceChartAlternative(
        "root",
        alternative,
        nodes,
        rootKind,
        false,
        declaredCommands,
      );
    }
  }
  for (const delay of rootDelays) {
    validateReferenceChartAlternative("root", delay, nodes, rootKind, true, declaredCommands);
  }
  for (const node of nodes.values()) {
    for (const event of node.events) {
      for (const alternative of event.alternatives) {
        validateReferenceChartAlternative(
          node.path,
          alternative,
          nodes,
          rootKind,
          false,
          declaredCommands,
        );
      }
    }
    for (const alternative of node.always) {
      validateReferenceChartAlternative(
        node.path,
        alternative,
        nodes,
        rootKind,
        true,
        declaredCommands,
      );
    }
    for (const alternative of node.done) {
      validateReferenceChartAlternative(
        node.path,
        alternative,
        nodes,
        rootKind,
        true,
        declaredCommands,
      );
    }
    for (const task of node.taskResults) {
      for (const alternative of [...task.done, ...task.fail]) {
        validateReferenceChartAlternative(
          node.path,
          alternative,
          nodes,
          rootKind,
          false,
          declaredCommands,
        );
      }
    }
    for (const delay of node.delays) {
      validateReferenceChartAlternative(node.path, delay, nodes, rootKind, true, declaredCommands);
    }
  }
  return {
    kind: rootKind,
    ...(definition.initial ? { initial: definition.initial } : {}),
    tasks: rootTasks,
    taskResults: rootTaskDefinitions,
    always: rootAlways,
    events: rootEvents,
    done: rootDone,
    delays: rootDelays,
    nodes: [...nodes.values()],
  };
}

function referenceChartTasks(
  owner: string,
  definitions: readonly ReferenceChartTaskDefinition[] | undefined,
  declaredTasks: ReadonlySet<string>,
): readonly {
  readonly task: string;
  readonly done: readonly ReferenceChartAlternative[];
  readonly fail: readonly ReferenceChartAlternative[];
}[] {
  const tasks = [...(definitions ?? [])]
    .map((definition) =>
      typeof definition === "string"
        ? { task: definition, done: [], fail: [] }
        : {
            task: definition.task,
            done: referenceChartAlternatives(
              owner,
              `task "${definition.task}" done`,
              definition.done,
            ),
            fail: referenceChartAlternatives(
              owner,
              `task "${definition.task}" fail`,
              definition.fail,
            ),
          },
    )
    .sort((left, right) => left.task.localeCompare(right.task));
  assertUniqueReferenceKeys(
    tasks.map((task) => task.task),
    `task in state "${owner}"`,
  );
  for (const task of tasks) {
    if (!task.task) throw new Error(`State "${owner}" invokes an empty task name.`);
    if (!declaredTasks.has(task.task)) {
      throw new Error(
        owner === "root"
          ? `Statechart root invokes unknown task "${task.task}".`
          : `State "${owner}" invokes unknown task "${task.task}".`,
      );
    }
  }
  return tasks;
}

function referenceChartEvents(
  owner: string,
  events: ReferenceChartNodeDefinition["on"],
): readonly {
  readonly event: string;
  readonly alternatives: readonly ReferenceChartAlternative[];
}[] {
  return Object.entries(events ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([event, transitions]) => {
      if (!event) throw new Error(`State "${owner}" has an empty event name.`);
      const alternatives = referenceChartAlternatives(owner, `event "${event}"`, transitions);
      return { event, alternatives };
    });
}

function referenceChartAlternatives(
  owner: string,
  reason: string,
  transitions:
    | string
    | ReferenceChartTransitionTopology
    | readonly (string | ReferenceChartTransitionTopology)[]
    | undefined,
): readonly ReferenceChartAlternative[] {
  if (transitions === undefined) return [];
  const alternatives = Array.isArray(transitions) ? transitions : [transitions];
  return alternatives.map((transition, index) => {
    if (typeof transition === "string") return { targets: [transition] };
    if (transition.guard !== undefined && !transition.guard) {
      throw new Error(
        `State "${owner}" ${reason} alternative ${String(index)} has an empty guard.`,
      );
    }
    return {
      targets: referenceChartTargetList(transition.target),
      ...(transition.guard ? { guard: transition.guard } : {}),
      ...(transition.update ? { update: transition.update } : {}),
      ...(transition.commands?.length ? { commands: transition.commands } : {}),
    };
  });
}

function referenceChartDelays(
  owner: string,
  delays: ReferenceChartNodeDefinition["after"],
): readonly ({ readonly wait: number } & ReferenceChartAlternative)[] {
  return [...(delays ?? [])]
    .map((delay) => {
      if (!Number.isFinite(delay.wait) || delay.wait < 0) {
        throw new Error(`State "${owner}" has an invalid delay.`);
      }
      if (delay.guard !== undefined && !delay.guard) {
        throw new Error(`State "${owner}" has a delayed transition with an empty guard.`);
      }
      return {
        wait: delay.wait,
        targets: referenceChartTargetList(delay.target),
        ...(delay.guard ? { guard: delay.guard } : {}),
      };
    })
    .sort((left, right) => left.wait - right.wait);
}

function referenceChartNodeKind(
  node: ReferenceChartNodeDefinition,
  hasChildren: boolean,
): ReferenceChartNodeKind {
  return node.type ?? (hasChildren ? "compound" : "atomic");
}

function validateReferenceChartNodeShape(
  path: string,
  node: ReferenceChartNodeDefinition,
  kind: ReferenceChartNodeKind,
  children: readonly string[],
): void {
  if (kind === "atomic" || kind === "final") {
    if (children.length || node.initial) {
      throw new Error(`${kind} state "${path}" cannot own child states or an initial state.`);
    }
  } else if (children.length === 0) {
    throw new Error(`${kind} state "${path}" needs child states.`);
  }
  validateReferenceChartInitial(path, node.initial, kind, children);
  if (
    kind === "final" &&
    (Object.keys(node.on ?? {}).length ||
      (node.tasks?.length ?? 0) ||
      (node.after?.length ?? 0) ||
      node.always !== undefined ||
      node.done !== undefined)
  ) {
    throw new Error(`Final state "${path}" cannot own events, tasks, or delays.`);
  }
  if (kind !== "final" && node.output !== undefined) {
    throw new Error(`Only a final state can declare output; received "${path}".`);
  }
}

function validateReferenceChartInitial(
  owner: string,
  initial: string | undefined,
  kind: ReferenceChartNodeKind | "compound" | "parallel",
  children: readonly string[],
): void {
  if (kind === "compound") {
    if (!initial) throw new Error(`Compound state "${owner}" needs an initial direct child.`);
    if (!children.includes(initial)) {
      throw new Error(`Initial state "${initial}" is not a direct child of "${owner}".`);
    }
  } else if (initial !== undefined) {
    throw new Error(`${kind} state "${owner}" cannot declare an initial state.`);
  }
}

function referenceChartTargetList(
  target: string | readonly string[] | undefined,
): readonly string[] {
  if (target === undefined) return [];
  return typeof target === "string" ? [target] : [...target];
}

function validateReferenceChartAlternative(
  source: string,
  alternative: ReferenceChartAlternative,
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
  rootKind: "compound" | "parallel",
  requiresTarget = false,
  declaredCommands: ReadonlySet<string> = new Set(),
): void {
  if (requiresTarget && alternative.targets.length === 0) {
    throw new Error(`Transition from "${source}" requires a target.`);
  }
  if (alternative.update !== undefined && !alternative.update) {
    throw new Error(`Transition from "${source}" has an empty update resolver.`);
  }
  for (const command of alternative.commands ?? []) {
    if (!command.name) throw new Error(`Transition from "${source}" has an empty command name.`);
    if (!declaredCommands.has(command.name)) {
      throw new Error(`Transition from "${source}" requests unknown command "${command.name}".`);
    }
    if (command.input !== undefined && !command.input) {
      throw new Error(`Command "${command.name}" from "${source}" has an empty input resolver.`);
    }
  }
  validateReferenceChartTargets(source, alternative.targets, nodes, rootKind);
}

function validateReferenceChartTargets(
  source: string,
  targets: readonly string[],
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
  rootKind: "compound" | "parallel",
): void {
  assertUniqueReferenceKeys(targets, `transition target from "${source}"`);
  for (const target of targets) {
    if (!nodes.has(target)) {
      throw new Error(`Transition from "${source}" targets unknown state "${target}".`);
    }
  }
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex++) {
      const left = targets[leftIndex]!;
      const right = targets[rightIndex]!;
      if (
        left.startsWith(`${right}.`) ||
        right.startsWith(`${left}.`) ||
        referenceChartCommonOwnerKind(left, right, nodes, rootKind) !== "parallel"
      ) {
        throw new Error(
          `Transition from "${source}" has non-orthogonal targets "${left}" and "${right}".`,
        );
      }
    }
  }
}

function referenceChartCommonOwnerKind(
  left: string,
  right: string,
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
  rootKind: "compound" | "parallel",
): "compound" | "parallel" | ReferenceChartNodeKind {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const common: string[] = [];
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index++) {
    if (leftParts[index] !== rightParts[index]) break;
    common.push(leftParts[index]!);
  }
  if (common.length === 0) return rootKind;
  return nodes.get(common.join("."))?.kind ?? rootKind;
}

export function resolveReferenceChartInitial(topology: ReferenceChartTopology): readonly string[] {
  const nodes = new Map(topology.nodes.map((node) => [node.path, node]));
  const leaves =
    topology.kind === "parallel"
      ? topology.nodes
          .filter((node) => node.parent === undefined)
          .flatMap((node) => enterReferenceChartNode(node.path, nodes))
      : enterReferenceChartNode(topology.initial!, nodes);
  return [...new Set(leaves)].sort();
}

export function resolveReferenceChartEvent(
  topology: ReferenceChartTopology,
  active: readonly string[],
  event: string,
  guards: Readonly<Record<string, boolean>> = {},
): readonly string[] {
  const nodes = new Map(topology.nodes.map((node) => [node.path, node]));
  assertUniqueReferenceKeys(active, "active statechart leaf");
  for (const leaf of active) {
    const node = nodes.get(leaf);
    if (!node || (node.kind !== "atomic" && node.kind !== "final")) {
      throw new Error(`Active statechart leaf "${leaf}" is unavailable or not terminal.`);
    }
  }
  const selected = new Map<
    string,
    { readonly source: string; readonly alternatives: readonly ReferenceChartAlternative[] }
  >();
  for (const leaf of [...active].sort()) {
    let current: string | undefined = leaf;
    while (current !== undefined) {
      const node: ReferenceChartNodeTopology = nodes.get(current)!;
      const transition = node.events.find((candidate) => candidate.event === event);
      if (transition) {
        selected.set(current, { source: current, alternatives: transition.alternatives });
        break;
      }
      current = node.parent;
    }
  }
  if (selected.size === 0) {
    const root = topology.events.find((candidate) => candidate.event === event);
    if (root) selected.set("root", { source: "root", alternatives: root.alternatives });
  }
  let next: readonly string[] = [...active];
  for (const transition of [...selected.values()].sort((left, right) =>
    left.source.localeCompare(right.source),
  )) {
    const alternative = selectReferenceChartAlternative(transition.alternatives, guards);
    if (!alternative) continue;
    next = resolveReferenceChartTransition(topology, next, alternative, nodes);
  }
  return next;
}

function selectReferenceChartAlternative(
  alternatives: readonly ReferenceChartAlternative[],
  guards: Readonly<Record<string, boolean>>,
): ReferenceChartAlternative | undefined {
  return alternatives.find(
    (alternative) => alternative.guard === undefined || guards[alternative.guard] === true,
  );
}

function resolveReferenceChartTransition(
  topology: ReferenceChartTopology,
  active: readonly string[],
  alternative: ReferenceChartAlternative,
  nodes = new Map(topology.nodes.map((node) => [node.path, node])),
): readonly string[] {
  if (alternative.targets.length === 0) return active;
  const regions = new Set(
    alternative.targets.map((target) => referenceChartRegion(target, topology, nodes)),
  );
  const next = active.filter((leaf) =>
    [...regions].every((region) => region !== "root" && !isReferenceChartPathWithin(leaf, region)),
  );
  for (const target of alternative.targets) next.push(...enterReferenceChartNode(target, nodes));
  return [...new Set(next)].sort();
}

function enterReferenceChartNode(
  path: string,
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
): readonly string[] {
  const node = nodes.get(path);
  if (!node) throw new Error(`Cannot enter unknown state "${path}".`);
  if (node.kind === "atomic" || node.kind === "final") return [path];
  if (node.kind === "compound") return enterReferenceChartNode(node.initial!, nodes);
  return node.children.flatMap((child) => enterReferenceChartNode(child, nodes));
}

function referenceChartRegion(
  target: string,
  topology: ReferenceChartTopology,
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
): string {
  let current = target;
  let node = nodes.get(current)!;
  while (node.parent !== undefined) {
    const parent = nodes.get(node.parent)!;
    if (parent.kind === "parallel") return current;
    current = parent.path;
    node = parent;
  }
  return topology.kind === "parallel" ? current : "root";
}

function isReferenceChartPathWithin(path: string, owner: string): boolean {
  return path === owner || path.startsWith(`${owner}.`);
}

export type ReferenceChartCompletion = {
  readonly active: readonly string[];
  readonly complete: boolean;
  readonly completed: readonly string[];
  readonly outputs: readonly { readonly state: string; readonly value: unknown }[];
};

export function resolveReferenceChartCompletion(
  topology: ReferenceChartTopology,
  active: readonly string[],
  guards: Readonly<Record<string, boolean>> = {},
): ReferenceChartCompletion {
  const nodes = new Map(topology.nodes.map((node) => [node.path, node]));
  let next = [...active].sort();
  const outputs = new Map<string, unknown>();
  const seen = new Set<string>();

  for (let step = 0; step <= topology.nodes.length * 2 + 1; step++) {
    for (const leaf of next) {
      const node = nodes.get(leaf);
      if (node?.kind === "final" && node.output !== undefined && !outputs.has(leaf)) {
        outputs.set(leaf, node.output);
      }
    }
    const alwaysOwner = [...referenceChartActiveOwners(next)]
      .sort(
        (left, right) =>
          right.split(".").length - left.split(".").length || left.localeCompare(right),
      )
      .find((owner) => {
        const alternatives = owner === "root" ? topology.always : nodes.get(owner)!.always;
        return selectReferenceChartAlternative(alternatives, guards) !== undefined;
      });
    if (alwaysOwner) {
      const alternatives =
        alwaysOwner === "root" ? topology.always : nodes.get(alwaysOwner)!.always;
      const alternative = selectReferenceChartAlternative(alternatives, guards)!;
      const signature = `always\0${alwaysOwner}\0${next.join("\0")}\0${alternative.targets.join("\0")}`;
      if (seen.has(signature)) {
        throw new Error(`Statechart always transition from "${alwaysOwner}" does not stabilize.`);
      }
      seen.add(signature);
      next = [...resolveReferenceChartTransition(topology, next, alternative, nodes)];
      continue;
    }
    const completed = referenceChartCompletedOwners(topology, next, nodes);
    const candidate = [...completed]
      .sort(
        (left, right) =>
          right.split(".").length - left.split(".").length || left.localeCompare(right),
      )
      .find((owner) => {
        const alternatives = owner === "root" ? topology.done : nodes.get(owner)!.done;
        return selectReferenceChartAlternative(alternatives, guards) !== undefined;
      });
    if (!candidate) {
      return {
        active: next,
        complete: completed.includes("root"),
        completed,
        outputs: [...outputs].map(([state, value]) => ({ state, value })),
      };
    }
    const alternatives = candidate === "root" ? topology.done : nodes.get(candidate)!.done;
    const alternative = selectReferenceChartAlternative(alternatives, guards)!;
    const signature = `${candidate}\0${next.join("\0")}\0${alternative.targets.join("\0")}`;
    if (seen.has(signature)) {
      throw new Error(`Statechart completion transition from "${candidate}" does not stabilize.`);
    }
    seen.add(signature);
    next = [...resolveReferenceChartTransition(topology, next, alternative, nodes)];
  }
  throw new Error("Statechart completion exceeded its finite stabilization bound.");
}

function referenceChartCompletedOwners(
  topology: ReferenceChartTopology,
  active: readonly string[],
  nodes: ReadonlyMap<string, ReferenceChartNodeTopology>,
): readonly string[] {
  const complete = (path: string): boolean => {
    const node = nodes.get(path)!;
    if (node.kind === "final") return active.includes(path);
    if (node.kind === "atomic") return false;
    return node.kind === "parallel"
      ? node.children.every(complete)
      : node.children.some(
          (child) =>
            active.some((leaf) => isReferenceChartPathWithin(leaf, child)) && complete(child),
        );
  };
  const completed = topology.nodes
    .filter((node) => (node.kind === "compound" || node.kind === "parallel") && complete(node.path))
    .map((node) => node.path);
  const topLevel = topology.nodes.filter((node) => node.parent === undefined);
  const rootComplete =
    topology.kind === "parallel"
      ? topLevel.every((node) => complete(node.path))
      : topLevel.some(
          (node) =>
            active.some((leaf) => isReferenceChartPathWithin(leaf, node.path)) &&
            complete(node.path),
        );
  return [...completed, ...(rootComplete ? ["root"] : [])].sort();
}

type ReferenceScheduledDelay = {
  readonly owner: string;
  readonly index: number;
  readonly due: number;
  readonly alternative: ReferenceChartAlternative;
};

export class ReferenceChartRuntime {
  readonly #topology: ReferenceChartTopology;
  #active: readonly string[];
  #now = 0;
  #complete = false;
  #timers: ReferenceScheduledDelay[] = [];
  #taskRevision = 0;
  #tasks = new Map<
    string,
    { readonly owner: string; readonly task: string; readonly revision: number }
  >();
  #outputs: { readonly state: string; readonly value: unknown }[] = [];

  constructor(topology: ReferenceChartTopology, guards: Readonly<Record<string, boolean>> = {}) {
    this.#topology = topology;
    const settled = resolveReferenceChartCompletion(
      topology,
      resolveReferenceChartInitial(topology),
      guards,
    );
    this.#active = settled.active;
    this.#complete = settled.complete;
    this.#outputs.push(...settled.outputs);
    this.#scheduleEntered(new Set(), referenceChartActiveOwners(this.#active));
  }

  get snapshot(): Readonly<{
    now: number;
    active: readonly string[];
    complete: boolean;
  }> {
    return { now: this.#now, active: this.#active, complete: this.#complete };
  }

  get activeTasks(): readonly {
    readonly owner: string;
    readonly task: string;
    readonly revision: number;
  }[] {
    return [...this.#tasks.values()].sort(
      (left, right) => left.owner.localeCompare(right.owner) || left.task.localeCompare(right.task),
    );
  }

  send(event: string, guards: Readonly<Record<string, boolean>> = {}): void {
    const previousOwners = referenceChartActiveOwners(this.#active);
    const transitioned = resolveReferenceChartEvent(this.#topology, this.#active, event, guards);
    this.#settle(transitioned, guards, previousOwners);
  }

  advance(milliseconds: number, guards: Readonly<Record<string, boolean>> = {}): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error("Statechart clock advance must be finite and non-negative.");
    }
    const target = this.#now + milliseconds;
    while (true) {
      const timer = this.#timers
        .filter((entry) => entry.due <= target)
        .sort(
          (left, right) =>
            left.due - right.due ||
            left.owner.localeCompare(right.owner) ||
            left.index - right.index,
        )[0];
      if (!timer) break;
      this.#now = timer.due;
      this.#timers = this.#timers.filter((entry) => entry !== timer);
      if (!referenceChartActiveOwners(this.#active).has(timer.owner)) continue;
      if (!selectReferenceChartAlternative([timer.alternative], guards)) continue;
      const previousOwners = referenceChartActiveOwners(this.#active);
      const transitioned = resolveReferenceChartTransition(
        this.#topology,
        this.#active,
        timer.alternative,
      );
      this.#settle(transitioned, guards, previousOwners);
    }
    this.#now = target;
  }

  completeTask(
    owner: string,
    task: string,
    revision: number,
    outcome: "done" | "fail",
    guards: Readonly<Record<string, boolean>> = {},
  ): boolean {
    const key = `${owner}\0${task}`;
    const active = this.#tasks.get(key);
    if (!active || active.revision !== revision) return false;
    this.#tasks.delete(key);
    const nodes = new Map(this.#topology.nodes.map((node) => [node.path, node]));
    const definitions =
      owner === "root" ? this.#topology.taskResults : nodes.get(owner)?.taskResults;
    const definition = definitions?.find((candidate) => candidate.task === task);
    if (!definition) throw new Error(`Active task "${owner}:${task}" has no topology definition.`);
    const alternative = selectReferenceChartAlternative(definition[outcome], guards);
    if (!alternative) return true;
    const previousOwners = referenceChartActiveOwners(this.#active);
    this.#settle(
      resolveReferenceChartTransition(this.#topology, this.#active, alternative, nodes),
      guards,
      previousOwners,
    );
    return true;
  }

  drainOutputs(): readonly { readonly state: string; readonly value: unknown }[] {
    const outputs = this.#outputs;
    this.#outputs = [];
    return outputs;
  }

  #settle(
    active: readonly string[],
    guards: Readonly<Record<string, boolean>>,
    previousOwners: ReadonlySet<string>,
  ): void {
    const settled = resolveReferenceChartCompletion(this.#topology, active, guards);
    this.#active = settled.active;
    this.#complete = settled.complete;
    this.#outputs.push(...settled.outputs);
    const nextOwners = referenceChartActiveOwners(this.#active);
    this.#timers = this.#timers.filter((timer) => nextOwners.has(timer.owner));
    for (const [key, task] of this.#tasks) {
      if (!nextOwners.has(task.owner)) this.#tasks.delete(key);
    }
    this.#scheduleEntered(previousOwners, nextOwners);
  }

  #scheduleEntered(previous: ReadonlySet<string>, next: ReadonlySet<string>): void {
    const nodes = new Map(this.#topology.nodes.map((node) => [node.path, node]));
    for (const owner of [...next].sort()) {
      if (previous.has(owner)) continue;
      const delays = owner === "root" ? this.#topology.delays : nodes.get(owner)!.delays;
      delays.forEach((delay, index) => {
        this.#timers.push({
          owner,
          index,
          due: this.#now + delay.wait,
          alternative: { targets: delay.targets, ...(delay.guard ? { guard: delay.guard } : {}) },
        });
      });
      const tasks = owner === "root" ? this.#topology.taskResults : nodes.get(owner)!.taskResults;
      for (const task of tasks) {
        const key = `${owner}\0${task.task}`;
        if (this.#tasks.has(key)) continue;
        this.#tasks.set(key, { owner, task: task.task, revision: ++this.#taskRevision });
      }
    }
  }
}

function referenceChartActiveOwners(active: readonly string[]): Set<string> {
  const owners = new Set<string>(["root"]);
  for (const leaf of active) {
    const parts = leaf.split(".");
    for (let length = 1; length <= parts.length; length++) {
      owners.add(parts.slice(0, length).join("."));
    }
  }
  return owners;
}

export type ReferenceStateNode = {
  readonly on?: Readonly<Record<string, string | ReferenceStateTransition>>;
  readonly tasks?: readonly string[];
};

export type ReferenceStateTransition = {
  readonly target?: string;
  readonly commands?: readonly { readonly name: string; readonly value?: unknown }[];
};

export type ReferenceCommandRequest = {
  readonly revision: number;
  readonly index: number;
  readonly state: string;
  readonly name: string;
  readonly value?: unknown;
};

export type ReferenceStatechartDefinition = {
  readonly initial: string;
  readonly states: Readonly<Record<string, ReferenceStateNode>>;
};

export type ReferenceTaskOutcome = "active" | "completed" | "cancelled" | "disposed";

export class ReferenceStatechart {
  #definition: ReferenceStatechartDefinition;
  #state: string;
  #revision = 0;
  #disposed = false;
  #activeTasks = new Map<string, number>();
  #outcomes = new Map<string, ReferenceTaskOutcome>();
  #commandRevision = 0;
  #commands: ReferenceCommandRequest[] = [];

  constructor(definition: ReferenceStatechartDefinition) {
    if (!definition.states[definition.initial]) {
      throw new Error(`Unknown initial state "${definition.initial}".`);
    }
    this.#definition = definition;
    this.#state = definition.initial;
    this.#enterState();
  }

  get state(): string {
    return this.#state;
  }

  get revision(): number {
    return this.#revision;
  }

  send(event: string): boolean {
    this.#assertActive();
    const transition = this.#definition.states[this.#state]?.on?.[event];
    if (!transition) return false;
    const target = typeof transition === "string" ? transition : (transition.target ?? this.#state);
    const commands = typeof transition === "string" ? [] : (transition.commands ?? []);
    if (!this.#definition.states[target]) {
      throw new Error(
        `Transition from "${this.#state}" on "${event}" targets unknown state "${target}".`,
      );
    }
    for (const command of commands) {
      if (!command.name) throw new Error("Reference command name cannot be empty.");
    }
    if (target !== this.#state) {
      this.#leaveState("cancelled");
      this.#state = target;
      this.#enterState();
    }
    if (commands.length) {
      const revision = ++this.#commandRevision;
      for (const [index, command] of commands.entries()) {
        this.#commands.push({ revision, index, state: this.#state, ...command });
      }
    }
    return true;
  }

  drainCommands(): readonly ReferenceCommandRequest[] {
    this.#assertActive();
    const commands = this.#commands;
    this.#commands = [];
    return commands;
  }

  activeTask(name: string): { readonly name: string; readonly revision: number } | undefined {
    const revision = this.#activeTasks.get(name);
    return revision === undefined ? undefined : { name, revision };
  }

  completeTask(name: string, revision: number): boolean {
    this.#assertActive();
    if (this.#activeTasks.get(name) !== revision) return false;
    this.#activeTasks.delete(name);
    this.#outcomes.set(referenceTaskKey(name, revision), "completed");
    return true;
  }

  outcome(name: string, revision: number): ReferenceTaskOutcome | undefined {
    return this.#outcomes.get(referenceTaskKey(name, revision));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#leaveState("disposed");
    this.#disposed = true;
  }

  #enterState(): void {
    const revision = ++this.#revision;
    const tasks = this.#definition.states[this.#state]?.tasks ?? [];
    assertUniqueReferenceKeys(tasks, `task in state "${this.#state}"`);
    for (const task of tasks) {
      this.#activeTasks.set(task, revision);
      this.#outcomes.set(referenceTaskKey(task, revision), "active");
    }
  }

  #leaveState(outcome: "cancelled" | "disposed"): void {
    for (const [task, revision] of this.#activeTasks) {
      this.#outcomes.set(referenceTaskKey(task, revision), outcome);
    }
    this.#activeTasks.clear();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Reference statechart is disposed.");
  }
}

function referenceTaskKey(name: string, revision: number): string {
  return `${name}@${revision}`;
}

export type ReferenceSemanticRole =
  | "generic"
  | "form"
  | "group"
  | "button"
  | "link"
  | "checkbox"
  | "radio"
  | "switch"
  | "slider"
  | "textbox"
  | "combobox"
  | "listbox"
  | "option"
  | "tablist"
  | "tab"
  | "dialog"
  | "alertdialog"
  | "grid"
  | "row"
  | "gridcell"
  | "heading"
  | "status"
  | "alert"
  | "tree"
  | "treeitem"
  | "image";

export type ReferenceSemanticNode = {
  readonly identity: string;
  readonly platformKind?: string;
  readonly role: ReferenceSemanticRole;
  readonly children?: readonly string[];
  readonly content?: readonly (
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "node"; readonly identity: string }
  )[];
  readonly name?: string;
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly focusable?: boolean;
  readonly hidden?: boolean;
  readonly inert?: boolean;
  readonly modal?: boolean;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean | "mixed";
  readonly expanded?: boolean;
  readonly activeDescendant?: string;
  readonly formOwner?: string;
  readonly controls?: string;
  readonly popup?: "dialog" | "menu" | "listbox" | "tree" | "grid";
  readonly invalid?: boolean;
  readonly errorMessage?: string;
  readonly destination?: string;
  readonly source?: string;
  readonly decorative?: true;
  readonly textValue?: string;
  readonly value?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly largeStep?: number;
  readonly actions?: readonly {
    readonly event: "activate" | "change" | "submit" | "dismiss";
    readonly action: string;
  }[];
};

export type ReferenceSemanticScene = {
  readonly order: readonly string[];
  readonly parent: Readonly<Record<string, string>>;
  readonly activeModal?: {
    readonly identity: string;
    readonly initialFocus: string;
    readonly returnFocus: string;
  };
  readonly focused?: string;
};

export type ReferenceHotReloadDescriptor = {
  readonly contract: string;
  readonly structureIdentities: readonly string[];
  readonly targetIdentities: readonly string[];
};

export type ReferenceHotReloadMotionSample =
  | {
      readonly kind: "scalar";
      readonly identity: string;
      readonly value: number;
      readonly velocity: number;
    }
  | {
      readonly kind: "layout";
      readonly identity: string;
      readonly value: ReferenceRect;
      readonly velocity: ReferenceLayoutVelocity;
    };

export type ReferenceHotReloadLiveState = {
  readonly presence: readonly {
    readonly identity: string;
    readonly phase: "entering" | "present" | "exiting";
  }[];
  readonly motions: readonly ReferenceHotReloadMotionSample[];
  readonly tasks: readonly string[];
  readonly gestures: readonly string[];
};

export type ReferenceHotReloadResolution = {
  readonly cause: "presentation" | "contract";
  readonly remount: boolean;
  readonly retain: {
    readonly context: boolean;
    readonly state: boolean;
    readonly presence: ReferenceHotReloadLiveState["presence"];
    readonly motion: ReferenceHotReloadLiveState["motions"];
  };
  readonly dispose: {
    readonly motions: readonly string[];
    readonly tasks: readonly string[];
    readonly gestures: readonly string[];
  };
};

export function resolveReferenceHotReload(
  previous: ReferenceHotReloadDescriptor,
  next: ReferenceHotReloadDescriptor,
  live: ReferenceHotReloadLiveState,
): ReferenceHotReloadResolution {
  const compatible = previous.contract === next.contract;
  const nextStructure = new Set(next.structureIdentities);
  const previousTargets = new Set(previous.targetIdentities);
  const nextTargets = new Set(next.targetIdentities);
  const presence = normalizeReferenceHotPresence(live.presence);
  const motions = normalizeReferenceHotMotion(live.motions);
  const retainedMotion = compatible
    ? motions.filter(
        (sample) => previousTargets.has(sample.identity) && nextTargets.has(sample.identity),
      )
    : [];
  const retainedMotionIdentities = new Set(retainedMotion.map((sample) => sample.identity));
  return {
    cause: compatible ? "presentation" : "contract",
    remount: !compatible,
    retain: {
      context: compatible,
      state: compatible,
      presence: compatible ? presence.filter((sample) => nextStructure.has(sample.identity)) : [],
      motion: retainedMotion,
    },
    dispose: {
      motions: motions
        .filter((sample) => !retainedMotionIdentities.has(sample.identity))
        .map((sample) => sample.identity),
      tasks: uniqueReferenceIdentities(live.tasks),
      gestures: uniqueReferenceIdentities(live.gestures),
    },
  };
}

function normalizeReferenceHotPresence(
  samples: ReferenceHotReloadLiveState["presence"],
): ReferenceHotReloadLiveState["presence"] {
  return normalizeReferenceHotSamples(samples, "presence", (sample) => sample.phase);
}

function normalizeReferenceHotMotion(
  samples: ReferenceHotReloadLiveState["motions"],
): ReferenceHotReloadLiveState["motions"] {
  for (const sample of samples) {
    if (sample.kind === "scalar") {
      finite(sample.value, `Hot-reload motion "${sample.identity}" value`);
      finite(sample.velocity, `Hot-reload motion "${sample.identity}" velocity`);
    } else {
      const geometry = finiteRect(sample.value, `Hot-reload motion "${sample.identity}" geometry`);
      if (geometry.inlineSize <= 0 || geometry.blockSize <= 0) {
        throw new Error(`Hot-reload layout motion "${sample.identity}" needs positive size.`);
      }
      finite(sample.velocity.inline, `Hot-reload motion "${sample.identity}" inline velocity`);
      finite(sample.velocity.block, `Hot-reload motion "${sample.identity}" block velocity`);
      finite(
        sample.velocity.logInlineSize,
        `Hot-reload motion "${sample.identity}" inline-size velocity`,
      );
      finite(
        sample.velocity.logBlockSize,
        `Hot-reload motion "${sample.identity}" block-size velocity`,
      );
    }
  }
  return normalizeReferenceHotSamples(samples, "motion", (sample) => JSON.stringify(sample));
}

function normalizeReferenceHotSamples<Sample extends { readonly identity: string }>(
  samples: readonly Sample[],
  kind: string,
  signature: (sample: Sample) => string,
): readonly Sample[] {
  const byIdentity = new Map<string, Sample>();
  for (const sample of samples) {
    if (!sample.identity) throw new Error("Hot-reload live identities cannot be empty.");
    const previous = byIdentity.get(sample.identity);
    if (previous && signature(previous) !== signature(sample)) {
      throw new Error(`Hot-reload ${kind} "${sample.identity}" has conflicting samples.`);
    }
    byIdentity.set(sample.identity, sample);
  }
  return [...byIdentity.values()].sort((left, right) =>
    left.identity.localeCompare(right.identity),
  );
}

function uniqueReferenceIdentities(identities: readonly string[]): readonly string[] {
  if (identities.some((identity) => !identity)) {
    throw new Error("Hot-reload live identities cannot be empty.");
  }
  return [...new Set(identities)].sort();
}

export type ReferenceRovingCommand = "next" | "previous" | "first" | "last";

export type ReferenceAdjustableSource = "pointer" | "keyboard" | "programmatic";

export type ReferenceAdjustableCommand =
  | "increment"
  | "decrement"
  | "largeIncrement"
  | "largeDecrement"
  | "minimum"
  | "maximum";

export type ReferenceAdjustableRange = {
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly largeStep: number;
};

export type ReferenceAdjustableResolution = {
  readonly value: number;
  readonly changed: boolean;
  readonly source: ReferenceAdjustableSource;
};

export function resolveReferenceAdjustableValue(
  current: number,
  proposal: number,
  range: ReferenceAdjustableRange,
  source: ReferenceAdjustableSource,
): ReferenceAdjustableResolution {
  assertReferenceAdjustableRange(range);
  if (!Number.isFinite(current) || !Number.isFinite(proposal)) {
    throw new Error("Adjustable values must be finite.");
  }
  const bounded = Math.min(range.maximum, Math.max(range.minimum, proposal));
  const value =
    bounded === range.minimum || bounded === range.maximum
      ? bounded
      : normalizeReferenceDecimal(
          range.minimum + Math.round((bounded - range.minimum) / range.step) * range.step,
        );
  const resolved = Math.min(range.maximum, Math.max(range.minimum, value));
  return { value: resolved, changed: resolved !== current, source };
}

export function resolveReferenceAdjustableCommand(
  current: number,
  command: ReferenceAdjustableCommand,
  range: ReferenceAdjustableRange,
): ReferenceAdjustableResolution {
  const proposal =
    command === "increment"
      ? current + range.step
      : command === "decrement"
        ? current - range.step
        : command === "largeIncrement"
          ? current + range.largeStep
          : command === "largeDecrement"
            ? current - range.largeStep
            : command === "minimum"
              ? range.minimum
              : range.maximum;
  return resolveReferenceAdjustableValue(current, proposal, range, "keyboard");
}

function assertReferenceAdjustableRange(range: ReferenceAdjustableRange): void {
  if (
    !Number.isFinite(range.minimum) ||
    !Number.isFinite(range.maximum) ||
    range.maximum <= range.minimum
  ) {
    throw new Error("Adjustable range needs finite ascending bounds.");
  }
  if (!Number.isFinite(range.step) || range.step <= 0) {
    throw new Error("Adjustable step must be finite and positive.");
  }
  if (!Number.isFinite(range.largeStep) || range.largeStep < range.step) {
    throw new Error("Adjustable large step must be finite and at least one step.");
  }
}

function normalizeReferenceDecimal(value: number): number {
  return Number(value.toPrecision(15));
}

export function resolveReferenceRovingFocus(
  items: readonly { readonly identity: string; readonly disabled?: boolean }[],
  current: string | undefined,
  command: ReferenceRovingCommand,
): { readonly active: string; readonly tabStops: Readonly<Record<string, 0 | -1>> } {
  assertUniqueReferenceKeys(
    items.map((item) => item.identity),
    "roving focus",
  );
  const enabled = items.filter((item) => !item.disabled);
  if (enabled.length === 0) throw new Error("Roving focus needs at least one enabled item.");
  const currentIndex = enabled.findIndex((item) => item.identity === current);
  let index: number;
  if (command === "first") index = 0;
  else if (command === "last") index = enabled.length - 1;
  else if (command === "next") index = currentIndex < 0 ? 0 : (currentIndex + 1) % enabled.length;
  else
    index =
      currentIndex < 0 ? enabled.length - 1 : (currentIndex - 1 + enabled.length) % enabled.length;
  const active = enabled[index]!.identity;
  return {
    active,
    tabStops: Object.fromEntries(
      items.map((item) => [item.identity, item.identity === active ? 0 : -1]),
    ),
  };
}

export class ReferenceOverlayStack {
  #revision = 0;
  #entries: {
    readonly identity: string;
    readonly parent?: string;
    readonly returnFocus: string;
  }[] = [];

  open(options: {
    readonly identity: string;
    readonly parent?: string;
    readonly returnFocus: string;
  }): number {
    if (!options.identity || !options.returnFocus) {
      throw new Error("Overlay identity and focus return target cannot be empty.");
    }
    if (this.#entries.some((entry) => entry.identity === options.identity)) {
      throw new Error(`Overlay "${options.identity}" is already open.`);
    }
    const top = this.#entries.at(-1);
    if (options.parent !== undefined && options.parent !== top?.identity) {
      throw new Error(`Overlay "${options.identity}" must name the current top overlay as parent.`);
    }
    if (options.parent === undefined && top !== undefined) {
      throw new Error(`Nested overlay "${options.identity}" needs parent "${top.identity}".`);
    }
    this.#entries.push(options);
    return ++this.#revision;
  }

  close(
    revision: number,
    identity: string,
  ): { readonly closed: string; readonly focus: string } | undefined {
    if (revision !== this.#revision) return undefined;
    const top = this.#entries.at(-1);
    if (top?.identity !== identity) {
      throw new Error(`Only top overlay "${top?.identity ?? "none"}" can close.`);
    }
    this.#entries.pop();
    ++this.#revision;
    return { closed: identity, focus: top.returnFocus };
  }

  escape(): { readonly identity: string; readonly revision: number } | undefined {
    const top = this.#entries.at(-1);
    return top ? { identity: top.identity, revision: this.#revision } : undefined;
  }

  get stack(): readonly string[] {
    return this.#entries.map((entry) => entry.identity);
  }
}

export class ReferenceOverlayCloseCascade {
  #revision = 0;
  #queue: string[] = [];
  #cascade: string[] = [];

  begin(
    stack: readonly string[],
    target: string,
  ): { readonly revision: number; readonly current: string } {
    assertUniqueReferenceKeys(stack, "overlay stack");
    const targetIndex = stack.indexOf(target);
    if (targetIndex < 0) throw new Error(`Unknown overlay close target "${target}".`);
    this.#cascade = stack.slice(targetIndex);
    this.#queue = [...this.#cascade].reverse();
    return { revision: ++this.#revision, current: this.#queue[0]! };
  }

  settle(
    revision: number,
    identity: string,
  ):
    | { readonly accepted: false }
    | { readonly accepted: true; readonly next: string }
    | { readonly accepted: true; readonly complete: true } {
    if (revision !== this.#revision || this.#queue[0] !== identity) return { accepted: false };
    this.#queue.shift();
    if (this.#queue.length) return { accepted: true, next: this.#queue[0]! };
    this.#cascade = [];
    return { accepted: true, complete: true };
  }

  reverse(
    revision: number,
  ):
    | { readonly accepted: false }
    | { readonly accepted: true; readonly revision: number; readonly restore: readonly string[] } {
    if (revision !== this.#revision || this.#cascade.length === 0) return { accepted: false };
    const restore = [...this.#cascade];
    this.#queue = [];
    this.#cascade = [];
    const nextRevision = ++this.#revision;
    return { accepted: true, revision: nextRevision, restore };
  }
}

export type ReferenceFocusableNode = {
  readonly identity: string;
  readonly focusable: boolean;
  readonly hidden?: boolean;
  readonly inert?: boolean;
};

export class ReferenceFocusRecoveryCoordinator {
  #revision = 0;
  #focused?: string;

  constructor(focused?: string) {
    this.#focused = focused;
  }

  capture(): number {
    return this.#revision;
  }

  replace(
    nodes: readonly ReferenceFocusableNode[],
    preferred?: string,
  ): {
    readonly revision: number;
    readonly focused?: string;
    readonly strategy: "preserve" | "replace" | "none";
  } {
    const available = referenceFocusableNodes(nodes);
    if (this.#focused !== undefined && available.has(this.#focused)) {
      return { revision: ++this.#revision, focused: this.#focused, strategy: "preserve" };
    }
    if (preferred !== undefined) {
      if (!available.has(preferred)) {
        throw new Error(`Responsive focus destination "${preferred}" is not available.`);
      }
      this.#focused = preferred;
      return { revision: ++this.#revision, focused: preferred, strategy: "replace" };
    }
    if (this.#focused !== undefined) {
      throw new Error("Responsive replacement removes focus without a declared destination.");
    }
    return { revision: ++this.#revision, strategy: "none" };
  }

  returnFocus(revision: number, target: string, nodes: readonly ReferenceFocusableNode[]): boolean {
    if (revision !== this.#revision) return false;
    const available = referenceFocusableNodes(nodes);
    if (!available.has(target)) return false;
    this.#focused = target;
    ++this.#revision;
    return true;
  }

  get focused(): string | undefined {
    return this.#focused;
  }
}

function referenceFocusableNodes(nodes: readonly ReferenceFocusableNode[]): ReadonlySet<string> {
  const identities = new Set<string>();
  const available = new Set<string>();
  for (const node of nodes) {
    if (!node.identity || identities.has(node.identity)) {
      throw new Error(`Focusable identity "${node.identity}" must be non-empty and unique.`);
    }
    identities.add(node.identity);
    if (node.focusable && !node.hidden && !node.inert) available.add(node.identity);
  }
  return available;
}

export type ReferenceFocusIndicator =
  | { readonly kind: "hidden" }
  | { readonly kind: "native" }
  | { readonly kind: "custom" };

export function resolveReferenceFocusIndicator(options: {
  readonly focusVisible: boolean;
  readonly forcedColors: boolean;
  readonly custom?: {
    readonly visible: boolean;
    readonly forcedColorsVisible: boolean;
  };
}): ReferenceFocusIndicator {
  if (!options.focusVisible) return { kind: "hidden" };
  if (options.custom?.visible && (!options.forcedColors || options.custom.forcedColorsVisible)) {
    return { kind: "custom" };
  }
  return { kind: "native" };
}

export type ReferenceOklchColor = {
  readonly colorSpace: "oklch";
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
  readonly alpha: number;
};

export function interpolateReferenceOklch(
  from: ReferenceOklchColor,
  to: ReferenceOklchColor,
  progress: number,
): ReferenceOklchColor {
  assertReferenceOklch(from, "source color");
  assertReferenceOklch(to, "destination color");
  if (!Number.isFinite(progress)) throw new Error("Color progress must be finite.");

  let fromHue = from.hue;
  let toHue = to.hue;
  if (toHue - fromHue > 180) fromHue += 360;
  else if (toHue - fromHue < -180) toHue += 360;

  const alpha = from.alpha + (to.alpha - from.alpha) * progress;
  const premultipliedLightness =
    from.lightness * from.alpha +
    (to.lightness * to.alpha - from.lightness * from.alpha) * progress;
  const premultipliedChroma =
    from.chroma * from.alpha + (to.chroma * to.alpha - from.chroma * from.alpha) * progress;
  const hue = fromHue + (toHue - fromHue) * progress;

  return {
    colorSpace: "oklch",
    lightness: alpha === 0 ? premultipliedLightness : premultipliedLightness / alpha,
    chroma: alpha === 0 ? premultipliedChroma : premultipliedChroma / alpha,
    hue: ((hue % 360) + 360) % 360,
    alpha,
  };
}

export type ReferencePaint =
  | { readonly kind: "solid"; readonly color: ReferenceOklchColor }
  | {
      readonly kind: "linear-gradient";
      readonly angle: { readonly dimension: "angle"; readonly value: number };
      readonly stops: readonly ReferenceGradientStop[];
    }
  | {
      readonly kind: "radial-gradient";
      readonly center: { readonly inline: number; readonly block: number };
      readonly radius: number;
      readonly stops: readonly ReferenceGradientStop[];
    }
  | {
      readonly kind: "conic-gradient";
      readonly center: { readonly inline: number; readonly block: number };
      readonly angle: { readonly dimension: "angle"; readonly value: number };
      readonly stops: readonly ReferenceGradientStop[];
    };

export type ReferenceGradientStop = {
  readonly position: number;
  readonly color: ReferenceOklchColor;
};

export function interpolateReferencePaint(
  from: ReferencePaint,
  to: ReferencePaint,
  progress: number,
): ReferencePaint {
  assertReferencePaint(from, "source paint");
  assertReferencePaint(to, "destination paint");
  if (!Number.isFinite(progress)) throw new Error("Paint progress must be finite.");
  if (from.kind !== to.kind) throw new Error("Paint interpolation requires matching kinds.");
  if (from.kind === "solid" && to.kind === "solid") {
    return { kind: "solid", color: interpolateReferenceOklch(from.color, to.color, progress) };
  }
  const gradientFrom = from as Exclude<ReferencePaint, { readonly kind: "solid" }>;
  const gradientTo = to as Exclude<ReferencePaint, { readonly kind: "solid" }>;
  if (gradientFrom.stops.length !== gradientTo.stops.length) {
    throw new Error("Gradient interpolation requires matching stop topology.");
  }

  const interpolate = (left: number, right: number) => left + (right - left) * progress;
  const interpolateAngle = (
    left: { readonly dimension: "angle"; readonly value: number },
    right: { readonly dimension: "angle"; readonly value: number },
  ) => {
    let start = left.value;
    let end = right.value;
    if (end - start > 180) start += 360;
    else if (end - start < -180) end += 360;
    return {
      dimension: "angle" as const,
      value: ((interpolate(start, end) % 360) + 360) % 360,
    };
  };
  const stops = gradientFrom.stops.map((stop, index) => ({
    position: interpolate(stop.position, gradientTo.stops[index]!.position),
    color: interpolateReferenceOklch(stop.color, gradientTo.stops[index]!.color, progress),
  }));

  if (from.kind === "linear-gradient" && to.kind === "linear-gradient") {
    return { kind: from.kind, angle: interpolateAngle(from.angle, to.angle), stops };
  }
  if (from.kind === "radial-gradient" && to.kind === "radial-gradient") {
    return {
      kind: from.kind,
      center: {
        inline: interpolate(from.center.inline, to.center.inline),
        block: interpolate(from.center.block, to.center.block),
      },
      radius: interpolate(from.radius, to.radius),
      stops,
    };
  }
  if (from.kind === "conic-gradient" && to.kind === "conic-gradient") {
    return {
      kind: from.kind,
      center: {
        inline: interpolate(from.center.inline, to.center.inline),
        block: interpolate(from.center.block, to.center.block),
      },
      angle: interpolateAngle(from.angle, to.angle),
      stops,
    };
  }
  throw new Error("Unreachable paint kind.");
}

function assertReferencePaint(value: ReferencePaint, owner: string): void {
  if (value.kind === "solid") {
    assertReferenceOklch(value.color, `${owner} color`);
    return;
  }
  if (value.stops.length < 2) throw new Error(`${owner} needs at least two gradient stops.`);
  value.stops.forEach((stop, index) => {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) {
      throw new Error(`${owner} stop position must be within zero and one.`);
    }
    if (index > 0 && stop.position < value.stops[index - 1]!.position) {
      throw new Error(`${owner} gradient stops must be ordered.`);
    }
    assertReferenceOklch(stop.color, `${owner} stop color`);
  });
  if (value.kind === "linear-gradient" || value.kind === "conic-gradient") {
    if (!Number.isFinite(value.angle.value)) throw new Error(`${owner} angle must be finite.`);
  }
  if (value.kind === "radial-gradient" || value.kind === "conic-gradient") {
    if (!Number.isFinite(value.center.inline) || !Number.isFinite(value.center.block)) {
      throw new Error(`${owner} center must be finite.`);
    }
  }
  if (value.kind === "radial-gradient" && (!Number.isFinite(value.radius) || value.radius < 0)) {
    throw new Error(`${owner} radius must be non-negative.`);
  }
}

export type ReferenceLength = { readonly dimension: "length"; readonly value: number };

export type ReferenceStroke = {
  readonly paint: ReferencePaint;
  readonly width: ReferenceLength;
  readonly placement: "inside" | "center" | "outside";
  readonly dash?: readonly ReferenceLength[];
};

export type ReferenceShadow = {
  readonly kind: "outer" | "inner";
  readonly color: ReferenceOklchColor;
  readonly offset: { readonly inline: ReferenceLength; readonly block: ReferenceLength };
  readonly blur: ReferenceLength;
  readonly spread: ReferenceLength;
};

export type ReferenceMaterial = {
  readonly backdropBlur: ReferenceLength;
  readonly backdropSaturation: number;
  readonly tint: ReferencePaint;
  readonly noise: number;
};

export type ReferenceTypeStyle = {
  readonly families: readonly string[];
  readonly size: ReferenceLength;
  readonly lineHeight: ReferenceLength;
  readonly weight: number;
  readonly tracking: ReferenceLength;
  readonly align: "start" | "center" | "end" | "justify";
  readonly wrap: "wrap" | "balance" | "nowrap";
  readonly overflow: "clip" | "ellipsis";
  readonly decoration: "none" | "underline" | "line-through";
  readonly variations: Readonly<Record<string, number>>;
};

export type ReferenceMediaFit = {
  readonly mode: "contain" | "cover" | "stretch" | "intrinsic";
  readonly focalPoint: { readonly inline: number; readonly block: number };
};

function interpolateReferenceNumber(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function interpolateReferenceLength(
  left: ReferenceLength,
  right: ReferenceLength,
  progress: number,
): ReferenceLength {
  if (left.dimension !== "length" || right.dimension !== "length") {
    throw new Error("Reference length interpolation requires typed lengths.");
  }
  return {
    dimension: "length",
    value: interpolateReferenceNumber(
      finite(left.value, "reference source length"),
      finite(right.value, "reference destination length"),
      progress,
    ),
  };
}

export function interpolateReferenceStroke(
  from: ReferenceStroke,
  to: ReferenceStroke,
  progress: number,
): ReferenceStroke {
  if (from.placement !== to.placement) {
    throw new Error("Stroke interpolation requires matching placement.");
  }
  if (
    (from.dash === undefined) !== (to.dash === undefined) ||
    from.dash?.length !== to.dash?.length
  ) {
    throw new Error("Stroke interpolation requires matching dash topology.");
  }
  return {
    paint: interpolateReferencePaint(from.paint, to.paint, progress),
    width: interpolateReferenceLength(from.width, to.width, progress),
    placement: from.placement,
    ...(from.dash
      ? {
          dash: from.dash.map((dash, index) =>
            interpolateReferenceLength(dash, to.dash![index]!, progress),
          ),
        }
      : {}),
  };
}

export function interpolateReferenceShadows(
  from: readonly ReferenceShadow[],
  to: readonly ReferenceShadow[],
  progress: number,
): readonly ReferenceShadow[] {
  if (from.length !== to.length) {
    throw new Error("Shadow interpolation requires matching list topology.");
  }
  return from.map((shadow, index) => {
    const destination = to[index]!;
    if (shadow.kind !== destination.kind) {
      throw new Error(`Shadow interpolation item ${index} changes kind.`);
    }
    return {
      kind: shadow.kind,
      color: interpolateReferenceOklch(shadow.color, destination.color, progress),
      offset: {
        inline: interpolateReferenceLength(
          shadow.offset.inline,
          destination.offset.inline,
          progress,
        ),
        block: interpolateReferenceLength(shadow.offset.block, destination.offset.block, progress),
      },
      blur: interpolateReferenceLength(shadow.blur, destination.blur, progress),
      spread: interpolateReferenceLength(shadow.spread, destination.spread, progress),
    };
  });
}

export function interpolateReferenceMaterial(
  from: ReferenceMaterial,
  to: ReferenceMaterial,
  progress: number,
): ReferenceMaterial {
  return {
    backdropBlur: interpolateReferenceLength(from.backdropBlur, to.backdropBlur, progress),
    backdropSaturation: interpolateReferenceNumber(
      from.backdropSaturation,
      to.backdropSaturation,
      progress,
    ),
    tint: interpolateReferencePaint(from.tint, to.tint, progress),
    noise: interpolateReferenceNumber(from.noise, to.noise, progress),
  };
}

export function interpolateReferenceTypeStyle(
  from: ReferenceTypeStyle,
  to: ReferenceTypeStyle,
  progress: number,
): ReferenceTypeStyle {
  const equalList = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  if (
    !equalList(from.families, to.families) ||
    from.align !== to.align ||
    from.wrap !== to.wrap ||
    from.overflow !== to.overflow ||
    from.decoration !== to.decoration
  ) {
    throw new Error("Type interpolation requires matching text semantics.");
  }
  const axes = Object.keys(from.variations).sort();
  if (!equalList(axes, Object.keys(to.variations).sort())) {
    throw new Error("Type interpolation requires matching variation axes.");
  }
  return {
    families: from.families,
    size: interpolateReferenceLength(from.size, to.size, progress),
    lineHeight: interpolateReferenceLength(from.lineHeight, to.lineHeight, progress),
    weight: interpolateReferenceNumber(from.weight, to.weight, progress),
    tracking: interpolateReferenceLength(from.tracking, to.tracking, progress),
    align: from.align,
    wrap: from.wrap,
    overflow: from.overflow,
    decoration: from.decoration,
    variations: Object.fromEntries(
      axes.map((axis) => [
        axis,
        interpolateReferenceNumber(from.variations[axis]!, to.variations[axis]!, progress),
      ]),
    ),
  };
}

export function interpolateReferenceMediaFit(
  from: ReferenceMediaFit,
  to: ReferenceMediaFit,
  progress: number,
): ReferenceMediaFit {
  if (from.mode !== to.mode) throw new Error("Media-fit interpolation requires matching modes.");
  return {
    mode: from.mode,
    focalPoint: {
      inline: interpolateReferenceNumber(from.focalPoint.inline, to.focalPoint.inline, progress),
      block: interpolateReferenceNumber(from.focalPoint.block, to.focalPoint.block, progress),
    },
  };
}

export type ReferenceAxisAngle = {
  readonly axis: { readonly x: number; readonly y: number; readonly z: number };
  readonly degrees: number;
};

type ReferenceQuaternion = readonly [x: number, y: number, z: number, w: number];

export function interpolateReferenceRotation(
  from: ReferenceAxisAngle,
  to: ReferenceAxisAngle,
  progress: number,
): ReferenceAxisAngle {
  if (!Number.isFinite(progress)) throw new Error("Rotation progress must be finite.");
  const left = referenceAxisAngleToQuaternion(from);
  let right = referenceAxisAngleToQuaternion(to);
  let dot = referenceQuaternionDot(left, right);
  if (dot < 0) {
    right = [-right[0], -right[1], -right[2], -right[3]];
    dot = -dot;
  }
  dot = Math.min(1, Math.max(-1, dot));

  let result: ReferenceQuaternion;
  if (dot > 0.9995) {
    result = normalizeReferenceQuaternion([
      left[0] + (right[0] - left[0]) * progress,
      left[1] + (right[1] - left[1]) * progress,
      left[2] + (right[2] - left[2]) * progress,
      left[3] + (right[3] - left[3]) * progress,
    ]);
  } else {
    const theta = Math.acos(dot);
    const denominator = Math.sin(theta);
    const leftWeight = Math.sin((1 - progress) * theta) / denominator;
    const rightWeight = Math.sin(progress * theta) / denominator;
    result = normalizeReferenceQuaternion([
      left[0] * leftWeight + right[0] * rightWeight,
      left[1] * leftWeight + right[1] * rightWeight,
      left[2] * leftWeight + right[2] * rightWeight,
      left[3] * leftWeight + right[3] * rightWeight,
    ]);
  }
  return referenceQuaternionToAxisAngle(result);
}

function referenceAxisAngleToQuaternion(value: ReferenceAxisAngle): ReferenceQuaternion {
  const { x, y, z } = value.axis;
  for (const channel of [x, y, z, value.degrees]) {
    if (!Number.isFinite(channel)) throw new Error("Rotation channels must be finite.");
  }
  const magnitude = Math.hypot(x, y, z);
  if (magnitude === 0) throw new Error("Rotation axis cannot be zero.");
  const halfAngle = (value.degrees * Math.PI) / 360;
  const sine = Math.sin(halfAngle);
  return normalizeReferenceQuaternion([
    (x / magnitude) * sine,
    (y / magnitude) * sine,
    (z / magnitude) * sine,
    Math.cos(halfAngle),
  ]);
}

function referenceQuaternionToAxisAngle(input: ReferenceQuaternion): ReferenceAxisAngle {
  let quaternion = normalizeReferenceQuaternion(input);
  if (quaternion[3] < 0) {
    quaternion = [-quaternion[0], -quaternion[1], -quaternion[2], -quaternion[3]];
  }
  const w = Math.min(1, Math.max(-1, quaternion[3]));
  const sine = Math.sqrt(Math.max(0, 1 - w * w));
  if (sine < 1e-8) return { axis: { x: 0, y: 0, z: 1 }, degrees: 0 };
  return {
    axis: { x: quaternion[0] / sine, y: quaternion[1] / sine, z: quaternion[2] / sine },
    degrees: (2 * Math.acos(w) * 180) / Math.PI,
  };
}

function normalizeReferenceQuaternion(value: ReferenceQuaternion): ReferenceQuaternion {
  const magnitude = Math.hypot(...value);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Quaternion cannot be zero or nonfinite.");
  }
  return [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude, value[3] / magnitude];
}

function referenceQuaternionDot(left: ReferenceQuaternion, right: ReferenceQuaternion): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

export type ReferenceTransform = {
  readonly translation: {
    readonly inline: ReferenceLength;
    readonly block: ReferenceLength;
    readonly depth: ReferenceLength;
  };
  readonly scale: { readonly inline: number; readonly block: number; readonly depth: number };
  readonly rotation: {
    readonly axis: { readonly x: number; readonly y: number; readonly z: number };
    readonly angle: { readonly dimension: "angle"; readonly value: number };
  };
  readonly origin: {
    readonly inline: number;
    readonly block: number;
    readonly depth: ReferenceLength;
  };
  readonly perspective: ReferenceLength | "none";
};

export function interpolateReferenceTransform(
  from: ReferenceTransform,
  to: ReferenceTransform,
  progress: number,
): ReferenceTransform {
  const perspective = () => {
    const left = from.perspective === "none" ? 0 : 1 / from.perspective.value;
    const right = to.perspective === "none" ? 0 : 1 / to.perspective.value;
    const reciprocal = interpolateReferenceNumber(left, right, progress);
    return Math.abs(reciprocal) < Number.EPSILON
      ? ("none" as const)
      : ({ dimension: "length", value: 1 / reciprocal } as const);
  };
  const rotation = interpolateReferenceRotation(
    { axis: from.rotation.axis, degrees: from.rotation.angle.value },
    { axis: to.rotation.axis, degrees: to.rotation.angle.value },
    progress,
  );
  return {
    translation: {
      inline: interpolateReferenceLength(from.translation.inline, to.translation.inline, progress),
      block: interpolateReferenceLength(from.translation.block, to.translation.block, progress),
      depth: interpolateReferenceLength(from.translation.depth, to.translation.depth, progress),
    },
    scale: {
      inline: interpolateReferenceNumber(from.scale.inline, to.scale.inline, progress),
      block: interpolateReferenceNumber(from.scale.block, to.scale.block, progress),
      depth: interpolateReferenceNumber(from.scale.depth, to.scale.depth, progress),
    },
    rotation: {
      axis: rotation.axis,
      angle: { dimension: "angle", value: rotation.degrees },
    },
    origin: {
      inline: interpolateReferenceNumber(from.origin.inline, to.origin.inline, progress),
      block: interpolateReferenceNumber(from.origin.block, to.origin.block, progress),
      depth: interpolateReferenceLength(from.origin.depth, to.origin.depth, progress),
    },
    perspective: perspective(),
  };
}

export type ReferenceVisualTransitionValueType =
  | "number"
  | "length"
  | "paint"
  | "shape"
  | "stroke"
  | "shadows"
  | "material"
  | "type"
  | "media-fit"
  | "transform";

export function resolveReferenceVisualTransitionBatch(
  entries: readonly {
    readonly target: string;
    readonly valueType: ReferenceVisualTransitionValueType;
    readonly from: unknown;
    readonly to: unknown;
  }[],
): readonly { readonly target: string; readonly valueType: ReferenceVisualTransitionValueType }[] {
  const targets = entries.map((entry) => entry.target);
  if (new Set(targets).size !== targets.length) {
    throw new Error("A visual transition batch contains the same target more than once.");
  }
  const validated = entries.map((entry) => {
    if (!entry.target) throw new Error("Visual transition target cannot be empty.");
    if (entry.valueType === "number") {
      finite(entry.from as number, "visual transition source");
      finite(entry.to as number, "visual transition destination");
    } else if (entry.valueType === "length") {
      interpolateReferenceLength(entry.from as ReferenceLength, entry.to as ReferenceLength, 0.5);
    } else if (entry.valueType === "paint") {
      interpolateReferencePaint(entry.from as ReferencePaint, entry.to as ReferencePaint, 0.5);
    } else if (entry.valueType === "shape") {
      interpolateReferenceShape(entry.from as ReferenceShape, entry.to as ReferenceShape, 0.5);
    } else if (entry.valueType === "stroke") {
      if (entry.from === "none" || entry.to === "none") {
        throw new Error("Stroke presence changes require explicit presentation presence.");
      }
      interpolateReferenceStroke(entry.from as ReferenceStroke, entry.to as ReferenceStroke, 0.5);
    } else if (entry.valueType === "shadows") {
      interpolateReferenceShadows(
        entry.from as readonly ReferenceShadow[],
        entry.to as readonly ReferenceShadow[],
        0.5,
      );
    } else if (entry.valueType === "material") {
      if (entry.from === "none" || entry.to === "none") {
        throw new Error("Material presence changes require explicit presentation presence.");
      }
      interpolateReferenceMaterial(
        entry.from as ReferenceMaterial,
        entry.to as ReferenceMaterial,
        0.5,
      );
    } else if (entry.valueType === "type") {
      interpolateReferenceTypeStyle(
        entry.from as ReferenceTypeStyle,
        entry.to as ReferenceTypeStyle,
        0.5,
      );
    } else if (entry.valueType === "media-fit") {
      interpolateReferenceMediaFit(
        entry.from as ReferenceMediaFit,
        entry.to as ReferenceMediaFit,
        0.5,
      );
    } else {
      interpolateReferenceTransform(
        entry.from as ReferenceTransform,
        entry.to as ReferenceTransform,
        0.5,
      );
    }
    return { target: entry.target, valueType: entry.valueType };
  });
  return validated.sort((left, right) => left.target.localeCompare(right.target));
}

function assertReferenceOklch(color: ReferenceOklchColor, owner: string): void {
  for (const [channel, value] of Object.entries(color)) {
    if (channel !== "colorSpace" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`${owner} ${channel} must be finite.`);
    }
  }
  if (
    color.lightness < 0 ||
    color.lightness > 1 ||
    color.chroma < 0 ||
    color.alpha < 0 ||
    color.alpha > 1
  ) {
    throw new Error(`${owner} has an invalid OKLCH domain.`);
  }
}

export function validateReferenceSemanticTree(
  nodes: readonly ReferenceSemanticNode[],
  options: {
    readonly root: string;
    readonly activeModal?: {
      readonly identity: string;
      readonly initialFocus: string;
      readonly returnFocus: string;
    };
    readonly focused?: string;
  },
): ReferenceSemanticScene {
  const byIdentity = new Map<string, ReferenceSemanticNode>();
  for (const node of nodes) {
    if (!node.identity) throw new Error("Semantic identity cannot be empty.");
    if (byIdentity.has(node.identity)) {
      throw new Error(`Duplicate semantic identity "${node.identity}".`);
    }
    byIdentity.set(node.identity, node);
  }
  if (!byIdentity.has(options.root)) throw new Error(`Unknown semantic root "${options.root}".`);

  const parent = new Map<string, string>();
  const hierarchy: ReferenceCompositionRelation[] = [];
  for (const node of nodes) {
    assertReferenceSemanticNode(node, byIdentity);
    for (const child of node.children ?? []) {
      if (!byIdentity.has(child)) {
        throw new Error(`Semantic node "${node.identity}" references unknown child "${child}".`);
      }
      const owner = parent.get(child);
      if (owner) {
        throw new Error(
          `Semantic node "${child}" belongs to both "${owner}" and "${node.identity}".`,
        );
      }
      parent.set(child, node.identity);
      hierarchy.push({ below: node.identity, above: child });
    }
  }
  if (parent.has(options.root)) throw new Error(`Semantic root "${options.root}" has a parent.`);
  for (const node of nodes) {
    if (node.identity !== options.root && !parent.has(node.identity)) {
      throw new Error(
        `Semantic node "${node.identity}" is disconnected from root "${options.root}".`,
      );
    }
  }

  const order = resolveReferenceComposition(
    nodes.map((node, documentOrder) => ({ identity: node.identity, documentOrder })),
    hierarchy,
  );
  const modals = nodes.filter((node) => node.modal);
  if (modals.length > 1) throw new Error("A semantic scene cannot have multiple active modals.");
  if (options.activeModal !== undefined) {
    const modalIdentity = options.activeModal.identity;
    const modal = byIdentity.get(modalIdentity);
    if (!modal) throw new Error(`Unknown active modal "${modalIdentity}".`);
    if (!modal.modal || (modal.role !== "dialog" && modal.role !== "alertdialog")) {
      throw new Error(`Active modal "${modalIdentity}" is not a modal dialog.`);
    }
    if (modals[0]?.identity !== modalIdentity) {
      throw new Error(`Modal ownership does not resolve to "${modalIdentity}".`);
    }
    const initialFocus = byIdentity.get(options.activeModal.initialFocus);
    if (
      !initialFocus?.focusable ||
      initialFocus.hidden ||
      initialFocus.inert ||
      (initialFocus.identity !== modalIdentity &&
        !isReferenceSemanticDescendant(initialFocus.identity, modalIdentity, parent))
    ) {
      throw new Error(
        `Active modal "${modalIdentity}" has invalid initial focus "${options.activeModal.initialFocus}".`,
      );
    }
    const returnFocus = byIdentity.get(options.activeModal.returnFocus);
    if (
      !returnFocus?.focusable ||
      returnFocus.hidden ||
      returnFocus.inert ||
      returnFocus.controls !== modalIdentity ||
      isReferenceSemanticDescendant(returnFocus.identity, modalIdentity, parent)
    ) {
      throw new Error(
        `Active modal "${modalIdentity}" has invalid return focus "${options.activeModal.returnFocus}".`,
      );
    }
  } else if (modals.length) {
    throw new Error(`Modal "${modals[0]!.identity}" has no active modal owner.`);
  }

  for (const node of nodes) {
    if (node.activeDescendant !== undefined) {
      const active = byIdentity.get(node.activeDescendant);
      if (!active) {
        throw new Error(
          `Semantic node "${node.identity}" references unknown active descendant "${node.activeDescendant}".`,
        );
      }
      if (!node.focusable || !["combobox", "listbox", "grid", "tree"].includes(node.role)) {
        throw new Error(`Semantic ${node.role} "${node.identity}" cannot own active descendant.`);
      }
      if (!isReferenceSemanticDescendant(active.identity, node.identity, parent)) {
        throw new Error(
          `Active descendant "${active.identity}" is outside owner "${node.identity}".`,
        );
      }
      const compatible =
        ((node.role === "combobox" || node.role === "listbox") && active.role === "option") ||
        (node.role === "grid" && (active.role === "row" || active.role === "gridcell")) ||
        (node.role === "tree" && active.role === "treeitem");
      if (
        !compatible ||
        active.hidden ||
        active.disabled ||
        hasReferenceSemanticAncestor(active, parent, byIdentity, "inert")
      ) {
        throw new Error(
          `Active descendant "${active.identity}" is unavailable or incompatible with ${node.role} "${node.identity}".`,
        );
      }
    }
    if (node.formOwner !== undefined) {
      const form = byIdentity.get(node.formOwner);
      if (form?.role !== "form") {
        throw new Error(
          `Semantic node "${node.identity}" references invalid form "${node.formOwner}".`,
        );
      }
    }
    if (node.errorMessage !== undefined) {
      const error = byIdentity.get(node.errorMessage);
      if (!error || (error.role !== "status" && error.role !== "alert")) {
        throw new Error(
          `Semantic node "${node.identity}" references invalid error message "${node.errorMessage}".`,
        );
      }
    }
  }

  if (options.focused !== undefined) {
    const focused = byIdentity.get(options.focused);
    if (!focused) throw new Error(`Unknown focused identity "${options.focused}".`);
    if (
      !focused.focusable ||
      focused.hidden ||
      hasReferenceSemanticAncestor(focused, parent, byIdentity, "inert")
    ) {
      throw new Error(`Focused identity "${options.focused}" is not available for focus.`);
    }
    if (
      options.activeModal &&
      options.focused !== options.activeModal.identity &&
      !hasReferenceSemanticAncestor(focused, parent, byIdentity, "modal")
    ) {
      throw new Error(
        `Focused identity "${options.focused}" is outside active modal "${options.activeModal.identity}".`,
      );
    }
  }

  return {
    order,
    parent: Object.fromEntries(
      [...parent.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    ...(options.activeModal ? { activeModal: options.activeModal } : {}),
    ...(options.focused ? { focused: options.focused } : {}),
  };
}

export type ReferenceStructureReconciliation = {
  readonly surviving: readonly string[];
  readonly entering: readonly string[];
  readonly enterRoots: readonly string[];
  readonly exiting: readonly string[];
  readonly exitRoots: readonly {
    readonly identity: string;
    readonly presentation: "remove" | "retain";
  }[];
  readonly moving: readonly {
    readonly identity: string;
    readonly from?: string;
    readonly to?: string;
  }[];
  readonly contentUpdates: readonly {
    readonly identity: string;
    readonly content: ReferenceSemanticNode["content"];
  }[];
  readonly order: readonly {
    readonly identity: string;
    readonly children: readonly string[];
  }[];
};

export function resolveReferenceStructureReconciliation(
  previous: readonly ReferenceSemanticNode[],
  next: readonly ReferenceSemanticNode[],
  retainedExitRoots: readonly string[] = [],
): ReferenceStructureReconciliation {
  const previousByIdentity = referenceSemanticNodeMap(previous, "previous");
  const nextByIdentity = referenceSemanticNodeMap(next, "next");
  const previousParent = referenceSemanticParents(previous, previousByIdentity, "previous");
  const nextParent = referenceSemanticParents(next, nextByIdentity, "next");
  const exitingSet = new Set(
    previous.filter((node) => !nextByIdentity.has(node.identity)).map((node) => node.identity),
  );
  const enteringSet = new Set(
    next.filter((node) => !previousByIdentity.has(node.identity)).map((node) => node.identity),
  );
  const exitRootSet = new Set(
    [...exitingSet].filter((identity) => {
      const parent = previousParent.get(identity);
      return parent === undefined || !exitingSet.has(parent);
    }),
  );
  const enterRootSet = new Set(
    [...enteringSet].filter((identity) => {
      const parent = nextParent.get(identity);
      return parent === undefined || !enteringSet.has(parent);
    }),
  );
  if (new Set(retainedExitRoots).size !== retainedExitRoots.length) {
    throw new Error("Retained structure exit roots must be unique.");
  }
  for (const identity of retainedExitRoots) {
    if (!exitRootSet.has(identity)) {
      throw new Error(`Retained structure identity "${identity}" is not an exiting subtree root.`);
    }
  }
  const retained = new Set(retainedExitRoots);
  const surviving = previous.filter((node) => nextByIdentity.has(node.identity));
  for (const node of surviving) {
    const replacement = nextByIdentity.get(node.identity)!;
    if (referenceSemanticContract(node) !== referenceSemanticContract(replacement)) {
      throw new Error(
        `Surviving semantic identity "${node.identity}" changed its native contract.`,
      );
    }
  }
  return {
    surviving: surviving.map((node) => node.identity),
    entering: next.filter((node) => enteringSet.has(node.identity)).map((node) => node.identity),
    enterRoots: next.filter((node) => enterRootSet.has(node.identity)).map((node) => node.identity),
    exiting: previous.filter((node) => exitingSet.has(node.identity)).map((node) => node.identity),
    exitRoots: previous
      .filter((node) => exitRootSet.has(node.identity))
      .map((node) => ({
        identity: node.identity,
        presentation: retained.has(node.identity) ? "retain" : "remove",
      })),
    moving: surviving.flatMap((node) => {
      const from = previousParent.get(node.identity);
      const to = nextParent.get(node.identity);
      return from === to
        ? []
        : [{ identity: node.identity, ...(from ? { from } : {}), ...(to ? { to } : {}) }];
    }),
    contentUpdates: surviving.flatMap((node) => {
      const replacement = nextByIdentity.get(node.identity)!;
      return JSON.stringify(node.content ?? []) === JSON.stringify(replacement.content ?? [])
        ? []
        : [{ identity: node.identity, content: replacement.content }];
    }),
    order: next.map((node) => ({ identity: node.identity, children: node.children ?? [] })),
  };
}

function referenceSemanticNodeMap(
  nodes: readonly ReferenceSemanticNode[],
  owner: string,
): ReadonlyMap<string, ReferenceSemanticNode> {
  const byIdentity = new Map<string, ReferenceSemanticNode>();
  for (const node of nodes) {
    if (!node.identity || byIdentity.has(node.identity)) {
      throw new Error(`${owner} semantic structure has an empty or duplicate identity.`);
    }
    byIdentity.set(node.identity, node);
  }
  return byIdentity;
}

function referenceSemanticParents(
  nodes: readonly ReferenceSemanticNode[],
  byIdentity: ReadonlyMap<string, ReferenceSemanticNode>,
  owner: string,
): ReadonlyMap<string, string> {
  const parents = new Map<string, string>();
  for (const node of nodes) {
    for (const child of node.children ?? []) {
      if (!byIdentity.has(child)) {
        throw new Error(`${owner} semantic node "${node.identity}" has unknown child "${child}".`);
      }
      if (parents.has(child)) {
        throw new Error(`${owner} semantic identity "${child}" has multiple parents.`);
      }
      parents.set(child, node.identity);
    }
  }
  return parents;
}

function referenceSemanticContract(node: ReferenceSemanticNode): string {
  return JSON.stringify({
    platformKind: node.platformKind,
    role: node.role,
    actions: [...(node.actions ?? [])].sort(
      (left, right) =>
        left.event.localeCompare(right.event) || left.action.localeCompare(right.action),
    ),
  });
}

function assertReferenceSemanticNode(
  node: ReferenceSemanticNode,
  nodes: ReadonlyMap<string, ReferenceSemanticNode>,
): void {
  if (node.platformKind !== undefined && !node.platformKind) {
    throw new Error(`Semantic node "${node.identity}" has an empty platform kind.`);
  }
  if (node.content) {
    const contentChildren = node.content.flatMap((content) =>
      content.kind === "node" ? [content.identity] : [],
    );
    if (contentChildren.join("\0") !== (node.children ?? []).join("\0")) {
      throw new Error(`Semantic node "${node.identity}" has inconsistent ordered content.`);
    }
    if (node.content.some((content) => content.kind === "text" && content.value.length === 0)) {
      throw new Error(`Semantic node "${node.identity}" contains an empty text item.`);
    }
  }
  if (node.name !== undefined && node.labelledBy !== undefined) {
    throw new Error(`Semantic node "${node.identity}" has two accessible-name owners.`);
  }
  for (const [relationship, target] of [
    ["label", node.labelledBy],
    ["description", node.describedBy],
    ["control", node.controls],
  ] as const) {
    if (target !== undefined && !nodes.has(target)) {
      throw new Error(
        `Semantic node "${node.identity}" references unknown ${relationship} "${target}".`,
      );
    }
  }
  const namedRoles: ReadonlySet<ReferenceSemanticRole> = new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "textbox",
    "combobox",
    "listbox",
    "dialog",
    "alertdialog",
    "grid",
    "tree",
  ]);
  if (namedRoles.has(node.role) && node.name === undefined && node.labelledBy === undefined) {
    throw new Error(`Semantic ${node.role} "${node.identity}" has no accessible name.`);
  }
  if (node.modal && node.role !== "dialog" && node.role !== "alertdialog") {
    throw new Error(`Only dialogs can own modality; "${node.identity}" is ${node.role}.`);
  }
  if (
    (node.controls !== undefined || node.popup !== undefined) &&
    node.role !== "button" &&
    node.role !== "combobox"
  ) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot own popup control semantics.`);
  }
  if (node.destination !== undefined && node.role !== "link") {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot own a link destination.`);
  }
  if (node.role === "link" && !node.destination) {
    throw new Error(`Semantic link "${node.identity}" needs a destination.`);
  }
  if (node.source !== undefined && node.role !== "image") {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot own an image source.`);
  }
  if (node.decorative !== undefined && node.role !== "image") {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot be a decorative image.`);
  }
  if (node.role === "image") {
    if (typeof node.source !== "string" || !node.source) {
      throw new Error(`Semantic image "${node.identity}" needs a source.`);
    }
    if (node.decorative && (node.name !== undefined || node.labelledBy !== undefined)) {
      throw new Error(`Decorative image "${node.identity}" cannot have an accessible name.`);
    }
    if (!node.decorative && !node.name && node.labelledBy === undefined) {
      throw new Error(`Semantic image "${node.identity}" needs alternative text.`);
    }
  }
  if (node.textValue !== undefined && !["textbox", "combobox"].includes(node.role)) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot own a text value.`);
  }
  if (node.checked !== undefined && !["checkbox", "radio", "switch"].includes(node.role)) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot have checked state.`);
  }
  if (
    node.selected !== undefined &&
    !["option", "tab", "row", "gridcell", "treeitem"].includes(node.role)
  ) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot have selected state.`);
  }
  if (node.expanded !== undefined && !["button", "combobox", "treeitem"].includes(node.role)) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot have expanded state.`);
  }
  if (
    node.invalid !== undefined &&
    !["textbox", "combobox", "checkbox", "radio", "switch", "slider"].includes(node.role)
  ) {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot have invalid state.`);
  }
  const adjustableProperties = [node.value, node.minimum, node.maximum, node.step, node.largeStep];
  if (adjustableProperties.some((value) => value !== undefined) && node.role !== "slider") {
    throw new Error(`Semantic ${node.role} "${node.identity}" cannot own an adjustable range.`);
  }
  if (node.role === "slider") {
    if (adjustableProperties.some((value) => value === undefined)) {
      throw new Error(`Semantic slider "${node.identity}" needs a complete adjustable range.`);
    }
    const range = {
      minimum: node.minimum!,
      maximum: node.maximum!,
      step: node.step!,
      largeStep: node.largeStep!,
    };
    assertReferenceAdjustableRange(range);
    if (
      !Number.isFinite(node.value!) ||
      node.value! < range.minimum ||
      node.value! > range.maximum
    ) {
      throw new Error(`Semantic slider "${node.identity}" has a value outside its range.`);
    }
  }
  const actionRoles = {
    activate: new Set<ReferenceSemanticRole>(["button", "link", "option", "tab", "treeitem"]),
    change: new Set<ReferenceSemanticRole>([
      "textbox",
      "combobox",
      "checkbox",
      "radio",
      "switch",
      "slider",
    ]),
    submit: new Set<ReferenceSemanticRole>(["form"]),
    dismiss: new Set<ReferenceSemanticRole>(["dialog", "alertdialog"]),
  } as const;
  const actionEvents = (node.actions ?? []).map((binding) => binding.event);
  assertUniqueReferenceKeys(actionEvents, `semantic action event on "${node.identity}"`);
  for (const binding of node.actions ?? []) {
    if (!binding.action) throw new Error(`Semantic action on "${node.identity}" has no identity.`);
    if (!actionRoles[binding.event].has(node.role)) {
      throw new Error(`Semantic ${node.role} "${node.identity}" cannot bind ${binding.event}.`);
    }
  }
}

function isReferenceSemanticDescendant(
  identity: string,
  owner: string,
  parent: ReadonlyMap<string, string>,
): boolean {
  let current = parent.get(identity);
  while (current !== undefined) {
    if (current === owner) return true;
    current = parent.get(current);
  }
  return false;
}

function hasReferenceSemanticAncestor(
  node: ReferenceSemanticNode,
  parent: ReadonlyMap<string, string>,
  nodes: ReadonlyMap<string, ReferenceSemanticNode>,
  property: "inert" | "modal",
): boolean {
  let current: ReferenceSemanticNode | undefined = node;
  while (current) {
    if (current[property]) return true;
    const owner = parent.get(current.identity);
    current = owner === undefined ? undefined : nodes.get(owner);
  }
  return false;
}
