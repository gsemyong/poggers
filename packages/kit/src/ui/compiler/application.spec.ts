import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeAppContract } from "#ui/compiler/application";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("application manifest", () => {
  test("extracts canonical dependency-free product meaning without executing imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-manifest-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(
      join(directory, "src/vendor.ts"),
      `throw new Error("type-only imports must never execute");
export type Search = { query(text: string): Promise<readonly string[]> };
`,
    );
    const appPath = join(directory, "src/app.ts");
    const source = manifestFixture(false);
    await writeFile(appPath, source);

    const first = analyzeAppContract(appPath).manifest;
    expect(first.scopes.map(({ path }) => path)).toEqual(["", "chat"]);
    expect(first.scopes[0]).toEqual({
      path: "",
      resources: [
        {
          name: "account",
          events: ["renamed"],
          views: ["name"],
          commands: [{ name: "rename", event: "renamed", hasInput: true, hasError: true }],
        },
      ],
      components: [
        {
          name: "Shell",
          input: [],
          context: [],
          phases: [],
          output: false,
          state: [],
          actions: [],
          parameters: [],
          tasks: [],
          slots: [],
          parts: { Root: "main" },
        },
      ],
      features: ["chat"],
      programs: [
        {
          environment: "browser",
          name: "serve",
          kind: "service",
          events: [],
          replay: "all",
          version: 1,
          key: "resource",
        },
        {
          environment: "server",
          name: "indexAccount",
          kind: "events",
          events: ["account.renamed"],
          replay: "all",
          version: 3,
          key: { version: 2 },
        },
      ],
      dependencies: [{ environment: "server", members: ["search"] }],
      navigation: [{ name: "account", parameters: ["id"] }],
      endpoints: [{ name: "health", methods: ["GET"] }],
      api: ["openAccount"],
    });
    expect(first.scopes[1]?.resources[0]?.name).toBe("thread");
    expect(first.scopes[1]?.programs).toEqual([
      {
        environment: "browser",
        name: "synchronize",
        kind: "events",
        events: ["thread.changed"],
        replay: "all",
        version: 1,
        key: "resource",
      },
    ]);
    expect(first.presets).toEqual([
      {
        name: "studio",
        tokens: [
          { group: "color", name: "canvas", kind: "color" },
          { group: "color", name: "text", kind: "color" },
        ],
        themes: ["dark"],
        conditions: [{ name: "compact" }],
      },
    ]);

    await writeFile(appPath, manifestFixture(true));
    const reordered = analyzeAppContract(appPath).manifest;
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});

function manifestFixture(reordered: boolean): string {
  const declarations = [
    `Actor: { id: string }`,
    `Resources: { account: {
    Key: { id: string };
    State: { name: string };
    Events: { renamed: { name: string } };
    Views: { name: string };
    Commands: { rename: { Error: "invalid"; Event: "renamed"; Input: { name: string } } };
  } }`,
    `Components: { Shell: { Parts: { Root: "main" } } }`,
    `Dependencies: { server: { search: Search } }`,
    `Programs: {
      server: {
        indexAccount: {
          Events: readonly ["account.renamed"];
          Key: { id: string };
          KeyVersion: 2;
          Version: 3;
        };
      };
      browser: { serve: {} };
    }`,
    `Navigation: { account: { id: string } }`,
    `Endpoints: { health: { Method: "GET" } }`,
    `API: { openAccount(id: string): void }`,
    `Features: {
      chat: {
        Resources: {
          thread: {
            Key: { id: string };
            State: { title: string };
            Events: { changed: { title: string } };
            Views: { title: string };
            Commands: {};
          };
        };
        Components: { Composer: { Parts: { Root: "form"; Input: "input" } } };
        Dependencies: { browser: { clipboard: { write(text: string): void } } };
        Programs: {
          browser: {
            synchronize: { Events: readonly ["thread.changed"] };
          };
        };
        Navigation: { thread: { id: string } };
        Endpoints: { messages: { Method: "GET" | "POST" } };
        API: { send(text: string): void };
      };
    }`,
    `Styles: {
      Presets: {
        studio: {
          Tokens: { color: "text" | "canvas" };
          Themes: "dark";
          Containers: "compact";
        };
      };
    }`,
  ];
  if (reordered) declarations.reverse();
  return `import type { Search } from "./vendor";
export type App = {
  ${declarations.join(";\n  ")};
};
`;
}
