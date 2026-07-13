# UI Language Decision Log

## D-001: Existing Design Is A Candidate

- Date: 2026-07-12
- Status: accepted
- Question: Does `docs/web-ui-design.md` remain the normative language specification?
- Alternatives: retain it as normative; discard it; treat it as one candidate.
- Evidence: the candidate has overlapping visual targets, implicit browser composition, and a
  reproduced transformed-sibling stacking defect despite the implementation plan claiming final
  completion.
- Decision: treat the existing document, implementation, and tests as candidate evidence.
- Falsification condition: the candidate may be selected again only after passing the same semantic,
  expressiveness, cognitive, conformance, and browser gates as competing candidates.

## D-002: Research Precedes Migration

- Date: 2026-07-12
- Status: accepted
- Question: Should the current API be incrementally renamed while the language is being derived?
- Alternatives: migrate continuously; preserve compatibility; freeze expansion and research first.
- Evidence: renaming overlapping concepts before defining their meaning would preserve accidental
  semantics and bias candidate comparison.
- Decision: do not begin a production language migration before language selection.
- Falsification condition: correctness repairs may proceed when they do not add or privilege a public
  language concept.

## D-003: Generic Contract Remains A Candidate Constraint

- Date: 2026-07-12
- Status: proposed
- Question: Should the explicit generic application contract remain the source of type correctness?
- Alternatives: inference factories; generated declarations; explicit generic contract.
- Evidence: the user requires generic-parameter-driven correctness; the current contract connects
  states, actions, parts, gestures, and presets without an inference wrapper.
- Decision: every candidate must demonstrate the explicit generic contract. Its exact schema remains
  open to falsification by authoring and type-system evidence.
- Falsification condition: reopen if the contract creates unavoidable duplication, poor diagnostics,
  or unacceptable author viscosity in the corpus.

## D-004: Visual Targets And Transition Policy Are Distinct

- Date: 2026-07-12
- Status: proposed
- Question: Should motion be another namespace in which target values are authored?
- Alternatives: duplicate target properties under motion; attach transition policy to a single target;
  make every visual value an explicit animated value.
- Evidence: the current candidate exposes opacity under both paint and motion. SwiftUI transactions,
  Compose Styles animation, and value-based animation systems distinguish a target state from the
  policy used to reach it.
- Decision: candidate semantics must test one target owner with separate temporal policy.
- Falsification condition: reject if presence, direct manipulation, or coordinated motion cannot be
  expressed compositionally without restoring duplicate targets.

## D-005: Scalar Properties Are Not A Complete UI Language

- Date: 2026-07-12
- Status: proposed
- Question: Can the visual language be one flat map of typed scalar target properties?
- Alternatives: universal scalar map; categorized records; scalar targets plus irreducible
  relationship algebras.
- Evidence: C02 requires shared identity and geometry following; C04 requires presence, direct
  manipulation, settlement, and platform-layer lifetime; C13 requires composition, clipping, and
  hit-test relationships. Encoding these as unrelated scalar values hides invariants and cycles.
- Decision: retain scalar targets for local values, but test explicit relationship algebras for
  layout, composition, gesture mapping, presence, and shared identity.
- Falsification condition: reopen if a flat typed equation model can express the relationship laws,
  diagnostics, and corpus cases with equal visibility and no backend leakage.

## D-006: Semantic Operations Survive The Relationship Slice

- Date: 2026-07-12
- Status: proposed
- Question: Which candidate remains coherent when translating virtualization, measured text,
  multi-pointer input, and environment retargeting?
- Alternatives: categorized target records; orthogonal semantic operations; typed target equations.
- Evidence: `candidates.md` translates C07, C10, C16, and C18 after `normalized-ir.md` freezes their
  meaning. Categorized records accumulate overlapping backend-phase namespaces. Target equations need
  a second exceptional notation for relationships and weakly compose multi-part recipes. Semantic
  operations preserve one notation for scalar targets and relationships.
- Decision: continue Candidate B as the surviving hypothesis. Retain A and C as controls for category
  scanning and local equation visibility. Do not begin production migration.
- Falsification condition: reject B if the full corpus requires named component/layout catalogs,
  ordering-based precedence, backend access, opaque callbacks, string target references, or a second
  condition/motion notation.

## D-007: Reactive Conditions Remain Values

- Date: 2026-07-12
- Status: proposed
- Question: Should state and environment conditions be ordinary booleans inside preset functions?
- Alternatives: current booleans with runtime branching; symbolic expression values; a separate
  conditional fragment API.
- Evidence: the candidate prose required exact dependencies and one condition algebra while its first
  type fixture exposed booleans. Symbolic `choose` preserves branch value types and subscribes only to
  the active branch; the mutation suite fails when both branches become dependencies.
- Decision: conditions are typed expression values. `choose` is the one reactive branch operation;
  using an expression as JavaScript control flow requires a compiler diagnostic rather than a second
  conditional language.
- Falsification condition: reopen if representative authors cannot express relationship changes or
  recipes without opaque control flow, or if compiler diagnostics cannot locate accidental boolean use.

## D-008: Layout Is Owned Relationships Plus Derived Geometry

- Date: 2026-07-12
- Status: proposed
- Question: Can layout be represented as presentation-owned scalar sizes alone?
- Alternatives: CSS-shaped property map; universal constraint solver; a small parent-algorithm and
  measurement relationship algebra.
- Evidence: C03, C07, C10, C11, and C15 require parent ownership, scrolling, intrinsic measurement,
  and one- or two-axis virtual extent. Executable normalization rejects two algorithms per parent, two
  parents per child, cycles, invalid measurement values, and virtualization without compatible scroll.
- Decision: continue `arrange`, `scroll`, `intrinsic`, and `virtualize` as distinct semantic
  relationships. Resolved geometry is layout-owned; presets may attach transition policy but cannot
  overwrite it.
- Falsification condition: reopen if grid placement, parent swap, sticky behavior, or dynamic
  measurement requires backend terms or repeated special cases rather than general relationship laws.

## D-009: Native Layers Require Structure-Issued Capabilities

- Date: 2026-07-12
- Status: proposed
- Question: How can presentation configure top-layer composition without inventing semantics?
- Alternatives: expose modal/popover flags in presets; forbid visual control; issue typed capabilities
  from semantic parts.
- Evidence: C04, C13, and C17 require visual composition around native top-layer content. A typed
  capability bound to a semantic dialog or popover identity lets the preset state composition while
  preventing a button or generated layer from becoming modal.
- Decision: native-layer relationships require compiler-issued, identity-bound capabilities.
- Falsification condition: reopen if real nested overlay cases need presentation to alter semantic
  ownership, or if the capability duplicates an existing structure fact without adding a visual
  relationship.

## D-010: The App Generic Owns Preset Token And Theme Contracts

- Date: 2026-07-12
- Status: proposed
- Question: Where do preset-specific token identities and theme names obtain type correctness?
- Alternatives: infer through a factory wrapper; expose one global token union; declare contracts in
  the explicit application generic.
- Evidence: a global union exposes Studio-only vocabulary to Family and recreates prefixed access.
  The executable fixture derives exact token references, required base values, and named partial theme
  overrides from `App.Styles.Presets[Name]`; cross-preset access and raw string colors fail typecheck.
- Decision: the app generic owns token identity, value type, and theme-name contracts per preset. A
  preset function receives only its selected references, returns one complete base theme and every
  declared partial override, and does not repeat its registry name.
- Falsification condition: reopen if contract declaration duplicates unavoidable implementation data,
  prevents preset-local extension, or produces unusable diagnostics in independent author tasks.

## D-011: Geometry-Dependent Behavior Uses Bounded Presentation Parameters

- Date: 2026-07-12
- Status: proposed
- Question: Can presets tune tactile gesture behavior without owning semantic commitment?
- Alternatives: all thresholds fixed in behavior; all commitment logic in presets; structure-declared
  typed parameters with bounded preset values.
- Evidence: C03, C04, C08, and C14 need distinct physical feel while retaining identical legal
  outcomes and accessibility alternatives. Letting a preset dispatch outcomes violates the behavior
  boundary; fixing every coefficient in behavior prevents genuinely different feel.
- Decision: structure may declare typed presentation parameters with semantic default and valid
  bounds. Presets provide values; structure and the statechart remain the sole owners of commitment.
- Falsification condition: reject if parameters become an unstructured configuration channel, allow a
  preset to alter meaning, or cannot provide stable defaults when a preset omits them.

## D-012: Transactions Are Derived And Presentation Has No Timeline

- Date: 2026-07-12
- Status: proposed
- Question: Must authors explicitly create animation transactions?
- Alternatives: explicit transaction blocks and timelines; implicit per-property updates;
  runtime-derived semantic transactions with meaningful stages in the statechart.
- Evidence: state, data, geometry, preset, theme, and environment revisions already identify atomic
  target recomputation. Explicit blocks duplicate those boundaries. C04 and C18 require coordinated
  cancellation and retargeting. Protected reveal and confirmation stages change application meaning
  and therefore already belong to statechart behavior.
- Decision: derive ordinary transactions from their semantic revision. Several channels coordinate by
  deriving from one authoritative value. Presentation has no sequence or timeline primitive;
  meaningful stages are states/tasks, while visual choreography maps ranges of shared progress.
- Falsification condition: reopen if an unrelated corpus case cannot coordinate or cancel correctly
  without manual transactions, statechart stages, or shared progress without duplicating behavior.

## D-013: Structure Constructs Semantic Instances, Not Selector Addresses

- Date: 2026-07-12
- Status: proposed
- Question: What does hierarchy authoring need to return so relationships, collections, and presets
  can share identity without leaking DOM selectors or presentation handles?
- Alternatives: selector strings; part-name references; opaque role-typed semantic instances issued
  by generic-driven part constructors.
- Evidence: forms, errors, active descendants, nested overlays, and keyed repeated parts all relate
  concrete instances rather than style addresses. The executable candidate derives exact constructors,
  actions, and roles from `CandidateStructureDefinition<App>`, normalizes their hierarchy through the
  independent semantic reference, and rejects forged roles, duplicate identities, lost ownership, and
  incompatible references. Presentation targets remain unavailable from structure.
- Decision: structure part calls construct opaque semantic instances with stable typed references.
  JSX may lower to these calls and exists only for hierarchy, composition, and keyed or conditional
  presence. The explicit application generic remains the sole source of names and types.
- Falsification condition: reopen if keyed collections, forward relationships, slots, or independent
  author tasks require string identities, awkward ordering, or a second hierarchy language.

## D-014: Collections And Slots Are Typed Identity Boundaries

