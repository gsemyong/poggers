import type {
  DependencyContractIR,
  DependencyOperationIR,
  ProgramContributionManifest,
  ProgramManifest,
  TypeIR,
} from "@/compiler/ir";
import {
  createUncheckedDependencyClient,
  dependencyCallOptions,
  DependencyFailureError,
  dependencyInvocation,
  dependencyInvocationControl,
  dependencyReferenceInstance,
  invokeDependency,
  type DependencyInvocation,
  type DependencyInvocationControl,
  type DependencyProviderInvocation,
  type ProgramContributionAddress,
} from "@/core/dependency";
import type { Feature, FeatureContract } from "@/core/feature";
import { orderDependencyGraph } from "@/core/graph";
import type { System, SystemContract } from "@/core/system";

/** Internal protocol for a host Dependency whose API is scoped to one Feature contribution. */
export const dependencyScope: unique symbol = Symbol("kit.dependency.scope");

export type DependencyScope = Readonly<{ program: string; feature: string }>;

export type ScopedDependency = Readonly<{
  [dependencyScope](scope: DependencyScope): unknown;
}>;

export function scopeDependency(value: unknown, scope: DependencyScope): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
  const scoped = (value as Partial<ScopedDependency>)[dependencyScope];
  return typeof scoped === "function" ? scoped.call(value, scope) : value;
}

export type DeferredDependencyBinding = Readonly<{
  dependency: object;
  bind(value: object): void;
  replace(value: object): void;
}>;

/** Creates one lazily bound internal Dependency for a provider component. */
export function createDeferredDependencyBinding(
  name: string,
  options: Readonly<{ dispatcher?: boolean }> = {},
): DeferredDependencyBinding {
  let implementation: object | undefined;
  const dispatcher = options.dispatcher ?? true;
  const operations = new Map<PropertyKey, (...arguments_: unknown[]) => unknown>();
  const operation = (property: PropertyKey) => {
    const existing = operations.get(property);
    if (existing) return existing;
    const created =
      property === dependencyInvocation
        ? (operationName: unknown, input: unknown, invocation: unknown) => {
            if (!implementation) {
              throw new Error(`Dependency ${JSON.stringify(name)} is not ready.`);
            }
            return invokeDependency(
              implementation,
              String(operationName),
              input,
              invocation as DependencyInvocation,
            );
          }
        : (...arguments_: unknown[]) => {
            if (!implementation) {
              throw new Error(`Dependency ${JSON.stringify(name)} is not ready.`);
            }
            const method = Reflect.get(implementation, property);
            if (typeof method !== "function") {
              throw new Error(
                `Dependency ${JSON.stringify(name)} operation ${String(property)} is not implemented.`,
              );
            }
            return Reflect.apply(method, implementation, arguments_);
          };
    operations.set(property, created);
    return created;
  };
  const value = (property: PropertyKey): unknown => {
    if (property === "then") return undefined;
    if (property === dependencyInvocation && !dispatcher) {
      return implementation ? Reflect.get(implementation, property) : undefined;
    }
    if (property === dependencyInvocation || !implementation) return operation(property);
    const resolved = Reflect.get(implementation, property);
    return typeof resolved === "function" ? operation(property) : resolved;
  };
  const dependency = new Proxy(Object.create(null) as object, {
    get: (_target, property) => value(property),
    has: (_target, property) =>
      property !== "then" &&
      (!implementation ||
        (dispatcher && property === dependencyInvocation) ||
        Reflect.has(implementation, property)),
    ownKeys: () => (implementation ? Reflect.ownKeys(implementation) : []),
    getOwnPropertyDescriptor: (_target, property) =>
      property === "then"
        ? undefined
        : {
            configurable: true,
            enumerable: implementation
              ? Boolean(Reflect.getOwnPropertyDescriptor(implementation, property)?.enumerable)
              : false,
            value: value(property),
            writable: false,
          },
  });
  return {
    dependency,
    bind(value) {
      if (implementation) {
        throw new Error(`Dependency ${JSON.stringify(name)} is already bound.`);
      }
      implementation = value;
    },
    replace(value) {
      if (!implementation) {
        throw new Error(`Dependency ${JSON.stringify(name)} is not ready.`);
      }
      implementation = value;
    },
  };
}

/**
 * Checks and wraps external implementations against canonical compiler meaning.
 * Both development adapters and test hosts use this boundary.
 */
export function conformExternalDependencies(
  contracts: readonly DependencyContractIR[],
  implementations: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = Object.create(null);
  const seen = new Set<string>();
  for (const contract of contracts) {
    if (seen.has(contract.name)) {
      throw new Error(`External Dependency ${JSON.stringify(contract.name)} is duplicated.`);
    }
    seen.add(contract.name);
    const implementation = implementations[contract.name];
    if (!isObject(implementation)) {
      throw new Error(`External Dependency ${JSON.stringify(contract.name)} is not implemented.`);
    }
    result[contract.name] = conformDependency(contract, implementation);
  }
  return Object.freeze(result);
}

