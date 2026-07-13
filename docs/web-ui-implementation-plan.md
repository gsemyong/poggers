# Poggers Web UI API Migration Plan

## Status

- [x] Normative API written in `docs/web-ui-design.md`
- [x] Existing implementation and historical candidate audited
- [x] Public types match the normative API
- [x] Runtime and compiler match the normative API
- [x] Applications and template use only the normative API
- [x] Fast verification gates pass
- [x] Direct browser and HMR gates pass
- [x] Final review finds no competing legacy surface

This is the living source of truth for the migration. Update each checkbox only when its associated
evidence exists. Record commands, defects, and decisions in this file as work proceeds. There is no
backward-compatibility requirement.

## Definition Of Done

- [x] The explicit generic contract drives all component, native Part, state, action, slot, value,
      and preset types without an inference wrapper.
- [x] Component inputs are ordinary reactive values and function-valued callbacks; authors write no
      reactive function wrappers.
- [x] A controlled semantic fact has one owner and is never mirrored in component context or state.
- [x] Components compose through typed JSX inputs and slots while child internals remain private.
- [x] Parts accept exact native web props and events for their declared element.
- [x] `Part.attach` and core `Gestures`, `press`, `dismiss`, `navigate`, `shortcut`, `drag`,
      `dialogOpen`, and `popoverOpen` are removed.
- [x] Callback refs return cleanup that runs exactly once on replacement, conditional removal, HMR,
      and component disposal.
- [x] Owner-scoped effects are public, minimal, and dispose exactly once.
- [x] `derive`, state reads, context reads, input reads, JSX bindings, and preset reads remain
      fine-grained without component rerenders.
- [x] Public state configuration is typed rather than `unknown`; native exhaustive selection is
      possible without a framework matcher.
- [x] Presets receive only read-only presentation data and own all visual and motion decisions.
- [x] Reusable web interactions are ordinary toolkit code over native APIs and core ownership; the
      renderer has no semantic interaction hook.
- [x] Chat, site, Visual Lab, and create-poggers use the final surface.
- [x] Typecheck, lint, format, tests, builds, HMR, and direct browser acceptance pass.

## Phase 0: Baseline And Ownership Audit

### Work

- [x] Capture current typecheck, test, lint, format, and build results before migration.
- [x] Inventory every public component, gesture, semantic-binding, lifecycle, and native-prop export.
- [x] Inventory every use of `Part.attach`, `.element`, `.elements`, semantic bindings, gesture
      contracts, dialog/popover bindings, raw Anime.js, and native listeners.
- [x] Classify each current concept as core, web-toolkit, preset, application, or removal.
- [x] Identify existing dirty-worktree changes and preserve unrelated user work.

### Gate 0

- [x] The inventory has no unexplained public UI export.
- [x] Every failing baseline command is recorded before edits.
- [x] Migration ownership is unambiguous for every current call site.

## Phase 1: Type Surface

### Work

- [x] Replace hand-maintained Part prop subsets with exact `JSX.IntrinsicElements[Tag]` native types.
- [x] Type callback refs as `(element) => void | (() => void)`.
- [x] Keep read-only `Part.element` and `Part.elements`; remove `Part.attach`.
- [x] Remove `Gestures` from the application generic and all generated gesture action/binding types.
- [x] Remove semantic interaction props and custom dialog/popover-open props from core Part bindings.
- [x] Preserve compile-time rejection of `class`, `className`, and `style` in application structure.
- [x] Preserve generic-driven Input, callback, Slot, Action, Value, and Part typing.
- [x] Type active state paths and replace public `state.value: unknown` with a truthful typed
      configuration representation.
- [x] Export only the minimal owner-scoped reactive lifecycle required by application/toolkit code.
- [x] Keep package declarations synchronized with source and remove stale declaration aliases.

### Type Tests And Gate 1

- [x] Native button, dialog, input, SVG, ARIA, data, pointer, keyboard, focus, and form props infer
      exact event and element types.
- [x] Invalid native props and wrong event types fail.
- [x] Callback-ref cleanup has the exact native element type.
- [x] Component inputs remain reactive without author function wrappers.
- [x] Callback inputs remain functions and are never invoked as reactive getters.
- [x] Unknown child props and slot cardinality fail.
- [x] Parent code cannot access a child's private Parts, state, context, or actions.
- [x] Removed gesture and semantic-binding APIs fail typechecking.
- [x] Native exhaustive state projection compiles and a missing branch fails.

