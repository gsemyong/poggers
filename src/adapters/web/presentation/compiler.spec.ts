import { describe, expect, it } from "vitest";

import { compileWebStyle } from "./compiler";
import type { WebStyle } from "./language";

describe("web Presentation compiler", () => {
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
