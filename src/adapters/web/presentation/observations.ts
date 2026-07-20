import { signal } from "alien-signals";

import type { WebPresentationElement, WebPresentationEnvironment } from "./language";

export type WebEnvironmentHost = Readonly<{
  value: WebPresentationEnvironment;
  geometryRevision(): number;
  dispose(): void;
}>;

export type WebElementObservationHost<ElementName extends string> = Readonly<{
  elements: Readonly<Record<ElementName, Readonly<{ name: ElementName }> & WebPresentationElement>>;
  inspect(): Readonly<Record<ElementName, WebElementSnapshot>>;
  dispose(): void;
}>;

export type WebElementSnapshot = Readonly<{
  cardinality: number;
  box: WebPresentationElement["box"];
  scroll: WebPresentationElement["scroll"];
  visibility: WebPresentationElement["visibility"];
  layout: WebPresentationElement["layout"];
  presence: WebPresentationElement["presence"];
}>;

type ObservationCell = {
  (): WebElementSnapshot;
  (value: WebElementSnapshot): void;
};

const zeroBox = Object.freeze({ inlineSize: 0, blockSize: 0, inlineStart: 0, blockStart: 0 });
const zeroScroll = Object.freeze({ inlineOffset: 0, blockOffset: 0 });
const hidden = Object.freeze({ intersecting: false, ratio: 0 });

