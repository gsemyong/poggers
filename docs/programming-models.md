# Programming Model Research

This document answers one question:

> Which reusable programming models should Kit provide above its neutral
> `Program`, `Dependency`, and `Feature` substrate?

It is a decision record, workload matrix, and falsification ledger. It does not
introduce new core concepts or approve an implementation merely because it is
possible to build.

## Conclusion

Kit's only universal programming substrate remains:

1. `Program` for executable meaning in one Environment;
2. `Dependency` for typed interaction with authority outside that Program;
3. `Feature` for reusable vertical composition of Programs and Dependencies.

No fixed collection of higher-level models is both minimal and optimal for all
software. Higher-level models are optional packages of distinctive guarantees.
They belong in one of three places:

1. a reusable Feature factory when existing Program languages can express the
   behavior and the factory packages recurring correctness;
2. a Platform-owned Program language when authoring, scheduling, state,
   compilation, and realization have fundamentally different semantics;
3. a Dependency when the concern is replaceable external authority rather than
   authored application behavior.

The evidence supports the following initial catalogue:

| Concern                                               | Kit placement                           | Decision                          |
| ----------------------------------------------------- | --------------------------------------- | --------------------------------- |
| Durable keyed state with serialized commands          | `Actor` Feature factory                 | Keep and audit                    |
| Durable long-running control flow                     | `Workflow` Feature factory              | Add only after conformance design |
| Database, transactions, search, vectors, graph, blobs | Dependencies                            | Keep outside the core             |
| Server-authoritative optimistic synchronization       | Narrow Feature factory                  | Specify separately                |
| Independent multi-writer replicated documents         | Narrow CRDT/sync Feature factory        | Specify separately                |
| Event-time stateful dataflow                          | Platform-owned Program language         | Defer until a real workload       |
| Deterministic high-frequency simulation/ECS           | Platform-owned Program language         | Defer until a real workload       |
| AI agents and memory                                  | Composed domain Feature factories       | Never foundational                |
| Tasks, futures, state machines, retries               | Program-language constructs or helpers  | No new universal model            |
| Event sourcing and CQRS                               | Internal patterns selected by a factory | Never universal defaults          |

`Relation` and `Procedure` are not accepted Kit vocabulary. Relational data and
durable workflows are established concepts with different ownership and
semantics; inventing umbrella names makes the boundary less clear.

## Method

The analysis uses four forms of evidence:

1. published programming models and their stated guarantees;
2. official documentation from mature runtimes that support several models;
3. engineering reports from applications with materially different workloads;
4. adversarial thought experiments that try to replace every candidate with a
   simpler existing Kit concept.

The survey covers:

- actors and virtual actors: Orleans, Service Fabric, Erlang/OTP, Akka,
  Cloudflare Durable Objects, Ray, and Restate;
- durable control flow: Temporal, Cadence, Restate, and Durable Task;
- transactional and queryable state: the relational model and FoundationDB;
- replicated state: CRDT literature, Automerge, and Figma's centralized
  multiplayer design;
- stateful dataflow and batch computation: Google Dataflow, MillWheel,
  MapReduce, Flink, Ray Data, and Akka Streams;
- simulation: Bevy ECS and Unity Entities;
- application architectures: Telegram's documented client architecture,
  Discord messaging and search, Uber Marketplace and Cadence, Stripe usage
  billing, Figma multiplayer, and Orleans/Halo;
- agent runtimes: AutoGen, LangGraph, and Mastra.

Public material does not expose Telegram's complete server architecture. The
matrix therefore uses TDLib only as evidence for client-side asynchronous
requests, ordered updates, local persistence, networking, and encryption. It
does not invent claims about Telegram's private server implementation.

## Decision Test

A candidate must pass every applicable question.

### Dependency

Use a Dependency when all of the following hold:

- the caller needs authority owned outside its local implementation;
- multiple implementations can preserve the same semantic contract;
- switching implementation should not alter product behavior;
- the concern does not require a new Program body or scheduler.

The contract includes observable guarantees, not just operation signatures. A
linearizable store and an eventually consistent store, or an at-most-once queue
and an at-least-once queue, are not interchangeable implementations unless the
product-facing contract explicitly admits both behaviors.

Examples include transactions, object storage, search, embeddings, pub/sub,
queues, clocks, identity, model inference, speech, sandbox execution, and
transport.

