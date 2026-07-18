# Presentation Adapter Contract Proof Plan

Status: completed source of truth

## Goal

Find, implement, and falsifiably validate the smallest conventional TypeScript
contract through which a platform-specific **Presentation** can describe every
visual and sensory aspect of a product while remaining completely disjoint from
behavior, accessibility, product effects, and native imperative ownership.

The result must let Poggers add materially different presentation platforms,
including DOM/CSS, native UI, Canvas/WebGL/WebGPU, and 3D scene renderers,
without changing the generic Presentation grammar. Each adapter is free to
define the ideal declaration language for its platform.

This is a breaking design and implementation pass. There is no compatibility
layer for the current `platform`, `parts`, `input`, Preset terminology, or any
rejected Presentation-to-structure configuration channel.

## What Must Be Proved

There are two separate claims. They must not be conflated.

1. **Envelope sufficiency:** one generic outer contract can host any
   platform-specific presentation language without an escape hatch.
2. **Adapter-language sufficiency:** a concrete adapter language is expressive
   enough for the complete visual domain of its platform.

The first claim can be supported by type proofs, multiple incompatible adapter
languages, and boundary pressure tests. The second must be established
separately for every production adapter. A capable envelope cannot make a weak
web or 3D language complete.

Completion means strong evidence, not a mathematical claim that a finite visual
vocabulary anticipates every future platform. The generic envelope succeeds if
new visual meaning can be added inside an adapter's `Declaration` without a new
Core concept or alternate authoring path.

## Architectural Boundary

```text
Component structure
|- platform-specific JSX hierarchy and named Elements
|- props, product/feature state, and component state
|- semantics, accessibility, listeners, and Actions
|- Capabilities and product effects outside Presentation
`- stable instance and occurrence identities
                       |
                       v
Presentation(tokens)
`- Component({ props, state, targets })
   `- immutable adapter declarations for named Elements
                       |
                       v
Presentation adapter session
|- resolves native targets and presentation conditions
|- owns retained visual values, velocity, geometry, clocks, and presence
|- owns native resources and render-only visual subgraphs
|- interprets declarations atomically and incrementally
`- disposes all native ownership
```

Presentation is a pure mapping:

```text
(tokens, readonly props, readonly structural state, typed target identities)
  -> readonly declarations for named structural Elements
```

Presentation cannot call Actions, access Capabilities, mutate structural state,
read native handles, install listeners, own subscriptions, or create semantic
or focusable nodes.

## Accepted Terminology

- **Presentation:** one complete visual, motion, resource, and sensory design
  for an application or feature tree.
- **Theme:** a token value supplied to a Presentation. Changing a Theme changes
  parameter values; changing a Presentation may change the complete look and
  feel.
- **props:** values supplied to a Component instance through JSX. Use the
  conventional JSX term rather than `input` or `stuff`.
- **state:** the readonly reactive structural snapshot exposed to Presentation,
  including relevant feature and component-instance state. Name collisions are
  rejected rather than silently shadowed.
- **Element:** a named node in platform-specific Component structure.
- **target:** an opaque, typed identity used only to relate declarations to
  another named Element. It is never a native element or imperative ref.
- **Declaration:** immutable data in one adapter's complete presentation
  language for one target.
- **visual identity:** an explicit stable key used for relationships across
  component instances, routes, portals, or recycled native targets.
- **recipe:** an ordinary pure TypeScript function that accepts typed values and
  returns declaration data. It receives no privileged runtime authority.

`elements` is reserved for JSX constructors and structural nodes. `targets` is
used in Presentation because the values are declaration addresses, not native
elements. `refs` is rejected because it conventionally implies imperative
handles. `parts` remains rejected unless evidence shows that CSS-part anatomy
is more exact than Element/target for this architecture.

## Accepted Generic Contract

Presentation authors import the adapter-specialized type and use `satisfies`.
Core's actual outer grammar is equivalent to:

```ts
type PresentationLanguage = {
  readonly Declaration: object;
  readonly Declarations?: Readonly<Record<string, object>>;
};

type PresentationTarget<Name extends string, Scope> = Readonly<{
  readonly name: Name;
  readonly "poggers.presentationTargetScope"?: Scope;
}>;

type PresentationComponentScope<Props, State, Targets> = Readonly<{
  props: Readonly<Props>;
  state: Readonly<State>;
  targets: Readonly<Targets>;
}>;

type Presentation<App, Language extends PresentationLanguage, Theme extends object> = (
  theme: Readonly<Theme>,
) => PresentationDefinition<App, Language>;
```

