# Semantic language and testing migration

This is the source of truth for the no-compatibility migration that makes the
Poggers language, implementation, repository, tests, package, template, and
documentation use one precise vocabulary. The work is complete only when every
acceptance gate below passes.

**Status:** complete on 2026-07-19. The verification evidence is recorded at
the end of this document.

## Objective

Poggers must remain a small TypeScript product language with explicit semantic
boundaries:

```text
Application
`- Features
   `- Program contributions targeting Environments
      `- optional Components
         |- behavior: state, actions, lifecycle
         |- structure: JSX hierarchy, accessibility, native events
         `- named Elements
            `- parameterized Presentation declarations

Application source -> Application IR -> development or production realization
```

An adapter implements a contract. Core never names a particular adapter's
styling taxonomy, motion system, asset model, host technology, generated
language, topology, or testing implementation.

## Research conclusions

- **Presentation** is the correct name for parameterized, platform-specific,
  user-facing information attached to behavior-defined structure. W3C uses the
  same structure/functionality/presentation distinction and treats
  presentation as broader than static visual styling.
- **Program** and **Process** retain their conventional distinction: a Program
  is prepared application logic; a Process is one running instance.
- **Environment** names an authored execution context. Runtime topology is not
  a product declaration and `Peer` is not a core concept unless a future
  capability introduces it semantically.
- **Capability** remains the only product-visible effect, host, communication,
  and external-system boundary.
- **Component** owns local behavior and structural hierarchy. `structure` is a
  phase inside a Component, not the name of the complete non-presentation UI
  subsystem.
- **Element** remains the platform-neutral JSX term for a named structural
  endpoint. TypeScript itself uses intrinsic and value-based Elements across
  JSX implementations.
- Property-based tests complement examples. They are especially valuable for
  lifecycle sequences, compiler normalization, retained adapter state, and
  asynchronous interleavings. `fast-check` supplies shrinking, model-based
  commands, and deterministic schedulers; Vitest remains the runner.
- Vitest owns test execution, assertions, fixtures, fake time, isolation,
  type-test integration, and generated-application integration tests. Real web
  behavior still needs a real-browser acceptance gate. No Playwright dependency
  is introduced in this migration.

References:

- <https://www.w3.org/WAI/WCAG21/Techniques/general/G140>
- <https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html>
- <https://www.typescriptlang.org/docs/handbook/jsx>
- <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- <https://vitest.dev/guide/features>
- <https://fast-check.dev/docs/advanced/>
- <https://nubjs.com/>

## Naming constitution

### Stable product nouns

- `Application`: complete authored composition.
- `Feature`: reusable vertical product slice.
- `Environment`: authored execution-context kind.
- `Program`: same-named Feature contributions assembled for one Environment.
- `Process`: one running Program instance.
- `Capability`: typed authority or dependency crossing the product boundary.
- `Component`: local behavior and platform-native hierarchy.
- `Element`: named structural endpoint in a Component.
- `Presentation`: parameterized declarations attached to Elements.
- `UIPlatform`: compatible Component primitives and Presentation language.
- `Adapter`: implementation of an explicit contract.

### Suffix rules

- `Contract`: type-level requirements.
- `Definition`: authored implementation satisfying a Contract.
- `Declaration`: descriptive information consumed by an adapter/compiler.
- `Adapter`: implementation translating a required interface.
- `Instance`: live realization with identity or lifecycle.
- `Scope`: lifetime-bound resources or authority only.
- `Runtime`: live implementation machinery only.
- `Language`: authoring algebra only.
- `Driver`: private replaceable low-level engine inside an adapter.
- `Registry`: lookup plus registration/ownership.

Architectural files use nouns. Functions use verbs. Executable scripts use
command verbs, so `scripts/build.ts` is conventional and remains unless its
responsibility changes.

## Target semantic changes

### Application and execution

- Standardize the authored root and compiler artifact on `Application`:
  `compileApplication`, `ApplicationIR`, and `application.ir.json`.
- Rename `ProgramAddress` to `ProgramContributionAddress`.
- Replace `ProcessAdapter`, which does not realize a Process, with the narrowly
  truthful `CapabilityResolver`. Remove adapter publication of Feature-local
  provided Capabilities; the Process assembles those internally.
- Rename `startProgram` to `startProcess` because it returns a live Process.
- Rename `RuntimeScope` to `ResourceScope`.
- Rename the live Feature-local UI value from `UIInstance`/`surface` to
  `UIContributionInstance`/`api`; expose Process UI contributions as `ui`, not
  `surfaces`.
- Remove `Peer` from durable documentation until it has an actual contract.
- Move concrete `Server` and PWA declarations out of generic core. The current
  built-in server Environment becomes a clearly named environment supplied by
  the current production adapter, while PWA metadata belongs to the web
  platform/toolchain.

### Components

- Rename the Feature-local state/action object exposed to a Component from
  `ComponentProcess`/`process` to `ComponentFeatureAPI`/`feature`.
- Rename Component `start` to `mount`; it runs for a mounted Component and owns
  mount-lifetime resources.
- Rename `ComponentRenderScope` to `ComponentViewContext` and start-related types
  to mount-related types.
- Keep `state`, `actions`, `view`, `props`, `slots`, `components`, and `elements`.
- Remove core `VisualValue`, fixed visual unit kinds, Component state-kind
  extraction, and `visualValues` IR metadata. Component state uses ordinary
  semantic TypeScript types; a Presentation language may provide its own typed
  helpers.
- Remove core `PresentationAppearance` and `PresentationControl`. Selecting or
  parameterizing a Presentation is ordinary application behavior, not an
  implicit undeclared Capability.

### Presentation

- Keep `Presentation` as the universal stage name.
- Rename the generic `Tokens` parameter to `Parameters`; core assigns no shape
  or taxonomy to it.
- Remove `PresentationRegistration`, `PresentationRegistrationContract`,
  `themes`, and all core token/theme vocabulary.
- A Presentation is configured by ordinary function application. An
  Application's `presentations` map contains complete Presentation Definitions;
  two differently parameterized uses are simply two named Presentations.
- Rename `PresentationTokensOf` to `PresentationParametersOf` only if type
  extraction remains necessary.
- Rename `PresentationComponentScope` to `PresentationComponentInput` and
  `PresentationComponentResult` to `PresentationComponentDeclaration`.
- Replace optional `Declaration`/`Declarations` duality with one required
  primitive-indexed declaration mapping. There is one way to define a
  Presentation language.
- Rename target source machinery to a resolver/binding name that reflects its
  dynamic native lookup; keep `PresentationTarget` for symbolic cross-Element
  references.
- The generic Presentation adapter owns declaration realization and disposal,
  not specifically style, rendering, motion, or observation.

### UI platforms and adapters

- Remove Presentation declarations from structural `UIPlatformPrimitive`.
- A UI Platform pairs a Component primitive contract with a Presentation
  language; the selected UI adapter realizes both.
- Ensure generic UI contracts never import web.
- Rename the web execution contexts to `BrowserMainThread` and
  `BrowserServiceWorker`.
- Rename the web `structure` implementation directory to `component`, because
  it realizes Components, hierarchy, native events, lifecycle, and interaction.
- Rename `WebStructureAdapter` to `WebComponentAdapter`.
- Rename implementation files by responsibility:
  `structure/language.ts` -> `component/adapter.ts`,
  `structure/scene.ts` -> `component/presence.ts`,
  `presentation/runtime.ts` -> `presentation/adapter.ts`,
  `presentation/assets.ts` -> `presentation/fonts.ts`, and
  `web/runtime.ts` -> `web/toolchain.ts`.
- Rename `PresenceScene` to `PresenceGraph` and font `Backend` to `Registry`.
- Keep web-only motion, style, fonts, conditions, resources, and responsive
  declarations inside the web Presentation language/adapter. They are not core
  concepts.
- Rename web Presentation generic `Theme` variables to `Parameters`. The web
  adapter may offer a design-token-shaped parameter library, but core does not
  know or require it.
- Audit presentation declarations that affect native behavior or accessibility.
  Pointer hit testing, touch behavior, semantic visibility, and native event
  policy remain Component responsibilities.

## Target repository

```text
src/
  application.ts
  process.ts
  cli.ts
  compiler/
    source.ts
    ir.ts
    development.ts
    production.ts
  ui/
    component.ts
    platform.ts
    presentation.ts
    jsx/
      types.ts
      runtime.ts
      development.ts
    web/
      platform.ts
      toolchain.ts
      component/
        adapter.ts
        compiler.ts
        elements.ts
        interaction.ts
        presence.ts
        runtime.ts
      presentation/
        adapter.ts
        fonts.ts
        language.ts
        motion.ts
        style.ts
