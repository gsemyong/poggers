import { cloneData, equalData } from "@/core/data";
import {
  createDeferredDependencyInvocation,
  DependencyFailureError,
  dependencyInvocationControl,
  isDeferredDependencyInvocation,
  invokeDependency,
  type DeferredDependencyInvocation,
  type DependencyContract,
  type DependencyDefinitionOf,
} from "@/core/dependency";
import type { Feature } from "@/core/feature";
import { typeLiteral, typeSchema, type TypeSchema } from "@/core/intrinsic";
import type { Program } from "@/core/program";
import type { Clock, EventStore, Identifiers, StoredEvent } from "@/features/entity";
import type { ServerProcess, Timer } from "@/platforms/server/platform";

type MaybePromise<Value> = Value | PromiseLike<Value>;
type Procedure = (input: never) => unknown;
type AsyncProcedure = (input: never) => PromiseLike<unknown>;
type Procedures = Readonly<Record<string, Procedure>>;
type DependencyOperations = Readonly<Record<string, AsyncProcedure>>;
type Dependencies = Readonly<Record<string, DependencyContract | DependencyOperations>>;
type InputOf<Operation> = Operation extends (input: infer Input) => unknown ? Input : never;
type OutputOf<Operation> = Operation extends (...arguments_: never[]) => infer Output
  ? Awaited<Output>
  : never;
type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type OperationsOf<Api> = Api extends DependencyContract
  ? DependencyDefinitionOf<Api>["Operations"]
  : Extract<Api, DependencyOperations>;
type WorkflowDependencies<Model extends WorkflowModelDefinition> = Readonly<{
  [Name in keyof Model["Dependencies"]]: OperationsOf<Model["Dependencies"][Name]>;
}>;
type StateOf<Model extends WorkflowModelDefinition> = Model["State"];
type SignalOf<Model extends WorkflowModelDefinition> = Extract<keyof Model["Signals"], string>;
declare const workflowModel: unique symbol;
export const workflowImplementation: unique symbol = Symbol("kit.workflow.implementation");
const stopped = Symbol("workflow.stopped");
const workflowLeaseDuration = 30_000;
export const WORKFLOW_DEFINITION_VERSION = 1 as const;
export const WORKFLOW_PROTOCOL_VERSION = 9 as const;

export type WorkflowModelDefinition = Readonly<{
  Name: string;
  Input: object;
  Result: unknown;
  State: object;
  Dependencies: Dependencies;
  Signals: Procedures;
  Queries: Procedures;
  Failures?: Readonly<Record<string, object>>;
}>;

/** Validates and preserves the semantic definition consumed by the workflow factory. */
export type WorkflowModel<Definition extends WorkflowModelDefinition> = Readonly<Definition>;

export type WorkflowStatus = "running" | "completed" | "failed" | "cancelled";

export type WorkflowExecution = Readonly<{ id: string; run: string }>;

export type WorkflowExecutionSelector = WorkflowExecution | Readonly<{ id: string; run?: never }>;

type WorkflowFailuresOf<Model extends WorkflowModelDefinition> =
  Model extends Readonly<{
    Failures: infer Failures extends Readonly<Record<string, object>>;
  }>
    ? Failures
    : Readonly<Record<never, never>>;

type DependencyFailureData<Api> = Api extends DependencyContract
  ? DependencyDefinitionOf<Api> extends Readonly<{
      Failures: infer Failures extends Readonly<Record<string, object>>;
    }>
    ? Failures[keyof Failures]
    : never
  : never;

type WorkflowFailureData<Model extends WorkflowModelDefinition> =
  | WorkflowFailuresOf<Model>[keyof WorkflowFailuresOf<Model>]
  | {
      [Name in keyof Model["Dependencies"]]: DependencyFailureData<Model["Dependencies"][Name]>;
    }[keyof Model["Dependencies"]];

export type WorkflowError<Data = never> = Readonly<{
  name: string;
  message: string;
}> &
  ([Data] extends [never] ? unknown : Readonly<{ data?: Data }>);

export type WorkflowSnapshot<Model extends WorkflowModelDefinition> = Readonly<{
  execution: WorkflowExecution;
  revision: number;
  status: WorkflowStatus;
  state: Readonly<StateOf<Model>>;
  result?: Model["Result"];
  error?: WorkflowError<WorkflowFailureData<Model>>;
}>;

type FailureNameOf<Api> = Api extends DependencyContract
  ? Extract<keyof DependencyDefinitionOf<Api>["Failures"], string>
  : string;

export type WorkflowActivityRetry<Failure extends string = string> = Readonly<{
  attempts: number;
  delay?: number;
  maximumDelay?: number;
  factor?: number;
  nonRetryable?: readonly Failure[];
}>;

export type WorkflowActivityTimeout =
  | Readonly<{
      attempt: number;
      total?: number;
      queue?: number;
      heartbeat?: number;
    }>
  | Readonly<{
      attempt?: number;
      total: number;
      queue?: number;
      heartbeat?: number;
    }>;

export type WorkflowActivityPolicy<Failure extends string = string> = Readonly<{
  timeout: WorkflowActivityTimeout;
  retry?: WorkflowActivityRetry<Failure>;
}>;

export type WorkflowActivityPolicies<Model extends WorkflowModelDefinition> = {
  readonly [Dependency in keyof Model["Dependencies"]]: {
    readonly [Operation in keyof OperationsOf<
      Model["Dependencies"][Dependency]
    >]: WorkflowActivityPolicy<FailureNameOf<Model["Dependencies"][Dependency]>>;
  };
};

type WorkflowActivityConfiguration<Model extends WorkflowModelDefinition> =
  keyof Model["Dependencies"] extends never
    ? Readonly<{ activities?: never }>
    : Readonly<{ activities: WorkflowActivityPolicies<Model> }>;

export type WorkflowSleep = Readonly<
  { duration: number; deadline?: never } | { deadline: number; duration?: never }
>;

export type WorkflowWait = Readonly<{
  condition(): boolean;
  timeout?: number;
}>;

export type WorkflowCancellationBranch<Value> = Readonly<{
  cancel(input: Readonly<{ reason?: string }>): void;
  result(): Promise<Awaited<Value>>;
}>;

export type WorkflowCancellation<Model extends WorkflowModelDefinition> = Readonly<{
  requested(): boolean;
  start<Value>(
    input: Readonly<{
      propagation: "inherit" | "shield";
      timeout?: number;
      execute(context: WorkflowExecutionContext<Model>): MaybePromise<Value>;
    }>,
  ): WorkflowCancellationBranch<Value>;
}>;

export type WorkflowExecutionContext<Model extends WorkflowModelDefinition> = Readonly<{
  input: Model["Input"];
  dependencies: WorkflowDependencies<Model>;
  state: Mutable<StateOf<Model>>;
  time: Readonly<{ now(): number }>;
  sleep(input: WorkflowSleep): Promise<void>;
  wait(input: WorkflowWait): Promise<boolean>;
  cancellation: WorkflowCancellation<Model>;
}>;

type SignalImplementations<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Signals"]]: (
    context: Readonly<{
      state: Mutable<StateOf<Model>>;
      input: InputOf<Model["Signals"][Name]>;
    }>,
  ) => void;
};

type QueryImplementations<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Queries"]]: (
    context: Readonly<{
      state: Readonly<StateOf<Model>>;
      input: InputOf<Model["Queries"][Name]>;
    }>,
  ) => OutputOf<Model["Queries"][Name]>;
};

export type WorkflowImplementation<Model extends WorkflowModelDefinition> = Readonly<{
  state(context: Readonly<{ input: Model["Input"] }>): StateOf<Model>;
  execute(context: WorkflowExecutionContext<Model>): MaybePromise<Model["Result"]>;
  signals: SignalImplementations<Model>;
  queries: QueryImplementations<Model>;
}> &
  WorkflowActivityConfiguration<Model>;

/** Compiler-materialized, target-neutral meaning consumed by every runtime. */
export type WorkflowDefinition<Model extends WorkflowModelDefinition> = Readonly<{
  version: typeof WORKFLOW_DEFINITION_VERSION;
  protocolVersion: typeof WORKFLOW_PROTOCOL_VERSION;
  name: Model["Name"];
  schemas: Readonly<{
    input: TypeSchema;
    result: TypeSchema;
    state: TypeSchema;
    dependencies: TypeSchema;
    signals: TypeSchema;
    queries: TypeSchema;
    failures: TypeSchema;
  }>;
}>;

type WorkflowInvocation<Input> = Readonly<{ id: string; input: Input }>;

type WorkflowSignalApi<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Signals"]]: (
    input: Readonly<{
      execution: WorkflowExecutionSelector;
      input: InputOf<Model["Signals"][Name]>;
    }>,
  ) => Promise<WorkflowExecution>;
};

type WorkflowQueryApi<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Queries"]]: (
    input: Readonly<{
      execution: WorkflowExecutionSelector;
      input: InputOf<Model["Queries"][Name]>;
      consistency: "eventual" | "current";
    }>,
  ) => Promise<OutputOf<Model["Queries"][Name]>>;
};

export type WorkflowApi<Model extends WorkflowModelDefinition> = Readonly<{
  start(input: WorkflowInvocation<Model["Input"]>): Promise<WorkflowExecution>;
  describe(input: { execution: WorkflowExecutionSelector }): Promise<WorkflowSnapshot<Model>>;
  result(input: {
    execution: WorkflowExecutionSelector;
    follow: "run" | "chain";
  }): Promise<Model["Result"]>;
  cancel(input: { execution: WorkflowExecutionSelector; reason?: string }): Promise<void>;
  watch(input: { execution: WorkflowExecutionSelector }): AsyncIterable<WorkflowSnapshot<Model>>;
  activities: Readonly<{
    complete<Result, Failure, Heartbeat>(input: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      result: NoInfer<Result>;
    }): Promise<void>;
    fail<Result, Failure, Heartbeat>(input: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      failure: NoInfer<Failure>;
    }): Promise<void>;
    heartbeat<Result, Failure, Heartbeat>(input: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      details: NoInfer<Heartbeat>;
    }): Promise<void>;
  }>;
  signal: Readonly<WorkflowSignalApi<Model>>;
  query: Readonly<WorkflowQueryApi<Model>>;
}>;

/**
 * Host timer used by durable workflows. A resumed workflow calls the same
 * deadline again, so the implementation must resolve immediately once it has
 * passed.
 */
export type WorkflowTimer = Timer;

/**
 * Private host boundary for workflow orchestration. Feature authors never
 * configure or call it; server adapters realize it for development or native
 * production.
 */
export type WorkflowRuntime = Readonly<{
  create(input: object): Promise<object>;
}>;

type DependencyCall<Model extends WorkflowModelDefinition> = {
  [Dependency in keyof Model["Dependencies"]]: {
    [Operation in keyof OperationsOf<Model["Dependencies"][Dependency]>]: Readonly<{
      dependency: Extract<Dependency, string>;
      operation: Extract<Operation, string>;
      input: InputOf<OperationsOf<Model["Dependencies"][Dependency]>[Operation]>;
      result?: OutputOf<OperationsOf<Model["Dependencies"][Dependency]>[Operation]>;
    }>;
  }[keyof OperationsOf<Model["Dependencies"][Dependency]>];
}[keyof Model["Dependencies"]];

type WorkflowActivityPolicySnapshot = Readonly<{
  timeout: Readonly<{
    attempt: number | null;
    total: number | null;
    queue: number | null;
    heartbeat: number | null;
  }>;
  retry: Readonly<{
    attempts: number;
    delay: number;
    factor: number;
    maximumDelay: number | null;
    nonRetryable: readonly string[];
  }>;
}>;

type WorkflowActivityScheduledEvent<Model extends WorkflowModelDefinition> = Readonly<{
  type: "workflow.activity.scheduled";
  sequence: number;
  id: string;
  policy: WorkflowActivityPolicySnapshot;
  at: number;
}> &
  Omit<DependencyCall<Model>, "result">;

type SignalCall<Model extends WorkflowModelDefinition> = {
  [Name in keyof Model["Signals"]]: Readonly<{
    name: Extract<Name, string>;
    input: InputOf<Model["Signals"][Name]>;
  }>;
}[keyof Model["Signals"]];

type WorkflowStartedEvent<Model extends WorkflowModelDefinition> = Readonly<{
  type: "workflow.started";
  definitionVersion: typeof WORKFLOW_DEFINITION_VERSION;
  protocolVersion: typeof WORKFLOW_PROTOCOL_VERSION;
  run: string;
  input: Model["Input"];
  state: Readonly<StateOf<Model>>;
  at: number;
}>;

type WorkflowWorkerClaimedEvent = Readonly<{
  type: "workflow.worker.claimed";
  owner: string;
  expiresAt: number;
  at: number;
}>;

type WorkflowCancellationRequestedEvent = Readonly<{
  type: "workflow.cancellation.requested";
  reason?: string;
  at: number;
}>;

type WorkflowActivityAttemptFailedEvent<Model extends WorkflowModelDefinition> = Readonly<{
  type: "workflow.activity.attempt.failed";
  sequence: number;
  attempt: number;
  error: WorkflowError<WorkflowFailureData<Model>>;
  retryAt?: number;
  at: number;
}>;

type WorkflowActivityCompletedEvent<Model extends WorkflowModelDefinition> = Readonly<{
  type: "workflow.activity.completed";
  sequence: number;
  attempt: number;
  result?: DependencyCall<Model>["result"];
  at: number;
}>;

