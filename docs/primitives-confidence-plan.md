# Core primitives confidence plan

This living document is the source of truth for determining whether Poggers'
core primitives are sufficient to implement arbitrary product behavior and
product-facing factory APIs with excellent single-node performance. Checkboxes
record evidence, not effort. A phase is complete only when its gate passes.

## Goal

Prove, or precisely falsify, this claim:

> Application, Feature, Resource, Program, Dependency, and the testing host are
> a minimal but sufficient substrate from which kit-owned factories can expose
> materially different, highly typed APIs without application plumbing,
> framework-specific leakage, special-case kernel behavior, or avoidable
> runtime overhead.

The first and deepest experiment reproduces Inngest's TypeScript authoring
surface and durable behavior while targeting better single-node performance.
Subsequent experiments use different computational models so workflow success
cannot be mistaken for universal evidence.

## Fixed principles

- [x] One generic application/feature contract remains the source of type
      correctness and contextual inference.
- [x] Product APIs use conventional domain vocabulary. Core representation
      names do not leak through a factory unless they are the domain vocabulary.
- [x] Factories are implemented from ordinary Features, Resources, Programs,
      Dependencies, and test support.
- [x] A capability-specific runtime belongs to its Feature. It enters the kernel
      only when two independent experiments prove the same missing invariant.
- [x] Runtime optimization may change execution strategy but not observable
      durability, ordering, idempotency, cancellation, or recovery semantics.
- [x] No compatibility layer is required. Superseded experimental surfaces are
      migrated and removed.
- [x] No cast, generated declaration, wrapper function, or application-authored
      annotation may hide a type-system failure.
- [x] Wall-clock numbers never replace deterministic work counters or semantic
      tests.
- [x] Single-node production behavior is proven before a cluster adapter is
      introduced.
- [x] Unsupported behavior is documented as a limitation rather than simulated
      with misleading convenience syntax.

## Evidence classes

Every positive conclusion requires all applicable evidence classes:

1. **Surface:** realistic code has the intended syntax and no internal leakage.
2. **Types:** valid programs infer without annotations; invalid programs fail at
   the exact authoring location; TypeScript work scales acceptably.
3. **Semantics:** model and scenario tests prove observable behavior.
4. **Recovery:** the same logical execution survives interruption, restart, and
   uncertain prior outcomes.
5. **Complexity:** declarations, handler entries, journal operations, and memory
   obey explicit asymptotic budgets.
6. **Boundary:** the real SQLite Journal and packed package behave like the
   in-memory reference implementation.
7. **Composition:** two instances, nesting, cross-Feature use, environment
   placement, and dependency replacement work without application wiring.
8. **Comparison:** equivalent upstream examples and workloads are run at the
   same semantic and durability boundary.
9. **Cost isolation:** factory logic is removed from the workload so the
   marginal CPU, allocation, memory, persistence, and scaling cost of each core
   primitive is measured against a direct implementation with the same
   observable semantics.

## Pinned references

- Inngest TypeScript SDK commit
  `1b7447afd3dc08b210f9f88d064552c24964f343` (`inngest` 4.12.1,
  `@inngest/test` 1.0.0).
- Inngest server commit
  `a432443384be5c799ee937f4e093ad0b5f6226ae` (Dev Server 1.37.0).
- Official SDK execution engine, function configuration, step tools, test
  engine, sequential benchmark, and parallel benchmark at those revisions.
- Current Temporal TypeScript Workflow, message-passing, versioning, and
  time-skipping testing documentation as the adversarial durable-execution
  reference.

Changing a pinned reference requires recording the new revision and rerunning
all comparative evidence.

## Baseline

- [x] A workflow Feature factory can expose typed events, functions,
      dependencies, durable operations, inspection, and test replacement.
- [x] Event IDs deduplicate; trigger and wait handlers receive exact persisted
      event envelopes.
- [x] Focused tests cover effects, retries, parallel branches, waits, sleep,
      child invocation, cancellation, uncertain restart, and dependency
      replacement.
- [x] TypeScript 7 analysis is faster than the pinned Inngest SDK through the
      full generated declaration range. At 1,000 declarations, Poggers checks
      in 249 ms with 217,872 instantiations and 103 MiB while Inngest checks in
      408 ms with 544,003 instantiations and 152 MiB.
- [x] The superseded replay-per-transition strategy was proven quadratic and
      replaced. Healthy execution now enters once and declares exactly `N`
      operations; one recovery adds one linear replay.
- [x] The Inngest surface is complete.
- [x] Healthy execution is linear through 10,000 sequential and parallel
      operations in the semantic host.
- [x] The persistent single-node comparison is complete.
- [x] Independent factory experiments establish broad primitive confidence.

The first production-boundary run now executes the same generated function
through SQLite `FULL` durability, the server authority, WebSocket replication,
and the typed client Feature API. It exposed and fixed cold indirect Resource
reads, non-JSON optional fields in persisted workflow/admission state, and
Journal ownership in the harness. A colocated regression snapshots every
record, stops, reopens the same database, verifies the completed run, and
executes another run after recovery. This proves the boundary works; it is not
yet an equivalent Inngest comparison.

## Phase 0: Reproducible laboratory

- [x] Move the comparative generator, diagnostics parser, runtime workload, and
      deterministic counters from temporary files into one owner-co-located
      research harness.
- [x] Record Bun, TypeScript, machine details, upstream versions,
      warmup policy, sample count, and raw result location.
- [x] Separate in-memory semantic tests, algorithmic counters, future SQLite
      tests, and external Inngest comparisons.
- [x] Make benchmark output machine-readable and compare medians plus p95 after
      warmup; retain raw samples.
- [x] Ensure normal `bun run check` does not run long comparative benchmarks.
- [x] Add one explicit command for the complete evidence run without adding
      redundant package scripts.

### Gate 0

- [x] A clean checkout can reproduce current type and runtime tables with
      `bun packages/kit/scripts/workflow-evidence.ts all --output=results.json`.
- [x] Results state exactly which boundaries are equivalent and which are not.
- [x] A benchmark failure cannot be hidden by averaging unrelated workloads;
      timeouts are emitted as explicit results.

The 2026-07-15 evidence run is retained at
`/tmp/poggers-workflow-evidence.json` in this workspace. It is intentionally not
versioned machine output.

The corrected TypeScript evidence is retained at
`/tmp/poggers-types-final.json`. The harness invokes
`node_modules/typescript/bin/tsc` directly, asserts version 7.0.2, and records
that identity before compiling either library. An earlier table was invalidated
because Bun's temporary `.bin/tsc` resolved the TypeScript 6 compatibility
package. Median results from three isolated samples are:

| Functions | Poggers check | Inngest check | Poggers instantiations | Inngest instantiations |
| --------: | ------------: | ------------: | ---------------------: | ---------------------: |
|         1 |          2 ms |          7 ms |                  1,089 |                  7,538 |
|       100 |         22 ms |         47 ms |                 22,572 |                 60,703 |
|       500 |        123 ms |        207 ms |                109,372 |                275,503 |
|     1,000 |        249 ms |        408 ms |                217,872 |                544,003 |

The same installed-declaration run separately measures ordinary Feature
composition. Reusing one fully typed Resource/Program/Dependency/API Feature at
1, 100, 500, and 1,000 mounts requires 2,214, 3,204, 7,204, and 12,204
instantiations respectively; median check time is 2, 3, 5, and 7 ms. This
separates the inexpensive core factory surface from the intentionally richer
workflow authoring surface.

The rerun initially falsified the stale table above: exact event triggers had
started scanning the complete event-name union after wildcard support landed,
producing 102,892 instantiations at only 100 declarations. Trigger selection now
branches on wildcard syntax before matching. Exact names use direct indexed
membership; only actual wildcard families scan compatible event names. The
wildcard and invalid-trigger compile laws remain unchanged.

## Phase 1: Exact Inngest surface specification

Inventory every stable public authoring and testing behavior in the pinned SDK.
Hosted control-plane administration and framework-specific HTTP adapters are
classified separately; no stable authoring capability is silently omitted.

### Client and function definition

- [x] Typed event schemas and event sending, including batches and explicit IDs.
- [x] `createFunction(configuration, handler)` contextual inference.
- [x] Event, cron, and invocation triggers, including multiple triggers.
- [x] Function references and typed invocation input/output.
- [x] `event`, `events`, `runId`, logger, attempt, and failure-handler context.
- [x] Retries, `NonRetriableError`, `RetryAfterError`, and `onFailure`.
- [x] Middleware behavior is classified as domain capability, dependency
      composition, or intentionally unnecessary framework machinery.

### Durable operations

- [x] `step.run`, including try/catch and independent retry identity.
- [x] `step.sleep` and `step.sleepUntil`.
- [x] `step.waitForEvent` with timeout, mutually exclusive `if` and `match`
      semantics, exact persisted envelopes, and unambiguous parallel routing.
- [x] `step.waitForSignal` and `step.sendSignal`, including one owner-scoped
      durable registry, atomic `fail`/`replace` conflict semantics, timeout,
      client delivery, step delivery, and restart recovery.
- [x] `step.invoke`, timeout, failure propagation, and reference functions.
- [x] `step.sendEvent`, batches, identities, and result shape.
- [x] `step.fetch` with the standard Fetch input/`Response` surface, durable
      binary-safe response persistence, retries, cancellation, direct-test
      replacement, and execution admission.
- [x] Parallel discovery and optimized parallel execution.
- [x] AI inference/wrapping and realtime publishing are classified as semantic
      Feature/Dependency concerns rather than kernel or workflow imports.

### Admission and scheduling

- [x] Function and keyed concurrency, including multiple limits and scopes.
- [x] Event batching with size, timeout, key, and exclusion expressions.
- [x] Rate limiting, throttling, debounce, singleton, and priority.
- [x] Start and finish timeouts; Inngest's current public configuration does not
      define a third execution-time timeout.
