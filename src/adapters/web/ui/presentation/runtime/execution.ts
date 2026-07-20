import { compileWebStyleDeclarations } from "../compiler";
import type { WebElementPresentation } from "../language";

const nativeProperties = new Set(["opacity", "rotate", "scale", "translate"]);
const adaptiveSafetyMargin = 0.5;

export type WebExecutionSample = Readonly<{
  time: number;
  declarations: Readonly<Partial<Record<string, Readonly<WebElementPresentation>>>>;
}>;

export type WebNativeKeyframe = Readonly<Record<string, string | number>> &
  Readonly<{ offset: number }>;

export type WebNativeEffectPlan = Readonly<{
  target: Element;
  properties: readonly string[];
  keyframes: readonly WebNativeKeyframe[];
}>;

export type WebNativeExecutionPlan = Readonly<{
  kind: "native";
  mode: "off-thread" | "hybrid";
  started: number;
  duration: number;
  samples: number;
  effects: readonly WebNativeEffectPlan[];
}>;

export type WebNativeAnimation = {
  readonly finished: PromiseLike<unknown>;
  cancel(): void;
  currentTime: number | null;
};

export type WebNativeAnimationFactory = (
  target: Element,
  keyframes: readonly WebNativeKeyframe[],
  options: Readonly<{ duration: number; fill: "both"; easing: "linear" }>,
) => WebNativeAnimation | undefined;

export type WebNativeExecution = Readonly<{
  finished: Promise<void>;
  cancel(): void;
}>;

export type WebCanonicalExecutionPlan = Readonly<{
  kind: "canonical";
  reason:
    | "no-animation"
    | "no-native-target"
    | "target-set-changed"
    | "non-compositor-output"
    | "native-property-shape-changed"
    | "planning-limit"
    | "planning-budget"
    | "layout-active"
    | "direct-lowering-required"
    | "native-unavailable";
}>;

export type WebExecutionPlan = WebNativeExecutionPlan | WebCanonicalExecutionPlan;

export type WebExecutionTolerances = Readonly<{
  opacity: number;
  translate: number;
  scale: number;
  rotate: number;
}>;

export const defaultWebExecutionTolerances: WebExecutionTolerances = Object.freeze({
  opacity: 0.001,
  translate: 0.125,
  scale: 0.001,
  rotate: 0.05,
});

type CapturedElement = Readonly<{
  properties: Readonly<Record<string, string>>;
  residual: Readonly<WebElementPresentation>;
}>;

type CapturedSample = Readonly<{
  time: number;
  elements: ReadonlyMap<Element, CapturedElement>;
}>;

type SegmentComparison =
  | Readonly<{ kind: "equivalent"; normalizedError: number }>
  | Readonly<{ kind: "canonical"; reason: WebCanonicalExecutionPlan["reason"] }>;

/**
 * Builds the smallest proven native trace for one canonical trajectory.
 * Candidate segments are accepted only after quarter, midpoint, and
 * three-quarter samples remain within the adapter's visual tolerances.
 */
