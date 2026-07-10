import type {
  App,
  AppNavigation,
  AppScreen,
  AppSpec,
  CommandReceipt,
  CommandSpec,
  ResourceSpec,
  SyncMeta,
} from "./app";
import { type ConnectOpts } from "./client";
type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;
type HookName<Name extends string> = `use${Capitalize<Name>}`;
type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;
type ErrorFor<Command> = Command extends {
  error: infer E;
}
  ? E
  : never;
type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  readonly [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<
    Spec,
    Resource
  >["Views"][View];
};
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
export type NativeResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly sync: SyncMeta;
  };
export type NativeUIHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
} & {
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
};
export type NativeAppApi<Spec extends AppSpec> = NativeUIHooks<Spec> & {
  readonly screen: Signal<AppScreen<Spec>>;
  readonly nav: AppNavigation<Spec>;
  useScreen(): AppScreen<Spec>;
};
export type NativeAppRuntime<Spec extends AppSpec> = {
  readonly api: NativeAppApi<Spec>;
  start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
};
export type DefineUIProps<Spec extends AppSpec> = {
  connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>);
};
export type Signal<T> = {
  (): T;
  (value: T): void;
};
export type Child = Node | string | number | boolean | null | undefined | Child[] | (() => Child);
export type Props = Record<string, unknown> & {
  children?: Child;
};
export type Component<P extends object = Record<string, never>> = (props: P) => Child;
export type HotRenderState = {
  keyed?: Record<string, unknown>;
  values?: unknown[];
  signals?: Signal<unknown>[];
  mounted?: boolean;
};
export declare function runtimeSignal<T>(initialValue: T): Signal<T>;
export declare function signal<T>(initialValue: T, hotKey?: string): Signal<T>;
export declare function computed<T>(getter: (previousValue?: T) => T): () => T;
export declare function effect(fn: () => void | (() => void)): () => void;
export declare function untrack<T>(fn: () => T): T;
export declare function onMount(fn: () => void | (() => void)): void;
export declare function defineUI<
  Spec extends AppSpec,
  Props extends object = Record<string, never>,
>(
  app: App<Spec>,
  setup: (hooks: NativeUIHooks<Spec>) => (props: Props) => Child,
): ({ connect, ...props }?: Props & DefineUIProps<Spec>) => Child;
export declare function createAppUI<
  Spec extends AppSpec,
  Props extends object = Record<string, never>,
>(app: App<Spec>): ({ connect, ..._props }?: Props & DefineUIProps<Spec>) => Child;
export declare function createNativeAppRuntime<Spec extends AppSpec>(
  app: App<Spec>,
): NativeAppRuntime<Spec>;
export declare function render(child: Child, root: Element, hotState?: HotRenderState): () => void;
export declare function jsx(type: string | Component<any>, props: Props | null): Child;
export declare const jsxs: typeof jsx;
export declare function Fragment(props: { children?: Child }): Child;
export declare function For<Items extends readonly unknown[]>(props: {
  each: Items;
  by?: (item: Items[number], index: number) => string | number;
  children: (item: Items[number], index: number) => Child;
  fallback?: Child;
}): Child;
export declare function Show(props: { when: unknown; children: Child; fallback?: Child }): Child;
export declare function reactiveValue<T>(source: () => T): T;
export declare function currentStructuralKey(): string | undefined;
export declare function createBrowserConnectOptions(): ConnectOpts | undefined;
export type {
  CSSProperties,
  CustomElementAttributes,
  HTMLAttributes,
  IntrinsicElements,
  SVGAttributes,
} from "./jsx-types";
