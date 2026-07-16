import type {
  ActorOf,
  App,
  AppSpec,
  Submission,
  CommandSpec,
  EnvironmentDeps,
  EnvironmentName,
  FeatureAPIOf,
  FeatureAtPath,
  FeatureSpec,
  JsonValue,
  ResourceSpec,
  SessionData,
} from "#kernel/app";
import {
  startDependencies,
  type DependencyImplementation,
  type StartedDependencies,
} from "#kernel/dependency";
import {
  composeFeaturePrograms,
  featureResourceName,
  type FeatureProgramContribution,
  type InstantiatedFeatureAPIs,
} from "#kernel/feature";
import {
  createMemoryProgramProgressStore,
  startProgram,
  type AppProgram,
  type ProgramEventRecord,
  type ProgramRuntime,
} from "#substrate/program";
import { scopeId } from "#substrate/protocol";
import { authorizeResource } from "#substrate/resource";
import { submissionFrom } from "#substrate/submission";

export { defineApp } from "#kernel/app";

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};

type PresenceShape<Resource> = Resource extends { Presence: infer Presence }
  ? { setPresence(value: Presence): void }
  : {};

type InputFor<Command> = Command extends {
  Input: infer Input extends Record<string, unknown>;
}
  ? Input
  : never;

type ErrorFor<Command> = Command extends { Error: infer Error } ? Error : never;

type CommandShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: (
    input: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? InputFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never,
  ) => Submission<
    ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ErrorFor<ResourceFor<Spec, Resource>["Commands"][Command]>
      : never
  >;
};

export type TestAppEvent<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec> = ResourceName<Spec>,
> = {
  resource: Resource;
  key: ResourceFor<Spec, Resource>["Key"];
  event: {
    id: string;
    seq: number;
    at: number;
    version: number;
    hash?: string;
    actor: ActorOf<Spec>;
    name: keyof ResourceFor<Spec, Resource>["Events"] & string;
    payload: ResourceFor<Spec, Resource>["Events"][keyof ResourceFor<Spec, Resource>["Events"]];
  };
};

export type TestFeatureEvent<Spec extends AppSpec> = {
  readonly resource: string;
  readonly key: JsonValue;
  readonly event: {
    readonly id: string;
    readonly seq: number;
    readonly at: number;
    readonly version: number;
    readonly hash?: string;
    readonly actor: ActorOf<Spec>;
    readonly name: string;
    readonly payload: unknown;
  };
};

export type TestAppResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
    events(): TestAppEvent<Spec, Resource>[];
  } & PresenceShape<ResourceFor<Spec, Resource>>;

export type TestAppRuntime<Spec extends AppSpec> = {
  resource<Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ): TestAppResource<Spec, Resource>;
  events(): TestAppEvent<Spec>[];
};

export type TestAppOpts<Spec extends AppSpec> = {
  actor?: ActorOf<Spec>;
};

type FeatureContractAt<Spec extends AppSpec, Mount extends string> = Extract<
  FeatureAtPath<Spec, Mount>,
  FeatureSpec
>;

type FeatureResourcesAt<Spec extends AppSpec, Mount extends string> =
  FeatureContractAt<Spec, Mount> extends {
    Resources: infer Resources extends Record<string, ResourceSpec>;
  }
    ? Resources
    : {};

type FeatureResourceName<Spec extends AppSpec, Mount extends string> = Extract<
  keyof FeatureResourcesAt<Spec, Mount>,
  string
>;

type FeatureResourceFor<
  Spec extends AppSpec,
  Mount extends string,
  Resource extends FeatureResourceName<Spec, Mount>,
> = Extract<FeatureResourcesAt<Spec, Mount>[Resource], ResourceSpec>;

type TestFeatureResource<
  Spec extends AppSpec,
  Mount extends string,
  Resource extends FeatureResourceName<Spec, Mount>,
