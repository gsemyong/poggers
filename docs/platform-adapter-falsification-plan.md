# Paired Platform Adapter Falsification Plan

Status: complete

## Goal

Determine whether Poggers can describe any platform-realizable UI/UX through a
single, minimal convention in which every UI platform provides a paired
structural adapter and Presentation adapter, while application authors retain a
clean separation between behavior and Presentation.

This is a falsification study. It must try to break the proposed architecture,
record the smallest counterexamples, and change Core only when a counterexample
cannot be expressed by a platform-specific primitive, declaration, or internal
bridge. A collection of successful demos is not sufficient evidence.

## Claim Under Test

For a platform `P`, an application may define platform-specific Components,
hierarchy, interaction behavior, semantics, and accessibility using `P`'s
structural language. A pure Presentation maps Theme, props, structural state,
and typed targets into `P`'s Presentation declarations. A paired platform
implementation interprets both sides and owns their native coordination.

```text
Platform P
|- Structure language and adapter
|  |- JSX primitives and props
|  |- hierarchy and mounting
|  |- native events and gestures
|  |- semantics and accessibility
|  `- structural lifecycle
|- Presentation language and adapter
|  |- layout, drawing, styling, and resources
|  |- motion, choreography, and retained visual state
|  `- sensory output
`- private platform bridge
   |- native target and occurrence identity
   |- geometry, hit testing, and coordinate spaces
   |- presence and resource lifecycle
   `- synchronization between native input and output
```

Product behavior may be shared between platforms when an application chooses,
but equivalent Component trees, interaction behavior, or visual declarations
are not required across platforms.

## Formal Hypothesis

The structure side is a discrete reactive system:

```text
(product state, native inputs, capabilities)
  -> (semantic structure, actions, next product state)
```

The Presentation side is pure:

```text
(theme, props, readonly structural state, typed targets)
  -> immutable platform declarations
```

The paired adapter is a causal stateful interpreter:

```text
(previous private platform state, declarations, native observations, time)
  -> (next private platform state, native output)
```

The architecture is relatively complete if every platform-realizable UI/UX can
be decomposed this way without adding platform vocabulary to Core, exposing
native handles or Actions to Presentation, or introducing another authoring and
lifecycle path.

## Non-Goals

- Do not prove that the current web declaration vocabulary contains every CSS,
  DOM, media, or rendering feature.
- Do not require one shared Component tree or behavior implementation across
  platforms.
- Do not add an arbitrary callback, native-handle, or opaque-object escape hatch
  merely to make the claim trivially true.
- Do not redesign product Programs, capabilities, or feature composition unless
  a UI counterexample requires it.
- Do not judge architectural sufficiency from visual polish or frame rate.
- Do not retain experimental public APIs that fail the final minimality review.

## Research Corpus

Use primary sources and record what each system owns at its equivalent of
structure, layout, drawing, hit testing, gestures, semantics, animation,
resource lifecycle, and native interoperability.

- [x] Flutter Widget, Element, RenderObject, semantics, and embedder layers.
- [x] Jetpack Compose composition, layout, draw, modifier, interaction, and
      semantics phases.
- [x] SwiftUI View, Layout, Gesture, Transaction, Presentation, accessibility,
      and representable APIs.
- [x] React Native Host Components, Fabric render/commit/mount pipeline,
      codegen, and platform-specific components.
- [x] Web DOM, CSS, accessibility tree, top layer, hit testing, View
      Transitions, Web Animations, Canvas/WebGL/WebGPU, and media ownership.
- [x] Retained scene graphs and custom render pipelines.
- [x] Functional Reactive Animation's behaviors and events.
- [x] I/O automata and stateful transducers for compositional input/output
      ownership.

**Research gate:** a comparison table identifies where established systems
couple structure, presentation, input, layout, and semantics, including cases
that contradict our initial boundary.

## Phase 1: Current Architecture Inventory

- [x] Diagram the current compile-time and runtime path from Program Component
      types and JSX through native web nodes and Presentation commits.
- [x] Inventory the implicit web structure adapter in JSX/runtime/component
      modules.
- [x] Inventory the Three JSX runtime and Presentation adapter and identify what
      is missing for it to be a complete platform implementation.
