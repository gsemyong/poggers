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

export function mountDrag(
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
