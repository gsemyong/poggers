import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { buildApplication, buildRustApplication, validateUIProgramRoot } from "./application";
import { createProject } from "./create";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("project template", () => {
  test("creates the complete minimal application convention", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "poggers-create-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await createProject([target, "--no-install"]);

    expect(await readFile(resolve(target, "src/app.tsx"), "utf8")).toContain(
      "satisfies Application<App>",
    );
    const packageJson = JSON.parse(await readFile(resolve(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(Object.keys(packageJson.scripts)).toEqual([
      "dev",
      "build",
      "typecheck",
      "test",
      "lint",
      "fmt",
      "check",
    ]);
    expect(await readFile(resolve(target, ".gitignore"), "utf8")).not.toContain("app.d.ts");
    expect(
      await run(
        resolve(import.meta.dirname, "../../../../node_modules/.bin/oxfmt"),
        ["--check", "."],
        target,
      ),
    ).toBe(0);

    const modules = resolve(target, "node_modules");
    await mkdir(resolve(modules, "@poggers"), { recursive: true });
    await symlink(resolve(import.meta.dirname, "../.."), resolve(modules, "@poggers/kit"), "dir");

    expect(
      await run(
        resolve(import.meta.dirname, "../../../../node_modules/.bin/tsc"),
        ["-p", "tsconfig.json"],
        target,
      ),
    ).toBe(0);

    await buildApplication({ directory: target, outdir: "dist" });
    await expect(access(resolve(target, "dist/app.js"))).resolves.toBeUndefined();
    const manifest = JSON.parse(
      await readFile(resolve(target, "dist/product.ir.json"), "utf8"),
    ) as {
      version: number;
      features: readonly { id: string }[];
      programs: readonly { id: string; runtime: { name: string }; ui?: unknown }[];
    };
    expect(manifest.version).toBe(1);
    expect(manifest.features.map(({ id }) => id)).toEqual(["feature/shell"]);
    expect(manifest.programs).toHaveLength(1);
    expect(manifest.programs[0]).toMatchObject({
      id: "feature/shell/program/browser",
      runtime: { name: "web-main" },
      ui: { root: "Application" },
    });
    const html = await readFile(resolve(target, "dist/index.html"), "utf8");
    expect(html).toContain("@layer reset{");
    expect(html).toContain("dialog::backdrop{background:transparent}");
    expect(html.indexOf("@layer reset{")).toBeLessThan(html.indexOf('href="/styles.css"'));

    expect(() =>
      validateUIProgramRoot({ features: { shell: { programs: { browser: {} } } } }, "browser"),
    ).toThrow("exactly one root Component");
  });

  test("builds a portable headless Program through the public Rust target", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "poggers-rust-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await createProject([target, "--no-install"]);
    const modules = resolve(target, "node_modules");
    await mkdir(resolve(modules, "@poggers"), { recursive: true });
    await symlink(resolve(import.meta.dirname, "../.."), resolve(modules, "@poggers/kit"), "dir");
    await writeFile(
      resolve(target, "src/app.tsx"),
      `import type { Application, Feature, Program, Server } from "@poggers/kit";

type Worker = { Programs: { cloud: Program<Server> } };
type App = { Features: { worker: Worker } };

const worker = {
  programs: {
    cloud: {
      start() {
        const values = [1, 2, 3];
        let total = 0;
        for (const value of values) {
          total += value;
        }
        if (total !== 6) return;
      },
    },
  },
} satisfies Feature<Worker>;

export default { features: { worker } } satisfies Application<App>;
`,
    );

    const output = await buildRustApplication({ directory: target, program: "cloud" });
    expect(await run("cargo", ["fmt", "--check"], output)).toBe(0);
    expect(await run("cargo", ["clippy", "--", "-D", "warnings"], output)).toBe(0);
    expect(await run("cargo", ["run", "--quiet", "--release"], output)).toBe(0);
  });

  test("builds a headless Program against a production Rust adapter", async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "poggers-rust-adapter-"));
    directories.push(parent);
    const target = resolve(parent, "example");
    await createProject([target, "--no-install"]);
    const modules = resolve(target, "node_modules");
    await mkdir(resolve(modules, "@poggers"), { recursive: true });
    await symlink(resolve(import.meta.dirname, "../.."), resolve(modules, "@poggers/kit"), "dir");
    await writeFile(
      resolve(target, "src/app.tsx"),
      `import type { Application, Feature, Program, Server } from "@poggers/kit";

type Output = { write(input: { value: number }): Promise<void> };
type Worker = { Programs: { cloud: Program<Server, { Requires: { output: Output } }> } };
type App = { Features: { worker: Worker } };

const worker = {
  programs: {
    cloud: {
      async start({ capabilities }) {
        await capabilities.output.write({ value: 42 });
      },
    },
  },
} satisfies Feature<Worker>;

export default { features: { worker } } satisfies Application<App>;
`,
    );
    await mkdir(resolve(target, "src/adapters"), { recursive: true });
    await writeFile(
      resolve(target, "src/adapters/cloud.rs"),
      `use crate::generated::Capabilities;

struct Adapter;

pub fn create() -> impl Capabilities {
    Adapter
}

impl Capabilities for Adapter {
    fn output_write(&self, input: (f64,)) -> impl std::future::Future<Output = Result<(), String>> {
        println!("value:{}", input.0);
        std::future::ready(Ok(()))
    }
}
`,
    );

    const output = await buildRustApplication({
      directory: target,
      program: "cloud",
      adapter: "src/adapters/cloud.rs",
    });
    expect(await run("cargo", ["fmt", "--check"], output)).toBe(0);
    expect(await run("cargo", ["clippy", "--", "-D", "warnings"], output)).toBe(0);
    expect(await run("cargo", ["run", "--quiet", "--release"], output)).toBe(0);
  });
});

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
