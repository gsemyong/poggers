import type { Dependency } from "@/core/dependency";
import type { FeatureContractOf } from "@/core/feature";
import { createSystem, type SystemContractOf } from "@/core/system";
import {
  type Actor,
  ActorError,
  type ActorInvocation,
  type ActorModelDefinition,
  createActor,
  type DefinedActor,
} from "@/features/actor";

type MaybePromise<Value> = Value | PromiseLike<Value>;
type Procedure = (context: never) => object | PromiseLike<object>;
type Procedures = Readonly<Record<string, Procedure>>;
type ActorModel = ActorModelDefinition;
type ActorInitialContext<Model extends ActorModel> = Actor.Initial<Model>;
type ActorCommandContext<
  Model extends ActorModelDefinition,
  Input extends object | undefined,
  Failures extends Readonly<Record<string, object>> = Record<never, never>,
> = Actor.Command<Model, Input, Failures>;
type ActorQueryContext<
  Model extends ActorModelDefinition,
  Input extends object | undefined,
> = Actor.Query<Model, Input>;

type GenericActorImplementation = Readonly<{
  state: Procedure;
  commands: Procedures;
  queries: Procedures;
}>;

type ActorDependencyReference<Definition extends GenericActorImplementation> = Actor.Reference<
  DefinedActor<Definition>
>;

type InventoryModel = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
}>;

const inventory = createActor({
  state: (_context: Actor.Initial<InventoryModel>): InventoryModel["State"] => ({
    available: 10,
  }),
  commands: {
    reserve({
      state,
      input,
      fail,
    }: Actor.Command<
      InventoryModel,
      Readonly<{ quantity: number }>,
      Readonly<{ unavailable: { available: number } }>
    >) {
      if (input.quantity > state.available) {
        fail({ type: "unavailable", data: { available: state.available } });
      }
      state.available -= input.quantity;
      return { remaining: state.available };
    },
  },
  queries: {
    availability({ state }: Actor.Query<InventoryModel>) {
      return { available: state.available };
    },
  },
} satisfies Actor.Definition<InventoryModel>);

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
}>;

const account = createActor({
  state({ key }: Actor.Initial<AccountModel>) {
    key satisfies string;
    return { balance: 0 } satisfies AccountModel["State"];
  },
  commands: {
    deposit({ state, input }: Actor.Command<AccountModel, Readonly<{ amount: number }>>) {
      state.balance += input.amount;
      return { balance: state.balance };
    },
    async purchase({
      key,
      state,
      input,
      dependencies,
      fail,
      invocation,
    }: Actor.Command<
      AccountModel,
      Readonly<{ item: string; quantity: number; amount: number }>,
      Readonly<{ insufficientFunds: { balance: number } }>
    >) {
      if (input.amount > state.balance) {
        fail({ type: "insufficientFunds", data: { balance: state.balance } });
      }
      state.balance -= input.amount;
      const receipt = await dependencies.payments.charge({
        account: key,
        amount: input.amount,
        idempotencyKey: `${invocation.id}:payment`,
      });
      const reservation = await dependencies.inventory.reserve({
        key: input.item,
        input: { quantity: input.quantity },
        wait: "accepted",
        idempotencyKey: `${invocation.id}:inventory`,
      });
      state.receipt = receipt.receipt;
      return { balance: state.balance, reservation: reservation.id };
    },
  },
  queries: {
    balance({ state }: Actor.Query<AccountModel>) {
      return { balance: state.balance };
    },
  },
} satisfies Actor.Definition<AccountModel>);

