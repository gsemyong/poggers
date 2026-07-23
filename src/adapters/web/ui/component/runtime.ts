import {
  Virtualizer,
  defaultRangeExtractor,
  elementScroll,
  measureElement as measureVirtualElement,
  observeElementOffset,
  observeElementRect,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import {
  computed as alienComputed,
  effect as alienEffect,
  effectScope as alienEffectScope,
  getActiveSub as alienGetActiveSub,
  signal as alienSignal,
  setActiveSub as alienSetActiveSub,
} from "alien-signals";

import type { WebDeferredDataIR } from "@/adapters/web/document";
import {
  adoptSceneChildren,
  hasPresentationPresence,
  mountPresenceElement,
  onPresentationExit,
  PresenceGraph,
  setSceneElementPresence,
  setSceneElementVisible,
  unmountPresenceElement,
  type SceneElementRegistration,
} from "@/adapters/web/ui/presence";
import { observeWebDeferredState, type WebDeferredState } from "@/adapters/web/ui/stream";
import type { JSXElement } from "@/jsx/runtime";
import type { Deferred } from "@/platforms/web/routing";
import type {
  Child,
  VirtualForOptions,
  WebForBaseProps as ForProps,
  WebForKey as ForKey,
  WebVirtualForProps as VirtualForProps,
  WebVirtualPropertyKey as VirtualPropertyKey,
} from "@/platforms/web/ui";

export type VirtualCollectionGeometry = {
  readonly axis: "block" | "inline";
  readonly estimate: number;
  readonly gap: number;
  readonly lanes: number;
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type Signal<T> = {
  (): T;
  (value: T): void;
};

const hotSignalCaptures = new WeakMap<Signal<unknown>, () => unknown>();

export function captureSignalOnHotRefresh<T>(current: Signal<T>, capture: () => T): void {
  hotSignalCaptures.set(current as Signal<unknown>, capture);
}

const reactiveValueRead = Symbol.for("kit.reactiveValue.read");

type ReactiveValue<T> = {
  readonly [reactiveValueRead]: () => T;
};

export type Props = Record<string, unknown> & {
  children?: Child;
};

export type Component<P extends object = Record<string, never>> = (props: P) => Child;

export type HotRenderState = {
  focus?: Readonly<{
    id?: string;
    path: readonly number[];
    tag: string;
    selectionEnd?: number | null;
    selectionStart?: number | null;
    selectionDirection?: "backward" | "forward" | "none" | null;
  }>;
  keyed?: Record<string, unknown>;
  programs?: Record<string, Record<string, unknown>>;
  presentation?: unknown;
  scroll?: Record<string, { left: number; top: number }>;
  values?: unknown[];
  mounted?: boolean;
};

export type RenderDisposer = (() => void) & {
  capture(): HotRenderState;
  resume(): void;
};

type Owner = {
  cleanups: Array<() => void>;
  mounts: Array<() => void | (() => void)>;
  hotState?: HotRenderState;
  signalCursor: number;
  signalKeys: Array<string | undefined>;
  keyOccurrences: Map<string, number>;
  signals: Signal<unknown>[];
  hotRefresh: boolean;
  disposed: boolean;
  scene: PresenceGraph<Element>;
  sceneSequence: number;
};

type LifecycleScope = {
  cleanups: Array<() => void>;
  mounts: Array<() => void | (() => void)>;
  disposed: boolean;
  mounted: boolean;
};

type HydrationContext = {
  readonly elements: ReadonlyMap<string, HTMLElement>;
  readonly textMarkers: ReadonlyMap<string, Comment>;
  readonly elementOrder: readonly Readonly<[string, HTMLElement]>[];
  readonly textOrder: readonly Readonly<[string, Comment]>[];
  elementCursor: number;
  textCursor: number;
};

let currentOwner: Owner | null = null;
let currentLifecycleScope: LifecycleScope | null = null;
let currentChildHost: HTMLElement | null = null;
let currentHydration: HydrationContext | null = null;
let detachedPresenceSequence = 0;

const scopedChild = Symbol("kit.scoped-child");
type ScopedChild = Readonly<{ [scopedChild]: () => Child }>;

export function currentPresenceGraph(): PresenceGraph<Element> | undefined {
  return currentOwner?.scene;
}

export function allocatePresenceOwner(name: string): string {
  const owner = currentOwner;
  if (!owner) return `${name}:detached:${detachedPresenceSequence++}`;
  return `${name}:${owner.sceneSequence++}`;
}

/** @internal Defers a reactive replacement subtree into its own lifecycle scope. */
export function scoped(read: () => Child): Child {
  return Object.freeze({ [scopedChild]: read }) as unknown as Child;
}

/** @internal Evaluates an owned subtree without mounting it. */
export function readScoped(child: Child): Child {
  return isScopedChild(child) ? child[scopedChild]() : child;
}

const virtualCollectionHosts = new WeakMap<
  HTMLElement,
  Signal<VirtualCollectionGeometry | undefined>
>();
const virtualCollectionOpenHandlers = new WeakMap<HTMLElement, () => void>();

export function bindVirtualCollectionHost(
  element: HTMLElement,
  geometry: VirtualCollectionGeometry,
): void {
  const current =
    virtualCollectionHosts.get(element) ??
    runtimeSignal<VirtualCollectionGeometry | undefined>(undefined);
  virtualCollectionHosts.set(element, current);
  const previous = current();
  if (previous && sameVirtualGeometry(previous, geometry)) return;
  current(geometry);
}

export function unbindVirtualCollectionHost(element: HTMLElement): void {
  virtualCollectionHosts.get(element)?.(undefined);
}

export function inspectVirtualCollectionHost(
  element: HTMLElement,
): VirtualCollectionGeometry | undefined {
  return virtualCollectionHosts.get(element)?.();
}

export function runtimeSignal<T>(initialValue: T): Signal<T> {
  return alienSignal(initialValue) as Signal<T>;
}

export function signal<T>(initialValue: T, hotKey?: string): Signal<T> {
  const owner = currentOwner;
  if (owner?.hotState) {
    const index = owner.signalCursor++;
    let resolvedKey: string | undefined;
    if (hotKey) {
      const occurrence = owner.keyOccurrences.get(hotKey) ?? 0;
      owner.keyOccurrences.set(hotKey, occurrence + 1);
      resolvedKey = `${hotKey}#${occurrence}`;
    }
    const positional =
      index < (owner.hotState.values?.length ?? 0)
        ? (owner.hotState.values![index] as T)
        : initialValue;
    const restored = resolvedKey
      ? Object.hasOwn(owner.hotState.keyed ?? {}, resolvedKey)
        ? (owner.hotState.keyed![resolvedKey] as T)
        : owner.hotState.keyed
          ? initialValue
          : positional
      : positional;
    const next = runtimeSignal(restored);
    owner.signals[index] = next as Signal<unknown>;
    owner.signalKeys[index] = resolvedKey;
    return next;
  }

  return runtimeSignal(initialValue);
}

type DeferredState<Value> =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "resolved"; value: Value }>
  | Readonly<{ status: "rejected"; error: unknown }>;

const deferredResource = Symbol("kit.deferred-resource");

type DeferredResource<Value> = Deferred<Value> &
  Readonly<{
    [deferredResource]: Signal<DeferredState<Value>>;
  }>;

/** @internal Creates the reactive value consumed by an Await boundary. */
export function createDeferredResource<Value>(
  run: () => Value | PromiseLike<Value>,
  abort?: AbortSignal,
): Deferred<Value> {
  const current = runtimeSignal<DeferredState<Value>>({ status: "pending" });
  let active = !abort?.aborted;
  const stop = () => {
    active = false;
  };
  abort?.addEventListener("abort", stop, { once: true });
  void Promise.resolve()
    .then(run)
    .then(
      (value) => {
        if (active) current({ status: "resolved", value });
      },
      (error: unknown) => {
        if (active) current({ status: "rejected", error });
      },
    )
    .finally(() => abort?.removeEventListener("abort", stop));
  return Object.freeze({ [deferredResource]: current }) as DeferredResource<Value>;
}

/** @internal Reconstructs a server-completed deferred value during hydration. */
export function createSettledDeferredResource<Value>(
  state: Exclude<DeferredState<Value>, { status: "pending" }>,
): Deferred<Value> {
  return Object.freeze({
    [deferredResource]: runtimeSignal<DeferredState<Value>>(state),
  }) as DeferredResource<Value>;
}

/** @internal Adopts a server boundary without repeating its deferred computation. */
export function createHydratedDeferredResource<Value>(
  marker: WebDeferredDataIR,
  abort?: AbortSignal,
): Deferred<Value> {
  const current = runtimeSignal<DeferredState<Value>>({ status: "pending" });
  let active = !abort?.aborted;
  const subscription = observeWebDeferredState(marker.boundary, (state) => {
    if (active) current(deferredRuntimeState(state) as DeferredState<Value>);
  });
  const stop = () => {
    if (!active) return;
    active = false;
    subscription[Symbol.dispose]();
  };
  abort?.addEventListener("abort", stop, { once: true });
  return Object.freeze({ [deferredResource]: current }) as DeferredResource<Value>;
}

export function isDeferredResource(value: unknown): value is Deferred<unknown> {
  return Boolean(value && typeof value === "object" && deferredResource in value);
}

function deferredRuntimeState(state: WebDeferredState): DeferredState<unknown> {
  return state.status === "resolved"
    ? { status: "resolved", value: state.value }
    : { status: "rejected", error: state.error };
}

/** The sole structural boundary for deferred Route data. */
export function Await<Value>(props: {
  value: Deferred<Value>;
  fallback?: Child;
  error: (error: unknown) => Child;
  children: (value: Value) => Child;
}): JSXElement {
  if (typeof document === "undefined" && typeof props.value === "function") {
    return props.fallback as JSXElement;
  }
  if (!isDeferredResource(props.value)) {
    throw new TypeError("Await requires deferred Route data.");
  }
  const current = (props.value as DeferredResource<Value>)[deferredResource];
  const resolved = (): Child => {
    const state = current();
    if (state.status === "pending") return props.fallback;
    if (state.status === "rejected") return props.error(state.error);
    return props.children(state.value);
  };
  if (typeof document === "undefined") return resolved() as JSXElement;
  return Show({
    when: () => current().status !== "pending",
    fallback: props.fallback,
    children: resolved,
  });
}

export function isHotRefresh(): boolean {
  return currentOwner?.hotRefresh ?? false;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
  return alienComputed(getter);
}

export function effect(fn: () => void | (() => void)): () => void {
  const owner = currentOwner;
  const scope = currentLifecycleScope;
  const dispose = alienEffect(() => runInRuntimeContext(owner, scope, fn));
  registerCleanup(dispose);
  return dispose;
}

export function untrack<T>(fn: () => T): T {
  const activeSub = alienGetActiveSub();
  alienSetActiveSub(undefined);
  try {
    return fn();
  } finally {
    alienSetActiveSub(activeSub);
  }
}

export function onMount(fn: () => void | (() => void)): void {
  if (currentLifecycleScope) {
    currentLifecycleScope.mounts.push(fn);
    return;
  }
  const owner = currentOwner;
  if (owner) {
    owner.mounts.push(fn);
    return;
  }
  queueMicrotask(() => {
    fn();
  });
}

export function onCleanup(fn: () => void): void {
  registerCleanup(fn);
}

export function render(child: Child, root: Element, hotState?: HotRenderState): RenderDisposer {
  return renderAttempt(child, root, hotState, true);
}

function renderAttempt(
  child: Child,
  root: Element,
  hotState: HotRenderState | undefined,
  allowHydration: boolean,
): RenderDisposer {
  const hotRefresh = Boolean(hotState?.mounted);
  const hotScroll = hotState?.scroll;
  const hotFocus = hotState?.focus;
  const scene = new PresenceGraph<Element>();
  const owner: Owner = {
    cleanups: [],
    mounts: [],
    hotState,
    signalCursor: 0,
    signalKeys: [],
    keyOccurrences: new Map(),
    signals: [],
    hotRefresh,
    disposed: false,
    scene,
    sceneSequence: 0,
  };
  const previousOwner = currentOwner;
  const previousHydration = currentHydration;
  const previousNodes = [...root.childNodes];
  let mountedNodes: Node[] = [];
  let hydrationFailure: unknown;
  currentOwner = owner;
  const hydration = allowHydration && !hotRefresh ? createHydrationContext(root) : null;
  currentHydration = hydration;
  try {
    mountedNodes = toNodes(child);
    root.replaceChildren(...mountedNodes);
    if (hydration) finishHydration(root, hydration);
    currentHydration = null;
    while (owner.mounts.length) {
      for (const mount of owner.mounts.splice(0)) {
        const cleanup = mount();
        if (typeof cleanup === "function") owner.cleanups.push(cleanup);
      }
    }
    if (hotRefresh && hotScroll) restoreHotScroll(root, hotScroll);
    if (!hydration && !hotRefresh && root.getAttribute("data-kit-rendering") === "client") {
      releaseServerStyles(root);
    }
  } catch (error) {
    owner.disposed = true;
    for (const cleanup of owner.cleanups.splice(0).reverse()) cleanup();
    owner.scene.dispose();
    owner.mounts.length = 0;
    if (hydration) hydrationFailure = error;
    else {
      root.replaceChildren(...previousNodes);
      throw error;
    }
  } finally {
    currentOwner = previousOwner;
    currentHydration = previousHydration;
  }

  if (hydrationFailure !== undefined) {
    const message =
      hydrationFailure instanceof Error ? hydrationFailure.message : String(hydrationFailure);
    console.error(`[kit] ${message} Recovering with a client render.`);
    root.replaceChildren();
    root.setAttribute("data-kit-rendering", "client-recovered");
    const recovered = renderAttempt(child, root, hotState, false);
    releaseServerStyles(root);
    return recovered;
  }
  if (hotState) hotState.mounted = true;
  let restoreFocus: (() => void) | undefined;

  const capture = () => {
    const state = owner.hotState ?? {};
    if (!owner.hotState) return state;
    const captured = new Map(owner.signals.map((current) => [current, readHotSignal(current)]));
    state.scroll = captureHotScroll(root);
    state.focus = captureHotFocus(root);
    state.values = owner.signals.map((current) => captured.get(current));
    state.keyed = Object.fromEntries(
      owner.signalKeys.flatMap((key, index) =>
        key ? ([[key, captured.get(owner.signals[index]!)]] as const) : [],
      ),
    );
    return state;
  };
  const dispose = () => {
    if (owner.disposed) return;
    owner.disposed = true;
    restoreFocus?.();
    capture();
    for (const cleanup of owner.cleanups.splice(0).reverse()) cleanup();
    owner.scene.dispose();
    owner.mounts.length = 0;
    for (const node of mountedNodes) {
      if (node.parentNode === root) root.removeChild(node);
    }
  };
  const resume = () => {
    restoreFocus?.();
    restoreFocus = hotRefresh && hotFocus ? restoreHotFocusAfterRefresh(root, hotFocus) : undefined;
  };
  return Object.assign(dispose, { capture, resume });
}

function captureHotFocus(root: Element): HotRenderState["focus"] {
  const active = root.ownerDocument?.activeElement;
  if (!active || !root.contains(active)) return undefined;
  const path: number[] = [];
  for (let current: Element | null = active; current && current !== root;) {
    const parent: Element | null = current.parentElement;
    if (!parent) return undefined;
    path.push([...parent.children].indexOf(current));
    current = parent;
  }
  const input = active as HTMLInputElement | HTMLTextAreaElement;
  return {
    id: input.id || undefined,
    path: path.reverse(),
    tag: active.tagName,
    ...(typeof input.selectionStart === "number"
      ? {
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          selectionDirection: input.selectionDirection,
        }
      : {}),
  };
}

function restoreHotFocusAfterRefresh(
  root: Element,
  focus: NonNullable<HotRenderState["focus"]>,
): () => void {
  let active = true;
  let frame: number | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (!active) return;
    active = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (timeout !== undefined) clearTimeout(timeout);
  };
  const restore = () => {
    if (!active) return;
    if (focusChanged(root, focus)) {
      stop();
      return;
    }
    if (!focusMatches(root, focus)) restoreHotFocus(root, focus);
    frame = requestAnimationFrame(restore);
  };

  timeout = setTimeout(stop, 500);
  restore();
  return stop;
}

