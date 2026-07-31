import { createDataFixture } from "kit/features/data";
import { describe, expect, test } from "vitest";

import { taskData, taskDataDefinition, taskEmbedding } from "@/features/tasks";

describe("tasks Feature", () => {
  test("decides, replays, authorizes, and queries without infrastructure", async () => {
    const fixture = await createDataFixture(taskData, taskDataDefinition);
    const principal = { id: "alice", name: "Alice", email: "alice@example.com" };
    const initial = fixture.initial({ key: "task-1" });

    const created = await fixture.execute({
      command: "create",
      key: "task-1",
      principal,
      state: initial,
      input: { id: "task-1", title: "Verify the feature" },
    });
    const completed = await fixture.execute({
      command: "toggle",
      key: "task-1",
      principal,
      state: created.snapshot,
      input: { id: "task-1" },
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
      embedding: taskEmbedding("Verify the feature"),
    });
    expect(
      fixture.replay({
        key: "task-1",
        events: [...created.events, ...completed.events],
      }),
    ).toEqual(completed.snapshot);
    await expect(
      fixture.query({
        rows: [completed.snapshot.state],
        principal,
        query: { text: { value: "Verify", fields: ["title"] } },
      }),
    ).resolves.toMatchObject({
      kind: "rows",
      matches: [{ row: { id: "task-1" }, score: 1 }],
    });
    await expect(
      fixture.query({
        rows: [completed.snapshot.state],
        principal,
        query: {
          vector: {
            field: "embedding",
            value: taskEmbedding("Verify feature"),
            limit: 1,
          },
        },
      }),
    ).resolves.toMatchObject({
      kind: "rows",
      matches: [{ row: { id: "task-1" }, score: expect.any(Number) }],
    });
    await expect(
      fixture.query({
        rows: [completed.snapshot.state],
        principal,
        query: {
          analytics: {
            groupBy: ["completed"],
            measures: { count: { count: true } },
          },
        },
      }),
    ).resolves.toEqual({
      kind: "analytics",
      observations: {},
      groups: [{ key: { completed: true }, measures: { count: 1 } }],
    });

    await expect(
      fixture.execute({
        command: "update",
        key: "task-1",
        principal: { ...principal, id: "mallory" },
        state: completed.snapshot,
        input: { id: "task-1", title: "Unauthorized" },
      }),
    ).resolves.toMatchObject({
      outcome: { status: "failed", failure: { type: "forbidden" } },
      events: [],
    });
  });
});
