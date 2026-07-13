# UI Language Completion Audit

## Status

- Date: 2026-07-12
- Selection: not authorized
- Production migration: not authorized
- Candidate: semantic operations, under falsification

This audit maps every remaining plan gate to the evidence that would actually close it. A narrative
translation is not executable proof, a production test for the old language is not candidate proof,
and maintainer review is not independent usability evidence.

## Proven Slices

| Requirement                         | Current evidence                                 | Scope                                                             |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| Typed token aliases and modes       | reference/property tests                         | backend-independent semantics                                     |
| One target owner                    | reference, candidate, and mutation tests         | scalar and derived geometry targets                               |
| Reactive conditions                 | candidate active-branch test and type fixtures   | `read` and `choose` slice                                         |
| Preset-local tokens and themes      | generic-driven type fixture                      | names, full base values, partial overrides                        |
| Recipes                             | candidate composition and conflict tests         | explicit typed arguments, no precedence                           |
| Composition                         | candidate graph and mutation tests               | order, clip, hit test, match, isolation, native layer             |
| Layout                              | candidate graph and mutation tests               | flow, grid validation, overlay, scroll, intrinsic, virtual extent |
| Direct manipulation                 | reference/property and candidate ownership tests | direct owner, settlement, direction, velocity declaration         |
| Presence                            | reference and production model tests             | reversal, retention, disposal                                     |
| Accessibility structure             | reference and browser baseline                   | hierarchy, names, role states, modality, focus ownership          |
| Adapter strategy                    | fake differential tests                          | scalar endpoints, relationships, retained retargeting             |
| Current runtime regression baseline | full repository and direct browser checks        | old production language only                                      |

## Unproven Semantic Slices

### Expression completeness

The candidate now materializes reads, choice, structural equality, short-circuit boolean composition,
and one typed scalar/length/angle/time algebra for addition, scaling, ordering, dimensional
normalization, and explicitly clamped interpolation. Normalization turns a kind-derived measure into a
typed scalar progress without leaking backend math; it rejects dimension mismatch and zero extent, and
requires explicit clamping. Generic inference rejects mixed dimensions and runtime validation rejects
malformed generated values, with mutation evidence. OKLCH interpolation matches the reference shorter-hue and
premultiplied-alpha law. Transform rotation now uses axis-angle author values and a normalized
quaternion-Slerp law in both reference and candidate evaluation. Translation, scale, and origin are
component-wise; perspective uses continuous reciprocal depth, including `none`. Final value-type
inventory review remains required.

### Transition transactions

The reference classifies spring-to-spring velocity preservation, direct-to-spring handoff, timing
replacement, incompatible value/policy replacement, layout projection, and reduced-motion endpoint
equivalence. Candidate policy definitions are now materialized as backend-independent drivers with
reduced-motion substitution. A retained fake-adapter differential now covers direct spring, timing
replacement, and reduced settlement. The reference now derives multi-target preset, theme,
environment, geometry, semantic, and reduced-motion updates from one presented-value snapshot. It
validates every channel before producing a plan, stamps one revision and epoch, preserves compatible
spring velocity, replaces incompatible timing velocity, settles active channels when reduced motion
turns on, and does not resurrect settled motion when it turns off. Candidate normalization
materializes one sorted transaction target set. The retained candidate adapter now independently
derives policy-only, preset/theme, and reduced-motion updates, does not restart unchanged channels,
and agrees with the reference handoff results. The layout reference now retargets from presented
geometry, preserves compatible position and log-size velocity, resets timing velocity, and settles to
identity under reduced motion. An independent formula adapter agrees across 1,000 generated
interruption, resize, parent-swap, driver, and reduced-motion traces. Production scheduling and browser
projection proof remain open.

Visual endpoint compatibility is a separate atomic preflight rather than an attempt to treat a paint,
path, or type style as one scalar physics coordinate. Reference and candidate batches validate every
endpoint and reject the entire batch for duplicate targets, incompatible interpolation topology, or a
stroke/material presence change before temporal handoff starts. Layout geometry remains excluded from
generic value interpolation and uses its retained projection law.

