# Kit organization contract and execution plan

Status: completed 2026-07-14

## Objective

Bring `@poggers/kit` to a state where its organization follows directly from
its architecture, its semantic application model can be understood without
executing vendors or platform runtimes, every replaceable or effectful boundary
is governed by an owned contract, and every maintained file and test has one
demonstrable purpose.

The target is not the smallest possible file count. It is the smallest set of
concepts and files that makes ownership, dependency direction, behavior, and
verification obvious.

This document is both the design contract and the workbench. Decisions,
exceptions, measurements, and checklist status must be updated here as the work
proceeds. Completed historical plans do not remain as parallel sources of truth.

## Definition of done

We may answer "yes" to "is the kit in its cleanest, nicest, well-organized form
with no known redundancies?" only when all of the following are true:

- [x] Every production file has one named architectural owner and one concise
      responsibility.
- [x] The dependency graph follows a documented acyclic direction enforced in
      CI.
- [x] The semantic core has no runtime dependency on Bun, Node, DOM, Anime.js,
      StyleX, XState, storage engines, transports, or other vendors.
- [x] Application and Feature topology and Resource wire meaning can be
      extracted through the TypeScript compiler API without evaluating vendor
      implementations; hosted behavior is classified explicitly.
- [x] The extracted manifest is canonical, deterministic, dependency-free data
      with an explicit current scope and fidelity tests.
- [x] Every effectful, platform-specific, or replaceable implementation is
      reached through a consumer-owned semantic contract.
- [x] Vendor imports exist only in the implementation owner recorded for that
      vendor.
- [x] Public exports contain only intentional product-facing APIs and compiler
      contracts.
- [x] There are no compatibility facades, duplicate representations, unused
      exports, stale files, empty directories, or generated source committed to
      Git.
- [x] Tests form a documented verification matrix with no materially duplicate
      scenarios.
- [x] OxLint, OxFmt, TypeScript, architecture checks, package build, package
      packing, maintained applications, and all test tiers pass.
- [x] Two final audits, performed after the last structural change, find no
      unexplained dependency, file, export, test, or exception.

"No known redundancies" is an evidence-based statement, not a proof that no
future simplification can ever be discovered.

## Guiding principles

### 1. Meaning precedes machinery

Product-facing declarations describe Application, Feature, Resource, Program,
Dependency, Component, and Preset meaning. They do not name storage engines,
transport libraries, animation libraries, compilers, or deployment processes.

The generic application contract is the source of type correctness. Public
helpers must perform real runtime or compilation work; they must not exist only
to coax inference that an explicit generic parameter or `satisfies` can provide.

### 2. Contracts are owned by their consumers

A port is a vendor-free semantic contract required by the code that consumes
it. A dependency is one named use of a port by a Feature. An adapter is one
implementation of a port.

Ports are required for effects, vendors, platform boundaries, and genuinely
replaceable implementations. Pure deterministic code does not receive an
interface merely for symmetry. The browser platform adapter may use browser
APIs directly; it must not invent a second abstraction for every DOM method.

Contracts state semantics, lifecycle, errors, cancellation, ordering,
durability, and concurrency guarantees where relevant. An adapter is accepted
only by running the contract's law suite against it.

### 3. Semantic code is extractable

Semantic declarations must be analyzable without loading application runtime
dependencies. The compiler may use TypeScript's AST and type checker, but it
must not execute application, vendor, adapter, or host code to discover the
application model.

Every semantic concept is classified as one of:

1. **Portable declaration:** canonical names, topology, schemas, policies,
   statecharts, dependencies, and other serializable meaning.
2. **Portable contract:** behavior specified independently of its language or
   platform implementation.
3. **Host behavior:** authored executable behavior behind a portable contract.
4. **Platform or vendor implementation:** code owned by one concrete runtime.

This classification is the portability test. A future Rust host should be able
to consume the canonical manifest and implement the same contracts. Arbitrary
TypeScript function bodies are not automatically portable and must never be
described as such.

### 4. Dependencies move in one direction

