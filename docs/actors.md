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
}>;

export const inventory = createActor({
  state: ({ key: _key }: Actor.Initial<Inventory>): Inventory["State"] => ({
    available: 10,
  }),
  commands: {
    reserve({
      state,
      input,
      fail,
    }: Actor.Command<Inventory, { quantity: number }, { unavailable: { available: number } }>) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }
      state.available -= input.quantity;
      return { remaining: state.available };
    },
  },
  queries: {
    availability({ state }: Actor.Query<Inventory>) {
      return { available: state.available };
    },
  },
} satisfies Actor.Definition<Inventory>);
```

The Actor name is authored once in `Inventory`. Command and query names are
authored once as object keys. The initial state receives the typed Actor key.
Product creation data belongs in an explicit command rather than an implicit
activation hook.

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
}>;

const account = createActor({
  state: (_context: Actor.Initial<Account>): Account["State"] => ({ balance: 0 }),
  commands: {
    async purchase({
      state,
      input,
      dependencies,
      invocation,
    }: Actor.Command<Account, { item: string; quantity: number }>) {
      const reservation = await dependencies.inventory.reserve({
        key: input.item,
        input: { quantity: input.quantity },
        idempotencyKey: `${invocation.id}:inventory`,
        wait: "accepted",
      });
      state.balance -= 1;
      return { reservation: reservation.id };
    },
  },
  queries: {
    balance({ state }: Actor.Query<Account>) {
      return { balance: state.balance };
    },
  },
} satisfies Actor.Definition<Account>);
```

`Actor.Reference<typeof account>` exposes inferred semantic methods:

```ts
const result = await dependencies.account.purchase({
  key: "account-1",
  input: { item: "item-1", quantity: 1 },
  idempotencyKey: "purchase-1",
});

const accepted = await dependencies.account.purchase({
  key: "account-1",
  input: { item: "item-2", quantity: 1 },
  idempotencyKey: "purchase-2",
  wait: "accepted",
});

const balance = await dependencies.account.balance({ key: "account-1" });
```

Feature factories may keep these Actor Features internal and provide a
different domain Dependency. Actors are therefore reusable implementation
building blocks, not a mandatory public API.

## Guarantees

- Commands commit in one total order per Actor key. There is no cross-key
  ordering guarantee.
- A completed call resolves to a typed product outcome. Product failures use
  `{ status: "failed", failure }`; infrastructure failures throw `ActorError`.
- `wait: "accepted"` returns only after durable admission. It does not wait for
  execution.
- Explicit `idempotencyKey` values preserve one invocation identity across
  retries. The latest 1,024 completed outcomes per Actor key remain
  retrievable; older known invocations fail with `result-expired`.
- Queries observe committed state and cannot mutate state or invoke
  Dependencies.
- Commands are non-reentrant. A synchronous Actor call cycle fails with its
  complete path; accepting one leg asynchronously breaks the wait cycle.
- Named timers are durable, one-shot, replaceable, cancellable, and
  generation-fenced. Recurrence is expressed by scheduling the next typed
  command from the current command.
- State and command inputs support typed forward migrations.
- At most 1,024 commands may remain pending for one key. Further admission
  fails with `overloaded`.

Actor state, result, and timer intent commit together in one Actor journal.
Awaited external Dependency effects retain stable invocation identity, but
their providers must be idempotent when retrying an external side effect. Kit
does not claim exactly-once effects outside the Actor journal.

## Realization

The generated Feature requires ordinary server Dependencies:

- `events` for linearizable compare-and-append storage;
- `alarm` and `timer` for process wake-ups and suspension;
- `clock` and `identifiers` for time and ownership identity;
- `executionContext` for call-chain scope;
- `synchronization` for same-process keyed exclusion;
- every product Dependency declared by the Actor model.

A deployment with replicas must give them the same durable EventStore, unique
process identities, clocks within its documented lease-skew bound, and access
to equivalent product Dependencies. Fenced journal commits reject stale
owners. Replica count, placement, sharding, relocation, and transport are not
part of Actor source.

## Limits

- The current EventStore contract is append-only. Actor caches replay only new
  events while warm, but a cold activation rebuilds from the retained journal.
  Physical snapshots and history compaction are not implemented.
- The current Alarm contract is process-local. Actor registration stored in
  the EventStore reconstructs pending wake-ups when a Program starts.
- Actor keys and retained idempotency history consume storage. There is no
  automatic Actor deletion policy.
- Product cancellation is an explicit command. Abandoning a caller's wait
  does not retract durably accepted work.
- Actor source does not expose reentrancy, placement, shard, lease, mailbox, or
  transport controls.

## Verification

The focused source gate runs without Rust:

```sh
nub exec vitest run src/features/actor.spec.ts --tagsFilter='!native && !production'
```

The native differential gate compiles the same Feature Programs through the
generic Rust backend and compares normalized journals, outcomes, failures,
nested calls, timers, invocation identities, and restart behavior:

```sh
nub exec vitest run src/adapters/server/production/compiler.spec.ts \
  -t 'compiles Actor Features'
```

The reproducible reference benchmark uses the same in-memory
compare-and-append EventStore for every case and reports raw samples:

```sh
nub run actor:benchmark
```
