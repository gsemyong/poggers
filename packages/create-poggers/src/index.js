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
          postinstall: "poggers sync",
          dev: "poggers dev",
          build: "poggers build --outfile dist/app",
          start: "./dist/app",
          lint: "poggers check",
          check: "bun run typecheck && bun run lint",
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
    "src/types.ts": `export type CounterState = { count: number };

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
      Input: { label: string; disabled: boolean; activate(): void };
      Variants: { tone: "neutral" | "primary" };
      Actions: { activate(): void };
      Parts: { Root: "button"; Label: "span" };
    };
    CounterPanel: {
      Input: { value: string };
      Derived: { value: string };
      Parts: { Root: "section"; Copy: "div"; Meta: "p"; Value: "h2"; Actions: "div" };
    };
  };
  Styles: {
    Presets: {
      system: {
        Tokens: {
          color: "canvas" | "panel" | "panelMuted" | "text" | "muted" | "border" | "accent" | "onAccent" | "focus";
          space: "sm" | "md" | "lg" | "xl";
          size: "content";
          radius: "sm" | "md";
          shadow: "panel";
          font: "body";
          motion: "quick" | "settle";
        };
        Themes: "default";
        Containers: "compact";
      };
    };
  };
};
`,
    "src/app.ts": `import type { AppDefinition } from "@poggers/app";
import { systemPreset } from "src/presets";
import type { App } from "types";
import { Root } from "ui/root";

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
    Button: {
      actions({ input }) {
        return { activate: input.activate };
      },
      bind({ input, actions }) {
        return {
          Root: { type: "button", disabled: input.disabled, onClick: actions.activate },
          Label: { children: input.label },
        };
      },
    },
    CounterPanel: {
      derived({ input }) {
        return { get value() { return input.value; } };
      },
      bind({ derived }) {
        return { Value: { children: derived.value } };
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: Root,
} satisfies AppDefinition<App>;
`,
    "src/presets.ts": `import type { Preset } from "@poggers/kit/style";
import type { App } from "types";

export const systemPreset = {
  tokens: {
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
    space: { sm: 10, md: 16, lg: 24, xl: 36 },
    size: { content: 720 },
    radius: { sm: 8, md: 12 },
    shadow: {
      panel: { y: 24, blur: 80, spread: -36, color: { l: 0.2, c: 0.02, h: 255, alpha: 0.28 } },
    },
    font: {
      body: { families: ["Inter", "system-ui", "sans-serif"] },
    },
    motion: {
      quick: { duration: 140, easing: "decelerate" },
      settle: { spring: { duration: 420, bounce: 0.04 } },
    },
  },
  themes: { default: {} },
  containers: { compact: { inlineBelow: 460 } },
  components: ({ tokens }) => ({
    AppShell: () => ({
      Root: {
        layout: { kind: "grid", align: "center", distribute: "center" },
        frame: { inline: "fill", block: { min: { viewport: { axis: "block", percent: 1 } } } },
        padding: { block: tokens.space.xl, inline: tokens.space.lg },
        surface: { fill: tokens.color.canvas, text: tokens.color.text },
        text: { font: tokens.font.body },
      },
      Content: {
        layout: { kind: "stack", gap: tokens.space.lg },
        frame: { inline: { max: tokens.size.content } },
        motion: {
          enter: {
            from: { effect: { opacity: 0 }, transform: { block: 8 } },
            using: tokens.motion.settle,
          },
        },
      },
    }),
    Header: () => ({
      Root: { layout: { kind: "stack", gap: tokens.space.sm } },
      Eyebrow: {
        margin: 0,
        surface: { text: tokens.color.muted },
        text: { size: 12, weight: 700, line: 1, transform: "uppercase" },
      },
      Title: { margin: 0, text: { size: 32, weight: 720, line: 1.05 } },
      Summary: {
        frame: { inline: { max: 520 } },
        margin: 0,
        surface: { text: tokens.color.muted },
        text: { size: 15, line: 1.5, wrap: "pretty" },
      },
    }),
    Button: () => ({
      Root: {
        layout: { kind: "row", align: "center", distribute: "center" },
        frame: { block: 42 },
        padding: { inline: tokens.space.md },
        surface: { fill: tokens.color.panelMuted, text: tokens.color.text },
        stroke: { width: 1, line: "solid", color: tokens.color.border },
        shape: { radius: tokens.radius.sm },
        text: { size: 14, weight: 650, line: 1 },
        interaction: {
          cursor: "pointer",
          focusRing: { color: tokens.color.focus, width: 3, offset: 2 },
        },
        when: [
          { variant: { tone: "primary" }, apply: { surface: { fill: tokens.color.accent, text: tokens.color.onAccent }, stroke: { color: tokens.color.accent } } },
          { native: "hover", apply: { effect: { opacity: 0.84 } } },
          { native: "active", apply: { transform: { scale: 0.98 } } },
          { native: "disabled", apply: { effect: { opacity: 0.5 }, interaction: { cursor: "default" } } },
        ],
        motion: { change: { effect: tokens.motion.quick, transform: tokens.motion.quick } },
      },
      Label: { text: { wrap: "nowrap" } },
    }),
    CounterPanel: () => ({
      Root: {
        layout: { kind: "grid", columns: [{ minmax: [0, { fraction: 1 }] }, "content"], align: "center" },
        padding: tokens.space.lg,
        surface: { fill: tokens.color.panel },
        stroke: { width: 1, line: "solid", color: tokens.color.border },
        shape: { radius: tokens.radius.md },
        effect: { shadow: tokens.shadow.panel },
        when: [{ container: "compact", apply: { layout: { kind: "stack", gap: tokens.space.lg, align: "stretch" } } }],
      },
      Copy: { layout: { kind: "stack", gap: tokens.space.sm } },
      Meta: { margin: 0, surface: { text: tokens.color.muted }, text: { size: 13, weight: 620, line: 1.2 } },
      Value: { margin: 0, text: { size: 44, weight: 720, line: 1 } },
      Actions: { layout: { kind: "row", align: "center", gap: tokens.space.sm } },
    }),
  }),
} satisfies Preset<App, "system">;
`,
    "src/ui/root.tsx": `import { createAppShell, createButton, createCounterPanel, createHeader, useCounter } from "@poggers/app";

export function Root() {
  const counter = useCounter({ id: "main" });
  const Shell = createAppShell();
  const Header = createHeader();
  const Panel = createCounterPanel({
    input: { get value() { return String(counter.count); } },
  });
  const Reset = createButton({
    input: { label: "Reset", disabled: false, activate() { void counter.reset(); } },
    variants: { tone: "neutral" },
  });
  const Increment = createButton({
    input: { label: "Add one", disabled: false, activate() { void counter.increment(); } },
    variants: { tone: "primary" },
  });

  return () => (
    <Shell.Root>
      <Shell.Content>
        <Header.Root>
          <Header.Eyebrow>Poggers app</Header.Eyebrow>
          <Header.Title>${displayName}</Header.Title>
          <Header.Summary>Typed application behavior and a compiled visual preset, with no backend styling API in application code.</Header.Summary>
        </Header.Root>
        <Panel.Root>
          <Panel.Copy>
            <Panel.Meta>Counter</Panel.Meta>
            <Panel.Value />
          </Panel.Copy>
          <Panel.Actions>
            <Reset.Root><Reset.Label /></Reset.Root>
            <Increment.Root><Increment.Label /></Increment.Root>
          </Panel.Actions>
        </Panel.Root>
      </Shell.Content>
    </Shell.Root>
  );
}
`,
    "src/deps.ts": `import type { DependencyConfig } from "@poggers/kit/deps";
import type { ServerDeps } from "types";

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
