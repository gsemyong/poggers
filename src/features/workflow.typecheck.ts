import type { DeferredDependencyInvocation, Dependency } from "@/core/dependency";
import {
  createWorkflow,
  type WorkflowActivityPolicies,
  type WorkflowApi,
  type WorkflowModel,
} from "@/features/workflow";

type Inventory = Dependency<{
  Operations: {
    reserve(input: { orderId: string }): Promise<{ reservationId: string }>;
  };
}>;
type Shipping = Dependency<{
  Operations: {
    ship(input: { reservationId: string }): Promise<{ shipmentId: string }>;
  };
  Failures: {
    unavailable: { retryAt: number };
  };
  Heartbeats: {
    ship: { packedItems: number };
  };
}>;

type Fulfillment = WorkflowModel<{
  Name: "fulfillment";
  Input: Readonly<{ orderId: string }>;
  Result: Readonly<{ shipmentId: string }>;
  State: {
    phase: "pending" | "reserved" | "shipped" | "cancelled";
    cancellationReason?: string;
  };
  Dependencies: {
    inventory: Inventory;
    shipping: Shipping;
  };
  Signals: {
    cancel(input: { reason: string }): void;
  };
  Queries: {
    status(input: {}): {
      phase: "pending" | "reserved" | "shipped" | "cancelled";
    };
  };
}>;

const fulfillmentActivities: WorkflowActivityPolicies<Fulfillment> = {
  inventory: { reserve: { timeout: { attempt: 30_000 } } },
  shipping: {
    ship: {
      timeout: { attempt: 30_000, total: 300_000 },
      retry: {
        attempts: 5,
        delay: 1_000,
        maximumDelay: 30_000,
        factor: 2,
        nonRetryable: ["unavailable"],
      },
    },
  },
};

const invalidFailurePolicy: WorkflowActivityPolicies<Fulfillment> = {
  inventory: { reserve: { timeout: { attempt: 30_000 } } },
  shipping: {
    ship: {
      timeout: { attempt: 30_000 },
      retry: {
        attempts: 2,
        // @ts-expect-error Non-retryable names come from the Dependency's Failures.
        nonRetryable: ["network"],
      },
    },
  },
};
void invalidFailurePolicy;

// @ts-expect-error Every declared Dependency must have Activity policies.
const incompleteActivities: WorkflowActivityPolicies<Fulfillment> = {
  inventory: { reserve: { timeout: { attempt: 30_000 } } },
};
void incompleteActivities;