export type WorkflowJournalEvent<Model extends WorkflowModelDefinition> =
  | WorkflowStartedEvent<Model>
  | Readonly<{
      type: "workflow.state";
      state: Readonly<StateOf<Model>>;
      reason: "activity" | "condition" | "signal" | "timer";
      sequence?: number;
      signalRevision?: number;
      at: number;
    }>
  | WorkflowActivityScheduledEvent<Model>
  | Readonly<{
      type: "workflow.activity.attempt.started";
      sequence: number;
      attempt: number;
      at: number;
    }>
  | Readonly<{
      type: "workflow.activity.attempt.abandoned";
      sequence: number;
      attempt: number;
      reason: "worker-lost";
      at: number;
    }>
  | WorkflowActivityAttemptFailedEvent<Model>
  | Readonly<{
      type: "workflow.activity.heartbeat";
      sequence: number;
      attempt: number;
      details: unknown;
      at: number;
    }>
  | Readonly<{
      type: "workflow.activity.deferred";
      sequence: number;
      attempt: number;
      id: string;
      at: number;
    }>
  | WorkflowActivityCompletedEvent<Model>
  | Readonly<{
      type: "workflow.activity.cancelled";
      sequence: number;
      reason?: string;
      at: number;
    }>
  | Readonly<{
      type: "workflow.timer.scheduled";
      sequence: number;
      duration?: number;
      deadline: number;
      at: number;
    }>
  | Readonly<{
      type: "workflow.timer.completed";
      sequence: number;
      at: number;
    }>
  | Readonly<{
      type: "workflow.timer.cancelled";
      sequence: number;
      reason?: string;
      at: number;
    }>
  | Readonly<{
      type: "workflow.condition.scheduled";
      sequence: number;
      timeout?: number;
      deadline?: number;
      at: number;
    }>
  | Readonly<{
      type: "workflow.condition.completed";
      sequence: number;
      outcome: "satisfied" | "timed-out";
      at: number;
    }>
  | Readonly<{
      type: "workflow.condition.cancelled";
      sequence: number;
      reason?: string;
      at: number;
    }>
  | (Readonly<{
      type: "workflow.signal.received";
      boundary: number;
      at: number;
    }> &
      SignalCall<Model>)
  | WorkflowWorkerClaimedEvent
  | Readonly<{
      type: "workflow.worker.released";
      owner: string;
      at: number;
    }>
  | WorkflowCancellationRequestedEvent
  | Readonly<{
      type: "workflow.cancelled";
      reason?: string;
      state: Readonly<StateOf<Model>>;
      at: number;
    }>
  | Readonly<{
      type: "workflow.completed";
      result?: Model["Result"];
      state: Readonly<StateOf<Model>>;
      at: number;
    }>
  | Readonly<{
      type: "workflow.failed";
      error: WorkflowError<WorkflowFailureData<Model>>;
      state: Readonly<StateOf<Model>>;
      at: number;
    }>;

type WorkflowRequirements<Model extends WorkflowModelDefinition> = Model["Dependencies"] &
  Readonly<{
    clock: Clock;
    events: EventStore;
    identifiers: Identifiers;
    timer: WorkflowTimer;
    workflowRuntime: WorkflowRuntime;
  }>;

type WorkflowRuntimeRequirements<Model extends WorkflowModelDefinition> = Omit<
  WorkflowRequirements<Model>,
  "events"
> &
  Readonly<{ events: EventStore<WorkflowJournalEvent<Model>> }>;

type WorkflowProvision<Model extends WorkflowModelDefinition> = Readonly<{
  [Name in Model["Name"]]: WorkflowApi<Model>;
}>;

export type WorkflowFeature<Model extends WorkflowModelDefinition> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: WorkflowRequirements<Model>;
        Provides: WorkflowProvision<Model>;
      }
    >;
  };
}>;

export type DefinedWorkflow<Model extends WorkflowModelDefinition> = Readonly<{
  server: Feature<WorkflowFeature<Model>>;
  readonly [workflowImplementation]: WorkflowImplementation<Model>;
  readonly [workflowModel]?: Model;
}>;

export class WorkflowExecutionFailure extends Error {
  constructor(
    readonly id: string,
    readonly failure: WorkflowError<object>,
  ) {
    super(failure.message);
    this.name = "WorkflowExecutionFailure";
  }
}

/** Creates a typed durable-workflow Feature from ordinary procedural TypeScript. */
export function createWorkflow<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
): DefinedWorkflow<Model> {
  return {
    server: createWorkflowServer<Model>(implementation, () => ({
      version: WORKFLOW_DEFINITION_VERSION,
      protocolVersion: WORKFLOW_PROTOCOL_VERSION,
      name: typeLiteral<Model["Name"]>(),
      schemas: {
        input: typeSchema<Model["Input"]>(),
        result: typeSchema<Model["Result"]>(),
        state: typeSchema<Model["State"]>(),
        dependencies: typeSchema<Model["Dependencies"]>(),
        signals: typeSchema<Model["Signals"]>(),
        queries: typeSchema<Model["Queries"]>(),
        failures: typeSchema<WorkflowFailuresOf<Model>>(),
      },
    })),
    [workflowImplementation]: implementation,
  };
}

/** @internal Builds the one server contribution with a compiler- or test-owned definition. */
export function createWorkflowServer<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
  define: () => WorkflowDefinition<Model>,
): Feature<WorkflowFeature<Model>> {
  const server = {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: WorkflowRequirements<Model> }) {
          const definition = define();
          const service = (await dependencies.workflowRuntime.create({
            definition,
            implementation,
            dependencies,
          })) as WorkflowApi<Model>;
          return {
            [definition.name]: service,
          } as unknown as WorkflowProvision<Model>;
        },
      },
    },
  } as unknown as Feature<WorkflowFeature<Model>>;
  return server;
}

type History<Model extends WorkflowModelDefinition> = readonly StoredEvent<
  WorkflowJournalEvent<Model>
>[];

