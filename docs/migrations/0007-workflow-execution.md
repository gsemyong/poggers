# Workflow Execution Identity

Workflow control is now run-aware. Capture the execution returned by `start`
and pass it to subsequent operations:

```ts
const execution = await dependencies.fulfillment.start({
  id: order.id,
  input: { orderId: order.id },
});

await dependencies.fulfillment.signal.expedite({
  execution,
  input: {},
});

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

Apply these API changes:

- `get({ id })` becomes `describe({ execution })`;
- `signals.<name>` becomes `signal.<name>`;
- `queries.<name>` becomes `query.<name>`;
- `result` requires `follow: "run" | "chain"`;
- every Query requires `consistency: "eventual" | "current"`;
- Snapshots expose `execution: { id, run }` instead of a top-level `id`.

Use the complete `{ id, run }` reference when an operation must target one
exact run. Use `{ id }` only when selecting whichever run is current is
intentional.

Deferred Activity references now include `execution.run`; producers should
retain and return the reference supplied by `invocation.defer({ id })` rather
than reconstructing it.

Protocol version 9 adds `run` to `workflow.started`. Protocol-8 histories must
be explicitly migrated or retained on a compatible decoder before deploying
protocol 9.