/** Creates one live Environment shared by a mounted web UI boundary. */
export function createWebEnvironmentHost(boundary: Element): WebEnvironmentHost {
  const ownerDocument = boundary.ownerDocument;
  const view = ownerDocument?.defaultView;
  if (!ownerDocument || !view) {
    return { value: fallbackEnvironment(), geometryRevision: () => 0, dispose() {} };
  }

  const viewport = signal(readViewport(view));
  const safeArea = signal(readSafeArea(ownerDocument, boundary));
  const reducedMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)");
  const moreContrast = view.matchMedia?.("(prefers-contrast: more)");
  const lessContrast = view.matchMedia?.("(prefers-contrast: less)");
  const dark = view.matchMedia?.("(prefers-color-scheme: dark)");
  const hover = view.matchMedia?.("(hover: hover)");
  const fine = view.matchMedia?.("(pointer: fine)");
  const coarse = view.matchMedia?.("(pointer: coarse)");
  const preferences = signal(readPreferences(reducedMotion, moreContrast, lessContrast, dark));
  const input = signal(readInput(hover, fine, coarse));
  const cleanups: Array<() => void> = [];
  let frame: number | undefined;
  let revision = 0;
  let disposed = false;

  const updateGeometry = () => {
    frame = undefined;
    if (disposed) return;
    const changed =
      updateCell(viewport, readViewport(view)) |
      updateCell(safeArea, readSafeArea(ownerDocument, boundary));
    if (changed) revision += 1;
  };
  const scheduleGeometry = () => {
    if (frame === undefined) frame = view.requestAnimationFrame(updateGeometry);
  };
  view.addEventListener("resize", scheduleGeometry, { passive: true });
  cleanups.push(() => view.removeEventListener("resize", scheduleGeometry));
  view.visualViewport?.addEventListener("resize", scheduleGeometry, { passive: true });
  cleanups.push(() => view.visualViewport?.removeEventListener("resize", scheduleGeometry));

  const preferenceQueries = [reducedMotion, moreContrast, lessContrast, dark].filter(
    (query): query is MediaQueryList => !!query,
  );
  const updatePreferences = () =>
    updateCell(preferences, readPreferences(reducedMotion, moreContrast, lessContrast, dark));
  for (const query of preferenceQueries) {
    query.addEventListener("change", updatePreferences);
    cleanups.push(() => query.removeEventListener("change", updatePreferences));
  }
  const inputQueries = [hover, fine, coarse].filter((query): query is MediaQueryList => !!query);
  const updateInput = () => updateCell(input, readInput(hover, fine, coarse));
  for (const query of inputQueries) {
    query.addEventListener("change", updateInput);
    cleanups.push(() => query.removeEventListener("change", updateInput));
  }

  const value: WebPresentationEnvironment = Object.freeze({
    viewport: getters({
      inlineSize: () => viewport().inlineSize,
      blockSize: () => viewport().blockSize,
      scale: () => viewport().scale,
    }),
    safeArea: getters({
      blockStart: () => safeArea().blockStart,
      blockEnd: () => safeArea().blockEnd,
      inlineStart: () => safeArea().inlineStart,
      inlineEnd: () => safeArea().inlineEnd,
    }),
    preferences: getters({
      reducedMotion: () => preferences().reducedMotion,
      contrast: () => preferences().contrast,
      colorScheme: () => preferences().colorScheme,
    }),
    input: getters({
      hover: () => input().hover,
      pointer: () => input().pointer,
    }),
  });

  return {
    value,
    geometryRevision: () => revision,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

/** Creates cached observations for the named Elements in one Component session. */
export function createWebElementObservationHost<ElementName extends string>(
  boundary: Element,
  sources: Readonly<Record<ElementName, () => readonly Element[]>>,
  temporal?: Readonly<{
    layout(target: Element): WebPresentationElement["layout"];
    presence(target: Element): WebPresentationElement["presence"];
  }>,
): WebElementObservationHost<ElementName> {
  const ownerDocument = boundary.ownerDocument;
  const view = ownerDocument?.defaultView;
  const states = new Map<ElementName, ObservationCell>();
  const demanded = new Set<ElementName>();
  const visibility = new Map<ElementName, WebPresentationElement["visibility"]>();
  const cleanups: Array<() => void> = [];
  let frame: number | undefined;
  let disposed = false;

  const read = () => {
    frame = undefined;
    if (disposed) return;
    for (const name of demanded) {
      const source = sources[name];
      const targets = connected(source());
      const target = targets[0];
      const previous = states.get(name)!();
      const next = {
        cardinality: targets.length,
        box: target ? readObservableBox(target, previous.box) : zeroBox,
        scroll: target ? readScroll(target) : zeroScroll,
        visibility: visibility.get(name) ?? previous.visibility,
        layout: previous.layout,
        presence: previous.presence,
      };
      if (!sameElementSnapshot(previous, next)) states.get(name)!(next);
    }
  };
  const schedule = () => {
    if (frame !== undefined || disposed) return;
    if (view?.requestAnimationFrame) frame = view.requestAnimationFrame(read);
    else queueMicrotask(read);
  };

  for (const name of Object.keys(sources) as ElementName[]) {
    states.set(
      name,
      signal<WebElementSnapshot>({
        cardinality: 0,
        box: zeroBox,
        scroll: zeroScroll,
        visibility: hidden,
        layout: idleLayout(zeroBox),
        presence: idlePresence,
      }),
    );
  }

  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(schedule) : undefined;
  const intersectionObserver = view?.IntersectionObserver
    ? new view.IntersectionObserver((entries) => {
        for (const entry of entries) {
          for (const name of demanded) {
            const source = sources[name];
            if (!connected(source()).includes(entry.target)) continue;
            visibility.set(
              name,
              Object.freeze({ intersecting: entry.isIntersecting, ratio: entry.intersectionRatio }),
            );
          }
        }
        schedule();
      })
    : undefined;
  const observeSources = (refresh = true) => {
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    for (const name of demanded) {
      const source = sources[name];
      for (const target of connected(source())) {
        resizeObserver?.observe(target);
        intersectionObserver?.observe(target);
      }
    }
    if (refresh) schedule();
  };
  observeSources(false);

  const demand = (name: ElementName): WebElementSnapshot => {
    if (demanded.has(name)) return states.get(name)!();
    demanded.add(name);
    const source = sources[name];
    const targets = connected(source());
    const target = targets[0];
    const previous = states.get(name)!();
    states.get(name)!({
      ...previous,
      cardinality: targets.length,
      box: target ? readObservableBox(target, previous.box) : zeroBox,
      scroll: target ? readScroll(target) : zeroScroll,
    });
    observeSources(false);
    return states.get(name)!();
  };

  const onScroll = () => schedule();
  boundary.addEventListener("scroll", onScroll, { capture: true, passive: true });
  cleanups.push(() => boundary.removeEventListener("scroll", onScroll, { capture: true }));
  const mutationObserver = view?.MutationObserver
    ? new view.MutationObserver(() => observeSources())
    : undefined;
  mutationObserver?.observe(boundary, { childList: true, subtree: true });

  const elements = Object.fromEntries(
    [...states].map(([name]) => {
      const source = sources[name];
      const singular = () => {
        const current = demand(name);
        if (current.cardinality > 1) {
          throw new Error(
            `Presentation Element "${name}" has ${current.cardinality} instances; a singular observation is ambiguous.`,
          );
        }
        return current;
      };
      const target = () => connected(source())[0];
      const layout = () => {
        const current = target();
        return current && temporal ? temporal.layout(current) : undefined;
      };
      const presence = () => {
        const current = target();
        return current && temporal ? temporal.presence(current) : undefined;
      };
      return [
        name,
        Object.freeze({
          name,
          box: getters({
            inlineSize: () => singular().box.inlineSize,
            blockSize: () => singular().box.blockSize,
            inlineStart: () => singular().box.inlineStart,
            blockStart: () => singular().box.blockStart,
          }),
          scroll: getters({
            inlineOffset: () => singular().scroll.inlineOffset,
            blockOffset: () => singular().scroll.blockOffset,
          }),
          visibility: getters({
            intersecting: () => singular().visibility.intersecting,
            ratio: () => singular().visibility.ratio,
          }),
          layout: getters({
            current: () => layout()?.current ?? singular().box,
            destination: () => layout()?.destination ?? singular().box,
            velocity: () =>
              layout()?.velocity ?? {
                inlineStart: 0,
                blockStart: 0,
                inlineSize: 0,
                blockSize: 0,
              },
            progress: () => layout()?.progress ?? 1,
            kind: () => layout()?.kind ?? "idle",
            settled: () => layout()?.settled ?? true,
          }),
          presence: getters({
            value: () => presence()?.value ?? 1,
            velocity: () => presence()?.velocity ?? 0,
            settled: () => presence()?.settled ?? true,
            direction: () => presence()?.direction ?? "idle",
          }),
        }),
      ];
    }),
  ) as Record<ElementName, Readonly<{ name: ElementName }> & WebPresentationElement>;

  return {
    elements: Object.freeze(elements),
    inspect() {
      return Object.freeze(
        Object.fromEntries(
          [...states].map(([name, state]) => {
            const current = state();
            const targets = connected(sources[name]());
            const target = targets[0];
            const observed = {
              ...current,
              cardinality: targets.length,
              box: target ? readObservableBox(target, current.box) : zeroBox,
              scroll: target ? readScroll(target) : zeroScroll,
            };
            return [
              name,
              Object.freeze({
                ...observed,
                layout: target && temporal ? temporal.layout(target) : idleLayout(observed.box),
                presence: target && temporal ? temporal.presence(target) : idlePresence,
              }),
            ];
          }),
        ),
      ) as Readonly<Record<ElementName, WebElementSnapshot>>;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined && view?.cancelAnimationFrame) view.cancelAnimationFrame(frame);
      frame = undefined;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      mutationObserver?.disconnect();
      for (const cleanup of cleanups.splice(0)) cleanup();
      demanded.clear();
      states.clear();
    },
  };
}

