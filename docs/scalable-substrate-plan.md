# Scalable substrate implementation plan

Status: complete

This living document is the source of truth for replacing Poggers' single-process
`Journal` boundary with an adapter-neutral substrate that remains simple on one
node and has the semantics required for correct multi-core and horizontal
execution. Checkboxes record verified evidence, not attempted work. A phase is
complete only when its gate passes.

## Goal

Make Resources and Programs independent of storage, messaging, and deployment
technology while preserving one precise application model:

- Resources are the consistency, ordering, synchronization, and authorization
  boundary.
- Commands append decisions atomically and are idempotent by stable intent.
- Committed events form a replayable source for durable Programs.
- Programs are at least once, ordered by an explicit semantic key, restartable,
  cancellable, backpressured, and relocatable.
- A single-node adapter and a future clustered adapter implement the same laws.
- Physical storage maintenance is entirely adapter-private.
- Logical history loss is explicit and can never silently corrupt a Resource or
  Program.
- Application code never names SQLite, WAL, `VACUUM`, files, source splits,
  storage shards, leases, workers, or numeric storage offsets.

The completed work must support correct compaction, worker failover,
rebalancing, and repartitioning without promising a production cluster adapter
that has not itself passed the same contract suite.

## Fixed principles

- [x] One public substrate adapter enters each host. Its internal contracts may
      be narrow, but applications never assemble storage infrastructure.
- [x] Product contracts describe meaning; deployments describe desired
      placement; adapters select physical mechanisms.
- [x] Resource ordering is fundamental. Cross-Resource total ordering is not
      promised.
- [x] A committed event has stable identity independent of its source cursor.
- [x] Source cursors are opaque, serializable, scoped to one source split, and
      compared only by the adapter that created them.
- [x] At-least-once delivery is explicit. Arbitrary external effects are never
      described as exactly once.
- [x] Default Program ordering is by Resource address. A custom key is semantic,
      versioned, and distinct from storage partitioning.
- [x] Runtime allocation uses stable key groups. Worker count and storage shard
      count never change application semantics.
- [x] Physical compaction preserves the logical stream and is invisible.
- [x] Logical retention exposes retained bounds and an explicit expired-cursor
      result.
- [x] Resource heads and permanent command receipts survive event reclamation.
- [x] Resource snapshots accelerate recovery but do not substitute for arbitrary
      Program history.
- [x] No compatibility aliases or parallel public legacy runtime remain after
      migration.
- [x] Unsupported topology fails during host validation instead of degrading
      silently.

## Terminology

| Concept                  | Meaning                                                               | Owner                  |
| ------------------------ | --------------------------------------------------------------------- | ---------------------- |
| Resource address         | Consistency, synchronization, authorization, and default ordering key | Application/kernel     |
| Resource revision        | Monotonic version within one Resource address                         | Authority              |
| Committed event identity | Stable Resource address, revision, and event index                    | Authority              |
| Program key              | Semantic serial-execution key, defaulting to Resource address         | Program definition     |
| Key group                | Stable allocation bucket containing many Program keys                 | Runtime                |
| Source split             | Independently readable portion of the committed-event source          | Adapter                |
| Source cursor            | Opaque location within one source split                               | Adapter                |
| Assignment               | Ownership of source/key-group work by one Program instance            | Coordinator            |
| Fence                    | Monotonic assignment epoch rejecting stale ownership writes           | Coordinator/progress   |
| Storage shard            | Physical storage or replication unit                                  | Adapter implementation |
| Retained floor           | Earliest cursor still readable in one source split                    | Adapter                |

The terms partition, position, revision, and epoch must not be overloaded across
these meanings.

## Target application surface

Durable event Programs are named definitions so the compiler and host can know
their source and ordering semantics before user code runs:

```ts
programs: {
  server: {
    updateSearch: {
      source: {
        events: ["documents.created", "documents.changed"],
        replay: "all",
        keyBy: "resource",
      },
      async handle({ event, api, resources, delivery, signal }, dependencies) {
        // Unrestricted TypeScript for one durable delivery.
      },
    },
    async serve({ api, resources, signal }, dependencies) {
      // An unrestricted lifecycle-managed service Program.
    },
  },
}
```

Rules:

- A Program's canonical durable identity is its mounted manifest path.
- `source.events` is a non-empty typed tuple.
- `source.replay` is `"all"` or `"new"` and is consulted only on first
  registration.
