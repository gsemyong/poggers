# Platform And Presentation Foundation Plan

Status: completed source of truth

## Goal

Refine Poggers into a clean foundation for platform-specific behavior,
structure, Presentation, and adapters. Enforce a one-way product dependency in
which Presentation consumes typed meaning from behavior while behavior remains
independent of the selected Presentation. Separate reusable Presentation
programs from concrete Themes, organize platform implementations consistently,
remove redundant authoring paths, and leave the repository ready for focused
work on a high-quality web adapter.

This plan intentionally does not add a Presentation composition DSL. Reusable
styles remain ordinary pure TypeScript functions and values checked against the
platform declaration language.

## Architectural Invariants

```text
platform-specific behavior and structure
  -> props + readonly state + typed Element identities
  -> platform-specific Presentation program + concrete Theme
  -> immutable platform declarations
  -> paired platform implementation
  -> native structure, semantics, rendering, motion, input, and disposal
```

- [x] Behavior owns state transitions, Actions, hierarchy, semantics,
      accessibility, native events, capabilities, and structural lifecycle.
- [x] Presentation depends on the behavior contract through Feature, Component,
      Element, props, and readonly state types.
- [x] Behavior has no implicit access to Presentation name, Theme, declarations,
      or Presentation runtime state.
- [x] Application code may explicitly depend on an appearance-selection
      capability when appearance selection is itself product behavior.
- [x] A Presentation is one reusable mapping from a token contract and behavior
      meaning to declarations.
- [x] A Theme is one concrete value satisfying that Presentation's token
      contract.
- [x] A platform Presentation adapter interprets declarations; it is not a
      design, Theme, or ordinary mechanism for visual variation.
- [x] Structure and Presentation implementations for one platform are paired
      behind one platform package and may coordinate only through private native
      machinery.
- [x] Reuse uses normal TypeScript values, functions, modules, and Feature
      namespaces. Core gains no recipe, mixin, merge, or module-composition DSL.
- [x] No legacy registration or compatibility path remains.

## Target Public Syntax

```ts
type DrawerTokens = WebPresentationTokens & {
  color: { surface: OklchColor; text: OklchColor };
  motion: { sheet: MotionTokenValue };
  resources: { close: WebSymbolResource };
};

const drawerPresentation = ((tokens: DrawerTokens) => ({
  Visual: {
    Drawer: ({ state }) => ({
      Surface: {
        paint: { fill: tokens.color.surface },
        motion: {
          translation: {
            block: { target: state.open ? 0 : 1, transition: tokens.motion.sheet },
          },
        },
      },
      CloseIcon: { resource: tokens.resources.close },
    }),
  },
})) satisfies WebPresentation<App, DrawerTokens>;

const drawer = {
  presentation: drawerPresentation,
  themes: {
    default: familyTheme,
    studio: studioTheme,
  },
} satisfies PresentationRegistration<typeof drawerPresentation>;
```

Application registration contains Presentation registrations, never manually
materialized Presentation definitions:

```ts
presentations: {
  drawer;
}
```

## Target Organization

```text
packages/kit/src/ui/
|- component.contract.ts       behavior/structure product contract
|- component.ts                Component authoring surface
|- presentation.ts             generic Presentation + Theme registration
|- platform.ts                 complete generic platform association
|- web/
|  |- adapter.ts               paired web platform implementation
|  |- platform.ts              web primitive contract
|  |- structure.ts             web Component/structure runtime
|  |- presentation.ts          public web Presentation entry
|  `- presentation/
|     |- language.ts           web token and declaration language
|     |- adapter.ts            declaration interpreter
|     |- font.ts
|     `- style.ts
`- three/
   |- adapter.ts               paired Three platform implementation
   |- platform.ts              Three primitive contract
   |- structure.ts             Three structure helpers
   |- presentation.ts          public Three Presentation entry
   `- presentation/
      |- language.ts           Three declaration language
      `- adapter.ts            declaration interpreter
