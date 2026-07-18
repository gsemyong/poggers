import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargets,
} from "../../presentation";
import {
  createAdaptiveMotionBackend,
  createAnimeLayoutBackend,
  createAnimeMotionBackend,
  createWaapiMotionBackend,
  resolveMotionBackend,
  RetainedLayoutGraph,
  RetainedMotionGraph,
  RetainedTransformComposer,
  type LayoutBackend,
  type MotionBackend,
  type MotionScheduler,
  type MotionTransition,
  type TransformChannel,
} from "../motion";
import { signal, type Signal } from "../runtime";
import type {
  WebMotionDeclaration,
  WebMotionTarget,
  WebMotionValue,
  WebPresentationCondition,
  WebPresentationContext,
  WebPresentationDeclaration,
  WebPresentationLanguage,
  WebPresentationResource,
  WebPresentationTheme,
  WebRenderLayer,
} from "../visual";
import { translateWebPresentationStyle } from "./style";

type StyledElement = Element & { readonly style: CSSStyleDeclaration };
type UnknownRecord = Record<string, unknown>;
type MotionProperty =
  | "opacity"
  | "translateX"
  | "translateY"
  | "translateZ"
  | "scaleX"
  | "scaleY"
  | "rotateZ"
  | "borderRadius";

type NativeConditionState = Record<WebPresentationCondition, boolean>;

type PresenceState = {
  visible: boolean;
  transitioning: boolean;
  revision: number;
};

type DesiredMotion =
  | { readonly kind: "direct"; readonly value: number }
  | {
      readonly kind: "target";
      readonly value: number;
      readonly velocity?: number;
      readonly from?: number;
      readonly transition: string;
      readonly outcome: Promise<unknown>;
    };

type PoppedPresenceStyles = Readonly<{
  position: string;
  inset: string;
  insetInlineStart: string;
  insetBlockStart: string;
  inlineSize: string;
  blockSize: string;
}>;

export type WebPresentationAdapterOptions = Readonly<{
  motionBackend?: MotionBackend;
  layoutBackend?: LayoutBackend;
  scheduler?: MotionScheduler;
  suppressInitialEnter?: boolean;
}>;

type MediaObservation = {
  readonly value: Signal<boolean>;
  readonly release: () => void;
};

const sharedMedia = new Map<
  string,
  {
    readonly value: Signal<boolean>;
    readonly media: MediaQueryList;
    readonly change: () => void;
    references: number;
  }
>();

let nextSessionIdentity = 0;

/** Implements the web presentation language with native styles and retained motion. */
export function createWebPresentationAdapter<Theme extends WebPresentationTheme>(
  options: WebPresentationAdapterOptions = {},
): PresentationAdapter<WebPresentationLanguage<Theme>, Element> {
  const claimedIdentities = new Map<string, Element>();

  return {
    create<const Part extends string>(input: {
      readonly boundary: Element;
      readonly parts: PresentationTargets<Part, Element>;
    }): PresentationAdapterSession<WebPresentationLanguage<Theme>, Part> {
      return createWebPresentationSession(input, options, claimedIdentities);
    },
  };
}

