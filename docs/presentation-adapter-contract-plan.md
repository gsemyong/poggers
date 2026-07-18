# Presentation Adapter Contract and Pressure Test

Status: active

## Objective

Discover, implement, and validate the smallest presentation contract that lets
Poggers describe any platform-specific visual experience cleanly while keeping
application meaning, accessibility, and behavior in Component structure.

This is a breaking migration. There is no compatibility layer for the current
symbolic Presentation API, action completion channel, or web-specific types
exported as general UI contracts.

The plan is a workbench, not proof that the current proposal is correct. Every
candidate concept must survive type, runtime, adapter, and visual pressure
tests. Failed hypotheses are recorded and removed instead of preserved as a
second way to work.

## Desired Boundary

```text
Component structure
|- platform-native hierarchy
|- semantics and accessibility
|- listeners and actions
|- one reactive state model
`- named Parts
          |
          v
Presentation(theme)
`- Component(state, platform observations)
   `- declarations for named Parts
          |
          v
Platform adapter session
|- observes only used platform facts
|- resolves resources
|- commits one coordinated visual description
|- owns render-only layers and native objects
|- owns motion, layout, presence, scheduling, and disposal
`- produces platform-native output
```

A Presentation is a pure reactive mapping:

```text
(theme, Component state, platform observations)
  -> visual declarations for named structural Parts
```

It cannot call actions, access Capabilities, mutate state, mount native
resources imperatively, or introduce semantic nodes.

## Candidate Minimal Contract

Core should need no knowledge of CSS, StyleX, Anime.js, DOM geometry, native
materials, or token categories. The candidate authoring contract has two opaque
platform types:

```ts
type PresentationLanguage = {
  readonly Context: object;
  readonly Declaration: object;
};
```

- `Context` is the platform contract's typed, reactive, read-only observation
  surface.
- `Declaration` is the platform contract's complete presentation language,
  including properties, resources, render-only layers, conditions, motion,
  presence, and shared visual identity where that platform supports them.

The common authoring grammar is fixed:

```ts
type Presentation<App, Language, Theme> = (theme: Theme) => {
  readonly components: ComponentTree<
    App,
    (scope: {
      readonly state: ComponentState;
      readonly platform: Language["Context"];
      readonly parts: TypedPartIdentities;
    }) => Partial<Record<ComponentPart, Language["Declaration"]>>
  >;
};
```

The exact syntax may change during pressure testing. The laws may not.

The candidate runtime contract is one component-scoped adapter session:

```ts
type PresentationAdapter<Language extends PresentationLanguage> = {
  create(input: {
    readonly boundary: HostTarget;
    readonly parts: ReadonlyMap<string, readonly HostTarget[]>;
  }): {
    readonly platform: Language["Context"];
    commit(declarations: ReadonlyMap<string, Language["Declaration"]>): void;
    dispose(): void;
  };
};
```

`commit` receives the whole Component description so an adapter can coordinate
cross-Part geometry, shared identities, overlays, resources, and motion in one
transaction. The adapter may diff or compile internally; Core does not require
a virtual tree or expose imperative per-property operations.

## Architectural Laws

- **One state:** hover, press, drag, velocity, and every other
  Component-owned reactive value live in Component state. There is no separate
  authored `interaction` state model.
- **Read-only platform facts:** allocated space, geometry, safe areas, input
  characteristics, and user preferences come from the platform contract. Their
  source and scope are explicit.
- **Pure Presentation:** evaluation returns data and has no side effects.
- **No action cycle:** Presentations never receive or invoke Component or
  Program actions.
- **No Capability access:** Presentation cannot perform product work, storage,
  navigation, networking, timers, or subscriptions.
- **Named targeting:** declarations target exact typed Parts, not string
  selectors or native tree queries.
- **Semantic structure is stable:** Presentation may reposition existing Parts
  and create adapter-owned visual layers, but cannot invent accessible content,
  focus targets, commands, or navigation.
- **Resources are visual values:** fonts, symbols, decorative images, shaders,
  video treatments, materials, and sounds are referenced through the
  platform's Declaration and Theme types. Core has no resource taxonomy.
- **Content ownership is explicit:** semantic text and data images come from
  structure or state; Presentation chooses their rendering. Decorative content
  may come from the Presentation or Theme.
- **Responsive by allocated space:** reusable Components respond to their own
  explicit layout boundary by default. Device and viewport facts are used only
  when their meaning is genuinely global.
