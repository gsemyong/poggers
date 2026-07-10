# Poggers Visual System v2 Completion Plan

## Objective

Ship one closed, TypeScript-first visual language for modern application UI.
Applications own semantics and behavior; presets own every visual and motion
decision. StyleX, Anime.js, and PreText are implementation backends and never
application authoring APIs.

This file is the execution contract and completion record. A checked item must
map to source, a test, or durable review evidence.

## Product Invariants

- [x] Values are values; actions are functions.
- [x] The generic app type is the source of component, state, variant, value,
      preset, theme, container, and token correctness.
- [x] `app.ts` owns component state, derived values, actions, native bindings,
      accessibility, and nonvisual setup.
- [x] UI modules compose generated parts and cannot replace component state,
      derived definitions, or actions.
- [x] Presets own tokens, themes, responsive composition, visual states, entry,
      exit, layout, shared geometry, and gesture motion.
- [x] Applications have no raw CSS, class, inline style, StyleX, Anime.js, or
      PreText escape hatch.
- [x] Preset callbacks are compile-time scopes, not runtime value wrappers.
- [x] Continuous values update typed variables without rerunning preset
      functions.
- [x] Layout observation is component-scoped and declaration-driven.
- [x] Every animated element has one runtime owner at a time.
- [x] Container responsiveness and logical directions are the defaults.
- [x] OKLCH is the canonical authored color format.
- [x] Reduced motion is automatic.
- [x] Generated artifacts live under ignored `.poggers` directories.
- [x] HMR preserves app/component state and does not replay mount motion.

## Phase 1: Closed Language And Types

### Implementation Checklist

- [x] Expose one public `Preset<App, Name>` generic from `@poggers/kit/style`.
- [x] Derive preset-specific token, theme, and container names from `App`.
- [x] Derive component parts, finite state, variants, shared names, and
      continuous value kinds from `App`.
- [x] Define one structured representation for OKLCH colors, fonts, gradients,
      strokes, shadows, filters, transforms, lengths, tracks, and motion tokens.
- [x] Define finite, nonrecursive visual domains for layout, frame, placement,
      spacing, surface, text, media, stroke, shape, effects, transform,
      position, scroll, interaction, decoration, and conditions.
- [x] Define change, enter, exit, layout, shared, and gesture motion intent.
- [x] Support reusable closure-local fragments through typed `use` composition.
- [x] Keep app-specific aliases shallow in generated `@poggers/app` types.
- [x] Remove mutable theme parameters and expose only typed theme selection.
- [x] Keep destructured `preset` and `theme` reactive in derived values and
      actions.

### Verification Gate 1

- [x] Valid type fixtures compile without casts or inference helpers.
- [x] Invalid fields, tokens, parts, values, and motion ownership fail at the
      authored field.
- [x] No backend type appears in the public preset declaration graph.
- [x] Generated component factories accept only input and variants.
- [x] Focused component runtime tests prove reactive state, values, presets,
      themes, and action resolution.

### Review Gate 1

- [x] Domains are orthogonal low-level primitives rather than framework cards,
      sheets, toolbars, or app layouts.
- [x] The API can describe data-grid, editor, media-control, canvas-overlay, and
      command-menu visuals without a raw-property escape.
- [x] Scope boundaries are explicit: data virtualization, timeline sequencing,
      and scroll-linked choreography are application behavior or future
      reviewed primitives, not unverified declarations.

## Phase 2: Compiler And StyleX Backend

### Implementation Checklist

- [x] Analyze app contracts and preset source locations with TypeScript AST APIs.
- [x] Evaluate only the token scope and per-component value scope from the built
      app module.
- [x] Reject nonserializable runtime values, cycles, class instances, undefined,
      symbols, and non-finite numbers.
- [x] Normalize a stable backend-neutral intermediate representation.
- [x] Validate unknown nested visual fields, condition shape, token/value kinds,
      motion references, and ownership conflicts.
- [x] Generate StyleX token variables, themes, atomic rules, pseudo-elements,
      native states, container/preference/capability conditions, and value vars.
- [x] Generate a compact runtime manifest for conditions and motion.
- [x] Process generated source with the official StyleX Bun plugin.
- [x] Integrate generation into sync, typecheck, dev, bundle, build, and HMR.
- [x] Write generated files by content comparison and atomic rename.
- [x] Point diagnostics to the authored preset source.