function createWebPresentationSession<Theme extends WebPresentationTheme, Part extends string>(
  input: {
    readonly boundary: Element;
    readonly parts: PresentationTargets<Part, Element>;
  },
  options: WebPresentationAdapterOptions,
  claimedIdentities: Map<string, Element>,
): PresentationAdapterSession<WebPresentationLanguage<Theme>, Part> {
  const sessionIdentity = `presentation-${nextSessionIdentity++}`;
  const cleanups: Array<() => void> = [];
  const styles = new Map<StyledElement, Map<string, string>>();
  const resources = new Map<Element, string | null>();
  const hidden = new Map<Element, boolean>();
  const lifecycles = new Map<Element, string | null>();
  const presenceLayouts = new Map<Element, string | null>();
  const poppedPresence = new Map<HTMLElement, PoppedPresenceStyles>();
  const layers = new Map<Element, Map<string, Element>>();
  const presence = new Map<Element, PresenceState>();
  const conditions = new Map<Element, NativeConditionState>();
  const targetIdentities = new WeakMap<Element, number>();
  const sharedIdentities = new Map<Element, string>();
  const composers = new WeakMap<StyledElement, RetainedTransformComposer>();
  const bindings = new Map<
    string,
    { readonly element: StyledElement; readonly property: MotionProperty }
  >();
  const desiredMotion = new Map<string, DesiredMotion>();
  const sessionClaims = new Set<string>();
  let nextTargetIdentity = 0;
  let disposed = false;
  let conditionCommitQueued = false;
  let lastDeclarations: Readonly<
    Partial<Record<Part, Readonly<WebPresentationDeclaration<Theme>>>>
  > = {} as Readonly<Partial<Record<Part, Readonly<WebPresentationDeclaration<Theme>>>>>;

  const identityFor = (target: Element): number => {
    const current = targetIdentities.get(target);
    if (current !== undefined) return current;
    const identity = nextTargetIdentity++;
    targetIdentities.set(target, identity);
    return identity;
  };
  const renderMotion = (key: string, value: number): void => {
    const binding = bindings.get(key);
    if (!binding || !binding.element.isConnected) return;
    if (binding.property === "opacity") {
      binding.element.style.opacity = String(value);
      return;
    }
    if (binding.property === "borderRadius") {
      binding.element.style.borderRadius = `${value}px`;
      return;
    }
    const composer = composers.get(binding.element) ?? new RetainedTransformComposer();
    composers.set(binding.element, composer);
    binding.element.style.transform = composer.set(binding.property as TransformChannel, value);
  };
  const anime = options.motionBackend ?? createAnimeMotionBackend({ render: renderMotion });
  const waapi = createWaapiMotionBackend({
    render: renderMotion,
    target(key) {
      const binding = bindings.get(key);
      return binding?.property === "opacity"
        ? { element: binding.element as HTMLElement, property: "opacity" }
        : undefined;
    },
  });
  const motion = new RetainedMotionGraph(
    options.motionBackend
      ? anime
      : createAdaptiveMotionBackend({
          anime,
          waapi,
          decide(key, transition) {
            return resolveMotionBackend({
              property: bindings.get(key)?.property ?? "unknown",
              transition,
              continuous: transition === "instant",
              continuity: transition === "instant" ? "replace" : "preserve",
              layout: false,
              snapshotSafe: false,
              liveContent: true,
              waapi: typeof Element !== "undefined" && "animate" in Element.prototype,
              viewTransition: false,
            });
          },
        }),
    options.scheduler,
  );
  const layout = new RetainedLayoutGraph(
    options.layoutBackend ?? createAnimeLayoutBackend(),
    options.scheduler,
  );
  const context = createWebPresentationContext(input.boundary, cleanups);
  let currentMotionKeys = new Set<string>();
  let currentLayoutKeys = new Set<string>();

  const keyFor = (part: string, target: Element, property: MotionProperty | "layout") =>
    `${sessionIdentity}/${part}/${identityFor(target)}/${property}`;
  const targetsFor = (part: Part): readonly Element[] => input.parts[part]?.() ?? [];

  const session: PresentationAdapterSession<WebPresentationLanguage<Theme>, Part> = {
    platform: context,
    commit(declarations) {
      if (disposed) throw new Error("Cannot commit a disposed web presentation session.");
      lastDeclarations = declarations;
      synchronizeSharedIdentities(declarations);
      const nextMotionKeys = new Set<string>();
      const nextLayoutKeys = new Set<string>();
      const layoutProjects: Array<{
        key: string;
        element: HTMLElement;
        transition: MotionTransition;
      }> = [];

      for (const part of Object.keys(input.parts) as Part[]) {
        const authored = declarations[part] as WebPresentationDeclaration<Theme> | undefined;
        for (const target of targetsFor(part)) {
          observeNativeConditions(target, authored);
          const declaration = resolveNativeConditions(authored, conditions.get(target));
          applyStructuralPresenceLayout(target, declaration?.motion?.presence, poppedPresence);
          if (!declaration) {
            applyOwnedStyles(target, {}, styles);
            applyResource(target, undefined, resources);
            applyLayers(target, [], layers, styles);
            applyPresenceLifecycle(target, undefined, lifecycles, presenceLayouts);
            continue;
          }
          const transition = declaration.motion?.layout;
          if (
            transition !== undefined &&
            transition !== "instant" &&
            retainsVisibleLayout(target, declaration.motion?.presence, presence.get(target)) &&
            typeof HTMLElement !== "undefined" &&
            target instanceof HTMLElement
          ) {
            const key = keyFor(part, target, "layout");
            const registering = !currentLayoutKeys.has(key);
            if (registering) {
              layout.register(
                key,
                sessionIdentity,
                target,
                [...target.children].filter(isHTMLElement),
              );
            }
            nextLayoutKeys.add(key);
            if (!registering) layoutProjects.push({ key, element: target, transition });
          }
        }
      }
      for (const part of Object.keys(input.parts) as Part[]) {
        const authored = declarations[part] as WebPresentationDeclaration<Theme> | undefined;
        for (const target of targetsFor(part)) {
          const declaration = resolveNativeConditions(authored, conditions.get(target));
          applyOwnedStyles(target, translateWebPresentationStyle(declaration ?? {}), styles);
          applyAnchor(target, declaration, input.parts, sessionIdentity, styles);
          applyResource(target, declaration?.resource, resources);
          applyLayers(target, declaration?.layers ?? [], layers, styles);
          applyPresenceLifecycle(
            target,
            declaration?.motion?.presence,
            lifecycles,
            presenceLayouts,
          );
          applyElementMotion(part, target, declaration?.motion, nextMotionKeys);
        }
      }

      for (const project of layoutProjects) {
        void layout.project(
          project.key,
          [...project.element.children].filter(isHTMLElement),
          project.transition,
        );
      }
      for (const key of currentMotionKeys) if (!nextMotionKeys.has(key)) motion.release(key);
      for (const key of currentMotionKeys) if (!nextMotionKeys.has(key)) desiredMotion.delete(key);
      for (const key of currentLayoutKeys) if (!nextLayoutKeys.has(key)) layout.release(key);
      currentMotionKeys = nextMotionKeys;
      currentLayoutKeys = nextLayoutKeys;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion.dispose();
      layout.dispose();
      for (const cleanup of cleanups.reverse()) cleanup();
      for (const [target, owned] of styles) restoreOwnedStyles(target, owned);
      for (const [target, source] of resources) restoreResource(target, source);
      for (const [target, wasHidden] of hidden) {
        if ("hidden" in target) (target as HTMLElement).hidden = wasHidden;
      }
      for (const [target, lifecycle] of lifecycles) {
        if (lifecycle === null) target.removeAttribute("data-motion-lifecycle");
        else target.setAttribute("data-motion-lifecycle", lifecycle);
      }
      for (const [target, layout] of presenceLayouts) {
        if (layout === null) target.removeAttribute("data-motion-layout");
        else target.setAttribute("data-motion-layout", layout);
      }
      for (const owned of layers.values()) for (const layer of owned.values()) layer.remove();
      for (const target of poppedPresence.keys()) restorePoppedPresence(target, poppedPresence);
      for (const identity of sessionClaims) {
        if (claimedIdentities.get(identity)) claimedIdentities.delete(identity);
      }
      styles.clear();
      resources.clear();
      layers.clear();
      presence.clear();
      desiredMotion.clear();
      sharedIdentities.clear();
      conditions.clear();
      lifecycles.clear();
      presenceLayouts.clear();
      poppedPresence.clear();
    },
  };

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => scheduleConditionCommit());
    observer.observe(input.boundary, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-motion-state"],
    });
    cleanups.push(() => observer.disconnect());
  }

  return session;

  function observeNativeConditions(
    target: Element,
    declaration: WebPresentationDeclaration<Theme> | undefined,
  ): void {
    const needsFocusRing = record(declaration?.paint).focusRing !== undefined;
    if (!declaration?.conditions && !needsFocusRing) return;
    const existing = conditions.get(target);
    if (existing) {
      existing.focusVisible = matches(target, ":focus-visible");
      existing.disabled = isDisabled(target);
      return;
    }
    const state: NativeConditionState = {
      hovered: false,
      pressed: false,
      focusVisible: matches(target, ":focus-visible"),
      disabled: isDisabled(target),
    };
    conditions.set(target, state);
    if (!("addEventListener" in target) || typeof target.addEventListener !== "function") return;

    const update = (condition: keyof NativeConditionState, value: boolean) => {
      if (disposed || state[condition] === value) return;
      state[condition] = value;
      scheduleConditionCommit();
    };
    const enter = () => update("hovered", true);
    const leave = () => update("hovered", false);
    const down = () => update("pressed", true);
    const release = () => update("pressed", false);
    const focus = () => update("focusVisible", matches(target, ":focus-visible"));
    const blur = () => update("focusVisible", false);
    target.addEventListener("pointerenter", enter);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointerdown", down);
    target.addEventListener("pointerup", release);
    target.addEventListener("pointercancel", release);
    target.addEventListener("focusin", focus);
    target.addEventListener("focusout", blur);
    const view = target.ownerDocument?.defaultView;
    view?.addEventListener("pointerup", release);
    view?.addEventListener("pointercancel", release);
    cleanups.push(() => {
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointerdown", down);
      target.removeEventListener("pointerup", release);
      target.removeEventListener("pointercancel", release);
      target.removeEventListener("focusin", focus);
      target.removeEventListener("focusout", blur);
      view?.removeEventListener("pointerup", release);
      view?.removeEventListener("pointercancel", release);
    });
  }

  function scheduleConditionCommit(): void {
    if (conditionCommitQueued) return;
    conditionCommitQueued = true;
    queueMicrotask(() => {
      conditionCommitQueued = false;
      if (!disposed) session.commit(lastDeclarations);
    });
  }

  function synchronizeSharedIdentities(
    declarations: Readonly<Partial<Record<Part, Readonly<WebPresentationDeclaration<Theme>>>>>,
  ): void {
    const next = new Map<Element, string>();
    const targets = new Map<string, Element>();
    for (const part of Object.keys(input.parts) as Part[]) {
      const authored = declarations[part];
      for (const target of targetsFor(part)) {
        const identity = resolveNativeConditions(authored, conditions.get(target))?.motion?.identity;
        if (!identity) continue;
        const duplicate = targets.get(identity);
        if (duplicate && duplicate !== target) {
          throw new Error(`Presentation identity ${JSON.stringify(identity)} has multiple targets.`);
        }
        targets.set(identity, target);
        next.set(target, identity);
      }
    }
    for (const [target, identity] of next) {
      const current = claimedIdentities.get(identity);
      const releasedByThisCommit =
        current !== undefined &&
        sharedIdentities.get(current) === identity &&
        next.get(current) !== identity;
      if (current && current !== target && !releasedByThisCommit) {
        throw new Error(`Presentation identity ${JSON.stringify(identity)} has multiple targets.`);
      }
    }
    for (const [target, identity] of sharedIdentities) {
      if (next.get(target) === identity) continue;
      if (claimedIdentities.get(identity) === target) claimedIdentities.delete(identity);
      sessionClaims.delete(identity);
    }
    sharedIdentities.clear();
    for (const [target, identity] of next) {
      sharedIdentities.set(target, identity);
      claimedIdentities.set(identity, target);
      sessionClaims.add(identity);
    }
  }

  function applyElementMotion(
    part: Part,
    target: Element,
    declaration: WebMotionDeclaration<Theme> | undefined,
    nextKeys: Set<string>,
  ): void {
    if (!isStyledElement(target)) return;
    const knownPresence = presence.has(target);
    const state = presence.get(target) ?? {
      visible: false,
      transitioning: false,
      revision: 0,
    };
    const desiredVisible =
      declaration?.presence?.visible === "structure"
        ? target.getAttribute("data-motion-state") !== "exiting"
        : (declaration?.presence?.visible ?? true);
    const entering = desiredVisible && !state.visible;
    const exiting = !desiredVisible && state.visible;
    const initiallyHidden = !knownPresence && !desiredVisible;
    if (entering || exiting) {
      state.visible = desiredVisible;
      state.transitioning = true;
      state.revision += 1;
    }
    const revision = state.revision;
    presence.set(target, state);

    ownVisibility(target);
    if (desiredVisible) showTarget(target, styles);
    else setAdditionalOwnedStyles(target, { pointerEvents: "none" }, styles);

    const values = motionValues(declaration);
    const enterFrom =
      entering && !options.suppressInitialEnter
        ? declaration?.presence?.enter?.from
        : undefined;

    const pending: Promise<unknown>[] = [];
    if (exiting) {
      const transition = declaration?.presence?.transition ?? "instant";
      for (const [property, value] of Object.entries(declaration?.presence?.exit?.to ?? {})) {
        for (const channel of motionProperties(property)) {
          pending.push(
            targetProperty(
              part,
              target,
              channel,
              Number(value),
              transition,
              undefined,
              undefined,
              nextKeys,
            ),
          );
        }
      }
    } else {
      for (const [property, value] of values) {
        const initial = enterMotionValue(enterFrom, property);
        if (typeof value === "number") {
          if (initial === undefined) directProperty(part, target, property, value, nextKeys);
          else {
            pending.push(
              targetProperty(
                part,
                target,
                property,
                value,
                declaration?.presence?.transition ?? "instant",
                undefined,
                initial,
                nextKeys,
              ),
            );
          }
        } else {
          const reduce = declaration?.reduceMotion;
          if (initiallyHidden || (reduce === "instant" && context.preferences.reducedMotion)) {
            directProperty(part, target, property, value.target, nextKeys);
          } else {
            pending.push(
              targetProperty(
                part,
                target,
                property,
                value.target,
                value.transition,
                value.velocity,
                initial,
                nextKeys,
              ),
            );
          }
        }
      }
    }

    if (!desiredVisible && (exiting || initiallyHidden)) {
      if (!pending.length) {
        state.transitioning = false;
        hideTarget(target, styles);
        dispatchMotionFinish(target);
      }
      else {
        void Promise.allSettled(pending).then(() => {
          if (!disposed && presence.get(target)?.revision === revision) {
            state.transitioning = false;
            hideTarget(target, styles);
            dispatchMotionFinish(target);
          }
        });
      }
    } else if (entering) {
      if (!pending.length) state.transitioning = false;
      else {
        void Promise.allSettled(pending).then(() => {
          if (!disposed && presence.get(target)?.revision === revision) {
            state.transitioning = false;
            scheduleConditionCommit();
          }
        });
      }
    }
  }

  function directProperty(
    part: Part,
    target: StyledElement,
    property: MotionProperty,
    value: number,
    nextKeys: Set<string>,
  ): void {
    if (!Number.isFinite(value)) return;
    const key = keyFor(part, target, property);
    ownMotionStyle(target, property);
    bindings.set(key, { element: target, property });
    nextKeys.add(key);
    const previous = desiredMotion.get(key);
    if (previous?.kind === "direct" && previous.value === value) return;
    desiredMotion.set(key, { kind: "direct", value });
    motion.channel(key, sessionIdentity, defaultMotionValue(property)).direct(value);
  }

  function targetProperty(
    part: Part,
    target: StyledElement,
    property: MotionProperty,
    value: number,
    transition: MotionTransition,
    velocity: number | undefined,
    from: number | undefined,
    nextKeys: Set<string>,
  ): Promise<unknown> {
    if (!Number.isFinite(value)) return Promise.resolve();
    const key = keyFor(part, target, property);
    ownMotionStyle(target, property);
    bindings.set(key, { element: target, property });
    nextKeys.add(key);
    const signature = JSON.stringify(transition);
    const previous = desiredMotion.get(key);
    if (
      previous?.kind === "target" &&
      previous.value === value &&
      previous.velocity === velocity &&
      previous.transition === signature
    ) {
      return previous.outcome;
    }
    const outcome = motion
      .channel(key, sessionIdentity, currentMotionValue(target, property))
      .target(value, transition, {
        ...(velocity === undefined ? {} : { velocity }),
        ...(from === undefined ? {} : { from }),
      });
    desiredMotion.set(key, {
      kind: "target",
      value,
      ...(velocity === undefined ? {} : { velocity }),
      ...(from === undefined ? {} : { from }),
      transition: signature,
      outcome,
    });
    return outcome;
  }

  function ownVisibility(target: Element): void {
    if (!hidden.has(target) && "hidden" in target) {
      hidden.set(target, Boolean((target as HTMLElement).hidden));
    }
  }

  function ownMotionStyle(target: StyledElement, property: MotionProperty): void {
    ownStyleProperty(
      target,
      property === "opacity"
        ? "opacity"
        : property === "borderRadius"
          ? "borderRadius"
          : "transform",
      styles,
    );
  }
}

