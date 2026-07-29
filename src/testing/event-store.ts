import { cloneData } from "@/core/data";
import type { EventStore, PositionedStoredEvent, StoredEvent } from "@/platforms/server";

/** In-memory reference EventStore used by semantic and provider conformance fixtures. */
export function createMemoryEventStore<Event>(): EventStore<Event> {
  const streams = new Map<
    string,
    {
      revision: number;
      events: StoredEvent<Event>[];
      snapshot?: { revision: number; snapshot: object };
    }
  >();
  const positioned: PositionedStoredEvent<Event>[] = [];
  let nextPosition = 0;
  const subscribers = new Map<string, Set<(event: StoredEvent<Event>) => void>>();
  return {
    async read({ stream, after = 0, limit = Number.MAX_SAFE_INTEGER }) {
      return (streams.get(stream)?.events ?? [])
        .filter(({ revision }) => revision > after)
        .slice(0, limit);
    },
    async scan({ after, limit = Number.MAX_SAFE_INTEGER }) {
      const cursor = after === undefined ? 0 : Number(after);
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        (after !== undefined && String(cursor) !== after)
      ) {
        throw new TypeError("Memory EventStore cursor is invalid.");
      }
      return positioned.filter((event) => Number(event.cursor) > cursor).slice(0, limit);
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
        positioned.push({ ...stored, cursor: String(++nextPosition) });
      }
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
      const retained = positioned.filter(
        (event) => event.stream !== stream || event.revision > through,
      );
      positioned.splice(0, positioned.length, ...retained);
    },
  };
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
