import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { parse as parseCel, type ParseResult as CelExpression } from "@marcbachmann/cel-js";
import { Cron } from "croner";

import type {
  ActorOf,
  AppSpec,
  Submission,
  FeatureDef,
  JsonValue,
  ProgramResource,
} from "#kernel/app";
import { maxProtocolBatch } from "#substrate/protocol";

declare const __POGGERS_BROWSER__: boolean;

const workflowHistoryLimit = 256;

export type WorkflowSpec = {
  readonly Input: JsonValue;
  readonly Output: JsonValue;
  readonly Error?: JsonValue;
  readonly Signals?: Readonly<Record<string, JsonValue>>;
  readonly Queries?: Readonly<
    Record<
      string,
      {
        readonly Input: JsonValue;
        readonly Output: JsonValue;
      }
    >
  >;
};

export type WorkflowContract = {
  readonly Workflows: Readonly<Record<string, WorkflowSpec>>;
  readonly Dependencies?: Readonly<Record<string, unknown>>;
};

type WorkflowName<Contract extends WorkflowContract> = Extract<keyof Contract["Workflows"], string>;

type WorkflowFor<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = Contract["Workflows"][Name];

type WorkflowInput<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = WorkflowFor<Contract, Name>["Input"];

type WorkflowOutput<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = WorkflowFor<Contract, Name>["Output"];

type WorkflowError<Contract extends WorkflowContract, Name extends WorkflowName<Contract>> =
  WorkflowFor<Contract, Name> extends { readonly Error: infer Error } ? Error : JsonValue;

type WorkflowSignals<Contract extends WorkflowContract, Name extends WorkflowName<Contract>> =
  WorkflowFor<Contract, Name> extends {
    readonly Signals: infer Signals extends Readonly<Record<string, JsonValue>>;
  }
    ? Signals
    : Record<never, never>;

type WorkflowQueries<Contract extends WorkflowContract, Name extends WorkflowName<Contract>> =
  WorkflowFor<Contract, Name> extends {
    readonly Queries: infer Queries extends Readonly<
      Record<string, { readonly Input: JsonValue; readonly Output: JsonValue }>
    >;
  }
    ? Queries
    : Record<never, never>;

type WorkflowDependencies<Contract extends WorkflowContract> = Contract extends {
  readonly Dependencies: infer Dependencies extends Readonly<Record<string, unknown>>;
}
  ? Dependencies
  : Record<never, never>;

export type WorkflowRunKey = {
  readonly ownerId: string;
  readonly id: string;
};

export type WorkflowRetry = {
  readonly attempts: number;
  readonly delayMs?: number;
  readonly factor?: number;
  readonly maxDelayMs?: number;
};

export type WorkflowEffectContext = {
  readonly attempt: number;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly uncertainAttempts: readonly number[];
};

export type WorkflowContext<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = {
  readonly runId: string;
  readonly ownerId: string;
  readonly now: number;
  readonly attempt: number;
  fail(error: WorkflowError<Contract, Name>): never;
  continueAsNew(input: WorkflowInput<Contract, Name>): never;
  perform<Result extends JsonValue>(
    id: string,
    effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
    options?: { readonly retry?: WorkflowRetry },
  ): Promise<Result>;
  sleep(id: string, durationMs: number): Promise<void>;
  waitFor<Signal extends Extract<keyof WorkflowSignals<Contract, Name>, string>>(
    id: string,
    signal: Signal,
    options?: {
      readonly timeoutMs?: number;
      readonly match?: string;
      readonly condition?: string;
    },
  ): Promise<WorkflowSignals<Contract, Name>[Signal]>;
  invoke<Child extends WorkflowName<Contract>>(
    id: string,
    workflow: Child,
    input: WorkflowInput<Contract, Child>,
    options?: { readonly runId?: string; readonly timeoutMs?: number },
  ): Promise<WorkflowOutput<Contract, Child>>;
};

export type WorkflowDefinition<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = {
  readonly retry?: WorkflowRetry;
  readonly timeoutMs?: number;
  readonly run: (
    context: WorkflowContext<Contract, Name>,
    input: WorkflowInput<Contract, Name>,
    dependencies: Readonly<WorkflowDependencies<Contract>>,
  ) => WorkflowOutput<Contract, Name> | Promise<WorkflowOutput<Contract, Name>>;
};

type WorkflowNameWithQueries<Contract extends WorkflowContract> = {
  [Name in WorkflowName<Contract>]: keyof WorkflowQueries<Contract, Name> extends never
    ? never
    : Name;
}[WorkflowName<Contract>];

export type WorkflowQueryDefinitions<Contract extends WorkflowContract> = {
  readonly [Name in WorkflowNameWithQueries<Contract>]: {
    readonly [Query in keyof WorkflowQueries<Contract, Name>]: (
      run: WorkflowRun<Contract, Name>,
      input: WorkflowQueries<Contract, Name>[Query] extends { readonly Input: infer Input }
        ? Input
        : never,
    ) => WorkflowQueries<Contract, Name>[Query] extends { readonly Output: infer Output }
      ? Output
      : never;
  };
};

export type WorkflowRuntimeDefinition<Contract extends WorkflowContract> = {
  readonly version?: string;
  readonly queries: WorkflowQueryDefinitions<Contract>;
};

export type WorkflowProgramDefinition<Contract extends WorkflowContract> = {
  readonly version?: string;
  readonly workflows: {
    readonly [Name in WorkflowName<Contract>]: WorkflowDefinition<Contract, Name>;
  };
};

export type WorkflowClock = {
  readonly now: () => number;
  readonly sleepUntil: (at: number, signal: AbortSignal) => Promise<void>;
};

type WorkflowOperationStatus =
  | "scheduled"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowOperation = {
  readonly id: string;
  readonly kind: "effect" | "sleep" | "signal" | "workflow";
  readonly status: WorkflowOperationStatus;
  readonly attempt: number;
  readonly retry?: Required<WorkflowRetry>;
  readonly race?: string;
  readonly wakeAt?: number;
  readonly signal?: string;
  readonly signalScope?: "owner";
  readonly signalConflict?: "replace" | "fail";
  readonly match?: string;
  readonly condition?: string;
  readonly workflow?: string;
  readonly runId?: string;
  readonly input?: JsonValue;
  readonly result?: JsonValue;
  readonly error?: JsonValue;
  readonly uncertainAttempts?: readonly number[];
  readonly gated?: true;
  readonly admittedAttempt?: number;
};

export type WorkflowMessage = {
  readonly id: string;
  readonly name: string;
  readonly payload: JsonValue;
  readonly consumedBy?: string;
};

type WorkflowStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type WorkflowRun<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract> = WorkflowName<Contract>,
> = {
  readonly id: string;
  readonly name: Name;
  readonly status: Exclude<WorkflowStatus, "idle">;
  readonly input: WorkflowInput<Contract, Name>;
  readonly output?: WorkflowOutput<Contract, Name>;
  readonly error?: WorkflowError<Contract, Name>;
  readonly operations: Readonly<Record<string, WorkflowOperation>>;
  readonly messages: readonly WorkflowMessage[];
  readonly startedAt: number;
  readonly version?: string;
  readonly generation: number;
  readonly transitionCount: number;
  readonly attempt: number;
  readonly retryAt?: number;
  readonly lastError?: JsonValue;
  readonly revision: number;
  readonly parent?: {
    readonly key: WorkflowRunKey;
    readonly operationId: string;
  };
  readonly history: readonly WorkflowHistoryEntry[];
};

export type WorkflowHistoryEntry = {
  readonly seq: number;
  readonly at: number;
  readonly transition: WorkflowTransition;
};

export type WorkflowRunView<Contract extends WorkflowContract> =
  | { readonly status: "idle"; readonly run: null }
  | {
      readonly status: Exclude<WorkflowStatus, "idle">;
      readonly run: WorkflowRun<Contract>;
    };

type RuntimeWorkflowRun = {
  id: string;
  name: string;
  status: Exclude<WorkflowStatus, "idle">;
  input: JsonValue;
  output?: JsonValue;
  error?: JsonValue;
  operations: Record<string, WorkflowOperation>;
  races: Record<string, { winner?: string; settled: boolean }>;
  messages: WorkflowMessage[];
  startedAt: number;
  version?: string;
  generation: number;
  transitionCount: number;
  attempt: number;
  retryAt?: number;
  lastError?: JsonValue;
  revision: number;
  parent?: {
    key: WorkflowRunKey;
    operationId: string;
  };
  history: WorkflowHistoryEntry[];
};

type WorkflowRunState = {
  run: RuntimeWorkflowRun | null;
};

export type WorkflowTransition =
  | {
      readonly type: "started";
      readonly id: string;
      readonly name: string;
      readonly input: JsonValue;
      readonly version?: string;
      readonly parent?: {
        readonly key: WorkflowRunKey;
        readonly operationId: string;
      };
    }
  | {
      readonly type: "rejected";
      readonly id: string;
      readonly name: string;
      readonly input: JsonValue;
      readonly reason: string;
    }
  | {
      readonly type: "signalReceived";
      readonly id: string;
      readonly name: string;
      readonly payload: JsonValue;
    }
  | { readonly type: "cancelled"; readonly reason?: string }
  | { readonly type: "continued"; readonly input: JsonValue }
  | { readonly type: "operationScheduled"; readonly operation: WorkflowOperation }
  | { readonly type: "operationAdmitted"; readonly id: string; readonly attempt: number }
  | { readonly type: "raceSettled"; readonly race: string }
  | { readonly type: "operationStarted"; readonly id: string; readonly uncertain?: boolean }
  | {
      readonly type: "operationSucceeded";
      readonly id: string;
      readonly kind?: WorkflowOperation["kind"];
      readonly result: JsonValue;
      readonly messageId?: string;
      readonly message?: {
        readonly id: string;
        readonly name: string;
        readonly payload: JsonValue;
      };
      readonly attempt?: number;
      readonly resume?: boolean;
    }
  | {
      readonly type: "operationRetryScheduled";
      readonly id: string;
      readonly error: JsonValue;
      readonly wakeAt: number;
      readonly attempt?: number;
    }
  | {
      readonly type: "operationFailed";
      readonly id: string;
      readonly kind?: WorkflowOperation["kind"];
      readonly error: JsonValue;
      readonly attempt?: number;
      readonly resume?: boolean;
    }
  | {
      readonly type: "executionRetryScheduled";
      readonly error: JsonValue;
      readonly wakeAt: number;
      readonly attempt: number;
    }
  | { readonly type: "executionRetryStarted"; readonly attempt: number }
  | { readonly type: "completed"; readonly output: JsonValue }
  | { readonly type: "failed"; readonly error: JsonValue };

type WorkflowRunResource<Contract extends WorkflowContract> = {
  readonly Key: WorkflowRunKey;
  readonly State: WorkflowRunState;
  readonly Events: { readonly transitioned: WorkflowTransition };
  readonly Views: { readonly run: WorkflowRunView<Contract> };
  readonly Commands: {
    readonly open: {
      Input: {};
      readonly Error: "ready";
    };
    readonly start: {
      Input: { name: WorkflowName<Contract>; input: JsonValue; version?: string };
      readonly Event: "transitioned";
      readonly Error: "already_started";
    };
    readonly signal: {
      Input: { name: string; payload: JsonValue };
      readonly Event: "transitioned";
      readonly Error: "not_running";
    };
    readonly cancel: {
      Input: { reason?: string };
      readonly Event: "transitioned";
      readonly Error: "not_running";
    };
    readonly transition: {
      Input: { transition: WorkflowTransition };
      readonly Event: "transitioned";
      readonly Error: "invalid_transition";
    };
    readonly applyTransitions: {
      Input: { groups: readonly (readonly WorkflowTransition[])[] };
      readonly Event: "transitioned";
      readonly Error: "invalid_transition";
    };
  };
};

type WorkflowScheduleKind =
  | "execution"
  | "effect"
  | "sleep"
  | "signal"
  | "workflow"
  | "run"
  | "admission"
  | "cron";

type WorkflowScheduledItem = {
  readonly id: string;
  readonly key: WorkflowRunKey;
  readonly kind: WorkflowScheduleKind;
  readonly wakeAt: number;
  readonly generation?: number;
  readonly operationId?: string;
  readonly attempt?: number;
  readonly functionId?: string;
  readonly cron?: string;
  readonly jitterMs?: number;
  readonly scheduledAt?: number;
};

type WorkflowSchedulerState = {
  scheduled: Record<string, WorkflowScheduledItem>;
  heap: string[];
  positions: Record<string, number>;
};

type WorkflowSchedulerResource = {
  readonly Key: { readonly id: "workflows" };
  readonly State: WorkflowSchedulerState;
  readonly Events: {
    readonly changed: {
      readonly id: string;
      readonly item: WorkflowScheduledItem | null;
    };
  };
  readonly Views: {
    readonly next: WorkflowScheduledItem | null;
    readonly scheduled: readonly WorkflowScheduledItem[];
  };
  readonly Commands: {
    readonly open: {
      Input: {};
      readonly Error: "ready";
    };
    readonly schedule: {
      Input: WorkflowScheduledItem;
      readonly Event: "changed";
      readonly Error: "unchanged";
    };
    readonly remove: {
      Input: { id: string; wakeAt: number };
      readonly Event: "changed";
      readonly Error: "missing";
    };
  };
};

type WorkflowFeatureDependencies<Contract extends WorkflowContract> =
  WorkflowDependencies<Contract> & {
    readonly clock?: WorkflowClock;
  };

export type WorkflowFeature<Contract extends WorkflowContract> = {
  readonly Resources: {
    readonly runs: WorkflowRunResource<Contract>;
    readonly scheduler: WorkflowSchedulerResource;
  };
  readonly Components: {};
  readonly Dependencies: {
    readonly server: WorkflowFeatureDependencies<Contract>;
  };
  readonly Programs: {
    readonly server: {
      readonly runScheduler: {};
      readonly wakeScheduler: { readonly Events: readonly ["scheduler.changed"] };
      readonly controlRuns: { readonly Events: readonly ["runs.transitioned"] };
      readonly orchestrateRuns: { readonly Events: readonly ["runs.transitioned"] };
      readonly scheduleRuns: {
        readonly Events: readonly ["runs.transitioned"];
        readonly Key: string;
        readonly KeyVersion: 1;
      };
    };
  };
  readonly API: WorkflowAPI<Contract>;
};

export type WorkflowHandle<
  Contract extends WorkflowContract,
  Name extends WorkflowName<Contract>,
> = {
  readonly run: WorkflowRun<Contract, Name> | null;
  start(input: WorkflowInput<Contract, Name>): Submission<"already_started">;
  signal<Signal extends Extract<keyof WorkflowSignals<Contract, Name>, string>>(
    name: Signal,
    payload: WorkflowSignals<Contract, Name>[Signal],
  ): Submission<"not_running">;
  cancel(reason?: string): Submission<"not_running">;
  query<Query extends Extract<keyof WorkflowQueries<Contract, Name>, string>>(
    name: Query,
    input: WorkflowQueries<Contract, Name>[Query] extends { readonly Input: infer Input }
      ? Input
      : never,
  ): WorkflowQueries<Contract, Name>[Query] extends { readonly Output: infer Output }
    ? Output
    : never;
};

export type WorkflowAPI<Contract extends WorkflowContract> = {
  getWorkflow<Name extends WorkflowName<Contract>>(
    name: Name,
    id: string,
  ): WorkflowHandle<Contract, Name>;
};

type WorkflowProgramResource = ProgramResource<
  {
    Resources: { runs: WorkflowRunResource<WorkflowContract> };
  },
  "runs"
>;

type WorkflowSchedulerProgramResource = ProgramResource<
  {
    Resources: { scheduler: WorkflowSchedulerResource };
  },
  "scheduler"
>;

type RuntimeDefinition = WorkflowProgramDefinition<WorkflowContract>;
type RuntimeWorkflowDefinition = WorkflowDefinition<WorkflowContract, string>;

type RuntimeWorkflowEvent = {
  readonly at: number;
  readonly key: WorkflowRunKey;
  readonly payload: WorkflowTransition;
};

type WorkflowProgramItem = {
  readonly event: RuntimeWorkflowEvent;
  readonly runs: WorkflowProgramResource;
  readonly createIdempotencyKey: (label: string) => string;
  readonly delivery: {
    readonly attempt: number;
    readonly uncertainAttempts: readonly number[];
  };
};

type WorkflowSchedulerProgramItem = {
  readonly event: {
    readonly key: { readonly id: "workflows" };
    readonly payload: { readonly id: string; readonly item: WorkflowScheduledItem | null };
  };
};

type FeatureProgramBind<Items extends Record<string, { readonly event: unknown }>> = <
  const Names extends readonly [Extract<keyof Items, string>, ...Extract<keyof Items, string>[]],
>(options: {
  readonly id: string;
  readonly events: Names;
  readonly startAt: "origin" | "now";
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly partitionBy?: (input: { readonly event: Items[Names[number]]["event"] }) => JsonValue;
  readonly partitionRevision?: number;
  readonly run: (item: Items[Names[number]]) => void | Promise<void>;
}) => Promise<Readonly<{ close(): void }>>;

type WorkflowProgramItems = {
  readonly "runs.transitioned": WorkflowProgramItem;
  readonly "scheduler.changed": WorkflowSchedulerProgramItem;
};

type WorkflowProgramContext = {
  readonly actor: { readonly id: string };
  readonly signal: AbortSignal;
  readonly resources: {
    readonly runs: (key: WorkflowRunKey) => WorkflowProgramResource;
    readonly scheduler: (key: { readonly id: "workflows" }) => WorkflowSchedulerProgramResource;
  };
  readonly bind: FeatureProgramBind<WorkflowProgramItems>;
};

type BoundProgramOptions = {
  readonly id: string;
  readonly events: readonly string[];
  readonly startAt: "origin" | "now";
  readonly partitionBy?: (input: { readonly event: unknown }) => JsonValue;
  readonly partitionRevision?: number;
  readonly run: (item: unknown) => void | Promise<void>;
};

type BoundProgramDescriptor = {
  readonly id: string;
  readonly events: readonly string[];
  readonly replay: "all" | "new";
  readonly key: "resource" | Readonly<{ version: number }>;
};

type BoundProgramGeneration = {
  readonly handlers: Map<string, BoundProgramOptions["run"]>;
  readonly ready: ReturnType<typeof Promise.withResolvers<void>>;
};

function bindProgramHandlers(
  runtime: (
    context: Readonly<Record<string, unknown>>,
    dependencies: unknown,
  ) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>,
  descriptors: readonly BoundProgramDescriptor[],
) {
  const definitions = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  let active: BoundProgramGeneration | undefined;
  let activation = Promise.withResolvers<BoundProgramGeneration>();

  return {
    async run(context: Readonly<Record<string, unknown>>, dependencies: unknown) {
      if (active) throw new Error("A Program handler generation is already active.");
      const generation: BoundProgramGeneration = {
        handlers: new Map(),
        ready: Promise.withResolvers<void>(),
      };
      active = generation;
      activation.resolve(generation);
      const bind = async (options: BoundProgramOptions) => {
        const descriptor = definitions.get(options.id);
        if (!descriptor) {
          throw new Error(
            `Program runtime bound undeclared handler ${JSON.stringify(options.id)}.`,
          );
        }
        if (generation.handlers.has(options.id)) {
          throw new Error(`Program runtime bound handler ${JSON.stringify(options.id)} twice.`);
        }
        if (
          options.startAt !== (descriptor.replay === "all" ? "origin" : "now") ||
          options.events.length !== descriptor.events.length ||
          options.events.some((event, index) => event !== descriptor.events[index])
        ) {
          throw new Error(
            `Program handler ${JSON.stringify(options.id)} disagrees with its source.`,
          );
        }
        if (
          (descriptor.key === "resource" && options.partitionBy !== undefined) ||
          (descriptor.key !== "resource" &&
            (options.partitionBy === undefined ||
              options.partitionRevision !== descriptor.key.version))
        ) {
          throw new Error(`Program handler ${JSON.stringify(options.id)} disagrees with its key.`);
        }
        generation.handlers.set(options.id, options.run);
        return Object.freeze({ close() {} });
      };
      const task = Promise.resolve(runtime(Object.freeze({ ...context, bind }), dependencies));
      await Promise.resolve();
      if (generation.handlers.size !== definitions.size) {
        const missing = [...definitions.keys()].filter((id) => !generation.handlers.has(id));
        const error = new Error(`Program runtime did not bind handlers: ${missing.join(", ")}.`);
        generation.ready.reject(error);
        await task.catch(() => undefined);
        throw error;
      }
      generation.ready.resolve();
      try {
        return await task;
      } finally {
        if (active === generation) {
          active = undefined;
          activation = Promise.withResolvers<BoundProgramGeneration>();
        }
      }
    },
    async handle(id: string, item: unknown) {
      const generation = active ?? (await activation.promise);
      await generation.ready.promise;
      const handler = generation.handlers.get(id);
      if (!handler) throw new Error(`Program handler ${JSON.stringify(id)} is unavailable.`);
      await handler(item);
    },
  };
}

type WorkflowCommandContext = {
  readonly state: WorkflowRunState;
  readonly key: WorkflowRunKey;
  readonly event: { readonly transitioned: (transition: WorkflowTransition) => void };
  readonly error: (code: string) => void;
  readonly id: () => string;
  readonly now: () => number;
};

type WorkflowAPIContext = {
  readonly actor: { readonly id: string };
  readonly resources: {
    readonly runs: (key: WorkflowRunKey) => WorkflowProgramResource;
  };
};

const defaultClock: WorkflowClock = {
  now: Date.now,
  async sleepUntil(at, signal) {
    const delay = Math.max(0, at - Date.now());
    if (delay === 0) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", abort);
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, delay);
      const abort = () => {
        clearTimeout(timeout);
        cleanup();
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  },
};

function normalizeRetry(retry: WorkflowRetry | undefined): Required<WorkflowRetry> {
  const normalized = {
    attempts: retry?.attempts ?? 1,
    delayMs: retry?.delayMs ?? 0,
    factor: retry?.factor ?? 2,
    maxDelayMs: retry?.maxDelayMs ?? Number.MAX_SAFE_INTEGER,
  };
  if (!Number.isSafeInteger(normalized.attempts) || normalized.attempts <= 0) {
    throw new TypeError("Workflow retry attempts must be a positive integer.");
  }
  if (!Number.isFinite(normalized.delayMs) || normalized.delayMs < 0) {
    throw new TypeError("Workflow retry delayMs must be a finite non-negative number.");
  }
  if (!Number.isFinite(normalized.factor) || normalized.factor < 1) {
    throw new TypeError(
      "Workflow retry factor must be a finite number greater than or equal to 1.",
    );
  }
  if (!Number.isFinite(normalized.maxDelayMs) || normalized.maxDelayMs < 0) {
    throw new TypeError("Workflow retry maxDelayMs must be a finite non-negative number.");
  }
  return normalized;
}

function assertOperationId(id: string): void {
  if (!id.trim()) throw new TypeError("A workflow operation id cannot be empty.");
}

function assertDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
}

function asJson(error: unknown, seen = new Set<unknown>()): JsonValue {
  if (
    error === null ||
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return error;
  }
  if (error instanceof Error) {
    if (seen.has(error)) return `[Circular ${error.name}]`;
    seen.add(error);
    const value: Record<string, JsonValue> = { name: error.name, message: error.message };
    if (error.stack) value.stack = error.stack;
    if (error.cause !== undefined) value.cause = asJson(error.cause, seen);
    if ("retryAfter" in error && typeof error.retryAfter === "string") {
      value.retryAfter = error.retryAfter;
    }
    if ("stepId" in error && typeof error.stepId === "string") value.stepId = error.stepId;
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(error)) as JsonValue;
  } catch {
    return String(error);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isTerminal(status: WorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function canSettleRaceOperation(run: RuntimeWorkflowRun, operation: WorkflowOperation): boolean {
  if (!operation.race) return true;
  const winner = run.races[operation.race]?.winner;
  return winner === undefined || winner === operation.id;
}

function winOperationRace(run: RuntimeWorkflowRun, operation: WorkflowOperation): void {
  if (!operation.race) return;
  const race = run.races[operation.race] ?? { settled: false };
  race.winner ??= operation.id;
  run.races[operation.race] = race;
  for (const sibling of Object.values(run.operations)) {
    if (
      sibling.id !== operation.id &&
      sibling.race === operation.race &&
      sibling.status !== "succeeded" &&
      sibling.status !== "failed" &&
      sibling.status !== "cancelled"
    ) {
      run.operations[sibling.id] = { ...sibling, status: "cancelled" };
    }
  }
}

function canApplyTransition(state: WorkflowRunState, transition: WorkflowTransition): boolean {
  if (transition.type === "started" || transition.type === "rejected") return state.run === null;
  const run = state.run;
  if (!run) return false;
  const active = !isTerminal(run.status);
  switch (transition.type) {
    case "signalReceived":
    case "cancelled":
    case "continued":
    case "completed":
    case "failed":
      return active;
    case "operationScheduled": {
      if (!active) return false;
      const operation = run.operations[transition.operation.id];
      return operation === undefined || operation.status === "waiting";
    }
    case "operationAdmitted": {
      const operation = run.operations[transition.id];
      return (
        active &&
        operation?.kind === "effect" &&
        (operation.status === "scheduled" || operation.status === "running") &&
        transition.attempt === operation.attempt + 1 &&
        operation.admittedAttempt !== transition.attempt
      );
    }
    case "raceSettled": {
      const race = run.races[transition.race];
      return active && race !== undefined && !race.settled;
    }
    case "operationStarted":
      return (
        active &&
        (run.operations[transition.id]?.status === "scheduled" ||
          run.operations[transition.id]?.status === "running")
      );
    case "operationSucceeded": {
      const operation = run.operations[transition.id];
      return (
        active &&
        (operation?.status === "scheduled" || operation?.status === "running") &&
        canSettleRaceOperation(run, operation)
      );
    }
    case "operationRetryScheduled":
      return active && run.operations[transition.id]?.status === "running";
    case "operationFailed": {
      const operation = run.operations[transition.id];
      return (
        active &&
        (operation?.status === "scheduled" || operation?.status === "running") &&
        canSettleRaceOperation(run, operation)
      );
    }
    case "executionRetryScheduled":
      return active && run.retryAt === undefined && transition.attempt === run.attempt + 1;
    case "executionRetryStarted":
      return active && run.retryAt !== undefined && transition.attempt === run.attempt + 1;
  }
}

function canApplyTransitionGroup(
  state: WorkflowRunState,
  group: readonly WorkflowTransition[],
): boolean {
  if (group.length === 1) return canApplyTransition(state, group[0]!);
  if (group.length !== 2) return false;
  const [scheduled, started] = group;
  return (
    scheduled?.type === "operationScheduled" &&
    started?.type === "operationStarted" &&
    scheduled.operation.id === started.id &&
    canApplyTransition(state, scheduled)
  );
}

function createWorkflowTransitionShadow(state: WorkflowRunState): WorkflowRunState {
  const run = state.run;
  if (!run) return { run: null };
  return {
    run: {
      ...run,
      operations: { ...run.operations },
      races: Object.fromEntries(
        Object.entries(run.races).map(([name, race]) => [name, { ...race }]),
      ),
      messages: [...run.messages],
      history: [],
    },
  };
}

function applyTransition(
  state: WorkflowRunState,
  transition: WorkflowTransition,
  meta: { readonly seq: number; readonly at: number },
): void {
  if (!canApplyTransition(state, transition)) return;
  if (transition.type === "started" || transition.type === "rejected") {
    state.run = {
      id: transition.id,
      name: transition.name,
      status: transition.type === "started" ? "running" : "cancelled",
      input: transition.input,
      operations: {},
      races: {},
      messages: [],
      startedAt: meta.at,
      ...(transition.type === "started" && transition.version !== undefined
        ? { version: transition.version }
        : {}),
      generation: 0,
      transitionCount: 1,
      attempt: 0,
      revision: meta.seq,
      ...(transition.type === "started" && transition.parent ? { parent: transition.parent } : {}),
      history: [{ ...meta, transition }],
      ...(transition.type === "rejected" ? { error: transition.reason } : {}),
    };
    return;
  }
  const run = state.run;
  if (!run) return;
  run.revision = meta.seq;
  run.transitionCount += 1;
  run.history.push({ ...meta, transition });
  if (run.history.length > workflowHistoryLimit) {
    run.history.splice(0, run.history.length - workflowHistoryLimit);
  }
  switch (transition.type) {
    case "signalReceived":
      if (!isTerminal(run.status)) {
        run.messages.push({
          id: transition.id,
          name: transition.name,
          payload: transition.payload,
        });
      }
      break;
    case "cancelled":
      if (!isTerminal(run.status)) {
        run.status = "cancelled";
        run.error = transition.reason ?? "cancelled";
        for (const operation of Object.values(run.operations)) {
          if (operation.status !== "succeeded" && operation.status !== "failed") {
            run.operations[operation.id] = { ...operation, status: "cancelled" };
          }
        }
      }
      break;
    case "continued":
      run.input = transition.input;
      run.operations = {};
      run.races = {};
      run.messages = [];
      run.startedAt = meta.at;
      run.generation += 1;
      run.attempt = 0;
      delete run.output;
      delete run.error;
      delete run.retryAt;
      delete run.lastError;
      run.history = [{ ...meta, transition }];
      break;
    case "operationScheduled": {
      if (isTerminal(run.status)) break;
      const current = run.operations[transition.operation.id];
      if (!current) {
        run.operations[transition.operation.id] = transition.operation;
        if (transition.operation.race) {
          run.races[transition.operation.race] ??= { settled: false };
        }
      } else if (current.status === "waiting") {
        run.operations[transition.operation.id] = { ...current, status: "scheduled" };
      }
      break;
    }
    case "operationAdmitted": {
      const operation = run.operations[transition.id];
      if (
        operation?.kind === "effect" &&
        (operation.status === "scheduled" || operation.status === "running")
      ) {
        run.operations[transition.id] = {
          ...operation,
          admittedAttempt: transition.attempt,
        };
      }
      break;
    }
    case "raceSettled":
      run.races[transition.race]!.settled = true;
      for (const operation of Object.values(run.operations)) {
        if (
          operation.race === transition.race &&
          operation.status !== "succeeded" &&
          operation.status !== "failed" &&
          operation.status !== "cancelled"
        ) {
          run.operations[operation.id] = { ...operation, status: "cancelled" };
        }
      }
      break;
    case "operationStarted": {
      const operation = run.operations[transition.id];
      if (operation?.status === "scheduled" || operation?.status === "running") {
        const uncertainAttempts = transition.uncertain
          ? [...(operation.uncertainAttempts ?? []), operation.attempt]
          : operation.uncertainAttempts;
        const { error: _error, ...current } = operation;
        run.operations[transition.id] = {
          ...current,
          status: "running",
          attempt: operation.attempt + 1,
          ...(uncertainAttempts?.length ? { uncertainAttempts } : {}),
        };
      }
      break;
    }
    case "operationSucceeded": {
      const operation = run.operations[transition.id];
      if (operation && !isTerminal(run.status) && operation.status !== "succeeded") {
        const { error: _error, ...current } = operation;
        run.operations[transition.id] = {
          ...current,
          status: "succeeded",
          attempt: transition.attempt ?? operation.attempt,
          result: transition.result,
        };
        winOperationRace(run, operation);
        if (transition.message && !run.messages.some(({ id }) => id === transition.message?.id)) {
          run.messages.push({ ...transition.message, consumedBy: transition.id });
        }
        if (transition.messageId) {
          const messageIndex = run.messages.findIndex(({ id }) => id === transition.messageId);
          const message = run.messages[messageIndex];
          if (message && !message.consumedBy) {
            run.messages[messageIndex] = { ...message, consumedBy: transition.id };
          }
        }
      }
      break;
    }
    case "operationRetryScheduled": {
      const operation = run.operations[transition.id];
      if (operation?.status === "running" && !isTerminal(run.status)) {
        run.operations[transition.id] = {
          ...operation,
          status: "waiting",
          attempt: transition.attempt ?? operation.attempt,
          wakeAt: transition.wakeAt,
          error: transition.error,
        };
      }
      break;
    }
    case "operationFailed": {
      const operation = run.operations[transition.id];
      if (operation && !isTerminal(run.status)) {
        run.operations[transition.id] = {
          ...operation,
          status: "failed",
          attempt: transition.attempt ?? operation.attempt,
          error: transition.error,
        };
        winOperationRace(run, operation);
      }
      break;
    }
    case "executionRetryScheduled":
      run.retryAt = transition.wakeAt;
      run.lastError = transition.error;
      break;
    case "executionRetryStarted":
      run.attempt = transition.attempt;
      delete run.retryAt;
      break;
    case "completed":
      if (!isTerminal(run.status)) {
        run.status = "completed";
        run.output = transition.output;
      }
      break;
    case "failed":
      if (!isTerminal(run.status)) {
        run.status = "failed";
        run.error = transition.error;
      }
      break;
  }
}

function createPending<Value>(): Promise<Value> {
  return new Promise(() => undefined);
}

function assertOperationDeclaration(
  operation: WorkflowOperation | undefined,
  id: string,
  kind: WorkflowOperation["kind"],
  race: string | undefined,
): void {
  if (!operation) return;
  if (operation.kind !== kind || operation.race !== race) {
    throw new TypeError(
      `Workflow operation ${JSON.stringify(id)} changed from ${operation.kind}/${operation.race ?? "unscoped"} to ${kind}/${race ?? "unscoped"}.`,
    );
  }
}

export class WorkflowOperationError extends Error {
  constructor(readonly value: JsonValue) {
    super(typeof value === "string" ? value : "Workflow operation failed.");
    this.name = "WorkflowOperationError";
  }
}

class WorkflowInfrastructureError extends Error {
  constructor(override readonly cause: unknown) {
    super("Workflow infrastructure failed.");
    this.name = "WorkflowInfrastructureError";
  }
}

class ContinueWorkflowAsNew extends Error {
  constructor(readonly input: JsonValue) {
    super("Continue workflow as new.");
    this.name = "ContinueWorkflowAsNew";
  }
}

function errorFromJson(value: JsonValue): Error {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Error(typeof value === "string" ? value : JSON.stringify(value));
  }
  const error = new Error(
    typeof value.message === "string" ? value.message : "Workflow step failed.",
  );
  if (typeof value.name === "string") error.name = value.name;
  if (typeof value.stack === "string") error.stack = value.stack;
  if (value.cause !== undefined) error.cause = errorFromJson(value.cause);
  return error;
}

export class StepError extends Error {
  override readonly cause?: unknown;

  constructor(
    readonly stepId: string,
    value: JsonValue,
  ) {
    const error = errorFromJson(value);
    super(error.message);
    this.name = error.name;
    this.stack = error.stack;
    this.cause = error.cause;
  }
}

export class NonRetriableError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = "NonRetriableError";
    this.cause = options?.cause;
  }
}

export class RetryAfterError extends Error {
  override readonly cause?: unknown;
  readonly retryAfter: string;

