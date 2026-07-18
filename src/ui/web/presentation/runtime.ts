import type {
  PresentationAdapter,
  PresentationAdapterSession,
  PresentationTargetSources,
} from "../../presentation";
import {
  bindVirtualCollectionHost,
  unbindVirtualCollectionHost,
  type VirtualCollectionGeometry,
} from "../structure/runtime";
import { createWebFontBackend, webFontKey, type WebFontBackend, type WebFontLease } from "./font";
import type {
  FontAsset,
  WebMotionDeclaration,
  WebMotionValue,
  WebPresentationCondition,
  WebPresentationDeclaration,
  WebPresentationLanguage,
  WebPresentationResource,
  WebPresentationTokens,
  WebRenderLayer,
  WebTargetCondition,
} from "./language";
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
} from "./motion";
import { translateWebPresentationStyle } from "./style";

type StyledElement = Element & { readonly style: CSSStyleDeclaration };
type UnknownRecord = Record<string, unknown>;
type MotionProperty =
  | "opacity"
  | "translateX"
  | "translateY"
  | "translateZ"
  | "layoutTranslateX"
  | "layoutTranslateY"
  | "scaleX"
  | "scaleY"
  | "layoutScaleX"
  | "layoutScaleY"
  | "rotateZ"
  | "borderRadius";

type NativeConditionState = Record<WebTargetCondition, boolean>;

type WebConditionEnvironment = Readonly<{
  allocated: Readonly<{ inlineSize: number; blockSize: number }>;
  preferences: Readonly<{
    reducedMotion: boolean;
    moreContrast: boolean;
    forcedColors: boolean;
    dark: boolean;
  }>;
  pointer: Readonly<{ hover: boolean; fine: boolean; coarse: boolean }>;
}>;

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
  fontBackend?: WebFontBackend;
  scheduler?: MotionScheduler;
  suppressInitialEnter?: boolean;
}>;

type MediaObservation = {
  readonly read: () => boolean;
  readonly release: () => void;
};

type PreparedTarget<ElementName extends string, Theme extends WebPresentationTokens> = Readonly<{
  elementName: ElementName;
  target: Element;
  authored: WebPresentationDeclaration<Theme> | undefined;
  declaration: WebPresentationDeclaration<Theme> | undefined;
  style: Readonly<Record<string, string>>;
}>;

type SharedGeometry = Readonly<{
  target: Element;
  rectangle: DOMRect;
}>;

type SharedIdentityClaim = Readonly<{
  owner: string;
  target: Element;
}>;

type SharedIdentityCoordinator = ReturnType<typeof createSharedIdentityCoordinator>;

let nextSessionIdentity = 0;
const defaultFontBackend = createWebFontBackend();

/** Implements the web presentation language with native styles and retained motion. */
export function createWebPresentationAdapter<Theme extends WebPresentationTokens>(
  options: WebPresentationAdapterOptions = {},
): PresentationAdapter<WebPresentationLanguage<Theme>, Element> {
  const sharedIdentityCoordinator = createSharedIdentityCoordinator(options);

  return {
    create<const ElementName extends string>(input: {
      readonly boundary: Element;
      readonly targets: PresentationTargetSources<ElementName, Element>;
    }): PresentationAdapterSession<WebPresentationLanguage<Theme>, ElementName> {
      return createWebPresentationSession(input, options, sharedIdentityCoordinator);
    },
  };
}

function createSharedIdentityCoordinator(options: WebPresentationAdapterOptions) {
  const claims = new Map<string, SharedIdentityClaim>();
  const geometries = new Map<string, SharedGeometry>();

  const requestFrame = (callback: () => void): unknown =>
    options.scheduler ? options.scheduler.requestFrame(callback) : requestAnimationFrame(callback);

  return {
    claim(identity: string): SharedIdentityClaim | undefined {
      return claims.get(identity);
    },
    geometry(identity: string): SharedGeometry | undefined {
      return geometries.get(identity);
    },
    acquire(identity: string, owner: string, target: Element): void {
      claims.set(identity, { owner, target });
    },
    release(identity: string, owner: string, target: Element): void {
      const current = claims.get(identity);
      if (current?.owner !== owner || current.target !== target) return;
      claims.delete(identity);
      requestFrame(() => {
        if (!claims.has(identity)) geometries.delete(identity);
      });
    },
    capture(identity: string, target: Element, rectangle: DOMRect): void {
      geometries.set(identity, { target, rectangle });
    },
  };
}

