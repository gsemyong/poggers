# Program Runtime And Durable Consumption Plan

Status: complete

This file is the source of truth for the Program runtime and durable event-consumption work. Update checkboxes and the evidence log as implementation proceeds. A phase is complete only after its verification gate passes.

## Goal

Create the smallest sufficient low-level surface for composing reusable Features while preserving unrestricted TypeScript execution:

- one complete semantic application `api`;
- local Feature implementation primitives under `resources`;
- arbitrary lifecycle-managed Programs for every environment;
- one durable `consume` operation for ordered event-log consumption;
- runtime-owned checkpoints that never leak into product state;
- deterministic restart, cancellation, retry, and idempotency semantics;
- no compatibility aliases, overloads, or parallel legacy paths.

Higher-level systems such as projections, workflows, indexers, agents, auth, and Inngest-compatible factories must remain implementable as ordinary Feature factories over these primitives. They must not be baked into the Program contract.

## Non-Goals

- Do not turn Programs into declarative event-handler maps.
- Do not add a second projection or event-subscription primitive.
- Do not infer progress from application Resources, views, snapshots, or UI state.
- Do not promise exactly-once external side effects.
- Do not add distributed leases or a JetStream adapter in this pass. Preserve an adapter-neutral contract so those can be added later.
- Do not retain the positional `consume(name, options, handle)` signature.
- Do not retain generated `use<Resource>()` Program hooks as a second resource-access path.
- Do not add `app` or `self` to the foundational context in this pass.

## Architectural Decisions

### One path per concern

| Concern                              | Canonical path                              |
| ------------------------------------ | ------------------------------------------- |
| Product-facing reads and actions     | semantic `api`                              |
| Local Feature implementation state   | `resources`                                 |
| Durable state mutation               | Resource commands                           |
| Durable event-log observation        | `consume`                                   |
| Arbitrary execution and coordination | Program function                            |
| External systems                     | injected dependencies                       |
| Program lifetime                     | `AbortSignal` and optional returned cleanup |
| Consumer progress                    | reserved substrate metadata                 |

### API composition

- `api` is the complete application semantic API tree.
- Mounted Feature names are direct namespaces: `api.orders`, never `api.features.orders`.
- A Feature definition constructs only its local API from its own Resources and child APIs.
- The runtime recursively composes local API members and mounted child namespaces.
- A local API member that collides with a child mount name is rejected by types and runtime validation.
- Feature Programs receive the complete application `api` plus only their local `resources`.
- Repeated Feature mounts remain independent because Feature internals address local Resources without knowing their mount path.

### Programs

A Program remains an unrestricted environment function:

```ts
programs: {
  server({ api, resources, consume, signal }, dependencies) {
    // Any TypeScript: consumers, loops, listeners, state machines, servers, timers.
  },
}
```

The return type is:

```ts
type ProgramResult =
  void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
```

The runtime invokes cleanup exactly once. It also aborts `signal` and closes registered consumers. Cleanup failures are reported without suppressing the original Program failure.

### Durable consumption

The sole public consumption shape is:

```ts
await consume({
  id: "authorize-payment",
  events: ["orders.created"],
  startAt: "origin",
  concurrency: 8,
  partitionBy: ({ event }) => event.key.ownerId,
  async run({ event, delivery, createIdempotencyKey }) {
    // Unrestricted TypeScript.
  },
});
```

Required fields:

- `id`: stable identity inside the mounted Feature Program;
- `events`: non-empty typed tuple of event names;
- `startAt`: initial position, either `origin` or `now`;
- `run`: handler.

Optional fields:

- `concurrency`: positive integer, default `1`;
- `partitionBy`: ordering key, default Resource identity;
- `signal`: narrower lifetime than the owning Program.

Rules:

- `startAt` is consulted only when the durable consumer has no stored definition.
- Existing progress always wins on ordinary restart.
- Explicit replay, reset, or checkpoint migration is administrative state change, never a product-state decision.
- A consumer may select several event types and observes their common source order.
- Event payload filtering happens inside `run` with ordinary code. There is no second filter DSL.
- Same-partition deliveries are strictly ordered. Different partitions may run concurrently.
- Duplicate consumer IDs within a Program generation fail immediately.
- Reusing an ID with an incompatible stored definition fails with a migration-required error.
- Dynamic consumer registration and closure work at any time, including after an `await`.

### Consumer identity and definition

The durable consumer key is:

```text
Program runtime id / mounted Feature path / consumer id
```

The event set is not part of the identity. Persisted consumer metadata contains:

- identity;
- selected event names;
- initial start policy;
- partition policy identity;
- progress schema version.