```

Files may remain separate only where they own an independent contract,
lifecycle, translation, or focused test. Technology names occur only inside
the concrete adapter that uses them.

## Testing architecture

### Vitest setup

- Add one minimal `vitest.config.ts` to the package and canonical template.
- Keep whole-project `tsc --noEmit` as the authoritative source/type gate.
- Configure deterministic isolation and cleanup; avoid hidden globals.
- Keep colocated `*.spec.ts` for executable behavior and
  `*.typecheck.ts(x)` for compile-only contracts.
- Add `fast-check` only to the kit's development dependencies.
- Keep coverage informational rather than treating a percentage as proof.
- Keep benchmarks separate from correctness gates.

### Contract and property evidence

- Application/type tests prove valid composition and reject conflicting
  Environments, invalid Components, crossed UI primitives, state/action name
  collisions, and incomplete Presentations.
- Compiler properties prove deterministic IR, stable source normalization,
  structured rejection of unsupported source, and development/production
  semantic equivalence for the supported portable subset.
- ResourceScope model tests generate adopt/start/action/dispose/error sequences
  and prove exactly-once reverse cleanup, iterator cancellation, idempotent
  disposal, no work after disposal, and deterministic error aggregation.
- Fine-grained UI tests instrument reads, computations, and native writes to
  prove unrelated state changes perform no work and disposal stops updates.
- Presentation contract tests use synthetic declaration languages unrelated to
  CSS or motion to prove that core accepts arbitrary adapter-defined meaning.
- Adapter conformance tests exercise create/commit/replace/dispose, dynamic
  Element resolution, removed declarations, repeated commits, target
  multiplicity, and cleanup.
- Web-specific property tests cover declaration translation and retained
  adapter state. Motion properties remain web-adapter tests: finite values,
  interruption continuity, latest-command wins, terminal convergence, and no
  retained resources after disposal.
- Persist every shrunk random counterexample as a focused regression only when
  it documents a meaningful boundary case.

### Integration and end-to-end evidence

- Generate a fresh application from the CLI in a temporary directory.
- Install the packed kit, then run typecheck, lint, format check, Vitest, and a
  production build.
- Resolve every public export from the packed artifact.
- Start the generated application in development, verify initial load,
  interaction, Presentation application, and state-preserving hot replacement
  in the real in-app browser.
- Load the production bundle in the real browser and verify equivalent visible
  behavior and a clean console.
- Do not add Playwright or simulated DOM as a substitute for the real-browser
  acceptance gate.

## Migration checklist

### 1. Establish the baseline

- [x] Record git state and preserve all existing work.
- [x] Run current typecheck, tests, build, and package inspection.
- [x] Record public exports and source dependency direction.

**Gate:** the pre-migration baseline is understood and failures introduced by
the migration are distinguishable from existing failures.

### 2. Migrate core vocabulary

- [x] Apply Application/IR/compiler names without aliases.
- [x] Migrate execution to Process, CapabilityResolver, and ResourceScope names.
- [x] Remove unused topology concepts and concrete platform concerns from core.
- [x] Migrate Component contexts, Feature API access, and mount lifecycle.
- [x] Remove core visual-state, theme, and appearance machinery.

**Gate:** source searches find no obsolete core Product, ProcessAdapter,
RuntimeScope, ComponentProcess, VisualValue, theme, token, Appearance, PWA, or
Peer vocabulary except deliberate adapter-local terms.

### 3. Rebuild Presentation and UI Platform contracts

- [x] Make Presentation parameterization completely generic.
- [x] Replace registrations/themes with configured Presentation Definitions.
- [x] Establish one primitive-indexed Presentation language shape.
- [x] Separate structural primitives from Presentation declarations.
- [x] Update synthetic second-platform compile tests.

**Gate:** generic tests express unrelated synthetic Presentation languages
without changing core, and Presentation has no channel to mutate behavior.

### 4. Reorganize the web adapter

- [x] Apply the target component/presentation directory structure.
- [x] Rename adapters, presence graph, font registry, environments, and web
      toolchain consistently.
- [x] Generalize web Presentation parameter naming.
- [x] Remove behavior/accessibility declarations from the Presentation language.
- [x] Keep third-party Anime.js and browser APIs behind web implementation
      contracts.

**Gate:** every web file can be explained by one owned contract, lifecycle, or
translation; generic modules have no web imports.

### 5. Add strategic test setup and evidence

- [x] Add minimal Vitest configuration to kit and template.
- [x] Add fast-check and replace ad hoc random loops with shrinking properties.
- [x] Add ResourceScope lifecycle/model properties.
- [x] Add compiler determinism/metamorphic properties.
- [x] Add generic Presentation and UI adapter conformance tests.
- [x] Retain focused web translation, interaction, presence, and motion tests.
- [x] Keep test naming and placement aligned with the owning semantic module.

**Gate:** tests fail on deliberate lifecycle, compiler, and adapter mutations;
random failures report reproducible seeds and minimal counterexamples.

### 6. Align package, template, and documentation

- [x] Remove redundant core subpath exports; keep one public path per concept,
      required JSX runtime paths, web adapter paths, and tsconfig.
- [x] Update package source allowlist and build entry discovery.
- [x] Update CLI commands and diagnostics to the final vocabulary.
- [x] Update the template to configure a Presentation with arbitrary parameters,
      without core theme/token registration.
- [x] Rewrite `architecture.md` as the sole durable vocabulary authority.
- [x] Add concise adapter and testing documentation only where architecture does
      not already explain the contract.
- [x] Remove completed or contradicted plan documents after their durable
      conclusions are incorporated.

**Gate:** README, docs, JSDoc, diagnostics, template, source, IR, and exports all
use the same terms with no compatibility aliases or competing explanations.

### 7. Final verification

- [x] Run TypeScript, Oxlint, Oxfmt, and every Vitest suite.
- [x] Build the package from a clean `dist`.
- [x] Inspect and install the packed artifact.
- [x] Generate and fully check a fresh application.
- [x] Build development and production application artifacts.
- [x] Verify development load, interaction, Presentation, disposal, HMR state
      preservation, and console output in the real browser.
- [x] Verify the production artifact in the real browser.
- [x] Audit cycles, generic-to-web imports, obsolete vocabulary, generated
      residue, and `git diff --check`.

**Final gate:** the framework has one precise vocabulary, one Presentation
parameterization model, one adapter convention, strategic reproducible tests,
one canonical template, and documentation that describes the implementation
without exceptions.

## Verification evidence

- `nub run check` passed TypeScript 7, Oxlint, Oxfmt, and 115 tests in 16
  Vitest files.
- `nub run build` rebuilt `dist` successfully from the final source tree.
- `npm pack` produced a 97-entry artifact with no test or typecheck sources. A
  fresh project installed that tarball and passed its generated `check` and
  production `build` commands.
- Every public entry resolved from the installed artifact: package root, both
  JSX runtime entries, web, and web Presentation.
- The generated Application IR is version 3 and records the typed count state,
  increment action, browser-main Environment, Elements, Component lifecycle,
  and configured Presentation.
- In a real Chromium browser, the installed development artifact loaded with
  its Presentation, changed `Count 0` to `Count 1`, and retained `Count 1` while
  a Presentation-only hot update changed the title from 32px to 36px. The
  console contained only Vite connection and hot-update diagnostics.
- A separate full structural hot replacement invoked the outgoing Component's
  disposable mount resource, rendered the replacement hierarchy, and retained
  `Count 1` without a console error.
- The production artifact reproduced the interaction and 36px Presentation in
  a separate real-browser session with an empty console.
- A TypeScript-AST dependency audit found 30 production modules and zero
  cycles. Searches found no generic-to-web imports, generated residue, backup
  files, stale public vocabulary, or whitespace errors.
