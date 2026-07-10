import type {
  AppSpec,
  ComponentName,
  ComponentPartName,
  ComponentState,
  ComponentVariants,
} from "./app";

type AnyRecord = Record<string, any>;
type Empty = Record<never, never>;

type StylesOf<Spec extends AppSpec> = Spec extends { Styles: infer Styles extends AnyRecord }
  ? Styles
  : Empty;

type PresetsOf<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Presets: infer Presets;
  }
    ? Presets
    : "default";

export type VisualPresetName<Spec extends AppSpec> =
  PresetsOf<Spec> extends string
    ? PresetsOf<Spec>
    : PresetsOf<Spec> extends AnyRecord
      ? Extract<keyof PresetsOf<Spec>, string>
      : "default";

type PresetContract<Spec extends AppSpec, Name extends VisualPresetName<Spec>> =
  PresetsOf<Spec> extends AnyRecord
    ? Name extends keyof PresetsOf<Spec>
      ? PresetsOf<Spec>[Name] extends AnyRecord
        ? PresetsOf<Spec>[Name]
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

type TokenContractFor<Spec extends AppSpec, Name extends VisualPresetName<Spec>> =
  PresetContract<Spec, Name> extends {
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
  | "time";

export type VisualValueRef<
  Kind extends VisualValueKind = VisualValueKind,
  Name extends string = string,
> = {
  readonly [visualValue]: {
    readonly kind: Kind;
    readonly name: Name;
  };
};

type ComponentValueSchema<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Spec["Components"] extends AnyRecord
  ? Spec["Components"][Component] extends {
      StyleValues: infer Values extends Partial<Record<string, VisualValueKind>>;
    }
    ? Values
    : Empty
  : Empty;

export type VisualValueRefs<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Name in keyof ComponentValueSchema<Spec, Component>]: VisualValueRef<
    ComponentValueSchema<Spec, Component>[Name] & VisualValueKind,
    Name & string
  >;
};

type ValueRefOfKind<Values, Kind extends VisualValueKind> = Values[keyof Values] extends infer Ref
  ? Ref extends VisualValueRef<infer Current, string>
    ? Current extends Kind
      ? Ref
      : never
    : never
  : never;

type TokenRefOfGroup<Tokens, Group extends VisualTokenGroup> = Group extends keyof Tokens
  ? Tokens[Group] extends AnyRecord
    ? Tokens[Group][keyof Tokens[Group]]
    : never
  : never;

export type OklchColor = {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha?: number;
};

export type ColorTokenValue = OklchColor | "transparent" | "current";

export type FontTokenValue = {
  readonly families: readonly [string, ...string[]];
  readonly features?: Readonly<Record<string, boolean | number>>;
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
      readonly easing?: "linear" | "smooth" | "accelerate" | "decelerate";
      readonly delay?: number;
    }
  | {
      readonly spring: {
        readonly duration: number;
        readonly bounce?: number;
      };
      readonly delay?: number;
    };

type TokenValueForGroup<Group extends VisualTokenGroup> = Group extends "color"
  ? ColorTokenValue
  : Group extends "space" | "size" | "radius" | "blur" | "z"
    ? number
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

export type VisualTokenDefinitions<Spec extends AppSpec, Name extends VisualPresetName<Spec>> = {
  readonly [Group in keyof TokenContractFor<Spec, Name> & VisualTokenGroup]: {
    readonly [Token in NamesForGroup<TokenContractFor<Spec, Name>, Group>]: VisualTokenDefinition<
      TokenContractFor<Spec, Name>,
      Group
    >;
  };
};

export type VisualTokenRefs<Spec extends AppSpec, Name extends VisualPresetName<Spec>> = {
  readonly [Group in keyof TokenContractFor<Spec, Name> & VisualTokenGroup]: {
    readonly [Token in NamesForGroup<TokenContractFor<Spec, Name>, Group>]: VisualTokenRef<
      Group,
      Token
    >;
  };
};