The semantic center imports no outward runtime. Composition depends on semantic
contracts. Runtimes depend on composition and contracts. Implementations depend
on their contracts. Hosts assemble implementations. Tooling observes or
compiles these layers but does not become a product dependency.

Tests may import public testing support; production owners may not import test
support. Cycles, including cycles hidden behind barrels, are forbidden.

The final owner graph will be recorded after the semantic extraction spike and
then enforced. Folder names alone are not evidence of correct layering.

### 5. One concept has one owner and one representation

A concept's types, pure behavior, contract laws, and default implementation
remain together unless they have different dependency directions or runtime
targets. There is one canonical representation for application meaning, visual
IR, protocol data, state, and migration data. Derived forms are generated or
translated, never maintained in parallel.

Folders describe architectural concepts, not status or file kinds. Avoid
`internal`, `common`, `shared`, `utils`, `misc`, generic `manager`, and generic
`adapters` directories. Technology names appear only in implementation
filenames, such as `<contract>.<technology>.ts`.

### 6. Files expose real responsibilities

A file exists because its responsibility can be named in one short sentence.
Its filename names that responsibility. A directory exists because it owns a
coherent namespace, not merely because another file was long.

Large files trigger a responsibility review, not an automatic split. Split a
file only when the resulting pieces have an independent invariant, dependency
direction, lifecycle, compilation phase, or test vocabulary. Do not split by
arbitrary line ranges or type/function categories.

`index.ts` is reserved for a genuine public boundary and contains exports only.
Tests live beside their owner. Filenames use kebab-case. Contract
implementations use `<contract>.<implementation>.ts`; tests use `*.spec.ts(x)`;
compile-time contracts use `*.typecheck.ts(x)`.

### 7. Names communicate semantics

Types and contracts are nouns. Functions are verbs. Use `define` for declarative
product descriptions, `create` for constructing a new owned value or runtime,
`start` for lifecycle activation, `mount` for attaching to a platform owner,
`read` for observation, and `write` or a domain verb for mutation.

Avoid aliases that rename the same concept across layers. Avoid implementation
terms in product-facing names. Abbreviations require an established domain
meaning.

### 8. Public surface is smaller than source surface

Package exports are curated product capabilities or required compiler/runtime
entrypoints. Physical source structure does not automatically become public.
Applications do not import kit-private aliases. Kit source uses architectural
`#...` imports so dependency ownership is visible at each call site.

No public API is preserved through a compatibility shim during this cleanup.
Maintained applications and fixtures are migrated atomically when an accepted
contract changes.

### 9. Tests protect contracts, not files

Each test must identify the invariant, contract law, failure mode, or boundary
it protects. File existence and implementation details are tested only at real
package or compiler boundaries.

Use the least expensive test that proves the behavior:

- Type contracts for inference and rejected programs.
- Unit tests for pure algorithms and deterministic translations.
- Contract law suites for every port and all its implementations.
- Property tests for state spaces, traces, serialization, ordering, and
  concurrency invariants.
- Integration tests for real storage, transport, process, compiler, and browser
  boundaries.
- One packed-consumer test for the published package contract.
- Browser review only for behavior that requires an actual rendering engine or
  human visual judgment.

A test is redundant when a stronger test covers the same invariant, failure
mode, and boundary with equal or better diagnostics. Coverage percentage and
test count are not quality goals. Deleting a redundant test requires recording
which surviving test owns its invariant.

### 10. Conventions are executable

Stable conventions must be enforced by TypeScript, OxLint, OxFmt, package
exports, or a deterministic architecture check. Prose-only rules are temporary.
Critical architecture enforcement must not depend solely on OxLint's currently
alpha JavaScript plugin API.

Use one root OxLint and OxFmt configuration by default. A nested configuration
is allowed only for a genuinely different runtime and must explicitly extend
the root, because nested OxLint configs do not merge with parent configuration
automatically.

### 11. Optimize for removal

Before adding a concept, ask whether an existing primitive can express it. When
two representations or workflows overlap, choose one and delete the other.
Do not retain speculative factories, adapters, ports, exports, or documentation.