type LedgerStateV1 = Readonly<{ balance: number }>;
type LedgerCreditV1 = Readonly<{ amount: number }>;
type LedgerModel = Actor<{
  Name: "ledger";
  Key: string;
  State: { balance: number; revision: number };
}>;
const ledger = createActor({
  state: (_context: Actor.Initial<LedgerModel>): LedgerModel["State"] => ({
    balance: 0,
    revision: 0,
  }),
  commands: {
    credit({
      state,
      input,
      fail,
    }: Actor.Command<
      LedgerModel,
      Readonly<{ amount: number; expectedRevision: number }>,
      Readonly<{ conflict: { actualRevision: number } }>
    >) {
      if (input.expectedRevision !== state.revision) {
        fail({ type: "conflict", data: { actualRevision: state.revision } });
      }
      state.balance += input.amount;
      state.revision += 1;
      return { balance: state.balance, revision: state.revision };
    },
  },
  queries: {
    snapshot({ state }: Actor.Query<LedgerModel>) {
      return { ...state };
    },
  },
  migrations: {
    state: [
      (({ state }) => ({
        balance: state.balance,
        revision: 0,
      })) satisfies Actor.StateMigration<LedgerStateV1, LedgerModel["State"]>,
    ],
    commands: {
      credit: [
        (({ input }) => ({
          amount: input.amount,
          expectedRevision: 0,
        })) satisfies Actor.CommandMigration<
          LedgerCreditV1,
          { amount: number; expectedRevision: number }
        >,
      ],
    },
  },
} satisfies Actor.Definition<LedgerModel>);

type AccountFeatureContract = FeatureContractOf<typeof account>;
type InventoryFeatureContract = FeatureContractOf<typeof inventory>;
type AccountServer = AccountFeatureContract["Programs"]["server"];
declare const accountRequirements: AccountServer["Requires"];
accountRequirements.payments satisfies Payments;
accountRequirements.inventory satisfies Actor.Reference<typeof inventory>;
declare const accountProvision: AccountServer["Provides"];
accountProvision.account satisfies Actor.Reference<typeof account>;

declare const accountClient: Actor.Reference<typeof account>;
accountClient.deposit({
  key: "account-1",
  input: { amount: 10 },
}) satisfies Promise<Actor.Outcome<{ balance: number }>>;
accountClient.deposit({
  key: "account-1",
  input: { amount: 10 },
  wait: "accepted",
  idempotencyKey: "deposit-1",
}) satisfies Promise<ActorInvocation>;
accountClient.purchase({
  key: "account-1",
  input: { item: "item-1", quantity: 1, amount: 5 },
}) satisfies Promise<
  Actor.Outcome<
    { balance: number; reservation: string },
    Readonly<{ type: "insufficientFunds"; data: { balance: number } }>
  >
>;
accountClient.balance({ key: "account-1" }) satisfies Promise<{ balance: number }>;

async function inspectActorInfrastructureFailure() {
  try {
    await accountClient.deposit({ key: "account-1", input: { amount: 10 } });
  } catch (error) {
    if (error instanceof ActorError) {
      error.failure satisfies Actor.Failure;
    }
  }
}
void inspectActorInfrastructureFailure;

async function inspectAcceptedInvocation() {
  const invocation = await accountClient.deposit({
    key: "account-1",
    input: { amount: 10 },
    wait: "accepted",
  });
  invocation.id satisfies string;
}
void inspectAcceptedInvocation;

// @ts-expect-error Definitions are mounted; only injected references are callable.
account({ key: "account-1" });
// @ts-expect-error Command input is inferred from its one implementation.
accountClient.deposit({ key: "account-1", input: { amount: "ten" } });
// @ts-expect-error Actor keys retain their declared type.
accountClient.deposit({ key: 1, input: { amount: 10 } });
// @ts-expect-error No-input queries have a closed request shape.
accountClient.balance({ key: "account-1", input: { currency: "EUR" } });

type LanguageModel = Dependency<{
  Operations: {
    answer(
      input: Readonly<{ conversation: readonly string[]; prompt: string }>,
    ): Promise<Readonly<{ text: string; tool?: Readonly<{ name: string; input: string }> }>>;
  };
}>;
type Tools = Dependency<{
  Operations: {
    execute(
      input: Readonly<{ name: string; input: string }>,
    ): Promise<Readonly<{ output: string }>>;
  };
}>;
type AgentModel = Actor<{
  Name: "agent";
  Key: string;
  State: {
    status: "ready" | "approval";
    conversation: readonly string[];
    tool: Readonly<{ name: string; input: string }> | undefined;
  };
  Dependencies: { language: LanguageModel; tools: Tools };
}>;

