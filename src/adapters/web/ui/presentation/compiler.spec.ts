import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compileWebDynamicStyle,
  compileWebStyle,
  planWebPresentationArtifacts,
  validateWebPresentationSource,
} from "@/adapters/web/ui/presentation/compiler";
import { spring } from "@/adapters/web/ui/presentation/dynamics";
import type { WebStyle } from "@/adapters/web/ui/presentation/language";
import { compilePresentationSource } from "@/core/compiler/presentation";

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
    expect(open.compiled.css).not.toContain("var(--poggers-value-");
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
    const compiled = compileWebStyle({
      paint: { opacity: 1 },
      rules: [
        { when: { pseudo: "hover" }, use: { paint: { opacity: 0.85 } } },
        {
          when: {
            pseudo: "focus-visible",
            container: { name: "control", minInlineSize: 320 },
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
