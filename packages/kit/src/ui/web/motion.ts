import { createAnimatable, createLayout, cubicBezier, spring } from "animejs";

export type MotionDriver = "target" | "direct";

export type MotionTransition = Readonly<Record<string, unknown>> | "instant";

export type MotionScheduler = {
  now(): number;
  requestFrame(callback: (time: number) => void): unknown;
  cancelFrame(handle: unknown): void;
};

export type MotionTarget = {
  readonly value: number;
  readonly velocity: number;
  readonly transition: MotionTransition;
  readonly settled: () => void;
};

export type MotionChannelAdapter = {
  read(): number;
  velocity(): number;
  write(value: number): void;
  retarget(target: MotionTarget): void;
  stop(): void;
  dispose(): void;
};

export type MotionBackend = {
  create(key: string, initial: number): MotionChannelAdapter;
};

export type MotionBackendKind = "anime" | "waapi" | "view-transition";

export type MotionBackendRequest = {
  readonly property: string;
  readonly transition: MotionTransition;
  readonly continuous: boolean;
  readonly continuity: "preserve" | "replace";
  readonly layout: boolean;
  readonly snapshotSafe: boolean;
  readonly liveContent: boolean;
  readonly waapi: boolean;
  readonly viewTransition: boolean;
};

export type MotionBackendDecision = {
  readonly backend: MotionBackendKind;
  readonly reason:
    | "continuous"
    | "spring-continuity"
    | "live-layout"
    | "snapshot-layout"
    | "compositor"
    | "fallback";
};

export function resolveMotionBackend(request: MotionBackendRequest): MotionBackendDecision {
  if (request.continuous) return { backend: "anime", reason: "continuous" };
  if (request.continuity === "preserve" || hasSpring(request.transition)) {
    return { backend: "anime", reason: "spring-continuity" };
  }
  if (request.layout) {
    if (request.snapshotSafe && !request.liveContent && request.viewTransition) {
      return { backend: "view-transition", reason: "snapshot-layout" };
    }
    return { backend: "anime", reason: "live-layout" };
  }
  if (request.waapi && request.property === "opacity") {
    return { backend: "waapi", reason: "compositor" };
  }
  return { backend: "anime", reason: "fallback" };
}

export type WaapiTarget = {
  readonly element: HTMLElement;
  readonly property: "opacity";
};

export type WaapiAnimation = {
  readonly finished: PromiseLike<unknown>;
  cancel(): void;
};

export type WaapiMotionBackendOptions = {
  readonly target: (key: string) => WaapiTarget | undefined;
  readonly render: (key: string, value: number) => void;
  readonly read?: (target: WaapiTarget) => number;
  readonly animate?: (
    target: WaapiTarget,
    keyframes: readonly Keyframe[],
    options: KeyframeAnimationOptions,
  ) => WaapiAnimation;
  readonly now?: () => number;
};

export function createWaapiMotionBackend(options: WaapiMotionBackendOptions): MotionBackend {
  return {
    create(key, initial) {
      let value = initial;
      let velocity = 0;
      let animation: WaapiAnimation | undefined;
      let complete: (() => void) | undefined;
      let disposed = false;
      let revision = 0;
      const write = (next: number) => {
        value = next;
        options.render(key, next);
      };
      write(initial);
      const stop = () => {
        if (!animation) return;
        revision += 1;
        const target = options.target(key);
        const computed = target
          ? (options.read?.(target) ?? Number.parseFloat(getComputedStyle(target.element).opacity))
          : value;
        animation.cancel();
        animation = undefined;
        complete = undefined;
        if (Number.isFinite(computed)) write(computed);
      };
      return {
        read: () => value,
        velocity: () => velocity,
        write(next) {
          if (disposed) return;
          stop();
          velocity = 0;
          write(next);
        },
        retarget(next) {
          if (disposed) return;
          stop();
          const target = options.target(key);
          const timing = animeTransitionTiming(next.transition, 0);
          if (!target || timing.duration === 0) {
            write(next.value);
            next.settled();
            return;
          }
          const from = value;
          const now = options.now ?? (() => performance.now());
          const started = now();
          const currentRevision = ++revision;
          complete = next.settled;
          animation = (
            options.animate ??
            ((nextTarget, keyframes, animationOptions) =>
              nextTarget.element.animate([...keyframes], animationOptions))
          )(target, [{ opacity: String(from) }, { opacity: String(next.value) }], {
            duration: timing.duration,
            easing: cssEasing(next.transition),
            fill: "both",
          });
          animation.finished.then(
            () => {
              if (disposed || !animation || revision !== currentRevision) return;
              const elapsed = Math.max(1, now() - started);
              velocity = (next.value - from) / elapsed;
              animation.cancel();
              animation = undefined;
              write(next.value);
              const settled = complete;
              complete = undefined;
              settled?.();
            },
            () => {},
          );
        },
        stop,
        dispose() {
          if (disposed) return;
          disposed = true;
          stop();
        },
      };
    },
  };
}