function createWebPresentationSession<
  Theme extends WebPresentationTokens,
  ElementName extends string,
>(
  input: {
    readonly boundary: Element;
    readonly targets: PresentationTargetSources<ElementName, Element>;
  },
  options: WebPresentationAdapterOptions,
  sharedIdentityCoordinator: SharedIdentityCoordinator,
): PresentationAdapterSession<WebPresentationLanguage<Theme>, ElementName> {
  const sessionIdentity = `presentation-${nextSessionIdentity++}`;
  const cleanups: Array<() => void> = [];
  const styles = new Map<StyledElement, Map<string, string>>();
  const resources = new Map<Element, string | null>();
  const fontLeases = new Map<string, WebFontLease>();
  const hidden = new Map<Element, boolean>();
  const lifecycles = new Map<Element, string | null>();
  const presenceLayouts = new Map<Element, string | null>();
  const poppedPresence = new Map<HTMLElement, PoppedPresenceStyles>();
  const layers = new Map<Element, Map<string, Element>>();
  const presence = new Map<Element, PresenceState>();
  const conditions = new Map<Element, NativeConditionState>();
  const conditionCleanups = new Map<Element, () => void>();
  const targetIdentities = new WeakMap<Element, number>();
  const sharedIdentities = new Map<Element, string>();
  const composers = new WeakMap<StyledElement, RetainedTransformComposer>();
  const bindings = new Map<
    string,
    { readonly element: StyledElement; readonly property: MotionProperty }
  >();
  const desiredMotion = new Map<string, DesiredMotion>();
  const collectionHosts = new Set<HTMLElement>();
  const activeSharedTransfers = new Map<Element, { revision: number; keys: Set<string> }>();
  let nextSharedTransferRevision = 0;
  let nextTargetIdentity = 0;
  let disposed = false;
  let conditionCommitQueued = false;
  let lastDeclarations: Readonly<
    Partial<Record<ElementName, Readonly<WebPresentationDeclaration<Theme>>>>
  > = {} as Readonly<Partial<Record<ElementName, Readonly<WebPresentationDeclaration<Theme>>>>>;

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
              continuity: "replace",
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
  const environment = createWebConditionEnvironment(
    input.boundary,
    cleanups,
    scheduleConditionCommit,
    options.scheduler,
  );
  let currentMotionKeys = new Set<string>();
  let currentLayoutKeys = new Set<string>();
  let activeTargets = new Set<Element>();

  const keyFor = (elementName: string, target: Element, property: MotionProperty | "layout") =>
    `${sessionIdentity}/${elementName}/${identityFor(target)}/${property}`;
  const session: PresentationAdapterSession<WebPresentationLanguage<Theme>, ElementName> = {
    commit(declarations) {
      if (disposed) throw new Error("Cannot commit a disposed web presentation session.");
      lastDeclarations = declarations;
      const resolvedTargets = resolveTargets();
      const prepared = prepareTargets(declarations, resolvedTargets);
      const transfers = sharedTransfers(prepared);
      synchronizeSharedIdentities(prepared);
      synchronizeTargets(new Set(prepared.map(({ target }) => target)));
      const nextMotionKeys = new Set<string>();
      const nextLayoutKeys = new Set<string>();
      const nextFonts = new Map<string, FontAsset>();
      const layoutProjects: Array<{
        key: string;
        element: HTMLElement;
        transition: MotionTransition;
      }> = [];

      for (const { elementName, target, authored, declaration } of prepared) {
        observeNativeConditions(target, authored);
        applyCollectionGeometry(target, declaration);
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
          const key = keyFor(elementName, target, "layout");
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
      for (const { elementName, target, declaration, style } of prepared) {
        const font = declaration?.typography?.font;
        if (font?.sources?.length) nextFonts.set(webFontKey(font), font);
        applyOwnedStyles(target, style, styles);
        applyAnchor(target, declaration, resolvedTargets, sessionIdentity, styles);
        applyResource(target, declaration?.resource, resources);
        applyLayers(target, declaration?.layers ?? [], layers, styles);
        applyPresenceLifecycle(target, declaration?.motion?.presence, lifecycles, presenceLayouts);
        applyElementMotion(elementName, target, declaration?.motion, nextMotionKeys);
      }
      applySharedTransfers(transfers, nextMotionKeys);
      captureSharedGeometry(prepared);
      for (const transfer of activeSharedTransfers.values()) {
        for (const key of transfer.keys) nextMotionKeys.add(key);
      }

      for (const project of layoutProjects) {
        void layout.project(
          project.key,
          [...project.element.children].filter(isHTMLElement),
          project.transition,
        );
      }
      synchronizeFonts(nextFonts);
      for (const key of currentMotionKeys) {
        if (nextMotionKeys.has(key)) continue;
        motion.release(key);
        desiredMotion.delete(key);
        bindings.delete(key);
      }
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
      for (const cleanup of conditionCleanups.values()) cleanup();
      for (const target of collectionHosts) unbindVirtualCollectionHost(target);
      for (const [target, owned] of styles) restoreOwnedStyles(target, owned);
      for (const [target, source] of resources) restoreResource(target, source);
      for (const lease of fontLeases.values()) lease.release();
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
      for (const [target, identity] of sharedIdentities) {
        sharedIdentityCoordinator.release(identity, sessionIdentity, target);
      }
      styles.clear();
      resources.clear();
      fontLeases.clear();
      layers.clear();
      presence.clear();
      desiredMotion.clear();
      activeSharedTransfers.clear();
      collectionHosts.clear();
      sharedIdentities.clear();
      conditions.clear();
      conditionCleanups.clear();
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

  function resolveTargets(): ReadonlyMap<ElementName, readonly Element[]> {
    const resolved = new Map<ElementName, readonly Element[]>();
    const owners = new Map<Element, ElementName>();
    for (const elementName of Object.keys(input.targets) as ElementName[]) {
      const targets = [...new Set(input.targets[elementName]?.() ?? [])];
      for (const target of targets) {
        const owner = owners.get(target);
        if (owner !== undefined && owner !== elementName) {
          throw new Error(
            `Presentation target is claimed by two Elements: ${JSON.stringify(owner)} and ${JSON.stringify(elementName)}.`,
          );
        }
        owners.set(target, elementName);
      }
      resolved.set(elementName, targets);
    }
    return resolved;
  }

  function prepareTargets(
    declarations: Readonly<
      Partial<Record<ElementName, Readonly<WebPresentationDeclaration<Theme>>>>
    >,
    targets: ReadonlyMap<ElementName, readonly Element[]>,
  ): readonly PreparedTarget<ElementName, Theme>[] {
    const prepared: PreparedTarget<ElementName, Theme>[] = [];
    for (const elementName of Object.keys(input.targets) as ElementName[]) {
      const authored = declarations[elementName] as WebPresentationDeclaration<Theme> | undefined;
      if (authored) validateWebPresentationDeclaration(authored, String(elementName));
      for (const target of targets.get(elementName) ?? []) {
        const state = refreshNativeConditionState(target, authored);
        const declaration = resolveWebConditions(authored, state, environment);
        prepared.push({
          elementName,
          target,
          authored,
          declaration,
          style: translateWebPresentationStyle(declaration ?? {}),
        });
      }
    }
    return prepared;
  }

  function synchronizeTargets(next: Set<Element>): void {
    for (const target of activeTargets) {
      if (!next.has(target)) releaseTarget(target);
    }
    activeTargets = next;
  }

  function releaseTarget(target: Element): void {
    const conditionCleanup = conditionCleanups.get(target);
    conditionCleanup?.();
    conditionCleanups.delete(target);
    conditions.delete(target);

    if (isStyledElement(target)) {
      const owned = styles.get(target);
      if (owned) restoreOwnedStyles(target, owned);
      styles.delete(target);
      composers.delete(target);
    }
    const source = resources.get(target);
    if (source !== undefined) restoreResource(target, source);
    resources.delete(target);
    const ownedLayers = layers.get(target);
    if (ownedLayers) for (const layer of ownedLayers.values()) removeLayer(layer, styles);
    layers.delete(target);
    const wasHidden = hidden.get(target);
    if (wasHidden !== undefined && "hidden" in target) (target as HTMLElement).hidden = wasHidden;
    hidden.delete(target);
    restoreAttribute(target, "data-motion-lifecycle", lifecycles.get(target));
    restoreAttribute(target, "data-motion-layout", presenceLayouts.get(target));
    lifecycles.delete(target);
    presenceLayouts.delete(target);
    if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
      restorePoppedPresence(target, poppedPresence);
    }
    presence.delete(target);
    activeSharedTransfers.delete(target);
    if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
      unbindVirtualCollectionHost(target);
      collectionHosts.delete(target);
    }
    targetIdentities.delete(target);
  }

  function applyCollectionGeometry(
    target: Element,
    declaration: WebPresentationDeclaration<Theme> | undefined,
  ): void {
    if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return;
    const collection = declaration?.layout?.collection;
    if (!collection) {
      if (collectionHosts.delete(target)) unbindVirtualCollectionHost(target);
      return;
    }
    const geometry: VirtualCollectionGeometry = {
      axis: collection.axis ?? "block",
      estimate: collectionMetric(collection.estimate),
      gap: collection.gap === undefined ? 0 : collectionMetric(collection.gap),
      lanes: collection.lanes ?? 1,
    };
    if (geometry.estimate <= 0) {
      throw new TypeError("Presentation collection estimate must be greater than zero.");
    }
    if (geometry.gap < 0) {
      throw new TypeError("Presentation collection gap cannot be negative.");
    }
    if (!Number.isInteger(geometry.lanes) || geometry.lanes <= 0) {
      throw new TypeError("Presentation collection lanes must be a positive integer.");
    }
    bindVirtualCollectionHost(target, geometry);
    collectionHosts.add(target);
  }

  function refreshNativeConditionState(
    target: Element,
    declaration: WebPresentationDeclaration<Theme> | undefined,
  ): NativeConditionState | undefined {
    if (!needsTargetConditions(declaration)) return conditions.get(target);
    const state = conditions.get(target) ?? {
      hovered: false,
      pressed: false,
      focusVisible: false,
      disabled: false,
    };
    state.focusVisible = matches(target, ":focus-visible");
    state.disabled = isDisabled(target);
    conditions.set(target, state);
    return state;
  }

  function synchronizeFonts(next: ReadonlyMap<string, FontAsset>): void {
    const document = input.boundary.ownerDocument;
    if (!document) return;
    const backend = options.fontBackend ?? defaultFontBackend;
    for (const [key, font] of next) {
      if (!fontLeases.has(key)) fontLeases.set(key, backend.acquire(document, font));
    }
    for (const [key, lease] of fontLeases) {
      if (next.has(key)) continue;
      lease.release();
      fontLeases.delete(key);
    }
  }

  function observeNativeConditions(
    target: Element,
    declaration: WebPresentationDeclaration<Theme> | undefined,
  ): void {
    if (!needsTargetConditions(declaration)) {
      conditionCleanups.get(target)?.();
      conditionCleanups.delete(target);
      conditions.delete(target);
      return;
    }
    const state = refreshNativeConditionState(target, declaration)!;
    if (conditionCleanups.has(target)) return;
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
    conditionCleanups.set(target, () => {
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
    prepared: readonly PreparedTarget<ElementName, Theme>[],
  ): void {
    const next = new Map<Element, string>();
    const targets = new Map<string, Element>();
    for (const { target, declaration } of prepared) {
      const identity = activeSharedIdentity(target, declaration);
      if (!identity) continue;
      const duplicate = targets.get(identity);
      if (duplicate && duplicate !== target) {
        throw new Error(`Presentation identity ${JSON.stringify(identity)} has multiple targets.`);
      }
      targets.set(identity, target);
      next.set(target, identity);
    }
    for (const [target, identity] of next) {
      const current = sharedIdentityCoordinator.claim(identity);
      const releasedByThisCommit =
        current !== undefined &&
        current.owner === sessionIdentity &&
        sharedIdentities.get(current.target) === identity &&
        next.get(current.target) !== identity;
      const enteringHandoff = target.getAttribute("data-motion-state") === "entering";
      if (current && current.target !== target && !releasedByThisCommit && !enteringHandoff) {
        throw new Error(`Presentation identity ${JSON.stringify(identity)} has multiple targets.`);
      }
    }
    for (const [target, identity] of sharedIdentities) {
      if (next.get(target) === identity) continue;
      sharedIdentityCoordinator.release(identity, sessionIdentity, target);
    }
    sharedIdentities.clear();
    for (const [target, identity] of next) {
      sharedIdentities.set(target, identity);
      sharedIdentityCoordinator.acquire(identity, sessionIdentity, target);
    }
  }

  function sharedTransfers(
    prepared: readonly PreparedTarget<ElementName, Theme>[],
  ): readonly Readonly<{
    elementName: ElementName;
    target: Element;
    source: DOMRect;
    transition: MotionTransition;
  }>[] {
    const transfers: Array<{
      elementName: ElementName;
      target: Element;
      source: DOMRect;
      transition: MotionTransition;
    }> = [];
    for (const { elementName, target, declaration } of prepared) {
      const identity = activeSharedIdentity(target, declaration);
      const previous = identity ? sharedIdentityCoordinator.geometry(identity) : undefined;
      if (!previous || previous.target === target) continue;
      transfers.push({
        elementName,
        target,
        source: previous.target.isConnected
          ? previous.target.getBoundingClientRect()
          : previous.rectangle,
        transition:
          declaration?.motion?.layout ?? declaration?.motion?.presence?.transition ?? "instant",
      });
    }
    return transfers;
  }

  function applySharedTransfers(
    transfers: ReturnType<typeof sharedTransfers>,
    nextKeys: Set<string>,
  ): void {
    for (const { elementName, target, source, transition } of transfers) {
      if (!isStyledElement(target)) continue;
      const destination = target.getBoundingClientRect();
      const keys = new Set<string>();
      const outcomes: Promise<unknown>[] = [];
      const channels = [
        ["layoutTranslateX", source.left - destination.left],
        ["layoutTranslateY", source.top - destination.top],
        ["layoutScaleX", destination.width > 0 ? source.width / destination.width : 1],
        ["layoutScaleY", destination.height > 0 ? source.height / destination.height : 1],
      ] as const;
      setAdditionalOwnedStyles(target, { transformOrigin: "top left" }, styles);
      for (const [property, from] of channels) {
        keys.add(keyFor(elementName, target, property));
        outcomes.push(
          targetProperty(
            elementName,
            target,
            property,
            defaultMotionValue(property),
            transition,
            0,
            from,
            nextKeys,
          ),
        );
      }
      const revision = nextSharedTransferRevision++;
      activeSharedTransfers.set(target, { revision, keys });
      void Promise.allSettled(outcomes).then(() => {
        if (disposed || activeSharedTransfers.get(target)?.revision !== revision) return;
        activeSharedTransfers.delete(target);
        scheduleConditionCommit();
      });
    }
  }

  function captureSharedGeometry(prepared: readonly PreparedTarget<ElementName, Theme>[]): void {
    for (const { target, declaration } of prepared) {
      const identity = activeSharedIdentity(target, declaration);
      if (!identity) continue;
      sharedIdentityCoordinator.capture(identity, target, target.getBoundingClientRect());
    }
  }

  function activeSharedIdentity(
    target: Element,
    declaration: WebPresentationDeclaration<Theme> | undefined,
  ): string | undefined {
    return target.getAttribute("data-motion-state") === "exiting"
      ? undefined
      : declaration?.motion?.identity;
  }

  function applyElementMotion(
    elementName: ElementName,
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
    } else if (state.transitioning) {
      // A moving target replaces the previous motion outcome. Only the latest
      // commit may settle presence; a replaced trajectory is not completion.
      state.revision += 1;
    }
    const revision = state.revision;
    presence.set(target, state);

    ownVisibility(target);
    if (desiredVisible) showTarget(target, styles);
    else setAdditionalOwnedStyles(target, { pointerEvents: "none" }, styles);

    const values = motionValues(declaration);
    const enterFrom =
      entering && !options.suppressInitialEnter ? declaration?.presence?.enter?.from : undefined;
    const exitActive = !desiredVisible && state.transitioning;

    const pending: Promise<unknown>[] = [];
    if (exitActive) {
      const transition = declaration?.presence?.transition ?? "instant";
      for (const [property, value] of Object.entries(declaration?.presence?.exit?.to ?? {})) {
        for (const channel of motionProperties(property)) {
          pending.push(
            targetProperty(
              elementName,
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
          if (initial === undefined) directProperty(elementName, target, property, value, nextKeys);
          else {
            pending.push(
              targetProperty(
                elementName,
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
          if (initiallyHidden || (reduce === "instant" && environment.preferences.reducedMotion)) {
            directProperty(elementName, target, property, value.target, nextKeys);
          } else {
            pending.push(
              targetProperty(
                elementName,
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

    if (!desiredVisible && (exitActive || initiallyHidden)) {
      if (!pending.length) {
        state.transitioning = false;
        hideTarget(target, styles);
        dispatchMotionFinish(target);
      } else {
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
    elementName: ElementName,
    target: StyledElement,
    property: MotionProperty,
    value: number,
    nextKeys: Set<string>,
  ): void {
    if (!Number.isFinite(value)) return;
    const key = keyFor(elementName, target, property);
    ownMotionStyle(target, property);
    bindings.set(key, { element: target, property });
    nextKeys.add(key);
    const previous = desiredMotion.get(key);
    if (previous?.kind === "direct" && previous.value === value) return;
    desiredMotion.set(key, { kind: "direct", value });
    motion.channel(key, sessionIdentity, defaultMotionValue(property)).direct(value);
  }

  function targetProperty(
    elementName: ElementName,
    target: StyledElement,
    property: MotionProperty,
    value: number,
    transition: MotionTransition,
    velocity: number | undefined,
    from: number | undefined,
    nextKeys: Set<string>,
  ): Promise<unknown> {
    if (!Number.isFinite(value)) return Promise.resolve();
    const key = keyFor(elementName, target, property);
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

function retainsVisibleLayout<Theme extends WebPresentationTokens>(
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

function resolveWebConditions<Theme extends WebPresentationTokens>(
  declaration: WebPresentationDeclaration<Theme> | undefined,
  state: NativeConditionState | undefined,
  environment: WebConditionEnvironment,
): WebPresentationDeclaration<Theme> | undefined {
  if (!declaration) return undefined;
  const { conditions, ...base } = declaration;
  let resolved = base as WebPresentationDeclaration<Theme>;
  for (const rule of conditions ?? []) {
    if (matchesWebCondition(rule.when, state, environment)) {
      resolved = mergeDeclarations(resolved, rule.use);
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

function matchesWebCondition<Theme extends WebPresentationTokens>(
  condition: WebPresentationCondition<Theme>,
  target: NativeConditionState | undefined,
  environment: WebConditionEnvironment,
): boolean {
  let matches = true;
  for (const [name, expected] of Object.entries(condition.target ?? {}) as Array<
    [WebTargetCondition, boolean]
  >) {
    if ((target?.[name] ?? false) !== expected) matches = false;
  }
  const inline = condition.container?.inline;
  if (inline && !matchesRange(environment.allocated.inlineSize, inline)) matches = false;
  const block = condition.container?.block;
  if (block && !matchesRange(environment.allocated.blockSize, block)) matches = false;
  for (const [name, expected] of Object.entries(condition.preferences ?? {}) as Array<
    [keyof WebConditionEnvironment["preferences"], boolean]
  >) {
    if (environment.preferences[name] !== expected) matches = false;
  }
  for (const [name, expected] of Object.entries(condition.pointer ?? {}) as Array<
    [keyof WebConditionEnvironment["pointer"], boolean]
  >) {
    if (environment.pointer[name] !== expected) matches = false;
  }
  return matches;
}

function matchesRange(value: number, range: Readonly<{ min?: unknown; max?: unknown }>): boolean {
  const minimum = conditionMetric(range.min);
  const maximum = conditionMetric(range.max);
  return (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
}

function conditionMetric(value: unknown): number | undefined {
  if (value === undefined) return;
  if (typeof value === "number") return value;
  const metric = record(value).value;
  return typeof metric === "number" ? metric : undefined;
}

function mergeDeclarations<Theme extends WebPresentationTokens>(
  base: WebPresentationDeclaration<Theme>,
  override: object,
): WebPresentationDeclaration<Theme> {
  const merged = mergeRecords(
    base as UnknownRecord,
    override as UnknownRecord,
  ) as WebPresentationDeclaration<Theme>;
  const overrideLayout = record(record(override).layout);
  const modes = ["flow", "grid", "overlay"].filter((mode) => mode in overrideLayout);
  if (modes.length !== 1) return merged;
  const layout = { ...record(merged.layout) };
  for (const mode of ["flow", "grid", "overlay"]) {
    if (mode !== modes[0]) delete layout[mode];
  }
  return { ...merged, layout } as WebPresentationDeclaration<Theme>;
}

function mergeRecords(base: UnknownRecord, override: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = { ...base };
  for (const [name, value] of Object.entries(override)) {
    const current = result[name];
    result[name] =
      isMergeableRecord(current) && isMergeableRecord(value) ? mergeRecords(current, value) : value;
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

function createWebConditionEnvironment(
  boundary: Element,
  cleanups: Array<() => void>,
  changed: () => void,
  scheduler?: MotionScheduler,
): WebConditionEnvironment {
  const size = createAllocatedSize(boundary, cleanups, changed, scheduler);
  const media = (query: string): (() => boolean) => {
    let observation: MediaObservation | undefined;
    return () => {
      observation ??= observeMedia(boundary, query, changed);
      if (observation && !cleanups.includes(observation.release))
        cleanups.push(observation.release);
      return observation.read();
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
    pointer: {
      get hover() {
        return hover();
      },
      get fine() {
        return finePointer();
      },
      get coarse() {
        return coarsePointer();
      },
    },
  };
}

function createAllocatedSize(
  boundary: Element,
  cleanups: Array<() => void>,
  changed: () => void,
  scheduler?: MotionScheduler,
): () => Readonly<{ inlineSize: number; blockSize: number }> {
  const read = () => {
    const rectangle = boundary.getBoundingClientRect();
    return { inlineSize: rectangle.width, blockSize: rectangle.height };
  };
  let value: Readonly<{ inlineSize: number; blockSize: number }> | undefined;
  let observer: ResizeObserver | undefined;
  let frame: unknown;
  const observe = () => {
    value ??= read();
    if (observer || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = scheduler ? scheduler.requestFrame(update) : requestAnimationFrame(update);
      function update() {
        frame = undefined;
        const next = read();
        const current = value!;
        if (next.inlineSize !== current.inlineSize || next.blockSize !== current.blockSize) {
          value = next;
          changed();
        }
      }
    });
    observer.observe(boundary);
    cleanups.push(() => {
      observer?.disconnect();
      if (frame !== undefined) {
        if (scheduler) scheduler.cancelFrame(frame);
        else cancelAnimationFrame(frame as number);
      }
    });
  };
  return () => {
    observe();
    return value!;
  };
}

function observeMedia(boundary: Element, query: string, changed: () => void): MediaObservation {
  const match =
    boundary.ownerDocument?.defaultView?.matchMedia ??
    (typeof matchMedia === "function" ? matchMedia : undefined);
  if (!match) return { read: () => false, release() {} };
  const media = match.call(boundary.ownerDocument?.defaultView, query);
  const change = () => changed();
  media.addEventListener("change", change);
  return {
    read: () => media.matches,
    release: () => media.removeEventListener("change", change),
  };
}

function applyPresenceLifecycle<Theme extends WebPresentationTokens>(
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
    if (previous === null || previous === undefined)
      target.removeAttribute("data-motion-lifecycle");
    else target.setAttribute("data-motion-lifecycle", previous);
  }
  if (presence?.layout) target.setAttribute("data-motion-layout", presence.layout);
  else {
    const previous = layoutRecords.get(target);
    if (previous === null || previous === undefined) target.removeAttribute("data-motion-layout");
    else target.setAttribute("data-motion-layout", previous);
  }
}

function applyStructuralPresenceLayout<Theme extends WebPresentationTokens>(
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

function applyAnchor<ElementName extends string, Theme extends WebPresentationTokens>(
  target: Element,
  declaration: WebPresentationDeclaration<Theme> | undefined,
  elements: ReadonlyMap<ElementName, readonly Element[]>,
  session: string,
  styles: Map<StyledElement, Map<string, string>>,
): void {
  const reference = record(record(declaration?.layout).position).anchor;
  if (!reference || typeof reference !== "object") return;
  const name = String(record(reference).name ?? "");
  if (!name) return;
  const anchor = elements.get(name as ElementName)?.[0];
  if (!isStyledElement(anchor) || !isStyledElement(target)) return;
  const anchorName = `--${session}-${name.toLowerCase()}`;
  setAdditionalOwnedStyles(anchor, { anchorName }, styles);
  setAdditionalOwnedStyles(target, { positionAnchor: anchorName }, styles);
}

function collectionMetric(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { value?: unknown }).value === "number"
  ) {
    return (value as { value: number }).value;
  }
  throw new TypeError("Presentation collection metrics must resolve to numbers.");
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

function applyLayers<Theme extends WebPresentationTokens>(
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
      removeLayer(layer, styles);
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

function removeLayer(layer: Element, styles: Map<StyledElement, Map<string, string>>): void {
  if (isStyledElement(layer)) {
    const owned = styles.get(layer);
    if (owned) restoreOwnedStyles(layer, owned);
    styles.delete(layer);
  }
  layer.remove();
}

function restoreAttribute(target: Element, name: string, value: string | null | undefined): void {
  if (value === undefined) return;
  if (value === null) target.removeAttribute(name);
  else target.setAttribute(name, value);
}

function needsTargetConditions<Theme extends WebPresentationTokens>(
  declaration: WebPresentationDeclaration<Theme> | undefined,
): boolean {
  return (
    declaration?.conditions?.some((rule) => Object.keys(rule.when.target ?? {}).length > 0) ===
      true || record(declaration?.paint).focusRing !== undefined
  );
}

function validateWebPresentationDeclaration<Theme extends WebPresentationTokens>(
  declaration: WebPresentationDeclaration<Theme>,
  elementName: string,
): void {
  validateSerializableValue(
    declaration,
    `Presentation Element ${JSON.stringify(elementName)}`,
    new Set(),
  );
  const identity = declaration.motion?.identity;
  if (identity !== undefined && identity.length === 0) {
    throw new TypeError(
      `Presentation Element ${JSON.stringify(elementName)} has an empty motion identity.`,
    );
  }
  validateResource(declaration.resource, elementName);
  for (const [index, rule] of (declaration.conditions ?? []).entries()) {
    const condition = rule.when;
    const groups = [
      condition.target,
      condition.container,
      condition.preferences,
      condition.pointer,
    ];
    if (!groups.some((group) => group && Object.keys(group).length > 0)) {
      throw new TypeError(
        `Presentation Element ${JSON.stringify(elementName)} condition ${index} is empty.`,
      );
    }
    validateConditionRange(condition.container?.inline, elementName, index, "inline");
    validateConditionRange(condition.container?.block, elementName, index, "block");
  }
  const layerIds = new Set<string>();
  for (const layer of declaration.layers ?? []) {
    if (!layer.id) {
      throw new TypeError(
        `Presentation Element ${JSON.stringify(elementName)} has an empty render-layer id.`,
      );
    }
    if (layerIds.has(layer.id)) {
      throw new TypeError(
        `Presentation Element ${JSON.stringify(elementName)} repeats render-layer id ${JSON.stringify(layer.id)}.`,
      );
    }
    layerIds.add(layer.id);
    validateResource(layer.resource, elementName);
  }
}

function validateConditionRange(
  range: Readonly<{ min?: unknown; max?: unknown }> | undefined,
  elementName: string,
  index: number,
  axis: string,
): void {
  if (!range) return;
  const minimum = conditionMetric(range.min);
  const maximum = conditionMetric(range.max);
  if (
    (range.min !== undefined && minimum === undefined) ||
    (range.max !== undefined && maximum === undefined)
  ) {
    throw new TypeError(
      `Presentation Element ${JSON.stringify(elementName)} condition ${index} has an invalid ${axis} range.`,
    );
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new TypeError(
      `Presentation Element ${JSON.stringify(elementName)} condition ${index} has an inverted ${axis} range.`,
    );
  }
}

function validateResource(resource: unknown, elementName: string): void {
  if (resource === undefined) return;
  const value = record(resource);
  if (
    !["image", "symbol", "shader"].includes(String(value.kind)) ||
    typeof value.source !== "string" ||
    value.source.length === 0
  ) {
    throw new TypeError(
      `Presentation Element ${JSON.stringify(elementName)} has an invalid resource.`,
    );
  }
}

function validateSerializableValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${path} contains a non-finite number.`);
  }
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains unsupported ${typeof value} data.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cyclic value.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateSerializableValue(item, path, ancestors);
  } else {
    for (const item of Object.values(value)) validateSerializableValue(item, path, ancestors);
  }
  ancestors.delete(value);
}

function motionValues<Theme extends WebPresentationTokens>(
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

function enterMotionValue(from: object | undefined, property: MotionProperty): number | undefined {
  const values = record(from);
  const names = {
    opacity: ["opacity"],
    translateX: ["inline"],
    translateY: ["block"],
    translateZ: ["depth"],
    layoutTranslateX: [],
    layoutTranslateY: [],
    scaleX: ["scaleInline", "scale"],
    scaleY: ["scaleBlock", "scale"],
    layoutScaleX: [],
    layoutScaleY: [],
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
  return property === "opacity" || property.toLowerCase().includes("scale") ? 1 : 0;
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
  setAdditionalOwnedStyles(target, { pointerEvents: "" }, styles);
}

function hideTarget(target: Element, styles: Map<StyledElement, Map<string, string>>): void {
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