## Phase 2: Reactive Input, State, And Derivation

### Work

- [x] Keep render-once component ownership and compiler-generated lazy JSX bindings.
- [x] Preserve callback identity through compiler metadata derived from the generic
      input contract.
- [x] Ensure direct component JSX props retain liveness across parent updates without remounting.
- [x] Ensure context and state snapshots expose signal-backed property reads.
- [x] Keep `derive` pure and tracked; prevent mutation, listener installation, and event dispatch from
      derive.
- [x] Batch statechart snapshot, context, derived values, native bindings, and preset invalidation into
      one revision.
- [x] Remove redundant `actions` alias and retain one typed `send` surface.
- [x] Define and test the one-owner rule for controlled inputs in the normative contract and fixtures.

### Fast Tests And Gate 2

- [x] A component renders once across at least 10,000 state/context/input/value updates.
- [x] Updating one input patches only bindings and preset targets that read it.
- [x] Function-valued callbacks retain identity and are not executed by dependency tracking.
- [x] A parent input update reaches a mounted child without actor or DOM replacement.
- [x] One transition cannot expose an intermediate mixture of old and new derived values.
- [x] Derive dependency branches unsubscribe from inactive reads.
- [x] Component and child disposal release all computed signals and subscriptions exactly once.

## Phase 3: Native JSX And Lifecycle

### Work

- [x] Make native props and listeners the only core element-binding path.
- [x] Install each native listener once and remove it during element cleanup.
- [x] Implement callback-ref cleanup for owner disposal; replacement ordering remains gated below.
- [x] Make callback refs work on intrinsic elements and named Parts identically.
- [x] Expose owner-scoped `effect` with automatic cleanup and no hook ordering contract.
- [x] Remove `Part.attach` runtime attachment sets and cleanup machinery.
- [x] Remove custom dialog/popover props after migrating retained dialog control to the web toolkit.
- [x] Keep `For` and `Show` identity, presence retention, and cleanup coherent with refs.
- [x] Preserve HMR ownership without running stale ref or effect cleanup twice.

### Deterministic Tests And Gate 3

- [x] Ref attach, replacement, conditional removal, keyed reorder, HMR replacement, and owner disposal
      have exact attach/cleanup traces.
- [x] Cleanup runs in reverse ownership order where dependencies require it.
- [x] A native listener observes current signals without reinstalling.
- [x] Repeated mount/unmount leaves no observer, event listener, pointer capture, timer, or Anime
      controller.
- [x] `For` preserves refs for stable keys and disposes removed keys once.
- [x] `Show` reversal restores the same retained node without duplicate refs.

## Phase 4: Remove Core Browser Reimplementations

### Work

- [x] Remove semantic `press`, `change`, `submit`, `highlight`, `dismiss`, `navigate`, and `shortcut`
      handling from the core renderer.
- [x] Remove core gesture declaration, visual gesture scope, recognizer topology, and `drag="block"`.
- [x] Remove app compiler/runtime validation that assumes those removed concepts.
- [x] Retain interaction facts needed purely by presets when they can be derived from native state
      (`:hover`, `:active`, `:focus-visible`, ARIA, disabled) without author bindings.
- [x] Move reusable immediate press and retained dialog lifecycle into a focused web toolkit; keep
      one-off pointer recognition application-owned through callback refs and writable values.
- [x] Use Anime.js `Draggable` only inside toolkit/application code when it is the selected recognizer;
      do not expose Anime objects through component or preset contracts.

### Gate 4

- [x] A minimal application can use every relevant native event and browser method directly.
- [x] Toolkit code has no semantic renderer hook; its retained dialog bridge uses only package owner,
      scene, and native top-layer lifecycle.
- [x] Core package declarations contain no gesture recognizer or semantic press vocabulary.
- [x] Immediate press remains accessible to keyboard and cancel-safe in the toolkit.
- [x] Dialog behavior uses native top-layer APIs with deterministic focus, cancel, outside interaction,
      scroll lock, retained exit, and cleanup.

## Phase 5: Preset Boundary

### Work

- [x] Restrict component preset scope to typed values, interaction facts, geometry, environment,
      tokens, and visual constructors.
