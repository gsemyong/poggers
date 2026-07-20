import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createWebFrameHost } from "./frame";
import { createWebLayoutHost, readWebLayoutGeometry } from "./layout";
import { spring } from "./spring";

const continuity = { dynamics: spring({ stiffness: 500, damping: 40 }) } as const;

describe("web Presentation layout continuity", () => {
  it("publishes layout frame properties without mutating the Element", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(target.style.getPropertyValue("transform")).toBe("");

    target.box.left = 120;
    target.box.width = 150;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(layoutTransform(harness.layouts, target)).toContain("translate(-120px,0px)");
    expect(layoutTransform(harness.layouts, target)).toContain("scale(1,1)");
    expect(target.style.getPropertyValue("transform")).toBe("");
    expect(harness.layouts.inspect().moving).toBe(1);

    harness.flush(100_000);
    expect(target.style.getPropertyValue("transform")).toBe("");
    expect(target.style.getPropertyValue("transform-origin")).toBe("");
    expect(harness.layouts.inspect().moving).toBe(0);
    harness.dispose();
  });

  it("scales intrinsic content only after explicit transform-strategy opt-in", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    const scaled = { ...continuity, strategy: "transform" } as const;
    harness.layouts.update(owner, new Map([[target, scaled]]));
    await Promise.resolve();

    target.box.width = 200;
    harness.layouts.update(owner, new Map([[target, scaled]]));
    await Promise.resolve();
    expect(layoutTransform(harness.layouts, target)).toContain("scale(0.5,1)");
    harness.dispose();
  });

  it("retargets from displayed geometry during interruption", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 100;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    harness.flush(60);
    const before = target.box.left + translateX(layoutTransform(harness.layouts, target, 60));

    harness.time = 60;
    target.box.left = 220;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    const after = target.box.left + translateX(layoutTransform(harness.layouts, target, 60));
    expect(after).toBeCloseTo(before, 8);
    harness.dispose();
  });

  it("preserves displayed geometry through arbitrary finite retarget traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            left: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
            width: fc.double({ min: 1, max: 1_000, noNaN: true }),
            elapsed: fc.integer({ min: 0, max: 250 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        async (trace) => {
          const harness = createHarness();
          const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
          const owner = {};
          harness.layouts.update(owner, new Map([[target, continuity]]));
          await Promise.resolve();
          let time = 0;

          for (const step of trace) {
            const before =
              target.box.left + translateXOrZero(layoutTransform(harness.layouts, target, time));
            harness.time = time;
            target.box.left = step.left;
            target.box.width = step.width;
            harness.layouts.update(owner, new Map([[target, continuity]]));
            await Promise.resolve();
            const after =
              target.box.left + translateXOrZero(layoutTransform(harness.layouts, target, time));
            expect(after).toBeCloseTo(before, 7);

            time += step.elapsed;
            harness.flush(time);
          }
          harness.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("publishes cached geometry, velocity, progress, and settlement on the root clock", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    const frames: number[] = [];
    harness.layouts.update(owner, new Map([[target, continuity]]), (time) => frames.push(time));
    await Promise.resolve();

    target.box.left = 120;
    target.box.width = 150;
    harness.layouts.update(owner, new Map([[target, continuity]]), (time) => frames.push(time));
    await Promise.resolve();
    expect(harness.layouts.sample(target)).toMatchObject({
      current: { inlineStart: 0, inlineSize: 150 },
      destination: { inlineStart: 120, inlineSize: 150 },
      progress: 0,
      kind: "layout",
      settled: false,
    });

    harness.flush(60);
    const moving = harness.layouts.sample(target, 60);
    expect(moving.current.inlineStart).toBeGreaterThan(0);
    expect(moving.current.inlineStart).toBeLessThan(120);
    expect(moving.velocity.inlineStart).toBeGreaterThan(0);
    expect(moving.progress).toBeGreaterThan(0);
    expect(frames).toContain(60);

    harness.flush(100_000);
    expect(harness.layouts.sample(target, 100_000)).toEqual({
      current: { inlineStart: 120, blockStart: 0, inlineSize: 150, blockSize: 40 },
      destination: { inlineStart: 120, blockStart: 0, inlineSize: 150, blockSize: 40 },
      velocity: { inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 },
      progress: 1,
      kind: "idle",
      settled: true,
    });
    harness.dispose();
  });

  it("synchronizes native resize geometry without starting continuity", async () => {
    let notifyResize: ResizeObserverCallback | undefined;
    const boundary = {
      ownerDocument: {
        defaultView: {
          ResizeObserver: class {
            constructor(callback: ResizeObserverCallback) {
              notifyResize = callback;
            }
            observe() {}
            disconnect() {}
          },
          addEventListener() {},
          removeEventListener() {},
        },
      },
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Element;
    const harness = createHarness(false, boundary);
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 96;
    target.box.height = 72;
    notifyResize?.([], {} as ResizeObserver);
    await Promise.resolve();

    expect(harness.layouts.inspect().moving).toBe(0);
    expect(layoutTransform(harness.layouts, target)).toBe("");
    expect(harness.layouts.sample(target)).toMatchObject({
      current: { inlineStart: 96, blockSize: 72 },
      destination: { inlineStart: 96, blockSize: 72 },
      settled: true,
    });
    harness.dispose();
  });

  it("cancels stale continuity and exactly follows arbitrary external resize traces", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            left: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
            top: fc.double({ min: -1_000, max: 1_000, noNaN: true }),
            width: fc.double({ min: 1, max: 2_000, noNaN: true }),
            height: fc.double({ min: 1, max: 2_000, noNaN: true }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        async (trace) => {
          let notifyResize: ResizeObserverCallback | undefined;
          const boundary = {
            ownerDocument: {
              defaultView: {
                ResizeObserver: class {
                  constructor(callback: ResizeObserverCallback) {
                    notifyResize = callback;
                  }
                  observe() {}
                  disconnect() {}
                },
                addEventListener() {},
                removeEventListener() {},
              },
            },
            addEventListener() {},
            removeEventListener() {},
          } as unknown as Element;
          const harness = createHarness(false, boundary);
          const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
          const owner = {};
          harness.layouts.update(owner, new Map([[target, continuity]]));
          await Promise.resolve();

          target.box.left = 100;
          harness.layouts.update(owner, new Map([[target, continuity]]));
          await Promise.resolve();
          expect(harness.layouts.inspect().moving).toBe(1);

          for (const box of trace) {
            Object.assign(target.box, box);
            notifyResize?.([], {} as ResizeObserver);
            await Promise.resolve();
            expect(harness.layouts.inspect().moving).toBe(0);
            expect(harness.layouts.resolve(target)).toBeUndefined();
            expect(harness.layouts.sample(target)).toMatchObject({
              current: {
                inlineStart: box.left,
                blockStart: box.top,
                inlineSize: box.width,
                blockSize: box.height,
              },
              settled: true,
            });
          }
          harness.dispose();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("starts continuity after a structural child-list transaction", async () => {
    let notifyMutation: MutationCallback | undefined;
    const boundary = {
      ownerDocument: {
        defaultView: {
          MutationObserver: class {
            constructor(callback: MutationCallback) {
              notifyMutation = callback;
            }
            observe() {}
            disconnect() {}
          },
          addEventListener() {},
          removeEventListener() {},
        },
      },
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Element;
    const harness = createHarness(false, boundary);
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    harness.layouts.update({}, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 144;
    notifyMutation?.([], {} as MutationObserver);
    await Promise.resolve();

    expect(harness.layouts.inspect().moving).toBe(1);
    expect(layoutTransform(harness.layouts, target)).toContain("translate(-144px,0px)");
    harness.dispose();
  });

  it("does not animate from geometry captured while an ancestor is hidden", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 0, height: 0 });
    let visible = false;
    Object.assign(target, {
      getClientRects: () => (visible ? [{}] : []),
      isConnected: true,
    });
    const owner = {};

    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    visible = true;
    Object.assign(target.box, { left: 120, top: 80, width: 200, height: 100 });
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(harness.layouts.inspect().moving).toBe(0);
    expect(layoutTransform(harness.layouts, target)).toBe("");

    target.box.left = 180;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(harness.layouts.inspect().moving).toBe(1);
    expect(layoutTransform(harness.layouts, target)).toContain("translate(-60px,0px)");
    harness.dispose();
  });

  it("synchronizes intrinsic media and font changes and releases native listeners", async () => {
    const boundaryListeners = new Map<string, EventListener>();
    const viewListeners = new Map<string, EventListener>();
    const fontListeners = new Map<string, EventListener>();
    const boundary = {
      ownerDocument: {
        fonts: {
          addEventListener(name: string, listener: EventListener) {
            fontListeners.set(name, listener);
          },
          removeEventListener(name: string) {
            fontListeners.delete(name);
          },
        },
        defaultView: {
          addEventListener(name: string, listener: EventListener) {
            viewListeners.set(name, listener);
          },
          removeEventListener(name: string) {
            viewListeners.delete(name);
          },
        },
      },
      addEventListener(name: string, listener: EventListener) {
        boundaryListeners.set(name, listener);
      },
      removeEventListener(name: string) {
        boundaryListeners.delete(name);
      },
    } as unknown as Element;
    const harness = createHarness(false, boundary);
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.width = 140;
    boundaryListeners.get("load")?.({} as Event);
    await Promise.resolve();
    expect(harness.layouts.inspect().moving).toBe(0);
    expect(harness.layouts.sample(target).current.inlineSize).toBe(140);

    target.box.width = 180;
    fontListeners.get("loadingdone")?.({} as Event);
    await Promise.resolve();
    expect(harness.layouts.inspect().moving).toBe(0);
    expect(harness.layouts.sample(target).current.inlineSize).toBe(180);

    harness.dispose();
    expect(boundaryListeners.size).toBe(0);
    expect(viewListeners.size).toBe(0);
    expect(fontListeners.size).toBe(0);
  });

  it("updates nested-scroll coordinates directly instead of animating scroll", async () => {
    const listeners = new Map<string, EventListener>();
    const boundary = {
      ownerDocument: { defaultView: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(name: string, listener: EventListener) {
        listeners.set(name, listener);
      },
      removeEventListener(name: string) {
        listeners.delete(name);
      },
    } as unknown as Element;
    const harness = createHarness(false, boundary);
    const target = createElement({ left: 20, top: 40, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.top = -80;
    listeners.get("scroll")?.({} as Event);
    await Promise.resolve();
    expect(harness.layouts.inspect().moving).toBe(0);
    expect(target.style.getPropertyValue("transform")).toBe("");

    target.box.top = 20;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(layoutTransform(harness.layouts, target)).toContain("translate(0px,-100px)");
    harness.dispose();
    expect(listeners.size).toBe(0);
  });

  it("preserves active continuity while shifting its viewport coordinates on scroll", async () => {
    const listeners = new Map<string, EventListener>();
    const boundary = {
      ownerDocument: { defaultView: { addEventListener() {}, removeEventListener() {} } },
      addEventListener(name: string, listener: EventListener) {
        listeners.set(name, listener);
      },
      removeEventListener(name: string) {
        listeners.delete(name);
      },
    } as unknown as Element;
    const harness = createHarness(false, boundary);
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 100;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    harness.flush(60);
    const before = target.box.left + translateX(layoutTransform(harness.layouts, target, 60));

    harness.time = 60;
    target.box.left = 80;
    listeners.get("scroll")?.({} as Event);
    await Promise.resolve();
    const after = target.box.left + translateX(layoutTransform(harness.layouts, target, 60));
    expect(after).toBeCloseTo(before - 20, 8);
    expect(harness.layouts.inspect().moving).toBe(1);
    harness.dispose();
  });

  it("converts viewport deltas into the local coordinates of a scaled ancestor", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 200, height: 80 });
    Object.assign(target, { offsetWidth: 100, offsetHeight: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 200;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    expect(layoutTransform(harness.layouts, target)).toContain("translate(-100px,0px)");
    expect(harness.layouts.sample(target).current.inlineStart).toBe(0);
    harness.dispose();
  });

  it("fails precisely for a rotated ancestor that the axis-aligned driver cannot map", () => {
    const ancestor = { parentElement: null } as unknown as Element;
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    Object.assign(target, {
      parentElement: ancestor,
      ownerDocument: {
        defaultView: {
          getComputedStyle(element: Element) {
            return { transform: element === ancestor ? "matrix(0, 1, -1, 0, 0, 0)" : "none" };
          },
        },
      },
    });

    expect(() => readWebLayoutGeometry(target)).toThrow("axis-aligned ancestor transforms");
  });

  it("connects structural replacements through explicit visual identity", async () => {
    const harness = createHarness();
    const first = createElement({ left: 20, top: 10, width: 80, height: 40 });
    const second = createElement({ left: 220, top: 60, width: 160, height: 80 });
    const owner = {};
    const shared = { ...continuity, identity: "selected-card" } as const;
    harness.layouts.update(owner, new Map([[first, shared]]));
    await Promise.resolve();

    harness.layouts.update(owner, new Map([[second, shared]]));
    await Promise.resolve();
    expect(layoutTransform(harness.layouts, second)).toContain("translate(-200px,-50px)");
    expect(layoutTransform(harness.layouts, second)).toContain("scale(1,1)");
    expect(harness.layouts.resolve(first)).toBeUndefined();
    expect(harness.layouts.sample(second).kind).toBe("replacement");
    harness.dispose();
  });

  it("batches multiple owner updates into one geometry read per target", async () => {
    const harness = createHarness();
    const first = createElement({ left: 0, top: 0, width: 10, height: 10 });
    const second = createElement({ left: 20, top: 0, width: 10, height: 10 });
    harness.layouts.update({}, new Map([[first, continuity]]));
    harness.layouts.update({}, new Map([[second, continuity]]));
    await Promise.resolve();
    expect(first.reads).toBe(1);
    expect(second.reads).toBe(1);
    harness.dispose();
  });

  it("completes every geometry read before publishing a new frame", async () => {
    const operations: string[] = [];
    const harness = createHarness();
    const first = createElement({ left: 0, top: 0, width: 10, height: 10 }, operations, "first");
    const second = createElement({ left: 20, top: 0, width: 10, height: 10 }, operations, "second");
    const owner = {};
    harness.layouts.update(
      owner,
      new Map([
        [first, continuity],
        [second, continuity],
      ]),
      () => operations.push("frame"),
    );
    await Promise.resolve();

    operations.length = 0;
    first.box.left = 100;
    second.box.left = 200;
    harness.layouts.update(
      owner,
      new Map([
        [first, continuity],
        [second, continuity],
      ]),
      () => operations.push("frame"),
    );
    await Promise.resolve();

    const firstRead = Math.min(operations.indexOf("read:first"), operations.indexOf("read:second"));
    const lastRead = Math.max(
      operations.lastIndexOf("read:first"),
      operations.lastIndexOf("read:second"),
    );
    expect(
      operations.slice(firstRead, lastRead + 1).every((operation) => operation.startsWith("read:")),
    ).toBe(true);
    const published = operations.lastIndexOf("frame");
    expect(published).toBeGreaterThan(lastRead);
    expect(
      operations.slice(published + 1).some((operation) => operation.startsWith("write:")),
    ).toBe(false);
    expect(first.style.getPropertyValue("transform")).toBe("");
    expect(second.style.getPropertyValue("transform")).toBe("");
    expect(layoutTransform(harness.layouts, first)).toContain("translate(-100px,0px)");
    harness.dispose();
  });

  it("restores authored transform layers after untransformed geometry capture", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 10, height: 10 });
    target.style.setProperty("translate", "8px 4px");
    target.style.setProperty("scale", "0.9");
    harness.layouts.update({}, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(target.style.getPropertyValue("translate")).toBe("8px 4px");
    expect(target.style.getPropertyValue("scale")).toBe("0.9");
    expect(target.style.getPropertyValue("rotate")).toBe("");
    harness.dispose();
  });

  it("settles layout changes immediately under reduced motion", async () => {
    const harness = createHarness(true);
    const target = createElement({ left: 0, top: 0, width: 10, height: 10 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    target.box.left = 100;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(target.style.getPropertyValue("transform")).toBe("");
    expect(harness.layouts.inspect().moving).toBe(0);
    harness.dispose();
  });

  it("preserves intrinsic size while publishing size-change progress", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    const crisp = { ...continuity, strategy: "position" } as const;
    harness.layouts.update(owner, new Map([[target, crisp]]));
    await Promise.resolve();
    target.box.left = 80;
    target.box.width = 200;
    harness.layouts.update(owner, new Map([[target, crisp]]));
    await Promise.resolve();

    expect(layoutTransform(harness.layouts, target)).toContain("translate(-80px,0px) scale(1,1)");
    expect(harness.layouts.sample(target)).toMatchObject({
      current: { inlineStart: 0, inlineSize: 200 },
      destination: { inlineStart: 80, inlineSize: 200 },
      settled: false,
    });
    harness.dispose();
  });

  it("cancels active continuity when its owner removes the declaration", async () => {
    const harness = createHarness();
    const target = createElement({ left: 0, top: 0, width: 100, height: 40 });
    const owner = {};
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();

    target.box.left = 120;
    harness.layouts.update(owner, new Map([[target, continuity]]));
    await Promise.resolve();
    expect(harness.layouts.inspect()).toMatchObject({ entries: 1, moving: 1 });

    harness.layouts.remove(owner);
    await Promise.resolve();
    expect(harness.layouts.resolve(target)).toBeUndefined();
    expect(harness.layouts.inspect()).toMatchObject({ entries: 0, moving: 0, scheduled: false });
    harness.dispose();
  });
});

function createHarness(reducedMotion = false, boundary?: Element) {
  let now = 0;
  let pending: FrameRequestCallback | undefined;
  const frames = createWebFrameHost({
    now: () => now,
    requestFrame(callback) {
      pending = callback;
      return 1;
    },
    cancelFrame() {
      pending = undefined;
    },
    queueTurn: queueMicrotask,
  });
  const layouts = createWebLayoutHost(frames, () => reducedMotion, boundary);
  return {
    layouts,
    set time(value: number) {
      now = value;
    },
    flush(time: number) {
      now = time;
      const callback = pending;
      pending = undefined;
      callback?.(time);
    },
    dispose() {
      layouts.dispose();
      frames.dispose();
    },
  };
}

class FakeStyle {
  readonly values = new Map<string, string>();

  constructor(
    private readonly operations?: string[],
    private readonly label?: string,
  ) {}

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }

  getPropertyPriority(): string {
    return "";
  }

  setProperty(name: string, value: string): void {
    this.operations?.push(`write:${this.label}:${name}`);
    this.values.set(name, value);
  }

  removeProperty(name: string): string {
    this.operations?.push(`write:${this.label}:${name}`);
    const value = this.getPropertyValue(name);
    this.values.delete(name);
    return value;
  }
}

function createElement(
  box: { left: number; top: number; width: number; height: number },
  operations?: string[],
  label = "target",
) {
  const style = new FakeStyle(operations, label);
  let reads = 0;
  return {
    box,
    style,
    get reads() {
      return reads;
    },
    getBoundingClientRect() {
      operations?.push(`read:${label}`);
      reads += 1;
      return {
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON() {},
      };
    },
  } as unknown as Element & {
    box: typeof box;
    style: FakeStyle;
    readonly reads: number;
  };
}

function translateX(transform: string): number {
  const match = /^translate\(([-\d.eE]+)px,/.exec(transform);
  if (!match) throw new Error(`Missing layout translation in ${transform}.`);
  return Number(match[1]);
}

function translateXOrZero(transform: string): number {
  return transform ? translateX(transform) : 0;
}

function layoutTransform(
  layouts: ReturnType<typeof createWebLayoutHost>,
  target: Element,
  time?: number,
): string {
  return layouts.resolve(target, time)?.transform ?? "";
}
