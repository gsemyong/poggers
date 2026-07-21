import { createDraggable } from "animejs";

import { mountDialog as mountRetainedDialog } from "@/adapters/web/ui/component/runtime";

export type DragAxis = "inline" | "block" | "both";

export type DragBounds = {
  readonly inline?: readonly [minimum: number, maximum: number];
  readonly block?: readonly [minimum: number, maximum: number];
};

export type DragSample = {
  readonly offset: number;
  readonly velocity: number;
  readonly progress: number;
  readonly inline: number;
  readonly block: number;
  readonly deltaInline: number;
  readonly deltaBlock: number;
  readonly velocityInline: number;
  readonly velocityBlock: number;
  readonly progressInline: number;
  readonly progressBlock: number;
};

export type DragRelease = DragSample;

export type DragOptions = {
  readonly axis: DragAxis;
  readonly bounds: () => DragBounds;
  readonly threshold?: number;
  /** Maximum reported velocity in logical pixels per second. */
  readonly maxVelocity?: number;
  readonly resistance?: number;
  readonly cursor?: { readonly idle: string; readonly active: string } | false;
  readonly start?: () => void;
  readonly change: (sample: DragSample) => void;
  readonly release: (sample: DragRelease) => void;
  readonly cancel?: () => void;
};

export type DragDriverMount = {
  readonly read: () => DragSample;
  readonly stop: () => void;
  readonly refresh: () => void;
  readonly dispose: () => void;
};

export type DragDriver = {
  mount(trigger: HTMLElement, options: DragOptions): DragDriverMount;
};

export type AnimeDraggable = {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly velocity: number;
  setX(value: number, muteCallbacks?: boolean): unknown;
  setY(value: number, muteCallbacks?: boolean): unknown;
  stop(): unknown;
  refresh(): unknown;
  revert(): unknown;
};

export type AnimeDragParameters = {
  readonly trigger: HTMLElement;
  readonly x: false | { readonly modifier: (value: number) => number };
  readonly y: false | { readonly modifier: (value: number) => number };
  readonly dragThreshold: number;
  readonly maxVelocity: number;
  readonly dragSpeed: number;
  readonly cursor: false | { readonly onHover: string; readonly onGrab: string };
  readonly onGrab: (draggable: AnimeDraggable) => void;
  readonly onDrag: (draggable: AnimeDraggable) => void;
  readonly onUpdate: (draggable: AnimeDraggable) => void;
  readonly onRelease: (draggable: AnimeDraggable) => void;
};

export type AnimeDragFactory = (
  target: HTMLElement,
  parameters: AnimeDragParameters,
) => AnimeDraggable;

export type PressBindings = {
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly onClick: (event: MouseEvent) => void;
};

export type Shortcut = {
  readonly key: string;
  readonly modifiers?: readonly ("mod" | "shift" | "alt")[];
};

export type ShortcutBinding = {
  readonly aria: string;
  readonly handle: (event: KeyboardEvent) => void;
};

export type DialogMode = false | "modal" | "nonmodal";

export function mountDialog(element: HTMLDialogElement, readMode: () => DialogMode): void {
  mountRetainedDialog(element, readMode);
}

export function mountDrag(element: HTMLElement, options: DragOptions): Disposable {
  const dispose = mountAnimeDrag(element, options);
  return { [Symbol.dispose]: dispose };
}

