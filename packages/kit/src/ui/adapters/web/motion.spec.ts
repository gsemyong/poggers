import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  createAnimeMotionBackend,
  createAdaptiveMotionBackend,
  createWaapiMotionBackend,
  createAnimeLayoutBackend,
  restrictAnimeLayoutOwnership,
  animeTransitionTiming,
  normalizeSpringVelocity,
  resolveMotionBackend,
  runSnapshotTransition,
  sampleTransition,
  RetainedLayoutGraph,
  RetainedMotionGraph,
  RetainedTransformComposer,
  type AnimeMotionController,
  type AnimeMotionFactory,
  type MotionBackend,
  type MotionChannelAdapter,
  type MotionScheduler,
  type MotionTarget,
  type LayoutBackend,
  type LayoutChannelAdapter,
} from "#ui/adapters/web/motion";
class TestScheduler implements MotionScheduler {
  #callbacks = new Map<number, (time: number) => void>();
  #next = 1;
  #time = 0;

  now(): number {
    return this.#time;
  }

  requestFrame(callback: (time: number) => void): number {
    const handle = this.#next++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: unknown): void {
    this.#callbacks.delete(handle as number);
  }

  advance(milliseconds = 16): void {
    this.#time += milliseconds;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback(this.#time);
  }

  get pending(): number {
    return this.#callbacks.size;
  }
}

type AdapterRecord = {
  readonly key: string;
  readonly writes: number[];
  readonly targets: MotionTarget[];
  value: number;
  currentVelocity: number;
  stops: number;
  disposals: number;
};

function createBackend(): { backend: MotionBackend; records: Map<string, AdapterRecord> } {
  const records = new Map<string, AdapterRecord>();
  return {
    records,
    backend: {
      create(key, initial): MotionChannelAdapter {
        const record: AdapterRecord = {
          key,
          writes: [initial],
          targets: [],
          value: initial,
          currentVelocity: 0,
          stops: 0,
          disposals: 0,
        };
        records.set(key, record);
        return {
          read: () => record.value,
          velocity: () => record.currentVelocity,
          write(value) {
            record.value = value;
            record.writes.push(value);
          },
          retarget(target) {
            record.targets.push(target);
          },
          stop() {
            record.stops += 1;
          },
          dispose() {
            record.disposals += 1;
          },
        };
      },
    },
  };
}