> = {
  readonly [View in keyof FeatureResourceFor<Spec, Mount, Resource>["Views"]]: FeatureResourceFor<
    Spec,
    Mount,
    Resource
  >["Views"][View];
} & {
  readonly [Command in keyof FeatureResourceFor<Spec, Mount, Resource>["Commands"]]: (
    input: FeatureResourceFor<Spec, Mount, Resource>["Commands"][Command] extends CommandSpec
      ? InputFor<FeatureResourceFor<Spec, Mount, Resource>["Commands"][Command]>
      : never,
  ) => Submission<
    FeatureResourceFor<Spec, Mount, Resource>["Commands"][Command] extends CommandSpec
      ? ErrorFor<FeatureResourceFor<Spec, Mount, Resource>["Commands"][Command]>
      : never
  >;
} & PresenceShape<FeatureResourceFor<Spec, Mount, Resource>>;

type DeclaredFeatureDependencyEnvironments<Spec extends AppSpec, Mount extends string> =
  FeatureContractAt<Spec, Mount> extends {
    Dependencies: infer Dependencies extends Record<string, Record<string, unknown>>;
  }
    ? Dependencies
    : {};

type FeatureDependencyEnvironments<
  Spec extends AppSpec,
  Mount extends string,
> = DeclaredFeatureDependencyEnvironments<Spec, Mount> &
  (FeatureContractAt<Spec, Mount> extends { Authentication: infer Authentication }
    ? {
        server: ("server" extends keyof DeclaredFeatureDependencyEnvironments<Spec, Mount>
          ? DeclaredFeatureDependencyEnvironments<Spec, Mount>["server"]
          : {}) & { readonly authentication: Authentication };
      }
    : {});

export type TestFeatureDependencyOverrides<Spec extends AppSpec, Mount extends string> = {
  readonly [Environment in keyof FeatureDependencyEnvironments<Spec, Mount>]?: {
    readonly [Name in keyof FeatureDependencyEnvironments<
      Spec,
      Mount
    >[Environment]]?: DependencyImplementation<
      FeatureDependencyEnvironments<Spec, Mount>[Environment][Name]
    >;
  };
};

export type TestFeatureOpts<Spec extends AppSpec, Mount extends string> = TestAppOpts<Spec> & {
  readonly dependencies?: TestFeatureDependencyOverrides<Spec, Mount>;
};

export type TestFeatureProgramCommandBoundary = Readonly<{
  environment: string;
  resource: string;
  key: JsonValue;
  command: string;
  args: readonly unknown[];
  commandId: string;
}>;

export type TestFeatureProgramCommandInterruption = Readonly<{
  phase: "before" | "after";
  resource?: string;
  command?: string;
  when?: (boundary: TestFeatureProgramCommandBoundary) => boolean;
}>;

export type TestFeatureRuntime<Spec extends AppSpec, Mount extends string> = {
  readonly api: Readonly<FeatureAPIOf<FeatureContractAt<Spec, Mount>>>;
  readonly resource: <Resource extends FeatureResourceName<Spec, Mount>>(
    resource: Resource,
    key: FeatureResourceFor<Spec, Mount, Resource>["Key"],
  ) => TestFeatureResource<Spec, Mount, Resource>;
  readonly observe: <Value>(
    read: (api: Readonly<FeatureAPIOf<FeatureContractAt<Spec, Mount>>>) => Value,
    observer: (value: Value) => void,
  ) => () => void;
  readonly dependencies: {
    readonly [Environment in keyof FeatureDependencyEnvironments<Spec, Mount>]: Readonly<
      FeatureDependencyEnvironments<Spec, Mount>[Environment]
    >;
  };
  readonly events: () => readonly TestFeatureEvent<Spec>[];
  readonly observeEvents: (observer: (event: TestFeatureEvent<Spec>) => void) => () => void;
  readonly interruptNextProgramCommand: (
    interruption: TestFeatureProgramCommandInterruption,
  ) => void;
  readonly drain: () => Promise<void>;
  readonly restart: () => Promise<void>;
  readonly dispose: () => Promise<void>;
};