/** Adapter integration used by the development workflow-runtime Dependency. */
export function createWorkflowService<Model extends WorkflowModelDefinition>(
  definition: WorkflowDefinition<Model>,
  implementation: WorkflowImplementation<Model>,
  requirements: WorkflowRequirements<Model>,
): WorkflowApi<Model> & AsyncDisposable {
  if (definition.version !== WORKFLOW_DEFINITION_VERSION) {
    throw new Error(`Unsupported Workflow definition version ${definition.version}.`);
  }
  if (definition.protocolVersion !== WORKFLOW_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Workflow protocol version ${definition.protocolVersion}.`);
  }
  validateActivityPolicies(implementation);
  const dependencies = requirements as WorkflowRuntimeRequirements<Model>;
  const name = definition.name;
  const active = new Map<string, Execution<Model>>();
  const starting = new Map<string, Promise<Execution<Model> | undefined>>();
  const owner = dependencies.identifiers.create({});
  let disposed = false;
  const stream = (id: string) => `workflow:${name}:${encodeURIComponent(id)}`;
  const history = (id: string) => readWorkflowHistory(dependencies.events, stream(id));
  const ensure = async (id: string): Promise<Execution<Model> | undefined> => {
    const existing = active.get(id);
    if (existing) return existing;
    const pending = starting.get(id);
    if (pending) return pending;
    const created = ensureOne(id);
    starting.set(id, created);
    try {
      return await created;
    } finally {
      starting.delete(id);
    }
  };
  const ensureOne = async (id: string): Promise<Execution<Model> | undefined> => {
    const current = await history(id);
    const started = startedEvent(current);
    if (!started || terminalEvent(current)) return undefined;
    if (
      !(await claimWorkflow(dependencies.events, stream(id), owner, dependencies.clock.now({})))
    ) {
      return undefined;
    }
    const state = portable(
      await implementation.state({ input: started.input as Model["Input"] }),
      "replayed workflow state",
    ) as Mutable<StateOf<Model>>;
    const execution = new Execution(
      id,
      name,
      owner,
      implementation,
      dependencies,
      current,
      state,
      () => active.delete(id),
    );
    active.set(id, execution);
    execution.start();
    return execution;
  };
  const append = (id: string, event: WorkflowJournalEvent<Model>) =>
    appendEvent(dependencies.events, stream(id), event);
  const selectExecution = async (
    selector: WorkflowExecutionSelector,
  ): Promise<WorkflowExecution> => {
    identifier(selector.id);
    const current = await history(selector.id);
    const started = startedEvent(current);
    if (!started) throw new Error(`Workflow ${JSON.stringify(selector.id)} does not exist.`);
    if (selector.run !== undefined && selector.run !== started.run) {
      throw new Error(
        `Workflow ${JSON.stringify(selector.id)} has run ${JSON.stringify(
          started.run,
        )}, not ${JSON.stringify(selector.run)}.`,
      );
    }
    return Object.freeze({ id: selector.id, run: started.run });
  };

  const signalApi = Object.fromEntries(
    Object.keys(implementation.signals).map((name) => [
      name,
      async ({
        execution: selector,
        input,
      }: {
        execution: WorkflowExecutionSelector;
        input: unknown;
      }) => {
        assertActive();
        const execution = await selectExecution(selector);
        const id = execution.id;
        const current = await history(id);
        if (terminalEvent(current)) {
          throw new Error(`Workflow ${JSON.stringify(id)} has already finished.`);
        }
        const activeExecution = active.get(id);
        const boundary = activeExecution?.signalBoundary ?? workflowSignalBoundary(current);
        await append(id, {
          type: "workflow.signal.received",
          name,
          input: portable(input, "workflow signal input"),
          boundary,
          at: dependencies.clock.now({}),
        } as WorkflowJournalEvent<Model>);
        const running = (await ensure(id)) ?? active.get(id);
        await running?.notify();
        return execution;
      },
    ]),
  ) as WorkflowSignalApi<Model>;

  const queryApi = Object.fromEntries(
    Object.entries(implementation.queries).map(([name, query]) => [
      name,
      async ({
        execution: selector,
        input,
        consistency,
      }: {
        execution: WorkflowExecutionSelector;
        input: unknown;
        consistency: "eventual" | "current";
      }) => {
        assertActive();
        const execution = await selectExecution(selector);
        if (consistency === "current") await ensure(execution.id);
        const state = snapshotFromHistory<Model>(execution.id, await history(execution.id)).state;
        return await (
          query as (context: {
            state: Readonly<StateOf<Model>>;
            input: unknown;
          }) => MaybePromise<unknown>
        )({
          state,
          input,
        });
      },
    ]),
  ) as WorkflowQueryApi<Model>;

  const activities = Object.freeze({
    async complete<Result, Failure, Heartbeat>({
      invocation,
      result,
    }: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      result: NoInfer<Result>;
    }) {
      assertActive();
      await completeDeferredActivity(
        dependencies.events,
        name,
        invocation,
        portable(result, "deferred workflow Activity result"),
        dependencies.clock.now({}),
      );
      await active.get(invocation.execution.id)?.notify();
    },
    async fail<Result, Failure, Heartbeat>({
      invocation,
      failure,
    }: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      failure: NoInfer<Failure>;
    }) {
      assertActive();
      await failDeferredActivity(
        dependencies.events,
        name,
        invocation,
        failure,
        dependencies.clock.now({}),
      );
      await active.get(invocation.execution.id)?.notify();
    },
    async heartbeat<Result, Failure, Heartbeat>({
      invocation,
      details,
    }: {
      invocation: DeferredDependencyInvocation<Result, Failure, Heartbeat>;
      details: NoInfer<Heartbeat>;
    }) {
      assertActive();
      await heartbeatDeferredActivity(
        dependencies.events,
        name,
        invocation,
        portable(details, "deferred workflow Activity heartbeat details"),
        dependencies.clock.now({}),
      );
    },
  });

  const service: WorkflowApi<Model> & AsyncDisposable = {
    async start({ id, input }) {
      assertActive();
      identifier(id);
      const execution = await ensureWorkflowStarted(
        dependencies.events,
        stream(id),
        definition,
        { id, run: dependencies.identifiers.create({}) },
        input,
        portable(await implementation.state({ input }), "initial workflow state"),
        dependencies.clock.now({}),
      );
      await ensure(id);
      return execution;
    },
    async describe({ execution: selector }) {
      assertActive();
      const execution = await selectExecution(selector);
      await ensure(execution.id);
      return currentSnapshot(execution);
    },
    async result({ execution: selector, follow: _follow }) {
      assertActive();
      const execution = await selectExecution(selector);
      await ensure(execution.id);
      for await (const snapshot of watch(execution)) {
        if (snapshot.status === "completed") return snapshot.result as Model["Result"];
        if (snapshot.status === "failed") {
          throw new WorkflowExecutionFailure(execution.id, snapshot.error!);
        }
        if (snapshot.status === "cancelled") {
          throw new WorkflowExecutionFailure(execution.id, {
            name: "WorkflowCancelled",
            message: `Workflow ${JSON.stringify(execution.id)} was cancelled.`,
          });
        }
      }
      throw new Error(`Workflow ${JSON.stringify(execution.id)} ended without a result.`);
    },
    async cancel({ execution: selector, reason }) {
      assertActive();
      const execution = await selectExecution(selector);
      const id = execution.id;
      const current = await history(id);
      if (terminalEvent(current)) return;
      const requested = cancellationRequestEvent(current);
      if (!requested) {
        await append(id, {
          type: "workflow.cancellation.requested",
          ...(reason === undefined ? {} : { reason }),
          at: dependencies.clock.now({}),
        });
      }
      const running = (await ensure(id)) ?? active.get(id);
      running?.cancel(requested?.reason ?? reason);
    },
    watch({ execution }) {
      assertActive();
      return watch(execution);
    },
    activities,
    signal: Object.freeze(signalApi),
    query: Object.freeze(queryApi),
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await Promise.all([...active.values()].map((execution) => execution.dispose()));
      active.clear();
      starting.clear();
    },
  };
  return Object.freeze(service);

  function assertActive(): void {
    if (disposed) throw new Error(`Workflow Feature ${name} is disposed.`);
  }

  async function currentSnapshot(execution: WorkflowExecution): Promise<WorkflowSnapshot<Model>> {
    return snapshotFromHistory(execution.id, await history(execution.id));
  }

  function watch(selector: WorkflowExecutionSelector): AsyncIterable<WorkflowSnapshot<Model>> {
    return {
      async *[Symbol.asyncIterator]() {
        const execution = await selectExecution(selector);
        let current = await history(execution.id);
        yield snapshotFromHistory(execution.id, current);
        if (terminalEvent(current)) return;
        const changes = dependencies.events.subscribe({
          stream: stream(execution.id),
          after: current.at(-1)?.revision ?? 0,
        });
        for await (const event of changes) {
          current = [...current, event];
          yield snapshotFromHistory(execution.id, current);
          if (terminalEvent(current)) return;
        }
      },
    };
  }
}

class WorkflowCancellationState {
  readonly #parent: WorkflowCancellationState | undefined;
  readonly #propagation: "inherit" | "shield";
  #requested = false;
  #reason: string | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #request: Promise<void>;
  #resolve!: () => void;

  constructor(parent?: WorkflowCancellationState, propagation: "inherit" | "shield" = "inherit") {
    this.#parent = parent;
    this.#propagation = propagation;
    this.#request = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
  }

  requested(): boolean {
    return (
      this.#requested || (this.#propagation === "inherit" && this.#parent?.requested() === true)
    );
  }

  reason(): string | undefined {
    if (this.#requested) return this.#reason;
    return this.#propagation === "inherit" ? this.#parent?.reason() : undefined;
  }

  request(reason?: string): void {
    if (this.#requested) return;
    this.#requested = true;
    this.#reason = reason;
    this.#resolve();
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }

  async wait(): Promise<void> {
    if (this.requested()) return;
    if (this.#propagation === "inherit" && this.#parent) {
      await Promise.race([this.#request, this.#parent.wait()]);
      return;
    }
    await this.#request;
  }

  subscribe(request: () => void): () => void {
    if (this.requested()) {
      request();
      return () => undefined;
    }
    this.#listeners.add(request);
    const unsubscribeParent =
      this.#propagation === "inherit" ? this.#parent?.subscribe(request) : undefined;
    return () => {
      this.#listeners.delete(request);
      unsubscribeParent?.();
    };
  }
}

class Execution<Model extends WorkflowModelDefinition> implements AsyncDisposable {
  readonly #id: string;
  readonly #run: string;
  readonly #name: Model["Name"];
  readonly #implementation: WorkflowImplementation<Model>;
  readonly #owner: string;
  readonly #dependencies: WorkflowRuntimeRequirements<Model>;
  readonly #stream: string;
  readonly #done: () => void;
  #history: History<Model>;
  #state: Mutable<StateOf<Model>>;
  #time: number;
  #sequence = 0;
  #delivered = new Set<number>();
  #disposed = false;
  #leaseLost = false;
  #lease: Promise<void> | undefined;
  #control: Promise<void> | undefined;
  #running: Promise<void> | undefined;
  #notifications = Promise.resolve();
  #publishChange!: () => void;
  #changed = new Promise<void>((resolve) => {
    this.#publishChange = resolve;
  });
  #stop: Promise<typeof stopped>;
  #stopExecution!: () => void;
  readonly #cancellation = new WorkflowCancellationState();

  constructor(
    id: string,
    name: Model["Name"],
    owner: string,
    implementation: WorkflowImplementation<Model>,
    dependencies: WorkflowRuntimeRequirements<Model>,
    history: History<Model>,
    state: Mutable<StateOf<Model>>,
    done: () => void,
  ) {
    this.#id = id;
    this.#name = name;
    this.#owner = owner;
    this.#implementation = implementation;
    this.#dependencies = dependencies;
    this.#history = history;
    this.#stream = `workflow:${name}:${encodeURIComponent(id)}`;
    this.#done = done;
    this.#stop = new Promise<typeof stopped>((resolve) => {
      this.#stopExecution = () => resolve(stopped);
    });
    const started = startedEvent(history);
    if (!started) throw new Error(`Workflow ${JSON.stringify(id)} has no start event.`);
    this.#run = started.run;
    this.#state = state;
    duration(started.at, "Workflow start time");
    this.#time = started.at;
    const cancellation = cancellationRequestEvent(history);
    if (cancellation) this.#cancellation.request(cancellation.reason);
  }

  get signalBoundary(): number {
    return Math.max(1, this.#sequence);
  }

  start(): void {
    this.#lease ??= this.#heartbeat();
    this.#control ??= this.#observe();
    this.#running ??= this.#execute();
  }

  notify(): Promise<void> {
    this.#notifications = this.#notifications.then(async () => {
      await this.#refresh();
      await this.#deliver(this.signalBoundary);
      this.#markChanged();
    });
    return this.#notifications;
  }

  cancel(reason?: string): void {
    this.#cancellation.request(reason);
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#stopExecution();
    await this.#running;
    await this.#control;
    await this.#lease;
    await this.#refresh();
    if (!terminalEvent(this.#history)) {
      await this.#append({
        type: "workflow.worker.released",
        owner: this.#owner,
        at: this.#dependencies.clock.now({}),
      }).catch(() => undefined);
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  async #execute(): Promise<void> {
    try {
      const result = await this.#implementation.execute(this.#context(this.#cancellation));
      await this.#refresh();
      await this.#deliver(Number.POSITIVE_INFINITY);
      if (this.#disposed) return;
      await this.#append({
        type: "workflow.completed",
        ...(result === undefined ? {} : { result: portable(result, "workflow result") }),
        state: portable(this.#state, "completed workflow state"),
        at: this.#time,
      });
    } catch (error) {
      await this.#refresh().catch(() => undefined);
      if (this.#disposed || error instanceof WorkflowStopped || terminalEvent(this.#history))
        return;
      if (error instanceof WorkflowCancellationFailure && this.#cancellation.requested()) {
        await this.#append({
          type: "workflow.cancelled",
          ...(this.#cancellation.reason() === undefined
            ? {}
            : { reason: this.#cancellation.reason() }),
          state: portable(this.#state, "cancelled workflow state"),
          at: this.#time,
        }).catch(() => undefined);
        return;
      }
      await this.#append({
        type: "workflow.failed",
        error: workflowError<Model>(error),
        state: portable(this.#state, "failed workflow state"),
        at: this.#time,
      }).catch(() => undefined);
    } finally {
      this.#stopExecution();
      await this.#control;
      await this.#lease;
      this.#done();
    }
  }

  #context(cancellation: WorkflowCancellationState): WorkflowExecutionContext<Model> {
    const started = startedEvent(this.#history);
    if (!started) throw new Error(`Workflow ${JSON.stringify(this.#id)} has no start event.`);
    return Object.freeze({
      input: started.input as Model["Input"],
      dependencies: durableDependencies(this, this.#dependencies, cancellation),
      state: this.#state,
      time: Object.freeze({ now: () => this.#time }),
      sleep: (input: WorkflowSleep) => this.sleep(input, cancellation),
      wait: (input: WorkflowWait) => this.wait(input, cancellation),
      cancellation: this.#cancellationApi(cancellation),
    });
  }

  #cancellationApi(cancellation: WorkflowCancellationState): WorkflowCancellation<Model> {
    return Object.freeze({
      requested: () => cancellation.requested(),
      start: <Value>(
        input: Readonly<{
          propagation: "inherit" | "shield";
          timeout?: number;
          execute(context: WorkflowExecutionContext<Model>): MaybePromise<Value>;
        }>,
      ) => this.#startCancellationBranch(cancellation, input),
    });
  }

  #startCancellationBranch<Value>(
    parent: WorkflowCancellationState,
    input: Readonly<{
      propagation: "inherit" | "shield";
      timeout?: number;
      execute(context: WorkflowExecutionContext<Model>): MaybePromise<Value>;
    }>,
  ): WorkflowCancellationBranch<Value> {
    if (!["inherit", "shield"].includes(input.propagation)) {
      throw new TypeError("Workflow cancellation propagation must be inherit or shield.");
    }
    if (input.timeout !== undefined) {
      duration(input.timeout, "Workflow cancellation timeout");
    }
    if (typeof input.execute !== "function") {
      throw new TypeError("Workflow cancellation branch requires an execute function.");
    }
    const cancellation = new WorkflowCancellationState(parent, input.propagation);
    const timeoutCancellation = new WorkflowCancellationState();
    const timeout =
      input.timeout === undefined
        ? undefined
        : this.sleep({ duration: input.timeout }, timeoutCancellation).then(
            () => cancellation.request("timeout"),
            (error: unknown) => {
              if (!(error instanceof WorkflowCancellationFailure)) throw error;
            },
          );
    let operation: Promise<Awaited<Value>>;
    try {
      operation = Promise.resolve(input.execute(this.#context(cancellation)));
    } catch (error) {
      operation = Promise.reject(error);
    }
    const result = this.#wait(operation, cancellation).finally(() => {
      timeoutCancellation.request("branch-completed");
    });
    void result.catch(() => undefined);
    void timeout?.catch(() => undefined);
    return Object.freeze({
      cancel: ({ reason }: Readonly<{ reason?: string }>) => cancellation.request(reason),
      result: () => result,
    });
  }

  async #observe(): Promise<void> {
    const iterator = this.#dependencies.events
      .subscribe({
        stream: this.#stream,
        after: this.#history.at(-1)?.revision ?? 0,
      })
      [Symbol.asyncIterator]();
    try {
      while (true) {
        const next = await Promise.race([
          iterator.next(),
          this.#stop.then(
            () =>
              ({
                done: true,
                value: undefined,
              }) as IteratorResult<StoredEvent<WorkflowJournalEvent<Model>>>,
          ),
        ]);
        if (next.done) return;
        if (next.value.event.type === "workflow.cancellation.requested") {
          this.cancel(next.value.event.reason);
          this.#markChanged();
          continue;
        }
        if (
          next.value.event.type === "workflow.cancelled" ||
          next.value.event.type === "workflow.completed" ||
          next.value.event.type === "workflow.failed"
        ) {
          return;
        }
        if (next.value.event.type === "workflow.signal.received") {
          this.#markChanged();
        }
      }
    } finally {
      await iterator.return?.();
    }
  }

  async #heartbeat(): Promise<void> {
    while (!this.#disposed && !this.#leaseLost) {
      const until = this.#dependencies.clock.now({}) + Math.floor(workflowLeaseDuration / 3);
      const elapsed = await Promise.race([
        this.#dependencies.timer.sleep({ until }).then(() => true),
        this.#stop.then(() => false),
      ]);
      if (!elapsed) return;
      const renewed = await renewWorkflow(
        this.#dependencies.events,
        this.#stream,
        this.#owner,
        this.#dependencies.clock.now({}),
      );
      if (renewed) continue;
      this.#leaseLost = true;
      this.#stopExecution();
      return;
    }
  }

  async activity(
    dependency: string,
    operation: string,
    input: unknown,
    cancellation = this.#cancellation,
  ): Promise<unknown> {
    const sequence = ++this.#sequence;
    try {
      return await this.#activity(sequence, dependency, operation, input, cancellation);
    } catch (error) {
      if (error instanceof WorkflowCancellationFailure) {
        await this.#cancelCommand("activity", sequence, cancellation.reason());
      }
      throw error;
    }
  }

  async #activity(
    sequence: number,
    dependency: string,
    operation: string,
    input: unknown,
    cancellation: WorkflowCancellationState,
  ): Promise<unknown> {
    await this.#refresh();
    this.#assertRunning(cancellation);
    const configuredPolicy = activityPolicy(this.#implementation, dependency, operation);
    const retry = configuredPolicy.retry ?? { attempts: 1 };
    const policy = activityPolicySnapshot(configuredPolicy);
    const id = workflowActivityId(this.#name, this.#id, sequence);
    const activityInput = portable(input, "workflow Activity input");
    const existingCheckpoint = this.#history.find(
      ({ event }) =>
        event.type === "workflow.state" &&
        event.reason === "activity" &&
        event.sequence === sequence,
    );
    if (existingCheckpoint?.event.type === "workflow.state") {
      const checkpoint = this.#checkpointEvent("activity", sequence);
      await this.#deliver(sequence, checkpoint.revision);
      this.#verifyCheckpoint(checkpoint, "activity", sequence);
      await this.#deliver(sequence);
    } else {
      await this.#deliver(sequence);
      await this.#checkpoint("activity", sequence);
    }

    const existingSchedule = this.#history.find(
      ({ event }) => event.type === "workflow.activity.scheduled" && event.sequence === sequence,
    )?.event;
    const scheduledAt =
      existingSchedule?.type === "workflow.activity.scheduled" ? existingSchedule.at : this.#time;
    if (existingSchedule?.type === "workflow.activity.scheduled") {
      if (
        existingSchedule.id !== id ||
        existingSchedule.dependency !== dependency ||
        existingSchedule.operation !== operation ||
        !equal(existingSchedule.input, activityInput) ||
        !equal(existingSchedule.policy, policy)
      ) {
        throw new Error(
          `Workflow ${JSON.stringify(this.#id)} changed durable Activity ${sequence}.`,
        );
      }
    } else {
      await this.#append({
        type: "workflow.activity.scheduled",
        sequence,
        id,
        dependency,
        operation,
        input: activityInput,
        policy,
        at: scheduledAt,
      } as WorkflowJournalEvent<Model>);
    }

    const completed = this.#history.find(
      ({ event }) => event.type === "workflow.activity.completed" && event.sequence === sequence,
    )?.event;
    if (completed?.type === "workflow.activity.completed") {
      this.#advanceTime(completed.at);
      return portable(completed.result, "replayed workflow Activity result");
    }
    const cancelled = this.#history.find(
      ({ event }) => event.type === "workflow.activity.cancelled" && event.sequence === sequence,
    )?.event;
    if (cancelled?.type === "workflow.activity.cancelled") {
      throw new WorkflowCancellationFailure(cancelled.reason);
    }

    const started = this.#history
      .filter(
        ({ event }) =>
          event.type === "workflow.activity.attempt.started" && event.sequence === sequence,
      )
      .map(({ event }) => (event.type === "workflow.activity.attempt.started" ? event.attempt : 0));
    const previousAttempt = Math.max(0, ...started);
    const totalDeadline =
      configuredPolicy.timeout.total === undefined
        ? undefined
        : scheduledAt + configuredPolicy.timeout.total;
    if (
      previousAttempt === 0 &&
      configuredPolicy.timeout.queue !== undefined &&
      this.#dependencies.clock.now({}) >= scheduledAt + configuredPolicy.timeout.queue
    ) {
      throw new WorkflowActivityTimeoutFailure("queue");
    }
    const pendingDeferred = [...this.#history]
      .reverse()
      .find(
        ({ event }) =>
          event.type === "workflow.activity.deferred" &&
          event.sequence === sequence &&
          !this.#history.some(
            ({ event: closing }) =>
              "sequence" in closing &&
              closing.sequence === sequence &&
              "attempt" in closing &&
              closing.attempt === event.attempt &&
              [
                "workflow.activity.attempt.abandoned",
                "workflow.activity.attempt.failed",
                "workflow.activity.completed",
              ].includes(closing.type),
          ),
      )?.event;
    if (pendingDeferred?.type === "workflow.activity.deferred") {
      const startedAt = this.#history.find(
        ({ event }) =>
          event.type === "workflow.activity.attempt.started" &&
          event.sequence === sequence &&
          event.attempt === pendingDeferred.attempt,
      )?.event.at;
      if (startedAt === undefined) {
        throw new Error(
          `Workflow ${JSON.stringify(this.#id)} deferred Activity ${sequence} before its attempt started.`,
        );
      }
      const attemptDeadline =
        configuredPolicy.timeout.attempt === undefined
          ? undefined
          : startedAt + configuredPolicy.timeout.attempt;
      const deadline =
        attemptDeadline === undefined
          ? totalDeadline!
          : totalDeadline === undefined
            ? attemptDeadline
            : Math.min(attemptDeadline, totalDeadline);
      const timeout =
        totalDeadline !== undefined && deadline === totalDeadline ? "total" : "attempt";
      const previousHeartbeat = [...this.#history]
        .reverse()
        .find(
          ({ event }) =>
            event.type === "workflow.activity.heartbeat" &&
            event.sequence === sequence &&
            event.attempt === pendingDeferred.attempt,
        )?.event;
      const heartbeatAt =
        previousHeartbeat?.type === "workflow.activity.heartbeat"
          ? previousHeartbeat.at
          : startedAt;
      try {
        return await this.#waitForActivity(
          this.#waitForDeferredActivity(sequence, pendingDeferred.attempt, cancellation),
          deadline,
          timeout,
          configuredPolicy.timeout.heartbeat === undefined
            ? undefined
            : () => ({
                deadline:
                  this.#activityHeartbeatAt(sequence, pendingDeferred.attempt, heartbeatAt) +
                  configuredPolicy.timeout.heartbeat!,
                changed: new Promise<void>(() => {}),
              }),
          cancellation,
        );
      } catch (error) {
        if (error instanceof WorkflowStopped || error instanceof WorkflowCancellationFailure) {
          throw error;
        }
        const failure = workflowError<Model>(error);
        const failedAt = this.#dependencies.clock.now({});
        const retryAt = activityRetryAt(
          error,
          failure,
          retry,
          pendingDeferred.attempt,
          totalDeadline,
          failedAt,
        );
        const completion = await this.#appendActivityFailure({
          type: "workflow.activity.attempt.failed",
          sequence,
          attempt: pendingDeferred.attempt,
          error: failure,
          ...(retryAt === undefined ? {} : { retryAt }),
          at: failedAt,
        });
        if (completion) {
          return portable(completion.result, "deferred workflow Activity result");
        }
        if (retryAt === undefined) throw error;
      }
    }
    if (
      previousAttempt > 0 &&
      !this.#history.some(
        ({ event }) =>
          "sequence" in event &&
          event.sequence === sequence &&
          "attempt" in event &&
          event.attempt === previousAttempt &&
          [
            "workflow.activity.attempt.abandoned",
            "workflow.activity.attempt.failed",
            "workflow.activity.completed",
          ].includes(event.type),
      )
    ) {
      await this.#append({
        type: "workflow.activity.attempt.abandoned",
        sequence,
        attempt: previousAttempt,
        reason: "worker-lost",
        at: this.#dependencies.clock.now({}),
      });
    }

    const previousFailure = [...this.#history]
      .reverse()
      .find(
        ({ event }) =>
          event.type === "workflow.activity.attempt.failed" && event.sequence === sequence,
      )?.event;
    if (
      previousFailure?.type === "workflow.activity.attempt.failed" &&
      previousFailure.retryAt !== undefined
    ) {
      await this.#waitUntil(
        totalDeadline === undefined
          ? previousFailure.retryAt
          : Math.min(previousFailure.retryAt, totalDeadline),
        cancellation,
      );
    }
    if (totalDeadline !== undefined && this.#dependencies.clock.now({}) >= totalDeadline) {
      throw new WorkflowActivityTimeoutFailure("total");
    }
    if (previousAttempt >= retry.attempts) {
      if (previousFailure?.type === "workflow.activity.attempt.failed") {
        throw workflowFailure(previousFailure.error);
      }
      const exhausted = new Error(
        `Workflow Activity ${JSON.stringify(id)} exhausted its attempts.`,
      );
      exhausted.name = "WorkflowActivityAttemptsExhausted";
      throw exhausted;
    }

    const target = Reflect.get(this.#dependencies, dependency) as object;
    const method = Reflect.get(target, operation) as (input: unknown) => PromiseLike<unknown>;
    if (typeof method !== "function") {
      throw new Error(`Workflow Dependency ${dependency}.${operation} is not implemented.`);
    }
    let lastError: unknown;
    for (let attempt = previousAttempt + 1; attempt <= retry.attempts; attempt += 1) {
      const startedAt = this.#dependencies.clock.now({});
      if (totalDeadline !== undefined && startedAt >= totalDeadline) {
        throw new WorkflowActivityTimeoutFailure("total");
      }
      await this.#append({
        type: "workflow.activity.attempt.started",
        sequence,
        attempt,
        at: startedAt,
      });
      try {
        const attemptDeadline =
          configuredPolicy.timeout.attempt === undefined
            ? undefined
            : startedAt + configuredPolicy.timeout.attempt;
        const deadline =
          attemptDeadline === undefined
            ? totalDeadline!
            : totalDeadline === undefined
              ? attemptDeadline
              : Math.min(attemptDeadline, totalDeadline);
        const timeout =
          totalDeadline !== undefined && deadline === totalDeadline ? "total" : "attempt";
        const previousHeartbeat = [...this.#history]
          .reverse()
          .find(
            ({ event }) =>
              event.type === "workflow.activity.heartbeat" && event.sequence === sequence,
          )?.event;
        let heartbeatAt = startedAt;
        let heartbeatWrites = Promise.resolve();
        let acceptingHeartbeats = true;
        let notifyHeartbeat!: () => void;
        let heartbeatChanged = new Promise<void>((resolve) => {
          notifyHeartbeat = resolve;
        });
        const recordHeartbeat = (details: unknown): void => {
          if (!acceptingHeartbeats) {
            throw new Error(`Workflow Activity ${JSON.stringify(id)} is no longer running.`);
          }
          const value = portable(details, "workflow Activity heartbeat details");
          const at = this.#dependencies.clock.now({});
          heartbeatAt = at;
          const notify = notifyHeartbeat;
          heartbeatChanged = new Promise<void>((resolve) => {
            notifyHeartbeat = resolve;
          });
          notify();
          heartbeatWrites = heartbeatWrites.then(() =>
            this.#append({
              type: "workflow.activity.heartbeat",
              sequence,
              attempt,
              details: value,
              at,
            }),
          );
        };
        let result: unknown;
        try {
          result = await this.#waitForActivity(
            Promise.resolve(
              invokeDependency(target, operation, input, {
                id,
                attempt,
                scheduledAt,
                startedAt,
                deadline,
                [dependencyInvocationControl]: {
                  ...(previousHeartbeat?.type === "workflow.activity.heartbeat"
                    ? { previousHeartbeat: previousHeartbeat.details }
                    : {}),
                  heartbeat: recordHeartbeat,
                  defer: ({ id: completionId }) =>
                    createDeferredDependencyInvocation({
                      id: completionId,
                      activity: id,
                      execution: { workflow: this.#name, id: this.#id, run: this.#run },
                      attempt,
                    }),
                  cancellation: {
                    requested: () => cancellation.requested(),
                    wait: () => cancellation.wait(),
                    subscribe: (request) => cancellation.subscribe(request),
                  },
                },
              }),
            ),
            deadline,
            timeout,
            configuredPolicy.timeout.heartbeat === undefined
              ? undefined
              : () => ({
                  deadline: heartbeatAt + configuredPolicy.timeout.heartbeat!,
                  changed: heartbeatChanged,
                }),
            cancellation,
          );
          if (isDeferredDependencyInvocation(result)) {
            const deferred = portableDeferredInvocation(result);
            await this.#append({
              type: "workflow.activity.deferred",
              sequence,
              attempt,
              id: deferred.id,
              at: this.#dependencies.clock.now({}),
            });
            result = await this.#waitForActivity(
              this.#waitForDeferredActivity(sequence, attempt, cancellation),
              deadline,
              timeout,
              configuredPolicy.timeout.heartbeat === undefined
                ? undefined
                : () => ({
                    deadline:
                      this.#activityHeartbeatAt(sequence, attempt, heartbeatAt) +
                      configuredPolicy.timeout.heartbeat!,
                    changed: heartbeatChanged,
                  }),
              cancellation,
            );
          }
        } finally {
          acceptingHeartbeats = false;
          await heartbeatWrites;
        }
        await this.#refresh();
        const externallyCompleted = this.#history.find(
          ({ event }) =>
            event.type === "workflow.activity.completed" &&
            event.sequence === sequence &&
            event.attempt === attempt,
        )?.event;
        if (externallyCompleted?.type === "workflow.activity.completed") {
          this.#advanceTime(externallyCompleted.at);
          return portable(
            externallyCompleted.result,
            "externally completed workflow Activity result",
          );
        }
        this.#advanceTime(this.#hostTime());
        await this.#append({
          type: "workflow.activity.completed",
          sequence,
          attempt,
          ...(result === undefined ? {} : { result: portable(result, "workflow Activity result") }),
          at: this.#time,
        } as WorkflowJournalEvent<Model>);
        return result;
      } catch (error) {
        if (error instanceof WorkflowStopped || error instanceof WorkflowCancellationFailure) {
          throw error;
        }
        lastError = error;
        const failure = workflowError<Model>(error);
        const failedAt = this.#dependencies.clock.now({});
        const retryAt = activityRetryAt(error, failure, retry, attempt, totalDeadline, failedAt);
        const completion = await this.#appendActivityFailure({
          type: "workflow.activity.attempt.failed",
          sequence,
          attempt,
          error: failure,
          ...(retryAt === undefined ? {} : { retryAt }),
          at: failedAt,
        });
        if (completion) {
          return portable(completion.result, "deferred workflow Activity result");
        }
        if (retryAt === undefined) break;
        await this.#waitUntil(retryAt, cancellation);
      }
    }
    throw lastError;
  }

  async #waitForDeferredActivity(
    sequence: number,
    attempt: number,
    cancellation: WorkflowCancellationState,
  ): Promise<unknown> {
    while (true) {
      await this.#refresh();
      this.#assertRunning(cancellation);
      const completed = this.#history.find(
        ({ event }) =>
          event.type === "workflow.activity.completed" &&
          event.sequence === sequence &&
          event.attempt === attempt,
      )?.event;
      if (completed?.type === "workflow.activity.completed") {
        this.#advanceTime(completed.at);
        return portable(completed.result, "deferred workflow Activity result");
      }
      const failure = this.#history.find(
        ({ event }) =>
          event.type === "workflow.activity.attempt.failed" &&
          event.sequence === sequence &&
          event.attempt === attempt,
      )?.event;
      if (failure?.type === "workflow.activity.attempt.failed") {
        throw new WorkflowRecordedActivityFailure(failure.error, failure.retryAt);
      }
      const iterator = this.#dependencies.events
        .subscribe({
          stream: this.#stream,
          after: this.#history.at(-1)?.revision ?? 0,
        })
        [Symbol.asyncIterator]();
      try {
        const next = await this.#wait(iterator.next(), cancellation);
        if (next.done) {
          throw new Error(
            `Deferred Workflow Activity ${sequence} stopped before it was completed.`,
          );
        }
      } finally {
        await iterator.return?.();
      }
    }
  }

  async #waitForActivity<Value>(
    operation: PromiseLike<Value>,
    deadline: number,
    timeout: "attempt" | "total",
    heartbeat?: () => Readonly<{ deadline: number; changed: Promise<void> }>,
    cancellation = this.#cancellation,
  ): Promise<Value> {
    const settled = Promise.resolve(operation).then(
      (value) => ({ kind: "completed" as const, value }),
      (error: unknown) => ({ kind: "failed" as const, error }),
    );
    while (true) {
      const pulse = heartbeat?.();
      const heartbeatWins = pulse !== undefined && pulse.deadline < deadline;
      const activeDeadline = heartbeatWins ? pulse.deadline : deadline;
      const activeTimeout = heartbeatWins ? "heartbeat" : timeout;
      if (activeDeadline <= this.#dependencies.clock.now({})) {
        throw new WorkflowActivityTimeoutFailure(activeTimeout);
      }
      const outcomes: Array<
        Promise<
          Awaited<typeof settled> | Readonly<{ kind: "heartbeat" }> | Readonly<{ kind: "timeout" }>
        >
      > = [
        settled,
        this.#dependencies.timer
          .sleep({ until: activeDeadline })
          .then(() => ({ kind: "timeout" as const })),
      ];
      if (pulse) {
        outcomes.push(pulse.changed.then(() => ({ kind: "heartbeat" as const })));
      }
      const outcome = await this.#wait(Promise.race(outcomes), cancellation);
      if (outcome.kind === "heartbeat") continue;
      if (outcome.kind === "completed") return outcome.value;
      if (outcome.kind === "failed") throw outcome.error;
      await this.#refresh();
      const latest = heartbeat?.();
      if (latest && latest.deadline > activeDeadline) continue;
      throw new WorkflowActivityTimeoutFailure(activeTimeout);
    }
  }

  #activityHeartbeatAt(sequence: number, attempt: number, fallback: number): number {
    const heartbeat = [...this.#history]
      .reverse()
      .find(
        ({ event }) =>
          event.type === "workflow.activity.heartbeat" &&
          event.sequence === sequence &&
          event.attempt === attempt,
      )?.event;
    return heartbeat?.type === "workflow.activity.heartbeat" ? heartbeat.at : fallback;
  }

  async #waitUntil(deadline: number, cancellation = this.#cancellation): Promise<void> {
    if (deadline > this.#dependencies.clock.now({})) {
      await this.#wait(this.#dependencies.timer.sleep({ until: deadline }), cancellation);
    }
    await this.#refresh();
    this.#assertRunning(cancellation);
  }

  async sleep(input: WorkflowSleep, cancellation = this.#cancellation): Promise<void> {
    const sequence = ++this.#sequence;
    try {
      await this.#sleep(sequence, input, cancellation);
    } catch (error) {
      if (error instanceof WorkflowCancellationFailure) {
        await this.#cancelCommand("timer", sequence, cancellation.reason());
      }
      throw error;
    }
  }

  async #sleep(
    sequence: number,
    input: WorkflowSleep,
    cancellation: WorkflowCancellationState,
  ): Promise<void> {
    const timing = workflowSleep(input);
    await this.#refresh();
    this.#assertRunning(cancellation);
    const scheduledEvent = this.#history.find(
      ({ event }) => event.type === "workflow.timer.scheduled" && event.sequence === sequence,
    )?.event;
    const scheduled =
      scheduledEvent?.type === "workflow.timer.scheduled" ? scheduledEvent : undefined;
    const completed = this.#history.find(
      ({ event }) => event.type === "workflow.timer.completed" && event.sequence === sequence,
    )?.event;
    const cancelled = this.#history.find(
      ({ event }) => event.type === "workflow.timer.cancelled" && event.sequence === sequence,
    )?.event;
    if (completed && !scheduled) {
      throw new Error(`Workflow ${JSON.stringify(this.#id)} has an incomplete timer ${sequence}.`);
    }
    if (scheduled) {
      const checkpoint = this.#checkpointEvent("timer", sequence);
      await this.#deliver(sequence, checkpoint.revision);
      this.#verifyCheckpoint(checkpoint, "timer", sequence);
      await this.#deliver(sequence);
      if (!sameWorkflowTimer(scheduled, timing)) {
        throw new Error(`Workflow ${JSON.stringify(this.#id)} changed timer ${sequence}.`);
      }
      if (completed?.type === "workflow.timer.completed") {
        this.#advanceTime(completed.at);
        return;
      }
      if (cancelled?.type === "workflow.timer.cancelled") {
        throw new WorkflowCancellationFailure(cancelled.reason);
      }
    }
    if (!scheduled) await this.#deliver(sequence);
    const deadline = scheduled?.deadline ?? workflowTimerDeadline(timing, this.#time);
    if (!scheduled) {
      await this.#checkpoint("timer", sequence);
      await this.#append({
        type: "workflow.timer.scheduled",
        sequence,
        ...("duration" in timing ? { duration: timing.duration } : {}),
        deadline,
        at: this.#time,
      });
    }
    await this.#wait(this.#dependencies.timer.sleep({ until: deadline }), cancellation);
    await this.#refresh();
    this.#assertRunning(cancellation);
    this.#advanceTime(this.#hostTime());
    await this.#append({
      type: "workflow.timer.completed",
      sequence,
      at: this.#time,
    });
  }

  async wait(input: WorkflowWait, cancellation = this.#cancellation): Promise<boolean> {
    const sequence = ++this.#sequence;
    try {
      return await this.#waitCondition(sequence, input, cancellation);
    } catch (error) {
      if (error instanceof WorkflowCancellationFailure) {
        await this.#cancelCommand("condition", sequence, cancellation.reason());
      }
      throw error;
    }
  }

  async #waitCondition(
    sequence: number,
    input: WorkflowWait,
    cancellation: WorkflowCancellationState,
  ): Promise<boolean> {
    if (typeof input.condition !== "function") {
      throw new TypeError("Workflow condition must be a function.");
    }
    if (input.timeout !== undefined) {
      duration(input.timeout, "Workflow condition timeout");
    }
    await this.#refresh();
    this.#assertRunning(cancellation);
    const scheduledEvent = this.#history.find(
      ({ event }) => event.type === "workflow.condition.scheduled" && event.sequence === sequence,
    )?.event;
    const scheduled =
      scheduledEvent?.type === "workflow.condition.scheduled" ? scheduledEvent : undefined;
    const completedStored = this.#history.find(
      ({ event }) => event.type === "workflow.condition.completed" && event.sequence === sequence,
    );
    const completed =
      completedStored?.event.type === "workflow.condition.completed"
        ? completedStored.event
        : undefined;
    const cancelled = this.#history.find(
      ({ event }) => event.type === "workflow.condition.cancelled" && event.sequence === sequence,
    )?.event;
    if (completed && !scheduled) {
      throw new Error(
        `Workflow ${JSON.stringify(this.#id)} has an incomplete condition ${sequence}.`,
      );
    }
    if (scheduled) {
      const checkpoint = this.#checkpointEvent("condition", sequence);
      await this.#deliver(sequence, checkpoint.revision);
      this.#verifyCheckpoint(checkpoint, "condition", sequence);
      if (scheduled.timeout !== input.timeout) {
        throw new Error(`Workflow ${JSON.stringify(this.#id)} changed condition ${sequence}.`);
      }
      await this.#deliver(sequence, completedStored?.revision);
      if (completed) {
        const satisfied = await this.#condition(input.condition);
        if ((completed.outcome === "satisfied") !== satisfied) {
          throw new Error(`Workflow ${JSON.stringify(this.#id)} changed condition ${sequence}.`);
        }
        this.#advanceTime(completed.at);
        return completed.outcome === "satisfied";
      }
      if (cancelled?.type === "workflow.condition.cancelled") {
        throw new WorkflowCancellationFailure(cancelled.reason);
      }
    } else {
      await this.#deliver(sequence);
      await this.#checkpoint("condition", sequence);
      const at = this.#time;
      const deadline = input.timeout === undefined ? undefined : at + input.timeout;
      if (deadline !== undefined) duration(deadline, "Workflow condition deadline");
      await this.#append({
        type: "workflow.condition.scheduled",
        sequence,
        ...(input.timeout === undefined ? {} : { timeout: input.timeout, deadline }),
        at,
      });
    }

    const currentSchedule = this.#history.find(
      ({ event }) => event.type === "workflow.condition.scheduled" && event.sequence === sequence,
    )?.event;
    const deadline =
      scheduled?.deadline ??
      (currentSchedule?.type === "workflow.condition.scheduled"
        ? currentSchedule.deadline
        : undefined);
    while (true) {
      const changed = this.#changed;
      const outcome = await this.#resolveCondition(
        sequence,
        input.condition,
        deadline,
        cancellation,
      );
      if (outcome) return outcome === "satisfied";
      await this.#wait(
        deadline === undefined
          ? changed
          : Promise.race([changed, this.#dependencies.timer.sleep({ until: deadline })]),
        cancellation,
      );
    }
  }

  async #resolveCondition(
    sequence: number,
    condition: () => boolean,
    deadline: number | undefined,
    cancellation: WorkflowCancellationState,
  ): Promise<"satisfied" | "timed-out" | undefined> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      await this.#synchronize(sequence);
      this.#assertRunning(cancellation);
      const current = this.#hostTime();
      if (deadline !== undefined && current >= deadline) {
        this.#advanceTime(current);
      }
      const outcome = (await this.#condition(condition))
        ? ("satisfied" as const)
        : deadline !== undefined && this.#time >= deadline
          ? ("timed-out" as const)
          : undefined;
      if (!outcome) return undefined;
      const expectedRevision = this.#history.at(-1)?.revision ?? 0;
      const owned = await ensureWorkflowLease(
        this.#dependencies.events,
        this.#stream,
        this.#owner,
        current,
      );
      if (!owned) {
        this.#leaseLost = true;
        this.#stopExecution();
        throw new WorkflowStopped();
      }
      const appended = await this.#dependencies.events.append({
        stream: this.#stream,
        expectedRevision,
        events: [
          {
            type: "workflow.condition.completed",
            sequence,
            outcome,
            at: this.#time,
          },
        ],
      });
      if (!appended?.length) continue;
      this.#history = await readWorkflowHistory(this.#dependencies.events, this.#stream);
      return outcome;
    }
    throw new Error(`Workflow journal ${JSON.stringify(this.#stream)} changed too frequently.`);
  }

  async #deliver(boundary: number, beforeRevision = Number.POSITIVE_INFINITY): Promise<void> {
    for (const stored of this.#history) {
      const event = stored.event;
      if (
        event.type !== "workflow.signal.received" ||
        event.boundary > boundary ||
        stored.revision >= beforeRevision ||
        this.#delivered.has(stored.revision)
      ) {
        continue;
      }
      const signal = this.#implementation.signals[event.name as SignalOf<Model>];
      if (!signal)
        throw new Error(`Workflow received unknown signal ${JSON.stringify(event.name)}.`);
      this.#advanceTime(event.at);
      await signal({ state: this.#state, input: event.input as never });
      this.#delivered.add(stored.revision);
      const applied = this.#history.find(
        ({ event: candidate }) =>
          candidate.type === "workflow.state" && candidate.signalRevision === stored.revision,
      )?.event;
      if (applied?.type === "workflow.state") {
        if (!equal(applied.state, portable(this.#state, "replayed signal state"))) {
          throw new Error(
            `Workflow ${JSON.stringify(this.#id)} changed state after signal ${JSON.stringify(event.name)}.`,
          );
        }
      } else if (!this.#disposed) {
        await this.#append({
          type: "workflow.state",
          state: portable(this.#state, "signalled workflow state"),
          reason: "signal",
          signalRevision: stored.revision,
          at: this.#time,
        });
      }
    }
  }

  async #checkpoint(reason: "activity" | "condition" | "timer", sequence: number): Promise<void> {
    await this.#append({
      type: "workflow.state",
      state: portable(this.#state, "workflow checkpoint"),
      reason,
      sequence,
      at: this.#time,
    });
  }

  #checkpointEvent(
    reason: "activity" | "condition" | "timer",
    sequence: number,
  ): StoredEvent<WorkflowJournalEvent<Model>> {
    const checkpoint = this.#history.find(
      ({ event }) =>
        event.type === "workflow.state" && event.reason === reason && event.sequence === sequence,
    );
    if (checkpoint?.event.type !== "workflow.state") {
      throw new Error(
        `Workflow ${JSON.stringify(this.#id)} has no state before durable boundary ${sequence}.`,
      );
    }
    return checkpoint;
  }

  #verifyCheckpoint(
    checkpoint: StoredEvent<WorkflowJournalEvent<Model>>,
    reason: "activity" | "condition" | "timer",
    sequence: number,
  ): void {
    if (
      checkpoint.event.type !== "workflow.state" ||
      checkpoint.event.reason !== reason ||
      !equal(checkpoint.event.state, portable(this.#state, "replayed workflow state"))
    ) {
      throw new Error(
        `Workflow ${JSON.stringify(this.#id)} changed state before durable boundary ${sequence}.`,
      );
    }
  }

  async #refresh(): Promise<void> {
    this.#history = await readWorkflowHistory(this.#dependencies.events, this.#stream);
    const cancellation = cancellationRequestEvent(this.#history);
    if (cancellation) this.#cancellation.request(cancellation.reason);
  }

  #hostTime(): number {
    const value = this.#dependencies.clock.now({});
    duration(value, "Workflow clock time");
    return Math.max(this.#time, value);
  }

  #advanceTime(value: number): void {
    duration(value, "Workflow time");
    this.#time = Math.max(this.#time, value);
  }

  #synchronize(boundary: number): Promise<void> {
    this.#notifications = this.#notifications.then(async () => {
      await this.#refresh();
      await this.#deliver(boundary);
    });
    return this.#notifications;
  }

  async #condition(condition: () => boolean): Promise<boolean> {
    const before = portable(this.#state, "workflow state before condition");
    const result = await workflowCondition(condition);
    if (!equal(before, this.#state)) {
      throw new TypeError("Workflow condition must not mutate state.");
    }
    return result;
  }

  #markChanged(): void {
    const publish = this.#publishChange;
    this.#changed = new Promise<void>((resolve) => {
      this.#publishChange = resolve;
    });
    publish();
  }

  async #append(event: WorkflowJournalEvent<Model>): Promise<void> {
    if (event.type !== "workflow.worker.released") {
      const owned = await ensureWorkflowLease(
        this.#dependencies.events,
        this.#stream,
        this.#owner,
        this.#dependencies.clock.now({}),
      );
      if (!owned) {
        this.#leaseLost = true;
        this.#stopExecution();
        throw new WorkflowStopped();
      }
    }
    const appended = await appendEvent(this.#dependencies.events, this.#stream, event);
    this.#history = await readWorkflowHistory(this.#dependencies.events, this.#stream);
    if (!this.#history.some(({ revision }) => revision === appended.revision)) {
      throw new Error(`Workflow ${JSON.stringify(this.#id)} lost a journal append.`);
    }
  }

  async #appendActivityFailure(
    event: WorkflowActivityAttemptFailedEvent<Model>,
  ): Promise<WorkflowActivityCompletedEvent<Model> | undefined> {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const history = await readWorkflowHistory(this.#dependencies.events, this.#stream);
      const completed = history.find(
        ({ event: current }) =>
          current.type === "workflow.activity.completed" &&
          current.sequence === event.sequence &&
          current.attempt === event.attempt,
      )?.event;
      if (completed?.type === "workflow.activity.completed") {
        this.#history = history;
        return completed;
      }
      const failed = history.some(
        ({ event: current }) =>
          current.type === "workflow.activity.attempt.failed" &&
          current.sequence === event.sequence &&
          current.attempt === event.attempt,
      );
      if (failed) {
        this.#history = history;
        return undefined;
      }
      const appended = await this.#dependencies.events.append({
        stream: this.#stream,
        expectedRevision: history.at(-1)?.revision ?? 0,
        events: [event],
      });
      if (!appended?.length) continue;
      this.#history = await readWorkflowHistory(this.#dependencies.events, this.#stream);
      return undefined;
    }
    throw new Error(`Workflow journal ${JSON.stringify(this.#stream)} changed too frequently.`);
  }

  async #cancelCommand(
    command: "activity" | "condition" | "timer",
    sequence: number,
    reason?: string,
  ): Promise<void> {
    await this.#refresh();
    const scheduled = this.#history.some(
      ({ event }) =>
        "sequence" in event &&
        event.type === `workflow.${command}.scheduled` &&
        event.sequence === sequence,
    );
    const closed = this.#history.some(
      ({ event }) =>
        "sequence" in event &&
        event.sequence === sequence &&
        [
          `workflow.${command}.cancelled`,
          `workflow.${command}.completed`,
          ...(command === "activity" ? ["workflow.activity.completed"] : []),
        ].includes(event.type),
    );
    if (!scheduled || closed || terminalEvent(this.#history)) return;
    await this.#append({
      type: `workflow.${command}.cancelled`,
      sequence,
      ...(reason === undefined ? {} : { reason }),
      at: this.#dependencies.clock.now({}),
    } as WorkflowJournalEvent<Model>);
  }

  #assertRunning(cancellation = this.#cancellation): void {
    if (this.#disposed || this.#leaseLost || terminalEvent(this.#history)) {
      throw new WorkflowStopped();
    }
    if (cancellation.requested()) {
      throw new WorkflowCancellationFailure(cancellation.reason());
    }
  }

  async #wait<Value>(
    operation: PromiseLike<Value>,
    cancellation = this.#cancellation,
  ): Promise<Value> {
    const result = await Promise.race([
      Promise.resolve(operation).then((value) => ({ kind: "value" as const, value })),
      this.#stop.then(() => ({ kind: "stopped" as const })),
      cancellation.wait().then(() => ({ kind: "cancelled" as const })),
    ]);
    if (result.kind === "stopped") throw new WorkflowStopped();
    if (result.kind === "cancelled") {
      throw new WorkflowCancellationFailure(cancellation.reason());
    }
    return result.value;
  }
}

