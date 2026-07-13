import { props as stylexProps, type CompiledStyles, type StyleXStyles } from "@stylexjs/stylex";
import { animate, createAnimatable, createScope } from "animejs";
import {
  createAnimeMotionBackend,
  createAnimeLayoutBackend,
  createAdaptiveMotionBackend,
  createWaapiMotionBackend,
  resolveMotionBackend,
  RetainedLayoutGraph,
  RetainedMotionGraph,
  RetainedTransformComposer,
  type MotionTransition,
  type AnimeMotionController,
  type AnimeLayoutController,
  type TransformChannel,
} from "./visual-motion";
import { mountDrag, type DragOptions, type DragSample } from "./web-drag";

type RootLayoutAnimation = { pause(): unknown };
type RootLayoutAnimator = (properties: Readonly<Record<string, unknown>>) => RootLayoutAnimation;
const layoutTranslateInlineProperty = "--poggers-layout-translate-inline";
const layoutTranslateBlockProperty = "--poggers-layout-translate-block";

export function createRootLayoutController(
  root: HTMLElement,
  startAnimation: RootLayoutAnimator,
): AnimeLayoutController {
  type InlineStyles = {
    readonly width: string;
    readonly height: string;
    readonly translate: string;
    readonly overflow: string;
    readonly willChange: string;
    readonly translateInline: string;
    readonly translateBlock: string;
  };

  const customProperty = (name: string): string =>
    typeof root.style.getPropertyValue === "function"
      ? root.style.getPropertyValue(name)
      : ((root.style as unknown as Record<string, string>)[name] ?? "");
  const setCustomProperty = (name: string, value: string): void => {
    if (typeof root.style.setProperty === "function") root.style.setProperty(name, value);
    else (root.style as unknown as Record<string, string>)[name] = value;
  };
  const restoreCustomProperty = (name: string, value: string): void => {
    if (value) {
      setCustomProperty(name, value);
    } else if (typeof root.style.removeProperty === "function") {
      root.style.removeProperty(name);
    } else {
      delete (root.style as unknown as Record<string, string>)[name];
    }
  };

  let before = root.getBoundingClientRect();
  let baseline: InlineStyles | undefined;
  let animation: RootLayoutAnimation | undefined;
  let revision = 0;

  const captureStyles = (): InlineStyles => ({
    width: root.style.width,
    height: root.style.height,
    translate: root.style.translate,
    overflow: root.style.overflow,
    willChange: root.style.willChange,
    translateInline: customProperty(layoutTranslateInlineProperty),
    translateBlock: customProperty(layoutTranslateBlockProperty),
  });
  const restore = () => {
    if (!baseline) return;
    root.style.width = baseline.width;
    root.style.height = baseline.height;
    root.style.translate = baseline.translate;
    root.style.overflow = baseline.overflow;
    root.style.willChange = baseline.willChange;
    restoreCustomProperty(layoutTranslateInlineProperty, baseline.translateInline);
    restoreCustomProperty(layoutTranslateBlockProperty, baseline.translateBlock);
  };

  const controller: AnimeLayoutController = {
    children: [root],
    record() {
      const current = root.getBoundingClientRect();
      revision += 1;
      animation?.pause();
      animation = undefined;
      restore();
      baseline = captureStyles();
      before = current;
      if (before.width > 0 && before.height > 0) {
        root.style.width = `${before.width}px`;
        root.style.height = `${before.height}px`;
        root.style.overflow = "clip";
      }
      return controller;
    },
    animate(options = {}) {
      const currentRevision = ++revision;
      // Capture holds the old box so delayed reactive DOM writes cannot expose
      // the target geometry. Restore only long enough to measure the new
      // natural box, then install the inverse again in this same call.
      restore();
      const after = root.getBoundingClientRect();
      const movedInline = Math.abs(before.left - after.left) > 0.25;
      const movedBlock = Math.abs(before.top - after.top) > 0.25;
      const resizedInline = Math.abs(before.width - after.width) > 0.25;
      const resizedBlock = Math.abs(before.height - after.height) > 0.25;
      const invalidGeometry =
        before.width <= 0 || before.height <= 0 || after.width <= 0 || after.height <= 0;
      if (invalidGeometry || (!movedInline && !movedBlock && !resizedInline && !resizedBlock)) {
        restore();
        queueMicrotask(() => {
          if (revision === currentRevision) options.onComplete?.();
        });
        return { pause() {} } as never;
      }

      baseline ??= captureStyles();
      root.style.width = `${before.width}px`;
      root.style.height = `${before.height}px`;
      root.style.overflow = "clip";
      const canTranslate = !baseline.translate || baseline.translate === "none";
      // Sizing the element back to its recorded dimensions can itself restore
      // its old position (for example, a bottom-anchored sheet). Measure after
      // that inversion so translation compensates only the remaining movement.
      const inverted = root.getBoundingClientRect();
      const translateInline = before.left - inverted.left;
      const translateBlock = before.top - inverted.top;
      const needsTranslation = Math.abs(translateInline) > 0.25 || Math.abs(translateBlock) > 0.25;
      if (canTranslate && needsTranslation) {
        setCustomProperty(layoutTranslateInlineProperty, `${translateInline}px`);
        setCustomProperty(layoutTranslateBlockProperty, `${translateBlock}px`);
        root.style.translate = `var(${layoutTranslateInlineProperty}) var(${layoutTranslateBlockProperty})`;
      }

      animation = startAnimation({
        ...(resizedInline ? { width: after.width } : {}),
        ...(resizedBlock ? { height: after.height } : {}),
        ...(canTranslate && needsTranslation
          ? {
              [layoutTranslateInlineProperty]: "0px",
              [layoutTranslateBlockProperty]: "0px",
            }
          : {}),
        duration: options.duration,
        ease: options.ease,
        onComplete() {
          if (revision !== currentRevision) return;
          animation = undefined;
          restore();
          options.onComplete?.();
        },
      });
      return animation as never;
    },
    settle() {
      revision += 1;
      animation?.pause();
      animation = undefined;
      restore();
      baseline = undefined;
      before = root.getBoundingClientRect();
      return controller;
    },
    revert() {
      revision += 1;
      animation?.pause();
      animation = undefined;
      restore();
      return controller;
    },
  };
  return controller;
}

const hoverCoordinators = new WeakMap<
  Document,
  { readonly coordinator: TrackedHoverCoordinator; count: number }
>();

