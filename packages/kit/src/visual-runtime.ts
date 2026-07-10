import { attrs as stylexAttrs, type CompiledStyles, type StyleXStyles } from "@stylexjs/stylex";
import { layout as layoutText, prepare as prepareText, type PreparedText } from "@chenglou/pretext";
import { spring } from "animejs";

const preparedTextCache = new Map<string, PreparedText>();
let observesFonts = false;

export type CompiledVisualEntry = {
  readonly style: StyleXStyles | CompiledStyles | ((...values: unknown[]) => StyleXStyles);
  readonly values: readonly {
    readonly name: string;
    readonly kind: string;
  }[];
};

export type CompiledVisualPart = {
  readonly always: readonly CompiledVisualEntry[];
  readonly conditions: readonly {
    readonly when: {
      readonly state?: Readonly<Record<string, unknown>>;
      readonly variant?: Readonly<Record<string, unknown>>;
      readonly theme?: string;
    };
    readonly entry: CompiledVisualEntry;
  }[];
  readonly motion: unknown;
};

export type CompiledVisualPreset = {
  readonly themes: Readonly<Record<string, StyleXStyles | CompiledStyles | null>>;
  readonly motion: Readonly<Record<string, unknown>>;
  readonly themeMotion: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components: Readonly<Record<string, Readonly<Record<string, CompiledVisualPart>>>>;
};

export type CompiledVisuals = Readonly<Record<string, CompiledVisualPreset>>;

export type VisualPartRuntimeContext = {
  readonly theme: string;
  readonly variants: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly values: Readonly<Record<string, unknown>>;
};

export type VisualCoordinatorSnapshot = {
  readonly preset: string;
  readonly theme: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly variants: Readonly<Record<string, unknown>>;
  readonly values: Readonly<Record<string, unknown>>;
};

export type VisualCoordinator = {
  update(snapshot: VisualCoordinatorSnapshot): void;
  dispose(): void;
};

type OwnedAnimation = {
  owner: string;
  animation: Animation;
  cleanup?: () => void;
  externalCancel: () => void;
};

export type VisualMotionBackend = "instant" | "sampled-waapi" | "waapi";

export function selectVisualMotionBackend(value: unknown): VisualMotionBackend {
  if (value === "none") return "instant";
  return Object.keys(record(record(value).spring)).length ? "sampled-waapi" : "waapi";
}
type OwnAnimation = (
  element: Element,
  owner: string,
  animation: Animation,
  cleanup?: () => void,
) => void;
type SettleAnimation = (element: Element, animation: Animation) => void;

type ProjectionSnapshot = {
  readonly clone: HTMLElement;
  readonly container?: HTMLElement;
  readonly rectangle: DOMRectReadOnly;
  readonly opacity: number;
  readonly textHeight?: number;
  readonly variables: readonly (readonly [string, string])[];
};

type VisualExitController = {
  run(): Promise<void>;
  cancel(): void;
};

const visualExitControllers = new WeakMap<HTMLElement, VisualExitController>();
const visualMotionCancellers = new WeakMap<HTMLElement, () => void>();
const visualPresenceEvent = "poggers:visual-presence";

export function hasVisualExit(element: HTMLElement): boolean {
  return visualExitControllers.has(element);
}

export function hasVisualExitWithin(element: HTMLElement): boolean {
  return visualExitElementsWithin(element).length > 0;
}

export function runVisualExit(element: HTMLElement): Promise<void> {
  return visualExitControllers.get(element)?.run() ?? Promise.resolve();
}

export function runVisualExitWithin(element: HTMLElement): Promise<void> {
  return Promise.all(visualExitElementsWithin(element).map(runVisualExit)).then(() => undefined);
}

export function cancelVisualExit(element: HTMLElement): void {
  visualExitControllers.get(element)?.cancel();
}

export function cancelVisualExitWithin(element: HTMLElement): void {
  for (const candidate of visualExitElementsWithin(element)) cancelVisualExit(candidate);
}

export function cancelVisualMotion(element: HTMLElement): void {
  visualMotionCancellers.get(element)?.();
}

export function cancelVisualMotionWithin(element: HTMLElement): void {
  cancelVisualMotion(element);
  for (const candidate of element.querySelectorAll<HTMLElement>("*")) {
    cancelVisualMotion(candidate);
  }
}

export function notifyVisualPresence(element: HTMLElement): void {
  element.dispatchEvent(new CustomEvent(visualPresenceEvent, { bubbles: true }));
}

function visualExitElementsWithin(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].filter(hasVisualExit);
}

export function visualPartAttributes(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
  context: VisualPartRuntimeContext,
) {
  const preset = compiled[presetName];
  const part = preset?.components[componentName]?.[partName];
  if (!preset || !part) return {};

  const styles: Array<StyleXStyles | CompiledStyles | null | undefined> = [];
  if (partName === "Root") styles.push(preset.themes[context.theme]);
  for (const entry of part.always) styles.push(resolveEntry(entry, context.values));
  for (const conditional of part.conditions) {
    if (conditionMatches(conditional.when, context)) {
      styles.push(resolveEntry(conditional.entry, context.values));
    }
  }
  return stylexAttrs(...styles);
}

export function visualPartMotion(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
): unknown {
  return compiled[presetName]?.components[componentName]?.[partName]?.motion;
}

export function isCompiledVisualPreset(compiled: CompiledVisuals | undefined, preset: string) {
  return Boolean(compiled?.[preset]);
}

