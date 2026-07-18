import type { ComponentOwner } from "../../../component";
import type { Presentation as CorePresentation, PresentationTarget } from "../../../presentation";

type Empty = Record<never, never>;

export type VisualTokenGroup =
  | "color"
  | "space"
  | "size"
  | "radius"
  | "stroke"
  | "shadow"
  | "font"
  | "gradient"
  | "blur"
  | "z"
  | "motion";

export type OklchColor = {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha?: number;
};

export type ColorTokenValue = OklchColor | "transparent" | "current";

export type FontTokenValue = FontAsset & {
  readonly features?: Readonly<Record<string, boolean | number>>;
};

export type FontFallback =
  | "system-ui"
  | "ui-serif"
  | "ui-sans-serif"
  | "ui-monospace"
  | "ui-rounded"
  | "serif"
  | "sans-serif"
  | "monospace";

export type FontAssetSource = {
  readonly file: string;
  readonly format: "woff2" | "woff" | "opentype" | "truetype";
  readonly weight: number | readonly [minimum: number, maximum: number];
  readonly style?: "normal" | "italic" | "oblique";
  readonly preload?: boolean;
  readonly unicodeRange?: string;
};

export type FontAsset = {
  readonly family?: string;
  readonly sources?: readonly [FontAssetSource, ...FontAssetSource[]];
  readonly fallback: readonly [FontFallback, ...FontFallback[]];
  readonly display?: "auto" | "block" | "swap" | "fallback" | "optional";
};

export type StrokeTokenValue = {
  readonly width: number;
  readonly line?: "solid" | "dash" | "dot";
  readonly color: OklchColor;
};

export type ShadowLayerTokenValue = {
  readonly x?: number;
  readonly y?: number;
  readonly blur?: number;
  readonly spread?: number;
  readonly color: OklchColor;
  readonly inset?: boolean;
};

export type ShadowTokenValue =
  | "none"
  | ShadowLayerTokenValue
  | readonly [ShadowLayerTokenValue, ...ShadowLayerTokenValue[]];

export type GradientStopTokenValue = {
  readonly at: number;
  readonly color: OklchColor;
};

export type GradientTokenValue =
  | {
      readonly kind: "linear";
      readonly angle?: number;
      readonly stops: readonly [
        GradientStopTokenValue,
        GradientStopTokenValue,
        ...GradientStopTokenValue[],
      ];
    }
  | {
      readonly kind: "radial";
      readonly shape?: "circle" | "ellipse";
      readonly stops: readonly [
        GradientStopTokenValue,
        GradientStopTokenValue,
        ...GradientStopTokenValue[],
      ];
    }
  | {
      readonly kind: "conic";
      readonly angle?: number;
      readonly stops: readonly [
        GradientStopTokenValue,
        GradientStopTokenValue,
        ...GradientStopTokenValue[],
      ];
    };

export type MotionTokenValue =
  | {
      readonly duration: number;
      readonly easing?:
        | "linear"
        | "smooth"
        | "accelerate"
        | "decelerate"
        | { readonly cubic: readonly [number, number, number, number] };
      readonly delay?: number;
    }
  | {
      readonly spring:
        | {
            readonly duration: number;
            readonly bounce?: number;
            readonly mass?: never;
            readonly stiffness?: never;
            readonly damping?: never;
            readonly velocity?: never;
          }
        | {
            readonly duration?: never;
            readonly bounce?: never;
            readonly mass?: number;
            readonly stiffness: number;
            readonly damping: number;
            readonly velocity?: number;
          };
      readonly delay?: number;
    };

export type MetricTokenValue<Kind extends "space" | "size" | "radius" | "blur" | "z"> = {
  readonly kind: Kind;
  readonly value: number;
};

type TokenValueForGroup<Group extends VisualTokenGroup> = Group extends "color"
  ? ColorTokenValue
  : Group extends "space" | "size" | "radius" | "blur" | "z"
    ? MetricTokenValue<Group>
    : Group extends "stroke"
      ? StrokeTokenValue
      : Group extends "shadow"
        ? ShadowTokenValue
        : Group extends "font"
          ? FontTokenValue
          : Group extends "gradient"
            ? GradientTokenValue
            : Group extends "motion"
              ? MotionTokenValue
              : never;

export type Tokens = {
  readonly [Group in VisualTokenGroup]?: Readonly<Record<string, TokenValueForGroup<Group>>>;
};