export function visualStyleAttributes(
  ...styles: Array<StyleXStyles | CompiledStyles | null | undefined>
): {
  readonly class?: string;
  readonly style?: Readonly<Record<string, unknown>>;
  readonly "data-style-src"?: string;
} {
  const result = stylexProps(...styles);
  return {
    ...(result.className ? { class: result.className } : {}),
    ...(result.style ? { style: result.style } : {}),
    ...(result["data-style-src"] ? { "data-style-src": result["data-style-src"] } : {}),
  };
}

export type TrackedHoverCoordinator = {
  register(element: HTMLElement, onChange?: (hovered: boolean) => void): () => void;
  invalidate(): void;
  dispose(): void;
};

export function registerVisualHover(
  element: HTMLElement,
  onChange?: (hovered: boolean) => void,
): () => void {
  const document = element.ownerDocument;
  let entry = hoverCoordinators.get(document);
  if (!entry) {
    entry = { coordinator: createTrackedHoverCoordinator(document), count: 0 };
    hoverCoordinators.set(document, entry);
  }
  entry.count += 1;
  const release = entry.coordinator.register(element, onChange);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (--entry.count > 0) return;
    entry.coordinator.dispose();
    hoverCoordinators.delete(document);
  };
}

export function createTrackedHoverCoordinator(
  document: Document,
  scheduleFrame: (callback: FrameRequestCallback) => number = (callback) =>
    requestAnimationFrame(callback),
  cancelFrame: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): TrackedHoverCoordinator {
  const registered = new Set<HTMLElement>();
  const subscribers = new Map<HTMLElement, Set<(hovered: boolean) => void>>();
  const hovered = new Set<HTMLElement>();
  let pointer: { inline: number; block: number } | undefined;
  let frame = 0;
  let disposed = false;

  const apply = () => {
    frame = 0;
    if (disposed) return;
    const next = new Set<HTMLElement>();
    const hit = pointer ? document.elementFromPoint(pointer.inline, pointer.block) : null;
    let current: Element | null = hit;
    while (current) {
      if (current instanceof HTMLElement && registered.has(current)) next.add(current);
      current = composedParent(current);
    }
    for (const element of hovered) {
      if (!next.has(element)) {
        element.removeAttribute("data-hovered");
        for (const notify of subscribers.get(element) ?? []) notify(false);
      }
    }
    for (const element of next) {
      if (!hovered.has(element)) {
        element.setAttribute("data-hovered", "true");
        for (const notify of subscribers.get(element) ?? []) notify(true);
      }
    }
    hovered.clear();
    for (const element of next) hovered.add(element);
  };
  const invalidate = () => {
    if (!disposed && !frame) frame = scheduleFrame(apply);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      pointer = undefined;
    } else {
      pointer = { inline: event.clientX, block: event.clientY };
    }
    invalidate();
  };
  const leave = () => {
    pointer = undefined;
    invalidate();
  };
  const scroll = () => invalidate();
  const view = document.defaultView;
  document.addEventListener("pointermove", move, { capture: true, passive: true });
  document.addEventListener("pointerdown", move, { capture: true, passive: true });
  document.addEventListener("pointerleave", leave, { capture: true, passive: true });
  document.addEventListener("scroll", scroll, { capture: true, passive: true });
  view?.addEventListener("resize", scroll, { passive: true });

  const ResizeObserverClass = view?.ResizeObserver;
  const resize = ResizeObserverClass ? new ResizeObserverClass(invalidate) : undefined;
  const MutationObserverClass = view?.MutationObserver;
  const mutation = MutationObserverClass
    ? new MutationObserverClass((records) => {
        if (
          records.some(
            (record) =>
              record.type === "childList" ||
              (record.type === "attributes" && record.attributeName !== "data-hovered"),
          )
        ) {
          invalidate();
        }
      })
    : undefined;
  mutation?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open"],
  });

  return {
    register(element, onChange) {
      if (disposed) return () => {};
      registered.add(element);
      if (onChange) {
        const listeners = subscribers.get(element) ?? new Set();
        listeners.add(onChange);
        subscribers.set(element, listeners);
      }
      resize?.observe(element);
      invalidate();
      return () => {
        registered.delete(element);
        if (onChange) {
          const listeners = subscribers.get(element);
          listeners?.delete(onChange);
          if (!listeners?.size) subscribers.delete(element);
        }
        resize?.unobserve(element);
        if (hovered.delete(element)) {
          element.removeAttribute("data-hovered");
          onChange?.(false);
        }
      };
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelFrame(frame);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", move, true);
      document.removeEventListener("pointerleave", leave, true);
      document.removeEventListener("scroll", scroll, true);
      view?.removeEventListener("resize", scroll);
      resize?.disconnect();
      mutation?.disconnect();
      for (const element of hovered) element.removeAttribute("data-hovered");
      hovered.clear();
      registered.clear();
      subscribers.clear();
    },
  };
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export type CompiledVisualEntry = {
  readonly style: StyleXStyles | CompiledStyles | ((...values: unknown[]) => StyleXStyles);
  readonly values: readonly {
    readonly name: string;
    readonly kind: string;
    readonly expression?: unknown;
  }[];
};

export type CompiledVisualPart = {
  readonly always: readonly CompiledVisualEntry[];
  readonly conditions: readonly {
    readonly when: {
      readonly all: readonly {
        readonly theme?: string;
        readonly expression?: unknown;
        readonly not?: true;
      }[];
    };
    readonly entry: CompiledVisualEntry;
  }[];
  readonly motion: unknown;
  readonly collection?: unknown;
};

export type CompiledVisualPreset = {
  readonly themes: Readonly<Record<string, StyleXStyles | CompiledStyles | null>>;
  readonly motion: Readonly<Record<string, unknown>>;
  readonly themeMotion: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly metrics?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly themeMetrics?: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>
  >;
  readonly components: Readonly<Record<string, Readonly<Record<string, CompiledVisualPart>>>>;
  readonly parameters: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly interactions: Readonly<Record<string, readonly unknown[]>>;
};

export type CompiledVisuals = Readonly<Record<string, CompiledVisualPreset>>;

export type VisualPartRuntimeContext = {
  readonly theme: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly interaction?: Readonly<Record<string, unknown>>;
  readonly geometry?: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, unknown>>;
  readonly motion?: Readonly<Record<string, number | undefined>>;
  readonly presence?: "entering" | "present" | "exiting";
};

export type VisualCoordinatorSnapshot = {
  readonly preset: string;
  readonly theme: string;
  readonly states: Readonly<Record<string, boolean>>;
  readonly values: Readonly<Record<string, unknown>>;
};

