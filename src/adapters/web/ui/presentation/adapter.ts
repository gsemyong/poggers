import { readPresentationPresence, setPresentationPresence } from "@/adapters/web/ui/presence";
import {
  planWebPresentationArtifacts,
  webResetCss,
  type CompiledWebStyle,
  type WebPresentationArtifactPlan,
} from "@/adapters/web/ui/presentation/compiler";
import {
  createNativeWebFrameHost,
  createWebAnimationHost,
  type WebAnimationHost,
  type WebAnimationHostSnapshot,
  type WebAnimationInspection,
  type WebFrameHost,
} from "@/adapters/web/ui/presentation/runtime/animation";
import {
  planAdaptiveWebExecution,
  startWebNativeExecution,
  type WebExecutionPlan,
  type WebExecutionSample,
  type WebNativeAnimationFactory,
  type WebNativeExecution,
  type WebNativeExecutionPlan,
} from "@/adapters/web/ui/presentation/runtime/execution";
import {
  createWebLayoutHost,
  type WebLayoutHost,
} from "@/adapters/web/ui/presentation/runtime/layout";
import {
  createWebElementObservationHost,
  createWebEnvironmentHost,
  type WebElementSnapshot,
} from "@/adapters/web/ui/presentation/runtime/observations";
import type {
  PresentationAdapter,
  PresentationAdapterInstance,
  PresentationAdapterSession,
  PresentationElementResolver,
} from "@/contracts/platform";
import { evaluatePresentationFrame, isPresentationTemporalValue } from "@/core/ui/presentation";
import type {
  WebAudioAsset,
  WebElementPresentation,
  WebFeedback,
  WebImageAsset,
  WebLayoutContinuity,
  WebPresentationLanguage,
} from "@/platforms/web/presentation";
import { createPresentationFrame, type PresentationFrame } from "@/runtime/presentation";

export type WebPresentationHotSnapshot = Readonly<{
  shared: readonly WebAnimationHostSnapshot[];
  sessions: Readonly<Record<string, readonly WebAnimationHostSnapshot[]>>;
}>;

export type WebStyleHost = {
  replace(css: string): void;
  dispose(): void;
};

export type WebPresentationAdapterOptions = Readonly<{
  createStyleHost?: (boundary: Element) => WebStyleHost;
  createImageHost?: (boundary: Element) => WebImageHost;
  createFeedbackHost?: (boundary: Element) => WebFeedbackHost;
  /** @internal Injectable native animation boundary for conformance and host specialization. */
  createNativeAnimation?: WebNativeAnimationFactory;
}>;

export type WebImageHost = {
  set(target: Element, image: WebImageAsset | undefined): void;
  dispose(): void;
};

export type WebFeedbackHost = {
  set(target: Element, feedback: WebFeedback | undefined): void;
  dispose(): void;
};

export type WebPresentationFrameElement = Readonly<{
  target: Element;
  className: string;
  properties: Readonly<Record<string, string>>;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  presence?: WebElementPresentation["presence"];
}>;

export type WebPresentationFrameInspection<ElementName extends string> = Readonly<{
  time: number;
  frame: PresentationFrame;
  dynamic: boolean;
  behavior?: Readonly<{ state: Readonly<object>; props?: Readonly<object> }>;
  observations: Readonly<Record<ElementName, WebElementSnapshot>>;
  animations: WebAnimationInspection;
  scopes: readonly WebAnimationInspection[];
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>;
  artifacts: WebPresentationArtifactPlan<ElementName>;
  elements: Readonly<Record<ElementName, readonly WebPresentationFrameElement[]>>;
  execution: Readonly<{
    kind: "canonical" | "native";
    mode?: "off-thread" | "hybrid";
    reason?: string;
    duration?: number;
    samples?: number;
    effects?: readonly Readonly<{ properties: readonly string[]; keyframes: number }>[];
  }>;
}>;

export type WebPresentationAdapterSession<ElementName extends string> = PresentationAdapterSession<
  WebPresentationLanguage,
  ElementName
> &
  Readonly<{
    inspect(): WebPresentationFrameInspection<ElementName>;
    /** @internal Captures canonical temporal continuity for development replacement. */
    snapshot(): WebAnimationHostSnapshot;
  }>;

export type WebPresentationAdapterInstance = Omit<
  PresentationAdapterInstance<WebPresentationLanguage, Element>,
  "create"
> &
  Readonly<{
    create<const ElementName extends string>(options: {
      readonly boundary: Element;
      readonly elements: PresentationElementResolver<ElementName, Element>;
      readonly identity?: string;
      readonly scopes?: readonly object[];
    }): WebPresentationAdapterSession<ElementName>;
  }>;

export type WebPresentationAdapter = Omit<
  PresentationAdapter<WebPresentationLanguage, Element>,
  "mount"
> &
  Readonly<{
    mount(options: {
      readonly boundary: Element;
      readonly snapshot?: unknown;
    }): WebPresentationAdapterInstance;
  }>;

type RegistryEntry = {
  readonly css: string;
  references: number;
};

type AppliedStyle = Readonly<{
  className: string;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  presence?: WebElementPresentation["presence"];
}>;

type AppliedVariables = {
  readonly original: Map<string, Readonly<{ value: string; priority: string }>>;
  readonly rendered: Map<string, string>;
};

type ResolvedPresentation = Readonly<{
  compiled: CompiledWebStyle;
  variables?: Readonly<Record<string, string>>;
  image?: WebImageAsset;
  feedback?: WebFeedback;
  presence?: WebElementPresentation["presence"];
  continuity?: WebLayoutContinuity;
}>;

type RenderedPresentation<ElementName extends string> = Readonly<{
  time: number;
  dynamic: boolean;
  behavior?: Readonly<{ state: Readonly<object>; props?: Readonly<object> }>;
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>;
  artifacts: WebPresentationArtifactPlan<ElementName>;
}>;