The production web form is conventional TypeScript with no registration or
runtime constructor:

```ts
import { type WebPresentation, type WebPresentationTokens } from "@poggers/kit/presentation/web";
import type { App } from "src/app";

export const studioTheme = {
  color: { panel: { l: 0.17, c: 0.014, h: 255 } },
  motion: { sheet: { spring: { mass: 1, stiffness: 520, damping: 34 } } },
} satisfies WebPresentationTokens;

export const studioPresentation = ((tokens) => {
  return {
    Drawer({ state }) {
      const translation = state.dragging
        ? state.dragOffset
        : {
            target: state.open ? 0 : state.sheetHeight + 32,
            velocity: state.dragVelocity,
            transition: tokens.motion.sheet,
          };

      return {
        Surface: {
          paint: { fill: tokens.color.panel },
          motion: { translation: { block: translation } },
        },
      };
    },
  };
}) satisfies WebPresentation<App, typeof studioTheme>;
```

Component and nested Feature names mirror the product contract. Each Component
callback is contextually typed with its exact readonly `props`, flattened
program-plus-local `state`, and local typed `targets`; each returned key is an
exact named structural Element.

### Why `satisfies` Is the Default

- Presentation is authored data plus pure functions, not an object needing
  registration or runtime construction.
- `satisfies` preserves narrow inferred values while checking the complete
  generic contract.
- Generic parameters carry product meaning explicitly and are available to the
  TypeScript compiler frontend.
- A wrapper used only to recover inference is redundant API.

The experiments found no runtime responsibility for `createPresentation` and no
contextual-inference or compiler-extraction gap. The wrapper is rejected and is
not retained as another authoring path.

### Where `spring` Comes From

Core defines no `spring`, `sequence`, `animate`, CSS property, or Three.js
material. Motion belongs to an adapter's declaration language.

The canonical motion form is inspectable declaration data:

```ts
translation: { block: {
  target: state.offsetY,
  velocity: state.releaseVelocity,
  transition: tokens.motion.sheet,
} }
```

The raw declaration is the only canonical motion syntax. Applications may use
ordinary pure functions to return the same data, but the adapter exports no
parallel constructor API. Anime.js, WAAPI, native animators, or a GPU solver
remain adapter implementation choices and are never called by Presentation
authoring code.

## Target and Composition Laws

- Returned declaration keys are the ordinary path for targeting local named
  Elements. `targets` is read only for relationships.
- Local targets are statically scoped by component definition and dynamically
  scoped by component instance.
- A target from one component definition cannot typecheck in another
  definition's local relationship. Escaping a target from one runtime instance
  to another instance of the same definition is rejected by Presentation purity
  validation because TypeScript cannot mint a fresh generic type per render.
- Targets are not passed through ordinary props and never escape as native
  handles.
- Props and state may select among local targets or derive relationship data.
- Cross-component visual relationships use explicit typed visual identities,
  not private local targets or global string selectors.
- Structural relationships such as ARIA ownership, focus, event routing, and
  behaviorally meaningful anchoring remain in Component structure.
- Parent/child choreography uses public visual identities or a common owning
  Presentation boundary; it cannot inspect a child's private Elements.
- Repeated Elements have explicit keyed cardinality. A singular target never
  silently resolves to an arbitrary repeated native node.

## Accepted Adapter Contract

Core knows only the declaration type and component-scoped session lifecycle:

```ts
type PresentationAdapter<Language extends PresentationLanguage, NativeTarget> = {
  create<const Name extends string>(input: {
    readonly boundary: NativeTarget;
    readonly targets: Readonly<Record<Name, () => readonly NativeTarget[]>>;
  }): PresentationAdapterSession<Language, Name>;
};

type PresentationAdapterSession<Language extends PresentationLanguage, Name extends string> = {
  commit(declarations: Readonly<Partial<Record<Name, Readonly<Language["Declaration"]>>>>): void;
  dispose(): void;
};
```

`boundary` is retained because it is the adapter's native observation and
ownership scope: a DOM Element for web and a Three.js Scene for the 3D adapter.
It is not necessarily one authored Element target. A generic `unmount` promise
is rejected because it leaks an implementation mechanism and creates a second
presence lifecycle. Structure commits the adapter's own presence declarations;
the adapter retains and interrupts native values; `dispose` releases ownership
idempotently when the structural instance is finally destroyed.

