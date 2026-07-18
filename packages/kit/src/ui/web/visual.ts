import type { DragRelease, DragSample } from "#ui/web/drag";

import type {
  ApplicationContract as AppSpec,
  FeatureContract as FeatureSpec,
  PresentationName,
  UIState,
} from "../../application";
import type {
  ComponentActionArgs,
  ComponentActions,
  ComponentName,
  ComponentOwner,
  ComponentParameters,
  ComponentPartName,
  ComponentState,
  ComponentStateKinds,
} from "../component";
import type { Presentation as CorePresentation, PresentationPartReference } from "../presentation";

type AnyRecord = Record<string, unknown>;
type Empty = Record<never, never>;

type PresentationsOf<Spec extends AppSpec> = Spec extends {
  Presentations: infer Presentations;
}
  ? Presentations
  : "default";

type FeatureChildrenOf<Feature extends FeatureSpec> = Feature extends {
  Features: infer Features extends Record<string, FeatureSpec>;
}
  ? Features
  : Empty;

type FeatureRuntimeSpec<App extends AppSpec, Feature extends FeatureSpec> = Feature & {
  Presentations: App extends { Presentations: infer Presentations } ? Presentations : "default";
};

export type VisualPresentationName<Spec extends AppSpec> = PresentationName<Spec>;

type PresentationContract<Spec extends AppSpec, Name extends VisualPresentationName<Spec>> =
  PresentationsOf<Spec> extends AnyRecord
    ? Name extends keyof PresentationsOf<Spec>
      ? PresentationsOf<Spec>[Name] extends AnyRecord
        ? PresentationsOf<Spec>[Name]
        : Empty
      : Empty
    : Empty;

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

export type VisualTokenContract = Partial<Record<VisualTokenGroup, string>>;

type TokenContractFor<Spec extends AppSpec, Name extends VisualPresentationName<Spec>> =
  PresentationContract<Spec, Name> extends {
    Tokens: infer Contract extends VisualTokenContract;
  }
    ? Contract
    : Empty;

type NamesForGroup<Contract, Group extends VisualTokenGroup> = Group extends keyof Contract
  ? Extract<Contract[Group], string>
  : never;

declare const visualToken: unique symbol;
declare const visualValue: unique symbol;

export type VisualTokenRef<
  Group extends VisualTokenGroup = VisualTokenGroup,
  Name extends string = string,
> = {
  readonly [visualToken]: {
    readonly group: Group;
    readonly name: Name;
  };
};

export type VisualValueKind =
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "length"
  | "angle"
  | "time"
  | "zIndex"
  | "space"
  | "size"
  | "radius";

export type VisualValueRef<
  Kind extends VisualValueKind = VisualValueKind,
  Name extends string = string,
> = {
  readonly value: Name;
  readonly [visualValue]?: Kind;
};

type ValueRefOfKind<Values, Kind extends VisualValueKind> = Values[keyof Values] extends infer Ref
  ? Ref extends VisualValueRef<infer Current, string>
    ? Current extends Kind
      ? Ref
      : never
    : never
  : never;

type TokenRefOfGroup<Tokens, Group extends VisualTokenGroup> =
  | VisualTokenRef<Group>
  | (Group extends keyof Tokens
      ? NonNullable<Tokens[Group]> extends infer Values extends object
        ? Values[keyof Values]
        : never
      : never);

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
  | "none"
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

type VisualTokenDefinition<Contract, Group extends VisualTokenGroup> =
  | TokenValueForGroup<Group>
  | {
      readonly token: NamesForGroup<Contract, Group>;
    };

export type Tokens = {
  readonly [Group in VisualTokenGroup]?: Readonly<
    Record<string, TokenValueForGroup<Group> | { readonly token: string }>
  >;
};

type ThemeValue<Value> = Value extends number
  ? number
  : Value extends string
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly ThemeValue<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]?: ThemeValue<Value[Key]> }
        : Value;

export type PresentationTokens<Spec extends AppSpec, Name extends VisualPresentationName<Spec>> = {
  readonly [Group in keyof TokenContractFor<Spec, Name> & VisualTokenGroup]: {
    readonly [Token in NamesForGroup<TokenContractFor<Spec, Name>, Group>]: VisualTokenDefinition<
      TokenContractFor<Spec, Name>,
      Group
    >;
  };
};