export async function testFeature<Spec extends AppSpec, Mount extends string>(
  app: App<Spec>,
  mount: Mount,
  opts: TestFeatureOpts<Spec, Mount> = {},
): Promise<TestFeatureRuntime<Spec, Mount>> {
  type API = Readonly<FeatureAPIOf<FeatureContractAt<Spec, Mount>>>;
  const actor = opts.actor ?? ({ id: "test" } as ActorOf<Spec>);
  const states = new Map<string, unknown>();
  const sequences = new Map<string, number>();
  const sessions = new Map<string, SessionData<ActorOf<Spec>>>();
  const resources = new Map<string, unknown>();
  const storedEvents: TestFeatureEvent<Spec>[] = [];
  const eventObservers = new Set<(event: TestFeatureEvent<Spec>) => void>();
  const programEvents: ProgramEventRecord<Spec>[] = [];
  const programCommands = new Map<string, ErasedCommandOutcomePromise>();
  const programs: ProgramRuntime<Spec>[] = [];
  const programStarters: Array<() => ProgramRuntime<Spec>> = [];
  const programSynchronizers = new Map<ProgramRuntime<Spec>, () => Promise<void>>();
  const programSynchronizations = new Set<Promise<void>>();
  const resourceObservers = new Map<string, Set<() => void>>();
  const observers = new Set<{
    readonly read: (api: API) => unknown;
    readonly observer: (value: unknown) => void;
    value: unknown;
  }>();
  let api: API;
  let disposed = false;
  let position = 0;
  let programFailure: unknown;
  let commandInterruption: TestFeatureProgramCommandInterruption | undefined;
  const started: StartedDependencies<Record<string, unknown>>[] = [];
  const dependencies: Record<string, Readonly<Record<string, unknown>>> = {};
  const dependencyGroups: Record<string, Record<string, Readonly<Record<string, unknown>>>> = {};
  const definition = runtimeFeatureAt(app, mount);
  const contributions = collectFeaturePrograms(definition, mount);
  try {
    const environments = new Set([
      ...Object.keys(opts.dependencies ?? {}),
      ...contributions.map(({ environment }) => environment),
      ...Object.entries(app.def.dependencyGroups)
        .filter(([, groups]) =>
          Object.keys(groups).some((owner) => owner === mount || owner.startsWith(`${mount}.`)),
        )
        .map(([environment]) => environment),
    ]);
    for (const environment of [...environments].sort()) {
      const owners = new Set([
        ...(environment in (opts.dependencies ?? {}) ? [mount] : []),
        ...Object.keys(app.def.dependencyGroups[environment] ?? {}).filter(
          (owner) => owner === mount || owner.startsWith(`${mount}.`),
        ),
        ...contributions
          .filter((contribution) => contribution.environment === environment)
          .map(({ owner }) => owner),
      ]);
      for (const owner of [...owners].sort()) {
        const normal = app.def.dependencyGroups[environment]?.[owner] ?? {};
        const replacements =
          owner === mount
            ? ((opts.dependencies as Record<string, Record<string, unknown>> | undefined)?.[
                environment
              ] ?? {})
            : {};
        const runtime = await startDependencies({ ...normal, ...replacements });
        started.push(runtime);
        (dependencyGroups[environment] ??= {})[owner] = runtime.dependencies;
        if (owner === mount) dependencies[environment] = runtime.dependencies;
      }
    }
  } catch (error) {
    await Promise.allSettled(started.reverse().map((runtime) => runtime.stop()));
    throw error;
  }
  const notify = () => {
    if (disposed) return;
    for (const subscription of observers) {
      const value = subscription.read(api);
      if (Object.is(value, subscription.value)) continue;
      subscription.value = value;
      subscription.observer(value);
    }
  };
  const notifyResource = (resource: string, key: JsonValue): void => {
    for (const observer of resourceObservers.get(scopeId(resource, key)) ?? []) observer();
  };
  const publish = (stored: TestFeatureEvent<Spec>): Promise<void> => {
    for (const observer of eventObservers) observer(stored);
    position += 1;
    const event: ProgramEventRecord<Spec> = {
      resource: stored.resource,
      key: stored.key,
      event: { ...stored.event, position, index: 0 },
    } as ProgramEventRecord<Spec>;
    programEvents.push(event);
    for (const program of programs) void programSynchronizers.get(program)?.();
    return Promise.resolve();
  };
  const interruptCommand = (
    phase: TestFeatureProgramCommandInterruption["phase"],
    boundary: TestFeatureProgramCommandBoundary,
  ): void => {
    const interruption = commandInterruption;
    if (
      interruption?.phase !== phase ||
      (interruption.resource !== undefined && interruption.resource !== boundary.resource) ||
      (interruption.command !== undefined && interruption.command !== boundary.command) ||
      (interruption.when !== undefined && !interruption.when(boundary))
    ) {
      return;
    }
    commandInterruption = undefined;
    throw new Error(
      `Interrupted ${boundary.resource}.${boundary.command} ${phase} the command decision.`,
    );
  };
  const apis = app.createAPIs({
    actor,
    resolveResource(path, name) {
      const resource = path ? featureResourceName(path, name) : name;
      const cacheKey = `${resource}\u0000${path}`;
      let handle = resources.get(cacheKey);
      if (!handle) {
        handle = createSemanticTestResource(
          app,
          actor,
          states,
          sequences,
          storedEvents,
          sessions,
          resource,
          notify,
          notifyResource,
          resourceObservers,
          publish,
        );
        resources.set(cacheKey, handle);
      }
      return handle;
    },
  });
  let current: InstantiatedFeatureAPIs = apis;
  for (const segment of mount.split(".")) {
    const child = current.features[segment];
    if (!child) throw new Error(`Feature ${mount} is not mounted.`);
    current = child;
  }
  api = current.api as API;

  for (const environmentName of new Set(contributions.map(({ environment }) => environment))) {
    const environment = environmentName as EnvironmentName<Spec>;
    const composed = composeFeaturePrograms(
      undefined,
      contributions.filter((contribution) => contribution.environment === environment),
    );
    const program = composed[environment] as AppProgram<Spec, typeof environment> | undefined;
    if (!program) continue;
    const progress = createMemoryProgramProgressStore();
    programStarters.push(() => {
      let runtime!: ProgramRuntime<Spec>;
      let synchronizationTail = Promise.resolve();
      let deliveredPosition: number | undefined;
      const synchronize = (rewind = false): Promise<void> => {
        const task = (synchronizationTail = synchronizationTail.then(async () => {
          const from = await runtime.sourcePosition();
          if (deliveredPosition === undefined || (rewind && from < deliveredPosition)) {
            deliveredPosition = from;
          }
          for (const event of programEvents) {
            if (event.event.position <= deliveredPosition) continue;
            await runtime.enqueue(event);
            await runtime.advanceSource(event.event.position);
            deliveredPosition = event.event.position;
          }
        }));
        programSynchronizations.add(task);
        const settled = () => programSynchronizations.delete(task);
        void task.then(settled, (error) => {
          settled();
          if (programSynchronizers.get(runtime) === synchronize) programFailure = error;
        });
        return task;
      };
      runtime = startProgram(app, program, {
        env: environment,
        deps: (dependencyGroups[environment] ?? {}) as EnvironmentDeps<Spec, typeof environment>,
        actor,
        programId: `test:${mount}:${environment}`,
        progress,
        onConsumersChanged() {
          void synchronize(true);
        },
        readViews(resource, key, programActor) {
          return readViews(app, programActor ?? actor, states, sessions, resource, key, "program");
        },
        async command(resource, key, command, args, commandId, commandActor, at) {
          const existing = programCommands.get(commandId);
          if (existing) return existing;
          const boundary = {
            environment,
            resource,
            key,
            command,
            args,
            commandId,
          } satisfies TestFeatureProgramCommandBoundary;
          interruptCommand("before", boundary);
          const receipt = executeSemanticTestCommand(
            app,
            commandActor ?? actor,
            states,
            sequences,
            storedEvents,
            resource,
            key,
            command,
            args,
            notify,
            notifyResource,
            publish,
            { id: commandId, at: at ?? Date.now(), origin: "program" },
          );
          programCommands.set(commandId, receipt);
          const settled = await receipt;
          interruptCommand("after", boundary);
          return settled;
        },
        setPresence(resource, key, value, programActor = actor) {
          setTestPresence(
            app,
            programActor,
            states,
            sessions,
            resource,
            key,
            value,
            notify,
            notifyResource,
          );
        },
        onError(error) {
          programFailure = error;
        },
      });
      programSynchronizers.set(runtime, synchronize);
      return runtime;
    });
  }
  programs.push(...programStarters.map((start) => start()));

  const drain = async (): Promise<void> => {
    for (;;) {
      const before = position;
      await Promise.all(programs.map((program) => programSynchronizers.get(program)?.()));
      if (programSynchronizations.size > 0) {
        await Promise.all(programSynchronizations);
      }
      await Promise.all(programs.map((program) => program.drain()));
      if (programFailure !== undefined) throw programFailure;
      if (position === before && programSynchronizations.size === 0) return;
    }
  };

  return {
    api,
    resource(resource, key) {
      const qualified = featureResourceName(mount, resource);
      return createSemanticTestResource(
        app,
        actor,
        states,
        sequences,
        storedEvents,
        sessions,
        qualified,
        notify,
        notifyResource,
        resourceObservers,
        publish,
      )(key) as never;
    },
    dependencies: dependencies as TestFeatureRuntime<Spec, Mount>["dependencies"],
    events: () => [...storedEvents],
    observeEvents(observer) {
      if (disposed) throw new Error(`Feature ${mount} test runtime is disposed.`);
      eventObservers.add(observer);
      return () => eventObservers.delete(observer);
    },
    interruptNextProgramCommand(interruption) {
      if (disposed) throw new Error(`Feature ${mount} test runtime is disposed.`);
      if (commandInterruption !== undefined) {
        throw new Error("A Feature command interruption is already pending.");
      }
      commandInterruption = interruption;
    },
    drain,
    async restart() {
      for (const program of programs.splice(0).reverse()) {
        programSynchronizers.delete(program);
        await program.stop();
      }
      programFailure = undefined;
      programs.push(...programStarters.map((start) => start()));
      await drain();
    },
    observe(read, observer) {
      if (disposed) throw new Error(`Feature ${mount} test runtime is disposed.`);
      const subscription = {
        read: read as (api: API) => unknown,
        observer: observer as (value: unknown) => void,
        value: read(api),
      };
      observers.add(subscription);
      observer(subscription.value as ReturnType<typeof read>);
      return () => observers.delete(subscription);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      observers.clear();
      resourceObservers.clear();
      eventObservers.clear();
      for (const program of programs.reverse()) {
        programSynchronizers.delete(program);
        await program.stop();
      }
      for (const runtime of started.reverse()) await runtime.stop();
    },
  };
}