The adapter may use native rules, signals, observers, Anime.js, WAAPI, View
Transitions, PreText, Canvas, WebGL, WebGPU, workers, audio engines, native
compositors, or another backend. Those choices do not change authoring syntax.

## Thought-Experiment Matrix

For every scenario, document source values, declaration meaning, adapter-owned
state, native objects, lifecycle, interruption semantics, and any pressure on
the generic envelope.

### A. Ordinary and Responsive UI

- Static typography, color, shape, spacing, grid, and intrinsic layout.
- Theme changes, replaceable fonts, icons, images, video, and loading states.
- Container-responsive components embedded at several sizes simultaneously.
- Hover, focus-visible, pressed, disabled, reduced-motion, contrast, safe area,
  and input-mode conditions without exposing native observations to
  Presentation.

### B. Continuous and Interruptible Motion

- Direct manipulation by drag, pinch, rotate, wheel, and scroll.
- Release velocity transferred into a spring.
- Reversal before the first frame and during settlement.
- One retained value coordinating transform, radius, blur, material, text, and
  sound without independent drift.
- Timelines, dependency graphs, stagger, overlap, cancellation, and moving
  targets.

### C. Layout, Presence, and Text

- FLIP/layout projection across intrinsic size changes and reordering.
- Dynamic text wrapping, variable fonts, late font load, and predictive text
  geometry.
- Enter, exit, retained unmount, immediate hit-testing release, and re-entry.
- Portals, clipping changes, nested scroll containers, and destination removal.
- Virtualized and recycled 10,000-item collection with stable identities.

### D. Cross-Component Coordination

- Tooltip/popover anchored to another structural component.
- Shared image/title/shape transition across routes.
- Parent choreography spanning several child component instances.
- Duplicate visual identities and component removal during transition.
- Props-derived shared identity without passing private targets through props.

### E. Custom Surfaces and Sensory Output

- Pseudo-elements, masks, generated decoration, particles, and effect wrappers.
- Canvas/WebGL shader with resources, uniforms, render passes, and compositing.
- Audio and haptic occurrences with explicit structural occurrence identity.
- Worker/offscreen simulation whose retained visual progress is adapter-owned.
- Resource failure, replacement, leasing, and deterministic disposal.

### F. Complete 3D Renderer

- Platform-specific JSX structure with scene, camera, interactive mesh, light,
  and semantic hit target primitives.
- Presentation-controlled geometry, materials, shaders, transforms, lighting,
  post-processing, particles, and generated decorative subgraphs.
- Pointer and keyboard interaction owned by structure; visual response owned by
  Presentation.
- Physics-driven retained values, camera interruption, resource replacement,
  and scene disposal.
- A declaration language that is recursive where a flat property object is
  insufficient.

### G. Non-Web Platform

- A dependency-free reference platform with no DOM, CSS, Anime.js, viewport,
  or browser vocabulary.
- At least two interpreters for one declaration language producing equivalent
  normalized traces.
- One intentionally unsupported feature that fails at the adapter type or
  validation boundary without a Core escape hatch.

## Real Experiments

### Experiment 1: Type and Authoring Grammar

- [x] Implement the candidate entirely with `satisfies`.
- [x] Prove contextual typing for `tokens`, nested feature components, `props`,
      flattened state, targets, and declaration results.
- [x] Add negative tests for unknown Components, Elements, tokens, declarations,
      cross-instance targets, actions, Capabilities, callbacks, and native
      handles.
- [x] Compare declaration output and `.d.ts` quality with a constructor wrapper.
- [x] Remove the wrapper unless it wins a documented non-type-only requirement.
- [x] Verify the TypeScript compiler frontend can extract the generic contract
      and component mapping without executing Presentation.

**Gate 1:** one conventional syntax is selected with evidence; every symbol in
the public example has an explicit owner and import path.

### Experiment 2: Generic Reference Language

- [x] Remove `Context`/`platform` from the generic Presentation scope.
- [x] Rename `input` to `props` and `parts` to `targets` throughout the generic
      contract after type experiments confirm the names.
- [x] Implement a small non-web declaration language.
- [x] Implement trace-retaining and state-retaining interpreters for that same
      language.
- [x] Create a reusable conformance suite and prove semantic trace equivalence.
- [x] Test target isolation, atomic commit, stable identity, disposal,
      cardinality, and invalid declarations.