- Date: 2026-07-12
- Status: proposed
- Question: How can repeated data and child components compose without raw array mapping, selector
  identities, public child internals, or a second hierarchy language?
- Alternatives: author-provided keys on every item; positional iteration; arbitrary children props;
  generic-declared collection and slot contracts with compiler-issued values.
- Evidence: C03, C07, C08, and C11 require stable keyed identity under filter, reorder, measurement,
  focus, and live updates. C05, C09, and C15 require child composition with private ownership. The
  executable candidate derives item type, scalar key, part, role, and reactive references from one
  collection contract. Generated reorder traces preserve key identity. Slot fixtures enforce accepted
  component and one/optional/many cardinality while opaque instances expose no child parts, state, or
  actions. Five corresponding mutations are killed.
- Decision: keyed repetition has one operation, `collection.render`, which supplies its item
  constructor; reactive relationships use `collection.reference`. Slots accept only opaque component
  instances and express ownership/cardinality, while ordinary data and text remain input.
- Falsification condition: reopen if virtualization cannot share this identity, if recursive or
  polymorphic composition requires private-part access, or if independent authors find direct
  component input plus typed slots harder to predict than a materially simpler single mechanism.

## D-015: Structural Conditions Use One Stable Choice

- Date: 2026-07-12
- Status: superseded by D-060
- Question: Does conditional hierarchy need `if`, `Show`, responsive components, and presence wrappers,
  or can one semantic operation cover optional and mutually exclusive structure?
- Alternatives: rerun JSX through ordinary control flow; separate `Show` and responsive primitives;
  one reactive `choose(condition, present, alternate?)` operation.
- Evidence: C05, C06, C09, C10, C11, and C17 require semantic hierarchy to change while inactive
  content leaves accessibility immediately and visual exit may remain retained. The executable
  candidate declares both branches once, materializes exactly one semantic branch per revision, and
  preserves branch identity across return. Type fixtures reject nonboolean conditions. Mutations that
  ignore the condition or leak both branches are killed.
- Decision: continue one structural `choose` operation using the shared expression algebra. Omitted
  alternate means absence. Retained exit and reversal remain presentation presence, not another
  structural condition.
- Falsification condition: reopen if keyed async content, nested component slots, or independent
  author tasks require lazy branch construction, hidden remount behavior, or another condition syntax.

## D-016: Observable Work Is A Named Command Or A State-Scoped Task

- Date: 2026-07-12
- Status: proposed
- Question: Is unrestricted transition `perform` necessary, and should navigation, analytics,
  local-first commands, and asynchronous work share one lifecycle?
- Alternatives: arbitrary transition callback; force all work into tasks; expose a general effect;
  pure transitions plus named committed commands and named state-scoped tasks.
- Evidence: the production audit found `perform`, tasks, resource commands, navigation callbacks,
  render-time mutation capabilities, and function-valued inputs as overlapping paths. XState v5
  distinguishes fire-and-forget actions from invoked actors and separates pure transition output from
  action execution. The integrated generic fixture prevents derivation and structure from receiving
  mutation ports, while exact command/task implementations receive only their required lifecycle
  capabilities. Reference and mutation tests prove post-commit command state, exactly-once drain,
  validation atomicity, and task revision cancellation.
- Decision: reject public `effect` and unrestricted `perform` in the candidate. Guards, updates, and
  derivations are pure. A named command is an ordered exactly-once request after transition commit. A
  named task is invoked for one state lifetime with cancellation and typed done/error outcomes.
- Falsification condition: reopen if focus, navigation interception, streaming actors, child actor
  communication, or local-first receipts require another lifecycle rather than a semantic operation
  within command or task.

## D-017: Statechart References Are Absolute And Parallel Targets Are Orthogonal

- Date: 2026-07-12
- Status: proposed
- Question: Should nested statechart notation permit local and absolute target conventions, implicit
  initials, and unconstrained target arrays?
- Alternatives: inherit backend target syntax; compiler-rewrite local paths; one absolute contract path
  vocabulary with explicit compound initials and validated orthogonal targets.
- Evidence: the production XState adapter currently rewrites initials and targets, making source meaning
  depend on compiler convention. The backend-independent normalizer now rejects local initials, missing
  compound initials, parallel initials, active final nodes, unknown tasks/targets, and simultaneous
  targets outside distinct parallel regions. Candidate root/nested events, tasks, and delays normalize
  through the same IR. Generated traces enter all parallel regions, preserve unaffected regions, prefer
  deeper handlers, and remain deterministic across declaration order. Thirteen mutations are killed.
- Decision: use the generic's absolute state paths everywhere. Compound initial must name a direct child.
  Parallel regions have no initial at the parallel owner and simultaneous targets must be orthogonal.
  Backend target syntax is an adapter concern.
- Falsification condition: reopen if independent author tasks show severe path viscosity, or if guarded
  alternatives, history states, final output, or child actors cannot retain these rules without another
  target language.

## D-018: One Ordered Transition Algebra Owns Guards, Completion, And Delays

- Date: 2026-07-12
- Status: proposed
- Question: Should events, completion, and delayed transitions use separate callback conventions, and
  should guards be selected imperatively by adapters?
- Alternatives: backend callbacks; parallel guard/target arrays; distinct event/done/timer notations;
  one ordered alternative value with an optional pure guard and targets.
- Evidence: the candidate and independent reference now normalize all three transition sources through
  one `{ guard?, targets }` algebra. Tests prove first-enabled guarded choice, explicit fallback,
  recursive compound/parallel completion, once-only final output, exact virtual deadlines, and timer
  cancellation on state exit. Generated clock traces are deterministic. Six new mutations covering
  ignored guards, broken root completion, lost timer ownership, deadline errors, and dropped candidate
  guard/output lowering are killed, bringing the campaign to 113/113.
- Decision: one ordered transition-alternative algebra is proposed. Guards are pure and missing guard
  results are false. Final output belongs only to final states. Delays are state-owned and correctness
  is defined with a monotonic virtual clock; platform timers are adapter details.
- Falsification condition: reopen if always transitions, task-result payloads, streaming actors, or
  independent author studies require a second transition language rather than typed arguments to this
  one.

## D-019: Always And Task Outcomes Are Statechart Transitions, Not New Effect Primitives

- Date: 2026-07-12
- Status: proposed
- Question: Do entry stabilization and asynchronous task results require callbacks or actor APIs in
  addition to the transition language?
- Alternatives: entry effects; unrestricted actor callbacks; backend-native task handlers; guarded
  always and revisioned done/error outcomes over the existing transition algebra.
- Evidence: the independent runtime now stabilizes deepest-owner always transitions before exposing a
  configuration and rejects cycles. State-owned tasks receive monotonic revisions, cancel on exit,
  ignore stale outcomes, and route accepted done/error outcomes through the same alternatives.
  Candidate normalization preserves always guards and task result transitions. Five additional
  lifecycle/lowering mutations are killed, bringing the campaign to 118/118.
- Decision: propose no new public effect or actor syntax for these meanings. `always`, task `done`, and
  task `fail` are typed sources of the same transition algebra. The runtime owns revision and
  cancellation bookkeeping.
- Falsification condition: reopen for streaming, bidirectional child communication, or supervision
  only if the corpus demonstrates semantics that cannot be modeled as a state-owned task plus typed
  events without losing clarity or lifecycle correctness.

## D-020: Close The Expression Core Without Reproducing JavaScript Or CSS

- Date: 2026-07-12
- Status: proposed
- Question: What is the smallest expression language sufficient for reactive presentation while
  preserving exact dependencies and physical dimensions?
- Alternatives: arbitrary TypeScript callbacks; a CSS calculation grammar; every JavaScript numeric
  operator; a closed typed graph with derivable operations omitted.
- Evidence: the frozen corpus requires conditions, affine mappings, bounded values, and interpolation,
  but no case requires unrestricted execution. The candidate/reference differential now covers
  generated finite scalar clamps and comparison. Type fixtures reject mixed dimensions. Short-circuit
  dependency tests and five new mutations cover disjunction, strict comparison, bounds, and candidate
  divergence, bringing the campaign to 123/123.
- Decision: propose `literal`, `read`, equality/comparison, `and`/`or`/`not`, `choose`, `add`, scalar
  `scale`, typed `clamp`, and explicit-clamping interpolation. Use canonical IR units. Omit derivable
  subtraction and constant division; reject dynamic division, implicit conversion, and implicit
  extrapolation. Express discontinuities with comparison plus choice.
- Falsification condition: add an operation only when a versioned corpus case cannot express its
  meaning compositionally, the operation has cross-platform semantics, and independent review finds
  the composition materially less comprehensible.

## D-021: Callable Actions Normalize To Named Data Before Adapter Selection

- Date: 2026-07-12
- Status: proposed
- Question: How can actions remain natural callable values in structure while normalized IR remains
  deterministic plain data?
- Alternatives: serialize closures; drop bindings after typechecking; author string action names;
  compiler-issued callable values carrying opaque contract identity.
- Evidence: the audit found that candidate structure previously discarded `activate`, `change`,
  `submit`, and `dismiss` despite accepting them. The reference node now validates role-compatible,
  unique named bindings. Candidate normalization emits `{ event, action }`, rejects arbitrary
  callbacks, and a canonical cross-domain golden proves the binding and reactive expression survive
  into byte-stable plain data. Four new mutations are killed, bringing the campaign to 127/127.
- Decision: actions remain functions for authors and values remain values. The compiler issues action
  functions from the explicit generic contract and normalization stores only their names. No closure,
  source text, or function wrapper enters adapter IR.
- Falsification condition: reopen if compiler extraction cannot preserve overloaded action arguments
  or source diagnostics without exposing strings to authors; do not reopen merely for backend calling
  convention.

## D-022: Adapter Capabilities Are Derived Semantic Requirements

- Date: 2026-07-12
- Status: proposed
- Question: Should adapters advertise engine/browser features manually, or should requirements be
  derived from compiled UI meaning?
- Alternatives: optimistic execution; hand-maintained demo capability lists; backend feature flags;
  exhaustive semantic requirements derived from canonical IR.
- Evidence: the compiler now derives stable requirements across behavior, semantic roles/actions,
  expressions, transition kinds, composition, gestures, and layout. A balanced golden produces exact
  names and validation fails before execution when one is absent. Mutations that omit action/read
  requirements or bypass validation are killed, bringing the campaign to 130/130.
- Decision: capability names describe meaning, never StyleX, Anime.js, WAAPI, DOM, or another engine.
  Every adapter declares the meanings it preserves, and compilation rejects the first unsupported
  requirement before backend work begins.
