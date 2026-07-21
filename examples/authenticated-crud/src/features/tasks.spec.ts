import { createEntityFixture, createIdentity } from "@poggers/kit";
import { describe, expect, test } from "vitest";

import type { CookieCredentials } from "./identity";
import { createTasks } from "./tasks";

describe("tasks Feature", () => {
  test("exposes the generated semantic API without infrastructure", async () => {
    await using fixture = createEntityFixture(createTasks, {
      identity: createIdentity(({ cookie }: CookieCredentials) =>
        cookie
          ? {
              id: cookie,
              name: cookie,
              email: `${cookie}@example.com`,
            }
          : undefined,
      ),
    });
    const credentials = { cookie: "alice" };

    const created = await fixture.service.create({
      credentials,
      value: { title: "Verify the feature" },
    });
    const completed = await fixture.service.update({
      credentials,
      id: created.id,
      value: { completed: true },
    });

    expect(completed).toEqual({ ...created, completed: true });
    expect((await fixture.service.list({ credentials })).entities).toEqual([completed]);
  });
});