export function createVisualCoordinator(options: {
  readonly compiled: CompiledVisuals;
  readonly component: string;
  readonly refs: Readonly<Record<string, Element | null>>;
  readonly elements?: Readonly<Record<string, ReadonlySet<Element>>>;
  readonly suppressInitialEnter?: boolean;
}): VisualCoordinator {
  const rectangles = new Map<Element, DOMRectReadOnly>();
  const projectionSnapshots = new Map<Element, ProjectionSnapshot>();
  const sharedRectangles = new Map<
    string,
    { element: Element; rectangle: DOMRectReadOnly; snapshot?: ProjectionSnapshot }
  >();
  const animations = new Map<Element, OwnedAnimation>();
  const exits = new Map<HTMLElement, VisualExitController & { pending?: Promise<void> }>();
  const gestures = new Map<HTMLElement, () => void>();
  const gestureResets = new Map<HTMLElement, () => void>();
  const observed = new Set<Element>();
  const mutationObserver =
    typeof MutationObserver === "function" ? new MutationObserver(() => schedule()) : undefined;
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (!animations.size && !scheduled) {
            // ResizeObserver runs before paint. Flush here so a responsive
            // destination is projected before one frame of it can flash.
            scheduled = true;
            flush();
          }
        })
      : undefined;
  let snapshot: VisualCoordinatorSnapshot | undefined;
  let snapshotKey = "";
  let scheduled = false;
  let disposed = false;
  let initialized = false;
  let suppressEntrances = Boolean(options.suppressInitialEnter);
  let revision = 0;
  let observedRoot: HTMLElement | undefined;

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else queueMicrotask(flush);
  };

  const cancel = (element: Element) => {
    const active = animations.get(element);
    if (!active) return;
    active.animation.cancel();
    active.cleanup?.();
    animations.delete(element);
    if (
      element instanceof HTMLElement &&
      visualMotionCancellers.get(element) === active.externalCancel
    ) {
      visualMotionCancellers.delete(element);
    }
  };

  const own: OwnAnimation = (element, owner, animation, cleanup) => {
    cancel(element);
    const externalCancel = () => cancel(element);
    animations.set(element, { owner, animation, cleanup, externalCancel });
    if (element instanceof HTMLElement) visualMotionCancellers.set(element, externalCancel);
  };

  const settle: SettleAnimation = (element, animation) => {
    const active = animations.get(element);
    if (active?.animation !== animation) return;
    animation.cancel();
    active.cleanup?.();
    animations.delete(element);
    if (
      element instanceof HTMLElement &&
      visualMotionCancellers.get(element) === active.externalCancel
    ) {
      visualMotionCancellers.delete(element);
    }
    if (!animations.size) schedule();
  };

  const elementsFor = (partName: string): readonly Element[] => {
    const elements = options.elements?.[partName];
    if (elements) return [...elements];
    const element = options.refs[partName];
    return element ? [element] : [];
  };

  const registerExit = (element: HTMLElement, value: unknown, preset: CompiledVisualPreset) => {
    if (exits.has(element)) return;
    let finishPending: (() => void) | undefined;
    const controller: VisualExitController & { pending?: Promise<void> } = {
      run() {
        if (controller.pending) return controller.pending;
        const currentSnapshot = snapshot;
        if (!currentSnapshot || disposed) return Promise.resolve();
        controller.pending = new Promise<void>((resolve) => {
          const previousAriaHidden = element.getAttribute("aria-hidden");
          const wasInert = element.hasAttribute("inert");
          let completed = false;
          const finish = () => {
            if (completed) return;
            completed = true;
            if (previousAriaHidden == null) element.removeAttribute("aria-hidden");
            else element.setAttribute("aria-hidden", previousAriaHidden);
            if (!wasInert) element.removeAttribute("inert");
            gestureResets.get(element)?.();
            rectangles.delete(element);
            projectionSnapshots.delete(element);
            for (const [id, shared] of sharedRectangles) {
              if (shared.element === element) sharedRectangles.delete(id);
            }
            controller.pending = undefined;
            finishPending = undefined;
            resolve();
          };
          finishPending = finish;
          element.setAttribute("aria-hidden", "true");
          element.setAttribute("inert", "");
          animateExit(element, value, preset, currentSnapshot, cancel, own, settle, finish);
        });
        return controller.pending;
      },
      cancel() {
        if (animations.get(element)?.owner === "exit") cancel(element);
        finishPending?.();
      },
    };
    exits.set(element, controller);
    visualExitControllers.set(element, controller);
  };

  const registerGesture = (element: HTMLElement, value: unknown, preset: CompiledVisualPreset) => {
    if (gestures.has(element)) return;
    const gesture = record(value);
    const handleName = typeof gesture.handle === "string" ? gesture.handle : undefined;
    const handle = (handleName ? elementsFor(handleName) : [element]).find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
    );
    if (!handle) return;
    const axis = gesture.axis === "inline" || gesture.axis === "both" ? gesture.axis : "block";
    const bounds = Array.isArray(gesture.bounds) ? gesture.bounds : [-Infinity, Infinity];
    const lower = finite(bounds[0], -Infinity);
    const upper = finite(bounds[1], Infinity);
    const rubberBand = Math.max(0, finite(gesture.rubberBand, 0));
    let dragging = false;
    let pointerId = -1;
    let startInline = 0;
    let startBlock = 0;
    let inline = 0;
    let block = 0;
    let velocity = 0;
    let lastCoordinate = 0;
    let lastTime = 0;
    let previousTransform = "";
    let previousWillChange = "";
    let gestureBaseTransform = "matrix(1, 0, 0, 1, 0, 0)";
    let verticalWriting = false;
    let verticalRightToLeft = false;
    let rightToLeft = false;
    let gestureFrame = 0;

    const logicalCoordinates = (event: PointerEvent) => {
      return verticalWriting
        ? { inline: event.clientY, block: event.clientX }
        : { inline: event.clientX, block: event.clientY };
    };
    const constrain = (offset: number) => {
      if (offset < lower) return lower - (lower - offset) * rubberBand;
      if (offset > upper) return upper + (offset - upper) * rubberBand;
      return offset;
    };
    const renderGesture = () => {
      gestureFrame = 0;
      const offset = verticalWriting
        ? { x: block * (verticalRightToLeft ? -1 : 1), y: inline }
        : { x: inline * (rightToLeft ? -1 : 1), y: block };
      const [, moved] = transformedPresentation(
        element,
        { x: offset.x, y: offset.y },
        gestureBaseTransform,
      );
      element.style.transform = moved;
    };
    const reset = () => {
      if (gestureFrame) cancelAnimationFrame(gestureFrame);
      gestureFrame = 0;
      element.style.transform = previousTransform;
      element.style.willChange = previousWillChange;
      gestureResets.delete(element);
    };
    const settleGesture = () => {
      if (prefersReducedMotion()) {
        reset();
        return;
      }
      const driver = motionDriver(preset, snapshot?.theme ?? "default", gesture.settle);
      if (!driver || driver === "none") {
        reset();
        return;
      }
      let animation: Animation;
      animation = startMotion(
        element,
        { transform: [element.style.transform, gestureBaseTransform] },
        driver,
        () => {
          settle(element, animation);
        },
      );
      own(element, "gesture", animation, reset);
    };
    const finishGesture = (event: PointerEvent, cancelled: boolean) => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      if (gestureFrame) {
        cancelAnimationFrame(gestureFrame);
        renderGesture();
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {}
      const dismiss = record(gesture.dismiss);
      const distance = Math.max(0, finite(dismiss.distance, Infinity));
      const dismissVelocity = Math.max(0, finite(dismiss.velocity, Infinity));
      const offset = axis === "inline" ? inline : block;
      if (!cancelled && (offset >= distance || velocity >= dismissVelocity)) {
        gestureResets.set(element, reset);
        element.dispatchEvent(
          new CustomEvent("visualdismiss", {
            bubbles: true,
            detail: { value: record(gesture.value).name, offset, velocity },
          }),
        );
        return;
      }
      settleGesture();
    };
    const move = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const events = event.getCoalescedEvents?.() ?? [event];
      const latest = events[events.length - 1] ?? event;
      const point = logicalCoordinates(latest);
      inline = axis === "block" ? 0 : constrain(point.inline - startInline);
      block = axis === "inline" ? 0 : constrain(point.block - startBlock);
      const coordinate = axis === "inline" ? point.inline : point.block;
      const elapsed = Math.max(1, latest.timeStamp - lastTime);
      velocity = (coordinate - lastCoordinate) / elapsed;
      lastCoordinate = coordinate;
      lastTime = latest.timeStamp;
      if (!gestureFrame) gestureFrame = requestAnimationFrame(renderGesture);
    };
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        !event.isPrimary ||
        !isVisible(handle) ||
        matchesOpenTopLayer(element)
      )
        return;
      cancel(element);
      const computed = getComputedStyle(element);
      verticalWriting =
        computed.writingMode.startsWith("vertical") || computed.writingMode.startsWith("sideways");
      verticalRightToLeft = computed.writingMode.endsWith("-rl");
      rightToLeft = computed.direction === "rtl";
      const point = logicalCoordinates(event);
      dragging = true;
      pointerId = event.pointerId;
      startInline = point.inline;
      startBlock = point.block;
      inline = 0;
      block = 0;
      velocity = 0;
      lastCoordinate = axis === "inline" ? point.inline : point.block;
      lastTime = event.timeStamp;
      previousTransform = element.style.transform;
      previousWillChange = element.style.willChange;
      [gestureBaseTransform] = transformedPresentation(element, {}, computed.transform);
      element.style.willChange = "transform";
      try {
        handle.setPointerCapture(pointerId);
      } catch {}
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", pointerCancel);
      event.preventDefault();
    };
    const up = (event: PointerEvent) => finishGesture(event, false);
    const pointerCancel = (event: PointerEvent) => finishGesture(event, true);
    handle.addEventListener("pointerdown", down);
    gestures.set(element, () => {
      handle.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      reset();
    });
  };

  const flush = () => {
    scheduled = false;
    if (disposed || !snapshot) return;
    const currentRevision = revision;
    const preset = options.compiled[snapshot.preset];
    if (!preset) return;
    const parts = preset.components[options.component] ?? {};
    const nextRectangles = new Map<Element, DOMRectReadOnly>();
    const nextProjectionSnapshots = new Map<Element, ProjectionSnapshot>();
    const nextShared = new Map<
      string,
      { element: Element; rectangle: DOMRectReadOnly; snapshot?: ProjectionSnapshot }
    >();
    const measured: Array<{
      element: HTMLElement;
      motion: Record<string, any>;
      active?: OwnedAnimation;
      presentation?: DOMRectReadOnly;
      previous?: DOMRectReadOnly;
      previousSnapshot?: ProjectionSnapshot;
      target?: DOMRectReadOnly;
      targetSnapshot?: ProjectionSnapshot;
    }> = [];

    // Read every current presentation before cancelling any owner. This keeps
    // interrupted transactions continuous and avoids read/write alternation.
    for (const [partName, part] of Object.entries(parts)) {
      const motion = record(part.motion);
      for (const candidate of elementsFor(partName)) {
        if (!(candidate instanceof HTMLElement) || !candidate.isConnected) continue;
        if (!observed.has(candidate)) {
          observed.add(candidate);
          resizeObserver?.observe(candidate);
        }
        if (motion.exit) registerExit(candidate, motion.exit, preset);
        if (motion.gesture) registerGesture(candidate, motion.gesture, preset);
        if (!Object.keys(motion).length || !isVisible(candidate)) continue;
        const active = animations.get(candidate);
        measured.push({
          element: candidate,
          motion,
          active,
          presentation: candidate.getBoundingClientRect(),
          previous: rectangles.get(candidate),
          previousSnapshot: projectionSnapshots.get(candidate),
        });
      }
    }

    for (const item of measured) {
      if (!item.active) continue;
      item.previous = item.presentation;
      cancel(item.element);
    }

    // Read all destination geometry after temporary animation styles have been
    // removed, then perform animation writes in a separate pass.
    for (const item of measured) {
      item.target = item.element.getBoundingClientRect();
      nextRectangles.set(item.element, item.target);
      if (needsProjectionSnapshot(item.motion)) {
        item.targetSnapshot = captureProjectionSnapshot(
          item.element,
          item.target,
          record(item.motion.layout).geometry === "text",
        );
        nextProjectionSnapshots.set(item.element, item.targetSnapshot);
      }
    }

    for (const item of measured) {
      const { element, motion, previous, previousSnapshot, target, targetSnapshot } = item;
      if (!target) continue;
      const shared = record(motion.shared);
      const sharedId = typeof shared.id === "string" ? shared.id : undefined;
      const priorShared = sharedId ? sharedRectangles.get(sharedId) : undefined;
      const isNewSharedTarget = sharedId && !rectangles.has(element);

      if (sharedId && (isNewSharedTarget || !nextShared.has(sharedId))) {
        nextShared.set(sharedId, { element, rectangle: target, snapshot: targetSnapshot });
      }

      if (sharedId && priorShared && priorShared.element !== element && isNewSharedTarget) {
        animateLayout(
          element,
          priorShared.rectangle,
          target,
          { geometry: "frame", using: shared.using },
          preset,
          snapshot,
          priorShared.snapshot,
          own,
          settle,
          true,
        );
      } else if (previous && motion.layout) {
        animateLayout(
          element,
          previous,
          target,
          motion.layout,
          preset,
          snapshot,
          previousSnapshot,
          own,
          settle,
        );
      } else if (!previous && motion.enter && !suppressEntrances) {
        animateEntrance(element, motion.enter, preset, snapshot, cancel, own, settle);
      }
    }

    if (currentRevision !== revision || disposed) return;
    rectangles.clear();
    for (const [element, rectangle] of nextRectangles) rectangles.set(element, rectangle);
    projectionSnapshots.clear();
    for (const [element, visual] of nextProjectionSnapshots) {
      projectionSnapshots.set(element, visual);
    }
    sharedRectangles.clear();
    for (const [id, value] of nextShared) sharedRectangles.set(id, value);
    initialized = true;
    suppressEntrances = false;
    const root = elementsFor("Root").find(
      (element): element is HTMLElement => element instanceof HTMLElement && element.isConnected,
    );
    if (root !== observedRoot) {
      observedRoot?.removeEventListener(visualPresenceEvent, schedule);
      observedRoot = root;
      observedRoot?.addEventListener(visualPresenceEvent, schedule);
    }
    if (root && mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    }
  };

  return {
    update(next) {
      const replacement = snapshot && snapshot.preset !== next.preset;
      snapshot = next;
      revision++;
      const nextKey = visualSnapshotKey(options.compiled, options.component, next);
      if (replacement) {
        for (const element of animations.keys()) cancel(element);
        for (const [element, controller] of exits) {
          controller.cancel();
          if (visualExitControllers.get(element) === controller) {
            visualExitControllers.delete(element);
          }
        }
        exits.clear();
        for (const cleanup of gestures.values()) cleanup();
        gestures.clear();
        gestureResets.clear();
        rectangles.clear();
        projectionSnapshots.clear();
        sharedRectangles.clear();
        initialized = true;
        suppressEntrances = true;
      }
      if (!replacement && initialized && nextKey === snapshotKey) return;
      snapshotKey = nextKey;
      schedule();
    },
    dispose() {
      disposed = true;
      revision++;
      for (const element of animations.keys()) cancel(element);
      animations.clear();
      rectangles.clear();
      projectionSnapshots.clear();
      sharedRectangles.clear();
      for (const [element, controller] of exits) {
        controller.cancel();
        if (visualExitControllers.get(element) === controller)
          visualExitControllers.delete(element);
      }
      exits.clear();
      for (const cleanup of gestures.values()) cleanup();
      gestures.clear();
      gestureResets.clear();
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedRoot?.removeEventListener(visualPresenceEvent, schedule);
      observedRoot = undefined;
      observed.clear();
    },
  };
}

