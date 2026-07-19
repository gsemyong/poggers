# Web motion realization

This is the living source of truth for proving and implementing Poggers' web
motion system. It is complete only when every checked item and acceptance gate
has executable evidence. The implementation has no compatibility requirement.

## Objective

The web Presentation adapter must turn semantic desired visuals and transition
parameters into the most appropriate native execution strategy while preserving
continuity, velocity, lifecycle ownership, accessibility, and interaction.

```text
Component state and input
`- pure Presentation declarations
   `- web motion planner
      |- direct native assignment
      |- Web Animations
      |- live FLIP
      |- View Transition snapshot handoff
      `- shared frame driver for values native animation cannot realize
```

Authors describe the result and its physical transition. They never select
WAAPI, Anime.js, View Transitions, FLIP, Pretext, or `requestAnimationFrame`.
Those are replaceable implementation details of the web adapter.

## Decisions to prove

1. One analytical trajectory is the source of truth for position and velocity.
   Native animations are renderers of that trajectory, not state owners.
2. Interruption samples the current analytical value and velocity, cancels the
   renderer, and starts the next trajectory from exactly that state.
3. Presentation may choose different enter, exit, dismissal, and return springs
   from semantic Component state. It does not invoke actions or own behavior.
4. Direct gesture values are applied without smoothing. Release and cancellation
   begin from the measured gesture velocity.
5. Static and conditional styling remains CSS. Frame-rate values never generate
   classes or rewrite the Presentation stylesheet.
6. WAAPI is preferred for compatible compositor-friendly motion. A sampled
   `linear()` easing or keyframe sequence approximates the analytical spring
   under a documented error tolerance.
7. Layout changes use one coordinated read, mutation, read, write FLIP cycle.
   Layout and paint properties animate directly only when no equivalent
   transform realization exists.
8. View Transitions are optional snapshot acceleration. They are selected only
   when the intermediate image is materializable, required interaction remains
   available, and snapshot cost is justified.
9. An interrupted View Transition may use snapshot-to-live handoff: sample the
   trajectory, materialize the same intermediate state on live DOM, skip the
   snapshots before paint, and begin the next transition with preserved velocity.
10. Pretext is used only when line geometry itself must be predicted or animated.
    Normal browser text layout and container FLIP do not depend on it.
11. One target/property has one owner, one document has one coordinated scheduler,
    and disposal cancels every owned animation and pending frame exactly once.
12. Reduced-motion policy changes realization without changing Component logic.

## Classification model

The planner classifies motion along independent dimensions:

- continuity: one-shot, reversible, retargetable, or gesture-coupled;
- topology: stable, entering, exiting, reordered, reparented, or replaced;
- geometry: known, DOM-measured, text-predicted, or externally rendered;
- rendering cost: compositor, paint, layout, or external GPU renderer;
- materialization: live intermediate state possible or snapshot-only;
- interaction: passive or continuously hit-testable;
- coordination: independent, staggered, sequenced, or shared timeline;
- scale: one, hundreds, or thousands of targets;
- timeline: clock, gesture, scroll, or media.

Every planner decision must be deterministic from declaration meaning, native
capabilities, environment preferences, and measured topology. Runtime timing
must not silently change semantic behavior.

## Required authoring result

The pressure tests converged on this public syntax:

```ts
const theme = {
  motion: {
    enter: createSpring({ duration: 280, bounce: 0.12 }),
    exit: createSpring({ stiffness: 520, damping: 42 }),
    cancel: createSpring({ stiffness: 650, damping: 46 }),
  },
} as const;

