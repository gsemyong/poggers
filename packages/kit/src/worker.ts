import type {
  ActorOf,
  App,
  AppEventName,
  AppSpec,
  CommandReceipt,
  CommandSpec,
  EnvironmentDeps,
  EnvironmentName,
  ProgramContext,
  ProgramEventItem,
  ResourceSpec,
} from "./app";
import type { JsonValue } from "./protocol";
import { scopeId } from "./protocol";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};

type ErrorFor<Command> = Command extends { error: infer E } ? E : never;

type CommandShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: (
    ...args: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ResourceFor<Spec, Resource>["Commands"][Command]["args"]
      : ResourceFor<Spec, Resource>["Commands"][Command] extends any[]
        ? ResourceFor<Spec, Resource>["Commands"][Command]
        : []
  ) => CommandReceipt<
    ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ErrorFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never
  >;
};

type HookName<Name extends string> = `use${Capitalize<Name>}`;

export type WorkerEventSelector<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = {
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly name: Event;
};

export type WorkerEvent<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = {
  readonly id: string;
  readonly seq: number;
  readonly at: number;
  readonly version: number;
  readonly actor: ActorOf<Spec>;
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly name: Event;
  readonly payload: ResourceFor<Spec, Resource>["Events"][Event];
};

export type WorkerResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
    readonly events: {
      [Event in keyof ResourceFor<Spec, Resource>["Events"] & string]: WorkerEventSelector<
        Spec,
        Resource,
        Event
      >;
    };
  };

export type WorkerEventHandler<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = (ctx: {
  event: WorkerEvent<Spec, Resource, Event>;
  view: ViewShape<Spec, Resource>;
  resource: WorkerResource<Spec, Resource>;
}) => void | Promise<void>;

export type WorkerHandlerOptions = {
  id?: string;
};

export type WorkerOn<Spec extends AppSpec> = {
  <
    Resource extends ResourceName<Spec>,
    Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
  >(
    selector: WorkerEventSelector<Spec, Resource, Event>,
    handler: WorkerEventHandler<Spec, Resource, Event>,
  ): void;
  <
    Resource extends ResourceName<Spec>,
    Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
  >(
    selector: WorkerEventSelector<Spec, Resource, Event>,
    options: WorkerHandlerOptions,
    handler: WorkerEventHandler<Spec, Resource, Event>,
  ): void;
};

export type WorkerHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => WorkerResource<Spec, Resource>;
} & {
  on: WorkerOn<Spec>;
};

export type WorkerDef<Spec extends AppSpec, Deps> = {
  app: App<Spec>;
  setup: (hooks: WorkerHooks<Spec>, deps: Deps) => void | (() => void | Promise<void>);
};

export function defineWorker<Spec extends AppSpec>(app: App<Spec>) {
  return function withDeps<Deps = Record<string, never>>(
    setup: (hooks: WorkerHooks<Spec>, deps: Deps) => void | (() => void | Promise<void>),
  ): WorkerDef<Spec, Deps> {
    return { app, setup };
  };
}

export type WorkerRuntimeEvent<Spec extends AppSpec = AppSpec> = {
  resource: ResourceName<Spec>;
  key: JsonValue;
  event: {
    id: string;
    seq: number;
    at: number;
    version: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  };
};

export type WorkerTestStore<Spec extends AppSpec = AppSpec> = {
  events: WorkerRuntimeEvent<Spec>[];
  completedHandlers: Set<string>;
  checkpoints: Map<string, number>;
};

export type WorkerDurabilityStore = {
  hasCompleted(key: string): boolean | Promise<boolean>;
  markCompleted(key: string): void | Promise<void>;
  getCheckpoint(
    workerId: string,
    scopeId?: string,
  ): number | undefined | Promise<number | undefined>;
  setCheckpoint(workerId: string, cursor: number, scopeId?: string): void | Promise<void>;
};

