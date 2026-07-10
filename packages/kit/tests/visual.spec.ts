import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeVisualContract,
  analyzeVisualPresetSources,
  materializeVisualPreset,
  stableVisualJson,
} from "../src/visual-compiler";
import { selectVisualMotionBackend } from "../src/visual-runtime";
import { generateVisualStylexModule } from "../src/visual-stylex";

const surface = {
  components: {
    Card: {
      parts: { Root: "article", Label: "span", Anchor: "button" },
      styleValues: [
        { name: "offset", kind: "length" },
        { name: "opacity", kind: "opacity" },
      ],
    },
  },
} as const;

function fixture(): Record<string, any> {
  return {
    tokens: {
      color: {
        canvas: { l: 0.98, c: 0.006, h: 260 },
        text: { l: 0.18, c: 0.01, h: 260 },
        line: { token: "text" },
      },
      font: { body: { families: ["Inter", "Arial"] } },
      radius: { panel: 12 },
      shadow: {
        panel: {
          y: 16,
          blur: 40,
          spread: -16,
          color: { l: 0.1, c: 0.01, h: 260, alpha: 0.24 },
        },
      },
      motion: {
        settle: { spring: { duration: 420, bounce: 0.1 } },
      },
      space: { md: 12 },
    },
    themes: {
      dark: {
        color: {
          canvas: { l: 0.14, c: 0.008, h: 260 },
          text: { l: 0.96, c: 0.004, h: 260 },
        },
      },
    },
    containers: {
      compact: { inlineBelow: 560 },
    },
    components: ({ tokens }: { tokens: any }) => {
      const shared = {
        padding: tokens.space.md,
        surface: { fill: tokens.color.canvas },
        when: [
          {
            native: "pressed",
            apply: { surface: { text: tokens.color.text } },
          },
        ],
        motion: { change: { surface: tokens.motion.settle } },
      };
      return {
        Card: ({ values }: { values: any }) => ({
          Root: {
            use: shared,
            layout: {
              kind: "grid",
              columns: [{ minmax: [120, { fraction: 1 }] }],
              gap: tokens.space.md,
            },
            frame: { inline: { max: 640 }, contain: "layout" },
            margin: { block: 12 },
            surface: { fill: tokens.color.canvas, text: tokens.color.text },
            text: { font: tokens.font.body, size: 14, line: 1.4, wrap: "pretty" },
            stroke: { width: 1, line: "solid", color: tokens.color.line },
            shape: { radius: tokens.radius.panel, clip: "content" },
            effect: { opacity: values.opacity },
            transform: { block: values.offset },
            position: {
              kind: "absolute",
              anchor: { part: "Anchor" },
              place: "block-end",
            },
            scroll: { block: "auto", overscroll: "contain", scrollbar: "thin" },
            interaction: {
              cursor: "pointer",
              focusRing: { color: tokens.color.line, width: 2, offset: 2 },
            },
            decor: {
              before: {
                content: "",
                frame: { inline: 4, block: 4 },
                surface: { fill: tokens.color.text },
              },
            },
            when: [
              { state: { open: true }, apply: { effect: { opacity: 1 } } },
              { variant: { density: "compact" }, apply: { padding: 8 } },
              { theme: "dark", apply: { effect: { shadow: tokens.shadow.panel } } },
              { native: "hover", apply: { transform: { block: -2 } } },
              { container: "compact", apply: { layout: { kind: "stack" } } },
              { preference: "reduced-motion", apply: { transform: { block: 0 } } },
              {
                capability: "backdrop-filter",
                apply: { effect: { backdrop: { blur: 12 } } },
              },
            ],
            motion: {
              layout: {
                geometry: "position",
                using: tokens.motion.settle,
              },
            },
          },
          Label: {
            use: shared,
            place: { flex: { grow: 1, shrink: 1, basis: "content" }, overlay: true },
            media: { fit: "cover", position: { inline: 0.5, block: 0.5 } },
          },
        }),
      };
    },
  };
}