export function createAnimeDragDriver(
  factory: AnimeDragFactory = createDraggable as AnimeDragFactory,
): DragDriver {
  return {
    mount(trigger, options) {
      const proxy = createDragProxy(trigger);
      const alignProxy = () => alignDragProxy(proxy, trigger);
      alignProxy();
      trigger.addEventListener("pointerdown", alignProxy, true);
      let active = false;
      let disposed = false;
      let previousInline = 0;
      let previousBlock = 0;
      let latest = emptyDragSample();
      let currentBounds = normalizedDragBounds(options.bounds());
      const refreshBounds = () => {
        currentBounds = normalizedDragBounds(options.bounds());
      };
      const sample = (draggable: AnimeDraggable): DragSample => {
        const inline = clamp(draggable.x, ...currentBounds.inline);
        const block = clamp(draggable.y, ...currentBounds.block);
        const velocityInline = Math.cos(draggable.angle) * draggable.velocity * 1_000;
        const velocityBlock = Math.sin(draggable.angle) * draggable.velocity * 1_000;
        const primary = primarySample(options.axis, {
          inline,
          block,
          velocityInline,
          velocityBlock,
          progressInline: progress(inline, currentBounds.inline),
          progressBlock: progress(block, currentBounds.block),
        });
        latest = {
          ...primary,
          inline,
          block,
          deltaInline: inline - previousInline,
          deltaBlock: block - previousBlock,
          velocityInline: Number.isFinite(velocityInline) ? velocityInline : 0,
          velocityBlock: Number.isFinite(velocityBlock) ? velocityBlock : 0,
          progressInline: primary.progressInline,
          progressBlock: primary.progressBlock,
        };
        previousInline = inline;
        previousBlock = block;
        return latest;
      };
      const draggable = factory(proxy, {
        trigger,
        x:
          options.axis === "block"
            ? false
            : { modifier: (value) => clamp(value, ...currentBounds.inline) },
        y:
          options.axis === "inline"
            ? false
            : { modifier: (value) => clamp(value, ...currentBounds.block) },
        dragThreshold: Math.max(0, finiteOr(options.threshold, 3)),
        maxVelocity: Math.max(0, finiteOr(options.maxVelocity, 3_000)) / 1_000,
        dragSpeed: Math.max(0, finiteOr(options.resistance, 1)),
        cursor:
          options.cursor === false
            ? false
            : {
                onHover: options.cursor?.idle ?? "grab",
                onGrab: options.cursor?.active ?? "grabbing",
              },
        onGrab(instance) {
          if (disposed) return;
          refreshBounds();
          active = true;
          previousInline = 0;
          previousBlock = 0;
          if (options.axis !== "block") instance.setX(0, true);
          if (options.axis !== "inline") instance.setY(0, true);
          latest = emptyDragSample();
          options.start?.();
          options.change(latest);
        },
        onDrag() {},
        onUpdate(instance) {
          if (!active || disposed) return;
          options.change(sample(instance));
        },
        onRelease(instance) {
          if (!active || disposed) return;
          latest = sample(instance);
          active = false;
          instance.stop();
          resetDragPosition(instance, options.axis);
          options.release(latest);
        },
      });
      return {
        read: () => latest,
        stop() {
          if (disposed || !active) return;
          active = false;
          draggable.stop();
          resetDragPosition(draggable, options.axis);
          options.cancel?.();
        },
        refresh() {
          if (disposed) return;
          refreshBounds();
          alignProxy();
          draggable.refresh();
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          if (active) {
            active = false;
            options.cancel?.();
          }
          draggable.revert();
          trigger.removeEventListener("pointerdown", alignProxy, true);
          proxy.remove();
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

const animeDragDriver = createAnimeDragDriver();

function mountAnimeDrag(trigger: HTMLElement, options: DragOptions): () => void {
  return mountDragDriver(trigger, options, animeDragDriver);
}

function createDragProxy(trigger: HTMLElement): HTMLElement {
  const document = trigger.ownerDocument;
  if (!document?.body) {
    throw new TypeError("Anime drag requires a trigger attached to a document.");
  }
  const proxy = document.createElement("span");
  proxy.setAttribute("aria-hidden", "true");
  proxy.setAttribute(
    "style",
    "position:fixed;inset:auto;opacity:0;pointer-events:none;contain:strict",
  );
  document.body.append(proxy);
  return proxy;
}

function alignDragProxy(proxy: HTMLElement, trigger: HTMLElement): void {
  const bounds = trigger.getBoundingClientRect();
  proxy.style.left = `${finiteOr(bounds.left, 0)}px`;
  proxy.style.top = `${finiteOr(bounds.top, 0)}px`;
  proxy.style.width = `${Math.max(1, finiteOr(bounds.width, 1))}px`;
  proxy.style.height = `${Math.max(1, finiteOr(bounds.height, 1))}px`;
}

function resetDragPosition(draggable: AnimeDraggable, axis: DragAxis): void {
  if (axis !== "block") draggable.setX(0, true);
  if (axis !== "inline") draggable.setY(0, true);
}

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