Changing event selection or partition semantics under an existing identity must not silently replay or skip history. The runtime rejects incompatible definitions until an explicit migration resets or moves the checkpoint.

The default partition policy has a fixed runtime identity. Custom partitioning must provide a stable revision alongside its function so semantic changes are detectable.

### Cursor model

Do not use a Journal record position as an event cursor. One Journal record may contain several events.

Use two internal progress concepts:

1. `SourcePosition`: the latest Journal record position known safe for source scanning.
2. `EventCursor`: an opaque, totally ordered event location. The single-node Journal representation is `{ position, index }`, where `index` is the event index within the committed record.

Each ordered partition stores an `EventCursor`. The source scanner stores a `SourcePosition`. Public Feature code never constructs or compares either value.

### First registration

For a new consumer:

1. Read the source high-water position.
2. Persist the consumer definition and initial source position.
3. Use position `0` for `origin`.
4. Use the captured high-water position for `now`.
5. Subscribe strictly after the persisted source position.

Capturing the high-water position and subsequently subscribing must not create a race. The Journal subscription contract must provide catch-up plus live delivery after the supplied position.

### Delivery and completion

For every matching event:

1. Compute the event cursor and partition.
2. Ignore it only if that partition already completed an equal or later cursor.
3. Durably claim the delivery with an incremented epoch and attempt.
4. Invoke `run`.
5. On success, durably complete the partition cursor.
6. Advance source progress only past positions with no pending deliveries.

On cancellation or failure before completion, the event is redelivered. A stale completion from a superseded epoch is rejected.

### Effects and idempotency

- Commands issued through Program Resource handles receive deterministic identities scoped to the delivery.
- Retrying a completed internal command returns its prior receipt rather than appending again.
- External effects remain at-least-once.
- `createIdempotencyKey(label)` is stable across retries of the same delivery.
- Dependencies that support idempotency accept that key explicitly.
- Higher-level workflow factories may journal effect results; the low-level consumer must not pretend arbitrary effects are exactly once.

### Failures

- A thrown handler error does not advance any checkpoint.
- One failed consumer generation stops coherently; no other consumer continues under a partially failed Program context.
- Runtime restart uses bounded exponential backoff with jitter and exposes failure/attempt information.
- There is no implicit event skipping.
- Parking, dead-lettering, compensation, and retry limits may be implemented by Feature factories or explicit handler logic.
- A history-retention gap fails loudly rather than starting from the earliest remaining event.

### Migrations and administration

Provide substrate-level operations used by testing and future tooling:

- inspect consumer definition, source position, partition checkpoints, and current invocation; tooling derives lag against the Journal high-water position;
- reset a consumer to `origin` or `now`;
- move progress from an old consumer identity to a new identity;
- remove abandoned progress explicitly.

These operations are not part of product state and are not exposed to browser application code by default.

## Resolved Defects

- [x] Several events emitted by one command share a record position, while partition completion currently compares only that position. Later events may be skipped.
- [x] New consumers implicitly start at position zero.
- [x] The event name is included in the durable identity, so subscription changes silently create a new consumer.
- [x] Stored progress does not validate the registered consumer definition.
- [x] Duplicate IDs are not rejected.
- [x] Delayed consumer registration can leave the host without a source subscription.
- [x] The public `consume` signature has three positional concerns rather than one coherent object.
- [x] A Feature Program receives only its local API and generated `use<Resource>()` hooks rather than global `api` and local `resources`.
- [x] API composition requires manual child forwarding instead of producing one recursive semantic tree.
- [x] Program cleanup return values are ignored.
- [x] Program restart has no bounded backoff or useful health state.
- [x] Tests do not cover multi-event records, definition incompatibility, `startAt: now`, or late registration.

## Implementation Plan

### Phase 0: Baseline and invariants

- [x] Record current typecheck, test, lint, and build results without modifying unrelated failures.
- [x] Record the current Program runtime test inventory and identify reusable fixtures.
- [x] Add focused regression tests that reproduce every known correctness defect before changing implementation.
- [x] Confirm all new tests fail for the intended reason.

Verification gate:

- [x] Baseline evidence is recorded below.
- [x] Multi-event same-position, duplicate identity, delayed registration, and initial-position regressions are reproducible.

### Phase 1: Semantic API composition

- [x] Define a recursive composed API type: local API members plus child mount namespaces.
- [x] Detect local-member/child-name collisions at compile time.
- [x] Detect the same collision during runtime API instantiation.
- [x] Compose child APIs automatically; remove manual public `features` wrapping.
- [x] Make root and Feature Program contexts receive the complete application `api`.
- [x] Replace generated Program `use<Resource>()` methods with one typed local `resources` object.
- [x] Preserve private child API access needed while constructing a parent Feature API without exposing `api.features` publicly.
- [x] Add type tests for nested Features, repeated Feature types under different mount names, root API members, and collisions.

