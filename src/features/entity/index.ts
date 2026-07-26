import { endBatch, startBatch } from "alien-signals";

import { cloneData } from "@/core/data";
import {
  createUncheckedDependencyClient,
  type Dependency,
  type DependencyImplementation,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature, type ProgramDefinition } from "@/core/feature";
import { mapStream } from "@/core/stream";
import { startFeatureFixture, type Process } from "@/execution/process";
import type {
  IdentityClient,
  IdentityModel,
  IdentityService,
  IdentitySession,
} from "@/features/identity";
import {
  type Clock,
  type EventStore,
  getHttpValue,
  type HttpRequest,
  type HttpResponse,
  type HttpServer,
  type Identifiers,
  type ServerProcess,
  type StoredEvent,
} from "@/platforms/server";
import type { BrowserMainThread, HttpClient, LocalStore, Scheduler } from "@/platforms/web";

type MaybePromise<Value> = Value | PromiseLike<Value>;

export type EntityValue = Readonly<{ id: string }>;
export type EntityPrincipal = Readonly<{ id: string }>;

export type EntityModelDefinition = Readonly<{
  Name: string;
  Principal: EntityPrincipal;
  Value: EntityValue;
  Create: object;
  Update: object;
  Filter: object;
}>;

/** Validates and preserves the semantic definition consumed by the entity factory. */
export type EntityModel<Definition extends EntityModelDefinition> = Readonly<Definition>;

type PrincipalOf<Model extends EntityModelDefinition> = Model["Principal"];
type ValueOf<Model extends EntityModelDefinition> = Model["Value"];
type CreateOf<Model extends EntityModelDefinition> = Model["Create"];
type UpdateOf<Model extends EntityModelDefinition> = Model["Update"];
type FilterOf<Model extends EntityModelDefinition> = Model["Filter"];
type EventOf<Model extends EntityModelDefinition> = EntityEvent<ValueOf<Model>>;
declare const entityModel: unique symbol;
type IdentityOf<Model extends EntityModelDefinition> = IdentityModel<{
  Name: "identity";
  Principal: PrincipalOf<Model>;
}>;

export type EntitySnapshot<Value extends EntityValue> = Readonly<{
  revision: number;
  entities: readonly Value[];
}>;

export type EntityEvent<Value extends EntityValue> =
  | Readonly<{ type: "entity.created"; entity: Value; at: number; commandId?: string }>
  | Readonly<{ type: "entity.replaced"; entity: Value; at: number; commandId?: string }>
  | Readonly<{
      type: "entity.removed";
      id: Value["id"];
      entity?: Value;
      at: number;
      commandId?: string;
    }>;

export type { Clock, EventStore, Identifiers, StoredEvent } from "@/platforms/server";

export type EntityFailureCode = "unauthenticated" | "forbidden" | "not-found" | "conflict";

export class EntityFailure extends Error {
  constructor(
    readonly code: EntityFailureCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "EntityFailure";
  }
}

export type EntityAuthorization<Model extends EntityModelDefinition> =
  | Readonly<{
      operation: "read" | "create" | "remove";
      principal: PrincipalOf<Model>;
      entity: ValueOf<Model>;
    }>
  | Readonly<{
      operation: "update";
      principal: PrincipalOf<Model>;
      previous: ValueOf<Model>;
      entity: ValueOf<Model>;
    }>;

/** Domain implementation required by a Feature using the generic entity language. */
export type EntityImplementation<Model extends EntityModelDefinition> = Readonly<{
  create(input: {
    id: string;
    principal: PrincipalOf<Model>;
    input: CreateOf<Model>;
  }): ValueOf<Model>;
  update(input: {
    principal: PrincipalOf<Model>;
    previous: ValueOf<Model>;
    input: UpdateOf<Model>;
  }): ValueOf<Model>;
  authorize(input: EntityAuthorization<Model>): MaybePromise<boolean>;
  matches?(input: {
    principal: PrincipalOf<Model>;
    entity: ValueOf<Model>;
    filter: FilterOf<Model>;
  }): boolean;
}>;

export type EntitySynchronization =
  | "signed-out"
  | "loading"
  | "synchronizing"
  | "synchronized"
  | "offline";

export type EntityMutation = Readonly<{
  id: string;
  entityId: string;
  operation: "create" | "update" | "remove";
  status: "pending" | "rejected";
  error?: string;
}>;

/** The complete browser-visible entity state: committed data with local intent replayed over it. */
export type EntityState<Model extends EntityModelDefinition> = Readonly<{
  revision: number;
  entities: readonly ValueOf<Model>[];
  mutations: readonly EntityMutation[];
  synchronization: EntitySynchronization;
}>;

/** Synchronous local-first operations exposed to UI structure. */
export type EntityActions<Model extends EntityModelDefinition> = Readonly<{
  create(input: CreateOf<Model>): ValueOf<Model>;
  update(input: { id: string; changes: UpdateOf<Model> }): ValueOf<Model>;
  remove(input: { id: string }): ValueOf<Model>;
  synchronize(): void;
  retry(input: { mutation: string }): void;
  dismiss(input: { mutation: string }): void;
}>;

/** Product-facing entity API derived entirely from one semantic model. */
export type EntityApi<Model extends EntityModelDefinition> = Dependency<{
  Operations: {
    list(filter?: FilterOf<Model>): Promise<EntitySnapshot<ValueOf<Model>>>;
    get(input: { id: string }): Promise<ValueOf<Model>>;
    create(input: CreateOf<Model>): Promise<ValueOf<Model>>;
    update(input: { id: string; changes: UpdateOf<Model> }): Promise<ValueOf<Model>>;
    remove(input: { id: string }): Promise<ValueOf<Model>>;
    changes(filter?: FilterOf<Model>): AsyncIterable<EntitySnapshot<ValueOf<Model>>>;
  };
}>;

/** Server authority used by other server Features after identity has been established. */
export type EntityService<Model extends EntityModelDefinition> = Dependency<{
  Operations: {
    list(input: {
      principal: PrincipalOf<Model>;
      filter?: FilterOf<Model>;
    }): Promise<EntitySnapshot<ValueOf<Model>>>;
    get(input: { principal: PrincipalOf<Model>; id: string }): Promise<ValueOf<Model>>;
    create(input: {
      principal: PrincipalOf<Model>;
      value: CreateOf<Model>;
      command?: Readonly<{ id: string; entityId: string }>;
    }): Promise<ValueOf<Model>>;
    update(input: {
      principal: PrincipalOf<Model>;
      id: string;
      changes: UpdateOf<Model>;
      command?: Readonly<{ id: string }>;
    }): Promise<ValueOf<Model>>;
    remove(input: {
      principal: PrincipalOf<Model>;
      id: string;
      command?: Readonly<{ id: string }>;
    }): Promise<ValueOf<Model>>;
    changes(input: {
      principal: PrincipalOf<Model>;
      filter?: FilterOf<Model>;
    }): AsyncIterable<EntitySnapshot<ValueOf<Model>>>;
  };
}>;

