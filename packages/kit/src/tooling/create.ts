#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

type CreateProjectArgs = Readonly<{
  projectName?: string;
  name?: string;
  kitVersion?: string;
  force: boolean;
  install: boolean;
}>;

export async function createProject(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const targetDir = resolve(args.projectName ?? "my-app");
  const appName = args.name ?? packageNameFromDir(targetDir);
  const kitVersion = args.kitVersion ?? "latest";

  if (existsSync(targetDir) && !args.force) {
    const entries = await readdir(targetDir);
    if (entries.length) fail(`Directory ${targetDir} is not empty. Pass --force to write into it.`);
  }

  await mkdir(targetDir, { recursive: true });
  for (const [path, content] of Object.entries(files({ appName, kitVersion }))) {
    const filePath = resolve(targetDir, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  if (args.install) {
    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: targetDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!install.success) fail("bun install failed.");

    const format = Bun.spawnSync({
      cmd: ["bun", "run", "fmt"],
      cwd: targetDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!format.success) fail("bun run fmt failed.");
  }

  const relativeDir = args.projectName ?? ".";
  console.log(`Created ${appName} in ${targetDir}\n`);
  if (relativeDir !== ".") console.log(`  cd ${relativeDir}`);
  if (!args.install) console.log("  bun install");
  console.log("  bun dev\n");
  console.log("Build a single executable with:\n  bun run build");
}

function parseArgs(argv: readonly string[]): CreateProjectArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "no-install" || name === "install" || name === "force") {
      flags.set(name === "no-install" ? "install" : name, name !== "no-install");
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) fail(`Missing value for --${name}.`);
    flags.set(name, next);
    index++;
  }
  return {
    projectName: positional[0],
    name: stringFlag(flags.get("name")),
    kitVersion: stringFlag(flags.get("kit-version")),
    force: flags.get("force") === true,
    install: flags.get("install") !== false,
  };
}