- Falsification condition: reopen naming or granularity if two independent adapters need materially
  different declarations for observably equivalent meaning, or if one capability hides separable
  failure modes found by platform acceptance tests.

## D-023: Transition Work Is Named Resolver Metadata In IR

- Date: 2026-07-12
- Status: proposed
- Question: How do pure context updates and typed command payloads survive compilation without putting
  executable closures in statechart IR?
- Alternatives: drop them after typechecking; serialize functions; execute during normalization;
  assign stable structural resolver identities and ordered command names.
- Evidence: candidate `update` and `commands` were previously omitted by hierarchical normalization.
  The shared alternative now retains update identity and ordered `{ name, input? }` command requests,
  validates names against the explicit generic contract, and emits canonical data. The independent
  command model already proves state commit before request, authored ordering, atomic validation, and
  exactly-once drain. Three additional mutations are killed, bringing the campaign to 133/133.
- Decision: normalization stores resolver identities only. Updates remain pure; commands remain named,
  ordered post-commit requests. Adapter wiring resolves those identities to generated functions and
  mutation ports without changing statechart meaning.
- Falsification condition: reopen if source diagnostics cannot map resolver identities back to exact
  author locations, or if typed payload evaluation needs observable work before state commit.

## D-024: Gesture Recognizer Kind Belongs To The Generic Contract

- Date: 2026-07-12
- Status: proposed
- Question: May presentation handles leave recognizer kind implicit for the adapter to infer?
- Alternatives: infer from target shape; use one anonymous continuous channel; let presets select an
  engine recognizer; declare recognizer kind in the component generic and preserve it in IR.
- Evidence: the corpus distinguishes drag, pan, pinch, and rotate behavior and arbitration. Candidate
  handles previously carried only key/value/outcomes, so adapters could not distinguish them. Handles,
  direct mappings, settlements, and capability derivation now preserve kind; a mutation collapsing pan
  to drag is killed, bringing the campaign to 134/134.
- Decision: recognizer kind is nonvisual component meaning fixed by the generic contract. Presets may
  tune bounded feel and map channels, but cannot replace the recognizer kind.
- Falsification condition: refine the kind algebra when activation/arbitration work proves these four
  categories insufficient; do not move recognizer choice into presets or backend APIs.

## D-025: Gesture Intent Is Region-Scoped, Exhaustive, And Accessible

- Date: 2026-07-12
- Status: proposed
- Question: What minimum structure-owned meaning lets adapters recognize and arbitrate gestures
  without moving behavior or accessibility into presets?
- Alternatives: infer conflicts from DOM ancestry; let presets install engine recognizers; one global
  recognizer priority list; generic-driven recognizers bound to semantic regions with exhaustive
  outcomes, accessible alternatives, and explicit pairwise relations.
- Evidence: candidate types derive recognizer kind and finite outcomes from the application generic.
  Normalization requires one declared part region, kind-specific activation, every outcome action, one
  accessible action, and one explicit relation for every pair sharing that region.
  Different regions do not arbitrate. Candidate and oracle tests reject incomplete outcomes, implicit
  conflicts, cross-region edges, duplicate pairs, unknown actions, and cycles. Three new semantic
  mutations are killed, bringing the campaign to 137/137.
- Decision: structure owns recognition meaning and semantic commitment; presets only map resolved
  channels and bounded feel parameters to visual targets. Arbitration is local to one activation
  region, symmetric simultaneity is canonicalized, and unsupported meaning must fail before adapter
  execution.
- Falsification condition: refine region or relation semantics if nested-scroll, long-press, or hover
  corpus cases cannot be represented without backend hierarchy inference; never permit silent
  priority defaults.

## D-026: Web Recognition Uses Confirmed Samples And Stateful Arbitration

- Date: 2026-07-12
- Status: proposed
- Question: What platform-lowering contract preserves low-latency pointer fidelity without allowing
  speculative input or event-order accidents to change semantic behavior?
- Alternatives: feed every browser sample directly to statecharts; delegate semantics to an engine
  draggable; use static recognizer priority; lower canonical intent through a stateful arena and keep
  backend sampling details behind the adapter.
- Evidence: the web-adapter spike falsified scale bounds as pinch activation and static `before` as a
  sufficient arbitration meaning. Primary Pointer Events evidence distinguishes confirmed/coalesced
  samples from predictions and requires `touch-action` for browser direct manipulation. UIKit evidence
  distinguishes simultaneity from waiting for another recognizer to fail. The revised candidate uses
  one activation threshold per recognizer, explicit simultaneity, exclusive tie preference, or
  directional failure dependency. It recognizes drag/pan/pinch/rotate, shares multipointer capture,
  keeps velocity on one confirmed clock, validates packets atomically, and passes 1,000 generated
  lifecycles. Seven lowering mutations are killed, bringing the campaign to 144/144.
- Decision: confirmed samples alone may change recognizer state; coalesced samples are confirmed and
  processed chronologically, while predictions are presentation-only. Capture begins on recognition
  and is balanced on release, cancellation, loss, or absence. Gesture availability never removes its
  accessible alternative. The adapter derives logical-axis platform policy from semantic intent.
- Falsification condition: reopen the arena semantics when native-scroll boundary, long-press, hover,
  pen, or real-browser acceptance exposes meaning that cannot be expressed by the current activation
  and relation algebra; backend engine APIs remain replaceable implementation details.

## D-027: Scroll Handoff Is Declared Meaning; Gesture Samples Are Discriminated

- Date: 2026-07-12
- Status: proposed
- Question: How can a custom gesture coexist with native scrolling without exposing DOM state or a
  multipurpose event object to authors?
- Alternatives: let presets inspect `scrollTop`; disable native scrolling and emulate it; let every
  gesture event expose translation/scale/rotation fields; declare scroll ownership in structure and
  emit kind-specific samples.
- Evidence: the existing reference law already gives scrolling ownership except for outward movement
  at its declared boundary. Candidate structure now names the scroll part, logical boundary, and
  outward sign for one-axis drag/pan. Normalization rejects unknown owners and two-axis ambiguity. The
  pure web adapter reads platform metrics behind its port and passes away-from-boundary, inward, and
  outward traces; a mutation that steals scrolling is killed, bringing the campaign to 145/145. API
  review also found that a shared translation/scale/angle event leaked irrelevant fields, so public
  output now discriminates translation, scale, and typed rotation samples.
- Decision: native-scroll competition is structure meaning and live metrics are adapter facts.
  Presets only consume the resolved channel. Same-axis conditional delivery is an explicit web
  capability pending browser acceptance, never an assumed `touch-action` guarantee. Public gesture
  samples expose only the measurement their recognizer produces.
- Falsification condition: reopen if browser acceptance cannot preserve native momentum and outward
  handoff for a required corpus case, or if a recognizer needs a measurement not expressible as a
  focused discriminated sample.

## D-028: Raw Interaction Is Part-Local; Intent Is Explicit Policy

- Date: 2026-07-12
- Status: proposed
- Question: Should hover, focus, pressed, selected, gesture activity, hover intent, and long press
  share one component interaction object?
- Alternatives: one component-global bag; mirror all semantic states as interaction booleans; expose
  raw DOM events; keep raw platform facts part-local and model intent recognizers explicitly.
- Evidence: the candidate scope previously exposed component-wide `interaction.hovered` and mixed
  semantic selected/disabled/expanded and gesture dragging into the same object. The revised type
  fixture removes that path, exposes hover/focus-within on each part, and exposes pressed/focus-visible
  only on focusable controls. The reference hover coordinator proves dwell, speed, delayed leave, and
  focus-equivalent engagement. The reference long-press coordinator proves virtual-time progress,
  movement tolerance, exactly-once recognition, cancellation, and commitment. Five mutations are
  killed, bringing the campaign to 150/150.
- Decision: raw interaction is adapter-owned, read-only, fine-grained, and part-local. Semantic state
  remains in behavior/structure; continuous activity remains on named gesture channels. Hover intent
  and long press require explicit policy and emit discrete semantic events only after recognition.
  Hover-dependent meaning must have a focus or native-activation equivalent.
- Falsification condition: reopen the exact intent declaration notation after safe-polygon and
  long-press candidate stress tests; do not restore a component-wide or multipurpose interaction bag.

## D-029: Recognizer Kinds Derive Channels; Presets Own Typed Projection

- Date: 2026-07-12
- Status: proposed
- Question: Should a recognizer's generic contract declare an arbitrary visual `Value`, or should its
  kind determine the information it can produce?
- Alternatives: retain `Gestures.Name.Value`; let presets read raw pointer packets; derive a closed
  channel shape from each recognizer kind and require an explicit typed projection for direct visual
  ownership.
- Evidence: the prior generic allowed a drag to claim that it directly produced opacity, size, or any
  unrelated visual type. The revised candidate removes `Value`, renames the contract to `Recognizers`,
  and derives translation/rate, scale/rate, angle/rate, long-press progress/position, or hover-intent
  engagement/progress/position/rate from `Kind`. Type fixtures reject nonexistent channels and reject
  discrete recognizers as direct continuous owners. Candidate IR retains the explicit typed projection.
  Hover intent additionally requires focus equivalence and validates safe-polygon destination
  ownership; long press validates positive duration and movement tolerance. Four new mutations are
  killed, bringing the campaign to 154/154.
- Decision: recognizers describe derived input meaning, never presentation values. Raw part interaction
  remains separate. Structure owns kind, activation, outcomes, arbitration, and accessibility;
  presets consume read-only kind-derived channels and explicitly project them onto visual targets.
  The canonical artifact names behavior `recognizers` separately from presentation
  `directManipulation`.
- Falsification condition: reopen channel inventory if corpus work needs meaning that cannot be derived
  from these six kinds, or if explicit projection cannot represent a required coordinated visual
  result without backend access. Do not restore an unconstrained generic `Value`.

## D-030: Dimensional Normalization Is An Explicit Expression Operation

- Date: 2026-07-12
- Status: proposed
- Question: How does a preset map a meaningful physical channel such as drag distance into reusable
  visual progress without accepting CSS/engine math or pretending the recognizer emits opacity?
- Alternatives: add arbitrary recognizer `Value`; expose JavaScript callbacks over raw samples; assign
  every recognizer a visual progress convention; add one typed normalization operation to the closed
  expression algebra.
- Evidence: drag and pan correctly emit logical lengths, while interpolation consumes scalar progress.
  The candidate now normalizes a scalar or typed measure against a same-dimension range with explicit
  clamping. Type fixtures reject mixed dimensions; evaluation records exact dependencies and rejects
  zero extent. Two new mutations are killed, bringing the campaign to 156/156.
