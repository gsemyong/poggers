import { attrs as stylexAttrs, type CompiledStyles, type StyleXStyles } from "@stylexjs/stylex";
import { layout as layoutText, prepare as prepareText, type PreparedText } from "@chenglou/pretext";
import { animate, spring, waapi, type AnimationParams, type WAAPIAnimationParams } from "animejs";

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

type AnimeAnimation = ReturnType<typeof animate> | ReturnType<typeof waapi.animate>;
type OwnedAnimation = {
  owner: string;
  animation: AnimeAnimation;
  cleanup?: () => void;
  externalCancel: () => void;
};

export type VisualMotionBackend = "instant" | "anime-spring" | "waapi";

export function selectVisualMotionBackend(value: unknown): VisualMotionBackend {
  if (value === "none") return "instant";
  return Object.keys(record(record(value).spring)).length ? "anime-spring" : "waapi";
}
type OwnAnimation = (
  element: Element,
  owner: string,
  animation: AnimeAnimation,
  cleanup?: () => void,
) => void;
type SettleAnimation = (element: Element, animation: AnimeAnimation) => void;

type VisualExitController = {
  run(): Promise<void>;
  cancel(): void;
};

const visualExitControllers = new WeakMap<HTMLElement, VisualExitController>();
const visualMotionCancellers = new WeakMap<HTMLElement, () => void>();
const animatedStyleProperties = [
  "filter",
  "height",
  "left",
  "opacity",
  "top",
  "transform",
  "width",
  "will-change",
] as const;

export function hasVisualExit(element: HTMLElement): boolean {
  return visualExitControllers.has(element);
}

export function runVisualExit(element: HTMLElement): Promise<void> {
  return visualExitControllers.get(element)?.run() ?? Promise.resolve();
}

export function cancelVisualExit(element: HTMLElement): void {
  visualExitControllers.get(element)?.cancel();
}

export function cancelVisualMotion(element: HTMLElement): void {
  visualMotionCancellers.get(element)?.();
  clearVisualMotionPresentation(element);
}