export function createAdaptiveMotionBackend(options: {
  readonly anime: MotionBackend;
  readonly waapi: MotionBackend;
  readonly decide: (key: string, transition: MotionTransition) => MotionBackendDecision;
}): MotionBackend {
  return {
    create(key, initial) {
      const adapters = {
        anime: options.anime.create(key, initial),
        waapi: options.waapi.create(key, initial),
      };
      let active: keyof typeof adapters = "anime";
      let disposed = false;
      const select = (next: keyof typeof adapters) => {
        if (active === next) return adapters[active];
        const value = adapters[active].read();
        adapters[active].stop();
        active = next;
        adapters[active].write(value);
        return adapters[active];
      };
      return {
        read: () => adapters[active].read(),
        velocity: () => adapters[active].velocity(),
        write(value) {
          if (!disposed) adapters[active].write(value);
        },
        retarget(target) {
          if (disposed) return;
          const decision = options.decide(key, target.transition);
          const backend = decision.backend === "waapi" ? "waapi" : "anime";
          select(backend).retarget(target);
        },
        stop() {
          if (!disposed) adapters[active].stop();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          adapters.anime.dispose();
          adapters.waapi.dispose();
        },
      };
    },
  };
}

export type ViewTransitionHandle = {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
};

export type SnapshotTransitionOptions = {
  readonly start?: (update: () => void) => ViewTransitionHandle;
  readonly animate?: (
    transition: ViewTransitionHandle,
    samples: readonly number[],
    duration: number,
  ) => readonly Pick<Animation, "cancel" | "finished">[];
  readonly motion?: MotionTransition;
  readonly samples?: number;
};

export function runSnapshotTransition(
  update: () => void,
  options: SnapshotTransitionOptions = {},
): {
  readonly backend: "view-transition" | "direct";
  readonly finished: Promise<void>;
  cancel(): void;
} {
  const start =
    options.start ??
    (typeof document === "undefined" || !document.startViewTransition
      ? undefined
      : (callback: () => void) => document.startViewTransition(callback));
  if (!start) {
    update();
    return { backend: "direct", finished: Promise.resolve(), cancel() {} };
  }
  const transition = start(update);
  let cancelled = false;
  let animations: readonly Pick<Animation, "cancel" | "finished">[] = [];
  const timing = animeTransitionTiming(
    options.motion ?? { duration: 180, easing: "decelerate" },
    0,
  );
  const customFinished = transition.ready.then(async () => {
    if (cancelled || !options.animate) return;
    animations = options.animate(
      transition,
      sampleTransition(options.motion ?? { duration: 180, easing: "decelerate" }, options.samples),
      timing.duration,
    );
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
  return {
    backend: "view-transition",
    finished: Promise.all([transition.finished, customFinished]).then(() => undefined),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const animation of animations) animation.cancel();
      transition.skipTransition();
    },
  };
}

export function sampleTransition(transition: MotionTransition, count = 60): readonly number[] {
  const points = Math.max(2, Math.floor(count));
  const timing = animeTransitionTiming(transition, 0);
  const easing = typeof timing.ease === "function" ? timing.ease : (progress: number) => progress;
  return Array.from({ length: points }, (_, index) => easing(index / (points - 1)));
}

export type AnimeMotionModel = { value: number };

export type AnimeMotionController = {
  value(): number | readonly number[];
  value(value: number, duration?: number, ease?: unknown): unknown;
  animations: { readonly value?: { pause(): unknown; complete(): unknown } };
  revert(): unknown;
};

