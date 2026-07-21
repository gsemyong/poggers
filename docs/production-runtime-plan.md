# Production Runtime, Native SSR, and Replicas

## Goal

Poggers development must retain the current Vite/TypeScript feedback loop while production can
realize portable Programs and the initial web document as native Rust artifacts. Development and
production are two implementations of the same compiler-derived meaning. Neither application
Features nor Programs select a database, broker, native library, shard, replica, or rendering
engine.

This milestone also proves that one logical Program can run as several isolated Processes against
a network authority without changing Feature source. Scaling policy belongs to deployment and host
Capability adapters; it is not a second product-programming model.

```text
TypeScript product source
        |
        v
versioned semantic IR
        |
        +-- web development ----------> Vite + browser JavaScript
        +-- server development -------> Vite + Node Capability adapters
        +-- web production -----------> browser bundle + Web Document IR
        `-- server production --------> Rust workspace + native executable
                                             |
                                             +-- native host Capabilities
                                             +-- native document renderer
                                             `-- optional network authorities
```

## Research Conclusions

### Rendering

SSR is not static file serving. It renders application HTML for an HTTP request and the browser
then reactivates that exact DOM. A blank root served by Rust remains a client-rendered SPA. HTML
captured once during a build is prerendering, even when a Rust server later serves it.

The current compiler retains Component contracts but not their hierarchy or view expressions.
Consequently, arbitrary Rust-native SSR cannot be implemented correctly by editing the current
Axum fallback. The web adapter first needs a canonical render artifact. The first complete vertical
slice will support **native initial-state SSR**:

- production preparation evaluates platform UI source in an isolated, effect-free render profile;
- it emits a versioned `WebDocumentIR`, never an opaque HTML string;
- the Rust process renders that IR on every document request;
- the client reuses the emitted nodes while attaching reactivity and listeners;
- Component `mount`, Program `start`, native listeners, feedback, and I/O never run during
  preparation or server rendering;
- unsupported render behavior fails the SSR build with a Component identity instead of silently
  changing to client rendering.

This mode renders deterministic initial UI state. Request-derived authenticated state is the next
render-input capability, not something this milestone will fake. The artifact records its rendering
kind so initial-state SSR, request-data SSR, prerendering, and client-only output remain distinct.

### Native Capability Implementations

A production TypeScript process should not call Rust through FFI. The semantic Capability contract
has two independent implementations:

- development binds a JavaScript/Node implementation for hot reload;
- production binds a native Rust implementation generated or selected by the adapter.

FFI or subprocess bridges are test tools only, useful for running one conformance corpus against
both implementations. Adapter-owned Rust belongs in ordinary checked-in `.rs` files with Cargo,
rustfmt, Clippy, and Rust tests. TypeScript may generate small semantic Feature and Program crates,
but must not hide the stable native runtime inside multiline source strings.

The generated Cargo workspace remains the correct compilation unit: all crates share a lockfile and
target directory, while Feature and adapter crates preserve incremental boundaries. Semantic hashes
key final artifacts; Cargo owns intermediate dependency and incremental caches.

### Replicas and Sharding

Replicas are several Processes of one Program. Correctness requires shared authorities behind
Capabilities; copying a Process with a private SQLite database does not create a distributed system.
SQLite remains a valid single-node adapter and can prove multi-process locking on one host, but it
cannot prove separate-machine durability or cross-replica subscriptions.

For the existing entity language, the minimal distributed storage semantics are already expressed
by `EventStore`:

- ordered reads per stream;
- compare-and-append at an expected stream revision;
- ordered continuation after a revision;
- one append batch committed atomically;
- duplicate command handling above or within the adapter.

JetStream is a suitable network implementation for the replica experiment. One message represents
one append batch, which preserves the all-or-nothing `EventStore.append` contract. A subject is one
logical event stream; compare-and-publish provides single-writer ordering while ordered consumers
provide complete replicas. Shared durable pull consumers are appropriate for work distribution, not
for projections that each need a complete copy.