function restoreHotFocus(root: Element, focus: NonNullable<HotRenderState["focus"]>): boolean {
  let current =
    focus.id && root.ownerDocument?.getElementById(focus.id)
      ? root.ownerDocument.getElementById(focus.id)!
      : root;
  if (current === root) {
    for (const index of focus.path) {
      const child = current.children.item(index);
      if (!child) return false;
      current = child;
    }
  }
  if (
    !root.contains(current) ||
    current.tagName !== focus.tag ||
    !(current instanceof HTMLElement)
  ) {
    return false;
  }
  current.focus({ preventScroll: true });
  if (typeof focus.selectionStart === "number" && "setSelectionRange" in current) {
    (current as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
      focus.selectionStart,
      focus.selectionEnd ?? focus.selectionStart,
      focus.selectionDirection ?? undefined,
    );
  }
  return root.ownerDocument?.activeElement === current;
}

function focusChanged(root: Element, focus: NonNullable<HotRenderState["focus"]>): boolean {
  const active = root.ownerDocument?.activeElement;
  if (
    !active ||
    active === root.ownerDocument?.body ||
    active === root.ownerDocument?.documentElement
  ) {
    return false;
  }
  if (!root.contains(active)) return true;
  return !focusMatches(root, focus);
}

function focusMatches(root: Element, focus: NonNullable<HotRenderState["focus"]>): boolean {
  const active = root.ownerDocument?.activeElement;
  return Boolean(
    active &&
    root.contains(active) &&
    (active.id || undefined) === focus.id &&
    active.tagName === focus.tag,
  );
}

function readHotSignal(current: Signal<unknown>): unknown {
  return hotSignalCaptures.get(current)?.() ?? current();
}

function captureHotScroll(root: Element): Record<string, { left: number; top: number }> {
  if (typeof root.querySelectorAll !== "function") return {};
  return Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>("[id]")].flatMap((element) => {
      if (!element.scrollTop && !element.scrollLeft) return [];
      return [[element.id, { left: element.scrollLeft, top: element.scrollTop }] as const];
    }),
  );
}

