# Workflow Feature

## North Star

Workflow is a reusable Feature factory for durable, interactive computation.
Authors describe one Workflow as:

1. durable `State`, initialized from typed `Input`;
2. typed `Actions` that may durably change that state;
3. one deterministic `run` function that coordinates time, state, child
   Workflows, and declared Dependencies until it returns a typed `Result` or
   declared failure.

The public language should provide Temporal-level semantic coverage with fewer
concepts, no task-queue strings, no manually named checkpoint steps, and no
duplicate Signal, Update, and Query declarations.

Workflow is not part of the neutral core. It is a Feature factory built from
Programs and Dependencies, using Actor durability where its guarantees match.
The generic TypeScript-to-Rust compiler must never recognize Workflow, Actor,
Agent, or another Feature-specific concept.

Each Workflow execution maps to one Actor-backed coordinator. Actor owns only
durable keyed authority, ordered transitions, reminders, fencing, and the
internal outbound-delivery kernel. Workflow owns deterministic run and replay,
effect policy, logical time, cancellation scopes, children, parallelism,
schedules, history, visibility, migration, and dynamic Workflow IR.
Dependencies and their adapters own actual effect execution, authorization,
routing, transport, provider choice, heartbeat transport, and provider-side
fencing.

## Invariants

- Feature composition is static. Runtime-created Workflow definitions and
  executions are immutable or mutable data owned by the mounted Workflow
  Feature; they never mutate the System graph.
- A Workflow receives only the Dependencies declared by its semantic type and
  delegated to the creating principal.
- Every external effect crosses a Dependency boundary. Workflow code has no
  ambient clock, randomness, network, filesystem, process, DOM, or module
  loading.
- Type checking is necessary but is not authorization. Every Dependency
  invocation is authorized again at execution time.
- One execution has one durable authority and one total committed transition
  order. Work may run on many Platforms, but Workflow state is not an implicit
  multi-writer object.
- A definition is immutable and content-addressed. Editing creates a revision.
  An execution pins one definition revision until an explicit compatible
  migration or continuation.
- Development and production consume the same canonical Workflow meaning.
  Static definitions may be lowered ahead of time; dynamic definitions execute
  as validated IR in the Rust runtime.
- State and lifecycle changes are observable through a cursor-based durable
  stream. Reconnection resumes from the last acknowledged revision.
- No public raw-IR, raw-event-name, task-queue, or untyped operation escape
  hatch is introduced.

## Semantic Model

```ts
type Research = Workflow<{
  Name: "research";
  Id: string;
  Input: { question: string };
  State: {
    phase: "planning" | "working" | "review" | "completed";
    approved: boolean;
  };
  Visibility: {
    phase: true;
    approved: true;
  };
  Result: { report: string };
  Dependencies: {
    search: Search;
    documents: Documents;
  };
  Actions: {
    revise: Workflow.Action<{ instruction: string }, { revised: true }>;
    approve: Workflow.Action<undefined, { approved: true }>;
  };
}>;

export const research = createWorkflow<Research>({
  state: ({ input }) => ({
    phase: "planning",
    approved: false,
  }),
  actions: {
    revise({ state, input }) {
      revisePlan(state, input.instruction);
      return { revised: true };
    },
    approve({ state }) {
      state.approved = true;
      return { approved: true };
    },
  },
  async run({ input, state, dependencies, wait }) {
    const evidence = await dependencies.search.find({
      query: input.question,
    });
    state.phase = "review";
    await wait(() => state.approved);
    const report = await dependencies.documents.compose({ evidence });
    state.phase = "completed";
    return { report: report.text };
  },
});
```

The generic type is the single source of semantic names and schemas. The value
implementation fills only executable behavior.

### Actions

One Action replaces Temporal's separate Signal and Update declarations:

- waiting for durable admission is Signal-like;
- waiting for completion returns the typed result and is Update-like;
- runtime schemas reject malformed input and typed failures reject product
  input without changing State;
- Action handlers are durably ordered and may update Workflow state;
- Action handlers are synchronous and non-reentrant by design.

Long-running Action work is expressed explicitly: the Action records intent in
State and the single deterministic `run` function observes that State and
performs durable work. This preserves one total write order and avoids
Temporal's concurrent async-handler interleaving and lock discipline. A caller
that only needs durable admission selects `accepted`; a caller that needs the
typed Action outcome selects `completed`. Repeating the same typed Action with
the same idempotency key recovers the committed outcome without executing it
again.

Kit intentionally omits a second pre-history validator callback. Type/schema
validation occurs before handler meaning is applied, and a synchronous typed
Action failure leaves State unchanged. It also omits separate
Signal-With-Start and Update-With-Start calls: initial intent belongs in typed
Workflow Input. This is a deliberate smaller vocabulary, not an Actor or
compiler limitation.

Read-only interaction is the current authorized State projection. Additional
derived projections should be added only if concrete privacy or query-pressure
fixtures prove that observing State is insufficient.

### Visibility

`Visibility` selects scalar fields from the authoritative Workflow State. It
does not declare a second mutable search-attribute schema:

```ts
const page = await workflows.list({
  after: cursor,
  limit: 50,
  where: {
    status: ["running", "paused"],
    startedAt: { from: beginning, through: end },
    state: {
      phase: { oneOf: ["working", "review"] },
      approved: { equals: false },
    },
  },
});
```

The model drives the filter value types, the returned State projection, and
the sorted field list in versioned Workflow IR. Missing, complex, and
undeclared State fields fail type checking or extension validation. A list
cursor orders durable registration, not execution, completion, or provider
scheduling. One request scans one bounded registry page and may therefore
return fewer matching entries than its limit; callers continue until `done`.
This reference realization is correct without infrastructure beyond Actor.
Production visibility providers may materialize the same declared IR fields in
an indexed store without changing the product API.

### Run

`run` owns the execution lifecycle and may:

- execute deterministic local computation;
- read and update durable State;
- await a State condition or Action;
- invoke declared Dependencies durably;
- sleep until logical time;
- compose child Workflows;
- join or race concurrent durable branches;
- handle cancellation and compensation;
- continue under the same identity with fresh durable history;
- return the typed Result or a declared failure.

