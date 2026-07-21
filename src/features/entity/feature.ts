import type { ServerProcess } from "@/adapters/server/platform";
import type { Feature, Program } from "@/core/application";

type MaybePromise<Value> = Value | PromiseLike<Value>;

export type Entity = Readonly<{ id: string }>;
export type Principal = Readonly<{ id: string }>;

export type EntitySnapshot<Value extends Entity> = Readonly<{
  revision: number;
  entities: readonly Value[];
}>;

export type EntityEvent<Value extends Entity> =
  | Readonly<{ type: "entity.created"; entity: Value; at: number }>
  | Readonly<{ type: "entity.replaced"; entity: Value; at: number }>
  | Readonly<{ type: "entity.removed"; id: Value["id"]; at: number }>;

export type StoredEvent<Event> = Readonly<{
  stream: string;
  revision: number;
  event: Event;
}>;

/** Durable append-only persistence. Revision checks make command commits atomic. */
export type EventStore<Event> = Readonly<{
  read(input: { stream: string; after?: number }): Promise<readonly StoredEvent<Event>[]>;
  append(input: {
    stream: string;
    expectedRevision: number;
    events: readonly Event[];
  }): Promise<readonly StoredEvent<Event>[] | undefined>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent<Event>>;
}>;

export type Identity<Credentials, Value extends Principal> = Readonly<{
  authenticate(input: { credentials: Credentials }): Promise<Value | undefined>;
}>;

export type Identifiers = Readonly<{ create(): string }>;
export type Clock = Readonly<{ now(): number }>;

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

export type EntityContract = Readonly<{
  Name: string;
  Credentials: unknown;
  Principal: Principal;
  Entity: Entity;
  Create: object;
  Update: object;
  Query: object;
}>;

type CredentialsOf<Contract extends EntityContract> = Contract["Credentials"];
type PrincipalOf<Contract extends EntityContract> = Contract["Principal"];
type EntityOf<Contract extends EntityContract> = Contract["Entity"];
type CreateOf<Contract extends EntityContract> = Contract["Create"];
type UpdateOf<Contract extends EntityContract> = Contract["Update"];
type QueryOf<Contract extends EntityContract> = Contract["Query"];
type EventOf<Contract extends EntityContract> = EntityEvent<EntityOf<Contract>>;

export type EntityAuthorization<Contract extends EntityContract> =
  | Readonly<{
      operation: "read" | "create" | "remove";
      principal: PrincipalOf<Contract>;
      entity: EntityOf<Contract>;
    }>
  | Readonly<{
      operation: "update";
      principal: PrincipalOf<Contract>;
      previous: EntityOf<Contract>;
      entity: EntityOf<Contract>;
    }>;

export type EntityFeatureDefinition<Contract extends EntityContract> = Readonly<{
  name: Contract["Name"];
  create(input: {
    id: string;
    principal: PrincipalOf<Contract>;
    value: CreateOf<Contract>;
  }): MaybePromise<EntityOf<Contract>>;
  update(input: {
    principal: PrincipalOf<Contract>;
    previous: EntityOf<Contract>;
    value: UpdateOf<Contract>;
  }): MaybePromise<EntityOf<Contract>>;
  authorize(input: EntityAuthorization<Contract>): MaybePromise<boolean>;
  matches?(input: {
    principal: PrincipalOf<Contract>;
    entity: EntityOf<Contract>;
    query: QueryOf<Contract>;
  }): MaybePromise<boolean>;
}>;

export type EntityRequest<Contract extends EntityContract> = Readonly<{
  credentials: CredentialsOf<Contract>;
}>;

export type EntityService<Contract extends EntityContract> = Readonly<{
  list(
    input: EntityRequest<Contract> & Readonly<{ query?: QueryOf<Contract> }>,
  ): Promise<EntitySnapshot<EntityOf<Contract>>>;
  get(input: EntityRequest<Contract> & Readonly<{ id: string }>): Promise<EntityOf<Contract>>;
  create(
    input: EntityRequest<Contract> & Readonly<{ value: CreateOf<Contract> }>,
  ): Promise<EntityOf<Contract>>;
  update(
    input: EntityRequest<Contract> & Readonly<{ id: string; value: UpdateOf<Contract> }>,
  ): Promise<EntityOf<Contract>>;
  remove(input: EntityRequest<Contract> & Readonly<{ id: string }>): Promise<EntityOf<Contract>>;
  changes(
    input: EntityRequest<Contract> & Readonly<{ query?: QueryOf<Contract> }>,
  ): AsyncIterable<EntitySnapshot<EntityOf<Contract>>>;
}>;

