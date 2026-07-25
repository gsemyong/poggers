# Workflow And Presentation Product Languages

Status: staged and frozen

## Staging Notice

Workflow/Temporal parity and Presentation completion are preserved here for a
future goal. Their research, ledgers, implementation, tests, documentation, and
unfinished checklists remain authoritative historical work, but neither
programme is active now.

The sole active programme is
[`virtual-actors-plan.md`](./virtual-actors-plan.md). While it is active:

- do not continue Temporal parity or add Workflow capabilities;
- do not migrate Workflow onto Actors or use that as Actor acceptance evidence;
- do not rewrite or expand Presentation;
- run Workflow or Presentation checks only when shared compiler/runtime changes
  could regress them;
- preserve every unchecked item below as staged rather than silently treating it
  as complete.

This remains the frozen source of truth for the work completed and still
required in those programmes. Checkboxes record verified evidence, not
intention. Update it only to preserve or correct historical evidence until a
future goal explicitly resumes the work; unchecked milestones remain
unfinished.

The detailed standards inventory and web capability sequencing live in
[`presentation-plan.md`](./presentation-plan.md). This programme owns the shared
architecture, dependency order, Workflow parity ledger, cross-runtime evidence,
and final completion criteria.

### Preserved Scope Correction

The Presentation workstream means completion and conformance of the substantial
system already in the repository. It does not authorize a new Presentation
language or a replacement IR. CSS and web standards are evidence sources for
finding relevant outcome gaps; they are neither the public vocabulary nor a
property-by-property implementation backlog. Existing public semantics,
representations, examples, and working behavior stay in place unless a focused
limitation fixture proves that targeted hardening is necessary.

This correction changes no Workflow or universal TypeScript-to-Rust objective.

## North Star

Kit must let product authors describe durable behavior and visual experience in
one semantic, type-safe TypeScript language per domain:

```text
semantic TypeScript
        |
        v
semantic representation
  canonical and versioned at persistent compatibility boundaries
        |
        +--> JavaScript development realization
        `--> production adapter realization
```

Workflow authors write ordinary deterministic procedural TypeScript. Every
external effect crosses a typed Dependency. The Workflow Feature defines the
portable authoring contract and durable meaning; the generic compiler lowers
that code, and reusable target infrastructure realizes the durable execution.

Presentation authors already use an immutable mapping from typed Component
meaning and platform observations to one platform-owned declaration language.
That working system is the foundation. The programme audits, completes, and
hardens it while preserving its single public API and containment-first
responsive model.

Generic core remains limited to Systems, Features, Programs, Environments,
Dependencies, UI structure, and typed portable meaning. Temporal terminology,
CSS vocabulary, DOM objects, Rust implementation details, persistence policy,
and browser lifecycle do not enter generic core.

## Completion Definition

The programme is complete only when all of the following are true:

- [ ] One public Workflow language covers the supported Temporal capability
      ledger without a second facade or hidden escape hatch.
- [ ] The existing public web Presentation language covers every relevant
      classified outcome without raw CSS or competing spellings.
- [ ] Workflow source and every Presentation representation that crosses a
      compatibility boundary have canonical, validated meaning with precise
      source diagnostics.
- [ ] Development and production consume the same semantic IR and pass the same
      conformance fixtures.
- [ ] Application and reusable Feature code require no handwritten Rust.
- [ ] No Feature or Feature factory owns a TypeScript-to-Rust translator,
      compiler plugin, generated-code backend, or handwritten production
      implementation of its product logic.
- [ ] JavaScript and generated Rust Workflow executions produce equivalent
      histories, state, results, failures, and effect counts.
- [ ] Optimized web artifacts remain equivalent to canonical Presentation
      meaning and meet explicit runtime and output-size budgets.
- [ ] Public examples use only the intended API and demonstrate composition
      through typed Dependencies and state-driven UI.
- [ ] Compatibility and migration policy covers persisted histories,
      generated artifacts, public API changes, and IR versions.
- [ ] Documentation makes implemented guarantees and explicit limits
      impossible to confuse with future intent.

## Non-Goals

- Literal source compatibility with Temporal or Inngest.
- Multiple Workflow facades over one engine.
- Dynamically loading executable Workflow definitions at runtime.
- Hiding distributed guarantees behind an unqualified "exactly once" claim.
- Raw CSS, arbitrary property bags, utility classes, or an alternate advanced
  Presentation API.
- Encoding CSS or browser policy in generic compiler IR.
- Handwriting Rust for each application, Feature, or Workflow.
- Adding Feature-specific compiler extensions or native code generators.
- Replacing the working Presentation system merely to obtain a theoretically
  cleaner IR.
- Recreating CSS property by property or exposing standards vocabulary as the
  public product language.
- Benchmarking an in-process call against a networked durable system and
  presenting the result as a meaningful comparison.
- Deployment orchestration, hosted control planes, billing, or administrative
  UI beyond the operational APIs needed to prove runtime behavior.

## Shared Architecture

### Universal Translation Invariant

There is one generic portable TypeScript compiler. It translates every System,
Feature factory, Feature instance, Program, callback, closure, data type, and
portable helper through the same TypeScript subset and language-neutral IR.
Adding a Feature must never require adding a compiler case for that Feature or
writing its behavior again in Rust.

Feature factories are ordinary portable TypeScript libraries. They may build a
typed declarative value consumed by a Dependency or runtime engine, but that
value and the code which builds it are lowered by the generic compiler. A
library-level schema such as a Workflow definition is data inside generic IR,
not a new source language or a feature-owned compiler extension.

Reusability does not make a Feature factory a target boundary. The factory,
the Programs it constructs, and every application-specific specialization of
it remain portable product source. They may not acquire a private translator,
generated Rust template, or handwritten native implementation as the Feature
grows.

This applies to procedural behavior as well as declarative metadata. A
Workflow callback, Feature helper, application branch, loop, closure, and data
transformation must all be translated by the generic TypeScript frontend and
generic target backend. A Feature cannot emit Rust, select Rust templates, or
ship a handwritten native equivalent of its portable behavior.

The generic compiler owns reusable mechanisms needed by all Features:

- extracting literal and structural meaning from generic type arguments before
  erasure;
- validating and lowering the supported TypeScript subset;
- preserving typed functions, closures, control flow, and immutable values;
- producing JavaScript development code and target-neutral production IR;
- generating typed target code through generic backends.

If a Feature reveals a missing language construct, the portable subset and
generic backend are extended once. The fix must be demonstrated with a
feature-neutral compiler fixture as well as the motivating Feature.

Only a clear target boundary may have a native implementation:

- a portable Dependency implementation may itself be authored once in
  TypeScript and compiled to JavaScript and Rust;
- a host or Platform Dependency may pair a development implementation with a
  native production implementation behind one contract;
- a native-only implementation may be exposed to development through a stable
  bridge or sidecar when that preserves the fast TypeScript edit loop;
- runtime engines such as durable scheduling, storage, browser realization, or
  operating-system integration may be target-native infrastructure written
  once, never per application or Feature instance.

Paired implementations run the same contract and conformance suite. Business
logic may not be duplicated across the development and production sides of a
boundary.

The distinction is:

```text
portable Feature and application source
  -> generic TypeScript frontend
  -> target-neutral typed IR
  -> generic JavaScript or native backend

generic runtime protocol
  -> reusable development/native runtime implementation

host Dependency contract
  -> portable implementation compiled generically, or
  -> explicitly paired development/native provider
```

The first path is mandatory for authored product behavior. The latter two are
reusable execution boundaries; they may not encode a particular Feature
instance, Workflow definition, or application decision.

Concrete litmus test: a reusable Rust engine that executes the versioned
Workflow protocol for every Workflow definition is allowed. A Rust
implementation, generator, template, or compiler branch for a particular
Workflow, Feature factory, or application is forbidden. Changing portable
product behavior must change generated production behavior through the generic
compiler alone.

### Translation Enforcement Gate

The architecture is invalid if adding or changing a Feature requires any of
the following:

- a Feature-name check or Feature import in the compiler;
- a Feature-owned TypeScript-to-Rust lowering pass;
- handwritten Rust corresponding to a Feature factory, application Program,
  callback, branch, or data transformation;
- different business-logic fixtures for JavaScript and Rust;
- runtime metadata that repeats meaning already available from portable source
  or resolved generic types.

Every compiler extension must instead:

1. describe a generally useful construct in the portable TypeScript subset;
2. lower it into target-neutral IR without knowing which Feature motivated it;
3. prove it with a Feature-neutral compiler fixture;
4. run the same semantic fixture through JavaScript and generated Rust; and
5. produce an exact source diagnostic when the construct cannot be translated.

Repository checks must enforce that `src/compiler` does not import
`src/features`, Feature directories contain no target code generator, and
generated Rust is reproducible solely from portable source, resolved types, and
target configuration.

### Ownership

```text
src/core
  generic composition and contracts

src/compiler
  generic TypeScript frontend, portable IR, and generic target backends

src/features/workflow
  portable Workflow factory, definition schema, and contract fixtures

src/platforms/web
  public web structure and Presentation language, canonical web IR

src/adapters/server
  JavaScript development and native production realization

src/adapters/web
  web compilation, artifacts, development, production, and browser runtime
```

Files may remain coarser than this conceptual sketch. Split only where ownership,
lifecycle, distribution, or focused test construction requires it.

### Compiler Boundary

The TypeScript frontend must extract:

- semantic names and literal type information before generic erasure;
- portable input, output, state, message, Dependency, and parameter schemas;
- portable procedural code and closures;
- typed declarative values built by portable Feature factories;
- Presentation-specific typed references and declarations through a compiler
  Platform adapter boundary.

The generic IR does not know Workflow, Data, Entity, authentication, or any
other Feature vocabulary. Platform adapter extensions may interpret
target-specific declarations such as web Presentation because that is the
explicit target boundary; Feature extensions may not add private translation
paths.

### Adapter Boundary

An adapter owns:

- semantic lowering from canonical IR into a target plan;
- development realization and replacement;
- production artifact generation;
- native resources, scheduling, observation, and disposal;
- compatibility checks and diagnostics for its target;
- inspection evidence sufficient to compare the realization with source
  meaning.

An adapter cannot change product semantics to reach a faster implementation.

## Workstream A: Durable Workflow

### Target Authoring Surface

Milestone W0 uses this surface as its type-level target. Later implementation
may simplify vocabulary only when the complete capability ledger still has one
clear expression; it may not add a parallel facade.

```ts
type Fulfillment = Workflow<{
  Name: "fulfillment";
  Input: { orderId: string };
  Result: { shipmentId: string };
  State: { phase: "pending" | "shipped" };
  Dependencies: { shipping: Shipping };
  Signals: { expedite(input: {}): void };
  Updates: { changeAddress(input: Address): Address };
  Queries: { status(input: {}): Status };
  Failures: { unavailable: { retryAt: number } };
  Memo: { customer: string };
  Search: { order: string; phase: "pending" | "shipped" };
}>;

