import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const publicPackages = ["kit"] as const;

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

test("browser builds exclude server-only modules", () => {
  const fixture = mkdtempSync(join(tmpdir(), "poggers-browser-graph-"));
  try {
    const chatOutput = join(fixture, "chat");
    run(
      "bun",
      [
        join(root, "packages/kit/src/tooling/cli.ts"),
        "bundle",
        join(root, "apps/chat"),
        "--outdir",
        chatOutput,
      ],
      root,
    );
    const chatBundle = readFileSync(join(chatOutput, "browser.entry.js"), "utf8");
    expect(chatBundle).toContain('"@feature/chat/component/Composer"');
    expect(chatBundle).toContain('"@feature/chat/component/ChatLayout"');
    expect(chatBundle).not.toMatch(
      /node:fs|node:crypto|deepseek|streamText|\bzod\b|cel-js|not a valid CEL|parseCel/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 15_000);

test("the published kit installs, typechecks, executes, and scaffolds independently", () => {
  const fixture = mkdtempSync(join(tmpdir(), "poggers-distribution-"));
  const packed = join(fixture, "packed");
  const consumer = join(fixture, "consumer");
  const scaffold = join(fixture, "scaffold");
  mkdirSync(packed);
  mkdirSync(consumer);

  try {
    for (const packageName of publicPackages) {
      run("bun", ["pm", "pack", "--destination", packed], join(root, "packages", packageName));
    }
    const archives = readdirSync(packed).filter((name) => name.endsWith(".tgz"));
    expect(archives).toHaveLength(1);

    for (const archive of archives) {
      const listing = run("tar", ["-tzf", join(packed, archive)], fixture);
      expect(listing).not.toMatch(/(?:\.spec|\.typecheck)\.d\.ts$/m);
      expect(listing).not.toMatch(/(?:\.spec|\.typecheck)\.tsx?$/m);
      expect(listing).toContain("package/src/tooling/cli.ts");
      expect(listing).toContain("package/src/index.ts");
      const destination = join(fixture, basename(archive, ".tgz"));
      mkdirSync(destination);
      run("tar", ["-xzf", join(packed, archive), "-C", destination], fixture);
      const declarations = readdirSync(join(destination, "package", "dist"), {
        recursive: true,
      }).filter((name): name is string => typeof name === "string" && name.endsWith(".d.ts"));
      const declarationText = declarations
        .map((name) => readFileSync(join(destination, "package", "dist", name), "utf8"))
        .join("\n");
      expect(declarationText).not.toMatch(/\/Users\//);
    }

    const archive = (name: string) =>
      `file:${join(packed, archives.find((value) => value.startsWith(`poggers-${name}-`)) ?? "")}`;
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "poggers-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@poggers/kit": archive("kit"),
        },
      }),
    );
    writeFileSync(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          lib: ["ES2022", "DOM"],
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "bundler",
          verbatimModuleSyntax: true,
          strict: true,
          noEmit: true,
        },
        include: ["index.ts"],
      }),
    );
    writeFileSync(
      join(consumer, "index.ts"),
      `import type { AppDef, Submission, FeatureDef } from "@poggers/kit";
import { defineApp, testFeature } from "@poggers/kit/testing";
import { createPress } from "@poggers/kit/ui";
import type { PresetsDefinition } from "@poggers/kit/preset";

type CounterFeature = {
  Resources: {
    counters: {
      Key: string;
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: { increment: { Input: { by: number }; Event: "incremented" } };
    };
  };
  Components: {};
  API: {
    counter(id: string): {
      readonly count: number;
      increment(input: { by: number }): Submission;
    };
  };
};

type ConsumerApp = {
  Actor: { id: string };
  Resources: {};
  Features: { primary: CounterFeature; secondary: CounterFeature };
  API: { total(id: string): number };
};

const counter = {
  resources: {
    counters: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: { count: ({ state }) => state.count },
      commands: {
        increment(context, { by }) {
          context.event.incremented({ by });
        },
      },
    },
  },
  features: {},
  api: ({ resources }) => ({
    counter(id) {
      const resource = resources.counters(id);
      return {
        get count() {
          return resource.count;
        },
        increment: resource.increment,
      };
    },
  }),
  components: {},
} satisfies FeatureDef<ConsumerApp, CounterFeature>;

const app = defineApp<ConsumerApp>({
  version: 1,
  resources: {},
  features: { primary: counter, secondary: counter },
  api: ({ features }) => ({
    total: (id) => features.primary.counter(id).count + features.secondary.counter(id).count,
  }),
});

type PublicSurface =
  | AppDef<{ Resources: Record<string, never> }>
  | PresetsDefinition<{ Resources: Record<string, never>; Styles: { Presets: string } }>;
void (null as unknown as PublicSurface);
if (typeof createPress !== "function") throw new Error("Packed runtime import failed.");

const fixture = await testFeature(app, "primary", { actor: { id: "consumer" } });
const mounted = fixture.api.counter("packed");
const receipt = await mounted.increment({ by: 3 });
if (!receipt.ok || mounted.count !== 3) throw new Error("Packed Feature execution failed.");
await fixture.dispose();
`,
    );

    run("bun", ["install"], consumer);
    run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);
    run("bun", ["run", "index.ts"], consumer);

    run(
      "bun",
      [
        join(root, "packages/kit/src/tooling/cli.ts"),
        "create",
        scaffold,
        "--no-install",
        "--kit-version",
        archive("kit"),
      ],
      root,
    );
    run("bun", ["install"], scaffold);
    run("bun", ["run", "fmt"], scaffold);
    run("bun", ["run", "check"], scaffold);
    run("bun", ["run", "build"], scaffold);
    expect(readFileSync(join(scaffold, "tsconfig.json"), "utf8")).toContain(
      '"extends": "@poggers/kit/tsconfig"',
    );
    expect(readFileSync(join(scaffold, "src/app.tsx"), "utf8")).toContain(
      "satisfies AppDefinition<App>",
    );
    expect(readFileSync(join(scaffold, "src/features/counter.tsx"), "utf8")).toContain(
      "satisfies FeatureDef<App, CounterFeature>",
    );
    expect(existsSync(join(scaffold, "src/types.ts"))).toBe(false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 60_000);