type Requirements<Model extends EntityModelDefinition> = Readonly<{
  identity: IdentityService<IdentityOf<Model>>;
  events: EventStore;
  identifiers: Identifiers;
  clock: Clock;
  http: HttpServer;
}>;

type RuntimeRequirements<Model extends EntityModelDefinition> = Omit<
  Requirements<Model>,
  "events"
> &
  Readonly<{ events: EventStore<EventOf<Model>> }>;

type ServerProvision<Model extends EntityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: EntityService<Model>;
}>;

type BrowserProvision<Model extends EntityModelDefinition> = Readonly<{
  [Name in Model["Name"]]: EntityApi<Model>;
}>;

type BrowserRequirements<Model extends EntityModelDefinition> = Readonly<{
  identity: IdentityClient<IdentityOf<Model>>;
  http: HttpClient;
  storage: LocalStore;
  identifiers: Identifiers;
  scheduler: Scheduler;
}>;

export type EntityServerFeature<Model extends EntityModelDefinition> = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: Requirements<Model>;
      Provides: ServerProvision<Model>;
    };
  };
}>;

export type EntityBrowserFeature<Model extends EntityModelDefinition> = Readonly<{
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: BrowserRequirements<Model>;
      Provides: BrowserProvision<Model>;
      State: EntityState<Model>;
      Actions: EntityActions<Model>;
    };
  };
}>;

export type EntityFeature<Model extends EntityModelDefinition> = Readonly<{
  Programs: EntityServerFeature<Model>["Programs"] & EntityBrowserFeature<Model>["Programs"];
}>;

export type DefinedEntity<Model extends EntityModelDefinition> = Feature<EntityFeature<Model>> &
  Readonly<{ readonly [entityModel]?: Model }>;

/** Creates one local-first entity Feature for every Program environment it supports. */
export function createEntity<const Model extends EntityModelDefinition>(
  implementation: EntityImplementation<Model>,
): DefinedEntity<Model> {
  const replicas = new WeakMap<object, EntityReplica<Model>>();
  const names = new WeakMap<object, Model["Name"]>();
  return createFeature<EntityFeature<Model>>({
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const serverPath = `/api/${name}`;
          const service = createEntityService(name, implementation, dependencies);
          const route = dependencies.http.route({
            path: serverPath,
            handle: createEntityHandler(service, dependencies.identity, serverPath),
          });
          return {
            [name]: Object.freeze({
              list: ({ input }) => service.list(input),
              get: ({ input }) => service.get(input),
              create: ({ input }) => service.create(input),
              update: ({ input }) => service.update(input),
              remove: ({ input }) => service.remove(input),
              changes: ({ input }) => service.changes(input),
              [Symbol.dispose]: () => route[Symbol.dispose](),
            } satisfies DependencyImplementation<EntityService<Model>> & Disposable),
          } as unknown as DependencyImplementations<ServerProvision<Model>>;
        },
      },
      browser: {
        state: {
          revision: 0,
          entities: [] as readonly ValueOf<Model>[],
          mutations: [] as readonly EntityMutation[],
          synchronization: "signed-out",
        },
        actions: {
          synchronize({ dependencies, state }) {
            let replica = replicas.get(dependencies);
            if (!replica) {
              const name = names.get(dependencies);
              if (!name) throw new Error("Entity browser Program has not started.");
              replica = new EntityReplica(
                name,
                implementation,
                `/api/${name}`,
                dependencies,
                state,
              );
              replicas.set(dependencies, replica);
            }
            replica.synchronize();
          },
          create({ dependencies }, input) {
            return requireReplica(replicas, dependencies).create(input);
          },
          update({ dependencies }, input) {
            return requireReplica(replicas, dependencies).update(input);
          },
          remove({ dependencies }, input) {
            return requireReplica(replicas, dependencies).remove(input);
          },
          retry({ dependencies }, { mutation }) {
            requireReplica(replicas, dependencies).retry(mutation);
          },
          dismiss({ dependencies }, { mutation }) {
            requireReplica(replicas, dependencies).dismiss(mutation);
          },
        },
        start({ dependencies, actions, provides }) {
          const name = provides[0] as Model["Name"];
          names.set(dependencies, name);
          actions.synchronize();
          const replica = requireReplica(replicas, dependencies);
          return {
            [name]: Object.freeze({
              list: ({ input }) => replica.api.list(input),
              get: ({ input }) => replica.api.get(input),
              create: ({ input }) => replica.api.create(input),
              update: ({ input }) => replica.api.update(input),
              remove: ({ input }) => replica.api.remove(input),
              changes: ({ input }) => replica.api.changes(input),
              [Symbol.asyncDispose]: () => replica.api[Symbol.asyncDispose](),
            } satisfies DependencyImplementation<EntityApi<Model>> & AsyncDisposable),
          } as unknown as DependencyImplementations<BrowserProvision<Model>>;
        },
      } as ProgramDefinition<EntityFeature<Model>, "browser", EntityFeature<Model>>,
    },
  }) as DefinedEntity<Model>;
}

/** Binds one established principal to the server authority's semantic API. */
export function bindEntityPrincipal<Model extends EntityModelDefinition>(
  service: EntityService<Model>,
  principal: PrincipalOf<Model>,
): EntityApi<Model> {
  return Object.freeze({
    list: (filter) => service.list({ principal, filter }),
    get: ({ id }) => service.get({ principal, id }),
    create: (input) => service.create({ principal, value: input }),
    update: ({ id, changes }) => service.update({ principal, id, changes }),
    remove: ({ id }) => service.remove({ principal, id }),
    changes: (filter) => service.changes({ principal, filter }),
  });
}

