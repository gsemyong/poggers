# Actor Feature

`createActor` is a reusable Feature factory for durable keyed state. It does
not add an Actor runtime or compiler path:

```text
createActor(definition)
  -> Feature
  -> ordinary server Program
  -> required and provided Dependencies
  -> generic TypeScript development execution
  -> generic Rust production compilation
```

## Define

The type supplies semantic meaning once. The implementation supplies only
behavior:

```ts
import { createActor, type Actor } from "kit";

type Inventory = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Methods: {
    reserve: Actor.Method<
      { quantity: number },
      { remaining: number },
      { unavailable: { available: number } }
    >;
    availability: Actor.Read<undefined, { available: number }>;
  };
}>;

export const inventory = createActor<Inventory>({
  state: ({ key: _key }) => ({
    available: 10,
  }),
  methods: {
    reserve({ state, input, fail }) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }
      state.available -= input.quantity;
      return { remaining: state.available };
    },
    availability({ state }) {
      return { available: state.available };
    },
  },
});
```

The Actor name and method names are authored once in `Inventory`. The generic
model infers every implementation context, input, result, and product failure.
`Actor.Read` marks a read-only method without creating a second invocation
surface. The initial state receives the typed Actor key. Product creation data
belongs in an explicit method rather than an implicit activation hook.

## Compose

An Actor reference is an ordinary typed Dependency:

```ts
type Account = Actor<{
  Name: "account";
  Key: string;
  State: { balance: number };
  Dependencies: {
    inventory: Actor.Reference<typeof inventory>;
  };
  Methods: {
    purchase: Actor.Method<{ item: string; quantity: number }, { reservation: string }>;
    balance: Actor.Read<undefined, { balance: number }>;
  };
}>;

const account = createActor<Account>({
  state: (_context) => ({ balance: 0 }),
  methods: {
    async purchase({ state, input, dependencies, invocation }) {
      const reservation = await dependencies.inventory.get({ key: input.item }).reserve(
        { quantity: input.quantity },
        {
          idempotencyKey: `${invocation.id}:inventory`,
          wait: "accepted",
        },
      );
      state.balance -= 1;
      return { reservation: reservation.id };
    },
    balance({ state }) {
      return { balance: state.balance };
    },
  },
});
```

`Actor.Reference<typeof account>` exposes inferred semantic methods:

```ts
const account = dependencies.account.get({ key: "account-1" });

const result = await account.purchase(
  { item: "item-1", quantity: 1 },
  { idempotencyKey: "purchase-1" },
);

const accepted = await account.purchase(
  { item: "item-2", quantity: 1 },
  { idempotencyKey: "purchase-2", wait: "accepted" },
);

const balance = await account.balance();
```

Feature factories may keep these Actor Features internal and provide a
different domain Dependency. Actors are therefore reusable implementation
building blocks, not a mandatory public API.

Mutually dependent Actor models can name each method map once and derive the
peer contract without copying operation signatures:

```ts
type CartMethods = {
  checkout: Actor.Method<undefined, { order: string }>;
};

type PaymentMethods = {
  authorize: Actor.Method<{ amount: number }, { authorization: string }>;
};

type Cart = Actor<{
  Name: "cart";
  Key: string;
  State: { total: number };
  Dependencies: {
    payment: Actor.Reference<{ Key: string; Methods: PaymentMethods }>;
  };
  Methods: CartMethods;
}>;
```

`get({ key })` binds identity locally. Only the resulting method request crosses
the Dependency boundary; references and functions are never serialized.

Write-method call policy is always separate from product input. Methods with
input take `(input, options?)`; methods without input take `(options?)`.
`wait: "completed"` is the default, while `wait: "accepted"` resolves after
durable admission. `idempotencyKey` gives a caller-defined invocation identity;
repeating the same method on the same Actor with that key returns its retained
outcome rather than introducing a second result API. Cancelling accepted work
is a domain method. Generic transport deadlines and caller-wait cancellation
belong to the Dependency runtime and do not change durable Actor semantics.

## Migration

The method-oriented API replaces the earlier command/query authoring split:

- add one `Methods` map to the Actor model;
- replace implementation `commands` and `queries` with one `methods` object;
- use `Actor.Method` for durable writes and `Actor.Read` for read-only methods;
- remove per-handler `Actor.Command` and `Actor.Query` annotations;
- replace `Actor.CommandMigration` with `Actor.MethodMigration`;
- replace handler `timers` with `reminders`, and reminder `command` with
  `method`.

Persisted journal event names remain unchanged so the authoring migration does
not invalidate existing Actor state.

## Guarantees

- Write methods commit in one total order per Actor key. There is no cross-key
  ordering guarantee.
- Concurrent admission for one key is serialized independently from write
  execution. This prevents revision-retry amplification while preserving
  accepted-only self-scheduling; one hot Actor remains a deliberate
  single-turn throughput boundary.
- A completed call resolves to a typed product outcome. Product failures use
  `{ status: "failed", failure }`; infrastructure failures throw `ActorError`.
- `wait: "accepted"` returns only after durable admission. It does not wait for
  execution.
- Explicit `idempotencyKey` values preserve one invocation identity across
  retries within the configured retention horizon. The latest 1,024 settled
  outcomes per Actor key remain retrievable. The next 1,024 compacted
  invocation identities remain as expiry tombstones and fail with
  `result-expired`; identities older than both bounded windows may be reused.
- Read methods observe committed state and cannot mutate state or invoke
  Dependencies.