- [x] Identify every generic type that currently contains web assumptions.
- [x] Identify every untyped string relationship between Runtime, platform,
      primitive, Element, and declaration.
- [x] Classify every lifecycle owner and every native feedback channel.

**Inventory gate:** every relevant module and dependency direction has one
architectural owner; implicit adapters and accidental coupling are documented.

## Phase 2: Falsification Matrix

For each case, specify structural meaning, Presentation meaning, native input,
native output, private adapter state, lifecycle, accessibility, and the exact
information crossing each boundary.

### Native Semantic Controls

- [x] Text input, IME composition, selection, autofill, validation, and virtual
      keyboard geometry.
- [x] Dialog/popover top-layer ownership, inertness, focus trapping, dismissal,
      and focus restoration.
- [x] Platform sheet detents, drag indication, scrolling interaction, and
      dismissal thresholds.
- [x] Native media, map, camera, web-view, and date-picker controls.

### Layout-Structure Feedback

- [x] Constraint-dependent semantic composition with different child trees.
- [x] Virtualized and recycled lists whose mounted structure depends on layout.
- [x] Intrinsic text measurement, font replacement, wrapping, and baseline
      relationships.
- [x] Portals, nested scroll containers, clipping, safe areas, and keyboard
      avoidance.

### Interaction-Presentation Coupling

- [x] Gesture arbitration, simultaneous gestures, cancellation, capture, and
      coordinate-space conversion.
- [x] Direct manipulation with release velocity, spring handoff, and reversal.
- [x] Geometry-driven hit testing and presentation-controlled touch targets.
- [x] Hover, focus-visible, pointer modality, reduced motion, and accessibility
      display preferences.

### Temporal And Generated Output

- [x] Retained enter/exit, immediate hit-test release, focus coordination, and
      re-entry before settlement.
- [x] Cross-component and cross-route shared-element transitions.
- [x] One-shot and looping audio/haptic occurrences, including repeated equal
      structural states.
- [x] Canvas/3D generated subgraphs, shaders, particles, render passes, and
      accessible semantic proxies.
- [x] Worker/offscreen simulation and long-running renderer-owned state.
- [x] Resource replacement, failure, leasing, and exactly-once disposal.

### Platform And Product Composition

- [x] One Feature with materially different web and native Component trees.
- [x] Components from several Features mounted under one platform runtime.
- [x] Several platform runtimes in one application with different primitive and
      Presentation languages.
- [x] OS-owned surfaces such as notifications, widgets, system sheets, and call
      interfaces.
- [x] Themes that change only parameters versus Presentations that change
      complete visual and interaction feel.

Every case receives exactly one result:

1. Expressible without contract changes.
2. Requires only a platform Presentation declaration.
3. Requires only a platform structural primitive.
4. Requires a private paired-adapter bridge mechanism.
5. Requires an explicit generic contract change.
6. Falsifies the structure/Presentation split.

**Falsification gate:** no case is marked successful without a complete data and
lifecycle trace. Categories 5 and 6 require a reduced executable
counterexample before any architecture change.

## Phase 3: Candidate Paired Platform Contract

Derive the smallest candidate only after the matrix exposes the required
information channels.

- [x] Decide whether Core needs a uniform structural runtime adapter or only a
      typed association between a platform's structural and Presentation
      languages.
- [x] Define the relationship among Runtime, Platform, structural primitive,
      native target, Element, and Presentation declaration without magic
      strings.
- [x] Define whether structure-to-adapter observations are props, events,
      signals, transactions, or private implementation details.
- [x] Define the one legal path for layout-dependent composition and
      virtualization without circular multi-frame feedback.
- [x] Define the one legal path for gesture recognition and product Actions
      without giving Presentation behavioral authority.
- [x] Define occurrence identity for temporal output and stable visual identity
      for cross-instance coordination.
- [x] Define lifecycle, mounting, retained presence, remount, HMR, and disposal.
- [x] Keep adapter-specific declaration vocabulary and native types outside
      Core.

**Contract gate:** every Core concept has a concrete counterexample that fails
without it; all other concepts remain ordinary platform code or typed
adapter-specific declarations.

