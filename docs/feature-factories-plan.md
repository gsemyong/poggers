# Data And Workflow Feature Factories

Status: complete

## North Star

Prove that substantial distributed behavior can be packaged behind small,
semantic, fully typed Feature factories:

1. Data: authoritative event-sourced writes, optimistic browser behavior,
   reactive typed queries, and replaceable local projections with Turso
   realizations for browser and server.
2. Workflow: ordinary procedural TypeScript with durable effects, retries,
   timers, signals, queries, cancellation, replay checks, and single-writer
   recovery.

Product code must not import transport, SQL, Turso, journal, timer, lease, or
worker APIs. Features provide semantic Dependencies. Platform Adapters provide
only the generic host Dependencies that remain after Feature linking.

This work is a pressure test of Kit's existing primitives, not permission to add
a second composition model.

## Invariants

- A Feature factory is a product language, not adapter configuration.
- One semantic model drives public types, implementation checks, and the API
  provided to other Programs.
- Cross-Program communication uses typed Dependencies.
- UI rendering remains pure over Program state; a browser Program consumes
  `watch` streams and copies results into state.
- The event log is authoritative. A query database is a disposable projection.
- Server domain logic owns authorization.
- Workflow dependencies are intercepted and journaled without exposing a
  second "step" function to workflow authors.
- Development TypeScript and native production consume the same compiled
  Feature meaning.
- Unsupported semantics are named explicitly rather than hidden behind escape
  hatches or parity claims.

## Research Record

The implementation uses these systems as falsification references:

- [LiveStore](https://docs.livestore.dev/evaluation/how-livestore-works/)
  validates immutable events materialized into reactive local SQLite.
- [PowerSync](https://docs.powersync.com/architecture/client-architecture)
  validates always-local reads and a server-controlled write path. Its upload
  queue and checkpoint protocol are not part of this Feature.
- [Turso's TypeScript SDK](https://docs.turso.tech/sdk/ts/reference) provides an
  embedded database in Node and WASM. This implementation uses the embedded
  database as a projection; it does not use Turso Cloud synchronization.
- [Temporal's TypeScript testing guidance](https://docs.temporal.io/develop/typescript/best-practices/testing-suite)
  establishes integration tests, virtual time, and history replay as the
  relevant evidence categories.
- [Restate's durable execution model](https://docs.restate.dev/foundations/key-concepts)
  validates journaling dependency results while retaining ordinary control
  flow.

These references inform test categories. They do not imply API, protocol,
correctness, or performance parity.

## Delivered Public Shape

Data is a headless API. Its private Entity child owns event sourcing and
optimistic reconciliation; its Data Program projects the latest visible
snapshot into the configured store.

```ts
type Notes = DataModel<{
  Name: "notes";
  Principal: Principal;
  Record: {
    id: string;
    owner: string;
    title: string;
    body: string;
    archived: boolean;
  };
  Create: { title: string; body: string };
  Update: { title?: string; body?: string; archived?: boolean };
}>;

const notes = createData<Notes>({
  name: "notes",
  indexes: ["owner", "archived"],
  search: ["title", "body"],
  create: ({ id, principal, input }) => ({
    id,
    owner: principal.id,
    ...input,
    archived: false,
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, record }) => record.owner === principal.id,
});
```

The provided Dependency has one operation vocabulary:

```ts
notes.get({ id });
notes.query({ where, order, offset, limit });
notes.search({ text, where, order, offset, limit });
notes.create(input);
notes.update({ id, changes });
notes.remove({ id });
notes.watch(query);
notes.watchSearch(search);
```

Workflow code remains normal procedural TypeScript:

```ts
type Fulfillment = WorkflowModel<{
  Name: "fulfillment";
  Input: { orderId: string };
  Result: { shipmentId: string };
  State: { phase: "pending" | "reserved" | "shipped" };
  Dependencies: {
    warehouse: {
      reserve(input: { orderId: string }): Promise<{ reservationId: string }>;
    };
    shipping: {
      ship(input: { reservationId: string }): Promise<{ shipmentId: string }>;
    };
  };
  Signals: { expedite(input: {}): void };
  Queries: { status(input: {}): string };
}>;

const fulfillment = createWorkflow<Fulfillment>({
  name: "fulfillment",
  state: () => ({ phase: "pending" }),
  async run({ dependencies, state, sleep }, input) {
    const reservation = await dependencies.warehouse.reserve(input);
    state.phase = "reserved";
    await sleep({ milliseconds: 300_000 });
    const shipment = await dependencies.shipping.ship(reservation);
    state.phase = "shipped";
    return shipment;
  },
  signals: { expedite() {} },
  queries: { status: ({ state }) => state.phase },
});
```

Its API is `start`, `get`, `result`, `cancel`, `watch`, typed `signals`, and
typed `queries`.

## Guarantees

### Data

- Type-safe fields, filters, ordering, search fields, and mutation inputs.
- Authoritative create, update, and remove events with expected-revision
  conflict handling inherited from Entity.
- Optimistic browser snapshots before server acknowledgement.
- Deterministic reconciliation after authoritative rejection.
- Principal-scoped server projection collections.
- Monotonic projection revisions; duplicate replacement at one revision is a
  no-op.
- Live query streams suppress unchanged results.
- Embedded Turso storage in Node and browser WASM, plus the same Rust production
  Dependency.
- The web adapter derives and emits cross-origin isolation headers when a linked
  browser Program requires the WASM Data store.

### Workflow

- Idempotent start by workflow identity.
- Completed dependency results and timers replay without re-execution.
- Retry policy, durable cancellation, typed signals and queries.
- Persisted state at dependency, timer, and signal boundaries.
- Replay rejects changes to dependency order, operation identity or input,
  timer duration, and state transitions at recorded boundaries.
- Renewable leases enforce one active writer per workflow identity while
  unrelated identities run concurrently.
- A second runtime can recover unfinished work after lease expiry.
- TypeScript development and generated Rust production implement the same
  journal vocabulary.

## Explicit Limits

These are not hidden acceptance failures:

- Data currently replaces the full visible projection for each new source
  revision. Incremental projection events are future scaling work.
- Turso Cloud push/pull is not used. Semantic synchronization belongs to Entity.
- Current Turso search returns deterministic matching and ordering, but the
  public relevance score is not yet a meaningful cross-engine ranking contract.
- Data schema upcasters and projection migrations are not implemented.
- Workflow dependency effects are at-least-once across a crash after the
  external call but before its completion is journaled. Effect Dependencies
  must accept an idempotency key or provide operation-level deduplication when
  duplicate side effects are unacceptable.
- Child workflows, continue-as-new/history compaction, and durable
  `Promise.all`/`Promise.race` branches are not implemented.
- Multi-process native failover has Rust lease tests and TypeScript
  two-replica tests, not a native networked cluster test.
- This is a Temporal/Restate-inspired foundation, not feature parity.

## Verification Ledger

### Implemented

- [x] Data type-pressure tests reject invalid fields and inputs.
- [x] Data create, update, remove, conflict, optimistic rejection, live query,
      search, and projection-revision behavior.
- [x] Turso Node property tests.
- [x] Turso browser WASM executes in a real browser with OPFS and the required
      cross-origin isolation.
- [x] Native Rust Data store test.
- [x] Workflow idempotent start, retry, durable timer, signal, query,
      cancellation, replay compatibility, lease takeover, and renewal tests.
- [x] Workflow replay detects historical signal-state changes.
- [x] Native Rust Workflow journal and lease tests.
- [x] Compiler coverage for nested factories, intercepted Dependencies, mutable
      records, streams, and array mapping.
- [x] Generated native Data and Workflow Programs compile and run their focused
      production tests.

### Remaining Before Core Commit

- [x] Write exact Feature guides and link them from the Feature index.
- [x] Refresh the reviewed public API manifest.
- [x] Run TypeScript, formatting, lint, all Vitest, all Rust, API, and package
      gates from a clean working tree.
- [x] Review the final diff for leaked adapter vocabulary and redundant files.
- [x] Commit the core Data and Workflow work.

## Optional Presentation Research

This phase begins only after the core commit. It must not silently turn into a
presentation rewrite.

- [x] Catalog current web CSS by semantic category: layout, typography, paint,
      effects, media, interaction, accessibility, containment, queries, and
      progressive enhancement.
- [x] Falsify CSS feature completeness, one-way semantics, container-responsive
      authoring, and optimal compilation in the current Presentation language.
- [x] Separate universally required Presentation meaning from declarations that
      belong only to one Platform adapter.
- [x] Audit whether routing, Component state/JSX, Presentation declarations,
      compilation, and runtime realization are replaceable contracts rather
      than one accidental web runtime.
- [x] Implement only gaps demonstrated by a concrete counterexample; otherwise
      record the surviving boundary and defer code churn.

Gate: either a concrete counterexample produces a focused adapter-contract
change, or the research records why the current boundary is sufficient. Full
CSS parity must never be claimed without property-by-property evidence.

## Progress

- 2026-07-23: Implemented and focused-tested Data and Workflow factories,
  development Dependencies, generated native production Dependencies, compiler
  lowering, and runtime lifecycle support.
- 2026-07-23: Added signal-state replay compatibility and renewable workflow
  lease coverage.
- 2026-07-23: Real-browser Turso proof exposed missing COOP/COEP. The web
  adapter now derives cross-origin isolation from linked Dependency meaning,
  emits it in development and native production, and fails fast when absent.
- 2026-07-23: Replaced aspirational parity claims with the exact public shape,
  guarantees, limitations, and remaining acceptance gates.
- 2026-07-23: Removed forbidden Feature-to-adapter and Platform-to-Feature
  dependency directions. Turso now lives in the one explicit shared Data
  adapter boundary; the Workflow development bridge lives under the server
  adapter.
- 2026-07-23: Acceptance passed: 54 Vitest files / 437 tests, the complete Rust
  workspace, TypeScript builds, architecture lint, formatting, and reviewed API
  drift. Vitest uses four workers so concurrent Vite and Cargo integration
  builds do not invalidate lifecycle and latency assertions through resource
  starvation.
- 2026-07-23: Committed the complete Data and Workflow implementation as
  `d1979a3`.
- 2026-07-23: Completed the optional Presentation falsification. The generic
  adapter boundary survives and already rejects crossed UI languages and
  targets. The current web vocabulary does not have full CSS parity; concrete
  counterexamples and the standards-derived completeness path are recorded in
  [Presentation Boundary And Web Coverage](./presentation.md). No partial
  runtime fields or second authoring API were added.