### Reusable Feature Factory

Use a Feature factory when all of the following hold:

- it packages portable behavior, not merely access to infrastructure;
- the same correctness protocol recurs across unrelated products;
- the authority, consistency, identity, time, and failure model can be stated
  precisely;
- ordinary Programs plus raw Dependencies would force each product to rebuild
  the same difficult machinery;
- development and production can execute equivalent semantic meaning;
- a reusable conformance suite can verify the claimed guarantees.

### Platform-Owned Program Language

Use a new Program language only when:

- the authored body needs a different execution model;
- its compiler needs model-specific semantic IR;
- its scheduler, partitioning, state layout, or time model affects correctness;
- hiding it behind ordinary calls would prevent essential optimization or
  static validation.

### Ordinary Feature Or Helper

Keep a concern as an ordinary domain Feature or pure helper when it contributes
composition or vocabulary but no new authority, execution model, or reusable
runtime guarantee.

## Semantic Model Matrix

| Model                    | Unit of identity                      | Concurrency and time                                   | State and recovery                          | What it is good at                                               | What it is bad at                                          | Kit placement                                     |
| ------------------------ | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Ordinary Program         | Process or invocation                 | General TypeScript control flow                        | Explicit Dependencies                       | Stateless APIs, custom algorithms, adapters, glue                | Repeated distributed correctness protocols                 | Universal substrate                               |
| Task/data parallelism    | Invocation or dataset partition       | Scheduler-controlled parallel work                     | Outputs, lineage, or retry policy           | Independent CPU/GPU work and bounded datasets                    | Long-lived keyed identity                                  | Program runtime construct or specialized language |
| Actor/virtual actor      | Actor type plus key                   | Serialized turn per key; parallel across keys          | Durable per-key state, journal, or snapshot | Isolated stateful entities and coordination atoms                | Cross-key queries, global invariants, hot keys, bulk scans | Feature factory                                   |
| Durable workflow         | Workflow type plus execution ID       | Replay-safe logical time and durable waits             | Event history or checkpoints                | Multi-step control flow, timers, signals, compensation           | High-frequency state mutation and global ad hoc queries    | Feature factory                                   |
| Transactional data       | Transaction over records/keys         | Serializable or declared isolation                     | Database log, replicas, recovery            | Cross-record invariants, indexes, arbitrary queries              | Per-identity encapsulated behavior and long waits          | Dependencies plus domain schema/query Features    |
| Replicated document      | Document plus replica/change identity | Causal or merge-defined ordering                       | Operation/change graph and local replicas   | Offline multi-writer collaboration                               | Central financial invariants and unrestricted queries      | Narrow Feature factory                            |
| Stateful dataflow        | Operator graph and partition          | Event time, watermarks, windows, backpressure          | Checkpoints and replay                      | Unbounded streams, aggregation, fraud, telemetry                 | Interactive per-entity command APIs                        | Platform-owned Program language                   |
| Batch dataflow           | Dataset and graph node                | Bounded DAG scheduling                                 | Recomputed or checkpointed partitions       | Large scans, ETL, model training                                 | Interactive low-latency state                              | Platform-owned language when required             |
| ECS/simulation           | World, entity, component, tick        | Deterministic or scheduled systems over component sets | World snapshots or domain persistence       | Dense high-frequency simulation and cache-efficient bulk updates | Durable business workflows and arbitrary database queries  | Platform-owned Program language                   |
| State machine/statechart | State plus event                      | Run-to-completion transition                           | Whatever enclosing model provides           | Explicit domain lifecycle and visual inspection                  | Distribution, durability, storage, and scaling by itself   | Helper inside Programs, Actors, or Workflows      |

The models differ along dimensions that cannot be erased safely:

- identity: request, key, workflow run, record set, document, partition, world;
- authority: process, single keyed owner, transactional coordinator, replica,
  operator, or simulation scheduler;
- time: wall time, durable logical time, event time, causal time, or ticks;
- failure: retry, replay, rollback, merge, checkpoint recovery, or world restore;
- scaling: stateless replicas, key sharding, transaction partitions, operator
  parallelism, or world partitioning;
- query: local state, cross-record indexes, continuous aggregation, or component
  set iteration.

### Language-Level Models

Several established models do not justify universal Feature factories:

