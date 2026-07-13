# UI Language Semantic Model

## Status

- Version: 0.1
- Status: candidate semantics for falsification
- Syntax: intentionally unspecified
- Runtime backend: intentionally unspecified

This document defines the meaning that candidate TypeScript surfaces must express. It is not a public
API proposal. A candidate may use objects, functions, operators, or another notation only if it
preserves these meanings and laws.

## Semantic Domains

Let:

- `D` be a read-only snapshot of application resource data;
- `I` be component input;
- `C` be extended component context;
- `Q` be a discrete statechart configuration;
- `E` be a discrete semantic event;
- `K` be application commands or abortable tasks;
- `V` be pure derived component values;
- `H` be a semantic platform hierarchy;
- `X` be platform and accessibility environment;
- `N` be interaction state associated with semantic parts;
- `G` be continuous gesture signals;
- `Y` be resolved local geometry;
- `T` be a target visual scene;
- `P(t)` be the scene currently presented at time `t`;
- `U` be a transition transaction describing how target changes are realized;
- `O` be observable platform operations.

The proposed decomposition is:

```text
reduce : (Q, C, E) -> (Q', C', K*)

derive : (D, I, Q, C) -> V

structure : (I, Q, C, V, semantic bindings, component slots) -> H

present : (parts(H), Q, I, C, V, N, G, Y, X, tokens) -> T

transition : (P(t0), T, U, continuous input, t) -> P(t)

lowerWeb : (H, P(t)) -> O
```

`reduce`, `derive`, `structure`, and `present` describe meaning. `transition` describes temporal
realization. `lowerWeb` interprets meaning for one platform.

## Data And Behavior

### Discrete state

`Q` represents semantic modes and hierarchical configurations. It changes only through discrete
events. It may coordinate parallel modes, delayed events, tasks, completion, and cancellation.

Examples:

- drawer closed versus open;
- command menu filtering versus executing;
- form editing versus submitting;
- detail view default versus recovery phrase.

Pointer coordinates, spring positions, layout rectangles, hover progress, and animation frames are
not members of `Q`.

State references use one vocabulary: absolute paths declared by the application generic. A compound
state names exactly one direct-child initial. A parallel state has no initial of its own because every
child region enters; a multi-target transition is valid only across orthogonal regions. Declaration
order has no meaning. Final states cannot own events, tasks, delays, or child states.

A transition has ordered alternatives. Each alternative owns its optional pure guard and its targets;
the first enabled alternative wins, and an unguarded alternative is an explicit fallback. Missing
guard results are false. Guard and target data are never stored in parallel arrays.

Completion is recursive. A compound state completes when its active child configuration completes; a
parallel state completes only when every region completes. The deepest enabled completion transition
runs first and the configuration stabilizes before it is observed. Only final states produce typed
output, and each entered final output is emitted once. Completion cycles are rejected by a finite
stabilization bound.

### Extended context

`C` stores behavior-relevant values not economically represented as finite mode names. A transition
may produce a new immutable context value. Context is not an unrestricted mutable object.

### Commands and tasks

`K` contains observable application work requested by a transition. A command has typed input and
result semantics. A task is associated with state lifetime and receives cancellation.

The surviving candidate has no unrestricted `perform` or public `effect`. A transition may request a
named typed command. The next state and context commit first; the runtime then interprets each command
exactly once in declared order. A later state transition does not cancel an already committed command.
A task starts on state entry, is cancelled on state exit or disposal, and returns a typed done or error
event only for its current revision. Guards, context updates, and derivations cannot execute either.

Timers remain delayed statechart events. Navigation, analytics, and local-first mutations use commands
when their result does not coordinate state; work whose completion, error, or cancellation matters is a
task. Focus that follows semantic state is declared in structure rather than performed imperatively.
This distinction remains under corpus and independent-author falsification.

