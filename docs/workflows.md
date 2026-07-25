# Workflow Feature

`createWorkflow` packages a procedural durable workflow behind one typed
Dependency. Authors write normal portable TypeScript. The runtime intercepts
declared Dependencies and records completed boundaries in a journal.

## Define

```ts
import { createWorkflow, type WorkflowModel } from "kit";

type Fulfillment = WorkflowModel<{
  Name: "fulfillment";
  Input: { orderId: string };
  Result: { shipmentId: string };
  State: { phase: "pending" | "reserved" | "shipped" };
  Dependencies: {
    warehouse: {
      reserve(input: { orderId: string }): Promise<{ reservationId: string }>;
    };
    shipping: {
      ship(input: { reservationId: string }): Promise<{ shipmentId: string }>;
    };
  };
  Signals: {
    expedite(input: {}): void;
  };
  Queries: {
    status(input: {}): "pending" | "reserved" | "shipped";
  };
}>;

export const fulfillment = createWorkflow<Fulfillment>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: {
    warehouse: {
      reserve: {
        timeout: { attempt: 30_000 },
        retry: { attempts: 3, delay: 1_000 },
      },
    },
    shipping: {
      ship: {
        timeout: { attempt: 30_000 },
        retry: { attempts: 3, delay: 1_000 },
      },
    },
  },
  async execute({ input, dependencies, state, cancellation }) {
    const reservation = await dependencies.warehouse.reserve(input);
    state.phase = "reserved";
    const delivery = cancellation.start({
      propagation: "inherit",
      timeout: 300_000,
      async execute({ dependencies }) {
        return dependencies.shipping.ship(reservation);
      },
    });
    const shipment = await delivery.result();
    state.phase = "shipped";
    return shipment;
  },
  signals: {
    expedite({ state: _state, input: _input }) {},
  },
  queries: {
    status: ({ state }) => state.phase,
  },
});
```

Compose `fulfillment.server` into a server Feature. It provides the
`fulfillment` Dependency:

```ts
const execution = await dependencies.fulfillment.start({
  id: order.id,
  input: { orderId: order.id },
});

await dependencies.fulfillment.signal.expedite({ execution, input: {} });

const status = await dependencies.fulfillment.query.status({
  execution,
  input: {},
  consistency: "current",
});

const result = await dependencies.fulfillment.result({
  execution,
  follow: "run",
});
```

`start` returns `{ id, run }`: `id` is the caller-selected Workflow identity
and `run` identifies the exact durable execution. Passing that complete
reference to `describe`, `result`, `watch`, `cancel`, `signal`, or `query`
rejects a stale run instead of silently controlling another execution with the
same ID. An ID-only `{ id }` selector intentionally resolves the current run.
Every Snapshot carries its exact `execution`.

The currently implemented operation vocabulary is `start`, `describe`,
`result`, `cancel`, `watch`, typed `signal`, and typed `query`. Result following
and Query consistency are explicit:

- `follow: "run"` observes the selected run; `"chain"` is reserved for the
  Continue-As-New milestone and does not yet provide chain semantics.
- `consistency: "eventual"` reads committed state without activating a worker;
  `"current"` requests current execution progress. Full message-handler
  consistency remains an open Signal/Query lifecycle item.

`cancel` records one
idempotent cancellation request. The Workflow becomes terminally cancelled
only when that request escapes its execution; code may catch cancellation and
perform shielded durable cleanup before completing normally.

Workflow execution receives one cancellation API:

```ts
const reservationId = reservation.reservationId;
const branch = cancellation.start({
  propagation: "inherit",
  timeout: 5_000,
  async execute({ dependencies, sleep }) {
    await sleep({ duration: 100 });
    return dependencies.shipping.ship({ reservationId });
  },
});

branch.cancel({ reason: "superseded" });
const result = await branch.result();
```

`inherit` propagates a parent request; `shield` isolates the branch for
explicit cleanup. An optional timeout is armed before the branch body starts.
The timeout guard belongs to the branch lifecycle rather than inheriting parent
cancellation independently, so a settled branch closes it deterministically.
`cancel` is synchronous and `result()` is the one typed join point. Scoped
Dependencies, timers, and conditions observe the same cancellation and journal
`workflow.activity.cancelled`, `workflow.timer.cancelled`, or
`workflow.condition.cancelled`. Cancelling an Activity controls its durable
Workflow command and provider invocation token; it cannot forcibly undo an
external side effect.

Every declared asynchronous Dependency operation has one corresponding
`activities.<dependency>.<operation>` policy. Calls remain ordinary
`await dependencies.<dependency>.<operation>(input)` expressions. The
currently implemented policy requires an `attempt` or `total` timeout and may
also set `queue` and `heartbeat` timeouts. It supports retry attempts and
declarative `delay`, `factor`, `maximumDelay`, and typed `nonRetryable` failure
names.