export type VisualCoordinator = {
  update(snapshot: VisualCoordinatorSnapshot): void;
  settle(phase: "enter" | "exit", state: string, signal: AbortSignal): Promise<void>;
  captureLayouts(): void;
  animateLayouts(): void;
  dispose(): void;
};

export function visualPartPresence(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
): { readonly lifecycle: string; readonly layout?: "preserve" | "pop" } | undefined {
  const presence = record(
    record(compiled[presetName]?.components[componentName]?.[partName]?.motion).presence,
  );
  if (!Object.keys(presence).length) return;
  const layout = presence.layout === "pop" ? "pop" : "preserve";
  return { lifecycle: "enter exit exit-finished", layout };
}

export type VisualMotionTarget = {
  readonly property:
    | "opacity"
    | "inline"
    | "block"
    | "depth"
    | "scale"
    | "scaleInline"
    | "scaleBlock"
    | "rotate";
  readonly value: number;
  readonly transition: unknown;
  readonly direct: boolean;
  readonly source?: string;
  readonly expression: unknown;
  readonly derivedFrom: readonly string[];
};

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
  for (const entry of part.always) styles.push(resolveEntry(entry, context));
  for (const conditional of part.conditions) {
    if (visualConditionMatches(conditional.when, context)) {
      styles.push(resolveEntry(conditional.entry, context));
    }
  }
  return visualStyleAttributes(...styles);
}

export function visualPartDependencies(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
): ReadonlySet<string> {
  const part = compiled[presetName]?.components[componentName]?.[partName];
  const dependencies = new Set<string>();
  if (!part) return dependencies;
  for (const entry of part.always) collectExpressionDependencies(entry.values, dependencies);
  for (const conditional of part.conditions) {
    collectExpressionDependencies(conditional.when, dependencies);
    collectExpressionDependencies(conditional.entry.values, dependencies);
  }
  collectExpressionDependencies(part.motion, dependencies);
  return dependencies;
}

export function visualPartMotionTargets(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
  context: VisualPartRuntimeContext,
): readonly VisualMotionTarget[] {
  const preset = compiled[presetName];
  const part = preset?.components[componentName]?.[partName];
  if (!preset || !part) return [];
  const motion = record(part.motion);
  const presence = record(motion.presence);
  const target = {
    ...record(motion.target),
    ...(context.presence === "entering"
      ? record(presence.enterFrom)
      : context.presence === "exiting"
        ? record(presence.exitTo)
        : {}),
  };
  const transition = record(motion.transition);
  const reduced = context.environment?.reducedMotion === true;
  const reduceMotion = motion.reduceMotion;
  return Object.entries(target).flatMap(([property, expression]) => {
    if (!motionTargetProperties.has(property)) return [];
    const motionExpression = record(expression);
    const source =
      motionExpression.operation === "motion" && typeof motionExpression.name === "string"
        ? motionExpression.name
        : undefined;
    const derivedFrom = source ? [] : motionExpressionSources(expression);
    const evaluated = evaluateVisualExpression(
      expression,
      context,
      preset,
      derivedFrom.length ? "rendered" : "target",
    );
    const value = typeof evaluated === "number" ? evaluated : Number(evaluated);
    if (!Number.isFinite(value)) return [];
    const domain = property === "opacity" ? "opacity" : "transform";
    const transitionExpression =
      motionExpression.operation === "motion" ? motionExpression.transition : transition[domain];
    const transitionReference = evaluateVisualExpression(
      transitionExpression,
      context,
      preset,
      "target",
    );
    const driver = motionDriver(preset, context.theme, transitionReference);
    const reducedDriver =
      reduced &&
      (reduceMotion === "instant" || (reduceMotion === "crossfade" && domain !== "opacity"))
        ? "none"
        : driver;
    return [
      {
        property: property as VisualMotionTarget["property"],
        value,
        transition: reducedDriver ?? "none",
        direct:
          transitionReference === "none" ||
          transitionReference === "instant" ||
          reducedDriver === "none" ||
          reducedDriver === "instant",
        ...(source ? { source } : {}),
        expression,
        derivedFrom,
      },
    ];
  });
}

function motionExpressionSources(value: unknown, sources = new Set<string>()): readonly string[] {
  if (!value || typeof value !== "object") return [...sources];
  if (Array.isArray(value)) {
    for (const child of value) motionExpressionSources(child, sources);
    return [...sources];
  }
  const expression = value as Record<string, unknown>;
  if (
    expression.source === "motion" &&
    expression.operation === "motion" &&
    typeof expression.name === "string"
  ) {
    sources.add(expression.name);
  }
  for (const child of Object.values(expression)) motionExpressionSources(child, sources);
  return [...sources].sort();
}

export function visualPartLayoutTransition(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
  context: VisualPartRuntimeContext,
): MotionTransition | undefined {
  const preset = compiled[presetName];
  const part = preset?.components[componentName]?.[partName];
  if (!preset || !part) return;
  const reference = record(part.motion).layout;
  if (reference == null) return;
  if (context.environment?.reducedMotion === true) return "instant";
  return retainedTransition(motionDriver(preset, context.theme, reference));
}

const motionTargetProperties = new Set([
  "opacity",
  "inline",
  "block",
  "depth",
  "scale",
  "scaleInline",
  "scaleBlock",
  "rotate",
]);

function collectExpressionDependencies(value: unknown, dependencies: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectExpressionDependencies(item, dependencies);
    return;
  }
  const source = value as Record<string, unknown>;
  if (source.$visual === "expression" && typeof source.source === "string") {
    const name = typeof source.name === "string" ? source.name : "value";
    dependencies.add(`${source.source}.${name}`);
  }
  for (const child of Object.values(source)) collectExpressionDependencies(child, dependencies);
}

export type VirtualCollectionGeometry = {
  readonly axis: "block" | "inline";
  readonly estimate: number;
  readonly gap: number;
  readonly lanes: number;
};

export function visualPartCollection(
  compiled: CompiledVisuals,
  presetName: string,
  componentName: string,
  partName: string,
  theme: string,
): VirtualCollectionGeometry | undefined {
  const preset = compiled[presetName];
  const source = record(preset?.components[componentName]?.[partName]?.collection);
  if (!preset || !Object.keys(source).length) return;
  return {
    axis: source.axis === "inline" ? "inline" : "block",
    estimate: Math.max(1, collectionMetric(preset, theme, source.estimate)),
    gap: Math.max(0, collectionMetric(preset, theme, source.gap)),
    lanes: Math.max(1, Math.floor(finite(source.lanes, 1))),
  };
}

