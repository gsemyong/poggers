import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  animate,
  createActionEventLedger,
  createPresentationFrame,
  evaluatePresentationFrame,
  eventCursor,
  isPresentationTemporalValue,
  readEventOccurrences,
  type Animation,
  type PresentationAnimationHost,
} from "./presentation";

describe("Presentation kernel", () => {
  it("normalizes one logical frame into deterministic immutable data", () => {
    const frame = createPresentationFrame({
      time: 16,
      input: { state: { open: true }, parameters: { duration: 240 } },
      temporal: { panel: { value: 0.4, velocity: 1.2, settled: false } },
      declarations: { Panel: { transform: { y: 120 }, opacity: 0.4 } },
    });

    expect(JSON.stringify(frame)).toBe(
      '{"time":16,"input":{"parameters":{"duration":240},"state":{"open":true}},"temporal":{"panel":{"settled":false,"value":0.4,"velocity":1.2}},"declarations":{"Panel":{"opacity":0.4,"transform":{"y":120}}}}',
    );
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.declarations)).toBe(true);
  });

  it("replays equal frame data byte-for-byte regardless of insertion order", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.integer()),
        (record) => {
          const reversed = Object.fromEntries(Object.entries(record).reverse());
          const first = createPresentationFrame({
            time: 0,
            input: record,
            temporal: {},
            declarations: {},
          });
          const second = createPresentationFrame({
            time: 0,
            input: reversed,
            temporal: {},
            declarations: {},
          });
          expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        },
      ),
    );
  });

  it("rejects non-finite, cyclic, executable, and native frame values", () => {
    expect(() =>
      createPresentationFrame({ time: Number.NaN, input: {}, temporal: {}, declarations: {} }),
    ).toThrow("time must be finite");
    expect(() =>
      createPresentationFrame({
        time: 0,
        input: {},
        temporal: {},
        declarations: { opacity: Number.POSITIVE_INFINITY },
      }),
    ).toThrow("must be finite");
    expect(() =>
      createPresentationFrame({
        time: 0,
        input: {},
        temporal: {},
        declarations: { run: () => undefined } as never,
      }),
    ).toThrow("unsupported function");
    expect(() =>
      createPresentationFrame({
        time: 0,
        input: {},
        temporal: {},
        declarations: { date: new Date() } as never,
      }),
    ).toThrow("plain data");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      createPresentationFrame({
        time: 0,
        input: {},
        temporal: {},
        declarations: cyclic as never,
      }),
    ).toThrow("cannot be cyclic");
  });

  it("correlates synchronous action start and completion", () => {
    const changed = vi.fn();
    const ledger = createActionEventLedger(["save"], changed);
    const output = ledger.invoke("save", [{ documentId: "a" }], () => ({ revision: 3 }));

    expect(output).toEqual({ revision: 3 });
    expect(readEventOccurrences(ledger.events.save!, 0).occurrences).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ input: { documentId: "a" } }),
      }),
    ]);
    expect(readEventOccurrences(ledger.events.save!.completed, 0).occurrences).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          input: { documentId: "a" },
          output: { revision: 3 },
        }),
      }),
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("keeps overlapping asynchronous completions correlated out of start order", async () => {
    const ledger = createActionEventLedger(["load"]);
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const firstResult = ledger.invoke("load", [{ id: 1 }], () => first.promise);
    const secondResult = ledger.invoke("load", [{ id: 2 }], () => second.promise);

    second.resolve("second");
    await secondResult;
    first.resolve("first");
    await firstResult;

    const starts = readEventOccurrences(ledger.events.load!, 0).occurrences.map(
      ({ payload }) => payload as { invocation: string; input: { id: number } },
    );
    const completions = readEventOccurrences(ledger.events.load!.completed, 0).occurrences.map(
      ({ payload }) => payload as { invocation: string; input: { id: number }; output: string },
    );
    expect(starts.map(({ input }) => input.id)).toEqual([1, 2]);
    expect(completions.map(({ input }) => input.id)).toEqual([2, 1]);
    expect(completions[0]!.invocation).toBe(starts[1]!.invocation);
    expect(completions[1]!.invocation).toBe(starts[0]!.invocation);
  });

  it("records synchronous and asynchronous failures without changing error semantics", async () => {
    const ledger = createActionEventLedger(["fail"]);
    const sync = new Error("sync");
    expect(() =>
      ledger.invoke("fail", [], () => {
        throw sync;
      }),
    ).toThrow(sync);
    const async = new Error("async");
    await expect(ledger.invoke("fail", [], () => Promise.reject(async))).rejects.toBe(async);
    expect(readEventOccurrences(ledger.events.fail!.failed, 0).occurrences).toHaveLength(2);
  });

  it("supports cursor-scoped exactly-once reads", () => {
    const ledger = createActionEventLedger(["press"]);
    ledger.invoke("press", [], () => undefined);
    const cursor = eventCursor(ledger.events.press!);
    expect(readEventOccurrences(ledger.events.press!, cursor).occurrences).toEqual([]);
    ledger.invoke("press", [], () => undefined);
    expect(readEventOccurrences(ledger.events.press!, cursor).occurrences).toHaveLength(1);
  });

  it("selects one synchronous adapter host and restores it after evaluation", () => {
    const animation = {} as Animation<number, number, number>;
    const host: PresentationAnimationHost = {
      sample: vi.fn((_identity, source) => ({
        value: source,
        velocity: 0,
        settled: true,
      })) as never,
      inspect: vi.fn(() => ({ value: 1, velocity: 0, settled: true })) as never,
    };
    expect(evaluatePresentationFrame(host, () => host.sample("Root::x", 1, animation).value)).toBe(
      1,
    );
    expect(
      evaluatePresentationFrame(host, () => evaluatePresentationFrame(host, () => "nested")),
    ).toBe("nested");
  });

  it("retains a compiler-generated declaration slice over adapter temporal state", () => {
    let value = 0.25;
    const host: PresentationAnimationHost = {
      sample: vi.fn() as never,
      inspect: vi.fn(() => ({ value, velocity: 2, settled: false })) as never,
    };
    const temporal = evaluatePresentationFrame(host, () =>
      animate.temporal(0.5, () => 1 - animate.value<number>("Panel::position"), [
        "Panel::position",
      ]),
    );

    expect(isPresentationTemporalValue(temporal)).toBe(true);
    expect(temporal.current).toBe(0.5);
    expect(evaluatePresentationFrame(host, () => temporal.sample())).toBe(0.75);
    value = 0.6;
    expect(evaluatePresentationFrame(host, () => temporal.sample())).toBe(0.4);
  });
});
