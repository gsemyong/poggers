import { describe, expect, it } from "vitest";

import type { WebPresentationDeclaration } from "../visual";
import { translateWebPresentationStyle } from "./style";

type TestTheme = {
  size: { compact: { readonly kind: "size"; readonly value: 600 } };
  shadow: {
    lifted: {
      readonly y: 12;
      readonly blur: 36;
      readonly color: { readonly l: 0.1; readonly c: 0.01; readonly h: 250; readonly alpha: 0.2 };
    };
  };
  font: {
    body: { readonly fallback: readonly ["ui-rounded", "system-ui"] };
  };
};

describe("web presentation style translation", () => {
  it("translates logical layout, OKLCH paint, shape, and typography", () => {
    expect(
      translateWebPresentationStyle({
        layout: {
          flow: { axis: "block", gap: 8, align: "center", distribute: "between" },
          size: { inline: { min: 240, max: { percent: 100 } } },
          padding: { inline: 16, block: 12 },
          position: { kind: "fixed", place: "block-end", layer: 20 },
        },
        shape: { radius: 28, clip: "content" },
        paint: {
          fill: { l: 0.99, c: 0.002, h: 250 },
          opacity: 0.9,
          shadow: { y: 12, blur: 36, color: { l: 0.1, c: 0.01, h: 250, alpha: 0.2 } },
        },
        typography: {
          font: { fallback: ["ui-rounded", "system-ui"] },
          size: 16,
          line: 1.4,
          color: { l: 0.2, c: 0, h: 0 },
          wrap: "balance",
        },
      } satisfies WebPresentationDeclaration<TestTheme>),
    ).toEqual({
      alignItems: "center",
      backgroundColor: "oklch(0.99 0.002 250)",
      borderRadius: "28px",
      boxShadow: "0px 12px 36px 0px oklch(0.1 0.01 250 / 0.2)",
      color: "oklch(0.2 0 0)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "ui-rounded, system-ui",
      fontSize: "16px",
      gap: "8px",
      insetBlockEnd: "0",
      justifyContent: "space-between",
      lineHeight: "1.4",
      maxWidth: "100%",
      minWidth: "240px",
      opacity: "0.9",
      overflow: "clip",
      paddingBlock: "12px",
      paddingInline: "16px",
      position: "fixed",
      textWrap: "balance",
      zIndex: "20",
    });
  });

  it("uses container-relative units and deterministic grid expressions", () => {
    expect(
      translateWebPresentationStyle({
        layout: {
          grid: {
            columns: [{ minmax: [120, { fraction: 1 }] }, { repeat: { count: "fit", track: 80 } }],
          },
          margin: { inline: { container: { axis: "inline", percent: 4 } } },
        },
      } satisfies WebPresentationDeclaration<TestTheme>),
    ).toEqual({
      display: "grid",
      gridTemplateColumns: "minmax(120px, 1fr) repeat(auto-fit, 80px)",
      marginInline: "4cqi",
    });
  });
});
