import {
  type ReferenceChartDefinition,
  type ReferenceChartNodeDefinition,
  type ReferenceChartTopology,
  type ReferenceChartTransitionTopology,
  type ReferenceSemanticNode,
  type ReferenceSemanticRole,
  type ReferenceSemanticScene,
  type ReferenceStructureReconciliation,
  type ReferenceTargetContribution,
  normalizeReferenceChart,
  resolveReferenceComposition,
  resolveReferenceSharedIdentities,
  resolveReferenceGestureArbitration,
  resolveReferenceTargets,
  resolveReferenceTransitionTransaction,
  validateReferenceSemanticTree,
} from "./ui-language-reference";

type CandidateApp = {
  readonly Components: Readonly<
    Record<string, { readonly Parts: Readonly<Record<string, string>> }>
  >;
  readonly Styles: {
    readonly Presets:
      | string
      | Readonly<
          Record<
            string,
            {
              readonly Tokens?: Readonly<Record<string, unknown>>;
              readonly Themes?: string;
            }
          >
        >;
  };
};

declare const candidateTargetValue: unique symbol;
declare const candidateDerivedTargetValue: unique symbol;
declare const candidatePolicyValue: unique symbol;
declare const candidateIdentityValue: unique symbol;
declare const candidateRecognizerOutcome: unique symbol;
declare const candidateCollectionValue: unique symbol;
declare const candidateExpressionValue: unique symbol;
declare const candidateNativeLayerValue: unique symbol;
declare const candidateTokenValue: unique symbol;
declare const candidateParameterValue: unique symbol;
declare const candidateParameterHandleValue: unique symbol;
declare const candidateStructureReferenceValue: unique symbol;
declare const candidateStructureNodeValue: unique symbol;
declare const candidateKeyedCollectionContractValue: unique symbol;
declare const candidateSlotContractValue: unique symbol;
const candidateActionIdentities = new WeakMap<object, string>();

export function issueCandidateAction<Action extends (...args: never[]) => unknown>(
  name: string,
): Action {
  if (!name) throw new Error("A compiler-issued action needs a non-empty identity.");
  const action = ((..._args: never[]) => undefined) as Action;
  candidateActionIdentities.set(action, name);
  return action;
}
declare const candidateComponentInstanceValue: unique symbol;
declare const candidateStructureSelectionValue: unique symbol;
declare const candidateCommandValue: unique symbol;

export type CandidateToken<Value> = {
  readonly [candidateTokenValue]: Value;
};

export type CandidateParameter<Value> = {
  readonly [candidateParameterValue]: Value;
};

export type CandidateCommand<Input = void> = {
  readonly [candidateCommandValue]: Input;
};

export type CandidateParameterHandle<Value> = {
  readonly key: string;
  readonly [candidateParameterHandleValue]: (value: Value) => Value;
};

type CandidateTokenReferences<Contract> = {
  readonly [Key in keyof Contract]: Contract[Key] extends CandidateToken<infer Value>
    ? CandidateExpression<Value>
    : Contract[Key] extends Readonly<Record<string, unknown>>
      ? CandidateTokenReferences<Contract[Key]>
      : never;
};

type CandidateThemeValues<Contract> = {
  readonly [Key in keyof Contract]: Contract[Key] extends CandidateToken<infer Value>
    ? Value
    : Contract[Key] extends Readonly<Record<string, unknown>>
      ? CandidateThemeValues<Contract[Key]>
      : never;
};

type CandidateThemeOverrides<Contract> = {
  readonly [Key in keyof Contract]?: Contract[Key] extends CandidateToken<infer Value>
    ? Value
    : Contract[Key] extends Readonly<Record<string, unknown>>
      ? CandidateThemeOverrides<Contract[Key]>
      : never;
};

export type CandidatePresentationIdentity = {
  readonly key: string;
  readonly [candidateIdentityValue]: true;
};

export type CandidateLength = {
  readonly dimension: "length";
  readonly value: number;
};

export type CandidateAngle = {
  readonly dimension: "angle";
  readonly value: number;
};

export type CandidateTime = {
  readonly dimension: "time";
  readonly value: number;
};

export type CandidateRate<Value> = {
  readonly perSecond: Value;
};

export type CandidateMeasure = CandidateLength | CandidateAngle | CandidateTime;

export type CandidateColor = {
  readonly colorSpace: "oklch";
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
  readonly alpha: number;
};

export type CandidateGradientStop = {
  readonly position: number;
  readonly color: CandidateColor;
};

export type CandidatePaint =
  | { readonly kind: "solid"; readonly color: CandidateColor }
  | {
      readonly kind: "linear-gradient";
      readonly angle: CandidateAngle;
      readonly stops: readonly CandidateGradientStop[];
    }
  | {
      readonly kind: "radial-gradient";
      readonly center: { readonly inline: number; readonly block: number };
      readonly radius: number;
      readonly stops: readonly CandidateGradientStop[];
    }
  | {
      readonly kind: "conic-gradient";
      readonly center: { readonly inline: number; readonly block: number };
      readonly angle: CandidateAngle;
      readonly stops: readonly CandidateGradientStop[];
    };

export type CandidateCorner = {
  readonly radius: CandidateLength;
  readonly smoothing: number;
};

export type CandidatePathCommand =
  | { readonly kind: "move" | "line"; readonly inline: number; readonly block: number }
  | {
      readonly kind: "curve";
      readonly control1: { readonly inline: number; readonly block: number };
      readonly control2: { readonly inline: number; readonly block: number };
      readonly end: { readonly inline: number; readonly block: number };
    }
  | { readonly kind: "close" };

export type CandidateShape =
  | {
      readonly kind: "rectangle";
      readonly corners: {
        readonly startStart: CandidateCorner;
        readonly startEnd: CandidateCorner;
        readonly endStart: CandidateCorner;
        readonly endEnd: CandidateCorner;
      };
    }
  | { readonly kind: "capsule" | "ellipse" }
  | {
      readonly kind: "path";
      readonly viewBox: { readonly inlineSize: number; readonly blockSize: number };
      readonly commands: readonly CandidatePathCommand[];
      readonly fillRule: "nonzero" | "even-odd";
    };

export type CandidateStroke = {
  readonly paint: CandidatePaint;
  readonly width: CandidateLength;
  readonly placement: "inside" | "center" | "outside";
  readonly dash?: readonly CandidateLength[];
};

export type CandidateShadow = {
  readonly kind: "outer" | "inner";
  readonly color: CandidateColor;
  readonly offset: { readonly inline: CandidateLength; readonly block: CandidateLength };
  readonly blur: CandidateLength;
  readonly spread: CandidateLength;
};

export type CandidateMaterial = {
  readonly backdropBlur: CandidateLength;
  readonly backdropSaturation: number;
  readonly tint: CandidatePaint;
  readonly noise: number;
};

export type CandidateTypeStyle = {
  readonly families: readonly string[];
  readonly size: CandidateLength;
  readonly lineHeight: CandidateLength;
  readonly weight: number;
  readonly tracking: CandidateLength;
  readonly align: "start" | "center" | "end" | "justify";
  readonly wrap: "wrap" | "balance" | "nowrap";
  readonly overflow: "clip" | "ellipsis";
  readonly decoration: "none" | "underline" | "line-through";
  readonly variations: Readonly<Record<string, number>>;
};

export type CandidateMediaFit = {
  readonly mode: "contain" | "cover" | "stretch" | "intrinsic";
  readonly focalPoint: { readonly inline: number; readonly block: number };
};

export type CandidateTransform = {
  readonly translation: {
    readonly inline: CandidateLength;
    readonly block: CandidateLength;
    readonly depth: CandidateLength;
  };
  readonly scale: { readonly inline: number; readonly block: number; readonly depth: number };
  readonly rotation: {
    readonly axis: { readonly x: number; readonly y: number; readonly z: number };
    readonly angle: CandidateAngle;
  };
  readonly origin: {
    readonly inline: number;
    readonly block: number;
    readonly depth: CandidateLength;
  };
  readonly perspective: CandidateLength | "none";
};

export type CandidateGeometry = {
  readonly inline: CandidateLength;
  readonly block: CandidateLength;
  readonly inlineSize: CandidateLength;
  readonly blockSize: CandidateLength;
};

export type CandidateTargetAddress = {
  readonly identity: string;
  readonly property: string;
};

export type CandidateGeneratedAddress = {
  readonly identity: string;
  readonly owner: string;
};

export type CandidateTargetHandle<Value> = {
  readonly key: string;
  readonly address: CandidateTargetAddress;
  readonly valueType: CandidateValueType;
  readonly generated?: CandidateGeneratedAddress;
  readonly [candidateTargetValue]: (value: Value) => Value;
};

export type CandidateDerivedTargetHandle<Value> = {
  readonly key: string;
  readonly address: CandidateTargetAddress;
  readonly valueType: CandidateValueType;
  readonly generated?: CandidateGeneratedAddress;
  readonly [candidateDerivedTargetValue]: (value: Value) => Value;
};

export type CandidateValueType =
  | "unknown"
  | "number"
  | "length"
  | "paint"
  | "shape"
  | "stroke"
  | "shadows"
  | "material"
  | "type"
  | "media-fit"
  | "transform"
  | "geometry";

export type CandidateTransitionPolicy<Value> = {
  readonly name: string;
  readonly definition: CandidateTransitionDefinition;
  readonly [candidatePolicyValue]: (value: Value) => Value;
};

export type CandidateTimingCurve =
  | { readonly kind: "linear" }
  | {
      readonly kind: "cubic";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    };

export type CandidateTemporalDriver =
  | { readonly kind: "instant" }
  | {
      readonly kind: "timing";
      readonly milliseconds: number;
      readonly curve: CandidateTimingCurve;
    }
  | {
      readonly kind: "spring";
      readonly mass: number;
      readonly stiffness: number;
      readonly damping: number;
    };

export type CandidateTransitionDefinition = {
  readonly normal:
    | CandidateTemporalDriver
    | { readonly kind: "layout"; readonly driver: CandidateTemporalDriver };
  readonly reduced: CandidateTemporalDriver;
};

export type CandidateRecognizerKind =
  | "drag"
  | "pan"
  | "pinch"
  | "rotate"
  | "longPress"
  | "hoverIntent";

export type CandidateContinuousRecognizerKind = "drag" | "pan" | "pinch" | "rotate";

type CandidateRecognizerBase<Outcome extends string, Kind extends CandidateRecognizerKind> = {
  readonly key: string;
  readonly kind: Kind;
  readonly phase: CandidateExpression<"possible" | "active" | "recognized" | "failed">;
  readonly [candidateRecognizerOutcome]: (outcome: Outcome) => Outcome;
};

type CandidatePointerPosition = {
  readonly inline: CandidateExpression<CandidateLength>;
  readonly block: CandidateExpression<CandidateLength>;
};

type CandidatePointerVelocity = {
  readonly inline: CandidateExpression<CandidateRate<CandidateLength>>;
  readonly block: CandidateExpression<CandidateRate<CandidateLength>>;
};

export type CandidateRecognizerHandle<
  Outcome extends string,
  Kind extends CandidateRecognizerKind = CandidateRecognizerKind,
> = CandidateRecognizerBase<Outcome, Kind> &
  (Kind extends "drag" | "pan"
    ? {
        readonly translation: CandidatePointerPosition;
        readonly velocity: CandidatePointerVelocity;
      }
    : Kind extends "pinch"
      ? {
          readonly scale: CandidateExpression<number>;
          readonly velocity: CandidateExpression<CandidateRate<number>>;
        }
      : Kind extends "rotate"
        ? {
            readonly angle: CandidateExpression<CandidateAngle>;
            readonly velocity: CandidateExpression<CandidateRate<CandidateAngle>>;
          }
        : Kind extends "longPress"
          ? {
              readonly progress: CandidateExpression<number>;
              readonly position: CandidatePointerPosition;
            }
          : {
              readonly engaged: CandidateExpression<boolean>;
              readonly progress: CandidateExpression<number>;
              readonly position: CandidatePointerPosition;
              readonly velocity: CandidatePointerVelocity;
            });

export type CandidateCollectionHandle<Key extends string | number> = {
  readonly key: string;
  readonly [candidateCollectionValue]: (key: Key) => Key;
};

export type CandidateScalarKeyOf<Item extends object> = {
  readonly [Key in keyof Item]-?: Item[Key] extends string | number ? Key : never;
}[keyof Item];

export type CandidateKeyedCollection<
  Item extends object,
  Key extends CandidateScalarKeyOf<Item>,
  Part extends string,
  Role extends ReferenceSemanticRole,
> = {
  readonly [candidateKeyedCollectionContractValue]: {
    readonly item: Item;
    readonly key: Key;
    readonly part: Part;
    readonly role: Role;
  };
};

export type CandidateSlotCardinality = "one" | "optional" | "many";

export type CandidateSlot<
  Component extends string,
  Cardinality extends CandidateSlotCardinality = "one",
> = {
  readonly [candidateSlotContractValue]: {
    readonly component: Component;
    readonly cardinality: Cardinality;
  };
};

export type CandidateStructureComponentInstance<Component extends string = string> = {
  readonly key: string;
  readonly component: Component;
  readonly [candidateComponentInstanceValue]: true;
};

export type CandidateExpression<Value> = {
  readonly [candidateExpressionValue]: Value;
  readonly expression: CandidateExpressionNode;
  readonly choose: <WhenTrue, WhenFalse>(
    whenTrue: CandidateResolvable<WhenTrue>,
    whenFalse: CandidateResolvable<WhenFalse>,
  ) => CandidateExpression<WhenTrue | WhenFalse>;
};

export type CandidateResolvable<Value> = Value | CandidateExpression<Value>;

export type CandidateExpressionNode =
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "read"; readonly path: string }
  | {
      readonly kind: "structure-reference";
      readonly prefix: string;
      readonly role: ReferenceSemanticRole;
      readonly key: CandidateExpressionNode;
    }
  | {
      readonly kind: "choose";
      readonly condition: CandidateExpressionNode;
      readonly whenTrue: CandidateExpressionNode;
      readonly whenFalse: CandidateExpressionNode;
    }
  | {
      readonly kind: "equal";
      readonly left: CandidateExpressionNode;
      readonly right: CandidateExpressionNode;
    }
  | {
      readonly kind: "and";
      readonly values: readonly CandidateExpressionNode[];
    }
  | {
      readonly kind: "or";
      readonly values: readonly CandidateExpressionNode[];
    }
  | { readonly kind: "not"; readonly value: CandidateExpressionNode }
  | {
      readonly kind: "add";
      readonly left: CandidateExpressionNode;
      readonly right: CandidateExpressionNode;
    }
  | {
      readonly kind: "scale";
      readonly value: CandidateExpressionNode;
      readonly factor: CandidateExpressionNode;
    }
  | {
      readonly kind: "compare";
      readonly relation: "less" | "lessOrEqual" | "greater" | "greaterOrEqual";
      readonly left: CandidateExpressionNode;
      readonly right: CandidateExpressionNode;
    }
  | {
      readonly kind: "clamp";
      readonly value: CandidateExpressionNode;
      readonly minimum: CandidateExpressionNode;
      readonly maximum: CandidateExpressionNode;
    }
  | {
      readonly kind: "normalize";
      readonly value: CandidateExpressionNode;
      readonly range: readonly [CandidateExpressionNode, CandidateExpressionNode];
      readonly clamp: boolean;
    }
  | {
      readonly kind: "interpolate";
      readonly input: CandidateExpressionNode;
      readonly inputRange: readonly [number, number];
      readonly outputRange: readonly [CandidateExpressionNode, CandidateExpressionNode];
      readonly clamp: boolean;
    };

export function createCandidateReadExpression<Value>(path: string): CandidateExpression<Value> {
  if (!path) throw new Error("Expression dependency path cannot be empty.");
  return candidateExpression({ kind: "read", path });
}

export function equalCandidate<Value>(
  left: CandidateResolvable<Value>,
  right: CandidateResolvable<Value>,
): CandidateExpression<boolean> {
  return candidateExpression({
    kind: "equal",
    left: candidateExpressionNode(left),
    right: candidateExpressionNode(right),
  });
}

export function andCandidate(
  ...values: readonly CandidateResolvable<boolean>[]
): CandidateExpression<boolean> {
  if (values.length < 2) throw new Error("Boolean conjunction needs at least two values.");
  return candidateExpression({ kind: "and", values: values.map(candidateExpressionNode) });
}

export function orCandidate(
  ...values: readonly CandidateResolvable<boolean>[]
): CandidateExpression<boolean> {
  if (values.length < 2) throw new Error("Boolean disjunction needs at least two values.");
  return candidateExpression({ kind: "or", values: values.map(candidateExpressionNode) });
}

export function notCandidate(value: CandidateResolvable<boolean>): CandidateExpression<boolean> {
  return candidateExpression({ kind: "not", value: candidateExpressionNode(value) });
}

type CandidateMeasureOf<Dimension extends CandidateMeasure["dimension"]> = Extract<
  CandidateMeasure,
  { readonly dimension: Dimension }
>;

export function addCandidate(
  left: CandidateResolvable<number>,
  right: CandidateResolvable<number>,
): CandidateExpression<number>;
export function addCandidate<Dimension extends CandidateMeasure["dimension"]>(
  left: CandidateResolvable<CandidateMeasureOf<Dimension>>,
  right: CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
): CandidateExpression<CandidateMeasureOf<Dimension>>;
export function addCandidate(
  left: CandidateResolvable<number | CandidateMeasure>,
  right: CandidateResolvable<number | CandidateMeasure>,
): CandidateExpression<number | CandidateMeasure> {
  return candidateExpression({
    kind: "add",
    left: candidateExpressionNode(left),
    right: candidateExpressionNode(right),
  });
}

export function scaleCandidate(
  value: CandidateResolvable<number>,
  factor: CandidateResolvable<number>,
): CandidateExpression<number>;
export function scaleCandidate<Dimension extends CandidateMeasure["dimension"]>(
  value: CandidateResolvable<CandidateMeasureOf<Dimension>>,
  factor: CandidateResolvable<number>,
): CandidateExpression<CandidateMeasureOf<Dimension>>;
export function scaleCandidate(
  value: CandidateResolvable<number | CandidateMeasure>,
  factor: CandidateResolvable<number>,
): CandidateExpression<number | CandidateMeasure> {
  return candidateExpression({
    kind: "scale",
    value: candidateExpressionNode(value),
    factor: candidateExpressionNode(factor),
  });
}

export function compareCandidate(
  left: CandidateResolvable<number>,
  relation: "less" | "lessOrEqual" | "greater" | "greaterOrEqual",
  right: CandidateResolvable<number>,
): CandidateExpression<boolean>;
export function compareCandidate<Dimension extends CandidateMeasure["dimension"]>(
  left: CandidateResolvable<CandidateMeasureOf<Dimension>>,
  relation: "less" | "lessOrEqual" | "greater" | "greaterOrEqual",
  right: CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
): CandidateExpression<boolean>;
export function compareCandidate(
  left: CandidateResolvable<number | CandidateMeasure>,
  relation: "less" | "lessOrEqual" | "greater" | "greaterOrEqual",
  right: CandidateResolvable<number | CandidateMeasure>,
): CandidateExpression<boolean> {
  return candidateExpression({
    kind: "compare",
    relation,
    left: candidateExpressionNode(left),
    right: candidateExpressionNode(right),
  });
}

export function clampCandidate(
  value: CandidateResolvable<number>,
  minimum: CandidateResolvable<number>,
  maximum: CandidateResolvable<number>,
): CandidateExpression<number>;
export function clampCandidate<Dimension extends CandidateMeasure["dimension"]>(
  value: CandidateResolvable<CandidateMeasureOf<Dimension>>,
  minimum: CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
  maximum: CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
): CandidateExpression<CandidateMeasureOf<Dimension>>;
export function clampCandidate(
  value: CandidateResolvable<number | CandidateMeasure>,
  minimum: CandidateResolvable<number | CandidateMeasure>,
  maximum: CandidateResolvable<number | CandidateMeasure>,
): CandidateExpression<number | CandidateMeasure> {
  return candidateExpression({
    kind: "clamp",
    value: candidateExpressionNode(value),
    minimum: candidateExpressionNode(minimum),
    maximum: candidateExpressionNode(maximum),
  });
}

