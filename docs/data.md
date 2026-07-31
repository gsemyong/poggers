# Data

## North Star

Kit provides one semantic, type-safe Data Feature factory for transactional,
local-first, searchable, and analytical application state.

The user-visible mutation path is synchronous:

```text
interaction
  -> validate portable input
  -> create stable invocation identity
  -> update the in-memory reactive model
  -> notify the UI
```

Local durability, authoritative admission, replication, projection maintenance,
and analytics continue in ordered background stages. None may delay the first
observable state update.

The universal substrate remains Program, Dependency, and Feature. Data is an
optional reusable Feature factory assembled from Actor, Aggregate, Projection,
and Replica. The generic TypeScript-to-Rust compiler has no Data-specific
lowering.

## Research Basis And Decisions

This design follows the common invariants of mature event-sourced actor and
local-first systems while keeping provider choices replaceable:

- [Akka Event Sourcing][akka-event-sourcing] and
  [Orleans log-consistency providers][orleans-log-consistency] establish the
  per-identity single-writer model, compare-and-append versioning, atomic event
  batches, deterministic replay, and snapshots as recovery acceleration.
- [Akka Projection][akka-projection] and
  [Axon streaming event processors][axon-streaming] and
  [Marten's async projection daemon][marten-projections] establish independent
  resumable consumers, partition claims, lag/high-water observability, and
  restart from retained offsets. [Kurrent's projection engine][kurrent-projections]
  persists state and checkpoint in one multi-stream write. A materialized
  change is exactly-once relative to its own database only when the change and
  checkpoint share one transaction. Otherwise delivery is at-least-once and
  the reducer/provider must be idempotent.
- [Axon event upcasting][axon-upcasting] and
  [Akka schema evolution][akka-schema-evolution] establish immutable history
  plus explicit adjacent evolution into the current semantic representation.
  Stored events are not rewritten as an ordinary deployment operation.
- [Replicache's sync model][replicache-sync] and
  [Zero mutators][zero-mutators] establish the authoritative local-first model:
  apply a deterministic mutation immediately, retain stable mutation identity,
  admit it transactionally and idempotently at the server, replace the
  authoritative base, discard acknowledged local intent, and replay the
  remaining ordered intent before atomically publishing the rebased view.
- [PowerSync consistency][powersync-consistency] establishes atomic checkpoints
  across a downloaded change set and a durable local upload queue.
  [The PowerSync protocol][powersync-protocol] additionally demonstrates
  resumable bucket cursors, integrity checks, history compaction, and write
  checkpoints that distinguish upload admission from downstream observation.
  [Electric shapes][electric-shapes] establish explicit, authorized partial
  replication rather than assuming every client can hold the complete model.
- [Automerge repositories][automerge-repositories] demonstrate that CRDT
  replication has different semantics: storage and network adapters exchange
  convergent changes between peers. It is not a transparent implementation of
  an authoritative command model.
- [Jazz migrations][jazz-migrations] demonstrate why offline clients require
  addressable schema versions and composable migration edges rather than a
  one-time destructive row rewrite.

These sources support the following first-principles decisions:

1. One Aggregate key is one authoritative consistency boundary and event
   stream. It is not a relational table and does not promise cross-key ACID.
2. Events are immutable domain facts. Event application is total, deterministic,
   and effect-free. Command admission may fail; replay may not.
3. External effects are represented by durable typed intent committed with the
   Aggregate decision, then dispatched outside the exclusive Actor turn with
   stable identity and idempotent, fenced completion.
4. A Projection is disposable derived state. It owns a versioned checkpoint,
   can be rebuilt into a new physical version, and never becomes a write
   authority.
5. An authoritative Replica stores two logical layers: the latest server base
   and an ordered pending-intent log. The visible model is their deterministic
   composition. Reconciliation replaces or advances the base and replays
   pending intent; it does not merge arbitrary object snapshots.
6. Aggregate admission and Projection observation are different facts. A
   successful command response never fabricates a Projection acknowledgement.
   The Replica retires a prediction only after the authorized Projection has
   observed that invocation, or after receiving an authoritative snapshot
   whose checkpoint is explicitly guaranteed to include it.
7. A convergent Replica must name its merge algebra explicitly. CRDT operations
   are retained facts and do not pass through authoritative rollback/rebase
   semantics.
8. Operational query indexes and analytical materializations consume committed
   events asynchronously. Neither belongs in the Aggregate command hot path.
9. Transport provides ordered, resumable, bounded envelopes; it does not define
   application consistency. WebSocket, WebTransport, in-process, and future
   transports implement the same Replication Dependency.
10. Multiple browser contexts sharing one Replica use a transactional local
    outbox and one scoped drain owner. Store notifications distribute durable
    progress; they do not turn `BroadcastChannel` into a source of truth.

### Industry alignment ledger

The implementation is judged against semantic guarantees, not against the
surface vocabulary of any one framework:

| Concern                          | Established pattern                                                                                                                                         | Kit rule                                                                                                                                                          | Required evidence                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Aggregate identity               | Akka persistence identity and Orleans grain identity define one durable ordered history per stable key.                                                     | `Aggregate type + key` identifies exactly one Actor-backed event stream.                                                                                          | Concurrent commands for one key serialize; unrelated keys progress independently.                                                          |
| Command commit                   | Akka atomically persists the events emitted by one command; Orleans custom storage uses expected-version compare-and-append.                                | Events, outcome, invocation identity, and outbound intent produced by one command share one append boundary.                                                      | Crash and duplicate-command tests recover one outcome without duplicate domain events.                                                     |
| Recovery                         | Event-sourced actors replay immutable history; snapshots only shorten recovery.                                                                             | State is reconstructed by deterministic adjacent upcasting and event application after the latest valid snapshot.                                                 | Full replay and snapshot-plus-tail produce byte-equivalent current state.                                                                  |
| External effects                 | Event-sourced actor systems persist delivery intent and tolerate retry rather than claiming distributed exactly-once execution.                             | Typed outbound intent commits with Actor history, dispatches outside the exclusive turn, and completes through a fenced idempotent identity.                      | Crashes before dispatch, after provider completion, and before result delivery preserve one logical invocation.                            |
| Projection progress              | Akka, Axon, and Marten use durable offsets/tokens, leases or claims, and replayable processors.                                                             | A Projection version owns durable source cursors; competing runners use compare-and-set, reload the winner, and resume.                                           | Restart, stale claim, contention, and rebuild tests never skip committed events.                                                           |
| Projection exactness             | Akka Projection scopes exactly-once to one transaction containing both read-model updates and offset.                                                       | Row mutations and cursor commit atomically inside one `ProjectionStore`; all external work remains at-least-once and idempotent.                                  | Every provider passes the same crash-boundary and duplicate-delivery corpus.                                                               |
| Event evolution                  | Axon upcasters and Akka schema evolution retain old events and translate them while reading.                                                                | Stored event versions are immutable; explicit adjacent migrations produce current portable meaning.                                                               | Old histories replay through every supported version; missing or ambiguous edges fail deterministically.                                   |
| Authoritative local-first writes | Replicache and Zero run deterministic local mutations immediately, record stable mutation identity, then rebase pending mutations over authoritative state. | The reactive in-memory state changes synchronously; durable pending intent and server reconciliation run afterward.                                               | Subscriber notification precedes storage and network; rejection or authority advancement deterministically rebases every remaining intent. |
| Consistent partial sync          | PowerSync checkpoints and Electric shapes publish authorized subsets only at coherent boundaries.                                                           | Replication envelopes carry an opaque cursor, Projection observations, authorized row changes, and invocation observations.                                       | Interrupted streams resume incrementally; no client sees a partially applied authoritative checkpoint.                                     |
| Multi-context local durability   | Browser-local systems use a transactional durable store plus a coordination channel; the notification channel is not durable state.                         | IndexedDB is authoritative for pending intent and rows; one scoped owner drains it while every tab reloads durable progress.                                      | Simultaneous tabs, owner loss, reload, and duplicate notification converge without stranding intent.                                       |
| Convergent collaboration         | Automerge separates CRDT document semantics from replaceable storage and transport repositories.                                                            | `convergent` Data must declare a merge algebra and causal identity; it never reuses authoritative rollback/rebase semantics.                                      | Peer-order permutations converge to the same value and retain every accepted causal operation.                                             |
| Offline schema evolution         | Jazz preserves addressable schema versions and composes migration lenses because old clients remain active.                                                 | Data versions and adjacent migrations remain addressable across the supported compatibility window; destructive in-place rewrites are not the only recovery path. | Old and new clients can read, write, disconnect, reconnect, and cross the supported version window.                                        |

The ledger deliberately rejects a general “exactly once” claim. Exactly-once
materialization is meaningful only inside one atomic provider transaction.
Across a network or external provider the contract is stable identity,
at-least-once delivery, idempotent admission/completion, and observable retry.

### Three distinct histories

The implementation deliberately keeps three histories separate:

| History                    | Authority                     | Purpose                                                        | May be discarded                                                           |
| -------------------------- | ----------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Aggregate event stream     | one Actor key                 | domain truth, replay, audit, command idempotency               | no, except by an explicit retention policy that preserves required meaning |
| Projection revision log    | one Projection version        | resumable materialization and incremental replication          | yes, after its checkpoint/snapshot window                                  |
| Replica pending-intent log | one authorized client replica | immediate local prediction until authoritative acknowledgement | yes, only after acknowledgement, rejection, or explicit user resolution    |

An Aggregate event is not a replication packet. A Projection revision is not a
domain fact. A pending client command is not authoritative history. Keeping
these roles distinct is what makes each layer independently replaceable and
prevents transport retries from becoming duplicate business events.

### Determinism boundary

The portable synchronous kernel consists of command decision, event
application, Projection reduction, query authorization, and optimistic replay.
These functions receive immutable data and no Dependencies. They must be total
where replay invokes them and deterministic for the same input.

Authority-only admission may await authorization or other declared
Dependencies before committing a decision. External effects are durable typed
intent committed with Actor state, then dispatched after the exclusive turn.
Projection I/O, Replica persistence, replication, authentication ceremonies,
and analytics are provider work and therefore asynchronous.

## Ownership

### Aggregate

An Aggregate is one event-sourced consistency boundary:

- one key has one total write order;
- a command reads immutable state and emits typed events plus a result;
- emitted events and the command outcome commit atomically;
- event application and migration are deterministic and effect-free;
- command admission has a stable idempotency identity;
- snapshots accelerate recovery without replacing event history;
- external effects occur only through durable outbound intent or Workflow.

One Aggregate command is the strongest transactional unit. Cross-Aggregate
coordination belongs to Workflow or a saga. Workloads requiring arbitrary
multi-row ACID use a specialized transactional Dependency rather than pretending
that distributed Aggregate writes are atomic.

### Projection

A Projection is a rebuildable read model:

- it consumes typed event sources from retained cursors;
- its reducer is deterministic and effect-free;
- materialized row changes and the consumed cursor commit atomically;
- competing runners acquire or compare durable progress, and a lost checkpoint
  race reloads the winner before resuming rather than failing the Projection;
- queries are expressed through typed semantic families, not SQL;
- operational and analytical providers may realize the same declared meaning
  with different physical layouts;
- projection version changes rebuild or migrate explicitly.

### Replica

A Replica is the client-owned local view:

- the in-memory model is the synchronous rendering authority;
- accepted local intent is queued durably without blocking publication;
- a local database stores materialized rows, indexes, cursors, pending intent,
  and rejection details;
- reactive local queries never require a network round trip;
- background replication resumes from opaque cursors and transfers only
  incremental changes after the initial snapshot;
- command delivery is idempotent and retryable;
- aggregate admission does not retire local prediction before Projection
  observation;
- reconnect, cross-tab coordination, authorization changes, rebase, and schema
  compatibility are explicit behavior.

The current `createData` and Replica implementation is deliberately
`authoritative`: local changes are predictions that the authority may reject or
rebase. It does not pretend to provide convergent peer collaboration.

A future collaborative Data factory or explicit consistency profile may add
`convergent` semantics only when a concrete workload requires them. Such a
model must declare its causal identity and merge algebra, retain local changes
as durable history, and pass convergence tests across operation permutations.
It must not reuse the authoritative rollback/rebase contract or silently add
CRDT metadata to ordinary application records.

### Workflow

Workflow coordinates durable work across Aggregate and Dependency boundaries.
It owns retries, timers, cancellation, compensation, parallelism, and long-lived
progress. It does not become a query store or a second write authority.

### Identity and authorization

Authentication proves an external identity. Authorization produces the typed,
application-specific Principal used by Data, Workflow, and every other semantic
Dependency. They are separate responsibilities.

The built-in authentication ceremony is one small email/password and opaque
database-session provider implemented directly over host SQLite and secure
password hashing in TypeScript and Rust. It adds no third-party authentication
runtime to the application compiler graph. After that ceremony, both
realizations issue and verify the same semantic short-lived application
credential through `IdentityCredentials`; Data does not consume the
authentication session directly. The credential realization uses Ed25519, an
explicit `at+jwt` kind, versioned key identifiers, bounded verification-key
overlap, refresh rotation, and a polled revocation authority. TypeScript and
Rust pass the same semantic provider suites.

The target Identity contract is:

- an authentication provider handles password, passkey, OAuth, OIDC, or another
  external login ceremony;
- Identity derives one typed application Principal at credential issue or
  refresh time;
- a replaceable credential Dependency issues, verifies, refreshes, and revokes
  short-lived application credentials;
- every server replica verifies signature, issuer, audience, expiry, and
  credential kind locally without a database read on the request path;
- credentials carry stable subject and session identity, a token identity, an
  authorization-policy version, and only bounded coarse application claims;
- volatile row ACLs and large membership lists do not live in the credential;
  Data command authorization and Projection/Replica read filtering remain
  authoritative;
- policy and session revocation propagate to a bounded verifier cache, while
  short credential lifetime bounds any missed invalidation;
- refresh rotates credentials and the web adapter refreshes its persistent
  connection without recreating the same user's local Replica;
- a subject, audience, or authorization-version change creates a new Replica
  authorization generation, fences pending work, and removes rows that are no
  longer visible;
- browser credentials use secure HttpOnly SameSite cookies; native clients use
  platform secure storage. ID tokens from an OIDC provider are never used as
  application API access tokens.

The wire format may be the RFC 9068 JWT access-token profile, but JWT is a
provider realization, not the public Identity vocabulary. Asymmetric signing
and versioned public keys are preferred for multi-node verification; a shared
secret implementation is acceptable only as an explicit local/development
provider. Any future OAuth browser or native provider must use authorization
code plus PKCE and remain behind `AuthenticationBackend`.

Local persistence is partitioned by System, Application, Replica, stable
subject, and authorization scope. Retaining signed-out data is an explicit
product privacy policy; sign-out always detaches it from the active reactive
model immediately.

### Data

`createData<Model>()` is the application-facing composite factory. Its generic
model declares:

- identity and principal;
- Aggregate keys, state, commands, events, and event history;
- Projection rows and typed query capabilities;
- Replica scope and consistency policy;
- authorization;
- schema versions and adjacent migrations;
- optional analytical materializations.

Its implementation supplies only behavior erased from the type declaration:

- initial state;
- command decisions;
- event application;
- projection reduction;
- authorization predicates;
- migrations that cannot be inferred.

`createData` returns one ordinary Feature and one semantic Dependency surface.
It does not add a composition tree, compiler registry, runtime service locator,
provider syntax, or alternate advanced API.

## Dependency Contracts

Product meaning depends only on semantic contracts:

| Dependency            | Semantic responsibility                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `EventStore`          | compare-and-append, ordered read/feed, snapshots, compaction            |
| `ProjectionStore`     | atomic row changes plus cursor, typed query execution, rebuild          |
| `ReplicaStore`        | local rows, indexes, cursor, outbox, rejection, schema version          |
| `Replication`         | snapshot, incremental pull, change stream, upload, resume               |
| `IdentityCredentials` | issue, locally verify, rotate, and revoke typed application credentials |
| `ObjectStore`         | immutable or versioned large-object storage                             |
| `AnalyticsStore`      | append/materialize/query analytical datasets                            |

Providers own transport, database, indexing, batching, compression, connection
pooling, and deployment requirements. Feature code contains no SQL, database
URLs, WebSocket paths, NATS subjects, Turso calls, DuckDB calls, or provider
selection.

The existing `HttpClient`, `HttpServer`, `LocalStore`, and `EventStore`
implementations remain foundations during migration. Replica must stop owning
HTTP paths and response framing once the semantic Replication contract is
available.

## Physical Realizations

The currently implemented matrix is:

| Role                  | Development                        | Browser                          | Production server   |
| --------------------- | ---------------------------------- | -------------------------------- | ------------------- |
| events                | memory or SQLite                   | not authoritative                | SQLite or JetStream |
| operational queries   | memory or indexed SQLite           | lazy Turso WASM query mirror     | indexed SQLite      |
| replica durability    | memory fixture                     | IndexedDB                        | not applicable      |
| replication transport | in-process fixture                 | web adapter stream               | web/server adapter  |
| compact analytics     | hash aggregation or indexed SQLite | hash aggregation over local rows | indexed SQLite      |
| columnar analytics    | not implemented                    | intentionally delegated          | not implemented     |

NATS/JetStream is one replaceable distributed EventStore and process provider.
The browser Replica deliberately keeps its authoritative outbox in IndexedDB:
unlike one [OPFS database handle][sqlite-wasm-persistence], IndexedDB provides
atomic transactions shared across tabs without an exclusive database-file
owner. [Turso Database WASM][turso-browser], the Rust Turso Database rather
than libSQL, is a disposable query mirror. It loads only when an authenticated
Replica first performs a text or vector query and rebuilds from the current
immutable in-memory row revision. It never owns pending intent, cursors, or
cross-tab durability.

The published Turso browser binary supports exact vector functions but excludes
Tantivy because Turso's `fts` Rust dependency is not compiled for WASM. The
browser provider therefore maintains a normalized inverted-term relation inside
Turso and executes indexed term lookup through the Rust database; it does not
silently scan rows in JavaScript. Vector values use Turso `vector32` storage and
`vector_distance_cos`. The same semantic reference corpus fixes token,
selection, scoring, and vector-order behavior independently of that physical
choice.

Indexed SQLite provides relational, token text, compact vector, recursive
graph, bounded geo, and compact aggregate execution on the server. Browser
graph and geo queries retain revision-scoped indexes, while compact analytics
uses linear hash aggregation rather than a quadratic group search. Exact
vector ranking remains linear because replacing it with approximate
nearest-neighbor search would change declared meaning. A future indexed vector
provider may replace that physical execution without changing the API.

Large historical analytics is deliberately not in the current realization. A
measured workload that exceeds compact indexed SQLite should add asynchronous
columnar Parquet materialization plus [DuckDB filter/projection
pushdown][duckdb-parquet] behind `AnalyticsStore`, never in the Aggregate,
Replica, first-load browser bundle, or replication hot path.

Development runs authored TypeScript with hot replacement. Production lowers
the same portable behavior through the generic TypeScript-to-Rust compiler.
Only provider implementations that require native libraries contain Rust.

## Performance Contract

### Interaction

- The subscriber observing an optimistic mutation runs in the same JavaScript
  turn as command admission.
- No storage, serialization, fetch, socket, timer, or Promise resolution occurs
  before publication.
- Commands affecting independent keys do not serialize behind one global queue.
- Repeated commands preserve their own invocation identities.

### Local persistence

- Writes are append or row-level changes, not whole-state rewrites.
- Pending intent and the local materialization commit in one local transaction.
- Persistence runs in a worker when the provider supports it.
- Writes are coalesced without losing invocation boundaries.
- Restart reconstructs the same visible state before network synchronization.

### Replication

- One long-lived connection multiplexes logical replicas.
- Initial synchronization transfers a bounded snapshot and cursor.
- Subsequent synchronization transfers only events or materialized changes
  after that cursor.
- Upload and download are independently backpressured.
- Payloads are bounded, versioned, and measurable.
- Reconnect resumes rather than restarting from an empty cursor.

### Authority

- Aggregate routing is by stable key.
- One key has one exclusive write turn; unrelated keys execute concurrently.
- Event append and outcome are atomic and idempotent.
- Snapshots are created by policy and do not enter the command hot path unless
  recovery needs them.

### Projection and analytics

- Projection workers consume batches.
- Row mutations and cursor updates share one provider transaction.
- Operational queries use indexes selected from the semantic declaration.
- Full-text, vector, graph, geo, and aggregate query families never fall back to
  complete in-memory scans in a production provider.
- Analytical ingestion is asynchronous and columnar; it never blocks
  transactional admission or replication.

## Verification Strategy

Fast tests use deterministic TypeScript fixtures. Provider conformance is
authored once and run against each implementation. Native builds occur only
when a native provider, portable lowering, or production artifact changes.

Required evidence:

- subscriber notification occurs before local persistence begins;
- storage latency and network latency do not change optimistic publication;
- rapid repeated commands retain every intent in order;
- restart after publication but before upload restores pending state;
- lost responses and duplicate uploads produce one authoritative outcome;
- reconnect resumes from the retained cursor and sends no full snapshot;
- two tabs converge and do not strand one tab in an empty state;
- authorization changes remove inaccessible rows and fence pending intent;
- forged, expired, wrong-issuer, wrong-audience, revoked, and stale-policy
  credentials are rejected identically by TypeScript and Rust verifiers;
- ordinary authenticated requests verify locally on multiple nodes without a
  session-database read;
- key rotation accepts the bounded overlap and rejects retired keys;
- OAuth code/PKCE login, token refresh, sign-out, immediate sign-in, and
  persistent-connection rotation preserve one coherent Replica generation;
- a policy-version change retracts newly unauthorized rows and rejects or
  rebases stale offline intent;
- projection row changes and cursors survive every injected crash boundary;
- rebuilding a Projection from events produces byte-equivalent rows;
- SQLite and JetStream satisfy the same EventStore contract;
- every ProjectionStore provider satisfies the same semantic query corpus;
- TypeScript development and generated Rust produce equivalent Aggregate
  events, outcomes, Projection mutations, and replication envelopes;
- browser interaction-to-paint stays within one frame under the representative
  workload;
- payload, allocation, query, and synchronization regressions have explicit
  bounds.

## Living Plan

### 1. Baseline and freeze current guarantees

- [x] Inventory Aggregate, Projection, Replica, EventStore, web transport, and
      provider ownership.
- [x] Confirm optimistic Replica state is published synchronously.
- [x] Confirm the web adapter already multiplexes Replica HTTP semantics over
      one WebSocket.
- [x] Record warm baseline: root TypeScript check `0.37s`.
- [x] Record warm baseline: Aggregate, Projection, and Replica source suite
      `9.04s` wall time.
- [x] Add a subscriber-before-storage admission baseline.
- [x] Add focused payload, restart, and duplicate-delivery baselines.

Gate: current passing semantic tests remain unchanged before contract migration.

### 2. Harden write and read-model semantics

- [x] Remove effectful Dependencies from Aggregate event application and
      Projection reduction.
- [x] Separate authority-only command validation from portable deterministic
      decision logic.
- [x] Define `ProjectionStore` and its reusable TypeScript conformance suite.
- [x] Commit Projection changes and source cursor through one ProjectionStore
      operation.
- [x] Reload and resume after a competing Projection runner wins the durable
      checkpoint compare-and-set.
- [x] Retain the current in-memory implementation as a reference provider.

Gate: deterministic replay, crash-boundary, idempotency, and provider
conformance tests pass without browser or Cargo.

### 3. Optimize Replica admission and durability

- [x] Split synchronous in-memory admission from asynchronous durability status.
- [x] Persist row-level materialization and pending intent atomically.
- [x] Coalesce background writes while retaining every invocation.
- [x] Restore visible state and pending intent before starting replication.
- [x] Add cross-tab ownership and notification without duplicate uploads.

Gate: subscriber-before-storage, delayed-storage, rapid-input, restart, and
multi-tab tests pass.

### 4. Isolate replication semantics

- [x] Complete the typed Replication Dependency conformance suite.
- [x] Move snapshot, incremental change, command upload, stream, retry, and
      resume semantics out of HTTP handlers.
- [x] Keep WebSocket, fetch fallback, and future transports inside the web
      adapter.
- [x] Bound frames and record transferred bytes in tests.
- [x] Preserve one logical invocation identity through reconnect and retry.

Gate: the Replica factory imports no web transport contract; in-process and web
providers pass the same failure corpus.

### 5. Add the Data factory

- [x] Define the generic Data model and inferred public Dependency API.
- [x] Author each deterministic command/event transition once and reuse it for
      authority and optimistic prediction.
- [x] Require an explicit prediction only when an authority-only Dependency
      makes exact local execution impossible.
- [x] Compose internal Aggregate, Projection, and Replica Features.
- [x] Infer names and schemas without duplicated runtime strings.
- [x] Add adjacent versioned state, event, command, projection, and replica
      migrations.

Gate: type fixtures reject duplicate, incomplete, incompatible, and unsafe
models; the implementation lowers to ordinary Feature/Program/Dependency
meaning with no Data IR.

### 6. Add optimized providers

- [x] Add a transactional indexed SQLite ProjectionStore development provider.
- [x] Add a lazy Rust Turso Database query mirror over immutable Replica row
      revisions while retaining IndexedDB as ReplicaStore authority and keeping
      WASM out of unauthenticated, static, and initial application loading.
- [x] Implement declared relational, full-text, vector, graph, geo, and compact
      analytical query capabilities without complete production JSON scans.
- [x] Keep columnar DuckDB/object-store analytics behind `AnalyticsStore` as an
      explicit measured-workload extension rather than adding an unused heavy
      provider to the current application path.
- [x] Package indexed SQLite deployment requirements beside its provider
      implementation.

Gate: the shared provider corpus passes for reference and optimized providers;
query plans and representative latency/size budgets are recorded.

### 7. Prove one complete vertical application

- [x] Migrate authenticated CRUD to `createData`.
- [x] Remove duplicated authoritative and optimistic task reducers.
- [x] Exercise authentication, immediate offline optimistic mutation, reconnect,
      rapid mutation, and multi-tab convergence.
- [x] Exercise full-text search, vector search, and compact analytics against
      the browser-local view.
- [x] Exercise Workflow coordination from the vertical browser/system path.
- [x] Verify disconnected document reload through the explicit PWA preview,
      including retained identity, IndexedDB task rows, styles, and automatic
      transport recovery after reconnect.
- [x] Verify development HMR retains local state.
- [x] Verify generated-Rust production behavior and restart.
- [x] Verify the browser visually and inspect network payloads.

Gate: no loading state appears when valid local state exists; all mutations are
immediately visible; background synchronization converges every client.

Current web gate: the ordinary development mode deliberately leaves the
service worker disabled so source changes cannot be hidden by an application
cache. Disconnected document reload must therefore be verified through the
explicit PWA preview and the production artifact, where shell caching belongs.
That concern remains in the web/PWA realization and must not move into Data.

Current vertical evidence: the same system contract verifies unauthenticated
rejection, an incomplete-Task Workflow failure, successful completion
verification, idempotent retry, persistence, and restart in both the TypeScript
development realization and generated-Rust release realization. Browser
inspection verified immediate local create/toggle rendering and an
authoritative Workflow result. Each observed toggle emitted one 260-byte
WebSocket request frame with a 45-byte command body; Workflow verification
emitted one 278-byte frame with a 49-byte body. No interaction sent a snapshot
array or duplicate request.

### 8. Make Identity scalable and local-first safe

- [x] Separate external authentication from typed application authorization.
- [x] Define the semantic `IdentityCredentials` Dependency and one conformance
      suite for issue, verify, audience scoping, tamper rejection, and revoke.
- [x] Derive bounded application Principal claims once per issue/refresh, with
      explicit audience and authorization-policy version.
- [x] Add equivalent TypeScript and Rust credential providers with local verification
      and a shared differential credential corpus.
- [x] Replace the local symmetric realization with asymmetric signed access
      credentials, versioned keys, bounded overlap, and shared revocation.
- [x] Add provider conformance for credential refresh and key rotation.
- [x] Keep external login ceremonies behind `AuthenticationBackend`; the
      built-in password/session provider adds no OAuth vocabulary to Identity,
      Data, or the application API.
- [x] Scope Replica persistence by subject and authorization context; define
      retain, encrypt, or delete-on-sign-out privacy policy.
- [x] Propagate session/policy revocation, rotate live transport credentials,
      retract unauthorized rows, and fence stale pending commands.
- [x] Prove independent server-provider processes verify without querying the
      session database and observe revocation through one configured authority.
      Gate: TypeScript and Rust reject the same malformed and unauthorized corpus;
      two generated-Rust provider processes verify a valid credential locally;
      revocation and policy changes converge every connected Replica; rapid
      sign-out/sign-in permits an immediate optimistic action without stale
      authority. A shared SQLite file is sufficient evidence for local deployment
      replicas, but is not presented as a multi-machine revocation service.

OAuth/OIDC authorization-code plus PKCE and a selected remote multi-machine
revocation authority remain explicit Identity/deployment provider work. They
must reuse these contracts and provider suites; they do not block the Data
factory, local-first semantics, or the demonstrated single-machine production
topology.

### 9. Stabilize and close

- [x] Run focused type and source gates after each owning milestone.
- [x] Run browser gates only after Replica/web changes stabilize.
- [x] Run compiler/Rust differential gates only after portable meaning changes.
- [x] Run the complete repository gate once.
- [x] Keep HTTP/WebSocket protocol details inside the private `Replication`
      provider realization; transfer a snapshot only for initial hydration and
      incremental changes after its cursor.
- [x] Review dependency direction, public API duplication, documentation, and
      generated artifact size.

Current artifact evidence for authenticated CRUD:

- the content-addressed compiler cache stores Brotli-compressed, hash-verified
  objects and fell from 127 MB of retained JSON to 1.4 MB for one exact
  revision;
- the 11.7 MB transient assembled System IR occupies 361 KB in that cache, and
  an exact development restart restores all 22 Feature units in about 200 ms;
- removing the third-party authentication runtime reduced the semantic
  TypeScript graph from 709 to 175 source files;
- the critical production application entry is 255 KB raw and 64 KB gzip; the
  authenticated query path adds 201 KB of JavaScript, a 169 KB worker, and an
  11.1 MB Turso WASM artifact only after the first non-empty text or vector
  query;
- Turso JavaScript, its worker, and its WASM are absent from static and
  unauthenticated document preloads, service-worker precache, and background
  route warming; the worker and WASM remain cacheable immutable assets after
  their first requested use;
- generated-Rust release behavior passes the same black-box system contract,
  including authentication, incremental replication, Workflow coordination,
  persistence, and process restart.

Completion requires passing evidence for every gate. Type checking alone is not
completion.

## Non-Goals

- no universal database engine inside core;
- no SQL or provider-specific public API;
- no claim that optimistic authority and CRDT convergence are equivalent;
- no distributed multi-Aggregate ACID abstraction;
- no synchronous persistence or networking on the interaction path;
- no ID token used as an application access token;
- no unbounded or frequently changing row ACL embedded in a credential;
- no database lookup on every ordinary authenticated request;
- no Data-specific compiler or Rust lowering;
- no second advanced API exposing Aggregate, Projection, and Replica wiring;
- no release build in the ordinary application edit loop.

[akka-event-sourcing]: https://doc.akka.io/libraries/akka-core/current/typed/persistence.html
[akka-projection]: https://doc.akka.io/libraries/akka-projection/current/r2dbc.html
[akka-schema-evolution]: https://doc.akka.io/libraries/akka-core/current/persistence-schema-evolution.html
[automerge-repositories]: https://automerge.org/docs/reference/repositories/
[axon-streaming]: https://docs.axoniq.io/axon-framework-reference/4.12/events/event-processors/streaming/
[axon-upcasting]: https://docs.axoniq.io/axon-framework-reference/main/events/event-versioning/
[electric-shapes]: https://legacy.electric-sql.com/docs/usage/data-access/shapes
[jazz-migrations]: https://jazz.tools/docs/schemas/migrations
[kurrent-projections]: https://docs.kurrent.io/server/v26.1/features/projections/engine-v2
[marten-projections]: https://martendb.io/events/projections/async-daemon.html
[orleans-log-consistency]: https://learn.microsoft.com/en-us/dotnet/orleans/grains/event-sourcing/log-consistency-providers
[powersync-consistency]: https://docs.powersync.com/architecture/consistency
[powersync-protocol]: https://docs.powersync.com/architecture/powersync-protocol
[replicache-sync]: https://doc.replicache.dev/concepts/how-it-works
[sqlite-wasm-persistence]: https://sqlite.org/wasm/doc/tip/persistence.md
[turso-browser]: https://turso.tech/blog/introducing-turso-in-the-browser
[duckdb-parquet]: https://duckdb.org/docs/stable/data/parquet/overview
[zero-mutators]: https://zero.rocicorp.dev/docs/mutators
