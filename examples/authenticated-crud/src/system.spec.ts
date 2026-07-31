import { createHttpTestSession, HttpTestResponseError, testSystem } from "kit/testing";
import { expect } from "vitest";

import type { Task } from "@/features/tasks";

type TaskReplicaPull = Readonly<{
  version: 1;
  schema?: string;
  sequence: number;
  observations: Readonly<Record<string, string>>;
  cursor: string;
  snapshot?: Readonly<{ tasks: readonly Task[] }>;
  changes: readonly Readonly<
    { row: "tasks"; upsert: Task } | { row: "tasks"; remove: Readonly<{ id: string }> }
  >[];
}>;

type TaskReplicaCommand = Readonly<{
  result: Record<never, never>;
  pull: TaskReplicaPull;
}>;

type TaskCompletionVerification = Readonly<{
  revision: number;
}>;

testSystem({
  name: "authenticated workspace System",
  directory: new URL("..", import.meta.url),
  async verify({ realization, location, locations, restart }) {
    expect(locations["interface/customer.web"]).toHaveLength(1);
    expect(locations["interface/operations.web"]).toHaveLength(1);
    expect(locations["interface/customer.web"]).not.toEqual(locations["interface/operations.web"]);
    expect(locations["program/server"]).toHaveLength(1);

    const invalidRoute = await page(location, "/tasks/not-a-uuid");
    expect(invalidRoute.status).toBe(400);
    const missingRoute = await page(location, "/missing");
    expect(missingRoute.status).toBe(404);

    const tasks = await page(location, "/tasks");
    const tasksDocument = await tasks.text();
    expect(tasks.status).toBe(200);
    expect(tasks.headers.get("content-type")).toContain("text/html");
    expect(tasksDocument).toContain('data-kit-rendering="client"></div>');
    expect(tasksDocument).toContain("<style data-kit-ssr>");
    expect(tasksDocument).toContain("<title>Tasks</title>");
    expect(tasksDocument).toContain(
      '<meta name="description" content="Manage workspace tasks" data-kit-route-head>',
    );
    expect(tasksDocument).toContain('<meta name="robots" content="noindex" data-kit-route-head>');

    const authDocument = await (await page(location, "/auth")).text();
    expect(authDocument).toContain("<title>Sign in</title>");
    const createDocument = await (await page(location, "/tasks/new")).text();
    expect(createDocument).toContain("<title>New task</title>");

    const entry = tasksDocument.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(entry).toBeDefined();
    const asset = await fetch(new URL(entry!, location), { signal: AbortSignal.timeout(10_000) });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");

    const api =
      realization === "production" ? location : (locations["program/server"]?.[0] ?? location);
    const guest = createHttpTestSession(api);
    const alice = createHttpTestSession(api);
    const bob = createHttpTestSession(api);

    await expect(
      guest.post(
        "/api/tasks/completion",
        { taskId: "durable-task" },
        { headers: { "x-kit-command": "guest-verification" } },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      alice.post("/api/identity/sign-up/email", {
        name: "Alice",
        email: "alice@example.com",
        password: "short",
      }),
    ).rejects.toBeInstanceOf(HttpTestResponseError);
    await alice.post("/api/identity/sign-up/email", {
      name: "Alice",
      email: "alice@example.com",
      password: "password1234",
    });
    await bob.post("/api/identity/sign-up/email", {
      name: "Bob",
      email: "bob@example.com",
      password: "password1234",
    });

    const initial = await alice.get<TaskReplicaPull>("/api/replicas/tasks");
    expect(initial).toMatchObject({
      version: 1,
      snapshot: { tasks: [] },
      changes: [],
    });
    expect(initial.schema).toContain('"create"');
    expect(initial.schema).toContain('"title"');
    const subscribing = alice.subscribe<TaskReplicaPull>(
      `/api/replicas/tasks/changes?after=${encodeURIComponent(
        JSON.stringify(initial.observations),
      )}&sequence=${initial.sequence}`,
    );
    const createHeaders = {
      "x-kit-command": "create-durable-task",
      "x-kit-after": `${initial.sequence}`,
    };
    const created = await alice.post<TaskReplicaCommand>(
      "/api/replicas/tasks/create",
      { id: "durable-task", title: "Durable task" },
      { headers: createHeaders },
    );
    expect(created.pull.changes).toMatchObject([
      {
        row: "tasks",
        upsert: {
          id: "durable-task",
          ownerId: expect.any(String),
          title: "Durable task",
          completed: false,
        },
      },
    ]);
    {
      await using changes = await subscribing;
      const streamed = await changes.next();
      expect(streamed).toMatchObject({
        changes: [{ row: "tasks", upsert: { id: "durable-task" } }],
      });
      expect(streamed.sequence).toBeGreaterThan(initial.sequence);
      expect(streamed.sequence).toBeLessThanOrEqual(created.pull.sequence);
      expect(streamed.schema).toBeUndefined();
    }
    const retried = await alice.post<TaskReplicaCommand>(
      "/api/replicas/tasks/create",
      { id: "durable-task", title: "Durable task" },
      { headers: createHeaders },
    );
    expect(retried.result).toEqual(created.result);
    expect(retried.pull.changes).toEqual(created.pull.changes);
    expect(created.pull.schema).toBeUndefined();
    expect(created.pull.snapshot).toBeUndefined();
    await expect(
      alice.post(
        "/api/tasks/completion",
        { taskId: "durable-task" },
        { headers: { "x-kit-command": "verify-incomplete-task" } },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await bob.get<TaskReplicaPull>("/api/replicas/tasks")).snapshot).toEqual({
      tasks: [],
    });
    await expect(
      bob.post(
        "/api/replicas/tasks/toggle",
        { id: "durable-task" },
        { headers: { "x-kit-command": "bob-update" } },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const updated = await alice.post<TaskReplicaCommand>(
      "/api/replicas/tasks/toggle",
      { id: "durable-task" },
      {
        headers: {
          "x-kit-command": "complete-durable-task",
          "x-kit-after": `${created.pull.sequence}`,
        },
      },
    );
    expect(updated.pull.snapshot).toBeUndefined();
    expect(updated.pull.changes).toMatchObject([
      { row: "tasks", upsert: { id: "durable-task", completed: true } },
    ]);
    const verified = await alice.post<TaskCompletionVerification>(
      "/api/tasks/completion",
      { taskId: "durable-task" },
      { headers: { "x-kit-command": "verify-completed-task" } },
    );
    expect(verified).toEqual({ revision: 2 });
    expect(
      await alice.post<TaskCompletionVerification>(
        "/api/tasks/completion",
        { taskId: "durable-task" },
        { headers: { "x-kit-command": "verify-completed-task" } },
      ),
    ).toEqual(verified);
    const createdForRemoval = await alice.post<TaskReplicaCommand>(
      "/api/replicas/tasks/create",
      { id: "removed-task", title: "Remove me" },
      {
        headers: {
          "x-kit-command": "create-removed-task",
          "x-kit-after": `${updated.pull.sequence}`,
        },
      },
    );
    const removed = await alice.post<TaskReplicaCommand>(
      "/api/replicas/tasks/remove",
      { id: "removed-task" },
      {
        headers: {
          "x-kit-command": "remove-task",
          "x-kit-after": `${createdForRemoval.pull.sequence}`,
        },
      },
    );
    expect(removed.pull.snapshot).toBeUndefined();
    expect(removed.pull.changes).toEqual([{ row: "tasks", remove: { id: "removed-task" } }]);

    await restart();
    await expect(
      alice.post("/api/identity/sign-in/email", {
        email: "alice@example.com",
        password: "incorrect-password",
      }),
    ).rejects.toBeInstanceOf(HttpTestResponseError);
    await alice.post("/api/identity/sign-in/email", {
      email: "alice@example.com",
      password: "password1234",
    });
    expect((await alice.get<TaskReplicaPull>("/api/replicas/tasks")).snapshot).toMatchObject({
      tasks: [{ id: "durable-task", completed: true }],
    });
    await alice.post("/api/identity/sign-out", {});
    await expect(alice.get("/api/replicas/tasks")).rejects.toMatchObject({ status: 401 });
  },
});

function page(location: string, path: string): Promise<Response> {
  return fetch(new URL(path, location), {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
}
