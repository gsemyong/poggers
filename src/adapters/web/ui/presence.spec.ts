import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  hasPresentationPresence,
  onPresentationExit,
  PresenceGraph,
  readPresentationPresence,
  setPresentationPresence,
} from "./presence";

describe("web Component presence identity", () => {
  it("reclaims a keyed outgoing node without duplicating structural ownership", () => {
    const graph = new PresenceGraph<object>();
    const firstTarget = {};
    const first = graph.register({
      owner: "List",
      element: "Row",
      key: "one",
      target: firstTarget,
    });
    graph.setPresence(first, "exiting");

    const replacementTarget = {};
    const replacement = graph.register({
      owner: "List",
      element: "Row",
      key: "one",
      target: replacementTarget,
    });

    expect(replacement).toBe(first);
    expect(replacement.target).toBe(replacementTarget);
    expect(replacement.presence).toBe("present");
    expect(graph.size).toBe(1);
    expect(graph.roots).toEqual([replacement]);
  });

  it("preserves hierarchy and releases every node exactly once", () => {
    const graph = new PresenceGraph<object>();
    const parent = graph.register({ owner: "Panel", element: "Root", target: {} });
    const first = graph.register({
      owner: "Panel",
      element: "Item",
      key: "first",
      target: {},
      parent,
    });
    const second = graph.register({
      owner: "Panel",
      element: "Item",
      key: "second",
      target: {},
      parent,
    });

    graph.reparent(second, parent, 0);
    expect(parent.children).toEqual([second, first]);

    graph.detach(parent);
    expect(graph.size).toBe(0);
    expect(graph.roots).toEqual([]);
    expect(parent.presence).toBe("detached");
    expect(first.presence).toBe("detached");
    expect(second.presence).toBe("detached");

    graph.dispose();
    expect(graph.size).toBe(0);
  });
});

describe("web Presentation presence coordination", () => {
  it("publishes rich directional samples without exposing a controller", () => {
    const target = {} as Element;
    setPresentationPresence(target, { value: 0.7, velocity: -2.5, settled: false });
    expect(readPresentationPresence(target)).toEqual({
      value: 0.7,
      velocity: -2.5,
      settled: false,
      direction: "exiting",
    });
    setPresentationPresence(target, { value: 0.8, velocity: 3, settled: false });
    expect(readPresentationPresence(target).direction).toBe("entering");
    setPresentationPresence(target, undefined);
    expect(readPresentationPresence(target)).toMatchObject({ value: 1, direction: "idle" });
  });

  it("uses sample history at zero-velocity turning points", () => {
    const target = {} as Element;
    setPresentationPresence(target, { value: 0.8, velocity: 0, settled: false });
    expect(readPresentationPresence(target).direction).toBe("idle");

    setPresentationPresence(target, { value: 0.6, velocity: 0, settled: false });
    expect(readPresentationPresence(target).direction).toBe("exiting");
    setPresentationPresence(target, { value: 0.6, velocity: 0, settled: false });
    expect(readPresentationPresence(target).direction).toBe("exiting");

    setPresentationPresence(target, { value: 0.7, velocity: 0, settled: false });
    expect(readPresentationPresence(target).direction).toBe("entering");
    setPresentationPresence(target, { value: 1, velocity: 0, settled: true });
    expect(readPresentationPresence(target).direction).toBe("idle");
    setPresentationPresence(target, undefined);
  });

  it("settles once at zero and cancels stale ownership on reversal", () => {
    const target = {} as Element;
    const stale = vi.fn();
    const settled = vi.fn();
    setPresentationPresence(target, 1);
    const cancel = onPresentationExit(target, stale);
    cancel();
    onPresentationExit(target, settled);

    setPresentationPresence(target, 0.4);
    setPresentationPresence(target, 0.8);
    expect(stale).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, 0);
    setPresentationPresence(target, 0);
    expect(stale).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledOnce();
  });

  it("releases waiters when a Presentation session is disposed", () => {
    const target = {} as Element;
    const settled = vi.fn();
    setPresentationPresence(target, 0.5);
    expect(hasPresentationPresence(target)).toBe(true);
    onPresentationExit(target, settled);

    setPresentationPresence(target, undefined);
    expect(hasPresentationPresence(target)).toBe(false);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("cancels an already-settled notification before its microtask", async () => {
    const target = {} as Element;
    const settled = vi.fn();
    setPresentationPresence(target, 0);
    const cancel = onPresentationExit(target, settled);
    cancel();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, undefined);
  });

  it("suppresses stale zero settlement after same-tick reentry", async () => {
    const target = {} as Element;
    const settled = vi.fn();
    setPresentationPresence(target, 0);
    onPresentationExit(target, settled);
    setPresentationPresence(target, 0.2);

    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, 0);
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, undefined);
  });

  it("does not detach at an unsettled zero crossing", () => {
    const target = {} as Element;
    const settled = vi.fn();
    setPresentationPresence(target, { value: 1, velocity: 0, settled: true });
    onPresentationExit(target, settled);
    setPresentationPresence(target, { value: 0, velocity: -4, settled: false });
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, { value: 0.2, velocity: 3, settled: false });
    expect(settled).not.toHaveBeenCalled();
    setPresentationPresence(target, { value: 0, velocity: 0, settled: true });
    expect(settled).toHaveBeenCalledOnce();
    setPresentationPresence(target, undefined);
  });

  it("notifies exactly once after any finite positive presence trace", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.000_001, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 100,
        }),
        (trace) => {
          const target = {} as Element;
          const settled = vi.fn();
          setPresentationPresence(target, trace[0]!);
          onPresentationExit(target, settled);
          for (const value of trace) setPresentationPresence(target, value);
          expect(settled).not.toHaveBeenCalled();

          setPresentationPresence(target, 0);
          setPresentationPresence(target, 0);
          expect(settled).toHaveBeenCalledOnce();
          setPresentationPresence(target, undefined);
        },
      ),
      { numRuns: 200 },
    );
  });
});