- **Automatic observation ownership:** the adapter implements each used
  observation using the best native mechanism, deduplicates it, and disposes it
  with the session.
- **Retained visual values:** animation progress, velocity, presence, measured
  geometry, scroll, and time may be adapter-owned reactive values. They are not
  a second application state store.
- **Normal TypeScript:** Presentation conditions and recipes use ordinary typed
  functions and expressions. No `.is()`, `.choose()`, query-builder, selector,
  or CVA-specific DSL is part of Core.
- **Generic types drive safety:** no runtime wrapper exists merely to recover
  inference.
- **One authoring grammar:** every platform Presentation has the same outer
  organization even though each platform defines a different Context and
  Declaration language.
- **Adapter freedom, contract fidelity:** an adapter may use any native
  implementation technique but cannot reinterpret the language it implements.

## Open Questions To Resolve With Evidence

### Presentation parameters

Some visual systems configure interaction policy that structure must consume,
such as drawer mode, drag resistance, or dismissal thresholds. Determine
whether an explicit Presentation-to-structure parameter channel is irreducible.

Candidate constraints if retained:

- Component contracts declare every parameter and its semantic type.
- Parameter producers receive Theme, Component input, and platform
  observations, but not Component state, actions, or Capabilities.
- Parameters contain values only, never callbacks.
- Structure consumes parameters; Presentation does not read back state derived
  from them in the same evaluation cycle.
- The compiler rejects dependency cycles.

The channel is removed if Drawer, responsive composition, focus timing, and
gesture pressure tests can remain clean without it.

### Component boundary

Determine whether every presentable Component must expose one `Root` Part as
its responsive and lifecycle boundary, or whether Core needs an explicit
boundary declaration. A purely compositional Component may have no
Presentation and delegate boundaries to child Components.

### Visual values

Determine how coordinated retained values are declared without hooks,
imperative registration, or symbolic operator methods. The solution must:

- preserve velocity through reversal;
- allow ordinary TypeScript derivation;
- be inspectable at arbitrary progress values;
- have stable identity across reactive evaluation and HMR;
- compile to direct subscriptions without virtual-DOM reconciliation.

### Declarative resource substitution

Prove a typed distinction between:

- semantic resources supplied by state;
- presentational resources supplied by Theme or Presentation;
- adapter-owned implementation resources.

Icons, fonts, decorative imagery, product imagery, video, shader materials,
and loading placeholders must all fit without a special Core API per format.

### Render-only structure

Determine the minimum Declaration semantics needed for pseudo-elements,
effect wrappers, masks, shader surfaces, transition snapshots, overlays, and
particles. Render-only objects must never become accessible or focusable and
must not leak into Component structure.

## Pressure-Test Matrix

Each scenario must be implemented through the candidate contract without raw
adapter internals or another authoring model.

### 1. Interruptible responsive drawer

- Centered desktop dialog and mobile bottom sheet from one structure.
- Pointer, touch, keyboard, scroll, and drag arbitration.
- Direct drag tracking followed by a velocity-preserving spring.
- Open/close/open reversal on consecutive input frames.
- Exit retention without authored `opening` or `closing` bookkeeping solely
  for Presentation.
- Backdrop hit testing ends exactly when the visible backdrop ends.
- Focus, inertness, and dialog semantics remain structure-owned.
- Presentation switch and responsive-boundary change during drag.

Evidence target: existing Vaul/Visual Lab behavior expressed with no action
reference from Presentation and no stale overlay or dead hit target.

### 2. Dynamic Family drawer

- Four content states with different intrinsic heights.
- Coordinated container resize, outgoing/incoming content crossfade, scale,
  clipping, and text reflow.
- Rapid navigation and reversal before previous settlement.
- Font and symbol substitution between Presentations.
- Predictive text geometry where native layout alone produces poor continuity.

Evidence target: deterministic transition traces plus browser inspection at
desktop and narrow embedded widths.

### 3. Shared-element navigation

- Image, title, shape, clipping, and shadow morph between two structural
  locations.
- Nested scroll containers and changing destination geometry.
- Overlay elevation and clipping policy.
- Forward, reverse, interruption, and destination removal.
- Duplicate shared identities fail deterministically.

Evidence target: one semantic shared identity maps to the web adapter's best
implementation without exposing `layoutId` or `view-transition-name` in Core.

### 4. Morphing notification surface

- Merge and split several Parts.
- One retained progress value coordinates layout, corners, material, text,
  symbol, and opacity.
