import { dataKind } from "@/core/data";
import {
  DependencyFailureError,
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyCancellation,
  type DependencyContract,
  type DependencyImplementations,
  type DependencyReference,
} from "@/core/dependency";
import { createFeature, type Feature, type FeatureContractOf } from "@/core/feature";
import { typeKeys, typeLiteral, type TypeSchema } from "@/core/intrinsic";
import {
  claimActorOutbound,
  completeActorOutbound,
  createActorFactory,
  heartbeatActorOutbound,
  listActorKeys,
  type Actor,
  type ActorOutboundDelivery,
  type DefinedActor,
} from "@/features/actor";
import {
  advanceWorkflowExecutable,
  executeWorkflowExecutableProcedure,
  replayWorkflowExecutable,
  transferWorkflowExecutable,
} from "@/features/workflow/executor";
import type { Calendar, CalendarPattern, Clock, ServerProcess, Timer } from "@/platforms/server";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
type WorkflowVisibilityValue = string | number | boolean | null;
type RuntimeDependencyInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  deadline?: number;
  cancellation: DependencyCancellation;
}>;
declare const workflowAction: unique symbol;
declare const workflowDefinition: unique symbol;
declare const workflowReferenceDefinition: unique symbol;
declare const workflowRegistryDefinition: unique symbol;
declare const workflowCompiledArtifact: unique symbol;
declare const workflowDynamicDefinition: unique symbol;

export type WorkflowActionDefinition = Readonly<{
  Input: object | undefined;
  Result: object;
  Failures: Readonly<Record<string, object>>;
  readonly [workflowAction]?: never;
}>;

type WorkflowModelInput = Readonly<{
  Name: string;
  Id: string;
  Input: object | undefined;
  State: object;
  Result: object;
  Revision?: number;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
  Actions?: Readonly<Record<string, WorkflowActionDefinition>>;
  Failures?: Readonly<Record<string, object>>;
  Visibility?: Readonly<Record<string, true>>;
}>;

export type WorkflowModelDefinition = Readonly<{
  Name: string;
  Id: string;
  Input: object | undefined;
  State: object;
  Result: object;
  Revision: number;
  Dependencies: Readonly<Record<string, DependencyContract>>;
  Actions: Readonly<Record<string, WorkflowActionDefinition>>;
  Failures: Readonly<Record<string, object>>;
  Visibility: Readonly<Record<string, true>>;
}>;

type WorkflowVisibilitySelection<
  State extends object,
  Selection extends Readonly<Record<string, true>>,
> = Readonly<{
  [Name in keyof Selection]: Name extends keyof State
    ? [Exclude<State[Name], undefined>] extends [never]
      ? never
      : Exclude<State[Name], undefined> extends WorkflowVisibilityValue
        ? true
        : never
    : never;
}>;

type WorkflowVisibilityOf<Model extends WorkflowModelInput> = Model extends {
  Visibility: infer Visibility extends Readonly<Record<string, true>>;
}
  ? Visibility
  : Empty;

type InvalidWorkflowVisibility<
  State extends object,
  Selection extends Readonly<Record<string, true>>,
> = {
  [Name in keyof Selection]: Name extends keyof State
    ? [Exclude<State[Name], undefined>] extends [never]
      ? Name
      : Exclude<State[Name], undefined> extends WorkflowVisibilityValue
        ? never
        : Name
    : Name;
}[keyof Selection];

/** The complete semantic model of one durable Workflow kind. */
export type Workflow<Model extends WorkflowModelInput> =
  InvalidWorkflowVisibility<Model["State"], WorkflowVisibilityOf<Model>> extends never
    ? Readonly<
        Omit<Model, "Actions" | "Dependencies" | "Failures" | "Revision" | "Visibility"> & {
          Revision: Model extends { Revision: infer Revision extends number } ? Revision : 1;
          Actions: Model extends {
            Actions: infer Actions extends Readonly<Record<string, WorkflowActionDefinition>>;
          }
            ? Actions
            : Empty;
          Dependencies: Model extends {
            Dependencies: infer Dependencies extends Readonly<Record<string, DependencyContract>>;
          }
            ? Dependencies
            : Empty;
          Failures: Model extends {
            Failures: infer Failures extends Readonly<Record<string, object>>;
          }
            ? Failures
            : Empty;
          Visibility: WorkflowVisibilitySelection<Model["State"], WorkflowVisibilityOf<Model>>;
        }
      >
    : never;

type FailureOf<Failures extends Readonly<Record<string, object>>> = {
  readonly [Name in keyof Failures]: Readonly<{
    type: Name;
    data: Failures[Name];
  }>;
}[keyof Failures];

export type WorkflowOutcome<Result, Failure = never> =
  | Readonly<{ status: "succeeded"; value: Result }>
  | Readonly<{ status: "failed"; failure: Failure }>;

export type WorkflowInvocation = Readonly<{ id: string }>;
export type WorkflowStartPolicy = Readonly<{
  conflict?: "reject" | "use" | "terminate";
  reuse?: "reject" | "failed" | "allow";
}>;
export type WorkflowStartResult =
  | Readonly<{ status: "started"; run: number }>
  | Readonly<{ status: "existing"; run: number; lifecycle: WorkflowStatus }>
  | Readonly<{ status: "conflict"; run: number; lifecycle: WorkflowStatus }>;
export type WorkflowEffectOptions = Readonly<{
  idempotencyKey?: string;
  retry?: Readonly<{
    maximumAttempts: number;
    initialDelay?: number;
    backoff?: number;
    maximumDelay?: number;
    nonRetryable?: readonly string[];
  }>;
  timeout?: Readonly<{
    total?: number;
    attempt?: number;
    heartbeat?: number;
  }>;
  cancellation?: "wait" | "request" | "abandon";
}>;
export type WorkflowParentClosePolicy = "terminate" | "cancel" | "abandon";
export type WorkflowChildOptions = WorkflowEffectOptions &
  Readonly<{
    parentClose?: WorkflowParentClosePolicy;
  }>;
export type WorkflowStatus =
  | "idle"
  | "running"
  | "paused"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "terminated";

export type WorkflowExecutionFailure =
  | Readonly<{
      type: "dependency";
      data: Readonly<{
        dependency: string;
        operation: string;
        name: string;
        message: string;
        details?: object;
      }>;
    }>
  | Readonly<{
      type: "nondeterministic";
      data: Readonly<{ reason: string }>;
    }>
  | Readonly<{
      type: "execution";
      data: Readonly<{ name: string; message: string }>;
    }>;

export type WorkflowChange<
  State extends object = object,
  Result extends object = object,
> = Readonly<{
  cursor: number;
  definition: number;
  artifact?: string;
  run: number;
  status: WorkflowStatus;
  pendingEffects: number;
  pendingTimers: number;
  time: number;
  state?: Readonly<State>;
  result?: Readonly<Result>;
  failure?: object;
  children?: readonly Readonly<{
    dependency: string;
    id: string;
    status: "starting" | "running" | "closing" | "closed";
  }>[];
}>;

type ActionInput<Action extends WorkflowActionDefinition> = Action["Input"];
type ActionResult<Action extends WorkflowActionDefinition> = Action["Result"];
type ActionFailure<Action extends WorkflowActionDefinition> = FailureOf<Action["Failures"]>;

type WorkflowStateSnapshot<Model extends WorkflowModelDefinition> =
  | Readonly<{ status: "idle"; revision: number }>
  | Readonly<{
      status: Exclude<WorkflowStatus, "idle">;
      revision: number;
      state: Readonly<Model["State"]>;
    }>;

type WorkflowResultSnapshot<Model extends WorkflowModelDefinition> =
  | Readonly<{
      status: "idle" | "running" | "paused" | "cancelling";
    }>
  | Readonly<{ status: "succeeded"; value: Model["Result"] }>
  | Readonly<{
      status: "failed";
      failure: FailureOf<Model["Failures"]> | WorkflowExecutionFailure;
    }>
  | Readonly<{ status: "cancelled" | "terminated" }>;

export type WorkflowDescription<Model extends WorkflowModelDefinition> = Readonly<{
  id: Model["Id"];
  definition: number;
  artifact?: string;
  run: number;
  status: WorkflowStatus;
  revision: number;
  startedAt?: number;
  closedAt?: number;
  time: number;
  history: Readonly<{
    events: number;
    continueSuggested: boolean;
    retainedRuns: number;
  }>;
}>;

type WorkflowVisibleState<Model extends WorkflowModelDefinition> = Readonly<
  Pick<Model["State"], Extract<keyof Model["Visibility"], keyof Model["State"]>>
>;

type WorkflowVisibilityCondition<Value> = Readonly<{
  exists?: boolean;
  equals?: Exclude<Value, undefined>;
  not?: Exclude<Value, undefined>;
  oneOf?: readonly Exclude<Value, undefined>[];
}> &
  ([Exclude<Value, undefined>] extends [number]
    ? Readonly<{ atLeast?: number; atMost?: number }>
    : Empty);

export type WorkflowVisibilityFilter<Model extends WorkflowModelDefinition> = Readonly<{
  status?: readonly WorkflowStatus[];
  startedAt?: Readonly<{ from?: number; through?: number }>;
  closedAt?: Readonly<{ from?: number; through?: number }>;
  state?: Readonly<{
    [Name in Extract<
      keyof Model["Visibility"],
      keyof Model["State"]
    >]?: WorkflowVisibilityCondition<Model["State"][Name]>;
  }>;
}>;

export type WorkflowListRequest<Model extends WorkflowModelDefinition> = Readonly<{
  after?: number;
  limit?: number;
  where?: WorkflowVisibilityFilter<Model>;
}>;

export type WorkflowListEntry<Model extends WorkflowModelDefinition> = Readonly<{
  workflow: WorkflowDescription<Model>;
  state: WorkflowVisibleState<Model>;
}>;

export type WorkflowListPage<Model extends WorkflowModelDefinition> = Readonly<{
  cursor: number;
  workflows: readonly WorkflowListEntry<Model>[];
  done: boolean;
}>;

export type WorkflowMigrationResult =
  | Readonly<{ status: "current"; artifact: string }>
  | Readonly<{ status: "migrated"; from: string; to: string }>
  | Readonly<{ status: "incompatible"; from: string; to: string; reason: string }>
  | Readonly<{ status: "unavailable"; lifecycle: WorkflowStatus }>;

export type WorkflowScheduleMoment =
  | Readonly<{ every: number; offset?: number }>
  | Readonly<{ calendar: CalendarPattern; timeZone?: string }>
  | Readonly<{ cron: string; timeZone?: string }>;

export type WorkflowScheduleTiming =
  | WorkflowScheduleMoment
  | Readonly<{
      any: readonly WorkflowScheduleMoment[];
      except?: readonly (
        | Readonly<{ calendar: CalendarPattern; timeZone?: string }>
        | Readonly<{ cron: string; timeZone?: string }>
      )[];
    }>;

export type WorkflowScheduleOverlap =
  | "skip"
  | "buffer-one"
  | "buffer-all"
  | "cancel-current"
  | "terminate-current"
  | "concurrent";

export type WorkflowScheduleDefinition<Model extends WorkflowModelDefinition> = Readonly<{
  input: Model["Input"];
  timing: WorkflowScheduleTiming;
  active?: Readonly<{ from?: number; until?: number }>;
  jitter?: number;
  catchUp?: number;
  overlap?: WorkflowScheduleOverlap;
  pauseOnFailure?: boolean;
}>;

export type WorkflowScheduleStatus = "active" | "paused" | "deleted";

export type WorkflowScheduleOccurrence = Readonly<{
  id: string;
  nominal: number;
  at: number;
  source: "schedule" | "trigger" | "backfill";
  overlap?: WorkflowScheduleOverlap;
}>;

export type WorkflowScheduleDescription<Model extends WorkflowModelDefinition> = Readonly<{
  id: string;
  status: WorkflowScheduleStatus;
  revision: number;
  note?: string;
  remaining?: number;
  definition?: WorkflowScheduleDefinition<Model>;
  next?: WorkflowScheduleOccurrence;
  active: readonly Readonly<{
    occurrence: string;
    execution: Model["Id"];
    status: WorkflowStatus;
  }>[];
  buffered: number;
  recent: readonly Readonly<{
    occurrence: WorkflowScheduleOccurrence;
    status: "started" | "skipped" | "failed";
    execution?: Model["Id"];
  }>[];
}>;

export type WorkflowScheduleMutation<Model extends WorkflowModelDefinition> = Readonly<{
  status: "created" | "existing" | "missing" | "updated" | "paused" | "resumed" | "deleted";
  schedule: WorkflowScheduleDescription<Model>;
}>;

export type WorkflowScheduleTriggerResult =
  | Readonly<{ status: "triggered"; occurrence: string }>
  | Readonly<{ status: "missing" }>;

export type WorkflowScheduleBackfillResult =
  | Readonly<{ status: "accepted"; occurrences: number }>
  | Readonly<{ status: "missing"; occurrences: 0 }>;

export type WorkflowScheduleListRequest = Readonly<{
  after?: number;
  limit?: number;
  where?: Readonly<{ status?: readonly WorkflowScheduleStatus[] }>;
}>;

export type WorkflowScheduleListPage<Model extends WorkflowModelDefinition> = Readonly<{
  cursor: number;
  schedules: readonly WorkflowScheduleDescription<Model>[];
  done: boolean;
}>;

export type WorkflowScheduleRun<Model extends WorkflowModelDefinition> = Readonly<{
  occurrence: string;
  workflow: WorkflowDescription<Model>;
  state: WorkflowVisibleState<Model>;
}>;

export type WorkflowScheduleRunPage<Model extends WorkflowModelDefinition> = Readonly<{
  cursor: number;
  runs: readonly WorkflowScheduleRun<Model>[];
  done: boolean;
}>;

type WorkflowRegistryModelInput = Readonly<{
  Name: string;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
}>;

export type WorkflowRegistryModelDefinition = Readonly<{
  Name: string;
  Dependencies: Readonly<Record<string, DependencyContract>>;
}>;

/** The delegated authority boundary for one dynamic Workflow catalogue. */
export type WorkflowRegistry<Model extends WorkflowRegistryModelInput> =
  "workflowCompiler" extends keyof RegistryDependencies<Model>
    ? never
    : Readonly<{
        Name: Model["Name"];
        Dependencies: RegistryDependencies<Model>;
      }>;

type RegistryDependencies<Model extends WorkflowRegistryModelInput> = Model extends {
  Dependencies: infer Dependencies extends Readonly<Record<string, DependencyContract>>;
}
  ? Dependencies
  : Empty;

export type WorkflowSourceDiagnostic = Readonly<{
  message: string;
  file?: string;
  line?: number;
  column?: number;
}>;

/**
 * Opaque validated output of a Workflow source compiler. Product Programs
 * submit source and never construct or inspect executable Workflow IR.
 */
export type WorkflowCompiledArtifact = Readonly<object> & {
  readonly [workflowCompiledArtifact]?: never;
};

export type WorkflowSourceCompilation =
  | Readonly<{ status: "compiled"; artifact: WorkflowCompiledArtifact }>
  | Readonly<{ status: "rejected"; diagnostics: readonly WorkflowSourceDiagnostic[] }>;

/** Replaceable compiler boundary used only when source is created at runtime. */
export type WorkflowSourceCompiler = Dependency<{
  Operations: {
    compile(input: {
      source: string;
      dependencies: Readonly<Record<string, TypeSchema>>;
    }): Promise<WorkflowSourceCompilation>;
  };
}>;

export type WorkflowDefinitionContract = Readonly<{
  input: TypeSchema;
  state: TypeSchema;
  result: TypeSchema;
  failures: TypeSchema;
  actions: Readonly<
    Record<
      string,
      Readonly<{
        input: TypeSchema;
        result: TypeSchema;
        failures: TypeSchema;
      }>
    >
  >;
  dependencies: Readonly<Record<string, TypeSchema>>;
  visibility: readonly string[];
}>;

export type WorkflowDefinitionRevision = Readonly<{
  artifact: string;
  revision: number;
  status: "current" | "superseded" | "retired";
  createdAt: number;
  retiredAt?: number;
}>;

export type WorkflowDefinitionDescription = Readonly<{
  name: string;
  current?: string;
  contract?: WorkflowDefinitionContract;
  revisions: readonly WorkflowDefinitionRevision[];
}>;

export type WorkflowDefinitionListPage = Readonly<{
  cursor: number;
  definitions: readonly WorkflowDefinitionDescription[];
  done: boolean;
}>;

export type WorkflowDefinitionMutation =
  | Readonly<{
      status: "created" | "revised" | "existing";
      definition: WorkflowDefinitionDescription;
    }>
  | Readonly<{
      status: "conflict";
      definition: WorkflowDefinitionDescription;
      reason: string;
    }>
  | Readonly<{
      status: "rejected";
      diagnostics: readonly WorkflowSourceDiagnostic[];
    }>;

export type WorkflowDefinitionRetirement = Readonly<{
  status: "retired" | "existing" | "missing" | "conflict";
  definition: WorkflowDefinitionDescription;
}>;

export type WorkflowDefinitionDeletion = Readonly<{
  status: "deleted" | "missing" | "current";
  definition: WorkflowDefinitionDescription;
}>;

export type DynamicWorkflowState =
  | Readonly<{ status: "idle"; revision: number }>
  | Readonly<{ status: Exclude<WorkflowStatus, "idle">; revision: number; state: object }>;

export type DynamicWorkflowStartResult =
  | WorkflowStartResult
  | Readonly<{ status: "missing-definition"; definition: string }>;

export type DynamicWorkflowResult =
  | Readonly<{ status: "idle" | "running" | "paused" | "cancelling" }>
  | Readonly<{ status: "succeeded"; value: object }>
  | Readonly<{ status: "failed"; failure: object }>
  | Readonly<{ status: "cancelled" | "terminated" }>;

export type DynamicWorkflowDescription = WorkflowDescription<
  WorkflowRegistryExecutionModel<WorkflowRegistryModelDefinition>
>;

export type DynamicWorkflowChange = WorkflowChange<object, object>;

type WorkflowInitialContext<Model extends WorkflowModelDefinition> = Readonly<{
  id: Model["Id"];
  input: Model["Input"];
}>;

type WorkflowFailureContext<Failures extends Readonly<Record<string, object>>> = Readonly<{
  fail(failure: FailureOf<Failures>): never;
}>;

type WorkflowDependencyOperation<Operation> = Operation extends (
  input: infer Input,
  ...rest: readonly unknown[]
) => infer Output
  ? (input: Input, options?: WorkflowEffectOptions) => Output
  : Operation;

type WorkflowDependencyAccess<Dependencies extends Readonly<Record<string, DependencyContract>>> =
  Readonly<{
    [Name in keyof Dependencies]: Dependencies[Name] extends Readonly<{
      readonly [workflowReferenceDefinition]?: infer Model extends WorkflowModelDefinition;
    }>
      ? WorkflowChildReferenceFactory<Model>
      : Pick<Dependencies[Name], Extract<keyof Dependencies[Name], string>> &
          Readonly<{
            [Operation in Extract<keyof Dependencies[Name], string>]: WorkflowDependencyOperation<
              Dependencies[Name][Operation]
            >;
          }>;
  }>;

type WorkflowActionContext<
  Model extends WorkflowModelDefinition,
  Action extends WorkflowActionDefinition,
> = Readonly<{
  id: Model["Id"];
  state: Model["State"];
  input: ActionInput<Action>;
  invocation: Readonly<{ id: string; at: number }>;
}> &
  WorkflowFailureContext<Action["Failures"]>;

type WorkflowRunContext<Model extends WorkflowModelDefinition> = Readonly<{
  id: Model["Id"];
  input: Model["Input"];
  state: Model["State"];
  dependencies: WorkflowDependencyAccess<Model["Dependencies"]>;
  history: Readonly<{
    events: number;
    continueSuggested: boolean;
  }>;
  continueAsNew(input: Model["Input"]): never;
  time: Readonly<{
    now(): number;
    sleep(request: Readonly<{ for: number }> | Readonly<{ until: number }>): Promise<void>;
  }>;
  wait(
    condition: () => boolean,
    timeout?: Readonly<{ for: number }> | Readonly<{ until: number }>,
  ): Promise<boolean>;
  shield(work: () => Promise<void>): Promise<void>;
}> &
  WorkflowFailureContext<Model["Failures"]>;

type WorkflowImplementation<Model extends WorkflowModelDefinition> = Readonly<{
  state(context: WorkflowInitialContext<Model>): Model["State"];
  actions: Readonly<{
    [Name in keyof Model["Actions"]]: (
      context: WorkflowActionContext<Model, Model["Actions"][Name]>,
    ) => ActionResult<Model["Actions"][Name]>;
  }>;
  run(context: WorkflowRunContext<Model>): MaybePromise<Model["Result"]>;
}>;

type ReservedWorkflowOperation =
  | "cancel"
  | "createSchedule"
  | "backfillSchedule"
  | "deleteSchedule"
  | "describe"
  | "describeSchedule"
  | "join"
  | "list"
  | "listScheduleRuns"
  | "listSchedules"
  | "migrate"
  | "observe"
  | "pause"
  | "pauseSchedule"
  | "result"
  | "resume"
  | "resumeSchedule"
  | "start"
  | "state"
  | "terminate"
  | "triggerSchedule"
  | "updateSchedule";

type ValidWorkflowImplementation<Model extends WorkflowModelDefinition> =
  Extract<keyof Model["Actions"], ReservedWorkflowOperation | "then"> extends never
    ? WorkflowImplementation<Model>
    : never;

type WorkflowRegistryExecutionModel<Model extends WorkflowRegistryModelDefinition> = Readonly<{
  Name: Model["Name"];
  Id: string;
  Input: object | undefined;
  State: object;
  Result: object;
  Revision: 1;
  Dependencies: Model["Dependencies"];
  Actions: Empty;
  Failures: Empty;
  Visibility: Empty;
}>;

type WorkflowRuntimeState<Model extends WorkflowModelDefinition> = {
  status: WorkflowStatus;
  definition: number;
  artifact?: object;
  run: number;
  revision: number;
  startedAt?: number;
  closedAt?: number;
  time: number;
  input?: Model["Input"];
  state?: Model["State"];
  execution?: object;
  result?: Model["Result"];
  failure?: FailureOf<Model["Failures"]> | WorkflowExecutionFailure;
  history: WorkflowHistoryEvent<Model>[];
  pendingEffects: number[];
  pendingTimers: number[];
  pendingWaits: number[];
  children: WorkflowChildExecution[];
  pendingChildCloses: string[];
  replay?: WorkflowReplayTrace;
  changes: WorkflowChange<Model["State"], Model["Result"]>[];
  closedRuns: WorkflowClosedRun[];
};

type WorkflowChildExecution = {
  dependency: string;
  id: string;
  sequence: number;
  parentClose: WorkflowParentClosePolicy;
  cancellation: "wait" | "request" | "abandon";
  status: "starting" | "running" | "closing" | "closed";
};

type WorkflowClosedRun = Readonly<{
  definition: number;
  artifact: string;
  run: number;
  status: Exclude<WorkflowStatus, "idle" | "running" | "paused" | "cancelling"> | "continued";
  startedAt: number;
  closedAt: number;
  historyEvents: number;
}>;

type WorkflowRuntimeFactory<Model extends WorkflowModelDefinition> = Readonly<{
  name: Model["Name"];
  revision: Model["Revision"];
  artifact: object;
  advance(execution: object): object;
  transfer(execution: object, transfer: WorkflowFrameTransfer): object;
  interpret(executable: object, execution: object): object;
  interpretTransfer(executable: object, execution: object, transfer: WorkflowFrameTransfer): object;
  interpretProcedure(procedure: object, context: object): object;
  replay(executable: object, trace: object): object;
  state: WorkflowImplementation<Model>["state"];
  actions: WorkflowImplementation<Model>["actions"];
  dependencies: readonly string[];
}>;

type WorkflowRuntimeArtifact = Readonly<{
  id: string;
  definition: Readonly<{
    contract: Readonly<{
      name: string;
      revision: number;
      input: TypeSchema;
      state: TypeSchema;
      result: TypeSchema;
      failures: TypeSchema;
      actions: Readonly<
        Record<
          string,
          Readonly<{
            input: TypeSchema;
            result: TypeSchema;
            failures: TypeSchema;
          }>
        >
      >;
      dependencies: Readonly<Record<string, TypeSchema>>;
      children: readonly string[];
      visibility: readonly string[];
    }>;
    entry: string;
  }>;
  executable: Readonly<{
    revision: number;
    initialization: object;
    actionHandlers: Readonly<Record<string, object>>;
    run: object;
  }>;
}>;

type WorkflowStoredDefinition = {
  source: string;
  artifact: WorkflowRuntimeArtifact;
  createdAt: number;
  retiredAt?: number;
};

type WorkflowDefinitionRuntimeState = {
  current?: string;
  maximumRevision: number;
  revisions: WorkflowStoredDefinition[];
};

type WorkflowData = object | string | number | boolean | null | undefined;

type RuntimeWorkflowSchema = Readonly<{
  kind: string;
  name?: string;
  value?: WorkflowData;
  element?: object;
  elements?: readonly object[];
  variants?: readonly object[];
  fields?: readonly Readonly<{
    name: string;
    optional: boolean;
    type: object;
  }>[];
}>;

type WorkflowSchemaCheck = Readonly<{
  value: WorkflowData;
  schema: object;
}>;

type WorkflowFrameTransfer =
  | Readonly<{ kind: "continue"; next: string }>
  | Readonly<{ kind: "continue-as-new"; input?: WorkflowData }>
  | Readonly<{ kind: "return"; value?: WorkflowData }>
  | Readonly<{ kind: "fail"; failure: object }>
  | Readonly<{
      kind: "cancel";
      cancellation: Readonly<{ at: number; reason?: WorkflowData }>;
    }>;

type WorkflowReplayTrace = {
  initialState: object;
  steps: WorkflowReplayStep[];
};

type WorkflowReplayStep =
  | Readonly<{
      kind: "advance";
      history: Readonly<{ events: number; continueSuggested: boolean }>;
    }>
  | Readonly<{
      kind: "action";
      action: string;
      input?: WorkflowData;
      invocation: Readonly<{ id: string; at: number }>;
      time: number;
      state: object;
      result: WorkflowData;
    }>
  | Readonly<{
      kind: "effect";
      command: object;
      sequence: number;
      at: number;
      outcome:
        | Readonly<{ status: "succeeded"; value?: WorkflowData }>
        | Readonly<{ status: "failed"; failure: object }>;
    }>
  | Readonly<{ kind: "sleep"; command: object; sequence: number; at: number }>
  | Readonly<{ kind: "wait"; command: object; sequence: number; at: number }>
  | Readonly<{
      kind: "cancel-request";
      cancellation: Readonly<{ at: number; reason?: WorkflowData }>;
    }>
  | Readonly<{ kind: "transfer"; pending?: object; transfer: WorkflowFrameTransfer }>;

type WorkflowExecutionFrame = {
  definition: number;
  status: "running" | "suspended" | "continued" | "succeeded" | "failed" | "cancelled";
  identity?: WorkflowData;
  invocation?: WorkflowData;
  input?: WorkflowData;
  history: Readonly<{ events: number; continueSuggested: boolean }>;
  state: object;
  block: string;
  locals: Record<string, WorkflowData>;
  sequence: number;
  time: number;
  scope?: object;
  cancellation?: Readonly<{ at: number; reason?: WorkflowData }>;
  pending?: WorkflowPendingFrame;
  continuedInput?: WorkflowData;
  result?: WorkflowData;
  failure?: object;
};

type WorkflowPendingFrame =
  | {
      kind: "effect";
      sequence: number;
      cancellable: boolean;
      dependency: string;
      operation: string;
      input: WorkflowData;
      options?: WorkflowData;
      result: string;
      next: string;
    }
  | {
      kind: "child";
      sequence: number;
      cancellable: boolean;
      dependency: string;
      operation: string;
      input: WorkflowData;
      options?: WorkflowData;
      result: string;
      next: string;
    }
  | {
      kind: "sleep";
      sequence: number;
      cancellable: boolean;
      at: number;
      next: string;
    }
  | {
      kind: "wait";
      sequence: number;
      cancellable: boolean;
      condition: object;
      until?: number;
      result: string;
      next: string;
    }
  | {
      kind: "concurrent";
      cancellable: boolean;
      operation: "all" | "all-settled" | "race";
      effects: WorkflowConcurrentEffectFrame[];
      result: string;
      next: string;
    };

type WorkflowConcurrentEffectFrame = {
  sequence: number;
  dependency: string;
  operation: string;
  input: WorkflowData;
  options?: WorkflowData;
  status: "pending" | "succeeded" | "failed";
  value?: WorkflowData;
  failure?: object;
};

const workflowHistorySuggestion = 10_000;
const workflowHistoryMaximum = 50_000;
const workflowClosedRunRetention = 64;
const workflowChangeRetention = 1_024;
const workflowVisibilityPageMaximum = 100;

type WorkflowEffectRequest = Readonly<{
  type: "effect-requested";
  sequence: number;
  effect: number;
  dependency: string;
  operation: string;
  input: WorkflowData;
  idempotencyKey: string;
  scheduledAt: number;
  options?: WorkflowEffectOptions;
  child?: Readonly<{
    id: string;
    parentClose: WorkflowParentClosePolicy;
    cancellation: "wait" | "request" | "abandon";
  }>;
}>;

type WorkflowSerializedError = Readonly<{
  name: string;
  message: string;
  details?: object;
  retryDelay?: number;
}>;

type WorkflowHistoryEvent<Model extends WorkflowModelDefinition> =
  | Readonly<{
      type: "action";
      action: string;
      invocation: string;
      state: Model["State"];
    }>
  | Readonly<{
      type: "wait";
      sequence: number;
      at?: number;
    }>
  | Readonly<{
      type: "wait-timed-out";
      sequence: number;
      at: number;
    }>
  | Readonly<{
      type: "timer-requested";
      sequence: number;
      at: number;
    }>
  | Readonly<{
      type: "timer-fired";
      sequence: number;
      at: number;
    }>
  | WorkflowEffectRequest
  | Readonly<{
      type: "effect-attempt-started";
      sequence: number;
      attempt: number;
      at: number;
      until?: number;
    }>
  | Readonly<{
      type: "effect-heartbeat";
      sequence: number;
      attempt: number;
      at: number;
      details: WorkflowData;
    }>
  | Readonly<{
      type: "effect-succeeded";
      sequence: number;
      attempt: number;
      at: number;
      result: WorkflowData;
    }>
  | Readonly<{
      type: "effect-attempt-failed";
      sequence: number;
      attempt: number;
      at: number;
      nextAt: number;
      failure: WorkflowSerializedError;
    }>
  | Readonly<{
      type: "effect-failed";
      sequence: number;
      attempt: number;
      at: number;
      failure: WorkflowSerializedError;
    }>
  | Readonly<{
      type: "effect-cancelled";
      sequence: number;
      attempt: number;
      at: number;
    }>
  | Readonly<{
      type: "cancellation-requested";
      at: number;
    }>
  | Readonly<{
      type: "child-started";
      sequence: number;
      dependency: string;
      id: string;
      at: number;
    }>
  | Readonly<{
      type: "child-close-requested";
      dependency: string;
      id: string;
      operation: "cancel" | "terminate";
      at: number;
    }>
  | Readonly<{
      type: "child-closed";
      dependency: string;
      id: string;
      status: WorkflowStatus;
      at: number;
    }>;

