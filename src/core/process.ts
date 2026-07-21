import { endBatch, signal as createSignal, startBatch } from "alien-signals";

import type { Application, ApplicationContract } from "@/core/application";
import type {
  ProgramContributionAddress,
  ProgramContributionManifest,
  ProgramManifest,
} from "@/core/capability";
import { createActionEventLedger, type ActionEvent } from "@/core/presentation";
import { createReactiveState } from "@/core/state";

type ResourceCleanup = () => void | Promise<void>;
type ResourceIterator = AsyncIterator<unknown>;

type RuntimeUI = Readonly<{
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<
    Record<string, (context: RuntimeActionContext, ...args: readonly unknown[]) => unknown>
  >;
  components?: Readonly<Record<string, unknown>>;
  root?: string;
}>;

type RuntimeProgramDefinition = Readonly<{
  start?: (context: RuntimeStartContext) => unknown;
}> &
  RuntimeUI;

type RuntimeFeature = Readonly<{
  programs?: Readonly<Record<string, RuntimeProgramDefinition>>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeApplication = Readonly<{
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeActionContext = Readonly<{
  capabilities: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  state: Record<string, unknown>;
}>;

type RuntimeStartContext = Readonly<{
  capabilities: Readonly<Record<string, unknown>>;
  actions?: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

export type UIContributionInstance = Readonly<{
  api: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  actions: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;
  events: Readonly<Record<string, ActionEvent<(...args: never[]) => unknown>>>;
  snapshot(): Record<string, unknown>;
  dispose(): Promise<void>;
}>;

export type ProgramContributionInstance = Readonly<{
  address: ProgramContributionAddress;
  ui?: UIContributionInstance;
  capabilities: Readonly<Record<string, unknown>>;
  provided: Readonly<Record<string, unknown>>;
  start(): Readonly<Record<string, unknown>>;
  dispose(): Promise<void>;
}>;

export type Process = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  capabilities: Readonly<Record<string, unknown>>;
  ui: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  dispose(): Promise<void>;
}>;

type UIContributionOptions = Readonly<{
  capabilities?: Readonly<Record<string, unknown>>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  name?: string;
  initialState?: Readonly<Record<string, unknown>>;
  scope?: ResourceScope;
  onActionEvent?: () => void;
}>;

/** Creates one live Feature-local UI API inside a Process. */
export function createUIContributionInstance(
  definition: RuntimeUI,
  options: UIContributionOptions = {},
): UIContributionInstance {
  const name = options.name ?? "ui";
  let disposed = false;
  const initialState = Object.fromEntries(
    Object.entries(definition.state ?? {}).map(([key, value]) => [
      key,
      Object.hasOwn(options.initialState ?? {}, key) ? options.initialState![key] : value,
    ]),
  );
  const state = createReactiveState(initialState, createSignal, () => !disposed);
  const capabilities = options.capabilities ?? {};
  const features = options.features ?? {};
  const ownsScope = !options.scope;
  const scope = options.scope ?? new ResourceScope();
  let disposal: Promise<void> | undefined;
  const actions: Record<string, (...args: readonly unknown[]) => unknown> = Object.create(null);
  const eventLedger = createActionEventLedger(
    Object.keys(definition.actions ?? {}),
    options.onActionEvent,
  );

  for (const [actionName, implementation] of Object.entries(definition.actions ?? {})) {
    actions[actionName] = (...args: readonly unknown[]) => {
      if (disposed) throw new Error(`UI contribution "${name}" is disposed.`);
      return eventLedger.invoke(actionName, args, () =>
        scope.action(() =>
          implementation({ capabilities, features, state: state.mutable }, ...args),
        ),
      );
    };
  }

  const api = Object.create(null) as Record<string, unknown>;
  for (const stateName of Object.keys(definition.state ?? {})) {
    if (stateName in actions) {
      throw new Error(`UI contribution "${name}" declares state and action "${stateName}".`);
    }
    Object.defineProperty(api, stateName, {
      enumerable: true,
      get: state.cells[stateName],
    });
  }
  Object.assign(api, actions);

  return {
    api,
    state: state.read,
    actions,
    events: eventLedger.events,
    snapshot() {
      return state.snapshot();
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
  address: ProgramContributionAddress;
  capabilities?: Record<string, unknown>;
  features?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  initialState?: Readonly<Record<string, unknown>>;
  onActionEvent?: () => void;
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

  action<Value>(run: () => Value): Value {
    if (!this.#active) throw new Error("Resource scope is disposed.");
    startBatch();
    try {
      const value = run();
      this.adoptResult(value);
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
  let started = false;
  let disposed = false;
  let provided: Readonly<Record<string, unknown>> = Object.freeze({});
  const availableCapabilities = options.capabilities ?? Object.create(null);
  const capabilities = bindCapabilitiesToScope(availableCapabilities, scope);
  const ui = hasRuntimeUI(definition)
    ? createUIContributionInstance(definition, {
        name: `${options.address.program}:${options.address.feature}`,
        capabilities,
        features: options.features,
        initialState: options.initialState,
        scope,
        onActionEvent: options.onActionEvent,
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
}>;

/** Validates that a Program received exactly the compiler-inferred external contract. */
export function validateProgramCapabilities(
  plan: ProgramPlan,
  capabilities: Readonly<Record<string, unknown>>,
): void {
  const supplied = Object.keys(capabilities).sort();
  const missing = plan.external.filter((capability) => !Object.hasOwn(capabilities, capability));
  const excess = supplied.filter((capability) => !plan.external.includes(capability));
  if (!missing.length && !excess.length) return;
  throw new Error(
    `Program "${plan.name}" external Capabilities are invalid` +
      `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
      `${excess.length ? `; unexpected: ${excess.join(", ")}` : ""}.`,
  );
}

/** Validates and orders the compiler-derived dependency graph for one Program. */
export function planProgram(
  application: RuntimeApplication,
  name: string,
  manifest: ProgramManifest,
): ProgramPlan {
  if (manifest.name !== name) {
    throw new Error(
      `Program manifest ${JSON.stringify(manifest.name)} cannot start Program ${JSON.stringify(name)}.`,
    );
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
    const definition = feature.programs?.[name];
    if (definition) runtime.set(path, { definition, children });
  };
  for (const [featureName, feature] of sortedEntries(application.features)) {
    visit(feature, featureName);
  }
  if (!runtime.size) throw new Error(`Application does not define Program "${name}".`);

  const declarations = new Map<string, ProgramContributionManifest>();
  const providers = new Map<string, string>();
  for (const contribution of manifest.contributions) {
    if (declarations.has(contribution.feature)) {
      throw new Error(
        `Program "${name}" declares Feature "${contribution.feature}" more than once.`,
      );
    }
    declarations.set(contribution.feature, contribution);
    for (const capability of contribution.provides) {
      const previous = providers.get(capability);
      if (previous) {
        throw new Error(
          `Program "${name}" has multiple providers for Capability "${capability}": ` +
            `Features "${previous}" and "${contribution.feature}".`,
        );
      }
      providers.set(capability, contribution.feature);
    }
  }

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
  const dependants = new Map<string, Set<string>>();
  for (const declaration of declarations.values()) {
    const dependencies = new Set<string>();
    for (const capability of declaration.requires) {
      const provider = providers.get(capability);
      if (!provider) external.add(capability);
      else if (provider !== declaration.feature) dependencies.add(provider);
    }
    pending.set(declaration.feature, dependencies);
    dependencyGraph.set(declaration.feature, [...dependencies].sort());
    for (const dependency of dependencies) {
      const values = dependants.get(dependency) ?? new Set<string>();
      values.add(declaration.feature);
      dependants.set(dependency, values);
    }
  }

  const ready = [...pending]
    .filter(([, dependencies]) => !dependencies.size)
    .map(([feature]) => feature)
    .sort();
  const ordered: string[] = [];
  while (ready.length) {
    const feature = ready.shift()!;
    ordered.push(feature);
    for (const dependant of [...(dependants.get(feature) ?? [])].sort()) {
      const dependencies = pending.get(dependant)!;
      dependencies.delete(feature);
      if (!dependencies.size) insertSorted(ready, dependant);
    }
  }
  if (ordered.length !== pending.size) {
    const cycle = [...pending]
      .filter(([feature]) => !ordered.includes(feature))
      .map(([feature]) => feature)
      .sort();
    throw new Error(
      `Program "${name}" has a Capability provider cycle between Features: ${cycle.join(", ")}.`,
    );
  }

  return {
    name,
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

/** Starts every Feature contribution to one named Program. */
export async function startProcess<Contract extends ApplicationContract>(
  application: Application<Contract>,
  name: string,
  capabilities: Readonly<Record<string, unknown>>,
  manifest: ProgramManifest,
): Promise<Process> {
  const runtime = application as RuntimeApplication;
  const plan = planProgram(runtime, name, manifest);
  const contributions: ProgramContributionInstance[] = [];
  const ui: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const externalScope = new ResourceScope();
  const providedCapabilities: Record<string, unknown> = Object.create(null);

  validateProgramCapabilities(plan, capabilities);
  for (const capability of Object.values(capabilities)) externalScope.adopt(capability);

  const instances = new Map<string, ProgramContributionInstance>();
  const registries = new Map<string, Record<string, unknown>>();
  const definitions = new Map(plan.contributions.map((value) => [value.feature, value]));
  const instantiate = (path: string): Readonly<Record<string, unknown>> => {
    const existing = instances.get(path);
    if (existing) return existing.ui?.api ?? Object.freeze({});
    const planned = definitions.get(path);
    if (!planned) return Object.freeze({});
    const children: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
    for (const child of planned.children) {
      children[child.slice(path.length + 1)] = instantiate(child);
    }
    const registry: Record<string, unknown> = Object.create(null);
    for (const capability of planned.manifest.requires) {
      if (Object.hasOwn(capabilities, capability)) registry[capability] = capabilities[capability];
    }
    const instance = createProgramContributionInstance(planned.definition, {
      address: { program: name, feature: path },
      capabilities: registry,
      features: children,
    });
    instances.set(path, instance);
    registries.set(path, registry);
    ui[path] = instance.ui?.api ?? Object.freeze({});
    return ui[path]!;
  };

  try {
    for (const contribution of plan.contributions) instantiate(contribution.feature);
    for (const planned of plan.contributions) {
      const instance = instances.get(planned.feature)!;
      const registry = registries.get(planned.feature)!;
      for (const capability of planned.manifest.requires) {
        if (Object.hasOwn(providedCapabilities, capability)) {
          registry[capability] = providedCapabilities[capability];
        }
      }
      const provided = instance.start();
      const actual = Object.keys(provided).sort();
      const declared = [...planned.manifest.provides].sort();
      if (actual.join("\n") !== declared.join("\n")) {
        throw new Error(
          `${formatAddress(instance.address)} provided [${actual.join(", ")}] but its contract declares ` +
            `[${declared.join(", ")}].`,
        );
      }
      Object.assign(providedCapabilities, provided);
      contributions.push(instance);
    }
  } catch (error) {
    const created = [...instances.values()];
    await disposeProgram(created, externalScope).catch(() => undefined);
    throw error;
  }

  let disposed = false;
  return {
    name,
    contributions,
    capabilities: Object.freeze({ ...capabilities, ...providedCapabilities }),
    ui,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await disposeProgram(contributions, externalScope);
    },
  };
}

function insertSorted(values: string[], value: string): void {
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
  if (index === -1) values.push(value);
  else values.splice(index, 0, value);
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

function hasRuntimeUI(definition: RuntimeProgramDefinition): boolean {
  return Boolean(
    definition.state || definition.actions || definition.components || definition.root,
  );
}

export function bindCapabilitiesToScope(
  capabilities: Readonly<Record<string, unknown>>,
  scope: ResourceScope,
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

    const shell =
      typeof value === "function"
        ? (...args: readonly unknown[]) => {
            if (!scope.active) throw new Error("Program contribution is disposed.");
            const result = Reflect.apply(value, undefined, args);
            scope.adoptResult(result);
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
            if (!isAsyncIterableValue(result)) scope.adoptResult(result);
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

function formatAddress(address: ProgramContributionAddress): string {
  return `Program "${address.program}" Feature "${address.feature}"`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return Symbol.asyncIterator in value;
}

function isAsyncIterableValue(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value && (typeof value === "object" || typeof value === "function") && isAsyncIterable(value),
  );
}

function isDisposable(value: object): value is Disposable | AsyncDisposable {
  return Symbol.dispose in value || Symbol.asyncDispose in value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
