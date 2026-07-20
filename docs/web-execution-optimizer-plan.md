# Reference-Driven Web Execution Optimizer

## Status

This file is the source of truth for optimizing web Presentation execution. An
optimization is production-eligible only after its output and lifecycle are
proven equivalent to the canonical sampled renderer. A passing planner test is
not evidence that a browser used its compositor.

## Objective

Compile one semantic Presentation into the cheapest correct execution plan:

```text
Behavior and observation snapshot
  + retained temporal channels
  + declaration dependency provenance
  -> canonical frame at logical time (semantic oracle)
  -> per-Element, per-property execution plan
  -> static CSS | native CSS | WAAPI | shared frame | layout transaction
```

The canonical renderer evaluates the Presentation at one logical time and
batches its writes through one frame host per mounted UI root. Every optimized
path must preserve the canonical visual output, value and velocity at an
interruption, presence and hit-testing semantics, target identity, reduced
motion, and disposal behavior.

## Browser Facts

- CSS animations, CSS transitions, and Web Animations share the Web Animations
  model. WAAPI is a control surface, not a separate rendering pipeline.
- Browsers can accelerate opacity, transforms, and some filters, but actual
  compositor promotion is implementation-dependent. Property-name heuristics
  establish eligibility, not proof.
- WAAPI exposes seeking, cancellation, reversal, and inspection. Those features
  make it preferable to generated CSS keyframes for dynamic finite trajectories
  that require runtime interruption.
- Layout and most paint properties require main-thread work. Layout continuity
  can still animate a compositor transform after one batched old/new geometry
  transaction.

Primary references:

- <https://www.w3.org/TR/web-animations-1/>
- <https://www.w3.org/TR/css-transitions-2/>
- <https://www.chromium.org/developers/how-tos/trace-event-profiling-tool/anatomy-of-jank/>

## Invariants

1. The canonical renderer remains complete, deterministic, inspectable, and
   available as the fallback for every valid Presentation.
2. Optimization is selected per Element and property channel, never by one
   application-wide `dynamic` boolean.
3. Static values remain literal CSS; only temporal channels become runtime
   variables or native effects.
4. The compiler preserves the exact temporal dependencies of each declaration
   destination through runtime planning.
5. Native planning never predicts the future by replaying an entire
   Presentation at a fixed high frequency.
6. A browser-native effect starts atomically or the complete affected channel
   remains canonical.
7. An interruption materializes the canonical value and velocity for the same
   logical time before native ownership is released.
8. Hybrid plans never give one native property two writers in one frame.
9. Unsupported or uncertain eligibility falls back with a stable, inspectable
   reason.
10. Compositor claims require browser trace evidence; unit tests may only claim
    native eligibility and semantic equivalence.
11. Web temporal values may drive only presence, opacity, translation, scale,
    and rotation. Layout, text metrics, and paint change discretely and may
    request layout continuity; they never fall back to per-frame reflow.
12. Viewport, container, intrinsic-media, and font geometry notifications
    synchronize layout snapshots and geometry-derived scalar destinations.
    Only semantic state or structural transactions start layout continuity.

## Execution Classes

### Static CSS

No temporal or runtime-observation dependency. Emit one deduplicated rule and
perform no frame work.

### Native CSS

Interaction or environment meaning already expressible by pseudo-classes,
media queries, or container queries. Emit native conditional CSS and perform no
JavaScript subscription for the condition.

### WAAPI

A finite autonomous trajectory, stable targets and property shape, no active
layout transaction, and outputs restricted to adapter-declared acceleration
candidates. Lower directly where the expression is known. Bounded adaptive
output sampling is a conservative validation strategy, not mathematical proof
for arbitrary author JavaScript; it retains an internal error margin and the
analytical canonical trajectory for interruption.

### Shared Frame

Direct manipulation, live observations, continuously retargeted
compositor-safe trajectories, presence work, and conservative native
fallbacks. One root frame request samples all active sessions at one timestamp
and batches writes. Changing layout, text metrics, or paint is not a valid
temporal fallback.