export type EntityClient<Contract extends EntityContract> = Readonly<{
  list(
    input?: Readonly<{ query?: QueryOf<Contract> }>,
  ): Promise<EntitySnapshot<EntityOf<Contract>>>;
  get(input: Readonly<{ id: string }>): Promise<EntityOf<Contract>>;
  create(input: Readonly<{ value: CreateOf<Contract> }>): Promise<EntityOf<Contract>>;
  update(input: Readonly<{ id: string; value: UpdateOf<Contract> }>): Promise<EntityOf<Contract>>;
  remove(input: Readonly<{ id: string }>): Promise<EntityOf<Contract>>;
  changes(
    input?: Readonly<{ query?: QueryOf<Contract> }>,
  ): AsyncIterable<EntitySnapshot<EntityOf<Contract>>>;
}>;

type Requirements<Contract extends EntityContract> = Readonly<{
  identity: Identity<CredentialsOf<Contract>, PrincipalOf<Contract>>;
  events: EventStore<EventOf<Contract>>;
  identifiers: Identifiers;
  clock: Clock;
}>;

type Provision<Contract extends EntityContract> = Readonly<{
  [Name in Contract["Name"]]: EntityService<Contract>;
}>;

export type EntityFeature<Contract extends EntityContract> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      { Requires: Requirements<Contract>; Provides: Provision<Contract> }
    >;
  };
}>;

export type EntityFeatureFactory<Contract extends EntityContract> = (() => Feature<
  EntityFeature<Contract>
>) &
  Readonly<{ capability: Contract["Name"] }>;

/** Defines an event-sourced, authenticated entity Feature from domain behavior only. */
export function defineEntityFeature<Contract extends EntityContract>(
  definition: EntityFeatureDefinition<Contract>,
): EntityFeatureFactory<Contract> {
  const create = () =>
    ({
      programs: {
        server: {
          start({ capabilities }: { capabilities: Requirements<Contract> }) {
            return {
              [definition.name]: createEntityService(definition, capabilities),
            } as Provision<Contract>;
          },
        },
      },
    }) as Feature<EntityFeature<Contract>>;
  return Object.assign(create, { capability: definition.name });
}

/** Binds caller credentials without changing the semantic entity API. */
export function bindEntityCredentials<Contract extends EntityContract>(
  service: EntityService<Contract>,
  credentials: CredentialsOf<Contract>,
): EntityClient<Contract> {
  return Object.freeze({
    list: (input = {}) => service.list({ credentials, ...input }),
    get: (input) => service.get({ credentials, ...input }),
    create: (input) => service.create({ credentials, ...input }),
    update: (input) => service.update({ credentials, ...input }),
    remove: (input) => service.remove({ credentials, ...input }),
    changes: (input = {}) => service.changes({ credentials, ...input }),
  });
}

function createEntityService<Contract extends EntityContract>(
  definition: EntityFeatureDefinition<Contract>,
  capabilities: Requirements<Contract>,
): EntityService<Contract> {
  const authenticate = async (credentials: CredentialsOf<Contract>) => {
    const principal = await capabilities.identity.authenticate({ credentials });
    if (!principal) throw new EntityFailure("unauthenticated", "Authentication is required.");
    return principal;
  };
  const stream = (principal: PrincipalOf<Contract>) => `${definition.name}:${principal.id}`;
  const read = async (principal: PrincipalOf<Contract>) =>
    reduceEvents<EntityOf<Contract>>(
      stream(principal),
      await capabilities.events.read({ stream: stream(principal) }),
    );
  const authorize = async (input: EntityAuthorization<Contract>) => {
    if (await definition.authorize(input)) return;
    throw new EntityFailure("forbidden", `The ${input.operation} operation is not allowed.`, {
      id: input.entity.id,
      operation: input.operation,
    });
  };
  const visible = async (
    snapshot: EntitySnapshot<EntityOf<Contract>>,
    principal: PrincipalOf<Contract>,
    query?: QueryOf<Contract>,
  ) => {
    const entities: EntityOf<Contract>[] = [];
    for (const entity of snapshot.entities) {
      if (!(await definition.authorize({ operation: "read", principal, entity }))) continue;
      if (query !== undefined && definition.matches) {
        if (!(await definition.matches({ principal, entity, query }))) continue;
      }
      entities.push(entity);
    }
    return Object.freeze({ revision: snapshot.revision, entities: Object.freeze(entities) });
  };
  const commit = async (
    credentials: CredentialsOf<Contract>,
    decide: (
      snapshot: EntitySnapshot<EntityOf<Contract>>,
      principal: PrincipalOf<Contract>,
    ) => Promise<Readonly<{ event: EventOf<Contract>; result: EntityOf<Contract> }>>,
  ) => {
    const principal = await authenticate(credentials);
    const name = stream(principal);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const snapshot = await read(principal);
      const decision = await decide(snapshot, principal);
      const appended = await capabilities.events.append({
        stream: name,
        expectedRevision: snapshot.revision,
        events: [decision.event],
      });
      if (appended) return decision.result;
    }
    throw new EntityFailure("conflict", "The entity stream changed too frequently to commit.");
  };

  return Object.freeze({
    async list({ credentials, query }) {
      const principal = await authenticate(credentials);
      return visible(await read(principal), principal, query);
    },
    async get({ credentials, id }) {
      const principal = await authenticate(credentials);
      const entity = find(await read(principal), id);
      if (!entity) throw notFound(id);
      await authorize({ operation: "read", principal, entity });
      return entity;
    },
    create({ credentials, value }) {
      return commit(credentials, async (_snapshot, principal) => {
        const entity = await definition.create({
          id: capabilities.identifiers.create(),
          principal,
          value,
        });
        await authorize({ operation: "create", principal, entity });
        return {
          event: { type: "entity.created", entity, at: capabilities.clock.now() },
          result: entity,
        };
      });
    },
    update({ credentials, id, value }) {
      return commit(credentials, async (snapshot, principal) => {
        const previous = find(snapshot, id);
        if (!previous) throw notFound(id);
        const entity = await definition.update({ principal, previous, value });
        if (entity.id !== previous.id) throw new TypeError("An update cannot change an entity id.");
        await authorize({ operation: "update", principal, previous, entity });
        return {
          event: { type: "entity.replaced", entity, at: capabilities.clock.now() },
          result: entity,
        };
      });
    },
    remove({ credentials, id }) {
      return commit(credentials, async (snapshot, principal) => {
        const entity = find(snapshot, id);
        if (!entity) throw notFound(id);
        await authorize({ operation: "remove", principal, entity });
        return {
          event: { type: "entity.removed", id, at: capabilities.clock.now() },
          result: entity,
        };
      });
    },
    changes({ credentials, query }) {
      return snapshots(
        () => authenticate(credentials),
        (principal) => read(principal),
        (principal, after) => capabilities.events.subscribe({ stream: stream(principal), after }),
        (snapshot, principal) => visible(snapshot, principal, query),
      );
    },
  });
}