function durableDependencies<Model extends WorkflowModelDefinition>(
  execution: Execution<Model>,
  dependencies: WorkflowRequirements<Model>,
  cancellation: WorkflowCancellationState,
): WorkflowDependencies<Model> {
  const reserved = new Set(["clock", "events", "identifiers", "timer", "workflowRuntime"]);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(dependencies)
        .filter(([name]) => !reserved.has(name))
        .map(([dependency, implementation]) => [
          dependency,
          new Proxy(Object.create(null) as object, {
            get(_target, operation) {
              if (typeof operation !== "string") return Reflect.get(implementation, operation);
              const method = Reflect.get(implementation, operation);
              if (typeof method !== "function") return method;
              return (input: unknown) =>
                execution.activity(dependency, operation, input, cancellation);
            },
            has: (_target, operation) => Reflect.has(implementation, operation),
            ownKeys: () => Reflect.ownKeys(implementation),
            getOwnPropertyDescriptor: (_target, operation) => ({
              configurable: true,
              enumerable: true,
              value: Reflect.get(implementation, operation),
            }),
          }),
        ]),
    ),
  ) as WorkflowDependencies<Model>;
}

const workflowEventTypes = new Set<string>([
  "workflow.started",
  "workflow.state",
  "workflow.activity.scheduled",
  "workflow.activity.attempt.started",
  "workflow.activity.attempt.abandoned",
  "workflow.activity.attempt.failed",
  "workflow.activity.heartbeat",
  "workflow.activity.deferred",
  "workflow.activity.completed",
  "workflow.activity.cancelled",
  "workflow.timer.scheduled",
  "workflow.timer.completed",
  "workflow.timer.cancelled",
  "workflow.condition.scheduled",
  "workflow.condition.completed",
  "workflow.condition.cancelled",
  "workflow.signal.received",
  "workflow.worker.claimed",
  "workflow.worker.released",
  "workflow.cancellation.requested",
  "workflow.cancelled",
  "workflow.completed",
  "workflow.failed",
]);