createWorkflow<Fulfillment>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: fulfillmentActivities,
  async execute({ input: { orderId }, dependencies, state, time, sleep, wait, cancellation }) {
    const startedAt: number = time.now();
    void startedAt;
    const reservation = await dependencies.inventory.reserve({ orderId });
    state.phase = "reserved";
    await sleep({ duration: 1000 });
    await sleep({ deadline: 10_000 });
    // @ts-expect-error A timer has exactly one timing form.
    await sleep({ duration: 1000, deadline: 10_000 });
    // @ts-expect-error A timer requires one timing form.
    await sleep({});
    await wait({ condition: () => state.phase !== "pending", timeout: 30_000 });
    // @ts-expect-error Durable conditions are synchronous predicates.
    await wait({ condition: async () => true });
    if (cancellation.requested()) return { shipmentId: "cancelled" };
    const shipment = await dependencies.shipping.ship(reservation);
    state.phase = "shipped";
    return shipment;
  },
  signals: {
    cancel({ state, input: { reason } }) {
      state.phase = "cancelled";
      state.cancellationReason = reason;
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

declare const api: WorkflowApi<Fulfillment>;
const execution = await api.start({ id: "order-1", input: { orderId: "order-1" } });
api.signal.cancel({ execution, input: { reason: "customer request" } });
api.query.status({
  execution,
  input: {},
  consistency: "current",
});
api.result({ execution, follow: "run" });
api.describe({ execution: { id: execution.id } });
// @ts-expect-error Query consistency is an explicit operational choice.
api.query.status({ execution, input: {} });
// @ts-expect-error Result following is explicit for future Continue-As-New chains.
api.result({ execution });
// @ts-expect-error Message operations have one singular namespace.
api.signals.cancel({ execution, input: { reason: "customer request" } });
declare const deferredShipment: DeferredDependencyInvocation<
  { shipmentId: string },
  {
    type: "unavailable";
    data: { retryAt: number };
    message?: string;
    retry?: { delay: number };
  },
  { packedItems: number }
>;
api.activities.complete({
  invocation: deferredShipment,
  result: { shipmentId: "shipment-1" },
});
api.activities.complete({
  invocation: deferredShipment,
  // @ts-expect-error Deferred completion result follows the provider operation result.
  result: { receiptId: "receipt-1" },
});
api.activities.heartbeat({
  invocation: deferredShipment,
  details: { packedItems: 3 },
});
api.activities.heartbeat({
  invocation: deferredShipment,
  // @ts-expect-error Deferred heartbeat details follow the provider operation.
  details: { completedItems: 3 },
});
api.activities.fail({
  invocation: deferredShipment,
  failure: {
    type: "unavailable",
    data: { retryAt: 1_000 },
  },
});
api.activities.fail({
  invocation: deferredShipment,
  failure: {
    // @ts-expect-error Deferred failures follow the Dependency's declared failure names.
    type: "network",
    data: { retryAt: 1_000 },
  },
});

createWorkflow<Fulfillment>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: {
    inventory: { reserve: { timeout: { attempt: 30_000 } } },
    shipping: { ship: { timeout: { attempt: 30_000 } } },
  },
  async execute({ dependencies, input }) {
    // @ts-expect-error Dependency operation input is inferred from the model.
    await dependencies.inventory.reserve({ id: input.orderId });
    return { shipmentId: "never" };
  },
  signals: {
    // @ts-expect-error Signal handlers retain their semantic input.
    cancel({ input }: { input: { code: number } }) {
      void input.code;
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

// @ts-expect-error Workflow start input is inferred from the semantic model.
api.start({ id: "order-2", input: { order: "order-2" } });

/*
 * W0 target contract. These local declarations keep the complete intended
 * surface type-checked without falsely exporting unimplemented runtime API.
 * Each declaration is removed as its public equivalent lands.
 */
type TargetMaybePromise<Value> = Value | PromiseLike<Value>;
type TargetProcedure = (input: never) => unknown;
type TargetAsyncProcedure = (input: never) => PromiseLike<unknown>;
type TargetProcedures = Readonly<Record<string, TargetProcedure>>;
type TargetDependencyDefinition = Readonly<{
  Operations: Readonly<Record<string, TargetAsyncProcedure>>;
  Failures?: Readonly<Record<string, object>>;
  Heartbeats?: Readonly<Record<string, unknown>>;
}>;
declare const targetDependencyDefinition: unique symbol;
type TargetDependency<Definition extends TargetDependencyDefinition> = Readonly<
  Definition["Operations"] & {
    readonly [targetDependencyDefinition]: Definition;
  }
>;
type TargetDependencyApi = Readonly<Record<string, TargetAsyncProcedure>> &
  Readonly<{
    [targetDependencyDefinition]: TargetDependencyDefinition;
  }>;
declare const targetWorkflowDependency: unique symbol;
type TargetWorkflowDependencyApi = Readonly<{
  [targetWorkflowDependency]: TargetWorkflowDefinition;
}>;
type TargetDependencies = Readonly<
  Record<string, TargetDependencyApi | TargetWorkflowDependencyApi>
>;
type TargetDependencyModel<Api> = Api extends {
  readonly [targetDependencyDefinition]: infer Definition extends TargetDependencyDefinition;
}
  ? Definition
  : Readonly<{ Operations: Api; Failures: {}; Heartbeats: {} }>;
type TargetDependencyFailures<Api> = Extract<
  TargetGroup<TargetDependencyModel<Api>, "Failures", {}>,
  Readonly<Record<string, object>>
>;

type TargetWorkflowDefinition = Readonly<{
  Name: string;
  Input: object;
  Result: unknown;
  State: object;
  Dependencies?: TargetDependencies;
  Signals?: TargetProcedures;
  Updates?: TargetProcedures;
  Queries?: TargetProcedures;
  Failures?: Readonly<Record<string, object>>;
  Memo?: object;
  Search?: object;
}>;

type TargetWorkflow<Definition extends TargetWorkflowDefinition> = Readonly<Definition>;
type TargetGroup<Model, Name extends PropertyKey, Fallback> = Model extends {
  readonly [Key in Name]: infer Value;
}
  ? Value
  : Fallback;
type TargetDependenciesOf<Model> = Extract<
  TargetGroup<Model, "Dependencies", {}>,
  TargetDependencies
>;
type TargetActivityDependenciesOf<Model> = {
  readonly [Name in keyof TargetDependenciesOf<Model> as TargetDependenciesOf<Model>[Name] extends TargetDependencyApi
    ? Name
    : never]: Extract<TargetDependenciesOf<Model>[Name], TargetDependencyApi>;
};
type TargetSignalsOf<Model> = Extract<TargetGroup<Model, "Signals", {}>, TargetProcedures>;
type TargetUpdatesOf<Model> = Extract<TargetGroup<Model, "Updates", {}>, TargetProcedures>;
type TargetQueriesOf<Model> = Extract<TargetGroup<Model, "Queries", {}>, TargetProcedures>;
type TargetFailuresOf<Model> = Extract<
  TargetGroup<Model, "Failures", {}>,
  Readonly<Record<string, object>>
>;
type TargetMemoOf<Model> = Extract<TargetGroup<Model, "Memo", never>, object>;
type TargetSearchOf<Model> = Extract<TargetGroup<Model, "Search", never>, object>;
type TargetInputOf<Operation> = Operation extends (input: infer Input) => unknown ? Input : never;
type TargetOutputOf<Operation> = Operation extends (...arguments_: never[]) => infer Output
  ? Awaited<Output>
  : never;
type TargetMutable<Value extends object> = {
  -readonly [Key in keyof Value]: Value[Key];
};
type TargetProperty<Name extends PropertyKey, Group, Value> = keyof Group extends never
  ? { readonly [Key in Name]?: never }
  : { readonly [Key in Name]: Value };

type TargetExecution = Readonly<{ id: string; run: string }>;
type TargetExecutionSelector = TargetExecution | Readonly<{ id: string; run?: never }>;
type TargetExecutionInfo<Model extends TargetWorkflowDefinition> = Readonly<{
  execution: TargetExecution;
  firstRun: string;
  attempt: number;
  startedAt: number;
  parent?: TargetExecution;
  root: TargetExecution;
  previous?: Readonly<{
    execution: TargetExecution;
    status: Exclude<TargetWorkflowStatus, "running">;
    result?: Model["Result"];
    failure?: TargetFailure<Model>;
  }>;
  history: Readonly<{
    events: number;
    bytes: number;
    continueSuggested: boolean;
  }>;
}>;

type TargetFailure<Model> = {
  [Name in keyof TargetFailuresOf<Model>]: Readonly<{
    type: Extract<Name, string>;
    data: TargetFailuresOf<Model>[Name];
    message?: string;
  }>;
}[keyof TargetFailuresOf<Model>];

type TargetDependencyFailure<Model> = {
  [Dependency in keyof TargetActivityDependenciesOf<Model>]: {
    [Name in keyof TargetDependencyFailures<
      TargetActivityDependenciesOf<Model>[Dependency]
    >]: Readonly<{
      kind: "dependency";
      dependency: Extract<Dependency, string>;
      operation: string;
      type: Extract<Name, string>;
      data: TargetDependencyFailures<TargetActivityDependenciesOf<Model>[Dependency]>[Name];
      attempt: number;
      retryable: boolean;
    }>;
  }[keyof TargetDependencyFailures<TargetActivityDependenciesOf<Model>[Dependency]>];
}[keyof TargetActivityDependenciesOf<Model>];

type TargetChildFailure<Model> = {
  [Dependency in keyof TargetDependenciesOf<Model>]: TargetDependenciesOf<Model>[Dependency] extends {
    readonly [targetWorkflowDependency]: infer Child extends TargetWorkflowDefinition;
  }
    ? Readonly<{
        kind: "child";
        dependency: Extract<Dependency, string>;
        execution: TargetExecution;
        failure: TargetFailure<Child>;
      }>
    : never;
}[keyof TargetDependenciesOf<Model>];

type TargetClassifiedFailure<Model> =
  | TargetDependencyFailure<Model>
  | TargetChildFailure<Model>
  | Readonly<{ kind: "cancelled"; reason?: string }>
  | Readonly<{
      kind: "timeout";
      boundary: "workflow" | "activity" | "child" | "condition";
    }>
  | Readonly<{ kind: "unknown"; message: string }>;

type TargetCancellationBranch<Value> = Readonly<{
  cancel(input: Readonly<{ reason?: string }>): void;
  result(): Promise<Awaited<Value>>;
}>;

type TargetCancellation<Model extends TargetWorkflowDefinition> = Readonly<{
  requested(): boolean;
  start<Value>(input: {
    propagation: "inherit" | "shield";
    timeout?: number;
    execute(context: TargetEffectContext<Model, Model["Input"]>): TargetMaybePromise<Value>;
  }): TargetCancellationBranch<Value>;
}>;

type TargetEffectContext<Model extends TargetWorkflowDefinition, Input> = Readonly<{
  input: Input;
  state: TargetMutable<Model["State"]>;
  dependencies: TargetDependenciesOf<Model>;
  execution: TargetExecutionInfo<Model>;
  time: Readonly<{ now(): number }>;
  random: Readonly<{ number(): number }>;
  identifiers: Readonly<{ create(): string }>;
  sleep(
    input: Readonly<
      { duration: number; deadline?: never } | { deadline: number; duration?: never }
    >,
  ): Promise<void>;
  wait(input: Readonly<{ condition(): boolean; timeout?: number }>): Promise<boolean>;
  cancellation: TargetCancellation<Model>;
  fail(input: TargetFailure<Model>): never;
  failures: Readonly<{
    classify(input: Readonly<{ error: unknown }>): TargetClassifiedFailure<Model>;
  }>;
  version(input: Readonly<{ change: string; status: "active" | "retired" }>): boolean;
  search: Readonly<{
    update(input: Readonly<{ attributes: Partial<TargetSearchOf<Model>> }>): void;
  }>;
}>;

type TargetExecuteContext<Model extends TargetWorkflowDefinition> = TargetEffectContext<
  Model,
  Model["Input"]
> &
  Readonly<{
    continue(input: {
      input: Model["Input"];
      memo?: TargetMemoOf<Model>;
      search?: TargetSearchOf<Model>;
      delay?: number;
      timeout?: Readonly<{ run?: number }>;
    }): never;
  }>;

type TargetMessageInfo<Name extends PropertyKey> = Readonly<{
  id: string;
  name: Extract<Name, string>;
  receivedAt: number;
}>;

type TargetSignalImplementations<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetSignalsOf<Model>]: (
    context: TargetEffectContext<Model, TargetInputOf<TargetSignalsOf<Model>[Name]>> &
      Readonly<{ message: TargetMessageInfo<Name> }>,
  ) => TargetMaybePromise<void>;
};

type TargetUpdateImplementations<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetUpdatesOf<Model>]: Readonly<{
    validate?(context: {
      input: TargetInputOf<TargetUpdatesOf<Model>[Name]>;
      state: Readonly<Model["State"]>;
      execution: TargetExecutionInfo<Model>;
      message: TargetMessageInfo<Name>;
      reject(input: TargetFailure<Model>): never;
    }): void;
    execute(
      context: TargetEffectContext<Model, TargetInputOf<TargetUpdatesOf<Model>[Name]>> &
        Readonly<{ message: TargetMessageInfo<Name> }>,
    ): TargetMaybePromise<TargetOutputOf<TargetUpdatesOf<Model>[Name]>>;
  }>;
};

