import type { ComponentOwner } from "../../../core/component";
import type {
  ConfiguredPresentation as CoreConfiguredPresentation,
  Presentation as CorePresentation,
} from "../../../core/presentation";
import type { IntrinsicElements } from "../component/elements";
import type { WebTrack, WebTween } from "./dynamics";
import type { WebSpring } from "./spring";

type Empty = Record<never, never>;

/** Live web observations shared by every Presentation under one mounted UI root. */
export type WebPresentationEnvironment = Readonly<{
  viewport: Readonly<{
    inlineSize: number;
    blockSize: number;
    scale: number;
  }>;
  safeArea: Readonly<{
    blockStart: number;
    blockEnd: number;
    inlineStart: number;
    inlineEnd: number;
  }>;
  preferences: Readonly<{
    reducedMotion: boolean;
    contrast: "normal" | "more" | "less";
    colorScheme: "light" | "dark";
  }>;
  input: Readonly<{
    hover: boolean;
    pointer: "none" | "coarse" | "fine";
  }>;
}>;

/** Cached read-only observations for one named web Element. */
export type WebPresentationElement = Readonly<{
  box: Readonly<{
    inlineSize: number;
    blockSize: number;
    inlineStart: number;
    blockStart: number;
  }>;
  scroll: Readonly<{
    inlineOffset: number;
    blockOffset: number;
  }>;
  visibility: Readonly<{
    intersecting: boolean;
    ratio: number;
  }>;
  layout: WebLayoutSample;
  presence: WebPresenceSample;
}>;

/** One inspected scalar animation sample. */
export type WebAnimationSample = Readonly<{
  value: number;
  velocity: number;
  settled: boolean;
}>;

export type WebLayoutBox = Readonly<{
  inlineStart: number;
  blockStart: number;
  inlineSize: number;
  blockSize: number;
}>;

/** Adapter-owned continuity feedback for one Element's displayed geometry. */
export type WebLayoutSample = Readonly<{
  current: WebLayoutBox;
  destination: WebLayoutBox;
  velocity: Readonly<{
    inlineStart: number;
    blockStart: number;
    inlineSize: number;
    blockSize: number;
  }>;
  progress: number;
  kind: "idle" | "layout" | "replacement";
  settled: boolean;
}>;

export type WebPresenceSample = WebAnimationSample &
  Readonly<{ direction: "idle" | "entering" | "exiting" }>;

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

export type WebStroke =
  | "none"
  | Readonly<{
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

/** An encoded audio asset interpreted and cached by the web adapter. */
export type WebAudioAsset = Readonly<{
  source: string;
  gain?: number;
  playbackRate?: number;
}>;

export type WebAudioAssetOptions = Readonly<{
  gain?: number;
  playbackRate?: number;
}>;

/** Creates typed asset meaning without allocating a native audio resource. */
export function createAudioAsset(
  source: string | URL,
  options: WebAudioAssetOptions = {},
): WebAudioAsset {
  const normalized = String(source);
  if (!normalized) throw new TypeError("A web audio asset source is required.");
  if (options.gain !== undefined && (!Number.isFinite(options.gain) || options.gain < 0)) {
    throw new TypeError("A web audio asset gain must be a finite non-negative number.");
  }
  if (
    options.playbackRate !== undefined &&
    (!Number.isFinite(options.playbackRate) || options.playbackRate <= 0)
  ) {
    throw new TypeError("A web audio asset playbackRate must be a finite positive number.");
  }
  return Object.freeze({ source: normalized, ...options });
}

/** An image asset interpreted by the web adapter. */
export type WebImageAsset = Readonly<{
  source: string;
}>;

/** Creates typed image meaning without creating or loading a native image. */
export function createImageAsset(source: string | URL): WebImageAsset {
  const normalized = String(source);
  if (!normalized) throw new TypeError("A web image asset source is required.");
  return Object.freeze({ source: normalized });
}

/** Passive sensory feedback observed by the web Presentation adapter. */
export type WebFeedback = Readonly<{
  activate?: Readonly<{ audio?: WebAudioAsset }>;
}>;

/** Requests adapter-owned visual continuity across web layout changes. */
export type WebLayoutContinuity = Readonly<{
  identity?: string;
  dynamics: WebSpring | WebTween | WebTrack;
  strategy?: "transform" | "position";
}>;

export type WebElementPresentation = WebStyle &
  Readonly<{
    /** Replaces the current image source immediately; crossfades use explicit overlapping Elements. */
    image?: WebImageAsset;
    feedback?: WebFeedback;
    presence?: WebAnimationSample;
    continuity?: WebLayoutContinuity;
  }>;

type WebPrimitivePresentation<Primitive extends keyof IntrinsicElements> = Primitive extends "img"
  ? WebElementPresentation
  : Omit<WebElementPresentation, "image">;

export type WebPresentationLanguage = {
  readonly Declarations: Readonly<{
    [Primitive in keyof IntrinsicElements]: WebPrimitivePresentation<Primitive>;
  }>;
  readonly Environment: WebPresentationEnvironment;
  readonly Observations: Readonly<{
    [Primitive in keyof IntrinsicElements]: WebPresentationElement;
  }>;
};

/** A web Presentation definition with typed Application-selected parameters. */
export type WebPresentation<
  Root extends ComponentOwner,
  Parameters extends object = Empty,
> = CorePresentation<Root, WebPresentationLanguage, Parameters>;

/** A web Presentation paired with its Application-selected parameters. */
export type ConfiguredWebPresentation<
  Root extends ComponentOwner,
  Parameters extends object = Empty,
> = CoreConfiguredPresentation<Root, WebPresentationLanguage, Parameters>;