function idleLayout(box: WebPresentationElement["box"]): WebPresentationElement["layout"] {
  return Object.freeze({
    current: box,
    destination: box,
    velocity: Object.freeze({
      inlineStart: 0,
      blockStart: 0,
      inlineSize: 0,
      blockSize: 0,
    }),
    progress: 1,
    kind: "idle",
    settled: true,
  });
}

const idlePresence = Object.freeze({
  value: 1,
  velocity: 0,
  settled: true,
  direction: "idle" as const,
});

function readViewport(view: Window): WebPresentationEnvironment["viewport"] {
  const viewport = view.visualViewport;
  return Object.freeze({
    inlineSize: viewport?.width ?? view.innerWidth,
    blockSize: viewport?.height ?? view.innerHeight,
    scale: viewport?.scale ?? 1,
  });
}

function readSafeArea(
  ownerDocument: Document,
  boundary: Element,
): WebPresentationEnvironment["safeArea"] {
  if (!ownerDocument.defaultView?.getComputedStyle || !ownerDocument.createElement) {
    return Object.freeze({ blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 });
  }
  const probe = ownerDocument.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding-block-start:env(safe-area-inset-top);" +
    "padding-block-end:env(safe-area-inset-bottom);" +
    "padding-inline-start:env(safe-area-inset-left);" +
    "padding-inline-end:env(safe-area-inset-right)";
  (boundary.parentElement ?? ownerDocument.documentElement).append(probe);
  const style = ownerDocument.defaultView.getComputedStyle(probe);
  const result = Object.freeze({
    blockStart: pixels(style.paddingBlockStart),
    blockEnd: pixels(style.paddingBlockEnd),
    inlineStart: pixels(style.paddingInlineStart),
    inlineEnd: pixels(style.paddingInlineEnd),
  });
  probe.remove();
  return result;
}