function createEntityHandler<Model extends EntityModelDefinition>(
  service: EntityService<Model>,
  identity: IdentityService<IdentityOf<Model>>,
  path: string,
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    try {
      const principal = await identity.authenticate({
        cookie: getHttpValue(request.headers, { name: "cookie" }),
      });
      if (!principal) throw new EntityFailure("unauthenticated", "Authentication is required.");
      const filter = parseFilter<FilterOf<Model>>(
        getHttpValue(request.query, { name: "filter" }) ?? null,
      );
      if (request.path === `${path}/changes` && request.method === "GET") {
        return entityStream(service.changes({ principal, filter }));
      }
      if (request.path === path && request.method === "GET") {
        return jsonResponse(await service.list({ principal, filter }));
      }
      if (request.path === path && request.method === "POST") {
        const commandId = getHttpValue(request.headers, { name: "x-kit-command" });
        const entityId = getHttpValue(request.headers, { name: "x-kit-entity" });
        return jsonResponse(
          await service.create({
            principal,
            value: JSON.parse(request.body) as CreateOf<Model>,
            ...(commandId !== undefined && entityId !== undefined
              ? { command: { id: commandId, entityId } }
              : {}),
          }),
          201,
        );
      }
      const prefix = `${path}/`;
      if (!request.path.startsWith(prefix)) return notFoundResponse();
      const id = request.path.slice(prefix.length);
      if (request.method === "GET") return jsonResponse(await service.get({ principal, id }));
      if (request.method === "PATCH") {
        const updateCommandId = getHttpValue(request.headers, { name: "x-kit-command" });
        return jsonResponse(
          await service.update({
            principal,
            id,
            changes: JSON.parse(request.body) as UpdateOf<Model>,
            ...(updateCommandId !== undefined ? { command: { id: updateCommandId } } : {}),
          }),
        );
      }
      if (request.method === "DELETE") {
        const removeCommandId = getHttpValue(request.headers, { name: "x-kit-command" });
        return jsonResponse(
          await service.remove({
            principal,
            id,
            ...(removeCommandId !== undefined ? { command: { id: removeCommandId } } : {}),
          }),
        );
      }
      return jsonResponse({ message: "Method not allowed." }, 405);
    } catch (error) {
      return entityFailureResponse(error);
    }
  };
}

type EntityCommand<Model extends EntityModelDefinition> =
  | Readonly<{
      id: string;
      entityId: string;
      operation: "create";
      input: CreateOf<Model>;
    }>
  | Readonly<{
      id: string;
      entityId: string;
      operation: "update";
      input: UpdateOf<Model>;
    }>
  | Readonly<{ id: string; entityId: string; operation: "remove" }>;

type RejectedCommand<Model extends EntityModelDefinition> = Readonly<{
  command: EntityCommand<Model>;
  error: string;
}>;

type StoredReplica<Model extends EntityModelDefinition> = Readonly<{
  version: 1;
  principalId: string;
  committed: EntitySnapshot<ValueOf<Model>>;
  pending: readonly EntityCommand<Model>[];
  rejected: readonly RejectedCommand<Model>[];
}>;

type MutableEntityState<Model extends EntityModelDefinition> = {
  -readonly [Key in keyof EntityState<Model>]: EntityState<Model>[Key];
};

type EntityRemote<Model extends EntityModelDefinition> = EntityApi<Model> &
  Readonly<{ send(command: EntityCommand<Model>): Promise<ValueOf<Model>> }>;

class EntityReplica<Model extends EntityModelDefinition> implements AsyncDisposable {
  readonly api: EntityApi<Model> & AsyncDisposable;
  readonly #implementation: EntityImplementation<Model>;
  readonly #dependencies: BrowserRequirements<Model>;
  readonly #state: MutableEntityState<Model>;
  readonly #remote: EntityRemote<Model>;
  readonly #storageKey: (principal: PrincipalOf<Model>) => string;
  readonly #listeners = new Set<(snapshot: EntitySnapshot<ValueOf<Model>>) => void>();
  #principal: PrincipalOf<Model> | undefined;
  #committed: EntitySnapshot<ValueOf<Model>> = { revision: 0, entities: [] };
  #pending: EntityCommand<Model>[] = [];
  #rejected: RejectedCommand<Model>[] = [];
  #identitySubscription: Disposable | undefined;
  #stream: AsyncIterator<EntitySnapshot<ValueOf<Model>>> | undefined;
  #streaming: Promise<void> | undefined;
  #flushing: Promise<void> | undefined;
  #retry: Disposable | undefined;
  #write: Promise<void> = Promise.resolve();
  #generation = 0;
  #retryAttempt = 0;
  #disposed = false;