export function isCompiledVisualPreset(compiled: CompiledVisuals | undefined, preset: string) {
  return Boolean(compiled?.[preset]);
}

type VisualAnimationScope = {
  execute<Value>(callback: () => Value): Value;
  revert(): unknown;
};

export function createVisualCoordinator(options: {
  readonly compiled: CompiledVisuals;
  readonly component: string;
  readonly refs: Readonly<Record<string, Element | null>>;
  readonly elements?: Readonly<Record<string, ReadonlySet<Element>>>;
  readonly suppressInitialEnter?: boolean;
  readonly onMotionChange?: (source: string, value: number) => void;
  readonly values?: Record<string, unknown>;
  readonly events?: Readonly<Record<string, (...args: any[]) => void>>;
  readonly onParametersChange?: (parameters: Readonly<Record<string, unknown>>) => void;
  readonly mountDrag?: typeof mountDrag;
}): VisualCoordinator {
  let snapshot: VisualCoordinatorSnapshot | undefined;
  let disposed = false;
  let scope: VisualAnimationScope | undefined;
  let observedGeometryRoot: HTMLElement | undefined;
  let geometryObserver: ResizeObserver | undefined;
  let presenceObserver: MutationObserver | undefined;
  let presenceRevision = 0;
  const interactionMounts = new Map<
    number,
    { readonly signature: string; readonly trigger: HTMLElement; readonly dispose: () => void }
  >();
  const motionValues = new Map<string, number>();
  const motionBindings = new Map<
    string,
    {
      readonly element: HTMLElement;
      readonly property: VisualMotionTarget["property"];
      readonly transform?: TransformChannel;
      readonly source?: string;
    }
  >();
  const transformComposers = new WeakMap<HTMLElement, RetainedTransformComposer>();
  const derivedMotionBindings = new Map<
    string,
    {
      readonly element: HTMLElement;
      readonly property: VisualMotionTarget["property"];
      readonly transform?: TransformChannel;
      readonly expression: unknown;
      readonly sources: readonly string[];
    }
  >();
  const renderMotionValue = (
    binding: {
      readonly element: HTMLElement;
      readonly property: VisualMotionTarget["property"];
      readonly transform?: TransformChannel;
    },
    value: number,
  ) => {
    if (binding.property === "opacity") {
      binding.element.style.opacity = String(normalizeRenderedMotionValue("opacity", value));
      return;
    }
    const composer = transformComposers.get(binding.element) ?? new RetainedTransformComposer();
    transformComposers.set(binding.element, composer);
    binding.element.style.transform = composer.set(binding.transform!, value);
  };
  const elementIdentities = new WeakMap<Element, number>();
  let nextElementIdentity = 0;
  const identityFor = (element: Element) => {
    let identity = elementIdentities.get(element);
    if (identity === undefined) {
      identity = nextElementIdentity++;
      elementIdentities.set(element, identity);
    }
    return identity;
  };
  let motionKeys = new Set<string>();
  const motionStates = new Map<string, string>();
  const motionSettlementByKey = new Map<string, Promise<unknown>>();
  let motionSettlements: readonly Promise<unknown>[] = [];
  const renderRetainedMotion = (key: string, value: number) => {
    const binding = motionBindings.get(key);
    if (!binding || !binding.element.isConnected) return;
    if (binding.source) {
      motionValues.set(binding.source, value);
      options.onMotionChange?.(binding.source, value);
    }
    renderMotionValue(binding, value);
    if (!binding.source) return;
    const preset = snapshot ? options.compiled[snapshot.preset] : undefined;
    if (!preset) return;
    for (const derived of derivedMotionBindings.values()) {
      if (!derived.sources.includes(binding.source) || !derived.element.isConnected) continue;
      const next = Number(
        evaluateVisualExpression(
          derived.expression,
          runtimeContext(derived.element),
          preset,
          "rendered",
        ),
      );
      if (Number.isFinite(next)) renderMotionValue(derived, next);
    }
  };
  const animeMotionBackend = createAnimeMotionBackend(
    { render: renderRetainedMotion },
    (model, callbacks) =>
      animationScope().execute(
        () =>
          createAnimatable(model, {
            value: model.value,
            onUpdate: callbacks.onUpdate,
            onComplete: callbacks.onComplete,
          }) as unknown as AnimeMotionController,
      ),
  );
  const waapiMotionBackend = createWaapiMotionBackend({
    render: renderRetainedMotion,
    target(key) {
      const binding = motionBindings.get(key);
      return binding?.property === "opacity"
        ? { element: binding.element, property: "opacity" }
        : undefined;
    },
  });
  const motionGraph = new RetainedMotionGraph(
    createAdaptiveMotionBackend({
      anime: animeMotionBackend,
      waapi: waapiMotionBackend,
      decide(key, transition) {
        const binding = motionBindings.get(key);
        return resolveMotionBackend({
          property: binding?.property ?? "unknown",
          transition,
          continuous: false,
          continuity:
            transition !== "instant" && Object.keys(record(transition.spring)).length
              ? "preserve"
              : "replace",
          layout: false,
          snapshotSafe: false,
          liveContent: true,
          waapi: typeof Element !== "undefined" && "animate" in Element.prototype,
          viewTransition: false,
        });
      },
    }),
  );
  const layoutGraph = new RetainedLayoutGraph(
    createAnimeLayoutBackend((root) =>
      createRootLayoutController(root, (properties) =>
        animationScope().execute(
          () => animate(root, properties as Parameters<typeof animate>[1]) as never,
        ),
      ),
    ),
  );
  const layoutBindings = new Map<
    string,
    {
      readonly root: HTMLElement;
      transition: MotionTransition;
    }
  >();
  let layoutKeys = new Set<string>();
  const layoutSettlementByKey = new Map<string, Promise<unknown>>();
  let layoutSettlements: readonly Promise<unknown>[] = [];
  let layoutObserver: MutationObserver | undefined;
  let layoutTransaction = 0;
  let projectedLayoutTransaction = 0;
  const snapshotWaiters = new Set<(disposed: boolean) => void>();
  const installDrag = options.mountDrag ?? mountDrag;
  const elementsFor = (part: string): readonly Element[] => {
    const elements = options.elements?.[part];
    if (elements) return [...elements].filter((element) => element.isConnected);
    const element = options.refs[part];
    return element?.isConnected ? [element] : [];
  };

  const animationScope = () => {
    if (scope) return scope;
    const root =
      (elementsFor("Root")[0] as HTMLElement | undefined) ??
      commonAncestor(Object.values(options.elements ?? {}).flatMap((elements) => [...elements])) ??
      document.documentElement;
    scope = createScope({ root });
    return scope;
  };

  const runtimeContext = (element?: HTMLElement): VisualPartRuntimeContext => {
    const current = snapshot;
    const root = elementsFor("Root")[0];
    const rectangle =
      root instanceof HTMLElement && typeof root.getBoundingClientRect === "function"
        ? root.getBoundingClientRect()
        : undefined;
    return {
      theme: current?.theme ?? "default",
      values: current?.values ?? {},
      geometry: {
        inlineSize: rectangle?.width ?? 0,
        blockSize: rectangle?.height ?? 0,
      },
      environment: visualEnvironment(),
      motion: Object.fromEntries(motionValues),
      presence:
        element?.getAttribute("data-motion-state") === "entering"
          ? "entering"
          : element?.getAttribute("data-motion-state") === "exiting"
            ? "exiting"
            : "present",
    };
  };

  const resolvePresetContract = () => {
    const current = snapshot;
    if (!current || disposed) return;
    const preset = options.compiled[current.preset];
    if (!preset) return;
    const context = runtimeContext();
    const resolvedParameters = Object.fromEntries(
      Object.entries(preset.parameters?.[options.component] ?? {}).map(([name, value]) => [
        name,
        evaluateVisualExpression(value, context, preset, "rendered"),
      ]),
    );
    options.onParametersChange?.(resolvedParameters);

    const interactions = preset.interactions?.[options.component] ?? [];
    const next = new Set<number>();
    interactions.forEach((rawInteraction, index) => {
      const interaction = record(rawInteraction);
      if (interaction.type !== "drag") return;
      const enabled =
        interaction.enabled === undefined ||
        Boolean(evaluateVisualExpression(interaction.enabled, context, preset, "rendered"));
      if (!enabled) return;
      const triggerName = visualReferenceName(interaction.trigger, "part");
      const trigger = triggerName ? elementsFor(triggerName)[0] : undefined;
      if (!(trigger instanceof HTMLElement)) return;
      const dragBounds = record(interaction.bounds);
      const configuration = {
        axis:
          interaction.axis === "inline" || interaction.axis === "both" ? interaction.axis : "block",
        threshold: visualNumber(interaction.threshold, context, preset, 3),
        maxVelocity: visualNumber(interaction.maxVelocity, context, preset, 3),
        resistance: visualNumber(interaction.resistance, context, preset, 1),
        cursor: interaction.cursor,
        start: visualReferenceName(interaction.start, "event"),
        release: visualReferenceName(interaction.release, "event"),
        cancel: visualReferenceName(interaction.cancel, "event"),
        output: Object.fromEntries(
          Object.entries(record(interaction.output)).map(([sample, reference]) => [
            sample,
            visualValueName(reference),
          ]),
        ),
      };
      const signature = JSON.stringify([current.preset, triggerName, configuration]);
      const mounted = interactionMounts.get(index);
      if (mounted?.signature === signature && mounted.trigger === trigger) {
        next.add(index);
        return;
      }
      mounted?.dispose();
      const write = (sample: DragSample) => {
        for (const [sampleName, valueName] of Object.entries(configuration.output)) {
          if (!valueName || !(sampleName in sample) || !options.values) continue;
          options.values[valueName] = sample[sampleName as keyof DragSample];
        }
      };
      const event = (name: string | undefined, ...args: unknown[]) => {
        if (name) options.events?.[name]?.(...args);
      };
      const dragOptions: DragOptions = {
        axis: configuration.axis,
        bounds: () => {
          const live = runtimeContext(trigger);
          const range = (value: unknown): readonly [number, number] | undefined => {
            if (!Array.isArray(value) || value.length !== 2) return;
            return [
              visualNumber(value[0], live, preset, 0),
              visualNumber(value[1], live, preset, 0),
            ];
          };
          return {
            ...(range(dragBounds.inline) ? { inline: range(dragBounds.inline) } : {}),
            ...(range(dragBounds.block) ? { block: range(dragBounds.block) } : {}),
          };
        },
        threshold: configuration.threshold,
        maxVelocity: configuration.maxVelocity,
        resistance: configuration.resistance,
        cursor:
          configuration.cursor === false
            ? false
            : typeof configuration.cursor === "object" && configuration.cursor
              ? (configuration.cursor as { readonly idle: string; readonly active: string })
              : undefined,
        start: () => event(configuration.start),
        change: write,
        release(sample) {
          write(sample);
          event(configuration.release, sample);
        },
        cancel: () => event(configuration.cancel),
      };
      interactionMounts.set(index, {
        signature,
        trigger,
        dispose: installDrag(trigger, dragOptions),
      });
      next.add(index);
    });
    for (const [index, mounted] of interactionMounts) {
      if (next.has(index)) continue;
      mounted.dispose();
      interactionMounts.delete(index);
    }
  };

  const layoutChildren = (root: HTMLElement): readonly HTMLElement[] =>
    [...root.children].filter((element): element is HTMLElement => element instanceof HTMLElement);

  const projectLayout = (key: string) => {
    const binding = layoutBindings.get(key);
    if (!binding || disposed || !binding.root.isConnected) return;
    const settlement = layoutGraph.project(key, layoutChildren(binding.root), binding.transition);
    layoutSettlementByKey.set(key, settlement);
    layoutSettlements = [...layoutSettlementByKey.values()];
  };

  const handleLayoutMutations = (mutations: readonly MutationRecord[]) => {
    const affected = new Set<string>();
    for (const mutation of mutations) {
      for (const [key, binding] of layoutBindings) {
        if (binding.root === mutation.target || binding.root.contains(mutation.target)) {
          affected.add(key);
        }
      }
    }
    for (const key of affected) projectLayout(key);
    if (affected.size) {
      // Mutation observers run after reactive DOM writes and before paint,
      // which is the exact point where FLIP inversion must be installed.
      layoutGraph.flush();
      projectedLayoutTransaction = layoutTransaction;
    }
  };

  const reconcileLayouts = () => {
    const current = snapshot;
    if (!current || disposed) return;
    const preset = options.compiled[current.preset];
    if (!preset) return;
    const context = runtimeContext();
    const nextKeys = new Set<string>();
    for (const partName of Object.keys(preset.components[options.component] ?? {})) {
      const transition = visualPartLayoutTransition(
        options.compiled,
        current.preset,
        options.component,
        partName,
        context,
      );
      if (!transition) continue;
      for (const root of elementsFor(partName)) {
        if (!(root instanceof HTMLElement)) continue;
        const key = `${options.component}:${partName}:${identityFor(root)}`;
        nextKeys.add(key);
        layoutGraph.register(key, `${options.component}:${partName}`, root, layoutChildren(root));
        layoutBindings.set(key, { root, transition });
      }
    }
    for (const key of layoutKeys) {
      if (nextKeys.has(key)) continue;
      layoutGraph.release(key);
      layoutBindings.delete(key);
      layoutSettlementByKey.delete(key);
    }
    layoutKeys = nextKeys;
    layoutObserver?.disconnect();
    const root = elementsFor("Root")[0];
    const Observer = root?.ownerDocument?.defaultView?.MutationObserver;
    if (!layoutObserver && Observer) layoutObserver = new Observer(handleLayoutMutations);
    for (const { root: layoutRoot } of layoutBindings.values()) {
      layoutObserver?.observe(layoutRoot, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "hidden"],
      });
    }
  };

  const reconcileMotionTargets = () => {
    const current = snapshot;
    if (!current || disposed) return;
    const preset = options.compiled[current.preset];
    if (!preset) return;
    const nextKeys = new Set<string>();
    const nextDerivedKeys = new Set<string>();
    const settlements: Promise<unknown>[] = [];
    for (const part of Object.keys(preset.components[options.component] ?? {})) {
      for (const element of elementsFor(part)) {
        if (!(element instanceof HTMLElement)) continue;
        const context = runtimeContext(element);
        const targets = visualPartMotionTargets(
          options.compiled,
          current.preset,
          options.component,
          part,
          context,
        );
        if (!targets.length) continue;
        const identity = identityFor(element);
        for (const target of targets) {
          for (const translated of translatedMotionTargets(target)) {
            if (target.derivedFrom.length) {
              const derivedKey = `${options.component}/${part}:${identity}/${translated.property}:derived`;
              nextDerivedKeys.add(derivedKey);
              const derived = {
                element,
                property: target.property,
                ...(translated.transform ? { transform: translated.transform } : {}),
                expression: target.expression,
                sources: target.derivedFrom,
              };
              derivedMotionBindings.set(derivedKey, derived);
              renderMotionValue(derived, translated.value);
              continue;
            }
            const key = target.source
              ? `${options.component}/motion:${target.source}/${translated.property}`
              : `${options.component}/${part}:${identity}/${translated.property}`;
            nextKeys.add(key);
            const currentBinding = motionBindings.get(key);
            if (currentBinding && currentBinding.element !== element) {
              throw new Error(
                `Motion source ${JSON.stringify(target.source)} must own one retained target per component instance.`,
              );
            }
            motionBindings.set(key, {
              element,
              property: target.property,
              ...(translated.transform ? { transform: translated.transform } : {}),
              ...(target.source ? { source: target.source } : {}),
            });
            const existing = motionKeys.has(key);
            const channel = motionGraph.channel(key, key, translated.value);
            const transition = retainedTransition(target.transition);
            const state = JSON.stringify([target.direct, translated.value, transition]);
            if (!existing) {
              motionStates.set(key, state);
              continue;
            }
            if (motionStates.get(key) === state) {
              const active = motionSettlementByKey.get(key);
              if (active) settlements.push(active);
              continue;
            }
            motionStates.set(key, state);
            if (target.direct) {
              channel.direct(translated.value);
              motionSettlementByKey.delete(key);
              continue;
            }
            const settlement = channel.target(
              translated.value,
              transition,
              motionVelocityForTarget(target, context, preset),
            );
            motionSettlementByKey.set(key, settlement);
            settlements.push(settlement);
            void settlement.finally(() => {
              if (motionSettlementByKey.get(key) === settlement) {
                motionSettlementByKey.delete(key);
              }
            });
          }
        }
      }
    }
    for (const [key, binding] of derivedMotionBindings) {
      if (nextDerivedKeys.has(key)) continue;
      clearMotionBinding(binding, transformComposers);
      derivedMotionBindings.delete(key);
    }
    for (const key of motionKeys) {
      if (nextKeys.has(key)) continue;
      clearMotionBinding(motionBindings.get(key), transformComposers);
      motionBindings.delete(key);
      motionStates.delete(key);
      motionSettlementByKey.delete(key);
      motionGraph.release(key);
    }
    motionKeys = nextKeys;
    motionSettlements = settlements;
    const currentPresenceRevision = ++presenceRevision;
    if (settlements.length) {
      void Promise.allSettled(settlements).then(() => {
        if (disposed || currentPresenceRevision !== presenceRevision) return;
        for (const elements of Object.values(options.elements ?? {})) {
          for (const element of elements) {
            if (
              element instanceof HTMLElement &&
              element.getAttribute("data-motion-state") === "exiting"
            ) {
              element.dispatchEvent(new Event("poggersmotionfinish"));
            }
          }
        }
      });
    }
  };

  const settle = async (phase: "enter" | "exit", state: string, signal: AbortSignal) => {
    if (disposed || signal.aborted) throw signal.reason;
    await waitForStateSnapshot(state, signal);
    motionGraph.flush();
    layoutGraph.flush();
    await abortableSettlement(Promise.all([...motionSettlements, ...layoutSettlements]), signal);
  };

  const waitForStateSnapshot = (state: string, signal: AbortSignal): Promise<void> => {
    if (snapshot?.states[state] === true) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = (coordinatorDisposed: boolean) => {
        if (coordinatorDisposed) {
          cleanup();
          reject(new DOMException("Visual coordinator disposed", "AbortError"));
          return;
        }
        if (snapshot?.states[state] !== true) return;
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException("Settlement aborted", "AbortError"));
      };
      const cleanup = () => {
        snapshotWaiters.delete(check);
        signal.removeEventListener("abort", abort);
      };
      snapshotWaiters.add(check);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  };

  const observeGeometry = () => {
    const root = elementsFor("Root")[0];
    if (!(root instanceof HTMLElement) || root === observedGeometryRoot) return;
    geometryObserver?.disconnect();
    observedGeometryRoot = root;
    const ResizeObserverClass = root.ownerDocument?.defaultView?.ResizeObserver;
    geometryObserver = ResizeObserverClass
      ? new ResizeObserverClass(() => {
          resolvePresetContract();
          reconcileMotionTargets();
        })
      : undefined;
    geometryObserver?.observe(root);
  };

  const observePresence = () => {
    const root = elementsFor("Root")[0];
    if (!(root instanceof HTMLElement) || presenceObserver) return;
    const Observer = root.ownerDocument?.defaultView?.MutationObserver;
    if (!Observer) return;
    presenceObserver = new Observer((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-motion-state")) {
        reconcileMotionTargets();
      }
    });
    presenceObserver.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-motion-state"],
    });
  };

  return {
    update(next) {
      snapshot = next;
      for (const check of snapshotWaiters) check(false);
      observeGeometry();
      observePresence();
      resolvePresetContract();
      reconcileMotionTargets();
      reconcileLayouts();
    },
    settle,
    captureLayouts() {
      if (disposed) return;
      layoutTransaction += 1;
      layoutGraph.capture();
    },
    animateLayouts() {
      if (disposed) return;
      const transaction = layoutTransaction;
      const animate = () => {
        if (disposed) return;
        if (projectedLayoutTransaction === transaction) return;
        for (const key of layoutKeys) projectLayout(key);
        layoutGraph.flush();
        projectedLayoutTransaction = transaction;
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(animate);
      else setTimeout(animate, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const check of snapshotWaiters) check(true);
      snapshotWaiters.clear();
      geometryObserver?.disconnect();
      geometryObserver = undefined;
      observedGeometryRoot = undefined;
      presenceObserver?.disconnect();
      presenceObserver = undefined;
      for (const mounted of interactionMounts.values()) mounted.dispose();
      interactionMounts.clear();
      motionGraph.dispose();
      layoutObserver?.disconnect();
      layoutObserver = undefined;
      layoutGraph.dispose();
      layoutBindings.clear();
      layoutKeys.clear();
      layoutSettlementByKey.clear();
      layoutSettlements = [];
      for (const binding of motionBindings.values()) {
        clearMotionBinding(binding, transformComposers);
      }
      for (const binding of derivedMotionBindings.values()) {
        clearMotionBinding(binding, transformComposers);
      }
      motionBindings.clear();
      derivedMotionBindings.clear();
      motionValues.clear();
      motionKeys.clear();
      motionStates.clear();
      motionSettlementByKey.clear();
      motionSettlements = [];
      scope?.revert();
      scope = undefined;
    },
  };
}

