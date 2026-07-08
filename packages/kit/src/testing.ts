import type { ActorOf, App, AppSpec, CommandReceipt, CommandSpec, ResourceSpec } from "./app";
import type { JsonValue } from "./protocol";
import { scopeId } from "./protocol";
import { createMemoryWorkerStore, testWorker, type TestWorkerOpts, type WorkerDef } from "./worker";

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};

type ErrorFor<Command> = Command extends { error: infer E } ? E : never;

type CommandShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [Command in keyof ResourceFor<Spec, Resource>["Commands"]]: (
    ...args: ResourceFor<Spec, Resource>["Commands"][Command] extends CommandSpec
      ? ResourceFor<Spec, Resource>["Commands"][Command]["args"]
      : ResourceFor<Spec, Resource>["Commands"][Command] extends any[]
        ? ResourceFor<Spec, Resource>["Commands"][Command]
        : []
  ) => CommandReceipt<
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
    actor: ActorOf<Spec>;
    name: keyof ResourceFor<Spec, Resource>["Events"] & string;
    payload: ResourceFor<Spec, Resource>["Events"][keyof ResourceFor<Spec, Resource>["Events"]];
  };
};

export type TestAppResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
    events(): TestAppEvent<Spec, Resource>[];
  };

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

export function testApp<Spec extends AppSpec>(
  app: App<Spec>,
  opts: TestAppOpts<Spec> = {},
): TestAppRuntime<Spec> {
  const actor = opts.actor ?? ({ id: "test" } as ActorOf<Spec>);
  const states = new Map<string, any>();
  const seqs = new Map<string, number>();
  const storedEvents: TestAppEvent<Spec>[] = [];

  return {
    resource<Resource extends ResourceName<Spec>>(
      resource: Resource,
      key: ResourceFor<Spec, Resource>["Key"],
    ) {
      return createTestAppResource(app, actor, states, seqs, storedEvents, resource, key);
    },

    events() {
      return [...storedEvents];
    },
  };
}

export { createMemoryWorkerStore, testWorker, type TestWorkerOpts, type WorkerDef };

function createTestAppResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  seqs: Map<string, number>,
  storedEvents: TestAppEvent<Spec>[],
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): TestAppResource<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const commands: Record<string, (...args: any[]) => CommandReceipt<any>> = {};

  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    commands[commandName] = (...args: any[]) =>
      runTestCommand(app, actor, states, seqs, storedEvents, resource, key, commandName, args);
  }

  return new Proxy(
    {
      events() {
        const id = scopeId(resource, key);
        return storedEvents.filter((stored) => scopeId(stored.resource, stored.key) === id) as any;
      },
      get view() {
        return readViews(app, actor, states, resource, key);
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        const command = commands[prop];
        if (command) return command;
        return readViews(app, actor, states, resource, key)[
          prop as keyof ViewShape<Spec, Resource>
        ];
      },
    },
  ) as TestAppResource<Spec, Resource>;
}

async function runTestCommand<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  actor: ActorOf<Spec>,
  states: Map<string, any>,
  seqs: Map<string, number>,
  storedEvents: TestAppEvent<Spec>[],
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: string,
  args: any[],
): CommandReceipt<any> {
  const id = scopeId(resource, key);
  const state = getState(app, states, resource, key);
  const collected: Array<{
    id: string;
    seq: number;
    at: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  }> = [];
  const commandResult: { error?: string; data?: unknown } = {};

  app.runCommand(
    resource,
    state,
    actor,
    key,
    command,
    args,
    (event) => collected.push(event),
    () => {},
    (error, data) => {
      commandResult.error = error;
      commandResult.data = data;
    },
  );

  if (commandResult.error) {
    return {
      ok: false,
      error: commandResult.error,
      data: commandResult.data,
    };
  }

  let cursor = seqs.get(id) ?? 0;
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
        actor,
        name: event.name,
        payload: event.payload,
      },
    } as TestAppEvent<Spec>;

    app.applyEvent(
      resource,
      state,
      {
        id: stored.event.id,
        seq: stored.event.seq,
        at: stored.event.at,
        actor,
        name: stored.event.name,
        payload: stored.event.payload,
      },
      stored.event.version,
    );
    storedEvents.push(stored);
  }
  seqs.set(id, cursor);

  return { ok: true, cursor };
}

function getState<Spec extends AppSpec>(
  app: App<Spec>,
  states: Map<string, any>,
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
  states: Map<string, any>,
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
): ViewShape<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const state = getState(app, states, resource, key);
  const views: Record<string, unknown> = {};

  for (const viewName of Object.keys(resourceDef.views ?? {})) {
    views[viewName] = (resourceDef.views as any)[viewName]({
      state,
      actor,
      sessions: [],
      key,
    });
  }

  return views as ViewShape<Spec, Resource>;
}
