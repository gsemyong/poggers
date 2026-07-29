import type { FeatureContract } from "@/core/feature";
import type { ProgramContract } from "@/core/program";

type Empty = Record<never, never>;
type Procedure = (input: never) => unknown;
type Procedures = Readonly<Record<string, Procedure>>;
type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] };
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
declare const dependencyDefinition: unique symbol;
declare const dependencyReferenceDefinition: unique symbol;
declare const dependencyProviderDefinition: unique symbol;
export const dependencyInvocation: unique symbol = Symbol("kit.dependency.invocation");
export const dependencyInvocationControl: unique symbol = Symbol(
  "kit.dependency.invocation.control",
);
/** @internal Identifies a live Dependency reference bound by a runtime realization. */
export const dependencyReferenceInstance: unique symbol = Symbol(
  "kit.dependency.reference.instance",
);

/** Type-level meaning shared by a Dependency's consumer and provider projections. */
export type DependencyDefinition = Readonly<{
  Operations: Procedures;
  Failures?: Readonly<Record<string, object>>;
  Heartbeats?: Readonly<Record<string, unknown>>;
  Reference?: DependencyReferenceDefinition;
}>;

/**
 * Describes one local identity-binding projection over serializable Dependency
 * operations. The reference itself never crosses a Dependency boundary.
 */
export type DependencyReferenceDefinition = Readonly<{
  Name: string;
  Binding: object;
  Inputs: Readonly<Record<string, object | undefined>>;
  Argument: string;
}>;

/** A typed local reference whose calls lower to its Dependency's wire operations. */
export type DependencyReference<
  Definition extends DependencyReferenceDefinition,
  API extends Procedures,
> = Readonly<
  API & {
    readonly [dependencyReferenceDefinition]: Definition;
  }
>;

/** Runtime call semantics kept separate from a Dependency's product input. */
export type DependencyCallOptions = Readonly<{
  idempotencyKey?: string;
}>;

/** @internal Runtime metadata used by reusable durable dispatchers. */
export type DependencyDispatchOptions = DependencyCallOptions &
  Readonly<{
    attempt?: number;
    scheduledAt?: number;
    startedAt?: number;
    deadline?: number;
    previousHeartbeat?: unknown;
    heartbeat?(details: unknown): void | PromiseLike<void>;
    cancellation?: DependencyCancellation;
  }>;

type DependencyConsumerOperations<Operations extends Procedures> = Readonly<{
  [Name in keyof Operations]: Parameters<Operations[Name]> extends [unknown, ...unknown[]]
    ? (
        input: Parameters<Operations[Name]>[0],
        options?: DependencyCallOptions,
      ) => ReturnType<Operations[Name]>
    : Operations[Name];
}>;

/** The semantic API Programs consume. Its metadata is erased before runtime lowering. */
export type Dependency<
  Definition extends DependencyDefinition,
  API extends Procedures = Definition["Operations"] &
    DependencyConsumerOperations<Definition["Operations"]>,
> = Readonly<
  API & {
    readonly [dependencyDefinition]?: Definition;
  }
>;

export type DependencyContract = Dependency<DependencyDefinition>;

/**
 * One owner-collocated realization of a Dependency.
 *
 * Feature composition does not call this object. Platform adapters select its
 * development and production halves while Programs see only `Api`.
 */
export type DependencyProvider<
  Api extends DependencyContract,
  Development,
  Production = never,
  Requirements = never,
> = Readonly<
  {
    development: Development;
  } & ([Production] extends [never] ? object : { production: Production }) &
    ([Requirements] extends [never] ? object : { requirements: Requirements }) & {
      readonly [dependencyProviderDefinition]?: Api;
    }
>;

export type DependencyDefinitionOf<Api extends DependencyContract> =
  Api extends Readonly<{
    [dependencyDefinition]?: infer Definition extends DependencyDefinition;
  }>
    ? Definition
    : never;

type InputOf<Operation> = Operation extends (input: infer Input) => unknown ? Input : never;
type FailureOf<Definition extends DependencyDefinition> =
  Definition extends Readonly<{
    Failures: infer Failures extends Readonly<Record<string, object>>;
  }>
    ? {
        readonly [Name in keyof Failures]: Readonly<{
          type: Extract<Name, string>;
          data: Failures[Name];
          message?: string;
          retry?: Readonly<{ delay: number }>;
        }>;
      }[keyof Failures]
    : never;