### History And Continuation

One run has a bounded durable history. `history` exposes deterministic metadata
to `run`, and `continueAsNew(nextInput)` is the single explicit checkpoint
transfer:

```ts
async run({ input, state, dependencies, history, continueAsNew }) {
  while (state.cursor < input.items.length) {
    await dependencies.work.process({ item: input.items[state.cursor] });
    state.cursor += 1;

    if (history.continueSuggested) {
      continueAsNew({
        ...input,
        cursor: state.cursor,
      });
    }
  }

  return { processed: state.cursor };
}
```

Continuation keeps the Workflow ID, closes the current run as `continued`,
increments its run identity, passes the typed next Input, and starts with fresh
active history. It is a control transfer, so enclosing `finally` cleanup
finishes exactly once before the next run starts. The coordinator retains only
64 prior run summaries and 1,024 full State change snapshots; it does not copy
old Input, State, Result, or event history into every Actor snapshot.

Actor's existing snapshot protocol then persists the compact coordinator state
and reclaims superseded EventStore entries. The local SQLite and JetStream
EventStore implementations both enforce snapshot-before-purge. Active history
suggests continuation at 10,000 events and rejects another durable suspension
at 50,000 events. This is a real bounded-history policy, not an in-memory array
reset. Long-term audit history and searchable visibility belong to the
Workflow visibility Dependency rather than the coordinator's hot state.

### Child Workflows

A child is another statically declared Workflow reference in `Dependencies`.
There is no parallel child registry, task-queue name, or untyped Workflow
lookup:

```ts
type Parent = Workflow<{
  Name: "parent";
  Input: { child: string };
  State: { phase: "starting" | "waiting" };
  Result: { value: number };
  Dependencies: {
    child: Workflow.Reference<Child>;
  };
  Actions: {};
}>;

const parent = createWorkflow<Parent>({
  state: () => ({ phase: "starting" }),
  actions: {},
  async run({ input, state, dependencies }) {
    const child = dependencies.child.get({ id: input.child });
    await child.start({ input: { value: 42 } }, { parentClose: "cancel", cancellation: "wait" });
    state.phase = "waiting";
    await child.approve();
    const result = await child.join();
    return result.status === "succeeded" ? result.value : { value: 0 };
  },
});
```

The Workflow compiler recognizes the typed reference declared by the generic
model and emits canonical child commands. Runtime execution still crosses the
ordinary Dependency boundary. Actor durably admits outbound child work but
does not know that the target is a Workflow.

`parentClose` controls a still-running child after normal parent completion,
failure, or termination:

- `terminate` closes it immediately without child cleanup;
- `cancel` requests cooperative child cancellation;
- `abandon` leaves it running independently.

`cancellation` controls a child when its enclosing parent scope is cancelled:

- `wait` requests cancellation and keeps the parent cancelling until the child
  closes;
- `request` requests cancellation but lets the parent close immediately;
- `abandon` leaves the child running.

Child start, Actions, State, describe, observation, and terminal result retain
their ordinary typed Workflow API. Start and close dispatch happen outside the
parent Actor turn. Both are recoverable from their atomically committed
outbound intent, and duplicate provider delivery retains one invocation
identity.

### Cancellation And Cleanup

Cancellation is a Workflow control-flow event, not an Actor command policy.
The root execution scope is cancellable. Nested work inherits cancellation
unless it is inside one explicit non-cancellable scope. Standard
`try`/`catch`/`finally` remains the authoring structure for recovery and
compensation; Kit does not introduce named rollback steps or a second graph
language.

The canonical meaning must satisfy these rules:

- suspension inside `try` does not execute `catch` or `finally`;
- a cancellation request is durably admitted before pending work is signalled;
- cancellation propagates to effects, timers, children, and nested cancellable
  scopes owned by the cancelled scope;
- `finally` runs exactly once during normal completion, failure, or
  cancellation;
- non-cancellable cleanup can still invoke Dependencies, sleep, and await
  children after its parent has been cancelled;
- cancellation waits only where the selected effect or child policy says to
  wait;
- `terminate` fences pending work and closes immediately without Workflow
  cleanup;
- a process restart resumes the same scope and unwind continuation rather than
  rerunning source that preceded the durable boundary.

The public language may add one non-cancellable-scope marker after its
type-level fixture is validated. It must not expose the Actor outbox, Alarm,
provider cancellation token, or serialized scope machinery. Effect-specific
`wait`, `request`, and `abandon` policies remain Workflow effect policy and do
not replace structured cancellation.

## Static Composition And Runtime Creation

The statically mounted Workflow Feature requires infrastructure Dependencies
for compilation, artifacts, journaling, scheduling, dispatch, authorization,
and telemetry. It provides one semantic Workflow management Dependency to
Programs that create or operate Workflows.

```text
System
└── Workflow Feature
    ├── requires platform/infrastructure Dependencies
    └── provides Workflow management and typed definition references
```

An AI Program uses its delegated reference:

```ts
await dependencies.workflows.create({ source });
const execution = dependencies.workflows.get({ id });
await execution.start({ definition: "research", input });
await execution.action({ name: "approve", wait: "completed" }, { idempotencyKey: "approve" });

for await (const change of execution.observe({ after: cursor })) {
  inspect(change);
}
```

`create` parses, checks, lowers, content-addresses, stores, and describes an
immutable definition. It does not mount a Feature. A definition may start any
number of execution instances subject to identity and authorization policy.
The compiler Dependency is the trusted publication boundary; callers cannot
forge a valid artifact through the product API.

### Definition Lifecycle

- `create`: validate, lower, and publish one immutable definition;
- `describe`: return schemas, dependencies, revision, provenance, and policy;
- `start`: create an execution pinned to this revision;
- `schedule`: create a managed recurring or one-shot start policy;
- `retire`: prevent new starts while retaining existing executions;
- `delete`: remove an unreferenced retired definition after retention checks.

### Execution Lifecycle