- Decision: normalization is explicit, dimension-safe, backend-independent meaning. It does not imply
  a component-specific destination or commitment threshold. Presets may normalize one authoritative
  recognizer channel and derive several visual targets from that scalar.
- Falsification condition: reopen only if the frozen corpus requires a different dimensional mapping
  that cannot be composed from normalization, typed arithmetic, clamping, choice, and interpolation.
  Do not add raw callback evaluation or unitless CSS strings.

## D-031: Intent Recognizers Have Fixed Signals And Differential Lowering

- Date: 2026-07-12
- Status: proposed
- Question: Can hover intent and long press use arbitrary component outcome labels, or does the adapter
  need a fixed semantic lifecycle?
- Alternatives: infer meaning from labels; send raw pointer/timer events to the statechart; let each
  component redefine lifecycle events; derive fixed signals from recognizer kind and bind each signal
  to a typed application action.
- Evidence: the first adapter attempt could not know whether an arbitrary long-press outcome meant
  recognition, release, or cancellation. The revised generic omits `Outcomes` for `hoverIntent` and
  `longPress`. Hover derives `engaged`/`disengaged`; long press derives
  `recognized`/`released`/`cancelled`. Runtime normalization independently rejects a malformed
  generated contract. Candidate adapters match independent reference traces for timing, focus,
  progress, cancellation, and release, and retain hover engagement through the declared safe-polygon
  handoff. Six new mutations are killed, bringing the campaign to 162/162.
- Decision: recognizer kinds with an intrinsic lifecycle own a fixed exhaustive signal vocabulary.
  Structure binds those signals to generic-declared actions. Continuous recognizers retain
  component-defined semantic destinations. Adapter clocks use platform time while typed author time
  remains seconds.
- Falsification condition: reopen signal vocabulary if corpus work reveals a semantically distinct
  phase that cannot be represented without raw input events. Do not infer semantics from names or
  expose platform event order to application behavior.

## D-032: Transactions Are Derived Atomically From Scene Diffs

- Date: 2026-07-12
- Status: proposed
- Question: Should authors name/start visual transactions, and what happens when preset, theme, or
  environment changes while channels are active?
- Alternatives: imperative named transactions; independent property callbacks; restart every changed
  animation; derive one transaction from the target/policy scene diff and one presented-value sample.
- Evidence: the reference now validates all channel identities, value types, targets, policies, and
  presented samples before returning a plan. One cause, revision, and epoch stamp the sorted change
  set. Active spring policy changes preserve current velocity; incompatible timing changes replace it;
  reduced motion settles active channels immediately; turning reduced motion off does not resurrect
  settled channels. Identity changes require explicit presence semantics. Four new mutations are
  killed, bringing the campaign to 166/166.
- Decision: authors assign target values and typed transition policies but never create transactions.
  The compiler/runtime derives a transaction for semantic, preset, theme, environment, geometry, or
  reduced-motion scene changes, samples presented channels once, validates the complete plan, and only
  then commits it atomically.
- Falsification condition: reopen if a corpus case has meaningful transaction identity or ordering
  that cannot be represented by statechart stages plus derived shared progress. Do not add imperative
  animation starts merely to coordinate visual properties.

## D-033: Layout Motion Retains Presented Geometry And Log-Size Velocity

- Date: 2026-07-12
- Status: proposed
- Question: What state must layout animation retain so interruption, resize, and parent swap do not
  jump or produce invalid dimensions?
- Alternatives: replay FLIP from the previous target rect; animate one generic progress scalar; let
  the backend restart its layout animation; retain presented logical geometry and component velocity.
- Evidence: the reference now treats logical inline/block position and logarithmic inline/block size
  as one geometry channel. A spring retargets from the presented rect with compatible velocities;
  timing resets velocity; reduced motion settles to the target with identity projection. Parent swaps
  project in a shared logical coordinate space. Three new mutations are killed, bringing the campaign
  to 169/169.
- Decision: target layout updates immediately, while presentation retains positive-size geometry and
  derives one projection into that target. Interruption samples presented geometry, never the prior
  target. One geometry owner prevents anchoring or another transform path from applying duplicate
  translation.
- Falsification condition: reopen the geometry representation if transformed-parent or 3D corpus cases
  cannot be represented in the adapter's shared coordinate space. Do not expose browser FLIP steps or
  engine layout objects to authors.

## D-034: Visual Values Own Interpolation Compatibility

- Date: 2026-07-12
- Status: proposed
- Question: Should a temporal policy or backend decide how arbitrary visual values blend, or should
  compatibility be part of each value's meaning?
- Alternatives: let StyleX/Anime.js/CSS choose; accept arbitrary keyframe values; add per-transition
  interpolation callbacks; define one compatibility and interpolation law for every visual value.
- Evidence: the candidate and an independent reference now agree for typed paint, rectangle/path
  shape, stroke, shadow stacks, material, type style, media fit, and transform. Gradients require the
  same kind and stop count; paths require the same coordinate/fill semantics and command topology;
  stroke dashes, shadow stacks, variable-font axes, and textual modes retain topology. Unlike kinds
  are diagnosed as discrete. Type fixtures reject unitless gradient angles. Twenty-nine new mutants
  covering compatibility and intermediate-value faults are killed, bringing the campaign to 198/198.
- Decision: each value algebra determines whether a pair is continuous, topology-conditional,
  retained geometry, discrete, or capability-scoped. Transition policy controls timing,
  interruption, and reduced motion only. A discrete visual change needs explicit identities and
  presence and coordinated opacity; an adapter may not invent an implicit blend.
- Falsification condition: reopen a row only when a frozen corpus case demonstrates a meaningful,
  deterministic interpolation that the current classification cannot express. Do not add raw CSS
  interpolation strings or backend callbacks.

## D-035: Visual Compatibility Precedes Temporal Handoff

- Date: 2026-07-12
- Status: proposed
- Question: Should the retained physics scheduler accept arbitrary composite values, or should visual
  endpoint compatibility be resolved before temporal channels are created?
- Alternatives: flatten every composite into a scalar/vector solver; let each backend discover
  incompatibility after starting; validate values independently but not atomically; preflight every
  changed visual endpoint as one pure batch before temporal handoff.
- Evidence: the reference and candidate batch normalizers agree for mixed number, paint, and shape
  changes, reject an incompatible paint beside a valid opacity without producing a partial plan,
  reject duplicate targets, and require explicit presentation presence for stroke/material absence.
  Generic fixtures exclude retained layout geometry from this path. Six batch-bypass mutations are
  killed, bringing the campaign to 204/204.
- Decision: target-value compatibility is an atomic scene-diff preflight. Only after it succeeds may
  the runtime schedule retained temporal channels. Temporal solvers own progress and physical
  channel state; they do not redefine paint, path, typography, or media interpolation. Layout
  geometry keeps its dedicated retained-projection law.
- Falsification condition: reopen if a corpus case requires a genuinely coupled vector trajectory
  whose meaning cannot be represented by the value algebra plus a shared temporal source. Do not
  flatten arbitrary composites merely because one backend exposes numeric arrays.

## D-036: Crossfade Is Composition, Not A Primitive

- Date: 2026-07-12
- Status: proposed
- Question: Does coordinated source/destination blending require a public `crossfade` construct?
- Alternatives: add a named crossfade primitive; encode crossfade inside shared identity; let the
  adapter infer blending; compose two local opacity targets, presence, one transaction, and optional
  shared geometry.
- Evidence: one candidate trace composes C09-style source/destination geometry with `match`, local
  opacity transitions, source-local retained presence, and the atomic transaction law. Midpoint
  reversal continues from presented opacity and velocity, stale exit settlement is ignored, and the
  source becomes noninteractive/inaccessible at exit start. Shared identity remains independently
  mutation-tested; two new mutants are killed, bringing the campaign to 206/206.
- Decision: crossfade has no independent meaning beyond target values, transaction coordination, and
  presence. `match` exists only for shared geometry/visual identity. Authors create explicit layers or
  identities and coordinate opacity; adapters may coalesce equivalent drivers without changing
  semantics.
- Falsification condition: reopen only if a frozen corpus case requires an observable crossfade law
  not derivable from opacity, presence, transaction, and composition. Do not add a convenience alias
  that becomes a second lifecycle model.

## D-037: Edge Auto-Scroll Is A Recognizer-To-Scroll Relationship

- Date: 2026-07-12
- Status: proposed
- Question: How can sortable and range-selection gestures continue at a viewport edge without
  exposing an imperative loop or causing pointer/geometry jumps?
- Alternatives: application pointer-move effects; preset-authored animation callbacks; an automatic
  behavior on every scroll container; a structure-declared recognizer-to-scroll relationship with
  preset-tunable normalized coefficients.
- Evidence: the reference law maps logical edge proximity to monotonic quadratic velocity, clamps to
  scroll bounds, and emits the exact applied delta as gesture rebase. A revision-scoped session rejects
  stale frames and stops on cancellation/disposal. The independently implemented candidate adapter
  agrees on samples and bounds. Generic fixtures restrict parameter names; normalization requires a
  single-axis drag/pan, declared parts/parameters, and a compatible layout scroll owner. Eleven new
  mutants are killed, bringing the campaign to 217/217.
- Decision: structure alone declares which recognizer may auto-scroll which scroll owner. Presets may
  set an edge fraction and maximum viewport-lengths per second through bounded generic-declared
  parameters. The adapter schedules frames, applies platform scrolling, and adds the actual scroll
  delta to the recognizer coordinate basis. Keyboard alternatives remain independent.
- Falsification condition: reopen if two-axis canvas or nested-scroll corpus traces require a
  relationship that cannot be composed from one relation per logical axis and existing recognizer
  arbitration. Do not expose frame scheduling, DOM scroll methods, or engine objects.

## D-038: Responsive Structural Choice Owns Focus Recovery

- Date: 2026-07-12
- Status: proposed
- Question: When a container-driven structural branch removes the focused node, should the browser or
  adapter guess where focus goes?
- Alternatives: allow browser focus loss; search the next tree by document order; put imperative focus
  effects in application code; declare one compiler-issued destination per structural-choice branch.
- Evidence: the reference coordinator preserves a surviving focus identity, replaces removed focus
  with the incoming branch destination, rejects hidden/inert/nonfocusable destinations, and ignores
  stale overlay returns captured before the replacement revision. Candidate normalization proves both
  destinations belong to their respective branches and emits only the selected destination. Six new
  mutants are killed, bringing the campaign to 223/223.