A delayed transition belongs to the state lifetime in which it was scheduled. Exiting that state
cancels it; reaching the exact deadline is sufficient to fire it. Correctness is defined against a
monotonic virtual clock, while adapters map that clock onto platform scheduling. Declaration order is
only a deterministic tie-break after deadline, owner path, and alternative index.

An always transition uses the same ordered guarded alternatives after entry and before the
configuration becomes observable. The deepest active owner stabilizes first. Repeated configurations
are a cycle error rather than an unbounded microtask loop.

Every state-owned task invocation has a monotonically increasing revision. Done and error outcomes
are accepted once only while that exact revision and owner remain active; accepted outcomes use the
same transition algebra. State exit cancels ownership, and stale outcomes cannot mutate the current
configuration.

### Derived values

`V` is a pure function of declared data and behavior state. It exists to expose useful meaning without
giving presentation access to commands or mutable resources.

Law: evaluating `derive` twice with equal inputs yields structurally equal values.

## Semantic Hierarchy

`H` is an ordered forest of platform semantic nodes. Each node has:

- stable semantic identity;
- native platform kind or explicitly modeled semantic role;
- typed semantic properties;
- accessibility relationships;
- event and action bindings;
- ordered semantic children;
- optional typed slots and component boundary;
- presence state.

The hierarchy determines reading order, focus relationships, inherited context, semantic grouping,
forms, labels, and platform-layer ownership. Visual layout is not inferred as semantic meaning.

When one reactive structural selection replaces another case, current focus is preserved if its
identity remains focusable. Otherwise the choice must provide a compiler-issued focus destination in
the incoming branch. Focus recovery is revisioned with the structure transaction, so a stale overlay
return or asynchronous callback cannot overwrite the newer branch decision.

### Named parts

A component defines a finite mapping from part name to one or more nodes in `H`. A part name is a
presentation address with component-local scope. It is not a selector.

Open questions:

- whether every visually distinct node needs a part;
- whether visual-only generated layers are part-like values outside `H`.

A part may address multiple nodes only through a declared keyed collection. The collection contract
names one scalar domain key, item part, and semantic role. Reorder preserves identity because an item
address is `(component instance, part, domain key)`, never its position. Structure derives reactive
relationships such as active descendant from that same key.

### Components and slots

A component instance is an opaque semantic child with private context, state, actions, parts, and
visual channels. Its declared semantic roots participate at the parent's placement without exposing
that private surface.

A slot is a typed ownership boundary, not a general property bag. It declares accepted component
contracts and one, optional, or many cardinality. Callers provide opaque component instances; the
owner chooses their semantic placement. Ordinary data and text remain input. A forged instance or a
slot value with the wrong component contract has no meaning and must fail.

### Identity

Identity is semantic, not positional. Reorder, filtering, layout change, or preset replacement does
not change identity when the domain entity remains the same.

For identity `a`:

```text
sameIdentity(before(a), after(a))
  -> preserve component context, focus eligibility, presence owner, and compatible visual channels
```

### Presence

Presence is a state machine for semantic identity:

```text
absent -> entering -> present -> exiting -> absent
                     ^           |
                     +-----------+
                       reversal
```

An exiting identity may remain mounted for visual settlement while becoming inaccessible or inert as
required by platform semantics. Presence completion may notify behavior, but visual callbacks cannot
mutate semantic state directly.

Structure has one finite-selection operation:

```text
select<Value extends string | boolean>(reactive Value, exhaustive cases keyed by Value)
```

Every case is declared once with stable identities. Exactly one case contributes to the current
semantic tree, and an unknown runtime value fails instead of choosing a fallback. Optional structure
uses an explicit boolean case whose content may be `null`; there is no implicit alternate. Switching
releases every inactive case's semantic participation atomically. Any same-node visual exit or
reversal is presentation presence, not a second structural condition. Value-level expression
`choose` remains scalar interpolation syntax and is not a hierarchy operation.

## Interaction Semantics

`N` contains read-only, part-local platform interaction facts. The base facts are pointer hover and
focus-within. A focusable semantic control additionally exposes focus-visible and pressed. They are
keyed by compiler-issued part identity; there is no component-wide hover or pressed value.

