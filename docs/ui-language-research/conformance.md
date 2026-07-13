# UI Language Conformance Evidence

## Status

- Semantic model: version 0.1
- Reference implementation: initial
- Candidate-language conformance: initial target and relationship equivalence
- Production-adapter differential tests: pure lowering and thin no-VDOM mount slice passes
- Browser acceptance: current-runtime baseline and candidate native-structure slice complete

## Reference Implementation

Files:

- `packages/kit/tests/ui-language-reference.ts`
- `packages/kit/tests/ui-language-reference.spec.ts`
- `packages/kit/tests/ui-language-candidates.ts`
- `packages/kit/tests/ui-language-candidates.spec.ts`
- `packages/kit/tests/ui-language-candidates.typecheck.ts`
- `packages/kit/tests/ui-language-mutation-runner.ts`

The reference implementation is test-only and is not exported by `@poggers/kit`. It imports no DOM,
StyleX, Anime.js, XState, browser timer, or production visual-runtime code.

## Current Coverage

### Typed tokens

- deterministic output independent of definition key order;
- typed alias resolution;
- unknown alias rejection;
- complete alias-cycle path;
- type-changing alias rejection.

### Target ownership

- deterministic target keys;
- at most one source for one identity and property;
- diagnostic identifies both competing sources.

### Composition

- explicit below/above relationships;
- stable document-order fallback when no relationship constrains peers;
- unknown identity rejection;
- composition-cycle rejection.

### Presence

- absent to entering to present;
- present to exiting to absent;
- exiting to entering reversal on one identity.

### Retained scalar motion

- direct value and velocity;
- target revision with current value and velocity as initial conditions;
- current-value sampling;
- mid-flight replacement;
- stale settlement rejection;
- exact cancel and dispose outcomes;
- no writes after disposal;
- finite value validation.

### Gesture resolution

- distance and velocity commit paths;
- cancellation always prevents commit;
- opposing direction cannot commit;
- one legal destination for arbitrary finite progress and velocity;
- 2,000 generated trajectories in the initial property test.

### Interaction intent

- raw hover, focus-within, pressed, and focus-visible are part-local typed reads;
- semantic selected/disabled/expanded state is absent from the raw interaction domain;
- hover intent requires dwell and bounded speed, retains delayed leave, and has immediate focus
  equivalence;
- long press exposes virtual-time progress, cancels beyond movement tolerance, recognizes once, and
  commits or fails on release.
- candidate hover/long-press adapters match the independent reference timing and cancellation laws,
  preserve focus equivalence and declared corridor handoff, and emit fixed semantic signals;

### Geometry and shared identity

- only the latest complete measurement revision commits;
- stale geometry cannot become observable;
- one source and one destination per shared identity;
- unmatched identities remain ordinary nodes;
- ambiguous shared sources or destinations are rejected.

### Transition association

- a transaction contains each changed target once;
- policy may reference only a changed target;
- one transition policy per target;
- deterministic target and policy order.

### Expressions and dimensions

- one expression evaluator for conditions and target values;
- exact dependencies from the active branch;
- short-circuit condition evaluation;
- typed equality, addition, scaling, and interpolation;
- dimension mismatch rejection;
- explicit interpolation clamping or extrapolation.

### Modes, identity, physics, and relationships

- token modes preserve token identity, type, aliases, and complete fallback values;
- unknown mode overrides fail;
- keyed insertion, removal, and reorder preserve retained identity;
- duplicate keys fail before reconciliation;
- physical springs cover underdamped, critically damped, and overdamped trajectories;
- spring sampling starts from the exact declared value and velocity and converges on the target;
- several visual channels derive from one authoritative retained source;
- duplicate derived targets fail;
- geometry projection preserves target layout while describing old-to-new presentation;
- competing gesture recognizers require explicit precedence or simultaneity.

### Discrete behavior and task lifetime

- transitions use declared events and reject unknown target states;
- state entry creates revisioned state-scoped tasks;
- leaving state cancels active tasks exactly once;
- stale task completion cannot affect a later state revision;
- disposal terminates active tasks and rejects later events.

### Generated model laws