- Decision: responsive structure, not presentation, owns focus recovery. A `choose` may carry one
  focus reference per branch. Preservation has priority; replacement is explicit when identity is
  removed. The structure transaction revisions return-focus callbacks, preventing stale ownership.
- Falsification condition: reopen if a corpus case needs focus recovery based on a semantic relation
  other than branch membership, such as preserving a keyed descendant across two branch-local
  containers. Extend semantic reference mapping, not imperative platform-focus callbacks.

## D-039: Intrinsic Observations Are Geometry-Only Transactions

- Date: 2026-07-12
- Status: proposed
- Question: Should font, media, content, or container measurements replay component transitions or
  mutate semantic presence when intrinsic metrics arrive late?
- Alternatives: update layout immediately outside transactions; replay the current state entry;
  expose observer callbacks to application code; commit one revisioned geometry-only transaction.
- Evidence: reference and independently implemented candidate coordinators reject stale batches,
  validate every positive measurement before commit, sort changed identities, and omit unchanged
  observations. Their outputs explicitly keep semantic and presence state unchanged. The resulting
  geometry retargets from currently presented size and log-size velocity. Eight new mutants are
  killed, bringing the campaign to 231/231.
- Decision: intrinsic observation is adapter input to a geometry transaction with an origin of
  content, font, media, or container. It never reenters the statechart or presence lifecycle merely
  because metrics changed. Existing intrinsic layout declarations provide author intent; no observer
  operation is added to the public language.
- Falsification condition: reopen if a corpus case demonstrates that loading completion itself has
  semantic meaning. Model that as an application event separately from visual measurement; do not
  infer semantics from an observer callback.

## D-040: Nested Overlay Exit Is A Derived Child-First Cascade

- Date: 2026-07-12
- Status: proposed
- Question: Does a parent dialog need an authored animation sequence to wait for a child popover or
  confirmation before exit?
- Alternatives: independent exits; preset timeline; application-managed delay; a close cascade derived
  from semantic overlay ancestry and per-identity presence.
- Evidence: reference and candidate coordinators both select the top descendant first, reject parent
  settlement while that child is current, advance only after child completion, and restore the full
  affected chain outer-to-inner on reversal. Reversal emits a new revision and rejects stale
  settlement from the abandoned close. Six new mutants are killed, bringing the campaign to 237/237.
- Decision: nested overlay ancestry supplies close order. Each identity retains its own presentation
  presence; a derived runtime cascade coordinates which identity may exit next. Presets still own each
  identity's visual targets and motion policy but cannot reorder semantic closure or focus return.
- Falsification condition: reopen if a frozen case requires two sibling overlays to close concurrently
  while preserving lawful modality. Extend the ancestry law, not a general preset timeline.

## D-041: Every Adjustable Input Uses One Semantic Range Resolver

- Date: 2026-07-12
- Status: proposed
- Question: Should pointer drag, keyboard adjustment, and direct numeric input implement separate
  stepping behavior for a slider, dial, or range-selection handle?
- Alternatives: platform-specific handlers; preset-authored rounding; a statechart event per input
  modality; one structure-owned range and one resolver used by every proposal.
- Evidence: reference and independently implemented candidate resolvers validate ascending finite
  bounds, positive step and large step, clamp and quantize relative to the minimum, preserve exact
  endpoints outside an uneven interior lattice, and produce identical values for pointer, keyboard,
  and programmatic sources. Candidate structure emits all range facts and the compiler-issued change
  action. Nine new mutants are killed, bringing the campaign to 246/246.
- Decision: structure owns `value`, `minimum`, `maximum`, `step`, `largeStep`, and one change action.
  Direct manipulation may present continuous intermediate motion, but every semantic commitment uses
  the same resolver. Presets can map those facts visually and cannot redefine legal values.
- Falsification condition: reopen if a frozen case requires a modality-specific legal value rather
  than a different visual preview. Such a case must explain why it is not two distinct semantic
  controls.

## D-042: Compatible Hot Refresh Retains Values But Replaces Controllers

- Date: 2026-07-12
- Status: proposed
- Question: What survives when module code or a preset changes while semantic state, presence, tasks,
  gestures, and motion are live?
- Alternatives: remount on every refresh; retain all runtime objects; compare source text; compare a
  canonical semantic contract and retain only portable values/samples.
- Evidence: the reference and candidate laws classify behavior topology, semantic
  identity/role/action bindings, and recognizer topology as the compatibility contract. Presentation
  target changes preserve context, state, surviving presence, and shared presented target samples.
  Semantic role changes replace the component. Both paths deduplicate disposal of old motion, task,
  and gesture controllers. Nine additional mutants are killed, bringing the campaign to 255/255.
- Decision: compatible presentation refresh is a non-remounting transaction. Retained state consists
  only of backend-independent values and presented samples; old controller instances are always
  disposed before new code binds. Incompatible contracts replace the component without retaining live
  semantic state.
- Falsification condition: reopen if production lowering cannot restart a state-owned task or retarget
  a shared visual channel from the retained snapshot without exposing module or engine objects to the
  author language.

## D-043: Web Lowering Consumes Native Kind And Typed Targets

- Date: 2026-07-12
- Status: proposed
- Question: Can the web adapter reconstruct native elements and optimal visual execution from semantic
  role plus serialized target values?
- Alternatives: infer a tag from ARIA role; inspect author JSX; parse value shapes and target-name
  suffixes; preserve native platform kind and concrete target value type in normalized IR.
- Evidence: the first pure web lowering proof could not distinguish native controls from generic role
  hosts because candidate normalization had dropped element kind, and it could not classify static,
  reactive, or retained visual work because target value types had been discarded. The revised
  artifact emits native kind, controlled values, link destination, form and ARIA facts, action events,
  and typed visual targets. It rejects unsafe elements, conflicting/unknown types, and malformed
  addresses. Eleven new mutants are killed, bringing the campaign to 266/266.
- Decision: platform-specific structure preserves native platform kind as first-class semantic IR.
  Visual targets preserve their concrete value type. The adapter selects stylesheet, fine-grained
  reactive-property, or retained-motion execution from normalized meaning, never from authored backend
  objects or serialized value inspection.
- Falsification condition: reopen if a production adapter must parse the canonical diagnostic key,
  inspect a serialized value, or accept an untyped target to recover presentation meaning. The
  structured address and value type must remain sufficient.

## D-044: Web Execution Is A Thin Idempotent Platform Port

- Date: 2026-07-12
- Status: proposed
- Question: Does applying normalized structure and presentation require a virtual DOM or one generic
  effect callback?
- Alternatives: rebuild JSX through a virtual tree; expose mount effects to authors; let every backend
  target use one mutation loop; execute normalized native and visual instructions through a thin port.
- Evidence: the generic mount proof creates native nodes, applies attributes and properties, binds
  compiler-issued actions, appends the normalized hierarchy, and removes listeners/roots once. Visual
  execution calls distinct static stylesheet, fine-grained reactive-property, and retained-motion
  operations, then disposes them once in reverse ownership order. Five new mutants are killed, bringing
  the campaign to 271/271.
- Decision: the web runtime consumes normalized IR through narrow platform operations. It does not
  recreate component structure on reactive updates and does not expose lifecycle callbacks or backend
  controller objects to authors. Every mounted owner returns one idempotent disposer.
- Falsification condition: reopen if real DOM application requires semantic-tree rerendering for a
  target update, or if native dialog/focus/pointer ownership cannot remain outside the visual channel
  operations.

## D-045: Ordered Native Content And Compatible Semantic Updates Are First-Class

- Date: 2026-07-12
- Status: proposed
- Question: Can a thin native adapter preserve authored text and update semantic facts without either
  parsing JSX or rebuilding the native hierarchy?
- Alternatives: discard text into an external renderer; rebuild the hierarchy for every semantic
  change; store opaque author children; preserve ordered text/node content and diff only compatible
  native attributes/properties.
- Evidence: candidate normalization now emits ordered text and node entries while the independent
  semantic validator proves that node content exactly matches child ownership. The web port mounts
  real text nodes, retains native identity for attribute/property-only changes, rejects element,
  content, and event-contract changes, and omits equal writes. Direct browser acceptance verified
  controlled textbox/range events, link dispatch, native dialog state, and focus return. It also found
  and fixed range property ordering. Four new mutants are killed, bringing the campaign to 275/275.
- Decision: ordered authored content belongs in normalized structure. A compatible semantic update is
  an explicit native attribute/property diff; a changed native contract requests replacement rather
  than being partially patched. Browser-specific property dependencies are adapter invariants.
- Falsification condition: reopen if a frozen corpus case requires changing authored text or event
  vocabulary without replacement while preserving the same native semantic contract. Define that
  compatibility law explicitly before broadening the updater.

## D-046: Web Visual Instructions Preserve Structured Identity

- Date: 2026-07-12
- Status: proposed
- Question: May the final web presentation instruction retain only a canonical target key and ask the
  adapter to recover its owning node?
- Alternatives: parse the canonical diagnostic key; retain an opaque node/controller; carry the
  compiler-issued structured identity and property through lowering.
- Evidence: a production-representative visual adapter cannot address a native node from `property`
  alone, while parsing the colon-delimited diagnostic key would couple execution to serialization.
  The web target now carries `identity` and `property` copied from the validated structured address.
  A new mutant that replaces the identity is killed, bringing the campaign to 276/276.
- Decision: canonical target keys are for deterministic maps and diagnostics only. Every adapter
  instruction carries structured address fields and consumes them directly.
- Falsification condition: reopen only if an adapter can prove it requires a richer compiler-issued
  target reference. Extend structured meaning; never parse a diagnostic string or expose a backend
  object to authored presentation.

## D-047: Surface Fill And Foreground Paint Are Distinct Targets

- Date: 2026-07-12
- Status: proposed
- Question: Can one `fill` target describe both a semantic part's surface and its text/icon content?
- Alternatives: infer background versus color from native element kind; require an authored wrapper
  solely for color; put paint inside typography; expose independent surface and foreground targets.
- Evidence: the strict web-encoding slice could not represent a button with an independently painted
  surface and label from one part. Element-kind inference is ambiguous because text-bearing elements
  can also own surfaces, while a wrapper changes semantic hierarchy for a visual concern. The
  candidate now exposes `fill` for the part surface and `foreground` for text/current-color content.
  Exact OKLCH lowering and generic-driven type access pass; five additional encoder mutants are
  killed, bringing the campaign to 281/281.
- Decision: surface paint and foreground paint have separate ownership. Typography describes glyph
  metrics and layout, not color. Generated drawing layers expose surface fill only because they have
  no semantic content.