- futures, promises, structured concurrency, and fork/join express local or
  scheduled concurrency inside a Program;
- CSP-style channels express communication and synchronization between
  concurrent processes, but do not by themselves define deployment,
  persistence, delivery, or recovery guarantees;
- state machines and statecharts make lifecycle transitions explicit but rely
  on an enclosing Actor, Workflow, UI, or Program for execution and durability;
- functional, object-oriented, logic, and rule-based programming are ways to
  express computation, not additional System composition boundaries;
- reactive values and UI dataflow belong to UI-capable Platform languages;
- publish/subscribe and queues are delivery authorities represented by
  Dependencies unless a stateful dataflow Program owns the processing graph.

They remain available as Program-language constructs, typed helpers, or
Platform-specific extensions. Promoting each one into a Feature factory would
duplicate the role of the selected Program language.

### Entity Is Not One Model

`Entity` is an overloaded domain noun rather than a complete execution
contract. The same product entity may be:

- a row participating in multi-record transactions;
- a virtual Actor with serialized keyed behavior;
- a replicated document with merge semantics;
- an ECS identity carrying components;
- a workflow execution with a finite lifecycle.

An API named only `Entity` therefore leaves authority, query, concurrency,
time, and failure semantics unstated. A public factory must use a narrower name
or make one exact model unmistakable in its contract.

## Workload Matrix

The matrix decomposes products into workloads rather than assigning one model
to an entire application.

| Product or subsystem               | Required semantics                                                                       | Best expression in Kit                                               | Why alternatives fail                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Public static website              | Deterministic documents, metadata, assets, caching                                       | Web Programs and Presentation                                        | Actors, workflows, and databases add no value                                                       |
| Authenticated business UI          | Local responsive state, commands, server authority                                       | Web Programs plus typed Dependencies                                 | A server execution model should not leak into rendering                                             |
| CRUD records                       | Validation, authorization, transactions, indexed query                                   | Domain Feature over transactional/query Dependencies                 | Actor-per-row makes set queries and cross-row constraints awkward                                   |
| Offline optimistic CRUD            | Immediate local projection, queued intent, rejection reconciliation                      | Narrow server-authoritative sync Feature                             | A CRDT promise would misstate central authority and rejection                                       |
| Collaborative text/design document | Concurrent offline edits and deterministic convergence or one central document authority | Document-specific sync Feature                                       | Generic CRUD loses merge semantics; generic actors do not define offline merge                      |
| Chat-room coordination             | One active ordering/coordination atom, membership, transient presence                    | Actor per room where load permits                                    | One global actor becomes a hot key; a database alone does not serialize live room behavior          |
| Message history                    | Append, pagination, retention, partition-aware query                                     | Database Dependency and domain Feature                               | Actor state is a poor unbounded history/index                                                       |
| Message search                     | Asynchronous indexing, alternate sharding, rebuildability                                | Queue/stream plus search Dependencies                                | The write authority and search projection have different scaling and recovery                       |
| Media transfer and voice           | Continuous bidirectional transport, congestion and latency control                       | Realtime/media Platform Program plus network Dependencies            | Durable workflows and actors are not media pipelines                                                |
| Ride/trip lifecycle                | Durable keyed coordination and state transitions                                         | Actor or stateful domain Feature                                     | Pure stateless handlers duplicate ordering and recovery logic                                       |
| Marketplace dispatch               | Spatial/global matching across many drivers and riders                                   | Custom Program using indexes, streams, and optimization Dependencies | Isolated actors cannot efficiently optimize over the whole candidate set                            |
| Dynamic pricing/fraud              | Unbounded events, event-time windows, keyed aggregates                                   | Stateful dataflow Program                                            | Actor messages do not supply watermarks, backpressure, or coordinated checkpoints                   |
| Payment ledger                     | Atomic invariants, idempotency, auditable entries, reconciliation                        | Transactional ledger Dependency and domain Feature                   | Eventually consistent replication and isolated actors cannot protect cross-account invariants alone |
| Order/onboarding fulfillment       | Long waits, retries, compensation, signals, child work                                   | Workflow Feature                                                     | Actor state can implement this internally but exposes the wrong authoring and inspection model      |
| Usage-based billing                | High-rate ingestion, event-time aggregation, delayed correction, durable ledger          | Stream Program plus transactional ledger Dependency                  | One model cannot optimize both the fast aggregation path and authoritative financial path           |
| User/account/session               | Keyed state and serialized policy changes                                                | Actor when behavior is dominant; database when query is dominant     | The correct choice depends on access shape, not the noun "entity"                                   |
| Multiplayer match simulation       | Fixed/high-rate ticks, bulk spatial and physics updates, deterministic ordering          | ECS/simulation Program language                                      | Actor-per-object creates excessive messaging and poor memory locality                               |
| Game inventory/economy             | Transactional ownership and anti-duplication invariants                                  | Actor plus transactional Dependency, or transactional domain Feature | Simulation state alone is not durable economic authority                                            |
| IoT telemetry                      | Unbounded out-of-order events, windows, alerting, retention                              | Stateful stream Program plus time-series Dependency                  | Actor-per-device does not solve aggregate/event-time queries                                        |
| Analytical reporting               | Large scans, joins, columnar execution, reproducibility                                  | Analytical database or batch Dependencies/Programs                   | Actors and workflows are control-oriented rather than scan-oriented                                 |
| Durable AI entity                  | Stable identity, serialized state changes, reminders                                     | Actor-backed domain Feature                                          | A chat loop without durable identity loses continuity                                               |
| AI research/automation             | Dynamic plans, parallel work, durable waits, approvals, tool effects                     | Agent domain Feature over Workflow/Actor and Dependencies            | "Agent" does not replace durable execution, search, models, or sandboxes                            |
| Voice AI conversation              | Low-latency audio, transcripts, dynamic policy, background cognition                     | Realtime Platform Program plus Agent/Actor state                     | Persisting audio turns directly in an actor blocks the media path                                   |
| Peer-to-peer application protocol  | Typed messages, discovery, security, replication chosen by domain                        | Custom Programs plus transport Dependencies                          | A universal actor or CRDT policy would constrain protocol semantics                                 |