Candidate hot refresh now derives a canonical compatibility contract from behavior topology,
semantic identities/roles/actions, and recognizer topology. Presentation and layout changes preserve
context, state, surviving presence, and presented samples for visual targets present on both sides,
without semantic remount. Old motion, task, and gesture controllers are deduplicated and disposed even
on a compatible refresh so stale module closures cannot survive. Contract changes replace the
component and retain none of that live state. Current production preset HMR preserves an open detail
view and focus through a compiled token change and restoration; selected-candidate module wiring
remains open until migration is authorized.

### Presence materialization

Part-local presence binds one identity to a finite set of local transitioned targets. The reference
coordinator releases interaction and accessibility at exit start, awaits every target before unmount,
rejects stale settlements after reversal, and disposes once. Candidate IR fixes those policies and an
independent adapter passes the multi-target reversal trace. Production lowering remains required.
Preset sequence remains rejected: meaningful stages are statechart behavior, while visual choreography
derives from shared progress.

Nested overlay close now derives a child-first cascade from semantic overlay ancestry. Reference and
candidate coordinators permit only the current top descendant to settle, advance to the parent after
child completion, restore the affected chain outer-to-inner on reversal, and issue a new revision so
abandoned settlements are stale. The existing per-identity presence law supplies immediate
interaction/accessibility release and visual settlement. Production native-layer orchestration
remains open.

### Layout completeness

Grid placement, sticky relationships, and aspect constraints are materialized with unique ownership,
track bounds, and scroll-subtree validation. Keyed virtual measurement revisions ignore stale commits,
preserve retained measurements through reorder, and use estimates only for unknown extents; candidate
IR fixes that policy. Stable-identity parent swaps expose resolved parent maps, preserve destination
geometry, and pass an independent-formula/reference adapter differential. Production web lowering,
real scroll anchoring, and browser projection remain open.

Font, media, content, and container observations now enter one revisioned intrinsic-measurement
transaction. Reference and independently implemented candidate adapters reject stale and nonpositive
batches, validate before commit, sort changed identities, omit unchanged measurements, and mark the
result as geometry-only with no semantic or presence change. Changed geometry feeds the existing
presented-value layout retarget law. Production observers and font/media browser acceptance remain
open.

### Gesture completeness

The reference covers release resolution, pairwise arbitration, and revision-scoped pointer capture.
Candidate IR fixes acquisition on recognition, release on every terminal lifecycle event, and stale
callback rejection. Reference laws now separate raw input from rubber-band presentation and select a
finite snap outcome from velocity projection with deterministic ties. Candidate parameter association
and adapter proof remain. Geometry changes rebase raw value and velocity through normalized progress;
an unavailable responsive recognizer cancels. Nested scrolling wins until its declared boundary and
still wins inward movement. Revision-scoped capture/loss/stale-callback behavior passes an independent
adapter differential. Candidate settlement now associates distinct generic-driven projection-time and
resistance parameters; cross-IR validation enforces presence and semantic bounds. Recognizer kind,
kind-specific activation, semantic part region, exhaustive legal outcomes, declared action mappings,
accessible alternatives, and pairwise precedence/simultaneity now derive from the explicit generic
contract and normalize to canonical IR. Arbitration is scoped to recognizers sharing one region and
distinguishes simultaneity, explicit exclusive tie preference, and directional failure dependency;
implicit conflicts, cross-region edges, duplicate pairs, and cycles fail. A pure web-adapter spike now
derives logical-axis `touch-action`, handles confirmed/coalesced samples, excludes predictions from
semantic state, recognizes drag/pan/pinch/rotate, balances capture, and passes 1,000 generated traces.
Native-scroll boundary ownership is now structure-authored and candidate-normalized; the pure adapter
yields away from the boundary and for inward movement, transferring only outward movement at the
declared boundary. Gesture samples are discriminated by recognizer meaning rather than exposing one
field soup. Same-axis browser delivery, production DOM lowering, and browser acceptance remain open.
Hover/focus/pressed remain interaction facts. Reference laws cover hover intent and long press. Their
generic-driven candidate declarations now derive kind-specific presentation channels, require focus
equivalence or an action alternative, validate safe-polygon handoff ownership, and preserve explicit
typed direct-manipulation projections in canonical IR. Production adapter lowering remains unproven.
Independent test adapters now agree on dwell, delayed leave, immediate focus equivalence, corridor
retention, long-press progress, recognition, release, movement cancellation, and stale cancellation.