- Falsification condition: reopen if the visual corpus demonstrates another irreducible content-paint
  domain, such as multicolor glyph layers, that cannot be expressed through generated drawing layers
  or media content without overloading foreground.

## D-048: Composite Visual Meaning Lowers At The Node Boundary

- Date: 2026-07-12
- Status: proposed
- Question: Can every semantic visual target be encoded and applied independently when several
  targets contribute to one platform drawing operation?
- Alternatives: let the last target overwrite a CSS property; merge targets in authored order; create
  a node-level lowering pass over typed target ownership; expose backend composition to presets.
- Evidence: material tint and surface fill both contribute to the web background while remaining
  independent semantic targets. Target-local lowering either overwrote one or emitted invalid CSS.
  The node pass groups by structured identity, composes a solid tint as a constant gradient over the
  final fill, emits backdrop blur/saturation once, rejects duplicate platform declarations, and
  rejects nonzero noise until a generated layer exists. Direct browser testing found the invalid
  plain-color layer and verifies the corrected computed styles. Four new mutants are killed, bringing
  the campaign to 285/285.
- Decision: semantic target ownership stays independent, but platform encoding may synthesize one
  node instruction from several typed targets. Authored contribution order never chooses the winner.
  Unsupported composition fails before application.
- Falsification condition: reopen if retained updates cannot preserve independent dependency and
  velocity ownership while re-synthesizing a shared platform declaration. The fix must retain
  semantic ownership, not expose CSS ordering.

## D-049: One Execution Channel Owns A Platform Property For Its Lifetime

- Date: 2026-07-12
- Status: proposed
- Question: May static cleanup clear a platform property while a retained channel owns its presented
  value, or may a backend controller initialize from a different value than the retained graph?
- Alternatives: let each mechanism restore its own defaults; repaint the target after cleanup; define
  exclusive execution-channel ownership and initialize every backend from the retained sample.
- Evidence: direct browser testing of a `44 -> 56` spring first sampled `42`. Anime's hidden model had
  been initialized to zero while the adapter manually painted `44`, and static preset cleanup then
  removed the retained `block-size`. Initializing both Anime factories from `model.value` and excluding
  retained properties from static cleanup produced a forward spring with physical overshoot and a
  continuous mid-flight retarget. A real Anime regression test rejects samples below the retained
  start value. A later synthetic initial direct write manufactured excessive velocity; creating the
  channel at its resolved endpoint removed it. Node-level declarations now carry one derived execution
  strategy, and a new mutant that demotes retained composite ownership is killed, bringing the
  campaign to 286/286.
- Decision: stylesheet, reactive, and retained execution are mutually exclusive owners of a final
  platform property for the mounted channel lifetime. Backend state starts from the graph's presented
  value and velocity; disposal by another channel cannot clear it.
- Falsification condition: reopen if node-level composite declarations require several execution
  strategies. Their compiler instruction must derive one authoritative channel from all source
  dependencies, not permit competing writes.

## D-050: Pointer Delivery Is A Thin Port Over Semantic Recognition

- Date: 2026-07-12
- Status: proposed
- Question: Should web applications or presets wire pointer capture, coalesced/predicted packets,
  touch-action, cancellation, and recognizer disposal themselves?
- Alternatives: expose raw events to structure; use an engine-specific draggable as public meaning;
  bind normalized recognizers through a narrow web pointer port.
- Evidence: the port derives touch-action from semantic axis and scroll competition, maps logical
  coordinates, forwards confirmed coalesced packets, keeps predictions presentation-only, captures
  after recognition, releases on every terminal path, and cancels active streams once on disposal.
  Direct browser drag, spring-back, velocity dismissal, and repeated activation pass. Three new
  mutants are killed, bringing the campaign to 289/289.
- Decision: structure owns recognizer meaning and arbitration; the web adapter owns pointer delivery
  and capture. Presets consume normalized gesture channels and release parameters, never DOM events or
  draggable controllers.
- Falsification condition: reopen if browser pen, pointer-lock, or accessibility behavior requires a
  new semantic input distinction. Extend normalized input meaning, not the author-facing backend.

## D-051: Native Modal Exit Closes The Top Layer Before Visual Settlement

- Date: 2026-07-12
- Status: proposed
- Question: How can a native modal dialog release focus and hit testing immediately while preserving
  a same-node visual exit and reversal?
- Alternatives: keep `showModal()` open and alter ARIA; close and lose exit; clone a visual proxy;
  close immediately and retain the same node using captured fixed geometry.
- Evidence: while `showModal()` remained open, the browser refused outside focus despite modal ARIA
  and pointer release. Capturing geometry, closing native modality, marking the same node inert, and
  displaying it as a fixed retained surface immediately restored trigger focus and clickability.
  Settlement hides it; activation during exit reopens the identity and rejects stale settlement.
- Decision: native semantic ownership ends at exit start. The same node may remain presentation-only
  outside the top layer until its declared targets settle. Native backdrop presentation must be
  replaced by a generated presentation layer because `::backdrop` cannot survive `close()`.
- Falsification condition: reopen if browser behavior prevents stable same-node geometry across close
  and reopen at required viewports. A presentation proxy is acceptable only if identity, accessibility
  absence, hit testing, and reversal laws remain explicit.

## D-052: Generated Presentation Layers Preserve Semantic Ownership

- Date: 2026-07-12
- Status: proposed
- Question: How can a platform-generated backdrop survive native modal release without parsing target
  keys, acquiring interaction, or settling independently from its owner?
- Alternatives: retain native `::backdrop`; clone an unowned DOM overlay; infer the owner from a string
  prefix; preserve generated identity and owner as typed IR through normalization and final lowering.
- Evidence: generated handles now carry one structured identity/owner pair. Normalization rejects an
  address mismatch or conflicting owner, and web node instructions retain the pair. Three dedicated
  mutants are killed, bringing the campaign to 292/292. The browser adapter creates exactly one inert,
  pointer-inert layer, validates that its owner is mounted, and shares preset paint between native and
  generated backdrops. A live trace samples opacity `1 -> 0` while the retained dialog translates out;
  focus and trigger hit testing release at exit start, reversal reuses both identities, and final hide
  waits for both channels.
- Decision: generated presentation nodes are first-class owned IR, never anonymous platform artifacts.
  Presence coordinates all local and generated targets under one revision; platform adapters may
  materialize them but may not infer ownership from encoded names or grant them semantics.
- Falsification condition: reopen if a platform requires a generated layer with independent semantic
  interaction. Such a layer must become authored structure with its own identity rather than weakening
  generated-layer invariants.

## D-053: Layout Policy Is Separate From Logical Layout Meaning

- Date: 2026-07-12
- Status: proposed
- Question: May presentation own resolved geometry or duplicate flow/grid syntax in order to animate a
  responsive layout change?
- Alternatives: expose CSS layout values in presets; let presentation write geometry; derive a retained
  geometry instruction from the canonical target transaction while lowering logical layout relations
  independently.
- Evidence: policy-only geometry now survives normalization even though it has no authored target value.
  The web proof lowers flow, grid, overlay, scrolling, placement, sticky attachment, intrinsic sizing,
  and aspect ratio to logical properties without inspecting target-key strings. Independent layout
  formulas agree through interruption and parent swaps, and mutations that drop policy-owned geometry
  or conflate layout and presentation are killed.
- Decision: structure/layout owns target geometry and one semantic layout algorithm. Presentation may
  associate a transition policy with the compiler-issued geometry target. The adapter lowers the two
  domains separately and joins them only in the retained layout transaction.
- Falsification condition: reopen if a frozen corpus case requires a preset to change semantic child
  order or accessibility hierarchy. A visually different arrangement must remain layout meaning, not
  an untyped presentation override.

## D-054: A Layout Transaction Has One Stable Coordinate Root And An Atomic Participant Set

- Date: 2026-07-12
- Status: proposed
- Question: What must a retained web layout adapter capture so a local responsive change can interrupt,
  reverse, and settle without jumps?
- Alternatives: animate each child independently; use the changing container as the projection root;
  capture one stable coordinate root and the complete affected participant set before mutation.
- Evidence: using the changing region as the Anime Layout root produced root displacement and an
  incorrect initial child direction. Registering `document.body` as the stable coordinate root and the
  region plus both children as one participant set produced monotonic wide-to-compact movement,
  continuous mid-flight reversal, and cleared projection styles at settlement. A separate production
  defect animated a two-value `translate` shorthand through one scalar controller, broadcasting inline
  motion onto the block axis; independent logical-axis custom properties removed the loop. Fast tests
  fix grouped participant updates and independent axis composition.
- Decision: every layout transition captures one stable coordinate space and all identities whose
  presented geometry can change in that transaction. Logical axes remain independent channels even
  when the platform serializes them into one property.
- Falsification condition: reopen if nested or transformed coordinate spaces cannot be represented by
  explicit nested transactions. Do not silently infer an unstable root from the first animated node.

## D-055: Compatible Hot Refresh Retains Adapter-Owned Presentation Channels

- Date: 2026-07-12
- Status: proposed
- Question: Should compatible presentation refresh dispose and reconstruct active motion, layout, and
  presence channels?
- Alternatives: remount everything; snapshot then reconstruct every controller; retain compatible
  adapter-owned channels and dispose only removed channels plus module-owned tasks and gestures.
- Evidence: the hot-refresh resolver derives target identity from the canonical presentation
  transaction, including policy-only geometry. Its retained samples preserve scalar or layout value,
  velocity, and presence phase. The executor captures first, disposes removed motion and all old
  task/gesture closures, then rebinds presentation without remounting compatible structure. Mutations
  that drop geometry, reset velocity or phase, retain removed work, leave old controllers alive,
  reorder disposal/rebind, or dispose a compatible channel are all killed. Direct browser preset
  replacement during an active layout transition retained the same semantic nodes and continuous
  projected geometry.
- Decision: an adapter-owned channel is independent of refreshed module closures and remains live when
  its semantic contract and target identity are compatible. Module-owned tasks and recognizers are
  revision-scoped and must be rebound after disposal. An incompatible semantic contract remounts.
- Falsification condition: reopen if a backend channel captures author-module code after compilation.
  That is an adapter ownership defect; otherwise add an explicit compatibility field rather than
  disposing every channel.

## D-056: Fresh Motion Declares Its Initial Presentation In The Target Transaction

- Date: 2026-07-12
- Status: proposed
- Question: How does a newly presented identity start away from its endpoint without requiring an
  author to issue and flush an imperative direct write first?
- Alternatives: document `direct` then `flush` ordering; manufacture a separate entry controller;
  allow a retained target transaction to declare its fresh `from` sample and optional velocity.