/** Realizes web Presentation declarations through document-scoped native hosts. */
export function createWebPresentationAdapter(
  options: WebPresentationAdapterOptions = {},
): WebPresentationAdapter {
  const registries = new WeakMap<object, WebStyleRegistry>();

  return {
    mount(input) {
      const restored = readHotSnapshot(input.snapshot);
      const restoredSessions = new Map(
        Object.entries(restored?.sessions ?? {}).map(([identity, snapshots]) => [
          identity,
          [...snapshots],
        ]),
      );
      let restoredShared = 0;
      let anonymousSession = 0;
      const environment = createWebEnvironmentHost(input.boundary);
      const frames = createNativeWebFrameHost(input.boundary);
      const layouts = createWebLayoutHost(
        frames,
        () => environment.value.preferences.reducedMotion,
        input.boundary,
      );
      const sessions = new Map<WebPresentationAdapterSession<string>, string>();
      const scopedAnimations = new Map<object, WebAnimationHost>();
      let disposed = false;

      const animationsFor = (identity: object) => {
        let store = scopedAnimations.get(identity);
        if (!store) {
          store = createWebAnimationHost({
            now: frames.now,
            reducedMotion: () => environment.value.preferences.reducedMotion,
            restore: restored?.shared[restoredShared++],
          });
          scopedAnimations.set(identity, store);
        }
        return store;
      };

      return {
        environment: environment.value,
        create<const ElementName extends string>(component: {
          readonly boundary: Element;
          readonly elements: PresentationElementResolver<ElementName, Element>;
          readonly identity?: string;
          readonly scopes?: readonly object[];
        }): WebPresentationAdapterSession<ElementName> {
          if (disposed) throw new Error("Cannot create a disposed web Presentation instance.");
          const key = styleScope(component.boundary);
          let registry = registries.get(key);
          if (!registry) {
            registry = new WebStyleRegistry(
              component.boundary,
              options.createStyleHost ?? createNativeStyleHost,
              options.createImageHost ?? createNativeImageHost,
              options.createFeedbackHost ?? createNativeFeedbackHost,
              () => registries.delete(key),
            );
            registries.set(key, registry);
          }
          registry.retainSession();
          const identity = component.identity ?? `@anonymous:${++anonymousSession}`;
          const queue = restoredSessions.get(identity);
          const restore = queue?.shift();
          if (queue?.length === 0) restoredSessions.delete(identity);
          let registered: WebPresentationAdapterSession<ElementName>;
          const session = createSession(
            component.boundary,
            component.elements,
            registry,
            frames,
            layouts,
            (component.scopes ?? []).map(animationsFor),
            () => environment.value.preferences.reducedMotion,
            environment.geometryRevision,
            () => sessions.delete(registered as WebPresentationAdapterSession<string>),
            restore,
            options.createNativeAnimation,
          );
          registered = session;
          sessions.set(registered as WebPresentationAdapterSession<string>, identity);
          return session;
        },
        snapshot() {
          const grouped: Record<string, WebAnimationHostSnapshot[]> = Object.create(null);
          for (const [session, identity] of sessions) {
            (grouped[identity] ??= []).push(session.snapshot());
          }
          return Object.freeze({
            shared: Object.freeze(
              [...scopedAnimations.values()].map((animations) => animations.snapshot()),
            ),
            sessions: Object.freeze(
              Object.fromEntries(
                Object.entries(grouped).map(([identity, snapshots]) => [
                  identity,
                  Object.freeze(snapshots),
                ]),
              ),
            ),
          }) satisfies WebPresentationHotSnapshot;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const session of sessions.keys()) session.dispose();
          sessions.clear();
          for (const animations of scopedAnimations.values()) animations.dispose();
          scopedAnimations.clear();
          layouts.dispose();
          frames.dispose();
          environment.dispose();
        },
      };
    },
  };
}

