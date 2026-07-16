export type DependencyRuntimeContext = {
  readonly signal: AbortSignal;
  readonly data: {
    readonly path?: string;
    readonly namespace: string;
    readonly name: string;
  };
};

export type DependencyRuntimeOptions = {
  readonly data?: Partial<Omit<DependencyRuntimeContext["data"], "path">> & {
    readonly path?: string;
  };
};

export type DependencyImplementation<Value> =
  | Value
  | {
      readonly kind: "dependency";
      readonly start: (context: DependencyRuntimeContext) => Value | Promise<Value>;
      readonly stop?: (value: Value) => void | Promise<void>;
    };

export type DependencyImplementations<Dependencies> = {
  readonly [Name in keyof Dependencies]: DependencyImplementation<Dependencies[Name]>;
};

export type StartedDependencies<Dependencies> = {
  readonly dependencies: Dependencies;
  readonly signal: AbortSignal;
  readonly stop: () => Promise<void>;
};

export type DependencyGroups = Readonly<
  Record<string, Readonly<Record<string, DependencyImplementation<unknown>>>>
>;

export type StartedDependencyGroups = {
  readonly groups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly signal: AbortSignal;
  readonly stop: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type LifecycleImplementation = {
  readonly kind: "dependency";
  readonly start: (context: DependencyRuntimeContext) => unknown | Promise<unknown>;
  readonly stop?: (value: unknown) => void | Promise<void>;
};

function isLifecycleImplementation(value: unknown): value is LifecycleImplementation {
  return isRecord(value) && value.kind === "dependency" && typeof value.start === "function";
}

export async function startDependencies<Dependencies = Record<string, never>>(
  implementations: DependencyImplementations<Dependencies>,
  options: DependencyRuntimeOptions = {},
): Promise<StartedDependencies<Dependencies>> {
  const controller = new AbortController();
  const context: DependencyRuntimeContext = {
    signal: controller.signal,
    data: Object.freeze({
      path: options.data?.path,
      namespace: options.data?.namespace ?? "poggers",
      name: options.data?.name ?? "application",
    }),
  };
  const stops: Array<() => void | Promise<void>> = [];
  const started = new WeakMap<object, unknown>();
  let stopped = false;

  const resolve = async (implementation: unknown): Promise<unknown> => {
    if (!isLifecycleImplementation(implementation)) return implementation;
    if (started.has(implementation)) return started.get(implementation);

    const value = await implementation.start(context);
    started.set(implementation, value);
    if (implementation.stop) stops.push(() => implementation.stop?.(value));
    return value;
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    const errors: unknown[] = [];
    for (const dispose of stops.reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Dependency cleanup failed.");
  };

  const dependencies: Record<string, unknown> = {};
  try {
    for (const [name, implementation] of Object.entries(implementations)) {
      dependencies[name] = await resolve(implementation);
    }
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Dependency startup and cleanup failed.");
    }
    throw error;
  }

  return { dependencies: dependencies as Dependencies, signal: controller.signal, stop };
}

export async function startDependencyGroups(
  groups: DependencyGroups,
  options: DependencyRuntimeOptions = {},
): Promise<StartedDependencyGroups> {
  const flat: Record<string, DependencyImplementation<unknown>> = {};
  const locations: Array<{ readonly key: string; readonly owner: string; readonly name: string }> =
    [];

  for (const owner of Object.keys(groups).sort()) {
    const implementations = groups[owner] ?? {};
    for (const name of Object.keys(implementations).sort()) {
      const key = String(locations.length);
      flat[key] = implementations[name];
      locations.push({ key, owner, name });
    }
  }

  const started = await startDependencies(flat, options);
  const values: Record<string, Record<string, unknown>> = {};
  for (const owner of Object.keys(groups)) values[owner] = {};
  for (const { key, owner, name } of locations) values[owner]![name] = started.dependencies[key];

  return {
    groups: Object.freeze(
      Object.fromEntries(
        Object.entries(values).map(([owner, dependencies]) => [owner, Object.freeze(dependencies)]),
      ),
    ),
    signal: started.signal,
    stop: started.stop,
  };
}