- `describe`: inspect identity, definition, status, time, and pending work;
- `state`: obtain the authorized current State projection and revision;
- `observe`: subscribe after a durable cursor;
- `result`: retrieve the current non-blocking outcome snapshot;
- `join`: wait durably for the terminal typed outcome;
- `pause` / `resume`: suspend and continue new Workflow progress;
- `cancel`: request cooperative cancellation and cleanup;
- `terminate`: force terminal state without Workflow cleanup;
- `continue`: start a fresh history while retaining logical execution identity;
- `migrate`: replay the currently mounted immutable revision and move only when
  initialization, Actions, durable commands, and the current frame remain
  equivalent.

There is deliberately no ambiguous `stop`. Physical execution deletion,
closed-history retention, and legal-hold policy remain operations of the
authorized EventStore/visibility boundary rather than a second Workflow
state-transition API.

## Dynamic TypeScript And Workflow IR

The AI authors the same restricted TypeScript as a developer. The runtime
authoring pipeline is:

```text
source
  -> parse and TypeScript diagnostics
  -> supported-subset validation
  -> Dependency and authority validation
  -> deterministic Workflow lowering
  -> canonical versioned Workflow IR
  -> content hash and signature
  -> artifact registry
```

The canonical IR must represent:

- contract schemas for Input, State, Result, failures, and Actions;
- pure expressions and local values;
- state reads and writes;
- branches, loops, and deterministic concurrency;
- suspension points and serializable locals live at each suspension;
- Dependency invocation plus retry, timeout, heartbeat, and cancellation
  policy;
- Action waits and handlers;
- timers and logical time;
- child Workflow start, interaction, join, and parent-close policy;
- lifecycle completion, continuation, cancellation, and failure;
- source spans, compiler version, language version, and definition revision.

Static production:

```text
TypeScript -> canonical Workflow IR -> generated Rust
```

Dynamic production:

```text
TypeScript -> canonical Workflow IR -> Rust Workflow IR executor
```

The dynamic path never evaluates generated JavaScript and never invokes Cargo.
Both production paths must pass the same trace-level conformance suite.

The already compiled host cannot statically know an AI-invented Action shape.
Generic clients use runtime schemas and branded descriptors. AI-generated
controller code imports a virtual module for the new artifact and is compiled
against generated declarations, restoring full static checking before it runs.

## Cross-Platform Work

Workflow source names a semantic Dependency operation, never a Platform,
machine, worker, or task queue. Programs on server, browser, mobile, service
worker, or another Environment may provide that Dependency.

The dispatch layer is responsible for:

- provider eligibility and identity;
- connected versus intermittent availability;
- authentication and delegated authority;
- durable admission and idempotency;
- start, heartbeat, completion, timeout, retry, and cancellation;
- fencing stale providers;
- fallback policy where the product declares one.

A device operation may remain pending until an eligible device reconnects.
This does not make Workflow State multi-master.

## Reactive Observation

Every committed transition has a monotonically increasing revision and durable
cursor. Observation yields authorized snapshots or deltas containing:

- lifecycle status;
- current State projection;
- pending waits, timers, child executions, and Dependency work;
- Action admission and completion;
- terminal result or failure;
- definition revision and migration state.

Transport is adapter-owned. A web adapter may realize observation with
WebSocket, SSE, or synchronized local state; native and server adapters may use
their own streaming mechanism. The semantic contract is cursor-based and
reconnectable.

High-volume ephemeral output, such as model tokens, is a separate typed stream
that may use bounded retention, sampling, or dropping. It must not inflate the
durable State history by default.

## Authorization And Safety

The compiler receives the exact Dependency catalogue delegated to the creating
principal. A dynamic definition may use only a subset.

Compilation rejects:

- undeclared Dependencies and operations;
- unsupported syntax or types;
- ambient or nondeterministic APIs;
- dynamic imports, evaluation, reflection, and prototype mutation;
- non-serializable State, inputs, results, failures, Actions, or suspended
  locals;
- unbounded constructs forbidden by the selected resource policy;
- incompatible definition migrations.

The runtime independently enforces:

- principal, tenant, data, and operation scopes;
- artifact shape, content identity, compiler/language version, and pinned
  definition revision;
- bounded source size, deterministic block execution, history, retained runs,
  changes, pages, and schedule expansion;
- Dependency authority on every attempt;
- idempotency and fencing;
- retention and destructive-operation policy.

## Existing Foundation

| Capability                                        | Current evidence                        | Workflow use                                   |
| ------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Keyed durable state and total command order       | Actor Feature                           | Execution identity and serialized transitions  |
| Durable admission and idempotency                 | Actor Feature                           | Actions and lifecycle operations               |
| Reminders, recovery, fencing, state evolution     | Actor Feature                           | Timers, wakeups, failover, migrations          |
| Typed Dependency references                       | Core Dependency                         | Workflow and cross-Feature interaction         |
| Retry metadata, cancellation, heartbeats          | Core Dependency                         | Activity-equivalent execution                  |
| Portable control-flow and Dependency IR           | Generic compiler                        | Static Workflow lowering                       |
| Type materialization intrinsics                   | `typeSchema`, `typeKeys`, `typeLiteral` | Runtime schemas without duplicate declarations |
| In-memory restricted source compilation           | Generic compiler source overlay         | Dynamic-authoring input                        |
| TypeScript reference interpreter and Rust backend | Execution/compiler                      | Differential semantic testing                  |

Workflow owns canonical static IR, serializable continuation frames, typed
Action procedures, a self-contained retained executable, and an independent
replay verifier. An execution persists its pinned artifact and interprets that
artifact when a newer worker no longer has matching generated static
procedures. The same portable interpreter is compiled into production Rust by
the generic compiler.

The dynamic realization compiles an in-memory restricted TypeScript module
without evaluating it, extracts the exact Dependency catalogue delegated to
one registry, publishes a canonical content-addressed artifact, and stores
definition revisions in an ordinary Actor-backed catalogue. Executions pin the
selected artifact by value. Create, compare-and-set revision, retirement,
deletion of non-current revisions, listing, restart recovery, and old/new
artifact execution have linked-Program evidence. Runtime schema admission,
generated typed controllers, deterministic resource bounds, replay-checked
dynamic migration, and production Rust differential evidence are all covered
by focused tests below.

## Temporal Parity Ledger

Status meanings:

- `complete`: the public behavior has focused executable evidence;
- `intentional`: equivalent semantics use a smaller public vocabulary.

| Domain             | Required behavior                                                      | Status      |
| ------------------ | ---------------------------------------------------------------------- | ----------- |
| Definition         | Input, State, Result, failures, Dependencies, Actions, `run`           | complete    |
| Identity           | Definition identity, execution ID, run/revision identity               | complete    |
| Start              | start, durable join, conflict and reuse policies                       | complete    |
| Interaction        | accepted/completed Actions, typed rejection, ordering, idempotency     | complete    |
| Reads              | authorized State and current result snapshots                          | complete    |
| Observation        | durable cursor, reconnect, State, lifecycle, child and work progress   | complete    |
| Time               | logical clock, sleep, sleep-until, durable condition with timeout      | complete    |
| Effects            | Dependency calls with retries, timeouts, heartbeats, cancellation      | complete    |
| Parallelism        | all, all-settled, race, deterministic completion ordering              | complete    |
| Children           | start, join, reference, Action, observation, cancellation              | complete    |
| Parent close       | terminate, abandon, request-cancel policies                            | complete    |
| Cancellation       | cooperative scopes, cleanup, shielded compensation                     | complete    |
| Lifecycle          | pause, resume, cancel, terminate, result, join, describe               | complete    |
| History            | bounded history, snapshots, continuation, compaction                   | complete    |
| Versioning         | immutable revisions, pinning, migration, replay check                  | complete    |
| Schedules          | interval, calendar, cron, timezone and DST                             | complete    |
| Schedule control   | pause, resume, update, trigger, backfill, delete                       | complete    |
| Schedule policy    | overlap, catch-up/misfire, jitter, idempotent triggering               | complete    |
| Visibility         | list, status filters, typed searchable State projection                | complete    |
| Testing            | replay, crash boundaries, time skipping, deterministic fixtures        | complete    |
| Production         | JS/Rust equivalence, multi-process relocation, fencing, telemetry      | complete    |
| Dynamic authoring  | source validation, Workflow IR, registry, Rust executor                | complete    |
| AI control         | delegated catalogue, generated controller, revision and migration      | complete    |
| Cross-Platform     | semantic dispatch to eligible Program providers                        | complete    |
| Signal/Update      | one synchronous Action plus accepted/completed wait policy             | intentional |
| Async handlers     | State records intent; `run` owns every durable suspension              | intentional |
| Query              | authorized State/result observation; projections added when needed     | intentional |
| With-Start message | initial intent is typed Input; no second atomic message/start facade   | intentional |
| Activity           | ordinary Dependency invocation plus execution policy                   | intentional |
| Task queue         | adapter/deployment routing derived from providers                      | intentional |
| Operations         | retention, deletion, quotas, tenants, reset, and bulk administration   | intentional |
| Workflow Streams   | typed State progress is durable; high-volume media is a Stream Feature | intentional |

The ledger is closed only when every row is either `complete` with focused
evidence or `intentional` with an equivalent product path and a clear ownership
boundary. It does not claim byte-for-byte Temporal API compatibility or
Temporal service administration parity.

## Milestones

### 1. Contract And Static Reference

- [x] Add `Workflow`, `Workflow.Action`, and `createWorkflow`.
- [x] Make the generic model the single source of every semantic name/schema.
- [x] Initialize State from typed Input.
- [x] Generate typed definition and execution references.
- [x] Prove invalid State, Action, Dependency, input, result, and failure shapes
      fail type checking.
- [x] Prove Workflow lowers to ordinary Feature, Program, and Dependency
      meaning with no Workflow-specific generic compiler IR.

### 2. Actor-Backed Execution

- [x] Persist definition revision, input, state, lifecycle, result, and failure.
- [x] Start idempotently with explicit conflict policy.
- [x] Admit and complete Actions with one ordered durable protocol.
- [x] Implement State, describe, result, cancel, terminate, pause, and resume.
- [x] Implement revisioned observation and reconnectable history.
- [x] Verify crash boundaries around admission, state commit, and completion.

### Actor Foundation Contract

Workflow expansion paused at this checkpoint until the ownership boundary had
executable evidence. That checkpoint is now closed.

The audit produced this ownership split:

| Mechanism                   | Durable responsibility                                                                                                                             | Explicitly does not own                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Actor command journal       | Atomically commits state, method outcome, reminders, and typed outbound intent                                                                     | Workflow retry, timeout, replay, cancellation, or compensation policy   |
| Alarm                       | Projects replaceable one-shot Dependency delivery, permits one active generation per ID, signals cancellation, and runs unrelated IDs concurrently | Logical effect identity, provider result admission, or Workflow history |
| Actor outbound kernel       | Stable invocation identity, claim lease, owner/attempt fencing, restart recovery, and typed completion admission                                   | Dependency-specific policy or exactly-once external effects             |
| Workflow dispatcher         | Selects the declared Dependency operation and applies attempt policy outside the Actor write turn                                                  | Transport, provider placement, credentials, or physical execution       |
| Dependency/provider adapter | Executes the effect, transports heartbeats and cancellation, authorizes it, and honors invocation identity                                         | Workflow state and replay meaning                                       |

Workflow commits `effect-attempt-started` and an Actor outbound intent in the
same Actor journal append. Actor projects and claims that intent, invokes the
Workflow-owned `$effect` dispatcher outside the exclusive Actor turn, and
durably admits `$completeEffect` as a typed Actor method. `$completeEffect`
therefore resumes Workflow policy inside the ordered transition; it is not a
second transport-completion protocol. The former Workflow `$claimEffect` and
second Alarm projection were removed. Workflow still owns effect attempt
history, retry, timeout, heartbeat, cancellation, replay, and compensation
meaning.

The ownership migration is intentionally narrow:

- [x] Audit the existing Actor command journal, reminders, Alarm projection,
      activation recovery, and Workflow `$effect`, `$claimEffect`, and
      `$completeEffect` protocol.
- [x] Add an internal typed Actor outbound intent committed atomically with the
      originating state transition and method result.
- [x] Dispatch that intent outside the Actor's exclusive turn with stable
      identity, durable claims, duplicate suppression, and stale-owner fencing.