function visualReferenceName(value: unknown, kind: "event" | "part"): string | undefined {
  const reference = record(value);
  return reference.$visual === kind && typeof reference.name === "string"
    ? reference.name
    : undefined;
}

function visualValueName(value: unknown): string | undefined {
  const reference = record(value);
  return reference.$visual === "expression" &&
    reference.source === "value" &&
    typeof reference.name === "string"
    ? reference.name
    : undefined;
}

function visualNumber(
  value: unknown,
  context: VisualPartRuntimeContext,
  preset: CompiledVisualPreset,
  fallback: number,
): number {
  const resolved = Number(evaluateVisualExpression(value, context, preset, "rendered"));
  return Number.isFinite(resolved) ? resolved : fallback;
}

function translatedMotionTargets(target: VisualMotionTarget): readonly {
  readonly property: string;
  readonly value: number;
  readonly transform?: TransformChannel;
}[] {
  if (target.property === "opacity") return [{ property: "opacity", value: target.value }];
  if (target.property === "inline") {
    return [{ property: "translateX", value: target.value, transform: "translateX" }];
  }
  if (target.property === "block") {
    return [{ property: "translateY", value: target.value, transform: "translateY" }];
  }
  if (target.property === "depth") {
    return [{ property: "translateZ", value: target.value, transform: "translateZ" }];
  }
  if (target.property === "rotate") {
    return [{ property: "rotateZ", value: target.value, transform: "rotateZ" }];
  }
  if (target.property === "scaleInline") {
    return [{ property: "scaleX", value: target.value, transform: "scaleX" }];
  }
  if (target.property === "scaleBlock") {
    return [{ property: "scaleY", value: target.value, transform: "scaleY" }];
  }
  return [
    { property: "scaleX", value: target.value, transform: "scaleX" },
    { property: "scaleY", value: target.value, transform: "scaleY" },
  ];
}

