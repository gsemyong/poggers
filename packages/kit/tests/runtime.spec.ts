import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { bundleApp, checkAppConventions, runApp, writeAppTypes } from "../src/runtime";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("Poggers app virtual modules", () => {
  it("starts a cold app whose component imports @poggers/app", async () => {
    await mkdir(resolve("apps"), { recursive: true });
    const appDir = await mkdtemp(resolve("apps/runtime-dev-"));
    createdDirs.push(appDir);
    await mkdir(join(appDir, "src/components"), { recursive: true });

    await writeFile(
      join(appDir, "package.json"),
      JSON.stringify(
        {
          name: "@poggers/runtime-dev-test",
          private: true,
          type: "module",
          dependencies: {
            "@poggers/kit": "workspace:*",
          },
        },
        null,
        2,
      ),
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
    );
    await writeFile(
      join(appDir, "src/types.ts"),
      `export type App = {
  Resources: {
    /** Counter resource used by the generated useCounter hook. */
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: {
        increment: { args: []; event: "incremented"; error: never };
      };
    };
  };
  Components: {
    /** Primary counter button component. */
    Button: {
      Parts: {
        Root: "button";
      };
    };
  };
};
`,
    );
    await writeFile(
      join(appDir, "src/styles.ts"),
      `import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  presets: {
    system: {
      Button: {
        Root: {
          padding: "8px 12px",
        },
      },
    },
  },
});
`,
    );
    await writeFile(
      join(appDir, "src/components/root.tsx"),
      `import { createButton, useCounter } from "@poggers/app";

export function Root() {
  const counter = useCounter({ id: "main" });
  const Button = createButton();
  return <Button.Root onClick={() => void counter.increment()}>{counter.count}</Button.Root>;
}
`,
    );
    await writeFile(
      join(appDir, "src/app.tsx"),
      `import { defineApp } from "@poggers/kit";
import { Root } from "./components/root";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {
        increment(ctx) {
          return ctx.event.incremented({ by: 1 });
        },
      },
    },
  },
  ui() {
    return <Root />;
  },
});
`,
    );

    const handle = await runApp({ appDir, port: 0 });
    try {
      expect(handle.url.port).not.toBe("0");
      const index = await fetch(handle.url);
      expect(index.ok).toBe(true);
      const html = await index.text();
      expect(html).toContain("/client.js");
      expect(html).toContain("/__poggers/live");
      const entry = await readFile(join(appDir, ".app/dev/browser.entry.tsx"), "utf8");
      expect(entry).toContain("import.meta.hot.accept()");
      expect(entry).toContain("import.meta.hot.data");
      expect(entry).toContain("__poggersHotData");
      expect(entry).toContain('window.addEventListener("poggers:render"');
      const appModule = await readFile(join(appDir, "src/poggers-app.d.ts"), "utf8");
      expect(appModule).toContain('import type { App as AppSpec } from "./types.ts"');
      expect(appModule).not.toContain('import app from "./app.tsx"');
      expect(appModule).not.toContain('import styles from "./styles.ts"');
      expect(appModule).not.toContain("import.meta.hot");
      expect(appModule).toContain("/** Counter resource used by the generated useCounter hook. */");
      expect(appModule).toContain("/** Primary counter button component. */");
      expect(appModule).toContain("export type CounterResourceKey");
      expect(appModule).toContain("export function useCounter(key: CounterResourceKey)");
      expect(appModule).toContain("export type ButtonInstance");
      expect(appModule).toContain("export function createButton(input?: ButtonOptions)");
      expect(appModule).not.toContain("Parameters<AppHooks");
      expect(appModule).not.toContain("ReturnType<AppHooks");
      const nested = await fetch(new URL("/nested/screen", handle.url), {
        headers: { Accept: "text/html" },
      });
      expect(await nested.text()).toContain('<div id="root"></div>');
      const ws = await fetch(new URL("/ws", handle.url));
      expect(ws.status).toBe(500);
      expect(await ws.text()).toBe("upgrade failed");
    } finally {
      handle.stop();
    }
  });

  it("bundles an app that imports direct generated functions from @poggers/app", async () => {
    await mkdir(resolve(".app"), { recursive: true });
    const appDir = await mkdtemp(resolve(".app/runtime-"));
    createdDirs.push(appDir);
    await mkdir(join(appDir, "src/components"), { recursive: true });

    await writeFile(
      join(appDir, "src/types.ts"),
      `export type App = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: {
        increment: { args: [by?: number]; event: "incremented"; error: never };
      };
    };
  };
  Components: {
    Button: {
      Input: { tone: "neutral" | "primary"; disabled: boolean };
      Parts: { Root: "button"; Label: "span" };
    };
  };
  Styles: {
    Presets: "system" | "dense";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
      };
    };
  };
};
`,
    );

    await writeFile(
      join(appDir, "src/styles.ts"),
      `import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  defaultPreset: "system",
  presets: {
    system: {
      Button: {
        Root: {
          layout: { kind: "inlineCenter", gap: 6 },
          surface: { background: "#111827", color: "white", border: "1px solid #111827" },
          shape: { radius: 8 },
          size: { minHeight: 40, padding: "0 14px" },
          motion: { pressable: true },
        },
        Label: {
          typography: { size: 14, weight: 650, lineHeight: 1.1 },
        },
      },
    },
    dense: {
      Button: {
        Root: {
          size: { minHeight: 32, padding: "0 10px" },
        },
      },
    },
  },
});
`,
    );

    await writeFile(
      join(appDir, "src/components/root.tsx"),
      `import { createButton, useCounter } from "@poggers/app";

export function Root() {
  const counter = useCounter({ id: "main" });
  const Button = createButton({
    input: { tone: "primary", disabled: false },
  });

  return (
    <Button.Root onClick={() => void counter.increment()}>
      <Button.Label>{counter.count}</Button.Label>
    </Button.Root>
  );
}
`,
    );

    await writeFile(
      join(appDir, "src/app.tsx"),
      `import { defineApp } from "@poggers/kit";
import { Root } from "./components/root";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
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
    );

    const typeFile = await writeAppTypes(appDir);
    expect(typeFile).toEndWith("src/poggers-app.d.ts");
    expect(await readFile(typeFile!, "utf8")).toContain("export function useCounter");
    expect(await readFile(typeFile!, "utf8")).toContain("export function createButton");

    const outdir = join(appDir, "dist");
    await bundleApp({ appDir, outdir, minify: false });

    const css = await readFile(join(outdir, "browser.entry.css"), "utf8");
    expect(css).toContain("body {");
    expect(css).toContain("margin: 0;");
    expect(css).toContain(".pg-button__root");
    expect(css).toContain('data-pg-component="Button"');
  });

  it("flags raw component styling in strict style apps", async () => {
    await mkdir(resolve(".app"), { recursive: true });
    const appDir = await mkdtemp(resolve(".app/runtime-lint-"));
    createdDirs.push(appDir);
    await mkdir(join(appDir, "src/components"), { recursive: true });

    await writeFile(
      join(appDir, "src/types.ts"),
      "export type App = { Resources: {}; Components: {}; Styles: {} };\n",
    );
    await writeFile(
      join(appDir, "src/styles.ts"),
      "export default { def: { presets: { system: {} } } };\n",
    );
    await writeFile(
      join(appDir, "src/app.tsx"),
      `import { defineApp } from "@poggers/kit";
import type { App } from "./types";
export default defineApp<App>({ version: 1, resources: {} });
`,
    );
    await writeFile(
      join(appDir, "src/components/bad.tsx"),
      `export function Bad() {
  return <div className="raw" />;
}
`,
    );

    expect(checkAppConventions(appDir)).toEqual([
      {
        file: join(appDir, "src/components/bad.tsx"),
        message:
          "components must not use class/className in strict style apps; render generated component parts.",
      },
    ]);
  });

  it("flags nested or non-kebab component module names", async () => {
    await mkdir(resolve(".app"), { recursive: true });
    const appDir = await mkdtemp(resolve(".app/runtime-lint-"));
    createdDirs.push(appDir);
    await mkdir(join(appDir, "src/components/screens"), { recursive: true });

    await writeFile(
      join(appDir, "src/types.ts"),
      "export type App = { Resources: {}; Components: {}; Styles: {} };\n",
    );
    await writeFile(
      join(appDir, "src/styles.ts"),
      "export default { def: { presets: { system: {} } } };\n",
    );
    await writeFile(
      join(appDir, "src/app.tsx"),
      `import { defineApp } from "@poggers/kit";
import type { App } from "./types";
export default defineApp<App>({ version: 1, resources: {} });
`,
    );
    await writeFile(
      join(appDir, "src/components/screens/HomeScreen.tsx"),
      "export function HomeScreen() { return null; }\n",
    );

    const issues = checkAppConventions(appDir);
    expect(issues).toContainEqual({
      file: join(appDir, "src/components/screens/HomeScreen.tsx"),
      message: "component file names must be kebab-case.",
    });
    expect(issues).toContainEqual({
      file: join(appDir, "src/components/screens/HomeScreen.tsx"),
      message:
        "component files must live directly in src/components; do not nest component folders.",
    });
  });
});