- [x] Admit its typed completion back into the Actor journal durably.
- [x] Remove Workflow's duplicate transport claim and second Alarm while
      retaining Workflow-owned attempt history, retry, timeout, heartbeat,
      cancellation, replay, and compensation policy.
- [x] Prove a blocked Dependency does not block State reads, Actions, pause, or
      cancel.
- [x] Prove recovery after state-plus-intent commit, duplicate delivery,
      provider completion before Actor completion, and stale claims.
- [x] Prove ordinary Actors without outbound work retain their current
      behavior.
- [x] Compare normalized TypeScript and generated-Rust journals and outcomes.

Focused evidence:

| Required behavior                                                 | Executable evidence                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Blocked effect does not block reads, Actions, pause, or cancel    | `keeps lifecycle operations responsive while a Dependency effect is in flight`                  |
| Crash after state plus intent commit still dispatches             | `repairs a committed outbound intent after restart before dispatch`                             |
| Duplicate delivery retains one logical invocation identity        | `fences a stale outbound provider and deduplicates duplicate delivery`                          |
| Crash after provider completion is recovered safely               | `recovers provider-completion uncertainty with one stable invocation identity`                  |
| Stale owner/attempt completion is fenced                          | `fences a stale outbound provider and deduplicates duplicate delivery`                          |
| Durable cancellation survives restart and provider timing         | request, wait, abandon, and pre-dispatch recovery Workflow fixtures                             |
| Ordinary Actors retain behavior without outbound journal events   | Actor linked-Dependency execution fixture                                                       |
| Local/shared Alarm delivery remains concurrent and cancellable    | TypeScript host Alarm fixtures and `cargo test -p kit-server-alarm`                             |
| TypeScript and generated Rust produce equivalent journals/results | compiler-tagged `matches Actor-backed Workflow journals and outcomes in generated Rust` fixture |

Type checking alone did not close this checkpoint.

### 3. Durable Control Flow

The canonical IR and resumable executor precede public cancellation scopes.
Static Workflows now execute as extension-generated portable state machines:
unresolved durable operations return a serializable frame instead of unwinding
or retaining a JavaScript continuation. The former throw-and-replay runtime
has been removed. Cancellation scopes and compensation close only after their
scope state and cleanup continuations are represented explicitly in that
frame.

- [x] Define canonical versioned Workflow IR and a JSON-serializable execution
      frame with no live JavaScript continuation.
- [x] Execute and resume deterministic basic blocks across process restart,
      including branches, `while`, and fixed-range loops.
- [x] Lower synchronous iteration and direct Dependency `all`, `allSettled`,
      and `race` composition into the canonical IR.
- [x] Complete source lowering for cancellation scopes and `try`/cleanup after
      their Workflow-owned semantics are fixed.
- [x] Fix the semantic contract: cancellation is a durable Workflow control
      event; scope and unwind state are serializable; `finally` is not run by
      suspension; `terminate` skips cleanup.
- [x] Validate one minimal non-cancellable-scope authoring marker with a
      type-level fixture before making it public.
- [x] Represent scope ancestry, pending cancellation, and cleanup continuation
      explicitly in canonical Workflow IR and execution frames.
- [x] Lower standard `try`/`catch`/`finally` without retaining JavaScript
      continuations.
- [x] Prove normal completion, failure, cancellation, and restart each execute
      cleanup exactly once.

The public addition is only `shield(async () => { ... })`. Ordinary
`try`/`catch`/`finally` remains the control language. Internally, a linked
scope frame records body/catch/cleanup phase, cumulative cancellation
shielding, parent scope, and the exact transfer to resume after cleanup.
Cancellation admission and pending commands retain serializable identity and
logical time. The Workflow compiler emits both `advance` and `transfer` as
ordinary portable functions; the generic compiler and Rust backend do not
recognize Workflow scopes.

Focused evidence:

| Required behavior                            | Executable evidence                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suspension in `try` does not run cleanup     | `persists cleanup continuation without running cleanup at suspension`                                                                                          |
| Normal and failed exits clean exactly once   | `persists cleanup continuation...` and `unwinds effect failure...`                                                                                             |
| Nested cleanup order is deterministic        | `unwinds nested cleanup from inner to outer`                                                                                                                   |
| Catch precedes finally                       | `routes declared failure through catch and finally with standard ordering`                                                                                     |
| Cancellation is admitted before cleanup      | `admits cancellation durably and permits only shielded cleanup to suspend`                                                                                     |
| Shielded cleanup survives serialized restart | the same canonical fixture JSON-round-trips at every suspension                                                                                                |
| Authored API lowers to the same frames       | `lowers authored try/finally and shield to reference-equivalent portable frames`                                                                               |
| Actor-backed cancellation waits for cleanup  | `runs shielded cleanup durably after cancelling in-flight work`                                                                                                |
| Generated Rust matches TypeScript            | the existing single Workflow state-machine conformance executable now includes scope entry, cancellation transfer, shielded suspension, and cleanup completion |

- [x] Implement deterministic logical time, relative and absolute sleep, and
      durable condition timeouts.
- [x] Persist Dependency results and never repeat a committed effect.
- [x] Add durable retry/backoff, total and attempt timeouts, non-retryable
      failures, heartbeat renewal and checkpoint recovery, and
      request/wait/abandon cancellation paths.
- [x] Close cancellation-scope and compensation conformance before marking the
      Effects ledger complete.
- [x] Define deterministic all, all-settled, and race frame semantics with
      stable child sequences and out-of-order completion admission.
- [x] Integrate those concurrency frames into the Actor-backed coordinator,
      including out-of-order completion and loser cancellation.
- [x] Add crash-window and generated-Rust differential evidence for every
      concurrency policy.
- [x] Recover linear execution from every currently admitted suspension
      boundary without re-running completed source.
- [x] Add an independent history replay verifier for version compatibility.

Concurrency evidence:

| Required behavior                                            | Executable evidence                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `all` preserves authored order after out-of-order completion | `runs concurrent Dependency branches durably and preserves authored result order`                       |
| `allSettled` retains fulfilled and rejected outcomes         | the same live fixture plus canonical IR all-settled evidence                                            |
| `race` admits one winner and cancels pending losers          | the same live fixture plus canonical IR race evidence                                                   |
| Every policy survives provider completion before commit      | `recovers every concurrent policy after provider completion precedes its durable commit`                |
| Every branch retains stable invocation identity              | the same crash fixture inspects provider invocation identities                                          |
| Static and retained meaning agree in generated Rust          | `executes static and retained Workflow state machines in generated Rust` covers all three policy traces |

### 4. Composition And Lifecycle Completion

- [x] Add child Workflow start, reference, Action, observation, and result.
- [x] Add parent-close and child-cancellation policies.
- [x] Add cancellation scopes and shielded compensation.
- [x] Add continue-with-fresh-history and bounded history policy.
- [x] Include State initialization, every Action handler, and `run` in one
      canonical static artifact.
- [x] Give the exact canonical artifact a stable SHA-256 identity independent
      of object insertion order.
- [x] Persist the pinned artifact and preserve its identity across restart and
      continuation.
- [x] Resolve and execute a retained pinned artifact after a worker upgrades.
- [x] Add explicit replay-checked compatible migration to the currently
      mounted immutable revision.
- [x] Add replay-safety verification for changed definitions.

The replay verifier executes canonical history without invoking Dependencies.
It rejects the first changed command, including Dependency, operation, input,
options, ordering, timer, or wait meaning, and independently rejects a changed
terminal State, Result, failure, or continuation Input. This proves whether a
candidate immutable definition can replay one supplied history. Retained
artifacts preserve existing execution meaning; they do not declare a migration
safe or move an execution to a different artifact without checking its
relevant transitions. `execution.migrate()` rebuilds the candidate from its
State initializer, reexecutes recorded Actions without external effects,
verifies every admitted durable command and transfer, and compares the exact
current frame. Incompatibility is returned without changing the execution.

Child Workflow evidence:

| Required behavior                                | Executable evidence                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Type-safe declaration with no duplicate registry | `children.typecheck.ts` declares one `Workflow.Reference<Child>` in `Dependencies`      |
| Canonical child lowering                         | `lowers typed Workflow references to canonical child commands`                          |
| Start, Action, join, and observation             | `starts, controls, joins, and observes a typed child Workflow durably`                  |
| All parent-close and cancellation policies       | `applies child cancellation and parent-close policies outside the parent turn`          |
| Restart before start dispatch                    | `recovers child start and completion uncertainty across process restart`                |
| Provider completion before parent completion     | the same fixture injects the crash and proves one child cancellation admission          |
| Generated-Rust canonical meaning                 | the shared static Workflow state-machine differential includes a child-start suspension |

History and continuation evidence:

| Required behavior                                   | Executable evidence                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Typed source lowers to one continuation transfer    | `lowers typed continuation to one canonical Workflow transfer`                      |
| Same identity receives a fresh run and history      | `continues under one Workflow identity with bounded retained run summaries`         |
| Prior hot-state summaries remain bounded            | the same fixture continues 70 times and retains only the newest 64 summaries        |
| Standard cleanup precedes continuation exactly once | `continues as new after cleanup with deterministic history metadata`                |
| History metadata is deterministic and inspectable   | the same reference/portable differential fixture                                    |
| Generated Rust matches continuation meaning         | the shared static Workflow state-machine generated-Rust differential                |
| Physical journal entries are reclaimed safely       | Actor snapshot/compaction crash fixtures plus SQLite and JetStream EventStore tests |

Static artifact evidence:

| Required behavior                                      | Executable evidence                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| State, Actions, and run form one canonical definition  | `captures State initialization and typed Action transitions in the canonical definition` |
| Object insertion order retains one artifact identity   | `content-addresses State initialization, Actions, and run as one immutable artifact`     |
| Changed initializer or Action meaning changes identity | the same content-addressing fixture                                                      |
| Artifact identity survives process restart             | `runs State, Actions, and run through the public durable reference`                      |
| Continuation retains the pinned artifact identity      | `continues under one Workflow identity with bounded retained run summaries`              |
| Old artifact executes after a worker source upgrade    | `retains pinned meaning and admits only replay-compatible worker migration`              |
| Retained executable matches generated static meaning   | `executes retained bytecode with reference-equivalent frames`                            |
| Retained executable runs through generated Rust        | `executes static and retained Workflow state machines in generated Rust`                 |
| Incompatible migration preserves old pinned meaning    | `retains pinned meaning and admits only replay-compatible worker migration`              |
| Compatible migration swaps one artifact atomically     | the same worker-upgrade fixture and repeat-migration `current` result                    |
| Migration verifier runs through generated Rust         | the retained state-machine conformance executable invokes `replayWorkflowExecutable`     |

An upgraded worker never substitutes its current State, Action, or `run`
implementation for an older pinned execution. It executes the immutable
artifact retained with that execution until explicit replay-compatible
migration succeeds. A revision that changes already-materialized State or
command meaning is intentionally incompatible; authors use
`continueAsNew(nextInput)` to perform an explicit typed state transfer instead
of hiding a one-off State migration language inside deployment.

### 5. Schedules And Visibility

- [x] Add epoch-aligned interval and phase-offset semantics.
- [x] Delegate calendar, cron, timezone, and DST resolution to one semantic
      Calendar Dependency with the same conformance suite for TypeScript and
      Rust providers.
- [x] Add skip, buffer-one, buffer-all, cancel-current, terminate-current, and
      concurrent overlap semantics.
- [x] Add catch-up windows, deterministic bounded jitter, and stable occurrence
      and execution identities.
- [x] Add create, update, pause, resume, trigger, backfill, describe, and delete
      with Actor-backed idempotent admission.
- [x] Prove restart after committed start intent and provider-completion
      uncertainty preserves one scheduled Workflow run.
- [x] Compare normalized schedule journals and outcomes in the shared
      TypeScript/generated-Rust conformance executable.
- [x] Add composite timing, calendar exclusions, initial pause/immediate
      trigger, action limits, operator notes, and scoped overlap overrides.
- [x] Add schedule listing and retained execution history beyond the bounded
      hot scheduling summary.