**Gate 2:** generic UI modules import no web/native implementation types and two
independent interpreters agree on normalized meaning.

### Experiment 3: Web Adapter Migration

- [x] Express web conditions entirely inside `WebDeclaration`; allocate native
      listeners/observers only when a used declaration needs them.
- [x] Make all motion values explicit declaration data; document optional pure
      constructors for motion values beside their raw form.
- [x] Prove atomic whole-component commits and direct fine-grained native
      updates without virtual-DOM reconciliation.
- [x] Implement local target relationships and cross-component visual identity.
- [x] Verify retained presence, cancellation, velocity continuity, layout
      projection, resources, fonts, layers, and disposal.
- [x] Migrate Studio and Family Presentations with no compatibility syntax.

**Gate 3:** both real web Presentations use the selected grammar exclusively;
no `platform`, action, Capability, native handle, unexplained helper, or second
motion path appears in authoring code.

### Experiment 4: 3D Adapter Spike

- [x] Research the smallest real Three.js-backed structure and Presentation
      adapter needed to exercise the boundary.
- [x] Define adapter-specific scene declarations without adding 3D vocabulary to
      Core.
- [x] Map named structural scene Elements to native scene objects.
- [x] Implement geometry, material, shader/uniform, transform, light, camera,
      generated decoration, and post-processing declarations.
- [x] Exercise retained spring motion, interruption, resource replacement, and
      disposal.
- [x] Render a nonblank interactive scene in the browser and inspect it at
      desktop and mobile dimensions.

**Gate 4:** a real non-DOM object graph uses the same generic Presentation
grammar; any needed new concept belongs wholly to its adapter language.

### Experiment 5: Adversarial Runtime and Property Tests

- [x] Build a controllable clock, geometry source, native-condition source,
      resource loader, and target tree.
- [x] Generate seeded lifecycle sequences: mount, commit, condition change,
      layout change, unmount, recommit, HMR, and dispose.
- [x] Generate interruption traces with moving targets and release velocity.
- [x] Assert convergence to the latest declaration, no stale completion, no
      duplicate ownership, exactly-once disposal, and no cross-instance writes.
- [x] Assert invisible exiting output stops hit testing at the declared point.
- [x] Keep deterministic tests fast enough for the normal package test command.

**Gate 5:** the conformance and property suites reproduce every known lifecycle
defect before its fix and pass deterministically after it.

### Experiment 6: Browser and HMR Verification

- [x] Start the actual Visual Lab dev server with the distributed toolchain.
- [x] Use the in-app browser or `agent-browser`, not Playwright.
- [x] Exercise mouse, keyboard, narrow viewport, touch-equivalent dragging,
      rapid reversal, presentation/theme switching, resizing, and font loading.
- [x] Inspect console errors, focus, hit testing, layout, motion continuity, and
      screenshots.
- [x] Edit Theme, Presentation, structure, and action code while mounted and
      verify compatible state-preserving HMR plus clean incompatible remount.
- [x] Build and pack the package; create and run a fresh generated application.

**Gate 6:** both Visual Lab and a packed consumer work end to end with hot reload,
and browser inspection reveals no flicker, stale overlay, dead input region, or
one-frame pre-animation jump.

## Adapter Conformance Laws

Every adapter must pass applicable laws:

1. Target isolation.
2. Atomic declaration application.
3. Lazy native-condition ownership.
4. Stable component, target, visual-value, and shared identity.
5. Interruption from the rendered value and velocity.
6. Convergence to the latest declaration.
7. Retained presence with coordinated rendering and hit testing.
8. No semantic or focusable adapter-generated decoration.
9. Exact resource fidelity and replacement.
10. Idempotent, exactly-once disposal of owned resources.
11. Deterministic inspection of normalized meaning.
12. Compatible HMR preservation or one explicit clean remount.
13. No declaration from one instance reaches another instance.
14. Unsupported meaning fails explicitly rather than silently degrading.

## Review Gates

### Boundary Review

- [x] Presentation and Component responsibilities are disjoint.
- [x] Every public concept has one precise definition and owner.
- [x] No Presentation-to-structure feedback or behavior configuration exists.
- [x] The generic envelope contains no CSS, DOM, Anime.js, Three.js, or native
      material vocabulary.

### API Review

- [x] `satisfies` is used unless a wrapper has proven runtime meaning.
- [x] Generic parameters provide full contextual inference and compiler-visible
      product meaning.