- Spring targets move while the spring is active.
- Staggered and overlapping phases remain cancellable.
- Theme changes during motion preserve continuity.

Evidence target: no independent animation drift and no one-frame geometry
flash before motion begins.

### 5. Virtualized reorderable collection

- At least 10,000 logical items with a bounded mounted set.
- Keyboard and pointer reordering.
- Cross-container drag, autoscroll, insertion preview, and layout animation.
- Native node recycling does not confuse stable visual identity.
- Container resize and filtering during movement.

Evidence target: identity and disposal laws hold without requiring Core to know
virtualization or list layout semantics.

### 6. Streaming and wrapping text

- Continuously changing text and variable font metrics.
- Anchored scrolling while content grows.
- Line-wrap changes coordinated with sibling layout.
- Reduced-motion behavior.
- Font load after initial render.

Evidence target: no stale measurement, jump, or dependency loop; adapter may
use PreText or native layout without changing the Presentation contract.

### 7. Shader-heavy skeuomorphic control

- Multiple shadows, highlights, masks, blend modes, materials, and a custom
  shader layer.
- Fine pointer hover, touch press, keyboard focus, disabled state, and high
  contrast.
- Decorative render nodes never enter the accessibility tree.
- A simpler adapter may reject unsupported shader declarations at compile
  time without weakening the Core contract.

Evidence target: visual-only layers and resource substitution are sufficient;
no semantic JSX is created by Presentation.

### 8. Platform-independence fixture

- Define a tiny non-web language with no CSS property, DOM type, viewport,
  StyleX, or Anime.js concept.
- Author one structure and Presentation fixture for that platform.
- Run it through the reference adapter and inspect normalized output.
- Implement two adapters for one language and compare semantic traces.

Evidence target: generic UI and Presentation modules import no web types, and
adapter implementation choices do not alter normalized language meaning.

## Adversarial Lifecycle Traces

Run deterministic seeded traces over at least these transitions:

```text
mount -> observe -> update -> dispose
open -> close -> open before first frame
open -> drag -> resize -> release -> reverse
enter -> switch Presentation -> exit
layout -> remove destination -> restore destination
load font -> resize -> change Theme -> hot replace
mount repeated Parts -> recycle targets -> reorder -> dispose
```

For every prefix and suffix, assert:

- no callback, observation, animation, or resource survives its owner;
- no resource is disposed twice;
- no stale completion changes semantic state;
- no invisible overlay intercepts input;
- no duplicate observer exists for one shared source;
- no Part receives a declaration from another instance;
- no transition starts from stale geometry;
- interruption begins from the currently rendered value and velocity;
- final native output converges to the latest declaration;
- HMR either preserves compatible state and visual identity or performs one
  explicit clean remount.

## Adapter Conformance Laws

The reusable conformance suite must test every adapter implementation against:

1. **Target isolation:** declarations affect only the named Component instance
   and Part targets supplied to its session.
2. **Atomicity:** a commit cannot expose a partially updated coordinated
   description.
3. **Dependency laziness:** unused Context observations allocate nothing.
4. **Deduplication:** identical shared observations and resources have one
   underlying owner where the platform permits sharing.
5. **Liveness:** updates after disposal are ignored or rejected
   deterministically.
6. **Exactly-once disposal:** every owned object is released once in reverse
   dependency order where ordering matters.
7. **Stable identity:** Component, Part, repeated target, visual value, and
   shared-transition identities remain stable across compatible updates.
8. **Interruption continuity:** replacement motion starts from rendered value
   and velocity, never from an obsolete target.
9. **Presence correctness:** exiting visual output remains until its declared
   exit settles, then ceases rendering and hit testing together.
10. **Render-only semantics:** adapter-created visual nodes are absent from
    accessibility and focus surfaces unless structure declared a semantic Part.
11. **Resource fidelity:** resource substitution resolves the exact declared
    resource and updates atomically.
12. **Inspection equivalence:** deterministic adapter inspection reports the
    same normalized meaning that was committed.

## Testing Strategy

### Type tests

- Exact Component, feature namespace, state, Part, Theme, Context, and
  Declaration inference.
- Unknown Parts, native properties from another language, undeclared tokens,
  actions, and Capabilities fail without casts.
- General Presentation contracts compile with a non-web language.
- Component parameters, if retained, reject callbacks, state reads, and cycles.
- No helper wrapper is required solely for inference.

### Compiler translation tests

- Parse normal TypeScript conditions and recipe calls without executing
  application behavior.