### Interaction completeness

The candidate no longer exposes one component-wide interaction bag. Raw hover and focus-within are
part-local; focusable controls additionally expose pressed and focus-visible. Semantic
disabled/selected/expanded state and named gesture activity remain in their own domains. The reference
hover-intent coordinator proves dwell/speed gating, delayed leave, and immediate focus-equivalent
engagement. The reference long-press coordinator proves virtual-time progress, movement cancellation,
exactly-once recognition, and terminal commitment. Candidate declaration syntax, floating-content safe
geometry, production lowering, and browser acceptance remain open.

Edge auto-scroll now has a backend-independent logical-axis law and an independent candidate adapter.
Edge proximity produces a monotonic quadratic velocity bounded by a preset parameter, scroll bounds
clamp the applied delta, and that exact delta rebases the active recognizer. Revision-scoped
start/step/stop/dispose rejects stale frames. Candidate normalization requires a drag/pan on one axis,
a declared scroll owner, and generic-declared edge/speed parameters; cross-domain validation requires
the owner to be a compatible scroll container. Production scheduling and browser acceptance remain
open.

Adjustable controls now expose one complete semantic range containing current value, minimum, maximum,
step, and large step. Reference and independent candidate resolvers clamp and quantize pointer,
keyboard, and programmatic proposals through the same law. Exact endpoints remain reachable when the
interior step lattice does not divide the range, invalid or descending ranges fail, and structure
normalization emits the same facts needed for native accessibility. Continuous drag presentation does
not gain a second semantic value owner. Production native slider/dial lowering remains open.

### Visual value and applicability algebra

Typed OKLCH paint/gradients, logical length, shape/path, stroke, shadow, material, typography, media
fitting, transform, geometry, and opacity are represented with domain validation. Every visual value
now has an explicit continuous, topology-conditional, retained-geometry, discrete, or
capability-scoped resolution in `interpolation-matrix.md`. Paint, shape/path, stroke, shadow stacks,
material, type style, media fit, and transform have independent reference/candidate differential
tests; typed gradient angles, coordinate semantics, list topology, text semantics, and discrete kind
changes fail before motion starts. Masks and structure-issued focus/text-entry capabilities are
represented; native focus fallback in forced colors has a reference law and mutation proof.
Selection/caret lowering, general forced-color substitution, HDR gamut policy, production adapter
lowering, and independent author validation remain required. Adding a CSS-shaped property inventory
would still fail the objective.

Normalized target scenes now retain a concrete visual value type. The pure web lowering proof chooses
stylesheet output for static values, a fine-grained reactive property for expression values, and a
retained motion channel for transitioned values. Conflicting types, unknown types, and malformed
addresses fail before runtime. The candidate still serializes presentation addresses as canonical
keys for deterministic maps and diagnostics, but the IR and final web instruction retain the
normative structured `{ identity, property }` reference, which adapter execution consumes directly.
A matching execution proof routes static, expression-reactive, and retained targets to separate
platform operations and disposes those channels once in reverse ownership order.
The first strict value-encoding slice exposed and corrected an overloaded paint gap: structure-owned
parts now distinguish surface `fill` from `foreground` paint, so a control can style its surface and
text/current-color content independently without adapter inference. Exact OKLCH, capsule, shadow,
typography, media-fit, transform, opacity, and logical block-size mappings have fast evidence.
The node-level static pass now composes material tint over surface fill with backdrop blur and
saturation. Direct browser acceptance caught an invalid two-color background shorthand; solid tint is
now encoded as a constant gradient layer so the browser retains both paints. Continuous corners,
scalable paths, non-inside strokes, generated material noise, and retained material transitions fail
explicitly or remain adapter requirements.
The real Anime retained scalar path now initializes its hidden controller from the graph's retained
model value rather than zero. Browser sampling proves forward spring motion, overshoot, settlement,
and mid-flight preset retargeting without static cleanup clearing the retained property. This closes a
scalar initialization defect, not complete presence/layout/gesture browser acceptance.
The node-level instruction now annotates every synthesized declaration with its authoritative
stylesheet, reactive, or retained execution strategy and source targets. Composite declarations take
the strongest source strategy, so static cleanup cannot own a retained material/fill output. Initial
mount creates retained channels at the resolved endpoint rather than manufacturing a direct sample.
The thin pointer port now applies normalized touch-action, confirmed/coalesced packets,
presentation-only predictions, recognition-time capture, terminal release, and disposal cancellation
to real web nodes. Direct browser drag, velocity dismissal, spring-back, and repeated activation pass.
Fast tests retain multipointer arbitration, scroll-boundary competition, capture loss, and generated
traces.