  constructor(
    message: string,
    retryAfter: number | string | Date,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = "RetryAfterError";
    if (retryAfter instanceof Date) {
      const instant = retryAfter.getTime();
      if (!Number.isFinite(instant)) throw new TypeError("retryAfter must be a valid Date.");
      this.retryAfter = retryAfter.toISOString();
    } else {
      const milliseconds = durationMs(retryAfter, "retryAfter");
      this.retryAfter = String(Math.ceil(milliseconds / 1_000));
    }
    this.cause = options?.cause;
  }
}

function hasErrorName(error: unknown, name: string): error is { readonly name: string } {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

function isNonRetriableError(error: unknown): boolean {
  return error instanceof NonRetriableError || hasErrorName(error, "NonRetriableError");
}

function retryAfterFromError(error: unknown): string | undefined {
  if (!hasErrorName(error, "RetryAfterError") || !("retryAfter" in error)) return undefined;
  return typeof error.retryAfter === "string" ? error.retryAfter : undefined;
}

export function isWorkflowOperationError(error: unknown, value?: JsonValue): boolean {
  return (
    error instanceof WorkflowOperationError &&
    (value === undefined || Object.is(error.value, value))
  );
}

type ExecutionDecision = WorkflowTransition;

type WorkflowEffectGate = (attempt: number) => boolean | Promise<boolean>;

const workflowEffectBlocked = Symbol("workflowEffectBlocked");

type WorkflowEffectExecutor = <Result extends JsonValue>(
  id: string,
  effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
  retry: Required<WorkflowRetry>,
  race?: string,
  gate?: WorkflowEffectGate,
) => Promise<Result>;

type WorkflowEffectRunner = <Result extends JsonValue>(
  id: string,
  effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
  retry: Required<WorkflowRetry>,
  onBlocked: () => void,
  race?: string,
  shouldResume?: () => boolean,
  gate?: WorkflowEffectGate,
) => Promise<Result | typeof workflowEffectBlocked>;

type WaitForWorkflowOperation = <Result>(id: string) => Promise<Result>;

const withWorkflowRace = Symbol("withWorkflowRace");
const settleWorkflowRace = Symbol("settleWorkflowRace");
const waitForFunctionSignal = Symbol("waitForFunctionSignal");
const assertWorkflowReplay = Symbol("assertWorkflowReplay");
const performGatedWorkflowEffect = Symbol("performGatedWorkflowEffect");

type InternalWorkflowContext = WorkflowContext<WorkflowContract, string> & {
  [assertWorkflowReplay](): void;
  [withWorkflowRace]<Result>(race: string | undefined, run: () => Result): Result;
  [settleWorkflowRace](race: string): void;
  [performGatedWorkflowEffect]<Result extends JsonValue>(
    id: string,
    effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
    options: { readonly retry?: WorkflowRetry } | undefined,
    gate: WorkflowEffectGate,
  ): Promise<Result>;
  [waitForFunctionSignal](
    id: string,
    signal: string,
    options: {
      readonly timeoutMs: number;
      readonly conflict: "replace" | "fail";
    },
  ): Promise<JsonValue>;
};

function createExecution(
  run: RuntimeWorkflowRun,
  getNow: () => number,
  onDecision: (decision: ExecutionDecision) => void,
  ownerId = "",
  executeEffect?: WorkflowEffectExecutor,
  waitForOperation: WaitForWorkflowOperation = () => createPending(),
  onDeclarationError?: (error: unknown) => void,
): InternalWorkflowContext {
  const observed = new Set<string>();
  const unobservedReplayOperations = new Set(Object.keys(run.operations));
  let currentRace: string | undefined;
  const observe = (id: string): void => {
    try {
      assertOperationId(id);
      if (observed.has(id)) {
        throw new TypeError(`Workflow operation ${JSON.stringify(id)} is declared more than once.`);
      }
      observed.add(id);
      if (!unobservedReplayOperations.delete(id) && unobservedReplayOperations.size > 0) {
        throw new TypeError(
          `Workflow recovery declared new operation ${JSON.stringify(id)} before replaying ${JSON.stringify([...unobservedReplayOperations])}.`,
        );
      }
    } catch (error) {
      onDeclarationError?.(error);
      throw error;
    }
  };
  const performEffect = <Result extends JsonValue>(
    id: string,
    effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
    options: { readonly retry?: WorkflowRetry } | undefined,
    gate?: WorkflowEffectGate,
  ): Promise<Result> => {
    observe(id);
    const operation = run.operations[id];
    assertOperationDeclaration(operation, id, "effect", currentRace);
    if (operation?.status === "succeeded") return Promise.resolve(operation.result as Result);
    if (operation?.status === "failed") {
      return Promise.reject(new WorkflowOperationError(operation.error ?? null));
    }
    if (executeEffect) {
      return executeEffect(id, effect, normalizeRetry(options?.retry), currentRace, gate);
    }
    if (!operation) {
      onDecision({
        type: "operationScheduled",
        operation: {
          id,
          kind: "effect",
          status: "scheduled",
          attempt: 0,
          retry: normalizeRetry(options?.retry),
          ...(currentRace ? { race: currentRace } : {}),
          ...(gate ? { gated: true } : {}),
        },
      });
    }
    return waitForOperation(id);
  };
  return {
    runId: run.id,
    ownerId,
    get now() {
      return getNow();
    },
    attempt: run.attempt,
    [assertWorkflowReplay]() {
      if (unobservedReplayOperations.size === 0) return;
      throw new TypeError(
        `Workflow recovery completed without replaying operations ${JSON.stringify([...unobservedReplayOperations])}.`,
      );
    },
    fail(error) {
      throw new WorkflowOperationError(error);
    },
    continueAsNew(input) {
      throw new ContinueWorkflowAsNew(input);
    },
    [withWorkflowRace](race, execute) {
      const previous = currentRace;
      currentRace = race;
      try {
        return execute();
      } finally {
        currentRace = previous;
      }
    },
    [settleWorkflowRace](race) {
      onDecision({ type: "raceSettled", race });
    },
    [performGatedWorkflowEffect](id, effect, options, gate) {
      return performEffect(id, effect, options, gate);
    },
    [waitForFunctionSignal](id, signal, options) {
      observe(id);
      assertDuration(options.timeoutMs, "Function signal timeout");
      const operation = run.operations[id];
      assertOperationDeclaration(operation, id, "signal", currentRace);
      if (operation?.status === "succeeded") return Promise.resolve(operation.result ?? null);
      if (operation?.status === "failed") {
        return Promise.reject(new WorkflowOperationError(operation.error ?? null));
      }
      if (!operation) {
        onDecision({
          type: "operationScheduled",
          operation: {
            id,
            kind: "signal",
            status: "scheduled",
            attempt: 0,
            signal,
            signalScope: "owner",
            signalConflict: options.conflict,
            ...(currentRace ? { race: currentRace } : {}),
            wakeAt: getNow() + Math.max(0, options.timeoutMs),
          },
        });
      }
      return waitForOperation(id);
    },
    perform(id, effect, options) {
      return performEffect(id, effect, options);
    },
    sleep(id, durationMs) {
      observe(id);
      assertDuration(durationMs, "Workflow sleep durationMs");
      const operation = run.operations[id];
      assertOperationDeclaration(operation, id, "sleep", currentRace);
      if (operation?.status === "succeeded") return Promise.resolve();
      if (operation?.status === "failed") {
        return Promise.reject(new WorkflowOperationError(operation.error ?? null));
      }
      if (!operation) {
        onDecision({
          type: "operationScheduled",
          operation: {
            id,
            kind: "sleep",
            status: "scheduled",
            attempt: 0,
            wakeAt: getNow() + Math.max(0, durationMs),
            ...(currentRace ? { race: currentRace } : {}),
          },
        });
      }
      return waitForOperation(id);
    },
    waitFor(id, signal, options) {
      observe(id);
      if (options?.timeoutMs !== undefined) {
        assertDuration(options.timeoutMs, "Workflow wait timeoutMs");
      }
      const operation = run.operations[id];
      assertOperationDeclaration(operation, id, "signal", currentRace);
      if (operation?.status === "succeeded") return Promise.resolve(operation.result as never);
      if (operation?.status === "failed") {
        return Promise.reject(new WorkflowOperationError(operation.error ?? null));
      }
      if (!operation) {
        onDecision({
          type: "operationScheduled",
          operation: {
            id,
            kind: "signal",
            status: "scheduled",
            attempt: 0,
            signal,
            ...(options?.match === undefined ? {} : { match: options.match }),
            ...(options?.condition === undefined ? {} : { condition: options.condition }),
            ...(currentRace ? { race: currentRace } : {}),
            ...(options?.timeoutMs === undefined
              ? {}
              : { wakeAt: getNow() + Math.max(0, options.timeoutMs) }),
          },
        });
        return waitForOperation(id);
      }
      const message = run.messages.find(
        ({ name, consumedBy }) => name === signal && consumedBy === undefined,
      );
      if (message) {
        onDecision({
          type: "operationSucceeded",
          id,
          kind: "signal",
          result: message.payload,
          messageId: message.id,
        });
      }
      return waitForOperation(id);
    },
    invoke(id, workflow, input, options) {
      observe(id);
      if (options?.timeoutMs !== undefined) {
        assertDuration(options.timeoutMs, "Workflow invocation timeoutMs");
      }
      const operation = run.operations[id];
      assertOperationDeclaration(operation, id, "workflow", currentRace);
      if (operation?.status === "succeeded") return Promise.resolve(operation.result as never);
      if (operation?.status === "failed") {
        return Promise.reject(new WorkflowOperationError(operation.error ?? null));
      }
      if (!operation) {
        onDecision({
          type: "operationScheduled",
          operation: {
            id,
            kind: "workflow",
            status: "scheduled",
            attempt: 0,
            workflow,
            runId: options?.runId ?? `${run.id}:${id}`,
            input,
            ...(currentRace ? { race: currentRace } : {}),
            ...(options?.timeoutMs === undefined
              ? {}
              : { wakeAt: getNow() + Math.max(0, options.timeoutMs) }),
          },
        });
      }
      return waitForOperation(id);
    },
  };
}

async function commit(
  runs: WorkflowProgramResource,
  transition: WorkflowTransition,
  identity?: string,
): Promise<void> {
  const receipt = identity
    ? await runs.transition.identified(identity, { transition: transition })
    : await runs.transition({ transition: transition });
  if (!receipt.ok && receipt.error !== "invalid_transition") {
    throw new Error(`Workflow transition failed: ${receipt.error}.`);
  }
  await settleWorkflowTransitionRace(runs, transition, (next, nextIdentity) =>
    commit(runs, next, nextIdentity),
  );
}

async function settleWorkflowTransitionRace(
  runs: WorkflowProgramResource,
  transition: WorkflowTransition,
  commitTransition: (transition: WorkflowTransition, identity: string) => Promise<void>,
): Promise<void> {
  if (transition.type !== "operationSucceeded" && transition.type !== "operationFailed") return;
  const run = runs.run.run as RuntimeWorkflowRun | null;
  const operation = run?.operations[transition.id];
  if (!run || !operation?.race) return;
  const race = run.races[operation.race];
  if (race?.winner !== operation.id || race.settled) return;
  await commitTransition(
    { type: "raceSettled", race: operation.race },
    `race:${operation.race}:winner:${operation.id}:settle`,
  );
}

type WorkflowTransitionCommitter = (
  group: readonly WorkflowTransition[],
  identity: string,
) => Promise<void>;

type PendingWorkflowTransitionGroup = {
  readonly group: readonly WorkflowTransition[];
  readonly identity: string;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

type WorkflowTransitionQueue = {
  readonly runs: WorkflowProgramResource;
  readonly pending: PendingWorkflowTransitionGroup[];
  flushing: boolean;
  scheduled: boolean;
};

function createWorkflowTransitionBatcher(): {
  commit(
    runs: WorkflowProgramResource,
    key: WorkflowRunKey,
    group: readonly WorkflowTransition[],
    identity: string,
  ): Promise<void>;
  clear(reason: unknown): void;
} {
  const queues = new Map<string, WorkflowTransitionQueue>();

  const flush = async (id: string, queue: WorkflowTransitionQueue): Promise<void> => {
    if (queue.flushing) return;
    queue.flushing = true;
    queue.scheduled = false;
    try {
      while (queue.pending.length > 0) {
        const batch: PendingWorkflowTransitionGroup[] = [];
        let events = 0;
        while (queue.pending.length > 0) {
          const next = queue.pending[0]!;
          if (batch.length > 0 && events + next.group.length > maxProtocolBatch) break;
          queue.pending.shift();
          batch.push(next);
          events += next.group.length;
        }
        const groups = batch.map(({ group }) => group);
        const digest = createHash("sha256")
          .update(JSON.stringify(batch.map(({ identity, group }) => ({ identity, group }))))
          .digest("hex");
        try {
          const receipt = await queue.runs.applyTransitions.identified(
            `transition-batch:${digest}`,
            { groups: groups },
          );
          if (!receipt.ok && receipt.error !== "invalid_transition") {
            throw new Error(`Workflow transition batch failed: ${receipt.error}.`);
          }
          for (const item of batch) item.resolve();
        } catch (error) {
          for (const item of batch) item.reject(error);
        }
      }
    } finally {
      queue.flushing = false;
      if (queue.pending.length > 0) {
        queue.scheduled = true;
        queueMicrotask(() => void flush(id, queue));
      } else {
        queues.delete(id);
      }
    }
  };

  return {
    commit(runs, key, group, identity) {
      if (group.length === 0 || group.length > maxProtocolBatch) {
        return Promise.reject(new RangeError("A workflow transition group must fit one batch."));
      }
      const id = `${key.ownerId}\u0000${key.id}`;
      let queue = queues.get(id);
      if (!queue) {
        queue = { runs, pending: [], flushing: false, scheduled: false };
        queues.set(id, queue);
      }
      const deferred = Promise.withResolvers<void>();
      queue.pending.push({ group, identity, resolve: deferred.resolve, reject: deferred.reject });
      if (!queue.scheduled && !queue.flushing) {
        queue.scheduled = true;
        queueMicrotask(() => void flush(id, queue));
      }
      return deferred.promise;
    },
    clear(reason) {
      for (const queue of queues.values()) {
        for (const item of queue.pending.splice(0)) item.reject(reason);
      }
      queues.clear();
    },
  };
}

async function openWorkflowRun(runs: WorkflowProgramResource): Promise<void> {
  const receipt = await runs.open({});
  if (!receipt.ok && receipt.error !== "ready") {
    throw new Error(`Workflow run failed to open: ${receipt.error}.`);
  }
}

type WorkflowExecutionOutcome =
  | { readonly status: "completed"; readonly result: JsonValue }
  | { readonly status: "failed"; readonly error: unknown };

type WorkflowDeferred<Value> = ReturnType<typeof Promise.withResolvers<Value>>;

type WorkflowExecutionSession = {
  readonly id: string;
  readonly workflow: RuntimeWorkflowDefinition;
  readonly decisions: WorkflowTransition[];
  readonly pending: Map<string, WorkflowDeferred<unknown>>;
  readonly blockedEffects: Map<string, WorkflowDeferred<void>>;
  readonly effectEpochs: Map<string, number>;
  decision: WorkflowDeferred<void>;
  effectWaiter?: WorkflowDeferred<void>;
  activeEffects: number;
  now: number;
  needsEffectWake: boolean;
  readonly declarationTurn: Promise<void>;
  declarationFailed: boolean;
  outcomeResult?: WorkflowExecutionOutcome;
  outcome?: Promise<WorkflowExecutionOutcome>;
  processing: Promise<void>;
};

function wakeWorkflowSessionEffect(session: WorkflowExecutionSession, id: string): void {
  session.effectEpochs.set(id, (session.effectEpochs.get(id) ?? 0) + 1);
  const blocked = session.blockedEffects.get(id);
  if (!blocked) return;
  session.blockedEffects.delete(id);
  blocked.resolve();
}

function applyWorkflowSessionTransition(
  session: WorkflowExecutionSession,
  transition: WorkflowTransition,
  run: RuntimeWorkflowRun,
): void {
  if (transition.type === "operationScheduled") {
    wakeWorkflowSessionEffect(session, transition.operation.id);
    return;
  }
  if (
    transition.type === "operationAdmitted" ||
    transition.type === "operationStarted" ||
    transition.type === "operationSucceeded" ||
    transition.type === "operationRetryScheduled" ||
    transition.type === "operationFailed"
  ) {
    wakeWorkflowSessionEffect(session, transition.id);
    return;
  }
  if (transition.type === "raceSettled") {
    for (const operation of Object.values(run.operations)) {
      if (operation.race === transition.race) wakeWorkflowSessionEffect(session, operation.id);
    }
    return;
  }
  if (
    transition.type === "cancelled" ||
    transition.type === "continued" ||
    transition.type === "completed" ||
    transition.type === "failed"
  ) {
    for (const id of session.blockedEffects.keys()) wakeWorkflowSessionEffect(session, id);
  }
}

function resolveWorkflowSessionOperations(
  session: WorkflowExecutionSession,
  run: RuntimeWorkflowRun,
): void {
  for (const [id, pending] of session.pending) {
    const operation = run.operations[id];
    if (operation?.status === "succeeded") {
      session.pending.delete(id);
      pending.resolve(operation.result);
    } else if (operation?.status === "failed") {
      session.pending.delete(id);
      pending.reject(new WorkflowOperationError(operation.error ?? null));
    } else if (operation?.status === "cancelled") {
      session.pending.delete(id);
    } else if (isTerminal(run.status)) {
      session.pending.delete(id);
      pending.reject(new WorkflowOperationError(run.error ?? run.status));
    }
  }
}

async function settleWorkflowSessionMessages(
  session: WorkflowExecutionSession,
  runs: WorkflowProgramResource,
  run: RuntimeWorkflowRun,
): Promise<boolean> {
  const consumed = new Set<string>();
  let settled = false;
  for (const id of session.pending.keys()) {
    const operation = run.operations[id];
    if (
      operation?.kind !== "signal" ||
      operation.status !== "scheduled" ||
      operation.signalScope === "owner"
    ) {
      continue;
    }
    const message = run.messages.find(
      (candidate) =>
        candidate.name === operation.signal &&
        candidate.consumedBy === undefined &&
        !consumed.has(candidate.id),
    );
    if (!message) continue;
    consumed.add(message.id);
    settled = true;
    await commit(runs, {
      type: "operationSucceeded",
      id,
      kind: "signal",
      result: message.payload,
      messageId: message.id,
    });
  }
  return settled;
}

async function settleRecoveredWorkflowRace(
  runs: WorkflowProgramResource,
  run: RuntimeWorkflowRun,
): Promise<boolean> {
  for (const race in run.races) {
    const state = run.races[race];
    if (!state?.winner || state.settled) continue;
    await commit(runs, { type: "raceSettled", race }, `race:${race}:winner:${state.winner}:settle`);
    return true;
  }
  return false;
}

async function waitForWorkflowSessionProgress(
  session: WorkflowExecutionSession,
): Promise<WorkflowExecutionOutcome | null> {
  if (!session.outcome) throw new Error("The workflow execution session has not started.");
  const quiescent = async (): Promise<null> => {
    for (;;) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (session.activeEffects === 0) return null;
      const waiter = Promise.withResolvers<void>();
      session.effectWaiter = waiter;
      if (session.activeEffects === 0) waiter.resolve();
      await waiter.promise;
      if (session.effectWaiter === waiter) session.effectWaiter = undefined;
    }
  };
  return Promise.race([session.outcome, session.decision.promise.then(() => null), quiescent()]);
}

function createWorkflowExecutionSession(
  definition: RuntimeDefinition,
  dependencies: Readonly<Record<string, unknown>>,
  run: RuntimeWorkflowRun,
  at: number,
  ownerId: string,
  executeEffect?: WorkflowEffectRunner,
): WorkflowExecutionSession | undefined {
  const workflow = definition.workflows[run.name];
  if (!workflow) return undefined;
  const declarationTurn = Promise.withResolvers<void>();
  const session: WorkflowExecutionSession = {
    id: `${ownerId}\u0000${run.id}`,
    workflow,
    decisions: [],
    pending: new Map(),
    blockedEffects: new Map(),
    effectEpochs: new Map(),
    decision: Promise.withResolvers<void>(),
    activeEffects: 0,
    now: at,
    needsEffectWake: false,
    declarationTurn: declarationTurn.promise,
    declarationFailed: false,
    processing: Promise.resolve(),
  };
  const notifyEffectChange = (): void => {
    session.effectWaiter?.resolve();
  };
  const managedEffect: WorkflowEffectExecutor | undefined = executeEffect
    ? async (id, effect, retry, race, gate) => {
        session.activeEffects += 1;
        notifyEffectChange();
        await session.declarationTurn;
        session.activeEffects -= 1;
        notifyEffectChange();
        if (session.declarationFailed || session.outcomeResult) {
          return createPending<never>();
        }
        for (;;) {
          const observedEpoch = session.effectEpochs.get(id) ?? 0;
          let active = true;
          let blocked: WorkflowDeferred<void> | undefined;
          session.activeEffects += 1;
          if (session.decisions.length > 0) session.needsEffectWake = true;
          notifyEffectChange();
          const block = (): void => {
            if (!active) return;
            active = false;
            session.activeEffects -= 1;
            blocked = Promise.withResolvers<void>();
            session.blockedEffects.set(id, blocked);
            if ((session.effectEpochs.get(id) ?? 0) !== observedEpoch) {
              session.blockedEffects.delete(id);
              blocked.resolve();
            }
            notifyEffectChange();
          };
          try {
            const result = await executeEffect(
              id,
              effect,
              retry,
              block,
              race,
              () => session.needsEffectWake,
              gate,
            );
            if (result !== workflowEffectBlocked) return result;
            if (!blocked) throw new Error("A blocked workflow effect has no wake signal.");
            await blocked.promise;
          } finally {
            if (active) {
              active = false;
              session.activeEffects -= 1;
              notifyEffectChange();
            }
          }
        }
      }
    : undefined;
  const waitForOperation: WaitForWorkflowOperation = <Result>(id: string): Promise<Result> => {
    const existing = session.pending.get(id);
    if (existing) return existing.promise as Promise<Result>;
    const pending = Promise.withResolvers<unknown>();
    session.pending.set(id, pending);
    return pending.promise as Promise<Result>;
  };
  const context = createExecution(
    run,
    () => session.now,
    (next) => {
      session.decisions.push(next);
      if (session.activeEffects > 0) session.needsEffectWake = true;
      session.decision.resolve();
    },
    ownerId,
    managedEffect,
    waitForOperation,
    () => {
      session.declarationFailed = true;
    },
  );
  const outcome = Promise.resolve()
    .then(() => {
      try {
        return workflow.run(context, run.input, dependencies);
      } finally {
        declarationTurn.resolve();
      }
    })
    .then((result) => {
      context[assertWorkflowReplay]();
      return result;
    })
    .then(
      (result): WorkflowExecutionOutcome => ({ status: "completed", result }),
      (error): WorkflowExecutionOutcome => ({ status: "failed", error }),
    )
    .then((result) => {
      session.outcomeResult = result;
      return result;
    });
  session.outcome = outcome;
  return session;
}

async function advanceWorkflowExecutionSession(
  sessions: Map<string, WorkflowExecutionSession>,
  session: WorkflowExecutionSession,
  runs: WorkflowProgramResource,
  at: number,
): Promise<void> {
  session.now = at;
  for (;;) {
    const run = runs.run.run as RuntimeWorkflowRun | null;
    if (!run || run.status !== "running" || run.retryAt !== undefined) {
      if (run) resolveWorkflowSessionOperations(session, run);
      if (!run || isTerminal(run.status) || run.retryAt !== undefined) sessions.delete(session.id);
      return;
    }
    if (await settleRecoveredWorkflowRace(runs, run)) continue;
    if (await settleWorkflowSessionMessages(session, runs, run)) continue;
    resolveWorkflowSessionOperations(session, run);
    const outcome = await waitForWorkflowSessionProgress(session);
    if (session.decisions.length > 0) {
      const decisions = session.decisions.splice(0);
      session.decision = Promise.withResolvers<void>();
      for (const next of decisions) await commit(runs, next);
      if (session.activeEffects > 0) return;
      continue;
    }
    if (!outcome) {
      return;
    }
    sessions.delete(session.id);
    if (outcome.status === "failed") {
      const { error } = outcome;
      if (error instanceof WorkflowInfrastructureError) throw error.cause;
      if (error instanceof ContinueWorkflowAsNew) {
        const hasPendingOperation = Object.values(run.operations).some(
          ({ status }) => status !== "succeeded" && status !== "failed" && status !== "cancelled",
        );
        if (hasPendingOperation) {
          await commit(runs, {
            type: "failed",
            error: "A workflow can continue as new only after all declared operations settle.",
          });
          return;
        }
        await commit(runs, { type: "continued", input: error.input });
        return;
      }
      const serialized = error instanceof WorkflowOperationError ? error.value : asJson(error);
      const retry = normalizeRetry(session.workflow.retry);
      const nextAttempt = run.attempt + 1;
      if (
        !(error instanceof WorkflowOperationError) &&
        !(error instanceof StepError) &&
        !isNonRetriableError(error) &&
        nextAttempt < retry.attempts
      ) {
        const retryAfter = retryAfterFromError(error);
        await commit(
          runs,
          {
            type: "executionRetryScheduled",
            error: serialized,
            wakeAt:
              retryAfter !== undefined
                ? retryAfterInstant(retryAfter, at)
                : at + retryDelayForAttempt(retry, nextAttempt),
            attempt: nextAttempt,
          },
          `execution:attempt:${nextAttempt}:schedule`,
        );
        return;
      }
      await commit(runs, { type: "failed", error: serialized });
      return;
    }
    await commit(runs, { type: "completed", output: outcome.result });
    return;
  }
}

async function drive(
  definition: RuntimeDefinition,
  dependencies: Readonly<Record<string, unknown>>,
  runs: WorkflowProgramResource,
  at: number,
  ownerId: string,
  sessions: Map<string, WorkflowExecutionSession>,
  executeEffect?: WorkflowEffectRunner,
  transition?: WorkflowTransition,
): Promise<void> {
  const run = runs.run.run as RuntimeWorkflowRun | null;
  if (!run || run.status !== "running" || run.retryAt !== undefined) return;
  const id = `${ownerId}\u0000${run.id}`;
  let session = sessions.get(id);
  if (!session) {
    session = createWorkflowExecutionSession(
      definition,
      dependencies,
      run,
      at,
      ownerId,
      executeEffect,
    );
    if (!session) {
      await commit(runs, { type: "failed", error: `Unknown workflow ${run.name}.` });
      return;
    }
    sessions.set(id, session);
  }
  if (transition) applyWorkflowSessionTransition(session, transition, run);
  const process = session.processing.then(() =>
    advanceWorkflowExecutionSession(sessions, session, runs, at),
  );
  session.processing = process.catch(() => undefined);
  await process;
}

function retryAfterInstant(retryAfter: string, now: number): number {
  if (/^\d+$/.test(retryAfter)) return now + Number(retryAfter) * 1_000;
  const instant = Date.parse(retryAfter);
  return Number.isFinite(instant) ? Math.max(now, instant) : now;
}

function retryDelayForAttempt(retry: Required<WorkflowRetry>, attempt: number): number {
  return Math.min(retry.delayMs * retry.factor ** Math.max(0, attempt - 1), retry.maxDelayMs);
}

function retryDelay(operation: WorkflowOperation): number {
  const retry = operation.retry ?? normalizeRetry(undefined);
  return retryDelayForAttempt(retry, operation.attempt);
}

function createRunController(
  controllers: Map<string, AbortController>,
  runId: string,
): AbortController {
  const current = controllers.get(runId);
  if (current && !current.signal.aborted) return current;
  const controller = new AbortController();
  controllers.set(runId, controller);
  return controller;
}

function abortWorkflowControllers(
  controllers: Map<string, AbortController>,
  executionId: string,
  reason: string,
): void {
  for (const [id, controller] of controllers) {
    if (id !== executionId && !id.startsWith(`${executionId}\u0000`)) continue;
    controller.abort(reason);
    controllers.delete(id);
  }
}

function createWorkflowIdempotencyKey(
  key: WorkflowRunKey,
  generation: number,
  operation: string,
): string {
  return `workflow:${JSON.stringify(key)}:${generation}:${JSON.stringify(operation)}`;
}

async function executeWorkflowEffect<Result extends JsonValue>(
  runs: WorkflowProgramResource,
  key: WorkflowRunKey,
  commitTransitions: WorkflowTransitionCommitter,
  id: string,
  effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
  retry: Required<WorkflowRetry>,
  controllers: Map<string, AbortController>,
  programSignal: AbortSignal,
  clock: WorkflowClock,
  onBlocked: () => void,
  race?: string,
  shouldResume: () => boolean = () => false,
  gate?: WorkflowEffectGate,
): Promise<Result | typeof workflowEffectBlocked> {
  const commitEffectTransitions: WorkflowTransitionCommitter = async (group, identity) => {
    try {
      await commitTransitions(group, identity);
    } catch (error) {
      throw new WorkflowInfrastructureError(error);
    }
  };
  let current = runs.run.run as RuntimeWorkflowRun | null;
  let operation = current?.operations[id];
  if (!current || current.status !== "running") {
    onBlocked();
    return workflowEffectBlocked;
  }
  const isNew = operation === undefined;
  let startOperation: WorkflowOperation =
    operation ??
    ({
      id,
      kind: "effect",
      status: "scheduled",
      attempt: 0,
      retry,
      ...(race ? { race } : {}),
      ...(gate ? { gated: true } : {}),
    } satisfies WorkflowOperation);

  if (isNew && gate) {
    await commitEffectTransitions(
      [{ type: "operationScheduled", operation: startOperation }],
      `operation:${id}:schedule`,
    );
    current = runs.run.run as RuntimeWorkflowRun | null;
    operation = current?.operations[id];
    if (!current || current.status !== "running" || !operation) {
      onBlocked();
      return workflowEffectBlocked;
    }
    startOperation = operation;
  }
  if (startOperation.status === "succeeded") return startOperation.result as Result;
  if (startOperation.status === "failed") {
    throw new WorkflowOperationError(startOperation.error ?? null);
  }
  if (startOperation.status === "waiting" || startOperation.status === "cancelled") {
    onBlocked();
    return workflowEffectBlocked;
  }
  if (startOperation.kind !== "effect") {
    throw new TypeError(`Workflow operation ${JSON.stringify(id)} changed kind.`);
  }

  const attempt = startOperation.attempt + 1;
  if (gate && startOperation.admittedAttempt !== attempt) {
    const admitted = await gate(attempt);
    if (!admitted) {
      onBlocked();
      return workflowEffectBlocked;
    }
    current = runs.run.run as RuntimeWorkflowRun | null;
    operation = current?.operations[id];
    if (
      !current ||
      current.status !== "running" ||
      !operation ||
      (operation.status !== "scheduled" && operation.status !== "running")
    ) {
      onBlocked();
      return workflowEffectBlocked;
    }
    startOperation = operation;
  }
  const startedTransition: WorkflowTransition = {
    type: "operationStarted",
    id,
    ...(startOperation.status === "running" ? { uncertain: true } : {}),
  };
  await commitEffectTransitions(
    isNew && !gate
      ? [{ type: "operationScheduled", operation: startOperation }, startedTransition]
      : [startedTransition],
    `operation:${id}:attempt:${attempt}:start`,
  );
  current = runs.run.run as RuntimeWorkflowRun | null;
  const started = current?.operations[id];
  if (!current || current.status !== "running" || started?.status !== "running") {
    onBlocked();
    return workflowEffectBlocked;
  }

  const executionId = `${key.ownerId}\u0000${key.id}`;
  const runController = createRunController(controllers, executionId);
  const operationControllerKey = `${executionId}\u0000${id}`;
  const operationController = createRunController(controllers, operationControllerKey);
  const signal = AbortSignal.any([programSignal, runController.signal, operationController.signal]);
  try {
    let result: Result;
    try {
      result = await effect({
        attempt: started.attempt,
        idempotencyKey: createWorkflowIdempotencyKey(key, current.generation, id),
        signal,
        uncertainAttempts: started.uncertainAttempts ?? [],
      });
    } catch (error) {
      if (signal.aborted) {
        onBlocked();
        return workflowEffectBlocked;
      }
      const latest = runs.run.run as RuntimeWorkflowRun | null;
      const failed = latest?.operations[id];
      if (!latest || latest.status !== "running" || !failed) {
        onBlocked();
        return workflowEffectBlocked;
      }
      const serialized = asJson(error);
      const retryAfter = retryAfterFromError(error);
      if (!isNonRetriableError(error) && started.attempt < retry.attempts) {
        await commitEffectTransitions(
          [
            {
              type: "operationRetryScheduled",
              id,
              error: serialized,
              wakeAt:
                retryAfter === undefined
                  ? clock.now() + retryDelay({ ...failed, attempt: started.attempt })
                  : retryAfterInstant(retryAfter, clock.now()),
              attempt: started.attempt,
            },
          ],
          `operation:${id}:attempt:${started.attempt}:retry`,
        );
        onBlocked();
        return workflowEffectBlocked;
      }
      const failedTransition: WorkflowTransition = {
        type: "operationFailed",
        id,
        kind: "effect",
        error: serialized,
        attempt: started.attempt,
        ...(shouldResume() ? { resume: true } : {}),
      };
      await commitEffectTransitions(
        [failedTransition],
        `operation:${id}:attempt:${started.attempt}:fail`,
      );
      await settleWorkflowTransitionRace(runs, failedTransition, (next, identity) =>
        commitEffectTransitions([next], identity),
      );
      const settled = (runs.run.run as RuntimeWorkflowRun | null)?.operations[id];
      if (settled?.status === "failed") {
        throw new WorkflowOperationError(settled.error ?? serialized);
      }
      onBlocked();
      return workflowEffectBlocked;
    }

    const latest = runs.run.run as RuntimeWorkflowRun | null;
    if (latest?.status !== "running") {
      onBlocked();
      return workflowEffectBlocked;
    }
    const succeeded: WorkflowTransition = {
      type: "operationSucceeded",
      id,
      kind: "effect",
      result,
      attempt: started.attempt,
      ...(shouldResume() ? { resume: true } : {}),
    };
    await commitEffectTransitions(
      [succeeded],
      `operation:${id}:attempt:${started.attempt}:succeed`,
    );
    await settleWorkflowTransitionRace(runs, succeeded, (next, identity) =>
      commitEffectTransitions([next], identity),
    );
    const settled = (runs.run.run as RuntimeWorkflowRun | null)?.operations[id];
    if (settled?.status === "succeeded") return settled.result as Result;
    onBlocked();
    return workflowEffectBlocked;
  } finally {
    if (controllers.get(operationControllerKey) === operationController) {
      controllers.delete(operationControllerKey);
    }
  }
}

function controlsWorkflow(event: RuntimeWorkflowEvent): boolean {
  return event.payload.type === "cancelled" || event.payload.type === "raceSettled";
}

function orchestratesWorkflow(event: RuntimeWorkflowEvent): boolean {
  const transition = event.payload;
  switch (transition.type) {
    case "started":
    case "signalReceived":
    case "continued":
    case "executionRetryStarted":
    case "completed":
    case "failed":
    case "raceSettled":
      return true;
    case "operationScheduled":
      return (
        transition.operation.kind === "workflow" ||
        (transition.operation.kind === "effect" &&
          (transition.operation.attempt > 0 || transition.operation.gated === true))
      );
    case "operationAdmitted":
      return true;
    case "operationSucceeded":
    case "operationFailed":
      return transition.kind !== "effect" || transition.resume === true;
    case "cancelled":
    case "rejected":
    case "operationStarted":
    case "operationRetryScheduled":
    case "executionRetryScheduled":
      return false;
  }
}

function changesWorkflowSchedule(event: RuntimeWorkflowEvent): boolean {
  const transition = event.payload;
  switch (transition.type) {
    case "cancelled":
    case "continued":
    case "rejected":
    case "completed":
    case "failed":
    case "operationRetryScheduled":
    case "executionRetryScheduled":
    case "executionRetryStarted":
    case "raceSettled":
      return true;
    case "operationScheduled":
      return (
        transition.operation.kind === "sleep" ||
        transition.operation.kind === "signal" ||
        transition.operation.kind === "workflow"
      );
    case "operationSucceeded":
    case "operationFailed":
      return (
        transition.kind === "sleep" ||
        transition.kind === "signal" ||
        transition.kind === "workflow"
      );
    case "started":
      return true;
    case "signalReceived":
    case "operationAdmitted":
    case "operationStarted":
      return false;
  }
}

function workflowScheduleId(key: WorkflowRunKey, operationId: string): string {
  return `${JSON.stringify(key)}:${operationId}`;
}

async function runWorkflowScheduler(
  scheduler: WorkflowSchedulerProgramResource,
  useRuns: WorkflowProgramContext["resources"]["runs"],
  clock: WorkflowClock,
  signal: AbortSignal,
  waitForChange: () => Promise<void>,
  setTimer: (controller: AbortController | undefined) => void,
  onAdmission?: (ownerId: string, wakeAt: number) => void | Promise<void>,
  onCron?: (item: WorkflowScheduledItem) => void | Promise<void>,
): Promise<void> {
  while (!signal.aborted) {
    const next = scheduler.next;
    if (!next) {
      await waitForChange();
      continue;
    }
    const controller = new AbortController();
    setTimer(controller);
    try {
      await clock.sleepUntil(next.wakeAt, AbortSignal.any([signal, controller.signal]));
    } catch {
      continue;
    } finally {
      setTimer(undefined);
    }
    const item = scheduler.next;
    if (item && item.wakeAt <= clock.now()) {
      if (item.kind === "admission") {
        if (!onAdmission) throw new Error("The workflow scheduler has no admission handler.");
        await onAdmission(item.key.ownerId, item.wakeAt);
      } else if (item.kind === "cron") {
        if (!onCron) throw new Error("The workflow scheduler has no cron handler.");
        const removed = await scheduler.remove.identified(
          `scheduler:${item.id}:${item.wakeAt}:remove`,
          { id: item.id, wakeAt: item.wakeAt },
        );
        if (!removed.ok && removed.error !== "missing") {
          throw new Error(`Workflow scheduler removal failed: ${removed.error}.`);
        }
        await onCron(item);
        continue;
      } else {
        const runs = useRuns(item.key);
        await openWorkflowRun(runs);
        const run = runs.run.run as RuntimeWorkflowRun | null;
        if (
          run?.status === "running" &&
          (item.generation === undefined || item.generation === run.generation)
        ) {
          if (item.kind === "run" && item.operationId === undefined) {
            await commit(
              runs,
              { type: "cancelled", reason: "finish_timeout" },
              `scheduler:${item.id}:${item.wakeAt}:fire`,
            );
          } else if (
            item.kind === "execution" &&
            run.retryAt === item.wakeAt &&
            item.attempt !== undefined &&
            run.attempt + 1 === item.attempt
          ) {
            await commit(
              runs,
              { type: "executionRetryStarted", attempt: item.attempt },
              `scheduler:${item.id}:${item.wakeAt}:fire`,
            );
          } else if (item.operationId) {
            const operation = run.operations[item.operationId];
            if (
              item.kind === "effect" &&
              operation?.kind === "effect" &&
              operation.status === "waiting" &&
              operation.wakeAt === item.wakeAt
            ) {
              await commit(
                runs,
                { type: "operationScheduled", operation: { ...operation, status: "scheduled" } },
                `scheduler:${item.id}:${item.wakeAt}:fire`,
              );
            } else if (
              item.kind === "sleep" &&
              operation?.kind === "sleep" &&
              operation.status === "scheduled" &&
              operation.wakeAt === item.wakeAt
            ) {
              await commit(
                runs,
                {
                  type: "operationSucceeded",
                  id: item.operationId,
                  kind: "sleep",
                  result: null,
                },
                `scheduler:${item.id}:${item.wakeAt}:fire`,
              );
            } else if (
              item.kind === "signal" &&
              operation?.kind === "signal" &&
              operation.status === "scheduled" &&
              operation.wakeAt === item.wakeAt
            ) {
              await commit(
                runs,
                {
                  type: "operationFailed",
                  id: item.operationId,
                  kind: "signal",
                  error: "timeout",
                },
                `scheduler:${item.id}:${item.wakeAt}:fire`,
              );
            } else if (
              item.kind === "workflow" &&
              operation?.kind === "workflow" &&
              operation.status === "scheduled" &&
              operation.wakeAt === item.wakeAt
            ) {
              await commit(
                runs,
                {
                  type: "operationFailed",
                  id: item.operationId,
                  kind: "workflow",
                  error: "timeout",
                },
                `scheduler:${item.id}:${item.wakeAt}:fire`,
              );
            }
          }
        }
      }
      const receipt = await scheduler.remove.identified(
        `scheduler:${item.id}:${item.wakeAt}:remove`,
        { id: item.id, wakeAt: item.wakeAt },
      );
      if (!receipt.ok && receipt.error !== "missing") {
        throw new Error(`Workflow scheduler removal failed: ${receipt.error}.`);
      }
    }
  }
}

type WorkflowProgramHooks = {
  readonly advanceAdmission?: (ownerId: string, wakeAt: number) => void | Promise<void>;
  readonly fireCron?: (item: WorkflowScheduledItem) => void | Promise<void>;
  readonly admitInvocation?: (
    key: WorkflowRunKey,
    operation: WorkflowOperation,
  ) => boolean | Promise<boolean>;
};

function workflowVersionMismatch(
  run: RuntimeWorkflowRun,
  currentVersion: string | undefined,
): JsonValue {
  const started = run.version ?? "unversioned";
  const current = currentVersion ?? "unversioned";
  return {
    name: "WorkflowVersionMismatchError",
    message: `Workflow ${JSON.stringify(run.name)} started with version ${JSON.stringify(started)} but the current Program is ${JSON.stringify(current)}.`,
    startedVersion: started,
    currentVersion: current,
  };
}

function runWorkflowPrograms(definition: RuntimeDefinition, hooks: WorkflowProgramHooks = {}) {
  return async (
    { bind, signal: programSignal, resources }: WorkflowProgramContext,
    dependencies: WorkflowFeatureDependencies<WorkflowContract>,
  ) => {
    const { runs: useRuns, scheduler: useScheduler } = resources;
    const controllers = new Map<string, AbortController>();
    const sessions = new Map<string, WorkflowExecutionSession>();
    const orchestrationConsumerId =
      definition.version === undefined
        ? "workflows.orchestrate"
        : `workflows.orchestrate:${definition.version}`;
    const transitionBatcher = createWorkflowTransitionBatcher();
    const { clock = defaultClock, ...workflowDependencies } = dependencies;
    const scheduler = useScheduler({ id: "workflows" });
    let timer: AbortController | undefined;
    let changed = Promise.withResolvers<void>();
    const notifyScheduler = (): void => {
      timer?.abort("schedule_changed");
      changed.resolve();
    };
    const waitForScheduleChange = async (): Promise<void> => {
      const current = changed;
      await current.promise;
      if (changed === current) changed = Promise.withResolvers<void>();
    };
    programSignal.addEventListener(
      "abort",
      () => {
        notifyScheduler();
        sessions.clear();
        transitionBatcher.clear(programSignal.reason ?? "program_stopped");
      },
      { once: true },
    );
    const runScheduler = async (): Promise<void> => {
      const opened = await scheduler.open({});
      if (!opened.ok && opened.error !== "ready") {
        throw new Error(`Workflow scheduler failed to open: ${opened.error}.`);
      }
      await runWorkflowScheduler(
        scheduler,
        useRuns,
        clock,
        programSignal,
        waitForScheduleChange,
        (controller) => (timer = controller),
        hooks.advanceAdmission,
        hooks.fireCron,
      );
    };
    await Promise.all([
      runScheduler(),
      bind({
        id: "workflows.scheduler-wake",
        events: ["scheduler.changed"],
        startAt: "origin",
        signal: programSignal,
        concurrency: 1,
        run: () => notifyScheduler(),
      }),
      bind({
        id: "workflows.control",
        events: ["runs.transitioned"],
        startAt: "origin",
        signal: programSignal,
        concurrency: 256,
        async run({ event, runs }) {
          if (!controlsWorkflow(event)) return;
          const controllerKey = `${event.key.ownerId}\u0000${event.key.id}`;
          const current = runs.run.run as RuntimeWorkflowRun | null;
          if (event.payload.type === "raceSettled") {
            for (const operation of Object.values(current?.operations ?? {})) {
              if (operation.race !== event.payload.race || operation.status !== "cancelled") {
                continue;
              }
              const operationKey = `${controllerKey}\u0000${operation.id}`;
              controllers.get(operationKey)?.abort("race_settled");
              controllers.delete(operationKey);
              if (operation.kind === "workflow" && operation.runId) {
                const child = useRuns({ ownerId: event.key.ownerId, id: operation.runId });
                await openWorkflowRun(child);
                if (child.run.run && !isTerminal(child.run.run.status)) {
                  await commit(child, { type: "cancelled", reason: "race_lost" });
                }
              }
            }
            return;
          }
          if (event.payload.type !== "cancelled") return;
          abortWorkflowControllers(controllers, controllerKey, "cancelled");
          sessions.delete(controllerKey);
          for (const operation of Object.values(current?.operations ?? {})) {
            if (operation.kind !== "workflow" || !operation.runId) continue;
            const child = useRuns({ ownerId: event.key.ownerId, id: operation.runId });
            await openWorkflowRun(child);
            if (child.run.run && !isTerminal(child.run.run.status)) {
              await commit(child, { type: "cancelled", reason: "parent_cancelled" });
            }
          }
          if (current?.parent) {
            await commit(useRuns(current.parent.key), {
              type: "operationFailed",
              id: current.parent.operationId,
              kind: "workflow",
              error: event.payload.reason ?? "child_cancelled",
            });
          }
        },
      }),
      bind({
        id: orchestrationConsumerId,
        events: ["runs.transitioned"],
        startAt: "origin",
        signal: programSignal,
        concurrency: 32,
        async run({ event, runs }) {
          if (!orchestratesWorkflow(event)) return;
          if (
            event.payload.type === "completed" ||
            event.payload.type === "failed" ||
            event.payload.type === "cancelled"
          ) {
            const executionId = `${event.key.ownerId}\u0000${event.key.id}`;
            abortWorkflowControllers(controllers, executionId, event.payload.type);
            sessions.delete(executionId);
          }
          const current = runs.run.run as RuntimeWorkflowRun | null;
          if (current && !isTerminal(current.status) && current.version !== definition.version) {
            await commit(runs, {
              type: "failed",
              error: workflowVersionMismatch(current, definition.version),
            });
            return;
          }
          if (
            event.payload.type === "operationScheduled" &&
            event.payload.operation.kind === "workflow"
          ) {
            const operation = event.payload.operation;
            if (!operation.workflow || !operation.runId || operation.input === undefined) {
              await commit(runs, {
                type: "operationFailed",
                id: operation.id,
                kind: "workflow",
                error: "Invalid child workflow operation.",
              });
              return;
            }
            if (await hooks.admitInvocation?.(event.key, operation)) return;
            const child = useRuns({ ownerId: event.key.ownerId, id: operation.runId });
            await commit(child, {
              type: "started",
              id: operation.runId,
              name: operation.workflow,
              input: operation.input,
              ...(definition.version === undefined ? {} : { version: definition.version }),
              parent: { key: event.key, operationId: operation.id },
            });
          }
          if (
            current?.parent &&
            (event.payload.type === "completed" ||
              event.payload.type === "failed" ||
              event.payload.type === "cancelled")
          ) {
            const parent = useRuns(current.parent.key);
            if (event.payload.type === "completed") {
              await commit(parent, {
                type: "operationSucceeded",
                id: current.parent.operationId,
                kind: "workflow",
                result: event.payload.output,
              });
            } else {
              await commit(parent, {
                type: "operationFailed",
                id: current.parent.operationId,
                kind: "workflow",
                error:
                  event.payload.type === "failed"
                    ? event.payload.error
                    : (event.payload.reason ?? "child_cancelled"),
              });
            }
          }
          await drive(
            definition,
            workflowDependencies,
            runs,
            clock.now(),
            event.key.ownerId,
            sessions,
            (id, effect, retry, onBlocked, race, shouldResume, gate) =>
              executeWorkflowEffect(
                runs,
                event.key,
                (group, identity) => transitionBatcher.commit(runs, event.key, group, identity),
                id,
                effect,
                retry,
                controllers,
                programSignal,
                clock,
                onBlocked,
                race,
                shouldResume,
                gate,
              ),
            event.payload,
          );
        },
      }),
      bind({
        id: "workflows.scheduler",
        events: ["runs.transitioned"],
        startAt: "origin",
        signal: programSignal,
        concurrency: 256,
        partitionRevision: 1,
        partitionBy: ({ event }) =>
          "operation" in event.payload
            ? `${event.key.id}:${event.payload.operation.id}`
            : event.key.id,
        async run({ event, runs, createIdempotencyKey }) {
          if (!changesWorkflowSchedule(event)) return;
          const schedule = async (item: WorkflowScheduledItem): Promise<void> => {
            const receipt = await scheduler.schedule.identified(
              createIdempotencyKey(`schedule:${item.id}`),
              item,
            );
            if (!receipt.ok && receipt.error !== "unchanged") {
              throw new Error(`Workflow scheduling failed: ${receipt.error}.`);
            }
          };
          const remove = async (item: WorkflowScheduledItem): Promise<void> => {
            const receipt = await scheduler.remove.identified(
              createIdempotencyKey(`remove:${item.id}`),
              { id: item.id, wakeAt: item.wakeAt },
            );
            if (!receipt.ok && receipt.error !== "missing") {
              throw new Error(`Workflow scheduler removal failed: ${receipt.error}.`);
            }
          };
          const transition = event.payload;
          if (transition.type === "started" || transition.type === "continued") {
            if (transition.type === "continued") {
              const stale = scheduler.scheduled.filter(
                ({ key }) => key.ownerId === event.key.ownerId && key.id === event.key.id,
              );
              for (const item of stale) await remove(item);
            }
            const workflowName =
              transition.type === "started"
                ? transition.name
                : (runs.run.run as RuntimeWorkflowRun | null)?.name;
            const generation = (runs.run.run as RuntimeWorkflowRun | null)?.generation;
            const timeoutMs = workflowName
              ? definition.workflows[workflowName]?.timeoutMs
              : undefined;
            if (timeoutMs !== undefined) {
              assertDuration(timeoutMs, `Workflow ${JSON.stringify(workflowName)} timeoutMs`);
              await schedule({
                id: workflowScheduleId(event.key, "$run"),
                key: event.key,
                kind: "run",
                wakeAt: clock.now() + timeoutMs,
                generation,
              });
            }
          } else if (transition.type === "executionRetryScheduled") {
            const generation = (runs.run.run as RuntimeWorkflowRun | null)?.generation;
            await schedule({
              id: workflowScheduleId(event.key, "$execution"),
              key: event.key,
              kind: "execution",
              wakeAt: transition.wakeAt,
              attempt: transition.attempt,
              generation,
            });
          } else if (transition.type === "operationRetryScheduled") {
            const run = runs.run.run as RuntimeWorkflowRun | null;
            const operation = run?.operations[transition.id];
            if (operation?.kind === "effect") {
              await schedule({
                id: workflowScheduleId(event.key, transition.id),
                key: event.key,
                kind: "effect",
                wakeAt: transition.wakeAt,
                operationId: transition.id,
                generation: run?.generation,
              });
            }
          } else if (
            transition.type === "operationScheduled" &&
            (transition.operation.kind === "sleep" ||
              transition.operation.kind === "signal" ||
              transition.operation.kind === "workflow") &&
            transition.operation.wakeAt !== undefined
          ) {
            const generation = (runs.run.run as RuntimeWorkflowRun | null)?.generation;
            await schedule({
              id: workflowScheduleId(event.key, transition.operation.id),
              key: event.key,
              kind: transition.operation.kind,
              wakeAt: transition.operation.wakeAt,
              operationId: transition.operation.id,
              generation,
            });
          } else {
            const all = scheduler.scheduled;
            const cancelledRaceOperations =
              transition.type === "raceSettled"
                ? new Set(
                    Object.values((runs.run.run as RuntimeWorkflowRun | null)?.operations ?? {})
                      .filter(
                        ({ race, status }) => race === transition.race && status === "cancelled",
                      )
                      .map(({ id }) => id),
                  )
                : undefined;
            const stale =
              transition.type === "operationSucceeded" || transition.type === "operationFailed"
                ? all.filter(
                    ({ key, operationId }) =>
                      key.ownerId === event.key.ownerId &&
                      key.id === event.key.id &&
                      operationId === transition.id,
                  )
                : transition.type === "executionRetryStarted"
                  ? all.filter(
                      ({ key, kind }) =>
                        key.ownerId === event.key.ownerId &&
                        key.id === event.key.id &&
                        kind === "execution",
                    )
                  : transition.type === "raceSettled"
                    ? all.filter(
                        ({ key, operationId }) =>
                          key.ownerId === event.key.ownerId &&
                          key.id === event.key.id &&
                          operationId !== undefined &&
                          cancelledRaceOperations?.has(operationId),
                      )
                    : all.filter(
                        ({ key }) => key.ownerId === event.key.ownerId && key.id === event.key.id,
                      );
            for (const item of stale) await remove(item);
          }
          notifyScheduler();
        },
      }),
    ]);
  };
}

function createWorkflowPrograms(definition: RuntimeDefinition, hooks: WorkflowProgramHooks = {}) {
  const orchestrate =
    definition.version === undefined
      ? "workflows.orchestrate"
      : `workflows.orchestrate:${definition.version}`;
  const bindings = bindProgramHandlers(
    runWorkflowPrograms(definition, hooks) as unknown as Parameters<typeof bindProgramHandlers>[0],
    [
      {
        id: "workflows.scheduler-wake",
        events: ["scheduler.changed"],
        replay: "all",
        key: "resource",
      },
      {
        id: "workflows.control",
        events: ["runs.transitioned"],
        replay: "all",
        key: "resource",
      },
      {
        id: orchestrate,
        events: ["runs.transitioned"],
        replay: "all",
        key: "resource",
      },
      {
        id: "workflows.scheduler",
        events: ["runs.transitioned"],
        replay: "all",
        key: { version: 1 },
      },
    ],
  );
  return {
    runScheduler: (context: unknown, dependencies: unknown) =>
      bindings.run(context as Readonly<Record<string, unknown>>, dependencies),
    wakeScheduler: {
      source: {
        events: ["scheduler.changed"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      handle: (context: unknown) => bindings.handle("workflows.scheduler-wake", context),
    },
    controlRuns: {
      source: {
        events: ["runs.transitioned"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      handle: (context: unknown) => bindings.handle("workflows.control", context),
    },
    orchestrateRuns: {
      source: {
        events: ["runs.transitioned"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      handle: (context: unknown) => bindings.handle(orchestrate, context),
    },
    scheduleRuns: {
      source: {
        events: ["runs.transitioned"],
        replay: "all",
        version: 1,
        keyBy: ({ event }: { event: RuntimeWorkflowEvent }) =>
          "operation" in event.payload
            ? `${event.key.id}:${event.payload.operation.id}`
            : event.key.id,
        keyVersion: 1,
      },
      handle: (context: unknown) => bindings.handle("workflows.scheduler", context),
    },
  };
}

export type WorkflowProgram<App extends AppSpec, Contract extends WorkflowContract> = NonNullable<
  FeatureDef<App, WorkflowFeature<Contract>>["programs"]
>["server"];

export type WorkflowRuntime<App extends AppSpec, Contract extends WorkflowContract> = Pick<
  FeatureDef<App, WorkflowFeature<Contract>>,
  "api" | "resources"
>;

export function createWorkflowProgram<App extends AppSpec, Contract extends WorkflowContract>(
  definition: WorkflowProgramDefinition<Contract>,
): WorkflowProgram<App, Contract> {
  return createWorkflowPrograms(
    definition as unknown as RuntimeDefinition,
  ) as unknown as WorkflowProgram<App, Contract>;
}

function compareScheduled(state: WorkflowSchedulerState, leftId: string, rightId: string): number {
  const left = state.scheduled[leftId];
  const right = state.scheduled[rightId];
  if (!left || !right) return left ? -1 : right ? 1 : leftId.localeCompare(rightId);
  return left.wakeAt - right.wakeAt || left.id.localeCompare(right.id);
}

function swapScheduled(state: WorkflowSchedulerState, left: number, right: number): void {
  const leftId = state.heap[left];
  const rightId = state.heap[right];
  if (leftId === undefined || rightId === undefined) return;
  state.heap[left] = rightId;
  state.heap[right] = leftId;
  state.positions[leftId] = right;
  state.positions[rightId] = left;
}

function siftScheduledUp(state: WorkflowSchedulerState, initial: number): void {
  let index = initial;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const id = state.heap[index];
    const parentId = state.heap[parent];
    if (id === undefined || parentId === undefined || compareScheduled(state, id, parentId) >= 0) {
      return;
    }
    swapScheduled(state, index, parent);
    index = parent;
  }
}

function siftScheduledDown(state: WorkflowSchedulerState, initial: number): void {
  let index = initial;
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    const smallestId = state.heap[smallest];
    const leftId = state.heap[left];
    if (
      smallestId !== undefined &&
      leftId !== undefined &&
      compareScheduled(state, leftId, smallestId) < 0
    ) {
      smallest = left;
    }
    const currentSmallestId = state.heap[smallest];
    const rightId = state.heap[right];
    if (
      currentSmallestId !== undefined &&
      rightId !== undefined &&
      compareScheduled(state, rightId, currentSmallestId) < 0
    ) {
      smallest = right;
    }
    if (smallest === index) return;
    swapScheduled(state, index, smallest);
    index = smallest;
  }
}

function removeScheduled(state: WorkflowSchedulerState, id: string): void {
  const index = state.positions[id];
  if (index === undefined) return;
  const last = state.heap.pop();
  delete state.positions[id];
  delete state.scheduled[id];
  if (last === undefined || index >= state.heap.length) return;
  state.heap[index] = last;
  state.positions[last] = index;
  const parent = index > 0 ? Math.floor((index - 1) / 2) : -1;
  const parentId = parent >= 0 ? state.heap[parent] : undefined;
  if (parentId !== undefined && compareScheduled(state, last, parentId) < 0) {
    siftScheduledUp(state, index);
  } else {
    siftScheduledDown(state, index);
  }
}

function putScheduled(state: WorkflowSchedulerState, item: WorkflowScheduledItem): void {
  removeScheduled(state, item.id);
  state.scheduled[item.id] = item;
  state.positions[item.id] = state.heap.length;
  state.heap.push(item.id);
  siftScheduledUp(state, state.heap.length - 1);
}

export function createWorkflowRuntime<App extends AppSpec, Contract extends WorkflowContract>(
  definition: WorkflowRuntimeDefinition<Contract>,
): WorkflowRuntime<App, Contract> {
  const queries = definition.queries as unknown as Readonly<
    Record<
      string,
      Readonly<Record<string, (run: WorkflowRun<WorkflowContract>, input: JsonValue) => JsonValue>>
    >
  >;
  const runtime = {
    resources: {
      runs: {
        state: { run: null },
        authorize({
          actor,
          key,
          operation,
        }: {
          actor: ActorOf<App>;
          key: WorkflowRunKey;
          operation:
            | { type: "read"; origin: "client" | "program" }
            | { type: "command"; name: string; origin: "client" | "program" };
        }) {
          if (operation.origin === "program") return true;
          return actor.id === key.ownerId;
        },
        events: {
          transitioned({
            state,
            payload,
            at,
            seq,
          }: {
            state: WorkflowRunState;
            payload: WorkflowTransition;
            at: number;
            seq: number;
          }) {
            applyTransition(state, payload, { at, seq });
          },
        },
        views: {
          run({ state }: { state: WorkflowRunState }) {
            return state.run
              ? { status: state.run.status, run: state.run }
              : { status: "idle", run: null };
          },
        },
        commands: {
          open(context: { error(code: "ready"): void }) {
            context.error("ready");
          },
          start(
            context: WorkflowCommandContext,
            { name, input, version }: { name: string; input: JsonValue; version?: string },
          ) {
            if (context.state.run) return context.error("already_started");
            context.event.transitioned({
              type: "started",
              id: context.key.id,
              name,
              input,
              ...(version === undefined ? {} : { version }),
            });
          },
          signal(
            context: WorkflowCommandContext,
            { name, payload }: { name: string; payload: JsonValue },
          ) {
            if (!context.state.run || isTerminal(context.state.run.status)) {
              return context.error("not_running");
            }
            context.event.transitioned({
              type: "signalReceived",
              id: context.id(),
              name,
              payload,
            });
          },
          cancel(context: WorkflowCommandContext, { reason }: { reason?: string }) {
            if (!context.state.run || isTerminal(context.state.run.status)) {
              return context.error("not_running");
            }
            context.event.transitioned({ type: "cancelled", reason });
          },
          transition(
            context: WorkflowCommandContext,
            { transition }: { transition: WorkflowTransition },
          ) {
            if (!canApplyTransition(context.state, transition)) {
              return context.error("invalid_transition");
            }
            context.event.transitioned(transition);
          },
          applyTransitions(
            context: WorkflowCommandContext,
            { groups }: { groups: readonly (readonly WorkflowTransition[])[] },
          ) {
            if (groups.length === 0) return context.error("invalid_transition");
            if (groups.length === 1) {
              const group = groups[0]!;
              if (!canApplyTransitionGroup(context.state, group)) {
                return context.error("invalid_transition");
              }
              for (const transition of group) context.event.transitioned(transition);
              return;
            }
            const shadow = createWorkflowTransitionShadow(context.state);
            let emitted = 0;
            for (const group of groups) {
              if (!canApplyTransitionGroup(shadow, group)) continue;
              for (const transition of group) {
                context.event.transitioned(transition);
                emitted += 1;
                applyTransition(shadow, transition, {
                  at: context.now(),
                  seq: (shadow.run?.revision ?? 0) + 1,
                });
              }
            }
            if (emitted === 0) context.error("invalid_transition");
          },
        },
      },
      scheduler: {
        state: {
          scheduled: {} as Record<string, WorkflowScheduledItem>,
          heap: [] as string[],
          positions: {} as Record<string, number>,
        },
        authorize({
          operation,
        }: {
          operation:
            | { type: "read"; origin: "client" | "program" }
            | { type: "command"; name: string; origin: "client" | "program" };
        }) {
          return operation.type === "read" || operation.origin === "program";
        },
        events: {
          changed({
            state,
            payload,
          }: {
            state: WorkflowSchedulerState;
            payload: { id: string; item: WorkflowScheduledItem | null };
          }) {
            if (payload.item) putScheduled(state, payload.item);
            else removeScheduled(state, payload.id);
          },
        },
        views: {
          next({ state }: { state: WorkflowSchedulerState }) {
            const id = state.heap[0];
            return id === undefined ? null : (state.scheduled[id] ?? null);
          },
          scheduled({ state }: { state: WorkflowSchedulerState }) {
            return Object.values(state.scheduled);
          },
        },
        commands: {
          open(context: { error(code: "ready"): void }) {
            context.error("ready");
          },
          schedule(
            context: {
              state: WorkflowSchedulerState;
              event: {
                changed(payload: { id: string; item: WorkflowScheduledItem | null }): void;
              };
              error(code: "unchanged"): void;
            },
            item: WorkflowScheduledItem,
          ) {
            const current = context.state.scheduled[item.id];
            if (
              current &&
              current.wakeAt === item.wakeAt &&
              current.kind === item.kind &&
              current.attempt === item.attempt
            ) {
              return context.error("unchanged");
            }
            context.event.changed({ id: item.id, item });
          },
          remove(
            context: {
              state: WorkflowSchedulerState;
              event: {
                changed(payload: { id: string; item: WorkflowScheduledItem | null }): void;
              };
              error(code: "missing"): void;
            },
            { id, wakeAt }: { id: string; wakeAt: number },
          ) {
            const current = context.state.scheduled[id];
            if (!current || current.wakeAt !== wakeAt) return context.error("missing");
            context.event.changed({ id, item: null });
          },
        },
      },
    },
    api: ({ resources, actor }: WorkflowAPIContext) => ({
      getWorkflow(name: string, id: string) {
        const runs = resources.runs({ ownerId: actor.id, id });
        const currentRun = () => {
          const current = runs.run.run;
          if (current && current.name !== name) {
            throw new Error(
              `Workflow run ${JSON.stringify(id)} belongs to ${JSON.stringify(current.name)}, not ${JSON.stringify(name)}.`,
            );
          }
          return current;
        };
        return {
          get run() {
            return currentRun();
          },
          start(input: JsonValue) {
            return runs.start({ name: name, input: input, version: definition.version });
          },
          signal(signal: string, payload: JsonValue) {
            return runs.signal({ name: signal, payload: payload });
          },
          cancel(reason?: string) {
            return runs.cancel({ reason: reason });
          },
          query(query: string, input: JsonValue) {
            const current = currentRun();
            if (!current) throw new Error(`Workflow ${id} has not started.`);
            const read = queries[name]?.[query];
            if (!read) throw new Error(`Unknown query ${name}.${query}.`);
            return read(deepFreeze(structuredClone(current)), deepFreeze(structuredClone(input)));
          },
        };
      },
    }),
  };
  return runtime as unknown as WorkflowRuntime<App, Contract>;
}

export type FunctionSpec = {
  readonly Input: JsonValue | void;
  readonly Output: JsonValue | void;
  readonly Error?: JsonValue;
};

export type FunctionsContract = {
  readonly Events: Readonly<Record<string, JsonValue>>;
  readonly Functions: Readonly<Record<string, FunctionSpec>>;
  readonly Dependencies?: Readonly<Record<string, unknown>>;
};

type FunctionName<Contract extends FunctionsContract> = Extract<
  keyof Contract["Functions"],
  string
>;

type FunctionFor<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = Contract["Functions"][Name];

type FunctionInput<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = FunctionFor<Contract, Name>["Input"];

type FunctionOutput<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = FunctionFor<Contract, Name>["Output"];

type FunctionDurableValue<Value> = Exclude<Value, void> | (undefined extends Value ? null : never);

type FunctionDurableInput<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = FunctionDurableValue<FunctionInput<Contract, Name>>;

type FunctionDurableOutput<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = FunctionDurableValue<FunctionOutput<Contract, Name>>;

type FunctionError<Contract extends FunctionsContract, Name extends FunctionName<Contract>> =
  FunctionFor<Contract, Name> extends { readonly Error: infer Error extends JsonValue }
    ? Error
    : JsonValue;

export type FunctionDependencies<Contract extends FunctionsContract> = Contract extends {
  readonly Dependencies: infer Dependencies extends Readonly<Record<string, unknown>>;
}
  ? Dependencies
  : Record<never, never>;

export type FunctionEventSessionValue = string | number;

export type FunctionEventMeta = {
  readonly sessions?: Readonly<Record<string, FunctionEventSessionValue>>;
};

export type FunctionReceivedEventMeta = {
  readonly sessions?: Readonly<Record<string, string>>;
};

export type DurationLike = {
  readonly [Symbol.toStringTag]: "Temporal.Duration";
};

export type InstantLike = {
  readonly [Symbol.toStringTag]: "Temporal.Instant";
};

export type ZonedDateTimeLike = {
  readonly [Symbol.toStringTag]: "Temporal.ZonedDateTime";
};

export type FunctionDuration = number | string | DurationLike;

export type FunctionInstant = Date | string | InstantLike | ZonedDateTimeLike;

export type FunctionTimeout = FunctionDuration | Date | InstantLike | ZonedDateTimeLike;

type FunctionEventName<Contract extends FunctionsContract> = Extract<
  keyof Contract["Events"],
  string
>;

export type FunctionSchemaIssue = {
  readonly message: string;
  readonly path?: readonly unknown[];
};

export type FunctionSchemaResult<Value> =
  | { readonly value: Value; readonly issues?: undefined }
  | { readonly issues: readonly FunctionSchemaIssue[] };

export type FunctionSchema<Value> = {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) => FunctionSchemaResult<Value> | PromiseLike<FunctionSchemaResult<Value>>;
  };
};

export type FunctionEvent<
  Contract extends FunctionsContract,
  Event extends FunctionEventName<Contract> = FunctionEventName<Contract>,
> =
  Event extends FunctionEventName<Contract>
    ? {
        readonly id: string;
        readonly name: Event;
        readonly data: Contract["Events"][Event];
        readonly ts: number;
        readonly v?: string;
        readonly meta?: FunctionReceivedEventMeta;
      }
    : never;

export type FunctionEventInput<
  Contract extends FunctionsContract,
  Event extends FunctionEventName<Contract> = FunctionEventName<Contract>,
> =
  Event extends FunctionEventName<Contract>
    ? {
        readonly id?: string;
        readonly name: Event;
        readonly data: Contract["Events"][Event];
        readonly ts?: number;
        readonly v?: string;
        readonly meta?: FunctionEventMeta;
      }
    : never;

export type FunctionSendResult = { readonly ids: readonly string[] };

export type FunctionSendSignalResult = { readonly runId: string | undefined };

type FunctionCronTrigger = {
  readonly cron: string;
  readonly jitter?: string;
};

export type FunctionConcurrency =
  | {
      readonly limit: number;
      readonly key?: string;
      readonly scope?: "fn";
    }
  | {
      readonly limit: number;
      readonly key: string;
      readonly scope: "env" | "account";
    };

export type FunctionAdmissionConfiguration = {
  readonly concurrency?:
    | number
    | FunctionConcurrency
    | readonly [FunctionConcurrency, FunctionConcurrency];
  readonly batchEvents?: {
    readonly maxSize: number;
    readonly timeout: string;
    readonly key?: string;
    readonly if?: string;
  };
  readonly idempotency?: string;
  readonly rateLimit?: {
    readonly key?: string;
    readonly limit: number;
    readonly period: string;
  };
  readonly throttle?: {
    readonly key?: string;
    readonly limit: number;
    readonly period: string;
    readonly burst?: number;
  };
  readonly debounce?: {
    readonly key?: string;
    readonly period: string;
    readonly timeout?: string;
  };
  readonly priority?: { readonly run?: string };
  readonly singleton?: {
    readonly key?: string;
    readonly mode: "skip" | "cancel";
  };
};

export type FunctionCancellation<Contract extends FunctionsContract> = {
  readonly event: FunctionEventName<Contract>;
  readonly timeout?: FunctionTimeout;
} & (
  | { readonly if?: string; readonly match?: never }
  | { readonly if?: never; readonly match?: string }
);

type TriggerEventName<Triggers> = Triggers extends readonly unknown[]
  ? TriggerEventName<Triggers[number]>
  : Triggers extends { readonly event: infer Event extends string }
    ? Event
    : never;

type EventNameMatchingPattern<Names, Pattern> = Names extends string
  ? Pattern extends `${infer Prefix}*`
    ? Names extends `${Prefix}${string}`
      ? Names
      : never
    : Names extends Pattern
      ? Names
      : never
  : never;

type TriggerEventNamesForPattern<
  Contract extends FunctionsContract,
  Pattern,
> = Pattern extends string
  ? Pattern extends `${string}*`
    ? EventNameMatchingPattern<FunctionEventName<Contract>, Pattern>
    : Pattern extends FunctionEventName<Contract>
      ? Pattern
      : never
  : never;

type TriggerEventNames<Contract extends FunctionsContract, Triggers> = TriggerEventNamesForPattern<
  Contract,
  TriggerEventName<Triggers>
>;

type HasCronTrigger<Triggers> = Triggers extends readonly unknown[]
  ? Extract<Triggers[number], FunctionCronTrigger> extends never
    ? false
    : true
  : Triggers extends FunctionCronTrigger
    ? true
    : false;

type FunctionTriggerItem<Triggers> = Triggers extends readonly unknown[]
  ? Triggers[number]
  : Triggers;

type InvalidFunctionTrigger<Contract extends FunctionsContract, Trigger> = Trigger extends {
  readonly event: infer Event;
}
  ? Event extends FunctionEventName<Contract>
    ? Trigger extends { readonly schema: infer Schema }
      ? Schema extends FunctionSchema<Contract["Events"][Event]>
        ? never
        : Trigger
      : never
    : Trigger
  : Trigger extends FunctionCronTrigger
    ? never
    : Trigger;

type ValidateFunctionTriggerShape<
  Contract extends FunctionsContract,
  Triggers,
> = Triggers extends undefined
  ? unknown
  : [InvalidFunctionTrigger<Contract, FunctionTriggerItem<Triggers>>] extends [never]
    ? unknown
    : never;

type ValidateFunctionTriggers<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = ValidateFunctionTriggerShape<Contract, Triggers> &
  ([Contract["Events"][TriggerEventNames<Contract, Triggers>]] extends [
    FunctionInput<Contract, Name>,
  ]
    ? unknown
    : never);

export type FunctionConfiguration<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = FunctionAdmissionConfiguration & {
  readonly id: Name;
  readonly name?: string;
  readonly description?: string;
  readonly triggers?: Triggers & ValidateFunctionTriggers<Contract, Name, Triggers>;
  readonly cancelOn?: readonly FunctionCancellation<Contract>[];
  readonly timeouts?: {
    readonly start?: string;
    readonly finish?: string;
  };
  /** Number of retries after the initial attempt, matching Inngest. */
  readonly retries?: FunctionRetries;
  readonly onFailure?: DefinedFunctionFailureHandler<Contract, Name, Triggers>;
};

export type FunctionRetries =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20;

declare const functionReferenceType: unique symbol;

export type FunctionReference<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = {
  readonly id: Name;
  readonly functionId: Name;
  readonly [functionReferenceType]?: {
    readonly input: FunctionInput<Contract, Name>;
    readonly output: FunctionOutput<Contract, Name>;
  };
};

export type ReferencedFunction<
  Input extends JsonValue | void = JsonValue,
  Output extends JsonValue | void = JsonValue,
> = {
  readonly id: string;
  readonly functionId: string;
  readonly appId?: string;
  readonly [functionReferenceType]?: {
    readonly input: Input;
    readonly output: Output;
  };
};

export function referenceFunction<
  Input extends JsonValue | void = JsonValue,
  Output extends JsonValue | void = JsonValue,
>(options: {
  readonly functionId: string;
  readonly appId?: string;
  readonly schemas?: {
    readonly data?: FunctionSchema<Input>;
    readonly return?: FunctionSchema<Output>;
  };
}): ReferencedFunction<Input, Output> {
  if (!options.functionId.trim()) throw new TypeError("A referenced function id cannot be empty.");
  return Object.freeze({
    id: options.functionId,
    functionId: options.functionId,
    ...(options.appId ? { appId: options.appId } : {}),
  });
}

export type FunctionLogger = {
  debug(...values: unknown[]): void;
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};

export type FunctionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FunctionInvocationRequest = {
  readonly appId: string;
  readonly functionId: string;
  readonly data: JsonValue;
};

export type FunctionInvocationContext = WorkflowEffectContext & {
  readonly ownerId: string;
  readonly runId: string;
  readonly operationId: string;
  readonly timeoutMs?: number;
  readonly deadline?: number;
};

export type FunctionRouting = {
  invoke(
    request: FunctionInvocationRequest,
    context: FunctionInvocationContext,
  ): JsonValue | Promise<JsonValue>;
};

export type FunctionStepOptions =
  | string
  | { readonly id: string; readonly name?: string; readonly parallelMode?: "race" };

type FunctionEventSelection =
  | { readonly match?: string; readonly if?: never }
  | { readonly match?: never; readonly if?: string };

type FunctionInvocationData<Input> = undefined extends Input
  ? { readonly data?: Exclude<Input, void> }
  : { readonly data: Input };

export type FunctionStep<Contract extends FunctionsContract> = {
  run<Arguments extends readonly JsonValue[], Result extends JsonValue | void>(
    id: FunctionStepOptions,
    handler: (...input: Arguments) => Result | Promise<Result>,
    ...input: Arguments
  ): Promise<Result>;
  fetch(id: FunctionStepOptions, input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  sleep(id: FunctionStepOptions, duration: FunctionDuration): Promise<void>;
  sleepUntil(id: FunctionStepOptions, at: FunctionInstant): Promise<void>;
  waitForEvent<Event extends FunctionEventName<Contract>>(
    id: FunctionStepOptions,
    options: {
      readonly event: Event;
      readonly timeout?: FunctionTimeout;
      readonly schema?: FunctionSchema<Contract["Events"][Event]>;
    } & FunctionEventSelection,
  ): Promise<FunctionEvent<Contract, Event> | null>;
  waitForSignal<Data extends JsonValue = JsonValue>(
    id: FunctionStepOptions,
    options: {
      readonly signal: string;
      readonly timeout: FunctionTimeout;
      readonly onConflict: "replace" | "fail";
    },
  ): Promise<{ readonly signal: string; readonly data: Data } | null>;
  invoke<Name extends FunctionName<Contract>>(
    id: FunctionStepOptions,
    options: {
      readonly function: FunctionReference<Contract, Name>;
      readonly timeout?: FunctionTimeout;
    } & FunctionInvocationData<FunctionInput<Contract, Name>>,
  ): Promise<FunctionOutput<Contract, Name>>;
  invoke<Input extends JsonValue | void, Output extends JsonValue | void>(
    id: FunctionStepOptions,
    options: {
      readonly function: ReferencedFunction<Input, Output>;
      readonly timeout?: FunctionTimeout;
    } & FunctionInvocationData<Input>,
  ): Promise<Output>;
  sendEvent<Event extends FunctionEventName<Contract>>(
    id: FunctionStepOptions,
    event: FunctionEventInput<Contract, Event> | readonly FunctionEventInput<Contract, Event>[],
  ): Promise<FunctionSendResult>;
  sendSignal(
    id: FunctionStepOptions,
    options: { readonly signal: string; readonly data?: JsonValue },
  ): Promise<FunctionSendSignalResult>;
};

export type FunctionGroup = {
  parallel<Result>(callback: () => Promise<Result>): Promise<Result>;
  parallel<Result>(
    options: { readonly mode?: "race" },
    callback: () => Promise<Result>,
  ): Promise<Result>;
  experiment<const Variants extends Readonly<Record<string, () => JsonValue | Promise<JsonValue>>>>(
    id: FunctionStepOptions,
    options: FunctionExperimentOptions<Variants>,
  ): Promise<FunctionExperimentResult<Variants>>;
};

export type FunctionExperimentStrategy = {
  readonly strategy: string;
  readonly weights?: Readonly<Record<string, number>>;
  readonly nullishBucket?: boolean;
};

export type FunctionExperimentSelector = {
  (variants?: readonly string[]): string | Promise<string>;
  readonly __experimentConfig: FunctionExperimentStrategy;
};

export type FunctionExperimentOptions<
  Variants extends Readonly<Record<string, () => JsonValue | Promise<JsonValue>>>,
> = {
  readonly variants: Variants;
  readonly select: FunctionExperimentSelector;
};

export type FunctionExperimentReference = {
  readonly experimentName: string;
  readonly variant: string;
};

export type FunctionExperimentResult<
  Variants extends Readonly<Record<string, () => JsonValue | Promise<JsonValue>>>,
> = {
  readonly result: Awaited<ReturnType<Variants[keyof Variants]>>;
  readonly variant: Extract<keyof Variants, string>;
  readonly experimentRef: FunctionExperimentReference;
};

type FunctionHandlerEvent<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = Triggers extends undefined
  ? {
      readonly id: string;
      readonly name: "inngest/function.invoked";
      readonly data: FunctionInput<Contract, Name>;
      readonly ts: number;
    }
  :
      | FunctionEvent<Contract, TriggerEventNames<Contract, Triggers>>
      | (HasCronTrigger<Triggers> extends true
          ? {
              readonly id: string;
              readonly name: "inngest/scheduled.timer";
              readonly data: { readonly cron: string };
              readonly ts: number;
            }
          : never);

export type FunctionHandlerContext<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = {
  readonly event: FunctionHandlerEvent<Contract, Name, Triggers>;
  readonly events: readonly FunctionHandlerEvent<Contract, Name, Triggers>[];
  readonly step: FunctionStep<Contract>;
  readonly group: FunctionGroup;
  readonly runId: string;
  readonly logger: FunctionLogger;
  readonly attempt: number;
  readonly maxAttempts?: number;
};

export type FunctionFailureEvent<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = {
  readonly id: string;
  readonly name: "inngest/function.failed";
  readonly data: {
    readonly function_id: Name;
    readonly run_id: string;
    readonly error: JsonValue;
    readonly event: FunctionHandlerEvent<Contract, Name, Triggers>;
  };
  readonly ts: number;
};

export type FunctionFailureHandlerContext<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = {
  readonly event: FunctionFailureEvent<Contract, Name, Triggers>;
  readonly events: readonly [FunctionFailureEvent<Contract, Name, Triggers>];
  readonly error: Error;
  readonly step: FunctionStep<Contract>;
  readonly group: FunctionGroup;
  readonly runId: string;
  readonly logger: FunctionLogger;
  readonly attempt: number;
  readonly maxAttempts?: number;
};

type DefinedFunctionFailureHandler<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = (
  context: FunctionFailureHandlerContext<Contract, Name, Triggers>,
) => JsonValue | Promise<JsonValue> | void | Promise<void>;

type DefinedFunctionHandler<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Triggers,
> = (
  context: FunctionHandlerContext<Contract, Name, Triggers>,
) => FunctionOutput<Contract, Name> | Promise<FunctionOutput<Contract, Name>>;

export type CreateFunction<Contract extends FunctionsContract> = <
  Name extends FunctionName<Contract>,
  const Triggers = undefined,
  Handler extends DefinedFunctionHandler<Contract, NoInfer<Name>, NoInfer<Triggers>> =
    DefinedFunctionHandler<Contract, NoInfer<Name>, NoInfer<Triggers>>,
>(
  configuration: FunctionConfiguration<Contract, Name, Triggers>,
  handler: Handler,
) => FunctionReference<Contract, Name>;

type FunctionWorkflowContract<Contract extends FunctionsContract> = {
  readonly Workflows: {
    readonly [Name in FunctionName<Contract>]: {
      readonly Input: {
        readonly id: string;
        readonly name:
          | FunctionEventName<Contract>
          | "inngest/function.invoked"
          | "inngest/scheduled.timer";
        readonly data: FunctionDurableInput<Contract, Name> | { readonly cron: string };
        readonly ts: number;
      };
      readonly Output: FunctionDurableOutput<Contract, Name>;
      readonly Error: FunctionError<Contract, Name>;
      readonly Signals: {
        readonly [Event in FunctionEventName<Contract>]: FunctionEvent<Contract, Event>;
      };
    };
  };
  readonly Dependencies: FunctionDependencies<Contract>;
};

export type FunctionRun<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract> = FunctionName<Contract>,
> = WorkflowRun<FunctionWorkflowContract<Contract>, Name>;

export type FunctionExecution<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract> = FunctionName<Contract>,
> = Pick<
  FunctionRun<Contract, Name>,
  | "id"
  | "name"
  | "status"
  | "input"
  | "output"
  | "error"
  | "startedAt"
  | "version"
  | "generation"
  | "transitionCount"
  | "attempt"
  | "retryAt"
  | "lastError"
  | "parent"
>;

export type FunctionHandle<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = {
  /** Bounded lifecycle projection suitable for reactive application use. */
  readonly run: FunctionExecution<Contract, Name> | null;
  /** Full durable execution graph. Accessing it opts into synchronizing the complete run state. */
  readonly details: FunctionRun<Contract, Name> | null;
  cancel(reason?: string): Submission<"not_running">;
};

export type FunctionsAPI<Contract extends FunctionsContract> = {
  send<Event extends FunctionEventName<Contract>>(
    event: FunctionEventInput<Contract, Event> | readonly FunctionEventInput<Contract, Event>[],
  ): Promise<FunctionSendResult>;
  sendSignal(options: {
    readonly signal: string;
    readonly data?: JsonValue;
  }): Promise<FunctionSendSignalResult>;
  getFunction<Name extends FunctionName<Contract>>(
    name: Name,
    id: string,
  ): FunctionHandle<Contract, Name>;
};

export type FunctionTestEvent<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> =
  | FunctionEvent<Contract>
  | {
      readonly id: string;
      readonly name: "inngest/function.invoked";
      readonly data: FunctionInput<Contract, Name>;
      readonly ts: number;
    }
  | {
      readonly id: string;
      readonly name: "inngest/scheduled.timer";
      readonly data: { readonly cron: string };
      readonly ts: number;
    };

export type FunctionStepMock = {
  readonly id: string;
  readonly handler: () => JsonValue | void | Promise<JsonValue | void>;
};

export type FunctionTestStep = {
  readonly id: string;
  readonly kind:
    | "run"
    | "fetch"
    | "sleep"
    | "waitForEvent"
    | "waitForSignal"
    | "invoke"
    | "sendEvent"
    | "sendSignal";
  readonly result?: JsonValue;
  readonly error?: unknown;
};

export type FunctionTestExecution<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> =
  | {
      readonly result: FunctionOutput<Contract, Name>;
      readonly steps: readonly FunctionTestStep[];
    }
  | {
      readonly error: unknown;
      readonly steps: readonly FunctionTestStep[];
    };

export type FunctionTestStepExecution =
  | {
      readonly result: JsonValue | undefined;
      readonly step: FunctionTestStep;
    }
  | {
      readonly error: unknown;
      readonly step: FunctionTestStep;
    };

export type FunctionTestCheckpointType =
  | "function-resolved"
  | "function-rejected"
  | "steps-found"
  | "step-ran";

export type FunctionTestCheckpoint<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
  Type extends FunctionTestCheckpointType = FunctionTestCheckpointType,
> = Type extends "function-resolved"
  ? {
      readonly type: Type;
      readonly data: FunctionOutput<Contract, Name>;
      readonly steps: readonly FunctionTestStep[];
    }
  : Type extends "function-rejected"
    ? {
        readonly type: Type;
        readonly error: unknown;
        readonly steps: readonly FunctionTestStep[];
      }
    : Type extends "steps-found"
      ? { readonly type: Type; readonly steps: readonly FunctionTestStep[] }
      : Type extends "step-ran"
        ? { readonly type: Type; readonly step: FunctionTestStep }
        : never;

export type FunctionTestSubset<Value> = Value extends readonly (infer Item)[]
  ? readonly FunctionTestSubset<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]?: FunctionTestSubset<Value[Key]> }
    : Value;

export type FunctionTestRun<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = {
  waitFor<Type extends FunctionTestCheckpointType>(
    checkpoint: Type,
    subset?: FunctionTestSubset<FunctionTestCheckpoint<Contract, Name, Type>>,
  ): Promise<FunctionTestCheckpoint<Contract, Name, Type>>;
};

export type FunctionTestOptions<
  Contract extends FunctionsContract,
  Name extends FunctionName<Contract>,
> = {
  readonly events: readonly [
    FunctionTestEvent<Contract, Name>,
    ...FunctionTestEvent<Contract, Name>[],
  ];
  readonly steps?: readonly FunctionStepMock[];
  readonly runId?: string;
  readonly attempt?: number;
};

export type FunctionsTest<Contract extends FunctionsContract> = {
  start<Name extends FunctionName<Contract>>(
    name: Name,
    options: FunctionTestOptions<Contract, Name>,
  ): FunctionTestRun<Contract, Name>;
  execute<Name extends FunctionName<Contract>>(
    name: Name,
    options: FunctionTestOptions<Contract, Name>,
  ): Promise<FunctionTestExecution<Contract, Name>>;
  executeStep<Name extends FunctionName<Contract>>(
    name: Name,
    stepId: string,
    options: FunctionTestOptions<Contract, Name>,
  ): Promise<FunctionTestStepExecution>;
};

type FunctionFeatureDependencies<Contract extends FunctionsContract> =
  FunctionDependencies<Contract> & {
    readonly clock?: WorkflowClock;
    readonly fetch?: FunctionFetch;
    readonly logger?: FunctionLogger;
    readonly routing?: FunctionRouting;
  };

type FunctionEventState = { event: RuntimeFunctionEvent | null };

type FunctionEventResource = {
  readonly Key: WorkflowRunKey;
  readonly State: FunctionEventState;
  readonly Events: { readonly sent: RuntimeFunctionEvent };
  readonly Views: { readonly event: RuntimeFunctionEvent | null };
  readonly Commands: {
    readonly send: {
      Input: { event: RuntimeFunctionEvent };
      readonly Event: "sent";
      readonly Error: "already_sent";
    };
  };
};

type FunctionSignalRegistration = {
  readonly runId: string;
  readonly operationId: string;
};

type RuntimeFunctionExecution = {
  readonly id: string;
  readonly name: string;
  readonly status: Exclude<WorkflowStatus, "idle">;
  readonly input: JsonValue;
  readonly output?: JsonValue;
  readonly error?: JsonValue;
  readonly startedAt: number;
  readonly version?: string;
  readonly generation: number;
  readonly transitionCount: number;
  readonly attempt: number;
  readonly retryAt?: number;
  readonly lastError?: JsonValue;
  readonly parent?: {
    readonly key: WorkflowRunKey;
    readonly operationId: string;
  };
};

type FunctionExecutionChanged =
  | { readonly type: "projected"; readonly execution: RuntimeFunctionExecution }
  | { readonly type: "cancelRequested"; readonly reason?: string };

type FunctionExecutionState = { execution: RuntimeFunctionExecution | null };

type FunctionExecutionResource = {
  readonly Key: WorkflowRunKey;
  readonly State: FunctionExecutionState;
  readonly Events: { readonly changed: FunctionExecutionChanged };
  readonly Views: { readonly run: RuntimeFunctionExecution | null };
  readonly Commands: {
    readonly project: {
      Input: { execution: RuntimeFunctionExecution };
      readonly Event: "changed";
      readonly Error: "unchanged";
    };
    readonly cancel: {
      Input: { reason?: string };
      readonly Event: "changed";
      readonly Error: "not_running";
    };
  };
};

type FunctionCancellationRegistration = {
  readonly rule: string;
  readonly correlation: string;
};

type FunctionEventWaitRegistration = {
  readonly event: string;
  readonly runId: string;
  readonly operationId: string;
};

type FunctionIndexChanged =
  | {
      readonly type: "run";
      readonly id: string;
      readonly active: boolean;
      readonly cancellations: readonly FunctionCancellationRegistration[];
    }
  | {
      readonly type: "waitsSynchronized";
      readonly runId: string;
      readonly waits: readonly FunctionEventWaitRegistration[];
    }
  | {
      readonly type: "signalRegistered";
      readonly signal: string;
      readonly registration: FunctionSignalRegistration;
    }
  | {
      readonly type: "signalReleased";
      readonly signal: string;
      readonly registration: FunctionSignalRegistration;
    }
  | {
      readonly type: "signalDelivered";
      readonly signal: string;
      readonly data: JsonValue;
      readonly registration: FunctionSignalRegistration;
    };

type FunctionIndexState = {
  active: Record<string, true>;
  cancellations: Record<string, Record<string, true>>;
  waits: Record<string, Record<string, FunctionEventWaitRegistration>>;
  waitsByRun: Record<string, FunctionEventWaitRegistration[]>;
  signals: Record<string, FunctionSignalRegistration>;
};

type FunctionIndexResource = {
  readonly Key: { readonly ownerId: string };
  readonly State: FunctionIndexState;
  readonly Events: { readonly changed: FunctionIndexChanged };
  readonly Views: {
    readonly active: Readonly<Record<string, true>>;
    readonly cancellations: Readonly<Record<string, Readonly<Record<string, true>>>>;
    readonly waits: Readonly<
      Record<string, Readonly<Record<string, FunctionEventWaitRegistration>>>
    >;
    readonly signals: Readonly<Record<string, FunctionSignalRegistration>>;
  };
  readonly Commands: {
    readonly open: {
      Input: {};
      readonly Event: "changed";
      readonly Error: "ready";
    };
    readonly index: {
      Input: {
        id: string;
        active: boolean;
        cancellations: readonly FunctionCancellationRegistration[];
      };
      readonly Event: "changed";
      readonly Error: "unchanged";
    };
    readonly synchronizeWaits: {
      Input: { runId: string; waits: readonly FunctionEventWaitRegistration[] };
      readonly Event: "changed";
      readonly Error: "unchanged";
    };
    readonly registerSignal: {
      Input: {
        signal: string;
        registration: FunctionSignalRegistration;
        conflict: "replace" | "fail";
      };
      readonly Event: "changed";
      readonly Error: "conflict" | "unchanged";
    };
    readonly releaseSignal: {
      Input: { signal: string; registration: FunctionSignalRegistration };
      readonly Event: "changed";
      readonly Error: "missing";
    };
    readonly deliverSignal: {
      Input: { signal: string; data: JsonValue };
      readonly Event: "changed";
      readonly Error: "missing";
    };
  };
};

function functionCancellationBucket({
  rule,
  correlation,
}: FunctionCancellationRegistration): string {
  return JSON.stringify([rule, correlation]);
}

function functionWaitRegistrationId(registration: FunctionEventWaitRegistration): string {
  return JSON.stringify([registration.runId, registration.operationId]);
}

function deleteEmptyFunctionIndexBucket<Value>(
  buckets: Record<string, Record<string, Value>>,
  key: string,
): void {
  const bucket = buckets[key];
  if (!bucket) return;
  for (const _entry in bucket) return;
  delete buckets[key];
}

function sameFunctionWaitRegistrations(
  left: readonly FunctionEventWaitRegistration[],
  right: readonly FunctionEventWaitRegistration[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (registration, index) =>
        registration.event === right[index]?.event &&
        registration.runId === right[index]?.runId &&
        registration.operationId === right[index]?.operationId,
    )
  );
}

type FunctionAdmissionLimit = { readonly key: string; readonly limit: number };

type FunctionAdmissionPolicy = {
  readonly concurrency: readonly FunctionAdmissionLimit[];
  readonly batch?: { readonly key: string; readonly maxSize: number; readonly timeoutMs: number };
  readonly idempotencyKey?: string;
  readonly rateLimit?: FunctionAdmissionLimit & { readonly periodMs: number };
  readonly throttle?: FunctionAdmissionLimit & {
    readonly periodMs: number;
    readonly burst: number;
  };
  readonly debounce?: {
    readonly key: string;
    readonly periodMs: number;
    readonly timeoutMs?: number;
  };
  readonly singleton?: { readonly key: string; readonly mode: "skip" | "cancel" };
  readonly priority: number;
  readonly startTimeoutMs?: number;
};

type FunctionAdmissionJob = {
  readonly ownerId: string;
  readonly id: string;
  readonly runId: string;
  readonly kind: "run" | "segment";
  readonly segmentGroup?: string;
  readonly operationId?: string;
  readonly attempt?: number;
  readonly functionId: string;
  readonly events: readonly RuntimeFunctionEvent[];
  readonly parent?: {
    readonly key: WorkflowRunKey;
    readonly operationId: string;
  };
  readonly createdAt: number;
  readonly sequence: number;
  readonly policy: FunctionAdmissionPolicy;
  status: "queued" | "active";
  blockedBy: string[];
};

type FunctionAdmissionAction =
  | {
      readonly id: string;
      readonly order: number;
      readonly type: "start";
      readonly ownerId: string;
      readonly runId: string;
      readonly functionId: string;
      readonly events: readonly RuntimeFunctionEvent[];
      readonly parent?: {
        readonly key: WorkflowRunKey;
        readonly operationId: string;
      };
    }
  | {
      readonly id: string;
      readonly order: number;
      readonly type: "grant";
      readonly ownerId: string;
      readonly runId: string;
      readonly segmentId: string;
      readonly operationId: string;
      readonly attempt: number;
    }
  | {
      readonly id: string;
      readonly order: number;
      readonly type: "expire";
      readonly ownerId: string;
      readonly runId: string;
      readonly functionId: string;
      readonly events: readonly RuntimeFunctionEvent[];
      readonly parent?: {
        readonly key: WorkflowRunKey;
        readonly operationId: string;
      };
    }
  | {
      readonly id: string;
      readonly order: number;
      readonly type: "cancel";
      readonly ownerId: string;
      readonly runId: string;
    }
  | {
      readonly id: string;
      readonly order: number;
      readonly type: "reject";
      readonly parent: {
        readonly key: WorkflowRunKey;
        readonly operationId: string;
      };
      readonly reason: "idempotency" | "rate_limit" | "singleton_skip";
    };

type FunctionAdmissionGroup = {
  readonly ownerId: string;
  readonly id: string;
  readonly runId: string;
  readonly functionId: string;
  readonly createdAt: number;
  readonly sequence: number;
  readonly policy: FunctionAdmissionPolicy;
  events: RuntimeFunctionEvent[];
  readonly parent?: {
    readonly key: WorkflowRunKey;
    readonly operationId: string;
  };
  wakeAt: number;
};

type FunctionAdmissionState = {
  now: number;
  sequence: number;
  actionSequence: number;
  nextWakeAt: number | null;
  jobs: Record<string, FunctionAdmissionJob>;
  active: Record<string, true>;
  activeSegments: Record<string, string>;
  ready: string[];
  waiters: Record<string, string[]>;
  actions: Record<string, FunctionAdmissionAction>;
  batches: Record<string, FunctionAdmissionGroup>;
  debounces: Record<string, FunctionAdmissionGroup>;
  concurrency: Record<string, number>;
  singletons: Record<string, string>;
  rateWindows: Record<string, { timestamps: number[]; expiresAt: number }>;
  throttle: Record<string, { tokens: number; at: number; expiresAt: number }>;
  idempotency: Record<string, number>;
};

type FunctionAdmissionMutation =
  | {
      readonly type: "submit";
      readonly ownerId: string;
      readonly id: string;
      readonly runId: string;
      readonly functionId: string;
      readonly event: RuntimeFunctionEvent;
      readonly policy: FunctionAdmissionPolicy;
      readonly parent?: {
        readonly key: WorkflowRunKey;
        readonly operationId: string;
      };
      readonly now: number;
    }
  | {
      readonly type: "submitSegment";
      readonly ownerId: string;
      readonly id: string;
      readonly segmentGroup: string;
      readonly runId: string;
      readonly operationId: string;
      readonly attempt: number;
      readonly functionId: string;
      readonly event: RuntimeFunctionEvent;
      readonly policy: FunctionAdmissionPolicy;
      readonly createdAt: number;
      readonly now: number;
    }
  | { readonly type: "release"; readonly runId: string; readonly now: number }
  | { readonly type: "advance"; readonly now: number }
  | { readonly type: "acknowledge"; readonly actionId: string; readonly now: number };

type FunctionAdmissionChanged = {
  readonly mutation: FunctionAdmissionMutation;
  readonly previousWakeAt: number | null;
  readonly notify: boolean;
};

type FunctionAdmissionResource = {
  readonly Key: { readonly ownerId: string };
  readonly State: FunctionAdmissionState;
  readonly Events: { readonly changed: FunctionAdmissionChanged };
  readonly Views: {
    readonly actions: readonly FunctionAdmissionAction[];
    readonly active: Readonly<Record<string, true>>;
    readonly activeSegments: Readonly<Record<string, string>>;
    readonly nextWakeAt: number | null;
  };
  readonly Commands: {
    readonly open: {
      Input: {};
      readonly Error: "ready";
    };
    readonly change: {
      Input: FunctionAdmissionMutation;
      readonly Event: "changed";
      readonly Error: "unchanged";
    };
  };
};

const functionIdempotencyPeriodMs = 86_400_000;
const functionAdmissionResourceKey = Object.freeze({ ownerId: "$environment" });

function functionAdmissionJobId(ownerId: string, runId: string): string {
  return `${JSON.stringify(ownerId)}:${JSON.stringify(runId)}`;
}

function createFunctionAdmissionState(): FunctionAdmissionState {
  return {
    now: 0,
    sequence: 0,
    actionSequence: 0,
    nextWakeAt: null,
    jobs: {},
    active: {},
    activeSegments: {},
    ready: [],
    waiters: {},
    actions: {},
    batches: {},
    debounces: {},
    concurrency: {},
    singletons: {},
    rateWindows: {},
    throttle: {},
    idempotency: {},
  };
}

function functionAdmissionOrder(left: FunctionAdmissionJob, right: FunctionAdmissionJob): number {
  const leftScore = left.createdAt - left.policy.priority * 1_000;
  const rightScore = right.createdAt - right.policy.priority * 1_000;
  return (
    leftScore - rightScore || left.sequence - right.sequence || left.id.localeCompare(right.id)
  );
}

function compareFunctionAdmissionIds(
  state: FunctionAdmissionState,
  leftId: string,
  rightId: string,
): number {
  const left = state.jobs[leftId];
  const right = state.jobs[rightId];
  if (!left) return right ? 1 : leftId.localeCompare(rightId);
  if (!right) return -1;
  return functionAdmissionOrder(left, right);
}

function pushFunctionAdmissionHeap(
  state: FunctionAdmissionState,
  heap: string[],
  id: string,
): void {
  heap.push(id);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareFunctionAdmissionIds(state, heap[parent]!, id) <= 0) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = id;
}

