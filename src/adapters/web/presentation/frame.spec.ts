import { describe, expect, it, vi } from "vitest";

import { createNativeWebFrameHost, createWebFrameHost, type WebFrameTask } from "./frame";

describe("web Presentation frame host", () => {
  it("shares one timestamp throughout a synchronous reactive turn", async () => {
    let time = 12;
    const host = createHarness(() => time).host;

    expect(host.time()).toBe(12);
    time = 18;
    expect(host.time()).toBe(12);

    await Promise.resolve();
    expect(host.time()).toBe(18);
    host.dispose();
  });

  it("dispatches every active session with one root frame request and timestamp", () => {
    const harness = createHarness(() => 0);
    const samples: Array<readonly [string, number]> = [];
    const first: WebFrameTask = (time) => samples.push(["first", time]);
    const second: WebFrameTask = (time) => samples.push(["second", time]);

    harness.host.activate(first);
    harness.host.activate(second);
    expect(harness.requests).toBe(1);
    expect(harness.host.inspect()).toEqual({ active: 2, scheduled: true });

    harness.flush(42);
    expect(samples).toEqual([
      ["first", 42],
      ["second", 42],
    ]);
    expect(harness.requests).toBe(2);

    harness.host.deactivate(first);
    harness.host.deactivate(second);
    expect(harness.cancels).toBe(1);
    expect(harness.host.inspect()).toEqual({ active: 0, scheduled: false });
    harness.host.dispose();
  });

  it("isolates roots and performs no work after disposal", () => {
    const first = createHarness(() => 0);
    const second = createHarness(() => 0);
    const task = vi.fn();
    first.host.activate(task);
    second.host.activate(task);
    expect(first.requests).toBe(1);
    expect(second.requests).toBe(1);

    first.host.dispose();
    first.flush(10);
    second.flush(20);
    expect(task).toHaveBeenCalledOnce();
    expect(task).toHaveBeenCalledWith(20);
    second.host.dispose();
  });

  it("reports a task failure without starving siblings or future frames", () => {
    const harness = createHarness(() => 0);
    const failure = new Error("broken frame");
    const broken = vi.fn(() => {
      harness.host.deactivate(broken);
      throw failure;
    });
    const healthy = vi.fn();
    harness.host.activate(broken);
    harness.host.activate(healthy);

    expect(() => harness.flush(16)).toThrow(failure);
    expect(healthy).toHaveBeenCalledWith(16);
    expect(harness.host.inspect()).toEqual({ active: 1, scheduled: true });

    harness.flush(32);
    expect(healthy).toHaveBeenLastCalledWith(32);
    harness.host.dispose();
  });

  it("passes a large finite frame gap through unchanged", () => {
    const harness = createHarness(() => 0);
    const task = vi.fn();
    harness.host.activate(task);
    harness.flush(86_400_000);
    expect(task).toHaveBeenCalledWith(86_400_000);
    harness.host.dispose();
  });

  it("binds browser host schedulers to their native receivers", () => {
    const view = {
      performance: { now: () => 12 },
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
    };
    const boundary = { ownerDocument: { defaultView: view } } as unknown as Element;
    const original = globalThis.queueMicrotask;
    const queued: Array<() => void> = [];
    globalThis.queueMicrotask = function (this: typeof globalThis, callback: () => void) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      queued.push(callback);
    };
    try {
      const host = createNativeWebFrameHost(boundary);
      expect(host.time()).toBe(12);
      expect(queued).toHaveLength(1);
      host.dispose();
    } finally {
      globalThis.queueMicrotask = original;
    }
  });
});

function createHarness(now: () => number) {
  let requests = 0;
  let cancels = 0;
  let pending: FrameRequestCallback | undefined;
  const host = createWebFrameHost({
    now,
    requestFrame(callback) {
      requests += 1;
      pending = callback;
      return requests;
    },
    cancelFrame() {
      cancels += 1;
      pending = undefined;
    },
    queueTurn: queueMicrotask,
  });
  return {
    host,
    get requests() {
      return requests;
    },
    get cancels() {
      return cancels;
    },
    flush(time: number) {
      const callback = pending;
      pending = undefined;
      callback?.(time);
    },
  };
}