type TargetQueryImplementations<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetQueriesOf<Model>]: (context: {
    input: TargetInputOf<TargetQueriesOf<Model>[Name]>;
    state: Readonly<Model["State"]>;
    execution: TargetExecutionInfo<Model>;
  }) => TargetOutputOf<TargetQueriesOf<Model>[Name]>;
};

type TargetRetryPolicy<Failure extends string = string> = Readonly<{
  attempts?: number;
  delay?: number;
  maximumDelay?: number;
  factor?: number;
  nonRetryable?: readonly Failure[];
}>;

type TargetActivityTimeout =
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

type TargetActivityPolicy<Failure extends string = string> = Readonly<{
  timeout: TargetActivityTimeout;
  retry?: TargetRetryPolicy<Failure>;
  cancellation?: "wait" | "request" | "abandon";
}>;

type TargetActivityPolicies<Model extends TargetWorkflowDefinition> = {
  readonly [Dependency in keyof TargetActivityDependenciesOf<Model>]: {
    readonly [Operation in Extract<
      keyof TargetActivityDependenciesOf<Model>[Dependency],
      string
    >]: TargetActivityPolicy<
      Extract<
        keyof TargetDependencyFailures<TargetActivityDependenciesOf<Model>[Dependency]>,
        string
      >
    >;
  };
};