async function readWorkflowHistory<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
): Promise<History<Model>> {
  const history = await store.read({ stream });
  validateWorkflowHistory(history, stream);
  return history;
}

function validateWorkflowHistory<Model extends WorkflowModelDefinition>(
  history: History<Model>,
  stream: string,
): void {
  if (!history.length) return;
  const started = history[0]?.event;
  if (started?.type !== "workflow.started") {
    throw new Error(`Workflow journal ${JSON.stringify(stream)} has no start event.`);
  }
  if (started.definitionVersion !== WORKFLOW_DEFINITION_VERSION) {
    throw new Error(
      `Workflow journal ${JSON.stringify(stream)} uses definition version ${String(
        started.definitionVersion,
      )}; this runtime supports ${WORKFLOW_DEFINITION_VERSION}.`,
    );
  }
  if (started.protocolVersion !== WORKFLOW_PROTOCOL_VERSION) {
    throw new Error(
      `Workflow journal ${JSON.stringify(stream)} uses protocol version ${String(
        started.protocolVersion,
      )}; this runtime supports ${WORKFLOW_PROTOCOL_VERSION}.`,
    );
  }
  identifier(started.run);
  let revision = 0;
  let starts = 0;
  let cancellationRequests = 0;
  const activityCheckpoints = new Set<number>();
  const timerCheckpoints = new Set<number>();
  const timers = new Map<number, { closed: boolean }>();
  const conditionCheckpoints = new Set<number>();
  const conditions = new Map<number, { closed: boolean; timeout?: number }>();
  const activities = new Map<
    number,
    Readonly<{
      attempts: Set<number>;
      closed: Set<number>;
      deferred: Set<number>;
      completed: { value: boolean };
      cancelled: { value: boolean };
    }>
  >();
  for (const stored of history) {
    if (!Number.isSafeInteger(stored.revision) || stored.revision <= revision) {
      throw new Error(`Workflow journal ${JSON.stringify(stream)} has invalid revision order.`);
    }
    revision = stored.revision;
    if (!workflowEventTypes.has(stored.event.type)) {
      throw new Error(
        `Workflow journal ${JSON.stringify(stream)} contains unknown event ${JSON.stringify(
          stored.event.type,
        )}.`,
      );
    }
    if (stored.event.type === "workflow.started") starts += 1;
    if (stored.event.type === "workflow.state" && stored.event.sequence !== undefined) {
      const sequence = workflowSequence(stored.event.sequence, stream);
      if (stored.event.reason === "activity") activityCheckpoints.add(sequence);
      if (stored.event.reason === "condition") conditionCheckpoints.add(sequence);
      if (stored.event.reason === "timer") timerCheckpoints.add(sequence);
    }
    if (stored.event.type === "workflow.activity.scheduled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      if (!activityCheckpoints.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules Activity ${sequence} without a state checkpoint.`,
        );
      }
      if (activities.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules Activity ${sequence} more than once.`,
        );
      }
      activities.set(sequence, {
        attempts: new Set(),
        closed: new Set(),
        deferred: new Set(),
        completed: { value: false },
        cancelled: { value: false },
      });
    }
    if (stored.event.type === "workflow.activity.attempt.started") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const activity = activities.get(sequence);
      if (!activity || activity.completed.value || activity.cancelled.value) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} starts an invalid Activity ${sequence} attempt.`,
        );
      }
      const attempt = workflowAttempt(stored.event.attempt, stream);
      if (
        attempt !== activity.attempts.size + 1 ||
        (attempt > 1 && !activity.closed.has(attempt - 1))
      ) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} has invalid Activity ${sequence} attempt order.`,
        );
      }
      activity.attempts.add(attempt);
    }
    if (stored.event.type === "workflow.activity.heartbeat") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const attempt = workflowAttempt(stored.event.attempt, stream);
      const activity = activities.get(sequence);
      if (!activity?.attempts.has(attempt) || activity.closed.has(attempt)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} heartbeats an invalid Activity ${sequence} attempt ${attempt}.`,
        );
      }
    }
    if (stored.event.type === "workflow.activity.deferred") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const attempt = workflowAttempt(stored.event.attempt, stream);
      const activity = activities.get(sequence);
      if (
        !activity?.attempts.has(attempt) ||
        activity.closed.has(attempt) ||
        activity.deferred.has(attempt) ||
        !stored.event.id
      ) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} defers an invalid Activity ${sequence} attempt ${attempt}.`,
        );
      }
      activity.deferred.add(attempt);
    }
    if (
      stored.event.type === "workflow.activity.attempt.abandoned" ||
      stored.event.type === "workflow.activity.attempt.failed" ||
      stored.event.type === "workflow.activity.completed"
    ) {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const attempt = workflowAttempt(stored.event.attempt, stream);
      const activity = activities.get(sequence);
      if (!activity?.attempts.has(attempt) || activity.closed.has(attempt)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} closes an invalid Activity ${sequence} attempt ${attempt}.`,
        );
      }
      activity.closed.add(attempt);
      if (stored.event.type === "workflow.activity.completed") {
        if (activity.completed.value) {
          throw new Error(
            `Workflow journal ${JSON.stringify(stream)} completes Activity ${sequence} more than once.`,
          );
        }
        activity.completed.value = true;
      }
    }
    if (stored.event.type === "workflow.activity.cancelled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const activity = activities.get(sequence);
      if (!activity || activity.completed.value || activity.cancelled.value) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} cancels an invalid Activity ${sequence}.`,
        );
      }
      activity.cancelled.value = true;
      for (const attempt of activity.attempts) activity.closed.add(attempt);
    }
    if (stored.event.type === "workflow.timer.scheduled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      if (!timerCheckpoints.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules timer ${sequence} without a state checkpoint.`,
        );
      }
      if (timers.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules timer ${sequence} more than once.`,
        );
      }
      if (stored.event.duration !== undefined) {
        duration(stored.event.duration, "Workflow timer duration");
      }
      duration(stored.event.deadline, "Workflow timer deadline");
      timers.set(sequence, { closed: false });
    }
    if (stored.event.type === "workflow.timer.completed") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const timer = timers.get(sequence);
      if (!timer || timer.closed) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} completes an invalid timer ${sequence}.`,
        );
      }
      timer.closed = true;
    }
    if (stored.event.type === "workflow.timer.cancelled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const timer = timers.get(sequence);
      if (!timer || timer.closed) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} cancels an invalid timer ${sequence}.`,
        );
      }
      timer.closed = true;
    }
    if (stored.event.type === "workflow.condition.scheduled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      if (!conditionCheckpoints.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules condition ${sequence} without a state checkpoint.`,
        );
      }
      if (conditions.has(sequence)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} schedules condition ${sequence} more than once.`,
        );
      }
      if ((stored.event.timeout === undefined) !== (stored.event.deadline === undefined)) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} has invalid condition ${sequence} timing.`,
        );
      }
      if (stored.event.timeout !== undefined) {
        duration(stored.event.timeout, "Workflow condition timeout");
        duration(stored.event.deadline!, "Workflow condition deadline");
        duration(stored.event.at, "Workflow condition schedule time");
        if (stored.event.deadline !== stored.event.at + stored.event.timeout) {
          throw new Error(
            `Workflow journal ${JSON.stringify(stream)} has invalid condition ${sequence} timing.`,
          );
        }
      }
      conditions.set(sequence, {
        closed: false,
        ...(stored.event.timeout === undefined ? {} : { timeout: stored.event.timeout }),
      });
    }
    if (stored.event.type === "workflow.condition.completed") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const condition = conditions.get(sequence);
      if (
        !condition ||
        condition.closed ||
        !["satisfied", "timed-out"].includes(stored.event.outcome) ||
        (stored.event.outcome === "timed-out" && condition.timeout === undefined)
      ) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} completes an invalid condition ${sequence}.`,
        );
      }
      condition.closed = true;
    }
    if (stored.event.type === "workflow.condition.cancelled") {
      const sequence = workflowSequence(stored.event.sequence, stream);
      const condition = conditions.get(sequence);
      if (!condition || condition.closed) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} cancels an invalid condition ${sequence}.`,
        );
      }
      condition.closed = true;
    }
    if (stored.event.type === "workflow.cancellation.requested") {
      cancellationRequests += 1;
      if (cancellationRequests > 1) {
        throw new Error(
          `Workflow journal ${JSON.stringify(stream)} requests cancellation more than once.`,
        );
      }
    }
    if (stored.event.type === "workflow.cancelled" && cancellationRequests === 0) {
      throw new Error(
        `Workflow journal ${JSON.stringify(stream)} is cancelled without a cancellation request.`,
      );
    }
  }
  if (starts !== 1) {
    throw new Error(`Workflow journal ${JSON.stringify(stream)} has ${starts} start events.`);
  }
}