- 1,000 arbitrary physical springs sampled at two forward times never gain mechanical energy;
- 1,000 arbitrary unique collection pairs preserve every retained, entered, exited, and moved key;
- 1,000 arbitrary event traces keep state membership and state-scoped task ownership lawful;
- 2,000 arbitrary drag trajectories resolve to exactly one legal outcome.

## Initial Evidence

Command:

```sh
cd packages/kit
bun test tests/ui-language-reference.spec.ts
```

Result on 2026-07-12:

```text
10 pass
0 fail
4996 expect() calls
```

This result proves only the reference cases above. It does not prove the production runtime, a
candidate TypeScript syntax, visual fidelity, accessibility, layout, or browser behavior.

## Initial Candidate Equivalence

Three test-only candidate shapes use the same explicit generic application contract:

- categorized target records;
- semantic target operations;
- typed target equations.

All three normalize the C01 scalar target sample to the same reference scene. The fragment and
operation candidates reject duplicate target ownership with both source locations. Type fixtures
reject unknown preset, component, part, and target-property names from the generic contract.

The surviving semantic-operation candidate additionally materializes typed `set` and `transition`
contributions. Normalization rejects duplicate typed target handles and transition policy for a target
absent from the scene. Type fixtures reject state names outside the generic contract, target/value
dimension mismatches, policy/target mismatches, and presentation access to application actions.
Reactive state and environment facts are expression values rather than JavaScript booleans. Their one
`choose` algebra preserves branch value types and records only dependencies read by the active branch.
The candidate now also materializes structural equality, short-circuit boolean combination,
dimension-safe length addition and scaling, and explicitly clamped length interpolation. Type fixtures
reject scalar/length and boolean/nonboolean mixing.
The explicit app generic also scopes token identities and theme names per preset; the preset is a
function receiving those references and does not repeat its registry key in its output.
The same generic now derives read-only input, context, values, interaction, per-part geometry,
environment, gesture, and bounded-parameter scope. Type fixtures retain each field's exact value type
while exposing no actions, resources, effects, navigation mutation, DOM, clock, or backend engine.

Typed gesture handles now materialize direct and settle phases. Type fixtures require target/gesture
value agreement and complete destinations for the behavior-declared outcome union. Normalization
rejects duplicate direct owners, settlement without a direct owner, and different gestures driving and
settling one target.

Structure-declared presentation parameters now let presets tune typed physical coefficients without
owning legal outcomes or statechart commitment. Missing values use the structure default; duplicate,
unknown, nonfinite, and out-of-bounds values fail normalization. The app generic controls each
parameter value type.

Candidate retained presence now binds one identity to a finite set of its own transitioned targets.
Normalization rejects duplicate lifecycle owners, cross-identity targets, repeated targets, and
targets without transition policy. The reference lifecycle still owns same-identity reversal and
exactly-once disposal.

The candidate visual-value algebra now materializes typed OKLCH paint and gradients, logical shape and
path geometry, strokes, shadows, backdrop material, typography, media fitting, and stable spatial
transform composition. Compiler-issued handles carry value kinds; literal normalization rejects
malformed composites, unordered gradients, and out-of-domain values before lowering.
An explicit applicability/interpolation matrix classifies each value pair. Independent reference and
candidate evaluators agree for solid/gradient paint, rectangle/path shape, strokes, ordered shadow
stacks, material, type style, media fit, and transform. Compatible paths require equal coordinate and
fill semantics plus the same ordered command kinds. Type fixtures reject unitless gradient angles.
Incompatible paint/shape kinds, stroke/material absence, topology changes, text-semantic changes, and
media-mode changes are discrete: they require explicit presentation identities and presence rather
than a hidden adapter blend.
Composition now distinguishes binary clipping from alpha/luminance masking. Mask normalization
requires one known source per owner, rejects self-masks and dependency cycles, and exposes the
relationship directly to adapters.

Typed layout relations now materialize arrangement algorithms, scrolling, intrinsic measurement,
virtual extent, grid placement, sticky attachment, aspect constraints, and resolved parent ownership.
Normalization rejects multiple algorithms for one parent, multiple parents for one child, hierarchy
cycles, unknown identities, duplicate intrinsic axes, invalid dimensions, out-of-track placement, and
ambiguous collection or viewport ownership. Orthogonal virtualization is legal only when a compatible
two-axis scroll relation exists. Keyed measurement revisions ignore stale results and retain measured
extents through reorder. Stable-identity parent swaps pass an independent projection differential.
Type fixtures prevent CSS strings and unitless numbers from entering semantic length positions.