function createSession<ElementName extends string>(
  boundary: Element,
  elements: PresentationElementResolver<ElementName, Element>,
  registry: WebStyleRegistry,
  frames: WebFrameHost,
  layouts: WebLayoutHost,
  scopedAnimations: readonly WebAnimationHost[],
  reducedMotion: () => boolean,
  environmentGeometryRevision: () => number,
  onDispose: () => void,
  restore?: WebAnimationHostSnapshot,
  createNativeAnimation?: WebNativeAnimationFactory,
): WebPresentationAdapterSession<ElementName> {
  const layoutOwner = {};
  const observations = createWebElementObservationHost(boundary, elements, {
    layout: (target) => layouts.sample(target),
    presence: readPresentationPresence,
  });
  const documentPerformance = boundary.ownerDocument?.defaultView?.performance;
  const planningNow = documentPerformance ? () => documentPerformance.now() : planningTime;
  const applied = new Map<Element, AppliedStyle>();
  const variables = new Map<Element, AppliedVariables>();
  const presences = new Set<Element>();
  let currentFrame:
    | Readonly<{
        evaluate: Parameters<
          PresentationAdapterSession<WebPresentationLanguage, ElementName>["render"]
        >[0];
        dynamic: boolean;
        behavior?: Readonly<{ state: Readonly<object>; props?: Readonly<object> }>;
      }>
    | undefined;
  let temporalDeclarations:
    | Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>
    | undefined;
  let rendered: RenderedPresentation<ElementName> | undefined;
  let inspected: WebPresentationFrameInspection<ElementName> | undefined;
  let rendering = false;
  let dynamicMode: boolean | undefined;
  let disposed = false;
  let lastRenderedTime: number | undefined;
  let lastRenderedLayoutRevision: number | undefined;
  let lastEnvironmentGeometryRevision: number | undefined;
  let executionPlan: WebExecutionPlan = Object.freeze({
    kind: "canonical",
    reason: "no-animation",
  });
  let nativeExecution:
    | Readonly<{ plan: WebNativeExecutionPlan; execution: WebNativeExecution }>
    | undefined;
  const setExecutionPlan = (next: WebExecutionPlan) => {
    executionPlan = next;
    inspected = undefined;
  };

  const commit = (
    declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
    dynamic: boolean,
    measureLayout: boolean,
    frameTime: number,
    layoutTransition: "animate" | "synchronize",
  ): WebPresentationArtifactPlan<ElementName> => {
    const { resolved: next, artifacts } = resolveStyles(
      elements,
      declarations,
      dynamic,
      layouts,
      frameTime,
    );
    for (const [target, declaration] of next) {
      const { compiled, image, feedback, presence } = declaration;
      const nextClassName = compiled.css ? compiled.className : "";
      const current = applied.get(target);
      if (current?.className !== nextClassName) {
        if (nextClassName) registry.acquire(compiled);
        if (current?.className && nextClassName) {
          target.classList.replace(current.className, nextClassName);
        } else if (current?.className) {
          target.classList.remove(current.className);
        } else if (nextClassName) {
          target.classList.add(nextClassName);
        }
      }
      if (!sameImage(current?.image, image)) registry.setImage(target, image);
      if (!sameFeedback(current?.feedback, feedback)) registry.setFeedback(target, feedback);
      applyPresence(target, presences, presence);
      applyVariables(target, variables, declaration.variables);
    }

    for (const [target, current] of applied) {
      const replacement = next.get(target);
      const replacementClassName = replacement?.compiled.css ? replacement.compiled.className : "";
      if (replacementClassName !== current.className) {
        if (!replacement && current.className) target.classList.remove(current.className);
        if (current.className) registry.release(current.className);
      }
      if (!replacement && current.feedback) registry.setFeedback(target, undefined);
      if (!replacement && current.image) registry.setImage(target, undefined);
      if (!replacement) applyPresence(target, presences, undefined);
      if (!replacement) applyVariables(target, variables, undefined);
    }

    applied.clear();
    for (const [target, { compiled, image, feedback, presence }] of next) {
      applied.set(target, {
        className: compiled.css ? compiled.className : "",
        image,
        feedback,
        presence,
      });
    }
    registry.scheduleFlush();
    if (measureLayout) {
      const continuity = new Map(
        [...next].flatMap(([target, declaration]) =>
          declaration.continuity ? [[target, declaration.continuity] as const] : [],
        ),
      );
      if (continuity.size) {
        layouts.update(layoutOwner, continuity, renderLayoutFrame, layoutTransition);
      } else layouts.remove(layoutOwner);
    }
    return artifacts;
  };
  const renderCurrent = (time?: number, measureLayout = true) => {
    if (!currentFrame || disposed) return;
    if (rendering) throw new Error("Web Presentation frame evaluation is not reentrant.");
    rendering = true;
    const frameTime = time ?? frames.time();
    const layoutRevision = layouts.inspect().revision;
    const environmentRevision = environmentGeometryRevision();
    const environmentChanged =
      lastEnvironmentGeometryRevision !== undefined &&
      lastEnvironmentGeometryRevision !== environmentRevision;
    const animationTransition = environmentChanged ? "synchronize" : "animate";
    const layoutTransition =
      lastEnvironmentGeometryRevision === undefined || environmentChanged
        ? "synchronize"
        : "animate";
    if (
      !measureLayout &&
      lastRenderedTime === frameTime &&
      lastRenderedLayoutRevision === layoutRevision
    ) {
      rendering = false;
      return;
    }
    for (const scoped of scopedAnimations) scoped.begin(frameTime, animationTransition);
    animations.begin(frameTime, animationTransition);
    let active = false;
    try {
      const declarations = evaluatePresentationFrame(animations, () => {
        const authored =
          temporalDeclarations ??
          currentFrame!.evaluate({
            elements: observations.elements as never,
            scopes: scopedAnimations.map((scope) => ({
              evaluate: <Value>(read: () => Value) => evaluatePresentationFrame(scope, read),
            })),
          });
        if (!temporalDeclarations) {
          if (!hasPresentationTemporalValue(authored)) return authored;
          assertCompositorTemporalDeclarations(authored);
          temporalDeclarations = authored;
        }
        return resolvePresentationTemporalValues(authored);
      });
      const dynamic =
        currentFrame.dynamic || animations.used() || scopedAnimations.some((scope) => scope.used());
      if (dynamicMode === undefined) dynamicMode = dynamic;
      else if (dynamicMode !== dynamic) {
        throw new Error("A Component Presentation cannot conditionally resolve values.");
      }
      const artifacts = commit(declarations, dynamic, measureLayout, frameTime, layoutTransition);
      lastRenderedTime = frameTime;
      lastRenderedLayoutRevision = layoutRevision;
      lastEnvironmentGeometryRevision = environmentRevision;
      rendered = Object.freeze({
        time: frameTime,
        dynamic,
        ...(currentFrame.behavior ? { behavior: currentFrame.behavior } : {}),
        declarations,
        artifacts,
      });
      inspected = undefined;
    } finally {
      active = animations.end();
      for (const scoped of [...scopedAnimations].reverse()) active = scoped.end() || active;
      rendering = false;
    }
    const drivesFrames =
      temporalDeclarations !== undefined || Object.keys(rendered?.declarations ?? {}).length > 0;
    if (!active || !drivesFrames) {
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "no-animation" }));
      frames.deactivate(renderAnimationFrame);
      return;
    }
    if (measureLayout && startNativePlan(frameTime)) {
      if (nativeExecution?.plan.mode === "hybrid") frames.activate(renderAnimationFrame);
      else frames.deactivate(renderAnimationFrame);
      return;
    }
    frames.activate(renderAnimationFrame);
  };
  const animations = createWebAnimationHost({
    now: frames.now,
    reducedMotion,
    parents: scopedAnimations,
    restore,
  });
  const renderAnimationFrame = (time: number) => renderCurrent(time, false);
  const renderLayoutFrame = (time: number) => renderCurrent(time, false);

  const cancelNativeExecution = () => {
    const current = nativeExecution;
    if (!current) return;
    nativeExecution = undefined;
    current.execution.cancel();
  };

  const startNativePlan = (started: number): boolean => {
    cancelNativeExecution();
    if (!temporalDeclarations) {
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "direct-lowering-required" }));
      return false;
    }
    if (!createNativeAnimation && !hasNativeAnimationTarget(elements)) {
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "native-unavailable" }));
      return false;
    }
    if (layouts.inspect().moving > 0) {
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "layout-active" }));
      return false;
    }
    const plan = planNativeExecution(started);
    setExecutionPlan(plan);
    if (plan.kind !== "native") {
      return false;
    }
    const execution = startWebNativeExecution(
      plan,
      createNativeAnimation,
      Math.max(0, frames.now() - started),
    );
    if (!execution) {
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "native-unavailable" }));
      return false;
    }
    const owned = Object.freeze({ plan, execution });
    nativeExecution = owned;
    void execution.finished.then(
      () => {
        if (disposed || nativeExecution !== owned) return;
        nativeExecution = undefined;
        renderCurrent(plan.started + plan.duration, false);
        execution.cancel();
      },
      () => {
        if (nativeExecution !== owned) return;
        nativeExecution = undefined;
        setExecutionPlan(Object.freeze({ kind: "canonical", reason: "native-unavailable" }));
        frames.activate(renderAnimationFrame);
      },
    );
    return true;
  };

  const planNativeExecution = (started: number): WebExecutionPlan => {
    const simulationScopes = scopedAnimations.map((scope) =>
      scope.fork({
        now: () => started,
        reducedMotion,
      }),
    );
    const simulation = animations.fork({
      now: () => started,
      reducedMotion,
      parents: simulationScopes,
    });
    const activeAnimations = new Set(
      [
        simulation.inspectFrame(started),
        ...simulationScopes.map((scope) => scope.inspectFrame(started)),
      ]
        .flatMap((inspection) => Object.entries(inspection.animations))
        .filter(([, animation]) => !animation.settled)
        .map(([identity]) => identity),
    );
    const direct = createNativeTemporalDeclarationSampler(temporalDeclarations!, activeAnimations);
    if (!direct) {
      simulation.dispose();
      for (const scope of simulationScopes) scope.dispose();
      return Object.freeze({ kind: "canonical", reason: "non-compositor-output" });
    }
    const plannedElements = Object.fromEntries(
      direct.elements.map((name) => [name, elements[name]]),
    ) as Readonly<Record<ElementName, () => readonly Element[]>>;
    const samples = new Map<number, WebExecutionSample>();
    const sample = (time: number): WebExecutionSample => {
      const previous = samples.get(time);
      if (previous) return previous;
      for (const scope of simulationScopes) scope.begin(time);
      simulation.begin(time);
      try {
        const declarations = evaluatePresentationFrame(simulation, direct.sample);
        const result = Object.freeze({
          time,
          declarations: snapshotPlainData(declarations) as Readonly<
            Partial<Record<string, Readonly<WebElementPresentation>>>
          >,
        });
        samples.set(time, result);
        return result;
      } finally {
        simulation.end();
        for (const scope of [...simulationScopes].reverse()) scope.end();
      }
    };
    try {
      sample(started);
      const finished = nativeExecutionEnd(
        started,
        simulation.inspectFrame(started),
        simulationScopes.map((scope) => scope.inspectFrame(started)),
      );
      if (finished === undefined) {
        return Object.freeze({ kind: "canonical", reason: "planning-limit" });
      }
      const plan = planAdaptiveWebExecution({
        started,
        finished,
        sample,
        elements: plannedElements,
        planning: { budget: 8, now: planningNow },
      });
      return plan.kind === "native" && direct.canonical
        ? Object.freeze({ ...plan, mode: "hybrid" as const })
        : plan;
    } finally {
      simulation.dispose();
      for (const scope of simulationScopes) scope.dispose();
    }
  };

  return {
    render(frame, options) {
      if (disposed) throw new Error("Cannot render a disposed web Presentation session.");
      cancelNativeExecution();
      setExecutionPlan(Object.freeze({ kind: "canonical", reason: "no-animation" }));
      currentFrame = Object.freeze({
        evaluate: frame,
        dynamic: options?.dynamic ?? false,
        ...(options?.behavior ? { behavior: options.behavior } : {}),
      });
      temporalDeclarations = undefined;
      renderCurrent(frames.time());
    },
    inspect() {
      if (inspected) return inspected;
      if (!rendered) throw new Error("The web Presentation session has not rendered a frame.");
      const current = rendered;
      const behavior = current.behavior ? snapshotBehavior(current.behavior) : undefined;
      const observationSnapshot = observations.inspect();
      const animationSnapshot = animations.inspectFrame(current.time);
      const scopeSnapshots = Object.freeze(
        scopedAnimations.map((scope) => scope.inspectFrame(current.time)),
      );
      const declarationSnapshot = snapshotPlainData(current.declarations);
      const frame = createPresentationFrame({
        time: current.time,
        input: snapshotPlainData({
          ...(behavior ? { behavior } : {}),
          observations: observationSnapshot,
        }) as never,
        temporal: snapshotTemporalData(animationSnapshot, scopeSnapshots) as never,
        declarations: declarationSnapshot as never,
      });
      inspected = Object.freeze({
        time: current.time,
        frame,
        dynamic: current.dynamic,
        ...(behavior ? { behavior } : {}),
        observations: observationSnapshot,
        animations: animationSnapshot,
        scopes: scopeSnapshots,
        declarations: declarationSnapshot,
        artifacts: current.artifacts,
        elements: inspectFrameElements(elements, applied, variables),
        execution: inspectExecution(executionPlan),
      });
      return inspected;
    },
    snapshot() {
      return animations.snapshot();
    },
    reconfigure(options) {
      if (disposed) throw new Error("Cannot reconfigure a disposed web Presentation session.");
      cancelNativeExecution();
      animations.reconfigure();
      if (options?.scopes) {
        for (const scoped of scopedAnimations) scoped.reconfigure();
      }
      dynamicMode = undefined;
      temporalDeclarations = undefined;
      lastRenderedTime = undefined;
      lastRenderedLayoutRevision = undefined;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      currentFrame = undefined;
      temporalDeclarations = undefined;
      rendered = undefined;
      inspected = undefined;
      cancelNativeExecution();
      frames.deactivate(renderAnimationFrame);
      animations.dispose();
      observations.dispose();
      layouts.remove(layoutOwner);
      for (const target of variables.keys()) applyVariables(target, variables, undefined);
      for (const target of presences) setPresentationPresence(target, undefined);
      presences.clear();
      for (const [target, current] of applied) {
        if (current.className) {
          target.classList.remove(current.className);
          registry.release(current.className);
        }
        if (current.image) registry.setImage(target, undefined);
        if (current.feedback) registry.setFeedback(target, undefined);
      }
      applied.clear();
      registry.releaseSession();
      onDispose();
    },
  };
}

