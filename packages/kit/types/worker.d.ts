import type {
  ActorOf,
  App,
  AppSpec,
  CommandReceipt,
  CommandSpec,
  EnvironmentDeps,
  EnvironmentName,
  ResourceSpec,
} from "./app";
import type { JsonValue } from "./protocol";
type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;
type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;
type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
};
type ErrorFor<Command> = Command extends {
  error: infer E;
}
  ? E
  : never;
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
type HookName<Name extends string> = `use${Capitalize<Name>}`;
export type WorkerEventSelector<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = {
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly name: Event;
};
export type WorkerEvent<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = {
  readonly id: string;
  readonly seq: number;
  readonly at: number;
  readonly version: number;
  readonly actor: ActorOf<Spec>;
  readonly resource: Resource;
  readonly key: ResourceFor<Spec, Resource>["Key"];
  readonly name: Event;
  readonly payload: ResourceFor<Spec, Resource>["Events"][Event];
};
export type WorkerResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly view: ViewShape<Spec, Resource>;
    readonly events: {
      [Event in keyof ResourceFor<Spec, Resource>["Events"] & string]: WorkerEventSelector<
        Spec,
        Resource,
        Event
      >;
    };
  };
export type WorkerEventHandler<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
  Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
> = (ctx: {
  event: WorkerEvent<Spec, Resource, Event>;
  view: ViewShape<Spec, Resource>;
  resource: WorkerResource<Spec, Resource>;
}) => void | Promise<void>;
export type WorkerHandlerOptions = {
  id?: string;
};
export type WorkerOn<Spec extends AppSpec> = {
  <
    Resource extends ResourceName<Spec>,
    Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
  >(
    selector: WorkerEventSelector<Spec, Resource, Event>,
    handler: WorkerEventHandler<Spec, Resource, Event>,
  ): void;
  <
    Resource extends ResourceName<Spec>,
    Event extends keyof ResourceFor<Spec, Resource>["Events"] & string,
  >(
    selector: WorkerEventSelector<Spec, Resource, Event>,
    options: WorkerHandlerOptions,
    handler: WorkerEventHandler<Spec, Resource, Event>,
  ): void;
};
export type WorkerHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => WorkerResource<Spec, Resource>;
} & {
  on: WorkerOn<Spec>;
};
export type WorkerDef<Spec extends AppSpec, Deps> = {
  app: App<Spec>;
  setup: (hooks: WorkerHooks<Spec>, deps: Deps) => void | (() => void | Promise<void>);
};
export declare function defineWorker<Spec extends AppSpec>(
  app: App<Spec>,
): <Deps = Record<string, never>>(
  setup: (hooks: WorkerHooks<Spec>, deps: Deps) => void | (() => void | Promise<void>),
) => WorkerDef<Spec, Deps>;
export type WorkerRuntimeEvent<Spec extends AppSpec = AppSpec> = {
  resource: ResourceName<Spec>;
  key: JsonValue;
  event: {
    id: string;
    seq: number;
    at: number;
    version: number;
    actor: ActorOf<Spec>;
    name: string;
    payload: unknown;
  };
};
export type WorkerTestStore<Spec extends AppSpec = AppSpec> = {
  events: WorkerRuntimeEvent<Spec>[];
  completedHandlers: Set<string>;
  checkpoints: Map<string, number>;
};
export type WorkerDurabilityStore = {
  hasCompleted(key: string): boolean | Promise<boolean>;
  markCompleted(key: string): void | Promise<void>;
  getCheckpoint(
    workerId: string,
    scopeId?: string,
  ): number | undefined | Promise<number | undefined>;
  setCheckpoint(workerId: string, cursor: number, scopeId?: string): void | Promise<void>;
};
export declare function createMemoryWorkerDurabilityStore(): WorkerDurabilityStore;
export declare function createFSWorkerDurabilityStore(path: string): WorkerDurabilityStore;
export declare function createMemoryWorkerStore<Spec extends AppSpec>(): WorkerTestStore<Spec>;
export type TestWorkerOpts<Spec extends AppSpec, Deps> = {
  deps: Deps;
  store?: WorkerTestStore<Spec>;
  actor?: ActorOf<Spec>;
  workerId?: string;
};
export declare function testWorker<Spec extends AppSpec, Deps>(
  app: App<Spec>,
  worker: WorkerDef<Spec, Deps>,
  opts: TestWorkerOpts<Spec, Deps>,
): {
  store: WorkerTestStore<Spec>;
  resource<Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ): WorkerResource<Spec, Resource>;
  drain(): Promise<void>;
  stop(): Promise<void>;
};
export type WorkerRuntimeCommand<Spec extends AppSpec> = <Resource extends ResourceName<Spec>>(
  resource: Resource,
  key: ResourceFor<Spec, Resource>["Key"],
  command: keyof ResourceFor<Spec, Resource>["Commands"] & string,
  args: any[],
  commandId: string,
) => CommandReceipt<any>;
export type AppProgram<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = NonNullable<
  NonNullable<App<Spec>["def"]["programs"]>[Env]
>;
export type StartProgramRuntimeOpts<Spec extends AppSpec, Env extends EnvironmentName<Spec>> = {
  env: Env;
  deps: EnvironmentDeps<Spec, Env>;
  programId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
  signal?: AbortSignal;
  readViews: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ViewShape<Spec, Resource>;
  command: WorkerRuntimeCommand<Spec>;
  onError?: (error: unknown) => void;
};
export type StartWorkerRuntimeOpts<Spec extends AppSpec, Deps> = {
  deps: Deps;
  workerId?: string;
  actor?: ActorOf<Spec>;
  store?: WorkerDurabilityStore;
  readViews: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ViewShape<Spec, Resource>;
  command: WorkerRuntimeCommand<Spec>;
  onError?: (error: unknown) => void;
};
export type WorkerRuntime<Spec extends AppSpec = AppSpec> = {
  enqueue(events: WorkerRuntimeEvent<Spec> | WorkerRuntimeEvent<Spec>[]): void;
  checkpoint(scopeId: string): Promise<number | undefined>;
  drain(): Promise<void>;
  stop(): Promise<void>;
};
export declare function startWorkerRuntime<Spec extends AppSpec, Deps>(
  app: App<Spec>,
  worker: WorkerDef<Spec, Deps>,
  opts: StartWorkerRuntimeOpts<Spec, Deps>,
): WorkerRuntime<Spec>;
export declare function startProgramRuntime<
  Spec extends AppSpec,
  Env extends EnvironmentName<Spec>,
>(
  app: App<Spec>,
  program: AppProgram<Spec, Env>,
  opts: StartProgramRuntimeOpts<Spec, Env>,
): WorkerRuntime<Spec>;
export {};