The structure reference validates one connected semantic hierarchy, unique parent and identity
ownership, role-specific accessible states, one accessible-name owner, one active modal owner, and
focus availability within that modal. The generic-driven candidate author surface issues opaque,
role-typed semantic instances, binds exact actions directly, accepts reactive semantic values, and
normalizes through that independent reference validator. Type fixtures reject undeclared actions,
presentation access, and incompatible active-descendant references. Keyed collection fixtures derive
item identity and active-descendant references from one scalar domain key across generated reorder
traces. Typed slots preserve cardinality and accepted component contracts; opaque child instances
contribute semantic roots without exposing private parts. Reactive structural selection has one
generic-driven exhaustive operation; tests prove that exactly one stable case enters the semantic
tree, all dormant cases are known for focus recovery, and returning during an active exit preserves
native identity. Mapping those facts to actual HTML and accessibility APIs remains a web-adapter and
browser gate.

The integrated component fixture derives state, action, command, task, resource, navigation, value,
and structure types from one explicit application generic. Pure derivation can read local-first views
and route data but cannot mutate or navigate. Named command and task implementations receive mutation
ports; only tasks receive cancellation. Structure receives neither. The reference statechart commits
state before queueing commands, preserves command order across later transitions, drains exactly once,
and keeps task cancellation revision-scoped.

Hierarchical statechart topology now normalizes independently from XState. All state references are
absolute generic-declared paths. Compound states require one direct-child initial; parallel states
enter every region and cannot declare an initial; final states cannot own active behavior; simultaneous
targets must be orthogonal. Root and nested events, tasks, and delays survive candidate normalization.
Generated event traces preserve unaffected parallel regions and normalized output is independent of
declaration insertion order. Guard evaluation, final output propagation, and clock-driven delay traces
remain open.

Transition handoff now classifies compatible physical retargeting, direct-to-spring release,
nonphysical policy replacement, layout projection, instant settlement, and reduced-motion
substitution. Compatible spring replacement preserves current velocity; reduced motion reaches the
identical endpoint with no residual trajectory; policy value types cannot change at runtime.
Candidate policy IR now carries backend-independent instant, timing, physical spring, or layout
drivers and a separate reduced-motion driver rather than an opaque engine name. Invalid durations,
Bezier x coordinates, and nonphysical spring values fail materialization.

Combined result on 2026-07-12:

```text
140 pass
0 fail
more than 20000 expect() calls (generated traces change branch-specific assertion counts)
TypeScript: pass
OxLint: pass
```

This establishes reference and normalization evidence for scalar targets, transition association,
composition, clipping, hit testing, shared identity pairing, direct gesture ownership, settlement,
flow/overlay arrangement, intrinsic measurement, and virtual extent. Grid has validation evidence but
not adapter differential evidence. Physical trajectories remain reference and fake-adapter tested;
retained presence is now materialized by the candidate normalizer.

## Current Runtime Browser Baseline

Direct in-app-browser testing at desktop and compact viewports verifies current native dialog
semantics, focus return, immediate hit-test release during retained exit, partial-drag return, repeated
drag activation, drag dismissal, two distinct presets, and state-preserving hot refresh. Browser logs
contained no warnings or errors. Full observations and limits are in `browser-baseline.md`.

The run exposed and then reverified fixes for a synthetic 15-pixel scroll-lock gutter and transformed
page/fixed-chrome composition artifact. The runtime now performs measured compensation without
injecting a gutter, the preset switch belongs to the page hierarchy, and Escape has an explicit
composition-safe dismiss binding. Direct checks verify full-width modal geometry, complete chrome,
immediate hit-test release, focus return, and exact scroll-lock restoration.

## Initial Adapter Differential

The surviving candidate's typed target and relationship IR is interpreted by two test adapters: a
direct reference strategy and a retained-channel strategy. Both produce identical observable target
endpoints, layout relations, composition, clips, hit-test participation, and shared identity. Retained
lowering begins from current presented value and velocity. Capability validation rejects unsupported
semantic meaning before execution.

