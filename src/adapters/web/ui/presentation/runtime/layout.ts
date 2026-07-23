import type { WebFrameHost } from "@/adapters/web/ui/presentation/runtime/animation";
import type { WebLayoutContinuity, WebLayoutSample } from "@/platforms/web/presentation";
import {
  createDynamicsTrajectory,
  type WebTrajectory,
} from "@/platforms/web/presentation/dynamics";

type LayoutOwner = object;
type LayoutKey = Element | string;
type LayoutTransition = "animate" | "synchronize";
type LayoutBox = Readonly<{
  inlineStart: number;
  blockStart: number;
  inlineSize: number;
  blockSize: number;
}>;

type LayoutEntry = Readonly<{
  target: Element;
  continuity: WebLayoutContinuity;
}>;

type CoordinateScale = Readonly<{ inline: number; block: number }>;
type LayoutSnapshot = Readonly<{
  target: Element;
  box: LayoutBox;
  coordinateScale: CoordinateScale;
}>;
type MeasuredLayout = Readonly<{
  key: LayoutKey;
  entry: LayoutEntry;
  box: LayoutBox;
  coordinateScale: CoordinateScale;
  previous: LayoutSnapshot | undefined;
}>;
type LayoutMotion = Readonly<{
  target: Element;
  box: LayoutBox;
  x: WebTrajectory;
  y: WebTrajectory;
  scaleX: WebTrajectory;
  scaleY: WebTrajectory;
  started: number;
  kind: "layout" | "replacement";
  strategy: "transform" | "position";
  coordinateScale: CoordinateScale;
}>;

type SuspendedTransform = Readonly<{
  style: CSSStyleDeclaration;
  properties: readonly Readonly<{ name: string; value: string; priority: string }>[];
}>;

const transformProperties = ["translate", "rotate", "scale", "transform"] as const;

export type WebLayoutFrameProperties = Readonly<{
  transform: string;
  "transform-origin": "0 0";
}>;

export type WebLayoutHost = Readonly<{
  update(
    owner: LayoutOwner,
    entries: ReadonlyMap<Element, WebLayoutContinuity>,
    onFrame?: (time: number) => void,
    transition?: LayoutTransition,
  ): void;
  remove(owner: LayoutOwner): void;
  sample(target: Element, time?: number): WebLayoutSample;
  resolve(target: Element, time?: number): WebLayoutFrameProperties | undefined;
  inspect(): Readonly<{ entries: number; moving: number; scheduled: boolean; revision: number }>;
  dispose(): void;
}>;