Sharding is a placement optimization, not a Feature API. Stateless request replicas may all access
the network authority. A future stateful processor adapter may add deterministic key placement,
leases, and rebalance epochs. Programs continue to see semantic Capabilities and are unaffected by
whether the adapter uses one file, one broker, or many shards.

## Invariants

- Product source contains Programs, Components, Features, and semantic Capability contracts only.
- Development and production consume the same versioned IR and Program linker result.
- Production never imports or embeds an application JavaScript runtime.
- A rendering mode is explicit in artifacts and observable in tests.
- SSR reuses server nodes; replacing the root is a failed hydration gate.
- Server rendering performs no application effects and owns no browser-native handle.
- Stable native adapter code is ordinary Rust source, not TypeScript string data.
- Every native Capability is validated structurally before Cargo starts.
- One conformance corpus can exercise development and native implementations.
- Each Process owns one host Capability scope; replicas never share in-memory mutable objects.
- Cross-replica correctness comes from Capability semantics, not sticky routing assumptions.
- Per-stream revisions are contiguous and compare-and-append has one winner under contention.
- Tests label single-node, multi-process, and network-replica evidence accurately.

## Target Organization

```text
src/
  core/
    compiler/                    # source -> portable semantic IR
  contracts/
    platform.ts                 # develop/build adapter boundary
  adapters/
    web/
      adapter.ts
      toolchain.ts
      document.ts               # Web Document IR, serializer, preparation
      ui/                        # browser Component and Presentation realization
    server/
      adapter.ts
      host.ts                    # Node development host
      native.ts                  # Rust workspace assembly/cache only
      native/
        Cargo.toml
        src/                     # stable native host and document runtime
  features/                      # reusable product languages
```

Generated workspaces copy or reference the stable native crate and add only semantic Feature and
Program crates. No generated Rust file is edited by an application author.

## Execution Plan

### 1. Freeze Boundaries and Fixtures

- [x] Audit the current compiler, web build, native server, Capability host, and production tests.
- [x] Record why static fallback is not SSR and why the current Component IR is insufficient.
- [x] Add a focused initial-state render fixture with nested Features, dynamic text, conditions,
      repeated Components, attributes, and escaped hostile text.
- [x] Preserve the authenticated CRUD application as the multi-Feature acceptance application.

Gate: tests expose the current blank-root output and destructive client mount before implementation.

### 2. Canonical Web Document Artifact

- [x] Define a versioned, deterministic, data-only `WebDocumentIR` owned by the web adapter.
- [x] Represent elements, text, fragments, attributes, hydration identities, head metadata, assets,
      and the browser entry without retaining functions or native handles.
- [x] Add an effect-free preparation runtime that instantiates initial UI state and evaluates views
      without invoking `start`, `mount`, actions, refs, subscriptions, feedback, or observations.
- [x] Support the structural primitives used by both examples, including keyed repetition and
      conditional children, with explicit diagnostics for unsupported behavior.
- [x] Serialize equal meaning byte-for-byte and reject non-finite, executable, cyclic, or native
      values.

Gate: fixed and property-generated trees round-trip deterministically, escape HTML correctly, and
cannot execute effects during preparation.

### 3. Rust-Native Document Rendering

- [x] Move the stable native runtime from TypeScript strings into a checked-in Cargo crate.
- [x] Add a Rust `WebDocumentIR` decoder and deterministic HTML renderer. Streaming remains a
      request-data SSR optimization rather than a correctness requirement for the bounded artifact.
- [x] Make the native server distinguish API, asset, document, unknown, and method-not-allowed
      requests; preserve SPA deep links only as an explicit client-only mode.
- [x] Render the initial-state document on each request, including status, content type, head,
      rendering marker, and immutable asset references.
- [x] Keep static assets on `ServeDir` while document routes pass through the renderer.

