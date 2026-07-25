import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compileWebDynamicStyle,
  compileWebStyle,
  planWebPresentationArtifacts,
  validateWebPresentationSource,
} from "@/adapters/web/ui/presentation/compiler";
import { compilePresentationSource } from "@/compiler/presentation";
import { createContainer, type WebStyle } from "@/platforms/web/presentation";
import { spring } from "@/platforms/web/presentation/dynamics";

describe("web Presentation compiler", () => {
  it("accepts only compositor-safe temporal destinations", () => {
    const safe = compilePresentationSource(`
const presentation = (({ parameters }) => ({
  Card({ state }) {
    const progress = animate(state.active ? 1 : 0, parameters.motion);
    return { Root: {
      paint: { opacity: progress },
      transform: { translate: { y: 12 * progress } },
    } };
  },
})) satisfies Presentation<App, Language, Parameters>;
`);
    expect(() => validateWebPresentationSource(safe.ir)).not.toThrow();

    const unsafe = compilePresentationSource(`
const presentation = (({ parameters }) => ({
  presence({ state }) {
    const progress = animate(state.active ? 1 : 0, parameters.motion);
    return { Root: { layout: { blockSize: 100 + 20 * progress } } };
  },
})) satisfies Presentation<App, Language, Parameters>;
`);
    expect(() => validateWebPresentationSource(unsafe.ir)).toThrow(
      'Web temporal output "presence/Root/layout/blockSize" is not compositor-safe',
    );
  });

  it("emits concise logical CSS from semantic declarations", () => {
    const compiled = compileWebStyle({
      layout: {
        model: {
          kind: "flow",
          direction: "block",
          gap: 8,
          align: "center",
          distribute: "between",
        },
        minInlineSize: 240,
        maxInlineSize: { percent: 100 },
        padding: { block: 12, inline: 16 },
        position: { kind: "fixed", inset: { blockEnd: 0 }, layer: 20 },
      },
      paint: {
        fill: { oklch: [0.99, 0.002, 250] },
        opacity: 0.9,
        radius: 28,
        shadow: {
          y: 12,
          blur: 36,
          color: { oklch: [0.1, 0.01, 250, 0.2] },
        },
      },
      text: {
        family: ["rounded", "system"],
        size: 16,
        weight: "semibold",
        lineHeight: 1.4,
        color: { oklch: [0.2, 0, 0] },
        wrap: "balance",
      },
    });

    expect(compiled.className).toMatch(/^p[a-z0-9]+$/);
    expect(compiled.css).toBe(
      `.${compiled.className}{align-items:center;background-color:oklch(0.99 0.002 250);` +
        "border-radius:28px;box-shadow:0 12px 36px 0 oklch(0.1 0.01 250/0.2);" +
        "color:oklch(0.2 0 0);display:flex;" +
        "flex-direction:column;font-family:ui-rounded,system-ui;font-size:16px;font-weight:600;gap:8px;" +
        "inset-block-end:0;justify-content:space-between;line-height:1.4;max-inline-size:100%;" +
        "min-inline-size:240px;opacity:0.9;padding-block:12px;padding-inline:16px;position:fixed;" +
        "text-wrap:balance;z-index:20}",
    );
  });

  it("is deterministic across object insertion order", () => {
    const first = compileWebStyle({
      paint: { opacity: 0.8, fill: { srgb: [1, 1, 1] } },
      layout: { inlineSize: 320 },
    });
    const second = compileWebStyle({
      layout: { inlineSize: 320 },
      paint: { fill: { srgb: [1, 1, 1] }, opacity: 0.8 },
    });
    expect(second).toEqual(first);
  });

  it("plans a complete immutable artifact before native mutation", () => {
    const plan = planWebPresentationArtifacts(
      {
        Panel: {
          layout: { inlineSize: 320 },
          paint: { opacity: 0.75 },
          transform: { translate: { y: 24 } },
          continuity: { identity: "panel", dynamics: spring({ duration: 300 }) },
        },
      },
      { dynamic: true },
    );

    expect(plan.elements.Panel).toMatchObject({
      execution: { kind: "canonical", reason: "dynamic-declaration" },
      properties: ["inline-size", "opacity", "translate"],
      ownership: {
        "inline-size": "presentation",
        opacity: "presentation",
        transform: "layout",
        "transform-origin": "layout",
        translate: "presentation",
      },
      continuity: { identity: "panel", strategy: "position" },
    });
    expect(plan.elements.Panel?.css).toContain("opacity:var(--");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.elements.Panel?.ownership)).toBe(true);
  });

  it("produces byte-equivalent plans for byte-equivalent declarations", () => {
    const declaration = {
      Root: {
        paint: { opacity: 0.5 },
        text: { size: 16, weight: "bold" as const },
      },
    };
    const first = planWebPresentationArtifacts(declaration, { dynamic: false });
    const second = planWebPresentationArtifacts(declaration, { dynamic: false });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.elements.Root?.execution).toEqual({ kind: "static" });
    expect(first.elements.Root?.variables).toEqual({});
  });

  it("keeps artifact planning deterministic and singly owned for generated declarations", () => {
    fc.assert(
      fc.property(
        fc.record({
          opacity: fc.double({ min: 0, max: 1, noNaN: true }),
          radius: fc.integer({ min: 0, max: 96 }),
          translate: fc.double({ min: -2_000, max: 2_000, noNaN: true }),
          continuity: fc.boolean(),
        }),
        ({ opacity, radius, translate, continuity }) => {
          const declaration = {
            Panel: {
              paint: { opacity, radius },
              transform: { translate: { y: translate } },
              ...(continuity
                ? { continuity: { dynamics: spring({ stiffness: 500, damping: 40 }) } }
                : {}),
            },
          } satisfies Readonly<Record<string, WebStyle & { continuity?: unknown }>>;
          const first = planWebPresentationArtifacts(declaration as never, { dynamic: true });
          const second = planWebPresentationArtifacts(declaration as never, { dynamic: true });
          const ownership = first.elements.Panel?.ownership ?? {};

          expect(JSON.stringify(first)).toBe(JSON.stringify(second));
          expect(Object.keys(ownership)).toHaveLength(new Set(Object.keys(ownership)).size);
          expect(
            Object.values(ownership).every(
              (owner) => owner === "presentation" || owner === "layout",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("keeps one native rule while sampled numeric channels change", () => {
    const compile = (progress: number) =>
      compileWebDynamicStyle({
        paint: { opacity: progress, radius: 32 - 8 * progress },
        transform: { translate: { y: 720 * (1 - progress) }, scale: 0.96 + 0.04 * progress },
        rules: [
          {
            when: { container: { maxInlineSize: 420 } },
            use: { layout: { padding: 16 } },
          },
        ],
      });
    const closed = compile(0);
    const open = compile(1);

    expect(open.compiled).toEqual(closed.compiled);
    expect(open.variables).not.toEqual(closed.variables);
    expect(open.compiled.css).toContain("opacity:var(--");
    expect(open.compiled.css).toContain("(inline-size<=420px)");
    expect(open.compiled.css).not.toContain("var(--kit-value-");
  });

  it("keeps rich interpolated paint and transform declarations on one native template", () => {
    const compile = (progress: number) =>
      compileWebDynamicStyle({
        paint: {
          fill: { oklch: [0.7 + progress * 0.1, 0.12, 220 + progress * 20, progress] },
          opacity: progress,
          radius: 12 + progress * 20,
          shadow: {
            y: 4 + progress * 12,
            blur: 12 + progress * 28,
            color: { srgb: [0, 0, 0, progress * 0.2] },
          },
          clip: { circle: 0.2 + progress * 0.6 },
          filter: { blur: (1 - progress) * 10 },
        },
        transform: {
          translate: { x: progress * 24, y: (1 - progress) * 80 },
          rotate: progress * 16,
          scale: 0.9 + progress * 0.1,
        },
      });
    const early = compile(0.2);
    const late = compile(0.8);

    expect(late.compiled).toEqual(early.compiled);
    expect(late.variables).not.toEqual(early.variables);
    expect(late.compiled.css).toContain("background-color:oklch(var(--");
    expect(late.compiled.css).toContain("box-shadow:");
    expect(late.compiled.css).toContain("clip-path:circle(var(--");
    expect(late.compiled.css).toContain("filter:blur(var(--");
    expect(late.compiled.css).toContain("rotate:var(--");
  });

  it("lowers ordered pseudo, container, and preference conditions to native CSS", () => {
    const control = createContainer("control");
    const compiled = compileWebStyle({
      paint: { opacity: 1 },
      rules: [
        { when: { pseudo: "hover" }, use: { paint: { opacity: 0.85 } } },
        {
          when: {
            pseudo: "focus-visible",
            container: { identity: control, minInlineSize: 320 },
            preference: { contrast: "more" },
          },
          use: {
            paint: {
              outline: {
                width: 2,
                offset: 2,
                color: { oklch: [0.65, 0.2, 250] },
              },
            },
          },
        },
      ],
    });

    expect(compiled.css).toContain(`.${compiled.className}:where(:hover){opacity:0.85}`);
    expect(compiled.css).toContain(
      `@media (prefers-contrast:more){@container control (inline-size>=320px){.${compiled.className}:where(:focus-visible){outline:2px solid oklch(0.65 0.2 250);outline-offset:2px}}}`,
    );
  });

  it("adapts reusable features to their container shape", () => {
    const feature = createContainer("feature");
    const compiled = compileWebStyle({
      rules: [
        {
          when: {
            container: {
              identity: feature,
              minAspectRatio: 4 / 3,
              maxAspectRatio: 2,
              orientation: "landscape",
            },
          },
          use: {
            layout: {
              model: { kind: "grid", columns: [{ fraction: 2 }, { fraction: 1 }] },
            },
          },
        },
      ],
    });

    expect(compiled.css).toBe(
      `@container feature (aspect-ratio>=1.3333333333333333/1) and (aspect-ratio<=2/1) and (orientation:landscape){.${compiled.className}{display:grid;grid-template-columns:2fr 1fr}}`,
    );
  });

  it("preserves distinct ancestor selection in nested container conditions", () => {
    const workspace = createContainer("workspace");
    const panel = createContainer("panel");
    const compiled = compileWebStyle({
      rules: [
        {
          when: {
            all: [
              { container: { identity: workspace, minInlineSize: 720 } },
              { container: { identity: panel, maxInlineSize: 360 } },
            ],
          },
          use: { layout: { visibility: "hidden" } },
        },
      ],
    });

    expect(compiled.css).toBe(
      `@container panel (inline-size<=360px){@container workspace (inline-size>=720px){.${compiled.className}{visibility:hidden}}}`,
    );
  });

  it("aligns nested feature layout to parent grid tracks", () => {
    const compiled = compileWebStyle({
      layout: {
        model: {
          kind: "grid",
          columns: "subgrid",
          rows: "subgrid",
          columnGap: 12,
        },
      },
    });

    expect(compiled.css).toBe(
      `.${compiled.className}{column-gap:12px;display:grid;grid-template-columns:subgrid;grid-template-rows:subgrid}`,
    );
  });

  it("places grid items on logical axes with one line and span vocabulary", () => {
    const compiled = compileWebStyle({
      layout: {
        item: {
          grid: {
            inline: { start: 2, span: 3 },
            block: { start: -3, end: -1 },
          },
        },
      },
    });

    expect(compiled.css).toBe(`.${compiled.className}{grid-column:2/span 3;grid-row:-3/-1}`);
    expect(() => compileWebStyle({ layout: { item: { grid: { inline: { start: 0 } } } } })).toThrow(
      "non-zero integer grid line",
    );
    expect(() => compileWebStyle({ layout: { item: { grid: { inline: { span: 0 } } } } })).toThrow(
      "positive integer",
    );
  });

  it("coordinates a snapping collection through logical scroll meaning", () => {
    const collection = compileWebStyle({
      layout: {
        overflow: { inline: "auto", block: "clip", overscroll: "contain" },
        scroll: {
          snap: { axis: "inline", strictness: "mandatory" },
          padding: { inline: 16 },
          indicator: {
            size: "thin",
            colors: {
              thumb: { oklch: [0.6, 0.1, 240] },
              track: "transparent",
            },
          },
        },
      },
    });
    const item = compileWebStyle({
      layout: {
        item: {
          scroll: {
            align: { inline: "center" },
            stop: "always",
            margin: { inline: 8 },
          },
        },
      },
    });

    expect(collection.css).toBe(
      `.${collection.className}{overflow-block:clip;overflow-inline:auto;overscroll-behavior:contain;scroll-padding-inline:16px;scroll-snap-type:inline mandatory;scrollbar-color:oklch(0.6 0.1 240) transparent;scrollbar-width:thin}`,
    );
    expect(item.css).toBe(
      `.${item.className}{scroll-margin-inline:8px;scroll-snap-align:none center;scroll-snap-stop:always}`,
    );
    const hidden = compileWebStyle({
      layout: { scroll: { indicator: { visibility: "hidden" } } },
    });
    expect(hidden.css).toBe(`.${hidden.className}{scrollbar-width:none}`);
  });

  it("describes vertical typography through block flow and glyph orientation", () => {
    const compiled = compileWebStyle({
      layout: { padding: { block: 12, inline: 20 } },
      text: {
        align: "start",
        writing: { blockFlow: "right-to-left", glyphOrientation: "upright" },
      },
    });

    expect(compiled.css).toBe(
      `.${compiled.className}{padding-block:12px;padding-inline:20px;text-align:start;text-orientation:upright;writing-mode:vertical-rl}`,
    );
  });

  it("hides compatible multi-line truncation artifacts behind semantic maxLines", () => {
    const compiled = compileWebStyle({
      text: { maxLines: 3, wrap: "pretty" },
    });

    expect(compiled.css).toBe(
      `.${compiled.className}{-webkit-box-orient:vertical;-webkit-line-clamp:3;display:-webkit-box;overflow:hidden;text-wrap:pretty}`,
    );
    expect(() =>
      compileWebStyle({
        layout: { model: { kind: "flow", direction: "block" } },
        text: { maxLines: 2 },
      }),
    ).toThrow("cannot be combined with an explicit layout model");
    expect(() => compileWebStyle({ text: { maxLines: 1.5 } })).toThrow("positive integer");
  });

  it("lowers nested responsive condition meaning without duplicated declarations", () => {
    const compiled = compileWebStyle({
      rules: [
        {
          when: {
            all: [
              {
                any: [{ container: { maxInlineSize: 420 } }, { pointer: { accuracy: "coarse" } }],
              },
              { not: { preference: { motion: "reduced" } } },
            ],
          },
          use: {
            layout: { padding: { inline: 20 } },
            paint: { opacity: 0.9 },
          },
        },
      ],
    });
    const declarations = `.${compiled.className}{opacity:0.9;padding-inline:20px}`;

    expect(compiled.css).toBe(
      `@media not (prefers-reduced-motion:reduce){@container (inline-size<=420px){${declarations}}}` +
        `@media not (prefers-reduced-motion:reduce){@media (pointer:coarse){${declarations}}}`,
    );
  });

  it("applies De Morgan semantics to negated compound conditions", () => {
    const compiled = compileWebStyle({
      rules: [
        {
          when: {
            not: {
              all: [{ pseudo: "hover" }, { preference: { colorScheme: "dark" } }],
            },
          },
          use: { paint: { opacity: 0.7 } },
        },
      ],
    });

    expect(compiled.css).toBe(
      `.${compiled.className}:where(:not(:hover)){opacity:0.7}` +
        `@media not (prefers-color-scheme:dark){.${compiled.className}{opacity:0.7}}`,
    );
  });

  it("rejects conditions that cannot affect native CSS", () => {
    expect(() =>
      compileWebStyle({
        rules: [{ when: {}, use: { paint: { opacity: 0.5 } } }],
      }),
    ).toThrow("condition cannot be empty");
    expect(() =>
      compileWebStyle({
        rules: [{ when: { pseudo: "hover" }, use: {} }],
      }),
    ).toThrow("must apply at least one style");
    expect(() =>
      compileWebStyle({
        rules: [
          {
            when: { container: { minAspectRatio: 0 } },
            use: { paint: { opacity: 0.5 } },
          },
        ],
      }),
    ).toThrow("positive finite aspect ratio");
  });

  it("composes pure TypeScript recipes before compilation", () => {
    const control = (opacity: number): WebStyle => ({
      layout: { padding: { block: 10, inline: 14 } },
      paint: { opacity },
    });
    const style = { ...control(0.7), text: { weight: "bold" } } satisfies WebStyle;
    expect(compileWebStyle(style).css).toContain("font-weight:700");
  });
});