function visualSnapshotKey(
  compiled: CompiledVisuals,
  component: string,
  snapshot: VisualCoordinatorSnapshot,
): string {
  const parts = compiled[snapshot.preset]?.components[component] ?? {};
  const state = new Set<string>();
  const variants = new Set<string>();
  const values = new Set<string>();
  for (const part of Object.values(parts)) {
    for (const entry of part.always) for (const value of entry.values) values.add(value.name);
    for (const conditional of part.conditions) {
      for (const value of conditional.entry.values) values.add(value.name);
      for (const name of Object.keys(conditional.when.state ?? {})) state.add(name);
      for (const name of Object.keys(conditional.when.variant ?? {})) variants.add(name);
    }
  }
  return JSON.stringify({
    preset: snapshot.preset,
    theme: snapshot.theme,
    state: [...state].sort().map((name) => [name, snapshot.state[name]]),
    variants: [...variants].sort().map((name) => [name, snapshot.variants[name]]),
    values: [...values].sort().map((name) => [name, snapshot.values[name]]),
  });
}

function animateLayout(
  element: HTMLElement,
  before: DOMRectReadOnly,
  after: DOMRectReadOnly,
  value: unknown,
  preset: CompiledVisualPreset,
  snapshot: VisualCoordinatorSnapshot,
  previousSnapshot: ProjectionSnapshot | undefined,
  own: OwnAnimation,
  settle: SettleAnimation,
  sharedMorph = false,
): void {
  const layout = record(value);
  const geometry = layout.geometry;
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  const widthChanged = Math.abs(before.width - after.width) > 0.5;
  const heightChanged = Math.abs(before.height - after.height) > 0.5;
  if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && !widthChanged && !heightChanged) return;
  const driver = motionDriver(preset, snapshot.theme, layout.using);
  if (!driver || driver === "none" || prefersReducedMotion()) return;
  if (matchesOpenTopLayer(element)) return;
  const insideOpenLayer = Boolean(closestOpenLayer(element));

  if (
    previousSnapshot &&
    typeof document !== "undefined" &&
    ((sharedMorph && !insideOpenLayer) ||
      (geometry !== "position" && (widthChanged || heightChanged) && !insideOpenLayer))
  ) {
    animateProjectedLayout(element, before, after, previousSnapshot, driver, own, settle);
    return;
  }

  const translateOnly = geometry === "position" || insideOpenLayer;
  const scaleX = translateOnly || !after.width ? 1 : before.width / after.width;
  const scaleY = translateOnly || !after.height ? 1 : before.height / after.height;
  const [baseTransform, invertedTransform] = transformedPresentation(element, {
    x: dx,
    y: dy,
    scaleX,
    scaleY,
  });
  const properties = { transform: [invertedTransform, baseTransform] };
  const cleanup = scaleX !== 1 || scaleY !== 1 ? temporaryTransformOrigin(element) : undefined;
  let animation: Animation;
  animation = startMotion(element, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "layout", animation, cleanup);
}