Gate: the standalone native executable returns non-empty application markup before JavaScript,
escapes adversarial input, serves assets, and does not contain Node/Bun/JavaScript runtimes.

### 4. Browser Reactivation

- [x] Give structural nodes deterministic hydration identities independent of source formatting.
- [x] Add a hydration cursor to the web Component runtime that adopts matching elements, text, and
      structural anchors while attaching reactive bindings, refs, and listeners.
- [x] Fail safely and diagnostically on server/client shape disagreement; do not duplicate content.
- [x] Start Programs and Component mounts only after structural hydration succeeds.
- [x] Preserve the existing HMR replacement path after initial hydration.

Gate: node identities are unchanged before and after activation, listeners work once, no duplicate
nodes appear, and a mismatch has a deterministic diagnostic and recovery path.

### 5. Initial Presentation Artifact

- [x] Evaluate the initial pure Presentation frame against prepared Component state.
- [x] Compile static declarations to deterministic CSS and attach generated classes in the document
      IR; retain dynamic/client-only declarations for activation.
- [x] Include fonts and assets by their emitted production URLs without filesystem leakage.
- [x] Ensure initial CSS and hydrated browser CSS use identical class/template hashes and cascade
      layers.

Gate: SSR first paint is styled without waiting for JavaScript and hydration performs no class-name
replacement for an unchanged initial frame.

### 6. Native Capability Source and Conformance

- [x] Co-locate stable Rust host implementations in the native adapter crate.
- [x] Keep generated Feature crates limited to portable product behavior and typed calls.
- [x] Define data-only conformance scenarios for authentication, event persistence, identifiers,
      clock, HTTP routing, and document rendering.
- [x] Run scenarios against Node development and native Rust through test-only process/HTTP bridges.
- [x] Add exact pre-Cargo diagnostics for missing operations and incompatible portable types.
- [x] Package native Rust sources and verify a packed kit builds from a clean temporary project.

Gate: ordinary Cargo commands format, lint, and test the stable runtime; the same observable
Capability scenarios pass in both realizations.

### 7. Network EventStore and Replica Simulation

- [x] Implement JetStream as an optional host `EventStore` adapter without changing Feature source.
- [x] Store one atomic append batch per stream subject and enforce expected revision with CAS.
- [x] Implement read and live continuation without gaps or duplicate logical revisions.
- [x] Launch an isolated local JetStream authority and two Process replicas with separate working
      directories, ports, and in-memory state.
- [x] Route public API calls and concurrent appends across both replicas; verify subscriptions,
      authorization boundaries in the fixture, restart catch-up, and one winner for conflicting
      revisions.
- [x] Add deterministic shard-placement property tests for the deployment helper only: stability,
      bounded remapping, replica count, and order invariance.
- [x] Record separately what is proven by the simulation and what still requires a real multi-node
      JetStream cluster failure test.

Gate: two isolated replicas observe one contiguous durable history through a network authority,
survive one replica restart, and require no application or Feature change.

### 8. Translation Reliability

- [x] Version and validate all production IR envelopes, reject unknown fields where ambiguity would
      alter behavior, and preserve source diagnostics outside semantic hashes.
- [x] Add golden IR/Rust/HTML fixtures only at semantic boundaries.
- [x] Expand differential tests across expressions, control flow, failures, Unicode, numeric edges,
      render escaping, and Capability results.
- [x] Add property tests for deterministic lowering, contribution permutation, and document
      round-trip, plus a network CAS contention test for replica appends.
- [x] Verify clean, no-op, one-Feature, web-only, and native-runtime rebuild scopes.

Gate: unsupported source fails before native compilation; supported scenarios are equivalent across
JavaScript and Rust; no-op builds invoke neither code generation nor Cargo.

### 9. Cleanup and Full Acceptance

- [x] Remove superseded generated-runtime strings, duplicate fixtures, and misleading SSR language.
- [x] Keep tests at compiler, adapter contract, conformance, replica, and one application E2E
      boundary; remove tests made redundant by stronger gates.