describe("visual preset materialization", () => {
  it("selects the least expensive motion backend that preserves intent", () => {
    expect(selectVisualMotionBackend("none")).toBe("instant");
    expect(selectVisualMotionBackend({ duration: 140, easing: "decelerate" })).toBe("waapi");
    expect(selectVisualMotionBackend({ spring: { duration: 420, bounce: 0.1 } })).toBe(
      "anime-spring",
    );
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
      StyleValues: { offset: "length"; opacity: "opacity" };
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
      parts: { Root: "article", Label: "span" },
      styleValues: [
        { name: "offset", kind: "length" },
        { name: "opacity", kind: "opacity" },
      ],
    });
    expect(analysis.presets.map(({ name }) => name)).toEqual(["precision", "tactile"]);
    expect(analysis.presets[0]?.tokens.color).toEqual(["canvas", "text"]);
    expect(analysis.presets[0]?.themes).toEqual(["default", "dark"]);
    expect(analysis.presets[0]?.containers).toEqual(["compact"]);
    expect(analysis.presets[0]?.location.file).toBe(path);

    const presetPath = join(directory, "presets.ts");
    const appPath = join(directory, "app.ts");
    await writeFile(
      presetPath,
      `export const precisionPreset = { tokens: {}, components: () => ({}) };\n`,
      "utf8",
    );
    await writeFile(
      appPath,
      `import { precisionPreset } from "src/presets";
export default { styles: { presets: { precision: precisionPreset } } } satisfies object;
`,
      "utf8",
    );
    const locations = analyzeVisualPresetSources(appPath, directory);
    expect(locations.precision?.file).toBe(presetPath);
    expect(locations.precision?.line).toBe(1);
  });

  it("evaluates compile-time scopes into deterministic serializable data", () => {
    const first = materializeVisualPreset("precision", fixture(), surface);
    const second = materializeVisualPreset("precision", fixture(), surface);

    expect(stableVisualJson(first)).toBe(stableVisualJson(second));
    expect(first.components.Card?.Root).toMatchObject({
      effect: {
        opacity: {
          $visual: "value",
          component: "Card",
          kind: "opacity",
          name: "opacity",
        },
      },
      motion: {
        layout: {
          geometry: "position",
          using: { $visual: "token", group: "motion", name: "settle" },
        },
      },
      position: { anchor: { part: "Anchor" }, kind: "absolute" },
      transform: {
        block: {
          $visual: "value",
          component: "Card",
          kind: "length",
          name: "offset",
        },
      },
      use: {
        padding: { $visual: "token", group: "space", name: "md" },
        surface: {
          fill: { $visual: "token", group: "color", name: "canvas" },
        },
      },
    });
    expect(first.components.Card?.Anchor).toEqual({});
  });

  it("generates a module accepted by the official StyleX compiler", async () => {
    const preset = materializeVisualPreset("precision", fixture(), surface);
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
    expect(css).toContain("@container");
    expect(css).toContain("position-try-fallbacks: flip-block");
    expect(css).toContain("position-try-order: most-block-size");
    expect(css).toContain('[aria-pressed="true"]');
    expect(source).toContain("stylex.create");
  });

  it("rejects unknown components and parts", () => {
    const unknownComponent = fixture();
    unknownComponent.components = () => ({
      Card: () => ({ Root: {} }),
      Unknown: () => ({ Root: {} }),
    });
    expect(() => materializeVisualPreset("precision", unknownComponent, surface)).toThrow(
      'unknown component "Unknown"',
    );

    const unknownPart = fixture();
    unknownPart.components = () => ({
      Card: () => ({ Root: {}, Unknown: {} }),
    });
    expect(() => materializeVisualPreset("precision", unknownPart, surface)).toThrow(
      'unknown part "Unknown"',
    );
  });

  it("rejects unknown nested visual fields and motion intents after static evaluation", () => {
    const unknownField = fixture();
    unknownField.components = () => ({
      Card: () => ({ Root: { effect: { opacity: 1, mystery: true } } }),
    });
    expect(() =>
      generateVisualStylexModule([materializeVisualPreset("precision", unknownField, surface)]),
    ).toThrow('effect contains unknown field "mystery"');

    const unknownMotion = fixture();
    unknownMotion.components = ({ tokens }: { tokens: any }) => ({
      Card: () => ({
        Root: {
          effect: { opacity: 1 },
          motion: { sequence: [{ using: tokens.motion.settle }] },
        },
      }),
    });
    expect(() =>
      generateVisualStylexModule([materializeVisualPreset("precision", unknownMotion, surface)]),
    ).toThrow('motion contains unknown field "sequence"');
  });

  it("rejects malformed motion tokens and unsafe layout ownership", () => {
    const malformed = fixture();
    malformed.tokens.motion.settle = {
      spring: { duration: 420, bounce: 0.1, stiffness: 600 },
    };
    expect(() =>
      generateVisualStylexModule([materializeVisualPreset("precision", malformed, surface)]),
    ).toThrow('spring contains unknown field "stiffness"');

    const unsafe = fixture();
    unsafe.components = ({ tokens }: { tokens: any }) => ({
      Card: () => ({
        Root: {
          transform: { skewInline: 5 },
          motion: {
            layout: { geometry: "position", using: tokens.motion.settle },
          },
        },
      }),
    });
    expect(() =>
      generateVisualStylexModule([materializeVisualPreset("precision", unsafe, surface)]),
    ).toThrow("cannot combine layout motion with an authored transform matrix");
  });

  it("rejects runtime functions, non-finite numbers, class instances, and cycles", () => {
    const runtimeFunction = fixture();
    runtimeFunction.components = () => ({
      Card: () => ({ Root: { effect: { opacity: () => 1 } } }),
    });
    expect(() => materializeVisualPreset("precision", runtimeFunction, surface)).toThrow(
      "runtime function",
    );

    const nonFinite = fixture();
    nonFinite.tokens.space.md = Number.POSITIVE_INFINITY;
    expect(() => materializeVisualPreset("precision", nonFinite, surface)).toThrow(
      "non-finite number",
    );

    const classValue = fixture();
    classValue.themes = { dark: new Map() } as never;
    expect(() => materializeVisualPreset("precision", classValue, surface)).toThrow(
      "plain objects and arrays",
    );

    const circular = fixture();
    const root: Record<string, unknown> = {};
    root.self = root;
    circular.themes = root as never;
    expect(() => materializeVisualPreset("precision", circular, surface)).toThrow(
      "circular reference",
    );
  });
});
