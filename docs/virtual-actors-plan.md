# Durable Virtual Actors

Status: active

This is the living source of truth for the durable Actor Feature. Checked items
record verified evidence, not intention. Workflow and Presentation remain
frozen in [`product-languages-plan.md`](./product-languages-plan.md). Do not
commit this work unless the user explicitly asks.

## North Star

Virtual Actors must prove the general Kit architecture rather than add another
one:

```text
semantic Actor factory
        |
        v
ordinary Features
        |
        +-- Programs: executable portable TypeScript
        +-- Requires: typed Dependencies consumed by those Programs
        `-- Provides: typed Actor API consumed as a Dependency
                         |
                         v
                generic Program IR
                   /          \
                  v            v
          TypeScript dev    Rust production
```

An Actor is a reusable Feature factory. It may create Programs and typed
Dependencies internally, but product code receives only its semantic API.
Programs interact with every other Program and the environment through
Dependencies. The Actor implementation does not introduce a new communication
primitive, compiler, IR, adapter category, or deployment unit.

The Actor Feature implements Actor semantics: identity, serialized mutation,
deduplication, retries, committed-state queries, timers, migrations,
backpressure, and public outcomes. Environmental mechanisms remain
Dependencies: durable storage, clocks, process identity, transport, leases, and
any platform service. These Dependencies may be supplied by host adapters or by
other reusable infrastructure Features.

The one universal TypeScript compiler lowers the resulting Programs. No Actor
factory owns TypeScript-to-Rust translation or handwritten Rust application
logic.

## Architectural Invariants

1. Program, Dependency, Feature, Environment, and System remain the complete
   substrate.
2. `createActor` is a Feature factory, not a core primitive.
3. Actor-to-Actor calls are typed Dependency calls.
4. Host effects and cross-Program communication use the same Dependency
   mechanism.
5. The Actor API may be domain-specific, but it must project to ordinary
   `Requires` and `Provides`.
6. Actor business logic is ordinary portable TypeScript and uses the one
   generic Program IR.
7. The generic compiler contains no Actor names, Actor AST cases, Actor
   expression nodes, or Actor-specific Rust templates.
8. TypeScript development and Rust production execute the same compiled
   Programs with equivalent Dependency contracts.
9. Native code implements environmental Dependencies and the generic Program
   runtime only.
10. Replica count, machine identity, placement, sharding, and topology are
    deployment concerns. Programs observe only declared Dependencies.
11. Public Actor source contains no storage handles, leases, shard IDs,
    transport addresses, or stringly message names.
12. There is one public Actor API. Compatibility work may evolve it but must
    not add a second facade.

### Translation Litmus Test

Adding an unrelated Actor Feature is invalid if it requires any of:

- an Actor-specific compiler extension or Actor IR;
- an Actor branch in the generic TypeScript frontend or Rust backend;
- a Rust copy of an application handler;
- a feature-owned Rust generator or template;
- separate product fixtures for TypeScript and Rust;
- public transport, mailbox, persistence, lease, or shard vocabulary;
- a second Actor invocation API.

Generic compiler improvements are allowed only when they support ordinary
portable Programs independently of Actors and have generic conformance tests.

## Existing Foundation

| Existing concept                                | Use                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Program`                                       | Authored executable behavior for one Environment. Actor factories contribute ordinary Programs. |
| `Dependency`                                    | The only interaction boundary. Actor APIs are provided and consumed as Dependencies.            |
| `Feature`                                       | Reusable vertical composition. `createActor` returns a Feature.                                 |
| `Requires` / `Provides`                         | Static dependency graph and runtime wiring for the Actor API and its infrastructure.            |
| generic Program IR                              | The only procedural intermediate representation.                                                |
| TypeScript interpreter                          | Fast development and canonical behavioral reference.                                            |
| generic Rust backend/runtime                    | Production execution of the same Program meaning.                                               |
| provider linker                                 | Mounts one supplied Dependency implementation per assembled Program.                            |
| storage/event/clock/timer/identity Dependencies | Reuse candidates, accepted only after Actor fault tests prove their guarantees.                 |