function retainsVisibleLayout<Theme extends WebPresentationTheme>(
  target: Element,
  next: WebMotionDeclaration<Theme>["presence"] | undefined,
  previous: PresenceState | undefined,
): boolean {
  if (!next) return true;
  const visible =
    next.visible === "structure"
      ? target.getAttribute("data-motion-state") !== "exiting"
      : (next.visible ?? true);
  return visible && previous?.visible === true && !previous.transitioning;
}

function resolveNativeConditions<Theme extends WebPresentationTheme>(
  declaration: WebPresentationDeclaration<Theme> | undefined,
  state: NativeConditionState | undefined,
): WebPresentationDeclaration<Theme> | undefined {
  if (!declaration) return undefined;
  const { conditions, ...base } = declaration;
  let resolved = base as WebPresentationDeclaration<Theme>;
  if (state && conditions) {
    for (const condition of ["hovered", "pressed", "focusVisible", "disabled"] as const) {
      if (state[condition] && conditions[condition]) {
        resolved = mergeDeclarations(resolved, conditions[condition]!);
      }
    }
  }
  const paint = record(resolved.paint);
  if (paint.focusRing !== undefined && paint.focusRing !== "none" && !state?.focusVisible) {
    const nextPaint = { ...paint };
    delete nextPaint.focusRing;
    resolved = { ...resolved, paint: nextPaint } as WebPresentationDeclaration<Theme>;
  }
  return resolved;
}

