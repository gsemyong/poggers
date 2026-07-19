# Platform contract and adapter migration

This document is the source of truth for the no-compatibility migration that
reduces Poggers to three architectural regions: core product meaning, extension
contracts, and co-located platform adapters. The migration is complete only
when every checklist item and acceptance gate passes.

## Objective

Poggers must make the following model obvious in its API, dependency graph,
filesystem, generated template, tooling, and tests:

```text
Application source
`- core product language
   `- deterministic Application IR
      `- explicitly selected Platform Adapter
         |- development realization
         `- production artifacts
```

Every UI or headless Program runs in an Environment. Every Environment names
the Platform whose adapter realizes it. A Platform always supports Processes
and may additionally define one UI language. Individual Environments of a
UI-capable Platform may remain headless, such as a browser service worker.
Everything outside process realization and optional UI crosses typed Capability
contracts.

## Final concepts

- `Application`, `Feature`, `Program`, `Process`, `Environment`, `Capability`,
  `Component`, `Element`, and `Presentation` retain their established meanings.
- `Platform` is the technical realization family selected by an Environment.
  It is not deployment topology, a device identity, or a synonym for
  Environment.
- `PlatformContract` declares a stable Platform identity and its optional UI
  language.
- `PlatformAdapter` is the sole top-level implementation contract. It realizes
  development and production for one Platform and owns optional UI realization.
- `UIAdapter` is a conditional part of a UI-capable Platform Adapter. It pairs
  Component and Presentation realization; it is not a separate top-level
  adapter family.
- `CapabilityResolver` remains the runtime boundary for external authority. A
  concrete Platform Adapter may supply platform Capabilities through the same
  mechanism; core never imports host technology.
- `Driver` names a private replaceable implementation engine. `Adapter` is
  reserved for implementations of framework extension contracts.
- `DevelopmentSession` is a live, disposable development realization.
- `ProductionArtifacts` describes emitted entries without prescribing a
  language, bundler, filesystem layout, or deployment system.

## Contract constraints

The exact TypeScript surface is frozen only after the pressure tests in phase 1,
but it must satisfy this minimal shape:

```ts
type PlatformContract = {
  Name: string;
  UI?: UIContract;
};

type EnvironmentContract = {
  Name: string;
  Platform: PlatformContract;
  UI?: UIContract;
};

type PlatformAdapter<Platform extends PlatformContract> = {
  readonly name: Platform["Name"];
  develop(input: DevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: ProductionInput<Platform>): Promise<ProductionArtifacts>;
  // Required by the type system only when Platform declares UI.
  readonly ui?: UIAdapter;
};
```

The final contract must enforce these invariants without wrappers used only to
recover inference:

1. An Environment has exactly one Platform identity.
2. Programs sharing a name still require one compatible Environment.
3. Headless Platforms cannot implement or receive UI declarations.
4. UI-capable Platforms require compatible Component primitives and
   Presentation declarations.
5. A headless Environment may use a UI-capable Platform without gaining UI.
6. Adapter selection is exact and exhaustive for every Platform in an
   Application IR.
7. Development sessions and adapter resources have one idempotent, owned
   disposal path.
8. Production outputs are deterministic for identical source, IR, and adapter
   configuration.
9. Core and contracts cannot import any concrete adapter or third-party host
   implementation.
10. Product source cannot access adapters directly. It observes only semantic
    Platform types and Capabilities.

## Final repository

```text
src/
  core/
    application.ts
    process.ts
    component.ts
    ui.ts
    presentation.ts
    development.ts
    compiler/
      source.ts
      ir.ts
    jsx/
      types.ts
      runtime.ts
      development.ts

  contracts/
    capability.ts
    platform.ts

  adapters/
    index.ts
    web/
      index.ts
      public.ts
      platform.ts
      toolchain.ts
      ui-adapter.ts
      component/
      presentation/

  cli.ts
  index.ts

template/
scripts/
docs/
```

The concrete web implementation may retain focused internal files when they
own an independent translation, lifecycle, or substantial testable engine. It
must not repeat `contract`, `adapter`, `runtime`, and `driver` files at every
level by convention. The browser-safe `public.ts` exposes the web product
language. The implementation-only `index.ts` composes the complete adapter and
is exposed only through the intentional adapter namespace.

There is no parallel `platforms/`, `backends/`, `internal/`, or generic
technology directory. A technology name may appear only inside the concrete
adapter that uses it.

## Dependency direction