function retainedTransition(value: unknown): MotionTransition {
  return value === "none" || value == null ? "instant" : record(value);
}

export function normalizeRenderedMotionValue(
  property: VisualMotionTarget["property"],
  value: number,
): number {
  if (property !== "opacity") return value;
  const clamped = Math.max(0, Math.min(1, value));
  const visibleStep = 1 / 255;
  if (clamped <= visibleStep) return 0;
  if (clamped >= 1 - visibleStep) return 1;
  return clamped;
}

function motionVelocityForTarget(
  target: VisualMotionTarget,
  context: VisualPartRuntimeContext,
  preset: CompiledVisualPreset,
): { readonly velocity?: number } | undefined {
  if (target.property !== "inline" && target.property !== "block") return;
  const authored = evaluateVisualExpression(
    record(target.expression).velocity,
    context,
    preset,
    "target",
  );
  if (typeof authored === "number" && Number.isFinite(authored)) {
    return { velocity: authored };
  }
}

function clearMotionBinding(
  binding:
    | {
        readonly element: HTMLElement;
        readonly property: VisualMotionTarget["property"];
        readonly transform?: TransformChannel;
      }
    | undefined,
  composers: WeakMap<HTMLElement, RetainedTransformComposer>,
): void {
  if (!binding) return;
  if (binding.property === "opacity") {
    binding.element.style.removeProperty("opacity");
    return;
  }
  const composer = composers.get(binding.element);
  if (binding.transform) composer?.delete(binding.transform);
  binding.element.style.removeProperty("translate");
  binding.element.style.removeProperty("scale");
  binding.element.style.removeProperty("rotate");
  if (composer) binding.element.style.transform = composer.value();
  else binding.element.style.removeProperty("transform");
}