function workflowSequence(value: number, stream: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Workflow journal ${JSON.stringify(stream)} has an invalid command sequence.`);
  }
  return value;
}

function workflowAttempt(value: number, stream: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Workflow journal ${JSON.stringify(stream)} has an invalid Activity attempt.`);
  }
  return value;
}

async function completeDeferredActivity<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  workflow: string,
  invocation: DeferredDependencyInvocation<unknown, unknown, unknown>,
  result: unknown,
  at: number,
): Promise<void> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const { history, scheduled, stream } = await deferredActivityContext(
      store,
      workflow,
      invocation,
    );
    const completed = history.find(
      ({ event }) =>
        event.type === "workflow.activity.completed" &&
        event.sequence === scheduled.sequence &&
        event.attempt === invocation.attempt,
    )?.event;
    if (completed?.type === "workflow.activity.completed") {
      if (!equal(completed.result, result)) {
        throw new Error(
          `Deferred Dependency invocation ${JSON.stringify(invocation.id)} was completed with a different result.`,
        );
      }
      return;
    }
    const closed = history.some(
      ({ event }) =>
        "sequence" in event &&
        event.sequence === scheduled.sequence &&
        "attempt" in event &&
        event.attempt === invocation.attempt &&
        ["workflow.activity.attempt.abandoned", "workflow.activity.attempt.failed"].includes(
          event.type,
        ),
    );
    if (closed || terminalEvent(history)) {
      throw new Error(
        `Deferred Dependency invocation ${JSON.stringify(invocation.id)} is no longer pending.`,
      );
    }
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [
        {
          type: "workflow.activity.completed",
          sequence: scheduled.sequence,
          attempt: invocation.attempt,
          ...(result === undefined ? {} : { result }),
          at,
        } as WorkflowJournalEvent<Model>,
      ],
    });
    if (appended?.length) return;
  }
  throw new Error(
    `Workflow journal for deferred invocation ${JSON.stringify(invocation.id)} changed too frequently.`,
  );
}

