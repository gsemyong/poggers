kind: feature
summary: Add durable Workflow cancellation requests and scoped cancellation.

# Durable Workflow Cancellation

Workflow protocol 8 separates a cancellation request from a terminal
cancellation and records cancellation of an Activity, timer, or condition.
Workflow code receives one `cancellation` API with inherited or shielded
branches, an optional durable timeout, synchronous explicit cancellation, and
one typed `result()` join.

The JavaScript development runtime and generated Rust production runtime share
the protocol. Same-source conformance covers manual, timed, inherited, and
shielded branches plus a deterministic twelve-scenario interleaving corpus;
restart conformance covers a persisted request and shielded cleanup after
worker loss.

See
[`docs/migrations/0006-workflow-cancellation.md`](../docs/migrations/0006-workflow-cancellation.md).