export function testApp<Spec extends AppSpec>(
  app: App<Spec>,
  opts: TestAppOpts<Spec> = {},
): TestAppRuntime<Spec> {
  const actor = opts.actor ?? ({ id: "test" } as ActorOf<Spec>);
  const states = new Map<string, unknown>();
  const seqs = new Map<string, number>();
  const sessions = new Map<string, SessionData<ActorOf<Spec>>>();
  const storedEvents: TestAppEvent<Spec>[] = [];

  return {
    resource<Resource extends ResourceName<Spec>>(
      resource: Resource,
      key: ResourceFor<Spec, Resource>["Key"],
    ) {
      return createTestAppResource(app, actor, states, seqs, storedEvents, sessions, resource, key);
    },

    events() {
      return [...storedEvents];
    },
  };
}

function createSemanticTestResource<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  sequences: Map<string, number>,
  storedEvents: TestFeatureEvent<Spec>[],
  sessions: Map<string, SessionData<ActorOf<Spec>>>,
  resource: string,
  notify: () => void,
  notifyResource: (resource: string, key: JsonValue) => void,
  resourceObservers: Map<string, Set<() => void>>,
  publish: (event: TestFeatureEvent<Spec>) => void | Promise<void>,
): (key: JsonValue) => unknown {
  return (key) => {
    const scope = scopeId(resource, key);
    if (!states.has(scope)) states.set(scope, app.createState(resource));
    const definition = app.def.resources[resource];
    if (!definition) throw new Error(`Unknown Feature resource ${resource}.`);
    const commands = Object.fromEntries(
      Object.keys(definition.commands ?? {}).map((command) => [
        command,
        (...args: unknown[]) =>
          submissionFrom<string>(
            executeSemanticTestCommand(
              app,
              actor,
              states,
              sequences,
              storedEvents,
              resource,
              key,
              command,
              args,
              notify,
              notifyResource,
              publish,
              { origin: "client" },
            ),
          ),
      ]),
    );
    const read = (): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(definition.views ?? {}).map(([name, view]) => [
          name,
          view({ state: states.get(scope), actor, sessions: scopeSessions(sessions, scope), key }),
        ]),
      );
    const target = {
      get view() {
        return read();
      },
      subscribe(observer: (view: Record<string, unknown>) => void) {
        const entries = resourceObservers.get(scope) ?? new Set();
        const run = () => observer(read());
        entries.add(run);
        resourceObservers.set(scope, entries);
        try {
          run();
        } catch (error) {
          entries.delete(run);
          if (entries.size === 0) resourceObservers.delete(scope);
          throw error;
        }
        return () => {
          entries.delete(run);
          if (entries.size === 0) resourceObservers.delete(scope);
        };
      },
    };
    return new Proxy(target, {
      get(current, property: string) {
        if (property in current) return Reflect.get(current, property);
        if (
          property === "setPresence" &&
          Object.prototype.hasOwnProperty.call(definition, "presence")
        ) {
          return (value: unknown) =>
            setTestPresence(
              app,
              actor,
              states,
              sessions,
              resource,
              key,
              value,
              notify,
              notifyResource,
            );
        }
        const command = commands[property];
        if (command) return command;
        if (!authorizeResource(app, resource, states.get(scope), actor, key, { type: "read" })) {
          throw new Error(`Read is forbidden for Resource ${scope}.`);
        }
        const view = definition.views?.[property];
        return view?.({
          state: states.get(scope),
          actor,
          sessions: scopeSessions(sessions, scope) as never,
          key,
        });
      },
    });
  };
}