export const fulfillment = createWorkflow<Fulfillment>({
  state: ({ input }) => ({ phase: "pending" }),
  activities: {
    shipping: {
      ship: {
        timeout: { attempt: 30_000, total: 300_000 },
        retry: { attempts: 5, delay: 1_000, factor: 2 },
      },
    },
  },
  async execute({ input, state, dependencies, sleep, fail, search }) {
    const shipment = await dependencies.shipping.ship({ orderId: input.orderId });
    if (!shipment) fail({ type: "unavailable", data: { retryAt: 1_000 } });
    state.phase = "shipped";
    search.update({ attributes: { phase: "shipped" } });
    return shipment;
  },
  signals: { expedite({ state, input }) {} },
  updates: {
    changeAddress({ state, input }) {
      return input;
    },
  },
  queries: { status: ({ state }) => state.phase },
});
```

Required conventions:

- `Name` is authored once and remains a stable durable identity. The compiler
  materializes it before generic erasure; variable names never become storage
  identity.
- Every public callback receives one object argument.
- `state` receives Workflow input.
- One `createWorkflow` call defines one static Workflow type.
- Empty `Dependencies`, `Signals`, `Updates`, `Queries`, `Failures`, `Memo`, and
  `Search` sections are omitted rather than authored as `{}`.
- Instances, messages, and schedules are dynamic data; executable definitions
  remain statically known and natively compilable.
- External side effects remain Dependencies. Inside a Workflow, awaited
  asynchronous Dependency operations receive durable Activity semantics.
- `activities` is a typed policy map over those Dependency operations, not a
  second invocation API. Product code still invokes
  `dependencies.shipping.ship(...)` directly.
- A different timeout, retry, cancellation, or placement guarantee is a
  differently named Dependency binding. This keeps each call site
  self-describing and avoids dynamic execution-policy plumbing.
- The adapter may optimize an Activity locally or eagerly only when it preserves
  the declared durable semantics. "Local Activity" and task-queue routing are
  realization choices, not a second product language.
- Every Activity invocation receives a stable operation identity at the
  implementation boundary. The authority remains at-least-once unless the
  selected Dependency realization deduplicates that identity.
- Native `Promise.all`, `Promise.race`, and `Promise.allSettled` are the
  procedural concurrency language; Workflow lowering supplies deterministic
  durable semantics rather than exposing parallel helper functions.
- The Feature provides one typed Workflow Dependency to all other Programs.
- Handles may exist as local derived convenience only if they do not create a
  second cross-Program protocol. The portable Dependency operations are the
  authority.
- `WorkflowDependency<Model>` is the sole public interaction type. A parent
  lists another `WorkflowDependency` in its own `Dependencies` and calls it
  normally; its semantic type marker lets the Workflow runtime classify that
  call as a child command rather than an Activity without adding a
  Feature-specific compiler branch.

The provided Dependency must eventually cover:

```text
start, describe, history, result, watch, cancel, terminate, reset, retry
signal.*, update.*, query.*
schedule.create/describe/list/update/pause/resume/trigger/backfill/delete
list, count, and explicit bulk operations
```

The cross-Feature API passes plain execution references rather than opaque
JavaScript handles:

```ts
const execution = await dependencies.fulfillment.start({
  id: order.id,
  input: { orderId: order.id },
  policy: {
    conflict: "fail",
    reuse: "allow-failed",
    timeout: { run: 86_400_000, execution: 604_800_000 },
  },
});
// execution is { id: string; run: string }

await dependencies.fulfillment.signal.expedite({
  execution,
  input: {},
});

const status = await dependencies.fulfillment.query.status({
  execution: { id: order.id },
  input: {},
  consistency: "eventual",
});

const result = await dependencies.fulfillment.result({
  execution,
  follow: "chain",
});
```

`{ id, run }` selects one exact run. `{ id }` selects the current run in the
chain. Every operation states which selectors it accepts; silently switching
runs is forbidden. A local convenience handle may close over the same plain
reference, but it cannot become a second protocol.

Signals are durable asynchronous notifications without a result. Updates are
durable state-changing requests with validation and a typed result. Queries are
read-only observations with explicit consistency and availability guarantees.
Those three meanings remain distinct even if an adapter uses one transport.

### Deterministic Execution Context

The implementation context contains semantic operations, not adapter objects:

```ts
async execute({
  input,
  state,
  dependencies,
  execution,
  time,
  random,
  identifiers,
  sleep,
  wait,
  cancellation,
  fail,
  continue: continueExecution,
  version,
  search,
}) {
  const branch = cancellation.start({
    propagation: "inherit",
    timeout: 30_000,
    async execute({ cancellation }) {
      return dependencies.shipping.ship({ orderId: input.orderId });
    },
  });

  await wait({
    condition: () => state.phase !== "pending",
    timeout: 60_000,
  });

  if (cancellation.requested()) branch.cancel({ reason: "workflow cancelled" });
  const shipment = await branch.result();

  if (version({ change: "shipment-v2", status: "active" })) {
    search.update({ attributes: { phase: "shipped" } });
  }

  if (execution.history.continueSuggested) {
    continueExecution({ input });
  }

  return shipment;
}
```

The exact context vocabulary is:

| Meaning                            | Canonical operation                                      |
| ---------------------------------- | -------------------------------------------------------- |
| deterministic current time         | `time.now()`                                             |
| deterministic pseudo-random number | `random.number()`                                        |
| deterministic identifier           | `identifiers.create()`                                   |
| relative timer                     | `sleep({ duration })`                                    |
| absolute timer                     | `sleep({ deadline })`                                    |
| durable condition                  | `wait({ condition, timeout? })`                          |
| root cancellation state            | `cancellation.requested()`                               |
| nested cancellation scope          | `cancellation.start({ propagation, timeout?, execute })` |
| typed terminal failure             | `fail({ type, data, message? })`                         |
| caught failure classification      | `failures.classify({ error })`                           |
| atomic Continue-As-New             | `continue({ input, memo?, search?, delay?, timeout? })`  |
| replay compatibility marker        | `version({ change, status })`                            |
| visibility mutation                | `search.update({ attributes })`                          |

`Promise.all`, `Promise.race`, and `Promise.allSettled` remain the only
concurrency combinators. Cancellation scopes return a local branch with
`cancel({ reason? })` and `result()`; it is not a serializable cross-Program
handle. Time is epoch milliseconds, so no target-specific `Date` object enters
portable IR.

An `active` version marker evaluates to false for an old history that predates
the marker and true for new or already-marked histories. Changing it to
`retired` makes the current branch unconditional and turns any retained history
that still needs the old branch into a release diagnostic. The change name is
durable identity and cannot be reused.

`execute` and asynchronous Signal/Update handlers receive the effect-capable
context. Update validators and Queries receive read-only state and execution
metadata; the compiler rejects asynchronous work, state mutation, Dependency
calls, and durable commands there. Continue-As-New is available only to the
main `execute` callback. Workflow completion waits for asynchronous handlers by
default; an explicitly typed per-handler `abandon` policy is the only opt-out.
Signal and Update handlers additionally receive stable typed message identity
and receipt time. Update validators see the same identity before acceptance.
Execution metadata includes current, first, parent, root, and previous-run
identity, attempt, start time, and history pressure.

`failures.classify` returns one discriminated union covering typed Dependency
failure data, typed child Workflow failure data, cancellation, timeout, and an
unknown fallback. Update validators reject through a typed `reject` callback,
so validation details survive transport and language boundaries without
depending on JavaScript exception classes.

### Workflow Dependency Contract

There is no separate client object and no public opaque handle. One
serializable reference selects either an exact run or the current run in a
chain:

```ts
type Execution = { id: string; run: string };
type ExecutionSelector = Execution | { id: string };
type Update = { execution: Execution; id: string };
```

The canonical operation families are:

```ts
dependencies.fulfillment.start({ id, input, policy, memo, search });
dependencies.fulfillment.describe({ execution });
dependencies.fulfillment.history({ execution, page });
dependencies.fulfillment.result({ execution, follow: "run" | "chain" });
dependencies.fulfillment.watch({ execution });
dependencies.fulfillment.cancel({ execution, reason });
dependencies.fulfillment.terminate({ execution, reason });
dependencies.fulfillment.reset({ execution, point, reason });
dependencies.fulfillment.retry({ execution, policy });

dependencies.fulfillment.signal.expedite({ execution, id, input });
dependencies.fulfillment.update.changeAddress({
  execution,
  id,
  input,
  wait: "accepted" | "completed",
});
dependencies.fulfillment.updateResult({ update });
dependencies.fulfillment.query.status({
  execution,
  input,
  consistency: "eventual" | "current",
});

dependencies.fulfillment.list({ filter, page });
dependencies.fulfillment.count({ filter });
dependencies.fulfillment.schedule.create({ id, timing, workflow, policy });
```

Signal-With-Start and Update-With-Start are not duplicate top-level methods.
The typed Signal or Update operation accepts
`execution: { start: StartInput }` when atomic create-if-absent behavior is
required. Updates always have a caller-supplied or authority-generated stable
ID; waiting for acceptance returns a plain `Update` reference, while waiting
for completion returns the typed result. `updateResult` reconnects to an
accepted Update by reference.

Visibility filtering uses one typed expression tree over built-in execution
fields and `Model["Search"]`; an adapter may optimize or reject unsupported
operators but may not accept an untyped query string as a second API.

Start defaults are `conflict: "fail"` and `reuse: "allow"`. Result-chain
selection is never implicit: every result call says `"run"` or `"chain"`.
Cancel requests cooperative cancellation; terminate closes immediately;
reset creates a new run from an identified historical point; retry creates a
new run from a terminal failure. Those operations are not aliases.

### Schedule Contract

A schedule belongs to one statically known Workflow Dependency, so its action
does not repeat the Workflow type. Its timing is one structured value:

```ts
{
  calendars?: Calendar[];
  intervals?: { every: number; offset?: number }[];
  exclude?: Calendar[];
  start?: number;
  end?: number;
  jitter?: number;
  timeZone?: string;
  daylightSaving?: {
    missing: "skip" | "next";
    repeated: "both" | "first" | "second";
  };
}
```

At least one calendar or interval is required. Calendar fields use typed
single values or `{ from, to?, step? }` ranges. Schedule policy separately
defines overlap (`skip`, `buffer-one`, `buffer-all`, `cancel-previous`,
`terminate-previous`, or `concurrent`), catch-up window, pause-on-failure, and
remaining actions. Create, update, trigger, and backfill carry stable
idempotency keys. Update replaces a versioned complete schedule declaration
rather than executing an adapter-local mutation callback.

### Testing Contract

Every defined Workflow supplies one fixture factory. It accepts the same typed
Dependency provider implementations used by a real Program and returns the
same Workflow Dependency exposed to other Features. Its only additional
controls are:

```text
time.now / time.advance / time.runUntilIdle
restart
crash at a named durable boundary and occurrence
history
replay
complete a deferred Dependency invocation
```

Tests may substitute Dependency providers but not bypass the Workflow runtime.
Virtual time advances the durable clock rather than mocking `sleep`. Crash
points cover before/after command creation and before/after durable commit.
The same history corpus must replay through JavaScript development and
generated Rust production.

### Canonical Workflow Vocabulary

The target surface has one spelling for each meaning:

| Meaning                    | Canonical expression                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| static Workflow type       | `Workflow<{ ... }>`                                                                        |
| static implementation      | `createWorkflow<Definition>({ ... })`                                                      |
| initial state              | `state({ input })`                                                                         |
| durable execution          | `execute({ input, state, dependencies, ... })`                                             |
| relative or absolute timer | `sleep({ duration })` or `sleep({ deadline })` on one union-typed operation                |
| durable condition          | `wait({ condition, timeout? })`                                                            |
| typed terminal failure     | `fail({ type, data })`                                                                     |
| typed caught failure       | `failures.classify({ error })`                                                             |
| durable Activity           | awaited asynchronous Dependency call                                                       |
| Activity policy            | `activities.<dependency>.<operation>`                                                      |
| concurrency                | native `Promise.all`, `Promise.race`, and `Promise.allSettled`                             |
| cancellation boundary      | `cancellation.start({ propagation, timeout?, execute })`                                   |
| child or external Workflow | another typed Workflow Dependency                                                          |
| Continue-As-New            | `continue({ input, memo?, search?, delay?, timeout? })`                                    |
| history compatibility      | `version({ change, status })`                                                              |
| visibility mutation        | `search.update({ attributes })`                                                            |
| asynchronous message       | `signals` definition and `api.signal.*`                                                    |
| durable request/result     | `updates` definition and `api.update.*`                                                    |
| read-only observation      | `queries` definition and `api.query.*`                                                     |
| execution lifecycle        | `start`, `describe`, `history`, `result`, `watch`, `cancel`, `terminate`, `reset`, `retry` |
| visibility                 | `list` and `count`                                                                         |
| recurring trigger          | `api.schedule.*`                                                                           |

For example, child composition is ordinary typed Dependency composition:

```ts
type Receipt = Workflow<{
  Name: "receipt";
  Input: { orderId: string; shipmentId: string };
  Result: { receiptId: string };
  State: { phase: "pending" | "issued" };
}>;

