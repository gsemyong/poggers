import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineApp } from "../src/app";
import { createMigration, loadApp, writeMigrationSnapshot } from "../src/runtime";

const workspaceRoot = resolve(import.meta.dir, "../../..");
const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("Poggers migrations", () => {
  it("hashes structural snapshots and keeps formatting-only edits idempotent", async () => {
    const appDir = await createMigrationFixture();

    const first = await writeMigrationSnapshot(appDir);
    expect(first.created).toBe(true);
    expect(await readFile(first.path, "utf8")).toContain(`export const hash = "${first.hash}"`);
    expect(await readFile(first.path, "utf8")).toContain("export type App");

    await writeFile(join(appDir, "src/types.ts"), counterTypesV1Formatted, "utf8");

    const second = await writeMigrationSnapshot(appDir);
    expect(second.hash).toBe(first.hash);
    expect(second.created).toBe(false);

    await writeFile(join(appDir, "src/types.ts"), counterTypesV2, "utf8");
    await writeFile(join(appDir, "src/app.ts"), counterAppV2, "utf8");

    const changed = await createMigration(appDir, "rename counter");
    expect(changed.kind).toBe("created");
    if (changed.kind !== "created") return;
    expect(changed.fromHash).toBe(first.hash);
    expect(changed.toHash).not.toBe(first.hash);
    expect(await readFile(changed.path, "utf8")).toContain("draft: true");
  });

  it("fails draft and invalid migration edges, then passes reviewed edges", async () => {
    const appDir = await createMigrationFixture();
    await writeMigrationSnapshot(appDir);
    await writeFile(join(appDir, "src/types.ts"), counterTypesV2, "utf8");
    await writeFile(join(appDir, "src/app.ts"), counterAppV2, "utf8");

    const created = await createMigration(appDir, "counter event rename");
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const draft = await runPoggers(["typecheck", appDir]);
    expect(draft.code).not.toBe(0);
    expect(draft.output).toContain("true");
    expect(draft.output).toContain("false");

    await writeFile(
      created.path,
      reviewedMigrationSource(created.fromHash, created.toHash, {
        invalidState: true,
      }),
      "utf8",
    );

    const invalid = await runPoggers(["typecheck", appDir]);
    expect(invalid.code).not.toBe(0);
    expect(invalid.output).toContain("string");
    expect(invalid.output).toContain("number");

    await writeFile(
      created.path,
      reviewedMigrationSource(created.fromHash, created.toHash, {
        invalidEvent: true,
      }),
      "utf8",
    );

    const invalidEvent = await runPoggers(["typecheck", appDir]);
    expect(invalidEvent.code).not.toBe(0);
    expect(invalidEvent.output).toContain("missing");
    expect(invalidEvent.output).toContain("incremented");

    await writeFile(
      created.path,
      reviewedMigrationSource(created.fromHash, created.toHash),
      "utf8",
    );

    const reviewed = await runPoggers(["typecheck", appDir]);
    expect(reviewed.output).toBe("");
    expect(reviewed.code).toBe(0);

    const loaded = await loadApp(appDir);
    expect((loaded.api.def as any).migrationHash).toBe(created.toHash);
    const restored = loaded.api.restore("counter", {
      version: 1,
      hash: created.fromHash,
      data: { count: 7 },
    });
    expect(restored).toEqual({ total: 7, label: "migrated" });

    const state = loaded.api.createState("counter");
    loaded.api.applyEvent(
      "counter",
      state,
      {
        id: "event-1",
        seq: 1,
        at: 1,
        actor: { id: "actor-1" },
        name: "inc",
        payload: { by: 5 },
        hash: created.fromHash,
      },
      1,
      created.fromHash,
    );
    expect(state).toEqual({ total: 5, label: "migration" });
  });

  it("walks multi-hop hash migration paths and fails missing paths", () => {
    const app = defineApp<any>({
      version: 3,
      migrationHash: "v3",
      migrations: [
        {
          from: "v1",
          to: "v2",
          migrate: {
            counter: {
              state(old) {
                return { total: old.count };
              },
              event(_name, payload) {
                return { name: "incremented", payload: { by: payload.by } };
              },
            },
          },
        },
        {
          from: "v2",
          to: "v3",
          migrate: {
            counter: {
              state(old) {
                return { value: old.total };
              },
              event(_name, payload) {
                return { name: "added", payload: { amount: payload.by } };
              },
            },
          },
        },
      ],
      resources: {
        counter: {
          state: { value: 0 },
          events: {
            added({ state, payload }) {
              state.value += payload.amount;
            },
          },
          views: {},
          commands: {},
        },
      },
    });

    expect(app.restore("counter", { version: 1, hash: "v1", data: { count: 9 } })).toEqual({
      value: 9,
    });

    const state = app.createState("counter");
    app.applyEvent(
      "counter",
      state,
      {
        id: "event-1",
        seq: 1,
        at: 1,
        actor: { id: "actor-1" },
        name: "inc",
        payload: { by: 4 },
        hash: "v1",
      },
      1,
      "v1",
    );
    expect(state).toEqual({ value: 4 });
    expect(() => app.restore("counter", { version: 1, hash: "missing", data: {} })).toThrow(
      "No migration path from missing to v3.",
    );
  });
});