- `source.keyBy` defaults to `"resource"`. A custom function requires a positive
  `keyVersion`; changing it requires an explicit progress migration.
- `handle` completion is the sole acknowledgment boundary.
- Delivery exposes stable identity, attempt, uncertainty, and an idempotency-key
  operation, but no source split or cursor.
- Service Programs remain unrestricted functions. Their placement/cardinality
  is deployment policy unless the semantics explicitly require a singleton.
- Application code does not configure concurrency, workers, leases, source
  polling, or shards.

The compiler manifest must contain each durable Program's stable identity,
environment, event selection, replay policy, ordering policy identity, and
definition version. It records semantics, never executable function bodies.

## Internal adapter boundary

The host receives one `SubstrateAdapter`. The adapter is the deployment unit;
the following facets are internal framework contracts, not application imports:

```ts
interface SubstrateAdapter {
  readonly authority: ResourceAuthority;
  readonly events: CommittedEventSource;
  readonly programs: ProgramProgress;
  readonly coordination: ProgramCoordination;
  validate(manifest: ApplicationManifest, deployment: DeploymentRequest): Promise<void>;
  close(): Promise<void>;
}
```

### Resource authority laws

- Compare-and-append is linearizable for one Resource address.
- A successful decision atomically advances the Resource revision and records a
  permanent intent receipt, including accepted zero-event decisions.
- A repeated intent returns the original decision without appending.
- Every committed event becomes durably visible to `CommittedEventSource` with
  stable identity and per-Resource order.
- Resource head, receipt, snapshot, and retained event history have independent
  storage lifetimes.
- Snapshot replacement is monotonic and validated against the Resource head.

### Committed event source laws

- The source discovers stable split identities and reports per-split earliest
  and latest cursors.
- Reads are pull-based, bounded, cancellable, and backpressured.
- A cursor belongs to exactly one source/split/version and is never interpreted
  by framework code.
- Split topology changes retain lineage so unread work is neither lost nor
  processed from an ambiguous position.
- Reading before a retained floor returns `CursorExpired` with recovery
  information; it never starts from the earliest remaining record silently.
- Source split order need not define global event order. Per-Resource order is
  preserved.

### Program progress laws

- Definitions, per-assignment checkpoints, delivery attempts, uncertainty, and
  definition migrations are durable substrate metadata, not product Resources.
- A checkpoint write includes the current assignment fence.
- Stale owners cannot claim, complete, or advance progress.
- Progress advances only after every earlier delivery required by that
  assignment is complete.
- Reset, rename, replay, and removal are explicit administrative operations.

### Coordination laws

- Membership, assignment, lease renewal, revocation, and failover are adapter
  responsibilities.
- Each assignment has one current fencing epoch.
- Rebalancing stops new pulls, revokes ownership, drains or aborts in-flight
  work, commits fenced progress, and reassigns from that progress.
- Key groups are stable across ordinary worker-count changes.
- A single-node adapter owns every assignment locally and obeys the same state
  transitions without distributed machinery.

## Ordering and repartitioning

The default path hashes the Resource address into a fixed, persisted set of key
groups. Different key groups may execute concurrently; one Program key remains
serial. Deployment changes assign key groups to different workers without
changing application-visible ordering.

A custom Program key that can combine events from several source splits requires
a durable shuffle stage before keyed handling. The runtime must either provide
that stage, preserve correctness with a validated singleton fallback, or reject
the requested distributed topology. A local callback is not a distributed
repartitioning implementation.

Changing custom key semantics creates a new `keyVersion`. Migration must choose
one explicit operation: replay from retained history, transform compatible
progress, or start as a new Program identity. No automatic guess is allowed.

A hot Program key is intentionally not split because doing so would violate its
ordering invariant. Product logic that needs more parallelism must select a
finer semantic key or coordinate through another Resource.

## Compaction and retention

Three operations remain distinct:

1. Physical maintenance rewrites, compresses, archives, tiers, checkpoints, or
   reclaims storage while preserving the same logical history. It is fully
   adapter-private.
2. Resource snapshots accelerate Resource recovery. They do not alter the
   logical stream.
3. Logical retention removes replayable events and is therefore an observable
   policy governed by retained floors.

The default policy is unlimited logical history. An adapter may move cold
history to an archive while preserving replay. True logical deletion is allowed
only after a verified snapshot exists and all protected consumers are beyond a
per-split low-water mark, or after an explicit Program-specific bootstrap has
been registered. New `replay: "all"` Programs must fail validation when full
history is unavailable.