type Fulfillment = Workflow<{
  // ...
  Dependencies: {
    shipping: Shipping;
    receipt: WorkflowDependency<Receipt>;
  };
}>;

const receipt = await dependencies.receipt.start({
  id: `receipt:${input.orderId}`,
  input: { orderId: input.orderId, shipmentId: shipment.shipmentId },
  policy: {
    parent: {
      close: "request-cancel",
      cancellation: "wait",
    },
  },
});
```

All callbacks, handlers, validators, and Dependency operations receive one
object argument. Optional definition groups disappear entirely when empty; an
empty object is not a second meaningful state.

Schedule timing has one canonical structured form: calendar expressions and
fixed intervals may be combined with exclusions, boundaries, jitter, and one
IANA time zone. Cron text is accepted only by an import/migration tool that
produces this canonical form; it is not a second runtime authoring language.

Workflow and Activity task-queue names are intentionally absent from portable
product logic. Program placement and Dependency providers already express where
work can run. Adapters may realize that placement using task queues, eager local
dispatch, worker pools, or another topology while preserving the same
semantics.

### Temporal Capability Ledger

Legend: `partial` means a meaningful foundation exists but does not satisfy the
acceptance criteria. `missing` means no public semantic implementation exists.

| Domain                | Baseline | Required closure                                                                                                                                                           |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition and replay | partial  | deterministic time/random/identifiers, complete command matching, portable subset diagnostics, replay-safe error data                                                      |
| Start and lifecycle   | partial  | run identity, start delay, reuse/conflict policies, Workflow retry/timeouts, terminate, reset, result-chain semantics                                                      |
| Activities            | partial  | first-class durable Dependency invocation policy, task queues, four timeout classes, heartbeats/details, retry classification, cancellation, async completion, idempotency |
| Timers and conditions | partial  | absolute and relative timers, durable conditions, update/cancel, timer races                                                                                               |
| Durable concurrency   | partial  | Workflow restart/interleaving evidence, cancellation scopes, linked timer and Activity cancellation, failure propagation                                                   |
| Signals               | partial  | async handlers, buffering and unfinished policies, external signals, signal-with-start                                                                                     |
| Queries               | partial  | closed-run policy, consistency semantics, diagnostics, operational availability behavior                                                                                   |
| Updates               | missing  | validators, accepted/completed stages, typed result/failure, update-with-start, handler lifecycle                                                                          |
| Child Workflows       | missing  | start/execute, typed child reference, result/signal/update, cancellation type, parent-close policy                                                                         |
| Schedules             | missing  | interval/calendar/cron, time zone/DST, jitter, exclusions, overlap, catch-up/misfire, backfill and lifecycle                                                               |
| Long histories        | missing  | Continue-As-New, history limits, compaction policy, chain identity                                                                                                         |
| Versioning            | missing  | patch markers, replay compatibility, deployment versions, routing and safe retirement                                                                                      |
| Visibility            | missing  | memo, typed search attributes, upsert, list/count/filter, describe and history                                                                                             |
| Namespaces and queues | missing  | namespace identity/retention, Workflow and Activity queues, priorities, fairness and poller controls                                                                       |
| Operations            | partial  | health, backlog, rate limits, bulk controls, recovery evidence and administrative diagnostics                                                                              |
| Testing               | partial  | automatic time skipping, Activity fixtures, generated histories, bulk replay, crash/fault injection                                                                        |
| Observability         | missing  | structured logs, metrics, traces, interceptors, stable execution correlation                                                                                               |
| Horizontal scaling    | partial  | native multi-process tests, durable matching/claiming, shard ownership, repartitioning and backpressure                                                                    |
| Native production     | partial  | same-source JS/Rust execution, typed generated Rust, no duplicated semantic executor, production fault evidence                                                            |

No parity claim is allowed while any required row remains open. Intentional
differences from Temporal require a written semantic justification and an
equivalent user outcome.

### Temporal Source Baseline

The parity inventory is pinned to Temporal TypeScript SDK commit
[`112d3925`](https://github.com/temporalio/sdk-typescript/tree/112d3925fae9d9f850e83210f84207badeab64d9).
The contract review uses implementation types rather than marketing feature
lists:

| Official source                                                                                                                                                                      | Capability evidence                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [`workflow.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/workflow/src/workflow.ts)                                        | timers, Activities, children, Continue-As-New, conditions, messages, patching, search and memo mutation |
| [`interfaces.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/workflow/src/interfaces.ts)                                    | execution metadata, child policies, handler lifecycle and continuation options                          |
| [`workflow-client.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/client/src/workflow-client.ts)                            | start, result, Signal/Update-with-Start, Updates, Queries, history and lifecycle control                |
| [`workflow-options.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/common/src/workflow-options.ts)                          | reuse/conflict, retries, execution/run/task timeouts, memo, search, priority and version routing        |
| [`activity-options.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/common/src/activity-options.ts)                          | four timeout classes, retry, cancellation, eager/local and placement policy                             |
| [`schedule-types.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/client/src/schedule-types.ts)                              | calendar/interval/cron, time zone, jitter, exclusion, overlap, catch-up and backfill                    |
| [`testing-workflow-environment.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/testing/src/testing-workflow-environment.ts) | local service, time skipping, external service and replay-oriented testing                              |
| [`worker-options.ts`](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/worker/src/worker-options.ts)                              | worker placement, pollers, concurrency, rate limits, deployment versions and interception               |
| [`workflow-streams`](https://github.com/temporalio/sdk-typescript/tree/112d3925fae9d9f850e83210f84207badeab64d9/contrib/workflow-streams)                                            | experimental durable stream composition over Signals, Updates and Queries                               |

This baseline is upgraded deliberately. A later Temporal release does not
silently change the parity claim; the commit, ledger, target fixture, and
acceptance corpus move together.

### Activity Semantics Decision

Activities do not become another environment interaction mechanism.
Dependencies remain the only mechanism. Workflow lowering classifies awaited
asynchronous Dependency calls as durable Activities and attaches execution
policy without adding policy fields to business inputs.

### Dependency Provider Boundary Decision

There is one Dependency concept and one provider convention across every
Feature, Program, test host, development adapter, and production adapter:

- a Program contract declares the semantic consumer API with
  `Dependency<Definition>`;
- product code calls that API directly with one input object;
- a provider implements it with `DependencyImplementation<Api>`, whose
  operation receives one `{ input, invocation }` object;
- the Program runtime mounts each provider once and owns the consumer facade;
- a normal Program call creates a single-attempt invocation;
- a durable Workflow call supplies the durable invocation identity, attempt,
  timing, progress, and cancellation state through the same runtime call path;
- both external host providers and portable Feature-provided providers use this
  convention;
- JavaScript and native runtimes implement the same invocation protocol.

The consumer and provider projections are deliberately different views of one
contract, not two Dependency APIs. Product code never constructs invocation
metadata, and a provider never receives Workflow policy in its business input.
The runtime-facing invocation channel is generic: it cannot import Workflow
types, inspect a Feature name to select behavior, or require a
Workflow-specific proxy.

Program `Requires` and `Provides` continue to name consumer APIs. Host binding
and Program `start` results are type-projected to provider implementations.
Compiler IR records that projection and its operation schemas once. Runtimes
validate and mount the provider before any product work starts.

Raw operation records are a migration input only. They must not become a
permanent second provider spelling. Migration completes when every built-in
Dependency, Feature-provided Dependency, fixture, and adapter uses the
canonical provider envelope and the compatibility path is deleted.

The canonical declaration is one `activities` object whose shape is inferred
from `Model["Dependencies"]`. Each asynchronous operation has at most one policy
in a Workflow definition. Calls remain ordinary typed Dependency calls.

The policy vocabulary carries portable correctness meaning:

- attempt, total, queue-wait, and heartbeat time bounds;
- retry attempts, initial delay, maximum delay, backoff factor, and typed
  non-retryable failure classes;
- cancellation delivery and completion semantics;
- heartbeat expectation and durable heartbeat details;
- stable invocation identity and asynchronous completion;
- compiler-readable and Rust-lowerable values;
- no proxy factory or duplicate Activity API exposed to product code.

Dependency contracts may carry type-only failure and heartbeat schemas without
changing their callable API. Their provider implementation receives one generic
invocation context:

```ts
const shipping = {
  async ship({ input, invocation }) {
    const packedItems = (invocation.previousHeartbeat?.packedItems ?? 0) + 1;
    invocation.heartbeat({ details: { packedItems } });

    if (invocation.cancellation.requested()) {
      return invocation.defer({ id: invocation.id });
    }

    return { shipmentId: input.orderId };
  },
} satisfies DependencyImplementation<Shipping>;
```

The consumer still calls `dependencies.shipping.ship(input)`. The provider
context carries stable invocation and execution identity, attempt, scheduled
and started time, deadline, previous typed heartbeat details, cancellation,
heartbeat, and deferred-completion authority. This is a generic Dependency
provider facility, not Workflow-specific input plumbing or a Feature-owned
translator. Non-Workflow callers may realize the same contract without durable
retries or deferred completion; the generic invocation remains one attempt.

Worker placement, poller topology, eager dispatch, and a local execution
optimization belong to adapter configuration because they do not change
product meaning. Features express placement by depending on a semantically
named Dependency whose provider is placed in the intended Environment.

### Workflow IR

The Workflow factory must construct a canonical, versioned definition value
which generic TypeScript lowering carries without a Workflow-specific compiler
plugin. The definition must contain:

- stable Workflow type and schema identity;
- input, result, state, message, and failure schemas;
- initial-state function and deterministic execution entry;
- durable command identities and source spans;
- Activity, timer, condition, child, message, cancellation, and continuation
  commands;
- lifecycle, schedule, visibility, queue, and versioning policies;
- compatibility markers and IR version;
- canonical generic function identifiers rather than raw JavaScript closures;
- no JavaScript runtime objects, live Promises, or adapter resources.

### Native Architecture

Target production flow:

```text
Workflow Feature source
  -> generic portable TypeScript IR
  -> generic typed Rust generation for definitions, functions, and control flow
  -> one generic native durable executor
  -> selected native host Dependencies
```

The native executor, scheduler, journal, queueing, timers, codecs, and host
integrations are adapter infrastructure written once in Rust. Application and
Feature-specific behavior reaches Rust only through the generic backend. The
current dynamic `Value` engine may remain as a conformance reference during
migration but is not the final performance target.

### Workflow Milestones

#### W0: Contract And Ledger

- [x] Record a source-linked Temporal TypeScript capability inventory.
- [x] Freeze the single target API, callback vocabulary, failure model, and
      Activity policy model.
- [x] Specify dynamic instances/schedules versus static definitions.
- [x] Define Workflow Dependency operations and portable data guarantees.
- [x] Add type-only fixtures for the complete target surface.
- [x] Review every new concept against the single-way invariant.

Gate: no implementation expansion begins until the target examples, type
fixtures, and ledger agree.

Verified W0 baseline:

- Temporal TypeScript SDK source is pinned to one exact commit;
- the checked target fixture covers static definition, deterministic execution,
  typed Dependency providers, Activities, child Workflows, messages,
  visibility, schedules, bulk operations, and virtual-time/fault testing;
- the fixture distinguishes Activity Dependencies from Workflow Dependencies
  through type meaning rather than compiler knowledge;
- intentional differences remove duplicate Temporal facades while retaining
  their outcomes;
- the parity ledger remains `draft` because this freezes the contract, not its
  implementation.

#### W1: Generically Compiled Definition

- [x] Introduce the versioned Workflow definition as ordinary portable data,
      with no Workflow compiler extension.
- [x] Add generic type-argument materialization and use it to extract `Name`
      from the model without runtime name duplication.
- [x] Change `state` and execution callbacks to one object argument.
- [x] Rename `run` to `execute` with an explicit migration.
- [x] Give every started Workflow one compiler/runtime-owned `{ id, run }`
      execution reference and reject stale run selectors in both runtimes.
- [ ] Make development, test, and production consume the same generically
      compiled definition.
- [ ] Reject unsupported Workflow source at compilation with exact spans.
- [ ] Prove each required compiler addition with a Feature-neutral fixture.
- [ ] Prove that changing Workflow implementation logic changes generated Rust
      without changing any Workflow-specific compiler or native source.
- [ ] Prove that a second unrelated Feature uses the same procedural lowering
      path, so Workflow cannot be a privileged compiler dialect.
- [ ] Decide and document portable record ordering, then make observable
      operations such as `JSON.stringify` identical in JavaScript and generated
      Rust with a Feature-neutral conformance fixture.

Gate: no public model/implementation duplication and no Workflow-specific
translator; build, API report, type tests, generic IR goldens, development
fixture, and native build pass.

Verified foundation:

- `typeLiteral<T>()` is a generic compiler intrinsic, not Workflow vocabulary.
- `typeSchema<T>()` materializes resolved structural type meaning as ordinary
  canonical data and is proven by an unrelated schema-provider factory.
- nested generic substitutions are resolved transitively before portable type
  lowering;
- feature-neutral compiler fixtures prove specialization and rejection of an
  unresolved literal;
- Workflow `Name` is now authored only in its semantic model;
- Workflow runtime creation now carries one versioned definition with
  compiler-materialized input, result, state, Dependency, Signal, and Query
  schemas; development and native runtimes validate the same definition
  envelope;
- JavaScript behavior tests and generated native compilation exercise the
  resulting identity and single-object callback shape.

#### W2: Differential Execution Foundation

- [ ] Define one language-neutral history and command protocol.
- [x] Run the same generically compiled Workflow fixture in JavaScript and
      generated Rust.
- [x] Add architecture checks that reject compiler-to-Feature imports and
      Feature-owned target generators.
- [ ] Prove command by command that native runtime code contains no duplicated
      application or Feature-factory product logic.
- [x] Compare histories, snapshots, results, failures, and effect counts.
- [x] Add property-generated sequential traces and restart points.
- [ ] Remove duplicated business-semantic decisions from the two executors.

Gate: every implemented command has differential evidence.

Verified foundation:

- one composed System fixture compiles a Workflow provider and an unrelated
  driver Feature once, then runs that exact Program through the JavaScript
  interpreter/development runtime and the generated Rust/native runtime;
- the fixture exercises compiler-derived definition metadata, start, an
  explicitly ordered timer boundary, Signal delivery, Query evaluation, result,
  state checkpoints, and completion;
- the compiler-owned definition and first durable event now carry an explicit
  protocol version. JavaScript and native runtimes reject unsupported
  definition/protocol versions, unknown events, duplicate starts, and invalid
  revision order before replay;
- normalized durable journals are identical after removing only host clock and
  lease-owner observations;
- public Snapshot, result, and Query observations cross the same typed recorder
  Dependency and are identical in JavaScript and generated Rust; completed
  effects are asserted once in the journal and once at the host boundary;
- durable EventStore implementations now return and publish the same canonical
  data they persist, including stable record ordering and absent `void` result
  fields, so immediate execution and restart replay cannot observe different
  shapes;
- the native generic `Value` record and Rust generator preserve portable
  TypeScript insertion order. A Feature-neutral conformance fixture proves
  observable `JSON.stringify` output across JavaScript and Rust;
- repository architecture tests now reject compiler imports of Feature policy,
  Feature imports of target adapters, and Feature-owned native generators;
  proving the absence of handwritten native product decisions still requires
  command-level differential coverage;
- thirty property-generated Signal sequences with arbitrary worker restart
  points preserve committed state, contiguous revisions, one timer schedule,
  one timer completion, and one terminal result. This corpus exposed and fixed
  stale public state during replay and now orders Signal delivery around
  durable checkpoints by journal revision in both runtimes;
- the comparison exposed and fixed asynchronous materialization of otherwise
  synchronous compiled callbacks at the JavaScript runtime boundary;
- `EventStore` now has one broad host contract mounted once per Program.
  Individual Features retain typed event views behind their implementation
  boundary; a feature-neutral compiler fixture proves that unrelated event
  models compose into one linked external Dependency without weakening their
  authored internal types.

#### W3: Activities

- [x] Implement the typed Activity provider envelope.
- [ ] Implement adapter-owned task-queue placement and local/eager policy.
- [x] Implement schedule-to-start, start-to-close, schedule-to-close, and
      heartbeat timeouts.
- [x] Implement retry policy, non-retryable failures, next-delay override, and
      stable attempt metadata.
- [x] Implement heartbeat details, cancellation request delivery, durable
      deferred completion, typed external heartbeat/failure, and idempotent
      closing commands.
- [ ] Implement external cancellation acknowledgement and its completion
      policy.
- [ ] Add worker saturation, retry storm, heartbeat loss, and crash-window
      tests.

Gate: Activity conformance passes in JS, generated Rust, and a multi-process
native fixture.

Verified foundation:

- Activity invocation remains an ordinary asynchronous Dependency call; there
  is no proxy or second invocation language;
- each declared Dependency operation now has one type-inferred
  `activities.<dependency>.<operation>` policy;
- the implemented policy carries explicit attempt, total, and queue deadlines
  plus portable retry attempts, initial delay, multiplicative factor, maximum
  delay, and typed non-retryable failure names. Callback-valued delay and
  Workflow-wide retry policy have been removed;
- JavaScript and native runtimes validate the same policy constraints before
  accepting work. Focused virtual-time suites prove attempt timeout and retry,
  total-deadline capping, a durable queue timeout after restart, exponential
  backoff, capping, typed failure data, and invalid-policy rejection;
- protocol version 7 records one stable Activity identity, the scheduled
  Dependency operation and policy, every attempt start, durable heartbeat,
  failure, retry deadline, worker-loss abandonment, and terminal completion.
  Restart tests prove an unclosed dispatch consumes an attempt before retry;
- the generic Dependency contract now separates the ordinary consumer API from
  one typed provider envelope carrying runtime-owned invocation identity,
  attempt, scheduled time, start time, deadline, and typed failure
  construction. The compiler records this binding generically, and the
  JavaScript and native runtimes deliver the same stable Activity identity
  across retries without a Workflow compiler branch;
- Feature-provided and externally mounted Dependency providers now use the
  same envelope. A same-source Workflow fixture proves an unrelated semantic
  provider receives the same durable invocation identity in JavaScript and
  generated Rust;
- the same compiled conformance fixture uses this generic provider binding in
  JavaScript and the native Dependency protocol in generated Rust. Heartbeat
  details are typed per operation and survive retry; heartbeat deadlines reset
  on durable progress. Workflow cancellation reaches the same generic provider
  envelope in JavaScript and native Rust. Focused native tests also prove
  provider-envelope projection and that queued heartbeats are persisted before
  an immediately completed attempt closes. Structured typed failures now carry
  one optional next-retry delay through the same provider `fail` operation;
  both runtimes persist the resulting absolute retry deadline, and focused
  virtual-time/native tests prove it overrides declarative backoff. The same
  compiled conformance Program now drives a deliberately slow provider through
  two attempt deadlines in JavaScript and generated Rust. Both journals retain
  the same command/failure sequence and typed timeout details; the test compares
  the relative retry delay rather than adapter wall-clock timestamps.
  The same compiled conformance Program now also defers an Activity through the
  generic provider envelope, completes its typed reference twice with the same
  result, and proves equivalent JavaScript/generated-Rust history. Focused
  restart evidence proves a new worker waits on the durable deferred attempt;
  conflicting completion is rejected. Protocol 9 scopes that reference to the
  exact Workflow run, and both runtimes reject a completion carrying a stale
  run. This idempotency covers the journaled completion command, not the
  provider's external side effect. The same
  reference now accepts typed external heartbeat and failure commands.
  Heartbeats extend the durable deadline and become retry context; failure
  preserves typed data, retry classification, and its optional next-delay
  override. Same-command failure is idempotent and conflicting failure is
  rejected. The one same-source conformance executable proves these semantics
  in JavaScript and generated Rust. External cancellation acknowledgement,
  task-queue realization, and multi-process Activity fault evidence remain
  open, so W3 is not complete.

#### W4: Durable Control Flow And Messages

- [x] Implement conditions, absolute timers, and timer replacement.
- [x] Implement deterministic concurrent composition and cancellation scopes.
- [ ] Complete Signal lifecycle and external signaling.
- [ ] Add Updates, validators, result stages, and update-with-start.
- [ ] Specify Query consistency and closed-run behavior.

Gate: randomized interleavings replay identically across JS and Rust.

Progress:

- Relative and absolute timers now share one union-typed `sleep` command.
  Relative history retains the authored duration and resolved deadline;
  absolute history retains only the exact deadline. Protocol 7 validates timer
  checkpoints, unique schedules, deadlines, and single completion in both
  JavaScript and native runtimes. Virtual-time restart and replay-change tests
  cover future absolute deadlines, and the same-source generated-Rust
  conformance Program exercises both timer forms.
- `wait({ condition, timeout? })` now records one pure condition checkpoint,
  schedule, and winning `satisfied` or `timed-out` outcome. The runtime rejects
  state mutation, changed timeout or replay outcome, invalid timing, duplicate
  schedule or completion, and completion without a schedule. Focused
  virtual-time tests cover restart, Signal satisfaction, timeout, and malformed
  history. The existing
  same-source conformance Program proves Signal-before-wait delivery, closure
  capture, both satisfied and timed-out outcomes, and equivalent
  JavaScript/generated-Rust history without Feature-specific lowering.
- Timer replacement does not require another public timer operation. Temporal's
  [maintained updatable-timer sample](https://github.com/temporalio/samples-typescript/blob/main/timer-examples/src/updatable-timer.ts)
  expresses it as a condition loop whose Signal mutates the desired deadline;
  its [ordinary race sample](https://github.com/temporalio/samples-typescript/blob/main/timer-examples/src/workflows.ts)
  uses `Promise.race`, and
  [cancellation scopes](https://github.com/temporalio/sdk-typescript/blob/112d3925fae9d9f850e83210f84207badeab64d9/packages/workflow/src/cancellation-scope.ts)
  own cancellation of linked timers and Activities. Kit retains the same
  irreducible meanings with fewer facades: `wait`, deterministic `time.now()`,
  native Promise combinators, and one cancellation scope. The existing target
  vocabulary already records this shape. `time.now()` now exposes durable
  activation time, fixed during synchronous Workflow execution and advanced
  only when durable external progress is consumed. The generic portable
  profile gained canonical `while` semantics once for both backends. A focused
  virtual-time fixture proves an absolute deadline can be updated by Signal and
  survive restart, while the existing single conformance executable proves the
  same condition-loop composition and logical-time result in JavaScript and
  generated Rust. Adding `replaceTimer` would therefore be redundant. Timer
  cancellation and deterministic races remain part of the next W4 item.
- The feature-neutral portable profile now represents awaited
  `Promise.all`, `Promise.race`, and `Promise.allSettled` as one canonical
  concurrent expression. Operations start in source order; ordered results
  retain that order; race losers continue; and all-settled uses standard
  fulfilled/rejected records. The TypeScript interpreter and generated Rust
  runtime pass one shared differential fixture, including a race whose first
  operation remains pending and an exact generated-artifact cache hit with
  Cargo absent. This closes the generic concurrency substrate.
- Protocol 8 now separates an idempotent cancellation request from terminal
  cancellation and records cancelled Activity, timer, and condition commands.
  `cancellation.start({ propagation, timeout?, execute })` supplies one scoped
  Workflow context, synchronous local cancellation, and one typed `result()`
  join. Timeouts are armed before branch execution; `inherit` propagates a
  parent request and `shield` permits explicit durable cleanup. The existing
  same-source conformance executable proves manual, timed, inherited, and
  shielded scopes plus Promise composition in JavaScript and generated Rust.
  The existing restart executable additionally proves a requested root
  cancellation and shielded cleanup timer survive process loss. A deterministic
  property-generated corpus now adds twelve combinations of manual
  cancellation, inherited root cancellation, timeout races, and shielded
  completion to that same executable. JavaScript and generated Rust produce
  equivalent histories after canonicalizing only scheduler-independent timer
  correlation labels. Broader injected faults remain open, so the parity domain
  stays partial.
- The Signal audit confirms that the current implementation is only a
  foundation. It durably orders typed inputs and replays reducer-style state
  transitions. Protocol 9 and the singular Workflow Dependency now carry an
  exact `{ id, run }` execution reference and reject stale selectors, but a
  sender may still wait for an active handler, handlers do not receive the full
  effect context or durable message identity, cross-Workflow sender history is
  absent, and Signal-With-Start is absent.
  Temporal acknowledges a Signal when the authority accepts it rather than when
  its handler completes, records cross-Workflow Signals at both sender and
  receiver, permits asynchronous handlers, and makes Signal-With-Start atomic
  ([TypeScript message-passing reference](https://docs.temporal.io/develop/typescript/workflows/message-passing)).
  Kit's checked target fixture already chooses one cleaner surface: the typed
  Workflow Dependency carries execution references; one `signal.<name>`
  operation accepts an existing execution or a start specification; handlers
  receive the ordinary effect context plus durable message identity; completion
  waits for handlers unless the implementation explicitly names handlers it
  may abandon. W1 execution identity is now in place; atomic start-or-signal,
  durable sender acknowledgement, message identity, and handler lifecycle are
  the next W4 slice. No temporary Signal facade or second handle API will be
  added.

#### W5: Children And Schedules

- [ ] Implement typed child start/execute and parent-close/cancellation policy.
- [ ] Implement interval, calendar, and cron-compatible schedule specifications.
- [ ] Implement time zones, DST, jitter, exclusions, overlap, catch-up, misfire,
      and idempotent firing.
- [ ] Implement pause, resume, update, trigger, backfill, describe, list, and
      delete.

Gate: deterministic calendar corpus covers DST gaps/folds and crash recovery;
child histories pass parent failure and takeover matrices.

#### W6: History And Versioning

- [ ] Implement Continue-As-New and execution chains.
- [ ] Enforce history limits and compaction/retention policy.
- [ ] Implement patch markers and history compatibility diagnostics.
- [ ] Implement deployment version routing and safe old-code retirement.
- [ ] Add representative-history replay as a release gate.

Gate: old histories remain replayable or fail release validation before
deployment.

#### W7: Visibility, Operations, And Scaling

- [ ] Implement typed memo and search attributes.
- [ ] Implement list, count, filter, describe, history, reset, terminate, and
      bulk operations.
- [ ] Implement namespaces, retention, queue priority/fairness, and poller
      controls.
- [ ] Add structured logs, metrics, traces, health, backlog, and rate limits.
- [ ] Prove multi-process ownership, failover, shard movement, and backpressure.

Gate: native cluster fixture survives kill, pause, partition, lease expiry, and
repartition scenarios without lost durable commands.

#### W8: Parity Closure And Performance

- [ ] Close or justify every ledger row.
- [ ] Port equivalent Temporal benchmark-worker workloads.
- [ ] Publish repeatable configuration and raw benchmark output.
- [ ] Compare only equivalent durability and persistence topologies.
- [ ] Establish regression budgets and automate them where stable.

Gate: parity report is generated from tests and manifests, not prose.

## Workstream B: Presentation Completion And Conformance

### Foundation Decision

This is not a greenfield Presentation or semantic-CSS language project. Kit
already has one substantial, working, semantic, type-safe Presentation API and
web realization. Existing public meaning and working examples are preserved
unless a concrete conformance fixture proves a fundamental limitation.

CSS and web standards are an external coverage ledger. They help find omitted
outcomes, redundancies, compatibility constraints, and optimization
opportunities. They are not the public vocabulary and do not require a
property-by-property recreation of CSS.

Changes follow this evidence order:

1. inventory an existing capability and its tests;
2. demonstrate a relevant outcome that cannot be expressed or realized
   correctly;
3. add the smallest semantic primitive or targeted internal hardening that
   closes that gap;
4. prove compatibility with existing declarations and examples;
5. remove only superseded experiments or representations.

No broad IR rewrite is justified by architectural preference alone.

### Existing Capability Audit

Status has one precise meaning:

- `complete`: the current semantic path has type, lowering, realization, and
  representative conformance evidence;
- `partial`: useful behavior works, but coverage or evidence has a named gap;
- `missing`: a relevant web UI/UX outcome has no adequate semantic path;
- `delegated`: the outcome belongs to structure, behavior, another Platform,
  or another adapter rather than web Presentation.

| Capability                                                           | Status    | Current evidence or gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed Component, child-Feature, and named-Element targeting          | complete  | [`core/ui/presentation.ts`](../src/core/ui/presentation.ts), [`presentation.typecheck.ts`](../src/core/ui/presentation.typecheck.ts), and [`contracts/platform.typecheck.ts`](../src/contracts/platform.typecheck.ts) preserve Component, Feature, Element, and Platform identity.                                                                                                                                                                                                                                                                                      |
| Typed parameters, state, props, action events, environment, Elements | complete  | [`presentation.typecheck.ts`](../src/core/ui/presentation.typecheck.ts) proves exact inputs without native handles; [`core/ui/presentation.spec.ts`](../src/core/ui/presentation.spec.ts) proves ordered action-event correlation and temporal evaluation.                                                                                                                                                                                                                                                                                                              |
| Platform independence                                                | complete  | [`contracts/platform.typecheck.ts`](../src/contracts/platform.typecheck.ts) supplies a non-web UI language with unrelated declarations and observations through the same adapter contracts.                                                                                                                                                                                                                                                                                                                                                                             |
| Deterministic cascade-free static extraction and minification        | complete  | [`presentation/compiler.spec.ts`](../src/adapters/web/ui/presentation/compiler.spec.ts) proves logical CSS emission, insertion-order independence, immutable planning, rule deduplication, and stable generated declarations.                                                                                                                                                                                                                                                                                                                                           |
| Request-rendered initial Presentation parity                         | partial   | The web build evaluates request-invariant initial Presentation once and serializes validated Element artifacts for the native Rust document renderer; [`request-render/src/system.spec.ts`](../src/adapters/web/fixtures/request-render/src/system.spec.ts) proves exact development/production HTML parity for CSS, classes, and a local image. Presentation that reads request-derived Component props is rejected during production build until a portable expression lowering is proven.                                                                            |
| Lazy, cached Element and environment observations                    | complete  | [`runtime/observations.spec.ts`](../src/adapters/web/ui/presentation/runtime/observations.spec.ts) proves read-on-demand mounting, one scheduled read, cached getters, repeated-Element rejection, and disposal.                                                                                                                                                                                                                                                                                                                                                        |
| Image substitution and passive audio feedback                        | complete  | [`platforms/web/presentation.spec.ts`](../src/platforms/web/presentation.spec.ts) proves immutable asset meaning; [`presentation/adapter.spec.ts`](../src/adapters/web/ui/presentation/adapter.spec.ts) proves target validation, restoration, normalized activation, and shared resources; pipeline and request-render fixture tests prove deterministic local-asset lowering shared by development SSR, native production SSR, and hydration.                                                                                                                         |
| Logical sizing/spacing and flow, flex, grid, subgrid, and overlays   | partial   | Current declarations and examples work; [`presentation/compiler.spec.ts`](../src/adapters/web/ui/presentation/compiler.spec.ts) covers canonical lowering, including logical line/span placement and parent-track alignment through subgrid. Reusable named areas, fragmentation, and advanced positioning remain explicit gaps.                                                                                                                                                                                                                                        |
| Container-first responsiveness                                       | partial   | Native size containers, one typed identity shared by declaration and query, container size/shape conditions, container-relative lengths, typed `all`/`any`/`not` composition, and ordered conditions are covered by [`presentation/compiler.spec.ts`](../src/adapters/web/ui/presentation/compiler.spec.ts) and both real examples. Nested presentations derive directly from typed parent and child Feature state, so native style queries remain an adapter optimization rather than a second authored condition path. Specialized display environments remain a gap. |
| Paint, color, effects, transforms, typography, media, affordances    | partial   | [`platforms/web/presentation.ts`](../src/platforms/web/presentation.ts) and compiler tests cover the current application vocabulary. Advanced typography, masks, compositing, motion paths, and 3D remain gaps.                                                                                                                                                                                                                                                                                                                                                         |
| Parameterized fonts, icons, images, audio, dynamics, and themes      | complete  | Generic Presentation parameters plus typed assets are exercised by [`playground/src/presentations/editorial.ts`](../playground/src/presentations/editorial.ts) without framework-owned token or theme concepts.                                                                                                                                                                                                                                                                                                                                                         |
| Temporal values, interruption, shared time, and reduced motion       | complete  | Compiler identities, property-generated trajectories, retarget continuity, one root scheduler, event overlap, HMR restoration, and reduced motion are covered across [`compiler/presentation.spec.ts`](../src/compiler/presentation.spec.ts) and runtime animation/execution suites.                                                                                                                                                                                                                                                                                    |
| Layout and structural-replacement continuity                         | partial   | [`runtime/layout.spec.ts`](../src/adapters/web/ui/presentation/runtime/layout.spec.ts) covers interruption, resize, scroll, replacement identity, batching, reduced motion, and teardown. Rotated ancestry and broader text/layout continuity remain explicit limits.                                                                                                                                                                                                                                                                                                   |
| Deterministic frame inspection and optimized-path equivalence        | partial   | [`presentation/adapter.spec.ts`](../src/adapters/web/ui/presentation/adapter.spec.ts) proves captured-frame replay, native-write correspondence, and canonical snapshots. The complete difficult fixture and browser-performance corpus remains open.                                                                                                                                                                                                                                                                                                                   |
| Hot replacement continuity                                           | complete  | [`presentation/adapter.spec.ts`](../src/adapters/web/ui/presentation/adapter.spec.ts) proves adapter replacement restores animation value/velocity and prevents borrowed scopes from deleting parent state.                                                                                                                                                                                                                                                                                                                                                             |
| Accessibility semantics and interaction behavior                     | delegated | Owned by Platform structure and Component behavior; Presentation may style exposed states but cannot mutate behavior. The boundary is type-enforced in [`core/ui/presentation.typecheck.ts`](../src/core/ui/presentation.typecheck.ts).                                                                                                                                                                                                                                                                                                                                 |
| Navigation, routing, data, and external effects                      | delegated | Owned by Programs and Dependencies rather than Presentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Retained GPU/WebGPU scenes and native controls                       | delegated | Require another UI-capable Platform language and adapter; they are not justification for web-style fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Print and paged media                                                | missing   | Print conditions, paged-media layout, and page presentation have no semantic path yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Meaningful generated content                                         | delegated | Text, labels, counters with product meaning, and accessibility content belong to Platform structure. Adapter-owned decoration cannot introduce a second content path.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Anchor positioning                                                   | missing   | Typed anchor relationships and fallback placement remain an explicit semantic layout gap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Scroll and view timelines                                            | partial   | Existing typed Element scroll observations and temporal values can express the outcome. Native timeline lowering, compatibility, and optimized-path equivalence remain adapter conformance work rather than justification for another authoring model.                                                                                                                                                                                                                                                                                                                  |

### Public Boundary

Presentation remains an immutable dependency on Component meaning:

```text
state + props + explicit transition meaning + named Elements
platform environment + typed observations + parameters
                         |
                         v
typed Presentation declarations
```

Presentation cannot invoke actions or mutate behavior. It may derive reactive
and temporal values from available meaning. Parameters are generic typed input;
theme, skin, design tokens, assets, audio, and dynamics are application-level
uses rather than core concepts.

Environment is provided once to the Presentation. Per-Component callbacks
receive only Component-specific props, state, transition meaning, named Element
handles, and typed observations derived by the selected Platform language.

### Completion Invariants

- preserve one semantic path per visual capability;
- logical axes and containment-first responsiveness;
- typed structured values rather than CSS strings;
- no cascade-dependent ambiguity in generated application rules;
- no shorthand/longhand or legacy/modern authored duplication;
- assets, fonts, icons, images, and audio are parameterizable;
- Presentation may declare adapter-supported decorative realization without
  changing semantic UI behavior;
- static, reactive, observed, and temporal meaning remains inspectable through
  the existing pipeline, with targeted IR hardening only where evidence
  requires it;
- compatibility, fallback, and optimization are explicit and independently
  testable.

### Presentation Completion Milestones

The detailed checklist in [`presentation-plan.md`](./presentation-plan.md) is
normative. This programme tracks its dependency order.

#### P0: Existing Capability Audit And Gap Ledger

- [x] Pin `@webref/css@8.7.0`, `web-features@3.34.1`,
      `@mdn/browser-compat-data@8.0.7`, and CSS Snapshot inputs.
- [x] Inventory the current public API, lowering, realization paths, examples,
      and tests before changing them.
- [x] Classify relevant outcomes as complete, partial, missing, or delegated.
- [x] Use standards data to detect omitted outcomes and competing spellings,
      not to dictate public names.
- [x] Generate gap, duplicate, delegation, availability, and evidence reports.

Gate: every claimed capability links to evidence, every gap has an owner, and
no existing working path is removed without a failing limitation fixture. The
compiler-derived declaration inventory accounts for every `WebStyle` leaf path,
including structured union and recursive condition alternatives; this is a
coverage check over the existing API, not a list of proposed public features.

#### P1: Targeted IR Hardening

- [x] Record the current Presentation source, compiled plan, artifact, runtime,
      inspection, and replacement representations.
- [x] Replace source-expression strings or generic declaration data only where
      a concrete correctness, compatibility, optimization, or inspection gap
      requires typed meaning; the current audit authorizes no such replacement.
- [x] Keep target-independent meaning, web-specific lowering, and browser
      realization separate.
- [x] Version and validate only compatibility boundaries that persist across
      builds or runtime replacement.
- [x] Prove unchanged existing declarations retain equivalent artifacts and
      behavior for the production local-asset hardening.

Gate: every IR change cites its limitation fixture and passes compatibility
goldens for the existing system.

#### P2: Core, Platform, And Adapter Boundary Verification

- [x] Audit core, compiler, Platform, adapter, and runtime imports.
- [x] Keep CSS, DOM, animation-engine, and browser policy out of generic layers.
- [x] Prove a non-web UI Platform with unrelated declaration and observation
      types.
- [x] Ensure Presentation cannot call Component actions.

Gate: architecture tests reject dependency inversion and target leakage.

#### P3: Closure Of Demonstrated Semantic API Gaps

- [x] Preserve and document the existing canonical paths for values, logical
      geometry, conditions, parameters, assets, and temporal values.
- [ ] Close proven responsive-composition and container-query gaps.
- [ ] Close proven layout, typography, overlays, paint/effects, assets, and
      interaction-state presentation gaps.
- [ ] Close proven presence, interruption, choreography, layout-continuity, and
      reduced-motion gaps.
- [x] Classify advanced print, generated content, anchor, timeline, and other
      standards outcomes as implemented, missing, experimental, or delegated.

Gate per domain: type tests, IR goldens, artifact tests, compatibility policy,
browser realization, existing-example compatibility, and ledger update pass.

#### P4: Browser, Visual, Compatibility, And Performance Conformance

- [x] Preserve deterministic temporal values and shared temporal coordinates.
- [ ] Verify interruption, velocity, presence, layout, and text continuity.
- [ ] Verify static CSS, compositor, native animation, measured layout, and
      frame-scheduled realization paths.
- [x] Maintain one frame scheduler for unavoidable main-thread updates.
- [ ] Compare optimized paths with deterministic reference frames.
- [ ] Prevent accidental layout animation and unbounded observation work.
- [ ] Add difficult fixtures for responsive composition, typography, overlays,
      assets, accessibility integration, motion, interruption, and continuity.

Gate: hard choreography fixtures are inspectable frame by frame and stay within
declared main-thread, layout, paint, and artifact-size budgets.

#### P5: Migration, Cleanup, And Closure

- [ ] Preserve current examples and migrate them only when one canonical
      spelling replaces a proven limitation.
- [ ] Remove superseded experiments, dead compatibility paths, and redundant
      tests after their replacement gates pass.
- [ ] Run the complete type, lowering, artifact, browser, compatibility,
      lifecycle, visual, and performance suites.
- [ ] Generate the Presentation completion and conformance report.
- [ ] Document explicit unsupported and experimental capabilities.

Gate: every completion claim is derived from implementation evidence and the
standards gap ledger, with no unintended public break or competing API.

## Shared Verification Strategy

### Source And Types

- compile-success fixtures for canonical use;
- compile-failure fixtures for invalid names, messages, state, parameters,
  declarations, policies, and cross-Platform composition;
- public API report rejects accidental exports;
- examples consume package exports rather than private source paths.

### IR

- deterministic snapshots with source spans normalized separately;
- schema round-trip and version rejection;
- semantic hashes ignore irrelevant source movement;
- property tests for equivalent syntax normalization;
- adapters reject unknown or unsupported IR instead of silently degrading.

### Runtime Conformance

- JavaScript development and production adapters consume identical semantic
  fixtures;
- restart at every durable Workflow boundary;
- replace Presentation modules at every lifecycle stage;
- detect duplicate, lost, reordered, and stale messages or frames;
- dispose all streams, timers, workers, observations, and native resources.

### End-To-End

- use the in-app browser for representative web flows rather than adding a
  browser-matrix test dependency;
- verify direct load, navigation, refresh, state preservation, styling,
  interaction, focus, accessibility, and HMR;
- run generated production executables for complete multi-Feature scenarios;
- simulate multiple server processes with a shared durable authority.

### Workflow Benchmark Matrix

Use workload shapes equivalent to Temporal's published benchmark workers:

- repeated no-op and short Activities;
- signal wait and delivery;
- nested/repeated child Workflows;
- durable timer storms;
- input/result/history payload growth;
- mixed queries, signals, Updates, retries, heartbeats, and cancellation;
- schedules across time-zone and DST boundaries.

Run each relevant workload as:

1. executor-only, no persistence;
2. single-node durable with explicit sync policy;
3. multi-replica with shared durable authority;
4. Temporal under equivalent hardware, payload, durability, and persistence
   assumptions.

Record throughput, p50/p95/p99 latency, timer lateness, replay events/second,
recovery time, CPU, allocation, memory per open execution, history bytes,
database I/O, binary size, cold build, and incremental build.

### Presentation Performance Matrix

Record generated CSS/JS bytes, rule count, variable count, observation count,
style/layout/paint work, long tasks, dropped frames, input latency, mount,
replacement, and disposal cost. Enforce fixture-specific budgets rather than
one misleading global score.

### Verification Efficiency

Validation is a ladder, not a reason for every edit to run a release build:

| Scope                  | Command                                                                              | Intended use                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Focused TypeScript     | `nub exec vitest run <file> -t "<test>" --tagsFilter="!native && !production"`       | One changed behavior while editing                                                             |
| Root types             | `nub run typecheck`                                                                  | Shared source and type-level contracts; no package build                                       |
| Source milestone       | `nub run test`                                                                       | All TypeScript/development behavior; never compiles or executes a generated native Program     |
| Workflow source        | `nub run test:workflow`                                                              | Complete Workflow behavior in the TypeScript reference runtime; never invokes Cargo            |
| Focused native check   | `cargo check --manifest-path src/adapters/server/production/Cargo.toml -p <package>` | One changed Rust Dependency package without an executable                                      |
| Focused native test    | `cargo test --manifest-path src/adapters/server/production/Cargo.toml -p <package>`  | One changed native Dependency package                                                          |
| Native milestone       | `nub run check:native`                                                               | Tagged generic compiler differentials, generated native behavior, and all native package tests |
| Workflow milestone     | `nub run check:workflow`                                                             | Workflow TypeScript, JS/native differential fixtures, and native Workflow tests                |
| Presentation milestone | `nub run check:presentation`                                                         | Presentation ledger and focused semantic/compiler/web realization suites                       |
| Production milestone   | `nub run check:production`                                                           | Tagged deployable System realizations and a focused generated release executable               |
| Complete repository    | `nub run check`                                                                      | Source, native, package, examples, API, Presentation, distribution, and production realization |
| Production release     | `nub run release:check`                                                              | Complete gate plus packed-package scaffold and production artifact verification                |

Conditional gates remain explicit:

- Portable Feature behavior is authored and exhausted against the TypeScript
  reference runtime. It does not trigger generic Rust generation while editing.
  A portable-language, IR, JavaScript interpreter, or Rust lowering change owns
  the focused cross-backend differential gate because it can invalidate the
  translation theorem. A Feature-only semantic change does not.
- Handwritten Rust is owned by native server Dependency implementations.
  Changing one runs that package's Cargo check and tests, not every generated
  Program. Browser Dependencies remain TypeScript-owned by the Web adapter.
- `check:workflow` is deliberately a cross-backend Workflow milestone, not the
  ordinary Workflow edit loop. Use `test:workflow` until a coherent Workflow
  capability is complete, then run the native differential and Dependency
  evidence once.
- Run `nub run api:check` or update the API record only when public API meaning
  changes; the complete gate always verifies the recorded surface.
- Run `nub run check:examples` after the one package build when public types or
  examples change. External examples intentionally consume built package
  sources because their application-owned `@/` alias cannot also mean the
  package's private source alias.
- Run `nub run check:presentation` and the in-app browser flow only for Web or
  Presentation changes. The browser gate remains representative end-to-end
  evidence rather than a redundant browser matrix.
- IR and lowering tests stop at IR or generated source. Ordinary native
  behavioral conformance uses debug executables. Release compilation is
  reserved for `check:production`, performance work, the complete gate, and
  `release:check`.
- Vitest's `native` tag identifies tests that compile or execute generated
  native Programs. The `production` tag identifies black-box deployable System
  realizations. Tags preserve co-located fixtures without allowing either cost
  to leak into `nub run test`. The complete gate runs the full tagged Vitest
  corpus once rather than composing the filtered commands and collecting files
  repeatedly.

Generated native Programs use a stable content-addressed artifact cache.
Source-location diagnostics are excluded from semantic identity, so moving an
identical Program does not rebuild it. Runtime databases, recorder output, and
process state remain in disposable fixture directories. Built-in native crates
are referenced from their stable adapter locations and share one Cargo target;
generated workspaces retain eight semantic projects, artifacts retain sixteen,
and evicted Programs are removed from the shared target. Exact artifact hits
rematerialize missing deterministic generated sources without invoking Cargo.
Recently returned workspaces have a five-minute eviction grace period so
parallel checks cannot remove files another check is inspecting; old entries
are removed on later retention passes, with a hard maximum of 32 workspaces
during a burst. The shared Cargo target has a 6 GiB hourly-enforced ceiling.
`sccache` is not installed and is not introduced: exact artifact hits already
bypass Cargo, while the shared target reuses common native compilation without
another setup dependency.

The generic JavaScript/Rust lowering harness uses the same cache root and Cargo
target. Its generated workspace and executable are content-addressed by
canonical executable meaning, target, and Rust toolchain; disposable source
paths do not invalidate it. It retains eight semantic fixtures, defaults to a
debug executable, and proves an exact artifact hit with Cargo absent from
`PATH`. Its release mode is explicit. Workflow retains one generated
conformance executable for all command families and one separate executable
only for the restart/persistence boundary where process isolation is itself the
behavior under test.

The pre-change warm baseline on 2026-07-24 was:

| Gate                                   |   Before | After warm |
| -------------------------------------- | -------: | ---------: |
| Root TypeScript                        |   0.81 s |     0.83 s |
| Focused Workflow heartbeat behavior    |   1.28 s |     1.16 s |
| Workflow JS/generated-Rust conformance |  32.74 s |     3.29 s |
| Native Workflow package tests          |   0.36 s |     0.16 s |
| Complete repository                    | 251.54 s |    66.90 s |

The old Workflow conformance fixture also failed once on a crates.io 503 because
its disposable workspace had no retained lock or artifact. Before cleanup, the
production cache occupied 2.5 GiB, principally copied native crates and one
Cargo target per generated Program. A cold release target took 119.38 s; a new
release Program on the warm shared target took 12.15 s; its exact artifact hit
took 2.19 s. A new debug Workflow Program on the warm target took 7.30 s, and
its exact hit took 3.29 s including fixture execution. After removing legacy
compiled state, the retained cache is 277 MiB: 276 MiB of executable artifacts,
1 MiB of generated workspaces, and no Cargo target. The same Workflow exact hit
then passed with the Cargo target absent, proving that Cargo was not invoked.
The final cold production release gate took 201.47 s, including a 114.38 s
release compile, package creation, a fresh external scaffold, its tests, and its
production web build. After that cold compile the cache is 3.9 GiB, below its
enforced ceiling.

The final verification-ladder pass on the same date measured the setup
immediately before and after native/production test tagging, generic
conformance caching, and single-pass complete-gate collection:

| Gate                                   | Before warm | Final warm |
| -------------------------------------- | ----------: | ---------: |
| Root TypeScript                        |      1.15 s |     0.79 s |
| Focused Workflow heartbeat behavior    |      1.18 s |     1.05 s |
| Workflow JS/generated-Rust conformance |      3.82 s |     3.77 s |
| Native Workflow package tests          |      0.75 s |     0.22 s |
| Complete repository                    |     74.73 s |    64.79 s |

The complete repository gate passed 55 Vitest files and 487 tests, the complete
native workspace, one package build, external examples, public API,
Presentation, distribution, and focused release-native verification. The
source-only milestone passed 474 tests with 13 native or production tests
intentionally excluded and took 37.26 s. A generic generated Rust conformance
fixture took 9.71 s against an empty isolated cache and 1.39 s on its exact
artifact hit; the exact hit also passed with Cargo absent from `PATH`.

Cold native and release costs remain milestone costs rather than ordinary edit
costs. They are not inferred away: a changed generic lowering fixture still
requires its first debug Cargo build, and a changed production Program still
requires the focused release gate. Repeated identical semantic input bypasses
Cargo entirely, while temporary databases, recorder output, and execution state
remain isolated.

Backend portability is also an inner-loop frontend invariant. The generic
compiler classifies unsupported target source with an exact diagnostic; each
selected Platform compiler extension enforces whether that source is valid. The
server extension requires every server Program to lower completely before
development starts, so `kit typecheck` and `kit check` catch the issue without
Cargo. The web Platform may continue to own TypeScript source. This keeps the
language boundary explicit without teaching generic core that every target is
Rust.

## Migration And Versioning

- Every public breaking change receives a migration document and changelog
  entry.
- Workflow history and Workflow IR compatibility are versioned independently
  from the package.
- Presentation IR, Web Presentation IR, and generated artifact formats carry
  independent versions where their compatibility differs.
- Temporary compatibility code has an owner, removal condition, and test.
- No permanent dual spelling is introduced to ease migration.
- Production builds reject histories or artifacts that cannot be interpreted
  safely.

## Execution Order

1. [ ] Baseline: record current APIs, tests, IR, performance, and dirty-tree
       ownership without changing behavior.
2. [ ] Close W0 and P0: freeze Workflow parity and audit existing Presentation
       capability evidence and gaps.
3. [ ] Implement W1 and evidence-required P1 hardening without replacing
       working Presentation semantics.
4. [ ] Implement W2 and P2: differential Workflow execution and architecture
       boundary verification.
5. [ ] Expand Workflow semantics through W3-W7 while expanding web semantic
       domains through P3-P4 behind closed conformance gates.
6. [ ] Close W8 and P5 with generated evidence, compatibility documentation,
       cleanup, and final architecture review.

Workflow and Presentation completion may proceed in parallel. Presentation IR
work begins only from a demonstrated limitation; shared compiler changes land
in small increments with both test suites green.

## Immediate Baseline Checklist

- [x] Package build passes.
- [x] Existing Workflow suite passes: 12 tests.
- [x] Existing server production/compiler conformance passes: 6 tests.
- [x] Existing native Workflow runtime passes: 2 tests.
- [x] Current Workflow name is duplicated between model and implementation.
- [x] Current state initializer already accepts input but examples discard it.
- [x] Current native generator uses dynamic values and string-dispatched
      Dependency operations.
- [x] Current Workflow implementation explicitly documents that it is not
      Temporal parity.
- [x] Current Presentation boundary is target-independent at the public
      contract level.
- [x] Current web Presentation vocabulary is substantial but intentionally
      incomplete.
- [ ] Capture machine-readable API and IR baseline fixtures before the first
      migration.
- [x] Convert the Temporal capability ledger into checked repository data.
- [x] Convert the CSS coverage ledger into checked repository data.

## Progress Log

- 2026-07-24: closed the JavaScript-only server fallback without imposing a
  Rust boundary on web. The generic frontend classifies target source, and the
  server compiler extension now requires every server Program to lower before
  development starts. Consuming-Workspace `typecheck` and `check` therefore
  catch unsupported server syntax without Cargo, while source-native web
  Programs remain TypeScript. The complete source milestone passed 476 tests
  with 13 native/production tests intentionally excluded in 37.67 s.
- 2026-07-24: optimized verification without removing a correctness gate.
  Source checks no longer build the package, the complete gate builds it once,
  and milestone commands isolate Workflow and Presentation work. Generated
  native conformance now defaults to debug, release remains an explicit smoke,
  and lowering-only tests no longer create executables. Stable semantic
  artifacts ignore source-location diagnostics, share native crate compilation,
  retain bounded workspaces/artifacts, and bypass Cargo on exact hits. The warm
  complete gate fell from 251.54 s to 66.90 s while still passing 485 TypeScript
  tests, every native unit/doc test, package/API/Presentation/distribution
  checks, and a generated release executable.
- 2026-07-24: clarified that procedural Feature behavior is subject to the
  universal translation invariant, not only declarative definitions. Added W1
  gates proving that a Workflow logic change reaches generated Rust without a
  Workflow compiler/native edit and that an unrelated Feature shares the same
  lowering path.
- 2026-07-24: introduced generic `typeSchema<T>()` materialization and the
  first versioned Workflow definition envelope. An unrelated Feature fixture
  proves structural schema lowering, the compiled Workflow fixture executes in
  the generic JavaScript interpreter, and the native runtime consumes and
  validates the same envelope without a Workflow compiler extension.
- 2026-07-24: established the first same-source Workflow differential. One
  compiled, composed Program now runs through JavaScript and generated Rust and
  produces identical normalized durable history across start, timer, Signal,
  Query, state, and result boundaries. Added executable architecture checks and
  closed the generic `EventStore<Event>` host-contract composition gap revealed
  by the fixture with one broad host contract and Feature-private typed views.
- 2026-07-24: versioned the durable Workflow protocol independently from the
  definition envelope and persisted both versions in `workflow.started`.
  JavaScript and native runtimes now fail closed on incompatible or malformed
  history before replay; focused JS, Rust, and same-source differential suites
  pass.
- 2026-07-24: added the translation enforcement gate. A Feature defines only
  portable semantics and may neither own target lowering nor duplicate product
  behavior in Rust; all new language support must enter the feature-neutral
  TypeScript subset, target-neutral IR, and generic backends.
- 2026-07-24: closed Workflow W0. Pinned the current Temporal TypeScript SDK
  source commit, recorded intentional product-language differences, and added a
  compiler-checked complete target fixture spanning authoring, cross-Feature
  control, typed providers, children, schedules, visibility, bulk operations,
  and fault/time-skipping tests.
- 2026-07-24: made the universal translation invariant explicit. Feature
  factories are ordinary portable TypeScript and cannot own compiler plugins or
  Rust generators. Missing language support must be added once to the generic
  TypeScript subset and backend, while target-native runtime and host
  Dependencies remain the only handwritten boundary.
- 2026-07-24: closed the first complete W2 observation differential. The same
  compiled Workflow now produces equivalent histories, public Snapshots,
  results, Queries, failures, and effect counts in JavaScript and generated
  Rust. Fixed two generic issues exposed by that proof: lexical Dependency
  shadowing in nested closures and loss of TypeScript record insertion order in
  generated Rust. EventStore implementations now return the canonical data they
  actually persisted, including restart-stable `void` results.
- 2026-07-24: pinned Webref, Web Features, MDN compatibility data, and CSS
  Snapshot 2026; generated the first deterministic coverage report. It records
  815 properties, 56 at-rules, 102 descriptors, 162 functions, 158 selectors,
  and 524 value types. Aliases and shorthands are classified as redundant.
  Standards records are grouped into ten reviewed product-outcome domains and
  remain gap-detection evidence rather than a property-level implementation
  backlog or public vocabulary.
- 2026-07-24: replaced the Workflow-wide retry callback with the first
  operation-semantic Activity policy. The type-inferred policy map lowers as
  ordinary portable data through the generic compiler; JavaScript and native
  engines now share validation and backoff/cap semantics. This is only the
  retry-policy foundation of W3, not Activity parity.
- 2026-07-24: versioned the first durable Activity command envelope. Scheduling
  now precedes dispatch; attempts, explicit failures, retry deadlines,
  worker-loss abandonment, and completion are independently observable.
  JavaScript restart and generated-Rust differential fixtures cover the new
  protocol, while provider context and task-queue delivery remain open.
- 2026-07-24: introduced one generic typed Dependency provider envelope. Direct
  Programs and durable Activities now invoke the same provider implementation;
  runtime-owned identity, attempt, scheduled time, and start time cross the
  JavaScript and native boundaries without Feature-specific translation. A
  same-source JavaScript/generated-Rust Workflow fixture and feature-neutral
  compiler/runtime tests pass.
- 2026-07-24: corrected the active Presentation scope to completion and
  conformance of the existing system rather than a replacement language or IR.
  The first evidence-driven adapter fix now gives production document
  evaluation and client bundling the same deterministic local-asset paths;
  focused, byte-identical build, and hydrated-browser checks reject temporary
  `file://` output without changing the public Presentation API.
- 2026-07-24: replaced the property-level Presentation backlog implication with
  ten reviewed outcome domains. The compiler now derives every existing
  `WebStyle` leaf path and fails the standards check if any path has no
  capability owner; all current paths are accounted for without adding a
  second vocabulary or changing authored Presentation syntax.
- 2026-07-24: completed the current Presentation representation and ownership
  audit without authorizing a generic IR rewrite. Repository architecture tests
  also exposed and closed two shared-layer violations: portable type intrinsics
  now belong to core rather than compiler, and runtime dependency projection
  now consumes canonical compiler IR rather than the linking algorithm. The
  existing lazy typed observation contract and non-web type-pressure fixture
  remain sufficient; neither requires replacement IR.
- 2026-07-24: closed the first demonstrated responsive-composition gap without
  adding a second styling vocabulary. Existing condition leaves now compose
  through typed `all`, `any`, and `not`; deterministic compiler tests cover
  nested and De Morgan semantics, and browser CSSOM verification accepts the
  emitted media/container query forms.
- 2026-07-24: closed a production request-rendering parity gap without changing
  authored Presentation. The web adapter now evaluates request-invariant initial
  Presentation during the JavaScript build, serializes a strict Element artifact
  consumed by the Rust document host, and resolves local assets identically in
  development SSR, production SSR, and the client. The conformance fixture proves
  byte-equivalent CSS/classes and asset meaning; request-derived Presentation
  props remain an explicit partial capability rather than a silent mismatch.
- 2026-07-24: closed the demonstrated container-shape responsiveness gap through
  the existing `WebCondition` vocabulary. Typed aspect-ratio bounds and
  portrait/landscape orientation lower into one deterministic native container
  query, reject invalid ratios, and pass both compiler tests and browser CSSOM
  parsing. Style queries and specialized display environments remain explicit
  gaps.
- 2026-07-24: closed nested parent-grid alignment with one existing layout
  spelling: `columns: "subgrid"` and `rows: "subgrid"`. The web compiler emits
  canonical subgrid declarations, the focused suite passes, and browser
  realization reports computed subgrid tracks. Named placement, fragmentation,
  and advanced positioning remain open.
- 2026-07-24: hardened the verification workflow after the complete gate exposed
  29 GiB of stale generated Feature-conformance workspaces. Data and Workflow
  native build caches now live inside their disposable fixtures; the dedicated
  production-cache test remains authoritative. After cleanup, the complete gate
  passes 475 TypeScript tests plus every native Rust unit and doc test.
- 2026-07-24: closed the snapping-collection layout gap through one logical
  `scroll` relationship. Container snap axis/strictness/padding and item
  alignment/stop/margin lower to native CSS without JavaScript; compiler tests
  and browser computed-style evidence pass. Virtualization, touch policy, and
  scrollbar presentation remain separate outcomes.
- 2026-07-24: completed scrollbar presentation for scroll layouts with one
  typed indicator policy covering automatic/thin/hidden visibility and paired
  thumb/track colors. Browser computed-style evidence passes. Touch gesture
  ownership and virtualization are explicitly delegated to Component behavior
  rather than imported into Presentation.
- 2026-07-24: closed vertical-writing presentation with semantic block-flow and
  glyph-orientation meaning. Existing logical spacing remains unchanged across
  writing modes, proven by compiler and browser computed-style evidence.
  Language direction stays structural; variable-font controls, text emphasis,
  ruby, and advanced decorations remain open.
- 2026-07-24: closed bounded multi-line text with semantic `maxLines`. The web
  adapter owns the currently required legacy realization, rejects incompatible
  explicit layout models, and exposes no prefixed or duplicate authoring path.
  Compiler and browser geometry evidence prove a three-line bound.
- 2026-07-24: replaced a scheduler-dependent native Workflow unit-test poll
  with the public durable completion boundary and a race-free in-memory event
  subscription. The corrected fake timer no longer races an immediately
  completed Activity against an immediately completed timeout. The isolated
  native test passes 20 consecutive runs, and the complete repository gate
  passes 478 TypeScript tests plus every native Rust unit and doc test.
- 2026-07-24: exercised the existing editorial Presentation as the first
  difficult browser conformance fixture rather than creating a replacement
  demo. Wide and 390 px container layouts, parameterized assets, keyboard focus
  styling, reduced motion, sheet entry, layout mutation, interrupted exit, and
  final cleanup passed without console or page errors. The interruption trace
  contained no long task; its longest animation-frame callback was 2.252 ms,
  maximum layout was 0.441 ms, and maximum paint was 0.104 ms. This is
  representative evidence, not closure of the calibrated browser corpus.
- 2026-07-24: replaced the blanket “advanced web outcomes are missing”
  classification with evidence-based ownership. Print and paged media remain a
  Presentation gap; meaningful generated content belongs to structure; anchor
  positioning remains a layout gap; and scroll/view timeline outcomes already
  compose from Element observations and temporal values while native timeline
  lowering remains adapter optimization. The checked ledger rejects duplicate
  ownership of `animate`.
- 2026-07-24: closed general grid-item placement through one logical
  `item.grid` relation. Inline and block placement accept validated start/end
  lines or spans; the adapter alone chooses native grid row/column syntax.
  Focused compiler tests reject line zero and non-positive spans, and browser
  computed-style evidence preserves `2 / span 3` and `-3 / -1` exactly.
  Reusable named-area identity remains open rather than introducing unchecked
  strings.
- 2026-07-24: removed repeated magic strings from named container queries.
  `createContainer` now creates one validated branded identity reused by the
  container declaration and every cross-Component query. Both examples and the
  documentation use the single replacement path; unnamed nearest-container
  queries remain unchanged. Browser verification preserved native named
  container rules, the 390 px single-column response without horizontal
  overflow, and motion-sheet entry/exit without page or console errors. The
  complete repository gate passes 55 TypeScript files with 480 tests, every
  project typecheck, formatting, lint, API and Presentation ledgers, and all
  native Rust unit and doc tests.
- 2026-07-24: verified that the existing condition algebra already preserves
  nested selection against two distinct typed ancestor containers. The web
  compiler emits nested native container conditions without flattening their
  identities, so this pressure case required conformance evidence rather than a
  new public primitive.
- 2026-07-24: closed the style-query authoring question without adding an API.
  A nested Presentation already retains typed parent Feature meaning and
  receives typed child Feature meaning, proven by the type-pressure fixture.
  Native CSS style queries may optimize equivalent meaning inside the web
  adapter, but cannot become a second source of authored state.
- 2026-07-24: advanced W3 through the one generic Dependency provider envelope.
  Operation-specific heartbeat details, heartbeat deadline reset, retry
  recovery, and cancellation delivery now execute in JavaScript and native
  Rust. Native conformance exposed and fixed a close-race that could lose a
  final queued heartbeat. Structured failures now support one typed next-retry
  delay override, while the journal retains the computed absolute deadline as
  replay truth. Sixty focused TypeScript tests and every native workspace test
  pass; deferred completion, idempotency, task queues, and multi-process
  Activity faults remain open.
- 2026-07-24: extended the existing single Workflow differential executable
  with a retrying Activity attempt-timeout workload. JavaScript and generated
  Rust now prove the same two-attempt failure journal, typed timeout data, and
  one-millisecond retry delay without introducing another generated binary.
- 2026-07-24: added durable deferred Activity completion through the same
  generic Dependency provider envelope. A focused JavaScript restart fixture
  proves that the replacement worker waits on the journaled deferred attempt;
  same-result completion is idempotent and conflicting completion is rejected.
  The existing single generated conformance Program proves the same provider
  deferral, external completion, idempotency, result, and history in JavaScript
  and generated Rust. Protocol version 6 validates the deferred event without a
  Workflow-specific compiler or generator path. A focused deadline/completion
  race fixture proves one attempt receives exactly one durable closing event;
  both runtimes compare-and-append failure so an already committed completion
  wins instead of producing an impossible history.
- 2026-07-24: completed the external heartbeat and failure portions of the
  deferred Activity lifecycle without adding another Workflow invocation
  language. The typed reference now carries its result, failure, and heartbeat
  meaning into `activities.complete`, `activities.fail`, and
  `activities.heartbeat`. Focused virtual-time evidence proves deadline
  extension, retry-delay override, retry heartbeat context, idempotent failure,
  conflicting-failure rejection, and closed-attempt rejection. The existing
  single generated conformance executable proves the same commands and result
  in JavaScript and generated Rust. Temporal's external cancellation
  acknowledgement remains open because the current immediate Workflow
  cancellation policy cannot represent it honestly.
- 2026-07-24: the complete parallel repository gate exposed an active-workspace
  retention race in the generated Rust cache. Unchanged generated sources did
  not refresh the workspace mtime before Cargo started, so another process
  could evict the live working directory and make Cargo report an `ENOENT`
  before `rustc` executed. Every generated workspace is now touched before any
  Cargo command; bounded retention keeps its five-minute grace without
  serializing builds. The focused compiler/CLI gate and the complete repository
  gate pass after the fix.
- 2026-07-24: added the first durable condition slice to W4. One
  `wait({ condition, timeout? })` operation now survives worker restart,
  consumes Signals journaled while no worker is active, records exactly one
  outcome, and rejects impure predicates and malformed history. The existing
  conformance Program authors the predicate once in portable TypeScript and
  proves both condition outcomes and equivalent JavaScript/generated-Rust
  execution and history. The condition callback remains synchronously typed;
  both runtime realizations await the generic invocation transport internally.
  Timer replacement, deterministic concurrent composition, and cancellation
  scopes remain open.
- 2026-07-24: completed the first W4 control-flow item without adding a timer
  facade. Workflows now receive deterministic `time.now()`, and canonical
  portable `while` lowers through the feature-neutral IR, JavaScript
  interpreter, and Rust backend. A virtual-time test updates an absolute
  deadline by Signal, restarts on the replacement wait, and fires exactly at
  the new deadline. The existing shared conformance executable proves the same
  condition-loop replacement, time advancement, and history in JavaScript and
  generated Rust.
- 2026-07-24: made the intended compiler trust boundary explicit in the
  validation ladder. `test:workflow` now runs all 36 active Workflow source
  tests through the TypeScript reference runtime in 5.98 seconds without Cargo;
  root type checking takes 0.76 seconds and a focused portable-language test
  takes 1.09 seconds. An incomplete frontend-only concurrency change failed
  type checking and was removed rather than creating an unverified
  JavaScript-only semantic. The complete gate then passed 498 TypeScript tests,
  every native Rust unit and doc test, one package build, examples, API,
  Presentation, distribution, and release-native smoke in 77.39 seconds.
- 2026-07-24: added standard Promise composition to the universal portable
  TypeScript profile instead of introducing Workflow-specific parallel
  helpers. One version-20 IR expression now carries `all`, `race`, and
  `allSettled` through the TypeScript interpreter and generated Rust runtime.
  Focused frontend diagnostics reject detached composition and empty races;
  the existing generic native differential executable proves source-ordered
  start/results, first settlement, continued race losers, settled failures,
  and an exact Cargo-free artifact-cache hit.
- 2026-07-24: implemented the first compiler-owned durable cancellation scope
  on Workflow protocol 8. Cancellation request, command cancellation, and
  terminal cancellation are now distinct. Manual, timeout, inherited, and
  shielded scopes pass one same-source JavaScript/generated-Rust differential;
  timeout arming and durable command identity are equivalent. The separate
  restart fixture proves shielded cleanup resumes after both JavaScript and
  native process restarts. Forty source Workflow tests pass in 5.74 seconds;
  the warm native differential completes from the semantic artifact cache in
  3.22 seconds. Randomized interleaving and fault campaigns remain the next W4
  evidence item.
- 2026-07-24: closed the randomized W4 interleaving gate with twelve
  deterministic property-generated scenarios in the existing same-source
  conformance executable. The corpus exposed and fixed three generic issues:
  concurrent compiler-known resource methods were missing from Rust future
  lowering, native arrays lacked canonical numeric property reads, and native
  cancellation branches did not start through their first suspension before
  returning. It also replaced a fixed one-second fixture delay with semantic
  completion and made branch timeout ownership deterministic. Forty-one source
  Workflow tests pass in 5.70 seconds, all eight native Workflow package tests
  pass, restart conformance passes, and the exact generated artifact rerun
  bypasses Cargo in 4.21 seconds of test execution. Broader fault injection
  remains open.
- 2026-07-24: established protocol-9 Workflow execution identity as the W1
  prerequisite for messages, children, and Continue-As-New. `start` returns one
  `{ id, run }` reference; `describe`, `result`, `watch`, `cancel`, singular
  `signal`, and singular `query` all share one stale-run selector rule.
  Snapshots preserve the exact execution, concurrent idempotent starts return
  the winning run, and deferred Activity references are run-scoped. Forty-two
  source tests, all eight native Workflow tests, same-source
  JavaScript/generated-Rust conformance, and the separate restart fixture pass.
  The conformance Program rejects a stale run in both realizations; an exact
  generated-artifact rerun bypasses Cargo and completes in 5.53 seconds
  wall-clock. Signal acknowledgement and handler lifecycle remain the next W4
  work rather than being implied by identity alone.

### 2026-07-24

- Created the combined programme from the implemented-state audit, current
  Workflow tests, native production inspection, Temporal TypeScript capability
  research, and the existing Presentation standards plan.
- Set W0 and P0 as the first active research and contract milestones.
- Added `workflow-parity.json` with source-linked acceptance criteria and
  explicit status/evidence for 23 capability domains.
- Added a strategic ledger validation gate to the Workflow suite; all 12
  Workflow tests pass.