### Verification Gate 2

- [x] Deterministic IR snapshots match across repeated materialization.
- [x] Generated source compiles with the official StyleX plugin.
- [x] Production JavaScript contains no `stylex.create` or runtime style
      injection.
- [x] A fresh generated app installs, syncs, checks, typechecks, and builds with
      no generated files committed.
- [x] Editing a preset hot-updates extracted CSS.

### Review Gate 2

- [x] StyleX remains a replaceable backend boundary rather than public syntax.
- [x] There is one compiler path and one visual source of truth.

## Phase 3: Component Visual Transactions

### Implementation Checklist

- [x] Mount one visual coordinator per component instance.
- [x] Match only conditions and values referenced by compiled parts.
- [x] Batch current-presentation reads, cancellation, destination reads, and
      writes into distinct transaction phases.
- [x] Give each animated element one owner and deterministic cancellation.
- [x] Restore temporary transforms, origins, `will-change`, inertness, and
      lifecycle attributes after settle/cancel/dispose.
- [x] Integrate entry/exit retention with `Show`, reactive `hidden`, and native
      popover lifecycle.
- [x] Make exit content inert and accessibility-hidden before removal.
- [x] Implement component-scoped position, size/frame/track, shared, and text
      geometry strategies.
- [x] Preserve direct content by animating measured frame dimensions; use scale
      projection only when a preset explicitly requests content scaling.
- [x] Treat preset replacement as cancellation/replacement, not remount entry.
- [x] Remove the generic JSX runtime's body-wide automatic projection engine.

### Verification Gate 3

- [x] Runtime tests cover reactive component isolation, lifecycle retention,
      HMR state, and cleanup.
- [x] Browser tests find no stale transform, `will-change`, inertness,
      lifecycle marker, or duplicate dialog after rapid interruption.
- [x] Geometry reads are restricted to declared mounted component parts.
- [x] Preset replacement preserves open/query/selection state.

### Review Gate 3

- [x] Every benchmark animated property has one coordinator/backend owner.
- [x] Preset code contains no refs, queries, lifecycle setup, or engine calls.

## Phase 4: Motion Backends And Text Geometry

### Implementation Checklist

- [x] Select instant behavior for no-motion/reduced-motion transactions.
- [x] Select WAAPI through Anime.js for finite duration motion.
- [x] Select Anime.js springs for physics-based motion and gesture settle.
- [x] Normalize motion tokens to duration/easing or duration/bounce spring data.
- [x] Implement logical-axis pointer capture, direct tracking, bounds,
      rubber-banding, measured velocity, settle, and dismiss.
- [x] Cache PreText preparation and use it for declared text-height prediction.
- [x] Fall back to browser geometry when PreText cannot prepare the font/text.

### Verification Gate 4

- [x] Unit tests prove backend selection and malformed token rejection.
- [x] Compact browser tests prove direct drag, spring return, and flick dismiss.
- [x] Rapid open/close, resize, filter, preset, and gesture interruption converge.
- [x] Reduced-motion interaction reaches the same semantic final state.

### Review Gate 4

- [x] Native/static CSS is used for static visual work; Anime.js is used only
      where scheduling, interruption, or springs require it.
- [x] PreText assists declared text geometry rather than replacing normal
      browser layout or pretending to be app data virtualization.

## Phase 5: Visual Lab Benchmark

### Implementation Checklist

- [x] Build one focused, substantial command-menu component and stable part tree.
- [x] Use native Popover API semantics on desktop.
- [x] Implement keyboard search, arrows, enter, escape, focus return, listbox,
      options, loading, empty, error, status, and selection behavior.
- [x] Implement a compact bottom sheet with drag handle and touch-sized targets.
- [x] Build a quiet monochrome `precision` preset.
- [x] Build a dimensional but disciplined `tactile` preset.
- [x] Build a typography-led asymmetric `editorial` preset.
- [x] Give each preset independent composition, density, typography, surfaces,
      responsive rules, focus treatment, and motion character.
- [x] Add a typed theme switch and preserve theme across preset replacement.
- [x] Reuse preset-local fragments without adding framework recipes.

### Verification Gate 5

- [x] All presets share one app state/action/controller/UI contract.
- [x] Computed visual fingerprints differ for all three presets while semantic
      signatures remain identical.
- [x] Desktop, compact, RTL, 320px, 200% text, and long-content layouts remain
      within the viewport.
