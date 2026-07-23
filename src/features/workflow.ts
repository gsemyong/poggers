import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import type { Clock, EventStore, Identifiers, StoredEvent } from "@/features/entity";
import type { ServerProcess, Timer } from "@/platforms/server/platform";

type MaybePromise<Value> = Value | PromiseLike<Value>;
type Procedure = (input: never) => unknown;
type AsyncProcedure = (input: never) => PromiseLike<unknown>;
type Procedures = Readonly<Record<string, Procedure>>;
type Dependencies = Readonly<Record<string, Readonly<Record<string, AsyncProcedure>>>>;
type InputOf<Operation> = Operation extends (input: infer Input) => unknown ? Input : never;
type OutputOf<Operation> = Operation extends (...arguments_: never[]) => infer Output
  ? Awaited<Output>
  : never;
type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type StateOf<Model extends WorkflowModelDefinition> = Model["State"];
type SignalOf<Model extends WorkflowModelDefinition> = Extract<keyof Model["Signals"], string>;
declare const workflowModel: unique symbol;
const stopped = Symbol("workflow.stopped");
const workflowLeaseDuration = 30_000;

export type WorkflowModelDefinition = Readonly<{
  Name: string;
  Input: object;
  Result: unknown;
  State: object;
  Dependencies: Dependencies;
  Signals: Procedures;
  Queries: Procedures;
}>;

/** Validates and preserves the semantic definition consumed by the workflow factory. */
export type WorkflowModel<Definition extends WorkflowModelDefinition> = Readonly<Definition>;

export type WorkflowStatus = "running" | "completed" | "failed" | "cancelled";

export type WorkflowError = Readonly<{
  name: string;
  message: string;
}>;

export type WorkflowSnapshot<Model extends WorkflowModelDefinition> = Readonly<{
  id: string;
  revision: number;
  status: WorkflowStatus;
  state: Readonly<StateOf<Model>>;
  result?: Model["Result"];
  error?: WorkflowError;
}>;

export type WorkflowRetry = Readonly<{
  attempts: number;
  delay?: number | ((input: { attempt: number; error: WorkflowError }) => number);
}>;

export type WorkflowRunContext<Model extends WorkflowModelDefinition> = Readonly<{
  dependencies: Model["Dependencies"];
  state: Mutable<StateOf<Model>>;
  sleep(input: { milliseconds: number }): Promise<void>;
  cancelled(): boolean;
}>;

type SignalContext<Model extends WorkflowModelDefinition> = Readonly<{
  state: Mutable<StateOf<Model>>;
}>;

type QueryContext<Model extends WorkflowModelDefinition> = Readonly<{
  state: Readonly<StateOf<Model>>;
}>;

type SignalImplementations<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Signals"]]: (
    context: SignalContext<Model>,
    input: InputOf<Model["Signals"][Name]>,
  ) => void;
};

type QueryImplementations<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Queries"]]: (
    context: QueryContext<Model>,
    input: InputOf<Model["Queries"][Name]>,
  ) => OutputOf<Model["Queries"][Name]>;
};

export type WorkflowImplementation<Model extends WorkflowModelDefinition> = Readonly<{
  name: Model["Name"];
  state(input: Model["Input"]): StateOf<Model>;
  run(context: WorkflowRunContext<Model>, input: Model["Input"]): MaybePromise<Model["Result"]>;
  signals: SignalImplementations<Model>;
  queries: QueryImplementations<Model>;
  retry?: WorkflowRetry;
}>;

type WorkflowInvocation<Input> = Readonly<{ id: string; input: Input }>;

type WorkflowSignalApi<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Signals"]]: (
    input: WorkflowInvocation<InputOf<Model["Signals"][Name]>>,
  ) => Promise<void>;
};

type WorkflowQueryApi<Model extends WorkflowModelDefinition> = {
  readonly [Name in keyof Model["Queries"]]: (
    input: WorkflowInvocation<InputOf<Model["Queries"][Name]>>,
  ) => Promise<OutputOf<Model["Queries"][Name]>>;
};