- [x] Remove statechart, context, input callback, DOM ref, resource, and action access from presets.
- [x] Keep values as ordinary read-only properties backed by exact dependencies.
- [x] Keep writable visual channels writable only in structure/toolkit code and read-only in presets.
- [x] Verify recipes are closure-local ordinary code and not an inference wrapper.
- [x] Preserve one target owner, retained motion, layout projection, presence, interruption, velocity
      handoff, and reduced-motion semantics.
- [x] Ensure responsive and interaction variation remains preset-owned.

### Type And Translation Gate 5

- [x] Presets cannot send, mutate context, install a listener, or access an element.
- [x] Presets cannot access undeclared or other-preset tokens.
- [x] Every preset read has a deterministic dependency in normalized IR.
- [x] Given a mocked value/environment snapshot, generated visual targets are deterministic.
- [x] Family and Studio produce materially different layout, paint, type, and motion from identical
      structure and values.

## Phase 6: Composition And Toolkit Proof

### Work

- [x] Add a focused parent/child fixture with typed inputs, callbacks, slots, keyed children, and
      private Parts.
- [x] Verify nested component scene identity supports layout and presence across boundaries.
- [x] Reimplement the Family Drawer using only native core APIs plus public toolkit helpers.
- [x] Keep exact behavior, accessibility, hierarchy, and data use in application/component code.
- [x] Keep all visual layout, responsive differences, and motion in Family and Studio presets.
- [x] Keep continuous pointer samples out of the statechart and semantic start/release/cancel events in
      it.
- [x] Verify desktop dialog and compact bottom-sheet behavior are separate preset presentations over
      the same semantic structure.

### Fast Tests And Gate 6

- [x] Controlled parent updates, child callbacks, and slot replacement preserve child identity when
      compatible.
- [x] Rapid open/close/reopen and duplicate activation cannot deadlock the component.
- [x] Drag follows the pointer, short release returns, committed release exits, velocity hands off,
      and interruption retargets from the presented value.
- [x] Exit releases modality and hit testing before retained paint finishes.
- [x] Backdrop, trigger, focus, scroll lock, and ref cleanup settle exactly once.
- [x] Content changes animate layout without remounting stable controls or jumping text.

## Phase 7: Application And Template Migration

### Work

- [x] Migrate Visual Lab first and remove all legacy call sites.
- [x] Migrate chat and site to native events, refs, effects, composition, and final presets.
- [x] Update create-poggers output and packaged declarations/configuration.
- [x] Remove unused toolkit imports, compiler branches, runtime branches, tests, and declarations.
- [x] Remove dangling empty directories and generated residue without touching unrelated user files.
- [x] Keep application source organization minimal: `app.tsx`, `types.ts`, `deps.ts`, and only
      substantial preset/assets modules.

### Gate 7

- [x] `rg` finds no `Part.attach`, `Gestures`, semantic core bindings, custom dialog/popover-open
      props, or old action alias in application/public code.
- [x] Fresh scaffold installs, typechecks, lints, builds, and hot reloads.
- [x] Chat, site, and Visual Lab typecheck and build through the packaged kit API.
- [x] No committed generated declarations are required in applications.

## Phase 8: Repository Verification

