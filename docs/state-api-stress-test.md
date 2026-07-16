# Shared-state API stress test

Status: complete design evaluation, 2026-07-16

This document records and tests the proposed Poggers state model. It is a
design evaluation, not a claim that every described mode is implemented. The
current ordered Resource, replica, and durable Program machinery is real. A
convergent Resource implementation and a clustered substrate adapter are not.

## Question

Can distributed Programs coordinate exclusively through shared state while all
external behavior remains behind capabilities, without accumulating separate
public primitives for messages, actors, queues, projections, workflows,
presence, or subscriptions with ambiguous guarantees?

The proposed answer is yes, with two qualifications:

1. shared state has three irreducible semantic modes;
2. Programs have three irreducible ways to consume it.

Hiding either distinction produces an API that looks smaller but cannot state
its correctness guarantees.

## First-principles model

The core product concepts are:

- A **Resource** is a typed, keyed consistency, synchronization, and
  authorization boundary.
- A **Program** observes Resources, requests semantic transitions, and invokes
  capabilities.
- A **Capability** is an effect outside shared state, such as a filesystem,
  network client, clock, scheduler, model, search engine, or operating-system
  API.

Programs do not coordinate by addressing peers. They coordinate by observing
and conditionally changing Resources. Physical routing, storage, replication,
membership, leases, checkpoints, and placement belong to the substrate
adapter.

Every Resource is a state machine in the mathematical sense:

```text
state + requested transition + authority
  -> accepted changes + next state
  | typed rejection
```

A statechart is an optional notation for discrete control flow. It is not a
storage, replication, or distributed-coordination primitive. Event sourcing is
the durable recording strategy. A CRDT is a convergence law. Signals are the
local reactive delivery mechanism. These concepts are complementary rather
than alternatives.

## Minimal state modes

Two independent questions determine the required semantics:

1. Must the state survive every peer and process?
2. Must concurrent changes have one order, or may they merge?

The useful combinations produce three modes.

| Mode               | Semantics                                                    | Suitable information                                             |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Durable ordered    | One authoritative revision order per Resource                | money, ownership, jobs, workflow progress, permissions           |
| Durable convergent | Persisted causal operations with deterministic merge         | collaborative documents, offline annotations, shared collections |
| Current            | Latest peer-scoped observation with expiration and no replay | liveness, cursors, capacity, transient progress                  |

Correctness-critical leases are durable ordered state containing an expiry and
fencing token. A heartbeat is current state. `current + ordered` therefore does
not need to become a fourth mode.

Local component context, animation values, caches, and device-only preferences
are not shared substrate state. Component state machines and fine-grained
reactive values own the first two; a device capability owns the latter two.

Derived state is not another mode. A durable projection is another Resource. A
local derived value is a memoized computation over already authorized state.

## Proposed definition surface

The generic contract supplies all names and types. A plain object implements
it; no runtime `defineResource()` wrapper is required for type safety.

```ts
type Document = {
  Key: { documentId: string };
  Durable: {
    Consistency: "ordered";
    State: { title: string; content: string };
    Actions: {
      rename: {
        Input: { title: string };
        Output: void;
        Error: { type: "empty-title" } | { type: "forbidden" };
      };
    };
    Events: { renamed: { title: string } };
  };
  Current: {
    State: {
      collaborators: Readonly<Record<string, { anchor: number; focus: number }>>;
    };
    Actions: {
      moveSelection: {
        Input: { anchor: number; focus: number };
        Output: void;
        Error: never;
      };
    };
  };
};

const document = {
  durable: {
    initial: { title: "Untitled", content: "" },
    decide: {
      rename({ state, principal }, { title }) {
        if (!principal.canEdit) return { error: { type: "forbidden" } };
        if (!title.trim()) return { error: { type: "empty-title" } };
        if (state.title === title) return { events: [] };
        return { events: [{ renamed: { title } }] };
      },
    },
    apply: {
      renamed(state, { title }) {
        return { ...state, title };
      },
    },
  },
  current: {
    expiresAfter: 15_000,
    change: {
      moveSelection({ state, peer }, selection) {
        return {
          ...state,
          collaborators: { ...state.collaborators, [peer.id]: selection },
        };
      },
    },
  },
} satisfies Resource<Document>;
```