function clearVisualMotionPresentation(element: HTMLElement): void {
  for (const animation of element.getAnimations()) animation.cancel();
  for (const property of animatedStyleProperties) element.style.removeProperty(property);
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
  const sharedRectangles = new Map<string, { element: Element; rectangle: DOMRectReadOnly }>();
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
          if (!animations.size) schedule();
        })
      : undefined;
  let snapshot: VisualCoordinatorSnapshot | undefined;
  let snapshotKey = "";
  let scheduled = false;
  let disposed = false;
  let initialized = false;
  let suppressEntrances = Boolean(options.suppressInitialEnter);
  let revision = 0;

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  const cancel = (element: Element) => {
    const active = animations.get(element);
    if (!active) return;
    active.animation.revert();
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
    animation.revert();
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
        clearVisualMotionPresentation(element);
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

    const logicalCoordinates = (event: PointerEvent) => {
      const vertical = getComputedStyle(element).writingMode.startsWith("vertical");
      return vertical
        ? { inline: event.clientY, block: event.clientX }
        : { inline: event.clientX, block: event.clientY };
    };
    const constrain = (offset: number) => {
      if (offset < lower) return lower - (lower - offset) * rubberBand;
      if (offset > upper) return upper + (offset - upper) * rubberBand;
      return offset;
    };
    const renderGesture = () => {
      const offset = logicalToPhysicalOffset(getComputedStyle(element), inline, block);
      const [, moved] = transformedPresentation(
        element,
        { x: offset.x, y: offset.y },
        gestureBaseTransform,
      );
      element.style.transform = moved;
    };
    const reset = () => {
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
      let animation: AnimeAnimation;
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
      const point = logicalCoordinates(event);
      inline = axis === "block" ? 0 : constrain(point.inline - startInline);
      block = axis === "inline" ? 0 : constrain(point.block - startBlock);
      const coordinate = axis === "inline" ? point.inline : point.block;
      const elapsed = Math.max(1, event.timeStamp - lastTime);
      velocity = (coordinate - lastCoordinate) / elapsed;
      lastCoordinate = coordinate;
      lastTime = event.timeStamp;
      renderGesture();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || !isVisible(handle)) return;
      cancel(element);
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
      [gestureBaseTransform] = transformedPresentation(element, {});
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
    const nextShared = new Map<string, { element: Element; rectangle: DOMRectReadOnly }>();
    const measured: Array<{
      element: HTMLElement;
      motion: Record<string, any>;
      active?: OwnedAnimation;
      presentation?: DOMRectReadOnly;
      previous?: DOMRectReadOnly;
      target?: DOMRectReadOnly;
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
    }

    for (const item of measured) {
      const { element, motion, previous, target } = item;
      if (!target) continue;
      const shared = record(motion.shared);
      const sharedId = typeof shared.id === "string" ? shared.id : undefined;
      const priorShared = sharedId ? sharedRectangles.get(sharedId) : undefined;
      const isNewSharedTarget = sharedId && !rectangles.has(element);

      if (sharedId && (isNewSharedTarget || !nextShared.has(sharedId))) {
        nextShared.set(sharedId, { element, rectangle: target });
      }

      if (sharedId && priorShared && priorShared.element !== element && isNewSharedTarget) {
        animateLayout(
          element,
          priorShared.rectangle,
          target,
          { geometry: "frame", content: "preserve", using: shared.using },
          preset,
          snapshot,
          own,
          settle,
        );
      } else if (previous && motion.layout) {
        animateLayout(element, previous, target, motion.layout, preset, snapshot, own, settle);
      } else if (!previous && motion.enter && !suppressEntrances) {
        animateEntrance(element, motion.enter, preset, snapshot, cancel, own, settle);
      }
    }

    if (currentRevision !== revision || disposed) return;
    rectangles.clear();
    for (const [element, rectangle] of nextRectangles) rectangles.set(element, rectangle);
    sharedRectangles.clear();
    for (const [id, value] of nextShared) sharedRectangles.set(id, value);
    initialized = true;
    suppressEntrances = false;
    const root = elementsFor("Root").find(
      (element): element is HTMLElement => element instanceof HTMLElement && element.isConnected,
    );
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
  own: OwnAnimation,
  settle: SettleAnimation,
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

  let scaleX = 1;
  let scaleY = 1;
  const properties: Record<string, unknown> = {};
  if (geometry === "size" || geometry === "frame" || geometry === "tracks" || geometry === "text") {
    if (layout.content === "scale") {
      scaleX = after.width ? before.width / after.width : 1;
      scaleY = after.height ? before.height / after.height : 1;
    } else {
      if (widthChanged) properties.width = [`${before.width}px`, `${after.width}px`];
      if (heightChanged) {
        const predicted =
          geometry === "text" ? predictedTextHeight(element, after.width) : undefined;
        const target =
          predicted != null && Math.abs(predicted - after.height) <= 2 ? predicted : after.height;
        properties.height = [`${before.height}px`, `${target}px`];
      }
    }
  }
  const [baseTransform, invertedTransform] = transformedPresentation(element, {
    x: dx,
    y: dy,
    scaleX,
    scaleY,
  });
  properties.transform = [invertedTransform, baseTransform];
  const cleanups: Array<() => void> = [
    temporaryAnimatedStyles(element, properties),
    temporaryWillChange(element, properties),
  ];
  let animation: AnimeAnimation;
  animation = startMotion(element, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "layout", animation, composeCleanups(cleanups));
}