export type VisualTokenRefs<Spec extends AppSpec, Name extends VisualPresentationName<Spec>> = {
  readonly [Group in keyof TokenContractFor<Spec, Name> & VisualTokenGroup]: {
    readonly [Token in NamesForGroup<
      TokenContractFor<Spec, Name>,
      Group
    >]: TokenValueForGroup<Group>;
  };
};

export type PresentationTokenRefs<
  Spec extends AppSpec,
  Name extends VisualPresentationName<Spec>,
> = {
  readonly [Group in keyof TokenContractFor<Spec, Name> & VisualTokenGroup]: {
    readonly [Token in NamesForGroup<TokenContractFor<Spec, Name>, Group>]: VisualTokenRef<
      Group,
      Token
    >;
  };
};

type TokenRefsFor<TokenSet extends Tokens> = {
  readonly [Group in keyof TokenSet & VisualTokenGroup]: {
    readonly [Token in keyof NonNullable<TokenSet[Group]> & string]: VisualTokenRef<Group, Token>;
  };
};

type LengthTokenGroup = "space" | "size" | "radius" | "blur";
type LengthToken<Tokens, Group extends LengthTokenGroup> = Group extends LengthTokenGroup
  ? TokenRefOfGroup<Tokens, Group>
  : never;

type LengthValueRef<Values, Group extends LengthTokenGroup> = ValueRefOfKind<
  Values,
  "length" | (Group extends "space" | "size" | "radius" ? Group : never)
>;
type NumberValueRef<Values> = ValueRefOfKind<Values, "number" | "ratio" | "progress">;
type OpacityValueRef<Values> = ValueRefOfKind<Values, "opacity" | "progress">;
type AngleValueRef<Values> = ValueRefOfKind<Values, "angle">;

export type LengthAtom<
  Tokens = Empty,
  Values = Empty,
  Group extends LengthTokenGroup = "space" | "size",
> = number | LengthToken<Tokens, Group> | LengthValueRef<Values, Group>;

export type LengthValue<
  Tokens = Empty,
  Values = Empty,
  Group extends LengthTokenGroup = "space" | "size",
> =
  | LengthAtom<Tokens, Values, Group>
  | { readonly percent: number }
  | {
      readonly container: {
        readonly axis: "inline" | "block";
        readonly percent: number;
      };
    }
  | {
      readonly viewport: {
        readonly axis: "inline" | "block";
        readonly percent: number;
      };
    }
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
  | {
      readonly multiply: readonly [
        LengthAtom<Tokens, Values, Group>,
        number | NumberValueRef<Values>,
      ];
    }
  | { readonly negate: LengthAtom<Tokens, Values, Group> };

export type NumberValue<Values = Empty> =
  | number
  | NumberValueRef<Values>
  | {
      readonly mix: readonly [number | NumberValueRef<Values>, number | NumberValueRef<Values>];
      readonly by: number | ValueRefOfKind<Values, "progress" | "ratio">;
    }
  | {
      readonly clamp: readonly [
        number | NumberValueRef<Values>,
        number | NumberValueRef<Values>,
        number | NumberValueRef<Values>,
      ];
    };

export type ColorValue<Tokens = Empty, Values = Empty> =
  | OklchColor
  | "transparent"
  | "current"
  | TokenRefOfGroup<Tokens, "color">
  | {
      readonly mix: readonly [
        OklchColor | TokenRefOfGroup<Tokens, "color">,
        OklchColor | TokenRefOfGroup<Tokens, "color">,
      ];
      readonly by: number | ValueRefOfKind<Values, "progress" | "ratio">;
    };

export type PaintValue<Tokens = Empty, Values = Empty> =
  | ColorValue<Tokens, Values>
  | TokenRefOfGroup<Tokens, "gradient">;

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
  readonly font?: TokenRefOfGroup<Tokens, "font">;
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
  | TokenRefOfGroup<Tokens, "stroke">
  | {
      readonly value: TokenRefOfGroup<Tokens, "stroke">;
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
  readonly mask?: TokenRefOfGroup<Tokens, "gradient">;
};

type EffectVisual<Tokens = Empty, Values = Empty> = {
  readonly opacity?: NumberValue<Values> | OpacityValueRef<Values>;
  readonly shadow?: TokenRefOfGroup<Tokens, "shadow"> | "none";
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
  readonly layer?: number | TokenRefOfGroup<Tokens, "z">;
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
  readonly estimate: number | TokenRefOfGroup<Tokens, "size"> | TokenRefOfGroup<Tokens, "space">;
  readonly gap?: number | TokenRefOfGroup<Tokens, "space">;
  readonly lanes?: number;
};

