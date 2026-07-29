import { createHttpTestSession, HttpTestResponseError, testSystem } from "kit/testing";
import { expect } from "vitest";

import type { Task } from "@/features/tasks";

type TaskReplicaPull = Readonly<{
  version: 1;
  schema: string;
  sequence: number;
  observations: Readonly<Record<string, string>>;
  cursor: string;
  snapshot?: Readonly<{ tasks: readonly Task[] }>;
  changes: readonly Readonly<{
    cursor: string;
    replace: Readonly<{ tasks: readonly Task[] }>;
  }>[];
}>;

type TaskReplicaCommand = Readonly<{
  result: Record<never, never>;
  pull: TaskReplicaPull;
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
    const alice = createHttpTestSession(api);
    const bob = createHttpTestSession(api);

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

    const initial = await alice.get<TaskReplicaPull>("/api/replicas/taskReplica");
    expect(initial).toMatchObject({
      version: 1,
      snapshot: { tasks: [] },
      changes: [],
    });
    expect(initial.schema).toContain('"create"');
    expect(initial.schema).toContain('"title"');
    const subscribing = alice.subscribe<Readonly<{ cursor: string }>>(
      `/api/replicas/taskReplica/changes?after=${encodeURIComponent(
        JSON.stringify(initial.observations),
      )}`,
    );
    const createHeaders = {
      "x-kit-command": "create-durable-task",
    };
    const created = await alice.post<TaskReplicaCommand>(
      "/api/replicas/taskReplica/create",
      { id: "durable-task", title: "Durable task" },
      { headers: createHeaders },
    );
    {
      await using changes = await subscribing;
      await expect(changes.next()).resolves.toEqual({ cursor: expect.any(String) });
    }
    const retried = await alice.post<TaskReplicaCommand>(
      "/api/replicas/taskReplica/create",
      { id: "durable-task", title: "Durable task" },
      { headers: createHeaders },
    );
    expect(retried.result).toEqual(created.result);
    expect(retried.pull.snapshot).toEqual(created.pull.snapshot);
    expect(created.pull.snapshot).toEqual({
      tasks: [
        {
          id: "durable-task",
          ownerId: expect.any(String),
          title: "Durable task",
          completed: false,
        },
      ],
    });
    expect((await bob.get<TaskReplicaPull>("/api/replicas/taskReplica")).snapshot).toEqual({
      tasks: [],
    });
    await expect(
      bob.post(
        "/api/replicas/taskReplica/update",
        { id: "durable-task", completed: true },
        { headers: { "x-kit-command": "bob-update" } },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const updated = await alice.post<TaskReplicaCommand>(
      "/api/replicas/taskReplica/update",
      { id: "durable-task", completed: true },
      { headers: { "x-kit-command": "complete-durable-task" } },
    );
    expect(updated.pull.snapshot).toMatchObject({
      tasks: [{ id: "durable-task", completed: true }],
    });
    await alice.post<TaskReplicaCommand>(
      "/api/replicas/taskReplica/create",
      { id: "removed-task", title: "Remove me" },
      { headers: { "x-kit-command": "create-removed-task" } },
    );
    const removed = await alice.post<TaskReplicaCommand>(
      "/api/replicas/taskReplica/remove",
      { id: "removed-task" },
      { headers: { "x-kit-command": "remove-task" } },
    );
    expect(removed.pull.snapshot).toMatchObject({
      tasks: [{ id: "durable-task", completed: true }],
    });

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
    expect((await alice.get<TaskReplicaPull>("/api/replicas/taskReplica")).snapshot).toMatchObject({
      tasks: [{ id: "durable-task", completed: true }],
    });
    await alice.post("/api/identity/sign-out", {});
    await expect(alice.get("/api/replicas/taskReplica")).rejects.toMatchObject({ status: 401 });
  },
});

function page(location: string, path: string): Promise<Response> {
  return fetch(new URL(path, location), {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
}