- [x] Cancellation by typed event, correlation, CEL, and expiry.
- [x] Cron scheduling and stable schedule identity.

### Testing and inspection

- [x] Direct function execution with supplied events and step mocks.
- [x] Automatic execution with the real durable engine.
- [x] Time control, retries, failures, waits, invocation, and emitted events.
- [x] Run history, attempts, output, error, children, waits, and cancellation.

### Gate 1

- [x] A parity matrix maps every stable upstream item to `same`, `stronger`,
      `platform-only`, or `missing`, with evidence and rationale.
- [x] Official examples compile after changing only imports and the one generic
      application contract/bootstrap required by Poggers.
- [x] Any intentional syntax difference is demonstrably required by stronger
      static information, not framework implementation convenience.

### Current parity inventory

This inventory is based on the pinned SDK's `InngestFunction.Options`,
`createStepTools`, trigger helpers, handler context, and test engine. The item
audit, translated compile corpus, and runtime conformance corpus jointly support
the classifications below.

| Area          | Same or stronger now                                                                                                                                                                                                                                                                                                                                                                                                                                             | Missing or incomplete                                            | Platform-only                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Definition    | Generic-first event, input, output, dependency, trigger, reference, and handler inference; event CEL; cron and invocation triggers; descriptions and option-object step IDs; duplicate IDs rejected; retries and separately durable failure functions; dependency injection is first-class rather than middleware; typed external references route through a replaceable semantic dependency; `appVersion` has an explicit durable policy; logging is injectable | Complete metadata/introspection                                  | HTTP serving adapters and cloud registration   |
| Durable tools | `run`, standard `fetch`, `sleep`, `sleepUntil`, exact event wait with match/CEL/timeout, owner-scoped signal wait/send with conflict and recovery, local and cross-application typed invoke, event send, retained parallel execution, explicit and direct-call durable races, and experiment selection                                                                                                                                                           | None currently identified in the stable pinned step-tool surface | Vendor AI gateway and cloud realtime transport |
| Admission     | Idempotent event IDs and keys; per-partition ordering; typed cancellation; one persisted model for step-level concurrency, batching, rate limits, throttle, debounce, singleton, priority, start/finish timeouts, invoked-run admission, and cron                                                                                                                                                                                                                | Multi-scope fairness corpus and exact invoked drop semantics     | Hosted queue administration                    |
| Recovery      | persisted schedule/start/settle, stable effect identity, uncertain-attempt reporting, restart replay, one durable priority scheduler, bounded retained history with an exact transition count, generation-fenced continue-as-new, and `appVersion` rejection before changed user code                                                                                                                                                                            | Ambient nondeterminism isolation                                 | distributed ownership transfer                 |
| Testing       | Real Resource/Program semantics, dependency replacement, virtual clock, restart and uncertainty; direct function and target-step execution with exact events, test dependencies, step mocks, semantic step traces, stateful incremental function checkpoints, and incremental semantic-event observation                                                                                                                                                         | Deterministic scheduler model                                    | Hosted dashboard inspection                    |

The item-level audit against the pinned public declarations is:

| Pinned public item                                                                                         | Classification             | Poggers evidence or rationale                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client `id`, function `id`, `name`, `description`, event/cron/invocation triggers                          | same                       | Feature mount/application identity plus literal function definitions; compile and runtime corpus                                                                                                                                                                                                                                   |
| Typed event send, batches, explicit IDs, metadata, wildcard event families                                 | stronger                   | Closed generic contract plus runtime Standard Schema validation and durable deduplication                                                                                                                                                                                                                                          |
| `logger` and handler logger                                                                                | same                       | Injectable semantic dependency is used by hosted and direct execution                                                                                                                                                                                                                                                              |
| `internalLogger`                                                                                           | platform-only              | Host diagnostics do not belong to the product function contract                                                                                                                                                                                                                                                                    |
| `appVersion`                                                                                               | same                       | Persisted per run; a changed deployment rejects active work before entering changed user code                                                                                                                                                                                                                                      |
| `eventKey`, `baseUrl`, `env`, `isDev`, signing keys, endpoint adapter                                      | platform-only              | Inngest cloud/HTTP deployment transport; Poggers host and sync adapters own the equivalent boundary                                                                                                                                                                                                                                |
| Client `fetch`                                                                                             | stronger                   | Replaceable semantic dependency with the standard Fetch surface and durable binary-safe responses                                                                                                                                                                                                                                  |
| Client/function middleware                                                                                 | stronger syntax difference | Feature composition and typed Dependencies provide explicit ownership and replacement without request-scoped middleware classes                                                                                                                                                                                                    |
| `optimizeParallelism`                                                                                      | stronger fixed policy      | Retained execution and grouped transitions are always enabled; no slower compatibility mode is exposed                                                                                                                                                                                                                             |
| `checkpointing` and deprecated `experimentalCheckpointing`                                                 | stronger fixed policy      | Every semantic schedule/start/settle transition crosses the configured Journal durability boundary; callers cannot weaken it per function                                                                                                                                                                                          |
| AI metadata and AI model tools                                                                             | platform/domain capability | AI providers and metadata extraction belong behind a consumer-owned semantic dependency, not the workflow kernel                                                                                                                                                                                                                   |
| Function concurrency, batching, idempotency, rate limit, throttle, debounce, priority, timeouts, singleton | same                       | One persisted admission model plus scenario/model/restart laws                                                                                                                                                                                                                                                                     |
| `cancelOn`, retries, retry-after/non-retryable errors, `onFailure`                                         | same                       | Typed correlation, deadlines, independent durable failure execution, and recovery laws                                                                                                                                                                                                                                             |
| `event`, `events`, `runId`, `attempt`, `maxAttempts`                                                       | same                       | Contextual handler inference and runtime corpus                                                                                                                                                                                                                                                                                    |
| `step.run`, `fetch`, `sleep`, `sleepUntil`                                                                 | same                       | Durable operation corpus and standard platform values                                                                                                                                                                                                                                                                              |
| `step.waitForEvent`, `waitForSignal`, `sendSignal`                                                         | same                       | Exact persisted envelopes, validation, owner-scoped registries, conflict policy, timeout, and restart laws                                                                                                                                                                                                                         |
| `step.invoke`, reference functions, `step.sendEvent`                                                       | same                       | Local and typed routed invocation, durable failures, event identities, and result shapes                                                                                                                                                                                                                                           |
| `group.parallel`, `Promise.all`, `Promise.race`, experiments                                               | same                       | Retained parallel declarations, one durable race winner, loser cancellation, and memoized selection                                                                                                                                                                                                                                |
| Realtime publish                                                                                           | platform/domain capability | Transport-specific pub/sub belongs behind a semantic dependency                                                                                                                                                                                                                                                                    |
| Direct test execution, supplied events, step mocks, target-step execution                                  | same                       | `testFunctions().execute()` and `executeStep()` translated fixture corpus                                                                                                                                                                                                                                                          |
| Incremental `@inngest/test` checkpoint waiting                                                             | same                       | `testFunctions().start()` returns one typed run whose `waitFor()` advances real `steps-found`, `step-ran`, `function-resolved`, and `function-rejected` checkpoints while memoizing prior step state. Translated upstream cases and a repeated-wait law prove discovery does not execute handlers and supplied mocks execute once. |
| Hosted dashboard/run administration                                                                        | platform-only              | Inspection UI/control-plane concern, not application authoring semantics                                                                                                                                                                                                                                                           |

The real client boundary now preserves each nested Feature API from the generic
application contract. The evidence harness no longer casts an erased
`Record<string, unknown>` back to a workflow API.

The compile-only translated corpus at
`packages/kit/src/features/workflows.typecheck.ts` now covers the pinned
official hello-world, sequential and parallel reduce, mixed parallel work,
`Promise.all`, `Promise.race`, event sending, handled and unhandled step errors,
multiple triggers, invocation with and without input, missing invocation,
polling, intentional undefined results, exact and wildcard trigger schemas,
and waited-event schemas. The only structural changes are the generic
application contract/factory bootstrap, literal trigger preservation required
by the closed contract, and one assertion required by
`noUncheckedIndexedAccess`. Standard Schema validation for waited events is
performed after durable delivery and remains correct across Program restart.
Runtime laws also prove wildcard schemas reject invalid payloads before handler
entry and a missing local invocation becomes a durable failed execution rather
than an unhandled host error.

## Phase 2: Linear retained execution

The normal path keeps one live asynchronous continuation per owned run. Durable
history remains authoritative; the continuation is a cache that may disappear.

- [x] Define an internal execution-session lifecycle keyed by owner and run ID.
- [x] Bind operation callbacks to durable operation identities during the
      original handler execution, without callback-discovery replay.
- [x] Persist scheduling before external execution and persist the attempt before
      invoking an effect.
- [x] Resume the awaiting continuation only after the persisted operation
      result is visible.
- [x] Remove callback-discovery replay.
- [x] Resume the existing continuation instead of starting the handler after
      every transition.
- [x] Reconstruct one session by replay only after restart, eviction, or
      ownership transfer.
- [x] Suspend a gated effect by durable operation identity and wake only that
      continuation when its admission state changes. Waiting for capacity does
      not occupy a Program delivery or replay unrelated declarations.
- [x] Fence stale Program attempts and record uncertainty before re-executing an
      effect whose prior outcome is unknown.
- [x] Dispose run controllers, timers, and closures on completion,
      cancellation, failure, restart, and host shutdown.
- [x] Keep the public Feature and function API unchanged.
- [x] Commit schedule/start atomically before an external effect, reducing the
      healthy durable path from three write barriers to the required two.
- [x] Coalesce same-turn parallel transition groups into bounded commands that
      never exceed the protocol's 128-event limit.

### Gate 2

- [x] Healthy sequential execution enters the handler once and declares exactly
      `N` unique operations.