export function createMemoryWorkerDurabilityStore(): WorkerDurabilityStore {
  const completed = new Set<string>();
  const checkpoints = new Map<string, number>();

  return {
    hasCompleted(key) {
      return completed.has(key);
    },
    markCompleted(key) {
      completed.add(key);
    },
    getCheckpoint(workerId, scopeId) {
      return checkpoints.get(checkpointKey(workerId, scopeId));
    },
    setCheckpoint(workerId, cursor, scopeId) {
      const key = checkpointKey(workerId, scopeId);
      checkpoints.set(key, Math.max(checkpoints.get(key) ?? 0, cursor));
    },
  };
}

export function createFSWorkerDurabilityStore(path: string): WorkerDurabilityStore {
  type Data = {
    completed?: string[];
    checkpoints?: Record<string, number>;
  };

  function load(): Data {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Data;
    } catch {
      return {};
    }
  }

  function save(data: Data) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  }

  return {
    hasCompleted(key) {
      return new Set(load().completed ?? []).has(key);
    },
    markCompleted(key) {
      const data = load();
      const completed = new Set(data.completed ?? []);
      completed.add(key);
      data.completed = [...completed];
      save(data);
    },
    getCheckpoint(workerId, scopeId) {
      return load().checkpoints?.[checkpointKey(workerId, scopeId)];
    },
    setCheckpoint(workerId, cursor, scopeId) {
      const data = load();
      data.checkpoints = data.checkpoints ?? {};
      const key = checkpointKey(workerId, scopeId);
      data.checkpoints[key] = Math.max(data.checkpoints[key] ?? 0, cursor);
      save(data);
    },
  };
}

export function createMemoryWorkerStore<Spec extends AppSpec>(): WorkerTestStore<Spec> {
  return {
    events: [],
    completedHandlers: new Set(),
    checkpoints: new Map(),
  };
}

export type TestWorkerOpts<Spec extends AppSpec, Deps> = {
  deps: Deps;
  store?: WorkerTestStore<Spec>;
  actor?: ActorOf<Spec>;
  workerId?: string;
};

export function testWorker<Spec extends AppSpec, Deps>(
  app: App<Spec>,
  worker: WorkerDef<Spec, Deps>,
  opts: TestWorkerOpts<Spec, Deps>,
) {
  const store = opts.store ?? createMemoryWorkerStore<Spec>();
  const workerId = opts.workerId ?? "test-worker";
  const actor = opts.actor ?? ({ id: workerId } as ActorOf<Spec>);
  const states = new Map<string, any>();
  const seqs = new Map<string, number>();
  const pending: WorkerRuntimeEvent<Spec>[] = [];
  const handlers: Array<{
    id: string;
    selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>;
    handler: WorkerEventHandler<Spec, ResourceName<Spec>, any>;
  }> = [];

  rebuildState();

  const hooks = createWorkerHooks(app, actor, states, seqs, store, pending, handlers);
  const cleanup = worker.setup(hooks, opts.deps);

  pending.push(...store.events);

  function rebuildState() {
    states.clear();
    seqs.clear();
    for (const stored of store.events) {
      const id = scopeId(stored.resource, stored.key);
      const state = getState(app, states, stored.resource, stored.key);
      app.applyEvent(
        stored.resource,
        state,
        {
          id: stored.event.id,
          seq: stored.event.seq,
          at: stored.event.at,
          actor: stored.event.actor,
          name: stored.event.name,
          payload: stored.event.payload,
        },
        stored.event.version,
      );
      seqs.set(id, Math.max(seqs.get(id) ?? 0, stored.event.seq));
    }
  }

  return {
    store,

    resource<Resource extends ResourceName<Spec>>(
      resource: Resource,
      key: ResourceFor<Spec, Resource>["Key"],
    ) {
      return createWorkerResource(app, actor, states, seqs, store, pending, resource, key);
    },

    async drain() {
      while (pending.length > 0) {
        const stored = pending.shift()!;
        const currentStored = upcastWorkerRuntimeEvent(app, stored);
        for (const registered of handlers) {
          if (!matches(registered.selector, currentStored)) continue;
          const completionKey = handlerCompletionKey(workerId, registered.id, currentStored);
          if (store.completedHandlers.has(completionKey)) continue;

          const resource = createWorkerResource(
            app,
            actor,
            states,
            seqs,
            store,
            pending,
            currentStored.resource,
            currentStored.key as never,
          );
          await registered.handler({
            event: {
              ...currentStored.event,
              resource: currentStored.resource,
              key: currentStored.key,
            } as never,
            view: readViews(app, actor, states, currentStored.resource, currentStored.key as never),
            resource,
          });
          store.completedHandlers.add(completionKey);
          store.checkpoints.set(
            checkpointKey(workerId, scopeId(currentStored.resource, currentStored.key)),
            currentStored.event.seq,
          );
        }
      }
    },

    async stop() {
      if (typeof cleanup === "function") await cleanup();
    },
  };
}