function animateProjectedLayout(
  element: HTMLElement,
  before: DOMRectReadOnly,
  after: DOMRectReadOnly,
  snapshot: ProjectionSnapshot,
  driver: unknown,
  own: OwnAnimation,
  settle: SettleAnimation,
): void {
  const projection = mountProjectionSnapshot(snapshot, closestOpenLayer(element));
  if (!projection) return;
  const targetOpacity = finite(Number.parseFloat(getComputedStyle(element).opacity), 1);
  const identity = "matrix(1, 0, 0, 1, 0, 0)";
  const sourceFrom = projectedTransform(snapshot.rectangle, before, identity);
  const sourceTo = projectedTransform(snapshot.rectangle, after, identity);
  const [targetTo, targetFrom] = transformedPresentation(element, {
    x: before.left - after.left,
    y: before.top - after.top,
    scaleX: after.width ? before.width / after.width : 1,
    scaleY: after.height ? before.height / after.height : 1,
  });

  const cloneAnimation = startMotion(
    projection.clone,
    { transform: [sourceFrom, sourceTo] },
    driver,
    () => {},
  );
  const timing = motionTiming(driver);
  const fadeDuration = Math.max(48, Math.min(96, timing.duration * 0.2));
  const fadeDelay = timing.delay + Math.max(0, timing.duration * 0.55 - fadeDuration / 2);
  const cloneFade = projection.clone.animate([{ opacity: snapshot.opacity }, { opacity: 0 }], {
    delay: fadeDelay,
    duration: fadeDuration,
    easing: "linear",
    fill: "both",
  });
  const targetFade = element.animate([{ opacity: 0 }, { opacity: targetOpacity }], {
    delay: fadeDelay,
    duration: fadeDuration,
    easing: "linear",
    fill: "both",
  });
  const restoreOrigin = temporaryTransformOrigin(element);
  let animation: Animation;
  animation = startMotion(element, { transform: [targetFrom, targetTo] }, driver, () =>
    settle(element, animation),
  );
  own(
    element,
    "layout",
    animation,
    composeCleanups([
      restoreOrigin,
      () => cloneAnimation.cancel(),
      () => cloneFade.cancel(),
      () => targetFade.cancel(),
      projection.remove,
    ]),
  );
}