Verification gate:

- [x] `api.orders`, not `api.features.orders`, is the only public path.
- [x] Feature Programs remain mount-name agnostic.
- [x] No Program context exposes both `resources.orders(...)` and `useOrders(...)`.
- [x] Type and runtime API trees have identical keys.

### Phase 2: Program lifecycle

- [x] Widen Program return types to optional synchronous or asynchronous cleanup.
- [x] Store cleanup only after successful Program initialization.
- [x] Invoke cleanup exactly once on stop, restart, initialization failure, or parent cancellation.
- [x] Abort the Program signal before cleanup.
- [x] Close consumers before or during cleanup according to one documented order.
- [x] Aggregate cleanup failure without losing the originating failure.
- [x] Add bounded exponential restart backoff with deterministic test hooks.
- [x] Expose minimal internal health state for tests and future diagnostics.

Verification gate:

- [x] Cancellation, restart, and stop tests prove no listener, timer, consumer, or cleanup remains active.
- [x] Rapid repeated restart cannot invoke two generations concurrently.
- [x] Program functions can still run arbitrary asynchronous logic unrelated to event consumption.

### Phase 3: Cursor and progress model

- [x] Introduce `EventCursor` and comparison helpers.
- [x] Attach an event index while translating committed Journal records into Program events.
- [x] Change partition checkpoints and invocation cursors from numbers to `EventCursor`.
- [x] Keep source scan progress as a Journal record position.
- [x] Version the reserved progress schema without a compatibility reader.
- [x] Reject malformed, regressing, or incomparable progress.
- [x] Ensure snapshots cover the new progress representation and remain optional accelerators.
- [x] Add a Journal high-water operation required for atomic `startAt: now` registration.
- [x] Implement the operation in memory and SQLite adapters and their contract suites.

Verification gate:

- [x] Every event in a multi-event record is processed exactly once by idempotent internal commands.
- [x] Crashes between any two events in a record resume at the precise event.
- [x] Progress survives Journal reopen and snapshot loss.
- [x] Cursor order cannot move backward.

### Phase 4: Consumer registration and public API

- [x] Replace the positional consume signature with the object form.
- [x] Support a non-empty typed tuple of event names and a discriminated event union in `run`.
- [x] Require `id`, `events`, `startAt`, and `run`.
- [x] Default partitioning to Resource identity and concurrency to one.
- [x] Add a stable revision for custom partitioning.
- [x] Persist and validate consumer definitions.
- [x] Reject repeated IDs in one Program generation.
- [x] Make registration asynchronous so `startAt: now` can persist an atomic initial position.
- [x] Make registration and closure notify the source coordinator.
- [x] Support consumers registered after arbitrary awaits.
- [x] Keep registration and closure safe during concurrent Program cancellation.
- [x] Return a subscription whose `close` is idempotent while also binding it to Program lifetime.
- [x] Remove the old overload and migrate every callsite.

Verification gate:

- [x] Type tests reject empty event arrays, unknown event names, invalid concurrency, and old signatures.
- [x] `startAt: origin` replays history exactly once.
- [x] `startAt: now` ignores existing history and cannot miss a concurrent append.
- [x] Restart always uses stored progress rather than applying `startAt` again.
- [x] Incompatible event-set or partition definitions fail before delivery.
- [x] Late registration catches up and then remains live.

### Phase 5: Delivery, ordering, and backpressure

- [x] Preserve total source order before partition routing.
- [x] Preserve strict order inside each partition.
- [x] Permit parallel work only across different partitions.
- [x] Keep pending delivery memory bounded.
- [x] Advance source progress across irrelevant records and handler-level no-op decisions.
- [x] Never advance source progress past an unfinished earlier event.
- [x] Validate monotonic externally enqueued source records.
- [x] Make close and cancellation leave unfinished work eligible for redelivery.
- [x] Ensure source checkpoint batching affects only replay cost, never correctness.

Verification gate:

- [x] Deterministic concurrency tests prove no same-partition overlap.
- [x] Randomized schedules preserve per-partition order.
- [x] Backpressure bounds are observed under a blocked handler.
- [x] Closing at every delivery phase either commits fully or redelivers.

### Phase 6: Failure and idempotency semantics