export type WorkerRuntimeCommand<Spec extends AppSpec> = <Resource extends ResourceName<Spec>>(
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: keyof ResourceFor<Spec, Resource>["Commands"] & string,
  args: any[],
  commandId: string,
) => CommandReceipt<any>;

export type AppProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = NonNullable<
  NonNullable<App<Spec>["def"]["programs"]>[Env]
>;

export type StartProgramRuntimeOpts<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  env: Env;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
  signal?: AbortSignal;
  readViews: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ViewShape<Spec, Resource>;
  command: WorkerRuntimeCommand<Spec>;
  onError?: (error: unknown) => void;
};

export type StartWorkerRuntimeOpts<Spec extends AppSpec, Deps> = {
  deps: Deps;
  workerId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
  readViews: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ViewShape<Spec, Resource>;
  command: WorkerRuntimeCommand<Spec>;
  onError?: (error: unknown) => void;
};

export type WorkerRuntime<Spec extends AppSpec = AppSpec> = {
  enqueue(events: WorkerRuntimeEvent<Spec> | WorkerRuntimeEvent<Spec>[]): void;
  checkpoint(scopeId: string): Promise<number | undefined>;
  drain(): Promise<void>;
  stop(): Promise<void>;
};

export function startWorkerRuntime<Spec extends AppSpec, Deps>(
  app: App<Spec>,
  worker: WorkerDef<Spec, Deps>,
  opts: StartWorkerRuntimeOpts<Spec, Deps>,
): WorkerRuntime<Spec> {
  const workerId = opts.workerId ?? "worker";
  const store = opts.store ?? createMemoryWorkerDurabilityStore();
  const queue: WorkerRuntimeEvent<Spec>[] = [];
  const handlers: Array<{
    id: string;
    selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>;
    handler: WorkerEventHandler<Spec, ResourceName<Spec>, any>;
  }> = [];
  let activeExecution: { key: string; commandIndex: number } | null = null;
  let drainPromise: Promise<void> | null = null;

  const hooks = createLiveWorkerHooks(
    app,
    opts.readViews,
    opts.command,
    () => activeExecution,
    handlers,
  );
  const cleanup = worker.setup(hooks, opts.deps);

  async function handle(stored: WorkerRuntimeEvent<Spec>) {
    const currentStored = upcastWorkerRuntimeEvent(app, stored);
    const storedScopeId = scopeId(currentStored.resource, currentStored.key);
    let canCheckpoint = true;

    for (const registered of handlers) {
      if (!matches(registered.selector, currentStored)) continue;

      const completionKey = handlerCompletionKey(workerId, registered.id, currentStored);
      if (await store.hasCompleted(completionKey)) continue;

      activeExecution = { key: completionKey, commandIndex: 0 };
      try {
        const resource = createLiveWorkerResource(
          app,
          opts.readViews,
          opts.command,
          () => activeExecution,
          currentStored.resource,
          currentStored.key as never,
        );
        await registered.handler({
          event: {
            ...currentStored.event,
            resource: currentStored.resource,
            key: currentStored.key,
          } as never,
          view: opts.readViews(currentStored.resource, currentStored.key as never),
          resource,
        });
        await store.markCompleted(completionKey);
      } catch (error) {
        canCheckpoint = false;
        opts.onError?.(error);
      } finally {
        activeExecution = null;
      }
    }

    if (canCheckpoint) {
      await store.setCheckpoint(workerId, currentStored.event.seq, storedScopeId);
    }
  }

  async function drainQueue() {
    while (queue.length > 0) {
      await handle(queue.shift()!);
    }
  }

  function scheduleDrain() {
    drainPromise = (drainPromise ?? Promise.resolve())
      .then(drainQueue)
      .catch((error) => {
        opts.onError?.(error);
      })
      .finally(() => {
        drainPromise = null;
        if (queue.length > 0) scheduleDrain();
      });
  }

  return {
    enqueue(events) {
      queue.push(...(Array.isArray(events) ? events : [events]));
      if (!drainPromise) scheduleDrain();
    },

    checkpoint(scopeId) {
      return Promise.resolve(store.getCheckpoint(workerId, scopeId));
    },

    async drain() {
      while (drainPromise || queue.length > 0) {
        if (!drainPromise) scheduleDrain();
        await drainPromise;
      }
    },

    async stop() {
      await this.drain();
      if (typeof cleanup === "function") await cleanup();
    },
  };
}

