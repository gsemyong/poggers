# Durable Virtual Actors

Status: active

This is the living source of truth for Kit's durable virtual Actor Feature.
Checked items record verified evidence, not intention. Update the gap ledger,
milestone checklists, decisions, and progress log as evidence changes.

Presentation completion remains tracked separately in
[`presentation-plan.md`](./presentation-plan.md). Do not expand that workstream
while this goal is active unless shared substrate work requires a focused
compatibility check.

## North Star

Kit must provide a conventional, durable virtual Actor model as one reusable
Feature factory over its existing substrate:

```text
semantic Actor definition
        |
        v
ordinary recursive Feature
        |
        +-- contributes portable Programs
        +-- requires typed Dependencies
        `-- provides a typed Actor reference Dependency
                         |
                         v
              generic Program compilation
                  /                 \
                 v                   v
        TypeScript development    native production
```

Product authors describe an Actor's stable identity, state, Dependencies, and
typed asynchronous methods. They do not describe machines, replicas, network
addresses, partitions, placement, storage engines, leases, mailboxes, or
serialization.

One compiled Program artifact may run as any number of Processes. The Actor
Feature and server Dependencies locate Actor identities, activate state on
demand, serialize calls, persist results, schedule durable reminders, route
remote calls, recover from failures, and redistribute work as Processes join
or leave. Changing replica count or placement never changes Actor source.

The same portable TypeScript Actor implementation runs directly during
development and is lowered by the one generic TypeScript-to-native compiler
for production. Actor Features own no translator, Actor-specific IR, native
handler copy, or generated template. Native code implements generic runtime
facilities and host Dependencies only.

## Success Definition

The goal is complete only when all of the following are true:

- one minimal, method-oriented, fully inferred Actor API is the only public
  authoring and invocation language;
- an Actor type plus typed key identifies one logically perpetual Actor;
- Actor methods preserve per-key ordering, durable state, typed outcomes,
  idempotent invocation identity, bounded admission, and explicit failure
  semantics;
- durable reminders, activation, deactivation, restart, migration, snapshot,
  compaction, and deletion policies are defined and tested;
- the same Program artifact runs as one or many Processes without source
  changes;
- membership, partitioning, placement, directory ownership, remote transport,
  failover, draining, and rebalancing work through ordinary Dependencies;
- TypeScript and generated native execution are behaviorally equivalent;
- no Actor-specific compiler or handwritten application Rust exists;
- focused TypeScript iteration does not compile Rust or run unrelated checks;
- genuine multi-process tests prove scale-out, node loss, relocation, delayed
  delivery, and rolling-version behavior;
- performance evidence covers equivalent durability settings and identifies
  the hot-key ceiling honestly;
- the complete repository and focused production release gates pass once at
  milestone closure.

## Architectural Invariants

1. `System`, `Feature`, `Program`, `Process`, `Environment`, and `Dependency`
   remain the complete substrate.
2. `createActor` is a reusable Feature factory, not a core execution primitive.
3. A Program is authored once; a Process is one running replica.
4. Actor-to-Actor, Actor-to-service, and cross-Process calls use the same typed
   Dependency mechanism.
5. Actor business logic is portable TypeScript accepted by the one generic
   compiler.
6. Generic IR contains Programs, procedures, values, and Dependency calls, not
   Actor nodes.
7. Native application behavior is generated from TypeScript. Handwritten
   native code stops at host Dependency and generic runtime boundaries.
8. Actor state and call semantics belong to the Actor Feature. Storage,
   transport, clocks, process identity, cluster membership, and telemetry are
   environmental Dependencies.
9. Actor source contains no topology, persistence, transport, or deployment
   vocabulary.
10. One public semantic API serves development and production. There is no
    low-level Actor facade or raw-message escape hatch.
11. Runtime optimization may change realization but never observable Actor
    semantics.
12. At-least-once delivery and uncertain failure are acknowledged. Exactly-once
    external effects are never claimed without an atomic provider boundary.

### Translation Litmus Test

Adding an unrelated Actor Feature is invalid if it requires:

- an Actor-specific compiler extension, IR node, backend branch, or source
  transform;
- a Rust copy of an Actor method or Feature;
- a feature-owned native generator or template;
- separate behavioral fixtures for TypeScript and native execution;
- a public transport, partition, lease, mailbox, or storage API;
- a second Actor invocation surface.

Generic compiler improvements are allowed only when independently useful to
ordinary Programs and protected by generic conformance tests.

## Canonical Model And Decisions

### Actor Identity

- `Actor` is the public concept and `createActor` is its factory.
- `Name` is one stable, compiler-materialized Actor type name.
- `Key` is the typed key within that Actor type.
- Complete identity is `(Name, Key)`.
- A virtual Actor logically always exists. It is not explicitly constructed or
  destroyed.
- Initial state is a deterministic function of the stable key. Domain creation
  data belongs in an explicit typed method, avoiding hidden first-call races.
- Physical activation, deactivation, eviction, and retained-state deletion are
  realization concerns and do not change logical identity.

### Actor API

- `Methods` is the conventional public protocol vocabulary.
- Method names are authored once in the Actor model and implemented once under
  `methods`.
- Every method is asynchronous at the Actor boundary, accepts one typed object
  or no input, and returns one typed result or declared product failure.
- `commands` and `queries` are historical public authoring vocabulary. They do
  not appear in the current API. Internal journal records retain their
  `actor.command.*` names for persistence compatibility, while implementation
  dispatch classifies the single method map by read/write mode.
- A read-only optimization may not introduce a second invocation model.
  Evidence must determine whether it is compiler-inferred, method metadata, or
  unnecessary.
- Handler context uses `key`, `state`, `input`, `dependencies`, `invocation`,
  `self`, `fail`, and `reminders` only when the method's semantics require them.
- Durable scheduling is called `reminders`. `timers` is reserved for
  activation-local, non-durable timing if such an API is ever justified.
- `Reference` is the conventional typed handle to one Actor identity.

### Target Authoring Shape

This is the implemented canonical authoring shape and remains protected by
type-only and runtime fixtures:

```ts
type Inventory = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Dependencies: {
    audit: Audit;
  };
  Methods: {
    reserve: Actor.Method<
      { quantity: number },
      { remaining: number },
      { unavailable: { available: number } }
    >;
    availability: Actor.Read<undefined, { available: number }>;
  };
}>;