export function planAdaptiveWebExecution<ElementName extends string>(options: {
  started: number;
  finished: number;
  sample(time: number): WebExecutionSample;
  elements: Readonly<Record<ElementName, () => readonly Element[]>>;
  tolerances?: WebExecutionTolerances;
  maximumSamples?: number;
  planning?: Readonly<{ budget: number; now(): number }>;
}): WebExecutionPlan {
  const started = finite(options.started, "adaptive start");
  const finished = finite(options.finished, "adaptive finish");
  if (!(finished > started)) return canonical("no-animation");
  const maximumSamples = options.maximumSamples ?? 1_024;
  if (!Number.isInteger(maximumSamples) || maximumSamples < 5) {
    throw new TypeError("A web native execution sample limit must be an integer of at least 5.");
  }
  const tolerances = normalizeTolerances(options.tolerances ?? defaultWebExecutionTolerances);
  const planning = options.planning;
  const planningStarted = planning?.now();
  if (planning && (!(planning.budget > 0) || !Number.isFinite(planning.budget))) {
    throw new TypeError("A web native execution planning budget must be positive and finite.");
  }
  const samples = new Map<number, WebExecutionSample>();
  const captured = new Map<number, CapturedSample>();
  const keyTimes = new Set<number>([started, finished]);
  let failure: WebCanonicalExecutionPlan["reason"] | undefined;

  const read = (time: number): CapturedSample | undefined => {
    const previous = captured.get(time);
    if (previous) return previous;
    if (
      planning &&
      planningStarted !== undefined &&
      planning.now() - planningStarted >= planning.budget
    ) {
      failure = "planning-budget";
      return;
    }
    if (samples.size >= maximumSamples) {
      failure = "planning-limit";
      return;
    }
    const sample = options.sample(time);
    if (
      planning &&
      planningStarted !== undefined &&
      planning.now() - planningStarted >= planning.budget
    ) {
      failure = "planning-budget";
      return;
    }
    if (sample.time !== time) {
      throw new TypeError("A web execution sample returned another time.");
    }
    try {
      const result = capture(sample, options.elements);
      samples.set(time, sample);
      captured.set(time, result);
      return result;
    } catch {
      failure = "non-compositor-output";
      return;
    }
  };

  const visit = (from: number, to: number, depth: number): void => {
    if (failure) return;
    const left = read(from);
    const right = read(to);
    if (!left || !right) return;
    const span = to - from;
    const probeTimes = Array.from({ length: 7 }, (_, index) => from + (span * (index + 1)) / 8);
    let maximumError = 0;
    for (const time of probeTimes) {
      const probe = read(time);
      if (!probe) return;
      const comparison = compareCapturedSamples(
        left,
        probe,
        right,
        (time - from) / span,
        tolerances,
      );
      if (comparison.kind === "canonical") {
        failure = comparison.reason;
        return;
      }
      maximumError = Math.max(maximumError, comparison.normalizedError);
    }
    // Probe below the public error budget so unobserved points between probes
    // retain headroom. This is bounded validation, not a proof of arbitrary
    // authored JavaScript between sampled times.
    if (maximumError <= adaptiveSafetyMargin) return;
    if (depth >= 18 || span <= 0.25) {
      failure = "planning-limit";
      return;
    }
    const middle = probeTimes[3]!;
    keyTimes.add(middle);
    visit(from, middle, depth + 1);
    visit(middle, to, depth + 1);
  };

  visit(started, finished, 0);
  if (failure) return canonical(failure);
  return planWebExecution(
    [...keyTimes]
      .sort((left, right) => left - right)
      .map((time) => samples.get(time) ?? options.sample(time)),
    options.elements,
  );
}

/** Plans a native trace only when it is equivalent outside compositor-owned properties. */
export function planWebExecution<ElementName extends string>(
  samples: readonly WebExecutionSample[],
  elements: Readonly<Record<ElementName, () => readonly Element[]>>,
): WebExecutionPlan {
  if (samples.length < 2) return canonical("no-animation");
  const started = samples[0]!.time;
  const finished = samples.at(-1)!.time;
  const duration = finished - started;
  if (!(duration > 0) || !Number.isFinite(duration)) return canonical("no-animation");

  let captured: readonly CapturedSample[];
  try {
    captured = samples.map((sample) => capture(sample, elements));
  } catch {
    return canonical("non-compositor-output");
  }
  const first = captured[0]!;
  if (first.elements.size === 0) return canonical("no-native-target");
  const targets = [...first.elements.keys()];

  for (const sample of captured.slice(1)) {
    if (
      sample.elements.size !== targets.length ||
      targets.some((target) => !sample.elements.has(target))
    ) {
      return canonical("target-set-changed");
    }
    for (const target of targets) {
      if (!sameValue(first.elements.get(target)!.residual, sample.elements.get(target)!.residual)) {
        return canonical("non-compositor-output");
      }
    }
  }

  const effects: WebNativeEffectPlan[] = [];
  for (const target of targets) {
    const propertyNames = new Set<string>();
    for (const sample of captured) {
      for (const property of Object.keys(sample.elements.get(target)!.properties)) {
        propertyNames.add(property);
      }
    }
    const changing = [...propertyNames]
      .filter((property) => {
        const initial = first.elements.get(target)!.properties[property];
        return captured.some(
          (sample) => sample.elements.get(target)!.properties[property] !== initial,
        );
      })
      .sort();
    if (changing.length === 0) continue;
    if (
      changing.some((property) =>
        captured.some((sample) => sample.elements.get(target)!.properties[property] === undefined),
      )
    ) {
      return canonical("native-property-shape-changed");
    }
    effects.push(
      Object.freeze({
        target,
        properties: Object.freeze(changing),
        keyframes: Object.freeze(
          captured.map((sample) =>
            Object.freeze({
              offset: (sample.time - started) / duration,
              ...Object.fromEntries(
                changing.map((property) => [
                  property,
                  sample.elements.get(target)!.properties[property]!,
                ]),
              ),
            }),
          ),
        ),
      }),
    );
  }

  if (effects.length === 0) return canonical("no-animation");
  return Object.freeze({
    kind: "native",
    mode: "off-thread",
    started,
    duration,
    samples: samples.length,
    effects: Object.freeze(effects),
  });
}

