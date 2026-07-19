import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canUseWebViewTransition,
  createNativeMotionHost,
  createSpring,
  createSpringTrajectory,
  planWebMotion,
  sampleSpringTrajectory,
} from "./motion";

describe("web spring", () => {
  it("normalizes physical and perceived parameters as immutable data", () => {
    const physical = createSpring({ mass: 2, stiffness: 320, damping: 30 });
    expect(physical).toEqual({
      kind: "spring",
      mass: 2,
      stiffness: 320,
      damping: 30,
      restDistance: 0.001,
      restSpeed: 0.001,
    });
    expect(Object.isFrozen(physical)).toBe(true);

    const perceived = createSpring({ duration: 500, bounce: 0 });
    expect(perceived.mass).toBe(1);
    expect(perceived.stiffness).toBeCloseTo((2 * Math.PI * 2) ** 2);
    expect(perceived.damping).toBeCloseTo(8 * Math.PI);
  });

  it.each([
    ["under", createSpring({ stiffness: 100, damping: 10 })],
    ["critical", createSpring({ stiffness: 100, damping: 20 })],
    ["over", createSpring({ stiffness: 100, damping: 30 })],
  ])("converges for %s-damped springs", (_name, spring) => {
    const trajectory = createSpringTrajectory({ from: -120, to: 40, velocity: 380, spring });
    expect(trajectory.at(0)).toEqual({ value: -120, velocity: 380 });
    expect(trajectory.duration).toBeGreaterThan(0);
    expect(trajectory.duration).toBeLessThan(60_000);
    expect(trajectory.at(trajectory.duration)).toEqual({ value: 40, velocity: 0 });
  });

  it("preserves position and velocity exactly when retargeted", () => {
    const spring = createSpring({ duration: 420, bounce: 0.18 });
    const forward = createSpringTrajectory({ from: 0, to: 300, spring });
    const boundary = forward.at(forward.duration * 0.37);
    const reverse = createSpringTrajectory({
      from: boundary.value,
      to: 0,
      velocity: boundary.velocity,
      spring: createSpring({ stiffness: 650, damping: 46 }),
    });
    expect(reverse.at(0)).toEqual(boundary);
  });

  it("adaptively samples the analytical curve within tolerance", () => {
    const trajectory = createSpringTrajectory({
      from: 0,
      to: 1,
      velocity: 2,
      spring: createSpring({ duration: 520, bounce: 0.35 }),
    });
    const tolerance = 0.0005;
    const samples = sampleSpringTrajectory(trajectory, tolerance);
    expect(samples[0]?.offset).toBe(0);
    expect(samples.at(-1)?.offset).toBe(1);

    for (let index = 1; index < samples.length; index += 1) {
      const left = samples[index - 1]!;
      const right = samples[index]!;
      const time = (left.time + right.time) / 2;
      const expected = trajectory.at(time).value;
      const actual = (left.value + right.value) / 2;
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance + 1e-12);
    }
  });

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
          const spring = createSpring({ mass, stiffness, damping });
          const trajectory = createSpringTrajectory({ from, to, velocity, spring });
          const time = trajectory.duration * progress;
          const sample = trajectory.at(time);
          expect(Number.isFinite(trajectory.duration)).toBe(true);
          expect(Number.isFinite(sample.value)).toBe(true);
          expect(Number.isFinite(sample.velocity)).toBe(true);

          const retargeted = createSpringTrajectory({
            from: sample.value,
            to: from,
            velocity: sample.velocity,
            spring,
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
    expect(() => createSpring({ duration: 0 })).toThrow("duration must be positive");
    expect(() => createSpring({ duration: 300, bounce: 2 })).toThrow("between -1 and 1");
    expect(() => createSpring({ stiffness: Number.NaN })).toThrow("stiffness must be finite");
  });
});