describe("retained motion graph", () => {
  it("selects only semantics-preserving motion backends", () => {
    const base = {
      property: "opacity",
      transition: { duration: 160, easing: "decelerate" },
      continuous: false,
      continuity: "replace" as const,
      layout: false,
      snapshotSafe: false,
      liveContent: false,
      waapi: true,
      viewTransition: true,
    };
    expect(resolveMotionBackend(base)).toEqual({ backend: "waapi", reason: "compositor" });
    expect(resolveMotionBackend({ ...base, continuous: true })).toEqual({
      backend: "anime",
      reason: "continuous",
    });
    expect(
      resolveMotionBackend({
        ...base,
        transition: { spring: { mass: 1, stiffness: 700, damping: 48 } },
      }),
    ).toEqual({ backend: "anime", reason: "spring-continuity" });
    expect(
      resolveMotionBackend({
        ...base,
        property: "layout",
        layout: true,
        snapshotSafe: true,
      }),
    ).toEqual({ backend: "view-transition", reason: "snapshot-layout" });
    expect(
      resolveMotionBackend({
        ...base,
        property: "layout",
        layout: true,
        snapshotSafe: true,
        liveContent: true,
      }),
    ).toEqual({ backend: "anime", reason: "live-layout" });
  });

  it("moves retained ownership between adaptive backends without losing the current value", () => {
    const anime = createBackend();
    const waapi = createBackend();
    const backend = createAdaptiveMotionBackend({
      anime: anime.backend,
      waapi: waapi.backend,
      decide: (_key, transition) =>
        transition === "instant"
          ? { backend: "waapi", reason: "compositor" }
          : { backend: "anime", reason: "spring-continuity" },
    });
    const adapter = backend.create("opacity", 0);
    adapter.write(0.25);
    adapter.retarget({ value: 1, velocity: 0, transition: "instant", settled() {} });
    expect(waapi.records.get("opacity")?.writes.at(-1)).toBe(0.25);
    waapi.records.get("opacity")!.value = 0.6;
    adapter.retarget({
      value: 0,
      velocity: -0.4,
      transition: { spring: { mass: 1, stiffness: 700, damping: 48 } },
      settled() {},
    });
    expect(anime.records.get("opacity")?.writes.at(-1)).toBe(0.6);
    adapter.dispose();
    expect(anime.records.get("opacity")?.disposals).toBe(1);
    expect(waapi.records.get("opacity")?.disposals).toBe(1);
  });

  it("rejects stale WAAPI completion and commits only the latest target", async () => {
    const animations: Array<{
      readonly resolve: () => void;
      readonly finished: Promise<void>;
      cancelled: number;
    }> = [];
    const renders: number[] = [];
    const settled: string[] = [];
    let presented = 0;
    let time = 0;
    const backend = createWaapiMotionBackend({
      target: () => ({ element: {} as HTMLElement, property: "opacity" }),
      render: (_key, value) => {
        presented = value;
        renders.push(value);
      },
      read: () => presented,
      now: () => (time += 16),
      animate() {
        const deferred = Promise.withResolvers<void>();
        const animation = {
          resolve: deferred.resolve,
          finished: deferred.promise,
          cancelled: 0,
          cancel() {
            animation.cancelled++;
          },
        };
        animations.push(animation);
        return animation;
      },
    });
    const adapter = backend.create("opacity", 0);
    adapter.retarget({
      value: 1,
      velocity: 0,
      transition: { duration: 160, easing: "decelerate" },
      settled: () => settled.push("first"),
    });
    presented = 0.4;
    adapter.retarget({
      value: 0,
      velocity: 0,
      transition: { duration: 120, easing: "decelerate" },
      settled: () => settled.push("second"),
    });
    animations[0]!.resolve();
    await Promise.resolve();
    expect(settled).toEqual([]);
    animations[1]!.resolve();
    await Promise.resolve();
    expect(settled).toEqual(["second"]);
    expect(renders.at(-1)).toBe(0);
    expect(animations[0]!.cancelled).toBe(1);
    adapter.dispose();
  });

  it("uses snapshot transitions only when the platform adapter exists", async () => {
    const updates: string[] = [];
    let skipped = 0;
    const native = runSnapshotTransition(() => updates.push("native"), {
      start(update) {
        update();
        return {
          ready: Promise.resolve(),
          finished: Promise.resolve(),
          skipTransition: () => skipped++,
        };
      },
    });
    native.cancel();
    await native.finished;
    expect(native.backend).toBe("view-transition");
    expect(skipped).toBe(1);

    const fallback = runSnapshotTransition(() => updates.push("direct"), { start: undefined });
    await fallback.finished;
    expect(fallback.backend).toBe("direct");
    expect(updates).toEqual(["native", "direct"]);
  });

  it("samples physical springs for custom View Transition pseudo-element animations", () => {
    const samples = sampleTransition({ spring: { mass: 1, stiffness: 700, damping: 48 } }, 32);
    expect(samples).toHaveLength(32);
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples.some((value) => value > 1)).toBe(true);
  });

  it("preserves physical spring parameters and normalizes release velocity", () => {
    const timing = animeTransitionTiming(
      { spring: { mass: 1, stiffness: 1600, damping: 80 } },
      normalizeSpringVelocity(140, 700, 1.4),
    );

    expect(normalizeSpringVelocity(140, 700, 1.4)).toBeCloseTo(2.5);
    expect(normalizeSpringVelocity(700, 700, 1.4)).toBe(0);
    expect(timing.duration).toBeGreaterThan(0);
    expect(timing.duration).toBeLessThan(1000);
  });

  it("samples a physical spring deterministically with continuous release velocity", () => {
    const resting = animeTransitionTiming({ spring: { mass: 1, stiffness: 700, damping: 48 } }, 0);
    const released = animeTransitionTiming(
      { spring: { mass: 1, stiffness: 700, damping: 48 } },
      2.5,
    );
    const restEase = resting.ease as (progress: number) => number;
    const releaseEase = released.ease as (progress: number) => number;

    expect(resting.duration).toBe(560);
    expect([0, 0.1, 0.25, 0.5, 0.75, 1].map(restEase)).toEqual([
      0, 0.4600493278346618, 0.9247309503168489, 1.0011447210581477, 1.0000917551241817, 1,
    ]);
    expect(releaseEase(0)).toBe(0);
    expect(releaseEase(0.1)).toBeGreaterThan(restEase(0.1));
    expect(releaseEase(1)).toBe(1);
  });

  it("installs the initial value synchronously and retains channel identity", () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const graph = new RetainedMotionGraph(backend, scheduler);

    const first = graph.channel("menu/Surface:y", "menu", 680);
    const second = graph.channel("menu/Surface:y", "menu", 0);

    expect(first).toBe(second);
    expect(first.read()).toBe(680);
    expect(records.get(first.key)?.writes).toEqual([680]);
    expect(scheduler.pending).toBe(0);
  });

  it("rejects competing owners for the same property channel", () => {
    const { backend } = createBackend();
    const graph = new RetainedMotionGraph(backend, new TestScheduler());
    graph.channel("menu/Surface:transform", "presentation", 0);

    expect(() => graph.channel("menu/Surface:transform", "gesture", 0)).toThrow(
      'Motion channel "menu/Surface:transform" is owned by "presentation"',
    );
  });

  it("coalesces repeated direct writes into one frame", () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const channel = new RetainedMotionGraph(backend, scheduler).channel("sheet:y", "sheet", 0);

    channel.direct(10);
    channel.direct(20);
    channel.direct(30);

    expect(scheduler.pending).toBe(1);
    scheduler.advance();
    expect(records.get(channel.key)?.writes).toEqual([0, 30]);
    expect(channel.driver).toBe("direct");
  });

  it("retargets from the adapter's current value and velocity", async () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const channel = new RetainedMotionGraph(backend, scheduler).channel("sheet:y", "sheet", 0);
    const record = records.get(channel.key)!;
    record.value = 148;
    record.currentVelocity = 1.75;

    const outcome = channel.target(720, { spring: { stiffness: 500 } });
    scheduler.advance();

    expect(channel.read()).toBe(148);
    expect(record.targets).toHaveLength(1);
    expect(record.targets[0]?.value).toBe(720);
    expect(record.targets[0]?.velocity).toBe(1.75);
    record.targets[0]?.settled();
    expect(await outcome).toBe("settled");
  });

  it("starts fresh presence motion from an explicit sample in one transaction", async () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const channel = new RetainedMotionGraph(backend, scheduler).channel("sheet:y", "sheet", 0);
    const record = records.get(channel.key)!;

    const outcome = channel.target(0, { spring: { stiffness: 500 } }, { from: 420 });
    expect(scheduler.pending).toBe(1);
    expect(record.writes).toEqual([0, 420]);
    scheduler.advance();

    expect(record.writes).toEqual([0, 420]);
    expect(record.targets).toHaveLength(1);
    expect(record.targets[0]).toMatchObject({ value: 0, velocity: 0 });
    record.targets[0]?.settled();
    expect(await outcome).toBe("settled");
  });

  it("replaces active motion without rewinding the adapter", async () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const channel = new RetainedMotionGraph(backend, scheduler).channel("sheet:y", "sheet", 0);
    const record = records.get(channel.key)!;

    const dismiss = channel.target(720, "instant");
    scheduler.advance();
    record.value = 180;
    record.currentVelocity = 1.2;
    const restore = channel.target(0, { spring: { damping: 40 } });
    scheduler.advance();

    expect(await dismiss).toBe("replaced");
    expect(record.stops).toBe(1);
    expect(record.writes).toEqual([0]);
    expect(record.targets[1]?.velocity).toBe(1.2);
    expect(channel.read()).toBe(180);
    record.targets[1]?.settled();
    expect(await restore).toBe("settled");
  });

  it("settles only the latest revision and disposes all pending work", async () => {
    const scheduler = new TestScheduler();
    const { backend, records } = createBackend();
    const graph = new RetainedMotionGraph(backend, scheduler);
    const channel = graph.channel("sheet:y", "sheet", 0);
    const record = records.get(channel.key)!;

    const first = channel.target(100, "instant");
    scheduler.advance();
    const staleSettlement = record.targets[0]!.settled;
    const second = channel.target(200, "instant");
    scheduler.advance();
    staleSettlement();
    expect(await first).toBe("replaced");

    graph.dispose();
    expect(await second).toBe("disposed");
    expect(record.disposals).toBe(1);
    expect(graph.size).toBe(0);
    expect(scheduler.pending).toBe(0);
    expect(() => channel.direct(0)).toThrow("Retained motion graph is disposed.");
  });
});