- [x] Recipes and adapter helpers are ordinary pure functions over public data.
- [x] There is one targeting path, one condition path, one resource path, one
      motion path, and one lifecycle path per adapter language.
- [x] Public examples contain no placeholder or undeclared operation.

### Minimality Review

For every Core concept, ask:

1. Can it be ordinary TypeScript?
2. Can it belong entirely to the adapter's declaration type?
3. Is it behavior or accessibility and therefore structural?
4. Can an existing concept express it without ambiguity?
5. What concrete pressure case fails if it is removed?

Delete any concept without a concrete failure case. Do not retain both old and
new authoring paths.

## Failure Criteria

The candidate contract fails if any pressure case requires:

- a native handle, selector, or imperative adapter call in Presentation;
- actions, Capabilities, timers, subscriptions, or mutable state in
  Presentation;
- passing private targets through props;
- a second authoring syntax for 3D, layout, motion, resources, or conditions;
- a Core change to add adapter-specific visual vocabulary;
- silent unsupported behavior;
- manually coordinated animation lifecycle in application structure solely to
  compensate for adapter limitations;
- a wrapper whose only purpose is type inference;
- an untyped string where the product contract can provide a typed identity.

When a failure occurs, record the smallest counterexample before adjusting the
contract. Do not patch only the demo.

## Completion Criteria

- [x] All six experiment gates pass.
- [x] All review gates pass.
- [x] The complete repository typecheck, lint, test, build, and package checks
      pass.
- [x] The source package and generated application contain no compatibility
      Presentation API.
- [x] The reference, web, and 3D experiments use the same outer grammar.
- [x] Studio and Family are visually and interactively verified in the browser.
- [x] Every accepted API decision has evidence; every rejected concept is
      removed rather than retained as another path.
- [x] The final documentation shows raw declaration forms, optional pure helper
      forms, exact import ownership, adapter implementation, and lifecycle.

## Decision and Evidence Log

Append dated entries while executing. Each entry records:

- hypothesis;
- experiment or counterexample;
- observed result;
- accepted adjustment;
- files and tests containing the evidence.

The checklist and log are updated as each phase finishes. A gate is never marked
complete merely because implementation exists.

### 2026-07-18: Gate 1 authoring grammar

- **Hypothesis:** `satisfies Presentation<App, Language, Theme>` can provide the
  complete contextual type surface without a constructor wrapper.
- **Evidence:** `presentation.typecheck.ts` proves positive and negative
  inference for nested Components, props, flattened state, target scope,
  declarations, actions, and Capabilities. `presentation.authoring.spec.ts`
  extracts the same meaning through the TypeScript compiler API without source
  execution. Package declaration emission succeeds and produces a zero-byte
  runtime module for the type-only generic contract.
- **Counterexample found:** a private `unique symbol` target brand prevented
  declaration emission even though ordinary typecheck passed.
- **Adjustment:** use a nameable phantom target scope. Static types isolate
  component definitions; compiler purity validation must reject target escape
  between runtime instances of the same definition.
- **Decision:** reject `createPresentation`. `satisfies` is the sole Presentation
  authoring grammar. Adapter motion helpers are optional ordinary pure data
  constructors and do not affect this decision.
- **Verification:** package typecheck and all 127 package tests pass.

### 2026-07-18: Gate 2 generic reference language

- **Hypothesis:** one adapter-neutral envelope can own Component mapping,
  reactive props/state inputs, typed target identities, atomic declaration
  commits, and lifecycle without carrying platform vocabulary.
- **Evidence:** `presentation.ts` now exposes only `props`, flattened `state`,
  typed `targets`, declarations, and adapter sessions. The dependency-free
  reference language has trace-retaining and state-retaining interpreters that
  pass the same reusable conformance suite and converge on the same normalized
  meaning.
- **Counterexample found:** allowing one native target to be resolved under two
  structural Elements makes declaration ownership ambiguous even when each
  source independently deduplicates its results.
- **Adjustment:** every adapter must resolve the complete target snapshot before
  writing and reject cross-Element ownership atomically. Repeated targets inside
  one Element remain valid and are deduplicated.
- **Decision:** structure calls named JSX nodes `Elements`; Presentation receives
  typed declaration references as `targets`; adapters operate on `NativeTarget`.
  JSX parameters are `Props`, while ordinary command payloads may still be
  called input.