type HeartbeatOf<
  Definition extends DependencyDefinition,
  Operation extends keyof Definition["Operations"],
> =
  Definition extends Readonly<{
    Heartbeats: infer Heartbeats extends Readonly<Record<string, unknown>>;
  }>
    ? Operation extends keyof Heartbeats
      ? Heartbeats[Operation]
      : never
    : never;

/** Runtime-owned controls that never enter a Dependency's business input. */
export type DependencyCancellation = Readonly<{
  requested(): boolean;
  wait(): Promise<void>;
  subscribe?(request: () => void): () => void;
}>;

type DependencyCancellationControl = DependencyCancellation &
  Readonly<{
    subscribe(request: () => void): () => void;
  }>;

export type DependencyInvocationControl = Readonly<{
  previousHeartbeat?: unknown;
  heartbeat(input: unknown): void | PromiseLike<void>;
  cancellation: DependencyCancellationControl;
}>;

/** @internal One adapter-issued authority to execute a routed Dependency invocation. */
export type DependencyInvocationAuthority = Readonly<{
  scope: string;
  owner: string;
  failureEpoch: number;
  epoch: number;
  expiresAt: number;
  /** Provider-side revalidation; never serialized across the wire. */
  assert?(): void | PromiseLike<void>;
}>;

/**
 * Runtime-owned information for one provider invocation.
 *
 * Durable callers retain `id` across retries and increment `attempt`. Direct
 * calls create one process-local invocation with attempt `1`.
 */
export type DependencyInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  deadline?: number;
  trace?: Readonly<{
    traceparent: string;
    tracestate?: string;
    baggage?: string;
  }>;
  authority?: DependencyInvocationAuthority;
  readonly [dependencyInvocationControl]?: DependencyInvocationControl;
}>;

type RuntimeDependencyInvocation = DependencyInvocation &
  Readonly<{
    cancellation: DependencyCancellation;
  }>;

/** Runtime controls available while implementing one Dependency operation. */
export type DependencyProviderInvocation<Failure = never, Heartbeat = never> = Omit<
  DependencyInvocation,
  typeof dependencyInvocationControl
> &
  Readonly<{
    previousHeartbeat?: Readonly<Heartbeat>;
    heartbeat(input: Readonly<{ details: Heartbeat }>): Promise<void>;
    cancellation: Readonly<{
      requested(): boolean;
      wait(): Promise<void>;
    }>;
    fail(input: Failure): never;
  }>;

/** Structured failure produced by a typed Dependency provider. */
export class DependencyFailureError extends Error {
  readonly data: unknown;
  readonly retryDelay?: number;

  constructor(
    input: Readonly<{
      type: string;
      data: unknown;
      message?: string;
      retry?: Readonly<{ delay: number }>;
    }>,
  ) {
    super(input.message ?? input.type);
    this.name = input.type;
    this.data = input.data;
    const retryDelay = input.retry?.delay;
    if (retryDelay !== undefined && (!Number.isSafeInteger(retryDelay) || retryDelay < 0)) {
      throw new TypeError("Dependency retry delay must be a non-negative safe integer.");
    }
    this.retryDelay = retryDelay;
  }
}

type ProviderOperationResult<Operation> = Operation extends (...arguments_: never[]) => infer Output
  ? Output
  : never;

/** The one implementation projection used by portable and host providers. */
export type DependencyImplementation<Api extends DependencyContract> = {
  readonly [Operation in keyof DependencyDefinitionOf<Api>["Operations"]]: (
    context: Readonly<{
      input: InputOf<DependencyDefinitionOf<Api>["Operations"][Operation]>;
      invocation: DependencyProviderInvocation<
        FailureOf<DependencyDefinitionOf<Api>>,
        HeartbeatOf<DependencyDefinitionOf<Api>, Operation>
      >;
    }>,
  ) => ProviderOperationResult<DependencyDefinitionOf<Api>["Operations"][Operation]>;
};

/**
 * Internal runtime form used when a generated Feature dispatches operations
 * from materialized semantic metadata rather than repeating them as object
 * properties.
 */