```

JSX runtime entry files may remain at platform roots where package resolution
requires them. Supporting web interaction and runtime modules remain outside
Presentation when they are structural platform APIs.

## Phase 1: Baseline And Ownership Audit

- [x] Record every generic scope that currently exposes Presentation to
      behavior.
- [x] Record every place that assumes Presentations are pre-materialized Theme
      maps.
- [x] Record all public exports, package files, generated imports, HMR paths,
      source-condition paths, and type fixtures affected by reorganization.
- [x] Classify each web and Three module as generic contract, platform contract,
      structure implementation, Presentation language, Presentation adapter, or
      paired adapter.

**Gate:** every moved or changed symbol has one target owner and every generated
or packaged path is listed before edits begin.

## Phase 2: Enforce Behavior Independence

- [x] Remove selected Presentation and Theme from Component state
      initialization, Action, and `start` scopes.
- [x] Keep Appearance selection only as an explicit capability/API rather than
      ambient Component context.
- [x] Migrate Visual Lab appearance switching without behavior branching on
      implicit Presentation context.
- [x] Add negative type proofs that behavior scopes cannot access Presentation,
      Theme, declarations, or adapter state.
- [x] Preserve props, process state, local state, Actions, capabilities, Elements,
      and component composition in their correct scopes.

**Gate:** behavior compiles without importing a concrete Presentation or Theme,
and attempts to read ambient Presentation information fail at compile time.

## Phase 3: Separate Presentation, Token Contract, And Theme

- [x] Rename the web base contract from `WebPresentationTokens` to
      `WebPresentationTokens` so the type denotes requirements rather than a
      concrete Theme value.
- [x] Rename generic Presentation type parameters and documentation from Theme
      to Tokens where they describe a contract.
- [x] Add `PresentationRegistration<Presentation>` deriving the required Theme
      type from the Presentation function.
- [x] Require every registration to contain one `default` Theme and allow named
      additional Themes satisfying the same token contract.
- [x] Make `Application` require one registration for every declared
      Presentation name.
- [x] Reject missing default Themes, incompatible Theme values, materialized
      definitions, and unrelated token contracts in type fixtures.
- [x] Demonstrate one Presentation with at least two Themes, including different
      valid motion token variants and different resources.

**Gate:** Presentation code is authored once, each Theme is checked against its
semantic token contract, and the application registration preserves their
relationship at the type level.

## Phase 4: Runtime, Reactivity, And HMR

- [x] Materialize the selected Presentation and Theme inside the platform
      runtime, not in application source.
- [x] Cache materialized definitions by Presentation/Theme identity and
      invalidate only on registration HMR updates.
- [x] Keep props and state reads fine-grained and reactive after materialization.
- [x] Validate registration and Theme names explicitly at runtime.
- [x] Preserve selected Presentation, selected Theme, Component state, retained
      presence, and focus across compatible HMR.
- [x] Reject incompatible registration shape changes with one clean remount.
- [x] Remove the old pre-materialized Theme-map runtime path completely.

**Gate:** switching Themes for one Presentation updates declarations without
remounting behavior; compatible HMR preserves state and no stale materialized
definition survives an update.

## Phase 5: Remove Redundant Authoring Paths

- [x] Remove `createSpring` unless a test demonstrates semantic normalization
      that raw declaration data cannot provide.
- [x] Use the raw immutable motion-token representation as the canonical syntax.
- [x] Keep reusable declaration helpers as ordinary application or design-system
      TypeScript functions returning the same public declaration data.
- [x] Do not add `createPresentation`, `createRecipe`, `composePresentation`, or
      equivalent wrappers without demonstrated inference or runtime meaning.
- [x] Update templates and examples to teach only the canonical syntax.

**Gate:** each concept has one semantic representation; helper functions are
ordinary code and do not create another lifecycle or execution channel.

## Phase 6: Organize Platform Implementations

- [x] Merge the redundant generic `platform.contract.ts`/`platform.ts` split if
      dependency analysis confirms no runtime cycle is introduced.
- [x] Move web pairing into `web/adapter.ts` and web structure ownership into
      `web/structure.ts`.
- [x] Move the web declaration algebra to `web/presentation/language.ts` while
      retaining `web/presentation.ts` as the intentional public entry.
- [x] Give Three the same platform/structure/Presentation/paired-adapter
      organization without pretending its structure is web-like.
- [x] Update internal aliases, generated imports, build entrypoints, package
      files, exports, and source-condition paths atomically.
- [x] Delete superseded files and re-export shims; no compatibility residue.
- [x] Ensure adding another platform requires only its own contract,
      implementation, tooling integration, and conformance tests.

**Gate:** directory boundaries correspond to architectural ownership, public
exports resolve from source and distribution, and no duplicate adapter factory
or declaration language remains.

## Phase 7: Type, Runtime, And Distribution Verification

- [x] Typecheck Kit, Chat, and Visual Lab.
- [x] Run lint and formatting with no suppressions introduced for the migration.
- [x] Run all unit, conformance, compiler, HMR, and pressure tests.
- [x] Add focused tests for one Presentation with multiple Themes, resource
      substitution, motion-token substitution, and invalid Theme contracts.
- [x] Verify Component and Feature composition still map to the correct
      Presentation namespaces and Element declarations.
- [x] Build all packages and applications.
- [x] Pack Kit and inspect that every public source/type/runtime file is present
      and no deleted or test-only file ships.
- [x] Install the tarball into a clean consumer; run its typecheck and build.
- [x] Generate a fresh application; run its check and production build.
- [x] Use `agent-browser` to verify Presentation switching, Theme switching,
      focus, interaction, state preservation, HMR, and browser errors.

**Gate:** repository, clean-consumer, generated-app, and browser evidence all
agree with the new contract.

## Final Review

### Boundary

- [x] Behavior has no ambient dependency on Presentation.
- [x] Presentation has a typed one-way dependency on behavior meaning.
- [x] Themes are concrete values, never executable alternate Presentations.
- [x] Native coordination remains private to the paired platform implementation.

### Minimality

- [x] No Presentation composition DSL was added.
- [x] No helper duplicates canonical declaration syntax without proven value.
- [x] No legacy registration path or re-export shim remains.
- [x] Every remaining module and public export has one architectural owner.

### Completion

- [x] All phases and gates pass.
- [x] The final API is documented with one small behavior, one Presentation,
      multiple Themes, and one paired adapter trace.
- [x] Remaining web adapter language gaps are listed without expanding them in
      this migration.
- [x] Visual Lab remains available for direct inspection.

## Decision Log

Append dated decisions with the observed evidence, accepted adjustment, and
exact files/tests. Checklist items are completed only after their verification
gate passes.

### 2026-07-18: One-way boundary and registration

- **Observed:** Component initialization, Action, and lifecycle scopes received
  the selected Presentation and Theme even though appearance is not ambient
  behavior state. Applications also stored already-materialized definitions.
- **Adjustment:** behavior scopes now contain only their behavioral inputs;
  appearance selection is an explicit Program capability. A registration pairs
  one Presentation function with one required `default` Theme and optional
  named Themes through `PresentationRegistration`.
- **Evidence:** negative type proofs reject ambient appearance reads, invalid
  token values, missing defaults, and materialized definitions. Family uses one
  Presentation with `default` and `vivid` Themes that substitute resources and
  spring values.

### 2026-07-18: Runtime and HMR ownership

- **Observed:** application source executed Presentation functions, obscuring
  Theme identity and preventing the runtime from owning cache invalidation.
- **Adjustment:** the web runtime validates registrations, materializes and
  caches definitions by Presentation/Theme identity, and clears that cache on
  compatible registration HMR. The paired adapter is now the only place that
  connects structure to the Presentation interpreter.
- **Evidence:** browser checks switched Family Themes and switched to Studio
  while an expanded Component and focus were retained. Touching the active
  Studio Presentation produced a presentation-only Vite update while selected
  appearance, expanded state, and focus remained intact; no browser errors were
  reported.

### 2026-07-18: Platform organization and distribution

- **Observed:** one generic platform contract was split across two files, web
  pairing lived in its structure runtime, and Three called its Presentation
  interpreter the platform adapter.
- **Adjustment:** generic platform meaning now has one owner. Web and Three each
  expose explicit platform, structure, Presentation language, Presentation
  interpreter, and paired adapter modules. `createSpring` and the legacy
  materialized registration path were deleted rather than shimmed.
- **Evidence:** lint, formatting, all workspace typechecks, 165 Kit tests, all
  production builds, package inspection, and a fresh application installed
  from the packed tarball all pass. The packed artifact contains the new paths
  and no superseded or test-only source files.

### Deferred adapter work

This migration deliberately establishes the contract and ownership needed to
author a first-rate web adapter; it does not claim that the current web visual,
motion, gesture, or sensory implementation has reached that quality bar. That
work can now proceed inside `ui/web/presentation` and the paired web adapter
without changing behavior or the generic Presentation envelope.
