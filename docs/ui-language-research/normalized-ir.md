# Normalized UI Semantic IR

## Status

- Version: 0.1
- Role: candidate-independent comparison and adapter contract
- Public API: no
- Backend API: no

This document materializes the semantic domains in `semantics.md`. Candidate TypeScript notations
must normalize into this meaning before backend selection. The IR is descriptive data with stable
identity and typed references. It contains no closures, DOM nodes, CSS properties, selectors,
StyleX declarations, Anime.js instances, WAAPI objects, clocks, or callbacks.

The exact serialized schema is not promised as a public format. Its distinctions are normative for
candidate comparison.

The research compiler emits one versioned canonical component artifact spanning behavior, resolved
structure, targets, relationships, gestures, and layout. It recursively strips typed author helpers
to expression nodes, accepts plain finite data only, rejects cycles/functions/class instances, sorts
object keys, and preserves semantically ordered arrays. Recompiling parsed output is byte-stable.

The artifact derives a sorted semantic capability manifest before adapter execution. Capability
names describe meaning (`semantic.action.activate`, `expression.read`, `layout.flow`,
`transition.spring`, `composition.hitTest`), never a library or browser mechanism. An adapter must
declare every required meaning and normalization fails on the first missing capability.

## Root

```ts
type Program = {
  contract: Contract;
  components: Record<ComponentName, Component>;
  presets: Record<PresetName, Preset>;
  tokens: TokenGraph;
  capabilities: CapabilityRequirement[];
};
```

The explicit generic application contract provides every name and value domain. Normalization never
discovers new states, actions, parts, slots, gestures, tokens, or presets from implementation helper
calls.

## Component Meaning

```ts
type Component = {
  behavior: Statechart;
  derivations: DerivationGraph;
  structure: SemanticTree;
  parts: PartIndex;
  slots: SlotContract;
  gestures: GestureIntentGraph;
};
```

### Behavior

Behavior contains discrete statechart nodes, events, guards, immutable context updates, delayed
events, typed commands, abortable tasks, completion, and output. It cannot contain visual values or
adapter mechanisms.

Every transition alternative carries stable optional resolver identities for its pure context update
and ordered named command requests. Command payload functions become resolver names; they are not
serialized. The generic contract validates command vocabulary before artifact emission. The
independent command model defines commit-before-request and exactly-once drain; production adapter
integration of that model remains required.

### Derivations

Derivations are pure typed expressions over declared resource views, component input, discrete state,
and context. Dependency edges are explicit. A derivation cannot dispatch or observe time.

### Semantic tree

Each semantic node has:

```ts
type SemanticNode = {
  identity: SemanticIdentity;
  platformKind: NativeWebKind;
  properties: SemanticProperty[];
  actions: ActionBinding[];
  children: SemanticIdentity[];
  presence?: PresenceContract;
  component?: ComponentInstance;
  slot?: SlotAssignment;
  adjustable?: {
    value: Expression<number>;
    minimum: Expression<number>;
    maximum: Expression<number>;
    step: Expression<number>;
    largeStep: Expression<number>;
    change: ActionIdentity;
  };
};
```

Native web kind and properties remain platform-specific because accessibility and platform behavior
are not visual lowering details. Decorative presentation layers do not enter this tree.

An active modal scene carries one complete focus contract:

```ts
type ActiveModal = {
  identity: SemanticIdentity;
  initialFocus: SemanticIdentity;
  returnFocus: SemanticIdentity;
};
```

Initial focus must be an available focusable descendant. Return focus must be an available focusable
control outside the modal that explicitly controls it. The platform adapter activates modality and
initial focus together, then releases modality and restores return focus together before retained
visual exit. Presets cannot read or alter this contract.

Author action values remain callable functions, but the compiler issues them with opaque contract
identity. Normalization emits plain `{ event, action }` bindings and rejects an arbitrary callback;
the function itself never enters IR. This retains direct author ergonomics without making behavior
identity depend on function source text or closure serialization.

A structural selection contains one string-union or boolean expression and an exhaustive case map
derived from an explicit generic parameter. Materialization contributes exactly one case to the
semantic tree for a revision. Every case identity remains compiler-known so switching, reversal,
diagnostics, focus recovery, and hot refresh do not depend on reconstructing author closures or
nesting binary branches. Absence is ordinary `null` content in an explicit case. A selection either
declares one compiler-issued focus destination for every case or none. If current focus disappears,
the selected case's destination is the only lawful replacement; if focus survives, it is preserved.

### Parts

A part index maps a contract-declared local name to stable semantic identities. A part is a typed
presentation address, not a selector. A keyed plural part maps key identity explicitly and cannot be
addressed by positional index. Its collection contract records item type, scalar key field, item part,
and semantic role. Reactive relationships resolve from the domain key through that same contract.

Each semantic part may expose adapter-owned interaction facts. The base set is hover and focus-within;
focusable controls may additionally expose focus-visible and pressed. These are typed dependency
references, not event callbacks or component-global booleans. Semantic disabled/selected/expanded
state and named gesture activity remain in their own IR domains.

### Slots