describe("retained layout graph", () => {
  function fixture() {
    const projects: Array<{
      readonly children: readonly HTMLElement[];
      readonly settled: () => void;
    }> = [];
    let stops = 0;
    let disposals = 0;
    let creates = 0;
    const adapter: LayoutChannelAdapter = {
      capture() {},
      project(children, _transition, settled) {
        projects.push({ children, settled });
      },
      stop() {
        stops += 1;
      },
      dispose() {
        disposals += 1;
      },
    };
    const backend: LayoutBackend = {
      create() {
        creates += 1;
        return adapter;
      },
    };
    return {
      backend,
      projects,
      reads: () => ({ stops, disposals, creates }),
    };
  }

  it("retains one layout owner and coalesces geometry changes", async () => {
    const scheduler = new TestScheduler();
    const { backend, projects, reads } = fixture();
    const graph = new RetainedLayoutGraph(backend, scheduler);
    const root = {} as HTMLElement;
    const firstChild = {} as HTMLElement;
    const secondChild = {} as HTMLElement;
    graph.register("results", "presentation", root, [firstChild]);
    graph.register("results", "presentation", root, [firstChild]);
    expect(reads().creates).toBe(1);
    expect(() => graph.register("results", "other", root, [])).toThrow("conflicting ownership");

    const first = graph.project("results", [firstChild], "instant");
    const second = graph.project("results", [secondChild], { duration: 180 });
    expect(scheduler.pending).toBe(1);
    scheduler.advance();
    expect(await first).toBe("replaced");
    expect(projects).toHaveLength(1);
    expect(projects[0]?.children).toEqual([secondChild]);
    projects[0]?.settled();
    expect(await second).toBe("settled");
  });

  it("interrupts without disposal and cleans up pending work exactly once", async () => {
    const scheduler = new TestScheduler();
    const { backend, projects, reads } = fixture();
    const graph = new RetainedLayoutGraph(backend, scheduler);
    graph.register("results", "presentation", {} as HTMLElement, []);
    const first = graph.project("results", [{} as HTMLElement], { duration: 200 });
    scheduler.advance();
    const second = graph.project("results", [{} as HTMLElement], { duration: 200 });
    scheduler.advance();
    expect(await first).toBe("replaced");
    expect(reads().stops).toBe(1);
    graph.dispose();
    expect(await second).toBe("disposed");
    expect(reads().disposals).toBe(1);
    expect(graph.size).toBe(0);
    expect(scheduler.pending).toBe(0);
    projects[0]?.settled();
  });

  it("owns settlement before an adapter synchronously completes during stop", async () => {
    const scheduler = new TestScheduler();
    let complete: (() => void) | undefined;
    const graph = new RetainedLayoutGraph(
      {
        create() {
          return {
            capture() {},
            project(_children, _transition, settled) {
              complete = settled;
            },
            stop() {
              complete?.();
            },
            dispose() {},
          };
        },
      },
      scheduler,
    );
    graph.register("results", "presentation", {} as HTMLElement, []);
    const first = graph.project("results", [{} as HTMLElement], { duration: 180 });
    scheduler.advance();
    const second = graph.project("results", [{} as HTMLElement], { duration: 180 });
    expect(() => scheduler.advance()).not.toThrow();
    expect(await first).toBe("replaced");
    complete?.();
    expect(await second).toBe("settled");
  });
});

