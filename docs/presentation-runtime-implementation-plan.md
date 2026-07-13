# Presentation Runtime Migration Plan

## Objective

Migrate Poggers without backward compatibility to a single presentation contract in which structure
owns semantic state and accessibility, presets own the complete visual and interaction experience,
and the runtime deterministically lowers authored intent to direct writes, Anime.js, WAAPI, or View
Transitions while preserving observable behavior.

This file is the living execution record. A checked item requires implementation and cited evidence;
passing a narrow unit test is not enough to close a gate whose scope is broader.

## Non-Negotiable Invariants

- [x] Generic component contracts are the source of correctness; no inference wrapper is added.
- [x] Public component functions are declared under `Events` and use verb names.
- [x] JSX and presets do not see raw state-machine event strings or an Anime.js object.
- [x] Presets own all visual output, responsive presentation, motion, and presentational gesture tuning.
- [x] Structure remains the sole owner of semantic state, data changes, native semantics, and ARIA.
- [x] Parameters supplied by presets are complete, typed, reactive, and atomically readable by guards.
- [x] Continuous samples use writable signals; statechart events do not run at pointer frequency.
- [x] Every imperative adapter has one owner and deterministic cleanup.
- [x] Backend optimization is semantics-preserving and has an explicit deterministic resolver.
- [x] No compatibility aliases, deprecated fields, or dual authoring paths remain.

## Phase 1: Baseline And Contract

- [x] Record existing public action, preset, interaction, motion, and web-port surfaces.
- [x] Add type fixtures that define the accepted final syntax before runtime migration.
- [x] Add negative fixtures for `Actions`, `send`, dotted event names, missing parameters, unknown
      parameters, Anime.js values, and preset mutation capabilities.
- [x] Define `Events`, `Parameters`, normalized drag samples, preset interactions, and backend
      capability types in the normative design.

### Gate 1

- [x] The final example typechecks in isolation.
- [x] Every removed or invalid surface fails with the intended diagnostic.
- [x] Typechecking does not require a helper function solely for inference.

## Phase 2: Component Runtime

- [x] Rename generic `Actions` contracts to `Events` throughout source declarations and generated
      declarations.
- [x] Replace public `send` scope with `events` while retaining internal statechart dispatch.
- [x] Make event dispatchers stable per component instance and preserve latest reactive inputs.
- [x] Add typed component `Parameters` and expose a read-only reactive parameter scope to guards,
      delayed transitions, tasks where required, derive, and native structure.
- [x] Resolve active preset parameters before statechart event evaluation and batch parameter changes.
- [x] Reject incomplete preset parameter implementations at compile time.

### Gate 2

- [x] Parent/child controlled composition works through verb-named events with one render per instance.
- [x] Parameter changes are visible atomically to the next event and never create duplicate state.
- [x] Ten thousand event transitions leave render counts, subscriptions, and retained nodes stable.

## Phase 3: Preset Interaction Contract

- [x] Extend component preset scope with typed Parts, Events, and Parameters without exposing resources,
      navigation, context mutation, or arbitrary DOM queries.
- [x] Define presentational drag intent as plain typed data, not an inference factory or Anime.js API.
- [x] Allow conditions to enable different interactions for compact, pointer, and reduced-motion
      environments.
- [x] Lower interactions against retained Part elements and dispose them when a part, component, or
      preset is replaced.
- [x] Ensure preset replacement transfers current continuous values and cannot leave stale listeners.

### Gate 3

- [x] Two presets attach materially different interaction policies to identical structure.
- [x] Switching presets during drag cancels exactly once and leaves one active recognizer.
- [x] Presets cannot send arbitrary events outside declared interaction routes.

## Phase 4: Web Drag Port

- [x] Add normalized `DragSample`, `DragRelease`, `DragOptions`, and `mountDrag` to
      `@poggers/kit/web`.
- [x] Implement the production adapter with Anime.js Draggable without exposing its types or named
      backend instance.
- [x] Preserve axis-specific signed velocity, pointer capture, bounds refresh, cancellation, and
      velocity handoff.
- [x] Keep release animation out of the recognizer; retained preset motion owns settlement.
- [x] Support dependency injection of a deterministic drag driver for tests.
- [x] Revert Anime scopes, listeners, observers, and pointer ownership on cleanup.

### Gate 4

- [x] Drag samples stay bounded and directionally correct and preserve signed release velocity.
- [x] Stop, cancel, replacement, and disposal each emit exactly one terminal outcome.
- [x] No callback fires after disposal, including delayed Anime.js callbacks.

## Phase 5: Motion Backends

- [x] Model backend requirements explicitly: continuity, interruption, liveness,
      layout, and snapshot eligibility.
- [x] Implement a pure deterministic backend resolver with an inspectable decision reason.
- [x] Preserve the current direct, Anime Animatable, and Anime Layout adapters behind one contract.
- [x] Add a WAAPI adapter for independent compositor timing with cancellation, replacement, commit,
      stale-completion protection, and cleanup. Velocity-preserving springs deliberately remain on
      Anime rather than being approximated by WAAPI.