Disabled, selected, checked, expanded, invalid, and read-only are semantic state or structure values,
not interaction facts. Active gesture state remains on its named gesture channel. This prevents one
ambiguous bag from mixing behavior, platform input, and continuous recognition.

The adapter updates interaction facts through fine-grained dependencies without rebuilding semantic
hierarchy or rerunning component structure. Presentation may map them to appearance but cannot turn
them into actions. Any content or action available from hover must have an equivalent focus, native
activation, or explicitly declared semantic path.

Hover intent is policy rather than a raw fact: dwell, travel tolerance, pointer trajectory, floating
content geometry, cancellation, and focus equivalence affect its meaning. Long press is likewise a
time-and-movement recognizer with semantic commitment and an accessible alternative. Neither exists
implicitly on every part, and neither sends raw pointer samples or timer ticks into `Q`. Their final
declaration surface remains under falsification.

### Adjustable values

An adjustable semantic control owns one finite range with `minimum < maximum`, a positive `step`, and
a `largeStep` no smaller than `step`. Pointer, keyboard, and programmatic input submit proposals to the
same resolver. The resolver clamps to the range, quantizes relative to `minimum`, and emits at most one
semantic change. Direct manipulation may present a continuous intermediate value, but commitment uses
the same legal resolver. Minimum and maximum commands reach their exact endpoints even when those
endpoints are not members of the interior step lattice.

The semantic hierarchy exposes current value and all four range facts to the platform adapter. A
preset can map current or gesture values to visual targets; it cannot redefine legal values, stepping,
keyboard meaning, or the action that commits a value.

## Presentation Scope

Presentation is a pure function. It may read:

- exact component state predicates;
- input and extended context values declared safe for presentation;
- pure derived values;
- part-local interaction state;
- gesture channels;
- local resolved geometry;
- platform environment and accessibility preferences;
- typed preset tokens and theme mode.

Presentation may not:

- send actions;
- execute commands or tasks;
- mutate data or context;
- query arbitrary nodes or selectors;
- read wall-clock time or random values;
- create backend animation, layout, or gesture objects;
- alter semantic roles, labels, keyboard bindings, or modality.

Active modal structure names its native modal identity, one focusable descendant for entry, and one
focusable controlling element for return. These are one semantic contract. A web adapter must release
the native top layer and restore return focus before visual-only retained exit; delayed native close
events cannot clear or redirect the declared focus target.

## Target Visual Scene

`T` is a mapping from presentation identities to target values and relationships.

```text
T = {
  targets,
  layout relationships,
  composition relationships,
  generated visual layers,
  transition policies,
  presentation gesture mappings
}
```

The target scene contains no current animation frame and no imperative callback.

### One target owner

For every presentation identity `p` and target property `k`, there is at most one resolved target:

```text
target(T, p, k) -> zero or one value
```

Recipes and conditional fragments may contribute candidates, but precedence must resolve them before
the target scene exists. Motion policy cannot provide another target for the same property.

### Target categories

The semantic model currently distinguishes these categories for testing:

- layout relationships and constraints;
- post-layout spatial presentation;
- appearance and material;
- typography;
- affordance appearance;
- composition;
- generated visual layers.

These categories are not fixed public namespaces. Candidate corpus translation may combine or split
them if every target still has one meaning and one owner.

## Conditions And Expressions

An expression is a pure, typed dependency graph over presentation scope.

```text
expression : scope -> typed value
```

Required operations include:

- equality and ordered comparison where the domain supports them;
- boolean conjunction, disjunction, and negation;
- conditional choice;
- typed arithmetic and bounded mapping;
- interpolation over defined domains;
- token and geometry references.