function mergeDeclarations<Theme extends WebPresentationTheme>(
  base: WebPresentationDeclaration<Theme>,
  override: object,
): WebPresentationDeclaration<Theme> {
  return mergeRecords(base as UnknownRecord, override as UnknownRecord) as WebPresentationDeclaration<Theme>;
}

function mergeRecords(base: UnknownRecord, override: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = { ...base };
  for (const [name, value] of Object.entries(override)) {
    const current = result[name];
    result[name] = isMergeableRecord(current) && isMergeableRecord(value)
      ? mergeRecords(current, value)
      : value;
  }
  return result;
}

function isMergeableRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matches(target: Element, selector: string): boolean {
  try {
    return typeof target.matches === "function" && target.matches(selector);
  } catch {
    return false;
  }
}

function isDisabled(target: Element): boolean {
  return (
    ("disabled" in target && Boolean((target as HTMLButtonElement).disabled)) ||
    target.getAttribute("aria-disabled") === "true"
  );
}

function createWebPresentationContext(
  boundary: Element,
  cleanups: Array<() => void>,
): WebPresentationContext {
  const size = createAllocatedSize(boundary, cleanups);
  const media = (query: string): (() => boolean) => {
    let observation: MediaObservation | undefined;
    return () => {
      observation ??= observeMedia(query);
      if (observation && !cleanups.includes(observation.release))
        cleanups.push(observation.release);
      return observation.value();
    };
  };
  const reducedMotion = media("(prefers-reduced-motion: reduce)");
  const moreContrast = media("(prefers-contrast: more)");
  const forcedColors = media("(forced-colors: active)");
  const dark = media("(prefers-color-scheme: dark)");
  const hover = media("(hover: hover)");
  const finePointer = media("(pointer: fine)");
  const coarsePointer = media("(pointer: coarse)");

  return {
    allocated: {
      get inlineSize() {
        return size().inlineSize;
      },
      get blockSize() {
        return size().blockSize;
      },
    },
    preferences: {
      get reducedMotion() {
        return reducedMotion();
      },
      get moreContrast() {
        return moreContrast();
      },
      get forcedColors() {
        return forcedColors();
      },
      get dark() {
        return dark();
      },
    },
    input: {
      get hover() {
        return hover();
      },
      get finePointer() {
        return finePointer();
      },
      get coarsePointer() {
        return coarsePointer();
      },
    },
  };
}