export type AnimeMotionFactory = (
  model: AnimeMotionModel,
  callbacks: { readonly onUpdate: () => void; readonly onComplete: () => void },
) => AnimeMotionController;

export type AnimeMotionBackendOptions = {
  readonly render: (key: string, value: number) => void;
  readonly now?: () => number;
};

export type LayoutChannelAdapter = {
  capture(): void;
  project(
    children: readonly HTMLElement[],
    transition: MotionTransition,
    settled: () => void,
  ): void;
  stop(): void;
  dispose(): void;
};

export type LayoutBackend = {
  create(key: string, root: HTMLElement, children: readonly HTMLElement[]): LayoutChannelAdapter;
};

export type AnimeLayoutController = {
  children: unknown;
  properties?: Set<string>;
  recordedProperties?: Set<string>;
  record(): unknown;
  settle?(): unknown;
  animate(options?: {
    readonly duration?: number;
    readonly ease?: unknown;
    readonly onComplete?: () => void;
  }): PausableAnimation;
  revert(): unknown;
};

type PausableAnimation = { pause(): unknown };

export type AnimeLayoutFactory = (
  root: HTMLElement,
  children: readonly HTMLElement[],
) => AnimeLayoutController;

const animeLayoutVisualProperties = [
  "opacity",
  "fontSize",
  "color",
  "backgroundColor",
  "borderRadius",
  "border",
  "filter",
  "clipPath",
] as const;

export function restrictAnimeLayoutOwnership(
  controller: AnimeLayoutController,
): AnimeLayoutController {
  for (const property of animeLayoutVisualProperties) {
    controller.properties?.delete(property);
    controller.recordedProperties?.delete(property);
  }
  return controller;
}

export function createAnimeLayoutBackend(
  factory: AnimeLayoutFactory = (root, children) =>
    restrictAnimeLayoutOwnership(
      createLayout(root, {
        children: [root, ...children.filter((child) => child !== root)],
        properties: [],
        swapAt: {},
        enterFrom: {},
        leaveTo: {},
      }) as unknown as AnimeLayoutController,
    ),
): LayoutBackend {
  return {
    create(_key, root, initialChildren) {
      const layout = factory(root, initialChildren);
      let animation: PausableAnimation | undefined;
      let complete: (() => void) | undefined;
      let disposed = false;
      let revision = 0;
      let captured = false;
      return {
        capture() {
          if (disposed) return;
          animation?.pause();
          animation = undefined;
          layout.record();
          captured = true;
        },
        project(children, transition, settled) {
          if (disposed) return;
          const currentRevision = ++revision;
          if (!captured) layout.record();
          captured = false;
          layout.children = [root, ...children.filter((child) => child !== root)];
          complete = settled;
          const timing = animeTransitionTiming(transition, 0);
          if (timing.duration === 0) {
            layout.settle?.();
            const done = complete;
            complete = undefined;
            done?.();
            return;
          }
          animation = layout.animate({
            duration: timing.duration,
            ease: timing.ease as never,
            onComplete() {
              if (disposed || revision !== currentRevision) return;
              animation = undefined;
              const done = complete;
              complete = undefined;
              done?.();
            },
          });
        },
        stop() {
          if (disposed || !animation) return;
          revision += 1;
          layout.record();
          animation = undefined;
          complete = undefined;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          revision += 1;
          complete = undefined;
          layout.revert();
        },
      };
    },
  };
}

export type MotionOutcome = "settled" | "replaced" | "disposed";

export type TransformChannel =
  | "translateX"
  | "translateY"
  | "translateZ"
  | "scaleX"
  | "scaleY"
  | "rotateX"
  | "rotateY"
  | "rotateZ"
  | "skewX"
  | "skewY"
  | "perspective";

export type RetainedMotionChannel = {
  readonly key: string;
  readonly owner: string;
  readonly driver: MotionDriver;
  read(): number;
  velocity(): number;
  direct(value: number): void;
  target(
    value: number,
    transition: MotionTransition,
    options?: { readonly velocity?: number; readonly from?: number },
  ): Promise<MotionOutcome>;
};

type Settlement = {
  readonly revision: number;
  readonly resolve: (outcome: MotionOutcome) => void;
};

