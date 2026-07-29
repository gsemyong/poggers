# Application Foundations Plan

Status: complete for the canonical vertical slice; explicitly listed
post-slice provider migration remains deferred

This is the living source of truth for the first complete application
foundation built on Kit. It records the evidence, target semantics, migration
sequence, and focused verification gates. Checklists describe demonstrated
work, not intent; an item is checked only after its evidence exists.

## North Star

Build one authenticated, offline-capable company-operations slice that proves
how reusable Kit Features compose without adding concepts to the universal
substrate.

Kit's universal substrate remains only:

1. `Program` for executable meaning in one Environment;
2. `Dependency` for every interaction with authority outside that Program;
3. `Feature` for reusable vertical composition.

The application foundation adds optional Feature factories with distinct,
named guarantees:

- `Actor`: durable keyed execution with one fenced write authority per key;
- `Aggregate`: event-sourced domain authority and one atomic consistency
  boundary, implemented over Actor rather than beside it;
- `Workflow`: durable coordination across Aggregates and Dependencies;
- `Projection`: checkpointed, rebuildable read models;
- `Identity`: authentication and typed principal establishment;
- `Replica`: an authorized local projection with optimistic commands and
  reconciliation.

Storage engines, transactions, full-text indexes, vector indexes, property
graphs, geospatial indexes, analytical engines, object stores, transports, and
identity providers remain typed Dependencies. A provider is interchangeable
only when it implements the same observable contract, including consistency
and failure semantics.

No public API exposes SQL, Cypher, storage handles, provider clients, transport
details, credentials, or native-language implementation details. Portable
query and migration meaning is typed, serializable, inspectable, and lowerable
by adapters. Generic TypeScript-to-Rust lowering remains unaware of Actor,
Aggregate, Workflow, Projection, Replica, and the canonical application.

## Evidence Ledger

The design is constrained by established systems rather than inferred from
their names.

### Event-Sourced Authority

- [Akka Event Sourcing](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html)
  separates typed commands, immutable events, and state. Commands decide;
  persisted events alone evolve state; an event reducer must not perform
  effects because it also runs during replay.