function projectedTransform(
  source: DOMRectReadOnly,
  target: DOMRectReadOnly,
  base: string,
): string {
  const [, projected] = transformedPresentation(
    document.documentElement,
    {
      x: target.left - source.left,
      y: target.top - source.top,
      scaleX: source.width ? target.width / source.width : 1,
      scaleY: source.height ? target.height / source.height : 1,
    },
    base,
  );
  return projected;
}

function temporaryTransformOrigin(element: HTMLElement): () => void {
  const previous = element.style.transformOrigin;
  element.style.transformOrigin = "0 0";
  return () => {
    element.style.transformOrigin = previous;
  };
}

function needsProjectionSnapshot(motion: Record<string, unknown>): boolean {
  if (Object.keys(record(motion.shared)).length) return true;
  const geometry = record(motion.layout).geometry;
  return geometry === "frame" || geometry === "text";
}

function captureProjectionSnapshot(
  element: HTMLElement,
  rectangle: DOMRectReadOnly,
  measureText: boolean,
): ProjectionSnapshot {
  const computed = getComputedStyle(element);
  const variables: Array<readonly [string, string]> = [];
  for (let index = 0; index < computed.length; index++) {
    const name = computed.item(index);
    if (name.startsWith("--")) variables.push([name, computed.getPropertyValue(name)]);
  }
  const clone = element.cloneNode(true) as HTMLElement;
  sanitizeProjectionTree(clone);
  return {
    clone,
    container: closestOpenLayer(element),
    rectangle,
    opacity: finite(Number.parseFloat(computed.opacity), 1),
    textHeight: measureText ? predictedTextHeight(element, rectangle.width, computed) : undefined,
    variables,
  };
}