type TokenValueOfGroup<Tokens, Group extends VisualTokenGroup> = Group extends keyof Tokens
  ? NonNullable<Tokens[Group]> extends infer Values extends object
    ? Values[keyof Values]
    : TokenValueForGroup<Group>
  : TokenValueForGroup<Group>;

type LengthTokenGroup = "space" | "size" | "radius" | "blur";
type LengthToken<Tokens, Group extends LengthTokenGroup> = TokenValueOfGroup<Tokens, Group>;

export type LengthAtom<
  Tokens = Empty,
  _Values = Empty,
  Group extends LengthTokenGroup = "space" | "size",
> = number | LengthToken<Tokens, Group>;

export type LengthValue<
  Tokens = Empty,
  Values = Empty,
  Group extends LengthTokenGroup = "space" | "size",
> =
  | LengthAtom<Tokens, Values, Group>
  | { readonly percent: number }
  | { readonly container: { readonly axis: "inline" | "block"; readonly percent: number } }
  | { readonly viewport: { readonly axis: "inline" | "block"; readonly percent: number } }
  | {
      readonly fluid: {
        readonly min: LengthAtom<Tokens, Values, Group>;
        readonly ideal: LengthAtom<Tokens, Values, Group>;
        readonly max: LengthAtom<Tokens, Values, Group>;
      };
    }
  | {
      readonly add: readonly [LengthAtom<Tokens, Values, Group>, LengthAtom<Tokens, Values, Group>];
    }
  | {
      readonly subtract: readonly [
        LengthAtom<Tokens, Values, Group>,
        LengthAtom<Tokens, Values, Group>,
      ];
    }
  | { readonly multiply: readonly [LengthAtom<Tokens, Values, Group>, number] }
  | { readonly negate: LengthAtom<Tokens, Values, Group> };

export type NumberValue<_Values = Empty> =
  | number
  | { readonly mix: readonly [number, number]; readonly by: number }
  | { readonly clamp: readonly [number, number, number] };

export type ColorValue<Tokens = Empty, _Values = Empty> =
  | OklchColor
  | "transparent"
  | "current"
  | TokenValueOfGroup<Tokens, "color">
  | {
      readonly mix: readonly [
        OklchColor | TokenValueOfGroup<Tokens, "color">,
        OklchColor | TokenValueOfGroup<Tokens, "color">,
      ];
      readonly by: number;
    };

export type PaintValue<Tokens = Empty, Values = Empty> =
  | ColorValue<Tokens, Values>
  | TokenValueOfGroup<Tokens, "gradient">;

type IntrinsicMeasure = "auto" | "content" | "min-content" | "max-content" | "fill";

export type Measure<Tokens = Empty, Values = Empty> =
  | LengthValue<Tokens, Values, "size">
  | IntrinsicMeasure
  | { readonly fraction: number }
  | { readonly fit: LengthAtom<Tokens, Values, "size"> };

type TrackBase<Tokens, Values> =
  | LengthAtom<Tokens, Values, "size">
  | "content"
  | "min-content"
  | "max-content"
  | { readonly fraction: number };

export type GridTrack<Tokens = Empty, Values = Empty> =
  | TrackBase<Tokens, Values>
  | {
      readonly minmax: readonly [TrackBase<Tokens, Values>, TrackBase<Tokens, Values>];
    }
  | {
      readonly repeat: {
        readonly count: number | "fit" | "fill";
        readonly track: TrackBase<Tokens, Values>;
      };
    };

type FlowVisual<Tokens = Empty, Values = Empty> = {
  readonly axis: "inline" | "block";
  readonly gap?: LengthValue<Tokens, Values, "space">;
  readonly align?: "start" | "center" | "end" | "stretch" | "baseline";
  readonly distribute?: "start" | "center" | "end" | "between" | "around" | "evenly";
  readonly wrap?: boolean;
  readonly reverse?: boolean;
};

type GridVisual<Tokens = Empty, Values = Empty> = {
  readonly columns?: readonly GridTrack<Tokens, Values>[];
  readonly rows?: readonly GridTrack<Tokens, Values>[];
  readonly gap?: LengthValue<Tokens, Values, "space">;
  readonly columnGap?: LengthValue<Tokens, Values, "space">;
  readonly rowGap?: LengthValue<Tokens, Values, "space">;
  readonly align?: "start" | "center" | "end" | "stretch" | "baseline";
  readonly distribute?: "start" | "center" | "end" | "between" | "around" | "evenly";
  readonly autoFlow?: "row" | "column" | "dense-row" | "dense-column";
  readonly subgrid?: "columns" | "rows" | "both";
};

