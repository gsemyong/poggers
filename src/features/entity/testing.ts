import { createProgramContributionInstance } from "@/core/process";
import {
  type EntityContract,
  type EntityEvent,
  type EntityFeatureFactory,
  type EntityService,
  type EventStore,
  type Identity,
  type StoredEvent,
} from "@/features/entity/feature";

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

export function createIdentity<Credentials, Value extends Readonly<{ id: string }>>(
  identify: (credentials: Credentials) => Value | undefined,
): Identity<Credentials, Value> {
  return { authenticate: async ({ credentials }) => identify(credentials) };
}

export function createEntityFixture<Contract extends EntityContract>(
  factory: EntityFeatureFactory<Contract>,
  input: Readonly<{
    identity: Identity<Contract["Credentials"], Contract["Principal"]>;
  }>,
): AsyncDisposable &
  Readonly<{
    service: EntityService<Contract>;
    events: EventStore<EntityEvent<Contract["Entity"]>>;
  }> {
  const feature = factory();
  const events = createMemoryEventStore<EntityEvent<Contract["Entity"]>>();
  let identifier = 0;
  let time = 0;
  const instance = createProgramContributionInstance(feature.programs.server as never, {
    address: { program: "server", feature: factory.capability },
    capabilities: {
      identity: input.identity,
      events,
      identifiers: { create: () => `entity-${++identifier}` },
      clock: { now: () => ++time },
    },
  });
  const service = instance.start()[factory.capability] as EntityService<Contract>;
  return { service, events, [Symbol.asyncDispose]: () => instance.dispose() };
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