- [x] Document build/run commands, rendering guarantees, Capability implementation convention,
      cache behavior, and replica semantics.
- [x] Run typecheck, Oxlint, Oxfmt, Vitest, Cargo fmt/Clippy/test, package build, clean-install build,
      native HTTP acceptance, and browser acceptance.

Gate: the repository has one production path, one native source convention, no silent rendering
fallback, no leaked development runtime, and all checks pass from a clean checkout.

## Recorded Evidence

- The authenticated CRUD production build emits `server/api`, browser assets,
  `application.ir.json`, `document.ir.json`, and styled initial HTML.
- The Rust response for a deep route is byte-for-byte equal to the TypeScript reference renderer;
  document, missing-asset, unsupported-method, and HEAD requests return the expected status.
- Browser acceptance with the application script initially blocked observed six SSR Elements. After
  activation, the same root and all six native Element objects remained connected, hydration
  markers were consumed, and one click caused one state transition.
- A deliberately corrupted text marker emitted one deterministic mismatch diagnostic and recovered
  to one working client tree under `client-recovered`.
- Account creation, task creation, URL navigation, and a task propagated to a second independent
  browser session passed against the standalone Rust executable.
- The presentation-heavy example emits 38 hydratable Elements, deterministic initial CSS, an image,
  and its production audio asset.
- Two independent Program replicas on separate ports and host scopes read one JetStream authority,
  enforce principal isolation, and catch up after one replica is destroyed and recreated. The
  lower-level suite also proves one CAS winner and gap-free live continuation.
- A packed tarball installed into a fresh generated project passes its complete `poggers check`.
- `nub run check` passes 318 tests across 42 files, type checking, Oxlint, Oxfmt, and package build.
  The checked-in Rust crate passes rustfmt, strict Clippy, unit tests, and doc tests.

The replica evidence uses one local `nats-server` process as a network authority. It does not claim
multi-node JetStream quorum/failover, network-partition behavior, or a native Rust JetStream host.
Those require deployment-specific integration infrastructure and remain outside this milestone.

## Completion Criteria

This milestone is complete only when:

1. A normal authenticated CRUD production build emits browser assets, Web Document IR, and one
   standalone native server executable.
2. The Rust executable renders non-empty, styled initial application HTML for a deep document URL
   and serves the browser assets.
3. Browser activation reuses that DOM and the auth/CRUD/realtime workflow still passes.
4. Stable host Capability implementations are checked-in Rust and satisfy shared conformance tests.
5. Two isolated Process replicas pass the network-authority contention, continuation, restart, and
   routing suite without Feature changes.
6. Compiler/IR/Rust/HTML output is deterministic, unsupported meaning fails early, and packaged-kit
   acceptance passes without ambient workspace dependencies.
7. Documentation states that this milestone renders deterministic initial state; authenticated or
   arbitrary request-data SSR is not claimed until a typed render-input Capability is designed.

## Sources

- Vite defines SSR as running an application on the server to produce HTML followed by client
  hydration: <https://main.vite.dev/guide/ssr>
- Leptos documents the same server-render/rehydrate lifecycle and specifically notes that hydration
  does not recreate the server DOM: <https://book.leptos.dev/ssr/22_life_cycle.html>
- Cargo workspaces share a lockfile and target directory, while incremental compilation applies to
  workspace/path crates: <https://doc.rust-lang.org/cargo/reference/workspaces.html> and
  <https://doc.rust-lang.org/cargo/reference/profiles.html>
- JetStream recommends pull consumers for horizontally scaled work and ordered consumers for a
  complete stream copy: <https://docs.nats.io/nats-concepts/jetstream/consumers>
- JetStream publish expectations provide optimistic concurrency at stream or subject boundaries:
  <https://docs.nats.io/nats-concepts/jetstream/headers>