Compaction must never delete Resource heads or permanent intent receipts.
Abandoned durable Program progress must be removed administratively before it
stops protecting history. The existing full-history verification path must gain
a retained-floor-aware mode rather than treating intentional reclamation as
corruption.

## Delivery and failure semantics

- Event delivery is at least once and same-key serial.
- Retry never advances progress.
- A stable delivery identity produces stable internal command intents and
  external idempotency keys.
- Assignment expiry makes unfinished work uncertain and eligible for redelivery
  under a new fence.
- Poison events pause/fail their assignment by default. Skipping, parking,
  dead-lettering, retry limits, and compensation remain higher-level Feature
  policy.
- Pull limits cover records, bytes, and outstanding work to prevent memory-only
  backlogs.
- Runtime shutdown and rebalance share one cancellation and drain protocol.

## Implementation plan

### Phase 0: Baseline and executable laws

- [x] Record current typecheck, test, lint, build, Journal, Program, and sync
      evidence without changing unrelated worktree changes.
- [x] Add a deterministic reference model for Resource commits, source splits,
      assignments, checkpoints, retention floors, and fencing.
- [x] Convert the invariants above into an adapter contract-suite API.
- [x] Reproduce the current defects: global-position coupling, stale-owner
      completion, compaction breaking heads/receipts, and custom-key scaling
      without a shuffle.

Gate 0:

- [x] Every invariant has a deterministic test or an explicitly documented
      proof obligation.
- [x] The defect tests fail against the old boundary for the intended reason.

### Phase 1: Static Program meaning

- [x] Introduce named durable event Program definitions and retain unrestricted
      service Programs.
- [x] Drive event names, handler event unions, dependencies, local Resources,
      and complete application API from the existing generic application type.
- [x] Add manifest entries for Program identity, environment, source selection,
      replay, key policy identity/version, and definition version.
- [x] Reject duplicate identities and incompatible definitions before Programs
      start.
- [x] Remove dynamic public `consume`, application concurrency, and
      `partitionRevision` after migration.
- [x] Update realistic application and Feature fixtures without compatibility
      adapters.

Gate 1:

- [x] Valid Program definitions infer without annotations or casts.
- [x] Invalid event names, key results, versions, and duplicate identities fail
      at the authoring location.
- [x] Manifest extraction does not execute application or vendor code.
- [x] Runtime and extracted manifests agree exactly.

### Phase 2: Adapter SPI

- [x] Introduce the single `SubstrateAdapter` host boundary and the four internal
      facets described above.
- [x] Define opaque split/cursor types, retained bounds, cursor expiry, assignment
      identity, and fencing epochs.
- [x] Define one committed-event identity independent of source location.
- [x] Define deployment requirements and adapter validation without exposing a
      boolean capability soup to applications.
- [x] Remove direct `Journal` and SQLite construction from public host options.
- [x] Keep concrete adapter construction in tooling/deployment ownership.

Gate 2:

- [x] Kernel and application code contain no physical persistence, transport,
      cursor, lease, worker, or shard vocabulary.
- [x] A minimal in-memory adapter passes the authority/source/progress contracts.
- [x] Unsupported deployment requirements fail before serving traffic.

### Phase 3: Single-node production adapter

- [x] Rework the SQLite implementation behind `SubstrateAdapter` while keeping
      its physical schema and maintenance private.
- [x] Separate Resource heads, intent receipts, snapshots, committed events,
      Program definitions, checkpoints, attempts, and assignment fences
      logically even when one database implements them.
- [x] Make authority commit and event-source publication atomic.
- [x] Represent source progress per split with opaque encoded cursors.
- [x] Implement local ownership through the same assignment state machine.
- [x] Preserve backup, restore, corruption detection, and durability profiles.

Gate 3:

- [x] The in-memory and SQLite adapters pass the same contract suite.
- [x] Crash injection at every write boundary produces no lost commit, broken
      receipt, skipped delivery, or accepted stale completion.
- [x] Restart preserves Resources, Program definitions, progress, attempts, and
      uncertainty.
- [x] No SQLite-specific type is reachable from the application package surface.

### Phase 4: Split-aware Program runtime

- [x] Replace scalar source progress with progress per source split and key group.
- [x] Implement bounded pull, same-key serial execution, cross-key concurrency,
      and backpressure.