The discarded `src/features/actor/compiler.ts` experiment demonstrated the
wrong boundary: a separate `actors` context forced an Actor-specific call node.
That experiment is removed. Actor references now use ordinary typed
Dependencies.

## Canonical Vocabulary

- **Actor type**: one state model and typed command/query protocol.
- **Actor key**: stable typed identity within an Actor type.
- **Actor Feature**: the reusable Feature returned by `createActor`.
- **Actor API**: the typed Dependency provided by that Feature.
- **Command**: durable serialized work that may mutate one Actor.
- **Query**: read-only observation of committed Actor state.
- **Invocation**: one identified command attempt chain.
- **Timer**: named durable one-shot command scheduling.
- **Dependency**: every external effect, service, or other Feature API.

Mailbox, outbox, activation, lease, fence, shard, and replica are internal
implementation or deployment terms, not public Actor authoring concepts.

## Target Authoring Surface

The exact surface remains provisional until F1 type and composition fixtures
close it. The intended shape is:

```ts
type Inventory = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Dependencies: Record<never, never>;
}>;

export const inventory = createActor({
  state: (_context: Actor.Initial<Inventory>): Inventory["State"] => ({
    available: 10,
  }),
  commands: {
    reserve({
      state,
      input,
      fail,
    }: Actor.Command<Inventory, { quantity: number }, { unavailable: { available: number } }>) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }
      state.available -= input.quantity;
      return { remaining: state.available };
    },
  },
  queries: {
    availability({ state }: Actor.Query<Inventory>) {
      return { available: state.available };
    },
  },
} satisfies Actor.Definition<Inventory>);

type Account = Actor<{
  Name: "account";
  Key: string;
  State: { balance: number };
  Dependencies: {
    payments: Payments;
    inventory: Actor.Reference<typeof inventory>;
  };
}>;
```

Handlers receive one object and use one dependency namespace:

```ts
async purchase({
  key,
  state,
  input,
  dependencies,
}: Actor.Command<Account, { item: string; quantity: number }>) {
  const reservation = await dependencies.inventory.reserve({
    key: input.item,
    input: { quantity: input.quantity },
    wait: "accepted",
  });
  state.balance -= 1;
  return { reservation: reservation.id };
}
```

An Actor reference is a typed Dependency. The key is part of each operation's
single request object, so no compiler-only callable locator is needed.

The Actor name is authored once as type meaning and materialized with the
existing compiler intrinsic when runtime identity is needed. It must not also
appear as a runtime `name` property. Command and query names are authored once
as object keys.

The created value is a mountable Feature. Its Program provides
`Actor.Reference<typeof inventory>` under the Actor name and requires its model
Dependencies plus the minimal infrastructure Dependencies. Other Features
consume that provided API through ordinary `Requires`.

## Semantic Contract To Prove

These are hypotheses until the corresponding fault and differential tests pass.

| Concern      | Required semantics                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity     | Actor type plus typed key identifies one logical state machine, independent of machine location.                                                                                                          |
| ordering     | Commands commit in one total order per Actor key. No ordering is promised across keys.                                                                                                                    |
| queries      | Queries read a committed revision and cannot mutate state or perform effects.                                                                                                                             |
| acceptance   | `wait: "accepted"` resolves only after durable admission.                                                                                                                                                 |
| completion   | The default call resolves to one typed result or declared domain failure.                                                                                                                                 |
| retries      | One invocation identity survives retries; state/result commit is deduplicated, and the latest 1,024 completed results per Actor key remain retrievable. Older duplicate calls fail with `result-expired`. |
| effects      | Awaited Dependency calls have stable invocation identity. External effects require idempotent providers or explicit deduplication.                                                                        |
| cancellation | Cancelling a wait does not retract accepted work. Product cancellation is an explicit command.                                                                                                            |
| suspension   | Mutating handlers are non-reentrant by default; committed queries may continue.                                                                                                                           |
| cycles       | Synchronous dependency chains that revisit one Actor identity fail instead of deadlocking.                                                                                                                |
| timers       | Named one-shot timers are durable, generation-fenced, cancellable, recover overdue work after restart, and wake autonomously without a subsequent Actor call.                                             |
| migrations   | Persisted state and accepted inputs carry compiler-owned schema identity and use typed forward migrations.                                                                                                |
| overload     | Admission is bounded and returns honest typed infrastructure failure with retry guidance.                                                                                                                 |
| ownership    | Shared-state replicas use fenced ownership so stale replicas cannot commit.                                                                                                                               |
| failure      | Domain failures are typed outcomes; infrastructure failures are separate `Actor.Error` failures.                                                                                                          |