function conformDependency(
  contract: DependencyContractIR,
  implementation: object,
): Readonly<Record<string | symbol, unknown>> {
  const operations = new Map(contract.operations.map((operation) => [operation.name, operation]));
  const dispatcher = Reflect.get(implementation, dependencyInvocation);
  if (typeof dispatcher !== "function") {
    for (const operation of operations.values()) {
      if (typeof Reflect.get(implementation, operation.name) !== "function") {
        throw new Error(
          `External Dependency ${JSON.stringify(contract.name)} does not implement operation ` +
            `${JSON.stringify(operation.name)}.`,
        );
      }
    }
  }
  const wrappers = new Map<string, (...arguments_: unknown[]) => unknown>();
  const facade = Object.create(null) as Readonly<Record<string | symbol, unknown>>;
  const directInvocationIdentity = crypto.randomUUID();
  let directInvocation = 0;
  const invoke = (operation: string, input: unknown, invocation: DependencyInvocation): unknown => {
    const contractOperation = operations.get(operation);
    if (!contractOperation) {
      throw new Error(
        `Dependency ${JSON.stringify(contract.name)} has no operation ${JSON.stringify(operation)}.`,
      );
    }
    assertDependencyInvocation(invocation, `${contract.name}.${operation}`);
    assertRuntimeType(input, contractOperation.input, `${contract.name}.${operation} input`);
    const previousHeartbeat = invocation[dependencyInvocationControl]?.previousHeartbeat;
    if (previousHeartbeat !== undefined) {
      if (!contractOperation.heartbeat) {
        throw new TypeError(
          `Dependency ${contract.name}.${operation} does not declare heartbeat data.`,
        );
      }
      assertRuntimeType(
        previousHeartbeat,
        contractOperation.heartbeat,
        `${contract.name}.${operation} previous heartbeat`,
      );
    }
    const output =
      typeof dispatcher === "function"
        ? Reflect.apply(dispatcher, implementation, [operation, input, invocation])
        : Reflect.apply(
            Reflect.get(implementation, operation) as (...values: unknown[]) => unknown,
            implementation,
            [
              {
                input,
                invocation: providerInvocation(contract.name, contractOperation, invocation),
              },
            ],
          );
    return conformDependencyOutput(contract.name, contractOperation, output);
  };
  const operationWrapper = (operation: DependencyOperationIR): ((input: unknown) => unknown) => {
    let wrapper = wrappers.get(operation.name);
    if (wrapper) return wrapper;
    wrapper = (...arguments_: unknown[]) => {
      if (arguments_.length > 2) {
        throw new TypeError(
          `Dependency ${contract.name}.${operation.name} accepts one input object and optional call options.`,
        );
      }
      const input = arguments_[0];
      const options = dependencyCallOptions(arguments_[1], `${contract.name}.${operation.name}`);
      const now = Date.now();
      return invoke(operation.name, input, {
        id:
          options?.idempotencyKey === undefined
            ? `direct:${directInvocationIdentity}:${contract.name}:${operation.name}:${++directInvocation}`
            : `idempotency:${options.idempotencyKey}`,
        attempt: 1,
        scheduledAt: now,
        startedAt: now,
      });
    };
    wrappers.set(operation.name, wrapper);
    return wrapper;
  };
  const reference = contract.reference;
  const referenceFactory = reference
    ? (...arguments_: unknown[]) => {
        if (arguments_.length !== 1 || !isObject(arguments_[0])) {
          throw new TypeError(
            `Dependency ${contract.name}.${reference.name} accepts one identity object.`,
          );
        }
        const binding = arguments_[0];
        const methods = Object.create(null) as Readonly<Record<string, unknown>>;
        const bound: Readonly<Record<string, unknown>> = new Proxy(methods, {
          get(_target, property) {
            if (property === "then") return undefined;
            if (property === dependencyReferenceInstance) return true;
            if (typeof property !== "string") return undefined;
            const operation = operations.get(property);
            if (!operation) return undefined;
            return (...methodArguments: unknown[]) => {
              const acceptsInput = reference.inputs.includes(property);
              const maximum = acceptsInput ? 2 : 1;
              if (methodArguments.length > maximum || (acceptsInput && !methodArguments.length)) {
                throw new TypeError(
                  `Dependency reference ${contract.name}.${property} accepts ` +
                    `${acceptsInput ? "one input object and optional call options" : "optional call options"}.`,
                );
              }
              const input = acceptsInput ? methodArguments[0] : undefined;
              const options = methodArguments[acceptsInput ? 1 : 0];
              if (acceptsInput && !isObject(input)) {
                throw new TypeError(
                  `Dependency reference ${contract.name}.${property} input must be an object.`,
                );
              }
              if (options !== undefined && !isObject(options)) {
                throw new TypeError(
                  `Dependency reference ${contract.name}.${property} call options must be an object.`,
                );
              }
              return operationWrapper(operation)({
                ...options,
                ...binding,
                ...(acceptsInput ? { [reference.argument]: input } : {}),
              });
            };
          },
          getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
            if (typeof property !== "string" || !operations.has(property)) return undefined;
            return {
              configurable: true,
              enumerable: true,
              value: Reflect.get(bound, property),
              writable: false,
            };
          },
          has: (_target, property) =>
            property === dependencyReferenceInstance ||
            (typeof property === "string" && operations.has(property)),
          ownKeys: () => [...operations.keys()],
        });
        return bound;
      }
    : undefined;
  return new Proxy(facade, {
    get(_target, property) {
      if (property === dependencyInvocation) return invoke;
      if (referenceFactory && property === reference?.name) return referenceFactory;
      if (typeof property !== "string") return Reflect.get(implementation, property);
      const operation = operations.get(property);
      if (!operation) return Reflect.get(implementation, property);
      return operationWrapper(operation);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (referenceFactory && property === reference?.name) {
        return {
          configurable: true,
          enumerable: true,
          value: referenceFactory,
          writable: false,
        };
      }
      if (typeof property === "string") {
        const operation = operations.get(property);
        if (operation) {
          return {
            configurable: true,
            enumerable: true,
            value: operationWrapper(operation),
            writable: false,
          };
        }
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(implementation),
    has: (_target, property) =>
      property === dependencyInvocation ||
      (referenceFactory !== undefined && property === reference?.name) ||
      (typeof property === "string" && operations.has(property)) ||
      Reflect.has(implementation, property),
    ownKeys: () => [
      ...new Set<string | symbol>([
        ...Reflect.ownKeys(implementation),
        ...operations.keys(),
        ...(reference ? [reference.name] : []),
      ]),
    ],
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as Readonly<Record<string | symbol, unknown>>;
}

function providerInvocation(
  dependency: string,
  operation: DependencyOperationIR,
  invocation: DependencyInvocation,
): DependencyProviderInvocation<
  Readonly<{
    type: string;
    data: unknown;
    message?: string;
    retry?: Readonly<{ delay: number }>;
  }>
> {
  const { [dependencyInvocationControl]: control = directInvocationControl, ...metadata } =
    invocation;
  const result = { ...metadata } as DependencyProviderInvocation<
    Readonly<{
      type: string;
      data: unknown;
      message?: string;
      retry?: Readonly<{ delay: number }>;
    }>
  >;
  if (control.previousHeartbeat !== undefined) {
    Object.defineProperty(result, "previousHeartbeat", {
      configurable: false,
      enumerable: true,
      value: control.previousHeartbeat,
      writable: false,
    });
  }
  Object.defineProperties(result, {
    cancellation: {
      configurable: false,
      enumerable: false,
      value: control.cancellation,
      writable: false,
    },
    heartbeat: {
      configurable: false,
      enumerable: false,
      async value({ details }: Readonly<{ details: unknown }>): Promise<void> {
        if (!operation.heartbeat) {
          throw new TypeError(
            `Dependency ${dependency}.${operation.name} does not declare heartbeat data.`,
          );
        }
        assertRuntimeType(
          details,
          operation.heartbeat,
          `${dependency}.${operation.name} heartbeat`,
        );
        await control.heartbeat(details);
      },
      writable: false,
    },
  });
  Object.defineProperty(result, "fail", {
    configurable: false,
    enumerable: false,
    value(
      input: Readonly<{
        type: string;
        data: unknown;
        message?: string;
        retry?: Readonly<{ delay: number }>;
      }>,
    ): never {
      assertDependencyFailure(input, operation.failures, `${dependency}.${operation.name}`);
      throw new DependencyFailureError(input);
    },
    writable: false,
  });
  return Object.freeze(result);
}

/** @internal Validates a provider failure against compiler-derived meaning. */
export function assertDependencyFailure(
  failure: Readonly<{ type: string; data: unknown }> | undefined,
  failures: TypeIR | undefined,
  operation: string,
): void {
  if (
    !failure ||
    typeof failure !== "object" ||
    typeof failure.type !== "string" ||
    !failure.type
  ) {
    throw new TypeError(`Dependency ${operation} failure must have a non-empty type.`);
  }
  if (!failures || failures.kind !== "record") {
    throw new TypeError(`Dependency ${operation} does not declare product failures.`);
  }
  const contract = failures.fields.find(({ name }) => name === failure.type);
  if (!contract) {
    throw new TypeError(
      `Dependency ${operation} does not declare failure ${JSON.stringify(failure.type)}.`,
    );
  }
  assertRuntimeType(failure.data, contract.type, `${operation} failure ${failure.type}`);
}

const directInvocationControl: DependencyInvocationControl = Object.freeze({
  heartbeat() {},
  cancellation: Object.freeze({
    requested: () => false,
    wait: () => new Promise<void>(() => {}),
    subscribe: () => () => undefined,
  }),
});

function conformDependencyOutput(
  dependency: string,
  operation: DependencyContractIR["operations"][number],
  output: unknown,
): unknown {
  if (operation.mode === "asynchronous") {
    if (!isPromiseLike(output)) {
      throw new TypeError(`Dependency ${dependency}.${operation.name} must return a Promise.`);
    }
    return Promise.resolve(output).then((value) => {
      assertRuntimeType(value, operation.output, `${dependency}.${operation.name} output`);
      return value;
    });
  }
  if (operation.mode === "stream") {
    if (isPromiseLike(output)) {
      return conformDeferredStream(
        output,
        operation.output,
        `${dependency}.${operation.name} output`,
      );
    }
    if (!isAsyncIterable(output)) {
      throw new TypeError(
        `Dependency ${dependency}.${operation.name} must return an AsyncIterable.`,
      );
    }
    return conformStream(output, operation.output, `${dependency}.${operation.name} output`);
  }
  assertRuntimeType(output, operation.output, `${dependency}.${operation.name} output`);
  return output;
}

function assertDependencyInvocation(invocation: DependencyInvocation, operation: string): void {
  if (
    !invocation ||
    typeof invocation.id !== "string" ||
    !invocation.id ||
    !Number.isSafeInteger(invocation.attempt) ||
    invocation.attempt < 1 ||
    !Number.isFinite(invocation.scheduledAt) ||
    !Number.isFinite(invocation.startedAt) ||
    (invocation.deadline !== undefined && !Number.isFinite(invocation.deadline)) ||
    (invocation.trace !== undefined &&
      (!invocation.trace ||
        typeof invocation.trace.traceparent !== "string" ||
        !invocation.trace.traceparent))
  ) {
    throw new TypeError(`Dependency ${operation} received invalid invocation metadata.`);
  }
}

function conformStream(
  source: AsyncIterable<unknown>,
  contract: TypeIR,
  path: string,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      let index = 0;
      for await (const value of source) {
        assertRuntimeType(value, contract, `${path}[${index++}]`);
        yield value;
      }
    },
  };
}

function conformDeferredStream(
  pending: PromiseLike<unknown>,
  contract: TypeIR,
  path: string,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      const source = await pending;
      if (!isAsyncIterable(source)) {
        throw new TypeError(`${path} must be an AsyncIterable.`);
      }
      yield* conformStream(source, contract, path);
    },
  };
}