- [x] Preserve attempt, epoch, and uncertain-attempt metadata across crashes.
- [x] Reject stale completion epochs.
- [x] Confirm deterministic command identities survive redelivery.
- [x] Require stable labels for external idempotency keys.
- [x] Add tests for crash before effect, after effect, after internal command, and before checkpoint.
- [x] Add bounded restart backoff and reset it after a healthy interval.
- [x] Surface poison-event failure without skipping the event.
- [x] Ensure one failed generation cannot leave sibling consumers processing.

Verification gate:

- [x] Internal commands are committed once under every injected crash point.
- [x] External effects are documented and tested as at-least-once.
- [x] An idempotent fake capability observes one logical effect across repeated delivery.
- [x] A non-idempotent fake demonstrates why exactly-once is not claimed.

### Phase 7: Administrative progress operations

- [x] Add read-only progress inspection to the testing/substrate administration surface.
- [x] Add explicit reset to origin and now.
- [x] Add checkpoint identity move/rename.
- [x] Add explicit removal of abandoned progress.
- [x] Reject administration while the same consumer is actively claimed unless safely stopped.
- [x] Keep these operations out of browser product APIs.

Verification gate:

- [x] Reset, rename, and removal survive adapter reopen.
- [x] Renaming does not replay completed effects.
- [x] Reset does not mutate any application Resource state directly.

### Phase 8: Property-based and model tests

- [x] Build a small reference model for source cursor, partitions, claims, completion, and redelivery.
- [x] Cover records containing zero, one, or many events.
- [x] Cover event-type selections and default or custom partition assignments.
- [x] Cover crashes before claim, during handler, after command, and before completion.
- [x] Cover cancellation, restart, duplicate enqueue, and snapshot loss.
- [x] Compare runtime progress and committed outputs with the reference model.
- [x] Persist failing seeds in regression tests.

Verification gate:

- [x] Property suite passes with a documented run count and seed output.
- [x] Mutation checks prove that removing cursor index, stale-epoch validation, or source barriers causes failures.

### Phase 9: Feature and application migration

- [x] Migrate framework Features, workflows, tests, chat, data-flow, and other applications to object-form consume.
- [x] Migrate Program contexts to global `api` and local `resources`.
- [x] Remove manual Feature API forwarding made redundant by automatic composition.
- [x] Remove dead types, aliases, helpers, fixtures, and comments from the old surface.
- [x] Keep Feature-factory APIs unchanged unless automatic API composition removes redundant nesting.
- [x] Format changed files with Oxfmt.

Verification gate:

- [x] Repository search finds no positional consume calls or generated Program `use<Resource>()` calls.
- [x] All applications typecheck against the distributed kit configuration.
- [x] Workflow and data-flow behavioral suites pass without compatibility adapters.

### Phase 10: Final audit

- [x] Run focused Program, Journal, Feature, testing, workflow, and application suites.
- [x] Run complete kit tests.
- [x] Run repository typecheck, lint, format check, build, and tests.
- [x] Inspect the final exported declarations for accidental internal exposure.
- [x] Review all changed files for duplicate concepts and dead code.
- [x] Re-read every architectural decision and verify implementation evidence.
- [x] Update architecture documentation with only the final durable concepts.

Final acceptance gate:

- [x] There is one semantic application API tree.
- [x] There is one local Feature resource-access path.
- [x] Programs can execute arbitrary TypeScript and are not event-handler schemas.
- [x] There is one durable event-consumption primitive.
- [x] Product state contains no consumer cursor bookkeeping.
- [x] Multi-event records cannot skip deliveries.
- [x] Initial position, restart, replay, cancellation, ordering, idempotency, and failure semantics are tested.
- [x] No legacy API or compatibility layer remains.
- [x] All repository gates pass, or unrelated pre-existing failures are recorded precisely.

## Verification Commands

Use the narrowest command while iterating, then run the complete gates:

```sh
bun test packages/kit/src/substrate/program.spec.ts
bun test packages/kit/src/substrate/program.integration.spec.ts
bun test packages/kit/src/substrate/journal.spec.ts
bun test packages/kit/src/kernel/feature.spec.ts
bun test packages/kit/src/kernel/app.contract.spec.ts
bun test packages/kit/src/testing/application.spec.ts
bun test packages/kit/src/features/workflows.spec.ts
bun run --cwd packages/kit typecheck
bun run --cwd packages/kit lint
bun run --cwd packages/kit build
bun run --cwd packages/kit test
bun run typecheck
bun run lint
bun run build
bun run test
```

Run Oxfmt through the repository script discovered in `package.json`; do not invent a parallel formatter command.

## Evidence Log

Record commands, relevant counts, property seeds, failures, and decisions here while executing.