- [x] Healthy parallel execution enters the handler once and declares exactly
      `N` unique operations.
- [x] Persisted semantic history remains `3N + 2` transitions for successful
      effect-only runs.
- [x] One recovery adds no more than one `O(N)` replay.
- [x] Normal and recovered executions have equivalent visible histories,
      outputs, errors, and effect identities.
- [x] Existing focused workflow, package, type, and application checks pass.

The bounded transition coalescer was not accepted from latency alone. A fast
translation test proves schedule/start remain adjacent semantic events under
one command identity; the recovery corpus proves uncertain attempts; retry and
race tests prove grouped transitions preserve ordering. A separate 300-segment
law asserts one handler entry while durable admission cycles through every
permit, preventing a correct-output regression from hiding full graph replay.
The complete workflow corpus currently passes 110 tests; the Program and
adversarial primitive corpus passes another 31 tests.

Measured after retained execution, filtered Program delivery, zero-copy
read-only command state, and coalesced source progress (seven samples after one
warmup):

| Operations | Sequential |  Parallel | Handler entries | Declarations | Transitions |
| ---------: | ---------: | --------: | --------------: | -----------: | ----------: |
|         10 |    0.86 ms |   0.51 ms |               1 |           10 |          32 |
|        100 |    4.48 ms |   3.16 ms |               1 |          100 |         302 |
|      1,000 |   42.52 ms |  32.35 ms |               1 |        1,000 |       3,002 |
|     10,000 |  430.96 ms | 343.16 ms |               1 |       10,000 |      30,002 |

These are medians from the in-memory semantic host and establish algorithmic
shape only. The SQLite boundary remains Gate 6 work.

The corrected TypeScript 7 run measures 217,872 instantiations and 249 ms check
time for 1,000 Poggers declarations versus 544,003 instantiations and 408 ms for
Inngest. Trigger validation is literal-first, so each declaration validates only
its selected event rather than distributing through the whole application
contract. The full evidence and compiler-selection correction are recorded in
Gate 0.

## Phase 3: Durable scheduler and execution semantics

- [x] Replace occupied in-handler timer deliveries with durable scheduler state.
- [x] Wake work from one persisted priority heap without polling every run.
- [x] Implement independent function and operation attempts with deterministic
      backoff and stable idempotency identities.
- [x] Implement durable start, finish, wait, and child-invocation deadlines and
      their timeout races.
- [x] Implement typed event cancellation, explicit cancellation, and
      parent-to-child propagation; scoped cancellation remains unimplemented.
- [x] Implement failure handlers exactly once after exhausted function retries.
- [x] Define deterministic workflow constraints: durable topology and versions
      are enforced, while hidden ambient access is an explicit JavaScript
      limitation that cannot be soundly rejected without restricting the
      language.
- [x] Define in-flight code version behavior and prove compatible completion or
      explicit rejection.
- [x] Define bounded history/snapshot/continue behavior for long-lived runs.

The plain JavaScript callback surface has one precisely bounded determinism
limitation. Durable operations, races, versions, and omitted or changed
topology are checked during replay, but the runtime cannot soundly reject an
ambient read hidden behind an imported helper or closure. In particular, a
mutable global read after the last durable operation can alter a not-yet-
committed final output without leaving an earlier value to compare. Source-text
inspection would be bypassable and process-global monkey-patching would break
concurrent application code, so neither is accepted as enforcement. Full
isolation requires a compiled workflow module executed with deterministic
clock, randomness, timers, and I/O globals, similar to Temporal's isolate. The
pinned Inngest callback engine has the same class of limitation. Until such an
isolate is justified and implemented, ambient observations must occur inside a
durable step and complete deterministic replay remains an explicit limitation,
not an inferred guarantee.

### Gate 3

- [x] Virtual-time model tests cover all timer, deadline, retry, and cancellation
      orderings without wall-clock sleeps.
- [x] Crash injection at every durable boundary preserves the reference result.
- [x] Uncertain external effects are never silently treated as exactly once.
- [x] Long sleeps consume no active Program delivery or execution session; 300
      concurrent sleeps use one clock waiter.

The deterministic Feature host now exposes one testing-only
`interruptNextProgramCommand` control. It interrupts either before a Resource
decision or after the decision and semantic events are committed but before the
Program receives its acknowledgement. A generic nested-Feature law proves both
phases recover through the same stable command identity and emit one completion
event.

The workflow recovery corpus applies that control at 38 Program-authored
decisions: atomic effect schedule/start, success, retry, operation failure,
terminal success and failure, whole-workflow retry schedule and wake, sleep
schedule and wake, signal consumption, continue-as-new, race settlement, child
start/completion/parent settlement, admission handoff, finish-timeout
cancellation, and queued-run rejection. Every case restarts the Program
generation and converges to one legal result. Stable external identities remain
stable, committed transitions occur once, and a before-commit retry schedule
correctly leaves no schedule record while an acknowledgement loss retains
exactly one. Admission acknowledgement loss may re-enter an uncertain effect;
the law therefore requires one stable, deduplicated semantic side effect rather
than claiming callback exactly-once.

Root `start`, `signal`, and explicit `cancel` are client Resource commands, not
Program commands. Their before/after-decision behavior is covered once by the
shared Resource/Journal fault laws, while workflow tests cover their state
semantics. Program claim, completion, and source-checkpoint outcomes are covered
by the shared Program fault matrix, and SQLite has a real `SIGKILL` recovery law.
Together these cover each distinct durable layer without copying the same
adapter test for every transition payload.

The first workflow interruption found a real error-ownership defect: an
infrastructure failure from the transition batcher was being caught as a user
effect exception and persisted as a terminal workflow failure. Persistence
errors now escape through an internal infrastructure error and fail the Program
generation for replay; user effect errors retain normal retry/failure behavior.

An exhaustive virtual-time model enumerates all 24 strict orderings of signal
delivery, wait timeout, finish deadline, and explicit cancellation, plus all six
strict orderings of retry wake, finish deadline, and cancellation. It advances
only the injected clock, compares each run with the earliest-event reference
outcome, and requires exactly one terminal transition. All 30 traces complete
in roughly 570 ms, so this remains a fast focused test rather than a slow
end-to-end matrix.

## Phase 4: Admission control and event routing

- [x] Build one durable admission model used by concurrency, rate limits,
      throttle, debounce, batching, singleton, and priority.
- [x] Define and prove fairness across owners and hot keys for the single-node
      scheduler: admission is environment-global, unrelated keyed lanes
      progress independently, and bounded priority aging prevents starvation.
- [x] Compile typed selectors/correlation into a validated internal expression
      representation; do not execute arbitrary strings ad hoc.
- [x] Preserve per-key ordering while allowing unrelated keys to progress.
- [x] Bound payloads, active sessions, and aggregate fan-out. Program consumer
      queues, sync frames, client/server message queues, and per-Resource
      command queues are bounded.
- [x] Define current overload behavior explicitly: Program event saturation and
      Journal delivery apply lossless backpressure; protocol/frame and socket
      limits reject or disconnect; Resource command saturation rejects with a
      typed server-overload error. No path silently sheds semantic work.
- [x] Prove idempotent event ingestion and deterministic trigger selection for
      exact event identities, validated CEL predicates, and the indexed
      trigger registry.

### Gate 4

- [x] Generated keyed-priority traces match a small executable admission
      reference model.
- [x] No option is implemented by an independent timer or queue that contradicts
      another option.
- [x] Fairness and starvation tests pass across owners and keys in one mounted
      environment.
- [x] Restart reproduces the same admitted, delayed, cancelled, and batched work.

Current evidence covers priority-ordered concurrency leases, independent keyed
lanes, two simultaneous concurrency constraints, max-size/conditional/timed
batching, restart-safe debounce replacement and maximum delay, keyed sliding
rate windows, idempotency overriding lossy rate limits, token-bucket smoothing
and recovered bursts, singleton skip/replacement, and observable start-timeout
rejection. All delayed admission uses the same durable priority scheduler as
workflow deadlines and one nearest-deadline clock waiter. Priority contributes
a bounded score offset while queue age grows monotonically, so the complete
priority range cannot starve an older run forever.

Restart coverage now spans every admission outcome category: queued and
uncertain execution leases, before/after-commit permit handoff, debounce delay,
recovered throttle tokens, correlated cancellation indexes, start/finish
deadlines, and a partially filled durable batch. The batch law restarts before
its timeout and then flushes the exact original event pair once. These cases use
the same admission Resource and scheduler rather than independent option-specific
queues.

Admission state is owned once per Feature environment rather than once per
actor. A persistent server test with two independent WebSocket clients proves
that environment-scoped concurrency shares one slot across owners while the
same external run identity remains owner-isolated. The pinned Inngest audit also
corrected an earlier semantic mistake: `fn` scope is function-wide, `env` and
`account` require an explicit CEL key, and tenant isolation is expressed in
that key rather than silently injected from the actor. On one single-node
environment, account scope has the same physical boundary as environment
scope; cross-environment account coordination remains cluster-adapter work.

A strict gated-effect workload exposed two independent lifecycle defects. First,
Program delivery could block on a process-local admission waiter while the same
delivery stream contained the future grant, creating a cyclic backpressure
deadlock. Admission is now a durable operation transition: a blocked gate
quiesces its handler and a persisted grant wakes it. Second, 300 simultaneous
short admission commands exceeded the authority's intentional 256-command
same-Resource queue. A lifecycle-owned gate bounds only those command
submissions at 64; it neither batches semantic commands nor waits for future
events. The first attempted cross-invocation batcher was rejected because it
violated Program invocation ownership and restart replay.