  constructor(
    name: Model["Name"],
    implementation: EntityImplementation<Model>,
    path: string,
    dependencies: BrowserRequirements<Model>,
    state: MutableEntityState<Model>,
  ) {
    this.#implementation = implementation;
    this.#dependencies = dependencies;
    this.#state = state;
    this.#remote = createEntityClient(dependencies.http, path);
    this.#storageKey = (principal) => `entity:${name}:${principal.id}`;
    const api: EntityApi<Model> & AsyncDisposable = {
      list: async (filter?: FilterOf<Model>) => this.#snapshot(filter),
      get: async ({ id }: { id: string }) => {
        const entity = find(this.#snapshot(), id);
        if (!entity) throw notFound(id);
        return entity;
      },
      create: async (input: CreateOf<Model>) => this.create(input),
      update: async (input: { id: string; changes: UpdateOf<Model> }) => this.update(input),
      remove: async (input: { id: string }) => this.remove(input),
      changes: (filter?: FilterOf<Model>) => this.#changes(filter),
      [Symbol.asyncDispose]: () => this[Symbol.asyncDispose](),
    };
    this.api = Object.freeze(api);
  }

  synchronize(): void {
    if (this.#disposed) return;
    if (!this.#identitySubscription) {
      this.#identitySubscription = this.#dependencies.identity.subscribe((session) => {
        void this.#useSession(session).catch((error: unknown) => this.#goOffline(error));
      });
      void this.#dependencies.identity
        .session()
        .then((session) => this.#useSession(session))
        .catch((error: unknown) => this.#goOffline(error));
      return;
    }
    if (this.#principal) void this.#connect(this.#generation);
  }

  create(input: CreateOf<Model>): ValueOf<Model> {
    const principal = this.#requirePrincipal();
    const command: EntityCommand<Model> = {
      id: this.#dependencies.identifiers.create({}),
      entityId: this.#dependencies.identifiers.create({}),
      operation: "create",
      input,
    };
    const entity = this.#implementation.create({
      id: command.entityId,
      principal,
      input,
    });
    this.#pending.push(command);
    this.#publish();
    this.#persist();
    void this.#flush().catch((error: unknown) => this.#goOffline(error));
    return entity;
  }

  update(input: { id: string; changes: UpdateOf<Model> }): ValueOf<Model> {
    const principal = this.#requirePrincipal();
    const previous = find(this.#snapshot(), input.id);
    if (!previous) throw notFound(input.id);
    const entity = this.#implementation.update({
      principal,
      previous,
      input: input.changes,
    });
    if (entity.id !== previous.id) throw new TypeError("An update cannot change an entity id.");
    this.#pending.push({
      id: this.#dependencies.identifiers.create({}),
      entityId: input.id,
      operation: "update",
      input: input.changes,
    });
    this.#publish();
    this.#persist();
    void this.#flush().catch((error: unknown) => this.#goOffline(error));
    return entity;
  }

  remove({ id }: { id: string }): ValueOf<Model> {
    this.#requirePrincipal();
    const entity = find(this.#snapshot(), id);
    if (!entity) throw notFound(id);
    this.#pending.push({
      id: this.#dependencies.identifiers.create({}),
      entityId: id,
      operation: "remove",
    });
    this.#publish();
    this.#persist();
    void this.#flush().catch((error: unknown) => this.#goOffline(error));
    return entity;
  }

  retry(id: string): void {
    const index = this.#rejected.findIndex(({ command }) => command.id === id);
    if (index < 0) return;
    const [rejected] = this.#rejected.splice(index, 1);
    if (!rejected) return;
    this.#pending.push(rejected.command);
    this.#publish();
    this.#persist();
    void this.#flush().catch((error: unknown) => this.#goOffline(error));
  }

  dismiss(id: string): void {
    const next = this.#rejected.filter(({ command }) => command.id !== id);
    if (next.length === this.#rejected.length) return;
    this.#rejected = next;
    this.#publish();
    this.#persist();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#identitySubscription?.[Symbol.dispose]();
    this.#retry?.[Symbol.dispose]();
    await this.#stream?.return?.();
    await Promise.allSettled([this.#streaming, this.#flushing, this.#write].filter(Boolean));
    this.#listeners.clear();
  }

  async #useSession(session: IdentitySession<IdentityOf<Model>> | undefined): Promise<void> {
    if (this.#disposed) return;
    if (!session) {
      this.#generation += 1;
      this.#principal = undefined;
      this.#committed = { revision: 0, entities: [] };
      this.#pending = [];
      this.#rejected = [];
      this.#setSynchronization("signed-out");
      this.#publish();
      await this.#stopNetwork();
      return;
    }
    if (this.#principal?.id === session.user.id) {
      if (this.#state.synchronization === "loading") return;
      void this.#connect(this.#generation);
      return;
    }

    const generation = ++this.#generation;
    await this.#stopNetwork();
    this.#principal = session.user;
    this.#committed = { revision: 0, entities: [] };
    this.#pending = [];
    this.#rejected = [];
    this.#setSynchronization("loading");
    this.#publish();
    const stored = await this.#dependencies.storage.read<StoredReplica<Model>>({
      key: this.#storageKey(session.user),
    });
    if (!this.#active(generation)) return;
    if (stored?.version === 1 && stored.principalId === session.user.id) {
      this.#committed = stored.committed;
      this.#pending = [...stored.pending];
      this.#rejected = [...stored.rejected];
      this.#publish();
    }
    await this.#connect(generation);
  }

  async #connect(generation: number): Promise<void> {
    if (!this.#active(generation) || !this.#principal || this.#flushing) return;
    this.#retry?.[Symbol.dispose]();
    this.#retry = undefined;
    this.#setSynchronization("synchronizing");
    try {
      const snapshot = await this.#remote.list();
      if (!this.#active(generation)) return;
      this.#accept(snapshot);
      await this.#flush();
      if (!this.#active(generation)) return;
      this.#retryAttempt = 0;
      this.#setSynchronization("synchronized");
      this.#startStream(generation);
    } catch (error) {
      if (this.#active(generation)) this.#goOffline(error);
    }
  }

  #startStream(generation: number): void {
    if (this.#streaming || !this.#active(generation)) return;
    const iterator = this.#remote.changes()[Symbol.asyncIterator]();
    this.#stream = iterator;
    this.#streaming = (async () => {
      try {
        while (this.#active(generation)) {
          const next = await iterator.next();
          if (next.done || !this.#active(generation)) break;
          if (next.value.revision >= this.#committed.revision) this.#accept(next.value);
        }
        if (this.#active(generation)) throw new Error("The entity change stream ended.");
      } catch (error) {
        if (this.#active(generation)) this.#goOffline(error);
      } finally {
        if (this.#stream === iterator) this.#stream = undefined;
        this.#streaming = undefined;
      }
    })();
  }

  #flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    const generation = this.#generation;
    this.#flushing = (async () => {
      if (!this.#principal || !this.#pending.length) return;
      this.#setSynchronization("synchronizing");
      while (this.#pending.length && this.#active(generation)) {
        const command = this.#pending[0]!;
        try {
          await this.#remote.send(command);
          this.#pending.shift();
        } catch (error) {
          if (!(error instanceof EntityFailure)) throw error;
          this.#pending.shift();
          this.#rejected.push({ command, error: error.message });
        }
        const snapshot = await this.#remote.list();
        if (!this.#active(generation)) return;
        this.#accept(snapshot);
      }
      if (this.#active(generation)) {
        this.#retryAttempt = 0;
        this.#setSynchronization("synchronized");
      }
    })().finally(() => {
      this.#flushing = undefined;
    });
    return this.#flushing;
  }

  #accept(snapshot: EntitySnapshot<ValueOf<Model>>): void {
    if (snapshot.revision < this.#committed.revision) return;
    this.#committed = snapshot;
    this.#publish();
    this.#persist();
  }

  #goOffline(_error: unknown): void {
    if (this.#disposed || !this.#principal) return;
    this.#setSynchronization("offline");
    if (this.#retry) return;
    const delay = Math.min(5_000, 250 * 2 ** this.#retryAttempt++);
    this.#retry = this.#dependencies.scheduler.after({
      milliseconds: delay,
      run: () => {
        this.#retry = undefined;
        void this.#connect(this.#generation);
      },
    });
  }

  #publish(): void {
    const snapshot = this.#snapshot();
    const mutations: EntityMutation[] = [
      ...this.#pending.map((command) => ({
        id: command.id,
        entityId: command.entityId,
        operation: command.operation,
        status: "pending" as const,
      })),
      ...this.#rejected.map(({ command, error }) => ({
        id: command.id,
        entityId: command.entityId,
        operation: command.operation,
        status: "rejected" as const,
        error,
      })),
    ];
    startBatch();
    try {
      this.#state.revision = snapshot.revision;
      this.#state.entities = snapshot.entities;
      this.#state.mutations = Object.freeze(mutations);
    } finally {
      endBatch();
    }
    for (const receive of this.#listeners) receive(snapshot);
  }

  #snapshot(filter?: FilterOf<Model>): EntitySnapshot<ValueOf<Model>> {
    const principal = this.#principal;
    const entities = replay(
      this.#implementation,
      principal,
      this.#committed.entities,
      this.#pending,
    );
    const visible =
      filter === undefined || !this.#implementation.matches || !principal
        ? entities
        : entities.filter((entity) => this.#implementation.matches!({ principal, entity, filter }));
    return Object.freeze({
      revision: this.#committed.revision,
      entities: Object.freeze(visible),
    });
  }

  #changes(filter?: FilterOf<Model>): AsyncIterable<EntitySnapshot<ValueOf<Model>>> {
    const current = () => this.#snapshot(filter);
    return localSnapshots(current, this.#listeners);
  }

  #persist(): void {
    const principal = this.#principal;
    if (!principal) return;
    const record: StoredReplica<Model> = {
      version: 1,
      principalId: principal.id,
      committed: this.#committed,
      pending: [...this.#pending],
      rejected: [...this.#rejected],
    };
    this.#write = this.#write
      .catch(() => undefined)
      .then(() =>
        this.#dependencies.storage.write({
          key: this.#storageKey(principal),
          value: record,
        }),
      )
      .catch((error: unknown) => this.#goOffline(error));
  }

  #setSynchronization(value: EntitySynchronization): void {
    if (this.#state.synchronization === value) return;
    this.#state.synchronization = value;
  }

  #requirePrincipal(): PrincipalOf<Model> {
    if (this.#principal) return this.#principal;
    throw new EntityFailure("unauthenticated", "Authentication is required.");
  }

  #active(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }

  async #stopNetwork(): Promise<void> {
    this.#retry?.[Symbol.dispose]();
    this.#retry = undefined;
    const iterator = this.#stream;
    this.#stream = undefined;
    await iterator?.return?.();
  }
}