export const inventory = createActor<Inventory>({
  state: ({ key: _key }) => ({ available: 10 }),
  methods: {
    async reserve({ state, input, dependencies, fail }) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }

      await dependencies.audit.record({
        action: "inventory.reserved",
        quantity: input.quantity,
      });
      state.available -= input.quantity;
      return { remaining: state.available };
    },

    async availability({ state }) {
      return { available: state.available };
    },
  },
});
```

No handler repeats `Actor.Command`, `Actor.Query`, or the Actor model. The
generic type supplies all handler context, input, result, and failure meaning.

The target reference binds identity once:

```ts
const item = dependencies.inventory.get({ key: "sku-1" });

await item.reserve({ quantity: 2 });
const availability = await item.availability();
```

`get` returns a typed logical reference; it does not create or load the Actor.
Infrastructure call options must not contaminate product inputs. F1 must decide
one coherent typed shape for deadlines, cancellation, durable acceptance, and
idempotency without introducing a second facade.

### Concurrency And Failure

- Method execution is non-reentrant by default.
- Calls for one Actor identity commit in one total order.
- No order is promised across different Actor identities.
- An Actor may be physically activated more than once during instability, but
  only the current fenced owner may commit or begin an unfenced external
  effect.
- Synchronous call cycles fail with their typed path instead of deadlocking.
- Domain failures are declared results. Infrastructure failures are separate
  typed `Actor.Error` values.
- Runtime retries preserve invocation identity and retry only when semantics
  are known to be safe.
- Abandoning a caller wait does not retract durably accepted work.
- Product cancellation is an explicit domain method unless generic Dependency
  cancellation is proven to have the required durable meaning.
- Parent/child supervision trees are not part of the virtual Actor product
  model. Activation failure recovery is runtime policy; domain coordination
  belongs in manager Actors or a future orchestration Feature built over them.

### Effects And Delivery

- Actor method calls are durable request/reply by default.
- The runtime may deliver a call more than once.
- State and retained method outcome commit atomically within one Actor
  persistence boundary.
- Actor-to-Actor calls and external Dependency calls carry stable invocation
  identity.
- External providers must be idempotent, deduplicate explicitly, or expose an
  atomic outbox/transaction boundary.
- No general distributed transaction is promised across Actors. Multi-Actor
  business coordination uses explicit sagas or a future orchestration Feature.

### Reminders

- A reminder is named, durable, one-shot, replaceable, cancellable, and
  generation-fenced.
- Recurrence is expressed by scheduling the next reminder from committed
  Actor logic. Calendar and cron scheduling remain a Scheduler Feature concern
  unless a concrete Actor use case falsifies this boundary.
- Reminder intent commits with Actor state.
- Delivery may repeat; generation and invocation identity make processing
  idempotent.
- A reminder survives Process loss, activation eviction, relocation, and
  cluster restart.

### Horizontal Scaling

One Actor Program artifact can run as any number of homogeneous Processes:

```text
Actor reference call
  -> typed Dependency invocation
  -> hash (Actor name, key) to a virtual partition
  -> resolve partition/activation owner
  -> local fast path or remote transport
  -> activate from snapshot plus journal tail
  -> serialize and execute the method
  -> commit under an ownership epoch/fence
