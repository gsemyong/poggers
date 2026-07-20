export type WebFrameTask = (time: number) => void;

export type WebFrameHost = Readonly<{
  time(): number;
  now(): number;
  activate(task: WebFrameTask): void;
  deactivate(task: WebFrameTask): void;
  inspect(): Readonly<{ active: number; scheduled: boolean }>;
  dispose(): void;
}>;

export type WebFrameHostOptions = Readonly<{
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  queueTurn(callback: () => void): void;
}>;

/** Owns one clock and animation-frame request for a mounted web Presentation root. */
export function createWebFrameHost(options: WebFrameHostOptions): WebFrameHost {
  const active = new Set<WebFrameTask>();
  let turnTime: number | undefined;
  let dispatchTime: number | undefined;
  let frame: number | undefined;
  let disposed = false;

  const request = () => {
    if (disposed || frame !== undefined || active.size === 0) return;
    frame = options.requestFrame((time) => {
      frame = undefined;
      if (disposed) return;
      dispatchTime = finite(time, "frame time");
      let failed = false;
      let failure: unknown;
      try {
        for (const task of Array.from(active)) {
          if (!active.has(task)) continue;
          try {
            task(dispatchTime);
          } catch (error) {
            if (!failed) failure = error;
            failed = true;
          }
        }
      } finally {
        dispatchTime = undefined;
        request();
      }
      if (failed) throw failure;
    });
  };

  return {
    time() {
      if (disposed) throw new Error("Cannot sample a disposed web Presentation frame host.");
      if (dispatchTime !== undefined) return dispatchTime;
      if (turnTime === undefined) {
        turnTime = finite(options.now(), "turn time");
        options.queueTurn(() => {
          turnTime = undefined;
        });
      }
      return turnTime;
    },
    now() {
      return finite(options.now(), "time");
    },
    activate(task) {
      if (disposed) return;
      active.add(task);
      request();
    },
    deactivate(task) {
      active.delete(task);
      if (active.size === 0 && frame !== undefined) {
        options.cancelFrame(frame);
        frame = undefined;
      }
    },
    inspect() {
      return Object.freeze({ active: active.size, scheduled: frame !== undefined });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active.clear();
      if (frame !== undefined) options.cancelFrame(frame);
      frame = undefined;
      turnTime = undefined;
      dispatchTime = undefined;
    },
  };
}

/** Creates a root frame host from one mounted browser boundary. */
export function createNativeWebFrameHost(boundary: Element): WebFrameHost {
  const view = boundary.ownerDocument?.defaultView;
  const now = () => view?.performance?.now() ?? performance.now();
  return createWebFrameHost({
    now,
    requestFrame:
      view?.requestAnimationFrame.bind(view) ??
      ((callback) => setTimeout(() => callback(now()), 16) as unknown as number),
    cancelFrame: view?.cancelAnimationFrame.bind(view) ?? ((handle) => clearTimeout(handle)),
    queueTurn: queueMicrotask.bind(globalThis),
  });
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Web Presentation ${label} must be finite.`);
  }
  return value;
}