function restoreHotScroll(
  root: Element,
  scroll: Readonly<Record<string, { left: number; top: number }>>,
): void {
  if (typeof root.querySelectorAll !== "function") return;
  const restore = () => {
    for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
      const position = scroll[element.id];
      if (position) element.scrollTo(position.left, position.top);
    }
  };
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(() => {
      restore();
      setTimeout(restore, 100);
    });
  });
}

type ErasedComponent = (props: never) => Child;
const hydrationElement = Symbol("kit.hydration-element");
type HydrationElement = Readonly<{
  [hydrationElement]: true;
  type: string;
  props: Props;
}>;

export function jsx(type: string | ErasedComponent, props: Props | null): Child {
  return createNode(type, props ?? {});
}

export const jsxs = jsx;

export function Fragment(props: { children?: Child }): Child {
  return props.children ?? null;
}

type ScopedNodes = {
  nodes: Node[];
  mount(): void;
  dispose(): void;
};

type RetainedPresence = {
  finish(): void;
  restore(): void;
};

const retainedPresenceSemantics = new WeakMap<
  HTMLElement,
  { readonly ariaHidden: string | null; readonly inert: boolean }
>();
type KeyedScopedNodes<Item> = ScopedNodes & {
  item: Item;
  update(item: Item, index: number): boolean;
};

type CompiledForChild<Item> = (item: Item, index: number, reactiveIndex: Signal<number>) => Child;

const structuralKeyStack: string[] = [];

export function currentStructuralKey(): string | undefined {
  return structuralKeyStack.length ? structuralKeyStack.join("/") : undefined;
}

function withStructuralKey<T>(key: string, fn: () => T): T {
  structuralKeyStack.push(key);
  try {
    return fn();
  } finally {
    structuralKeyStack.pop();
  }
}

export function For<
  Items extends readonly unknown[],
  Key extends VirtualPropertyKey<Items> = VirtualPropertyKey<Items>,
>(props: ForProps<Items> | VirtualForProps<Items, Key>): JSXElement {
  if (typeof document === "undefined") {
    const items = readSource(props.each);
    return (
      items.length === 0 && props.fallback !== undefined
        ? props.fallback
        : items.map((item, index) => props.children(item, index))
    ) as JSXElement;
  }
  if (props.virtual) return virtualFor(props as VirtualForProps<Items>) as JSXElement;
  const start = document.createComment("for");
  const end = document.createComment("/for");
  const parent = document.createDocumentFragment();
  parent.append(start, end);
  let rendered: ScopedNodes | undefined;
  let fallback: ScopedNodes | undefined;
  let keyed = new Map<ForKey, KeyedScopedNodes<Items[number]>>();
  const exiting = new Map<
    ForKey,
    { entry: KeyedScopedNodes<Items[number]>; retention: RetainedPresence }
  >();

  const disposeEntry = (entry: ScopedNodes) => {
    entry.dispose();
    for (const node of entry.nodes) node.parentNode?.removeChild(node);
  };

  const clearKeyed = () => {
    for (const entry of keyed.values()) {
      disposeEntry(entry);
    }
    keyed.clear();
    for (const { retention } of exiting.values()) retention.finish();
    exiting.clear();
  };

  const createEntry = (
    item: Items[number],
    index: number,
    itemKey: ForKey,
  ): KeyedScopedNodes<Items[number]> => {
    const current = runtimeSignal(item);
    const currentIndex = runtimeSignal(index);
    const objectBacked = item != null && typeof item === "object";
    const visibleItem = objectBacked ? reactiveValue(current) : item;
    const scope = createScopedNodes(() =>
      withStructuralKey(String(itemKey), () =>
        (props.children as CompiledForChild<Items[number]>)(visibleItem, index, currentIndex),
      ),
    );
    return {
      ...scope,
      item,
      update(next, nextIndex) {
        if (objectBacked && next != null && typeof next === "object") {
          this.item = next;
          current(next);
          currentIndex(nextIndex);
          return true;
        }
        if (!Object.is(this.item, next)) return false;
        currentIndex(nextIndex);
        return true;
      },
    };
  };

  const startExit = (itemKey: ForKey, entry: KeyedScopedNodes<Items[number]>) => {
    if (!shouldRetainForExit(entry.nodes)) {
      disposeEntry(entry);
      return;
    }
    let retention: RetainedPresence;
    retention = retainForExit(entry.nodes, () => {
      entry.dispose();
      if (exiting.get(itemKey)?.retention === retention) exiting.delete(itemKey);
    });
    exiting.set(itemKey, { entry, retention });
  };

  blockEffect(() => {
    const items = readSource(props.each);
    const key = props.by;

    if (!key) {
      clearKeyed();
      const next = createScopedNodes(() =>
        items.length === 0 && props.fallback !== undefined
          ? props.fallback
          : items.map((item, index) => props.children(item, index)),
      );
      rendered?.dispose();
      replaceBetween(start, end, next.nodes);
      rendered = next;
      next.mount();
      return;
    }

    if (rendered) {
      disposeEntry(rendered);
      rendered = undefined;
    }

    if (items.length === 0) {
      for (const [itemKey, entry] of keyed) startExit(itemKey, entry);
      keyed.clear();
      if (!fallback && props.fallback !== undefined) {
        fallback = createScopedNodes(() => props.fallback);
        markPresenceState(fallback.nodes, "entering");
        for (const node of fallback.nodes) end.parentNode?.insertBefore(node, end);
        if (end.parentElement) adoptSceneChildren(end.parentElement);
        fallback.mount();
        queuePresenceTarget(() => fallback && markPresenceState(fallback.nodes, "entered"));
      }
      return;
    }

    if (fallback) {
      disposeEntry(fallback);
      fallback = undefined;
    }

    const nextKeyed = new Map<ForKey, KeyedScopedNodes<Items[number]>>();
    const nextNodes: Node[] = [];
    const entering: KeyedScopedNodes<Items[number]>[] = [];
    for (const [index, item] of items.entries()) {
      const itemKey =
        typeof key === "function"
          ? key(item, index)
          : ((item as Record<string, unknown> | null | undefined)?.[key] as ForKey);
      if (typeof itemKey !== "string" && typeof itemKey !== "number") {
        throw new Error(`For key ${String(key)} must resolve to a string or number.`);
      }
      if (nextKeyed.has(itemKey)) throw new Error(`For received duplicate key ${String(itemKey)}.`);
      const previous = keyed.get(itemKey);
      let entry: KeyedScopedNodes<Items[number]>;
      if (previous?.update(item, index)) {
        entry = previous;
      } else if (previous) {
        startExit(itemKey, previous);
        entry = createEntry(item, index, itemKey);
        entering.push(entry);
      } else {
        const retained = exiting.get(itemKey);
        if (retained?.entry.update(item, index)) {
          exiting.delete(itemKey);
          retained.retention.restore();
          entry = retained.entry;
        } else {
          retained?.retention.finish();
          entry = createEntry(item, index, itemKey);
          entering.push(entry);
        }
      }
      nextKeyed.set(itemKey, entry);
      nextNodes.push(...entry.nodes);
    }
    for (const [itemKey, entry] of keyed) {
      if (nextKeyed.has(itemKey)) continue;
      startExit(itemKey, entry);
    }
    const host = end.parentNode;
    if (host) {
      for (const entry of entering) markPresenceState(entry.nodes, "entering");
      for (const node of nextNodes) host.insertBefore(node, end);
      if ("children" in host) adoptSceneChildren(host as Element);
    }
    keyed = nextKeyed;
    for (const entry of keyed.values()) entry.mount();
    if (entering.length) {
      queuePresenceTarget(() => {
        for (const entry of entering) markPresenceState(entry.nodes, "entered");
      });
    }
  });

  registerCleanup(() => {
    if (rendered) disposeEntry(rendered);
    rendered = undefined;
    if (fallback) disposeEntry(fallback);
    fallback = undefined;
    clearKeyed();
  });

  return parent as unknown as JSXElement;
}

type VirtualKeyedScopedNodes<Item> = KeyedScopedNodes<Item> & {
  readonly root: HTMLElement;
};

