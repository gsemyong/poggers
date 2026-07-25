kind: breaking
summary: Add canonical durable Workflow timers and conditions.

# Workflow Durable Control Flow

`sleep` now accepts exactly one of `duration` or `deadline`. Relative timers
retain their authored duration for replay compatibility; absolute timers retain
their exact epoch-millisecond deadline.

`wait({ condition, timeout? })` durably waits for a pure synchronous predicate
over Workflow state and returns whether the predicate or timeout won.
`time.now()` exposes replay-safe durable Workflow time. A condition loop can
therefore implement an updatable timer by observing a Signal-mutated deadline
without a separate replacement operation.
JavaScript development and generated Rust production validate and execute the
same protocol-7 timer and condition history.

See
[`docs/migrations/0004-workflow-control-flow.md`](../docs/migrations/0004-workflow-control-flow.md).