The proposed core is closed over `literal`, `read`, typed equality and ordered comparison, short-circuit
`and`/`or`/`not`, `choose`, dimension-preserving `add`, scalar `scale`, typed `clamp`, and
interpolation with explicit clamping. Subtraction is `add(value, scale(other, -1))`; constant division
is scalar multiplication. Dynamic division, implicit unit conversion, and implicit extrapolation are
not in the language because zero handling, conversion context, and bounds would be hidden. A
discontinuous mapping is expressed visibly with `compare` plus `choose`, not a second step primitive.

The IR uses one canonical unit per physical dimension. Adapters convert canonical length, angle, and
time values to platform representation at the boundary.

Expression evaluation records exact dependencies. Equivalent expressions must produce equivalent
values independent of object key order.

Open question: how part-local interaction context is named visibly in the final public syntax.

## Tokens And Themes

A token is modeled as:

```text
Token = {
  identity,
  value type,
  semantic applicability,
  value or typed alias,
  organizational path,
  optional description
}
```

Token type is independent from organizational grouping. A token alias must resolve to the same value
type. A theme or mode supplies alternate values for existing token identities; it cannot silently
change their type or applicability.

Resolution laws:

- deterministic resolution;
- alias type preservation;
- cycle rejection with the complete cycle path;
- missing-value failure;
- preset-local visibility unless explicitly shared by contract;
- mode override does not change token identity.

## Layout

Layout semantics describe parent-child negotiation and relationships, not a browser property list.

The minimum questions a layout relation must answer are:

- what constraints does the parent offer each child;
- what intrinsic or preferred measure can the child report;
- how does the parent choose its own measure;
- how are children placed within the resolved parent geometry;
- which children participate in flow, overlay, grid, scrolling, or virtualized extent;
- which relationships are logical-direction aware;
- which geometry is observable by presentation conditions.

The web dialect may lower these meanings to CSS flow, flex, grid, intrinsic sizing, position, and
containment. A future platform may use another layout engine without changing web hierarchy.

Open question: whether flow, grid, and overlay are irreducible author algorithms or should be derived
from a smaller constraint algebra.

## Composition

Composition describes visual and hit-testing relationships after semantic hierarchy and layout.

Observable concepts to model or diagnose:

- paint order among overlapping presentation identities;
- isolation boundaries;
- clipping and masking ancestry;
- blend and backdrop sampling boundary;
- transformed surface boundary;
- hit-testing participation and order;
- native top-layer relationship supplied by `H`;
- visual overlays generated by presentation.

The adapter may implement these using stacking contexts, layers, containment, portals, or native top
layers. Authors should not need to predict an accidental stacking context from an unrelated transform.

Composition law: if two overlapping identities have an observable order, that order is derivable from
semantic hierarchy plus explicit presentation relationships. An adapter-created optimization cannot
reverse it.

## Temporal Semantics

### Target change

A target change exists when the same presentation identity and property resolve to unequal values in
successive target scenes.

```text
change = (identity, property, previousTarget, nextTarget, cause)
```

### Presented value

The presented value is runtime state derived from target history, transaction policy, continuous
input, and time. It is not application state and is not re-authored by the preset.

### Transition policy

A policy defines the trajectory from the currently presented value to the next target:

- instant;
- timing curve;
- physical spring;
- layout projection;
- reduced-motion substitute.

A policy has defined interruption, cancellation, completion, and reduced-motion behavior.

A physical spring is defined by target-independent physical parameters and the channel's current
value and velocity. Underdamped, critically damped, and overdamped policies are all lawful. A backend
may use an analytic solution, stable numerical integration, or a native engine only when its
observable samples, interruption, and settlement satisfy the same channel contract.

### Transaction

A transaction groups target and policy changes caused by one semantic, preset, theme, environment,
geometry, or reduced-motion update. Authors attach transition policy to typed targets; they do not
name or imperatively start transactions. The compiler/runtime derives one transaction from the scene
diff, samples all currently presented channels at one epoch, validates the complete plan, then commits
it with one revision. A policy-only change retargets an active channel; enabling reduced motion settles
it immediately; disabling reduced motion never resurrects settled motion.

### Retargeting

For a compatible channel with presented value `p` and velocity `v`:

```text
retarget(p, v, nextTarget, spring) starts from (p, v)
```

It must not restart from the previous target or zero velocity.

### Derived coordinated values

Several targets may derive from one authoritative continuous source. Example: sheet position drives
backdrop opacity and page scale. Derived targets do not each start an independent spring unless the
author explicitly gives them independent temporal meaning.

### Layout transition

Layout transition compares resolved geometry for the same identities before and after a semantic
change. The adapter may use projection, but the observable contract is continuity from old presented
geometry to new resolved geometry without changing semantic order or target layout.

An interrupted layout transition samples the currently presented logical rect and its position and
log-size velocities. A compatible spring retargets those retained channels; timing replaces their
velocity; reduced motion settles directly at the target rect. Size is represented in logarithmic space
while moving so it remains positive. Projection is derived from the presented rect into target layout,
and one geometry channel owns it so anchoring cannot apply a second translation.

### Staged behavior and visual choreography

Presentation has no sequence or timeline primitive. When stage order changes application meaning,
statechart states, tasks, and events own those stages. When order is merely visual choreography,
several targets derive from one authoritative progress value with typed ranges. This prevents a second
behavior language inside presets and gives cancellation one owner.

## Gesture Semantics

Gesture handling is decomposed into four layers for testing.

### Intent and outcomes

Application behavior declares the semantic intent and legal outcomes. Example: dismiss may commit or
cancel while the drawer is open.

### Recognition and arbitration

Structure declares recognizer intent, activation conditions, legal outcomes, and explicit
relationships to competing recognizers. Relationships must be able to state exclusivity,
simultaneous recognition, and failure dependency. Standard semantic controls retain their native
activation and keyboard alternatives.

Recognizer kinds with an intrinsic lifecycle use fixed signals: hover intent emits engaged and
disengaged; long press emits recognized, released, and cancelled. Structure binds every signal to an
application action. Continuous recognizers may retain a component-defined finite destination set.

The platform adapter lowers that graph to pointer, touch, keyboard, and competing scroll input. On the
web it may use `touch-action`, pointer capture, coalesced input, predicted input, native scrolling, or
an engine recognizer. Those mechanisms are not author semantics. Recognition produces a continuous
gesture channel and discrete begin, commit, cancel, and end events.

There is no universal priority number that correctly resolves every nested gesture. An unresolved
recognizer conflict is a compiler diagnostic, not insertion-order behavior.

### Presentation mapping

The preset maps gesture values to visual targets using current geometry and tokens. It may define
resistance, snap presentation, and release feel without dispatching actions.

### Commit resolution

Commit combines semantic policy with normalized geometry and measured input. The ownership boundary is
not yet selected.

Candidate alternatives:

1. behavior owns normalized distance and velocity policy; preset supplies geometry normalization;
2. preset owns the resolver but can only choose among behavior-declared outcomes;
3. a component gesture contract declares policy parameters that themes may tune within bounds.

The corpus must determine which alternative preserves both preset flexibility and behavioral
consistency.

### Direct-to-settle handoff

During active direct manipulation, the gesture channel owns the presented spatial value. At release,
ownership transfers exactly once to target settlement with current value and resolved velocity.

Capture is released on commit, cancellation, disposal, loss of platform capture, or component
absence. A stale input or engine callback after release cannot reacquire the channel.

## Environment And Adaptation

Environment values are typed, read-only facts supplied by the platform or nearest container. They do
not become separate APIs based on how the adapter compiles them.

Examples:

- local inline and block constraints;
- reduced motion;
- contrast and forced colors;
- pointer and hover capability;
- color scheme;
- locale and writing direction;
- font scale and zoom;
- safe area and virtual keyboard geometry.

Condition semantics are identical whether an adapter uses static CSS, container queries, media rules,
signals, or runtime measurement.

## Core Laws

### Determinism

Equal declared input produces equal `V`, `H`, and `T`.

### Purity