function hasNativeAnimationTarget<ElementName extends string>(
  elements: PresentationElementResolver<ElementName, Element>,
): boolean {
  return Object.values(elements).some((source) =>
    (source as () => readonly Element[])().some(
      (target) => typeof (target as Element & { animate?: unknown }).animate === "function",
    ),
  );
}

function hasPresentationTemporalValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (isPresentationTemporalValue(value)) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasPresentationTemporalValue(item, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).some((item) => hasPresentationTemporalValue(item, seen));
}

function assertCompositorTemporalDeclarations(
  declarations: Readonly<Record<string, unknown>>,
): void {
  for (const [element, declaration] of Object.entries(declarations)) {
    visitTemporalDeclaration(declaration, [element], new WeakSet());
  }
}

function visitTemporalDeclaration(
  value: unknown,
  path: readonly string[],
  seen: WeakSet<object>,
): void {
  if (isPresentationTemporalValue(value)) {
    if (!isCompositorTemporalPath(path)) {
      throw new TypeError(
        `Web temporal output ${JSON.stringify(path.join("."))} is not compositor-safe. ` +
          "Change layout and paint discretely, then use layout continuity or animate only " +
          "presence, opacity, translate, scale, and rotate.",
      );
    }
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitTemporalDeclaration(item, [...path, String(index)], seen));
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  for (const [name, item] of Object.entries(value)) {
    visitTemporalDeclaration(item, [...path, name], seen);
  }
}