type ProgramQueuedItem<Spec extends AppSpec> = {
  stored: WorkerRuntimeEvent<Spec>;
  completionKey: string;
  execution: { key: string; commandIndex: number };
  item: ProgramEventItem<Spec, AppEventName<Spec>>;
};

type ProgramConsumer<Spec extends AppSpec> = AsyncIterable<
  ProgramEventItem<Spec, AppEventName<Spec>>
> & {
  readonly durableId: string;
  readonly resource: ResourceName<Spec>;
  readonly name: string;
  enqueue(stored: WorkerRuntimeEvent<Spec>): void;
  isBusy(): boolean;
  close(): void;
};

export function startProgramRuntime<Spec extends AppSpec, Env extends EnvironmentName<Spec>>(
  app: App<Spec>,
  program: AppProgram<Spec, Env>,
  opts: StartProgramRuntimeOpts<Spec, Env>,
): WorkerRuntime<Spec> {
  const programId = opts.programId ?? String(opts.env);
  const actor = opts.actor ?? ({ id: programId } as ActorOf<Spec>);
  const store = opts.store ?? createMemoryWorkerDurabilityStore();
  const controller = new AbortController();
  const consumers = new Set<ProgramConsumer<Spec>>();
  const pendingChecks = new Set<Promise<void>>();
  const idleWaiters = new Set<() => void>();

  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener("abort", () => controller.abort(opts.signal?.reason), {
        once: true,
      });
    }
  }

  function notifyIdleWaiters() {
    const waiters = [...idleWaiters];
    idleWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  function trackPending(task: Promise<void>) {
    pendingChecks.add(task);
    void task.finally(() => {
      pendingChecks.delete(task);
      notifyIdleWaiters();
    });
  }

  const ctx = createProgramContext(
    app,
    actor,
    opts.readViews,
    opts.command,
    programId,
    store,
    controller.signal,
    consumers,
    trackPending,
    notifyIdleWaiters,
  );

  let programResult: void | Promise<void> = undefined;
  try {
    programResult = program(ctx, opts.deps);
  } catch (error) {
    opts.onError?.(error);
    if (!controller.signal.aborted) controller.abort();
  }

  const programPromise = Promise.resolve(programResult)
    .catch((error) => {
      opts.onError?.(error);
    })
    .finally(() => {
      if (!controller.signal.aborted) controller.abort();
      for (const consumer of consumers) consumer.close();
      notifyIdleWaiters();
    });

  return {
    enqueue(events) {
      if (controller.signal.aborted) return;
      const list = Array.isArray(events) ? events : [events];
      for (const stored of list) {
        const currentStored = upcastWorkerRuntimeEvent(app, stored);
        for (const consumer of consumers) {
          if (consumer.resource !== currentStored.resource) continue;
          if (consumer.name !== currentStored.event.name) continue;
          consumer.enqueue(currentStored);
        }
      }
    },

    async checkpoint(id) {
      if (consumers.size === 0) return Number.POSITIVE_INFINITY;
      let seq = Number.POSITIVE_INFINITY;
      for (const consumer of consumers) {
        const checkpoint = await store.getCheckpoint(consumer.durableId, id);
        seq = Math.min(seq, checkpoint ?? 0);
      }
      return seq;
    },

    async drain() {
      for (;;) {
        if (pendingChecks.size > 0) {
          await Promise.all(pendingChecks);
          continue;
        }
        const busy = [...consumers].some((consumer) => consumer.isBusy());
        if (!busy && pendingChecks.size === 0) return;
        await new Promise<void>((resolve) => idleWaiters.add(resolve));
      }
    },

    async stop() {
      if (!controller.signal.aborted) controller.abort();
      for (const consumer of consumers) consumer.close();
      notifyIdleWaiters();
      await programPromise;
    },
  };
}