function virtualFor<Items extends readonly unknown[]>(props: VirtualForProps<Items>): Child {
  const host = currentChildHost;
  if (!host) {
    throw new Error("A virtual For must be the direct child of a rendered Component Element.");
  }
  const readGeometry =
    virtualCollectionHosts.get(host) ??
    runtimeSignal<VirtualCollectionGeometry | undefined>(undefined);
  virtualCollectionHosts.set(host, readGeometry);

  const space = document.createElement("div");
  space.style.position = "relative";
  space.style.flexShrink = "0";
  space.style.minInlineSize = "100%";
  let items = readSource(props.each);
  let geometry: VirtualCollectionGeometry = {
    axis: "block",
    estimate: 1,
    gap: 0,
    lanes: 1,
  };
  let keyed = new Map<ForKey, VirtualKeyedScopedNodes<Items[number]>>();
  const exiting = new Map<
    ForKey,
    { entry: VirtualKeyedScopedNodes<Items[number]>; retention: RetainedPresence }
  >();
  let fallback: ScopedNodes | undefined;
  let disposed = false;
  let mounted = false;
  let activeInitialized = false;
  let previousActive: ForKey | undefined;
  let pinnedActiveIndex = -1;
  let keyIndexes = new Map<ForKey, number>();
  let anchorOnNextRender = false;
  let sourceVersion = 0;
  let renderedSourceVersion = -1;
  let renderedRevision = -1;
  let renderedGeometry: VirtualCollectionGeometry | undefined;
  let notifyQueued = false;
  const revision = runtimeSignal(0);
  const sourceRevision = runtimeSignal(0);
  const readVirtualOptions = (): VirtualForOptions => {
    const value = readSource(
      props.virtual as true | VirtualForOptions | (() => true | VirtualForOptions),
    );
    return typeof value === "object" ? value : {};
  };

  const itemKey = (item: Items[number], index: number): ForKey => {
    const key =
      typeof props.by === "function"
        ? props.by(item, index)
        : ((item as Record<string, unknown> | null | undefined)?.[props.by] as ForKey);
    if (typeof key !== "string" && typeof key !== "number") {
      throw new Error(`For key ${String(props.by)} must resolve to a string or number.`);
    }
    return key;
  };

  blockEffect(() => {
    const next = readSource(props.each);
    // Reading length subscribes when the source is a reactive collection proxy.
    void next.length;
    items = next;
    sourceRevision(++sourceVersion);
  });

  const schedule = () => {
    if (notifyQueued || disposed) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      if (!disposed) revision(revision() + 1);
    });
  };

  let virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  const scrollPinnedActive = () => {
    const activeIndex = pinnedActiveIndex;
    if (!mounted || disposed || activeIndex < 0) return;
    queueMicrotask(() => {
      if (disposed) return;
      const activeItem = items[activeIndex];
      const activeKey = activeItem === undefined ? undefined : itemKey(activeItem, activeIndex);
      const activeElement = activeKey === undefined ? undefined : keyed.get(activeKey)?.root;
      if (!activeElement || geometry.axis === "inline") {
        virtualizer.scrollToIndex(activeIndex, { align: "auto" });
        return;
      }
      const viewport = host.getBoundingClientRect();
      const item = activeElement.getBoundingClientRect();
      const delta =
        item.top < viewport.top
          ? item.top - viewport.top
          : item.bottom > viewport.bottom
            ? item.bottom - viewport.bottom
            : 0;
      if (Math.abs(delta) > 0.5) host.scrollTop += delta;
    });
  };
  const handleCollectionOpen = () => {
    const refresh = () => {
      if (!mounted || disposed) return;
      anchorOnNextRender = true;
      virtualizer.measure();
      revision(revision() + 1);
      scrollPinnedActive();
    };
    refresh();
    requestPresenceFrame(refresh);
  };
  const options = (): VirtualizerOptions<HTMLElement, HTMLElement> => {
    const virtualOptions = readVirtualOptions();
    return {
      count: items.length,
      getScrollElement: () => host,
      estimateSize: () => geometry.estimate,
      getItemKey: (index: number) => itemKey(items[index]!, index),
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      measureElement: measureVirtualElement,
      onChange: schedule,
      overscan: 6,
      rangeExtractor(range) {
        const visible = defaultRangeExtractor(range);
        if (pinnedActiveIndex < 0 || visible.includes(pinnedActiveIndex)) return visible;
        return [...visible, pinnedActiveIndex].sort((left, right) => left - right);
      },
      horizontal: geometry.axis === "inline",
      gap: geometry.gap,
      lanes: geometry.lanes,
      anchorTo: virtualOptions.anchor ?? "start",
      followOnAppend:
        !virtualOptions.follow || virtualOptions.follow === "never" ? false : virtualOptions.follow,
      scrollEndThreshold: Math.max(24, geometry.gap * 2),
      indexAttribute: "data-virtual-index",
      initialRect: {
        width: Math.max(host.clientWidth, 600),
        height: Math.max(host.clientHeight, 600),
      },
      useAnimationFrameWithResizeObserver: true,
    };
  };
  virtualizer = new Virtualizer(options());

  const disposeEntry = (entry: ScopedNodes) => {
    entry.dispose();
    for (const node of entry.nodes) node.parentNode?.removeChild(node);
  };

  const startExit = (key: ForKey, entry: VirtualKeyedScopedNodes<Items[number]>) => {
    if (!shouldRetainForExit(entry.nodes)) {
      disposeEntry(entry);
      return;
    }
    let retention: RetainedPresence;
    retention = retainForExit(entry.nodes, () => {
      entry.dispose();
      virtualizer.measureElement(null);
      if (exiting.get(key)?.retention === retention) exiting.delete(key);
    });
    exiting.set(key, { entry, retention });
  };

  const clear = () => {
    for (const entry of keyed.values()) disposeEntry(entry);
    keyed.clear();
    for (const { retention } of exiting.values()) retention.finish();
    exiting.clear();
    virtualizer.measureElement(null);
  };

  const createEntry = (
    item: Items[number],
    index: number,
    key: ForKey,
  ): VirtualKeyedScopedNodes<Items[number]> => {
    const current = runtimeSignal(item);
    const currentIndex = runtimeSignal(index);
    const objectBacked = item != null && typeof item === "object";
    const visibleItem = objectBacked ? reactiveValue(current) : item;
    const scope = createScopedNodes(() =>
      withStructuralKey(String(key), () =>
        (props.children as CompiledForChild<Items[number]>)(visibleItem, index, currentIndex),
      ),
    );
    const elements = scope.nodes.filter(
      (node): node is HTMLElement =>
        typeof HTMLElement !== "undefined" && node instanceof HTMLElement,
    );
    if (elements.length !== 1 || scope.nodes.some((node) => node.nodeType === Node.TEXT_NODE)) {
      scope.dispose();
      throw new Error("Each virtual For item must render exactly one HTML element.");
    }
    return {
      ...scope,
      root: elements[0]!,
      item,
      update(next, nextIndex) {
        if (objectBacked && next != null && typeof next === "object") {
          this.item = next;
          current(next);
          currentIndex(nextIndex);
          return true;
        }
        if (!Object.is(this.item, next)) return false;
        currentIndex(nextIndex);
        return true;
      },
    };
  };

  blockEffect(() => {
    const currentRevision = revision();
    const currentSourceVersion = sourceRevision();
    const nextGeometry = readGeometry();
    if (!nextGeometry) {
      clear();
      space.style.removeProperty("block-size");
      space.style.removeProperty("inline-size");
      return;
    }
    const geometryChanged = !sameVirtualGeometry(renderedGeometry, nextGeometry);
    geometry = nextGeometry;

    const active = props.active === undefined ? undefined : readSource(props.active);
    const activeChanged = !activeInitialized || !Object.is(active, previousActive);
    const sourceChanged = currentSourceVersion !== renderedSourceVersion;
    activeInitialized = true;
    previousActive = active;
    if (sourceChanged) {
      const nextIndexes = new Map<ForKey, number>();
      for (const [index, item] of items.entries()) {
        const key = itemKey(item, index);
        if (nextIndexes.has(key)) throw new Error(`For received duplicate key ${String(key)}.`);
        nextIndexes.set(key, index);
      }
      keyIndexes = nextIndexes;
    }
    if (activeChanged || sourceChanged) {
      pinnedActiveIndex = active === undefined ? -1 : (keyIndexes.get(active) ?? -1);
    }
    renderedSourceVersion = currentSourceVersion;
    const activeOnly =
      activeChanged && !sourceChanged && !geometryChanged && currentRevision === renderedRevision;
    if (activeOnly) {
      scrollPinnedActive();
      return;
    }
    renderedRevision = currentRevision;
    renderedGeometry = geometry;
    virtualizer.setOptions(options());
    virtualizer._willUpdate();
    if (activeChanged && active !== undefined) scrollPinnedActive();

    if (items.length === 0) {
      clear();
      space.style.removeProperty("block-size");
      space.style.removeProperty("inline-size");
      if (!fallback && props.fallback !== undefined) {
        fallback = createScopedNodes(() => props.fallback);
        space.append(...fallback.nodes);
        fallback.mount();
      }
      return;
    }

    if (!host.getClientRects().length && keyed.size) {
      anchorOnNextRender = true;
      return;
    }

    if (fallback) {
      disposeEntry(fallback);
      fallback = undefined;
    }

    const visible = virtualizer.getVirtualItems();
    const trackedSourceKeys = new Set<ForKey>();
    if (sourceChanged && (keyed.size || exiting.size)) {
      const tracked = new Set<ForKey>([...keyed.keys(), ...exiting.keys()]);
      for (const [index, item] of items.entries()) {
        const key = itemKey(item, index);
        if (!tracked.has(key)) continue;
        trackedSourceKeys.add(key);
        if (trackedSourceKeys.size === tracked.size) break;
      }
    }
    const next = new Map<ForKey, VirtualKeyedScopedNodes<Items[number]>>();
    for (const virtualItem of visible) {
      const item = items[virtualItem.index]!;
      const key = itemKey(item, virtualItem.index);
      if (next.has(key)) throw new Error(`For received duplicate key ${String(key)}.`);
      const previous = keyed.get(key);
      let entry: VirtualKeyedScopedNodes<Items[number]>;
      if (previous?.update(item, virtualItem.index)) {
        entry = previous;
      } else if (previous) {
        disposeEntry(previous);
        entry = createEntry(item, virtualItem.index, key);
      } else {
        const retained = exiting.get(key);
        if (retained?.entry.update(item, virtualItem.index)) {
          exiting.delete(key);
          retained.retention.restore();
          entry = retained.entry;
        } else {
          retained?.retention.finish();
          entry = createEntry(item, virtualItem.index, key);
        }
      }
      positionVirtualItem(
        entry.root,
        virtualItem.index,
        items.length,
        virtualItem.start,
        virtualItem.lane,
        geometry,
      );
      next.set(key, entry);
    }
    for (const [key, entry] of keyed) {
      if (next.has(key)) continue;
      if (sourceChanged && !trackedSourceKeys.has(key)) startExit(key, entry);
      else disposeEntry(entry);
    }
    keyed = next;

    const totalSize = Math.max(0, virtualizer.getTotalSize());
    const total = `${totalSize}px`;
    if (geometry.axis === "inline") {
      space.style.inlineSize = total;
      space.style.blockSize = "100%";
    } else {
      space.style.blockSize = total;
      space.style.inlineSize = "100%";
    }
    for (const entry of keyed.values()) {
      space.append(...entry.nodes);
      entry.mount();
      virtualizer.measureElement(entry.root);
    }
    adoptSceneChildren(host);
    virtualizer.measureElement(null);
    if (anchorOnNextRender && keyed.size) {
      anchorOnNextRender = false;
      scrollPinnedActive();
    }
  });

  onMount(() => {
    mounted = true;
    const geometryCheck = requestAnimationFrame(() => {
      if (!disposed && items.length && !readGeometry()) {
        throw new Error("The active presentation does not define virtual collection geometry.");
      }
    });
    const unmount = virtualizer._didMount();
    virtualCollectionOpenHandlers.set(host, handleCollectionOpen);
    virtualizer._willUpdate();
    schedule();
    return () => {
      mounted = false;
      cancelAnimationFrame(geometryCheck);
      virtualCollectionOpenHandlers.delete(host);
      unmount();
    };
  });

  registerCleanup(() => {
    disposed = true;
    if (fallback) disposeEntry(fallback);
    fallback = undefined;
    clear();
  });

  return space;
}