The retained differential now consumes normalized policy definitions: direct-to-spring preserves
velocity, timing replacement resets unsupported physical velocity, and reduced motion settles at the
same endpoint without a residual trajectory.

It now also diffs target and policy scenes before touching retained channels. Repeated equal scenes do
not restart motion; an active policy-only theme change retargets from current value and velocity;
reduced motion settles an active channel; disabling reduced motion does not resurrect settled motion.

An independent layout-transition formula also agrees with the retained-geometry reference across
1,000 generated positive-size traces covering interruption, resize, parent swap, instant/timing/spring
drivers, and reduced motion.

The candidate now also lowers native kind, ordered text/node content, accessibility facts, controlled
values, relationships, and compiler-issued actions into backend-independent web instructions. A thin
platform port mounts those instructions without a virtual tree, updates compatible semantic
attributes and properties without replacing node identity, rejects changed native contracts, and
disposes listeners and roots exactly once. Typed visual targets select stylesheet, fine-grained
reactive-property, or retained-motion execution without parsing target names or serialized values.

The generic port passes deterministic fake-host tests, and the native-structure slice passes direct
real-DOM acceptance. Production layout algorithms, accessibility-tree inspection, gesture capture,
presence/motion execution, StyleX/Anime.js integration, and complete backend capability diagnostics
remain required.

## Candidate Native-Structure Browser Slice

`docs/ui-language-research/browser-fixture.ts` bundles the actual candidate compiler and thin adapter
into a browser fixture at `http://127.0.0.1:3041/`. Direct in-app-browser testing verified authored
text order, native button/textbox/range/link/dialog elements, controlled range initialization,
compiler-issued input and link dispatch, dialog modality, reactive ARIA/hidden updates, focus entry,
focus return, and stable native behavior after repeated open/close.

Modal focus is no longer a fixture callback. The normalized active-modal record requires modal,
initial-focus, and return-focus identities. The web reconciliation port activates and releases native
modality through that contract, retains an unresolved return obligation through visual exit, and
cancels it on reopen. Fast tests reject outside initial focus and unrelated return controls. A trusted
pointer drag leaves the trigger focused after native close and after final hide; an interrupted exit
finishes open with the close control focused.

The first run exposed a real lowering defect: applying `value` before `min`, `max`, and `step` let the
browser sanitize the range to its default domain, producing `0` instead of `0.4`. The adapter now
orders range constraints before value; the browser showed `0.4` initially and accepted a native update
to `0.7`. The fast adapter test fixes that order as an executable invariant.

The same fixture now exercises production retained scalar, pointer, generated-layer presence, and
layout engines. A local `560px -> 300px` layout change lowers from semantic flow relations, captures the
region and children under one stable coordinate root, reverses continuously, and clears projection
styles at settlement. Compatible presentation replacement during active projection preserves the same
nodes and continuous geometry. This does not close full candidate browser acceptance: native Escape,
forced colors, accessibility-tree output, complete compact behavior, multitouch delivery, production
StyleX emission, and selected-candidate bundler hot-module replacement remain open. Current production
preset replacement is directly verified with an open dialog, retained view, and retained focus.

The fixture's shared security drawer now exercises three preset implementations over one mounted
native hierarchy. Monochrome lowers to a `420px` vertical stack, Editorial to a `760px` three-column
grid, and Tactile to a `400px` material stack; computed geometry, corners, typography, paint, shadows,
and arrangement differ while the dialog and three action identities remain singular. Reactive
focus/hover paint updates only the engaged option. A compact-environment run records retained sheet
entry from `447` to `0` and generated backdrop entry from `0` to `1` with physical overshoot. This run
found and fixed a production graph defect: same-frame direct-plus-target coalescing erased the entry
sample. Fresh target transactions now carry an explicit `from` value, covered by a deterministic
backend test and the direct browser trace.

## Production Baseline

The complete existing kit suite was run after adding the reference and candidate fixtures:

```text
567 pass
0 fail
56959 expect() calls
24 test files
```

This baseline covers existing local-first behavior, storage, migrations, server/client integration,
component statecharts, fine-grained UI updates, HMR state retention, current visual compilation,
StyleX generation, retained motion, layout adapters, virtualization, and gesture properties. It proves
that the research fixtures have not broken the existing working baseline. It does not prove that the
current visual language satisfies the new semantic model or that Candidate B has a production adapter.