- **Verification:** package typecheck, build, declaration emission, and all 130
  package tests pass. Generic Presentation modules contain no web, DOM, CSS,
  Anime.js, or Three.js implementation imports.

### 2026-07-18: Gate 3 web adapter

- **Hypothesis:** web layout, styling, conditions, resources, motion, presence,
  and native observation can be one adapter-owned declaration language while
  Presentation remains a pure `props`/`state`/`targets` mapping.
- **Evidence:** `WebPresentationDeclaration` now owns one ordered `conditions`
  path for target state, container size, preferences, and pointer capability.
  The adapter allocates only the listeners, `ResizeObserver`, and media queries
  named by authored conditions. Studio and Family use only the selected direct
  Presentation tree and raw declaration data. No helper-specific motion form is
  required.
- **Counterexamples found:** the Anime.js drag proxy was initially positioned at
  viewport origin, so a 20px handle move became a clamped 178px jump. After
  correcting geometry, Anime's `onDrag` callback still exposed pre-render
  coordinates; only `onUpdate` observes the rendered trajectory.
- **Adjustment:** align the proxy to the trigger in capture phase before every
  gesture, reset retained axes after termination, and sample on Anime's render
  update. Unit tests preserve both failures. No demo-specific compensation was
  added.
- **Browser proof:** Family and Studio were exercised at 390x844 and 1440x900.
  Live drag follows the pointer, repeated sub-threshold releases spring back,
  velocity dismissal releases hit testing while exit motion continues, compact
  sheets stay within the viewport, desktop dialogs expose no drag handle, and
  hover leaves typography geometry unchanged. Console and page error inspection
  are clean.
- **Verification:** all 136 package tests and the package build pass.

### 2026-07-18: Gate 4 real 3D adapter

- **Hypothesis:** a platform whose native hierarchy, declarations, retained
  values, resources, and renderer are unrelated to the DOM can use the same
  generic Presentation grammar without adding 3D operations to Core.
- **Evidence:** `ui/three` defines structural Three.js JSX primitives, a typed
  scene declaration algebra, and a real adapter for native scenes, cameras,
  groups, meshes, and lights. The language covers geometry, standard and shader
  materials, uniforms, generated particles, transforms, spring targets,
  camera projection, lights, fog, exposure, bloom, and render passes. Visual Lab
  owns pointer/keyboard behavior in structure while its pure Presentation owns
  every rendered response.
- **Counterexample found:** a single `Language["Declaration"]` result type could
  validate a declaration union but could not reject a camera declaration on a
  structural mesh Element. Optional adapter-owned `Declarations` now maps native
  structural primitive names to declaration variants; adapters without that map
  retain the single-declaration form. This is generic native-target refinement,
  not 3D vocabulary.
- **Lifecycle adjustment:** each commit is a complete declaration snapshot.
  Omitted properties and targets release retained motion, dispose owned geometry,
  materials, particles, and post-processing resources, and restore the native
  scene, camera, transform, and light baselines. Repeated disposal is idempotent.
- **Browser proof:** a real WebGL scene was inspected at 1440x900 and 390x844.
  Composited canvas captures are nonblank with normalized pixel standard
  deviation above 0.24. Click activation changes the frame by RMSE 0.438;
  pointer movement changes it by RMSE 0.128; keyboard activation updates the
  accessible pressed state. Both viewport sizes remain framed and interactive,
  and a clean browser session reports no warnings or page errors.
- **Verification:** package typecheck passes and all 142 package tests pass,
  including declaration/native-target mismatch, atomic ownership, retained
  velocity, replacement, omission restoration, and exactly-once disposal.

### 2026-07-18: Gate 5 adversarial lifecycle verification

- **Hypothesis:** adapter correctness can be tested as deterministic state and
  ownership laws without a browser, while retaining browser checks only for
  native integration and visual evidence.
- **Shared harness:** the reusable conformance suite now runs target isolation,
  atomic resolution, deduplication, ownership rejection, latest-declaration
  convergence, dynamic target replacement, post-disposal rejection, idempotent
  release, and a 64-step seeded duplicate/recycling trace against the reference
  trace interpreter, reference state interpreter, web adapter, and Three
  adapter.
- **Controllable sources:** `TestScheduler` and adapter schedulers own time;
  mutable `getBoundingClientRect`, layout backends, `ResizeObserver`, media
  query records, and target event emitters own geometry and native conditions;
  font and render-layer backends own resources; dynamic target closures own the
  target tree. None require a virtual DOM or wall-clock sleep.