export type LayoutVisual<Tokens = Empty, Values = Empty> = {
  readonly flow?: FlowVisual<Tokens, Values>;
  readonly grid?: GridVisual<Tokens, Values>;
  readonly overlay?: OverlayVisual;
  readonly display?: "contents" | "hidden";
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
  readonly opacity?: NumberValue<Values> | OpacityValueRef<Values>;
  readonly shadow?: TokenRefOfGroup<Tokens, "shadow"> | "none";
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

type MotionRef<Tokens> = TokenRefOfGroup<Tokens, "motion">;
export type MotionTargetVisual<Tokens = Empty, Values = Empty> = {
  readonly opacity?: NumberValue<Values>;
  readonly inline?: LengthValue<Tokens, Values, "size">;
  readonly block?: LengthValue<Tokens, Values, "size">;
  readonly depth?: LengthValue<Tokens, Values, "size">;
  readonly scale?: NumberValue<Values>;
  readonly scaleInline?: NumberValue<Values>;
  readonly scaleBlock?: NumberValue<Values>;
  readonly rotate?: number | AngleValueRef<Values>;
};

export type MotionVisual<Tokens = Empty, Values = Empty> = {
  /** Stable identity is only needed when motion crosses structural Part boundaries. */
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

type ScopedVisualFragment<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Tokens,
  Values,
> = Omit<VisualFragment<Tokens, Values>, "layout"> & {
  readonly layout?: Omit<LayoutVisual<Tokens, Values>, "position"> & {
    readonly position?: PositionVisual<Tokens, Values> & {
      readonly anchor?: "none" | { readonly part: ComponentPartName<Spec, Component> };
    };
  };
};

declare const visualExpression: unique symbol;
declare const visualRecipeResult: unique symbol;

export type VisualExpression<Value> = {
  readonly [visualExpression]: Value;
  is(value: Value): VisualConditionValue;
};

export type VisualConditionValue = VisualExpression<boolean> & {
  and(...conditions: readonly VisualConditionValue[]): VisualConditionValue;
  or(...conditions: readonly VisualConditionValue[]): VisualConditionValue;
  not(): VisualConditionValue;
  choose(truthy: number, falsy: number): VisualNumberExpression;
  choose<Kind extends VisualValueKind>(
    truthy: number | VisualNumberExpression<Kind>,
    falsy: number | VisualNumberExpression<Kind>,
  ): VisualNumberExpression<Kind>;
  choose<Truthy, Falsy>(truthy: Truthy, falsy: Falsy): VisualExpression<Truthy | Falsy>;
};

type VisualNumberOperand =
  | number
  | VisualExpression<number>
  | VisualTokenRef<"space" | "size" | "radius" | "blur", string>;

export type VisualNumberExpression<Kind extends VisualValueKind = "number"> =
  VisualExpression<number> &
    VisualValueRef<Kind, string> & {
      isAbove(value: VisualNumberOperand): VisualConditionValue;
      isAtLeast(value: VisualNumberOperand): VisualConditionValue;
      isBelow(value: VisualNumberOperand): VisualConditionValue;
      isAtMost(value: VisualNumberOperand): VisualConditionValue;
      isEqual(value: VisualNumberOperand): VisualConditionValue;
    };

type ReactiveValue<Value> = [Value] extends [boolean]
  ? VisualConditionValue
  : [Value] extends [number]
    ? VisualNumberExpression
    : VisualExpression<Value>;

type ProcessScopeState<Spec extends FeatureSpec> = {
  readonly [Name in keyof UIState<Spec>]: ReactiveValue<UIState<Spec>[Name]>;
};

type ComponentScopeState<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Name in keyof ComponentState<Spec, Component>]: Name extends keyof ComponentStateKinds<
    Spec,
    Component
  >
    ? VisualNumberExpression<ComponentStateKinds<Spec, Component>[Name] & VisualValueKind>
    : ReactiveValue<ComponentState<Spec, Component>[Name]>;
};

declare const visualEventReference: unique symbol;
declare const visualPartReference: unique symbol;

export type VisualActionReference<Action> = {
  readonly [visualEventReference]: Action;
};

export type VisualPartReference<Part extends string> = {
  readonly [visualPartReference]: Part;
};

type ComponentActionReferenceForArgs<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Args extends readonly unknown[],
> = {
  [Action in keyof ComponentActions<Spec, Component>]: ComponentActionArgs<
    ComponentActions<Spec, Component>[Action]
  > extends Args
    ? VisualActionReference<ComponentActions<Spec, Component>[Action]>
    : never;
}[keyof ComponentActions<Spec, Component>];

