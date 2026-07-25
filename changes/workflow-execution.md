kind: breaking
summary: Give every Workflow run an exact execution reference and one canonical control API.

# Workflow Execution Identity

`start` now returns `{ id, run }`. Every Workflow control and message
operation accepts that exact execution reference, while an explicit `{ id }`
selector resolves the current run. Stale run selectors are rejected in both
the JavaScript development runtime and generated Rust production runtime.

The public Dependency now uses `describe`, singular `signal` and `query`
namespaces, explicit result following, and explicit Query consistency.
Deferred Activity references also carry the run, preventing a delayed
completion from closing an Activity in another run with the same Workflow ID.

Workflow protocol 9 persists run identity in `workflow.started`.

See
[`docs/migrations/0007-workflow-execution.md`](../docs/migrations/0007-workflow-execution.md).
