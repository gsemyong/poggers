import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  createNativeFeedbackHost,
  createNativeAudioOutput,
  createWebPresentationAdapter as createAdapter,
  type WebFeedbackHost,
  type WebPresentationAdapterOptions,
  type WebPresentationFrameInspection,
  type WebStyleHost,
} from "@/adapters/web/ui/presentation/adapter";
import { follow, spring } from "@/adapters/web/ui/presentation/dynamics";
import {
  createAudioAsset,
  createImageAsset,
  type WebElementPresentation,
} from "@/adapters/web/ui/presentation/language";
import { animate, samplePresentationAnimation } from "@/core/presentation";

type FakeElement = Element & {
  readonly classes: Set<string>;
  readonly attributeWrites: string[];
  readonly style: FakeStyle;
};

type NativeMutation = Readonly<{
  kind: "attribute" | "class" | "style";
  name: string;
  value?: string;
}>;

class MutationLedger {
  readonly entries: NativeMutation[] = [];

  record(entry: NativeMutation): void {
    this.entries.push(Object.freeze(entry));
  }
}

class FakeStyle {
  readonly values = new Map<string, string>();
  writes = 0;

  constructor(private readonly ledger?: MutationLedger) {}

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }

  getPropertyPriority(): string {
    return "";
  }

  setProperty(name: string, value: string): void {
    this.writes += 1;
    this.values.set(name, value);
    this.ledger?.record({ kind: "style", name, value });
  }

  removeProperty(name: string): string {
    this.writes += 1;
    const previous = this.getPropertyValue(name);
    this.values.delete(name);
    this.ledger?.record({ kind: "style", name });
    return previous;
  }
}

function createElement(
  ownerDocument: object,
  initial: readonly string[] = [],
  localName = "div",
  ledger?: MutationLedger,
): FakeElement {
  const classes = new Set(initial);
  const attributes = new Map<string, string>();
  const attributeWrites: string[] = [];
  const style = new FakeStyle(ledger);
  return {
    ownerDocument,
    localName,
    classes,
    attributeWrites,
    style,
    disabled: false,
    isConnected: true,
    parentElement: null,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON() {},
    }),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
      attributeWrites.push(`${name}=${value}`);
      ledger?.record({ kind: "attribute", name, value });
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
      attributeWrites.push(`${name}-`);
      ledger?.record({ kind: "attribute", name });
    },
    classList: {
      add: (...values: string[]) =>
        values.forEach((value) => {
          classes.add(value);
          ledger?.record({ kind: "class", name: "add", value });
        }),
      remove: (...values: string[]) =>
        values.forEach((value) => {
          if (!value) throw new SyntaxError("A class token cannot be empty.");
          classes.delete(value);
          ledger?.record({ kind: "class", name: "remove", value });
        }),
      replace: (previous: string, next: string) => {
        if (!classes.delete(previous)) return false;
        classes.add(next);
        ledger?.record({ kind: "class", name: "replace", value: `${previous}->${next}` });
        return true;
      },
    },
  } as unknown as FakeElement;
}

function createFeedbackHost(log: unknown[]): WebFeedbackHost {
  return {
    set(target, feedback) {
      log.push([target, feedback]);
    },
    dispose() {
      log.push("dispose");
    },
  };
}

function createHost(log: string[]): WebStyleHost {
  return {
    replace(css) {
      log.push(css);
    },
    dispose() {
      log.push("dispose");
    },
  };
}

function createTestPresentationAdapter(options: WebPresentationAdapterOptions = {}) {
  const adapter = createAdapter(options);
  return {
    create<const ElementName extends string>(input: {
      boundary: Element;
      elements: Readonly<Record<ElementName, () => readonly Element[]>>;
    }) {
      const mounted = adapter.mount({ boundary: input.boundary });
      const session = mounted.create({ boundary: input.boundary, elements: input.elements });
      return {
        render(
          declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
        ) {
          session.render(() => declarations);
        },
        dispose() {
          session.dispose();
          mounted.dispose();
        },
      };
    },
  };
}

async function settleTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectNativeFrame(
  target: FakeElement,
  frame: WebPresentationFrameInspection<"Root">,
): void {
  const output = frame.elements.Root[0];
  expect(output?.target).toBe(target);
  expect(Object.fromEntries(target.style.values)).toEqual(output?.properties);
  expect(target.classes).toEqual(
    new Set(["authored", ...(output?.className ? [output.className] : [])]),
  );
}

function comparableOutput(frame: WebPresentationFrameInspection<"Root">) {
  return {
    dynamic: frame.dynamic,
    behavior: frame.behavior,
    declarations: frame.declarations,
    elements: frame.elements.Root.map(({ target: _target, ...output }) => output),
  };
}

