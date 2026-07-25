# Workflow Durable Control Flow

Workflow timers now use one timing object:

- replace `sleep({ milliseconds })` with `sleep({ duration })`;
- use `sleep({ deadline })` for an absolute epoch-millisecond deadline;
- provide exactly one of `duration` or `deadline`.

Workflow conditions use one durable predicate operation:

```ts
const ready = await wait({
  condition: () => state.ready,
  timeout: 30_000,
});
```

`condition` must synchronously return a boolean and must not mutate Workflow
state. `timeout` is optional and uses durable Workflow milliseconds. The result
is `true` when the predicate is satisfied and `false` when its timeout wins.

Use `time.now()` rather than ambient wall time inside Workflow code. It is
stable during synchronous execution and advances at recorded durable
boundaries, so condition loops can calculate replay-safe replacement timeouts.

Workflow protocol version 7 records a relative timer as its authored duration
and resolved deadline, and an absolute timer as its exact deadline. Existing
protocol-6 histories require an explicit migration before this runtime can
replay them. Protocol 7 also records condition schedule and outcome events, so a
protocol-6 runtime cannot execute a history containing conditions.