async function failDeferredActivity<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  workflow: string,
  invocation: DeferredDependencyInvocation<unknown, unknown, unknown>,
  failure: unknown,
  at: number,
): Promise<void> {
  const dependencyFailure = new DependencyFailureError(
    portable(failure, "deferred workflow Activity failure") as Readonly<{
      type: string;
      data: unknown;
      message?: string;
      retry?: Readonly<{ delay: number }>;
    }>,
  );
  const error = workflowError<Model>(dependencyFailure);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const { history, scheduled, stream } = await deferredActivityContext(
      store,
      workflow,
      invocation,
    );
    const failed = history.find(
      ({ event }) =>
        event.type === "workflow.activity.attempt.failed" &&
        event.sequence === scheduled.sequence &&
        event.attempt === invocation.attempt,
    )?.event;
    if (failed?.type === "workflow.activity.attempt.failed") {
      if (!equal(failed.error, error)) {
        throw new Error(
          `Deferred Dependency invocation ${JSON.stringify(invocation.id)} failed with a different failure.`,
        );
      }
      return;
    }
    if (deferredActivityClosed(history, scheduled.sequence, invocation.attempt)) {
      throw new Error(
        `Deferred Dependency invocation ${JSON.stringify(invocation.id)} is no longer pending.`,
      );
    }
    const retry = scheduled.policy.retry;
    const totalDeadline =
      scheduled.policy.timeout.total === null
        ? undefined
        : scheduled.at + scheduled.policy.timeout.total;
    const delay =
      dependencyFailure.retryDelay ??
      retryDelay(
        {
          ...retry,
          maximumDelay: retry.maximumDelay ?? undefined,
        },
        invocation.attempt,
      );
    const retryAt =
      invocation.attempt < retry.attempts && !retry.nonRetryable.includes(error.name)
        ? Math.min(at + delay, totalDeadline ?? Number.POSITIVE_INFINITY)
        : undefined;
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [
        {
          type: "workflow.activity.attempt.failed",
          sequence: scheduled.sequence,
          attempt: invocation.attempt,
          error,
          ...(retryAt === undefined ? {} : { retryAt }),
          at,
        } as WorkflowJournalEvent<Model>,
      ],
    });
    if (appended?.length) return;
  }
  throw new Error("Deferred Workflow Activity failure could not be recorded.");
}

async function heartbeatDeferredActivity<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  workflow: string,
  invocation: DeferredDependencyInvocation<unknown, unknown, unknown>,
  details: unknown,
  at: number,
): Promise<void> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const { history, scheduled, stream } = await deferredActivityContext(
      store,
      workflow,
      invocation,
    );
    if (deferredActivityClosed(history, scheduled.sequence, invocation.attempt)) {
      throw new Error(
        `Deferred Dependency invocation ${JSON.stringify(invocation.id)} is no longer pending.`,
      );
    }
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [
        {
          type: "workflow.activity.heartbeat",
          sequence: scheduled.sequence,
          attempt: invocation.attempt,
          details,
          at,
        } as WorkflowJournalEvent<Model>,
      ],
    });
    if (appended?.length) return;
  }
  throw new Error("Deferred Workflow Activity heartbeat could not be recorded.");
}

async function deferredActivityContext<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  workflow: string,
  invocation: DeferredDependencyInvocation<unknown, unknown, unknown>,
): Promise<
  Readonly<{
    stream: string;
    history: readonly StoredEvent<WorkflowJournalEvent<Model>>[];
    scheduled: WorkflowActivityScheduledEvent<Model>;
  }>
> {
  const execution = invocation.execution;
  if (
    !execution ||
    execution.workflow !== workflow ||
    !execution.id ||
    !execution.run ||
    !invocation.id ||
    !invocation.activity ||
    !Number.isSafeInteger(invocation.attempt) ||
    invocation.attempt < 1
  ) {
    throw new TypeError("Deferred Dependency invocation does not belong to this Workflow.");
  }
  const stream = `workflow:${workflow}:${encodeURIComponent(execution.id)}`;
  const history = await readWorkflowHistory(store, stream);
  const started = startedEvent(history);
  if (!started) {
    throw new Error(`Workflow ${JSON.stringify(execution.id)} does not exist.`);
  }
  if (execution.run !== started.run) {
    throw new Error(
      `Workflow ${JSON.stringify(execution.id)} has run ${JSON.stringify(
        started.run,
      )}, not ${JSON.stringify(execution.run)}.`,
    );
  }
  const scheduled = history.find(
    ({ event }) => event.type === "workflow.activity.scheduled" && event.id === invocation.activity,
  )?.event;
  if (scheduled?.type !== "workflow.activity.scheduled") {
    throw new Error(
      `Deferred Dependency invocation ${JSON.stringify(invocation.id)} is not pending.`,
    );
  }
  const deferred = history.find(
    ({ event }) =>
      event.type === "workflow.activity.deferred" &&
      event.sequence === scheduled.sequence &&
      event.attempt === invocation.attempt &&
      event.id === invocation.id,
  )?.event;
  if (deferred?.type !== "workflow.activity.deferred") {
    throw new Error(
      `Deferred Dependency invocation ${JSON.stringify(invocation.id)} is not pending.`,
    );
  }
  return { stream, history, scheduled };
}

function deferredActivityClosed<Model extends WorkflowModelDefinition>(
  history: readonly StoredEvent<WorkflowJournalEvent<Model>>[],
  sequence: number,
  attempt: number,
): boolean {
  return Boolean(
    terminalEvent(history) ||
    history.some(
      ({ event }) => event.type === "workflow.activity.cancelled" && event.sequence === sequence,
    ) ||
    history.some(
      ({ event }) =>
        "sequence" in event &&
        event.sequence === sequence &&
        "attempt" in event &&
        event.attempt === attempt &&
        [
          "workflow.activity.attempt.abandoned",
          "workflow.activity.attempt.failed",
          "workflow.activity.completed",
        ].includes(event.type),
    ),
  );
}

async function appendEvent<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  event: WorkflowJournalEvent<Model>,
): Promise<StoredEvent<WorkflowJournalEvent<Model>>> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await readWorkflowHistory(store, stream);
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [event],
    });
    if (appended?.[0]) return appended[0];
  }
  throw new Error(`Workflow journal ${JSON.stringify(stream)} changed too frequently.`);
}

async function ensureWorkflowStarted<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  definition: WorkflowDefinition<Model>,
  execution: WorkflowExecution,
  input: Model["Input"],
  state: Readonly<StateOf<Model>>,
  at: number,
): Promise<WorkflowExecution> {
  const portableInput = portable(input, "workflow input");
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await readWorkflowHistory(store, stream);
    const existing = startedEvent(history);
    if (existing) {
      if (!equal(existing.input, portableInput)) {
        throw new Error(`Workflow ${JSON.stringify(stream)} was started with different input.`);
      }
      return Object.freeze({ id: execution.id, run: existing.run });
    }
    if (history.length) {
      throw new Error(`Workflow journal ${JSON.stringify(stream)} has no start event.`);
    }
    const appended = await store.append({
      stream,
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: definition.version,
          protocolVersion: definition.protocolVersion,
          run: execution.run,
          input: portableInput,
          state,
          at,
        },
      ],
    });
    if (appended) return Object.freeze(execution);
  }
  throw new Error(`Workflow journal ${JSON.stringify(stream)} changed too frequently.`);
}

async function claimWorkflow<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  owner: string,
  now: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await readWorkflowHistory(store, stream);
    if (terminalEvent(history)) return false;
    const lease = workflowLease(history);
    if (lease && lease.owner !== owner && lease.expiresAt > now) return false;
    if (lease?.owner === owner && lease.expiresAt > now) return true;
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [
        {
          type: "workflow.worker.claimed",
          owner,
          expiresAt: now + workflowLeaseDuration,
          at: now,
        },
      ],
    });
    if (appended) return true;
  }
  throw new Error(`Workflow journal ${JSON.stringify(stream)} changed too frequently.`);
}

async function renewWorkflow<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  owner: string,
  now: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await readWorkflowHistory(store, stream);
    if (terminalEvent(history)) return false;
    const lease = workflowLease(history);
    if (lease?.owner !== owner) return false;
    const appended = await store.append({
      stream,
      expectedRevision: history.at(-1)?.revision ?? 0,
      events: [
        {
          type: "workflow.worker.claimed",
          owner,
          expiresAt: now + workflowLeaseDuration,
          at: now,
        },
      ],
    });
    if (appended) return true;
  }
  throw new Error(`Workflow journal ${JSON.stringify(stream)} changed too frequently.`);
}

async function ensureWorkflowLease<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  owner: string,
  now: number,
): Promise<boolean> {
  const history = await readWorkflowHistory(store, stream);
  const lease = workflowLease(history);
  if (lease?.owner !== owner || lease.expiresAt <= now) return false;
  if (lease.expiresAt - now > workflowLeaseDuration / 3) return true;
  return renewWorkflow(store, stream, owner, now);
}

function workflowLease<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): WorkflowWorkerClaimedEvent | undefined {
  let lease: WorkflowWorkerClaimedEvent | undefined;
  for (const { event } of history) {
    if (event.type === "workflow.worker.claimed") lease = event;
    if (event.type === "workflow.worker.released" && event.owner === lease?.owner) {
      lease = undefined;
    }
  }
  return lease;
}