- Emit deterministic Presentation metadata and binding identities.
- Translate static platform conditions to native rules where supported.
- Keep dynamic state bindings direct and fine-grained.
- Collect only referenced resources and observations.
- Reject unsupported or impure Presentation source with actionable diagnostics.

### Deterministic runtime tests

- Use a controllable clock, geometry source, resource loader, and host tree.
- Step springs and timelines at exact times.
- Assert values, velocities, commits, ownership, and disposal traces.
- Generate seeded event sequences for lifecycle and interruption laws.
- Keep the suite fast enough to run in the normal package test command.

### Browser verification

- Use the in-app browser or `agent-browser`, never Playwright.
- Inspect desktop, mobile, and narrow embedded component boundaries.
- Exercise pointer, keyboard, touch-equivalent drag, rapid repeated input, font
  loading, Theme switching, Presentation switching, resizing, and HMR.
- Inspect console output, hit testing, focus order, accessibility state, native
  dialog behavior, and visual screenshots.
- Record failures as framework, adapter, or Presentation-authoring defects.

### Package verification

- Build and pack `@poggers/kit`.
- Create a fresh application from the packed package.
- Install only template-declared dependencies.
- Typecheck, build, run, and hot-reload it.
- Verify no generated declaration or virtual module is tracked in Git.

## Implementation Phases

### Phase 0: Baseline and inventory

- [x] Record the current public Presentation exports and all web imports in
      nominally generic modules.
- [x] Record current symbolic operations, action references, parameters,
      interactions, resources, observations, and runtime ownership paths.
- [x] Run the complete repository check and production build.
- [x] Verify current Visual Lab behavior in the browser and capture known
      defects without treating them as target behavior.
- [x] Add a decision log below with accepted, rejected, and unresolved
      concepts.

**Gate 0:** the baseline is reproducible, existing failures are classified, and
the migration scope is explicit.

### Phase 1: Generic contract and reference language

- [x] Introduce dependency-free `PresentationLanguage`, generic
      `Presentation`, and `PresentationAdapter` contracts outside `ui/web`.
- [x] Remove web imports from generic Presentation modules.
- [x] Implement a tiny reference language and in-memory adapter.
- [x] Add exact positive and negative type fixtures.
- [x] Add adapter session tests for commit, Context, target identity, and
      disposal.
- [x] Verify whole-Component atomic commits and repeated Part targets.

**Gate 1:** the reference and non-web fixtures compile and run without DOM,
CSS, Anime.js, StyleX, or web visual types.

### Phase 2: Resolve authoring grammar

- [x] Implement the pure `theme -> components -> Component -> Part map`
      authoring shape.
- [x] Remove action and Capability references from Presentation scope.
- [x] Remove the separate authored `interaction` scope; expose required values
      through Component state.
- [x] Replace symbolic `.is()`, `.choose()`, `.and()`, and `.or()` authoring
      with ordinary TypeScript conditions.
- [x] Implement recipes as ordinary typed pure functions.
- [x] Decide the Component boundary rule from composition fixtures.
- [x] Decide the parameter channel through Drawer and responsive behavior
      experiments.
- [x] Decide retained visual-value syntax through morphing and interruption
      experiments.

**Gate 2:** one authoring grammar expresses static, conditional, responsive,
resource-driven, and coordinated motion declarations without imperative setup,
symbolic operators, or alternate syntax.

### Phase 3: Web language and adapters

- [ ] Move the web property, token, resource, condition, layer, geometry,
      presence, motion, and identity algebras behind the web language contract.
- [ ] Implement the web adapter session over existing StyleX, direct DOM
      bindings, Anime.js, and PreText machinery where each is justified.
- [ ] Make Context observations explicit, lazy, deduplicated, and scoped.
- [ ] Implement presentational symbols, fonts, decorative images, semantic
      images, and shader/render-layer fixtures.
- [ ] Implement direct fine-grained updates without Component rerendering.
- [ ] Preserve atomic coordination for cross-Part layout and motion.
- [ ] Remove obsolete compiler/runtime APIs instead of translating them.

**Gate 3:** both web Presentations compile through the generic contract, all
web machinery is confined to the web language/adapter, and no legacy authoring
surface remains.

### Phase 4: Conformance and deterministic pressure tests

- [ ] Implement the twelve adapter conformance laws as a reusable suite.
- [ ] Add deterministic clocks, geometry, observations, resources, and host
      inspection.
