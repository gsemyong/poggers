import type { Dependency } from "@/core/dependency";
import type { FeatureContractOf } from "@/core/feature";
import { createSystem, type SystemContractOf } from "@/core/system";
import { type Actor, ActorError, type ActorInvocation, createActor } from "@/features/actor";

type InventoryModel = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Methods: {
    reserve: Actor.Method<
      Readonly<{ quantity: number }>,
      Readonly<{ remaining: number }>,
      Readonly<{ unavailable: { available: number } }>
    >;
    availability: Actor.Read<undefined, Readonly<{ available: number }>>;
  };
}>;

const inventory = createActor<InventoryModel>({
  state: (_context) => ({
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

type Payments = Dependency<{
  Operations: {
    charge(
      input: Readonly<{ account: string; amount: number; idempotencyKey: string }>,
    ): Promise<Readonly<{ receipt: string }>>;
  };
}>;

type AccountModel = Actor<{
  Name: "account";
  Key: string;
  State: { balance: number; receipt?: string };
  Dependencies: { payments: Payments; inventory: Actor.Reference<typeof inventory> };
  Methods: {
    deposit: Actor.Method<Readonly<{ amount: number }>, Readonly<{ balance: number }>>;
    purchase: Actor.Method<
      Readonly<{ item: string; quantity: number; amount: number }>,
      Readonly<{ balance: number; reservation: string }>,
      Readonly<{ insufficientFunds: { balance: number } }>
    >;
    balance: Actor.Read<undefined, Readonly<{ balance: number }>>;
  };
}>;

const account = createActor<AccountModel>({
  state({ key }) {
    key satisfies string;
    return { balance: 0 } satisfies AccountModel["State"];
  },
  methods: {
    deposit({ state, input }) {
      state.balance += input.amount;
      return { balance: state.balance };
    },
    async purchase({ key, state, input, dependencies, fail, invocation }) {
      if (input.amount > state.balance) {
        fail({ type: "insufficientFunds", data: { balance: state.balance } });
      }
      state.balance -= input.amount;
      const receipt = await dependencies.payments.charge({
        account: key,
        amount: input.amount,
        idempotencyKey: `${invocation.id}:payment`,
      });
      const inventory = dependencies.inventory.get({ key: input.item });
      const reservation = await inventory.reserve(
        { quantity: input.quantity },
        {
          wait: "accepted",
          idempotencyKey: `${invocation.id}:inventory`,
        },
      );
      state.receipt = receipt.receipt;
      return { balance: state.balance, reservation: reservation.id };
    },
    balance({ state }) {
      return { balance: state.balance };
    },
  },
});

type LedgerModel = Actor<{
  Name: "ledger";
  Key: string;
  State: { balance: number; revision: number };
  Methods: {
    credit: Actor.Method<
      Readonly<{ amount: number; expectedRevision: number }>,
      Readonly<{ balance: number; revision: number }>,
      Readonly<{ conflict: { actualRevision: number } }>
    >;
    snapshot: Actor.Read<undefined, Readonly<{ balance: number; revision: number }>>;
  };
}>;
const ledger = createActor<LedgerModel>({
  state: (_context) => ({
    balance: 0,
    revision: 0,
  }),
  methods: {
    credit({ state, input, fail }) {
      if (input.expectedRevision !== state.revision) {
        fail({ type: "conflict", data: { actualRevision: state.revision } });
      }
      state.balance += input.amount;
      state.revision += 1;
      return { balance: state.balance, revision: state.revision };
    },
    snapshot({ state }) {
      return { ...state };
    },
  },
});

type AccountFeatureContract = FeatureContractOf<typeof account>;
type InventoryFeatureContract = FeatureContractOf<typeof inventory>;
type AccountServer = AccountFeatureContract["Programs"]["server"];
declare const accountRequirements: AccountServer["Requires"];
accountRequirements.payments satisfies Payments;
accountRequirements.inventory satisfies Actor.Reference<typeof inventory>;
declare const accountProvision: AccountServer["Provides"];
accountProvision.account satisfies Actor.Reference<typeof account>;

declare const accountClient: Actor.Reference<typeof account>;
const accountReference = accountClient.get({ key: "account-1" });
accountReference.deposit({ amount: 10 }) satisfies Promise<Actor.Outcome<{ balance: number }>>;
accountReference.deposit(
  { amount: 10 },
  {
    wait: "accepted",
    idempotencyKey: "deposit-1",
  },
) satisfies Promise<ActorInvocation>;
accountReference.purchase({ item: "item-1", quantity: 1, amount: 5 }) satisfies Promise<
  Actor.Outcome<
    { balance: number; reservation: string },
    Readonly<{ type: "insufficientFunds"; data: { balance: number } }>
  >
>;
accountReference.balance() satisfies Promise<{ balance: number }>;

async function inspectActorInfrastructureFailure() {
  try {
    await accountReference.deposit({ amount: 10 });
  } catch (error) {
    if (error instanceof ActorError) {
      error.failure satisfies Actor.Failure;
    }
  }
}
void inspectActorInfrastructureFailure;

async function inspectAcceptedInvocation() {
  const invocation = await accountReference.deposit(
    { amount: 10 },
    {
      wait: "accepted",
    },
  );
  invocation.id satisfies string;
}
void inspectAcceptedInvocation;

// @ts-expect-error Definitions are mounted; only injected references are callable.
account({ key: "account-1" });
// @ts-expect-error Method input is inferred from the Actor model.
accountReference.deposit({ amount: "ten" });
// @ts-expect-error Actor keys retain their declared type.
accountClient.get({ key: 1 });
// @ts-expect-error No-input read methods have a closed request shape.
accountReference.balance({ currency: "EUR" });

createActor<InventoryModel>({
  state: (_context) => ({ available: 0 }),
  methods: {
    reserve({ state, input, fail }) {
      if (input.quantity < 0) {
        // @ts-expect-error A method may fail only with its declared product failures.
        fail({ type: "negative", data: { quantity: input.quantity } });
      }
      return { remaining: state.available };
    },
    availability({ state }) {
      return { available: state.available };
    },
    // @ts-expect-error Implementations cannot add a method absent from the model.
    undeclared() {
      return {};
    },
  },
});

createActor<InventoryModel>({
  state: (_context) => ({ available: 0 }),
  // @ts-expect-error Every method in the semantic model requires an implementation.
  methods: {
    reserve({ state }) {
      return { remaining: state.available };
    },
  },
});

createActor<InventoryModel>({
  state: (_context) => ({ available: 0 }),
  methods: {
    // @ts-expect-error Method results must match their semantic definition.
    reserve() {
      return { remaining: "none" };
    },
    availability({ state }) {
      return { available: state.available };
    },
  },
});

type ThenModel = Actor<{
  Name: "then";
  Key: string;
  State: Record<never, never>;
  Methods: {
    then: Actor.Read<undefined, Record<never, never>>;
  };
}>;

// @ts-expect-error Actor references are deliberately non-thenable.
createActor<ThenModel>({
  state: (_context: Actor.Initial<ThenModel>) => ({}),
  methods: {
    // oxlint-disable-next-line unicorn/no-thenable -- intentional negative type fixture
    then: (_context: Parameters<Actor.Handler<ThenModel, "then">>[0]) => ({}),
  },
});

type ReminderModel = Actor<{
  Name: "reminder";
  Key: string;
  State: { due: number | null; fired: number };
  Methods: {
    wake: Actor.Method<ReminderWakeInput, Readonly<{ fired: number }>>;
    schedule: Actor.Method<
      Readonly<{ at: number; generation: number }>,
      Readonly<{ due: number | null }>
    >;
    repeat: Actor.Method<
      Readonly<{ at: number; interval: number; count: number; generation: number }>,
      Readonly<{ due: number | null }>
    >;
    cancel: Actor.Method<undefined, Readonly<{ cancelled: boolean }>>;
    status: Actor.Read<undefined, Readonly<{ due: number | null; fired: number }>>;
  };
}>;

type ForeignReminderModel = Actor<{
  Name: "foreign-reminder";
  Key: string;
  State: { fired: number };
  Methods: {
    fire: Actor.Method<undefined, Readonly<{ fired: number }>>;
  };
}>;

const fireForeignReminder: Actor.Handler<ForeignReminderModel, "fire"> = ({ state }) => {
  state.fired += 1;
  return { fired: state.fired };
};

type ReminderWakeInput = Readonly<{
  generation: number;
  at: number;
  interval: number;
  remaining: number;
}>;
type ReminderWake = Actor.Handler<ReminderModel, "wake">;

const wakeReminder: ReminderWake = ({ state, input, reminders }) => {
  state.fired += 1;
  if (input.remaining > 1) {
    const nextAt = input.at + input.interval;
    state.due = nextAt;
    reminders.schedule({
      id: "wake",
      at: nextAt,
      method: wakeReminder,
      input: {
        generation: input.generation,
        at: nextAt,
        interval: input.interval,
        remaining: input.remaining - 1,
      },
    });
  } else {
    state.due = null;
  }
  return { fired: state.fired };
};

const reminderMethods: Actor.Methods<ReminderModel> = {
  wake: wakeReminder,
  schedule({ state, input, reminders }) {
    state.due = input.at;
    if (input.generation < 0) {
      // @ts-expect-error A reminder cannot target a method from another Actor model.
      reminders.schedule({
        id: "foreign",
        at: input.at,
        method: fireForeignReminder,
        input: undefined,
      });
    }
    reminders.schedule({
      id: "wake",
      at: input.at,
      method: wakeReminder,
      input: {
        generation: input.generation,
        at: input.at,
        interval: 0,
        remaining: 1,
      },
    });
    return { due: state.due };
  },
  repeat({ state, input, reminders }) {
    state.due = input.at;
    reminders.schedule({
      id: "wake",
      at: input.at,
      method: wakeReminder,
      input: {
        generation: input.generation,
        at: input.at,
        interval: input.interval,
        remaining: input.count,
      },
    });
    return { due: state.due };
  },
  cancel({ state, reminders }) {
    reminders.cancel({ id: "wake" });
    state.due = null;
    return { cancelled: true };
  },
  status({ state }) {
    return state;
  },
};

const reminder = createActor<ReminderModel>({
  state: (_context) => ({
    due: null,
    fired: 0,
  }),
  methods: reminderMethods,
});

declare const reminderClient: Actor.Reference<typeof reminder>;
const reminderReference = reminderClient.get({ key: "reminder-1" });
reminderReference.schedule({ at: 1_000, generation: 1 });
reminderReference.repeat({ at: 1_000, interval: 100, count: 3, generation: 1 });
reminderReference.cancel();

type DocumentModel = Actor<{
  Name: "document";
  Key: string;
  State: { owner?: string; content: string; revision: number };
  Methods: {
    create: Actor.Method<
      Readonly<{ owner: string; content: string }>,
      Readonly<{ revision: number }>,
      Readonly<{ alreadyExists: { owner: string } }>
    >;
    edit: Actor.Method<
      DocumentEdit,
      Readonly<{ revision: number }>,
      Readonly<{
        notCreated: Record<never, never>;
        conflict: { actualRevision: number };
      }>
    >;
    snapshot: Actor.Read<undefined, Readonly<DocumentModel["State"]>>;
  };
}>;
type DocumentEdit = Readonly<{ content: string; expectedRevision: number }>;

const document = createActor<DocumentModel>({
  state: (_context) => ({
    content: "",
    revision: 0,
  }),
  methods: {
    create({ state, input, fail }) {
      if (state.owner) fail({ type: "alreadyExists", data: { owner: state.owner } });
      state.owner = input.owner;
      state.content = input.content;
      state.revision += 1;
      return { revision: state.revision };
    },
    edit({ state, input, fail }) {
      if (!state.owner) fail({ type: "notCreated", data: {} });
      if (input.expectedRevision !== state.revision) {
        fail({ type: "conflict", data: { actualRevision: state.revision } });
      }
      state.content = input.content;
      state.revision += 1;
      return { revision: state.revision };
    },
    snapshot({ state }) {
      return { ...state };
    },
  },
});

declare const documentClient: Actor.Reference<typeof document>;
const documentReference = documentClient.get({ key: "document-1" });
documentReference.create({ owner: "user-1", content: "Initial" });
documentReference.edit({ content: "Edited", expectedRevision: 1 });
documentReference.snapshot();

type CycleAMethods = {
  ping: Actor.Method<undefined, Readonly<{ actor: "a" }>>;
  pingAccepted: Actor.Method<undefined, Readonly<{ actor: "a" }>>;
  finish: Actor.Method<undefined, Readonly<{ finished: number }>>;
  status: Actor.Read<undefined, Readonly<{ finished: number }>>;
};
type CycleBMethods = {
  ping: Actor.Method<undefined, Readonly<{ actor: "b" }>>;
  pingAccepted: Actor.Method<undefined, Readonly<{ actor: "b" }>>;
};
type CycleAModel = Actor<{
  Name: "cycleA";
  Key: string;
  State: { finished: number };
  Dependencies: { cycleB: Actor.Reference<{ Key: string; Methods: CycleBMethods }> };
  Methods: CycleAMethods;
}>;
type CycleBModel = Actor<{
  Name: "cycleB";
  Key: string;
  State: Record<never, never>;
  Dependencies: { cycleA: Actor.Reference<{ Key: string; Methods: CycleAMethods }> };
  Methods: CycleBMethods;
}>;

const cycleA = createActor<CycleAModel>({
  state: (_context) => ({ finished: 0 }),
  methods: {
    async ping({ key, dependencies }) {
      await dependencies.cycleB.get({ key }).ping();
      return { actor: "a" as const };
    },
    async pingAccepted({ key, dependencies }) {
      await dependencies.cycleB.get({ key }).pingAccepted();
      return { actor: "a" as const };
    },
    finish({ state }) {
      state.finished += 1;
      return { finished: state.finished };
    },
    status({ state }) {
      return { finished: state.finished };
    },
  },
});

const cycleB = createActor<CycleBModel>({
  state: (_context) => ({}),
  methods: {
    async ping({ key, dependencies }) {
      await dependencies.cycleA.get({ key }).finish();
      return { actor: "b" as const };
    },
    async pingAccepted({ key, dependencies }) {
      await dependencies.cycleA.get({ key }).finish({ wait: "accepted" });
      return { actor: "b" as const };
    },
  },
});

const actorSystem = createSystem({
  features: {
    account,
    cycleA,
    cycleB,
    document,
    inventory,
    ledger,
    reminder,
  },
});
export default actorSystem;
type ActorSystemContract = SystemContractOf<typeof actorSystem>;
type MountedAccount = ActorSystemContract["Features"]["account"];
type MountedInventory = ActorSystemContract["Features"]["inventory"];
type AccountMountProof = MountedAccount extends AccountFeatureContract ? true : false;
type InventoryMountProof = MountedInventory extends InventoryFeatureContract ? true : false;
const accountMountProof: AccountMountProof = true;
const inventoryMountProof: InventoryMountProof = true;
void accountMountProof;
void inventoryMountProof;