### 12. Claims require evidence

Every cleanup pass records its inventory, hypothesis, change, and verification.
Passing tests proves preserved behavior; it does not by itself prove clean
architecture. Final confidence requires graph analysis, semantic extraction,
export review, vendor ownership review, test rationalization, and fresh package
consumption.

## Current baseline

Measured 2026-07-14:

- The top-level package owners are `kernel`, `substrate`, `ui`, `host`,
  `testing`, and `tooling`.
- Production source is 30,579 lines across 45 files, including the package
  build script; all source including tests and type contracts is 49,225 lines
  across 77 files.
- The largest production files are `ui/compiler/stylex.ts` (3,236 lines),
  `ui/compiler/application.ts` (2,604), `ui/web/runtime.ts` (2,442),
  `kernel/app.ts` (2,212), `host/server.ts` (2,070), and
  `tooling/application.ts` (1,667).
- The initial type-inclusive graph contained one eight-module strongly
  connected component. Canonical type ownership and direct imports removed it;
  the complete 44-module source graph is now acyclic, including type-only
  imports.
- `kernel/app.ts` retains one type-only dependency on the web JSX contract. It
  is not a runtime dependency: Components are deliberately platform-specific,
  while `kernel/manifest.ts` is the portable, dependency-free application
  description. The final owner review accepted this as a platform declaration
  edge rather than a portable-core violation.
- A strict OxLint probe reports zero explicit `any` occurrences across
  production, test support, and generated applications. The rule is mandatory
  without a test exclusion.
- OxLint now enforces type-inclusive cycles, owner direction, duplicate imports,
  type-only imports, kebab-case filenames, unused suppressions, and zero
  warnings, including explicit `any`.
- Static kit source imports use architectural aliases. Remaining relative
  import strings are generated migration or fixture source.
- Root lint and all maintained application typechecks pass after the first
  ownership repair. The full test/build/packed-consumer gate must be rerun after
  the final structural edit.

This baseline is evidence for prioritization, not a mandate to split every large
file or mechanically replace every `any`.

### Production responsibility ledger

This ledger is the Phase 1 source of truth. `Accepted` means the file has one
architectural responsibility. `Repair` means the file currently crosses an
ownership boundary or combines independently changing responsibilities.