function snapshotFromHistory<Model extends WorkflowModelDefinition>(
  id: string,
  history: History<Model>,
): WorkflowSnapshot<Model> {
  const started = startedEvent(history);
  if (!started) throw new Error(`Workflow ${JSON.stringify(id)} does not exist.`);
  const terminal = terminalEvent(history);
  let persisted = started.state;
  for (const { event } of history) {
    if (
      event.type === "workflow.state" ||
      event.type === "workflow.completed" ||
      event.type === "workflow.failed" ||
      event.type === "workflow.cancelled"
    ) {
      persisted = event.state;
    }
  }
  const state = portable(persisted, "workflow snapshot state") as StateOf<Model>;
  const base = {
    execution: Object.freeze({ id, run: started.run }),
    revision: history.at(-1)?.revision ?? 0,
    status: terminalStatus(terminal),
    state,
  };
  if (terminal?.type === "workflow.completed") {
    return { ...base, status: "completed", result: terminal.result as Model["Result"] };
  }
  if (terminal?.type === "workflow.failed") {
    return { ...base, status: "failed", error: terminal.error };
  }
  return base;
}

function terminalStatus<Model extends WorkflowModelDefinition>(
  event: WorkflowJournalEvent<Model> | undefined,
): WorkflowStatus {
  if (event?.type === "workflow.completed") return "completed";
  if (event?.type === "workflow.failed") return "failed";
  if (event?.type === "workflow.cancelled") return "cancelled";
  return "running";
}

function startedEvent<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): WorkflowStartedEvent<Model> | undefined {
  const event = history.find(({ event }) => event.type === "workflow.started")?.event;
  return event?.type === "workflow.started" ? (event as WorkflowStartedEvent<Model>) : undefined;
}

function terminalEvent<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): WorkflowJournalEvent<Model> | undefined {
  return [...history]
    .reverse()
    .find(({ event }) =>
      ["workflow.completed", "workflow.failed", "workflow.cancelled"].includes(event.type),
    )?.event;
}

function cancellationRequestEvent<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): WorkflowCancellationRequestedEvent | undefined {
  const event = history.find(
    ({ event }) => event.type === "workflow.cancellation.requested",
  )?.event;
  return event?.type === "workflow.cancellation.requested" ? event : undefined;
}

function nextBoundary<Model extends WorkflowModelDefinition>(history: History<Model>): number {
  return (
    Math.max(
      0,
      ...history.map(({ event }) =>
        "sequence" in event && typeof event.sequence === "number" ? event.sequence : 0,
      ),
    ) + 1
  );
}

function workflowSignalBoundary<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): number {
  const open = history.flatMap(({ event }) => {
    if (
      event.type === "workflow.activity.scheduled" &&
      !history.some(
        ({ event: candidate }) =>
          ["workflow.activity.completed", "workflow.activity.cancelled"].includes(candidate.type) &&
          "sequence" in candidate &&
          candidate.sequence === event.sequence,
      )
    ) {
      return [event.sequence];
    }
    if (
      event.type === "workflow.timer.scheduled" &&
      !history.some(
        ({ event: candidate }) =>
          ["workflow.timer.completed", "workflow.timer.cancelled"].includes(candidate.type) &&
          "sequence" in candidate &&
          candidate.sequence === event.sequence,
      )
    ) {
      return [event.sequence];
    }
    if (
      event.type === "workflow.condition.scheduled" &&
      !history.some(
        ({ event: candidate }) =>
          ["workflow.condition.completed", "workflow.condition.cancelled"].includes(
            candidate.type,
          ) &&
          "sequence" in candidate &&
          candidate.sequence === event.sequence,
      )
    ) {
      return [event.sequence];
    }
    return [];
  });
  return open.length ? Math.max(...open) : nextBoundary(history);
}

function portable<Value>(value: Value, label: string): Value {
  return cloneData(value, label);
}

function portableDeferredInvocation(
  invocation: DeferredDependencyInvocation,
): DeferredDependencyInvocation {
  if (
    !invocation.id ||
    !invocation.activity ||
    invocation.execution.workflow.length === 0 ||
    invocation.execution.id.length === 0 ||
    invocation.execution.run.length === 0 ||
    !Number.isSafeInteger(invocation.attempt) ||
    invocation.attempt < 1
  ) {
    throw new TypeError("Dependency provider returned an invalid deferred invocation.");
  }
  return invocation;
}

function equal(left: unknown, right: unknown): boolean {
  return equalData(left, right);
}

function identifier(value: string): void {
  if (!value || value.length > 512) {
    throw new TypeError("A workflow id must contain between 1 and 512 characters.");
  }
}

function duration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function workflowSleep(input: WorkflowSleep): WorkflowSleep {
  const hasDuration = input.duration !== undefined;
  const hasDeadline = input.deadline !== undefined;
  if (hasDuration === hasDeadline) {
    throw new TypeError("Workflow sleep requires exactly one duration or deadline.");
  }
  if (hasDuration) {
    duration(input.duration!, "Workflow sleep duration");
    return { duration: input.duration! };
  }
  duration(input.deadline!, "Workflow sleep deadline");
  return { deadline: input.deadline! };
}

function workflowTimerDeadline(timing: WorkflowSleep, now: number): number {
  const deadline = timing.deadline ?? now + timing.duration;
  duration(deadline, "Workflow sleep deadline");
  return deadline;
}

function sameWorkflowTimer(
  scheduled: Readonly<{ duration?: number; deadline: number }>,
  timing: WorkflowSleep,
): boolean {
  return timing.duration === undefined
    ? scheduled.duration === undefined && scheduled.deadline === timing.deadline
    : scheduled.duration === timing.duration;
}

async function workflowCondition(condition: () => boolean): Promise<boolean> {
  const value = await condition();
  if (typeof value !== "boolean") {
    throw new TypeError("Workflow condition must return a boolean.");
  }
  return value;
}

function activityPolicy<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
  dependency: string,
  operation: string,
): WorkflowActivityPolicy {
  const activities = implementation.activities as
    | Readonly<Record<string, Readonly<Record<string, WorkflowActivityPolicy>>>>
    | undefined;
  const policy = activities?.[dependency]?.[operation];
  if (!policy) {
    throw new TypeError(
      `Workflow Activity policy ${JSON.stringify(`${dependency}.${operation}`)} is missing.`,
    );
  }
  validateActivityPolicy(policy);
  return policy;
}

function validateActivityPolicies<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
): void {
  const activities = implementation.activities as
    | Readonly<Record<string, Readonly<Record<string, WorkflowActivityPolicy>>>>
    | undefined;
  if (!activities) return;
  for (const [dependency, operations] of Object.entries(activities)) {
    for (const [operation, policy] of Object.entries(operations)) {
      if (!policy || typeof policy !== "object") {
        throw new TypeError(
          `Workflow Activity policy ${JSON.stringify(`${dependency}.${operation}`)} must be an object.`,
        );
      }
      validateActivityPolicy(policy);
    }
  }
}

function validateActivityPolicy(policy: WorkflowActivityPolicy): void {
  const { timeout } = policy;
  if (!timeout || typeof timeout !== "object") {
    throw new TypeError("Workflow Activity timeout policy is required.");
  }
  if (timeout.attempt === undefined && timeout.total === undefined) {
    throw new TypeError("Workflow Activity timeout requires attempt or total.");
  }
  if (timeout.attempt !== undefined) {
    positiveDuration(timeout.attempt, "Workflow Activity attempt timeout");
  }
  if (timeout.total !== undefined) {
    positiveDuration(timeout.total, "Workflow Activity total timeout");
  }
  if (timeout.queue !== undefined) {
    positiveDuration(timeout.queue, "Workflow Activity queue timeout");
  }
  if (timeout.heartbeat !== undefined) {
    positiveDuration(timeout.heartbeat, "Workflow Activity heartbeat timeout");
  }
  if (
    timeout.attempt !== undefined &&
    timeout.total !== undefined &&
    timeout.attempt > timeout.total
  ) {
    throw new TypeError("Workflow Activity attempt timeout must not exceed its total timeout.");
  }
  if (policy.retry) validateActivityRetry(policy.retry);
}

function validateActivityRetry(retry: WorkflowActivityRetry): void {
  if (!Number.isSafeInteger(retry.attempts) || retry.attempts < 1) {
    throw new TypeError("Workflow Activity retry attempts must be a positive safe integer.");
  }
  duration(retry.delay ?? 0, "Workflow Activity retry delay");
  if (retry.maximumDelay !== undefined) {
    duration(retry.maximumDelay, "Workflow Activity maximum retry delay");
    if (retry.maximumDelay < (retry.delay ?? 0)) {
      throw new TypeError(
        "Workflow Activity maximum retry delay must not be less than its retry delay.",
      );
    }
  }
  if (retry.factor !== undefined && (!Number.isFinite(retry.factor) || retry.factor < 1)) {
    throw new TypeError("Workflow Activity retry factor must be a finite number of at least 1.");
  }
  if (retry.nonRetryable !== undefined) {
    if (
      !Array.isArray(retry.nonRetryable) ||
      retry.nonRetryable.some((name) => typeof name !== "string" || !name)
    ) {
      throw new TypeError("Workflow Activity non-retryable failures must be non-empty strings.");
    }
    if (new Set(retry.nonRetryable).size !== retry.nonRetryable.length) {
      throw new TypeError("Workflow Activity non-retryable failures must be unique.");
    }
  }
}

function positiveDuration(value: number, label: string): void {
  duration(value, label);
  if (value === 0) throw new TypeError(`${label} must be greater than zero.`);
}

function retryDelay(retry: WorkflowActivityRetry, attempt: number): number {
  const initial = retry.delay ?? 0;
  const factor = retry.factor ?? 1;
  const calculated = initial * factor ** (attempt - 1);
  const delay =
    retry.maximumDelay === undefined ? calculated : Math.min(calculated, retry.maximumDelay);
  duration(delay, "Workflow Activity retry delay");
  return delay;
}

function activityPolicySnapshot(policy: WorkflowActivityPolicy): WorkflowActivityPolicySnapshot {
  const retry = policy.retry ?? { attempts: 1 };
  return {
    timeout: {
      attempt: policy.timeout.attempt ?? null,
      total: policy.timeout.total ?? null,
      queue: policy.timeout.queue ?? null,
      heartbeat: policy.timeout.heartbeat ?? null,
    },
    retry: {
      attempts: retry.attempts,
      delay: retry.delay ?? 0,
      factor: retry.factor ?? 1,
      maximumDelay: retry.maximumDelay ?? null,
      nonRetryable: [...(retry.nonRetryable ?? [])],
    },
  };
}

function workflowActivityId(name: string, execution: string, sequence: number): string {
  return `activity:${encodeURIComponent(name)}:${encodeURIComponent(execution)}:${sequence}`;
}

function workflowFailure(failure: WorkflowError<object>): Error {
  const error = new Error(failure.message);
  error.name = failure.name;
  if (failure.data !== undefined) {
    Object.defineProperty(error, "data", {
      configurable: true,
      enumerable: true,
      value: cloneData(failure.data),
    });
  }
  return error;
}

class WorkflowRecordedActivityFailure extends Error {
  readonly retryAt?: number;

  constructor(failure: WorkflowError<object>, retryAt?: number) {
    super(failure.message);
    this.name = failure.name;
    this.retryAt = retryAt;
    if (failure.data !== undefined) {
      Object.defineProperty(this, "data", {
        configurable: true,
        enumerable: true,
        value: cloneData(failure.data),
      });
    }
  }
}

function activityRetryAt(
  error: unknown,
  failure: WorkflowError<object>,
  retry: WorkflowActivityRetry,
  attempt: number,
  totalDeadline: number | undefined,
  now: number,
): number | undefined {
  if (error instanceof WorkflowRecordedActivityFailure) return error.retryAt;
  if (
    attempt >= retry.attempts ||
    (error instanceof WorkflowActivityTimeoutFailure && error.timeout === "total") ||
    retry.nonRetryable?.includes(failure.name)
  ) {
    return undefined;
  }
  const delay =
    error instanceof DependencyFailureError && error.retryDelay !== undefined
      ? error.retryDelay
      : retryDelay(retry, attempt);
  return Math.min(now + delay, totalDeadline ?? Number.POSITIVE_INFINITY);
}

function workflowError<Model extends WorkflowModelDefinition>(
  error: unknown,
): WorkflowError<WorkflowFailureData<Model>> {
  if (error instanceof WorkflowExecutionFailure) {
    return error.failure as WorkflowError<WorkflowFailureData<Model>>;
  }
  if (error instanceof Error) {
    const data = Reflect.get(error, "data");
    return {
      name: error.name,
      message: error.message,
      ...(data === undefined ? {} : { data: portable(data, "workflow failure data") }),
    } as WorkflowError<WorkflowFailureData<Model>>;
  }
  return { name: "Error", message: String(error) } as WorkflowError<WorkflowFailureData<Model>>;
}

class WorkflowActivityTimeoutFailure extends Error {
  readonly timeout: "attempt" | "heartbeat" | "queue" | "total";
  readonly data: Readonly<{ timeout: "attempt" | "heartbeat" | "queue" | "total" }>;

  constructor(timeout: "attempt" | "heartbeat" | "queue" | "total") {
    super(`Workflow Activity exceeded its ${timeout} timeout.`);
    this.name = "WorkflowActivityTimeout";
    this.timeout = timeout;
    this.data = Object.freeze({ timeout });
  }
}

class WorkflowCancellationFailure extends Error {
  readonly data: Readonly<{ reason?: string }>;

  constructor(readonly reason?: string) {
    super(reason ? `Workflow branch was cancelled: ${reason}.` : "Workflow branch was cancelled.");
    this.name = "WorkflowCancelled";
    this.data = Object.freeze(reason === undefined ? {} : { reason });
  }
}

class WorkflowStopped extends Error {
  constructor() {
    super("Workflow execution stopped.");
    this.name = "WorkflowStopped";
  }
}
