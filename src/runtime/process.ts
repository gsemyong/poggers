import { endBatch, signal as createSignal, startBatch } from "alien-signals";

import type {
  DependencyContractIR,
  ProgramContributionManifest,
  ProgramManifest,
  TypeIR,
} from "@/compiler/ir";
import type { Application, ApplicationContract } from "@/core/application";
import type { ProgramContributionAddress } from "@/core/dependency";
import type { ActionEvent } from "@/core/ui/presentation";
import { createActionEventLedger } from "@/runtime/presentation";
import { createReactiveState } from "@/runtime/state";

/** Internal protocol for a host Dependency whose API is scoped to one Feature contribution. */
export const dependencyScope: unique symbol = Symbol("poggers.dependency.scope");

export type DependencyScope = Readonly<{ program: string; feature: string }>;

export type ScopedDependency = Readonly<{
  [dependencyScope](scope: DependencyScope): unknown;
}>;

export function scopeDependency(value: unknown, scope: DependencyScope): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
  const scoped = (value as Partial<ScopedDependency>)[dependencyScope];
  return typeof scoped === "function" ? scoped.call(value, scope) : value;
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
  for (const operation of operations.values()) {
    if (typeof Reflect.get(implementation, operation.name) !== "function") {
      throw new Error(
        `External Dependency ${JSON.stringify(contract.name)} does not implement operation ` +
          `${JSON.stringify(operation.name)}.`,
      );
    }
  }
  const wrappers = new Map<string, (...arguments_: unknown[]) => unknown>();
  const facade = Object.create(null) as Readonly<Record<string | symbol, unknown>>;
  return new Proxy(facade, {
    get(_target, property) {
      if (typeof property !== "string") return Reflect.get(implementation, property);
      const operation = operations.get(property);
      if (!operation) return Reflect.get(implementation, property);
      let wrapper = wrappers.get(property);
      if (wrapper) return wrapper;
      const implementationOperation = Reflect.get(implementation, property);
      wrapper = (...arguments_: unknown[]) => {
        if (arguments_.length > 1) {
          throw new TypeError(
            `Dependency ${contract.name}.${operation.name} accepts one input object.`,
          );
        }
        const input = arguments_[0];
        assertRuntimeType(input, operation.input, `${contract.name}.${operation.name} input`);
        const output = Reflect.apply(
          implementationOperation as (...values: unknown[]) => unknown,
          implementation,
          arguments_,
        );
        if (operation.mode === "asynchronous") {
          if (!isPromiseLike(output)) {
            throw new TypeError(
              `Dependency ${contract.name}.${operation.name} must return a Promise.`,
            );
          }
          return Promise.resolve(output).then((value) => {
            assertRuntimeType(value, operation.output, `${contract.name}.${operation.name} output`);
            return value;
          });
        }
        if (operation.mode === "stream") {
          if (!isAsyncIterable(output)) {
            throw new TypeError(
              `Dependency ${contract.name}.${operation.name} must return an AsyncIterable.`,
            );
          }
          return conformStream(
            output,
            operation.output,
            `${contract.name}.${operation.name} output`,
          );
        }
        assertRuntimeType(output, operation.output, `${contract.name}.${operation.name} output`);
        return output;
      };
      wrappers.set(property, wrapper);
      return wrapper;
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(implementation),
    has: (_target, property) => Reflect.has(implementation, property),
    ownKeys: () => Reflect.ownKeys(implementation),
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as Readonly<Record<string | symbol, unknown>>;
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

function assertRuntimeType(value: unknown, contract: TypeIR, path: string): void {
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
    throw new TypeError(`${path} does not satisfy its semantic Dependency contract.`);
  }
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
  dependencies: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  state: Record<string, unknown>;
}>;

type RuntimeStartContext = Readonly<{
  dependencies: Readonly<Record<string, unknown>>;
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
  dependencies: Readonly<Record<string, unknown>>;
  provided: Readonly<Record<string, unknown>>;
  start(): Promise<Readonly<Record<string, unknown>>>;
  dispose(): Promise<void>;
}>;

export type Process = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  dependencies: Readonly<Record<string, unknown>>;
  ui: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  dispose(): Promise<void>;
}>;

type UIContributionOptions = Readonly<{
  dependencies?: Readonly<Record<string, unknown>>;
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
  const dependencies = options.dependencies ?? {};
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
          implementation({ dependencies, features, state: state.mutable }, ...args),
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
  provides: readonly string[];
  dependencies?: Record<string, unknown>;
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
  let starting: Promise<Readonly<Record<string, unknown>>> | undefined;
  let disposed = false;
  let provided: Readonly<Record<string, unknown>> = Object.freeze({});
  const availableDependencies = options.dependencies ?? Object.create(null);
  const dependencies = bindDependenciesToScope(availableDependencies, scope);
  const ui = hasRuntimeUI(definition)
    ? createUIContributionInstance(definition, {
        name: `${options.address.program}:${options.address.feature}`,
        dependencies,
        features: options.features,
        initialState: options.initialState,
        scope,
        onActionEvent: options.onActionEvent,
      })
    : undefined;

  const instance: ProgramContributionInstance = {
    address: options.address,
    ui,
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
        const result = definition.start?.({
          dependencies,
          ...(ui
            ? {
                actions: ui.actions,
                features: options.features ?? {},
              }
            : {}),
        });

        if (options.provides.length) {
          const dependencies = await result;
          if (!isRecord(dependencies)) {
            throw new Error(
              `${formatAddress(options.address)} must return its declared Dependency object.`,
            );
          }
          provided = Object.freeze({ ...dependencies });
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

export type ProgramAssemblyOptions = Readonly<{
  application: RuntimeApplication;
  name: string;
  dependencies: Readonly<Record<string, unknown>>;
  manifest: ProgramManifest;
  ownDependencies?: boolean;
  initialState?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  onActionEvent?: () => void;
}>;

/** One fully started Program and every Feature contribution assembled into it. */
export type ProgramAssembly = Readonly<{
  name: string;
  contributions: readonly ProgramContributionInstance[];
  dependencies: Readonly<Record<string, unknown>>;
  ui: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
    for (const dependency of declaration.requires) {
      const provider = providers.get(dependency);
      if (!provider) external.add(dependency);
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
      `Program "${name}" has a Dependency provider cycle between Features: ${cycle.join(", ")}.`,
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

/** Assembles and starts every Feature contribution to one named Program. */
export async function assembleProgram(options: ProgramAssemblyOptions): Promise<ProgramAssembly> {
  const plan = planProgram(options.application, options.name, options.manifest);
  const ui: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  const externalScope = new ResourceScope();
  const providedDependencies: Record<string, unknown> = Object.create(null);

  validateDependencyBindings(plan, options.dependencies);
  if (options.ownDependencies !== false) {
    for (const dependency of Object.values(options.dependencies)) externalScope.adopt(dependency);
  }

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
    for (const dependency of planned.manifest.requires) {
      if (Object.hasOwn(options.dependencies, dependency)) {
        registry[dependency] = scopeDependency(options.dependencies[dependency], {
          program: options.name,
          feature: path,
        });
      }
    }
    const instance = createProgramContributionInstance(planned.definition, {
      address: { program: options.name, feature: path },
      provides: planned.manifest.provides,
      dependencies: registry,
      features: children,
      initialState: options.initialState?.[path],
      onActionEvent: options.onActionEvent,
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
      for (const dependency of planned.manifest.requires) {
        if (Object.hasOwn(providedDependencies, dependency)) {
          registry[dependency] = scopeDependency(providedDependencies[dependency], {
            program: options.name,
            feature: planned.feature,
          });
        }
      }
      const provided = await instance.start();
      const actual = Object.keys(provided).sort();
      const declared = [...planned.manifest.provides].sort();
      if (actual.join("\n") !== declared.join("\n")) {
        throw new Error(
          `${formatAddress(instance.address)} provided [${actual.join(", ")}] but its contract declares ` +
            `[${declared.join(", ")}].`,
        );
      }
      Object.assign(providedDependencies, provided);
    }
  } catch (error) {
    await disposeProgram([...instances.values()], externalScope).catch(() => undefined);
    throw error;
  }

  const contributions = plan.contributions.map(({ feature }) => instances.get(feature)!);
  let disposed = false;
  return {
    name: options.name,
    contributions,
    dependencies: Object.freeze({ ...options.dependencies, ...providedDependencies }),
    ui,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await disposeProgram(contributions, externalScope);
    },
  };
}

/** Starts one live Process instance of a named Program. */
export async function startProcess<Contract extends ApplicationContract>(
  application: Application<Contract>,
  name: string,
  dependencies: Readonly<Record<string, unknown>>,
  manifest: ProgramManifest,
): Promise<Process> {
  return assembleProgram({
    application: application as RuntimeApplication,
    name,
    dependencies,
    manifest,
  });
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

export function bindDependenciesToScope(
  dependencies: Readonly<Record<string, unknown>>,
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