/** @internal Validates a runtime value against canonical portable type meaning. */
export function assertRuntimeType(value: unknown, contract: TypeIR, path: string): void {
  let valid = false;
  switch (contract.kind) {
    case "primitive":
      valid =
        contract.name === "void"
          ? value === undefined
          : contract.name === "null"
            ? value === null
            : typeof value === contract.name;
      break;
    case "opaque":
      valid = value !== undefined;
      break;
    case "literal":
      valid = Object.is(value, contract.value);
      break;
    case "array":
      if (Array.isArray(value)) {
        valid = true;
        value.forEach((item: unknown, index: number) =>
          assertRuntimeType(item, contract.element, `${path}[${index}]`),
        );
      }
      break;
    case "tuple":
      if (Array.isArray(value) && value.length === contract.elements.length) {
        valid = true;
        contract.elements.forEach((item, index) =>
          assertRuntimeType(value[index], item, `${path}[${index}]`),
        );
      }
      break;
    case "option":
      if (value === undefined) return;
      assertRuntimeType(value, contract.value, path);
      return;
    case "union":
      valid = contract.variants.some((variant) => runtimeTypeMatches(value, variant));
      break;
    case "record":
      if (isObject(value)) {
        valid = true;
        for (const field of contract.fields) {
          const fieldValue = Reflect.get(value, field.name);
          if (fieldValue === undefined && field.optional) continue;
          assertRuntimeType(fieldValue, field.type, `${path}.${field.name}`);
        }
      }
      break;
    case "promise":
      valid = isPromiseLike(value);
      break;
    case "stream":
      valid = isAsyncIterable(value);
      break;
    case "function":
      valid = typeof value === "function";
      break;
  }
  if (!valid) {
    throw new TypeError(
      `${path} received ${runtimeValueKind(value)}, which does not satisfy its semantic ` +
        `Dependency contract ${JSON.stringify(contract)}.`,
    );
  }
}

