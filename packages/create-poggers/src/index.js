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
  if (entries.length > 0) {
    fail(`Directory ${targetDir} is not empty. Pass --force to write into it.`);
  }
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

  if (!install.success) {
    fail("bun install failed.");
  }
}

const relativeDir = args.projectName ?? ".";
console.log(`Created ${appName} in ${targetDir}`);
console.log("");
if (relativeDir !== ".") console.log(`  cd ${relativeDir}`);
if (!args.install) console.log("  bun install");
console.log("  bun dev");
console.log("");
console.log("Build a single executable with:");
console.log("  bun run build");

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const name = value.slice(2);
    if (name === "no-install") {
      flags.set("install", false);
      continue;
    }
    if (name === "install") {
      flags.set("install", true);
      continue;
    }
    if (name === "force") {
      flags.set("force", true);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) fail(`Missing value for --${name}.`);
    flags.set(name, next);
    i += 1;
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
          check: "bun run typecheck && bun run lint",
          typecheck: "poggers typecheck",
        },
        dependencies: {
          "@poggers/kit": kitVersion,
        },
        devDependencies: {
          "@types/bun": "latest",
          typescript: "7.0.1-rc",
        },
      },
      null,
      2,
    )}
`,
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "@poggers/kit/tsconfig",
      },
      null,
      2,
    )}
`,
    ".gitignore": `node_modules
.app
dist
.DS_Store
`,
    "src/types.ts": `export type CounterState = {
  count: number;
};

export type CounterEvents = {
  incremented: { by: number };
  reset: {};
};

export type CounterViews = {
  count: number;
};

export type CounterCommands = {
  increment: {
    args: [by?: number];
    event: "incremented";
    error: never;
  };
  reset: {
    args: [];
    event: "reset";
    error: never;
  };
};

export type ServerDeps = {
  clock: {
    now(): number;
  };
};

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

  Environments: {
    server: {
      Deps: ServerDeps;
    };
  };

  Navigation: {
    home: {};
    settings: {};
  };

  Components: {
    AppShell: {
      Parts: {
        Root: "main";
      };
    };
    Header: {
      Parts: {
        Root: "header";
        Text: "div";
        Eyebrow: "p";
        Title: "h1";
        Actions: "div";
      };
    };
    Button: {
      Input: {
        tone: "neutral" | "primary";
        disabled: boolean;
        label: string;
      };
      Actions: {
        press(): void;
      };
      Parts: {
        Root: "button";
        Label: "span";
      };
    };
    Panel: {
      Input: {
        tone: "neutral" | "raised";
      };
      Derived: {
        value: string;
      };
      Parts: {
        Root: "section";
        Body: "div";
        Meta: "p";
        Value: "h2";
        Actions: "div";
      };
    };
  };

  Styles: {
    Presets: "system" | "dense";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
        roundness: { min: 0; max: 1; default: 0.6 };
      };
    };
  };
};
`,
    "src/app.tsx": `import { defineApp } from "@poggers/kit";
import { Root } from "./components/root";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,

  app: {
    name: ${JSON.stringify(displayName)},
  },

  pwa: {
    name: ${JSON.stringify(displayName)},
    shortName: ${JSON.stringify(displayName)},
    themeColor: "#111827",
    backgroundColor: "#f8fafc",
    display: "standalone",
  },

  navigation: {
    home: "/",
    settings: "/settings",
  },

  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
        reset({ state }) {
          state.count = 0;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {
        increment(ctx, by = 1) {
          return ctx.event.incremented({ by });
        },
        reset(ctx) {
          return ctx.event.reset({});
        },
      },
    },
  },

  components: {
    Button({ input, actions }) {
      return {
        Root: {
          type: "button",
          disabled: input.disabled,
          onClick: actions.press,
        },
        Label: {
          children: input.label,
        },
      };
    },
    Panel({ derived }) {
      return {
        Value: {
          children: derived.value,
        },
      };
    },
  },

  ui() {
    return <Root />;
  },
});
`,
    "src/styles.ts": `import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  defaultPreset: "system",
  presets: {
    system: {
      AppShell: {
        Root: {
          minHeight: "100dvh",
          maxWidth: 760,
          margin: "0 auto",
          padding: "28px 20px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#f7f8fb",
          color: "#16181d",
        },
      },
      Header: {
        Root: {
          layout: { display: "flex", gap: 16 },
          marginBottom: 20,
        },
        Text: {
          flex: "1 1 auto",
        },
        Eyebrow: {
          margin: "0 0 4px",
          color: "#69707d",
          fontSize: 13,
        },
        Title: {
          margin: 0,
          fontSize: 28,
          lineHeight: 1.05,
        },
        Actions: {
          display: "flex",
          alignItems: "center",
          gap: 8,
        },
      },
      Button: {
        Root: {
          layout: { kind: "inlineCenter", gap: 8 },
          surface: { background: "#ffffff", color: "#16181d", border: "1px solid #d8dde7" },
          shape: { radius: 8 },
          size: { minHeight: 40, padding: "0 14px" },
          typography: { size: 14, weight: 650, lineHeight: 1 },
          motion: { pressable: true },
        },
        Label: {
          display: "inline-flex",
          whiteSpace: "nowrap",
        },
      },
      Panel: {
        Root: {
          surface: { background: "#ffffff", border: "1px solid #d8dde7", shadow: "0 8px 30px rgb(18 24 38 / 0.08)" },
          shape: { radius: 8 },
          padding: 18,
        },
        Body: {
          display: "grid",
          alignItems: "center",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 16,
        },
        Meta: {
          margin: "0 0 6px",
          color: "#69707d",
          fontSize: 13,
        },
        Value: {
          margin: 0,
          fontSize: 36,
          lineHeight: 1,
        },
        Actions: {
          display: "flex",
          gap: 8,
        },
      },
    },
    dense: {
      AppShell: {
        Root: {
          padding: "18px 16px",
        },
      },
      Button: {
        Root: {
          size: { minHeight: 32, padding: "0 10px" },
          typography: { size: 13, weight: 650, lineHeight: 1 },
        },
      },
      Panel: {
        Root: {
          padding: 12,
        },
      },
    },
  },
});
`,
    "src/components/root.tsx": `import { useScreen } from "@poggers/app";
import { AppShell } from "./app-shell";
import { HomeScreen } from "./home-screen";
import { SettingsScreen } from "./settings-screen";

export function Root() {
  return (
    <AppShell>
      {() => (useScreen().name === "settings" ? <SettingsScreen /> : <HomeScreen />)}
    </AppShell>
  );
}
`,
    "src/components/button.tsx": `import { createButton } from "@poggers/app";

type ButtonProps = {
  label: string;
  action: () => void;
  tone?: "primary" | "neutral";
  disabled?: boolean;
};

export function Button({ label, action, tone = "neutral", disabled = false }: ButtonProps) {
  const Button = createButton({
    input: { tone, disabled, label },
    actions() {
      return {
        press: action,
      };
    },
  });

  return (
    <Button.Root>
      <Button.Label />
    </Button.Root>
  );
}
`,
    "src/components/app-shell.tsx": `import { createAppShell } from "@poggers/app";
import type { Child } from "@poggers/kit/ui";

export function AppShell({ children }: { children?: Child }) {
  const Shell = createAppShell();

  return <Shell.Root>{children}</Shell.Root>;
}
`,
    "src/components/transition.tsx": `import type { Child } from "@poggers/kit/ui";

export function Transition({ children }: { children?: Child }) {
  return <>{children}</>;
}
`,
    "src/components/counter-panel.tsx": `import { createPanel, useCounter } from "@poggers/app";
import { Button } from "./button";

export function CounterPanel() {
  const counter = useCounter({ id: "main" });
  const Panel = createPanel({
    input: { tone: "raised" },
    derived() {
      return {
        get value() {
          return String(counter.count);
        },
      };
    },
  });

  return (
    <Panel.Root>
      <Panel.Body>
        <div>
          <Panel.Meta>Counter</Panel.Meta>
          <Panel.Value />
        </div>
        <Panel.Actions>
          <Button label="Reset" action={() => void counter.reset()} />
          <Button label="Add" tone="primary" action={() => void counter.increment()} />
        </Panel.Actions>
      </Panel.Body>
    </Panel.Root>
  );
}
`,
    "src/components/home-screen.tsx": `import { createHeader, nav } from "@poggers/app";
import { Button } from "./button";
import { CounterPanel } from "./counter-panel";
import { Transition } from "./transition";

export function HomeScreen() {
  const Header = createHeader();

  return (
    <Transition>
      <Header.Root>
        <Header.Text>
          <Header.Eyebrow>Poggers app</Header.Eyebrow>
          <Header.Title>Home</Header.Title>
        </Header.Text>
        <Header.Actions>
          <Button label="Settings" action={() => nav.settings()} />
        </Header.Actions>
      </Header.Root>
      <CounterPanel />
    </Transition>
  );
}
`,
    "src/components/settings-screen.tsx": `import { createButton, createHeader, createPanel, nav, setPreset } from "@poggers/app";
import { Button } from "./button";
import { Transition } from "./transition";

export function SettingsScreen() {
  const Header = createHeader();
  const Panel = createPanel({
    input: { tone: "neutral" },
    derived() {
      return {
        value: "",
      };
    },
  });
  const ToggleDensity = createButton({
    input: { tone: "neutral", disabled: false, label: "Toggle density" },
    actions(ctx) {
      return {
        press() {
          setPreset(ctx.preset === "dense" ? "system" : "dense");
        },
      };
    },
  });

  return (
    <Transition>
      <Header.Root>
        <Header.Text>
          <Header.Eyebrow>Application</Header.Eyebrow>
          <Header.Title>Settings</Header.Title>
        </Header.Text>
        <Header.Actions>
          <Button label="Home" action={() => nav.home()} />
        </Header.Actions>
      </Header.Root>
      <Panel.Root>
        <Panel.Body>
          <span>This app follows the strict Poggers structure.</span>
          <ToggleDensity.Root>
            <ToggleDensity.Label />
          </ToggleDensity.Root>
        </Panel.Body>
      </Panel.Root>
    </Transition>
  );
}
`,
    "deps.ts": `import type { ServerDeps } from "./src/types";

export function createServerDeps(): ServerDeps {
  return {
    clock: {
      now: () => Date.now(),
    },
  };
}
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