type DependencyDispatcher<Api extends DependencyContract> = Readonly<{
  [dependencyInvocation](
    operation: Extract<keyof DependencyDefinitionOf<Api>["Operations"], string>,
    input: InputOf<
      DependencyDefinitionOf<Api>["Operations"][keyof DependencyDefinitionOf<Api>["Operations"]]
    >,
    invocation: RuntimeDependencyInvocation,
  ): unknown;
}>;

type ProvidedDependencyImplementation<Api extends DependencyContract> =
  | DependencyImplementation<Api>
  | DependencyDispatcher<Api>;

/** Projects a named consumer Dependency map to the providers a host must mount. */
export type DependencyImplementations<Dependencies extends object> = {
  readonly [Name in keyof Dependencies]: Dependencies[Name] extends DependencyContract
    ? ProvidedDependencyImplementation<Dependencies[Name]>
    : Dependencies[Name];
};

type MountedDependency = Readonly<{
  [dependencyInvocation](
    operation: string,
    input: unknown,
    invocation: RuntimeDependencyInvocation,
  ): unknown;
}>;

/** @internal Invokes a mounted provider with runtime-owned metadata. */
export function invokeDependency(
  dependency: object,
  operation: string,
  input: unknown,
  invocation: DependencyInvocation,
): unknown {
  const invoke = (dependency as Partial<MountedDependency>)[dependencyInvocation];
  if (typeof invoke !== "function") {
    throw new Error(
      `Dependency operation ${JSON.stringify(operation)} is not mounted through the runtime boundary.`,
    );
  }
  return invoke.call(dependency, operation, input, runtimeDependencyInvocation(invocation));
}

/**
 * @internal Invokes an operation selected by a reusable semantic runtime.
 *
 * Ordinary Programs should call typed Dependency methods directly. Feature
 * factories use this boundary when their own validated language selects an
 * operation at runtime. The portable compiler lowers the same call for native
 * execution while provider authority remains enforced by the mounted
 * Dependency.
 */
export function dispatchDependency<Result>(
  dependency: object,
  operation: string,
  input: unknown,
  options?: DependencyDispatchOptions,
): Promise<Result> {
  const now = Date.now();
  const attempt = options?.attempt ?? 1;
  const scheduledAt = options?.scheduledAt ?? now;
  const startedAt = options?.startedAt ?? now;
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new TypeError("Dependency dispatch attempt must be a positive safe integer.");
  }
  if (
    !Number.isFinite(scheduledAt) ||
    !Number.isFinite(startedAt) ||
    (options?.deadline !== undefined && !Number.isFinite(options.deadline))
  ) {
    throw new TypeError("Dependency dispatch time metadata must be finite.");
  }
  if (options?.heartbeat !== undefined && typeof options.heartbeat !== "function") {
    throw new TypeError("Dependency dispatch heartbeat must be a function.");
  }
  const control =
    options?.previousHeartbeat === undefined &&
    options?.heartbeat === undefined &&
    options?.cancellation === undefined
      ? undefined
      : {
          ...(options.previousHeartbeat === undefined
            ? {}
            : { previousHeartbeat: options.previousHeartbeat }),
          async heartbeat(details: unknown) {
            await options.heartbeat?.(details);
          },
          cancellation: forwardDependencyCancellation(options.cancellation),
        };
  return Promise.resolve(
    invokeDependency(dependency, operation, input, {
      id:
        options?.idempotencyKey === undefined
          ? `dispatch:${operation}:${now}`
          : `idempotency:${options.idempotencyKey}`,
      attempt,
      scheduledAt,
      startedAt,
      ...(options?.deadline === undefined ? {} : { deadline: options.deadline }),
      ...(control === undefined ? {} : { [dependencyInvocationControl]: control }),
    }) as Result,
  );
}

