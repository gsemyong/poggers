import { mountDialog as mountRetainedDialog } from "@/adapters/web/ui/component/runtime";
import type {
  DialogMode,
  DragAxis,
  DragBounds,
  DragOptions,
  DragSample,
  PressBindings,
  Shortcut,
  ShortcutBinding,
} from "@/platforms/web/ui";

export type DragDriverMount = {
  readonly read: () => DragSample;
  readonly stop: () => void;
  readonly refresh: () => void;
  readonly dispose: () => void;
};

export type DragDriver = {
  mount(trigger: HTMLElement, options: DragOptions): DragDriverMount;
};

export function mountDialog(element: HTMLDialogElement, readMode: () => DialogMode): void {
  mountRetainedDialog(element, readMode);
}

export function mountDrag(element: HTMLElement, options: DragOptions): Disposable {
  const dispose = mountDragDriver(element, options, pointerDragDriver);
  return { [Symbol.dispose]: dispose };
}

/** Creates the dependency-free Pointer Events driver used by the web adapter. */
export function createPointerDragDriver(): DragDriver {
  return {
    mount(trigger, options) {
      const idleCursor = options.cursor === false ? undefined : (options.cursor?.idle ?? "grab");
      const activeCursor =
        options.cursor === false ? undefined : (options.cursor?.active ?? "grabbing");
      const originalCursor = trigger.style.cursor;
      if (idleCursor) trigger.style.cursor = idleCursor;

      let bounds = normalizedDragBounds(options.bounds());
      let pointer: number | undefined;
      let started = false;
      let disposed = false;
      let startInline = 0;
      let startBlock = 0;
      let previousInline = 0;
      let previousBlock = 0;
      let previousTime = 0;
      let latest = emptyDragSample();

      const refresh = () => {
        bounds = normalizedDragBounds(options.bounds());
      };
      const releaseCapture = () => {
        if (pointer === undefined || !trigger.hasPointerCapture?.(pointer)) return;
        trigger.releasePointerCapture(pointer);
      };
      const complete = (cancelled: boolean, event?: PointerEvent) => {
        if (pointer === undefined) return;
        if (!cancelled && event) update(event);
        releaseCapture();
        pointer = undefined;
        if (idleCursor) trigger.style.cursor = idleCursor;
        if (!started) return;
        started = false;
        if (cancelled) options.cancel?.();
        else options.release(latest);
      };
      const update = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        const speed = Math.max(0, finiteOr(options.resistance, 1));
        const inline = clamp((event.clientX - startInline) * speed, ...bounds.inline);
        const block = clamp((event.clientY - startBlock) * speed, ...bounds.block);
        if (
          !started &&
          Math.hypot(inline - previousInline, block - previousBlock) <
            Math.max(0, finiteOr(options.threshold, 3))
        ) {
          return;
        }
        if (!started) {
          started = true;
          options.start?.();
          options.change(latest);
        }
        const elapsed = Math.max(1, event.timeStamp - previousTime);
        const maximum = Math.max(0, finiteOr(options.maxVelocity, 3_000));
        const velocityInline = clamp(
          ((inline - previousInline) / elapsed) * 1_000,
          -maximum,
          maximum,
        );
        const velocityBlock = clamp(((block - previousBlock) / elapsed) * 1_000, -maximum, maximum);
        const primary = primarySample(options.axis, {
          inline,
          block,
          velocityInline,
          velocityBlock,
          progressInline: progress(inline, bounds.inline),
          progressBlock: progress(block, bounds.block),
        });
        latest = {
          ...primary,
          inline,
          block,
          deltaInline: inline - previousInline,
          deltaBlock: block - previousBlock,
          velocityInline,
          velocityBlock,
          progressInline: primary.progressInline,
          progressBlock: primary.progressBlock,
        };
        previousInline = inline;
        previousBlock = block;
        previousTime = event.timeStamp;
        options.change(latest);
      };
      const onPointerDown = (event: PointerEvent) => {
        if (disposed || pointer !== undefined || event.button !== 0 || !event.isPrimary) return;
        refresh();
        pointer = event.pointerId;
        started = false;
        startInline = event.clientX;
        startBlock = event.clientY;
        previousInline = 0;
        previousBlock = 0;
        previousTime = event.timeStamp;
        latest = emptyDragSample();
        if (activeCursor) trigger.style.cursor = activeCursor;
        trigger.setPointerCapture?.(event.pointerId);
      };
      const onPointerMove = (event: PointerEvent) => {
        update(event);
        if (started) event.preventDefault();
      };
      const onPointerUp = (event: PointerEvent) => complete(false, event);
      const onPointerCancel = (event: PointerEvent) => {
        if (event.pointerId === pointer) complete(true);
      };

      trigger.addEventListener("pointerdown", onPointerDown);
      trigger.addEventListener("pointermove", onPointerMove);
      trigger.addEventListener("pointerup", onPointerUp);
      trigger.addEventListener("pointercancel", onPointerCancel);

      return {
        read: () => latest,
        stop: () => complete(true),
        refresh,
        dispose() {
          if (disposed) return;
          disposed = true;
          complete(true);
          trigger.removeEventListener("pointerdown", onPointerDown);
          trigger.removeEventListener("pointermove", onPointerMove);
          trigger.removeEventListener("pointerup", onPointerUp);
          trigger.removeEventListener("pointercancel", onPointerCancel);
          trigger.style.cursor = originalCursor;
        },
      };
    },
  };
}

