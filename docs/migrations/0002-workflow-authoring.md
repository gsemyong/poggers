# Workflow Authoring

Workflow identity now has one source of truth: `Name` in the semantic
`WorkflowModel`. Remove `name` from `createWorkflow(...)`.

Replace the former split callback arguments:

```ts
createWorkflow<Model>({
  state: ({ input }) => initialState(input),
  async execute({ input, state, dependencies, sleep, cancelled }) {
    // ...
  },
  signals: {
    approve({ state, input }) {
      // ...
    },
  },
  queries: {
    status: ({ state, input }) => {
      // ...
    },
  },
});
```

Specifically:

- rename `run` to `execute`;
- change `state(input)` to `state({ input })`;
- move Workflow input into the `execute` context;
- move Signal and Query input into their single context object.

Replace Workflow-wide retry policy with a typed policy for every declared
Dependency operation:

```ts
createWorkflow<Model>({
  activities: {
    shipping: {
      ship: {
        timeout: { attempt: 30_000 },
        retry: {
          attempts: 5,
          delay: 1_000,
          factor: 2,
          maximumDelay: 30_000,
        },
      },
    },
  },
  // ...
});
```

Every operation policy has an explicit portable timeout. A policy without
`retry` means one attempt. Retry timing is portable data; callback-valued retry
delays are no longer accepted.

The compiler materializes literal identity from the model before TypeScript
erases it. Feature and application code must not call `typeLiteral()` at
runtime or repeat the name as a value.

The low-level `createWorkflowFixture` currently accepts `name` because it
intentionally runs the JavaScript reference engine without compiling its test
module. This testing-only bridge is removed when Workflow fixtures execute the
same canonical definition used by development and production.

Workflow journals now persist compiler-owned definition and protocol versions
in their first event. Protocol version 6 records explicit Activity scheduling,
attempt/total/queue/heartbeat deadline policy, attempts, durable heartbeat
details, typed failures, cancellation, abandonment, durable retry deadlines,
deferred-completion identity, and completion. Dependency providers may declare operation-specific
`Heartbeats` meaning and receive `previousHeartbeat`, `heartbeat`, and
`cancellation` on their existing invocation envelope. A provider calling
`invocation.fail(...)` may add `retry: { delay }` to override the next retry;
the computed durable retry deadline remains the journaled source of truth.
An asynchronous provider may instead return `invocation.defer({ id })`; the
typed reference is controlled through `workflow.activities`. Another Program
may send typed heartbeat details, report a typed failure, or complete it.
Heartbeats reset the durable deadline and become retry context. Repeating the
same failure or completion is idempotent, while a conflicting closing value is
rejected. External cancellation acknowledgement is not yet supported; the
existing provider envelope still receives Workflow cancellation requests.
Pre-release development journals created before these fields existed are
intentionally incompatible and must be cleared. Production protocol changes
require an explicit migration or compatible decoder; runtimes will not guess
how to replay incompatible history.

## Presentation Conditions

Existing simple web Presentation conditions remain valid. Compound responsive
meaning can now use typed `all`, `any`, and `not` branches, and container
conditions can additionally constrain `minAspectRatio`, `maxAspectRatio`, and
`orientation`.

Replace repeated named-container strings with one typed identity:

```ts
const workspace = createContainer("workspace");

const root = {
  layout: { container: { identity: workspace, axis: "inline" } },
};
const compact = {
  rules: [
    {
      when: { container: { identity: workspace, maxInlineSize: 620 } },
      use: { layout: { padding: 12 } },
    },
  ],
};
```

The optional `identity` field replaces `name`; omit it for nearest-container
queries.

Grid models may additionally use `columns: "subgrid"` or `rows: "subgrid"`.
Grid items may use `item.grid.inline` and `item.grid.block` with typed
`start`/`end` or `start`/`span` placement. Existing track-list and item
declarations remain unchanged.

Scrollable layout containers and items may use the additive `scroll` declaration
for native logical-axis snapping. Existing overflow declarations remain
unchanged. The container declaration may also set its scrollbar `indicator`;
gesture behavior remains owned by Components.

Text declarations may add `writing` with a semantic block-flow direction and
glyph orientation. Document language direction remains structural. They may
also add positive-integer `maxLines`; it cannot be combined with an explicit
layout model because the current compatible browser realization owns display.
