import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createDataFixture } from "@/features/data";
import { tasks, tasksDefinition, type Tasks } from "@/features/data/feature.typecheck";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import { compileSystemFixture } from "@/testing/compiler";

describe("Data", () => {
  it("composes into ordinary Programs without adding compiler meaning", () => {
    const compiled = compileSystemFixture(resolve(import.meta.dirname, "feature.typecheck.ts"), [
      serverCompilerExtension,
      webCompilerExtension,
    ]);
    const server = compiled.programs.find(({ name }) => name === "server");
    const browser = compiled.programs.find(({ name }) => name === "browser");

    expect(server).toBeDefined();
    expect(browser).toBeDefined();
    expect(server?.contributions.map(({ id }) => id)).toEqual([
      "feature/identity/program/server",
      "feature/tasks.authority/program/server",
      "feature/tasks.authority.runtime/program/server",
      "feature/tasks.projection/program/server",
      "feature/tasks.replica/program/server",
    ]);
    expect(
      server?.contributions.map(
        (contribution) => serverProgramExecution(contribution, server).kind,
      ),
    ).toEqual(["portable", "portable", "portable", "portable", "portable"]);
    const projection = server?.contributions.find(({ id }) =>
      id.endsWith(".projection/program/server"),
    );
    expect(projection).toBeDefined();
    expect(projectionMutationRows(serverProgramExecution(projection!, server))).toContain("tasks");
    expect(browser?.contributions.map(({ id }) => id)).toEqual([
      "feature/identity/program/browser",
      "feature/tasks.replica/program/browser",
    ]);
    expect(JSON.stringify(compiled)).not.toContain('"kind":"data"');
  });

  it("evolves adjacent record and event history through its shared deterministic fixture", async () => {
    const fixture = await createDataFixture<Tasks>(tasks, tasksDefinition);
    const principal = {
      id: "member-1",
      organization: "company-1",
      roles: ["operator"],
    } as const;

    expect(
      fixture.evolve({
        key: "task-old",
        version: 1,
        state: {
          id: "task-old",
          ownerId: "member-1",
          name: "Previous title",
          completed: false,
          embedding: [1, 0, 0],
        },
      }),
    ).toEqual({
      id: "task-old",
      ownerId: "member-1",
      title: "Previous title",
      completed: false,
      embedding: [1, 0, 0],
    });
    expect(
      fixture.migrate({
        type: "created",
        version: 1,
        data: {
          ownerId: "member-1",
          name: "Previous event title",
          embedding: [1, 0, 0],
        },
      }),
    ).toEqual({
      type: "created",
      version: 2,
      data: {
        ownerId: "member-1",
        title: "Previous event title",
        embedding: [1, 0, 0],
      },
    });

    const created = await fixture.execute({
      command: "create",
      key: "task-current",
      principal,
      state: fixture.initial({ key: "task-current" }),
      input: { id: "task-current", title: "Current title" },
    });
    expect(fixture.replay({ key: "task-current", events: created.events })).toEqual(
      created.snapshot,
    );
    await expect(
      fixture.query({
        rows: [created.snapshot.state],
        principal,
        query: { text: { value: "Current", fields: ["title"] } },
      }),
    ).resolves.toMatchObject({
      kind: "rows",
      matches: [{ row: { id: "task-current" }, score: 1 }],
    });
  });
});

function projectionMutationRows(value: unknown): readonly string[] {
  const names: string[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;
    const object = candidate as Readonly<Record<string, unknown>>;
    if (object.kind === "record" && Array.isArray(object.fields)) {
      for (const field of object.fields as readonly Readonly<Record<string, unknown>>[]) {
        if (field.name !== "upsert") continue;
        const mutation = field.value as
          | Readonly<{ kind?: unknown; fields?: readonly Readonly<{ name?: unknown }>[] }>
          | undefined;
        if (mutation?.kind !== "record" || !Array.isArray(mutation.fields)) continue;
        for (const row of mutation.fields) {
          if (typeof row.name === "string") names.push(row.name);
        }
      }
    }
    for (const child of Object.values(object)) visit(child);
  };
  visit(value);
  return names;
}