type PresentationDragInteraction<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly type: "drag";
  readonly trigger: VisualPartReference<ComponentPartName<Spec, Component>>;
  readonly axis: "inline" | "block" | "both";
  readonly enabled?: VisualConditionValue;
  readonly bounds: {
    readonly inline?: readonly [
      number | VisualNumberExpression<VisualValueKind>,
      number | VisualNumberExpression<VisualValueKind>,
    ];
    readonly block?: readonly [
      number | VisualNumberExpression<VisualValueKind>,
      number | VisualNumberExpression<VisualValueKind>,
    ];
  };
  readonly threshold?: number | VisualNumberExpression<VisualValueKind>;
  readonly maxVelocity?: number | VisualNumberExpression<VisualValueKind>;
  readonly resistance?: number | VisualNumberExpression<VisualValueKind>;
  readonly cursor?: { readonly idle: string; readonly active: string } | false;
  readonly start?: ComponentActionReferenceForArgs<Spec, Component, readonly []>;
  readonly change: ComponentActionReferenceForArgs<Spec, Component, readonly [DragSample]>;
  readonly release: ComponentActionReferenceForArgs<Spec, Component, readonly [DragRelease]>;
  readonly cancel?: ComponentActionReferenceForArgs<Spec, Component, readonly []>;
};

type PresentationCompletion<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly when: VisualConditionValue;
  readonly action: ComponentActionReferenceForArgs<Spec, Component, readonly []>;
};

type PresentationParameterValue<Value> = Value extends number
  ? Value | VisualNumberExpression
  : Value extends boolean
    ? Value | VisualConditionValue
    : Value | VisualExpression<Value>;

type PresentationParameterResult<Spec extends AppSpec, Component extends ComponentName<Spec>> = [
  keyof ComponentParameters<Spec, Component>,
] extends [never]
  ? { readonly parameters?: never }
  : {
      readonly parameters: {
        readonly [Name in keyof ComponentParameters<Spec, Component>]: PresentationParameterValue<
          ComponentParameters<Spec, Component>[Name]
        >;
      };
    };

type VisualInteractionScope = {
  readonly hovered: VisualConditionValue;
  readonly pressed: VisualConditionValue;
  readonly focusVisible: VisualConditionValue;
  readonly focusWithin: VisualConditionValue;
  readonly selected: VisualConditionValue;
  readonly disabled: VisualConditionValue;
  readonly expanded: VisualConditionValue;
};

type VisualGeometryScope = {
  readonly inlineSize: VisualNumberExpression<"size">;
  readonly blockSize: VisualNumberExpression<"size">;
};

type VisualEnvironmentScope = {
  readonly reducedMotion: VisualConditionValue;
  readonly moreContrast: VisualConditionValue;
  readonly forcedColors: VisualConditionValue;
  readonly dark: VisualConditionValue;
  readonly hover: VisualConditionValue;
  readonly finePointer: VisualConditionValue;
  readonly coarsePointer: VisualConditionValue;
};

type AnyVisualExpressions = {
  readonly [Kind in VisualValueKind]: VisualNumberExpression<Kind>;
};

type ReactiveFragment<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  TokenSet extends Tokens,
> = ScopedVisualFragment<Spec, Component, TokenRefsFor<TokenSet>, AnyVisualExpressions> & {
  readonly when?: VisualConditionValue;
};

type RecipeFragment<TokenSet extends Tokens> = VisualFragment<
  TokenRefsFor<TokenSet>,
  AnyVisualExpressions
>;

export type VisualRecipeResult = {
  readonly [visualRecipeResult]: true;
};

type RecipeBranchValue<Branches> = "true" extends keyof Branches
  ? "false" extends keyof Branches
    ? boolean
    : Extract<keyof Branches, string | number>
  : Extract<keyof Branches, string | number>;

type RecipeVariantValues<Variants extends Record<string, Record<PropertyKey, unknown>>> = {
  readonly [Variant in keyof Variants]: RecipeBranchValue<Variants[Variant]>;
};

type RecipeInput<Value> = Value | VisualExpression<Value>;

type RecipeArguments<
  Variants extends Record<string, Record<PropertyKey, unknown>>,
  Defaults extends Partial<RecipeVariantValues<Variants>>,
> = {
  readonly [Variant in Exclude<keyof Variants, keyof Defaults>]: RecipeInput<
    RecipeVariantValues<Variants>[Variant]
  >;
} & {
  readonly [Variant in keyof Defaults & keyof Variants]?: RecipeInput<
    RecipeVariantValues<Variants>[Variant]
  >;
};