export function layoutStateProperties(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const opacity = values.opacity;
  if (typeof opacity === "number" && Number.isFinite(opacity)) result.opacity = opacity;
  const transform: string[] = [];
  const x = finiteOrUndefined(values.x);
  const y = finiteOrUndefined(values.y);
  const scale = finiteOrUndefined(values.scale);
  const rotate = finiteOrUndefined(values.rotate);
  if (x !== undefined) transform.push(`translateX(${x}px)`);
  if (y !== undefined) transform.push(`translateY(${y}px)`);
  if (scale !== undefined) transform.push(`scale(${scale})`);
  if (rotate !== undefined) transform.push(`rotate(${rotate}deg)`);
  if (transform.length) result.transform = transform.join(" ");
  return result;
}

function motionDriver(preset: CompiledVisualPreset, theme: string, reference: unknown): unknown {
  const name = record(reference).name;
  if (typeof name !== "string") return;
  return preset.themeMotion[theme]?.[name] ?? preset.motion[name];
}

function collectionMetric(preset: CompiledVisualPreset, theme: string, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const reference = record(value);
  const group = typeof reference.group === "string" ? reference.group : undefined;
  const name = typeof reference.name === "string" ? reference.name : undefined;
  if (reference.$visual !== "token" || !group || !name) return 0;
  return finite(
    preset.themeMetrics?.[theme]?.[group]?.[name],
    finite(preset.metrics?.[group]?.[name], 0),
  );
}