function isCompositorTemporalPath(path: readonly string[]): boolean {
  const use = path.lastIndexOf("use");
  const style = path.slice(use >= 0 ? use + 1 : 1);
  if (style[0] === "presence") return true;
  if (style[0] === "paint" && style[1] === "opacity") return true;
  return (
    style[0] === "transform" &&
    (style[1] === "translate" || style[1] === "scale" || style[1] === "rotate")
  );
}

function resolvePresentationTemporalValues<Value>(
  value: Value,
  seen = new WeakMap<object, unknown>(),
): Value {
  if (isPresentationTemporalValue(value)) return value.sample() as Value;
  if (!value || typeof value !== "object") return value;
  const previous = seen.get(value);
  if (previous) return previous as Value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    let changed = false;
    for (const item of value) {
      const resolved = resolvePresentationTemporalValues(item, seen);
      result.push(resolved);
      changed ||= resolved !== item;
    }
    const resolved = changed ? Object.freeze(result) : value;
    seen.set(value, resolved);
    return resolved as Value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  let changed = false;
  for (const [name, item] of Object.entries(value)) {
    const resolved = resolvePresentationTemporalValues(item, seen);
    result[name] = resolved;
    changed ||= resolved !== item;
  }
  const resolved = changed ? Object.freeze(result) : value;
  seen.set(value, resolved);
  return resolved as Value;
}

type NativeTemporalDeclarationSampler<ElementName extends string> = Readonly<{
  elements: readonly ElementName[];
  canonical: boolean;
  sample(): Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>;
}>;

function createNativeTemporalDeclarationSampler<ElementName extends string>(
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
  active: ReadonlySet<string>,
): NativeTemporalDeclarationSampler<ElementName> | undefined {
  const records: Array<
    Readonly<{
      name: ElementName;
      paint?: Readonly<{ opacity: unknown }>;
      transform?: Readonly<{
        translate?: Readonly<{ x: unknown; y: unknown }>;
        scale?: unknown;
        rotate?: unknown;
      }>;
    }>
  > = [];
  let canonical = false;

  for (const [name, declaration] of Object.entries(declarations) as Array<
    [ElementName, Readonly<WebElementPresentation>]
  >) {
    const paths = activeTemporalPaths(declaration, active);
    if (paths.some((path) => !isNativeTemporalPath(path))) {
      canonical = true;
      continue;
    }
    const nativePaths = paths.filter((path) => path[0] !== "presence");
    if (nativePaths.length === 0) continue;
    const paint = nativePaths.some((path) => path[0] === "paint")
      ? Object.freeze({ opacity: declaration.paint?.opacity })
      : undefined;
    const source = declaration.transform;
    const translate = nativePaths.some((path) => path[0] === "transform" && path[1] === "translate")
      ? Object.freeze({ x: source?.translate?.x ?? 0, y: source?.translate?.y ?? 0 })
      : undefined;
    const scale = nativePaths.some((path) => path[0] === "transform" && path[1] === "scale")
      ? source?.scale
      : undefined;
    const rotate = nativePaths.some((path) => path[0] === "transform" && path[1] === "rotate")
      ? source?.rotate
      : undefined;
    records.push(
      Object.freeze({
        name,
        ...(paint ? { paint } : {}),
        ...(translate || scale !== undefined || rotate !== undefined
          ? {
              transform: Object.freeze({
                ...(translate ? { translate } : {}),
                ...(scale !== undefined ? { scale } : {}),
                ...(rotate !== undefined ? { rotate } : {}),
              }),
            }
          : {}),
      }),
    );
  }

  if (records.length === 0) return;
  return Object.freeze({
    elements: Object.freeze(records.map(({ name }) => name)),
    canonical,
    sample() {
      return Object.freeze(
        Object.fromEntries(
          records.map(({ name, paint, transform }) => {
            const resolvedScale = resolvePresentationTemporalValues(transform?.scale);
            const declaration = Object.freeze({
              ...(paint
                ? {
                    paint: Object.freeze({
                      opacity: resolvePresentationTemporalValues(paint.opacity),
                    }),
                  }
                : {}),
              ...(transform
                ? {
                    transform: Object.freeze({
                      ...(transform.translate
                        ? {
                            translate: Object.freeze({
                              x: resolvePresentationTemporalValues(transform.translate.x),
                              y: resolvePresentationTemporalValues(transform.translate.y),
                            }),
                          }
                        : {}),
                      ...(resolvedScale !== undefined ? { scale: resolvedScale } : {}),
                      ...(transform.rotate !== undefined
                        ? { rotate: resolvePresentationTemporalValues(transform.rotate) }
                        : {}),
                    }),
                  }
                : {}),
            }) as Readonly<WebElementPresentation>;
            return [name, declaration] as const;
          }),
        ) as Partial<Record<ElementName, Readonly<WebElementPresentation>>>,
      );
    },
  });
}

function activeTemporalPaths(
  value: unknown,
  active: ReadonlySet<string>,
  path: readonly string[] = [],
  result: string[][] = [],
  seen = new WeakSet<object>(),
): readonly (readonly string[])[] {
  if (isPresentationTemporalValue(value)) {
    if (value.animations.some((identity) => active.has(identity))) result.push([...path]);
    return result;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      activeTemporalPaths(item, active, [...path, `${index}`], result, seen),
    );
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return result;
  for (const [name, item] of Object.entries(value)) {
    activeTemporalPaths(item, active, [...path, name], result, seen);
  }
  return result;
}

function isNativeTemporalPath(path: readonly string[]): boolean {
  if (path[0] === "presence") return true;
  if (path.length === 2 && path[0] === "paint" && path[1] === "opacity") return true;
  if (path[0] !== "transform") return false;
  if (path.length === 2 && (path[1] === "scale" || path[1] === "rotate")) return true;
  return (
    path.length === 3 &&
    ((path[1] === "translate" && (path[2] === "x" || path[2] === "y")) ||
      (path[1] === "scale" && (path[2] === "x" || path[2] === "y")))
  );
}