- [x] Add typed State-derived visibility and status/time filtering.
- [x] Keep retention, namespace/tenant, quotas, and bulk destructive
      orchestration at their existing authority/storage/deployment boundaries.

Schedule pause stops future schedule actions without pausing or cancelling runs
already started. Manual trigger and backfill remain available while paused.
Schedule deletion retracts undispatched schedule work and forgets its own
active bookkeeping, but never terminates an already admitted Workflow run.
Composite timing is the union of its interval, calendar, and cron members minus
its civil-calendar exclusions. A finite `remaining` count is consumed only
when an ordinary scheduled action is admitted; explicit triggers, backfills,
catch-up skips, and overlap skips do not consume it. Trigger and backfill may
override overlap for only their admitted occurrences without mutating the
schedule definition. Notes are operator-facing mutable state, including a
diagnostic note when pause-on-failure activates.
External effect exactly-once is not claimed: stable occurrence, execution, and
Actor outbound identities make provider retry idempotent.

`listSchedules` pages every durable schedule, including a deleted tombstone.
`listScheduleRuns` pages the Workflow executions created by one schedule; those
run records outlive the bounded `recent` coordination summary. Skipped
occurrences are scheduling decisions rather than Workflow runs and remain in
that bounded hot summary.

Workflow does not duplicate operational infrastructure. Feature/System
identity and Dependency authority establish tenant and namespace scope.
EventStore and deployment policy own closed-data retention and quotas.
Authorized operator Programs compose `list` with the existing typed
cancel/terminate/delete operations for bulk work. Adding a second Workflow
batch language would weaken rather than extend those controls.

Focused evidence:

| Required behavior                                      | Executable evidence                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Lifecycle and default skip policy                      | `runs durable schedule lifecycle and overlap policy through the Workflow reference` |
| All six overlap policies                               | `enforces every Workflow schedule overlap policy`                                   |
| Catch-up, jitter, update replay, pause/trigger, delete | `handles schedule catch-up, jitter, lifecycle, and civil-calendar delegation`       |
| Timing union and civil-calendar subtraction            | `unions composite schedule timings and subtracts calendar exclusions`               |
| Initial state, limits, notes, scoped overlap           | `controls initial state, action limits, notes, and scoped overlap`                  |
| Typed visibility, stable cursors, schedule/run listing | `lists Workflows, schedules, and retained scheduled runs with stable cursors`       |
| Cron/time-zone handoff                                 | the same Workflow fixture plus shared Calendar provider conformance                 |
| Restart before dispatch                                | `recovers a committed schedule start intent after restart`                          |
| Provider completion uncertainty                        | `recovers schedule provider-completion uncertainty without a duplicate run`         |
| TypeScript/generated-Rust equivalence                  | `matches Actor-backed Workflow journals and outcomes in generated Rust`             |

### 6. Dynamic AI Authoring

- [x] Extract the exact delegated Dependency catalogue and schemas.
- [x] Parse and check runtime-created restricted TypeScript.
- [x] Reject unsupported and unauthorized source with precise diagnostics.
- [x] Lower and publish immutable content-addressed Workflow artifacts.
- [x] Generate a typed data-only virtual controller and branded dynamic
      definition descriptor from one validated artifact.
- [x] Compile generated controller code through an ordinary Feature and
      registry Dependency without a Workflow-specific compiler path.
- [x] Add definition create, revise, retire, and delete authority.
- [x] Add adversarial source generation, delegated-authority, forged-artifact,
      and source-size fixtures.
- [x] Migrate a dynamic execution only to an exact content-addressed
      descriptor after replay compatibility succeeds.
- [x] Bound dynamic source size and interpreter control-flow work with focused
      rejection and deterministic resource-failure fixtures.

Dynamic definition evidence:

| Required behavior                                      | Executable evidence                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Canonical source compilation without evaluation        | `compiles runtime-authored source into the canonical Workflow artifact`                                          |
| Source-layout-independent artifact identity            | the same fixture compiles source with different line offsets to one identity                                     |
| Import and ambient nondeterminism rejection            | `rejects imports and ambient APIs in runtime-authored Workflow source`                                           |
| Ordinary Feature/Actor/Dependency lowering             | `lowers a dynamic Workflow registry to ordinary Actor and Dependency meaning`                                    |
| Exact delegated Dependency catalogue                   | `persists dynamic definitions, pins execution meaning, and enforces lifecycle authority`                         |
| Durable create, revision CAS, retirement, and deletion | the same linked-Program fixture restarts between create and revision                                             |
| Immutable old/new execution pinning                    | the same fixture completes retained revision 1 and revision 2 with observably different behavior                 |
| No post-retirement admission                           | the same fixture rejects a new execution after retiring the current definition                                   |
| Unauthorized and malformed source rejection            | `rejects unauthorized, invalid, forged, and excessive dynamic Workflow source`                                   |
| Typed controller generation                            | `generates a typed controller module for one immutable dynamic artifact`                                         |
| Generic imported descriptor lowering                   | `lowers imported immutable data inside a portable Program`                                                       |
| Compatible and incompatible dynamic migration          | `persists dynamic definitions, pins execution meaning, and enforces lifecycle authority`                         |
| Bounded source and execution work                      | excessive-source rejection plus `bounds runtime-authored control flow with the deterministic interpreter budget` |

A generated dynamic definition descriptor contains both its semantic name and
immutable artifact identity. Starting or migrating through it resolves that
exact retained revision; it never substitutes a newer current revision while
keeping stale static types. The untyped string start path deliberately selects
the current revision. Only a definition-bound typed reference exposes
`migrate()`.

### 7. Rust And Cross-Platform Realization

- [x] Execute the canonical Workflow artifact in Rust by compiling one
      portable TypeScript interpreter through the generic backend, without a
      Workflow-specific Rust implementation.
- [x] Give the Workflow compiler extension a generic extension-call boundary
      that emits ordinary portable Function IR for static advancement.
- [x] Prove the emitted static function matches the TypeScript reference
      executor for terminal, effect, and concurrent suspension frames.
- [x] Replace the live coordinator's throw-and-replay path with that generated
      static state machine and remove the superseded replay implementation.