function sameVirtualGeometry(
  left: VirtualCollectionGeometry | undefined,
  right: VirtualCollectionGeometry,
): boolean {
  return (
    left?.axis === right.axis &&
    left.estimate === right.estimate &&
    left.gap === right.gap &&
    left.lanes === right.lanes
  );
}

function positionVirtualItem(
  element: HTMLElement,
  index: number,
  count: number,
  start: number,
  lane: number,
  geometry: VirtualCollectionGeometry,
) {
  setAttributeIfChanged(element, "data-virtual-index", String(index));
  const position = virtualItemPosition(start, lane, geometry);
  element.style.position = "absolute";
  element.style.insetInlineStart = position.insetInlineStart;
  element.style.insetBlockStart = position.insetBlockStart;
  element.style.inlineSize = position.inlineSize;
  element.style.blockSize = position.blockSize;
  const role = element.getAttribute("role");
  if (role === "option" || role === "listitem" || role === "row" || role === "treeitem") {
    setAttributeIfChanged(element, "aria-posinset", String(index + 1));
    setAttributeIfChanged(element, "aria-setsize", String(count));
  }
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function virtualItemPosition(
  start: number,
  lane: number,
  geometry: VirtualCollectionGeometry,
): {
  insetInlineStart: string;
  insetBlockStart: string;
  inlineSize: string;
  blockSize: string;
} {
  if (geometry.axis === "inline") {
    const insetInlineStart = `${start}px`;
    const inlineSize = "";
    if (geometry.lanes === 1) {
      return { insetInlineStart, inlineSize, insetBlockStart: "0px", blockSize: "100%" };
    }
    const share = 100 / geometry.lanes;
    const sizeGap = ((geometry.lanes - 1) * geometry.gap) / geometry.lanes;
    const offsetGap = (lane * geometry.gap) / geometry.lanes;
    return {
      insetInlineStart,
      inlineSize,
      insetBlockStart: `calc(${lane * share}% + ${offsetGap}px)`,
      blockSize: `calc(${share}% - ${sizeGap}px)`,
    };
  }
  const insetBlockStart = `${start}px`;
  const blockSize = "";
  if (geometry.lanes === 1) {
    return { insetBlockStart, blockSize, insetInlineStart: "0px", inlineSize: "100%" };
  }
  const share = 100 / geometry.lanes;
  const sizeGap = ((geometry.lanes - 1) * geometry.gap) / geometry.lanes;
  const offsetGap = (lane * geometry.gap) / geometry.lanes;
  return {
    insetBlockStart,
    blockSize,
    insetInlineStart: `calc(${lane * share}% + ${offsetGap}px)`,
    inlineSize: `calc(${share}% - ${sizeGap}px)`,
  };
}

export function Show(props: { when: unknown; children: Child; fallback?: Child }): JSXElement {
  if (typeof document === "undefined") {
    return (readCondition(props.when) ? props.children : props.fallback) as JSXElement;
  }
  const start = document.createComment("show");
  const end = document.createComment("/show");
  const parent = document.createDocumentFragment();
  parent.append(start, end);
  type Branch = "shown" | "fallback";
  let active: { branch: Branch; scope: ScopedNodes } | undefined;
  const exiting = new Map<Branch, { scope: ScopedNodes; retention: RetainedPresence }>();

  const disposeScope = (scope: ScopedNodes) => {
    scope.dispose();
    for (const node of scope.nodes) node.parentNode?.removeChild(node);
  };

  const startExit = (branch: Branch, scope: ScopedNodes) => {
    if (!shouldRetainForExit(scope.nodes)) {
      disposeScope(scope);
      return;
    }
    let retention: RetainedPresence;
    retention = retainForExit(scope.nodes, () => {
      scope.dispose();
      if (exiting.get(branch)?.retention === retention) exiting.delete(branch);
    });
    exiting.set(branch, { scope, retention });
  };

  blockEffect(() => {
    const visible = readCondition(props.when);
    const nextBranch: Branch = visible ? "shown" : "fallback";
    if (active?.branch === nextBranch) return;

    if (active) startExit(active.branch, active.scope);

    const retained = exiting.get(nextBranch);
    let scope: ScopedNodes;
    if (retained) {
      exiting.delete(nextBranch);
      retained.retention.restore();
      scope = retained.scope;
    } else {
      scope = createScopedNodes(() => resolveChild(visible ? props.children : props.fallback));
      markPresenceState(scope.nodes, "entering");
    }
    for (const node of scope.nodes) end.parentNode?.insertBefore(node, end);
    if (end.parentElement) adoptSceneChildren(end.parentElement);
    scope.mount();
    if (!retained) queuePresenceTarget(() => markPresenceState(scope.nodes, "entered"));
    active = { branch: nextBranch, scope };
  });

  registerCleanup(() => {
    if (active) disposeScope(active.scope);
    active = undefined;
    for (const { retention } of exiting.values()) retention.finish();
    exiting.clear();
  });

  return parent as unknown as JSXElement;
}

function readCondition(value: unknown): boolean {
  return Boolean(typeof value === "function" ? (value as () => unknown)() : read(value));
}

function shouldRetainForExit(nodes: Node[]): boolean {
  if (prefersReducedMotion()) return false;
  return presenceElements(nodes).length > 0;
}

function retainForExit(nodes: Node[], onDone: () => void): RetainedPresence {
  const elements = presenceElements(nodes);
  markPresenceState(nodes, "exiting");

  let settled = false;
  let waiting: PresenceWait | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    waiting?.cancel();
    for (const node of nodes) node.parentNode?.removeChild(node);
    onDone();
  };

  waiting = waitForPresenceFinish(elements, finish);
  return {
    finish,
    restore() {
      if (settled) return;
      settled = true;
      waiting?.restore();
      markPresenceState(nodes, "entered", true);
    },
  };
}

type PresenceWait = {
  cancel(): void;
  restore(): void;
};

function waitForPresenceFinish(elements: HTMLElement[], onDone: () => void): PresenceWait {
  const roots = elements.filter(
    (element) => !elements.some((parent) => parent !== element && parent.contains(element)),
  );
  let stopped = false;
  const stopLifecycle = roots.length ? waitForLifecycleFinish(roots, onDone) : undefined;
  if (!roots.length) queueMicrotask(onDone);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopLifecycle?.();
  };
  return {
    cancel: stop,
    restore: stop,
  };
}

function waitForLifecycleFinish(elements: HTMLElement[], onDone: () => void): () => void {
  let remaining = elements.length;
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    remaining -= 1;
    if (remaining > 0) return;
    stopped = true;
    for (const stop of stops) stop();
    onDone();
  };
  const stops = elements.map((element) => onPresentationExit(element, finish));
  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of stops) stop();
  };
}