The exact spelling is provisional. The semantic requirements are not:

- every action takes one object;
- accepted durable changes are explicit and may number zero, one, or many;
- typed rejection may carry structured data;
- durable transition and fold logic are deterministic;
- current updates identify their owning peer and expiration behavior;
- read and transition authorization execute at the Resource boundary;
- convergent Resources replace ordered `decide` with a causal merge law;
- the Resource contract is closed by a generic type parameter.

Capabilities cannot be called from a reducer. A Program obtains external
information and submits the resulting fact through a semantic Resource action.

## Proposed feature-facing surface

Applications consume a semantic API selected by a Feature factory. Resource
storage vocabulary does not leak through it.

```ts
const document = app.documents.get({ documentId });

document.title;
document.content;
document.collaborators;
document.sync;

const submission = document.rename({ title: "Architecture" });
document.moveSelection({ anchor: 10, focus: 18 });

submission.phase; // preparing | queued | submitted | uncertain | committed | rejected
submission.outcome; // typed success, typed rejection, or undefined
await submission; // the same typed outcome
```

Values are values and actions are functions. Property reads are tracked in UI,
component-machine, and Preset reactive scopes. There is no product-facing
`dispatch`, `select`, `setState`, event-log cursor, actor reference, or raw
presence setter. State and action name collisions are rejected when the Feature
API is constructed.

The effective local value is always:

```text
committed replica + pending local transitions = effective reactive state
```

`sync` reports only replica lifecycle: readiness, synchronization, staleness,
and connection failure. `Submission` is the one operation-lifecycle surface;
`sync` must not duplicate its pending, uncertainty, correction, or rejection
information.

An action's `Output` is part of its durable receipt. A duplicate intent returns
the same output. This is required for actions that allocate an identifier or
return a durable decision; recomputing an output after retry would be unsafe.

## Minimal consumption semantics

One generic `subscribe()` cannot safely cover all Program use cases. Programs
need three operations with deliberately different guarantees.

| Operation | Meaning                                       | Guarantee                                                 |
| --------- | --------------------------------------------- | --------------------------------------------------------- |
| Read      | Obtain the current authorized Resource value  | point-in-time snapshot                                    |
| Watch     | Reconcile whenever the latest value changes   | level-triggered, coalescing allowed, no replay obligation |
| React     | Handle every selected durable accepted change | checkpointed, replayable, at least once                   |

UI reactivity is an automatic Watch scoped to mounted hierarchy. Programs use
an explicit Watch for controllers and current state, and a statically declared
durable reaction for projections and effects.

A durable consumer must have a stable identity, initial replay policy, event
selection, ordering key, version, checkpoint, attempt, and fencing epoch. Most
of these are runtime metadata, but identity and bootstrap semantics must be
derivable from static application structure. An anonymous callback registered
dynamically cannot provide a safe durable identity across deployments.

The clean Program shape is therefore one Program per environment with
statically named durable reactions and unrestricted lifecycle code:

```ts
program: {
  server: {
    reactions: {
      indexDocuments: {
        events: ["documents.renamed"],
        startAt: "origin",
        async run({ event, app, delivery }, capabilities) {
          await capabilities.search.index({
            id: event.key.documentId,
            title: event.payload.title,
            idempotencyKey: delivery.id,
          });
        },
      },
    },
    async run({ app, watch, signal }, capabilities) {
      // Unrestricted process-scoped work and level-triggered reconciliation.
    },
  },
}
```

The property name `indexDocuments` is the durable identity; application code
does not repeat it as a string. `startAt` is irreducible: replaying historical
emails is wrong, while failing to replay a new projection is also wrong. A
Feature factory can provide a stronger domain-specific default.

## Information available to Programs

A durable reaction needs the accepted fact, not an ambiguous snapshot:

- stable event and causation identity;
- Resource name, key, revision, event index, and schema version;
- typed payload, accepting principal, and authoritative timestamp;
- delivery attempt, uncertain prior attempts, and stable idempotency identity;
- the complete semantic application API for reading current state and
  requesting further actions;
- cancellation for the current fenced delivery.

The event payload must contain the facts needed to project it deterministically.
The application API returns current state at handling time. It is not state as
of the event revision. A reaction that folds every ordered event already owns
the historical progression it needs; an exceptional historical query should be
an explicit capability rather than a misleading default `view` field.

A Watch callback receives the latest authorized state and synchronization
status. Intermediate values may be coalesced. It must not expose a reliable
`previous` value or invite edge-triggered logic. Code that must observe every
accepted change uses a durable reaction.

An unrestricted environment `run` function receives the semantic application
API, Watch registration, capabilities, and cancellation. Native callbacks,
servers, and OS listeners belong there. Their cleanup is owned by the Program
scope. If a callback matters after process failure, it records a Resource
transition before acknowledging the external source.

## Projection model

Four cases that are often all called projections have different semantics.

### Local derivation

`pendingCount` derived from an already replicated order list is a memoized
reactive value in the Feature API. It has no checkpoint or storage.

### Durable Resource projection

An order summary used by many peers is a target Resource maintained by a named
durable reaction. The source event identity automatically becomes the target
action intent identity. Redelivery therefore returns the prior receipt instead
of applying the projection twice.

This provides effectively-once projection updates inside the substrate without
claiming exactly-once callback execution.

### Transactional projection

If target update and source checkpoint share one adapter transaction, the
adapter may optimize them atomically. Correctness must not depend on that
optimization: stable event identity and target deduplication preserve the same
result on an adapter that only offers at-least-once delivery.

### External projection

A search engine, warehouse, or vector index is a capability. Its handler is
at-least-once and must use a stable idempotency key, reconcile an uncertain
outcome, or rebuild from authoritative state. The framework cannot promise
exactly once across an arbitrary external system.

Projection progress is runtime metadata, not a product Resource. Rebuilding a
new projection requires source history from `origin` or an explicit bootstrap
snapshot. If retention has removed the required history, startup must fail
rather than silently begin at the retained floor. Projection version changes
require replay, compatible progress migration, or a new identity.

## Stress-test matrix

| Scenario                                         | State and consumption                                                                 | Verdict                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Order aggregate                                  | ordered Resource; actions and reactive read                                           | covered                                                                |
| Action allocates an identifier                   | output persisted in the command receipt                                               | covered by target contract; current API needs richer outputs           |
| Bank transfer across two accounts                | coordinator Resource; idempotent actions on both accounts; compensating failure state | expressible, no cross-Resource transaction promised                    |
| Search read model                                | durable consumer into projection Resource                                             | covered if stable identity, replay, and dedup are retained             |
| External search index                            | durable consumer into capability                                                      | at least once; idempotency or rebuild required                         |
| Worker availability and job claim                | current worker status plus ordered job claim with fence                               | covered; current state alone is insufficient                           |
| Multi-machine desired-state controller           | Watch desired and observed Resources; reconcile repeatedly                            | covered; level-triggered Watch is necessary                            |
| Offline optimistic order creation                | ordered replica with pending intent and correction lifecycle                          | covered by proposed API; rejection and rebase remain mandatory tests   |
| Collaborative offline editor                     | convergent Resource plus current cursors                                              | semantically covered; implementation is missing                        |
| Browser cursor presence                          | current Resource state with expiry                                                    | covered; loss and coalescing are acceptable                            |
| Long-running desktop agent                       | environment Program `run`; OS capability; Resource coordination                       | covered if cleanup and restart are owned by runtime                    |
| Scheduled workflow                               | durable workflow Resource and scheduler capability                                    | expressible; efficient non-occupying durable timers remain missing     |
| User-hosted worker provisioning                  | durable desired assignment, current host inventory, fenced claim                      | covered without peer-addressing API                                    |
| Private client read model                        | separate authorized projection Resource                                               | covered; partial source-state replication is intentionally rejected    |
| Capability query used only by one UI             | cancellable component task and local reactive state                                   | covered; it should not become shared state                             |
| Capability result shared by peers                | Program writes result into a Resource                                                 | covered                                                                |
| Consumer of several Resource types               | durable changes; no assumed cross-Resource total order                                | covered by a coordinator Resource when order matters                   |
| Projection needs state at event time             | fold ordered events or carry sufficient facts in each event                           | covered; a latest-state `view` would be incorrect                      |
| List every Resource instance                     | maintain a collection/index Resource from accepted changes                            | covered; no adapter-dependent Resource scan in product APIs            |
| Reaction code changes after partial progress     | definition version plus replay, migration, or new identity                            | covered by current Program metadata                                    |
| Many reactions consume one event                 | independent durable identities and checkpoints                                        | covered; adapter owns fan-out                                          |
| Hot Resource key                                 | one ordered key cannot be split without changing semantics                            | explicit limitation; model finer Resource keys                         |
| Cluster rebalance during a handler               | checkpoint, assignment fence, retry, stable intent identity                           | covered by substrate contract, not yet by a production cluster adapter |
| Compaction before a new projection               | retained floor check and explicit snapshot bootstrap                                  | API gap: bootstrap is not yet a product-level facility                 |
| Principal loses access while offline             | server rejects pending action; replica removes inaccessible state                     | semantic gap requiring focused revocation tests                        |
| Deleted Resource with late CRDT operations       | tombstone and causal retention frontier                                               | convergent-state design gap                                            |
| Two Programs race to perform one effect          | durable claim or idempotent external key                                              | covered; current liveness cannot decide ownership                      |
| Program crash after effect but before checkpoint | redelivery with uncertain attempt and same idempotency identity                       | covered by current delivery model                                      |

