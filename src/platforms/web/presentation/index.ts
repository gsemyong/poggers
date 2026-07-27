import type { WebSpring, WebTrack, WebTween } from "@/platforms/web/presentation/dynamics";
import type {
  ConfiguredPresentation as CoreConfiguredPresentation,
  Presentation as CorePresentation,
} from "@/platforms/web/presentation/language";
import type { IntrinsicElements } from "@/platforms/web/ui";
import type { ComponentOwner } from "@/platforms/web/ui/component";

type Empty = Record<never, never>;
declare const webContainerBrand: unique symbol;

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

/** A stable typed identity shared by one container declaration and its queries. */
export type WebContainer<Name extends string = string> = Name &
  Readonly<{ readonly [webContainerBrand]: true }>;

/** Creates one validated container identity without exposing native query names. */
export function createContainer<const Name extends string>(name: Name): WebContainer<Name> {
  if (!/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid web container identity ${JSON.stringify(name)}.`);
  }
  return name as WebContainer<Name>;
}

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

/** Places one grid item along a logical axis without exposing CSS line syntax. */
export type WebGridPlacement =
  | Readonly<{ start: number; end?: never; span?: number }>
  | Readonly<{ start?: number; end: number; span?: never }>
  | Readonly<{ start?: never; end?: never; span: number }>;

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
      columns?: "subgrid" | readonly WebGridTrack[];
      rows?: "subgrid" | readonly WebGridTrack[];
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
    grid?: Readonly<{
      inline?: WebGridPlacement;
      block?: WebGridPlacement;
    }>;
    scroll?: Readonly<{
      align?: Readonly<{
        block?: "start" | "center" | "end";
        inline?: "start" | "center" | "end";
      }>;
      stop?: "normal" | "always";
      margin?: WebLogicalBox<WebLength>;
    }>;
  }>;
  overflow?: Readonly<{
    inline?: "visible" | "clip" | "scroll" | "auto";
    block?: "visible" | "clip" | "scroll" | "auto";
    overscroll?: "auto" | "contain" | "none";
    gutter?: "auto" | "stable" | "stable-both";
  }>;
  scroll?: Readonly<{
    snap?: Readonly<{
      axis: "inline" | "block" | "both";
      strictness: "mandatory" | "proximity";
    }>;
    padding?: WebLogicalBox<WebLength>;
    indicator?:
      | Readonly<{ visibility: "hidden" }>
      | Readonly<{
          visibility?: "auto";
          size?: "auto" | "thin";
          colors?: Readonly<{ thumb: WebColor; track: WebColor }>;
        }>;
  }>;
  containment?: "none" | "layout" | "paint" | "strict";
  visibility?: "visible" | "hidden" | "deferred";
  container?: Readonly<{ identity?: WebContainer; axis: "inline" | "size" }>;
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
  maxLines?: number;
  wordBreak?: "normal" | "break-all" | "keep-all";
  hyphens?: "none" | "manual" | "auto";
  decoration?: "none" | "underline" | "line-through" | "overline";
  case?: "none" | "uppercase" | "lowercase" | "capitalize";
  writing?: Readonly<{
    blockFlow: "top-to-bottom" | "right-to-left" | "left-to-right";
    glyphOrientation?: "natural" | "upright" | "sideways";
  }>;
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

export type WebConditionTest = Readonly<{
  pseudo?: "hover" | "active" | "focus-visible" | "disabled";
  container?: Readonly<{
    identity?: WebContainer;
    minInlineSize?: WebQueryLength;
    maxInlineSize?: WebQueryLength;
    minBlockSize?: WebQueryLength;
    maxBlockSize?: WebQueryLength;
    minAspectRatio?: number;
    maxAspectRatio?: number;
    orientation?: "portrait" | "landscape";
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

export type WebCondition =
  | WebConditionTest
  | Readonly<{ all: readonly [WebCondition, WebCondition, ...WebCondition[]] }>
  | Readonly<{ any: readonly [WebCondition, WebCondition, ...WebCondition[]] }>
  | Readonly<{ not: WebCondition }>;

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

/** A web Presentation definition with typed interface-selected parameters. */
export type WebPresentation<
  Root extends ComponentOwner,
  Parameters extends object = Empty,
> = CorePresentation<Root, WebPresentationLanguage, Parameters>;

/** A web Presentation paired with its interface-selected parameters. */
export type ConfiguredWebPresentation<
  Root extends ComponentOwner,
  Parameters extends object = Empty,
> = CoreConfiguredPresentation<Root, WebPresentationLanguage, Parameters>;

export {
  decay,
  follow,
  pulse,
  sampleTrack,
  spring,
  track,
  tween,
} from "@/platforms/web/presentation/dynamics";
export type {
  WebDecay,
  WebDecayOptions,
  WebDynamics,
  WebFollow,
  WebPulse,
  WebPulseOptions,
  WebPerceivedSpring,
  WebPhysicalSpring,
  WebScalarAnimation,
  WebSpring,
  WebSpringOptions,
  WebTrack,
  WebTrackOptions,
  WebTrackPoint,
  WebTrajectory,
  WebTween,
  WebTweenOptions,
} from "@/platforms/web/presentation/dynamics";