```

- Virtual partitions keep key distribution stable as Process count changes.
- Membership records eligible Processes and failure epochs.
- Placement assigns virtual partitions or activations using adapter policy.
- A directory resolves current ownership.
- Transport preserves method schema, invocation identity, deadlines,
  cancellation, failures, tracing, and version information.
- Scale-out, scale-in, draining, and failure reassign ownership without Actor
  source changes.
- Hot Actors remain single-key serialization bottlenecks by design. The runtime
  must expose honest pressure metrics rather than imply one Actor scales
  internally.
- `placePrograms` maps logical Program roles to artifact pools. It is not Actor
  partitioning.

#### F5 Runtime Contract

F5 adds no Actor authoring concept. It extends generic Process execution with
an optional adapter-owned distribution context:

- one Process instance has a stable member id, transport target, logical
  Program name, compiler-derived Program version, status, failure epoch, and
  renewable membership lease;
- compiler IR retains the fields of a Dependency reference `Binding`, allowing
  the runtime to derive a canonical logical identity without knowing Actor
  vocabulary;
- a configurable, deployment-versioned virtual-partition count maps
  `(Program, Dependency, canonical binding)` to one partition using a stable
  hash;
- rendezvous placement selects one eligible active member for a partition from
  a monotonically versioned membership view. Member ordering cannot affect the
  result and adding or removing one member moves only partitions whose winner
  changes;
- a linearizable directory record stores partition, owner member, owner
  transport target, compatible Program version, membership revision,
  monotonically increasing ownership epoch, and lease expiry;
- claiming, renewing, releasing, and resolving ownership are compare-and-set
  operations. Every replacement increments the ownership epoch; an expired,
  draining, departed, or incompatible owner cannot renew;
- one routed Dependency facade derives the reference binding from each wire
  input, resolves or claims its partition, and dispatches through the local raw
  provider or the F4 transport. Unbound Dependencies remain ordinary local or
  explicitly remote Dependencies;
- inbound dispatch validates the ownership epoch before product code starts.
  The epoch is also propagated as generic invocation authority so a
  state-machine Feature can revalidate before an external effect and at its
  atomic commit;
- the raw provider is registered as an inbound target while local consumers
  receive the routed facade. An inbound call can therefore never route back
  through itself;
- drain marks a member ineligible for new ownership, stops new local
  admissions, waits for admitted calls, releases ownership, unregisters the
  transport target, and leaves membership;
- crash takeover occurs only after membership or ownership lease expiry and
  always receives a greater ownership epoch. The old member cannot begin a
  subsequently fenced invocation or commit under its old epoch;
- version eligibility is checked from compiler-derived contracts and Program
  versions. Compatible rolling members may share placement; incompatible
  members are excluded before invocation;
- a deterministic in-memory implementation proves the state machine in F5.
  A real network, durable production directory, genuine OS-process failure,
  and native realization remain explicit F7/F9 gates.

The atomic membership/directory boundary may be implemented by one adapter
service when its storage requires that shape. Public types describe the
semantic operations, not a mandatory deployment topology or database schema.

### Product And Operational Boundaries

Actor authors see:

- model, state, typed methods, Dependencies, failures, invocation identity,
  self-reference, and reminders.

Deployment and operations own:

- replica count, eligible pools, partition count, placement policy, membership,
  failure detection, directory consistency, transport, storage, snapshots,
  compaction, retention, encryption, draining, rebalancing, and telemetry.

Cross-cutting authorization, tracing, quotas, and auditing use generic
Dependency middleware or invocation context. They do not become Actor method
syntax.

## Current Evidence And Gap Ledger

| Area                        | Status   | Current evidence                                                                                                                                                                                                 | Required closure                                              |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Feature projection          | complete | `createActor` returns an ordinary Feature with one Program and typed Requires/Provides                                                                                                                           | preserve through API migration                                |
| Generic compilation         | complete | Actor Programs lower through generic IR and generated Rust with no Actor backend                                                                                                                                 | architecture guard remains green                              |
| Stable identity             | complete | Actor type name and one locally bound key form the logical identity                                                                                                                                              | preserve through activation and remote routing                |
| Durable per-key state       | complete | journal plus versioned snapshot/tail recovery survives restart                                                                                                                                                   | preserve through remote ownership and native scale-out        |
| Per-key ordering            | complete | concurrent commands commit in one order                                                                                                                                                                          | preserve for unified Methods                                  |
| Idempotency/results         | complete | separate call policy, explicit invocation identity, and retained outcomes                                                                                                                                        | preserve through transport and compaction                     |
| Product failures            | complete | Methods infer typed outcomes separate from infrastructure errors                                                                                                                                                 | preserve through transport and compatibility                  |
| Actor composition           | complete | model-derived identity-bound references lower to ordinary Dependency calls                                                                                                                                       | preserve through generic remote transport                     |
| Non-reentrancy/cycles       | complete | synchronous cycles fail; durable acceptance breaks waits                                                                                                                                                         | preserve under remote transport                               |
| Durable one-shot scheduling | complete | journaled one-shot reminders recover, replace, cancel, generation-fence, and self-reschedule through typed methods                                                                                               | preserve in native production realization                     |
| Replica state correctness   | complete | compiler-derived routing, fenced ownership, shared persistence, and genuine process takeover preserve one logical state                                                                                          | preserve through pressure gates                               |
| Fault simulation            | complete | deterministic durable-boundary faults plus one genuine native fixture for duplicates, latency, bounded clock skew, drain, kill, NATS partition/healing, and mixed versions                                       | preserve through closure gates                                |
| Activation lifecycle        | complete | explicit phases, bounded idle/LRU eviction, invalidation, and recovery are tested                                                                                                                                | preserve through directory ownership and relocation           |
| Automatic partitioning      | complete | compiler-retained bindings drive stable virtual partitions and genuine one-three-one native placement                                                                                                            | preserve through pressure gates                               |
| Cluster membership          | complete | JetStream-backed join, renew, drain, leave, expiry, failure epochs, bounded renewal, and fail-closed readiness pass                                                                                              | expose operator inspection in F8                              |
| Placement/directory         | complete | durable CAS directory, rendezvous placement, contract eligibility, monotonic ownership epochs, and stale rejection pass                                                                                          | expose drain/rebalance operations in F8                       |
| Remote transport            | complete | native NATS protocol validates all compiler-derived inputs, outputs, stream items, heartbeats, failures, and metadata                                                                                            | preserve through compatibility and pressure gates             |
| Rebalancing/draining        | complete | lazy automatic relocation, operator rebalance, admission-safe native drain, abrupt kill, and partition recovery pass                                                                                             | preserve through closure gates                                |
| Snapshot/compaction         | complete | snapshots, tail recovery, CAS, guarded compaction, crash retry, and NATS purge pass                                                                                                                              | preserve through distributed ownership and native conformance |
| Actor deletion/retention    | complete | fixed bounded result/tombstone windows, indefinite state retention, and absence of implicit deletion are explicit                                                                                                | configurable alternatives remain a documented future option   |
| Distributed reminders       | complete | generation-fenced JetStream schedules and a durable shared queue survive replacement, cancellation, process loss, relocation, and total application-cluster outage                                               | preserve through operations and pressure gates                |
| Rolling versions            | complete | state/input migrations, operation compatibility, additive rollout, incompatible exclusion, and native mixed-version placement pass                                                                               | preserve through closure gates                                |
| Observability/operations    | complete | Actor and Process metrics, cache hits/misses, traces, baggage, health/readiness, ownership inspection, drain, and rebalance pass                                                                                 | preserve through closure gates                                |
| Security/tenancy            | complete | typed authorization and tenant context cross the generic remote Dependency boundary; NATS protects adapter subjects                                                                                              | application policy remains product-owned                      |
| Performance                 | complete | one reproducible benchmark covers local/remote, cold/warm, persistence, hot/many keys, reminders, snapshots, scale-out, failover, and required measurements; focused release-native differential evidence passes | preserve the benchmark and release smoke at future milestones |

## Required Generic Server Dependencies

These are semantic responsibilities, not necessarily one public interface each.
Contract boundaries must follow atomicity and lifecycle rather than file
symmetry.

1. **Actor persistence mechanism**
   - compare-and-commit state, invocation, outcome, reminder, and ownership
     records;
   - load snapshot and journal tail;
   - compact and delete under explicit retention rules.
2. **Cluster membership**
   - process identity, eligibility, liveness, and monotonically versioned
     membership views.
3. **Directory and ownership**
   - locate or claim identity/partition ownership;
   - issue epochs/fences and reject stale commits.
4. **Placement**
   - choose eligible owners by stable partitioning, load, locality, and version
     compatibility.
5. **Typed remote Dependency transport**
   - local fast path and remote request/reply;
   - codecs and boundary validation generated from versioned Dependency
     schemas;
   - preserve invocation metadata, timeout, cancellation, errors, tracing, and
     rolling protocol compatibility.
6. **Durable scheduler**
   - persist due work independently of one Process;
   - deliver a reminder to the current owner with duplicate-safe identity.
7. **Telemetry and operations**
   - metrics, traces, logs, health, ownership inspection, drain, and rebalance
     control.

Actor policy is implemented by the Actor Feature over these mechanisms.
Adapters implement host-specific realizations. No large `ActorHost` Dependency
may hide untestable policy inside an adapter.

## Generic Remote Dependency Protocol

F4 extends the existing Dependency boundary rather than introducing an Actor
transport API. The compiler already knows every callable operation; it must
retain the declared failure and heartbeat meaning that is currently available
only to TypeScript.

The canonical wire protocol has these decisions:

- the protocol is versioned independently of product Dependencies;
- every invocation identifies the target Process, Dependency, operation,
  operation contract, invocation id, attempt, schedule/start/deadline times,
  optional previous heartbeat, and serializable input;
- an operation contract identity is derived deterministically from canonical
  compiler meaning: mode, input, output, declared failures, and heartbeat
  payload;
- compatibility is checked per operation rather than by one whole-Dependency
  version, so adding an unrelated operation does not invalidate compatible
  rolling Processes;
- providers validate protocol, operation contract, invocation metadata, and
  input before product code executes;
- clients validate successful values, stream items, declared failures,
  heartbeats, and deferred results before exposing them to product code;
- asynchronous calls use request/reply; streams use ordered item frames and
  one terminal frame; cancellation and heartbeats are control frames on the
  same logical invocation;
- synchronous Dependency operations are process-local. A remote binding rejects
  them before dispatch because a network hop cannot preserve synchronous
  semantics;
- transport never retries product work implicitly. A durable caller retries
  explicitly with the same invocation id and a higher attempt after applying
  the Dependency's policy;
- a lost response remains an uncertain infrastructure failure unless the
  product Dependency provides idempotency or durable result retrieval;
- local and remote dispatch share the compiler-derived conformance boundary,
  while network connection, framing, backpressure, and authentication remain
  adapter responsibilities;
- transport failures are distinct from declared product failures and never
  masquerade as one another;
- Actor identity, placement, partition, lease, and reminder vocabulary is
  absent from this protocol.

F4 first proves this protocol with an unrelated non-Actor Dependency and a
deterministic in-memory duplex transport. F5 supplies owner resolution and
chooses the local or remote path. F7 supplies the native and production-network
realizations without changing the protocol or public Dependency API.

## Milestones

### F0. Baseline And Guardrails

- [x] Re-run the focused TypeScript Actor suite and record warm timing.
- [x] Inventory current public API, IR, runtime, native, benchmark, and docs.
- [x] Add or confirm architecture guards against Actor-specific compiler and
      native application code.
- [x] Freeze current semantic fixtures as compatibility evidence.
- [x] Mark every current claim as complete, partial, missing, or delegated.
- [x] Confirm the fast validation ladder does not build the package or Rust.

Gate: the current baseline is reproducible and no target claim relies on the
manual-replica simulation alone.

### F1. Canonical Method API

- [x] Create type-only fixtures for the target `Methods` model.
- [x] Infer handler context, input, output, and failures from
      `createActor<Model>` without per-handler annotations.
- [x] Bind Actor identity once through one `Reference.get({ key })` operation.
- [x] Decide one product-clean shape for idempotency, deadline, cancellation,
      durable acceptance, and result retrieval.
- [x] Preserve one object argument for product methods.
- [x] Decide how read-only optimization is represented without restoring
      command/query buckets or a second call API.
- [x] Rename durable `timers` to `reminders`.
- [x] Prove no repeated runtime Actor name or string method name.
- [x] Add invalid type fixtures for collisions, unserializable contracts,
      undeclared failures, and incompatible methods.
- [x] Publish one migration path from current commands/queries and key-per-call
      references; remove superseded API after migration fixtures pass.

Gate: one concise example communicates the complete Actor model and all public
meaning is available at the type level.

### F2. Method Semantics And Activation

- [x] Move current command/query guarantees onto the unified Method runtime.
- [x] Define activation state transitions and process-local activation epochs.
- [x] Add on-demand activation from durable history; snapshot acceleration is
      F3.
- [x] Add bounded activation cache and deterministic idle eviction.
- [x] Prove eviction never changes logical identity or loses accepted work.
- [x] Define activation failure, invalidation, retry, and poison semantics.
- [x] Preserve non-reentrancy, cycle detection, fairness, and hot-key
      backpressure.
- [x] Prove all mutable state becomes durable only at one atomic commit point.
- [x] Keep initialization deterministic from key; prove explicit initialization
      methods handle domain creation races.

Gate: activation can be repeatedly created, evicted, failed, and recovered
without observable semantic drift.

### F3. Persistence Lifecycle

- [x] Define the minimal atomic persistence contract from the state machine.
- [x] Add physical snapshots with schema identity and journal position.
- [x] Load snapshots plus incremental tail with exact reference equivalence.
- [x] Add safe compaction after retained outcomes and reminders permit it.
- [x] Define retained invocation result, tombstone, Actor state, and deletion
      policies independently.
- [x] Prove crash safety before, during, and after snapshot/compaction.
- [x] Prove migrations from old snapshot, state, and accepted-method schemas.
- [x] Bound cold activation work and storage growth.

Gate: long-lived Actors recover in bounded work and storage reclamation cannot
change results, reminders, or idempotency.

### F4. Generic Remote Dependency Boundary

- [x] Define a versioned Dependency wire schema independent of Actors.
- [x] Retain declared failure and heartbeat meaning in compiler IR, linker
      compatibility checks, and Process manifests.
- [x] Derive one canonical per-operation contract identity from compiler
      meaning.
- [x] Generate validators/codecs from existing semantic contracts.
- [x] Implement local direct dispatch and remote request/reply under one API.
- [x] Preserve invocation identity, deadlines, cancellation, typed failures,
      tracing, and async result semantics.
- [x] Support ordered stream frames and reject synchronous remote operations
      before dispatch.
- [x] Prove duplicate, delayed, reordered, lost, and retried packets.
- [x] Prove unsupported versions fail before method execution.
- [x] Add mixed-version compatibility fixtures.
- [x] Keep Actor names and Actor-specific cases out of transport and compiler.

Gate: an unrelated non-Actor Dependency uses the same cross-Process transport,
and Actor calls need no special wire path.

### F5. Membership, Partitioning, Placement, And Directory

- [x] Define versioned membership views and failure epochs.
- [x] Partition Actor identities over a configurable number of virtual
      partitions.
- [x] Assign partitions to eligible Processes with a deterministic reference
      policy.
- [x] Implement fenced directory ownership and stale-owner rejection.
- [x] Route local calls directly and remote calls through F4 transport.
- [x] Add scale-out, scale-in, process drain, crash takeover, and automatic
      rebalancing.
- [x] Preserve accepted work across ownership moves.
- [x] Preserve reminder intent and delivery across ownership moves in F6.
- [x] Add version-aware eligibility for rolling deployments.
- [x] Keep placement policy in deployment/adapter configuration, never Actor
      source.

Gate: one unchanged Program artifact runs on one, three, and one Processes
again while automatic routing preserves every committed result.

### F6. Distributed Reminders

- [x] Replace process-local wake-up authority with the durable scheduler
      contract.
- [x] Recover due reminders after total cluster restart.
- [x] Route reminders to the current owner after relocation.
- [x] Prove duplicate delivery, replacement, cancellation, generation fencing,
      and overdue catch-up.
- [x] Prove self-rescheduling recurrence without hidden cron semantics.
- [x] Bound reminder scanning and hot-partition behavior.

Gate: no Process-local registration is required for durable reminder
correctness.

### F7. Native Production Realization

- [x] Implement required generic server Dependencies in Rust or connect them to
      production infrastructure behind Rust adapters.
- [x] Compile unchanged Actor Programs with the generic TypeScript-to-Rust
      pipeline.
- [x] Add no Actor-specific translator, backend, handler, or runtime branch.
- [x] Run the same conformance corpus against TypeScript and generated native
      execution.
- [x] Prove restart, multi-process transport, membership churn, placement,
      reminders, snapshots, and compaction natively.
- [x] Retain debug-native checks for milestones and one release-native smoke
      gate.

Gate: changing Actor business logic changes generated native behavior without
changing handwritten Rust.

### F8. Operations, Security, And Compatibility

- [x] Expose generic metrics for calls, queue depth, activation count, cache
      pressure, ownership moves, retries, reminder lag, and failures.
- [x] Propagate structured traces through local and remote Dependency calls.
- [x] Add health, readiness, drain, ownership inspection, and rebalance
      operations.
- [x] Prove authorization and tenant context propagation using generic
      Dependency middleware.
- [x] Define rolling upgrade, rollback, schema compatibility, and incompatible
      placement behavior.
- [x] Document operator-visible delivery and external-effect guarantees.

Gate: operators can explain where work is, why it moved, whether it is
backlogged, and whether a rollout is compatible without exposing controls to
Actor business code.

### F9. Pressure, Performance, Cleanup, And Closure

- [x] Run independent fixtures for inventory, account coordination,
      collaborative documents, conversational agents, device sessions, rate
      limiting, auctions, game rooms, and scheduled agents.
- [x] Run genuine OS-process fixtures with abrupt kill, partition, latency,
      duplicate delivery, clock skew, drain, and mixed versions.
- [x] Benchmark warm local call, warm remote call, cold activation, many keys,
      one hot key, persistence, reminders, snapshot recovery, scale-out, and
      failover under equivalent durability settings.
- [x] Measure allocation, cache hit rate, network bytes, storage growth,
      relocation time, and p50/p95/p99 latency.
- [x] Differentially verify every optimized path against the TypeScript
      reference.
- [x] Remove manual-routing experiments, obsolete commands/queries API,
      process-local durable scheduling assumptions, and redundant tests.
- [x] Update Actor API, guarantees, limits, deployment, migration, and
      operations documentation.
- [x] Run complete repository and focused production release gates once.

Gate: every Success Definition item has direct evidence and no limit is hidden
behind a benchmark or type-only fixture.

## Verification Strategy

### Fast Inner Loop

Use for ordinary Actor API and TypeScript semantic work:

```sh
nub exec vitest run src/features/actor.spec.ts --tagsFilter='!native && !production'
nub run typecheck
```

Run the focused test first and root type checking after a coherent edit. These
commands must not build the package or compile Rust.

### Affected Generic Substrate

Use only when the shared compiler, Dependency runtime, linker, or process scope
changes:

```sh
nub exec vitest run \
  src/compiler/source.spec.ts \
  src/runtime/process.spec.ts \
  --tagsFilter='!native && !production'