Native dialog exit now separates semantic openness from retained mounting. At exit start the adapter
captures geometry, closes the top layer, drops modality, hit testing, and accessibility, returns
focus, and keeps the same closed node fixed for visual settlement. Reversal reopens that identity and
replaces the stale exit. A generated, accessibility-inert backdrop retains explicit dialog ownership
through normalization and final web lowering. Native and generated paints match; the generated layer
is installed before `close()` and settles with surface translation under one revision. Fast reference,
adapter, and mutation gates cover multi-target settlement, metadata preservation, conflicting owners,
and stale reversal; direct browser traces cover handoff, click-through, repeated drag, and one-node
reversal.

Policy-only layout geometry now survives canonical transaction lowering without pretending that a
preset owns its value. Logical flow/grid/overlay/scroll/intrinsic relations lower independently from
transition policy. The production Anime Layout adapter captures one stable coordinate root and an
atomic participant set; direct browser traces cover local container reflow, continuous interruption,
same-node reversal, and cleanup. Independent logical translation axes replace the previous scalar
animation of a two-value shorthand. Compatible presentation refresh retains adapter-owned scalar and
layout channels, including value, velocity, and presence phase, while removed channels and old
module-owned tasks/gestures dispose before rebind. Fast differential and mutation evidence covers both
domains. Actual bundler module replacement and nested/transformed coordinate-space acceptance remain
open.

The stress translation added generic insets, logical size constraints, flow participation, and
anchoring only after multiple corpus cases proved the pressure. One anchor relation now covers both
viewport placement and per-child local placement; it replaced the viewport-only special case after
the external Family reference required a close control anchored independently from content flow. The
same native security drawer now renders as a monochrome stack, an editorial three-column grid, and a tactile material stack;
the presets differ in arrangement algorithm, geometry, typography, paint, material, and spring policy
without replacing semantic nodes. Fine-grained interaction paint updates one option. A separate
executable Candidate B translation uses the supplied Family assets and four-view hierarchy. Its
default surface and actions match the production reference geometry; its key detail surface and
actions now also match at `361 x 459.3984375` and `148.5 x 48`. It exercises exhaustive selection, local anchoring,
generated separators/backdrop, layout projection, content springs, reversal, focus recovery, and drag
dismissal. Fresh presence motion now carries an explicit initial sample in one target transaction, eliminating the hidden
`direct`/flush ordering that made entry instant. Direct browser traces prove compact sheet and backdrop
spring trajectories. The active modal now declares initial and return focus as one structural
contract; the adapter preserves its return obligation through retained exit and cancels it on reopen.
Independent visual and author review remain required before this can pass Gate 5.

Shared-identity geometry, crossfade, presence, and interruption now compose without a crossfade
primitive: `match` pairs source/destination geometry, each identity owns its local opacity target, one
derived transaction changes both, and source-local presence waits for its own settlement. The
combined trace preserves midpoint velocity during reversal, rejects stale exit settlement, and keeps
semantic participation separate from retained presentation. Production matched-geometry lowering
remains open.

### Structure completeness

Candidate normalization now retains native platform kind rather than only semantic role. A pure web
lowering proof maps native elements, ordered authored text, controlled text/range properties, link
destinations, form ownership, ARIA state/relationships, focusability, and compiler-issued actions
without reading JSX or inventing a backend callback surface. Native platform kind participates in HMR
compatibility, and unsafe `script`/`style` hosts fail before runtime. A generic platform-port mount
proof creates the normalized hierarchy without a virtual DOM, applies attributes/properties, binds
compiler-issued actions, performs compatible fine-grained semantic updates without replacing node
identity, and disposes roots and listeners exactly once. The same port now passes direct real-DOM
acceptance for controlled inputs, link dispatch, native dialog modality, hidden/expanded updates, and
focus entry/return. Accessibility-tree inspection and the complete production adapter remain open.