declare const targetDeferredInvocation: unique symbol;
type TargetDeferredInvocation<Result> = Readonly<{
  id: string;
  readonly [targetDeferredInvocation]?: Result;
}>;
type TargetInvocationContext<Heartbeat> = Readonly<{
  id: string;
  execution: TargetExecution;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  deadline?: number;
  previousHeartbeat?: Heartbeat;
  cancellation: Readonly<{
    requested(): boolean;
  }>;
  heartbeat(input: Readonly<{ details: Heartbeat }>): void;
  defer<Result>(input: Readonly<{ id: string }>): TargetDeferredInvocation<Result>;
}>;
type TargetDependencyImplementation<Definition extends TargetDependencyDefinition> = {
  readonly [Operation in keyof Definition["Operations"]]: (
    context: Readonly<{
      input: TargetInputOf<Definition["Operations"][Operation]>;
      invocation: TargetInvocationContext<
        Operation extends keyof TargetGroup<Definition, "Heartbeats", {}>
          ? TargetGroup<Definition, "Heartbeats", {}>[Operation]
          : never
      >;
    }>,
  ) => TargetMaybePromise<
    | TargetOutputOf<Definition["Operations"][Operation]>
    | TargetDeferredInvocation<TargetOutputOf<Definition["Operations"][Operation]>>
  >;
};
type TargetDependencyProvider<Api> = Api extends TargetDependencyApi
  ? TargetDependencyModel<Api> extends infer Definition extends TargetDependencyDefinition
    ? TargetDependencyImplementation<Definition>
    : never
  : never;

type TargetWorkflowImplementation<Model extends TargetWorkflowDefinition> = Readonly<{
  state(context: Readonly<{ input: Model["Input"] }>): Model["State"];
  execute(context: TargetExecuteContext<Model>): TargetMaybePromise<Model["Result"]>;
  completion?: Readonly<{
    abandon?: Readonly<{
      signals?: readonly Extract<keyof TargetSignalsOf<Model>, string>[];
      updates?: readonly Extract<keyof TargetUpdatesOf<Model>, string>[];
    }>;
  }>;
}> &
  TargetProperty<"activities", TargetActivityDependenciesOf<Model>, TargetActivityPolicies<Model>> &
  TargetProperty<"signals", TargetSignalsOf<Model>, TargetSignalImplementations<Model>> &
  TargetProperty<"updates", TargetUpdatesOf<Model>, TargetUpdateImplementations<Model>> &
  TargetProperty<"queries", TargetQueriesOf<Model>, TargetQueryImplementations<Model>>;