type RuntimeFeatureDefinition = {
  readonly resources?: Readonly<Record<string, unknown>>;
  readonly programs?: Readonly<Record<string, unknown>>;
  readonly features?: Readonly<Record<string, RuntimeFeatureDefinition>>;
};

function runtimeFeatureAt<Spec extends AppSpec>(
  app: App<Spec>,
  mount: string,
): RuntimeFeatureDefinition {
  let definitions = (
    app.def as unknown as { readonly features?: RuntimeFeatureDefinition["features"] }
  ).features;
  let feature: RuntimeFeatureDefinition | undefined;
  for (const segment of mount.split(".")) {
    feature = definitions?.[segment];
    if (!feature) throw new Error(`Feature ${mount} is not mounted.`);
    definitions = feature.features;
  }
  return feature ?? {};
}

function collectFeaturePrograms(
  definition: RuntimeFeatureDefinition,
  owner: string,
): FeatureProgramContribution[] {
  const contributions: FeatureProgramContribution[] = [];
  for (const [environment, group] of Object.entries(definition.programs ?? {})) {
    if (!group || typeof group !== "object") continue;
    for (const [name, program] of Object.entries(group)) {
      contributions.push({
        owner,
        environment,
        name,
        resources: Object.keys(definition.resources ?? {}),
        definition: program,
      });
    }
  }
  for (const [name, child] of Object.entries(definition.features ?? {})) {
    contributions.push(...collectFeaturePrograms(child, `${owner}.${name}`));
  }
  return contributions;
}