### Layout Transaction

Read old and new geometry in one root transaction, preserve intrinsic content
layout, and realize position continuity with an adapter-owned transform. Size
scaling requires explicit author opt-in. Native resize, intrinsic media, and
font changes synchronize without continuity so responsive layout never chases
a moving destination.

## Reflow Policy

- Layout and text values may depend on behavior state, props, parameters,
  container rules, or environment values. A change performs one native layout.
- An `animate()` binding cannot feed layout, text metrics, color, shadow,
  radius, filter, or another paint property. The source transform rejects this
  during development/build, and the runtime validates generated temporal
  declarations again.
- Authored discrete structure/state changes may add `continuity`; the adapter
  measures old and new geometry once and animates only its transform layer.
- Viewport/container resize and other environmental geometry updates replace
  snapshots and geometry-derived scalar destinations immediately. They cancel
  stale FLIP motion instead of repeatedly retargeting it.
- Position-only continuity is the default and does not scale text. Scaling
  intrinsic content is an explicit strategy because it can distort glyphs and
  raster content.

## Equivalence Contract

For a scenario `S`, logical time `t`, and interruption history `H`:

```text
sample(optimized(S), t, H) ~= canonical(S, t, H)
```

Exact equality is required for semantic state, target set, property ownership,
presence, settlement, and lifecycle. Adapter-defined tolerances apply only to
sampled numeric visual values between native keyframes. Endpoints are exact.

Initial web tolerances:

- opacity: `0.001`;
- translation: `0.125 CSS px` for absolute pixel outputs;
- scale: `0.001`;
- rotation: `0.05 deg`.

## Acceptance Gates

### G1: Truthful Baseline

- [x] Canonical frame and artifact plans are deterministic and serializable.
- [x] One mounted UI root owns one shared frame request and timestamp.
- [x] Record the pre-optimizer baseline before enabling native execution.
- [x] Keep every uncertain or unsupported case on the canonical path.

### G2: Dependency Provenance

- [x] Preserve temporal destination dependencies in generated runtime metadata.
- [x] Classify static versus temporal Components from compiler IR.
- [x] Replace the graph-wide dynamic flag with per-Component metadata.
- [x] Prove static Components emit no CSS variables and schedule no frames.

### G3: Canonical Oracle Harness

- [x] Add a deterministic web frame-trace comparison model.
- [x] Define exact and numeric-tolerance comparison by property domain.
- [x] Generate ordinary, reverse, retarget, direct-handoff, replacement,
      reduced-motion, and disposal traces.
- [x] Make every fallback reason part of the inspected execution plan.

### G4: Direct Native Planning

- [x] Expose finite temporal declaration slices without replaying the complete
      Presentation at fixed-frequency future times.
- [x] Lower stable opacity and individual transform channels to WAAPI.
- [x] Use bounded adaptive sampling when a spring or track cannot be represented
      by one native easing.
- [x] Reject infinite, live-follow, observation-dependent, layout-active, and
      shape-changing candidates with exact reasons.
- [x] Enable the native path by default only after direct lowering removes
      synchronous whole-Presentation future replay.

### G5: Hybrid Ownership

- [x] Split native visual effects and canonical presence work across
      independently owned Elements.
- [ ] Split static, native, and canonical properties within one Element plan.
- [ ] Keep constant numeric values as literal CSS in dynamic Components.
- [ ] Ensure canonical commits omit properties currently owned by WAAPI.
- [ ] Transfer ownership atomically on completion, cancellation, retarget, and
      target replacement.

### G6: Integration And Lifecycle

- [x] Prove canonical/native equivalence with a fake clock and seekable WAAPI.
- [x] Prove value and velocity continuity for interruption and reversal.
- [x] Prove presence, hit testing, layout, and reduced-motion coherence.
- [x] Prove HMR snapshot restoration and disposal release every native resource.

