import { createAggregateFixture } from "kit/features/aggregate";
import { describe, expect, test } from "vitest";

import { taskAggregate, taskAggregateDefinition } from "@/features/tasks";

describe("tasks Feature", () => {
  test("decides and replays its domain without infrastructure", async () => {
    const fixture = createAggregateFixture(taskAggregate, taskAggregateDefinition, {
      dependencies: {},
    });
    const principal = { id: "alice", name: "Alice", email: "alice@example.com" };
    const initial = fixture.initial({ key: "task-1" });

    const created = await fixture.execute({
      command: "create",
      key: "task-1",
      principal,
      state: initial,
      input: { title: "Verify the feature" },
    });
    const completed = await fixture.execute({
      command: "toggle",
      key: "task-1",
      principal,
      state: created.snapshot,
      input: undefined,
    });

    expect(created.outcome).toEqual({
      status: "succeeded",
      value: { id: "task-1" },
    });
    expect(completed.snapshot.state).toMatchObject({
      id: "task-1",
      ownerId: "alice",
      title: "Verify the feature",
      completed: true,
    });
    expect(
      fixture.replay({
        key: "task-1",
        events: [...created.events, ...completed.events],
      }),
    ).toEqual(completed.snapshot);

    await expect(
      fixture.execute({
        command: "update",
        key: "task-1",
        principal: { ...principal, id: "mallory" },
        state: completed.snapshot,
        input: { title: "Unauthorized" },
      }),
    ).resolves.toMatchObject({
      outcome: { status: "failed", failure: { type: "forbidden" } },
      events: [],
    });
  });
});