| Owner       | File                             | Responsibility                                                         | Status                                                                                                         |
| ----------- | -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| package     | `scripts/build.ts`               | Emit package JavaScript and declaration boundaries                     | Accepted: a single package build entrypoint                                                                    |
| package     | `src/index.ts`                   | Public application-author entry point                                  | Accepted                                                                                                       |
| host        | `host/browser.ts`                | Browser connection and IndexedDB composition                           | Accepted                                                                                                       |
| host        | `host/server.ts`                 | Bun server, static host, sync host, and server environment composition | Accepted: one deployable Bun host boundary                                                                     |
| host        | `host/sync.websocket.ts`         | WebSocket implementation of the synchronization transport              | Accepted                                                                                                       |
| kernel      | `kernel/app.ts`                  | Generic Application algebra and its pure normalization and execution   | Accepted: these operations share the generic contract and migration invariant                                  |
| kernel      | `kernel/dependency.ts`           | Semantic dependency lifecycle and replacement                          | Accepted                                                                                                       |
| kernel      | `kernel/feature.ts`              | Feature composition, namespacing, and API instantiation                | Accepted                                                                                                       |
| kernel      | `kernel/manifest.ts`             | Canonical dependency-free application manifest                         | Accepted: current Resource-schema and topology scope is explicit; a complete cross-language ABI is future work |
| substrate   | `substrate/client.ts`            | Authoritative synchronization client                                   | Accepted                                                                                                       |
| substrate   | `substrate/durability.ts`        | Durability-profile parsing and validation                              | Accepted                                                                                                       |
| substrate   | `substrate/journal.ts`           | Journal contract and in-memory reference implementation                | Accepted                                                                                                       |
| substrate   | `substrate/journal.sqlite.ts`    | SQLite Journal implementation                                          | Accepted                                                                                                       |
| substrate   | `substrate/program.ts`           | Durable Program execution and progress                                 | Accepted                                                                                                       |
| substrate   | `substrate/protocol.ts`          | Versioned wire messages and validation                                 | Accepted                                                                                                       |
| substrate   | `substrate/replica.ts`           | Device Replica contract and in-memory reference implementation         | Accepted                                                                                                       |
| substrate   | `substrate/replica.indexeddb.ts` | IndexedDB Replica implementation                                       | Accepted                                                                                                       |
| substrate   | `substrate/resource.ts`          | Resource authorization and command execution                           | Accepted                                                                                                       |
| substrate   | `substrate/sync.ts`              | Pure synchronization planning and transport contract                   | Accepted: contains no WebSocket implementation                                                                 |
| testing     | `testing/fake-websocket.ts`      | Deterministic WebSocket test transport                                 | Accepted                                                                                                       |
| testing     | `testing/application.ts`         | Public Application and Feature test host                               | Accepted                                                                                                       |
| testing     | `testing/replica.ts`             | Replica test constructors                                              | Accepted                                                                                                       |
| testing     | `testing/test-app.ts`            | Shared substrate contract fixture                                      | Accepted                                                                                                       |
| testing     | `testing/wait.ts`                | Deterministic asynchronous polling fixture                             | Accepted                                                                                                       |
| tooling     | `tooling/application.ts`         | Application workspace compilation and generated runtime pipeline       | Accepted: migrations consume the same compiled surface and generated-entry invariant                           |
| tooling     | `tooling/cli.ts`                 | CLI parsing and command dispatch                                       | Accepted                                                                                                       |
| tooling     | `tooling/create.ts`              | Application scaffold generation                                        | Accepted                                                                                                       |
| UI          | `ui/index.ts`                    | Public UI-author entry point                                           | Accepted                                                                                                       |
| UI          | `ui/machine.xstate.ts`           | XState implementation of the Component machine contract                | Accepted                                                                                                       |
| UI          | `ui/preset.ts`                   | Public Preset-author contract                                          | Accepted                                                                                                       |
| UI compiler | `ui/compiler/application.ts`     | Application/component source analysis and compilation                  | Accepted: its passes share one source model, diagnostics, and generated module contract                        |
| UI compiler | `ui/compiler/preset.ts`          | Preset contract and source analysis                                    | Accepted                                                                                                       |
| UI compiler | `ui/compiler/stylex.ts`          | Visual IR validation, normalization, and StyleX lowering               | Accepted: one deterministic translation pipeline with one output invariant                                     |
| web UI      | `ui/web/component.ts`            | Component instance and state-machine runtime                           | Accepted                                                                                                       |
| web UI      | `ui/web/drag.ts`                 | Vendor-free drag contract and lifecycle                                | Accepted                                                                                                       |
| web UI      | `ui/web/drag.anime.ts`           | Anime.js implementation of the drag contract                           | Accepted                                                                                                       |
| web UI      | `ui/web/interaction.ts`          | Semantic web interaction primitives                                    | Accepted                                                                                                       |
| web UI      | `ui/web/jsx-dev-runtime.ts`      | Development JSX compiler contract                                      | Accepted                                                                                                       |
| web UI      | `ui/web/jsx-runtime.ts`          | Production JSX compiler contract                                       | Accepted                                                                                                       |
| web UI      | `ui/web/jsx-types.ts`            | Native JSX and DOM attribute contract                                  | Accepted                                                                                                       |
| web UI      | `ui/web/motion.ts`               | Motion planning and execution backends                                 | Accepted                                                                                                       |
| web UI      | `ui/web/runtime.ts`              | Fine-grained web application renderer and navigation owner             | Accepted: navigation and resource bindings share mounted application lifecycle                                 |
| web UI      | `ui/web/scene.ts`                | Presence and retained-element scene lifecycle                          | Accepted                                                                                                       |
| web UI      | `ui/web/visual-runtime.ts`       | Reactive visual targets and motion coordination                        | Accepted: coordinates targets; `motion.ts` owns backend execution                                              |
| web UI      | `ui/web/visual.ts`               | Visual contract, recipes, and Preset construction                      | Accepted                                                                                                       |