function markPresenceState(
  nodes: Node[],
  state: "entering" | "entered" | "exiting",
  _restoring = false,
) {
  for (const element of presenceElements(nodes)) {
    setSceneElementPresence(
      element,
      state === "entered" ? "present" : state === "exiting" ? "exiting" : "entering",
    );
    if (state === "exiting") {
      if (!retainedPresenceSemantics.has(element)) {
        retainedPresenceSemantics.set(element, {
          ariaHidden: element.getAttribute("aria-hidden"),
          inert: element.hasAttribute("inert"),
        });
      }
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    } else {
      const semantics = retainedPresenceSemantics.get(element);
      if (!semantics) continue;
      retainedPresenceSemantics.delete(element);
      if (semantics.ariaHidden == null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", semantics.ariaHidden);
      if (!semantics.inert) element.removeAttribute("inert");
    }
  }
}

function presenceElements(nodes: Node[]): HTMLElement[] {
  const elements: HTMLElement[] = [];
  for (const node of nodes) collectPresenceElements(node, elements);
  return elements;
}

function collectPresenceElements(node: Node, elements: HTMLElement[]) {
  if (!isHtmlElement(node)) return;
  if (hasPresentationPresence(node)) elements.push(node);
  for (const child of Array.from(node.childNodes)) collectPresenceElements(child, elements);
}

function isHtmlElement(node: unknown): node is HTMLElement {
  return typeof HTMLElement !== "undefined" && node instanceof HTMLElement;
}

function queuePresenceTarget(fn: () => void) {
  queueMicrotask(fn);
}

function requestPresenceFrame(fn: () => void) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

function createNode(type: string | ErasedComponent, props: Props): Child {
  if (typeof type === "function") return untrack(() => type(props as never));

  const hydration = currentHydration;
  if (hydration) {
    return Object.freeze({ [hydrationElement]: true, type, props }) as unknown as Child;
  }
  return populateElement(document.createElement(type), props, false);
}

function populateElement(element: HTMLElement, props: Props, hydrating: boolean): HTMLElement {
  const { children, __kitStructuralChildren, __kitScene, ...attributes } = props;

  if (__kitScene) {
    const registration = __kitScene as SceneElementRegistration;
    mountPresenceElement(element, registration, currentChildHost);
    registerCleanup(() => unmountPresenceElement(element, registration.scene));
  }

  for (const [name, value] of Object.entries(attributes)) {
    applyProp(element, name, value);
  }

  const previousHost = currentChildHost;
  currentChildHost = element;
  try {
    const resolvedChildren =
      __kitStructuralChildren === true && typeof children === "function"
        ? untrack(() => resolveChild(children))
        : children;
    const nodes = toNodes(resolvedChildren);
    if (hydrating) element.replaceChildren(...nodes);
    else element.append(...nodes);
    adoptSceneChildren(element);
  } finally {
    currentChildHost = previousHost;
  }
  return element;
}

function materializeHydrationElement(value: HydrationElement): HTMLElement {
  const hydration = currentHydration;
  return hydration
    ? populateElement(claimHydrationElement(hydration, value.type), value.props, true)
    : populateElement(document.createElement(value.type), value.props, false);
}

function isHydrationElement(value: unknown): value is HydrationElement {
  return Boolean(value && typeof value === "object" && hydrationElement in value);
}

function applyProp(element: HTMLElement, name: string, value: unknown) {
  if (name === "ref" && typeof value === "function") {
    const cleanup = value(element);
    if (typeof cleanup === "function") registerCleanup(cleanup);
    return;
  }

  if (name === "className") {
    bindValue((next) => {
      setAttributeIfChanged(element, "class", stringify(next));
    }, value);
    return;
  }

  if (name === "style") {
    bindStyle(element, value);
    return;
  }

  if (name === "hidden") {
    bindHidden(element, value);
    return;
  }

  if (name.startsWith("on") && typeof value === "function") {
    const eventName = eventNameForProp(name);
    element.addEventListener(eventName, value as EventListener);
    registerCleanup(() => element.removeEventListener(eventName, value as EventListener));
    return;
  }

  const attributeName = attributeNameForProp(name);
  bindValue((next) => {
    const ariaAttribute = attributeName.startsWith("aria-");
    if ((next === false && !ariaAttribute) || next == null) {
      if (element.hasAttribute(attributeName)) element.removeAttribute(attributeName);
      return;
    }
    if (ariaAttribute && typeof next === "boolean") {
      setAttributeIfChanged(element, attributeName, next ? "true" : "false");
      return;
    }
    if (attributeName === name && name in element) {
      try {
        const current = Reflect.get(element, name);
        if (needsNativePropertyWrite(current, next, element.getAttribute(attributeName))) {
          Reflect.set(element, name, next);
        }
        return;
      } catch {}
    }
    setAttributeIfChanged(element, attributeName, next === true ? "" : stringify(next));
  }, value);
}

/** @internal Distinguishes an authored empty reflected attribute from a missing one. */
export function needsNativePropertyWrite(
  current: unknown,
  next: unknown,
  attribute: string | null,
): boolean {
  return !Object.is(current, next) || (typeof next === "string" && attribute !== next);
}

function attributeNameForProp(name: string): string {
  switch (name) {
    case "popoverTarget":
      return "popovertarget";
    case "popoverTargetAction":
      return "popovertargetaction";
    default:
      return name;
  }
}

function eventNameForProp(name: string): string {
  const eventName = name.slice(2).toLowerCase();
  return eventName === "doubleclick" ? "dblclick" : eventName;
}

function bindStyle(element: HTMLElement, value: unknown) {
  let previousKeys = new Set<string>();
  bindValue((next) => {
    if (typeof next === "string") {
      setAttributeIfChanged(element, "style", next);
      previousKeys.clear();
      return;
    }
    if (!next || typeof next !== "object") {
      if (element.hasAttribute("style")) element.removeAttribute("style");
      previousKeys.clear();
      return;
    }
    const entries = Object.entries(next as Record<string, unknown>);
    const keys = new Set(entries.map(([key]) => key));
    for (const key of previousKeys) {
      if (keys.has(key)) continue;
      if (key.startsWith("--")) element.style.removeProperty(key);
      else Reflect.set(element.style, key, "");
    }
    for (const [key, styleValue] of entries) {
      if (key.startsWith("--")) {
        const resolved = styleValue == null ? "" : String(styleValue);
        if (element.style.getPropertyValue(key) === resolved) continue;
        if (!resolved) element.style.removeProperty(key);
        else element.style.setProperty(key, resolved);
      } else {
        const resolved = styleValue == null ? "" : String(styleValue);
        if (Reflect.get(element.style, key) !== resolved) Reflect.set(element.style, key, resolved);
      }
    }
    previousKeys = keys;
  }, value);
}

function bindHidden(element: HTMLElement, value: unknown) {
  let initialized = false;
  let currentHidden = element.hasAttribute("hidden");
  let targetHidden = currentHidden;
  let stopExit: PresenceWait | undefined;

  const stopPendingExit = (restore = false) => {
    if (restore) stopExit?.restore();
    else stopExit?.cancel();
    stopExit = undefined;
  };

  bindValue((next) => {
    const hidden = Boolean(next);

    if (!initialized) {
      initialized = true;
      currentHidden = hidden;
      targetHidden = hidden;
      setHiddenAttribute(element, hidden);
      return;
    }

    if (hidden === targetHidden) return;
    targetHidden = hidden;
    const restoring = !hidden && Boolean(stopExit);
    stopPendingExit(restoring);

    if (hidden) {
      if (currentHidden) return;
      if (!shouldRetainElementForExit(element)) {
        setHiddenAttribute(element, true);
        currentHidden = true;
        return;
      }

      markPresenceState([element], "exiting");
      stopExit = waitForPresenceFinish([element], () => {
        stopExit = undefined;
        if (!targetHidden) return;
        setHiddenAttribute(element, true);
        currentHidden = true;
      });
      return;
    }

    setHiddenAttribute(element, false);
    currentHidden = false;
    markPresenceState([element], "entering", restoring);
    queuePresenceTarget(() => {
      if (!targetHidden) markPresenceState([element], "entered", restoring);
    });
  }, value);

  registerCleanup(() => stopPendingExit());
}

function notifyVirtualCollectionsOpened(layer: HTMLElement): void {
  for (const candidate of layer.querySelectorAll<HTMLElement>("*")) {
    const handler = virtualCollectionOpenHandlers.get(candidate);
    if (!handler) continue;
    handler();
  }
}

const documentScrollLocks = new WeakMap<
  Document,
  {
    count: number;
    readonly restore: () => void;
  }
>();

function retainDocumentScrollLock(document: Document): () => void {
  const active = documentScrollLocks.get(document);
  if (active) {
    active.count += 1;
  } else {
    const elements = [document.documentElement, document.body].filter(
      (element): element is HTMLElement => Boolean(element?.style),
    );
    const properties = ["overflow", "overscroll-behavior"] as const;
    const previous = elements.map((element) =>
      properties.map((property) => element.style.getPropertyValue(property)),
    );
    const body = document.body;
    const previousBodyPadding = body?.style.getPropertyValue("padding-inline-end") ?? "";
    const viewportWidth = document.defaultView?.innerWidth;
    const clientWidth = document.documentElement?.clientWidth;
    const scrollbarWidth =
      typeof viewportWidth === "number" && typeof clientWidth === "number"
        ? Math.max(0, viewportWidth - clientWidth)
        : 0;
    for (const element of elements) {
      element.style.setProperty("overflow", "hidden");
      element.style.setProperty("overscroll-behavior", "none");
    }
    if (body && scrollbarWidth > 0) {
      const padding = document.defaultView?.getComputedStyle(body).paddingInlineEnd || "0px";
      body.style.setProperty("padding-inline-end", `calc(${padding} + ${scrollbarWidth}px)`);
    }
    documentScrollLocks.set(document, {
      count: 1,
      restore() {
        elements.forEach((element, elementIndex) => {
          properties.forEach((property, propertyIndex) => {
            const value = previous[elementIndex]?.[propertyIndex] ?? "";
            if (value) element.style.setProperty(property, value);
            else element.style.removeProperty(property);
          });
        });
        if (body) {
          if (previousBodyPadding) {
            body.style.setProperty("padding-inline-end", previousBodyPadding);
          } else {
            body.style.removeProperty("padding-inline-end");
          }
        }
      },
    });
  }

  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    const lock = documentScrollLocks.get(document);
    if (!lock) return;
    lock.count -= 1;
    if (lock.count > 0) return;
    lock.restore();
    documentScrollLocks.delete(document);
  };
}

