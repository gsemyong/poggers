import { effect } from "alien-signals";
import { describe, expect, it } from "vitest";

import { createWebElementObservationHost, createWebEnvironmentHost } from "./observations";

describe("web Presentation Environment", () => {
  it("updates through one scheduled read and releases its native listeners", () => {
    const listeners = new Map<string, EventListener>();
    let scheduled: FrameRequestCallback | undefined;
    let cancelled = 0;
    const view = {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener(name: string, listener: EventListener) {
        listeners.set(name, listener);
      },
      removeEventListener(name: string) {
        listeners.delete(name);
      },
      requestAnimationFrame(callback: FrameRequestCallback) {
        scheduled = callback;
        return 4;
      },
      cancelAnimationFrame() {
        cancelled += 1;
      },
      getComputedStyle() {
        return {
          paddingBlockStart: "0px",
          paddingBlockEnd: "0px",
          paddingInlineStart: "0px",
          paddingInlineEnd: "0px",
        };
      },
    };
    const documentElement = { append() {} };
    const ownerDocument = {
      defaultView: view,
      documentElement,
      createElement() {
        return { style: { cssText: "" }, remove() {} };
      },
    };
    const boundary = { ownerDocument, parentElement: null } as unknown as Element;
    const host = createWebEnvironmentHost(boundary);

    expect(host.value.viewport).toEqual({ inlineSize: 800, blockSize: 600, scale: 1 });
    expect(host.geometryRevision()).toBe(0);
    view.innerWidth = 1024;
    listeners.get("resize")?.({} as Event);
    expect(host.value.viewport.inlineSize).toBe(800);
    scheduled?.(16);
    expect(host.value.viewport.inlineSize).toBe(1024);
    expect(host.geometryRevision()).toBe(1);

    listeners.get("resize")?.({} as Event);
    host.dispose();
    expect(listeners.size).toBe(0);
    expect(cancelled).toBe(1);
  });

  it("does not invalidate dependents when a native notification preserves observations", () => {
    const listeners = new Map<string, EventListener>();
    let scheduled: FrameRequestCallback | undefined;
    const view = {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener(name: string, listener: EventListener) {
        listeners.set(name, listener);
      },
      removeEventListener() {},
      requestAnimationFrame(callback: FrameRequestCallback) {
        scheduled = callback;
        return 1;
      },
      cancelAnimationFrame() {},
      getComputedStyle() {
        return {
          paddingBlockStart: "0px",
          paddingBlockEnd: "0px",
          paddingInlineStart: "0px",
          paddingInlineEnd: "0px",
        };
      },
    };
    const ownerDocument = {
      defaultView: view,
      documentElement: { append() {} },
      createElement() {
        return { style: { cssText: "" }, remove() {} };
      },
    };
    const host = createWebEnvironmentHost({
      ownerDocument,
      parentElement: null,
    } as unknown as Element);
    let runs = 0;
    const stop = effect(() => {
      void host.value.viewport.inlineSize;
      runs += 1;
    });

    listeners.get("resize")?.({} as Event);
    scheduled?.(16);
    expect(runs).toBe(1);

    stop();
    host.dispose();
  });
});