```text
contracts/capability -> core -> contracts/platform -> adapters -> cli
                                          core/compiler --------^
template -> product-facing public package exports
```

The Capability contract is the lowest external-authority boundary used by the
core Process runtime. Core defines product meaning and deterministic IR without
importing realization contracts. The Platform contract then types realization
against that meaning. Neither region imports adapters. Adapters may depend on
third-party implementations; adapter-to-adapter imports are forbidden.
Cross-platform communication is modeled through Capabilities, not direct
imports.

## Deliberate removals

- Remove `src/ui/web`; concrete web code belongs only to `src/adapters/web`.
- Remove the current public `UIPlatformAdapter` as the top-level abstraction;
  replace it with the conditional UI portion of `PlatformAdapter`.
- Remove magic Environment-name dispatch such as assuming `browser-main`
  identifies the web adapter.
- Remove generic compiler files whose actual responsibility is a concrete
  technology realization. A Rust emitter that is not a complete named Platform
  Adapter is removed rather than preserved as speculative core functionality.
- Remove `--target rust` and other technology-specific generic CLI syntax.
- Remove global adapter registries and permanent JSX renderer installation.
  Adapter selection is an explicit typed map; activation is session-owned.
- Remove compatibility aliases and old source paths.
- Remove tests that only restate another test, inspect incidental packaging,
  snapshot implementation details, or preserve removed APIs.

## Testing strategy

Keep only evidence with a distinct architectural purpose:

1. `*.typecheck.ts(x)` proves the public product and adapter contracts.
2. Focused core specs prove state, lifecycle, disposal, compilation, and IR
   invariants.
3. Compile-only pressure tests prove process-only, mixed UI/headless, and
   multi-Platform adapter conformance. Runtime selection tests prove the generic
   behavior; each concrete adapter owns its native acceptance because the
   contract deliberately does not prescribe native effects.
4. Web specs prove web-only translation, direct native updates, interaction,
   retained presence, motion interruption, and cleanup.
5. One CLI integration spec generates the canonical application, checks it,
   builds it, and inspects semantic outputs.
6. Real-browser acceptance verifies development, HMR, interaction,
   Presentation, disposal, and production equivalence without adding an E2E
   framework dependency.

Property tests remain only for sequence-heavy invariants where shrinking adds
evidence: resource ownership, deterministic IR, adapter lifecycle traces, and
motion interruption. Benchmarks are separate from correctness. Package
inspection is a release gate, not a permanent distribution test suite.

## Implementation plan

### 0. Preserve the checkpoint

- [x] Commit the completed semantic-language migration before this work.
- [x] Record the clean baseline and current public exports.
- [x] Run the current complete check and build.

**Gate:** the migration starts from commit `b98a6b1`, a clean worktree, and a
passing baseline.

Baseline evidence: `nub run check` passes 115 tests in 16 files at
`b98a6b1`. The only migration change at the gate is this workbench document.

### 1. Falsify and freeze the contracts

- [x] Implement the smallest dependency-free `PlatformContract`, Environment
      association, realization inputs/results, and `PlatformAdapter` types.
- [x] Type-test a process-only Platform.
- [x] Type-test a UI-capable Platform with one UI and one headless Environment.
- [x] Type-test two Environments using the same Platform.
- [x] Type-test multiple Platforms in one Application.
- [x] Reject missing, duplicate, mismatched, and extra adapter bindings.
- [x] Prove that UI declarations cannot cross Platform contracts.
- [x] Prove that Capability contracts remain the only cross-platform effect
      path.
- [x] Decide exact adapter selection and lifecycle syntax from the evidence,
      then document it before moving implementation files.

**Gate:** the contract expresses all pressure cases without conditional
application code, string conventions, wrapper-only inference helpers, or
platform-specific fields in core.

### 2. Make Application IR adapter-addressable

- [x] Associate every Environment with a Platform in the product language.
- [x] Extract Platform identity into every Program IR Environment.
- [x] Validate one compatible Platform for same-named Program contributions.
- [x] Add deterministic Platform collection and adapter-selection diagnostics.
- [x] Bump the IR version because compatibility is intentionally removed.

**Gate:** adapter selection depends only on validated IR meaning, never on an
Environment-name convention or executed application source.

### 3. Establish core and contracts

- [x] Move technology-independent product language and machinery under
      `src/core`.
- [x] Move adapter-facing boundaries under `src/contracts`.
- [x] Keep generic development interpretation and replacement support together
      only where they form one coherent development substrate.