function files({
  appName,
  kitVersion,
}: {
  appName: string;
  kitVersion: string;
}): Record<string, string> {
  const displayName = titleFromPackageName(appName);
  return {
    "package.json": `${JSON.stringify(
      {
        name: appName,
        private: true,
        type: "module",
        scripts: {
          dev: "poggers dev",
          build: "poggers build --outfile dist/app",
          start: "./dist/app",
          test: "poggers test",
          typecheck: "poggers typecheck",
          lint: "oxlint src",
          fmt: "oxfmt",
          "fmt:check": "oxfmt --check",
          check: "bun run typecheck && bun run lint && bun run fmt:check && bun run test",
        },
        dependencies: { "@poggers/kit": kitVersion },
        devDependencies: {
          "@types/bun": "^1.3.14",
          oxfmt: "^0.58.0",
          oxlint: "^1.73.0",
          typescript: "^7.0.2",
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "@poggers/kit/tsconfig",
      },
      null,
      2,
    )}\n`,
    ".gitignore": `node_modules\n.poggers\ndist\n.DS_Store\n`,
    ".oxlintrc.json": `${JSON.stringify(
      {
        $schema: "./node_modules/oxlint/configuration_schema.json",
        plugins: ["import", "typescript", "unicorn", "oxc"],
        categories: { correctness: "error" },
        ignorePatterns: [".poggers/**", "dist/**"],
        rules: {
          "import/no-cycle": "error",
          "no-duplicate-imports": "error",
          "typescript/consistent-type-imports": "error",
          "typescript/no-explicit-any": "error",
          "unicorn/filename-case": "error",
        },
        options: {
          reportUnusedDisableDirectives: "error",
          denyWarnings: true,
        },
        env: { builtin: true },
      },
      null,
      2,
    )}\n`,
    ".oxfmtrc.json": `${JSON.stringify(
      {
        $schema: "./node_modules/oxfmt/configuration_schema.json",
        ignorePatterns: [".poggers/**", "dist/**"],
        sortImports: true,
      },
      null,
      2,
    )}\n`,
    "src/features/counter.tsx": `import type { FeatureDef, Submission, SubmissionFailure, SubmissionSuccess } from "@poggers/kit";
import { createPress, type Child } from "@poggers/kit/ui";
import type { App } from "src/app";

export type CounterState = { count: number };

export type CounterEvents = {
  incremented: { by: number };
  reset: {};
};

export type CounterViews = { count: number };

export type CounterCommands = {
  increment: { Input: { by?: number }; Event: "incremented"; Error: never };
  reset: { Input: {}; Event: "reset"; Error: never };
};

export type CounterModel = CounterViews & {
  increment(input: { by?: number }): Submission<never>;
  reset(input: {}): Submission<never>;
};

export type CounterFeature = {
  Resources: {
    counter: {
      Key: { id: string };
      State: CounterState;
      Events: CounterEvents;
      Views: CounterViews;
      Commands: CounterCommands;
    };
  };
  Components: {
    Counter: {
      State: { count: number };
      Parts: { Root: "section" };
    };
    Button: {
      Input: { label: string; disabled: boolean; tone: "neutral" | "primary"; action: "reset" | "increment" };
      State: { label: string; disabled: boolean; tone: "neutral" | "primary" };
      Phases: "active" | "running";
      Tasks: {
        activate: {
          Input: "reset" | "increment";
          Output: SubmissionSuccess;
          Error: SubmissionFailure<never>;
        };
      };
      Actions: { activate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    CounterPanel: {
      Input: { value: string };
      State: { value: string };
      Slots: { actions: Child };
      Parts: { Root: "section"; Copy: "div"; Meta: "p"; Value: "h2"; Actions: "div" };
    };
  };
  API: { readonly counter: (key: { id: string }) => CounterModel };
};

export const counterFeature = {
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) { state.count += payload.by; },
        reset({ state }) { state.count = 0; },
      },
      views: { count({ state }) { return state.count; } },
      commands: {
        increment(ctx, { by = 1 }) { return ctx.event.incremented({ by }); },
        reset(ctx, _input) { return ctx.event.reset({}); },
      },
    },
  },
  api: ({ resources }) => ({ counter: resources.counter }),
  components: {
    Counter: {
      state: ({ api }) => ({ count: api.counter({ id: "main" }).count }),
      view({ state, components: { CounterPanel, Button }, parts: { Root } }) {
        return <Root><CounterPanel value={String(state.count)} actions={<>
          <Button label="Reset" disabled={false} tone="neutral" action="reset" />
          <Button label="Add one" disabled={false} tone="primary" action="increment" />
        </>} /></Root>;
      },
    },
    Button: {
      state({ input }) { return { label: input.label, disabled: input.disabled, tone: input.tone }; },
      machine: {
        initial: "active",
        phases: {
          active: { on: { activate: "running" } },
          running: { task: { run: "activate", input: ({ input }) => input.action, done: "active", fail: "active" } },
        },
        tasks: {
          activate({ api, value }) {
            const counter = api.counter({ id: "main" });
            return value === "reset" ? counter.reset({}) : counter.increment({ by: 1 });
          },
        },
      },
      view({ state, actions, parts: { Root, Label } }) {
        return <Root type="button" disabled={state.disabled} {...createPress(actions.activate)}>
          <Label>{state.label}</Label>
        </Root>;
      },
    },
    CounterPanel: {
      state({ input }) { return { value: input.value }; },
      view({ state, slots, parts: { Root, Copy, Meta, Value, Actions } }) {
        return <Root>
          <Copy><Meta>Counter</Meta><Value>{state.value}</Value></Copy>
          <Actions>{slots.actions}</Actions>
        </Root>;
      },
    },
  },
} satisfies FeatureDef<App, CounterFeature>;
`,
    "src/app.tsx": `import type { AppDef as AppDefinition } from "@poggers/kit";
import { counterFeature, type CounterFeature } from "src/features/counter";
import { systemPreset } from "src/presets/system";

export type App = {
  Resources: {};
  Features: { counter: CounterFeature };
  Components: {
    AppShell: {
      Parts: { Root: "main"; Content: "div" };
    };
    Header: {
      Parts: { Root: "header"; Eyebrow: "p"; Title: "h1"; Summary: "p" };
    };
  };
  Styles: {
    Presets: {
      system: {
        Tokens: {
          color: "canvas" | "panel" | "panelMuted" | "text" | "muted" | "border" | "accent" | "onAccent" | "focus";
          space: "sm" | "md" | "lg" | "xl";
          size: "compact" | "content";
          radius: "sm" | "md";
          shadow: "panel";
          font: "body";
          motion: "quick";
        };
        Themes: "default";
      };
    };
  };
};

export default {
  version: 1,
  app: { name: ${JSON.stringify(displayName)} },
  pwa: {
    name: ${JSON.stringify(displayName)},
    shortName: ${JSON.stringify(displayName)},
    themeColor: "oklch(24% 0.02 255)",
    backgroundColor: "oklch(98% 0.004 255)",
    display: "standalone",
  },
  features: { counter: counterFeature },
  components: {
    AppShell: {
      view({ components: { Header }, features: { counter }, parts: { Root, Content } }) {
        return (
          <Root>
            <Content>
              <Header />
              {counter.Counter()}
            </Content>
          </Root>
        );
      },
    },
    Header: {
      view({ parts: { Root, Eyebrow, Title, Summary } }) {
        return (
          <Root>
            <Eyebrow>Poggers app</Eyebrow>
            <Title>${displayName}</Title>
            <Summary>
              Typed application behavior and a compiled visual preset, with no backend styling API
              in application code.
            </Summary>
          </Root>
        );
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: "AppShell",
} satisfies AppDefinition<App>;
`,
    "src/features/counter.spec.ts": `import { expect, test } from "bun:test";
import { defineApp, testFeature } from "@poggers/kit/testing";
import definition, { type App } from "src/app";

test("the counter Feature is testable through its semantic API", async () => {
  const fixture = await testFeature(defineApp<App>(definition), "counter");
  const counter = fixture.api.counter({ id: "main" });
  expect(counter.count).toBe(0);
  await counter.increment({ by: 2 });
  expect(counter.count).toBe(2);
  await fixture.dispose();
});
`,
    "src/presets/system.ts": `import type { Preset, PresetTokens } from "@poggers/kit/preset";
import type { App } from "src/app";

const theme = {
    color: {
      canvas: { l: 0.98, c: 0.004, h: 255 },
      panel: { l: 1, c: 0, h: 0 },
      panelMuted: { l: 0.965, c: 0.006, h: 255 },
      text: { l: 0.22, c: 0.015, h: 255 },
      muted: { l: 0.52, c: 0.012, h: 255 },
      border: { l: 0.89, c: 0.008, h: 255 },
      accent: { l: 0.24, c: 0.02, h: 255 },
      onAccent: { l: 0.99, c: 0.002, h: 255 },
      focus: { l: 0.62, c: 0.14, h: 250 },
    },
    space: {
      sm: { kind: "space", value: 10 }, md: { kind: "space", value: 16 },
      lg: { kind: "space", value: 24 }, xl: { kind: "space", value: 36 },
    },
    size: {
      compact: { kind: "size", value: 460 },
      content: { kind: "size", value: 720 },
    },
    radius: { sm: { kind: "radius", value: 8 }, md: { kind: "radius", value: 12 } },
    shadow: {
      panel: { y: 24, blur: 80, spread: -36, color: { l: 0.2, c: 0.02, h: 255, alpha: 0.28 } },
    },
    font: {
      body: { fallback: ["ui-sans-serif", "system-ui", "sans-serif"] },
    },
    motion: {
      quick: { duration: 140, easing: "decelerate" },
    },
} satisfies PresetTokens<App, "system">;

export const systemPreset = (({ tokens, createRecipe }) => {
  const buttonTone = createRecipe({
    variants: {
      tone: {
        neutral: {},
        primary: {
          paint: {
            fill: tokens.color.accent,
            stroke: { color: tokens.color.accent },
          },
          typography: { color: tokens.color.onAccent },
        },
      },
    },
  });

  return { theme, components: {
    AppShell() {
      return { Root: {
        layout: {
          grid: {
            columns: [{ minmax: [0, tokens.size.content] }],
            align: "center",
            distribute: "center",
          },
          size: { inline: "fill", block: { min: { viewport: { axis: "block", percent: 1 } } } },
          padding: { block: tokens.space.xl, inline: tokens.space.lg },
        },
        paint: { fill: tokens.color.canvas },
        typography: { color: tokens.color.text, font: tokens.font.body },
      },
      Content: {
        layout: { flow: { axis: "block", gap: tokens.space.lg }, size: { inline: "fill" } },
      } };
    },
    Header() {
      return { Root: { layout: { flow: { axis: "block", gap: tokens.space.sm } } },
      Eyebrow: {
        layout: { margin: 0 },
        typography: { color: tokens.color.muted, size: 12, weight: 700, line: 1, transform: "uppercase" },
      },
      Title: { layout: { margin: 0 }, typography: { size: 32, weight: 720, line: 1.05 } },
      Summary: {
        layout: { size: { inline: { max: 520 } }, margin: 0 },
        typography: { color: tokens.color.muted, size: 15, line: 1.5, wrap: "pretty" },
      } };
    },
  }, features: { counter: { components: {
    Counter() {
      return { Root: { layout: { size: { inline: "fill" } } } };
    },
    Button({ state, interaction }) {
      return { Root: [{
        layout: {
          flow: { axis: "inline", align: "center", distribute: "center" },
          size: { block: 42 },
          padding: { inline: tokens.space.md },
        },
        paint: {
          fill: tokens.color.panelMuted,
          stroke: { width: 1, line: "solid", color: tokens.color.border },
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 3, offset: 2 },
        },
        shape: { radius: tokens.radius.sm },
        typography: { color: tokens.color.text, size: 14, weight: 650, line: 1 },
        motion: { transition: { opacity: tokens.motion.quick, transform: tokens.motion.quick } },
      },
      buttonTone({ tone: state.tone }),
      { when: interaction.hovered, paint: { opacity: 0.84 } },
      { when: interaction.pressed, motion: { scale: 0.98 } },
      { when: interaction.disabled, paint: { opacity: 0.5, cursor: "default" } },
      ],
      Label: { typography: { wrap: "nowrap" } },
      };
    },
    CounterPanel({ geometry }) {
      return { Root: [{
        layout: {
          grid: { columns: [{ minmax: [0, { fraction: 1 }] }, "content"], align: "center" },
          padding: tokens.space.lg,
        },
        paint: {
          fill: tokens.color.panel,
          stroke: { width: 1, line: "solid", color: tokens.color.border },
          shadow: tokens.shadow.panel,
        },
        shape: { radius: tokens.radius.md },
      },
      { when: geometry.inlineSize.isBelow(tokens.size.compact), layout: { flow: { axis: "block", gap: tokens.space.lg, align: "stretch" } } },
      ],
      Copy: { layout: { flow: { axis: "block", gap: tokens.space.sm } } },
      Meta: { layout: { margin: 0 }, typography: { color: tokens.color.muted, size: 13, weight: 620, line: 1.2 } },
      Value: { layout: { margin: 0 }, typography: { size: 44, weight: 720, line: 1 } },
      Actions: { layout: { flow: { axis: "inline", align: "center", gap: tokens.space.sm } } },
      };
    },
  } } } };
}) satisfies Preset<App, "system">;
`,
  };
}

function packageNameFromDir(dir: string): string {
  return (
    basename(dir)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-app"
  );
}

function titleFromPackageName(name: string): string {
  return name
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (import.meta.main) await createProject(Bun.argv.slice(2));