type ThemeNameFor<Spec extends AppSpec, Name extends VisualPresetName<Spec>> =
  PresetContract<Spec, Name> extends {
    Themes: infer Themes extends string;
  }
    ? Themes
    : "default";

type ContainerNameFor<Spec extends AppSpec, Name extends VisualPresetName<Spec>> =
  PresetContract<Spec, Name> extends {
    Containers: infer Containers extends string;
  }
    ? Containers
    : never;

type PartialTokenDefinitions<Spec extends AppSpec, Name extends VisualPresetName<Spec>> = {
  readonly [Group in keyof VisualTokenDefinitions<Spec, Name>]?: Partial<
    VisualTokenDefinitions<Spec, Name>[Group]
  >;
};

export type VisualThemeDefinitions<Spec extends AppSpec, Name extends VisualPresetName<Spec>> = {
  readonly [Theme in ThemeNameFor<Spec, Name>]: PartialTokenDefinitions<Spec, Name>;
};

export type VisualContainerDefinitions<
  Spec extends AppSpec,
  Name extends VisualPresetName<Spec>,
> = {
  readonly [Container in ContainerNameFor<Spec, Name>]:
    | { readonly inlineBelow: number }
    | { readonly inlineAbove: number }
    | { readonly blockBelow: number }
    | { readonly blockAbove: number }
    | {
        readonly inlineBetween: readonly [number, number];
      };
};

type LengthToken<Tokens> =
  | TokenRefOfGroup<Tokens, "space">
  | TokenRefOfGroup<Tokens, "size">
  | TokenRefOfGroup<Tokens, "radius">
  | TokenRefOfGroup<Tokens, "blur">;

type LengthValueRef<Values> = ValueRefOfKind<Values, "length">;
type NumberValueRef<Values> = ValueRefOfKind<Values, "number" | "ratio" | "progress">;
type OpacityValueRef<Values> = ValueRefOfKind<Values, "opacity" | "progress">;
type AngleValueRef<Values> = ValueRefOfKind<Values, "angle">;

export type LengthAtom<Tokens = Empty, Values = Empty> =
  | number
  | LengthToken<Tokens>
  | LengthValueRef<Values>;

export type LengthValue<Tokens = Empty, Values = Empty> =
  | LengthAtom<Tokens, Values>
  | { readonly percent: number }
  | { readonly container: { readonly axis: "inline" | "block"; readonly percent: number } }
  | { readonly viewport: { readonly axis: "inline" | "block"; readonly percent: number } }
  | {
      readonly fluid: {
        readonly min: LengthAtom<Tokens, Values>;
        readonly ideal: LengthAtom<Tokens, Values>;
        readonly max: LengthAtom<Tokens, Values>;
      };
    }
  | {
      readonly add: readonly [LengthAtom<Tokens, Values>, LengthAtom<Tokens, Values>];
    }
  | {
      readonly subtract: readonly [LengthAtom<Tokens, Values>, LengthAtom<Tokens, Values>];
    }
  | {
      readonly multiply: readonly [LengthAtom<Tokens, Values>, number | NumberValueRef<Values>];
    }
  | { readonly negate: LengthAtom<Tokens, Values> };

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

export type ColorValue<Tokens = Empty> =
  | OklchColor
  | "transparent"
  | "current"
  | TokenRefOfGroup<Tokens, "color">
  | {
      readonly mix: readonly [
        OklchColor | TokenRefOfGroup<Tokens, "color">,
        OklchColor | TokenRefOfGroup<Tokens, "color">,
      ];
      readonly by: number;
    };

export type PaintValue<Tokens = Empty> = ColorValue<Tokens> | TokenRefOfGroup<Tokens, "gradient">;

type IntrinsicMeasure = "auto" | "content" | "min-content" | "max-content" | "fill";