type RecipeCombination<Variants extends Record<string, Record<PropertyKey, unknown>>, Fragment> = {
  readonly when: Partial<{
    readonly [Variant in keyof Variants]:
      | RecipeVariantValues<Variants>[Variant]
      | readonly RecipeVariantValues<Variants>[Variant][];
  }>;
  readonly use: Fragment;
};

type CreateRecipe<Fragment> = <
  const Variants extends Record<string, Record<PropertyKey, Fragment>>,
  const Defaults extends Partial<RecipeVariantValues<Variants>> = Empty,
>(definition: {
  readonly base?: Fragment;
  readonly variants: Variants;
  readonly combinations?: readonly RecipeCombination<Variants, Fragment>[];
  readonly defaults?: Defaults;
}) => (values: RecipeArguments<Variants, Defaults>) => VisualRecipeResult;

type InterpolateVisual = <
  OutputKind extends VisualValueKind = "number",
  InputKind extends VisualValueKind = VisualValueKind,
>(
  value: VisualNumberExpression<InputKind>,
  input: readonly [number, number, ...number[]],
  output: readonly [number, number, ...number[]],
) => VisualNumberExpression<OutputKind>;

export type VisualMotionExpression<Kind extends VisualValueKind = "number"> =
  VisualNumberExpression<Kind> & {
    readonly progress: VisualNumberExpression<"progress">;
  };

type CreateMotion<TokenSet extends Tokens> = <Kind extends VisualValueKind = "number">(definition: {
  readonly target: number | VisualNumberExpression<Kind>;
  readonly velocity?: number | VisualNumberExpression;
  readonly transition:
    | "instant"
    | MotionRef<TokenRefsFor<TokenSet>>
    | VisualExpression<
        | "instant"
        | MotionRef<TokenRefsFor<TokenSet>>
        | VisualExpression<MotionRef<TokenRefsFor<TokenSet>>>
      >;
  readonly range: readonly [number, number];
}) => VisualMotionExpression<Kind>;

export type PresentationFactoryContract<
  Spec extends AppSpec,
  Name extends VisualPresentationName<Spec>,
  TokenSet extends Tokens = PresentationTokens<Spec, Name>,
> = {
  readonly tokens: TokenRefsFor<TokenSet>;
  readonly createRecipe: CreateRecipe<RecipeFragment<TokenSet>>;
  readonly createMotion: CreateMotion<TokenSet>;
  readonly interpolate: InterpolateVisual;
};

type ComponentVisualResult<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  TokenSet extends Tokens,
> = {
  readonly [Part in ComponentPartName<Spec, Component>]?:
    | ReactiveFragment<Spec, Component, TokenSet>
    | VisualRecipeResult
    | readonly (
        | ReactiveFragment<Spec, Component, TokenSet>
        | VisualRecipeResult
        | null
        | undefined
      )[];
} & PresentationParameterResult<Spec, Component> & {
    readonly interactions?: readonly PresentationDragInteraction<Spec, Component>[];
    readonly completions?: readonly PresentationCompletion<Spec, Component>[];
    readonly gestures?: never;
  };

export type PresentationComponentScope<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly process: ProcessScopeState<Spec>;
  readonly state: ComponentScopeState<Spec, Component>;
  readonly actions: {
    readonly [Action in keyof ComponentActions<Spec, Component>]: VisualActionReference<
      ComponentActions<Spec, Component>[Action]
    >;
  };
  readonly parts: {
    readonly [Part in ComponentPartName<Spec, Component>]: VisualPartReference<Part>;
  };
  readonly interaction: VisualInteractionScope;
  readonly geometry: VisualGeometryScope;
  readonly environment: VisualEnvironmentScope;
};

export type PresentationFactoryResult<
  Spec extends AppSpec,
  Name extends VisualPresentationName<Spec>,
  TokenSet extends Tokens = PresentationTokens<Spec, Name>,
> = {
  readonly theme: TokenSet;
  readonly themes?: Readonly<Record<string, ThemeValue<TokenSet>>>;
  readonly components: PresentationComponentTree<Spec, Spec, TokenSet>;
};

type PresentationComponentFactories<Spec extends AppSpec, TokenSet extends Tokens> = {
  readonly [Component in ComponentName<Spec>]: (
    scope: PresentationComponentScope<Spec, Component>,
  ) => ComponentVisualResult<Spec, Component, TokenSet>;
};