- Evidence: the stress drawer initially appeared instantly because same-frame target coalescing replaced
  its pending direct write. The new target option writes `from` and retargets inside one graph flush.
  A backend test proves one scheduled transaction, exact initial write, zero default velocity, and one
  settlement. The browser retained trace records a compact sheet from `447` through a physical spring
  to `0` and backdrop from `0` to `1`.
- Decision: direct manipulation remains a stream driver; fresh presence uses one target transaction with
  an explicit initial sample. The adapter owns ordering and must not derive artificial velocity from
  installing that sample.
- Falsification condition: reopen if a multi-target presence transaction cannot install every fresh
  sample before any target begins. That requires an atomic graph batch, not author-managed flushes.

## D-057: Insets, Size Constraints, Flow Participation, And Anchoring Are Layout Meaning

- Date: 2026-07-12
- Status: superseded in part by D-061
- Question: Can the candidate reproduce polished controls, drawers, forms, and navigation without raw
  CSS for padding, logical bounds, flexible participation, or anchored placement?
- Alternatives: treat these as adapter CSS; add named container recipes; add four generic layout
  relations with deterministic validation and logical lowering.
- Evidence: translating the security-drawer stress case was impossible with only flow/grid/overlay and
  aspect relations. The new relations recur independently in C01, C03, C04, C05, C06, and C15.
  Normalization rejects duplicate owners, descending bounds, invalid lengths, and participation without
  one flow parent. Web lowering emits logical insets, min/ideal/max sizes, available-space sizing,
  grow/shrink/basis, a zero intrinsic shrink floor, and viewport-relative placement. Seven new
  mutants are killed, bringing the campaign to 312/312.
- Decision: these are generic layout meanings, not components or convenience recipes. D-061 later
  generalized viewport placement into one viewport-or-local anchor relation. Presets may select values
  and arrangement algorithms while semantic hierarchy and accessibility remain unchanged.
- Falsification condition: reject or revise a relation if independent author study cannot predict its
  proposal/constraint behavior without knowing CSS flexbox or positioned-layout defaults.

## D-059: Structural Choice Reconciles As One Retained Native Transaction

- Date: 2026-07-12
- Status: proposed
- Question: How does a conditional semantic branch change without a virtual DOM, survivor remounts,
  inaccessible retained exits, or stale reversal deletion?
- Alternatives: remount the component; let each platform diff arbitrary authored trees; classify one
  normalized transaction and let a thin adapter execute it over native identities.
- Evidence: independent reference and candidate planners agree on surviving, entering, moving, and
  exiting identities, entering/exiting subtree roots, content updates, and target child order. Only an
  exiting subtree root can own visual retention. A surviving identity cannot change native element,
  role, or action contract. The web proof adapter moves/reuses survivors, creates only entrants,
  releases outgoing listeners and accessibility synchronously, retains only presentation, updates
  indexed text nodes, rejects stale settlement, and restores the retained subtree on interruption.
  Direct in-app-browser double-click reversal retained native instance `6` as instance `6`, reported
  `reversed: ["ReconcileLab.Detail"]`, and produced no console warnings or errors. Compiler-known
  departing-branch ownership also recovered browser focus from `DefaultAction` to `DetailAction` and
  back without parsing ids. Nine dedicated lifecycle mutants are killed; the campaign passed 343/343
  after the exhaustive-selection and anchoring additions in D-060 and D-061.
- Corpus examples: C01, C03, C04, C05, C09, C10, C15, C17.
- Laws affected: semantic identity, structural selection, presence, focus release, disposal, reversal.
- Cognitive dimensions affected: authors state one selection and one local retention policy; there is no
  authored reconciliation callback or keyframe lifecycle.
- Runtime consequences: normalized structure is the diff input; native nodes and text slots are the
  retained state. Platform-specific visual extraction is an adapter hook, not authored meaning.
- Accessibility consequences: an exiting visual subtree becomes hidden, inert, and listener-free in
  the same transaction that activates the incoming semantic branch.
- Decision: structural selection and visual retention join in one revisioned reconciliation transaction.
  Semantic absence is immediate; visual removal is settlement-owned and reversible.
- Falsification condition: reopen if nested independently retained exits, focus recovery, or a real
  multi-view reference cannot preserve these laws without exposing platform orchestration.

## D-058: Image Source And Alternative Intent Belong To Semantic Structure

- Date: 2026-07-12
- Status: proposed
- Question: How does structure declare image content without leaking a web attribute bag or asking a
  preset to own accessibility meaning?
- Alternatives: treat images as painted generated layers; pass `src` and `alt` through arbitrary
  native properties; infer decoration from an empty string; declare one typed image meaning.
- Evidence: the external Family reference requires semantic image nodes while the existing candidate
  could only style already-created media. Candidate structure now requires one source and exactly one
  tagged alternative policy. Informative alternatives lower to native `alt`; decorative intent lowers
  to empty `alt` plus hidden accessibility semantics. Empty sources, missing alternatives, duplicate
  naming, and media fields on non-image roles fail before mounting. Three dedicated mutants are killed,
  bringing the semantic campaign to 315/315.
- Corpus examples: C01, C03, C05, C06, C09, C15.
- Laws affected: semantic ownership, accessible naming, platform lowering, reactive source updates.
- Cognitive dimensions affected: removes magic empty strings and makes alternative ownership visible.
- Runtime consequences: source and alternative changes are fine-grained native attributes and do not
  replace semantic identity.
- Accessibility consequences: decorative and informative images cannot silently collapse into the
  same author syntax.
- Decision: image content is a typed structure concern; visual fit, clipping, material, shape, and
  motion remain preset concerns.
- Falsification condition: reopen if responsive media selection or future media kinds require a
  general semantic source model that cannot extend this contract without a second path.

## D-060: Finite Structure Uses One Exhaustive Generic-Driven Selection

- Date: 2026-07-12
- Status: proposed
- Question: Can one binary structural choice represent optional content, responsive alternatives, and
  a four-view component without nested branch topology, duplicated fallback logic, or incomplete focus
  recovery?
- Alternatives: retain binary `choose`; add a second multi-view switch; use one finite `select<Value>`
  whose case map is exhaustive over the explicit generic parameter.
- Evidence: translating the four-view Family reference exposed that nested binary choices obscure the
  active view and can only attach focus recovery to intermediate booleans. The replacement accepts one
  string union or boolean value and requires every generic member exactly once. Its four-way fixture
  materializes only the selected semantic case, records every dormant case as departing ownership,
  rejects an unknown runtime value, and requires focus on every case or none. Direct browser proof
  moves focus `DefaultAction -> DetailAction -> DefaultAction`; rapid reversal retains native instance
  `9`, exposes only the active branch, and logs no warning or error. Five selection failure classes are
  protected inside the 330/330 mutation campaign; the focused suite passes 152 tests.
- Corpus examples: C01, C03, C05, C06, C09, C10, C11, C15, C17.
- Laws affected: generic-driven exhaustiveness, semantic identity, focus recovery, structural absence,
  retained reversal, deterministic failure.
- Cognitive dimensions affected: a finite application state appears once as a finite case table;
  authors do not invent nested booleans or a default branch that hides a newly added union member.
- Runtime consequences: the compiler retains all case identities but normalizes one active case. The
  reconciler receives complete departing ownership and the adapter still executes one revisioned native
  transaction. Value-expression `choose` remains a separate scalar operation and cannot create nodes.
- Accessibility consequences: dormant cases leave the semantic tree immediately. Focus recovery is an
  all-cases contract, so a view cannot silently omit a lawful destination while another view declares
  one.
- Decision: structural hierarchy has one `select<Value>(value, cases)` operation driven by an explicit
  finite generic. Boolean optionality uses explicit `true` and `false` cases, with `null` content when
  absent. Unknown values fail. Do not add binary hierarchy choice, default cases, or switch wrappers.
- Falsification condition: reopen if a corpus case requires open-ended runtime plugin states whose
  finite semantic alternatives cannot be declared at the component boundary. That case needs a typed
  collection or component slot, not a silent default branch.

## D-061: Anchoring Is One Relation Over A Viewport Or Local Containing Identity

- Date: 2026-07-12
- Status: proposed
- Question: How does a visual child attach to a logical edge independently from content flow without
  leaking CSS positioning or adding a one-off close-button primitive?
- Alternatives: raw absolute styles; shared-alignment overlay plus spacer geometry; separate viewport
  placement and local placement operations; one `anchor(identity, anchor, placement)` relation.
- Evidence: the exact Family source anchors its close control at the surface's block-start/inline-end
  while the content determines surface height. The previous viewport-only operation could not express
  that relationship, and shared overlay alignment would move every overlaid child together. The
  generalized relation accepts either `viewport` or a compiler-issued local identity, uses logical
  axes and insets, records the local layout parent, rejects self-anchors and competing ownership, and
  lowers to the correct fixed or local containing-block strategy. Adapter tests fix both outputs; four
  anchoring failure classes are protected inside the 343/343 mutation campaign. Independent pressure
  also comes from badges, floating controls, tooltips, generated separators, and overlay chrome in
  C02, C03, C04, C05, C09, C13, C15, and C17.
- Laws affected: layout ownership, logical direction, containment, deterministic lowering,
  composition locality.
- Cognitive dimensions affected: authors state what is anchored, to which identity, and at which
  logical edge. They do not choose `fixed` versus `absolute` or manufacture spacer children.
- Runtime consequences: the adapter selects viewport-fixed or local-contained placement. Local
  anchoring establishes the same parent edge used by cycle and duplicate-owner validation.
- Accessibility consequences: anchoring changes visual placement only; semantic order remains the
  structure order and cannot be rewritten by the preset.
- Decision: replace viewport-only placement with one semantic anchor relation. Keep grid track
  placement separate because it participates in track allocation rather than leaving flow.
- Falsification condition: reopen if transformed containing spaces or collision-aware floating
  content require additional authored meaning. Extend anchor policy only with those meanings; do not
  expose platform position modes.

## D-062: Layout Projection Cannot Own Or Restore Preset Visual Channels

- Date: 2026-07-12
- Status: proposed
- Question: May a layout engine capture opacity, color, fill, border, filter, or clipping when those
  channels are independently owned by preset motion?
- Alternatives: let Anime Layout animate its default visual set; serialize layout and content motion;
  restrict the layout adapter to measured geometry and projection channels.