function reduceEvents<Value extends Entity>(
  stream: string,
  events: readonly StoredEvent<EntityEvent<Value>>[],
  initial: EntitySnapshot<Value> = { revision: 0, entities: [] },
): EntitySnapshot<Value> {
  const entities = new Map(initial.entities.map((entity) => [entity.id, entity]));
  let revision = initial.revision;
  for (const stored of events) {
    if (stored.stream !== stream || stored.revision !== revision + 1) {
      throw new Error(`Entity stream ${JSON.stringify(stream)} is not contiguous.`);
    }
    revision = stored.revision;
    const event = stored.event;
    if (event.type === "entity.removed") entities.delete(event.id);
    else entities.set(event.entity.id, event.entity);
  }
  return Object.freeze({ revision, entities: Object.freeze([...entities.values()]) });
}

function snapshots<Contract extends EntityContract>(
  authenticate: () => Promise<PrincipalOf<Contract>>,
  current: (principal: PrincipalOf<Contract>) => Promise<EntitySnapshot<EntityOf<Contract>>>,
  subscribe: (
    principal: PrincipalOf<Contract>,
    after: number,
  ) => AsyncIterable<StoredEvent<EventOf<Contract>>>,
  visible: (
    snapshot: EntitySnapshot<EntityOf<Contract>>,
    principal: PrincipalOf<Contract>,
  ) => Promise<EntitySnapshot<EntityOf<Contract>>>,
): AsyncIterable<EntitySnapshot<EntityOf<Contract>>> {
  return {
    [Symbol.asyncIterator]() {
      const principal = authenticate();
      let snapshot: EntitySnapshot<EntityOf<Contract>> | undefined;
      let source: AsyncIterator<StoredEvent<EventOf<Contract>>> | undefined;
      let active = true;
      return {
        async next() {
          const identity = await principal;
          if (!active) return { done: true as const, value: undefined };
          if (!snapshot) {
            snapshot = await current(identity);
            return { done: false as const, value: await visible(snapshot, identity) };
          }
          source ??= subscribe(identity, snapshot.revision)[Symbol.asyncIterator]();
          const next = await source.next();
          if (next.done || !active) return { done: true as const, value: undefined };
          snapshot = reduceEvents(next.value.stream, [next.value], snapshot);
          return { done: false as const, value: await visible(snapshot, identity) };
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

function find<Value extends Entity>(
  snapshot: EntitySnapshot<Value>,
  id: string,
): Value | undefined {
  return snapshot.entities.find((entity) => entity.id === id);
}

function notFound(id: string): EntityFailure {
  return new EntityFailure("not-found", "The requested entity does not exist.", { id });
}