type TargetStartPolicy<Model extends TargetWorkflowDefinition> = Readonly<{
  delay?: number;
  conflict?: "fail" | "use-existing" | "terminate-existing";
  reuse?: "allow" | "allow-failed" | "reject";
  timeout?: Readonly<{ run?: number; execution?: number }>;
  retry?: TargetRetryPolicy<Extract<keyof TargetFailuresOf<Model>, string>>;
  priority?: number;
  parent?: Readonly<{
    close: "terminate" | "request-cancel" | "abandon";
    cancellation: "wait" | "request" | "abandon";
  }>;
}>;

type TargetStartInput<Model extends TargetWorkflowDefinition> = Readonly<{
  id: string;
  input: Model["Input"];
  policy?: TargetStartPolicy<Model>;
  memo?: TargetMemoOf<Model>;
  search?: TargetSearchOf<Model>;
}>;

type TargetExistingOrStart<Model extends TargetWorkflowDefinition> =
  | TargetExecutionSelector
  | Readonly<{ start: TargetStartInput<Model> }>;

type TargetWorkflowStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "terminated"
  | "continued";

type TargetSnapshot<Model extends TargetWorkflowDefinition> = Readonly<{
  execution: TargetExecution;
  status: TargetWorkflowStatus;
  revision: number;
  state: Readonly<Model["State"]>;
  result?: Model["Result"];
  failure?: TargetFailure<Model>;
}>;

type TargetSignalApi<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetSignalsOf<Model>]: (input: {
    execution: TargetExistingOrStart<Model>;
    id?: string;
    input: TargetInputOf<TargetSignalsOf<Model>[Name]>;
  }) => Promise<TargetExecution>;
};

declare const targetUpdateResult: unique symbol;
type TargetUpdateReference<Result> = Readonly<{
  execution: TargetExecution;
  id: string;
  readonly [targetUpdateResult]?: Result;
}>;

type TargetUpdateApi<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetUpdatesOf<Model>]: <
    Wait extends "accepted" | "completed" = "completed",
  >(input: {
    execution: TargetExistingOrStart<Model>;
    id?: string;
    input: TargetInputOf<TargetUpdatesOf<Model>[Name]>;
    wait?: Wait;
  }) => Promise<
    Wait extends "accepted"
      ? TargetUpdateReference<TargetOutputOf<TargetUpdatesOf<Model>[Name]>>
      : TargetOutputOf<TargetUpdatesOf<Model>[Name]>
  >;
};

type TargetQueryApi<Model extends TargetWorkflowDefinition> = {
  readonly [Name in keyof TargetQueriesOf<Model>]: (input: {
    execution: TargetExecutionSelector;
    input: TargetInputOf<TargetQueriesOf<Model>[Name]>;
    consistency: "eventual" | "current";
  }) => Promise<TargetOutputOf<TargetQueriesOf<Model>[Name]>>;
};

type TargetRange<Value> = Value | Readonly<{ from: Value; to?: Value; step?: number }>;
type TargetMonth =
  | "january"
  | "february"
  | "march"
  | "april"
  | "may"
  | "june"
  | "july"
  | "august"
  | "september"
  | "october"
  | "november"
  | "december";
type TargetWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
type TargetCalendar = Readonly<{
  second?: TargetRange<number> | readonly TargetRange<number>[];
  minute?: TargetRange<number> | readonly TargetRange<number>[];
  hour?: TargetRange<number> | readonly TargetRange<number>[];
  dayOfMonth?: TargetRange<number> | readonly TargetRange<number>[];
  month?: TargetRange<TargetMonth> | readonly TargetRange<TargetMonth>[];
  year?: TargetRange<number> | readonly TargetRange<number>[];
  dayOfWeek?: TargetRange<TargetWeekday> | readonly TargetRange<TargetWeekday>[];
}>;
type TargetInterval = Readonly<{ every: number; offset?: number }>;
type TargetScheduleTiming = (
  | Readonly<{
      calendars: readonly [TargetCalendar, ...TargetCalendar[]];
      intervals?: readonly TargetInterval[];
    }>
  | Readonly<{
      calendars?: readonly TargetCalendar[];
      intervals: readonly [TargetInterval, ...TargetInterval[]];
    }>
) &
  Readonly<{
    exclude?: readonly TargetCalendar[];
    start?: number;
    end?: number;
    jitter?: number;
    timeZone?: string;
    daylightSaving?: Readonly<{
      missing: "skip" | "next";
      repeated: "both" | "first" | "second";
    }>;
  }>;