function planningTime(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function inspectExecution(
  plan: WebExecutionPlan,
): WebPresentationFrameInspection<string>["execution"] {
  return plan.kind === "native"
    ? Object.freeze({
        kind: "native",
        mode: plan.mode,
        duration: plan.duration,
        samples: plan.samples,
        effects: Object.freeze(
          plan.effects.map((effect) =>
            Object.freeze({ properties: effect.properties, keyframes: effect.keyframes.length }),
          ),
        ),
      })
    : Object.freeze({ kind: "canonical", reason: plan.reason });
}

function readHotSnapshot(value: unknown): WebPresentationHotSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<WebPresentationHotSnapshot>;
  if (
    !Array.isArray(candidate.shared) ||
    !candidate.sessions ||
    typeof candidate.sessions !== "object"
  ) {
    return undefined;
  }
  return candidate as WebPresentationHotSnapshot;
}

function snapshotBehavior(
  behavior: Readonly<{ state: Readonly<object>; props?: Readonly<object> }>,
): Readonly<{ state: Readonly<object>; props?: Readonly<object> }> {
  return Object.freeze({
    state: snapshotPlainData(behavior.state),
    ...(behavior.props ? { props: snapshotPlainData(behavior.props) } : {}),
  });
}

function snapshotTemporalData(
  local: WebAnimationInspection,
  scopes: readonly WebAnimationInspection[],
): Readonly<object> {
  return Object.freeze({
    local: snapshotAnimationSamples(local),
    scopes: Object.freeze(scopes.map(snapshotAnimationSamples)),
  });
}

function nativeExecutionEnd(
  started: number,
  local: WebAnimationInspection,
  scopes: readonly WebAnimationInspection[],
): number | undefined {
  const active = [local, ...scopes].flatMap((inspection) =>
    Object.values(inspection.animations).filter((animation) => !animation.settled),
  );
  if (!active.length) return;
  const ends = active.map(({ endsAt }) => endsAt);
  if (ends.some((time) => !Number.isFinite(time) || time <= started)) return;
  return Math.max(...ends);
}

function snapshotAnimationSamples(inspection: WebAnimationInspection): Readonly<object> {
  return Object.freeze({
    time: inspection.time,
    settled: inspection.settled,
    animations: Object.freeze(
      Object.fromEntries(
        Object.entries(inspection.animations)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, animation]) => [
            identity,
            Object.freeze({
              source: animation.source,
              started: animation.started,
              duration: animation.duration,
              endsAt: animation.endsAt,
              value: animation.value,
              velocity: animation.velocity,
              settled: animation.settled,
            }),
          ]),
      ),
    ),
  });
}

function snapshotPlainData<Value>(value: Value, seen = new WeakMap<object, unknown>()): Value {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing) return existing as Value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(snapshotPlainData(item, seen));
    return Object.freeze(result) as Value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    result[key] = snapshotPlainData(Reflect.get(value, key), seen);
  }
  return Object.freeze(result) as Value;
}

function inspectFrameElements<ElementName extends string>(
  elements: PresentationElementResolver<ElementName, Element>,
  applied: ReadonlyMap<Element, AppliedStyle>,
  variables: ReadonlyMap<Element, AppliedVariables>,
): Readonly<Record<ElementName, readonly WebPresentationFrameElement[]>> {
  return Object.freeze(
    Object.fromEntries(
      (Object.entries(elements) as Array<[ElementName, () => readonly Element[]]>).map(
        ([name, source]) => [
          name,
          Object.freeze(
            source().map((target) => {
              const style = applied.get(target);
              return Object.freeze({
                target,
                className: style?.className ?? "",
                properties: Object.freeze(
                  Object.fromEntries(variables.get(target)?.rendered ?? []),
                ),
                ...(style?.image ? { image: style.image } : {}),
                ...(style?.feedback ? { feedback: style.feedback } : {}),
                ...(style?.presence !== undefined ? { presence: style.presence } : {}),
              });
            }),
          ),
        ],
      ),
    ),
  ) as Readonly<Record<ElementName, readonly WebPresentationFrameElement[]>>;
}

function resolveStyles<ElementName extends string>(
  elements: PresentationElementResolver<ElementName, Element>,
  declarations: Readonly<Partial<Record<ElementName, Readonly<WebElementPresentation>>>>,
  dynamic: boolean,
  layouts: WebLayoutHost,
  frameTime: number,
): Readonly<{
  resolved: Map<Element, ResolvedPresentation>;
  artifacts: WebPresentationArtifactPlan<ElementName>;
}> {
  const artifacts = planWebPresentationArtifacts(declarations, { dynamic });
  const result = new Map<Element, ResolvedPresentation>();
  for (const [name, source] of Object.entries(elements) as Array<
    [ElementName, () => readonly Element[]]
  >) {
    const declaration = declarations[name];
    const artifact = artifacts.elements[name];
    if (!declaration || !artifact) continue;
    const compiled = Object.freeze({ className: artifact.className, css: artifact.css });
    const authoredVariables = Object.keys(artifact.variables).length
      ? artifact.variables
      : undefined;
    for (const target of source()) {
      const variables = mergeProperties(
        authoredVariables,
        artifact.continuity ? layouts.resolve(target, frameTime) : undefined,
      );
      const current = result.get(target);
      if (
        current &&
        (current.compiled.className !== compiled.className ||
          !sameImage(current.image, artifact.image) ||
          !sameFeedback(current.feedback, artifact.feedback) ||
          current.presence !== artifact.presence ||
          !sameStructuredValue(current.continuity, artifact.continuity) ||
          !sameStructuredValue(current.variables, variables))
      ) {
        throw new TypeError(
          `Web Presentation Element ${String(name)} resolves to a DOM Element already owned by another name.`,
        );
      }
      result.set(target, {
        compiled,
        variables,
        image: artifact.image,
        feedback: artifact.feedback,
        presence: artifact.presence,
        continuity: artifact.continuity,
      });
    }
  }
  return Object.freeze({ resolved: result, artifacts });
}

function mergeProperties(
  declarations: Readonly<Record<string, string>> | undefined,
  runtime: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!declarations) return runtime;
  if (!runtime) return declarations;
  return Object.freeze({ ...declarations, ...runtime });
}