/** @internal Creates one mutable cancellation source for adapter-owned delivery. */
export function createDependencyCancellation(): DependencyCancellation &
  Readonly<{ request(): void }> {
  let requested = false;
  const listeners = new Set<() => void>();
  let resolveWait: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  return Object.freeze({
    requested: () => requested,
    wait: async () => {
      if (!requested) await waiting;
    },
    subscribe(listener) {
      if (requested) {
        queueMicrotask(listener);
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request() {
      if (requested) return;
      requested = true;
      resolveWait?.();
      resolveWait = undefined;
      const pendingListeners = [...listeners];
      listeners.clear();
      for (const listener of pendingListeners) listener();
    },
  });
}

/** @internal Normalizes a provider-visible cancellation signal for transport forwarding. */
export function forwardDependencyCancellation(
  source: DependencyCancellation | undefined,
): DependencyCancellationControl {
  if (source === undefined) {
    return Object.freeze({
      requested: () => false,
      wait: () => new Promise<void>(() => undefined),
      subscribe: () => () => undefined,
    });
  }
  return Object.freeze({
    requested: () => source.requested(),
    wait: async () => await source.wait(),
    subscribe(listener) {
      if (source.subscribe) return source.subscribe(listener);
      let active = true;
      void source.wait().then(() => {
        if (active) listener();
      });
      return () => {
        active = false;
      };
    },
  });
}

function runtimeDependencyInvocation(
  invocation: DependencyInvocation,
): RuntimeDependencyInvocation {
  const control = invocation[dependencyInvocationControl];
  return {
    ...invocation,
    cancellation: forwardDependencyCancellation(control?.cancellation),
    ...(control === undefined ? {} : { [dependencyInvocationControl]: control }),
  };
}

/**
 * @internal Replaces the execution of a typed Dependency while preserving its
 * consumer API. Durable feature runtimes use this to record, defer, or replay
 * effects without teaching the generic compiler about their semantics.
 */
export function interceptDependency<
  Api extends DependencyContract,
  Options extends object = DependencyCallOptions,
>(
  dependency: Api,
  intercept: (
    operation: string,
    input: object | string | number | boolean | null | undefined,
    options: Readonly<Options> | undefined,
  ) =>
    | object
    | string
    | number
    | boolean
    | null
    | undefined
    | PromiseLike<object | string | number | boolean | null | undefined>,
): Api {
  const operations = new Map<
    string,
    (
      input: object | string | number | boolean | null | undefined,
      options?: object,
    ) =>
      | object
      | string
      | number
      | boolean
      | null
      | undefined
      | PromiseLike<object | string | number | boolean | null | undefined>
  >();
  return new Proxy(dependency, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      const existing = operations.get(property);
      if (existing) return existing;
      const operation = (
        input: object | string | number | boolean | null | undefined,
        rawOptions?: object,
      ) => {
        if (rawOptions !== undefined && (!rawOptions || typeof rawOptions !== "object")) {
          throw new TypeError(`Dependency ${property} call options must be an object.`);
        }
        return intercept(property, input, rawOptions as Readonly<Options> | undefined);
      };
      operations.set(property, operation);
      return operation;
    },
  });
}

function invokeUncheckedProvider(
  implementation: object,
  operation: string,
  input: unknown,
  invocation: DependencyInvocation,
): unknown {
  const method = Reflect.get(implementation, operation);
  if (typeof method !== "function") {
    throw new Error(`Dependency operation ${JSON.stringify(operation)} is not implemented.`);
  }
  const control = invocation[dependencyInvocationControl];
  const { [dependencyInvocationControl]: _control, ...metadata } = invocation;
  return Reflect.apply(method, implementation, [
    {
      input,
      invocation: {
        ...metadata,
        ...(control?.previousHeartbeat === undefined
          ? {}
          : { previousHeartbeat: control.previousHeartbeat }),
        async heartbeat({ details }: Readonly<{ details: unknown }>) {
          await control?.heartbeat(details);
        },
        cancellation: {
          requested: () => control?.cancellation.requested() ?? false,
          wait: () => control?.cancellation.wait() ?? new Promise<void>(() => undefined),
        },
        fail(failure: {
          type: string;
          data: unknown;
          message?: string;
          retry?: Readonly<{ delay: number }>;
        }): never {
          throw new DependencyFailureError(failure);
        },
      },
    },
  ]);
}

/**
 * @internal Projects a typed provider context to its consumer API without compiler
 * conformance. Focused Feature fixtures use this only after provider typing has
 * already been checked; realized Programs use compiler-derived contracts.
 */