## Missing Reference Coverage

- independent recipe normalization semantics;
- production path-morph and visual-compatibility lowering;
- production adapter lowering for long press and hover intent;
- same-axis native-scroll delivery and production DOM gesture lowering;
- production adapter capability diagnostics.

## Planned Mutation Set

The conformance suite must fail when each mutation is introduced:

- permit two owners for one target;
- resolve token aliases without checking type;
- ignore an alias cycle;
- use insertion order instead of deterministic order;
- accept a composition cycle;
- settle a stale motion revision;
- reset velocity during compatible retargeting;
- emit completion after cancellation;
- create a new identity on presence reversal;
- commit an opposing or cancelled gesture;
- let presentation dispatch an application action;
- let a backend optimization reverse composition order.

## Initial Mutation Evidence

Command:

```sh
cd packages/kit
bun tests/ui-language-mutation-runner.ts
```

The runner copies the backend-independent reference implementation to an isolated temporary
directory, applies one source mutation at a time, and executes a separate oracle suite. The baseline
must pass and every mutant must make the oracle fail.

Current result:

```text
Killed 343/343 UI semantic mutations.
```

Killed mutations:

- accept a token alias cycle;
- accept a type-changing token alias;
- make token resolution depend on insertion order;
- accept duplicate target ownership;
- accept a composition cycle;
- let a stale motion revision settle;
- reset compatible retarget velocity;
- leave motion active after cancellation;
- replace presence reversal with immediate presentation;
- permit commitment against gesture direction.
- accept an unknown clipping member;
- accept gesture settlement without a direct owner;
- let different gestures drive and settle one target.
- accept multiple layout algorithms for one parent;
- accept a cyclic layout hierarchy.
- accept virtual extent without compatible scroll ownership.
- subscribe to an inactive reactive branch.
- accept an unnamed semantic control;
- accept multiple active modal owners.
- accept an unknown hit-test identity;
- attach a structure-issued native layer capability to another identity.
- accept duplicate presentation identities in a composition graph.
- let presentation overwrite a layout-owned geometry target.
- lose velocity during compatible spring replacement;
- leave a trajectory active under reduced motion;
- allow transition policy replacement to change value type.
- replace structural value equality with object identity;
- ignore a false boolean-conjunction operand;
- ignore candidate interpolation clamping.
- accept mixed dimensions in candidate arithmetic.
- allow a preset parameter outside its structure-declared bounds.
- accept a nonphysical spring mass.
- let retained presence await another identity's target;
- let retained presence await a target without transition policy.
- accept unordered gradient stops;
- accept normalized visual values outside zero through one.
- silently morph incompatible vector-path topology.
- allow a presentation identity to mask itself.
- let an incompatible custom focus treatment suppress the forced-colors native fallback.
- take the long hue arc during default OKLCH interpolation;
- ignore premultiplied alpha during OKLCH interpolation.
- let candidate OKLCH interpolation diverge from the reference hue law.
- accept a zero transform rotation axis.
- take the long quaternion path during rotation interpolation;
- accept a zero axis in the reference rotation law.
- let candidate transform interpolation take the long quaternion path.
- accept duplicate targets in one transition batch;
- lose the shared transition revision;
- drop the candidate transaction target set.
- accept grid placement without a grid parent;
- accept grid placement beyond declared tracks;
- accept sticky attachment outside its scroll-content subtree.
- commit stale virtual measurements;
- discard retained keyed measurements on reorder;
- accept stale candidate virtual-measurement results.
- hide a layout parent swap;
- drop resolved candidate parent ownership.
- accept stale samples in an active gesture session;
- retain pointer capture after gesture termination;
- accept stale callbacks in candidate gesture lifecycle.
- expose raw gesture overshoot instead of rubber-band presentation;
- ignore release velocity during snap selection;
- choose the higher destination for an exact snap tie.
- ignore changed geometry while rebasing an active gesture;
- keep an unavailable recognizer active across a viewport-mode change;
- steal inward movement from a nested scroll at its boundary.
- reuse one gesture parameter for projection and resistance;
- let resistance escape its semantic domain;
- accept a missing gesture projection parameter.
- let stale presence settlement mutate the current revision;
- unmount presence after only one settled target;
- leave exiting presence interactive;
- accept stale settlement in candidate presence policy.
- let roving focus land on a disabled item;
- expose multiple roving tab stops;
- let active descendant escape its semantic owner;
- ignore active-descendant role compatibility;
- accept the wrong nested-overlay parent;
- let stale overlay close mutate the stack;
- accept an invalid form owner.
- accept an incompatible native role in candidate structure;
- discard candidate semantic child ownership;
- discard native focus defaults during candidate normalization;
- leave a reactive semantic value unevaluated.
- accept duplicate collection domain keys;
- substitute positional collection identity;
- ignore the reactive collection relationship key;
- drop a child component's semantic roots at its slot placement;
- silently ignore a forged component instance.
- ignore a reactive structural-selection value;
- accept an unknown structural-selection case;
- accept a partial structural focus contract;
- drop dormant-case ownership from focus recovery;
- leak dormant structural cases into one semantic revision.
- record pre-commit state on a command request;
- repeat a command after it has been drained;
- accept an empty command and partially transition.
- accept missing or non-child compound initials;
- accept an initial on a parallel state;
- allow a final state to own active behavior;
- accept unknown or non-orthogonal transition targets;
- discard candidate delayed targets, task names, or root topology;
- enter only one parallel region or discard an unaffected region;
- skip a leaf event handler;
- let statechart topology depend on declaration insertion order.
- ignore ordered transition guards;
- prevent root completion from settling;
- schedule a delayed transition without its state owner;
- miss a delayed transition at its exact deadline;
- discard candidate guard identity or final-output resolution.
- discard or fail to stabilize an always transition;
- accept stale task completion or retain a task after state exit;
- route a task failure through its done transition;
- discard candidate task-result lowering.
- ignore the right side of reference disjunction;
- weaken strict ordered comparison;
- ignore clamp upper bounds or accept reversed bounds;
- let candidate clamp diverge from reference semantics.
- drop semantic action bindings or accept unidentified callbacks;
- preserve author expression helpers in compiled IR;
- make canonical IR object ordering depend on insertion order.
- omit action or expression meaning from the derived capability manifest;
- let adapter validation ignore an unsupported semantic capability.
- drop transition update or ordered command resolver metadata;
- accept a hierarchical command absent from the explicit generic vocabulary.
- collapse distinct gesture recognizer kinds during normalization.
- accept an incomplete gesture outcome mapping;
- skip gesture arbitration graph validation;
- accept a missing accessible gesture alternative action.
- recognize a web gesture before its activation threshold;
- ignore responsive recognizer unavailability;
- reverse an explicit exclusive tie preference;
- skip a directional failure dependency;
- compute multipointer velocity from a stale contact clock;
- leak pointer capture after termination;
- treat predicted pointer samples as semantic confirmation.
- steal movement from a declared native scroll owner.
- ignore hover-intent dwell time;
- lose focus-equivalent hover engagement;
- ignore delayed hover leave;
- ignore long-press movement tolerance;
- recognize one long press repeatedly.
- let hover intent lose focus equivalence;
- accept an unknown hover handoff destination;
- accept a nonpositive long-press duration;
- drop a direct-manipulation target's typed recognizer projection.
- ignore clamping while normalizing a dimensional recognizer channel;
- accept a zero-extent normalization range.
- accept a generated contract that changes fixed recognizer signals;
- lose focus equivalence in candidate hover lowering;
- remove delayed leave or safe-polygon retention from candidate hover lowering;
- recognize long press early or ignore its movement tolerance in candidate lowering.
- accept implicit channel identity change during a transition update;
- accept a transition value-type change;
- ignore active policy-only retargeting or reduced-motion settlement.
- restart a layout transition from its prior target instead of presented geometry;
- discard compatible layout spring velocity;
- ignore reduced motion during layout transition lowering.
- let reference or candidate paint interpolation accept unlike kinds or gradient topology;
- let reference or candidate gradient angles take the long arc;
- let reference or candidate shape interpolation accept unlike kinds;
- freeze rectangle corner smoothing in reference or candidate interpolation;
- ignore path fill semantics in reference or candidate interpolation;
- let candidate path interpolation accept a changed command kind;
- ignore stroke placement or dash topology in reference or candidate interpolation;
- ignore shadow-list length or inner/outer kind in reference or candidate interpolation;
- freeze material noise in reference or candidate interpolation;
- ignore type wrapping semantics or variable-axis topology in reference or candidate interpolation;
- ignore media-fit mode in reference or candidate interpolation.
- let reference or candidate visual-transition batches accept duplicate targets;
- let a visual-transition batch skip endpoint compatibility;
- hide a stroke presence change inside reference or candidate interpolation.
- accept two source nodes for one shared visual identity;
- discard a candidate shared-identity relation.
- linearize reference or candidate edge auto-scroll response;
- let reference or candidate auto-scroll escape scroll bounds;
- drop the exact gesture rebase delta;
- accept a stale reference or candidate auto-scroll frame;
- discard candidate auto-scroll intent metadata;
- accept an undeclared auto-scroll parameter or non-scroll owner.
- preserve a removed focus identity or accept a stale focus return;
- accept an unavailable responsive focus destination;
- discard candidate focus-recovery IR;
- accept a focus destination outside its branch or one that cannot receive focus.
- accept stale or nonpositive intrinsic measurement transactions;
- replay unchanged font/media geometry;
- let measurement transactions change semantic or presence state.
- close a parent overlay before its descendant;
- accept out-of-order nested-overlay settlement;
- keep an abandoned overlay-cascade revision live after reversal.
- let reference or candidate adjustable values lose bounds, quantization, or large-step behavior;
- accept descending adjustable ranges or omit a required slider range semantic;
- treat an incompatible hot-reload contract as presentation-compatible;
- retain removed presence or motion channels during hot reload;
- dispose one old task controller more than once;
- omit semantic role from the candidate hot-reload contract.
- drop native platform kind during normalization or HMR compatibility;
- drop native link destination or controlled text value during web lowering;
- accept an unsafe native element;
- drop or conflict visual target value types;
- misclassify static, fine-grained reactive, or retained visual execution;
- accept unknown visual types or unstructured target addresses.
- drop compiler-issued event bindings while mounting native structure;
- dispose mounted structure or presentation more than once;
- send retained motion through the reactive-property backend;
- dispose presentation channels in creation rather than reverse ownership order.
- drop authored text content from normalized structure;
- accept a changed native contract during a fine-grained update;
- rewrite unchanged native attributes;
- report a changed native attribute without applying it.
- discard structured target identity during web presentation lowering.
- leave reactive visual expressions unevaluated during style lowering;
- encode canonical OKLCH lightness without its percentage scale;
- collapse capsule geometry into ellipse geometry;
- silently omit a material that requires node-level composition;
- drop independent foreground paint.
- let material tint overwrite rather than compose with surface fill;
- accept nonzero material noise without a generated visual layer;
- discard generated-layer identity and ownership during semantic normalization;
- discard generated-layer ownership during final web lowering;
- accept one generated identity with conflicting semantic owners;
- drop material backdrop saturation;
- emit a plain color where CSS requires a background image layer.
- classify a retained composite declaration as static cleanup ownership.
- drop native pointer capture and release effects in the web gesture mount;
- omit semantic touch-action ownership from a mounted gesture region;
- dispose a web gesture without cancelling its active recognizer.
- drop a policy-only geometry target during web lowering;
- restart retained layout from target rather than presented geometry;
- collapse independent logical translation axes into one scalar;
- omit changed participants from a grouped Anime Layout projection;
- drop policy-only geometry from hot-refresh compatibility;
- reset retained scalar/layout velocity or retained presence phase on compatible refresh;
- retain a removed motion channel or dispose a compatible retained channel;
- leave old motion controllers alive or rebind before disposing old module-owned work.
- accept descending logical size constraints or orphan flow participation;
- replace logical padding or semantic anchoring with physical or wrong containing-block output;
- drop available-space sizing, flow growth, or the web intrinsic shrink-floor correction.

Production adapter mutations, action-capability leakage, composition-order lowering, native semantic
mutations, and production HMR wiring mutations remain required. The backend-independent HMR and
disposal law is covered; this result still cannot close the complete production mutation gate.

## Evidence Policy

Every new test entry must state:

- semantic law exercised;
- generated or fixed input space;
- observable assertion;
- failure mutation it detects;
- whether the same behavior needs production differential or browser evidence.
