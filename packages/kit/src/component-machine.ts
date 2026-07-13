import { assign, createActor, createMachine, fromPromise, type InspectionEvent } from "xstate";

declare const __POGGERS_HMR__: boolean;

export type StatechartContext = Readonly<Record<string, unknown>>;

export type StatechartScope = {
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: StatechartContext;
  readonly [service: string]: unknown;
};

export type StatechartUpdate = (
  scope: StatechartScope,
  ...args: readonly unknown[]
) => Record<string, unknown> | void;

export type StatechartTransitionConfig = {
  readonly target?: string | readonly string[];
  readonly allow?: (scope: StatechartScope, ...args: readonly unknown[]) => boolean;
  readonly update?: StatechartUpdate;
  readonly perform?: (scope: StatechartScope, ...args: readonly unknown[]) => void;
  readonly reenter?: boolean;
};

export type StatechartTransition = string | StatechartTransitionConfig;
export type StatechartTransitions = StatechartTransition | readonly StatechartTransition[];

export type StatechartDelayedTransition = StatechartTransitionConfig & {
  readonly wait: number | ((scope: StatechartScope) => number);
};

export type StatechartTaskInvocation = {
  readonly run: string;
  readonly input?: (scope: StatechartScope) => unknown;
  readonly done?: StatechartTransitions;
  readonly fail?: StatechartTransitions;
};

export type StatechartSettlementInvocation = {
  readonly phase: "enter" | "exit";
  readonly done?: string;
  readonly cancelled?: string;
};

export type StatechartNode = {
  readonly type?: "atomic" | "compound" | "parallel" | "final";
  readonly initial?: string;
  readonly states?: Readonly<Record<string, StatechartNode>>;
  readonly on?: Readonly<Record<string, StatechartTransitions>>;
  readonly always?: StatechartTransitions;
  readonly after?: StatechartDelayedTransition | readonly StatechartDelayedTransition[];
  readonly task?: StatechartTaskInvocation | readonly StatechartTaskInvocation[];
  readonly settle?: StatechartSettlementInvocation;
  readonly done?: StatechartTransitions;
  readonly output?: unknown | ((scope: StatechartScope) => unknown);
};

export type StatechartDefinition = StatechartNode & {
  readonly states: Readonly<Record<string, StatechartNode>>;
};

export type StatechartTaskScope = {
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: StatechartContext;
  readonly value: unknown;
  readonly signal: AbortSignal;
};

export type StatechartTask = (scope: StatechartTaskScope) => unknown | Promise<unknown>;

export type StatechartSettlementScope = {
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: StatechartContext;
  readonly phase: "enter" | "exit";
  readonly state: string;
  readonly signal: AbortSignal;
};

export type StatechartSettlementDriver = (scope: StatechartSettlementScope) => void | Promise<void>;

export type StatechartClock = {
  setTimeout(callback: (...args: unknown[]) => void, delay: number): unknown;
  clearTimeout(id: unknown): void;
};

export type StatechartSnapshot = {
  readonly context: StatechartContext;
  readonly value: unknown;
  readonly status: "active" | "done" | "error" | "stopped";
  readonly output: unknown;
  readonly error: unknown;
  matches(path: string): boolean;
  can(event: string, ...args: readonly unknown[]): boolean;
};

export type ComponentActor = {
  readonly paths: readonly string[];
  start(): void;
  stop(): void;
  send(event: string, ...args: readonly unknown[]): void;
  subscribe(observer: (snapshot: StatechartSnapshot) => void): () => void;
  getSnapshot(): StatechartSnapshot;
  getRefreshSnapshot(): unknown;
};

export type CreateComponentActorOptions = {
  readonly id: string;
  readonly definition: StatechartDefinition;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: Record<string, unknown>;
  readonly tasks?: Readonly<Record<string, StatechartTask>>;
  readonly settle?: StatechartSettlementDriver;
  readonly services?: Readonly<Record<string, unknown>>;
  readonly clock?: StatechartClock;
  readonly refreshSnapshot?: unknown;
  readonly inspect?: (event: InspectionEvent) => void;
};