function createProgramContext<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  readViews: StartProgramRuntimeOpts<Spec, any>["readViews"],
  command: WorkerRuntimeCommand<Spec>,
  programId: string,
  store: WorkerDurabilityStore,
  signal: AbortSignal,
  consumers: Set<ProgramConsumer<Spec>>,
  trackPending: (task: Promise<void>) => void,
  notifyIdleWaiters: () => void,
): ProgramContext<Spec> {
  const hooks: Record<string, unknown> = {
    signal,
  };

  for (const resource of Object.keys(app.def.resources)) {
    hooks[`use${capitalize(resource)}`] = (key: JsonValue) =>
      createLiveWorkerResource(
        app,
        readViews,
        command,
        () => null,
        resource as ResourceName<Spec>,
        key as never,
      );
  }

  hooks.events = (eventName: AppEventName<Spec>, options: { id: string; signal?: AbortSignal }) => {
    if (!options?.id) {
      throw new Error(`events(${JSON.stringify(eventName)}) requires a durable id.`);
    }
    const parsed = parseProgramEventName<Spec>(eventName);
    if (!app.def.resources[parsed.resource]?.events[parsed.name]) {
      throw new Error(`Unknown app event "${eventName}".`);
    }

    const consumer = createProgramConsumer(
      app,
      actor,
      readViews,
      command,
      programId,
      store,
      parsed.resource,
      parsed.name,
      options.id,
      options.signal ?? signal,
      trackPending,
      notifyIdleWaiters,
    );
    consumers.add(consumer);
    const close = () => {
      consumer.close();
      consumers.delete(consumer);
      notifyIdleWaiters();
    };
    if ((options.signal ?? signal).aborted) {
      close();
    } else {
      (options.signal ?? signal).addEventListener("abort", close, { once: true });
    }
    return consumer;
  };

  return hooks as ProgramContext<Spec>;
}

