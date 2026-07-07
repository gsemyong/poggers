import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  App,
  AppSpec,
  Client,
  CommandReceipt,
  CommandSpec,
  ResourceSpec,
  SyncMeta,
} from "./app";
import { connect as connectClient, type ConnectOpts } from "./client";
import { createBrowserStore } from "./store/idb";

type ResourceName<Spec extends AppSpec> = Extract<keyof Spec["Resources"], string>;

type HookName<Name extends string> = `use${Capitalize<Name>}`;

type ResourceFor<
  Spec extends AppSpec,
  Resource extends ResourceName<Spec>,
> = Spec["Resources"][Resource] extends ResourceSpec ? Spec["Resources"][Resource] : never;

type ErrorFor<Command> = Command extends { error: infer E } ? E : never;

type ViewShape<Spec extends AppSpec, Resource extends ResourceName<Spec>> = {
  [View in keyof ResourceFor<Spec, Resource>["Views"]]: ResourceFor<Spec, Resource>["Views"][View];
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

type RawResourceHandle<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly sync: SyncMeta;
    subscribe(fn: (scope: ViewShape<Spec, Resource>) => void): () => void;
  };

export type ReactResource<Spec extends AppSpec, Resource extends ResourceName<Spec>> = ViewShape<
  Spec,
  Resource
> &
  CommandShape<Spec, Resource> & {
    readonly sync: SyncMeta;
    readonly raw: RawResourceHandle<Spec, Resource>;
  };

export type ReactClientProviderProps<Spec extends AppSpec> = {
  children: ReactNode;
  client?: Client<Spec>;
  connect?: ConnectOpts | (() => Promise<Client<Spec>>);
  fallback?: ReactNode;
};

export type SemanticResourceHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ReactResource<Spec, Resource>;
};

export type UIHooks<Spec extends AppSpec> = SemanticResourceHooks<Spec> & {
  useClient: () => Client<Spec>;
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => ReactResource<Spec, Resource>;
};

export type DefineUIProps<Spec extends AppSpec> = {
  client?: Client<Spec>;
  connect?: ConnectOpts | (() => Promise<Client<Spec>>);
  fallback?: ReactNode;
};

export function createReactClient<Spec extends AppSpec>(app: App<Spec>) {
  const ClientContext = createContext<Client<Spec> | null>(null);

  function Provider({
    children,
    client: providedClient,
    connect,
    fallback = null,
  }: ReactClientProviderProps<Spec>) {
    const [client, setClient] = useState<Client<Spec> | null>(providedClient ?? null);
    const [error, setError] = useState<unknown>(null);

    useEffect(() => {
      if (providedClient) {
        setClient(providedClient);
        return;
      }

      if (!connect) {
        setClient(null);
        return;
      }

      let alive = true;
      let ownedClient: Client<Spec> | null = null;
      const connection = typeof connect === "function" ? connect() : connectClient(app, connect);

      connection
        .then((nextClient) => {
          if (!alive) {
            nextClient.dispose();
            return;
          }
          ownedClient = nextClient;
          setClient(nextClient);
        })
        .catch((nextError) => {
          if (alive) setError(nextError);
        });

      return () => {
        alive = false;
        if (ownedClient) ownedClient.dispose();
      };
    }, [connect, providedClient]);

    if (error) throw error;
    if (!client) return <>{fallback}</>;

    return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
  }

  function useClient(): Client<Spec> {
    const client = useContext(ClientContext);
    if (!client) {
      throw new Error("useClient must be used inside this app's Provider.");
    }
    return client;
  }

  function useResource<Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ): ReactResource<Spec, Resource> {
    const client = useClient();
    const keySignature = useMemo(() => stableJson(key), [key]);
    const scope = useMemo(() => {
      const accessor = client[resource];
      if (typeof accessor !== "function") {
        throw new Error(`Unknown resource "${resource}".`);
      }
      return accessor(key) as RawResourceHandle<Spec, Resource>;
    }, [client, keySignature, resource]);

    const read = useCallback(() => readResource(app, resource, scope), [resource, scope]);
    const [snapshot, setSnapshot] = useState(() => read());

    useEffect(() => {
      setSnapshot(read());
      return scope.subscribe(() => setSnapshot(read()));
    }, [read, scope]);

    return snapshot;
  }

  return { Provider, useClient, useResource };
}

export function defineUI<Spec extends AppSpec, Props extends object = Record<string, never>>(
  app: App<Spec>,
  setup: (hooks: UIHooks<Spec>) => (props: Props) => ReactNode,
) {
  const reactClient = createReactClient(app);
  const hooks = createSemanticHooks(app, reactClient);
  const Inner = setup(hooks);
  const Provider = reactClient.Provider;

  return function DefinedUI({
    client,
    connect,
    fallback = null,
    ...props
  }: Props & DefineUIProps<Spec>) {
    const browserConnect = useMemo(() => connect ?? createBrowserConnectOptions(), [connect]);

    return (
      <Provider client={client} connect={browserConnect} fallback={fallback}>
        <Inner {...(props as Props)} />
      </Provider>
    );
  };
}

function createSemanticHooks<Spec extends AppSpec>(
  app: App<Spec>,
  reactClient: ReturnType<typeof createReactClient<Spec>>,
): UIHooks<Spec> {
  const hooks: Record<string, unknown> = {
    useClient: reactClient.useClient,
    useResource: reactClient.useResource,
  };

  for (const resource of Object.keys(app.def.resources)) {
    hooks[`use${capitalize(resource)}`] = (key: JsonValueForResource<Spec>) =>
      reactClient.useResource(resource as ResourceName<Spec>, key as any);
  }

  return hooks as UIHooks<Spec>;
}

type JsonValueForResource<Spec extends AppSpec> =
  Spec["Resources"][ResourceName<Spec>] extends ResourceSpec
    ? Spec["Resources"][ResourceName<Spec>]["Key"]
    : never;

function createBrowserConnectOptions(): ConnectOpts | undefined {
  if (typeof location === "undefined") return undefined;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const token = new URLSearchParams(location.search).get("token") ?? "local";
  return {
    wsUrl: `${protocol}://${location.host}/ws`,
    token,
    storage: createBrowserStore(),
  };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function readResource<Spec extends AppSpec, Resource extends ResourceName<Spec>>(
  app: App<Spec>,
  resource: Resource,
  scope: RawResourceHandle<Spec, Resource>,
): ReactResource<Spec, Resource> {
  const resourceDef = app.def.resources[resource];
  const snapshot: Record<string, unknown> = {
    raw: scope,
    sync: scope.sync,
  };

  for (const viewName of Object.keys(resourceDef.views ?? {})) {
    snapshot[viewName] = scope[viewName as keyof typeof scope];
  }

  for (const commandName of Object.keys(resourceDef.commands ?? {})) {
    snapshot[commandName] = scope[commandName as keyof typeof scope];
  }

  return snapshot as ReactResource<Spec, Resource>;
}

function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(null);
}