## Hard Application Decompositions

### Telegram Or Discord Class Messaging

A messaging product needs at least:

- web/native UI Programs;
- a local client database and ordered update protocol;
- stateless edge/API Programs;
- keyed coordination for active rooms or sessions where useful;
- durable message storage partitioned for history access;
- independently scalable and rebuildable search indexes;
- presence and fanout using realtime transport;
- media storage and realtime voice/video transport;
- moderation, notification, and retention workflows.

TDLib documents asynchronous requests, ordered updates, networking, encryption,
and local storage as one client library. Discord documents message storage
partitioned by channel and time, while its search system uses separate queues,
workers, indexes, and sharding. Those are separate guarantees, not one "data"
model.

Pressure case: a celebrity broadcast room can overload one serialized room
owner. The design needs partitioned fanout and storage even if an Actor owns
membership or ordering.

### Uber Class Marketplace

A ride marketplace combines:

- keyed trip lifecycle and active session coordination;
- spatial indexes and global matching algorithms;
- realtime location/event ingestion;
- stateful stream processing for pricing and fraud;
- transactional payment and ledger systems;
- durable fulfillment and support workflows;
- analytics and machine learning pipelines.

Uber's published architecture explicitly separates persistence, matching,
realtime transactions, stateless edge endpoints, sharded ownership,
stream-processing systems, databases, search, and workflow orchestration.

Pressure case: dispatch must compare many drivers and riders at once. Encoding
each participant solely as an isolated Actor moves the central optimization
problem into expensive cross-Actor communication.

### Figma Class Collaborative Editor

Figma's document collaboration uses a server-authoritative design inspired by
several CRDT techniques, while comments, users, teams, and projects live in
PostgreSQL and synchronize through another system. This disproves a universal
local-first entity abstraction.

Pressure case: two offline users editing one property require a merge policy;
transferring money between them requires a central invariant. The same API
cannot honestly promise both without exposing different semantic modes.

### Multiplayer Game

A game can use:

- Actors for accounts, parties, matchmaking tickets, and durable sessions;
- ECS for a dense authoritative match simulation;
- realtime transport for input and snapshots;
- transactional state for inventories and purchases;
- streams for telemetry and anti-cheat analysis;
- workflows for tournaments, rewards, and delayed operations.

Pressure case: 100,000 simulated objects updated at 60 Hz need bulk component
iteration and memory locality. Actor-per-object message dispatch is the wrong
execution shape even though an Actor may own the match as a durable lifecycle.

