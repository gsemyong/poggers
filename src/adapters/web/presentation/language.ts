import type { ComponentOwner } from "../../../core/component";
import type { Presentation as CorePresentation } from "../../../core/presentation";

type Empty = Record<never, never>;

/** A device-independent color value interpreted by the web adapter. */
export type WebColor =
  | "transparent"
  | "current"
  | Readonly<{ oklch: readonly [lightness: number, chroma: number, hue: number, alpha?: number] }>
  | Readonly<{ srgb: readonly [red: number, green: number, blue: number, alpha?: number] }>;

/** A logical length. Bare numbers are CSS pixels at the web realization boundary. */
export type WebLength =
  | number
  | Readonly<{ percent: number }>
  | Readonly<{ font: number }>
  | Readonly<{ rootFont: number }>
  | Readonly<{
      viewport: Readonly<{
        axis: "inline" | "block" | "minimum" | "maximum";
        percent: number;
        mode?: "small" | "large" | "dynamic";
      }>;
    }>
  | Readonly<{
      container: Readonly<{
        axis: "inline" | "block" | "minimum" | "maximum";
        percent: number;
      }>;
    }>;

export type WebQueryLength = number | Readonly<{ font: number }> | Readonly<{ rootFont: number }>;

export type WebMeasure =
  | WebLength
  | "auto"
  | "fill"
  | "min-content"
  | "max-content"
  | "fit-content";

export type WebLogicalBox<Value> =
  | Value
  | Readonly<{ block?: Value; inline?: Value }>
  | Readonly<{
      blockStart?: Value;
      blockEnd?: Value;
      inlineStart?: Value;
      inlineEnd?: Value;
    }>;

export type WebGridTrack =
  | WebLength
  | "min-content"
  | "max-content"
  | Readonly<{ fraction: number }>
  | Readonly<{ fit: WebLength }>
  | Readonly<{ minmax: readonly [WebGridTrack, WebGridTrack] }>
  | Readonly<{
      repeat: Readonly<{ count: number | "fit" | "fill"; track: WebGridTrack }>;
    }>;

export type WebLayoutModel =
  | Readonly<{
      kind: "flow";
      direction: "inline" | "block";
      gap?: WebLength;
      align?: "start" | "center" | "end" | "stretch" | "baseline";
      distribute?: "start" | "center" | "end" | "between" | "around" | "evenly";
      wrap?: boolean;
      reverse?: boolean;
    }>
  | Readonly<{
      kind: "grid";
      columns?: readonly WebGridTrack[];
      rows?: readonly WebGridTrack[];
      gap?: WebLength;
      columnGap?: WebLength;
      rowGap?: WebLength;
      align?: "start" | "center" | "end" | "stretch" | "baseline";
      distribute?: "start" | "center" | "end" | "stretch";
      autoFlow?: "row" | "column" | "dense-row" | "dense-column";
    }>
  | Readonly<{
      kind: "overlay";
      align?: "start" | "center" | "end" | "stretch";
      distribute?: "start" | "center" | "end" | "stretch";
    }>
  | Readonly<{ kind: "contents" }>
  | Readonly<{ kind: "hidden" }>;

export type WebLayout = Readonly<{
  model?: WebLayoutModel;
  inlineSize?: WebMeasure;
  blockSize?: WebMeasure;
  minInlineSize?: WebMeasure;
  maxInlineSize?: WebMeasure;
  minBlockSize?: WebMeasure;
  maxBlockSize?: WebMeasure;
  aspectRatio?: number;
  padding?: WebLogicalBox<WebLength>;
  margin?: WebLogicalBox<WebLength | "auto">;
  position?: Readonly<{
    kind: "relative" | "absolute" | "fixed" | "sticky";
    inset?: WebLogicalBox<WebLength | "auto">;
    layer?: number;
  }>;
  item?: Readonly<{
    align?: "auto" | "start" | "center" | "end" | "stretch" | "baseline";
    distribute?: "auto" | "start" | "center" | "end" | "stretch";
    order?: number;
    grow?: number;
    shrink?: number;
    basis?: WebMeasure;
    overlay?: boolean;
  }>;
  overflow?: Readonly<{
    inline?: "visible" | "clip" | "scroll" | "auto";
    block?: "visible" | "clip" | "scroll" | "auto";
    overscroll?: "auto" | "contain" | "none";
    gutter?: "auto" | "stable" | "stable-both";
  }>;
  containment?: "none" | "layout" | "paint" | "strict";
  visibility?: "visible" | "hidden" | "deferred";
  container?: Readonly<{ name?: string; axis: "inline" | "size" }>;
}>;

export type WebGradientStop = Readonly<{ at: number; color: WebColor }>;

export type WebFill =
  | WebColor
  | Readonly<{
      linear: Readonly<{
        angle?: number;
        stops: readonly [WebGradientStop, WebGradientStop, ...WebGradientStop[]];
      }>;
    }>
  | Readonly<{
      radial: Readonly<{
        shape?: "circle" | "ellipse";
        stops: readonly [WebGradientStop, WebGradientStop, ...WebGradientStop[]];
      }>;
    }>
  | Readonly<{
      conic: Readonly<{
        angle?: number;
        stops: readonly [WebGradientStop, WebGradientStop, ...WebGradientStop[]];
      }>;
    }>;