export function createUncheckedDependencyClient<Api extends DependencyContract>(
  implementation: DependencyImplementation<Api>,
): Api {
  let sequence = 0;
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (property === dependencyInvocation) {
        return (operation: string, input: unknown, invocation: DependencyInvocation) =>
          invokeUncheckedProvider(implementation, operation, input, invocation);
      }
      if (typeof property !== "string") return Reflect.get(implementation, property);
      const operation = Reflect.get(implementation, property);
      if (typeof operation !== "function") return operation;
      return (input: unknown, rawOptions?: unknown) => {
        const options = dependencyCallOptions(rawOptions, property);
        const now = Date.now();
        return invokeUncheckedProvider(implementation, property, input, {
          id:
            options?.idempotencyKey === undefined
              ? `fixture:${property}:${++sequence}`
              : `idempotency:${options.idempotencyKey}`,
          attempt: 1,
          scheduledAt: now,
          startedAt: now,
        });
      };
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === dependencyInvocation) {
        return { configurable: true, enumerable: false };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(implementation),
    has: (_target, property) =>
      property === dependencyInvocation || Reflect.has(implementation, property),
    ownKeys: () => [...Reflect.ownKeys(implementation), dependencyInvocation],
  }) as Api;
}

/** @internal Validates the one cross-Platform Dependency call option vocabulary. */
export function dependencyCallOptions(
  value: unknown,
  operation: string,
): DependencyCallOptions | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") {
    throw new TypeError(`Dependency ${operation} call options must be an object.`);
  }
  const unknown = Reflect.ownKeys(value).find((name) => name !== "idempotencyKey");
  if (unknown !== undefined) {
    throw new TypeError(
      `Dependency ${operation} has unknown call option ${JSON.stringify(String(unknown))}.`,
    );
  }
  const idempotencyKey = Reflect.get(value, "idempotencyKey");
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey)) {
    throw new TypeError(`Dependency ${operation} idempotencyKey must be a non-empty string.`);
  }
  return idempotencyKey === undefined ? {} : { idempotencyKey };
}

type ProgramsOf<Owner> = Owner extends {
  Programs: infer Programs extends Record<string, ProgramContract>;
}
  ? Programs
  : Empty;

type FeaturesOf<Owner> = Owner extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;

type ProgramContractIn<
  Owner extends FeatureContract,
  Name extends PropertyKey,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | (Name extends keyof ProgramsOf<Owner> ? ProgramsOf<Owner>[Name] : never)
      | {
          [Feature in keyof FeaturesOf<Owner>]: ProgramContractIn<
            Extract<FeaturesOf<Owner>[Feature], FeatureContract>,
            Name,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

type RequiresOf<Contract> = Contract extends { Requires: infer Requires extends object }
  ? Requires
  : Empty;

type ProvidesOf<Contract> = Contract extends { Provides: infer Provides extends object }
  ? Provides
  : Empty;

type RequiredIn<Owner extends FeatureContract, Name extends PropertyKey> = UnionToIntersection<
  RequiresOf<ProgramContractIn<Owner, Name>>
>;

type ProvidedIn<Owner extends FeatureContract, Name extends PropertyKey> = UnionToIntersection<
  ProvidesOf<ProgramContractIn<Owner, Name>>
>;

export type ProgramName<
  Owner extends FeatureContract,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 6
  ? never
  :
      | Extract<keyof ProgramsOf<Owner>, PropertyKey>
      | {
          [Feature in keyof FeaturesOf<Owner>]: ProgramName<
            Extract<FeaturesOf<Owner>[Feature], FeatureContract>,
            readonly [...Depth, unknown]
          >;
        }[keyof FeaturesOf<Owner>];

/** Every Dependency required by contributions to one named Program. */
export type ProgramRequiredDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<RequiredIn<Owner, Name>>;

/** Every Dependency supplied by Features contributing to one named Program. */
export type ProgramProvidedDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<ProvidedIn<Owner, Name>>;

/** Dependencies the System host must implement once for one running Program. */
export type ProgramExternalDependencies<
  Owner extends FeatureContract,
  Name extends PropertyKey,
> = Simplify<Omit<RequiredIn<Owner, Name>, keyof ProvidedIn<Owner, Name>>>;

/** The stable identity of one Feature contribution to a named Program. */
export type ProgramContributionAddress = Readonly<{
  program: string;
  feature: string;
}>;