describe("Anime retained layout adapter", () => {
  it("does not capture or restore presentation-owned visual channels", () => {
    const properties = new Set(["opacity", "color", "width"]);
    const recordedProperties = new Set(["opacity", "backgroundColor", "display", "height"]);
    const controller = {
      children: [],
      properties,
      recordedProperties,
      record() {},
      animate() {
        return { pause() {} } as never;
      },
      revert() {},
    };
    expect(restrictAnimeLayoutOwnership(controller)).toBe(controller);
    expect([...properties]).toEqual(["width"]);
    expect([...recordedProperties]).toEqual(["display", "height"]);
  });

  it("records interruption, retains the controller, and reverts only on disposal", () => {
    const calls: string[] = [];
    const completions: Array<() => void> = [];
    const root = {} as HTMLElement;
    const firstChild = {} as HTMLElement;
    const secondChild = {} as HTMLElement;
    let participants: unknown;
    const backend = createAnimeLayoutBackend((createdRoot, children) => ({
      children: [createdRoot, ...children],
      record() {
        calls.push("record");
        participants = this.children;
        return this;
      },
      animate(options) {
        calls.push("animate");
        if (options?.onComplete) completions.push(options.onComplete);
        return { pause() {} } as never;
      },
      revert() {
        calls.push("revert");
        return this;
      },
    }));
    const adapter = backend.create("results", root, [firstChild]);
    adapter.project([secondChild], { duration: 160, easing: "decelerate" }, () =>
      calls.push("settled"),
    );
    expect(participants).toEqual([root, secondChild]);
    adapter.project([firstChild], { spring: { duration: 240, bounce: 0.1 } }, () =>
      calls.push("settled"),
    );
    expect(participants).toEqual([root, firstChild]);
    expect(calls).toEqual(["record", "animate", "record", "animate"]);
    completions[0]?.();
    expect(calls).toEqual(["record", "animate", "record", "animate"]);
    completions[1]?.();
    expect(calls).toEqual(["record", "animate", "record", "animate", "record", "settled"]);
    adapter.dispose();
    expect(calls.at(-1)).toBe("revert");
  });
});