- 2026-07-16: Plan created from the API review and direct inspection of the current Program progress, consumer, and host source-coordination implementation.
- 2026-07-16: The baseline audit identified every defect listed above. Focused regressions now cover same-position events, exact restart within a multi-event record, duplicate and incompatible identities, `origin` and `now`, late registration, dynamic close, duplicate source delivery, and malformed source input.
- 2026-07-16: `ComposedFeatureAPIOf`, `instantiateFeatureAPIs`, and Feature contract tests prove one recursive semantic API. Runtime collision checks and `FeatureAPINamespaceCheck` reject the same ambiguous local-member/child-name shape. Feature Programs receive global `api`; their mount-local `resources` and consumer identities are rewritten by composition.
- 2026-07-16: Program lifecycle tests prove cleanup on stop, parent cancellation, and restart; concurrent restart calls share one transition; sibling failure stops the generation; cleanup errors aggregate with the originating failure. Feature composition tests additionally prove root and child cleanup composition and cleanup after sibling initialization failure.
- 2026-07-16: Progress schema `poggers-program-progress:3` stores exact `{ position, index }` cursors and rejects old schemas. Memory and Journal progress laws cover fencing, stale epochs, uncertainty, source monotonicity, snapshot loss, SQLite reopen, multi-event restart, and reverse-completion source barriers.
- 2026-07-16: Registration tests cover object-form typing, runtime validation, durable definition compatibility, revisioned custom partitions, high-water `now`, stored restart position, arbitrary late registration, coordinator notification, idempotent close, and host replay after a new consumer is added.
- 2026-07-16: Ordering tests cover same-partition serialization, cross-partition concurrency, custom partitioning, bounded backpressure, handler no-ops, duplicate enqueue, cancellation/redelivery, and 256 reverse completions without crossing an unfinished gap. The single-node Journal does not truncate history; its logical verifier rejects non-contiguous history rather than silently accepting a gap.
- 2026-07-16: Internal command identities remain stable on redelivery. The idempotent capability recovery test produces one logical effect after a crash; the non-idempotent test deliberately produces two effects with the same stable key, documenting the at-least-once boundary.
- 2026-07-16: Administration tests inspect, reset to `origin` and `now`, move, remove, reject active claims, reopen SQLite, and reuse old identities without hidden checkpoints. Administration remains in the private substrate module; lag is derived from inspected source position and Journal high water instead of persisted twice.
- 2026-07-16: The fenced progress reference model runs 200 generated traces with fixed seed `0x50_47_52`. Cursor-index, stale-epoch, and source-barrier regressions are mutation-sensitive respectively through the multi-event, stale-completion, and reverse-completion laws.
- 2026-07-16: Repository searches find no production positional `consume` call, `api.features` path, or generated Program `use<Resource>()` path. The remaining positional call is an intentional `@ts-expect-error`; workflow-local `useRuns` and `useScheduler` names are destructured aliases of the canonical `resources` object.
- 2026-07-16: `bun run fmt`, `bun run lint`, `bun run typecheck`, and `bun run test` passed. The run typechecked all six workspace packages, passed chat, data-flow, and workflow application suites, and passed 634 kit tests across 31 files before the final cancellation regression was added. Final counts are recorded after the closing gate below.
- 2026-07-16: The exact focused gate passed 214 tests across `program.spec.ts`, `program.integration.spec.ts`, `journal.spec.ts`, `feature.spec.ts`, `app.contract.spec.ts`, `testing/application.spec.ts`, and `workflows.spec.ts` in 7.17 seconds.
- 2026-07-16: The final complete test gate passed 635 kit tests across 31 files with 328,497 assertions in 35.86 seconds; the root run completed all 10 Turbo tasks successfully. An earlier concurrent `bun run check` attempt killed one compiler-diagnostic child process at its five-second test timeout. That test passed alone in 1.65 seconds and the subsequent non-concurrent complete root test run passed, identifying load contention rather than a retained product failure.
- 2026-07-16: The closing repository gate passed Oxfmt on 131 files, `oxlint`, all seven typecheck tasks, and all six build tasks. `git diff --check` passed. The generated root declaration exposes only the reviewed Application, Feature, and workflow surface; Program progress administration remains private to the substrate and its testing host.
- 2026-07-16: The final goal-scope source review found one semantic `api`, one mount-local `resources` path, one object-form `consume`, and no product Resource containing Program checkpoint state. The only positional call is the compile-time rejection fixture. Architecture documentation records exact cursors, fenced at-least-once delivery, lifecycle order, administration ownership, and the absence of generated Program Resource hooks.
