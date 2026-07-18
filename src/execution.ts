import { endBatch, signal as createSignal, startBatch } from "alien-signals";

import type { Application, ApplicationContract } from "./application";

type RuntimeCleanup = () => void | Promise<void>;
type RuntimeIterator = AsyncIterator<unknown>;

type RuntimeUI = Readonly<{
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<
    Record<string, (scope: RuntimeActionScope, ...args: readonly unknown[]) => unknown>
  >;
  components?: Readonly<Record<string, unknown>>;
  root?: string;
}>;

type RuntimeProgramDefinition = Readonly<{
  start?: (scope: RuntimeStartScope) => unknown;
}> &
  RuntimeUI;

type RuntimeFeature = Readonly<{
  programs?: Readonly<Record<string, RuntimeProgramDefinition>>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeApplication = Readonly<{
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeActionScope = Readonly<{
  capabilities: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  state: Record<string, unknown>;
}>;

type RuntimeStartScope = Readonly<{
  capabilities: Readonly<Record<string, unknown>>;
  actions?: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

export type ProgramAddress = Readonly<{
  program: string;
  feature: string;
}>;

/** Adapter-owned binding between a Program contribution and its environment. */
export type ProgramAdapter = Readonly<{
  resolve(
    address: ProgramAddress,
  ): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
  publish?(
    address: ProgramAddress,
    capabilities: Readonly<Record<string, unknown>>,
  ): void | Promise<void>;
}>;

export type UIInstance = Readonly<{
  surface: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  actions: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
  snapshot(): Record<string, unknown>;
  dispose(): Promise<void>;
}>;

export type ProgramContributionInstance = Readonly<{
  address: ProgramAddress;
  ui?: UIInstance;
  capabilities: Readonly<Record<string, unknown>>;
  provided: Readonly<Record<string, unknown>>;
  start(): Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}>;

export type Process = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  surfaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  dispose(): Promise<void>;
}>;

type UIInstanceOptions = Readonly<{
  capabilities?: Readonly<Record<string, unknown>>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  name?: string;
  initialState?: Readonly<Record<string, unknown>>;
  scope?: RuntimeScope;
}>;

/** Creates one Feature-local UI state/action surface inside a Program Process. */
export function createUIInstance(
  definition: RuntimeUI,
  options: UIInstanceOptions = {},
): UIInstance {
  const name = options.name ?? "ui";
  let disposed = false;
  const initialState = Object.fromEntries(
    Object.entries(definition.state ?? {}).map(([key, value]) => [
      key,
      Object.hasOwn(options.initialState ?? {}, key) ? options.initialState![key] : value,
    ]),
  );
  const state = createReactiveRecord(initialState, () => disposed);
  const capabilities = options.capabilities ?? {};
  const features = options.features ?? {};
  const ownsScope = !options.scope;
  const scope = options.scope ?? new RuntimeScope();
  let disposal: Promise<void> | undefined;
  const actions: Record<string, (...args: readonly unknown[]) => unknown> = Object.create(null);

  for (const [actionName, implementation] of Object.entries(definition.actions ?? {})) {
    actions[actionName] = (...args: readonly unknown[]) => {
      if (disposed) throw new Error(`UI contribution "${name}" is disposed.`);
      return scope.action(() => implementation({ capabilities, features, state }, ...args));
    };
  }

  const surface = Object.create(null) as Record<string, unknown>;
  for (const stateName of Object.keys(definition.state ?? {})) {
    if (stateName in actions) {
      throw new Error(`UI contribution "${name}" declares state and action "${stateName}".`);
    }
    Object.defineProperty(surface, stateName, {
      enumerable: true,
      get: () => state[stateName],
    });
  }
  Object.assign(surface, actions);

  return {
    surface,
    state,
    actions,
    snapshot() {
      return Object.fromEntries(Object.keys(initialState).map((key) => [key, state[key]]));
    },
    async dispose() {
      disposed = true;
      if (!ownsScope) return;
      disposal ??= scope.dispose();
      await disposal;
    },
  };
}

type ProgramContributionOptions = Readonly<{
  address: ProgramAddress;
  capabilities?: Readonly<Record<string, unknown>>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  initialState?: Readonly<Record<string, unknown>>;
}>;

export class RuntimeScope {
  readonly iterators = new Set<RuntimeIterator>();
  readonly resources: RuntimeCleanup[] = [];
  readonly pending = new Set<Promise<void>>();
  readonly errors: unknown[] = [];
  #active = true;
  #adopted = new WeakSet<object>();
  #disposal: Promise<void> | undefined;

  get active(): boolean {
    return this.#active;
  }

  add(cleanup: RuntimeCleanup): void {
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

  action<Value>(run: () => Value): Value {
    if (!this.#active) throw new Error("Runtime owner is disposed.");
    startBatch();
    try {
      const value = run();
      this.adopt(value);
      return value;
    } finally {
      endBatch();
    }
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
    this.#active = false;
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
      throw new AggregateError(this.errors, "Runtime scope disposal failed.");
    }
  }
}

/** Creates one running instance of a Feature's contribution to a Program. */
export function createProgramContributionInstance(
  definition: RuntimeProgramDefinition,
  options: ProgramContributionOptions,
): ProgramContributionInstance {
  const scope = new RuntimeScope();
  let started = false;
  let disposed = false;
  let provided: Readonly<Record<string, unknown>> = Object.freeze({});
  const availableCapabilities: Record<string, unknown> = {
    ...options.capabilities,
  };
  const capabilities = scopeCapabilities(availableCapabilities, scope);
  const ui = hasRuntimeUI(definition)
    ? createUIInstance(definition, {
        name: `${options.address.program}:${options.address.feature}`,
        capabilities,
        features: options.features,
        initialState: options.initialState,
        scope,
      })
    : undefined;

  const instance: ProgramContributionInstance = {
    address: options.address,
    ui,
    capabilities: availableCapabilities,
    get provided() {
      return provided;
    },
    start() {
      if (started) return provided;
      if (disposed) throw new Error(`${formatAddress(options.address)} is disposed.`);
      started = true;
      if (!definition.start) return provided;

      const result = definition.start({
        capabilities,
        ...(ui
          ? {
              actions: ui.actions,
              features: options.features ?? {},
            }
          : {}),
      });

      if (isPromiseLike(result)) {
        scope.adopt(result);
      } else if (result !== undefined) {
        if (
          result !== null &&
          typeof result === "object" &&
          (isDisposable(result) || isAsyncIterable(result))
        ) {
          scope.adopt(result);
        } else {
          if (!isRecord(result)) {
            throw new Error(
              `${formatAddress(options.address)} start must return a resource or Capability object.`,
            );
          }
          provided = Object.freeze({ ...result });
          Object.assign(availableCapabilities, provided);
          for (const capability of Object.values(provided)) scope.adopt(capability);
        }
      }
      return provided;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await ui?.dispose();
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

/** Starts every Feature contribution to one named Program. */
export async function startProgram<Contract extends ApplicationContract>(
  application: Application<Contract>,
  name: string,
  adapter: ProgramAdapter,
): Promise<Process> {
  const runtime = application as RuntimeApplication;
  const contributions: ProgramContributionInstance[] = [];
  const surfaces: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const providedCapabilities: Record<string, unknown> = Object.create(null);
  let found = false;

  type ResolvedFeature = Readonly<{
    feature: RuntimeFeature;
    path: string;
    children: readonly ResolvedFeature[];
    capabilities?: Readonly<Record<string, unknown>>;
  }>;

  const resolveFeature = async (
    feature: RuntimeFeature,
    path: string,
  ): Promise<ResolvedFeature> => {
    const children: ResolvedFeature[] = [];
    for (const [childName, child] of sortedEntries(feature.features)) {
      children.push(await resolveFeature(child, qualify(path, childName)));
    }
    const definition = feature.programs?.[name];
    if (!definition) return { feature, path, children };

    found = true;
    const address = { program: name, feature: path };
    const capabilities = await adapter.resolve(address);
    if (!isRecord(capabilities)) {
      throw new Error(`${formatAddress(address)} adapter returned invalid Capabilities.`);
    }
    return { feature, path, children, capabilities };
  };

  const instantiate = async (node: ResolvedFeature): Promise<Readonly<Record<string, unknown>>> => {
    const children: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
    for (const child of node.children) {
      children[child.path.slice(node.path.length + 1)] = await instantiate(child);
    }

    const definition = node.feature.programs?.[name];
    if (!definition) {
      const empty = Object.freeze(Object.create(null) as Record<string, unknown>);
      surfaces[node.path] = empty;
      return empty;
    }

    const address = { program: name, feature: node.path };
    const instance = createProgramContributionInstance(definition, {
      address,
      capabilities: { ...node.capabilities, ...providedCapabilities },
      features: children,
    });
    contributions.push(instance);
    const provided = instance.start();
    for (const [capabilityName, capability] of Object.entries(provided)) {
      if (Object.hasOwn(providedCapabilities, capabilityName)) {
        throw new Error(
          `Program "${name}" has multiple providers for Capability "${capabilityName}".`,
        );
      }
      providedCapabilities[capabilityName] = capability;
    }
    if (Object.keys(provided).length) await adapter.publish?.(address, provided);
    const surface = instance.ui?.surface ?? Object.freeze({});
    surfaces[node.path] = surface;
    return surface;
  };

  try {
    const roots: ResolvedFeature[] = [];
    for (const [featureName, feature] of sortedEntries(runtime.features)) {
      roots.push(await resolveFeature(feature, featureName));
    }
    if (!found) throw new Error(`Application does not define Program "${name}".`);
    for (const root of roots) await instantiate(root);
  } catch (error) {
    await disposeContributions(contributions);
    throw error;
  }

  let disposed = false;
  return {
    name,
    contributions,
    surfaces,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await disposeContributions(contributions);
    },
  };
}

function createReactiveRecord(
  initial: Readonly<Record<string, unknown>>,
  isDisposed: () => boolean,
): Record<string, unknown> {
  const values = new Map(
    Object.entries(cloneRecord(initial)).map(([name, value]) => [name, createSignal(value)]),
  );
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      return typeof name === "string" ? values.get(name)?.() : undefined;
    },
    set(_target, name, value) {
      if (typeof name !== "string") return false;
      if (isDisposed()) return true;
      const current = values.get(name);
      if (!current) throw new Error(`Unknown UI state "${name}".`);
      current(value);
      return true;
    },
    ownKeys() {
      return [...values.keys()];
    },
    getOwnPropertyDescriptor(_target, name) {
      return typeof name === "string" && values.has(name)
        ? { configurable: true, enumerable: true }
        : undefined;
    },
  });
}

function hasRuntimeUI(definition: RuntimeProgramDefinition): boolean {
  return Boolean(
    definition.state || definition.actions || definition.components || definition.root,
  );
}

export function scopeCapabilities(
  capabilities: Readonly<Record<string, unknown>>,
  scope: RuntimeScope,
): Readonly<Record<string, unknown>> {
  const proxies = new WeakMap<object, object>();

  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || isPromiseLike(value)) return value;
    if (isDisposable(value)) return value;
    const cached = proxies.get(value);
    if (cached) return cached;
    if (isAsyncIterable(value)) {
      const iterable = {
        [Symbol.asyncIterator]() {
          const source = value[Symbol.asyncIterator]();
          const iterator: RuntimeIterator = {
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

    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        const next = Reflect.get(target, property, receiver);
        if (typeof next === "function") {
          return (...args: readonly unknown[]) => {
            if (!scope.active) throw new Error("Program contribution is disposed.");
            const result = Reflect.apply(next, target, args);
            scope.adopt(result);
            return wrap(result);
          };
        }
        return wrap(next);
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };

  return wrap(capabilities) as Readonly<Record<string, unknown>>;
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

function formatAddress(address: ProgramAddress): string {
  return `Program "${address.program}" Feature "${address.feature}"`;
}

function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  try {
    return structuredClone(value);
  } catch {
    return { ...value };
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return Symbol.asyncIterator in value;
}

function isDisposable(value: object): value is Disposable | AsyncDisposable {
  return Symbol.dispose in value || Symbol.asyncDispose in value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