export type WorkflowApi<Model extends WorkflowModelDefinition> = Readonly<{
  start(input: WorkflowInvocation<Model["Input"]>): Promise<WorkflowSnapshot<Model>>;
  get(input: { id: string }): Promise<WorkflowSnapshot<Model>>;
  result(input: { id: string }): Promise<Model["Result"]>;
  cancel(input: { id: string; reason?: string }): Promise<void>;
  watch(input: { id: string }): AsyncIterable<WorkflowSnapshot<Model>>;
  signals: Readonly<WorkflowSignalApi<Model>>;
  queries: Readonly<WorkflowQueryApi<Model>>;
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
    [Operation in keyof Model["Dependencies"][Dependency]]: Readonly<{
      dependency: Extract<Dependency, string>;
      operation: Extract<Operation, string>;
      input: InputOf<Model["Dependencies"][Dependency][Operation]>;
      result: OutputOf<Model["Dependencies"][Dependency][Operation]>;
    }>;
  }[keyof Model["Dependencies"][Dependency]];
}[keyof Model["Dependencies"]];

type SignalCall<Model extends WorkflowModelDefinition> = {
  [Name in keyof Model["Signals"]]: Readonly<{
    name: Extract<Name, string>;
    input: InputOf<Model["Signals"][Name]>;
  }>;
}[keyof Model["Signals"]];

type WorkflowStartedEvent<Model extends WorkflowModelDefinition> = Readonly<{
  type: "workflow.started";
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

export type WorkflowJournalEvent<Model extends WorkflowModelDefinition> =
  | WorkflowStartedEvent<Model>
  | Readonly<{
      type: "workflow.state";
      state: Readonly<StateOf<Model>>;
      reason: "effect" | "signal" | "timer";
      sequence?: number;
      signalRevision?: number;
      at: number;
    }>
  | (Readonly<{
      type: "workflow.effect.completed";
      sequence: number;
      at: number;
    }> &
      DependencyCall<Model>)
  | Readonly<{
      type: "workflow.timer.scheduled";
      sequence: number;
      milliseconds: number;
      deadline: number;
      at: number;
    }>
  | Readonly<{
      type: "workflow.timer.completed";
      sequence: number;
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
  | Readonly<{ type: "workflow.cancelled"; reason?: string; at: number }>
  | Readonly<{
      type: "workflow.completed";
      result: Model["Result"];
      state: Readonly<StateOf<Model>>;
      at: number;
    }>
  | Readonly<{
      type: "workflow.failed";
      error: WorkflowError;
      state: Readonly<StateOf<Model>>;
      at: number;
    }>;

type WorkflowRequirements<Model extends WorkflowModelDefinition> = Model["Dependencies"] &
  Readonly<{
    clock: Clock;
    events: EventStore<WorkflowJournalEvent<Model>>;
    identifiers: Identifiers;
    timer: WorkflowTimer;
    workflowRuntime: WorkflowRuntime;
  }>;

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
  dependency: Model["Name"];
  server: Feature<WorkflowFeature<Model>>;
  readonly [workflowModel]?: Model;
}>;

export class WorkflowExecutionFailure extends Error {
  constructor(
    readonly id: string,
    readonly failure: WorkflowError,
  ) {
    super(failure.message);
    this.name = "WorkflowExecutionFailure";
  }
}

/** Creates a typed durable-workflow Feature from ordinary procedural TypeScript. */
export function createWorkflow<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
): DefinedWorkflow<Model> {
  const server = {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: WorkflowRequirements<Model> }) {
          const service = (await dependencies.workflowRuntime.create({
            implementation,
            dependencies,
          })) as WorkflowApi<Model>;
          return {
            [implementation.name]: service,
          } as unknown as WorkflowProvision<Model>;
        },
      },
    },
  } as unknown as Feature<WorkflowFeature<Model>>;
  return { dependency: implementation.name, server };
}

type History<Model extends WorkflowModelDefinition> = readonly StoredEvent<
  WorkflowJournalEvent<Model>
>[];