describe("web Presentation Element observations", () => {
  it("mounts native observation only for Elements read by the Presentation", () => {
    let reads = 0;
    const observed = new Set<Element>();
    const view = {
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      ResizeObserver: class {
        observe(target: Element) {
          observed.add(target);
        }
        disconnect() {
          observed.clear();
        }
      },
    };
    const ownerDocument = { defaultView: view };
    const targets = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `Item${index}`,
        element(() => {
          reads += 1;
          return rectangle(0, index * 20, 200, 20);
        }, ownerDocument),
      ]),
    );
    const sources = Object.fromEntries(
      Object.entries(targets).map(([name, target]) => [name, () => [target]]),
    );
    const boundary = element(() => rectangle(0, 0, 800, 600), ownerDocument);
    const host = createWebElementObservationHost(boundary, sources);

    expect(reads).toBe(0);
    expect(observed.size).toBe(0);
    expect(host.elements.Item42!.box.blockSize).toBe(20);
    expect(reads).toBe(1);
    expect([...observed]).toEqual([targets.Item42]);

    host.dispose();
  });

  it("reads native geometry once and serves cached reactive observations", () => {
    let reads = 0;
    const target = element(() => {
      reads += 1;
      return rectangle(12, 18, 320, 180);
    });
    const boundary = element(() => rectangle(0, 0, 800, 600));
    const host = createWebElementObservationHost(boundary, { Panel: () => [target] });

    expect(reads).toBe(0);
    expect(host.elements.Panel.box).toEqual({
      inlineSize: 320,
      blockSize: 180,
      inlineStart: 12,
      blockStart: 18,
    });
    expect(host.elements.Panel.box.blockSize).toBe(180);
    expect(reads).toBe(1);
    expect(host.inspect().Panel).toMatchObject({
      cardinality: 1,
      box: { inlineSize: 320, blockSize: 180 },
    });
    host.dispose();
  });

  it("participates in the fine-grained reactive graph without layout reads in getters", async () => {
    let reads = 0;
    let blockSize = 100;
    let scheduled: FrameRequestCallback | undefined;
    const view = {
      requestAnimationFrame(callback: FrameRequestCallback) {
        scheduled = callback;
        return 1;
      },
      cancelAnimationFrame() {},
      ResizeObserver: class {
        static callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.constructorType.callback = callback;
        }
        private get constructorType() {
          return this.constructor as typeof FakeResizeObserver;
        }
        observe() {}
        disconnect() {}
      },
    };
    const FakeResizeObserver = view.ResizeObserver;
    const ownerDocument = { defaultView: view };
    const target = element(() => {
      reads += 1;
      return rectangle(0, 0, 200, blockSize);
    }, ownerDocument);
    const boundary = element(() => rectangle(0, 0, 800, 600), ownerDocument);
    const host = createWebElementObservationHost(boundary, { Panel: () => [target] });
    const samples: number[] = [];
    const stop = effect(() => {
      samples.push(host.elements.Panel.box.blockSize);
    });

    blockSize = 240;
    FakeResizeObserver.callback([], {} as ResizeObserver);
    scheduled?.(16);
    await Promise.resolve();

    expect(samples).toEqual([100, 240]);
    expect(reads).toBe(2);

    FakeResizeObserver.callback([], {} as ResizeObserver);
    scheduled?.(32);
    await Promise.resolve();
    expect(samples).toEqual([100, 240]);
    expect(reads).toBe(3);
    stop();
    host.dispose();
  });

  it("retains the last measurable box while a connected Element has no layout box", () => {
    let visible = true;
    let width = 240;
    let scheduled: FrameRequestCallback | undefined;
    let notifyResize: ResizeObserverCallback | undefined;
    const view = {
      requestAnimationFrame(callback: FrameRequestCallback) {
        scheduled = callback;
        return 1;
      },
      cancelAnimationFrame() {},
      ResizeObserver: class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }
        observe() {}
        disconnect() {}
      },
    };
    const ownerDocument = { defaultView: view };
    const target = element(() => rectangle(20, 30, width, 120), ownerDocument);
    target.getClientRects = () => {
      const rect = rectangle(20, 30, width, 120);
      return {
        ...(visible ? { 0: rect } : {}),
        length: visible ? 1 : 0,
        item: (index: number) => (visible && index === 0 ? rect : null),
      } as DOMRectList;
    };
    const boundary = element(() => rectangle(0, 0, 800, 600), ownerDocument);
    const host = createWebElementObservationHost(boundary, { Panel: () => [target] });

    expect(host.elements.Panel.box.inlineSize).toBe(240);
    visible = false;
    width = 0;
    notifyResize?.([], {} as ResizeObserver);
    scheduled?.(16);
    expect(host.elements.Panel.box).toEqual({
      inlineSize: 240,
      blockSize: 120,
      inlineStart: 20,
      blockStart: 30,
    });

    visible = true;
    width = 320;
    notifyResize?.([], {} as ResizeObserver);
    scheduled?.(32);
    expect(host.elements.Panel.box.inlineSize).toBe(320);
    host.dispose();
  });

  it("rejects ambiguous repeated observations instead of selecting an instance", () => {
    const first = element(() => rectangle(0, 0, 100, 40));
    const second = element(() => rectangle(0, 40, 100, 80));
    const boundary = element(() => rectangle(0, 0, 800, 600));
    const host = createWebElementObservationHost(boundary, { Row: () => [first, second] });

    expect(() => host.elements.Row.box.blockSize).toThrow(
      'Presentation Element "Row" has 2 instances',
    );
    host.dispose();
  });

  it("publishes zero observations for missing and disconnected Elements", () => {
    let scheduled: FrameRequestCallback | undefined;
    let notifyMutation: MutationCallback | undefined;
    const view = {
      requestAnimationFrame(callback: FrameRequestCallback) {
        scheduled = callback;
        return 1;
      },
      cancelAnimationFrame() {},
      MutationObserver: class {
        constructor(callback: MutationCallback) {
          notifyMutation = callback;
        }
        observe() {}
        disconnect() {}
      },
    };
    const ownerDocument = { defaultView: view };
    const target = element(() => rectangle(12, 18, 320, 180), ownerDocument) as Element & {
      isConnected: boolean;
    };
    target.isConnected = false;
    const targets: Element[] = [];
    const boundary = element(() => rectangle(0, 0, 800, 600), ownerDocument);
    const host = createWebElementObservationHost(boundary, { Panel: () => targets });

    expect(host.inspect().Panel).toMatchObject({
      cardinality: 0,
      box: { inlineSize: 0, blockSize: 0, inlineStart: 0, blockStart: 0 },
    });

    targets.push(target);
    notifyMutation?.([], {} as MutationObserver);
    scheduled?.(16);
    expect(host.inspect().Panel.cardinality).toBe(0);

    target.isConnected = true;
    notifyMutation?.([], {} as MutationObserver);
    scheduled?.(32);
    expect(host.inspect().Panel).toMatchObject({
      cardinality: 1,
      box: { inlineSize: 320, blockSize: 180, inlineStart: 12, blockStart: 18 },
    });

    target.isConnected = false;
    notifyMutation?.([], {} as MutationObserver);
    scheduled?.(48);
    expect(host.inspect().Panel).toMatchObject({
      cardinality: 0,
      box: { inlineSize: 0, blockSize: 0, inlineStart: 0, blockStart: 0 },
    });
    host.dispose();
  });
});

function element(read: () => DOMRect, ownerDocument: object = {}): Element {
  return {
    ownerDocument,
    isConnected: true,
    scrollLeft: 0,
    scrollTop: 0,
    getBoundingClientRect: read,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Element;
}

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}