type RuntimeEvent = {
  readonly type: string;
  readonly args?: readonly unknown[];
  readonly output?: unknown;
  readonly error?: unknown;
};

type TaskInput = {
  readonly value: unknown;
  readonly context: StatechartContext;
};

type SettlementInput = TaskInput & {
  readonly phase: "enter" | "exit";
  readonly state: string;
};

type XStateSnapshot = {
  readonly context: Record<string, unknown>;
  readonly value: unknown;
  readonly status: StatechartSnapshot["status"];
  readonly output?: unknown;
  readonly error?: unknown;
  matches(path: string): boolean;
  can(event: RuntimeEvent): boolean;
};

type TransformContext = {
  readonly rootId: string;
  readonly scope: (context: StatechartContext) => StatechartScope;
  readonly delays: Record<string, ({ context }: { context: Record<string, unknown> }) => number>;
  nextDelay: number;
};

export function createComponentActor(options: CreateComponentActorOptions): ComponentActor {
  const rootId = actorId(options.id);
  const scope = (context: StatechartContext): StatechartScope => ({
    ...options.services,
    input: options.input,
    context,
  });
  const actors: Record<string, unknown> = Object.fromEntries(
    Object.entries(options.tasks ?? {}).map(([name, task]) => [
      taskActorName(name),
      fromPromise(async ({ input, signal }: { input: TaskInput; signal: AbortSignal }) =>
        task({
          input: options.input,
          context: input.context,
          value: input.value,
          signal,
        }),
      ),
    ]),
  );
  if (options.settle) {
    actors[settlementActorName] = fromPromise(
      async ({ input, signal }: { input: SettlementInput; signal: AbortSignal }) => {
        return options.settle?.({
          input: options.input,
          context: input.context,
          phase: input.phase,
          state: input.state,
          signal,
        });
      },
    );
  }
  const transform: TransformContext = { rootId, scope, delays: {}, nextDelay: 0 };
  const config = {
    id: rootId,
    context: cloneContext(options.context),
    ...transformStateNode(options.definition, transform, ""),
  };
  const logic = createMachine(config as never, { actors, delays: transform.delays } as never);
  const paths = collectStatePaths(options.definition);
  const topology =
    typeof __POGGERS_HMR__ === "undefined" || __POGGERS_HMR__
      ? statechartTopology(options.definition, options.context)
      : "";
  const persisted =
    typeof __POGGERS_HMR__ === "undefined" || __POGGERS_HMR__ ? options.refreshSnapshot : undefined;
  const restoredSnapshot =
    isRecord(persisted) && persisted.topology === topology ? persisted.snapshot : undefined;
  if (persisted !== undefined && restoredSnapshot === undefined) {
    console.warn(`Poggers reset ${options.id}: incompatible statechart refresh.`);
  }
  const actor = createActor(logic, {
    ...(options.clock ? { clock: options.clock as never } : {}),
    ...(restoredSnapshot === undefined ? {} : { snapshot: restoredSnapshot as never }),
    ...(options.inspect ? { inspect: options.inspect } : {}),
  });
  let started = false;
  let stopped = false;

  return {
    paths,
    start() {
      if (started || stopped) return;
      started = true;
      actor.start();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      actor.stop();
    },
    send(event, ...args) {
      if (stopped) return;
      if (!started) {
        started = true;
        actor.start();
      }
      actor.send({ type: event, args });
    },
    subscribe(observer) {
      const subscription = actor.subscribe((snapshot) =>
        observer(toStatechartSnapshot(snapshot as unknown as XStateSnapshot)),
      );
      return () => subscription.unsubscribe();
    },
    getSnapshot() {
      return toStatechartSnapshot(actor.getSnapshot() as unknown as XStateSnapshot);
    },
    getRefreshSnapshot() {
      return typeof __POGGERS_HMR__ === "undefined" || __POGGERS_HMR__
        ? { topology, snapshot: actor.getPersistedSnapshot() }
        : undefined;
    },
  };
}