- [Akka schema evolution](https://doc.akka.io/libraries/akka-core/current/persistence-schema-evolution.html)
  keeps stored history readable through serializers and event adapters instead
  of rewriting domain history in place.
- [Axon event versioning](https://docs.axoniq.io/axon-framework-reference/main/events/event-versioning/)
  stores event type and revision and applies explicit upcasters.
- [Orleans log consistency](https://learn.microsoft.com/en-us/dotnet/orleans/grains/event-sourcing/log-consistency-providers)
  demonstrates that uncertain storage outcomes require stable identities and
  deduplication even when expected-version append is available.
- [Kurrent persistent subscriptions](https://docs.kurrent.io/server/v25.1/features/persistent-subscriptions)
  use persisted checkpoints and at-least-once delivery; consumers must tolerate
  duplicates.

Consequences:

- an Aggregate command returns events and a result; it does not mutate state;
- one command may append several events atomically;
- every event has stable identity, stream revision, global position, semantic
  type, schema version, data, and causation/correlation metadata;
- reducers are pure and total for every readable event version;
- effects use the Actor outbound-intent kernel and execute only after commit;
- one Aggregate is one consistency boundary; cross-Aggregate work uses a
  Workflow saga or a specialized transactional Dependency.

### Projection And Query

- [Akka Projection](https://doc.akka.io/libraries/akka-projection/current/overview.html)
  treats read models as separately checkpointed consumers of durable events.
- [Microsoft's event-sourcing guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
  treats projections as materialized views and warns that event sourcing is a
  selective pattern, not a universal storage model.
- [Substrait](https://substrait.io/) establishes a versioned, cross-language
  semantic representation of relational compute independent of execution
  engines.
- C# [expression trees](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/expression-trees/)
  show how a restricted typed expression language can be inspected and lowered
  to different engines.
- [Cypher](https://neo4j.com/docs/cypher-manual/current/introduction/)
  demonstrates that property-graph traversal has domain meaning not reducible
  to a few ORM relation helpers.
- [DuckDB](https://duckdb.org/docs/current/guides/network_cloud_storage/s3_import)
  demonstrates analytical execution directly over open Parquet data in
  S3-compatible object storage.

Consequences:

- Projection owns source offsets, deterministic reducers, schema identity,
  generation, rebuild, and publication;
- relational compute uses a small typed algebra influenced by Substrait, not
  SQL-shaped strings;
- text, vector, graph, geo, and analytical operations are explicit typed
  capabilities, not overloaded comparison operators;
- a provider reports its supported capability set before a System is built;
- unsupported semantics fail at build time where statically knowable and at
  provider binding otherwise; there is no silent in-memory fallback;
- operational views and analytical exports may consume the same domain events,
  but have independent checkpoints, storage, retention, and scaling.

### Local-First Synchronization And Migration

- [Jazz migrations](https://jazz.tools/docs/schemas/migrations) identify
  schemas by content hash and connect versions with reviewed transformation
  edges rather than relying on one mutable global schema.
- [Jazz synchronization](https://jazz.tools/docs/concepts/how-sync-works)
  separates local state, persisted changes, and synchronization transport.
- [Automerge repositories](https://automerge.org/docs/reference/repositories/)
  separate document semantics from storage and network adapters.
- [Electric shapes](https://legacy.electric-sql.com/docs/usage/data-access/shapes)
  demonstrate query-shaped partial replication rather than shipping an entire
  database to every client.

Consequences:

- Replica synchronizes an explicitly authorized Projection shape, never an
  unrestricted physical database;
- the server sends an initial snapshot plus cursor, then ordered deltas;
- local commands carry stable identity and schema version and survive reload;
- optimistic execution reuses the Aggregate's pure decision logic when the
  required state and policy are locally available;
- the authoritative server re-authenticates, re-authorizes, and re-runs every
  command;
- rejection rebases later pending commands instead of replacing the whole
  client state blindly;
- revocation removes now-inaccessible rows and invalidates affected pending
  commands;
- event upcasters are forward-only; reversible bidirectional schema lenses are
  allowed only for replica representations that actually preserve meaning;
- there is no fixed "keep two versions" rule. Current and previous versions are
  the rolling-deployment minimum, while every stored event and every command
  that may remain offline must retain a complete migration path.

### Identity And Authorization

- [Better Auth](https://better-auth.com/docs/introduction) is an open,
  self-hostable authentication provider candidate, not Kit's authorization
  model.
- [Cedar](https://docs.cedarpolicy.com/) separates policy from application
  mechanism and evaluates principal, action, resource, and context.
- [OpenFGA](https://openfga.dev/docs/concepts) demonstrates relationship-based,
  server-enforced authorization for shared resources.

Consequences:

- Identity establishes a typed principal and session;
- authorization is declared beside each command, Workflow operation, and
  Projection shape because that is where action and resource meaning exists;
- authorization decisions are pure semantic policy where possible and may use
  declared Dependencies for relationship or entitlement authority;
- browser visibility is server-filtered; client checks are UX hints only;
- offline commands are re-authorized at commit;
- Workflows persist initiating or delegated authority, never bearer tokens;
- authentication providers and authorization data stores remain replaceable
  Dependencies with contract suites.

## Current Inventory And Gap Ledger

| Area                | Current state                                                                     | Required action                                                                       |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Universal substrate | `Program`, `Dependency`, and `Feature` boundaries are established                 | Preserve                                                                              |
| Actor               | Durable virtual actor and outbound-intent kernel exist                            | Reuse; add no Aggregate special case to core/compiler                                 |
| Workflow            | Actor-backed durable coordination and observation exist                           | Compose in slice; do not move its time/retry semantics                                |
| Identity            | Typed principal, server service, browser session, and provider boundary exist     | Preserve authentication; add composable authorization semantics                       |
| Event store         | Versioned events, global cursors, retention, migration, and provider parity exist | Preserve; extend only from a demonstrated provider requirement                        |
| Entity              | Mixes event authority, HTTP, auth, optimistic client state, and synchronization   | Preserve tests as migration evidence; replace after narrower factories cover behavior |
| Data                | Mixes Entity, query projection, search, Turso realization, and web headers        | Decompose; retain useful provider implementations behind Projection/Replica contracts |
| Projection          | Independent checkpointed/rebuildable factory and generation contract exist        | Add physical providers only behind the demonstrated semantic contract                 |
| Query meaning       | Typed relational, text, vector, graph, geo, and analytical meaning exists         | Keep one semantic surface; negotiate provider capabilities explicitly                 |
| Aggregate           | Actor-backed commands, retained events, upcasters, snapshots, and policy exist    | Preserve one Aggregate as one consistency boundary                                    |
| Replica             | Authorized snapshot/delta sync, optimistic intent, rebase, and migration exist    | Preserve transport and local persistence as Dependencies                              |
| Authorization       | Identity establishes principals; factories enforce typed resource policy          | Add specialized policy providers only for concrete relationship workloads             |
| Analytics           | Deterministic reference semantics exist for the canonical workload                | Defer physical columnar export until an external analytical workload requires it      |
| Graph/vector/geo    | Provider-neutral semantic operations exist for the canonical workload             | Extend only through pressure-tested operations, never raw provider syntax             |
| Production parity   | The complete slice runs through development and generated-Rust production         | Preserve differential and release gates                                               |

## Canonical Vertical Slice

The proving application is a small company-operations system, not a toy CRUD
screen.

### Domain

- organizations contain members with explicit roles;
- products and warehouses hold inventory;
- customers place orders containing product quantities and delivery location;
- an Order Aggregate validates placement and cancellation;
- an Inventory Aggregate serializes reservations per stock item;
- a fulfillment Workflow reserves inventory, requests shipping through a
  mocked Dependency, records progress, and compensates partial reservations;
- Identity establishes the member principal and authorization restricts
  commands and views by organization and role.

### Read And Interaction Paths

- relational view: orders filtered, sorted, joined to customer and fulfillment
  status;
- full-text view: products and order notes;
- vector view: semantically related product descriptions using a deterministic
  test embedding provider;
- graph view: product substitution and supplier relationships;
- geo view: nearest eligible warehouse;
- analytical view: order value, fulfillment latency, and stockout aggregates
  exported to open columnar data and queried through an analytical Dependency;
- browser Replica: authorized operational rows, offline place/cancel commands,
  optimistic rendering, reconnect, rebase, and revocation;
- Workflow observation: one operational Projection consumes Workflow visibility
  changes so browser code does not scan actor state.

### Failure And Evolution Cases

The slice is incomplete until it demonstrates:

- duplicate command submission and uncertain append outcome;
- crash after Aggregate events and outbound intent commit;
- projection crash before and after checkpoint persistence;
- complete projection rebuild into a new generation;
- offline command created by the previous schema version;
- event replay through at least two explicit upcaster edges;
- authorization revoked while the browser is offline;
- concurrent commands for one Aggregate and independent progress for others;
- Workflow compensation after one inventory reservation succeeds;
- provider contract equivalence for in-memory and embedded implementations.

## Target Public Semantics

The following sketches express ownership and type flow. Exact names remain
provisional until type-level pressure tests pass. Type parameters declare
semantic names once; runtime objects fill behavior and do not duplicate them.

### Aggregate

```ts
type Order = Aggregate<{
  Key: string;
  Input: { organization: string; customer: string };
  State: OrderState;
  Principal: Principal;
  Dependencies: { clock: Clock };
  Commands: {
    place: Command<{ lines: readonly Line[] }, { revision: number }>;
    cancel: Command<{ reason: string }, void>;
  };
  Events: {
    placed: Event<3, OrderPlacedV3, { 1: OrderPlacedV1; 2: OrderPlacedV2 }>;
    cancelled: Event<1, OrderCancelled>;
  };
}>;

const order = createAggregate<Order>({
  state({ input }) {
    return initialOrder(input);
  },
  commands: {
    place({ state, input, principal, dependencies }) {
      return {
        events: [{ placed: {/* current data */} }],
        result: { revision: state.revision + 1 },
      };
    },
    cancel({ state, input }) {
      return { events: [{ cancelled: input }] };
    },
  },
  events: {
    placed: {
      migrate: {
        1(value) {
          return toV2(value);
        },
        2(value) {
          return toV3(value);
        },
      },
      apply({ state, event }) {
        return applyPlaced(state, event);
      },
    },
    cancelled: {
      apply({ state, event }) {
        return applyCancelled(state, event);
      },
    },
  },
  authorize: {
    place({ principal, state }) {
      return principal.organization === state.organization;
    },
    cancel({ principal, state }) {
      return principal.organization === state.organization;
    },
  },
});
```

Acceptance rules:

- the compiler verifies every required migration edge;
- handlers can access only declared Dependencies;
- reducers cannot access Dependencies, time, randomness, or I/O;
- command IDs make retries idempotent;
- event append, state result, and Actor outbound intents share one atomic turn;
- snapshots are disposable caches and can always be regenerated by replay.

### Projection

```ts
type Operations = Projection<{
  Sources: {
    orders: EventsOf<typeof order>;
    inventory: EventsOf<typeof inventory>;
    fulfillment: VisibilityOf<typeof fulfillment>;
  };
  Rows: {
    orders: OrderRow;
    products: ProductRow;
    warehouses: WarehouseRow;
    substitutions: ProductRelation;
  };
  Queries: {
    relational: true;
    text: ["products.name", "products.description", "orders.note"];
    vector: { products: { field: "embedding"; dimensions: 384 } };
    graph: { substitutions: ["from", "to"] };
    geo: { warehouses: "location" };
  };
}>;

const operations = createProjection<Operations>({
  reduce({ source, event, rows }) {
    // Deterministic row mutations only.
  },
});
```

Projection query APIs use typed expression lambdas compiled into versioned
semantic IR. Text, vector, graph, and geo operations remain explicit because
their scoring, traversal, and metric semantics differ. Providers never receive
arbitrary product callbacks.

### Replica

```ts
type OperationsReplica = Replica<{
  Projection: typeof operations;
  Commands: {
    placeOrder: CommandOf<typeof order, "place">;
    cancelOrder: CommandOf<typeof order, "cancel">;
  };
  Schema: 3;
  History: { 1: OperationsRowsV1; 2: OperationsRowsV2 };
}>;

const localOperations = createReplica<OperationsReplica>({
  shape({ principal, query }) {
    return query.orders.where((order) => order.organization === principal.organization);
  },
  optimistic: {
    placeOrder({ rows, input }) {
      /* deterministic local row effect */
    },
    cancelOrder({ rows, input }) {
      /* deterministic local row effect */
    },
  },
  migrate: {
    1(value) {
      return replicaV2(value);
    },
    2(value) {
      return replicaV3(value);
    },
  },
});
```

The semantic protocol is snapshot plus cursor plus ordered deltas plus a stable
pending-command log. Transport, local database, server event source, reconnect
strategy, and persistence are Dependencies/providers.

## Migration And Compatibility Matrix

| Artifact             | Identity                                      | Compatibility rule                                                       | Recovery                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| Domain event         | type + numeric version                        | Forward upcaster path from every retained version                        | Replay                                  |
| Aggregate snapshot   | Aggregate type + schema hash + event revision | Current only; reject stale/incompatible cache                            | Replay events                           |
| Command              | command type + numeric version + stable ID    | Upgrade every version allowed in an offline queue                        | Re-run authoritative decision           |
| Projection           | projection schema hash + generation           | Rebuild on reducer/index semantic change                                 | Replay sources from checkpoint zero     |
| Replica row set      | schema hash                                   | Reviewed adjacent lens where reversible; otherwise upgrade/reseed        | Snapshot plus pending-command migration |
| Workflow execution   | definition artifact/version                   | Existing execution remains pinned; explicit migration or continue-as-new | Replay/checkpoint                       |
| Authorization policy | policy schema/version                         | Re-evaluate on authoritative command and every shape refresh             | Reject, redact, or revoke               |

## Implementation Milestones

### 0. Baseline And Type Pressure Tests

- [x] Inventory current Actor, Workflow, Identity, Entity, Data, and EventStore
      responsibilities.
- [x] Record primary-source design constraints.
- [x] Add compile-only sketches for the complete slice without runtime
      implementation.
- [x] Falsify duplicate names, untyped path strings, provider leakage, raw
      query text, undeclared Dependencies, and incomplete migration chains.
- [x] Freeze the accepted public vocabulary for this foundation: `Aggregate`
      owns event-sourced write authority, `Projection` owns rebuildable read
      meaning, and `Replica` owns an authorized local copy and pending intent.

Gate:

```sh
nub run typecheck
```

### 1. Event Store Contract

- [x] Add stable event ID, type, schema version, global position, and metadata.
- [x] Preserve optimistic per-stream append with explicit uncertain-failure
      semantics: stable Actor invocation and event identities let a retry
      recover the committed result without appending a second domain event.
- [x] Add checkpointed global/category reads needed by Projections.
- [x] Define retention separately from Aggregate snapshotting.
- [x] Update memory, TypeScript, JetStream, SQLite, and Rust provider contracts
      only where they claim the affected guarantees.
- [x] Prove old Actor and Workflow journals retain behavior.

Gates: focused EventStore provider contract; Actor and Workflow source tests.
No browser gate.

### 2. Aggregate Over Actor

- [x] Implement typed command/event/state model without duplicated names.
- [x] Reuse Actor identity, serialized turns, fencing, reminders, and outbound
      intent rather than implementing another runtime.
- [x] Add pure event reduction, multi-event atomic decisions, command
      idempotency, snapshots, and forward upcasters.
- [x] Provide a factory-authored testing surface for decide, evolve, replay,
      migration, duplicate command, and crash recovery.
- [x] Prove ordinary Actors without domain events remain unchanged.

Gates: type tests, pure property tests, memory provider contract, focused Actor
regression. Rust differential only after the portable meaning stabilizes.

### 3. Authorization

- [x] Preserve Identity authentication provider boundaries.
- [x] Keep action and resource meaning concrete rather than adding a universal
      policy language: an Aggregate command name is the action and its key,
      state, and input are the resource context.
- [x] Enforce typed authorization on Aggregate reads and commands, Projection
      rows, and every Replica authority request. Workflow authority is carried
      as durable typed input and rechecked by the Aggregates it invokes.
- [x] Allow relationship or entitlement authority only through Dependencies
      declared by the owning Aggregate or Projection.
- [x] Exercise role, ownership, cross-organization isolation, offline command
      reauthorization, revocation, and Workflow-delegated Aggregate access.

Gates: policy truth-table/property tests and server contract tests. No browser
gate yet.

### 4. Projection And Query Semantics

- [x] Implement source cursor, reducer, serialized checkpoint publication, and
      idempotent duplicate handling.
- [x] Demonstrate deterministic complete rebuild from retained source history,
      checkpoint restart, and independent projection version stream identity.
- [x] Define the smallest typed expression and relational algebra required by
      the canonical slice.
- [x] Define explicit typed text, cosine-vector, graph traversal, WGS84-nearby,
      and grouped analytical semantics used by the canonical slice.
- [x] Implement deterministic in-Program reference semantics.
- [ ] Post-slice provider work: negotiate physical provider capabilities and
      adapt an embedded operational store without changing public query
      meaning.
- [ ] Post-slice provider work: add open columnar export plus DuckDB only when a
      concrete analytical workload requires execution outside the reference
      Projection.
- [ ] Post-slice provider work: add an S3-compatible object Dependency when an
      export workload exists; VersityGW may be a local fixture, never product
      semantics.

Gates: reducer property tests, crash/checkpoint/rebuild tests, query IR
snapshots, and provider differential suites.

### 5. Replica And Sync

- [x] Implement authorized shape negotiation with a version and schema
      fingerprint covering both row state and complete command definitions.
- [x] Implement initial snapshot, opaque cursor, ordered replacement delta, and
      reconnect.
- [x] Implement stable persisted pending commands and optimistic reducers.
- [x] Re-run authentication, authorization, and Aggregate decision at the
      authority.
- [x] Reconcile acceptance/rejection while preserving later pending intent.
- [x] Revoke inaccessible rows and affected pending commands.
- [x] Implement migration, reseed, and explicit incompatible-client
      negotiation.
- [x] Preserve transport and local storage as `HttpClient` and `LocalStore`
      Dependency contracts.

Gates: deterministic network simulation with loss, duplication, reordering,
offline restart, old clients, and revocation. Browser gate starts here.

### 6. Canonical Company-Operations Slice

- [x] Compose Identity, Orders, Inventory, fulfillment Workflow, Operations
      Projection, and browser Replica as ordinary Features.
- [x] Exercise relational, text, vector, graph, geo, and analytical paths.
- [x] Provide realistic mocked shipping and identity providers through the same
      contracts used by production implementations.
- [x] Keep embedding production outside Replica and query semantics. The
      canonical deterministic vector is domain data; a real model is supplied
      later through a typed Dependency without changing Projection.
- [x] Demonstrate offline placement, reconnect, partial-reservation
      compensation, authorization revocation, Workflow progress, and restart
      recovery.
- [x] Demonstrate offline cancel in the canonical slice and projection rebuild
      plus old-schema migration in the adjacent factory suites.
- [x] Verify HMR and the authenticated browser UI without calling real
      third-party services.

Gates: focused system test and one end-to-end in-app browser pass. No
cross-browser matrix.

### 7. Production And Cleanup

- [x] Add generated-Rust differential evidence for dynamic typed Dependency
      dispatch and run the same black-box authenticated System specification
      through development and generated-Rust production.
- [x] Verify request/response native Dependency providers through
      TypeScript-owned conformance and EventStore streaming through its native
      implementation suite. The JSON provider host intentionally cannot
      serialize an open `AsyncIterable`.
- [x] Verify Identity, Aggregate, Projection, and Replica persistence across a
      generated-Rust production restart with a real local JetStream service.
- [ ] Move useful Entity/Data providers behind their narrower contracts.
- [ ] Remove superseded Entity/Data APIs, tests, docs, and exports only after
      the canonical slice covers their valid behavior.
- [x] Audit that generic compiler and Rust lowering contain no Actor,
      Aggregate, Projection, Replica, or Workflow semantic branches.
- [x] Run the complete repository gate once.

The two Entity/Data cleanup items are deliberately post-slice. `Aggregate`,
`Projection`, and `Replica` now replace their public semantic overlap, but
Data's browser/server Turso provider still has unique physical indexed-storage
behavior. Deleting it before a narrow Projection-store provider passes the
same contracts would discard evidence rather than remove residue.

## Verification Ladder

Use the cheapest gate that can falsify the current change:

1. type-only API or one focused Vitest file;
2. factory source tests and in-memory provider contracts;
3. affected provider contract suite;
4. browser verification only for Replica/UI behavior;
5. compiler/Rust differential only for stable shared IR or native providers;
6. complete repository and production release gates once after stabilization.

Every Dependency contract owns reusable TypeScript conformance tests. Native
implementations are invoked through those tests; native-only tests are reserved
for unsafe implementation details that cannot be observed through the
contract.

Property-based suites cover:

- arbitrary valid command sequences and replay equivalence;
- migration path composition;
- duplicate and reordered delivery;
- projection rebuild equivalence;
- sync convergence after acceptance/rejection/revocation;
- authorization monotonicity for explicitly hierarchical roles;
- serialization round trips for every versioned IR.

Golden fixtures cover only stable externally inspectable IR and native
lowering. They are not substitutes for behavioral tests.

## Non-Goals

- Event sourcing every record or using Aggregate as a synonym for entity.
- A universal database, ORM, query engine, graph engine, or storage provider.
- Raw SQL, Cypher, CSS-like escape hatches, or arbitrary callbacks passed to
  providers.
- Generic distributed transactions or hidden two-phase commit.
- Peer-authoritative CRDT editing inside Replica. A future Document factory may
  provide that distinct guarantee.
- Turso Cloud synchronization or any proprietary production service.
- Treating Turso, DuckDB, Better Auth, VersityGW, or a model gateway as public
  product semantics.
- Sharding, lakehouse orchestration, or production S3 infrastructure before
  single-node semantic and restart conformance is complete.
- Rebuilding Actor, Workflow, web, Presentation, or the generic compiler.

## Progress Log

- 2026-07-29: Established the North Star, audited existing responsibility
  overlap, recorded primary-source constraints, selected the canonical slice,
  and sequenced the migration around focused gates.
- 2026-07-29: Added the first Actor-backed Aggregate implementation and compile
  fixture. Demonstrated portable lowering with no compiler special case,
  command/read authorization, one-event idempotency, retained state across
  runtime restart, and two-edge historical event migration. The ordinary Actor
  source suite remains green. EventStore global ordering and a factory-authored
  pure testing surface remain open before Aggregate is considered complete.
- 2026-07-29: Completed the semantic vertical slice. Added global EventStore
  cursors and old-schema migration, property-based Aggregate replay,
  checkpointed Projection queries, Replica migration/reconciliation, and the
  authenticated company-operations composition with Workflow compensation.
- 2026-07-29: Browser verification covered sign-up, create, edit without focus
  loss, completion, hard reload, persisted styling, and HMR. Production
  verification covered generated Rust, explicit local JetStream provisioning,
  Identity and Aggregate persistence, authorization failure, and restart.
- 2026-07-29: Production differential testing found and fixed three shared
  issues: Rust `Error` inheritance, feature-local Navigation contracts sharing
  one stable host wire contract, and helper-hidden Projection reference
  dispatch. Replica schema fingerprints now retain full command definitions.
- 2026-07-29: Canonical composition found and fixed missing default Workflow
  start policies, then proved synchronized Replica admission rather than merely
  checking eventual rows. Selective generic-parameter resolution retained
  Replica command fields without reintroducing the compiler memory regression.
- 2026-07-29: The complete production gate now realizes release-declared
  services through the local Deployment adapter. It found and fixed public
  `Host` loss at the local gateway, preserves stable gateway locations during
  adapter upgrades, and exercises authenticated CRUD exclusively through the
  stable public production interface across a Rust Process restart.
- 2026-07-29: `nub run check` passed in full: source, Workflow semantics and
  versioned IR, generic compiler and generated-Rust differentials, provider and
  native workspace contracts, one package build, examples, distribution, and
  focused release production. Entity/Data physical-provider migration remains
  intentionally deferred until its unique Turso behavior has a narrower
  contract.
