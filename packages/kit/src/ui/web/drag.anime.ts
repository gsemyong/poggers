import { createDraggable } from "animejs";

import {
  mountDrag,
  type DragAxis,
  type DragBounds,
  type DragDriver,
  type DragOptions,
  type DragSample,
} from "#ui/web/drag";

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
  readonly onRelease: (draggable: AnimeDraggable) => void;
};

export type AnimeDragFactory = (target: object, parameters: AnimeDragParameters) => AnimeDraggable;

export function createAnimeDragDriver(
  factory: AnimeDragFactory = createDraggable as AnimeDragFactory,
): DragDriver {
  return {
    mount(trigger, options) {
      const proxy = { x: 0, y: 0, width: 0, height: 0 };
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
        const velocityInline = Math.cos(draggable.angle) * draggable.velocity;
        const velocityBlock = Math.sin(draggable.angle) * draggable.velocity;
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
        maxVelocity: Math.max(0, finiteOr(options.maxVelocity, 3)),
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
        onDrag(instance) {
          if (!active || disposed) return;
          options.change(sample(instance));
        },
        onRelease(instance) {
          if (!active || disposed) return;
          latest = sample(instance);
          active = false;
          instance.stop();
          options.release(latest);
        },
      });
      return {
        read: () => latest,
        stop() {
          if (disposed || !active) return;
          active = false;
          draggable.stop();
          options.cancel?.();
        },
        refresh() {
          if (disposed) return;
          refreshBounds();
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
        },
      };
    },
  };
}

const animeDragDriver = createAnimeDragDriver();

export function mountAnimeDrag(trigger: HTMLElement, options: DragOptions): () => void {
  return mountDrag(trigger, options, animeDragDriver);
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
