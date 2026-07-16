import { describe, expect, test } from "bun:test";

import {
  startDependencies,
  startDependencyGroups,
  type DependencyImplementation,
  type DependencyImplementations,
} from "#kernel/dependency";

describe("Feature dependencies", () => {
  test("keeps ordinary values as values", async () => {
    const implementations = {
      ai: { complete: () => "normal" },
      clock: { now: () => 123 },
    } satisfies DependencyImplementations<{
      ai: { complete(): string };
      clock: { now(): number };
    }>;

    const started = await startDependencies(implementations);
    expect(started.dependencies.ai.complete()).toBe("normal");
    expect(started.dependencies.clock.now()).toBe(123);
    await started.stop();
  });

  test("starts shared implementation identity once", async () => {
    let starts = 0;
    const value = { id: "shared" };
    const implementation = {
      kind: "dependency",
      start() {
        starts += 1;
        return value;
      },
    } satisfies DependencyImplementation<typeof value>;

    const started = await startDependencies<{ first: typeof value; second: typeof value }>({
      first: implementation,
      second: implementation,
    });

    expect(starts).toBe(1);
    expect(started.dependencies.first).toBe(value);
    expect(started.dependencies.second).toBe(value);
    await started.stop();
  });

  test("shares one implementation across Feature owners", async () => {
    let starts = 0;
    const implementation = {
      kind: "dependency",
      start() {
        starts += 1;
        return { id: "shared" };
      },
    } satisfies DependencyImplementation<{ id: string }>;

    const started = await startDependencyGroups({
      first: { clock: implementation },
      "second.nested": { clock: implementation },
    });

    expect(starts).toBe(1);
    expect(started.groups.first?.clock).toBe(started.groups["second.nested"]?.clock);
    await started.stop();
  });

  test("aborts and stops in reverse startup order exactly once", async () => {
    const events: string[] = [];
    const first = {
      kind: "dependency",
      start({ signal }) {
        events.push(`start:first:${signal.aborted}`);
        return { name: "first" };
      },
      stop(value) {
        events.push(`stop:${value.name}`);
      },
    } satisfies DependencyImplementation<{ name: string }>;
    const second = {
      kind: "dependency",
      start() {
        events.push("start:second");
        return { name: "second" };
      },
      stop(value) {
        events.push(`stop:${value.name}`);
      },
    } satisfies DependencyImplementation<{ name: string }>;

    const started = await startDependencies({ first, second });
    await started.stop();
    await started.stop();

    expect(started.signal.aborted).toBe(true);
    expect(events).toEqual(["start:first:false", "start:second", "stop:second", "stop:first"]);
  });

  test("cleans up after partial startup failure", async () => {
    const events: string[] = [];
    const first = {
      kind: "dependency",
      start() {
        events.push("start:first");
        return { name: "first" };
      },
      stop() {
        events.push("stop:first");
      },
    } satisfies DependencyImplementation<{ name: string }>;
    const broken = {
      kind: "dependency",
      start() {
        events.push("start:broken");
        throw new Error("broken dependency");
      },
    } satisfies DependencyImplementation<never>;

    await expect(startDependencies({ first, broken })).rejects.toThrow("broken dependency");
    expect(events).toEqual(["start:first", "start:broken", "stop:first"]);
  });

  test("starts cleanly again after rapid disposal", async () => {
    const signals: AbortSignal[] = [];
    let starts = 0;
    let stops = 0;
    const implementation = {
      kind: "dependency",
      start({ signal }) {
        starts += 1;
        signals.push(signal);
        return { generation: starts };
      },
      stop() {
        stops += 1;
      },
    } satisfies DependencyImplementation<{ generation: number }>;

    const first = await startDependencies({ service: implementation });
    await first.stop();
    const second = await startDependencies({ service: implementation });

    expect(first.dependencies.service.generation).toBe(1);
    expect(second.dependencies.service.generation).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    await second.stop();
    expect(stops).toBe(2);
  });
});