- [x] Add a View Transition adapter for eligible atomic transitions with custom pseudo-element motion,
      skip/replacement handling, and retained-DOM fallback.
- [x] Never select snapshots for pointer-linked, editable, live, or continuity-required transitions.

### Gate 5

- [x] Resolver table tests cover every capability category and fallback.
- [x] Fake, Anime, WAAPI, and View Transition traces converge on the authored endpoint and one
      terminal outcome for the semantics each backend is eligible to implement.
- [x] Reversal preserves value and velocity where the authored contract requires continuity.
- [x] Stale completion from any backend cannot settle a newer statechart transition.

## Phase 6: Migration

- [x] Migrate Chat, Site, and Visual Lab from `Actions`/`send` to `Events`/`events`.
- [x] Remove Anime.js imports from all applications.
- [x] Move Visual Lab drag availability, bounds, thresholds, resistance, and motion into each preset.
- [x] Keep semantic dialog state, views, accessibility, and hierarchy in structure.
- [x] Migrate the create-poggers template and generated declarations.
- [x] Remove obsolete package dependencies and dead compatibility code.

### Gate 6

- [x] Source search finds no legacy component `Actions`, render-scope `send`, dotted UI event names, or
      application Anime.js imports.
- [x] All applications typecheck and build; a fresh scaffold passes its packaged typecheck, framework
      check, production build, and dev-server startup.
- [x] Family and Studio retain identical semantics with materially different visual and interaction
      behavior.

## Phase 7: Adversarial Conformance Suite

- [x] Cover nested/parallel states, controlled composition, drag, snap, cancellation, presence,
      crossfade, reorder, layout, text reflow, virtualization, responsive conditions, reduced motion,
      native dialog focus, and asynchronous disposal in focused tests sharing one reference model.
      Keeping these diagnostic cases focused proved clearer than one monolithic fixture.
- [x] Generate seeded event traces and assert state, ownership, accessibility, and settlement
      invariants after every operation.
- [x] Add deterministic fake-clock translation snapshots for authored intent and lowered operations.
- [x] Add lifecycle torture cases that dispose during interaction and animation phases.
- [x] Add mutation tests proving revision guards, cleanup, batching, velocity transfer, and backend
      restrictions are necessary.

### Gate 7

- [x] At least ten thousand generated traces complete deterministically with no leaked owner.
- [x] Identical inputs and fixed seeds produce identical traces across runs.
- [x] Each mutation in the semantic and focused production campaigns is killed by its oracle.

## Phase 8: Integrated Verification

- [x] Run repository typecheck, lint, format, unit, property, and mutation suites.
- [x] Run production builds for every application.
- [x] Scaffold a new application from the local template and run its available typecheck, framework
      check, build, and dev-server startup gates.
- [x] Verify with the in-app browser: open/close, drag/flick/cancel, rapid reversal, preset switch
      during motion, compact/desktop behavior, focus restoration, and no fresh console error. Verify
      reduced-motion endpoint behavior in the deterministic adapter suite.
- [x] Verify HMR preserves state and leaves one listener/recognizer/backend owner.
- [x] Inspect final source for dead adapters, generated residue, and empty directories while preserving
      unrelated pre-existing worktree changes.

### Final Gate

- [x] All earlier gates are closed with evidence recorded below.
- [x] The final implementation matches `docs/web-ui-design.md` without exceptions hidden in examples.
- [x] Any platform limitation is documented honestly rather than declared complete.

## Work Log And Evidence

- 2026-07-13: Baseline audit found Anime.js Draggable, gesture thresholds, and dotted state-machine event
  names in Visual Lab structure. Kit already owns retained Anime motion and layout adapters, so the
  migration will consolidate rather than replace those mechanisms.
- 2026-07-13: The final generic contract uses `Events`, `Parameters`, writable presentation Values,
  and Parts. Presets receive symbolic event/Part/value references, own interaction declarations, and
  cannot imperatively dispatch events or access backend objects.
- 2026-07-13: Kit check passes 574 tests across 25 files after focused additions. The component suite
  includes 10,000 generated lifecycle traces; seeded adapter suites cover interruption, gesture
  lifetime, presence, layout, accessibility, and retained ownership.
- 2026-07-13: Mutation gates killed 343/343 semantic mutations and 4/4 focused production motion
  mutations.
- 2026-07-13: Root typecheck, lint, format, and test gates pass. Chat, Site, and Visual Lab production
  builds pass. A fresh local scaffold passes `poggers typecheck`, `poggers check`, production build,
  and dev-server startup using packaged declarations and `@poggers/kit/tsconfig`.
- 2026-07-13: In-app browser verification covered both Family and Studio compact drags, partial-drag
  spring return, velocity dismissal, desktop drag disabling, focus restoration, exit reversal,
  preset replacement during motion, retained layout resize sampled from 190px to 411px, and HMR with
  state preservation. No fresh console errors appeared; the post-HMR drag moved once and settled once.
- 2026-07-13: View Transitions remain restricted to explicit snapshot-safe atomic transactions.
  Ordinary component events stay synchronous and use retained DOM/Anime layout; automatically
  deferring them into `startViewTransition` would change event ordering and is therefore forbidden.