describe("web motion planner and native host", () => {
  it("selects one deterministic realization", () => {
    const spring = createSpring();
    expect(planWebMotion({ transition: undefined, waapi: true, reducedMotion: false })).toBe(
      "direct",
    );
    expect(planWebMotion({ transition: spring, waapi: true, reducedMotion: false })).toBe("waapi");
    expect(planWebMotion({ transition: spring, waapi: false, reducedMotion: false })).toBe("frame");
    expect(planWebMotion({ transition: spring, waapi: true, reducedMotion: true })).toBe("direct");
  });

  it("admits View Transitions only when snapshot semantics are safe", () => {
    const candidate = {
      supported: true,
      mutationOwned: true,
      interaction: "passive",
      continuity: "retargetable",
      materializable: true,
      snapshotArea: 200_000,
      snapshotBudget: 500_000,
    } as const;
    expect(canUseWebViewTransition(candidate)).toBe(true);
    expect(canUseWebViewTransition({ ...candidate, interaction: "hit-testable" })).toBe(false);
    expect(canUseWebViewTransition({ ...candidate, materializable: false })).toBe(false);
    expect(
      canUseWebViewTransition({ ...candidate, continuity: "one-shot", materializable: false }),
    ).toBe(true);
    expect(canUseWebViewTransition({ ...candidate, snapshotArea: 600_000 })).toBe(false);
  });

  it("hands position and velocity across interrupted WAAPI renderers", () => {
    let time = 0;
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations);
    const host = createNativeMotionHost(target, {
      now: () => time,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });
    const forwardSpring = createSpring({ duration: 480, bounce: 0.2 });
    const reverseSpring = createSpring({ stiffness: 650, damping: 46 });

    host.set(target, {
      transform: {
        value: { translate: { y: 100 } },
        velocity: { translate: { y: 600 } },
      },
    });
    host.set(target, {
      transform: { value: { translate: { y: 0 } }, transition: forwardSpring },
    });
    expect(animations).toHaveLength(1);
    expect(animations[0]?.keyframes[0]?.translate).toBe("0px 100px");
    expect(animations[0]?.keyframes.length).toBeLessThan(100);

    time = 120;
    const expected = createSpringTrajectory({
      from: 100,
      to: 0,
      velocity: 600,
      spring: forwardSpring,
    }).at(time);
    host.set(target, {
      transform: { value: { translate: { y: 220 } }, transition: reverseSpring },
    });
    expect(animations).toHaveLength(2);
    expect(animations[0]?.cancelled).toBe(1);
    const firstRetargeted = parseTranslate(animations[1]?.keyframes[0]?.translate);
    expect(firstRetargeted.y).toBeCloseTo(expected.value, 10);

    const second = createSpringTrajectory({
      from: expected.value,
      to: 220,
      velocity: expected.velocity,
      spring: reverseSpring,
    });
    const secondFrame = animations[1]?.keyframes[1];
    const secondTime = Number(secondFrame?.offset) * second.duration;
    expect(parseTranslate(secondFrame?.translate).y).toBeCloseTo(second.at(secondTime).value, 10);

    host.dispose();
    expect(animations[1]?.cancelled).toBe(1);
    expect(target.styles.size).toBe(0);
  });

  it("samples the native WAAPI clock instead of injecting wall-clock velocity", () => {
    let time = 0;
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations);
    const host = createNativeMotionHost(target, {
      now: () => time,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });
    const spring = createSpring({ stiffness: 520, damping: 42 });

    host.set(target, { transform: { value: { translate: { y: 100 } } } });
    host.set(target, {
      transform: { value: { translate: { y: 0 } }, transition: spring },
    });
    animations[0]!.currentTime = 0;
    time = 200;
    host.set(target, {
      transform: { value: { translate: { y: 220 } }, transition: spring },
    });

    expect(parseTranslate(animations[1]?.keyframes[0]?.translate).y).toBe(100);
    host.dispose();
  });

  it("uses one shared frame fallback and restores authored inline values", () => {
    let time = 0;
    let requested = 0;
    let pending: FrameRequestCallback | undefined;
    const target = createMotionElement();
    target.style.setProperty("opacity", "0.75");
    const host = createNativeMotionHost(target, {
      now: () => time,
      requestFrame(callback) {
        requested += 1;
        pending = callback;
        return requested;
      },
      cancelFrame: () => undefined,
      reducedMotion: false,
    });
    const spring = createSpring({ duration: 400, bounce: 0 });

    host.set(target, { opacity: { value: 0 } });
    host.set(target, { opacity: { value: 1, transition: spring } });
    expect(requested).toBe(1);
    time = 80;
    pending?.(time);
    const expected = createSpringTrajectory({ from: 0, to: 1, spring }).at(time).value;
    expect(Number(target.style.getPropertyValue("opacity"))).toBeCloseTo(expected, 10);

    host.dispose();
    expect(target.style.getPropertyValue("opacity")).toBe("0.75");
  });

  it("realizes reduced motion directly without creating a native animation", () => {
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations);
    const host = createNativeMotionHost(target, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: true,
    });
    host.set(target, {
      opacity: { value: 0.25, transition: createSpring({ duration: 500 }) },
    });
    expect(target.style.getPropertyValue("opacity")).toBe("0.25");
    expect(animations).toEqual([]);
    host.dispose();
  });

  it("does not allocate a renderer for an initial zero-distance spring", () => {
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations);
    const host = createNativeMotionHost(target, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });
    host.set(target, {
      opacity: { value: 1, transition: createSpring() },
      transform: { value: { translate: { y: 0 }, scale: 1 }, transition: createSpring() },
    });
    expect(animations).toEqual([]);
    host.dispose();
  });

  it("performs layout FLIP from pre-mutation to post-mutation geometry", async () => {
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations, { left: 10, top: 20, width: 100, height: 80 });
    const spring = createSpring({ duration: 420, bounce: 0.1 });
    const motion = { layout: { transition: spring } } as const;
    const host = createNativeMotionHost(target, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });

    host.begin(new Map([[target, motion]]));
    host.set(target, motion);
    host.complete();
    await Promise.resolve();
    expect(animations).toEqual([]);

    host.begin(new Map([[target, motion]]));
    target.rect = { left: 50, top: 35, width: 200, height: 40 };
    host.complete();
    await Promise.resolve();
    expect(animations).toHaveLength(1);
    expect(animations[0]?.keyframes[0]?.transform).toBe("translate(-40px,-15px) scale(0.5,2)");
    expect(animations[0]?.keyframes.at(-1)?.transform).toBe("translate(0px,0px) scale(1,1)");

    host.dispose();
    expect(animations[0]?.cancelled).toBe(1);
    expect(target.styles.size).toBe(0);
  });

  it("measures layout after every synchronous structure mutation has settled", () => {
    const animations: FakeAnimation[] = [];
    const tasks: Array<() => void> = [];
    const target = createMotionElement(animations, { left: 0, top: 0, width: 100, height: 100 });
    const motion = {
      layout: { transition: createSpring({ stiffness: 520, damping: 42 }) },
    } as const;
    const host = createNativeMotionHost(target, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
      queueTask: (task) => tasks.push(task),
    });

    host.begin(new Map([[target, motion]]));
    host.set(target, motion);
    host.complete();
    tasks.shift()?.();

    host.begin(new Map([[target, motion]]));
    target.rect = { left: 0, top: 0, width: 100, height: 120 };
    host.complete();
    target.rect = { left: 0, top: 0, width: 100, height: 200 };

    expect(animations).toEqual([]);
    tasks.shift()?.();
    expect(animations[0]?.keyframes[0]?.transform).toBe("translate(0px,0px) scale(1,0.5)");

    host.dispose();
  });

  it("refreshes a zero-area layout baseline when a hidden target becomes measurable", async () => {
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations, { left: 0, top: 0, width: 0, height: 0 });
    const motion = {
      layout: { transition: createSpring({ stiffness: 520, damping: 42 }) },
    } as const;
    const host = createNativeMotionHost(target, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });
    host.begin(new Map([[target, motion]]));
    host.set(target, motion);
    host.complete();
    await Promise.resolve();

    target.rect = { left: 10, top: 20, width: 100, height: 80 };
    host.begin(new Map([[target, motion]]));
    target.rect = { left: 10, top: 20, width: 100, height: 160 };
    host.complete();
    await Promise.resolve();

    expect(animations[0]?.keyframes[0]?.transform).toBe("translate(0px,0px) scale(1,0.5)");
    host.dispose();
  });

  it("moves shared layout identity between native elements", async () => {
    const animations: FakeAnimation[] = [];
    const first = createMotionElement(animations, { left: 0, top: 0, width: 80, height: 80 });
    const second = createMotionElement(animations, { left: 240, top: 120, width: 160, height: 40 });
    const spring = createSpring({ stiffness: 500, damping: 40 });
    const motion = { layout: { identity: "selected-card", transition: spring } } as const;
    const host = createNativeMotionHost(first, {
      now: () => 0,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
    });

    host.begin(new Map([[first, motion]]));
    host.set(first, motion);
    host.complete();
    await Promise.resolve();

    host.begin(
      new Map([
        [first, undefined],
        [second, motion],
      ]),
    );
    host.set(first, undefined);
    host.set(second, motion);
    host.complete();
    await Promise.resolve();

    expect(animations).toHaveLength(1);
    expect(animations[0]?.keyframes[0]?.transform).toBe("translate(-240px,-120px) scale(0.5,2)");
    host.dispose();
  });

  it("coordinates entering, exiting, reversal, and lifecycle completion", () => {
    let time = 0;
    let notify: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const ownerDocument = {
      documentElement: {},
      defaultView: {
        Event,
        MutationObserver: class {
          constructor(callback: MutationCallback) {
            notify = () => callback([{ target }] as unknown as MutationRecord[], this);
          }
          observe() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        },
      },
    } as unknown as Document;
    const animations: FakeAnimation[] = [];
    const target = createMotionElement(animations, undefined, ownerDocument);
    const spring = createSpring({ duration: 360, bounce: 0.12 });
    const motion = {
      presence: {
        enter: { from: { opacity: 0, transform: { scale: 0.96 } }, transition: spring },
        exit: { to: { opacity: 0, transform: { scale: 0.94 } }, transition: spring, layout: "pop" },
      },
    } as const;
    target.setAttribute("data-motion-state", "entering");
    const host = createNativeMotionHost(target, {
      now: () => time,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      reducedMotion: false,
      setTimer(callback) {
        finish = callback;
        return 1;
      },
      clearTimer() {
        finish = undefined;
      },
    });

    host.set(target, motion);
    expect(target.getAttribute("data-motion-lifecycle")).toBe("enter exit exit-finished");
    expect(target.getAttribute("data-motion-layout")).toBe("pop");
    expect(animations).toHaveLength(2);

    time = 120;
    target.setAttribute("data-motion-state", "exiting");
    notify?.();
    expect(animations).toHaveLength(4);
    expect(finish).toBeTypeOf("function");

    time = 180;
    target.setAttribute("data-motion-state", "entering");
    notify?.();
    expect(finish).toBeUndefined();
    expect(animations).toHaveLength(6);

    time = 240;
    target.setAttribute("data-motion-state", "exiting");
    notify?.();
    finish?.();
    expect(target.events).toContain("poggersmotionfinish");

    host.dispose();
    expect(target.getAttribute("data-motion-lifecycle")).toBeNull();
    expect(target.getAttribute("data-motion-layout")).toBeNull();
  });
});