A typed Dependency may declare heartbeat detail meaning per operation. Its one
provider envelope then exposes the last durable details, heartbeat recording,
and cancellation without changing the consumer call:

```ts
import type { Dependency, DependencyImplementation } from "kit";

type Shipping = Dependency<{
  Operations: {
    ship(input: { reservationId: string }): Promise<{ shipmentId: string }>;
  };
  Heartbeats: {
    ship: { packedItems: number };
  };
}>;

const shipping = {
  async ship({ input, invocation }) {
    const packedItems = (invocation.previousHeartbeat?.packedItems ?? 0) + 1;
    invocation.heartbeat({ details: { packedItems } });
    await invocation.cancellation.wait();
    return { shipmentId: input.reservationId };
  },
} satisfies DependencyImplementation<Shipping>;
```

Heartbeat details are journaled before an Activity attempt closes, survive
retry and recovery, and reset the heartbeat deadline. Workflow cancellation is
delivered through `invocation.cancellation`; it does not imply that an external
side effect can be forcibly stopped. A typed `invocation.fail(...)` may set
`retry: { delay }` to override only its next retry delay. Deferred completion
uses `invocation.defer({ id })` and returns one typed serializable reference.
Another Program can heartbeat, fail, or complete that attempt through the
Workflow Dependency's typed `activities` API. External heartbeat details reset
the durable heartbeat deadline and become `previousHeartbeat` on retry.
External failure retains typed data and an optional next-delay override.
Completion and failure survive worker restart; repeating the same closing
command is a no-op, while a conflicting value is rejected. The reference
carries `{ workflow, id, run }`, so a delayed completion from a
stale run cannot close an Activity in a later run with the same Workflow ID.
Cancellation
acknowledgement, task-queue realization, automatic deduplication of the
provider's external side effect, and multi-process Activity fault evidence
remain explicit parity gaps.

## Compilation

The generic TypeScript frontend specializes the Feature factory, materializes
the model name and structural schemas before type erasure, and lowers the
ordinary callbacks and helpers into the same portable IR used by every other
Feature. Workflow does not own a TypeScript-to-Rust translator or a Rust code
template.

Every runtime receives one versioned definition containing the compiler-derived
name and input, result, state, Dependency, Signal, and Query schemas. It also
carries the compiler-owned durable protocol version; authors do not configure or
repeat either value.

The JavaScript development runtime and native production runtime implement the
same durable protocol behind the private `workflowRuntime` Dependency. Their
protocol equivalence is an active conformance milestone; it is not yet a claim
of complete generic execution or Temporal parity.

## Replay

The journal records:

- definition version, protocol version, run identity, input, and initial state;
- stable Activity identity, Dependency operation, input, policy, state, attempt
  starts, heartbeat details, failures, worker-loss abandonment, retry
  deadlines, deferred-completion identity, and completion;
- timer duration, deadline, completion, and state;
- condition timeout, resolved deadline, winning outcome, and state;
- signal identity, input, boundary, and resulting state;
- cancellation request, cancelled command, terminal cancellation, result, or
  error;
- renewable worker ownership.

Journal values use one canonical durable-data shape in every EventStore.
Records retain authored key order, undefined record fields and `void` results
are absent, undefined array entries become `null`, and negative zero becomes
zero. Non-finite numbers, functions, symbols, bigints, platform objects, and
circular values are rejected before they can produce runtime-specific history.

On recovery, the workflow function starts from the beginning. Recorded Activity
results and completed timers are returned without executing them again. An
attempt which was dispatched but not durably closed before worker loss is
recorded as abandoned and consumes one attempt before retry. Durable retry
deadlines survive restart. The runtime rejects incompatible changes to recorded
Activity calls or policy, timer durations, or state transitions, including
historical signal state.
Before replay, both runtimes also reject an unsupported journal protocol,
unsupported definition version, unknown event, duplicate start, or invalid
revision order. A protocol change therefore requires an explicit migration or
compatible decoder rather than silently interpreting old durable data.

`sleep` has one union-typed timing input. `sleep({ duration })` resolves a
relative duration against durable Workflow time when the command is first
scheduled. `sleep({ deadline })` records an absolute epoch-millisecond
deadline. Exactly one field is required. Both forms retain one state checkpoint,
one schedule event, and at most one completion event; replay rejects a changed
duration, changed absolute deadline, duplicate schedule, or completion without
its schedule. Protocol version 7 introduced this canonical timer record.
Protocol version 8 adds a distinct cancellation request plus cancelled
Activity, timer, and condition outcomes. Protocol version 9 adds exact run
identity to the start event and every externally completed Activity reference.
Older histories require an explicit migration or compatible decoder.