describe("Anime retained motion adapter", () => {
  it("starts the real Anime controller from the retained model value", async () => {
    const renders: number[] = [];
    const adapter = createAnimeMotionBackend({
      render(_key, value) {
        renders.push(value);
      },
    }).create("height", 44);

    adapter.retarget({
      value: 56,
      velocity: 0,
      transition: { spring: { mass: 1, stiffness: 520, damping: 38 } },
      settled() {},
    });
    await delay(32);

    expect(renders[0]).toBe(44);
    expect(Math.min(...renders)).toBeGreaterThanOrEqual(44);
    expect(renders.at(-1)).toBeGreaterThan(44);
    adapter.dispose();
  });

  it("creates one controller and retargets its retained property", async () => {
    let time = 0;
    const renders: number[] = [];
    const setters: Array<{ value: number; duration?: number; ease?: unknown }> = [];
    let pauses = 0;
    let reverts = 0;
    let callbacks: { readonly onUpdate: () => void; readonly onComplete: () => void };
    let model: { value: number };
    const factory: AnimeMotionFactory = (nextModel, nextCallbacks) => {
      model = nextModel;
      callbacks = nextCallbacks;
      return {
        value(value?: number, duration?: number, ease?: unknown) {
          if (value === undefined) return model.value;
          setters.push({ value, ...(duration === undefined ? {} : { duration }), ease });
          model.value = value;
          callbacks.onUpdate();
          return this;
        },
        animations: {
          value: {
            pause() {
              pauses += 1;
            },
            complete() {
              callbacks.onComplete();
            },
          },
        },
        revert() {
          reverts += 1;
        },
      } as AnimeMotionController;
    };
    const scheduler = new TestScheduler();
    const backend = createAnimeMotionBackend(
      { render: (_key, value) => renders.push(value), now: () => time },
      factory,
    );
    const graph = new RetainedMotionGraph(backend, scheduler);
    const channel = graph.channel("surface:y", "surface", 12);

    time = 16;
    const first = channel.target(100, { duration: 200, easing: "linear" });
    scheduler.advance();
    expect(setters).toEqual([{ value: 100, duration: 200, ease: "linear" }]);
    expect(channel.read()).toBe(100);

    time = 32;
    const second = channel.target(0, { spring: { duration: 320, bounce: 0.1 } });
    scheduler.advance();
    expect(await first).toBe("replaced");
    expect(pauses).toBe(1);
    expect(setters).toHaveLength(2);
    expect(typeof setters[1]?.duration).toBe("number");
    expect(setters[1]?.duration).toBeGreaterThan(0);
    expect(typeof setters[1]?.ease).toBe("function");

    callbacks!.onComplete();
    expect(await second).toBe("settled");
    expect(renders).toEqual([12, 100, 100, 0, 0]);

    graph.dispose();
    expect(reverts).toBe(1);
  });

  it("normalizes semantic easing names for retained setters", () => {
    const setters: unknown[][] = [];
    const factory: AnimeMotionFactory = (model, callbacks) =>
      ({
        value(value?: number, duration?: number, ease?: unknown) {
          if (value === undefined) return model.value;
          model.value = value;
          setters.push([value, duration, ease]);
          return this;
        },
        animations: { value: { pause() {}, complete: callbacks.onComplete } },
        revert() {},
      }) as AnimeMotionController;
    const scheduler = new TestScheduler();
    const graph = new RetainedMotionGraph(
      createAnimeMotionBackend({ render() {}, now: () => 0 }, factory),
      scheduler,
    );
    const channel = graph.channel("opacity", "surface", 0);
    void channel.target(1, { duration: 160, easing: "decelerate" });
    scheduler.advance();
    expect(setters).toEqual([[1, 160, "out(3)"]]);
    void channel.target(0.5, {
      duration: 200,
      easing: { cubic: [0.165, 0.84, 0.44, 1] },
    });
    scheduler.advance();
    expect(setters[1]?.slice(0, 2)).toEqual([0.5, 200]);
    expect(typeof setters[1]?.[2]).toBe("function");
    graph.dispose();
  });

  it("uses completion only to synchronize intentional direct writes", () => {
    let completes = 0;
    let reverts = 0;
    const values: number[] = [];
    const factory: AnimeMotionFactory = (model, callbacks) =>
      ({
        value(value?: number) {
          if (value === undefined) return model.value;
          model.value = value;
          values.push(value);
          return this;
        },
        animations: {
          value: {
            pause() {},
            complete() {
              completes += 1;
              callbacks.onComplete();
            },
          },
        },
        revert() {
          reverts += 1;
        },
      }) as AnimeMotionController;
    const scheduler = new TestScheduler();
    const graph = new RetainedMotionGraph(
      createAnimeMotionBackend({ render() {}, now: () => 0 }, factory),
      scheduler,
    );
    const channel = graph.channel("surface:y", "surface", 0);

    channel.direct(42);
    scheduler.advance();
    expect(values).toEqual([42]);
    expect(completes).toBe(1);
    graph.dispose();
    expect(reverts).toBe(1);
  });
});