## Phase 4: Type And Compiler Proofs

- [x] Prove one platform type binds its Runtime, primitive vocabulary,
      structural props/events, native target, and Presentation declaration map.
- [x] Prove a UI Program cannot use Components from an incompatible platform.
- [x] Prove each named Element's primitive selects the correct declaration type.
- [x] Prove platform-specific props, events, semantics, and accessibility are
      fully contextual in JSX.
- [x] Prove Presentation receives only Theme, props, readonly state, and typed
      targets.
- [x] Reject native handles, Actions, capabilities, callbacks, cross-instance
      private targets, and incompatible declarations in Presentation.
- [x] Verify the TypeScript compiler frontend extracts the complete paired
      platform meaning without executing application code.
- [x] Compare `satisfies` against any proposed constructor and retain only a
      constructor with proven runtime meaning.

**Type gate:** all positive and negative proofs compile deterministically, and
the compiler can recover the full platform association from generic types.

## Phase 5: Real Pressure Implementations

Implement the smallest real experiments that can invalidate the contract.

- [x] Pair the existing web structural runtime with its Presentation adapter
      through the candidate contract without weakening native JSX access.
- [x] Turn the Three experiment into a paired platform fixture with structure,
      pointer/keyboard input, custom hit testing, semantic proxy output, and
      Presentation rendering.
- [x] Implement a dependency-free temporal platform for audio/haptic-like
      occurrences to test non-tree output and occurrence identity.
- [x] Implement a constraint-driven platform fixture where native layout chooses
      semantic structure, proving or disproving the feedback model.
- [x] Implement at least one native-control model where presentation parameters
      affect gesture behavior, such as sheet detents and content interaction.
- [x] Ensure each pressure implementation uses the same outer convention and no
      fallback syntax.

**Implementation gate:** at least four materially different paired platforms or
platform models pass without platform vocabulary entering Core. Any failure is
documented and drives the smallest contract revision followed by a full rerun.

## Phase 6: Conformance And Property Testing

- [x] Build a reusable paired-platform conformance suite.
- [x] Generate structural mount/update/reorder/unmount and Presentation
      commit/interruption/disposal traces.
- [x] Assert native target identity, atomic updates, target isolation, and no
      cross-instance writes.
- [x] Assert semantic structure, hit testing, geometry, and visual output never
      disagree at an externally observable frame.
- [x] Assert event ownership and gesture cancellation have one deterministic
      path.
- [x] Assert occurrence delivery is exactly once per identity and replay-safe.
- [x] Assert resource and observer ownership is lazy and disposed exactly once.
- [x] Assert compatible HMR preserves structural and retained Presentation
      state; incompatible HMR performs one clean remount.
- [x] Assert unsupported meaning fails explicitly rather than silently
      degrading.
- [x] Keep deterministic laws fast enough for the normal package test command.

**Conformance gate:** seeded adversarial traces converge on the latest state,
produce no stale native output, and reproduce every reduced counterexample.

## Phase 7: Browser And Runtime Verification

- [x] Run the actual Visual Lab through the distributed development toolchain.
- [x] Use the in-app browser or `agent-browser`, not Playwright.
- [x] Exercise mouse, keyboard, narrow viewport, touch-equivalent gestures,
      resizing, reduced motion, rapid reversal, and Presentation switching.
- [x] Inspect focus, accessibility state, hit testing, first-frame geometry,
      native resource ownership, console errors, and screenshots.
- [x] Test compatible and incompatible HMR while each pressure fixture is live.
- [x] Build, pack, install, and run a fresh generated consumer.

**Runtime gate:** observed native behavior agrees with the contract traces. Any
visible defect invalidates the corresponding gate until reduced and fixed.

## Failure Criteria

The candidate fails if any pressure case requires:

- native handles, selectors, or imperative platform calls in Presentation;
- Presentation invoking Actions or capabilities;
- product structure interpreting adapter Presentation declarations;
- a second structure, motion, resource, condition, or lifecycle path;
- an untyped callback or opaque object used as a universal declaration escape;
- generic Core vocabulary for DOM, CSS, UIKit, Compose, Three.js, audio, or
  another platform;
