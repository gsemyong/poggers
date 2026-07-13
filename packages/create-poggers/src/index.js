#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const args = parseArgs(Bun.argv.slice(2));
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
}

const relativeDir = args.projectName ?? ".";
console.log(`Created ${appName} in ${targetDir}\n`);
if (relativeDir !== ".") console.log(`  cd ${relativeDir}`);
if (!args.install) console.log("  bun install");
console.log("  bun dev\n");
console.log("Build a single executable with:\n  bun run build");

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
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
    name: flags.get("name"),
    kitVersion: flags.get("kit-version"),
    force: flags.get("force") === true,
    install: flags.get("install") ?? true,
  };
}

function files({ appName, kitVersion }) {
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
          lint: "poggers check",
          typecheck: "poggers typecheck",
        },
        dependencies: { "@poggers/kit": kitVersion },
        devDependencies: { typescript: "^7.0.2" },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify({ extends: "@poggers/kit/tsconfig" }, null, 2)}\n`,
    ".gitignore": `node_modules\n.poggers\ndist\n.DS_Store\n`,
    "src/types.ts": `import type { Child } from "@poggers/kit/ui";

export type CounterState = { count: number };

export type CounterEvents = {
  incremented: { by: number };
  reset: {};
};

export type CounterViews = { count: number };

export type CounterCommands = {
  increment: { args: [by?: number]; event: "incremented"; error: never };
  reset: { args: []; event: "reset"; error: never };
};

export type ServerDeps = { clock: { now(): number } };

export type App = {
  Resources: {
    counter: {
      Key: { id: string };
      State: CounterState;
      Events: CounterEvents;
      Views: CounterViews;
      Commands: CounterCommands;
    };
  };
  Deps: ServerDeps;
  Components: {
    AppShell: {
      Parts: { Root: "main"; Content: "div" };
    };
    Header: {
      Parts: { Root: "header"; Eyebrow: "p"; Title: "h1"; Summary: "p" };
    };
    Button: {
      Input: { label: string; disabled: boolean; tone: "neutral" | "primary"; activate(): void };
      Values: { tone: "neutral" | "primary" };
      States: "active";
      Events: { activate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    CounterPanel: {
      Input: { value: string };
      Values: { value: string };
      Slots: { actions: Child };
      Parts: { Root: "section"; Copy: "div"; Meta: "p"; Value: "h2"; Actions: "div" };
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
`,
    "src/app.tsx": `import type { AppDef as AppDefinition } from "@poggers/kit";
import { createPress } from "@poggers/kit/web";
import { systemPreset } from "src/presets";
import type { App } from "src/types";

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
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) { state.count += payload.by; },
        reset({ state }) { state.count = 0; },
      },
      views: { count({ state }) { return state.count; } },
      commands: {
        increment(ctx, by = 1) { return ctx.event.incremented({ by }); },
        reset(ctx) { return ctx.event.reset({}); },
      },
    },
  },
  components: {
    AppShell: {
      render({ components: { Header, CounterPanel, Button }, resources, parts: { Root, Content } }) {
        const counter = resources.counter({ id: "main" });
        return (
          <Root>
            <Content>
              <Header />
              <CounterPanel value={String(counter.count)} actions={<>
                <Button label="Reset" disabled={false} tone="neutral" activate={() => { void counter.reset(); }} />
                <Button label="Add one" disabled={false} tone="primary" activate={() => { void counter.increment(); }} />
              </>} />
            </Content>
          </Root>
        );
      },
    },
    Header: {
      render({ parts: { Root, Eyebrow, Title, Summary } }) {
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
    Button: {
      derive({ input }) {
        return { tone: input.tone };
      },
      initial: "active",
      states: {
          active: {
            on: {
              activate: { perform: ({ input }) => input.activate() },
            },
          },
      },
      render({ input, events, parts: { Root, Label } }) {
        return <Root type="button" disabled={input.disabled} {...createPress(events.activate)}>
          <Label>{input.label}</Label>
        </Root>;
      },
    },
    CounterPanel: {
      derive({ input }) {
        return { value: input.value };
      },
      render({ values, slots, parts: { Root, Copy, Meta, Value, Actions } }) {
        return <Root>
          <Copy><Meta>Counter</Meta><Value>{values.value}</Value></Copy>
          <Actions>{slots.actions}</Actions>
        </Root>;
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: "AppShell",
} satisfies AppDefinition<App>;
`,
    "src/presets.ts": `import type { Preset, PresetTokens } from "@poggers/kit/style";
import type { App } from "src/types";

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
      body: { families: ["Inter", "system-ui", "sans-serif"] },
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
    Button({ values, interaction }) {
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
      buttonTone({ tone: values.tone }),
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
  } };
}) satisfies Preset<App, "system">;
`,
    "src/deps.ts": `import type { DependencyConfig } from "@poggers/kit/deps";
import type { ServerDeps } from "src/types";

export default { clock: { now: Date.now } } satisfies DependencyConfig<ServerDeps>;
`,
  };
}

function packageNameFromDir(dir) {
  return (
    basename(dir)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-app"
  );
}

function titleFromPackageName(name) {
  return name
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