function closestOpenLayer(element: HTMLElement): HTMLElement | undefined {
  let candidate = element.parentElement;
  while (candidate) {
    if (matchesOpenTopLayer(candidate)) return candidate;
    candidate = candidate.parentElement;
  }
  return;
}

function sanitizeProjectionTree(root: HTMLElement): void {
  const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
  for (const element of elements) {
    for (const attribute of [
      "aria-controls",
      "aria-describedby",
      "aria-labelledby",
      "autofocus",
      "for",
      "id",
      "popover",
      "popovertarget",
    ]) {
      element.removeAttribute(attribute);
    }
  }
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
}

function mountProjectionSnapshot(
  snapshot: ProjectionSnapshot,
  targetContainer?: HTMLElement,
): { clone: HTMLElement; remove: () => void } | undefined {
  const parent = targetContainer ?? snapshot.container ?? document.body ?? document.documentElement;
  if (!parent) return;
  const host = document.createElement("div");
  const clone = snapshot.clone.cloneNode(true) as HTMLElement;
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  host.setAttribute("data-poggers-projection", "");
  Object.assign(host.style, {
    background: "transparent",
    border: "0",
    height: "0px",
    inset: "0px auto auto 0px",
    margin: "0",
    maxHeight: "none",
    maxWidth: "none",
    overflow: "visible",
    padding: "0",
    pointerEvents: "none",
    position: "fixed",
    width: "0px",
    zIndex: "2147483647",
  });
  for (const [name, value] of snapshot.variables) clone.style.setProperty(name, value);
  const height =
    snapshot.textHeight != null && Math.abs(snapshot.textHeight - snapshot.rectangle.height) <= 2
      ? snapshot.textHeight
      : snapshot.rectangle.height;
  Object.assign(clone.style, {
    animation: "none",
    boxSizing: "border-box",
    contain: "layout style",
    height: `${height}px`,
    inset: "auto",
    left: `${snapshot.rectangle.left}px`,
    margin: "0",
    maxHeight: "none",
    maxWidth: "none",
    minHeight: "0",
    minWidth: "0",
    opacity: String(snapshot.opacity),
    pointerEvents: "none",
    position: "fixed",
    rotate: "none",
    scale: "none",
    top: `${snapshot.rectangle.top}px`,
    transform: "none",
    transformOrigin: "0 0",
    transition: "none",
    translate: "none",
    width: `${snapshot.rectangle.width}px`,
  });
  host.append(clone);
  parent.append(host);

  let removed = false;
  return {
    clone,
    remove() {
      if (removed) return;
      removed = true;
      host.remove();
    },
  };
}

function predictedTextHeight(
  element: HTMLElement,
  width: number,
  style = getComputedStyle(element),
): number | undefined {
  const text = element.textContent?.trim();
  if (!text || width <= 0) return;
  const font = style.font;
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!font || !Number.isFinite(lineHeight) || lineHeight <= 0) return;
  if (/\bsystem-ui\b/i.test(font)) return;
  if (typeof document !== "undefined" && document.fonts) {
    if (!document.fonts.check(font, text)) return;
    if (!observesFonts) {
      observesFonts = true;
      document.fonts.addEventListener("loadingdone", () => preparedTextCache.clear());
    }
  }
  const horizontalPadding =
    Number.parseFloat(style.paddingInlineStart) +
    Number.parseFloat(style.paddingInlineEnd) +
    Number.parseFloat(style.borderInlineStartWidth) +
    Number.parseFloat(style.borderInlineEndWidth);
  const verticalPadding =
    Number.parseFloat(style.paddingBlockStart) +
    Number.parseFloat(style.paddingBlockEnd) +
    Number.parseFloat(style.borderBlockStartWidth) +
    Number.parseFloat(style.borderBlockEndWidth);
  const available = Math.max(1, width - finite(horizontalPadding, 0));
  const whiteSpace = style.whiteSpace === "pre-wrap" ? "pre-wrap" : "normal";
  const wordBreak = style.wordBreak === "keep-all" ? "keep-all" : "normal";
  const letterSpacing = finite(Number.parseFloat(style.letterSpacing), 0);
  const key = `${font}\u0000${letterSpacing}\u0000${whiteSpace}\u0000${wordBreak}\u0000${text}`;
  try {
    let prepared = preparedTextCache.get(key);
    if (!prepared) {
      prepared = prepareText(text, font, { letterSpacing, whiteSpace, wordBreak });
      preparedTextCache.set(key, prepared);
    }
    return layoutText(prepared, available, lineHeight).height + finite(verticalPadding, 0);
  } catch {
    return;
  }
}

function animateEntrance(
  element: HTMLElement,
  value: unknown,
  preset: CompiledVisualPreset,
  snapshot: VisualCoordinatorSnapshot,
  cancel: (element: Element) => void,
  own: OwnAnimation,
  settle: SettleAnimation,
): void {
  const entrance = record(value);
  const driver = motionDriver(preset, snapshot.theme, entrance.using);
  if (!driver || driver === "none" || prefersReducedMotion()) return;
  cancel(element);
  const properties = animeFrame(record(entrance.from), element, "enter");
  if (matchesOpenTopLayer(element)) delete properties.transform;
  if (!Object.keys(properties).length) return;
  let animation: Animation;
  animation = startMotion(element, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "enter", animation);
}