### Dependency ownership ledger

| Dependency                 | Owner and reason                                            | Classification                                         |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `alien-signals`            | Web UI fine-grained reactive runtime                        | Runtime implementation                                 |
| `animejs`                  | Web UI motion and drag backends                             | Runtime implementation                                 |
| `xstate`                   | Component machine backend                                   | Runtime implementation                                 |
| `@stylexjs/stylex`         | Web visual runtime                                          | Runtime implementation                                 |
| `@stylexjs/unplugin`       | Application build translation                               | Tooling implementation                                 |
| `unplugin`                 | Required peer of the owned StyleX build adapter             | Tooling implementation                                 |
| `@tanstack/virtual-core`   | Web virtual collection runtime                              | Runtime implementation                                 |
| `@typescript/typescript6`  | JavaScript compiler API used by kit tooling                 | Tooling implementation                                 |
| `typescript`               | Distributed TypeScript 7 CLI and declaration build          | Tooling/distribution contract                          |
| `@types/bun`               | Distributed Bun platform types referenced by the app config | Distribution contract                                  |
| `@babel/preset-typescript` | Required runtime peer of the StyleX compiler pipeline       | Tooling implementation; packed-consumer proof required |
| `fast-check`               | Contract/property tests                                     | Test-only                                              |
| `fake-indexeddb`           | IndexedDB contract tests                                    | Test-only                                              |

### Measured owner graph

After the first boundary repair, the complete production module graph is
acyclic across 44 modules even when type-only imports are included. The coarse
owner graph is:

```text
host -> kernel, substrate, UI
substrate -> kernel
UI -> kernel, substrate
kernel -> UI
testing -> kernel, substrate
tooling -> host, kernel, substrate, UI
```

The host/tooling, browser-default, and transport implementation ownership
defects are repaired. The apparent `kernel <-> UI` owner cycle is not a module
cycle:
`kernel/app.ts` uses the web JSX type contract for platform Component hierarchy,
while UI runtime modules consume kernel semantics. The final review must either
model the platform declaration contract as an inward contract boundary or move
the platform-bound Component type surface without duplicating it. The accepted
runtime direction is:

```text
kernel <- substrate <- UI <- host
   ^          ^        ^
   |          |        |
   +----------+--------+-- tooling and testing
```

## Target dependency model

The exact physical names are decided by the extraction work, but the logical
direction is fixed:

```text
portable semantic declarations and contracts
                    |
                    v
        composition and pure translators
             /                 \
            v                   v
   substrate runtime       platform UI runtime
            \                   /
             v                 v
        concrete implementations
                    |
                    v
             environment hosts

tooling -> observes/compiles all layers
testing -> contract hosts and fixtures only
```

No lower layer imports a host, tooling, testing, concrete adapter, or outward
platform implementation.

## Verification matrix

The implementation must maintain a table mapping every important invariant to
one primary test owner. At minimum it covers:

| Area            | Required evidence                                                      |
| --------------- | ---------------------------------------------------------------------- |
| Semantic model  | AST/type extraction fixture and canonical manifest                     |
| Generic API     | Positive and negative type contracts                                   |
| Owner graph     | Forbidden-edge check and `import/no-cycle`                             |
| Port            | Shared law suite                                                       |
| Adapter         | Port laws plus real boundary failures                                  |
| Translation     | Input-to-IR golden values plus property invariants                     |
| Runtime         | Deterministic state/lifecycle tests                                    |
| Persistence     | Recovery, atomicity, corruption, and restart laws                      |
| Synchronization | Ordering, reconnection, authority, and convergence laws                |
| UI              | Fine-grained updates, lifecycle, accessibility, and motion translation |
| Tooling         | Compiler and generated-project behavior                                |
| Distribution    | One packed isolated consumer                                           |