- Write methods are non-reentrant. A synchronous Actor call cycle fails with its
  complete path; accepting one leg asynchronously breaks the wait cycle.
- Named reminders are durable, one-shot, replaceable, cancellable, and
  generation-fenced. Recurrence is expressed by scheduling the next typed
  method from the current method.
- State and method inputs support typed forward migrations.
- At most 1,024 write methods may remain pending for one key. Further admission
  fails with `overloaded`.

Actor state, result, and reminder intent commit together in one Actor journal.
After 256 additional journal revisions, the Feature saves a versioned snapshot
and asks the EventStore to reclaim the covered history. A cold activation reads
one snapshot plus its incremental journal tail. The EventStore refuses
compaction without a durable snapshot at or beyond the requested revision.
Snapshot failure never changes a committed method outcome, and a crash after
snapshot persistence is recovered by finishing compaction on a later commit.

Awaited external Dependency effects retain stable invocation identity, but
their providers must be idempotent when retrying an external side effect. Kit
does not claim exactly-once effects outside the Actor journal.

## Realization

The generated Feature requires ordinary server Dependencies:

- `events` for linearizable compare-and-append storage;
- `alarm` for replaceable future Dependency invocations and `timer` for
  process-local suspension;
- `clock` and `identifiers` for time and ownership identity;
- `executionContext` for call-chain scope;
- `synchronization` for same-process keyed exclusion;
- `telemetry` for semantic runtime measurements;
- every product Dependency declared by the Actor model.

A deployment with replicas must give them the same durable EventStore, unique
process identities, clocks within its documented lease-skew bound, and access
to equivalent product Dependencies. Fenced journal commits reject stale
owners. Replica count, placement, sharding, relocation, and transport are not
part of Actor source.

When native production distribution is enabled with `KIT_NATS_URL`, the
adapter owns `KIT_PROCESS_ID`, `KIT_PROCESS_CLUSTER`,
`KIT_PROCESS_PARTITIONS`, the membership and ownership lease settings,
`KIT_PROCESS_MAX_INFLIGHT`, and `KIT_PROCESS_DRAIN_TIMEOUT_MS`.

The adapter exposes a versioned operator control endpoint on
`kit.process.control.<cluster>.<program>.<process>`, with every segment encoded
as URL-safe base64. NATS request/reply operations are `status`, `drain`, and
`rebalance` (optionally scoped to one reported ownership). Status reports
health, readiness, active calls, configured capacity, owned partitions, and
generic routing, admission, retry, rejection, failure, and ownership-move
counters. These are deployment operations, not Actor methods.

Compatibility is negotiated independently for each compiler-derived
Dependency operation. A rollout may add unrelated methods without
disqualifying compatible calls; changing an operation's input, output,
heartbeat, failures, or mode excludes that replica before execution.
Membership-renewal or transport-listener loss fails the replica closed.
Graceful drain stops admission, waits for bounded in-flight work, releases
ownership, and leaves membership.

Remote Dependency calls preserve W3C trace context and baggage, explicit typed
authorization inputs, typed product failures, deadlines, cancellation, and
stable invocation identity. NATS authentication and authorization protect
adapter control and transport subjects. Actor business code does not receive
topology or transport credentials.

The Actor Feature records `actor.calls`, `actor.queue.depth`,
`actor.activations`, `actor.cache.entries`, `actor.cache.hits`,
`actor.cache.misses`, `actor.retries`,
`actor.reminder.lag`, and `actor.failures` through the ordinary `telemetry`
Dependency. Development provides a zero-cost default sink. Native production
writes canonical JSON lines when `KIT_TELEMETRY_FILE` is configured, allowing a
collector or sidecar to export the measurements without changing Actor code.
`KIT_CLOCK_OFFSET_MS` is an adapter diagnostic used to pressure bounded clock
skew; ordinary deployments leave it at zero.

## Limits

- Reminder intent remains authoritative in the Actor journal. `alarm` receives
  only a serializable Dependency target, never a process-local callback. Actor
  registration stored in the EventStore repairs scheduled delivery in bounded
  256-entry pages after total restart. With `KIT_NATS_URL`, the native
  production Alarm stores generation-fenced state and replaceable one-shot
  schedules in JetStream, and consumes due work through one durable shared
  queue. It requires NATS Server 2.12 or newer. The development provider and
  native fallback without `KIT_NATS_URL` are process-local and rely on Actor
  restart repair.
- Actor state is retained indefinitely by default. There is no automatic Actor
  deletion policy or public source-level deletion operation.
- Outcome and expiry-tombstone windows are fixed at 1,024 in the current
  Feature. A deployment needing a longer idempotency horizon must not reuse
  older keys until configurable retention is implemented.
- Product cancellation is an explicit method. Abandoning a caller's wait
  does not retract durably accepted work.
- The transport never retries product work implicitly. A durable caller may
  retry with the same invocation identity, but loss after provider execution
  and before result receipt remains an uncertain infrastructure failure.
  External effects therefore require provider idempotency or an atomic
  provider-owned outcome boundary.
- Actor source does not expose reentrancy, placement, shard, lease, mailbox, or
  transport controls.

## Verification

The focused source gate runs without Rust:

```sh
nub exec vitest run src/features/actor/feature.spec.ts
```

The production differential gate compiles the same Feature Programs through the
generic Rust backend and compares normalized journals, outcomes, failures,
nested calls, reminders, invocation identities, and restart behavior:

```sh
nub exec vitest run src/platforms/server/adapter/rust/compiler.spec.ts \
  -t 'compiles Actor Features'
```