export function mountDialog(
  element: HTMLDialogElement,
  value: false | "modal" | "nonmodal" | (() => false | "modal" | "nonmodal"),
) {
  if (!(element instanceof HTMLDialogElement)) {
    throw new TypeError("mountDialog requires a <dialog> element.");
  }

  let initialized = false;
  let targetMode: false | "modal" | "nonmodal" = false;
  let currentMode: false | "modal" | "nonmodal" = false;
  let invoker: HTMLElement | null = null;
  let revision = 0;
  let programmaticCloses = 0;
  let browserMode: false | "modal" | "nonmodal" = false;
  let releaseScrollLock: (() => void) | undefined;
  let cancelPendingExit: (() => void) | undefined;
  const restoring = isHotRefresh();

  const suppressProgrammaticClose = (event: Event) => {
    if (programmaticCloses === 0) return;
    programmaticCloses -= 1;
    event.stopImmediatePropagation();
  };
  element.addEventListener("close", suppressProgrammaticClose, true);
  registerCleanup(() => element.removeEventListener("close", suppressProgrammaticClose, true));

  const resetOpenMode = () => {
    if (element.open) {
      programmaticCloses += 1;
      element.close();
    }
    browserMode = false;
    releaseScrollLock?.();
    releaseScrollLock = undefined;
  };
  const cancelExit = () => {
    cancelPendingExit?.();
    cancelPendingExit = undefined;
  };
  const show = (mode: "modal" | "nonmodal") => {
    cancelExit();
    if (currentMode === mode && element.open) {
      element.hidden = false;
      setSceneElementVisible(element, true);
      element.removeAttribute("aria-hidden");
      element.removeAttribute("inert");
      if (mode === "modal" && !element.contains(document.activeElement)) {
        focusDialogDefault(element);
      }
      return;
    }
    const entering = currentMode === false;

    if (element.open && browserMode === "modal") {
      currentMode = mode;
      if (mode === "nonmodal") {
        // Keep the retained node and document lock, but leave the modal top
        // layer so the inert exit surface cannot block a reversible trigger.
        programmaticCloses += 1;
        element.close();
        try {
          element.show();
          browserMode = "nonmodal";
        } catch {
          browserMode = false;
        }
        element.setAttribute("aria-hidden", "true");
        element.setAttribute("inert", "");
        restoreLayerFocus(invoker);
      } else {
        element.removeAttribute("aria-hidden");
        element.removeAttribute("inert");
        focusDialogDefault(element);
      }
      return;
    }

    resetOpenMode();
    element.hidden = false;
    setSceneElementVisible(element, true);
    if (!invoker) invoker = resolveLayerInvoker(element);
    element.removeAttribute("aria-hidden");
    element.removeAttribute("inert");
    try {
      if (mode === "modal") element.showModal();
      else element.show();
    } catch {
      if (mode === "modal" && restoring) {
        releaseScrollLock ??= retainDocumentScrollLock(element.ownerDocument ?? document);
        requestPresenceFrame(() => {
          if (targetMode === mode && element.isConnected) show(mode);
        });
      }
      return;
    }
    browserMode = mode;
    if (mode === "modal") {
      releaseScrollLock = retainDocumentScrollLock(element.ownerDocument ?? document);
    }
    currentMode = mode;

    if (mode === "nonmodal") {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
      restoreLayerFocus(invoker);
      return;
    }

    focusDialogDefault(element);
    if (entering) {
      notifyVirtualCollectionsOpened(element);
      queuePresenceTarget(() => {
        if (!element.open || currentMode !== "modal") return;
        if (!element.contains(document.activeElement)) focusDialogDefault(element);
      });
    }
  };
  const close = () => {
    cancelExit();
    resetOpenMode();
    currentMode = false;
    element.removeAttribute("aria-hidden");
    element.removeAttribute("inert");
    restoreLayerFocus(invoker);
    setSceneElementVisible(element, false);
    element.hidden = true;
  };
  const beginClose = (currentRevision: number) => {
    if (prefersReducedMotion() || !hasPresentationPresence(element) || element.hidden) {
      close();
      return;
    }

    cancelExit();
    if (element.open && browserMode === "modal") show("nonmodal");
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
    const finish = () => {
      if (targetMode || currentRevision !== revision) return;
      close();
    };
    const stopPresentation = onPresentationExit(element, finish);
    cancelPendingExit = () => {
      stopPresentation();
    };
  };

  registerCleanup(() => {
    cancelExit();
    resetOpenMode();
    currentMode = false;
  });

  bindValue((next) => {
    const mode = next === "modal" || next === "nonmodal" ? next : false;
    if (initialized && mode === targetMode) return;
    targetMode = mode;
    const currentRevision = ++revision;

    if (mode) {
      if (currentMode !== false || element.open) {
        show(mode);
        initialized = true;
        return;
      }
      if (restoring) show(mode);
      else {
        requestPresenceFrame(() => {
          if (targetMode === mode && element.isConnected) show(mode);
        });
      }
      initialized = true;
      return;
    }

    if (!initialized || (!element.open && currentMode === false)) {
      setSceneElementVisible(element, false);
      element.hidden = true;
      initialized = true;
      return;
    }
    if (!targetMode && currentRevision === revision) beginClose(currentRevision);
  }, value);
}

function focusDialogDefault(dialog: HTMLDialogElement): void {
  const target = dialog.querySelector<HTMLElement>("[autofocus]:not([disabled])");
  if (!target?.isConnected) return;
  target.focus({ preventScroll: true });
}

function resolveLayerInvoker(layer: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (layer.id) {
    const controllers = [...document.querySelectorAll<HTMLElement>("[aria-controls]")].filter(
      (candidate) =>
        (candidate.getAttribute("aria-controls") ?? "").split(/\s+/).includes(layer.id),
    );
    const activeController = controllers.find((candidate) => candidate === active);
    if (activeController) return activeController;
    if (controllers.length === 1) return controllers[0]!;
  }
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement &&
    !layer.contains(active)
  ) {
    return active;
  }
  return null;
}

function restoreLayerFocus(invoker: HTMLElement | null): void {
  if (!invoker?.isConnected) return;
  invoker.focus({ preventScroll: true });
  queueMicrotask(() => {
    if (invoker.isConnected && document.activeElement !== invoker) {
      invoker.focus({ preventScroll: true });
    }
  });
}

function shouldRetainElementForExit(element: HTMLElement): boolean {
  if (prefersReducedMotion()) return false;
  return hasPresentationPresence(element);
}

function setHiddenAttribute(element: HTMLElement, hidden: boolean) {
  setSceneElementVisible(element, !hidden);
  try {
    element.hidden = hidden;
  } catch {}

  if (hidden) element.setAttribute("hidden", "");
  else element.removeAttribute("hidden");
}

function bindValue(set: (value: unknown) => void, value: unknown) {
  if (typeof value === "function") {
    effect(() => set((value as () => unknown)()));
  } else {
    set(value);
  }
}

function resolveChild(child: Child): Child {
  return typeof child === "function" ? resolveChild(child()) : child;
}

function toNodes(child: Child): Node[] {
  if (typeof child === "function") return dynamicNodes(child);

  const resolved = resolveChild(child);
  if (resolved == null || resolved === false || resolved === true) return [];
  if (Array.isArray(resolved)) return resolved.flatMap(toNodes);
  if (isHydrationElement(resolved)) return [materializeHydrationElement(resolved)];
  if (resolved instanceof Node && resolved.nodeType === 11) {
    return Array.from(resolved.childNodes);
  }
  if (resolved instanceof Node) return [resolved];
  const hydration = currentHydration;
  return [
    hydration
      ? claimHydrationText(hydration, String(resolved))
      : document.createTextNode(String(resolved)),
  ];
}