function requireReplica<Model extends EntityModelDefinition>(
  replicas: WeakMap<object, EntityReplica<Model>>,
  dependencies: object,
): EntityReplica<Model> {
  const replica = replicas.get(dependencies);
  if (!replica) throw new Error("The entity Feature has not started.");
  return replica;
}

function replay<Model extends EntityModelDefinition>(
  implementation: EntityImplementation<Model>,
  principal: PrincipalOf<Model> | undefined,
  committed: readonly ValueOf<Model>[],
  commands: readonly EntityCommand<Model>[],
): ValueOf<Model>[] {
  const entities = new Map(committed.map((entity) => [entity.id, entity]));
  if (!principal) return [...entities.values()];
  for (const command of commands) {
    if (command.operation === "create") {
      const entity = implementation.create({
        id: command.entityId,
        principal,
        input: command.input,
      });
      entities.set(entity.id, entity);
      continue;
    }
    if (command.operation === "remove") {
      entities.delete(command.entityId);
      continue;
    }
    const previous = entities.get(command.entityId);
    if (!previous) continue;
    const entity = implementation.update({ principal, previous, input: command.input });
    if (entity.id !== previous.id) throw new TypeError("An update cannot change an entity id.");
    entities.set(entity.id, entity);
  }
  return [...entities.values()];
}