type PendingOperation =
  | { readonly kind: "direct"; readonly value: number }
  | {
      readonly kind: "target";
      readonly value: number;
      readonly transition: MotionTransition;
      readonly velocity?: number;
      readonly from?: number;
      readonly settlement: Settlement;
    };

type ChannelRecord = {
  readonly key: string;
  readonly owner: string;
  readonly adapter: MotionChannelAdapter;
  readonly api: RetainedMotionChannel;
  driver: MotionDriver;
  revision: number;
  pending?: PendingOperation;
  active?: Settlement;
  disposed: boolean;
};

const browserMotionScheduler: MotionScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle as number),
};

export function createAnimeMotionBackend(
  options: AnimeMotionBackendOptions,
  factory: AnimeMotionFactory = (model, callbacks) =>
    createAnimatable(model, {
      value: model.value,
      onUpdate: callbacks.onUpdate,
      onComplete: callbacks.onComplete,
    }) as unknown as AnimeMotionController,
): MotionBackend {
  const now = options.now ?? (() => performance.now());
  return {
    create(key, initial) {
      const model = { value: initial };
      let lastValue = initial;
      let lastTime = now();
      let currentVelocity = 0;
      let settle: (() => void) | undefined;
      let disposed = false;
      const render = () => {
        if (disposed) return;
        const time = now();
        const elapsed = time - lastTime;
        if (elapsed > 0) currentVelocity = (model.value - lastValue) / elapsed;
        lastValue = model.value;
        lastTime = time;
        options.render(key, model.value);
      };
      const controller = factory(model, {
        onUpdate: render,
        onComplete() {
          if (disposed) return;
          render();
          const complete = settle;
          settle = undefined;
          complete?.();
        },
      });
      options.render(key, initial);
      return {
        read: () => model.value,
        velocity: () => currentVelocity,
        write(value) {
          if (disposed) return;
          settle = undefined;
          controller.value(value, 0, "linear");
          controller.animations.value?.complete();
          model.value = value;
          render();
        },
        retarget(target) {
          if (disposed) return;
          settle = target.settled;
          const timing = animeTransitionTiming(
            target.transition,
            normalizeSpringVelocity(model.value, target.value, target.velocity),
          );
          if (timing.duration === 0) {
            controller.value(target.value, 0, "linear");
            controller.animations.value?.complete();
            model.value = target.value;
            render();
            const complete = settle;
            settle = undefined;
            complete?.();
            return;
          }
          controller.value(target.value, timing.duration, timing.ease);
        },
        stop() {
          if (disposed) return;
          settle = undefined;
          controller.animations.value?.pause();
          render();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          settle = undefined;
          controller.revert();
        },
      };
    },
  };
}

export class RetainedMotionGraph {
  readonly #channels = new Map<string, ChannelRecord>();
  readonly #backend: MotionBackend;
  readonly #scheduler: MotionScheduler;
  #frame: unknown;
  #disposed = false;

  constructor(backend: MotionBackend, scheduler: MotionScheduler = browserMotionScheduler) {
    this.#backend = backend;
    this.#scheduler = scheduler;
  }

  get size(): number {
    return this.#channels.size;
  }

  channel(key: string, owner: string, initial: number): RetainedMotionChannel {
    this.#assertActive();
    const existing = this.#channels.get(key);
    if (existing) {
      if (existing.owner !== owner) {
        throw new Error(
          `Motion channel ${JSON.stringify(key)} is owned by ${JSON.stringify(existing.owner)} and cannot be claimed by ${JSON.stringify(owner)}.`,
        );
      }
      return existing.api;
    }

    const adapter = this.#backend.create(key, initial);
    let record: ChannelRecord;
    const api: RetainedMotionChannel = {
      key,
      owner,
      get driver() {
        return record.driver;
      },
      read: () => adapter.read(),
      velocity: () => adapter.velocity(),
      direct: (value) => this.#queueDirect(record, value),
      target: (value, transition, options) => this.#queueTarget(record, value, transition, options),
    };
    record = {
      key,
      owner,
      adapter,
      api,
      driver: "direct",
      revision: 0,
      disposed: false,
    };
    this.#channels.set(key, record);
    return api;
  }