/** Adapter integration used by the development workflow-runtime Dependency. */
export function createWorkflowService<Model extends WorkflowModelDefinition>(
  implementation: WorkflowImplementation<Model>,
  dependencies: WorkflowRequirements<Model>,
): WorkflowApi<Model> & AsyncDisposable {
  const active = new Map<string, Execution<Model>>();
  const starting = new Map<string, Promise<Execution<Model> | undefined>>();
  const owner = dependencies.identifiers.create({});
  let disposed = false;
  const stream = (id: string) => `workflow:${implementation.name}:${encodeURIComponent(id)}`;
  const history = (id: string) => dependencies.events.read({ stream: stream(id) });
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
    const execution = new Execution(id, owner, implementation, dependencies, current, () =>
      active.delete(id),
    );
    active.set(id, execution);
    execution.start();
    return execution;
  };
  const append = (id: string, event: WorkflowJournalEvent<Model>) =>
    appendEvent(dependencies.events, stream(id), event);

  const signals = Object.fromEntries(
    Object.keys(implementation.signals).map((name) => [
      name,
      async ({ id, input }: WorkflowInvocation<unknown>) => {
        assertActive();
        const current = await history(id);
        if (!startedEvent(current))
          throw new Error(`Workflow ${JSON.stringify(id)} does not exist.`);
        if (terminalEvent(current)) {
          throw new Error(`Workflow ${JSON.stringify(id)} has already finished.`);
        }
        const running = active.get(id);
        const boundary = running?.signalBoundary ?? nextBoundary(current);
        await append(id, {
          type: "workflow.signal.received",
          name,
          input: portable(input, "workflow signal input"),
          boundary,
          at: dependencies.clock.now({}),
        } as WorkflowJournalEvent<Model>);
        const execution = (await ensure(id)) ?? active.get(id);
        await execution?.notify();
      },
    ]),
  ) as WorkflowSignalApi<Model>;

  const queries = Object.fromEntries(
    Object.entries(implementation.queries).map(([name, query]) => [
      name,
      async ({ id, input }: WorkflowInvocation<unknown>) => {
        assertActive();
        const running = await ensure(id);
        const state = running
          ? running.snapshotState()
          : snapshotFromHistory<Model>(id, await history(id)).state;
        return (query as (context: QueryContext<Model>, input: unknown) => unknown)(
          { state },
          input,
        );
      },
    ]),
  ) as WorkflowQueryApi<Model>;

  const service: WorkflowApi<Model> & AsyncDisposable = {
    async start({ id, input }) {
      assertActive();
      identifier(id);
      await ensureWorkflowStarted(
        dependencies.events,
        stream(id),
        input,
        portable(implementation.state(input), "initial workflow state"),
        dependencies.clock.now({}),
      );
      await ensure(id);
      return currentSnapshot(id);
    },
    async get({ id }) {
      assertActive();
      await ensure(id);
      return currentSnapshot(id);
    },
    async result({ id }) {
      assertActive();
      await ensure(id);
      for await (const snapshot of watch(id)) {
        if (snapshot.status === "completed") return snapshot.result as Model["Result"];
        if (snapshot.status === "failed") {
          throw new WorkflowExecutionFailure(id, snapshot.error!);
        }
        if (snapshot.status === "cancelled") {
          throw new WorkflowExecutionFailure(id, {
            name: "WorkflowCancelled",
            message: `Workflow ${JSON.stringify(id)} was cancelled.`,
          });
        }
      }
      throw new Error(`Workflow ${JSON.stringify(id)} ended without a result.`);
    },
    async cancel({ id, reason }) {
      assertActive();
      const current = await history(id);
      if (!startedEvent(current)) throw new Error(`Workflow ${JSON.stringify(id)} does not exist.`);
      if (terminalEvent(current)) return;
      await append(id, {
        type: "workflow.cancelled",
        ...(reason === undefined ? {} : { reason }),
        at: dependencies.clock.now({}),
      });
      active.get(id)?.cancel();
    },
    watch({ id }) {
      assertActive();
      return watch(id);
    },
    signals: Object.freeze(signals),
    queries: Object.freeze(queries),
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
    if (disposed) throw new Error(`Workflow Feature ${implementation.name} is disposed.`);
  }

  async function currentSnapshot(id: string): Promise<WorkflowSnapshot<Model>> {
    const running = active.get(id);
    if (running) {
      const current = await history(id);
      return snapshotFromHistory(id, current, running.snapshotState());
    }
    return snapshotFromHistory(id, await history(id));
  }

  function watch(id: string): AsyncIterable<WorkflowSnapshot<Model>> {
    return {
      async *[Symbol.asyncIterator]() {
        let current = await history(id);
        if (!startedEvent(current))
          throw new Error(`Workflow ${JSON.stringify(id)} does not exist.`);
        yield snapshotFromHistory(id, current, active.get(id)?.snapshotState());
        if (terminalEvent(current)) return;
        const changes = dependencies.events.subscribe({
          stream: stream(id),
          after: current.at(-1)?.revision ?? 0,
        });
        for await (const event of changes) {
          current = [...current, event];
          yield snapshotFromHistory(id, current, active.get(id)?.snapshotState());
          if (terminalEvent(current)) return;
        }
      },
    };
  }
}

