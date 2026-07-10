import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkAppConventions, resolveDependencyMount, writeAppTypes } from "../src/runtime";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("Poggers app virtual modules", () => {
  it("resolves values and named production/mock dependency providers", async () => {
    const deps = await resolveDependencyMount<{
      ai: { complete(): string };
      clock: { now(): number };
    }>({
      mode: "mock",
      ai: {
        production: { complete: () => "production" },
        mock: { complete: () => "mock" },
      },
      clock: { now: () => 123 },
    });

    expect(deps.ai.complete()).toBe("mock");
    expect(deps.clock.now()).toBe(123);
  });

  it("uses POGGERS_DEPS as the default dependency mode", async () => {
    const previous = process.env.POGGERS_DEPS;
    process.env.POGGERS_DEPS = "mock";

    try {
      const deps = await resolveDependencyMount<{ ai: { complete(): string } }>({
        ai: {
          production: { complete: () => "production" },
          mock: { complete: () => "mock" },
        },
      });
      expect(deps.ai.complete()).toBe("mock");
    } finally {
      if (previous === undefined) delete process.env.POGGERS_DEPS;
      else process.env.POGGERS_DEPS = previous;
    }
  });

  it("generates shallow dependency and component aliases", async () => {
    const appDir = await writeVisualFixture("types");
    const output = await writeAppTypes(appDir);
    const source = await readFile(output!, "utf8");

    expect(source).toContain(
      "export type ServerDeps = AppSpec extends { Deps: infer Deps } ? Deps : EmptyObject;",
    );
    expect(source).toContain(
      "export type DependencyDefinition = DependencyConfig<AppDependencies>;",
    );
    expect(source).toContain("export function createButton(input: ButtonOptions): ButtonInstance;");
    expect(source).toContain("input: ButtonInput;");
    expect(source).toContain("variants: ButtonVariants;");
    expect(source).not.toContain("state?: ButtonState;");
    expect(source).not.toContain("actions?: ButtonActionFactory;");
    expect(source).not.toContain("derived?: ButtonDerivedFactory;");
    expect(source).not.toContain("useTheme():");
    expect(source).not.toContain("setThemeParam");
    expect(source).not.toContain("className?: PartValue");
    expect(source).not.toContain("style?: PartValue");
  });

  it("validates and statically bundles the closed v2 visual preset", async () => {
    const appDir = await writeVisualFixture("bundle");
    expect(checkAppConventions(appDir)).toEqual([]);

    const outdir = join(appDir, "dist");
    const build = await runCli(appDir, ["bundle", ".", "--outdir", outdir, "--minify", "false"]);
    expect(build.code, build.stderr).toBe(0);
    const files = await readdir(outdir);
    const cssFile = files.find((file) => file.endsWith(".css"));
    const jsFile = files.find((file) => file.endsWith(".js"));
    expect(cssFile).toBeDefined();
    expect(jsFile).toBeDefined();

    const css = await readFile(join(outdir, cssFile!), "utf8");
    const js = await readFile(join(outdir, jsFile!), "utf8");
    expect(css).toContain("background-color:");
    expect(css).toContain("border-radius:");
    expect(css).toContain("@container");
    expect(js).not.toContain("stylex.create");
    expect(js).not.toContain("stylex-inject");
    expect(js).not.toContain("data-stylex");
  });

  it("reports compiler diagnostics through the app validation boundary", async () => {
    const appDir = await writeVisualFixture("invalid", { invalidVisualField: true });
    const check = await runCli(appDir, ["check", "."]);
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('unknown field "mystery"');
  });

  it("rejects raw classes, inline style, and direct backend imports", async () => {
    const appDir = await writeVisualFixture("escapes");
    await writeFile(
      join(appDir, "src/ui/root.tsx"),
      `import * as stylex from "@stylexjs/stylex";

export function Root() {
  const className = stylex.props({}).className;
  return <div className={className} style={{ color: "red" }} />;
}
`,
    );

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toEqual([
      "ui files must not use class/className; render generated component parts.",
      "ui files must not use inline style; define visual rules in presets.",
      "ui files must not import @stylexjs/stylex in strict style apps; put visual rules in app styles.",
    ]);
  });

  it("enforces flat kebab-case UI modules", async () => {
    const appDir = await writeVisualFixture("names");
    await mkdir(join(appDir, "src/ui/nested"), { recursive: true });
    await writeFile(join(appDir, "src/ui/nested/BadName.tsx"), "export const value = 1;\n");

    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "ui file names must be kebab-case.",
    );
    expect(checkAppConventions(appDir).map((issue) => issue.message)).toContain(
      "ui files must live directly in src/ui; do not nest ui folders.",
    );
  });
});

