import { describe, expect, it } from "vitest";

import { mountDrag, type DragDriver, type DragOptions, type DragSample } from "#ui/web/drag";
import { createAnimeDragDriver, type AnimeDragFactory } from "#ui/web/drag.anime";
import { createPress, createShortcut } from "#ui/web/interaction";

function createDragTrigger() {
  let appended: HTMLElement | undefined;
  let removed = 0;
  const attributes = new Map<string, string>();
  const listeners = new Map<string, EventListener>();
  const style: Record<string, string> = {};
  let bounds = { left: 100, top: 250, width: 40, height: 20 };
  const proxy = {
    hidden: false,
    style,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    remove() {
      removed++;
    },
  } as unknown as HTMLElement;
  const trigger = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.set(type, listener as EventListener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    getBoundingClientRect() {
      return bounds;
    },
    ownerDocument: {
      body: {
        append(element: HTMLElement) {
          appended = element;
        },
      },
      createElement() {
        return proxy;
      },
    },
  } as unknown as HTMLElement;
  return {
    trigger,
    proxy,
    appended: () => appended,
    removed: () => removed,
    emit(type: string) {
      listeners.get(type)?.({ type } as Event);
    },
    setBounds(next: typeof bounds) {
      bounds = next;
    },
    style,
  };
}