## Adversarial thought experiments

### Duplicate and reordered delivery

Every durable event has a stable identity independent of adapter location.
Internal target actions inherit that identity. Same-Resource order is retained;
cross-Resource total order is not promised. A Program requiring a total order
must write the competing facts into one coordinator Resource.

### Disconnect and optimistic divergence

An ordered client may apply pending actions locally. On reconnect, authority
orders or rejects them and the replica rebases the remaining pending actions.
The UI observes effective state and Submission lifecycle. A convergent client
exchanges causal operations and does not need authority to order merge-safe
edits, but authorization may still reject unauthorized operations.

### Crash during projection

If the target Resource update committed but the checkpoint did not, redelivery
uses the same intent and returns the existing receipt. If neither committed,
the update runs normally. If an external effect completed but acknowledgment
was lost, the attempt is explicitly uncertain and the capability must reconcile
or deduplicate.

### Compaction and replay

Physical compaction is invisible. Logical retention is observable. Resource
snapshots accelerate Resource recovery but cannot bootstrap an arbitrary new
projection. A projection-specific snapshot may do so only when its source
frontier and schema are explicit. Otherwise `startAt: "origin"` fails when the
origin is no longer retained.

### Horizontal execution

The adapter assigns stable key groups to peers and fences stale owners. Program
code names semantic ordering only. Rebalancing changes physical ownership but
not the durable consumer identity or checkpoint. A custom ordering key spanning
source splits requires an adapter shuffle, a validated singleton fallback, or
startup rejection.

### Authorization

Identity proof is a capability; durable grants and membership are Resources.
Read and action authorization execute against the current principal and
Resource state. A Resource is the authorization boundary. If a client may see
only a projection and not the source, that projection is a separate Resource
with its own authorization, history, and synchronization contract.

## Findings against the current proposal

The flat Feature API, typed actions, Submission lifecycle, Resource authority,
and split between durable and current state survive the stress test.

The proposal was incomplete in these areas:

1. `subscribe()` conflated Watch and durable React.
2. anonymous durable callbacks had no stable identity or bootstrap policy.
3. projections lacked explicit replay, checkpoint, and retention semantics.
4. delivery uncertainty and idempotency were absent from Program examples.
5. convergent state named CRDTs without defining causal frontier, tombstone,
   authorization, snapshot, and compaction laws.