class WebStyleRegistry {
  readonly #entries = new Map<string, RegistryEntry>();
  readonly #boundary: Element;
  readonly #createHost: (boundary: Element) => WebStyleHost;
  readonly #createImageHost: (boundary: Element) => WebImageHost;
  readonly #createFeedbackHost: (boundary: Element) => WebFeedbackHost;
  readonly #onUnused: () => void;
  #host: WebStyleHost | undefined;
  #imageHost: WebImageHost | undefined;
  #feedbackHost: WebFeedbackHost | undefined;
  #sessions = 0;
  #dirty = false;
  #scheduled = false;
  #emitted = "";

  constructor(
    boundary: Element,
    createHost: (boundary: Element) => WebStyleHost,
    createImageHost: (boundary: Element) => WebImageHost,
    createFeedbackHost: (boundary: Element) => WebFeedbackHost,
    onUnused: () => void,
  ) {
    this.#boundary = boundary;
    this.#createHost = createHost;
    this.#createImageHost = createImageHost;
    this.#createFeedbackHost = createFeedbackHost;
    this.#onUnused = onUnused;
  }

  retainSession(): void {
    this.#sessions += 1;
  }

  acquire(compiled: CompiledWebStyle): void {
    const current = this.#entries.get(compiled.className);
    if (current) {
      if (current.css !== compiled.css) {
        throw new Error(`Web Presentation class collision for ${compiled.className}.`);
      }
      current.references += 1;
      return;
    }
    this.#entries.set(compiled.className, { css: compiled.css, references: 1 });
    this.#dirty = true;
  }

  release(className: string): void {
    const current = this.#entries.get(className);
    if (!current) throw new Error(`Web Presentation class ${className} is not registered.`);
    current.references -= 1;
    if (current.references < 0) {
      throw new Error(`Web Presentation class ${className} ownership underflow.`);
    }
  }

  scheduleFlush(): void {
    if (this.#scheduled || !this.#dirty) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#flush();
    });
  }

  setFeedback(target: Element, feedback: WebFeedback | undefined): void {
    if (feedback) {
      this.#feedbackHost ??= this.#createFeedbackHost(this.#boundary);
      this.#feedbackHost.set(target, feedback);
    } else {
      this.#feedbackHost?.set(target, undefined);
    }
  }

  setImage(target: Element, image: WebImageAsset | undefined): void {
    if (image) {
      this.#imageHost ??= this.#createImageHost(this.#boundary);
      this.#imageHost.set(target, image);
    } else {
      this.#imageHost?.set(target, undefined);
    }
  }

  #flush(): void {
    if (!this.#dirty || !this.#sessions) return;
    this.#dirty = false;
    this.#host ??= this.#createHost(this.#boundary);
    const css = [...this.#entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.css)
      .join("");
    const emitted =
      `@layer kit.reset,kit.presentation;@layer kit.reset{${webResetCss}}` +
      `@layer kit.presentation{${css}}`;
    if (emitted === this.#emitted) return;
    this.#emitted = emitted;
    this.#host.replace(emitted);
  }

  releaseSession(): void {
    this.#sessions -= 1;
    if (this.#sessions < 0) throw new Error("Web Presentation session ownership underflow.");
    if (this.#sessions) {
      this.scheduleFlush();
      return;
    }
    this.#host?.dispose();
    this.#imageHost?.dispose();
    this.#feedbackHost?.dispose();
    this.#host = undefined;
    this.#imageHost = undefined;
    this.#feedbackHost = undefined;
    this.#entries.clear();
    this.#dirty = false;
    this.#emitted = "";
    this.#onUnused();
  }
}

function sameImage(left: WebImageAsset | undefined, right: WebImageAsset | undefined): boolean {
  return left?.source === right?.source;
}

function sameFeedback(left: WebFeedback | undefined, right: WebFeedback | undefined): boolean {
  return left?.activate?.audio === right?.activate?.audio;
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameStructuredValue(value, (right as Record<string, unknown>)[key]),
    )
  );
}

function applyVariables(
  target: Element,
  applied: Map<Element, AppliedVariables>,
  variables: Readonly<Record<string, string>> | undefined,
): void {
  const current = applied.get(target);
  if (!variables) {
    if (!current) return;
    const style = elementStyle(target);
    for (const [name, original] of current.original) {
      if (original.value) style.setProperty(name, original.value, original.priority);
      else style.removeProperty(name);
    }
    applied.delete(target);
    return;
  }

  const style = elementStyle(target);
  const state = current ?? { original: new Map(), rendered: new Map() };
  for (const [name, value] of Object.entries(variables)) {
    if (!state.original.has(name)) {
      state.original.set(name, {
        value: style.getPropertyValue(name),
        priority: style.getPropertyPriority(name),
      });
    }
    if (state.rendered.get(name) === value) continue;
    style.setProperty(name, value);
    state.rendered.set(name, value);
  }
  for (const name of state.rendered.keys()) {
    if (Object.hasOwn(variables, name)) continue;
    const original = state.original.get(name);
    if (original?.value) style.setProperty(name, original.value, original.priority);
    else style.removeProperty(name);
    state.rendered.delete(name);
    state.original.delete(name);
  }
  applied.set(target, state);
}

function elementStyle(target: Element): CSSStyleDeclaration {
  const style = (target as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new TypeError("A dynamic web Presentation Element must expose native style.");
  return style;
}

function applyPresence(
  target: Element,
  applied: Set<Element>,
  value: WebElementPresentation["presence"] | undefined,
): void {
  if (value === undefined) {
    if (!applied.delete(target)) return;
    setPresentationPresence(target, undefined);
    return;
  }
  applied.add(target);
  setPresentationPresence(target, value);
}

function styleScope(boundary: Element): object {
  return boundary.ownerDocument ?? boundary;
}

function createNativeStyleHost(boundary: Element): WebStyleHost {
  const ownerDocument = boundary.ownerDocument;
  if (!ownerDocument) {
    throw new Error("A web Presentation boundary must belong to a Document.");
  }
  const element = ownerDocument.createElement("style");
  element.setAttribute("data-kit-presentation", "");
  (ownerDocument.head ?? ownerDocument.documentElement).append(element);
  return {
    replace(css) {
      element.textContent = css;
      for (const server of ownerDocument.querySelectorAll("style[data-kit-ssr]")) {
        server.remove();
      }
    },
    dispose() {
      element.remove();
    },
  };
}

/** @internal Native resource owner used by web image declarations. */
export function createNativeImageHost(boundary: Element): WebImageHost {
  if (!boundary.ownerDocument) {
    throw new Error("A web image boundary must belong to a Document.");
  }
  const originals = new Map<Element, string | null>();
  let disposed = false;

  const restore = (target: Element) => {
    if (!originals.has(target)) return;
    const original = originals.get(target) as string | null;
    if (original === null) target.removeAttribute("src");
    else target.setAttribute("src", original);
    originals.delete(target);
  };

  return {
    set(target, image) {
      if (disposed) throw new Error("Cannot update a disposed web image host.");
      if (!image) {
        restore(target);
        return;
      }
      if (target.localName !== "img") {
        throw new TypeError("A web image declaration can only target an img Element.");
      }
      if (!originals.has(target)) originals.set(target, target.getAttribute("src"));
      if (target.getAttribute("src") !== image.source) target.setAttribute("src", image.source);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const target of originals.keys()) restore(target);
    },
  };
}