function createProgramConsumer<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  readViews: StartProgramRuntimeOpts<Spec, any>["readViews"],
  command: WorkerRuntimeCommand<Spec>,
  programId: string,
  store: WorkerDurabilityStore,
  resource: ResourceName<Spec>,
  name: string,
  id: string,
  signal: AbortSignal,
  trackPending: (task: Promise<void>) => void,
  notifyIdleWaiters: () => void,
): ProgramConsumer<Spec> {
  const durableId = `${programId}:${id}:${resource}.${name}`;
  const queue: ProgramQueuedItem<Spec>[] = [];
  const waiters: Array<
    (result: IteratorResult<ProgramEventItem<Spec, AppEventName<Spec>>>) => void
  > = [];
  let active: ProgramQueuedItem<Spec> | null = null;
  let closed = false;

  async function ackActive() {
    if (!active) return;
    const current = active;
    active = null;
    await store.markCompleted(current.completionKey);
    await store.setCheckpoint(
      durableId,
      current.stored.event.seq,
      scopeId(current.stored.resource, current.stored.key),
    );
    notifyIdleWaiters();
  }

  function deliver(queued: ProgramQueuedItem<Spec>) {
    if (closed || signal.aborted) return;
    const waiter = waiters.shift();
    if (waiter) {
      active = queued;
      waiter({ done: false, value: queued.item });
    } else {
      queue.push(queued);
    }
    notifyIdleWaiters();
  }

  function done() {
    return { done: true, value: undefined } satisfies IteratorResult<
      ProgramEventItem<Spec, AppEventName<Spec>>
    >;
  }

  function close() {
    if (closed) return;
    closed = true;
    queue.length = 0;
    const currentWaiters = waiters.splice(0);
    for (const waiter of currentWaiters) waiter(done());
    notifyIdleWaiters();
  }

  if (signal.aborted) {
    close();
  } else {
    signal.addEventListener("abort", close, { once: true });
  }

  return {
    durableId,
    resource,
    name,

    enqueue(stored) {
      const completionKey = programCompletionKey(durableId, stored);
      const task = Promise.resolve(store.hasCompleted(completionKey)).then((completed) => {
        if (completed || closed || signal.aborted) return;
        const execution = { key: completionKey, commandIndex: 0 };
        const event = {
          ...stored.event,
          resource: stored.resource,
          key: stored.key,
        } as ProgramEventItem<Spec, AppEventName<Spec>>["event"];
        const handle = createLiveWorkerResource(
          app,
          readViews,
          command,
          () => execution,
          stored.resource,
          stored.key as never,
        );
        const item = {
          event,
          resource: stored.resource,
          key: stored.key,
          view: readViews(stored.resource, stored.key as never),
          [stored.resource]: handle,
        } as unknown as ProgramEventItem<Spec, AppEventName<Spec>>;
        deliver({ stored, completionKey, execution, item });
      });
      trackPending(task);
    },

    isBusy() {
      return active !== null || queue.length > 0;
    },

    close,

    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          await ackActive();
          if (closed || signal.aborted) return done();
          const queued = queue.shift();
          if (queued) {
            active = queued;
            notifyIdleWaiters();
            return { done: false, value: queued.item };
          }
          return new Promise<IteratorResult<ProgramEventItem<Spec, AppEventName<Spec>>>>(
            (resolve) => waiters.push(resolve),
          );
        },
        return: async () => {
          close();
          return done();
        },
      };
    },
  };
}

function parseProgramEventName<Spec extends AppSpec>(eventName: AppEventName<Spec>) {
  const [resource, name] = String(eventName).split(".", 2);
  if (!resource || !name) {
    throw new Error(`App event names must be formatted as "resource.event".`);
  }
  return { resource: resource as ResourceName<Spec>, name };
}

function programCompletionKey<Spec extends AppSpec>(
  durableId: string,
  stored: WorkerRuntimeEvent<Spec>,
) {
  return `${durableId}:${scopeId(stored.resource, stored.key)}:${stored.event.id}`;
}