6. current state lacked explicit best-effort, ownership, expiry, and
   non-authoritative guarantees.
7. replica loading, staleness, failure, and access revocation needed one
   coherent `sync` value, while per-action uncertainty and rejection remain
   solely on `Submission`.
8. the examples did not explain that cross-Resource ordering and transactions
   are intentionally absent.
9. an event-associated `view` did not distinguish current state from state at
   the event revision and was therefore unsafe for deterministic projections.

The current code already contains stronger ordered-Resource and durable-Program
semantics than the simplified proposal: command receipts, stable event IDs,
replay selection, precise checkpoints, uncertainty, fencing, retained floors,
and adapter validation. These must be simplified at the authoring surface, not
deleted from the runtime.

## Minimal sufficient target

The lower-level system needs only:

1. `Resource<Contract>` with durable ordered, durable convergent, and current
   state semantics;
2. semantic Resource actions returning reactive typed Submissions;
3. plain reactive reads through Feature-selected APIs;
4. level-triggered Watch for latest-state reconciliation;
5. statically identified durable reactions for checkpointed change handling;
6. one lifecycle-managed `run` function per environment;
7. capabilities for everything outside shared state.

Queues, workflows, locks, leases, projections, schedulers, actors, and
domain-specific event APIs remain Feature factories built from those
mechanisms. They do not become additional application primitives.

## Implementation delta

This evaluation does not justify replacing the current runtime wholesale. It
defines a smaller authoring target and identifies focused deltas:

- replace `State` plus `Views` with one authorized reactive state surface, with
  local derivations in Feature APIs and durable derivations as Resources;
- rename `Presence` to `Current` and specify ownership, expiry, and loss laws;
- flatten Resource values and semantic actions only through Feature APIs;
- retain `Submission` and make its lifecycle the sole optimistic-operation
  surface;
- retain durable consumer metadata while organizing reactions statically under
  one environment Program;
- expose Watch separately from durable reactions;
- remove raw `setPresence`, `.identified`, Resource-name hooks, and anonymous
  product-facing `subscribe` from the final surface;
- design and implement the convergent Resource contract before claiming CRDT
  support;
- add projection bootstrap and access-revocation scenarios to the substrate
  conformance suite.

These are proposed implementation changes. They require a separate reviewed
migration plan because the current worktree contains an active architecture
rewrite and the convergent-state semantics are not yet designed sufficiently
for implementation.

## Verification gates

- [x] The proposal distinguishes retention from coordination law.
- [x] Values remain values and actions remain functions at the Feature API.
- [x] Ordered, convergent, and current state have non-overlapping guarantees.
- [x] Read, Watch, and durable React have non-overlapping guarantees.
- [x] Projection checkpoints and delivery attempts remain runtime metadata.
- [x] Internal projection updates remain correct under duplicate delivery.
- [x] External effects are not falsely described as exactly once.
- [x] Offline rejection, rebase, and operation lifecycle are represented.
- [x] Compaction cannot silently change replay semantics.
- [x] Horizontal placement remains adapter-owned.
- [x] Cross-Resource ordering and transaction limits are explicit.
- [x] Authorization and private projections have one coherent path.
- [x] Long-running services and event reactions fit one environment Program.
- [x] Missing convergent-state and projection-bootstrap work is stated rather
      than implied complete.

## Research anchors

- [Akka projection guide](https://doc.akka.io/libraries/guide/microservices-tutorial/projection-query.html): sharded source ranges, same-entity ordering, and transactional projection state plus offset.
- [Akka Projection running model](https://doc.akka.io/libraries/akka-projection/current/running.html): stable projection identity and distributed ownership constraints.
- [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream): replay, retention, acknowledged delivery, deduplication, and horizontally shared pull consumers.
- [NATS consumers](https://docs.nats.io/nats-concepts/jetstream/consumers): durable consumer state, redelivery, flow control, and delivery policies.
- [Automerge ephemeral data](https://automerge.org/docs/reference/repositories/ephemeral/): document-scoped current information that is intentionally not persisted.