async function createMigrationFixture(): Promise<string> {
  const appDir = await mkdtemp(resolve(workspaceRoot, ".poggers-migrations-"));
  createdDirs.push(appDir);
  await mkdir(join(appDir, "src"), { recursive: true });
  await mkdir(join(appDir, "node_modules/.bin"), { recursive: true });
  await mkdir(join(appDir, "node_modules/@poggers"), { recursive: true });
  await symlink(
    resolve(workspaceRoot, "packages/kit"),
    join(appDir, "node_modules/@poggers/kit"),
    "dir",
  );
  await symlink(
    resolve(workspaceRoot, "node_modules/.bin/tsc"),
    join(appDir, "node_modules/.bin/tsc"),
  );
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify(
      {
        name: "@poggers/migrations-test",
        private: true,
        type: "module",
        dependencies: {
          "@poggers/kit": "workspace:*",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(appDir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "@poggers/kit/tsconfig",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(join(appDir, "src/types.ts"), counterTypesV1, "utf8");
  await writeFile(join(appDir, "src/app.ts"), counterAppV1, "utf8");
  return appDir;
}

async function runPoggers(args: string[]): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(["bun", resolve(workspaceRoot, "packages/kit/src/cli.ts"), ...args], {
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, output: `${stdout}${stderr}` };
}

function reviewedMigrationSource(
  fromHash: string,
  toHash: string,
  options: { invalidEvent?: boolean; invalidState?: boolean } = {},
): string {
  const state = options.invalidState
    ? '{ total: "wrong", label: old.count }'
    : '{ total: old.count, label: "migrated" }';
  const event = options.invalidEvent
    ? '{ name: "missing", payload: { by: payload.by, source: "migration" } }'
    : '{ name: "incremented", payload: { by: payload.by, source: "migration" } }';
  return `import type { Migration } from "@poggers/app";
import type { App as From } from "./snapshots/${fromHash}.ts";
import type { App as To } from "./snapshots/${toHash}.ts";

export default {
  from: "${fromHash}",
  to: "${toHash}",
  migrate: {
    counter: {
      state(old) {
        return ${state};
      },
      event(name, payload) {
        if (name !== "inc") throw new Error("Unknown event");
        return ${event};
      },
    },
  },
} satisfies Migration<From, To>;
`;
}

const counterTypesV1 = `export type App = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { inc: { by: number } };
      Views: { count: number };
      Commands: Record<string, never>;
    };
  };
};
`;

const counterTypesV1Formatted = `// Comments and whitespace do not affect the structural hash.
export type App =
{
  Resources:
  {
    counter:
    {
      Key: { id: string };
      State: { count: number };
      Events: { inc: { by: number } };
      Views: { count: number };
      Commands: Record<string, never>;
    };
  };
};
`;

const counterTypesV2 = `export type App = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { total: number; label: string };
      Events: { incremented: { by: number; source: string } };
      Views: { total: number };
      Commands: Record<string, never>;
    };
  };
};
`;

const counterAppV1 = `import type { AppDefinition } from "@poggers/app";

export default {
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        inc({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {},
    },
  },
  root() {
    return null;
  },
} satisfies AppDefinition;
`;

const counterAppV2 = `import type { AppDefinition } from "@poggers/app";

export default {
  version: 2,
  resources: {
    counter: {
      state: { total: 0, label: "current" },
      events: {
        incremented({ state, payload }) {
          state.total += payload.by;
          state.label = payload.source;
        },
      },
      views: {
        total({ state }) {
          return state.total;
        },
      },
      commands: {},
    },
  },
  root() {
    return null;
  },
} satisfies AppDefinition;
`;