function createLiveWorkerHooks<Spec extends AppSpec>(
  app: App<Spec>,
  readViews: StartWorkerRuntimeOpts<Spec, any>["readViews"],
  command: WorkerRuntimeCommand<Spec>,
  getActiveExecution: () => { key: string; commandIndex: number } | null,
  handlers: Array<{
    id: string;
    selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>;
    handler: WorkerEventHandler<Spec, ResourceName<Spec>, any>;
  }>,
): WorkerHooks<Spec> {
  const hooks: Record<string, unknown> = {};

  for (const resource of Object.keys(app.def.resources)) {
    hooks[`use${capitalize(resource)}`] = (key: JsonValue) =>
      createLiveWorkerResource(
        app,
        readViews,
        command,
        getActiveExecution,
        resource as ResourceName<Spec>,
        key as never,
      );
  }

  hooks.on = (selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>, ...args: any[]) => {
    const options = typeof args[0] === "function" ? undefined : (args[0] as WorkerHandlerOptions);
    const handler = (typeof args[0] === "function" ? args[0] : args[1]) as WorkerEventHandler<
      Spec,
      ResourceName<Spec>,
      any
    >;
    const id = options?.id ?? `${selector.resource}.${String(selector.name)}.${handlers.length}`;
    handlers.push({ id, selector, handler });
  };

  return hooks as WorkerHooks<Spec>;
}

function createLiveWorkerResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  readViews: StartWorkerRuntimeOpts<Spec, any>["readViews"],
  command: WorkerRuntimeCommand<Spec>,
  getActiveExecution: () => { key: string; commandIndex: number } | null,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): WorkerResource<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const eventSelectors: Record<string, WorkerEventSelector<Spec, Resource, any>> = {};
  for (const eventName of Object.keys(resourceDef.events)) {
    eventSelectors[eventName] = { resource, key, name: eventName };
  }

  const commands: Record<string, (...args: any[]) => CommandReceipt<any>> = {};
  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    commands[commandName] = (...args: any[]) => {
      const active = getActiveExecution();
      const commandId = active
        ? `${active.key}:${commandName}:${active.commandIndex++}`
        : crypto.randomUUID();
      return command(resource, key, commandName, args, commandId);
    };
  }

  return new Proxy(
    {
      events: eventSelectors,
      get view() {
        return readViews(resource, key);
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        const cmd = commands[prop];
        if (cmd) return cmd;
        return readViews(resource, key)[prop as keyof ViewShape<Spec, Resource>];
      },
    },
  ) as WorkerResource<Spec, Resource>;
}

function createWorkerHooks<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  seqs: Map<string, number>,
  store: WorkerTestStore<Spec>,
  pending: WorkerRuntimeEvent<Spec>[],
  handlers: Array<{
    id: string;
    selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>;
    handler: WorkerEventHandler<Spec, ResourceName<Spec>, any>;
  }>,
): WorkerHooks<Spec> {
  const hooks: Record<string, unknown> = {};

  for (const resource of Object.keys(app.def.resources)) {
    hooks[`use${capitalize(resource)}`] = (key: JsonValue) =>
      createWorkerResource(
        app,
        actor,
        states,
        seqs,
        store,
        pending,
        resource as ResourceName<Spec>,
        key as never,
      );
  }

  hooks.on = (selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>, ...args: any[]) => {
    const options = typeof args[0] === "function" ? undefined : (args[0] as WorkerHandlerOptions);
    const handler = (typeof args[0] === "function" ? args[0] : args[1]) as WorkerEventHandler<
      Spec,
      ResourceName<Spec>,
      any
    >;
    const id = options?.id ?? `${selector.resource}.${String(selector.name)}.${handlers.length}`;
    handlers.push({ id, selector, handler });
  };

  return hooks as WorkerHooks<Spec>;
}

function createWorkerResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  seqs: Map<string, number>,
  store: WorkerTestStore<Spec>,
  pending: WorkerRuntimeEvent<Spec>[],
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): WorkerResource<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const eventSelectors: Record<string, WorkerEventSelector<Spec, Resource, any>> = {};
  for (const eventName of Object.keys(resourceDef.events)) {
    eventSelectors[eventName] = { resource, key, name: eventName };
  }

  const commands: Record<string, (...args: any[]) => CommandReceipt<any>> = {};
  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    commands[commandName] = async (...args: any[]) =>
      runTestCommand(app, actor, states, seqs, store, pending, resource, key, commandName, args);
  }

  return new Proxy(
    {
      events: eventSelectors,
      get view() {
        return readViews(app, actor, states, resource, key);
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        const command = commands[prop];
        if (command) return command;
        return readViews(app, actor, states, resource, key)[
          prop as keyof ViewShape<Spec, Resource>
        ];
      },
    },
  ) as WorkerResource<Spec, Resource>;
}

