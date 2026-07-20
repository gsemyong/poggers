# Deterministic Presentation Pipeline Plan

## Status

This file is the source of truth for the Presentation pipeline goal. A gate is
complete only when the recorded command or trace proves it. Passing unit tests
alone does not imply visual or browser correctness.

Baseline captured on 2026-07-20:

- `nub run check` passes with 29 files and 220 tests.
- Keyed metric reorder changes DOM order without visible motion.
- Responsive and density changes can FLIP-scale text on one axis.
- The default adapter uses canonical JavaScript frame evaluation; autonomous
  native execution is disabled because its planner replayed complete future
  Presentation frames synchronously.

## Objective

Implement one deterministic pipeline:

```text
Behavior snapshot
  + Presentation parameters
  + Environment and Element observations
  + retained temporal snapshot at logical time
  -> immutable Presentation frame
  -> validated adapter plan
  -> optimal supported platform artifacts
  -> committed result and next-frame observations
```

The author describes product and visual meaning. The adapter owns realization,
resource lifecycle, measurements, scheduling, and optimization. Every rendered
frame must be inspectable and reproducible from explicit inputs.

## Invariants

1. Behavior owns structure, accessibility, native listeners, actions, and
   semantic state.
2. Presentation observes Behavior and platform facts but cannot invoke actions,
   mutate Behavior, perform I/O, subscribe, or schedule work.
3. Presentation produces one immutable declaration frame. Layout, presence,
   assets, feedback, and motion are not competing mutation systems.
4. Every native visual property has one declared owner in one logical frame.
5. Structural changes publish explicit transactions; correctness never depends
   on an incidental `ResizeObserver` notification.
6. Element and Environment observations are frozen for a frame. Writes caused
   by that frame are observable only by a later frame.
7. Retained temporal state uses one logical clock and stable compiler/runtime
   identity.
8. Canonical execution is the semantic oracle. An optimized path is enabled
   only after trace-equivalence, interruption, lifecycle, and browser gates pass.
9. Text-bearing DOM is never non-uniformly scaled unless the author explicitly
   requests that visual effect.
10. Documentation reports bounded evidence and keeps unsupported claims open.

## Target Authoring Contract

The shared source shape remains intentionally small:

```ts
const presentation = (({ parameters, environment, state, events }) => ({
  Feature: ({ state, events }) => ({
    Component: ({ props, state, events, elements }) => {
      const progress = animate(state.open ? 1 : 0, parameters.motion.panel);

      return {
        Panel: {
          layout: {/* adapter language */},
          paint: { opacity: progress },
          transform: { translate: { y: (1 - progress) * elements.Panel.box.blockSize } },
          continuity: { kind: "position", dynamics: parameters.motion.layout },
        },
      };
    },
  }),
})) satisfies Presentation<App, Language, Parameters>;
```

The shared kernel provides only typed facts, Events, `Animation`, `animate`,
`velocity`, and `settled`. Adapter languages define declarations,
observations, assets, and Animation constructors.

The evaluated result is normalized to a frame IR before native mutation. The
frame IR records semantic Element names, normalized declarations, temporal
dependencies, ownership, and adapter planning inputs. It contains no DOM
handles and can be serialized for tests and inspection.

## Execution Strategy

The web adapter classifies a validated frame conservatively:

- **static:** deterministic CSS installed once;
- **canonical:** one sampled logical frame with batched CSS-variable writes;
- **native:** directly lowerable compositor-safe finite motion, enabled only
  after direct planning and trace-equivalence proof;
- **layout:** explicit structural transaction plus cached old/new geometry;
- **presence:** structural retention tied to the same declared temporal
  settlement, never a second authored clock.

Unsupported optimization falls back to canonical execution with an inspectable
reason. It must never silently change visual semantics.

## Verification Layers

### Pure Contract Tests

- Type inference and negative fixtures for state, events, parameters,
  observations, Elements, and declarations.
- Stable compiler identities and exact temporal/declaration dependencies.
- Frame IR normalization, serialization, immutability, and deterministic replay.
- Ownership and stage-cycle rejection with source-level diagnostics where
  possible.