function createAllocatedSize(
  boundary: Element,
  cleanups: Array<() => void>,
): Signal<Readonly<{ inlineSize: number; blockSize: number }>> {
  const read = () => {
    const rectangle = boundary.getBoundingClientRect();
    return { inlineSize: rectangle.width, blockSize: rectangle.height };
  };
  const value = signal(read());
  let observer: ResizeObserver | undefined;
  let frame: number | undefined;
  const observe = () => {
    if (observer || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const next = read();
        const current = value();
        if (next.inlineSize !== current.inlineSize || next.blockSize !== current.blockSize) {
          value(next);
        }
      });
    });
    observer.observe(boundary);
    cleanups.push(() => {
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  };
  return (() => {
    observe();
    return value();
  }) as Signal<Readonly<{ inlineSize: number; blockSize: number }>>;
}

function observeMedia(query: string): MediaObservation {
  const existing = sharedMedia.get(query);
  if (existing) {
    existing.references += 1;
    return { value: existing.value, release: () => releaseMedia(query, existing) };
  }
  const media = matchMedia(query);
  const value = signal(media.matches);
  const change = () => value(media.matches);
  media.addEventListener("change", change);
  const observation = { value, media, change, references: 1 };
  sharedMedia.set(query, observation);
  return { value, release: () => releaseMedia(query, observation) };
}