function popFunctionAdmissionHeap(
  state: FunctionAdmissionState,
  heap: string[],
): string | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child =
      right < heap.length && compareFunctionAdmissionIds(state, heap[right]!, heap[left]!) < 0
        ? right
        : left;
    if (compareFunctionAdmissionIds(state, last, heap[child]!) <= 0) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return first;
}

function cleanFunctionAdmission(state: FunctionAdmissionState, now: number): void {
  for (const [key, expiresAt] of Object.entries(state.idempotency)) {
    if (expiresAt <= now) delete state.idempotency[key];
  }
  for (const [key, window] of Object.entries(state.rateWindows)) {
    if (window.expiresAt <= now) delete state.rateWindows[key];
  }
  for (const [key, bucket] of Object.entries(state.throttle)) {
    if (bucket.expiresAt <= now) delete state.throttle[key];
  }
}

function addFunctionAdmissionJob(
  state: FunctionAdmissionState,
  group: Omit<FunctionAdmissionGroup, "wakeAt"> & {
    readonly kind?: "run" | "segment";
    readonly segmentGroup?: string;
    readonly operationId?: string;
    readonly attempt?: number;
  },
): boolean {
  if (state.jobs[group.id]) return false;
  state.jobs[group.id] = {
    ownerId: group.ownerId,
    id: group.id,
    runId: group.runId,
    kind: group.kind ?? "run",
    ...(group.segmentGroup ? { segmentGroup: group.segmentGroup } : {}),
    ...(group.operationId ? { operationId: group.operationId } : {}),
    ...(group.attempt === undefined ? {} : { attempt: group.attempt }),
    functionId: group.functionId,
    events: group.events,
    ...(group.parent ? { parent: group.parent } : {}),
    createdAt: group.createdAt,
    sequence: group.sequence,
    policy: group.policy,
    status: "queued",
    blockedBy: [],
  };
  return true;
}