export type WebAudioOutput = {
  prepare(asset: WebAudioAsset): void;
  play(asset: WebAudioAsset): void;
  dispose(): void;
};

/** @internal Exposed from this module only so native activation semantics stay deterministic. */
export function createNativeFeedbackHost(
  boundary: Element,
  output?: WebAudioOutput,
): WebFeedbackHost {
  const ownerDocument = boundary.ownerDocument;
  if (!ownerDocument) {
    throw new Error("A web feedback boundary must belong to a Document.");
  }
  const audio = output ?? createNativeAudioOutput(ownerDocument);
  const declarations = new Map<Element, WebFeedback>();
  const pointerActivations = new Map<Element, ReturnType<typeof setTimeout>>();

  const resolve = (event: Event): readonly [Element, WebFeedback] | undefined => {
    for (const candidate of event.composedPath()) {
      const target = candidate as Element;
      const declaration = declarations.get(target);
      if (declaration) return [target, declaration];
    }
    return undefined;
  };
  const play = (declaration: WebFeedback) => {
    const asset = declaration.activate?.audio;
    if (asset) audio.play(asset);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const resolved = resolve(event);
    if (!resolved || interactionDisabled(resolved[0])) return;
    const [target, declaration] = resolved;
    const previous = pointerActivations.get(target);
    if (previous !== undefined) clearTimeout(previous);
    pointerActivations.set(
      target,
      setTimeout(() => pointerActivations.delete(target), 1_000),
    );
    play(declaration);
  };
  const onClick = (event: MouseEvent) => {
    const resolved = resolve(event);
    if (!resolved || interactionDisabled(resolved[0])) return;
    const [target, declaration] = resolved;
    const timeout = pointerActivations.get(target);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      pointerActivations.delete(target);
      if (event.detail > 0) return;
    }
    play(declaration);
  };

  ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  ownerDocument.addEventListener("click", onClick, true);
  let disposed = false;
  return {
    set(target, feedback) {
      if (disposed) throw new Error("Cannot update a disposed web feedback host.");
      if (feedback) {
        declarations.set(target, feedback);
        const asset = feedback.activate?.audio;
        if (asset) audio.prepare(asset);
      } else {
        declarations.delete(target);
        const timeout = pointerActivations.get(target);
        if (timeout !== undefined) clearTimeout(timeout);
        pointerActivations.delete(target);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
      ownerDocument.removeEventListener("click", onClick, true);
      for (const timeout of pointerActivations.values()) clearTimeout(timeout);
      pointerActivations.clear();
      declarations.clear();
      audio.dispose();
    },
  };
}

/** @internal Native resource owner used by the web feedback host. */
export function createNativeAudioOutput(ownerDocument: Document): WebAudioOutput {
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const sources = new Map<AudioBufferSourceNode, GainNode | undefined>();
  let context: AudioContext | undefined;
  let disposed = false;

  const getContext = (): AudioContext => {
    if (disposed) throw new Error("The web audio output is disposed.");
    if (context) return context;
    const Constructor = ownerDocument.defaultView?.AudioContext ?? globalThis.AudioContext;
    if (!Constructor) throw new Error("Web Audio is not supported in this environment.");
    context = new Constructor({ latencyHint: "interactive" });
    return context;
  };
  const load = (asset: WebAudioAsset): Promise<AudioBuffer> => {
    let pending = buffers.get(asset.source);
    if (pending) return pending;
    pending = fetch(asset.source)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load web audio asset ${asset.source}.`);
        return response.arrayBuffer();
      })
      .then((encoded) => getContext().decodeAudioData(encoded));
    pending.catch(() => undefined);
    buffers.set(asset.source, pending);
    return pending;
  };

  return {
    prepare(asset) {
      if (!disposed) load(asset);
    },
    play(asset) {
      if (disposed) return;
      let audioContext: AudioContext;
      try {
        audioContext = getContext();
        if (audioContext.state !== "running") void audioContext.resume().catch(() => undefined);
      } catch {
        return;
      }
      void load(asset)
        .then((buffer) => {
          if (disposed || audioContext.state === "closed") return;
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          if (asset.playbackRate !== undefined) source.playbackRate.value = asset.playbackRate;
          let gain: GainNode | undefined;
          if (asset.gain !== undefined && asset.gain !== 1) {
            gain = audioContext.createGain();
            gain.gain.value = asset.gain;
            source.connect(gain).connect(audioContext.destination);
          } else {
            source.connect(audioContext.destination);
          }
          sources.set(source, gain);
          source.addEventListener(
            "ended",
            () => {
              sources.delete(source);
              source.disconnect();
              gain?.disconnect();
            },
            { once: true },
          );
          source.start();
        })
        .catch(() => undefined);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      buffers.clear();
      for (const [source, gain] of sources) {
        try {
          source.stop();
        } catch {
          // A source that already ended needs no further work.
        }
        source.disconnect();
        gain?.disconnect();
      }
      sources.clear();
      if (context && context.state !== "closed") void context.close().catch(() => undefined);
      context = undefined;
    },
  };
}

function interactionDisabled(target: Element): boolean {
  for (let current: Element | null = target; current; current = current.parentElement) {
    if ("disabled" in current && Boolean((current as HTMLButtonElement).disabled)) return true;
    if (current.getAttribute("aria-disabled") === "true" || current.hasAttribute("inert")) {
      return true;
    }
  }
  return false;
}