function readPreferences(
  reducedMotion: MediaQueryList | undefined,
  moreContrast: MediaQueryList | undefined,
  lessContrast: MediaQueryList | undefined,
  dark: MediaQueryList | undefined,
): WebPresentationEnvironment["preferences"] {
  return Object.freeze({
    reducedMotion: reducedMotion?.matches ?? false,
    contrast: moreContrast?.matches ? "more" : lessContrast?.matches ? "less" : "normal",
    colorScheme: dark?.matches ? "dark" : "light",
  });
}

function readInput(
  hover: MediaQueryList | undefined,
  fine: MediaQueryList | undefined,
  coarse: MediaQueryList | undefined,
): WebPresentationEnvironment["input"] {
  return Object.freeze({
    hover: hover?.matches ?? false,
    pointer: fine?.matches ? "fine" : coarse?.matches ? "coarse" : "none",
  });
}

function readBox(target: Element): WebPresentationElement["box"] {
  const rect = target.getBoundingClientRect?.();
  return Object.freeze({
    inlineSize: rect?.width ?? 0,
    blockSize: rect?.height ?? 0,
    inlineStart: rect?.left ?? 0,
    blockStart: rect?.top ?? 0,
  });
}

function readObservableBox(
  target: Element,
  previous: WebPresentationElement["box"],
): WebPresentationElement["box"] {
  const candidate = target as Element & { getClientRects?: () => ArrayLike<unknown> };
  if (typeof candidate.getClientRects === "function" && candidate.getClientRects().length === 0) {
    return previous;
  }
  return readBox(target);
}

function readScroll(target: Element): WebPresentationElement["scroll"] {
  const scroll = target as Element & { scrollLeft?: number; scrollTop?: number };
  return Object.freeze({
    inlineOffset: scroll.scrollLeft ?? 0,
    blockOffset: scroll.scrollTop ?? 0,
  });
}

function connected(targets: readonly Element[]): readonly Element[] {
  return targets.filter((target) => target.isConnected !== false);
}

function updateCell<Value extends Readonly<Record<string, unknown>>>(
  cell: { (): Value; (value: Value): void },
  value: Value,
): 0 | 1 {
  if (sameFlatRecord(cell(), value)) return 0;
  cell(value);
  return 1;
}

function sameElementSnapshot(left: WebElementSnapshot, right: WebElementSnapshot): boolean {
  return (
    left.cardinality === right.cardinality &&
    sameFlatRecord(left.box, right.box) &&
    sameFlatRecord(left.scroll, right.scroll) &&
    sameFlatRecord(left.visibility, right.visibility)
  );
}

function sameFlatRecord(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((name) => Object.is(left[name], right[name]))
  );
}

function getters<Values extends object>(fields: {
  readonly [Name in keyof Values]: () => Values[Name];
}): Readonly<Values> {
  const target = Object.create(null) as Values;
  for (const [name, read] of Object.entries(fields) as Array<
    [keyof Values, () => Values[keyof Values]]
  >) {
    Object.defineProperty(target, name, { enumerable: true, get: read });
  }
  return Object.freeze(target);
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fallbackEnvironment(): WebPresentationEnvironment {
  return Object.freeze({
    viewport: Object.freeze({ inlineSize: 0, blockSize: 0, scale: 1 }),
    safeArea: Object.freeze({ blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }),
    preferences: Object.freeze({
      reducedMotion: false,
      contrast: "normal",
      colorScheme: "light",
    }),
    input: Object.freeze({ hover: false, pointer: "none" }),
  });
}