function functionThrottleReadyAt(
  state: FunctionAdmissionState,
  throttle: NonNullable<FunctionAdmissionPolicy["throttle"]>,
  now: number,
): number {
  const interval = throttle.periodMs / throttle.limit;
  const current = state.throttle[throttle.key] ?? {
    tokens: throttle.burst,
    at: now,
    expiresAt: now + throttle.periodMs,
  };
  const tokens = Math.min(throttle.burst, current.tokens + (now - current.at) / interval);
  state.throttle[throttle.key] = { tokens, at: now, expiresAt: now + throttle.periodMs };
  return tokens >= 1 ? now : now + (1 - tokens) * interval;
}

function peekFunctionThrottleReadyAt(
  state: FunctionAdmissionState,
  throttle: NonNullable<FunctionAdmissionPolicy["throttle"]>,
  now: number,
): number {
  const interval = throttle.periodMs / throttle.limit;
  const current = state.throttle[throttle.key] ?? {
    tokens: throttle.burst,
    at: now,
    expiresAt: now + throttle.periodMs,
  };
  const tokens = Math.min(throttle.burst, current.tokens + (now - current.at) / interval);
  return tokens >= 1 ? now : now + (1 - tokens) * interval;
}

function consumeFunctionThrottle(
  state: FunctionAdmissionState,
  throttle: NonNullable<FunctionAdmissionPolicy["throttle"]>,
  now: number,
): void {
  functionThrottleReadyAt(state, throttle, now);
  const current = state.throttle[throttle.key];
  if (current) current.tokens = Math.max(0, current.tokens - 1);
}