Every existing test will be assigned to this matrix, merged with a stronger
owner, or deleted.

## Enforcement plan

### OxLint

- [x] Enable the `import` plugin and `import/no-cycle`.
- [x] Encode owner-specific forbidden edges with `no-restricted-imports`
      overrides after the final graph is accepted.
- [x] Enable `typescript/consistent-type-imports` after fixing the baseline.
- [x] Eliminate or narrowly justify explicit `any`, then enable
      `typescript/no-explicit-any` without broad test exclusions.
- [x] Enable `no-duplicate-imports`.
- [x] Enforce kebab-case with `unicorn/filename-case`.
- [x] Report unused disable directives and fail on warnings.
- [x] Evaluate type-aware rules by signal, stability, and runtime cost; do not
      use experimental type checking as a replacement for TypeScript.
- [x] Use `no-barrel-file` only where it can exempt the intentional package and
      compiler boundaries.
- [x] Keep critical architecture checks in stable native rules or a small
      deterministic graph verifier, not an alpha plugin.

Type-aware OxLint rules were not enabled: TypeScript already owns semantic type
checking, while the additional experimental pass did not add a distinct
architectural invariant. `no-barrel-file` was also rejected because the two
remaining `index.ts` files are deliberate package boundaries. Stable import
rules enforce owner direction directly; no custom graph script is needed while
that native rule set expresses the complete accepted graph.

### OxFmt

- [x] Keep one root formatter configuration.
- [x] Enable deterministic import sorting after auditing side-effect imports.
- [x] Retain deterministic `package.json` sorting.
- [x] Distribute the same minimal convention through generated applications.
- [x] Keep formatter output free of architecture policy; formatting and
      dependency ownership remain separate concerns.

The enforcement choices above follow the official OxLint configuration,
nested-config, import-rule, and OxFmt sorting behavior documented at:

- <https://oxc.rs/docs/guide/usage/linter/config.html>
- <https://oxc.rs/docs/guide/usage/linter/nested-config>
- <https://oxc.rs/docs/guide/usage/linter/rules/import/no-cycle>
- <https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports>
- <https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-explicit-any>
- <https://oxc.rs/docs/guide/usage/linter/rules/typescript/consistent-type-imports.html>
- <https://oxc.rs/docs/guide/usage/formatter/config.html>
- <https://oxc.rs/docs/guide/usage/formatter/sorting>

## Execution plan

### Phase 1: establish architectural truth

- [x] Inventory every production file with responsibility, owner, imports,
      exports, vendor dependencies, side effects, and tests.
- [x] Generate the complete source dependency graph and owner-level graph.
- [x] Classify every package dependency by semantic owner and allowed import
      locations.
- [x] Identify duplicate concepts, representations, translation stages,
      lifecycle owners, and public aliases.
- [x] Decompose each oversized file into a responsibility map without editing
      it yet.
- [x] Record unexplained files and dependencies as defects, not assumptions.

Gate 1:

- [x] Every file and dependency is explained.
- [x] The proposed owner DAG contains no cycle or status-based category.
- [x] Every proposed split or merge cites an independent responsibility or a
      proven redundancy.

### Phase 2: prove semantic extractability

- [x] Define a canonical, dependency-free application manifest schema.
- [x] Classify current Application and Feature fields into portable
      declarations, portable contracts, host behavior, and implementations.
- [x] Build one compiler-API fixture that extracts Resource wire schemas plus
      Program, dependency, environment, Component, Preset, endpoint, API, and
      Feature topology without evaluating application modules. Migrations and
      Program bodies are classified as hosted behavior.
- [x] Verify canonical ordering and stable output across formatting and object
      declaration order.
- [x] Prove that vendor modules are never evaluated during semantic analysis;
      compiler declaration packages may still be resolved by TypeScript.
- [x] Document which executable TypeScript behaviors require a foreign host to
      implement a contract rather than consume serialized code.

Gate 2:

- [x] The manifest preserves all agreed serializable product meaning.
- [x] The fixture is deterministic and vendor execution is absent.
- [x] The current manifest scope and the additional contracts a hypothetical
      Rust host would need are explicit; no claim treats arbitrary TypeScript
      behavior as portable.

### Phase 3: purify contracts and dependency direction

- [x] Resolve forbidden kernel edges; retain only the reviewed type-only web JSX
      declaration edge for the platform-specific Component hierarchy.
- [x] Separate semantic contracts from concrete runtimes where the current file
      couples them.
- [x] Move direct vendor imports to their accepted implementation owner.
- [x] Give every port a semantic lifecycle and error contract.
- [x] Add or consolidate law suites and run them against every implementation.
- [x] Remove pass-through interfaces that do not represent replaceability or
      semantics.
- [x] Encode the accepted owner graph in lint or deterministic graph checks.

Gate 3:

- [x] Semantic modules import no vendor or platform runtime.
- [x] All architecture edges are allowed and acyclic.
- [x] Each adapter passes its consumer-owned contract suite.
- [x] There is exactly one canonical representation per concept.

### Phase 4: align files with responsibilities

- [x] Rename vague files such as tooling `app.ts` after identifying their real
      responsibilities.
- [x] Make every `index.ts` export-only or replace it with a responsibility
      name.
- [x] Split oversized files only along the responsibility map from Phase 1.
- [x] Merge files whose distinctions have no independent invariant or
      dependency direction.
- [x] Co-locate contract, normal implementation, and focused tests under the
      semantic owner.
- [x] Remove empty directories, shallow aliases, stale exports, dead code,
      compatibility paths, and generated residue.
- [x] Re-run a whole-tree naming and ownership review after each batch.

Gate 4:

- [x] Every file can be described in one sentence without "and" joining
      unrelated responsibilities.
- [x] No directory is named by visibility, miscellany, or a vendor collection.
- [x] File count is justified by concepts rather than arbitrary splitting.

### Phase 5: rationalize the public package

- [x] Map every export to a documented application author, preset author,
      testing, compiler, or host use case.
- [x] Remove public aliases and implementation exports.
- [x] Confirm declaration output exposes semantic contracts without importing
      implementation source into consumers.
- [x] Confirm package-private aliases work in source, built JavaScript, emitted
      declarations, and packed consumers.
- [x] Keep generated applications on the same single project convention.

Gate 5:

- [x] Every public export has one user and no equivalent alternative.
- [x] A packed application installs, typechecks, builds, runs, and tests without
      repository-relative files or generated declarations in Git.

### Phase 6: rationalize testing

- [x] Build the verification matrix and assign every existing test.
- [x] Merge repeated setup into semantic test hosts only where several contract
      tests genuinely share it.
- [x] Replace duplicated examples with a contract law or property invariant
      when it improves coverage and diagnostics.
- [x] Delete tests dominated by a stronger surviving test and record the owner
      of the retained invariant.
- [x] Separate fast deterministic tests from real-boundary integration tests
      without creating parallel test organizations.
- [x] Remove explicit `any` from test infrastructure or document the narrow
      unsafe boundary before enabling its lint rule.
- [x] Measure test duration and eliminate avoidable process/build repetition.

Gate 6:

- [x] Every test maps to one distinct row and invariant.
- [x] All port implementations run the same law suite.
- [x] No test exists only to inspect a private filename or implementation
      detail.
- [x] Fast tests provide useful local feedback; the full suite remains the
      release authority.

### Phase 7: ratchet conventions

- [x] Apply the accepted OxLint rules incrementally, fixing the baseline before
      making each rule mandatory.
- [x] Enable OxFmt import sorting after side-effect review.
- [x] Keep architecture, export, generated-file, and empty-directory checks in
      native lint, package boundaries, and final audits without duplicate wrapper scripts.
- [x] Verify generated applications receive the intended conventions.
- [x] Remove temporary allowlists and audit tooling introduced during cleanup.

Gate 7:

- [x] A new forbidden dependency, filename, explicit `any`, stale disable, or
      import cycle fails locally and in CI with an actionable diagnostic.