function compareCapturedSamples(
  left: CapturedSample,
  sample: CapturedSample,
  right: CapturedSample,
  progress: number,
  tolerances: WebExecutionTolerances,
): SegmentComparison {
  const targets = [...left.elements.keys()];
  if (
    sample.elements.size !== targets.length ||
    right.elements.size !== targets.length ||
    targets.some((target) => !sample.elements.has(target) || !right.elements.has(target))
  ) {
    return { kind: "canonical", reason: "target-set-changed" };
  }
  let maximum = 0;
  for (const target of targets) {
    const from = left.elements.get(target)!;
    const current = sample.elements.get(target)!;
    const to = right.elements.get(target)!;
    if (!sameValue(from.residual, current.residual) || !sameValue(from.residual, to.residual)) {
      return { kind: "canonical", reason: "non-compositor-output" };
    }
    const properties = new Set([
      ...Object.keys(from.properties),
      ...Object.keys(current.properties),
      ...Object.keys(to.properties),
    ]);
    for (const property of properties) {
      const fromValue = from.properties[property];
      const value = current.properties[property];
      const toValue = to.properties[property];
      if (fromValue === undefined || value === undefined || toValue === undefined) {
        return { kind: "canonical", reason: "native-property-shape-changed" };
      }
      const fromNumbers = nativeNumbers(property, fromValue);
      const numbers = nativeNumbers(property, value);
      const toNumbers = nativeNumbers(property, toValue);
      if (
        !fromNumbers ||
        !numbers ||
        !toNumbers ||
        fromNumbers.length !== numbers.length ||
        fromNumbers.length !== toNumbers.length
      ) {
        return { kind: "canonical", reason: "non-compositor-output" };
      }
      const tolerance = tolerances[property as keyof WebExecutionTolerances];
      for (let index = 0; index < numbers.length; index += 1) {
        const expected = fromNumbers[index]! + (toNumbers[index]! - fromNumbers[index]!) * progress;
        maximum = Math.max(maximum, Math.abs(numbers[index]! - expected) / tolerance);
      }
    }
  }
  return Object.freeze({ kind: "equivalent", normalizedError: maximum });
}

function nativeNumbers(property: string, value: string): readonly number[] | undefined {
  if (property === "opacity" || property === "scale") {
    const values = value.split(" ").map(unitlessNumber);
    return values.every((number) => number !== undefined) ? (values as number[]) : undefined;
  }
  if (property === "rotate") {
    const number = numericUnit(value, "deg");
    return number === undefined ? undefined : [number];
  }
  if (property === "translate") {
    const values = value.split(" ").map(pixelNumber);
    return values.length === 2 && values.every((number) => number !== undefined)
      ? (values as number[])
      : undefined;
  }
  return;
}

function unitlessNumber(value: string): number | undefined {
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : undefined;
}

function numericUnit(value: string, unit: string): number | undefined {
  return value.endsWith(unit) ? unitlessNumber(value.slice(0, -unit.length)) : undefined;
}

function pixelNumber(value: string): number | undefined {
  if (value === "0") return 0;
  return numericUnit(value, "px");
}

