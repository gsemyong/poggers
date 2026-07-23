import { createEntityFixture } from "@poggers/kit/testing";
import { describe, expect, test } from "vitest";

import { taskEntity } from "./tasks";

describe("tasks Feature", () => {
  test("exposes the generated semantic API without infrastructure", async () => {
    await using fixture = await createEntityFixture(taskEntity, {
      principal: { id: "alice", name: "Alice", email: "alice@example.com" },
    });

    const created = await fixture.api.create({ title: "Verify the feature" });
    const completed = await fixture.api.update({
      id: created.id,
      changes: { completed: true },
    });

    expect(completed).toEqual({ ...created, completed: true });
    expect((await fixture.api.list()).entities).toEqual([completed]);
  });
});