function resolveEntry(
  entry: CompiledVisualEntry,
  context: VisualPartRuntimeContext,
): StyleXStyles | CompiledStyles {
  if (typeof entry.style !== "function") return entry.style;
  return entry.style(
    ...entry.values.map(({ name, kind, expression }) =>
      visualValue(
        expression == null ? context.values[name] : evaluateVisualExpression(expression, context),
        kind,
      ),
    ),
  ) as StyleXStyles;
}

function evaluateVisualExpression(
  value: unknown,
  context: VisualPartRuntimeContext,
  preset?: CompiledVisualPreset,
  mode: "rendered" | "target" = "rendered",
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const expression = value as Record<string, unknown>;
  if (expression.$visual === "token" && preset) {
    if (expression.group === "motion") return value;
    return collectionMetric(preset, context.theme, expression);
  }
  if (expression.$visual !== "expression") return value;
  if (
    expression.source === "motion" &&
    expression.operation === "motion" &&
    typeof expression.name === "string"
  ) {
    if (mode === "target") {
      return evaluateVisualExpression(expression.target, context, preset, "target");
    }
    const rendered = context.motion?.[expression.name];
    return typeof rendered === "number" && Number.isFinite(rendered)
      ? rendered
      : evaluateVisualExpression(expression.target, context, preset, "target");
  }
  if (expression.source === "value" && typeof expression.name === "string") {
    return context.values[expression.name];
  }
  if (expression.source === "interaction" && typeof expression.name === "string") {
    return context.interaction?.[expression.name];
  }
  if (expression.source === "geometry" && typeof expression.name === "string") {
    return context.geometry?.[expression.name];
  }
  if (expression.source === "environment" && typeof expression.name === "string") {
    return context.environment?.[expression.name];
  }
  const operation = expression.operation;
  if (operation === "not") {
    return !evaluateVisualExpression(expression.value, context, preset, mode);
  }
  if (operation === "and" || operation === "or") {
    const values = Array.isArray(expression.values) ? expression.values : [];
    return operation === "and"
      ? values.every((item) => Boolean(evaluateVisualExpression(item, context, preset, mode)))
      : values.some((item) => Boolean(evaluateVisualExpression(item, context, preset, mode)));
  }
  if (operation === "choose") {
    return evaluateVisualExpression(expression.condition, context, preset, mode)
      ? evaluateVisualExpression(expression.truthy, context, preset, mode)
      : evaluateVisualExpression(expression.falsy, context, preset, mode);
  }
  if (operation === "interpolate") {
    const current = Number(evaluateVisualExpression(expression.value, context, preset, mode));
    const input = numberList(expression.input);
    const output = numberList(expression.output);
    return interpolateValue(current, input, output);
  }
  if (operation === "motion-progress") {
    const current = Number(evaluateVisualExpression(expression.motion, context, preset, mode));
    const range = numberList(expression.range);
    if (!Number.isFinite(current) || range.length !== 2 || range[0] === range[1]) return 0;
    return Math.max(0, Math.min(1, (current - range[0]!) / (range[1]! - range[0]!)));
  }
  if (["equal", "above", "at-least", "below", "at-most"].includes(String(operation))) {
    const left = evaluateVisualExpression(expression.left, context, preset, mode);
    const right = evaluateVisualExpression(expression.right, context, preset, mode);
    if (operation === "equal") return Object.is(left, right);
    const a = Number(left);
    const b = Number(right);
    if (operation === "above") return a > b;
    if (operation === "at-least") return a >= b;
    if (operation === "below") return a < b;
    return a <= b;
  }
  return;
}

function interpolateValue(
  value: number,
  input: readonly number[],
  output: readonly number[],
): number {
  if (!Number.isFinite(value) || input.length < 2 || input.length !== output.length) return 0;
  let index = 0;
  while (index < input.length - 2 && value > input[index + 1]!) index += 1;
  const from = input[index]!;
  const to = input[index + 1]!;
  const progress = to === from ? 0 : (value - from) / (to - from);
  return output[index]! + (output[index + 1]! - output[index]!) * progress;
}

function numberList(value: unknown): readonly number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function visualValue(value: unknown, kind: string): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  if ((kind === "opacity" || kind === "progress") && (value < 0 || value > 1)) {
    throw new Error("Visual " + kind + " values must be between 0 and 1.");
  }
  if ((kind === "time" || kind === "ratio") && value < 0) {
    throw new Error("Visual " + kind + " values must not be negative.");
  }
  if (kind === "length") return value === 0 ? 0 : String(value) + "px";
  if (kind === "angle") return value === 0 ? 0 : String(value) + "deg";
  if (kind === "time") return value === 0 ? 0 : String(value) + "ms";
  return value;
}

export function visualConditionMatches(
  condition: CompiledVisualPart["conditions"][number]["when"],
  context: VisualPartRuntimeContext,
): boolean {
  return condition.all.every((predicate) => {
    const matches =
      (predicate.theme == null || context.theme === predicate.theme) &&
      (predicate.expression == null ||
        Boolean(evaluateVisualExpression(predicate.expression, context)));
    return predicate.not ? !matches : matches;
  });
}

function commonAncestor(elements: readonly Element[]): HTMLElement | undefined {
  const connected = elements.filter((element) => element.isConnected);
  let candidate = connected[0]?.parentElement;
  while (candidate) {
    if (connected.every((element) => candidate === element || candidate!.contains(element))) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return;
}

function abortableSettlement(settlement: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Settlement aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void settlement.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function visualEnvironment(): Readonly<Record<string, boolean>> {
  const matches = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
  return {
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
    moreContrast: matches("(prefers-contrast: more)"),
    forcedColors: matches("(forced-colors: active)"),
    dark: matches("(prefers-color-scheme: dark)"),
    hover: matches("(hover: hover)"),
    finePointer: matches("(pointer: fine)"),
    coarsePointer: matches("(pointer: coarse)"),
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