function animateExit(
  element: HTMLElement,
  value: unknown,
  preset: CompiledVisualPreset,
  snapshot: VisualCoordinatorSnapshot,
  cancel: (element: Element) => void,
  own: OwnAnimation,
  settle: SettleAnimation,
  finish: () => void,
): void {
  const exit = record(value);
  const driver = motionDriver(preset, snapshot.theme, exit.using);
  if (!driver || driver === "none" || prefersReducedMotion()) {
    finish();
    return;
  }
  cancel(element);
  const openLayer = matchesOpenTopLayer(element);
  const insideOpenLayer = Boolean(closestOpenLayer(element));
  const rectangle = element.getBoundingClientRect();
  const projectionSnapshot =
    openLayer || insideOpenLayer ? undefined : captureProjectionSnapshot(element, rectangle, false);
  const projection = projectionSnapshot ? mountProjectionSnapshot(projectionSnapshot) : undefined;
  const target = projection?.clone ?? element;
  const properties = animeFrame(record(exit.to), target, "exit");
  if (openLayer) delete properties.transform;
  if (!Object.keys(properties).length) {
    projection?.remove();
    finish();
    return;
  }
  const cleanup = composeCleanups(
    projection ? [temporaryExitSource(element, rectangle), projection.remove, finish] : [finish],
  );
  let animation: Animation;
  animation = startMotion(target, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "exit", animation, cleanup);
}

function matchesPopoverOpen(element: HTMLElement): boolean {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}

function matchesOpenTopLayer(element: HTMLElement): boolean {
  return (
    matchesPopoverOpen(element) ||
    (typeof HTMLDialogElement !== "undefined" &&
      element instanceof HTMLDialogElement &&
      element.open)
  );
}

function temporaryExitSource(element: HTMLElement, rectangle: DOMRectReadOnly): () => void {
  const names = [
    "box-sizing",
    "height",
    "inset",
    "left",
    "margin",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "pointer-events",
    "position",
    "top",
    "visibility",
    "width",
  ] as const;
  const previous = names.map(
    (name) =>
      [
        name,
        element.style.getPropertyValue(name),
        element.style.getPropertyPriority(name),
      ] as const,
  );
  const set = (name: string, value: string) => element.style.setProperty(name, value, "important");
  set("box-sizing", "border-box");
  set("height", `${rectangle.height}px`);
  set("inset", "auto");
  set("left", `${rectangle.left}px`);
  set("margin", "0");
  set("max-height", "none");
  set("max-width", "none");
  set("min-height", "0");
  set("min-width", "0");
  set("pointer-events", "none");
  set("position", "fixed");
  set("top", `${rectangle.top}px`);
  set("visibility", "hidden");
  set("width", `${rectangle.width}px`);
  return () => {
    for (const [name, value, priority] of previous) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  };
}

function composeCleanups(cleanups: readonly (() => void)[]): () => void {
  let complete = false;
  return () => {
    if (complete) return;
    complete = true;
    for (const cleanup of cleanups) cleanup();
  };
}

function animeFrame(
  fragmentValue: Record<string, unknown>,
  element: HTMLElement,
  direction: "enter" | "exit",
): Record<string, unknown> {
  const computed = getComputedStyle(element);
  const effect = record(fragmentValue.effect);
  const transform = record(fragmentValue.transform);
  const pair = (from: unknown, target: unknown) =>
    direction === "enter" ? [from, target] : [target, from];
  const properties: Record<string, unknown> = {};
  if (typeof effect.opacity === "number") {
    properties.opacity = pair(effect.opacity, Number.parseFloat(computed.opacity) || 1);
  }
  const hasTransform = [transform.inline, transform.block, transform.scale, transform.rotate].some(
    (value) => typeof value === "number",
  );
  if (hasTransform) {
    const logical = logicalToPhysicalOffset(
      computed,
      finite(transform.inline, 0),
      finite(transform.block, 0),
    );
    const [base, moved] = transformedPresentation(element, {
      x: logical.x,
      y: logical.y,
      rotate: finite(transform.rotate, 0),
      scaleX: finite(transform.scale, 1),
      scaleY: finite(transform.scale, 1),
    });
    properties.transform = pair(moved, base);
  }
  return properties;
}

function logicalToPhysicalOffset(
  style: CSSStyleDeclaration,
  inline: number,
  block: number,
): { x: number; y: number } {
  const writingMode = style.writingMode;
  if (writingMode.startsWith("vertical") || writingMode.startsWith("sideways")) {
    return {
      x: block * (writingMode.endsWith("-rl") ? -1 : 1),
      y: inline,
    };
  }
  return { x: inline * (style.direction === "rtl" ? -1 : 1), y: block };
}

function transformedPresentation(
  element: HTMLElement,
  transform: {
    x?: number;
    y?: number;
    rotate?: number;
    scaleX?: number;
    scaleY?: number;
  },
  baseOverride?: string,
): [base: string, moved: string] {
  const identity = "matrix(1, 0, 0, 1, 0, 0)";
  const computed = baseOverride ?? getComputedStyle(element).transform;
  const base = !computed || computed === "none" ? identity : computed;
  const x = finite(transform.x, 0);
  const y = finite(transform.y, 0);
  const rotate = finite(transform.rotate, 0);
  const scaleX = finite(transform.scaleX, 1);
  const scaleY = finite(transform.scaleY, 1);

  if (typeof DOMMatrix === "function") {
    try {
      const baseMatrix = new DOMMatrix(base);
      const offset = new DOMMatrix().translate(x, y).rotate(rotate).scale(scaleX, scaleY);
      return [baseMatrix.toString(), offset.multiply(baseMatrix).toString()];
    } catch {}
  }

  return [
    base,
    `translate(${x}px, ${y}px) rotate(${rotate}deg) scale(${scaleX}, ${scaleY}) ${base}`,
  ];
}

function motionDriver(preset: CompiledVisualPreset, theme: string, reference: unknown): unknown {
  const name = record(reference).name;
  if (typeof name !== "string") return;
  return preset.themeMotion[theme]?.[name] ?? preset.motion[name];
}