export function mountDragDriver(
  trigger: HTMLElement,
  options: DragOptions,
  driver: DragDriver,
): () => void {
  if (!(trigger instanceof HTMLElement)) {
    throw new TypeError("mountDrag requires an HTMLElement trigger.");
  }
  const mounted = driver.mount(trigger, options);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    mounted.dispose();
  };
}

const pointerDragDriver = createPointerDragDriver();

function emptyDragSample(): DragSample {
  return {
    offset: 0,
    velocity: 0,
    progress: 0,
    inline: 0,
    block: 0,
    deltaInline: 0,
    deltaBlock: 0,
    velocityInline: 0,
    velocityBlock: 0,
    progressInline: 0,
    progressBlock: 0,
  };
}

function primarySample(
  axis: DragAxis,
  sample: {
    readonly inline: number;
    readonly block: number;
    readonly velocityInline: number;
    readonly velocityBlock: number;
    readonly progressInline: number;
    readonly progressBlock: number;
  },
): {
  readonly offset: number;
  readonly velocity: number;
  readonly progress: number;
  readonly progressInline: number;
  readonly progressBlock: number;
} {
  if (axis === "inline") {
    return {
      offset: sample.inline,
      velocity: sample.velocityInline,
      progress: sample.progressInline,
      progressInline: sample.progressInline,
      progressBlock: sample.progressBlock,
    };
  }
  if (axis === "block") {
    return {
      offset: sample.block,
      velocity: sample.velocityBlock,
      progress: sample.progressBlock,
      progressInline: sample.progressInline,
      progressBlock: sample.progressBlock,
    };
  }
  return {
    offset: Math.hypot(sample.inline, sample.block),
    velocity: Math.hypot(sample.velocityInline, sample.velocityBlock),
    progress: Math.max(sample.progressInline, sample.progressBlock),
    progressInline: sample.progressInline,
    progressBlock: sample.progressBlock,
  };
}

function normalizedDragBounds(bounds: DragBounds): {
  readonly inline: readonly [number, number];
  readonly block: readonly [number, number];
} {
  return { inline: normalizeRange(bounds.inline), block: normalizeRange(bounds.block) };
}

function normalizeRange(range: readonly [number, number] | undefined): readonly [number, number] {
  const first = finiteOr(range?.[0], 0);
  const second = finiteOr(range?.[1], first);
  return first <= second ? [first, second] : [second, first];
}

function progress(value: number, range: readonly [number, number]): number {
  const distance = range[1] - range[0];
  return distance <= 0 ? 0 : clamp((value - range[0]) / distance, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createPress(activate: () => void): PressBindings {
  let suppressPointerClick = false;
  return {
    onPointerDown(event) {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        interactionDisabled(event.currentTarget)
      ) {
        return;
      }
      suppressPointerClick = true;
      suppressFollowingPointerClick(event.currentTarget, () => {
        suppressPointerClick = false;
      });
      activate();
    },
    onClick(event) {
      if (interactionDisabled(event.currentTarget)) return;
      if (suppressPointerClick) {
        suppressPointerClick = false;
        event.preventDefault();
        return;
      }
      suppressPointerClick = false;
      activate();
    },
  };
}

function suppressFollowingPointerClick(target: EventTarget | null, release: () => void): void {
  const ownerDocument = (target as Node | null)?.ownerDocument;
  if (!ownerDocument) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    ownerDocument.removeEventListener("click", suppress, true);
    if (timeout !== undefined) clearTimeout(timeout);
    release();
  };
  const suppress = (event: MouseEvent) => {
    cleanup();
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  ownerDocument.addEventListener("click", suppress, true);
  timeout = setTimeout(cleanup, 1_000);
}

export function createShortcut(shortcut: Shortcut, activate: () => void): ShortcutBinding {
  const modifiers = new Set(shortcut.modifiers ?? []);
  const key = shortcut.key.toLowerCase();
  const ariaKey = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  const prefix = [
    ...(modifiers.has("shift") ? ["Shift"] : []),
    ...(modifiers.has("alt") ? ["Alt"] : []),
  ];
  const aria = modifiers.has("mod")
    ? [`Meta+${[...prefix, ariaKey].join("+")}`, `Control+${[...prefix, ariaKey].join("+")}`].join(
        " ",
      )
    : [...prefix, ariaKey].join("+");

  return {
    aria,
    handle(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.key.toLowerCase() !== key) return;
      if ((event.metaKey || event.ctrlKey) !== modifiers.has("mod")) return;
      if (event.shiftKey !== modifiers.has("shift")) return;
      if (event.altKey !== modifiers.has("alt")) return;
      event.preventDefault();
      activate();
    },
  };
}

function interactionDisabled(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as EventTarget & {
    disabled?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  return element.disabled === true || element.getAttribute?.("aria-disabled") === "true";
}