### Financial Usage Platform

Stripe describes a fast streaming path for timely usage feedback and a slower
durable ledger path for delayed events, invoicing, analytics, and financial
records. This is direct evidence that latency-oriented stream state and
authoritative transactional history are complementary.

Pressure case: forcing both paths into a single abstraction either weakens
financial correctness or sacrifices ingestion throughput and event-time
handling.

### Durable AI Entity

A capable long-lived AI system requires:

- an Actor or equivalent keyed authority for identity and mutable durable state;
- a Workflow for inspectable long-running plans, waits, approvals, and
  compensation;
- model, speech, search, database, sandbox, device, and network Dependencies;
- realtime Programs for voice and other continuous modalities;
- domain Features for memory curation, policy, evaluation, and user-facing
  interfaces.

AutoGen uses actors for event-driven agents but still separates memory, model,
tools, runtime, and extensions. LangGraph separates durable graph execution,
checkpoints, long-term stores, queues, streaming, and deployment. Mastra
separates agents, workflows, memory, tools, voice, and durable scheduling.

Pressure case: an Actor can store a plan, but that alone does not provide
workflow replay, child-run policy, human approval inspection, model inference,
semantic search, or safe code execution.

## Falsification Ledger

### Hypothesis: Actor Is The Universal Application Model

**Result: falsified.**

Actors provide isolated keyed state and serialized turns. Service Fabric's own
guidance recommends them for many small independent units that do not require
substantial cross-Actor querying. One Actor can become a throughput boundary.
Global matching, transactional invariants, indexed scans, event-time windows,
and dense simulation all violate the model's preferred access shape.

### Hypothesis: Actor Plus Generic Data Is A Complete Toolkit

**Result: falsified.**

"Data" does not identify one authority or consistency model. Relational
transactions, append-only ledgers, analytical columns, search indexes, graph
traversal, vector similarity, server-authoritative projections, and CRDT
documents make different promises. A generic abstraction either exposes modes
that reproduce all underlying systems or conceals correctness decisions.

### Hypothesis: Dependencies Alone Are Sufficient

**Result: computationally true, ergonomically and semantically insufficient.**

Any runtime can be hidden behind a Dependency, but doing so moves authored
behavior and product policy into opaque infrastructure. Actors and Workflows
justify Feature factories because product authors define portable methods or
control flow while the factory supplies recurring durability and concurrency
machinery. Database and model inference remain Dependencies because the caller
does not author their execution engines.

### Hypothesis: Workflow Is Redundant Because Actors Can Implement It

**Result: falsified at the authoring boundary.**

An Actor runtime can be an implementation substrate for a Workflow engine, but
Workflow authors need replay-safe control flow, durable timers, signals,
queries, cancellation, child workflows, activity policies, versioning, and
history management. Exposing these as hand-maintained Actor state makes every
product reimplement the model and weakens inspection.

### Hypothesis: Pub/Sub Or A Stream Dependency Replaces Dataflow

**Result: falsified for nontrivial stream processing.**

A transport can move records, but it does not define event time, watermarks,
windows, late data, backpressure, partitioned state, coordinated checkpoints,
or rescaling. Akka explicitly describes stream processing as a different
paradigm from actors and futures. A full stateful dataflow model therefore
belongs in a Program language if Kit needs it.

### Hypothesis: ECS Is Just Another Feature Factory

**Result: conditionally falsified.**

A small ECS library can be ordinary portable code. A performance-oriented
simulation model, however, owns component layout, system access declarations,
parallel scheduling, ticks, deterministic ordering, snapshots, and target
lowering. At that point it is a Platform-owned Program language, not a Feature
factory hiding inside a general server Program.

### Hypothesis: Local-First Is One Optional Mode Of CRUD

**Result: falsified.**

Server-authoritative optimistic mutation permits rejection and reconciliation.
Multi-writer CRDT documents permit independent writes and guarantee convergence
under a declared merge algebra. These are different authority models. Figma
uses separate systems where tradeoffs differ, and Automerge deliberately
separates its CRDT/sync protocol from storage and network adapters.

### Hypothesis: Event Sourcing Should Underlie Every Stateful Feature

**Result: falsified.**