function releaseFunctionAdmission(state: FunctionAdmissionState, runId: string): string[] {
  const job = state.jobs[runId];
  if (!job) return [];
  if (job.status !== "active") {
    delete state.jobs[runId];
    return [];
  }
  delete state.active[runId];
  if (job.segmentGroup && state.activeSegments[job.segmentGroup] === runId) {
    delete state.activeSegments[job.segmentGroup];
  }
  const released: string[] = [];
  for (const limit of job.policy.concurrency) {
    const count = (state.concurrency[limit.key] ?? 1) - 1;
    if (count > 0) state.concurrency[limit.key] = count;
    else delete state.concurrency[limit.key];
    released.push(limit.key);
  }
  const singleton = job.policy.singleton;
  if (singleton && state.singletons[singleton.key] === runId) {
    delete state.singletons[singleton.key];
    released.push(singleton.key);
  }
  delete state.jobs[runId];
  return released;
}

function functionAdmissionBlockers(
  state: FunctionAdmissionState,
  job: FunctionAdmissionJob,
  now: number,
): string[] {
  const blockers = job.policy.concurrency
    .filter(({ key, limit }) => (state.concurrency[key] ?? 0) >= limit)
    .map(({ key }) => key);
  const singleton = job.policy.singleton;
  if (singleton && state.singletons[singleton.key] !== undefined) {
    blockers.push(singleton.key);
  }
  if (job.policy.throttle && peekFunctionThrottleReadyAt(state, job.policy.throttle, now) > now) {
    blockers.push(job.policy.throttle.key);
  }
  return blockers;
}

function indexFunctionAdmissionJob(
  state: FunctionAdmissionState,
  job: FunctionAdmissionJob,
  blockers: readonly string[],
): void {
  const previous = new Set(job.blockedBy);
  job.blockedBy = [...new Set(blockers)];
  for (const blocker of job.blockedBy) {
    if (previous.has(blocker)) continue;
    const heap = (state.waiters[blocker] ??= []);
    pushFunctionAdmissionHeap(state, heap, job.id);
  }
}

function expireFunctionAdmissionJob(
  state: FunctionAdmissionState,
  job: FunctionAdmissionJob,
): void {
  if (job.kind !== "run") return;
  const actionId = `expire:${job.id}`;
  state.actions[actionId] = {
    id: actionId,
    order: ++state.actionSequence,
    type: "expire",
    ownerId: job.ownerId,
    runId: job.runId,
    functionId: job.functionId,
    events: job.events,
    ...(job.parent ? { parent: job.parent } : {}),
  };
  delete state.jobs[job.id];
}

function rejectFunctionAdmission(
  state: FunctionAdmissionState,
  id: string,
  parent: FunctionAdmissionJob["parent"],
  reason: Extract<FunctionAdmissionAction, { readonly type: "reject" }>["reason"],
): void {
  if (!parent) return;
  const actionId = `reject:${id}:${reason}`;
  state.actions[actionId] = {
    id: actionId,
    order: ++state.actionSequence,
    type: "reject",
    parent,
    reason,
  };
}

function stageFunctionAdmissionJob(
  state: FunctionAdmissionState,
  job: FunctionAdmissionJob,
  now: number,
): void {
  const deadline =
    job.policy.startTimeoutMs === undefined ? undefined : job.createdAt + job.policy.startTimeoutMs;
  if (deadline !== undefined && deadline <= now) {
    expireFunctionAdmissionJob(state, job);
    return;
  }
  const singleton = job.policy.singleton;
  const singletonRun = singleton ? state.singletons[singleton.key] : undefined;
  if (singletonRun && singletonRun !== job.id) {
    if (singleton?.mode === "skip") {
      rejectFunctionAdmission(state, job.id, job.parent, "singleton_skip");
      delete state.jobs[job.id];
      return;
    }
    const actionId = `cancel:${singletonRun}:for:${job.id}`;
    if (!state.actions[actionId]) {
      state.actions[actionId] = {
        id: actionId,
        order: ++state.actionSequence,
        type: "cancel",
        ownerId: state.jobs[singletonRun]?.ownerId ?? job.ownerId,
        runId: state.jobs[singletonRun]?.runId ?? singletonRun,
      };
    }
  }
  const blockers = functionAdmissionBlockers(state, job, now);
  if (blockers.length > 0) {
    indexFunctionAdmissionJob(state, job, blockers);
    return;
  }
  job.blockedBy = [];
  pushFunctionAdmissionHeap(state, state.ready, job.id);
}

function drainFunctionAdmissionReady(state: FunctionAdmissionState, now: number): void {
  for (;;) {
    const id = popFunctionAdmissionHeap(state, state.ready);
    if (!id) return;
    const job = state.jobs[id];
    if (!job || job.status !== "queued") continue;
    const blockers = functionAdmissionBlockers(state, job, now);
    if (blockers.length > 0) {
      indexFunctionAdmissionJob(state, job, blockers);
      continue;
    }
    job.blockedBy = [];
    job.status = "active";
    state.active[job.id] = true;
    if (job.segmentGroup) state.activeSegments[job.segmentGroup] = job.id;
    for (const limit of job.policy.concurrency) {
      state.concurrency[limit.key] = (state.concurrency[limit.key] ?? 0) + 1;
    }
    const singleton = job.policy.singleton;
    if (singleton) state.singletons[singleton.key] = job.id;
    if (job.policy.throttle) consumeFunctionThrottle(state, job.policy.throttle, now);
    const actionId = `start:${job.id}`;
    state.actions[actionId] =
      job.kind === "segment"
        ? {
            id: actionId,
            order: ++state.actionSequence,
            type: "grant",
            ownerId: job.ownerId,
            runId: job.runId,
            segmentId: job.id,
            operationId: job.operationId!,
            attempt: job.attempt!,
          }
        : {
            id: actionId,
            order: ++state.actionSequence,
            type: "start",
            ownerId: job.ownerId,
            runId: job.runId,
            functionId: job.functionId,
            events: job.events,
            ...(job.parent ? { parent: job.parent } : {}),
          };
  }
}

function activateFunctionAdmissionWaiters(
  state: FunctionAdmissionState,
  blockers: readonly string[],
  now: number,
): void {
  for (const blocker of new Set(blockers)) {
    const heap = state.waiters[blocker];
    if (!heap) continue;
    for (;;) {
      const id = popFunctionAdmissionHeap(state, heap);
      if (!id) break;
      const job = state.jobs[id];
      if (!job || job.status !== "queued" || !job.blockedBy.includes(blocker)) continue;
      job.blockedBy = job.blockedBy.filter((key) => key !== blocker);
      const current = functionAdmissionBlockers(state, job, now);
      if (current.includes(blocker)) {
        indexFunctionAdmissionJob(state, job, current);
        break;
      }
      indexFunctionAdmissionJob(state, job, current);
      if (current.length === 0) {
        pushFunctionAdmissionHeap(state, state.ready, job.id);
        if (!blocker.startsWith("throttle:")) break;
        drainFunctionAdmissionReady(state, now);
      }
    }
    if (heap.length === 0) delete state.waiters[blocker];
  }
  drainFunctionAdmissionReady(state, now);
}

function promoteFunctionAdmissionCandidates(
  state: FunctionAdmissionState,
  candidates: readonly string[],
  now: number,
): void {
  for (const id of candidates) {
    const job = state.jobs[id];
    if (job?.status === "queued") stageFunctionAdmissionJob(state, job, now);
  }
  drainFunctionAdmissionReady(state, now);
}

function materializeFunctionAdmissionGroups(state: FunctionAdmissionState, now: number): string[] {
  const materialized: string[] = [];
  for (const groups of [state.batches, state.debounces]) {
    for (const [key, group] of Object.entries(groups)) {
      if (group.wakeAt > now) continue;
      if (addFunctionAdmissionJob(state, group)) materialized.push(group.id);
      delete groups[key];
    }
  }
  return materialized;
}

function submitFunctionAdmission(
  state: FunctionAdmissionState,
  mutation: Extract<FunctionAdmissionMutation, { readonly type: "submit" }>,
): string[] {
  const { event, functionId, now, policy } = mutation;
  if (policy.idempotencyKey !== undefined) {
    const key = `${functionId}:${policy.idempotencyKey}`;
    if ((state.idempotency[key] ?? 0) > now) {
      rejectFunctionAdmission(state, mutation.id, mutation.parent, "idempotency");
      return [];
    }
    state.idempotency[key] = now + functionIdempotencyPeriodMs;
  }
  if (policy.idempotencyKey === undefined && policy.rateLimit) {
    const { key, limit, periodMs } = policy.rateLimit;
    const timestamps = (state.rateWindows[key]?.timestamps ?? []).filter(
      (at) => at > now - periodMs,
    );
    state.rateWindows[key] = { timestamps, expiresAt: now + periodMs };
    if (timestamps.length >= limit) {
      rejectFunctionAdmission(state, mutation.id, mutation.parent, "rate_limit");
      return [];
    }
    timestamps.push(now);
  }
  const sequence = ++state.sequence;
  if (policy.batch) {
    const existing = state.batches[policy.batch.key];
    const { batch: _batch, ...unbatchedPolicy } = policy;
    const group: FunctionAdmissionGroup = existing ?? {
      ownerId: mutation.ownerId,
      id: `${mutation.id}:batch`,
      runId: `${mutation.runId}:batch`,
      functionId,
      createdAt: now,
      sequence,
      policy: unbatchedPolicy,
      events: [],
      ...(mutation.parent ? { parent: mutation.parent } : {}),
      wakeAt: now + policy.batch.timeoutMs,
    };
    if (!group.events.some(({ id }) => id === event.id)) group.events.push(event);
    state.batches[policy.batch.key] = group;
    if (group.events.length >= policy.batch.maxSize) {
      const added = addFunctionAdmissionJob(state, group);
      delete state.batches[policy.batch.key];
      return added ? [group.id] : [];
    }
    return [];
  }
  if (policy.debounce) {
    const existing = state.debounces[policy.debounce.key];
    const { debounce: _debounce, ...undebouncedPolicy } = policy;
    const firstAt = existing?.createdAt ?? now;
    const maximum =
      policy.debounce.timeoutMs === undefined
        ? Number.POSITIVE_INFINITY
        : firstAt + policy.debounce.timeoutMs;
    state.debounces[policy.debounce.key] = {
      ownerId: mutation.ownerId,
      id: existing?.id ?? `${mutation.id}:debounce`,
      runId: existing?.runId ?? `${mutation.runId}:debounce`,
      functionId,
      createdAt: firstAt,
      sequence: existing?.sequence ?? sequence,
      policy: undebouncedPolicy,
      events: [event],
      ...(mutation.parent ? { parent: mutation.parent } : {}),
      wakeAt: Math.min(now + policy.debounce.periodMs, maximum),
    };
    return [];
  }
  const added = addFunctionAdmissionJob(state, {
    ownerId: mutation.ownerId,
    id: mutation.id,
    runId: mutation.runId,
    functionId,
    createdAt: now,
    sequence,
    policy,
    events: [event],
    ...(mutation.parent ? { parent: mutation.parent } : {}),
  });
  return added ? [mutation.id] : [];
}

function submitFunctionAdmissionSegment(
  state: FunctionAdmissionState,
  mutation: Extract<FunctionAdmissionMutation, { readonly type: "submitSegment" }>,
): string[] {
  const stale = state.activeSegments[mutation.segmentGroup];
  if (stale && stale !== mutation.id) releaseFunctionAdmission(state, stale);
  const added = addFunctionAdmissionJob(state, {
    ownerId: mutation.ownerId,
    id: mutation.id,
    runId: mutation.runId,
    kind: "segment",
    segmentGroup: mutation.segmentGroup,
    operationId: mutation.operationId,
    attempt: mutation.attempt,
    functionId: mutation.functionId,
    createdAt: mutation.createdAt,
    sequence: ++state.sequence,
    policy: mutation.policy,
    events: [mutation.event],
  });
  return added ? [mutation.id] : [];
}

function functionAdmissionMutationRequiresProgram(
  state: FunctionAdmissionState,
  mutation: FunctionAdmissionMutation,
): boolean {
  switch (mutation.type) {
    case "submit":
    case "advance":
      return true;
    case "acknowledge":
      return false;
    case "submitSegment":
      return false;
    case "release": {
      const job = state.jobs[mutation.runId];
      if (job?.status !== "active") return false;
      const released = [
        ...job.policy.concurrency.map(({ key }) => key),
        ...(job.policy.singleton ? [job.policy.singleton.key] : []),
      ];
      return released.some((key) =>
        state.waiters[key]?.some((id) => state.jobs[id]?.status === "queued"),
      );
    }
  }
}

function reduceFunctionAdmission(
  state: FunctionAdmissionState,
  mutation: FunctionAdmissionMutation,
  notify = true,
): void {
  state.now = Math.max(state.now, mutation.now);
  cleanFunctionAdmission(state, mutation.now);
  switch (mutation.type) {
    case "submit": {
      const candidates = submitFunctionAdmission(state, mutation);
      promoteFunctionAdmissionCandidates(state, candidates, mutation.now);
      if (
        mutation.policy.batch ||
        mutation.policy.debounce ||
        mutation.policy.startTimeoutMs !== undefined ||
        mutation.policy.throttle
      ) {
        state.nextWakeAt = computeFunctionAdmissionWakeAt(state);
      }
      break;
    }
    case "submitSegment": {
      const candidates = submitFunctionAdmissionSegment(state, mutation);
      promoteFunctionAdmissionCandidates(state, candidates, mutation.now);
      if (!notify) delete state.actions[`start:${mutation.id}`];
      break;
    }
    case "release": {
      const released = releaseFunctionAdmission(state, mutation.runId);
      activateFunctionAdmissionWaiters(state, released, mutation.now);
      if (state.nextWakeAt !== null) {
        state.nextWakeAt = computeFunctionAdmissionWakeAt(state);
      }
      break;
    }
    case "advance": {
      const candidates = materializeFunctionAdmissionGroups(state, mutation.now);
      for (const job of Object.values(state.jobs)) {
        if (
          job.status === "queued" &&
          job.policy.startTimeoutMs !== undefined &&
          job.createdAt + job.policy.startTimeoutMs <= mutation.now
        ) {
          expireFunctionAdmissionJob(state, job);
        }
      }
      promoteFunctionAdmissionCandidates(state, candidates, mutation.now);
      activateFunctionAdmissionWaiters(
        state,
        Object.keys(state.waiters).filter((key) => key.startsWith("throttle:")),
        mutation.now,
      );
      state.nextWakeAt = computeFunctionAdmissionWakeAt(state);
      break;
    }
    case "acknowledge":
      delete state.actions[mutation.actionId];
      break;
  }
}

function computeFunctionAdmissionWakeAt(state: FunctionAdmissionState): number | null {
  let next = Number.POSITIVE_INFINITY;
  for (const group of [...Object.values(state.batches), ...Object.values(state.debounces)]) {
    next = Math.min(next, group.wakeAt);
  }
  for (const job of Object.values(state.jobs)) {
    if (job.status !== "queued") continue;
    if (job.policy.startTimeoutMs !== undefined) {
      next = Math.min(next, job.createdAt + job.policy.startTimeoutMs);
    }
    const singleton = job.policy.singleton;
    const blockedBySingleton = singleton
      ? Boolean(state.singletons[singleton.key] && state.singletons[singleton.key] !== job.id)
      : false;
    const blockedByConcurrency = job.policy.concurrency.some(
      ({ key, limit }) => (state.concurrency[key] ?? 0) >= limit,
    );
    if (job.policy.throttle && !blockedBySingleton && !blockedByConcurrency) {
      const readyAt = peekFunctionThrottleReadyAt(state, job.policy.throttle, state.now);
      if (readyAt > state.now) next = Math.min(next, readyAt);
    }
  }
  return Number.isFinite(next) ? next : null;
}

function functionAdmissionWakeAt(state: FunctionAdmissionState): number | null {
  return state.nextWakeAt;
}

export type FunctionsFeature<Contract extends FunctionsContract> = {
  readonly Resources: {
    readonly runs: WorkflowRunResource<FunctionWorkflowContract<Contract>>;
    readonly scheduler: WorkflowSchedulerResource;
    readonly events: FunctionEventResource;
    readonly executions: FunctionExecutionResource;
    readonly index: FunctionIndexResource;
    readonly admission: FunctionAdmissionResource;
  };
  readonly Components: {};
  readonly Dependencies: { readonly server: FunctionFeatureDependencies<Contract> };
  readonly Programs: {
    readonly server: WorkflowFeature<WorkflowContract>["Programs"]["server"] & {
      readonly indexRuns: {
        readonly Events: readonly ["runs.transitioned"];
        readonly Key: string;
        readonly KeyVersion: 1;
      };
      readonly cancelRuns: {
        readonly Events: readonly ["executions.changed"];
        readonly Key: WorkflowRunKey;
        readonly KeyVersion: 1;
      };
      readonly deliverSignals: {
        readonly Events: readonly ["index.changed"];
        readonly Key: string;
        readonly KeyVersion: 1;
      };
      readonly admitRuns: {
        readonly Events: readonly ["admission.changed"];
        readonly Key: string;
        readonly KeyVersion: 1;
      };
      readonly reportFailures: {
        readonly Events: readonly ["runs.transitioned"];
        readonly Key: WorkflowRunKey;
        readonly KeyVersion: 1;
      };
      readonly dispatchEvents: {
        readonly Events: readonly ["events.sent"];
        readonly Key: string;
        readonly KeyVersion: 1;
      };
    };
  };
  readonly API: FunctionsAPI<Contract>;
};

export type CreateFunctionsOptions<App extends AppSpec, Contract extends FunctionsContract> = {
  readonly appVersion?: string;
  readonly dependencies: FeatureDef<App, FunctionsFeature<Contract>>["dependencies"]["server"];
};

export type DefineFunctions<Contract extends FunctionsContract> = (context: {
  readonly createFunction: CreateFunction<Contract>;
  readonly dependencies: Readonly<FunctionDependencies<Contract>>;
}) => void;

type RegisteredFunction = {
  readonly configuration: {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly triggers?:
      | {
          readonly event: string;
          readonly if?: string;
          readonly schema?: FunctionSchema<JsonValue>;
        }
      | { readonly cron: string; readonly jitter?: string }
      | readonly (
          | {
              readonly event: string;
              readonly if?: string;
              readonly schema?: FunctionSchema<JsonValue>;
            }
          | { readonly cron: string; readonly jitter?: string }
        )[];
    readonly cancelOn?: readonly {
      readonly event: string;
      readonly timeout?: FunctionTimeout;
      readonly if?: string;
      readonly match?: string;
    }[];
    readonly timeouts?: {
      readonly start?: string;
      readonly finish?: string;
    };
    readonly concurrency?: FunctionAdmissionConfiguration["concurrency"];
    readonly batchEvents?: FunctionAdmissionConfiguration["batchEvents"];
    readonly idempotency?: string;
    readonly rateLimit?: FunctionAdmissionConfiguration["rateLimit"];
    readonly throttle?: FunctionAdmissionConfiguration["throttle"];
    readonly debounce?: FunctionAdmissionConfiguration["debounce"];
    readonly priority?: FunctionAdmissionConfiguration["priority"];
    readonly singleton?: FunctionAdmissionConfiguration["singleton"];
    readonly retries?: number;
    readonly onFailure?: (
      context: ErasedFunctionFailureHandlerContext,
    ) => JsonValue | Promise<JsonValue> | void | Promise<void>;
  };
  readonly handler: (context: {
    readonly event: {
      readonly id: string;
      readonly name: string;
      readonly data: JsonValue;
      readonly ts: number;
      readonly v?: string;
      readonly meta?: FunctionReceivedEventMeta;
    };
    readonly events: readonly {
      readonly id: string;
      readonly name: string;
      readonly data: JsonValue;
      readonly ts: number;
      readonly v?: string;
      readonly meta?: FunctionReceivedEventMeta;
    }[];
    readonly step: ErasedFunctionStep;
    readonly group: FunctionGroup;
    readonly runId: string;
    readonly logger: FunctionLogger;
    readonly attempt: number;
    readonly maxAttempts?: number;
  }) => JsonValue | Promise<JsonValue> | void | Promise<void>;
};

type RuntimeFunctionFailureEvent = {
  readonly id: string;
  readonly name: "inngest/function.failed";
  readonly data: {
    readonly function_id: string;
    readonly run_id: string;
    readonly error: JsonValue;
    readonly event: RuntimeFunctionEvent;
  };
  readonly ts: number;
};

type ErasedFunctionFailureHandlerContext = {
  readonly event: RuntimeFunctionFailureEvent;
  readonly events: readonly [RuntimeFunctionFailureEvent];
  readonly error: Error;
  readonly step: ErasedFunctionStep;
  readonly group: FunctionGroup;
  readonly runId: string;
  readonly logger: FunctionLogger;
  readonly attempt: number;
  readonly maxAttempts?: number;
};

type RuntimeFunctionEvent = {
  readonly id: string;
  readonly name: string;
  readonly data: JsonValue;
  readonly ts: number;
  readonly v?: string;
  readonly meta?: FunctionReceivedEventMeta;
};

function normalizeFunctionEventMeta(
  meta: FunctionEventMeta | undefined,
): FunctionReceivedEventMeta | undefined {
  if (!meta) return undefined;
  return meta.sessions
    ? {
        sessions: Object.fromEntries(
          Object.entries(meta.sessions).map(([key, value]) => [key, String(value)]),
        ),
      }
    : {};
}

type RuntimeFunctionInvocation = RuntimeFunctionEvent & {
  readonly events?: RuntimeFunctionEvent[];
};

function runtimeFunctionEvents(input: JsonValue): readonly RuntimeFunctionEvent[] {
  const invocation = input as unknown as RuntimeFunctionInvocation;
  return invocation.events?.length ? invocation.events : [invocation];
}

type ErasedFunctionStep = {
  run<Result extends JsonValue | void>(
    id: FunctionStepOptions,
    handler: (...input: JsonValue[]) => Result | Promise<Result>,
    ...input: JsonValue[]
  ): Promise<Result>;
  fetch(id: FunctionStepOptions, input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  sleep(id: FunctionStepOptions, duration: FunctionDuration): Promise<void>;
  sleepUntil(id: FunctionStepOptions, at: FunctionInstant): Promise<void>;
  waitForEvent(
    id: FunctionStepOptions,
    options: {
      readonly event: string;
      readonly timeout?: FunctionTimeout;
      readonly match?: string;
      readonly if?: string;
      readonly schema?: FunctionSchema<JsonValue>;
    },
  ): Promise<{
    readonly id: string;
    readonly name: string;
    readonly data: JsonValue;
    readonly ts: number;
  } | null>;
  waitForSignal(
    id: FunctionStepOptions,
    options: {
      readonly signal: string;
      readonly timeout: FunctionTimeout;
      readonly onConflict: "replace" | "fail";
    },
  ): Promise<{ readonly signal: string; readonly data: JsonValue } | null>;
  invoke(
    id: FunctionStepOptions,
    options: {
      readonly function: {
        readonly id: string;
        readonly functionId?: string;
        readonly appId?: string;
      };
      readonly data?: JsonValue;
      readonly timeout?: FunctionTimeout;
    },
  ): Promise<JsonValue>;
  sendEvent(
    id: FunctionStepOptions,
    event:
      | {
          readonly id?: string;
          readonly name: string;
          readonly data: JsonValue;
          readonly ts?: number;
          readonly v?: string;
          readonly meta?: FunctionEventMeta;
        }
      | readonly {
          readonly id?: string;
          readonly name: string;
          readonly data: JsonValue;
          readonly ts?: number;
          readonly v?: string;
          readonly meta?: FunctionEventMeta;
        }[],
  ): Promise<FunctionSendResult>;
  sendSignal(
    id: FunctionStepOptions,
    options: { readonly signal: string; readonly data?: JsonValue },
  ): Promise<FunctionSendSignalResult>;
};

type ErasedWorkflowContext = {
  readonly runId: string;
  readonly ownerId: string;
  readonly now: number;
  readonly attempt: number;
  perform<Result extends JsonValue>(
    id: string,
    effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
    options?: { readonly retry?: WorkflowRetry },
  ): Promise<Result>;
  [performGatedWorkflowEffect]<Result extends JsonValue>(
    id: string,
    effect: (context: WorkflowEffectContext) => Result | Promise<Result>,
    options: { readonly retry?: WorkflowRetry } | undefined,
    gate: WorkflowEffectGate,
  ): Promise<Result>;
  sleep(id: string, durationMs: number): Promise<void>;
  waitFor(
    id: string,
    signal: string,
    options?: {
      readonly timeoutMs?: number;
      readonly match?: string;
      readonly condition?: string;
    },
  ): Promise<JsonValue>;
  invoke(
    id: string,
    workflow: string,
    input: JsonValue,
    options?: { readonly runId?: string; readonly timeoutMs?: number },
  ): Promise<JsonValue>;
  [withWorkflowRace]<Result>(race: string | undefined, run: () => Result): Result;
  [settleWorkflowRace](race: string): void;
  [waitForFunctionSignal](
    id: string,
    signal: string,
    options: {
      readonly timeoutMs: number;
      readonly conflict: "replace" | "fail";
    },
  ): Promise<JsonValue>;
};

const sendFunctionEvent = Symbol("sendFunctionEvent");
const sendFunctionSignal = Symbol("sendFunctionSignal");
const admitFunctionStep = Symbol("admitFunctionStep");
const executeFunctionStep = Symbol("executeFunctionStep");
const fetchFunctionRequest = Symbol("fetchFunctionRequest");
const routeFunctionInvocation = Symbol("routeFunctionInvocation");

type SendFunctionEvent = (
  event: Omit<RuntimeFunctionEvent, "id" | "ts"> & {
    readonly id?: string;
    readonly ts?: number;
  },
  identity: string,
  ownerId: string,
) => Promise<string>;

type SendFunctionSignal = (
  signal: string,
  data: JsonValue,
  ownerId: string,
) => Promise<FunctionSendSignalResult>;

type AdmitFunctionStep = (
  ownerId: string,
  runId: string,
  functionId: string,
  event: RuntimeFunctionEvent,
  createdAt: number,
  operationId: string,
  attempt: number,
) => Promise<boolean>;

type ExecuteFunctionStep = <Result extends JsonValue>(
  ownerId: string,
  runId: string,
  functionId: string,
  event: RuntimeFunctionEvent,
  createdAt: number,
  operationId: string,
  attempt: number,
  signal: AbortSignal,
  execute: () => Result | Promise<Result>,
) => Promise<Result>;

const functionExpressions = new Map<string, CelExpression>();

function functionEventPatternMatches(pattern: string, event: string): boolean {
  return pattern.endsWith("*") ? event.startsWith(pattern.slice(0, -1)) : event === pattern;
}

function assertFunctionEventPattern(pattern: string, label: string): void {
  if (!pattern.trim()) throw new TypeError(`${label} cannot be empty.`);
  const wildcard = pattern.indexOf("*");
  if (wildcard >= 0 && (wildcard !== pattern.length - 1 || pattern.lastIndexOf("*") !== wildcard)) {
    throw new TypeError(`${label} may contain one wildcard only at the end.`);
  }
}

function compileFunctionExpression(expression: string, label: string): CelExpression {
  const cached = functionExpressions.get(expression);
  if (cached) return cached;
  try {
    const compiled = parseCel(expression);
    functionExpressions.set(expression, compiled);
    return compiled;
  } catch (cause) {
    throw new TypeError(`${label} is not a valid CEL expression.`, { cause });
  }
}

function evaluateFunctionCondition(
  expression: string,
  context: Readonly<Record<string, unknown>>,
  label: string,
): boolean {
  const result = compileFunctionExpression(expression, label)(context);
  if (typeof result !== "boolean") {
    throw new TypeError(`${label} must evaluate to a boolean.`);
  }
  return result;
}

function evaluateFunctionValue(
  expression: string,
  event: RuntimeFunctionEvent,
  label: string,
): string {
  const result = compileFunctionExpression(expression, label)({ event });
  if (result === undefined || typeof result === "function" || typeof result === "symbol") {
    throw new TypeError(`${label} must evaluate to a JSON value.`);
  }
  try {
    const encoded = JSON.stringify(result);
    if (encoded === undefined) throw new TypeError();
    return encoded;
  } catch (cause) {
    throw new TypeError(`${label} must evaluate to a JSON value.`, { cause });
  }
}

function functionAdmissionPolicy(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): FunctionAdmissionPolicy {
  const label = `Function ${JSON.stringify(configuration.id)}`;
  const value = (expression: string | undefined, fallback: string, name: string): string =>
    expression ? evaluateFunctionValue(expression, event, `${label} ${name}`) : fallback;
  const rawConcurrency =
    configuration.concurrency === undefined
      ? []
      : typeof configuration.concurrency === "number"
        ? [configuration.concurrency]
        : Array.isArray(configuration.concurrency)
          ? configuration.concurrency
          : [configuration.concurrency];
  const concurrency = rawConcurrency.flatMap((option, index): FunctionAdmissionLimit[] => {
    const normalized =
      typeof option === "number" ? { limit: option, scope: "fn" as const } : option;
    if (normalized.limit === 0) return [];
    const scope = normalized.scope ?? "fn";
    const namespace =
      scope === "env"
        ? "environment"
        : scope === "account"
          ? "account"
          : `function:${configuration.id}`;
    return [
      {
        key: `concurrency:${namespace}:${value(normalized.key, "*", `concurrency ${index + 1} key`)}`,
        limit: normalized.limit,
      },
    ];
  });
  const batchEligible =
    !configuration.batchEvents?.if ||
    evaluateFunctionCondition(configuration.batchEvents.if, { event }, `${label} batch if`);
  const rawPriority = configuration.priority?.run
    ? compileFunctionExpression(configuration.priority.run, `${label} priority`)({ event })
    : 0;
  const priorityResult = typeof rawPriority === "bigint" ? Number(rawPriority) : rawPriority;
  if (
    typeof priorityResult !== "number" ||
    !Number.isFinite(priorityResult) ||
    priorityResult < -600 ||
    priorityResult > 600
  ) {
    throw new TypeError(`${label} priority must evaluate to a number from -600 through 600.`);
  }
  return {
    concurrency,
    ...(configuration.batchEvents && batchEligible
      ? {
          batch: {
            key: `batch:${configuration.id}:${value(configuration.batchEvents.key, "*", "batch key")}`,
            maxSize: configuration.batchEvents.maxSize,
            timeoutMs: durationMs(configuration.batchEvents.timeout, `${label} batch timeout`),
          },
        }
      : {}),
    ...(configuration.idempotency
      ? {
          idempotencyKey: value(configuration.idempotency, "", "idempotency"),
        }
      : {}),
    ...(configuration.rateLimit
      ? {
          rateLimit: {
            key: `rate:${configuration.id}:${value(configuration.rateLimit.key, "*", "rate key")}`,
            limit: configuration.rateLimit.limit,
            periodMs: durationMs(configuration.rateLimit.period, `${label} rate period`),
          },
        }
      : {}),
    ...(configuration.throttle
      ? {
          throttle: {
            key: `throttle:${configuration.id}:${value(configuration.throttle.key, "*", "throttle key")}`,
            limit: configuration.throttle.limit,
            periodMs: durationMs(configuration.throttle.period, `${label} throttle period`),
            burst: configuration.throttle.burst ?? 1,
          },
        }
      : {}),
    ...(configuration.debounce
      ? {
          debounce: {
            key: `debounce:${configuration.id}:${value(configuration.debounce.key, "*", "debounce key")}`,
            periodMs: durationMs(configuration.debounce.period, `${label} debounce period`),
            ...(configuration.debounce.timeout === undefined
              ? {}
              : {
                  timeoutMs: durationMs(
                    configuration.debounce.timeout,
                    `${label} debounce timeout`,
                  ),
                }),
          },
        }
      : {}),
    ...(configuration.singleton
      ? {
          singleton: {
            key: `singleton:${configuration.id}:${value(configuration.singleton.key, "*", "singleton key")}`,
            mode: configuration.singleton.mode,
          },
        }
      : {}),
    priority: Math.max(-600, Math.min(600, priorityResult)),
    ...(configuration.timeouts?.start === undefined
      ? {}
      : {
          startTimeoutMs: durationMs(configuration.timeouts.start, `${label} start timeout`),
        }),
  };
}

function functionRunAdmissionPolicy(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): FunctionAdmissionPolicy {
  return { ...functionAdmissionPolicy(configuration, event), concurrency: [] };
}

function functionInvocationAdmissionPolicy(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): FunctionAdmissionPolicy {
  const {
    batch: _batch,
    debounce: _debounce,
    ...policy
  } = functionRunAdmissionPolicy(configuration, event);
  return policy;
}

function functionExecutionAdmissionPolicy(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): FunctionAdmissionPolicy {
  const policy = functionAdmissionPolicy(configuration, event);
  return {
    concurrency: policy.concurrency,
    priority: policy.priority,
  };
}

type ErasedCreateFunction = (
  configuration: RegisteredFunction["configuration"],
  handler: RegisteredFunction["handler"],
) => { readonly id: string };

type ErasedDefineFunctions = (context: {
  readonly createFunction: ErasedCreateFunction;
  readonly dependencies: Readonly<Record<string, unknown>>;
}) => void;

const functionTestDefinitions = new WeakMap<object, ErasedDefineFunctions>();

function registerFunctionsErased(
  define: ErasedDefineFunctions,
  dependencies: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, RegisteredFunction> {
  const registrations = new Map<string, RegisteredFunction>();
  const createFunction = ((
    configuration: RegisteredFunction["configuration"],
    handler: RegisteredFunction["handler"],
  ) => {
    if (!configuration.id.trim()) throw new TypeError("A function id cannot be empty.");
    if (registrations.has(configuration.id)) {
      throw new TypeError(
        `Function ${JSON.stringify(configuration.id)} is defined more than once.`,
      );
    }
    if (
      configuration.retries !== undefined &&
      (!Number.isSafeInteger(configuration.retries) ||
        configuration.retries < 0 ||
        configuration.retries > 20)
    ) {
      throw new TypeError("Function retries must be an integer from 0 through 20.");
    }
    const label = `Function ${JSON.stringify(configuration.id)}`;
    const concurrency =
      configuration.concurrency === undefined
        ? []
        : typeof configuration.concurrency === "number"
          ? [configuration.concurrency]
          : Array.isArray(configuration.concurrency)
            ? configuration.concurrency
            : [configuration.concurrency];
    if (concurrency.length > 2) {
      throw new TypeError(`${label} may define at most two concurrency limits.`);
    }
    for (const option of concurrency) {
      const limit = typeof option === "number" ? option : option.limit;
      if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new TypeError(`${label} concurrency limits must be non-negative integers.`);
      }
      if (
        typeof option !== "number" &&
        option.scope !== undefined &&
        option.scope !== "fn" &&
        !option.key?.trim()
      ) {
        throw new TypeError(`${label} ${option.scope} concurrency requires a key.`);
      }
      if (typeof option !== "number" && option.key) {
        compileFunctionExpression(option.key, `${label} concurrency key`);
      }
    }
    if (configuration.batchEvents) {
      assertPositiveInteger(configuration.batchEvents.maxSize, `${label} batch maxSize`);
      assertPositiveDuration(configuration.batchEvents.timeout, `${label} batch timeout`);
      if (configuration.batchEvents.key) {
        compileFunctionExpression(configuration.batchEvents.key, `${label} batch key`);
      }
      if (configuration.batchEvents.if) {
        compileFunctionExpression(configuration.batchEvents.if, `${label} batch if`);
      }
    }
    if (configuration.idempotency) {
      compileFunctionExpression(configuration.idempotency, `${label} idempotency`);
    }
    if (configuration.rateLimit) {
      assertPositiveInteger(configuration.rateLimit.limit, `${label} rate limit`);
      assertPositiveDuration(configuration.rateLimit.period, `${label} rate period`);
      if (configuration.rateLimit.key) {
        compileFunctionExpression(configuration.rateLimit.key, `${label} rate key`);
      }
    }
    if (configuration.throttle) {
      assertPositiveInteger(configuration.throttle.limit, `${label} throttle limit`);
      assertPositiveDuration(configuration.throttle.period, `${label} throttle period`);
      if (configuration.throttle.burst !== undefined) {
        assertPositiveInteger(configuration.throttle.burst, `${label} throttle burst`);
      }
      if (configuration.throttle.key) {
        compileFunctionExpression(configuration.throttle.key, `${label} throttle key`);
      }
    }
    if (configuration.debounce) {
      assertPositiveDuration(configuration.debounce.period, `${label} debounce period`);
      if (configuration.debounce.timeout !== undefined) {
        assertPositiveDuration(configuration.debounce.timeout, `${label} debounce timeout`);
      }
      if (configuration.debounce.key) {
        compileFunctionExpression(configuration.debounce.key, `${label} debounce key`);
      }
    }
    if (configuration.priority?.run) {
      compileFunctionExpression(configuration.priority.run, `${label} priority`);
    }
    if (configuration.singleton?.key) {
      compileFunctionExpression(configuration.singleton.key, `${label} singleton key`);
    }
    const triggers = configuration.triggers
      ? Array.isArray(configuration.triggers)
        ? configuration.triggers
        : [configuration.triggers]
      : [];
    if (triggers.length > 10) {
      throw new TypeError(`${label} may define at most ten triggers.`);
    }
    for (const trigger of triggers) {
      if ("cron" in trigger) {
        parseFunctionCron(trigger.cron, `${label} cron`);
        if (trigger.jitter !== undefined) {
          const jitter = durationMs(trigger.jitter, `${label} cron jitter`);
          if (jitter < 1_000 || jitter > 300_000) {
            throw new TypeError(`${label} cron jitter must be between 1 second and 5 minutes.`);
          }
        }
      } else {
        assertFunctionEventPattern(
          trigger.event,
          `Function ${JSON.stringify(configuration.id)} trigger event`,
        );
        if (trigger.if) {
          compileFunctionExpression(
            trigger.if,
            `Function ${JSON.stringify(configuration.id)} trigger if`,
          );
        }
      }
    }
    for (const cancellation of configuration.cancelOn ?? []) {
      assertFunctionEventPattern(
        cancellation.event,
        `Function ${JSON.stringify(configuration.id)} cancellation event`,
      );
      if (cancellation.if && cancellation.match) {
        throw new TypeError(
          `Function ${JSON.stringify(configuration.id)} cancellation cannot define both if and match.`,
        );
      }
      if (cancellation.if) {
        compileFunctionExpression(
          cancellation.if,
          `Function ${JSON.stringify(configuration.id)} cancellation if`,
        );
      }
      if (cancellation.timeout !== undefined) {
        cancellationDeadline(cancellation.timeout, 0, configuration.id);
      }
    }
    if (configuration.timeouts?.start !== undefined) {
      durationMs(
        configuration.timeouts.start,
        `Function ${JSON.stringify(configuration.id)} start timeout`,
      );
    }
    if (configuration.timeouts?.finish !== undefined) {
      durationMs(
        configuration.timeouts.finish,
        `Function ${JSON.stringify(configuration.id)} finish timeout`,
      );
    }
    registrations.set(configuration.id, { configuration, handler });
    return Object.freeze({ id: configuration.id, functionId: configuration.id });
  }) as ErasedCreateFunction;
  define({ createFunction, dependencies });
  return registrations;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertPositiveDuration(value: number | string, label: string): number {
  const duration = durationMs(value, label);
  if (duration <= 0) throw new TypeError(`${label} must be greater than zero.`);
  return duration;
}

const durationUnits: Readonly<Record<string, number>> = {
  ns: 0.000_001,
  us: 0.001,
  µs: 0.001,
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

function temporalTag(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] as
      | string
      | undefined;
  } catch {
    return undefined;
  }
}

function isAbsoluteFunctionTimeout(
  value: FunctionTimeout,
): value is Date | InstantLike | ZonedDateTimeLike {
  const tag = temporalTag(value);
  return value instanceof Date || tag === "Temporal.Instant" || tag === "Temporal.ZonedDateTime";
}

function durationMs(value: FunctionDuration, label: string): number {
  if (temporalTag(value) === "Temporal.Duration") {
    const total = (
      value as DurationLike & {
        total(options: { readonly unit: "milliseconds"; readonly relativeTo: string }): number;
      }
    ).total;
    if (typeof total !== "function") throw new TypeError(`${label} must be a valid duration.`);
    const result = total.call(value, {
      unit: "milliseconds",
      relativeTo: new Date().toISOString().replace(/Z$/, ""),
    });
    assertDuration(result, label);
    return result;
  }
  if (typeof value === "number") {
    assertDuration(value, label);
    return value;
  }
  if (typeof value !== "string") throw new TypeError(`${label} must be a valid duration.`);
  const input = value.trim();
  const token =
    /(\d+(?:\.\d+)?)\s*(milliseconds?|millisecond|ms|microseconds?|microsecond|nanoseconds?|nanosecond|seconds?|second|minutes?|minute|hours?|hour|weeks?|week|days?|day|ns|us|µs|s|m|h|d|w)/giu;
  let result = 0;
  let cursor = 0;
  let matched = false;
  for (const match of input.matchAll(token)) {
    if (match.index === undefined || input.slice(cursor, match.index).trim()) {
      matched = false;
      break;
    }
    const rawUnit = match[2]?.toLowerCase();
    const unit = rawUnit?.startsWith("microsecond")
      ? "us"
      : rawUnit?.startsWith("nanosecond")
        ? "ns"
        : rawUnit;
    const multiplier = unit ? durationUnits[unit] : undefined;
    if (multiplier === undefined) {
      matched = false;
      break;
    }
    result += Number(match[1]) * multiplier;
    cursor = match.index + match[0].length;
    matched = true;
  }
  if (!matched || input.slice(cursor).trim()) {
    throw new TypeError(`${label} must be milliseconds or a duration such as "30s" or "2 hours".`);
  }
  assertDuration(result, label);
  return result;
}

function instantMs(value: FunctionInstant, label: string): number {
  let result: number;
  if (value instanceof Date) {
    result = value.getTime();
  } else if (typeof value === "string") {
    result = Date.parse(value);
  } else if (temporalTag(value) === "Temporal.ZonedDateTime") {
    const toInstant = (value as ZonedDateTimeLike & { toInstant?(): { toString(): string } })
      .toInstant;
    result = Date.parse(toInstant ? toInstant.call(value).toString() : value.toString());
  } else {
    result = Date.parse(value.toString());
  }
  if (!Number.isFinite(result)) throw new TypeError(`${label} must be a valid instant.`);
  return result;
}

function timeoutDurationMs(value: FunctionTimeout, now: number, label: string): number {
  return isAbsoluteFunctionTimeout(value)
    ? Math.max(0, instantMs(value, label) - now)
    : durationMs(value, label);
}

function parseFunctionCron(schedule: string, label: string): Cron {
  const input = schedule.trim();
  const timezone = /^(?:CRON_TZ|TZ)=([^\s]+)\s+(.+)$/u.exec(input);
  const pattern = timezone?.[2] ?? input;
  try {
    return new Cron(pattern, {
      mode: "5-part",
      paused: true,
      ...(timezone?.[1] ? { timezone: timezone[1] } : {}),
    });
  } catch (cause) {
    throw new TypeError(`${label} is not a valid five-part cron schedule.`, { cause });
  }
}

function nextFunctionCron(schedule: string, after: number, label: string): number {
  const next = parseFunctionCron(schedule, label).nextRun(new Date(after));
  if (!next) throw new TypeError(`${label} has no next occurrence.`);
  return next.getTime();
}

function functionCronJitter(identity: string, maximum: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % (Math.floor(maximum) + 1);
}

function cancellationDeadline(
  value: FunctionTimeout,
  startedAt: number,
  functionId: string,
): number {
  const label = `Function ${JSON.stringify(functionId)} cancellation timeout`;
  return isAbsoluteFunctionTimeout(value)
    ? instantMs(value, label)
    : startedAt + durationMs(value, label);
}

function abortable<Result>(
  signal: AbortSignal,
  work: () => Result | Promise<Result>,
): Promise<Result> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<Result>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function functionStepId(value: FunctionStepOptions): string {
  const id = typeof value === "string" ? value : value.id;
  if (!id.trim()) throw new TypeError("A function step id cannot be empty.");
  return id;
}

async function functionStepResult<Result>(id: string, result: Promise<Result>): Promise<Result> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof WorkflowOperationError) throw new StepError(id, error.value);
    throw error;
  }
}