type WorkflowVisibilitySnapshot<Model extends WorkflowModelDefinition> = Readonly<{
  workflow: WorkflowDescription<Model>;
  state?: Model["State"];
}>;

type WorkflowRuntime<Model extends WorkflowModelDefinition> = Actor<{
  Name: `${Model["Name"]}:workflow`;
  Key: Model["Id"];
  State: WorkflowRuntimeState<Model>;
  Dependencies: Model["Dependencies"];
  Methods: {
    $start: Actor.Method<
      Readonly<{
        input: Model["Input"];
        artifact?: object;
        conflict: "reject" | "use" | "terminate";
        reuse: "reject" | "failed" | "allow";
      }>,
      WorkflowStartResult,
      { invalid: Readonly<{ message: string }> }
    >;
    $action: Actor.Method<
      Readonly<{ name: string; input?: object }>,
      Readonly<{ outcome: WorkflowOutcome<object, object> }>,
      {
        unavailable: Readonly<{ status: WorkflowStatus }>;
        invalid: Readonly<{ message: string }>;
      }
    >;
    $advance: Actor.Method<Readonly<{ run: number }>, Readonly<{ status: WorkflowStatus }>>;
    $effect: Actor.Method<
      Readonly<{ run: number; sequence: number }>,
      Readonly<{ status: WorkflowStatus }>
    >;
    $effectDispatch: Actor.Read<
      Readonly<{ run: number; sequence: number; attempt: number; at: number }>,
      WorkflowEffectDispatch
    >;
    $completeEffect: Actor.Method<WorkflowEffectDelivery, Readonly<{ status: WorkflowStatus }>>;
    $completeChildClose: Actor.Method<
      Readonly<{
        request: Readonly<{
          dependency: string;
          id: string;
          wait: boolean;
        }>;
        delivery: Omit<ActorOutboundDelivery, "output"> &
          Readonly<{ output: Readonly<{ status: WorkflowStatus }> }>;
      }>,
      Readonly<{ status: WorkflowStatus }>
    >;
    $heartbeatEffect: Actor.Method<
      Readonly<{
        run: number;
        sequence: number;
        attempt: number;
        at: number;
        details: WorkflowData;
      }>,
      Readonly<{ accepted: boolean }>
    >;
    $timeoutEffect: Actor.Method<
      Readonly<{ run: number; sequence: number; attempt: number }>,
      Readonly<{ status: WorkflowStatus }>
    >;
    $timer: Actor.Method<
      Readonly<{ run: number; sequence: number; at: number }>,
      Readonly<{ status: WorkflowStatus }>
    >;
    $wait: Actor.Method<
      Readonly<{ run: number; sequence: number; at: number }>,
      Readonly<{ status: WorkflowStatus }>
    >;
    $changes: Actor.Read<
      Readonly<{ after: number; limit: number }>,
      Readonly<{
        changes: readonly WorkflowChange<Model["State"], Model["Result"]>[];
      }>
    >;
    $visibility: Actor.Read<undefined, WorkflowVisibilitySnapshot<Model>>;
    state: Actor.Read<undefined, WorkflowStateSnapshot<Model>>;
    describe: Actor.Read<undefined, WorkflowDescription<Model>>;
    result: Actor.Read<undefined, WorkflowResultSnapshot<Model>>;
    migrate: Actor.Method<Readonly<{ artifact?: object }> | undefined, WorkflowMigrationResult>;
    pause: Actor.Method<undefined, Readonly<{ status: WorkflowStatus }>>;
    resume: Actor.Method<undefined, Readonly<{ status: WorkflowStatus }>>;
    cancel: Actor.Method<undefined, Readonly<{ status: WorkflowStatus }>>;
    terminate: Actor.Method<undefined, Readonly<{ status: WorkflowStatus }>>;
  };
}>;

type WorkflowDefinitionRuntime<Model extends WorkflowRegistryModelDefinition> = Actor<{
  Name: `${Model["Name"]}:workflow-definitions`;
  Key: string;
  State: WorkflowDefinitionRuntimeState;
  Dependencies: Empty;
  Methods: {
    create: Actor.Method<
      Readonly<{ source: string; artifact: object }>,
      Exclude<WorkflowDefinitionMutation, Readonly<{ status: "rejected" }>>
    >;
    revise: Actor.Method<
      Readonly<{ source: string; artifact: object; expected?: string }>,
      Exclude<WorkflowDefinitionMutation, Readonly<{ status: "rejected" }>>
    >;
    retire: Actor.Method<Readonly<{ expected?: string }>, WorkflowDefinitionRetirement>;
    delete: Actor.Method<Readonly<{ artifact: string }>, WorkflowDefinitionDeletion>;
    $resolve: Actor.Read<
      Readonly<{ artifact?: string }> | undefined,
      Readonly<{ artifact?: object }>
    >;
    describe: Actor.Read<undefined, WorkflowDefinitionDescription>;
  };
}>;

type WorkflowScheduleExecution<Model extends WorkflowModelDefinition> = {
  occurrence: WorkflowScheduleOccurrence;
  execution: Model["Id"];
  status: WorkflowStatus;
};

type WorkflowScheduleRecent<Model extends WorkflowModelDefinition> = {
  occurrence: WorkflowScheduleOccurrence;
  status: "started" | "skipped" | "failed";
  execution?: Model["Id"];
};

type WorkflowScheduleRuntimeState<Model extends WorkflowModelDefinition> = {
  status: WorkflowScheduleStatus;
  revision: number;
  note?: string;
  remaining?: number;
  definition?: WorkflowScheduleDefinition<Model>;
  next?: WorkflowScheduleOccurrence;
  following?: number;
  pending: WorkflowScheduleOccurrence[];
  active: WorkflowScheduleExecution<Model>[];
  recent: WorkflowScheduleRecent<Model>[];
  inspecting: Model["Id"][];
  closing?: "cancel" | "terminate";
};

type WorkflowScheduleSeed = Readonly<{
  next?: number;
  following?: number;
}>;

type WorkflowScheduleRuntimeDependencies<_Model extends WorkflowModelDefinition> = Empty;

type WorkflowScheduleRuntime<Model extends WorkflowModelDefinition> = Actor<{
  Name: `${Model["Name"]}:workflow-schedule`;
  Key: string;
  State: WorkflowScheduleRuntimeState<Model>;
  Dependencies: WorkflowScheduleRuntimeDependencies<Model>;
  Methods: {
    $create: Actor.Method<
      Readonly<{
        definition: WorkflowScheduleDefinition<Model>;
        seed: WorkflowScheduleSeed;
        paused: boolean;
        trigger: boolean;
        note?: string;
        remaining?: number;
      }>,
      WorkflowScheduleMutation<Model>
    >;
    $update: Actor.Method<
      Readonly<{
        definition: WorkflowScheduleDefinition<Model>;
        seed: WorkflowScheduleSeed;
        note?: string;
        remaining?: number;
      }>,
      WorkflowScheduleMutation<Model>
    >;
    $pause: Actor.Method<Readonly<{ note?: string }>, WorkflowScheduleMutation<Model>>;
    $resume: Actor.Method<
      Readonly<{ seed: WorkflowScheduleSeed; note?: string }>,
      WorkflowScheduleMutation<Model>
    >;
    $trigger: Actor.Method<
      Readonly<{ overlap?: WorkflowScheduleOverlap }>,
      WorkflowScheduleTriggerResult
    >;
    $backfill: Actor.Method<
      Readonly<{
        occurrences: readonly number[];
        overlap?: WorkflowScheduleOverlap;
      }>,
      WorkflowScheduleBackfillResult
    >;
    $delete: Actor.Method<undefined, WorkflowScheduleMutation<Model>>;
    $tick: Actor.Method<
      Readonly<{ occurrence: WorkflowScheduleOccurrence }>,
      WorkflowScheduleDescription<Model>
    >;
    $poll: Actor.Method<undefined, WorkflowScheduleDescription<Model>>;
    $completeCalendar: Actor.Method<
      Readonly<{
        request: Readonly<{ after: number; revision: number }>;
        delivery: Omit<ActorOutboundDelivery, "output"> &
          Readonly<{ output: Readonly<{ seed: WorkflowScheduleSeed }> }>;
      }>,
      WorkflowScheduleDescription<Model>
    >;
    $completeStart: Actor.Method<
      Readonly<{
        request: Readonly<{
          occurrence: WorkflowScheduleOccurrence;
          execution: Model["Id"];
        }>;
        delivery: Omit<ActorOutboundDelivery, "output"> &
          Readonly<{
            output: Actor.Outcome<WorkflowStartResult, object> | Actor.Invocation;
          }>;
      }>,
      WorkflowScheduleDescription<Model>
    >;
    $completeInspect: Actor.Method<
      Readonly<{
        request: Readonly<{ execution: Model["Id"] }>;
        delivery: Omit<ActorOutboundDelivery, "output"> &
          Readonly<{ output: WorkflowDescription<Model> }>;
      }>,
      WorkflowScheduleDescription<Model>
    >;
    $completeClose: Actor.Method<
      Readonly<{
        request: Readonly<{
          execution: Model["Id"];
          operation: "cancel" | "terminate";
        }>;
        delivery: Omit<ActorOutboundDelivery, "output"> &
          Readonly<{
            output: Actor.Outcome<Readonly<{ status: WorkflowStatus }>, object> | Actor.Invocation;
          }>;
      }>,
      WorkflowScheduleDescription<Model>
    >;
    describe: Actor.Read<undefined, WorkflowScheduleDescription<Model>>;
  };
}>;

type WorkflowRuntimeRequirement<Model extends WorkflowModelDefinition> = Readonly<{
  [Name in `${Model["Name"]}:workflow`]: Actor.Reference<WorkflowRuntime<Model>>;
}> &
  Readonly<{
    [Name in `${Model["Name"]}:workflow-schedule`]: Actor.Reference<WorkflowScheduleRuntime<Model>>;
  }> &
  Model["Dependencies"] &
  Readonly<{ calendar: Calendar; clock: Clock; timer: Timer }>;

type WorkflowEffectDispatch =
  | Readonly<{ status: "settled" }>
  | Readonly<{ status: "expired"; failure: WorkflowSerializedError }>
  | Readonly<{
      status: "ready";
      attempt: number;
      deadline?: number;
      previousHeartbeat?: WorkflowData;
      request: WorkflowEffectRequest;
    }>;

type WorkflowEffectOutcome =
  | Readonly<{ status: "succeeded"; value: WorkflowData }>
  | Readonly<{ status: "failed"; failure: WorkflowSerializedError }>;

type WorkflowEffectDelivery = Readonly<{
  request: Readonly<{ run: number; sequence: number; attempt: number }>;
  delivery: Omit<ActorOutboundDelivery, "output"> & Readonly<{ output: WorkflowEffectOutcome }>;
}>;

type StartInput<Model extends WorkflowModelDefinition> = Readonly<{
  input: Model["Input"];
}> &
  WorkflowStartPolicy;

type WorkflowScheduleOperation =
  | "createSchedule"
  | "updateSchedule"
  | "describeSchedule"
  | "pauseSchedule"
  | "resumeSchedule"
  | "triggerSchedule"
  | "backfillSchedule"
  | "deleteSchedule";

type WorkflowScheduleWireRequest<Model extends WorkflowModelDefinition> = Readonly<{
  id: string;
  definition?: WorkflowScheduleDefinition<Model>;
  from?: number;
  through?: number;
  paused?: boolean;
  trigger?: boolean;
  note?: string;
  remaining?: number;
  overlap?: WorkflowScheduleOverlap;
}>;

type WorkflowScheduleOutboundRequest = Readonly<{
  id: string;
  outbound: string;
  generation: number;
  input: object;
  operation?: "cancel" | "terminate";
}>;