function applyPresenceLifecycle<Theme extends WebPresentationTheme>(
  target: Element,
  presence: WebMotionDeclaration<Theme>["presence"] | undefined,
  lifecycleRecords: Map<Element, string | null>,
  layoutRecords: Map<Element, string | null>,
): void {
  if (!lifecycleRecords.has(target)) {
    lifecycleRecords.set(target, target.getAttribute("data-motion-lifecycle"));
  }
  if (!layoutRecords.has(target)) {
    layoutRecords.set(target, target.getAttribute("data-motion-layout"));
  }
  if (presence?.exit) target.setAttribute("data-motion-lifecycle", "enter exit exit-finished");
  else {
    const previous = lifecycleRecords.get(target);
    if (previous === null || previous === undefined) target.removeAttribute("data-motion-lifecycle");
    else target.setAttribute("data-motion-lifecycle", previous);
  }
  if (presence?.layout) target.setAttribute("data-motion-layout", presence.layout);
  else {
    const previous = layoutRecords.get(target);
    if (previous === null || previous === undefined) target.removeAttribute("data-motion-layout");
    else target.setAttribute("data-motion-layout", previous);
  }
}

function applyStructuralPresenceLayout<Theme extends WebPresentationTheme>(
  target: Element,
  presence: WebMotionDeclaration<Theme>["presence"] | undefined,
  records: Map<HTMLElement, PoppedPresenceStyles>,
): void {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return;
  const exiting =
    presence?.visible === "structure" && target.getAttribute("data-motion-state") === "exiting";
  if (presence?.layout !== "pop" || !exiting) {
    restorePoppedPresence(target, records);
    return;
  }
  if (records.has(target) || target.style.position === "absolute") return;
  const parent = target.parentElement;
  if (!parent) return;
  const rectangle = target.getBoundingClientRect();
  const parentRectangle = parent.getBoundingClientRect();
  records.set(target, {
    position: target.style.position,
    inset: target.style.inset,
    insetInlineStart: target.style.insetInlineStart,
    insetBlockStart: target.style.insetBlockStart,
    inlineSize: target.style.inlineSize,
    blockSize: target.style.blockSize,
  });
  target.style.position = "absolute";
  target.style.inset = "auto";
  target.style.insetInlineStart = `${rectangle.left - parentRectangle.left}px`;
  target.style.insetBlockStart = `${rectangle.top - parentRectangle.top}px`;
  target.style.inlineSize = `${rectangle.width}px`;
  target.style.blockSize = `${rectangle.height}px`;
}

