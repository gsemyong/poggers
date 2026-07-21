# Native Production Realization

## Goal

One application definition must produce complete production artifacts for every declared Program.
The authenticated CRUD example is the acceptance application: its browser Program becomes a web
artifact and its multi-Feature `api` Program becomes one standalone native executable with no
JavaScript runtime or source fallback.

Development and production consume the same canonical application meaning:

```text
TypeScript application
        |
        v
canonical Application IR
        |
        +-- Program assembly and Capability graph
        |
        +-- web Platform Adapter --------> browser artifacts
        |
        `-- server Platform Adapter ------> native server workspace/executable
```

Feature boundaries organize source. Program boundaries organize deployment. A native Program is
therefore assembled from every same-named Feature contribution before code generation. Required
Capabilities are resolved exactly once: another contribution may provide them, otherwise the
selected Platform Adapter must implement them. Production never executes application JavaScript.

## Invariants

- The TypeScript application and its inferred types are the only product definition.
- The compiler frontend emits one versioned, deterministic, dependency-free IR.
- JavaScript development and native production use the same Program and Capability semantics.
- A Program is the unit of deployment, startup, ownership, failure, and disposal.
- A Feature contribution is not an independently deployed executable.
- Every required Capability has exactly one compatible provider.
- Feature-provided Capabilities are wired statically within the assembled Program.
- Remaining external Capabilities are implemented exactly once by the Platform Adapter.
- Portable code crosses Capability boundaries only through typed, portable values and operations.
- Platform-native values and UI source never silently enter native portable code.
- Unsupported source fails before Cargo with an actionable source span.
- Generated source and workspace topology are deterministic for equal semantic IR.
- Cache identity excludes irrelevant source location and formatting changes.
- Tests exercise the public application and adapter APIs, not compiler-only backdoors.

## Target Contracts

The canonical IR must carry enough information to realize a whole Program:

- ordered Feature contributions;
- typed `Requires` and `Provides` contracts;
- portable entry functions and their reachable pure-function graph;
- explicit calls to external or Feature-provided Capabilities;
- deterministic source identities for diagnostics;
- the Program environment and selected Platform;
- no executable JavaScript closures.

The server Platform Adapter owns both realizations:

- development: load application source through Vite and start it with the Node host;
- production: validate portability, bind native host Capabilities, emit a Rust workspace, and build
  one executable per server Program.

The native adapter contract is semantic. It binds Capability operations to typed native
implementations; it does not accept arbitrary Rust snippets from application code. Static dispatch
is preferred so the Rust optimizer can inline through known bindings.

## Generated Workspace

The generated workspace uses stable semantic boundaries rather than one disposable `main.rs`:

```text
generated/
  Cargo.toml
  runtime/                 # adapter-owned, versioned runtime support
  features/<address>/      # one crate per portable Feature contribution
  programs/<name>/         # thin assembly and executable entry