export type Measure<Tokens = Empty, Values = Empty> =
  | LengthValue<Tokens, Values>
  | IntrinsicMeasure
  | { readonly fraction: number }
  | { readonly fit: LengthAtom<Tokens, Values> };

type TrackBase<Tokens, Values> =
  | LengthAtom<Tokens, Values>
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

export type LayoutVisual<Tokens = Empty, Values = Empty> =
  | {
      readonly kind: "row" | "stack";
      readonly gap?: LengthValue<Tokens, Values>;
      readonly align?: "start" | "center" | "end" | "stretch" | "baseline";
      readonly distribute?: "start" | "center" | "end" | "between" | "around" | "evenly";
      readonly wrap?: boolean;
      readonly reverse?: boolean;
    }
  | {
      readonly kind: "grid";
      readonly columns?: readonly GridTrack<Tokens, Values>[];
      readonly rows?: readonly GridTrack<Tokens, Values>[];
      readonly gap?: LengthValue<Tokens, Values>;
      readonly columnGap?: LengthValue<Tokens, Values>;
      readonly rowGap?: LengthValue<Tokens, Values>;
      readonly align?: "start" | "center" | "end" | "stretch" | "baseline";
      readonly distribute?: "start" | "center" | "end" | "between" | "around" | "evenly";
      readonly autoFlow?: "row" | "column" | "dense-row" | "dense-column";
      readonly subgrid?: "columns" | "rows" | "both";
    }
  | {
      readonly kind: "overlay";
      readonly align?: "start" | "center" | "end" | "stretch";
      readonly distribute?: "start" | "center" | "end" | "stretch";
    }
  | { readonly kind: "contents" | "hidden" };