function restorePoppedPresence(
  target: HTMLElement,
  records: Map<HTMLElement, PoppedPresenceStyles>,
): void {
  const previous = records.get(target);
  if (!previous) return;
  records.delete(target);
  target.style.position = previous.position;
  target.style.inset = previous.inset;
  target.style.insetInlineStart = previous.insetInlineStart;
  target.style.insetBlockStart = previous.insetBlockStart;
  target.style.inlineSize = previous.inlineSize;
  target.style.blockSize = previous.blockSize;
}

function dispatchMotionFinish(target: Element): void {
  if (typeof target.dispatchEvent === "function" && typeof Event !== "undefined") {
    target.dispatchEvent(new Event("poggersmotionfinish"));
  }
}

function releaseMedia(query: string, observation: NonNullable<ReturnType<typeof sharedMedia.get>>) {
  observation.references -= 1;
  if (observation.references > 0) return;
  observation.media.removeEventListener("change", observation.change);
  sharedMedia.delete(query);
}

function applyOwnedStyles(
  target: Element,
  next: Readonly<Record<string, string>>,
  records: Map<StyledElement, Map<string, string>>,
): void {
  if (!isStyledElement(target)) return;
  const owned = records.get(target) ?? new Map<string, string>();
  records.set(target, owned);
  for (const property of owned.keys()) {
    if (!(property in next)) {
      setStyle(target.style, property, owned.get(property) ?? "");
      owned.delete(property);
    }
  }
  for (const [property, value] of Object.entries(next)) {
    if (!owned.has(property)) owned.set(property, readStyle(target.style, property));
    setStyle(target.style, property, value);
  }
}

function setAdditionalOwnedStyles(
  target: Element,
  next: Readonly<Record<string, string>>,
  records: Map<StyledElement, Map<string, string>>,
): void {
  if (!isStyledElement(target)) return;
  for (const [property, value] of Object.entries(next)) {
    ownStyleProperty(target, property, records);
    setStyle(target.style, property, value);
  }
}

function ownStyleProperty(
  target: StyledElement,
  property: string,
  records: Map<StyledElement, Map<string, string>>,
): void {
  const owned = records.get(target) ?? new Map<string, string>();
  records.set(target, owned);
  if (!owned.has(property)) owned.set(property, readStyle(target.style, property));
}

function restoreOwnedStyles(target: StyledElement, owned: Map<string, string>): void {
  for (const [property, value] of owned) setStyle(target.style, property, value);
}

function applyAnchor<Part extends string, Theme extends WebPresentationTheme>(
  target: Element,
  declaration: WebPresentationDeclaration<Theme> | undefined,
  parts: PresentationTargets<Part, Element>,
  session: string,
  styles: Map<StyledElement, Map<string, string>>,
): void {
  const reference = record(record(declaration?.layout).position).anchor;
  if (!reference || typeof reference !== "object") return;
  const name = String(record(reference).name ?? "");
  if (!name || !(name in parts)) return;
  const anchor = parts[name as Part]?.()[0];
  if (!isStyledElement(anchor) || !isStyledElement(target)) return;
  const anchorName = `--${session}-${name.toLowerCase()}`;
  setAdditionalOwnedStyles(anchor, { anchorName }, styles);
  setAdditionalOwnedStyles(target, { positionAnchor: anchorName }, styles);
}

function applyResource(
  target: Element,
  resource: WebPresentationResource | undefined,
  records: Map<Element, string | null>,
): void {
  if (!records.has(target)) records.set(target, target.getAttribute("src"));
  if (!resource) {
    restoreResource(target, records.get(target) ?? null);
    return;
  }
  if (resource.kind === "image" || resource.kind === "symbol") {
    target.setAttribute("src", resource.source);
  }
}

function restoreResource(target: Element, source: string | null): void {
  if (source === null) target.removeAttribute("src");
  else target.setAttribute("src", source);
}

function applyLayers<Theme extends WebPresentationTheme>(
  target: Element,
  definitions: readonly WebRenderLayer<Theme>[],
  records: Map<Element, Map<string, Element>>,
  styles: Map<StyledElement, Map<string, string>>,
): void {
  const current = records.get(target) ?? new Map<string, Element>();
  records.set(target, current);
  const expected = new Set(definitions.map(({ id }) => id));
  for (const [id, layer] of current) {
    if (!expected.has(id)) {
      layer.remove();
      current.delete(id);
    }
  }
  for (const definition of definitions) {
    let layer = current.get(definition.id);
    if (!layer) {
      const document = target.ownerDocument;
      layer =
        definition.resource?.kind === "shader"
          ? document.createElement("canvas")
          : document.createElement("div");
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute("data-presentation-layer", definition.id);
      (layer as HTMLElement).inert = true;
      Object.assign((layer as HTMLElement).style, {
        inset: "0",
        pointerEvents: "none",
        position: "absolute",
        zIndex: definition.placement === "background" ? "-1" : "1",
      });
      if (definition.placement === "background") target.prepend(layer);
      else target.append(layer);
      current.set(definition.id, layer);
    }
    if (definition.resource?.kind === "image" || definition.resource?.kind === "symbol") {
      (layer as HTMLElement).style.backgroundImage =
        `url(${JSON.stringify(definition.resource.source)})`;
    }
    if (definition.resource?.kind === "shader") {
      layer.setAttribute("data-shader", definition.resource.source);
    }
    if (definition.visual) {
      applyOwnedStyles(layer, translateWebPresentationStyle(definition.visual), styles);
    }
    for (const [name, value] of Object.entries(definition.uniforms ?? {})) {
      (layer as HTMLElement).style.setProperty(
        `--uniform-${name}`,
        Array.isArray(value) ? value.join(" ") : String(value),
      );
    }
  }
}