- **Platform pressure:** web tests cover condition precedence and lazy observer
  allocation, moving shared-layout destinations, retained enter/exit reversal,
  duplicate exit commits, immediate pointer-event release, native-dialog
  non-ownership, resource replacement, font leasing, generated decoration, and
  seeded presence/resource/recycling traces. Three tests cover declaration-kind
  validation, motion velocity handoff, geometry/material/particle replacement,
  omission restoration, and native target recycling.
- **HMR and interruption:** the hot coordinator serializes 100 revisions with
  exactly one live scope and rollback on failed preparation/activation. Motion
  tests preserve rendered value and velocity across retargeting, reject stale
  settlement, and dispose pending work once. Drag regression tests preserve the
  proxy-origin and pre-render-coordinate failures found in Gate 3.
- **Verification:** all 154 package tests pass. The adapter conformance and
  property laws themselves finish in under five seconds and use no browser or
  network. The complete package suite also includes compiler, generated-project,
  and Rust-target integration checks and therefore takes longer. Those
  integration tests use explicit 30-second budgets so concurrent cold runs do
  not inherit Vitest's unsuitable five-second unit-test timeout.

### 2026-07-18: Gate 6 browser, HMR, and distribution verification

- **Visual Lab:** the distributed `poggers dev` path serves the real application
  at `http://localhost:3030`. Fresh desktop and 390x844 sessions render both
  Presentations and the live Three.js fixture with no page error or console
  warning. Browser inspection used `agent-browser`; no Playwright dependency or
  test path was introduced.
- **Interaction:** on mobile, the handle follows the pointer exactly, a
  sub-threshold release returns to rest, and a fast release transfers velocity
  into offscreen dismissal. While the exiting Surface is still below the
  viewport, the Dialog already has `pointer-events: none`, hit testing resolves
  to the trigger, and immediate reopening succeeds. On desktop the Surface is
  centered, no drag handle exists, hover preserves exact font and box metrics,
  and repeated open/close reversal converges to one live Dialog and backdrop.
- **Counterexample found:** the compact trigger used an animated translation to
  perform static responsive placement. Its painted position and accessibility
  hit geometry disagreed on the first frame, so the first click could target the
  Page instead of the button. This was a Presentation error, not an adapter
  expressiveness gap. The declaration now uses conditional relative layout;
  a cold first click works.
- **HMR:** compatible Theme, Presentation, action, and JSX edits preserved the
  selected Presentation, mounted Dialog view, and state while animation frames
  continued. An incompatible structural Element-tag edit produced one explicit
  clean remount, and restoration did the same. No stale native ownership or
  duplicate scope remained.
- **Distribution:** the package builds and packs with the generic, web, Three,
  and Three JSX-runtime public subpaths. A fresh generated consumer installed
  the tarball, passed its check and build commands, ran in a browser, hot-updated
  a compatible source edit, and imported both public Three runtime functions.
- **Final repository evidence:** typecheck, Oxlint, Oxfmt, all 154 package tests,
  all three workspace builds, and final package packing pass. The 68 reference,
  web, and Three conformance/property tests complete in 371ms on the current
  machine. The Visual Lab build reports only Vite's expected large-chunk warning
  because the pressure fixture deliberately bundles the full Three.js renderer.

### 2026-07-18: Final boundary and minimality review

- **Core retained:** `PresentationLanguage`, optional per-primitive declaration
  refinement, typed `PresentationTarget`, pure Component scopes, atomic adapter
  sessions, and a native ownership `boundary`. Removing any one breaks an
  observed reference, web, or Three pressure case.
- **Core rejected:** a Presentation constructor, native refs, Actions,
  Capabilities, subscriptions, platform observations, motion helpers, resource
  vocabulary, and a generic asynchronous unmount phase. Each belongs to ordinary
  TypeScript, Component structure, or one adapter language.
- **Dependency review:** generic Presentation modules import only the generic
  Component contract. Web and Three dependencies point inward from their own
  adapter modules; Core imports neither. Source and packed exports expose one
  generic grammar and adapter-specialized types without a compatibility path.
- **Authoring review:** Themes are values; Presentations are pure functions;
  reusable recipes are ordinary pure functions returning public data.
  The adapter alone observes native state, owns retained motion/resources, and
  applies complete declaration snapshots. This is the smallest boundary that
  survived all documented counterexamples.