export type FrameVisual<Tokens = Empty, Values = Empty> = {
  readonly inline?:
    | Measure<Tokens, Values>
    | { readonly min?: Measure<Tokens, Values>; readonly max?: Measure<Tokens, Values> };
  readonly block?:
    | Measure<Tokens, Values>
    | { readonly min?: Measure<Tokens, Values>; readonly max?: Measure<Tokens, Values> };
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
  | LengthValue<Tokens, Values>
  | {
      readonly inline?: LengthValue<Tokens, Values>;
      readonly block?: LengthValue<Tokens, Values>;
      readonly inlineStart?: LengthValue<Tokens, Values>;
      readonly inlineEnd?: LengthValue<Tokens, Values>;
      readonly blockStart?: LengthValue<Tokens, Values>;
      readonly blockEnd?: LengthValue<Tokens, Values>;
    };

export type SurfaceVisual<Tokens = Empty> = {
  readonly fill?: PaintValue<Tokens>;
  readonly text?: ColorValue<Tokens>;
};

export type TextVisual<Tokens = Empty, Values = Empty> = {
  readonly font?: TokenRefOfGroup<Tokens, "font">;
  readonly size?: LengthValue<Tokens, Values>;
  readonly weight?: number;
  readonly line?: number | LengthValue<Tokens, Values>;
  readonly tracking?: LengthValue<Tokens, Values>;
  readonly align?: "start" | "center" | "end" | "justify";
  readonly transform?: "none" | "uppercase" | "lowercase" | "capitalize";
  readonly wrap?: "wrap" | "nowrap" | "balance" | "pretty";
  readonly overflow?: "clip" | "ellipsis";
  readonly lines?: number;
  readonly decoration?: "none" | "underline" | "strike";
  readonly smoothing?: "auto" | "grayscale";
  readonly features?: Readonly<Record<string, boolean | number>>;
};

export type MediaVisual = {
  readonly fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
  readonly position?: {
    readonly inline: number;
    readonly block: number;
  };
  readonly rendering?: "auto" | "crisp" | "pixelated";
};

type StrokeLine<Tokens, Values> = {
  readonly width?: LengthValue<Tokens, Values>;
  readonly line?: "none" | "solid" | "dash" | "dot";
  readonly color?: ColorValue<Tokens>;
};

export type StrokeVisual<Tokens = Empty, Values = Empty> =
  | StrokeLine<Tokens, Values>
  | {
      readonly all?: StrokeLine<Tokens, Values>;
      readonly inlineStart?: StrokeLine<Tokens, Values>;
      readonly inlineEnd?: StrokeLine<Tokens, Values>;
      readonly blockStart?: StrokeLine<Tokens, Values>;
      readonly blockEnd?: StrokeLine<Tokens, Values>;
    }
  | TokenRefOfGroup<Tokens, "stroke">;

export type ShapeVisual<Tokens = Empty, Values = Empty> = {
  readonly radius?:
    | LengthValue<Tokens, Values>
    | {
        readonly startStart?: LengthValue<Tokens, Values>;
        readonly startEnd?: LengthValue<Tokens, Values>;
        readonly endStart?: LengthValue<Tokens, Values>;
        readonly endEnd?: LengthValue<Tokens, Values>;
      };
  readonly clip?:
    | "none"
    | "content"
    | { readonly circle: number }
    | { readonly inset: LogicalSpace<Tokens, Values> };
  readonly mask?: TokenRefOfGroup<Tokens, "gradient">;
};

export type EffectVisual<Tokens = Empty, Values = Empty> = {
  readonly opacity?: number | OpacityValueRef<Values>;
  readonly shadow?: TokenRefOfGroup<Tokens, "shadow"> | "none";
  readonly blur?: LengthValue<Tokens, Values>;
  readonly backdrop?: {
    readonly blur?: LengthValue<Tokens, Values>;
    readonly saturation?: number;
    readonly brightness?: number;
  };
  readonly brightness?: number;
  readonly contrast?: number;
  readonly saturation?: number;
  readonly blend?: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
};

export type TransformVisual<Tokens = Empty, Values = Empty> = {
  readonly inline?: LengthValue<Tokens, Values>;
  readonly block?: LengthValue<Tokens, Values>;
  readonly depth?: LengthValue<Tokens, Values>;
  readonly scale?: NumberValue<Values>;
  readonly scaleInline?: NumberValue<Values>;
  readonly scaleBlock?: NumberValue<Values>;
  readonly rotate?: number | AngleValueRef<Values>;
  readonly skewInline?: number | AngleValueRef<Values>;
  readonly skewBlock?: number | AngleValueRef<Values>;
  readonly origin?: {
    readonly inline: number;
    readonly block: number;
  };
  readonly perspective?: LengthValue<Tokens, Values>;
};

export type PositionVisual<Tokens = Empty, Values = Empty> = {
  readonly kind: "relative" | "absolute" | "fixed" | "sticky";
  readonly inset?: LogicalSpace<Tokens, Values>;
  readonly layer?: number | TokenRefOfGroup<Tokens, "z">;
  readonly place?: "auto" | "block-start" | "block-end" | "inline-start" | "inline-end";
};

export type ScrollVisual = {
  readonly inline?: "visible" | "clip" | "scroll" | "auto";
  readonly block?: "visible" | "clip" | "scroll" | "auto";
  readonly overscroll?: "auto" | "contain" | "none";
  readonly snap?: "none" | "inline" | "block" | "both";
  readonly snapAlign?: "none" | "start" | "center" | "end";
  readonly gutter?: "auto" | "stable" | "stable-both";
  readonly scrollbar?: "auto" | "thin" | "hidden";
};

export type InteractionVisual<Tokens = Empty, Values = Empty> = {
  readonly cursor?: "auto" | "default" | "pointer" | "text" | "grab" | "grabbing" | "resize";
  readonly select?: "auto" | "none" | "text" | "all";
  readonly touch?: "auto" | "none" | "pan-inline" | "pan-block" | "manipulation";
  readonly pointer?: "auto" | "none";
  readonly caret?: ColorValue<Tokens>;
  readonly focusRing?:
    | "none"
    | {
        readonly color: ColorValue<Tokens>;
        readonly width: LengthValue<Tokens, Values>;
        readonly offset?: LengthValue<Tokens, Values>;
      };
};

export type VisualFragment<Tokens = Empty, Values = Empty> = {
  readonly layout?: LayoutVisual<Tokens, Values>;
  readonly frame?: FrameVisual<Tokens, Values>;
  readonly place?: PlaceVisual<Tokens, Values>;
  readonly padding?: LogicalSpace<Tokens, Values>;
  readonly margin?: LogicalSpace<Tokens, Values>;
  readonly surface?: SurfaceVisual<Tokens>;
  readonly text?: TextVisual<Tokens, Values>;
  readonly media?: MediaVisual;
  readonly stroke?: StrokeVisual<Tokens, Values>;
  readonly shape?: ShapeVisual<Tokens, Values>;
  readonly effect?: EffectVisual<Tokens, Values>;
  readonly transform?: TransformVisual<Tokens, Values>;
  readonly position?: PositionVisual<Tokens, Values>;
  readonly scroll?: ScrollVisual;
  readonly interaction?: InteractionVisual<Tokens, Values>;
};

export type DecorVisual<Tokens = Empty, Values = Empty> = {
  readonly before?: VisualFragment<Tokens, Values> & { readonly content?: string };
  readonly after?: VisualFragment<Tokens, Values> & { readonly content?: string };
  readonly backdrop?: VisualFragment<Tokens, Values>;
  readonly placeholder?: VisualFragment<Tokens, Values>;
  readonly selection?: VisualFragment<Tokens, Values>;
  readonly track?: VisualFragment<Tokens, Values>;
  readonly thumb?: VisualFragment<Tokens, Values>;
};

type SharedNameFor<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Spec["Components"] extends AnyRecord
  ? Spec["Components"][Component] extends { Shared: infer Shared extends string }
    ? Shared
    : never
  : never;

type ScopedVisualFragment<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Tokens,
  Values,
> = Omit<VisualFragment<Tokens, Values>, "position"> & {
  readonly position?: PositionVisual<Tokens, Values> & {
    readonly anchor?: "none" | { readonly part: ComponentPartName<Spec, Component> };
  };
};

type FiniteStateKey<State, Key extends keyof State> = State[Key] extends boolean
  ? Key
  : State[Key] extends string
    ? string extends State[Key]
      ? never
      : Key
    : State[Key] extends number
      ? number extends State[Key]
        ? never
        : Key
      : never;

type FiniteStateMatch<State> = Partial<{
  readonly [Key in keyof State as FiniteStateKey<State, Key>]: State[Key];
}>;

type VariantMatch<Variants> = Partial<{
  readonly [Key in keyof Variants]: Variants[Key];
}>;

export type NativeVisualState =
  | "hover"
  | "active"
  | "focus"
  | "focus-visible"
  | "disabled"
  | "checked"
  | "selected"
  | "pressed"
  | "expanded"
  | "popover-open"
  | "placeholder-shown"
  | "invalid";

export type VisualPreference =
  | "reduced-motion"
  | "more-contrast"
  | "forced-colors"
  | "dark"
  | "light";

export type VisualCapability =
  | "backdrop-filter"
  | "anchor-positioning"
  | "view-transitions"
  | "scroll-timeline"
  | "wide-gamut";

type VisualCondition<
  Spec extends AppSpec,
  Name extends VisualPresetName<Spec>,
  Component extends ComponentName<Spec>,
  Tokens,
  Values,
> =
  | {
      readonly state: FiniteStateMatch<ComponentState<Spec, Component>>;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly variant: VariantMatch<ComponentVariants<Spec, Component>>;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly native: NativeVisualState;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly container: ContainerNameFor<Spec, Name>;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly theme: ThemeNameFor<Spec, Name>;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly preference: VisualPreference;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    }
  | {
      readonly capability: VisualCapability;
      readonly apply: ScopedVisualFragment<Spec, Component, Tokens, Values>;
    };

type MotionRef<Tokens> = TokenRefOfGroup<Tokens, "motion">;

type MotionFrame = {
  readonly effect?: { readonly opacity?: number };
  readonly transform?: {
    readonly inline?: number;
    readonly block?: number;
    readonly scale?: number;
    readonly rotate?: number;
  };
};

export type MotionVisual<
  Tokens = Empty,
  Values = Empty,
  Shared extends string = never,
  Part extends string = never,
> = {
  readonly change?: Partial<
    Record<"surface" | "text" | "stroke" | "shape" | "effect" | "transform", MotionRef<Tokens>>
  >;
  readonly enter?: {
    readonly from: MotionFrame;
    readonly using: MotionRef<Tokens>;
  };
  readonly exit?: {
    readonly to: MotionFrame;
    readonly using: MotionRef<Tokens>;
  };
  readonly layout?: {
    readonly geometry: "position" | "size" | "frame" | "tracks" | "text";
    readonly content?: "preserve" | "scale";
    readonly using: MotionRef<Tokens>;
  };
  readonly shared?: {
    readonly id: Shared;
    readonly using: MotionRef<Tokens>;
  };
  readonly gesture?: {
    readonly axis: "inline" | "block" | "both";
    readonly value: LengthValueRef<Values>;
    readonly handle?: Part;
    readonly bounds?: readonly [number, number];
    readonly rubberBand?: number;
    readonly dismiss?: {
      readonly distance: number;
      readonly velocity: number;
    };
    readonly settle: MotionRef<Tokens>;
  };
};

export type PartVisual<
  Spec extends AppSpec,
  Name extends VisualPresetName<Spec>,
  Component extends ComponentName<Spec>,
> = ScopedVisualFragment<
  Spec,
  Component,
  VisualTokenRefs<Spec, Name>,
  VisualValueRefs<Spec, Component>
> & {
  readonly use?:
    | ScopedVisualFragment<
        Spec,
        Component,
        VisualTokenRefs<Spec, Name>,
        VisualValueRefs<Spec, Component>
      >
    | readonly ScopedVisualFragment<
        Spec,
        Component,
        VisualTokenRefs<Spec, Name>,
        VisualValueRefs<Spec, Component>
      >[];
  readonly decor?: DecorVisual<VisualTokenRefs<Spec, Name>, VisualValueRefs<Spec, Component>>;
  readonly when?: readonly VisualCondition<
    Spec,
    Name,
    Component,
    VisualTokenRefs<Spec, Name>,
    VisualValueRefs<Spec, Component>
  >[];
  readonly motion?: MotionVisual<
    VisualTokenRefs<Spec, Name>,
    VisualValueRefs<Spec, Component>,
    SharedNameFor<Spec, Component>,
    ComponentPartName<Spec, Component>
  >;
};

export type ComponentVisuals<
  Spec extends AppSpec,
  Name extends VisualPresetName<Spec>,
  Component extends ComponentName<Spec>,
> = Partial<{
  readonly [Part in ComponentPartName<Spec, Component>]: PartVisual<Spec, Name, Component>;
}>;

export type VisualComponentContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly values: VisualValueRefs<Spec, Component>;
};

export type Preset<Spec extends AppSpec, Name extends VisualPresetName<Spec>> = {
  readonly tokens: VisualTokenDefinitions<Spec, Name>;
  readonly themes?: VisualThemeDefinitions<Spec, Name>;
  readonly containers?: VisualContainerDefinitions<Spec, Name>;
  readonly components: (scope: { readonly tokens: VisualTokenRefs<Spec, Name> }) => {
    readonly [Component in ComponentName<Spec>]: (
      context: VisualComponentContext<Spec, Component>,
    ) => ComponentVisuals<Spec, Name, Component>;
  };
};
