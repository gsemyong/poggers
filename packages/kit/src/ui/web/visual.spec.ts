import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StyleXStyles } from "@stylexjs/stylex";

import { analyzeAppContract, analyzeAppContractConventions } from "#ui/compiler/application";
import {
  analyzeVisualContract,
  analyzeVisualPresetSources,
  bundleVisualFontAssets,
  materializeVisualPreset,
  stableVisualJson,
} from "#ui/compiler/preset";
import { generateVisualStylexModule } from "#ui/compiler/stylex";
import {
  createVisualCoordinator,
  createTrackedHoverCoordinator,
  type CompiledVisuals,
  visualConditionMatches,
  visualPartDependencies,
  visualStyleAttributes,
} from "#ui/web/visual-runtime";

const surface = {
  components: {
    Card: {
      parts: { Root: "article", Label: "span", Anchor: "button" },
      input: ["tone"],
      state: [
        { name: "open", kind: "boolean" },
        { name: "tone", kind: "string" },
        { name: "offset", kind: "length" },
        { name: "opacity", kind: "opacity" },
        { name: "stagger", kind: "time" },
      ],
    },
  },
} as const;

const contract = {
  name: "precision",
  tokens: {
    color: ["canvas", "text", "line"],
    font: ["body"],
    radius: ["panel"],
    shadow: ["panel"],
    motion: ["settle"],
    space: ["md"],
  },
  themes: ["default", "dark"],
  containers: [],
  location: { file: "fixture.ts", line: 1, column: 1 },
} as const;

type SymbolicFixtureValue = {
  readonly tokens: SymbolicFixtureValue;
  readonly createRecipe: SymbolicFixtureValue;
  readonly createMotion: SymbolicFixtureValue;
  readonly interpolate: SymbolicFixtureValue;
  readonly environment: SymbolicFixtureValue;
  readonly geometry: SymbolicFixtureValue;
  readonly interaction: SymbolicFixtureValue;
  readonly state: SymbolicFixtureValue;
  readonly actions: SymbolicFixtureValue;
  readonly parts: SymbolicFixtureValue;
  readonly color: SymbolicFixtureValue;
  readonly font: SymbolicFixtureValue;
  readonly radius: SymbolicFixtureValue;
  readonly shadow: SymbolicFixtureValue;
  readonly motion: SymbolicFixtureValue;
  readonly space: SymbolicFixtureValue;
  readonly size: SymbolicFixtureValue;
  readonly canvas: SymbolicFixtureValue;
  readonly text: SymbolicFixtureValue;
  readonly line: SymbolicFixtureValue;
  readonly body: SymbolicFixtureValue;
  readonly panel: SymbolicFixtureValue;
  readonly settle: SymbolicFixtureValue;
  readonly md: SymbolicFixtureValue;
  readonly compact: SymbolicFixtureValue;
  readonly dark: SymbolicFixtureValue;
  readonly inlineSize: SymbolicFixtureValue;
  readonly isBelow: SymbolicFixtureValue;
  readonly isAbove: SymbolicFixtureValue;
  readonly and: SymbolicFixtureValue;
  readonly or: SymbolicFixtureValue;
  readonly not: SymbolicFixtureValue;
  readonly matches: SymbolicFixtureValue;
  readonly reducedMotion: SymbolicFixtureValue;
  readonly open: SymbolicFixtureValue;
  readonly tone: SymbolicFixtureValue;
  readonly offset: SymbolicFixtureValue;
  readonly opacity: SymbolicFixtureValue;
  readonly selected: SymbolicFixtureValue;
  readonly hovered: SymbolicFixtureValue;
  readonly disabled: SymbolicFixtureValue;
  readonly Anchor: SymbolicFixtureValue;
  readonly startDragging: SymbolicFixtureValue;
  readonly releaseDragging: SymbolicFixtureValue;
  readonly cancelDragging: SymbolicFixtureValue;
  readonly [name: string]: SymbolicFixtureValue;
  (...args: readonly unknown[]): SymbolicFixtureValue;
};

type SymbolicFixtureScope = SymbolicFixtureValue;

function fixtureTheme() {
  return {
    color: {
      canvas: { l: 0.98, c: 0.006, h: 260 },
      text: { l: 0.18, c: 0.01, h: 260 },
      line: { token: "text" },
    },
    font: { body: { fallback: ["system-ui", "sans-serif"] } },
    radius: { panel: { kind: "radius", value: 12 } },
    shadow: {
      panel: {
        y: 16,
        blur: 40,
        spread: -16,
        color: { l: 0.1, c: 0.01, h: 260, alpha: 0.24 },
      },
    },
    motion: { settle: { spring: { duration: 420, bounce: 0.1 } } },
    space: { md: { kind: "space", value: 12 } },
  };
}

type FixtureTheme = ReturnType<typeof fixtureTheme>;

type FixtureOptions = {
  readonly theme?: FixtureTheme;
  readonly themes?: unknown;
  readonly root?: (scope: SymbolicFixtureScope, tokens: SymbolicFixtureValue) => unknown;
  readonly label?: (scope: SymbolicFixtureScope, tokens: SymbolicFixtureValue) => unknown;
  readonly anchor?: (scope: SymbolicFixtureScope, tokens: SymbolicFixtureValue) => unknown;
  readonly extraComponents?: Record<string, unknown>;
};