class Execution<Model extends WorkflowModelDefinition> implements AsyncDisposable {
  readonly #id: string;
  readonly #implementation: WorkflowImplementation<Model>;
  readonly #owner: string;
  readonly #dependencies: WorkflowRequirements<Model>;
  readonly #stream: string;
  readonly #done: () => void;
  #history: History<Model>;
  #state: Mutable<StateOf<Model>>;
  #sequence = 0;
  #delivered = new Set<number>();
  #cancelled = false;
  #disposed = false;
  #leaseLost = false;
  #lease: Promise<void> | undefined;
  #running: Promise<void> | undefined;
  #notifications = Promise.resolve();
  #stop: Promise<typeof stopped>;
  #stopExecution!: () => void;

  constructor(
    id: string,
    owner: string,
    implementation: WorkflowImplementation<Model>,
    dependencies: WorkflowRequirements<Model>,
    history: History<Model>,
    done: () => void,
  ) {
    this.#id = id;
    this.#owner = owner;
    this.#implementation = implementation;
    this.#dependencies = dependencies;
    this.#history = history;
    this.#stream = `workflow:${implementation.name}:${encodeURIComponent(id)}`;
    this.#done = done;
    this.#stop = new Promise<typeof stopped>((resolve) => {
      this.#stopExecution = () => resolve(stopped);
    });
    const started = startedEvent(history);
    if (!started) throw new Error(`Workflow ${JSON.stringify(id)} has no start event.`);
    this.#state = portable(
      implementation.state(started.input as Model["Input"]),
      "replayed workflow state",
    ) as Mutable<StateOf<Model>>;
    this.#cancelled = !!cancelledEvent(history);
  }

  get signalBoundary(): number {
    return Math.max(1, this.#sequence);
  }

  start(): void {
    this.#lease ??= this.#heartbeat();
    this.#running ??= this.#execute();
  }

  snapshotState(): Readonly<StateOf<Model>> {
    return portable(this.#state, "workflow state") as StateOf<Model>;
  }

  notify(): Promise<void> {
    this.#notifications = this.#notifications.then(async () => {
      await this.#refresh();
      await this.#deliver(this.signalBoundary);
    });
    return this.#notifications;
  }

  cancel(): void {
    this.#cancelled = true;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#stopExecution();
    await this.#running;
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
      const started = startedEvent(this.#history)!;
      const dependencies = durableDependencies(this, this.#dependencies);
      const result = await this.#implementation.run(
        {
          dependencies,
          state: this.#state,
          sleep: (input) => this.sleep(input),
          cancelled: () => this.#cancelled,
        },
        started.input as Model["Input"],
      );
      await this.#refresh();
      await this.#deliver(Number.POSITIVE_INFINITY);
      if (this.#cancelled || this.#disposed) return;
      await this.#append({
        type: "workflow.completed",
        result: portable(result, "workflow result"),
        state: portable(this.#state, "completed workflow state"),
        at: this.#dependencies.clock.now({}),
      });
    } catch (error) {
      await this.#refresh().catch(() => undefined);
      if (this.#cancelled || this.#disposed || cancelledEvent(this.#history)) return;
      await this.#append({
        type: "workflow.failed",
        error: workflowError(error),
        state: portable(this.#state, "failed workflow state"),
        at: this.#dependencies.clock.now({}),
      }).catch(() => undefined);
    } finally {
      this.#stopExecution();
      await this.#lease;
      this.#done();
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

  async effect(dependency: string, operation: string, input: unknown): Promise<unknown> {
    const sequence = ++this.#sequence;
    await this.#refresh();
    await this.#deliver(sequence);
    this.#assertRunning();
    const existing = this.#history.find(
      ({ event }) => event.type === "workflow.effect.completed" && event.sequence === sequence,
    )?.event;
    if (existing?.type === "workflow.effect.completed") {
      this.#verifyCheckpoint("effect", sequence);
      if (
        existing.dependency !== dependency ||
        existing.operation !== operation ||
        !equal(existing.input, input)
      ) {
        throw new Error(`Workflow ${JSON.stringify(this.#id)} changed durable effect ${sequence}.`);
      }
      return portable(existing.result, "replayed workflow effect result");
    }
    await this.#checkpoint("effect", sequence);
    const target = Reflect.get(this.#dependencies, dependency) as object;
    const method = Reflect.get(target, operation) as (input: unknown) => PromiseLike<unknown>;
    if (typeof method !== "function") {
      throw new Error(`Workflow Dependency ${dependency}.${operation} is not implemented.`);
    }
    const retry = this.#implementation.retry ?? { attempts: 1 };
    let lastError: unknown;
    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      try {
        const result = await this.#wait(Reflect.apply(method, target, [input]));
        await this.#append({
          type: "workflow.effect.completed",
          sequence,
          dependency,
          operation,
          input: portable(input, "workflow effect input"),
          result: portable(result, "workflow effect result"),
          at: this.#dependencies.clock.now({}),
        } as WorkflowJournalEvent<Model>);
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= retry.attempts) break;
        const failure = workflowError(error);
        const delay =
          typeof retry.delay === "function"
            ? retry.delay({ attempt, error: failure })
            : (retry.delay ?? 0);
        duration(delay, "workflow retry delay");
        if (delay) {
          await this.#wait(
            this.#dependencies.timer.sleep({
              until: this.#dependencies.clock.now({}) + delay,
            }),
          );
        }
        await this.#refresh();
        this.#assertRunning();
      }
    }
    throw lastError;
  }

  async sleep({ milliseconds }: { milliseconds: number }): Promise<void> {
    duration(milliseconds, "workflow sleep");
    const sequence = ++this.#sequence;
    await this.#refresh();
    await this.#deliver(sequence);
    this.#assertRunning();
    const scheduledEvent = this.#history.find(
      ({ event }) => event.type === "workflow.timer.scheduled" && event.sequence === sequence,
    )?.event;
    const scheduled =
      scheduledEvent?.type === "workflow.timer.scheduled" ? scheduledEvent : undefined;
    const completed = this.#history.some(
      ({ event }) => event.type === "workflow.timer.completed" && event.sequence === sequence,
    );
    if (completed && !scheduled) {
      throw new Error(`Workflow ${JSON.stringify(this.#id)} has an incomplete timer ${sequence}.`);
    }
    if (scheduled) {
      this.#verifyCheckpoint("timer", sequence);
      if (scheduled.milliseconds !== milliseconds) {
        throw new Error(`Workflow ${JSON.stringify(this.#id)} changed timer ${sequence}.`);
      }
      if (completed) return;
    }
    const deadline = scheduled?.deadline ?? this.#dependencies.clock.now({}) + milliseconds;
    if (!scheduled) {
      await this.#checkpoint("timer", sequence);
      await this.#append({
        type: "workflow.timer.scheduled",
        sequence,
        milliseconds,
        deadline,
        at: this.#dependencies.clock.now({}),
      });
    }
    await this.#wait(this.#dependencies.timer.sleep({ until: deadline }));
    await this.#refresh();
    this.#assertRunning();
    await this.#append({
      type: "workflow.timer.completed",
      sequence,
      at: this.#dependencies.clock.now({}),
    });
  }

  async #deliver(boundary: number): Promise<void> {
    for (const stored of this.#history) {
      const event = stored.event;
      if (
        event.type !== "workflow.signal.received" ||
        event.boundary > boundary ||
        this.#delivered.has(stored.revision)
      ) {
        continue;
      }
      const signal = this.#implementation.signals[event.name as SignalOf<Model>];
      if (!signal)
        throw new Error(`Workflow received unknown signal ${JSON.stringify(event.name)}.`);
      signal({ state: this.#state }, event.input as never);
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
      } else if (!this.#disposed && !this.#cancelled) {
        await this.#append({
          type: "workflow.state",
          state: portable(this.#state, "signalled workflow state"),
          reason: "signal",
          signalRevision: stored.revision,
          at: this.#dependencies.clock.now({}),
        });
      }
    }
  }

  async #checkpoint(reason: "effect" | "timer", sequence: number): Promise<void> {
    await this.#append({
      type: "workflow.state",
      state: portable(this.#state, "workflow checkpoint"),
      reason,
      sequence,
      at: this.#dependencies.clock.now({}),
    });
  }

  #verifyCheckpoint(reason: "effect" | "timer", sequence: number): void {
    const checkpoint = this.#history.find(
      ({ event }) =>
        event.type === "workflow.state" && event.reason === reason && event.sequence === sequence,
    )?.event;
    if (
      checkpoint?.type !== "workflow.state" ||
      !equal(checkpoint.state, portable(this.#state, "replayed workflow state"))
    ) {
      throw new Error(
        `Workflow ${JSON.stringify(this.#id)} changed state before durable boundary ${sequence}.`,
      );
    }
  }

  async #refresh(): Promise<void> {
    this.#history = await this.#dependencies.events.read({ stream: this.#stream });
    this.#cancelled ||= !!cancelledEvent(this.#history);
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
    this.#history = await this.#dependencies.events.read({ stream: this.#stream });
    if (!this.#history.some(({ revision }) => revision === appended.revision)) {
      throw new Error(`Workflow ${JSON.stringify(this.#id)} lost a journal append.`);
    }
  }

  #assertRunning(): void {
    if (this.#cancelled || this.#disposed || this.#leaseLost || terminalEvent(this.#history)) {
      throw new WorkflowStopped();
    }
  }

  async #wait<Value>(operation: PromiseLike<Value>): Promise<Value> {
    const result = await Promise.race([Promise.resolve(operation), this.#stop]);
    if (result === stopped) throw new WorkflowStopped();
    return result;
  }
}