/** Maintains one batched FLIP transaction space for a mounted web Presentation root. */
export function createWebLayoutHost(
  frames: WebFrameHost,
  reducedMotion: () => boolean,
  boundary?: Element,
): WebLayoutHost {
  const owners = new Map<LayoutOwner, ReadonlyMap<Element, WebLayoutContinuity>>();
  const snapshots = new Map<LayoutKey, LayoutSnapshot>();
  const motions = new Map<Element, LayoutMotion>();
  const listeners = new Map<LayoutOwner, (time: number) => void>();
  let scheduled = false;
  let directPositionInvalidation = false;
  let pendingTransition: LayoutTransition = "animate";
  let disposed = false;
  let transactionTime: number | undefined;
  let revision = 0;

  const render = (time: number) => {
    if (disposed) return;
    transactionTime = time;
    try {
      let changed = false;
      for (const [target, motion] of motions) {
        if (settled(motion, time)) {
          motions.delete(target);
          changed = true;
        }
      }
      if (changed) revision += 1;
      for (const listener of listeners.values()) listener(time);
    } finally {
      transactionTime = undefined;
    }
    if (motions.size) frames.activate(render);
    else frames.deactivate(render);
  };

  const measure = () => {
    scheduled = false;
    if (disposed) return;
    const shiftPositionDirectly = directPositionInvalidation;
    directPositionInvalidation = false;
    const transition = pendingTransition;
    pendingTransition = "animate";
    const time = frames.time();
    const entries = collectEntries(owners);

    if (transition === "synchronize") motions.clear();

    const visual = new Map<
      Element,
      Readonly<{
        box: LayoutBox;
        velocityX: number;
        velocityY: number;
        velocityScaleX: number;
        velocityScaleY: number;
      }>
    >();
    for (const [target, motion] of motions) {
      const elapsed = time - motion.started;
      const x = motion.x.at(elapsed);
      const y = motion.y.at(elapsed);
      const scaleX = motion.scaleX.at(elapsed);
      const scaleY = motion.scaleY.at(elapsed);
      visual.set(target, {
        box: {
          inlineStart: motion.box.inlineStart + x.value * motion.coordinateScale.inline,
          blockStart: motion.box.blockStart + y.value * motion.coordinateScale.block,
          inlineSize: motion.box.inlineSize * scaleX.value,
          blockSize: motion.box.blockSize * scaleY.value,
        },
        velocityX: x.velocity * motion.coordinateScale.inline,
        velocityY: y.velocity * motion.coordinateScale.block,
        velocityScaleX: scaleX.velocity,
        velocityScaleY: scaleY.velocity,
      });
    }

    const suspended = [...entries.values()].map((entry) => suspendTransforms(entry.target));
    const next = new Map<LayoutKey, LayoutSnapshot>();
    const measured: MeasuredLayout[] = [];
    try {
      for (const [key, entry] of entries) {
        const { box, coordinateScale } = readWebLayoutGeometry(entry.target);
        if (!hasLayoutBox(entry.target)) continue;
        measured.push({ key, entry, box, coordinateScale, previous: snapshots.get(key) });
        next.set(key, { target: entry.target, box, coordinateScale });
      }
    } finally {
      for (const transform of suspended) restoreTransforms(transform);
    }

    const prefersReducedMotion = reducedMotion();
    const retained = new Set<Element>();
    for (const { entry, box, coordinateScale, previous } of measured) {
      retained.add(entry.target);
      if (!previous || prefersReducedMotion || transition === "synchronize") {
        motions.delete(entry.target);
        continue;
      }
      if (
        shiftPositionDirectly &&
        previous.target === entry.target &&
        previous.box.inlineSize === box.inlineSize &&
        previous.box.blockSize === box.blockSize
      ) {
        const existing = motions.get(entry.target);
        if (existing) {
          const shifted = Object.freeze({ ...existing, box });
          motions.set(entry.target, shifted);
        }
        continue;
      }
      if (previous.target === entry.target && sameBox(previous.box, box)) {
        continue;
      }

      const displayed = visual.get(previous.target);
      const from = displayed?.box ?? previous.box;
      const velocityX = displayed?.velocityX ?? 0;
      const velocityY = displayed?.velocityY ?? 0;
      const velocityScaleX = displayed?.velocityScaleX ?? 0;
      const velocityScaleY = displayed?.velocityScaleY ?? 0;
      if (previous.target !== entry.target) {
        motions.delete(previous.target);
      }
      const motion = createMotion(
        entry.target,
        box,
        from,
        { velocityX, velocityY, velocityScaleX, velocityScaleY },
        entry.continuity,
        coordinateScale,
        time,
        previous.target === entry.target ? "layout" : "replacement",
      );
      motions.set(entry.target, motion);
    }

    for (const target of Array.from(motions.keys())) {
      if (retained.has(target)) continue;
      motions.delete(target);
    }
    snapshots.clear();
    for (const [key, snapshot] of next) snapshots.set(key, snapshot);
    revision += 1;
    if (motions.size) frames.activate(render);
    else frames.deactivate(render);
    transactionTime = time;
    try {
      for (const listener of listeners.values()) listener(time);
    } finally {
      transactionTime = undefined;
    }
  };

  const schedule = (transition: LayoutTransition = "animate") => {
    if (disposed) return;
    if (!scheduled || transition === "animate") pendingTransition = transition;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(measure);
  };

  const view = boundary?.ownerDocument?.defaultView;
  const synchronizeGeometry = () => schedule("synchronize");
  const animateStructure = () => schedule("animate");
  const resizeObserver = view?.ResizeObserver
    ? new view.ResizeObserver(synchronizeGeometry)
    : undefined;
  const mutationObserver = view?.MutationObserver
    ? new view.MutationObserver(animateStructure)
    : undefined;
  const observed = new Set<Element>();
  const refreshNativeObservers = () => {
    resizeObserver?.disconnect();
    observed.clear();
    for (const entry of collectEntries(owners).values()) {
      for (let target: Element | null = entry.target; target; target = target.parentElement) {
        if (observed.has(target)) continue;
        observed.add(target);
        resizeObserver?.observe(target);
        if (target === boundary) break;
      }
    }
  };
  const documentFonts = boundary?.ownerDocument?.fonts;
  const eventBoundary =
    boundary && typeof boundary.addEventListener === "function" ? boundary : undefined;
  const nativeInvalidation = () => schedule("synchronize");
  const scrollInvalidation = () => {
    directPositionInvalidation = true;
    schedule("animate");
  };
  eventBoundary?.addEventListener("scroll", scrollInvalidation, {
    capture: true,
    passive: true,
  });
  eventBoundary?.addEventListener("load", nativeInvalidation, { capture: true, passive: true });
  view?.addEventListener("resize", nativeInvalidation, { passive: true });
  view?.addEventListener("scroll", scrollInvalidation, { passive: true });
  documentFonts?.addEventListener("loadingdone", nativeInvalidation);
  documentFonts?.addEventListener("loadingerror", nativeInvalidation);
  if (boundary) {
    mutationObserver?.observe(boundary, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  return {
    update(owner, entries, onFrame, transition = "animate") {
      if (disposed) return;
      owners.set(owner, new Map(entries));
      if (onFrame) listeners.set(owner, onFrame);
      else listeners.delete(owner);
      refreshNativeObservers();
      schedule(transition);
    },
    remove(owner) {
      if (!owners.delete(owner)) return;
      listeners.delete(owner);
      refreshNativeObservers();
      schedule("synchronize");
    },
    sample(target, time = transactionTime ?? frames.time()) {
      const motion = motions.get(target);
      if (motion) return sampleMotion(motion, time);
      const snapshot = [...snapshots.values()].find((candidate) => candidate.target === target);
      const box = snapshot?.box ?? zeroBox;
      return Object.freeze({
        current: box,
        destination: box,
        velocity: zeroVelocity,
        progress: 1,
        kind: "idle",
        settled: true,
      });
    },
    resolve(target, time = transactionTime ?? frames.time()) {
      const motion = motions.get(target);
      if (!motion) return undefined;
      const elapsed = Math.max(0, time - motion.started);
      const x = motion.x.at(elapsed).value;
      const y = motion.y.at(elapsed).value;
      const scaleX = motion.strategy === "transform" ? motion.scaleX.at(elapsed).value : 1;
      const scaleY = motion.strategy === "transform" ? motion.scaleY.at(elapsed).value : 1;
      return Object.freeze({
        "transform-origin": "0 0",
        transform: `translate(${x}px,${y}px) scale(${scaleX},${scaleY})`,
      });
    },
    inspect() {
      let entries = 0;
      for (const owned of owners.values()) entries += owned.size;
      return Object.freeze({ entries, moving: motions.size, scheduled, revision });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      frames.deactivate(render);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      eventBoundary?.removeEventListener("scroll", scrollInvalidation, { capture: true });
      eventBoundary?.removeEventListener("load", nativeInvalidation, { capture: true });
      view?.removeEventListener("resize", nativeInvalidation);
      view?.removeEventListener("scroll", scrollInvalidation);
      documentFonts?.removeEventListener("loadingdone", nativeInvalidation);
      documentFonts?.removeEventListener("loadingerror", nativeInvalidation);
      owners.clear();
      snapshots.clear();
      motions.clear();
      listeners.clear();
      observed.clear();
      scheduled = false;
      directPositionInvalidation = false;
    },
  };
}

function collectEntries(
  owners: ReadonlyMap<LayoutOwner, ReadonlyMap<Element, WebLayoutContinuity>>,
): ReadonlyMap<LayoutKey, LayoutEntry> {
  const result = new Map<LayoutKey, LayoutEntry>();
  for (const entries of owners.values()) {
    for (const [target, continuity] of entries) {
      const key = continuity.identity ?? target;
      const existing = result.get(key);
      if (existing && existing.target !== target) {
        throw new Error(`Web layout continuity identity "${String(key)}" is ambiguous.`);
      }
      result.set(key, { target, continuity });
    }
  }
  return result;
}

function createMotion(
  target: Element,
  box: LayoutBox,
  from: LayoutBox,
  velocity: Readonly<{
    velocityX: number;
    velocityY: number;
    velocityScaleX: number;
    velocityScaleY: number;
  }>,
  continuity: WebLayoutContinuity,
  coordinateScale: CoordinateScale,
  time: number,
  kind: "layout" | "replacement",
): LayoutMotion {
  const scaleX = box.inlineSize > 0 ? from.inlineSize / box.inlineSize : 1;
  const scaleY = box.blockSize > 0 ? from.blockSize / box.blockSize : 1;
  return Object.freeze({
    target,
    box,
    x: trajectory(
      (from.inlineStart - box.inlineStart) / coordinateScale.inline,
      velocity.velocityX / coordinateScale.inline,
      continuity,
      0,
    ),
    y: trajectory(
      (from.blockStart - box.blockStart) / coordinateScale.block,
      velocity.velocityY / coordinateScale.block,
      continuity,
      0,
    ),
    scaleX: trajectory(scaleX, velocity.velocityScaleX, continuity, 1),
    scaleY: trajectory(scaleY, velocity.velocityScaleY, continuity, 1),
    started: time,
    kind,
    strategy: continuity.strategy ?? "position",
    coordinateScale,
  });
}

const zeroBox = Object.freeze({ inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 });
const zeroVelocity = Object.freeze({
  inlineStart: 0,
  blockStart: 0,
  inlineSize: 0,
  blockSize: 0,
});

function sampleMotion(motion: LayoutMotion, time: number): WebLayoutSample {
  const elapsed = Math.max(0, time - motion.started);
  const x = motion.x.at(elapsed);
  const y = motion.y.at(elapsed);
  const scaleX = motion.scaleX.at(elapsed);
  const scaleY = motion.scaleY.at(elapsed);
  const duration = Math.max(
    motion.x.duration,
    motion.y.duration,
    motion.scaleX.duration,
    motion.scaleY.duration,
  );
  return Object.freeze({
    current: Object.freeze({
      inlineStart: motion.box.inlineStart + x.value * motion.coordinateScale.inline,
      blockStart: motion.box.blockStart + y.value * motion.coordinateScale.block,
      inlineSize:
        motion.strategy === "transform"
          ? motion.box.inlineSize * scaleX.value
          : motion.box.inlineSize,
      blockSize:
        motion.strategy === "transform"
          ? motion.box.blockSize * scaleY.value
          : motion.box.blockSize,
    }),
    destination: motion.box,
    velocity: Object.freeze({
      inlineStart: x.velocity * motion.coordinateScale.inline,
      blockStart: y.velocity * motion.coordinateScale.block,
      inlineSize: motion.strategy === "transform" ? motion.box.inlineSize * scaleX.velocity : 0,
      blockSize: motion.strategy === "transform" ? motion.box.blockSize * scaleY.velocity : 0,
    }),
    progress: duration === 0 ? 1 : Math.min(1, elapsed / duration),
    kind: motion.kind,
    settled: elapsed >= duration,
  });
}

function trajectory(
  from: number,
  velocity: number,
  continuity: WebLayoutContinuity,
  target: number,
): WebTrajectory {
  return createDynamicsTrajectory({ from, target, velocity, dynamics: continuity.dynamics });
}

function settled(motion: LayoutMotion, time: number): boolean {
  return (
    time - motion.started >=
    Math.max(motion.x.duration, motion.y.duration, motion.scaleX.duration, motion.scaleY.duration)
  );
}

function restoreProperty(
  style: CSSStyleDeclaration,
  name: string,
  value: string,
  priority: string,
): void {
  if (value) style.setProperty(name, value, priority);
  else style.removeProperty(name);
}

function suspendTransforms(target: Element): SuspendedTransform {
  const style = elementStyle(target);
  const properties = transformProperties.map((name) => ({
    name,
    value: style.getPropertyValue(name),
    priority: style.getPropertyPriority(name),
  }));
  for (const name of transformProperties) style.setProperty(name, "none");
  return { style, properties };
}

function restoreTransforms(transform: SuspendedTransform): void {
  for (const property of transform.properties) {
    restoreProperty(transform.style, property.name, property.value, property.priority);
  }
}

/** @internal Reads the axis-aligned coordinate basis used by the current web layout driver. */
export function readWebLayoutGeometry(target: Element): Readonly<{
  box: LayoutBox;
  coordinateScale: CoordinateScale;
}> {
  assertAxisAlignedAncestors(target);
  const box = target.getBoundingClientRect();
  const targetWithLayoutSize = target as Element & {
    offsetWidth?: number;
    offsetHeight?: number;
  };
  const inlineSize = finite(box.width);
  const blockSize = finite(box.height);
  const localInlineSize = targetWithLayoutSize.offsetWidth;
  const localBlockSize = targetWithLayoutSize.offsetHeight;
  return Object.freeze({
    box: Object.freeze({
      inlineStart: finite(box.left),
      blockStart: finite(box.top),
      inlineSize,
      blockSize,
    }),
    coordinateScale: Object.freeze({
      inline:
        localInlineSize && localInlineSize > 0 ? positiveScale(inlineSize / localInlineSize) : 1,
      block: localBlockSize && localBlockSize > 0 ? positiveScale(blockSize / localBlockSize) : 1,
    }),
  });
}

function assertAxisAlignedAncestors(target: Element): void {
  const view = target.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return;
  for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const transform = view.getComputedStyle(ancestor).transform;
    if (!transform || transform === "none") continue;
    const twoDimensional = /^matrix\(([^)]+)\)$/.exec(transform);
    if (twoDimensional) {
      const values = matrixValues(twoDimensional[1]!);
      if (
        values.length === 6 &&
        values.every(Number.isFinite) &&
        nearZero(values[1]!) &&
        nearZero(values[2]!)
      ) {
        continue;
      }
    }
    const threeDimensional = /^matrix3d\(([^)]+)\)$/.exec(transform);
    if (threeDimensional) {
      const values = matrixValues(threeDimensional[1]!);
      const offAxis = [1, 2, 3, 4, 6, 7, 8, 9, 11];
      if (
        values.length === 16 &&
        values.every(Number.isFinite) &&
        offAxis.every((index) => nearZero(values[index]!))
      ) {
        continue;
      }
    }
    throw new TypeError(
      "Web layout continuity currently requires axis-aligned ancestor transforms.",
    );
  }
}

function matrixValues(value: string): number[] {
  return value.split(",").map((part) => Number.parseFloat(part.trim()));
}

function nearZero(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) < 1e-8;
}

function sameBox(left: LayoutBox, right: LayoutBox): boolean {
  return (
    left.inlineStart === right.inlineStart &&
    left.blockStart === right.blockStart &&
    left.inlineSize === right.inlineSize &&
    left.blockSize === right.blockSize
  );
}

function hasLayoutBox(target: Element): boolean {
  const candidate = target as Element & {
    readonly isConnected?: boolean;
    getClientRects?: () => ArrayLike<unknown>;
  };
  if (candidate.isConnected === false) return false;
  return typeof candidate.getClientRects !== "function" || candidate.getClientRects().length > 0;
}

function elementStyle(target: Element): CSSStyleDeclaration {
  const style = (target as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new TypeError("A layout-continuous web Element must expose native style.");
  return style;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("Web layout geometry must be finite.");
  return value;
}

function positiveScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Web layout coordinate scale must be finite and positive.");
  }
  return value;
}