function transformStateNode(
  node: StatechartNode,
  transform: TransformContext,
  path: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (node.type) result.type = node.type;
  if (node.initial) result.initial = localInitial(node.initial, path);
  if (node.states) {
    result.states = Object.fromEntries(
      Object.entries(node.states).map(([name, child]) => {
        const childPath = path ? `${path}.${name}` : name;
        return [name, transformStateNode(child, transform, childPath)];
      }),
    );
  }
  if (node.on) {
    result.on = Object.fromEntries(
      Object.entries(node.on).map(([event, transition]) => [
        event,
        transformTransitionList(transition, transform, "event"),
      ]),
    );
  }
  if (node.always) {
    result.always = transformTransitionList(node.always, transform, "event");
  }
  if (node.after) result.after = transformDelayedTransitions(node.after, transform);
  const invocations: Record<string, unknown>[] = [];
  if (node.task) {
    const tasks = Array.isArray(node.task) ? node.task : [node.task];
    invocations.push(...tasks.map((task, index) => transformTask(task, transform, path, index)));
  }
  if (node.settle) invocations.push(transformSettlement(node.settle, transform, path));
  if (invocations.length) result.invoke = invocations;
  if (node.done) {
    result.onDone = transformTransitionList(node.done, transform, "done");
  }
  if (node.output !== undefined) {
    const output = node.output;
    result.output =
      typeof output === "function"
        ? ({ context }: { context: Record<string, unknown> }) => output(transform.scope(context))
        : output;
  }
  return result;
}

function transformDelayedTransitions(
  delayed: StatechartDelayedTransition | readonly StatechartDelayedTransition[],
  transform: TransformContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const item of Array.isArray(delayed) ? delayed : [delayed]) {
    const { wait, ...transition } = item as StatechartDelayedTransition;
    const delay = typeof wait === "number" ? String(wait) : registerDelay(wait, transform);
    const compiled = transformTransition(transition, transform, "event");
    const existing = result[delay];
    result[delay] =
      existing === undefined ? compiled : ([] as unknown[]).concat(existing, compiled);
  }
  return result;
}

function registerDelay(
  wait: (scope: StatechartScope) => number,
  transform: TransformContext,
): string {
  const name = `poggers-delay:${transform.nextDelay++}`;
  transform.delays[name] = ({ context }) => wait(transform.scope(context));
  return name;
}

function transformTask(
  task: StatechartTaskInvocation,
  transform: TransformContext,
  path: string,
  index: number,
): Record<string, unknown> {
  return {
    id: `poggers-task:${path || "root"}:${index}`,
    src: taskActorName(task.run),
    input: ({ context }: { context: Record<string, unknown> }): TaskInput => ({
      value: task.input?.(transform.scope(context)),
      context,
    }),
    ...(task.done ? { onDone: transformTransitionList(task.done, transform, "done") } : {}),
    ...(task.fail ? { onError: transformTransitionList(task.fail, transform, "error") } : {}),
  };
}

function transformSettlement(
  settlement: StatechartSettlementInvocation,
  transform: TransformContext,
  path: string,
): Record<string, unknown> {
  return {
    id: `poggers-settlement:${path || "root"}`,
    src: settlementActorName,
    input: ({ context }: { context: Record<string, unknown> }): SettlementInput => ({
      phase: settlement.phase,
      state: path,
      value: undefined,
      context,
    }),
    ...(settlement.done
      ? { onDone: { target: absoluteTarget(transform.rootId, settlement.done) } }
      : {}),
    ...(settlement.cancelled
      ? { onError: { target: absoluteTarget(transform.rootId, settlement.cancelled) } }
      : {}),
  };
}

function transformTransitionList(
  transition: StatechartTransitions,
  transform: TransformContext,
  outcome: "event" | "done" | "error",
): unknown {
  if (Array.isArray(transition)) {
    return transition.map((item) => transformTransition(item, transform, outcome));
  }
  return transformTransition(transition as StatechartTransition, transform, outcome);
}