async function executeSemanticTestCommand<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  sequences: Map<string, number>,
  storedEvents: TestFeatureEvent<Spec>[],
  resource: string,
  key: JsonValue,
  command: string,
  args: readonly unknown[],
  notify: () => void,
  notifyResource: (resource: string, key: JsonValue) => void,
  publish: (event: TestFeatureEvent<Spec>) => void | Promise<void>,
  options: {
    readonly origin: "client" | "program";
    readonly id?: string;
    readonly at?: number;
  },
): ErasedCommandOutcomePromise {
  const scope = scopeId(resource, key);
  let state = states.get(scope);
  if (state === undefined) {
    state = app.createState(resource);
    states.set(scope, state);
  }
  if (
    !authorizeResource(app, resource, state, actor, key, {
      type: "command",
      name: command,
      origin: options.origin,
    })
  ) {
    return { ok: false, error: "forbidden" };
  }
  let error: { code: string; data?: unknown } | undefined;
  const emitted: Array<{
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }> = [];
  const currentSequence = sequences.get(scope) ?? 0;
  const commandId = options.id ?? `test:${scope}:${command}:${currentSequence + 1}`;
  const commandAt = options.at ?? currentSequence + 1;
  app.runCommand(
    resource,
    state,
    actor,
    key,
    command,
    [...args],
    (event) => emitted.push(event),
    (code, data) => {
      error = { code, data };
    },
    { id: commandId, at: commandAt },
  );
  if (error) return { ok: false, error: error.code, data: error.data };

  let sequence = currentSequence;
  for (const event of emitted) {
    sequence += 1;
    app.applyEvent(resource, state as never, { ...event, seq: sequence });
    const stored: TestFeatureEvent<Spec> = {
      resource,
      key,
      event: {
        ...event,
        seq: sequence,
        version: app.def.version,
        ...(app.def.migrationHash ? { hash: app.def.migrationHash } : {}),
      },
    };
    storedEvents.push(stored);
    sequences.set(scope, sequence);
    await publish(stored);
  }
  sequences.set(scope, Math.max(sequences.get(scope) ?? 0, sequence));
  if (emitted.length > 0) {
    notifyResource(resource, key);
    notify();
  }
  return { ok: true, cursor: sequence };
}

function createTestAppResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  seqs: Map<string, number>,
  storedEvents: TestAppEvent<Spec>[],
  sessions: Map<string, SessionData<ActorOf<Spec>>>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): TestAppResource<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const commands: Record<string, (...args: unknown[]) => Submission<string>> = {};

  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    commands[commandName] = (...args: unknown[]) =>
      submissionFrom<string>(
        runTestCommand(app, actor, states, seqs, storedEvents, resource, key, commandName, args),
      );
  }

  return new Proxy(
    {
      events() {
        const id = scopeId(resource, key);
        return storedEvents.filter(
          (stored) => scopeId(stored.resource, stored.key) === id,
        ) as TestAppEvent<Spec, Resource>[];
      },
      get view() {
        return readViews(app, actor, states, sessions, resource, key);
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return Reflect.get(target, prop);
        if (
          prop === "setPresence" &&
          Object.prototype.hasOwnProperty.call(resourceDef, "presence")
        ) {
          return (value: unknown) =>
            setTestPresence(app, actor, states, sessions, resource, key, value);
        }
        const command = commands[prop];
        if (command) return command;
        return readViews(app, actor, states, sessions, resource, key)[
          prop as keyof ViewShape<Spec, Resource>
        ];
      },
    },
  ) as TestAppResource<Spec, Resource>;
}