type FunctionParallelState = {
  sequence: number;
  implicit?: { readonly id: string };
};

type FunctionAsyncScope = {
  readonly race?: string;
  readonly experiment?: { found: boolean };
};

const functionAsyncScope = new AsyncLocalStorage<FunctionAsyncScope>();

function observeFunctionExperimentStep(): void {
  const experiment = functionAsyncScope.getStore()?.experiment;
  if (experiment) experiment.found = true;
}

function functionStepRace(
  options: FunctionStepOptions,
  parallel: FunctionParallelState,
  scope: FunctionAsyncScope | undefined,
): string | undefined {
  if (scope?.race) return scope.race;
  if (typeof options === "string" || options.parallelMode !== "race") return undefined;
  if (!parallel.implicit) {
    const implicit = { id: `$race:${parallel.sequence++}` };
    parallel.implicit = implicit;
    queueMicrotask(() => {
      if (parallel.implicit === implicit) parallel.implicit = undefined;
    });
  }
  return parallel.implicit.id;
}

async function runFunctionExperiment<
  const Variants extends Readonly<Record<string, () => JsonValue | Promise<JsonValue>>>,
>(
  step: ErasedFunctionStep,
  id: FunctionStepOptions,
  options: FunctionExperimentOptions<Variants>,
): Promise<FunctionExperimentResult<Variants>> {
  const operationId = functionStepId(id);
  const variants = Object.keys(options.variants);
  if (variants.length === 0) {
    throw new TypeError("group.experiment() requires at least one variant.");
  }
  const selected = await step.run(operationId, async () => {
    const variant = await options.select(variants);
    if (!variants.includes(variant)) {
      throw new NonRetriableError(
        `group.experiment(${JSON.stringify(operationId)}) selected unknown variant ${JSON.stringify(variant)}.`,
      );
    }
    return variant;
  });
  const variant = options.variants[selected];
  if (!variant) {
    throw new NonRetriableError(
      `group.experiment(${JSON.stringify(operationId)}) cannot find variant ${JSON.stringify(selected)}.`,
    );
  }
  const tracker = { found: false };
  const result = await functionAsyncScope.run(
    { ...functionAsyncScope.getStore(), experiment: tracker },
    variant,
  );
  if (!tracker.found) {
    throw new NonRetriableError(
      `group.experiment(${JSON.stringify(operationId)}) variant ${JSON.stringify(selected)} did not use a durable step.`,
    );
  }
  return {
    result,
    variant: selected,
    experimentRef: { experimentName: operationId, variant: selected },
  } as never;
}

function createFunctionGroup(
  context: ErasedWorkflowContext,
  parallel: FunctionParallelState,
  step: ErasedFunctionStep,
): FunctionGroup {
  return {
    async parallel<Result>(
      optionsOrCallback: { readonly mode?: "race" } | (() => Promise<Result>),
      maybeCallback?: () => Promise<Result>,
    ): Promise<Result> {
      const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      if (!callback) throw new TypeError("group.parallel() requires a callback.");
      if (options.mode !== undefined && options.mode !== "race") {
        throw new TypeError(`Unknown parallel mode ${JSON.stringify(options.mode)}.`);
      }
      const race = `$race:${parallel.sequence++}`;
      try {
        return await functionAsyncScope.run({ ...functionAsyncScope.getStore(), race }, callback);
      } finally {
        context[settleWorkflowRace](race);
      }
    },
    experiment(id, options) {
      return runFunctionExperiment(step, id, options);
    },
  };
}

type FunctionFetchSnapshot = {
  readonly status: number;
  readonly statusText: string;
  readonly headers: [string, string][];
  readonly body: string;
  readonly url: string;
  readonly redirected: boolean;
  readonly type: ResponseType;
};

async function fetchFunctionResponse(
  fetcher: FunctionFetch,
  request: Request,
  signal: AbortSignal,
): Promise<FunctionFetchSnapshot> {
  const response = await fetcher(
    new Request(request.clone(), {
      signal: AbortSignal.any([request.signal, signal]),
    }),
  );
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: Buffer.from(await response.arrayBuffer()).toString("base64"),
    url: response.url,
    redirected: response.redirected,
    type: response.type,
  };
}

function restoreFunctionResponse(snapshot: FunctionFetchSnapshot): Response {
  const body = snapshot.body ? Buffer.from(snapshot.body, "base64") : null;
  const response = new Response(body, {
    status: snapshot.status >= 200 && snapshot.status <= 599 ? snapshot.status : 200,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
  Object.defineProperties(response, {
    status: { value: snapshot.status },
    ok: { value: snapshot.status >= 200 && snapshot.status < 300 },
    url: { value: snapshot.url },
    redirected: { value: snapshot.redirected },
    type: { value: snapshot.type },
  });
  return response;
}

function localFunctionReferenceId(reference: {
  readonly id: string;
  readonly functionId?: string;
  readonly appId?: string;
}): string {
  if (reference.appId) {
    throw new NonRetriableError(
      `Function references across applications require an external routing capability; ${JSON.stringify(reference.appId)} is not mounted.`,
    );
  }
  return reference.functionId ?? reference.id;
}

function createFunctionStep(
  context: ErasedWorkflowContext,
  functionId: string,
  event: RuntimeFunctionEvent,
  retries: number,
  parallel: FunctionParallelState,
  send: SendFunctionEvent | undefined,
  sendSignal: SendFunctionSignal | undefined,
  admit: AdmitFunctionStep | undefined,
  execute: ExecuteFunctionStep | undefined,
  fetcher: FunctionFetch | undefined,
  routing: FunctionRouting | undefined,
): ErasedFunctionStep {
  const inParallelScope = <Result>(id: FunctionStepOptions, run: () => Result): Result => {
    const scope = functionAsyncScope.getStore();
    if (scope?.experiment) scope.experiment.found = true;
    return context[withWorkflowRace](functionStepRace(id, parallel, scope), run);
  };
  const perform = <Result extends JsonValue>(
    operationId: string,
    effect: (signal: AbortSignal) => Result | Promise<Result>,
  ): Promise<Result> => {
    const options = { retry: { attempts: retries + 1 } };
    const run = ({ attempt, signal }: WorkflowEffectContext) =>
      execute
        ? execute(
            context.ownerId,
            context.runId,
            functionId,
            event,
            context.now,
            operationId,
            attempt,
            signal,
            () => effect(signal),
          )
        : effect(signal);
    return admit && execute
      ? context[performGatedWorkflowEffect](operationId, run, options, (attempt) =>
          admit(
            context.ownerId,
            context.runId,
            functionId,
            event,
            context.now,
            operationId,
            attempt,
          ),
        )
      : context.perform(operationId, run, options);
  };
  return {
    run(id, handler, ...input) {
      const operationId = functionStepId(id);
      const executeHandler = async (): Promise<JsonValue> => {
        const result = await handler(...input);
        return result === undefined ? null : result;
      };
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          perform(operationId, (signal) => abortable(signal, executeHandler)),
        ),
      ) as Promise<Awaited<ReturnType<typeof handler>>>;
    },
    async fetch(id, input, init) {
      if (!fetcher) throw new Error("Function fetch execution is unavailable.");
      const operationId = functionStepId(id);
      const request = new Request(input, init);
      const snapshot = await functionStepResult(
        operationId,
        inParallelScope(id, () =>
          perform(operationId, (signal) => fetchFunctionResponse(fetcher, request, signal)),
        ),
      );
      return restoreFunctionResponse(snapshot);
    },
    sleep(id, duration) {
      const operationId = functionStepId(id);
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          context.sleep(operationId, durationMs(duration, "Function sleep duration")),
        ),
      );
    },
    sleepUntil(id, at) {
      const operationId = functionStepId(id);
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          context.sleep(
            operationId,
            Math.max(0, instantMs(at, "Function sleep instant") - context.now),
          ),
        ),
      );
    },
    async waitForEvent(id, options) {
      if (options.if) {
        compileFunctionExpression(
          options.if,
          `Function wait ${JSON.stringify(functionStepId(id))} if`,
        );
      }
      try {
        const event = await inParallelScope(id, () =>
          context.waitFor(functionStepId(id), options.event, {
            timeoutMs:
              options.timeout === undefined
                ? undefined
                : timeoutDurationMs(options.timeout, context.now, "Function event timeout"),
            match: options.match,
            condition: options.if,
          }),
        );
        if (options.schema) {
          let issues: readonly FunctionSchemaIssue[];
          try {
            const result = await options.schema["~standard"].validate(
              (event as RuntimeFunctionEvent).data,
            );
            if (!result.issues) return event as RuntimeFunctionEvent;
            issues = result.issues;
          } catch (error) {
            issues = [{ message: error instanceof Error ? error.message : String(error) }];
          }
          throw new FunctionEventValidationError(options.event, issues);
        }
        return event as RuntimeFunctionEvent;
      } catch (error) {
        if (isWorkflowOperationError(error, "timeout")) return null;
        if (error instanceof WorkflowOperationError) {
          throw new StepError(functionStepId(id), error.value);
        }
        throw error;
      }
    },
    async waitForSignal(id, options) {
      assertFunctionSignal(options.signal);
      const operationId = functionStepId(id);
      try {
        const data = await inParallelScope(id, () =>
          context[waitForFunctionSignal](operationId, options.signal, {
            timeoutMs: timeoutDurationMs(options.timeout, context.now, "Function signal timeout"),
            conflict: options.onConflict,
          }),
        );
        return { signal: options.signal, data };
      } catch (error) {
        if (isWorkflowOperationError(error, "timeout")) return null;
        if (error instanceof WorkflowOperationError) {
          throw new StepError(operationId, error.value);
        }
        throw error;
      }
    },
    invoke(id, options) {
      const operationId = functionStepId(id);
      const data = options.data === undefined ? null : options.data;
      const appId = options.function.appId;
      if (appId) {
        if (!routing) {
          localFunctionReferenceId(options.function);
          throw new Error("Unreachable function routing state.");
        }
        const router = routing;
        const timeoutMs =
          options.timeout === undefined
            ? undefined
            : timeoutDurationMs(options.timeout, context.now, "Function invocation timeout");
        return functionStepResult(
          operationId,
          inParallelScope(id, () =>
            context.perform(
              operationId,
              (effect) =>
                router.invoke(
                  {
                    appId,
                    functionId: options.function.functionId ?? options.function.id,
                    data,
                  },
                  {
                    ...effect,
                    ownerId: context.ownerId,
                    runId: context.runId,
                    operationId,
                    ...(timeoutMs === undefined
                      ? {}
                      : { timeoutMs, deadline: context.now + timeoutMs }),
                  },
                ),
              { retry: { attempts: retries + 1 } },
            ),
          ),
        );
      }
      const functionId = localFunctionReferenceId(options.function);
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          context.invoke(
            operationId,
            functionId,
            {
              id: `${context.runId}:${operationId}`,
              name: "inngest/function.invoked",
              data,
              ts: context.now,
            },
            {
              timeoutMs:
                options.timeout === undefined
                  ? undefined
                  : timeoutDurationMs(options.timeout, context.now, "Function invocation timeout"),
            },
          ),
        ),
      );
    },
    sendEvent(id, event) {
      if (!send) throw new Error("Function event delivery is unavailable.");
      const operationId = functionStepId(id);
      const events = Array.isArray(event) ? event : [event];
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          context.perform(operationId, async () => {
            const ids = await Promise.all(
              events.map((item, index) =>
                send(item, `${context.runId}:${operationId}:${index}`, context.ownerId),
              ),
            );
            return { ids };
          }),
        ),
      );
    },
    sendSignal(id, options) {
      if (!sendSignal) throw new Error("Function signal delivery is unavailable.");
      assertFunctionSignal(options.signal);
      const operationId = functionStepId(id);
      return functionStepResult(
        operationId,
        inParallelScope(id, () =>
          context.perform(operationId, async () => {
            const result = await sendSignal(options.signal, options.data ?? null, context.ownerId);
            return result.runId ?? null;
          }),
        ),
      ).then((runId) => ({ runId: typeof runId === "string" ? runId : undefined }));
    },
  };
}

const functionLogger: FunctionLogger = {
  debug: (...values) => console.debug(...values),
  info: (...values) => console.info(...values),
  warn: (...values) => console.warn(...values),
  error: (...values) => console.error(...values),
};

const functionFailurePrefix = "inngest/function.failed:";

function functionFailureName(name: string): string {
  return `${functionFailurePrefix}${name}`;
}

function functionFailureError(value: JsonValue): Error {
  return errorFromJson(value);
}

class FunctionEventValidationError extends NonRetriableError {
  constructor(event: string, issues: readonly FunctionSchemaIssue[]) {
    const detail = issues
      .map((issue) => {
        const path = issue.path?.length ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      })
      .join(", ");
    super(`Event ${JSON.stringify(event)} failed validation${detail ? `: ${detail}` : "."}`);
    this.name = "FunctionEventValidationError";
  }
}

function functionTriggerSchemas(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): readonly FunctionSchema<JsonValue>[] {
  const triggers = configuration.triggers;
  if (!triggers || event.name === "inngest/scheduled.timer") return [];
  const options = Array.isArray(triggers) ? triggers : [triggers];
  if (event.name === "inngest/function.invoked") {
    const explicit = options.filter(
      (trigger) => "event" in trigger && trigger.event === "inngest/function.invoked",
    );
    const candidates = explicit.length ? explicit : options.filter((trigger) => "event" in trigger);
    return candidates.flatMap((trigger) =>
      "schema" in trigger && trigger.schema ? [trigger.schema] : [],
    );
  }
  return options.flatMap((trigger) =>
    "event" in trigger && functionEventPatternMatches(trigger.event, event.name) && trigger.schema
      ? [trigger.schema]
      : [],
  );
}