const agent = createActor({
  state: (_context: Actor.Initial<AgentModel>): AgentModel["State"] => ({
    status: "ready",
    conversation: [],
    tool: undefined,
  }),
  commands: {
    async ask({
      state,
      input,
      dependencies,
    }: Actor.Command<AgentModel, Readonly<{ prompt: string }>>) {
      if (state.status !== "ready") return { status: "awaitingApproval" as const };
      const answer = await dependencies.language.answer({
        conversation: state.conversation,
        prompt: input.prompt,
      });
      const conversation: string[] = [];
      for (const message of state.conversation) conversation.push(message);
      conversation.push(input.prompt);
      conversation.push(answer.text);
      state.conversation = conversation;
      if (answer.tool) {
        state.status = "approval";
        state.tool = answer.tool;
      }
      return { status: state.status };
    },
    async approve({ state, dependencies }: Actor.Command<AgentModel>) {
      if (state.status !== "approval" || !state.tool) return { status: state.status };
      const result = await dependencies.tools.execute(state.tool);
      const conversation: string[] = [];
      for (const message of state.conversation) conversation.push(message);
      conversation.push(result.output);
      state.conversation = conversation;
      state.status = "ready";
      state.tool = undefined;
      return { status: state.status };
    },
    cancel({ state }: Actor.Command<AgentModel>) {
      if (state.status === "approval") {
        state.status = "ready";
        state.tool = undefined;
      }
      return { status: state.status };
    },
  },
  queries: {
    status({ state }: Actor.Query<AgentModel>) {
      return state;
    },
  },
} satisfies Actor.Definition<AgentModel>);

declare const agentClient: Actor.Reference<typeof agent>;
agentClient.ask({ key: "agent-1", input: { prompt: "Plan a release" } });
agentClient.approve({ key: "agent-1" });
agentClient.cancel({ key: "agent-1" });
agentClient.status({ key: "agent-1" });

type ReminderModel = Actor<{
  Name: "reminder";
  Key: string;
  State: { due: number | null; fired: number };
}>;

type ForeignReminderModel = Actor<{
  Name: "foreign-reminder";
  Key: string;
  State: { fired: number };
}>;

const fireForeignReminder = ({ state }: Actor.Command<ForeignReminderModel>) => {
  state.fired += 1;
  return { fired: state.fired };
};

type ReminderWakeInput = Readonly<{
  generation: number;
  at: number;
  interval: number;
  remaining: number;
}>;
type ReminderWake = (
  context: Actor.Command<ReminderModel, ReminderWakeInput>,
) => Readonly<{ fired: number }>;

