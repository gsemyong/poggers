import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export async function createProject(arguments_: readonly string[]): Promise<void> {
  const target = resolve(arguments_.find((value) => !value.startsWith("--")) ?? "my-app");
  const force = arguments_.includes("--force");
  const install = !arguments_.includes("--no-install");
  const version = flag(arguments_, "kit-version") ?? "latest";
  const name =
    flag(arguments_, "name") ??
    basename(target)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");

  if (!force) {
    try {
      if ((await readdir(target)).length) throw new Error(`${target} is not empty.`);
    } catch (error) {
      if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
    }
  }

  for (const [path, contents] of Object.entries(template(name, version))) {
    const file = resolve(target, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  if (install) {
    const code = await run("nub", ["install"], target);
    if (code !== 0) throw new Error("nub install failed.");
  }
  console.log(`created ${name} in ${target}`);
}

function template(name: string, version: string): Record<string, string> {
  return {
    "package.json": `${JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        scripts: {
          dev: "poggers dev",
          build: "poggers build --outdir dist",
          typecheck: "poggers typecheck",
          test: "poggers test",
          lint: "oxlint src",
          fmt: "oxfmt",
          check: "poggers check",
        },
        dependencies: { "@poggers/kit": version },
        devDependencies: {
          oxfmt: "^0.58.0",
          oxlint: "^1.73.0",
          typescript: "^7.0.2",
          vitest: "^4.1.10",
        },
        engines: { node: ">=24.0.0" },
        packageManager: "nub@0.4.13",
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `{ "extends": "@poggers/kit/tsconfig" }\n`,
    ".gitignore": "node_modules\n.poggers\ndist\n.DS_Store\n",
    ".node-version": "24.18.0\n",
    ".oxlintrc.json": `{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": { "correctness": "error" },
  "rules": {
    "no-duplicate-imports": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/no-explicit-any": "error",
    "unicorn/filename-case": ["error", { "cases": { "kebabCase": true } }]
  },
  "ignorePatterns": [".poggers/**", "dist/**"]
}
`,
    ".oxfmtrc.json": `{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "ignorePatterns": [".poggers/**", "dist/**"]
}
`,
    "src/app.tsx": `import type { Application, Feature, Program, WebMain } from "@poggers/kit";
import type { Presentation } from "@poggers/kit/presentation";

export type App = {
  Features: { shell: ShellFeature };
  Presentations: "clean";
};

type ShellFeature = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Components: {
          Application: { Parts: { Root: "main"; Title: "h1" } };
        };
      }
    >;
  };
};

const clean = (() => ({
  theme: {},
  components: {
    Shell: {
      Application: () => ({
        Root: {
          layout: {
            flow: { axis: "block", align: "center", distribute: "center" },
            size: { block: { min: { viewport: { axis: "block", percent: 1 } } } },
          },
        },
        Title: { typography: { size: 32, weight: 600, color: "current" } },
      }),
    },
  },
})) satisfies Presentation<App, "clean">;

const shellFeature = {
  programs: {
    browser: {
      components: {
        Application: {
          view({ parts: { Root, Title } }) {
            return (
              <Root>
                <Title>${name}</Title>
              </Root>
            );
          },
        },
      },
      root: "Application",
    },
  },
} satisfies Feature<ShellFeature>;

export default {
  metadata: { name: ${JSON.stringify(name)} },
  features: { shell: shellFeature },
  presentations: { clean },
} satisfies Application<App>;
`,
  };
}

function flag(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? undefined : arguments_[index + 1];
}

function run(command: string, arguments_: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