function dynamicNodes(readChild: () => Child): Node[] {
  const start = document.createComment("dynamic");
  const end = document.createComment("/dynamic");
  const parent = document.createDocumentFragment();
  parent.append(start, end);
  let rendered: Node[] = [];
  let renderedScope: ScopedNodes | undefined;
  let initial = true;

  blockEffect(() => {
    const resolved = resolveChild(readChild());
    const hydrate = initial ? currentHydration : null;
    initial = false;
    if (isScopedChild(resolved)) {
      const nextScope = createScopedNodes(resolved[scopedChild]);
      const nextNodes = nextScope.nodes;
      renderedScope?.dispose();
      replaceBetween(start, end, nextNodes);
      rendered = nextNodes;
      renderedScope = nextScope;
      untrack(() => nextScope.mount());
      return;
    }
    const text = primitiveText(resolved);
    if (text !== undefined && rendered.length === 1 && rendered[0]?.nodeType === Node.TEXT_NODE) {
      const current = rendered[0] as Text;
      if (current.data !== text) current.data = text;
      return;
    }
    const nextScope = text === undefined ? createScopedNodes(() => resolved) : undefined;
    const nextNodes = nextScope?.nodes ?? [
      hydrate ? claimHydrationText(hydrate, text!) : document.createTextNode(text!),
    ];
    renderedScope?.dispose();
    replaceBetween(start, end, nextNodes);
    rendered = nextNodes;
    renderedScope = nextScope;
    nextScope?.mount();
  });

  registerCleanup(() => {
    renderedScope?.dispose();
    renderedScope = undefined;
    for (const node of rendered) node.parentNode?.removeChild(node);
    rendered = [];
  });

  return [start, ...rendered, end];
}

function primitiveText(value: Child): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function isScopedChild(value: Child): value is Child & ScopedChild {
  return Boolean(value && typeof value === "object" && scopedChild in value);
}

function replaceBetween(start: Node, end: Node, nodes: Node[]) {
  let cursor = start.nextSibling;
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    cursor.parentNode?.removeChild(cursor);
    cursor = next;
  }
  start.parentNode?.insertBefore(document.createDocumentFragment(), end);
  for (const node of nodes) {
    end.parentNode?.insertBefore(node, end);
  }
  if (end.parentElement) adoptSceneChildren(end.parentElement);
}

function read<T>(value: T): T {
  const reactiveReader = reactiveValueReader<T>(value);
  if (reactiveReader) return reactiveReader();
  return value;
}

function readSource<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : read(value);
}

export function reactiveValue<T>(source: () => T): T {
  const initial = source();
  if (initial == null || typeof initial !== "object") return initial;

  const emptyTarget = Array.isArray(initial) ? [] : Object.create(null);
  return new Proxy(emptyTarget, {
    get(_target, prop, receiver) {
      if (prop === reactiveValueRead) return source;
      const value = source();
      if (value == null || typeof value !== "object") return undefined;
      const item = Reflect.get(value as object, prop, receiver);
      return typeof item === "function" ? item.bind(value) : item;
    },
    has(_target, prop) {
      const value = source();
      return value != null && typeof value === "object" && prop in value;
    },
    ownKeys() {
      const value = source();
      return value != null && typeof value === "object" ? Reflect.ownKeys(value) : [];
    },
    getOwnPropertyDescriptor(_target, prop) {
      const value = source();
      if (value == null || typeof value !== "object") return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() {
      const value = source();
      return value != null && typeof value === "object" ? Reflect.getPrototypeOf(value) : null;
    },
  }) as T;
}

function reactiveValueReader<T>(value: unknown): (() => T) | undefined {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) return;
  return (value as ReactiveValue<T>)[reactiveValueRead];
}

function stringify(value: unknown): string {
  return value == null ? "" : String(value);
}

function registerCleanup(cleanup: () => void) {
  if (currentLifecycleScope) currentLifecycleScope.cleanups.push(cleanup);
  else currentOwner?.cleanups.push(cleanup);
}

function blockEffect(fn: () => void | (() => void)) {
  const owner = currentOwner;
  const scope = currentLifecycleScope;
  const run = () => runInRuntimeContext(owner, scope, fn);
  if (currentHydration) {
    registerCleanup(alienEffect(run));
    return;
  }
  if (scope) {
    scope.cleanups.push(alienEffect(run));
    return;
  }
  if (owner) {
    owner.mounts.push(() => alienEffect(run));
    return;
  }
  queueMicrotask(() => {
    alienEffect(run);
  });
}

function runInRuntimeContext<T>(
  owner: Owner | null,
  scope: LifecycleScope | null,
  run: () => T,
): T {
  const previousOwner = currentOwner;
  const previousScope = currentLifecycleScope;
  currentOwner = owner;
  currentLifecycleScope = scope;
  try {
    return run();
  } finally {
    currentOwner = previousOwner;
    currentLifecycleScope = previousScope;
  }
}

function createHydrationContext(root: Element): HydrationContext | null {
  if (root.getAttribute("data-kit-rendering") !== "hydrate") return null;
  const elements = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-kit-h]")) {
    const identity = element.getAttribute("data-kit-h");
    if (!identity || elements.has(identity)) {
      throw new Error(`Invalid SSR element hydration identity ${JSON.stringify(identity)}.`);
    }
    elements.set(identity, element);
  }
  const textMarkers = new Map<string, Comment>();
  const visit = (node: Node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      const marker = (node as Comment).data;
      if (marker.startsWith("kit:")) {
        const identity = marker.slice("kit:".length);
        if (!identity || textMarkers.has(identity)) {
          throw new Error(`Invalid SSR text hydration identity ${JSON.stringify(identity)}.`);
        }
        if (node.nextSibling?.nodeType !== Node.TEXT_NODE) {
          node.parentNode?.insertBefore(document.createTextNode(""), node.nextSibling);
        }
        textMarkers.set(identity, node as Comment);
      }
    }
    for (const childNode of node.childNodes) visit(childNode);
  };
  visit(root);
  return {
    elements,
    textMarkers,
    elementOrder: [...elements],
    textOrder: [...textMarkers],
    elementCursor: 0,
    textCursor: 0,
  };
}

function claimHydrationElement(hydration: HydrationContext, tag: string): HTMLElement {
  const [identity = "end", element] = hydration.elementOrder[hydration.elementCursor++] ?? [];
  if (!element || element.localName !== tag) {
    throw new Error(
      `SSR hydration mismatch at ${identity}: expected <${tag}>, found ${element ? `<${element.localName}>` : "nothing"}.`,
    );
  }
  return element;
}

function claimHydrationText(hydration: HydrationContext, value: string): Text {
  const [identity = "end", marker] = hydration.textOrder[hydration.textCursor++] ?? [];
  const text = marker?.nextSibling;
  if (!marker || !(text instanceof Text) || text.data !== value) {
    throw new Error(
      `SSR hydration mismatch at ${identity}: expected ${JSON.stringify(value)}, found ${JSON.stringify(text?.textContent)}.`,
    );
  }
  marker.remove();
  return text;
}

function finishHydration(root: Element, hydration: HydrationContext): void {
  if (
    hydration.elementCursor !== hydration.elements.size ||
    hydration.textCursor !== hydration.textMarkers.size
  ) {
    throw new Error(
      `SSR hydration left unclaimed nodes: ${hydration.elements.size - hydration.elementCursor} elements and ${hydration.textMarkers.size - hydration.textCursor} text nodes.`,
    );
  }
  for (const element of hydration.elements.values()) element.removeAttribute("data-kit-h");
  root.setAttribute("data-kit-rendering", "hydrated");
  releaseServerStyles(root);
}

function releaseServerStyles(root: Element): void {
  const document = root.ownerDocument;
  const client = document.querySelector<HTMLStyleElement>("style[data-kit-presentation]");
  if (!client?.textContent) return;
  for (const style of document.querySelectorAll("style[data-kit-ssr]")) {
    style.remove();
  }
}

function createScopedNodes(readNodes: () => Child): ScopedNodes {
  const scope: LifecycleScope = {
    cleanups: [],
    mounts: [],
    disposed: false,
    mounted: false,
  };
  let nodes: Node[] = [];
  const previousScope = currentLifecycleScope;
  const previousSub = alienGetActiveSub();
  currentLifecycleScope = scope;
  alienSetActiveSub(undefined);
  try {
    const dispose = alienEffectScope(() => {
      nodes = toNodes(resolveChild(readNodes()));
    });
    scope.cleanups.push(dispose);
  } finally {
    alienSetActiveSub(previousSub);
    currentLifecycleScope = previousScope;
  }

  return {
    nodes,
    mount() {
      if (scope.mounted || scope.disposed) return;
      scope.mounted = true;
      const activeScope = currentLifecycleScope;
      currentLifecycleScope = scope;
      try {
        while (scope.mounts.length) {
          for (const mount of scope.mounts.splice(0)) {
            const cleanup = mount();
            if (typeof cleanup === "function") scope.cleanups.push(cleanup);
          }
        }
      } finally {
        currentLifecycleScope = activeScope;
      }
    },
    dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      scope.mounts.length = 0;
      for (const cleanup of scope.cleanups.splice(0)) cleanup();
    },
  };
}

export type {
  Child,
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "@/platforms/web/ui";