That correction exposed a third cost: blocked effects used never-resolving
promises, causing the retained workflow session to be discarded and the whole
parallel graph to replay on each grant. Sessions now retain operation-indexed
wake signals. The 300-step strict SQLite/server/WebSocket/client regression
completes in about 1.23 seconds and the 1,000-step case in about 3.51 seconds,
both with one handler entry and a Program pending-event bound of eight. Before
the wake fix, 500 steps took 9.46 seconds and 1,000 did not finish within 20
seconds. The complete workflow, restart, Program, and adversarial suites pass
after the change.

Program source positions were also being persisted once per observed Journal
record per consumer. They are replay cursors, while per-scope invocation
receipts carry the effect-safety invariant. Consumers now checkpoint the latest
safe high-water mark after 128 positions or 100 ms, whichever comes first, and
force the final cursor on drain, inspection, and shutdown. A focused burst law,
the complete Program recovery corpus, and all 108 workflow tests pass.

Each Program consumer now has a host-configurable `maxPendingEvents` bound
(1,024 by default). `enqueue()` waits for capacity before Journal source
progress may advance, so overload delays the source subscription rather than
growing memory, rejecting durable work, or dropping it. A capacity-one law
holds the first handler, proves the second delivery remains backpressured, then
releases both in source order.

The first blocked-queue workload exposed `O(N^2 log N)` submit behavior from
full-queue sorting and wake scans: 1,000 submissions took about 568 ms.
Persisted constraint-indexed priority heaps and cached wake state removed that
algorithm. A later whole-run profile then found two different quadratic scans:
event cancellation/wait delivery scanned every active run, and each execution
segment scanned every active admission job. Durable correlation buckets, exact
event-wait registrations, O(1) active-run membership, and O(1) active-segment
ownership now route only relevant work and survive Program restart.

The evidence observer itself was also quadratic because it repeatedly copied
and rescanned the complete semantic event history. The testing host now exposes
incremental `observeEvents`, and the corrected full-run evidence measures
1,000 admitted starts at 109.76 ms and 10,000 at 1,119.02 ms, a 10.2x time
increase for 10x work. An independent size run measured 10, 100, and 1,000
starts at 5.30, 13.36, and 114.49 ms. Correlated cancellation/release measured
13.58, 161.20, and 1,414.23 ms for the same sizes. These are in-memory
Resource/Program boundary diagnostics, not a substitute for the generated
reference model and persistent Journal evidence still required by Gates 4 and 6.

The parity audit falsified the original whole-run concurrency assumption.
Concurrency now leases only an active `step.run` execution segment. Sleeps,
event waits, and child waits release capacity; parallel steps in one run acquire
independent permits; queued and uncertain leases are reclaimed after Program
restart. Keyed lanes, simultaneous constraints, priority traces, and invoked
function admission pass against this corrected model. Full-run creation remains
separate from the admission-heap algorithm benchmark because conflating those
boundaries produced misleading queue numbers.

Cron scheduling uses the maintained five-part Croner parser, supports `TZ=` and
`CRON_TZ=` prefixes and deterministic jitter, deduplicates overlapping schedules
by stable run identity, and restores the next occurrence after Program restart.
Implementing it exposed a general autonomous-Program invariant: Feature-local
Program contexts must retain the root actor identity. The kernel now preserves
that identity at the Feature boundary, with a direct composition regression
test. Consumers are installed synchronously before cron bootstrap can publish,
preventing immediate post-construction events from being lost.

`appVersion` is persisted on every workflow run and included in the bounded
reactive execution projection. Same-version code executes normally. A changed
version uses a version-scoped orchestration cursor to perform one durable
replay; completed runs remain untouched, while active mismatches fail with a
structured `WorkflowVersionMismatchError` before new user code runs. A strict
SQLite test starts a release-1 event wait, stops the server, reopens the same
Journal with release-2, and proves the release-2 handler is never entered. That
boundary test also exposed explicit `undefined` fields in wait/invoke operation
commands; optional fields are now omitted before persistence.

### Finding: retained continuation scope

Healthy effects, sleeps, waits, and child results retain one live continuation.
Focused tests prove one handler entry for each case and exactly one additional
linear replay after a Program restart. The retained execution clock advances at
durable resume boundaries, so deadlines created after a wait do not use stale
start time. An effect that reaches an uncertain retry boundary still evicts its
continuation deliberately; replay is the recovery path rather than hidden
exactly-once behavior.

## Phase 5: Complete Inngest-compatible factory

- [x] Implement every `missing` item accepted by Gate 1. The final audit contains
      no stable authoring item classified as missing.
- [x] Keep workflow-owned Resources, Programs, dependencies, API, test support,
      and internal runtime within the workflow Feature owner.
- [x] Instantiate the factory twice in one application without identity or type
      collisions.
- [x] Compose one workflow factory inside another Feature and consume only its
      semantic API.
- [x] Replace each dependency independently in tests.
- [x] Verify browser projection excludes handlers and server dependency
      implementations. The AST projection lowers `createFunctions` to the
      shared runtime before bundling, and an emitted-code law rejects a unique
      server marker plus framework scheduler/admission implementation markers.
      Private-contract export inventory remains part of the final packed-consumer
      audit.
- [x] Remove superseded workflow experiments and duplicate APIs. The generic
      workflow engine remains one intentional lower-level consumer of the same
      Feature primitives, not a compatibility implementation of `createFunctions`.

### Gate 5

- [x] The official example corpus and translated upstream conformance cases pass.
- [x] The parity matrix contains no unexplained `missing` entries.
- [x] Application code contains no Resource, Program, scheduler, or persistence
      plumbing.
- [x] Type errors point to the incorrect event, function, option, or handler
      expression rather than an internal conditional type.

## Phase 6: Single-node production and performance

Run both systems on the same machine with equivalent persistence and durability.
Report in-memory numbers separately as algorithm diagnostics.

### Workload dimensions

- [x] Empty dispatch and one operation.
- [x] 10, 100, 1,000, and 10,000 sequential operations.
- [x] 10, 100, 1,000, and 10,000 parallel operations.
- [x] 1, 10, 100, and 1,000 concurrent runs with hot and independent keys.
- [x] Small and large event, result, and history payloads.
- [x] Timers, waits, retries, children, fan-out/fan-in, cancellation, and batching.
- [x] Warm execution, cold process, and completed-run restart recovery.
- [x] A real process crash after an external effect but before acknowledgement
      recovers with stable identity, explicit uncertainty, and one side effect.
- [x] Failure before and after every durable workflow boundary.
- [x] SQLite growth, snapshots, reopen, capacity failure, backup/restore, and
      corruption detection; online log compaction remains intentionally absent
      because permanent command receipts are part of the current contract.

### Metrics and budgets

- [x] Handler entries, operation declarations, transitions, Journal appends,
      transactions, and fsync behavior.
- [x] Throughput and p50/p95/p99 end-to-end latency.
- [x] CPU time, peak/resident memory, allocations where observable, and database
      bytes per logical operation.
- [x] Healthy execution remains linear through 10,000 operations.
- [x] Concurrent throughput scales until an identified hardware or durability
      boundary, without unbounded queue or memory growth.

### Gate 6

- [x] Poggers is faster than pinned Inngest on the agreed primary single-node
      workloads, or the report identifies the precise losing layer and evidence.
- [x] No faster result weakens durability or performs fewer semantic operations.
- [x] SQLite and in-memory implementations pass the same contract laws.
- [x] Completed-run restart and recovery performance are measured, not inferred.

Current three-sample evidence after one isolated warmup per case:

| Boundary                                   | Operations | Sequential median / p95 |  Parallel median / p95 | Transitions |
| ------------------------------------------ | ---------: | ----------------------: | ---------------------: | ----------: |
| Poggers SQLite FULL + server + WS + client |          0 |        15.45 / 15.66 ms |       14.89 / 15.28 ms |           2 |
| Poggers SQLite FULL + server + WS + client |          1 |        14.63 / 14.65 ms |       13.19 / 13.51 ms |           5 |
| Poggers SQLite FULL + server + WS + client |         10 |        17.21 / 18.04 ms |       14.09 / 14.99 ms |          32 |
| Poggers SQLite FULL + server + WS + client |        100 |        67.79 / 70.31 ms |       22.73 / 23.31 ms |         302 |
| Poggers SQLite FULL + server + WS + client |      1,000 |      610.67 / 646.27 ms |     119.89 / 149.99 ms |       3,002 |
| Poggers SQLite FULL + server + WS + client |     10,000 |  7,313.13 / 7,363.53 ms | 1,634.58 / 1,935.36 ms |      30,002 |
| Inngest Dev Server 1.37.0 + Bun SDK 4.12.1 |         10 |      239.96 / 258.27 ms |     248.68 / 269.03 ms |         n/a |
| Inngest Dev Server 1.37.0 + Bun SDK 4.12.1 |        100 |      223.72 / 229.99 ms |     699.17 / 739.98 ms |         n/a |
| Inngest Dev Server 1.37.0 + Bun SDK 4.12.1 |      1,000 |                1,454 ms |      timed out at 90 s |         n/a |

Five final isolated samples complete 1,000 strict Poggers operations in an
857 ms sequential median and a 123 ms parallel median. The pinned Inngest Dev
Server's final 1,000-step sequential median was 1,462 ms while its 1,000-way
parallel run did not complete within the configured timeout. Poggers uses SQLite `FULL` and
records the before-effect and after-effect boundaries power-safely. The pinned
Inngest Dev Server persists history/configuration to SQLite but keeps active run
state in memory with periodic snapshots; it is explicitly **not** power-safe per
operation. These numbers therefore demonstrate Poggers winning at a stronger
boundary, not a dishonest equivalent-durability claim. The payload, concurrency,
behavior, process-crash, restart, compiler, Inngest test-engine, and pinned
Inngest server matrices all completed in isolated processes. A production
Inngest backend with per-operation power-safe durability is not available in the
pinned local distribution, so no equivalent weaker durability is inferred.