- [ ] Add seeded adversarial lifecycle traces.
- [ ] Test rapid reversal, moving targets, velocity continuity, presence, and
      stale-work cancellation.
- [ ] Test resource loading, replacement, failure, deduplication, and disposal.
- [ ] Test boundary resize and Theme/Presentation/HMR changes during motion.
- [ ] Test duplicate identities and invalid declarations fail clearly.

**Gate 4:** all adapters pass the same lifecycle laws, and failures identify a
specific contract or implementation invariant rather than visual taste.

### Phase 5: Expressiveness stress implementations

- [ ] Migrate and harden the responsive Vaul drawer.
- [ ] Migrate the dynamic Family drawer.
- [ ] Implement shared-element navigation.
- [ ] Implement the morphing notification surface.
- [ ] Implement the virtualized reorderable collection fixture.
- [ ] Implement streaming/wrapping text and font replacement.
- [ ] Implement the shader-heavy control.
- [ ] Implement and run the non-web platform fixture.
- [ ] Maintain a matrix mapping every used contract concept to at least two
      unrelated scenarios.

**Gate 5:** every scenario uses the same authoring grammar and no scenario
requires raw runtime access, imperative lifecycle code, semantic nodes from
Presentation, or an untyped escape hatch.

### Phase 6: End-to-end verification and minimality review

- [ ] Verify every stress implementation in a real browser at desktop, mobile,
      and embedded widths.
- [ ] Verify touch-like drag, keyboard, focus, reduced motion, high contrast,
      resize, scroll, rapid input, and HMR.
- [ ] Check hit testing and accessibility for adapter-owned visual layers.
- [ ] Run format, lint, TypeScript, tests, and production builds.
- [ ] Pack the kit and verify a freshly generated application.
- [ ] Remove every Core concept not required by two independent scenarios.
- [ ] Remove redundant tests, helpers, files, exports, and documentation.
- [ ] Update `docs/architecture.md` to describe only the validated surface.
- [ ] Mark this plan complete with evidence and residual limitations.

**Gate 6:** the full repository and packed-template gates pass, browser evidence
is clean, the minimality audit passes, and remaining limitations are explicit.

## Review Gates

At the end of every phase, answer these questions before proceeding:

1. Did the phase introduce a second way to express an existing concept?
2. Is any Core type carrying web or implementation meaning?
3. Is any Presentation source executing an effect or managing cleanup?
4. Can an adapter implement the contract without DOM or CSS assumptions?
5. Can the deterministic harness inspect every new behavior?
6. Does every new concept solve at least two unrelated pressure cases?
7. Could the same capability live entirely inside the platform Declaration?
8. Did convenience syntax obscure ownership, lifecycle, or data flow?
9. Does the API use conventional, precise names?
10. Is the result smaller and easier to explain than the surface it replaced?

Any `no` answer blocks the next phase or requires a recorded exception.

## Completion Criteria

The goal is complete only when:

- Core exposes a dependency-free generic Presentation language and adapter
  contract.
- Generic Presentation code imports no web types.
- Presentations are pure and receive no actions, Capabilities, or imperative
  native handles.
- One reactive Component state model contains authored interaction state.
- Platform observations are explicit, lazy, typed, scoped, and adapter-owned.
- Fonts, symbols, images, shaders, and other presentational resources are
  substitutable through typed declarations.
- Render-only structure is adapter-owned and absent from semantics and focus.
- Parameters are either proven necessary with a constrained acyclic contract or
  removed.
- Ordinary TypeScript replaces the symbolic expression DSL.
- At least two adapter implementations and one non-web language fixture pass
  conformance.
- Every pressure scenario is expressible through one authoring grammar.
- Deterministic tests prove lifecycle, interruption, identity, resource, and
  disposal correctness.
- Real browser verification proves responsive layout, gestures, motion,
  presence, accessibility, hit testing, and HMR.
- Repository checks, builds, package packing, and generated-app consumption all
  pass.
- The final public surface and file organization contain no compatibility
  residue or redundant concepts.

## Decision Log