```

Capability implementations and portable value handling live in the stable runtime crate. The
Feature crates contain only lowered domain behavior, while the Program crate contains static
assembly. This measured split keeps an unrelated Feature or adapter runtime out of a one-Feature
rebuild.

## Execution Plan

### 1. Freeze Current Evidence

- [x] Confirm the standalone portable Program Rust gate passes.
- [x] Confirm authenticated CRUD native build fails explicitly at the known v0 boundary.
- [x] Record the current Program IR and its two `api` contributions.
- [x] Add a focused regression fixture for a multi-contribution Program with an internal provider.

Gate: tests describe the current gap without relying on authenticated CRUD internals.

### 2. Canonical Program Linking

- [x] Add a canonical linked-Program representation derived from `ProgramIR`.
- [x] Validate duplicate providers, external bindings, incompatible Capability types, cycles,
      and deterministic dependency order before backend work.
- [x] Preserve contribution identity while assigning collision-free native function names.
- [x] Make JavaScript development consume the same linker result.

Gate: table and property tests cover ordering invariance, provider resolution, cycles, duplicate
providers, missing providers, type mismatch, and deterministic serialization.

### 3. Portable Frontend Completion

- [x] Represent asynchronous control flow, callbacks, streams, errors, and resource lifetime only
      where required by the authenticated CRUD server path.
- [x] Expand reusable Feature factories into portable contribution meaning without executing them.
- [x] Keep `Request`, `Response`, database handles, authentication engines, sockets, clocks, and
      random generators behind Capability contracts.
- [x] Refactor identity and entity server logic toward portable procedural code and semantic
      Capability calls where the present contracts expose host-native objects.
- [x] Reject unsupported JavaScript constructs and leaked host-native values with exact spans.

Gate: every non-UI `api` contribution in authenticated CRUD is `portable`; deliberate host leakage
and unsupported syntax fail before native generation.

### 4. Native Platform Adapter Contract

- [x] Replace compiler-private Rust expression injection with a typed server production adapter.
- [x] Define native implementations for authentication, HTTP, durable events, identifiers, and
      clock behind their existing semantic Capability contracts.
- [x] Resolve Feature-provided `identity` and `tasks` Capabilities inside the Program rather than
      requesting them from the host.
- [x] Define startup, asynchronous work, streaming responses, cancellation, and reverse-order
      disposal once at the Program boundary.
- [x] Keep Better Auth as the Node development implementation of `authentication`; native
      production must provide contract-compatible behavior without embedding JavaScript.

Gate: compile-time contract tests reject missing, excess, or wrongly typed native operations;
runtime tests prove one host instance and one disposal path per Process instance.

### 5. Whole-Program Rust Generation

- [x] Preserve typed portable contracts in IR, deduplicate reachable helper functions, and statically
      assemble linked contributions.
- [x] Generate deterministic crate/module names from semantic hashes.
- [x] Emit one thin executable per server Program and retain source spans outside
      semantic cache identity.
- [x] Integrate native production into `createServerPlatformAdapter().build`; remove the special
      compiler-only CLI path.
- [x] Make the normal production command emit all required platform artifacts.

Gate: `poggers build` emits the browser bundle and native `api` executable from authenticated CRUD;
the executable contains no Node/Bun/JavaScript runtime dependency.

### 6. Cache-Friendly Compilation

- [x] Cache generated source, native dependency graphs, and final artifacts by semantic keys.
- [x] Use a stable Cargo workspace/target location instead of a new package graph per build.
- [x] Preserve unchanged Feature and adapter crates across one-Feature edits.
- [x] Support local Cargo reuse and an optional `RUSTC_WRAPPER` such as `sccache` without coupling
      correctness to either cache.
- [x] Expose optional Cargo timings plus cache, duration, and rebuilt-crate diagnostics.

Gate: measure clean, no-op, formatting-only, one-function, one-Feature, adapter-change, and final-link
builds. A no-op build performs no Rust compilation; a one-Feature edit does not rebuild unrelated
Feature or adapter crates.

### 7. Differential and End-to-End Verification

- [x] Run generated functions against the JavaScript reference and Rust backends with fixed and
      property-generated scenarios.
- [x] Reuse the authenticated CRUD black-box HTTP test against both Node development and the emitted
      native executable.
- [x] Cover sign-up, sign-in, sign-out, authorization isolation, create/update/remove, idempotent
      commands, live subscriptions, durable restart, malformed credentials, and graceful shutdown.
- [x] Build an installed package tarball from a clean temporary application to detect ambient
      workspace dependencies.
- [x] Verify browser production assets communicate with the native server artifact.

Gate: both backends satisfy one behavioral suite, the complete built application passes browser
acceptance, and restart preserves committed data.

### 8. Cleanup and Documentation

- [x] Remove superseded compiler-only native APIs, tests, and documentation.
- [x] Keep tests at contract boundaries: frontend, linker, adapter conformance, differential runtime,
      production artifacts, and one end-to-end application.
- [x] Document the exact build/run commands, artifact layout, portability subset, diagnostics, and
      cache behavior.
- [x] Run typecheck, lint, formatting, unit/property/integration tests, production builds, and live
      browser acceptance.

Gate: the repository has one production realization path, no compatibility fallback, no redundant
native fixture architecture, and all checks pass.

## Completion Criteria

This plan is complete only when all of the following are true:

1. `authenticated-crud` builds through the normal production command.
2. Its browser output is served successfully and its `api` output is a standalone native binary.
3. The same black-box auth/CRUD/realtime/restart suite passes against development and production.
4. Every server Feature contribution is portable or rejected with a source diagnostic; no source
   execution occurs in native production.
5. Inter-Feature and external Capability wiring is exact, typed, deterministic, and tested.
6. Incremental-build evidence demonstrates semantic cache reuse at meaningful boundaries.
7. Full repository checks and clean-copy production acceptance pass.

## Recorded Evidence

- The canonical linker is invariant under contribution permutations and rejects duplicate
  providers, incompatible contracts, and cycles. Function parameter names are documentation, not
  structural contract identity.
- Standard mapped types such as `Readonly<T>` lower to their semantic fields. Native handles such
  as `Request` and `Response` remain explicit opaque boundaries.
- The server native adapter validates every external Capability's operation envelope before Cargo.
  Unknown or incompatible host contracts fail at the adapter boundary.
- The same HTTP suite passes against Better Auth/Node development and the standalone native
  executable. It covers two principals, isolation, command idempotency, live NDJSON updates,
  durable restart, credential rejection, and graceful interruption.
- In an isolated cache, a clean authenticated CRUD build compiled runtime, identity, tasks, and
  Program crates in about 25 seconds. Editing the task callback rebuilt only tasks and the Program
  in 874 ms. Repeating the exact build copied the content-addressed artifact in 5 ms without Cargo.
- A normal production build emitted `web/` and a native `server/api` executable. The executable
  rendered the versioned initial-state web document in Rust, served assets separately, and adopted
  the same DOM during browser activation. Sign-up, deep-link navigation, CRUD, cross-browser
  realtime state, and reload persistence were exercised without console errors.
- A packed `@poggers/kit` tarball installed into a clean temporary application built both artifacts,
  proving that published code does not depend on workspace aliases or root-only dependencies.
- The latest repository gate passed TypeScript checks for the package and both examples, Oxlint,
  Oxfmt, 318 tests across 42 files, and the production package build. The checked-in native crate
  separately passed rustfmt, strict Clippy, unit tests, and doc tests.

Runtime validation of arbitrary hostile JSON from TypeScript-only entity contracts is not silently
claimed by this milestone. Credentials have explicit runtime validation, while generic entity
payloads are compile-time typed for generated clients. Deriving network validators from `TypeIR`
is a separate product contract and must be added consistently to both development and production
rather than patched into one backend.

## Explicit Non-Goals

- Compiling browser UI to Rust.
- Translating arbitrary TypeScript or arbitrary npm packages.
- Preserving Better Auth's implementation internally; only its semantic product behavior and data
  migration obligations matter to the native authentication adapter.
- Distributed deployment or horizontal coordination. The Program and Capability contracts must not
  prevent those future adapters, but this milestone proves one native server Process.
- Automatic runtime validation of arbitrary network payloads from compile-time-only model types.
- Optimizing release compilation before correctness, parity, and deterministic invalidation are
  measured.