describe("web interaction toolkit", () => {
  it("activates mouse and pen on pointerdown while preserving touch and keyboard click", () => {
    let calls = 0;
    let prevented = 0;
    const target = {
      disabled: false,
      getAttribute: () => null,
    };
    const press = createPress(() => calls++);

    press.onPointerDown({
      button: 0,
      pointerType: "mouse",
      currentTarget: target,
    } as unknown as PointerEvent);
    expect(calls).toBe(1);
    press.onClick({
      detail: 1,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(1);
    expect(prevented).toBe(1);

    press.onPointerDown({
      button: 0,
      pointerType: "mouse",
      currentTarget: target,
    } as unknown as PointerEvent);
    press.onClick({
      detail: 0,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(2);
    expect(prevented).toBe(2);

    press.onPointerDown({
      button: 0,
      pointerType: "touch",
      currentTarget: target,
    } as unknown as PointerEvent);
    press.onClick({
      detail: 1,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(3);

    press.onClick({
      detail: 0,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(4);
  });

  it("consumes the pointer click before a pointerdown render can retarget it", () => {
    let capture: ((event: MouseEvent) => void) | undefined;
    const ownerDocument = {
      addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
        capture = listener as (event: MouseEvent) => void;
      },
      removeEventListener() {
        capture = undefined;
      },
    };
    const target = {
      disabled: false,
      getAttribute: () => null,
      ownerDocument,
    };
    let calls = 0;
    const press = createPress(() => calls++);

    press.onPointerDown({
      button: 0,
      pointerType: "mouse",
      currentTarget: target,
    } as unknown as PointerEvent);

    let prevented = 0;
    let stopped = 0;
    capture?.({
      detail: 1,
      preventDefault: () => prevented++,
      stopImmediatePropagation: () => stopped++,
    } as unknown as MouseEvent);

    expect(calls).toBe(1);
    expect(prevented).toBe(1);
    expect(stopped).toBe(1);

    press.onClick({
      detail: 0,
      currentTarget: target,
      preventDefault() {},
    } as unknown as MouseEvent);
    expect(calls).toBe(2);
  });

  it("maps the logical mod shortcut to Meta and Control", () => {
    let calls = 0;
    let prevented = 0;
    const shortcut = createShortcut({ key: "k", modifiers: ["mod"] }, () => calls++);
    const event = (overrides: Partial<KeyboardEvent> = {}) =>
      ({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
        repeat: false,
        isComposing: false,
        preventDefault: () => prevented++,
        ...overrides,
      }) as KeyboardEvent;

    expect(shortcut.aria).toBe("Meta+K Control+K");
    shortcut.handle(event());
    shortcut.handle(event({ metaKey: false }));
    shortcut.handle(event({ key: "j" }));
    shortcut.handle(event({ metaKey: false, ctrlKey: true }));
    expect(calls).toBe(2);
    expect(prevented).toBe(2);
  });

  it("owns one drag session and terminates it exactly once", () => {
    const original = globalThis.HTMLElement;
    class FakeElement {}
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeElement,
    });
    const calls: string[] = [];
    let mountedOptions: DragOptions | undefined;
    let driverDisposals = 0;
    const driver: DragDriver = {
      mount(_trigger, options) {
        mountedOptions = options;
        return {
          read: () => sample,
          stop: () => options.cancel?.(),
          refresh() {},
          dispose: () => {
            driverDisposals++;
          },
        };
      },
    };
    const sample: DragSample = {
      offset: 40,
      velocity: 0.72,
      progress: 0.4,
      inline: 0,
      block: 40,
      deltaInline: 0,
      deltaBlock: 8,
      velocityInline: 0,
      velocityBlock: 0.72,
      progressInline: 0,
      progressBlock: 0.4,
    };
    try {
      const dispose = mountDrag(
        new FakeElement() as HTMLElement,
        {
          axis: "block",
          bounds: () => ({ block: [0, 100] }),
          start: () => calls.push("start"),
          change: (next) => calls.push(`change:${next.block}`),
          release: (next) => calls.push(`release:${next.velocity}`),
          cancel: () => calls.push("cancel"),
        },
        driver,
      );
      mountedOptions?.start?.();
      mountedOptions?.change(sample);
      mountedOptions?.release(sample);
      dispose();
      dispose();
      expect(calls).toEqual(["start", "change:40", "release:0.72"]);
      expect(driverDisposals).toBe(1);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: original });
      } else {
        Reflect.deleteProperty(globalThis, "HTMLElement");
      }
    }
  });

  it("resets only enabled Anime axes and hands off the signed primary velocity", () => {
    let parameters: NonNullable<Parameters<AnimeDragFactory>[1]> | undefined;
    let setX = 0;
    let setY = 0;
    let stopped = 0;
    let reverted = 0;
    const instance = {
      x: 0,
      y: 40,
      angle: Math.PI / 2,
      velocity: 0.72,
      dragged: true,
      setX() {
        setX++;
      },
      setY() {
        setY++;
        return this;
      },
      update() {},
      stop() {
        stopped++;
        return this;
      },
      refresh() {},
      revert() {
        reverted++;
        return this;
      },
    };
    let target: HTMLElement | undefined;
    const driver = createAnimeDragDriver((nextTarget, next) => {
      target = nextTarget;
      parameters = next;
      return instance as never;
    });
    const drag = createDragTrigger();
    const releases: DragSample[] = [];
    const mounted = driver.mount(drag.trigger, {
      axis: "block",
      bounds: () => ({ block: [0, 100] }),
      change() {},
      release: (sample) => releases.push(sample),
    });

    parameters?.onGrab?.(instance as never);
    parameters?.onDrag?.(instance as never);
    parameters?.onUpdate?.(instance as never);
    parameters?.onRelease?.(instance as never);
    mounted.dispose();

    expect(setX).toBe(0);
    expect(setY).toBe(2);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ offset: 40, velocity: 0.72, progress: 0.4 });
    expect(stopped).toBe(1);
    expect(reverted).toBe(1);
    expect(target).toBe(drag.proxy);
    expect(drag.appended()).toBe(drag.proxy);
    expect(drag.proxy.hidden).toBe(false);
    expect(drag.proxy.getAttribute("aria-hidden")).toBe("true");
    expect(drag.proxy.getAttribute("style")).toContain("position:fixed");
    expect(drag.style).toMatchObject({
      left: "100px",
      top: "250px",
      width: "40px",
      height: "20px",
    });
    expect(drag.removed()).toBe(1);
  });

  it("samples Anime coordinates on its render update instead of its pre-render drag event", () => {
    let parameters: NonNullable<Parameters<AnimeDragFactory>[1]> | undefined;
    const changes: number[] = [];
    const instance = {
      x: 0,
      y: 0,
      angle: Math.PI / 2,
      velocity: 0,
      setX() {
        return this;
      },
      setY() {
        return this;
      },
      stop() {
        return this;
      },
      refresh() {},
      revert() {
        return this;
      },
    };
    const driver = createAnimeDragDriver((_, next) => {
      parameters = next;
      return instance as never;
    });
    const mounted = driver.mount(createDragTrigger().trigger, {
      axis: "block",
      bounds: () => ({ block: [0, 100] }),
      change: (sample) => changes.push(sample.block),
      release() {},
    });

    parameters?.onGrab(instance as never);
    instance.y = 40;
    parameters?.onDrag(instance as never);
    expect(changes).toEqual([0]);
    parameters?.onUpdate(instance as never);
    expect(changes).toEqual([0, 40]);

    mounted.dispose();
  });

  it("realigns the Anime proxy to a moved trigger before every drag", () => {
    let parameters: NonNullable<Parameters<AnimeDragFactory>[1]> | undefined;
    const instance = {
      x: 0,
      y: 0,
      angle: 0,
      velocity: 0,
      setX() {
        return this;
      },
      setY() {
        return this;
      },
      stop() {
        return this;
      },
      refresh() {},
      revert() {
        return this;
      },
    };
    const drag = createDragTrigger();
    const driver = createAnimeDragDriver((_, next) => {
      parameters = next;
      return instance as never;
    });
    const mounted = driver.mount(drag.trigger, {
      axis: "block",
      bounds: () => ({ block: [0, 500] }),
      change() {},
      release() {},
    });

    drag.setBounds({ left: 16, top: 454, width: 358, height: 24 });
    drag.emit("pointerdown");
    parameters?.onGrab(instance as never);

    expect(drag.style).toMatchObject({
      left: "16px",
      top: "454px",
      width: "358px",
      height: "24px",
    });

    mounted.dispose();
  });

  it("measures Anime drag bounds once per gesture instead of once per sample", () => {
    let parameters: NonNullable<Parameters<AnimeDragFactory>[1]> | undefined;
    let boundsReads = 0;
    let updates = 0;
    const instance = {
      x: 0,
      y: 40,
      angle: Math.PI / 2,
      velocity: 0.72,
      setX() {
        return this;
      },
      setY() {
        return this;
      },
      update() {
        updates++;
      },
      stop() {
        return this;
      },
      refresh() {
        return this;
      },
      revert() {
        return this;
      },
    };
    const driver = createAnimeDragDriver((_, next) => {
      parameters = next;
      return instance as never;
    });
    const mounted = driver.mount(createDragTrigger().trigger, {
      axis: "block",
      bounds() {
        boundsReads++;
        return { block: [0, 100] };
      },
      change() {},
      release() {},
    });

    expect(boundsReads).toBe(1);
    parameters?.onGrab(instance as never);
    parameters?.onUpdate(instance as never);
    parameters?.onUpdate(instance as never);
    expect(boundsReads).toBe(2);
    expect(updates).toBe(0);

    mounted.refresh();
    expect(boundsReads).toBe(3);
    mounted.dispose();
  });

  it("emits one terminal outcome per Anime drag lifetime and ignores stale callbacks", () => {
    let parameters: NonNullable<Parameters<AnimeDragFactory>[1]> | undefined;
    let stopped = 0;
    let reverted = 0;
    const instance = {
      x: 0,
      y: 24,
      angle: -Math.PI / 2,
      velocity: 0.8,
      dragged: true,
      setX() {
        return this;
      },
      setY() {
        return this;
      },
      update() {},
      stop() {
        stopped++;
        return this;
      },
      refresh() {},
      revert() {
        reverted++;
        return this;
      },
    };
    const outcomes: string[] = [];
    const driver = createAnimeDragDriver((_, next) => {
      parameters = next;
      return instance as never;
    });
    const mounted = driver.mount(createDragTrigger().trigger, {
      axis: "block",
      bounds: () => ({ block: [0, 100] }),
      start: () => outcomes.push("start"),
      change() {},
      release: (sample) => outcomes.push(`release:${sample.velocity}`),
      cancel: () => outcomes.push("cancel"),
    });

    parameters?.onGrab?.(instance as never);
    mounted.stop();
    parameters?.onRelease?.(instance as never);
    parameters?.onGrab?.(instance as never);
    mounted.dispose();
    mounted.dispose();
    parameters?.onRelease?.(instance as never);

    expect(outcomes).toEqual(["start", "cancel", "start", "cancel"]);
    expect(stopped).toBe(1);
    expect(reverted).toBe(1);
  });
});