### Adapter Conformance Tests

- Given a declaration frame, produce byte-equivalent adapter plans.
- Given fixed observations, temporal snapshot, and time, reproduce the same
  committed artifact inspection.
- Compare every enabled optimized trace with the canonical trace at ordinary,
  interruption, reversal, reduced-motion, completion, and disposal points.

### Property Tests

- Finite output for finite inputs.
- Same snapshot and time implies the same frame and plan.
- Retargeting preserves displayed value and compatible velocity.
- Keyed reorder preserves identity and never loses a structural invalidation.
- No frame has conflicting property ownership.
- No retained invisible element remains interactive after semantic exit.
- Work grows linearly with affected Elements and does not invalidate unrelated
  Components.

### Browser Tests

- Desktop and narrow responsive viewport.
- Keyed reorder, density change, wrapping text, font/image load, and resize.
- Sheet open, every close source, drag, release, re-grab, rapid reversal, and
  repeated actions.
- Reduced motion, hit testing, focus, accessibility state, and console errors.
- Frame traces assert continuity, no accidental one-axis text scale, no first
  frame flash, no stale backdrop, and no blocked trigger after visual exit.

## Acceptance Gates

### G1: Truthful Baseline And Documentation

- [x] Record the passing repository baseline separately from failing browser
      behavior.
- [x] Remove or rewrite stale completion claims contradicted by live evidence.
- [x] Keep this document updated after every implementation phase.

### G2: Canonical Frame IR

- [x] Add an immutable adapter-neutral Presentation frame envelope.
- [x] Normalize web declarations into a serializable web frame IR without DOM
      handles.
- [x] Record declaration ownership and temporal dependencies in frame
      inspection and the artifact plan.
- [x] Reject ambiguous or conflicting ownership before commit.
- [x] Add deterministic snapshots and `fast-check` replay properties.

### G3: Pure Web Artifact Planner

- [x] Move declaration compilation/classification behind a pure planner.
- [x] Make static CSS, dynamic variables, assets, feedback, presence, and
      continuity visible in one artifact plan.
- [x] Give every fallback an inspectable reason.
- [x] Make the live adapter commit exactly the planned artifact.
- [x] Prove plan determinism without creating a browser or native resource.

### G4: Atomic Observation And Structural Transactions

- [x] Publish an explicit web structural-layout invalidation after keyed insert,
      removal, replacement, and reorder.
- [x] Batch cached geometry reads before frame publication and native writes
      after planning.
- [x] Ensure declaration writes are observed only by a later logical frame.
- [x] Add a real keyed-reorder integration trace, not only a fake-box layout
      test.

### G5: Single Visual Ownership

- [x] Default content-bearing layout continuity to position-only realization.
- [x] Require explicit opt-in for geometric scaling and reject conflicting
      authored/generated transform ownership.
- [x] Remove duplicate density/reorder animation ownership from the example.
- [x] Ensure responsive reflow and wrapping text remain intrinsically shaped.
- [x] Prove no accidental non-uniform text scale in browser frame traces.

### G6: Temporal, Layout, And Presence Coherence

- [x] Use one frame clock and one inspected frame for authored temporal values,
      layout continuity, and presence settlement.
- [x] Preserve displayed value and velocity through retarget, reversal, and
      direct-manipulation handoff.
- [x] Tie retained exit lifetime and hit testing to semantic settlement.
- [x] Prove rapid close/open and drag/re-grab without dead frames or stale
      overlays.

### G7: Optimization Contract

- [x] Remove synchronous replay of whole future Presentation trees from the
      default production planning path.
- [x] Classify static, canonical, layout, and native eligibility explicitly.
- [x] Keep autonomous native execution disabled until direct lowering can be
      proven from semantic temporal dependencies.
- [x] Prove interruption and disposal behavior for the injectable native
      conformance path while keeping it disabled by default.
- [x] Record bounded main-thread frame work and allocation evidence.

### G8: Product Example

- [x] Reorder visibly preserves identity and animates from cached old geometry.
- [x] Density changes use one shared coordinate and do not combine font
      interpolation with ancestor scale distortion.