function localSnapshots<Value extends EntityValue>(
  current: () => EntitySnapshot<Value>,
  listeners: Set<(snapshot: EntitySnapshot<Value>) => void>,
): AsyncIterable<EntitySnapshot<Value>> {
  return {
    [Symbol.asyncIterator]() {
      const queued: EntitySnapshot<Value>[] = [current()];
      let waiting: ((result: IteratorResult<EntitySnapshot<Value>>) => void) | undefined;
      let active = true;
      const receive = () => {
        const snapshot = current();
        if (waiting) {
          const resolve = waiting;
          waiting = undefined;
          resolve({ done: false, value: snapshot });
        } else queued.push(snapshot);
      };
      listeners.add(receive);
      return {
        next() {
          const value = queued.shift();
          if (value) return Promise.resolve({ done: false as const, value });
          if (!active) return Promise.resolve({ done: true as const, value: undefined });
          return new Promise<IteratorResult<EntitySnapshot<Value>>>((resolve) => {
            waiting = resolve;
          });
        },
        return() {
          active = false;
          listeners.delete(receive);
          waiting?.({ done: true, value: undefined });
          waiting = undefined;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
}

function createEntityClient<Model extends EntityModelDefinition>(
  http: HttpClient,
  path: string,
): EntityRemote<Model> {
  return Object.freeze({
    list: (filter) => entityRequest(http, `${path}${filterQuery(filter)}`),
    get: ({ id }) => entityRequest(http, `${path}/${encodeURIComponent(id)}`),
    create: (input) => entityRequest(http, path, { method: "POST", body: JSON.stringify(input) }),
    update: ({ id, changes }) =>
      entityRequest(http, `${path}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }),
    remove: ({ id }) =>
      entityRequest(http, `${path}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    changes: (filter) => entityChanges(http, `${path}/changes${filterQuery(filter)}`),
    send(command) {
      const headers = {
        "x-kit-command": command.id,
        ...(command.operation === "create" ? { "x-kit-entity": command.entityId } : {}),
      };
      if (command.operation === "create") {
        return entityRequest(http, path, {
          method: "POST",
          body: JSON.stringify(command.input),
          headers,
        });
      }
      if (command.operation === "update") {
        return entityRequest(http, `${path}/${encodeURIComponent(command.entityId)}`, {
          method: "PATCH",
          body: JSON.stringify(command.input),
          headers,
        });
      }
      return entityRequest(http, `${path}/${encodeURIComponent(command.entityId)}`, {
        method: "DELETE",
        headers,
      });
    },
  });
}

function createEntityService<Model extends EntityModelDefinition>(
  name: Model["Name"],
  implementation: EntityImplementation<Model>,
  requirements: Requirements<Model>,
): EntityService<Model> {
  const dependencies = requirements as RuntimeRequirements<Model>;
  const stream = (principal: PrincipalOf<Model>) => `${name}:${principal.id}`;
  const read = async (principal: PrincipalOf<Model>) =>
    reduceEvents<ValueOf<Model>>(
      stream(principal),
      await dependencies.events.read({ stream: stream(principal) }),
      { revision: 0, entities: [] },
    );
  const authorize = async (input: EntityAuthorization<Model>) => {
    if (await implementation.authorize(input)) return;
    throw new EntityFailure("forbidden", `The ${input.operation} operation is not allowed.`, {
      id: input.entity.id,
      operation: input.operation,
    });
  };
  const visible = async (
    snapshot: EntitySnapshot<ValueOf<Model>>,
    principal: PrincipalOf<Model>,
    filter?: FilterOf<Model>,
  ) => {
    const entities: ValueOf<Model>[] = [];
    for (const entity of snapshot.entities) {
      if (await implementation.authorize({ operation: "read", principal, entity })) {
        if (
          filter === undefined ||
          !implementation.matches ||
          (await implementation.matches({ principal, entity, filter }))
        ) {
          entities.push(entity);
        }
      }
    }
    return Object.freeze({ revision: snapshot.revision, entities: Object.freeze(entities) });
  };
  const commit = async (
    principal: PrincipalOf<Model>,
    commandId: string | undefined,
    decide: (
      snapshot: EntitySnapshot<ValueOf<Model>>,
    ) => Promise<Readonly<{ event: EventOf<Model>; result: ValueOf<Model> }>>,
  ) => {
    const name = stream(principal);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const history = await dependencies.events.read({ stream: name });
      if (commandId) {
        const committed = history.find(({ event }) => event.commandId === commandId)?.event;
        if (committed) {
          const entity = committed.entity;
          if (entity !== undefined) return entity;
        }
      }
      const snapshot = reduceEvents<ValueOf<Model>>(name, history, {
        revision: 0,
        entities: [],
      });
      const decision = await decide(snapshot);
      const appended = await dependencies.events.append({
        stream: name,
        expectedRevision: snapshot.revision,
        events: [decision.event],
      });
      if (appended) return decision.result;
    }
    throw new EntityFailure("conflict", "The entity stream changed too frequently to commit.");
  };

  return Object.freeze({
    async list({ principal, filter }) {
      return visible(await read(principal), principal, filter);
    },
    async get({ principal, id }) {
      const entity = find(await read(principal), id);
      if (!entity) throw notFound(id);
      await authorize({ operation: "read", principal, entity });
      return entity;
    },
    create({ principal, value, command }) {
      return commit(principal, command?.id, async () => {
        const entity = implementation.create({
          id: command?.entityId ?? dependencies.identifiers.create({}),
          principal,
          input: value,
        });
        await authorize({ operation: "create", principal, entity });
        return {
          event: {
            type: "entity.created",
            entity,
            at: dependencies.clock.now({}),
            commandId: command?.id,
          },
          result: entity,
        };
      });
    },
    update({ principal, id, changes, command }) {
      return commit(principal, command?.id, async (snapshot) => {
        const previous = find(snapshot, id);
        if (!previous) throw notFound(id);
        const entity = implementation.update({ principal, previous, input: changes });
        if (entity.id !== previous.id) throw new TypeError("An update cannot change an entity id.");
        await authorize({ operation: "update", principal, previous, entity });
        return {
          event: {
            type: "entity.replaced",
            entity,
            at: dependencies.clock.now({}),
            commandId: command?.id,
          },
          result: entity,
        };
      });
    },
    remove({ principal, id, command }) {
      return commit(principal, command?.id, async (snapshot) => {
        const entity = find(snapshot, id);
        if (!entity) throw notFound(id);
        await authorize({ operation: "remove", principal, entity });
        return {
          event: {
            type: "entity.removed",
            id,
            entity,
            at: dependencies.clock.now({}),
            commandId: command?.id,
          },
          result: entity,
        };
      });
    },
    changes({ principal, filter }) {
      return snapshots(
        () => read(principal),
        (after) => dependencies.events.subscribe({ stream: stream(principal), after }),
        (snapshot) => visible(snapshot, principal, filter),
      );
    },
  });
}

function entityStream<Value>(source: AsyncIterable<Value>): HttpResponse {
  return {
    status: 200,
    headers: [
      { name: "cache-control", value: "no-cache, no-transform" },
      { name: "content-type", value: "application/x-ndjson" },
    ],
    body: undefined,
    stream: mapStream(source, (value) => `${JSON.stringify(value)}\n`),
  };
}

function entityChanges<Model extends EntityModelDefinition>(
  http: HttpClient,
  path: string,
): AsyncIterable<EntitySnapshot<ValueOf<Model>>> {
  return {
    [Symbol.asyncIterator]() {
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<string> | undefined;
      let buffered = "";
      let active = true;
      const initialize = (async () => {
        const response = await http.request({ path, signal: controller.signal });
        await assertEntityResponse(response);
        if (!response.body) throw new Error("The entity stream returned no body.");
        reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      })();
      return {
        async next() {
          await initialize;
          while (active) {
            const newline = buffered.indexOf("\n");
            if (newline >= 0) {
              const line = buffered.slice(0, newline);
              buffered = buffered.slice(newline + 1);
              if (line) {
                return {
                  done: false as const,
                  value: JSON.parse(line) as EntitySnapshot<ValueOf<Model>>,
                };
              }
              continue;
            }
            const next = await reader!.read();
            if (next.done) return { done: true as const, value: undefined };
            buffered += next.value;
          }
          return { done: true as const, value: undefined };
        },
        async return() {
          active = false;
          controller.abort();
          await reader?.cancel().catch(() => undefined);
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

async function entityRequest<Value>(
  http: HttpClient,
  path: string,
  init: Readonly<{
    method?: string;
    body?: string;
    headers?: Readonly<Record<string, string>>;
  }> = {},
): Promise<Value> {
  const response = await http.request({
    path,
    ...init,
    headers: {
      ...init.headers,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  await assertEntityResponse(response);
  return (await response.json()) as Value;
}

async function assertEntityResponse(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as {
    code?: EntityFailure["code"];
    message?: string;
    details?: Readonly<Record<string, unknown>>;
  };
  if (body.code) throw new EntityFailure(body.code, body.message ?? body.code, body.details);
  throw new Error(body.message ?? `Request failed with status ${response.status}.`);
}

function entityFailureResponse(error: unknown): HttpResponse {
  if (error instanceof EntityFailure) {
    const status =
      error.code === "unauthenticated"
        ? 401
        : error.code === "forbidden"
          ? 403
          : error.code === "not-found"
            ? 404
            : 409;
    return jsonResponse(
      { code: error.code, message: error.message, details: error.details },
      status,
    );
  }
  return jsonResponse(
    { message: error instanceof Error ? error.message : "Internal server error." },
    500,
  );
}

function filterQuery(value: unknown): string {
  return value === undefined ? "" : `?filter=${encodeURIComponent(JSON.stringify(value))}`;
}

function parseFilter<Value>(value: string | null): Value | undefined {
  return value === null ? undefined : (JSON.parse(value) as Value);
}

function notFoundResponse(): HttpResponse {
  return jsonResponse({ message: "Not found." }, 404);
}

function jsonResponse(value: object, status = 200): HttpResponse {
  return {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    body: JSON.stringify(value),
    stream: undefined,
  };
}

function reduceEvents<Value extends EntityValue>(
  stream: string,
  events: readonly StoredEvent<EntityEvent<Value>>[],
  initial: EntitySnapshot<Value>,
): EntitySnapshot<Value> {
  let entities: Value[] = [];
  for (const initialEntity of initial.entities) entities.push(initialEntity);
  let revision = initial.revision;
  for (const stored of events) {
    if (stored.stream !== stream || stored.revision !== revision + 1) {
      throw new Error("Entity stream is not contiguous: " + stream);
    }
    revision = stored.revision;
    const event = stored.event;
    const next: Value[] = [];
    if (event.type === "entity.removed") {
      for (const current of entities) {
        if (current.id !== event.id) next.push(current);
      }
    } else {
      let replaced = false;
      for (const existing of entities) {
        if (existing.id === event.entity.id) {
          next.push(event.entity);
          replaced = true;
        } else {
          next.push(existing);
        }
      }
      if (!replaced) next.push(event.entity);
    }
    entities = next;
  }
  return { revision, entities };
}

function snapshots<Model extends EntityModelDefinition>(
  current: () => Promise<EntitySnapshot<ValueOf<Model>>>,
  subscribe: (after: number) => AsyncIterable<StoredEvent<EventOf<Model>>>,
  visible: (snapshot: EntitySnapshot<ValueOf<Model>>) => Promise<EntitySnapshot<ValueOf<Model>>>,
): AsyncIterable<EntitySnapshot<ValueOf<Model>>> {
  return {
    [Symbol.asyncIterator]() {
      let snapshot: EntitySnapshot<ValueOf<Model>> | undefined;
      let source: AsyncIterator<StoredEvent<EventOf<Model>>> | undefined;
      let active = true;
      return {
        async next() {
          if (!active) return { done: true as const, value: undefined };
          if (!snapshot) {
            snapshot = await current();
            return { done: false as const, value: await visible(snapshot) };
          }
          source ??= subscribe(snapshot.revision)[Symbol.asyncIterator]();
          const next = await source.next();
          if (next.done || !active) return { done: true as const, value: undefined };
          snapshot = reduceEvents(next.value.stream, [next.value], snapshot);
          return { done: false as const, value: await visible(snapshot) };
        },
        async return() {
          active = false;
          await source?.return?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

function find<Value extends EntityValue>(
  snapshot: EntitySnapshot<Value>,
  id: string,
): Value | undefined {
  return snapshot.entities.find((entity) => entity.id === id);
}

function notFound(id: string): EntityFailure {
  return new EntityFailure("not-found", "The requested entity does not exist.", { id });
}

/** In-memory reference EventStore used by Feature-level semantic fixtures. */
export function createMemoryEventStore<Event>(): EventStore<Event> {
  const streams = new Map<
    string,
    {
      revision: number;
      events: StoredEvent<Event>[];
      snapshot?: { revision: number; snapshot: object };
    }
  >();
  const subscribers = new Map<string, Set<(event: StoredEvent<Event>) => void>>();
  return {
    async read({ stream, after = 0, limit = Number.MAX_SAFE_INTEGER }) {
      return (streams.get(stream)?.events ?? [])
        .filter(({ revision }) => revision > after)
        .slice(0, limit);
    },
    async append({ stream, expectedRevision, events }) {
      const current = streams.get(stream) ?? { revision: 0, events: [] };
      if (current.revision !== expectedRevision) return undefined;
      const appended = events.map((event, index) => ({
        stream,
        revision: expectedRevision + index + 1,
        event: cloneData(event, "EventStore event"),
      }));
      streams.set(stream, {
        ...current,
        revision: expectedRevision + appended.length,
        events: [...current.events, ...appended],
      });
      for (const stored of appended) {
        for (const publish of subscribers.get(stream) ?? []) publish(stored);
      }
      return appended;
    },
    subscribe({ stream, after = 0 }) {
      return memoryEventStream(
        (streams.get(stream)?.events ?? []).filter(({ revision }) => revision > after),
        subscribers,
        stream,
      );
    },
    async loadSnapshot({ stream }) {
      const stored = streams.get(stream)?.snapshot;
      return stored === undefined
        ? undefined
        : {
            stream,
            revision: stored.revision,
            snapshot: cloneData(stored.snapshot, "EventStore snapshot"),
          };
    },
    async saveSnapshot({ stream, expectedRevision, revision, snapshot }) {
      const current = streams.get(stream) ?? { revision: 0, events: [] };
      if ((current.snapshot?.revision ?? 0) !== expectedRevision || revision > current.revision) {
        return false;
      }
      streams.set(stream, {
        ...current,
        snapshot: {
          revision,
          snapshot: cloneData(snapshot, "EventStore snapshot"),
        },
      });
      return true;
    },
    async compact({ stream, through }) {
      const current = streams.get(stream);
      if (!current || through === 0) return;
      if ((current.snapshot?.revision ?? 0) < through) {
        throw new Error(`EventStore stream ${JSON.stringify(stream)} has no safe snapshot.`);
      }
      streams.set(stream, {
        ...current,
        events: current.events.filter(({ revision }) => revision > through),
      });
    },
  };
}

/** Creates the semantic fixture shipped with the Entity factory. */
export async function createEntityFixture<Model extends EntityModelDefinition>(
  entity: DefinedEntity<Model>,
  input: Readonly<{ principal: Model["Principal"] }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      api: EntityApi<Model>;
      service: EntityService<Model>;
      events: EventStore<EntityEvent<Model["Value"]>>;
      as(principal: Model["Principal"]): EntityApi<Model>;
    }>
> {
  const name = "entity" as Model["Name"];
  const events = createMemoryEventStore<EntityEvent<Model["Value"]>>();
  let identifier = 0;
  let time = 0;
  const process = await startFeatureFixture<EntityFeature<Model>>({
    feature: entity,
    program: "server",
    contributions: [
      {
        feature: "",
        requires: ["identity", "events", "identifiers", "clock", "http"],
        provides: [name],
      },
    ],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `entity-${++identifier}` },
      clock: { now: () => ++time },
      http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
    },
  });
  const implementation = process.contributions[0]?.provided[name];
  if (!implementation || typeof implementation !== "object") {
    await process.dispose();
    throw new Error("The Entity fixture did not provide its semantic API.");
  }
  const service = createUncheckedDependencyClient(implementation as never) as EntityService<Model>;
  return {
    api: bindEntityPrincipal(service, input.principal),
    service,
    events,
    as: (principal) => bindEntityPrincipal(service, principal),
    [Symbol.asyncDispose]: () => process.dispose(),
  };
}

/** Mounts Entity's server and browser Programs around a controllable in-memory transport. */
export async function createEntityBrowserFixture<Model extends EntityModelDefinition>(
  entity: DefinedEntity<Model>,
  input: Readonly<{ principal: Model["Principal"] }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      readonly api: EntityApi<Model>;
      readonly state: EntityState<Model>;
      readonly actions: EntityActions<Model>;
      events: EventStore<EntityEvent<Model["Value"]>>;
      disconnect(): void;
      reconnect(): void;
      dropNextMutationResponse(): void;
      restart(): Promise<void>;
    }>
> {
  const name = "entity" as Model["Name"];
  const events = createMemoryEventStore<EntityEvent<Model["Value"]>>();
  const storage = createEntityFixtureStore();
  let handler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
  let serverIdentifier = 0;
  let browserIdentifier = 0;
  let time = 0;
  let online = true;
  let dropNextMutationResponse = false;

  const server = await startFeatureFixture<EntityFeature<Model>>({
    feature: entity,
    program: "server",
    contributions: [
      {
        feature: "",
        requires: ["identity", "events", "identifiers", "clock", "http"],
        provides: [name],
      },
    ],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `server-entity-${++serverIdentifier}` },
      clock: { now: () => ++time },
      http: {
        route(route: { handle(request: HttpRequest): Promise<HttpResponse> }) {
          handler = route.handle;
          return { [Symbol.dispose]: () => (handler = undefined) };
        },
      },
    },
  });

  const startBrowser = () =>
    startFeatureFixture<EntityFeature<Model>>({
      feature: entity,
      program: "browser",
      contributions: [
        {
          feature: "",
          requires: ["identity", "http", "storage", "identifiers", "scheduler"],
          provides: [name],
        },
      ],
      dependencies: {
        identity: {
          session: async () => ({ user: input.principal }),
          signIn: async () => ({ user: input.principal }),
          signUp: async () => ({ user: input.principal }),
          signOut: async () => undefined,
          subscribe: () => ({ [Symbol.dispose]: () => undefined }),
        },
        http: {
          async request(request: EntityFixtureWebRequest) {
            if (!online || !handler) throw new TypeError("The Entity fixture is offline.");
            const response = await entityFixtureWebResponse(
              handler(entityFixtureHttpRequest(request)),
            );
            if (
              dropNextMutationResponse &&
              request.method !== undefined &&
              request.method !== "GET"
            ) {
              dropNextMutationResponse = false;
              throw new TypeError("The Entity fixture dropped a mutation response.");
            }
            return response;
          },
        },
        storage,
        identifiers: { create: () => `browser-entity-${++browserIdentifier}` },
        scheduler: {
          after({ milliseconds, run }: { milliseconds: number; run(): void }) {
            const timeout = setTimeout(run, milliseconds);
            return { [Symbol.dispose]: () => clearTimeout(timeout) };
          },
        },
      },
    });

  let browser: Process = await startBrowser();
  const implementation = () => {
    const provided = browser.contributions[0]?.provided[name];
    if (!provided || typeof provided !== "object") {
      throw new Error("The Entity browser fixture did not provide its semantic API.");
    }
    return createUncheckedDependencyClient(provided as never) as EntityApi<Model>;
  };
  const state = () => browser.ui["feature"] as EntityState<Model>;
  const actions = () => browser.contributions[0]!.ui!.actions as EntityActions<Model>;

  return {
    get api() {
      return implementation();
    },
    get state() {
      return state();
    },
    get actions() {
      return actions();
    },
    events,
    disconnect() {
      online = false;
    },
    reconnect() {
      online = true;
      actions().synchronize();
    },
    dropNextMutationResponse() {
      dropNextMutationResponse = true;
    },
    async restart() {
      await browser.dispose();
      browser = await startBrowser();
    },
    async [Symbol.asyncDispose]() {
      await browser.dispose();
      await server.dispose();
    },
  };
}

type EntityFixtureWebRequest = Readonly<{
  path: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal;
}>;

function createEntityFixtureStore(): LocalStore {
  const values = new Map<string, unknown>();
  return {
    async read<Value>({ key }: { key: string }): Promise<Value | undefined> {
      return structuredClone(values.get(key)) as Value | undefined;
    },
    async write<Value>({ key, value }: { key: string; value: Value }): Promise<void> {
      values.set(key, structuredClone(value));
    },
    async remove({ key }: { key: string }): Promise<void> {
      values.delete(key);
    },
  };
}

function entityFixtureHttpRequest(input: EntityFixtureWebRequest): HttpRequest {
  const url = new URL(input.path, "http://fixture.local");
  return {
    method: input.method ?? "GET",
    path: url.pathname,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    headers: Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
    body: input.body ?? "",
  };
}

async function entityFixtureWebResponse(value: Promise<HttpResponse>): Promise<Response> {
  const response = await value;
  const headers = new Headers();
  for (const { name, value } of response.headers) headers.append(name, value);
  if (response.body !== undefined) {
    return new Response(response.body, { status: response.status, headers });
  }
  const iterator = response.stream?.[Symbol.asyncIterator]();
  const body = iterator
    ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(new TextEncoder().encode(next.value));
        },
        async cancel() {
          await iterator.return?.();
        },
      })
    : undefined;
  return new Response(body, { status: response.status, headers });
}

function memoryEventStream<Event>(
  initial: readonly StoredEvent<Event>[],
  subscribers: Map<string, Set<(event: StoredEvent<Event>) => void>>,
  stream: string,
): AsyncIterable<StoredEvent<Event>> {
  return {
    [Symbol.asyncIterator]() {
      const queued = [...initial];
      let waiting: ((value: IteratorResult<StoredEvent<Event>>) => void) | undefined;
      let active = true;
      const publish = (event: StoredEvent<Event>) => {
        if (!active) return;
        if (waiting) {
          const resolve = waiting;
          waiting = undefined;
          resolve({ done: false, value: event });
        } else queued.push(event);
      };
      const listeners = subscribers.get(stream) ?? new Set();
      listeners.add(publish);
      subscribers.set(stream, listeners);
      return {
        next() {
          const event = queued.shift();
          if (event) return Promise.resolve({ done: false as const, value: event });
          if (!active) return Promise.resolve({ done: true as const, value: undefined });
          return new Promise<IteratorResult<StoredEvent<Event>>>((resolve) => (waiting = resolve));
        },
        return() {
          active = false;
          listeners.delete(publish);
          waiting?.({ done: true, value: undefined });
          waiting = undefined;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
}