### G7: Browser Evidence

- [x] Run canonical and optimized fixtures under identical scripted scenarios.
- [x] Compare computed styles, geometry, target presence, and screenshots at
      deterministic checkpoints.
- [x] Verify native plans expose WAAPI effects and retain no JavaScript frame
      task while autonomous.
- [x] Capture Chromium performance evidence for native-eligible fixtures and
      framework frame work.
- [ ] Run correctness traces in Chromium, WebKit, and Firefox before claiming
      cross-browser conformance.

### G8: Performance And Completion

- [x] Benchmark plan construction, adaptive lowering, canonical frame cost, and
      interruption handoff.
- [x] Assert work scales with affected Elements and temporal channels.
- [x] Set bounded allocation and frame-time budgets for 60 Hz and 120 Hz loads.
- [x] Run typecheck, lint, format, unit/property tests, production build, package
      smoke check, and browser verification.
- [x] Document exactly which optimizations are enabled and every bounded
      fallback that remains.

## Systematic Completion Pass

This pass responds to an observed animation-frame callback of roughly 51 ms
and visible incoherence in the dashboard. Previous browser checks exercised
one favorable example and did not establish a general performance or
correctness result.

### Scenario Matrix

Every row must have a deterministic unit-level trace. Rows marked `browser`
must also be exercised in the mounted example at desktop and mobile widths.

| Scenario                                  | Required evidence                                             |
| ----------------------------------------- | ------------------------------------------------------------- |
| Static style and one state change         | no frame subscription; no redundant native write              |
| Finite opacity and transform spring       | canonical/native trace equivalence; autonomous WAAPI          |
| Mid-flight reverse and retarget           | value and velocity continuity at the handoff                  |
| Direct drag and velocity release          | exact pointer tracking; continuous spring release (`browser`) |
| Enter, exit, and rapid reopen             | coherent presence and hit testing (`browser`)                 |
| Layout reorder and target replacement     | geometry continuity without stale ownership (`browser`)       |
| Text wrapping and intrinsic height change | no scale distortion; readable intermediate frames (`browser`) |
| Discrete layout plus crossfade            | one reflow, FLIP transform, and native visual equivalence     |
| Observation-dependent motion              | canonical fallback and reactive retargeting                   |
| Shared temporal scope                     | one sampled coordinate across component instances             |
| Reduced motion                            | immediate settled output and no retained native effect        |
| Disposal and hot replacement              | no frame, animation, listener, or style ownership leak        |
| 1, 100, and 1,000 active channels         | linear work and explicit 60/120 Hz budgets                    |

### Correctness Oracle

- [x] Record canonical traces as ordered frames containing logical time,
      declarations, presence, ownership, target identity, and settled state.
- [x] Compare optimized traces by property domain with exact endpoints and the
      tolerances in the Equivalence Contract.
- [x] Generate open, close, reverse, retarget, drag release, replacement,
      reduced-motion, and disposal histories from reusable deterministic
      harnesses.
- [x] Make a mismatch report the scenario, time, Element, property, expected
      value, actual value, and tolerance.

### Frame-Path Budget

- [x] Ordinary animation frames do not build frozen inspection snapshots,
      compiler artifact reports, or unchanged class/asset/presence state.
- [x] One root owns at most one pending `requestAnimationFrame` callback.
- [x] The representative dashboard has no framework animation callback over
      8 ms in an idle Chromium run and no interaction task over 50 ms.
- [x] The 120 Hz target is at most 4 ms of framework work at the representative
      load; larger stress fixtures must publish their supported budget rather
      than silently miss frames.
- [x] Native planning remains bounded and never consumes an animation frame
      after its planning budget is exhausted.

### Browser Verification

- [x] Capture Chromium traces for open, close, reverse, drag/release, layout
      change, reorder, and rapid repeated interaction.