type FakeAnimation = Animation & {
  readonly keyframes: Keyframe[];
  readonly timing: KeyframeAnimationOptions;
  cancelled: number;
};

type MotionElement = Element & {
  readonly styles: Map<string, string>;
  readonly style: CSSStyleDeclaration;
  rect: Readonly<{ left: number; top: number; width: number; height: number }>;
  readonly events: string[];
};

function createMotionElement(
  animations?: FakeAnimation[],
  rect: MotionElement["rect"] = { left: 0, top: 0, width: 100, height: 100 },
  ownerDocument: Document | object = { defaultView: undefined },
): MotionElement {
  const styles = new Map<string, string>();
  const attributes = new Map<string, string>();
  const events: string[] = [];
  const style = {
    getPropertyValue: (property: string) => styles.get(property) ?? "",
    setProperty: (property: string, value: string) => styles.set(property, value),
    removeProperty: (property: string) => {
      const previous = styles.get(property) ?? "";
      styles.delete(property);
      return previous;
    },
  } as unknown as CSSStyleDeclaration;
  const target = {
    ownerDocument,
    style,
    styles,
    rect,
    events,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
  } as unknown as MotionElement & { animate?: Element["animate"] };
  target.getBoundingClientRect = () => target.rect as DOMRect;
  if (animations) {
    target.animate = (keyframes, timing) => {
      const animation = {
        keyframes: keyframes as Keyframe[],
        timing: timing as KeyframeAnimationOptions,
        cancelled: 0,
        onfinish: null,
        cancel() {
          animation.cancelled += 1;
        },
      } as unknown as FakeAnimation;
      animations.push(animation);
      return animation;
    };
  }
  return target;
}

function parseTranslate(value: string | number | null | undefined): { x: number; y: number } {
  const [x, y] = String(value)
    .split(" ")
    .map((part) => Number.parseFloat(part));
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}