type TargetSchedulePolicy = Readonly<{
  overlap:
    | "skip"
    | "buffer-one"
    | "buffer-all"
    | "cancel-previous"
    | "terminate-previous"
    | "concurrent";
  catchup?: number;
  pauseOnFailure?: boolean;
  remaining?: number;
}>;

type TargetScheduleDefinition<Model extends TargetWorkflowDefinition> = Readonly<{
  timing: TargetScheduleTiming;
  workflow: TargetStartInput<Model>;
  policy: TargetSchedulePolicy;
  paused?: boolean;
  note?: string;
}>;

type TargetScheduleDescription<Model extends TargetWorkflowDefinition> = Readonly<{
  id: string;
  revision: number;
  definition: TargetScheduleDefinition<Model>;
  next: readonly number[];
  previous?: number;
}>;

type TargetScheduleApi<Model extends TargetWorkflowDefinition> = Readonly<{
  create(input: {
    id: string;
    definition: TargetScheduleDefinition<Model>;
    idempotency: string;
  }): Promise<TargetScheduleDescription<Model>>;
  describe(input: { id: string }): Promise<TargetScheduleDescription<Model>>;
  list(input: {
    page?: Readonly<{ cursor?: string; limit?: number }>;
  }): AsyncIterable<TargetScheduleDescription<Model>>;
  update(input: {
    id: string;
    revision: number;
    definition: TargetScheduleDefinition<Model>;
    idempotency: string;
  }): Promise<TargetScheduleDescription<Model>>;
  pause(input: { id: string; note?: string }): Promise<void>;
  resume(input: { id: string; note?: string }): Promise<void>;
  trigger(input: {
    id: string;
    overlap?: TargetSchedulePolicy["overlap"];
    idempotency: string;
  }): Promise<TargetExecution>;
  backfill(input: {
    id: string;
    ranges: readonly Readonly<{ from: number; to: number }>[];
    overlap?: TargetSchedulePolicy["overlap"];
    idempotency: string;
  }): Promise<readonly TargetExecution[]>;
  delete(input: { id: string }): Promise<void>;
}>;

type TargetValuePredicate<Value> =
  | Readonly<{ equals: Value }>
  | Readonly<{ notEquals: Value }>
  | Readonly<{ oneOf: readonly Value[] }>
  | (Value extends number
      ?
          | Readonly<{ greaterThan: Value }>
          | Readonly<{ greaterThanOrEqual: Value }>
          | Readonly<{ lessThan: Value }>
          | Readonly<{ lessThanOrEqual: Value }>
          | Readonly<{ between: Readonly<{ from?: Value; to?: Value }> }>
      : never)
  | (Value extends string ? Readonly<{ prefix: string }> | Readonly<{ contains: string }> : never);

type TargetSearchPredicate<Model extends TargetWorkflowDefinition> = {
  [Field in keyof TargetSearchOf<Model>]: Readonly<{ field: Field }> &
    TargetValuePredicate<TargetSearchOf<Model>[Field]>;
}[keyof TargetSearchOf<Model>];

type TargetFilter<Model extends TargetWorkflowDefinition> =
  | TargetSearchPredicate<Model>
  | Readonly<{ field: "id"; equals: string }>
  | Readonly<{ field: "status"; oneOf: readonly TargetWorkflowStatus[] }>
  | Readonly<{ field: "startedAt"; from?: number; to?: number }>
  | Readonly<{ all: readonly TargetFilter<Model>[] }>
  | Readonly<{ any: readonly TargetFilter<Model>[] }>
  | Readonly<{ not: TargetFilter<Model> }>;

type TargetBulkOperation = Readonly<{ id: string }>;
type TargetBulkApi<Model extends TargetWorkflowDefinition> = Readonly<{
  cancel(input: {
    filter: TargetFilter<Model>;
    reason?: string;
    idempotency: string;
  }): Promise<TargetBulkOperation>;
  terminate(input: {
    filter: TargetFilter<Model>;
    reason: string;
    idempotency: string;
  }): Promise<TargetBulkOperation>;
  reset(input: {
    filter: TargetFilter<Model>;
    point: Readonly<{ event: number } | { checkpoint: string }>;
    reason: string;
    idempotency: string;
  }): Promise<TargetBulkOperation>;
  retry(input: {
    filter: TargetFilter<Model>;
    policy?: TargetRetryPolicy<Extract<keyof TargetFailuresOf<Model>, string>>;
    idempotency: string;
  }): Promise<TargetBulkOperation>;
  describe(input: { operation: TargetBulkOperation }): Promise<
    Readonly<{
      status: "running" | "completed" | "failed" | "cancelled";
      matched: number;
      completed: number;
      failed: number;
    }>
  >;
}>;