The reference now validates forms and errors, roving focus, role-compatible active descendants for
combobox/listbox/tree/grid, and revision-safe top-down nested-overlay focus return. The generic-driven
candidate structure surface now has executable type and normalization coverage for exact actions,
semantic hierarchy, reactive semantic values, role-compatible references, form/error ownership,
native focus defaults, duplicate identity rejection, scalar-keyed repeated parts, reactive collection
references, opaque child composition through typed slot cardinalities, and one reactive structural
choice with stable branches. The integrated generic fixture now separates pure resource/route
derivation, committed named commands, state-scoped cancellable tasks, and capability-free structure.
The reference proves command commit/order/drain laws and task cancellation independently. Complete
hierarchical/parallel topology now normalizes absolute paths, compound initials, orthogonal targets,
root and nested events/tasks/delays, and deterministic declaration order. Generated traces preserve
unaffected parallel regions. Ordered guarded alternatives, recursive final completion/output, and
state-owned delayed transitions now execute against a deterministic virtual clock with generated and
mutation evidence. Guarded always stabilization and revision-safe typed task done/error outcomes now
share that transition algebra. History, child actors/streams, navigation/resource adapter lowering,
platform-specific structure lowering, and independent author validation remain open.

## Unproven Empirical Slices

- Two independent reviewers have not classified the natural-language corpus.
- Independent developers have not run the fixed author, modification, debugging, theming, and
  prediction tasks.
- Three visually and materially distinct presets now run over one shared complex structure, but have
  not passed independent fidelity review under the candidate.
- The supplied Family reference has an executable candidate translation and exact recorded default and
  key-detail geometry, but has no independent pixel-fidelity review.
- No exact Figma reference has been translated and compared at desktop, intermediate, and compact
  sizes.
- Candidate output has direct native HTML, basic ARIA/focus, and trusted-pointer drag evidence. Touch,
  selection, forced colors, browser zoom, keyboard viewport, accessibility-tree inspection, and
  reduced-motion browser acceptance remain open.

These gates require independent people or platform observation. They cannot be closed by adding more
maintainer-authored unit tests.

## Adapter And Migration Gaps

- Candidate IR now has a deterministic plain-data research compiler and cross-domain inline golden,
  but no selected production compiler or web adapter.
- Hierarchical alternatives now preserve pure update and ordered command resolver identities, while
  production execution that connects those names to local-first resource/navigation ports remains
  unimplemented.
- Static StyleX and retained Anime.js/WAAPI strategy selection has not been proven equivalent for the
  candidate.
- Unsupported capability diagnostics cover only the fake adapter. Gesture descriptors now participate
  in its observable-scene differential rather than being tested only as an isolated lifecycle.
- Capability requirements are now derived exhaustively from the canonical artifact and use semantic
  names, but no real web adapter has yet proven those declarations against platform behavior.
- Existing applications and package declarations still target the prior visual language.
- Candidate structure now plans and executes native branch insertion, survivor movement, indexed text
  reconciliation, immediate semantic release, retained visual exit, stale settlement rejection, and
  interrupted same-node reversal without a virtual DOM. The Family fixture integrates focus recovery,
  measured resizing, preset-authored content motion, direct drag, and a revision-scoped modal entry and
  return-focus contract. Nested retained roots and
  production adapter ownership still need proof before fidelity evidence closes.
- Obsolete compiler/runtime machinery cannot be identified safely until candidate selection.

## Ordered Path To Selection

1. Extend the now-closed core expression and transition algebra only when a frozen corpus case proves
   missing meaning; do not add JavaScript/CSS-shaped convenience operations.
2. Materialize the remaining layout, gesture, presence, and visual-value relationships.
3. Add compiler golden output and a second reference adapter for every operation.
4. Run the fixed pilot tasks, revise only from recorded failures, then run independent studies.
5. Build one candidate web-adapter spike and three-preset fidelity corpus without changing semantics.
6. Assemble the selection dossier and either select the candidate or record that no candidate is ready.
7. Only after selection, write and execute the destructive production migration plan.