type WorkflowWireOperations<Model extends WorkflowModelDefinition> = Readonly<
  {
    start(
      request: Readonly<{ id: Model["Id"]; input: StartInput<Model>; idempotencyKey?: string }>,
    ): Promise<WorkflowStartResult>;
    state(request: Readonly<{ id: Model["Id"] }>): Promise<WorkflowStateSnapshot<Model>>;
    describe(request: Readonly<{ id: Model["Id"] }>): Promise<WorkflowDescription<Model>>;
    result(request: Readonly<{ id: Model["Id"] }>): Promise<WorkflowResultSnapshot<Model>>;
    join(request: Readonly<{ id: Model["Id"] }>): Promise<WorkflowTerminalResultSnapshot<Model>>;
    migrate(
      request: Readonly<{ id: Model["Id"]; idempotencyKey?: string }>,
    ): Promise<WorkflowMigrationResult>;
    observe(
      request: Readonly<{ id: Model["Id"]; input?: Readonly<{ after?: number }> }>,
    ): AsyncIterable<WorkflowChange<Model["State"], Model["Result"]>>;
    pause(
      request: Readonly<{ id: Model["Id"]; idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    resume(
      request: Readonly<{ id: Model["Id"]; idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    cancel(
      request: Readonly<{ id: Model["Id"]; idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    terminate(
      request: Readonly<{ id: Model["Id"]; idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    list(request: WorkflowListRequest<Model>): Promise<WorkflowListPage<Model>>;
    listSchedules(request: WorkflowScheduleListRequest): Promise<WorkflowScheduleListPage<Model>>;
    listScheduleRuns(
      request: WorkflowListRequest<Model> & Readonly<{ id: string }>,
    ): Promise<WorkflowScheduleRunPage<Model>>;
    createSchedule(
      request: Readonly<{
        id: string;
        definition: WorkflowScheduleDefinition<Model>;
        paused?: boolean;
        trigger?: boolean;
        note?: string;
        remaining?: number;
      }>,
    ): Promise<WorkflowScheduleMutation<Model>>;
    updateSchedule(
      request: Readonly<{
        id: string;
        definition: WorkflowScheduleDefinition<Model>;
        note?: string;
        remaining?: number;
      }>,
    ): Promise<WorkflowScheduleMutation<Model>>;
    describeSchedule(
      request: Readonly<{ id: string }>,
    ): Promise<WorkflowScheduleDescription<Model>>;
    pauseSchedule(
      request: Readonly<{ id: string; note?: string }>,
    ): Promise<WorkflowScheduleMutation<Model>>;
    resumeSchedule(
      request: Readonly<{ id: string; note?: string }>,
    ): Promise<WorkflowScheduleMutation<Model>>;
    triggerSchedule(
      request: Readonly<{ id: string; overlap?: WorkflowScheduleOverlap }>,
    ): Promise<WorkflowScheduleTriggerResult>;
    backfillSchedule(
      request: Readonly<{
        id: string;
        from: number;
        through: number;
        overlap?: WorkflowScheduleOverlap;
      }>,
    ): Promise<WorkflowScheduleBackfillResult>;
    deleteSchedule(request: Readonly<{ id: string }>): Promise<WorkflowScheduleMutation<Model>>;
    $scheduleCalendar(
      request: Readonly<{
        id: string;
        outbound: string;
        generation: number;
        input: object;
      }>,
    ): Promise<Readonly<{ completed: boolean }>>;
    $scheduleStart(
      request: Readonly<{
        id: string;
        outbound: string;
        generation: number;
        input: object;
      }>,
    ): Promise<Readonly<{ completed: boolean }>>;
    $scheduleInspect(
      request: Readonly<{
        id: string;
        outbound: string;
        generation: number;
        input: object;
      }>,
    ): Promise<Readonly<{ completed: boolean }>>;
    $scheduleClose(
      request: Readonly<{
        id: string;
        outbound: string;
        generation: number;
        operation: "cancel" | "terminate";
        input: object;
      }>,
    ): Promise<Readonly<{ completed: boolean }>>;
    $effect(
      request: Readonly<{
        id: Model["Id"];
        run: number;
        sequence: number;
        attempt: number;
        outbound: string;
        generation: number;
      }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    $childClose(
      request: Readonly<{
        id: Model["Id"];
        dependency: string;
        child: string;
        operation: "cancel" | "terminate";
        wait: boolean;
        outbound: string;
        generation: number;
      }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    $join(request: Readonly<{ id: Model["Id"] }>): Promise<WorkflowTerminalResultSnapshot<Model>>;
  } & {
    readonly [Name in keyof Model["Actions"]]: (
      request: Readonly<{
        id: Model["Id"];
        input?: ActionInput<Model["Actions"][Name]>;
        wait?: "accepted" | "completed";
        idempotencyKey?: string;
      }>,
    ) => Promise<
      | WorkflowOutcome<ActionResult<Model["Actions"][Name]>, ActionFailure<Model["Actions"][Name]>>
      | WorkflowInvocation
    >;
  }
>;

type WorkflowReferenceProjection<Model extends WorkflowModelDefinition> = Readonly<{
  Name: "get";
  Binding: Readonly<{ id: Model["Id"] }>;
  Inputs: Readonly<
    {
      start: StartInput<Model>;
      state: undefined;
      describe: undefined;
      result: undefined;
      join: undefined;
      migrate: undefined;
      observe: Readonly<{ after?: number }>;
      pause: undefined;
      resume: undefined;
      cancel: undefined;
      terminate: undefined;
    } & {
      readonly [Name in keyof Model["Actions"]]: ActionInput<Model["Actions"][Name]>;
    }
  >;
  Argument: "input";
}>;

type CompletedCallOptions = Readonly<{
  wait?: "completed";
  idempotencyKey?: string;
}>;

type AcceptedCallOptions = Readonly<{
  wait: "accepted";
  idempotencyKey?: string;
}>;

type WorkflowBoundAction<Action extends WorkflowActionDefinition> =
  ActionInput<Action> extends undefined
    ? {
        (
          options?: CompletedCallOptions,
        ): Promise<WorkflowOutcome<ActionResult<Action>, ActionFailure<Action>>>;
        (options: AcceptedCallOptions): Promise<WorkflowInvocation>;
      }
    : {
        (
          input: ActionInput<Action>,
          options?: CompletedCallOptions,
        ): Promise<WorkflowOutcome<ActionResult<Action>, ActionFailure<Action>>>;
        (input: ActionInput<Action>, options: AcceptedCallOptions): Promise<WorkflowInvocation>;
      };

type WorkflowTerminalResultSnapshot<Model extends WorkflowModelDefinition> = Extract<
  WorkflowResultSnapshot<Model>,
  Readonly<{ status: "succeeded" | "failed" | "cancelled" | "terminated" }>
>;

type WorkflowChildBoundAction<Action extends WorkflowActionDefinition> =
  ActionInput<Action> extends undefined
    ? (
        options?: WorkflowEffectOptions,
      ) => Promise<WorkflowOutcome<ActionResult<Action>, ActionFailure<Action>>>
    : (
        input: ActionInput<Action>,
        options?: WorkflowEffectOptions,
      ) => Promise<WorkflowOutcome<ActionResult<Action>, ActionFailure<Action>>>;

type WorkflowChildInstance<Model extends WorkflowModelDefinition> = DependencyReference<
  WorkflowReferenceProjection<Model>,
  Readonly<
    {
      start(input: StartInput<Model>, options?: WorkflowChildOptions): Promise<WorkflowStartResult>;
      state(options?: WorkflowEffectOptions): Promise<WorkflowStateSnapshot<Model>>;
      describe(options?: WorkflowEffectOptions): Promise<WorkflowDescription<Model>>;
      join(options?: WorkflowEffectOptions): Promise<WorkflowTerminalResultSnapshot<Model>>;
      pause(options?: WorkflowEffectOptions): Promise<Readonly<{ status: WorkflowStatus }>>;
      resume(options?: WorkflowEffectOptions): Promise<Readonly<{ status: WorkflowStatus }>>;
      cancel(options?: WorkflowEffectOptions): Promise<Readonly<{ status: WorkflowStatus }>>;
      terminate(options?: WorkflowEffectOptions): Promise<Readonly<{ status: WorkflowStatus }>>;
    } & {
      readonly [Name in keyof Model["Actions"]]: WorkflowChildBoundAction<Model["Actions"][Name]>;
    }
  >
>;

type WorkflowChildReferenceFactory<Model extends WorkflowModelDefinition> = Readonly<{
  get(input: Readonly<{ id: Model["Id"] }>): WorkflowChildInstance<Model>;
}>;

type WorkflowInstance<Model extends WorkflowModelDefinition> = DependencyReference<
  WorkflowReferenceProjection<Model>,
  Readonly<
    {
      start(
        input: StartInput<Model>,
        options?: Readonly<{ idempotencyKey?: string }>,
      ): Promise<WorkflowStartResult>;
      state(): Promise<WorkflowStateSnapshot<Model>>;
      describe(): Promise<WorkflowDescription<Model>>;
      result(): Promise<WorkflowResultSnapshot<Model>>;
      join(): Promise<WorkflowTerminalResultSnapshot<Model>>;
      migrate(options?: Readonly<{ idempotencyKey?: string }>): Promise<WorkflowMigrationResult>;
      observe(
        input: Readonly<{ after?: number }>,
      ): AsyncIterable<WorkflowChange<Model["State"], Model["Result"]>>;
      pause(
        options?: Readonly<{ idempotencyKey?: string }>,
      ): Promise<Readonly<{ status: WorkflowStatus }>>;
      resume(
        options?: Readonly<{ idempotencyKey?: string }>,
      ): Promise<Readonly<{ status: WorkflowStatus }>>;
      cancel(
        options?: Readonly<{ idempotencyKey?: string }>,
      ): Promise<Readonly<{ status: WorkflowStatus }>>;
      terminate(
        options?: Readonly<{ idempotencyKey?: string }>,
      ): Promise<Readonly<{ status: WorkflowStatus }>>;
    } & {
      readonly [Name in keyof Model["Actions"]]: WorkflowBoundAction<Model["Actions"][Name]>;
    }
  >
>;

type WorkflowScheduleCallOptions = Readonly<{ idempotencyKey?: string }>;

type WorkflowReferenceFactory<Model extends WorkflowModelDefinition> = Readonly<{
  get(input: Readonly<{ id: Model["Id"] }>): WorkflowInstance<Model>;
  list(input: WorkflowListRequest<Model>): Promise<WorkflowListPage<Model>>;
  listSchedules(input: WorkflowScheduleListRequest): Promise<WorkflowScheduleListPage<Model>>;
  listScheduleRuns(
    input: WorkflowListRequest<Model> & Readonly<{ id: string }>,
  ): Promise<WorkflowScheduleRunPage<Model>>;
  createSchedule(
    input: Readonly<{
      id: string;
      definition: WorkflowScheduleDefinition<Model>;
      paused?: boolean;
      trigger?: boolean;
      note?: string;
      remaining?: number;
    }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleMutation<Model>>;
  updateSchedule(
    input: Readonly<{
      id: string;
      definition: WorkflowScheduleDefinition<Model>;
      note?: string;
      remaining?: number;
    }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleMutation<Model>>;
  describeSchedule(input: Readonly<{ id: string }>): Promise<WorkflowScheduleDescription<Model>>;
  pauseSchedule(
    input: Readonly<{ id: string; note?: string }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleMutation<Model>>;
  resumeSchedule(
    input: Readonly<{ id: string; note?: string }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleMutation<Model>>;
  triggerSchedule(
    input: Readonly<{ id: string; overlap?: WorkflowScheduleOverlap }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleTriggerResult>;
  backfillSchedule(
    input: Readonly<{
      id: string;
      from: number;
      through: number;
      overlap?: WorkflowScheduleOverlap;
    }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleBackfillResult>;
  deleteSchedule(
    input: Readonly<{ id: string }>,
    options?: WorkflowScheduleCallOptions,
  ): Promise<WorkflowScheduleMutation<Model>>;
}>;

type WorkflowDependency<Model extends WorkflowModelDefinition> = Dependency<
  {
    Operations: WorkflowWireOperations<Model>;
    Reference: WorkflowReferenceProjection<Model>;
  },
  WorkflowReferenceFactory<Model>
> &
  Readonly<{
    readonly [workflowReferenceDefinition]?: Model;
  }>;

type WorkflowProvision<Model extends WorkflowModelDefinition> = Readonly<{
  [Name in Model["Name"]]: WorkflowDependency<Model>;
}>;

type WorkflowFeatureContract<Model extends WorkflowModelDefinition> = Readonly<{
  Features: {
    runtime: FeatureContractOf<DefinedActor<WorkflowRuntime<Model>>>;
    schedules: FeatureContractOf<DefinedActor<WorkflowScheduleRuntime<Model>>>;
  };
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: WorkflowRuntimeRequirement<Model>;
      Provides: WorkflowProvision<Model>;
    };
  };
}>;

/** A directly mountable Workflow Feature with an Actor-backed durable runtime. */
export type DefinedWorkflow<Model extends WorkflowModelDefinition> = Feature<
  WorkflowFeatureContract<Model>
> &
  Readonly<{ readonly [workflowDefinition]?: Model }>;

type WorkflowDynamicDefinitionData = Readonly<{
  name: string;
  artifact: string;
}>;

type WorkflowRegistryReferenceProjection = Readonly<{
  Name: "get";
  Binding: Readonly<{ id: string; definition?: WorkflowDynamicDefinitionData }>;
  Inputs: Readonly<{
    start: Readonly<{ definition?: string; input?: object }> & WorkflowStartPolicy;
    action: Readonly<{
      name: string;
      input?: object;
      wait?: "accepted" | "completed";
    }>;
    state: undefined;
    describe: undefined;
    result: undefined;
    join: undefined;
    observe: Readonly<{ after?: number }>;
    migrate: undefined;
    pause: undefined;
    resume: undefined;
    cancel: undefined;
    terminate: undefined;
  }>;
  Argument: "input";
}>;

type DynamicWorkflowInstance = DependencyReference<
  WorkflowRegistryReferenceProjection,
  Readonly<{
    start(
      input: Readonly<{ definition: string; input?: object }> & WorkflowStartPolicy,
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<DynamicWorkflowStartResult>;
    action(
      input: Readonly<{
        name: string;
        input?: object;
        wait?: "accepted" | "completed";
      }>,
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<WorkflowOutcome<object, object> | WorkflowInvocation>;
    state(): Promise<DynamicWorkflowState>;
    describe(): Promise<DynamicWorkflowDescription>;
    result(): Promise<DynamicWorkflowResult>;
    join(): Promise<DynamicWorkflowResult>;
    observe(input: Readonly<{ after?: number }>): AsyncIterable<DynamicWorkflowChange>;
    pause(
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    resume(
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    cancel(
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
    terminate(
      options?: Readonly<{ idempotencyKey?: string }>,
    ): Promise<Readonly<{ status: WorkflowStatus }>>;
  }>
>;

type WorkflowDynamicDefinition<Model extends WorkflowModelDefinition> =
  WorkflowDynamicDefinitionData & Readonly<{ readonly [workflowDynamicDefinition]?: Model }>;

type DynamicWorkflowActionRequest<
  Model extends WorkflowModelDefinition,
  Name extends keyof Model["Actions"],
> = Readonly<{
  name: Name;
  wait?: "accepted" | "completed";
}> &
  ([ActionInput<Model["Actions"][Name]>] extends [undefined]
    ? Readonly<{ input?: undefined }>
    : Readonly<{ input: ActionInput<Model["Actions"][Name]> }>);

type TypedDynamicWorkflowInstance<Model extends WorkflowModelDefinition> = Readonly<{
  start(
    input: Readonly<{ input: Model["Input"] }> & WorkflowStartPolicy,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<WorkflowStartResult>;
  action<Name extends keyof Model["Actions"]>(
    input: DynamicWorkflowActionRequest<Model, Name>,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<
    | WorkflowOutcome<ActionResult<Model["Actions"][Name]>, ActionFailure<Model["Actions"][Name]>>
    | WorkflowInvocation
  >;
  state(): Promise<WorkflowStateSnapshot<Model>>;
  describe(): Promise<WorkflowDescription<Model>>;
  result(): Promise<WorkflowResultSnapshot<Model>>;
  join(): Promise<WorkflowTerminalResultSnapshot<Model>>;
  observe(
    input: Readonly<{ after?: number }>,
  ): AsyncIterable<WorkflowChange<Model["State"], Model["Result"]>>;
  migrate(options?: Readonly<{ idempotencyKey?: string }>): Promise<WorkflowMigrationResult>;
  pause(
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  resume(
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  cancel(
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  terminate(
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
}>;

type WorkflowRegistryWireOperations = Readonly<{
  create(
    request: Readonly<{ source: string; idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionMutation>;
  revise(
    request: Readonly<{
      name: string;
      source: string;
      expected?: string;
      idempotencyKey?: string;
    }>,
  ): Promise<WorkflowDefinitionMutation>;
  retire(
    request: Readonly<{ name: string; expected?: string; idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionRetirement>;
  delete(
    request: Readonly<{ name: string; artifact: string; idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionDeletion>;
  definition(request: Readonly<{ name: string }>): Promise<WorkflowDefinitionDescription>;
  definitions(
    request: Readonly<{ after?: number; limit?: number }> | undefined,
  ): Promise<WorkflowDefinitionListPage>;
  start(
    request: Readonly<{
      id: string;
      definition?: WorkflowDynamicDefinitionData;
      input: Readonly<{ definition?: string; input?: object }> & WorkflowStartPolicy;
      idempotencyKey?: string;
    }>,
  ): Promise<DynamicWorkflowStartResult>;
  action(
    request: Readonly<{
      id: string;
      input: Readonly<{
        name: string;
        input?: object;
        wait?: "accepted" | "completed";
      }>;
      idempotencyKey?: string;
    }>,
  ): Promise<WorkflowOutcome<object, object> | WorkflowInvocation>;
  state(request: Readonly<{ id: string }>): Promise<DynamicWorkflowState>;
  describe(request: Readonly<{ id: string }>): Promise<DynamicWorkflowDescription>;
  result(request: Readonly<{ id: string }>): Promise<DynamicWorkflowResult>;
  join(request: Readonly<{ id: string }>): Promise<DynamicWorkflowResult>;
  observe(
    request: Readonly<{ id: string; input: Readonly<{ after?: number }> }>,
  ): AsyncIterable<DynamicWorkflowChange>;
  migrate(
    request: Readonly<{
      id: string;
      definition?: WorkflowDynamicDefinitionData;
      idempotencyKey?: string;
    }>,
  ): Promise<WorkflowMigrationResult>;
  pause(
    request: Readonly<{ id: string; idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  resume(
    request: Readonly<{ id: string; idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  cancel(
    request: Readonly<{ id: string; idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  terminate(
    request: Readonly<{ id: string; idempotencyKey?: string }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  $effect(
    request: Readonly<{
      id: string;
      run: number;
      sequence: number;
      attempt: number;
      outbound: string;
      generation: number;
    }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  $childClose(
    request: Readonly<{
      id: string;
      dependency: string;
      child: string;
      operation: "cancel" | "terminate";
      wait: boolean;
      outbound: string;
      generation: number;
    }>,
  ): Promise<Readonly<{ status: WorkflowStatus }>>;
  $join(request: Readonly<{ id: string }>): Promise<DynamicWorkflowResult>;
}>;

type WorkflowRegistryReferenceFactory = Readonly<{
  get<Model extends WorkflowModelDefinition>(
    input: Readonly<{ id: string; definition: WorkflowDynamicDefinition<Model> }>,
  ): TypedDynamicWorkflowInstance<Model>;
  get(input: Readonly<{ id: string }>): DynamicWorkflowInstance;
  create(
    input: Readonly<{ source: string }>,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionMutation>;
  revise(
    input: Readonly<{ name: string; source: string; expected?: string }>,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionMutation>;
  retire(
    input: Readonly<{ name: string; expected?: string }>,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionRetirement>;
  delete(
    input: Readonly<{ name: string; artifact: string }>,
    options?: Readonly<{ idempotencyKey?: string }>,
  ): Promise<WorkflowDefinitionDeletion>;
  definition(input: Readonly<{ name: string }>): Promise<WorkflowDefinitionDescription>;
  definitions(
    input?: Readonly<{ after?: number; limit?: number }>,
  ): Promise<WorkflowDefinitionListPage>;
}>;

type WorkflowRegistryDependency<Model extends WorkflowRegistryModelDefinition> = Dependency<
  {
    Operations: WorkflowRegistryWireOperations;
    Reference: WorkflowRegistryReferenceProjection;
  },
  WorkflowRegistryReferenceFactory
> &
  Readonly<{ readonly [workflowReferenceDefinition]?: WorkflowRegistryExecutionModel<Model> }>;

type WorkflowRegistryProvision<Model extends WorkflowRegistryModelDefinition> = Readonly<{
  [Name in Model["Name"]]: WorkflowRegistryDependency<Model>;
}>;

type WorkflowRegistryRequirements<Model extends WorkflowRegistryModelDefinition> = Readonly<{
  [Name in `${Model["Name"]}:workflow`]: Actor.Reference<
    WorkflowRuntime<WorkflowRegistryExecutionModel<Model>>
  >;
}> &
  Readonly<{
    [Name in `${Model["Name"]}:workflow-definitions`]: Actor.Reference<
      WorkflowDefinitionRuntime<Model>
    >;
  }> &
  Model["Dependencies"] &
  Readonly<{
    workflowCompiler: WorkflowSourceCompiler;
    clock: Clock;
    timer: Timer;
  }>;

type WorkflowRegistryFeatureContract<Model extends WorkflowRegistryModelDefinition> = Readonly<{
  Features: {
    runtime: FeatureContractOf<
      DefinedActor<WorkflowRuntime<WorkflowRegistryExecutionModel<Model>>>
    >;
    definitions: FeatureContractOf<DefinedActor<WorkflowDefinitionRuntime<Model>>>;
  };
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: WorkflowRegistryRequirements<Model>;
      Provides: WorkflowRegistryProvision<Model>;
    };
  };
}>;

/** A dynamic Workflow catalogue whose definitions remain ordinary durable data. */
export type DefinedWorkflowRegistry<Model extends WorkflowRegistryModelDefinition> = Feature<
  WorkflowRegistryFeatureContract<Model>
> &
  Readonly<{ readonly [workflowRegistryDefinition]?: Model }>;

class WorkflowCommandFailure extends Error {
  constructor(readonly failure: object) {
    super("Workflow command failed.");
    this.name = "WorkflowCommandFailure";
  }
}

class WorkflowNondeterminismError extends Error {
  constructor(readonly failure: WorkflowExecutionFailure) {
    super(
      failure.type === "dependency"
        ? failure.data.message
        : failure.type === "nondeterministic"
          ? failure.data.reason
          : failure.data.message,
    );
    this.name =
      failure.type === "dependency"
        ? failure.data.name
        : failure.type === "nondeterministic"
          ? "WorkflowNondeterminismError"
          : failure.data.name;
  }
}

function workflowRuntimeIR<Model extends WorkflowModelDefinition>(
  _definition: WorkflowImplementation<Model>,
): object {
  throw new Error("workflowRuntimeIR() must be materialized by the Workflow compiler extension.");
}

function workflowDependencyCatalogue<_Model extends WorkflowRegistryModelDefinition>(): Readonly<
  Record<string, TypeSchema>
> {
  throw new Error(
    "workflowDependencyCatalogue() must be materialized by the Workflow compiler extension.",
  );
}

function workflowRuntimeAdvance<Model extends WorkflowModelDefinition>(
  _definition: WorkflowImplementation<Model>,
  _execution: object,
): object {
  throw new Error("workflowRuntimeAdvance() must be lowered by the Workflow compiler extension.");
}

function workflowRuntimeTransfer<Model extends WorkflowModelDefinition>(
  _definition: WorkflowImplementation<Model>,
  _execution: object,
  _transfer: WorkflowFrameTransfer,
): object {
  throw new Error("workflowRuntimeTransfer() must be lowered by the Workflow compiler extension.");
}

type RuntimeWorkflowContext<Model extends WorkflowModelDefinition> = Readonly<{
  key: Model["Id"];
  state: WorkflowRuntimeState<Model>;
  input: object | undefined;
  dependencies: Model["Dependencies"];
  factory: WorkflowRuntimeFactory<Model>;
  invocation: Readonly<{ id: string; at: number }>;
  fail(
    failure:
      | Readonly<{ type: "unavailable"; data: { status: WorkflowStatus } }>
      | Readonly<{ type: "invalid"; data: { message: string } }>,
  ): never;
  reminders: Readonly<{
    schedule(request: { id: string; at: number; method: CallableFunction; input: object }): void;
    cancel(request: Readonly<{ id: string }>): void;
  }>;
  outbox: Readonly<{
    schedule(
      request: Readonly<{
        id: string;
        at: number;
        operation: "effect" | "child-close";
        input:
          | Readonly<{ run: number; sequence: number; attempt: number }>
          | Readonly<{
              dependency: string;
              id: string;
              operation: "cancel" | "terminate";
              wait: boolean;
            }>;
        complete: CallableFunction;
        completion:
          | Readonly<{ run: number; sequence: number; attempt: number }>
          | Readonly<{ dependency: string; id: string; wait: boolean }>;
      }>,
    ): void;
    cancel(request: Readonly<{ id: string }>): void;
    requestCancellation(request: Readonly<{ id: string }>): void;
  }>;
}>;

type RuntimeWorkflowScheduleContext<Model extends WorkflowModelDefinition> = Readonly<{
  key: string;
  state: WorkflowScheduleRuntimeState<Model>;
  input: object | undefined;
  dependencies: WorkflowScheduleRuntimeDependencies<Model>;
  invocation: Readonly<{ id: string; at: number }>;
  reminders: Readonly<{
    schedule(request: { id: string; at: number; method: CallableFunction; input: object }): void;
    cancel(request: Readonly<{ id: string }>): void;
  }>;
  outbox: Readonly<{
    schedule(
      request: Readonly<{
        id: string;
        at: number;
        operation: "calendar" | "start" | "inspect" | "cancel" | "terminate";
        input: object;
        complete: CallableFunction;
        completion: object;
      }>,
    ): void;
    cancel(request: Readonly<{ id: string }>): void;
    requestCancellation(request: Readonly<{ id: string }>): void;
  }>;
}>;

function createWorkflowExecutionRuntime<Model extends WorkflowModelDefinition>(
  definition: ValidWorkflowImplementation<Model>,
): DefinedActor<WorkflowRuntime<Model>> {
  return createWorkflowExecutionActor(definition, () => ({
    name: typeLiteral<Model["Name"]>(),
    revision: typeLiteral<Model["Revision"]>(),
    artifact: workflowRuntimeIR<Model>(definition),
    advance: (execution: object) => workflowRuntimeAdvance<Model>(definition, execution),
    transfer: (execution: object, transfer: WorkflowFrameTransfer) =>
      workflowRuntimeTransfer<Model>(definition, execution, transfer),
    interpret: (executable: object, execution: object) =>
      advanceWorkflowExecutable(executable, execution),
    interpretTransfer: (executable: object, execution: object, transfer: WorkflowFrameTransfer) =>
      transferWorkflowExecutable(executable, execution, transfer),
    interpretProcedure: (procedure: object, context: object) =>
      executeWorkflowExecutableProcedure(procedure, context),
    replay: (executable: object, trace: object) => replayWorkflowExecutable(executable, trace),
    state: definition.state,
    actions: definition.actions,
    dependencies: typeKeys<Model["Dependencies"]>(),
  }));
}

function createWorkflowExecutionActor<Model extends WorkflowModelDefinition>(
  definition: ValidWorkflowImplementation<Model>,
  factory: () => WorkflowRuntimeFactory<Model>,
): DefinedActor<WorkflowRuntime<Model>> {
  return createActorFactory<WorkflowRuntime<Model>>(
    {
      state: () => ({
        status: "idle",
        definition: 0,
        run: 0,
        revision: 0,
        time: 0,
        history: [],
        pendingEffects: [],
        pendingTimers: [],
        pendingWaits: [],
        children: [],
        pendingChildCloses: [],
        changes: [],
        closedRuns: [],
      }),
      methods: createWorkflowRuntimeMethods<Model>(),
    } as unknown as Actor.Definition<WorkflowRuntime<Model>>,
    () => typeLiteral<`${Model["Name"]}:workflow`>(),
    () => ({
      $start: "write",
      $action: "write",
      $advance: "write",
      $effect: "write",
      $effectDispatch: "read",
      $completeEffect: "write",
      $completeChildClose: "write",
      $heartbeatEffect: "write",
      $timeoutEffect: "write",
      $timer: "write",
      $wait: "write",
      $changes: "read",
      $visibility: "read",
      state: "read",
      describe: "read",
      result: "read",
      migrate: "write",
      pause: "write",
      resume: "write",
      cancel: "write",
      terminate: "write",
    }),
    factory,
    () => 1,
    () => ({
      effect({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: Model["Id"];
        id: string;
        generation: number;
        input: object;
      }>) {
        const effect = input as Readonly<{
          run: number;
          sequence: number;
          attempt: number;
        }>;
        return {
          dependency: typeLiteral<Model["Name"]>(),
          operation: "$effect",
          input: {
            id: key,
            run: effect.run,
            sequence: effect.sequence,
            attempt: effect.attempt,
            outbound: id,
            generation,
          },
        };
      },
      "child-close"({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: Model["Id"];
        id: string;
        generation: number;
        input: object;
      }>) {
        const child = input as Readonly<{
          dependency: string;
          id: string;
          operation: "cancel" | "terminate";
          wait: boolean;
        }>;
        return {
          dependency: typeLiteral<Model["Name"]>(),
          operation: "$childClose",
          input: {
            id: key,
            dependency: child.dependency,
            child: child.id,
            operation: child.operation,
            wait: child.wait,
            outbound: id,
            generation,
          },
        };
      },
    }),
  );
}

/**
 * Defines one Workflow kind. The semantic model is the source of names and
 * schemas; the value supplies only executable behavior.
 */
export function createWorkflow<const Model extends WorkflowModelDefinition>(
  definition: ValidWorkflowImplementation<Model>,
): DefinedWorkflow<Model> {
  const runtime = createWorkflowExecutionRuntime<Model>(definition);
  const schedules = createWorkflowScheduleRuntime<Model>();

  return createFeature<WorkflowFeatureContract<Model>>({
    features: { runtime, schedules },
    programs: {
      server: {
        async start({
          dependencies,
        }: Readonly<{ dependencies: WorkflowRuntimeRequirement<Model> }>) {
          const name = typeLiteral<Model["Name"]>();
          const runtimeName = typeLiteral<`${Model["Name"]}:workflow`>();
          const scheduleName = typeLiteral<`${Model["Name"]}:workflow-schedule`>();
          const actionNames = typeKeys<Model["Actions"]>();
          const visibility = typeKeys<Model["Visibility"]>();
          const runtimeDependency = dependencies[runtimeName] as object;
          const scheduleDependency = dependencies[scheduleName] as object;
          const calendar = dependencies.calendar;
          const clock = dependencies.clock;
          const timer = dependencies.timer;
          const available = dependencies as Readonly<Record<string, DependencyContract>>;
          return {
            [name]: {
              [dependencyInvocation](
                operation: string,
                received: object,
                invocation: RuntimeDependencyInvocation,
              ) {
                if (operation === "list") {
                  return listWorkflows<Model>(
                    runtimeDependency,
                    visibility,
                    received as unknown as WorkflowListRequest<Model>,
                  );
                }
                if (operation === "listSchedules") {
                  return listWorkflowSchedules<Model>(
                    scheduleDependency,
                    received as unknown as WorkflowScheduleListRequest,
                  );
                }
                if (operation === "listScheduleRuns") {
                  return listWorkflowScheduleRuns<Model>(
                    runtimeDependency,
                    visibility,
                    received as unknown as WorkflowListRequest<Model> & Readonly<{ id: string }>,
                  );
                }
                const request = received as Readonly<{
                  id: Model["Id"];
                  input?: object;
                  wait?: "accepted" | "completed";
                  idempotencyKey?: string;
                }>;
                if (
                  operation === "$scheduleCalendar" ||
                  operation === "$scheduleStart" ||
                  operation === "$scheduleInspect" ||
                  operation === "$scheduleClose"
                ) {
                  return executeWorkflowScheduleOutbound<Model>(
                    scheduleDependency,
                    runtimeDependency,
                    calendar,
                    clock,
                    operation,
                    request as unknown as WorkflowScheduleOutboundRequest,
                    invocation,
                  );
                }
                if (workflowScheduleOperation(operation)) {
                  return dispatchWorkflowScheduleOperation<Model>(
                    scheduleDependency,
                    calendar,
                    clock,
                    operation,
                    request as unknown as WorkflowScheduleWireRequest<Model>,
                    invocation,
                  );
                }
                if (operation === "$effect") {
                  return executeWorkflowEffect<Model>(
                    runtimeDependency,
                    available,
                    clock,
                    request as unknown as Readonly<{
                      id: Model["Id"];
                      run: number;
                      sequence: number;
                      attempt: number;
                      outbound: string;
                      generation: number;
                    }>,
                    invocation,
                  );
                }
                if (operation === "$childClose") {
                  return executeWorkflowChildClose<Model>(
                    runtimeDependency,
                    available,
                    clock,
                    timer,
                    request as unknown as Readonly<{
                      id: Model["Id"];
                      dependency: string;
                      child: string;
                      operation: "cancel" | "terminate";
                      wait: boolean;
                      outbound: string;
                      generation: number;
                    }>,
                    invocation,
                  );
                }
                if (operation === "$join" || operation === "join") {
                  return waitForWorkflowResult<Model>(
                    runtimeDependency,
                    clock,
                    timer,
                    request.id,
                    invocation.cancellation,
                  );
                }
                if (operation === "observe") {
                  return observeWorkflow<Model>(
                    runtimeDependency,
                    clock,
                    timer,
                    request.id,
                    (request.input as Readonly<{ after?: number }> | undefined)?.after ?? 0,
                  );
                }
                return dispatchWorkflowOperation<Model>(
                  runtimeDependency,
                  actionNames,
                  operation,
                  request,
                  invocation,
                );
              },
            },
          } as unknown as DependencyImplementations<WorkflowProvision<Model>>;
        },
      },
    },
  }) as DefinedWorkflow<Model>;
}

/**
 * Mounts one durable catalogue for runtime-authored Workflow definitions.
 *
 * Definitions are data inside this Feature. Creating one never mutates the
 * mounted System or introduces a new Program or Dependency at runtime.
 */
export function createWorkflowRegistry<
  const Model extends WorkflowRegistryModelDefinition,
>(): DefinedWorkflowRegistry<Model> {
  type Execution = WorkflowRegistryExecutionModel<Model>;
  const runtime = createDynamicWorkflowExecutionRuntime<Model>();
  const definitionMethods = createWorkflowDefinitionRuntimeMethods<Model>();
  const definitions = createActorFactory<WorkflowDefinitionRuntime<Model>>(
    {
      state: () => ({ maximumRevision: 0, revisions: [] }),
      methods: definitionMethods,
    } as unknown as Actor.Definition<WorkflowDefinitionRuntime<Model>>,
    () => typeLiteral<`${Model["Name"]}:workflow-definitions`>(),
    () => ({
      create: "write",
      revise: "write",
      retire: "write",
      delete: "write",
      $resolve: "read",
      describe: "read",
    }),
    () => ({}),
    () => 1,
    () => ({}),
  );

  return createFeature<WorkflowRegistryFeatureContract<Model>>({
    features: { runtime, definitions },
    programs: {
      server: {
        async start({
          dependencies,
        }: Readonly<{ dependencies: WorkflowRegistryRequirements<Model> }>) {
          const name = typeLiteral<Model["Name"]>();
          const runtimeName = typeLiteral<`${Model["Name"]}:workflow`>();
          const definitionName = typeLiteral<`${Model["Name"]}:workflow-definitions`>();
          const catalogue = workflowDependencyCatalogue<Model>();
          const runtimeDependency = dependencies[runtimeName] as object;
          const definitionDependency = dependencies[definitionName] as object;
          const compiler = dependencies.workflowCompiler;
          const clock = dependencies.clock;
          const timer = dependencies.timer;
          const available = dependencies as Readonly<Record<string, DependencyContract>>;
          return {
            [name]: {
              [dependencyInvocation](
                operation: string,
                received: object,
                invocation: RuntimeDependencyInvocation,
              ) {
                const request = received as Readonly<{
                  id?: string;
                  definition?: WorkflowDynamicDefinitionData;
                  input?: object;
                  name?: string;
                  source?: string;
                  expected?: string;
                  artifact?: string;
                  after?: number;
                  limit?: number;
                  idempotencyKey?: string;
                }>;
                if (operation === "create" || operation === "revise") {
                  return compileAndRegisterWorkflowDefinition(
                    definitionDependency,
                    compiler,
                    catalogue,
                    operation,
                    request,
                    invocation,
                  );
                }
                if (
                  operation === "retire" ||
                  operation === "delete" ||
                  operation === "definition"
                ) {
                  return dispatchWorkflowDefinitionOperation(
                    definitionDependency,
                    operation,
                    request,
                    invocation,
                  );
                }
                if (operation === "definitions") {
                  return listWorkflowDefinitions(definitionDependency, request);
                }
                if (operation === "$effect") {
                  return executeWorkflowEffect<Execution>(
                    runtimeDependency,
                    available,
                    clock,
                    request as unknown as Readonly<{
                      id: string;
                      run: number;
                      sequence: number;
                      attempt: number;
                      outbound: string;
                      generation: number;
                    }>,
                    invocation,
                  );
                }
                if (operation === "$childClose") {
                  return executeWorkflowChildClose<Execution>(
                    runtimeDependency,
                    available,
                    clock,
                    timer,
                    request as unknown as Readonly<{
                      id: string;
                      dependency: string;
                      child: string;
                      operation: "cancel" | "terminate";
                      wait: boolean;
                      outbound: string;
                      generation: number;
                    }>,
                    invocation,
                  );
                }
                if (operation === "$join" || operation === "join") {
                  return waitForWorkflowResult<Execution>(
                    runtimeDependency,
                    clock,
                    timer,
                    requiredWorkflowString(request.id, "execution id"),
                    invocation.cancellation,
                  );
                }
                if (operation === "observe") {
                  return observeWorkflow<Execution>(
                    runtimeDependency,
                    clock,
                    timer,
                    requiredWorkflowString(request.id, "execution id"),
                    (request.input as Readonly<{ after?: number }> | undefined)?.after ?? 0,
                  );
                }
                return dispatchDynamicWorkflowOperation(
                  definitionDependency,
                  runtimeDependency,
                  operation,
                  request,
                  invocation,
                );
              },
            },
          } as unknown as DependencyImplementations<WorkflowRegistryProvision<Model>>;
        },
      },
    },
  }) as DefinedWorkflowRegistry<Model>;
}

function createDynamicWorkflowExecutionRuntime<
  Model extends WorkflowRegistryModelDefinition,
>(): DefinedActor<WorkflowRuntime<WorkflowRegistryExecutionModel<Model>>> {
  type Execution = WorkflowRegistryExecutionModel<Model>;
  const definition = {
    state: () => ({}),
    actions: {},
    run: () => ({}),
  } as ValidWorkflowImplementation<Execution>;
  return createWorkflowExecutionActor<Execution>(definition, () => {
    const artifact = {
      id: "kit:workflow:dynamic",
      definition: {
        contract: {
          name: typeLiteral<Model["Name"]>(),
          revision: 1,
          input: {},
          state: {},
          result: {},
          failures: {},
          actions: {},
          dependencies: {},
          children: [],
          visibility: [],
        },
        entry: "entry",
      },
      executable: {
        revision: 1,
        initialization: {},
        actionHandlers: {},
        run: {},
      },
    };
    return {
      name: typeLiteral<Model["Name"]>(),
      revision: 1,
      artifact,
      advance: (execution: object) => advanceWorkflowExecutable(artifact.executable, execution),
      transfer: (execution: object, transfer: WorkflowFrameTransfer) =>
        transferWorkflowExecutable(artifact.executable, execution, transfer),
      interpret: (executable: object, execution: object) =>
        advanceWorkflowExecutable(executable, execution),
      interpretTransfer: (executable: object, execution: object, transfer: WorkflowFrameTransfer) =>
        transferWorkflowExecutable(executable, execution, transfer),
      interpretProcedure: (procedure: object, context: object) =>
        executeWorkflowExecutableProcedure(procedure, context),
      replay: (executable: object, trace: object) => replayWorkflowExecutable(executable, trace),
      state: definition.state,
      actions: definition.actions,
      dependencies: typeKeys<Model["Dependencies"]>(),
    };
  });
}

type RuntimeWorkflowDefinitionContext = Readonly<{
  key: string;
  state: WorkflowDefinitionRuntimeState;
  input: object | undefined;
  invocation: Readonly<{ id: string; at: number }>;
}>;

function createWorkflowDefinitionRuntimeMethods<
  Model extends WorkflowRegistryModelDefinition,
>(): Actor.Definition<WorkflowDefinitionRuntime<Model>>["methods"] {
  const methods: Record<string, CallableFunction> = {};
  methods.create = (context: RuntimeWorkflowDefinitionContext) => {
    const input = context.input as Readonly<{ source: string; artifact: object }>;
    const artifact = validateRuntimeWorkflowArtifact(input.artifact);
    if (artifact.definition.contract.name !== context.key) {
      return workflowDefinitionConflict(
        context,
        "The compiled definition name does not match its registry identity.",
      );
    }
    const existing = context.state.revisions.find(
      (revision) => revision.artifact.id === artifact.id,
    );
    if (existing !== undefined) {
      return {
        status: "existing",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    if (context.state.revisions.length > 0) {
      return workflowDefinitionConflict(context, "The Workflow definition already exists.");
    }
    if (artifact.definition.contract.revision <= context.state.maximumRevision) {
      return workflowDefinitionConflict(
        context,
        "The Workflow definition revision must increase monotonically.",
      );
    }
    context.state.revisions.push({
      source: input.source,
      artifact: cloneWorkflowData(artifact),
      createdAt: context.invocation.at,
    });
    context.state.maximumRevision = artifact.definition.contract.revision;
    context.state.current = artifact.id;
    return {
      status: "created",
      definition: describeWorkflowDefinition(context.key, context.state),
    };
  };
  methods.revise = (context: RuntimeWorkflowDefinitionContext) => {
    const input = context.input as Readonly<{
      source: string;
      artifact: object;
      expected?: string;
    }>;
    const artifact = validateRuntimeWorkflowArtifact(input.artifact);
    if (artifact.definition.contract.name !== context.key) {
      return workflowDefinitionConflict(
        context,
        "The compiled definition name does not match its registry identity.",
      );
    }
    const existing = context.state.revisions.find(
      (revision) => revision.artifact.id === artifact.id,
    );
    if (existing !== undefined) {
      return {
        status: "existing",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    if (context.state.current === undefined) {
      return workflowDefinitionConflict(context, "The Workflow definition is not active.");
    }
    if (input.expected !== undefined && input.expected !== context.state.current) {
      return workflowDefinitionConflict(
        context,
        "The expected Workflow artifact is no longer current.",
      );
    }
    if (artifact.definition.contract.revision <= context.state.maximumRevision) {
      return workflowDefinitionConflict(
        context,
        "The Workflow definition revision must increase monotonically.",
      );
    }
    context.state.revisions.push({
      source: input.source,
      artifact: cloneWorkflowData(artifact),
      createdAt: context.invocation.at,
    });
    context.state.maximumRevision = artifact.definition.contract.revision;
    context.state.current = artifact.id;
    return {
      status: "revised",
      definition: describeWorkflowDefinition(context.key, context.state),
    };
  };
  methods.retire = (context: RuntimeWorkflowDefinitionContext) => {
    const input = context.input as Readonly<{ expected?: string }>;
    if (context.state.current === undefined) {
      return {
        status: context.state.revisions.length > 0 ? "existing" : "missing",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    if (input.expected !== undefined && input.expected !== context.state.current) {
      return {
        status: "conflict",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    const current = context.state.revisions.find(
      (revision) => revision.artifact.id === context.state.current,
    );
    if (current !== undefined) current.retiredAt = context.invocation.at;
    context.state.current = undefined;
    return {
      status: "retired",
      definition: describeWorkflowDefinition(context.key, context.state),
    };
  };
  methods.delete = (context: RuntimeWorkflowDefinitionContext) => {
    const input = context.input as Readonly<{ artifact: string }>;
    if (context.state.current === input.artifact) {
      return {
        status: "current",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    const existing = context.state.revisions.find(
      (revision) => revision.artifact.id === input.artifact,
    );
    if (existing === undefined) {
      return {
        status: "missing",
        definition: describeWorkflowDefinition(context.key, context.state),
      };
    }
    context.state.revisions = context.state.revisions.filter(
      (revision) => revision.artifact.id !== input.artifact,
    );
    return {
      status: "deleted",
      definition: describeWorkflowDefinition(context.key, context.state),
    };
  };
  methods.$resolve = (context: RuntimeWorkflowDefinitionContext) => {
    const input = context.input as Readonly<{ artifact?: string }> | undefined;
    const selected = context.state.revisions.find(
      (revision) =>
        context.state.current !== undefined &&
        revision.artifact.id === (input?.artifact ?? context.state.current),
    );
    return selected === undefined ? {} : { artifact: cloneWorkflowData(selected.artifact) };
  };
  methods.describe = (context: RuntimeWorkflowDefinitionContext) => {
    return describeWorkflowDefinition(context.key, context.state);
  };
  return methods as Actor.Definition<WorkflowDefinitionRuntime<Model>>["methods"];
}

function workflowDefinitionConflict(
  context: RuntimeWorkflowDefinitionContext,
  reason: string,
): Exclude<WorkflowDefinitionMutation, Readonly<{ status: "rejected" }>> {
  return {
    status: "conflict",
    definition: describeWorkflowDefinition(context.key, context.state),
    reason,
  };
}

function describeWorkflowDefinition(
  name: string,
  state: WorkflowDefinitionRuntimeState,
): WorkflowDefinitionDescription {
  const current = state.revisions.find((revision) => revision.artifact.id === state.current);
  const latest = current ?? state.revisions[state.revisions.length - 1];
  return {
    name,
    ...(state.current === undefined ? {} : { current: state.current }),
    ...(latest === undefined
      ? {}
      : { contract: workflowDefinitionContract(latest.artifact.definition.contract) }),
    revisions: state.revisions.map((revision) => ({
      artifact: revision.artifact.id,
      revision: revision.artifact.definition.contract.revision,
      status:
        revision.artifact.id === state.current
          ? "current"
          : revision.retiredAt === undefined
            ? "superseded"
            : "retired",
      createdAt: revision.createdAt,
      ...(revision.retiredAt === undefined ? {} : { retiredAt: revision.retiredAt }),
    })),
  };
}

function workflowDefinitionContract(
  contract: WorkflowRuntimeArtifact["definition"]["contract"],
): WorkflowDefinitionContract {
  return {
    input: cloneWorkflowData(contract.input),
    state: cloneWorkflowData(contract.state),
    result: cloneWorkflowData(contract.result),
    failures: cloneWorkflowData(contract.failures),
    actions: cloneWorkflowData(contract.actions),
    dependencies: cloneWorkflowData(contract.dependencies),
    visibility: cloneWorkflowData(contract.visibility),
  };
}

async function compileAndRegisterWorkflowDefinition(
  definitions: object,
  compiler: WorkflowSourceCompiler,
  catalogue: Readonly<Record<string, TypeSchema>>,
  operation: "create" | "revise",
  request: Readonly<{
    name?: string;
    source?: string;
    expected?: string;
    idempotencyKey?: string;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<WorkflowDefinitionMutation> {
  const source = requiredWorkflowString(request.source, "Workflow source");
  if (source.length > 262_144) {
    return {
      status: "rejected",
      diagnostics: [{ message: "Workflow source exceeds the 262144 character limit." }],
    };
  }
  let compilation: WorkflowSourceCompilation;
  try {
    compilation = await compiler.compile({ source, dependencies: catalogue });
  } catch (compilerError) {
    return {
      status: "rejected",
      diagnostics: [
        {
          message:
            compilerError instanceof Error
              ? compilerError.message
              : "The Workflow source compiler rejected the definition.",
        },
      ],
    };
  }
  if (compilation.status === "rejected") return compilation;
  let artifact: WorkflowRuntimeArtifact;
  try {
    artifact = validateRuntimeWorkflowArtifact(compilation.artifact);
    validateWorkflowDependencyAuthority(artifact, catalogue);
  } catch (artifactError) {
    return {
      status: "rejected",
      diagnostics: [
        {
          message:
            artifactError instanceof Error
              ? artifactError.message
              : "The Workflow artifact is not valid.",
        },
      ],
    };
  }
  const name = artifact.definition.contract.name;
  if (operation === "revise" && request.name !== name) {
    return {
      status: "rejected",
      diagnostics: [
        {
          message: `The revised Workflow must retain definition name ${JSON.stringify(
            request.name,
          )}.`,
        },
      ],
    };
  }
  const idempotencyKey = request.idempotencyKey ?? invocation.id;
  return actorValue(
    await dispatchDependency<
      Actor.Outcome<Exclude<WorkflowDefinitionMutation, Readonly<{ status: "rejected" }>>>
    >(
      definitions,
      operation,
      {
        key: name,
        input: {
          source,
          artifact,
          ...(request.expected === undefined ? {} : { expected: request.expected }),
        },
        idempotencyKey,
      },
      { idempotencyKey },
    ),
  );
}

async function dispatchWorkflowDefinitionOperation(
  definitions: object,
  operation: "retire" | "delete" | "definition",
  request: Readonly<{
    name?: string;
    expected?: string;
    artifact?: string;
    idempotencyKey?: string;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<object> {
  const name = requiredWorkflowString(request.name, "Workflow definition name");
  if (operation === "definition") {
    return await dispatchDependency<WorkflowDefinitionDescription>(definitions, "describe", {
      key: name,
    });
  }
  const idempotencyKey = request.idempotencyKey ?? invocation.id;
  return actorValue(
    await dispatchDependency<Actor.Outcome<object>>(
      definitions,
      operation,
      {
        key: name,
        input:
          operation === "delete"
            ? { artifact: requiredWorkflowString(request.artifact, "Workflow artifact") }
            : request.expected === undefined
              ? {}
              : { expected: request.expected },
        idempotencyKey,
      },
      { idempotencyKey },
    ),
  );
}

async function listWorkflowDefinitions(
  definitions: object,
  request: Readonly<{ after?: number; limit?: number }> | undefined,
): Promise<WorkflowDefinitionListPage> {
  const limit = request?.limit ?? 50;
  if (limit % 1 !== 0 || limit < 1 || limit > 100) {
    throw new TypeError("Workflow definition list limit must be between 1 and 100.");
  }
  const page = await listActorKeys<string>(definitions, {
    ...(request?.after === undefined ? {} : { after: request.after }),
    limit,
  });
  const entries: WorkflowDefinitionDescription[] = [];
  for (const entry of page.entries) {
    const definition = await dispatchDependency<WorkflowDefinitionDescription>(
      definitions,
      "describe",
      { key: entry.key },
    );
    if (definition.revisions.length > 0) entries.push(definition);
  }
  return {
    cursor: page.entries[page.entries.length - 1]?.cursor ?? request?.after ?? 0,
    definitions: entries,
    done: page.done,
  };
}

async function dispatchDynamicWorkflowOperation(
  definitions: object,
  runtime: object,
  operation: string,
  request: Readonly<{
    id?: string;
    definition?: WorkflowDynamicDefinitionData;
    input?: object;
    idempotencyKey?: string;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<object> {
  const id = requiredWorkflowString(request.id, "Workflow execution id");
  const idempotencyKey = request.idempotencyKey ?? invocation.id;
  if (operation === "start") {
    const input = request.input as
      | (Readonly<{ definition?: string; input?: object }> & WorkflowStartPolicy)
      | undefined;
    const definition = dynamicWorkflowDefinitionSelection(request.definition, input?.definition);
    const resolved = await dispatchDependency<Readonly<{ artifact?: object }>>(
      definitions,
      "$resolve",
      {
        key: definition.name,
        ...(definition.artifact === undefined ? {} : { input: { artifact: definition.artifact } }),
      },
    );
    if (resolved.artifact === undefined) {
      return { status: "missing-definition", definition: definition.name };
    }
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowStartResult>>(
        runtime,
        "$start",
        {
          key: id,
          input: {
            input: input?.input,
            artifact: resolved.artifact,
            conflict: input?.conflict ?? "reject",
            reuse: input?.reuse ?? "reject",
          },
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "state" || operation === "describe" || operation === "result") {
    return await dispatchDependency<object>(runtime, operation, { key: id });
  }
  if (
    operation === "pause" ||
    operation === "resume" ||
    operation === "cancel" ||
    operation === "terminate"
  ) {
    return actorValue(
      await dispatchDependency<Actor.Outcome<object>>(
        runtime,
        operation,
        { key: id, idempotencyKey },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "migrate") {
    if (request.definition === undefined) {
      throw new TypeError("Workflow migration requires a generated definition descriptor.");
    }
    const target = dynamicWorkflowDefinitionSelection(request.definition, undefined);
    const migrationTarget = await dispatchDependency<Readonly<{ artifact?: object }>>(
      definitions,
      "$resolve",
      {
        key: target.name,
        input: { artifact: target.artifact },
      },
    );
    if (migrationTarget.artifact === undefined) {
      return {
        status: "unavailable",
        lifecycle: "idle",
      } satisfies WorkflowMigrationResult;
    }
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowMigrationResult>>(
        runtime,
        "migrate",
        {
          key: id,
          input: { artifact: migrationTarget.artifact },
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation !== "action") {
    throw new Error(`Unknown dynamic Workflow operation ${operation}.`);
  }
  const action = request.input as
    | Readonly<{ name: string; input?: object; wait?: "accepted" | "completed" }>
    | undefined;
  const name = requiredWorkflowString(action?.name, "Workflow Action name");
  const dispatched = await dispatchDependency<
    Actor.Outcome<{ outcome: WorkflowOutcome<object, object> }> | WorkflowInvocation
  >(
    runtime,
    "$action",
    {
      key: id,
      input: { name, input: action?.input },
      wait: action?.wait,
      idempotencyKey,
    },
    { idempotencyKey },
  );
  const accepted = dispatched as Readonly<{ id?: string }>;
  if (accepted.id !== undefined) return { id: accepted.id };
  return actorValue(dispatched as Actor.Outcome<{ outcome: WorkflowOutcome<object, object> }>)
    .outcome;
}

function validateRuntimeWorkflowArtifact(value: object): WorkflowRuntimeArtifact {
  const artifact = value as Partial<WorkflowRuntimeArtifact>;
  const artifactId = artifact.id ?? "";
  const definition = artifact.definition;
  const contract = definition?.contract;
  const executable = artifact.executable;
  if (
    dataKind(artifactId) !== "string" ||
    artifactId.length === 0 ||
    definition === undefined ||
    contract === undefined ||
    dataKind(contract.name) !== "string" ||
    contract.name.length === 0 ||
    contract.revision % 1 !== 0 ||
    contract.revision < 1 ||
    contract.revision > 9_007_199_254_740_991 ||
    dataKind(definition.entry) !== "string" ||
    definition.entry.length === 0 ||
    executable === undefined ||
    executable.revision !== contract.revision ||
    dataKind(executable.initialization) !== "record" ||
    dataKind(executable.run) !== "record" ||
    dataKind(executable.actionHandlers) !== "record"
  ) {
    throw new TypeError("The Workflow compiler returned an invalid artifact.");
  }
  return artifact as WorkflowRuntimeArtifact;
}

function validateWorkflowDependencyAuthority(
  artifact: WorkflowRuntimeArtifact,
  catalogue: Readonly<Record<string, TypeSchema>>,
): void {
  for (const name of Object.keys(artifact.definition.contract.dependencies)) {
    const schema = artifact.definition.contract.dependencies[name];
    if (schema === undefined) {
      throw new TypeError("Workflow Dependency schema is missing.");
    }
    const delegated = catalogue[name];
    if (delegated === undefined) {
      throw new TypeError(
        `Workflow Dependency ${JSON.stringify(name)} was not delegated to this registry.`,
      );
    }
    if (JSON.stringify(schema) !== JSON.stringify(delegated)) {
      throw new TypeError(
        `Workflow Dependency ${JSON.stringify(name)} does not match its delegated contract.`,
      );
    }
  }
}

function assertWorkflowValue(value: WorkflowData, schema: TypeSchema, label: string): void {
  if (!workflowValueMatches(value, schema)) {
    throw new TypeError(`${label} does not satisfy its declared schema ${JSON.stringify(schema)}.`);
  }
}

function requireWorkflowValue<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  value: WorkflowData,
  schema: TypeSchema,
  label: string,
): void {
  if (!workflowValueMatches(value, schema)) {
    context.fail({
      type: "invalid",
      data: {
        message: `${label} does not satisfy its declared schema ${JSON.stringify(schema)}.`,
      },
    });
  }
}

function workflowValueMatches(value: WorkflowData, schemaData: TypeSchema): boolean {
  const candidates: WorkflowSchemaCheck[][] = [[{ value, schema: schemaData }]];
  let candidateIndex = 0;
  while (candidateIndex < candidates.length) {
    const checks = candidates[candidateIndex];
    candidateIndex += 1;
    if (checks !== undefined) {
      let valid = true;
      let checkIndex = 0;
      while (valid && checkIndex < checks.length) {
        const check = checks[checkIndex];
        checkIndex += 1;
        if (check === undefined) {
          valid = false;
        } else {
          const schema = check.schema as RuntimeWorkflowSchema;
          if (schema.kind === "primitive") {
            valid =
              schema.name === "void"
                ? check.value === undefined
                : schema.name === "null"
                  ? check.value === null
                  : schema.name === "boolean"
                    ? dataKind(check.value) === "boolean"
                    : schema.name === "number"
                      ? dataKind(check.value) === "number"
                      : schema.name === "string" && dataKind(check.value) === "string";
          } else if (schema.kind === "opaque") {
            valid = check.value !== undefined;
          } else if (schema.kind === "literal") {
            valid = check.value === schema.value;
          } else if (schema.kind === "option") {
            if (check.value !== undefined) {
              const nested = schema.value as object | undefined;
              if (nested === undefined) {
                valid = false;
              } else {
                checks.push({ value: check.value, schema: nested });
              }
            }
          } else if (schema.kind === "array") {
            if (dataKind(check.value) !== "array" || schema.element === undefined) {
              valid = false;
            } else {
              const arrayItems = check.value as readonly WorkflowData[];
              let itemIndex = 0;
              while (itemIndex < arrayItems.length) {
                checks.push({ value: arrayItems[itemIndex], schema: schema.element });
                itemIndex += 1;
              }
            }
          } else if (schema.kind === "tuple") {
            const tupleItems = check.value as readonly WorkflowData[];
            const elements = schema.elements ?? [];
            if (dataKind(check.value) !== "array" || tupleItems.length !== elements.length) {
              valid = false;
            } else {
              for (let index = 0; index < elements.length; index += 1) {
                const element = elements[index];
                if (element === undefined) {
                  valid = false;
                } else {
                  checks.push({ value: tupleItems[index], schema: element });
                }
              }
            }
          } else if (schema.kind === "union") {
            const variants = schema.variants ?? [];
            let variantIndex = 0;
            while (variantIndex < variants.length) {
              const variant = variants[variantIndex];
              if (variant !== undefined) {
                const branch = checks.slice(checkIndex);
                branch.push({ value: check.value, schema: variant });
                candidates.push(branch);
              }
              variantIndex += 1;
            }
            valid = false;
          } else if (schema.kind === "record") {
            if (dataKind(check.value) !== "record") {
              valid = false;
            } else {
              const record = check.value as Readonly<Record<string, WorkflowData>>;
              const fields = schema.fields ?? [];
              let fieldIndex = 0;
              while (fieldIndex < fields.length) {
                const field = fields[fieldIndex];
                if (field !== undefined) {
                  const fieldValue = record[field.name];
                  if (fieldValue !== undefined || !field.optional) {
                    checks.push({ value: fieldValue, schema: field.type });
                  }
                }
                fieldIndex += 1;
              }
            }
          } else {
            valid = false;
          }
        }
      }
      if (valid) return true;
    }
  }
  return false;
}

function dynamicWorkflowDefinitionSelection(
  descriptor: WorkflowDynamicDefinitionData | undefined,
  current: string | undefined,
): Readonly<{ name: string; artifact?: string }> {
  if (descriptor === undefined) {
    return {
      name: requiredWorkflowString(current, "Workflow definition name"),
    };
  }
  return {
    name: requiredWorkflowString(descriptor.name, "Workflow definition name"),
    artifact: requiredWorkflowString(descriptor.artifact, "Workflow definition artifact"),
  };
}

function requiredWorkflowString(value: unknown, name: string): string {
  if (dataKind(value) !== "string" || (value as string).length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value as string;
}

function createWorkflowScheduleRuntime<Model extends WorkflowModelDefinition>(): DefinedActor<
  WorkflowScheduleRuntime<Model>
> {
  const methods = createWorkflowScheduleRuntimeMethods<Model>();
  const workflowName = () => typeLiteral<Model["Name"]>();
  return createActorFactory<WorkflowScheduleRuntime<Model>>(
    {
      state: () => ({
        status: "deleted",
        revision: 0,
        pending: [],
        active: [],
        recent: [],
        inspecting: [],
      }),
      methods,
    } as unknown as Actor.Definition<WorkflowScheduleRuntime<Model>>,
    () => typeLiteral<`${Model["Name"]}:workflow-schedule`>(),
    () => ({
      $create: "write",
      $update: "write",
      $pause: "write",
      $resume: "write",
      $trigger: "write",
      $backfill: "write",
      $delete: "write",
      $tick: "write",
      $poll: "write",
      $completeCalendar: "write",
      $completeStart: "write",
      $completeInspect: "write",
      $completeClose: "write",
      describe: "read",
    }),
    () => ({}),
    () => 1,
    () => ({
      calendar({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: string;
        id: string;
        generation: number;
        input: object;
      }>) {
        return {
          dependency: workflowName(),
          operation: "$scheduleCalendar",
          input: { id: key, outbound: id, generation, input },
        };
      },
      start({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: string;
        id: string;
        generation: number;
        input: object;
      }>) {
        return {
          dependency: workflowName(),
          operation: "$scheduleStart",
          input: { id: key, outbound: id, generation, input },
        };
      },
      inspect({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: string;
        id: string;
        generation: number;
        input: object;
      }>) {
        return {
          dependency: workflowName(),
          operation: "$scheduleInspect",
          input: { id: key, outbound: id, generation, input },
        };
      },
      cancel({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: string;
        id: string;
        generation: number;
        input: object;
      }>) {
        return {
          dependency: workflowName(),
          operation: "$scheduleClose",
          input: { id: key, outbound: id, generation, operation: "cancel", input },
        };
      },
      terminate({
        key,
        id,
        generation,
        input,
      }: Readonly<{
        key: string;
        id: string;
        generation: number;
        input: object;
      }>) {
        return {
          dependency: workflowName(),
          operation: "$scheduleClose",
          input: { id: key, outbound: id, generation, operation: "terminate", input },
        };
      },
    }),
  );
}

function createWorkflowScheduleRuntimeMethods<
  Model extends WorkflowModelDefinition,
>(): Actor.Definition<WorkflowScheduleRuntime<Model>>["methods"] {
  const methods: Record<string, CallableFunction> = {};
  methods.$create = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const request = context.input as Readonly<{
      definition: WorkflowScheduleDefinition<Model>;
      seed: WorkflowScheduleSeed;
      paused: boolean;
      trigger: boolean;
      note?: string;
      remaining?: number;
    }>;
    if (context.state.status !== "deleted" && context.state.definition !== undefined) {
      return workflowScheduleMutation(context, "existing");
    }
    configureWorkflowSchedule(
      context,
      methods,
      request.definition,
      request.seed,
      request.paused ? "paused" : "active",
      request.note,
      request.remaining,
    );
    if (request.trigger) {
      enqueueWorkflowScheduleOccurrence(
        context,
        workflowScheduleOccurrence(
          context.key,
          context.invocation.at,
          undefined,
          "trigger",
          request.definition,
          context.invocation.id,
        ),
      );
      coordinateWorkflowSchedule(context, methods);
    }
    return workflowScheduleMutation(context, "created");
  };
  methods.$update = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const request = context.input as Readonly<{
      definition: WorkflowScheduleDefinition<Model>;
      seed: WorkflowScheduleSeed;
      note?: string;
      remaining?: number;
    }>;
    if (context.state.status === "deleted" || context.state.definition === undefined) {
      return workflowScheduleMutation(context, "missing");
    }
    configureWorkflowSchedule(
      context,
      methods,
      request.definition,
      request.seed,
      context.state.status,
      request.note ?? context.state.note,
      request.remaining ?? context.state.remaining,
    );
    return workflowScheduleMutation(context, "updated");
  };
  methods.$pause = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (context.state.status === "deleted") {
      return workflowScheduleMutation(context, "missing");
    }
    context.state.status = "paused";
    context.state.revision += 1;
    const request = context.input as Readonly<{ note?: string }>;
    if (request.note !== undefined) context.state.note = request.note;
    context.state.next = undefined;
    context.state.following = undefined;
    context.reminders.cancel({ id: workflowScheduleNextReminder() });
    context.reminders.cancel({ id: workflowSchedulePollReminder() });
    context.outbox.cancel({ id: workflowScheduleCalendarOutbound() });
    return workflowScheduleMutation(context, "paused");
  };
  methods.$resume = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (context.state.status === "deleted" || context.state.definition === undefined) {
      return workflowScheduleMutation(context, "missing");
    }
    const request = context.input as Readonly<{ seed: WorkflowScheduleSeed; note?: string }>;
    context.state.status = "active";
    context.state.revision += 1;
    if (request.note !== undefined) context.state.note = request.note;
    setWorkflowScheduleSeed(context, methods, request.seed);
    coordinateWorkflowSchedule(context, methods);
    return workflowScheduleMutation(context, "resumed");
  };
  methods.$trigger = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (context.state.status === "deleted" || context.state.definition === undefined) {
      return { status: "missing" };
    }
    const request = context.input as Readonly<{ overlap?: WorkflowScheduleOverlap }>;
    const occurrence = workflowScheduleOccurrence(
      context.key,
      context.invocation.at,
      undefined,
      "trigger",
      context.state.definition,
      context.invocation.id,
      request.overlap,
    );
    enqueueWorkflowScheduleOccurrence(context, occurrence);
    coordinateWorkflowSchedule(context, methods);
    return { status: "triggered", occurrence: occurrence.id };
  };
  methods.$backfill = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (context.state.status === "deleted" || context.state.definition === undefined) {
      return { status: "missing", occurrences: 0 };
    }
    const input = context.input as Readonly<{
      occurrences: readonly number[];
      overlap?: WorkflowScheduleOverlap;
    }>;
    let accepted = 0;
    for (const nominal of input.occurrences) {
      const occurrence = workflowScheduleOccurrence(
        context.key,
        nominal,
        undefined,
        "backfill",
        context.state.definition,
        undefined,
        input.overlap,
      );
      if (enqueueWorkflowScheduleOccurrence(context, occurrence)) accepted += 1;
    }
    coordinateWorkflowSchedule(context, methods);
    return { status: "accepted", occurrences: accepted };
  };
  methods.$delete = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (context.state.status === "deleted") {
      return workflowScheduleMutation(context, "missing");
    }
    clearWorkflowScheduleCoordination(context);
    for (const execution of context.state.active) {
      context.outbox.cancel({
        id: workflowScheduleStartOutbound(execution.occurrence.id),
      });
      context.outbox.cancel({
        id: workflowScheduleCloseOutbound(execution.execution),
      });
    }
    context.state.status = "deleted";
    context.state.revision += 1;
    context.state.definition = undefined;
    context.state.note = undefined;
    context.state.remaining = undefined;
    context.state.next = undefined;
    context.state.following = undefined;
    context.state.pending = [];
    context.state.active = [];
    return workflowScheduleMutation(context, "deleted");
  };
  methods.$tick = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const input = context.input as Readonly<{ occurrence: WorkflowScheduleOccurrence }>;
    if (
      context.state.status !== "active" ||
      context.state.definition === undefined ||
      context.state.next?.id !== input.occurrence.id
    ) {
      return describeWorkflowSchedule(context.key, context.state);
    }
    context.state.next = undefined;
    advanceWorkflowSchedule(context, methods, input.occurrence.nominal);
    const catchUp = context.state.definition.catchUp ?? 60_000;
    if (context.invocation.at - input.occurrence.at > catchUp) {
      recordWorkflowScheduleRecent(context.state, {
        occurrence: input.occurrence,
        status: "skipped",
      });
    } else {
      enqueueWorkflowScheduleOccurrence(context, input.occurrence);
    }
    coordinateWorkflowSchedule(context, methods);
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.$poll = (context: RuntimeWorkflowScheduleContext<Model>) => {
    if (
      context.state.status !== "deleted" &&
      context.state.pending.length > 0 &&
      context.state.active.length > 0
    ) {
      inspectWorkflowScheduleExecutions(context, methods);
    }
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.$completeCalendar = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const completion = context.input as Readonly<{
      request: Readonly<{ after: number; revision: number }>;
      delivery: Omit<ActorOutboundDelivery, "output"> &
        Readonly<{ output: Readonly<{ seed: WorkflowScheduleSeed }> }>;
    }>;
    if (
      context.state.status !== "active" ||
      context.state.definition === undefined ||
      completion.request.revision !== context.state.revision
    ) {
      return describeWorkflowSchedule(context.key, context.state);
    }
    setWorkflowScheduleSeed(context, methods, completion.delivery.output.seed);
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.$completeStart = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const completion = context.input as Readonly<{
      request: Readonly<{
        occurrence: WorkflowScheduleOccurrence;
        execution: Model["Id"];
      }>;
      delivery: Omit<ActorOutboundDelivery, "output"> &
        Readonly<{
          output: Actor.Outcome<WorkflowStartResult, object> | Actor.Invocation;
        }>;
    }>;
    const active = context.state.active.find(
      ({ execution }) => execution === completion.request.execution,
    );
    const output = completion.delivery.output;
    const accepted = (output as Partial<Actor.Invocation>).id;
    if (active === undefined) return describeWorkflowSchedule(context.key, context.state);
    if (accepted !== undefined) {
      active.status = "running";
    } else if ((output as Actor.Outcome<WorkflowStartResult, object>).status === "succeeded") {
      const result = (output as Readonly<{ status: "succeeded"; value: WorkflowStartResult }>)
        .value;
      active.status =
        result.status === "existing" || result.status === "conflict" ? result.lifecycle : "running";
      if (result.status === "conflict") {
        recordWorkflowScheduleRecent(context.state, {
          occurrence: completion.request.occurrence,
          status: "failed",
          execution: completion.request.execution,
        });
      } else {
        recordWorkflowScheduleRecent(context.state, {
          occurrence: completion.request.occurrence,
          status: "started",
          execution: completion.request.execution,
        });
      }
    } else {
      active.status = "failed";
      recordWorkflowScheduleRecent(context.state, {
        occurrence: completion.request.occurrence,
        status: "failed",
        execution: completion.request.execution,
      });
    }
    if (terminalWorkflowStatus(active.status)) {
      context.state.active = context.state.active.filter(
        ({ execution }) => execution !== active.execution,
      );
    }
    coordinateWorkflowSchedule(context, methods);
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.$completeInspect = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const completion = context.input as Readonly<{
      request: Readonly<{ execution: Model["Id"] }>;
      delivery: Omit<ActorOutboundDelivery, "output"> &
        Readonly<{ output: WorkflowDescription<Model> }>;
    }>;
    const active = context.state.active.find(
      ({ execution }) => execution === completion.request.execution,
    );
    if (active !== undefined) active.status = completion.delivery.output.status;
    context.state.inspecting = context.state.inspecting.filter(
      (execution) => execution !== completion.request.execution,
    );
    if (active?.status === "failed" && context.state.definition?.pauseOnFailure === true) {
      context.state.status = "paused";
      context.state.note = "Paused after a scheduled Workflow failed.";
      context.state.next = undefined;
      context.state.following = undefined;
      context.state.pending = [];
      context.reminders.cancel({ id: workflowScheduleNextReminder() });
      context.outbox.cancel({ id: workflowScheduleCalendarOutbound() });
    }
    context.state.active = context.state.active.filter(
      ({ status }) => !terminalWorkflowStatus(status),
    );
    if (context.state.inspecting.length === 0) {
      decideWorkflowScheduleOverlap(context, methods);
    }
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.$completeClose = (context: RuntimeWorkflowScheduleContext<Model>) => {
    const completion = context.input as Readonly<{
      request: Readonly<{
        execution: Model["Id"];
        operation: "cancel" | "terminate";
      }>;
      delivery: Omit<ActorOutboundDelivery, "output"> &
        Readonly<{
          output: Actor.Outcome<Readonly<{ status: WorkflowStatus }>, object> | Actor.Invocation;
        }>;
    }>;
    const active = context.state.active.find(
      ({ execution }) => execution === completion.request.execution,
    );
    const output = completion.delivery.output;
    const accepted = (output as Partial<Actor.Invocation>).id;
    if (active !== undefined && accepted === undefined) {
      const completed = output as Actor.Outcome<Readonly<{ status: WorkflowStatus }>, object>;
      active.status = completed.status === "succeeded" ? completed.value.status : "failed";
    }
    context.state.active = context.state.active.filter(
      ({ status }) => !terminalWorkflowStatus(status),
    );
    if (context.state.active.length === 0) {
      context.state.closing = undefined;
      coordinateWorkflowSchedule(context, methods);
    } else {
      scheduleWorkflowSchedulePoll(context, methods);
    }
    return describeWorkflowSchedule(context.key, context.state);
  };
  methods.describe = (
    context: Readonly<{
      key: string;
      state: Readonly<WorkflowScheduleRuntimeState<Model>>;
    }>,
  ) => describeWorkflowSchedule(context.key, context.state);
  return methods as Actor.Definition<WorkflowScheduleRuntime<Model>>["methods"];
}

function configureWorkflowSchedule<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  definition: WorkflowScheduleDefinition<Model>,
  seed: WorkflowScheduleSeed,
  status: Exclude<WorkflowScheduleStatus, "deleted">,
  note: string | undefined,
  remaining: number | undefined,
): void {
  clearWorkflowScheduleCoordination(context);
  context.state.status = status;
  context.state.revision += 1;
  context.state.note = note;
  context.state.remaining = remaining;
  context.state.definition = cloneWorkflowData(definition) as WorkflowScheduleDefinition<Model>;
  context.state.next = undefined;
  context.state.following = undefined;
  context.state.pending = [];
  setWorkflowScheduleSeed(context, methods, seed);
}

function clearWorkflowScheduleCoordination<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
): void {
  context.reminders.cancel({ id: workflowScheduleNextReminder() });
  context.reminders.cancel({ id: workflowSchedulePollReminder() });
  context.outbox.cancel({ id: workflowScheduleCalendarOutbound() });
  for (const execution of context.state.inspecting) {
    context.outbox.cancel({ id: workflowScheduleInspectOutbound(execution) });
  }
  context.state.inspecting = [];
  context.state.closing = undefined;
}

function setWorkflowScheduleSeed<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  seed: WorkflowScheduleSeed,
): void {
  context.state.next = undefined;
  context.state.following = seed.following;
  if (
    seed.next === undefined ||
    context.state.definition === undefined ||
    context.state.remaining === 0
  ) {
    return;
  }
  setWorkflowScheduleNext(
    context,
    methods,
    workflowScheduleOccurrence(
      context.key,
      seed.next,
      seed.following,
      "schedule",
      context.state.definition,
    ),
  );
}

function setWorkflowScheduleNext<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  occurrence: WorkflowScheduleOccurrence,
): void {
  if (context.state.status !== "active") return;
  context.state.next = occurrence;
  context.reminders.schedule({
    id: workflowScheduleNextReminder(),
    at: occurrence.at,
    method: methods.$tick as CallableFunction,
    input: { occurrence },
  });
}

function advanceWorkflowSchedule<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  after: number,
): void {
  const definition = context.state.definition;
  if (definition === undefined || context.state.remaining === 0) return;
  const interval = workflowScheduleIntervalTiming(definition.timing);
  if (interval !== undefined) {
    const next = nextWorkflowScheduleInterval(interval, definition, after);
    if (next === undefined) return;
    const following = nextWorkflowScheduleInterval(interval, definition, next);
    context.state.following = following;
    setWorkflowScheduleNext(
      context,
      methods,
      workflowScheduleOccurrence(context.key, next, following, "schedule", definition),
    );
    return;
  }
  context.state.following = undefined;
  requestWorkflowScheduleCalendar(context, methods, after);
}

function requestWorkflowScheduleCalendar<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  after: number,
): void {
  const definition = context.state.definition;
  if (definition === undefined || workflowScheduleIntervalTiming(definition.timing) !== undefined) {
    return;
  }
  context.outbox.schedule({
    id: workflowScheduleCalendarOutbound(),
    at: context.invocation.at,
    operation: "calendar",
    input: { definition, after },
    complete: methods.$completeCalendar as CallableFunction,
    completion: { after, revision: context.state.revision },
  });
}

function enqueueWorkflowScheduleOccurrence<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  occurrence: WorkflowScheduleOccurrence,
): boolean {
  if (
    (context.state.next !== undefined &&
      sameWorkflowScheduleOccurrence(context.state.next, occurrence)) ||
    context.state.pending.some((pending) => sameWorkflowScheduleOccurrence(pending, occurrence)) ||
    context.state.active.some(({ occurrence: active }) =>
      sameWorkflowScheduleOccurrence(active, occurrence),
    ) ||
    context.state.recent.some(({ occurrence: recent }) =>
      sameWorkflowScheduleOccurrence(recent, occurrence),
    )
  ) {
    return false;
  }
  context.state.pending.push(occurrence);
  context.state.pending.sort((left, right) =>
    left.nominal < right.nominal ? -1 : left.nominal > right.nominal ? 1 : 0,
  );
  return true;
}

function sameWorkflowScheduleOccurrence(
  left: WorkflowScheduleOccurrence,
  right: WorkflowScheduleOccurrence,
): boolean {
  return (
    left.id === right.id ||
    (left.source !== "trigger" && right.source !== "trigger" && left.nominal === right.nominal)
  );
}

function coordinateWorkflowSchedule<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
): void {
  if (context.state.remaining === 0) {
    context.state.pending = context.state.pending.filter(({ source }) => source !== "schedule");
  }
  if (
    context.state.status === "deleted" ||
    context.state.pending.length === 0 ||
    context.state.inspecting.length > 0 ||
    context.state.closing !== undefined
  ) {
    return;
  }
  const overlap = workflowScheduleOccurrenceOverlap(context.state);
  if (context.state.active.length === 0) {
    launchWorkflowSchedulePending(context, methods, overlap === "concurrent");
    return;
  }
  if (overlap === "concurrent") {
    launchWorkflowSchedulePending(context, methods, true);
    return;
  }
  inspectWorkflowScheduleExecutions(context, methods);
}

function inspectWorkflowScheduleExecutions<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
): void {
  if (context.state.active.length === 0 || context.state.inspecting.length > 0) return;
  context.state.inspecting = context.state.active.map(({ execution }) => execution);
  for (const execution of context.state.active) {
    context.outbox.schedule({
      id: workflowScheduleInspectOutbound(execution.execution),
      at: context.invocation.at,
      operation: "inspect",
      input: { execution: execution.execution },
      complete: methods.$completeInspect as CallableFunction,
      completion: { execution: execution.execution },
    });
  }
}

function decideWorkflowScheduleOverlap<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
): void {
  if (context.state.status === "deleted" || context.state.pending.length === 0) return;
  const overlap = workflowScheduleOccurrenceOverlap(context.state);
  if (context.state.active.length === 0) {
    launchWorkflowSchedulePending(context, methods, overlap === "concurrent");
    return;
  }
  if (overlap === "skip") {
    const occurrence = context.state.pending[0];
    if (occurrence !== undefined) {
      recordWorkflowScheduleRecent(context.state, { occurrence, status: "skipped" });
      context.state.pending = context.state.pending.slice(1);
      if (context.state.pending.length > 0) scheduleWorkflowSchedulePoll(context, methods);
    }
    return;
  }
  if (overlap === "buffer-one") {
    const first = context.state.pending[0];
    context.state.pending = context.state.pending.filter(
      (occurrence) =>
        occurrence.id === first?.id ||
        workflowScheduleOccurrenceOverlap(context.state, occurrence) !== "buffer-one" ||
        workflowScheduleOccurrenceOverlap(context.state, first) !== "buffer-one",
    );
    scheduleWorkflowSchedulePoll(context, methods);
    return;
  }
  if (overlap === "buffer-all") {
    scheduleWorkflowSchedulePoll(context, methods);
    return;
  }
  if (overlap === "concurrent") {
    launchWorkflowSchedulePending(context, methods, true);
    return;
  }
  closeWorkflowScheduleExecutions(
    context,
    methods,
    overlap === "cancel-current" ? "cancel" : "terminate",
  );
}

function launchWorkflowSchedulePending<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  all: boolean,
): void {
  const definition = context.state.definition;
  if (definition === undefined) return;
  const overlap = workflowScheduleOccurrenceOverlap(context.state);
  const occurrences = all
    ? context.state.pending.filter(
        (occurrence) => workflowScheduleOccurrenceOverlap(context.state, occurrence) === overlap,
      )
    : context.state.pending.slice(0, 1);
  const identities = occurrences.map(({ id }) => id);
  context.state.pending = context.state.pending.filter(
    (occurrence) => !identities.some((identity) => identity === occurrence.id),
  );
  for (const occurrence of occurrences) {
    if (occurrence.source === "schedule" && context.state.remaining !== undefined) {
      context.state.remaining -= 1;
      if (context.state.remaining === 0) stopWorkflowScheduleTiming(context);
    }
    const execution = workflowScheduleExecution<Model>(context.key, occurrence);
    context.state.active.push({
      occurrence,
      execution,
      status: "running",
    });
    context.outbox.schedule({
      id: workflowScheduleStartOutbound(occurrence.id),
      at: context.invocation.at,
      operation: "start",
      input: {
        occurrence,
        execution,
        workflowInput: cloneWorkflowData(definition.input),
      },
      complete: methods.$completeStart as CallableFunction,
      completion: { occurrence, execution },
    });
  }
  if (context.state.pending.length > 0) scheduleWorkflowSchedulePoll(context, methods);
}

function workflowScheduleOccurrenceOverlap<Model extends WorkflowModelDefinition>(
  state: Readonly<WorkflowScheduleRuntimeState<Model>>,
  occurrence: WorkflowScheduleOccurrence | undefined = state.pending[0],
): WorkflowScheduleOverlap {
  return occurrence?.overlap ?? state.definition?.overlap ?? "skip";
}

function stopWorkflowScheduleTiming<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
): void {
  context.state.next = undefined;
  context.state.following = undefined;
  context.reminders.cancel({ id: workflowScheduleNextReminder() });
  context.outbox.cancel({ id: workflowScheduleCalendarOutbound() });
}

function closeWorkflowScheduleExecutions<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  operation: "cancel" | "terminate",
): void {
  if (context.state.active.length === 0) {
    coordinateWorkflowSchedule(context, methods);
    return;
  }
  context.state.closing = operation;
  for (const execution of context.state.active) {
    context.outbox.schedule({
      id: workflowScheduleCloseOutbound(execution.execution),
      at: context.invocation.at,
      operation,
      input: {
        execution: execution.execution,
        occurrence: execution.occurrence.id,
      },
      complete: methods.$completeClose as CallableFunction,
      completion: {
        execution: execution.execution,
        operation,
      },
    });
  }
}

function scheduleWorkflowSchedulePoll<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowScheduleContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
): void {
  context.reminders.schedule({
    id: workflowSchedulePollReminder(),
    at: context.invocation.at + 1_000,
    method: methods.$poll as CallableFunction,
    input: {},
  });
}

function workflowScheduleMutation<Model extends WorkflowModelDefinition>(
  context: Readonly<{
    key: string;
    state: Readonly<WorkflowScheduleRuntimeState<Model>>;
  }>,
  status: WorkflowScheduleMutation<Model>["status"],
): WorkflowScheduleMutation<Model> {
  return {
    status,
    schedule: describeWorkflowSchedule(context.key, context.state),
  };
}

function describeWorkflowSchedule<Model extends WorkflowModelDefinition>(
  id: string,
  state: Readonly<WorkflowScheduleRuntimeState<Model>>,
): WorkflowScheduleDescription<Model> {
  return {
    id,
    status: state.status,
    revision: state.revision,
    ...(state.note === undefined ? {} : { note: state.note }),
    ...(state.remaining === undefined ? {} : { remaining: state.remaining }),
    ...(state.definition === undefined
      ? {}
      : {
          definition: cloneWorkflowData(state.definition) as WorkflowScheduleDefinition<Model>,
        }),
    ...(state.next === undefined ? {} : { next: { ...state.next } }),
    active: state.active.map((execution) => ({
      ...execution,
      occurrence: execution.occurrence.id,
    })),
    buffered: state.pending.length,
    recent: state.recent.map((event) => ({
      ...event,
      occurrence: { ...event.occurrence },
    })),
  };
}

function recordWorkflowScheduleRecent<Model extends WorkflowModelDefinition>(
  state: WorkflowScheduleRuntimeState<Model>,
  event: WorkflowScheduleRecent<Model>,
): void {
  state.recent.push(event);
  if (state.recent.length > 256) state.recent = state.recent.slice(state.recent.length - 256);
}

function workflowScheduleOccurrence<Model extends WorkflowModelDefinition>(
  schedule: string,
  nominal: number,
  following: number | undefined,
  source: WorkflowScheduleOccurrence["source"],
  definition: WorkflowScheduleDefinition<Model>,
  identity?: string,
  overlap?: WorkflowScheduleOverlap,
): WorkflowScheduleOccurrence {
  const requestedJitter = source === "trigger" ? 0 : (definition.jitter ?? 0);
  const availableJitter = following === undefined ? requestedJitter : following - nominal - 1;
  const maximumJitter = requestedJitter < availableJitter ? requestedJitter : availableJitter;
  const jitter = deterministicWorkflowScheduleJitter(
    nominal + schedule.length * 1_000_003 + (identity?.length ?? 0),
    maximumJitter < 0 ? 0 : maximumJitter,
  );
  return {
    id:
      source === "trigger"
        ? `trigger:${schedule.length}:${schedule}:${identity}`
        : `${source}:${schedule.length}:${schedule}:${nominal}`,
    nominal,
    at: nominal + jitter,
    source,
    ...(overlap === undefined ? {} : { overlap }),
  };
}

function deterministicWorkflowScheduleJitter(seed: number, maximum: number): number {
  if (maximum <= 0) return 0;
  let hash = seed % 2_147_483_647;
  if (hash < 0) hash += 2_147_483_647;
  hash = (hash * 48_271) % 2_147_483_647;
  return hash % (maximum + 1);
}

function workflowScheduleExecution<Model extends WorkflowModelDefinition>(
  schedule: string,
  occurrence: WorkflowScheduleOccurrence,
): Model["Id"] {
  return `${workflowScheduleExecutionPrefix(schedule)}${occurrence.id}` as Model["Id"];
}

function workflowScheduleExecutionPrefix(schedule: string): string {
  return `workflow-schedule:${schedule.length}:${schedule}:`;
}

function workflowScheduleNextReminder(): string {
  return "next";
}

function workflowSchedulePollReminder(): string {
  return "poll";
}

function workflowScheduleCalendarOutbound(): string {
  return "calendar";
}

function workflowScheduleStartOutbound(occurrence: string): string {
  return `start:${occurrence.length}:${occurrence}`;
}

function workflowScheduleInspectOutbound(execution: string): string {
  return `inspect:${execution.length}:${execution}`;
}

function workflowScheduleCloseOutbound(execution: string): string {
  return `close:${execution.length}:${execution}`;
}

function createWorkflowRuntimeMethods<Model extends WorkflowModelDefinition>(): Actor.Definition<
  WorkflowRuntime<Model>
>["methods"] {
  const methods: Record<string, CallableFunction> = {};
  methods.$start = async (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as StartInput<Model> & Readonly<{ artifact?: object }>;
    const artifact = workflowArtifact(request.artifact ?? context.factory.artifact);
    requireWorkflowValue(
      context,
      request.input,
      artifact.definition.contract.input,
      "Workflow Input",
    );
    if (context.state.status === "idle") {
      initializeWorkflowRun(context, methods, request.input, request.artifact);
      return { status: "started", run: context.state.run };
    }
    if (activeWorkflowStatus(context.state.status)) {
      const conflict = request.conflict ?? "reject";
      if (conflict === "use") {
        return {
          status: "existing",
          run: context.state.run,
          lifecycle: context.state.status,
        };
      }
      if (conflict === "reject") {
        return {
          status: "conflict",
          run: context.state.run,
          lifecycle: context.state.status,
        };
      }
      cancelWorkflowWork(context, methods, "terminate");
      archiveWorkflowRun(context, "terminated");
      initializeWorkflowRun(context, methods, request.input, request.artifact);
      return { status: "started", run: context.state.run };
    }
    const reuse = request.reuse ?? "reject";
    const reusable =
      reuse === "allow" || (reuse === "failed" && context.state.status !== "succeeded");
    if (!reusable) {
      return {
        status: "conflict",
        run: context.state.run,
        lifecycle: context.state.status,
      };
    }
    archiveWorkflowRun(
      context,
      context.state.status as Exclude<WorkflowStatus, "idle" | "running" | "paused" | "cancelling">,
    );
    initializeWorkflowRun(context, methods, request.input, request.artifact);
    return { status: "started", run: context.state.run };
  };
  methods.$action = async (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{ name: string; input?: object }>;
    if (
      context.state.state === undefined ||
      (context.state.status !== "running" && context.state.status !== "paused")
    ) {
      context.fail({
        type: "unavailable",
        data: { status: context.state.status },
      });
    }
    const stateBeforeAction = cloneWorkflowData(context.state.state);
    const executionBeforeAction = cloneWorkflowData(context.state.execution);
    try {
      const selectedActionArtifact = workflowArtifact(context.factory.artifact);
      const pinnedActionArtifact =
        context.state.artifact === undefined ? undefined : workflowArtifact(context.state.artifact);
      if (
        pinnedActionArtifact === undefined ||
        pinnedActionArtifact.definition.contract.revision !== context.state.definition
      ) {
        throw workflowNondeterminism("Workflow Action has no valid pinned definition artifact.");
      }
      const actionContract = pinnedActionArtifact.definition.contract.actions[request.name];
      if (actionContract === undefined) {
        context.fail({
          type: "unavailable",
          data: { status: context.state.status },
        });
      }
      requireWorkflowValue(
        context,
        request.input,
        actionContract.input,
        `Workflow Action ${JSON.stringify(request.name)} input`,
      );
      let result: object;
      if (pinnedActionArtifact.id === selectedActionArtifact.id) {
        const action = (
          context.factory.actions as Readonly<
            Record<
              string,
              (input: WorkflowActionContext<Model, WorkflowActionDefinition>) => object
            >
          >
        )[request.name];
        if (action === undefined) {
          context.fail({
            type: "unavailable",
            data: { status: context.state.status },
          });
        }
        result = action({
          id: context.key,
          state: context.state.state,
          input: request.input,
          invocation: context.invocation,
          fail(failure): never {
            throw new WorkflowCommandFailure(failure);
          },
        } as WorkflowActionContext<Model, WorkflowActionDefinition>);
      } else {
        const actionProcedure = pinnedActionArtifact.executable.actionHandlers[request.name];
        if (actionProcedure === undefined) {
          context.fail({
            type: "unavailable",
            data: { status: context.state.status },
          });
        }
        const actionExecution = context.factory.interpretProcedure(actionProcedure, {
          definition: context.state.definition,
          identity: cloneWorkflowData(context.key),
          invocation: cloneWorkflowData(context.invocation),
          input: cloneWorkflowData(request.input),
          state: cloneWorkflowData(context.state.state),
          time: context.state.time,
        }) as WorkflowExecutionFrame;
        context.state.state = cloneWorkflowData(actionExecution.state) as Model["State"];
        if (actionExecution.status === "failed") {
          context.state.state = stateBeforeAction;
          context.state.execution = executionBeforeAction;
          return {
            outcome: {
              status: "failed",
              failure: workflowFrameFailure<Model>(actionExecution.failure),
            },
          };
        }
        if (actionExecution.status !== "succeeded" || actionExecution.result === undefined) {
          throw workflowNondeterminism(
            `Retained Workflow Action ${request.name} did not complete synchronously.`,
          );
        }
        result = cloneWorkflowData(actionExecution.result) as object;
      }
      assertWorkflowValue(
        context.state.state,
        pinnedActionArtifact.definition.contract.state,
        `Workflow Action ${JSON.stringify(request.name)} State`,
      );
      assertWorkflowValue(
        result,
        actionContract.result,
        `Workflow Action ${JSON.stringify(request.name)} result`,
      );
      recordWorkflowReplayStep(context, {
        kind: "action",
        action: request.name,
        ...(request.input === undefined ? {} : { input: cloneWorkflowData(request.input) }),
        invocation: cloneWorkflowData(context.invocation),
        time: context.state.time,
        state: cloneWorkflowData(context.state.state),
        result: cloneWorkflowData(result),
      });
      context.state.history.push({
        type: "action",
        action: request.name,
        invocation: context.invocation.id,
        state: cloneWorkflowData(context.state.state),
      });
      synchronizeWorkflowExecutionState(context);
      recordWorkflowChange(context);
      if (context.state.status === "running") scheduleWorkflowAdvance(context, methods);
      return { outcome: { status: "succeeded", value: result } };
    } catch (error) {
      if (error instanceof WorkflowCommandFailure) {
        context.state.state = stateBeforeAction;
        context.state.execution = executionBeforeAction;
        return { outcome: { status: "failed", failure: error.failure } };
      }
      throw error;
    }
  };
  methods.$advance = async (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{ run: number }>;
    if (
      request.run !== context.state.run ||
      (context.state.status !== "running" && context.state.status !== "cancelling") ||
      context.state.execution === undefined
    ) {
      return { status: context.state.status };
    }
    const selectedArtifact = workflowArtifact(context.factory.artifact);
    const pinnedArtifact =
      context.state.artifact === undefined ? undefined : workflowArtifact(context.state.artifact);
    if (
      pinnedArtifact === undefined ||
      context.state.definition !== pinnedArtifact.definition.contract.revision ||
      pinnedArtifact.executable.revision !== context.state.definition
    ) {
      context.state.failure = {
        type: "nondeterministic",
        data: {
          reason:
            `Workflow run ${context.state.run} is pinned to definition ` +
            `${context.state.definition} (${pinnedArtifact?.id ?? "missing artifact"}), ` +
            "but its retained artifact is missing or inconsistent.",
        },
      };
      context.state.status = "failed";
      recordWorkflowChange(context);
      return { status: context.state.status };
    }
    try {
      const current = cloneWorkflowData(context.state.execution) as WorkflowExecutionFrame;
      current.history = {
        events: context.state.history.length,
        continueSuggested: context.state.history.length >= workflowHistorySuggestion,
      };
      const execution =
        pinnedArtifact.id === selectedArtifact.id
          ? (context.factory.advance(current) as WorkflowExecutionFrame)
          : (context.factory.interpret(
              pinnedArtifact.executable,
              current,
            ) as WorkflowExecutionFrame);
      recordWorkflowReplayStep(context, {
        kind: "advance",
        history: cloneWorkflowData(current.history),
      });
      if (
        context.state.history.length >= workflowHistoryMaximum &&
        execution.status === "suspended"
      ) {
        context.state.failure = {
          type: "execution",
          data: {
            name: "WorkflowHistoryLimit",
            message:
              `Workflow run ${context.state.run} reached ${workflowHistoryMaximum} history events ` +
              "without continuing as new.",
          },
        };
        context.state.status = "failed";
        recordWorkflowChange(context);
        return { status: context.state.status };
      }
      applyWorkflowExecutionFrame(context, methods, execution);
    } catch (error) {
      if (error instanceof WorkflowCommandFailure) {
        context.state.failure = error.failure as FailureOf<Model["Failures"]>;
        context.state.status = "failed";
      } else if (error instanceof WorkflowNondeterminismError) {
        context.state.failure = error.failure;
        context.state.status = "failed";
      } else {
        context.state.failure = workflowExecutionFailure(error);
        context.state.status = "failed";
      }
      recordWorkflowChange(context);
    }
    return { status: context.state.status };
  };
  methods.$effect = (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{ run: number; sequence: number }>;
    if (
      context.state.status !== "running" &&
      context.state.status !== "paused" &&
      (context.state.status !== "cancelling" ||
        workflowPendingEffectCancellable(context, request.sequence))
    ) {
      return { status: context.state.status };
    }
    if (request.run !== context.state.run) return { status: context.state.status };
    const sequence = request.sequence;
    const requested = context.state.history.find(
      (event) => event.type === "effect-requested" && event.sequence === sequence,
    );
    if (requested?.type !== "effect-requested") {
      throw workflowNondeterminism(`Effect ${sequence} has no durable request.`);
    }
    if (workflowEffectSettled(context, sequence)) return { status: context.state.status };
    const started = context.state.history.filter(
      (event) => event.type === "effect-attempt-started" && event.sequence === sequence,
    );
    const latest = started[started.length - 1];
    if (
      latest?.type === "effect-attempt-started" &&
      !workflowEffectAttemptSettled(context, sequence, latest.attempt)
    ) {
      return { status: context.state.status };
    }
    const attempt = started.length + 1;
    const deadline = workflowEffectDeadline(requested, context.invocation.at);
    if (deadline !== undefined && deadline <= context.invocation.at) {
      settleWorkflowEffectFailure(context, methods, requested, attempt, context.invocation.at, {
        name: "WorkflowEffectTimeout",
        message: `Workflow effect ${requested.effect} exceeded its total deadline.`,
      });
      return { status: context.state.status };
    }
    const until = workflowEffectClaimUntil(requested, context.invocation.at, deadline);
    context.state.history.push({
      type: "effect-attempt-started",
      sequence,
      attempt,
      at: context.invocation.at,
      ...(until === undefined ? {} : { until }),
    });
    if (until !== undefined) {
      scheduleWorkflowEffectTimeout(context, methods, sequence, attempt, until);
    }
    const complete = methods.$completeEffect;
    if (complete === undefined) {
      throw new Error("Workflow effect completion method is unavailable.");
    }
    context.outbox.schedule({
      id: workflowEffectOutboundId(context.state.run, sequence, attempt),
      at: context.invocation.at,
      operation: "effect",
      input: { run: context.state.run, sequence, attempt },
      complete,
      completion: { run: context.state.run, sequence, attempt },
    });
    return { status: context.state.status };
  };
  methods.$effectDispatch = (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{
      run: number;
      sequence: number;
      attempt: number;
      at: number;
    }>;
    if (
      request.run !== context.state.run ||
      (context.state.status !== "running" &&
        context.state.status !== "paused" &&
        context.state.status !== "cancelling")
    ) {
      return { status: "settled" };
    }
    const requested = workflowEffectRequest(context, request.sequence);
    if (
      context.state.status === "cancelling" &&
      workflowPendingEffectCancellable(context, request.sequence) &&
      requested.options?.cancellation !== "wait"
    ) {
      return { status: "settled" };
    }
    if (workflowEffectSettled(context, request.sequence)) return { status: "settled" };
    const started = workflowEffectAttempt(context, request.sequence, request.attempt);
    if (
      started === undefined ||
      workflowEffectAttemptSettled(context, request.sequence, request.attempt)
    ) {
      return { status: "settled" };
    }
    const leaseUntil = workflowEffectLeaseUntil(context, requested, started);
    const deadline = workflowEffectDeadline(requested, started.at);
    if (
      (leaseUntil !== undefined && leaseUntil <= request.at) ||
      (deadline !== undefined && deadline <= request.at)
    ) {
      return {
        status: "expired",
        failure: {
          name: "WorkflowEffectTimeout",
          message: `Workflow effect ${requested.effect} attempt ${request.attempt} lost its execution lease.`,
        },
      };
    }
    const heartbeat = workflowEffectCheckpoint(context, request.sequence, request.attempt);
    return {
      status: "ready",
      attempt: request.attempt,
      ...(deadline === undefined ? {} : { deadline }),
      ...(heartbeat === undefined
        ? {}
        : {
            previousHeartbeat: cloneWorkflowData(heartbeat.details),
          }),
      request: cloneWorkflowData(requested),
    };
  };
  methods.$heartbeatEffect = (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{
      run: number;
      sequence: number;
      attempt: number;
      at: number;
      details: WorkflowData;
    }>;
    if (
      request.run !== context.state.run ||
      terminalWorkflowStatus(context.state.status) ||
      (context.state.status === "cancelling" &&
        workflowPendingEffectCancellable(context, request.sequence)) ||
      workflowEffectSettled(context, request.sequence) ||
      workflowEffectAttemptSettled(context, request.sequence, request.attempt)
    ) {
      return { accepted: false };
    }
    const started = workflowEffectAttempt(context, request.sequence, request.attempt);
    if (started === undefined) return { accepted: false };
    const requested = workflowEffectRequest(context, request.sequence);
    const leaseUntil = workflowEffectLeaseUntil(context, requested, started);
    if (leaseUntil !== undefined && request.at >= leaseUntil) {
      return { accepted: false };
    }
    context.state.history.push({
      type: "effect-heartbeat",
      sequence: request.sequence,
      attempt: request.attempt,
      at: request.at,
      details: cloneWorkflowData(request.details),
    });
    const renewedUntil = workflowEffectLeaseUntil(context, requested, started);
    if (renewedUntil !== undefined) {
      scheduleWorkflowEffectTimeout(
        context,
        methods,
        request.sequence,
        request.attempt,
        renewedUntil,
      );
    }
    return { accepted: true };
  };
  methods.$timeoutEffect = (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{
      run: number;
      sequence: number;
      attempt: number;
    }>;
    if (
      request.run !== context.state.run ||
      terminalWorkflowStatus(context.state.status) ||
      (context.state.status === "cancelling" &&
        workflowPendingEffectCancellable(context, request.sequence)) ||
      workflowEffectSettled(context, request.sequence) ||
      workflowEffectAttemptSettled(context, request.sequence, request.attempt)
    ) {
      return { status: context.state.status };
    }
    const started = workflowEffectAttempt(context, request.sequence, request.attempt);
    if (started === undefined) return { status: context.state.status };
    const requested = workflowEffectRequest(context, request.sequence);
    const until = workflowEffectLeaseUntil(context, requested, started);
    if (until === undefined) return { status: context.state.status };
    if (until > context.invocation.at) {
      scheduleWorkflowEffectTimeout(context, methods, request.sequence, request.attempt, until);
      return { status: context.state.status };
    }
    failWorkflowEffectAttempt(
      context,
      methods,
      requested,
      request.attempt,
      until,
      {
        name: "WorkflowEffectTimeout",
        message: `Workflow effect ${requested.effect} attempt ${request.attempt} exceeded its deadline.`,
      },
      true,
    );
    return { status: context.state.status };
  };
  methods.$completeEffect = (context: RuntimeWorkflowContext<Model>) => {
    const completion = context.input as WorkflowEffectDelivery;
    const request = completion.request;
    const outcome = completion.delivery.output;
    const completedAt = completion.delivery.completedAt;
    if (
      request.run !== context.state.run ||
      terminalWorkflowStatus(context.state.status) ||
      workflowEffectSettled(context, request.sequence)
    ) {
      return { status: context.state.status };
    }
    const started = workflowEffectAttempt(context, request.sequence, request.attempt);
    const attempts = context.state.history.filter(
      (event) => event.type === "effect-attempt-started" && event.sequence === request.sequence,
    );
    const latest = attempts[attempts.length - 1];
    if (
      started === undefined ||
      latest?.type !== "effect-attempt-started" ||
      latest.attempt !== request.attempt ||
      workflowEffectAttemptSettled(context, request.sequence, request.attempt)
    ) {
      return { status: context.state.status };
    }
    if (
      context.state.status === "cancelling" &&
      workflowPendingEffectCancellable(context, request.sequence)
    ) {
      context.reminders.cancel({
        id: workflowEffectTimeoutReminder(context.state.run, request.sequence),
      });
      context.state.history.push({
        type: "effect-cancelled",
        sequence: request.sequence,
        attempt: request.attempt,
        at: completedAt,
      });
      context.state.pendingEffects = context.state.pendingEffects.filter(
        (pending) => pending !== request.sequence,
      );
      context.state.time = completedAt;
      if (context.state.pendingEffects.length === 0) {
        transferWorkflowExecution(
          context,
          methods,
          workflowCancellationTransfer(context, completedAt),
        );
      } else {
        recordWorkflowChange(context);
      }
      return { status: context.state.status };
    }
    const requested = workflowEffectRequest(context, request.sequence);
    const leaseUntil = workflowEffectLeaseUntil(context, requested, started);
    if (leaseUntil !== undefined && completedAt >= leaseUntil) {
      failWorkflowEffectAttempt(
        context,
        methods,
        requested,
        request.attempt,
        leaseUntil,
        {
          name: "WorkflowEffectTimeout",
          message: `Workflow effect ${requested.effect} attempt ${request.attempt} exceeded its deadline.`,
        },
        false,
      );
      return { status: context.state.status };
    }
    context.reminders.cancel({
      id: workflowEffectTimeoutReminder(context.state.run, request.sequence),
    });
    if (outcome.status === "succeeded") {
      context.state.history.push({
        type: "effect-succeeded",
        sequence: request.sequence,
        attempt: request.attempt,
        at: completedAt,
        result: cloneWorkflowData(outcome.value),
      });
      settleWorkflowChild(context, requested, outcome.value, completedAt);
      resumeWorkflowEffectFrame(context, request.sequence, outcome.value, completedAt);
      settleWorkflowEffect(context, methods, request.sequence, completedAt);
      return { status: context.state.status };
    }
    failWorkflowEffectAttempt(
      context,
      methods,
      requested,
      request.attempt,
      completedAt,
      outcome.failure,
      false,
    );
    return { status: context.state.status };
  };
  methods.$completeChildClose = (context: RuntimeWorkflowContext<Model>) => {
    const completion = context.input as Readonly<{
      request: Readonly<{
        dependency: string;
        id: string;
        wait: boolean;
      }>;
      delivery: Omit<ActorOutboundDelivery, "output"> &
        Readonly<{ output: Readonly<{ status: WorkflowStatus }> }>;
    }>;
    const request = completion.request;
    const close = workflowChildCloseId(request.dependency, request.id);
    if (!context.state.pendingChildCloses.some((pending) => pending === close)) {
      return { status: context.state.status };
    }
    context.state.pendingChildCloses = context.state.pendingChildCloses.filter(
      (pending) => pending !== close,
    );
    const child = context.state.children.find(
      (candidate) => candidate.dependency === request.dependency && candidate.id === request.id,
    );
    if (child !== undefined) {
      child.status = terminalWorkflowStatus(completion.delivery.output.status)
        ? "closed"
        : "closing";
    }
    context.state.history.push({
      type: "child-closed",
      dependency: request.dependency,
      id: request.id,
      status: completion.delivery.output.status,
      at: completion.delivery.completedAt,
    });
    if (
      request.wait &&
      context.state.status === "cancelling" &&
      context.state.pendingChildCloses.length === 0 &&
      context.state.pendingEffects.length === 0
    ) {
      transferWorkflowExecution(
        context,
        methods,
        workflowCancellationTransfer(context, completion.delivery.completedAt),
      );
    } else {
      recordWorkflowChange(context);
    }
    return { status: context.state.status };
  };
  methods.$timer = (context: RuntimeWorkflowContext<Model>) => {
    const execution = context.state.execution as WorkflowExecutionFrame | undefined;
    if (
      context.state.status !== "running" &&
      context.state.status !== "paused" &&
      (context.state.status !== "cancelling" ||
        execution?.pending?.kind !== "sleep" ||
        execution.pending.cancellable)
    ) {
      return { status: context.state.status };
    }
    const request = context.input as Readonly<{ run: number; sequence: number; at: number }>;
    if (request.run !== context.state.run) return { status: context.state.status };
    const requested = context.state.history.find(
      (event) => event.type === "timer-requested" && event.sequence === request.sequence,
    );
    if (requested?.type !== "timer-requested" || requested.at !== request.at) {
      throw workflowNondeterminism(`Timer ${request.sequence} has no durable request.`);
    }
    const fired = context.state.history.some(
      (event) => event.type === "timer-fired" && event.sequence === request.sequence,
    );
    if (fired) return { status: context.state.status };
    context.state.history.push({
      type: "timer-fired",
      sequence: request.sequence,
      at: request.at,
    });
    context.state.pendingTimers = context.state.pendingTimers.filter(
      (pending) => pending !== request.sequence,
    );
    resumeWorkflowTimerFrame(context, request.sequence, request.at);
    context.state.time = request.at;
    recordWorkflowChange(context);
    if (context.state.status === "running" || context.state.status === "cancelling") {
      scheduleWorkflowAdvance(context, methods);
    }
    return { status: context.state.status };
  };
  methods.$wait = (context: RuntimeWorkflowContext<Model>) => {
    const execution = context.state.execution as WorkflowExecutionFrame | undefined;
    if (
      context.state.status !== "running" &&
      context.state.status !== "paused" &&
      (context.state.status !== "cancelling" ||
        execution?.pending?.kind !== "wait" ||
        execution.pending.cancellable)
    ) {
      return { status: context.state.status };
    }
    const request = context.input as Readonly<{ run: number; sequence: number; at: number }>;
    if (request.run !== context.state.run) return { status: context.state.status };
    if (!context.state.pendingWaits.some((pending) => pending === request.sequence)) {
      return { status: context.state.status };
    }
    const waiting = context.state.history.find(
      (event) => event.type === "wait" && event.sequence === request.sequence,
    );
    if (waiting?.type !== "wait" || waiting.at !== request.at) {
      throw workflowNondeterminism(`Wait ${request.sequence} has no durable deadline.`);
    }
    const timedOut = context.state.history.some(
      (event) => event.type === "wait-timed-out" && event.sequence === request.sequence,
    );
    if (timedOut) return { status: context.state.status };
    context.state.history.push({
      type: "wait-timed-out",
      sequence: request.sequence,
      at: request.at,
    });
    context.state.pendingWaits = context.state.pendingWaits.filter(
      (pending) => pending !== request.sequence,
    );
    resumeWorkflowWaitFrame(context, request.sequence, request.at);
    context.state.time = request.at;
    recordWorkflowChange(context);
    if (context.state.status === "running" || context.state.status === "cancelling") {
      scheduleWorkflowAdvance(context, methods);
    }
    return { status: context.state.status };
  };
  methods.$changes = (context: RuntimeWorkflowContext<Model>) => {
    const request = context.input as Readonly<{ after: number; limit: number }>;
    return {
      changes: context.state.changes
        .filter((change) => change.cursor > request.after)
        .slice(0, request.limit),
    };
  };
  methods.state = (context: RuntimeWorkflowContext<Model>) =>
    context.state.state === undefined
      ? { status: "idle", revision: context.state.revision }
      : {
          status: context.state.status,
          revision: context.state.revision,
          state: context.state.state,
        };
  methods.$visibility = (context: RuntimeWorkflowContext<Model>) => ({
    workflow: describeWorkflow(context.key, context.state),
    ...(context.state.state === undefined
      ? {}
      : { state: cloneWorkflowData(context.state.state) as Model["State"] }),
  });
  methods.describe = (context: RuntimeWorkflowContext<Model>) =>
    describeWorkflow(context.key, context.state);
  methods.result = (context: RuntimeWorkflowContext<Model>) => {
    if (context.state.status === "succeeded") {
      return { status: context.state.status, value: context.state.result };
    }
    if (context.state.status === "failed") {
      return { status: context.state.status, failure: context.state.failure };
    }
    return { status: context.state.status };
  };
  methods.migrate = (context: RuntimeWorkflowContext<Model>) => {
    const requested = context.input as Readonly<{ artifact?: object }> | undefined;
    const selected = workflowArtifact(requested?.artifact ?? context.factory.artifact);
    if (
      context.state.artifact === undefined ||
      context.state.execution === undefined ||
      context.state.startedAt === undefined ||
      context.state.replay === undefined
    ) {
      return {
        status: "unavailable",
        lifecycle: context.state.status,
      } satisfies WorkflowMigrationResult;
    }
    const pinned = workflowArtifact(context.state.artifact);
    if (pinned.id === selected.id) {
      return {
        status: "current",
        artifact: selected.id,
      } satisfies WorkflowMigrationResult;
    }
    try {
      const execution = context.factory.replay(selected.executable, {
        identity: cloneWorkflowData(context.key),
        input: cloneWorkflowData(context.state.input),
        time: context.state.startedAt,
        initialState: cloneWorkflowData(context.state.replay.initialState),
        steps: cloneWorkflowData(context.state.replay.steps),
        expected: cloneWorkflowData(context.state.execution),
      }) as WorkflowExecutionFrame;
      context.state.definition = selected.definition.contract.revision;
      context.state.artifact = cloneWorkflowData(selected);
      context.state.execution = cloneWorkflowData(execution);
      context.state.state = cloneWorkflowData(execution.state) as Model["State"];
      recordWorkflowChange(context);
      return {
        status: "migrated",
        from: pinned.id,
        to: selected.id,
      } satisfies WorkflowMigrationResult;
    } catch (error) {
      return {
        status: "incompatible",
        from: pinned.id,
        to: selected.id,
        reason: serializedWorkflowError(error).message,
      } satisfies WorkflowMigrationResult;
    }
  };
  methods.pause = (context: RuntimeWorkflowContext<Model>) => {
    if (context.state.status === "running") {
      context.state.status = "paused";
      recordWorkflowChange(context);
    }
    return { status: context.state.status };
  };
  methods.resume = (context: RuntimeWorkflowContext<Model>) => {
    if (context.state.status === "paused") {
      context.state.status = "running";
      recordWorkflowChange(context);
      scheduleWorkflowAdvance(context, methods);
    }
    return { status: context.state.status };
  };
  methods.cancel = async (context: RuntimeWorkflowContext<Model>) => {
    if (context.state.status === "running" || context.state.status === "paused") {
      context.state.status = "cancelling";
      context.state.history.push({
        type: "cancellation-requested",
        at: context.invocation.at,
      });
      const execution = workflowExecutionFrame(context);
      execution.cancellation = { at: context.invocation.at };
      execution.time = context.invocation.at;
      context.state.execution = execution;
      recordWorkflowReplayStep(context, {
        kind: "cancel-request",
        cancellation: cloneWorkflowData(execution.cancellation),
      });
      context.state.time = context.invocation.at;
      const waiting = cancelWorkflowWork(context, methods, "cancel");
      if (waiting) {
        recordWorkflowChange(context);
      } else {
        transferWorkflowExecution(
          context,
          methods,
          workflowCancellationTransfer(context, context.invocation.at),
        );
      }
    }
    return { status: context.state.status };
  };
  methods.terminate = async (context: RuntimeWorkflowContext<Model>) => {
    if (!terminalWorkflowStatus(context.state.status)) {
      context.state.status = "terminated";
      cancelWorkflowWork(context, methods, "terminate");
      recordWorkflowChange(context);
    }
    return { status: context.state.status };
  };
  return methods as Actor.Definition<WorkflowRuntime<Model>>["methods"];
}

function describeWorkflow<Model extends WorkflowModelDefinition>(
  id: Model["Id"],
  state: Readonly<WorkflowRuntimeState<Model>>,
): WorkflowDescription<Model> {
  return {
    id,
    definition: state.definition,
    ...(state.artifact === undefined ? {} : { artifact: workflowArtifact(state.artifact).id }),
    run: state.run,
    status: state.status,
    revision: state.revision,
    ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
    ...(state.closedAt === undefined ? {} : { closedAt: state.closedAt }),
    time: state.time,
    history: {
      events: state.history.length,
      continueSuggested: state.history.length >= workflowHistorySuggestion,
      retainedRuns: state.closedRuns.length,
    },
  };
}

function applyWorkflowExecutionFrame<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  execution: WorkflowExecutionFrame,
): void {
  if (
    execution.definition !== context.state.definition ||
    execution.time !== execution.time ||
    execution.sequence % 1 !== 0 ||
    execution.sequence < 0
  ) {
    throw workflowNondeterminism("Workflow executor returned an invalid durable frame.");
  }
  const artifact =
    context.state.artifact === undefined ? undefined : workflowArtifact(context.state.artifact);
  if (artifact === undefined) {
    throw workflowNondeterminism("Workflow execution has no pinned definition artifact.");
  }
  assertWorkflowValue(execution.state, artifact.definition.contract.state, "Workflow State");
  const previous = context.state.execution as WorkflowExecutionFrame | undefined;
  const previousWait = previous?.pending?.kind === "wait" ? previous.pending : undefined;
  if (
    previousWait !== undefined &&
    (execution.pending?.kind !== "wait" || execution.pending.sequence !== previousWait.sequence)
  ) {
    context.state.pendingWaits = context.state.pendingWaits.filter(
      (sequence) => sequence !== previousWait.sequence,
    );
    context.reminders.cancel({
      id: `workflow:${context.state.run}:wait:${previousWait.sequence}`,
    });
  }
  context.state.execution = cloneWorkflowData(execution);
  context.state.state = cloneWorkflowData(execution.state) as Model["State"];
  context.state.time = execution.time;
  if (execution.status === "continued") {
    const pinnedArtifact = context.state.artifact;
    if (pinnedArtifact === undefined) {
      throw workflowNondeterminism("Workflow continuation has no pinned definition artifact.");
    }
    closeWorkflowChildren(context, methods, "parent-close");
    archiveWorkflowRun(context, "continued");
    initializeWorkflowRun(
      context,
      methods,
      execution.continuedInput as Model["Input"],
      pinnedArtifact,
    );
    return;
  }
  if (execution.status === "succeeded") {
    assertWorkflowValue(execution.result, artifact.definition.contract.result, "Workflow Result");
    context.state.result = cloneWorkflowData(execution.result) as Model["Result"];
    context.state.status = "succeeded";
    context.state.pendingEffects = [];
    context.state.pendingTimers = [];
    context.state.pendingWaits = [];
    closeWorkflowChildren(context, methods, "parent-close");
    recordWorkflowChange(context);
    return;
  }
  if (execution.status === "failed") {
    context.state.failure = workflowFrameFailure(execution.failure);
    context.state.status = "failed";
    context.state.pendingEffects = [];
    context.state.pendingTimers = [];
    context.state.pendingWaits = [];
    closeWorkflowChildren(context, methods, "parent-close");
    recordWorkflowChange(context);
    return;
  }
  if (execution.status === "cancelled") {
    context.state.status = "cancelled";
    context.state.pendingEffects = [];
    context.state.pendingTimers = [];
    context.state.pendingWaits = [];
    recordWorkflowChange(context);
    return;
  }
  if (execution.status !== "suspended" || execution.pending === undefined) {
    throw workflowNondeterminism("Workflow executor stopped without a durable command.");
  }
  const pending = execution.pending;
  if (context.state.status === "cancelling" && pending.cancellable) {
    throw workflowNondeterminism(
      "Cancelled Workflow suspended outside a non-cancellable cleanup scope.",
    );
  }
  if (pending.kind === "effect") {
    admitWorkflowEffect(context, methods, pending, execution.time);
  } else if (pending.kind === "child") {
    admitWorkflowChild(context, methods, pending, execution.time);
  } else if (pending.kind === "sleep") {
    const existingTimer = context.state.history.find(
      (event) => event.type === "timer-requested" && event.sequence === pending.sequence,
    );
    if (existingTimer === undefined) {
      context.state.history.push({
        type: "timer-requested",
        sequence: pending.sequence,
        at: pending.at,
      });
    } else if (existingTimer.type !== "timer-requested" || existingTimer.at !== pending.at) {
      throw workflowNondeterminism(`Timer ${pending.sequence} changed after durable admission.`);
    }
    if (!context.state.pendingTimers.some((sequence) => sequence === pending.sequence)) {
      context.state.pendingTimers.push(pending.sequence);
      scheduleWorkflowTimer(context, methods, pending.sequence, pending.at);
    }
  } else if (pending.kind === "wait") {
    const existingWait = context.state.history.find(
      (event) => event.type === "wait" && event.sequence === pending.sequence,
    );
    if (existingWait === undefined) {
      context.state.history.push({
        type: "wait",
        sequence: pending.sequence,
        ...(pending.until === undefined ? {} : { at: pending.until }),
      });
    } else if (existingWait.type !== "wait" || existingWait.at !== pending.until) {
      throw workflowNondeterminism(`Wait ${pending.sequence} changed after durable admission.`);
    }
    if (
      pending.until !== undefined &&
      !context.state.pendingWaits.some((sequence) => sequence === pending.sequence)
    ) {
      context.state.pendingWaits.push(pending.sequence);
      scheduleWorkflowWait(context, methods, pending.sequence, pending.until);
    }
  } else {
    for (const effect of pending.effects) {
      if (effect.status === "pending") {
        admitWorkflowEffect(context, methods, effect, execution.time);
      }
    }
  }
  recordWorkflowChange(context);
}

function admitWorkflowEffect<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  effect: Readonly<{
    sequence: number;
    dependency: string;
    operation: string;
    input: WorkflowData;
    options?: WorkflowData;
  }>,
  at: number,
  child?: WorkflowEffectRequest["child"],
): void {
  const options = effect.options as WorkflowEffectOptions | undefined;
  validateWorkflowEffectOptions(options);
  const existingEffect = context.state.history.find(
    (event) => event.type === "effect-requested" && event.sequence === effect.sequence,
  );
  if (existingEffect === undefined) {
    context.state.history.push({
      type: "effect-requested",
      sequence: effect.sequence,
      effect: context.state.history.filter((event) => event.type === "effect-requested").length,
      dependency: effect.dependency,
      operation: effect.operation,
      input: cloneWorkflowData(effect.input),
      idempotencyKey:
        options?.idempotencyKey ??
        `workflow:${context.key}:run:${context.state.run}:effect:${effect.sequence}`,
      scheduledAt: at,
      ...(options === undefined ? {} : { options: cloneWorkflowData(options) }),
      ...(child === undefined ? {} : { child: cloneWorkflowData(child) }),
    });
  } else if (
    existingEffect.type !== "effect-requested" ||
    existingEffect.dependency !== effect.dependency ||
    existingEffect.operation !== effect.operation ||
    !workflowDataEqual(existingEffect.input, effect.input) ||
    !workflowDataEqual(existingEffect.options, options) ||
    !workflowDataEqual(existingEffect.child, child)
  ) {
    throw workflowNondeterminism(`Effect ${effect.sequence} changed after durable admission.`);
  }
  if (!context.state.pendingEffects.some((sequence) => sequence === effect.sequence)) {
    context.state.pendingEffects.push(effect.sequence);
    scheduleWorkflowEffect(context, methods, effect.sequence);
  }
}

function admitWorkflowChild<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  child: Extract<WorkflowPendingFrame, { kind: "child" }>,
  at: number,
): void {
  const input = workflowRecord(child.input);
  const id = input.id as string;
  if (id.length === 0) {
    throw workflowNondeterminism("Workflow child identity must be a non-empty string.");
  }
  const options = (child.options ?? {}) as WorkflowChildOptions;
  const parentClose = options.parentClose ?? "terminate";
  if (parentClose !== "terminate" && parentClose !== "cancel" && parentClose !== "abandon") {
    throw workflowNondeterminism(
      `Workflow child parentClose policy ${JSON.stringify(parentClose)} is invalid.`,
    );
  }
  const cancellation = options.cancellation ?? "wait";
  if (child.operation === "start") {
    const existing = context.state.children.find(
      (candidate) => candidate.dependency === child.dependency && candidate.id === id,
    );
    if (existing === undefined) {
      context.state.children.push({
        dependency: child.dependency,
        id,
        sequence: child.sequence,
        parentClose,
        cancellation,
        status: "starting",
      });
    } else if (
      existing.sequence !== child.sequence ||
      existing.parentClose !== parentClose ||
      existing.cancellation !== cancellation
    ) {
      throw workflowNondeterminism(
        `Workflow child ${JSON.stringify(child.dependency)}:${JSON.stringify(id)} changed after admission.`,
      );
    }
  }
  admitWorkflowEffect(context, methods, child, at, {
    id,
    parentClose,
    cancellation,
  });
}

function settleWorkflowChild<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  request: WorkflowEffectRequest,
  value: WorkflowData,
  at: number,
): void {
  const child = request.child;
  if (child === undefined) return;
  const relation = context.state.children.find(
    (candidate) => candidate.dependency === request.dependency && candidate.id === child.id,
  );
  const result = workflowRecord(value);
  const status = result.status;
  if (request.operation === "start") {
    if (status === "conflict") {
      context.state.children = context.state.children.filter((candidate) => candidate !== relation);
      return;
    }
    if (relation !== undefined) relation.status = "running";
    context.state.history.push({
      type: "child-started",
      sequence: request.sequence,
      dependency: request.dependency,
      id: child.id,
      at,
    });
    return;
  }
  if (request.operation === "$join") {
    if (
      status !== "succeeded" &&
      status !== "failed" &&
      status !== "cancelled" &&
      status !== "terminated"
    ) {
      throw workflowNondeterminism(
        `Workflow child ${JSON.stringify(request.dependency)}:${JSON.stringify(child.id)} joined with non-terminal status ${JSON.stringify(status)}.`,
      );
    }
    if (relation !== undefined) relation.status = "closed";
    context.state.history.push({
      type: "child-closed",
      dependency: request.dependency,
      id: child.id,
      status,
      at,
    });
    return;
  }
  if (request.operation === "cancel" || request.operation === "terminate") {
    if (relation !== undefined) {
      relation.status = terminalWorkflowStatus(status as WorkflowStatus) ? "closed" : "closing";
    }
  }
}

function workflowRecord(value: WorkflowData): Readonly<Record<string, WorkflowData>> {
  return value as Readonly<Record<string, WorkflowData>>;
}

function synchronizeWorkflowExecutionState<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
): void {
  if (context.state.execution === undefined || context.state.state === undefined) return;
  const execution = cloneWorkflowData(context.state.execution) as WorkflowExecutionFrame;
  execution.state = cloneWorkflowData(context.state.state);
  context.state.execution = execution;
}

function workflowExecutionFrame<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
): WorkflowExecutionFrame {
  if (context.state.execution === undefined) {
    throw workflowNondeterminism("Workflow execution frame is missing.");
  }
  return cloneWorkflowData(context.state.execution) as WorkflowExecutionFrame;
}

function workflowPendingEffectCancellable<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
): boolean {
  const pending = (context.state.execution as WorkflowExecutionFrame | undefined)?.pending;
  if ((pending?.kind === "effect" || pending?.kind === "child") && pending.sequence === sequence) {
    return pending.cancellable;
  }
  if (
    pending?.kind === "concurrent" &&
    pending.effects.some((effect) => effect.sequence === sequence)
  ) {
    return pending.cancellable;
  }
  return true;
}

function workflowCancellationTransfer<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  at: number,
): Extract<WorkflowFrameTransfer, { kind: "cancel" }> {
  const execution = workflowExecutionFrame(context);
  return {
    kind: "cancel",
    cancellation: execution.cancellation ?? { at },
  };
}

function transferWorkflowExecution<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  transfer: WorkflowFrameTransfer,
): void {
  const selectedArtifact = workflowArtifact(context.factory.artifact);
  const pinnedArtifact =
    context.state.artifact === undefined ? undefined : workflowArtifact(context.state.artifact);
  if (
    pinnedArtifact === undefined ||
    pinnedArtifact.definition.contract.revision !== context.state.definition ||
    pinnedArtifact.executable.revision !== context.state.definition
  ) {
    throw workflowNondeterminism("Workflow transfer has no valid pinned definition artifact.");
  }
  const current = workflowExecutionFrame(context);
  recordWorkflowReplayStep(context, {
    kind: "transfer",
    ...(current.pending === undefined ? {} : { pending: cloneWorkflowData(current.pending) }),
    transfer: cloneWorkflowData(transfer),
  });
  const execution =
    pinnedArtifact.id === selectedArtifact.id
      ? (context.factory.transfer(current, transfer) as WorkflowExecutionFrame)
      : (context.factory.interpretTransfer(
          pinnedArtifact.executable,
          current,
          transfer,
        ) as WorkflowExecutionFrame);
  applyWorkflowExecutionFrame(context, methods, execution);
}

function resumeWorkflowEffectFrame<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  result: WorkflowData,
  at: number,
): void {
  const execution = workflowExecutionFrame(context);
  const pending = execution.pending;
  if ((pending?.kind === "effect" || pending?.kind === "child") && pending.sequence === sequence) {
    const singleEffectCommand = cloneWorkflowData(pending);
    execution.pending = undefined;
    execution.time = at;
    execution.status = "running";
    execution.block = pending.next;
    execution.locals[pending.result] = cloneWorkflowData(result);
    context.state.execution = execution;
    recordWorkflowReplayStep(context, {
      kind: "effect",
      command: singleEffectCommand,
      sequence,
      at,
      outcome: { status: "succeeded", value: cloneWorkflowData(result) },
    });
    return;
  }
  if (pending?.kind !== "concurrent") {
    throw workflowNondeterminism(
      `Effect ${sequence} completion does not match the durable execution frame.`,
    );
  }
  const effect = pending.effects.find((candidate) => candidate.sequence === sequence);
  if (effect === undefined || effect.status !== "pending") {
    throw workflowNondeterminism(`Concurrent effect ${sequence} completion is stale.`);
  }
  const concurrentCommand = cloneWorkflowData(pending);
  effect.status = "succeeded";
  effect.value = cloneWorkflowData(result);
  execution.time = at;
  settleWorkflowConcurrentFrame(execution);
  if (execution.pending === undefined) {
    cancelWorkflowConcurrentPending(context, pending, sequence, at);
  }
  context.state.execution = execution;
  recordWorkflowReplayStep(context, {
    kind: "effect",
    command: concurrentCommand,
    sequence,
    at,
    outcome: { status: "succeeded", value: cloneWorkflowData(result) },
  });
}

function settleWorkflowConcurrentFrame(execution: WorkflowExecutionFrame): void {
  const pending = execution.pending;
  if (pending?.kind !== "concurrent") return;
  const settled = pending.effects.filter((effect) => effect.status !== "pending");
  if (pending.operation === "race") {
    const winner = settled[0];
    if (winner === undefined) return;
    execution.pending = undefined;
    if (winner.status === "failed") {
      execution.status = "failed";
      execution.failure = winner.failure;
      return;
    }
    execution.locals[pending.result] = cloneWorkflowData(winner.value);
    execution.block = pending.next;
    execution.status = "running";
    return;
  }
  const failed = pending.effects.find((effect) => effect.status === "failed");
  if (failed !== undefined && pending.operation === "all") {
    execution.pending = undefined;
    execution.status = "failed";
    execution.failure = failed.failure;
    return;
  }
  if (settled.length !== pending.effects.length) return;
  const values: WorkflowData[] = [];
  for (const effect of pending.effects) {
    if (pending.operation === "all") {
      values.push(cloneWorkflowData(effect.value));
    } else if (effect.status === "succeeded") {
      values.push({
        status: "fulfilled",
        value: cloneWorkflowData(effect.value),
      });
    } else {
      values.push({
        status: "rejected",
        reason: cloneWorkflowData(effect.failure),
      });
    }
  }
  execution.locals[pending.result] = values;
  execution.pending = undefined;
  execution.block = pending.next;
  execution.status = "running";
}

function cancelWorkflowConcurrentPending<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  pending: Extract<WorkflowPendingFrame, { kind: "concurrent" }>,
  completed: number,
  at: number,
): void {
  for (const effect of pending.effects) {
    if (effect.sequence !== completed && effect.status === "pending") {
      context.reminders.cancel({
        id: `workflow:${context.state.run}:effect:${effect.sequence}`,
      });
      context.reminders.cancel({
        id: workflowEffectTimeoutReminder(context.state.run, effect.sequence),
      });
      const attempts = context.state.history.filter(
        (event) => event.type === "effect-attempt-started" && event.sequence === effect.sequence,
      );
      const latest = attempts[attempts.length - 1];
      if (latest?.type === "effect-attempt-started") {
        context.outbox.cancel({
          id: workflowEffectOutboundId(context.state.run, effect.sequence, latest.attempt),
        });
        if (!workflowEffectAttemptSettled(context, effect.sequence, latest.attempt)) {
          context.state.history.push({
            type: "effect-cancelled",
            sequence: effect.sequence,
            attempt: latest.attempt,
            at,
          });
        }
      }
      context.state.pendingEffects = context.state.pendingEffects.filter(
        (sequence) => sequence !== effect.sequence,
      );
    }
  }
}

function resumeWorkflowTimerFrame<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  at: number,
): void {
  const execution = workflowExecutionFrame(context);
  const pending = execution.pending;
  if (pending?.kind !== "sleep" || pending.sequence !== sequence || pending.at !== at) {
    throw workflowNondeterminism(
      `Timer ${sequence} completion does not match the durable execution frame.`,
    );
  }
  const command = cloneWorkflowData(pending);
  execution.pending = undefined;
  execution.time = at;
  execution.status = "running";
  execution.block = pending.next;
  context.state.execution = execution;
  recordWorkflowReplayStep(context, {
    kind: "sleep",
    command,
    sequence,
    at,
  });
}

function resumeWorkflowWaitFrame<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  at: number,
): void {
  const execution = workflowExecutionFrame(context);
  const pending = execution.pending;
  if (
    pending?.kind !== "wait" ||
    pending.sequence !== sequence ||
    pending.until === undefined ||
    pending.until !== at
  ) {
    throw workflowNondeterminism(
      `Wait ${sequence} timeout does not match the durable execution frame.`,
    );
  }
  const command = cloneWorkflowData(pending);
  execution.pending = undefined;
  execution.time = at;
  execution.status = "running";
  execution.block = pending.next;
  execution.locals[pending.result] = false;
  context.state.execution = execution;
  recordWorkflowReplayStep(context, {
    kind: "wait",
    command,
    sequence,
    at,
  });
}

function workflowFrameFailure<Model extends WorkflowModelDefinition>(
  failure: object | undefined,
): FailureOf<Model["Failures"]> | WorkflowExecutionFailure {
  const frame = failure as
    | Readonly<{ type: "declared"; value?: WorkflowData }>
    | Readonly<{
        type: "effect";
        dependency: string;
        operation: string;
        failure: WorkflowData;
      }>
    | Readonly<{ type: "resource"; limit: number }>
    | undefined;
  if (frame?.type === "declared") {
    return frame.value as FailureOf<Model["Failures"]>;
  }
  if (frame?.type === "effect") {
    const effectFailure = frame.failure as
      | Readonly<{ name?: string; message?: string; details?: object }>
      | undefined;
    return {
      type: "dependency",
      data: {
        dependency: frame.dependency,
        operation: frame.operation,
        name: effectFailure?.name ?? "WorkflowDependencyFailure",
        message: effectFailure?.message ?? "Workflow Dependency invocation failed.",
        ...(effectFailure?.details === undefined ? {} : { details: effectFailure.details }),
      },
    };
  }
  return {
    type: "execution",
    data: {
      name: "WorkflowResourceLimit",
      message:
        frame?.type === "resource"
          ? `Workflow exceeded its ${frame.limit} block execution budget.`
          : "Workflow executor returned an invalid failure.",
    },
  };
}

function initializeWorkflowRun<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  input: Model["Input"],
  artifactData: object = context.factory.artifact,
): void {
  const artifact = workflowArtifact(artifactData);
  const selectedArtifact = workflowArtifact(context.factory.artifact);
  context.state.run += 1;
  context.state.definition = artifact.definition.contract.revision;
  context.state.artifact = cloneWorkflowData(artifact);
  context.state.input = cloneWorkflowData(input);
  context.state.startedAt = context.invocation.at;
  context.state.closedAt = undefined;
  context.state.time = context.invocation.at;
  let initialState: Model["State"];
  if (artifact.id === selectedArtifact.id) {
    initialState = context.factory.state({ id: context.key, input });
  } else {
    const initialization = context.factory.interpretProcedure(artifact.executable.initialization, {
      definition: artifact.definition.contract.revision,
      identity: cloneWorkflowData(context.key),
      input: cloneWorkflowData(input),
      state: {},
      time: context.invocation.at,
    }) as WorkflowExecutionFrame;
    if (initialization.status !== "succeeded" || initialization.result === undefined) {
      throw workflowNondeterminism(
        "Retained Workflow State initialization did not complete synchronously.",
      );
    }
    initialState = cloneWorkflowData(initialization.result) as Model["State"];
  }
  assertWorkflowValue(initialState, artifact.definition.contract.state, "Workflow initial State");
  context.state.state = cloneWorkflowData(initialState);
  context.state.replay = {
    initialState: cloneWorkflowData(initialState),
    steps: [],
  };
  context.state.execution = {
    definition: artifact.definition.contract.revision,
    status: "running",
    identity: cloneWorkflowData(context.key),
    input: cloneWorkflowData(input),
    history: { events: 0, continueSuggested: false },
    state: cloneWorkflowData(initialState),
    block: artifact.definition.entry,
    locals: {},
    sequence: 0,
    time: context.invocation.at,
  } satisfies WorkflowExecutionFrame;
  context.state.result = undefined;
  context.state.failure = undefined;
  context.state.history = [];
  context.state.pendingEffects = [];
  context.state.pendingTimers = [];
  context.state.pendingWaits = [];
  context.state.children = [];
  context.state.pendingChildCloses = [];
  context.state.status = "running";
  recordWorkflowChange(context);
  scheduleWorkflowAdvance(context, methods);
}

function archiveWorkflowRun<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  status: Exclude<WorkflowStatus, "idle" | "running" | "paused" | "cancelling"> | "continued",
): void {
  if (
    context.state.startedAt === undefined ||
    context.state.state === undefined ||
    context.state.artifact === undefined
  ) {
    throw new Error("Workflow run cannot be archived before it starts.");
  }
  context.state.closedRuns.push({
    definition: context.state.definition,
    artifact: workflowArtifact(context.state.artifact).id,
    run: context.state.run,
    status,
    startedAt: context.state.startedAt,
    closedAt: context.state.closedAt ?? context.invocation.at,
    historyEvents: context.state.history.length,
  });
  if (context.state.closedRuns.length > workflowClosedRunRetention) {
    context.state.closedRuns = context.state.closedRuns.slice(
      context.state.closedRuns.length - workflowClosedRunRetention,
    );
  }
}

function recordWorkflowChange<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
): void {
  if (terminalWorkflowStatus(context.state.status)) {
    context.state.closedAt ??= context.invocation.at;
  } else {
    context.state.closedAt = undefined;
  }
  context.state.revision += 1;
  context.state.changes.push({
    cursor: context.state.revision,
    definition: context.state.definition,
    ...(context.state.artifact === undefined
      ? {}
      : { artifact: workflowArtifact(context.state.artifact).id }),
    run: context.state.run,
    status: context.state.status,
    pendingEffects: context.state.pendingEffects.length,
    pendingTimers: context.state.pendingTimers.length + context.state.pendingWaits.length,
    time: context.state.time,
    ...(context.state.state === undefined ? {} : { state: cloneWorkflowData(context.state.state) }),
    ...(context.state.result === undefined
      ? {}
      : { result: cloneWorkflowData(context.state.result) }),
    ...(context.state.failure === undefined
      ? {}
      : { failure: cloneWorkflowData(context.state.failure) }),
    ...(context.state.children.length === 0
      ? {}
      : {
          children: context.state.children.map(({ dependency, id, status }) => ({
            dependency,
            id,
            status,
          })),
        }),
  });
  if (context.state.changes.length > workflowChangeRetention) {
    context.state.changes = context.state.changes.slice(
      context.state.changes.length - workflowChangeRetention,
    );
  }
}

function observeWorkflow<Model extends WorkflowModelDefinition>(
  runtime: object,
  clock: Clock,
  timer: Timer,
  id: Model["Id"],
  after: number,
): AsyncIterable<WorkflowChange<Model["State"], Model["Result"]>> {
  return {
    [Symbol.asyncIterator]() {
      let cursor = after;
      let buffered: readonly WorkflowChange<Model["State"], Model["Result"]>[] = [];
      let index = 0;
      let active = true;
      return {
        async next() {
          while (active) {
            const change = buffered[index];
            if (change !== undefined) {
              index += 1;
              cursor = change.cursor;
              return { done: false as const, value: change };
            }
            const page = await dispatchDependency<{
              changes: readonly WorkflowChange<Model["State"], Model["Result"]>[];
            }>(runtime, "$changes", {
              key: id,
              input: { after: cursor, limit: 64 },
            });
            buffered = page.changes;
            index = 0;
            if (buffered.length === 0) {
              await timer.sleep({ until: clock.now({}) + 25 });
            }
          }
          return { done: true as const, value: undefined };
        },
        async return() {
          active = false;
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

function workflowEffectDeadline(
  request: WorkflowEffectRequest,
  startedAt: number,
): number | undefined {
  const total = request.options?.timeout?.total;
  const attempt = request.options?.timeout?.attempt;
  const totalDeadline = total === undefined ? undefined : request.scheduledAt + total;
  const attemptDeadline = attempt === undefined ? undefined : startedAt + attempt;
  if (totalDeadline === undefined) return attemptDeadline;
  if (attemptDeadline === undefined) return totalDeadline;
  return totalDeadline < attemptDeadline ? totalDeadline : attemptDeadline;
}

function validateWorkflowEffectOptions(options: WorkflowEffectOptions | undefined): void {
  if (options === undefined) return;
  if (options.idempotencyKey !== undefined && options.idempotencyKey.length === 0) {
    throw new TypeError("Workflow effect idempotencyKey must be a non-empty string.");
  }
  const retry = options.retry;
  if (retry !== undefined) {
    if (
      retry.maximumAttempts % 1 !== 0 ||
      retry.maximumAttempts < 0 ||
      retry.maximumAttempts > 9_007_199_254_740_991
    ) {
      throw new TypeError(
        "Workflow effect retry maximumAttempts must be a non-negative safe integer.",
      );
    }
    workflowNonNegativeDuration(retry.initialDelay, "retry initialDelay");
    workflowNonNegativeDuration(retry.maximumDelay, "retry maximumDelay");
    if (
      retry.backoff !== undefined &&
      (retry.backoff !== retry.backoff ||
        retry.backoff < 1 ||
        retry.backoff > 9_007_199_254_740_991)
    ) {
      throw new TypeError("Workflow effect retry backoff must be finite and at least one.");
    }
    for (const failure of retry.nonRetryable ?? []) {
      if (failure.length === 0) {
        throw new TypeError("Workflow effect nonRetryable names must be non-empty strings.");
      }
    }
  }
  const timeout = options.timeout;
  if (timeout !== undefined) {
    workflowPositiveDuration(timeout.total, "total timeout");
    workflowPositiveDuration(timeout.attempt, "attempt timeout");
    workflowPositiveDuration(timeout.heartbeat, "heartbeat timeout");
  }
  if (
    options.cancellation !== undefined &&
    options.cancellation !== "wait" &&
    options.cancellation !== "request" &&
    options.cancellation !== "abandon"
  ) {
    throw new TypeError("Workflow effect cancellation must be wait, request, or abandon.");
  }
}

function workflowNonNegativeDuration(value: number | undefined, label: string): void {
  if (value !== undefined && (value % 1 !== 0 || value < 0 || value > 9_007_199_254_740_991)) {
    throw new TypeError(`Workflow effect ${label} must be a non-negative safe integer.`);
  }
}

function workflowPositiveDuration(value: number | undefined, label: string): void {
  if (value !== undefined && (value % 1 !== 0 || value < 1 || value > 9_007_199_254_740_991)) {
    throw new TypeError(`Workflow effect ${label} must be a positive safe integer.`);
  }
}

function workflowEffectClaimUntil(
  request: WorkflowEffectRequest,
  startedAt: number,
  deadline: number | undefined,
): number | undefined {
  const heartbeat = request.options?.timeout?.heartbeat;
  const heartbeatUntil = heartbeat === undefined ? undefined : startedAt + heartbeat;
  if (deadline === undefined) return heartbeatUntil;
  if (heartbeatUntil === undefined) return deadline;
  return deadline < heartbeatUntil ? deadline : heartbeatUntil;
}

function workflowEffectAttempt<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  attempt: number,
):
  | Readonly<{
      type: "effect-attempt-started";
      sequence: number;
      attempt: number;
      at: number;
      until?: number;
    }>
  | undefined {
  const event = context.state.history.find(
    (candidate) =>
      candidate.type === "effect-attempt-started" &&
      candidate.sequence === sequence &&
      candidate.attempt === attempt,
  );
  return event?.type === "effect-attempt-started" ? event : undefined;
}

function workflowEffectHeartbeat<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  attempt: number,
):
  | Readonly<{
      type: "effect-heartbeat";
      sequence: number;
      attempt: number;
      at: number;
      details: WorkflowData;
    }>
  | undefined {
  const heartbeats = context.state.history.filter(
    (event) =>
      event.type === "effect-heartbeat" && event.sequence === sequence && event.attempt === attempt,
  );
  const heartbeat = heartbeats[heartbeats.length - 1];
  return heartbeat?.type === "effect-heartbeat" ? heartbeat : undefined;
}

function workflowEffectCheckpoint<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  attempt: number,
):
  | Readonly<{
      type: "effect-heartbeat";
      sequence: number;
      attempt: number;
      at: number;
      details: WorkflowData;
    }>
  | undefined {
  const heartbeats = context.state.history.filter(
    (event) =>
      event.type === "effect-heartbeat" && event.sequence === sequence && event.attempt <= attempt,
  );
  const heartbeat = heartbeats[heartbeats.length - 1];
  return heartbeat?.type === "effect-heartbeat" ? heartbeat : undefined;
}

function workflowEffectLeaseUntil<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  request: WorkflowEffectRequest,
  attempt: Readonly<{
    type: "effect-attempt-started";
    sequence: number;
    attempt: number;
    at: number;
    until?: number;
  }>,
): number | undefined {
  const heartbeat = workflowEffectHeartbeat(context, attempt.sequence, attempt.attempt);
  const heartbeatTimeout = request.options?.timeout?.heartbeat;
  if (heartbeat === undefined || heartbeatTimeout === undefined) {
    return attempt.until;
  }
  const renewed = heartbeat.at + heartbeatTimeout;
  const deadline = workflowEffectDeadline(request, attempt.at);
  return deadline !== undefined && deadline < renewed ? deadline : renewed;
}

function workflowRetryAt(
  request: WorkflowEffectRequest,
  failure: WorkflowSerializedError,
  attempt: number,
  failedAt: number,
): number | undefined {
  const policy = request.options?.retry;
  const nonRetryable = policy?.nonRetryable;
  if (
    (nonRetryable !== undefined && nonRetryable.some((name) => name === failure.name)) ||
    (policy === undefined && failure.retryDelay === undefined)
  ) {
    return undefined;
  }
  const maximumAttempts = policy?.maximumAttempts ?? 3;
  if (maximumAttempts !== 0 && attempt >= maximumAttempts) return undefined;
  let delay = failure.retryDelay ?? policy?.initialDelay ?? 1_000;
  if (failure.retryDelay === undefined) {
    const backoff = policy?.backoff ?? 2;
    for (let exponent = 1; exponent < attempt; exponent += 1) {
      delay *= backoff;
    }
  }
  const maximumDelay = policy?.maximumDelay;
  if (maximumDelay !== undefined && delay > maximumDelay) delay = maximumDelay;
  const retryAt = failedAt + delay;
  const total = request.options?.timeout?.total;
  if (total !== undefined && retryAt >= request.scheduledAt + total) return undefined;
  return retryAt;
}

function workflowEffectSettled<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
): boolean {
  return context.state.history.some(
    (event) =>
      (event.type === "effect-succeeded" ||
        event.type === "effect-failed" ||
        event.type === "effect-cancelled") &&
      event.sequence === sequence,
  );
}

function workflowEffectAttemptSettled<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
  attempt: number,
): boolean {
  return context.state.history.some(
    (event) =>
      (event.type === "effect-attempt-failed" ||
        event.type === "effect-succeeded" ||
        event.type === "effect-failed" ||
        event.type === "effect-cancelled") &&
      event.sequence === sequence &&
      event.attempt === attempt,
  );
}

function workflowEffectRequest<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  sequence: number,
): WorkflowEffectRequest {
  const request = context.state.history.find(
    (event) => event.type === "effect-requested" && event.sequence === sequence,
  );
  if (request?.type !== "effect-requested") {
    throw workflowNondeterminism(`Effect ${sequence} has no durable request.`);
  }
  return request;
}

function settleWorkflowEffect<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  sequence: number,
  at: number,
): void {
  context.state.pendingEffects = context.state.pendingEffects.filter(
    (pending) => pending !== sequence,
  );
  context.state.time = at;
  recordWorkflowChange(context);
  const execution = context.state.execution as WorkflowExecutionFrame | undefined;
  if (
    (context.state.status === "running" || context.state.status === "cancelling") &&
    execution?.status === "running"
  ) {
    scheduleWorkflowAdvance(context, methods);
  }
}

function settleWorkflowEffectFailure<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  request: WorkflowEffectRequest,
  attempt: number,
  at: number,
  failure: WorkflowSerializedError,
): void {
  context.state.history.push({
    type: "effect-failed",
    sequence: request.sequence,
    attempt,
    at,
    failure,
  });
  const execution = workflowExecutionFrame(context);
  const pending = execution.pending;
  const command = pending === undefined ? undefined : cloneWorkflowData(pending);
  let terminalFailure: object | undefined;
  let replayFailure: object | undefined;
  if (
    (pending?.kind === "effect" || pending?.kind === "child") &&
    pending.sequence === request.sequence
  ) {
    execution.time = at;
    terminalFailure = {
      type: "effect",
      dependency: pending.dependency,
      operation: pending.operation,
      failure: cloneWorkflowData(failure),
    };
    replayFailure = terminalFailure;
  } else if (pending?.kind === "concurrent") {
    const effect = pending.effects.find((candidate) => candidate.sequence === request.sequence);
    if (effect === undefined || effect.status !== "pending") {
      throw workflowNondeterminism(`Concurrent effect ${request.sequence} failure is stale.`);
    }
    effect.status = "failed";
    const effectFailure = {
      type: "effect",
      dependency: effect.dependency,
      operation: effect.operation,
      failure: cloneWorkflowData(failure),
    };
    effect.failure = effectFailure;
    replayFailure = effectFailure;
    execution.time = at;
    settleWorkflowConcurrentFrame(execution);
    if (execution.pending === undefined) {
      cancelWorkflowConcurrentPending(context, pending, request.sequence, at);
    }
    if (execution.status === "failed") {
      terminalFailure = execution.failure;
      execution.status = "running";
      execution.failure = undefined;
    }
  } else {
    throw workflowNondeterminism(
      `Effect ${request.sequence} completion does not match the durable execution frame.`,
    );
  }
  context.state.pendingEffects = context.state.pendingEffects.filter(
    (pendingSequence) => pendingSequence !== request.sequence,
  );
  context.state.execution = execution;
  if (command === undefined || replayFailure === undefined) {
    throw workflowNondeterminism(`Effect ${request.sequence} failure replay data is missing.`);
  }
  recordWorkflowReplayStep(context, {
    kind: "effect",
    command,
    sequence: request.sequence,
    at,
    outcome: { status: "failed", failure: replayFailure },
  });
  if (terminalFailure !== undefined) {
    transferWorkflowExecution(context, methods, {
      kind: "fail",
      failure: terminalFailure,
    });
  } else {
    context.state.time = at;
    recordWorkflowChange(context);
    if (
      execution.status === "running" &&
      (context.state.status === "running" || context.state.status === "cancelling")
    ) {
      scheduleWorkflowAdvance(context, methods);
    }
  }
}

function failWorkflowEffectAttempt<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  request: WorkflowEffectRequest,
  attempt: number,
  at: number,
  failure: WorkflowSerializedError,
  cancelOutbound: boolean,
): void {
  context.reminders.cancel({
    id: workflowEffectTimeoutReminder(context.state.run, request.sequence),
  });
  if (cancelOutbound) {
    context.outbox.cancel({
      id: workflowEffectOutboundId(context.state.run, request.sequence, attempt),
    });
  }
  const retryAt = workflowRetryAt(request, failure, attempt, at);
  if (retryAt === undefined) {
    settleWorkflowEffectFailure(context, methods, request, attempt, at, failure);
    return;
  }
  context.state.history.push({
    type: "effect-attempt-failed",
    sequence: request.sequence,
    attempt,
    at,
    nextAt: retryAt,
    failure,
  });
  context.state.time = at;
  recordWorkflowChange(context);
  scheduleWorkflowEffect(context, methods, request.sequence, retryAt);
}

function workflowEffectOutboundId(run: number, sequence: number, attempt: number): string {
  return `workflow:${run}:effect:${sequence}:attempt:${attempt}`;
}

function workflowEffectTimeoutReminder(run: number, sequence: number): string {
  return `workflow:${run}:effect:${sequence}:timeout`;
}

function cloneWorkflowData<Value>(value: Value): Value {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as Value;
}

function recordWorkflowReplayStep<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  step: WorkflowReplayStep,
): void {
  if (context.state.replay === undefined) {
    throw workflowNondeterminism("Workflow replay trace is missing.");
  }
  context.state.replay.steps.push(cloneWorkflowData(step));
}

function workflowArtifact(value: object): WorkflowRuntimeArtifact {
  return value as WorkflowRuntimeArtifact;
}

function workflowDataEqual(
  left: WorkflowData | undefined,
  right: WorkflowData | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function workflowNondeterminism(reason: string): WorkflowNondeterminismError {
  return new WorkflowNondeterminismError({
    type: "nondeterministic",
    data: { reason },
  });
}

function serializedWorkflowError(error: unknown): WorkflowSerializedError {
  if (error instanceof DependencyFailureError) {
    return {
      name: error.name,
      message: error.message,
      ...(error.retryDelay === undefined ? {} : { retryDelay: error.retryDelay }),
    };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: "Unknown Workflow execution failure." };
}

function workflowExecutionFailure(error: unknown): WorkflowExecutionFailure {
  const serialized = serializedWorkflowError(error);
  return {
    type: "execution",
    data: { name: serialized.name, message: serialized.message },
  };
}

function scheduleWorkflowAdvance<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
): void {
  const advance = methods.$advance;
  if (advance === undefined) throw new Error("Workflow advance method is unavailable.");
  context.reminders.schedule({
    id: `workflow:${context.state.run}:advance`,
    at: 0,
    method: advance,
    input: { run: context.state.run },
  });
}

function scheduleWorkflowEffect<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  sequence: number,
  at = 0,
): void {
  const effect = methods.$effect;
  if (effect === undefined) throw new Error("Workflow effect method is unavailable.");
  context.reminders.schedule({
    id: `workflow:${context.state.run}:effect:${sequence}`,
    at,
    method: effect,
    input: { run: context.state.run, sequence },
  });
}

function scheduleWorkflowEffectTimeout<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  sequence: number,
  attempt: number,
  at: number,
): void {
  const timeout = methods.$timeoutEffect;
  if (timeout === undefined) throw new Error("Workflow effect timeout method is unavailable.");
  context.reminders.schedule({
    id: workflowEffectTimeoutReminder(context.state.run, sequence),
    at,
    method: timeout,
    input: { run: context.state.run, sequence, attempt },
  });
}

function scheduleWorkflowTimer<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  sequence: number,
  at: number,
): void {
  const timer = methods.$timer;
  if (timer === undefined) throw new Error("Workflow timer method is unavailable.");
  context.reminders.schedule({
    id: `workflow:${context.state.run}:timer:${sequence}`,
    at,
    method: timer,
    input: { run: context.state.run, sequence, at },
  });
}

function scheduleWorkflowWait<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  sequence: number,
  at: number,
): void {
  const wait = methods.$wait;
  if (wait === undefined) throw new Error("Workflow wait method is unavailable.");
  context.reminders.schedule({
    id: `workflow:${context.state.run}:wait:${sequence}`,
    at,
    method: wait,
    input: { run: context.state.run, sequence, at },
  });
}

function closeWorkflowChildren<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  reason: "cancellation" | "parent-close",
): boolean {
  const complete = methods.$completeChildClose;
  if (complete === undefined) {
    throw new Error("Workflow child-close completion method is unavailable.");
  }
  let waiting = false;
  for (const child of context.state.children) {
    if (child.status !== "closed") {
      const policy = reason === "cancellation" ? child.cancellation : child.parentClose;
      if (policy !== "abandon") {
        const operation = policy === "terminate" ? "terminate" : "cancel";
        const wait = reason === "cancellation" && policy === "wait";
        const close = workflowChildCloseId(child.dependency, child.id);
        if (!context.state.pendingChildCloses.some((pending) => pending === close)) {
          context.state.pendingChildCloses.push(close);
          child.status = "closing";
          context.state.history.push({
            type: "child-close-requested",
            dependency: child.dependency,
            id: child.id,
            operation,
            at: context.invocation.at,
          });
          context.outbox.schedule({
            id: `workflow:${context.state.run}:child-close:${close}`,
            at: context.invocation.at,
            operation: "child-close",
            input: {
              dependency: child.dependency,
              id: child.id,
              operation,
              wait,
            },
            complete,
            completion: {
              dependency: child.dependency,
              id: child.id,
              wait,
            },
          });
        }
        if (wait) waiting = true;
      }
    }
  }
  return waiting;
}

function workflowChildCloseId(dependency: string, id: string): string {
  return `${dependency.length}:${dependency}:${id}`;
}

function cancelWorkflowWork<Model extends WorkflowModelDefinition>(
  context: RuntimeWorkflowContext<Model>,
  methods: Readonly<Record<string, CallableFunction>>,
  reason: "cancel" | "terminate",
): boolean {
  const waiting: number[] = [];
  const pending = workflowExecutionFrame(context).pending;
  for (const effectSequence of context.state.pendingEffects) {
    if (reason === "cancel" && !workflowPendingEffectCancellable(context, effectSequence)) {
      waiting.push(effectSequence);
    } else {
      context.reminders.cancel({
        id: `workflow:${context.state.run}:effect:${effectSequence}`,
      });
      context.reminders.cancel({
        id: workflowEffectTimeoutReminder(context.state.run, effectSequence),
      });
      const attempts = context.state.history.filter(
        (event) => event.type === "effect-attempt-started" && event.sequence === effectSequence,
      );
      const latest = attempts[attempts.length - 1];
      if (latest?.type === "effect-attempt-started") {
        const outbound = workflowEffectOutboundId(
          context.state.run,
          effectSequence,
          latest.attempt,
        );
        const request = workflowEffectRequest(context, effectSequence);
        const cancellation = request.options?.cancellation ?? "request";
        if (reason === "terminate" || cancellation === "request") {
          context.outbox.cancel({ id: outbound });
        } else if (cancellation === "wait") {
          context.outbox.requestCancellation({ id: outbound });
          waiting.push(effectSequence);
        }
      }
    }
  }
  const timers: number[] = [];
  for (const timerSequence of context.state.pendingTimers) {
    if (
      reason === "cancel" &&
      pending?.kind === "sleep" &&
      pending.sequence === timerSequence &&
      !pending.cancellable
    ) {
      timers.push(timerSequence);
    } else {
      context.reminders.cancel({
        id: `workflow:${context.state.run}:timer:${timerSequence}`,
      });
    }
  }
  const waits: number[] = [];
  for (const waitSequence of context.state.pendingWaits) {
    if (
      reason === "cancel" &&
      pending?.kind === "wait" &&
      pending.sequence === waitSequence &&
      !pending.cancellable
    ) {
      waits.push(waitSequence);
    } else {
      context.reminders.cancel({
        id: `workflow:${context.state.run}:wait:${waitSequence}`,
      });
    }
  }
  context.state.pendingEffects = waiting;
  context.state.pendingTimers = timers;
  context.state.pendingWaits = waits;
  const waitingForChildren =
    reason === "cancel"
      ? closeWorkflowChildren(context, methods, "cancellation")
      : closeWorkflowChildren(context, methods, "parent-close");
  return waiting.length > 0 || timers.length > 0 || waits.length > 0 || waitingForChildren;
}

function terminalWorkflowStatus(status: WorkflowStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "terminated"
  );
}

function activeWorkflowStatus(status: WorkflowStatus): boolean {
  return status === "running" || status === "paused" || status === "cancelling";
}

async function executeWorkflowEffect<Model extends WorkflowModelDefinition>(
  runtime: object,
  dependencies: Readonly<Record<string, DependencyContract>>,
  clock: Clock,
  request: Readonly<{
    id: Model["Id"];
    run: number;
    sequence: number;
    attempt: number;
    outbound: string;
    generation: number;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<Readonly<{ status: WorkflowStatus }>> {
  const claim = await claimActorOutbound(
    runtime,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
    },
    {
      idempotencyKey: `${invocation.id}:claim`,
      attempt: invocation.attempt,
      scheduledAt: invocation.scheduledAt,
      startedAt: invocation.startedAt,
    },
  );
  if (claim.status === "settled") return { status: "running" };
  if (claim.status === "busy") {
    const remaining = claim.retryAt - clock.now({});
    throw new DependencyFailureError({
      type: "WorkflowEffectBusy",
      data: { retryAt: claim.retryAt },
      retry: { delay: remaining < 0 ? 0 : remaining },
    });
  }
  const dispatch = await dispatchDependency<WorkflowEffectDispatch>(
    runtime,
    "$effectDispatch",
    {
      key: request.id,
      input: {
        run: request.run,
        sequence: request.sequence,
        attempt: request.attempt,
        at: clock.now({}),
      },
    },
    {
      idempotencyKey: `${claim.invocation}:policy`,
      attempt: claim.attempt,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
    },
  );
  let outcome: WorkflowEffectOutcome;
  if (dispatch.status === "settled") {
    outcome = {
      status: "failed",
      failure: {
        name: "WorkflowEffectSettled",
        message: `Workflow effect ${request.sequence} no longer accepts a result.`,
      },
    };
  } else if (dispatch.status === "expired") {
    outcome = { status: "failed", failure: dispatch.failure };
  } else if (claim.cancellationRequested) {
    outcome = {
      status: "failed",
      failure: {
        name: "WorkflowEffectCancelled",
        message: `Workflow effect ${request.sequence} was cancelled before dispatch.`,
      },
    };
  } else {
    const dependency = dependencies[dispatch.request.dependency];
    if (dependency === undefined) {
      outcome = {
        status: "failed",
        failure: {
          name: "WorkflowDependencyError",
          message: `Workflow Dependency ${dispatch.request.dependency} is unavailable.`,
        },
      };
    } else {
      try {
        let heartbeat = 0;
        const value = await dispatchDependency<WorkflowData>(
          dependency,
          dispatch.request.operation,
          dispatch.request.input,
          {
            idempotencyKey: dispatch.request.idempotencyKey,
            attempt: dispatch.attempt,
            scheduledAt: dispatch.request.scheduledAt,
            startedAt: clock.now({}),
            ...(dispatch.deadline === undefined ? {} : { deadline: dispatch.deadline }),
            ...(dispatch.previousHeartbeat === undefined
              ? {}
              : { previousHeartbeat: dispatch.previousHeartbeat }),
            ...(dispatch.request.options?.cancellation === "abandon"
              ? {}
              : { cancellation: invocation.cancellation }),
            async heartbeat(details: WorkflowData) {
              heartbeat += 1;
              const accepted = actorValue(
                await dispatchDependency<Actor.Outcome<Readonly<{ accepted: boolean }>>>(
                  runtime,
                  "$heartbeatEffect",
                  {
                    key: request.id,
                    input: {
                      run: request.run,
                      sequence: request.sequence,
                      attempt: request.attempt,
                      at: clock.now({}),
                      details,
                    },
                  },
                  {
                    idempotencyKey: `${claim.invocation}:heartbeat:${heartbeat}:workflow`,
                  },
                ),
              );
              if (!accepted.accepted) {
                throw new Error("Workflow effect heartbeat is stale.");
              }
              const current = await heartbeatActorOutbound(
                runtime,
                {
                  key: request.id,
                  id: request.outbound,
                  generation: request.generation,
                  owner: claim.owner,
                  attempt: claim.attempt,
                },
                {
                  idempotencyKey: `${claim.invocation}:heartbeat:${heartbeat}:lease`,
                },
              );
              if (!current) {
                throw new Error("Workflow effect outbound claim is stale.");
              }
            },
          },
        );
        outcome = { status: "succeeded", value: cloneWorkflowData(value) };
      } catch (error) {
        outcome = { status: "failed", failure: serializedWorkflowError(error) };
      }
    }
  }
  await completeActorOutbound(
    runtime,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
      owner: claim.owner,
      attempt: claim.attempt,
      output: outcome,
    },
    {
      idempotencyKey: `${claim.invocation}:complete`,
      attempt: claim.attempt,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
    },
  );
  return { status: "running" };
}

async function executeWorkflowChildClose<Model extends WorkflowModelDefinition>(
  runtime: object,
  dependencies: Readonly<Record<string, DependencyContract>>,
  clock: Clock,
  timer: Timer,
  request: Readonly<{
    id: Model["Id"];
    dependency: string;
    child: string;
    operation: "cancel" | "terminate";
    wait: boolean;
    outbound: string;
    generation: number;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<Readonly<{ status: WorkflowStatus }>> {
  const claim = await claimActorOutbound(
    runtime,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
    },
    {
      idempotencyKey: `${invocation.id}:claim`,
      attempt: invocation.attempt,
      scheduledAt: invocation.scheduledAt,
      startedAt: invocation.startedAt,
    },
  );
  if (claim.status === "settled") return { status: "running" };
  if (claim.status === "busy") {
    const remaining = claim.retryAt - clock.now({});
    throw new DependencyFailureError({
      type: "WorkflowChildCloseBusy",
      data: { retryAt: claim.retryAt },
      retry: { delay: remaining < 0 ? 0 : remaining },
    });
  }
  const child = dependencies[request.dependency];
  if (child === undefined) {
    throw new DependencyFailureError({
      type: "WorkflowChildUnavailable",
      data: { dependency: request.dependency },
    });
  }
  const closed = await dispatchDependency<Readonly<{ status: WorkflowStatus }>>(
    child,
    request.operation,
    { id: request.child },
    {
      idempotencyKey: claim.invocation,
      attempt: claim.attempt,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
      cancellation: invocation.cancellation,
    },
  );
  const result = request.wait
    ? await dispatchDependency<WorkflowTerminalResultSnapshot<Model>>(
        child,
        "$join",
        { id: request.child },
        {
          idempotencyKey: `${claim.invocation}:join`,
          attempt: claim.attempt,
          scheduledAt: claim.scheduledAt,
          startedAt: claim.startedAt,
          cancellation: invocation.cancellation,
        },
      )
    : closed;
  await completeActorOutbound(
    runtime,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
      owner: claim.owner,
      attempt: claim.attempt,
      output: { status: result.status },
    },
    {
      idempotencyKey: `${claim.invocation}:complete`,
      attempt: claim.attempt,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
    },
  );
  return { status: result.status };
}

async function waitForWorkflowResult<Model extends WorkflowModelDefinition>(
  runtime: object,
  clock: Clock,
  timer: Timer,
  id: Model["Id"],
  cancellation?: DependencyCancellation,
): Promise<WorkflowTerminalResultSnapshot<Model>> {
  while (true) {
    if (cancellation !== undefined && cancellation.requested()) {
      throw new DependencyFailureError({
        type: "WorkflowJoinCancelled",
        data: { id },
      });
    }
    const result = await dispatchDependency<WorkflowResultSnapshot<Model>>(runtime, "result", {
      key: id,
    });
    if (
      result.status === "succeeded" ||
      result.status === "failed" ||
      result.status === "cancelled" ||
      result.status === "terminated"
    ) {
      return result;
    }
    await timer.sleep({ until: clock.now({}) + 25 });
  }
}

async function executeWorkflowScheduleOutbound<Model extends WorkflowModelDefinition>(
  schedules: object,
  workflows: object,
  calendar: Calendar,
  clock: Clock,
  operation: "$scheduleCalendar" | "$scheduleStart" | "$scheduleInspect" | "$scheduleClose",
  request: WorkflowScheduleOutboundRequest,
  invocation: RuntimeDependencyInvocation,
): Promise<Readonly<{ completed: boolean }>> {
  const claim = await claimActorOutbound(
    schedules,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
    },
    {
      idempotencyKey: `${invocation.id}:claim`,
      attempt: invocation.attempt,
      scheduledAt: invocation.scheduledAt,
      startedAt: invocation.startedAt,
    },
  );
  if (claim.status === "settled") return { completed: true };
  if (claim.status === "busy") {
    const remaining = claim.retryAt - clock.now({});
    throw new DependencyFailureError({
      type: "WorkflowScheduleBusy",
      data: { retryAt: claim.retryAt },
      retry: { delay: remaining < 0 ? 0 : remaining },
    });
  }
  const options = {
    idempotencyKey: claim.invocation,
    attempt: claim.attempt,
    scheduledAt: claim.scheduledAt,
    startedAt: claim.startedAt,
    cancellation: invocation.cancellation,
  };
  let output: object;
  if (operation === "$scheduleCalendar") {
    const timing = request.input as Readonly<{
      after: number;
      definition: WorkflowScheduleDefinition<Model>;
    }>;
    output = {
      seed: await workflowScheduleSeed(calendar, timing.definition, timing.after),
    };
  } else if (operation === "$scheduleStart") {
    const start = request.input as Readonly<{
      occurrence: WorkflowScheduleOccurrence;
      execution: Model["Id"];
      workflowInput: Model["Input"];
    }>;
    output = await dispatchDependency<object>(
      workflows,
      "$start",
      {
        key: start.execution,
        input: {
          input: start.workflowInput,
          conflict: "use",
          reuse: "allow",
        },
        idempotencyKey: start.occurrence.id,
      },
      options,
    );
  } else if (operation === "$scheduleInspect") {
    const inspect = request.input as Readonly<{ execution: Model["Id"] }>;
    output = await dispatchDependency<object>(
      workflows,
      "describe",
      { key: inspect.execution },
      options,
    );
  } else {
    const close = request.input as Readonly<{
      execution: Model["Id"];
      occurrence: string;
    }>;
    const closeOperation = request.operation ?? "cancel";
    output = await dispatchDependency<object>(
      workflows,
      closeOperation,
      {
        key: close.execution,
        idempotencyKey: `${claim.invocation}:${close.occurrence}`,
      },
      options,
    );
  }
  const completed = await completeActorOutbound(
    schedules,
    {
      key: request.id,
      id: request.outbound,
      generation: request.generation,
      owner: claim.owner,
      attempt: claim.attempt,
      output,
    },
    {
      idempotencyKey: `${claim.invocation}:complete`,
      attempt: claim.attempt,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
    },
  );
  return { completed };
}

async function listWorkflows<Model extends WorkflowModelDefinition>(
  runtime: object,
  visibility: readonly string[],
  request: WorkflowListRequest<Model>,
): Promise<WorkflowListPage<Model>> {
  return await scanWorkflowVisibility(runtime, visibility, request);
}

async function listWorkflowScheduleRuns<Model extends WorkflowModelDefinition>(
  runtime: object,
  visibility: readonly string[],
  request: WorkflowListRequest<Model> & Readonly<{ id: string }>,
): Promise<WorkflowScheduleRunPage<Model>> {
  if (request.id.length === 0) throw new TypeError("Workflow schedule id must be non-empty.");
  const prefix = workflowScheduleExecutionPrefix(request.id);
  const page = await scanWorkflowVisibility(runtime, visibility, request, prefix);
  return {
    cursor: page.cursor,
    runs: page.workflows.map((entry) => ({
      occurrence: (entry.workflow.id as string).slice(prefix.length),
      workflow: entry.workflow,
      state: entry.state,
    })),
    done: page.done,
  };
}

async function scanWorkflowVisibility<Model extends WorkflowModelDefinition>(
  runtime: object,
  visibility: readonly string[],
  request: WorkflowListRequest<Model>,
  prefix?: string,
): Promise<WorkflowListPage<Model>> {
  const limit = workflowPageLimit(request.limit);
  const after = workflowPageCursor(request.after);
  validateWorkflowVisibilityFilter(request.where, visibility);
  const workflows: WorkflowListEntry<Model>[] = [];
  const page = await listActorKeys<string>(runtime, { after, limit });
  let cursor = after;
  for (const entry of page.entries) {
    cursor = entry.cursor;
    if (prefix === undefined || entry.key.startsWith(prefix)) {
      const snapshot = await dispatchDependency<WorkflowVisibilitySnapshot<Model>>(
        runtime,
        "$visibility",
        { key: entry.key as Model["Id"] },
      );
      if (workflowVisibilityMatches(snapshot, request.where, visibility)) {
        workflows.push({
          workflow: snapshot.workflow,
          state: projectWorkflowVisibility(snapshot.state, visibility),
        });
      }
    }
  }
  return { cursor, workflows, done: page.done };
}

async function listWorkflowSchedules<Model extends WorkflowModelDefinition>(
  runtime: object,
  request: WorkflowScheduleListRequest,
): Promise<WorkflowScheduleListPage<Model>> {
  const limit = workflowPageLimit(request.limit);
  const after = workflowPageCursor(request.after);
  const statuses = request.where?.status;
  validateWorkflowScheduleStatuses(statuses);
  const schedules: WorkflowScheduleDescription<Model>[] = [];
  const page = await listActorKeys<string>(runtime, { after, limit });
  let cursor = after;
  for (const entry of page.entries) {
    cursor = entry.cursor;
    const schedule = await dispatchDependency<WorkflowScheduleDescription<Model>>(
      runtime,
      "describe",
      { key: entry.key },
    );
    if (statuses === undefined || statuses.some((status) => status === schedule.status)) {
      schedules.push(schedule);
    }
  }
  return { cursor, schedules, done: page.done };
}

function workflowPageCursor(after: number | undefined): number {
  const cursor = after ?? 0;
  if (cursor % 1 !== 0 || cursor < 0 || cursor > 9_007_199_254_740_991) {
    throw new TypeError("Workflow list cursor must be a non-negative safe integer.");
  }
  return cursor;
}

function workflowPageLimit(limit: number | undefined): number {
  const size = limit ?? 50;
  if (size % 1 !== 0 || size < 1 || size > workflowVisibilityPageMaximum) {
    throw new TypeError(
      `Workflow list page size must be between 1 and ${workflowVisibilityPageMaximum}.`,
    );
  }
  return size;
}

function validateWorkflowVisibilityFilter<Model extends WorkflowModelDefinition>(
  where: WorkflowVisibilityFilter<Model> | undefined,
  visibility: readonly string[],
): void {
  if (where === undefined) return;
  validateWorkflowStatuses(where.status);
  validateWorkflowTimeRange("startedAt", where.startedAt);
  validateWorkflowTimeRange("closedAt", where.closedAt);
  if (where.state === undefined) return;
  for (const name of Object.keys(where.state)) {
    if (!visibility.some((candidate) => candidate === name)) {
      throw new TypeError(`Workflow State field ${JSON.stringify(name)} is not visible.`);
    }
    const condition = (where.state as Readonly<Record<string, object>>)[name];
    if (condition === undefined || Object.keys(condition).length === 0) {
      throw new TypeError(`Workflow visibility condition ${JSON.stringify(name)} is empty.`);
    }
  }
}

function validateWorkflowStatuses(statuses: readonly WorkflowStatus[] | undefined): void {
  if (statuses === undefined) return;
  if (statuses.length === 0) throw new TypeError("Workflow status filter must not be empty.");
  let index = 0;
  while (index < statuses.length) {
    const status = statuses[index];
    if (status === undefined) throw new TypeError("Workflow status filter is sparse.");
    if (!workflowStatus(status)) {
      throw new TypeError(`Unknown Workflow status ${JSON.stringify(status)}.`);
    }
    index += 1;
  }
}

function validateWorkflowScheduleStatuses(
  statuses: readonly WorkflowScheduleStatus[] | undefined,
): void {
  if (statuses === undefined) return;
  if (statuses.length === 0) {
    throw new TypeError("Workflow schedule status filter must not be empty.");
  }
  let index = 0;
  while (index < statuses.length) {
    const status = statuses[index];
    if (status === undefined) throw new TypeError("Workflow schedule status filter is sparse.");
    if (status !== "active" && status !== "paused" && status !== "deleted") {
      throw new TypeError(`Unknown Workflow schedule status ${JSON.stringify(status)}.`);
    }
    index += 1;
  }
}

function workflowStatus(status: string): status is WorkflowStatus {
  return (
    status === "idle" ||
    status === "running" ||
    status === "paused" ||
    status === "cancelling" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "terminated"
  );
}

function validateWorkflowTimeRange(
  name: string,
  range: Readonly<{ from?: number; through?: number }> | undefined,
): void {
  if (range === undefined) return;
  if (
    (range.from !== undefined &&
      (range.from !== range.from ||
        range.from < -9_007_199_254_740_991 ||
        range.from > 9_007_199_254_740_991)) ||
    (range.through !== undefined &&
      (range.through !== range.through ||
        range.through < -9_007_199_254_740_991 ||
        range.through > 9_007_199_254_740_991))
  ) {
    throw new TypeError(`Workflow ${name} range must contain finite times.`);
  }
  if (range.from !== undefined && range.through !== undefined && range.from > range.through) {
    throw new TypeError(`Workflow ${name} range cannot end before it starts.`);
  }
}

function workflowVisibilityMatches<Model extends WorkflowModelDefinition>(
  snapshot: WorkflowVisibilitySnapshot<Model>,
  where: WorkflowVisibilityFilter<Model> | undefined,
  visibility: readonly string[],
): boolean {
  if (where === undefined) return true;
  if (
    where.status !== undefined &&
    !where.status.some((status) => status === snapshot.workflow.status)
  ) {
    return false;
  }
  if (!workflowTimeMatches(snapshot.workflow.startedAt, where.startedAt)) return false;
  if (!workflowTimeMatches(snapshot.workflow.closedAt, where.closedAt)) return false;
  if (where.state === undefined) return true;
  const state = snapshot.state as Readonly<Record<string, WorkflowVisibilityValue | undefined>>;
  const filters = where.state as Readonly<Record<string, object>>;
  let visibilityIndex = 0;
  while (visibilityIndex < visibility.length) {
    const name = visibility[visibilityIndex];
    if (name === undefined) throw new TypeError("Workflow visibility declaration is sparse.");
    const condition = filters[name];
    if (condition !== undefined && !workflowVisibilityConditionMatches(state?.[name], condition)) {
      return false;
    }
    visibilityIndex += 1;
  }
  return true;
}

function workflowTimeMatches(
  value: number | undefined,
  range: Readonly<{ from?: number; through?: number }> | undefined,
): boolean {
  if (range === undefined) return true;
  if (value === undefined) return false;
  if (range.from !== undefined && value < range.from) return false;
  if (range.through !== undefined && value > range.through) return false;
  return true;
}

function workflowVisibilityConditionMatches(
  value: WorkflowVisibilityValue | undefined,
  condition: object,
): boolean {
  const filter = condition as Readonly<{
    exists?: boolean;
    equals?: WorkflowVisibilityValue;
    not?: WorkflowVisibilityValue;
    oneOf?: readonly WorkflowVisibilityValue[];
    atLeast?: number;
    atMost?: number;
  }>;
  if (filter.exists !== undefined && filter.exists !== (value !== undefined)) return false;
  if (filter.equals !== undefined && value !== filter.equals) return false;
  if (filter.not !== undefined && value === filter.not) return false;
  if (filter.oneOf !== undefined && !filter.oneOf.some((candidate) => candidate === value)) {
    return false;
  }
  const numeric = value as number | undefined;
  if (filter.atLeast !== undefined && (numeric === undefined || numeric < filter.atLeast)) {
    return false;
  }
  if (filter.atMost !== undefined && (numeric === undefined || numeric > filter.atMost)) {
    return false;
  }
  return true;
}

function projectWorkflowVisibility<Model extends WorkflowModelDefinition>(
  state: Model["State"] | undefined,
  visibility: readonly string[],
): WorkflowVisibleState<Model> {
  const projected: Record<string, WorkflowVisibilityValue> = {};
  const values = state as Readonly<Record<string, WorkflowVisibilityValue | undefined>> | undefined;
  let index = 0;
  while (index < visibility.length) {
    const name = visibility[index];
    if (name === undefined) throw new TypeError("Workflow visibility declaration is sparse.");
    const value = values?.[name];
    if (value !== undefined) projected[name] = value;
    index += 1;
  }
  return projected as WorkflowVisibleState<Model>;
}

function workflowScheduleOperation(operation: string): operation is WorkflowScheduleOperation {
  return (
    operation === "createSchedule" ||
    operation === "updateSchedule" ||
    operation === "describeSchedule" ||
    operation === "pauseSchedule" ||
    operation === "resumeSchedule" ||
    operation === "triggerSchedule" ||
    operation === "backfillSchedule" ||
    operation === "deleteSchedule"
  );
}

async function dispatchWorkflowScheduleOperation<Model extends WorkflowModelDefinition>(
  runtime: object,
  calendar: Calendar,
  clock: Clock,
  operation: WorkflowScheduleOperation,
  request: WorkflowScheduleWireRequest<Model>,
  invocation: RuntimeDependencyInvocation,
): Promise<object> {
  if (request.id.length === 0) throw new TypeError("Workflow schedule id must be non-empty.");
  const idempotencyKey = invocation.id;
  if (operation === "describeSchedule") {
    return await dispatchDependency<WorkflowScheduleDescription<Model>>(runtime, "describe", {
      key: request.id,
    });
  }
  if (operation === "createSchedule" || operation === "updateSchedule") {
    if (request.definition === undefined) {
      throw new TypeError(`${operation} requires a schedule definition.`);
    }
    validateWorkflowSchedule(request.definition);
    validateWorkflowScheduleNumber("remaining", request.remaining);
    const seed = await workflowScheduleSeed(calendar, request.definition, clock.now({}));
    const input =
      operation === "createSchedule"
        ? {
            definition: request.definition,
            seed,
            paused: request.paused ?? false,
            trigger: request.trigger ?? false,
            ...(request.note === undefined ? {} : { note: request.note }),
            ...(request.remaining === undefined ? {} : { remaining: request.remaining }),
          }
        : {
            definition: request.definition,
            seed,
            ...(request.note === undefined ? {} : { note: request.note }),
            ...(request.remaining === undefined ? {} : { remaining: request.remaining }),
          };
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowScheduleMutation<Model>>>(
        runtime,
        operation === "createSchedule" ? "$create" : "$update",
        {
          key: request.id,
          input,
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "resumeSchedule") {
    const description = await dispatchDependency<WorkflowScheduleDescription<Model>>(
      runtime,
      "describe",
      { key: request.id },
    );
    const resumeSeed =
      description.definition === undefined
        ? {}
        : await workflowScheduleSeed(calendar, description.definition, clock.now({}));
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowScheduleMutation<Model>>>(
        runtime,
        "$resume",
        {
          key: request.id,
          input: {
            seed: resumeSeed,
            ...(request.note === undefined ? {} : { note: request.note }),
          },
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "backfillSchedule") {
    validateWorkflowScheduleOverlap(request.overlap);
    const from = request.from;
    const through = request.through;
    if (
      !safeWorkflowScheduleInteger(from) ||
      !safeWorkflowScheduleInteger(through) ||
      (from ?? 0) > (through ?? 0)
    ) {
      throw new TypeError("Workflow backfill bounds must be ordered safe integer milliseconds.");
    }
    const backfillFrom = from ?? 0;
    const backfillThrough = through ?? 0;
    const backfillDescription = await dispatchDependency<WorkflowScheduleDescription<Model>>(
      runtime,
      "describe",
      { key: request.id },
    );
    const occurrences =
      backfillDescription.definition === undefined
        ? []
        : await workflowScheduleOccurrences(
            calendar,
            backfillDescription.definition,
            backfillFrom,
            backfillThrough,
            1_000,
          );
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowScheduleBackfillResult>>(
        runtime,
        "$backfill",
        {
          key: request.id,
          input: {
            occurrences,
            ...(request.overlap === undefined ? {} : { overlap: request.overlap }),
          },
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "triggerSchedule") {
    validateWorkflowScheduleOverlap(request.overlap);
  }
  const method =
    operation === "pauseSchedule"
      ? "$pause"
      : operation === "triggerSchedule"
        ? "$trigger"
        : "$delete";
  return actorValue(
    await dispatchDependency<Actor.Outcome<object>>(
      runtime,
      method,
      {
        key: request.id,
        input:
          operation === "triggerSchedule"
            ? request.overlap === undefined
              ? {}
              : { overlap: request.overlap }
            : operation === "pauseSchedule"
              ? request.note === undefined
                ? {}
                : { note: request.note }
              : undefined,
        idempotencyKey,
      },
      { idempotencyKey },
    ),
  );
}

function validateWorkflowSchedule<Model extends WorkflowModelDefinition>(
  definition: WorkflowScheduleDefinition<Model>,
): void {
  validateWorkflowScheduleTiming(definition.timing);
  const from = definition.active?.from;
  const until = definition.active?.until;
  validateWorkflowScheduleNumber("active.from", from);
  validateWorkflowScheduleNumber("active.until", until);
  validateWorkflowScheduleNumber("jitter", definition.jitter);
  validateWorkflowScheduleNumber("catchUp", definition.catchUp);
  validateWorkflowScheduleOverlap(definition.overlap);
  if (from !== undefined && until !== undefined && from > until) {
    throw new TypeError("Workflow schedule active bounds must be ordered.");
  }
}

function validateWorkflowScheduleOverlap(overlap: WorkflowScheduleOverlap | undefined): void {
  if (
    overlap !== undefined &&
    overlap !== "skip" &&
    overlap !== "buffer-one" &&
    overlap !== "buffer-all" &&
    overlap !== "cancel-current" &&
    overlap !== "terminate-current" &&
    overlap !== "concurrent"
  ) {
    throw new TypeError("Workflow schedule overlap policy is invalid.");
  }
}

function validateWorkflowScheduleTiming(timing: WorkflowScheduleTiming): void {
  const composite = workflowScheduleCompositeTiming(timing);
  if (composite !== undefined) {
    if (composite.any.length === 0) {
      throw new TypeError("Workflow schedule timing.any must contain at least one timing.");
    }
    for (const moment of composite.any) validateWorkflowScheduleMoment(moment);
    if (composite.except !== undefined) {
      for (const exception of composite.except) {
        validateWorkflowScheduleMoment(exception);
        if (workflowScheduleIntervalTiming(exception) !== undefined) {
          throw new TypeError("Workflow schedule exclusions must use civil-calendar timing.");
        }
      }
    }
    return;
  }
  validateWorkflowScheduleMoment(timing as WorkflowScheduleMoment);
}

function validateWorkflowScheduleMoment(timing: WorkflowScheduleMoment): void {
  const interval = workflowScheduleIntervalTiming(timing);
  const cron = workflowScheduleCronTiming(timing);
  const calendar = workflowScheduleCalendarTiming(timing);
  const kinds =
    (interval === undefined ? 0 : 1) +
    (cron === undefined ? 0 : 1) +
    (calendar === undefined ? 0 : 1);
  if (kinds !== 1) {
    throw new TypeError("A Workflow schedule timing must select exactly one timing kind.");
  }
  if (interval !== undefined) {
    if (!safeWorkflowScheduleInteger(interval.every) || interval.every < 1) {
      throw new TypeError("Workflow schedule interval must be a positive safe integer.");
    }
    const offset = interval.offset ?? 0;
    if (!safeWorkflowScheduleInteger(offset) || offset < 0 || offset >= interval.every) {
      throw new TypeError("Workflow schedule interval offset must be within its interval.");
    }
  } else if (cron !== undefined) {
    if (cron.cron.length === 0) {
      throw new TypeError("Workflow schedule cron must be non-empty.");
    }
  } else if (calendar === undefined) {
    throw new TypeError("Workflow schedule calendar must be an object.");
  }
}

function validateWorkflowScheduleNumber(name: string, value: number | undefined): void {
  if (value !== undefined && (!safeWorkflowScheduleInteger(value) || value < 0)) {
    throw new TypeError(`Workflow schedule ${name} must be a non-negative safe integer.`);
  }
}

async function workflowScheduleSeed<Model extends WorkflowModelDefinition>(
  calendar: Calendar,
  definition: WorkflowScheduleDefinition<Model>,
  after: number,
): Promise<WorkflowScheduleSeed> {
  const next = await nextWorkflowScheduleTime(calendar, definition, after);
  if (next === undefined) return {};
  const following = await nextWorkflowScheduleTime(calendar, definition, next);
  return {
    next,
    ...(following === undefined ? {} : { following }),
  };
}

async function workflowScheduleOccurrences<Model extends WorkflowModelDefinition>(
  calendar: Calendar,
  definition: WorkflowScheduleDefinition<Model>,
  from: number,
  through: number,
  maximum: number,
): Promise<readonly number[]> {
  const occurrences: number[] = [];
  let after = from - 1;
  let next = await nextWorkflowScheduleTime(calendar, definition, after);
  while (occurrences.length < maximum && next !== undefined && next <= through) {
    occurrences.push(next);
    after = next;
    next = await nextWorkflowScheduleTime(calendar, definition, after);
  }
  if (occurrences.length === maximum && next !== undefined && next <= through) {
    throw new RangeError(`Workflow schedule backfill exceeds ${maximum} occurrences.`);
  }
  return occurrences;
}

async function nextWorkflowScheduleTime<Model extends WorkflowModelDefinition>(
  calendar: Calendar,
  definition: WorkflowScheduleDefinition<Model>,
  after: number,
): Promise<number | undefined> {
  const activeStart = (definition.active?.from ?? after + 1) - 1;
  const lower = after > activeStart ? after : activeStart;
  const through = definition.active?.until ?? 9_007_199_254_740_991;
  return await nextWorkflowScheduleNominal(calendar, definition, definition.timing, lower, through);
}

async function nextWorkflowScheduleNominal<Model extends WorkflowModelDefinition>(
  calendar: Calendar,
  definition: WorkflowScheduleDefinition<Model>,
  timing: WorkflowScheduleTiming,
  after: number,
  through: number,
): Promise<number | undefined> {
  const composite = workflowScheduleCompositeTiming(timing);
  if (composite === undefined) {
    return await nextWorkflowScheduleMoment(
      calendar,
      definition,
      timing as WorkflowScheduleMoment,
      after,
      through,
    );
  }
  let cursor = after;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    let candidate: number | undefined;
    for (const moment of composite.any) {
      const next = await nextWorkflowScheduleMoment(calendar, definition, moment, cursor, through);
      if (next !== undefined && (candidate === undefined || next < candidate)) {
        candidate = next;
      }
    }
    if (candidate === undefined) return undefined;
    let excluded = false;
    for (const exception of composite.except ?? []) {
      const match: Readonly<{ at: number }> | undefined = await calendar.next(
        workflowScheduleCalendarRequest(exception, candidate - 1, candidate),
      );
      if (match?.at === candidate) excluded = true;
    }
    if (!excluded) return candidate;
    cursor = candidate;
  }
  throw new RangeError("Workflow schedule exclusions did not converge after 10,000 matches.");
}

async function nextWorkflowScheduleMoment<Model extends WorkflowModelDefinition>(
  calendar: Calendar,
  definition: WorkflowScheduleDefinition<Model>,
  timing: WorkflowScheduleMoment,
  after: number,
  through: number,
): Promise<number | undefined> {
  const interval = workflowScheduleIntervalTiming(timing);
  if (interval !== undefined) {
    return nextWorkflowScheduleInterval(interval, definition, after);
  }
  return (
    await calendar.next(
      workflowScheduleCalendarRequest(
        timing as Exclude<WorkflowScheduleMoment, Readonly<{ every: number; offset?: number }>>,
        after,
        through,
      ),
    )
  )?.at;
}

function nextWorkflowScheduleInterval<Model extends WorkflowModelDefinition>(
  timing: Readonly<{ every: number; offset?: number }>,
  definition: WorkflowScheduleDefinition<Model>,
  after: number,
): number | undefined {
  const offset = timing.offset ?? 0;
  const next =
    after < offset
      ? offset
      : offset +
        ((after - offset - ((after - offset) % timing.every)) / timing.every + 1) * timing.every;
  return next > (definition.active?.until ?? 9_007_199_254_740_991) ? undefined : next;
}

function workflowScheduleCalendarRequest(
  timing: Exclude<WorkflowScheduleMoment, Readonly<{ every: number; offset?: number }>>,
  after: number,
  through: number,
): Readonly<{
  after: number;
  through: number;
  timeZone: string;
  pattern: Readonly<{ calendar: CalendarPattern }> | Readonly<{ cron: string }>;
}> {
  const cron = workflowScheduleCronTiming(timing);
  const calendar = workflowScheduleCalendarTiming(timing);
  if (cron === undefined && calendar === undefined) {
    throw new TypeError("Workflow schedule calendar timing is unavailable.");
  }
  const timeZone = cron?.timeZone ?? calendar?.timeZone ?? "UTC";
  const horizon = 12_622_780_800_000;
  const horizonEnd =
    after + horizon > 9_007_199_254_740_991 ? 9_007_199_254_740_991 : after + horizon;
  const limitedThrough = through < horizonEnd ? through : horizonEnd;
  return {
    after,
    through: limitedThrough,
    timeZone,
    pattern:
      cron === undefined
        ? { calendar: (calendar as Readonly<{ calendar: CalendarPattern }>).calendar }
        : { cron: cron.cron },
  };
}

function workflowScheduleCompositeTiming(timing: WorkflowScheduleTiming):
  | Readonly<{
      any: readonly WorkflowScheduleMoment[];
      except?: readonly Exclude<
        WorkflowScheduleMoment,
        Readonly<{ every: number; offset?: number }>
      >[];
    }>
  | undefined {
  const candidate = timing as Partial<
    Readonly<{
      any: readonly WorkflowScheduleMoment[];
      except?: readonly Exclude<
        WorkflowScheduleMoment,
        Readonly<{ every: number; offset?: number }>
      >[];
    }>
  >;
  return candidate.any === undefined
    ? undefined
    : (candidate as Readonly<{
        any: readonly WorkflowScheduleMoment[];
        except?: readonly Exclude<
          WorkflowScheduleMoment,
          Readonly<{ every: number; offset?: number }>
        >[];
      }>);
}

function workflowScheduleIntervalTiming(
  timing: WorkflowScheduleTiming,
): Readonly<{ every: number; offset?: number }> | undefined {
  const candidate = timing as Partial<Readonly<{ every: number; offset?: number }>>;
  return candidate.every === undefined
    ? undefined
    : (candidate as Readonly<{ every: number; offset?: number }>);
}

function safeWorkflowScheduleInteger(value: number | undefined): value is number {
  return (
    value !== undefined &&
    value >= -9_007_199_254_740_991 &&
    value <= 9_007_199_254_740_991 &&
    value % 1 === 0
  );
}

function workflowScheduleCronTiming(
  timing: WorkflowScheduleTiming,
): Readonly<{ cron: string; timeZone?: string }> | undefined {
  const candidate = timing as Partial<Readonly<{ cron: string; timeZone?: string }>>;
  return candidate.cron === undefined
    ? undefined
    : (candidate as Readonly<{ cron: string; timeZone?: string }>);
}

function workflowScheduleCalendarTiming(
  timing: WorkflowScheduleTiming,
): Readonly<{ calendar: CalendarPattern; timeZone?: string }> | undefined {
  const candidate = timing as Partial<Readonly<{ calendar: CalendarPattern; timeZone?: string }>>;
  return candidate.calendar === undefined
    ? undefined
    : (candidate as Readonly<{ calendar: CalendarPattern; timeZone?: string }>);
}

async function dispatchWorkflowOperation<Model extends WorkflowModelDefinition>(
  runtime: object,
  actions: readonly string[],
  operation: string,
  request: Readonly<{
    id: Model["Id"];
    input?: object;
    wait?: "accepted" | "completed";
    idempotencyKey?: string;
  }>,
  invocation: RuntimeDependencyInvocation,
): Promise<object> {
  const idempotencyKey = request.idempotencyKey ?? invocation.id;
  if (operation === "start") {
    return actorValue(
      await dispatchDependency<Actor.Outcome<WorkflowStartResult>>(
        runtime,
        "$start",
        {
          key: request.id,
          input: request.input,
          idempotencyKey,
        },
        { idempotencyKey },
      ),
    );
  }
  if (operation === "state" || operation === "describe" || operation === "result") {
    return await dispatchDependency<object>(runtime, operation, { key: request.id });
  }
  if (
    operation === "pause" ||
    operation === "resume" ||
    operation === "cancel" ||
    operation === "terminate" ||
    operation === "migrate"
  ) {
    return actorValue(
      await dispatchDependency<Actor.Outcome<object>>(runtime, operation, {
        key: request.id,
        idempotencyKey,
      }),
    );
  }
  if (!actions.some((name) => name === operation)) {
    throw new Error(`Unknown Workflow operation ${operation}.`);
  }
  const dispatched = await dispatchDependency<
    Actor.Outcome<{ outcome: WorkflowOutcome<object, object> }> | WorkflowInvocation
  >(
    runtime,
    "$action",
    {
      key: request.id,
      input: { name: operation, input: request.input },
      wait: request.wait,
      idempotencyKey,
    },
    { idempotencyKey },
  );
  const accepted = dispatched as Readonly<{ id?: string }>;
  if (accepted.id !== undefined) return { id: accepted.id };
  return actorValue(dispatched as Actor.Outcome<{ outcome: WorkflowOutcome<object, object> }>)
    .outcome;
}

function actorValue<Value>(outcome: Actor.Outcome<Value>): Value {
  if (outcome.status === "succeeded") return outcome.value;
  throw new Error(
    `The internal Workflow Actor rejected an operation: ${JSON.stringify(outcome.failure)}.`,
  );
}

type WorkflowModelOf<Definition> = Definition extends WorkflowModelDefinition
  ? Definition
  : Definition extends Readonly<{
        readonly [workflowDefinition]?: infer Model extends WorkflowModelDefinition;
      }>
    ? Model
    : never;

type WorkflowRegistryModelOf<Definition> = Definition extends WorkflowRegistryModelDefinition
  ? Definition
  : Definition extends Readonly<{
        readonly [workflowRegistryDefinition]?: infer Model extends WorkflowRegistryModelDefinition;
      }>
    ? Model
    : never;

export namespace Workflow {
  export type Action<
    Input extends object | undefined = undefined,
    Result extends object = Empty,
    Failures extends Readonly<Record<string, object>> = Empty,
  > = Readonly<{
    Input: Input;
    Result: Result;
    Failures: Failures;
    readonly [workflowAction]?: never;
  }>;
  export type Definition<Model extends WorkflowModelDefinition> = WorkflowImplementation<Model>;
  export type Initial<Model extends WorkflowModelDefinition> = WorkflowInitialContext<Model>;
  export type Run<Model extends WorkflowModelDefinition> = WorkflowRunContext<Model>;
  export type Reference<Definition> =
    WorkflowModelOf<Definition> extends infer Model extends WorkflowModelDefinition
      ? WorkflowDependency<Model>
      : never;
  export type Instance<Definition> =
    WorkflowModelOf<Definition> extends infer Model extends WorkflowModelDefinition
      ? WorkflowInstance<Model>
      : never;
  export type RegistryReference<Definition> =
    WorkflowRegistryModelOf<Definition> extends WorkflowRegistryModelDefinition
      ? WorkflowRegistryDependency<WorkflowRegistryModelOf<Definition>>
      : never;
  export type DynamicDefinition<Model extends WorkflowModelDefinition> =
    WorkflowDynamicDefinition<Model>;
  export type DynamicInstance = DynamicWorkflowInstance;
  export type Outcome<Result, Failure = never> = WorkflowOutcome<Result, Failure>;
  export type Invocation = WorkflowInvocation;
}