type TargetWorkflowDependency<Model extends TargetWorkflowDefinition> = Readonly<{
  start(input: TargetStartInput<Model>): Promise<TargetExecution>;
  describe(input: { execution: TargetExecutionSelector }): Promise<TargetSnapshot<Model>>;
  history(input: {
    execution: TargetExecutionSelector;
    page?: Readonly<{ cursor?: string; limit?: number }>;
  }): AsyncIterable<Readonly<{ sequence: number; type: string; at: number; data: object }>>;
  result(input: {
    execution: TargetExecutionSelector;
    follow: "run" | "chain";
  }): Promise<Model["Result"]>;
  watch(input: { execution: TargetExecutionSelector }): AsyncIterable<TargetSnapshot<Model>>;
  cancel(input: { execution: TargetExecutionSelector; reason?: string }): Promise<void>;
  terminate(input: { execution: TargetExecutionSelector; reason: string }): Promise<void>;
  reset(input: {
    execution: TargetExecution;
    point: Readonly<{ event: number } | { checkpoint: string }>;
    reason: string;
  }): Promise<TargetExecution>;
  retry(input: {
    execution: TargetExecution;
    policy?: TargetRetryPolicy<Extract<keyof TargetFailuresOf<Model>, string>>;
  }): Promise<TargetExecution>;
  signal: TargetSignalApi<Model>;
  update: TargetUpdateApi<Model>;
  updateResult<Result>(input: { update: TargetUpdateReference<Result> }): Promise<Result>;
  query: TargetQueryApi<Model>;
  list(input: {
    filter?: TargetFilter<Model>;
    page?: Readonly<{ cursor?: string; limit?: number }>;
  }): AsyncIterable<TargetSnapshot<Model>>;
  count(input: { filter?: TargetFilter<Model> }): Promise<number>;
  schedule: TargetScheduleApi<Model>;
  bulk: TargetBulkApi<Model>;
}> &
  Readonly<{ [targetWorkflowDependency]: Model }>;

declare const targetDefinedWorkflow: unique symbol;
type TargetDefinedWorkflow<Model extends TargetWorkflowDefinition> = Readonly<{
  server: object;
  readonly [targetDefinedWorkflow]: Model;
}>;
declare function defineTargetWorkflow<Model extends TargetWorkflowDefinition>(
  implementation: TargetWorkflowImplementation<Model>,
): TargetDefinedWorkflow<Model>;
declare const targetContinueForHistory: boolean;

type TargetShippingDefinition = {
  Operations: {
    ship(input: { orderId: string }): Promise<{ shipmentId: string }>;
  };
  Failures: {
    unavailable: { retryAt: number };
  };
  Heartbeats: {
    ship: { packedItems: number };
  };
};
type TargetShipping = TargetDependency<TargetShippingDefinition>;
const targetShippingImplementation = {
  async ship({ input, invocation }) {
    const packedItems = (invocation.previousHeartbeat?.packedItems ?? 0) + 1;
    invocation.heartbeat({ details: { packedItems } });
    if (invocation.cancellation.requested()) {
      return invocation.defer<{ shipmentId: string }>({ id: invocation.id });
    }
    return { shipmentId: input.orderId };
  },
} satisfies TargetDependencyImplementation<TargetShippingDefinition>;
void targetShippingImplementation;

type TargetReceipt = TargetWorkflow<{
  Name: "receipt";
  Input: Readonly<{ orderId: string; shipmentId: string }>;
  Result: Readonly<{ receiptId: string }>;
  State: { phase: "pending" | "issued" };
}>;
declare const targetReceiptApi: TargetWorkflowDependency<TargetReceipt>;

type TargetFulfillment = TargetWorkflow<{
  Name: "fulfillment";
  Input: Readonly<{ orderId: string }>;
  Result: Readonly<{ shipmentId: string }>;
  State: {
    phase: "pending" | "reserved" | "shipped";
  };
  Dependencies: {
    shipping: TargetShipping;
    receipt: TargetWorkflowDependency<TargetReceipt>;
  };
  Signals: {
    expedite(input: {}): void;
  };
  Updates: {
    reserve(input: { reservationId: string }): { previous?: string };
  };
  Queries: {
    status(input: {}): { phase: "pending" | "reserved" | "shipped" };
  };
  Failures: {
    unavailable: { retryAt: number };
    invalidReservation: { reason: string };
  };
  Memo: {
    customer: string;
  };
  Search: {
    order: string;
    phase: "pending" | "reserved" | "shipped";
  };
}>;

