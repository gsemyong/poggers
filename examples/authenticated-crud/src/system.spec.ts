import type { EntitySnapshot } from "kit/features/entity";
import { createHttpTestSession, HttpTestResponseError, testSystem } from "kit/testing";
import { expect } from "vitest";

import type { Task } from "@/features/tasks";

testSystem({
  name: "authenticated CRUD System",
  directory: new URL("..", import.meta.url),
  async verify({ location, locations, restart }) {
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

    const origin = locations["program/server"]?.[0] ?? location;
    const alice = createHttpTestSession(origin);
    const bob = createHttpTestSession(origin);

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

    const subscription = await alice.subscribe<EntitySnapshot<Task>>("/api/tasks/changes");
    expect(await subscription.next()).toEqual({ revision: 0, entities: [] });
    const commandHeaders = {
      "x-kit-command": "create-durable-task",
      "x-kit-entity": "durable-task",
    };
    const created = await alice.post<Task>(
      "/api/tasks",
      { title: "Durable task" },
      { headers: commandHeaders },
    );
    expect(
      await alice.post<Task>("/api/tasks", { title: "Durable task" }, { headers: commandHeaders }),
    ).toEqual(created);
    expect(await subscription.next()).toEqual({
      revision: 1,
      entities: [created],
    });
    expect((await bob.get<EntitySnapshot<Task>>("/api/tasks")).entities).toEqual([]);
    await expect(bob.patch(`/api/tasks/${created.id}`, { completed: true })).rejects.toMatchObject({
      status: 404,
    });
    const updated = await alice.patch<Task>(`/api/tasks/${created.id}`, {
      completed: true,
    });
    expect(await subscription.next()).toEqual({
      revision: 2,
      entities: [updated],
    });
    const removed = await alice.post<Task>("/api/tasks", { title: "Remove me" });
    expect((await subscription.next()).revision).toBe(3);
    await alice.delete(`/api/tasks/${removed.id}`);
    expect(await subscription.next()).toEqual({
      revision: 4,
      entities: [updated],
    });
    await subscription.close();

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
    expect(await alice.get<EntitySnapshot<Task>>("/api/tasks")).toEqual({
      revision: 4,
      entities: [updated],
    });
    const draining = await alice.subscribe<EntitySnapshot<Task>>("/api/tasks/changes");
    expect((await draining.next()).revision).toBe(4);
    await restart();
    await draining.close();
    await alice.post("/api/identity/sign-out", {});
    await expect(alice.get("/api/tasks")).rejects.toMatchObject({ status: 401 });
  },
});

function page(location: string, path: string): Promise<Response> {
  return fetch(new URL(path, location), {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
}