function startMotion(
  element: HTMLElement,
  properties: Readonly<Record<string, unknown>>,
  driver: unknown,
  onComplete: () => void,
): Animation {
  const endpoints = motionEndpoints(properties);
  const timing = motionTiming(driver);
  const keyframes = timing.springEase
    ? sampledMotionKeyframes(endpoints, timing.duration, timing.springEase)
    : [endpoints.from, endpoints.to];
  const animation = element.animate(keyframes, {
    delay: timing.delay,
    duration: timing.duration,
    easing: timing.springEase ? "linear" : timing.easing,
    fill: "both",
  });
  animation.addEventListener("finish", onComplete, { once: true });
  return animation;
}

function motionEndpoints(properties: Readonly<Record<string, unknown>>): {
  from: Keyframe;
  to: Keyframe;
} {
  const from: Record<string, string | number> = {};
  const to: Record<string, string | number> = {};
  for (const [name, rawValue] of Object.entries(properties)) {
    if (name !== "opacity" && name !== "transform") {
      throw new Error(`Visual motion cannot animate non-compositor property ${name}.`);
    }
    if (!Array.isArray(rawValue) || rawValue.length < 2) {
      throw new Error(`Visual motion ${name} requires a from/to pair.`);
    }
    const first = rawValue[0];
    const last = rawValue[rawValue.length - 1];
    if (
      (typeof first !== "string" && typeof first !== "number") ||
      (typeof last !== "string" && typeof last !== "number")
    ) {
      throw new Error(`Visual motion ${name} requires numeric or transform values.`);
    }
    from[name] = first;
    to[name] = last;
  }
  return { from, to };
}

function motionTiming(value: unknown): {
  duration: number;
  delay: number;
  easing: string;
  springEase?: (progress: number) => number;
} {
  if (value === "none") return { duration: 0, delay: 0, easing: "linear" };
  const driver = record(value);
  const delay = typeof driver.delay === "number" ? driver.delay : 0;
  if (driver.spring) {
    const config = record(driver.spring);
    const duration = finite(config.duration, 400);
    const physical = spring({
      duration,
      bounce: finite(config.bounce, 0),
    });
    return {
      delay,
      duration,
      easing: "linear",
      springEase: physical.ease,
    };
  }
  const easing: Record<string, string> = {
    linear: "linear",
    smooth: "cubic-bezier(.65, 0, .35, 1)",
    accelerate: "cubic-bezier(.32, 0, .67, 0)",
    decelerate: "cubic-bezier(.33, 1, .68, 1)",
  };
  return {
    delay,
    duration: finite(driver.duration, 180),
    easing: easing[String(driver.easing)] ?? easing.decelerate!,
  };
}

function sampledMotionKeyframes(
  endpoints: { from: Keyframe; to: Keyframe },
  duration: number,
  ease: (progress: number) => number,
): Keyframe[] {
  const count = Math.max(16, Math.min(121, Math.ceil(duration / 8) + 1));
  const frames: Keyframe[] = [];
  for (let index = 0; index < count; index++) {
    const offset = index / (count - 1);
    const progress = index === 0 ? 0 : index === count - 1 ? 1 : ease(offset);
    const frame: Record<string, string | number> = { offset };
    for (const name of ["opacity", "transform"] as const) {
      const from = endpoints.from[name];
      const to = endpoints.to[name];
      if (from == null || to == null) continue;
      frame[name] = interpolateMotionValue(name, from, to, progress);
    }
    frames.push(frame);
  }
  return frames;
}

function interpolateMotionValue(
  name: "opacity" | "transform",
  from: string | number,
  to: string | number,
  progress: number,
): string | number {
  if (name === "opacity") {
    return Number(from) + (Number(to) - Number(from)) * progress;
  }
  if (typeof DOMMatrix !== "function") return progress < 1 ? String(from) : String(to);
  try {
    const start = new DOMMatrix(String(from));
    const end = new DOMMatrix(String(to));
    const values = [
      "m11",
      "m12",
      "m13",
      "m14",
      "m21",
      "m22",
      "m23",
      "m24",
      "m31",
      "m32",
      "m33",
      "m34",
      "m41",
      "m42",
      "m43",
      "m44",
    ] as const;
    const matrix = new DOMMatrix();
    for (const property of values) {
      matrix[property] = start[property] + (end[property] - start[property]) * progress;
    }
    return matrix.toString();
  } catch {
    return progress < 1 ? String(from) : String(to);
  }
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rectangle = element.getBoundingClientRect();
  return rectangle.width > 0 || rectangle.height > 0;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function resolveEntry(
  entry: CompiledVisualEntry,
  values: Readonly<Record<string, unknown>>,
): StyleXStyles | CompiledStyles {
  if (typeof entry.style !== "function") return entry.style;
  return entry.style(
    ...entry.values.map(({ name, kind }) => visualValue(values[name], kind)),
  ) as StyleXStyles;
}

function visualValue(value: unknown, kind: string): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  if (kind === "length") return value === 0 ? 0 : `${value}px`;
  if (kind === "angle") return value === 0 ? 0 : `${value}deg`;
  if (kind === "time") return value === 0 ? 0 : `${value}ms`;
  return value;
}

function conditionMatches(
  condition: CompiledVisualPart["conditions"][number]["when"],
  context: VisualPartRuntimeContext,
): boolean {
  if (condition.theme != null && context.theme !== condition.theme) return false;
  if (condition.state && !recordMatches(condition.state, context.state)) return false;
  if (condition.variant && !recordMatches(condition.variant, context.variants)) return false;
  return true;
}

function recordMatches(
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(expected).every(([name, value]) => Object.is(actual[name], value));
}