describe("web Presentation adapter", () => {
  it("owns one Environment per mounted UI root", () => {
    const adapter = createAdapter();
    const firstBoundary = createElement({});
    const secondBoundary = createElement({});
    const first = adapter.mount({ boundary: firstBoundary });
    const second = adapter.mount({ boundary: secondBoundary });

    expect(first.environment).not.toBe(second.environment);
    expect(first.environment).toBe(first.environment);

    first.dispose();
    second.dispose();
  });

  it("keeps a compiler-classified static Component out of the frame scheduler", async () => {
    let requestedFrames = 0;
    const ownerDocument = {
      defaultView: {
        performance: { now: () => 10 },
        innerWidth: 1_280,
        innerHeight: 720,
        addEventListener() {},
        removeEventListener() {},
        requestAnimationFrame() {
          requestedFrames += 1;
          return requestedFrames;
        },
        cancelAnimationFrame() {},
      },
    };
    const target = createElement(ownerDocument, ["authored"]);
    const styles: string[] = [];
    const mounted = createAdapter({ createStyleHost: () => createHost(styles) }).mount({
      boundary: target,
    });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });

    session.render(() => ({ Root: { layout: { padding: 12 }, paint: { opacity: 0.8 } } }), {
      dynamic: false,
    });
    await settleTurn();

    expect(session.inspect().artifacts.elements.Root).toMatchObject({
      execution: { kind: "static" },
      variables: {},
    });
    expect(target.style.values.size).toBe(0);
    expect(requestedFrames).toBe(0);
    expect(styles.at(-1)).toContain("opacity:0.8");

    session.dispose();
    mounted.dispose();
  });

  it("offloads autonomous transform motion without retaining a main-thread frame loop", async () => {
    let now = 0;
    let nextFrame = 0;
    const pending = new Map<number, FrameRequestCallback>();
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => now },
        requestAnimationFrame(callback: FrameRequestCallback) {
          const id = ++nextFrame;
          pending.set(id, callback);
          return id;
        },
        cancelAnimationFrame(id: number) {
          pending.delete(id);
        },
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const native: Array<{
      keyframes: readonly Readonly<Record<string, string | number>>[];
      duration: number;
      cancelled: boolean;
      currentTime: number | null;
    }> = [];
    const mounted = createAdapter({
      createStyleHost: () => createHost([]),
      createNativeAnimation(_target, keyframes, options) {
        const record = {
          keyframes,
          duration: options.duration,
          cancelled: false,
          currentTime: null as number | null,
        };
        native.push(record);
        return {
          finished,
          get currentTime() {
            return record.currentTime;
          },
          set currentTime(value) {
            record.currentTime = value;
          },
          cancel() {
            record.cancelled = true;
          },
        };
      },
    }).mount({ boundary: target });
    const session = mounted.create({
      boundary: target,
      elements: { Root: () => [target] },
    });
    const observationFrames = pending.size;
    let evaluations = 0;

    session.render(() => {
      evaluations += 1;
      const identity = "Fixture::position";
      const position = samplePresentationAnimation(
        identity,
        120,
        spring({ initial: 0, stiffness: 500, damping: 42 }),
      );
      return {
        Root: {
          transform: {
            translate: {
              y: animate.temporal(position.value, () => animate.value<number>(identity), [
                identity,
              ]) as unknown as number,
            },
          },
        },
      };
    });

    expect(evaluations).toBe(1);
    expect(session.inspect().execution.kind).toBe("native");
    expect(native).toHaveLength(1);
    expect(native[0]!.keyframes[0]).toMatchObject({ translate: "0 0", offset: 0 });
    expect(native[0]!.keyframes.at(-1)).toMatchObject({ translate: "0 120px", offset: 1 });
    expect(pending.size).toBe(observationFrames);

    now = native[0]!.duration;
    finish();
    await settleTurn();
    expect(native[0]!.cancelled).toBe(true);
    expect([...target.style.values.values()]).toContain("120px");

    session.dispose();
    mounted.dispose();
  });

  it("rejects temporal layout output instead of retaining main-thread layout frames", () => {
    let nextFrame = 0;
    const pending = new Map<number, FrameRequestCallback>();
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => 0 },
        requestAnimationFrame(callback: FrameRequestCallback) {
          const id = ++nextFrame;
          pending.set(id, callback);
          return id;
        },
        cancelAnimationFrame(id: number) {
          pending.delete(id);
        },
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const layout = createElement(ownerDocument);
    const fade = createElement(ownerDocument);
    const native: Array<{ target: Element; keyframes: readonly Keyframe[] }> = [];
    const mounted = createAdapter({
      createStyleHost: () => createHost([]),
      createNativeAnimation(target, keyframes) {
        native.push({ target, keyframes: keyframes as readonly Keyframe[] });
        return {
          finished: new Promise(() => undefined),
          currentTime: null,
          cancel() {},
        };
      },
    }).mount({ boundary: layout });
    const session = mounted.create({
      boundary: layout,
      elements: { Layout: () => [layout], Fade: () => [fade] },
    });
    const observationFrames = pending.size;
    let evaluations = 0;

    expect(() =>
      session.render(() => {
        evaluations += 1;
        const identity = "Fixture::progress";
        const progress = samplePresentationAnimation(
          identity,
          1,
          spring({ initial: 0, duration: 260 }),
        );
        return {
          Layout: {
            layout: {
              blockSize: animate.temporal(
                100 + progress.value * 20,
                () => 100 + animate.value<number>(identity) * 20,
                [identity],
              ) as unknown as number,
            },
          },
          Fade: {
            paint: {
              opacity: animate.temporal(progress.value, () => animate.value<number>(identity), [
                identity,
              ]) as unknown as number,
            },
          },
        };
      }),
    ).toThrow('Web temporal output "Layout.layout.blockSize" is not compositor-safe');

    expect(evaluations).toBe(1);
    expect(native).toHaveLength(0);
    expect(pending.size).toBe(observationFrames);

    session.dispose();
    mounted.dispose();
  });

  it("rejects mixed compositor and temporal layout output atomically", () => {
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    let native = 0;
    const mounted = createAdapter({
      createStyleHost: () => createHost([]),
      createNativeAnimation() {
        native += 1;
        return;
      },
    }).mount({ boundary: target });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });

    expect(() =>
      session.render(() => {
        const identity = "Fixture::mixed";
        const progress = samplePresentationAnimation(
          identity,
          1,
          spring({ initial: 0, duration: 260 }),
        );
        return {
          Root: {
            layout: {
              blockSize: animate.temporal(
                100 + progress.value * 20,
                () => 100 + animate.value<number>(identity) * 20,
                [identity],
              ) as unknown as number,
            },
            paint: {
              opacity: animate.temporal(progress.value, () => animate.value<number>(identity), [
                identity,
              ]) as unknown as number,
            },
          },
        };
      }),
    ).toThrow('Web temporal output "Root.layout.blockSize" is not compositor-safe');
    expect(native).toBe(0);

    session.dispose();
    mounted.dispose();
  });

  it("does not replay future Presentation frames on the default execution path", () => {
    let requested = 0;
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => 0 },
        requestAnimationFrame() {
          requested += 1;
          return requested;
        },
        cancelAnimationFrame() {},
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
    });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
    let evaluations = 0;

    session.render(() => {
      evaluations += 1;
      const position = samplePresentationAnimation(
        "Fixture::position",
        120,
        spring({ initial: 0, stiffness: 500, damping: 42 }),
      );
      return { Root: { transform: { translate: { y: position.value } } } };
    });

    expect(evaluations).toBe(1);
    expect(session.inspect().execution).toEqual({
      kind: "canonical",
      reason: "direct-lowering-required",
    });
    expect(requested).toBeGreaterThan(0);
    session.dispose();
    mounted.dispose();
  });

  it("resamples compiler temporal slices without re-evaluating authored Presentation", () => {
    let now = 0;
    let handle = 0;
    const pending = new Map<number, FrameRequestCallback>();
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => now },
        requestAnimationFrame(callback: FrameRequestCallback) {
          pending.set(++handle, callback);
          return handle;
        },
        cancelAnimationFrame(cancelled: number) {
          pending.delete(cancelled);
        },
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
    });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
    const identity = "Fixture::opacity";
    let evaluations = 0;

    session.render(() => {
      evaluations += 1;
      const opacity = samplePresentationAnimation(
        identity,
        1,
        spring({ initial: 0, stiffness: 500, damping: 42 }),
      );
      return {
        Root: {
          paint: {
            opacity: animate.temporal(opacity.value, () => animate.value<number>(identity), [
              identity,
            ]) as unknown as number,
          },
        },
      };
    });

    expect(evaluations).toBe(1);
    expect(session.inspect().declarations.Root?.paint?.opacity).toBe(0);
    now = 80;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(now);
    expect(evaluations).toBe(1);
    expect(session.inspect().declarations.Root?.paint?.opacity).toBeGreaterThan(0);

    session.dispose();
    mounted.dispose();
  });

  it("resolves reduced motion without starting native or canonical animation work", () => {
    let requested = 0;
    let native = 0;
    const reducedMotion = {
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    };
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => 0 },
        requestAnimationFrame() {
          requested += 1;
          return requested;
        },
        cancelAnimationFrame() {},
        matchMedia: () => reducedMotion,
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    const mounted = createAdapter({
      createStyleHost: () => createHost([]),
      createNativeAnimation() {
        native += 1;
        return;
      },
    }).mount({ boundary: target });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
    const observationFrames = requested;

    session.render(() => {
      const position = samplePresentationAnimation(
        "Fixture::position",
        120,
        spring({ initial: 0, stiffness: 500, damping: 42 }),
      );
      return { Root: { transform: { translate: { y: position.value } } } };
    });

    expect(session.inspect().animations.animations["Fixture::position"]).toMatchObject({
      value: 120,
      velocity: 0,
      settled: true,
    });
    expect(session.inspect().execution).toEqual({ kind: "canonical", reason: "no-animation" });
    expect(native).toBe(0);
    expect(requested).toBe(observationFrames);

    session.dispose();
    mounted.dispose();
  });

  it("retargets native motion from the displayed canonical value and velocity", async () => {
    let now = 0;
    let nextFrame = 0;
    const pending = new Map<number, FrameRequestCallback>();
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => now },
        requestAnimationFrame(callback: FrameRequestCallback) {
          const id = ++nextFrame;
          pending.set(id, callback);
          return id;
        },
        cancelAnimationFrame(id: number) {
          pending.delete(id);
        },
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    const native: Array<{
      keyframes: readonly Readonly<Record<string, string | number>>[];
      cancelled: boolean;
      currentTime: number | null;
    }> = [];
    const mounted = createAdapter({
      createStyleHost: () => createHost([]),
      createNativeAnimation(_target, keyframes) {
        const record = {
          keyframes,
          cancelled: false,
          currentTime: null as number | null,
        };
        native.push(record);
        return {
          finished: new Promise(() => undefined),
          get currentTime() {
            return record.currentTime;
          },
          set currentTime(value) {
            record.currentTime = value;
          },
          cancel() {
            record.cancelled = true;
          },
        };
      },
    }).mount({ boundary: target });
    const session = mounted.create({
      boundary: target,
      elements: { Root: () => [target] },
    });
    let destination = 120;
    const render = () =>
      session.render(() => {
        const identity = "Fixture::position";
        const position = samplePresentationAnimation(
          identity,
          destination,
          spring({ initial: 0, stiffness: 500, damping: 42 }),
        );
        return {
          Root: {
            transform: {
              translate: {
                y: animate.temporal(position.value, () => animate.value<number>(identity), [
                  identity,
                ]) as unknown as number,
              },
            },
          },
        };
      });

    render();
    now = 80;
    await Promise.resolve();
    destination = 0;
    render();

    expect(native).toHaveLength(2);
    expect(native[0]!.cancelled).toBe(true);
    const frame = session.inspect();
    const interrupted = frame.animations.animations["Fixture::position"]!;
    expect(interrupted.value).toBeGreaterThan(0);
    expect(interrupted.value).toBeLessThan(120);
    expect(interrupted.velocity).toBeGreaterThan(0);
    expect(native[1]!.keyframes[0]).toMatchObject({
      translate: `0 ${interrupted.value}px`,
      offset: 0,
    });
    expect(native[1]!.keyframes.at(-1)).toMatchObject({ translate: "0 0", offset: 1 });
    expect(native[1]!.currentTime).toBe(0);

    session.dispose();
    mounted.dispose();
    expect(native[1]!.cancelled).toBe(true);
  });

  it("realizes animated values through one stable CSS template", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    const target = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost(log) }).mount({
      boundary: target,
    });
    const session = mounted.create({
      boundary: target,
      elements: { Root: () => [target] },
    });
    let targetOpacity = 0.25;
    const render = () =>
      session.render(() => {
        const opacity = samplePresentationAnimation("Fixture::opacity", targetOpacity, follow());
        return { Root: { paint: { opacity: opacity.value, radius: 24 + 8 * opacity.value } } };
      });

    render();
    await Promise.resolve();
    const className = [...target.classes][0];
    const firstWrites = target.style.writes;
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("opacity:var(--");

    targetOpacity = 0.75;
    render();
    await Promise.resolve();
    expect([...target.classes]).toEqual([className]);
    expect(log).toHaveLength(1);
    expect(target.style.writes).toBeGreaterThan(firstWrites);

    const changedWrites = target.style.writes;
    render();
    expect(target.style.writes).toBe(changedWrites);

    session.dispose();
    mounted.dispose();
    expect(target.style.values.size).toBe(0);
  });

  it("commits one sampled coordinate across multiple Elements in one frame", () => {
    const ownerDocument = {};
    const root = createElement(ownerDocument);
    const panel = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: root,
    });
    const session = mounted.create({
      boundary: root,
      elements: { Root: () => [root], Panel: () => [panel] },
    });
    let evaluations = 0;

    session.render(() => {
      evaluations += 1;
      const progress = samplePresentationAnimation("Fixture::progress", 0.4, follow());
      return {
        Root: { paint: { opacity: progress.value } },
        Panel: {
          paint: { opacity: 1 - progress.value, radius: 20 * progress.value },
          transform: { translate: { y: 100 * (1 - progress.value) } },
        },
      };
    });

    expect(evaluations).toBe(1);
    expect([...root.style.values.values()]).toContain("0.4");
    expect([...panel.style.values.values()]).toEqual(
      expect.arrayContaining(["0.6", "8px", "60px"]),
    );
    session.dispose();
    mounted.dispose();
  });

  it("keeps diagnostic snapshots off the production render path", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
    });
    const session = mounted.create({
      boundary: target,
      elements: { Root: () => [target] },
    });
    let diagnosticReads = 0;
    const state = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(state, "diagnostic", {
      enumerable: true,
      get() {
        diagnosticReads += 1;
        return "only inspect me";
      },
    });

    session.render(() => ({ Root: { paint: { opacity: 0.7 } } }), {
      dynamic: true,
      behavior: { state },
    });
    expect(diagnosticReads).toBe(0);

    expect(session.inspect().behavior?.state).toEqual({ diagnostic: "only inspect me" });
    expect(diagnosticReads).toBe(1);
    session.inspect();
    expect(diagnosticReads).toBe(1);

    session.dispose();
    mounted.dispose();
  });

  it("shares one scoped trajectory with late-mounted sibling Components", async () => {
    let now = 0;
    let requests = 0;
    const pending = new Map<number, FrameRequestCallback>();
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => now },
        requestAnimationFrame(callback: FrameRequestCallback) {
          requests += 1;
          pending.set(requests, callback);
          return requests;
        },
        cancelAnimationFrame(handle: number) {
          pending.delete(handle);
        },
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const boundary = createElement(ownerDocument);
    const firstTarget = createElement(ownerDocument);
    const secondTarget = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({ boundary });
    const scope = {};
    const first = mounted.create({
      boundary: firstTarget,
      elements: { Root: () => [firstTarget] },
      scopes: [scope],
    });
    const sheetSpring = spring({ initial: 0, stiffness: 500, damping: 40 });
    const samples = { first: [] as number[], second: [] as number[] };
    const render = (session: typeof first, name: keyof typeof samples) =>
      session.render(({ scopes }) => {
        const progress = scopes[0]!.evaluate(() =>
          samplePresentationAnimation("Dashboard::progress", 1, sheetSpring),
        );
        samples[name].push(progress.value);
        return { Root: { paint: { opacity: progress.value } } };
      });

    render(first, "first");
    now = 40;
    const firstCallbacks = [...pending.values()];
    pending.clear();
    for (const callback of firstCallbacks) callback(40);
    expect(samples.first.at(-1)).toBeGreaterThan(0);

    await Promise.resolve();
    const second = mounted.create({
      boundary: secondTarget,
      elements: { Root: () => [secondTarget] },
      scopes: [scope],
    });
    render(second, "second");
    expect(samples.second[0]).toBe(samples.first.at(-1));

    now = 80;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(80);
    expect(samples.first.at(-1)).toBe(samples.second.at(-1));
    expect(samples.first.at(-1)).toBeGreaterThan(0);

    first.dispose();
    second.dispose();
    mounted.dispose();
  });

  it("restores canonical animation continuity across a full adapter replacement", () => {
    let now = 0;
    const ownerDocument = {
      defaultView: {
        innerWidth: 1_280,
        innerHeight: 720,
        performance: { now: () => now },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        addEventListener() {},
        removeEventListener() {},
      },
    };
    const target = createElement(ownerDocument);
    const relation = spring({ initial: 0, stiffness: 500, damping: 40 });
    const firstRoot = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
    });
    const first = firstRoot.create({
      boundary: target,
      identity: "Dashboard:0",
      elements: { Root: () => [target] },
    });
    const render = (session: typeof first) =>
      session.render(() => {
        const progress = samplePresentationAnimation("Dashboard::progress", 1, relation);
        return { Root: { paint: { opacity: progress.value } } };
      });
    render(first);
    now = 70;
    const snapshot = firstRoot.snapshot() as {
      sessions: Record<
        string,
        readonly Readonly<{
          channels: readonly Readonly<{
            identity: string;
            value: number;
            velocity: number;
          }>[];
        }>[]
      >;
    };
    const prior = snapshot.sessions["Dashboard:0"]![0]!.channels.find(
      ({ identity }) => identity === "Dashboard::progress",
    )!;
    first.dispose();
    firstRoot.dispose();

    const nextRoot = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
      snapshot,
    });
    const next = nextRoot.create({
      boundary: target,
      identity: "Dashboard:0",
      elements: { Root: () => [target] },
    });
    render(next);
    const restored = next.inspect().animations.animations["Dashboard::progress"]!;
    expect(restored.value).toBeCloseTo(prior.value, 10);
    expect(restored.velocity).toBeCloseTo(prior.velocity, 10);
    next.dispose();
    nextRoot.dispose();
  });

  it("allows a shared scope to retarget in a sequential frame with the same clock sample", () => {
    const ownerDocument = {};
    const boundary = createElement(ownerDocument);
    const firstTarget = createElement(ownerDocument);
    const secondTarget = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({ boundary });
    const scope = {};
    const first = mounted.create({
      boundary: firstTarget,
      elements: { Root: () => [firstTarget] },
      scopes: [scope],
    });
    const second = mounted.create({
      boundary: secondTarget,
      elements: { Root: () => [secondTarget] },
      scopes: [scope],
    });

    first.render(({ scopes }) => {
      const phase = scopes[0]!.evaluate(() =>
        samplePresentationAnimation("Dashboard::phase", 0, follow()),
      );
      return { Root: { paint: { opacity: phase.value } } };
    });
    second.render(({ scopes }) => {
      const phase = scopes[0]!.evaluate(() =>
        samplePresentationAnimation("Dashboard::phase", 1, follow()),
      );
      return { Root: { paint: { opacity: phase.value } } };
    });
    expect(second.inspect().scopes[0]?.animations["Dashboard::phase"]?.source).toBe(1);
    expect(secondTarget.style.writes).toBeGreaterThan(0);

    first.dispose();
    second.dispose();
    mounted.dispose();
  });

  it("does not let a borrowing Component reconfiguration delete its parent scope", () => {
    const ownerDocument = {};
    const boundary = createElement(ownerDocument);
    const parentTarget = createElement(ownerDocument);
    const childTarget = createElement(ownerDocument);
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({ boundary });
    const scope = {};
    const parent = mounted.create({
      boundary: parentTarget,
      elements: { Root: () => [parentTarget] },
      scopes: [scope],
    });
    const child = mounted.create({
      boundary: childTarget,
      elements: { Root: () => [childTarget] },
      scopes: [scope],
    });

    parent.render(({ scopes }) => {
      scopes[0]!.evaluate(() =>
        samplePresentationAnimation(
          "Dashboard::phase",
          1,
          spring({ initial: 0, stiffness: 520, damping: 42 }),
        ),
      );
      return {};
    });
    child.reconfigure();
    child.render(() => ({}));

    expect(child.inspect().scopes[0]?.animations["Dashboard::phase"]).toBeDefined();
    parent.dispose();
    child.dispose();
    mounted.dispose();
  });

  it("emits newly acquired CSS before measuring layout continuity", async () => {
    const operations: string[] = [];
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    target.getBoundingClientRect = () => {
      operations.push("geometry");
      return {
        width: 100,
        height: 40,
        left: 0,
        top: 0,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON() {},
      };
    };
    const mounted = createAdapter({
      createStyleHost: () => ({
        replace() {
          operations.push("css");
        },
        dispose() {},
      }),
    }).mount({ boundary: target });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
    await Promise.resolve();
    operations.length = 0;
    session.render(() => ({
      Root: {
        layout: { inlineSize: 100 },
        continuity: { dynamics: spring({ stiffness: 500, damping: 40 }) },
      },
    }));
    await Promise.resolve();
    expect(operations).toEqual(["css", "geometry"]);
    session.dispose();
    mounted.dispose();
  });

  it("commits and inspects one canonical frame including layout continuity", async () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const box = { width: 100, height: 40, left: 0, top: 0 };
    target.getBoundingClientRect = () => ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON() {},
    });
    target.style.setProperty("transform", "rotate(2deg)");
    const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
      boundary: target,
    });
    const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
    const behaviorState = { expanded: true };
    const behavior = { state: behaviorState };
    const frame = () =>
      session.render(
        () => {
          const opacity = samplePresentationAnimation("Fixture::opacity", 0.75, follow());
          return {
            Root: {
              paint: { opacity: opacity.value },
              continuity: { dynamics: spring({ stiffness: 500, damping: 40 }) },
            },
          };
        },
        { behavior },
      );

    frame();
    await Promise.resolve();
    box.left = 120;
    frame();
    await Promise.resolve();

    const inspection = session.inspect();
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(inspection.behavior).toEqual({ state: { expanded: true } });
    behaviorState.expanded = false;
    expect(inspection.behavior?.state).toEqual({ expanded: true });
    expect(inspection.animations.animations["Fixture::opacity"]).toMatchObject({
      value: 0.75,
      velocity: 0,
      settled: true,
    });
    expect(inspection.observations.Root.layout).toMatchObject({
      current: { inlineStart: 0 },
      destination: { inlineStart: 120 },
      kind: "layout",
      settled: false,
    });
    expect(inspection.artifacts.elements.Root).toMatchObject({
      execution: { kind: "canonical", reason: "dynamic-declaration" },
      ownership: {
        opacity: "presentation",
        transform: "layout",
        "transform-origin": "layout",
      },
      continuity: { strategy: "position" },
    });
    expect(inspection.frame).toMatchObject({
      time: inspection.time,
      input: {
        behavior: { state: { expanded: true } },
        observations: { Root: expect.any(Object) },
      },
      temporal: {
        local: {
          animations: {
            "Fixture::opacity": { value: 0.75, velocity: 0, settled: true },
          },
        },
      },
      declarations: { Root: { paint: { opacity: 0.75 } } },
    });
    expect(Object.isFrozen(inspection.frame.input)).toBe(true);
    expect(JSON.stringify(inspection.frame)).toBe(JSON.stringify(inspection.frame));
    expect(inspection.elements.Root[0]).toMatchObject({
      target,
      properties: {
        transform: expect.stringContaining("translate(-120px,0px)"),
        "transform-origin": "0 0",
      },
    });
    expect(target.style.getPropertyValue("transform")).toBe(
      inspection.elements.Root[0]!.properties.transform,
    );

    session.dispose();
    mounted.dispose();
    expect(target.style.getPropertyValue("transform")).toBe("rotate(2deg)");
  });

  it("matches every native write to one inspected frame across generated retarget traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            elapsed: fc.integer({ min: 0, max: 120 }),
            target: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        async (trace) => {
          let now = 0;
          let handle = 0;
          const pending = new Map<number, FrameRequestCallback>();
          const ownerDocument = {
            defaultView: {
              innerWidth: 1_280,
              innerHeight: 720,
              performance: { now: () => now },
              requestAnimationFrame(callback: FrameRequestCallback) {
                handle += 1;
                pending.set(handle, callback);
                return handle;
              },
              cancelAnimationFrame(cancelled: number) {
                pending.delete(cancelled);
              },
              addEventListener() {},
              removeEventListener() {},
            },
          };
          const ledger = new MutationLedger();
          const target = createElement(ownerDocument, ["authored"], "div", ledger);
          const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
            boundary: target,
          });
          const session = mounted.create({
            boundary: target,
            elements: { Root: () => [target] },
          });
          const progressSpring = spring({ initial: 0, stiffness: 500, damping: 40 });
          let destination = 0;
          let evaluations = 0;
          const render = () =>
            session.render(
              () => {
                evaluations += 1;
                const progress = samplePresentationAnimation(
                  "Fixture::progress",
                  destination,
                  progressSpring,
                );
                const bounded = Math.max(0, Math.min(1, progress.value));
                return {
                  Root: {
                    paint: { opacity: bounded, radius: 12 + 16 * bounded },
                    transform: { translate: { y: 80 * progress.value } },
                  },
                };
              },
              { behavior: { state: { destination } } },
            );

          render();
          await settleTurn();
          expectNativeFrame(target, session.inspect());

          for (const operation of trace) {
            now += operation.elapsed;
            destination = operation.target;
            render();
            await settleTurn();
            expectNativeFrame(target, session.inspect());

            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) callback(now);
            await settleTurn();
            expectNativeFrame(target, session.inspect());
          }

          now += 100_000;
          const finalCallbacks = [...pending.values()];
          pending.clear();
          for (const callback of finalCallbacks) callback(now);
          await settleTurn();
          expectNativeFrame(target, session.inspect());
          expect(pending.size).toBe(0);

          const settledWrites = ledger.entries.length;
          await settleTurn();
          expect(ledger.entries).toHaveLength(settledWrites);
          expect(evaluations).toBeGreaterThanOrEqual(trace.length + 1);

          session.dispose();
          mounted.dispose();
          const disposedWrites = ledger.entries.length;
          await settleTurn();
          expect(ledger.entries).toHaveLength(disposedWrites);
          expect(target.classes).toEqual(new Set(["authored"]));
          expect(target.style.values.size).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("replays a captured declaration frame identically in an independent root", () => {
    const create = (render: boolean) => {
      const ownerDocument = {};
      const target = createElement(ownerDocument, ["authored"]);
      const mounted = createAdapter({ createStyleHost: () => createHost([]) }).mount({
        boundary: target,
      });
      const session = mounted.create({ boundary: target, elements: { Root: () => [target] } });
      if (render) {
        session.render(
          () => {
            const phase = samplePresentationAnimation("Fixture::phase", 0.375, follow(12));
            return {
              Root: {
                paint: { opacity: phase.value, radius: 24 * phase.value },
                transform: { translate: { x: 80 * phase.value } },
              },
            };
          },
          { behavior: { state: { selected: true }, props: { density: "compact" } } },
        );
      }
      return { mounted, session, target };
    };
    const first = create(true);
    const captured = first.session.inspect();
    const second = create(false);
    second.session.render(() => captured.declarations, {
      dynamic: captured.dynamic,
      ...(captured.behavior ? { behavior: captured.behavior } : {}),
    });
    const replayed = second.session.inspect();

    expect(comparableOutput(captured)).toEqual(comparableOutput(replayed));
    expectNativeFrame(first.target, captured);
    expectNativeFrame(second.target, replayed);

    first.session.dispose();
    first.mounted.dispose();
    second.session.dispose();
    second.mounted.dispose();
  });

  it("shares deterministic CSS classes without touching unrelated classes", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    const root = createElement(ownerDocument, ["authored"]);
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const session = createTestPresentationAdapter({
      createStyleHost: () => createHost(log),
    }).create({
      boundary: root,
      elements: { Root: () => [root], Item: () => [first, second] },
    });

    session.render({
      Root: { layout: { model: { kind: "flow", direction: "block" } } },
      Item: { paint: { opacity: 0.7 } },
    });
    await Promise.resolve();

    const itemClass = [...first.classes][0];
    expect(itemClass).toBeDefined();
    expect(second.classes).toEqual(new Set([itemClass!]));
    expect(root.classes).toContain("authored");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^@layer poggers\.reset,poggers\.presentation;/);
    expect(log[0]).toContain("box-sizing:border-box");
    expect(log[0]).toContain("opacity:0.7");

    session.render({ Root: { paint: { opacity: 0.5 } } });
    expect(first.classes.size).toBe(0);
    expect(second.classes.size).toBe(0);
    expect(root.classes).toContain("authored");
    expect(root.classes.size).toBe(2);

    session.dispose();
    expect(root.classes).toEqual(new Set(["authored"]));
    expect(log.at(-1)).toBe("dispose");
    expect(() => session.render({})).toThrow("disposed web Presentation session");
  });

  it("deduplicates rules across sessions in the same Document", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    let hosts = 0;
    const adapter = createTestPresentationAdapter({
      createStyleHost: () => {
        hosts += 1;
        return createHost(log);
      },
    });
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const a = adapter.create({ boundary: first, elements: { Root: () => [first] } });
    const b = adapter.create({ boundary: second, elements: { Root: () => [second] } });
    const declaration = { Root: { paint: { opacity: 0.6 } } } as const;

    a.render(declaration);
    b.render(declaration);
    await Promise.resolve();
    expect(hosts).toBe(1);
    expect(first.classes).toEqual(second.classes);
    expect(log.at(-1)?.match(/opacity:0\.6/g)).toHaveLength(1);

    a.dispose();
    expect(log.at(-1)).not.toBe("dispose");
    b.dispose();
    expect(log.at(-1)).toBe("dispose");
  });

  it("rejects a native Element owned by conflicting names before mutation", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const session = createTestPresentationAdapter({ createStyleHost: () => createHost([]) }).create(
      {
        boundary: target,
        elements: { Root: () => [target], Label: () => [target] },
      },
    );

    expect(() =>
      session.render({
        Root: { paint: { opacity: 1 } },
        Label: { paint: { opacity: 0.5 } },
      }),
    ).toThrow("already owned by another name");
    expect(target.classes.size).toBe(0);
    session.dispose();
  });

  it("coalesces sessions and keeps previously emitted rules warm", async () => {
    const ownerDocument = {};
    const log: string[] = [];
    const adapter = createTestPresentationAdapter({ createStyleHost: () => createHost(log) });
    const first = createElement(ownerDocument);
    const second = createElement(ownerDocument);
    const a = adapter.create({ boundary: first, elements: { Root: () => [first] } });
    const b = adapter.create({ boundary: second, elements: { Root: () => [second] } });
    const compact = { Root: { paint: { opacity: 0.7 } } } as const;
    const comfortable = { Root: { paint: { opacity: 1 } } } as const;

    a.render(compact);
    b.render(compact);
    await Promise.resolve();
    expect(log).toHaveLength(1);

    a.render(comfortable);
    b.render(comfortable);
    await Promise.resolve();
    expect(log).toHaveLength(2);

    a.render(compact);
    b.render(compact);
    await Promise.resolve();
    expect(log).toHaveLength(2);

    a.dispose();
    b.dispose();
    expect(log.at(-1)).toBe("dispose");
  });

  it("binds feedback-only meaning without generating a CSS class", () => {
    const ownerDocument = {};
    const feedbackLog: unknown[] = [];
    const styleLog: string[] = [];
    const target = createElement(ownerDocument);
    const audio = createAudioAsset("control.wav");
    const session = createTestPresentationAdapter({
      createStyleHost: () => createHost(styleLog),
      createFeedbackHost: () => createFeedbackHost(feedbackLog),
    }).create({ boundary: target, elements: { Control: () => [target] } });

    session.render({ Control: { feedback: { activate: { audio } } } });
    expect(target.classes.size).toBe(0);
    expect(feedbackLog).toEqual([[target, { activate: { audio } }]]);
    expect(styleLog).toEqual([]);

    session.render({ Control: { feedback: { activate: { audio } } } });
    expect(feedbackLog).toHaveLength(1);

    session.render({});
    expect(feedbackLog.at(-1)).toEqual([target, undefined]);
    session.dispose();
    expect(feedbackLog.at(-1)).toBe("dispose");
  });

  it("substitutes image assets in place and restores authored Structure", () => {
    const ownerDocument = {};
    const styleLog: string[] = [];
    const boundary = createElement(ownerDocument);
    const icon = createElement(ownerDocument, [], "img");
    icon.setAttribute("src", "authored.svg");
    icon.attributeWrites.length = 0;
    const warm = createImageAsset("warm.svg");
    const cool = createImageAsset("cool.svg");
    const session = createTestPresentationAdapter({
      createStyleHost: () => createHost(styleLog),
    }).create({ boundary, elements: { Icon: () => [icon] } });

    session.render({ Icon: { image: warm } });
    expect(icon.getAttribute("src")).toBe("warm.svg");
    expect(icon.attributeWrites).toEqual(["src=warm.svg"]);
    expect(icon.classes.size).toBe(0);
    expect(styleLog).toEqual([]);

    session.render({ Icon: { image: createImageAsset("warm.svg") } });
    expect(icon.attributeWrites).toEqual(["src=warm.svg"]);
    session.render({ Icon: { image: cool } });
    expect(icon.getAttribute("src")).toBe("cool.svg");
    expect(icon.attributeWrites.at(-1)).toBe("src=cool.svg");

    session.dispose();
    expect(icon.getAttribute("src")).toBe("authored.svg");
    expect(icon.attributeWrites.at(-1)).toBe("src=authored.svg");
  });

  it("rejects image meaning on a non-image Structure target", () => {
    const ownerDocument = {};
    const target = createElement(ownerDocument);
    const session = createTestPresentationAdapter().create({
      boundary: target,
      elements: { Icon: () => [target] },
    });

    expect(() => session.render({ Icon: { image: createImageAsset("icon.svg") } })).toThrow(
      "only target an img Element",
    );
    session.dispose();
  });

  it("normalizes passive mouse, touch, keyboard, disabled, and disposal semantics", () => {
    const listeners = new Map<string, EventListener>();
    const ownerDocument = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener as EventListener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    const target = createElement(ownerDocument);
    const audio = createAudioAsset("control.wav");
    const calls: string[] = [];
    const host = createNativeFeedbackHost(target, {
      prepare: () => calls.push("prepare"),
      play: () => calls.push("play"),
      dispose: () => calls.push("dispose"),
    });
    host.set(target, { activate: { audio } });

    const emit = (type: string, event: object) =>
      listeners.get(type)?.({ composedPath: () => [target], ...event } as unknown as Event);
    emit("pointerdown", { button: 0, pointerType: "mouse" });
    emit("click", { detail: 1 });
    expect(calls).toEqual(["prepare", "play"]);

    emit("pointerdown", { button: 0, pointerType: "touch" });
    emit("click", { detail: 1 });
    emit("click", { detail: 0 });
    expect(calls).toEqual(["prepare", "play", "play", "play"]);

    (target as unknown as { disabled: boolean }).disabled = true;
    emit("pointerdown", { button: 0, pointerType: "mouse" });
    emit("click", { detail: 0 });
    expect(calls).toEqual(["prepare", "play", "play", "play"]);

    host.dispose();
    expect(calls.at(-1)).toBe("dispose");
    expect(listeners.size).toBe(0);
    host.dispose();
    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
  });

  it("shares one AudioContext and decoded buffer across warm playback", async () => {
    let contexts = 0;
    let decodes = 0;
    let fetches = 0;
    let sources = 0;
    let closes = 0;
    let disconnects = 0;
    class FakeAudioContext {
      state = "suspended";
      destination = {};
      constructor() {
        contexts += 1;
      }
      async decodeAudioData() {
        decodes += 1;
        return {};
      }
      async resume() {
        this.state = "running";
      }
      createBufferSource() {
        sources += 1;
        return {
          buffer: undefined,
          playbackRate: { value: 1 },
          connect() {
            return this;
          },
          disconnect() {
            disconnects += 1;
          },
          addEventListener() {},
          start() {},
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect() {
            return this;
          },
          disconnect() {
            disconnects += 1;
          },
        };
      }
      async close() {
        closes += 1;
        this.state = "closed";
      }
    }
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    });
    const output = createNativeAudioOutput({
      defaultView: { AudioContext: FakeAudioContext },
    } as unknown as Document);
    const asset = createAudioAsset("control.wav", { gain: 0.4 });

    output.prepare(asset);
    output.prepare(asset);
    output.play(asset);
    output.play(asset);
    for (let index = 0; index < 8; index++) await Promise.resolve();

    expect({ contexts, fetches, decodes, sources }).toEqual({
      contexts: 1,
      fetches: 1,
      decodes: 1,
      sources: 2,
    });
    output.dispose();
    await Promise.resolve();
    expect(closes).toBe(1);
    expect(disconnects).toBe(4);
    vi.unstubAllGlobals();
  });

  it("emits each declaration meaning once for random commit traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 40 }),
        async (opacities) => {
          const ownerDocument = {};
          const log: string[] = [];
          const target = createElement(ownerDocument);
          const session = createTestPresentationAdapter({
            createStyleHost: () => createHost(log),
          }).create({ boundary: target, elements: { Root: () => [target] } });

          for (const opacity of opacities) {
            session.render({ Root: { paint: { opacity: opacity / 5 } } });
            await Promise.resolve();
          }

          expect(log).toHaveLength(new Set(opacities).size);
          expect(target.classes.size).toBe(1);
          session.dispose();
        },
      ),
      { numRuns: 50 },
    );
  });
});