const presentation = ((values) => ({
  Dashboard: {
    SheetPanel: ({ state }) => ({
      motion: {
        transform: {
          value: { translate: { y: state.sheetOffset } },
          velocity: { translate: { y: state.sheetVelocity } },
          transition: state.sheetDragging
            ? undefined
            : state.sheetOpen
              ? values.motion.enter
              : values.motion.exit,
        },
        layout: { identity: "sheet-panel", transition: values.motion.cancel },
      },
    }),
  },
})) satisfies WebPresentation<App, typeof theme>;
```

`createSpring` creates immutable parameter data. An absent transition means an
immediate assignment, which is the direct path required during a gesture.

## Falsification result

The experiments rejected the idea that one DOM animation mechanism is optimal
for every case. They retained one authored motion meaning and a deterministic
adapter planner:

| Meaning                             | Preferred web realization                        | Deterministic fallback               |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Static and conditional appearance   | Compiled CSS                                     | Direct inline value                  |
| Direct gesture value                | Direct independent transform                     | Direct transform                     |
| Opacity or transform spring         | Sampled WAAPI trajectory                         | Shared frame driver                  |
| Stable or shared layout             | Coordinated live FLIP                            | Final geometry directly              |
| Entry and retained exit             | Presence lifecycle plus native spring            | Direct lifecycle completion          |
| Passive bounded snapshot            | View Transition when all safety facts are proven | Live FLIP or presence                |
| Ordinary wrapping text              | Browser layout plus container FLIP               | Browser layout directly              |
| Predictive line geometry            | Private text driver when justified               | Browser layout without line morphing |
| Canvas, WebGL, WebGPU, or native UI | Its platform adapter's renderer                  | Adapter-defined final assignment     |

This establishes the intended boundary. Core Presentation is an open typed
contract, so a renderer-specific adapter may define its own properties. The web
DOM language does not pretend to describe a shader, native view, or SVG's whole
attribute model. Within the DOM adapter, however, authors express desired
values, velocity, layout identity, presence, and spring parameters exactly once.

The View Transition handoff probe produced zero geometric and opacity
discontinuity at sampled interruption points after materializing the analytical
pose on live DOM. It also showed that snapshots cannot provide continuous live
hit testing. The current adapter therefore keeps the strategy disabled until it
owns the authored mutation transaction and can prove passive interaction. This
is a deliberate planner result, not an unfinished public mode.

Pretext remains absent. Browser layout plus coordinated FLIP correctly handles
the accepted family-drawer wrapping and height case. A predictive text engine is
warranted only when individual line geometry is itself the authored animation.

## Stress corpus

- iOS-style sheet: drag, release, dismissal, cancellation, reopen during settle;
- family drawer: content replacement, wrapping text, coordinated height change;
- shared card: forward navigation, immediate reverse, and interrupted handoff;
- reordered grid: stable identity, enter, exit, reorder, and reparent;
- command menu: filtering and selection among 10,000 virtualized rows;
- streaming message: continuously changing text and bubble geometry;
- anchored surface: moving anchor, collision response, and viewport resize;
- crossfade: unrelated old/new content that cannot be one live DOM state;
- scroll-linked scene and direct pointer-following scene;
- SVG attribute, Canvas, WebGL/WebGPU, and large-target motion probes.

These cases pressure the primitive categories. They are not separate product
APIs and must not cause one-off framework abstractions.

### Corpus disposition

| Case                                  | Evidence or boundary                                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| iOS-style sheet                       | Executable trusted-pointer drag, velocity-aware release/dismissal, retained exit, reversal, focus restoration, and reduced motion      |
| Family drawer                         | Executable content replacement and wrapping-height FLIP; deterministic regression proves final settled geometry is measured            |
| Shared card and reordered grid        | Shared layout identity contract test covers replacement geometry; stable identity uses the same coordinated transaction                |
| Command menu                          | Fine-grained 10,000-leaf benchmark proves one changed leaf performs one native text assignment; selection motion is a compositor value |
| Streaming message                     | Synchronous mutation-settlement regression prevents intermediate text-tree measurement; later commits retarget the same layout owner   |
| Anchored surface                      | Structure supplies collision-resolved desired coordinates; direct or spring transform retargeting preserves one owner and velocity     |
| Crossfade                             | Presence contract covers unrelated retained old/new content through independent opacity trajectories                                   |
| Scroll and pointer timelines          | Structure supplies continuously sampled values with no transition; the adapter performs direct assignment without smoothing            |
| SVG, Canvas, WebGL, WebGPU, native UI | Falsifies a universal DOM declaration language; core permits a renderer-specific Presentation contract and adapter                     |

Fixed visual choreography is ordinary Presentation derivation over semantic
state and component input. Continuously coordinated timelines enter as sampled
state values and take the same direct path as gestures. The web adapter does not
add an imperative timeline or backend-selection DSL.

## Verification methodology

### Pure deterministic tests

- Analytical spring position, velocity, settling, under/critical/over damping.
- Continuity at random interruption and retarget times.
- Different forward and reverse parameters with preserved incoming velocity.
- Adaptive sampling error against the analytical solution.
- Planner choice for the complete classification matrix.
- Property ownership, replacement, cancellation, and disposal traces.
- Read/mutate/read/write scheduling with a virtual clock.
- Reduced-motion and unsupported-native-feature fallbacks.

### Driver contract suites

Each native driver runs the same injected-clock contract:

- rendered values match the canonical trajectory within tolerance;
- interruption has no value discontinuity and preserves velocity;
- stale completion cannot overwrite a newer target;
- equivalent commits perform no work;
- disposal leaves no animation, listener, temporary style, or frame;
- backend failure falls back without changing the desired final state.

### Real-browser conformance

- Inspect native animations, computed transforms, and DOM identity at selected
  timeline positions without waiting for wall-clock completion.
- Interrupt View Transitions at randomized progress points and compare the last
  snapshot pose with the first live-DOM pose before and after `skipTransition()`.
- Verify rapid reversal, same-frame replacement, hit testing, focus, and scroll.
- Exercise desktop, narrow mobile, reduced motion, CPU pressure, and resize.
- Capture frame timestamps, long tasks, forced layout count, native mutations,
  snapshot area, and animation/layer ownership.
- Use the available real browser controller; do not add Playwright.

### Performance evidence

- Cold start and warm retarget for one, 100, 500, and 1,000 targets.
- Direct gesture-to-paint latency and release-to-first-spring-frame latency.
- WAAPI sampled spring versus shared-frame rendering under main-thread pressure.
- Live FLIP versus View Transition capture for representative subtree sizes.
- Pretext prediction versus DOM measurement only for text-sensitive cases.
- Report p50/p95 and work counters in the benchmark command; correctness tests
  use deterministic operation budgets rather than flaky time thresholds.

## Implementation plan

### 0. Baseline and research record

- [x] Record current check, build, example, mutation, and interaction baselines.
- [x] Record the current standards/library facts that constrain each driver.
- [x] Inventory existing Anime.js drag/layout usage and remove duplicate ownership.
- [x] Keep all existing user work and unrelated changes intact.

**Gate 0:** the baseline is reproducible and every dependency has an explicit role.

### 1. Finalize minimal Presentation meaning

- [x] Pressure-test spring, desired value, layout identity, presence, coordination,
      and direct-manipulation meaning against the stress corpus.
- [x] Ensure Component state supplies semantic phase and gesture values while
      Presentation remains pure and cannot invoke actions.
- [x] Define immutable, verb-created spring parameters with inferred types.
- [x] Define the smallest web motion declaration with no backend terminology.
- [x] Add compile-time tests for valid target/property combinations and invalid
      or ambiguous declarations.

**Gate 1:** every stress case has a natural declaration; no case requires an
authored callback, backend selector, or second way to express the same meaning.

### 2. Implement the analytical motion kernel

- [x] Implement damped spring trajectories with position and velocity sampling.
- [x] Support physical and perceived parameter forms through one normalized model.
- [x] Implement settling criteria, retargeting, and edge-specific parameters.
- [x] Implement adaptive samples suitable for WAAPI `linear()` or keyframes.
- [x] Add deterministic and property-based tests, including adversarial values.

**Gate 2:** random interruption traces are continuous within numerical tolerance,
converge, remain finite, and preserve incoming velocity exactly at the boundary.

### 3. Implement deterministic planning and ownership

- [x] Represent native capabilities and environmental preferences explicitly.
- [x] Implement strategy selection from declaration meaning and native support.
- [x] Add one target/property owner and stale-completion protection.
- [x] Add one document scheduler with strict read/write phases.
- [x] Add contract tests for planner determinism, replacement, and disposal.

**Gate 3:** every classification has one preferred strategy and one explicit
fallback; random commit traces never create duplicate ownership or stale writes.

### 4. Implement live native drivers

- [x] Implement equality-guarded direct transform/opacity assignment.
- [x] Implement WAAPI sampled-spring rendering and clean interruption.
- [x] Implement live FLIP for stable and shared layout identity.
- [x] Integrate gesture velocity without smoothing direct manipulation.
- [x] Use Anime.js only through the thin injected draggable driver where it adds
      pointer sampling and velocity; it owns no visual trajectory.
- [x] Implement one shared-frame fallback when WAAPI is unavailable.

**Gate 4:** the driver contract suite passes for every live strategy, including
rapid reversal, velocity handoff, same-frame retargeting, and exact cleanup.

### 5. Falsify and implement View Transition handoff

- [x] Build an isolated handoff probe with custom WAAPI-controlled pseudo-elements.
- [x] Track the same trajectory in parallel using native animation time.
- [x] Materialize intermediate live transforms and opacity before skipping.
- [x] Test trajectory reversal separately from snapshot-to-live materialization.
- [x] Test snapshot hit testing and live focus/interaction ownership.
- [x] Define the exact materializability predicate and snapshot-cost heuristic.
- [x] Keep this strategy disabled until an authored transaction proves mutation
      ownership and passive interaction; live FLIP/presence is the safe fallback.

**Gate 5:** supported handoffs show less than 0.5 CSS-pixel geometric discontinuity
and less than 0.01 opacity discontinuity at randomized interruptions, with no
lost interaction. Unsupported cases deterministically use live FLIP/presence.

### 6. Establish the text-geometry boundary

- [x] Test browser layout plus FLIP for ordinary wrapping and height changes.
- [x] Evaluate the Pretext boundary against predictive line-geometry requirements.
- [x] Keep Pretext absent because no accepted stress case needs predictive lines.
- [x] Document the browser-layout fallback for unsupported predictive typography.

**Gate 6:** ordinary text needs no extra engine; predictive text cases either meet
geometry tolerance with Pretext or fall back without visual corruption.

### 7. Integrate Presentation and the executable corpus

- [x] Add motion realization to the existing Presentation adapter session.
- [x] Keep static class compilation and motion commits independent and incremental.
- [x] Extend the example with sheet, drawer-height, shared-layout, grid, and text cases.
- [x] Preserve DOM, state, focus, scroll, audio, image, and HMR ownership.
- [x] Verify no frame-rate state causes stylesheet or component remount work.

**Gate 7:** rapid interactions remain coherent in the executable corpus; every
motion is parameterized by Presentation and behavior remains in Structure.

### 8. Final verification and cleanup

- [x] Run typecheck, Oxlint, Oxfmt, unit/property tests, package build, production
      example build, benchmarks, and real-browser desktop/mobile acceptance.
- [x] Inspect every touched file for redundant concepts, helpers, and dependencies.
- [x] Remove failed experiments and obsolete animation machinery.
- [x] Update architecture and public documentation to describe only the final API.
- [x] Record evidence, limitations, and planner decisions in this document.

**Gate 8:** all checks pass; the stress corpus and strategy matrix are covered;
remaining platform limitations are explicit; the adapter has one coherent motion
surface and deterministic optimal realization for every supported category.

## Progress log

- 2026-07-19: Created the falsification-first plan after reviewing View
  Transitions Level 1, Web Animations, CSS Easing Level 2, Anime.js motion/layout/
  draggable APIs, and Pretext's text-layout boundary.
- 2026-07-19: Implemented normalized physical/perceived springs, analytical
  under/critical/over-damped trajectories, adaptive native samples, canonical
  interruption ownership, direct/WAAPI/shared-frame realization, coordinated
  layout FLIP, shared identity, retained presence, and reduced motion.
- 2026-07-19: The View Transition browser probe produced zero-pixel geometry and
  zero-opacity discontinuity at five interruption points. It also falsified live
  hit testing through snapshots, so the optimization remains gated behind the
  documented predicate and disabled without authored mutation ownership.
- 2026-07-19: `nub run check` passed typecheck, Oxlint, Oxfmt, 18 test files, and
  111 unit/property/contract tests. `nub run build` and the production example
  build passed; the production app emitted 143.62 kB, 48.39 kB gzip.
- 2026-07-19: The benchmark showed one of 10,000 state fields at 78.9 ns p50,
  one of 10,000 text leaves at 50.8 ns, analytical spring samples at 62.2 ns,
  and linear frame sampling from 64.3 ns for one target to 54.3 microseconds for
  1,000 targets. Correctness remains governed by deterministic work and error
  tolerances rather than machine timings.
- 2026-07-19: Fresh real-browser acceptance passed desktop, 390 by 844 mobile,
  trusted-pointer drag and spring return, threshold dismissal and reopen,
  wrapping layout replacement, reduced motion, and production output with no
  page errors. Anime.js remains only the injected pointer/velocity sampler; it
  owns no visual trajectory. Pretext and Playwright are absent.