- [x] `bun run check` remains the single complete developer gate.

### Phase 8: final adversarial review

- [x] Rebuild the inventory and dependency graph from scratch.
- [x] Challenge every directory, file, export, dependency, port, adapter,
      helper, test, and configuration entry with "what breaks if removed?"
- [x] Run a second review organized by runtime flow rather than source tree.
- [x] Run a third review from the application author's public imports and
      generated application.
- [x] Resolve every unexplained item or record a narrow architectural reason.
- [x] Update `docs/architecture.md` to the final accepted structure and retain
      this completed plan as the execution evidence requested by the user.

Final gate:

- [x] `bun install --frozen-lockfile` succeeds from a clean dependency state.
- [x] `bun run check` succeeds.
- [x] `bun run build` succeeds.
- [x] Packed-consumer verification succeeds.
- [x] Maintained applications typecheck, build, test where applicable, and run.
- [x] No untracked generated files or empty source directories remain.
- [x] Two consecutive post-change audits report no unexplained or redundant
      item.

## Final audit record

The final structural change removed the internal drag driver, mount handle,
bounds, options, and raw sample types from the public UI entry point. The
component-facing `DragRelease` contract remains public. An internal test that
had used the public entry point as an accidental barrel was moved to the owned
`drag.ts` contract import.

Audit one rebuilt the source-tree inventory after that change. It found 45
production files with 45 ledger entries, 44 production source modules, no
module cycle, no forbidden owner edge, no empty authored directory, no stale
organizational path, no explicit `any`, no compatibility facade, and no
authored relative kit import. The only relative-looking imports are templates
for generated migration source. Package packing contains 98 files (1.30 MB
unpacked), with no specs, typecheck fixtures, generated applications, or
repository-relative files.

Audit two followed runtime flow and application consumption. It traced authored
source through compiler extraction, canonical manifest and visual translation,
environment host composition, substrate contracts, and named implementations.
Every vendor import remains in the dependency owner ledger. The three
maintained applications and generated scaffold use one inherited TypeScript
configuration, public package entry points, `src/*`, and the same minimal source
shape; no application contains declaration scaffolding. Site and visual-lab
served successfully from compiled executables on isolated ports, while chat's
package test exercised its standalone executable.

The test audit retained 28 runtime spec files and four compile-time contract
files. Their distinct primary boundaries are generic authoring, Feature
composition, dependency lifecycle, manifest extraction, compiler/tooling,
package distribution, migrations, Journal laws and portability, Replica laws
and IndexedDB failures, Resource authority, Program fault recovery, protocol,
sync planning and real WebSocket behavior, client recovery, server host
behavior, statecharts, fine-grained rendering, interaction/drag, motion, visual
translation, JSX, and public testing support. No pair covers the same invariant,
failure mode, and boundary.

Final evidence:

- Frozen install: 107 installs across 176 packages, no lockfile change.
- Full gate: 445 kit tests across 28 files, 322,656 assertions, zero failures in
  29.80 seconds; chat's three application tests also pass.
- TypeScript, OxLint with zero warnings and explicit-`any` prohibition, OxFmt,
  all four workspace builds, packed isolated consumption, generated app
  install/typecheck/test/build, and executable smoke tests pass.
- The manifest's present portability scope remains explicit: complete Resource
  wire schemas and application topology, not dependency method ABIs or
  executable TypeScript behavior.

## Continuous execution loop

For each structural batch:

1. Re-read this document and the newest user request.
2. Update the inventory and state the concrete defect.
3. Form the smallest architectural hypothesis that removes the defect.
4. Change one ownership boundary at a time.
5. Run the closest type, contract, and behavior tests.
6. Run architecture and formatting checks.
7. Run the full monorepo gate and packed-consumer boundary when exports or
   declarations changed.
8. Update this checklist, measurements, decisions, and any rejected alternative.
9. Repeat until the final gate is satisfied.

Do not mark the goal complete because the tree looks tidy, tests pass, or time
has elapsed. Complete it only when every definition-of-done item and final gate
has evidence.
