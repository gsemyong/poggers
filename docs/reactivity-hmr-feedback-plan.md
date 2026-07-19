# Reactive runtime, instant development, and presentation feedback

This document is the living source of truth for making Poggers' reactive UI
path maximally fine-grained, making development replacement feel instant, and
proving that adapter-defined Presentation languages can express non-visual
feedback such as parameterized audio without mixing Presentation and behavior.

The migration has no compatibility requirement. It is complete only when every
checklist item and acceptance gate below passes and the executable example
demonstrates the resulting surface.

## Objective

Poggers must provide one coherent path from authored state to native effects:

```text
authored action
`- one reactive transaction
   `- only affected computations
      `- one coordinated platform commit
         |- direct DOM leaf updates
         |- cached/static Presentation realization
         `- adapter-owned declarative feedback
```

Development must preserve the same product semantics while replacing changed
definitions directly through Vite's live module graph:

```text
file change
`- incremental semantic analysis
   `- classify the affected definition
      `- patch the live definition without a development bundle
```

## Architectural decisions

1. Alien Signals remains the sole reactive graph engine. Poggers optimizes the
   work around propagation instead of introducing a second reactive system.
2. Authored state remains ordinary mutable-looking TypeScript. Runtime and
   generated implementations may lower it to direct signal cells.
3. One independently observable state field or collection entry must not
   invalidate unrelated state.
4. Actions are the transaction boundary. A dependent computation runs at most
   once for one synchronous action.
5. Components do not rerender. Reactive JSX updates native leaves directly.
6. Presentation remains a pure function of parameters, props, state, and named
   targets. It cannot invoke actions or cancel behavior.
7. Presentation declarations are adapter-defined meaning. Core does not add
   audio, feedback, motion, tokens, or browser events.
8. The canonical web Presentation language exposes declarative feedback, not
   authored event callbacks. The web adapter owns native observation,
   scheduling, resource reuse, and cleanup.
9. A specialized adapter may define any typed declaration language, including
   callback-bearing declarations when that adapter deliberately chooses them.
   Core neither requires nor forbids that choice.
10. HMR uses Vite's live browser module graph. Development needs no server-side
    application evaluation, so a ModuleRunner and a production-style bundle
    are both absent from the edit path.
11. Benchmarks measure performance; deterministic tests enforce work and
    mutation budgets. Wall-clock thresholds are used only in a dedicated local
    benchmark, never as flaky unit-test assertions.

## Required authoring result

Theme values remain ordinary, fully inferred Presentation parameters. Audio is
therefore parameterized by the same mechanism as color or spacing without
making `token` a core concept:

```ts
const theme = {
  color: {/* ... */},
  audio: {
    control: createAudioAsset(new URL("./control.wav", import.meta.url)),
  },
} as const;

const createEditorial = ((parameters) => ({
  Dashboard: {
    Application: ({ state }) => ({
      Density: {
        ...control(state.compact),
        feedback: {
          activate: { audio: parameters.audio.control },
        },
      },
    }),
  },
})) satisfies WebPresentation<App, typeof theme>;