The first strict concurrency workload exposed redundant admission coordination:
an immediately admitted effect created a durable grant action, a Program
invocation, and an acknowledgement even though the submitting continuation
already observed the active lease. The admission Resource now marks only changes
that require asynchronous coordination. At 100 concurrent runs and 1,000
effects, the hot-key case fell from 16,302 to 8,556 Journal records and from
about 4.53 seconds to 2.37 seconds; independent keys complete in 2.47 seconds
with the same record count. Both retain 100 handler entries, 1,000 operation
declarations, 3,200 workflow transitions, strict SQLite durability, and restart
recovery. Raw evidence is retained at
`/tmp/poggers-workflow-concurrency-optimized.json`.

The complete strict concurrency boundary now reaches 1,000 simultaneous runs,
10,000 declared effects, and 32,000 exact workflow transitions. Hot-key work
completes in 57.81 seconds and independent-key work in 54.64 seconds, with
86,731 and 86,650 Journal records respectively and no handler or declaration
replay. Counts and database growth remain linear from 100 through 1,000 runs.
The final rows are retained at
`/tmp/poggers-workflow-concurrency-hot-small-final.json`,
`/tmp/poggers-workflow-concurrency-1000-hot-fixed.json`, and
`/tmp/poggers-workflow-concurrency-independent-final.json`.

This workload falsified client synchronization liveness before it measured the
execution limit. Creating more than 256 reactive run handles sent one subscribe
frame per scope; the server returned snapshots faster than the durable client
replica could confirm them, the intentional 256-message queue disconnected,
and reconnect reproduced the same burst forever. The server-side journal
proved all 270 diagnostic workflows had completed exactly. Subscription bursts
now coalesce through the existing 128-operation protocol batches on initial
access and reconnect. Unit and real server/client laws synchronize 300 scopes
without weakening queue or byte bounds, and the formerly stuck 1,000-run case
completes.

The strict payload matrix covers 0, 128, 4 KiB, 64 KiB, and 256 KiB event,
effect-result, function-output, and client-projection payloads. The 256 KiB row
completes in a 93.58 ms median and preserves five exact transitions. It exposed
that one legal decision could expand into a snapshot larger than one WebSocket
frame, producing an unrecoverable reconnect loop. Server snapshots are now
split into bounded UTF-8/base64 transport chunks, reassembled under the
client's aggregate byte cap, and tested with an amplified 1.3 MiB snapshot.
The transport also now follows Bun's documented send contract: `-1` is queued
under backpressure while only `0` is dropped. Raw payload evidence is retained
at `/tmp/poggers-workflow-payload-final.json`.

A strict production behavior corpus now crosses SQLite `FULL`, the server
authority, Programs, WebSocket synchronization, the client replica, and the
typed Feature API for a real timer, waited event, failed-then-successful retry,
child invocation, 32-way fan-out/fan-in, explicit cancellation, and a timed
two-event batch. Three measured samples complete in a 434.71 ms median and
479.89 ms p95. The behavior run records 110 transitions, cancellation records
three, batching records two, and the representative sample writes 292 Journal
records to a 1,015,808-byte database. Raw evidence is retained at
`/tmp/poggers-workflow-behavior-final.json`.

Cold recovery is measured separately so startup and replay are not hidden in a
healthy-run median. Each sample first completes a strict SQLite run, stops the
server, reopens the same Journal, starts the Program host, reconnects a fresh
WebSocket client, and waits for the completed projection. Five isolated samples
produce:

| Operations | Sequential median / p95 | Parallel median / p95 | Handler re-entries |
| ---------: | ----------------------: | --------------------: | -----------------: |
|          0 |        22.59 / 31.33 ms |      21.00 / 21.37 ms |                  0 |
|         10 |        21.09 / 21.65 ms |      20.52 / 21.14 ms |                  0 |
|        100 |        29.26 / 30.05 ms |      24.55 / 44.84 ms |                  0 |
|      1,000 |      100.09 / 102.43 ms |      53.83 / 55.84 ms |                  0 |

Outputs and `3N + 2` transition counts remain exact. Sequential recovery grows
with its retained step history; packed parallel recovery grows more slowly. The
raw matrix is retained at `/tmp/poggers-workflow-recovery-current.json`. This
proves completed-run cold recovery. It does not substitute for the still-open
every-boundary fault corpus.

A separate child-process experiment removes the test host from the hardest
effect boundary. The first process is sent `SIGKILL` from inside an external
effect after strict SQLite has committed `operationStarted`; a fresh process
reopens the same Journal and completes through the production server and
Program host. The recovered run has six exact transitions, retries as attempt
2 with `uncertainAttempts: [1]`, enters the handler once in the new process,
uses the same external identity for both attempts, and records one side effect.
The measured recovery process took 128.10 ms. Raw evidence is retained at
`/tmp/poggers-workflow-crash-current.json`. Failures at every other workflow
commit boundary remain an open model-test gate.

The first 10,000-operation production run timed out after 120 seconds despite
the server completing smaller workloads linearly. The failure falsified an API
boundary rather than the execution engine: `getFunction().run` activated the
full synchronized workflow Resource, so every observer received the entire
operation graph and eventually crossed the 1 MiB protocol frame limit. The
Functions Feature now publishes a bounded per-run execution projection for
ordinary reactive status, output, error, attempts, retries, and cancellation.
Full operations/messages/history are available only through the explicit
`details` getter. A 1,000-operation semantic law proves the projection remains
below 2 KiB while all details remain inspectable; projected cancellation is
durable and idempotent. With that correction, strict 10,000-operation runs
complete in a 7.31-second sequential median and a 1.63-second parallel median.
All three current 10,000-operation samples preserve the same 30,002-transition
budget.

Workflow history is now a bounded 256-entry diagnostic tail while
`transitionCount` retains the exact lifetime count and the Journal remains the
authoritative complete history. `continueAsNew` starts a fresh generation,
resets operation/race/message/retry state, fences stale scheduled work by
generation, and includes the generation in external-effect identities. A
four-generation test proves bounded state and fresh effect identities.

The production harness reports committed Journal records by Resource and the
closed SQLite file size. A current 100-operation sequential sample produces 264
Journal records: 203 workflow-run records, 28 Program invocation records, 20
source checkpoints, and 13 routing/scheduler/admission records. The parallel
translator coalesces the same semantic 302 transitions into 58 Journal records
and a 569,344-byte database. At 10,000 operations, sequential execution writes
21,567 records while the parallel translator writes 309 without changing the
30,002-transition semantic history. These are deterministic work counters, not
latency proxies.

The shared Journal law and recovery corpus passes 30 tests with 2,354
assertions. Both adapters satisfy generated duplicate/conflict schedules and a
portable logical export/import law. The SQLite authority additionally proves
exclusive ownership, minimal indexed access paths, snapshot anchoring, paged
subscription catch-up, atomic capacity and filesystem failure, verified online
backup/restore, malformed and tampered database rejection, exact reopen, and an
actual `SIGKILL` writer recovery with only contiguous complete decisions. This
closes adapter contract conformance; it does not substitute for workflow-level
crash injection or measured recovery latency.

### Core findings from the workflow experiment

- Nested Feature ownership exposed a generic Program parser defect: splitting
  `resource.event` at the first dot loses nested Resource names. Parsing at the
  final delimiter fixed the primitive and passes the Program integration suite.
- External effects require exactly two healthy durable barriers. A
  Feature-owned multi-event command preserves schedule/start history in the
  first barrier; completion/failure is the second.
- Large parallel declarations require bounded semantic coalescing before the
  authority queue. This is workflow-owned translation, not workflow behavior in
  the kernel.
- Cross-application function references remain an explicit limitation until a
  routing capability is mounted. The workflow Feature now owns a typed semantic
  routing dependency: direct tests observe its exact request, hosted execution
  persists it as a normal effect, Program restart reuses the same idempotency
  key, and the adapter receives prior uncertain attempts. Without the
  dependency, the same reference still fails explicitly instead of pretending a
  remote route exists.
- Program execution now carries an explicit read origin through the generic
  Resource authorization boundary. A multi-owner admission experiment exposed
  that commands distinguished client and Program authority while reads did
  not. Client reads remain owner-isolated; trusted Program reads can coordinate
  Feature-internal environment state in both the hosted and deterministic test
  runtimes.
- Function definitions are collected once at Feature validation and once per
  Program generation, including dependency replacement after restart. Handler
  entry is an `O(1)` registry lookup, and incoming event dispatch uses a
  precomputed trigger index proportional to matching registrations rather than
  all declared functions.
- Active runs, cancellation correlations, exact event waits, and admitted
  execution segments use durable owner-scoped indexes. Correlation compares
  canonical JSON values rather than object identity, and lifecycle transitions
  including `continueAsNew` remove stale registrations.
- Function logging is an injectable semantic dependency in hosted and direct
  execution rather than a fixed console side effect. `appVersion` matches the
  pinned client concept and drives the durable version policy above.

## Phase 6A: Primitive cost decomposition

Workflow end-to-end measurements cannot prove that the substrate itself is
efficient: they combine factory algorithms, the deterministic test host,
Resource semantics, Program delivery, persistence, synchronization, and client
projection. This phase removes workflow logic and measures each primitive at
the smallest boundary that still preserves its contract. Production-host and
test-host results are always reported separately.

The current five-sample equivalent matrices are retained at
`/tmp/poggers-primitives-equivalent-final.json`,
`/tmp/poggers-resource-equivalent-current.json`,
`/tmp/poggers-program-equivalent-current.json`, and
`/tmp/poggers-composition-equivalent-final.json`. Every row runs in a fresh Bun
process after one discarded child and reports median, p95, p99, CPU,
resident-memory delta, raw samples, and deterministic semantic work. The direct
references now perform the same contract work as the measured subset: contract
validation and manifests; authorization, canonical identity, command hashing,
JSON validation, idempotency, event reduction, and Journal append; event-keyed
routing, partition ordering, bounded concurrency, durable claims/completions,
source progress, and the public Program item surface; dependency lifecycle; and
deterministic command execution with retained event history.