function fixture(options: FixtureOptions = {}) {
  return ({ tokens }: SymbolicFixtureScope) => ({
    theme: options.theme ?? fixtureTheme(),
    themes:
      options.themes ??
      ({
        dark: {
          color: {
            canvas: { l: 0.14, c: 0.008, h: 260 },
            text: { l: 0.96, c: 0.004, h: 260 },
          },
        },
      } as const),
    components: {
      Card(scope: SymbolicFixtureScope) {
        const { environment, geometry, interaction, state } = scope;
        const shared = {
          layout: { padding: tokens.space.md },
          paint: { fill: tokens.color.canvas },
          motion: { transition: { opacity: tokens.motion.settle } },
        };
        const root = options.root?.(scope, tokens) ?? [
          shared,
          {
            layout: {
              grid: {
                columns: [{ minmax: [120, { fraction: 1 }] }],
                gap: tokens.space.md,
              },
              size: { inline: { max: 640 }, contain: "layout" },
              margin: { block: 12 },
              position: {
                kind: "absolute",
                anchor: { part: "Anchor" },
                place: "block-end",
                inset: { inline: 8, blockEnd: 4 },
              },
              scroll: {
                block: "auto",
                overscroll: "contain",
                scrollbar: "thin",
              },
            },
            paint: {
              fill: tokens.color.canvas,
              stroke: {
                width: 2,
                line: "solid",
                color: tokens.color.line,
                alignment: "center",
              },
              opacity: state.opacity,
              cursor: "pointer",
              focusRing: { color: tokens.color.line, width: 2, offset: 2 },
            },
            typography: {
              color: tokens.color.text,
              font: tokens.font.body,
              size: 14,
              line: 1.4,
              wrap: "pretty",
            },
            shape: {
              corners: { radius: tokens.radius.panel, continuity: 0.8 },
              clip: "content",
            },
            motion: { translation: { block: state.offset } },
            decorations: {
              backdrop: { paint: { fill: "transparent" } },
              background: {
                layout: { size: { inline: 4, block: 4 } },
                paint: { fill: tokens.color.text },
              },
            },
          },
          { when: state.open, paint: { opacity: 1 } },
          { when: environment.dark, paint: { shadow: tokens.shadow.panel } },
          {
            when: interaction.selected,
            typography: { color: tokens.color.text },
          },
          { when: interaction.hovered, motion: { translation: { block: -2 } } },
          {
            when: geometry.inlineSize.isBelow(560),
            layout: {
              flow: { axis: "block" },
              position: {
                kind: "fixed",
                anchor: "none",
                place: "auto",
                inset: { inline: 10, blockEnd: 10 },
              },
            },
          },
          {
            when: environment.reducedMotion,
            motion: { translation: { block: 0 } },
          },
          {
            when: state.open.and(
              interaction.disabled.not(),
              environment.dark.or(geometry.inlineSize.isBelow(560)),
            ),
            paint: { opacity: 0.92 },
          },
          { when: state.open.not(), paint: { opacity: 0.94 } },
        ];
        const label = options.label?.(scope, tokens) ?? [
          shared,
          {
            layout: {
              item: {
                flex: { grow: 1, shrink: 1, basis: "content" },
                overlay: true,
              },
            },
            paint: {
              media: { fit: "cover", position: { inline: 0.5, block: 0.5 } },
            },
          },
        ];
        return {
          Root: root,
          Label: label,
          Anchor: options.anchor?.(scope, tokens) ?? {},
        };
      },
      ...options.extraComponents,
    },
  });
}

function materialize(
  source: unknown = fixture(),
  targetSurface: Parameters<typeof materializeVisualPreset>[2] = surface,
  targetContract: Parameters<typeof materializeVisualPreset>[3] = contract,
) {
  return materializeVisualPreset("precision", source, targetSurface, targetContract);
}