type PresentationComponentTree<
  App extends AppSpec,
  Owner extends FeatureSpec,
  TokenSet extends Tokens,
> = PresentationComponentFactories<FeatureRuntimeSpec<App, Owner>, TokenSet> & {
  readonly [Name in keyof FeatureChildrenOf<Owner> as Capitalize<
    Extract<Name, string>
  >]: PresentationComponentTree<
    App,
    Extract<FeatureChildrenOf<Owner>[Name], FeatureSpec>,
    TokenSet
  >;
};

export type PresentationFactory<
  Spec extends AppSpec,
  Name extends VisualPresentationName<Spec>,
  TokenSet extends Tokens = PresentationTokens<Spec, Name>,
> = (
  contract: PresentationFactoryContract<Spec, Name, TokenSet>,
) => PresentationFactoryResult<Spec, Name, TokenSet>;

export type Presentation<
  Spec extends AppSpec,
  Name extends VisualPresentationName<Spec>,
  TokenSet extends Tokens = PresentationTokens<Spec, Name>,
> = PresentationFactory<Spec, Name, TokenSet>;

export type WebPresentationContext = Readonly<{
  allocated: Readonly<{
    inlineSize: number;
    blockSize: number;
  }>;
  preferences: Readonly<{
    reducedMotion: boolean;
    moreContrast: boolean;
    forcedColors: boolean;
    dark: boolean;
  }>;
  input: Readonly<{
    hover: boolean;
    finePointer: boolean;
    coarsePointer: boolean;
  }>;
}>;

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

export type WebPresentationTheme = Tokens &
  Readonly<{
    resources?: Readonly<Record<string, WebPresentationResource>>;
  }>;

type WebThemeResource<Theme extends WebPresentationTheme> = NonNullable<
  Theme["resources"]
>[keyof NonNullable<Theme["resources"]>];

export type WebRenderLayer<Theme extends WebPresentationTheme> = Readonly<{
  id: string;
  placement: "background" | "overlay";
  visual?: VisualFragment<Theme>;
  resource?: WebThemeResource<Theme>;
  uniforms?: Readonly<Record<string, number | readonly number[]>>;
}>;

type WebPositionVisual<Theme extends WebPresentationTheme> = NonNullable<
  LayoutVisual<Theme>["position"]
> &
  Readonly<{
    anchor?: PresentationPartReference;
  }>;

export type WebMotionTarget<Theme extends WebPresentationTheme> = Readonly<{
  target: number;
  transition: "instant" | TokenRefOfGroup<Theme, "motion">;
  velocity?: number;
}>;

export type WebMotionValue<Theme extends WebPresentationTheme> = number | WebMotionTarget<Theme>;

export type WebMotionDeclaration<Theme extends WebPresentationTheme> = Readonly<{
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
  layout?: "instant" | TokenRefOfGroup<Theme, "motion">;
  presence?: Readonly<{
    visible: boolean | "structure";
    enter?: Readonly<{ from: MotionTargetVisual<Theme> }>;
    exit?: Readonly<{ to: MotionTargetVisual<Theme> }>;
    transition?: "instant" | TokenRefOfGroup<Theme, "motion">;
    layout?: "preserve" | "pop";
  }>;
  reduceMotion?: "instant" | "crossfade";
}>;

type WebPresentationFragment<Theme extends WebPresentationTheme> = Omit<
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

export type WebPresentationCondition = "hovered" | "pressed" | "focusVisible" | "disabled";

/** A target-local visual override driven by native web state. */
export type WebPresentationConditionDeclaration<Theme extends WebPresentationTheme> =
  WebPresentationFragment<Theme>;

/** The complete semantic visual declaration understood by the web adapter. */
export type WebPresentationDeclaration<Theme extends WebPresentationTheme> =
  WebPresentationFragment<Theme> &
    Readonly<{
      conditions?: Readonly<
        Partial<
          Record<WebPresentationCondition, WebPresentationConditionDeclaration<Theme>>
        >
      >;
    }>;

export type WebPresentationLanguage<Theme extends WebPresentationTheme> = {
  readonly Context: WebPresentationContext;
  readonly Declaration: WebPresentationDeclaration<Theme>;
};

/** A web Presentation uses the generic outer grammar and the web declaration algebra. */
export type WebPresentation<
  Root extends ComponentOwner,
  Theme extends WebPresentationTheme,
> = CorePresentation<Root, WebPresentationLanguage<Theme>, Theme>;
