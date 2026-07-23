import { endBatch, startBatch } from "alien-signals";

import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import { mapStream } from "@/core/stream";
import type {
  IdentityClient,
  IdentityModel,
  IdentityService,
  IdentitySession,
} from "@/features/identity";
import {
  getHttpValue,
  type HttpRequest,
  type HttpResponse,
  type HttpServer,
  type ServerProcess,
} from "@/platforms/server/platform";
import type {
  BrowserMainThread,
  HttpClient,
  LocalStore,
  Scheduler,
} from "@/platforms/web/platform";

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

export type StoredEvent<Event> = Readonly<{
  stream: string;
  revision: number;
  event: Event;
}>;

/** Durable append-only persistence supplied by the selected host adapter. */
export type EventStore<Event> = Readonly<{
  read(input: { stream: string; after?: number }): Promise<readonly StoredEvent<Event>[]>;
  append(input: {
    stream: string;
    expectedRevision: number;
    events: readonly Event[];
  }): Promise<readonly StoredEvent<Event>[] | undefined>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent<Event>>;
}>;

export type Identifiers = Readonly<{ create(input: {}): string }>;
export type Clock = Readonly<{ now(input: {}): number }>;

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
  name: Model["Name"];
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
export type EntityApi<Model extends EntityModelDefinition> = Readonly<{
  list(filter?: FilterOf<Model>): Promise<EntitySnapshot<ValueOf<Model>>>;
  get(input: { id: string }): Promise<ValueOf<Model>>;
  create(input: CreateOf<Model>): Promise<ValueOf<Model>>;
  update(input: { id: string; changes: UpdateOf<Model> }): Promise<ValueOf<Model>>;
  remove(input: { id: string }): Promise<ValueOf<Model>>;
  changes(filter?: FilterOf<Model>): AsyncIterable<EntitySnapshot<ValueOf<Model>>>;
}>;

/** Server authority used by other server Features after identity has been established. */
export type EntityService<Model extends EntityModelDefinition> = Readonly<{
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
}>;

type Requirements<Model extends EntityModelDefinition> = Readonly<{
  identity: IdentityService<IdentityOf<Model>>;
  events: EventStore<EventOf<Model>>;
  identifiers: Identifiers;
  clock: Clock;
  http: HttpServer;
}>;

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
    server: Program<
      ServerProcess,
      { Requires: Requirements<Model>; Provides: ServerProvision<Model> }
    >;
  };
}>;

export type EntityBrowserFeature<Model extends EntityModelDefinition> = Readonly<{
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: BrowserRequirements<Model>;
        Provides: BrowserProvision<Model>;
        State: EntityState<Model>;
        Actions: EntityActions<Model>;
      }
    >;
  };
}>;

export type DefinedEntity<Model extends EntityModelDefinition> = Readonly<{
  dependency: Model["Name"];
  server: Feature<EntityServerFeature<Model>>;
  browser: Feature<EntityBrowserFeature<Model>>;
}>;

/** Creates independently composable server and browser entity Features from one model. */
export function createEntity<Model extends EntityModelDefinition>(
  implementation: EntityImplementation<Model>,
): DefinedEntity<Model> {
  const path = `/api/${implementation.name}`;
  const replicas = new WeakMap<object, EntityReplica<Model>>();
  const server = {
    programs: {
      server: {
        start({ dependencies }: { dependencies: Requirements<Model> }) {
          const serverPath = `/api/${implementation.name}`;
          const service = createEntityService(implementation, dependencies);
          const route = dependencies.http.route({
            path: serverPath,
            handle: createEntityHandler(service, dependencies.identity, serverPath),
          });
          return {
            [implementation.name]: Object.freeze({
              ...service,
              [Symbol.dispose]: () => route[Symbol.dispose](),
            }),
          } as unknown as ServerProvision<Model>;
        },
      },
    },
  } as Feature<EntityServerFeature<Model>>;
  const browser = {
    programs: {
      browser: {
        state: {
          revision: 0,
          entities: [],
          mutations: [],
          synchronization: "signed-out",
        },
        actions: {
          synchronize({ dependencies, state }) {
            let replica = replicas.get(dependencies);
            if (!replica) {
              replica = new EntityReplica(implementation, path, dependencies, state);
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
        start({
          dependencies,
          actions,
        }: {
          dependencies: BrowserRequirements<Model>;
          actions: EntityActions<Model>;
        }) {
          actions.synchronize();
          const replica = requireReplica(replicas, dependencies);
          return {
            [implementation.name]: replica.api,
          } as unknown as BrowserProvision<Model>;
        },
      },
    },
  } as Feature<EntityBrowserFeature<Model>>;
  return { dependency: implementation.name, server, browser };
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
        const commandId = getHttpValue(request.headers, { name: "x-poggers-command" });
        const entityId = getHttpValue(request.headers, { name: "x-poggers-entity" });
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
        const updateCommandId = getHttpValue(request.headers, { name: "x-poggers-command" });
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
        const removeCommandId = getHttpValue(request.headers, { name: "x-poggers-command" });
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
    implementation: EntityImplementation<Model>,
    path: string,
    dependencies: BrowserRequirements<Model>,
    state: MutableEntityState<Model>,
  ) {
    this.#implementation = implementation;
    this.#dependencies = dependencies;
    this.#state = state;
    this.#remote = createEntityClient(dependencies.http, path);
    this.#storageKey = (principal) => `entity:${implementation.name}:${principal.id}`;
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
        "x-poggers-command": command.id,
        ...(command.operation === "create" ? { "x-poggers-entity": command.entityId } : {}),
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
  implementation: EntityImplementation<Model>,
  dependencies: Requirements<Model>,
): EntityService<Model> {
  const stream = (principal: PrincipalOf<Model>) => `${implementation.name}:${principal.id}`;
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