Event sourcing is useful when audit and reconstruction justify its schema,
query, migration, and operational complexity. Microsoft's architecture guidance
states that traditional data management is sufficient for most systems and
most parts of a system. Factories may use event sourcing internally, but Kit
must not impose it as universal product semantics.

### Hypothesis: Agent Is A Foundational Programming Model

**Result: falsified.**

An Agent adds domain policy around model-driven decisions. Its durability,
identity, memory, tools, transport, and execution guarantees come from Actors,
Workflows, Programs, and Dependencies. Agent frameworks in the survey expose
those concerns separately. `Agent` is therefore a high-level composed Feature
factory.

### Hypothesis: Program Is Unnecessary Once Feature Factories Exist

**Result: falsified.**

Feature factories cover recurring models, not every algorithm. Spatial
matching, codecs, custom protocols, rendering, optimization, and novel product
logic still need an explicit executable contribution. `Program` is the open
extension point that prevents the factory catalogue from becoming a closed
world.

### Hypothesis: A Fixed Higher-Level Catalogue Can Be Proven Complete

**Result: falsified.**

Only the neutral substrate can be structurally open-ended. New hardware,
coordination models, media runtimes, and domain-specific languages may justify
new Program languages. The admission test can prevent redundancy, but no finite
list of optimized higher-level models can be proven ideal for all future
software.

## Repository Assessment