`wait({ condition, timeout? })` durably waits for a pure synchronous predicate
over Workflow state. It returns `true` when the predicate is satisfied and
`false` when the optional timeout wins. Signals received while no worker is
active are assigned to the currently open durable command, so replay delivers
them before deciding the condition. Conditions retain one state checkpoint,
one schedule event, and one winning completion event. Both runtimes reject an
impure predicate, a changed timeout or replay outcome, invalid timing, duplicate
schedule or completion, and completion without its schedule. Timer replacement,
is composed without another operation: a Signal updates the desired deadline
and a condition loop waits again. `time.now()` exposes deterministic durable
Workflow time, which remains fixed during synchronous execution and advances
when the Workflow consumes a Signal, Activity completion, timer completion, or
condition completion. This composition survives replay and worker restart in
both runtimes.

Portable code uses the standard awaited `Promise.all`, `Promise.race`, and
`Promise.allSettled` forms rather than a Workflow-specific parallel helper.
Their generic TypeScript and generated-Rust semantics are defined in
[`portable-typescript.md`](./portable-typescript.md).
The same-source conformance Program now covers all three Promise forms plus
manual, timed, inherited, and shielded cancellation scopes in JavaScript and
generated Rust. Its deterministic property-generated corpus covers twelve
additional combinations of manual cancellation, root cancellation, timeout
ordering, inherited work, and shielded completion. A separate restart fixture
proves a cancellation request and shielded cleanup timer survive worker loss.
Multi-process Activity cancellation acknowledgement and broader fault
injection remain open; this evidence is not a claim of complete Temporal parity.

Representative histories should be replayed before deploying workflow changes,
the same evidence category recommended by
[Temporal](https://docs.temporal.io/develop/typescript/best-practices/testing-suite).

## Scaling

Each workflow identity has a renewable lease. One runtime executes it while
unrelated identities can run concurrently. If a runtime stops renewing an
unfinished workflow, another runtime may claim it after expiry and replay the
journal.

Process replicas share correctness only when their `events`, `clock`,
`identifiers`, and `timer` Dependencies share the corresponding durable
authority. The Feature itself does not prescribe a transport or cluster.

## Activity Guarantee

Completed Activities are never intentionally called again on replay.
There is still an unavoidable crash window after an external operation succeeds
and before its result is appended to the journal. Therefore the current
guarantee is at-least-once.

The journal assigns one stable Activity identity across attempts. The typed
Dependency provider receives that identity, attempt number, scheduled and
started times, the active deadline, previous heartbeat details, heartbeat
recording, cancellation delivery, and a typed deferred-completion reference.
Providers can use the stable identity as an idempotency key, but the framework
does not yet supply an automatic durable deduplication store for the provider's
external side effect. Deferred completion makes the Workflow journal update
idempotent; it does not make that external side effect exactly once. The
Workflow Feature does not label the crash window "exactly once."

## Testing

`createWorkflowFixture` from `kit/testing` supplies virtual time, in-memory
journals, and restart control. Because this low-level fixture deliberately
bypasses compilation, it currently also receives the model's `name`. The
contract tests cover Activity scheduling, retry, abandoned-attempt recovery,
attempt/total/queue/heartbeat deadlines, durable heartbeat details and retry
recovery, typed non-retryable failures, cancellation delivery, timers, signals,
queries, result replay, replay incompatibility, two-runtime takeover, and lease
renewal. Generated Rust production has focused durable heartbeat,
provider-envelope, lease, and same-source attempt-deadline differential tests.
The same single-source differential fixture covers relative and absolute
timers, external heartbeat, external failure and retry, deferred completion,
same-command idempotency, a Signal-driven durable condition, deterministic
`time.now()`, and a reschedulable condition loop in JavaScript and generated
Rust. The same fixture also proves the condition-timeout outcome without adding
another executable. Focused virtual-time evidence proves a future absolute
deadline survives worker restart and a rescheduled absolute deadline remains
correct across another restart. A focused race test
also proves timeout and external completion cannot both close one attempt.
Timer replacement, condition cancellation, external cancellation
acknowledgement, and multi-process Activity fault conformance remain open.

## Limits

This is a Temporal-inspired foundation, not parity. The authoritative capability
and evidence gaps are tracked in
[`workflow-parity.json`](./workflow-parity.json). In particular, the current
surface does not yet include Updates, child Workflows, schedules,
Continue-As-New, versioning, visibility, complete Activity policy, or complete
durable concurrency and cancellation semantics.