At 10,000 operations, the primary cold-process medians are:

| Primitive               | Direct equivalent | Framework | Ratio | Framework p95 | Deterministic work                                  |
| ----------------------- | ----------------: | --------: | ----: | ------------: | --------------------------------------------------- |
| Application/Feature     |          12.81 ms |  14.14 ms | 1.10x |      17.37 ms | 10,000 Features, Resources, and manifest entries    |
| Resource authority      |          35.70 ms |  71.63 ms | 2.01x |      72.87 ms | 10,000 commands, events, and Journal appends        |
| Program delivery        |           9.47 ms |  35.54 ms | 3.75x |      36.85 ms | 10,000 claims/completions and 79 source checkpoints |
| Dependency lifecycle    |           7.97 ms |   8.89 ms | 1.12x |       9.50 ms | 10,000 starts, lookups, and reverse stops           |
| Deterministic test host |           9.09 ms |  14.27 ms | 1.57x |      14.78 ms | 10,000 commands, events, and retained inspection    |

The former 10.20x test-host claim compared a raw counter and `Map` with a real
application. Replacing it with an honest direct implementation reduced the
measured marginal ratio to 1.57x without changing framework behavior. The same
correction was made for Program items and Feature composition. These numbers
remain subset-equivalent references rather than claims that a handwritten
implementation supplies unmeasured recovery or tooling features.

The initial Resource matrix grew from about 32 ms at 1,000 commands to 804 ms
at 10,000. Inspection found two hidden in-memory Journal scans: every receipt
and duplicate check scanned the complete aggregate history, and every live
subscription wake scanned the global log from position zero. Address-scoped
receipt indexes and position-indexed delivery removed those quadratic paths.
The same 10,000-command framework workload now takes a 79 ms median while the
memory and SQLite contract corpus remains unchanged. This is the intended use
of cost decomposition: a linear semantic counter cannot excuse a superlinear
implementation underneath it.

The Resource dimension matrix covers accepted and denied reads, denied and
accepted commands, zero and four-event decisions, duplicate receipts,
conflicting command identities, scalar and structured keys, independent
scopes, observers, and payloads from 1 byte through 10 KiB. At 10,000
operations, framework/reference ratios are 1.43x for zero-event decisions,
1.98x for four-event batches, 3.87x for duplicate receipt checks, 1.77x for
identity conflicts, 1.85x for independent scalar keys, 1.99x for structured
keys, and 2.03x with a live observer. Authorized and denied reads take 1.89 ms
and 1.50 ms respectively. One 10 KiB payload takes 1.58 ms versus 0.69 ms and
does not introduce a size-dependent copy. Duplicate lookup remains
constant-time relative to retained history, and observers do not rescan prior
records.

The strict persistent matrix at
`/tmp/poggers-persistent-primitive-current.json` uses SQLite `FULL`, immediate
commits, and the same Resource authority. One thousand commands, events, and
appends take 152.02 ms median and 156.71 ms p95, producing a 774,144-byte
database. After an unmeasured setup phase, opening that database and replaying
the 1,000-record Resource into an exact state, cursor, and head takes 10.28 ms
median and 12.85 ms p95. At 1, 10, 100, and 1,000 records both time and bytes
remain monotonic; adapter contract, corruption, snapshot, and `SIGKILL` laws
remain in the shared Journal suite.

Program review replaced all-consumer dispatch with an event-keyed registry,
sorted-array pending-cursor maintenance with a lazy-deletion min-heap, and
promise allocation on every enqueue with a synchronous common path that only
allocates on actual backpressure. A 256-partition reverse-completion law proves
the durable source cursor cannot cross the earliest unfinished event. The
production host now resumes after its persisted source position; the completed
restart row therefore performs 100,000 first-lifecycle invocations and receives
zero already-completed source records after restart.

The equivalent Program matrix establishes:

| Workload               | Large case      | Direct equivalent | Framework | Ratio | Semantic work                                                                  |
| ---------------------- | --------------- | ----------------: | --------: | ----: | ------------------------------------------------------------------------------ |
| Unrelated consumers    | 256 consumers   |          10.37 ms |  35.74 ms | 3.45x | 10,000 source events, 10,000 matching invocations, 255 unrelated registrations |
| Matching consumers     | 256 consumers   |         188.33 ms | 635.32 ms | 3.37x | 1,000 source events, 256,000 matching invocations                              |
| Filtered delivery      | 10,000 events   |           4.35 ms |   9.84 ms | 2.26x | 10,000 filters and zero matched invocations                                    |
| Command-emitting       | 10,000 events   |          12.41 ms |  36.61 ms | 2.95x | 10,000 public item handles, commands, claims, and completions                  |
| Hot partition          | 10,000 events   |           9.76 ms |  52.79 ms | 5.41x | 10,000 serialized matching invocations                                         |
| Independent partitions | 10,000 events   |          12.94 ms |  34.37 ms | 2.66x | 10,000 independently schedulable invocations                                   |
| Completed restart      | 100,000 records |          81.04 ms | 276.58 ms | 3.41x | 100,000 initial invocations and zero replayed source records                   |

Unrelated registrations stay flat on the event path, matching fan-out scales
with actual invocations, and 100,000 completed records scale linearly from the
10,000 row. A 10 KiB event takes 2.12 ms versus a 0.63 ms direct equivalent;
payload size remains flat because Program routing does not copy payload bytes.

Small and 100,000-operation CPU profiles classify the remaining dominant work
as follows: Application spends its time constructing and canonically validating
definitions; Resource spends it on canonical keys, hashing, validation,
structured cloning, Journal append, and event reduction; Program spends it on
progress fencing, queueing, canonical scope keys, and Resource handles;
Dependency spends it on lifecycle construction; the test host spends it on
command execution, canonical scope keys, and retained inspection history. No
post-fix profile contains an unrelated whole-history scan. These classifications
do not prove the costs are minimal; the open workload matrices below must still
separate each guarantee.

The equivalent composition matrix separates one-time definition work from
Resource and Program execution:

| Startup workload                 | Large case  | Direct equivalent | Framework | Ratio |
| -------------------------------- | ----------- | ----------------: | --------: | ----: |
| Flat Feature composition         | 10,000      |          12.54 ms |  14.78 ms | 1.18x |
| Nested Feature composition       | depth 1,000 |          15.61 ms |  17.92 ms | 1.15x |
| Semantic API instantiation       | 10,000      |          10.01 ms |  12.43 ms | 1.24x |
| Two isolated compositions        | 2 x 10,000  |          20.11 ms |  22.37 ms | 1.11x |
| Flat dependency lifecycle        | 10,000      |           7.97 ms |   9.14 ms | 1.15x |
| Direct semantic dependency calls | 10,000      |           0.29 ms |   0.61 ms | 2.11x |
| Owner-scoped dependency groups   | 10,000      |           9.33 ms |  17.74 ms | 1.90x |

Flat composition and API instantiation scale with entries. Deep nesting also
scales with the emitted fully qualified identity bytes; a depth-N chain cannot
have an O(N)-byte manifest because its paths themselves contain O(N squared)
segments. These are startup costs and are not repeated on ordinary Resource
commands or Program deliveries.

The locked verifier now accepts 53 budgets: 29 framework/reference ratios and
24 scaling curves. It includes 10,000 Feature mounts, Resource decisions,
Dependency lifecycles, and test-host commands; 100,000 completed Program
records; 256 matching and unrelated consumers; hot and independent partitions;
observers; structured keys; duplicates; conflicts; denied operations; and
payloads through 10 KiB. The verifier fails on a missing comparison row, a
ratio over its predeclared budget, a p95/median tail above 1.6, or a scaling
curve above its declared bound.

Internal engine counters are isolated by one-factor workloads and CPU profiles
rather than by adding instrumentation branches to production hot paths. The
deterministic counters report externally required commands, decisions, events,
appends, claims, completions, source checkpoints, notifications, and calls.
SQLite evidence records transaction policy (`FULL` durability and immediate
commit), Journal records, and closed database bytes; SQLite's platform fsync
syscalls and JavaScript allocator events are not exposed as stable runtime
metrics, so CPU time and isolated-process RSS are the retained proxies. This is
an explicit measurement limit, not an inferred zero cost.

Lifecycle behavior is covered at the cheaper semantic layer: Program laws
exercise bounded backpressure, aborting shutdown, before/after claim, command,
completion, and source-checkpoint outcomes, plus SQLite reopen; Resource and
Journal laws cover decision, snapshot, corruption, and reopen outcomes. The
100,000-record replay row then measures the recovered completed path. The
adversarial suite supplies the realistic cross-primitive application while the
workflow-free primitive matrices prevent that factory from hiding core costs.

### Reference models and methodology

- [x] Implement a dependency-free direct reference for every measured law. A
      reference must perform the same authorization, command idempotency, event
      reduction, ordering, progress, and recovery work as the primitive under
      test; a raw function or `Map` that omits those semantics is not an honest
      baseline.
- [x] Measure no-op framework overhead separately from required semantic work,
      and report deterministic operation counts alongside p50/p95/p99 latency,
      CPU time, allocations, resident memory, and persisted bytes.
- [x] Run warm and cold samples in isolated processes, retain raw
      machine-readable results, record the machine/runtime versions, and pin
      workload seeds.
- [x] Profile representative small and large samples. Every dominant stack must
      be assigned to required semantics, an adapter, the test harness, or
      avoidable implementation overhead.
- [x] Lock target budgets in `primitive-evidence.ts` after equivalent references
      and before the remaining workflow/adversarial work. The verifier checks 29
      equivalent time/memory/tail budgets and 24 scaling budgets; failed
      measurements cannot be rewritten to pass.