function normalizeTolerances(value: WebExecutionTolerances): WebExecutionTolerances {
  return Object.freeze({
    opacity: positive(value.opacity, "opacity tolerance"),
    translate: positive(value.translate, "translation tolerance"),
    scale: positive(value.scale, "scale tolerance"),
    rotate: positive(value.rotate, "rotation tolerance"),
  });
}

/** Starts one planned native trace atomically or leaves every target untouched. */
export function startWebNativeExecution(
  plan: WebNativeExecutionPlan,
  create: WebNativeAnimationFactory | undefined = createNativeAnimation,
  elapsed = 0,
): WebNativeExecution | undefined {
  const factory = create ?? createNativeAnimation;
  const animations: WebNativeAnimation[] = [];
  try {
    for (const effect of plan.effects) {
      const animation = factory(effect.target, effect.keyframes, {
        duration: plan.duration,
        fill: "both",
        easing: "linear",
      });
      if (!animation) throw new UnsupportedNativeAnimation();
      animation.currentTime = Math.min(plan.duration, Math.max(0, elapsed));
      animations.push(animation);
    }
  } catch (error) {
    for (const animation of animations) animation.cancel();
    if (error instanceof UnsupportedNativeAnimation) return;
    throw error;
  }
  let cancelled = false;
  return Object.freeze({
    finished: Promise.all(animations.map((animation) => Promise.resolve(animation.finished))).then(
      () => undefined,
    ),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const animation of animations) animation.cancel();
    },
  });
}

function capture<ElementName extends string>(
  sample: WebExecutionSample,
  elements: Readonly<Record<ElementName, () => readonly Element[]>>,
): CapturedSample {
  const captured = new Map<Element, CapturedElement>();
  for (const [name, source] of Object.entries(elements) as Array<
    [ElementName, () => readonly Element[]]
  >) {
    const declaration = sample.declarations[name];
    if (!declaration) continue;
    const properties = Object.freeze(
      Object.fromEntries(
        Object.entries(compileWebStyleDeclarations(declaration)).filter(([property]) =>
          nativeProperties.has(property),
        ),
      ),
    );
    const entry = Object.freeze({ properties, residual: withoutNativeMotion(declaration) });
    for (const target of source()) {
      const previous = captured.get(target);
      if (previous && !sameValue(previous, entry)) {
        throw new TypeError("A web Presentation native target has conflicting declarations.");
      }
      captured.set(target, entry);
    }
  }
  return Object.freeze({ time: sample.time, elements: captured });
}

function withoutNativeMotion(value: WebElementPresentation): Readonly<WebElementPresentation> {
  const { presence: _presence, paint, transform, ...rest } = value;
  const { opacity: _opacity, ...remainingPaint } = paint ?? {};
  const {
    translate: _translate,
    scale: _scale,
    rotate: _rotate,
    ...remainingTransform
  } = transform ?? {};
  return Object.freeze({
    ...rest,
    ...(Object.keys(remainingPaint).length ? { paint: Object.freeze(remainingPaint) } : {}),
    ...(Object.keys(remainingTransform).length
      ? { transform: Object.freeze(remainingTransform) }
      : {}),
  }) as Readonly<WebElementPresentation>;
}

function canonical(reason: WebCanonicalExecutionPlan["reason"]): WebCanonicalExecutionPlan {
  return Object.freeze({ kind: "canonical", reason });
}

class UnsupportedNativeAnimation extends Error {}

function createNativeAnimation(
  target: Element,
  keyframes: readonly WebNativeKeyframe[],
  options: Readonly<{ duration: number; fill: "both"; easing: "linear" }>,
): WebNativeAnimation | undefined {
  const animate = (target as Element & { animate?: Element["animate"] }).animate;
  if (typeof animate !== "function") return;
  return animate.call(target, keyframes as Keyframe[], options) as WebNativeAnimation;
}

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
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

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Web execution ${label} must be finite.`);
  return value;
}

function positive(value: number, label: string): number {
  const result = finite(value, label);
  if (!(result > 0)) throw new TypeError(`Web execution ${label} must be positive.`);
  return result;
}