describe("retained transform composer", () => {
  it("composes shared-layout projection before authored transforms", () => {
    const transform = new RetainedTransformComposer();
    transform.set("layoutTranslateX", -190);
    transform.set("layoutTranslateY", -280);
    transform.set("layoutScaleX", 0.5);
    transform.set("layoutScaleY", 0.5);
    transform.set("translateY", 12);

    expect(transform.value()).toBe(
      "translate(-190px, -280px) scale(0.5, 0.5) translate(0px, 12px)",
    );
  });

  it("composes every transform channel in one stable order", () => {
    const transform = new RetainedTransformComposer();
    transform.set("scaleY", 0.98);
    transform.set("translateY", 42);
    transform.set("rotateZ", 3);
    transform.set("perspective", 800);
    transform.set("scaleX", 0.98);

    expect(transform.value()).toBe(
      "perspective(800px) translate3d(0px, 42px, 0px) rotate(3deg) scale3d(0.98, 0.98, 1)",
    );
  });

  it("removes individual ownership without disturbing other channels", () => {
    const transform = new RetainedTransformComposer();
    transform.set("translateX", 14);
    transform.set("translateY", 28);
    transform.set("scaleX", 0.96);
    transform.set("scaleY", 0.96);

    expect(transform.delete("translateY")).toBe("translate(14px, 0px) scale(0.96, 0.96)");
    transform.clear();
    expect(transform.value()).toBe("none");
    expect(() => transform.set("translateX", Number.NaN)).toThrow(
      "Transform channel translateX must be finite.",
    );
  });
});