export function normalizeCandidate(
  value: CandidateResolvable<number>,
  range: readonly [CandidateResolvable<number>, CandidateResolvable<number>],
  options: { readonly clamp: boolean },
): CandidateExpression<number>;
export function normalizeCandidate<Dimension extends CandidateMeasure["dimension"]>(
  value: CandidateResolvable<CandidateMeasureOf<Dimension>>,
  range: readonly [
    CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
    CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<number>;
export function normalizeCandidate(
  value: CandidateResolvable<number | CandidateMeasure>,
  range: readonly [
    CandidateResolvable<number | CandidateMeasure>,
    CandidateResolvable<number | CandidateMeasure>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<number> {
  return candidateExpression({
    kind: "normalize",
    value: candidateExpressionNode(value),
    range: range.map(candidateExpressionNode) as [CandidateExpressionNode, CandidateExpressionNode],
    clamp: options.clamp,
  });
}

export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [CandidateResolvable<number>, CandidateResolvable<number>],
  options: { readonly clamp: boolean },
): CandidateExpression<number>;
export function interpolateCandidate<Dimension extends CandidateMeasure["dimension"]>(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateMeasureOf<Dimension>>,
    CandidateResolvable<CandidateMeasureOf<NoInfer<Dimension>>>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateMeasureOf<Dimension>>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [CandidateResolvable<CandidateColor>, CandidateResolvable<CandidateColor>],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateColor>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [CandidateResolvable<CandidatePaint>, CandidateResolvable<CandidatePaint>],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidatePaint>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [CandidateResolvable<CandidateShape>, CandidateResolvable<CandidateShape>],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateShape>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateStroke>,
    CandidateResolvable<CandidateStroke>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateStroke>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<readonly CandidateShadow[]>,
    CandidateResolvable<readonly CandidateShadow[]>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<readonly CandidateShadow[]>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateMaterial>,
    CandidateResolvable<CandidateMaterial>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateMaterial>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateTypeStyle>,
    CandidateResolvable<CandidateTypeStyle>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateTypeStyle>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateMediaFit>,
    CandidateResolvable<CandidateMediaFit>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateMediaFit>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<CandidateTransform>,
    CandidateResolvable<CandidateTransform>,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<CandidateTransform>;
export function interpolateCandidate(
  input: CandidateResolvable<number>,
  inputRange: readonly [number, number],
  outputRange: readonly [
    CandidateResolvable<
      | number
      | CandidateMeasure
      | CandidateColor
      | CandidatePaint
      | CandidateShape
      | CandidateStroke
      | readonly CandidateShadow[]
      | CandidateMaterial
      | CandidateTypeStyle
      | CandidateMediaFit
      | CandidateTransform
    >,
    CandidateResolvable<
      | number
      | CandidateMeasure
      | CandidateColor
      | CandidatePaint
      | CandidateShape
      | CandidateStroke
      | readonly CandidateShadow[]
      | CandidateMaterial
      | CandidateTypeStyle
      | CandidateMediaFit
      | CandidateTransform
    >,
  ],
  options: { readonly clamp: boolean },
): CandidateExpression<
  | number
  | CandidateMeasure
  | CandidateColor
  | CandidatePaint
  | CandidateShape
  | CandidateStroke
  | readonly CandidateShadow[]
  | CandidateMaterial
  | CandidateTypeStyle
  | CandidateMediaFit
  | CandidateTransform
> {
  if (inputRange[0] === inputRange[1]) {
    throw new Error("Interpolation input range cannot have zero extent.");
  }
  return candidateExpression({
    kind: "interpolate",
    input: candidateExpressionNode(input),
    inputRange,
    outputRange: outputRange.map(candidateExpressionNode) as [
      CandidateExpressionNode,
      CandidateExpressionNode,
    ],
    clamp: options.clamp,
  });
}

export function evaluateCandidateExpression<Value>(
  expression: CandidateExpression<Value>,
  scope: Readonly<Record<string, unknown>>,
): { readonly value: Value; readonly dependencies: readonly string[] } {
  const dependencies = new Set<string>();
  const evaluate = (node: CandidateExpressionNode): unknown => {
    if (node.kind === "literal") return node.value;
    if (node.kind === "read") {
      if (!(node.path in scope)) throw new Error(`Unknown expression dependency "${node.path}".`);
      dependencies.add(node.path);
      return scope[node.path];
    }
    if (node.kind === "structure-reference") {
      const key = evaluate(node.key);
      if (key === null || key === undefined) return undefined;
      if (typeof key !== "string" && typeof key !== "number") {
        throw new Error(`Structure reference "${node.prefix}" needs a scalar key.`);
      }
      return {
        key: `${node.prefix}:${String(key)}`,
        role: node.role,
      } as CandidateStructureReference;
    }
    if (node.kind === "choose") {
      const condition = candidateBoolean(evaluate(node.condition), "choose condition");
      return evaluate(condition ? node.whenTrue : node.whenFalse);
    }
    if (node.kind === "equal")
      return candidateValueEqual(evaluate(node.left), evaluate(node.right));
    if (node.kind === "and") {
      for (const value of node.values) {
        if (!candidateBoolean(evaluate(value), "and operand")) return false;
      }
      return true;
    }
    if (node.kind === "or") {
      for (const value of node.values) {
        if (candidateBoolean(evaluate(value), "or operand")) return true;
      }
      return false;
    }
    if (node.kind === "not") return !candidateBoolean(evaluate(node.value), "not operand");
    if (node.kind === "add") {
      const left = candidateNumericValue(evaluate(node.left), "left add operand");
      const right = candidateNumericValue(evaluate(node.right), "right add operand");
      return combineCandidateNumericValues(left, right, (a, b) => a + b);
    }
    if (node.kind === "scale") {
      const value = candidateNumericValue(evaluate(node.value), "scaled value");
      const factor = candidateNumber(evaluate(node.factor), "scale factor");
      return typeof value === "number"
        ? value * factor
        : { dimension: value.dimension, value: value.value * factor };
    }
    if (node.kind === "compare") {
      const left = candidateNumericValue(evaluate(node.left), "left comparison operand");
      const right = candidateNumericValue(evaluate(node.right), "right comparison operand");
      const [leftValue, rightValue] = candidateComparableValues(left, right);
      if (node.relation === "less") return leftValue < rightValue;
      if (node.relation === "lessOrEqual") return leftValue <= rightValue;
      if (node.relation === "greater") return leftValue > rightValue;
      return leftValue >= rightValue;
    }
    if (node.kind === "clamp") {
      const value = candidateNumericValue(evaluate(node.value), "clamp value");
      const minimum = candidateNumericValue(evaluate(node.minimum), "clamp minimum");
      const maximum = candidateNumericValue(evaluate(node.maximum), "clamp maximum");
      const [valueNumber, minimumNumber] = candidateComparableValues(value, minimum);
      const [, maximumNumber] = candidateComparableValues(value, maximum);
      if (minimumNumber > maximumNumber) throw new Error("Clamp bounds are reversed.");
      const clamped = Math.min(maximumNumber, Math.max(minimumNumber, valueNumber));
      return typeof value === "number" ? clamped : { dimension: value.dimension, value: clamped };
    }
    if (node.kind === "normalize") {
      const value = candidateNumericValue(evaluate(node.value), "normalization value");
      const start = candidateNumericValue(evaluate(node.range[0]), "normalization range start");
      const end = candidateNumericValue(evaluate(node.range[1]), "normalization range end");
      const [valueNumber, startNumber] = candidateComparableValues(value, start);
      const [, endNumber] = candidateComparableValues(value, end);
      if (startNumber === endNumber)
        throw new Error("Normalization range cannot have zero extent.");
      const progress = (valueNumber - startNumber) / (endNumber - startNumber);
      return node.clamp ? Math.min(1, Math.max(0, progress)) : progress;
    }
    const input = candidateNumber(evaluate(node.input), "interpolation input");
    const progress = (input - node.inputRange[0]) / (node.inputRange[1] - node.inputRange[0]);
    const resolved = node.clamp ? Math.min(1, Math.max(0, progress)) : progress;
    return interpolateCandidateValues(
      evaluate(node.outputRange[0]),
      evaluate(node.outputRange[1]),
      resolved,
    );
  };
  return {
    value: evaluate(expression.expression) as Value,
    dependencies: [...dependencies].sort(),
  };
}

function candidateBoolean(value: unknown, owner: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${owner} must resolve to a boolean.`);
  return value;
}

function candidateNumber(value: unknown, owner: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${owner} must resolve to a finite number.`);
  }
  return value;
}

function candidateLength(value: unknown, owner: string): CandidateLength {
  if (
    typeof value !== "object" ||
    value === null ||
    !("dimension" in value) ||
    value.dimension !== "length" ||
    !("value" in value)
  ) {
    throw new Error(`${owner} must resolve to a length.`);
  }
  return { dimension: "length", value: candidateNumber(value.value, owner) };
}

function candidateNumericValue(value: unknown, owner: string): number | CandidateMeasure {
  if (typeof value === "number") return candidateNumber(value, owner);
  if (
    typeof value === "object" &&
    value !== null &&
    "dimension" in value &&
    ["length", "angle", "time"].includes(String(value.dimension)) &&
    "value" in value
  ) {
    return {
      dimension: value.dimension as CandidateMeasure["dimension"],
      value: candidateNumber(value.value, owner),
    } as CandidateMeasure;
  }
  throw new Error(`${owner} must resolve to a scalar or measure.`);
}

function candidateComparableValues(
  left: number | CandidateMeasure,
  right: number | CandidateMeasure,
): readonly [number, number] {
  if (typeof left === "number" && typeof right === "number") return [left, right];
  if (typeof left === "number" || typeof right === "number" || left.dimension !== right.dimension) {
    throw new Error("Numeric operands must have the same dimension.");
  }
  return [left.value, right.value];
}

function combineCandidateNumericValues(
  left: number | CandidateMeasure,
  right: number | CandidateMeasure,
  combine: (left: number, right: number) => number,
): number | CandidateMeasure {
  const [leftValue, rightValue] = candidateComparableValues(left, right);
  const value = combine(leftValue, rightValue);
  return typeof left === "number" ? value : { dimension: left.dimension, value };
}

function interpolateCandidateValues(from: unknown, to: unknown, progress: number): unknown {
  if (isCandidatePaint(from) || isCandidatePaint(to)) {
    if (!isCandidatePaint(from) || !isCandidatePaint(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidatePaint(from, to, progress);
  }
  if (isCandidateColor(from) || isCandidateColor(to)) {
    if (!isCandidateColor(from) || !isCandidateColor(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    let fromHue = from.hue;
    let toHue = to.hue;
    if (toHue - fromHue > 180) fromHue += 360;
    else if (toHue - fromHue < -180) toHue += 360;
    const alpha = from.alpha + (to.alpha - from.alpha) * progress;
    const lightness =
      from.lightness * from.alpha +
      (to.lightness * to.alpha - from.lightness * from.alpha) * progress;
    const chroma =
      from.chroma * from.alpha + (to.chroma * to.alpha - from.chroma * from.alpha) * progress;
    const hue = fromHue + (toHue - fromHue) * progress;
    return {
      colorSpace: "oklch",
      lightness: alpha === 0 ? lightness : lightness / alpha,
      chroma: alpha === 0 ? chroma : chroma / alpha,
      hue: ((hue % 360) + 360) % 360,
      alpha,
    } satisfies CandidateColor;
  }
  if (isCandidateShape(from) || isCandidateShape(to)) {
    if (!isCandidateShape(from) || !isCandidateShape(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateShape(from, to, progress);
  }
  if (isCandidateStroke(from) || isCandidateStroke(to)) {
    if (!isCandidateStroke(from) || !isCandidateStroke(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateStroke(from, to, progress);
  }
  if (Array.isArray(from) || Array.isArray(to)) {
    if (!Array.isArray(from) || !Array.isArray(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    validateCandidateShadows(from);
    validateCandidateShadows(to);
    return interpolateCandidateShadows(from, to, progress);
  }
  if (isCandidateMaterial(from) || isCandidateMaterial(to)) {
    if (!isCandidateMaterial(from) || !isCandidateMaterial(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateMaterial(from, to, progress);
  }
  if (isCandidateTypeStyle(from) || isCandidateTypeStyle(to)) {
    if (!isCandidateTypeStyle(from) || !isCandidateTypeStyle(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateTypeStyle(from, to, progress);
  }
  if (isCandidateMediaFit(from) || isCandidateMediaFit(to)) {
    if (!isCandidateMediaFit(from) || !isCandidateMediaFit(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateMediaFit(from, to, progress);
  }
  if (isCandidateTransform(from) || isCandidateTransform(to)) {
    if (!isCandidateTransform(from) || !isCandidateTransform(to)) {
      throw new Error("Interpolation endpoints must have the same value type.");
    }
    return interpolateCandidateTransform(from, to, progress);
  }
  const left = candidateNumericValue(from, "interpolation start");
  const right = candidateNumericValue(to, "interpolation end");
  return combineCandidateNumericValues(left, right, (a, b) => a + (b - a) * progress);
}

function isCandidatePaint(value: unknown): value is CandidatePaint {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (!("color" in value) && !("stops" in value)) return false;
  validateCandidatePaint(value);
  return true;
}

function interpolateCandidatePaint(
  from: CandidatePaint,
  to: CandidatePaint,
  progress: number,
): CandidatePaint {
  if (from.kind !== to.kind) throw new Error("Paint interpolation requires matching kinds.");
  if (from.kind === "solid" && to.kind === "solid") {
    return {
      kind: "solid",
      color: interpolateCandidateValues(from.color, to.color, progress) as CandidateColor,
    };
  }
  const gradientFrom = from as Exclude<CandidatePaint, { readonly kind: "solid" }>;
  const gradientTo = to as Exclude<CandidatePaint, { readonly kind: "solid" }>;
  if (gradientFrom.stops.length !== gradientTo.stops.length) {
    throw new Error("Gradient interpolation requires matching stop topology.");
  }
  const number = (left: number, right: number) => left + (right - left) * progress;
  const angle = (left: CandidateAngle, right: CandidateAngle): CandidateAngle => {
    let start = left.value;
    let end = right.value;
    if (end - start > 180) start += 360;
    else if (end - start < -180) end += 360;
    return { dimension: "angle", value: ((number(start, end) % 360) + 360) % 360 };
  };
  const stops = gradientFrom.stops.map((stop, index) => ({
    position: number(stop.position, gradientTo.stops[index]!.position),
    color: interpolateCandidateValues(
      stop.color,
      gradientTo.stops[index]!.color,
      progress,
    ) as CandidateColor,
  }));
  if (from.kind === "linear-gradient" && to.kind === "linear-gradient") {
    return { kind: from.kind, angle: angle(from.angle, to.angle), stops };
  }
  if (from.kind === "radial-gradient" && to.kind === "radial-gradient") {
    return {
      kind: from.kind,
      center: {
        inline: number(from.center.inline, to.center.inline),
        block: number(from.center.block, to.center.block),
      },
      radius: number(from.radius, to.radius),
      stops,
    };
  }
  if (from.kind === "conic-gradient" && to.kind === "conic-gradient") {
    return {
      kind: from.kind,
      center: {
        inline: number(from.center.inline, to.center.inline),
        block: number(from.center.block, to.center.block),
      },
      angle: angle(from.angle, to.angle),
      stops,
    };
  }
  throw new Error("Unreachable paint kind.");
}

function isCandidateColor(value: unknown): value is CandidateColor {
  if (typeof value !== "object" || value === null || !("colorSpace" in value)) return false;
  validateCandidateColor(value);
  return true;
}

function isCandidateShape(value: unknown): value is CandidateShape {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (!(["rectangle", "capsule", "ellipse", "path"] as const).includes(value.kind as never)) {
    return false;
  }
  validateCandidateShape(value);
  return true;
}

function interpolateCandidateShape(
  from: CandidateShape,
  to: CandidateShape,
  progress: number,
): CandidateShape {
  if (from.kind !== to.kind) throw new Error("Shape interpolation requires matching kinds.");
  const number = (left: number, right: number) => left + (right - left) * progress;
  if (from.kind === "rectangle" && to.kind === "rectangle") {
    const corner = (left: CandidateCorner, right: CandidateCorner): CandidateCorner => ({
      radius: {
        dimension: "length",
        value: number(left.radius.value, right.radius.value),
      },
      smoothing: number(left.smoothing, right.smoothing),
    });
    return {
      kind: "rectangle",
      corners: {
        startStart: corner(from.corners.startStart, to.corners.startStart),
        startEnd: corner(from.corners.startEnd, to.corners.startEnd),
        endStart: corner(from.corners.endStart, to.corners.endStart),
        endEnd: corner(from.corners.endEnd, to.corners.endEnd),
      },
    };
  }
  if (from.kind === "capsule" || from.kind === "ellipse") return from;
  const pathFrom = from as Extract<CandidateShape, { readonly kind: "path" }>;
  const pathTo = to as Extract<CandidateShape, { readonly kind: "path" }>;
  if (
    pathFrom.fillRule !== pathTo.fillRule ||
    pathFrom.viewBox.inlineSize !== pathTo.viewBox.inlineSize ||
    pathFrom.viewBox.blockSize !== pathTo.viewBox.blockSize
  ) {
    throw new Error("Path interpolation requires matching coordinate and fill semantics.");
  }
  if (pathFrom.commands.length !== pathTo.commands.length) {
    throw new Error("Path interpolation requires matching command topology.");
  }
  const point = (
    left: { readonly inline: number; readonly block: number },
    right: { readonly inline: number; readonly block: number },
  ) => ({ inline: number(left.inline, right.inline), block: number(left.block, right.block) });
  const commands = pathFrom.commands.map((command, index): CandidatePathCommand => {
    const destination = pathTo.commands[index]!;
    if (command.kind !== destination.kind) {
      throw new Error(`Path interpolation command ${index} changes kind.`);
    }
    if (command.kind === "close") return command;
    if (command.kind === "move" || command.kind === "line") {
      return { kind: command.kind, ...point(command, destination as typeof command) };
    }
    const sourceCurve = command as Extract<CandidatePathCommand, { readonly kind: "curve" }>;
    const curve = destination as Extract<CandidatePathCommand, { readonly kind: "curve" }>;
    return {
      kind: "curve",
      control1: point(sourceCurve.control1, curve.control1),
      control2: point(sourceCurve.control2, curve.control2),
      end: point(sourceCurve.end, curve.end),
    };
  });
  return { kind: "path", viewBox: pathFrom.viewBox, fillRule: pathFrom.fillRule, commands };
}

function candidateInterpolateNumber(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function candidateInterpolateLength(
  left: CandidateLength,
  right: CandidateLength,
  progress: number,
): CandidateLength {
  return {
    dimension: "length",
    value: candidateInterpolateNumber(left.value, right.value, progress),
  };
}

function isCandidateStroke(value: unknown): value is CandidateStroke {
  if (typeof value !== "object" || value === null || !("paint" in value) || !("width" in value)) {
    return false;
  }
  validateCandidateStroke(value);
  return true;
}

function interpolateCandidateStroke(
  from: CandidateStroke,
  to: CandidateStroke,
  progress: number,
): CandidateStroke {
  if (from.placement !== to.placement) {
    throw new Error("Stroke interpolation requires matching placement.");
  }
  if (
    (from.dash === undefined) !== (to.dash === undefined) ||
    from.dash?.length !== to.dash?.length
  ) {
    throw new Error("Stroke interpolation requires matching dash topology.");
  }
  return {
    paint: interpolateCandidatePaint(from.paint, to.paint, progress),
    width: candidateInterpolateLength(from.width, to.width, progress),
    placement: from.placement,
    ...(from.dash
      ? {
          dash: from.dash.map((dash, index) =>
            candidateInterpolateLength(dash, to.dash![index]!, progress),
          ),
        }
      : {}),
  };
}

function interpolateCandidateShadows(
  from: readonly CandidateShadow[],
  to: readonly CandidateShadow[],
  progress: number,
): readonly CandidateShadow[] {
  if (from.length !== to.length) {
    throw new Error("Shadow interpolation requires matching list topology.");
  }
  return from.map((shadow, index) => {
    const destination = to[index]!;
    if (shadow.kind !== destination.kind) {
      throw new Error(`Shadow interpolation item ${index} changes kind.`);
    }
    return {
      kind: shadow.kind,
      color: interpolateCandidateValues(
        shadow.color,
        destination.color,
        progress,
      ) as CandidateColor,
      offset: {
        inline: candidateInterpolateLength(
          shadow.offset.inline,
          destination.offset.inline,
          progress,
        ),
        block: candidateInterpolateLength(shadow.offset.block, destination.offset.block, progress),
      },
      blur: candidateInterpolateLength(shadow.blur, destination.blur, progress),
      spread: candidateInterpolateLength(shadow.spread, destination.spread, progress),
    };
  });
}

function isCandidateMaterial(value: unknown): value is CandidateMaterial {
  if (typeof value !== "object" || value === null || !("backdropBlur" in value)) return false;
  validateCandidateMaterial(value);
  return true;
}

function interpolateCandidateMaterial(
  from: CandidateMaterial,
  to: CandidateMaterial,
  progress: number,
): CandidateMaterial {
  return {
    backdropBlur: candidateInterpolateLength(from.backdropBlur, to.backdropBlur, progress),
    backdropSaturation: candidateInterpolateNumber(
      from.backdropSaturation,
      to.backdropSaturation,
      progress,
    ),
    tint: interpolateCandidatePaint(from.tint, to.tint, progress),
    noise: candidateInterpolateNumber(from.noise, to.noise, progress),
  };
}

function isCandidateTypeStyle(value: unknown): value is CandidateTypeStyle {
  if (typeof value !== "object" || value === null || !("families" in value)) return false;
  validateCandidateTypeStyle(value);
  return true;
}

function interpolateCandidateTypeStyle(
  from: CandidateTypeStyle,
  to: CandidateTypeStyle,
  progress: number,
): CandidateTypeStyle {
  const equalList = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  if (
    !equalList(from.families, to.families) ||
    from.align !== to.align ||
    from.wrap !== to.wrap ||
    from.overflow !== to.overflow ||
    from.decoration !== to.decoration
  ) {
    throw new Error("Type interpolation requires matching text semantics.");
  }
  const axes = Object.keys(from.variations).sort();
  if (!equalList(axes, Object.keys(to.variations).sort())) {
    throw new Error("Type interpolation requires matching variation axes.");
  }
  return {
    families: from.families,
    size: candidateInterpolateLength(from.size, to.size, progress),
    lineHeight: candidateInterpolateLength(from.lineHeight, to.lineHeight, progress),
    weight: candidateInterpolateNumber(from.weight, to.weight, progress),
    tracking: candidateInterpolateLength(from.tracking, to.tracking, progress),
    align: from.align,
    wrap: from.wrap,
    overflow: from.overflow,
    decoration: from.decoration,
    variations: Object.fromEntries(
      axes.map((axis) => [
        axis,
        candidateInterpolateNumber(from.variations[axis]!, to.variations[axis]!, progress),
      ]),
    ),
  };
}

function isCandidateMediaFit(value: unknown): value is CandidateMediaFit {
  if (typeof value !== "object" || value === null || !("focalPoint" in value)) return false;
  validateCandidateMediaFit(value);
  return true;
}

function interpolateCandidateMediaFit(
  from: CandidateMediaFit,
  to: CandidateMediaFit,
  progress: number,
): CandidateMediaFit {
  if (from.mode !== to.mode) throw new Error("Media-fit interpolation requires matching modes.");
  return {
    mode: from.mode,
    focalPoint: {
      inline: candidateInterpolateNumber(from.focalPoint.inline, to.focalPoint.inline, progress),
      block: candidateInterpolateNumber(from.focalPoint.block, to.focalPoint.block, progress),
    },
  };
}

function isCandidateTransform(value: unknown): value is CandidateTransform {
  if (typeof value !== "object" || value === null || !("translation" in value)) return false;
  validateCandidateTransform(value);
  return true;
}

function interpolateCandidateTransform(
  from: CandidateTransform,
  to: CandidateTransform,
  progress: number,
): CandidateTransform {
  const number = (left: number, right: number) => left + (right - left) * progress;
  const length = (left: CandidateLength, right: CandidateLength): CandidateLength => ({
    dimension: "length",
    value: number(left.value, right.value),
  });
  return {
    translation: {
      inline: length(from.translation.inline, to.translation.inline),
      block: length(from.translation.block, to.translation.block),
      depth: length(from.translation.depth, to.translation.depth),
    },
    scale: {
      inline: number(from.scale.inline, to.scale.inline),
      block: number(from.scale.block, to.scale.block),
      depth: number(from.scale.depth, to.scale.depth),
    },
    rotation: interpolateCandidateRotation(from.rotation, to.rotation, progress),
    origin: {
      inline: number(from.origin.inline, to.origin.inline),
      block: number(from.origin.block, to.origin.block),
      depth: length(from.origin.depth, to.origin.depth),
    },
    perspective: interpolateCandidatePerspective(from.perspective, to.perspective, progress),
  };
}

type CandidateQuaternion = readonly [x: number, y: number, z: number, w: number];

function interpolateCandidateRotation(
  from: CandidateTransform["rotation"],
  to: CandidateTransform["rotation"],
  progress: number,
): CandidateTransform["rotation"] {
  const left = candidateRotationQuaternion(from);
  let right = candidateRotationQuaternion(to);
  let dot = left.reduce((sum, value, index) => sum + value * right[index]!, 0);
  if (dot < 0) {
    right = [-right[0], -right[1], -right[2], -right[3]];
    dot = -dot;
  }
  dot = Math.min(1, Math.max(-1, dot));
  let result: CandidateQuaternion;
  if (dot > 0.9995) {
    result = normalizeCandidateQuaternion([
      left[0] + (right[0] - left[0]) * progress,
      left[1] + (right[1] - left[1]) * progress,
      left[2] + (right[2] - left[2]) * progress,
      left[3] + (right[3] - left[3]) * progress,
    ]);
  } else {
    const theta = Math.acos(dot);
    const denominator = Math.sin(theta);
    const leftWeight = Math.sin((1 - progress) * theta) / denominator;
    const rightWeight = Math.sin(progress * theta) / denominator;
    result = normalizeCandidateQuaternion([
      left[0] * leftWeight + right[0] * rightWeight,
      left[1] * leftWeight + right[1] * rightWeight,
      left[2] * leftWeight + right[2] * rightWeight,
      left[3] * leftWeight + right[3] * rightWeight,
    ]);
  }
  if (result[3] < 0) result = [-result[0], -result[1], -result[2], -result[3]];
  const w = Math.min(1, Math.max(-1, result[3]));
  const sine = Math.sqrt(Math.max(0, 1 - w * w));
  if (sine < 1e-8) {
    return { axis: { x: 0, y: 0, z: 1 }, angle: { dimension: "angle", value: 0 } };
  }
  return {
    axis: { x: result[0] / sine, y: result[1] / sine, z: result[2] / sine },
    angle: { dimension: "angle", value: (2 * Math.acos(w) * 180) / Math.PI },
  };
}

function candidateRotationQuaternion(
  rotation: CandidateTransform["rotation"],
): CandidateQuaternion {
  const magnitude = Math.hypot(rotation.axis.x, rotation.axis.y, rotation.axis.z);
  const halfAngle = (rotation.angle.value * Math.PI) / 360;
  const sine = Math.sin(halfAngle);
  return normalizeCandidateQuaternion([
    (rotation.axis.x / magnitude) * sine,
    (rotation.axis.y / magnitude) * sine,
    (rotation.axis.z / magnitude) * sine,
    Math.cos(halfAngle),
  ]);
}

function normalizeCandidateQuaternion(value: CandidateQuaternion): CandidateQuaternion {
  const magnitude = Math.hypot(...value);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Quaternion cannot be zero or nonfinite.");
  }
  return [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude, value[3] / magnitude];
}

function interpolateCandidatePerspective(
  from: CandidateLength | "none",
  to: CandidateLength | "none",
  progress: number,
): CandidateLength | "none" {
  const fromReciprocal = from === "none" ? 0 : 1 / from.value;
  const toReciprocal = to === "none" ? 0 : 1 / to.value;
  const reciprocal = fromReciprocal + (toReciprocal - fromReciprocal) * progress;
  return Math.abs(reciprocal) < Number.EPSILON
    ? "none"
    : { dimension: "length", value: 1 / reciprocal };
}

function candidateValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => candidateValueEqual(value, right[index]))
    );
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
    const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every(
        ([key, value], index) =>
          rightEntries[index]?.[0] === key && candidateValueEqual(value, rightEntries[index]?.[1]),
      )
    );
  }
  return false;
}

function candidateExpression<Value>(
  expression: CandidateExpressionNode,
): CandidateExpression<Value> {
  return {
    expression,
    choose<WhenTrue, WhenFalse>(
      whenTrue: CandidateResolvable<WhenTrue>,
      whenFalse: CandidateResolvable<WhenFalse>,
    ) {
      return candidateExpression<WhenTrue | WhenFalse>({
        kind: "choose",
        condition: expression,
        whenTrue: candidateExpressionNode(whenTrue),
        whenFalse: candidateExpressionNode(whenFalse),
      });
    },
  } as CandidateExpression<Value>;
}

function candidateExpressionNode(value: unknown): CandidateExpressionNode {
  if (typeof value === "object" && value !== null && "expression" in value && "choose" in value) {
    return (value as CandidateExpression<unknown>).expression;
  }
  return { kind: "literal", value };
}

export type CandidateDrawingTargets = {
  readonly identity: CandidatePresentationIdentity;
  readonly presence: {
    readonly phase: CandidateExpression<"entering" | "present" | "exiting" | "absent">;
    readonly present: CandidateExpression<boolean>;
  };
  readonly opacity: CandidateTargetHandle<number>;
  readonly fill: CandidateTargetHandle<CandidatePaint>;
  readonly shape: CandidateTargetHandle<CandidateShape>;
  readonly stroke: CandidateTargetHandle<CandidateStroke | "none">;
  readonly shadows: CandidateTargetHandle<readonly CandidateShadow[]>;
  readonly material: CandidateTargetHandle<CandidateMaterial | "none">;
  readonly blockSize: CandidateTargetHandle<CandidateLength>;
  readonly transform: CandidateTargetHandle<CandidateTransform>;
  readonly geometry: CandidateDerivedTargetHandle<CandidateGeometry>;
};

export type CandidatePartTargets = CandidateDrawingTargets & {
  readonly foreground: CandidateTargetHandle<CandidatePaint>;
  readonly type: CandidateTargetHandle<CandidateTypeStyle>;
  readonly mediaFit: CandidateTargetHandle<CandidateMediaFit>;
  readonly interaction: {
    readonly hovered: CandidateExpression<boolean>;
    readonly focusWithin: CandidateExpression<boolean>;
  };
};

export type CandidateGeneratedLayer = CandidateDrawingTargets & {
  readonly generated: true;
  readonly owner: CandidatePresentationIdentity;
};

export type CandidateFocusCapability = {
  readonly indicator: CandidateGeneratedLayer;
  readonly fallback: "native";
};

export type CandidateTextEntryCapability = {
  readonly caret: CandidateTargetHandle<CandidatePaint>;
  readonly selectionFill: CandidateTargetHandle<CandidatePaint>;
  readonly selectionText: CandidateTargetHandle<CandidatePaint>;
  readonly placeholder: CandidateTargetHandle<CandidateTypeStyle>;
};

export type CandidateNativeLayerHandle<Kind extends "modal" | "popover"> = {
  readonly key: string;
  readonly kind: Kind;
  readonly [candidateNativeLayerValue]: Kind;
};

type CandidatePartTargetsFor<Element extends string> = CandidatePartTargets &
  (Element extends "dialog"
    ? { readonly nativeLayer: CandidateNativeLayerHandle<"modal"> }
    : Element extends "popover"
      ? { readonly nativeLayer: CandidateNativeLayerHandle<"popover"> }
      : {}) &
  (Element extends "button" | "a" | "input" | "select" | "textarea" | "text-input"
    ? {
        readonly focus: CandidateFocusCapability;
        readonly interaction: CandidatePartTargets["interaction"] & {
          readonly pressed: CandidateExpression<boolean>;
          readonly focusVisible: CandidateExpression<boolean>;
        };
      }
    : {}) &
  (Element extends "textarea" | "text-input"
    ? { readonly textEntry: CandidateTextEntryCapability }
    : {});

type CandidateComponentState<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = App["Components"][Component] extends { readonly States: infer State extends string }
  ? State
  : never;

type CandidateComponentRecognizers<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = App["Components"][Component] extends {
  readonly Recognizers: infer Recognizers extends Readonly<
    Record<
      string,
      | { readonly Kind: CandidateContinuousRecognizerKind; readonly Outcomes: string }
      | { readonly Kind: "longPress" | "hoverIntent" }
    >
  >;
}
  ? {
      readonly [Name in keyof Recognizers]: CandidateRecognizerHandle<
        CandidateRecognizerOutcomes<Recognizers[Name]>,
        Recognizers[Name] extends { readonly Kind: infer Kind extends CandidateRecognizerKind }
          ? Kind
          : never
      >;
    }
  : {};

type CandidateComponentParameters<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = App["Components"][Component] extends {
  readonly Parameters: infer Parameters extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Name in keyof Parameters]: Parameters[Name] extends CandidateParameter<infer Value>
        ? CandidateParameterHandle<Value>
        : never;
    }
  : {};

type CandidateComponentField<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Field extends
    | "Input"
    | "Context"
    | "Values"
    | "Actions"
    | "Commands"
    | "Tasks"
    | "Recognizers"
    | "Output"
    | "Collections"
    | "Slots",
> = App["Components"][Component] extends Readonly<Record<Field, infer Value>> ? Value : {};

type CandidateReadScope<Value> =
  Value extends Readonly<Record<string, unknown>>
    ? { readonly [Key in keyof Value]: CandidateExpression<Value[Key]> }
    : {};

export type CandidateStructureReference<
  Role extends ReferenceSemanticRole = ReferenceSemanticRole,
> = {
  readonly key: string;
  readonly role: Role;
  readonly [candidateStructureReferenceValue]: true;
};

type CandidateDefaultRole<Element extends string> = Element extends "button"
  ? "button"
  : Element extends "a"
    ? "link"
    : Element extends "form"
      ? "form"
      : Element extends "dialog"
        ? "dialog"
        : Element extends "input" | "textarea" | "text-input"
          ? "textbox"
          : Element extends "img"
            ? "image"
            : Element extends "select"
              ? "combobox"
              : Element extends ReferenceSemanticRole
                ? Element
                : "generic";

type CandidateAllowedRole<Element extends string> = Element extends "div" | "span"
  ? ReferenceSemanticRole
  : Element extends "img"
    ? "image"
    : Element extends "input"
      ? "textbox" | "checkbox" | "radio" | "switch" | "slider" | "combobox"
      : CandidateDefaultRole<Element>;

type CandidateNamedRole =
  | "button"
  | "link"
  | "checkbox"
  | "radio"
  | "switch"
  | "slider"
  | "textbox"
  | "combobox"
  | "listbox"
  | "dialog"
  | "alertdialog"
  | "grid"
  | "tree";

type CandidateAccessibleName<Role extends ReferenceSemanticRole> = Role extends "image"
  ? {
      readonly name?: never;
      readonly labelledBy?: never;
    }
  : Role extends CandidateNamedRole
    ?
        | {
            readonly name: CandidateResolvable<string>;
            readonly labelledBy?: never;
          }
        | {
            readonly name?: never;
            readonly labelledBy: CandidateStructureReference;
          }
    : {
        readonly name?: CandidateResolvable<string>;
        readonly labelledBy?: CandidateStructureReference;
      };

type CandidateActiveDescendantRole<Role extends ReferenceSemanticRole> = Role extends
  | "combobox"
  | "listbox"
  ? "option"
  : Role extends "grid"
    ? "row" | "gridcell"
    : Role extends "tree"
      ? "treeitem"
      : never;

type CandidateStructureRelationships<Role extends ReferenceSemanticRole> = {
  readonly describedBy?: CandidateStructureReference;
  readonly formOwner?: CandidateStructureReference<"form">;
  readonly errorMessage?: CandidateStructureReference<"status" | "alert">;
} & ([CandidateActiveDescendantRole<Role>] extends [never]
  ? { readonly activeDescendant?: never }
  : {
      readonly activeDescendant?: CandidateResolvable<
        CandidateStructureReference<CandidateActiveDescendantRole<Role>> | undefined
      >;
    }) &
  (Role extends "button" | "combobox"
    ? {
        readonly controls?: CandidateStructureReference;
        readonly popup?: "dialog" | "menu" | "listbox" | "tree" | "grid";
      }
    : { readonly controls?: never; readonly popup?: never });

type CandidateStructureStates<Role extends ReferenceSemanticRole> = {
  readonly hidden?: CandidateResolvable<boolean>;
  readonly inert?: CandidateResolvable<boolean>;
  readonly focusable?: CandidateResolvable<boolean>;
} & (Role extends
  | "button"
  | "link"
  | "checkbox"
  | "radio"
  | "switch"
  | "slider"
  | "textbox"
  | "combobox"
  | "listbox"
  | "option"
  | "tab"
  | "treeitem"
  ? { readonly disabled?: CandidateResolvable<boolean> }
  : { readonly disabled?: never }) &
  (Role extends "checkbox" | "radio" | "switch"
    ? { readonly checked?: CandidateResolvable<boolean | "mixed"> }
    : { readonly checked?: never }) &
  (Role extends "option" | "tab" | "row" | "gridcell" | "treeitem"
    ? { readonly selected?: CandidateResolvable<boolean> }
    : { readonly selected?: never }) &
  (Role extends "button" | "combobox" | "treeitem"
    ? { readonly expanded?: CandidateResolvable<boolean> }
    : { readonly expanded?: never }) &
  (Role extends "textbox" | "combobox" | "checkbox" | "radio" | "switch" | "slider"
    ? { readonly invalid?: CandidateResolvable<boolean> }
    : { readonly invalid?: never }) &
  (Role extends "dialog" | "alertdialog"
    ? { readonly modal?: CandidateResolvable<boolean> }
    : { readonly modal?: never });

type CandidateStructureActions<Role extends ReferenceSemanticRole> = Role extends "button"
  ? { readonly activate: () => void }
  : Role extends "link"
    ? {
        readonly destination: CandidateResolvable<string>;
        readonly activate?: () => void;
      }
    : Role extends "form"
      ? { readonly submit: () => void }
      : Role extends "textbox" | "combobox"
        ? {
            readonly value: CandidateResolvable<string>;
            readonly change: (value: string) => void;
          }
        : Role extends "checkbox" | "radio" | "switch"
          ? { readonly change: (checked: boolean) => void }
          : Role extends "slider"
            ? {
                readonly value: CandidateResolvable<number>;
                readonly minimum: CandidateResolvable<number>;
                readonly maximum: CandidateResolvable<number>;
                readonly step: CandidateResolvable<number>;
                readonly largeStep: CandidateResolvable<number>;
                readonly change: (value: number) => void;
              }
            : Role extends "dialog" | "alertdialog"
              ? { readonly dismiss: () => void }
              : Role extends "option" | "tab" | "treeitem"
                ? { readonly activate?: () => void }
                : {};

type CandidateStructureMedia<Role extends ReferenceSemanticRole> = Role extends "image"
  ? {
      readonly source: CandidateResolvable<string>;
      readonly alternative: CandidateResolvable<string> | { readonly kind: "decorative" };
    }
  : {
      readonly source?: never;
      readonly alternative?: never;
    };

export type CandidateStructureProps<Role extends ReferenceSemanticRole> = {
  readonly key?: string | number;
} & CandidateAccessibleName<Role> &
  CandidateStructureRelationships<Role> &
  CandidateStructureStates<Role> &
  CandidateStructureActions<Role> &
  CandidateStructureMedia<Role>;

export type CandidateStructureChild =
  | CandidateStructureNode
  | CandidateStructureComponentInstance
  | CandidateStructureSelection
  | readonly CandidateStructureChild[]
  | string
  | number
  | false
  | null
  | undefined;

export type CandidateStructureSelection = {
  readonly kind: "selection";
  readonly value: CandidateResolvable<string | boolean>;
  readonly cases: Readonly<
    Record<
      string,
      {
        readonly content: CandidateStructureChild;
        readonly focus?: CandidateStructureReference;
      }
    >
  >;
  readonly [candidateStructureSelectionValue]: true;
};

type CandidateStructureSelectionKey<Value extends string | boolean> = Value extends boolean
  ? `${Value}`
  : Value;

type CandidateStructureSelectionCases<Value extends string | boolean> =
  | {
      readonly [Key in CandidateStructureSelectionKey<Value>]: {
        readonly content: CandidateStructureChild;
        readonly focus: CandidateStructureReference;
      };
    }
  | {
      readonly [Key in CandidateStructureSelectionKey<Value>]: {
        readonly content: CandidateStructureChild;
        readonly focus?: never;
      };
    };

export function selectCandidateStructure<const Value extends string | boolean>(
  value: CandidateResolvable<Value>,
  cases: CandidateStructureSelectionCases<NoInfer<Value>>,
): CandidateStructureSelection {
  if (Object.keys(cases).length === 0) {
    throw new Error("A structural selection needs at least one case.");
  }
  return { kind: "selection", value, cases } as unknown as CandidateStructureSelection;
}

export type CandidateStructureNode<
  Role extends ReferenceSemanticRole = ReferenceSemanticRole,
  Part extends string = string,
> = {
  readonly identity: string;
  readonly element: string;
  readonly part: Part;
  readonly role: Role;
  readonly reference: CandidateStructureReference<Role>;
  readonly props: CandidateStructureProps<Role>;
  readonly children: readonly CandidateStructureChild[];
  readonly [candidateStructureNodeValue]: true;
};

export type CandidateStructurePart<Element extends string, Part extends string = string> = {
  <Role extends CandidateAllowedRole<Element>>(
    props: CandidateStructureProps<Role> & { readonly role: Role },
    ...children: readonly CandidateStructureChild[]
  ): CandidateStructureNode<Role, Part>;
  (
    props: CandidateStructureProps<CandidateDefaultRole<Element>>,
    ...children: readonly CandidateStructureChild[]
  ): CandidateStructureNode<CandidateDefaultRole<Element>, Part>;
  readonly key: string;
  readonly part: Part;
  readonly element: Element;
};

export type CandidateKeyedStructurePart<
  Element extends string,
  Part extends string,
  Role extends CandidateAllowedRole<Element>,
> = {
  (
    props: CandidateStructureProps<Role> & { readonly role?: never; readonly key?: never },
    ...children: readonly CandidateStructureChild[]
  ): CandidateStructureNode<Role, Part>;
  readonly key: string;
  readonly part: Part;
  readonly element: Element;
  readonly role: Role;
};

export type CandidateStructureCollectionHandle<
  Item extends object,
  Key extends CandidateScalarKeyOf<Item>,
  Part extends string,
  Element extends string,
  Role extends CandidateAllowedRole<Element>,
> = {
  readonly key: string;
  readonly part: Part;
  readonly render: (
    items: readonly Item[],
    renderItem: (
      item: Item,
      index: number,
      part: CandidateKeyedStructurePart<Element, Part, Role>,
    ) => CandidateStructureNode<Role, Part>,
  ) => readonly CandidateStructureNode<Role, Part>[];
  readonly reference: (
    key: CandidateResolvable<Item[Key] | null | undefined>,
  ) => CandidateExpression<CandidateStructureReference<Role> | undefined>;
  readonly keyField: Key;
  readonly role: Role;
};

type CandidateStructureCollections<App extends CandidateApp, Component extends ComponentName<App>> =
  CandidateComponentField<App, Component, "Collections"> extends infer Collections extends Readonly<
    Record<string, unknown>
  >
    ? {
        readonly [Name in keyof Collections]: Collections[Name] extends {
          readonly [candidateKeyedCollectionContractValue]: {
            readonly item: infer Item extends object;
            readonly key: infer Key;
            readonly part: infer Part extends string;
            readonly role: infer Role extends ReferenceSemanticRole;
          };
        }
          ? Key extends CandidateScalarKeyOf<Item>
            ? Part extends PartName<App, Component>
              ? Role extends CandidateAllowedRole<App["Components"][Component]["Parts"][Part]>
                ? CandidateStructureCollectionHandle<
                    Item,
                    Key,
                    Part,
                    App["Components"][Component]["Parts"][Part],
                    Role
                  >
                : never
              : never
            : never
          : never;
      }
    : {};

type CandidateSlotContractValue<App extends CandidateApp, Contract> = Contract extends {
  readonly [candidateSlotContractValue]: {
    readonly component: infer Child extends string;
    readonly cardinality: infer Cardinality extends CandidateSlotCardinality;
  };
}
  ? Child extends ComponentName<App>
    ? Cardinality extends "many"
      ? readonly CandidateStructureComponentInstance<Child>[]
      : Cardinality extends "optional"
        ? CandidateStructureComponentInstance<Child> | undefined
        : CandidateStructureComponentInstance<Child>
    : never
  : never;

type CandidateStructureSlots<App extends CandidateApp, Component extends ComponentName<App>> =
  CandidateComponentField<App, Component, "Slots"> extends infer Slots extends Readonly<
    Record<string, unknown>
  >
    ? { readonly [Name in keyof Slots]: CandidateSlotContractValue<App, Slots[Name]> }
    : {};

type CandidateRequiredSlotInputs<
  App extends CandidateApp,
  Slots extends Readonly<Record<string, unknown>>,
> = {
  readonly [Name in keyof Slots as Slots[Name] extends {
    readonly [candidateSlotContractValue]: { readonly cardinality: "optional" };
  }
    ? never
    : Name]: CandidateSlotContractValue<App, Slots[Name]>;
};

type CandidateOptionalSlotInputs<
  App extends CandidateApp,
  Slots extends Readonly<Record<string, unknown>>,
> = {
  readonly [Name in keyof Slots as Slots[Name] extends {
    readonly [candidateSlotContractValue]: { readonly cardinality: "optional" };
  }
    ? Name
    : never]?: Exclude<CandidateSlotContractValue<App, Slots[Name]>, undefined>;
};

type CandidateComponentInstanceProps<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = CandidateComponentField<App, Component, "Input"> &
  (CandidateComponentField<App, Component, "Slots"> extends infer Slots extends Readonly<
    Record<string, unknown>
  >
    ? CandidateRequiredSlotInputs<App, Slots> & CandidateOptionalSlotInputs<App, Slots>
    : {});

type CandidateStructureComponentConstructors<App extends CandidateApp> = {
  readonly [Component in ComponentName<App>]: (
    props: CandidateComponentInstanceProps<App, Component>,
  ) => CandidateStructureComponentInstance<Component>;
};

export type CandidateStructureScope<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = {
  readonly input: CandidateComponentField<App, Component, "Input">;
  readonly context: CandidateComponentField<App, Component, "Context">;
  readonly values: CandidateComponentField<App, Component, "Values">;
  readonly actions: CandidateComponentField<App, Component, "Actions">;
  readonly components: CandidateStructureComponentConstructors<App>;
  readonly select: typeof selectCandidateStructure;
  readonly parts: {
    readonly [Part in PartName<App, Component>]: CandidateStructurePart<
      App["Components"][Component]["Parts"][Part],
      Part
    >;
  };
  readonly state: {
    readonly matches: (
      state: CandidateComponentState<App, Component>,
    ) => CandidateExpression<boolean>;
  };
  readonly collections: CandidateStructureCollections<App, Component>;
  readonly slots: CandidateStructureSlots<App, Component>;
};

export type CandidateStructureDefinition<App extends CandidateApp> = {
  readonly components: {
    readonly [Component in ComponentName<App>]: (
      scope: CandidateStructureScope<App, Component>,
    ) => CandidateStructureChild;
  };
};

type CandidateActionArgs<Action> = Action extends (...args: infer Args) => unknown ? Args : never;

type CandidateRecognizerContractField<Contract, Field extends "Kind" | "Outcomes"> =
  Contract extends Readonly<Record<Field, infer Value>> ? Value : never;

type CandidateRecognizerOutcomes<Contract> = Contract extends { readonly Kind: "hoverIntent" }
  ? "engaged" | "disengaged"
  : Contract extends { readonly Kind: "longPress" }
    ? "recognized" | "released" | "cancelled"
    : CandidateRecognizerContractField<Contract, "Outcomes"> & string;

type CandidateRecognizerOutcomesForKind<Kind extends CandidateRecognizerKind> =
  Kind extends "hoverIntent"
    ? "engaged" | "disengaged"
    : Kind extends "longPress"
      ? "recognized" | "released" | "cancelled"
      : string;

export type CandidateRecognizerActivation<Kind extends CandidateRecognizerKind> = Kind extends
  | "drag"
  | "pan"
  ? {
      readonly axis: "inline" | "block" | "both";
      readonly threshold: CandidateLength;
    }
  : Kind extends "pinch"
    ? { readonly threshold: number }
    : Kind extends "rotate"
      ? { readonly threshold: CandidateAngle }
      : Kind extends "longPress"
        ? {
            readonly duration: CandidateTime;
            readonly movementTolerance: CandidateLength;
          }
        : {
            readonly dwell: CandidateTime;
            readonly maximumSpeed: CandidateRate<CandidateLength>;
            readonly leaveDelay: CandidateTime;
          };

type CandidateRecognizerScrollCompetition<Part extends string> = {
  readonly owner: Part;
  readonly boundary: "start" | "end";
  readonly outward: "negative" | "positive";
};

type CandidateParameterNamesFor<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Value,
> = App["Components"][Component] extends {
  readonly Parameters: infer Parameters extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Parameter in keyof Parameters]: Parameters[Parameter] extends CandidateParameter<Value>
        ? Parameter
        : never;
    }[keyof Parameters] &
      string
  : never;

type CandidateRecognizerAutoScroll<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = {
  readonly owner: PartName<App, Component>;
  readonly edgeFraction: CandidateParameterNamesFor<App, Component, number>;
  readonly maximumViewportPerSecond: CandidateParameterNamesFor<App, Component, number>;
};

type CandidateRecognizerAlternative<
  Kind extends CandidateRecognizerKind,
  Action extends string,
> = Kind extends "hoverIntent"
  ? { readonly kind: "focus" }
  : { readonly kind: "action"; readonly action: Action };

export type CandidateRecognizerDefinitions<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> =
  CandidateComponentField<App, Component, "Recognizers"> extends infer Recognizers extends Readonly<
    Record<string, unknown>
  >
    ? {
        readonly [Recognizer in keyof Recognizers]: {
          readonly region: PartName<App, Component>;
          readonly activation: CandidateRecognizerActivation<
            CandidateRecognizerContractField<Recognizers[Recognizer], "Kind"> &
              CandidateRecognizerKind
          >;
          readonly scroll?: CandidateRecognizerContractField<
            Recognizers[Recognizer],
            "Kind"
          > extends "drag" | "pan"
            ? CandidateRecognizerScrollCompetition<PartName<App, Component>>
            : never;
          readonly autoScroll?: CandidateRecognizerContractField<
            Recognizers[Recognizer],
            "Kind"
          > extends "drag" | "pan"
            ? CandidateRecognizerAutoScroll<App, Component>
            : never;
          readonly handoff?: CandidateRecognizerContractField<
            Recognizers[Recognizer],
            "Kind"
          > extends "hoverIntent"
            ? {
                readonly destination: PartName<App, Component>;
                readonly corridor: "safe-polygon";
              }
            : never;
          readonly outcomes: {
            readonly [Outcome in CandidateRecognizerOutcomes<Recognizers[Recognizer]>]: {
              readonly action: Extract<
                keyof CandidateComponentField<App, Component, "Actions">,
                string
              >;
            };
          };
          readonly alternative: CandidateRecognizerAlternative<
            CandidateRecognizerContractField<Recognizers[Recognizer], "Kind"> &
              CandidateRecognizerKind,
            Extract<keyof CandidateComponentField<App, Component, "Actions">, string>
          >;
          readonly available?: (scope: CandidatePureBehaviorScope<App, Component>) => boolean;
          readonly relations?: readonly (
            | {
                readonly kind: "simultaneous";
                readonly with: Exclude<Extract<keyof Recognizers, string>, Recognizer>;
              }
            | {
                readonly kind: "exclusive";
                readonly with: Exclude<Extract<keyof Recognizers, string>, Recognizer>;
                readonly prefer: "self" | "other";
              }
            | {
                readonly kind: "afterFailure";
                readonly with: Exclude<Extract<keyof Recognizers, string>, Recognizer>;
              }
          )[];
        };
      }
    : {};

export type CandidateRecognizerScene = {
  readonly intents: readonly {
    readonly name: string;
    readonly kind: CandidateRecognizerKind;
    readonly region: string;
    readonly activation: CandidateRecognizerActivation<CandidateRecognizerKind>;
    readonly scroll?: CandidateRecognizerScrollCompetition<string>;
    readonly autoScroll?: {
      readonly owner: string;
      readonly edgeFraction: string;
      readonly maximumViewportPerSecond: string;
    };
    readonly handoff?: { readonly destination: string; readonly corridor: "safe-polygon" };
    readonly outcomes: readonly { readonly outcome: string; readonly action: string }[];
    readonly alternative:
      | { readonly kind: "action"; readonly action: string }
      | { readonly kind: "focus" };
    readonly available?: string;
  }[];
  readonly relations: readonly {
    readonly kind: "simultaneous" | "exclusive" | "afterFailure";
    readonly first: string;
    readonly second: string;
  }[];
};

export function normalizeCandidateRecognizers<
  App extends CandidateApp,
  Component extends ComponentName<App>,
>(
  component: Component,
  definitions: CandidateRecognizerDefinitions<App, Component>,
  contract: Readonly<
    Record<string, { readonly kind: CandidateRecognizerKind; readonly outcomes: readonly string[] }>
  >,
  declaredParts: ReadonlySet<string>,
  declaredActions: ReadonlySet<string>,
  declaredParameters: ReadonlySet<string> = new Set(),
): CandidateRecognizerScene {
  const records = definitions as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  const names = Object.keys(contract).sort();
  if (Object.keys(records).sort().join("\0") !== names.join("\0")) {
    throw new Error(`Gesture intents for "${component}" do not match its generic contract.`);
  }
  const intents: CandidateRecognizerScene["intents"][number][] = [];
  const relations: CandidateRecognizerScene["relations"][number][] = [];
  for (const gesture of names) {
    const definition = records[gesture]!;
    const gestureContract = contract[gesture]!;
    const semanticOutcomes = candidateRecognizerRuntimeOutcomes(
      gestureContract.kind,
      gestureContract.outcomes,
    );
    const region = String(definition.region);
    if (!declaredParts.has(region)) {
      throw new Error(`Gesture "${gesture}" references unknown region part "${region}".`);
    }
    const alternativeRecord = candidateRecord(
      definition.alternative,
      `recognizer "${gesture}" alternative`,
    );
    const alternative =
      alternativeRecord.kind === "focus"
        ? ({ kind: "focus" } as const)
        : ({ kind: "action", action: String(alternativeRecord.action) } as const);
    if (gestureContract.kind === "hoverIntent") {
      if (alternative.kind !== "focus") {
        throw new Error(`Hover intent "${gesture}" requires focus equivalence.`);
      }
    } else if (alternative.kind !== "action" || !declaredActions.has(alternative.action)) {
      throw new Error(`Recognizer "${gesture}" needs a declared alternative action.`);
    }
    const outcomes = Object.entries(
      definition.outcomes as Readonly<Record<string, { readonly action: string }>>,
    )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([outcome, value]) => {
        if (!declaredActions.has(value.action)) {
          throw new Error(
            `Gesture "${gesture}" references unknown outcome action "${value.action}".`,
          );
        }
        return { outcome, action: value.action };
      });
    if (outcomes.map((outcome) => outcome.outcome).join("\0") !== semanticOutcomes.join("\0")) {
      throw new Error(`Gesture "${gesture}" outcomes do not match its generic contract.`);
    }
    validateCandidateRecognizerActivation(gesture, gestureContract.kind, definition.activation);
    const scroll = definition.scroll as CandidateRecognizerScrollCompetition<string> | undefined;
    if (scroll) {
      if (gestureContract.kind !== "drag" && gestureContract.kind !== "pan") {
        throw new Error("Only drag and pan gestures can compete with native scrolling.");
      }
      if (!declaredParts.has(scroll.owner)) {
        throw new Error(`Gesture "${gesture}" references unknown scroll owner "${scroll.owner}".`);
      }
      if ((definition.activation as { readonly axis?: unknown }).axis === "both") {
        throw new Error(`Scroll-competing gesture "${gesture}" needs one logical axis.`);
      }
    }
    const autoScroll = definition.autoScroll as
      | {
          readonly owner: string;
          readonly edgeFraction: string;
          readonly maximumViewportPerSecond: string;
        }
      | undefined;
    if (autoScroll) {
      if (gestureContract.kind !== "drag" && gestureContract.kind !== "pan") {
        throw new Error("Only drag and pan recognizers can drive auto-scroll.");
      }
      if (!declaredParts.has(autoScroll.owner)) {
        throw new Error(
          `Recognizer "${gesture}" references unknown auto-scroll owner "${autoScroll.owner}".`,
        );
      }
      if ((definition.activation as { readonly axis?: unknown }).axis === "both") {
        throw new Error(`Auto-scrolling recognizer "${gesture}" needs one logical axis.`);
      }
      for (const parameter of [autoScroll.edgeFraction, autoScroll.maximumViewportPerSecond]) {
        if (!declaredParameters.has(parameter)) {
          throw new Error(
            `Recognizer "${gesture}" references unknown auto-scroll parameter "${parameter}".`,
          );
        }
      }
    }
    const handoff = definition.handoff as
      | { readonly destination: string; readonly corridor: "safe-polygon" }
      | undefined;
    if (handoff) {
      if (gestureContract.kind !== "hoverIntent") {
        throw new Error("Only hover intent can declare a safe-polygon handoff.");
      }
      if (!declaredParts.has(handoff.destination) || handoff.destination === region) {
        throw new Error(`Hover intent "${gesture}" has an invalid handoff destination.`);
      }
      if (handoff.corridor !== "safe-polygon") {
        throw new Error(`Hover intent "${gesture}" has an unknown handoff corridor.`);
      }
    }
    intents.push({
      name: gesture,
      kind: gestureContract.kind,
      region,
      activation: definition.activation as CandidateRecognizerActivation<CandidateRecognizerKind>,
      ...(scroll ? { scroll } : {}),
      ...(autoScroll ? { autoScroll } : {}),
      ...(handoff ? { handoff } : {}),
      outcomes,
      alternative,
      ...(definition.available
        ? { available: `${component}.recognizer.${gesture}.available` }
        : {}),
    });
    for (const relation of (definition.relations ?? []) as readonly {
      readonly kind: "simultaneous" | "exclusive" | "afterFailure";
      readonly with: string;
      readonly prefer?: "self" | "other";
    }[]) {
      if (!contract[relation.with] || relation.with === gesture) {
        throw new Error(`Gesture "${gesture}" has an invalid relation to "${relation.with}".`);
      }
      if (relation.kind === "exclusive" && relation.prefer === undefined) {
        throw new Error(
          `Exclusive gesture relation "${gesture}" needs an explicit tie preference.`,
        );
      }
      relations.push({
        kind: relation.kind,
        first:
          relation.kind === "exclusive" && relation.prefer === "other" ? relation.with : gesture,
        second:
          relation.kind === "exclusive" && relation.prefer === "other" ? gesture : relation.with,
      });
    }
  }
  const pairs = new Set<string>();
  for (const relation of relations) {
    const firstRegion = intents.find((intent) => intent.name === relation.first)!.region;
    const secondRegion = intents.find((intent) => intent.name === relation.second)!.region;
    if (firstRegion !== secondRegion) {
      throw new Error(
        `Gestures "${relation.first}" and "${relation.second}" use different regions and cannot arbitrate.`,
      );
    }
    const pair = [relation.first, relation.second].sort().join("\0");
    if (pairs.has(pair))
      throw new Error(`Gesture pair "${pair.replace("\0", " / ")}" has two relations.`);
    pairs.add(pair);
  }
  for (let left = 0; left < intents.length; left++) {
    for (let right = left + 1; right < intents.length; right++) {
      const first = intents[left]!;
      const second = intents[right]!;
      if (
        first.region === second.region &&
        !pairs.has([first.name, second.name].sort().join("\0"))
      ) {
        throw new Error(
          `Gesture conflict has no explicit relationship: ${first.name}, ${second.name}.`,
        );
      }
    }
  }
  for (const region of new Set(intents.map((intent) => intent.region))) {
    const regionNames = intents
      .filter((intent) => intent.region === region)
      .map((intent) => intent.name);
    if (regionNames.length < 2) continue;
    const regionSet = new Set(regionNames);
    resolveReferenceGestureArbitration(
      regionNames,
      relations
        .filter((relation) => regionSet.has(relation.first) && regionSet.has(relation.second))
        .map((relation) => {
          if (relation.kind === "exclusive") {
            return { kind: "before" as const, first: relation.first, second: relation.second };
          }
          if (relation.kind === "afterFailure") {
            return { kind: "before" as const, first: relation.second, second: relation.first };
          }
          const [first, second] = [relation.first, relation.second].sort();
          return { kind: "simultaneous" as const, first: first!, second: second! };
        }),
    );
  }
  return {
    intents,
    relations: relations
      .map((relation) => {
        if (relation.kind !== "simultaneous") return relation;
        const [first, second] = [relation.first, relation.second].sort();
        return { kind: "simultaneous" as const, first: first!, second: second! };
      })
      .sort(
        (left, right) =>
          left.first.localeCompare(right.first) || left.second.localeCompare(right.second),
      ),
  };
}

export function validateCandidateAutoScrollOwnership(
  recognizers: CandidateRecognizerScene,
  layout: CandidateLayoutScene,
): void {
  for (const intent of recognizers.intents) {
    if (!intent.autoScroll) continue;
    const scroll = layout.scrolls.find((entry) => entry.container === intent.autoScroll!.owner);
    if (!scroll) {
      throw new Error(
        `Recognizer "${intent.name}" auto-scroll owner "${intent.autoScroll.owner}" is not a scroll container.`,
      );
    }
    const axis = (intent.activation as { readonly axis?: "inline" | "block" | "both" }).axis;
    if (axis === undefined || axis === "both" || (scroll.axis !== "both" && scroll.axis !== axis)) {
      throw new Error(
        `Recognizer "${intent.name}" auto-scroll axis is incompatible with its owner.`,
      );
    }
  }
}

export function validateCandidateAutoScrollParameters(
  recognizers: CandidateRecognizerScene,
  parameters: Readonly<Record<string, unknown>>,
): void {
  for (const intent of recognizers.intents) {
    if (!intent.autoScroll) continue;
    const edge = candidateNumber(
      parameters[intent.autoScroll.edgeFraction],
      `recognizer "${intent.name}" auto-scroll edge fraction`,
    );
    const speed = candidateNumber(
      parameters[intent.autoScroll.maximumViewportPerSecond],
      `recognizer "${intent.name}" auto-scroll maximum speed`,
    );
    if (edge <= 0 || edge > 0.5) {
      throw new Error("Auto-scroll edge fraction must be positive and no more than one half.");
    }
    if (speed < 0) throw new Error("Auto-scroll maximum speed cannot be negative.");
  }
}

export type CandidateAutoScrollSample = {
  readonly requestedVelocity: number;
  readonly velocity: number;
  readonly delta: number;
  readonly position: number;
  readonly gestureRebase: number;
};

export class CandidateAutoScrollAdapter {
  readonly #edgeFraction: number;
  readonly #maximumViewportPerSecond: number;
  #revision = 0;
  #active = false;
  #disposed = false;

  constructor(
    autoScroll: NonNullable<CandidateRecognizerScene["intents"][number]["autoScroll"]>,
    parameters: Readonly<Record<string, unknown>>,
  ) {
    this.#edgeFraction = candidateNumber(
      parameters[autoScroll.edgeFraction],
      "auto-scroll edge fraction",
    );
    this.#maximumViewportPerSecond = candidateNumber(
      parameters[autoScroll.maximumViewportPerSecond],
      "auto-scroll maximum viewport speed",
    );
    if (this.#edgeFraction <= 0 || this.#edgeFraction > 0.5) {
      throw new Error("Auto-scroll edge fraction must be positive and no more than one half.");
    }
    if (this.#maximumViewportPerSecond < 0) {
      throw new Error("Auto-scroll maximum speed cannot be negative.");
    }
  }

  start(): number {
    if (this.#disposed) throw new Error("Auto-scroll adapter is disposed.");
    this.#active = true;
    return ++this.#revision;
  }

  step(
    revision: number,
    options: {
      readonly pointer: number;
      readonly viewportStart: number;
      readonly viewportEnd: number;
      readonly seconds: number;
      readonly position: number;
      readonly minimum: number;
      readonly maximum: number;
    },
  ): CandidateAutoScrollSample | undefined {
    if (this.#disposed || !this.#active || revision !== this.#revision) return undefined;
    const viewportExtent =
      candidateNumber(options.viewportEnd, "auto-scroll viewport end") -
      candidateNumber(options.viewportStart, "auto-scroll viewport start");
    if (viewportExtent <= 0) throw new Error("Auto-scroll viewport must have positive extent.");
    const edgeExtent = viewportExtent * this.#edgeFraction;
    const maximumSpeed = viewportExtent * this.#maximumViewportPerSecond;
    const pointer = candidateNumber(options.pointer, "auto-scroll pointer");
    const seconds = candidateNumber(options.seconds, "auto-scroll frame duration");
    const position = candidateNumber(options.position, "auto-scroll position");
    const minimum = candidateNumber(options.minimum, "auto-scroll minimum");
    const maximum = candidateNumber(options.maximum, "auto-scroll maximum");
    if (seconds < 0 || minimum > maximum || position < minimum || position > maximum) {
      throw new Error("Auto-scroll frame has invalid duration, position, or bounds.");
    }
    const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
    const start = clampUnit((options.viewportStart + edgeExtent - pointer) / edgeExtent);
    const end = clampUnit((pointer - (options.viewportEnd - edgeExtent)) / edgeExtent);
    const signed = end > 0 ? end : -start;
    const requestedVelocity =
      signed === 0 ? 0 : Math.sign(signed) * maximumSpeed * Math.abs(signed) ** 2;
    const next = Math.min(maximum, Math.max(minimum, position + requestedVelocity * seconds));
    const delta = next - position;
    return {
      requestedVelocity,
      velocity: seconds > 0 ? delta / seconds : 0,
      delta,
      position: next,
      gestureRebase: delta,
    };
  }

  stop(revision: number): boolean {
    if (this.#disposed || !this.#active || revision !== this.#revision) return false;
    this.#active = false;
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#active = false;
    this.#disposed = true;
    ++this.#revision;
  }
}

function candidateRecognizerRuntimeOutcomes(
  kind: CandidateRecognizerKind,
  outcomes: readonly string[],
): readonly string[] {
  const declared = [...outcomes].sort();
  const fixed =
    kind === "hoverIntent"
      ? ["disengaged", "engaged"]
      : kind === "longPress"
        ? ["cancelled", "recognized", "released"]
        : undefined;
  if (!fixed) return declared;
  if (declared.join("\0") !== fixed.join("\0")) {
    throw new Error(`Recognizer kind "${kind}" has an inconsistent generated outcome contract.`);
  }
  return fixed;
}

function validateCandidateRecognizerActivation(
  gesture: string,
  kind: CandidateRecognizerKind,
  activation: unknown,
): void {
  const record = candidateRecord(activation, `gesture "${gesture}" activation`);
  if (kind === "drag" || kind === "pan") {
    if (!(["inline", "block", "both"] as const).includes(record.axis as never)) {
      throw new Error(`Gesture "${gesture}" has an invalid logical axis.`);
    }
    candidateNonNegativeLength(record.threshold, `gesture "${gesture}" threshold`, true);
  } else if (kind === "pinch") {
    const threshold = candidateNumber(record.threshold, `gesture "${gesture}" scale threshold`);
    if (threshold < 0) throw new Error(`Gesture "${gesture}" has an invalid scale threshold.`);
  } else if (kind === "rotate") {
    const threshold = candidateNumericValue(
      record.threshold,
      `gesture "${gesture}" angle threshold`,
    );
    if (typeof threshold === "number" || threshold.dimension !== "angle" || threshold.value < 0) {
      throw new Error(`Gesture "${gesture}" has an invalid angle threshold.`);
    }
  } else if (kind === "longPress") {
    const duration = candidateNumericValue(record.duration, `recognizer "${gesture}" duration`);
    if (typeof duration === "number" || duration.dimension !== "time" || duration.value <= 0) {
      throw new Error(`Long press "${gesture}" needs a positive duration.`);
    }
    candidateNonNegativeLength(
      record.movementTolerance,
      `recognizer "${gesture}" movement tolerance`,
    );
  } else {
    const dwell = candidateNumericValue(record.dwell, `recognizer "${gesture}" dwell`);
    const leaveDelay = candidateNumericValue(
      record.leaveDelay,
      `recognizer "${gesture}" leave delay`,
    );
    if (
      typeof dwell === "number" ||
      dwell.dimension !== "time" ||
      dwell.value < 0 ||
      typeof leaveDelay === "number" ||
      leaveDelay.dimension !== "time" ||
      leaveDelay.value < 0
    ) {
      throw new Error(`Hover intent "${gesture}" needs non-negative timing.`);
    }
    const speed = candidateRecord(record.maximumSpeed, `recognizer "${gesture}" maximum speed`);
    candidateNonNegativeLength(speed.perSecond, `recognizer "${gesture}" maximum speed`);
  }
}

export type CandidateDerivedIntentEvent = {
  readonly recognizer: string;
  readonly signal: "engaged" | "disengaged" | "recognized" | "released" | "cancelled";
  readonly action: string;
};

export class CandidateHoverIntentAdapter {
  readonly #intent: CandidateRecognizerScene["intents"][number];
  readonly #dwell: number;
  readonly #maximumSpeed: number;
  readonly #leaveDelay: number;
  #time = 0;
  #inside = false;
  #focused = false;
  #intentActive = false;
  #engaged = false;
  #enteredAt = 0;
  #leaveAt?: number;
  #inline = 0;
  #block = 0;
  #sampleAt = 0;
  #speed = 0;

  constructor(scene: CandidateRecognizerScene, recognizer: string) {
    const intent = scene.intents.find((entry) => entry.name === recognizer);
    if (!intent || intent.kind !== "hoverIntent") {
      throw new Error(`Recognizer "${recognizer}" is not hover intent.`);
    }
    const activation = intent.activation as CandidateRecognizerActivation<"hoverIntent">;
    this.#intent = intent;
    this.#dwell = activation.dwell.value * 1000;
    this.#maximumSpeed = activation.maximumSpeed.perSecond.value;
    this.#leaveDelay = activation.leaveDelay.value * 1000;
  }

  enter(time: number, inline: number, block: number): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    this.#inside = true;
    this.#enteredAt = this.#time;
    this.#leaveAt = undefined;
    this.#inline = candidateNumber(inline, "hover inline position");
    this.#block = candidateNumber(block, "hover block position");
    this.#sampleAt = this.#time;
    this.#speed = 0;
    return this.#sync();
  }

  move(time: number, inline: number, block: number): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (!this.#inside) return undefined;
    const nextInline = candidateNumber(inline, "hover inline position");
    const nextBlock = candidateNumber(block, "hover block position");
    const elapsed = Math.max((this.#time - this.#sampleAt) / 1000, Number.EPSILON);
    this.#speed = Math.hypot(nextInline - this.#inline, nextBlock - this.#block) / elapsed;
    this.#inline = nextInline;
    this.#block = nextBlock;
    this.#sampleAt = this.#time;
    return this.#sync();
  }

  leave(
    time: number,
    path: "outside" | "safe-polygon" = "outside",
  ): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (path === "safe-polygon") {
      if (!this.#intent.handoff) throw new Error("Hover intent has no declared handoff corridor.");
      return undefined;
    }
    this.#inside = false;
    this.#leaveAt = this.#time;
    return this.#sync();
  }

  destination(time: number, inside: boolean): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (!this.#intent.handoff) throw new Error("Hover intent has no declared handoff destination.");
    this.#inside = inside;
    this.#leaveAt = inside ? undefined : this.#time;
    return this.#sync();
  }

  focus(time: number, focused: boolean): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    this.#focused = focused;
    return this.#sync();
  }

  advance(time: number): CandidateDerivedIntentEvent | undefined {
    const previous = this.#time;
    this.#advanceClock(time);
    if (this.#inside && this.#time > previous && this.#sampleAt <= previous) this.#speed = 0;
    if (
      this.#inside &&
      !this.#intentActive &&
      this.#time - this.#enteredAt >= this.#dwell &&
      this.#speed <= this.#maximumSpeed
    ) {
      this.#intentActive = true;
    }
    if (
      !this.#inside &&
      this.#leaveAt !== undefined &&
      this.#time - this.#leaveAt >= this.#leaveDelay
    ) {
      this.#intentActive = false;
      this.#leaveAt = undefined;
    }
    return this.#sync();
  }

  get snapshot(): {
    readonly engaged: boolean;
    readonly progress: number;
    readonly position: { readonly inline: number; readonly block: number };
    readonly speed: number;
  } {
    const progress = this.#intentActive
      ? 1
      : this.#inside
        ? Math.min(1, Math.max(0, (this.#time - this.#enteredAt) / Math.max(this.#dwell, 1)))
        : 0;
    return {
      engaged: this.#engaged,
      progress,
      position: { inline: this.#inline, block: this.#block },
      speed: this.#speed,
    };
  }

  #sync(): CandidateDerivedIntentEvent | undefined {
    const engaged = this.#focused || this.#intentActive;
    if (engaged === this.#engaged) return undefined;
    this.#engaged = engaged;
    return this.#event(engaged ? "engaged" : "disengaged");
  }

  #event(signal: "engaged" | "disengaged"): CandidateDerivedIntentEvent {
    const outcome = this.#intent.outcomes.find((entry) => entry.outcome === signal)!;
    return { recognizer: this.#intent.name, signal, action: outcome.action };
  }

  #advanceClock(time: number): void {
    const next = candidateNumber(time, "hover-intent time");
    if (next < this.#time) throw new Error("Hover-intent time must be monotonic.");
    this.#time = next;
  }
}

export class CandidateLongPressAdapter {
  readonly #intent: CandidateRecognizerScene["intents"][number];
  readonly #duration: number;
  readonly #tolerance: number;
  #phase: "idle" | "possible" | "recognized" | "released" | "cancelled" = "idle";
  #revision = 0;
  #pointer?: number;
  #startedAt = 0;
  #time = 0;
  #inline = 0;
  #block = 0;

  constructor(scene: CandidateRecognizerScene, recognizer: string) {
    const intent = scene.intents.find((entry) => entry.name === recognizer);
    if (!intent || intent.kind !== "longPress") {
      throw new Error(`Recognizer "${recognizer}" is not long press.`);
    }
    const activation = intent.activation as CandidateRecognizerActivation<"longPress">;
    this.#intent = intent;
    this.#duration = activation.duration.value * 1000;
    this.#tolerance = activation.movementTolerance.value;
  }

  down(pointer: number, time: number, inline: number, block: number): number {
    if (this.#phase === "possible" || this.#phase === "recognized") {
      throw new Error("Long press already owns an active pointer.");
    }
    if (!Number.isSafeInteger(pointer) || pointer < 0) {
      throw new Error("Long-press pointer identity must be a non-negative safe integer.");
    }
    this.#advanceClock(time);
    this.#phase = "possible";
    this.#pointer = pointer;
    this.#startedAt = this.#time;
    this.#inline = candidateNumber(inline, "long-press inline position");
    this.#block = candidateNumber(block, "long-press block position");
    return ++this.#revision;
  }

  move(
    revision: number,
    pointer: number,
    time: number,
    inline: number,
    block: number,
  ): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (revision !== this.#revision || pointer !== this.#pointer || this.#phase !== "possible") {
      return undefined;
    }
    const distance = Math.hypot(
      candidateNumber(inline, "long-press inline position") - this.#inline,
      candidateNumber(block, "long-press block position") - this.#block,
    );
    if (distance <= this.#tolerance) return undefined;
    return this.#cancel("cancelled");
  }

  advance(time: number): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (this.#phase !== "possible" || this.#time - this.#startedAt < this.#duration) {
      return undefined;
    }
    this.#phase = "recognized";
    return this.#event("recognized");
  }

  up(revision: number, pointer: number, time: number): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (revision !== this.#revision || pointer !== this.#pointer) return undefined;
    if (this.#phase !== "recognized") return this.#cancel("cancelled");
    this.#pointer = undefined;
    this.#phase = "released";
    return this.#event("released");
  }

  cancel(revision: number, pointer: number, time: number): CandidateDerivedIntentEvent | undefined {
    this.#advanceClock(time);
    if (
      revision !== this.#revision ||
      pointer !== this.#pointer ||
      (this.#phase !== "possible" && this.#phase !== "recognized")
    ) {
      return undefined;
    }
    return this.#cancel("cancelled");
  }

  get snapshot(): { readonly revision: number; readonly phase: string; readonly progress: number } {
    const progress =
      this.#phase === "recognized" || this.#phase === "released"
        ? 1
        : this.#phase === "possible"
          ? Math.min(1, Math.max(0, (this.#time - this.#startedAt) / this.#duration))
          : 0;
    return { revision: this.#revision, phase: this.#phase, progress };
  }

  #cancel(signal: "cancelled"): CandidateDerivedIntentEvent {
    this.#pointer = undefined;
    this.#phase = "cancelled";
    return this.#event(signal);
  }

  #event(signal: "recognized" | "released" | "cancelled"): CandidateDerivedIntentEvent {
    const outcome = this.#intent.outcomes.find((entry) => entry.outcome === signal)!;
    return { recognizer: this.#intent.name, signal, action: outcome.action };
  }

  #advanceClock(time: number): void {
    const next = candidateNumber(time, "long-press time");
    if (next < this.#time) throw new Error("Long-press time must be monotonic.");
    this.#time = next;
  }
}

export type CandidateWebPointerSample = {
  readonly phase: "down" | "move" | "up" | "cancel" | "capture-lost";
  readonly pointer: number;
  readonly region: string;
  readonly inline: number;
  readonly block: number;
  readonly time: number;
};

export type CandidateWebGestureSample =
  | {
      readonly kind: "translation";
      readonly value: { readonly inline: number; readonly block: number };
      readonly velocity: { readonly inline: number; readonly block: number };
    }
  | { readonly kind: "scale"; readonly value: number; readonly velocity: number }
  | { readonly kind: "rotation"; readonly value: CandidateAngle; readonly velocity: number };

export type CandidateWebGestureEvent = {
  readonly gesture: string;
  readonly recognizer: CandidateRecognizerKind;
  readonly phase: "begin" | "change" | "release" | "cancel";
  readonly pointers: readonly number[];
  readonly sample: CandidateWebGestureSample;
  readonly reason?: "pointer-cancel" | "capture-lost";
};

export type CandidateWebGestureEffect = {
  readonly kind: "capture" | "release";
  readonly pointer: number;
  readonly region: string;
};

export type CandidateWebGesturePlan = {
  readonly regions: readonly {
    readonly region: string;
    readonly touchAction: "none" | "pan-x" | "pan-y";
    readonly coalescedInput: true;
    readonly predictedInput: "presentation-only";
    readonly capture: "on-recognition";
    readonly delivery: "direct" | "native-scroll-boundary";
  }[];
};

export type CandidateWebPointerPacket = {
  readonly current: CandidateWebPointerSample;
  readonly coalesced?: readonly CandidateWebPointerSample[];
  readonly predicted?: readonly CandidateWebPointerSample[];
};

export type CandidateWebScrollState = {
  readonly position: number;
  readonly minimum: number;
  readonly maximum: number;
};

type CandidateWebContact = {
  readonly pointer: number;
  readonly region: string;
  readonly startInline: number;
  readonly startBlock: number;
  inline: number;
  block: number;
  previousInline: number;
  previousBlock: number;
  time: number;
  previousTime: number;
};

type CandidateWebRecognizer = {
  phase: "possible" | "active" | "failed";
  pointers: readonly number[];
  baseline?: { readonly distance: number; readonly angle: number; readonly time: number };
  last?: {
    readonly time: number;
    readonly value: CandidateWebMotionValue;
  };
};

type CandidateWebMotionValue = {
  readonly inline: number;
  readonly block: number;
  readonly scale: number;
  readonly angle: number;
};

export function resolveCandidateWebGesturePlan(
  scene: CandidateRecognizerScene,
  writingMode: "horizontal" | "vertical" = "horizontal",
): CandidateWebGesturePlan {
  return {
    regions: [...new Set(scene.intents.map((intent) => intent.region))].sort().map((region) => {
      const intents = scene.intents.filter((intent) => intent.region === region);
      const axes = new Set(
        intents
          .filter((intent) => intent.kind === "drag" || intent.kind === "pan")
          .map((intent) => String((intent.activation as { readonly axis: string }).axis)),
      );
      const ownsTwoPointer = intents.some(
        (intent) => intent.kind === "pinch" || intent.kind === "rotate",
      );
      const scrollAxis = intents.find((intent) => intent.scroll)?.activation as
        | CandidateRecognizerActivation<"drag">
        | undefined;
      const touchAction =
        ownsTwoPointer || axes.has("both") || axes.size !== 1
          ? "none"
          : scrollAxis
            ? scrollAxis.axis === "inline"
              ? writingMode === "horizontal"
                ? "pan-x"
                : "pan-y"
              : writingMode === "horizontal"
                ? "pan-y"
                : "pan-x"
            : axes.has("inline")
              ? writingMode === "horizontal"
                ? "pan-y"
                : "pan-x"
              : writingMode === "horizontal"
                ? "pan-x"
                : "pan-y";
      return {
        region,
        touchAction,
        coalescedInput: true as const,
        predictedInput: "presentation-only" as const,
        capture: "on-recognition" as const,
        delivery: scrollAxis ? ("native-scroll-boundary" as const) : ("direct" as const),
      };
    }),
  };
}

export class CandidateWebGestureAdapter {
  readonly #scene: CandidateRecognizerScene;
  readonly #available: Readonly<Record<string, boolean>>;
  readonly #readScroll: (owner: string) => CandidateWebScrollState | undefined;
  readonly #contacts = new Map<number, CandidateWebContact>();
  readonly #recognizers = new Map<string, CandidateWebRecognizer>();
  readonly #captured = new Set<number>();

  constructor(
    scene: CandidateRecognizerScene,
    available: Readonly<Record<string, boolean>> = {},
    readScroll: (owner: string) => CandidateWebScrollState | undefined = () => undefined,
  ) {
    this.#scene = scene;
    this.#available = available;
    this.#readScroll = readScroll;
  }

  alternative(gesture: string): CandidateRecognizerScene["intents"][number]["alternative"] {
    return this.#intent(gesture).alternative;
  }

  processPacket(packet: CandidateWebPointerPacket): {
    readonly events: readonly CandidateWebGestureEvent[];
    readonly effects: readonly CandidateWebGestureEffect[];
    readonly predicted: readonly CandidateWebPointerSample[];
  } {
    const confirmed = packet.coalesced?.length ? packet.coalesced : [packet.current];
    validateCandidateWebPointerSample(packet.current);
    let previousTime = Number.NEGATIVE_INFINITY;
    for (const sample of confirmed) {
      validateCandidateWebPointerSample(sample);
      if (
        sample.pointer !== packet.current.pointer ||
        sample.region !== packet.current.region ||
        sample.phase !== packet.current.phase
      ) {
        throw new Error("Coalesced pointer samples must belong to the current pointer stream.");
      }
      if (sample.time < previousTime || sample.time > packet.current.time) {
        throw new Error("Coalesced pointer samples must be chronologically ordered.");
      }
      previousTime = sample.time;
    }
    const predicted = packet.predicted ?? [];
    for (const sample of predicted) {
      validateCandidateWebPointerSample(sample);
      if (
        sample.pointer !== packet.current.pointer ||
        sample.region !== packet.current.region ||
        sample.phase !== packet.current.phase ||
        sample.time < packet.current.time
      ) {
        throw new Error("Predicted pointer samples must follow the current pointer stream.");
      }
    }
    const events: CandidateWebGestureEvent[] = [];
    const effects: CandidateWebGestureEffect[] = [];
    for (const sample of confirmed) {
      const result = this.process(sample);
      events.push(...result.events);
      effects.push(...result.effects);
    }
    return { events, effects, predicted };
  }

  process(sample: CandidateWebPointerSample): {
    readonly events: readonly CandidateWebGestureEvent[];
    readonly effects: readonly CandidateWebGestureEffect[];
  } {
    validateCandidateWebPointerSample(sample);
    const events: CandidateWebGestureEvent[] = [];
    const effects: CandidateWebGestureEffect[] = [];
    if (sample.phase === "down") {
      if (this.#contacts.has(sample.pointer)) {
        throw new Error(`Pointer ${sample.pointer} is already active.`);
      }
      this.#contacts.set(sample.pointer, {
        pointer: sample.pointer,
        region: sample.region,
        startInline: sample.inline,
        startBlock: sample.block,
        inline: sample.inline,
        block: sample.block,
        previousInline: sample.inline,
        previousBlock: sample.block,
        time: sample.time,
        previousTime: sample.time,
      });
      this.#initializeRegion(sample.region);
      this.#initializeMultiPointerBaselines(sample.region);
      return { events, effects };
    }

    const contact = this.#contacts.get(sample.pointer);
    if (!contact) return { events, effects };
    if (sample.region !== contact.region) {
      throw new Error(`Pointer ${sample.pointer} cannot change semantic region while active.`);
    }
    if (sample.time < contact.time) throw new Error("Pointer sample time must be monotonic.");
    contact.previousInline = contact.inline;
    contact.previousBlock = contact.block;
    contact.previousTime = contact.time;
    contact.inline = sample.inline;
    contact.block = sample.block;
    contact.time = sample.time;

    if (sample.phase === "move") {
      this.#recognize(contact.region, events, effects);
      return { events, effects };
    }

    const reason =
      sample.phase === "up"
        ? undefined
        : sample.phase === "cancel"
          ? ("pointer-cancel" as const)
          : ("capture-lost" as const);
    for (const intent of this.#scene.intents.filter((entry) => entry.region === contact.region)) {
      const state = this.#recognizers.get(intent.name);
      if (!state || !state.pointers.includes(sample.pointer)) continue;
      if (state.phase === "active") {
        events.push(this.#event(intent, state, reason ? "cancel" : "release", reason));
      }
      state.phase = "failed";
    }
    this.#contacts.delete(sample.pointer);
    this.#releaseUnusedPointers(effects, contact.region);
    if (![...this.#contacts.values()].some((entry) => entry.region === contact.region)) {
      for (const intent of this.#scene.intents.filter((entry) => entry.region === contact.region)) {
        this.#recognizers.delete(intent.name);
      }
    }
    return { events, effects };
  }

  #initializeRegion(region: string): void {
    for (const intent of this.#scene.intents.filter((entry) => entry.region === region)) {
      if (this.#recognizers.has(intent.name)) continue;
      this.#recognizers.set(intent.name, {
        phase: intent.available && this.#available[intent.name] === false ? "failed" : "possible",
        pointers: [],
      });
    }
  }

  #initializeMultiPointerBaselines(region: string): void {
    const contacts = this.#regionContacts(region);
    if (contacts.length < 2) return;
    const baseline = candidateWebPairGeometry(contacts[0]!, contacts[1]!);
    for (const intent of this.#scene.intents.filter(
      (entry) => entry.region === region && (entry.kind === "pinch" || entry.kind === "rotate"),
    )) {
      const state = this.#recognizers.get(intent.name)!;
      if (state.phase !== "possible" || state.baseline) continue;
      state.baseline = baseline;
      state.pointers = [contacts[0]!.pointer, contacts[1]!.pointer];
    }
  }

  #recognize(
    region: string,
    events: CandidateWebGestureEvent[],
    effects: CandidateWebGestureEffect[],
  ): void {
    const eligible = new Set<string>();
    for (const intent of this.#scene.intents.filter((entry) => entry.region === region)) {
      const state = this.#recognizers.get(intent.name)!;
      if (state.phase === "active") {
        events.push(this.#event(intent, state, "change"));
        continue;
      }
      if (state.phase !== "possible") continue;
      const recognition = this.#recognition(intent, state);
      if (recognition === "failed") state.phase = "failed";
      if (recognition === "eligible") eligible.add(intent.name);
    }

    for (const relation of this.#scene.relations.filter((entry) => {
      const first = this.#intent(entry.first);
      return first.region === region;
    })) {
      if (relation.kind === "simultaneous") continue;
      if (
        relation.kind === "exclusive" &&
        eligible.has(relation.first) &&
        eligible.has(relation.second)
      ) {
        eligible.delete(relation.second);
        this.#recognizers.get(relation.second)!.phase = "failed";
      }
      if (relation.kind === "afterFailure" && eligible.has(relation.first)) {
        const required = this.#recognizers.get(relation.second)!;
        if (required.phase !== "failed") eligible.delete(relation.first);
      }
    }

    for (const gesture of [...eligible].sort()) {
      const state = this.#recognizers.get(gesture)!;
      const blocked = this.#scene.relations.some((relation) => {
        if (relation.kind === "simultaneous") return false;
        const pair = [relation.first, relation.second];
        if (!pair.includes(gesture)) return false;
        const other = pair[0] === gesture ? pair[1]! : pair[0]!;
        return this.#recognizers.get(other)?.phase === "active";
      });
      if (blocked) {
        state.phase = "failed";
        continue;
      }
      state.phase = "active";
      for (const pointer of state.pointers) {
        if (this.#captured.has(pointer)) continue;
        this.#captured.add(pointer);
        effects.push({ kind: "capture", pointer, region });
      }
      events.push(this.#event(this.#intent(gesture), state, "begin"));
    }
  }

  #recognition(
    intent: CandidateRecognizerScene["intents"][number],
    state: CandidateWebRecognizer,
  ): "possible" | "eligible" | "failed" {
    const contacts = this.#regionContacts(intent.region);
    if (intent.kind === "drag" || intent.kind === "pan") {
      const contact = contacts[0];
      if (!contact) return "possible";
      state.pointers = [contact.pointer];
      const activation = intent.activation as CandidateRecognizerActivation<"drag">;
      const inline = contact.inline - contact.startInline;
      const block = contact.block - contact.startBlock;
      const threshold = activation.threshold.value;
      if (
        activation.axis === "inline" &&
        Math.abs(block) >= threshold &&
        Math.abs(block) > Math.abs(inline)
      ) {
        return "failed";
      }
      if (
        activation.axis === "block" &&
        Math.abs(inline) >= threshold &&
        Math.abs(inline) > Math.abs(block)
      ) {
        return "failed";
      }
      const distance =
        activation.axis === "inline"
          ? Math.abs(inline)
          : activation.axis === "block"
            ? Math.abs(block)
            : Math.hypot(inline, block);
      if (intent.scroll) {
        const scroll = this.#readScroll(intent.scroll.owner);
        if (!scroll) {
          throw new Error(
            `Gesture "${intent.name}" cannot read scroll owner "${intent.scroll.owner}".`,
          );
        }
        const position = candidateNumber(scroll.position, "scroll position");
        const minimum = candidateNumber(scroll.minimum, "scroll minimum");
        const maximum = candidateNumber(scroll.maximum, "scroll maximum");
        if (minimum > maximum) throw new Error("Scroll bounds are reversed.");
        const movement = activation.axis === "inline" ? inline : block;
        const outward = intent.scroll.outward === "positive" ? movement > 0 : movement < 0;
        const atBoundary =
          intent.scroll.boundary === "start" ? position <= minimum : position >= maximum;
        if (!outward || !atBoundary) return "failed";
      }
      return distance >= threshold ? "eligible" : "possible";
    }
    if (contacts.length < 2 || !state.baseline) return "possible";
    const geometry = candidateWebPairGeometry(contacts[0]!, contacts[1]!);
    if (intent.kind === "pinch") {
      const threshold = (intent.activation as CandidateRecognizerActivation<"pinch">).threshold;
      return Math.abs(geometry.distance / state.baseline.distance - 1) >= threshold
        ? "eligible"
        : "possible";
    }
    const threshold = (intent.activation as CandidateRecognizerActivation<"rotate">).threshold
      .value;
    return Math.abs(candidateWebAngleDelta(geometry.angle, state.baseline.angle)) >= threshold
      ? "eligible"
      : "possible";
  }

  #event(
    intent: CandidateRecognizerScene["intents"][number],
    state: CandidateWebRecognizer,
    phase: CandidateWebGestureEvent["phase"],
    reason?: CandidateWebGestureEvent["reason"],
  ): CandidateWebGestureEvent {
    const contacts = state.pointers
      .map((pointer) => this.#contacts.get(pointer))
      .filter((contact): contact is CandidateWebContact => contact !== undefined);
    const first = contacts[0];
    if (!first) throw new Error(`Gesture "${intent.name}" has no active pointer.`);
    const time = Math.max(...contacts.map((contact) => contact.time));
    const value = {
      inline: first.inline - first.startInline,
      block: first.block - first.startBlock,
      scale: 1,
      angle: 0,
    };
    let previousTime = first.previousTime;
    let previousValue = {
      inline: first.previousInline - first.startInline,
      block: first.previousBlock - first.startBlock,
      scale: 1,
      angle: 0,
    };
    if ((intent.kind === "pinch" || intent.kind === "rotate") && contacts[1] && state.baseline) {
      const current = candidateWebPairGeometry(contacts[0]!, contacts[1]);
      value.scale = current.distance / state.baseline.distance;
      value.angle = candidateWebAngleDelta(current.angle, state.baseline.angle);
      previousTime = state.baseline.time;
      previousValue = { inline: 0, block: 0, scale: 1, angle: 0 };
    }
    if (state.last) {
      previousTime = state.last.time;
      previousValue = state.last.value;
    }
    const elapsed = Math.max((time - previousTime) / 1000, Number.EPSILON);
    const velocity = {
      inline: (value.inline - previousValue.inline) / elapsed,
      block: (value.block - previousValue.block) / elapsed,
      scale: (value.scale - previousValue.scale) / elapsed,
      angle: candidateWebAngleDelta(value.angle, previousValue.angle) / elapsed,
    };
    state.last = { time, value };
    const sample: CandidateWebGestureSample =
      intent.kind === "drag" || intent.kind === "pan"
        ? {
            kind: "translation",
            value: { inline: value.inline, block: value.block },
            velocity: { inline: velocity.inline, block: velocity.block },
          }
        : intent.kind === "pinch"
          ? { kind: "scale", value: value.scale, velocity: velocity.scale }
          : {
              kind: "rotation",
              value: { dimension: "angle", value: value.angle },
              velocity: velocity.angle,
            };
    return {
      gesture: intent.name,
      recognizer: intent.kind,
      phase,
      pointers: [...state.pointers],
      sample,
      ...(reason ? { reason } : {}),
    };
  }

  #releaseUnusedPointers(effects: CandidateWebGestureEffect[], region: string): void {
    for (const pointer of this.#captured) {
      const stillOwned = [...this.#recognizers.values()].some(
        (state) => state.phase === "active" && state.pointers.includes(pointer),
      );
      if (stillOwned) continue;
      this.#captured.delete(pointer);
      effects.push({ kind: "release", pointer, region });
    }
  }

  #regionContacts(region: string): CandidateWebContact[] {
    return [...this.#contacts.values()]
      .filter((contact) => contact.region === region)
      .sort((left, right) => left.pointer - right.pointer);
  }

  #intent(gesture: string): CandidateRecognizerScene["intents"][number] {
    const intent = this.#scene.intents.find((entry) => entry.name === gesture);
    if (!intent) throw new Error(`Unknown gesture "${gesture}".`);
    return intent;
  }
}

export type CandidateWebPointerEventLike = {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;
  readonly getCoalescedEvents?: () => readonly CandidateWebPointerEventLike[];
  readonly getPredictedEvents?: () => readonly CandidateWebPointerEventLike[];
};

export type CandidateWebGesturePlatform<Node, Event extends CandidateWebPointerEventLike> = {
  readonly listen: (
    node: Node,
    event: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
    listener: (event: Event) => void,
  ) => () => void;
  readonly touchAction: (
    node: Node,
    value: CandidateWebGesturePlan["regions"][number]["touchAction"],
  ) => () => void;
  readonly capture: (node: Node, pointer: number) => void;
  readonly release: (node: Node, pointer: number) => void;
};

export function mountCandidateGesturesToWeb<Node, Event extends CandidateWebPointerEventLike>(
  scene: CandidateRecognizerScene,
  nodes: ReadonlyMap<string, Node>,
  platform: CandidateWebGesturePlatform<Node, Event>,
  onEvent: (event: CandidateWebGestureEvent) => void,
  onPredicted: (samples: readonly CandidateWebPointerSample[]) => void = () => {},
  writingMode: "horizontal" | "vertical" = "horizontal",
): { readonly dispose: () => void } {
  const plan = resolveCandidateWebGesturePlan(scene, writingMode);
  const adapter = new CandidateWebGestureAdapter(scene);
  const cleanups: (() => void)[] = [];
  const active = new Map<number, CandidateWebPointerSample>();
  const captured = new Map<number, string>();
  const nodeFor = (region: string): Node => {
    const node = nodes.get(region);
    if (!node) throw new Error(`Web gesture region "${region}" has no mounted node.`);
    return node;
  };
  const sample = (
    event: CandidateWebPointerEventLike,
    region: string,
    phase: CandidateWebPointerSample["phase"],
  ): CandidateWebPointerSample => ({
    phase,
    pointer: event.pointerId,
    region,
    inline: writingMode === "horizontal" ? event.clientX : event.clientY,
    block: writingMode === "horizontal" ? event.clientY : event.clientX,
    time: event.timeStamp,
  });
  const apply = (result: {
    readonly events: readonly CandidateWebGestureEvent[];
    readonly effects: readonly CandidateWebGestureEffect[];
    readonly predicted?: readonly CandidateWebPointerSample[];
  }): void => {
    for (const effect of result.effects) {
      const node = nodeFor(effect.region);
      if (effect.kind === "capture") {
        platform.capture(node, effect.pointer);
        captured.set(effect.pointer, effect.region);
      } else {
        platform.release(node, effect.pointer);
        captured.delete(effect.pointer);
      }
    }
    for (const event of result.events) onEvent(event);
    if (result.predicted?.length) onPredicted(result.predicted);
  };
  const process = (
    event: Event,
    region: string,
    phase: CandidateWebPointerSample["phase"],
  ): void => {
    const current = sample(event, region, phase);
    const coalesced = (event.getCoalescedEvents?.() ?? []).map((entry) =>
      sample(entry, region, phase),
    );
    if (!coalesced.length || coalesced.at(-1)!.time < current.time) coalesced.push(current);
    const predicted = (event.getPredictedEvents?.() ?? []).map((entry) =>
      sample(entry, region, phase),
    );
    apply(adapter.processPacket({ current, coalesced, predicted }));
    if (phase === "down" || phase === "move") active.set(current.pointer, current);
    else active.delete(current.pointer);
  };
  for (const region of plan.regions) {
    const node = nodeFor(region.region);
    cleanups.push(platform.touchAction(node, region.touchAction));
    for (const [event, phase] of [
      ["pointerdown", "down"],
      ["pointermove", "move"],
      ["pointerup", "up"],
      ["pointercancel", "cancel"],
      ["lostpointercapture", "capture-lost"],
    ] as const) {
      cleanups.push(platform.listen(node, event, (value) => process(value, region.region, phase)));
    }
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const current of active.values()) {
        apply(
          adapter.process({
            ...current,
            phase: captured.has(current.pointer) ? "capture-lost" : "cancel",
          }),
        );
      }
      active.clear();
      captured.clear();
      for (const cleanup of cleanups.reverse()) cleanup();
    },
  };
}

function validateCandidateWebPointerSample(sample: CandidateWebPointerSample): void {
  if (!Number.isSafeInteger(sample.pointer) || sample.pointer < 0) {
    throw new Error("Pointer identity must be a non-negative safe integer.");
  }
  if (!sample.region) throw new Error("Pointer sample needs a semantic region.");
  for (const [name, value] of [
    ["inline", sample.inline],
    ["block", sample.block],
    ["time", sample.time],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`Pointer ${name} must be finite.`);
  }
}

function candidateWebPairGeometry(
  first: CandidateWebContact,
  second: CandidateWebContact,
): { readonly distance: number; readonly angle: number; readonly time: number } {
  const inline = second.inline - first.inline;
  const block = second.block - first.block;
  return {
    distance: Math.max(Math.hypot(inline, block), Number.EPSILON),
    angle: (Math.atan2(block, inline) * 180) / Math.PI,
    time: Math.max(first.time, second.time),
  };
}

function candidateWebAngleDelta(current: number, baseline: number): number {
  return ((current - baseline + 540) % 360) - 180;
}

type CandidateResourceViews<App extends CandidateApp> = App extends {
  readonly Resources: infer Resources extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Resource in keyof Resources]: Resources[Resource] extends {
        readonly Key: infer Key;
        readonly Views: infer Views extends Readonly<Record<string, unknown>>;
      }
        ? (key: Key) => Readonly<
            Views & {
              readonly sync: {
                readonly status: "loading" | "current" | "stale" | "offline" | "error";
              };
            }
          >
        : never;
    }
  : {};

type CandidateResourcePorts<App extends CandidateApp> = App extends {
  readonly Resources: infer Resources extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Resource in keyof Resources]: Resources[Resource] extends {
        readonly Key: infer Key;
        readonly Views: infer Views extends Readonly<Record<string, unknown>>;
        readonly Commands: infer Commands extends Readonly<
          Record<string, (...args: never[]) => unknown>
        >;
      }
        ? (key: Key) => Readonly<Views> & Commands
        : never;
    }
  : {};

type CandidateNavigation<App extends CandidateApp> = App extends {
  readonly Navigation: infer Navigation extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Screen in keyof Navigation]: Navigation[Screen] extends Readonly<
        Record<string, unknown>
      >
        ? keyof Navigation[Screen] extends never
          ? (params?: Navigation[Screen]) => void
          : (params: Navigation[Screen]) => void
        : never;
    }
  : {};

type CandidateScreen<App extends CandidateApp> = App extends {
  readonly Navigation: infer Navigation extends Readonly<Record<string, unknown>>;
}
  ? {
      readonly [Screen in keyof Navigation]: {
        readonly name: Screen;
        readonly params: Navigation[Screen];
      };
    }[keyof Navigation]
  : never;

type CandidateBehaviorState<App extends CandidateApp, Component extends ComponentName<App>> = {
  readonly value: CandidateComponentState<App, Component>;
  readonly matches: (state: CandidateComponentState<App, Component>) => boolean;
};

type CandidatePureBehaviorScope<App extends CandidateApp, Component extends ComponentName<App>> = {
  readonly input: Readonly<CandidateComponentField<App, Component, "Input">>;
  readonly context: Readonly<CandidateComponentField<App, Component, "Context">>;
  readonly state: CandidateBehaviorState<App, Component>;
  readonly resources: CandidateResourceViews<App>;
  readonly screen: CandidateScreen<App>;
};

type CandidateCommandInput<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Command extends keyof CandidateComponentField<App, Component, "Commands">,
> =
  CandidateComponentField<App, Component, "Commands">[Command] extends CandidateCommand<infer Input>
    ? Input
    : never;

type CandidateCommandInvocation<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Args extends readonly unknown[],
> = {
  readonly [Command in keyof CandidateComponentField<
    App,
    Component,
    "Commands"
  >]: CandidateCommandInput<App, Component, Command> extends void
    ? {
        readonly run: Command;
        readonly input?: (scope: CandidatePureBehaviorScope<App, Component>, ...args: Args) => void;
      }
    : {
        readonly run: Command;
        readonly input: (
          scope: CandidatePureBehaviorScope<App, Component>,
          ...args: Args
        ) => CandidateCommandInput<App, Component, Command>;
      };
}[keyof CandidateComponentField<App, Component, "Commands">];

type CandidateTransitionConfig<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Args extends readonly unknown[],
> = {
  readonly target?:
    | CandidateComponentState<App, Component>
    | readonly CandidateComponentState<App, Component>[];
  readonly allow?: (scope: CandidatePureBehaviorScope<App, Component>, ...args: Args) => boolean;
  readonly update?: (
    scope: CandidatePureBehaviorScope<App, Component>,
    ...args: Args
  ) => Partial<CandidateComponentField<App, Component, "Context">>;
  readonly commands?:
    | CandidateCommandInvocation<App, Component, Args>
    | readonly CandidateCommandInvocation<App, Component, Args>[];
};

type CandidateTransitions<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Args extends readonly unknown[],
> =
  | CandidateComponentState<App, Component>
  | CandidateTransitionConfig<App, Component, Args>
  | readonly (
      | CandidateComponentState<App, Component>
      | CandidateTransitionConfig<App, Component, Args>
    )[];

type CandidateActionTransitions<App extends CandidateApp, Component extends ComponentName<App>> = {
  readonly [Action in keyof CandidateComponentField<
    App,
    Component,
    "Actions"
  >]?: CandidateTransitions<
    App,
    Component,
    CandidateActionArgs<CandidateComponentField<App, Component, "Actions">[Action]>
  >;
};

type CandidateTaskInput<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Task extends keyof CandidateComponentField<App, Component, "Tasks">,
> = CandidateComponentField<App, Component, "Tasks">[Task] extends { readonly Input: infer Input }
  ? Input
  : never;

type CandidateTaskOutput<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Task extends keyof CandidateComponentField<App, Component, "Tasks">,
> = CandidateComponentField<App, Component, "Tasks">[Task] extends {
  readonly Output: infer Output;
}
  ? Output
  : never;

type CandidateTaskError<
  App extends CandidateApp,
  Component extends ComponentName<App>,
  Task extends keyof CandidateComponentField<App, Component, "Tasks">,
> = CandidateComponentField<App, Component, "Tasks">[Task] extends { readonly Error: infer Error }
  ? Error
  : never;

type CandidateComponentOutput<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = App["Components"][Component] extends { readonly Output: infer Output } ? Output : never;

type CandidateStateOutput<App extends CandidateApp, Component extends ComponentName<App>> = [
  CandidateComponentOutput<App, Component>,
] extends [never]
  ? { readonly output?: never }
  : {
      readonly output?: (
        scope: CandidatePureBehaviorScope<App, Component>,
      ) => CandidateComponentOutput<App, Component>;
    };

type CandidateTaskInvocation<App extends CandidateApp, Component extends ComponentName<App>> = {
  readonly [Task in keyof CandidateComponentField<App, Component, "Tasks">]: {
    readonly run: Task;
    readonly input: (
      scope: CandidatePureBehaviorScope<App, Component>,
    ) => CandidateTaskInput<App, Component, Task>;
    readonly done?: CandidateTransitions<
      App,
      Component,
      readonly [CandidateTaskOutput<App, Component, Task>]
    >;
    readonly fail?: CandidateTransitions<
      App,
      Component,
      readonly [CandidateTaskError<App, Component, Task>]
    >;
  };
}[keyof CandidateComponentField<App, Component, "Tasks">];

export type CandidateStateNode<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = CandidateStateOutput<App, Component> & {
  readonly type?: "atomic" | "compound" | "parallel" | "final";
  readonly initial?: CandidateComponentState<App, Component>;
  readonly states?: Readonly<Record<string, CandidateStateNode<App, Component>>>;
  readonly on?: CandidateActionTransitions<App, Component>;
  readonly always?: CandidateTransitions<App, Component, readonly []>;
  readonly done?: CandidateTransitions<
    App,
    Component,
    readonly [CandidateComponentOutput<App, Component>]
  >;
  readonly after?:
    | {
        readonly wait: number;
        readonly transition: CandidateTransitions<App, Component, readonly []>;
      }
    | readonly {
        readonly wait: number;
        readonly transition: CandidateTransitions<App, Component, readonly []>;
      }[];
  readonly commands?:
    | CandidateCommandInvocation<App, Component, readonly []>
    | readonly CandidateCommandInvocation<App, Component, readonly []>[];
  readonly task?:
    | CandidateTaskInvocation<App, Component>
    | readonly CandidateTaskInvocation<App, Component>[];
};

type CandidateCommandImplementationScope<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = Omit<CandidatePureBehaviorScope<App, Component>, "resources"> & {
  readonly resources: CandidateResourcePorts<App>;
  readonly navigation: CandidateNavigation<App>;
};

type CandidateCommandDefinitions<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = keyof CandidateComponentField<App, Component, "Commands"> extends never
  ? { readonly commands?: never }
  : {
      readonly commands: {
        readonly [Command in keyof CandidateComponentField<App, Component, "Commands">]: (
          scope: CandidateCommandImplementationScope<App, Component>,
          value: CandidateCommandInput<App, Component, Command>,
        ) => void;
      };
    };

type CandidateTaskDefinitions<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = keyof CandidateComponentField<App, Component, "Tasks"> extends never
  ? { readonly tasks?: never }
  : {
      readonly tasks: {
        readonly [Task in keyof CandidateComponentField<App, Component, "Tasks">]: (
          scope: CandidateCommandImplementationScope<App, Component> & {
            readonly value: CandidateTaskInput<App, Component, Task>;
            readonly signal: AbortSignal;
          },
        ) =>
          | CandidateTaskOutput<App, Component, Task>
          | Promise<CandidateTaskOutput<App, Component, Task>>;
      };
    };

type CandidateContextDefinition<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = keyof CandidateComponentField<App, Component, "Context"> extends never
  ? { readonly context?: never }
  : { readonly context: CandidateComponentField<App, Component, "Context"> };

type CandidateStatechartDefinition<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = [CandidateComponentState<App, Component>] extends [never]
  ? {
      readonly initial?: never;
      readonly states?: never;
      readonly on?: CandidateActionTransitions<App, Component>;
    }
  : {
      readonly initial: CandidateComponentState<App, Component>;
      readonly states: Readonly<Record<string, CandidateStateNode<App, Component>>>;
      readonly on?: CandidateActionTransitions<App, Component>;
    };

type CandidateDerivationDefinition<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = keyof CandidateComponentField<App, Component, "Values"> extends never
  ? { readonly derive?: never }
  : {
      readonly derive: (
        scope: CandidatePureBehaviorScope<App, Component>,
      ) => CandidateComponentField<App, Component, "Values">;
    };

type CandidateRecognizerDefinition<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = keyof CandidateComponentField<App, Component, "Recognizers"> extends never
  ? { readonly recognizers?: never }
  : { readonly recognizers: CandidateRecognizerDefinitions<App, Component> };

export type CandidateIntegratedAppDefinition<App extends CandidateApp> = {
  readonly components: {
    readonly [Component in ComponentName<App>]: CandidateContextDefinition<App, Component> &
      CandidateStatechartDefinition<App, Component> &
      CandidateDerivationDefinition<App, Component> &
      CandidateRecognizerDefinition<App, Component> &
      CandidateCommandDefinitions<App, Component> &
      CandidateTaskDefinitions<App, Component> & {
        readonly structure: (
          scope: CandidateStructureScope<App, Component>,
        ) => CandidateStructureChild;
      };
  };
};

export function normalizeCandidateStatechart<
  App extends CandidateApp,
  Component extends ComponentName<App>,
>(
  definition: CandidateStateNode<App, Component> & {
    readonly states: Readonly<Record<string, CandidateStateNode<App, Component>>>;
  },
  declaredTasks: readonly Extract<keyof CandidateComponentField<App, Component, "Tasks">, string>[],
  declaredCommands: readonly Extract<
    keyof CandidateComponentField<App, Component, "Commands">,
    string
  >[] = [],
): ReferenceChartTopology {
  return normalizeReferenceChart(
    candidateReferenceChartDefinition(definition),
    new Set(declaredTasks),
    new Set(declaredCommands),
  );
}

export type CandidateCompiledComponentArtifact = {
  readonly version: 1;
  readonly component: string;
  readonly behavior: ReferenceChartTopology;
  readonly structure: CandidateNormalizedStructure;
  readonly recognizers?: CandidateRecognizerScene;
  readonly presentation: {
    readonly targets: CandidateSemanticScene;
    readonly relationships: CandidateRelationshipScene;
    readonly directManipulation: CandidateDirectManipulationScene;
    readonly layout: CandidateLayoutScene;
  };
};

export function compileCandidateComponentArtifact(input: {
  readonly component: string;
  readonly behavior: ReferenceChartTopology;
  readonly structure: CandidateNormalizedStructure;
  readonly recognizers?: CandidateRecognizerScene;
  readonly targets: CandidateSemanticScene;
  readonly relationships: CandidateRelationshipScene;
  readonly directManipulation: CandidateDirectManipulationScene;
  readonly layout: CandidateLayoutScene;
}): { readonly value: CandidateCompiledComponentArtifact; readonly json: string } {
  if (!input.component) throw new Error("A compiled component artifact needs a name.");
  const value = canonicalCandidateArtifactValue({
    version: 1,
    component: input.component,
    behavior: input.behavior,
    structure: input.structure,
    ...(input.recognizers ? { recognizers: input.recognizers } : {}),
    presentation: {
      targets: input.targets,
      relationships: input.relationships,
      directManipulation: input.directManipulation,
      layout: input.layout,
    },
  }) as CandidateCompiledComponentArtifact;
  return { value, json: `${JSON.stringify(value, undefined, 2)}\n` };
}

export type CandidateHotReloadDescriptor = {
  readonly contract: string;
  readonly structureIdentities: readonly string[];
  readonly targetIdentities: readonly string[];
};

export type CandidateHotReloadMotionSample =
  | {
      readonly kind: "scalar";
      readonly identity: string;
      readonly value: number;
      readonly velocity: number;
    }
  | {
      readonly kind: "layout";
      readonly identity: string;
      readonly value: {
        readonly inline: number;
        readonly block: number;
        readonly inlineSize: number;
        readonly blockSize: number;
      };
      readonly velocity: {
        readonly inline: number;
        readonly block: number;
        readonly logInlineSize: number;
        readonly logBlockSize: number;
      };
    };

export type CandidateHotReloadLiveState = {
  readonly presence: readonly {
    readonly identity: string;
    readonly phase: "entering" | "present" | "exiting";
  }[];
  readonly motions: readonly CandidateHotReloadMotionSample[];
  readonly tasks: readonly string[];
  readonly gestures: readonly string[];
};

export function deriveCandidateHotReloadDescriptor(
  artifact: CandidateCompiledComponentArtifact,
): CandidateHotReloadDescriptor {
  const contract = {
    version: artifact.version,
    component: artifact.component,
    behavior: artifact.behavior,
    structure: artifact.structure.nodes
      .map((node) => ({
        identity: node.identity,
        platformKind: node.platformKind,
        role: node.role,
        actions: [...(node.actions ?? [])].sort(
          (left, right) =>
            left.event.localeCompare(right.event) || left.action.localeCompare(right.action),
        ),
      }))
      .sort((left, right) => left.identity.localeCompare(right.identity)),
    recognizers: artifact.recognizers ?? { intents: [], relations: [] },
  };
  return {
    contract: JSON.stringify(contract),
    structureIdentities: contract.structure.map((node) => node.identity),
    targetIdentities: [...artifact.presentation.targets.transaction.targets].sort(),
  };
}

export function resolveCandidateHotReload(
  previousArtifact: CandidateCompiledComponentArtifact,
  nextArtifact: CandidateCompiledComponentArtifact,
  live: CandidateHotReloadLiveState,
): {
  readonly cause: "presentation" | "contract";
  readonly remount: boolean;
  readonly retain: {
    readonly context: boolean;
    readonly state: boolean;
    readonly presence: CandidateHotReloadLiveState["presence"];
    readonly motion: CandidateHotReloadLiveState["motions"];
  };
  readonly dispose: {
    readonly motions: readonly string[];
    readonly tasks: readonly string[];
    readonly gestures: readonly string[];
  };
} {
  const previous = deriveCandidateHotReloadDescriptor(previousArtifact);
  const next = deriveCandidateHotReloadDescriptor(nextArtifact);
  const compatible = previous.contract === next.contract;
  const semanticIdentities = new Set(next.structureIdentities);
  const oldTargets = new Set(previous.targetIdentities);
  const newTargets = new Set(next.targetIdentities);
  const unique = (identities: readonly string[]): readonly string[] => {
    if (identities.some((identity) => !identity)) {
      throw new Error("Hot-reload live identities cannot be empty.");
    }
    return Array.from(new Set(identities)).sort();
  };
  const samples = <Sample extends { readonly identity: string }>(
    values: readonly Sample[],
    kind: string,
    signature: (sample: Sample) => string,
  ): readonly Sample[] => {
    const byIdentity = new Map<string, Sample>();
    for (const sample of values) {
      if (!sample.identity) throw new Error("Hot-reload live identities cannot be empty.");
      const prior = byIdentity.get(sample.identity);
      if (prior && signature(prior) !== signature(sample)) {
        throw new Error(`Hot-reload ${kind} "${sample.identity}" has conflicting samples.`);
      }
      byIdentity.set(sample.identity, sample);
    }
    return [...byIdentity.values()].sort((left, right) =>
      left.identity.localeCompare(right.identity),
    );
  };
  const presence = samples(live.presence, "presence", (sample) => sample.phase);
  const motions = samples(live.motions, "motion", (sample) => {
    if (sample.kind === "scalar") {
      candidateNumber(sample.value, `Hot-reload motion "${sample.identity}" value`);
      candidateNumber(sample.velocity, `Hot-reload motion "${sample.identity}" velocity`);
    } else {
      for (const [name, value] of Object.entries(sample.value)) {
        candidateNumber(value, `Hot-reload motion "${sample.identity}" geometry ${name}`);
      }
      for (const [name, value] of Object.entries(sample.velocity)) {
        candidateNumber(value, `Hot-reload motion "${sample.identity}" velocity ${name}`);
      }
      if (sample.value.inlineSize <= 0 || sample.value.blockSize <= 0) {
        throw new Error(`Hot-reload layout motion "${sample.identity}" needs positive size.`);
      }
    }
    return JSON.stringify(sample);
  });
  const retainedMotion = compatible
    ? motions.filter((sample) => oldTargets.has(sample.identity) && newTargets.has(sample.identity))
    : [];
  const retainedMotionIdentities = new Set(retainedMotion.map((sample) => sample.identity));
  return {
    cause: compatible ? "presentation" : "contract",
    remount: !compatible,
    retain: {
      context: compatible,
      state: compatible,
      presence: compatible
        ? presence.filter((sample) => semanticIdentities.has(sample.identity))
        : [],
      motion: retainedMotion,
    },
    dispose: {
      motions: motions
        .filter((sample) => !retainedMotionIdentities.has(sample.identity))
        .map((sample) => sample.identity),
      tasks: unique(live.tasks),
      gestures: unique(live.gestures),
    },
  };
}

export type CandidateHotReloadPort = {
  readonly snapshot: () => CandidateHotReloadLiveState;
  readonly disposeMotion: (identity: string) => void;
  readonly disposeTask: (identity: string) => void;
  readonly disposeGesture: (identity: string) => void;
  readonly rebind: (
    artifact: CandidateCompiledComponentArtifact,
    retained: ReturnType<typeof resolveCandidateHotReload>["retain"],
  ) => void;
  readonly remount: (artifact: CandidateCompiledComponentArtifact) => void;
};

export function executeCandidateHotReload(
  previous: CandidateCompiledComponentArtifact,
  next: CandidateCompiledComponentArtifact,
  port: CandidateHotReloadPort,
): ReturnType<typeof resolveCandidateHotReload> {
  const resolution = resolveCandidateHotReload(previous, next, port.snapshot());
  for (const identity of resolution.dispose.motions) port.disposeMotion(identity);
  for (const identity of resolution.dispose.tasks) port.disposeTask(identity);
  for (const identity of resolution.dispose.gestures) port.disposeGesture(identity);
  if (resolution.remount) port.remount(next);
  else port.rebind(next, resolution.retain);
  return resolution;
}

export type CandidateWebSemanticNode = {
  readonly identity: string;
  readonly element: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly events: readonly {
    readonly event: "click" | "input" | "change" | "submit" | "cancel";
    readonly action: string;
  }[];
  readonly children: readonly string[];
  readonly content: readonly (
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "node"; readonly identity: string }
  )[];
  readonly adjustable?: { readonly step: number; readonly largeStep: number };
};

export function lowerCandidateStructureToWeb(
  structure: CandidateNormalizedStructure,
): readonly CandidateWebSemanticNode[] {
  return structure.nodes.map((node) => {
    const element = node.platformKind;
    if (!element) {
      throw new Error(`Semantic node "${node.identity}" has no native web element.`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(element) || element === "script" || element === "style") {
      throw new Error(`Semantic node "${node.identity}" has unsafe web element "${element}".`);
    }
    const attributes: Record<string, string | number | boolean> = {
      id: node.identity,
    };
    const properties: Record<string, string | number | boolean> = {};
    const inputType = candidateWebInputType(node.role);
    if (element === "input" && inputType) attributes.type = inputType;
    const implicitRole = candidateWebImplicitRole(
      element,
      inputType,
      node.destination !== undefined,
    );
    if (node.role !== "generic" && node.role !== implicitRole) attributes.role = node.role;
    if (node.name !== undefined && node.role !== "image") attributes["aria-label"] = node.name;
    if (node.labelledBy !== undefined) attributes["aria-labelledby"] = node.labelledBy;
    if (node.describedBy !== undefined) attributes["aria-describedby"] = node.describedBy;
    if (node.errorMessage !== undefined) attributes["aria-errormessage"] = node.errorMessage;
    if (node.controls !== undefined) attributes["aria-controls"] = node.controls;
    if (node.popup !== undefined) attributes["aria-haspopup"] = node.popup;
    if (node.activeDescendant !== undefined) {
      attributes["aria-activedescendant"] = node.activeDescendant;
    }
    if (node.formOwner !== undefined) attributes.form = node.formOwner;
    if (node.destination !== undefined) attributes.href = node.destination;
    if (node.role === "image") {
      attributes.src = node.source!;
      attributes.alt = node.decorative ? "" : node.name!;
      if (node.decorative) attributes["aria-hidden"] = true;
    }
    if (node.hidden !== undefined) properties.hidden = node.hidden;
    if (node.inert !== undefined) properties.inert = node.inert;
    if (node.selected !== undefined) attributes["aria-selected"] = node.selected;
    if (node.checked !== undefined) {
      attributes["aria-checked"] = node.checked === "mixed" ? "mixed" : node.checked;
      if (element === "input" && node.checked !== "mixed") properties.checked = node.checked;
    }
    if (node.expanded !== undefined) attributes["aria-expanded"] = node.expanded;
    if (node.invalid !== undefined) attributes["aria-invalid"] = node.invalid;
    if (node.modal !== undefined) attributes["aria-modal"] = node.modal;
    if (node.disabled !== undefined) {
      if (candidateWebSupportsDisabled(element)) properties.disabled = node.disabled;
      else attributes["aria-disabled"] = node.disabled;
    }
    if (node.textValue !== undefined) properties.value = node.textValue;
    if (
      node.value !== undefined &&
      node.minimum !== undefined &&
      node.maximum !== undefined &&
      node.step !== undefined &&
      node.largeStep !== undefined
    ) {
      attributes["aria-valuenow"] = node.value;
      attributes["aria-valuemin"] = node.minimum;
      attributes["aria-valuemax"] = node.maximum;
      if (element === "input") {
        properties.min = node.minimum;
        properties.max = node.maximum;
        properties.step = node.step;
        properties.value = node.value;
      }
    }
    if (
      node.focusable &&
      !candidateWebNaturallyFocusable(element, node.destination !== undefined)
    ) {
      properties.tabIndex = 0;
    }
    if (element === "button") attributes.type = "button";
    const events = (node.actions ?? []).map((binding) => ({
      event: candidateWebEvent(node.role, binding.event),
      action: binding.action,
    }));
    return {
      identity: node.identity,
      element,
      attributes,
      properties,
      events,
      children: node.children ?? [],
      content:
        node.content ??
        (node.children ?? []).map((identity) => ({ kind: "node" as const, identity })),
      ...(node.step !== undefined && node.largeStep !== undefined
        ? { adjustable: { step: node.step, largeStep: node.largeStep } }
        : {}),
    };
  });
}

function candidateWebInputType(role: ReferenceSemanticRole): string | undefined {
  return role === "slider"
    ? "range"
    : role === "checkbox" || role === "switch"
      ? "checkbox"
      : role === "radio"
        ? "radio"
        : role === "textbox" || role === "combobox"
          ? "text"
          : undefined;
}

function candidateWebImplicitRole(
  element: string,
  inputType: string | undefined,
  hasDestination: boolean,
): ReferenceSemanticRole | undefined {
  if (element === "button") return "button";
  if (element === "a" && hasDestination) return "link";
  if (element === "form") return "form";
  if (element === "textarea") return "textbox";
  if (element === "select") return "combobox";
  if (element === "dialog") return "dialog";
  if (element === "img") return "image";
  if (element !== "input") return undefined;
  return inputType === "range"
    ? "slider"
    : inputType === "checkbox"
      ? "checkbox"
      : inputType === "radio"
        ? "radio"
        : "textbox";
}

function candidateWebSupportsDisabled(element: string): boolean {
  return ["button", "fieldset", "input", "optgroup", "option", "select", "textarea"].includes(
    element,
  );
}

function candidateWebNaturallyFocusable(element: string, hasDestination: boolean): boolean {
  return (
    ["button", "input", "select", "textarea"].includes(element) ||
    (element === "a" && hasDestination)
  );
}

function candidateWebEvent(
  role: ReferenceSemanticRole,
  event: "activate" | "change" | "submit" | "dismiss",
): "click" | "input" | "change" | "submit" | "cancel" {
  if (event === "activate") return "click";
  if (event === "submit") return "submit";
  if (event === "dismiss") return "cancel";
  return role === "textbox" || role === "combobox" || role === "slider" ? "input" : "change";
}

export type CandidateWebPresentationTarget = {
  readonly target: string;
  readonly identity: string;
  readonly property: string;
  readonly valueType: Exclude<CandidateValueType, "unknown">;
  readonly strategy: "stylesheet" | "reactive-property" | "retained-motion";
  readonly encoding: "scalar" | "composite" | "layout";
  readonly value: unknown;
  readonly transition?: CandidateTransitionDefinition;
};

export function lowerCandidatePresentationToWeb(
  scene: CandidateSemanticScene,
): readonly CandidateWebPresentationTarget[] {
  const transitions = new Map(
    scene.transitions.map((transition) => [transition.target, transition]),
  );
  return [...scene.transaction.targets].sort().map((target) => {
    const valueType = scene.valueTypes[target];
    if (valueType === undefined || valueType === "unknown") {
      throw new Error(`Visual target "${target}" has no concrete value type for web lowering.`);
    }
    const address = scene.addresses[target];
    if (!address) throw new Error(`Visual target "${target}" has no structured address.`);
    const transition = transitions.get(target);
    const value = scene.targets[target];
    if (valueType !== "geometry" && !Object.hasOwn(scene.targets, target)) {
      throw new Error(`Visual target "${target}" has no resolved value for web lowering.`);
    }
    const strategy = transition
      ? "retained-motion"
      : isCandidateExpression(value)
        ? "reactive-property"
        : "stylesheet";
    return {
      target,
      identity: address.identity,
      property: address.property,
      valueType,
      strategy,
      encoding:
        valueType === "geometry"
          ? "layout"
          : ["number", "length"].includes(valueType)
            ? "scalar"
            : "composite",
      value,
      ...(transition ? { transition: transition.definition } : {}),
    };
  });
}

export type CandidateWebLayoutTransition = {
  readonly target: string;
  readonly identity: string;
  readonly strategy: "retained-layout";
  readonly transition: CandidateTransitionDefinition;
};

export function lowerCandidatePresentationToWebLayout(
  scene: CandidateSemanticScene,
): readonly CandidateWebLayoutTransition[] {
  return lowerCandidatePresentationToWeb(scene)
    .filter((target) => target.encoding === "layout")
    .map((target) => {
      if (!target.transition) {
        throw new Error(`Layout target "${target.target}" has no transition policy.`);
      }
      return {
        target: target.target,
        identity: target.identity,
        strategy: "retained-layout",
        transition: target.transition,
      };
    });
}

export type CandidateWebStyleDeclaration = {
  readonly name: string;
  readonly value: string;
};

export type CandidateWebStyleNode = {
  readonly identity: string;
  readonly sources: readonly string[];
  readonly declarations: readonly CandidateWebStyleDeclaration[];
  readonly channels: readonly {
    readonly name: string;
    readonly strategy: CandidateWebPresentationTarget["strategy"];
    readonly sources: readonly string[];
  }[];
  readonly generated?: CandidateGeneratedAddress;
};

export function lowerCandidatePresentationSceneToWebStyle(
  scene: CandidateSemanticScene,
  reads: Readonly<Record<string, unknown>> = {},
): readonly CandidateWebStyleNode[] {
  const grouped = new Map<string, CandidateWebPresentationTarget[]>();
  for (const target of lowerCandidatePresentationToWeb(scene)) {
    if (target.encoding === "layout") continue;
    const targets = grouped.get(target.identity) ?? [];
    targets.push(target);
    grouped.set(target.identity, targets);
  }
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identity, targets]) => {
      const generated = scene.generated?.find((entry) => entry.identity === identity);
      const fill = targets.find((target) => target.property === "fill");
      const material = targets.find((target) => target.property === "material");
      const declarations: CandidateWebStyleDeclaration[] = [];
      const channels: {
        name: string;
        strategy: CandidateWebPresentationTarget["strategy"];
        sources: readonly string[];
      }[] = [];
      const add = (
        next: readonly CandidateWebStyleDeclaration[],
        sources: readonly CandidateWebPresentationTarget[],
      ): void => {
        declarations.push(...next);
        const strategy = candidateWebCombinedStrategy(sources);
        const sourceKeys = sources.map((source) => source.target).sort();
        channels.push(
          ...next.map((declaration) => ({ name: declaration.name, strategy, sources: sourceKeys })),
        );
      };
      if (material) {
        const value = candidateWebTargetValue(material, reads) as CandidateMaterial | "none";
        if (value === "none") {
          if (fill) add(lowerCandidatePresentationTargetToWebStyle(fill, reads), [fill]);
        } else {
          if (value.noise !== 0) {
            throw new Error(
              `Web target "${material.target}" needs generated noise-layer lowering.`,
            );
          }
          const paint = fill
            ? `${candidateWebPaintLayer(value.tint)}, ${candidateWebPaint(
                candidateWebTargetValue(fill, reads) as CandidatePaint,
              )}`
            : candidateWebPaint(value.tint);
          add([{ name: "background", value: paint }], fill ? [fill, material] : [material]);
          add(
            [
              {
                name: "backdrop-filter",
                value: `blur(${value.backdropBlur.value}px) saturate(${value.backdropSaturation})`,
              },
            ],
            [material],
          );
        }
      } else if (fill) {
        add(lowerCandidatePresentationTargetToWebStyle(fill, reads), [fill]);
      }
      for (const target of targets) {
        if (target === fill || target === material) continue;
        add(lowerCandidatePresentationTargetToWebStyle(target, reads), [target]);
      }
      const names = new Set<string>();
      for (const declaration of declarations) {
        if (names.has(declaration.name)) {
          throw new Error(
            `Web visual identity "${identity}" has conflicting "${declaration.name}" output.`,
          );
        }
        names.add(declaration.name);
      }
      return {
        identity,
        sources: targets.map((target) => target.target).sort(),
        declarations,
        channels,
        ...(generated ? { generated } : {}),
      };
    });
}

function candidateWebCombinedStrategy(
  sources: readonly CandidateWebPresentationTarget[],
): CandidateWebPresentationTarget["strategy"] {
  if (sources.some((source) => source.strategy === "retained-motion")) return "retained-motion";
  if (sources.some((source) => source.strategy === "reactive-property")) {
    return "reactive-property";
  }
  return "stylesheet";
}

export function lowerCandidatePresentationTargetToWebStyle(
  target: CandidateWebPresentationTarget,
  reads: Readonly<Record<string, unknown>> = {},
): readonly CandidateWebStyleDeclaration[] {
  const value = candidateWebTargetValue(target, reads);
  if (target.property === "opacity" && target.valueType === "number") {
    return [{ name: "opacity", value: String(candidateFiniteNumber(value, target.target)) }];
  }
  if (target.property === "blockSize" && target.valueType === "length") {
    return [{ name: "block-size", value: candidateWebLength(value, target.target) }];
  }
  if (target.property === "fill" && target.valueType === "paint") {
    return [{ name: "background", value: candidateWebPaint(value as CandidatePaint) }];
  }
  if (target.property === "foreground" && target.valueType === "paint") {
    return [{ name: "color", value: candidateWebPaint(value as CandidatePaint) }];
  }
  if (target.property === "shape" && target.valueType === "shape") {
    return candidateWebShape(value as CandidateShape, target.target);
  }
  if (target.property === "stroke" && target.valueType === "stroke") {
    return candidateWebStroke(value as CandidateStroke | "none", target.target);
  }
  if (target.property === "shadows" && target.valueType === "shadows") {
    const shadows = value as readonly CandidateShadow[];
    return [
      {
        name: "box-shadow",
        value: shadows.length ? shadows.map(candidateWebShadow).join(", ") : "none",
      },
    ];
  }
  if (target.property === "type" && target.valueType === "type") {
    return candidateWebType(value as CandidateTypeStyle);
  }
  if (target.property === "mediaFit" && target.valueType === "media-fit") {
    return candidateWebMedia(value as CandidateMediaFit);
  }
  if (target.property === "transform" && target.valueType === "transform") {
    return candidateWebTransform(value as CandidateTransform);
  }
  if (target.property === "material" && target.valueType === "material") {
    throw new Error(
      `Web target "${target.target}" needs node-level material and fill composition lowering.`,
    );
  }
  throw new Error(
    `Web target "${target.target}" has no exact ${target.valueType} lowering for "${target.property}".`,
  );
}

function candidateWebTargetValue(
  target: CandidateWebPresentationTarget,
  reads: Readonly<Record<string, unknown>>,
): unknown {
  return isCandidateExpression(target.value)
    ? evaluateCandidateExpression(target.value, reads).value
    : target.value;
}

function candidateFiniteNumber(value: unknown, owner: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Web target "${owner}" needs a finite number.`);
  }
  return value;
}

function candidateWebLength(value: unknown, owner: string): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("dimension" in value) ||
    value.dimension !== "length" ||
    !("value" in value)
  ) {
    throw new Error(`Web target "${owner}" needs a length.`);
  }
  return `${candidateFiniteNumber(value.value, owner)}px`;
}

function candidateWebColor(color: CandidateColor): string {
  return `oklch(${color.lightness * 100}% ${color.chroma} ${color.hue} / ${color.alpha})`;
}

function candidateWebPaint(paint: CandidatePaint): string {
  if (paint.kind === "solid") return candidateWebColor(paint.color);
  const stops = paint.stops
    .map((stop) => `${candidateWebColor(stop.color)} ${stop.position * 100}%`)
    .join(", ");
  if (paint.kind === "linear-gradient") {
    return `linear-gradient(${paint.angle.value}deg, ${stops})`;
  }
  const center = `${paint.center.inline * 100}% ${paint.center.block * 100}%`;
  if (paint.kind === "radial-gradient") {
    return `radial-gradient(circle ${paint.radius * 100}% at ${center}, ${stops})`;
  }
  return `conic-gradient(from ${paint.angle.value}deg at ${center}, ${stops})`;
}

function candidateWebPaintLayer(paint: CandidatePaint): string {
  if (paint.kind !== "solid") return candidateWebPaint(paint);
  const color = candidateWebColor(paint.color);
  return `linear-gradient(${color}, ${color})`;
}

function candidateWebShape(
  shape: CandidateShape,
  owner: string,
): readonly CandidateWebStyleDeclaration[] {
  if (shape.kind === "capsule") return [{ name: "border-radius", value: "9999px" }];
  if (shape.kind === "ellipse") return [{ name: "border-radius", value: "50%" }];
  if (shape.kind === "path") {
    throw new Error(`Web target "${owner}" needs scalable path-shape lowering.`);
  }
  if (!("corners" in shape)) {
    throw new Error(`Web target "${owner}" has an unsupported shape.`);
  }
  const corners = [
    shape.corners.startStart,
    shape.corners.startEnd,
    shape.corners.endEnd,
    shape.corners.endStart,
  ];
  if (corners.some((corner) => corner.smoothing !== 0)) {
    throw new Error(`Web target "${owner}" needs continuous-corner lowering.`);
  }
  return [
    {
      name: "border-radius",
      value: corners.map((corner) => candidateWebLength(corner.radius, owner)).join(" "),
    },
  ];
}

function candidateWebStroke(
  stroke: CandidateStroke | "none",
  owner: string,
): readonly CandidateWebStyleDeclaration[] {
  if (stroke === "none") return [{ name: "border", value: "none" }];
  if (stroke.placement !== "inside") {
    throw new Error(
      `Web target "${owner}" needs generated-layer ${stroke.placement} stroke lowering.`,
    );
  }
  if (stroke.paint.kind !== "solid") {
    throw new Error(`Web target "${owner}" needs gradient stroke lowering.`);
  }
  return [
    { name: "border-style", value: stroke.dash ? "dashed" : "solid" },
    { name: "border-width", value: candidateWebLength(stroke.width, owner) },
    { name: "border-color", value: candidateWebColor(stroke.paint.color) },
  ];
}

function candidateWebShadow(shadow: CandidateShadow): string {
  return `${shadow.kind === "inner" ? "inset " : ""}${shadow.offset.inline.value}px ${
    shadow.offset.block.value
  }px ${shadow.blur.value}px ${shadow.spread.value}px ${candidateWebColor(shadow.color)}`;
}

function candidateWebType(type: CandidateTypeStyle): readonly CandidateWebStyleDeclaration[] {
  const family = type.families
    .map((name) => (/^[a-z-]+$/i.test(name) ? name : JSON.stringify(name)))
    .join(", ");
  const variations = Object.entries(type.variations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([axis, value]) => `${JSON.stringify(axis)} ${value}`)
    .join(", ");
  const wrap = type.wrap === "balance" ? "balance" : type.wrap === "nowrap" ? "nowrap" : "wrap";
  return [
    { name: "font-family", value: family },
    { name: "font-size", value: `${type.size.value}px` },
    { name: "line-height", value: `${type.lineHeight.value}px` },
    { name: "font-weight", value: String(type.weight) },
    { name: "letter-spacing", value: `${type.tracking.value}px` },
    { name: "text-align", value: type.align },
    { name: "text-wrap", value: wrap },
    { name: "text-decoration-line", value: type.decoration },
    { name: "font-variation-settings", value: variations || "normal" },
    ...(type.overflow === "ellipsis"
      ? ([
          { name: "overflow", value: "hidden" },
          { name: "text-overflow", value: "ellipsis" },
        ] as const)
      : ([{ name: "overflow", value: "clip" }] as const)),
  ];
}

function candidateWebMedia(media: CandidateMediaFit): readonly CandidateWebStyleDeclaration[] {
  return [
    {
      name: "object-fit",
      value: media.mode === "stretch" ? "fill" : media.mode === "intrinsic" ? "none" : media.mode,
    },
    {
      name: "object-position",
      value: `${media.focalPoint.inline * 100}% ${media.focalPoint.block * 100}%`,
    },
  ];
}

function candidateWebTransform(
  transform: CandidateTransform,
): readonly CandidateWebStyleDeclaration[] {
  const rotation = transform.rotation;
  const transforms = [
    ...(transform.perspective === "none" ? [] : [`perspective(${transform.perspective.value}px)`]),
    `translate3d(${transform.translation.inline.value}px, ${transform.translation.block.value}px, ${transform.translation.depth.value}px)`,
    `rotate3d(${rotation.axis.x}, ${rotation.axis.y}, ${rotation.axis.z}, ${rotation.angle.value}deg)`,
    `scale3d(${transform.scale.inline}, ${transform.scale.block}, ${transform.scale.depth})`,
  ];
  return [
    { name: "transform", value: transforms.join(" ") },
    {
      name: "transform-origin",
      value: `${transform.origin.inline * 100}% ${transform.origin.block * 100}% ${transform.origin.depth.value}px`,
    },
  ];
}

export type CandidateWebStructurePlatform<Node, Event> = {
  readonly create: (element: string, identity: string) => Node;
  readonly text: (value: string) => Node;
  readonly attribute: (
    node: Node,
    name: string,
    value: string | number | boolean | undefined,
  ) => void;
  readonly property: (
    node: Node,
    name: string,
    value: string | number | boolean | undefined,
  ) => void;
  readonly listen: (
    node: Node,
    event: CandidateWebSemanticNode["events"][number]["event"],
    listener: (event: Event) => void,
  ) => () => void;
  readonly append: (parent: Node, child: Node) => void;
  readonly remove: (node: Node) => void;
};

export function mountCandidateStructureToWeb<Node, Event>(
  structure: CandidateNormalizedStructure,
  platform: CandidateWebStructurePlatform<Node, Event>,
  dispatch: (action: string, event: Event) => void,
): {
  readonly roots: readonly Node[];
  readonly nodes: ReadonlyMap<string, Node>;
  readonly dispose: () => void;
} {
  const instructions = lowerCandidateStructureToWeb(structure);
  const nodes = new Map<string, Node>();
  const cleanups: (() => void)[] = [];
  for (const instruction of instructions) {
    const node = platform.create(instruction.element, instruction.identity);
    nodes.set(instruction.identity, node);
    for (const [name, value] of Object.entries(instruction.attributes)) {
      platform.attribute(node, name, value);
    }
    for (const [name, value] of Object.entries(instruction.properties)) {
      platform.property(node, name, value);
    }
    for (const binding of instruction.events) {
      cleanups.push(
        platform.listen(node, binding.event, (event) => dispatch(binding.action, event)),
      );
    }
  }
  for (const instruction of instructions) {
    const parent = nodes.get(instruction.identity)!;
    for (const content of instruction.content) {
      if (content.kind === "text") {
        platform.append(parent, platform.text(content.value));
        continue;
      }
      const child = nodes.get(content.identity);
      if (!child) {
        throw new Error(
          `Web structure "${instruction.identity}" references missing child "${content.identity}".`,
        );
      }
      platform.append(parent, child);
    }
  }
  const roots = instructions
    .filter((instruction) => structure.scene.parent[instruction.identity] === undefined)
    .map((instruction) => nodes.get(instruction.identity)!);
  let disposed = false;
  return {
    roots,
    nodes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      for (const root of [...roots].reverse()) platform.remove(root);
      nodes.clear();
    },
  };
}

export function updateCandidateStructureOnWeb<Node, Event>(
  previous: CandidateNormalizedStructure,
  next: CandidateNormalizedStructure,
  mounted: { readonly nodes: ReadonlyMap<string, Node> },
  platform: Pick<CandidateWebStructurePlatform<Node, Event>, "attribute" | "property">,
): readonly {
  readonly identity: string;
  readonly kind: "attribute" | "property";
  readonly name: string;
}[] {
  const previousInstructions = new Map(
    lowerCandidateStructureToWeb(previous).map((instruction) => [
      instruction.identity,
      instruction,
    ]),
  );
  const nextInstructions = lowerCandidateStructureToWeb(next);
  if (
    previousInstructions.size !== nextInstructions.length ||
    nextInstructions.some((instruction) => !previousInstructions.has(instruction.identity))
  ) {
    throw new Error("A structural identity change requires web structure replacement.");
  }
  const changes: {
    identity: string;
    kind: "attribute" | "property";
    name: string;
  }[] = [];
  for (const nextInstruction of nextInstructions) {
    const previousInstruction = previousInstructions.get(nextInstruction.identity)!;
    if (
      previousInstruction.element !== nextInstruction.element ||
      JSON.stringify(previousInstruction.content) !== JSON.stringify(nextInstruction.content) ||
      JSON.stringify(previousInstruction.events) !== JSON.stringify(nextInstruction.events)
    ) {
      throw new Error(
        `Semantic node "${nextInstruction.identity}" changed its native structure contract.`,
      );
    }
    const node = mounted.nodes.get(nextInstruction.identity);
    if (!node) throw new Error(`Mounted web node "${nextInstruction.identity}" is missing.`);
    for (const name of new Set([
      ...Object.keys(previousInstruction.attributes),
      ...Object.keys(nextInstruction.attributes),
    ])) {
      const before = previousInstruction.attributes[name];
      const after = nextInstruction.attributes[name];
      if (Object.is(before, after)) continue;
      platform.attribute(node, name, after);
      changes.push({ identity: nextInstruction.identity, kind: "attribute", name });
    }
    for (const name of new Set([
      ...Object.keys(previousInstruction.properties),
      ...Object.keys(nextInstruction.properties),
    ])) {
      const before = previousInstruction.properties[name];
      const after = nextInstruction.properties[name];
      if (Object.is(before, after)) continue;
      platform.property(node, name, after);
      changes.push({ identity: nextInstruction.identity, kind: "property", name });
    }
  }
  return changes;
}

export function planCandidateStructureReconciliation(
  previous: CandidateNormalizedStructure,
  next: CandidateNormalizedStructure,
  retainedExitRoots: readonly string[] = [],
): ReferenceStructureReconciliation {
  const previousByIdentity = new Map(previous.nodes.map((node) => [node.identity, node]));
  const nextByIdentity = new Map(next.nodes.map((node) => [node.identity, node]));
  const exiting = previous.nodes.filter((node) => !nextByIdentity.has(node.identity));
  const entering = next.nodes.filter((node) => !previousByIdentity.has(node.identity));
  const exitingIdentities = new Set(exiting.map((node) => node.identity));
  const enteringIdentities = new Set(entering.map((node) => node.identity));
  const exitRoots = exiting.filter((node) => {
    const parent = previous.scene.parent[node.identity];
    return parent === undefined || !exitingIdentities.has(parent);
  });
  const enterRoots = entering.filter((node) => {
    const parent = next.scene.parent[node.identity];
    return parent === undefined || !enteringIdentities.has(parent);
  });
  if (new Set(retainedExitRoots).size !== retainedExitRoots.length) {
    throw new Error("Retained structure exit roots must be unique.");
  }
  const exitRootIdentities = new Set(exitRoots.map((node) => node.identity));
  for (const identity of retainedExitRoots) {
    if (!exitRootIdentities.has(identity)) {
      throw new Error(`Retained structure identity "${identity}" is not an exiting subtree root.`);
    }
  }
  const retained = new Set(retainedExitRoots);
  const surviving = previous.nodes.filter((node) => nextByIdentity.has(node.identity));
  for (const node of surviving) {
    if (
      candidateStructureContract(node) !==
      candidateStructureContract(nextByIdentity.get(node.identity)!)
    ) {
      throw new Error(
        `Surviving semantic identity "${node.identity}" changed its native contract.`,
      );
    }
  }
  return {
    surviving: surviving.map((node) => node.identity),
    entering: entering.map((node) => node.identity),
    enterRoots: enterRoots.map((node) => node.identity),
    exiting: exiting.map((node) => node.identity),
    exitRoots: exitRoots.map((node) => ({
      identity: node.identity,
      presentation: retained.has(node.identity) ? "retain" : "remove",
    })),
    moving: surviving.flatMap((node) => {
      const from = previous.scene.parent[node.identity];
      const to = next.scene.parent[node.identity];
      return from === to
        ? []
        : [{ identity: node.identity, ...(from ? { from } : {}), ...(to ? { to } : {}) }];
    }),
    contentUpdates: surviving.flatMap((node) => {
      const replacement = nextByIdentity.get(node.identity)!;
      return JSON.stringify(node.content ?? []) === JSON.stringify(replacement.content ?? [])
        ? []
        : [{ identity: node.identity, content: replacement.content }];
    }),
    order: next.nodes.map((node) => ({ identity: node.identity, children: node.children ?? [] })),
  };
}

function candidateStructureContract(node: ReferenceSemanticNode): string {
  return JSON.stringify({
    platformKind: node.platformKind,
    role: node.role,
    actions: [...(node.actions ?? [])].sort(
      (left, right) =>
        left.event.localeCompare(right.event) || left.action.localeCompare(right.action),
    ),
  });
}

function candidateWebStructureContract(node: CandidateWebSemanticNode): string {
  return JSON.stringify({ element: node.element, events: node.events });
}

export type CandidateWebReconciliationPlatform<Node, Event> = CandidateWebStructurePlatform<
  Node,
  Event
> & {
  readonly place: (parent: Node, child: Node, index: number) => void;
  readonly textValue: (node: Node, value: string) => void;
  readonly retain: (node: Node) => void;
  readonly restore: (node: Node) => void;
  readonly focusedIdentity: () => string | undefined;
  readonly focus: (node: Node) => void;
  readonly activateModal: (node: Node, initialFocus: Node, focusVisibility: "visible") => void;
  readonly deactivateModal: (node: Node, returnFocus: Node) => void;
};

export type CandidatePresenceCommands = {
  readonly enter: readonly {
    readonly identity: string;
    readonly reversal: boolean;
  }[];
  readonly exit: readonly {
    readonly identity: string;
    readonly revision: number;
  }[];
};

export function planCandidatePresenceCommands(transaction: {
  readonly enterRoots: readonly string[];
  readonly retained: readonly { readonly identity: string; readonly revision: number }[];
  readonly reversed: readonly string[];
}): CandidatePresenceCommands {
  const reversed = new Set(transaction.reversed);
  return {
    enter: transaction.enterRoots.map((identity) => ({
      identity,
      reversal: reversed.has(identity),
    })),
    exit: transaction.retained.map(({ identity, revision }) => ({ identity, revision })),
  };
}

export function mountCandidateReconciledStructureToWeb<Node, Event>(
  initial: CandidateNormalizedStructure,
  platform: CandidateWebReconciliationPlatform<Node, Event>,
  dispatch: (action: string, event: Event) => void,
): {
  readonly roots: readonly Node[];
  readonly nodes: ReadonlyMap<string, Node>;
  readonly reconcile: (
    next: CandidateNormalizedStructure,
    options?: { readonly retain?: readonly string[] },
  ) => ReferenceStructureReconciliation & {
    readonly retained: readonly { readonly identity: string; readonly revision: number }[];
    readonly reversed: readonly string[];
    readonly focusRecovery?: { readonly from: string; readonly to: string };
  };
  readonly settleExit: (identity: string, revision: number) => boolean;
  readonly dispose: () => void;
} {
  type Instruction = CandidateWebSemanticNode;
  type RetainedRoot = {
    readonly revision: number;
    readonly identities: ReadonlySet<string>;
  };
  let current = initial;
  let revision = 0;
  let disposed = false;
  const nodes = new Map<string, Node>();
  const instructions = new Map<string, Instruction>();
  const cleanups = new Map<string, (() => void)[]>();
  const textNodes = new Map<string, Node>();
  const textValues = new Map<string, string>();
  const retainedRoots = new Map<string, RetainedRoot>();
  const retainedOwner = new Map<string, string>();
  const pendingModalReturns = new Map<string, string>();

  const bind = (instruction: Instruction, node: Node): void => {
    const owned = cleanups.get(instruction.identity) ?? [];
    for (const binding of instruction.events) {
      owned.push(platform.listen(node, binding.event, (event) => dispatch(binding.action, event)));
    }
    cleanups.set(instruction.identity, owned);
  };
  const release = (identity: string): void => {
    for (const cleanup of cleanups.get(identity)?.splice(0).reverse() ?? []) cleanup();
    cleanups.delete(identity);
  };
  const applyAll = (instruction: Instruction, node: Node): void => {
    for (const [name, value] of Object.entries(instruction.attributes)) {
      platform.attribute(node, name, value);
    }
    for (const [name, value] of Object.entries(instruction.properties)) {
      platform.property(node, name, value);
    }
  };
  const create = (instruction: Instruction): Node => {
    const node = platform.create(instruction.element, instruction.identity);
    nodes.set(instruction.identity, node);
    instructions.set(instruction.identity, instruction);
    applyAll(instruction, node);
    bind(instruction, node);
    return node;
  };
  const reconcileAttributes = (previous: Instruction, next: Instruction, node: Node): void => {
    for (const name of new Set([
      ...Object.keys(previous.attributes),
      ...Object.keys(next.attributes),
    ])) {
      if (!Object.is(previous.attributes[name], next.attributes[name])) {
        platform.attribute(node, name, next.attributes[name]);
      }
    }
    for (const name of new Set([
      ...Object.keys(previous.properties),
      ...Object.keys(next.properties),
    ])) {
      if (!Object.is(previous.properties[name], next.properties[name])) {
        platform.property(node, name, next.properties[name]);
      }
    }
    instructions.set(next.identity, next);
  };
  const reconcileContent = (instruction: Instruction): void => {
    const parent = nodes.get(instruction.identity)!;
    const desiredTextKeys = new Set<string>();
    instruction.content.forEach((content, index) => {
      if (content.kind === "node") {
        const child = nodes.get(content.identity);
        if (!child) {
          throw new Error(
            `Web structure "${instruction.identity}" references missing child "${content.identity}".`,
          );
        }
        platform.place(parent, child, index);
        return;
      }
      const key = `${instruction.identity}\0${String(index)}`;
      desiredTextKeys.add(key);
      let text = textNodes.get(key);
      if (!text) {
        text = platform.text(content.value);
        textNodes.set(key, text);
        textValues.set(key, content.value);
      } else if (textValues.get(key) !== content.value) {
        platform.textValue(text, content.value);
        textValues.set(key, content.value);
      }
      platform.place(parent, text, index);
    });
    const prefix = `${instruction.identity}\0`;
    for (const [key, text] of textNodes) {
      if (key.startsWith(prefix) && !desiredTextKeys.has(key)) {
        platform.remove(text);
        textNodes.delete(key);
        textValues.delete(key);
      }
    }
  };
  const descendants = (
    root: string,
    structure: CandidateNormalizedStructure,
  ): ReadonlySet<string> => {
    const byIdentity = new Map(structure.nodes.map((node) => [node.identity, node]));
    const found = new Set<string>();
    const visit = (identity: string): void => {
      if (found.has(identity)) return;
      found.add(identity);
      for (const child of byIdentity.get(identity)?.children ?? []) visit(child);
    };
    visit(root);
    return found;
  };
  const deleteOwned = (identities: ReadonlySet<string>): void => {
    for (const identity of identities) {
      release(identity);
      nodes.delete(identity);
      instructions.delete(identity);
      retainedOwner.delete(identity);
      const prefix = `${identity}\0`;
      for (const key of textNodes.keys()) {
        if (key.startsWith(prefix)) {
          textNodes.delete(key);
          textValues.delete(key);
        }
      }
    }
  };

  const initialInstructions = lowerCandidateStructureToWeb(initial);
  for (const instruction of initialInstructions) create(instruction);
  for (const instruction of initialInstructions) reconcileContent(instruction);
  if (initial.scene.activeModal) {
    platform.activateModal(
      nodes.get(initial.scene.activeModal.identity)!,
      nodes.get(initial.scene.activeModal.initialFocus)!,
      "visible",
    );
  }

  const result = {
    get roots(): readonly Node[] {
      return lowerCandidateStructureToWeb(current)
        .filter((instruction) => current.scene.parent[instruction.identity] === undefined)
        .map((instruction) => nodes.get(instruction.identity)!);
    },
    nodes,
    reconcile(
      next: CandidateNormalizedStructure,
      options: { readonly retain?: readonly string[] } = {},
    ) {
      if (disposed) throw new Error("Cannot reconcile disposed web structure.");
      const plan = planCandidateStructureReconciliation(current, next, options.retain);
      const focused = platform.focusedIdentity();
      const focusRecovery = focused
        ? next.focusRecovery?.find((recovery) => recovery.departing.includes(focused))
        : undefined;
      const nextInstructions = new Map(
        lowerCandidateStructureToWeb(next).map((instruction) => [
          instruction.identity,
          instruction,
        ]),
      );
      const reversing = new Map<string, RetainedRoot>();
      for (const root of plan.enterRoots) {
        const retained = retainedRoots.get(root);
        if (!retained) continue;
        const nextSubtree = descendants(root, next);
        if ([...retained.identities].sort().join("\0") !== [...nextSubtree].sort().join("\0")) {
          throw new Error(`Retained structure root "${root}" changed its subtree on reversal.`);
        }
        reversing.set(root, retained);
      }
      for (const identity of plan.entering) {
        const existing = nodes.get(identity);
        if (!existing) continue;
        const owner = retainedOwner.get(identity);
        if (!owner || !reversing.has(owner)) {
          throw new Error(
            `Retained structure identity "${identity}" cannot reenter without subtree root "${owner ?? "unknown"}".`,
          );
        }
        if (
          candidateWebStructureContract(instructions.get(identity)!) !==
          candidateWebStructureContract(nextInstructions.get(identity)!)
        ) {
          throw new Error(`Retained semantic identity "${identity}" changed its native contract.`);
        }
      }
      const reversed = [...reversing.keys()];
      for (const root of reversed) {
        const node = nodes.get(root)!;
        platform.restore(node);
        platform.attribute(node, "aria-hidden", undefined);
        platform.property(node, "inert", undefined);
      }
      for (const identity of plan.entering) {
        const instruction = nextInstructions.get(identity)!;
        const existing = nodes.get(identity);
        if (existing) {
          const previousInstruction = instructions.get(identity)!;
          reconcileAttributes(previousInstruction, instruction, existing);
          bind(instruction, existing);
        } else {
          create(instruction);
        }
      }
      for (const root of reversed) {
        const retained = retainedRoots.get(root)!;
        retainedRoots.delete(root);
        for (const identity of retained.identities) retainedOwner.delete(identity);
      }
      for (const identity of plan.surviving) {
        reconcileAttributes(
          instructions.get(identity)!,
          nextInstructions.get(identity)!,
          nodes.get(identity)!,
        );
      }
      for (const instruction of nextInstructions.values()) reconcileContent(instruction);

      const previousModal = current.scene.activeModal;
      const nextModal = next.scene.activeModal;
      if (previousModal?.identity !== nextModal?.identity) {
        if (previousModal) {
          const modal = nodes.get(previousModal.identity);
          const destination = nodes.get(previousModal.returnFocus);
          if (!modal || !destination) {
            throw new Error(`Active modal "${previousModal.identity}" lost its focus contract.`);
          }
          platform.deactivateModal(modal, destination);
          pendingModalReturns.set(previousModal.identity, previousModal.returnFocus);
        }
        if (nextModal) {
          const modal = nodes.get(nextModal.identity);
          const destination = nodes.get(nextModal.initialFocus);
          if (!modal || !destination) {
            throw new Error(`Active modal "${nextModal.identity}" lost its focus contract.`);
          }
          pendingModalReturns.delete(nextModal.identity);
          platform.activateModal(modal, destination, "visible");
        }
      }
      const retained: { identity: string; revision: number }[] = [];
      for (const exit of plan.exitRoots) {
        const subtree = descendants(exit.identity, current);
        for (const identity of subtree) release(identity);
        const node = nodes.get(exit.identity)!;
        platform.attribute(node, "aria-hidden", true);
        platform.property(node, "inert", true);
        if (exit.presentation === "retain") {
          platform.retain(node);
          const retainedRevision = ++revision;
          retainedRoots.set(exit.identity, { revision: retainedRevision, identities: subtree });
          for (const identity of subtree) retainedOwner.set(identity, exit.identity);
          retained.push({ identity: exit.identity, revision: retainedRevision });
        } else {
          platform.remove(node);
          deleteOwned(subtree);
        }
      }
      if (focusRecovery) {
        const destination = nodes.get(focusRecovery.destination);
        if (!destination) {
          throw new Error(
            `Focus recovery destination "${focusRecovery.destination}" is not mounted.`,
          );
        }
        platform.focus(destination);
      }
      const nextByIdentity = new Map(next.nodes.map((node) => [node.identity, node]));
      for (const [modalIdentity, returnIdentity] of pendingModalReturns) {
        const modal = nextByIdentity.get(modalIdentity);
        if (modal && !modal.hidden) continue;
        const destination = nodes.get(returnIdentity);
        if (destination && platform.focusedIdentity() === undefined) platform.focus(destination);
        pendingModalReturns.delete(modalIdentity);
      }
      current = next;
      return {
        ...plan,
        retained,
        reversed,
        ...(focused && focusRecovery
          ? { focusRecovery: { from: focused, to: focusRecovery.destination } }
          : {}),
      };
    },
    settleExit(identity: string, settledRevision: number): boolean {
      const retained = retainedRoots.get(identity);
      if (!retained || retained.revision !== settledRevision) return false;
      platform.remove(nodes.get(identity)!);
      retainedRoots.delete(identity);
      deleteOwned(retained.identities);
      return true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const identity of cleanups.keys()) release(identity);
      const removed = new Set<Node>();
      for (const root of result.roots) {
        platform.remove(root);
        removed.add(root);
      }
      for (const identity of retainedRoots.keys()) {
        const root = nodes.get(identity)!;
        if (!removed.has(root)) platform.remove(root);
      }
      retainedRoots.clear();
      retainedOwner.clear();
      pendingModalReturns.clear();
      nodes.clear();
      instructions.clear();
      textNodes.clear();
      textValues.clear();
    },
  };
  return result;
}

export type CandidateWebPresentationPlatform = {
  readonly stylesheet: (target: CandidateWebPresentationTarget) => () => void;
  readonly reactive: (target: CandidateWebPresentationTarget) => () => void;
  readonly retained: (target: CandidateWebPresentationTarget) => () => void;
};

export function mountCandidatePresentationToWeb(
  scene: CandidateSemanticScene,
  platform: CandidateWebPresentationPlatform,
): { readonly targets: readonly CandidateWebPresentationTarget[]; readonly dispose: () => void } {
  const targets = lowerCandidatePresentationToWeb(scene);
  const cleanups = targets.map((target) =>
    target.strategy === "stylesheet"
      ? platform.stylesheet(target)
      : target.strategy === "reactive-property"
        ? platform.reactive(target)
        : platform.retained(target),
  );
  let disposed = false;
  return {
    targets,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.reverse()) cleanup();
    },
  };
}

export function deriveCandidateArtifactCapabilities(
  artifact: CandidateCompiledComponentArtifact,
): readonly string[] {
  const capabilities = new Set<string>(["behavior.statechart"]);
  const allNodes = [artifact.behavior, ...artifact.behavior.nodes];
  if (
    artifact.behavior.kind === "parallel" ||
    artifact.behavior.nodes.some((node) => node.kind === "parallel")
  ) {
    capabilities.add("behavior.parallel");
  }
  if (allNodes.some((node) => node.events.length)) capabilities.add("behavior.events");
  if (allNodes.some((node) => node.always.length)) capabilities.add("behavior.always");
  if (allNodes.some((node) => node.delays.length)) capabilities.add("behavior.delay");
  if (allNodes.some((node) => node.taskResults.length)) capabilities.add("behavior.task");
  if (allNodes.some((node) => node.done.length)) capabilities.add("behavior.completion");
  if (artifact.behavior.nodes.some((node) => node.output !== undefined)) {
    capabilities.add("behavior.output");
  }
  const alternatives = allNodes.flatMap((node) => [
    ...node.always,
    ...node.done,
    ...node.delays,
    ...node.events.flatMap((event) => event.alternatives),
    ...node.taskResults.flatMap((task) => [...task.done, ...task.fail]),
  ]);
  if (alternatives.some((alternative) => alternative.update)) {
    capabilities.add("behavior.contextUpdate");
  }
  if (alternatives.some((alternative) => alternative.commands?.length)) {
    capabilities.add("behavior.command");
  }

  for (const node of artifact.structure.nodes) {
    capabilities.add(`semantic.role.${node.role}`);
    if (node.modal) capabilities.add("semantic.modal");
    for (const action of node.actions ?? []) capabilities.add(`semantic.action.${action.event}`);
  }

  for (const value of Object.values(artifact.presentation.targets.targets)) {
    collectCandidateExpressionCapabilities(value, capabilities);
  }
  for (const value of Object.values(artifact.presentation.relationships.hitTests)) {
    collectCandidateExpressionCapabilities(value, capabilities);
  }
  for (const transition of artifact.presentation.targets.transitions) {
    capabilities.add(`transition.${transition.definition.normal.kind}`);
    capabilities.add(`transition.${transition.definition.reduced.kind}`);
  }
  const relationships = artifact.presentation.relationships;
  if (relationships.composition.length) capabilities.add("composition.order");
  if (relationships.clips.length) capabilities.add("composition.clip");
  if (Object.keys(relationships.hitTests).length) capabilities.add("composition.hitTest");
  if (relationships.matches.length) capabilities.add("composition.sharedIdentity");
  if (relationships.isolates.length) capabilities.add("composition.isolate");
  if (relationships.nativeLayers.length) capabilities.add("composition.nativeLayer");
  if (relationships.masks.length) capabilities.add("composition.mask");

  const directManipulation = artifact.presentation.directManipulation;
  if (directManipulation.drives.length) capabilities.add("gesture.direct");
  if (directManipulation.settlements.length) capabilities.add("gesture.settle");
  for (const gesture of directManipulation.drives) {
    capabilities.add(`gesture.${gesture.recognizer}`);
    collectCandidateExpressionCapabilities(gesture.projection, capabilities);
  }
  for (const intent of artifact.recognizers?.intents ?? []) {
    capabilities.add(`gesture.${intent.kind}`);
    capabilities.add("gesture.activation");
    capabilities.add("gesture.accessibleAlternative");
    if (intent.autoScroll) capabilities.add("gesture.autoScroll");
  }
  if (artifact.recognizers?.relations.length) capabilities.add("gesture.arbitration");

  const layout = artifact.presentation.layout;
  for (const arrangement of layout.arrangements) {
    capabilities.add(`layout.${arrangement.arrangement.algorithm}`);
  }
  if (layout.intrinsic.length) capabilities.add("layout.intrinsic");
  if (layout.scrolls.length) capabilities.add("layout.scroll");
  if (layout.virtualized.length) capabilities.add("layout.virtualized");
  if (layout.placements.length) capabilities.add("layout.gridPlacement");
  if (layout.sticky.length) capabilities.add("layout.sticky");
  if (layout.aspects.length) capabilities.add("layout.aspect");
  if (layout.padding.length) capabilities.add("layout.padding");
  if (layout.sizes.length) capabilities.add("layout.size");
  if (layout.participation.length) capabilities.add("layout.flowParticipation");
  if (layout.anchors.length) capabilities.add("layout.anchor");
  return [...capabilities].sort();
}

export function validateCandidateArtifactCapabilities(
  artifact: CandidateCompiledComponentArtifact,
  supported: ReadonlySet<string>,
): void {
  for (const capability of deriveCandidateArtifactCapabilities(artifact)) {
    if (!supported.has(capability)) {
      throw new Error(`Adapter does not support required UI meaning "${capability}".`);
    }
  }
}

function collectCandidateExpressionCapabilities(value: unknown, result: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectCandidateExpressionCapabilities(entry, result);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.kind === "string" &&
    [
      "literal",
      "read",
      "structure-reference",
      "choose",
      "equal",
      "and",
      "or",
      "not",
      "add",
      "scale",
      "compare",
      "clamp",
      "normalize",
      "interpolate",
    ].includes(record.kind)
  ) {
    result.add(`expression.${record.kind}`);
  }
  for (const entry of Object.values(record)) collectCandidateExpressionCapabilities(entry, result);
}

function canonicalCandidateArtifactValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Compiled candidate IR cannot contain non-finite numbers.");
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`Compiled candidate IR cannot contain ${typeof value}.`);
  }
  if (isCandidateExpression(value)) {
    return canonicalCandidateArtifactValue(value.expression, seen);
  }
  if (seen.has(value)) throw new Error("Compiled candidate IR cannot contain cycles.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalCandidateArtifactValue(entry, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Compiled candidate IR accepts plain data objects only.");
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalCandidateArtifactValue(entry, seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

function candidateReferenceChartDefinition<
  App extends CandidateApp,
  Component extends ComponentName<App>,
>(
  definition: CandidateStateNode<App, Component> & {
    readonly states: Readonly<Record<string, CandidateStateNode<App, Component>>>;
  },
): ReferenceChartDefinition {
  const root = candidateReferenceChartNode(definition);
  return { ...root, states: root.states ?? {} };
}

function candidateReferenceChartNode<
  App extends CandidateApp,
  Component extends ComponentName<App>,
>(node: CandidateStateNode<App, Component>, owner = "root"): ReferenceChartNodeDefinition {
  const tasks = node.task === undefined ? [] : Array.isArray(node.task) ? node.task : [node.task];
  const delays =
    node.after === undefined ? [] : Array.isArray(node.after) ? node.after : [node.after];
  return {
    ...(node.type ? { type: node.type } : {}),
    ...(node.initial ? { initial: node.initial } : {}),
    ...(node.states
      ? {
          states: Object.fromEntries(
            Object.entries(node.states).map(([name, child]) => [
              name,
              candidateReferenceChartNode(child, owner === "root" ? name : `${owner}.${name}`),
            ]),
          ),
        }
      : {}),
    ...(node.on
      ? {
          on: Object.fromEntries(
            Object.entries(node.on).map(([event, transition]) => [
              event,
              candidateReferenceChartTransition(transition, `${owner}.on.${event}`),
            ]),
          ),
        }
      : {}),
    ...(node.always
      ? { always: candidateReferenceChartTransition(node.always, `${owner}.always`) }
      : {}),
    ...(node.done ? { done: candidateReferenceChartTransition(node.done, `${owner}.done`) } : {}),
    ...(tasks.length
      ? {
          tasks: tasks.map((task) => {
            const invocation = task as {
              readonly run: PropertyKey;
              readonly done?: unknown;
              readonly fail?: unknown;
            };
            const name = String(invocation.run);
            return {
              task: name,
              ...(invocation.done
                ? {
                    done: candidateReferenceChartTransition(
                      invocation.done,
                      `${owner}.task.${name}.done`,
                    ),
                  }
                : {}),
              ...(invocation.fail
                ? {
                    fail: candidateReferenceChartTransition(
                      invocation.fail,
                      `${owner}.task.${name}.fail`,
                    ),
                  }
                : {}),
            };
          }),
        }
      : {}),
    ...(delays.length
      ? {
          after: delays.flatMap((delay) => {
            const item = delay as {
              readonly wait: number;
              readonly transition: unknown;
            };
            const transitions = Array.isArray(item.transition)
              ? item.transition
              : [item.transition];
            return transitions.map((transition, index) => ({
              wait: item.wait,
              ...candidateReferenceChartTransitionTarget(
                transition,
                `${owner}.after.${String(item.wait)}.${String(index)}`,
              ),
            }));
          }),
        }
      : {}),
    ...(node.output ? { output: { resolver: `${owner}.output` } } : {}),
  };
}

function candidateReferenceChartTransition(
  transition: unknown,
  owner: string,
):
  | string
  | ReferenceChartTransitionTopology
  | readonly (string | ReferenceChartTransitionTopology)[] {
  if (Array.isArray(transition)) {
    return transition.map((item, index) =>
      candidateReferenceChartTransitionItem(item, `${owner}.${String(index)}`),
    );
  }
  return candidateReferenceChartTransitionItem(transition, `${owner}.0`);
}

function candidateReferenceChartTransitionItem(
  transition: unknown,
  guard: string,
): string | ReferenceChartTransitionTopology {
  if (typeof transition === "string") return transition;
  return candidateReferenceChartTransitionTarget(transition, guard);
}

function candidateReferenceChartTransitionTarget(
  transition: unknown,
  guard: string,
): {
  readonly target?: string | readonly string[];
  readonly guard?: string;
  readonly update?: string;
  readonly commands?: readonly { readonly name: string; readonly input?: string }[];
} {
  if (typeof transition === "string") return { target: transition };
  if (typeof transition !== "object" || transition === null) return {};
  const record = transition as Readonly<Record<string, unknown>>;
  const target = record.target;
  if (
    target !== undefined &&
    typeof target !== "string" &&
    (!Array.isArray(target) || target.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error("Candidate statechart target must be an absolute string path.");
  }
  const commandValues =
    record.commands === undefined
      ? []
      : Array.isArray(record.commands)
        ? record.commands
        : [record.commands];
  const commands = commandValues.map((command, index) => {
    if (typeof command !== "object" || command === null || !("run" in command)) {
      throw new Error("Candidate statechart command request must name its command.");
    }
    const invocation = command as { readonly run: PropertyKey; readonly input?: unknown };
    return {
      name: String(invocation.run),
      ...(invocation.input ? { input: `${guard}.command.${String(index)}.input` } : {}),
    };
  });
  return {
    ...(target !== undefined ? { target: target as string | readonly string[] } : {}),
    ...("allow" in record ? { guard } : {}),
    ...("update" in record ? { update: `${guard}.update` } : {}),
    ...(commands.length ? { commands } : {}),
  };
}

export type CandidateNormalizedStructure = {
  readonly nodes: readonly ReferenceSemanticNode[];
  readonly scene: ReferenceSemanticScene;
  readonly focusRecovery?: readonly {
    readonly selection: string;
    readonly departing: readonly string[];
    readonly destination: string;
  }[];
};

const candidateComponentRoots = new WeakMap<object, readonly CandidateStructureChild[]>();

export function issueCandidateStructureComponentInstance<Component extends string>(
  component: Component,
  key: string | number,
  roots: CandidateStructureChild,
): CandidateStructureComponentInstance<Component> {
  if (!component) throw new Error("A component instance needs a non-empty component name.");
  const identity = String(key);
  if (!identity) throw new Error("A component instance needs a non-empty stable key.");
  if (!candidateHasDeclaredStructureNode(roots)) {
    throw new Error(`Component instance "${component}" needs at least one semantic root.`);
  }
  const instance = { key: identity, component } as CandidateStructureComponentInstance<Component>;
  candidateComponentRoots.set(instance, [roots]);
  return instance;
}

export function issueCandidateStructurePart<Part extends string, Element extends string>(
  owner: string,
  part: Part,
  element: Element,
): CandidateStructurePart<Element, Part> {
  if (!owner || !part || !element) {
    throw new Error("A structure part needs non-empty owner, part, and element identities.");
  }
  const partKey = `${owner}.${part}`;
  const create = (
    props: CandidateStructureProps<ReferenceSemanticRole> & {
      readonly role?: ReferenceSemanticRole;
    },
    ...children: readonly CandidateStructureChild[]
  ): CandidateStructureNode<ReferenceSemanticRole, Part> => {
    const role = props.role ?? candidateDefaultRole(element);
    if (!candidateRoleAllowed(element, role)) {
      throw new Error(`Element "${element}" cannot have semantic role "${role}".`);
    }
    const identity = props.key === undefined ? partKey : `${partKey}:${String(props.key)}`;
    const reference = { key: identity, role } as CandidateStructureReference;
    return {
      identity,
      element,
      part,
      role,
      reference,
      props,
      children,
    } as unknown as CandidateStructureNode<ReferenceSemanticRole, Part>;
  };
  return Object.assign(create, { key: partKey, part, element }) as CandidateStructurePart<
    Element,
    Part
  >;
}

export function issueCandidateStructureCollection<
  Item extends object,
  Key extends CandidateScalarKeyOf<Item>,
  Part extends string,
  Element extends string,
  Role extends CandidateAllowedRole<Element>,
>(
  key: string,
  keyField: Key,
  part: CandidateStructurePart<Element, Part>,
  role: Role,
): CandidateStructureCollectionHandle<Item, Key, Part, Element, Role> {
  if (!key) throw new Error("A structure collection needs a non-empty identity.");
  if (!candidateRoleAllowed(part.element, role)) {
    throw new Error(`Element "${part.element}" cannot have semantic role "${role}".`);
  }
  const render = (
    items: readonly Item[],
    renderItem: (
      item: Item,
      index: number,
      itemPart: CandidateKeyedStructurePart<Element, Part, Role>,
    ) => CandidateStructureNode<Role, Part>,
  ): readonly CandidateStructureNode<Role, Part>[] => {
    const identities = new Set<string | number>();
    return items.map((item, index) => {
      const itemKey = item[keyField];
      if (typeof itemKey !== "string" && typeof itemKey !== "number") {
        throw new Error(`Structure collection "${key}" resolved a non-scalar item key.`);
      }
      if (identities.has(itemKey)) {
        throw new Error(`Structure collection "${key}" has duplicate key "${String(itemKey)}".`);
      }
      identities.add(itemKey);
      const itemPart = Object.assign(
        (
          props: CandidateStructureProps<ReferenceSemanticRole>,
          ...children: readonly CandidateStructureChild[]
        ) => part({ ...props, role, key: itemKey } as never, ...children),
        {
          key: `${part.key}:${String(itemKey)}`,
          part: part.part,
          element: part.element,
          role,
        },
      ) as unknown as CandidateKeyedStructurePart<Element, Part, Role>;
      const node = renderItem(item, index, itemPart);
      if (node.part !== part.part || node.identity !== itemPart.key) {
        throw new Error(
          `Structure collection "${key}" must render its compiler-issued "${part.part}" item part.`,
        );
      }
      return node;
    });
  };
  const reference = (
    itemKey: CandidateResolvable<Item[Key] | null | undefined>,
  ): CandidateExpression<CandidateStructureReference<Role> | undefined> =>
    candidateExpression({
      kind: "structure-reference",
      prefix: part.key,
      role,
      key: candidateExpressionNode(itemKey),
    });
  return { key, keyField, part: part.part, role, render, reference };
}

export function normalizeCandidateStructure(
  roots: CandidateStructureChild,
  options: {
    readonly reads?: Readonly<Record<string, unknown>>;
    readonly rootIdentity?: string;
    readonly activeModal?: {
      readonly identity: CandidateStructureReference<"dialog" | "alertdialog">;
      readonly initialFocus: CandidateStructureReference;
      readonly returnFocus: CandidateStructureReference;
    };
    readonly focused?: CandidateStructureReference;
  } = {},
): CandidateNormalizedStructure {
  const reads = options.reads ?? {};
  const focusRecovery = candidateStructureFocusRecovery([roots], reads);
  const rootNodes = candidateStructureNodes([roots], reads);
  if (rootNodes.length === 0) throw new Error("A structure needs at least one semantic root.");
  const semanticNodes: ReferenceSemanticNode[] = [];
  const visit = (node: CandidateStructureNode): void => {
    const children = candidateStructureNodes(node.children, reads);
    semanticNodes.push(candidateReferenceSemanticNode(node, children, reads));
    for (const child of children) visit(child);
  };
  for (const root of rootNodes) visit(root);

  let rootIdentity: string;
  if (rootNodes.length === 1) {
    rootIdentity = rootNodes[0]!.identity;
    if (options.rootIdentity !== undefined && options.rootIdentity !== rootIdentity) {
      throw new Error(
        `Single-root structure resolves to "${rootIdentity}", not "${options.rootIdentity}".`,
      );
    }
  } else {
    rootIdentity = options.rootIdentity ?? "$scene";
    semanticNodes.unshift({
      identity: rootIdentity,
      role: "generic",
      children: rootNodes.map((node) => node.identity),
    });
  }

  const knownNodes = new Map(semanticNodes.map((node) => [node.identity, node]));
  for (const recovery of focusRecovery) {
    const destination = knownNodes.get(recovery.destination);
    if (!destination?.focusable || destination.hidden || destination.inert) {
      throw new Error(`Responsive focus destination "${recovery.destination}" is not available.`);
    }
  }
  return {
    nodes: semanticNodes,
    scene: validateReferenceSemanticTree(semanticNodes, {
      root: rootIdentity,
      ...(options.activeModal
        ? {
            activeModal: {
              identity: options.activeModal.identity.key,
              initialFocus: options.activeModal.initialFocus.key,
              returnFocus: options.activeModal.returnFocus.key,
            },
          }
        : {}),
      ...(options.focused ? { focused: options.focused.key } : {}),
    }),
    ...(focusRecovery.length ? { focusRecovery } : {}),
  };
}

function candidateStructureFocusRecovery(
  children: readonly CandidateStructureChild[],
  reads: Readonly<Record<string, unknown>>,
): readonly {
  readonly selection: string;
  readonly departing: readonly string[];
  readonly destination: string;
}[] {
  const result: { selection: string; departing: readonly string[]; destination: string }[] = [];
  const visit = (child: CandidateStructureChild): void => {
    if (Array.isArray(child)) {
      for (const nested of child) visit(nested);
      return;
    }
    if (typeof child !== "object" || child === null) return;
    if ("kind" in child && child.kind === "selection") {
      const entries = Object.entries(child.cases).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      const focused = entries.filter(([, entry]) => entry.focus !== undefined);
      if (focused.length !== 0 && focused.length !== entries.length) {
        throw new Error("A structural selection must declare focus for every case or no case.");
      }
      for (const [key, entry] of focused) {
        if (!candidateStructureContainsIdentity(entry.content, entry.focus!.key)) {
          throw new Error(
            `Structural selection focus destination "${entry.focus!.key}" is outside case "${key}".`,
          );
        }
      }
      const selected = candidateSelectedStructureCase(child, reads);
      if (selected.entry.focus) {
        result.push({
          selection: focused
            .map(([, entry]) => entry.focus!.key)
            .sort()
            .join(" / "),
          departing: entries.flatMap(([key, entry]) =>
            key === selected.key ? [] : candidateStructureActiveIdentities(entry.content, reads),
          ),
          destination: selected.entry.focus.key,
        });
      }
      visit(selected.entry.content);
      return;
    }
    const roots = candidateComponentRoots.get(child);
    if (roots) {
      for (const root of roots) visit(root);
      return;
    }
    if ("children" in child && Array.isArray(child.children)) {
      for (const nested of child.children) visit(nested);
    }
  };
  for (const child of children) visit(child);
  const selections = new Set<string>();
  for (const recovery of result) {
    if (selections.has(recovery.selection)) {
      throw new Error(`Responsive focus selection "${recovery.selection}" is duplicated.`);
    }
    selections.add(recovery.selection);
  }
  return result.sort((left, right) => left.selection.localeCompare(right.selection));
}

function candidateSelectedStructureCase(
  selection: CandidateStructureSelection,
  reads: Readonly<Record<string, unknown>>,
): {
  readonly key: string;
  readonly entry: CandidateStructureSelection["cases"][string];
} {
  const value = candidateStructureValue(selection.value, reads, "structure selection");
  if (typeof value !== "string" && typeof value !== "boolean") {
    throw new Error("A structural selection needs a string or boolean value.");
  }
  const key = String(value);
  const entry = selection.cases[key];
  if (!entry) throw new Error(`Structural selection has no case "${key}".`);
  return { key, entry };
}

function candidateStructureActiveIdentities(
  child: CandidateStructureChild,
  reads: Readonly<Record<string, unknown>>,
): readonly string[] {
  const identities: string[] = [];
  const visit = (node: CandidateStructureNode): void => {
    identities.push(node.identity);
    for (const nested of candidateStructureNodes(node.children, reads)) visit(nested);
  };
  for (const root of candidateStructureNodes([child], reads)) visit(root);
  return identities;
}

function candidateStructureContainsIdentity(
  child: CandidateStructureChild,
  identity: string,
): boolean {
  if (Array.isArray(child))
    return child.some((nested) => candidateStructureContainsIdentity(nested, identity));
  if (typeof child !== "object" || child === null) return false;
  const roots = candidateComponentRoots.get(child);
  if (roots) return roots.some((root) => candidateStructureContainsIdentity(root, identity));
  if ("kind" in child && child.kind === "selection") {
    return Object.values(child.cases).some((entry) =>
      candidateStructureContainsIdentity(entry.content, identity),
    );
  }
  if ("identity" in child && child.identity === identity) return true;
  return "children" in child && Array.isArray(child.children)
    ? child.children.some((nested) => candidateStructureContainsIdentity(nested, identity))
    : false;
}

function candidateDefaultRole(element: string): ReferenceSemanticRole {
  if (element === "button") return "button";
  if (element === "a") return "link";
  if (element === "form") return "form";
  if (element === "dialog") return "dialog";
  if (element === "input" || element === "textarea" || element === "text-input") {
    return "textbox";
  }
  if (element === "select") return "combobox";
  if (element === "img") return "image";
  return candidateSemanticRoles.has(element as ReferenceSemanticRole)
    ? (element as ReferenceSemanticRole)
    : "generic";
}

const candidateSemanticRoles: ReadonlySet<ReferenceSemanticRole> = new Set([
  "generic",
  "form",
  "group",
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "textbox",
  "combobox",
  "listbox",
  "option",
  "tablist",
  "tab",
  "dialog",
  "alertdialog",
  "grid",
  "row",
  "gridcell",
  "heading",
  "status",
  "alert",
  "tree",
  "treeitem",
  "image",
]);

function candidateRoleAllowed(element: string, role: ReferenceSemanticRole): boolean {
  if (element === "div" || element === "span") return true;
  if (element === "input") {
    return ["textbox", "checkbox", "radio", "switch", "slider", "combobox"].includes(role);
  }
  return role === candidateDefaultRole(element);
}

function candidateStructureNodes(
  children: readonly CandidateStructureChild[],
  reads: Readonly<Record<string, unknown>>,
): CandidateStructureNode[] {
  const nodes: CandidateStructureNode[] = [];
  const visit = (child: CandidateStructureChild): void => {
    if (Array.isArray(child)) {
      for (const nested of child) visit(nested);
      return;
    }
    if (
      typeof child === "object" &&
      child !== null &&
      "kind" in child &&
      child.kind === "selection"
    ) {
      visit(candidateSelectedStructureCase(child, reads).entry.content);
      return;
    }
    if (typeof child === "object" && child !== null) {
      const componentRoots = candidateComponentRoots.get(child);
      if (componentRoots) {
        for (const root of componentRoots) visit(root);
        return;
      }
      if ("component" in child && "key" in child) {
        throw new Error("Structure received a component instance not issued by its compiler.");
      }
    }
    if (
      typeof child === "object" &&
      child !== null &&
      "identity" in child &&
      "reference" in child &&
      "children" in child
    ) {
      nodes.push(child as CandidateStructureNode);
    }
  };
  for (const child of children) visit(child);
  return nodes;
}

function candidateStructureContent(
  children: readonly CandidateStructureChild[],
  reads: Readonly<Record<string, unknown>>,
): ({ kind: "text"; value: string } | { kind: "node"; identity: string })[] {
  const content: ({ kind: "text"; value: string } | { kind: "node"; identity: string })[] = [];
  const appendText = (value: string): void => {
    if (!value) return;
    const previous = content.at(-1);
    if (previous?.kind === "text") previous.value += value;
    else content.push({ kind: "text", value });
  };
  const visit = (child: CandidateStructureChild): void => {
    if (Array.isArray(child)) {
      for (const nested of child) visit(nested);
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      appendText(String(child));
      return;
    }
    if (typeof child !== "object" || child === null) return;
    if ("kind" in child && child.kind === "selection") {
      visit(candidateSelectedStructureCase(child, reads).entry.content);
      return;
    }
    const componentRoots = candidateComponentRoots.get(child);
    if (componentRoots) {
      for (const root of componentRoots) visit(root);
      return;
    }
    if ("identity" in child && "reference" in child && "children" in child) {
      content.push({ kind: "node", identity: String(child.identity) });
    }
  };
  for (const child of children) visit(child);
  return content;
}

function candidateHasDeclaredStructureNode(child: CandidateStructureChild): boolean {
  if (Array.isArray(child)) return child.some(candidateHasDeclaredStructureNode);
  if (typeof child !== "object" || child === null) return false;
  if ("kind" in child && child.kind === "selection") {
    return Object.values(child.cases).some((entry) =>
      candidateHasDeclaredStructureNode(entry.content),
    );
  }
  const componentRoots = candidateComponentRoots.get(child);
  if (componentRoots) return componentRoots.some(candidateHasDeclaredStructureNode);
  return "identity" in child && "reference" in child && "children" in child;
}

function candidateReferenceSemanticNode(
  node: CandidateStructureNode,
  children: readonly CandidateStructureNode[],
  reads: Readonly<Record<string, unknown>>,
): ReferenceSemanticNode {
  const props = node.props as CandidateStructureProps<ReferenceSemanticRole>;
  const adjustableProps = props as CandidateStructureProps<"slider">;
  const activeDescendant =
    props.activeDescendant === undefined
      ? undefined
      : candidateStructureValue(props.activeDescendant, reads, "active descendant");
  const actions = (["activate", "change", "submit", "dismiss"] as const).flatMap((event) => {
    const action = props[event as keyof typeof props];
    if (typeof action !== "function") return [];
    const identity = candidateActionIdentities.get(action);
    if (!identity) {
      throw new Error(
        `Semantic ${event} binding on "${node.identity}" was not issued by the compiler.`,
      );
    }
    return [{ event, action: identity }];
  });
  const content = candidateStructureContent(node.children, reads);
  return {
    identity: node.identity,
    platformKind: node.element,
    role: node.role,
    ...(children.length ? { children: children.map((child) => child.identity) } : {}),
    ...(content.length ? { content } : {}),
    ...(props.name !== undefined
      ? { name: candidateStructureValue(props.name, reads, "accessible name") }
      : {}),
    ...(props.labelledBy ? { labelledBy: props.labelledBy.key } : {}),
    ...(props.describedBy ? { describedBy: props.describedBy.key } : {}),
    focusable: candidateStructureValue(
      props.focusable ?? candidateRoleFocusable(node.role),
      reads,
      "focusable state",
    ),
    ...(props.hidden !== undefined
      ? { hidden: candidateStructureValue(props.hidden, reads, "hidden state") }
      : {}),
    ...(props.inert !== undefined
      ? { inert: candidateStructureValue(props.inert, reads, "inert state") }
      : {}),
    ...(props.modal !== undefined
      ? { modal: candidateStructureValue(props.modal, reads, "modal state") }
      : {}),
    ...(props.disabled !== undefined
      ? { disabled: candidateStructureValue(props.disabled, reads, "disabled state") }
      : {}),
    ...(props.selected !== undefined
      ? { selected: candidateStructureValue(props.selected, reads, "selected state") }
      : {}),
    ...(props.checked !== undefined
      ? { checked: candidateStructureValue(props.checked, reads, "checked state") }
      : {}),
    ...(props.expanded !== undefined
      ? { expanded: candidateStructureValue(props.expanded, reads, "expanded state") }
      : {}),
    ...(activeDescendant ? { activeDescendant: activeDescendant.key } : {}),
    ...(props.formOwner ? { formOwner: props.formOwner.key } : {}),
    ...(props.controls ? { controls: props.controls.key } : {}),
    ...(props.popup ? { popup: props.popup } : {}),
    ...(props.invalid !== undefined
      ? { invalid: candidateStructureValue(props.invalid, reads, "invalid state") }
      : {}),
    ...(props.errorMessage ? { errorMessage: props.errorMessage.key } : {}),
    ...(node.role === "link"
      ? {
          destination: candidateStructureValue(
            (props as CandidateStructureProps<"link">).destination,
            reads,
            "link destination",
          ),
        }
      : {}),
    ...(node.role === "image"
      ? (() => {
          const image = props as CandidateStructureProps<"image">;
          const source = candidateStructureValue(image.source, reads, "image source");
          const decorative =
            typeof image.alternative === "object" &&
            image.alternative !== null &&
            "kind" in image.alternative &&
            image.alternative.kind === "decorative";
          return {
            source,
            ...(decorative
              ? { decorative: true as const }
              : {
                  name: candidateStructureValue(
                    image.alternative as CandidateResolvable<string>,
                    reads,
                    "image alternative",
                  ),
                }),
          };
        })()
      : {}),
    ...(node.role === "textbox" || node.role === "combobox"
      ? {
          textValue: candidateStructureValue(
            (props as CandidateStructureProps<"textbox" | "combobox">).value,
            reads,
            "text value",
          ),
        }
      : {}),
    ...(node.role === "slider"
      ? {
          value: candidateStructureValue(adjustableProps.value, reads, "slider value"),
          minimum: candidateStructureValue(adjustableProps.minimum, reads, "slider minimum"),
          maximum: candidateStructureValue(adjustableProps.maximum, reads, "slider maximum"),
          step: candidateStructureValue(adjustableProps.step, reads, "slider step"),
          largeStep: candidateStructureValue(adjustableProps.largeStep, reads, "slider large step"),
        }
      : {}),
    ...(actions.length ? { actions } : {}),
  };
}

export type CandidateAdjustableSource = "pointer" | "keyboard" | "programmatic";

export type CandidateAdjustableCommand =
  | "increment"
  | "decrement"
  | "largeIncrement"
  | "largeDecrement"
  | "minimum"
  | "maximum";

export type CandidateAdjustableRange = {
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly largeStep: number;
};

export class CandidateAdjustableAdapter {
  readonly #range: CandidateAdjustableRange;

  constructor(range: CandidateAdjustableRange) {
    if (
      !Number.isFinite(range.minimum) ||
      !Number.isFinite(range.maximum) ||
      range.maximum <= range.minimum
    ) {
      throw new Error("Adjustable range needs finite ascending bounds.");
    }
    if (!Number.isFinite(range.step) || range.step <= 0) {
      throw new Error("Adjustable step must be finite and positive.");
    }
    if (!Number.isFinite(range.largeStep) || range.largeStep < range.step) {
      throw new Error("Adjustable large step must be finite and at least one step.");
    }
    this.#range = range;
  }

  resolve(
    current: number,
    proposal: number,
    source: CandidateAdjustableSource,
  ): {
    readonly value: number;
    readonly changed: boolean;
    readonly source: CandidateAdjustableSource;
  } {
    if (!Number.isFinite(current) || !Number.isFinite(proposal)) {
      throw new Error("Adjustable values must be finite.");
    }
    const bounded = Math.max(this.#range.minimum, Math.min(this.#range.maximum, proposal));
    const snapped =
      bounded === this.#range.minimum || bounded === this.#range.maximum
        ? bounded
        : Number(
            (
              this.#range.minimum +
              Math.round((bounded - this.#range.minimum) / this.#range.step) * this.#range.step
            ).toPrecision(15),
          );
    const value = Math.max(this.#range.minimum, Math.min(this.#range.maximum, snapped));
    return { value, changed: value !== current, source };
  }

  command(
    current: number,
    command: CandidateAdjustableCommand,
  ): {
    readonly value: number;
    readonly changed: boolean;
    readonly source: CandidateAdjustableSource;
  } {
    const proposal =
      command === "increment"
        ? current + this.#range.step
        : command === "decrement"
          ? current - this.#range.step
          : command === "largeIncrement"
            ? current + this.#range.largeStep
            : command === "largeDecrement"
              ? current - this.#range.largeStep
              : command === "minimum"
                ? this.#range.minimum
                : this.#range.maximum;
    return this.resolve(current, proposal, "keyboard");
  }
}

function candidateRoleFocusable(role: ReferenceSemanticRole): boolean {
  return [
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "textbox",
    "combobox",
    "listbox",
    "tab",
    "dialog",
    "alertdialog",
    "grid",
    "tree",
  ].includes(role);
}

function candidateStructureValue<Value>(
  value: CandidateResolvable<Value>,
  reads: Readonly<Record<string, unknown>>,
  owner: string,
): Value {
  if (typeof value === "object" && value !== null && "expression" in value && "choose" in value) {
    return evaluateCandidateExpression(value as CandidateExpression<Value>, reads).value;
  }
  if (value === undefined) throw new Error(`${owner} cannot resolve to undefined.`);
  return value;
}

export type CandidateMeasuredGeometry = {
  readonly inline: CandidateExpression<CandidateLength>;
  readonly block: CandidateExpression<CandidateLength>;
  readonly inlineSize: CandidateExpression<CandidateLength>;
  readonly blockSize: CandidateExpression<CandidateLength>;
  readonly aspectRatio: CandidateExpression<number>;
};

export type SemanticOperationScope<
  App extends CandidateApp,
  Component extends ComponentName<App>,
> = {
  readonly input: CandidateReadScope<CandidateComponentField<App, Component, "Input">>;
  readonly context: CandidateReadScope<CandidateComponentField<App, Component, "Context">>;
  readonly values: CandidateReadScope<CandidateComponentField<App, Component, "Values">>;
  readonly parts: {
    readonly [Part in PartName<App, Component>]: CandidatePartTargetsFor<
      App["Components"][Component]["Parts"][Part]
    >;
  };
  readonly state: {
    readonly matches: (
      state: CandidateComponentState<App, Component>,
    ) => CandidateExpression<boolean>;
  };
  readonly recognizers: CandidateComponentRecognizers<App, Component>;
  readonly parameters: CandidateComponentParameters<App, Component>;
  readonly geometry: {
    readonly [Part in PartName<App, Component>]: CandidateMeasuredGeometry;
  };
  readonly environment: {
    readonly compact: CandidateExpression<boolean>;
    readonly reducedMotion: CandidateExpression<boolean>;
    readonly moreContrast: CandidateExpression<boolean>;
    readonly forcedColors: CandidateExpression<boolean>;
    readonly dark: CandidateExpression<boolean>;
    readonly hoverAvailable: CandidateExpression<boolean>;
    readonly finePointer: CandidateExpression<boolean>;
    readonly coarsePointer: CandidateExpression<boolean>;
    readonly landscape: CandidateExpression<boolean>;
    readonly viewportInlineSize: CandidateExpression<CandidateLength>;
    readonly viewportBlockSize: CandidateExpression<CandidateLength>;
    readonly keyboardBlockSize: CandidateExpression<CandidateLength>;
    readonly safeArea: {
      readonly inlineStart: CandidateExpression<CandidateLength>;
      readonly inlineEnd: CandidateExpression<CandidateLength>;
      readonly blockStart: CandidateExpression<CandidateLength>;
      readonly blockEnd: CandidateExpression<CandidateLength>;
    };
  };
};

export type CandidateSemanticContribution =
  | {
      readonly kind: "set";
      readonly target: {
        readonly key: string;
        readonly address: CandidateTargetAddress;
        readonly valueType: CandidateValueType;
        readonly generated?: CandidateGeneratedAddress;
      };
      readonly value: unknown;
    }
  | {
      readonly kind: "transition";
      readonly target: {
        readonly key: string;
        readonly address: CandidateTargetAddress;
        readonly valueType: CandidateValueType;
        readonly generated?: CandidateGeneratedAddress;
      };
      readonly policy: CandidateTransitionPolicy<unknown>;
    };

export type CandidateRelationshipContribution =
  | {
      readonly kind: "above";
      readonly lower: CandidatePresentationIdentity;
      readonly upper: CandidatePresentationIdentity;
    }
  | {
      readonly kind: "clip";
      readonly owner: CandidatePresentationIdentity;
      readonly member: CandidatePresentationIdentity;
    }
  | {
      readonly kind: "hitTest";
      readonly identity: CandidatePresentationIdentity;
      readonly participation: CandidateResolvable<"auto" | "none" | "capture">;
    }
  | {
      readonly kind: "match";
      readonly identity: string;
      readonly source: CandidatePresentationIdentity;
      readonly destination: CandidatePresentationIdentity;
    }
  | {
      readonly kind: "isolate";
      readonly identity: CandidatePresentationIdentity;
    }
  | {
      readonly kind: "nativeLayer";
      readonly identity: CandidatePresentationIdentity;
      readonly layer: CandidateNativeLayerHandle<"modal" | "popover">;
    }
  | {
      readonly kind: "mask";
      readonly owner: CandidatePresentationIdentity;
      readonly source: CandidatePresentationIdentity;
      readonly mode: "alpha" | "luminance";
    };

export type CandidateDirectManipulationContribution =
  | {
      readonly kind: "drive";
      readonly target: CandidateTargetHandle<unknown>;
      readonly gesture: CandidateRecognizerHandle<string, CandidateContinuousRecognizerKind>;
      readonly projection: CandidateExpressionNode;
    }
  | {
      readonly kind: "settle";
      readonly target: CandidateTargetHandle<unknown>;
      readonly gesture: CandidateRecognizerHandle<string, CandidateContinuousRecognizerKind>;
      readonly destinations: Readonly<Record<string, unknown>>;
      readonly policy: CandidateTransitionPolicy<unknown>;
      readonly preserve: "velocity" | "none";
      readonly projectionTime: CandidateParameterHandle<number>;
      readonly resistance: CandidateParameterHandle<number>;
    };

export type CandidateParameterContribution = {
  readonly kind: "parameter";
  readonly parameter: { readonly key: string };
  readonly value: unknown;
};

export type CandidatePresenceContribution = {
  readonly kind: "retain";
  readonly identity: CandidatePresentationIdentity;
  readonly until: readonly { readonly key: string }[];
};

export type CandidateArrangement =
  | {
      readonly algorithm: "flow";
      readonly axis: "inline" | "block";
      readonly gap: CandidateLength;
      readonly align: "start" | "center" | "end" | "stretch";
      readonly distribute: "start" | "center" | "end" | "between" | "around" | "evenly";
      readonly wrap: boolean;
    }
  | {
      readonly algorithm: "grid";
      readonly columns: readonly CandidateGridTrack[];
      readonly rows: readonly CandidateGridTrack[];
      readonly gap: CandidateLength;
    }
  | {
      readonly algorithm: "overlay";
      readonly align: "start" | "center" | "end" | "stretch";
    };

export type CandidateGridTrack =
  | CandidateLength
  | { readonly size: "intrinsic" }
  | { readonly size: "fraction"; readonly value: number };

export type CandidateInsets = {
  readonly inlineStart: CandidateLength;
  readonly inlineEnd: CandidateLength;
  readonly blockStart: CandidateLength;
  readonly blockEnd: CandidateLength;
};

export type CandidateSizeConstraint = {
  readonly minimum?: CandidateLength;
  readonly ideal?: CandidateLength | { readonly size: "intrinsic" };
  readonly maximum?: CandidateLength | { readonly size: "available" };
};

export type CandidateFlowParticipation = {
  readonly grow: number;
  readonly shrink: number;
  readonly basis: CandidateLength | { readonly size: "intrinsic" };
};

export type CandidateAnchorPlacement = {
  readonly inline: "start" | "center" | "end" | "stretch";
  readonly block: "start" | "center" | "end" | "stretch";
  readonly insets: CandidateInsets;
};

export type CandidateLayoutContribution =
  | {
      readonly kind: "arrange";
      readonly parent: CandidatePresentationIdentity;
      readonly children: readonly CandidatePresentationIdentity[];
      readonly arrangement: CandidateArrangement;
    }
  | {
      readonly kind: "intrinsic";
      readonly owner: CandidatePresentationIdentity;
      readonly content: CandidatePresentationIdentity;
      readonly axes: readonly ("inline" | "block")[];
    }
  | {
      readonly kind: "scroll";
      readonly container: CandidatePresentationIdentity;
      readonly content: CandidatePresentationIdentity;
      readonly axis: "inline" | "block" | "both";
      readonly behavior: "free" | "paged";
      readonly indicators: "automatic" | "hidden";
    }
  | {
      readonly kind: "virtualize";
      readonly collection: { readonly key: string };
      readonly viewport: CandidatePresentationIdentity;
      readonly axis: "inline" | "block";
      readonly estimate: CandidateLength;
      readonly overscan: number;
      readonly offscreen: "retain-focused" | "retain-transitioning" | "remove";
    }
  | {
      readonly kind: "place";
      readonly child: CandidatePresentationIdentity;
      readonly column: { readonly start: number; readonly span: number };
      readonly row: { readonly start: number; readonly span: number };
    }
  | {
      readonly kind: "stick";
      readonly identity: CandidatePresentationIdentity;
      readonly container: CandidatePresentationIdentity;
      readonly edge: "inlineStart" | "inlineEnd" | "blockStart" | "blockEnd";
      readonly inset: CandidateLength;
    }
  | {
      readonly kind: "constrainAspect";
      readonly identity: CandidatePresentationIdentity;
      readonly ratio: number;
    }
  | {
      readonly kind: "pad";
      readonly identity: CandidatePresentationIdentity;
      readonly insets: CandidateInsets;
    }
  | {
      readonly kind: "constrainSize";
      readonly identity: CandidatePresentationIdentity;
      readonly inline?: CandidateSizeConstraint;
      readonly block?: CandidateSizeConstraint;
    }
  | {
      readonly kind: "participate";
      readonly identity: CandidatePresentationIdentity;
      readonly flow: CandidateFlowParticipation;
    }
  | {
      readonly kind: "anchor";
      readonly identity: CandidatePresentationIdentity;
      readonly anchor: "viewport" | CandidatePresentationIdentity;
      readonly placement: CandidateAnchorPlacement;
    };

export type CandidatePresentationContribution =
  | CandidateSemanticContribution
  | CandidateRelationshipContribution
  | CandidateDirectManipulationContribution
  | CandidateParameterContribution
  | CandidatePresenceContribution
  | CandidateLayoutContribution;

export type CandidateRecipe<
  Arguments extends readonly unknown[],
  Contributions extends readonly CandidatePresentationContribution[] =
    readonly CandidatePresentationContribution[],
> = (...arguments_: Arguments) => Contributions;

export function createCandidateRecipe<
  Arguments extends readonly unknown[],
  Contributions extends readonly CandidatePresentationContribution[],
>(recipe: CandidateRecipe<Arguments, Contributions>): CandidateRecipe<Arguments, Contributions> {
  return recipe;
}

export type SemanticOperationPreset<
  App extends CandidateApp,
  Preset extends CandidatePresetName<App>,
> = (contract: {
  readonly tokens: CandidateTokenReferences<CandidatePresetTokens<App, Preset>>;
}) => {
  readonly theme: CandidateThemeValues<CandidatePresetTokens<App, Preset>>;
  readonly themes: Readonly<
    Record<
      CandidateDeclaredTheme<App, Preset>,
      CandidateThemeOverrides<CandidatePresetTokens<App, Preset>>
    >
  >;
  readonly components: {
    readonly [Component in ComponentName<App>]: (
      scope: SemanticOperationScope<App, Component>,
    ) => readonly CandidatePresentationContribution[];
  };
};

export function setCandidateTarget<Value>(
  target: CandidateTargetHandle<Value>,
  value: CandidateResolvable<Value>,
): CandidateSemanticContribution {
  return { kind: "set", target, value };
}

export function transitionCandidateTarget<Value>(
  target: CandidateTargetHandle<Value> | CandidateDerivedTargetHandle<Value>,
  policy: CandidateTransitionPolicy<Value>,
): CandidateSemanticContribution {
  return {
    kind: "transition",
    target,
    policy: policy as CandidateTransitionPolicy<unknown>,
  };
}

export function createCandidateTargetHandle<Value>(
  identity: string,
  property: string,
  valueType: CandidateValueType = "unknown",
): CandidateTargetHandle<Value> {
  const address = candidateTargetAddress(identity, property);
  return {
    key: `${address.identity}:${address.property}`,
    address,
    valueType,
  } as CandidateTargetHandle<Value>;
}

export function createCandidateDerivedTargetHandle<Value>(
  identity: string,
  property: string,
  valueType: CandidateValueType = "unknown",
): CandidateDerivedTargetHandle<Value> {
  const address = candidateTargetAddress(identity, property);
  return {
    key: `${address.identity}:${address.property}`,
    address,
    valueType,
  } as CandidateDerivedTargetHandle<Value>;
}

function candidateTargetAddress(identity: string, property: string): CandidateTargetAddress {
  if (!identity || !property || property.includes(":")) {
    throw new Error("A target address needs a non-empty identity and colon-free property.");
  }
  return { identity, property };
}

export function createCandidatePresentationIdentity(key: string): CandidatePresentationIdentity {
  return { key } as CandidatePresentationIdentity;
}

type CandidateIdentityLike =
  | CandidatePresentationIdentity
  | { readonly identity: CandidatePresentationIdentity };

export function aboveCandidate(
  upper: CandidateIdentityLike,
  lower: CandidateIdentityLike,
): CandidateRelationshipContribution {
  return { kind: "above", lower: candidateIdentity(lower), upper: candidateIdentity(upper) };
}

export function clipCandidate(
  owner: CandidateIdentityLike,
  member: CandidateIdentityLike,
): CandidateRelationshipContribution {
  return { kind: "clip", owner: candidateIdentity(owner), member: candidateIdentity(member) };
}

export function hitTestCandidate(
  identity: CandidateIdentityLike,
  participation: CandidateResolvable<"auto" | "none" | "capture">,
): CandidateRelationshipContribution {
  return { kind: "hitTest", identity: candidateIdentity(identity), participation };
}

export function isolateCandidate(
  identity: CandidateIdentityLike,
): CandidateRelationshipContribution {
  return { kind: "isolate", identity: candidateIdentity(identity) };
}

export function nativeLayerCandidate<Kind extends "modal" | "popover">(
  identity: CandidateIdentityLike,
  layer: CandidateNativeLayerHandle<Kind>,
): CandidateRelationshipContribution {
  return {
    kind: "nativeLayer",
    identity: candidateIdentity(identity),
    layer: layer as CandidateNativeLayerHandle<"modal" | "popover">,
  };
}

export function maskCandidate(
  owner: CandidateIdentityLike,
  source: CandidateIdentityLike,
  mode: "alpha" | "luminance",
): CandidateRelationshipContribution {
  return {
    kind: "mask",
    owner: candidateIdentity(owner),
    source: candidateIdentity(source),
    mode,
  };
}

export function issueCandidateNativeLayerHandle<Kind extends "modal" | "popover">(
  key: string,
  kind: Kind,
): CandidateNativeLayerHandle<Kind> {
  return { key, kind } as CandidateNativeLayerHandle<Kind>;
}

export function matchCandidate(
  identity: string,
  source: CandidateIdentityLike,
  destination: CandidateIdentityLike,
): CandidateRelationshipContribution {
  return {
    kind: "match",
    identity,
    source: candidateIdentity(source),
    destination: candidateIdentity(destination),
  };
}

function candidateIdentity(identity: CandidateIdentityLike): CandidatePresentationIdentity {
  return "identity" in identity ? identity.identity : identity;
}

export function createCandidateLayer(
  owner: CandidateIdentityLike,
  name: string,
): CandidateGeneratedLayer {
  if (!name.trim() || name.includes(":")) {
    throw new Error("Generated layer names must be non-empty and cannot contain a colon.");
  }
  const ownerIdentity = candidateIdentity(owner);
  const key = `${ownerIdentity.key}:layer:${name.length}:${name}`;
  const generated = { identity: key, owner: ownerIdentity.key } as const;
  const target = <Value>(property: string, valueType: CandidateValueType) => ({
    ...createCandidateTargetHandle<Value>(key, property, valueType),
    generated,
  });
  const derived = <Value>(property: string, valueType: CandidateValueType) => ({
    ...createCandidateDerivedTargetHandle<Value>(key, property, valueType),
    generated,
  });
  return {
    generated: true,
    owner: ownerIdentity,
    identity: createCandidatePresentationIdentity(key),
    presence: {
      phase: createCandidateReadExpression(`${key}:presence.phase`),
      present: createCandidateReadExpression(`${key}:presence.present`),
    },
    opacity: target("opacity", "number"),
    fill: target("fill", "paint"),
    shape: target("shape", "shape"),
    stroke: target("stroke", "stroke"),
    shadows: target("shadows", "shadows"),
    material: target("material", "material"),
    blockSize: target("blockSize", "length"),
    transform: target("transform", "transform"),
    geometry: derived("geometry", "geometry"),
  };
}

export function createCandidateTransitionPolicy<Value>(
  name: string,
  definition: CandidateTransitionDefinition,
): CandidateTransitionPolicy<Value> {
  if (!name) throw new Error("Transition policy name cannot be empty.");
  validateCandidateTemporalDriver(
    definition.normal.kind === "layout" ? definition.normal.driver : definition.normal,
  );
  validateCandidateTemporalDriver(definition.reduced);
  return { name, definition } as CandidateTransitionPolicy<Value>;
}

function validateCandidateTemporalDriver(driver: CandidateTemporalDriver): void {
  if (driver.kind === "instant") return;
  if (driver.kind === "timing") {
    if (!Number.isFinite(driver.milliseconds) || driver.milliseconds < 0) {
      throw new Error("Timing duration must be finite and non-negative.");
    }
    if (driver.curve.kind === "cubic") {
      for (const value of [driver.curve.x1, driver.curve.y1, driver.curve.x2, driver.curve.y2]) {
        if (!Number.isFinite(value)) throw new Error("Timing curve coordinates must be finite.");
      }
      if (
        driver.curve.x1 < 0 ||
        driver.curve.x1 > 1 ||
        driver.curve.x2 < 0 ||
        driver.curve.x2 > 1
      ) {
        throw new Error("Timing curve x coordinates must be within zero and one.");
      }
    }
    return;
  }
  if (
    !Number.isFinite(driver.mass) ||
    !Number.isFinite(driver.stiffness) ||
    !Number.isFinite(driver.damping) ||
    driver.mass <= 0 ||
    driver.stiffness <= 0 ||
    driver.damping < 0
  ) {
    throw new Error("Spring parameters must be finite with positive mass and stiffness.");
  }
}

export function createCandidateRecognizerHandle<
  Kind extends CandidateRecognizerKind,
  Outcome extends CandidateRecognizerOutcomesForKind<Kind>,
>(key: string, kind: Kind): CandidateRecognizerHandle<Outcome, Kind> {
  const read = <Value>(path: string): CandidateExpression<Value> =>
    createCandidateReadExpression(`${key}.${path}`);
  const base = {
    key,
    kind,
    phase: read<"possible" | "active" | "recognized" | "failed">("phase"),
  };
  if (kind === "drag" || kind === "pan") {
    return {
      ...base,
      translation: { inline: read("translation.inline"), block: read("translation.block") },
      velocity: { inline: read("velocity.inline"), block: read("velocity.block") },
    } as unknown as CandidateRecognizerHandle<Outcome, Kind>;
  }
  if (kind === "pinch") {
    return {
      ...base,
      scale: read("scale"),
      velocity: read("velocity"),
    } as unknown as CandidateRecognizerHandle<Outcome, Kind>;
  }
  if (kind === "rotate") {
    return {
      ...base,
      angle: read("angle"),
      velocity: read("velocity"),
    } as unknown as CandidateRecognizerHandle<Outcome, Kind>;
  }
  if (kind === "longPress") {
    return {
      ...base,
      progress: read("progress"),
      position: { inline: read("position.inline"), block: read("position.block") },
    } as unknown as CandidateRecognizerHandle<Outcome, Kind>;
  }
  return {
    ...base,
    engaged: read("engaged"),
    progress: read("progress"),
    position: { inline: read("position.inline"), block: read("position.block") },
    velocity: { inline: read("velocity.inline"), block: read("velocity.block") },
  } as unknown as CandidateRecognizerHandle<Outcome, Kind>;
}

export function issueCandidateParameterHandle<Value>(key: string): CandidateParameterHandle<Value> {
  return { key } as CandidateParameterHandle<Value>;
}

export function setCandidateParameter<Value>(
  parameter: CandidateParameterHandle<Value>,
  value: CandidateResolvable<Value>,
): CandidateParameterContribution {
  return { kind: "parameter", parameter, value };
}

export function retainCandidate(
  identity: CandidateIdentityLike,
  until: readonly { readonly key: string }[],
): CandidatePresenceContribution {
  if (until.length === 0)
    throw new Error("Retained presence needs at least one settlement target.");
  return { kind: "retain", identity: candidateIdentity(identity), until };
}

export type CandidatePresenceScene = readonly {
  readonly identity: string;
  readonly until: readonly string[];
  readonly release: {
    readonly interaction: "exit-start";
    readonly accessibility: "exit-start";
    readonly unmount: "all-settled";
    readonly stale: "ignore";
  };
}[];

export function normalizeCandidatePresence(
  identities: readonly CandidatePresentationIdentity[],
  contributions: readonly CandidatePresenceContribution[],
  scene: CandidateSemanticScene,
): CandidatePresenceScene {
  const known = new Set(identities.map((identity) => identity.key));
  const transitioned = new Set(scene.transitions.map((transition) => transition.target));
  const owners: ReferenceTargetContribution[] = [];
  const result: CandidatePresenceScene[number][] = [];
  for (const [index, contribution] of contributions.entries()) {
    assertCandidateIdentity(known, contribution.identity, "presence");
    const targets = contribution.until.map((target) => target.key);
    if (new Set(targets).size !== targets.length) {
      throw new Error(`Retained presence for "${contribution.identity.key}" repeats a target.`);
    }
    for (const target of targets) {
      if (!target.startsWith(`${contribution.identity.key}:`)) {
        throw new Error(
          `Presence identity "${contribution.identity.key}" cannot await target "${target}".`,
        );
      }
      if (!transitioned.has(target)) {
        throw new Error(`Presence settlement target "${target}" has no transition policy.`);
      }
    }
    owners.push({
      identity: contribution.identity.key,
      property: "presenceOwner",
      source: `retain[${index}]`,
      value: targets,
    });
    result.push({
      identity: contribution.identity.key,
      until: targets.sort(),
      release: {
        interaction: "exit-start",
        accessibility: "exit-start",
        unmount: "all-settled",
        stale: "ignore",
      },
    });
  }
  resolveReferenceTargets(owners);
  return result.sort((left, right) => left.identity.localeCompare(right.identity));
}

export class CandidateOverlayCloseAdapter {
  #revision = 0;
  #queue: string[] = [];
  #cascade: string[] = [];

  begin(
    stack: readonly string[],
    target: string,
  ): { readonly revision: number; readonly current: string } {
    if (new Set(stack).size !== stack.length)
      throw new Error("Overlay stack identities must be unique.");
    const targetIndex = stack.indexOf(target);
    if (targetIndex < 0) throw new Error(`Unknown overlay close target "${target}".`);
    this.#cascade = stack.slice(targetIndex);
    this.#queue = [...this.#cascade].reverse();
    return { revision: ++this.#revision, current: this.#queue[0]! };
  }

  settle(
    revision: number,
    identity: string,
  ):
    | { readonly accepted: false }
    | { readonly accepted: true; readonly next: string }
    | { readonly accepted: true; readonly complete: true } {
    if (revision !== this.#revision || this.#queue[0] !== identity) return { accepted: false };
    this.#queue.shift();
    if (this.#queue.length) return { accepted: true, next: this.#queue[0]! };
    this.#cascade = [];
    return { accepted: true, complete: true };
  }

  reverse(
    revision: number,
  ):
    | { readonly accepted: false }
    | { readonly accepted: true; readonly revision: number; readonly restore: readonly string[] } {
    if (revision !== this.#revision || this.#cascade.length === 0) return { accepted: false };
    const restore = [...this.#cascade];
    this.#queue = [];
    this.#cascade = [];
    const nextRevision = ++this.#revision;
    return { accepted: true, revision: nextRevision, restore };
  }
}

export type CandidateParameterDefinition<Value> = {
  readonly parameter: CandidateParameterHandle<Value>;
  readonly default: Value;
  readonly minimum?: Value;
  readonly maximum?: Value;
};

export function normalizeCandidateParameters(
  definitions: readonly CandidateParameterDefinition<number>[],
  contributions: readonly CandidateParameterContribution[],
): Readonly<Record<string, unknown>> {
  const byKey = new Map(definitions.map((definition) => [definition.parameter.key, definition]));
  if (byKey.size !== definitions.length)
    throw new Error("Duplicate presentation parameter definition.");
  const resolved = resolveReferenceTargets(
    contributions.map((contribution, index) => {
      const definition = byKey.get(contribution.parameter.key);
      if (!definition) {
        throw new Error(`Unknown presentation parameter "${contribution.parameter.key}".`);
      }
      const expression = isCandidateExpression(contribution.value);
      const numeric = typeof contribution.value === "number" ? contribution.value : undefined;
      if (!expression && (numeric === undefined || !Number.isFinite(numeric))) {
        throw new Error(`Presentation parameter "${contribution.parameter.key}" must be finite.`);
      }
      if (
        !expression &&
        ((definition.minimum !== undefined && numeric! < definition.minimum) ||
          (definition.maximum !== undefined && numeric! > definition.maximum))
      ) {
        throw new Error(
          `Presentation parameter "${contribution.parameter.key}" is outside its bounds.`,
        );
      }
      return {
        identity: contribution.parameter.key,
        property: "parameter",
        source: `parameter[${index}]`,
        value: contribution.value,
      };
    }),
  );
  return Object.fromEntries(
    definitions
      .map((definition) => [
        definition.parameter.key,
        resolved[`${definition.parameter.key}:parameter`]?.value ?? definition.default,
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export function createCandidateCollectionHandle<Key extends string | number>(
  key: string,
): CandidateCollectionHandle<Key> {
  return { key } as CandidateCollectionHandle<Key>;
}

export function flowCandidate(options: {
  readonly axis: "inline" | "block";
  readonly gap: CandidateLength;
  readonly align: "start" | "center" | "end" | "stretch";
  readonly distribute: "start" | "center" | "end" | "between" | "around" | "evenly";
  readonly wrap: boolean;
}): CandidateArrangement {
  return { algorithm: "flow", ...options };
}

export function gridCandidate(options: {
  readonly columns: readonly CandidateGridTrack[];
  readonly rows: readonly CandidateGridTrack[];
  readonly gap: CandidateLength;
}): CandidateArrangement {
  return { algorithm: "grid", ...options };
}

export function overlayCandidate(options: {
  readonly align: "start" | "center" | "end" | "stretch";
}): CandidateArrangement {
  return { algorithm: "overlay", ...options };
}

export function arrangeCandidate(
  parent: CandidateIdentityLike,
  children: readonly CandidateIdentityLike[],
  arrangement: CandidateArrangement,
): CandidateLayoutContribution {
  return {
    kind: "arrange",
    parent: candidateIdentity(parent),
    children: children.map(candidateIdentity),
    arrangement,
  };
}

export function intrinsicCandidate(
  owner: CandidateIdentityLike,
  content: CandidateIdentityLike,
  axes: readonly ("inline" | "block")[],
): CandidateLayoutContribution {
  return {
    kind: "intrinsic",
    owner: candidateIdentity(owner),
    content: candidateIdentity(content),
    axes,
  };
}

export function scrollCandidate(
  container: CandidateIdentityLike,
  content: CandidateIdentityLike,
  options: {
    readonly axis: "inline" | "block" | "both";
    readonly behavior: "free" | "paged";
    readonly indicators: "automatic" | "hidden";
  },
): CandidateLayoutContribution {
  return {
    kind: "scroll",
    container: candidateIdentity(container),
    content: candidateIdentity(content),
    ...options,
  };
}

export function virtualizeCandidate<Key extends string | number>(
  collection: CandidateCollectionHandle<Key>,
  viewport: CandidateIdentityLike,
  options: {
    readonly axis: "inline" | "block";
    readonly estimate: CandidateLength;
    readonly overscan: number;
    readonly offscreen: "retain-focused" | "retain-transitioning" | "remove";
  },
): CandidateLayoutContribution {
  return {
    kind: "virtualize",
    collection,
    viewport: candidateIdentity(viewport),
    ...options,
  };
}

export function placeCandidate(
  child: CandidateIdentityLike,
  placement: {
    readonly column: { readonly start: number; readonly span?: number };
    readonly row: { readonly start: number; readonly span?: number };
  },
): CandidateLayoutContribution {
  return {
    kind: "place",
    child: candidateIdentity(child),
    column: { start: placement.column.start, span: placement.column.span ?? 1 },
    row: { start: placement.row.start, span: placement.row.span ?? 1 },
  };
}

export function stickCandidate(
  identity: CandidateIdentityLike,
  container: CandidateIdentityLike,
  options: {
    readonly edge: "inlineStart" | "inlineEnd" | "blockStart" | "blockEnd";
    readonly inset: CandidateLength;
  },
): CandidateLayoutContribution {
  return {
    kind: "stick",
    identity: candidateIdentity(identity),
    container: candidateIdentity(container),
    ...options,
  };
}

export function constrainCandidateAspect(
  identity: CandidateIdentityLike,
  ratio: number,
): CandidateLayoutContribution {
  return { kind: "constrainAspect", identity: candidateIdentity(identity), ratio };
}

export function padCandidate(
  identity: CandidateIdentityLike,
  insets: CandidateInsets,
): CandidateLayoutContribution {
  return { kind: "pad", identity: candidateIdentity(identity), insets };
}

export function constrainCandidateSize(
  identity: CandidateIdentityLike,
  constraints: {
    readonly inline?: CandidateSizeConstraint;
    readonly block?: CandidateSizeConstraint;
  },
): CandidateLayoutContribution {
  return { kind: "constrainSize", identity: candidateIdentity(identity), ...constraints };
}

export function participateCandidate(
  identity: CandidateIdentityLike,
  flow: CandidateFlowParticipation,
): CandidateLayoutContribution {
  return { kind: "participate", identity: candidateIdentity(identity), flow };
}

export function anchorCandidate(
  identity: CandidateIdentityLike,
  anchor: "viewport" | CandidateIdentityLike,
  placement: CandidateAnchorPlacement,
): CandidateLayoutContribution {
  return {
    kind: "anchor",
    identity: candidateIdentity(identity),
    anchor: anchor === "viewport" ? anchor : candidateIdentity(anchor),
    placement,
  };
}

export function driveCandidate<
  Value,
  Outcome extends string,
  Kind extends CandidateContinuousRecognizerKind,
>(
  target: CandidateTargetHandle<Value>,
  gesture: CandidateRecognizerHandle<Outcome, Kind>,
  projection: CandidateResolvable<Value>,
): CandidateDirectManipulationContribution {
  return {
    kind: "drive",
    target: target as CandidateTargetHandle<unknown>,
    gesture: gesture as unknown as CandidateRecognizerHandle<
      string,
      CandidateContinuousRecognizerKind
    >,
    projection: candidateExpressionNode(projection),
  };
}

export function settleCandidate<
  Value,
  Outcome extends string,
  Kind extends CandidateContinuousRecognizerKind,
>(
  target: CandidateTargetHandle<Value>,
  gesture: CandidateRecognizerHandle<Outcome, Kind>,
  options: {
    readonly destinations: Readonly<Record<Outcome, NoInfer<Value>>>;
    readonly policy: CandidateTransitionPolicy<NoInfer<Value>>;
    readonly preserve: "velocity" | "none";
    readonly projectionTime: CandidateParameterHandle<number>;
    readonly resistance: CandidateParameterHandle<number>;
  },
): CandidateDirectManipulationContribution {
  return {
    kind: "settle",
    target: target as CandidateTargetHandle<unknown>,
    gesture: gesture as unknown as CandidateRecognizerHandle<
      string,
      CandidateContinuousRecognizerKind
    >,
    destinations: options.destinations,
    policy: options.policy as CandidateTransitionPolicy<unknown>,
    preserve: options.preserve,
    projectionTime: options.projectionTime,
    resistance: options.resistance,
  };
}

export type CandidateTransitionableValueType = Exclude<CandidateValueType, "unknown" | "geometry">;

export function normalizeCandidateTransitionCompatibility(
  entries: readonly {
    readonly target: string;
    readonly valueType: CandidateTransitionableValueType;
    readonly from: unknown;
    readonly to: unknown;
  }[],
): readonly { readonly target: string; readonly valueType: CandidateTransitionableValueType }[] {
  const targets = entries.map((entry) => entry.target);
  if (new Set(targets).size !== targets.length) {
    throw new Error("A visual transition batch contains the same target more than once.");
  }
  const validated = entries.map((entry) => {
    if (!entry.target) throw new Error("Visual transition target cannot be empty.");
    validateCandidateTargetValue(entry.valueType, entry.from);
    validateCandidateTargetValue(entry.valueType, entry.to);
    if (entry.valueType === "stroke" && (entry.from === "none" || entry.to === "none")) {
      throw new Error("Stroke presence changes require explicit presentation presence.");
    }
    if (entry.valueType === "material" && (entry.from === "none" || entry.to === "none")) {
      throw new Error("Material presence changes require explicit presentation presence.");
    }
    interpolateCandidateValues(entry.from, entry.to, 0.5);
    return { target: entry.target, valueType: entry.valueType };
  });
  return validated.sort((left, right) => left.target.localeCompare(right.target));
}

export type CandidateSemanticScene = {
  readonly transaction: { readonly targets: readonly string[] };
  readonly targets: Readonly<Record<string, unknown>>;
  readonly addresses: Readonly<Record<string, CandidateTargetAddress>>;
  readonly valueTypes: Readonly<Record<string, CandidateValueType>>;
  readonly transitions: readonly {
    readonly target: string;
    readonly policy: string;
    readonly definition: CandidateTransitionDefinition;
  }[];
  readonly generated?: readonly CandidateGeneratedAddress[];
};

export function normalizeSemanticOperations(
  contributions: readonly CandidateSemanticContribution[],
  availableTargets: readonly {
    readonly key: string;
    readonly address?: CandidateTargetAddress;
    readonly valueType?: CandidateValueType;
  }[] = [],
): CandidateSemanticScene {
  const targetContributions: ReferenceTargetContribution[] = [];
  const policies: {
    target: string;
    policy: string;
    definition: CandidateTransitionDefinition;
  }[] = [];
  const valueTypes = new Map<string, CandidateValueType>();
  const addresses = new Map<string, CandidateTargetAddress>();
  const generated = new Map<string, string>();
  const available = new Set(availableTargets.map((target) => target.key));

  for (const target of availableTargets) {
    if (target.address) addresses.set(target.key, target.address);
    if (target.valueType) valueTypes.set(target.key, target.valueType);
  }

  for (const [index, contribution] of contributions.entries()) {
    const existingAddress = addresses.get(contribution.target.key);
    if (
      existingAddress &&
      (existingAddress.identity !== contribution.target.address.identity ||
        existingAddress.property !== contribution.target.address.property)
    ) {
      throw new Error(`Target "${contribution.target.key}" has two structured addresses.`);
    }
    addresses.set(contribution.target.key, contribution.target.address);
    if (contribution.target.generated) {
      const metadata = contribution.target.generated;
      if (metadata.identity !== contribution.target.address.identity) {
        throw new Error(`Generated target "${contribution.target.key}" has inconsistent identity.`);
      }
      const existingOwner = generated.get(metadata.identity);
      if (existingOwner !== undefined && existingOwner !== metadata.owner) {
        throw new Error(`Generated identity "${metadata.identity}" has conflicting owners.`);
      }
      generated.set(metadata.identity, metadata.owner);
    }
    const existingType = valueTypes.get(contribution.target.key);
    const nextType = contribution.target.valueType;
    if (
      existingType !== undefined &&
      existingType !== "unknown" &&
      nextType !== "unknown" &&
      existingType !== nextType
    ) {
      throw new Error(
        `Target "${contribution.target.key}" has both "${existingType}" and "${nextType}" value types.`,
      );
    }
    if (existingType === undefined || existingType === "unknown") {
      valueTypes.set(contribution.target.key, nextType);
    }
    if (contribution.kind === "set") {
      if (available.has(contribution.target.key)) {
        throw new Error(`Target "${contribution.target.key}" is owned by another semantic domain.`);
      }
      validateCandidateTargetValue(contribution.target.valueType, contribution.value);
      targetContributions.push({
        identity: contribution.target.key,
        property: "value",
        source: `contribution[${index}]`,
        value: contribution.value,
      });
    } else {
      policies.push({
        target: contribution.target.key,
        policy: contribution.policy.name,
        definition: contribution.policy.definition,
      });
    }
  }

  const resolved = resolveReferenceTargets(targetContributions);
  const targets = Object.fromEntries(
    Object.entries(resolved).map(([key, target]) => [key.slice(0, -":value".length), target.value]),
  );
  const transaction = resolveReferenceTransitionTransaction(
    [...Object.keys(targets), ...available].sort(),
    policies.map(({ target, policy }) => ({ target, policy })),
  );
  return {
    transaction: { targets: transaction.targets },
    targets,
    addresses: Object.fromEntries(
      transaction.targets.map((target) => {
        const address = addresses.get(target);
        if (!address) throw new Error(`Target "${target}" has no structured address.`);
        return [target, address];
      }),
    ),
    valueTypes: Object.fromEntries(
      transaction.targets.map((target) => [target, valueTypes.get(target) ?? "unknown"]),
    ),
    transitions: transaction.policies.map((policy) => ({
      ...policy,
      definition: policies.find((candidate) => candidate.target === policy.target)!.definition,
    })),
    ...(generated.size
      ? {
          generated: [...generated]
            .map(([identity, owner]) => ({ identity, owner }))
            .sort((left, right) => left.identity.localeCompare(right.identity)),
        }
      : {}),
  };
}

function validateCandidateTargetValue(valueType: CandidateValueType, value: unknown): void {
  if (valueType === "unknown" || isCandidateExpression(value)) return;
  if (valueType === "number") {
    candidateNumber(value, "numeric target");
    return;
  }
  if (valueType === "length") {
    candidateLength(value, "length target");
    return;
  }
  if (valueType === "paint") {
    validateCandidatePaint(value);
    return;
  }
  if (valueType === "shape") {
    validateCandidateShape(value);
    return;
  }
  if (valueType === "stroke") {
    if (value === "none") return;
    validateCandidateStroke(value);
    return;
  }
  if (valueType === "shadows") {
    validateCandidateShadows(value);
    return;
  }
  if (valueType === "material") {
    if (value === "none") return;
    validateCandidateMaterial(value);
    return;
  }
  if (valueType === "type") {
    validateCandidateTypeStyle(value);
    return;
  }
  if (valueType === "media-fit") {
    validateCandidateMediaFit(value);
    return;
  }
  if (valueType === "transform") {
    validateCandidateTransform(value);
    return;
  }
  if (valueType === "geometry") {
    const geometry = candidateRecord(value, "geometry");
    candidateLength(geometry.inline, "geometry inline");
    candidateLength(geometry.block, "geometry block");
    candidateNonNegativeLength(geometry.inlineSize, "geometry inline size");
    candidateNonNegativeLength(geometry.blockSize, "geometry block size");
  }
}

function isCandidateExpression(value: unknown): value is CandidateExpression<unknown> {
  return typeof value === "object" && value !== null && "expression" in value && "choose" in value;
}

function candidateRecord(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${owner} must be a record.`);
  }
  return value as Record<string, unknown>;
}

function candidateArray(value: unknown, owner: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${owner} must be an array.`);
  return value;
}

function candidateNonNegativeNumber(value: unknown, owner: string): number {
  const number = candidateNumber(value, owner);
  if (number < 0) throw new Error(`${owner} cannot be negative.`);
  return number;
}

function candidateUnitNumber(value: unknown, owner: string): number {
  const number = candidateNumber(value, owner);
  if (number < 0 || number > 1) throw new Error(`${owner} must be within zero and one.`);
  return number;
}

function candidateNonNegativeLength(
  value: unknown,
  owner: string,
  allowZero = true,
): CandidateLength {
  const length = candidateLength(value, owner);
  if (allowZero ? length.value < 0 : length.value <= 0) {
    throw new Error(`${owner} must be ${allowZero ? "non-negative" : "positive"}.`);
  }
  return length;
}

function validateCandidateColor(value: unknown): void {
  const color = candidateRecord(value, "color");
  if (color.colorSpace !== "oklch") throw new Error("Color must use OKLCH.");
  candidateUnitNumber(color.lightness, "color lightness");
  candidateNonNegativeNumber(color.chroma, "color chroma");
  candidateNumber(color.hue, "color hue");
  candidateUnitNumber(color.alpha, "color alpha");
}

function validateCandidatePaint(value: unknown): void {
  const paint = candidateRecord(value, "paint");
  if (paint.kind === "solid") {
    validateCandidateColor(paint.color);
    return;
  }
  const stops = candidateArray(paint.stops, "gradient stops").map((stop) => {
    const record = candidateRecord(stop, "gradient stop");
    validateCandidateColor(record.color);
    return candidateUnitNumber(record.position, "gradient stop position");
  });
  if (stops.length < 2) throw new Error("Gradient needs at least two stops.");
  if (stops.some((stop, index) => index > 0 && stop < stops[index - 1]!)) {
    throw new Error("Gradient stops must be ordered.");
  }
  if (paint.kind === "linear-gradient" || paint.kind === "conic-gradient") {
    const angle = candidateNumericValue(paint.angle, "gradient angle");
    if (typeof angle === "number" || angle.dimension !== "angle") {
      throw new Error("Gradient angle must be an angle.");
    }
  }
  if (paint.kind === "radial-gradient" || paint.kind === "conic-gradient") {
    const center = candidateRecord(paint.center, "gradient center");
    candidateUnitNumber(center.inline, "gradient inline center");
    candidateUnitNumber(center.block, "gradient block center");
  }
  if (paint.kind === "radial-gradient") candidateNonNegativeNumber(paint.radius, "gradient radius");
}

function validateCandidateStroke(value: unknown): void {
  const stroke = candidateRecord(value, "stroke");
  validateCandidatePaint(stroke.paint);
  candidateNonNegativeLength(stroke.width, "stroke width");
  if (
    !(
      stroke.placement === "inside" ||
      stroke.placement === "center" ||
      stroke.placement === "outside"
    )
  ) {
    throw new Error("Stroke placement is invalid.");
  }
  for (const dash of candidateArray(stroke.dash ?? [], "stroke dash")) {
    candidateNonNegativeLength(dash, "stroke dash");
  }
}

function validateCandidateShadows(value: unknown): void {
  for (const value_ of candidateArray(value, "shadows")) {
    const shadow = candidateRecord(value_, "shadow");
    if (!(shadow.kind === "outer" || shadow.kind === "inner")) {
      throw new Error("Shadow kind is invalid.");
    }
    validateCandidateColor(shadow.color);
    const offset = candidateRecord(shadow.offset, "shadow offset");
    candidateLength(offset.inline, "shadow inline offset");
    candidateLength(offset.block, "shadow block offset");
    candidateNonNegativeLength(shadow.blur, "shadow blur");
    candidateLength(shadow.spread, "shadow spread");
  }
}

function validateCandidateMaterial(value: unknown): void {
  const material = candidateRecord(value, "material");
  candidateNonNegativeLength(material.backdropBlur, "material blur");
  candidateNonNegativeNumber(material.backdropSaturation, "material saturation");
  validateCandidatePaint(material.tint);
  candidateUnitNumber(material.noise, "material noise");
}

function validateCandidateTypeStyle(value: unknown): void {
  const type = candidateRecord(value, "type style");
  const families = candidateArray(type.families, "font families");
  if (families.length === 0 || families.some((family) => typeof family !== "string" || !family)) {
    throw new Error("Type style needs non-empty font families.");
  }
  candidateNonNegativeLength(type.size, "font size", false);
  candidateNonNegativeLength(type.lineHeight, "line height", false);
  candidateNumber(type.weight, "font weight");
  candidateLength(type.tracking, "font tracking");
  if (
    !(
      type.align === "start" ||
      type.align === "center" ||
      type.align === "end" ||
      type.align === "justify"
    )
  ) {
    throw new Error("Type alignment is invalid.");
  }
  if (!(type.wrap === "wrap" || type.wrap === "balance" || type.wrap === "nowrap")) {
    throw new Error("Type wrapping is invalid.");
  }
  if (!(type.overflow === "clip" || type.overflow === "ellipsis")) {
    throw new Error("Type overflow is invalid.");
  }
  if (
    !(
      type.decoration === "none" ||
      type.decoration === "underline" ||
      type.decoration === "line-through"
    )
  ) {
    throw new Error("Type decoration is invalid.");
  }
  const variations = candidateRecord(type.variations, "font variations");
  for (const axis of Object.values(variations)) candidateNumber(axis, "font variation");
}

function validateCandidateMediaFit(value: unknown): void {
  const media = candidateRecord(value, "media fit");
  if (
    !(
      media.mode === "contain" ||
      media.mode === "cover" ||
      media.mode === "stretch" ||
      media.mode === "intrinsic"
    )
  ) {
    throw new Error("Media fit mode is invalid.");
  }
  const focalPoint = candidateRecord(media.focalPoint, "media focal point");
  candidateUnitNumber(focalPoint.inline, "media inline focal point");
  candidateUnitNumber(focalPoint.block, "media block focal point");
}

function validateCandidateShape(value: unknown): void {
  const shape = candidateRecord(value, "shape");
  if (shape.kind === "capsule" || shape.kind === "ellipse") return;
  if (shape.kind === "rectangle") {
    const corners = candidateRecord(shape.corners, "shape corners");
    for (const cornerValue of Object.values(corners)) {
      const corner = candidateRecord(cornerValue, "corner");
      candidateNonNegativeLength(corner.radius, "corner radius");
      candidateUnitNumber(corner.smoothing, "corner smoothing");
    }
    return;
  }
  if (shape.kind === "path") {
    const viewBox = candidateRecord(shape.viewBox, "path view box");
    if (
      candidateNumber(viewBox.inlineSize, "path inline size") <= 0 ||
      candidateNumber(viewBox.blockSize, "path block size") <= 0
    ) {
      throw new Error("Path view box must be positive.");
    }
    const commands = candidateArray(shape.commands, "path commands");
    if (commands.length === 0 || candidateRecord(commands[0], "path command").kind !== "move") {
      throw new Error("Path must begin with a move command.");
    }
    for (const [index, commandValue] of commands.entries()) {
      const command = candidateRecord(commandValue, `path command ${index}`);
      if (command.kind === "move" || command.kind === "line") {
        candidateNumber(command.inline, "path inline coordinate");
        candidateNumber(command.block, "path block coordinate");
      } else if (command.kind === "curve") {
        for (const pointName of ["control1", "control2", "end"] as const) {
          const point = candidateRecord(command[pointName], `path ${pointName}`);
          candidateNumber(point.inline, "path inline coordinate");
          candidateNumber(point.block, "path block coordinate");
        }
      } else if (command.kind !== "close") {
        throw new Error(`Unknown path command kind "${String(command.kind)}".`);
      }
    }
    return;
  }
  throw new Error("Unknown shape kind.");
}

function validateCandidateTransform(value: unknown): void {
  const transform = candidateRecord(value, "transform");
  const translation = candidateRecord(transform.translation, "transform translation");
  for (const entry of Object.values(translation)) candidateLength(entry, "transform translation");
  const scale = candidateRecord(transform.scale, "transform scale");
  for (const entry of Object.values(scale)) candidateNumber(entry, "transform scale");
  const rotation = candidateRecord(transform.rotation, "transform rotation");
  const axis = candidateRecord(rotation.axis, "transform rotation axis");
  const x = candidateNumber(axis.x, "transform rotation x axis");
  const y = candidateNumber(axis.y, "transform rotation y axis");
  const z = candidateNumber(axis.z, "transform rotation z axis");
  if (Math.hypot(x, y, z) === 0) throw new Error("Transform rotation axis cannot be zero.");
  const angle = candidateNumericValue(rotation.angle, "transform rotation angle");
  if (typeof angle === "number" || angle.dimension !== "angle") {
    throw new Error("Transform rotation angle must be an angle.");
  }
  const origin = candidateRecord(transform.origin, "transform origin");
  candidateUnitNumber(origin.inline, "transform inline origin");
  candidateUnitNumber(origin.block, "transform block origin");
  candidateLength(origin.depth, "transform depth origin");
  if (transform.perspective !== "none") {
    candidateNonNegativeLength(transform.perspective, "transform perspective", false);
  }
}

export type CandidateRelationshipScene = {
  readonly composition: readonly string[];
  readonly clips: readonly { readonly owner: string; readonly member: string }[];
  readonly hitTests: Readonly<Record<string, CandidateResolvable<"auto" | "none" | "capture">>>;
  readonly matches: readonly {
    readonly identity: string;
    readonly source: string;
    readonly destination: string;
  }[];
  readonly isolates: readonly string[];
  readonly nativeLayers: readonly {
    readonly identity: string;
    readonly kind: "modal" | "popover";
  }[];
  readonly masks: readonly {
    readonly owner: string;
    readonly source: string;
    readonly mode: "alpha" | "luminance";
  }[];
};

export function normalizeSemanticRelationships(
  identities: readonly CandidatePresentationIdentity[],
  contributions: readonly CandidateRelationshipContribution[],
): CandidateRelationshipScene {
  const entries = identities.map((identity, documentOrder) => ({
    identity: identity.key,
    documentOrder,
  }));
  const known = new Set(entries.map((entry) => entry.identity));
  const composition = contributions
    .filter((contribution) => contribution.kind === "above")
    .map((contribution) => ({ below: contribution.lower.key, above: contribution.upper.key }));
  const clips = contributions
    .filter((contribution) => contribution.kind === "clip")
    .map((contribution) => ({ owner: contribution.owner.key, member: contribution.member.key }));
  const hitTests = contributions
    .filter((contribution) => contribution.kind === "hitTest")
    .map((contribution, index) => ({
      identity: contribution.identity.key,
      property: "participation",
      source: `hitTest[${index}]`,
      value: contribution.participation,
    }));
  const matches = contributions
    .filter((contribution) => contribution.kind === "match")
    .flatMap((contribution) => [
      { identity: contribution.identity, side: "source" as const, node: contribution.source.key },
      {
        identity: contribution.identity,
        side: "destination" as const,
        node: contribution.destination.key,
      },
    ]);
  const isolates = contributions
    .filter((contribution) => contribution.kind === "isolate")
    .map((contribution, index) => ({
      identity: contribution.identity.key,
      property: "isolation",
      source: `isolate[${index}]`,
      value: contribution.identity.key,
    }));
  const nativeLayers = contributions
    .filter((contribution) => contribution.kind === "nativeLayer")
    .map((contribution, index) => {
      if (contribution.identity.key !== contribution.layer.key) {
        throw new Error(
          `Native layer capability "${contribution.layer.key}" cannot own "${contribution.identity.key}".`,
        );
      }
      return {
        identity: contribution.identity.key,
        property: "nativeLayer",
        source: `nativeLayer[${index}]`,
        value: contribution.layer.kind,
      };
    });
  const masks = contributions
    .filter((contribution) => contribution.kind === "mask")
    .map((contribution, index) => ({
      identity: contribution.owner.key,
      property: "maskOwner",
      source: `mask[${index}]`,
      value: { source: contribution.source.key, mode: contribution.mode },
    }));

  for (const clip of clips) {
    if (!known.has(clip.owner)) throw new Error(`Unknown clip identity "${clip.owner}".`);
    if (!known.has(clip.member)) throw new Error(`Unknown clip identity "${clip.member}".`);
  }
  for (const contribution of contributions) {
    if (contribution.kind === "hitTest") {
      assertCandidateIdentity(known, contribution.identity, "hit-test");
    }
    if (contribution.kind === "match") {
      assertCandidateIdentity(known, contribution.source, "shared source");
      assertCandidateIdentity(known, contribution.destination, "shared destination");
    }
  }
  for (const contribution of [...isolates, ...nativeLayers]) {
    if (!known.has(contribution.identity)) {
      throw new Error(`Unknown composition identity "${contribution.identity}".`);
    }
  }
  for (const contribution of contributions) {
    if (contribution.kind === "mask") {
      assertCandidateIdentity(known, contribution.owner, "mask owner");
      assertCandidateIdentity(known, contribution.source, "mask source");
      if (contribution.owner.key === contribution.source.key) {
        throw new Error(`Mask owner "${contribution.owner.key}" cannot mask itself.`);
      }
    }
  }
  resolveReferenceComposition(
    entries,
    contributions
      .filter((contribution) => contribution.kind === "mask")
      .map((contribution) => ({ below: contribution.source.key, above: contribution.owner.key })),
  );
  resolveReferenceComposition(
    entries,
    clips.map((clip) => ({ below: clip.member, above: clip.owner })),
  );

  const resolvedHitTests = resolveReferenceTargets(hitTests);
  return {
    composition: resolveReferenceComposition(entries, composition),
    clips: [...clips].sort(
      (left, right) =>
        left.owner.localeCompare(right.owner) || left.member.localeCompare(right.member),
    ),
    hitTests: Object.fromEntries(
      Object.entries(resolvedHitTests).map(([key, target]) => [
        key.slice(0, -":participation".length),
        target.value,
      ]),
    ) as Readonly<Record<string, CandidateResolvable<"auto" | "none" | "capture">>>,
    matches: resolveReferenceSharedIdentities(matches),
    isolates: Object.keys(resolveReferenceTargets(isolates))
      .map((key) => key.slice(0, -":isolation".length))
      .sort(),
    nativeLayers: Object.entries(resolveReferenceTargets(nativeLayers))
      .map(([key, target]) => ({
        identity: key.slice(0, -":nativeLayer".length),
        kind: target.value as "modal" | "popover",
      }))
      .sort((left, right) => left.identity.localeCompare(right.identity)),
    masks: Object.entries(resolveReferenceTargets(masks))
      .map(([key, target]) => ({
        owner: key.slice(0, -":maskOwner".length),
        ...(target.value as { source: string; mode: "alpha" | "luminance" }),
      }))
      .sort((left, right) => left.owner.localeCompare(right.owner)),
  };
}

export type CandidateDirectManipulationScene = {
  readonly lifecycle: {
    readonly capture: "on-recognition";
    readonly release: readonly ["commit", "cancel", "capture-lost", "absent", "dispose"];
    readonly stale: "ignore";
  };
  readonly drives: readonly {
    readonly target: string;
    readonly gesture: string;
    readonly recognizer: CandidateRecognizerKind;
    readonly projection: CandidateExpressionNode;
  }[];
  readonly settlements: readonly {
    readonly target: string;
    readonly gesture: string;
    readonly recognizer: CandidateRecognizerKind;
    readonly destinations: Readonly<Record<string, unknown>>;
    readonly policy: string;
    readonly definition: CandidateTransitionDefinition;
    readonly preserve: "velocity" | "none";
    readonly projectionTime: string;
    readonly resistance: string;
  }[];
};

export function normalizeCandidateDirectManipulation(
  contributions: readonly CandidateDirectManipulationContribution[],
): CandidateDirectManipulationScene {
  const driveTargets: ReferenceTargetContribution[] = [];
  const settleTargets: ReferenceTargetContribution[] = [];

  for (const [index, contribution] of contributions.entries()) {
    const record = {
      target: contribution.target.key,
      gesture: contribution.gesture.key,
      recognizer: contribution.gesture.kind,
    };
    if (contribution.kind === "drive") {
      driveTargets.push({
        identity: contribution.target.key,
        property: "directOwner",
        source: `drive[${index}]`,
        value: { ...record, projection: contribution.projection },
      });
      continue;
    }
    if (Object.keys(contribution.destinations).length === 0) {
      throw new Error(`Gesture settlement for "${contribution.target.key}" has no destinations.`);
    }
    if (contribution.projectionTime.key === contribution.resistance.key) {
      throw new Error("Gesture projection time and resistance need distinct parameters.");
    }
    settleTargets.push({
      identity: contribution.target.key,
      property: "settleOwner",
      source: `settle[${index}]`,
      value: {
        ...record,
        destinations: contribution.destinations,
        policy: contribution.policy.name,
        definition: contribution.policy.definition,
        preserve: contribution.preserve,
        projectionTime: contribution.projectionTime.key,
        resistance: contribution.resistance.key,
      },
    });
  }

  const drives = Object.values(resolveReferenceTargets(driveTargets)).map(
    (target) =>
      target.value as {
        target: string;
        gesture: string;
        recognizer: CandidateRecognizerKind;
        projection: CandidateExpressionNode;
      },
  );
  const settlements = Object.values(resolveReferenceTargets(settleTargets)).map(
    (target) =>
      target.value as {
        target: string;
        gesture: string;
        recognizer: CandidateRecognizerKind;
        destinations: Readonly<Record<string, unknown>>;
        policy: string;
        definition: CandidateTransitionDefinition;
        preserve: "velocity" | "none";
        projectionTime: string;
        resistance: string;
      },
  );
  const directByTarget = new Map(drives.map((drive) => [drive.target, drive.gesture]));
  for (const settlement of settlements) {
    const direct = directByTarget.get(settlement.target);
    if (!direct) {
      throw new Error(`Gesture settlement target "${settlement.target}" has no direct owner.`);
    }
    if (direct !== settlement.gesture) {
      throw new Error(
        `Gesture target "${settlement.target}" is driven by "${direct}" but settled by "${settlement.gesture}".`,
      );
    }
  }
  return {
    lifecycle: {
      capture: "on-recognition",
      release: ["commit", "cancel", "capture-lost", "absent", "dispose"],
      stale: "ignore",
    },
    drives: [...drives].sort((left, right) => left.target.localeCompare(right.target)),
    settlements: [...settlements].sort((left, right) => left.target.localeCompare(right.target)),
  };
}

export function validateCandidateDirectManipulationParameters(
  scene: CandidateDirectManipulationScene,
  parameters: Readonly<Record<string, unknown>>,
): void {
  for (const settlement of scene.settlements) {
    if (!(settlement.projectionTime in parameters)) {
      throw new Error(`Gesture projection parameter "${settlement.projectionTime}" is missing.`);
    }
    if (!(settlement.resistance in parameters)) {
      throw new Error(`Gesture resistance parameter "${settlement.resistance}" is missing.`);
    }
    const projectionTime = candidateNumber(
      parameters[settlement.projectionTime],
      "gesture projection time",
    );
    const resistance = candidateNumber(parameters[settlement.resistance], "gesture resistance");
    if (projectionTime < 0) throw new Error("Gesture projection time cannot be negative.");
    if (resistance < 0 || resistance > 1) {
      throw new Error("Gesture resistance must be within zero and one.");
    }
  }
}

export type CandidateLayoutScene = {
  readonly parents: Readonly<Record<string, string>>;
  readonly arrangements: readonly {
    readonly parent: string;
    readonly children: readonly string[];
    readonly arrangement: CandidateArrangement;
  }[];
  readonly intrinsic: readonly {
    readonly owner: string;
    readonly content: string;
    readonly axes: readonly ("inline" | "block")[];
  }[];
  readonly scrolls: readonly {
    readonly container: string;
    readonly content: string;
    readonly axis: "inline" | "block" | "both";
    readonly behavior: "free" | "paged";
    readonly indicators: "automatic" | "hidden";
  }[];
  readonly virtualized: readonly {
    readonly collection: string;
    readonly viewport: string;
    readonly axis: "inline" | "block";
    readonly estimate: CandidateLength;
    readonly overscan: number;
    readonly offscreen: "retain-focused" | "retain-transitioning" | "remove";
    readonly measurement: {
      readonly source: "observed";
      readonly identity: "keyed";
      readonly stale: "ignore";
    };
  }[];
  readonly placements: readonly {
    readonly child: string;
    readonly parent: string;
    readonly column: { readonly start: number; readonly span: number };
    readonly row: { readonly start: number; readonly span: number };
  }[];
  readonly sticky: readonly {
    readonly identity: string;
    readonly container: string;
    readonly edge: "inlineStart" | "inlineEnd" | "blockStart" | "blockEnd";
    readonly inset: CandidateLength;
  }[];
  readonly aspects: readonly { readonly identity: string; readonly ratio: number }[];
  readonly padding: readonly { readonly identity: string; readonly insets: CandidateInsets }[];
  readonly sizes: readonly {
    readonly identity: string;
    readonly inline?: CandidateSizeConstraint;
    readonly block?: CandidateSizeConstraint;
  }[];
  readonly participation: readonly {
    readonly identity: string;
    readonly parent: string;
    readonly flow: CandidateFlowParticipation;
  }[];
  readonly anchors: readonly {
    readonly identity: string;
    readonly anchor: "viewport" | string;
    readonly placement: CandidateAnchorPlacement;
  }[];
};

export type CandidateMeasurementOrigin = "content" | "font" | "media" | "container";

export type CandidateMeasuredExtent = {
  readonly identity: string;
  readonly inlineSize: number;
  readonly blockSize: number;
};

export class CandidateMeasurementAdapter {
  #revision = 0;
  #measurements = new Map<string, CandidateMeasuredExtent>();
  #disposed = false;

  begin(origin: CandidateMeasurementOrigin): {
    readonly revision: number;
    readonly origin: CandidateMeasurementOrigin;
  } {
    if (this.#disposed) throw new Error("Measurement adapter is disposed.");
    return { revision: ++this.#revision, origin };
  }

  commit(
    transaction: { readonly revision: number; readonly origin: CandidateMeasurementOrigin },
    entries: readonly CandidateMeasuredExtent[],
  ):
    | {
        readonly accepted: true;
        readonly revision: number;
        readonly cause: "geometry";
        readonly origin: CandidateMeasurementOrigin;
        readonly semanticChanged: false;
        readonly presenceChanged: false;
        readonly changes: readonly CandidateMeasuredExtent[];
      }
    | { readonly accepted: false } {
    if (this.#disposed || transaction.revision !== this.#revision) return { accepted: false };
    const next = new Map<string, CandidateMeasuredExtent>();
    for (const entry of entries) {
      if (!entry.identity || next.has(entry.identity)) {
        throw new Error(`Measurement identity "${entry.identity}" must be non-empty and unique.`);
      }
      const inlineSize = candidateNumber(
        entry.inlineSize,
        `${entry.identity} measured inline size`,
      );
      const blockSize = candidateNumber(entry.blockSize, `${entry.identity} measured block size`);
      if (inlineSize <= 0 || blockSize <= 0) {
        throw new Error("Animated intrinsic measurements must have positive size.");
      }
      next.set(entry.identity, { identity: entry.identity, inlineSize, blockSize });
    }
    const changes = [...next.values()]
      .filter((entry) => {
        const previous = this.#measurements.get(entry.identity);
        return (
          !previous ||
          previous.inlineSize !== entry.inlineSize ||
          previous.blockSize !== entry.blockSize
        );
      })
      .sort((left, right) => left.identity.localeCompare(right.identity));
    this.#measurements = next;
    return {
      accepted: true,
      revision: transaction.revision,
      cause: "geometry",
      origin: transaction.origin,
      semanticChanged: false,
      presenceChanged: false,
      changes,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    ++this.#revision;
    this.#measurements.clear();
  }
}

export function normalizeSemanticLayout(
  identities: readonly CandidatePresentationIdentity[],
  contributions: readonly CandidateLayoutContribution[],
): CandidateLayoutScene {
  const entries = identities.map((identity, documentOrder) => ({
    identity: identity.key,
    documentOrder,
  }));
  const known = new Set(entries.map((entry) => entry.identity));
  const arrangements: CandidateLayoutScene["arrangements"][number][] = [];
  const intrinsic: CandidateLayoutScene["intrinsic"][number][] = [];
  const scrolls: CandidateLayoutScene["scrolls"][number][] = [];
  const virtualized: CandidateLayoutScene["virtualized"][number][] = [];
  const placements: CandidateLayoutScene["placements"][number][] = [];
  const sticky: CandidateLayoutScene["sticky"][number][] = [];
  const aspects: CandidateLayoutScene["aspects"][number][] = [];
  const padding: CandidateLayoutScene["padding"][number][] = [];
  const sizes: CandidateLayoutScene["sizes"][number][] = [];
  const participation: Omit<CandidateLayoutScene["participation"][number], "parent">[] = [];
  const anchors: CandidateLayoutScene["anchors"][number][] = [];
  const placementParents = new Map<string, string>();
  const arrangementOwners: ReferenceTargetContribution[] = [];
  const childOwners: ReferenceTargetContribution[] = [];
  const intrinsicOwners: ReferenceTargetContribution[] = [];
  const scrollOwners: ReferenceTargetContribution[] = [];
  const virtualizationOwners: ReferenceTargetContribution[] = [];
  const placementOwners: ReferenceTargetContribution[] = [];
  const stickyOwners: ReferenceTargetContribution[] = [];
  const aspectOwners: ReferenceTargetContribution[] = [];
  const paddingOwners: ReferenceTargetContribution[] = [];
  const sizeOwners: ReferenceTargetContribution[] = [];
  const participationOwners: ReferenceTargetContribution[] = [];
  const anchorOwners: ReferenceTargetContribution[] = [];
  const hierarchy: { below: string; above: string }[] = [];

  for (const [index, contribution] of contributions.entries()) {
    if (contribution.kind === "arrange") {
      assertCandidateIdentity(known, contribution.parent, "layout parent");
      assertCandidateLength(
        contribution.arrangement.algorithm === "overlay" ? undefined : contribution.arrangement.gap,
        "layout gap",
        true,
      );
      if (contribution.arrangement.algorithm === "grid") {
        if (contribution.arrangement.columns.length === 0) {
          throw new Error(`Grid arrangement for "${contribution.parent.key}" has no columns.`);
        }
        for (const track of [
          ...contribution.arrangement.columns,
          ...contribution.arrangement.rows,
        ]) {
          if ("dimension" in track) assertCandidateLength(track, "grid track", false);
          else if (
            track.size === "fraction" &&
            (!Number.isFinite(track.value) || track.value <= 0)
          ) {
            throw new Error("Fractional grid tracks must have a finite positive value.");
          }
        }
      }
      const children = contribution.children.map((child) => {
        assertCandidateIdentity(known, child, "layout child");
        if (child.key === contribution.parent.key) {
          throw new Error(`Layout identity "${child.key}" cannot arrange itself.`);
        }
        return child.key;
      });
      if (new Set(children).size !== children.length) {
        throw new Error(`Arrangement for "${contribution.parent.key}" contains a duplicate child.`);
      }
      arrangementOwners.push({
        identity: contribution.parent.key,
        property: "arrangementOwner",
        source: `arrange[${index}]`,
        value: contribution.arrangement.algorithm,
      });
      for (const child of children) {
        childOwners.push({
          identity: child,
          property: "layoutParent",
          source: `arrange[${index}]`,
          value: contribution.parent.key,
        });
        hierarchy.push({ below: contribution.parent.key, above: child });
      }
      arrangements.push({
        parent: contribution.parent.key,
        children,
        arrangement: contribution.arrangement,
      });
      continue;
    }

    if (contribution.kind === "intrinsic") {
      assertCandidateIdentity(known, contribution.owner, "intrinsic owner");
      assertCandidateIdentity(known, contribution.content, "intrinsic content");
      if (contribution.owner.key === contribution.content.key) {
        throw new Error(`Intrinsic owner "${contribution.owner.key}" cannot measure itself.`);
      }
      if (
        contribution.axes.length === 0 ||
        new Set(contribution.axes).size !== contribution.axes.length
      ) {
        throw new Error(`Intrinsic relation for "${contribution.owner.key}" needs unique axes.`);
      }
      const axes = [...contribution.axes].sort() as ("inline" | "block")[];
      for (const axis of axes) {
        intrinsicOwners.push({
          identity: contribution.owner.key,
          property: `intrinsic:${axis}`,
          source: `intrinsic[${index}]`,
          value: contribution.content.key,
        });
      }
      intrinsic.push({
        owner: contribution.owner.key,
        content: contribution.content.key,
        axes,
      });
      continue;
    }

    if (contribution.kind === "scroll") {
      assertCandidateIdentity(known, contribution.container, "scroll container");
      assertCandidateIdentity(known, contribution.content, "scroll content");
      if (contribution.container.key === contribution.content.key) {
        throw new Error(`Scroll container "${contribution.container.key}" cannot contain itself.`);
      }
      scrollOwners.push(
        {
          identity: contribution.container.key,
          property: "scrollContainer",
          source: `scroll[${index}]`,
          value: contribution.content.key,
        },
        {
          identity: contribution.content.key,
          property: "scrollOwner",
          source: `scroll[${index}]`,
          value: contribution.container.key,
        },
      );
      childOwners.push({
        identity: contribution.content.key,
        property: "layoutParent",
        source: `scroll[${index}]`,
        value: contribution.container.key,
      });
      hierarchy.push({ below: contribution.container.key, above: contribution.content.key });
      scrolls.push({
        container: contribution.container.key,
        content: contribution.content.key,
        axis: contribution.axis,
        behavior: contribution.behavior,
        indicators: contribution.indicators,
      });
      continue;
    }

    if (contribution.kind === "virtualize") {
      assertCandidateIdentity(known, contribution.viewport, "virtual viewport");
      assertCandidateLength(contribution.estimate, "virtual estimate", false);
      if (!Number.isInteger(contribution.overscan) || contribution.overscan < 0) {
        throw new Error("Virtual overscan must be a non-negative integer.");
      }
      virtualizationOwners.push(
        {
          identity: contribution.collection.key,
          property: `virtualCollection:${contribution.axis}`,
          source: `virtualize[${index}]`,
          value: contribution.viewport.key,
        },
        {
          identity: contribution.viewport.key,
          property: `virtualViewport:${contribution.axis}`,
          source: `virtualize[${index}]`,
          value: contribution.collection.key,
        },
      );
      virtualized.push({
        collection: contribution.collection.key,
        viewport: contribution.viewport.key,
        axis: contribution.axis,
        estimate: contribution.estimate,
        overscan: contribution.overscan,
        offscreen: contribution.offscreen,
        measurement: { source: "observed", identity: "keyed", stale: "ignore" },
      });
      continue;
    }

    if (contribution.kind === "place") {
      assertCandidateIdentity(known, contribution.child, "grid child");
      for (const [axis, placement] of [
        ["column", contribution.column],
        ["row", contribution.row],
      ] as const) {
        if (!Number.isSafeInteger(placement.start) || placement.start < 1) {
          throw new Error(`Grid ${axis} start must be a positive safe integer.`);
        }
        if (!Number.isSafeInteger(placement.span) || placement.span < 1) {
          throw new Error(`Grid ${axis} span must be a positive safe integer.`);
        }
      }
      placementOwners.push({
        identity: contribution.child.key,
        property: "gridPlacement",
        source: `place[${index}]`,
        value: contribution,
      });
      placements.push({
        child: contribution.child.key,
        parent: "",
        column: contribution.column,
        row: contribution.row,
      });
      continue;
    }

    if (contribution.kind === "stick") {
      assertCandidateIdentity(known, contribution.identity, "sticky identity");
      assertCandidateIdentity(known, contribution.container, "sticky container");
      if (contribution.identity.key === contribution.container.key) {
        throw new Error(`Sticky identity "${contribution.identity.key}" cannot own itself.`);
      }
      assertCandidateLength(contribution.inset, "sticky inset", true);
      stickyOwners.push({
        identity: contribution.identity.key,
        property: `sticky:${contribution.edge}`,
        source: `stick[${index}]`,
        value: contribution.container.key,
      });
      sticky.push({
        identity: contribution.identity.key,
        container: contribution.container.key,
        edge: contribution.edge,
        inset: contribution.inset,
      });
      continue;
    }

    if (contribution.kind === "constrainAspect") {
      assertCandidateIdentity(known, contribution.identity, "aspect identity");
      if (!Number.isFinite(contribution.ratio) || contribution.ratio <= 0) {
        throw new Error("Aspect ratio must be finite and positive.");
      }
      aspectOwners.push({
        identity: contribution.identity.key,
        property: "aspectConstraint",
        source: `constrainAspect[${index}]`,
        value: contribution.ratio,
      });
      aspects.push({ identity: contribution.identity.key, ratio: contribution.ratio });
      continue;
    }

    if (contribution.kind === "pad") {
      assertCandidateIdentity(known, contribution.identity, "padding identity");
      for (const [edge, value] of Object.entries(contribution.insets)) {
        assertCandidateLength(value, `padding ${edge}`, true);
      }
      paddingOwners.push({
        identity: contribution.identity.key,
        property: "padding",
        source: `pad[${index}]`,
        value: contribution.insets,
      });
      padding.push({ identity: contribution.identity.key, insets: contribution.insets });
      continue;
    }

    if (contribution.kind === "constrainSize") {
      assertCandidateIdentity(known, contribution.identity, "size identity");
      if (!contribution.inline && !contribution.block) {
        throw new Error(`Size constraint for "${contribution.identity.key}" needs an axis.`);
      }
      for (const [axis, constraint] of [
        ["inline", contribution.inline],
        ["block", contribution.block],
      ] as const) {
        if (!constraint) continue;
        const minimum = constraint.minimum;
        const ideal = constraint.ideal;
        const maximum = constraint.maximum;
        if (minimum) assertCandidateLength(minimum, `${axis} minimum`, false);
        if (ideal && "dimension" in ideal) assertCandidateLength(ideal, `${axis} ideal`, false);
        if (maximum && "dimension" in maximum)
          assertCandidateLength(maximum, `${axis} maximum`, false);
        const minimumValue = minimum?.value;
        const idealValue = ideal && "dimension" in ideal ? ideal.value : undefined;
        const maximumValue = maximum && "dimension" in maximum ? maximum.value : undefined;
        if (
          (minimumValue !== undefined && idealValue !== undefined && minimumValue > idealValue) ||
          (idealValue !== undefined && maximumValue !== undefined && idealValue > maximumValue) ||
          (minimumValue !== undefined && maximumValue !== undefined && minimumValue > maximumValue)
        ) {
          throw new Error(`Size constraint for "${contribution.identity.key}" is descending.`);
        }
        sizeOwners.push({
          identity: contribution.identity.key,
          property: `size:${axis}`,
          source: `constrainSize[${index}]`,
          value: constraint,
        });
      }
      sizes.push({
        identity: contribution.identity.key,
        ...(contribution.inline ? { inline: contribution.inline } : {}),
        ...(contribution.block ? { block: contribution.block } : {}),
      });
      continue;
    }

    if (contribution.kind === "participate") {
      assertCandidateIdentity(known, contribution.identity, "flow participant");
      if (
        !Number.isFinite(contribution.flow.grow) ||
        contribution.flow.grow < 0 ||
        !Number.isFinite(contribution.flow.shrink) ||
        contribution.flow.shrink < 0
      ) {
        throw new Error("Flow participation factors must be finite and non-negative.");
      }
      if ("dimension" in contribution.flow.basis) {
        assertCandidateLength(contribution.flow.basis, "flow basis", true);
      }
      participationOwners.push({
        identity: contribution.identity.key,
        property: "flowParticipation",
        source: `participate[${index}]`,
        value: contribution.flow,
      });
      participation.push({ identity: contribution.identity.key, flow: contribution.flow });
      continue;
    }

    if (contribution.kind !== "anchor") {
      throw new Error(`Unknown layout contribution "${(contribution as { kind: string }).kind}".`);
    }
    assertCandidateIdentity(known, contribution.identity, "anchored identity");
    if (contribution.anchor !== "viewport") {
      assertCandidateIdentity(known, contribution.anchor, "anchor identity");
      if (contribution.identity.key === contribution.anchor.key) {
        throw new Error(
          `Anchored identity "${contribution.identity.key}" cannot anchor to itself.`,
        );
      }
      childOwners.push({
        identity: contribution.identity.key,
        property: "layoutParent",
        source: `anchor[${index}]`,
        value: contribution.anchor.key,
      });
      hierarchy.push({ below: contribution.anchor.key, above: contribution.identity.key });
    }
    for (const [edge, value] of Object.entries(contribution.placement.insets)) {
      assertCandidateLength(value, `anchor inset ${edge}`, true);
    }
    anchorOwners.push({
      identity: contribution.identity.key,
      property: "anchor",
      source: `anchor[${index}]`,
      value: {
        anchor: contribution.anchor === "viewport" ? "viewport" : contribution.anchor.key,
        placement: contribution.placement,
      },
    });
    anchors.push({
      identity: contribution.identity.key,
      anchor: contribution.anchor === "viewport" ? "viewport" : contribution.anchor.key,
      placement: contribution.placement,
    });
  }

  resolveReferenceTargets(arrangementOwners);
  resolveReferenceTargets(childOwners);
  resolveReferenceTargets(intrinsicOwners);
  resolveReferenceTargets(scrollOwners);
  resolveReferenceTargets(virtualizationOwners);
  resolveReferenceTargets(placementOwners);
  resolveReferenceTargets(stickyOwners);
  resolveReferenceTargets(aspectOwners);
  resolveReferenceTargets(paddingOwners);
  resolveReferenceTargets(sizeOwners);
  resolveReferenceTargets(participationOwners);
  resolveReferenceTargets(anchorOwners);
  resolveReferenceComposition(entries, hierarchy);
  const parentByChild = new Map(hierarchy.map((edge) => [edge.above, edge.below]));

  for (const placement of placements) {
    const owner = arrangements.find((entry) => entry.children.includes(placement.child));
    if (!owner || owner.arrangement.algorithm !== "grid") {
      throw new Error(`Grid placement for "${placement.child}" needs one grid parent.`);
    }
    placementParents.set(placement.child, owner.parent);
    if (
      placement.column.start + placement.column.span - 1 > owner.arrangement.columns.length ||
      (owner.arrangement.rows.length > 0 &&
        placement.row.start + placement.row.span - 1 > owner.arrangement.rows.length)
    ) {
      throw new Error(`Grid placement for "${placement.child}" exceeds declared tracks.`);
    }
  }

  for (const relation of sticky) {
    const scroll = scrolls.find((entry) => entry.container === relation.container);
    if (!scroll) {
      throw new Error(
        `Sticky identity "${relation.identity}" needs scroll container "${relation.container}".`,
      );
    }
    let current: string | undefined = relation.identity;
    let inside = current === scroll.content;
    while (!inside && current !== undefined) {
      current = parentByChild.get(current);
      inside = current === scroll.content;
    }
    if (!inside) {
      throw new Error(
        `Sticky identity "${relation.identity}" is outside scroll content "${scroll.content}".`,
      );
    }
  }

  for (const relation of virtualized) {
    const scroll = scrolls.find((entry) => entry.container === relation.viewport);
    if (!scroll || (scroll.axis !== "both" && scroll.axis !== relation.axis)) {
      throw new Error(
        `Virtual ${relation.axis} extent for "${relation.collection}" needs a compatible scroll relation on "${relation.viewport}".`,
      );
    }
  }

  const resolvedParticipation = participation.map((relation) => {
    const parent = parentByChild.get(relation.identity);
    const owner = arrangements.find((entry) => entry.parent === parent);
    if (!parent || !owner || owner.arrangement.algorithm !== "flow") {
      throw new Error(`Flow participation for "${relation.identity}" needs one flow parent.`);
    }
    return { ...relation, parent };
  });

  return {
    parents: Object.fromEntries(
      [...parentByChild.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    arrangements: arrangements.sort((left, right) => left.parent.localeCompare(right.parent)),
    intrinsic: intrinsic.sort(
      (left, right) =>
        left.owner.localeCompare(right.owner) || left.content.localeCompare(right.content),
    ),
    scrolls: scrolls.sort((left, right) => left.container.localeCompare(right.container)),
    virtualized: virtualized.sort((left, right) => left.collection.localeCompare(right.collection)),
    placements: placements
      .map((placement) => ({ ...placement, parent: placementParents.get(placement.child)! }))
      .sort((left, right) => left.child.localeCompare(right.child)),
    sticky: sticky.sort((left, right) => left.identity.localeCompare(right.identity)),
    aspects: aspects.sort((left, right) => left.identity.localeCompare(right.identity)),
    padding: padding.sort((left, right) => left.identity.localeCompare(right.identity)),
    sizes: sizes.sort((left, right) => left.identity.localeCompare(right.identity)),
    participation: resolvedParticipation.sort((left, right) =>
      left.identity.localeCompare(right.identity),
    ),
    anchors: anchors.sort((left, right) => left.identity.localeCompare(right.identity)),
  };
}

export type CandidateWebLayoutStyleNode = {
  readonly identity: string;
  readonly declarations: readonly CandidateWebStyleDeclaration[];
};

export function lowerCandidateWebSceneToStyle(options: {
  readonly structure: CandidateNormalizedStructure;
  readonly presentation: CandidateSemanticScene;
  readonly layout: CandidateLayoutScene;
  readonly reads?: Readonly<Record<string, unknown>>;
}): readonly CandidateWebStyleNode[] {
  const nodes = new Map<
    string,
    {
      readonly declarations: Map<string, CandidateWebStyleDeclaration>;
      readonly channels: Map<
        string,
        {
          readonly name: string;
          readonly strategy: CandidateWebPresentationTarget["strategy"];
          readonly sources: readonly string[];
        }
      >;
      readonly sources: Set<string>;
      generated?: CandidateGeneratedAddress;
    }
  >();
  type WebSceneNode = typeof nodes extends Map<string, infer Value> ? Value : never;
  const node = (identity: string): WebSceneNode => {
    const existing = nodes.get(identity);
    if (existing) return existing;
    const created: WebSceneNode = {
      declarations: new Map<string, CandidateWebStyleDeclaration>(),
      channels: new Map<
        string,
        {
          readonly name: string;
          readonly strategy: CandidateWebPresentationTarget["strategy"];
          readonly sources: readonly string[];
        }
      >(),
      sources: new Set<string>(),
    };
    nodes.set(identity, created);
    return created;
  };
  const add = (
    identity: string,
    declaration: CandidateWebStyleDeclaration,
    channel?: {
      readonly name: string;
      readonly strategy: CandidateWebPresentationTarget["strategy"];
      readonly sources: readonly string[];
    },
  ): void => {
    const target = node(identity);
    const previous = target.declarations.get(declaration.name);
    if (previous && previous.value !== declaration.value) {
      throw new Error(
        `Web scene identity "${identity}" has conflicting "${declaration.name}" output.`,
      );
    }
    target.declarations.set(declaration.name, declaration);
    if (channel) target.channels.set(channel.name, channel);
  };

  for (const instruction of lowerCandidatePresentationSceneToWebStyle(
    options.presentation,
    options.reads,
  )) {
    const target = node(instruction.identity);
    for (const source of instruction.sources) target.sources.add(source);
    target.generated = instruction.generated;
    if (instruction.generated) {
      add(instruction.identity, { name: "pointer-events", value: "none" });
    }
    for (const declaration of instruction.declarations) {
      add(
        instruction.identity,
        declaration,
        instruction.channels.find((channel) => channel.name === declaration.name),
      );
    }
  }
  for (const instruction of lowerCandidateLayoutToWebStyle(options.layout)) {
    for (const declaration of instruction.declarations) add(instruction.identity, declaration);
  }
  for (const instruction of lowerCandidateStructureToWeb(options.structure)) {
    if (!("hidden" in instruction.properties)) continue;
    const target = node(instruction.identity);
    target.declarations.set("display", {
      name: "display",
      value:
        instruction.properties.hidden === true
          ? "none"
          : (target.declarations.get("display")?.value ?? ""),
    });
    target.channels.delete("display");
    target.sources.add(`semantic:${instruction.identity}:hidden`);
  }

  return [...nodes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identity, value]) => ({
      identity,
      sources: [...value.sources].sort(),
      declarations: [...value.declarations.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      channels: [...value.channels.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      ...(value.generated ? { generated: value.generated } : {}),
    }));
}

export function lowerCandidateLayoutToWebStyle(
  scene: CandidateLayoutScene,
): readonly CandidateWebLayoutStyleNode[] {
  const nodes = new Map<string, Map<string, string>>();
  const add = (identity: string, name: string, value: string): void => {
    const declarations = nodes.get(identity) ?? new Map<string, string>();
    const previous = declarations.get(name);
    if (previous !== undefined && previous !== value) {
      throw new Error(`Web layout identity "${identity}" has conflicting "${name}" output.`);
    }
    declarations.set(name, value);
    nodes.set(identity, declarations);
  };
  const length = (value: CandidateLength, owner: string) => candidateWebLength(value, owner);
  const track = (value: CandidateGridTrack, owner: string): string => {
    if ("dimension" in value) return length(value, owner);
    if (value.size === "intrinsic") return "max-content";
    return `${value.value}fr`;
  };
  const alignment = (value: "start" | "center" | "end" | "stretch") => value;
  const distribution = (value: "start" | "center" | "end" | "between" | "around" | "evenly") =>
    ({
      start: "start",
      center: "center",
      end: "end",
      between: "space-between",
      around: "space-around",
      evenly: "space-evenly",
    })[value];
  const anchoredIdentities = new Set(scene.anchors.map((relation) => relation.identity));

  for (const relation of scene.arrangements) {
    const owner = `layout ${relation.parent}`;
    if (relation.arrangement.algorithm === "flow") {
      add(relation.parent, "display", "flex");
      add(
        relation.parent,
        "flex-direction",
        relation.arrangement.axis === "inline" ? "row" : "column",
      );
      add(relation.parent, "gap", length(relation.arrangement.gap, owner));
      add(relation.parent, "align-items", alignment(relation.arrangement.align));
      add(relation.parent, "justify-content", distribution(relation.arrangement.distribute));
      add(relation.parent, "flex-wrap", relation.arrangement.wrap ? "wrap" : "nowrap");
      continue;
    }
    if (relation.arrangement.algorithm === "grid") {
      add(relation.parent, "display", "grid");
      add(
        relation.parent,
        "grid-template-columns",
        relation.arrangement.columns.map((value) => track(value, owner)).join(" "),
      );
      if (relation.arrangement.rows.length) {
        add(
          relation.parent,
          "grid-template-rows",
          relation.arrangement.rows.map((value) => track(value, owner)).join(" "),
        );
      }
      add(relation.parent, "gap", length(relation.arrangement.gap, owner));
      continue;
    }
    add(relation.parent, "display", "grid");
    add(relation.parent, "place-items", alignment(relation.arrangement.align));
    for (const child of relation.children) add(child, "grid-area", "1 / 1");
  }

  for (const relation of scene.scrolls) {
    add(relation.container, "overflow-inline", relation.axis === "block" ? "hidden" : "auto");
    add(relation.container, "overflow-block", relation.axis === "inline" ? "hidden" : "auto");
    if (relation.behavior === "paged") {
      add(relation.container, "scroll-snap-type", `${relation.axis} mandatory`);
    }
    if (relation.indicators === "hidden") {
      add(relation.container, "scrollbar-width", "none");
    }
  }
  for (const relation of scene.placements) {
    add(relation.child, "grid-column", `${relation.column.start} / span ${relation.column.span}`);
    add(relation.child, "grid-row", `${relation.row.start} / span ${relation.row.span}`);
  }
  for (const relation of scene.sticky) {
    add(relation.identity, "position", "sticky");
    const property =
      relation.edge === "inlineStart"
        ? "inset-inline-start"
        : relation.edge === "inlineEnd"
          ? "inset-inline-end"
          : relation.edge === "blockStart"
            ? "inset-block-start"
            : "inset-block-end";
    add(relation.identity, property, length(relation.inset, `sticky ${relation.identity}`));
  }
  for (const relation of scene.aspects) {
    add(relation.identity, "aspect-ratio", String(relation.ratio));
  }
  for (const relation of scene.padding) {
    add(
      relation.identity,
      "padding-inline-start",
      length(relation.insets.inlineStart, `padding ${relation.identity}`),
    );
    add(
      relation.identity,
      "padding-inline-end",
      length(relation.insets.inlineEnd, `padding ${relation.identity}`),
    );
    add(
      relation.identity,
      "padding-block-start",
      length(relation.insets.blockStart, `padding ${relation.identity}`),
    );
    add(
      relation.identity,
      "padding-block-end",
      length(relation.insets.blockEnd, `padding ${relation.identity}`),
    );
  }
  const sizeValue = (
    value: CandidateLength | { readonly size: "intrinsic" | "available" },
    owner: string,
  ): string => {
    if ("dimension" in value) return length(value, owner);
    return value.size === "intrinsic" ? "max-content" : "100%";
  };
  for (const relation of scene.sizes) {
    for (const [axis, constraint] of [
      ["inline", relation.inline],
      ["block", relation.block],
    ] as const) {
      if (!constraint) continue;
      const suffix = axis === "inline" ? "inline-size" : "block-size";
      if (constraint.minimum) {
        add(
          relation.identity,
          `min-${suffix}`,
          sizeValue(constraint.minimum, `size ${relation.identity}`),
        );
      }
      if (constraint.ideal) {
        add(relation.identity, suffix, sizeValue(constraint.ideal, `size ${relation.identity}`));
      }
      if (constraint.maximum) {
        add(
          relation.identity,
          `max-${suffix}`,
          sizeValue(constraint.maximum, `size ${relation.identity}`),
        );
      }
    }
  }
  for (const relation of scene.participation) {
    add(relation.identity, "flex-grow", String(relation.flow.grow));
    add(relation.identity, "flex-shrink", String(relation.flow.shrink));
    if (relation.flow.shrink > 0) add(relation.identity, "min-inline-size", "0");
    add(
      relation.identity,
      "flex-basis",
      "dimension" in relation.flow.basis
        ? length(relation.flow.basis, `flow ${relation.identity}`)
        : "auto",
    );
  }
  for (const relation of scene.anchors) {
    const owner = `anchor placement ${relation.identity}`;
    const placeAxis = (
      axis: "inline" | "block",
      alignment: "start" | "center" | "end" | "stretch",
      start: CandidateLength,
      end: CandidateLength,
    ): void => {
      const startProperty = `inset-${axis}-start`;
      const endProperty = `inset-${axis}-end`;
      const marginProperty = `margin-${axis}`;
      if (alignment === "start") {
        add(relation.identity, startProperty, length(start, owner));
        add(relation.identity, endProperty, "auto");
        add(relation.identity, marginProperty, "0");
        return;
      }
      if (alignment === "end") {
        add(relation.identity, startProperty, "auto");
        add(relation.identity, endProperty, length(end, owner));
        add(relation.identity, marginProperty, "0");
        return;
      }
      add(relation.identity, startProperty, length(start, owner));
      add(relation.identity, endProperty, length(end, owner));
      add(relation.identity, marginProperty, alignment === "center" ? "auto" : "0");
    };
    if (relation.anchor === "viewport") {
      add(relation.identity, "position", "fixed");
    } else {
      if (!anchoredIdentities.has(relation.anchor)) {
        add(relation.anchor, "position", "relative");
      }
      add(relation.identity, "position", "absolute");
    }
    placeAxis(
      "inline",
      relation.placement.inline,
      relation.placement.insets.inlineStart,
      relation.placement.insets.inlineEnd,
    );
    placeAxis(
      "block",
      relation.placement.block,
      relation.placement.insets.blockStart,
      relation.placement.insets.blockEnd,
    );
  }

  return [...nodes]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identity, declarations]) => ({
      identity,
      declarations: [...declarations]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => ({ name, value })),
    }));
}

function assertCandidateIdentity(
  known: ReadonlySet<string>,
  identity: CandidatePresentationIdentity,
  role: string,
): void {
  if (!known.has(identity.key)) throw new Error(`Unknown ${role} identity "${identity.key}".`);
}

function assertCandidateLength(
  length: CandidateLength | undefined,
  role: string,
  allowZero: boolean,
): void {
  if (!length) return;
  if (!Number.isFinite(length.value) || (allowZero ? length.value < 0 : length.value <= 0)) {
    throw new Error(`${role} must be a finite ${allowZero ? "non-negative" : "positive"} length.`);
  }
}

type ComponentName<App extends CandidateApp> = Extract<keyof App["Components"], string>;
type CandidatePresetName<App extends CandidateApp> = App["Styles"]["Presets"] extends string
  ? App["Styles"]["Presets"]
  : Extract<keyof App["Styles"]["Presets"], string>;
type CandidatePresetTokens<App extends CandidateApp, Preset extends CandidatePresetName<App>> =
  App["Styles"]["Presets"] extends Readonly<Record<string, unknown>>
    ? Preset extends keyof App["Styles"]["Presets"]
      ? App["Styles"]["Presets"][Preset] extends { readonly Tokens: infer Tokens }
        ? Tokens
        : {}
      : {}
    : {};
type CandidateDeclaredTheme<App extends CandidateApp, Preset extends CandidatePresetName<App>> =
  App["Styles"]["Presets"] extends Readonly<Record<string, unknown>>
    ? Preset extends keyof App["Styles"]["Presets"]
      ? App["Styles"]["Presets"][Preset] extends { readonly Themes: infer Theme extends string }
        ? Exclude<Theme, "default">
        : never
      : never
    : never;
type PartName<App extends CandidateApp, Component extends ComponentName<App>> = Extract<
  keyof App["Components"][Component]["Parts"],
  string
>;

export type CandidateProperty =
  | "minimumBlock"
  | "inset"
  | "corners"
  | "fill"
  | "stroke"
  | "type"
  | "scale"
  | "opacity";

export type CandidateTransition = {
  readonly property: CandidateProperty;
  readonly policy: string;
};

export type CandidateScene = {
  readonly targets: Readonly<Record<string, unknown>>;
  readonly transitions: readonly CandidateTransition[];
};

type CategorizedFragment = {
  readonly layout?: Readonly<Partial<Record<"minimumBlock" | "inset", unknown>>>;
  readonly shape?: Readonly<Partial<Record<"corners", unknown>>>;
  readonly paint?: Readonly<Partial<Record<"fill" | "stroke" | "opacity", unknown>>>;
  readonly typography?: Readonly<Partial<Record<"type", unknown>>>;
  readonly motion?: {
    readonly targets?: Readonly<Partial<Record<"scale", unknown>>>;
    readonly transitions?: readonly CandidateTransition[];
  };
};

export type CategorizedPreset<App extends CandidateApp, Preset extends CandidatePresetName<App>> = {
  readonly name: Preset;
  readonly components: {
    readonly [Component in ComponentName<App>]?: {
      readonly [Part in PartName<App, Component>]?: readonly CategorizedFragment[];
    };
  };
};

export type CandidateTargetOperation = {
  readonly kind: "target";
  readonly property: CandidateProperty;
  readonly value: unknown;
};

export type CandidateTransitionOperation = {
  readonly kind: "transition";
  readonly property: CandidateProperty;
  readonly policy: string;
};

type CandidateOperation = CandidateTargetOperation | CandidateTransitionOperation;

export type OperationalPreset<App extends CandidateApp, Preset extends CandidatePresetName<App>> = {
  readonly name: Preset;
  readonly components: {
    readonly [Component in ComponentName<App>]?: {
      readonly [Part in PartName<App, Component>]?: readonly CandidateOperation[];
    };
  };
};

type TargetEquations = Readonly<Partial<Record<CandidateProperty, unknown>>>;

type EquationPart = {
  readonly targets: TargetEquations;
  readonly transitions?: Readonly<Partial<Record<CandidateProperty, string>>>;
};

export type EquationPreset<App extends CandidateApp, Preset extends CandidatePresetName<App>> = {
  readonly name: Preset;
  readonly components: {
    readonly [Component in ComponentName<App>]?: {
      readonly [Part in PartName<App, Component>]?: EquationPart;
    };
  };
};

export function normalizeCategorizedPreset<App extends CandidateApp>(
  preset: CategorizedPreset<App, CandidatePresetName<App>>,
): CandidateScene {
  const targets: ReferenceTargetContribution[] = [];
  const transitions: CandidateTransition[] = [];

  visitParts<readonly CategorizedFragment[]>(preset.components, (identity, fragments) => {
    for (const [fragmentIndex, fragment] of fragments.entries()) {
      for (const category of [
        fragment.layout,
        fragment.shape,
        fragment.paint,
        fragment.typography,
        fragment.motion?.targets,
      ]) {
        if (!category) continue;
        for (const [property, value] of Object.entries(category)) {
          targets.push({
            identity,
            property,
            source: `${identity}[${fragmentIndex}]`,
            value,
          });
        }
      }
      transitions.push(...(fragment.motion?.transitions ?? []));
    }
  });

  return finishCandidateScene(targets, transitions);
}

export function normalizeOperationalPreset<App extends CandidateApp>(
  preset: OperationalPreset<App, CandidatePresetName<App>>,
): CandidateScene {
  const targets: ReferenceTargetContribution[] = [];
  const transitions: CandidateTransition[] = [];

  visitParts<readonly CandidateOperation[]>(preset.components, (identity, operations) => {
    for (const [operationIndex, operation] of operations.entries()) {
      if (operation.kind === "transition") {
        transitions.push({ property: operation.property, policy: operation.policy });
        continue;
      }
      targets.push({
        identity,
        property: operation.property,
        source: `${identity}[${operationIndex}]`,
        value: operation.value,
      });
    }
  });

  return finishCandidateScene(targets, transitions);
}

export function normalizeEquationPreset<App extends CandidateApp>(
  preset: EquationPreset<App, CandidatePresetName<App>>,
): CandidateScene {
  const targets: ReferenceTargetContribution[] = [];
  const transitions: CandidateTransition[] = [];

  visitParts<EquationPart>(preset.components, (identity, part) => {
    for (const [property, value] of Object.entries(part.targets)) {
      targets.push({ identity, property, source: identity, value });
    }
    for (const [property, policy] of Object.entries(part.transitions ?? {})) {
      transitions.push({ property: property as CandidateProperty, policy });
    }
  });

  return finishCandidateScene(targets, transitions);
}

function visitParts<Value>(
  components: Readonly<Record<string, Readonly<Record<string, Value | undefined>> | undefined>>,
  visit: (identity: string, value: Value) => void,
): void {
  for (const component of Object.keys(components).sort()) {
    const parts = components[component];
    if (!parts) continue;
    for (const part of Object.keys(parts).sort()) {
      const value = parts[part];
      if (value === undefined) continue;
      visit(`${component}.${part}`, value);
    }
  }
}

function finishCandidateScene(
  targetContributions: Parameters<typeof resolveReferenceTargets>[0],
  transitions: readonly CandidateTransition[],
): CandidateScene {
  const resolved = resolveReferenceTargets(targetContributions);
  return {
    targets: Object.fromEntries(
      Object.entries(resolved).map(([key, target]) => [key, target.value]),
    ),
    transitions: [...transitions].sort(
      (left, right) =>
        left.property.localeCompare(right.property) || left.policy.localeCompare(right.policy),
    ),
  };
}