export const editorial = createEditorial(theme);
```

`activate` is a read-only semantic observation realized by the paired web
adapter. Structure still owns the action, accessibility, cancellation, and
native behavior. Presentation feedback cannot call the action or receive a
cancelable native event.

## Reactive performance invariants

- A write to one top-level field invalidates only dependents that read it.
- Nested records and collections have a documented fine-grained mutation path;
  mutating one key or item does not invalidate unrelated keys or items.
- State access does not perform a `Proxy -> Map -> signal` lookup. Fixed root
  names resolve against a direct signal-cell table.
- Synchronous actions batch every write, including nested component actions.
- An effect reads the newest state while downstream effects run at most once.
- A primitive text update mutates an existing Text node rather than replacing
  the dynamic range.
- Attribute, property, class, and style writes are equality-guarded.
- Static declarations compile once. Previously realized declarations reuse
  their generated class and CSS without rebuilding the stylesheet.
- Several affected Presentation sessions produce one platform flush.
- Runtime and adapter disposal remove every effect, listener, pending task, and
  owned native resource exactly once.

## HMR performance invariants

- Vite does not invoke `build()` for a development edit.
- Semantic extraction reuses an incremental TypeScript program.
- Changed Presentation dependencies are identified from semantic/module
  ownership, not a `src/presentations/` path convention.
- Presentation-only updates preserve DOM identity, state, focus, selection,
  scroll, adapter sessions, and decoded audio resources.
- Full implementation changes preserve compatible authored state and activate
  transactionally. Target-level Component replacement remains a later
  optimization, not a correctness dependency.
- Contract changes use the existing manifest compatibility decision and never
  silently apply incompatible state.
- Failed candidates leave the previous application alive and interactive.
- Poggers adds single-digit milliseconds of framework work after Vite has
  transformed a small Presentation-only edit on the reference machine.

## Feedback and audio invariants

- `feedback` belongs only to the web Presentation language.
- Audio assets are typed parameter values and can differ between themes.
- The declaration is data; it contains no authored callback.
- Native listeners are delegated or shared by the adapter rather than added
  once per declaration commit.
- Presentation observation is passive and cannot prevent, stop, or reorder
  Structure behavior.
- Pointer, keyboard, touch, disabled, repeated-press, and canceled interaction
  semantics are deterministic and tested.
- A document owns at most one lazily created AudioContext for this adapter.
- Encoded assets and decoded buffers are cached and shared.
- AudioContext startup occurs through user activation and handles a suspended
  or interrupted context.
- Each playback creates only the short-lived source/gain nodes required by Web
  Audio; disposal stops owned playback and releases adapter references.
- Missing, failed, disabled, or unsupported audio degrades to silence without
  breaking the behavior action.

## Verification strategy

### Deterministic unit tests

- Reactive graph tests count computations, reads, writes, and disposal.
- State tests cover top-level, nested, collection, batching, and unknown-field
  behavior.
- Browser mutation probes assert text-node identity and exact native operations.
- Presentation tests use instrumented hosts to count compilation, class
  changes, registry flushes, and session disposal.
- Feedback tests use an injected interaction/audio driver and virtual clock;
  they do not require speakers or timing sleeps.
- HMR tests cover manifest compatibility, rollback, and disposal; live browser
  probes cover semantic classification and Presentation identity preservation.
- Property tests cover random state and declaration/session commit traces where
  shrinking adds evidence.

### Benchmarks

- Direct Alien Signal versus Poggers state read/write overhead.
- One-of-10,000 state field update.
- One-of-10,000 text binding update.
- Batched fan-out and deep dependency-chain propagation.
- Presentation cold compilation and warm reuse.
- HMR semantic analysis and candidate activation, reported separately.

Benchmarks report operations, work counters, p50, and p95. They document the
machine and runtime and are not part of the default correctness test command.

### Real-browser acceptance

Use the framework's development server and the available browser controller,
without Playwright or another end-to-end dependency. Verify the example at
desktop and mobile dimensions, keyboard and pointer input, rapid repeated
activation, HMR state/DOM preservation, stylesheet mutation counts, console
errors, and audible playback when the environment permits it.

## Implementation plan

### 0. Establish evidence and preserve scope

- [x] Record the current check/build result and browser mutation baseline.
- [x] Add focused work counters or test seams without changing public product
      syntax.
- [x] Add a dedicated benchmark command and concise benchmark documentation.
- [x] Keep the current executable example outside package `src/` while keeping
      its own source under `examples/web-presentation/src`.

**Gate 0:** baseline evidence is reproducible; no unrelated dependency or
architecture change is included.

### 1. Optimize state storage and transactions

- [x] Replace the top-level `Proxy -> Map` state path with a stable direct
      signal-cell table.
- [x] Make the public Feature API read directly from those cells without a
      duplicate reactive lookup.
- [x] Define and implement fine-grained nested record/array semantics, favoring
      lazy per-property cells and stable proxies only where dynamic structure
      requires them.
- [x] Preserve action batching and prove nested action behavior.
- [x] Unify Program and Component state cells behind one internal primitive
      without adding an author-facing state API.
- [x] Add deterministic and property-based state trace tests.

**Gate 1:** one unrelated field or collection-key write executes zero unrelated
computations; every existing state/action/lifecycle test passes; benchmark
evidence shows no regression against the old top-level path.

### 2. Minimize DOM reactive work

- [x] Add a specialized primitive text binding that retains Text node identity.
- [x] Audit property, attribute, style, class, visibility, and collection
      bindings for equality guards and redundant allocations.
- [x] Ensure compiler lowering creates the smallest binding scope and rejects
      accidental snapshots of reactive values.
- [x] Add exact browser mutation evidence for scalar updates; collection
      operation coverage remains in the existing renderer tests.

**Gate 2:** changing the demo's density label performs one character-data write
and no node replacement; unrelated DOM remains untouched.

### 3. Make Presentation commits incremental

- [x] Separate declaration resolution from native application so unchanged
      targets receive no native writes.
- [x] Cache compiled declarations by source identity and canonical meaning for the lifetime of the
      registry, including zero-reference warm entries with bounded ownership.
- [x] Batch all dirty registry work into one coordinated platform flush.
- [x] Avoid rewriting stylesheet text when the emitted CSS is unchanged.
- [x] Evaluate compiler-assisted target-level dependency lowering. It is
      deliberately deferred until the motion layer because the current static
      language already meets native mutation budgets and an expression DSL is
      not justified.
- [x] Keep continuous frame-rate values outside static class generation; their
      direct native path belongs to the next motion-language design.
- [x] Add commit-trace property tests and browser mutation-budget probes.

**Gate 3:** one density toggle causes at most one stylesheet flush; returning to
a previously realized state causes zero stylesheet rewrites; only targets whose
resolved declarations changed receive class/native mutations.

### 4. Replace the development rebuild pipeline

- [x] Split production preparation from development semantic preparation.
- [x] Remove `vite.build()` and temporary evaluation bundles from the HMR path.
- [x] Keep application evaluation in Vite's live browser graph; no development
      ModuleRunner is required.
- [x] Retain an incremental semantic compiler/program across full updates.
- [x] Track Presentation ownership and transitive dependencies semantically,
      independent of file or directory names.
- [x] Classify and emit the narrowest valid Presentation or full update.
- [x] Preserve transactional candidate activation and rollback.
- [x] Add instrumentation for semantic preparation and browser activation.

**Gate 4:** presentation edits never build a bundle or remount the application;
the example preserves state and DOM identity; framework-side p95 is within the
documented instant-update budget on the reference machine.

### 5. Add declarative web feedback and parameterized assets

- [x] Expand the web element Presentation declaration with a typed `feedback`
      category while keeping existing style syntax direct.
- [x] Define the smallest asset-backed audio declaration and a verb-named
      creation helper. Do not invent a synthesis DSL before evaluating the
      selected synthesis library.
- [x] Implement an injected, lifecycle-owned web feedback driver.
- [x] Normalize activation across pointer, touch, keyboard, disabled state, and
      click suppression without giving Presentation a native event.
- [x] Implement shared AudioContext, fetch/decode caching, gain/playback
      realization, suspension/interruption handling, and cleanup.
- [x] Add deterministic driver tests and Presentation type tests.
- [x] Add two audibly distinct control declarations to the executable example
      and select between them from reactive Component state.
- [x] Add typed image-source substitution on semantic `img` Elements without
      transferring accessibility or behavior to Presentation.
- [x] Prove equivalent image parameters cause zero native writes, changed
      parameters mutate the existing Element, and disposal restores Structure.
- [x] Show the active sound and icon choice in the executable example.

**Gate 5:** two themes can provide different audio assets or silence with no
Structure change; image parameters replace only the source of an existing
semantic image; one activation performs the action once and feedback once; all
lifecycle and failure paths are deterministic.

### 6. Integrate, benchmark, and document

- [x] Run typecheck, lint, formatting, unit/property tests, package build, and
      the dedicated benchmark suite.
- [x] Inspect the executable example in a real browser at desktop and mobile
      sizes with pointer and keyboard input.
- [x] Verify keyboard/pointer interaction, HMR during changed state, no console
      errors, no leaked style/listener/audio resources, and production parity.
- [x] Update architecture and public documentation to describe only the final
      system and remove obsolete static-only or rebuild-path claims.
- [x] Record final mutation and HMR evidence in this document.

**Gate 6:** every invariant and gate passes, the example demonstrates
parameterized audio feedback, and the default `check` plus package build are
green. Any remaining limitation is explicit, measured, and outside this goal.

## Progress log

- 2026-07-19: Audited current runtime. Alien Signals is used for Program and
  Component state; actions batch correctly. The density toggle currently causes
  four stylesheet rewrites, twenty class mutations, and two content mutations.
  Development updates currently execute a Vite SSR build and use a
  directory-name heuristic for Presentation-only replacement.
- 2026-07-19: Confirmed from Vite's current framework API that a runnable
  environment ModuleRunner transforms and evaluates live modules without a
  development bundle. Confirmed from the Web Audio specification that one
  AudioContext should be shared, may require user activation to resume, and
  decoded AudioBuffers are the appropriate reusable source for short sounds.
- 2026-07-19: Final browser mutation evidence for one density change is one
  retained Text-node `characterData` write, one class mutation per ten affected
  targets, and one stylesheet rewrite. Returning to the warm state performs no
  stylesheet rewrite. Unrelated native nodes retain identity.
- 2026-07-19: A live Presentation edit while non-default state was active took
  1.7 ms of framework semantic preparation and 0.6 ms of browser application on
  the reference machine. It produced one `presentation` update, changed the
  computed style, and preserved root, control, style element, and authored
  state identity. No development bundle or server evaluation ran.
- 2026-07-19: Mobile acceptance at 390 x 844 had no horizontal overflow,
  keyboard activation changed state exactly once, the audio asset loaded once,
  one Presentation stylesheet was owned, and the browser console was clean.
- 2026-07-19: Final verification passed 85 tests across 17 files plus typecheck,
  Oxlint, Oxfmt, the package build, and a production example build. The
  production artifact loaded one bundled module and one hashed WAV asset,
  remained interactive, and had a clean console. Six consecutive browser
  activations completed without lost state or duplicate resources.
- 2026-07-19: Closed the asset-substitution evidence gap. The example now
  selects warm/cool icon assets and 1.3/0.72 playback-rate audio parameters from
  the same reactive state. Real-browser inspection observed both playback rates,
  retained the same image node across both substitutions, and reported no page
  or console errors.
- 2026-07-19: Follow-up verification passed 87 tests across 17 files plus
  typecheck, Oxlint, Oxfmt, package build, and production example build. At
  390 x 844 the example had zero horizontal overflow, one Presentation style
  host, and a correctly sized 16 px substituted icon.