  releaseOwner(owner: string): void {
    for (const record of this.#channels.values()) {
      if (record.owner === owner) this.#disposeChannel(record);
    }
  }

  release(key: string): void {
    const record = this.#channels.get(key);
    if (record) this.#disposeChannel(record);
  }

  flush(): void {
    if (this.#disposed) return;
    if (this.#frame !== undefined) {
      this.#scheduler.cancelFrame(this.#frame);
      this.#frame = undefined;
    }
    for (const record of this.#channels.values()) this.#flushChannel(record);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#frame !== undefined) this.#scheduler.cancelFrame(this.#frame);
    this.#frame = undefined;
    for (const record of this.#channels.values()) this.#disposeChannel(record);
  }

  #queueDirect(record: ChannelRecord, value: number): void {
    this.#assertRecord(record);
    finite(value, "Direct motion value");
    this.#replacePending(record);
    record.pending = { kind: "direct", value };
    this.#schedule();
  }

  #queueTarget(
    record: ChannelRecord,
    value: number,
    transition: MotionTransition,
    options: { readonly velocity?: number; readonly from?: number } | undefined,
  ): Promise<MotionOutcome> {
    this.#assertRecord(record);
    finite(value, "Motion target");
    if (options?.velocity !== undefined) finite(options.velocity, "Motion velocity");
    if (options?.from !== undefined) finite(options.from, "Motion initial value");
    this.#replacePending(record);
    return new Promise((resolve) => {
      const settlement = { revision: ++record.revision, resolve };
      record.pending = {
        kind: "target",
        value,
        transition,
        ...(options?.velocity === undefined ? {} : { velocity: options.velocity }),
        ...(options?.from === undefined ? {} : { from: options.from }),
        settlement,
      };
      this.#schedule();
    });
  }

  #schedule(): void {
    if (this.#frame !== undefined) return;
    this.#frame = this.#scheduler.requestFrame(() => {
      this.#frame = undefined;
      for (const record of this.#channels.values()) this.#flushChannel(record);
    });
  }

  #flushChannel(record: ChannelRecord): void {
    const operation = record.pending;
    if (!operation || record.disposed) return;
    record.pending = undefined;
    if (record.active) {
      const active = record.active;
      record.active = undefined;
      record.adapter.stop();
      active.resolve("replaced");
    }
    if (operation.kind === "direct") {
      record.driver = "direct";
      record.adapter.write(operation.value);
      return;
    }

    record.driver = "target";
    record.active = operation.settlement;
    const revision = operation.settlement.revision;
    if (operation.from !== undefined) record.adapter.write(operation.from);
    record.adapter.retarget({
      value: operation.value,
      velocity:
        operation.velocity ?? (operation.from === undefined ? record.adapter.velocity() : 0),
      transition: operation.transition,
      settled: () => {
        if (record.disposed || record.active?.revision !== revision) return;
        const active = record.active;
        record.active = undefined;
        active.resolve("settled");
      },
    });
  }

  #replacePending(record: ChannelRecord): void {
    if (record.pending?.kind === "target") record.pending.settlement.resolve("replaced");
    record.pending = undefined;
  }

  #disposeChannel(record: ChannelRecord): void {
    if (record.disposed) return;
    record.disposed = true;
    this.#replacePending(record);
    if (record.active) {
      record.active.resolve("disposed");
      record.active = undefined;
    }
    record.adapter.dispose();
    this.#channels.delete(record.key);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Retained motion graph is disposed.");
  }

  #assertRecord(record: ChannelRecord): void {
    this.#assertActive();
    if (record.disposed || this.#channels.get(record.key) !== record) {
      throw new Error(`Motion channel ${JSON.stringify(record.key)} is disposed.`);
    }
  }
}

type LayoutRecord = {
  readonly key: string;
  readonly owner: string;
  readonly root: HTMLElement;
  readonly adapter: LayoutChannelAdapter;
  revision: number;
  pending?: {
    readonly children: readonly HTMLElement[];
    readonly transition: MotionTransition;
    readonly settlement: Settlement;
  };
  active?: Settlement;
  disposed: boolean;
};

