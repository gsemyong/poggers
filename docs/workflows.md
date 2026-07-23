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
  name: "fulfillment",
  state: () => ({ phase: "pending" }),
  retry: { attempts: 3, delay: 1_000 },
  async run({ dependencies, state, sleep, cancelled }, input) {
    const reservation = await dependencies.warehouse.reserve(input);
    state.phase = "reserved";
    await sleep({ milliseconds: 300_000 });
    if (cancelled()) throw new Error("cancelled");
    const shipment = await dependencies.shipping.ship(reservation);
    state.phase = "shipped";
    return shipment;
  },
  signals: {
    expedite() {},
  },
  queries: {
    status: ({ state }) => state.phase,
  },
});
```

Compose `fulfillment.server` into a server Feature. It provides the
`fulfillment` Dependency:

```ts
await dependencies.fulfillment.start({
  id: order.id,
  input: { orderId: order.id },
});

await dependencies.fulfillment.signals.expedite({
  id: order.id,
  input: {},
});

const status = await dependencies.fulfillment.queries.status({
  id: order.id,
  input: {},
});

const result = await dependencies.fulfillment.result({ id: order.id });
```

The complete operation vocabulary is `start`, `get`, `result`, `cancel`,
`watch`, typed `signals`, and typed `queries`.

## Replay

The journal records:

- input and initial state;
- dependency identity, operation, input, result, and state at each completed
  effect boundary;
- timer duration, deadline, completion, and state;
- signal identity, input, boundary, and resulting state;
- cancellation, terminal result, or terminal error;
- renewable worker ownership.

On recovery, the workflow function starts from the beginning. Recorded
dependency results and completed timers are returned without executing them
again. The runtime rejects incompatible changes to recorded dependency calls,
timer durations, or state transitions, including historical signal state.

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

## Effect Guarantee

Completed dependency results are never intentionally called again on replay.
There is still an unavoidable crash window after an external operation succeeds
and before its result is appended to the journal. Therefore the current
guarantee for dependency effects is at-least-once.

When duplicate external effects are unacceptable, the Dependency must accept a
stable operation key and deduplicate it at its own authority. The workflow
factory does not label this window "exactly once."

## Testing

`createWorkflowFixture` from `kit/testing` supplies virtual time, in-memory
journals, and restart control. The contract tests cover retries, timers,
signals, queries, cancellation, result replay, replay incompatibility,
two-runtime takeover, and lease renewal. Generated Rust production has focused
journal and lease tests.

## Limits

This is a Temporal/Restate-inspired foundation, not parity. The current portable
language does not include child workflows, parent-close policies,
continue-as-new/history compaction, or durable `Promise.all` and `Promise.race`
branches.
