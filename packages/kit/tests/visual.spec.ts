import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeAppContract, analyzeAppContractConventions } from "../src/component-compiler";
import {
  analyzeVisualContract,
  analyzeVisualPresetSources,
  materializeVisualPreset,
  stableVisualJson,
} from "../src/visual-compiler";
import {
  createVisualCoordinator,
  createTrackedHoverCoordinator,
  type CompiledVisuals,
  visualConditionMatches,
  visualPartDependencies,
  visualStyleAttributes,
} from "../src/visual-runtime";
import { generateVisualStylexModule } from "../src/visual-stylex";

const surface = {
  components: {
    Card: {
      parts: { Root: "article", Label: "span", Anchor: "button" },
      input: ["tone"],
      values: [
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

function fixtureTheme(): Record<string, any> {
  return {
    color: {
      canvas: { l: 0.98, c: 0.006, h: 260 },
      text: { l: 0.18, c: 0.01, h: 260 },
      line: { token: "text" },
    },
    font: { body: { families: ["Inter", "Arial"] } },
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

type FixtureOptions = {
  readonly theme?: Record<string, any>;
  readonly themes?: unknown;
  readonly root?: (scope: Record<string, any>, tokens: Record<string, any>) => unknown;
  readonly label?: (scope: Record<string, any>, tokens: Record<string, any>) => unknown;
  readonly anchor?: (scope: Record<string, any>, tokens: Record<string, any>) => unknown;
  readonly extraComponents?: Record<string, unknown>;
};

function fixture(options: FixtureOptions = {}) {
  return ({ tokens }: Record<string, any>) => ({
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
      Card(scope: Record<string, any>) {
        const { environment, geometry, interaction, values } = scope;
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
              opacity: values.opacity,
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
            motion: { translation: { block: values.offset } },
            decorations: {
              backdrop: { paint: { fill: "transparent" } },
              background: {
                layout: { size: { inline: 4, block: 4 } },
                paint: { fill: tokens.color.text },
              },
            },
          },
          { when: values.open, paint: { opacity: 1 } },
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
            when: values.open.and(
              interaction.disabled.not(),
              environment.dark.or(geometry.inlineSize.isBelow(560)),
            ),
            paint: { opacity: 0.92 },
          },
          { when: values.open.not(), paint: { opacity: 0.94 } },
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
    ] as unknown as import("@stylexjs/stylex").StyleXStyles);

    expect(attributes.style).toEqual({ "--x-borderRadius": "10px" });
  });

  it("analyzes the app contract through the TypeScript AST", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-visual-contract-"));
    const path = join(directory, "types.ts");
    await writeFile(
      path,
      `type PresetNames = "precision" | "tactile";
export type App = {
  Resources: {};
  Components: {
    Card: {
      Input: { tone: "plain" | "muted" };
      Values: { offset: VisualValue<"length">; opacity: VisualValue<"opacity"> };
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
      events: [],
      parameters: [],
      parts: { Root: "article", Label: "span" },
      values: [
        { name: "offset", kind: "length", writable: false },
        { name: "opacity", kind: "opacity", writable: false },
      ],
    });
    expect(analysis.presets.map(({ name }) => name)).toEqual(["precision", "tactile"]);
    expect(analysis.presets[0]?.tokens.color).toEqual(["canvas", "text"]);
    expect(analysis.presets[0]?.themes).toEqual(["default", "dark"]);
    expect(analysis.presets[0]?.containers).toEqual(["compact"]);
    expect(analysis.presets[0]?.location.file).toBe(path);

    const presetPath = join(directory, "presets.ts");
    const presetIndexPath = join(directory, "preset-index.ts");
    const appPath = join(directory, "app.ts");
    await writeFile(
      presetPath,
      `export const precisionPreset = { tokens: {}, components: {} };\n`,
      "utf8",
    );
    await writeFile(presetIndexPath, `export { precisionPreset } from "./presets";\n`, "utf8");
    await writeFile(
      appPath,
      `import { precisionPreset } from "src/preset-index";
export default { styles: { presets: { precision: precisionPreset } } } satisfies object;
`,
      "utf8",
    );
    const locations = analyzeVisualPresetSources(appPath, directory);
    expect(locations.precision?.file).toBe(presetPath);
    expect(locations.precision?.line).toBe(1);
  });

  it("rejects legacy and non-verb component event contracts before runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "poggers-component-contract-"));
    const path = join(directory, "types.ts");
    await writeFile(
      path,
      `export type App = {
  Resources: {};
  Components: {
    Drawer: {
      Actions: { open(): void };
      Events: { "drag.start"(): void };
      Parts: { Root: "div" };
    };
  };
};
`,
      "utf8",
    );

    const issues = analyzeAppContractConventions(path, analyzeAppContract(path));
    expect(issues.map((issue) => issue.message)).toEqual([
      "component Drawer declares unsupported member Actions.",
      "component Drawer event drag.start must be a camelCase verb name.",
    ]);
  });

  it("evaluates compile-time scopes into deterministic serializable data", () => {
    const first = materialize();
    const second = materialize();

    expect(stableVisualJson(first)).toBe(stableVisualJson(second));
    const root = first.components.Card?.Root as { use: Record<string, any>[] };
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

  it("keeps normalized IR and generated identifiers stable across object key order", () => {
    const forward = materialize(
      fixture({
        root: ({ values }, tokens) => ({
          layout: { size: { inline: { max: 640 } }, padding: tokens.space.md },
          shape: { radius: tokens.radius.panel },
          paint: {
            fill: tokens.color.canvas,
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            opacity: values.opacity,
            shadow: tokens.shadow.panel,
          },
          typography: { color: tokens.color.text, font: tokens.font.body },
          motion: {
            translation: { block: values.offset },
            transition: { transform: tokens.motion.settle },
          },
        }),
      }),
    );
    const reversed = materialize(
      fixture({
        root: ({ values }, tokens) => ({
          motion: {
            transition: { transform: tokens.motion.settle },
            translation: { block: values.offset },
          },
          typography: { font: tokens.font.body, color: tokens.color.text },
          paint: {
            shadow: tokens.shadow.panel,
            opacity: values.opacity,
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
      ({ tokens, createRecipe, createMotion, interpolate }: Record<string, any>) => {
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
            Card({ interaction, geometry, values }: Record<string, any>) {
              const sheet = createMotion({
                target: values.offset,
                transition: tokens.motion.settle,
                range: [0, 700],
              });
              return {
                Root: [
                  card({
                    tone: values.tone,
                    compact: geometry.inlineSize.isBelow(tokens.size.compact),
                  }),
                  {
                    when: interaction.hovered,
                    motion: {
                      translation: { block: sheet },
                      scale: interpolate(values.opacity, [0, 1], [0.98, 1]),
                    },
                  },
                ],
                Label: {
                  when: values.opacity.isAbove(0.5),
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
          values: surface.components.Card.values.map((value) => ({
            ...value,
            writable: value.name === "offset" || value.name === "opacity",
          })),
          events: ["startDragging", "releaseDragging", "cancelDragging"],
          parameters: ["dismissDistance"],
        },
      },
    };
    const source = ({ tokens }: Record<string, any>) => ({
      theme: fixtureTheme(),
      components: {
        Card({ values, writableValues, events, parts }: Record<string, any>) {
          return {
            parameters: { dismissDistance: 0.35 },
            interactions: [
              {
                type: "drag",
                trigger: parts.Anchor,
                axis: "block",
                bounds: { block: [0, values.offset] },
                output: {
                  block: writableValues.offset,
                  progressBlock: writableValues.opacity,
                },
                start: events.startDragging,
                release: events.releaseDragging,
                cancel: events.cancelDragging,
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
        ({ tokens }: Record<string, any>) => ({
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
        ({ tokens }: Record<string, any>) => ({
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
        ({ tokens }: Record<string, any>) => ({
          theme: fixtureTheme(),
          components: {
            Card({ values, parts }: Record<string, any>) {
              return {
                parameters: { dismissDistance: 0.35 },
                interactions: [
                  {
                    type: "drag",
                    trigger: parts.Anchor,
                    axis: "block",
                    bounds: { block: [0, values.offset] },
                    output: { block: values.tone },
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
    ).toThrow(/requires writable Value|unknown Event/);
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
        events: {
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
    const listeners = new Map<string, (event: any) => void>();
    const frames: FrameRequestCallback[] = [];
    let hit: HoverElement | null = null;
    const document = {
      defaultView: undefined,
      documentElement: {},
      elementFromPoint: () => hit,
      addEventListener: (name: string, listener: (event: any) => void) => {
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
      ({ createRecipe }: Record<string, any>) => {
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
            Card({ geometry }: Record<string, any>) {
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
        root: ({ values }, tokens) => ({
          paint: {
            fill: tokens.color.canvas,
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            shadow: tokens.shadow.panel,
          },
          typography: { color: tokens.color.text, font: tokens.font.body },
          shape: { corners: { radius: tokens.radius.panel } },
          motion: {
            translation: { block: values.offset },
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
        root: ({ values }, tokens) => ({
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
            opacity: values.opacity,
          },
          typography: {
            color: tokens.color.text,
            font: tokens.font.body,
            size: 14,
          },
          motion: {
            translation: { block: values.offset },
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
      materialize(({ tokens }: Record<string, any>) => ({
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
      materialize(({ tokens }: Record<string, any>) => ({
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
      ({ createMotion }: Record<string, any>) => {
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
    };
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
