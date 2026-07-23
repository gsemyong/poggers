import { describe, expect, it } from "vitest";

import {
  createPointerDragDriver,
  createPress,
  createShortcut,
  mountDragDriver,
  type DragDriver,
} from "@/adapters/web/ui/component/interaction";
import type { DragOptions, DragSample } from "@/platforms/web/ui";

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
      const dispose = mountDragDriver(
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

  it("drives bounded drag samples directly from Pointer Events", () => {
    const listeners = new Map<string, EventListener>();
    const captured = new Set<number>();
    const style = { cursor: "" };
    const trigger = {
      style,
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener as EventListener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
      setPointerCapture(pointer: number) {
        captured.add(pointer);
      },
      hasPointerCapture(pointer: number) {
        return captured.has(pointer);
      },
      releasePointerCapture(pointer: number) {
        captured.delete(pointer);
      },
    } as unknown as HTMLElement;
    const events: string[] = [];
    const samples: DragSample[] = [];
    const mounted = createPointerDragDriver().mount(trigger, {
      axis: "block",
      bounds: () => ({ block: [0, 100] }),
      threshold: 3,
      start: () => events.push("start"),
      change: (sample) => samples.push(sample),
      release: (sample) => events.push(`release:${sample.block}`),
      cancel: () => events.push("cancel"),
    });
    const emit = (type: string, input: Partial<PointerEvent>): Readonly<{ prevented: boolean }> => {
      let prevented = false;
      listeners.get(type)?.({
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: 10,
        clientY: 20,
        timeStamp: 10,
        preventDefault: () => {
          prevented = true;
        },
        ...input,
      } as PointerEvent);
      return { prevented };
    };

    emit("pointerdown", {});
    expect(captured.has(7)).toBe(true);
    expect(style.cursor).toBe("grabbing");
    expect(emit("pointermove", { clientY: 22, timeStamp: 20 }).prevented).toBe(false);
    expect(emit("pointermove", { clientY: 60, timeStamp: 30 }).prevented).toBe(true);
    emit("pointerup", { clientY: 140, timeStamp: 40 });

    expect(events).toEqual(["start", "release:100"]);
    expect(samples.at(-1)).toMatchObject({
      offset: 100,
      block: 100,
      progress: 1,
      progressBlock: 1,
    });
    expect(captured.size).toBe(0);
    expect(style.cursor).toBe("grab");
    mounted.dispose();
    expect(style.cursor).toBe("");
    expect(listeners.size).toBe(0);
  });
});