- [x] Prove generated Rust executes the emitted state machine with the same
      first suspension frame, without Workflow-specific generic compiler
      branches.
- [x] Prove retained interpretation matches generated static State, Action,
      transfer, and initial advancement meaning in TypeScript, and directly
      execute the retained advancement path in generated Rust.
- [x] Extend static TypeScript/Rust differential evidence across resume,
      terminal, timeout, and concurrent frames.
- [x] Prove static lowering and dynamic interpretation produce identical
      traces.
- [x] Dispatch Dependency work to server, browser, and intermittent-device
      providers through the normal Dependency boundary.
- [x] Verify restart, relocation, stale-owner fencing, and multi-process
      observation.
- [x] Run focused release-mode production smoke and performance gates.

The shared generated-Rust conformance executable now compares the reference
state machine, extension-generated static advancement, and the retained
interpreter over wait wake-up, wait timeout, sleep resume, Dependency
success/failure, terminal completion, cancellation cleanup, continuation,
children, and all three concurrency policies. Repeated immutable executable
artifacts are hoisted in the fixture, while mutable execution frames remain
isolated per scenario. A separate replay fixture proves that provider failure
and the resulting Workflow transfer remain two ordered durable history events.

The focused cross-Platform fixture projects a local server provider, a remote
browser provider, and a reconnecting device provider behind one compiler-derived
Dependency contract. Workflow sees only that contract. The device's first
unavailable delivery becomes an ordinary retry with the same invocation
identity; the provider receives the second attempt after reconnection. This
fixture also guards the generic transport's clock boundary: a logical Workflow
deadline is transported as the duration between `startedAt` and `deadline`,
rather than being compared directly with Unix wall time.

The focused multi-Process fixture starts the same linked Workflow Program on
two generic Process replicas over one durable EventStore. It starts and
observes through different replicas, drains the current authority, resumes
through the survivor, rejects a deliberately stale invocation at the old
provider, completes after relocation, and resumes observation from the prior
durable cursor. Existing restart fixtures cover state recovery before dispatch,
after provider completion, during schedule dispatch, and across retained
definition migration.

The production-only Workflow gate explicitly builds a release executable and
compares normal completion, cooperative cancellation, schedules, visibility,
and normalized Actor journals with the TypeScript reference. On the local
verification machine, the first release artifact took 232.9 seconds and an
identical warm run took 11.9 seconds end to end. The warm path reused the
content-addressed release artifact; ordinary Workflow iteration remains on the
TypeScript and focused debug-conformance paths.

### 8. Closure

- [x] Exercise fulfillment, human approval, recurring automation, dynamic AI
      research, multi-device work, and long-history migration fixtures.
- [x] Close every parity-ledger row with evidence or an explicit equivalent.
- [x] Remove the superseded throw-and-replay Workflow path after migration.
- [x] Update public package exports and run documentation consistency checks.
- [x] Run the complete repository gate once.

During implementation:

```sh
nub vitest run src/features/workflow/feature.spec.ts
nub tsc --noEmit
```

At a static API or compiler milestone:

```sh
nub run check:workflow
nub run check:compiler
```

At an Actor durability milestone:

```sh
nub vitest run src/features/actor/feature.spec.ts src/features/workflow/feature.spec.ts
```

At a production milestone:

```sh
nub vitest run --tagsFilter=production src/features/workflow
```

Browser verification runs only when a web observation realization or example
changes. The complete repository gate runs once after architecture and behavior
stabilize.

### Current Effect Boundary

Actor owns generic outbound admission, stable invocation identity, wake-up,
claiming, fencing, and durable result delivery. Workflow owns every policy and
replay event that gives those mechanics product meaning. The product
Dependency remains behind the ordinary typed Dependency boundary; neither
Actor nor Workflow is a generic compiler or Rust-runtime special case.

This boundary provides effectively-once durable admission and completion in
the Actor journal, not exactly-once external side effects. If a provider
finishes and its completion cannot be recorded, dispatch can be repeated with
the same invocation identity. Providers must use that identity for
idempotency; stale completions are fenced from Workflow state.

## Required Conformance Fixtures

- [x] Order fulfillment with retries, compensation, approval, and child
      shipping.
- [x] AI research with parallel work, revision Actions, cursor-based progress,
      cancellation, and definition migration.
- [x] Browser or mobile Dependency that disconnects before completion and
      resumes without duplicate effects.
- [x] Recurring schedule across timezone and DST boundaries with overlap and
      catch-up policies.
- [x] Crash injection around command, effect, timer, Action, child start, and
      terminal boundaries.
- [x] Time-skipping execution spanning schedule horizons without wall-clock
      waits.
- [x] TypeScript reference, generated static Rust, and retained dynamic-IR
      differential traces.
- [x] Unauthorized generated source attempting ambient access, undeclared
      Dependencies, forged artifacts, excessive resources, and stale
      revisions.

## Non-Goals

- Dynamically mutating Feature or System composition.
- Running arbitrary JavaScript, npm packages, or generated native code.
- Hiding external effects outside Dependencies.
- Treating browser and mobile providers as continuously available or trusted.
- Replacing databases, indexed search, high-volume stream processing, or
  realtime media with Workflow State.
- Claiming exactly-once external side effects; Dependency operations must be
  idempotent under a stable invocation identity.
- Copying Temporal API names when one smaller semantic primitive preserves the
  behavior.

## Sources

- [Temporal Workflow execution](https://docs.temporal.io/workflow-execution)
- [Temporal TypeScript Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics)
- [Temporal message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)
- [Temporal cancellation scopes](https://docs.temporal.io/develop/typescript/workflows/cancellation-scopes)
- [Temporal child Workflows](https://docs.temporal.io/develop/typescript/workflows/child-workflows)
- [Temporal Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)
- [Temporal schedules](https://docs.temporal.io/develop/typescript/workflows/schedules)
- [Temporal versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)
- [Temporal Workflow streams](https://docs.temporal.io/develop/typescript/workflows/workflow-streams)
- [Inngest execution model](https://www.inngest.com/docs/learn/how-functions-are-executed)
- [Restate service models](https://docs.restate.dev/foundations/services)
