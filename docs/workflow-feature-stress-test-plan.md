# Workflow feature stress test

Status: retained linear execution implemented 2026-07-15; scheduler, admission, and production comparison gaps remain

## Inngest comparison audit

Compared on 2026-07-15 against:

- `inngest/inngest-js` `1b7447afd3dc08b210f9f88d064552c24964f343`
  (`inngest` 4.12.1 and `@inngest/test` 1.0.0).
- `inngest/inngest` `a432443384be5c799ee937f4e093ad0b5f6226ae`
  (Dev Server 1.37.0).
- The official [SDK test engine](https://www.inngest.com/docs/reference/typescript/v4/testing),
  [execution model](https://www.inngest.com/docs/learn/how-functions-are-executed),
  [retry semantics](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries),
  [idempotency semantics](https://www.inngest.com/docs/guides/handling-idempotency), and
  [concurrency semantics](https://www.inngest.com/docs/guides/concurrency).

### Verdict

- **TypeScript authoring performance: better in this benchmark.** Poggers now
  checks faster, with fewer instantiations and less memory at 1, 100, 500, and
  1,000 function declarations.
- **Basic durable behavior: competitive, not equivalent.** Event triggers,
  durable steps, sleeps, event waits, child invocation, parallel branches,
  cancellation, dependency replacement, restart recovery, and persisted run
  inspection have real substrate tests.
- **Production workflow breadth: worse today.** Inngest owns a non-occupying
  scheduler, queue, executor, state store, flow control, cron, failure handlers,
  distributed execution, and a substantially larger conformance corpus.
- **Framework flexibility: promising but not proven universal.** Poggers can
  package workflows with semantic dependencies and local-first reactive state
  in one Feature, which Inngest does not attempt. That architectural advantage
  does not replace missing scheduler and admission-control semantics.

### TypeScript 7 benchmark

The benchmark generated equivalent declarations with one typed event, one
typed output, and one typed `step.run` per function. It compiled installed
package declarations using TypeScript 7.0.2 native `tsc`, `strict`,
`skipLibCheck`, and `--extendedDiagnostics`. Values are medians of three fresh
processes, except the 1,000-function case which used two.

| Functions | Poggers instantiations | Inngest instantiations | Poggers check | Inngest check | Poggers memory | Inngest memory |
| --------: | ---------------------: | ---------------------: | ------------: | ------------: | -------------: | -------------: |
|         1 |                  1,044 |                  7,538 |          1 ms |          7 ms |        28.8 MB |        36.7 MB |
|       100 |                 19,557 |                 60,703 |         18 ms |         48 ms |        35.6 MB |        48.3 MB |
|       500 |                 94,357 |                275,503 |        106 ms |        203 ms |        62.6 MB |        94.2 MB |
|     1,000 |                187,857 |                544,003 |        229 ms |        428 ms |        96.4 MB |       151.8 MB |

The initial Poggers result at 500 functions was 6,594,382 instantiations and
2.58 seconds. Two type-algorithm defects caused it:

1. every declaration scanned every application event to rediscover trigger
   compatibility;
2. handler output was contextually resolved against the closed function map
   during call inference.

Trigger validation now indexes only the selected event names. A separate
handler generic infers the implementation once and then checks it against the
selected contract output. Compile-only assertions retain invalid-trigger,
invalid-output, invalid-event, invalid-invocation, and invalid-function-name
rejection.

### Historical runtime baseline

These numbers describe two different deployment boundaries and must not be
presented as equivalent throughput. Poggers measures `api.send` through the
real in-memory Resource/Program runtime and waits for persisted completion.
Inngest measures event send through its real local Go Dev Server, queue, and
official Bun SDK callback. The Inngest Dev Server used its default 150 ms queue
tick, which creates a visible latency floor.

| Workload             | Poggers median | Inngest Dev median |
| -------------------- | -------------: | -----------------: |
| Empty run            |        0.19 ms |             299 ms |
| 10 sequential steps  |        27.3 ms |             298 ms |
| 100 sequential steps |         378 ms |             247 ms |
| 10 parallel steps    |        5.49 ms |             452 ms |
| 100 parallel steps   |         117 ms |             752 ms |

These measurements predate retained execution and are retained only as the
falsifying baseline that drove the runtime correction.

#### Historical scaling diagnosis

An instrumented in-memory run counted handler entry, operation declaration,
and persisted history while increasing one workflow's operation count. Each
point is one isolated run inside the same fixture; timing is directional, while
the declaration and transition counts are deterministic.

| Operations | Sequential time | Sequential declarations | Parallel time | Parallel declarations |
| ---------: | --------------: | ----------------------: | ------------: | --------------------: |
|         10 |         30.4 ms |                     175 |        7.1 ms |                   130 |
|         50 |          147 ms |                   3,875 |       34.5 ms |                 2,650 |
|        100 |          330 ms |                  15,250 |       96.9 ms |                10,400 |
|        200 |          864 ms |                  60,500 |        313 ms |                41,200 |
|        400 |          2.32 s |                 241,000 |        1.11 s |               163,600 |
|        800 |          6.39 s |                 962,000 |        4.22 s |               652,000 |
|      1,600 |               — |                       — |        16.2 s |             2,603,200 |

Persisted history is linear at `3N + 2` transitions: schedule, start, and
settle each operation, plus run start and completion. Execution work is not.
A sequential run enters the handler `3N + 1` times and declares exactly
`(3N² + 5N) / 2` operations while walking its growing completed prefix on each
entry. Effect execution also replays the handler to rediscover the callback
closure. Parallel fan-out declares all `N` operations on each
callback-discovery replay. Both paths therefore perform quadratic declaration
work even though durable history remains linear.

This is an execution-strategy gap, not a contract or durability failure. The
preferred correction is a retained run-local execution actor: keep the live
async continuation and operation resolvers while the process is healthy,
persist every semantic transition as today, and replay only after restart or
ownership transfer. Callback discovery should use the live operation registry
instead of replaying the function. A compiler-produced continuation IR remains
an optional future optimization for stateless migration; it is not required to
make the normal path linear. Correctness gates must prove that retained and
recovered execution produce identical histories under interruption,
cancellation, retries, and version changes.

The retained-continuation correction has now landed. Callback-discovery replay
is gone; healthy handlers enter once and declare each operation once. Two
general primitive defects were also exposed and fixed: Resource commands cloned
the full aggregate to enforce read-only state, and Program source progress
sorted every marker and queued one write chain per event. Commands now receive a
lazy deeply protected state view, while Program source positions use ordered
append, rare-path binary insertion, and coalesced progress writes.

Current single-sample algorithm diagnostics are:

| Operations | Sequential |  Parallel | Handler entries | Declarations | Transitions |
| ---------: | ---------: | --------: | --------------: | -----------: | ----------: |
|         10 |    5.45 ms |  10.36 ms |               1 |           10 |          32 |
|        100 |    6.73 ms |   3.95 ms |               1 |          100 |         302 |
|      1,000 |   39.12 ms |  29.90 ms |               1 |        1,000 |       3,002 |
|     10,000 |  425.16 ms | 330.12 ms |               1 |       10,000 |      30,002 |

Against Inngest's official in-process test engine, median Poggers results were
0.71 ms versus 6.32 ms for 10 sequential steps and 3.82 ms versus 947.86 ms for
100 sequential steps. Inngest's 100-parallel-step test-engine case did not
complete within the observation window and was terminated. This is useful
algorithm evidence, but it is not an equivalent persistent single-node
throughput comparison.

### Correctness corpus

The inspected Inngest revisions contain 145 SDK test/benchmark files, 335 Go
test files in the engine, 74 integration test files, and 42 Go behavior test
files. Poggers now has 16 workflow-focused cases plus its broader substrate
suite. File counts are not a quality score, but the scenario gap is real.

The Inngest idempotency, trigger metadata, wait routing, retry, parallelism,
invocation, and cancellation scenarios were translated to Poggers semantics.
That translation found and fixed three defects:

- repeated public event IDs threw instead of deduplicating;
- `waitForEvent` fabricated an event ID and timestamp instead of returning the
  persisted event envelope;
- a function with multiple triggers always reconstructed the first trigger's
  name.

Poggers is stronger than a mocked SDK unit harness for restart and uncertainty:
its tests execute real Resource history, Program checkpoints, dependency
replacement, cancellation, and uncertain effect replay. Inngest remains much
stronger in breadth: event expressions, cron, function retries, failure
handlers, keyed concurrency, debounce, throttle, rate limit, priority,
singleton, batching, timeouts, checkpointing, streaming, and distributed queue
behavior are not covered because most are not implemented.

## Evidence ledger

The experiment currently has one reusable factory at
`packages/kit/src/features/workflows.ts` and one application-owned factory at
`apps/workflows/src/features/order-fulfillment.ts`. The reference application
mounts that Feature once and contains no Resource, Program, or workflow runtime
wiring.

Verified behavior:

- `createFunctions<App, Contract>(options, define)` collects all functions in
  one Feature factory. Inside the collector, each definition uses Inngest's
  two-argument `createFunction(configuration, handler)` shape while the outer
  factory binds semantic dependencies once.
- One generic `FunctionsContract` closes event names and payloads, function
  inputs/outputs/failures, dependency methods, trigger compatibility, child
  invocation, and emitted events. Handler and step types infer at each call.
- `api.send(...)` is the single external event path. Events are persisted,
  start every matching function automatically, and resume active waits through
  a persisted run index. Duplicate event IDs are idempotent, and trigger/wait
  handlers receive the exact persisted event envelope. Direct public start and
  per-run signal aliases were removed.
- `step.run`, `sleep`, `sleepUntil`, `waitForEvent`, `invoke`, and `sendEvent`
  map to durable operations. Event waits support typed correlation paths;
  restart, non-matching delivery, child invocation, and function-emitted events
  have focused integration coverage.
- Browser compilation rewrites `createFunctions` to its shared runtime and
  erases function handlers and dependency implementations from client output.
- Event routing exposed a substrate defect: Program partitions used per-key
  sequence numbers as a cross-key checkpoint. Program progress now uses the
  globally monotonic source position, with a regression test covering two keys
  whose local sequence is `1` in the same partition.

- The generic contract infers workflow names, inputs, outputs, Signals,
  Queries, declared failures, dependencies, child inputs, and child results.
- A typed `fail` operation rejects failures outside the workflow's declared
  error contract.
- Durable effects preserve one idempotency identity across retries and an
  uncertain Program restart.
- Parallel effects, virtual-time sleep, timed Signal waits, child workflows,
  query purity, cancellation, dependency replacement, and compensating work
  have focused deterministic tests.
- Parent cancellation reaches a child run and aborts its active external
  operation.
- A generated retry model covers forty combinations of failure count and retry
  limit in a fast property test.
- Application-owned Feature factories return one literal Feature. Browser
  projection retains shared queries while removing server Programs, workflow
  bodies, and dependency implementations; the bundled reference app contains
  none of the audited server markers.
- The package declaration build, TypeScript 7 app analysis, isolated package
  installation, application typecheck, application test, and standalone build
  pass.

Proven gaps that must not be hidden behind convenience syntax:

1. **Durable scheduling.** Timers currently remain inside an active Program
   delivery until they fire. This makes restart replay safe, but consumes
   concurrency while sleeping. A durable scheduler/checkpoint primitive is
   required before claiming Inngest-equivalent non-occupying waits.
2. **Workflow Updates.** Resources provide durable commands and receipts, but
   the workflow runtime has no durable mutable message-handler state or typed
   accepted/completed result handle. Implementing Updates with polling would
   violate the intended semantics.
3. **Plain-async quiescence.** The workflow driver replays ordinary async
   TypeScript and currently uses a task-turn boundary to distinguish a newly
   emitted durable decision from pending work. The framework must either
   enforce that every awaited operation is durable or provide a deterministic
   execution mechanism that can prove quiescence.
4. **Flow control.** Keyed Program concurrency exists, but durable throttle,
   rate limit, debounce, batching, priority, and fairness are not current
   workflow semantics. They require a shared admission/scheduling model, not
   independent timers inside a factory.
5. **Function-level retries.** Configured retries currently apply to
   `step.run`; an error outside a step terminates the run and handler `attempt`
   remains zero. Inngest retries both function execution and each step, with
   independent counters and backoff.
6. **Conformance breadth.** The current focused suite proves the implemented
   core but does not cover the queue, scheduler, flow-control, timeout,
   expression, and distributed race matrices present in Inngest's engine.

These findings are the purpose of the stress test. The workflow surface remains
experimental until the corresponding gates are satisfied or the capability is
explicitly excluded.

### Framework confidence gates

One workflow facade cannot prove that Feature factories or the substrate are
universal. A broad capability claim requires all of these independent gates:

1. **Factory expressiveness:** implement Inngest-style workflows,
   Temporal-style Signals/Queries/Updates, an actor mailbox, a CRDT/presence
   feature, a projection/indexer, authorization, and multi-environment agent
   orchestration without leaking kernel internals.
2. **Composition:** instantiate every factory twice, nest it, connect it to
   another Feature through its semantic API, replace its dependencies in tests,
   and preserve inference without casts or application-authored plumbing.
3. **Execution laws:** run model-based generated traces through normal
   execution, restart replay, cancellation, timeout, retry, and version-change
   paths; equivalent logical histories must produce equivalent visible state.
4. **Complexity:** a healthy run must perform `O(N)` operation declarations,
   handler work, persisted transitions, and retained memory. One recovery may
   add at most one linear replay. Wall-clock benchmarks report percentiles but
   never replace deterministic work counters.
5. **Adapter conformance:** run the same Journal, Replica, transport, Resource,
   and Program law suites against every implementation, including snapshot
   export/import and ownership handoff.
6. **Distributed faults:** a deterministic simulator must inject duplicate,
   delayed, reordered, and dropped delivery, partitions, stale owners, process
   death, and snapshot recovery while checking fencing, convergence,
   authorization, and bounded backpressure.
7. **Consumer boundary:** packed applications must typecheck and build with
   stable TypeScript performance while server programs, dependency
   implementations, and private runtime types stay out of browser output.

The current evidence passes the healthy linear-work gate and parts of gates 1,
2, 3, and 7 for one workflow factory and the single-node test host. It does not
yet pass recovery-scaling, persistent-adapter, admission, scheduler, or
distributed-fault gates.

## Objective

Determine whether Poggers' current Application, Feature, Resource, Program,
Dependency, Component, Preset, and testing primitives are sufficient to build
a production-grade durable workflow system with a smaller, safer TypeScript
surface than existing systems.

The primary authoring benchmark is Inngest's TypeScript SDK. Temporal is the
adversarial semantic benchmark. The result is not a superficial API imitation:
it must preserve durable execution, recovery, cancellation, composition,
testing, and observability semantics under failure.

The experiment produces one reusable workflow Feature factory and one focused
order-fulfillment application. It must first be attempted using the current
Poggers substrate. A framework primitive may change only when the experiment
demonstrates one of these conditions:

1. the required invariant cannot be expressed;
2. correct use requires repeated unsafe boilerplate;
3. the generic contract cannot carry required type information;
4. testing cannot observe or control a semantic boundary deterministically;
5. two existing primitives describe the same operation.

No compatibility layer is required. If a better primitive is proven, migrate
the maintained applications and remove the inferior surface.

## Why this benchmark

Inngest is the primary comparison because its TypeScript surface is concise and
event-driven: functions are triggered by typed events or schedules and use
durable operations for execution, sleeping, waiting, sending events, and
invoking other functions. Its flow-control surface adds concurrency,
throttling, rate limiting, debounce, batching, priority, cancellation, retries,
and timeouts.

Temporal supplies harder correctness cases: deterministic replay, Activities,
child Workflows, Queries, Signals, Updates, cancellation scopes,
Continue-As-New, versioning, and a time-skipping test environment. These are
valuable even when the final Poggers syntax is closer to Inngest.

Reference material:

- <https://www.inngest.com/docs/reference/typescript/v4/functions/create>
- <https://www.inngest.com/docs/reference/typescript/v4/functions/step-run>
- <https://www.inngest.com/docs/guides/flow-control>
- <https://www.inngest.com/docs/learn/versioning>
- <https://www.inngest.com/docs/reference/typescript/v4/testing>
- <https://docs.temporal.io/develop/typescript/workflows/message-passing>
- <https://docs.temporal.io/workflow-definition>
- <https://docs.temporal.io/develop/typescript/best-practices/testing-suite>

## Scope

### In scope

- A generic contract as the sole source of workflow, event, dependency, and API
  types.
- A reusable Feature factory that contributes all owned Resources, Programs,
  dependencies, semantic API, migrations, test support, and headless UI.
- Durable workflow definitions written as ordinary asynchronous TypeScript.
- Typed event send, inspect, cancel, replay, and result operations. Updates
  remain an explicit gap.
- Durable steps, sleeps, deadlines, event waits, child invocation, parallel
  work, retries, and failure handling.
- Deterministic tests with a virtual clock and controllable dependencies.
- Adapter-independent runtime laws and crash/replay testing.
- A small run inspector that proves Resources, Feature components, application
  composition, and Presets work together without leaking workflow machinery.
- An evidence-based assessment of the existing Poggers primitives.

### Out of scope

- Cloning either vendor's hosted control plane, billing, deployment service, or
  complete dashboard.
- Matching undocumented implementation details.
- Adding NATS, a cluster scheduler, or another production adapter before the
  single-node semantics are proven.
- Broad application redesign unrelated to the workflow experiment.
- Preserving superseded experimental APIs.

## Reference application

Implement an order-fulfillment system because it forces long-running work,
human interaction, external effects, compensation, fan-out, and queryable
progress:

1. `orderPlaced` starts fulfillment with an idempotency key.
2. Inventory reservation and payment authorization run in parallel.
3. A failed transient operation retries with deterministic backoff.
4. A permanent payment failure compensates inventory reservation.
5. A high-value order waits for an approval signal with a deadline.
6. Approval and cancellation race without producing an impossible state.
7. Shipment invokes a typed child workflow.
8. Shipment status events resume the parent workflow.
9. Cancellation propagates to children and active external work.
10. A query returns current progress without mutating history.
11. An update changes the delivery address only before shipment and returns the
    previous address.
12. A bulk import exercises batching, per-tenant concurrency, throttling,
    priority, and fan-out.
13. A scheduled reconciliation workflow repairs unknown external outcomes.
14. A version change proves that an in-flight run can complete safely.
15. A run inspector displays state, history, attempts, waits, children, and
    available operations through a headless Feature component.

External systems are semantic dependencies owned by the Feature contract:
payments, inventory, shipping, notifications, and a clock. Their normal
implementations are not part of the substrate and tests can replace each one.

## Capability matrix

Every row must end in one of four evidence-backed outcomes: `native`,
`composed`, `core gap`, or `excluded with reason`.

| Capability                  | Reference        | Outcome    | Current evidence or missing invariant                                              |
| --------------------------- | ---------------- | ---------- | ---------------------------------------------------------------------------------- |
| Typed event trigger         | Inngest          | `native`   | Typed persisted send, automatic trigger dispatch, idempotent event identity        |
| Cron/scheduled start        | Both             | `core gap` | No durable scheduler or stable schedule identity                                   |
| Durable step and result     | Inngest          | `native`   | `perform` persists typed results and skips completed operation identities          |
| Activity/external effect    | Temporal         | `native`   | Semantic dependency effects receive attempts, uncertainty, abort, and keys         |
| Sleep and sleep-until       | Both             | `core gap` | Virtual-time correctness passes; scalable non-occupying scheduling does not        |
| Wait for event              | Inngest          | `native`   | Typed wait, correlation, timeout, restart routing, and timer release tests         |
| Send event                  | Inngest          | `native`   | Durable typed `step.sendEvent` can trigger another collected function              |
| Child workflow              | Both             | `native`   | Typed independent run, result propagation, and parent cancellation                 |
| Parallel branches           | Both             | `native`   | `Promise.all` decisions retain distinct stable operation identities                |
| Query                       | Temporal         | `native`   | Typed synchronous frozen input; repeated Queries add no history                    |
| Signal                      | Temporal         | `native`   | Typed durable message accepted through the Resource command boundary               |
| Update                      | Temporal         | `core gap` | No durable handler state, validator, acceptance record, or typed result            |
| Step retry/backoff          | Both             | `native`   | Virtual clock plus generated retry oracle; one attempt means no retry              |
| Function retry/attempt      | Inngest          | `core gap` | Errors outside steps terminate; handler attempt remains zero                       |
| Cancellation                | Both             | `composed` | Active effect, waiting run, parent, and child paths pass; full race matrix remains |
| Compensation                | Temporal pattern | `composed` | Ordinary workflow code compensates payment/inventory; crash matrix remains         |
| Concurrency                 | Inngest          | `composed` | Program consumers support keyed concurrency; workflow policy/fairness does not     |
| Throttle                    | Inngest          | `core gap` | No durable FIFO admission scheduler                                                |
| Rate limit                  | Inngest          | `core gap` | No typed lossy admission outcome                                                   |
| Debounce                    | Inngest          | `core gap` | No durable sliding-window winner                                                   |
| Batch                       | Inngest          | `core gap` | No size/deadline admission group or policy compatibility model                     |
| Priority                    | Inngest          | `core gap` | No persistent fair priority queue                                                  |
| Idempotency                 | Both             | `composed` | Duplicate event IDs are ignored permanently; Inngest uses a 24-hour window         |
| Timeout/deadline            | Both             | `core gap` | Signal timeout exists; start, effect, child, and workflow deadlines do not         |
| Versioning                  | Both             | `core gap` | App migrations exist, but no recorded workflow compatibility decision              |
| Continue/history compaction | Temporal         | `core gap` | Snapshotting exists below the Feature; no workflow continuation semantics          |
| Replay/rerun                | Both             | `core gap` | Internal replay resumes runs; no explicit public rerun/reuse policy                |
| Observability               | Both             | `native`   | Resource view exposes run history, operations, attempts, waits, and errors         |
| Authorization               | Poggers          | `native`   | Owner policy covers reads and messages; internal transitions are Program-only      |
| Local-first UI              | Poggers          | `native`   | Workflow handles read the normal reactive Resource view                            |

## Target authoring qualities

The experiment may change the exact syntax, but the accepted surface must have
these properties:

- The generic contract defines event payloads, workflow input/output, query,
  signal, update, error, and dependency types.
- The factory performs real composition and runtime work; no helper exists only
  to force inference.
- Workflow code uses normal control flow, `async`/`await`, `try`/`catch`, and
  `Promise.all` where their semantics are sound.
- Each semantic operation has one verb and one meaning. There are no aliases for
  the same operation.
- Stable durable identities are visible where changing one changes replay
  semantics; incidental storage keys and resource names are not.
- Dependencies are semantic and injected per environment through the existing
  Feature dependency contract.
- Application code mounts the Feature and routes its Components. It does not
  manually wire internal Resources, Programs, or dependencies.
- Presets own visual and motion decisions for the inspector; workflow behavior
  never enters a Preset.
- No vendor type, storage model, queue primitive, or scheduler implementation
  leaks through the public contract.

The plan must preserve an explicit distinction between:

- **Workflow definition:** deterministic orchestration.
- **Workflow run:** one durable execution identified by a stable key.
- **Operation:** a durable orchestration decision such as sleep, wait, invoke,
  or external work.
- **Dependency effect:** non-deterministic work behind a semantic contract.
- **Message:** a query, signal, or update sent to an existing run.
- **Event:** immutable Resource history that can trigger or resume work.

## Execution plan

### Phase 0: Baseline and audit

- [x] Record the current public Feature and Program surface with a minimal
      compile-only example.
- [x] Record the current test-host capabilities and all places that require
      private substrate imports.
- [x] Remove the proven unused `@babel/preset-typescript` dependency.
- [x] Make the package build script consistently Bun-native where Bun has the
      required operation, retaining `node:fs` only for unsupported filesystem
      operations.
- [x] Add a focused compatibility assertion around the TanStack Virtualizer
      lifecycle calls currently used by the web runtime.
- [x] Run the complete repository verification and
      record failures as baseline defects.

#### Gate 0

- [x] `bun install --frozen-lockfile`, `bun run check`, and `bun run build` pass.
- [x] The packed package installs, typechecks, executes, and builds in isolation.
- [ ] No experiment-specific primitive has been added.

### Phase 1: Semantic specification

- [ ] Convert the capability matrix into executable behavior examples.
- [ ] Specify run states and legal transitions without choosing storage tables.
- [ ] Specify ordering, delivery, retry, cancellation, and timeout guarantees.
- [ ] Specify outcomes for dependency effects: succeeded, failed, cancelled,
      timed out, and unknown after loss of the executor.
- [ ] Specify versioning and replay rules for changed operation identities and
      changed workflow code.
- [ ] Specify authorization points and actor propagation.
- [ ] Classify every feature as required now, safely composable later, or
      intentionally excluded.

#### Gate 1

- [ ] Every capability has observable acceptance criteria.
- [ ] At-least-once delivery and exactly-once state transitions are not
      conflated with exactly-once external effects.
- [ ] No specification refers to SQLite, Inngest, Temporal, or a queue as part
      of the product-facing meaning.

### Phase 2: Current-primitives spike

- [x] Implement the smallest order-fulfillment Feature directly with existing
      Resources, Programs, dependencies, semantic API, and test support.
- [x] Cover start, one durable dependency effect, retry, sleep, event wait,
      cancellation, queryable progress, and one child execution.
- [x] Do not add convenience APIs during this phase.
- [x] Record every repeated wiring pattern, unsafe cast, untestable boundary,
      and semantic mismatch.
- [ ] Measure author-owned files, declarations, runtime code, and required
      concepts against equivalent Inngest and Temporal examples.

#### Gate 2

- [ ] Crash after every durable boundary and resume to the same final state as
      uninterrupted execution.
- [ ] Duplicate input and event delivery do not repeat completed operations.
- [ ] Dependency replacement works through `testFeature` with no production
      adapter loaded.
- [ ] The type contract rejects wrong event payloads, dependency methods,
      operation results, messages, and child inputs.
- [ ] Every proposed framework change is linked to concrete spike evidence.

### Phase 3: Minimal workflow Feature factory

- [x] Design the smallest generic workflow contract that preserves all type
      relationships discovered in Phase 2.
- [x] Implement one factory that contributes its owned Resources, Programs,
      dependencies, API, migrations, Components, and test vocabulary.
      Resources, Programs, dependencies, API, and an empty headless Component
      contract exist; migrations and Feature-owned test vocabulary remain.
- [ ] Keep the factory inside the kit until its surface passes the experiment;
      do not expose intermediate machinery.
- [x] Implement operation identities and durable result serialization.
- [x] Implement a virtual clock contract for tests.
- [x] Implement typed event send plus run inspect and cancel. Query and Update
      semantics remain deliberately outside the accepted Inngest-shaped core.
- [x] Remove direct public start and per-run signal aliases.

#### Gate 3

- [ ] The reference application mounts one Feature value and performs no
      internal workflow wiring.
- [ ] Public workflow types are derived from the generic contract without
      manual duplicate declarations.
- [ ] The generated declaration surface contains no substrate or vendor types.
- [ ] An author can understand a simple workflow without reading runtime code.
- [ ] There is one obvious operation for each meaning in the capability matrix.

### Phase 4: Durable execution semantics

- [x] Add sleeps, typed event waits, parallel operations, and child invocation.
- [x] Add reliable event emission.
- [x] Add retry policies, deterministic backoff, and terminal failure handling.
      terminal failure handling.
- [ ] Add Signals, Queries, and Updates with their distinct delivery and result
      semantics.
- [x] Add cancellation propagation and application-level compensation.
- [ ] Add safe workflow evolution and bounded-history continuation.
- [x] Project run and operation history into queryable Resource views.

#### Gate 4

- [ ] Replay emits the same orchestration decisions for the same history.
- [ ] Queries never mutate history.
- [ ] Rejected Updates never enter history; accepted Updates complete at most
      once.
- [ ] Cancellation wins and loses races according to one documented ordering.
- [ ] A lost executor cannot allow an old attempt to commit after a fenced new
      attempt.
- [ ] Compensation order and retry behavior are deterministic.

### Phase 5: Flow control

- [ ] Implement concurrency limits with explicit scope and key semantics.
- [ ] Implement throttle, rate limit, debounce, batching, and priority as
      policies over starts or executing operations, not ad hoc timers in user
      code.
- [ ] Reject incompatible combinations at compile time where the generic
      contract contains enough information, otherwise at application build.
- [ ] Define fairness and starvation behavior.
- [ ] Ensure sleeping and waiting runs do not consume execution concurrency.

#### Gate 5

- [ ] A model-based scheduler oracle agrees with runtime decisions over
      generated arrival, completion, cancellation, and time-advance traces.
- [ ] Limits remain correct across restart and replay.
- [ ] Per-tenant isolation cannot be bypassed by batching or child invocation.
- [ ] Every dropped, delayed, replaced, or rejected start has an observable
      typed outcome.

### Phase 6: Testing experience

- [ ] Provide a Feature-owned workflow fixture through the public testing
      surface.
- [x] Support start, deliver message, advance time, complete/fail dependency,
      crash, restart, inspect history, and drain.
- [x] Make dependency calls observable without coupling tests to storage.
- [ ] Add replay tests against captured histories and old workflow versions.
- [x] Add an initial property-based retry-model test for generated operation traces.
- [ ] Add deterministic schedule exploration for important race boundaries.
- [ ] Keep a small real SQLite integration suite for persistence and locking;
      run the semantic majority against the in-memory contracts.

#### Gate 6

- [ ] A one-year sleep and exponential retries test in milliseconds through
      virtual time.
- [ ] Every durable boundary can be selected as a crash point by one reusable
      test harness.
- [ ] Property tests report a reproducible seed and minimal failing trace.
- [ ] The same law suite passes in-memory and single-node durable
      implementations.
- [ ] Tests use only public author-facing testing APIs except contract tests
      owned by the runtime itself.

### Phase 7: Application and UI composition

- [ ] Replace the spike with the final Feature factory in the reference app.
- [ ] Add a run list and run inspector using the Feature's headless Components.
- [ ] Keep route placement in the application.
- [ ] Implement two Presets with genuinely different visual and motion choices
      over the same hierarchy and behavior.
- [ ] Verify reactive updates do not remount the inspector or introduce a
      workflow-specific client state layer.
- [ ] Verify cancellation, retry, and update controls are accessible and
      authorization-aware.

#### Gate 7

- [ ] Application-owned source contains only `app.tsx`, one workflow Feature
      file and its focused spec, and Preset files unless another responsibility
      demonstrably requires separation.
- [ ] The Feature can be reused under a second mount without Resource,
      dependency, API, Component, or operation-identity collisions.
- [ ] Preset changes alter presentation and motion without changing workflow
      behavior or history.
- [ ] The browser is used for focused interaction and visual review; semantic
      correctness remains covered by fast deterministic tests.

### Phase 8: Final comparison and decision

- [ ] Complete the capability matrix with links to tests and implementation.
- [ ] Compare the final authoring surface with current Inngest and Temporal
      TypeScript examples for concept count, duplicated types, manual wiring,
      test setup, and unsupported semantics.
- [ ] Audit every new public symbol and remove anything used only once without
      carrying essential meaning.
- [ ] Audit all new files, exports, dependencies, and tests for ownership and
      redundancy.
- [ ] Record remaining substrate limitations separately from authoring-surface
      limitations.
- [ ] Decide whether the workflow factory is ready for public export, remains
      experimental inside the kit, or disproves part of the architecture.

#### Final gate

- [ ] All required capability rows are `native` or `composed`; every exclusion
      has a defensible product reason.
- [ ] The reference implementation survives generated failure and race traces
      without violating an invariant.
- [ ] The authoring API is no less type-safe than either reference and requires
      no duplicated event, input, output, message, or dependency declarations.
- [ ] The implementation is adapter-agnostic and the single-node adapter passes
      the same contracts as the in-memory runtime.
- [ ] `bun run check` and `bun run build` pass from the repository root.
- [ ] An isolated generated application installs, typechecks, tests, runs, and
      builds against the packed kit.
- [ ] Two final reviews find no unexplained primitive, export, dependency, file,
      cast, test exception, or compatibility path.

## Testing methodology

The test pyramid for this experiment is intentionally dominated by fast,
deterministic tests:

1. **Pure transition tests** cover workflow history reduction and policy
   decisions.
2. **Type contract tests** prove inference and rejected programs.
3. **Property tests** generate event, message, failure, cancellation, restart,
   and time traces.
4. **Model-based tests** compare scheduling and flow-control decisions with a
   small executable oracle.
5. **Contract suites** run the same laws against memory and SQLite boundaries.
6. **Integration tests** exercise Program, Journal, Feature composition, and
   dependency replacement together.
7. **Browser review** covers only interaction, accessibility, reactivity,
   Presets, and visual behavior that deterministic tests cannot establish.

Required invariants include:

- one logical workflow run per accepted idempotency key;
- one committed result per operation identity;
- completed operations are never executed again during replay;
- stale fenced attempts cannot commit;
- run history is append-only and reducible to the observed state;
- query execution does not alter history;
- accepted messages are ordered and not silently lost;
- terminal runs cannot return to an active state;
- virtual and real clocks produce equivalent ordering;
- restart changes timing, never meaning;
- external exactly-once behavior is never claimed without an idempotent or
  reconcilable dependency contract.

## Deliverables

- This maintained plan and completed capability matrix.
- A semantic workflow specification independent of runtime implementation.
- A reusable workflow Feature factory or a precise report explaining which
  current architectural assumption it disproves.
- The order-fulfillment reference Feature and focused application.
- Public type-contract and testing examples.
- Property, model, contract, integration, and limited browser verification.
- A final comparison report with retained gaps and rejected alternatives.

The experiment succeeds only if it tells us the truth. Shipping a large new
surface that merely resembles Inngest or Temporal is a failed outcome.
