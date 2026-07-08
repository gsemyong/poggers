import type { ActorOf, App, AppSpec, CommandReceipt, CommandSpec, ResourceSpec } from "./app";
import { createMemoryWorkerStore, testWorker, type TestWorkerOpts, type WorkerDef } from "./worker";
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
export declare function testApp<Spec extends AppSpec>(
  app: App<Spec>,
  opts?: TestAppOpts<Spec>,
): TestAppRuntime<Spec>;
export { createMemoryWorkerStore, testWorker, type TestWorkerOpts, type WorkerDef };