const targetFulfillment = defineTargetWorkflow<TargetFulfillment>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: {
    shipping: {
      ship: {
        timeout: { attempt: 30_000, total: 300_000 },
        retry: {
          attempts: 5,
          delay: 1_000,
          factor: 2,
          nonRetryable: ["unavailable"],
        },
      },
    },
  },
  async execute({
    input,
    state,
    dependencies,
    cancellation,
    wait,
    search,
    continue: continueExecution,
  }) {
    const branch = cancellation.start({
      propagation: "inherit",
      timeout: 30_000,
      execute: async () => dependencies.shipping.ship({ orderId: input.orderId }),
    });
    await wait({ condition: () => state.phase !== "pending", timeout: 60_000 });
    const shipment = await branch.result();
    state.phase = "shipped";
    search.update({ attributes: { phase: "shipped" } });
    const receipt = await dependencies.receipt.start({
      id: `receipt:${input.orderId}`,
      input: { orderId: input.orderId, shipmentId: shipment.shipmentId },
      policy: {
        parent: {
          close: "request-cancel",
          cancellation: "wait",
        },
      },
    });
    await dependencies.receipt.result({ execution: receipt, follow: "run" });
    if (targetContinueForHistory) continueExecution({ input });
    return shipment;
  },
  signals: {
    async expedite({ state }) {
      state.phase = "reserved";
    },
  },
  updates: {
    reserve: {
      validate({ input, reject }) {
        if (!input.reservationId) {
          reject({
            type: "invalidReservation",
            data: { reason: "reservationId is required" },
          });
        }
      },
      execute({ state }) {
        const previous = state.phase;
        state.phase = "reserved";
        return { previous };
      },
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

declare const targetApi: TargetWorkflowDependency<TargetFulfillment>;
const targetExecution = await targetApi.start({
  id: "order-1",
  input: { orderId: "order-1" },
  memo: { customer: "customer-1" },
  search: { order: "order-1", phase: "pending" },
});
await targetApi.signal.expedite({ execution: targetExecution, input: {} });
const acceptedUpdate = await targetApi.update.reserve({
  execution: targetExecution,
  id: "reserve-1",
  input: { reservationId: "reservation-1" },
  wait: "accepted",
});
await targetApi.updateResult({ update: acceptedUpdate });
await targetApi.query.status({
  execution: targetExecution,
  input: {},
  consistency: "current",
});
await targetApi.schedule.create({
  id: "weekday-fulfillment",
  idempotency: "create-weekday-fulfillment",
  definition: {
    timing: {
      calendars: [
        {
          hour: 9,
          dayOfWeek: [{ from: "monday", to: "friday" }],
        },
      ],
      timeZone: "Europe/Bratislava",
      daylightSaving: { missing: "next", repeated: "first" },
    },
    workflow: {
      id: "scheduled-order",
      input: { orderId: "scheduled-order" },
      memo: { customer: "customer-1" },
      search: { order: "scheduled-order", phase: "pending" },
    },
    policy: { overlap: "skip", catchup: 60_000 },
  },
});

type TargetDependencyImplementations<Model extends TargetWorkflowDefinition> = {
  readonly [Name in Extract<
    keyof TargetDependenciesOf<Model>,
    string
  >]: TargetDependenciesOf<Model>[Name] extends TargetDependencyApi
    ? TargetDependencyProvider<TargetDependenciesOf<Model>[Name]>
    : TargetDependenciesOf<Model>[Name] extends TargetWorkflowDependencyApi
      ? TargetDependenciesOf<Model>[Name]
      : never;
};
type TargetWorkflowTest<Model extends TargetWorkflowDefinition> = Readonly<{
  api: TargetWorkflowDependency<Model>;
  time: Readonly<{
    now(): number;
    advance(
      input: Readonly<{ by: number; to?: never } | { to: number; by?: never }>,
    ): Promise<void>;
    runUntilIdle(): Promise<void>;
  }>;
  restart(): Promise<void>;
  crash(input: {
    boundary: "before-command" | "after-command" | "before-commit" | "after-commit";
    occurrence?: number;
  }): Promise<void>;
  history(input: {
    execution: TargetExecutionSelector;
  }): Promise<readonly Readonly<{ sequence: number; type: string; data: object }>[]>;
  replay(input: {
    history: readonly Readonly<{ sequence: number; type: string; data: object }>[];
  }): Promise<TargetSnapshot<Model>>;
  complete<Result>(input: {
    invocation: TargetDeferredInvocation<Result>;
    result: Result;
  }): Promise<void>;
}>;
declare function createTargetWorkflowTest<Model extends TargetWorkflowDefinition>(input: {
  workflow: TargetDefinedWorkflow<Model>;
  dependencies: TargetDependencyImplementations<Model>;
}): TargetWorkflowTest<Model>;

const targetTest = createTargetWorkflowTest({
  workflow: targetFulfillment,
  dependencies: {
    shipping: targetShippingImplementation,
    receipt: targetReceiptApi,
  },
});
await targetTest.time.advance({ by: 60_000 });
await targetTest.restart();
await targetTest.crash({ boundary: "after-command" });

// @ts-expect-error Search fields and values come from the Workflow model.
targetApi.count({ filter: { field: "phase", equals: "unknown" } });

// @ts-expect-error Activity policy must cover every asynchronous Dependency operation.
defineTargetWorkflow<TargetFulfillment>({
  state: () => ({ phase: "pending" }),
  execute: async ({ dependencies, input }) =>
    dependencies.shipping.ship({ orderId: input.orderId }),
  signals: { expedite: async () => {} },
  updates: {
    reserve: {
      execute: () => ({}),
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});
