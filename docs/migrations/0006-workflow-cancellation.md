# Durable Workflow Cancellation

Workflow execution no longer receives `cancelled()`. Use the scoped
`cancellation` API:

```ts
const branch = cancellation.start({
  propagation: "inherit",
  timeout: 5_000,
  async execute({ dependencies }) {
    return dependencies.delivery.send(input);
  },
});

branch.cancel({ reason: "superseded" });
const result = await branch.result();
```

`inherit` propagates parent cancellation. `shield` isolates cleanup until it
is explicitly cancelled. The optional timeout is armed before the branch body
starts. `cancel()` records one idempotent request; terminal cancellation occurs
only when the request escapes Workflow execution.

Protocol version 8 adds `workflow.cancellation.requested`,
`workflow.activity.cancelled`, `workflow.timer.cancelled`, and
`workflow.condition.cancelled`. Protocol-7 histories must be explicitly
migrated or retained on a compatible decoder before deploying protocol 8.