- [x] Inspect screenshots and computed geometry at deterministic checkpoints.
- [x] Verify the backdrop and retained dialog stop intercepting input as soon
      as their visual presence ends.
- [x] Verify responsive changes and HMR preserve coherent state.
- [x] Record browser/platform limitations separately from implementation bugs.

### Completion Rule

This goal is complete only when the reusable trace matrix, full repository
checks, production build, benchmarks, and mounted Chromium scenarios pass;
the 51 ms frame cause is identified and removed or retained as a documented,
reproducible platform limit. Unit-level native eligibility is never reported
as compositor proof.

## First Implementation Sequence

1. Carry compiler dependency metadata into the generated web application.
2. Classify Components independently and restore the real static CSS path.
3. Build the canonical-versus-candidate trace comparator.
4. Replace fixed 480 Hz future replay with bounded trajectory-aware planning.
5. Enable WAAPI for proven opacity and transform-only autonomous motion.
6. Add hybrid property ownership after whole-Element native execution is proven.
7. Add real-browser correctness and performance traces.

## Progress Log

- [x] Current compiler, planner, scheduler, and tests audited.
- [x] Browser execution constraints checked against primary specifications and
      Chromium architecture documentation.
- [x] Target execution and equivalence contracts recorded.
- [x] Dependency provenance reaches runtime planning.
- [x] Compiler-generated declaration slices are retained after one authored
      Presentation evaluation and resampled independently.
- [x] Reference-driven native optimization is production-enabled for active
      opacity and individual-transform declarations whose Element has no
      concurrent non-compositor output.
- [x] Hybrid execution retains canonical presence work while native effects own
      eligible visual channels. Temporal layout and paint are rejected instead
      of becoming a main-thread fallback.
- [x] Browser and performance evidence is complete for Chromium.

## Current Evidence

- The full suite passes with 31 files and 254 tests, including generated spring
  families, compiler dependency provenance, static scheduling, interruption,
  reduced-motion, presence, layout, resize synchronization, planning budgets,
  and disposal cases.
- TypeScript, Oxlint, Oxfmt, and the production package build pass.
- Whole-Presentation adaptive planning was measured at roughly 43-167 ms and is
  not enabled implicitly. Compiler slices now lower only declarations connected
  to active animation identities, with an 8 ms synchronous planning budget.
- The original 51 ms callback came from synchronous full-geometry observation
  scans, reactive re-evaluation, and eager frozen inspection snapshots on each
  frame. Lazy diagnostics, demand-driven geometry, and coalesced graph
  invalidation removed that work from the production frame path.
- A current Chromium resize/layout trace recorded 151 framework frame
  callbacks: p50 `0.064 ms`, p95 `1.072 ms`, max `2.07 ms`, and zero callbacks
  above `8 ms`. A current mobile drag/dismiss trace recorded 152 callbacks:
  p50 `0.122 ms`, p95 `1.039 ms`, max `2.411 ms`, and zero above `8 ms`.
- Repeated `1280 -> 430 -> 390 -> 1280` viewport changes retain no card
  transform or animation. A property test covers 50 generated external resize
  histories of up to 40 geometry changes and verifies exact synchronized
  snapshots after canceling motion in flight.
- Mid-flight open/close/open reversal changed displayed translation by less than
  one CSS pixel at each handoff. Mobile pointer testing observed direct 140 px
  drag tracking, native release effects, and the opener as the top hit-test
  target after dismissal.
- Node benchmarks report a 0.245 ms median native-plan cost, 0.309 ms adaptive
  spring-keyframe cost, and 0.064 microsecond analytical spring sample on the
  measured machine. These are regression evidence, not universal budgets.
- A real mounted `Element.animate` boundary and Chromium `Animation` objects
  prove native execution eligibility. The traces prove low framework main
  thread cost, but they do not prove a browser-specific layer-promotion choice.
  WebKit and Firefox conformance remain unverified because compatible local
  automation binaries were unavailable; no cross-browser claim is made.