- Evidence: the Family key view's retained opacity spring sampled through `1`, but Anime Layout cleanup
  restored its earlier inline opacity `0`, leaving all content invisible. Anime Layout includes opacity,
  color, background, border, radius, filter, and clip path in its default recorded properties even when
  the adapter passes an empty `properties` array. The adapter now removes those channels from both its
  animation and restoration sets while retaining display, position, dimensions, and projection
  ownership. A focused production test fixes the ownership boundary, a dedicated mutation is killed,
  and direct browser layout-plus-content completion leaves opacity and scale at `1`.
- Corpus examples: C01, C02, C03, C04, C09, C10, C15, C17.
- Laws affected: one target owner, concurrent transaction composition, settlement, locality.
- Cognitive dimensions affected: authors can coordinate layout and content motion without knowing one
  backend's default property list or sequencing animations to avoid clobbering.
- Runtime consequences: the layout backend owns geometry and projection only. Preset channels remain
  live and may update concurrently; cleanup cannot restore their stale inline samples.
- Accessibility consequences: none directly; preventing stale opacity avoids visually hidden content
  that remains semantically present.
- Decision: restrict Anime Layout ownership at adapter construction. Do not serialize independent
  channels as a workaround.
- Falsification condition: reopen only if an authored layout transaction explicitly assigns a visual
  target to layout ownership; that must be represented as one owner in IR, not inferred from engine
  defaults.

## D-063: External Reference Translation Is A Falsification Gate, Not A Demo Exception

- Date: 2026-07-12
- Status: proposed
- Question: Can Candidate B reproduce the supplied four-view Family drawer without raw component CSS,
  a virtual DOM, or reference-specific public primitives?
- Alternatives: keep the existing abstract stress drawer; copy source CSS into a fixture; translate the
  reference through semantic structure, visual targets, layout relations, generated layers, retained
  transitions, and a thin web adapter.
- Evidence: the executable translation uses the supplied SVG sources, one exhaustive `FamilyView`
  selection, native dialog semantics, local anchoring, generated backdrop/separators, logical flow and
  grid, typed OKLCH paint/type/media values, retained content and surface springs, layout projection,
  and candidate drag recognition. Default surface and action geometry match the production reference
  at `361 x 290` and `313 x 48`. The key detail and actions match at `361 x 459.3984375` and
  `148.5 x 48`; independent pixel fidelity is not claimed. The translation found the anchoring, hidden-precedence,
  layout-channel ownership, hit-test composition, reversal-retarget, and hidden-reset defects recorded
  above. A clean browser pass completes open, multi-view reversal, spring-back, velocity dismissal,
  focus return, and settlement without warning or error.
- Corpus examples: C01, C03, C04, C09, C10, C15, C17.
- Laws affected: expressiveness, one-way lowering, native semantics, visual ownership, lifecycle,
  direct manipulation, adapter equivalence.
- Cognitive dimensions affected: the reference is described through general meanings, but the fixture
  still contains too much adapter orchestration to count as an author-usability pass.
- Runtime consequences: all backend-specific scheduling remains in the fixture adapter. The same
  orchestration must become compiler/runtime-owned only after selection.
- Accessibility consequences: one modal exists; dormant views leave the semantic tree immediately;
  focus recovers per selected case and returns to the trigger on dismiss.
- Decision: keep the translation as a required acceptance artifact and preserve every defect it finds
  as a conformance rule. It is possibility evidence, not selection or author-usability evidence.
- Falsification condition: Candidate B fails if exact reference comparison requires raw CSS, direct
  engine access, or a primitive useful only to Family after all general semantic pressure is exhausted.

## D-064: One Web-Scene Lowering Owns Cross-Domain Precedence

- Date: 2026-07-12
- Status: proposed
- Question: Should a web fixture or component apply structure, layout, and presentation output in an
  author-chosen order?
- Alternatives: keep three independent application loops; encode precedence in every fixture; lower
  the three semantic domains into one deterministic web-scene instruction.
- Evidence: the Family translation applied semantic `hidden` before inline layout. Authored `display`
  then resurrected a dormant branch for one frame. `lowerCandidateWebSceneToStyle` now merges typed
  presentation and logical layout, rejects conflicting ownership, and applies semantic participation
  last. Visible nodes recover their declared layout display. The Family adapter no longer contains a
  hidden/display workaround. Fast adapter and mutation tests detect both lost precedence and lost
  reversal classification; the browser completes rapid retained reversal with the same node at
  `display: flex`, opacity `1`, and correct focus.
- The same unified lowerer removes pointer participation from generated visual layers. This replaces
  a fixture-only backdrop override and prevents decorative separators from becoming accidental input
  targets.
- Corpus examples: C01, C02, C04, C09, C10, C15, C17.
- Laws affected: deterministic lowering, semantic participation, one target owner, retained reversal.
- Cognitive dimensions affected: neither authors nor fixture implementers need to know CSS cascade
  precedence or infer lifecycle meaning from several transaction arrays.
- Runtime consequences: one adapter stage emits final per-node declarations. Structural reconciliation
  also exposes deterministic enter, exit-revision, and reversal commands for preset-owned motion.
- Accessibility consequences: a hidden semantic branch cannot be made visually present by layout;
  retained reversal restores semantics and presentation as one classified transaction.
- Decision: make cross-domain precedence and presence-command classification adapter responsibilities.
  Keep structure, layout, and presentation as separate semantic domains before lowering.
- Falsification condition: reopen if a platform requires a participation state that cannot be represented
  without changing semantic meaning; do not restore fixture-specific ordering.

## D-065: Native Modality Carries A Complete Focus Contract

- Date: 2026-07-12
- Status: proposed
- Question: Is calling native `showModal`, `close`, and `.focus()` from component orchestration a
  sufficient modal abstraction?
- Alternatives: trust browser focus restoration; focus imperatively in each component; declare modal
  identity, initial focus, and return focus as one structural contract and make the adapter own its
  entire revision.
- Evidence: the Family fixture initially focused its trigger during dismiss, but native closure later
  moved focus to `body` when the retained dialog became hidden. The normalized scene now requires one
  focusable modal descendant for entry and one focusable external control that explicitly controls the
  modal for return. The web reconciliation port activates and deactivates native modality through those
  destinations, retains an unresolved return obligation through visual exit, fulfills it only if focus
  falls outside the semantic tree, and cancels it on reopen. Fast reference and adapter tests cover
  invalid ownership, activation, deactivation, delayed hide, and reversal; five dedicated mutants are
  killed. A trusted-pointer browser replay leaves focus on `Family.Trigger` after velocity dismissal
  and final hide, while interrupted exit finishes open with focus on `Family.Close`.
- Corpus examples: C01, C02, C04, C09, C10, C17.
- Laws affected: modality, semantic participation, presence, revision safety, focus restoration.
- Cognitive dimensions affected: modal focus behavior is visible in one structural declaration rather
  than split across event handlers, animation completion, and browser defaults.
- Runtime consequences: native top-layer activation, initial focus, release, and return focus are one
  adapter transaction. Visual exit remains preset-owned and may outlive native modality.
- Accessibility consequences: every modal has deterministic entry and return focus; retained hidden
  surfaces cannot strand focus or clear it after a correct immediate return.
- Decision: require a complete active-modal focus contract. Do not expose platform calls or permit a
  modal with implicit entry or return focus.
- Falsification condition: reopen for nested platform overlays only if one modal-chain contract cannot
  state every lawful destination; preserve the same per-layer invariant.

## D-066: Parts Own Native Attachments; Machines Own Modes; Signals Own Samples

- Date: 2026-07-13
- Status: proposed
- Question: Can one component definition connect native platform behavior, an XState-backed machine,
  fine-grained values, and preset-owned presentation without a second binding or gesture language?
- Alternatives: component-level mount callbacks; declarative gesture schemas; send every pointer sample
  through XState; keep all values derived and hide native elements; place Anime orchestration in presets.
- Evidence: the Visual Lab Family Drawer now uses `Part.attach(element => cleanup)` for a
  `ResizeObserver` and one Anime `Draggable`, native JSX props for dialog cancellation and backdrop
  input, and the existing reactive native-dialog binding for modality, focus, and retained exit.
  Parallel statechart regions own view and gesture modes. Alien Signals own only offset, velocity,
  progress, and measured height. Both presets read the same machine states and values while choosing
  different geometry and springs. A mobile browser trace follows the pointer at the exact sampled
  offset, then produces a continuous retained spring from `110` to `700`; short drags spring back and
  repeated drags remain live. Native Escape returns focus, desktop hides the drag handle, production
  compilation succeeds, and hot refresh retains the selected detail view with one dialog and one
  surface. A rapid-input audit then found an impossible `:modal + inert + aria-hidden` state: the
  dialog adapter and visual settlement both wrote accessibility state, and stale exit restoration
  overwrote a newer reopen. Visual settlement no longer writes semantic attributes. Twelve rapid
  presses now settle closed and thirteen settle in a live modal with no stale accessibility state.
- Corpus examples: C01, C04, C09, C10, C15, C17.
- Laws affected: one-way lowering, platform honesty, direct manipulation, one target owner, lifecycle,
  preset ownership, fine-grained reactivity.
- Cognitive dimensions affected: native integration is local to the Part it owns; discrete and
  continuous state have distinct ownership; visual code receives both without owning behavior.
- Runtime consequences: Part attachments run after commit, clean up in reverse order, and do not
  rerender JSX. A generic-only `Writable<T>` marker grants structure write access only to declared
  continuous values; derived values remain read-only. Presets always receive read-only symbolic
  expressions. Motion velocity stays in authored units per millisecond and is normalized only at the
  Anime spring boundary.
- Accessibility consequences: modality remains a web-adapter responsibility rather than hand-written
  `showModal`/`close` calls that race retained exit accessibility. Native listeners remain available in
  structure JSX. The visual runtime is statically forbidden from owning `inert` or `aria-hidden`.
- Decision: keep this split for the production candidate. Rename the generic contract from `Actions`
  to `Events` and expose only typed `send` functions; the existing `actions` render alias is misleading
  because XState actions are transition effects. Do not introduce a gesture DSL. Keep direct Anime
  setup available through Part attachments, and add a helper only if several real components repeat
  the same lifecycle mechanics without changing their meaning.
- Falsification condition: reject the split if a real component requires continuous samples in the
  statechart, preset code to send semantic events, structure code to author visual trajectories, or an
  attachment whose lifetime cannot follow a concrete Part.

## Template

```text
Decision:
Date:
Status: proposed | accepted | rejected | superseded
Question:
Alternatives:
Evidence:
Corpus examples:
Laws affected:
Cognitive dimensions affected:
Runtime consequences:
Accessibility consequences:
Decision:
Falsification condition:
```