export type WebStroke = Readonly<{
  width: WebLength;
  style?: "solid" | "dashed" | "dotted" | "double";
  color: WebColor;
}>;

export type WebShadow = Readonly<{
  x?: WebLength;
  y?: WebLength;
  blur?: WebLength;
  spread?: WebLength;
  color: WebColor;
  inset?: boolean;
}>;

export type WebPaint = Readonly<{
  fill?: WebFill;
  opacity?: number;
  stroke?: WebStroke;
  radius?:
    | WebLength
    | Readonly<{
        startStart?: WebLength;
        startEnd?: WebLength;
        endStart?: WebLength;
        endEnd?: WebLength;
      }>;
  shadow?: "none" | WebShadow | readonly [WebShadow, ...WebShadow[]];
  outline?:
    | "none"
    | Readonly<{
        width: WebLength;
        offset?: WebLength;
        style?: "solid" | "dashed" | "dotted";
        color: WebColor;
      }>;
  clip?:
    | "none"
    | "content"
    | Readonly<{ circle: number }>
    | Readonly<{
        inset: Readonly<{
          top?: WebLength;
          right?: WebLength;
          bottom?: WebLength;
          left?: WebLength;
        }>;
      }>;
  filter?: Readonly<{
    blur?: WebLength;
    brightness?: number;
    contrast?: number;
    saturation?: number;
  }>;
  backdrop?: Readonly<{
    blur?: WebLength;
    brightness?: number;
    saturation?: number;
  }>;
  blend?: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
}>;

export type WebFontFamily = "system" | "sans" | "serif" | "monospace" | "rounded" | string;

export type WebText = Readonly<{
  color?: WebColor;
  family?: WebFontFamily | readonly [WebFontFamily, ...WebFontFamily[]];
  size?: WebLength;
  weight?: number | "normal" | "medium" | "semibold" | "bold";
  style?: "normal" | "italic" | "oblique";
  lineHeight?: number | WebLength;
  letterSpacing?: WebLength;
  align?: "start" | "center" | "end" | "justify";
  wrap?: "wrap" | "nowrap" | "balance" | "pretty";
  overflow?: "clip" | "ellipsis";
  wordBreak?: "normal" | "break-all" | "keep-all";
  hyphens?: "none" | "manual" | "auto";
  decoration?: "none" | "underline" | "line-through" | "overline";
  case?: "none" | "uppercase" | "lowercase" | "capitalize";
}>;

export type WebMedia = Readonly<{
  fit?: "fill" | "contain" | "cover" | "none" | "scale-down";
  position?: Readonly<{ inline: number; block: number }>;
  rendering?: "auto" | "crisp" | "pixelated";
}>;

export type WebTransform = Readonly<{
  translate?: Readonly<{ x?: WebLength; y?: WebLength }>;
  scale?: number | Readonly<{ x: number; y: number }>;
  rotate?: number;
  origin?: Readonly<{ x: number; y: number }>;
}>;

export type WebAffordance = Readonly<{
  cursor?: "auto" | "default" | "pointer" | "text" | "grab" | "grabbing" | "not-allowed";
  selection?: "auto" | "text" | "none" | "all";
  caret?: WebColor;
  accent?: WebColor;
}>;

export type WebCondition = Readonly<{
  pseudo?: "hover" | "active" | "focus-visible" | "disabled";
  container?: Readonly<{
    name?: string;
    minInlineSize?: WebQueryLength;
    maxInlineSize?: WebQueryLength;
    minBlockSize?: WebQueryLength;
    maxBlockSize?: WebQueryLength;
  }>;
  preference?: Readonly<{
    colorScheme?: "light" | "dark";
    contrast?: "more" | "less";
    motion?: "full" | "reduced";
    forcedColors?: boolean;
  }>;
  pointer?: Readonly<{
    accuracy?: "fine" | "coarse" | "none";
    hover?: boolean;
  }>;
}>;

export type WebStyleFragment = Readonly<{
  layout?: WebLayout;
  paint?: WebPaint;
  text?: WebText;
  media?: WebMedia;
  transform?: WebTransform;
  affordance?: WebAffordance;
}>;

export type WebStyleRule = Readonly<{
  when: WebCondition;
  use: WebStyleFragment;
}>;

/** The web adapter's canonical, cascade-free authoring declaration. */
export type WebStyle = WebStyleFragment &
  Readonly<{
    rules?: readonly WebStyleRule[];
  }>;

export type WebPresentationLanguage = {
  readonly Declarations: Readonly<Record<string, WebStyle>>;
};

/** A parameterized web Presentation. Parameters are ordinary typed product data. */
export type WebPresentation<
  Root extends ComponentOwner,
  Parameters extends object = Empty,
> = CorePresentation<Root, WebPresentationLanguage, Parameters>;