| Current surface                    | Assessment                                                                                                    | Required next action                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Program`, `Dependency`, `Feature` | Correct universal substrate                                                                                   | Freeze through contract tests                                                      |
| `createActor`                      | Semantically justified reusable model                                                                         | Audit guarantees, API, supervision expectations, and conformance                   |
| `createEntity`                     | Specific event-sourced synchronized record model                                                              | Decide whether it remains an internal mechanism or a narrowly named public factory |
| `createData`                       | Overbroad: combines records, auth, event source, browser projection, sync, query, search, and concrete stores | Split authority from storage; narrow and rename only after API experiments         |
| `core/stream.ts`                   | Two pure async-iterable helpers, not a stream programming model                                               | Keep as helpers or relocate; do not claim stream semantics                         |

The current `Data` and `Entity` APIs must not be removed merely from this
research. First preserve their behavioral evidence, state their exact authority
models, and test whether one narrow public factory can express the intended
local-first application experience without semantic modes.

The experimental Agent, Code, and Memory Features were removed. They did not
establish a reusable programming model beyond Actor, Workflow, Data, and typed
Dependencies. Reusable language-model and realtime gateway contracts remain
under `features/model`; a future product-level Agent Feature may compose them
without changing the substrate.

## Recommended Experiments

### 1. Actor Conformance Audit

Verify:

- one total command order per key;
- durable admission and caller idempotency;
- crash boundaries around external effects and commits;
- reminder recovery and replacement;
- read consistency;
- overload and hot-key behavior;
- restart, relocation, fencing, and version evolution;
- whether classical supervision is applicable to virtual durable Actors or
  belongs to process deployment.

Do not call Actor ideal until these guarantees and limits are represented in
the public API and differential tests.

### 2. Workflow API Spike

Use one realistic order flow and one dynamic AI research flow to test:

- ordinary TypeScript control flow;
- Activities as Dependency calls rather than duplicate tool concepts;
- durable time, signals, queries, updates, cancellation, child workflows,
  parallel branches, retries, compensation, schedules, and continue-as-new;
- replay determinism and version evolution;
- time-skipping tests;
- JavaScript and generated-Rust semantic equivalence.

The spike should compare behavior against Temporal concepts, not copy
Temporal's API mechanically.

### 3. Data Boundary Experiment

Implement the same small product with:

1. transactional server-only records;
2. server-authoritative optimistic offline records;
3. a true multi-writer collaborative document.

If one public API requires authority or conflict "modes", reject the unification.
Keep database, search, and transport providers as Dependencies.

### 4. Stateful Dataflow Spike

Only proceed when a real Feature needs event-time windows. The minimal fixture
must include out-of-order events, watermarks, late corrections, backpressure,
checkpoint recovery, repartitioning, and a bounded replay. If ordinary Programs
can express the workload without losing static optimization or correctness,
do not add a Program language.

### 5. Simulation/ECS Spike

Compare an Actor representation and an ECS representation of a deterministic
multiplayer match. Measure authoring clarity, deterministic replay, update cost,
memory locality, parallel scheduling, snapshot size, and Rust lowering. Add a
Program language only if the compiler-visible component/system model produces
material correctness or performance benefits.

## Acceptance Gates

A new foundational factory or Program language is accepted only when:

- at least three materially different workloads require the same semantics;
- its authority, identity, ordering, consistency, time, and failure model fit
  in one concise contract;
- ordinary Programs plus Dependencies demonstrably repeat substantial
  correctness machinery;
- no existing model can express it with equally clear semantics;
- development tests run without native compilation;
- one shared TypeScript suite verifies every provider or realization;
- generated production behavior is tested differentially;
- failure injection covers retries, crashes, partitions, duplication, and
  reordering relevant to the model;
- the API does not use hidden modes to switch semantic guarantees;
- removal of the abstraction would make product code materially less safe or
  more repetitive, not merely less fashionable.

## Sources

- [Service Fabric Reliable Actors](https://learn.microsoft.com/en-us/azure/service-fabric/service-fabric-reliable-actors-introduction)
- [Orleans virtual actors](https://www.microsoft.com/en-us/research/project/orleans-virtual-actors/)
- [Erlang/OTP design principles](https://erlang.org/documentation/doc-15.0-rc3/doc/system/design_principles.html)
- [Akka Streams introduction](https://doc.akka.io/libraries/akka-core/current/stream/stream-introduction.html)
- [Communicating Sequential Processes](https://www.cs.cmu.edu/~crary/819-f09/Hoare78.pdf)
- [Cloudflare Durable Objects rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Ray actors](https://docs.ray.io/en/latest/ray-core/actors.html)
- [Restate service types](https://docs.restate.dev/foundations/services)
- [Dapr building blocks](https://docs.dapr.io/developing-applications/building-blocks/)
- [Temporal Workflows](https://docs.temporal.io/workflows)
- [Durable Task programming model](https://learn.microsoft.com/en-us/azure/durable-task/common/programming-model-overview)
- [Uber Cadence](https://www.uber.com/us/en/blog/announcing-cadence/)
- [FoundationDB architecture](https://apple.github.io/foundationdb/architecture.html)
- [FoundationDB developer guide](https://apple.github.io/foundationdb/developer-guide.html)
- [FoundationDB transaction manifesto](https://apple.github.io/foundationdb/transaction-manifesto.html)
- [Codd's relational model](https://research.ibm.com/publications/a-relational-model-of-data-for-large-shared-data-banks)
- [Reactors: virtualized actor database systems](https://arxiv.org/abs/1701.05397)
- [Automerge repositories](https://automerge.org/docs/reference/repositories/)
- [Local-first software](https://martin.kleppmann.com/2019/10/23/local-first-at-onward.html)
- [Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [Google Dataflow model](https://research.google/pubs/the-dataflow-model-a-practical-approach-to-balancing-correctness-latency-and-cost-in-massive-scale-unbounded-out-of-order-data-processing/)
- [Google MillWheel](https://research.google/pubs/millwheel-fault-tolerant-stream-processing-at-internet-scale/)
- [Google MapReduce](https://research.google/pubs/mapreduce-simplified-data-processing-on-large-clusters/)
- [Apache Flink architecture](https://flink.apache.org/what-is-flink/flink-architecture/)
- [Ray Data concepts](https://docs.ray.io/en/latest/data/key-concepts.html)
- [Bevy ECS](https://bevy.org/learn/quick-start/getting-started/ecs/)
- [Unity Entities](https://docs.unity.cn/Packages/com.unity.entities%401.0/manual/index.html)
- [Telegram TDLib](https://core.telegram.org/tdlib)
- [Discord message storage](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Discord search indexing](https://discord.com/blog/how-discord-indexes-trillions-of-messages)
- [Uber Schemaless](https://www.uber.com/us/en/blog/schemaless-part-two-architecture/)
- [Uber Marketplace architecture](https://www.uber.com/us/en/blog/uber-tech-stack-part-two/)
- [Uber Kappa stream processing](https://www.uber.com/es/en/blog/kappa-architecture-data-stream-processing/)
- [Stripe usage-based billing architecture](https://stripe.com/blog/how-we-built-it-usage-based-billing)
- [Microsoft event sourcing guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [AutoGen Core](https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/index.html)
- [LangGraph overview](https://langchain-ai.github.io/langgraph/index.html)
- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