- [x] Update imports without aliases or forwarding compatibility modules.
- [x] Enforce dependency direction with Oxlint and an import-cycle check.

**Gate:** `core` and `contracts` have no web, Anime.js, Vite, DOM-runtime, or
concrete production imports; the production source graph is acyclic.

### 4. Build the web Platform Adapter

- [x] Move all concrete web code under `src/adapters/web`.
- [x] Define the web Platform specialization and browser Environments in its
      browser-safe product entry.
- [x] Compose Process, Component, and Presentation realization behind one web
      `PlatformAdapter` value.
- [x] Make JSX renderer activation session-owned and disposable.
- [x] Move Vite development and web production generation behind `develop` and
      `build`.
- [x] Keep Anime.js, WAAPI, DOM, fonts, interactions, and presentation language
      private to or publicly namespaced through the web adapter.
- [x] Rename private motion/layout backends to drivers and the current
      string-valued driver selector to a mode/kind name.

**Gate:** importing core or contracts cannot load web or third-party adapter
code; the web adapter passes the frozen contract and owns all native resources.

### 5. Simplify tooling and production realization

- [x] Add one explicit typed adapter map consumed by the CLI.
- [x] Make `dev` realize every required Platform or emit a precise unsupported
      diagnostic before starting user work.
- [x] Make `build` produce deterministic artifacts through Platform Adapters.
- [x] Remove technology-specific generic CLI targets and hard-coded internal web
      entry paths.
- [x] Remove the incomplete Rust production prototype from generic core. Retain
      portable IR evidence and the process-only synthetic adapter conformance
      test so a real server adapter can be added without changing core.
- [x] Derive package build entries from public exports and preserve one
      adapter-owned generated-runtime boundary, not a list of private files.

**Gate:** adding a new adapter requires one co-located adapter implementation,
one explicit map entry, and conformance tests; it requires no core, CLI branch,
or package-build special case.

### 6. Migrate template, exports, and documentation

- [x] Preserve the concise Feature, Component, and Presentation authoring API.
- [x] Update the canonical template to the final Platform types and exports.
- [x] Expose one path per public concept and intentional adapter namespace.
- [x] Update README and architecture documentation to the final dependency
      diagram and adapter-authoring convention.
- [x] Remove completed or contradicted plans after durable conclusions are
      incorporated; retain this checked workbench as migration evidence.

**Gate:** source, types, diagnostics, IR, exports, template, and documentation
describe one architecture without exceptions.

### 7. Reduce and strengthen tests

- [x] Classify every existing test by the retained evidence categories.
- [x] Delete redundant, obsolete, implementation-snapshot, and packaging-only
      tests.
- [x] Prove generic adapter conformance through compile-only pressure cases and
      deterministic runtime selection; keep native acceptance adapter-specific.
- [x] Run those cases against process-only, mixed UI/headless, multi-Platform,
      and real web adapter definitions.
- [x] Retain property tests only where generated sequences and shrinking matter.
- [x] Keep tests beside their owning core contract or concrete adapter.

**Gate:** every remaining test has one stated invariant and one owning
architectural boundary; deleting any test would remove distinct evidence.

### 8. Final verification

- [x] Run TypeScript, Oxlint, Oxfmt, and all Vitest suites.
- [x] Build from a clean `dist`.
- [x] Inspect and install the packed artifact.
- [x] Generate and fully check a fresh canonical application.
- [x] Resolve every public export from the installed package.
- [x] Verify development, interaction, Presentation, HMR preservation,
      replacement disposal, and console output in a real browser.
- [x] Verify production equivalence in a separate real-browser session.
- [x] Audit cycles, forbidden imports, adapter leakage, obsolete vocabulary,
      duplicate concepts, generated residue, and `git diff --check`.

**Final gate:** Poggers has one product core, one small set of extension
contracts, co-located concrete adapters, explicit deterministic adapter
selection, no compatibility layer, no technology leakage, no redundant
organization, and only strategically distinct tests.

Final evidence: the complete check passes 115 tests in 18 files; the package
build and packed-artifact inspection pass; a fresh tarball install passes its
canonical project check; real-browser development preserves state across hot
replacement and remains interactive; and a separately built production bundle
is interactive with a clean console. The installed-app gates also exposed and
removed two packaging boundary defects before completion: Node adapter internals
leaking through the web product entry, and a browser preload helper wrapping a
Node toolchain import. The lifecycle gate also moved all adapter scratch work to
the operating-system temp directory, leaving generated applications clean in
development, production, interruption, and failure paths.
