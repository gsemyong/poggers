import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  analyzeVisualContract,
  materializeVisualPresentation,
  type VisualCompilerSurface,
  type VisualContractPresentation,
} from "./presentation";

const surface = {
  components: {
    Shell: {
      parts: { Root: "main" },
      state: [],
      process: [{ name: "busy", kind: "boolean" }],
      actions: [],
      parameters: [],
    },
    "@feature/chat/component/Conversation": {
      parts: { Root: "section", Send: "button" },
      state: [],
      actions: [],
      parameters: [],
    },
  },
} satisfies VisualCompilerSurface;

const contract = {
  name: "clean",
  tokens: {},
  themes: [],
  containers: [],
  location: { file: "app.tsx", line: 1, column: 1 },
} satisfies VisualContractPresentation;

type SymbolicComponentScope = {
  readonly state: Readonly<{ phase: { is(value: unknown): unknown } }>;
  readonly actions: Readonly<Record<string, unknown>>;
  readonly parts: Readonly<Record<string, unknown>>;
};

describe("presentation compiler", () => {
  test("preserves callback-valued Component inputs instead of reading them as signals", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-component-input-"));
    const path = resolve(directory, "app.tsx");
    await writeFile(
      path,
      `export type App = {
        Features: { example: {
          Features: { audit: { Programs: { cloud: {
            Runtime: { Name: "server" };
            Requires: { log: { write(value: string): void } };
            Provides: { audit: { record(value: string): void } };
          } } } };
          Programs: {
            browser: {
              Runtime: { Name: "web-main"; Platform: "web" };
              Requires: { navigation: { push(path: string): void } };
              Components: { Example: {
                Input: { activate(): void; label: string };
                Parts: { Root: "button" };
              } };
            };
            worker: {
              Runtime: { Name: "web-service-worker" };
              Requires: { cache: { refresh(): Promise<void> } };
            };
          };
        } };
        Presentations: "clean";
      };`,
    );
    try {
      const analysis = analyzeVisualContract(path);
      expect(
        analysis.surface.components["@feature/example/component/Example"]?.inputCallbacks,
      ).toEqual(["activate"]);
      expect(analysis.uiProgram).toBe("browser");
      expect(analysis.programs).toEqual([
        {
          name: "browser",
          runtime: "web-main",
          requires: ["navigation"],
          provides: [],
          ui: true,
          contributions: [
            {
              feature: "example",
              requires: ["navigation"],
              provides: [],
              ui: true,
            },
          ],
        },
        {
          name: "cloud",
          runtime: "server",
          requires: ["log"],
          provides: ["audit"],
          ui: false,
          contributions: [
            {
              feature: "example.audit",
              requires: ["log"],
              provides: ["audit"],
              ui: false,
            },
          ],
        },
        {
          name: "worker",
          runtime: "web-service-worker",
          requires: ["cache"],
          provides: [],
          ui: false,
          contributions: [
            {
              feature: "example",
              requires: ["cache"],
              provides: [],
              ui: false,
            },
          ],
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("materializes the component namespace shared with structure", () => {
    const presentation = materializeVisualPresentation(
      "clean",
      () => ({
        theme: {},
        components: {
          Shell: ({ process }: { process: { busy: unknown } }) => ({
            Root: { when: process.busy },
          }),
          Chat: {
            Conversation: () => ({ Root: {}, Send: {} }),
          },
        },
      }),
      surface,
      contract,
    );

    expect(Object.keys(presentation.components)).toEqual([
      "@feature/chat/component/Conversation",
      "Shell",
    ]);
    expect(JSON.stringify(presentation.components.Shell)).toContain('"source":"process"');
  });

  test("rejects missing and extra component implementations", () => {
    expect(() =>
      materializeVisualPresentation(
        "clean",
        () => ({ theme: {}, components: { Shell: () => ({ Root: {} }) } }),
        surface,
        contract,
      ),
    ).toThrow("missing component");

    expect(() =>
      materializeVisualPresentation(
        "clean",
        () => ({
          theme: {},
          components: {
            Shell: () => ({ Root: {} }),
            Chat: {
              Conversation: () => ({ Root: {}, Send: {} }),
              Unknown: () => ({ Root: {} }),
            },
          },
        }),
        surface,
        contract,
      ),
    ).toThrow("unknown component");
  });

  test("materializes typed drag actions and semantic motion completion", () => {
    const motionSurface = {
      components: {
        Drawer: {
          parts: { Root: "section", Surface: "div" },
          state: [{ name: "phase", kind: "string" }],
          actions: ["drag", "release", "finishClosing"],
          parameters: [],
        },
      },
    } satisfies VisualCompilerSurface;
    const presentation = materializeVisualPresentation(
      "clean",
      () => ({
        theme: {},
        components: {
          Drawer: ({ state, actions, parts }: SymbolicComponentScope) => ({
            Root: {},
            Surface: {},
            interactions: [
              {
                type: "drag",
                trigger: parts.Surface,
                axis: "block",
                bounds: { block: [0, 640] },
                change: actions.drag,
                release: actions.release,
              },
            ],
            completions: [{ when: state.phase.is("closing"), action: actions.finishClosing }],
          }),
        },
      }),
      motionSurface,
      contract,
    );

    expect(presentation.interactions.Drawer).toEqual([
      expect.objectContaining({ type: "drag", axis: "block" }),
    ]);
    expect(presentation.completions.Drawer).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ name: "finishClosing" }),
      }),
    ]);
  });

  test("rejects incomplete drag and unknown completion actions", () => {
    const motionSurface = {
      components: {
        Drawer: {
          parts: { Surface: "div" },
          state: [{ name: "phase", kind: "string" }],
          actions: ["drag", "release", "finishClosing"],
          parameters: [],
        },
      },
    } satisfies VisualCompilerSurface;
    const reference = (name: string) => ({
      $visual: "event",
      component: "Drawer",
      name,
    });

    expect(() =>
      materializeVisualPresentation(
        "clean",
        () => ({
          theme: {},
          components: {
            Drawer: ({ parts }: SymbolicComponentScope) => ({
              Surface: {},
              interactions: [
                {
                  type: "drag",
                  trigger: parts.Surface,
                  axis: "block",
                  bounds: { block: [0, 640] },
                  release: reference("release"),
                },
              ],
            }),
          },
        }),
        motionSurface,
        contract,
      ),
    ).toThrow("change is required");

    expect(() =>
      materializeVisualPresentation(
        "clean",
        () => ({
          theme: {},
          components: {
            Drawer: ({ state }: SymbolicComponentScope) => ({
              Surface: {},
              completions: [{ when: state.phase.is("closing"), action: reference("unknown") }],
            }),
          },
        }),
        motionSurface,
        contract,
      ),
    ).toThrow('unknown Action "unknown"');
  });
});