A slot declares accepted component contract, cardinality, ownership, and semantic placement. Slot
assignment contains opaque component instances and preserves child privacy; a parent structure or
preset cannot query child parts, state, context, or actions. Placing an instance contributes its
semantic roots while retaining the component boundary in the IR.

## Preset Meaning

```ts
type Preset = {
  tokenContract: TokenContract;
  themes: ThemeMode[];
  presentations: Record<ComponentName, PresentationGraph>;
};
```

A presentation graph is pure and may read only declared presentation scope. Its output is a target
scene and temporal policy associations.

## Hot-Reload Descriptor

The compiler derives a canonical compatibility descriptor from the normalized artifact. Its contract
key contains component identity, behavior topology, semantic identity/role/action bindings, and
recognizer topology. It separately lists semantic identities and visual target identities so the
runtime can retain only surviving presence and presented target samples. Presentation values and
layout relations are deliberately outside the compatibility key; changing them is the purpose of a
preset or presentation refresh, not a reason to discard semantic state.

The refresh result is a transaction with cause `presentation` or `contract`, an explicit remount bit,
retained context/state/presence/sample facts, and deduplicated motion/task/gesture disposal lists. No
module closure or backend object enters the descriptor.

## Typed Expressions

```ts
type Expression<T> = {
  valueType: ValueType<T>;
  dependencies: DependencyRef[];
  operation: ExpressionOperation;
};
```

One expression algebra covers conditions and values. It supports typed literals and references,
boolean logic, equality, ordered comparison, choice, dimension-safe arithmetic, bounded mapping, and
interpolation with explicit clamp or extrapolation. Equivalent expressions have equal meaning
regardless of source grouping.

Dependencies may reference:

- input, context, state predicates, and derived values;
- part-local interaction state;
- declared gesture channels;
- revisioned local geometry;
- typed environment facts;
- preset token identities.

## Target Scene

```ts
type TargetScene = {
  values: TargetValue[];
  layout: LayoutRelation[];
  composition: CompositionRelation[];
  generated: GeneratedLayer[];
  sharedIdentity: SharedIdentityRelation[];
  gestureMappings: GestureMapping[];
  transitions: TransitionAssociation[];
};
```

### Target values

```ts
type TargetValue<T> = {
  target: TargetRef<T>;
  expression: Expression<T>;
  source: SourceLocation;
};
```

`TargetRef<T>` is compiler-issued from a part and semantic property. It is not a string. Exactly one
resolved expression owns a target in one scene.

The current candidate proof retains a structured `{ identity, property }` address and concrete
`valueType` beside every normalized target value. A canonical string also exists solely as a stable map
key and diagnostic label; adapters consume the structured address. Unknown domains, invalid address
construction, and conflicting types fail before execution, so adapters do not infer paint, length,
transform, or layout meaning from serialized values or arbitrary target names.

### Layout relations

Layout is relational, not a bag of coordinates:

```ts
type LayoutRelation =
  | FlowRelation
  | GridRelation
  | OverlayRelation
  | IntrinsicRelation
  | ScrollRelation
  | VirtualExtentRelation;
```

Every relation declares parent, children, constraints, logical axis, intrinsic measurement policy,
and participation. Child placement cannot silently depend on an undeclared ancestor.

`VirtualExtentRelation` additionally declares keyed identity, estimated and measured extent,
overscan policy, semantic count, focus retention, and offscreen transition policy. It does not own
application filtering or item data.

Intrinsic observations are adapter transactions with an origin of content, font, media, or container.
They are revisioned, atomically validated, and emitted as geometry-only changes. Equal observations do
not start another transition; stale observations cannot mutate the current scene; semantic and
presence state are unchanged.

### Composition relations

```ts
type CompositionRelation =
  | { kind: "above"; lower: PresentationIdentity; upper: PresentationIdentity }
  | { kind: "clip"; owner: PresentationIdentity; member: PresentationIdentity }
  | { kind: "isolate"; identity: PresentationIdentity }
  | { kind: "hitTest"; identity: PresentationIdentity; participation: Expression<HitTest> }
  | { kind: "nativeLayer"; identity: PresentationIdentity; owner: SemanticIdentity };
```

The graph must be acyclic and sufficient to predict observable paint and hit-test order. Numeric z
values are adapter output, not semantic ordering.

### Generated layers

A generated visual layer has presentation identity, owner, target values, and composition relations.
It is inaccessible and unfocusable by construction. If content carries meaning or action, it must be
a semantic node instead. Generated layers never own hit testing; the adapter routes pointer input only
through semantic structure and lowers generated web nodes with `pointer-events: none`.

### Shared identity

A shared-identity relation pairs at most one source and one destination for one visual identity. It
does not merge semantic trees or duplicate accessibility. Unmatched identities remain ordinary
presence transitions.

Nested native-layer ancestry derives one revisioned close cascade. Descendants settle before their
ancestor may begin exit. Reversal restores the affected chain outer-to-inner and advances the
revision, so stale child or parent settlement cannot mutate the restored hierarchy.

## Gesture Intent And Presentation

Structure owns:

```ts
type RecognizerIntent = {
  name: RecognizerName;
  kind: "drag" | "pan" | "pinch" | "rotate" | "longPress" | "hoverIntent";
  activation: ActivationPolicy;
  legalOutcomes: SemanticOutcome[];
  relations: RecognizerRelation[];
  accessibilityAlternative: { kind: "action"; action: ActionRef } | { kind: "focus" };
  handoff?: { destination: PartRef; corridor: "safe-polygon" };
  autoScroll?: {
    owner: PartRef;
    edgeFraction: ParameterRef<number>;
    maximumViewportPerSecond: ParameterRef<number>;
  };
};
```

Relations express explicit precedence, failure dependency, and simultaneity. An unresolved conflict
is invalid; source order is not arbitration.

The preset owns:

```ts
type GestureMapping = {
  recognizer: RecognizerRef;
  direct: { target: TargetRef; projection: Expression }[];
  resistance?: MappingExpression;
  destinations: DestinationPresentation[];
  settlement: TransitionPolicyRef;
};
```

Presentation can map only structure-declared signals and outcomes. At release, direct ownership hands
the current value and resolved velocity exactly once to settlement. The adapter owns pointer capture,
coalescing, prediction, native scrolling integration, and engine selection.

## Geometry And Layout Transition

Geometry is an adapter-produced, revisioned value:

```ts
type GeometrySnapshot = {
  revision: number;
  values: Record<PresentationIdentity, LogicalRect>;
};
```

Only a complete current revision becomes observable. Stale measurement cannot retarget a channel.

A layout transition associates stable identities and old/new geometry with temporal policy. Target
layout becomes the new layout immediately; the presented scene may project old geometry into it. The
projection cannot alter reading order, focus, hit testing, or semantic identity.

## Transition Transactions

```ts
type TransitionTransaction = {
  revision: number;
  cause: SemanticCause | EnvironmentCause;
  changes: TargetChange[];
  policies: TransitionAssociation[];
  compatibility: ChannelCompatibility[];
};
```

A transition association references a typed changed target. It cannot supply a second target.

Channel compatibility determines whether a changed target:

- retargets from current value and velocity;
- settles immediately at the same semantic endpoint;
- changes visual ownership after deterministic settlement;
- starts a new identity because the semantic identity changed.

Preset, theme, reduced-motion, geometry, and environment changes use this same transaction model.

## Physical Motion

A physical spring contains mass, stiffness, damping, and settlement thresholds. Initial value and
velocity come from the retained channel, never from the preset policy. Timing policy contains duration
and a normalized monotonic curve. Meaningful stages remain statechart topology; visual choreography
derives channel ranges from one authoritative progress value rather than adding a timeline IR.

Reduced-motion substitution changes the trajectory but reaches the same semantic target and preserves
required lifecycle completion. Nonessential spatial movement can become immediate or a non-spatial
appearance change.

## Adapter Capabilities

An adapter declares supported semantic capabilities and strategies separately:

```ts
type Capability = {
  meaning: CapabilityName;
  support: "native" | "lowered" | "unsupported";
  strategy: InternalStrategy;
};
```

Candidate source can require meaning but cannot choose a strategy. Unsupported meaning fails during
normalization or adapter compilation. A web adapter may choose static StyleX, native CSS layout,
direct inline values, Anime.js Animatable, Anime.js Layout, Anime.js Draggable, WAAPI, native dialog,
or another implementation only when conformance is preserved.

## Hard-Case Normalization

### C07: Virtualized list

- semantic tree owns collection identity, count, item semantics, focus, and selection;
- layout owns keyed virtual extent, window, measurement revision, and scroll relationship;
- target scene owns visible-item appearance and local layout transition policy;
- offscreen records do not receive presentation identities or animate through the viewport.

### C10: Measured text replacement

- structure owns outgoing/incoming semantic presence and reading order;
- adapter supplies revisioned intrinsic geometry after font and line layout;
- target scene associates container geometry and content appearance transitions;
- stale font or observer revisions cannot start another transition;
- direction and language are semantic/environment facts, not preset guesses.

### C16: Multi-pointer canvas

- behavior owns tool mode, selection, commands, and keyboard alternatives;
- gesture graph owns pan, pinch, rotate, object drag, and their explicit simultaneous or exclusive
  relationships;
- preset maps authoritative gesture channels to camera/object targets and generated guides;
- statecharts do not receive every pointer sample;
- adapter owns pointer capture and coalesced/predicted platform input.

### C18: Environment change during motion

- semantic identity and component state do not change;
- one environment transaction produces a new target scene and policy set;
- compatible channels retarget from current value and velocity;
- reduced motion reaches the same endpoint;
- incompatible presentation ownership settles deterministically without stale completion.

## Invalid IR

Normalization fails for:

- duplicate target or retained-channel ownership;
- unknown contract names or untyped references;
- expression, token, composition, or gesture-relation cycles;
- dimension or applicability mismatch;
- ambiguous gesture competition;
- duplicate keyed or shared identity;
- presentation action dispatch or resource mutation;
- semantic content in a generated layer;
- transition policy for an unchanged or unknown target;
- platform meaning unsupported by the selected adapter.