- [x] Implement fenced claim, completion, retry, cancellation, and uncertain
      recovery.
- [x] Implement assignment grant, renewal, revocation, drain, abort, and failover
      for the supported single-node topology; clustered rebalance remains an
      adapter/executor conformance requirement.
- [x] Use the same abort, drain, fenced release, and restart path for supported
      ownership changes and shutdown.
- [x] Retain deterministic delivery identities and internal command
      idempotency.

Gate 4:

- [x] Generated crash schedules and deterministic owner-change models cause no
      event loss within the proven topology.
- [x] Every duplicate has the same stable delivery identity.
- [x] A stale worker can never mutate progress after reassignment.
- [x] Same-key handlers never overlap; independent keys can run concurrently.
- [x] Pending records and bytes remain within configured runtime bounds.

### Phase 5: Repartitioning and topology change

- [x] Define stable key groups independently of worker count; persistence is an
      obligation of any adapter that accepts clustered deployment.
- [x] Add deterministic allocation and reassignment across one or more simulated
      Program instances.
- [x] Implement source split discovery and split-lineage validation.
- [x] Explicitly gate the durable shuffle needed by custom Program
      keys crossing source splits.
- [x] Implement explicit key-version and Program-definition migrations.
- [x] Use no implicit singleton fallback: unsupported multi-split execution is
      rejected before Program initialization.

Gate 5:

- [x] Deterministic allocation scales from one to many simulated owners and back
      with monotonic rendezvous movement; production multi-instance execution is
      intentionally unsupported by the current adapter.
- [x] Split and merge topology requires complete predecessor lineage; execution
      rejects that topology until a conforming clustered executor exists.
- [x] Property-generated keys always map to one current owner.
- [x] A hot key remains ordered and bounded rather than being silently split.
- [x] Unsupported custom-key topology fails deterministically.

### Phase 6: Compaction, archival, and snapshot recovery

- [x] Separate physical maintenance hooks from logical retention policy.
- [x] Add retained bounds and explicit `CursorExpired` behavior.
- [x] Preserve Resource heads and receipts independently of retained events.
- [x] Calculate protected per-split low-water marks from durable Program
      registrations.
- [x] Add retained-floor-aware Resource verification.
- [x] Add snapshot-based client recovery without allowing Resource snapshots to
      skip Program history.
- [x] Add explicit administration for abandoned Program progress and replay
      capability validation.

Gate 6:

- [x] Physical compaction is observationally invisible.
- [x] Logical retention never produces a silent gap.
- [x] Receipts still deduplicate after their original event records leave hot
      storage.
- [x] A lagging protected Program blocks deletion or remains replayable through
      archive.
- [x] A new `replay: "all"` Program is rejected when required history is absent.
- [x] Snapshot plus retained tail reconstructs every compacted Resource exactly.

### Phase 7: Host, sync, administration, and packaging

- [x] Make server, tooling, migrations, tests, and development startup construct
      one adapter and transfer its ownership exactly once.
- [x] Keep browser snapshot synchronization independent of Program retention
      checkpoints.
- [x] Expose substrate inspection and migration only through testing/admin
      ownership, never product APIs.
- [x] Update exports so applications see semantic framework and Feature APIs,
      hosts see the adapter contract, and concrete implementations remain
      deployment-owned.
- [x] Remove superseded public Journal/consume boundaries, tests, docs, aliases,
      and empty files.

Gate 7:

- [x] Development, production build, restart, backup/restore, migrations, sync,
      and Program execution work through the new adapter boundary.
- [x] The packed package contains no accidental private adapter exports.
- [x] The application template contains no persistence or deployment plumbing.

### Phase 8: Final adversarial review

- [x] Run the complete contract suite against in-memory and SQLite adapters.
- [x] Run model-based traces covering concurrent commands, duplicate intents,
      snapshotting, retention, worker crashes, lease expiry, rebalance,
      repartition, retry, and restart.
- [x] Review every concept and public name for one meaning and one canonical path.
- [x] Audit imports and manifests for adapter leakage.
- [x] Run repository typecheck, tests, lint, build, package-boundary checks, and
      application smoke tests.
- [x] Update `docs/architecture.md` to the proven model and remove historical
      claims contradicted by the implementation.

Gate 8:

- [x] All automated verification passes from a clean process.
- [x] Every supported claim has executable evidence.
- [x] Remaining cluster limitation is stated precisely: the framework semantics,
      SPI, and deterministic multi-instance model are proven, but production
      horizontal deployment is supported only by adapters that independently
      pass the contract suite.
- [x] No physical implementation concern appears in application contracts.
- [x] There is one Program event path, one Resource authority path, one progress
      path, and one host adapter boundary.

## Required test methodology

- Contract tests execute unchanged against every adapter.
- Model-based property tests compare randomized operation traces to a small pure
  reference model.
- Deterministic schedulers control time, worker interleavings, lease expiry, and
  crash points.
- Fault injection occurs before and after each durable write and ownership
  transition.
- Linearizability histories cover concurrent commands to the same Resource.
- Metamorphic tests compare results before and after physical compaction,
  restart, backup/restore, and worker-count changes.
- Type tests prove generic inference and rejected definitions without counting
  runtime tests as type evidence.
- Boundary tests use the real SQLite adapter; no in-memory success can stand in
  for a production-boundary claim.

## Research basis

The design follows independently convergent semantics from:

- Flink's split enumerator, source reader, checkpoint, and key-group model.
- Kafka's per-partition ordering, consumer ownership, fencing, retention, and
  distinction between log compaction and complete history.
- Akka Cluster Sharding's stable entity identity and runtime-owned shard
  allocation.
- Axon's split/merge tracking segments and durable token ownership.
- Pulsar and Kinesis split/merge lineage and the limits of changing fixed
  partition counts.
- NATS JetStream and Kurrent persistent subscriptions' durable pull,
  backpressure, checkpoint, and at-least-once behavior.

These systems inform the laws; none of their vendor vocabulary belongs in the
application API.

## Evidence log

- 2026-07-16: Repository audit found a combined `Journal`, a globally monotonic
  source position, scalar Program source checkpoints, dynamic `consume`
  registration, local custom partition callbacks, and direct SQLite Journal
  construction at the server host boundary. These are sufficient for the
  current single-node runtime but cannot express correct split-aware retention,
  allocation, or fenced horizontal ownership.
- 2026-07-16: Primary-source comparison established the separation between
  semantic keys, source splits, execution key groups, storage shards, durable
  progress, and fenced ownership used by the target design.
- 2026-07-16: Baseline workspace typecheck, 635 kit tests plus application
  tests, lint, formatting before the plan file, and all package builds passed.
  The first adapter-neutral reference implementation now proves atomic
  authority/source visibility, split-scoped cursors, definition compatibility,
  bounded source reads, lease fencing, uncertain redelivery attempts, stale
  completion rejection, and checkpoint gap prevention in four focused tests.
- 2026-07-16: Durable Programs are now named static definitions in the generic
  Application and Feature contracts. The compiler extracts their canonical
  identity, environment, event selection, replay policy, definition version,
  and ordering-key version without executing application code. Host startup
  rejects any disagreement between the extracted and executable manifests
  before Programs initialize.
- 2026-07-16: One reusable adapter contract suite now runs unchanged against
  the in-memory and SQLite adapters. It verifies atomic authority/source
  publication, stale-fence rejection, uncertain redelivery, checkpoint gaps,
  assignment isolation, retention expiry, definition drift, split topology,
  and deployment validation. The suite exposed and fixed progress that was
  incorrectly shared between key-group assignments; restart and administrative
  migration tests now cover the corrected per-assignment identity.
- 2026-07-16: The single-node runtime now bounds both records and bytes,
  validates split lineage before Program startup, allocates stable key groups
  with deterministic rendezvous hashing, and rejects unsupported multi-split or
  multi-instance production deployment rather than pretending to rebalance it.
  A future clustered adapter and executor must pass the same contract suite;
  horizontal production execution is not claimed by this implementation.
- 2026-07-16: Logical retention now has explicit retained bounds and cursor
  expiry, protects registered Program low-water marks, preserves Resource heads
  and intent receipts, and supports retained-floor-aware verification,
  snapshot-tail recovery, backup, restore, reset, rename, and removal. Physical
  SQLite maintenance remains private to the production adapter.
- 2026-07-16: Final verification ran without Turbo cache reuse: 662 kit tests
  across 32 files and every application/package test passed, for 10 successful
  test tasks and zero failures. Forced TypeScript checks passed for all six
  packages, all six production builds passed, OxLint and Oxfmt passed, and the
  published-package test installed, typechecked, executed, and scaffolded an
  isolated application successfully.