No claim of exactly-once external effects is allowed.

### Deployment Assumptions

Actor source is topology-independent. A deployment that runs replicas must
provide:

- one shared EventStore whose compare-and-append is linearizable per stream;
- unique process identities and clocks whose lease comparisons stay within the
  deployment's documented skew bound;
- connectivity from every eligible replica to the same required Dependencies;
- provider-owned idempotency for external effects that must survive retry;
- durable wake-up delivery when autonomous timers are enabled.

The committed journal order, not packet arrival order or machine placement, is
authoritative. Changing replica count or routing a key to another replica does
not change Feature source.

## Required Dependency Boundary

F2 must derive the smallest contracts from fault semantics rather than create a
large Actor host API. Candidate environmental responsibilities are:

- atomic durable compare-and-commit over Actor state, invocation records,
  timers, and staged outgoing work;
- monotonic/logical clock access;
- unique process/invocation identity;
- wake-up delivery;
- cross-process transport where deployment topology requires it;
- fenced ownership for shared-state replicas.

Each responsibility may be a host Dependency or a reusable infrastructure
Feature that itself uses lower-level Dependencies. They must not be fused merely
for implementation convenience. Conversely, contracts must not be split when
atomicity requires one operation.

The Actor Feature owns the policy built from those mechanisms. A storage
adapter does not decide command semantics; a transport adapter does not become
the Actor API.

The implemented boundary uses the generic `EventStore`, `Clock`,
`Identifiers`, `Timer`, `Alarm`, `ExecutionContext`, and `Synchronization`
Dependencies. `ExecutionContext` carries ordinary semantic scopes across
asynchronous calls. `Synchronization` serializes tasks sharing a key within one
Program instance; it provides no distributed ownership guarantee. The Actor
journal atomically commits state, results, and timer intent in one stream. A
small durable registry records a key before its first command so startup can
reconstruct every pending alarm. `Alarm` only registers and schedules process
wake-ups; it owns no Actor state or retry policy. External effects retain stable
invocation identity and remain provider-idempotent rather than introducing an
Actor-specific outbox contract.

## Research Baseline

Research is falsification input, not an API compatibility target:

- [Erlang process ordering](https://www.erlang.org/doc/system/ref_man_processes.html)
  scopes signal ordering and separates supervision from product state.
- [Akka delivery reliability](https://doc.akka.io/libraries/akka-core/current/general/message-delivery-reliability.html)
  distinguishes transport delivery from processing completion.
- [Orleans virtual actors](https://learn.microsoft.com/en-us/dotnet/orleans/overview)
  establish stable identity and runtime activation; its
  [request scheduling](https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-scheduling)
  documents non-reentrancy and cycle risks.
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
  demonstrate single-owner colocated state and the serial hot-key ceiling.
- [Restate Virtual Objects](https://docs.restate.dev/develop/ts/services)
  provide useful evidence for durable calls, suspension, and keyed exclusivity.
- [Pekko sharding](https://pekko.apache.org/docs/pekko/1.0.2/typed/cluster-sharding.html)
  separates shard ownership from entity persistence.

No external runtime is adopted as Kit's product language.

## Milestones

### F0. Architecture Correction

- [x] Preserve all pre-existing dirty work and freeze Workflow/Presentation.
- [x] Audit Program, Dependency, Feature, provider, compiler, and runtime paths.
- [x] Confirm `Requires`/`Provides` already model Feature-to-Feature APIs.
- [x] Reject a separate `actors` call channel.
- [x] Remove the partial Actor compiler extension, Actor IR, and compiler-only
      fixtures.
- [x] Record that Actor is a Feature factory over the existing substrate.
- [x] Update the public type fixture and living plan to one Dependency
      namespace.
- [x] Keep root type checking green after the correction.

Gate: no Actor-specific compiler machinery remains and one concise example
shows the complete projection to Programs and Dependencies.

### F1. Canonical API And Feature Projection

- [x] Decide whether the Actor model needs only `Name`, `Key`, `State`, and
      `Dependencies`.
- [x] Infer the Actor model from existing annotations without repeating runtime
      names.
- [x] Make `Actor.Reference<typeof feature>` a normal Dependency contract.
- [x] Generate a Feature with one logical Actor Program.
- [x] Project model Dependencies into `Requires`.
- [x] Project the Actor API into `Provides` under its compiler-materialized
      name.
- [x] Implement `start` as ordinary portable Program code.
- [x] Preserve one object argument for every public operation.
- [x] Reject command/query collisions, invalid migrations, invalid timer
      targets, and non-Dependency requirements at type and source boundaries.
- [x] Prove composition between two Actors and between Actor and non-Actor
      Features.
- [x] Prove the Actor Feature can be placed with ordinary Program placement.

Gate: the Feature linker sees only ordinary Programs and Dependencies, and the
complete public API is understandable without runtime knowledge.

### F2. TypeScript Reference Semantics

- [x] Define minimal environmental Dependency contracts from the atomicity and
      failure requirements.
- [x] Implement the Actor service in portable TypeScript inside the Feature.
- [x] Implement deterministic in-memory test Dependencies.
- [x] Implement a durable conformance Dependency with atomic state, invocation,
      result, and timer commits; keep external effects provider-idempotent by
      explicit contract.
- [x] Prove serialized commands and committed queries.
- [x] Prove acceptance, completion, idempotency, deduplication, and result
      retention.
- [x] Prove awaited Dependency effects and crash recovery with stable,
      provider-owned idempotency.
- [x] Prove one-shot timers with virtual time and generation fencing.
- [x] Prove state and accepted-command migrations.
- [x] Prove incompatible activation failure.
- [x] Prove bounded admission, fairness, and poison handling.
- [x] Add deterministic fault injection at every durable boundary.

Gate: all semantics run in TypeScript with no Rust compilation and survive the
fault matrix.

### F3. Generic Compilation

- [x] Compile two unrelated Actor Features through the existing generic
      frontend and Program IR.
- [x] Add only independently useful portable TypeScript subset support exposed
      by those Features.
- [x] Add generic compiler conformance tests for every such addition.
- [x] Prove Actor APIs lower as normal Dependency calls.
- [x] Prove factory-generated Programs have deterministic semantic output.
- [x] Prove comments and formatting do not change generated meaning.
- [x] Reject unsupported portable code at exact source spans.
- [x] Keep compiler architecture guards free of Feature imports and name
      checks.

Gate: generated IR contains Programs, functions, and Dependencies only; there
is no Actor node or Actor backend.

### F4. Rust Production Equivalence

- [x] Compile the same Actor Programs through the generic Rust backend.
- [x] Reuse only generic native environmental Dependencies; no Actor
      Dependency implementation was needed.
- [x] Keep all Actor command/query business logic generated from TypeScript.
- [x] Run the same scenario corpus against TypeScript and Rust.
- [x] Compare normalized state, results, failures, calls, timers, and
      invocation identities.
- [x] Test debug-native behavior during iteration.
- [x] Retain focused release compilation for production smoke and performance.

Gate: no Actor-specific translator or handwritten Rust handler exists, and
TypeScript/Rust differential evidence is exact.

### F5. Replica And Fault Correctness

- [x] Run multiple instances of the same compiled Program against shared
      Dependencies.
- [x] Prove fenced single-writer commits.
- [x] Prove failover after process and machine loss.
- [x] Prove relocation and repartitioning without state or accepted-work loss.
- [x] Prove duplicate and reordered transport delivery.
- [x] Prove bounded buffering during unavailable ownership.
- [x] Test partitions, stale owners, delayed packets, and clock skew.
- [x] Document deployment assumptions without exposing topology in product
      source.

Gate: replica count changes deployment only, not Actor or Feature source.

### F6. Independent Pressure Fixtures

- [x] inventory/account coordination;
- [x] conversational agent with model and tool Dependencies;
- [x] human approval and explicit product cancellation;
- [x] collaborative resource with concurrent clients;
- [x] autonomous scheduled wake-up and cancellation;
- [x] self-rescheduling;
- [x] cyclic synchronous calls and accepted asynchronous cycle breaking;
- [x] rolling state/input migration;
- [x] hot-key overload and fairness across cold keys.

Every fixture must be an ordinary Feature composition and expose only semantic
Dependencies.

### F7. Performance, Cleanup, And Closure

- [x] Establish canonical reference behavior before optimization.
- [x] Benchmark warm dispatch, cold activation, persistence, timers, many keys,
      one hot key, overload, failover, and relocation.
- [x] Compare only equivalent durability settings.
- [x] Differentially verify every optimized path.
- [x] Keep ordinary Actor iteration TypeScript-only.
- [x] Use generated Rust cache only at native milestones.
- [x] Remove superseded experiments, redundant fixtures, and temporary APIs.
- [x] Document API, guarantees, limits, migration, operations, and raw
      benchmark methodology.
- [x] Run complete source, native, differential, fault, scaling, distribution,
      and release gates once at closure.

## Validation Ladder

Inner loop:

```sh
nub run typecheck
nub exec vitest run src/features/actor.spec.ts --tagsFilter='!native && !production'
```

Affected generic compiler work:

```sh
nub exec vitest run src/compiler/source.spec.ts src/runtime/process.spec.ts --tagsFilter='!native && !production'
```

Native milestone:

```sh
cargo check --manifest-path src/adapters/server/production/Cargo.toml
nub exec vitest run <actor-differential-spec> --tagsFilter='native'
```

The complete repository and release gates run only at milestone closure.
Workflow checks run only when shared infrastructure changes. Presentation and
browser checks run only when affected.

## Non-Goals

- Temporal or Inngest parity;
- migrating Workflow onto Actors;
- an Actor-specific compiler extension, IR, backend, or Rust runtime;
- a second Actor invocation facade;
- public mailbox, outbox, lease, shard, replica, or transport controls;
- arbitrary public reentrancy modes without a falsifying use case;
- unqualified exactly-once external effects;
- recurring calendar/cron language before one-shot timers prove insufficient;
- choosing a third-party actor runtime as the product language;
- deployment control planes or hosted operations;
- performance claims without reproducible equivalent-durability evidence.

## Completion Definition

- [x] `createActor` is a reusable Feature factory over only Programs and
      Dependencies.
- [x] Actor names and operation names are each authored once.
- [x] Actor-to-Actor and Actor-to-service calls use one Dependency mechanism.
- [x] all Actor behavior is portable TypeScript translated by the generic
      compiler;
- [x] TypeScript and Rust semantics are differentially equivalent;
- [x] durability, timers, failures, migrations, overload, and recovery are
      proven under deterministic faults;
- [x] multi-replica fencing, failover, and relocation are proven;
- [x] difficult independent Features pass;
- [x] performance evidence is reproducible and honest;
- [x] no discarded Actor compiler/API/runtime experiment remains;
- [x] repository, distribution, and production release gates pass.

## Performance Evidence

`nub run actor:benchmark` compiles the ordinary Actor Feature graph once,
warms every scenario once, then records five raw samples. Every scenario uses
the same in-memory EventStore with linearizable compare-and-append. Results
therefore compare Actor execution paths with equivalent durability semantics;
they do not compare an in-memory reference with a networked or disk-backed
store.

Environment:

```text
Date: 2026-07-24
Runtime: Node v26.5.0
Platform: darwin-arm64
Warm-up samples: 1
Recorded samples: 5
Unit: microseconds per semantic operation
```

| Scenario                        | Initial median | Current raw samples                                   | Current median | Current p95 |
| ------------------------------- | -------------: | ----------------------------------------------------- | -------------: | ----------: |
| cold activation and first query |         412.89 | 477.03, 463.58, 431.92, 492.00, 400.05                |         463.58 |      492.00 |
| warm durable command            |       4,501.43 | 1,100.20, 1,102.81, 1,112.15, 1,118.49, 1,116.01      |       1,112.15 |    1,118.49 |
| many independent keys           |       3,429.13 | 997.53, 987.42, 1,041.99, 1,010.52, 1,058.11          |       1,010.52 |    1,058.11 |
| one concurrent hot key          |      16,974.98 | 13,144.70, 13,197.43, 13,123.50, 13,161.63, 13,050.10 |      13,144.70 |   13,197.43 |
| bounded overload rejection      |              - | 1,819.59, 1,848.17, 1,845.41, 1,854.18, 1,865.48      |       1,848.17 |    1,865.48 |
| durable timer generation        |         545.38 | 486.45, 532.14, 526.24, 485.90, 504.25                |         504.25 |      532.14 |
| accepted-work failover          |         363.76 | 406.61, 389.73, 376.43, 371.49, 372.89                |         376.43 |      406.61 |
| three-replica relocation        |         805.09 | 406.67, 397.22, 416.46, 420.03, 427.66                |         416.46 |      427.66 |

The optimization is a process-local incremental journal, registration, and
execution-slot index inside the Actor Feature. Durable EventStore history
remains authoritative, and cache misses or process restarts reconstruct the
same state. The existing generated-Rust differential corpus was rerun after
the optimization and compares normalized journals, state, outcomes, failures,
nested calls, timer generations, invocation identity, and restart behavior.

The focused generated-Rust release fixture compiled and executed in 58.84
seconds on its first release-cache population. Ordinary Feature work does not
run this gate. Identical semantic input uses the generic content-addressed
native artifact cache.

These numbers characterize the current reference implementation only. They
are not a claim against another Actor system, a disk or network persistence
benchmark, or a claim that append-only cold replay is already optimized.

## Progress Log

### 2026-07-24

- Froze Workflow and Presentation work without reverting it.
- Audited the generic substrate and external actor-system semantics.
- Initially prototyped a separate Actor reference context and compiler
  extension.
- Falsified that design when cross-Actor calls required a new expression kind
  despite the existing typed Dependency provider/linker path.
- Removed the compiler-extension experiment.
- Selected Actor-as-Feature: semantic factory in, ordinary
  Program/Dependency/Feature graph out.
- Added one generic dispatcher-backed Dependency provider path and proved it
  through the TypeScript reference runtime and generated Rust runtime.
- Replaced the Actor metadata placeholder with a compiler-expanded portable
  server Program. A linked Account/Inventory fixture now proves per-key state,
  commands, queries, typed domain outcomes, Actor-to-Actor calls, and ordinary
  service calls through only `Requires` and `Provides`.
- Replaced the process-local state holder with an event-sourced implementation
  inside the portable Actor Program. `events`, `clock`, and `timer` are ordinary
  server-platform Dependencies shared with other Features.
- Proved durable admission and completion, committed-state queries, explicit
  idempotency across Program restarts, recovery of admitted work, local
  serialization, and one committed order across two Program replicas sharing
  storage.
- Proved persisted state and accepted-command input migration.
- Proved the same simple Actor command/deduplication/query scenario through the
  TypeScript interpreter and generated native Rust executable. The native path
  exposed and now guards generic zero-capture closure formatting and ordinary
  JavaScript object mutability.
- Corrected `wait: "accepted"` so it returns after durable admission and before
  command execution; the next Actor turn drains accepted work.
- Added timer scheduling and cancellation as events committed atomically with
  successful command state. Proved restart recovery, exactly one admitted
  firing for one generation, rescheduling, cancellation, and generation
  fencing under deterministic time.
- Preserved top-level static function binding identity across generic source
  expansion. An unrelated Feature proves the behavior in the TypeScript
  interpreter and generated Rust, while Actor timers use the same generic
  facility to reference a typed command without a string operation name.
- Extended the existing native Actor differential executable to include timer
  scheduling and firing; no Actor-specific native Dependency or generator was
  introduced.
- Current limits remain explicit: automatic child-effect recovery, physical
  history compaction, exhaustive durable fault injection, and production
  performance evidence are not yet complete.
- Re-ran the complete TypeScript Actor behavior suite after the architectural
  correction: all 22 tests pass. The evidence now closes bounded per-key
  admission, poison isolation, cold-key progress during a suspended hot key,
  fenced execution across two shared-store replicas, and claim-expiry
  takeover. Autonomous wake-up, physical history compaction, exhaustive fault
  injection, relocation, and performance remained open at that checkpoint.
- Defined an explicit bounded result contract: the latest 1,024 completions per
  Actor key are retrievable for idempotent retries. Older known invocations fail
  as `result-expired` rather than being re-executed. A 1,025-completion fixture
  proves both the retained and expired boundaries. Physical history compaction
  remains separate open work.
- Replaced line/column-derived portable function identities with semantic AST
  ancestry. Comments and formatting now preserve function identities and
  generated Rust meaning, which also prevents irrelevant edits from invalidating
  native artifact identity. The focused generic compiler/runtime milestone
  passes 76 tests with two intentionally skipped cases.
- Added deterministic failure and compare-and-append conflict matrices across
  Actor journal read, admission, claim, and completion boundaries. Idempotent
  retry reaches exactly one completion and one committed state in every case.
- Removed 22 redundant compilations of the same immutable Actor fixture from
  the behavior suite. All 25 TypeScript Actor tests still use isolated
  Dependencies and storage, while wall-clock test duration fell from 14.61s to
  5.54s.
- Mounted the conversational agent and collaborative document as ordinary Actor
  Features in the same compiled System. Runtime fixtures prove model/tool
  Dependencies, explicit approval cancellation, and two concurrent optimistic
  edits producing one commit and one typed conflict. The expanded suite passes
  all 27 tests in 5.69s.
- Extended the existing single native Actor differential executable rather than
  adding another build. TypeScript and generated Rust now agree on success,
  explicit idempotent deduplication, typed domain failure, durable acceptance
  identity, subsequent execution, committed query state, and one-shot timer
  firing.
- Simulated a deployment changing from one replica to three and back to one,
  with keys deliberately remapped between instances. Twelve keys retained
  committed state, and work accepted before the original instance stopped was
  recovered after relocation. The product Feature contains no placement,
  replica, or shard controls; the documented shared-Dependency assumptions are
  the complete deployment contract.
- Added one generic `Alarm` Dependency with development and native Rust
  implementations. Actor Programs durably register keys before admission,
  rebuild pending alarms from their ordinary EventStore journal at startup, and
  register portable callbacks through that Dependency. Deterministic fixtures
  prove accepted commands execute without a later Actor call, overdue timers
  fire after a fresh Program instance starts, cancelled generations do not
  fire, and replacements fire once. The complete 29-test TypeScript Actor suite
  now passes in 3.06 seconds; the native Alarm package and generated-Rust Actor
  differential pass without an Actor-specific compiler or runtime.
- Added generic asynchronous execution scope propagation and process-local
  keyed synchronization as ordinary server Dependencies. The linker and both
  runtimes now support cyclic Feature Dependency graphs through deferred
  binding. A two-Actor `cycleA -> cycleB -> cycleA` fixture proves immediate
  full-path failure for synchronous waits, durable terminal recording of that
  failure, and successful cycle breaking through `wait: "accepted"`. The same
  fixture passes in the TypeScript interpreter and the existing generated-Rust
  differential executable. Replacing Actor-side lock polling with the generic
  synchronization Dependency restored the complete 30-test source suite to
  1.96 seconds without adding an Actor compiler, IR, runtime, or adapter.
- Added one independently useful portable-language capability: a static
  function may preserve and pass its own stable identity without recursive
  source expansion. The Reminder Actor now proves a self-rescheduling typed
  timer for three durable generations in TypeScript, and the existing native
  differential executable proves the same recursive function and timer behavior
  after generic Rust lowering.
- Restarted the generated native Actor executable against the same SQLite
  EventStore and required byte-equivalent normalized output. Explicitly keyed
  commands, nested calls, durable terminal failures, state, results, and timer
  generations are recovered without re-execution. External effects remain an
  intentionally separate provider-idempotency boundary.
- Closed the durable-boundary fault matrix across registry, journal reads,
  admission, claim, completion, terminal failure, poison, timer scheduling,
  timer cancellation, and timer firing. Every conditional append is exercised
  under both compare-and-append conflict and a thrown storage failure, with
  retry converging to one durable event and one semantic result.
- Fixed a generic portable-language defect exposed by timer recovery: an
  authored empty `catch {}` had been indistinguishable from an absent catch.
  System IR version 22 now represents catch presence explicitly, and focused
  TypeScript plus generated-Rust conformance proves identical handling. No
  Actor-specific compiler path was added.
- Closed the remaining replica fault scenarios at the ordinary Actor
  Dependency boundary. Explicit invocation identities make duplicate delivery
  idempotent; reordered non-commutative edits retain their first durable domain
  outcome rather than silently changing history; accepted work survives one
  replica losing EventStore connectivity; a skewed-clock replica can take over
  without allowing the stale owner to commit twice; and the 1,024-command
  backlog remains bounded while an unavailable owner holds the hot key.
- Expanded the existing single generated-Rust Actor executable into a
  three-input differential corpus. It now compares target-normalized journals
  containing admission, claims, invocation identities, terminal failures,
  outcomes, state, nested Actor calls, and every timer generation, then repeats
  one scenario against the same native database to prove restart equivalence.
  This exposed and fixed a generic native-runtime mismatch: direct Dependency
  invocation counters are now scoped per Program contribution, matching the
  TypeScript reference runtime instead of being accidentally global.
- Added one reproducible Actor benchmark runner with cold activation, warm
  durable commands, independent keys, a serialized hot key, bounded overload,
  one-shot timers, failover, and relocation under one equivalent
  compare-and-append durability setting. Incremental journal and registration
  indexes reduced warm command latency from 4.50 ms to 1.11 ms, independent-key
  latency from 3.43 ms to 1.01 ms, and relocation latency from 805 us to 416 us.
- Reran all 35 TypeScript Actor tests, exact generated-Rust differential and
  restart conformance, and a focused release-native build after the
  optimizations. The native backend still contains no Actor branch or handler.
- Closed the milestone with one uninterrupted `nub run check`: TypeScript,
  lint, formatting, 56 Vitest files and 555 tests, every native Rust workspace
  test, the package build, all example type checks, API and Presentation
  evidence, distribution verification, and the focused release-production
  executable passed. The complete run includes the Actor fault, replica,
  pressure, and TypeScript/generated-Rust differential corpus.