```

Add the exact affected spec rather than broadening this command by default.

### Targeted Native Dependencies

Use when handwritten Rust server Dependencies change:

```sh
cargo check --manifest-path src/adapters/server/production/Cargo.toml -p <affected-package>
cargo test --manifest-path src/adapters/server/production/Cargo.toml -p <affected-package>
```

IR and lowering tests do not build executables. Native behavioral milestones
use debug executables and the stable content-addressed generated-artifact
cache. Release mode is reserved for focused production smoke and performance
gates.

### Actor Milestone

The milestone command must eventually cover:

- source Actor behavior and type fixtures;
- deterministic cluster simulation;
- generic transport conformance;
- affected Rust package tests;
- one TypeScript/generated-native differential executable containing related
  scenarios.

Do not create one generated executable per scenario. Separate executables only
when restart, persistent state, process isolation, or protocol compatibility is
the behavior under test.

### Multi-Process Gate

Run only for F4-F9 changes. It must start genuine independent Processes and
exercise local and networked calls, joins, leaves, kill, drain, delayed
delivery, rebalancing, reminders, and rolling versions. Temporary execution
state remains isolated while compiled artifacts use stable content-addressed
caches.

### Complete And Release Gates

`nub run check` remains the complete repository gate and must build the package
at most once. Run it once after a milestone is stable, not during ordinary
Actor iteration.

The focused production release gate adds release-native compilation,
distribution verification, generated artifacts, and representative
multi-process behavior. Presentation/browser checks run only if shared web or
Presentation code changed.

## Test Matrix

Every semantic guarantee needs:

1. a deterministic TypeScript reference test;
2. type-level acceptance and rejection fixtures where applicable;
3. fault injection at each durable boundary;
4. generated-native differential evidence when portable execution is involved;
5. genuine multi-process evidence when ownership or transport is involved.

Required distributed cases:

- one, three, and one replica without source changes;
- simultaneous first call to one inactive identity;
- node death before admission, after admission, during execution, before
  commit, after external effect, and after commit;
- delayed stale owner after takeover;
- duplicate and reordered request and response packets;
- network partition and healing;
- scale-out and scale-in with active hot and cold keys;
- graceful drain and abrupt process kill;
- reminder due during relocation and complete cluster outage;
- snapshot and compaction crash boundaries;
- mixed compatible and incompatible versions;
- bounded overload for one hot key without starving cold keys;
- authorization and trace context across a remote Actor-to-Actor call.

## Performance Contract

- Local calls use direct dispatch after ordinary Dependency resolution.
- Remote calls perform one owner lookup or use a versioned cached route.
- Warm activation reads no durable history when its fenced cache is valid.
- Cold activation reads one snapshot plus an incremental tail.
- Per-key serialization does not impose a global lock.
- A shared scheduler and bounded number of event loops serve all Actors; there
  is no timer or thread per Actor.
- Rebalancing moves ownership metadata lazily and does not eagerly load every
  Actor.
- Optimizations are accepted only after differential equivalence.
- Performance reports state durability, transport, storage, process count,
  payload, warm/cold state, and raw samples.

## Research Baseline

Research informs falsification and naming; Kit does not copy another runtime's
surface:

- [Microsoft Orleans overview](https://learn.microsoft.com/en-us/dotnet/orleans/overview)
  for virtual identity, activation, persistence, reminders, and runtime
  placement;
- [Orleans grain directory](https://learn.microsoft.com/en-us/dotnet/orleans/host/grain-directory)
  for identity-to-activation ownership and consistency choices;
- [Orleans placement](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-placement)
  for configurable resource and locality policies;
- [Orleans request scheduling](https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-scheduling)
  for non-reentrancy and cycle risks;
- [Dapr Actors](https://docs.dapr.io/developing-applications/building-blocks/actors/actors-features-concepts/)
  for turn-based access and pluggable placement/state boundaries;
- [Cloudflare Durable Objects RPC](https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/)
  for typed identity-bound method references;
- [Apache Pekko cluster sharding](https://pekko.apache.org/docs/pekko/current/typed/cluster-sharding.html)
  for separating entity identity, shard ownership, and persistence;
- [Akka delivery reliability](https://doc.akka.io/libraries/akka-core/current/general/message-delivery-reliability.html)
  for explicit delivery guarantees.

## Non-Goals

- a new core execution model;
- Actor-specific TypeScript-to-Rust translation;
- handwritten native Actor business logic;
- adopting Orleans, Dapr, Akka, Pekko, or another runtime as the public
  language;
- raw message handlers beside typed Methods;
- topology controls in Actor source;
- general cross-Actor ACID transactions;
- a parent/child supervision tree;
- transparent exactly-once external effects;
- unbounded reentrancy modes;
- cron/calendar scheduling inside Actors;
- hiding the single-hot-key serialization ceiling;
- running full repository, browser, or release-native gates for every
  Actor edit;
- claiming production scaling from in-process manual-routing simulations.

## Progress Log

### Foundation Verified Before This Goal

- Actor is implemented as a reusable Feature over ordinary Programs and
  Dependencies.
- Current commands, queries, durable admission, retained results, typed
  failures, idempotency, non-reentrancy, cycle detection, one-shot timers,
  migrations, overload, poison isolation, and provider-owned effect identity
  have deterministic TypeScript tests.
- The same Actor Programs compile through generic IR and generated Rust with no
  Actor-specific backend.
- Shared-EventStore replica fixtures prove fenced state correctness, takeover,
  duplicate delivery, delayed ownership, clock skew, and manually simulated
  relocation.
- The current benchmark compares equivalent in-memory compare-and-append
  durability settings.
- These results are foundation evidence, not proof of automatic production
  partitioning, directory routing, activation lifecycle, distributed
  scheduling, compaction, or cluster operations.

### 2026-07-25

- Reopened the Actor programme after distinguishing expressive substrate
  sufficiency from implemented production scaling.
- Selected a single method-oriented virtual Actor API as the target.
- Kept Programs, Processes, Dependencies, and recursive Features as the
  complete substrate.
- Recorded automatic partitioning, membership, placement, directory,
  transport, activation management, distributed reminders, persistence
  lifecycle, rolling compatibility, and operations as explicit open work.
- Defined a validation ladder that keeps ordinary Actor work TypeScript-only
  and reserves native, multi-process, repository, and release gates for
  affected milestones.
- Closed F0 with the existing 35-test TypeScript Actor suite passing in 3.90
  seconds wall time and root TypeScript checking passing in 1.04 seconds. The
  focused suite changed no distribution artifact and invoked no package build
  or Rust compilation.
- Confirmed executable architecture guards reject `ActorRuntime`,
  `createActor`, Feature imports, and Feature policy in generic compiler,
  runtime, and native production machinery.
- Replaced the public command/query implementation split with one inferred
  `Methods`/`methods` surface. `Actor.Method` describes durable writes and
  `Actor.Read` marks the read-only optimization without changing invocation
  syntax.
- Removed per-handler Actor annotations and handwritten cyclic Actor
  Dependency contracts. Mutually dependent Actors now derive exact reference
  operations from one named `Methods` model.
- Fixed generic portable closure lowering so contextually typed factory
  callbacks recognize their own destructured Dependency binding. A
  non-Actor compiler regression fixture executes the resulting Dependency
  call.
- Kept durable journal event names internal for stored-history compatibility
  while renaming the authored scheduling context to `reminders`.
- Re-ran all 35 focused Actor behavior tests successfully in 2.72 seconds.
  The targeted generated-Rust differential fixture also passed in 21.98
  seconds, including restart evidence, with no Actor-specific backend.
- Confirmed identity-bound `Reference.get({ key })` cannot honestly be modeled
  as a remote wire operation because it returns a callable local reference.
  It requires one generic Dependency binding/lens mechanism shared by all
  Feature factories; no Actor-specific compiler case or unserializable wire
  facade will be introduced.
- Added that generic Dependency reference projection. The compiler retains its
  semantic contract, local execution and conformed hosts bind identity, and
  generated Rust lowers bound calls to the same serializable wire operations.
  A non-Actor compiler fixture, a runtime contract fixture, the public Actor
  integration test, and the generated-Rust differential fixture all pass.
- Standardized write calls as `(input, options?)` or `(options?)` for no-input
  methods. `wait` and `idempotencyKey` remain outside product input; replaying
  the same method and idempotency key retrieves the retained result. Caller
  wait cancellation and transport deadlines remain generic Dependency
  concerns, while cancelling durable work is an explicit domain method.
- Reserved `then` at the type level so logical references cannot accidentally
  become Promise-like. Added negative fixtures for invalid keys, method input,
  missing and extra methods, incompatible results, undeclared failures,
  foreign reminders, invalid migrations, and the reserved-name collision.
- Closed F1 after 35 Actor behavior tests, 48 generic source-compiler tests,
  focused generic Dependency-reference runtime evidence, root type checking,
  linting, and the generated-Rust Actor differential test all passed.
- Replaced the unbounded journal cache with explicit physical activation
  phases (`activating`, `active`, `idle`, and `failed`), monotonic local
  activation epochs, deterministic idle/LRU eviction, and a 256-entry soft
  capacity. Activations with accepted work are never eviction candidates.
- Added a pressure fixture that creates 260 logical Actors, proves the oldest
  idle activation cold-loads again, proves time-idle eviction, and proves a
  pending accepted method remains cached and completes exactly once. Existing
  crash, storage-partition, poison, ordering, cycle, and initialization
  fixtures continue to prove the unified Method runtime.
- Closed F2 with 36 focused Actor tests in 3.24 seconds, root type checking and
  linting green, and the generated-Rust differential/restart fixture passing in
  19.68 seconds. Snapshot acceleration and bounded durable recovery remain F3;
  startup registry scanning remains explicitly open until distributed
  scheduling and directory ownership are implemented.
- Extended the generic EventStore contract with snapshot load, optimistic
  snapshot save, and snapshot-guarded compaction. Memory, development SQLite,
  development JetStream, native SQLite, and native JetStream implementations
  preserve absolute stream revisions after physical reclamation.
- Added a versioned Actor snapshot containing migrated state, pending accepted
  work, the latest 1,024 settled outcomes, the latest 1,024 expiry tombstones,
  pending claims, and the latest generation event for each named reminder.
  Actor state is retained indefinitely by default; automatic deletion is not
  implied by compaction.
- Replaced quadratic invocation scans in snapshot construction and cold
  recovery with portable collision-safe indexes. The 1,025-outcome bounded
  history fixture now completes inside the focused suite rather than timing
  out.
- Proved snapshot-plus-tail restart equivalence, retained outcome retrieval,
  expiry tombstones, pending accepted work, old state and method-input
  migration, reminder recovery, snapshot CAS conflicts, compaction refusal,
  and a crash after durable snapshot persistence but before reclamation.
- Extended the real two-client NATS fixture to prove snapshot CAS, guarded
  subject purge, logical revision continuity, append after compaction, and
  reconnect recovery. Native SQLite and JetStream packages pass their focused
  tests, and the unchanged Actor Feature passes the generic generated-Rust
  differential/restart fixture in 20.52 seconds.
- Closed F3 with 39 focused Actor tests passing in 4.89 seconds under the
  concurrent milestone gate, two focused development-host tests, seven native
  EventStore package tests, root type checking, linting, formatting, real NATS
  integration, and generated-Rust execution. Configurable retention and
  operational deletion remain F8 work; generic remote routing begins in F4.
- Closed F4 by retaining declared Dependency failure and heartbeat schemas in
  canonical IR, linker compatibility, and Process manifests. Operation
  negotiation now uses collision-free canonical semantic identities and
  versioned canonical JSON wire messages.
- Added one generic remote Dependency runtime for async request/reply, ordered
  streams, typed failures, heartbeats, previous heartbeat state, deadlines,
  dynamic cancellation, heartbeat propagation, and W3C trace propagation.
  Synchronous operations fail before remote dispatch, and transport never
  retries arbitrary product work implicitly.
- Proved delayed and duplicate frames, out-of-order delivery, response loss,
  explicit retry with stable invocation identity, incompatible protocol and
  operation versions, and a compatible rolling addition. Incompatible
  requests fail before provider execution where certainty is possible.
- Proved an unrelated service and an identity-bound counter use the protocol
  without Actor vocabulary. The unchanged inventory Actor reference crosses
  the same protocol and preserves Feature-owned idempotency under a duplicated
  invocation.
- Closed the F4 focused gate with architecture/compiler/runtime tests, Actor
  tests, root type checking, linting, formatting, and the unchanged
  generated-Rust Actor differential. Production network/native transport remains F7;
  membership, owner resolution, and local-versus-remote routing begin in F5.
- Added a generic in-memory Process membership and directory state machine with
  versioned views, renewable leases, failure epochs, configurable virtual
  partitions, deterministic rendezvous placement, operation-level
  compatibility, monotonic ownership epochs, and stale-authority rejection.
  Compiler IR now retains Dependency reference binding fields; neither the
  compiler nor distribution runtime contains Actor vocabulary.
- Added one routed Dependency facade and Program-distribution hook shared by
  source Program assembly and portable IR execution. The facade uses direct
  local dispatch or the F4 transport without changing the semantic API.
  Adapter configuration owns member identity, targets, versions, leases,
  partition count, directory, and network.
- Proved deterministic minimal scale-out movement, expiry and restart epochs,
  local/remote equivalence, ordinary Feature assembly, incompatible-member
  exclusion, pre-execution stale rejection, Actor commit-time authority
  revalidation, accepted-work recovery after owner departure, and unchanged
  Actor behavior across one, three, and one replicas.
- Proved graceful drain rejects new asynchronous admissions through their
  Promise boundary, waits for in-flight work, and withdraws membership. Proved
  membership renewal extends liveness without changing failure identity.
  The focused Actor/distribution gate passes 51 tests in 3.67 seconds and root
  type checking passes without a package build or Rust compilation.
- F5 is complete at the deterministic TypeScript reference layer. Durable
  reminder movement remains F6; durable production membership/directory,
  genuine network/process failure, and native realization remain F7/F9 and
  are not implied by the in-memory evidence.
- Replaced Alarm callback registration with one serializable future Dependency
  target. The Actor Feature owns a hidden `$wake` Dependency operation, while
  the generic scheduler dispatches it through the same local-or-remote routed
  Dependency facade as every other call. `$wake`, scheduler targets, ownership,
  and placement remain absent from the public Actor API.
- Proved reminder delivery after one-to-three relocation and current-owner
  failure, duplicate delivery, replacement, cancellation, generation fencing,
  overdue total-cluster restart, and explicit self-rescheduling. Runtime
  generated direct invocation identities now include Process identity and
  failure epoch, preventing restarted replicas from colliding with retained
  durable calls.
- Added bounded EventStore reads across memory, development SQLite, native
  SQLite, and JetStream realizations. Actor registry repair traverses fixed
  256-entry pages; a 300-Actor fixture proves page continuation without
  unbounded reads. The Node and native Alarm implementations each use one
  bounded scheduler loop rather than process-local callbacks.
- Closed F6 at the semantic and deterministic reference layer with 69 affected
  TypeScript tests, 112 generic compiler/runtime checks, nine focused native
  Dependency tests, root type checking, and the generated native Actor
  differential fixture.
- Added the native shared Alarm realization without changing the public
  contract. When `KIT_NATS_URL` is configured, one JetStream work-queue stream
  owns replaceable NATS schedules and due delivery while one KV bucket retains
  generation-fenced current state. Cancellation and replacement invalidate
  stale due messages; successful targets acknowledge through a durable pull
  consumer, and retries retain stable invocation identity per generation.
- Proved a one-shot alarm survives complete scheduler loss across its deadline,
  then strengthened the generated Actor topology fixture to run one unchanged
  executable through one-to-three scale-out, abrupt owner loss, total
  application-cluster outage across a due reminder, cold recovery, and
  scale-in. Durable Counter state advances `1 -> 6 -> 10 -> 15`; the warm
  focused native gate passes in 9.2 seconds.
- Added a generic native Dependency startup lifecycle so autonomous host
  Dependencies become ready before Program logic. The default is a no-op,
  `ContractDependency` delegates it, and no Actor-specific compiler or runtime
  branch was introduced.
- Generated distribution contracts now retain the compiler-derived input,
  output, heartbeat, and structured-failure types. Both sides of the native
  NATS boundary reject malformed inputs, outputs, stream items, heartbeat
  details, and failure data before exposing them to product code; the same
  fixture preserves valid streams, deferred completion, cancellation,
  deadlines, stable invocation identity, and W3C trace context.
- Native inbound execution now has configurable bounded admission through
  `KIT_PROCESS_MAX_INFLIGHT`. Membership renewal is deadline-bounded; renewal
  or listener loss marks the replica unavailable, cancels admitted calls, and
  prevents new local or remote work. A real-NATS fixture proves overload
  rejection and fail-closed behavior after infrastructure loss.
- Re-ran the unchanged generated Actor reference/native differential corpus in
  27.31 seconds and the one-to-three-to-one process topology fixture after the
  compiler-derived contract change. F7 retains one focused release-profile
  smoke gate before closure.
- Closed F7 with the same unchanged Actor differential fixture compiled and
  executed in the production release profile in 83.96 seconds. Ordinary Actor
  iteration remains TypeScript-only; native debug checks are milestone gates,
  and release compilation remains a focused production gate.
- Added one generic Telemetry Dependency rather than Actor-owned logging.
  Actor policy emits calls, durable queue depth, activation/cache pressure,
  retries, reminder lag, and failures; Process distribution emits routing,
  admission, local/remote, retry, rejection, failure, and ownership-move
  counters. Development supplies a no-op sink, while native production writes
  canonical JSON lines only when `KIT_TELEMETRY_FILE` is configured.
- Added a versioned NATS Process control plane for status, readiness, bounded
  capacity, ownership inspection, graceful drain, and scoped/all ownership
  rebalance. Controls remain adapter operations and are absent from Actor
  source.
- Extended native trace realization through W3C baggage and proved a typed
  tenant authorization success/failure across the same generic remote
  Dependency boundary. Product authorization remains explicit Dependency
  meaning; NATS credentials protect transport and control subjects.
- Proved operation-level rolling compatibility natively: an incompatible
  operation version is excluded before execution, while a later member that
  retains the operation identity and adds an unrelated operation is eligible.
  Delivery uncertainty and external-effect idempotency are documented.
- Completed the nine-domain pressure corpus without adding another Actor
  facade. Inventory, account coordination, collaborative documents, and
  conversational agents retain their existing fixtures; device sessions,
  rate limiting, auctions, game rooms, and scheduled agents now run through
  the same compiled Program. All 50 focused Actor tests pass.
- Strengthened the one generated native topology fixture instead of creating
  scenario executables. Stable invocation identity absorbs duplicate
  delivery, an ordinary Timer call introduces execution latency, the native
  Clock applies bounded skew, a compatible Program version joins placement,
  SIGINT drains replicas, SIGKILL removes the current owner, and killing then
  restarting NATS proves partition healing and overdue reminder recovery. The
  unchanged Program preserves state through one-to-three-to-one execution in
  22.48 seconds.
- Replaced the old shared-storage relocation proxy in `actor:benchmark` with
  the generic Process directory and canonical Dependency transport. Schema 2
  now covers cold activation, warm local and remote calls, durable writes,
  many keys, one hot key, overload, reminders, accepted-work restart,
  snapshot recovery, scale-out, and failover. It reports raw samples,
  p50/p95/p99, throughput, approximate retained heap, cache hit rate, wire
  bytes, retained storage, and relocation latency under one declared
  durability setup.
- Added explicit `actor.cache.hits` and `actor.cache.misses` counters after the
  benchmark exposed that the existing `actor.activations` value is an
  operational gauge rather than a cache-miss counter. Cold and warm benchmark
  rates are now evidence rather than an inference from EventStore reads.
- Removed quadratic hot-key admission contention without changing Actor
  meaning. One internal admission gate serializes compare-and-append while the
  existing turn gate retains one write execution order; accepted-only
  self-scheduling uses only the admission gate and therefore remains
  non-blocking and cycle-safe. The 100-call hot-key benchmark improved from
  roughly 24 ms/operation and 40 operations/second to 2.57 ms/operation and
  386 operations/second, matching the sequential durable-write ceiling rather
  than hiding it. A structural source test observes zero rejected Actor-stream
  appends for 20 concurrent calls, all 50 Actor tests pass, and the generated
  native differential now executes a concurrent duplicate invocation through
  the same portable source.
- Completed the subtractive closure audit. Public Actor exports contain only
  the inferred method-oriented API; `actor.command.*` survives solely as the
  versioned journal vocabulary needed to read existing state. Generic
  distribution simulations remain canonical deterministic reference tests,
  while the benchmark and native topology use the real generic router. No
  process-local callback is treated as durable: development/fallback Alarm
  delivery is repaired from the Actor journal and native clustered delivery
  uses JetStream. The 50 source fixtures retain distinct semantic or
  durable-fault responsibilities, and related native cases remain combined in
  one differential executable and one topology executable.
- Closed F9 and the complete repository gate. The focused Actor
  release-profile differential passed in 68.38 seconds. The final
  `nub run check` passed 595 source tests across 58 files, every native
  workspace test, package construction, all example type checks, the reviewed
  public API snapshot and change intent, Presentation verification, genuine
  multi-process distribution, and the focused release-native Data smoke.
  Type checking, linting, formatting, and `git diff --check` were clean. No
  Actor-specific compiler node, native application handler, alternate facade,
  or handwritten feature translation was introduced.