### Application and Feature

- [x] Measure application validation, API construction, and memory for 1, 10,
      100, and 1,000 flat and nested Features.
- [x] Prove Feature lookup, Resource ownership, dependency-group resolution,
      and Program composition have the documented complexity and do not repeat
      whole-application traversal during ordinary calls.
- [x] Measure two instances, deep nesting, cross-Feature API use, and dependency
      replacement without involving workflow execution.
- [x] Separate one-time definition/startup costs from per-command and per-event
      costs.

### Resource

- [x] Benchmark authorized view reads, rejected reads, commands emitting zero,
      one, and bounded batches of events, identified duplicate commands, and
      conflicting identities.
- [x] Cover scalar and structured keys, small and large state/payloads, one hot
      scope, and independently sharded scopes at 1, 10, 100, 1,000, and 10,000
      operations.
- [x] Isolate scope-key canonicalization, command dispatch, read protection,
      event application, notification, Journal decisions, serialization,
      transactions, and fsyncs independently.
- [x] Prove ordinary keyed access is `O(1)` expected or `O(log N)` where ordered
      storage is required. No Resource operation may accidentally clone, sort,
      serialize, or scan unrelated aggregate state.
- [x] Compare in-memory, SQLite strict-durability, and reopen/replay boundaries
      using the same Resource law corpus.

### Program

- [x] Benchmark no-op consumers, filtered and matching delivery, command-emitting
      consumers, and 1, 8, 64, and 256 consumers.
- [x] Vary one hot partition versus independent partitions, concurrency limits,
      queue depth, payload size, and matched versus unmatched event fan-out.
- [x] Isolate enqueue, filter, partition, claim, invocation checkpoint, command,
      completion, and source-progress work independently.
- [x] Prove delivery scales with source events plus relevant declared consumers,
      and execution scales with matched work. No consumer may scan unrelated
      Resource scopes or previously completed invocations.
- [x] Prove bounded backpressure, cancellation, shutdown, Program restart,
      uncertain command outcomes, and replay from 0, 10, 100, 1,000, 10,000,
      and 100,000 source records.
- [x] Replace lifetime-promise `consume()` composition with declarative
      subscriptions owned by the Program runtime. Multiple consumers register
      sequentially without `Promise.all`; the Program return may still represent
      a background lifetime and propagates failure.

The adversarial comparison exposed a source-loss path in the superseded model:
after one environment failed at source position 1, unrelated events could
silently create a fresh generation and advance its source cursor to 3 without
replaying position 1. Failed generations now pause live delivery, retain every
declared durable consumer identity, and expose the minimum safe cursor. Only an
owner-created fresh runtime resumes from Journal replay. Direct Program and
three-environment Feature laws prove multiple declarative subscriptions,
failure propagation, stable command identities, and replay of the failed
position without duplicating successful environments.

### Dependency and testing host

- [x] Measure dependency start, lookup, call, replacement, and reverse-order
      disposal for flat and owner-scoped dependency graphs.
- [x] Verify a semantic dependency call adds no hidden serialization or global
      lookup on the local in-process path.
- [x] Run identical Resource and Program laws through the deterministic test
      host and production in-memory host. Attribute the difference to explicit
      testing guarantees; never use test-host latency as a production claim.
- [x] Measure observer notification and event inspection separately so polling,
      copied fixture history, and assertion machinery cannot contaminate runtime
      evidence.
- [x] Prove restart retains nested Feature Programs, owner-scoped dependencies,
      command identities, actor/read origin, and source progress.

### Cross-primitive scaling and failure corpus

- [x] Exercise one Resource with many Programs, many Resources with one Program,
      many independent Features, and a realistic mixed application without any
      workflow factory.
- [x] Inject failure before and after every Resource decision, Program claim,
      Program command, completion, source checkpoint, snapshot, and reopen
      boundary.
- [x] Use generated command/event schedules to compare the direct model,
      in-memory host, and SQLite host for state, emitted events, receipts,
      progress, and recovery.
- [x] Detect superlinear curves automatically from deterministic work counters
      and size ratios; wall-clock variance alone cannot pass or fail complexity.
- [x] Record hot-key serialization as an explicit semantic limit and prove
      independent keys continue progressing without global contention.

### Gate 6A

- [x] Every Application, Feature, Resource, Program, Dependency, and test-host
      cost has a reproducible isolated benchmark and an equivalent semantic
      reference.
- [x] Each measured path meets its predeclared complexity and resource budget,
      or the plan records the exact primitive, workload, dominant stack, and
      limitation.
- [x] No end-to-end factory result is used to conceal a losing primitive, and no
      synthetic primitive benchmark omits semantics required in production.
- [x] Each retained overhead maps to a named guarantee such as authorization,
      durability, ordering, idempotency, recovery, isolation, or observability.
      Avoidable overhead is removed rather than rationalized.
- [x] Each primitive receives a supported `keep`, `change`, `split`, or `remove`
      verdict covering expressiveness, ergonomics, type cost, runtime cost,
      recovery, and composition.
- [x] The verdict is rerun against the workflow and adversarial factories; a
      primitive is not declared optimal merely because an isolated microbenchmark
      is fast.

## Phase 7: Adversarial factory corpus

Each experiment starts from a respected external API or formal model, uses only
the existing core primitives, and must be realistic enough to expose lifecycle,
composition, placement, and testing problems.

### Temporal-style durable execution

- [x] Workflows, Activities, Signals, Queries, Updates, child workflows,
      cancellation scopes, continue-as-new, versioning, and time-skipping tests.

Updates now have an explicit durable request Resource. `startUpdate()` resolves
after the request is accepted, `executeUpdate()` waits for the Program-owned
handler result, duplicate identities are rejected deterministically, and a
fresh handle retrieves the completed result after Program restart. The
application-facing API contains no Resource or Program vocabulary. Cooperative
cancellation scopes are proven by a separate Temporal-style Feature because the
Inngest-compatible product API intentionally retains immediate terminal
cancellation.

The cancellation-scope audit found a precise workflow-Feature limitation, not a
kernel limitation. A separate Temporal-style factory built only from ordinary
Resource, Program, Dependency, and Feature APIs now owns an explicit scope tree,
propagates cancellation through cancellable descendants, preserves nested
non-cancellable cleanup barriers, retries failed cleanup after Program restart,
and never repeats earlier transitions. Its two focused laws pass. The generic
workflow Feature still commits `cancelled` as an immediate terminal transition,
so its current public cancellation API cannot provide Temporal's cooperative
scope semantics. No new kernel concept is justified; the remaining change, if
accepted for that product API, belongs inside the workflow Feature.

### Actor/state-machine system

- [x] Typed mailbox, actor identity, spawn/stop, supervision, timers, ask/tell,
      persistence, snapshot recovery, and deterministic test scheduling.

### Projection and indexing system

- [x] At-least-once event consumption, checkpoints, idempotent projection,
      rebuild, schema migration, full-text/vector dependency composition, and
      read-your-writes behavior.

### Authentication and authorization

- [x] Session/credential resolution, policy decisions during commands and reads,
      revocation, tenant isolation, dependency replacement, and audit history.

### CRDT and ephemeral collaboration

- [x] Durable document state, mergeable offline changes, ephemeral presence,
      reconnect, compaction, peer identity, and reactive UI consumption without
      pretending ephemeral state is an ordered Resource log. One Feature-owned
      document is mounted through the UI compiler with one native subscription;
      a remote merge updates only the bound text while parent and child component
      render counts remain unchanged, and disposal releases the subscription once.

### Multi-environment agent orchestration

- [x] Typed peers and capabilities, browser/server/service-worker placement,
      dynamic task assignment, failure recovery, idempotent handoff, direct
      communication as a replaceable Dependency, and single-node simulation of
      partitions and unavailable peers.

The actor factory no longer asks application callers to manufacture mailbox
identities: Resource command identity becomes the stable message identity.
`ask`, `tell`, `after`, and `stop` are domain methods; a replaceable semantic
clock receives the Program abort signal, so a stopped generation cannot emit a
late timer. A virtual-clock test covers reverse scheduling, supervised handler
failure, ask/reply, stop, and restart without wall-clock sleeps.

`ask` and Temporal Update results exposed the same missing lifecycle invariant:
a Feature API could read current Resource state but could not await a later
state without polling or leaking a Program consumer. Resource handles now
expose the Resource runtime's existing exact-scope subscription consistently in
Programs and the deterministic test host. The subscription owns no durable
cursor and adds no RPC semantics; it emits the current view synchronously,
notifies only its canonical Resource scope, and is disposed explicitly or with
the Program generation. Production Program, test-host, Temporal Update, and
actor-reply laws pass through this one primitive.

Projection rebuild now clears the disposable index and derives a new version
from an independently maintained authoritative catalog through replaceable
tokenization and embedding capabilities. It no longer claims to rebuild while
reading the same projection it is replacing. Text and nearest-vector queries,
dependency replacement, read-your-writes, versioned rebuild, idempotent
at-least-once delivery, checkpoints, and restart share one Feature contract.

Authentication is exercised entirely through the typed Feature test surface;
the previous cast into `app.def` is gone. Default and replaced resolvers,
owner-only reads and commands, revocation, exactly-once audit projection,
tenant isolation, and restart all share the same Feature contract.

The document factory keeps LWW-register state in a device Resource and puts
ephemeral peer cursors behind a replaceable `publish`/`current`/`subscribe`
capability. Generated delivery permutations prove convergence and duplicate
idempotence, 1,000 updates compact to one field, presence survives a Program
restart only because the same process capability remains mounted, and a fresh
capability is empty. The same contract now mounts in a native component: a
remote document update changes one fine-grained text binding without rerendering
either component, and the sole resource subscription is disposed exactly once.
This makes both the durability and UI-reactivity boundaries explicit.