function runtimeValueKind(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "an array";
  if (isPromiseLike(value)) return "a Promise";
  if (isAsyncIterable(value)) return "an AsyncIterable";
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  return `a ${typeof value}`;
}

function runtimeTypeMatches(value: unknown, contract: TypeIR): boolean {
  try {
    assertRuntimeType(value, contract, "value");
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is object {
  return Boolean(value && (typeof value === "object" || typeof value === "function"));
}

type ResourceCleanup = () => void | Promise<void>;
type ResourceIterator = AsyncIterator<unknown>;

type RuntimeProgramDefinition = object;

type RuntimeFeature = Readonly<{
  programs?: Readonly<Record<string, RuntimeProgramDefinition>>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeSystem = Readonly<{
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

/** Adapter-owned live interpretation of one authored Program contribution. */
export type ProgramContributionRuntime = Readonly<{
  exposed: Readonly<Record<string, unknown>>;
  run(): unknown;
  dispose(): Promise<void>;
  events?: Readonly<Record<string, unknown>>;
  snapshot?(): Record<string, unknown>;
}>;

/** The sole runtime extension point required by the neutral Program assembler. */
export type ProgramLanguageRuntime = Readonly<{
  instantiate(
    input: Readonly<{
      address: ProgramContributionAddress;
      definition: object;
      dependencies: Readonly<Record<string, unknown>>;
      exposedFeatures: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      initialState?: Readonly<Record<string, unknown>>;
      provides: readonly string[];
      scope: ResourceScope;
    }>,
  ): ProgramContributionRuntime;
}>;

export type ProgramContributionInstance = Readonly<{
  address: ProgramContributionAddress;
  runtime: ProgramContributionRuntime;
  dependencies: Readonly<Record<string, unknown>>;
  provided: Readonly<Record<string, unknown>>;
  start(): Promise<Readonly<Record<string, unknown>>>;
  dispose(): Promise<void>;
}>;

export type Process = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  dependencies: Readonly<Record<string, unknown>>;
  exposed: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  dispose(): Promise<void>;
}>;

type ProgramContributionOptions = Readonly<{
  address: ProgramContributionAddress;
  language: ProgramLanguageRuntime;
  provides: readonly string[];
  providerContracts?: readonly DependencyContractIR[];
  dependencies?: Record<string, unknown>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  initialState?: Readonly<Record<string, unknown>>;
}>;

export class ResourceScope {
  readonly iterators = new Set<ResourceIterator>();
  readonly resources: ResourceCleanup[] = [];
  readonly pending = new Set<Promise<void>>();
  readonly errors: unknown[] = [];
  #active = true;
  #adopted = new WeakSet<object>();
  #disposal: Promise<void> | undefined;

  get active(): boolean {
    return this.#active;
  }

  add(cleanup: ResourceCleanup): void {
    if (!this.#active) {
      this.track(
        Promise.resolve()
          .then(cleanup)
          .catch((error: unknown) => {
            this.errors.push(error);
          }),
      );
      return;
    }
    this.resources.push(cleanup);
  }

  adopt(value: unknown): void {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    if (isPromiseLike(value)) {
      this.track(
        Promise.resolve(value).then(
          (resolved) => this.adopt(resolved),
          (error: unknown) => {
            this.errors.push(error);
          },
        ),
      );
      return;
    }
    if (this.#adopted.has(value)) return;
    if (isAsyncIterable(value)) {
      this.#adopted.add(value);
      const iterator = value[Symbol.asyncIterator]();
      this.iterators.add(iterator);
      this.track(
        (async () => {
          try {
            while (this.#active) {
              const next = await iterator.next();
              if (next.done) break;
            }
          } catch (error) {
            if (this.#active) this.errors.push(error);
          } finally {
            this.iterators.delete(iterator);
          }
        })(),
      );
      return;
    }
    const disposable = value as Partial<Disposable & AsyncDisposable>;
    if (typeof disposable[Symbol.asyncDispose] === "function") {
      this.#adopted.add(value);
      this.add(() => Promise.resolve(disposable[Symbol.asyncDispose]!()));
    } else if (typeof disposable[Symbol.dispose] === "function") {
      this.#adopted.add(value);
      this.add(() => disposable[Symbol.dispose]!());
    }
  }

  adoptResult(value: unknown): void {
    if (!isPromiseLike(value)) {
      this.adopt(value);
      return;
    }
    this.track(
      Promise.resolve(value).then(
        (resolved) => this.adopt(resolved),
        () => undefined,
      ),
    );
  }

  observeResult(value: unknown): void {
    if (!isPromiseLike(value)) {
      if (!isAsyncIterable(value)) this.adopt(value);
      return;
    }
    void Promise.resolve(value).then(
      (resolved) => {
        if (!isAsyncIterable(resolved)) this.adopt(resolved);
      },
      () => undefined,
    );
  }

  action<Value>(run: () => Value): Value {
    if (!this.#active) throw new Error("Resource scope is disposed.");
    const value = run();
    this.adoptResult(value);
    return value;
  }

  run(value: PromiseLike<unknown>): void {
    this.track(
      Promise.resolve(value).then(
        () => undefined,
        (error: unknown) => {
          this.errors.push(error);
        },
      ),
    );
  }

  track(pending: Promise<void>): void {
    this.pending.add(pending);
    void pending.then(() => {
      this.pending.delete(pending);
    });
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposal = this.#finishDisposal();
    return this.#disposal;
  }

  async #finishDisposal(): Promise<void> {
    for (const cleanup of this.resources.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        this.errors.push(error);
      }
    }
    this.resources.length = 0;
    this.#active = false;

    const iteratorResults = await Promise.allSettled(
      [...this.iterators].map((iterator) => iterator.return?.()),
    );
    this.iterators.clear();
    for (const result of iteratorResults) {
      if (result.status === "rejected") this.errors.push(result.reason);
    }

    while (this.pending.size) await Promise.all(this.pending);
    if (this.errors.length === 1) throw this.errors[0];
    if (this.errors.length > 1) {
      throw new AggregateError(this.errors, "Resource scope disposal failed.");
    }
  }
}

/** Creates one running instance of a Feature's contribution to a Program. */
export function createProgramContributionInstance(
  definition: RuntimeProgramDefinition,
  options: ProgramContributionOptions,
): ProgramContributionInstance {
  const scope = new ResourceScope();
  let starting: Promise<Readonly<Record<string, unknown>>> | undefined;
  let disposed = false;
  let provided: Readonly<Record<string, unknown>> = Object.freeze({});
  const availableDependencies = options.dependencies ?? Object.create(null);
  const dependencies = bindDependenciesToScope(availableDependencies, scope);
  const runtime = options.language.instantiate({
    address: options.address,
    definition,
    dependencies,
    exposedFeatures: options.features ?? {},
    ...(options.initialState ? { initialState: options.initialState } : {}),
    provides: options.provides,
    scope,
  });

  const instance: ProgramContributionInstance = {
    address: options.address,
    runtime,
    dependencies: availableDependencies,
    get provided() {
      return provided;
    },
    start() {
      if (starting) return starting;
      if (disposed) {
        return Promise.reject(new Error(`${formatAddress(options.address)} is disposed.`));
      }
      starting = (async () => {
        const result = runtime.run();

        if (options.provides.length) {
          const implementations = await result;
          if (!isRecord(implementations)) {
            throw new Error(
              `${formatAddress(options.address)} must return its declared Dependency object.`,
            );
          }
          const mounted = conformExternalDependencies(
            options.providerContracts ?? [],
            implementations,
          );
          provided = Object.freeze({ ...implementations, ...mounted });
          Object.assign(availableDependencies, provided);
          for (const dependency of Object.values(provided)) scope.adopt(dependency);
        } else if (result !== undefined) {
          scope.adopt(result);
        }
        return provided;
      })();
      return starting;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await runtime.dispose();
      try {
        await scope.dispose();
      } catch (error) {
        if (error instanceof AggregateError) {
          throw new AggregateError(
            error.errors,
            `${formatAddress(options.address)} disposal failed.`,
          );
        }
        throw error;
      }
    },
  };

  return instance;
}

type PlannedContribution = Readonly<{
  feature: string;
  definition: RuntimeProgramDefinition;
  manifest: ProgramContributionManifest;
  children: readonly string[];
  dependencies: readonly string[];
}>;

export type ProgramPlan = Readonly<{
  name: string;
  contributions: readonly PlannedContribution[];
  external: readonly string[];
  bindings: readonly DependencyContractIR[];
}>;

export type ProgramAssemblyOptions = Readonly<{
  system: RuntimeSystem;
  name: string;
  logicalName?: string;
  language: ProgramLanguageRuntime;
  dependencies: Readonly<Record<string, unknown>>;
  manifest: ProgramManifest;
  ownDependencies?: boolean;
  distribute?: ProgramDistributionFactory;
  initialState?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Defers Program activation until the caller has realized an initial snapshot. */
  activation?: "eager" | "deferred";
  /** @internal Feature fixtures project type-checked providers without compiler IR. */
  uncheckedProviders?: boolean;
}>;

export type ProgramDistribution = Readonly<{
  dependency(contract: DependencyContractIR, local: object): unknown;
  drain(): Promise<void>;
}>;

export type ProgramDistributionFactory = (
  input: Readonly<{
    program: string;
    contracts: readonly DependencyContractIR[];
    providers: Readonly<Record<string, unknown>>;
  }>,
) => Promise<ProgramDistribution>;

/** @internal Applies one adapter-owned distribution session to ready providers. */
export async function activateProgramDistribution(
  factory: ProgramDistributionFactory | undefined,
  program: string,
  contracts: readonly DependencyContractIR[],
  providers: Readonly<Record<string, unknown>>,
  replace: (name: string, dependency: object) => void,
): Promise<ProgramDistribution | undefined> {
  if (!factory || !contracts.length) return undefined;
  const distribution = await factory({ program, contracts, providers });
  for (const contract of contracts) {
    if (!contract.reference) continue;
    const local = providers[contract.name];
    if (!isObject(local)) {
      await distribution.drain().catch(() => undefined);
      throw new Error(
        `Distributed Dependency ${JSON.stringify(contract.name)} has no local provider.`,
      );
    }
    replace(contract.name, distribution.dependency(contract, local) as object);
  }
  return distribution;
}

/** One fully started Program and every Feature contribution assembled into it. */
export type ProgramAssembly = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  dependencies: Readonly<Record<string, unknown>>;
  exposed: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  activate(): Promise<void>;
  dispose(): Promise<void>;
}>;

/** Validates that a Program received exactly the compiler-inferred external contract. */
export function validateDependencyBindings(
  plan: ProgramPlan,
  dependencies: Readonly<Record<string, unknown>>,
): void {
  const supplied = Object.keys(dependencies).sort();
  const missing = plan.external.filter((dependency) => !Object.hasOwn(dependencies, dependency));
  const excess = supplied.filter((dependency) => !plan.external.includes(dependency));
  if (!missing.length && !excess.length) return;
  throw new Error(
    `Program "${plan.name}" external Dependencies are invalid` +
      `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
      `${excess.length ? `; unexpected: ${excess.join(", ")}` : ""}.`,
  );
}

/** Validates and orders the compiler-derived dependency graph for one Program. */
export function planProgram(
  system: RuntimeSystem,
  name: string,
  manifest: ProgramManifest,
  logicalName = name,
): ProgramPlan {
  if (manifest.name !== name) {
    throw new Error(
      `Program manifest ${JSON.stringify(manifest.name)} cannot start Program ${JSON.stringify(name)}.`,
    );
  }

  const declarations = new Map<string, ProgramContributionManifest>();
  const providers = new Map<string, string>();
  const bindings = new Map<string, DependencyContractIR>();
  for (const binding of manifest.bindings) {
    if (bindings.has(binding.name)) {
      throw new Error(
        `Program "${name}" declares Dependency binding "${binding.name}" more than once.`,
      );
    }
    bindings.set(binding.name, binding);
  }
  for (const contribution of manifest.contributions) {
    if (declarations.has(contribution.feature)) {
      throw new Error(
        `Program "${name}" declares Feature "${contribution.feature}" more than once.`,
      );
    }
    declarations.set(contribution.feature, contribution);
    for (const dependency of contribution.provides) {
      const previous = providers.get(dependency);
      if (previous) {
        throw new Error(
          `Program "${name}" has multiple providers for Dependency "${dependency}": ` +
            `Features "${previous}" and "${contribution.feature}".`,
        );
      }
      providers.set(dependency, contribution.feature);
    }
  }

  const runtime = new Map<
    string,
    Readonly<{ definition: RuntimeProgramDefinition; children: readonly string[] }>
  >();
  const visit = (feature: RuntimeFeature, path: string): void => {
    const children: string[] = [];
    for (const [childName, child] of sortedEntries(feature.features)) {
      const childPath = qualify(path, childName);
      children.push(childPath);
      visit(child, childPath);
    }
    const definition = feature.programs?.[logicalName];
    if (definition && declarations.has(path)) runtime.set(path, { definition, children });
  };
  for (const [featureName, feature] of sortedEntries(system.features)) {
    visit(feature, featureName);
  }
  if (!runtime.size) throw new Error(`System does not define Program "${name}".`);

  for (const path of runtime.keys()) {
    if (!declarations.has(path)) {
      throw new Error(`Program "${name}" manifest is missing Feature "${path}".`);
    }
  }
  for (const path of declarations.keys()) {
    if (!runtime.has(path)) {
      throw new Error(`Program "${name}" manifest contains unknown Feature "${path}".`);
    }
  }

  const external = new Set<string>();
  const pending = new Map<string, Set<string>>();
  const dependencyGraph = new Map<string, readonly string[]>();
  for (const declaration of declarations.values()) {
    const dependencies = new Set<string>();
    for (const dependency of declaration.requires) {
      const provider = providers.get(dependency);
      if (!provider) external.add(dependency);
      else if (provider !== declaration.feature) dependencies.add(provider);
    }
    pending.set(declaration.feature, dependencies);
    dependencyGraph.set(declaration.feature, [...dependencies].sort());
  }
  const ordered = orderDependencyGraph(pending);

  return {
    name,
    bindings: [...bindings.values()],
    external: [...external].sort(),
    contributions: ordered.map((feature) => {
      const declaration = declarations.get(feature)!;
      const value = runtime.get(feature)!;
      return {
        feature,
        definition: value.definition,
        manifest: declaration,
        children: value.children,
        dependencies: dependencyGraph.get(feature) ?? [],
      };
    }),
  };
}

/** Assembles and starts every Feature contribution to one named Program. */
export async function assembleProgram(options: ProgramAssemblyOptions): Promise<ProgramAssembly> {
  const plan = planProgram(
    options.system,
    options.name,
    options.manifest,
    options.logicalName ?? options.name,
  );
  const exposed: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const externalScope = new ResourceScope();
  const providedDependencies: Record<string, unknown> = Object.create(null);
  const deferredDependencies = new Map<string, DeferredDependencyBinding>();
  const providedNames = new Set(plan.contributions.flatMap(({ manifest }) => manifest.provides));
  for (const name of [...providedNames].sort()) {
    const binding = createDeferredDependencyBinding(name);
    deferredDependencies.set(name, binding);
    providedDependencies[name] = binding.dependency;
  }

  validateDependencyBindings(plan, options.dependencies);
  if (options.ownDependencies !== false) {
    for (const dependency of Object.values(options.dependencies)) externalScope.adopt(dependency);
  }

  const instances = new Map<string, ProgramContributionInstance>();
  const registries = new Map<string, Record<string, unknown>>();
  const definitions = new Map(plan.contributions.map((value) => [value.feature, value]));
  const instantiate = (path: string): Readonly<Record<string, unknown>> => {
    const existing = instances.get(path);
    if (existing) return existing.runtime.exposed;
    const planned = definitions.get(path);
    if (!planned) return Object.freeze({});
    const children: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
    for (const child of planned.children) {
      children[child.slice(path.length + 1)] = instantiate(child);
    }
    const registry: Record<string, unknown> = Object.create(null);
    for (const dependency of planned.manifest.requires) {
      if (Object.hasOwn(options.dependencies, dependency)) {
        registry[dependency] = scopeDependency(options.dependencies[dependency], {
          program: options.name,
          feature: path,
        });
      } else if (Object.hasOwn(providedDependencies, dependency)) {
        registry[dependency] = providedDependencies[dependency];
      }
    }
    const instance = createProgramContributionInstance(planned.definition, {
      address: { program: options.name, feature: path },
      language: options.language,
      provides: planned.manifest.provides,
      providerContracts: planned.manifest.provides.flatMap((name) => {
        const contract = plan.bindings.find((binding) => binding.name === name);
        return contract ? [contract] : [];
      }),
      dependencies: registry,
      features: children,
      initialState: options.initialState?.[path],
    });
    instances.set(path, instance);
    registries.set(path, registry);
    exposed[path] = instance.runtime.exposed;
    return exposed[path]!;
  };

  let distribution: ProgramDistribution | undefined;
  try {
    for (const contribution of plan.contributions) instantiate(contribution.feature);
  } catch (error) {
    await disposeProgram([...instances.values()], externalScope).catch(() => undefined);
    throw error;
  }

  const contributions = plan.contributions.map(({ feature }) => instances.get(feature)!);
  let disposed = false;
  let activation: Promise<void> | undefined;
  const activate = (): Promise<void> => {
    if (activation) return activation;
    if (disposed) {
      return Promise.reject(new Error(`Program "${plan.name}" is disposed.`));
    }
    activation = (async () => {
      try {
        for (const planned of plan.contributions) {
          const instance = instances.get(planned.feature)!;
          const provided = await instance.start();
          const actual = Object.keys(provided).sort();
          const declared = [...planned.manifest.provides].sort();
          if (actual.join("\n") !== declared.join("\n")) {
            throw new Error(
              `${formatAddress(instance.address)} provided [${actual.join(", ")}] but its contract declares ` +
                `[${declared.join(", ")}].`,
            );
          }
          for (const [name, value] of Object.entries(provided)) {
            const contract = plan.bindings.find((binding) => binding.name === name);
            const dependency =
              !contract && options.uncheckedProviders
                ? createUncheckedDependencyClient(value as never)
                : value;
            deferredDependencies.get(name)?.bind(dependency as object);
          }
        }
        if (options.distribute && providedNames.size) {
          const contracts = plan.bindings.filter(({ name }) => providedNames.has(name));
          const providers = Object.freeze(
            Object.fromEntries(
              [...instances.values()].flatMap((instance) => Object.entries(instance.provided)),
            ),
          );
          distribution = await activateProgramDistribution(
            options.distribute,
            plan.name,
            contracts,
            providers,
            (name, dependency) => deferredDependencies.get(name)?.replace(dependency),
          );
        }
      } catch (error) {
        disposed = true;
        await distribution?.drain().catch(() => undefined);
        await disposeProgram(contributions, externalScope).catch(() => undefined);
        throw error;
      }
    })();
    return activation;
  };
  const assembly: ProgramAssembly = {
    name: options.name,
    contributions,
    dependencies: Object.freeze({ ...options.dependencies, ...providedDependencies }),
    exposed,
    activate,
    async dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        await distribution?.drain();
      } catch (error) {
        errors.push(error);
      }
      try {
        await disposeProgram(contributions, externalScope);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, `Program "${plan.name}" disposal failed.`);
      }
    },
  };
  if (options.activation !== "deferred") await activate();
  return assembly;
}

/** Starts one live Process instance of a named Program. */
export async function startProcess<Contract extends SystemContract>(
  system: System<Contract>,
  name: string,
  dependencies: Readonly<Record<string, unknown>>,
  manifest: ProgramManifest,
  language: ProgramLanguageRuntime,
  logicalName = name,
): Promise<Process> {
  return assembleProgram({
    system: system as RuntimeSystem,
    name,
    logicalName,
    language,
    dependencies,
    manifest,
  });
}

export type FeatureFixtureContribution = Readonly<{
  /** Empty for the tested Feature itself; otherwise a child Feature path. */
  feature: string;
  requires: readonly string[];
  provides: readonly string[];
}>;

/**
 * Starts one directly mountable Feature through the ordinary Program planner.
 *
 * Factory-owned testing APIs supply their private graph while consumers see
 * only the resulting semantic API. No fragment is mounted independently.
 */
export async function startFeatureFixture<Contract extends FeatureContract>(input: {
  feature: Feature<Contract>;
  program: Extract<keyof NonNullable<Contract["Programs"]>, string>;
  language: ProgramLanguageRuntime;
  dependencies: Readonly<Record<string, unknown>>;
  contributions: readonly FeatureFixtureContribution[];
  bindings?: readonly DependencyContractIR[];
  initialState?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}): Promise<Process> {
  const root = "feature";
  const name = "fixture";
  const manifest: ProgramManifest = {
    name,
    bindings: input.bindings ?? [],
    contributions: input.contributions.map((contribution) => ({
      ...contribution,
      feature: contribution.feature ? `${root}.${contribution.feature}` : root,
    })),
  };
  return assembleProgram({
    system: { features: { [root]: input.feature as unknown as RuntimeFeature } },
    name,
    logicalName: input.program,
    language: input.language,
    dependencies: input.dependencies,
    manifest,
    initialState: input.initialState,
    uncheckedProviders: true,
  });
}

async function disposeProgram(
  contributions: readonly ProgramContributionInstance[],
  external: ResourceScope,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await disposeContributions(contributions);
  } catch (error) {
    errors.push(error);
  }
  try {
    await external.dispose();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Process disposal failed.");
}

export function bindDependenciesToScope(
  dependencies: Readonly<Record<string, unknown>>,
  scope: ResourceScope,
): Readonly<Record<string, unknown>> {
  const proxies = new WeakMap<object, object>();

  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (isPromiseLike(value)) return Promise.resolve(value).then((resolved) => wrap(resolved));
    if (isDisposable(value)) return value;
    const cached = proxies.get(value);
    if (cached) return cached;
    if (isAsyncIterable(value)) {
      const iterable = {
        [Symbol.asyncIterator]() {
          const source = value[Symbol.asyncIterator]();
          const iterator: ResourceIterator = {
            async next() {
              const result = await source.next();
              if (result.done) scope.iterators.delete(iterator);
              return result;
            },
            async return(next) {
              scope.iterators.delete(iterator);
              return source.return ? source.return(next) : { done: true, value: next };
            },
            async throw(error) {
              scope.iterators.delete(iterator);
              if (source.throw) return source.throw(error);
              throw error;
            },
          };
          if (!scope.active) throw new Error("Program contribution is disposed.");
          scope.iterators.add(iterator);
          return iterator;
        },
      };
      proxies.set(value, iterable);
      return iterable;
    }
    if (Array.isArray(value)) {
      const array = Array.from<unknown>({ length: value.length });
      proxies.set(value, array);
      for (let index = 0; index < value.length; index += 1) {
        array[index] = wrap(value[index]);
      }
      return array;
    }

    const shell =
      typeof value === "function"
        ? (...args: readonly unknown[]) => {
            if (!scope.active) throw new Error("Program contribution is disposed.");
            const result = Reflect.apply(value, undefined, args);
            scope.observeResult(result);
            return wrap(result);
          }
        : (Object.create(null) as object);
    const proxy = new Proxy(shell, {
      get(_target, property) {
        const next = Reflect.get(value, property, value);
        if (typeof next === "function") {
          return (...args: readonly unknown[]) => {
            if (!scope.active) throw new Error("Program contribution is disposed.");
            const result = Reflect.apply(next, value, args);
            if (!isAsyncIterableValue(result)) scope.observeResult(result);
            return wrap(result);
          };
        }
        return wrap(next);
      },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
      getPrototypeOf() {
        return Reflect.getPrototypeOf(value);
      },
      has(_target, property) {
        return Reflect.has(value, property);
      },
      ownKeys() {
        return Reflect.ownKeys(value);
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };

  return wrap(dependencies) as Readonly<Record<string, unknown>>;
}

async function disposeContributions(instances: readonly ProgramContributionInstance[]) {
  const errors: unknown[] = [];
  for (const instance of [...instances].reverse()) {
    try {
      await instance.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Program disposal failed.");
}

function sortedEntries<Value>(
  value: Readonly<Record<string, Value>> | undefined,
): Array<[string, Value]> {
  return Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function qualify(parent: string, name: string): string {
  return parent ? `${parent}.${name}` : name;
}

function formatAddress(address: ProgramContributionAddress): string {
  return `Program "${address.program}" Feature "${address.feature}"`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.asyncIterator in value,
  );
}

const isAsyncIterableValue = isAsyncIterable;

function isDisposable(value: object): value is Disposable | AsyncDisposable {
  return Symbol.dispose in value || Symbol.asyncDispose in value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
