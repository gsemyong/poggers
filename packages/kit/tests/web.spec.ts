import { describe, expect, it } from "bun:test";
import {
  createPress,
  createShortcut,
  mountDrag,
  type DragDriver,
  type DragOptions,
  type DragSample,
} from "../src/web";
import { createAnimeDragDriver, type AnimeDragFactory } from "../src/web-drag";

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
      pointerType: "touch",
      currentTarget: target,
    } as unknown as PointerEvent);
    press.onClick({
      detail: 1,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(2);

    press.onClick({
      detail: 0,
      currentTarget: target,
      preventDefault: () => prevented++,
    } as unknown as MouseEvent);
    expect(calls).toBe(3);
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
    const driver = createAnimeDragDriver((_, next) => {
      parameters = next;
      return instance as never;
    });
    const releases: DragSample[] = [];
    const mounted = driver.mount({} as HTMLElement, {
      axis: "block",
      bounds: () => ({ block: [0, 100] }),
      change() {},
      release: (sample) => releases.push(sample),
    });

    parameters?.onGrab?.(instance as never);
    parameters?.onDrag?.(instance as never);
    parameters?.onRelease?.(instance as never);
    mounted.dispose();

    expect(setX).toBe(0);
    expect(setY).toBe(1);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ offset: 40, velocity: 0.72, progress: 0.4 });
    expect(stopped).toBe(1);
    expect(reverted).toBe(1);
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
    const mounted = driver.mount({} as HTMLElement, {
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