async function runTestCommand<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  seqs: Map<string, number>,
  store: WorkerTestStore<Spec>,
  pending: WorkerRuntimeEvent<Spec>[],
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: string,
  args: any[],
): CommandReceipt<any> {
  const id = scopeId(resource, key);
  const state = getState(app, states, resource, key);
  const collected: Array<{
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }> = [];
  const commandResult: { error?: string; data?: unknown } = {};

  app.runCommand(
    resource,
    state,
    actor,
    key,
    command,
    args,
    (event) => collected.push(event),
    () => {},
    (error, data) => {
      commandResult.error = error;
      commandResult.data = data;
    },
  );

  if (commandResult.error) {
    return {
      ok: false,
      error: commandResult.error,
      data: commandResult.data,
    };
  }

  let cursor = seqs.get(id) ?? 0;
  for (const event of collected) {
    cursor += 1;
    const stored: WorkerRuntimeEvent<Spec> = {
      resource,
      key,
      event: {
        id: event.id,
        seq: cursor,
        at: event.at,
        version: app.def.version,
        actor,
        name: event.name,
        payload: event.payload,
      },
    };
    app.applyEvent(
      resource,
      state,
      {
        id: stored.event.id,
        seq: stored.event.seq,
        at: stored.event.at,
        actor,
        name: stored.event.name,
        payload: stored.event.payload,
      },
      stored.event.version,
    );
    store.events.push(stored);
    pending.push(stored);
  }
  seqs.set(id, cursor);

  return { ok: true, cursor };
}

function getState<Spec extends AppSpec>(
  app: App<Spec>,
  states: Map<string, any>,
  resource: ResourceName<Spec>,
  key: JsonValue,
) {
  const id = scopeId(resource, key);
  let state = states.get(id);
  if (!state) {
    state = app.createState(resource);
    states.set(id, state);
  }
  return state;
}

function readViews<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): ViewShape<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const state = getState(app, states, resource, key);
  const views: Record<string, unknown> = {};
  for (const viewName of Object.keys(resourceDef.views ?? {})) {
    views[viewName] = (resourceDef.views as any)[viewName]({
      state,
      actor,
      sessions: [],
      key,
    });
  }
  return views as ViewShape<Spec, Resource>;
}

function matches<Spec extends AppSpec>(
  selector: WorkerEventSelector<Spec, ResourceName<Spec>, any>,
  stored: WorkerRuntimeEvent<Spec>,
) {
  return (
    selector.resource === stored.resource &&
    selector.name === stored.event.name &&
    scopeId(selector.resource, selector.key) === scopeId(stored.resource, stored.key)
  );
}

function upcastWorkerRuntimeEvent<Spec extends AppSpec>(
  app: App<Spec>,
  stored: WorkerRuntimeEvent<Spec>,
): WorkerRuntimeEvent<Spec> {
  const upcasted = app.upcastEvent(
    stored.resource,
    {
      name: stored.event.name,
      payload: stored.event.payload,
    },
    stored.event.version,
  );

  return {
    ...stored,
    event: {
      ...stored.event,
      version: upcasted.version,
      name: upcasted.name,
      payload: upcasted.payload,
    },
  };
}

function handlerCompletionKey<Spec extends AppSpec>(
  workerId: string,
  handlerId: string,
  stored: WorkerRuntimeEvent<Spec>,
) {
  return `${workerId}:${handlerId}:${scopeId(stored.resource, stored.key)}:${stored.event.id}`;
}

function checkpointKey(workerId: string, scopeId?: string): string {
  return scopeId ? `${workerId}:${scopeId}` : workerId;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
