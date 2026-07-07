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
          typegen: "poggers typegen",
          check: "poggers check",
          typecheck: "poggers typegen && tsc --noEmit",
        },
        dependencies: {
          "@poggers/kit": kitVersion,
        },
        devDependencies: {
          "@types/bun": "latest",
          typescript: "latest",
        },
      },
      null,
      2,
    )}
`,
    "tsconfig.json": `${JSON.stringify(
      {
        extends: "@poggers/kit/tsconfig/app",
        compilerOptions: {
          baseUrl: ".",
        },
        include: ["src/**/*.ts", "src/**/*.tsx", ".app/types/**/*.ts", ".app/types/**/*.tsx"],
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
import { Root } from "./components/Root";
import { createDeps } from "./helpers/deps/createDeps";
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

  deps: {
    server: createDeps,
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
    Button({ input }) {
      return {
        Root: {
          type: "button",
          disabled: input.disabled,
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
    "src/components/Root.tsx": `import { useScreen } from "@poggers/app";
import { AppShell } from "./layout/AppShell";
import { HomeScreen } from "./screens/HomeScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

export function Root() {
  return (
    <AppShell>
      {() => (useScreen().name === "settings" ? <SettingsScreen /> : <HomeScreen />)}
    </AppShell>
  );
}
`,
    "src/components/primitives/Button.tsx": `import { createButton } from "@poggers/app";
import type { Child } from "@poggers/kit/ui";

type ButtonProps = {
  children?: Child;
  onClick?: () => void;
  tone?: "primary" | "neutral";
  disabled?: boolean;
};

export function Button({ children, onClick, tone = "neutral", disabled = false }: ButtonProps) {
  const Button = createButton({
    input: { tone, disabled },
  });

  return (
    <Button.Root onClick={onClick}>
      <Button.Label>{children}</Button.Label>
    </Button.Root>
  );
}
`,
    "src/components/layout/AppShell.tsx": `import { createAppShell } from "@poggers/app";
import type { Child } from "@poggers/kit/ui";

export function AppShell({ children }: { children?: Child }) {
  const Shell = createAppShell();

  return <Shell.Root>{children}</Shell.Root>;
}
`,
    "src/components/motion/Transition.tsx": `import type { Child } from "@poggers/kit/ui";

export function Transition({ children }: { children?: Child }) {
  return <>{children}</>;
}
`,
    "src/components/domain/CounterPanel.tsx": `import { createPanel, useCounter } from "@poggers/app";
import { Button } from "../primitives/Button";

export function CounterPanel() {
  const counter = useCounter({ id: "main" });
  const Panel = createPanel({
    input: { tone: "raised" },
  });

  return (
    <Panel.Root>
      <Panel.Body>
        <div>
          <Panel.Meta>Counter</Panel.Meta>
          <Panel.Value>{counter.count}</Panel.Value>
        </div>
        <Panel.Actions>
          <Button onClick={() => void counter.reset()}>Reset</Button>
          <Button tone="primary" onClick={() => void counter.increment()}>
            Add
          </Button>
        </Panel.Actions>
      </Panel.Body>
    </Panel.Root>
  );
}
`,
    "src/components/screens/HomeScreen.tsx": `import { createHeader, nav } from "@poggers/app";
import { CounterPanel } from "../domain/CounterPanel";
import { Button } from "../primitives/Button";
import { Transition } from "../motion/Transition";

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
          <Button onClick={() => nav.settings()}>Settings</Button>
        </Header.Actions>
      </Header.Root>
      <CounterPanel />
    </Transition>
  );
}
`,
    "src/components/screens/SettingsScreen.tsx": `import { createHeader, createPanel, nav, setPreset, usePreset } from "@poggers/app";
import { Button } from "../primitives/Button";
import { Transition } from "../motion/Transition";

export function SettingsScreen() {
  const Header = createHeader();
  const Panel = createPanel({
    input: { tone: "neutral" },
  });

  return (
    <Transition>
      <Header.Root>
        <Header.Text>
          <Header.Eyebrow>Application</Header.Eyebrow>
          <Header.Title>Settings</Header.Title>
        </Header.Text>
        <Header.Actions>
          <Button onClick={() => nav.home()}>Home</Button>
        </Header.Actions>
      </Header.Root>
      <Panel.Root>
        <Panel.Body>
          <span>This app follows the strict Poggers structure.</span>
          <Button onClick={() => setPreset(usePreset() === "dense" ? "system" : "dense")}>
            Toggle density
          </Button>
        </Panel.Body>
      </Panel.Root>
    </Transition>
  );
}
`,
    "src/helpers/deps/createDeps.ts": `import type { ServerDeps } from "../../types";

export function createDeps(): ServerDeps {
  return {
    clock: {
      now: () => Date.now(),
    },
  };
}
`,
    "src/helpers/ids/createId.ts": `export function createId(prefix: string): string {
  return \`\${prefix}-\${crypto.randomUUID()}\`;
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