function transformTransition(
  transition: StatechartTransition,
  transform: TransformContext,
  outcome: "event" | "done" | "error",
): Record<string, unknown> {
  if (typeof transition === "string") {
    return { target: absoluteTarget(transform.rootId, transition) };
  }
  const actions: unknown[] = [];
  if (transition.update) actions.push(transformUpdate(transition.update, transform.scope, outcome));
  if (transition.perform) {
    const perform = transition.perform;
    actions.push(({ context, event }: { context: Record<string, unknown>; event: unknown }) => {
      const result = (perform as (...args: readonly unknown[]) => unknown)(
        transform.scope(context),
        ...outcomeArguments(event, outcome),
      );
      if (isPromiseLike(result)) {
        throw new TypeError("Statechart perform must be synchronous; use a task for async work.");
      }
    });
  }
  return {
    ...(transition.target
      ? {
          target:
            typeof transition.target === "string"
              ? absoluteTarget(transform.rootId, transition.target)
              : transition.target.map((target) => absoluteTarget(transform.rootId, target)),
        }
      : {}),
    ...(transition.allow
      ? {
          guard: ({ context, event }: { context: Record<string, unknown>; event: unknown }) =>
            transition.allow!(transform.scope(context), ...outcomeArguments(event, outcome)),
        }
      : {}),
    ...(actions.length ? { actions } : {}),
    ...(transition.reenter === undefined ? {} : { reenter: transition.reenter }),
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function transformUpdate(
  update: StatechartUpdate,
  scope: (context: StatechartContext) => StatechartScope,
  outcome: "event" | "done" | "error",
) {
  return assign(({ context, event }) => {
    const patch = update(
      scope(context as Record<string, unknown>),
      ...outcomeArguments(event, outcome),
    );
    if (patch === undefined) return {};
    if (!isRecord(patch)) throw new TypeError("Poggers updates must return a context patch.");
    return patch;
  });
}

function outcomeArguments(event: unknown, outcome: "event" | "done" | "error"): readonly unknown[] {
  const runtimeEvent = event as RuntimeEvent;
  if (outcome === "done") return [runtimeEvent.output];
  if (outcome === "error") return [runtimeEvent.error];
  return Array.isArray(runtimeEvent.args) ? runtimeEvent.args : [];
}

function absoluteTarget(rootId: string, path: string): string {
  if (!path || path.startsWith("#")) {
    throw new Error(`Poggers targets must be absolute state paths, received ${path || "empty"}.`);
  }
  return `#${rootId}.${path}`;
}

function localInitial(initial: string, parent: string): string {
  const prefix = parent ? `${parent}.` : "";
  return prefix && initial.startsWith(prefix) ? initial.slice(prefix.length) : initial;
}

function actorId(id: string): string {
  return `poggers:${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function taskActorName(name: string): string {
  return `task:${name}`;
}

const settlementActorName = "settlement";

function collectStatePaths(definition: StatechartDefinition): string[] {
  const paths: string[] = [];
  const visit = (states: Readonly<Record<string, StatechartNode>>, parent: string) => {
    for (const [name, node] of Object.entries(states)) {
      const path = parent ? `${parent}.${name}` : name;
      paths.push(path);
      if (node.states) visit(node.states, path);
    }
  };
  visit(definition.states, "");
  return paths;
}

function toStatechartSnapshot(snapshot: XStateSnapshot): StatechartSnapshot {
  return {
    context: snapshot.context,
    value: snapshot.value,
    status: snapshot.status,
    output: snapshot.output,
    error: snapshot.error,
    matches(path) {
      return snapshot.matches(path);
    },
    can(event, ...args) {
      return snapshot.can({ type: event, args });
    },
  };
}

function cloneContext(context: Record<string, unknown>): Record<string, unknown> {
  return { ...context };
}

function statechartTopology(definition: StatechartDefinition, context: StatechartContext): string {
  const shape: unknown[] = [];
  const visit = (states: Readonly<Record<string, StatechartNode>>, parent: string) => {
    for (const [name, node] of Object.entries(states)) {
      const path = parent ? `${parent}.${name}` : name;
      const tasks = node.task ? (Array.isArray(node.task) ? node.task : [node.task]) : [];
      shape.push([path, node.type, tasks.map(({ run }) => run), node.settle?.phase]);
      if (node.states) visit(node.states, path);
    }
  };
  visit(definition.states, "");
  return JSON.stringify([Object.keys(context).sort(), shape]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
