import {
  bindEntityPrincipal,
  type DefinedEntityFeature,
  type EntityApi,
  type EntityEvent,
  type EntityModelDefinition,
  type EntityService,
  type EventStore,
  type StoredEvent,
} from "@/features/entity";
import { createProgramContributionInstance } from "@/runtime/process";

export function createMemoryEventStore<Event>(): EventStore<Event> {
  const streams = new Map<string, StoredEvent<Event>[]>();
  const subscribers = new Map<string, Set<(event: StoredEvent<Event>) => void>>();
  return {
    async read({ stream, after = 0 }) {
      return (streams.get(stream) ?? []).filter((event) => event.revision > after);
    },
    async append({ stream, expectedRevision, events }) {
      const current = streams.get(stream) ?? [];
      if (current.length !== expectedRevision) return undefined;
      const appended = events.map((event, index) => ({
        stream,
        revision: expectedRevision + index + 1,
        event,
      }));
      streams.set(stream, [...current, ...appended]);
      for (const stored of appended) {
        for (const publish of subscribers.get(stream) ?? []) publish(stored);
      }
      return appended;
    },
    subscribe({ stream, after = 0 }) {
      return eventStream(
        (streams.get(stream) ?? []).filter((event) => event.revision > after),
        subscribers,
        stream,
      );
    },
  };
}

/** Creates the specialized semantic fixture shipped with the entity factory. */
export async function createEntityFixture<Model extends EntityModelDefinition>(
  feature: DefinedEntityFeature<Model>,
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
  const instance = createProgramContributionInstance(feature.programs.server as never, {
    address: { program: "server", feature: feature.dependency },
    provides: [feature.dependency],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `entity-${++identifier}` },
      clock: { now: () => ++time },
      http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
    },
  });
  const service = (await instance.start())[feature.dependency] as EntityService<Model>;
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