### Automated Gate 8

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run fmt:check`
- [x] `bun run test`
- [x] `bun run build`
- [x] Focused type fixtures and negative fixtures pass.
- [x] Lifecycle, reactive translation, controlled composition, presence, motion, and toolkit tests pass.
- [x] No test relies on Playwright or a virtual DOM.

### Direct Browser And HMR Gate 8

- [x] Use the Codex in-app browser against the real development server.
- [x] Verify desktop and compact Family and Studio presentations.
- [x] Verify pointer, compact presentation, keyboard, focus, cancel, outside dismissal, and repeated
      rapid interaction.
- [x] Verify short drag, velocity dismissal, interrupted release, close/reopen reversal, and compact
      condition changes.
- [x] Verify content/layout changes, text wrapping, hover stability, and no first-frame flash.
- [x] Verify style, token, motion, statechart, hierarchy, and toolkit HMR independently.
- [x] Verify no stale backdrop, blocked trigger, duplicate cleanup, console warning, or document-bound
      expansion remains.

## Phase 9: Final Review

- [x] Compare every exported UI symbol with `docs/web-ui-design.md` and justify it.
- [x] Confirm each concern has one authoring mechanism and one runtime owner.
- [x] Confirm native web capability is not hidden behind a Poggers equivalent.
- [x] Confirm the toolkit can be replaced by direct native application code.
- [x] Confirm preset code cannot change semantics and structure code cannot author visuals.
- [x] Confirm all checked gates cite current evidence rather than historical claims.
- [x] Record final command results, browser observations, and remaining limitations below.

## Work Log

### 2026-07-13

- Replaced the historical candidate specification with the native-first API contract.
- Reset historical completion checkboxes; previous tests remain useful baseline evidence but do not
  prove this migration.
- Identified immediate implementation priorities: native Part typing, cleanup-capable callback refs,
  removal of `Part.attach`, removal of core gesture/semantic browser APIs, typed state configuration,
  and toolkit migration.
- Baseline: typecheck and lint passed; 568 tests passed with 57,190 expectations; chat, site, and
  Visual Lab production builds passed. The only check failure was formatting in the newly written API
  document, to be normalized with Oxfmt after documentation edits.
- Classified core retention as native JSX, generic components, signals/statecharts, `For`, `Show`,
  scene identity, and preset lowering. Classified semantic bindings, recognizers, and custom
  dialog/popover controls for removal from core and reimplementation in the web toolkit.
- Added cleanup-returning intrinsic and Part refs, exact-once owner-disposal tests, migrated Visual Lab
  measurement and Anime Draggable ownership to refs, and removed `Part.attach` from source and package
  declarations.
- Removed the render-scope `actions` alias, migrated applications and the scaffold to `send`, and
  replaced semantic Part props with exact native event handlers.
- Found and fixed dropped `inputCallbacks` metadata in runtime normalization. A controlled
  parent/child test now proves data-down/callback-up updates preserve both render counts and child DOM
  identity.
- Restricted presets to read-only presentation values plus interaction, geometry, and environment;
  migrated all production presets and added negative type evidence for state/context/gesture access.
- Added `@poggers/kit/web` with native-handler `createPress`, `createShortcut`, and retained native
  dialog mounting. Removed custom dialog/popover props and migrated Visual Lab to a cleanup-owned ref.
- Removed the dormant preset-owned gesture compiler, gesture scope, Anime recognizer runtime,
  semantic shortcut/press renderer, and their declaration aliases. Visual Lab now owns Anime
  `Draggable` directly in a cleanup-returning Handle ref and publishes pointer-rate writable values.
- Tightened native JSX ARIA values and roles, added exact native callback-ref event typing, and added
  exhaustive `switch`/`satisfies never` state fixtures. `derive` is now capability-limited to reactive
  reads and cannot issue commands or navigate.
- Added deterministic proofs for 10,000 render-free component updates, atomic multi-field
  transitions, inactive derive dependency removal, controlled child identity, native listener
  stability, and exact ref cleanup through conditional removal and keyed reorder.
- A clean create-poggers install exposed and fixed one stale preset input read. The corrected scaffold
  installs, typechecks, lints, builds, runs, updates data, and preserves state through HMR against the
  packaged kit.

## Final Evidence

- `bun run check`: passed on 2026-07-13 after the migration: 563 tests and 55,390 expectations across
  25 files. Typechecking was uncached for kit, chat, site, and Visual Lab.
- `bun run build`: chat, site, and Visual Lab production executables all compiled successfully.
- Fresh scaffold at `/tmp/poggers-scaffold.EVywfR/app`: local package install, `poggers typecheck`,
  `poggers check`, and production build passed. Its counter remained at `2` while an application
  source edit and reversal hot-reloaded in the browser.
- In-app browser at `http://localhost:3041/`: Family and Studio rendered materially different
  presentations over one accessible dialog hierarchy; view changes, outside dismissal, focus
  restoration, 30 ms close/reopen reversal, and repeated opening remained interactive with no console
  errors.
- Browser HMR: an open Studio dialog retained state while a preset heading changed from `13px` to
  `14px` and back. Hovering an option preserved its exact font, width, height, and position.
- Compact browser proof: a temporary breakpoint-token probe entered the real compact StyleX branch.
  A short handle drag returned to rest; a longer velocity-bearing drag dismissed; the trigger was
  immediately enabled. Reverting the token hot-reloaded the desktop branch and restored the hidden
  handle with no residue.
- Repository search confirms no production `Part.attach`, application `Gestures` contract, semantic
  core press/navigation/shortcut props, custom dialog/popover-open prop, or public gesture recognizer
  implementation remains. Research-candidate tests retain the word “gesture” only as historical
  design evidence, not as shipped API.