export class RetainedLayoutGraph {
  readonly #records = new Map<string, LayoutRecord>();
  readonly #backend: LayoutBackend;
  readonly #scheduler: MotionScheduler;
  #frame: unknown;
  #disposed = false;

  constructor(backend: LayoutBackend, scheduler: MotionScheduler = browserMotionScheduler) {
    this.#backend = backend;
    this.#scheduler = scheduler;
  }

  get size(): number {
    return this.#records.size;
  }

  register(key: string, owner: string, root: HTMLElement, children: readonly HTMLElement[]): void {
    this.#assertActive();
    const existing = this.#records.get(key);
    if (existing) {
      if (existing.owner !== owner || existing.root !== root) {
        throw new Error(`Layout channel ${JSON.stringify(key)} has conflicting ownership or root.`);
      }
      return;
    }
    this.#records.set(key, {
      key,
      owner,
      root,
      adapter: this.#backend.create(key, root, children),
      revision: 0,
      disposed: false,
    });
  }

  project(
    key: string,
    children: readonly HTMLElement[],
    transition: MotionTransition,
  ): Promise<MotionOutcome> {
    this.#assertActive();
    const record = this.#records.get(key);
    if (!record || record.disposed)
      throw new Error(`Layout channel ${JSON.stringify(key)} is not registered.`);
    if (record.pending) record.pending.settlement.resolve("replaced");
    return new Promise((resolve) => {
      record.pending = {
        children,
        transition,
        settlement: { revision: ++record.revision, resolve },
      };
      this.#schedule();
    });
  }

  capture(): void {
    this.#assertActive();
    for (const record of this.#records.values()) {
      if (!record.disposed) record.adapter.capture();
    }
  }

  release(key: string): void {
    const record = this.#records.get(key);
    if (record) this.#disposeRecord(record);
  }

  flush(): void {
    if (this.#disposed) return;
    if (this.#frame !== undefined) this.#scheduler.cancelFrame(this.#frame);
    this.#frame = undefined;
    for (const record of this.#records.values()) this.#flushRecord(record);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#frame !== undefined) this.#scheduler.cancelFrame(this.#frame);
    this.#frame = undefined;
    for (const record of this.#records.values()) this.#disposeRecord(record);
  }

  #schedule(): void {
    if (this.#frame !== undefined) return;
    this.#frame = this.#scheduler.requestFrame(() => {
      this.#frame = undefined;
      for (const record of this.#records.values()) this.#flushRecord(record);
    });
  }

  #flushRecord(record: LayoutRecord): void {
    const pending = record.pending;
    if (!pending || record.disposed) return;
    record.pending = undefined;
    if (record.active) {
      const active = record.active;
      record.active = undefined;
      record.adapter.stop();
      active.resolve("replaced");
    }
    record.active = pending.settlement;
    const revision = pending.settlement.revision;
    record.adapter.project(pending.children, pending.transition, () => {
      if (record.disposed || record.active?.revision !== revision) return;
      const active = record.active;
      record.active = undefined;
      active.resolve("settled");
    });
  }

  #disposeRecord(record: LayoutRecord): void {
    if (record.disposed) return;
    record.disposed = true;
    record.pending?.settlement.resolve("disposed");
    record.pending = undefined;
    record.active?.resolve("disposed");
    record.active = undefined;
    record.adapter.dispose();
    this.#records.delete(record.key);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Retained layout graph is disposed.");
  }
}

export class RetainedTransformComposer {
  readonly #values = new Map<TransformChannel, number>();

  set(channel: TransformChannel, value: number): string {
    finite(value, `Transform channel ${channel}`);
    this.#values.set(channel, value);
    return this.value();
  }

  delete(channel: TransformChannel): string {
    this.#values.delete(channel);
    return this.value();
  }

  clear(): void {
    this.#values.clear();
  }

