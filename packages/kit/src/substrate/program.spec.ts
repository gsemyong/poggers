import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import { createMemoryJournal, type Journal, type JournalAppend } from "#substrate/journal";
import { createSqliteJournal } from "#substrate/journal.sqlite";
import {
  createJournalProgramProgressStore,
  createMemoryProgramProgressStore,
} from "#substrate/program";

const delivery = {
  key: "mail:consumer:thread:message-1",
  consumerId: "mail:consumer",
  scopeId: "thread:1",
  cursor: { position: 8, index: 0 },
} as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Program progress faults", () => {
  it("serializes one durable scope without blocking independent scopes", async () => {
    const journal = createMemoryJournal();
    let releaseFirst!: () => void;
    let markBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => void (markBlocked = resolve));
    const release = new Promise<void>((resolve) => void (releaseFirst = resolve));
    let firstAppend = true;
    const delayed = new Proxy(journal, {
      get(target, property) {
        if (property !== "append") {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (input: JournalAppend) => {
          if (firstAppend) {
            firstAppend = false;
            markBlocked();
            await release;
          }
          return target.append(input);
        };
      },
    });
    const progress = createJournalProgramProgressStore(delayed, "mail");
    const first = progress.claim(delivery);
    await blocked;
    const second = progress.claim({ ...delivery, key: "message-2", scopeId: "thread:2" });

    expect(
      await Promise.race([
        second,
        Bun.sleep(100).then(() => {
          throw new Error("independent Program progress was globally serialized");
        }),
      ]),
    ).toMatchObject({ status: "running", invocation: { attempt: 1, epoch: 1 } });
    releaseFirst();
    expect(await first).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1 },
    });
  });

  it("does not invent uncertainty when a claim fails before commit", async () => {
    const journal = createMemoryJournal();
    const progress = createJournalProgramProgressStore(
      failProgramAppend(journal, "claim", "before"),
      "mail",
    );

    await expect(progress.claim(delivery)).rejects.toThrow("injected claim failure before append");

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1, uncertainAttempts: [] },
    });
  });

  it("records an unknown prior attempt when claim acknowledgement is lost", async () => {
    const journal = createMemoryJournal();
    const progress = createJournalProgramProgressStore(
      failProgramAppend(journal, "claim", "after"),
      "mail",
    );

    await expect(progress.claim(delivery)).rejects.toThrow("injected claim failure after append");

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { attempt: 2, epoch: 2, uncertainAttempts: [1] },
    });
  });

  it("fences a completion that failed before commit and completes the reclaimed attempt", async () => {
    const journal = createMemoryJournal();
    const first = createJournalProgramProgressStore(journal, "mail");
    expect(await first.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { epoch: 1 },
    });
    const interrupted = createJournalProgramProgressStore(
      failProgramAppend(journal, "complete", "before"),
      "mail",
    );
    await expect(interrupted.complete({ ...delivery, epoch: 1 })).rejects.toThrow(
      "injected complete failure before append",
    );

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { attempt: 2, epoch: 2, uncertainAttempts: [1] },
    });
    expect(await first.complete({ ...delivery, epoch: 1 })).toBe("stale");
    expect(await restored.complete({ ...delivery, epoch: 2 })).toBe("completed");
    expect(await restored.getCheckpoint(delivery.consumerId, delivery.scopeId)).toEqual(
      delivery.cursor,
    );
  });

  it("recovers a committed completion whose acknowledgement was lost", async () => {
    const journal = createMemoryJournal();
    const first = createJournalProgramProgressStore(journal, "mail");
    const claim = await first.claim(delivery);
    if (claim.status !== "running") throw new Error("Expected a running Program claim.");
    const interrupted = createJournalProgramProgressStore(
      failProgramAppend(journal, "complete", "after"),
      "mail",
    );

    await expect(
      interrupted.complete({ ...delivery, epoch: claim.invocation.epoch }),
    ).rejects.toThrow("injected complete failure after append");

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.claim(delivery)).toEqual({ status: "completed" });
    expect(await restored.getCheckpoint(delivery.consumerId, delivery.scopeId)).toEqual(
      delivery.cursor,
    );
  });

  it("recovers a committed source position whose acknowledgement was lost", async () => {
    const journal = createMemoryJournal();
    const interrupted = createJournalProgramProgressStore(
      failProgramAppend(journal, "source", "after"),
      "mail",
    );
    await registerConsumer(interrupted);

    await expect(interrupted.setSourcePosition("mail:consumer", 12)).rejects.toThrow(
      "injected source failure after append",
    );

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.getSourcePosition("mail:consumer")).toBe(12);
    await restored.setSourcePosition("mail:consumer", 7);
    expect(await restored.getSourcePosition("mail:consumer")).toBe(12);
  });

  it("does not advance source progress when its append fails before commit", async () => {
    const journal = createMemoryJournal();
    const interrupted = createJournalProgramProgressStore(
      failProgramAppend(journal, "source", "before"),
      "mail",
    );
    await registerConsumer(interrupted);

    await expect(interrupted.setSourcePosition("mail:consumer", 12)).rejects.toThrow(
      "injected source failure before append",
    );

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.getSourcePosition("mail:consumer")).toBe(0);
  });

  it("reconstructs fenced progress and per-consumer source positions after SQLite reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-program-progress-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "journal.sqlite");
    const firstJournal = createSqliteJournal({ file, durability: "strict" });
    const first = createJournalProgramProgressStore(firstJournal, "mail");
    await registerConsumer(first);
    expect(await first.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1 },
    });
    const retrying = createJournalProgramProgressStore(firstJournal, "mail");
    const claim = await retrying.claim(delivery);
    if (claim.status !== "running") throw new Error("Expected a running Program claim.");
    expect(await retrying.complete({ ...delivery, epoch: claim.invocation.epoch })).toBe(
      "completed",
    );
    await first.setSourcePosition("mail:consumer", 14);
    await registerConsumer(first, "mail:audit");
    await first.setSourcePosition("mail:audit", 9);
    await firstJournal.close();

    const reopenedJournal = createSqliteJournal({ file, durability: "strict" });
    const reopened = createJournalProgramProgressStore(reopenedJournal, "mail");
    expect(await reopened.claim(delivery)).toEqual({ status: "completed" });
    expect(await reopened.getCheckpoint(delivery.consumerId, delivery.scopeId)).toEqual(
      delivery.cursor,
    );
    expect(await reopened.getInvocation(delivery.consumerId, delivery.scopeId)).toMatchObject({
      status: "completed",
      attempt: 2,
      epoch: 2,
      uncertainAttempts: [1],
    });
    expect(await reopened.getSourcePosition("mail:consumer")).toBe(14);
    expect(await reopened.getSourcePosition("mail:audit")).toBe(9);
    await reopenedJournal.close();
  });

  it("replays authoritative progress when snapshots are unavailable", async () => {
    const journal = createMemoryJournal();
    const withoutSnapshots = new Proxy(journal, {
      get(target, property) {
        if (property === "saveSnapshot") return async () => "stale" as const;
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const progress = createJournalProgramProgressStore(withoutSnapshots, "mail");
    await registerConsumer(progress);
    const claim = await progress.claim(delivery);
    if (claim.status !== "running") throw new Error("Expected a running Program claim.");
    await progress.complete({ ...delivery, epoch: claim.invocation.epoch });
    await progress.setSourcePosition(delivery.consumerId, 14);

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(await restored.getCheckpoint(delivery.consumerId, delivery.scopeId)).toEqual(
      delivery.cursor,
    );
    expect(await restored.getSourcePosition(delivery.consumerId)).toBe(14);
    await journal.close();
  });

  it("fails closed on obsolete Program progress schemas", async () => {
    const journal = createMemoryJournal();
    const definition = {
      events: ["mail.sent"],
      startAt: "origin",
      partition: "resource",
    } as const;
    await journal.append({
      address: {
        resource: "$poggers.program-source",
        key: { program: "mail", consumer: delivery.consumerId },
      },
      expected: { revision: 0, position: 0 },
      record: {
        schema: "poggers-program-progress:2",
        intent: {
          id: "legacy-register",
          inputHash: "legacy-register",
          value: { kind: "register", definition, position: 0 },
        },
        decision: { kind: "register", definition, position: 0, events: [] },
      },
    });

    const progress = createJournalProgramProgressStore(journal, "mail");
    await expect(progress.getSourcePosition(delivery.consumerId)).rejects.toThrow(
      "Unsupported Program progress schema",
    );
    await journal.close();
  });

  it("persists inspect, move, reset, and removal administration across reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-program-administration-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "journal.sqlite");
    const journal = createSqliteJournal({ file, durability: "strict" });
    const progress = createJournalProgramProgressStore(journal, "mail");
    await registerConsumer(progress);
    const claim = await progress.claim(delivery);
    if (claim.status !== "running") throw new Error("Expected a running Program claim.");
    await progress.complete({ ...delivery, epoch: claim.invocation.epoch });
    await progress.setSourcePosition(delivery.consumerId, 14);

    expect(await progress.inspectConsumer(delivery.consumerId)).toMatchObject({
      sourcePosition: 14,
      scopes: [{ scopeId: delivery.scopeId, checkpoint: delivery.cursor }],
    });
    await progress.moveConsumer({ from: delivery.consumerId, to: "mail:renamed" });
    expect(await progress.inspectConsumer(delivery.consumerId)).toBeUndefined();
    expect(await progress.claim({ ...delivery, consumerId: "mail:renamed" })).toEqual({
      status: "completed",
    });
    await journal.close();

    const reopenedJournal = createSqliteJournal({ file, durability: "strict" });
    const reopened = createJournalProgramProgressStore(reopenedJournal, "mail");
    expect(await reopened.inspectConsumer("mail:renamed")).toMatchObject({
      sourcePosition: 14,
      scopes: [{ scopeId: delivery.scopeId, checkpoint: delivery.cursor }],
    });
    await reopened.resetConsumer({ consumerId: "mail:renamed", startAt: "origin" });
    expect(await reopened.getSourcePosition("mail:renamed")).toBe(0);
    expect(await reopened.getCheckpoint("mail:renamed", delivery.scopeId)).toBeUndefined();
    const replay = await reopened.claim({ ...delivery, consumerId: "mail:renamed" });
    expect(replay).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1 },
    });
    await expect(
      reopened.resetConsumer({
        consumerId: "mail:renamed",
        startAt: "now",
        sourcePosition: 27,
      }),
    ).rejects.toThrow("has unfinished work");
    await expect(reopened.removeConsumer("mail:renamed")).rejects.toThrow("has unfinished work");
    if (replay.status !== "running") throw new Error("Expected a running Program claim.");
    await reopened.complete({
      ...delivery,
      consumerId: "mail:renamed",
      epoch: replay.invocation.epoch,
    });
    await reopened.resetConsumer({
      consumerId: "mail:renamed",
      startAt: "now",
      sourcePosition: 27,
    });
    expect(await reopened.getSourcePosition("mail:renamed")).toBe(27);
    await reopened.removeConsumer("mail:renamed");
    await reopenedJournal.close();

    const finalJournal = createSqliteJournal({ file, durability: "strict" });
    const final = createJournalProgramProgressStore(finalJournal, "mail");
    expect(await final.inspectConsumer("mail:renamed")).toBeUndefined();
    await registerConsumer(final);
    expect(await final.claim(delivery)).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1 },
    });
    await registerConsumer(final, "mail:renamed");
    expect(await final.claim({ ...delivery, consumerId: "mail:renamed" })).toMatchObject({
      status: "running",
      invocation: { attempt: 1, epoch: 1 },
    });
    await finalJournal.close();
  });

  it("refuses destructive administration of unfinished in-memory work", async () => {
    const progress = createMemoryProgramProgressStore();
    await registerConsumer(progress);
    await progress.claim(delivery);

    expect(() => progress.moveConsumer({ from: delivery.consumerId, to: "mail:renamed" })).toThrow(
      "has unfinished work",
    );
    expect(() =>
      progress.resetConsumer({ consumerId: delivery.consumerId, startAt: "origin" }),
    ).toThrow("has unfinished work");
    expect(() => progress.removeConsumer(delivery.consumerId)).toThrow("has unfinished work");
  });

  it("matches the fenced cursor model across generated crash schedules", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            scope: fc.integer({ min: 0, max: 4 }),
            complete: fc.boolean(),
            staleFirst: fc.boolean(),
            sourceRegression: fc.boolean(),
          }),
          { minLength: 1, maxLength: 80 },
        ),
        async (steps) => {
          const progress = createMemoryProgramProgressStore();
          await registerConsumer(progress);
          const pending = new Map<
            string,
            {
              key: string;
              cursor: { position: number; index: number };
              attempt: number;
              epoch: number;
            }
          >();
          const checkpoints = new Map<string, { position: number; index: number }>();
          let expectedSource = 0;

          for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index]!;
            const scopeId = `scope:${step.scope}`;
            const previous = pending.get(scopeId);
            const cursor = previous?.cursor ?? {
              position: Math.floor(index / 3) + 1,
              index: index % 3,
            };
            const key = previous?.key ?? `event:${index}`;
            const claim = await progress.claim({
              key,
              consumerId: delivery.consumerId,
              scopeId,
              cursor,
            });
            if (claim.status !== "running") throw new Error("The generated claim was completed.");
            const expectedAttempt = (previous?.attempt ?? 0) + 1;
            expect(claim.invocation).toMatchObject({
              attempt: expectedAttempt,
              epoch: expectedAttempt,
              uncertainAttempts: Array.from({ length: expectedAttempt - 1 }, (_, item) => item + 1),
            });
            pending.set(scopeId, {
              key,
              cursor,
              attempt: expectedAttempt,
              epoch: claim.invocation.epoch,
            });

            if (step.complete) {
              if (step.staleFirst && claim.invocation.epoch > 1) {
                expect(
                  await progress.complete({
                    key,
                    consumerId: delivery.consumerId,
                    scopeId,
                    cursor,
                    epoch: claim.invocation.epoch - 1,
                  }),
                ).toBe("stale");
              }
              expect(
                await progress.complete({
                  key,
                  consumerId: delivery.consumerId,
                  scopeId,
                  cursor,
                  epoch: claim.invocation.epoch,
                }),
              ).toBe("completed");
              pending.delete(scopeId);
              checkpoints.set(scopeId, cursor);
            }

            const requestedSource = step.sourceRegression ? Math.max(0, index - 2) : index + 1;
            await progress.setSourcePosition(delivery.consumerId, requestedSource);
            expectedSource = Math.max(expectedSource, requestedSource);
          }

          expect(await progress.getSourcePosition(delivery.consumerId)).toBe(expectedSource);
          for (const [scopeId, cursor] of checkpoints) {
            expect(await progress.getCheckpoint(delivery.consumerId, scopeId)).toEqual(cursor);
          }
        },
      ),
      { numRuns: 200, seed: 0x50_47_52 },
    );
  });
});

async function registerConsumer(
  progress: ReturnType<typeof createJournalProgramProgressStore>,
  consumerId: string = delivery.consumerId,
): Promise<void> {
  await progress.registerConsumer({
    consumerId,
    definition: {
      events: ["mail.sent"],
      startAt: "origin",
      partition: "resource",
      version: 1,
    },
    initialSourcePosition: 0,
  });
}

function failProgramAppend(
  journal: Journal,
  kind: "claim" | "complete" | "source",
  phase: "before" | "after",
): Journal {
  let pending = true;
  return new Proxy(journal, {
    get(target, property) {
      if (property !== "append") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (input: JournalAppend) => {
        const value = input.record.intent.value as { readonly kind?: unknown };
        if (!pending || value.kind !== kind) return target.append(input);
        pending = false;
        if (phase === "before") throw new Error(`injected ${kind} failure before append`);
        await target.append(input);
        throw new Error(`injected ${kind} failure after append`);
      };
    },
  });
}
