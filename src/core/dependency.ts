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

/** The semantic API Programs consume. Its metadata is erased before runtime lowering. */
export type Dependency<
  Definition extends DependencyDefinition,
  API extends Procedures = Definition["Operations"],
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
export type DependencyInvocationControl = Readonly<{
  previousHeartbeat?: unknown;
  heartbeat(input: unknown): void;
  cancellation: Readonly<{
    requested(): boolean;
    wait(): Promise<void>;
    subscribe(request: () => void): () => void;
  }>;
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

/** Runtime controls available while implementing one Dependency operation. */
export type DependencyProviderInvocation<Failure = never, Heartbeat = never> = Omit<
  DependencyInvocation,
  typeof dependencyInvocationControl
> &
  Readonly<{
    previousHeartbeat?: Readonly<Heartbeat>;
    heartbeat(input: Readonly<{ details: Heartbeat }>): void;
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
    invocation: DependencyInvocation,
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
    invocation: DependencyInvocation,
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
  if (typeof invoke === "function") {
    return invoke.call(dependency, operation, input, invocation);
  }
  const method = Reflect.get(dependency, operation);
  if (typeof method !== "function") {
    throw new Error(`Dependency operation ${JSON.stringify(operation)} is not implemented.`);
  }
  return Reflect.apply(method, dependency, [input]);
}

/**
 * @internal Projects a provider envelope to its consumer API without compiler
 * conformance. Focused Feature fixtures use this only after provider typing has
 * already been checked; realized Programs use compiler-derived contracts.
 */
export function createUncheckedDependencyClient<Api extends DependencyContract>(
  implementation: DependencyImplementation<Api>,
): Api {
  let sequence = 0;
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property !== "string") return Reflect.get(implementation, property);
      const operation = Reflect.get(implementation, property);
      if (typeof operation !== "function") return operation;
      return (input: unknown) => {
        const now = Date.now();
        return Reflect.apply(operation, implementation, [
          {
            input,
            invocation: {
              id: `fixture:${property}:${++sequence}`,
              attempt: 1,
              scheduledAt: now,
              startedAt: now,
              heartbeat() {},
              cancellation: {
                requested: () => false,
                wait: () => new Promise<void>(() => undefined),
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
      };
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(implementation),
    has: (_target, property) => Reflect.has(implementation, property),
    ownKeys: () => Reflect.ownKeys(implementation),
  }) as Api;
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