  value(): string {
    const perspective = this.#values.get("perspective");
    const translateX = this.#values.get("translateX") ?? 0;
    const translateY = this.#values.get("translateY") ?? 0;
    const translateZ = this.#values.get("translateZ") ?? 0;
    const rotateX = this.#values.get("rotateX") ?? 0;
    const rotateY = this.#values.get("rotateY") ?? 0;
    const rotateZ = this.#values.get("rotateZ") ?? 0;
    const skewX = this.#values.get("skewX") ?? 0;
    const skewY = this.#values.get("skewY") ?? 0;
    const scaleX = this.#values.get("scaleX") ?? 1;
    const scaleY = this.#values.get("scaleY") ?? 1;
    const usesDepth =
      perspective !== undefined || translateZ !== 0 || rotateX !== 0 || rotateY !== 0;
    const values = [
      ...(perspective === undefined ? [] : [`perspective(${format(perspective)}px)`]),
      ...(translateX === 0 && translateY === 0 && translateZ === 0
        ? []
        : usesDepth
          ? [
              `translate3d(${format(translateX)}px, ${format(translateY)}px, ${format(translateZ)}px)`,
            ]
          : [`translate(${format(translateX)}px, ${format(translateY)}px)`]),
      ...(rotateX === 0 ? [] : [`rotateX(${format(rotateX)}deg)`]),
      ...(rotateY === 0 ? [] : [`rotateY(${format(rotateY)}deg)`]),
      ...(rotateZ === 0 ? [] : [`rotate(${format(rotateZ)}deg)`]),
      ...(skewX === 0 ? [] : [`skewX(${format(skewX)}deg)`]),
      ...(skewY === 0 ? [] : [`skewY(${format(skewY)}deg)`]),
      ...(scaleX === 1 && scaleY === 1
        ? []
        : usesDepth
          ? [`scale3d(${format(scaleX)}, ${format(scaleY)}, 1)`]
          : [`scale(${format(scaleX)}, ${format(scaleY)})`]),
    ];
    return values.join(" ") || "none";
  }
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`);
}

export function animeTransitionTiming(
  transition: MotionTransition,
  velocity: number,
): { readonly duration: number; readonly ease: unknown } {
  if (transition === "instant") return { duration: 0, ease: "linear" };
  const springValue = record(transition.spring);
  if (Object.keys(springValue).length) {
    const ease = spring({
      ...(typeof springValue.duration === "number" ? { duration: springValue.duration } : {}),
      ...(typeof springValue.bounce === "number" ? { bounce: springValue.bounce } : {}),
      ...(typeof springValue.mass === "number" ? { mass: springValue.mass } : {}),
      ...(typeof springValue.stiffness === "number" ? { stiffness: springValue.stiffness } : {}),
      ...(typeof springValue.damping === "number" ? { damping: springValue.damping } : {}),
      velocity,
    });
    return { duration: ease.settlingDuration, ease: ease.ease };
  }
  const cubic = record(transition.easing).cubic;
  return {
    duration: number(transition.duration, 180),
    ease:
      Array.isArray(cubic) && cubic.length === 4
        ? cubicBezier(cubic[0]!, cubic[1]!, cubic[2]!, cubic[3]!)
        : ({
            linear: "linear",
            smooth: "inOut(3)",
            accelerate: "in(3)",
            decelerate: "out(3)",
          }[String(transition.easing)] ?? "out(3)"),
  };
}

function hasSpring(transition: MotionTransition): boolean {
  return transition !== "instant" && Object.keys(record(transition.spring)).length > 0;
}

function cssEasing(transition: MotionTransition): string {
  if (transition === "instant") return "linear";
  const easing = transition.easing;
  const cubic = record(easing).cubic;
  if (Array.isArray(cubic) && cubic.length === 4) {
    return `cubic-bezier(${cubic.map((value) => Number(value)).join(", ")})`;
  }
  return (
    {
      linear: "linear",
      smooth: "cubic-bezier(0.42, 0, 0.58, 1)",
      accelerate: "cubic-bezier(0.42, 0, 1, 1)",
      decelerate: "cubic-bezier(0, 0, 0.58, 1)",
    }[String(easing)] ?? "cubic-bezier(0, 0, 0.58, 1)"
  );
}

export function normalizeSpringVelocity(current: number, target: number, velocity: number): number {
  const distance = target - current;
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.001 || !Number.isFinite(velocity)) {
    return 0;
  }
  // Runtime velocity is measured in authored units per millisecond. Anime's
  // spring solver expects normalized progress per second.
  return (velocity * 1000) / distance;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function format(value: number): string {
  return Object.is(value, -0) ? "0" : String(Number(value.toFixed(6)));
}