- [x] Pointer, keyboard, and drag journeys work.
- [x] Axe reports no WCAG A/AA violations for any preset.
- [x] Forced-colors mode retains a visible focus indicator.

### Review Gate 5

- [x] Review final desktop and compact captures for all three presets.
- [x] Reject accidental pills/ellipses, inconsistent geometry, clipping,
      novelty depth, weak hierarchy, and motion residue.
- [x] Confirm paused open/closed states are coherent compositions without motion.

## Phase 6: Migration And Deletion

### Implementation Checklist

- [x] Port chat, site, visual-lab, and the generated template to the v2 preset.
- [x] Move StyleX, Anime.js, and PreText dependencies behind `@poggers/kit`.
- [x] Remove direct StyleX preset lifecycle APIs.
- [x] Remove the semantic style compiler and generated semantic declaration
      graph.
- [x] Remove mutable theme-value APIs, UI state/action/derived overrides, and
      old dependency-name fallbacks from production generation.
- [x] Remove implicit layout projection, the old motion adapter, and their tests.
- [x] Replace the 2,100-line legacy runtime test with a focused v2 suite.
- [x] Rename the internal engine to `component-runtime.ts`.
- [x] Remove abandoned demo apps, stale visual plans, and screenshot archives.
- [x] Update architecture, API, compiler, motion, verification, and generator
      documentation to one supported path.

### Verification Gate 6

- [x] Repository search finds no application/template backend import or direct
      preset API.
- [x] Public package export review exposes one visual/motion surface.
- [x] Kit suite passes after deletion: 324 tests across 20 files.
- [x] Fresh generated app succeeds without per-app TypeScript path boilerplate.
- [x] Confirm no tracked generated output, transient reports, empty directories,
      or dangling obsolete files remain.

### Review Gate 6

- [x] Compatibility code is deleted rather than hidden behind another adapter.
- [x] Each remaining visual-system source file has one clear role: types,
      compiler, StyleX backend, runtime, preset export, component runtime.

## Phase 7: Final End-To-End Proof

### Automated Checklist

- [x] Visual-lab Playwright suite covers 11 interaction/accessibility/stress
      journeys.
- [x] Preset HMR preserves open state and query and does not replay entry.
- [x] Reduced motion, forced colors, RTL, 320px reflow, 200% text, and long text
      pass.
- [x] Rapid interruption collects no browser console/page errors.
- [x] Run root format, lint, typecheck, test, and build from current sources.
- [x] Build and launch the final production visual-lab binary.
- [x] Repeat the critical keyboard, preset, theme, and compact interactions
      against the production binary.
- [x] Capture final precision, tactile, and editorial desktop/compact evidence.

### Verification Gate 7

- [x] All root checks and first-party production builds pass uncached.
- [x] Production critical journey has no browser/server error.
- [x] Final screenshot geometry and interaction review passes.
- [x] `docs/visual-system-v2/verification.md` contains final commands and results.

### Review Gate 7

- [x] Every product claim maps to source, an automated test, or browser evidence.
- [x] Remaining limitations are documented as platform/API boundaries rather
      than marked complete.

## Required Test Matrix

| Surface                          | Required evidence                   | Status   |
| -------------------------------- | ----------------------------------- | -------- |
| Type algebra and invalid syntax  | compile fixtures and diagnostics    | complete |
| IR and StyleX lowering           | deterministic/compiler tests        | complete |
| Component reactivity             | component runtime tests             | complete |
| Lifecycle and cleanup            | UI/runtime plus real browser        | complete |
| 1440 and 1024 desktop            | Playwright and captures             | complete |
| 390 and 320 compact              | drag/reflow tests and captures      | complete |
| Themes and three presets         | semantic/fingerprint/theme tests    | complete |
| Keyboard and pointer             | Playwright journeys                 | complete |
| Reduced motion/forced colors/RTL | Playwright media/direction gates    | complete |
| HMR                              | source edit with state preservation | complete |
| Fresh generator                  | install/check/typecheck/build       | complete |
| Production binary                | critical journey                    | complete |
| Full workspace                   | format/lint/typecheck/test/build    | complete |

## Completion Definition

The goal is complete when the remaining Phase 5, 6, and 7 boxes are checked,
the final workspace and production runs pass, and the verification document
records the evidence. No compatibility path may be reintroduced merely to make
a stale test or document pass.