const wakeReminder: ReminderWake = ({ state, input, timers }) => {
  state.fired += 1;
  if (input.remaining > 1) {
    const nextAt = input.at + input.interval;
    state.due = nextAt;
    timers.schedule({
      id: "wake",
      at: nextAt,
      command: wakeReminder,
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

const reminderCommands = {
  wake: wakeReminder,
  schedule({
    state,
    input,
    timers,
  }: Actor.Command<ReminderModel, Readonly<{ at: number; generation: number }>>) {
    state.due = input.at;
    if (input.generation < 0) {
      // @ts-expect-error A timer cannot target a command from another Actor model.
      timers.schedule({
        id: "foreign",
        at: input.at,
        command: fireForeignReminder,
        input: undefined,
      });
    }
    timers.schedule({
      id: "wake",
      at: input.at,
      command: wakeReminder,
      input: {
        generation: input.generation,
        at: input.at,
        interval: 0,
        remaining: 1,
      },
    });
    return { due: state.due };
  },
  repeat({
    state,
    input,
    timers,
  }: Actor.Command<
    ReminderModel,
    Readonly<{ at: number; interval: number; count: number; generation: number }>
  >) {
    state.due = input.at;
    timers.schedule({
      id: "wake",
      at: input.at,
      command: wakeReminder,
      input: {
        generation: input.generation,
        at: input.at,
        interval: input.interval,
        remaining: input.count,
      },
    });
    return { due: state.due };
  },
  cancel({ state, timers }: Actor.Command<ReminderModel>) {
    timers.cancel({ id: "wake" });
    state.due = null;
    return { cancelled: true };
  },
};

const reminder = createActor({
  state: (_context: Actor.Initial<ReminderModel>): ReminderModel["State"] => ({
    due: null,
    fired: 0,
  }),
  commands: reminderCommands,
  queries: {
    status({ state }: Actor.Query<ReminderModel>) {
      return state;
    },
  },
} satisfies Actor.Definition<ReminderModel>);

declare const reminderClient: Actor.Reference<typeof reminder>;
reminderClient.schedule({
  key: "reminder-1",
  input: { at: 1_000, generation: 1 },
});
reminderClient.repeat({
  key: "reminder-1",
  input: { at: 1_000, interval: 100, count: 3, generation: 1 },
});
reminderClient.cancel({ key: "reminder-1" });

type DocumentModel = Actor<{
  Name: "document";
  Key: string;
  State: { owner?: string; content: string; revision: number };
}>;
type DocumentStateV1 = Readonly<{ content: string }>;
type DocumentEditV1 = Readonly<{ content: string }>;
type DocumentEdit = Readonly<{ content: string; expectedRevision: number }>;

const document = createActor({
  state: (_context: Actor.Initial<DocumentModel>): DocumentModel["State"] => ({
    content: "",
    revision: 0,
  }),
  commands: {
    create({
      state,
      input,
      fail,
    }: Actor.Command<
      DocumentModel,
      Readonly<{ owner: string; content: string }>,
      Readonly<{ alreadyExists: { owner: string } }>
    >) {
      if (state.owner) fail({ type: "alreadyExists", data: { owner: state.owner } });
      state.owner = input.owner;
      state.content = input.content;
      state.revision += 1;
      return { revision: state.revision };
    },
    edit({
      state,
      input,
      fail,
    }: Actor.Command<
      DocumentModel,
      DocumentEdit,
      Readonly<{
        notCreated: Record<never, never>;
        conflict: { actualRevision: number };
      }>
    >) {
      if (!state.owner) fail({ type: "notCreated", data: {} });
      if (input.expectedRevision !== state.revision) {
        fail({ type: "conflict", data: { actualRevision: state.revision } });
      }
      state.content = input.content;
      state.revision += 1;
      return { revision: state.revision };
    },
  },
  queries: {
    snapshot({ state }: Actor.Query<DocumentModel>) {
      return { ...state };
    },
  },
  migrations: {
    state: [
      (({ state }) => ({
        content: state.content,
        revision: 0,
      })) satisfies Actor.StateMigration<DocumentStateV1, DocumentModel["State"]>,
    ],
    commands: {
      edit: [
        (({ input }) => ({
          content: input.content,
          expectedRevision: 0,
        })) satisfies Actor.CommandMigration<DocumentEditV1, DocumentEdit>,
      ],
    },
  },
} satisfies Actor.Definition<DocumentModel>);

declare const documentClient: Actor.Reference<typeof document>;
documentClient.create({
  key: "document-1",
  input: { owner: "user-1", content: "Initial" },
});
documentClient.edit({
  key: "document-1",
  input: { content: "Edited", expectedRevision: 1 },
});
documentClient.snapshot({ key: "document-1" });

const invalidMigrationTarget = {
  state: (_context: Actor.Initial<ReminderModel>): ReminderModel["State"] => ({
    due: null,
    fired: 0,
  }),
  commands: reminderCommands,
  queries: {},
  migrations: { commands: { missing: [] } },
} satisfies Actor.Definition<ReminderModel>;
// @ts-expect-error A migration must target a command owned by this Actor.
createActor(invalidMigrationTarget);

const invalidOperationCollision = {
  state: (_context: Actor.Initial<ReminderModel>): ReminderModel["State"] => ({
    due: null,
    fired: 0,
  }),
  commands: {
    status(_context: Actor.Command<ReminderModel>) {
      return { fired: 0 };
    },
  },
  queries: {
    status(_context: Actor.Query<ReminderModel>) {
      return { fired: 0 };
    },
  },
} satisfies Actor.Definition<ReminderModel>;
// @ts-expect-error One operation name cannot be both a command and a query.
createActor(invalidOperationCollision);

type CycleRequest = Readonly<{
  key: string;
  input?: Readonly<{}>;
  idempotencyKey?: string;
}> &
  (Readonly<{ wait?: "completed" }> | Readonly<{ wait: "accepted" }>);
type CycleAReference = Dependency<{
  Operations: {
    ping(request: CycleRequest): Promise<Actor.Outcome<Readonly<{ actor: "a" }>> | ActorInvocation>;
    pingAccepted(
      request: CycleRequest,
    ): Promise<Actor.Outcome<Readonly<{ actor: "a" }>> | ActorInvocation>;
    finish(
      request: CycleRequest,
    ): Promise<Actor.Outcome<Readonly<{ finished: number }>> | ActorInvocation>;
    status(
      request: Readonly<{ key: string; input?: Readonly<{}> }>,
    ): Promise<Readonly<{ finished: number }>>;
  };
}>;
type CycleBReference = Dependency<{
  Operations: {
    ping(request: CycleRequest): Promise<Actor.Outcome<Readonly<{ actor: "b" }>> | ActorInvocation>;
    pingAccepted(
      request: CycleRequest,
    ): Promise<Actor.Outcome<Readonly<{ actor: "b" }>> | ActorInvocation>;
  };
}>;
type CycleAModel = Actor<{
  Name: "cycleA";
  Key: string;
  State: { finished: number };
  Dependencies: { cycleB: CycleBReference };
}>;
type CycleBModel = Actor<{
  Name: "cycleB";
  Key: string;
  State: Record<never, never>;
  Dependencies: { cycleA: CycleAReference };
}>;

const cycleA = createActor({
  state: (_context: Actor.Initial<CycleAModel>): CycleAModel["State"] => ({ finished: 0 }),
  commands: {
    async ping({ key, dependencies }: Actor.Command<CycleAModel>) {
      await dependencies.cycleB.ping({ key });
      return { actor: "a" as const };
    },
    async pingAccepted({ key, dependencies }: Actor.Command<CycleAModel>) {
      await dependencies.cycleB.pingAccepted({ key });
      return { actor: "a" as const };
    },
    finish({ state }: Actor.Command<CycleAModel>) {
      state.finished += 1;
      return { finished: state.finished };
    },
  },
  queries: {
    status({ state }: Actor.Query<CycleAModel>) {
      return { finished: state.finished };
    },
  },
} satisfies Actor.Definition<CycleAModel>);

const cycleB = createActor({
  state: (_context: Actor.Initial<CycleBModel>): CycleBModel["State"] => ({}),
  commands: {
    async ping({ key, dependencies }: Actor.Command<CycleBModel>) {
      await dependencies.cycleA.finish({ key });
      return { actor: "b" as const };
    },
    async pingAccepted({ key, dependencies }: Actor.Command<CycleBModel>) {
      await dependencies.cycleA.finish({ key, wait: "accepted" });
      return { actor: "b" as const };
    },
  },
  queries: {},
} satisfies Actor.Definition<CycleBModel>);

const actorSystem = createSystem({
  features: { account, agent, cycleA, cycleB, document, inventory, ledger, reminder },
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

/**
 * A1 comparison candidate: a type-first protocol supplies complete recursive
 * context but repeats every operation name in type and value positions.
 */
type TypeFirstOperation<Input, Result, Failures = never> = Readonly<{
  Input: Input;
  Result: Result;
  Failures: Failures;
}>;
type TypeFirstInput<Operation> =
  Operation extends TypeFirstOperation<infer Input, unknown, unknown> ? Input : never;
type TypeFirstResult<Operation> =
  Operation extends TypeFirstOperation<unknown, infer Result, unknown> ? Result : never;

type TypeFirstActor = Readonly<{
  Key: string;
  State: { balance: number };
  Dependencies: Record<never, never>;
  Commands: {
    deposit: TypeFirstOperation<{ amount: number }, { balance: number }>;
  };
  Queries: {
    balance: TypeFirstOperation<Record<never, never>, { balance: number }>;
  };
}>;

type TypeFirstDefinition<Contract extends TypeFirstActor> = Readonly<{
  state(context: Readonly<{ key: Contract["Key"] }>): Contract["State"];
  commands: {
    readonly [Name in keyof Contract["Commands"]]: (
      context: Readonly<{
        state: Contract["State"];
        input: TypeFirstInput<Contract["Commands"][Name]>;
      }>,
    ) => MaybePromise<TypeFirstResult<Contract["Commands"][Name]>>;
  };
  queries: {
    readonly [Name in keyof Contract["Queries"]]: (
      context: Readonly<{
        state: Readonly<Contract["State"]>;
        input: TypeFirstInput<Contract["Queries"][Name]>;
      }>,
    ) => MaybePromise<TypeFirstResult<Contract["Queries"][Name]>>;
  };
}>;

declare function typeFirstActor<Contract extends TypeFirstActor>(
  definition: TypeFirstDefinition<Contract>,
): void;

typeFirstActor<TypeFirstActor>({
  state: () => ({ balance: 0 }),
  commands: {
    deposit({ state, input }) {
      state.balance += input.amount;
      return { balance: state.balance };
    },
  },
  queries: {
    balance: ({ state }) => ({ balance: state.balance }),
  },
});

/**
 * A1 comparison candidate: scoped helpers author names once and avoid repeated
 * context annotations, but require a curried model factory and one wrapper per
 * operation.
 */
type HelperOperation = Readonly<{
  Input: object | undefined;
  Result: object;
  Failures?: Readonly<Record<string, object>>;
}>;
type HelperFailures<Operation extends HelperOperation> = Operation extends {
  Failures: infer Failures extends Readonly<Record<string, object>>;
}
  ? Failures
  : Record<never, never>;

type HelperLanguage<Model extends ActorModel> = Readonly<{
  command<Operation extends HelperOperation>(
    handler: (
      context: ActorCommandContext<Model, Operation["Input"], HelperFailures<Operation>>,
    ) => MaybePromise<Operation["Result"]>,
  ): (
    context: ActorCommandContext<Model, Operation["Input"], HelperFailures<Operation>>,
  ) => MaybePromise<Operation["Result"]>;
  query<Operation extends HelperOperation>(
    handler: (
      context: ActorQueryContext<Model, Operation["Input"]>,
    ) => MaybePromise<Operation["Result"]>,
  ): (context: ActorQueryContext<Model, Operation["Input"]>) => MaybePromise<Operation["Result"]>;
}>;

declare function helperActor<Model extends ActorModel>(): <
  const Definition extends GenericActorImplementation,
>(
  define: (language: HelperLanguage<Model>) => Definition,
) => ActorDependencyReference<Definition>;

const helperAccount = helperActor<AccountModel>()(({ command, query }) => ({
  state: ({ key }: ActorInitialContext<AccountModel>) => {
    key satisfies string;
    return { balance: 0 };
  },
  commands: {
    deposit: command<{
      Input: Readonly<{ amount: number }>;
      Result: Readonly<{ balance: number }>;
    }>(({ state, input }) => {
      state.balance += input.amount;
      return { balance: state.balance };
    }),
  },
  queries: {
    balance: query<{
      Input: undefined;
      Result: Readonly<{ balance: number }>;
    }>(({ state }) => ({ balance: state.balance })),
  },
}));

helperAccount.deposit({
  key: "account-1",
  input: { amount: 10 },
}) satisfies Promise<Actor.Outcome<{ balance: number }>>;

/**
 * A1 comparison candidate: a class can author operation names once, but it
 * requires inheritance and runtime wrappers to classify methods. Those
 * constructs are outside the current portable TypeScript subset.
 */
declare abstract class ActorClass<Model extends ActorModel> {
  abstract state(context: ActorInitialContext<Model>): Model["State"];
  protected command<Operation extends HelperOperation>(
    handler: (
      context: ActorCommandContext<Model, Operation["Input"], HelperFailures<Operation>>,
    ) => MaybePromise<Operation["Result"]>,
  ): unknown;
  protected query<Operation extends HelperOperation>(
    handler: (
      context: ActorQueryContext<Model, Operation["Input"]>,
    ) => MaybePromise<Operation["Result"]>,
  ): unknown;
}

class ClassAccount extends ActorClass<AccountModel> {
  override state(): AccountModel["State"] {
    return { balance: 0 };
  }

  deposit = this.command<{
    Input: Readonly<{ amount: number }>;
    Result: Readonly<{ balance: number }>;
  }>(({ state, input }) => {
    state.balance += input.amount;
    return { balance: state.balance };
  });

  balance = this.query<{
    Input: undefined;
    Result: Readonly<{ balance: number }>;
  }>(({ state }) => ({ balance: state.balance }));
}

void ClassAccount;