- [x] Responsive viewport changes never stretch or squash text.
- [x] Asset changes declare and exhibit the intended immediate replacement
      policy.
- [x] Sheet choreography is coherent across desktop/mobile, every dismissal
      source, drag, content change, and immediate reopen.

### G9: Strategic Test Suite

- [x] Add one end-to-end pure pipeline fixture from Behavior snapshot through
      Presentation frame and web artifact plan.
- [x] Add property tests for frame/plan determinism and ownership.
- [x] Add structural/layout integration coverage for keyed reorder.
- [x] Record reproducible browser frame traces for critical visual invariants.
- [x] Remove redundant tests that only restate implementation details after
      stronger contract coverage exists.

### G10: Repository Completion

- [x] `nub run check` passes.
- [x] `nub run build` passes.
- [x] Example production build and package smoke checks pass.
- [x] Browser verification passes at desktop and narrow viewports with no
      uncaught or forwarded errors.
- [x] Documentation describes only implemented behavior and records bounded
      limitations.
- [x] Final diff contains no obsolete planner, stale test artifact, or false
      completion ledger.

## Work Sequence

1. Introduce frame IR and pure planning types with deterministic tests.
2. Route the live web adapter through the planner and expose the plan in frame
   inspection.
3. Add explicit structure-to-layout transactions and keyed reorder coverage.
4. Establish one-property ownership, position-only default continuity, and
   conflict diagnostics.
5. Rewrite the example around one density coordinate and one layout owner.
6. Reconcile presence and layout publication with the root frame clock.
7. Add pure end-to-end and property tests.
8. Add browser trace assertions and fix every observed product defect.
9. Measure supported execution paths and retain conservative fallbacks.
10. Consolidate documentation/tests, run every gate, and record final evidence.

## Progress Log

- [x] Root-cause audit completed against the running application.
- [x] Repository baseline captured.
- [x] Goal and source-of-truth plan created.
- [x] Canonical frame IR implemented.
- [x] Pure web planner implemented and integrated.
- [x] Structural transactions and ownership fixed.
- [x] Product example migrated.
- [x] Deterministic/property/browser evidence complete.
- [x] Repository and documentation gates complete.

## Recorded Evidence

- `nub run check`: 30 test files and 230 tests after typecheck, Oxlint, and
  Oxfmt.
- `nub run build`: package declarations and production JavaScript emitted with
  Vite 8.1.5.
- Three-sample local benchmark on Node 26.5.0, Apple arm64: dynamic frame
  compilation p50 1.95 microseconds; one canonical sample across 1,000 spring
  targets p50 57.8 microseconds; 1,000 retained Animation bindings p50 309
  microseconds. These are local microbenchmarks, not device frame-rate claims.
- Chromium desktop trace: keyed endpoints kept their pre-reorder geometry on
  the first frame and converged with translation-only matrices; no sampled
  article or heading had a non-unit matrix scale.
- Chromium narrow trace: responsive reflow retained intrinsic text geometry;
  drag follow, snap-back, immediate re-grab, velocity/threshold dismissal,
  button/backdrop/Escape close, reduced motion, and content-height changes all
  completed without a stale overlay.
- Rapid close/open tracing showed the underlying trigger as the native hit-test
  target while the retained dialog was inert. The panel reopened from its
  displayed position and settled without a dead frame.
- Desktop semantic exit reached zero opacity and left the top layer on the same
  observed frame at about 253 ms. The icon asset changed on the same image node,
  and authored `alt=""` remained present after replacement.
- A fresh browser session reported no page or forwarded runtime errors after
  the final changes.

## Bounded Limits

- The default DOM adapter remains on canonical sampled execution for dynamic
  Presentation declarations. Autonomous native lowering is not enabled.
- The browser evidence above is Chromium evidence; it is not a Safari/WebKit
  performance certification.
- The current web declaration vocabulary is intentionally incomplete relative
  to all of CSS. This goal verifies the deterministic pipeline and current
  adapter surface, not universal web-style coverage.