async function runTestCommand<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  seqs: Map<string, number>,
  storedEvents: TestAppEvent<Spec>[],
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: string,
  args: unknown[],
): ErasedCommandOutcomePromise {
  const id = scopeId(resource, key);
  const state = getState(app, states, resource, key);
  if (!authorizeResource(app, resource, state, actor, key, { type: "command", name: command })) {
    return { ok: false, error: "forbidden" };
  }
  const collected: Array<{
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }> = [];
  const commandResult: { error?: string; data?: unknown } = {};
  let cursor = seqs.get(id) ?? 0;

  app.runCommand(
    resource,
    state,
    actor,
    key,
    command,
    args,
    (event) => collected.push(event),
    (error, data) => {
      commandResult.error = error;
      commandResult.data = data;
    },
    { id: `test:${id}:${command}:${cursor + 1}`, at: cursor + 1 },
  );

  if (commandResult.error) {
    return {
      ok: false,
      error: commandResult.error,
      data: commandResult.data,
    };
  }

  const hash = app.def.migrationHash;
  for (const event of collected) {
    cursor += 1;
    const stored = {
      resource,
      key,
      event: {
        id: event.id,
        seq: cursor,
        at: event.at,
        version: app.def.version,
        ...(hash ? { hash } : {}),
        actor,
        name: event.name,
        payload: event.payload,
      },
    } as TestAppEvent<Spec>;

    app.applyEvent(
      resource,
      state as never,
      {
        id: stored.event.id,
        seq: stored.event.seq,
        at: stored.event.at,
        actor,
        name: stored.event.name,
        payload: stored.event.payload,
        hash: stored.event.hash,
      },
      stored.event.version,
      stored.event.hash,
    );
    storedEvents.push(stored);
  }
  seqs.set(id, cursor);

  return { ok: true, cursor };
}

type ErasedCommandOutcomePromise = Promise<
  | { readonly ok: true; readonly cursor?: number }
  | { readonly ok: false; readonly error: string; readonly data?: unknown }
>;

function getState<Spec extends AppSpec>(
  app: App<Spec>,
  states: Map<string, unknown>,
  resource: ResourceName<Spec>,
  key: JsonValue,
) {
  const id = scopeId(resource, key);
  let state = states.get(id);
  if (!state) {
    state = app.createState(resource);
    states.set(id, state);
  }
  return state;
}

function readViews<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  sessions: Map<string, SessionData<ActorOf<Spec>>>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  origin: "client" | "program" = "client",
): ViewShape<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const state = getState(app, states, resource, key);
  if (!authorizeResource(app, resource, state, actor, key, { type: "read", origin })) {
    throw new Error(`Read is forbidden for Resource ${scopeId(resource, key)}.`);
  }
  const views: Record<string, unknown> = {};

  for (const viewName of Object.keys(resourceDef.views ?? {})) {
    const view = (
      resourceDef.views as unknown as Record<
        string,
        (input: {
          state: unknown;
          actor: ActorOf<Spec>;
          sessions: readonly unknown[];
          key: ResourceFor<Spec, Resource>["Key"];
        }) => unknown
      >
    )[viewName];
    views[viewName] = view?.({
      state,
      actor,
      sessions: scopeSessions(sessions, scopeId(resource, key)),
      key,
    });
  }

  return views as ViewShape<Spec, Resource>;
}

function scopeSessions<Actor>(
  sessions: Map<string, SessionData<Actor>>,
  scope: string,
): SessionData<Actor>[] {
  const session = sessions.get(scope);
  return session ? [session] : [];
}

function setTestPresence<Spec extends AppSpec>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, unknown>,
  sessions: Map<string, SessionData<ActorOf<Spec>>>,
  resource: string,
  key: JsonValue,
  value: unknown,
  notify: () => void = () => {},
  notifyResource: (resource: string, key: JsonValue) => void = () => {},
): void {
  const definition = app.def.resources[resource];
  if (!definition || !Object.prototype.hasOwnProperty.call(definition, "presence")) {
    throw new Error(`Resource ${resource} does not define Presence.`);
  }
  const scope = scopeId(resource, key);
  const state = getState(app, states, resource as ResourceName<Spec>, key as never);
  if (!authorizeResource(app, resource, state, actor, key, { type: "read" })) {
    throw new Error(`Presence is forbidden for Resource ${scope}.`);
  }
  sessions.set(scope, {
    id: `test:${actor.id}`,
    actor,
    presence: structuredClone(value),
  });
  notifyResource(resource, key);
  notify();
}