- semantic or focusable nodes generated solely by Presentation;
- circular layout feedback that necessarily displays an intermediate wrong
  frame;
- adding a new platform by modifying existing platform implementations;
- silently ignored unsupported declarations.

## Final Review Gates

### Boundary Review

- [x] Every behavior, semantic, visual, observation, and lifecycle concern has
      one owner.
- [x] Platform structure and Presentation adapters are paired but authoring
      responsibilities remain disjoint.
- [x] Private native coordination stays inside the paired platform
      implementation.
- [x] Product behavior does not depend on a particular Presentation.

### Minimality Review

- [x] Every Core concept is required by a recorded counterexample.
- [x] No experimental helper duplicates ordinary TypeScript.
- [x] No compatibility path or rejected API remains.
- [x] A new platform adds only its own contract, implementation, compiler/runtime
      integration, and tests.

### Evidence Review

- [x] Research, formal argument, thought experiments, executable
      counterexamples, type proofs, property tests, and browser evidence agree.
- [x] Evidence distinguishes generic-envelope sufficiency from the completeness
      and quality of a concrete platform language.
- [x] Remaining limitations are stated precisely rather than hidden behind a
      universal claim.

## Completion Criteria

- [x] Every research, inventory, falsification, contract, type,
      implementation, conformance, runtime, and review gate passes.
- [x] The final report states whether the architecture survived, what was
      falsified, and every resulting adjustment.
- [x] The paired Platform contract is either implemented and used by the
      pressure fixtures or rejected with a smaller proven alternative.
- [x] The complete repository typecheck, lint, format, test, build, package, and
      generated-consumer checks pass.
- [x] The Visual Lab remains available for direct inspection.

## Decision Log

Append dated entries while executing. Each entry records the hypothesis,
counterexample or experiment, observed result, accepted adjustment, and exact
files/tests containing the evidence. A checklist item is never completed merely
because code exists.

### 2026-07-18: Research and inventory baseline

- Established systems pair layout/rendering with hit testing, semantics, native
  events, or constraint feedback inside one platform implementation. A private
  platform bridge is therefore necessary; independently swappable structural
  and Presentation implementations for the same native target are rejected.
- Current Poggers has only a generic Presentation adapter. Web structure is
  implicit and hardcoded, `Runtime.Platform` and Element primitives are strings,
  and Three is a nested rendering fixture rather than a complete platform.
- Evidence and primary sources are recorded in
  `docs/platform-adapter-falsification-report.md`.

### 2026-07-18: Falsification matrix

- The authored structure/Presentation split survived every reduced case.
- Independently swappable structure and Presentation adapters did not survive;
  one platform package must own their private native coordination.
- Constraint-dependent semantic composition belongs to platform structure, not
  Presentation.
- Core needs typed platform association and conformance laws, not a universal
  node, layout, gesture, or observer API.

### 2026-07-18: Minimal contract and pressure implementations

- `Runtime.Platform` now carries a typed contract associating primitive props,
  native targets, hierarchy output, and Presentation declarations.
- Core keeps the structural implementation opaque. Web, Three, native-sheet,
  constraint, and temporal implementations use the same paired outer contract
  without adding platform vocabulary to Core.
- Type proofs and compiler tests reject incompatible primitives, declarations,
  native handles, Actions, and capabilities at the Presentation boundary.

### 2026-07-18: Conformance and runtime evidence

- The reusable test-only conformance suite covers atomic commits, identity,
  mount/reorder/unmount, retained exit, occurrence delivery, adversarial traces,
  and exact disposal.
- Real-browser verification covered desktop, narrow viewport, keyboard, drag,
  reduced motion, rapid re-entry, Presentation switching, focus restoration,
  Three rendering, and compatible/incompatible HMR with no browser errors.

### 2026-07-18: Distribution gate

- A clean consumer exposed missing public type dependencies; `@types/node` and
  `@types/three` moved to package dependencies.
- The rebuilt tarball excludes test-only declarations. A fresh generated app
  passes `poggers check` and its production build.
- Repository-wide typecheck, lint, format, 166 tests, and all production builds
  pass. The existing Visual Lab bundle-size warning remains a non-contract
  optimization opportunity.