function durableDependencies<Model extends WorkflowModelDefinition>(
  execution: Execution<Model>,
  dependencies: WorkflowRequirements<Model>,
): Model["Dependencies"] {
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
              return (input: unknown) => execution.effect(dependency, operation, input);
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
  ) as Model["Dependencies"];
}

async function appendEvent<Model extends WorkflowModelDefinition>(
  store: EventStore<WorkflowJournalEvent<Model>>,
  stream: string,
  event: WorkflowJournalEvent<Model>,
): Promise<StoredEvent<WorkflowJournalEvent<Model>>> {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await store.read({ stream });
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
  input: Model["Input"],
  state: Readonly<StateOf<Model>>,
  at: number,
): Promise<void> {
  const portableInput = portable(input, "workflow input");
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const history = await store.read({ stream });
    const existing = startedEvent(history);
    if (existing) {
      if (!equal(existing.input, portableInput)) {
        throw new Error(`Workflow ${JSON.stringify(stream)} was started with different input.`);
      }
      return;
    }
    if (history.length) {
      throw new Error(`Workflow journal ${JSON.stringify(stream)} has no start event.`);
    }
    const appended = await store.append({
      stream,
      expectedRevision: 0,
      events: [{ type: "workflow.started", input: portableInput, state, at }],
    });
    if (appended) return;
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
    const history = await store.read({ stream });
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
    const history = await store.read({ stream });
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
  const history = await store.read({ stream });
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
  liveState?: Readonly<StateOf<Model>>,
): WorkflowSnapshot<Model> {
  const started = startedEvent(history);
  if (!started) throw new Error(`Workflow ${JSON.stringify(id)} does not exist.`);
  const terminal = terminalEvent(history);
  let persisted = started.state;
  for (const { event } of history) {
    if (
      event.type === "workflow.state" ||
      event.type === "workflow.completed" ||
      event.type === "workflow.failed"
    ) {
      persisted = event.state;
    }
  }
  const state = portable(liveState ?? persisted, "workflow snapshot state") as StateOf<Model>;
  const base = {
    id,
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

function cancelledEvent<Model extends WorkflowModelDefinition>(
  history: History<Model>,
): Extract<WorkflowJournalEvent<Model>, { type: "workflow.cancelled" }> | undefined {
  const event = terminalEvent(history);
  return event?.type === "workflow.cancelled" ? event : undefined;
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

function portable<Value>(value: Value, label: string): Value {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new TypeError(`${label} must be portable data.`, { cause: error });
  }
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

function workflowError(error: unknown): WorkflowError {
  if (error instanceof WorkflowExecutionFailure) return error.failure;
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

class WorkflowStopped extends Error {
  constructor() {
    super("Workflow execution stopped.");
    this.name = "WorkflowStopped";
  }
}