describe("visual preset materialization", () => {
  it("preserves StyleX custom-property casing for reactive values", () => {
    const attributes = visualStyleAttributes([
      {
        "borderRadius-kaIpWk": "x7yrpt8",
        $$css: true,
      },
      { "--x-borderRadius": "10px" },
    ] as unknown as StyleXStyles);

    expect(attributes.style).toEqual({ "--x-borderRadius": "10px" });
  });

  it("analyzes the app contract through the TypeScript AST", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-visual-contract-"));
    const sourceDir = join(directory, "src");
    await mkdir(sourceDir, { recursive: true });
    const path = join(sourceDir, "app.tsx");
    await writeFile(
      path,
      `type PresetNames = "precision" | "tactile";
export type App = {
  Resources: {};
  Components: {
    Card: {
      Input: { tone: "plain" | "muted" };
      State: { offset: VisualValue<"length">; opacity: VisualValue<"opacity"> };
      Parts: { Root: "article"; Label: "span" };
    };
  };
  Styles: {
    Presets: {
      precision: {
        Tokens: { color: "canvas" | "text"; motion: "settle" };
        Themes: "default" | "dark";
        Containers: "compact";
      };
      tactile: {
        Tokens: { color: "surface"; motion: "physical" };
        Themes: "default";
        Containers: PresetNames;
      };
    };
  };
};
`,
      "utf8",
    );

    const analysis = analyzeVisualContract(path);
    expect(analysis.surface.components.Card).toEqual({
      actions: [],
      parameters: [],
      parts: { Root: "article", Label: "span" },
      state: [
        { name: "offset", kind: "length", writable: false },
        { name: "opacity", kind: "opacity", writable: false },
      ],
    });
    expect(analysis.presets.map(({ name }) => name)).toEqual(["precision", "tactile"]);
    expect(analysis.presets[0]?.tokens.color).toEqual(["canvas", "text"]);
    expect(analysis.presets[0]?.themes).toEqual(["default", "dark"]);
    expect(analysis.presets[0]?.containers).toEqual(["compact"]);
    expect(analysis.presets[0]?.location.file).toBe(path);

    const presetDir = join(sourceDir, "presets");
    await mkdir(presetDir, { recursive: true });
    const presetPath = join(presetDir, "precision.ts");
    const appPath = join(sourceDir, "location-app.tsx");
    await writeFile(
      presetPath,
      `export const precisionPreset = { tokens: {}, components: {} };\n`,
      "utf8",
    );
    await writeFile(
      appPath,
      `import { precisionPreset } from "src/presets/precision";
export default { styles: { presets: { precision: precisionPreset } } } satisfies object;
`,
      "utf8",
    );
    const locations = analyzeVisualPresetSources(appPath, sourceDir);
    expect(locations.precision?.file).toBe(presetPath);
    expect(locations.precision?.line).toBe(1);
  });

  it("analyzes and materializes recursively owned Feature components", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-feature-visual-contract-"));
    const sourceDir = join(directory, "src");
    const featuresDir = join(sourceDir, "features");
    await mkdir(featuresDir, { recursive: true });
    const path = join(sourceDir, "app.tsx");
    await writeFile(
      join(featuresDir, "notifications.tsx"),
      `export type NotificationsFeature = {
  Components: { Bell: { State: { unread: number }; Parts: { Root: "button" } } };
  Features: {
    preferences: {
      Components: { Toggle: { Parts: { Root: "button"; Label: "span" } } };
    };
  };
};
`,
      "utf8",
    );
    await writeFile(
      path,
      `import type { NotificationsFeature } from "src/features/notifications";

export type App = {
  Resources: {};
  Components: { Shell: { Parts: { Root: "main" } } };
  Features: { notifications: NotificationsFeature };
  Styles: { Presets: "studio" };
};
`,
      "utf8",
    );

    const analysis = analyzeVisualContract(path);
    expect(Object.keys(analysis.surface.components)).toEqual([
      "Shell",
      "@feature/notifications/component/Bell",
      "@feature/notifications.preferences/component/Toggle",
    ]);
    expect(analysis.surface.components["@feature/notifications/component/Bell"]?.state).toEqual([
      { name: "unread", kind: "number", writable: false },
    ]);

    const preset = materializeVisualPreset(
      "studio",
      () => ({
        theme: {},
        components: { Shell: () => ({ Root: {} }) },
        features: {
          notifications: {
            components: { Bell: () => ({ Root: {} }) },
            features: {
              preferences: {
                components: { Toggle: () => ({ Root: {}, Label: {} }) },
              },
            },
          },
        },
      }),
      analysis.surface,
      analysis.presets[0],
    );
    expect(Object.keys(preset.components)).toEqual([
      "@feature/notifications.preferences/component/Toggle",
      "@feature/notifications/component/Bell",
      "Shell",
    ]);

    const missing = () => ({
      theme: {},
      components: { Shell: () => ({ Root: {} }) },
      features: { notifications: { components: {} } },
    });
    expect(() =>
      materializeVisualPreset("studio", missing, analysis.surface, analysis.presets[0]),
    ).toThrow('missing component "@feature/notifications/component/Bell"');

    const unknown = () => ({
      theme: {},
      components: { Shell: () => ({ Root: {} }) },
      features: {
        notifications: {
          components: { Bell: () => ({ Root: {} }), Legacy: () => ({ Root: {} }) },
          features: {
            preferences: {
              components: { Toggle: () => ({ Root: {}, Label: {} }) },
            },
          },
        },
      },
    });
    expect(() =>
      materializeVisualPreset("studio", unknown, analysis.surface, analysis.presets[0]),
    ).toThrow('unknown component "@feature/notifications/component/Legacy"');

    const duplicate = () => ({
      theme: {},
      components: {
        Shell: () => ({ Root: {} }),
        "@feature/notifications/component/Bell": () => ({ Root: {} }),
      },
      features: {
        notifications: {
          components: { Bell: () => ({ Root: {} }) },
          features: {
            preferences: {
              components: { Toggle: () => ({ Root: {}, Label: {} }) },
            },
          },
        },
      },
    });
    expect(() =>
      materializeVisualPreset("studio", duplicate, analysis.surface, analysis.presets[0]),
    ).toThrow(/owned by both application and features\.notifications/);
  });

  it("bundles typed font assets and emits deterministic faces and preload intent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-font-assets-"));
    const presetSource = join(directory, "preset.ts");
    const fontPath = join(directory, "body.woff2");
    await writeFile(presetSource, "export {};\n", "utf8");
    await writeFile(fontPath, new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
    const basePreset = fixture();
    const materialized = materialize((factoryContract: SymbolicFixtureScope) => ({
      ...basePreset(factoryContract),
      theme: {
        ...fixtureTheme(),
        font: {
          body: {
            sources: [
              {
                file: "./body.woff2",
                format: "woff2",
                weight: [400, 700],
                preload: true,
              },
            ],
            fallback: ["system-ui", "sans-serif"],
            display: "swap",
          },
        },
      },
    }));
    const bundled = await bundleVisualFontAssets(materialized, presetSource);
    const source = (
      bundled.assets.fonts.body as {
        sources: readonly { file: string }[];
      }
    ).sources[0]?.file;
    expect(source).toBe("data:font/woff2;base64,d09GMg==");

    const generated = generateVisualStylexModule([bundled]);
    expect(generated).toContain("@font-face");
    expect(generated).toContain("poggers-precision-body");
    expect(generated).toContain("font-weight:400 700");
    expect(generated).toContain("compiledFontPreloads");
    expect(generated).not.toContain("Inter");

    const fallbackOnly = materialize((factoryContract: SymbolicFixtureScope) => ({
      ...basePreset(factoryContract),
      theme: {
        ...fixtureTheme(),
        font: { body: { fallback: ["system-ui", "sans-serif"] } },
      },
    }));
    const bundledFallback = await bundleVisualFontAssets(fallbackOnly, presetSource);
    expect(generateVisualStylexModule([bundledFallback])).not.toContain("@font-face");

    const missingSource = materialize((factoryContract: SymbolicFixtureScope) => ({
      ...basePreset(factoryContract),
      theme: {
        ...fixtureTheme(),
        font: {
          body: {
            sources: [{ file: "./missing.woff2", format: "woff2", weight: 400, preload: true }],
            fallback: ["system-ui", "sans-serif"],
          },
        },
      },
    }));
    await expect(bundleVisualFontAssets(missingSource, presetSource)).rejects.toThrow(
      "precision.theme.font.body.sources[0] cannot read",
    );

    expect(() =>
      materialize(() => ({
        theme: { ...fixtureTheme(), font: { body: {} } },
        components: { Card: () => ({ Root: {}, Label: {}, Anchor: {} }) },
      })),
    ).toThrow("precision.theme.font.body.fallback requires at least one family");
  });

  it("rejects legacy and non-verb component action contracts before runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-component-contract-"));
    const path = join(directory, "types.ts");
    await writeFile(
      path,
      `export type App = {
  Resources: {};
  Components: {
    Drawer: {
      Data: { open: boolean };
      Actions: { "drag.start"(): void };
      Parts: { Root: "div" };
    };
  };
};
`,
      "utf8",
    );

    const issues = analyzeAppContractConventions(path, analyzeAppContract(path));
    expect(issues.map((issue) => issue.message)).toEqual([
      "component Drawer declares unsupported member Data.",
      "component Drawer action drag.start must be a camelCase verb name.",
    ]);
  });

  it("evaluates compile-time scopes into deterministic serializable data", () => {
    const first = materialize();
    const second = materialize();

    expect(stableVisualJson(first)).toBe(stableVisualJson(second));
    const root = first.components.Card?.Root as { use: Record<string, unknown>[] };
    expect(root.use[0]).toMatchObject({
      layout: {
        padding: { $visual: "token", group: "space", name: "md" },
      },
      paint: {
        fill: { $visual: "token", group: "color", name: "canvas" },
      },
    });
    expect(root.use[1]).toMatchObject({
      paint: {
        opacity: {
          $visual: "expression",
          source: "value",
          component: "Card",
          kind: "opacity",
          name: "opacity",
        },
      },
      layout: { position: { anchor: { part: "Anchor" }, kind: "absolute" } },
      motion: {
        translation: {
          block: {
            $visual: "expression",
            source: "value",
            component: "Card",
            kind: "length",
            name: "offset",
          },
        },
      },
    });
    expect(first.components.Card?.Anchor).toEqual({});
  });

  it("routes typed component state into reactive preset conditions", () => {
    const preset = materialize(
      fixture({
        root: ({ state }, tokens) => [
          {
            layout: { padding: tokens.space.md },
            shape: { corners: { radius: tokens.radius.panel } },
            paint: {
              fill: tokens.color.canvas,
              stroke: { width: 1, color: tokens.color.line },
              shadow: tokens.shadow.panel,
            },
            typography: { color: tokens.color.text, font: tokens.font.body },
            motion: { transition: { opacity: tokens.motion.settle } },
          },
          { when: state.open, paint: { opacity: 1 } },
        ],
      }),
    );
    const generated = generateVisualStylexModule([preset]);
    expect(generated).toContain('"name":"open","source":"value"');
    expect(
      visualConditionMatches(
        { all: [{ state: "open" }] },
        { theme: "default", states: { open: true }, values: {} },
      ),
    ).toBe(true);
    expect(
      visualConditionMatches(
        { all: [{ state: "open" }] },
        { theme: "default", states: { open: false }, values: {} },
      ),
    ).toBe(false);
    expect(() =>
      materialize(
        fixture({
          root: ({ state }) => ({ when: state.missing, paint: { opacity: 1 } }),
        }),
      ),
    ).toThrow("contains undefined");
  });

  it("keeps normalized IR and generated identifiers stable across object key order", () => {
    const forward = materialize(
      fixture({
        root: ({ state }, tokens) => ({
          layout: { size: { inline: { max: 640 } }, padding: tokens.space.md },
          shape: { radius: tokens.radius.panel },
          paint: {
            fill: tokens.color.canvas,
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            opacity: state.opacity,
            shadow: tokens.shadow.panel,
          },
          typography: { color: tokens.color.text, font: tokens.font.body },
          motion: {
            translation: { block: state.offset },
            transition: { transform: tokens.motion.settle },
          },
        }),
      }),
    );
    const reversed = materialize(
      fixture({
        root: ({ state }, tokens) => ({
          motion: {
            transition: { transform: tokens.motion.settle },
            translation: { block: state.offset },
          },
          typography: { font: tokens.font.body, color: tokens.color.text },
          paint: {
            shadow: tokens.shadow.panel,
            opacity: state.opacity,
            stroke: { color: tokens.color.line, line: "solid", width: 1 },
            fill: tokens.color.canvas,
          },
          shape: { radius: tokens.radius.panel },
          layout: { padding: tokens.space.md, size: { inline: { max: 640 } } },
        }),
      }),
    );

    expect(stableVisualJson(forward)).toBe(stableVisualJson(reversed));
    expect(generateVisualStylexModule([forward])).toBe(generateVisualStylexModule([reversed]));
  });

  it("evaluates preset factories, recipes, and symbolic component scopes as plain IR", () => {
    const contract = {
      name: "precision",
      tokens: {
        color: ["canvas", "text"],
        radius: ["panel"],
        size: ["compact"],
        motion: ["settle"],
      },
      themes: ["default", "dark"],
      containers: [],
      location: { file: "fixture.ts", line: 1, column: 1 },
    } as const;
    const preset = materializeVisualPreset(
      "precision",
      ({ tokens, createRecipe, createMotion, interpolate }: SymbolicFixtureScope) => {
        const card = createRecipe({
          base: {
            paint: { fill: tokens.color.canvas },
            typography: { color: tokens.color.text },
            shape: {
              corners: { radius: tokens.radius.panel, continuity: 0.8 },
            },
          },
          variants: {
            tone: {
              plain: { paint: { opacity: 1 } },
              muted: { paint: { opacity: 0.7 } },
            },
            compact: {
              true: { layout: { size: { inline: tokens.size.compact } } },
              false: {},
            },
          },
          combinations: [
            {
              when: { tone: "muted", compact: true },
              use: { motion: { scale: 0.98 } },
            },
          ],
          defaults: { compact: false },
        });
        return {
          theme: {
            color: {
              canvas: { l: 0.98, c: 0.006, h: 260 },
              text: { l: 0.18, c: 0.01, h: 260 },
            },
            radius: { panel: { kind: "radius", value: 16 } },
            size: { compact: { kind: "size", value: 560 } },
            motion: { settle: { spring: { duration: 280, bounce: 0 } } },
          },
          themes: {
            dark: { color: { canvas: { l: 0.14, c: 0.008, h: 260 } } },
          },
          components: {
            Card({ interaction, geometry, state }: SymbolicFixtureScope) {
              const sheet = createMotion({
                target: state.offset,
                transition: tokens.motion.settle,
                range: [0, 700],
              });
              return {
                Root: [
                  card({
                    tone: state.tone,
                    compact: geometry.inlineSize.isBelow(tokens.size.compact),
                  }),
                  {
                    when: interaction.hovered,
                    motion: {
                      translation: { block: sheet },
                      scale: interpolate(state.opacity, [0, 1], [0.98, 1]),
                    },
                  },
                ],
                Label: {
                  when: state.opacity.isAbove(0.5),
                  paint: {
                    opacity: interpolate(sheet.progress, [0, 1], [1, 0]),
                  },
                },
                Anchor: {},
              };
            },
          },
        };
      },
      surface,
      contract,
    );

    expect(preset.tokens.color?.canvas).toEqual({ l: 0.98, c: 0.006, h: 260 });
    expect(preset.containers).toEqual({});
    expect(preset.components.Card?.Root).toMatchObject({
      use: [
        {
          $visual: "recipe",
          id: "recipe-0",
          values: {
            compact: {
              $visual: "expression",
              operation: "below",
            },
            tone: {
              $visual: "expression",
              component: "Card",
              name: "tone",
              source: "value",
            },
          },
        },
        {
          when: {
            $visual: "expression",
            source: "interaction",
            name: "hovered",
          },
          motion: {
            translation: {
              block: {
                $visual: "expression",
                source: "motion",
                name: "motion-0",
                operation: "motion",
              },
            },
            scale: {
              $visual: "expression",
              operation: "interpolate",
              kind: "number",
            },
          },
        },
      ],
    });
    expect(preset.components.Card?.Label).toMatchObject({
      paint: {
        opacity: {
          $visual: "expression",
          operation: "interpolate",
          value: {
            $visual: "expression",
            operation: "motion-progress",
            motion: { source: "motion", name: "motion-0", operation: "motion" },
          },
        },
      },
    });
    expect(() => stableVisualJson(preset)).not.toThrow();
    const generated = generateVisualStylexModule([preset]);
    expect(generated).toContain("@container (inline-size < 560px)");
    expect(generated).toContain('[data-hovered=\\"true\\"]');
    expect(generated).toContain('"operation":"above"');
    expect(generated).toContain('"expression"');
  });

  it("materializes complete preset parameters and validates interaction routes", () => {
    const interactionSurface = {
      components: {
        Card: {
          ...surface.components.Card,
          state: surface.components.Card.state.map((value) => ({
            ...value,
            writable: value.name === "offset" || value.name === "opacity",
          })),
          actions: ["startDragging", "releaseDragging", "cancelDragging"],
          parameters: ["dismissDistance"],
        },
      },
    };
    const source = ({ tokens }: SymbolicFixtureScope) => ({
      theme: fixtureTheme(),
      components: {
        Card({ state, actions, parts }: SymbolicFixtureScope) {
          return {
            parameters: { dismissDistance: 0.35 },
            interactions: [
              {
                type: "drag",
                trigger: parts.Anchor,
                axis: "block",
                bounds: { block: [0, state.offset] },
                output: {
                  block: state.offset,
                  progressBlock: state.opacity,
                },
                start: actions.startDragging,
                release: actions.releaseDragging,
                cancel: actions.cancelDragging,
              },
            ],
            Root: { paint: { fill: tokens.color.canvas } },
            Label: {},
            Anchor: {},
          };
        },
      },
    });

    const preset = materializeVisualPreset("precision", source, interactionSurface, contract);
    expect(preset.parameters.Card).toEqual({ dismissDistance: 0.35 });
    expect(preset.interactions.Card?.[0]).toMatchObject({
      type: "drag",
      trigger: { $visual: "part", name: "Anchor" },
      release: { $visual: "event", name: "releaseDragging" },
      output: { block: { source: "value", name: "offset" } },
    });

    expect(() =>
      materializeVisualPreset(
        "precision",
        ({ tokens }: SymbolicFixtureScope) => ({
          theme: fixtureTheme(),
          components: {
            Card: () => ({
              Root: { paint: { fill: tokens.color.canvas } },
              Label: {},
              Anchor: {},
            }),
          },
        }),
        interactionSurface,
        contract,
      ),
    ).toThrow('precision.Card.parameters is missing "dismissDistance"');

    expect(() =>
      materializeVisualPreset(
        "precision",
        ({ tokens }: SymbolicFixtureScope) => ({
          theme: fixtureTheme(),
          components: {
            Card: () => ({
              parameters: { dismissDistance: 0.35, legacyThreshold: 12 },
              Root: { paint: { fill: tokens.color.canvas } },
              Label: {},
              Anchor: {},
            }),
          },
        }),
        interactionSurface,
        contract,
      ),
    ).toThrow('precision.Card.parameters contains unknown parameter "legacyThreshold"');

    expect(() =>
      materializeVisualPreset(
        "precision",
        ({ tokens }: SymbolicFixtureScope) => ({
          theme: fixtureTheme(),
          components: {
            Card({ state, parts }: SymbolicFixtureScope) {
              return {
                parameters: { dismissDistance: 0.35 },
                interactions: [
                  {
                    type: "drag",
                    trigger: parts.Anchor,
                    axis: "block",
                    bounds: { block: [0, state.offset] },
                    output: { block: state.tone },
                    release: { $visual: "event", name: "missing" },
                  },
                ],
                Root: { paint: { fill: tokens.color.canvas } },
                Label: {},
                Anchor: {},
              };
            },
          },
        }),
        interactionSurface,
        contract,
      ),
    ).toThrow(/requires writable State|unknown Action/);
  });

  it("replaces an active preset interaction exactly once and routes cancellation", () => {
    const runtime = globalThis as unknown as { Element?: unknown; HTMLElement?: unknown };
    const previousElement = runtime.Element;
    const previousHTMLElement = runtime.HTMLElement;
    class InteractionElement {
      isConnected = true;
    }
    runtime.Element = InteractionElement;
    runtime.HTMLElement = InteractionElement;
    const terminals: string[] = [];
    const sessions: Array<{ begin(): void; disposeCount: number }> = [];
    const compiled = Object.fromEntries(
      ["family", "studio"].map((name, index) => [
        name,
        {
          themes: { default: null },
          motion: {},
          themeMotion: {},
          components: { Drawer: {} },
          parameters: { Drawer: { dismissDistance: index ? 0.4 : 0.25 } },
          interactions: {
            Drawer: [
              {
                type: "drag",
                trigger: { $visual: "part", name: "Handle" },
                axis: "block",
                bounds: { block: [0, 100] },
                output: {},
                start: { $visual: "event", name: "startDragging" },
                release: { $visual: "event", name: "releaseDragging" },
                cancel: { $visual: "event", name: "cancelDragging" },
              },
            ],
          },
        },
      ]),
    ) as unknown as CompiledVisuals;
    try {
      const trigger = new InteractionElement() as unknown as HTMLElement;
      const coordinator = createVisualCoordinator({
        compiled,
        component: "Drawer",
        refs: { Handle: trigger },
        actions: {
          startDragging: () => terminals.push("start"),
          releaseDragging: () => terminals.push("release"),
          cancelDragging: () => terminals.push("cancel"),
        },
        mountDrag(_element, options) {
          let active = false;
          const session = {
            disposeCount: 0,
            begin() {
              active = true;
              options.start?.();
            },
          };
          sessions.push(session);
          return () => {
            session.disposeCount++;
            if (!active) return;
            active = false;
            options.cancel?.();
          };
        },
      });
      const snapshot = (preset: string) => ({
        preset,
        theme: "default",
        states: {},
        values: {},
      });
      coordinator.update(snapshot("family"));
      coordinator.update(snapshot("family"));
      expect(sessions).toHaveLength(1);
      sessions[0]!.begin();
      coordinator.update(snapshot("studio"));
      expect(sessions).toHaveLength(2);
      expect(sessions[0]!.disposeCount).toBe(1);
      expect(terminals).toEqual(["start", "cancel"]);
      coordinator.dispose();
      coordinator.dispose();
      expect(sessions[1]!.disposeCount).toBe(1);
    } finally {
      runtime.Element = previousElement;
      runtime.HTMLElement = previousHTMLElement;
    }
  });

  it("tracks hover when layout moves beneath a stationary pointer", () => {
    const runtime = globalThis as unknown as {
      HTMLElement?: unknown;
      ShadowRoot?: unknown;
    };
    const previousHTMLElement = runtime.HTMLElement;
    const previousShadowRoot = runtime.ShadowRoot;
    class HoverElement {
      parentElement: HoverElement | null = null;
      readonly attributes = new Map<string, string>();
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }
      removeAttribute(name: string) {
        this.attributes.delete(name);
      }
      getRootNode() {
        return {};
      }
    }
    class HoverShadowRoot {}
    runtime.HTMLElement = HoverElement;
    runtime.ShadowRoot = HoverShadowRoot;
    type HoverTestEvent = { pointerType?: string; clientX?: number; clientY?: number };
    const listeners = new Map<string, (event: HoverTestEvent) => void>();
    const frames: FrameRequestCallback[] = [];
    let hit: HoverElement | null = null;
    const document = {
      defaultView: undefined,
      documentElement: {},
      elementFromPoint: () => hit,
      addEventListener: (name: string, listener: (event: HoverTestEvent) => void) => {
        listeners.set(name, listener);
      },
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Document;
    const coordinator = createTrackedHoverCoordinator(
      document,
      (callback) => {
        frames.push(callback);
        return frames.length;
      },
      () => {},
    );
    const first = new HoverElement();
    const second = new HoverElement();
    const releaseFirst = coordinator.register(first as unknown as HTMLElement);
    coordinator.register(second as unknown as HTMLElement);
    hit = first;
    listeners.get("pointermove")?.({
      pointerType: "mouse",
      clientX: 20,
      clientY: 30,
    });
    frames.shift()?.(0);
    expect(first.attributes.get("data-hovered")).toBe("true");

    hit = second;
    listeners.get("scroll")?.({});
    frames.shift()?.(1);
    expect(first.attributes.has("data-hovered")).toBe(false);
    expect(second.attributes.get("data-hovered")).toBe("true");

    listeners.get("pointermove")?.({
      pointerType: "touch",
      clientX: 20,
      clientY: 30,
    });
    frames.shift()?.(2);
    expect(second.attributes.has("data-hovered")).toBe(false);
    releaseFirst();
    coordinator.dispose();
    runtime.HTMLElement = previousHTMLElement;
    runtime.ShadowRoot = previousShadowRoot;
  });

  it("records exact runtime dependencies and evaluates dynamic predicates", () => {
    const expression = {
      $visual: "expression",
      kind: "boolean",
      operation: "above",
      left: {
        $visual: "expression",
        source: "value",
        name: "count",
        kind: "number",
      },
      right: 0,
    };
    const compiled = {
      system: {
        themes: { default: null },
        motion: {},
        themeMotion: {},
        components: {
          Card: {
            Root: {
              always: [
                {
                  style: {},
                  values: [
                    {
                      name: "expression0",
                      kind: "number",
                      expression: {
                        $visual: "expression",
                        source: "geometry",
                        name: "inlineSize",
                      },
                    },
                  ],
                },
              ],
              conditions: [
                {
                  when: { all: [{ expression }] },
                  entry: { style: {}, values: [] },
                },
              ],
              motion: null,
            },
          },
        },
      },
    } as unknown as CompiledVisuals;
    expect([...visualPartDependencies(compiled, "system", "Card", "Root")].sort()).toEqual([
      "geometry.inlineSize",
      "value.count",
    ]);
    const context = {
      theme: "default",
      values: { count: 1 },
      geometry: { inlineSize: 420 },
    };
    expect(visualConditionMatches({ all: [{ expression }] }, context)).toBe(true);
    expect(
      visualConditionMatches({ all: [{ expression }] }, { ...context, values: { count: 0 } }),
    ).toBe(false);
  });

  it("compiles recipe branches linearly instead of enumerating variant products", () => {
    const variantNames = Array.from({ length: 12 }, (_, index) => `v${index}`);
    const preset = materializeVisualPreset(
      "precision",
      ({ createRecipe }: SymbolicFixtureScope) => {
        const card = createRecipe({
          variants: Object.fromEntries(
            variantNames.map((name) => [
              name,
              {
                true: { paint: { opacity: 1 } },
                false: { paint: { opacity: 0.8 } },
              },
            ]),
          ),
        });
        return {
          theme: {},
          components: {
            Card({ geometry }: SymbolicFixtureScope) {
              return {
                Root: card(
                  Object.fromEntries(
                    variantNames.map((name, index) => [
                      name,
                      geometry.inlineSize.isAbove(index + 1),
                    ]),
                  ),
                ),
                Label: {},
                Anchor: {},
              };
            },
          },
        };
      },
      surface,
      {
        name: "precision",
        tokens: {},
        themes: ["default"],
        containers: [],
        location: { file: "fixture.ts", line: 1, column: 1 },
      },
    );

    const generated = generateVisualStylexModule([preset]);
    const branches = new Set(generated.match(/Root_when_\d+_\d+/g) ?? []);
    expect(branches.size).toBe(variantNames.length * 2);
    expect(generated.length).toBeLessThan(60_000);
  });

  it("generates a module accepted by the official StyleX compiler", async () => {
    const preset = materialize();
    const source = generateVisualStylexModule([preset]);
    const directory = await mkdtemp(join(tmpdir(), "poggers-visual-stylex-"));
    const entrypoint = join(directory, "visual.generated.stylex.ts");
    const cssOutput = join(directory, "visual.css");
    await writeFile(entrypoint, source, "utf8");

    const { createStylexBunPlugin } = await import("@stylexjs/unplugin/bun");
    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir: join(directory, "out"),
      target: "browser",
      plugins: [
        createStylexBunPlugin({
          dev: false,
          runtimeInjection: false,
          useCSSLayers: true,
          bunDevCssOutput: cssOutput,
        }) as Bun.BunPlugin,
      ],
    });

    if (!result.success) {
      throw new Error(result.logs.map((log) => log.message).join("\n"));
    }
    const css = await readFile(cssOutput, "utf8");
    expect(css).toContain("@property");
    expect(css).toContain("oklch(");
    expect(css).toContain("corner-shape:");
    expect(css).toContain("outline-width:");
    expect(css).toContain("@container");
    expect(css).toContain("position-try-fallbacks: flip-block");
    expect(css).toContain("position-try-order: most-block-size");
    expect(css).toContain("::backdrop");
    expect(css).toContain('[aria-selected="true"]');
    expect(css).toContain(":not(:disabled)");
    expect(source).toContain("stylex.create");
    expect(source).toContain('"not":true');
    expect(source).toContain('"marginBlock": "12px"');
    expect(source).toContain('"insetInlineStart": "8px"');
    expect(source).toContain('"insetInlineEnd": "8px"');
    expect(source).toContain('"insetBlockEnd": "4px"');
    expect(source).toContain('"insetBlockStart": "auto"');
    expect(source).toContain('"transitionProperty": "opacity"');
    expect(source).toContain('"layout":{"columns"');
    expect(source).toContain('"$visual":"token","group":"space","name":"md"');
    expect(source).not.toContain('"transitionProperty": "background-color');
    expect(source).not.toContain("linear(");
  });

  it("keeps retained motion metadata out of generated CSS transitions", () => {
    const preset = materialize(
      fixture({
        root: ({ state }, tokens) => ({
          paint: {
            fill: tokens.color.canvas,
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            shadow: tokens.shadow.panel,
          },
          typography: { color: tokens.color.text, font: tokens.font.body },
          shape: { corners: { radius: tokens.radius.panel } },
          motion: {
            translation: { block: state.offset },
            transition: { transform: tokens.motion.settle },
          },
        }),
      }),
    );
    const source = generateVisualStylexModule([preset]);
    const rootStyle = source.match(/"Root_base": \{[^\n]+/)?.[0];

    expect(rootStyle).toBeDefined();
    expect(rootStyle).not.toContain("transitionProperty");
    expect(source).toContain('"target":{"block":{"$visual":"expression","component":"Card"');
    expect(source).toContain('"transition":{"transform":{"$visual":"token"');
  });

  it("lowers the six semantic visual algebras into backend IR", () => {
    const preset = materialize(
      fixture({
        root: ({ state }, tokens) => ({
          layout: {
            flow: { axis: "block", gap: tokens.space.md },
            size: { inline: { max: 640 } },
            padding: tokens.space.md,
            position: { kind: "relative" },
          },
          shape: { corners: { radius: tokens.radius.panel, continuity: 0.8 } },
          paint: {
            fill: tokens.color.canvas,
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            shadow: tokens.shadow.panel,
            opacity: state.opacity,
          },
          typography: {
            color: tokens.color.text,
            font: tokens.font.body,
            size: 14,
          },
          motion: {
            translation: { block: state.offset },
            scale: 1,
            presence: {
              enter: { from: { opacity: 0, scale: 0.98 } },
              exit: { to: { opacity: 0, scale: 0.98 } },
              layout: "pop",
            },
            transition: { transform: tokens.motion.settle },
          },
          decorations: {
            background: {
              layout: { position: { kind: "absolute", inset: 0 } },
              paint: { fill: tokens.color.canvas },
            },
          },
        }),
      }),
    );
    const source = generateVisualStylexModule([preset]);

    expect(source).toContain('"display": "flex"');
    expect(source).toContain('"flexDirection": "column"');
    expect(source).toContain('"backgroundColor"');
    expect(source).toContain('"::before"');
    expect(source).toContain('"enterFrom":{"opacity":0,"scale":0.98}');
    expect(source).toContain('"exitTo":{"opacity":0,"scale":0.98}');
    expect(source).toContain('"target":{"block":{"$visual":"expression"');
  });

  it("rejects the removed static preset representation", () => {
    expect(() =>
      materializeVisualPreset("precision", { tokens: {}, components: {} }, surface),
    ).toThrow("must be a preset factory");
  });

  it("rejects unknown components and parts from factories", () => {
    expect(
      materialize(({ tokens }: SymbolicFixtureScope) => ({
        theme: fixtureTheme(),
        components: {
          Card: () => ({ Root: { paint: { fill: tokens.color.canvas } } }),
        },
      })).components.Card?.Root,
    ).toEqual({
      paint: { fill: { $visual: "token", group: "color", name: "canvas" } },
    });

    expect(() =>
      materialize(fixture({ extraComponents: { Unknown: () => ({ Root: {} }) } })),
    ).toThrow('unknown component "Unknown"');
    expect(() =>
      materialize(({ tokens }: SymbolicFixtureScope) => ({
        theme: fixtureTheme(),
        components: {
          Card: () => ({
            Root: { paint: { fill: tokens.color.canvas } },
            Unknown: {},
          }),
        },
      })),
    ).toThrow('unknown part "Unknown"');
  });

  it("rejects unknown nested visual fields and motion intents", () => {
    const motionFactory =
      (definition: Record<string, unknown>) =>
      ({ createMotion }: SymbolicFixtureScope) => {
        return {
          theme: fixtureTheme(),
          components: {
            Card() {
              createMotion(definition);
              return {};
            },
          },
        };
      };
    expect(() => materialize(motionFactory({ target: 0, transition: {}, range: [0, 0] }))).toThrow(
      "range must contain two distinct finite numbers",
    );
    expect(() =>
      materialize(motionFactory({ target: 0, transition: {}, range: [0, 1], raw: true })),
    ).toThrow("received unknown field raw");

    const unknownPaint = fixture({
      root: () => ({ paint: { opacity: 1, mystery: true } }),
    });
    expect(() => generateVisualStylexModule([materialize(unknownPaint)])).toThrow(
      'paint contains unknown field "mystery"',
    );

    const removedField = fixture({ root: () => ({ effect: { opacity: 1 } }) });
    expect(() => generateVisualStylexModule([materialize(removedField)])).toThrow(
      "uses removed visual fields effect",
    );

    const unknownMotion = fixture({
      root: (_scope, tokens) => ({
        paint: { opacity: 1 },
        motion: { sequence: [{ using: tokens.motion.settle }] },
      }),
    });
    expect(() => generateVisualStylexModule([materialize(unknownMotion)])).toThrow(
      'motion contains unknown field "sequence"',
    );
  });

  it("rejects non-compositor transition declarations", () => {
    const paintAnimation = fixture({
      root: (_scope, tokens) => ({
        motion: { transition: { surface: tokens.motion.settle } },
      }),
    });
    expect(() => generateVisualStylexModule([materialize(paintAnimation)])).toThrow(
      'transition contains unknown field "surface"',
    );
  });

  it("rejects token-kind mismatches and out-of-range visual domains", () => {
    const dimension = fixture({
      root: (_scope, tokens) => ({ layout: { padding: tokens.radius.panel } }),
    });
    expect(() => generateVisualStylexModule([materialize(dimension)])).toThrow(
      "requires a space token, received radius.panel",
    );

    const measure = fixture({
      root: (_scope, tokens) => ({
        layout: { size: { inline: tokens.space.md } },
      }),
    });
    expect(() => generateVisualStylexModule([materialize(measure)])).toThrow(
      "requires a size token, received space.md",
    );

    const colorTheme = fixtureTheme();
    colorTheme.color.canvas.l = 1.2;
    expect(() => generateVisualStylexModule([materialize(fixture({ theme: colorTheme }))])).toThrow(
      "precision.tokens.color.canvas.l must be between 0 and 1",
    );

    const motionTheme = fixtureTheme();
    motionTheme.motion.settle.spring.bounce = 0.8;
    expect(() =>
      generateVisualStylexModule([materialize(fixture({ theme: motionTheme }))]),
    ).toThrow("bounce must be between -0.5 and 0.5");

    const mixedSpringTheme = fixtureTheme();
    Object.assign(mixedSpringTheme.motion.settle.spring, {
      stiffness: 900,
      damping: 60,
    });
    expect(() =>
      generateVisualStylexModule([materialize(fixture({ theme: mixedSpringTheme }))]),
    ).toThrow("cannot mix perceptual duration/bounce with physical spring parameters");

    const cubicTheme = fixtureTheme();
    cubicTheme.motion.settle = {
      duration: 200,
      easing: { cubic: [1.2, 0.84, 0.44, 1] },
    } as unknown as typeof cubicTheme.motion.settle;
    expect(() => generateVisualStylexModule([materialize(fixture({ theme: cubicTheme }))])).toThrow(
      "easing.cubic[0] must be between 0 and 1",
    );

    const opacity = fixture({ root: () => ({ paint: { opacity: 2 } }) });
    expect(() => generateVisualStylexModule([materialize(opacity)])).toThrow(
      "opacity must be between 0 and 1",
    );

    const lineHeight = fixture({ root: () => ({ typography: { line: 24 } }) });
    expect(() => generateVisualStylexModule([materialize(lineHeight)])).toThrow(
      "use a size token for an absolute line height",
    );
  });

  it("rejects runtime functions, non-finite numbers, class instances, and cycles", () => {
    expect(() => materialize(fixture({ root: () => ({ paint: { opacity: () => 1 } }) }))).toThrow(
      "runtime function",
    );

    const nonFinite = fixtureTheme();
    nonFinite.space.md.value = Number.POSITIVE_INFINITY;
    expect(() => materialize(fixture({ theme: nonFinite }))).toThrow("non-finite number");

    expect(() => materialize(fixture({ themes: { dark: new Map() } }))).toThrow(
      "plain objects and arrays",
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => materialize(fixture({ themes: circular }))).toThrow("circular reference");
  });
});