The multi-environment factory now assigns each task to exactly one typed
environment. A failed replaceable browser capability is handed to the server,
stale replay is fenced by current Resource ownership, the server completes once
after restart, and a separate service-worker task routes independently. This
single-node failure simulation exercises the same capability boundary that a
direct peer transport can implement without kernel knowledge.

### Gate 7

For every factory:

- [x] The product API is idiomatic for its domain.
- [x] Two instances, nesting, cross-Feature API use, environment placement, and
      dependency replacement work.
- [x] No experiment adds capability-specific behavior to the kernel.
- [x] A deterministic test host can observe and control every semantic boundary
      exercised by the current actor, projection, authorization, document, and
      multi-environment factories.
- [x] Typecheck cost grows linearly enough for realistic application size.
- [x] Packed consumer declarations expose meaning and hide implementation.

The first compact adversarial suite proves five materially different
Feature-owned models without application plumbing or capability-specific
kernel branches:

- two independently injected actor factories process 100 and 25 concurrent
  mailbox messages with per-actor ordering, stop semantics, and replaceable
  behavior;
- an idempotent projection survives Program restart behind a replaceable text
  contract;
- authorization is colocated with session Resource state and rejects a
  different tenant at the generic Resource boundary;
- 100 generated offline register traces converge in forward and reverse order;
  the property test found and corrected an incomplete equal-clock tie-breaker
  in the experiment itself;
- one semantic worker Program runs in browser and server environments with
  independent dependencies and remains exact-once after restart.

This is positive evidence for composition, not universal proof. Supervision,
projection rebuild/migration, credential resolution, ephemeral presence, and
failed cross-environment handoff and actual CRDT UI mounting now pass. Temporal
Updates pass accepted/completed/result-recovery semantics, and the separate
cancellation-scope factory proves cooperative propagation and cleanup barriers.

The final composition matrix adds one parent Feature that mounts Temporal,
cancellation, actor, projection, document, and worker factories beneath a deep
namespace and coordinates all six solely through their semantic APIs. One
scenario crosses nested server, browser, and service-worker dependency groups,
survives restart, and preserves exact isolated Resource ownership. A direct
nested projection fixture also proves dependency replacement at a child path.
Together with the root instances, every non-singleton factory now has at least
two mounts. Authentication is intentionally application-singleton: it is nested
behind a semantic `security` parent API, its resolver remains replaceable at the
child path, and a dedicated law rejects two authentication owners with both
paths in the diagnostic.

The published-package gate builds and packs the actual tarball, installs it in
an empty consumer, and authors a generic-first Resource/API Feature using only
`@poggers/kit`. The same definition is mounted twice, composed through a root
semantic API, typechecked from emitted declarations, and executed through
`@poggers/kit/testing`; no private package import or generated declaration is
required. It then scaffolds, formats, checks, and builds a fresh application.

## Phase 8: Primitive sufficiency review

For every workaround or proposed primitive change, record:

1. the experiment that exposed it;
2. the invariant that cannot currently be expressed;
3. repeated unsafe boilerplate required without it;
4. the smallest semantic primitive that solves at least two independent cases;
5. why a Feature-owned abstraction or Dependency is insufficient;
6. type, runtime, testing, and portability cost;
7. what existing primitive becomes redundant and is removed.

- [x] Remove overlapping or experiment-only core concepts.
- [x] Keep external capabilities behind consumer-owned semantic contracts.
- [x] Verify that the dependency-free manifest carries all currently portable product
      meaning and none of the TypeScript implementation machinery.
- [x] Re-run every prior factory after each accepted primitive change.

### Primitive verdicts

| Primitive   | Verdict | Distinct invariant                                                                   | Independent evidence                                                    | Explicit limit                                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Application | keep    | One root contract combines host metadata, root Resources, Features, UI, and API.     | Maintained apps, packed consumer, workflow and adversarial apps         | It is not a portable executable program; only its extracted manifest is portable.                     |
| Feature     | keep    | One namespaced vertical composition unit owns semantic API and implementation.       | Workflow, actor, projection, security, document, worker, nested suite   | Authentication is intentionally singleton even though ordinary Features are repeatable.               |
| Resource    | keep    | Keyed authoritative decisions, authorization, ordering, idempotency, and views.      | Every factory plus generated Journal/Resource laws                      | A hot key serializes by design; CRDT merge policy belongs to a Feature, not the Resource kernel.      |
| Program     | keep    | At-least-once reaction to committed events with durable progress and uncertainty.    | Workflow, actor, projection, audit, cancellation, worker                | External effects require idempotency, reconciliation, or compensation; cluster ownership is unproven. |
| Dependency  | keep    | Named semantic capability with owner scope, lifecycle, and test replacement.         | Activities, clock, behavior, text/vector, auth resolver, presence, peer | It provides no transport semantics; remote routing is an implementation of a semantic dependency.     |
| Test host   | keep    | Deterministic control of semantic dependencies, time, restart, and command outcomes. | Workflow fault corpus and all adversarial factories                     | It is evidence for semantics, never a production latency boundary.                                    |

Application is deliberately the root specialization of Feature, not a second
vertical-slice mechanism: host metadata, top-level navigation, and platform
bootstrap are valid root-only responsibilities. A port is a TypeScript semantic
contract and a Dependency is one named use of it; there is no separate port
runtime. An adapter is ordinary implementation code supplied to that
Dependency. Workflow scheduler, admission, actor mailbox, projection, CRDT,
presence, and authentication behavior all remained Feature-owned, so none
became a kernel branch.

The only accepted primitive addition during the adversarial work was exact
Resource-scope subscription. Temporal Update handles and actor `ask` both
required awaiting a future view without polling or creating a durable Program;
the existing runtime subscription was therefore exposed consistently to
Programs and the test host with explicit disposal. Program-command interruption
is test-host control, not a production primitive; it found the infrastructure
error-ownership defect and now covers every workflow commit category.

The removal audit deleted `FeatureInstance`, which duplicated `FeatureDef`,
three unused testing aliases, and the public `FunctionsDefinition` and
`FunctionsRuntime` aliases that merely renamed existing Feature shapes. The
compiler-only `createFunctionsRuntime` value remains because browser projection
uses it directly; it does not introduce another application authoring path.

The canonical manifest law extracts Resources and their wire/persistence
schemas, nested Feature topology, Programs, dependency member names,
Components, navigation, endpoints, APIs, Presets, tokens, themes, and
conditions without evaluating imported code. Reordering declarations produces
byte-identical JSON and changing a wire schema changes the contract hash.
Executable reducers, command bodies, Programs, and dependency method signatures
are not yet a complete cross-language ABI; this is an explicit portability
limit rather than hidden TypeScript machinery in the manifest.

### Gate 8

- [x] Each retained primitive has at least two independent consumers or is a
      necessary substrate boundary.
- [x] No two primitives represent the same semantic operation.
- [x] The architecture document and package layout match the proven model.
- [x] Known limitations are explicit and reproducible.

## Phase 9: Final verification and cleanup

- [x] Run focused type, semantic, model, recovery, adapter, and package tests.
- [x] Run the complete single-node comparative evidence suite.
- [x] Run `bun install --frozen-lockfile`, `bun run check`, and `bun run build`.
- [x] Inspect the packed package and generated application from a clean temporary
      consumer.
- [x] Remove temporary fixtures, obsolete factories, duplicate tests, stale
      documentation, generated files, and unused dependencies.
- [x] Review every public export and private package path.
- [x] Update `docs/architecture.md` only with conclusions supported by completed
      gates.

Final repository verification on 2026-07-15 produced 597 passing kit tests with
323,568 assertions, four passing workflow-application tests, three passing chat
tests, and no failures. TypeScript, OxLint, OxFmt, all five package builds,
frozen installation, declaration emission, and `git diff --check` pass. The
published-package test packs the real tarball, installs it into an empty
consumer, typechecks and executes a twice-mounted generic-first Feature through
public declarations, then scaffolds, checks, and builds a fresh application.

The workflow evidence command now isolates every heavy phase in its own Bun
process and merges the records. This was required because the former monolithic
process retained allocator pressure after the 1,000-run concurrency matrix and
could delay later compiler phases for minutes. A bounded `all --quick` run
contains one environment record and every expected evidence kind. Full final
records are retained in `/tmp/poggers-types-final-2.json`,
`/tmp/poggers-test-engine-final.json`, and
`/tmp/poggers-inngest-server-final.json`; the production runtime, recovery,
concurrency, payload, behavior, crash, and admission phases completed before
the orchestration defect was isolated and were rerun independently during the
gate.

The public export review retains only the root product contract and reviewed
workflow factory, explicit `ui`, `preset`, `testing`, host/compiler, JSX, and
TypeScript-config boundaries. No application or external package imports a
physical `src`, `dist`, or package-private `#...` path. The removed aliases had
no consumers; retained dependencies each map to production compilation/runtime
or an owner-local property/boundary test.

## Final acceptance gate

The goal is complete only when:

- [x] the Inngest-compatible factory has complete documented semantic parity;
- [x] primary single-node workloads are faster with at least equivalent
      durability, or the unavailable comparison boundary is stated explicitly;
- [x] healthy and recovered execution meet their complexity budgets;
- [x] isolated primitive evidence passes Gate 6A and accounts for the marginal
      cost of Application, Feature, Resource, Program, Dependency, and the
      testing host;
- [x] all adversarial factories pass composition and testability gates;
- [x] no unresolved workaround indicates a missing or overlapping core
      primitive;
- [x] all maintained applications, package boundaries, and checks pass;
- [x] the final report separates proven guarantees, measured characteristics,
      adapter-specific behavior, and known limitations;
- [x] an independent code review can reproduce every material claim.

If a gate fails, the result is still useful: document the smallest demonstrated
limitation, adjust the primitive only when justified, and rerun every affected
gate. Confidence comes from surviving falsification attempts, not from the
number of implemented examples.
