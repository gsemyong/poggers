# Generic Native Runtime Correction

## Goal

Poggers must compile the same product meaning used by TypeScript development into independently
deployable production artifacts without teaching the compiler about particular Feature factories
or placing product behavior inside a universal runtime.

A Feature factory is ordinary reusable source organization. It may produce Programs, Components,
and semantic Capability contracts, but it receives no privileged compiler branch. A Program is the
unit of deployment. A Capability is its only authority boundary. Platform adapters select concrete
development and production implementations for external Capabilities.

The authenticated CRUD example is evidence only when its server Program follows this generic path.
Matching a bounded HTTP test with a second handwritten application is not compiler evidence.

## Non-Negotiable Invariants

1. The source compiler contains no reference to `createIdentity`, `createEntity`, or any other
   reusable Feature factory.
2. The native builder contains no requirement for identity/entity counts or Feature kinds.
3. Stable runtime code contains execution machinery only. It contains no application routes,
   authentication policy, database schema, entity events, or concrete storage implementation.
4. Every external Capability is bound by a production adapter selected through its semantic
   contract. Unknown, missing, duplicate, and incompatible bindings fail before Cargo.
5. Feature-provided Capabilities are linked from the Program graph and do not become host
   dependencies.
6. TypeScript development and Rust production execute the same canonical Program IR. Backends may
   optimize it but cannot independently reinterpret authored source.
7. Concrete adapters may contain concrete code. SQLite SQL belongs in a SQLite adapter; HTTP route
   machinery belongs in an HTTP adapter; neither belongs in the generic runtime.
8. Generated Rust contains wiring and translated product behavior only. Stable adapter code is
   checked-in Rust and generated workspaces reference or copy it explicitly.
9. Tests assert semantic observations at contracts. They do not bless implementation duplication.
10. Repository and generated artifacts are clean after every gate.

## Target Pipeline

```text
Application TypeScript
  -> TypeScript semantic analysis
  -> canonical Application IR
  -> linked Program IR
       -> translated Program functions
       -> linked Feature-provided Capabilities
       -> external Capability requirements
  -> Platform production adapter
       -> select native Capability adapters
       -> validate structural contracts
       -> generate wiring crate
       -> build one artifact per Program
```

The compiler owns language meaning. The linker owns the Program dependency graph. A Platform
adapter owns realization. A Capability adapter owns concrete external authority.

## Target Source Organization

```text
src/
  core/
    compiler/                 # TypeScript -> canonical IR and generic backend lowering
    ...                       # application, Program, Capability, Component, Presentation
  contracts/
    platform.ts               # Platform adapter contract
    native.ts                 # native Capability adapter contract
  features/
    identity.ts               # reusable factory, no compiler privilege
    entity.ts                 # reusable factory, no compiler privilege
  adapters/
    server/
      adapter.ts              # server development/production orchestration
      host.ts                 # Node development Capability implementations
      native.ts               # generic Rust workspace assembly/cache
      native/
        program.ts            # Program IR -> direct Rust control flow
        capabilities.ts       # checked-in adapter registrations
        runtime/              # generic execution/lifecycle support only
        capabilities/
          authentication/
          clock/
          events/             # SQLite single-node authority
          events-jetstream/   # network authority
          http/
          identifiers/
    web/
      ...                     # web UI, document IR, hydration, production assets
```

Names may be compressed where a directory would contain only one meaningful file. The semantic
ownership boundaries, rather than this exact indentation, are normative.

## Execution Plan

### 1. Truth and Hygiene

- [x] Add Cargo outputs and all Poggers runtime data to root and template ignore rules.
- [x] Delete generated `target`, `Cargo.lock`, example data, and example build artifacts.
- [x] Replace completed-plan claims that exceed evidence with one current architecture document
      and this active correction record.
- [x] Record a baseline test and package result before structural changes (`42` files, `318` tests,
      typecheck, Oxlint, Oxfmt, and package build).

Gate: `git status --short --untracked-files=all` contains only intentional source changes, no build
or runtime output, and documentation states the current limitation explicitly.

### 2. Generic Feature Expansion

- [x] Remove identity/entity variants from compiler-facing Program implementation IR.
- [x] Remove `portableFeatureImplementation`, `featureFactoryInvocation`, and all factory-name
      recognition from the source compiler.
- [x] Represent every headless Feature contribution as ordinary Program code plus typed
      provided/required Capabilities.
- [x] Ensure imported generic factories and their specialized closures lower without executing
      authored source.
- [x] Add a third, unrelated reusable Feature factory as a falsification fixture.

Gate: searching compiler and generic native builder source for shipped Feature factory names returns
nothing. Identity, entity, and the unrelated factory compile through one implementation kind.

### 3. Complete Portable Program IR

- [x] Extend canonical IR only where required for ordinary Program code: closures passed through
      typed contracts, async work, streams/subscriptions, and owned disposable resources.
- [x] Define deterministic lifecycle semantics for resources acquired by a Program.
- [x] Lower and execute the same constructs in the JavaScript reference runtime and Rust backend.
- [x] Reject unsupported syntax with source-located diagnostics before native work.
- [x] Preserve recursive type information needed for native contract and serialization boundaries.

Gate: differential/property tests compare return values, Capability calls, callback calls,
subscription sequences, failures, and cleanup order between JavaScript and Rust.

### 4. Native Capability Adapter Contract