function motionValues<Theme extends WebPresentationTheme>(
  declaration: WebMotionDeclaration<Theme> | undefined,
): readonly [MotionProperty, WebMotionValue<Theme>][] {
  if (!declaration) return [];
  const result: Array<[MotionProperty, WebMotionValue<Theme>]> = [];
  if (declaration.opacity !== undefined) result.push(["opacity", declaration.opacity]);
  if (declaration.translation?.inline !== undefined) {
    result.push(["translateX", declaration.translation.inline]);
  }
  if (declaration.translation?.block !== undefined) {
    result.push(["translateY", declaration.translation.block]);
  }
  if (declaration.translation?.depth !== undefined) {
    result.push(["translateZ", declaration.translation.depth]);
  }
  if (declaration.scale !== undefined) {
    result.push(["scaleX", declaration.scale], ["scaleY", declaration.scale]);
  }
  if (declaration.scaleInline !== undefined) result.push(["scaleX", declaration.scaleInline]);
  if (declaration.scaleBlock !== undefined) result.push(["scaleY", declaration.scaleBlock]);
  if (declaration.rotate !== undefined) result.push(["rotateZ", declaration.rotate]);
  if (declaration.radius !== undefined) result.push(["borderRadius", declaration.radius]);
  return result;
}

function motionProperties(property: string): readonly MotionProperty[] {
  const values = {
    scale: ["scaleX", "scaleY"],
  }[property] ?? [
    {
    opacity: "opacity",
    inline: "translateX",
    block: "translateY",
    depth: "translateZ",
    scale: "scaleX",
    scaleInline: "scaleX",
    scaleBlock: "scaleY",
    rotate: "rotateZ",
    radius: "borderRadius",
    }[property] as MotionProperty,
  ];
  return values.filter((value): value is MotionProperty => value !== undefined);
}

function enterMotionValue(
  from: object | undefined,
  property: MotionProperty,
): number | undefined {
  const values = record(from);
  const names = {
    opacity: ["opacity"],
    translateX: ["inline"],
    translateY: ["block"],
    translateZ: ["depth"],
    scaleX: ["scaleInline", "scale"],
    scaleY: ["scaleBlock", "scale"],
    rotateZ: ["rotate"],
    borderRadius: ["radius"],
  }[property];
  for (const name of names) {
    const value = Number(values[name]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function defaultMotionValue(property: MotionProperty): number {
  return property === "opacity" || property === "scaleX" || property === "scaleY" ? 1 : 0;
}

function currentMotionValue(target: StyledElement, property: MotionProperty): number {
  if (property === "opacity") {
    const value = Number.parseFloat(target.style.opacity);
    return Number.isFinite(value) ? value : 1;
  }
  if (property === "borderRadius") {
    const value = Number.parseFloat(target.style.borderRadius);
    return Number.isFinite(value) ? value : 0;
  }
  return defaultMotionValue(property);
}

function showTarget(target: Element, styles: Map<StyledElement, Map<string, string>>): void {
  if ("hidden" in target) (target as HTMLElement).hidden = false;
  if (typeof HTMLDialogElement !== "undefined" && target instanceof HTMLDialogElement) {
    if (!target.open) target.showModal();
  }
  setAdditionalOwnedStyles(target, { pointerEvents: "" }, styles);
}

function hideTarget(target: Element, styles: Map<StyledElement, Map<string, string>>): void {
  if (typeof HTMLDialogElement !== "undefined" && target instanceof HTMLDialogElement) {
    if (target.open) target.close();
  }
  if ("hidden" in target) (target as HTMLElement).hidden = true;
  setAdditionalOwnedStyles(target, { pointerEvents: "none" }, styles);
}

function isStyledElement(value: unknown): value is StyledElement {
  return value !== null && typeof value === "object" && "style" in value;
}

function isHTMLElement(value: Element): value is HTMLElement {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function readStyle(style: CSSStyleDeclaration, property: string): string {
  return String((style as unknown as UnknownRecord)[property] ?? "");
}

function setStyle(style: CSSStyleDeclaration, property: string, value: string): void {
  (style as unknown as UnknownRecord)[property] = value;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}