async function validateFunctionEvents(
  configuration: RegisteredFunction["configuration"],
  events: readonly RuntimeFunctionEvent[],
): Promise<void> {
  for (const event of events) {
    const schemas = functionTriggerSchemas(configuration, event);
    if (schemas.length === 0) continue;
    const results = await Promise.allSettled(
      schemas.map((schema) => Promise.resolve(schema["~standard"].validate(event.data))),
    );
    if (results.some((result) => result.status === "fulfilled" && !result.value.issues)) continue;
    const issues = results.flatMap((result): readonly FunctionSchemaIssue[] => {
      if (result.status === "fulfilled") return result.value.issues ?? [];
      return [
        {
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
      ];
    });
    throw new FunctionEventValidationError(event.name, issues);
  }
}

function createFunctionProgramDefinition(
  registrations: ReadonlyMap<string, RegisteredFunction>,
  appVersion?: string,
): RuntimeDefinition {
  const workflows: Record<string, WorkflowDefinition<WorkflowContract, string>> = {};
  for (const [name, registered] of registrations) {
    workflows[name] = {
      retry: { attempts: (registered.configuration.retries ?? 3) + 1 },
      timeoutMs:
        registered.configuration.timeouts?.finish === undefined
          ? undefined
          : durationMs(
              registered.configuration.timeouts.finish,
              `Function ${JSON.stringify(name)} finish timeout`,
            ),
      async run(context, input, dependencies) {
        const send = (dependencies as Record<PropertyKey, unknown>)[sendFunctionEvent] as
          | SendFunctionEvent
          | undefined;
        const signal = (dependencies as Record<PropertyKey, unknown>)[sendFunctionSignal] as
          | SendFunctionSignal
          | undefined;
        const admit = (dependencies as Record<PropertyKey, unknown>)[admitFunctionStep] as
          | AdmitFunctionStep
          | undefined;
        const execute = (dependencies as Record<PropertyKey, unknown>)[executeFunctionStep] as
          | ExecuteFunctionStep
          | undefined;
        const fetcher = (dependencies as Record<PropertyKey, unknown>)[fetchFunctionRequest] as
          | FunctionFetch
          | undefined;
        const routing = (dependencies as Record<PropertyKey, unknown>)[routeFunctionInvocation] as
          | FunctionRouting
          | undefined;
        const logger =
          (dependencies as FunctionFeatureDependencies<FunctionsContract>).logger ?? functionLogger;
        const events = runtimeFunctionEvents(input);
        const event = events[0];
        if (!event) throw new Error(`Function ${JSON.stringify(name)} received no events.`);
        await validateFunctionEvents(registered.configuration, events);
        const stepAdmission = functionExecutionAdmissionPolicy(registered.configuration, event)
          .concurrency.length
          ? admit
          : undefined;
        const workflowContext = context as unknown as ErasedWorkflowContext;
        const parallel: FunctionParallelState = { sequence: 0 };
        const step = createFunctionStep(
          workflowContext,
          name,
          event,
          registered.configuration.retries ?? 3,
          parallel,
          send,
          signal,
          stepAdmission,
          execute,
          fetcher,
          routing,
        );
        const output = await registered.handler({
          event,
          events,
          step,
          group: createFunctionGroup(workflowContext, parallel, step),
          runId: context.runId,
          logger,
          attempt: context.attempt,
          maxAttempts: (registered.configuration.retries ?? 3) + 1,
        });
        return output === undefined ? null : output;
      },
    };
    const failureHandler = registered.configuration.onFailure;
    if (failureHandler) {
      workflows[functionFailureName(name)] = {
        retry: { attempts: 1 },
        async run(context, input, dependencies) {
          const send = (dependencies as Record<PropertyKey, unknown>)[sendFunctionEvent] as
            | SendFunctionEvent
            | undefined;
          const signal = (dependencies as Record<PropertyKey, unknown>)[sendFunctionSignal] as
            | SendFunctionSignal
            | undefined;
          const admit = (dependencies as Record<PropertyKey, unknown>)[admitFunctionStep] as
            | AdmitFunctionStep
            | undefined;
          const execute = (dependencies as Record<PropertyKey, unknown>)[executeFunctionStep] as
            | ExecuteFunctionStep
            | undefined;
          const fetcher = (dependencies as Record<PropertyKey, unknown>)[fetchFunctionRequest] as
            | FunctionFetch
            | undefined;
          const routing = (dependencies as Record<PropertyKey, unknown>)[
            routeFunctionInvocation
          ] as FunctionRouting | undefined;
          const logger =
            (dependencies as FunctionFeatureDependencies<FunctionsContract>).logger ??
            functionLogger;
          const event = input as RuntimeFunctionFailureEvent;
          const stepAdmission = functionExecutionAdmissionPolicy(
            registered.configuration,
            event.data.event,
          ).concurrency.length
            ? admit
            : undefined;
          const workflowContext = context as unknown as ErasedWorkflowContext;
          const parallel: FunctionParallelState = { sequence: 0 };
          const step = createFunctionStep(
            workflowContext,
            name,
            event.data.event,
            0,
            parallel,
            send,
            signal,
            stepAdmission,
            execute,
            fetcher,
            routing,
          );
          await failureHandler({
            event,
            events: [event],
            error: functionFailureError(event.data.error),
            step,
            group: createFunctionGroup(workflowContext, parallel, step),
            runId: context.runId,
            logger,
            attempt: context.attempt,
            maxAttempts: 1,
          });
          return null;
        },
      };
    }
  }
  return { ...(appVersion === undefined ? {} : { version: appVersion }), workflows };
}

type FunctionsRuntime<App extends AppSpec, Contract extends FunctionsContract> = Pick<
  FeatureDef<App, FunctionsFeature<Contract>>,
  "api" | "components" | "features" | "resources"
>;

function assertFunctionSignal(signal: string): void {
  if (!signal.trim()) throw new TypeError("A function signal cannot be empty.");
}

/** Shared browser-safe half used by the application compiler. */
export function createFunctionsRuntime<App extends AppSpec, Contract extends FunctionsContract>(
  options: { readonly appVersion?: string } = {},
): FunctionsRuntime<App, Contract> {
  const workflow = createWorkflowRuntime<App, FunctionWorkflowContract<Contract>>({
    ...(options.appVersion === undefined ? {} : { version: options.appVersion }),
    queries: {} as WorkflowQueryDefinitions<FunctionWorkflowContract<Contract>>,
  });
  return {
    resources: {
      ...workflow.resources,
      events: {
        state: { event: null },
        authorize({
          actor,
          key,
          operation,
        }: {
          readonly actor: ActorOf<App>;
          readonly key: WorkflowRunKey;
          readonly operation:
            | { readonly type: "read"; readonly origin: "client" | "program" }
            | {
                readonly type: "command";
                readonly name: string;
                readonly origin: "client" | "program";
              };
        }) {
          return operation.origin === "program" || actor.id === key.ownerId;
        },
        events: {
          sent({
            state,
            payload,
          }: {
            readonly state: FunctionEventState;
            readonly payload: RuntimeFunctionEvent;
          }) {
            state.event = payload;
          },
        },
        views: {
          event({ state }: { readonly state: FunctionEventState }) {
            return state.event;
          },
        },
        commands: {
          send(
            context: {
              readonly state: FunctionEventState;
              readonly event: { readonly sent: (event: RuntimeFunctionEvent) => void };
              readonly error: (error: "already_sent") => void;
            },
            { event },
          ) {
            if (context.state.event) return context.error("already_sent");
            context.event.sent(event);
          },
        },
      },
      executions: {
        state: { execution: null },
        authorize({
          actor,
          key,
          operation,
        }: {
          readonly actor: ActorOf<App>;
          readonly key: WorkflowRunKey;
          readonly operation:
            | { readonly type: "read"; readonly origin: "client" | "program" }
            | {
                readonly type: "command";
                readonly name: string;
                readonly origin: "client" | "program";
              };
        }) {
          if (operation.origin === "program") return true;
          if (actor.id !== key.ownerId) return false;
          if (operation.type !== "command") return true;
          return operation.name === "cancel";
        },
        events: {
          changed({
            state,
            payload,
          }: {
            readonly state: FunctionExecutionState;
            readonly payload: FunctionExecutionChanged;
          }) {
            if (payload.type === "projected") state.execution = payload.execution;
          },
        },
        views: {
          run({ state }: { readonly state: FunctionExecutionState }) {
            return state.execution;
          },
        },
        commands: {
          project(
            context: {
              readonly state: FunctionExecutionState;
              readonly event: {
                readonly changed: (change: FunctionExecutionChanged) => void;
              };
              readonly error: (error: "unchanged") => void;
            },
            { execution },
          ) {
            if (
              context.state.execution &&
              context.state.execution.transitionCount >= execution.transitionCount
            ) {
              return context.error("unchanged");
            }
            context.event.changed({ type: "projected", execution });
          },
          cancel(
            context: {
              readonly state: FunctionExecutionState;
              readonly event: {
                readonly changed: (change: FunctionExecutionChanged) => void;
              };
              readonly error: (error: "not_running") => void;
            },
            { reason },
          ) {
            if (context.state.execution?.status !== "running") {
              return context.error("not_running");
            }
            context.event.changed({
              type: "cancelRequested",
              ...(reason === undefined ? {} : { reason }),
            });
          },
        },
      },
      index: {
        state: {
          active: {},
          cancellations: {},
          waits: {},
          waitsByRun: {},
          signals: {},
        },
        authorize({
          actor,
          key,
          operation,
        }: {
          readonly actor: ActorOf<App>;
          readonly key: { readonly ownerId: string };
          readonly operation:
            | { readonly type: "read"; readonly origin: "client" | "program" }
            | {
                readonly type: "command";
                readonly name: string;
                readonly origin: "client" | "program";
              };
        }) {
          if (operation.origin === "program") return true;
          if (actor.id !== key.ownerId) return false;
          if (operation.type !== "command") return true;
          return operation.name === "deliverSignal";
        },
        events: {
          changed({
            state,
            payload,
          }: {
            readonly state: FunctionIndexState;
            readonly payload: FunctionIndexChanged;
          }) {
            if (payload.type === "run") {
              if (payload.active) state.active[payload.id] = true;
              else delete state.active[payload.id];
              for (const registration of payload.cancellations) {
                const key = functionCancellationBucket(registration);
                const bucket = (state.cancellations[key] ??= {});
                if (payload.active) bucket[payload.id] = true;
                else {
                  delete bucket[payload.id];
                  deleteEmptyFunctionIndexBucket(state.cancellations, key);
                }
              }
            } else if (payload.type === "waitsSynchronized") {
              for (const registration of state.waitsByRun[payload.runId] ?? []) {
                const bucket = state.waits[registration.event];
                if (!bucket) continue;
                delete bucket[functionWaitRegistrationId(registration)];
                deleteEmptyFunctionIndexBucket(state.waits, registration.event);
              }
              if (payload.waits.length > 0) {
                state.waitsByRun[payload.runId] = [...payload.waits];
                for (const registration of payload.waits) {
                  (state.waits[registration.event] ??= {})[
                    functionWaitRegistrationId(registration)
                  ] = registration;
                }
              } else {
                delete state.waitsByRun[payload.runId];
              }
            } else if (payload.type === "signalRegistered") {
              state.signals[payload.signal] = payload.registration;
            } else {
              const current = state.signals[payload.signal];
              if (
                current?.runId === payload.registration.runId &&
                current.operationId === payload.registration.operationId
              ) {
                delete state.signals[payload.signal];
              }
            }
          },
        },
        views: {
          active({ state }: { readonly state: FunctionIndexState }) {
            return state.active;
          },
          cancellations({ state }: { readonly state: FunctionIndexState }) {
            return state.cancellations;
          },
          waits({ state }: { readonly state: FunctionIndexState }) {
            return state.waits;
          },
          signals({ state }: { readonly state: FunctionIndexState }) {
            return state.signals;
          },
        },
        commands: {
          open(context: { readonly error: (error: "ready") => void }) {
            context.error("ready");
          },
          index(
            context: {
              readonly state: FunctionIndexState;
              readonly event: { readonly changed: (payload: FunctionIndexChanged) => void };
              readonly error: (error: "unchanged") => void;
            },
            { id, active, cancellations },
          ) {
            if ((context.state.active[id] === true) === active) return context.error("unchanged");
            context.event.changed({ type: "run", id, active, cancellations });
          },
          synchronizeWaits(
            context: {
              readonly state: FunctionIndexState;
              readonly event: { readonly changed: (payload: FunctionIndexChanged) => void };
              readonly error: (error: "unchanged") => void;
            },
            { runId, waits },
          ) {
            const current = context.state.waitsByRun[runId] ?? [];
            if (sameFunctionWaitRegistrations(current, waits)) return context.error("unchanged");
            context.event.changed({ type: "waitsSynchronized", runId, waits });
          },
          registerSignal(
            context: {
              readonly state: FunctionIndexState;
              readonly event: { readonly changed: (payload: FunctionIndexChanged) => void };
              readonly error: (error: "conflict" | "unchanged") => void;
            },
            { signal, registration, conflict },
          ) {
            const current = context.state.signals[signal];
            if (
              current?.runId === registration.runId &&
              current.operationId === registration.operationId
            ) {
              return context.error("unchanged");
            }
            if (current && conflict === "fail") return context.error("conflict");
            context.event.changed({ type: "signalRegistered", signal, registration });
          },
          releaseSignal(
            context: {
              readonly state: FunctionIndexState;
              readonly event: { readonly changed: (payload: FunctionIndexChanged) => void };
              readonly error: (error: "missing") => void;
            },
            { signal, registration },
          ) {
            const current = context.state.signals[signal];
            if (
              current?.runId !== registration.runId ||
              current.operationId !== registration.operationId
            ) {
              return context.error("missing");
            }
            context.event.changed({ type: "signalReleased", signal, registration });
          },
          deliverSignal(
            context: {
              readonly state: FunctionIndexState;
              readonly event: { readonly changed: (payload: FunctionIndexChanged) => void };
              readonly error: (error: "missing") => void;
            },
            { signal, data },
          ) {
            const registration = context.state.signals[signal];
            if (!registration) return context.error("missing");
            context.event.changed({
              type: "signalDelivered",
              signal,
              data,
              registration,
            });
          },
        },
      },
      admission: {
        state: createFunctionAdmissionState(),
        authorize({
          operation,
        }: {
          readonly actor: ActorOf<App>;
          readonly key: { readonly ownerId: string };
          readonly operation:
            | { readonly type: "read"; readonly origin: "client" | "program" }
            | { readonly type: "command"; readonly origin: "client" | "program" };
        }) {
          if (operation.type === "command") return operation.origin === "program";
          return true;
        },
        events: {
          changed({
            state,
            payload,
          }: {
            readonly state: FunctionAdmissionState;
            readonly payload: FunctionAdmissionChanged;
          }) {
            reduceFunctionAdmission(state, payload.mutation, payload.notify);
          },
        },
        views: {
          actions({ state }: { readonly state: FunctionAdmissionState }) {
            return Object.values(state.actions).sort(
              (left, right) => left.order - right.order || left.id.localeCompare(right.id),
            );
          },
          active({ state }: { readonly state: FunctionAdmissionState }) {
            return state.active;
          },
          activeSegments({ state }: { readonly state: FunctionAdmissionState }) {
            return state.activeSegments;
          },
          nextWakeAt({ state }: { readonly state: FunctionAdmissionState }) {
            return functionAdmissionWakeAt(state);
          },
        },
        commands: {
          open(context: { readonly error: (error: "ready") => void }) {
            context.error("ready");
          },
          change(
            context: {
              readonly state: FunctionAdmissionState;
              readonly event: { readonly changed: (change: FunctionAdmissionChanged) => void };
              readonly error: (error: "unchanged") => void;
            },
            mutation: FunctionAdmissionMutation,
          ) {
            const previousWakeAt = functionAdmissionWakeAt(context.state);
            context.event.changed({
              mutation,
              previousWakeAt,
              notify: functionAdmissionMutationRequiresProgram(context.state, mutation),
            });
          },
        },
      },
    },
    api: ((
      context: WorkflowAPIContext & {
        readonly resources: WorkflowAPIContext["resources"] & {
          readonly events: (key: WorkflowRunKey) => {
            readonly event: RuntimeFunctionEvent | null;
            send(input: { readonly event: RuntimeFunctionEvent }): Submission<"already_sent">;
          };
          readonly executions: (key: WorkflowRunKey) => {
            readonly run: RuntimeFunctionExecution | null;
            cancel(input: { readonly reason?: string }): Submission<"not_running">;
          };
          readonly index: (key: { readonly ownerId: string }) => {
            readonly signals: Readonly<Record<string, FunctionSignalRegistration>>;
            deliverSignal(input: {
              readonly signal: string;
              readonly data: JsonValue;
            }): Submission<"missing">;
          };
        };
      },
    ) => {
      const api = workflow.api(context as never) as WorkflowAPI<WorkflowContract>;
      return {
        async send(input: FunctionEventInput<Contract> | readonly FunctionEventInput<Contract>[]) {
          const events = Array.isArray(input) ? input : [input];
          const ids: string[] = [];
          for (const item of events) {
            const id = item.id ?? crypto.randomUUID();
            const event = {
              id,
              name: item.name,
              data: item.data,
              ts: item.ts ?? Date.now(),
              ...(item.v === undefined ? {} : { v: item.v }),
              ...(item.meta === undefined ? {} : { meta: normalizeFunctionEventMeta(item.meta) }),
            } as RuntimeFunctionEvent;
            await context.resources.events({ ownerId: context.actor.id, id }).send({ event });
            ids.push(id);
          }
          return { ids };
        },
        async sendSignal({
          signal,
          data = null,
        }: {
          readonly signal: string;
          readonly data?: JsonValue;
        }) {
          assertFunctionSignal(signal);
          const index = context.resources.index({ ownerId: context.actor.id });
          const registration = index.signals[signal];
          if (!registration) return { runId: undefined };
          const receipt = await index.deliverSignal({ signal, data });
          return { runId: receipt.ok ? registration.runId : undefined };
        },
        getFunction(name: string, id: string) {
          const key = { ownerId: context.actor.id, id };
          const execution = context.resources.executions(key);
          let detailsHandle:
            | {
                readonly run: WorkflowRun<WorkflowContract> | null;
              }
            | undefined;
          const currentExecution = () => {
            const current = execution.run;
            if (current && current.name !== name) {
              throw new Error(
                `Function run ${JSON.stringify(id)} belongs to ${JSON.stringify(current.name)}, not ${JSON.stringify(name)}.`,
              );
            }
            return current;
          };
          const currentDetails = () => {
            detailsHandle ??= api.getWorkflow(name, id) as unknown as {
              readonly run: WorkflowRun<WorkflowContract> | null;
            };
            return detailsHandle.run;
          };
          return {
            get run() {
              return currentExecution();
            },
            get details() {
              return currentDetails();
            },
            cancel(reason?: string) {
              return execution.cancel({ reason });
            },
          };
        },
      };
    }) as unknown as FeatureDef<App, FunctionsFeature<Contract>>["api"],
  };
}

type FunctionEventProgramResource = ProgramResource<
  { Resources: { events: FunctionEventResource } },
  "events"
>;

type FunctionExecutionProgramResource = ProgramResource<
  { Resources: { executions: FunctionExecutionResource } },
  "executions"
>;

type FunctionIndexProgramResource = ProgramResource<
  { Resources: { index: FunctionIndexResource } },
  "index"
>;

async function openFunctionIndex(index: FunctionIndexProgramResource): Promise<void> {
  const receipt = await index.open({});
  if (!receipt.ok && receipt.error !== "ready") {
    throw new Error(`Function index failed to open: ${receipt.error}.`);
  }
}

async function openFunctionAdmission(admission: FunctionAdmissionProgramResource): Promise<void> {
  const receipt = await admission.open({});
  if (!receipt.ok && receipt.error !== "ready") {
    throw new Error(`Function admission failed to open: ${receipt.error}.`);
  }
}

type FunctionAdmissionProgramResource = ProgramResource<
  { Resources: { admission: FunctionAdmissionResource } },
  "admission"
>;

type PendingFunctionAdmissionCommand = {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

function createFunctionAdmissionCommandGate(signal: AbortSignal) {
  const concurrency = 64;
  const pending: PendingFunctionAdmissionCommand[] = [];
  let active = 0;
  let stopped = signal.aborted;
  const stop = (): void => {
    stopped = true;
    for (const item of pending.splice(0)) {
      item.reject(signal.reason ?? new Error("Function admission stopped."));
    }
  };
  if (!signal.aborted) signal.addEventListener("abort", stop, { once: true });
  const release = (): void => {
    const next = pending.shift();
    if (next) next.resolve();
    else active -= 1;
  };
  return {
    async run<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
      if (stopped) throw signal.reason ?? new Error("Function admission stopped.");
      if (active < concurrency) {
        active += 1;
      } else {
        const deferred = Promise.withResolvers<void>();
        pending.push({ resolve: deferred.resolve, reject: deferred.reject });
        await deferred.promise;
        if (stopped) {
          release();
          throw signal.reason ?? new Error("Function admission stopped.");
        }
      }
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

type FunctionEventProgramItem = {
  readonly event: {
    readonly key: WorkflowRunKey;
    readonly payload: RuntimeFunctionEvent;
  };
  readonly events: FunctionEventProgramResource;
};

type FunctionExecutionProgramItem = {
  readonly event: {
    readonly key: WorkflowRunKey;
    readonly payload: FunctionExecutionChanged;
  };
  readonly executions: FunctionExecutionProgramResource;
};

type FunctionIndexProgramItem = {
  readonly event: {
    readonly key: { readonly ownerId: string };
    readonly payload: FunctionIndexChanged;
  };
  readonly index: FunctionIndexProgramResource;
};

type FunctionAdmissionProgramItem = {
  readonly event: {
    readonly key: { readonly ownerId: string };
    readonly payload: FunctionAdmissionChanged;
  };
  readonly admission: FunctionAdmissionProgramResource;
  readonly createIdempotencyKey: (label: string) => string;
};

type FunctionsProgramItems = WorkflowProgramItems & {
  readonly "events.sent": FunctionEventProgramItem;
  readonly "executions.changed": FunctionExecutionProgramItem;
  readonly "index.changed": FunctionIndexProgramItem;
  readonly "admission.changed": FunctionAdmissionProgramItem;
};

type FunctionsProgramContext = Omit<WorkflowProgramContext, "bind" | "resources"> & {
  readonly resources: WorkflowProgramContext["resources"] & {
    readonly events: (key: WorkflowRunKey) => FunctionEventProgramResource;
    readonly executions: (key: WorkflowRunKey) => FunctionExecutionProgramResource;
    readonly index: (key: { readonly ownerId: string }) => FunctionIndexProgramResource;
    readonly admission: (key: { readonly ownerId: string }) => FunctionAdmissionProgramResource;
  };
  readonly bind: FeatureProgramBind<FunctionsProgramItems>;
};

function functionMatchesTrigger(
  configuration: RegisteredFunction["configuration"],
  event: RuntimeFunctionEvent,
): boolean {
  const triggers = configuration.triggers;
  if (!triggers) return false;
  const options = Array.isArray(triggers) ? triggers : [triggers];
  return options.some(
    (trigger) =>
      "event" in trigger &&
      functionEventPatternMatches(trigger.event, event.name) &&
      (!trigger.if ||
        evaluateFunctionCondition(
          trigger.if,
          { event },
          `Function ${JSON.stringify(configuration.id)} trigger if`,
        )),
  );
}

type FunctionEventTriggerRegistration = readonly [string, RegisteredFunction];

type FunctionEventTriggerNode = {
  readonly children: Map<string, FunctionEventTriggerNode>;
  readonly registrations: Map<string, RegisteredFunction>;
};

type FunctionEventTriggerIndex = {
  readonly exact: ReadonlyMap<string, readonly FunctionEventTriggerRegistration[]>;
  readonly wildcard: FunctionEventTriggerNode;
};

function indexFunctionEventTriggers(
  registrations: ReadonlyMap<string, RegisteredFunction>,
): FunctionEventTriggerIndex {
  const exact = new Map<string, Map<string, RegisteredFunction>>();
  const wildcard: FunctionEventTriggerNode = {
    children: new Map(),
    registrations: new Map(),
  };
  for (const [name, registered] of registrations) {
    const triggers = registered.configuration.triggers;
    const options = triggers ? (Array.isArray(triggers) ? triggers : [triggers]) : [];
    for (const trigger of options) {
      if (!("event" in trigger)) continue;
      if (!trigger.event.endsWith("*")) {
        const byFunction = exact.get(trigger.event) ?? new Map<string, RegisteredFunction>();
        byFunction.set(name, registered);
        exact.set(trigger.event, byFunction);
        continue;
      }
      let node = wildcard;
      for (const character of trigger.event.slice(0, -1)) {
        let child = node.children.get(character);
        if (!child) {
          child = { children: new Map(), registrations: new Map() };
          node.children.set(character, child);
        }
        node = child;
      }
      node.registrations.set(name, registered);
    }
  }
  return {
    exact: new Map([...exact].map(([event, byFunction]) => [event, [...byFunction]] as const)),
    wildcard,
  };
}

function functionsTriggeredByEvent(
  index: FunctionEventTriggerIndex,
  event: string,
): readonly FunctionEventTriggerRegistration[] {
  const found = new Map(index.exact.get(event) ?? []);
  let node: FunctionEventTriggerNode | undefined = index.wildcard;
  for (const [name, registered] of node.registrations) found.set(name, registered);
  for (const character of event) {
    node = node.children.get(character);
    if (!node) break;
    for (const [name, registered] of node.registrations) found.set(name, registered);
  }
  return [...found];
}

type FunctionCancellationRule = {
  readonly id: string;
  readonly functionId: string;
  readonly cancellation: NonNullable<RegisteredFunction["configuration"]["cancelOn"]>[number];
};

type FunctionCancellationIndex = {
  readonly exact: ReadonlyMap<string, readonly FunctionCancellationRule[]>;
  readonly wildcard: readonly FunctionCancellationRule[];
  readonly byFunction: ReadonlyMap<string, readonly FunctionCancellationRule[]>;
};

function indexFunctionCancellations(
  registrations: ReadonlyMap<string, RegisteredFunction>,
): FunctionCancellationIndex {
  const exact = new Map<string, FunctionCancellationRule[]>();
  const wildcard: FunctionCancellationRule[] = [];
  const byFunction = new Map<string, FunctionCancellationRule[]>();
  for (const [functionId, registered] of registrations) {
    registered.configuration.cancelOn?.forEach((cancellation, index) => {
      const rule = {
        id: JSON.stringify([functionId, index]),
        functionId,
        cancellation,
      } satisfies FunctionCancellationRule;
      const rules = byFunction.get(functionId) ?? [];
      rules.push(rule);
      byFunction.set(functionId, rules);
      if (cancellation.event.endsWith("*")) wildcard.push(rule);
      else {
        const matching = exact.get(cancellation.event) ?? [];
        matching.push(rule);
        exact.set(cancellation.event, matching);
      }
    });
  }
  return { exact, wildcard, byFunction };
}

function functionCancellationRulesForEvent(
  index: FunctionCancellationIndex,
  event: string,
): readonly FunctionCancellationRule[] {
  return [
    ...(index.exact.get(event) ?? []),
    ...index.wildcard.filter(({ cancellation }) =>
      functionEventPatternMatches(cancellation.event, event),
    ),
  ];
}

function canonicalFunctionIndexValue(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalFunctionIndexValue).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalFunctionIndexValue(value[key])}`)
    .join(",")}}`;
}

function functionCancellationCorrelation(rule: FunctionCancellationRule, event: JsonValue): string {
  return rule.cancellation.match
    ? canonicalFunctionIndexValue(pathValue(event, rule.cancellation.match))
    : "*";
}

function functionCancellationRegistrations(
  index: FunctionCancellationIndex,
  functionId: string,
  input: JsonValue,
): readonly FunctionCancellationRegistration[] {
  return (index.byFunction.get(functionId) ?? []).map((rule) => ({
    rule: rule.id,
    correlation: functionCancellationCorrelation(rule, input),
  }));
}

function functionCancellationCandidates(
  index: FunctionIndexProgramResource,
  cancellations: FunctionCancellationIndex,
  event: RuntimeFunctionEvent,
): readonly string[] {
  const candidates = new Set<string>();
  for (const rule of functionCancellationRulesForEvent(cancellations, event.name)) {
    const bucket =
      index.cancellations[
        functionCancellationBucket({
          rule: rule.id,
          correlation: functionCancellationCorrelation(rule, event),
        })
      ];
    for (const runId of Object.keys(bucket ?? {})) candidates.add(runId);
  }
  return [...candidates];
}

function functionMatchesCancellation(
  configuration: RegisteredFunction["configuration"],
  run: RuntimeWorkflowRun,
  event: RuntimeFunctionEvent,
  now: number,
): boolean {
  return (configuration.cancelOn ?? []).some((cancellation) => {
    if (!functionEventPatternMatches(cancellation.event, event.name)) return false;
    if (
      cancellation.timeout !== undefined &&
      now > cancellationDeadline(cancellation.timeout, run.startedAt, configuration.id)
    ) {
      return false;
    }
    if (
      cancellation.match &&
      canonicalFunctionIndexValue(pathValue(run.input, cancellation.match)) !==
        canonicalFunctionIndexValue(pathValue(event, cancellation.match))
    ) {
      return false;
    }
    return cancellation.if
      ? evaluateFunctionCondition(
          cancellation.if,
          { event: run.input, async: event },
          `Function ${JSON.stringify(configuration.id)} cancellation if`,
        )
      : true;
  });
}

function indexesFunction(event: RuntimeWorkflowEvent): boolean {
  return (
    event.payload.type === "started" ||
    event.payload.type === "rejected" ||
    event.payload.type === "completed" ||
    event.payload.type === "failed" ||
    event.payload.type === "cancelled"
  );
}

function projectsFunctionExecution(event: RuntimeWorkflowEvent): boolean {
  return (
    indexesFunction(event) ||
    event.payload.type === "continued" ||
    event.payload.type === "executionRetryScheduled" ||
    event.payload.type === "executionRetryStarted"
  );
}

function functionExecution(run: RuntimeWorkflowRun): RuntimeFunctionExecution {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    input: run.input,
    startedAt: run.startedAt,
    ...(run.version === undefined ? {} : { version: run.version }),
    generation: run.generation,
    transitionCount: run.transitionCount,
    attempt: run.attempt,
    ...(run.output === undefined ? {} : { output: run.output }),
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.retryAt === undefined ? {} : { retryAt: run.retryAt }),
    ...(run.lastError === undefined ? {} : { lastError: run.lastError }),
    ...(run.parent === undefined ? {} : { parent: run.parent }),
  };
}

function indexesFunctionSignal(event: RuntimeWorkflowEvent): boolean {
  const transition = event.payload;
  return (
    (transition.type === "operationScheduled" &&
      transition.operation.kind === "signal" &&
      transition.operation.signalScope === "owner") ||
    ((transition.type === "operationSucceeded" || transition.type === "operationFailed") &&
      transition.kind === "signal") ||
    transition.type === "raceSettled" ||
    transition.type === "continued" ||
    transition.type === "completed" ||
    transition.type === "failed" ||
    transition.type === "cancelled" ||
    transition.type === "rejected"
  );
}

function indexesFunctionEventWait(event: RuntimeWorkflowEvent): boolean {
  const transition = event.payload;
  return (
    (transition.type === "operationScheduled" &&
      transition.operation.kind === "signal" &&
      transition.operation.signalScope !== "owner") ||
    ((transition.type === "operationSucceeded" || transition.type === "operationFailed") &&
      transition.kind === "signal") ||
    transition.type === "raceSettled" ||
    transition.type === "continued" ||
    transition.type === "completed" ||
    transition.type === "failed" ||
    transition.type === "cancelled" ||
    transition.type === "rejected"
  );
}

function functionEventWaitRegistrations(
  runId: string,
  run: RuntimeWorkflowRun | null,
): readonly FunctionEventWaitRegistration[] {
  if (run?.status !== "running") return [];
  return Object.values(run.operations)
    .filter(
      (operation): operation is WorkflowOperation & { readonly signal: string } =>
        operation.kind === "signal" &&
        operation.status === "scheduled" &&
        operation.signalScope !== "owner" &&
        operation.signal !== undefined,
    )
    .map((operation) => ({ event: operation.signal, runId, operationId: operation.id }))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
}

function failsFunction(event: RuntimeWorkflowEvent): boolean {
  return event.payload.type === "failed";
}