| Decision                                                                      | Status    | Evidence                                                 |
| ----------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| Presentation maps state and platform observations to named-Part declarations  | candidate | Architectural discussion; pressure tests pending         |
| Presentation receives no actions or Capabilities                              | accepted  | Removes circular ownership and preserves purity          |
| Interaction values belong to Component state                                  | accepted  | Removes duplicate state and action cycles                |
| Core language needs only opaque Context and Declaration types                 | accepted  | Non-web language and adapter pass Gate 1                 |
| Resources live inside platform declarations rather than Core taxonomy         | candidate | Resource substitution pressure tests pending             |
| Visual-only layers are adapter-owned                                          | candidate | Shader/accessibility pressure tests pending              |
| Explicit shared identity is irreducible for cross-Part morphing               | candidate | Shared navigation pressure test pending                  |
| Responsive behavior defaults to Component allocated space                     | candidate | Embedded composition pressure test pending               |
| Presentation-to-structure parameters                                          | rejected  | They create a cycle; behavior configuration is structure |
| `Root` is the presentable Component boundary                                  | accepted  | Gives adapters one typed boundary without another field  |
| Normal retained motion identity is instance + Part + property                 | accepted  | Avoids authored registration; interruption tests pending |
| Explicit identities are reserved for cross-Part/cross-Component relationships | candidate | Shared navigation pressure test pending                  |

## Evidence Log

### 2026-07-18: clean migration checkpoint

- Committed the complete pre-contract migration as `e840414` and pushed
  `main` to `origin` before starting this plan.
- `nub run check` passed: typechecking, Oxlint, Oxfmt, 9 Vitest files, and 93
  tests. The suite included the current Rust backend checks.
- `nub run build` passed for `@poggers/kit`, Chat, and Visual Lab. Current
  browser bundles are reproducible from the checkpoint.

### 2026-07-18: Phase 0 inventory

- `packages/kit/src/ui/presentation.ts` imports its nominally generic
  `Presentation` and `Tokens` directly from `#ui/web/visual`.
- `packages/kit/src/ui/component.ts` imports web JSX types and materializes
  Parts as `HTMLElement`/`SVGElement` types. Platform separation must include
  Component structure contracts, not only Presentation exports.
- Both Visual Lab Presentations use symbolic `.is()`, `.choose()`, `.and()`,
  `.or()`, `createMotion`, and `interpolate` authoring.
- Presentation scope currently exposes `actions`, `interaction`, `geometry`,
  and `environment`; compiled output separately carries `parameters`,
  `interactions`, and `completions`.
- Visual Lab structure contains `finishOpening` and `finishClosing` actions
  whose only purpose is current Presentation settlement.
- Presentation parameters currently travel from compiled Presentation output
  through `visual-runtime.ts` and back into Component action/start scopes.
- Browser baseline at `http://localhost:3000` opened `#family-drawer` as a
  native dialog with Close, Private Key, Recovery Phrase, and Remove Wallet
  controls. Browser console and page errors were empty. Closing produced a
  connected but closed native dialog (`open=false`, `display:none`). This is
  baseline behavior only; command timing was not precise enough to prove exit
  motion, hit-testing, or velocity laws.
- Baseline screenshot: `/tmp/poggers-presentation-baseline-open.png`.

**Gate 0 result:** passed. The baseline is green and reproducible, the current
web/action/symbolic coupling is enumerated, and no existing behavior is being
treated as proof of the candidate contract.

### 2026-07-18: Phase 1 generic contract

- Moved dependency-free Component meaning into
  `packages/kit/src/ui/component.contract.ts`; the DOM-bound structure/runtime
  layer remains in `component.ts` pending the platform-adapter migration.
- Replaced the general Presentation export with generic
  `PresentationLanguage`, `Presentation`, `PresentationAdapter`, and
  Component-scoped adapter-session contracts. These modules import no web UI
  types.
- Added a tiny reference language and deterministic in-memory adapter with no
  DOM, CSS, StyleX, Anime.js, or web visual dependency.
- Added positive and negative type fixtures proving exact State, Part,
  Declaration, action, and Capability boundaries.
- `nub run --filter @poggers/kit typecheck`: passed.
- `nub exec vitest run src/ui/presentation.reference.spec.ts`: 1 file and 2
  tests passed in 137 ms. The tests cover whole-Component atomic snapshots,
  repeated Part targets, Context, target isolation, idempotent disposal, and
  rejection of post-disposal commits.
- The complete package test currently fails only because the generated app
  template still authors the deliberately removed legacy web Presentation
  signature. That is a Phase 3 migration item, not accepted compatibility.

**Gate 1 result:** passed. General contracts and fixtures compile and execute
without importing or instantiating any web presentation machinery.

Populate subsequent entries with exact commands, test files, browser
scenarios, screenshots where useful, failures, contract revisions, and
remaining risks. A checked box without evidence does not satisfy a gate.