- [x] Define one data-first descriptor for a native Capability implementation: semantic contract,
      supported Platform, crate source, configuration schema, provided Rust type, and constructor.
- [x] Select adapters by recursive structural Capability identity rather than product switches.
- [x] Validate missing, duplicate, ambiguous, incompatible, dependency-missing, and cyclic bindings
      before Cargo. Unused registered adapters are intentionally allowed.
- [x] Generate concrete Rust constructor wiring from linked Program IR and retain one stable dynamic
      Capability ABI after that boundary.
- [x] Make adapter registration extendable without modifying compiler or generic linker source.

Decision: per-application Rust traits were rejected as a correctness requirement. They would couple
independently checked-in adapter crates to a generated crate. The current boundary validates the
complete recursive contract before Cargo, statically constructs each concrete Rust adapter, and
erases only the call ABI to `Value`. Monomorphizing that ABI is a future backend optimization, not
part of the generic-architecture claim.

Gate: an independently declared test Capability is implemented in Rust, registered by the server
adapter, injected into a translated Program, and exercised without edits to compiler/linker code.

### 5. Capability Ownership and Rust Cleanup

- [x] Reduce the stable native runtime to generic lifecycle/error/value support.
- [x] Move HTTP, authentication, SQLite events, JetStream events, identifiers, and clock into their
      respective Capability adapter boundaries.
- [x] Move schema creation and migrations into the adapters that own those schemas.
- [x] Remove fixed auth/entity routes, cookies, event names, and storage assumptions from runtime.
- [x] Keep dependency versions in Cargo manifests rather than duplicated TypeScript strings.
- [x] Give every Rust crate focused unit tests and integrated contract acceptance tests.

Gate: an automated forbidden-vocabulary scan and dependency audit prove that generic runtime code
contains no shipped Feature or concrete infrastructure policy.

### 6. Authenticated CRUD Through the Generic Path

- [x] Translate the identity and entity server Programs rather than translating callbacks into a
      handwritten application runtime.
- [x] Bind their external host requirements through native Capability adapters.
- [x] Build the multi-Feature `api` Program with no native builder special case.
- [x] Run the same auth, authorization, optimistic command, persistence, realtime, restart, and
      error scenarios against JavaScript development and Rust production.
- [x] Verify generated workspaces contain translated Program code and generic wiring, not a second
      authored implementation of the application.

Gate: deleting or changing authored server behavior changes both backends through IR. Removing the
identity Feature yields a valid non-authenticated Program when its remaining contracts permit it;
adding another Feature requires no native builder edit.

### 7. Web SSR and Production Composition

- [x] Keep versioned initial-state Web Document IR and deterministic Rust rendering.
- [x] Bind web asset/document serving through explicit server capabilities or artifact composition,
      not application policy in generic runtime.
- [x] Verify SSR/TypeScript renderer parity, exact-node hydration, mismatch recovery, and deep URLs.
- [x] Preserve the explicit boundary between initial-state SSR and request-data SSR.

Gate: the generic server Program can be built headless or composed with a web artifact without
changing its translated product code.

### 8. Replicas and Production Authorities

- [x] Keep placement as deployment policy rather than product syntax.
- [x] Run two independent JavaScript replicas against a network EventStore authority.
- [x] Implement a native network EventStore adapter without pretending SQLite
      demonstrates horizontal scaling.
- [x] Test compare-and-append contention, subscriptions, restart catch-up, principal isolation, and
      deterministic placement.
- [x] Separate single-authority simulation evidence from multi-node broker failure evidence.

Gate: all replica claims identify the exact process and failure topology tested. No native scaling
claim exists without a native network-capability implementation and test.

### 9. Packaging, Configuration, and Final Audit

- [x] Ensure source packages, Cargo crates, templates, aliases, toolchains, lockfiles, and generated
      caches follow one documented convention.
- [x] Remove obsolete implementation variants, completed plans, duplicated tests, and
      compatibility paths.
- [x] Build and install a package tarball in a clean generated application.
- [x] Run TypeScript, Oxlint, Oxfmt, Vitest, rustfmt, Clippy, Cargo tests, native build, browser E2E,
      and replica acceptance.
- [x] Audit every architectural claim against a source location and executable gate.

Gate: the repository is clean after verification, all source has one architectural owner, and a
fresh independent capability/feature can be added through documented extension points only.

## Final Evidence

- A cold `nub run typecheck` passes with no generated `dist/` tree.
- `nub run check` passes TypeScript, Oxlint, Oxfmt, the package build, 43 Vitest files, and 326
  tests.
- Every checked-in Rust crate passes rustfmt, Cargo tests, and warnings-as-errors Clippy.
- A packed installation passes the generated starter's own check and production build. A separate
  packed authenticated CRUD installation emits a native arm64 server plus web SSR/browser assets.
- The packaged native server passes deep-link SSR, authentication, authorized entity creation,
  persistence across process restart, browser hydration, URL navigation, UI mutation, and reload.
- JavaScript and native network-replica acceptance use independent processes against JetStream on
  one machine. No multi-node broker failover result is claimed.

## Completion Criteria

The goal is complete only when all checkboxes and gates pass. Passing the authenticated CRUD test
alone is insufficient. A fixed Rust implementation that happens to match that example is a failed
result. Any compiler reference to a reusable Feature factory, any generic runtime reference to
product concepts, or any undocumented generated residue blocks completion.