type OverlayVisual = {
  readonly align?: "start" | "center" | "end" | "stretch";
  readonly distribute?: "start" | "center" | "end" | "stretch";
};

export type FrameVisual<Tokens = Empty, Values = Empty> = {
  readonly inline?:
    | Measure<Tokens, Values>
    | {
        readonly min?: Measure<Tokens, Values>;
        readonly max?: Measure<Tokens, Values>;
      };
  readonly block?:
    | Measure<Tokens, Values>
    | {
        readonly min?: Measure<Tokens, Values>;
        readonly max?: Measure<Tokens, Values>;
      };
  readonly aspect?: number;
  readonly contain?: "none" | "layout" | "paint" | "strict";
  readonly visibility?: "auto" | "visible" | "deferred";
};

type GridLine = number | { readonly from: number; readonly to: number } | { readonly span: number };

export type PlaceVisual<Tokens = Empty, Values = Empty> = {
  readonly align?: "auto" | "start" | "center" | "end" | "stretch" | "baseline";
  readonly distribute?: "auto" | "start" | "center" | "end" | "stretch";
  readonly order?: number;
  readonly flex?: {
    readonly grow?: number;
    readonly shrink?: number;
    readonly basis?: Measure<Tokens, Values>;
  };
  readonly grid?: {
    readonly column?: GridLine;
    readonly row?: GridLine;
  };
  readonly overlay?: boolean;
};

export type LogicalSpace<Tokens = Empty, Values = Empty> =
  | LengthValue<Tokens, Values, "space">
  | {
      readonly inline?: LengthValue<Tokens, Values, "space">;
      readonly block?: LengthValue<Tokens, Values, "space">;
      readonly inlineStart?: LengthValue<Tokens, Values, "space">;
      readonly inlineEnd?: LengthValue<Tokens, Values, "space">;
      readonly blockStart?: LengthValue<Tokens, Values, "space">;
      readonly blockEnd?: LengthValue<Tokens, Values, "space">;
    };

type TextVisual<Tokens = Empty, Values = Empty> = {
  readonly font?: TokenValueOfGroup<Tokens, "font">;
  readonly size?: LengthValue<Tokens, Values, "size">;
  readonly weight?: number;
  readonly line?: number | LengthValue<Tokens, Values, "size">;
  readonly tracking?: LengthValue<Tokens, Values, "space">;
  readonly align?: "start" | "center" | "end" | "justify";
  readonly transform?: "none" | "uppercase" | "lowercase" | "capitalize";
  readonly wrap?: "wrap" | "nowrap" | "balance" | "pretty";
  readonly overflow?: "clip" | "ellipsis";
  readonly lines?: number;
  readonly decoration?: "none" | "underline" | "strike";
  readonly smoothing?: "auto" | "grayscale";
  readonly features?: Readonly<Record<string, boolean | number>>;
};

type MediaVisual = {
  readonly fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  readonly position?: {
    readonly inline: number;
    readonly block: number;
  };
  readonly rendering?: "auto" | "crisp" | "pixelated";
};

type StrokeLine<Tokens, Values> = {
  readonly width?: LengthValue<Tokens, Values, "size">;
  readonly line?: "none" | "solid" | "dash" | "dot";
  readonly color?: ColorValue<Tokens, Values>;
};

type StrokeAlignment = "inside" | "center" | "outside";

type StrokeVisual<Tokens = Empty, Values = Empty> =
  | (StrokeLine<Tokens, Values> & { readonly alignment?: StrokeAlignment })
  | {
      readonly all?: StrokeLine<Tokens, Values>;
      readonly inlineStart?: StrokeLine<Tokens, Values>;
      readonly inlineEnd?: StrokeLine<Tokens, Values>;
      readonly blockStart?: StrokeLine<Tokens, Values>;
      readonly blockEnd?: StrokeLine<Tokens, Values>;
      readonly alignment?: StrokeAlignment;
    }
  | TokenValueOfGroup<Tokens, "stroke">
  | {
      readonly value: TokenValueOfGroup<Tokens, "stroke">;
      readonly alignment?: StrokeAlignment;
    };

type CornerVisual<Tokens, Values> = {
  readonly radius: LengthValue<Tokens, Values, "radius">;
  readonly continuity?: number;
  readonly preserveContinuity?: boolean;
};