function pathValue(value: JsonValue, path: string): JsonValue | undefined {
  const segments = path.split(".").filter(Boolean);
  let current: JsonValue | undefined = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function eventMatchesWait(
  run: RuntimeWorkflowRun,
  operation: WorkflowOperation,
  event: RuntimeFunctionEvent,
): boolean {
  if (operation.kind !== "signal" || operation.status !== "scheduled") return false;
  if (operation.signalScope === "owner") return false;
  if (operation.signal !== event.name) return false;
  if (
    operation.match &&
    canonicalFunctionIndexValue(pathValue(run.input, operation.match)) !==
      canonicalFunctionIndexValue(pathValue(event, operation.match))
  ) {
    return false;
  }
  return operation.condition
    ? evaluateFunctionCondition(
        operation.condition,
        { event, async: run.input },
        `Function wait ${JSON.stringify(operation.id)} if`,
      )
    : true;
}

function runFunctionsRuntime(define: ErasedDefineFunctions, appVersion?: string) {
  return async (
    context: FunctionsProgramContext,
    dependencies: FunctionFeatureDependencies<FunctionsContract>,
  ) => {
    const registrations = registerFunctionsErased(define, dependencies);
    const definition = createFunctionProgramDefinition(registrations, appVersion);
    const registrationsByEvent = indexFunctionEventTriggers(registrations);
    const cancellationsByEvent = indexFunctionCancellations(registrations);
    const clock = dependencies.clock ?? defaultClock;
    const scheduler = context.resources.scheduler({ id: "workflows" });
    const admission = context.resources.admission(functionAdmissionResourceKey);
    const functionIndex = context.resources.index({ ownerId: context.actor.id });
    let admissionReady: Promise<void> | undefined;
    const openAdmission = (): Promise<void> =>
      (admissionReady ??= openFunctionAdmission(admission));
    const admissionCommands = createFunctionAdmissionCommandGate(context.signal);
    const scheduleFunctionCron = async (
      functionId: string,
      index: number,
      trigger: FunctionCronTrigger,
      after: number,
    ): Promise<void> => {
      const label = `Function ${JSON.stringify(functionId)} cron`;
      const scheduledAt = nextFunctionCron(trigger.cron, after, label);
      const jitterMs =
        trigger.jitter === undefined ? 0 : durationMs(trigger.jitter, `${label} jitter`);
      const wakeAt =
        scheduledAt +
        (jitterMs === 0
          ? 0
          : functionCronJitter(`${functionId}:${index}:${scheduledAt}`, jitterMs));
      const id = `cron:${functionId}:${index}`;
      const receipt = await scheduler.schedule.identified(`cron:${id}:${scheduledAt}`, {
        id,
        key: { ownerId: context.actor.id, id: `$${id}` },
        kind: "cron",
        wakeAt,
        functionId,
        cron: trigger.cron,
        jitterMs,
        scheduledAt,
      });
      if (!receipt.ok && receipt.error !== "unchanged") {
        throw new Error(`Function cron scheduling failed: ${receipt.error}.`);
      }
    };
    const initializeFunctionCrons = async (): Promise<void> => {
      const opened = await scheduler.open({});
      if (!opened.ok && opened.error !== "ready") {
        throw new Error(`Function cron scheduler failed to open: ${opened.error}.`);
      }
      for (const [functionId, registered] of registrations) {
        const triggers = registered.configuration.triggers;
        const options = triggers ? (Array.isArray(triggers) ? triggers : [triggers]) : [];
        for (let index = 0; index < options.length; index += 1) {
          const trigger = options[index];
          if (trigger && "cron" in trigger) {
            await scheduleFunctionCron(functionId, index, trigger, clock.now());
          }
        }
      }
    };
    const reconcileFunctionVersions = async (): Promise<void> => {
      await openFunctionIndex(functionIndex);
      for (const id of Object.keys(functionIndex.active)) {
        const runs = context.resources.runs({ ownerId: context.actor.id, id });
        await openWorkflowRun(runs);
        const run = runs.run.run as RuntimeWorkflowRun | null;
        if (!run || isTerminal(run.status) || run.version === appVersion) continue;
        await commit(runs, {
          type: "failed",
          error: workflowVersionMismatch(run, appVersion),
        });
      }
    };
    const runWorkflows = runWorkflowPrograms(definition, {
      async advanceAdmission(_ownerId, wakeAt) {
        const receipt = await admission.change.identified(`admission:${wakeAt}:advance`, {
          type: "advance",
          now: clock.now(),
        });
        if (!receipt.ok && receipt.error !== "unchanged") {
          throw new Error(`Function admission advance failed: ${receipt.error}.`);
        }
      },
      async fireCron(item) {
        if (
          item.functionId === undefined ||
          item.cron === undefined ||
          item.scheduledAt === undefined
        ) {
          throw new Error(`Function cron schedule ${JSON.stringify(item.id)} is incomplete.`);
        }
        const registered = registrations.get(item.functionId);
        if (!registered) return;
        const id = `${item.functionId}:cron:${item.scheduledAt}`;
        const runs = context.resources.runs({ ownerId: item.key.ownerId, id });
        await openWorkflowRun(runs);
        if (!runs.run.run) {
          const event: RuntimeFunctionEvent = {
            id,
            name: "inngest/scheduled.timer",
            data: { cron: item.cron },
            ts: item.wakeAt,
          };
          const receipt = await admission.change.identified(`admission:${id}:cron`, {
            type: "submit",
            ownerId: item.key.ownerId,
            id: functionAdmissionJobId(item.key.ownerId, id),
            runId: id,
            functionId: item.functionId,
            event,
            policy: functionRunAdmissionPolicy(registered.configuration, event),
            now: clock.now(),
          });
          if (!receipt.ok && receipt.error !== "unchanged") {
            throw new Error(`Function cron admission failed: ${receipt.error}.`);
          }
        }
        const triggers = registered.configuration.triggers;
        const options = triggers ? (Array.isArray(triggers) ? triggers : [triggers]) : [];
        const index = Number(item.id.slice(item.id.lastIndexOf(":") + 1));
        const trigger = options[index];
        if (trigger && "cron" in trigger) {
          await scheduleFunctionCron(
            item.functionId,
            index,
            trigger,
            Math.max(item.scheduledAt, clock.now()),
          );
        }
      },
      async admitInvocation(parent, operation) {
        if (!operation.workflow || !operation.runId || operation.input === undefined) return false;
        const registered = registrations.get(operation.workflow);
        if (!registered) return false;
        const event = operation.input as RuntimeFunctionEvent;
        const receipt = await admission.change.identified(`admission:${operation.runId}:invoke`, {
          type: "submit",
          ownerId: parent.ownerId,
          id: functionAdmissionJobId(parent.ownerId, operation.runId),
          runId: operation.runId,
          functionId: operation.workflow,
          event,
          policy: functionInvocationAdmissionPolicy(registered.configuration, event),
          parent: { key: parent, operationId: operation.id },
          now: clock.now(),
        });
        if (!receipt.ok && receipt.error !== "unchanged") {
          throw new Error(`Function invocation admission failed: ${receipt.error}.`);
        }
        return true;
      },
    });
    const send: SendFunctionEvent = async (input, identity, ownerId) => {
      const id = input.id ?? identity;
      const event: RuntimeFunctionEvent = {
        id,
        name: input.name,
        data: input.data,
        ts: input.ts ?? Date.now(),
        ...(input.v === undefined ? {} : { v: input.v }),
        ...(input.meta === undefined ? {} : { meta: normalizeFunctionEventMeta(input.meta) }),
      };
      const resource = context.resources.events({ ownerId, id });
      await resource.send({ event });
      return id;
    };
    const signal: SendFunctionSignal = async (name, data, ownerId) => {
      assertFunctionSignal(name);
      const index = context.resources.index({ ownerId });
      await openFunctionIndex(index);
      const registration = index.signals[name];
      if (!registration) return { runId: undefined };
      const receipt = await index.deliverSignal({ signal: name, data });
      return { runId: receipt.ok ? registration.runId : undefined };
    };
    const functionStepAdmission = (
      ownerId: string,
      runId: string,
      functionId: string,
      event: RuntimeFunctionEvent,
      operationId: string,
      attempt: number,
    ) => {
      const registered = registrations.get(functionId);
      if (!registered) {
        throw new Error(
          `Cannot acquire execution capacity for function ${JSON.stringify(functionId)}.`,
        );
      }
      const prefix = `${JSON.stringify(ownerId)}:$segment:${runId}:${operationId}:`;
      return {
        admission,
        policy: functionExecutionAdmissionPolicy(registered.configuration, event),
        prefix,
        segmentId: `${prefix}${attempt}`,
      };
    };
    const admitStep: AdmitFunctionStep = async (
      ownerId: string,
      runId: string,
      functionId: string,
      event: RuntimeFunctionEvent,
      createdAt: number,
      operationId: string,
      attempt: number,
    ) => {
      const { admission, policy, prefix, segmentId } = functionStepAdmission(
        ownerId,
        runId,
        functionId,
        event,
        operationId,
        attempt,
      );
      if (policy.concurrency.length === 0) return true;
      const receipt = await admissionCommands.run(async () => {
        await openAdmission();
        return admission.change.identified(`admission:${segmentId}:submit`, {
          type: "submitSegment",
          ownerId,
          id: segmentId,
          segmentGroup: prefix,
          runId,
          operationId,
          attempt,
          functionId,
          event,
          policy,
          createdAt,
          now: clock.now(),
        });
      });
      if (!receipt.ok && receipt.error !== "unchanged") {
        throw new Error(`Function execution admission failed: ${receipt.error}.`);
      }
      return admission.active[segmentId] === true;
    };
    const executeStep: ExecuteFunctionStep = async <Result extends JsonValue>(
      ownerId: string,
      runId: string,
      functionId: string,
      event: RuntimeFunctionEvent,
      _createdAt: number,
      operationId: string,
      attempt: number,
      _signal: AbortSignal,
      execute: () => Result | Promise<Result>,
    ) => {
      const { admission, policy, segmentId } = functionStepAdmission(
        ownerId,
        runId,
        functionId,
        event,
        operationId,
        attempt,
      );
      if (policy.concurrency.length === 0) return execute();
      const noFailure = Symbol("no execution failure");
      let failure: unknown | typeof noFailure = noFailure;
      let result: Result | undefined;
      try {
        result = await execute();
      } catch (error) {
        failure = error;
      }

      if (!context.signal.aborted) {
        try {
          const released = await admission.change.identified(`admission:${segmentId}:release`, {
            type: "release",
            runId: segmentId,
            now: clock.now(),
          });
          if (!released.ok && released.error !== "unchanged") {
            throw new Error(`Function execution release failed: ${released.error}.`);
          }
        } catch (error) {
          failure =
            failure === noFailure
              ? error
              : new AggregateError(
                  [failure, error],
                  `Function execution and capacity release both failed.`,
                );
        }
      }
      if (failure !== noFailure) throw failure;
      return result as Result;
    };
    const workflowDependencies = {
      ...dependencies,
      [sendFunctionEvent]: send,
      [sendFunctionSignal]: signal,
      [admitFunctionStep]: admitStep,
      [executeFunctionStep]: executeStep,
      [fetchFunctionRequest]: dependencies.fetch ?? globalThis.fetch,
      [routeFunctionInvocation]: dependencies.routing,
    };
    const synchronizeSignalRegistration = async (
      event: RuntimeWorkflowEvent,
      runs: WorkflowProgramResource,
    ): Promise<void> => {
      const index = context.resources.index({ ownerId: event.key.ownerId });
      const transition = event.payload;
      if (
        transition.type === "operationScheduled" &&
        transition.operation.kind === "signal" &&
        transition.operation.signalScope === "owner"
      ) {
        const operation = transition.operation;
        const current = runs.run.run as RuntimeWorkflowRun | null;
        if (
          current?.status !== "running" ||
          current.operations[operation.id]?.status !== "scheduled"
        ) {
          return;
        }
        const signalName = operation.signal;
        const conflict = operation.signalConflict;
        if (!signalName || !conflict) {
          await commit(runs, {
            type: "operationFailed",
            id: operation.id,
            kind: "signal",
            error: "invalid_signal_registration",
          });
          return;
        }
        const receipt = await index.registerSignal({
          signal: signalName,
          registration: { runId: event.key.id, operationId: operation.id },
          conflict,
        });
        if (!receipt.ok && receipt.error === "conflict") {
          await commit(
            runs,
            {
              type: "operationFailed",
              id: operation.id,
              kind: "signal",
              error: {
                name: "FunctionSignalConflictError",
                message: `Signal ${JSON.stringify(signalName)} already has an active waiter.`,
              },
            },
            `signal:${operation.id}:conflict`,
          );
        } else if (!receipt.ok && receipt.error !== "unchanged") {
          throw new Error(`Function signal registration failed: ${receipt.error}.`);
        }
        return;
      }

      const run = runs.run.run as RuntimeWorkflowRun | null;
      await openFunctionIndex(index);
      for (const [signalName, registration] of Object.entries(index.signals)) {
        if (registration.runId !== event.key.id) continue;
        const operation = run?.operations[registration.operationId];
        if (run?.status === "running" && operation?.status === "scheduled") continue;
        const receipt = await index.releaseSignal({ signal: signalName, registration });
        if (!receipt.ok && receipt.error !== "missing") {
          throw new Error(`Function signal release failed: ${receipt.error}.`);
        }
      }
    };

    await Promise.all([
      runWorkflows(
        context as unknown as WorkflowProgramContext,
        workflowDependencies as WorkflowFeatureDependencies<WorkflowContract>,
      ),
      context.bind({
        id: "functions.index",
        events: ["runs.transitioned"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key.ownerId,
        async run({ event, runs }) {
          if (
            !projectsFunctionExecution(event) &&
            !indexesFunctionSignal(event) &&
            !indexesFunctionEventWait(event)
          ) {
            return;
          }
          const run = runs.run.run as RuntimeWorkflowRun | null;
          if (projectsFunctionExecution(event)) {
            if (!run)
              throw new Error(`Function run ${JSON.stringify(event.key.id)} is unavailable.`);
            const projection = await context.resources
              .executions(event.key)
              .project({ execution: functionExecution(run) });
            if (!projection.ok && projection.error !== "unchanged") {
              throw new Error(`Function execution projection failed: ${projection.error}.`);
            }
          }
          if (indexesFunction(event)) {
            if (!run)
              throw new Error(`Function run ${JSON.stringify(event.key.id)} is unavailable.`);
            const active = event.payload.type === "started";
            const terminal =
              event.payload.type === "completed" ||
              event.payload.type === "failed" ||
              event.payload.type === "cancelled" ||
              event.payload.type === "rejected";
            const registered = registrations.get(run.name);
            await context.resources.index({ ownerId: event.key.ownerId }).index({
              id: event.key.id,
              active,
              cancellations: registered
                ? functionCancellationRegistrations(cancellationsByEvent, run.name, run.input)
                : [],
            });
            if (terminal) {
              const receipt = await admission.change.identified(
                `admission:${event.key.id}:release`,
                {
                  type: "release",
                  runId: functionAdmissionJobId(event.key.ownerId, event.key.id),
                  now: clock.now(),
                },
              );
              if (!receipt.ok && receipt.error !== "unchanged") {
                throw new Error(`Function admission release failed: ${receipt.error}.`);
              }
            }
          }
          if (indexesFunctionEventWait(event)) {
            const receipt = await context.resources
              .index({ ownerId: event.key.ownerId })
              .synchronizeWaits({
                runId: event.key.id,
                waits: functionEventWaitRegistrations(event.key.id, run),
              });
            if (!receipt.ok && receipt.error !== "unchanged") {
              throw new Error(`Function event wait indexing failed: ${receipt.error}.`);
            }
          }
          if (indexesFunctionSignal(event)) await synchronizeSignalRegistration(event, runs);
        },
      }),
      context.bind({
        id: "functions.cancellation",
        events: ["executions.changed"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key,
        async run({ event }) {
          if (event.payload.type !== "cancelRequested") return;
          const runs = context.resources.runs(event.key);
          await openWorkflowRun(runs);
          const receipt = await runs.cancel({ reason: event.payload.reason });
          if (!receipt.ok && receipt.error !== "not_running") {
            throw new Error(`Function cancellation failed: ${receipt.error}.`);
          }
        },
      }),
      context.bind({
        id: "functions.signalDelivery",
        events: ["index.changed"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key.ownerId,
        async run({ event }) {
          const change = event.payload;
          if (change.type !== "signalDelivered") return;
          const runs = context.resources.runs({
            ownerId: event.key.ownerId,
            id: change.registration.runId,
          });
          await openWorkflowRun(runs);
          const run = runs.run.run as RuntimeWorkflowRun | null;
          const operation = run?.operations[change.registration.operationId];
          if (
            run?.status !== "running" ||
            operation?.status !== "scheduled" ||
            operation.signalScope !== "owner" ||
            operation.signal !== change.signal
          ) {
            return;
          }
          await commit(
            runs,
            {
              type: "operationSucceeded",
              id: operation.id,
              kind: "signal",
              result: change.data,
            },
            `signal:${change.signal}:run:${change.registration.runId}:operation:${operation.id}`,
          );
        },
      }),
      context.bind({
        id: "functions.admission",
        events: ["admission.changed"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key.ownerId,
        async run({ event, admission, createIdempotencyKey }) {
          if (!event.payload.notify) return;
          const scheduler = context.resources.scheduler({ id: "workflows" });
          const scheduleId = workflowScheduleId(
            { ownerId: event.key.ownerId, id: "$admission" },
            "$admission",
          );
          const nextWakeAt = admission.nextWakeAt;
          if (nextWakeAt !== null) {
            const receipt = await scheduler.schedule.identified(
              createIdempotencyKey(`schedule:${scheduleId}:${nextWakeAt}`),
              {
                id: scheduleId,
                key: { ownerId: event.key.ownerId, id: "$admission" },
                kind: "admission",
                wakeAt: nextWakeAt,
              },
            );
            if (!receipt.ok && receipt.error !== "unchanged") {
              throw new Error(`Function admission scheduling failed: ${receipt.error}.`);
            }
          } else if (event.payload.previousWakeAt !== null) {
            const receipt = await scheduler.remove.identified(
              createIdempotencyKey(`remove:${scheduleId}:${event.payload.previousWakeAt}`),
              { id: scheduleId, wakeAt: event.payload.previousWakeAt },
            );
            if (!receipt.ok && receipt.error !== "missing") {
              throw new Error(`Function admission schedule removal failed: ${receipt.error}.`);
            }
          }
          for (const action of admission.actions) {
            if (action.type === "grant") {
              const runs = context.resources.runs({ ownerId: action.ownerId, id: action.runId });
              await openWorkflowRun(runs);
              const run = runs.run.run as RuntimeWorkflowRun | null;
              const operation = run?.operations[action.operationId];
              const canAdmit =
                run?.status === "running" &&
                (operation?.status === "scheduled" || operation?.status === "running") &&
                operation.attempt + 1 === action.attempt;
              if (canAdmit && operation.admittedAttempt !== action.attempt) {
                await commit(
                  runs,
                  {
                    type: "operationAdmitted",
                    id: action.operationId,
                    attempt: action.attempt,
                  },
                  `admission:${action.segmentId}:admit`,
                );
              } else if (
                !canAdmit &&
                !(
                  run?.status === "running" &&
                  operation?.status === "running" &&
                  operation.attempt === action.attempt
                )
              ) {
                const released = await admission.change.identified(
                  `admission:${action.segmentId}:orphan:release`,
                  { type: "release", runId: action.segmentId, now: clock.now() },
                );
                if (!released.ok && released.error !== "unchanged") {
                  throw new Error(`Orphaned function execution release failed: ${released.error}.`);
                }
              }
            } else if (action.type === "start") {
              const runs = context.resources.runs({ ownerId: action.ownerId, id: action.runId });
              await openWorkflowRun(runs);
              if (!runs.run.run) {
                const first = action.events[0];
                if (!first) throw new Error("A function admission has no triggering event.");
                await commit(
                  runs,
                  {
                    type: "started",
                    id: action.runId,
                    name: action.functionId,
                    input: { ...first, events: [...action.events] },
                    ...(appVersion === undefined ? {} : { version: appVersion }),
                    ...(action.parent ? { parent: action.parent } : {}),
                  },
                  `admission:${action.id}:start`,
                );
              }
            } else if (action.type === "expire") {
              const runs = context.resources.runs({ ownerId: action.ownerId, id: action.runId });
              await openWorkflowRun(runs);
              if (!runs.run.run) {
                const first = action.events[0];
                if (!first) throw new Error("An expired function admission has no event.");
                await commit(
                  runs,
                  {
                    type: "rejected",
                    id: action.runId,
                    name: action.functionId,
                    input: { ...first, events: [...action.events] },
                    reason: "start_timeout",
                  },
                  `admission:${action.id}:expire`,
                );
                if (action.parent) {
                  await commit(context.resources.runs(action.parent.key), {
                    type: "operationFailed",
                    id: action.parent.operationId,
                    kind: "workflow",
                    error: "start_timeout",
                  });
                }
              }
            } else if (action.type === "reject") {
              const parent = context.resources.runs(action.parent.key);
              await openWorkflowRun(parent);
              const parentRun = parent.run.run as RuntimeWorkflowRun | null;
              const operation = parentRun?.operations[action.parent.operationId];
              if (parentRun?.status === "running" && operation?.status === "scheduled") {
                await commit(parent, {
                  type: "operationFailed",
                  id: action.parent.operationId,
                  kind: "workflow",
                  error: {
                    name: "FunctionSkippedError",
                    message: `Invoked function was skipped by ${action.reason}.`,
                    reason: action.reason,
                  },
                });
              }
            } else {
              const runs = context.resources.runs({ ownerId: action.ownerId, id: action.runId });
              await openWorkflowRun(runs);
              const run = runs.run.run as RuntimeWorkflowRun | null;
              if (run?.status === "running") {
                await commit(
                  runs,
                  { type: "cancelled", reason: "singleton_replaced" },
                  `admission:${action.id}:cancel`,
                );
              }
            }
            const acknowledged = await admission.change.identified(
              `admission:${action.id}:acknowledge`,
              { type: "acknowledge", actionId: action.id, now: clock.now() },
            );
            if (!acknowledged.ok && acknowledged.error !== "unchanged") {
              throw new Error(`Function admission acknowledgement failed: ${acknowledged.error}.`);
            }
          }
        },
      }),
      context.bind({
        id: "functions.failures",
        events: ["runs.transitioned"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key,
        async run({ event, runs }) {
          if (!failsFunction(event)) return;
          if (event.payload.type !== "failed") return;
          const run = runs.run.run as RuntimeWorkflowRun | null;
          if (!run || run.name.startsWith(functionFailurePrefix)) return;
          const registered = registrations.get(run.name);
          if (!registered?.configuration.onFailure) return;
          const id = `${event.key.id}:failure`;
          const failure = context.resources.runs({ ownerId: event.key.ownerId, id });
          await openWorkflowRun(failure);
          if (failure.run.run) return;
          const input = runtimeFunctionEvents(run.input)[0];
          if (!input) return;
          const failed: RuntimeFunctionFailureEvent = {
            id,
            name: "inngest/function.failed",
            data: {
              function_id: run.name,
              run_id: run.id,
              error: run.error ?? null,
              event: input,
            },
            ts: dependencies.clock?.now() ?? Date.now(),
          };
          await commit(failure, {
            type: "started",
            id,
            name: functionFailureName(run.name),
            input: failed,
            ...(appVersion === undefined ? {} : { version: appVersion }),
          });
        },
      }),
      context.bind({
        id: "functions.dispatch",
        events: ["events.sent"],
        startAt: "origin",
        signal: context.signal,
        concurrency: 64,
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key.ownerId,
        async run({ event }) {
          const ownerId = event.key.ownerId;
          const index = context.resources.index({ ownerId });
          await openFunctionIndex(index);
          for (const [name, registered] of functionsTriggeredByEvent(
            registrationsByEvent,
            event.payload.name,
          )) {
            if (!functionMatchesTrigger(registered.configuration, event.payload)) continue;
            const id = `${event.payload.id}:${name}`;
            const receipt = await admission.change.identified(`admission:${id}:submit`, {
              type: "submit",
              ownerId,
              id: functionAdmissionJobId(ownerId, id),
              runId: id,
              functionId: name,
              event: event.payload,
              policy: functionRunAdmissionPolicy(registered.configuration, event.payload),
              now: clock.now(),
            });
            if (!receipt.ok && receipt.error !== "unchanged") {
              throw new Error(`Function admission failed: ${receipt.error}.`);
            }
          }

          for (const id of functionCancellationCandidates(
            index,
            cancellationsByEvent,
            event.payload,
          )) {
            const runs = context.resources.runs({ ownerId, id });
            await openWorkflowRun(runs);
            const run = runs.run.run as RuntimeWorkflowRun | null;
            if (!run || run.status !== "running") continue;
            const registered = registrations.get(run.name);
            if (
              registered &&
              functionMatchesCancellation(
                registered.configuration,
                run,
                event.payload,
                dependencies.clock?.now() ?? Date.now(),
              )
            ) {
              await commit(
                runs,
                { type: "cancelled", reason: `cancelled_by:${event.payload.name}` },
                `cancel:${event.payload.id}`,
              );
            }
          }

          for (const registration of Object.values(index.waits[event.payload.name] ?? {})) {
            const runs = context.resources.runs({ ownerId, id: registration.runId });
            await openWorkflowRun(runs);
            const run = runs.run.run as RuntimeWorkflowRun | null;
            const operation = run?.operations[registration.operationId];
            if (!run || !operation || !eventMatchesWait(run, operation, event.payload)) continue;
            await commit(
              runs,
              {
                type: "operationSucceeded",
                id: operation.id,
                kind: "signal",
                result: event.payload,
                message: {
                  id: event.payload.id,
                  name: event.payload.name,
                  payload: event.payload,
                },
              },
              `wait:${operation.id}:event:${event.payload.id}`,
            );
          }
        },
      }),
      reconcileFunctionVersions(),
      initializeFunctionCrons(),
    ]);
  };
}

function createFunctionsPrograms(define: ErasedDefineFunctions, appVersion?: string) {
  const orchestrate =
    appVersion === undefined ? "workflows.orchestrate" : `workflows.orchestrate:${appVersion}`;
  const bindings = bindProgramHandlers(
    runFunctionsRuntime(define, appVersion) as unknown as Parameters<typeof bindProgramHandlers>[0],
    [
      {
        id: "workflows.scheduler-wake",
        events: ["scheduler.changed"],
        replay: "all",
        key: "resource",
      },
      {
        id: "workflows.control",
        events: ["runs.transitioned"],
        replay: "all",
        key: "resource",
      },
      {
        id: orchestrate,
        events: ["runs.transitioned"],
        replay: "all",
        key: "resource",
      },
      {
        id: "workflows.scheduler",
        events: ["runs.transitioned"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.index",
        events: ["runs.transitioned"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.cancellation",
        events: ["executions.changed"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.signalDelivery",
        events: ["index.changed"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.admission",
        events: ["admission.changed"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.failures",
        events: ["runs.transitioned"],
        replay: "all",
        key: { version: 1 },
      },
      {
        id: "functions.dispatch",
        events: ["events.sent"],
        replay: "all",
        key: { version: 1 },
      },
    ],
  );
  const eventProgram = <Event>(
    id: string,
    events: readonly [string],
    keyBy: "resource" | ((input: { readonly event: Event }) => JsonValue),
  ) => ({
    source: {
      events,
      replay: "all" as const,
      version: 1,
      keyBy,
      ...(keyBy === "resource" ? {} : { keyVersion: 1 }),
    },
    handle: (context: unknown) => bindings.handle(id, context),
  });
  return {
    runScheduler: (context: unknown, dependencies: unknown) =>
      bindings.run(context as Readonly<Record<string, unknown>>, dependencies),
    wakeScheduler: eventProgram("workflows.scheduler-wake", ["scheduler.changed"], "resource"),
    controlRuns: eventProgram("workflows.control", ["runs.transitioned"], "resource"),
    orchestrateRuns: eventProgram(orchestrate, ["runs.transitioned"], "resource"),
    scheduleRuns: eventProgram(
      "workflows.scheduler",
      ["runs.transitioned"],
      ({ event }: { event: RuntimeWorkflowEvent }) =>
        "operation" in event.payload
          ? `${event.key.id}:${event.payload.operation.id}`
          : event.key.id,
    ),
    indexRuns: eventProgram(
      "functions.index",
      ["runs.transitioned"],
      ({ event }: { event: RuntimeWorkflowEvent }) => event.key.ownerId,
    ),
    cancelRuns: eventProgram(
      "functions.cancellation",
      ["executions.changed"],
      ({ event }: { event: FunctionExecutionProgramItem["event"] }) => event.key,
    ),
    deliverSignals: eventProgram(
      "functions.signalDelivery",
      ["index.changed"],
      ({ event }: { event: FunctionIndexProgramItem["event"] }) => event.key.ownerId,
    ),
    admitRuns: eventProgram(
      "functions.admission",
      ["admission.changed"],
      ({ event }: { event: FunctionAdmissionProgramItem["event"] }) => event.key.ownerId,
    ),
    reportFailures: eventProgram(
      "functions.failures",
      ["runs.transitioned"],
      ({ event }: { event: RuntimeWorkflowEvent }) => event.key,
    ),
    dispatchEvents: eventProgram(
      "functions.dispatch",
      ["events.sent"],
      ({ event }: { event: FunctionEventProgramItem["event"] }) => event.key.ownerId,
    ),
  };
}

const functionTestLogger: FunctionLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

function createFunctionTestGroup(step: ErasedFunctionStep): FunctionGroup {
  return {
    async parallel<Result>(
      optionsOrCallback: { readonly mode?: "race" } | (() => Promise<Result>),
      maybeCallback?: () => Promise<Result>,
    ): Promise<Result> {
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      if (!callback) throw new TypeError("group.parallel() requires a callback.");
      return callback();
    },
    experiment(id, options) {
      return runFunctionExperiment(step, id, options);
    },
  };
}

class FunctionTestStepBlockedError extends Error {
  constructor(targetId: string, blockingId: string) {
    super(
      `Function step ${JSON.stringify(targetId)} was not reached because prior step ${JSON.stringify(blockingId)} requires a mock.`,
    );
    this.name = "FunctionTestStepBlockedError";
  }
}

function createFunctionTestMocks(
  steps: readonly FunctionStepMock[] | undefined,
): ReadonlyMap<string, FunctionStepMock> {
  const mocks = new Map<string, FunctionStepMock>();
  for (const mock of steps ?? []) {
    if (!mock.id.trim()) throw new TypeError("A mocked function step id cannot be empty.");
    if (mocks.has(mock.id)) {
      throw new TypeError(`Function step ${JSON.stringify(mock.id)} is mocked more than once.`);
    }
    mocks.set(mock.id, mock);
  }
  return mocks;
}

function matchesFunctionTestSubset(subset: unknown, actual: unknown): boolean {
  if (Array.isArray(subset)) {
    return (
      Array.isArray(actual) &&
      subset.every((value, index) => matchesFunctionTestSubset(value, actual[index]))
    );
  }
  if (typeof subset !== "object" || subset === null) return Object.is(subset, actual);
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(subset).every(([key, value]) =>
    matchesFunctionTestSubset(value, Reflect.get(actual, key)),
  );
}

function memoizeFunctionTestMock(mock: FunctionStepMock): FunctionStepMock {
  let result: Promise<JsonValue | void> | undefined;
  return {
    id: mock.id,
    handler() {
      result ??= Promise.resolve().then(mock.handler);
      return result;
    },
  };
}

export function testFunctions<App extends AppSpec, Contract extends FunctionsContract>(
  feature: FeatureDef<App, FunctionsFeature<Contract>>,
  options: { readonly dependencies: Readonly<FunctionFeatureDependencies<Contract>> },
): FunctionsTest<Contract> {
  const define = functionTestDefinitions.get(feature);
  if (!define) throw new TypeError("testFunctions() requires a createFunctions() result.");
  const registrations = registerFunctionsErased(define, options.dependencies);
  const fetcher = options.dependencies.fetch ?? globalThis.fetch;
  const logger = options.dependencies.logger ?? functionTestLogger;
  const routing = options.dependencies.routing;

  const invokeRemote = (
    runId: string,
    operationId: string,
    invocation: Parameters<ErasedFunctionStep["invoke"]>[1],
  ): JsonValue | Promise<JsonValue> => {
    const appId = invocation.function.appId;
    if (!appId) throw new TypeError("A routed function invocation requires an app id.");
    if (!routing) {
      localFunctionReferenceId(invocation.function);
      throw new Error("Unreachable function routing state.");
    }
    const now = Date.now();
    const timeoutMs =
      invocation.timeout === undefined
        ? undefined
        : timeoutDurationMs(invocation.timeout, now, "Function invocation timeout");
    return routing.invoke(
      {
        appId,
        functionId: invocation.function.functionId ?? invocation.function.id,
        data: invocation.data === undefined ? null : invocation.data,
      },
      {
        attempt: 1,
        idempotencyKey: `function-test:${runId}:${operationId}`,
        signal: new AbortController().signal,
        uncertainAttempts: [],
        ownerId: "test",
        runId,
        operationId,
        ...(timeoutMs === undefined ? {} : { timeoutMs, deadline: now + timeoutMs }),
      },
    );
  };

  const test: FunctionsTest<Contract> = {
    start<Name extends FunctionName<Contract>>(
      name: Name,
      execution: FunctionTestOptions<Contract, Name>,
    ): FunctionTestRun<Contract, Name> {
      const registered = registrations.get(name);
      if (!registered) throw new TypeError(`Unknown function ${JSON.stringify(name)}.`);
      const mocks = new Map<string, FunctionStepMock>();
      for (const mock of createFunctionTestMocks(execution.steps).values()) {
        mocks.set(mock.id, memoizeFunctionTestMock(mock));
      }
      const completed = new Map<string, FunctionTestStep>();
      const runId = execution.runId ?? `test:${name}`;
      const events = execution.events as readonly RuntimeFunctionEvent[];
      let waiting = false;

      const discover = async (): Promise<FunctionTestCheckpoint<Contract, Name>> => {
        const found = new Map<string, FunctionTestStep>();
        let resolveFound!: (
          checkpoint: FunctionTestCheckpoint<Contract, Name, "steps-found">,
        ) => void;
        const foundCheckpoint = new Promise<FunctionTestCheckpoint<Contract, Name, "steps-found">>(
          (resolve) => {
            resolveFound = resolve;
          },
        );
        let resolutionQueued = false;
        const park = <Result>(): Promise<Result> => new Promise<Result>(() => undefined);
        const discoverStep = async <Result extends JsonValue | void>(
          id: FunctionStepOptions,
          kind: FunctionTestStep["kind"],
        ): Promise<Result> => {
          observeFunctionExperimentStep();
          const operationId = functionStepId(id);
          const mock = mocks.get(operationId);
          if (mock) {
            try {
              const result = (await mock.handler()) as Result;
              completed.set(
                operationId,
                result === undefined
                  ? { id: operationId, kind }
                  : { id: operationId, kind, result },
              );
              return result;
            } catch (error) {
              completed.set(operationId, { id: operationId, kind, error });
              throw error;
            }
          }
          found.set(operationId, { id: operationId, kind });
          if (!resolutionQueued) {
            resolutionQueued = true;
            queueMicrotask(() => {
              resolveFound({ type: "steps-found", steps: [...found.values()] });
            });
          }
          return park<Result>();
        };
        const step: ErasedFunctionStep = {
          run(id) {
            return discoverStep(id, "run");
          },
          async fetch(id) {
            const snapshot = await discoverStep<FunctionFetchSnapshot>(id, "fetch");
            return restoreFunctionResponse(snapshot);
          },
          sleep(id) {
            return discoverStep(id, "sleep");
          },
          sleepUntil(id) {
            return discoverStep(id, "sleep");
          },
          async waitForEvent(id) {
            return (await discoverStep(id, "waitForEvent")) as RuntimeFunctionEvent | null;
          },
          async waitForSignal(id) {
            return (await discoverStep(id, "waitForSignal")) as {
              readonly signal: string;
              readonly data: JsonValue;
            } | null;
          },
          invoke(id) {
            return discoverStep(id, "invoke");
          },
          sendEvent(id) {
            return discoverStep<{ ids: string[] }>(id, "sendEvent");
          },
          async sendSignal(id) {
            const result = await discoverStep<JsonValue>(id, "sendSignal");
            return { runId: typeof result === "string" ? result : undefined };
          },
        };
        const terminal: Promise<FunctionTestCheckpoint<Contract, Name>> = Promise.resolve()
          .then(() => validateFunctionEvents(registered.configuration, events))
          .then(() =>
            registered.handler({
              event: events[0]!,
              events,
              step,
              group: createFunctionTestGroup(step),
              runId,
              logger,
              attempt: execution.attempt ?? 0,
              maxAttempts: (registered.configuration.retries ?? 3) + 1,
            }),
          )
          .then(
            (data): FunctionTestCheckpoint<Contract, Name, "function-resolved"> => ({
              type: "function-resolved",
              data: data as FunctionOutput<Contract, Name>,
              steps: [...completed.values()],
            }),
          )
          .catch(
            (error: unknown): FunctionTestCheckpoint<Contract, Name, "function-rejected"> => ({
              type: "function-rejected",
              error,
              steps: [...completed.values()],
            }),
          );
        return Promise.race([foundCheckpoint, terminal]);
      };

      return {
        async waitFor<Type extends FunctionTestCheckpointType>(
          checkpointType: Type,
          subset?: FunctionTestSubset<FunctionTestCheckpoint<Contract, Name, Type>>,
        ): Promise<FunctionTestCheckpoint<Contract, Name, Type>> {
          if (waiting)
            throw new Error("A function test run can wait for only one checkpoint at a time.");
          waiting = true;
          try {
            while (true) {
              const checkpoint = await discover();
              if (
                checkpoint.type === checkpointType &&
                (subset === undefined || matchesFunctionTestSubset(subset, checkpoint))
              ) {
                return checkpoint as FunctionTestCheckpoint<Contract, Name, Type>;
              }
              if (checkpoint.type !== "steps-found") throw checkpoint;

              for (const step of checkpoint.steps) {
                const output = await test.executeStep(name, step.id, {
                  ...execution,
                  steps: [...mocks.values()],
                });
                const ran: FunctionTestCheckpoint<Contract, Name, "step-ran"> = {
                  type: "step-ran",
                  step: output.step,
                };
                completed.set(step.id, output.step);
                if ("error" in output) {
                  mocks.set(step.id, {
                    id: step.id,
                    handler() {
                      throw output.error;
                    },
                  });
                } else {
                  mocks.set(step.id, { id: step.id, handler: () => output.result });
                }
                if (
                  checkpointType === "step-ran" &&
                  (subset === undefined || matchesFunctionTestSubset(subset, ran))
                ) {
                  return ran as FunctionTestCheckpoint<Contract, Name, Type>;
                }
              }
            }
          } finally {
            waiting = false;
          }
        },
      };
    },
    async execute<Name extends FunctionName<Contract>>(
      name: Name,
      execution: {
        readonly events: readonly [
          FunctionTestEvent<Contract, Name>,
          ...FunctionTestEvent<Contract, Name>[],
        ];
        readonly steps?: readonly FunctionStepMock[];
        readonly runId?: string;
        readonly attempt?: number;
      },
    ): Promise<FunctionTestExecution<Contract, Name>> {
      const registered = registrations.get(name);
      if (!registered) throw new TypeError(`Unknown function ${JSON.stringify(name)}.`);
      const mocks = createFunctionTestMocks(execution.steps);
      const steps: FunctionTestStep[] = [];
      const runId = execution.runId ?? `test:${name}`;
      const runStep = async <Result extends JsonValue | void>(
        id: FunctionStepOptions,
        kind: FunctionTestStep["kind"],
        fallback: () => Result | Promise<Result>,
      ): Promise<Result> => {
        observeFunctionExperimentStep();
        const operationId = functionStepId(id);
        try {
          const result = await (mocks.get(operationId)?.handler ?? fallback)();
          steps.push(
            result === undefined ? { id: operationId, kind } : { id: operationId, kind, result },
          );
          return result as Result;
        } catch (error) {
          steps.push({ id: operationId, kind, error });
          throw error;
        }
      };
      const runVoidStep = async (
        id: FunctionStepOptions,
        fallback: () => void | Promise<void>,
      ): Promise<void> => {
        observeFunctionExperimentStep();
        const operationId = functionStepId(id);
        try {
          const mock = mocks.get(operationId);
          if (mock) await mock.handler();
          else await fallback();
          steps.push({ id: operationId, kind: "sleep" });
        } catch (error) {
          steps.push({ id: operationId, kind: "sleep", error });
          throw error;
        }
      };
      const step: ErasedFunctionStep = {
        run(id, handler, ...input) {
          return runStep(id, "run", () => handler(...input));
        },
        async fetch(id, input, init) {
          const snapshot = await runStep(id, "fetch", () =>
            fetchFunctionResponse(fetcher, new Request(input, init), new AbortController().signal),
          );
          return restoreFunctionResponse(snapshot);
        },
        sleep(id) {
          return runVoidStep(id, () => undefined);
        },
        sleepUntil(id) {
          return runVoidStep(id, () => undefined);
        },
        async waitForEvent(id) {
          return (await runStep(id, "waitForEvent", () => null)) as RuntimeFunctionEvent | null;
        },
        async waitForSignal(id) {
          return (await runStep(id, "waitForSignal", () => null)) as {
            readonly signal: string;
            readonly data: JsonValue;
          } | null;
        },
        invoke(id, options) {
          return runStep(id, "invoke", () => {
            if (options.function.appId) {
              return invokeRemote(runId, functionStepId(id), options);
            }
            throw new Error(
              `Direct function execution requires a mock for invoked step ${JSON.stringify(functionStepId(id))}.`,
            );
          });
        },
        sendEvent(id, input) {
          return runStep(id, "sendEvent", () => {
            const events = Array.isArray(input) ? input : [input];
            return {
              ids: events.map(
                (event, index) => event.id ?? `${runId}:${functionStepId(id)}:${index}`,
              ),
            };
          });
        },
        async sendSignal(id) {
          const runId = await runStep(id, "sendSignal", () => null);
          return { runId: typeof runId === "string" ? runId : undefined };
        },
      };
      const events = execution.events as readonly RuntimeFunctionEvent[];
      try {
        await validateFunctionEvents(registered.configuration, events);
        const result = await registered.handler({
          event: events[0]!,
          events,
          step,
          group: createFunctionTestGroup(step),
          runId,
          logger,
          attempt: execution.attempt ?? 0,
          maxAttempts: (registered.configuration.retries ?? 3) + 1,
        });
        return { result: result as FunctionOutput<Contract, Name>, steps };
      } catch (error) {
        return { error, steps };
      }
    },
    async executeStep<Name extends FunctionName<Contract>>(
      name: Name,
      stepId: string,
      execution: {
        readonly events: readonly [
          FunctionTestEvent<Contract, Name>,
          ...FunctionTestEvent<Contract, Name>[],
        ];
        readonly steps?: readonly FunctionStepMock[];
        readonly runId?: string;
        readonly attempt?: number;
      },
    ): Promise<FunctionTestStepExecution> {
      const registered = registrations.get(name);
      if (!registered) throw new TypeError(`Unknown function ${JSON.stringify(name)}.`);
      if (!stepId.trim()) throw new TypeError("A target function step id cannot be empty.");
      const mocks = createFunctionTestMocks(execution.steps);
      const runId = execution.runId ?? `test:${name}`;
      let resolveTarget!: (value: FunctionTestStepExecution) => void;
      let rejectTarget!: (reason: unknown) => void;
      const target = new Promise<FunctionTestStepExecution>((resolve, reject) => {
        resolveTarget = resolve;
        rejectTarget = reject;
      });
      let targetReached = false;
      const park = <Result>(result: FunctionTestStepExecution): Promise<Result> => {
        resolveTarget(result);
        return new Promise<Result>(() => undefined);
      };
      const block = <Result>(blockingId: string): Promise<Result> => {
        const error = new FunctionTestStepBlockedError(stepId, blockingId);
        queueMicrotask(() => {
          if (!targetReached) rejectTarget(error);
        });
        return new Promise<Result>(() => undefined);
      };

      const executeValueStep = async <Result extends JsonValue | void>(
        id: FunctionStepOptions,
        kind: FunctionTestStep["kind"],
        runnable: boolean,
        handler: () => Result | Promise<Result>,
      ): Promise<Result> => {
        observeFunctionExperimentStep();
        const operationId = functionStepId(id);
        const mock = mocks.get(operationId);
        if (operationId !== stepId) {
          if (!mock) return block(operationId);
          return (await mock.handler()) as Result;
        }
        targetReached = true;
        if (!runnable && !mock) {
          return park({
            result: undefined,
            step: { id: operationId, kind },
          });
        }

        let result: Result;
        try {
          result = (await (mock?.handler ?? handler)()) as Result;
        } catch (error) {
          return park({
            error,
            step: { id: operationId, kind, error },
          });
        }
        return park({
          result: result === undefined ? undefined : result,
          step:
            result === undefined ? { id: operationId, kind } : { id: operationId, kind, result },
        });
      };

      const executeVoidStep = async (id: FunctionStepOptions): Promise<void> => {
        observeFunctionExperimentStep();
        const operationId = functionStepId(id);
        const mock = mocks.get(operationId);
        if (operationId !== stepId) {
          if (!mock) return block(operationId);
          await mock.handler();
          return;
        }
        targetReached = true;

        if (mock) {
          try {
            await mock.handler();
          } catch (error) {
            return park({
              error,
              step: { id: operationId, kind: "sleep", error },
            });
          }
        }
        return park({
          result: undefined,
          step: { id: operationId, kind: "sleep" },
        });
      };

      const step: ErasedFunctionStep = {
        run(id, handler, ...input) {
          return executeValueStep(id, "run", true, () => handler(...input));
        },
        async fetch(id, input, init) {
          const snapshot = await executeValueStep(id, "fetch", true, () =>
            fetchFunctionResponse(fetcher, new Request(input, init), new AbortController().signal),
          );
          return restoreFunctionResponse(snapshot);
        },
        sleep(id) {
          return executeVoidStep(id);
        },
        sleepUntil(id) {
          return executeVoidStep(id);
        },
        async waitForEvent(id) {
          return (await executeValueStep(
            id,
            "waitForEvent",
            false,
            () => null,
          )) as RuntimeFunctionEvent | null;
        },
        async waitForSignal(id) {
          return (await executeValueStep(id, "waitForSignal", false, () => null)) as {
            readonly signal: string;
            readonly data: JsonValue;
          } | null;
        },
        invoke(id, options) {
          return executeValueStep(id, "invoke", false, () => {
            if (options.function.appId) {
              return invokeRemote(runId, functionStepId(id), options);
            }
            throw new Error("An invoked function cannot run in direct step testing.");
          });
        },
        sendEvent(id, input) {
          return executeValueStep(id, "sendEvent", true, () => {
            const events = Array.isArray(input) ? input : [input];
            return {
              ids: events.map(
                (event, index) => event.id ?? `${runId}:${functionStepId(id)}:${index}`,
              ),
            };
          });
        },
        async sendSignal(id) {
          const runId = await executeValueStep(id, "sendSignal", true, () => null);
          return { runId: typeof runId === "string" ? runId : undefined };
        },
      };
      const events = execution.events as readonly RuntimeFunctionEvent[];
      const handler = Promise.resolve()
        .then(() => validateFunctionEvents(registered.configuration, events))
        .then(() =>
          registered.handler({
            event: events[0]!,
            events,
            step,
            group: createFunctionTestGroup(step),
            runId,
            logger,
            attempt: execution.attempt ?? 0,
            maxAttempts: (registered.configuration.retries ?? 3) + 1,
          }),
        )
        .then<FunctionTestStepExecution>(
          () => {
            throw new Error(
              `Function step ${JSON.stringify(stepId)} was not reached by function ${JSON.stringify(name)}.`,
            );
          },
          (error: unknown) => {
            throw new Error(
              `Function step ${JSON.stringify(stepId)} was not reached because function ${JSON.stringify(name)} failed first.`,
              { cause: error },
            );
          },
        );
      return Promise.race([target, handler]);
    },
  };
  return test;
}

export function createFunctions<App extends AppSpec, Contract extends FunctionsContract>(
  options: CreateFunctionsOptions<App, Contract>,
  define: DefineFunctions<Contract>,
): FeatureDef<App, FunctionsFeature<Contract>> {
  const runtime = createFunctionsRuntime<App, Contract>({ appVersion: options.appVersion });
  if (typeof __POGGERS_BROWSER__ !== "undefined" && __POGGERS_BROWSER__) {
    return runtime as unknown as FeatureDef<App, FunctionsFeature<Contract>>;
  }
  registerFunctionsErased(define as unknown as ErasedDefineFunctions, {});
  const feature: FeatureDef<App, FunctionsFeature<Contract>> = {
    ...runtime,
    dependencies: { server: options.dependencies },
    programs: {
      server: createFunctionsPrograms(
        define as unknown as ErasedDefineFunctions,
        options.appVersion,
      ) as unknown as NonNullable<
        FeatureDef<App, FunctionsFeature<Contract>>["programs"]
      >["server"],
    },
  };
  functionTestDefinitions.set(feature, define as unknown as ErasedDefineFunctions);
  return feature;
}