`derive`, `structure`, and `present` perform no externally observable work while being evaluated.
Semantic bindings created by structure are values that request actions later; they do not execute
during construction.

### Single source of truth

Application data and semantic state have one owner. Each visual target and retained channel has one
owner. No adapter cache becomes an alternate semantic source.

### Compositionality

The meaning of a component composition follows from child contracts, slots, and explicit
relationships. Local presentation cannot alter unrelated component meaning.

### Locality

A dependency change reevaluates only expressions that depend on it. A visual change does not recreate
semantic hierarchy.

### Identity preservation

Stable semantic identity preserves compatible runtime ownership through reorder, transition, theme,
preset, and hot refresh.

Hot refresh compares a canonical component contract containing behavior topology, semantic
identity/role/action bindings, and recognizer contracts. Presentation values, transition tuning, and
layout arrangement are replaceable without semantic remount. A compatible refresh preserves context,
state, surviving presence, and presented samples for targets that exist on both sides. Old motion,
task, and gesture controller objects are always disposed exactly once so stale closures cannot survive;
the new runtime may retarget or restart from the retained snapshot. An incompatible contract replaces
the component and retains none of those live semantic values.

### Lifecycle exactness

Begin, commit, cancel, completion, and disposal occur at most once per revision. Cancellation cannot
later complete.

### Motion continuity

Compatible retargeting starts from current presented value and velocity. Direct manipulation hands
off without a discontinuity.

### Endpoint equivalence

Timing, spring, instant, and reduced-motion paths reach the same semantic and target visual endpoint
unless the preset explicitly specifies a lawful alternative target for accessibility.

### Accessibility preservation

Presentation cannot remove, contradict, or counterfeit semantic accessibility. Generated visual
layers are absent from the accessibility tree. Native modality remains owned by `H`.

### Adapter equivalence

Two adapter strategies claiming support for the same semantics produce equivalent endpoints,
lifecycle events, semantic hierarchy, accessibility behavior, paint order, and hit-testing outcomes.

## Counterexamples The Model Must Survive

- A full-page scale creates an accidental stacking context over earlier fixed chrome.
- A preset change occurs while a physical spring has nonzero velocity.
- A mobile drag crosses into desktop geometry before release.
- An exiting modal becomes nonmodal while its visual surface remains retained.
- A virtualized keyed item leaves the mounted window during layout animation.
- A font loads while measured-height content is transitioning.
- A nested popover closes while its parent modal reverses exit.
- A reorder or range-selection recognizer reaches a declared scroll-container edge while active.
- Two visual targets derive from one gesture channel and one state target.
- A reduced-motion preference changes during an active transition.
- A hot refresh changes presentation but preserves a compatible component contract.

## Reference Interpreter Requirements

The backend-independent interpreter must implement enough of this model to test:

- deterministic expression and token resolution;
- semantic identity and presence lifecycle;
- target-scene resolution with one-owner diagnostics;
- transaction creation and policy selection;
- retained scalar direct, target, retarget, cancel, and dispose behavior;
- derived target mapping;
- gesture commit alternatives;
- bounded edge auto-scroll with exact gesture rebasing;
- revisioned intrinsic measurement transactions that cannot replay semantic presence;
- child-first nested-overlay close cascades with whole-chain reversal;
- one adjustable range resolver shared by every input modality;
- contract-aware hot refresh with retained snapshots and exact controller disposal;
- explicit composition ordering;
- adapter capability diagnostics.

It must not import DOM, StyleX, Anime.js, browser timers, or XState. Production adapters may be tested
differentially against it.

## Open Semantic Questions

- Exact ownership of gesture commit policy.
- Whether transactions are explicit public values.
- Minimal layout algebra.
- Minimal composition algebra.
- Part-local interaction and geometry addressing.
- General generated visual layers versus fixed decoration roles.
- Typography as one domain or several target kinds.
- Statechart `perform` versus task and command effects.
- Cross-component shared visual identity.
- Capability and extension policy for future platform features without an author escape hatch.