export type ShapeVisual<Tokens = Empty, Values = Empty> = {
  readonly radius?:
    | LengthValue<Tokens, Values, "radius">
    | {
        readonly startStart?: LengthValue<Tokens, Values, "radius">;
        readonly startEnd?: LengthValue<Tokens, Values, "radius">;
        readonly endStart?: LengthValue<Tokens, Values, "radius">;
        readonly endEnd?: LengthValue<Tokens, Values, "radius">;
      };
  readonly corners?:
    | CornerVisual<Tokens, Values>
    | {
        readonly startStart?: CornerVisual<Tokens, Values>;
        readonly startEnd?: CornerVisual<Tokens, Values>;
        readonly endStart?: CornerVisual<Tokens, Values>;
        readonly endEnd?: CornerVisual<Tokens, Values>;
      };
  readonly clip?:
    | "none"
    | "content"
    | { readonly circle: number }
    | { readonly inset: LogicalSpace<Tokens, Values> };
  readonly mask?: TokenValueOfGroup<Tokens, "gradient">;
};

type EffectVisual<Tokens = Empty, Values = Empty> = {
  readonly opacity?: NumberValue<Values>;
  readonly shadow?: TokenValueOfGroup<Tokens, "shadow"> | "none";
  readonly blur?: LengthValue<Tokens, Values, "blur">;
  readonly backdrop?: {
    readonly blur?: LengthValue<Tokens, Values, "blur">;
    readonly saturation?: number;
    readonly brightness?: number;
  };
  readonly brightness?: number;
  readonly contrast?: number;
  readonly saturation?: number;
  readonly blend?: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
};

type PositionVisual<Tokens = Empty, Values = Empty> = {
  readonly kind: "relative" | "absolute" | "fixed" | "sticky";
  readonly inset?: LogicalSpace<Tokens, Values>;
  readonly layer?: number | TokenValueOfGroup<Tokens, "z">;
  readonly place?: "auto" | "center" | "block-start" | "block-end" | "inline-start" | "inline-end";
};

type ScrollVisual = {
  readonly inline?: "visible" | "clip" | "scroll" | "auto";
  readonly block?: "visible" | "clip" | "scroll" | "auto";
  readonly overscroll?: "auto" | "contain" | "none";
  readonly snap?: "none" | "inline" | "block" | "both";
  readonly snapAlign?: "none" | "start" | "center" | "end";
  readonly gutter?: "auto" | "stable" | "stable-both";
  readonly scrollbar?: "auto" | "thin" | "hidden";
};

type InteractionVisual<Tokens = Empty, Values = Empty> = {
  readonly cursor?: "auto" | "default" | "pointer" | "text" | "grab" | "grabbing" | "resize";
  readonly select?: "auto" | "none" | "text" | "all";
  readonly touch?: "auto" | "none" | "pan-inline" | "pan-block" | "manipulation";
  readonly pointer?: "auto" | "none";
  readonly caret?: ColorValue<Tokens, Values>;
  readonly focusRing?:
    | "none"
    | {
        readonly color: ColorValue<Tokens, Values>;
        readonly width: LengthValue<Tokens, Values, "size">;
        readonly offset?: LengthValue<Tokens, Values, "space">;
      };
};

export type CollectionVisual<Tokens = Empty> = {
  readonly axis?: "block" | "inline";
  readonly estimate:
    | number
    | TokenValueOfGroup<Tokens, "size">
    | TokenValueOfGroup<Tokens, "space">;
  readonly gap?: number | TokenValueOfGroup<Tokens, "space">;
  readonly lanes?: number;
};

export type LayoutVisual<Tokens = Empty, Values = Empty> = {
  readonly flow?: FlowVisual<Tokens, Values>;
  readonly grid?: GridVisual<Tokens, Values>;
  readonly overlay?: OverlayVisual;
  readonly display?: "visible" | "contents" | "hidden";
  readonly size?: FrameVisual<Tokens, Values>;
  readonly item?: PlaceVisual<Tokens, Values>;
  readonly padding?: LogicalSpace<Tokens, Values>;
  readonly margin?: LogicalSpace<Tokens, Values>;
  readonly position?: PositionVisual<Tokens, Values>;
  readonly scroll?: ScrollVisual;
  readonly collection?: CollectionVisual<Tokens>;
};