async function runCli(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cli = resolve(import.meta.dir, "../src/cli.ts");
  const process = Bun.spawn(["bun", cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function writeVisualFixture(
  name: string,
  options: { invalidVisualField?: boolean } = {},
): Promise<string> {
  const appDir = await mkdtemp(resolve(`.poggers-runtime-${name}-`));
  createdDirs.push(appDir);
  await mkdir(join(appDir, "src/ui"), { recursive: true });

  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({
      name: `@poggers/runtime-${name}`,
      private: true,
      type: "module",
      dependencies: { "@poggers/kit": "workspace:*" },
    }),
  );
  await writeFile(join(appDir, "tsconfig.json"), '{"extends":"@poggers/kit/tsconfig"}\n');
  await writeFile(
    join(appDir, "src/types.ts"),
    `export type App = {
  Resources: {};
  Deps: { logger: { write(message: string): void } };
  Components: {
    Button: {
      Input: { label: string; activate(): void };
      Variants: { tone: "quiet" | "strong" };
      State: { active: boolean };
      Derived: { label: string };
      Actions: { activate(): void };
      StyleValues: { press: "progress" };
      Parts: { Root: "button"; Label: "span" };
    };
  };
  Styles: {
    Presets: {
      system: {
        Tokens: {
          color: "canvas" | "text" | "accent" | "focus";
          space: "control";
          radius: "control";
          motion: "quick" | "settle";
        };
        Themes: "default";
        Containers: "compact";
      };
    };
  };
};
`,
  );
  await writeFile(
    join(appDir, "src/presets.ts"),
    `import type { Preset } from "@poggers/kit/style";
import type { App } from "types";

export const systemPreset = {
  tokens: {
    color: {
      canvas: { l: 0.98, c: 0.004, h: 255 },
      text: { l: 0.2, c: 0.01, h: 255 },
      accent: { l: 0.56, c: 0.18, h: 255 },
      focus: { l: 0.64, c: 0.17, h: 250 },
    },
    space: { control: 12 },
    radius: { control: 10 },
    motion: {
      quick: { duration: 130, easing: "decelerate" },
      settle: { spring: { duration: 380, bounce: 0.06 } },
    },
  },
  themes: { default: {} },
  containers: { compact: { inlineBelow: 420 } },
  components: ({ tokens }) => ({
    Button: ({ values }) => ({
      Root: {
        layout: { kind: "row", align: "center", distribute: "center" },
        padding: { inline: tokens.space.control },
        surface: { fill: tokens.color.canvas, text: tokens.color.text },
        shape: { radius: tokens.radius.control },
        interaction: {
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 3, offset: 2 },
        },
        effect: { opacity: values.press },
        when: [
          { variant: { tone: "strong" }, apply: { surface: { fill: tokens.color.accent } } },
          { container: "compact", apply: { frame: { inline: "fill" } } },
        ],
        motion: { change: { opacity: tokens.motion.quick }, layout: { geometry: "position", using: tokens.motion.settle } },
        ${options.invalidVisualField ? "mystery: true," : ""}
      },
      Label: { text: { size: 14, weight: 650, line: 1 } },
    }),
  }),
} satisfies Preset<App, "system">;
`,
  );
  await writeFile(
    join(appDir, "src/app.ts"),
    `import type { AppDefinition } from "@poggers/app";
import { systemPreset } from "src/presets";
import type { App } from "types";
import { Root } from "ui/root";

export default {
  version: 1,
  resources: {},
  components: {
    Button: {
      state: { active: false },
      derived({ input }) {
        return { get label() { return input.label; } };
      },
      actions({ input, state }) {
        return {
          activate() {
            state.active = !state.active;
            input.activate();
          },
        };
      },
      bind({ state, derived, actions }) {
        return {
          values: { press: state.active ? 0.82 : 1 },
          Root: { type: "button", onClick: actions.activate, "aria-pressed": state.active },
          Label: { children: derived.label },
        };
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: Root,
} satisfies AppDefinition<App>;
`,
  );
  await writeFile(
    join(appDir, "src/ui/root.tsx"),
    `import { createButton } from "@poggers/app";

export function Root() {
  const Button = createButton({
    input: { label: "Toggle", activate() {} },
    variants: { tone: "strong" },
  });
  return () => <Button.Root><Button.Label /></Button.Root>;
}
`,
  );

  return appDir;
}
