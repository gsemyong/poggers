import { cloneData } from "@/core/data";
import {
  bindEntityPrincipal,
  type DefinedEntity,
  type EntityApi,
  type EntityEvent,
  type EntityModelDefinition,
  type EntityService,
  type EventStore,
  type StoredEvent,
} from "@/features/entity";
import { createProgramContributionInstance } from "@/runtime/process";

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
      return eventStream(
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

/** Creates the specialized semantic fixture shipped with the entity factory. */
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
  const events = createMemoryEventStore<EntityEvent<Model["Value"]>>();
  let identifier = 0;
  let time = 0;
  const instance = createProgramContributionInstance(entity.server.programs.server as never, {
    address: { program: "server", feature: entity.dependency },
    provides: [entity.dependency],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `entity-${++identifier}` },
      clock: { now: () => ++time },
      http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
    },
  });
  const service = (await instance.start())[entity.dependency] as EntityService<Model>;
  return {
    api: bindEntityPrincipal(service, input.principal),
    service,
    events,
    as: (principal) => bindEntityPrincipal(service, principal),
    [Symbol.asyncDispose]: () => instance.dispose(),
  };
}

function eventStream<Event>(
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