export type PaintVisual<Tokens = Empty, Values = Empty> = {
  readonly fill?: PaintValue<Tokens, Values>;
  readonly stroke?: StrokeVisual<Tokens, Values>;
  readonly opacity?: NumberValue<Values>;
  readonly shadow?: TokenValueOfGroup<Tokens, "shadow"> | "none";
  readonly blur?: LengthValue<Tokens, Values, "blur">;
  readonly backdrop?: EffectVisual<Tokens, Values>["backdrop"];
  readonly brightness?: number;
  readonly contrast?: number;
  readonly saturation?: number;
  readonly blend?: EffectVisual<Tokens, Values>["blend"];
  readonly media?: MediaVisual;
  readonly cursor?: InteractionVisual<Tokens, Values>["cursor"];
  readonly select?: InteractionVisual<Tokens, Values>["select"];
  readonly caret?: InteractionVisual<Tokens, Values>["caret"];
  readonly focusRing?: InteractionVisual<Tokens, Values>["focusRing"];
};

export type TypographyVisual<Tokens = Empty, Values = Empty> = TextVisual<Tokens, Values> & {
  readonly color?: ColorValue<Tokens, Values>;
};

type MotionRef<Tokens> = TokenValueOfGroup<Tokens, "motion">;
export type MotionTargetVisual<Tokens = Empty, Values = Empty> = {
  readonly opacity?: NumberValue<Values>;
  readonly inline?: LengthValue<Tokens, Values, "size">;
  readonly block?: LengthValue<Tokens, Values, "size">;
  readonly depth?: LengthValue<Tokens, Values, "size">;
  readonly scale?: NumberValue<Values>;
  readonly scaleInline?: NumberValue<Values>;
  readonly scaleBlock?: NumberValue<Values>;
  readonly rotate?: number;
};

export type MotionVisual<Tokens = Empty, Values = Empty> = {
  /** Stable identity is only needed when motion crosses structural Element boundaries. */
  readonly identity?: string;
  readonly opacity?: MotionTargetVisual<Tokens, Values>["opacity"];
  readonly translation?: {
    readonly inline?: MotionTargetVisual<Tokens, Values>["inline"];
    readonly block?: MotionTargetVisual<Tokens, Values>["block"];
    readonly depth?: MotionTargetVisual<Tokens, Values>["depth"];
  };
  readonly scale?: MotionTargetVisual<Tokens, Values>["scale"];
  readonly scaleInline?: MotionTargetVisual<Tokens, Values>["scaleInline"];
  readonly scaleBlock?: MotionTargetVisual<Tokens, Values>["scaleBlock"];
  readonly rotate?: MotionTargetVisual<Tokens, Values>["rotate"];
  readonly presence?: {
    readonly visible?: boolean;
    readonly enter?: {
      readonly from: MotionTargetVisual<Tokens, Values>;
    };
    readonly exit?: {
      readonly to: MotionTargetVisual<Tokens, Values>;
    };
    readonly transition?: MotionRef<Tokens> | "instant";
    readonly layout?: "preserve" | "pop";
  };
  readonly transition?: Partial<Record<"opacity" | "transform", MotionRef<Tokens>>>;
  readonly layout?: MotionRef<Tokens>;
  readonly reduceMotion?: "instant" | "crossfade";
};

export type DecorationsVisual<Tokens = Empty, Values = Empty> = {
  readonly background?: VisualFragment<Tokens, Values>;
  readonly overlay?: VisualFragment<Tokens, Values>;
  readonly backdrop?: VisualFragment<Tokens, Values>;
  readonly placeholder?: VisualFragment<Tokens, Values>;
  readonly selection?: VisualFragment<Tokens, Values>;
  readonly track?: VisualFragment<Tokens, Values>;
  readonly thumb?: VisualFragment<Tokens, Values>;
};

export type VisualFragment<Tokens = Empty, Values = Empty> = {
  readonly layout?: LayoutVisual<Tokens, Values>;
  readonly shape?: ShapeVisual<Tokens, Values>;
  readonly paint?: PaintVisual<Tokens, Values>;
  readonly typography?: TypographyVisual<Tokens, Values>;
  readonly motion?: MotionVisual<Tokens, Values>;
  readonly decorations?: DecorationsVisual<Tokens, Values>;
};

export type WebImageResource = Readonly<{
  kind: "image";
  source: string;
  density?: number;
}>;

export type WebSymbolResource = Readonly<{
  kind: "symbol";
  source: string;
}>;

export type WebShaderResource = Readonly<{
  kind: "shader";
  source: string;
}>;

export type WebPresentationResource = WebImageResource | WebSymbolResource | WebShaderResource;

export type WebPresentationTokens = Tokens &
  Readonly<{
    resources?: Readonly<Record<string, WebPresentationResource>>;
  }>;

type WebThemeResource<Theme extends WebPresentationTokens> = NonNullable<
  Theme["resources"]