function predictedTextHeight(element: HTMLElement, width: number): number | undefined {
  const text = element.textContent?.trim();
  if (!text || width <= 0) return;
  const computed = getComputedStyle(element);
  const font = computed.font;
  const lineHeight = Number.parseFloat(computed.lineHeight);
  if (!font || !Number.isFinite(lineHeight) || lineHeight <= 0) return;
  if (typeof document !== "undefined" && document.fonts) {
    if (!document.fonts.check(font, text)) return;
    if (!observesFonts) {
      observesFonts = true;
      document.fonts.addEventListener("loadingdone", () => preparedTextCache.clear());
    }
  }
  const horizontalPadding =
    Number.parseFloat(computed.paddingInlineStart) +
    Number.parseFloat(computed.paddingInlineEnd) +
    Number.parseFloat(computed.borderInlineStartWidth) +
    Number.parseFloat(computed.borderInlineEndWidth);
  const verticalPadding =
    Number.parseFloat(computed.paddingBlockStart) +
    Number.parseFloat(computed.paddingBlockEnd) +
    Number.parseFloat(computed.borderBlockStartWidth) +
    Number.parseFloat(computed.borderBlockEndWidth);
  const available = Math.max(1, width - finite(horizontalPadding, 0));
  const key = `${font}\u0000${text}`;
  try {
    let prepared = preparedTextCache.get(key);
    if (!prepared) {
      prepared = prepareText(text, font);
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
  clearVisualMotionPresentation(element);
  const properties = animeFrame(record(entrance.from), element, "enter");
  if (!Object.keys(properties).length) return;
  let animation: AnimeAnimation;
  const cleanup = composeCleanups([
    temporaryAnimatedStyles(element, properties),
    temporaryWillChange(element, properties),
  ]);
  animation = startMotion(element, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "enter", animation, cleanup);
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
  clearVisualMotionPresentation(element);
  const properties = animeFrame(record(exit.to), element, "exit");
  if (!Object.keys(properties).length) {
    finish();
    return;
  }
  const cleanup = composeCleanups([
    temporaryAnimatedStyles(element, properties),
    temporaryWillChange(element, properties),
    finish,
  ]);
  let animation: AnimeAnimation;
  animation = startMotion(element, properties, driver, () => {
    settle(element, animation);
  });
  own(element, "exit", animation, cleanup);
}

function temporaryWillChange(
  element: HTMLElement,
  properties: Readonly<Record<string, unknown>>,
): () => void {
  const previous = element.style.willChange;
  const names = new Set<string>();
  for (const name of Object.keys(properties)) {
    if (
      name === "transform" ||
      name === "x" ||
      name === "y" ||
      name.startsWith("scale") ||
      name === "rotate"
    ) {
      names.add("transform");
    } else if (name === "left" || name === "top" || name === "width" || name === "height") {
      names.add(name);
    } else if (name === "opacity" || name === "filter") {
      names.add(name);
    }
  }
  element.style.willChange = [...names].join(", ");
  return () => {
    element.style.willChange = previous;
  };
}

function temporaryAnimatedStyles(
  element: HTMLElement,
  properties: Readonly<Record<string, unknown>>,
): () => void {
  const names = new Set<"filter" | "height" | "left" | "opacity" | "top" | "transform" | "width">();
  for (const name of Object.keys(properties)) {
    if (
      name === "x" ||
      name === "y" ||
      name === "scale" ||
      name === "scaleX" ||
      name === "scaleY" ||
      name === "rotate" ||
      name === "transform"
    ) {
      names.add("transform");
    } else if (
      name === "filter" ||
      name === "height" ||
      name === "left" ||
      name === "opacity" ||
      name === "top" ||
      name === "width"
    ) {
      names.add(name);
    }
  }
  const previous = new Map([...names].map((name) => [name, element.style[name]] as const));
  return () => {
    for (const [name, value] of previous) element.style[name] = value;
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
): AnimeAnimation {
  const parameters = { ...properties, ...animeTiming(driver), onComplete };
  return selectVisualMotionBackend(driver) === "waapi"
    ? waapi.animate(element, parameters as WAAPIAnimationParams)
    : animate(element, parameters as AnimationParams);
}

function animeTiming(value: unknown): Record<string, unknown> {
  if (value === "none") return { duration: 0 };
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
      ease: physical.ease,
    };
  }
  const easing: Record<string, string> = {
    linear: "linear",
    smooth: "inOut(3)",
    accelerate: "in(3)",
    decelerate: "out(3)",
  };
  return {
    delay,
    duration: finite(driver.duration, 180),
    ease: easing[String(driver.easing)] ?? "out(3)",
  };
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