>[keyof NonNullable<Theme["resources"]>];

export type WebRenderLayer<Theme extends WebPresentationTokens> = Readonly<{
  id: string;
  placement: "background" | "overlay";
  visual?: VisualFragment<Theme>;
  resource?: WebThemeResource<Theme>;
  uniforms?: Readonly<Record<string, number | readonly number[]>>;
}>;

type WebPositionVisual<Theme extends WebPresentationTokens> = NonNullable<
  LayoutVisual<Theme>["position"]
> &
  Readonly<{
    anchor?: PresentationTarget;
  }>;

export type WebMotionTarget<Theme extends WebPresentationTokens> = Readonly<{
  target: number;
  transition: "instant" | TokenValueOfGroup<Theme, "motion">;
  velocity?: number;
}>;

export type WebMotionValue<Theme extends WebPresentationTokens> = number | WebMotionTarget<Theme>;

export type WebMotionDeclaration<Theme extends WebPresentationTokens> = Readonly<{
  identity?: string;
  opacity?: WebMotionValue<Theme>;
  translation?: Readonly<{
    inline?: WebMotionValue<Theme>;
    block?: WebMotionValue<Theme>;
    depth?: WebMotionValue<Theme>;
  }>;
  scale?: WebMotionValue<Theme>;
  scaleInline?: WebMotionValue<Theme>;
  scaleBlock?: WebMotionValue<Theme>;
  rotate?: WebMotionValue<Theme>;
  radius?: WebMotionValue<Theme>;
  layout?: "instant" | TokenValueOfGroup<Theme, "motion">;
  presence?: Readonly<{
    visible: boolean | "structure";
    enter?: Readonly<{ from: MotionTargetVisual<Theme> }>;
    exit?: Readonly<{ to: MotionTargetVisual<Theme> }>;
    transition?: "instant" | TokenValueOfGroup<Theme, "motion">;
    layout?: "preserve" | "pop";
  }>;
  reduceMotion?: "instant" | "crossfade";
}>;

type WebPresentationFragment<Theme extends WebPresentationTokens> = Omit<
  VisualFragment<Theme>,
  "layout" | "motion"
> &
  Readonly<{
    layout?: Omit<LayoutVisual<Theme>, "position"> & {
      readonly position?: WebPositionVisual<Theme>;
    };
    motion?: WebMotionDeclaration<Theme>;
    resource?: WebThemeResource<Theme>;
    layers?: readonly WebRenderLayer<Theme>[];
  }>;

export type WebTargetCondition = "hovered" | "pressed" | "focusVisible" | "disabled";

type WebConditionRange<Theme extends WebPresentationTokens> = Readonly<{
  min?: LengthAtom<Theme, Empty, "size">;
  max?: LengthAtom<Theme, Empty, "size">;
}>;

/** Web observations that an adapter may allocate for a declaration rule. */
export type WebPresentationCondition<Theme extends WebPresentationTokens> = Readonly<{
  target?: Readonly<Partial<Record<WebTargetCondition, boolean>>>;
  container?: Readonly<{
    inline?: WebConditionRange<Theme>;
    block?: WebConditionRange<Theme>;
  }>;
  preferences?: Readonly<{
    reducedMotion?: boolean;
    moreContrast?: boolean;
    forcedColors?: boolean;
    dark?: boolean;
  }>;
  pointer?: Readonly<{
    hover?: boolean;
    fine?: boolean;
    coarse?: boolean;
  }>;
}>;

/** A target-local visual override driven by native web state. */
export type WebPresentationConditionDeclaration<Theme extends WebPresentationTokens> =
  WebPresentationFragment<Theme>;

export type WebPresentationConditionRule<Theme extends WebPresentationTokens> = Readonly<{
  when: WebPresentationCondition<Theme>;
  use: WebPresentationConditionDeclaration<Theme>;
}>;

/** The complete semantic visual declaration understood by the web adapter. */
export type WebPresentationDeclaration<Theme extends WebPresentationTokens> =
  WebPresentationFragment<Theme> &
    Readonly<{
      conditions?: readonly WebPresentationConditionRule<Theme>[];
    }>;

export type WebPresentationLanguage<Theme extends WebPresentationTokens> = {
  readonly Declaration: WebPresentationDeclaration<Theme>;
};

/** A web Presentation uses the generic outer grammar and the web declaration algebra. */
export type WebPresentation<
  Root extends ComponentOwner,
  Theme extends WebPresentationTokens,
> = CorePresentation<Root, WebPresentationLanguage<Theme>, Theme>;
