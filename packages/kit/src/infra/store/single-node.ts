/**
 * Single-node reference implementation of the server adapter interfaces.
 *
 * Uses Node.js EventEmitter for pub/sub and a local Map<string, number>
 * for sequence allocation. This is the default adapter — zero configuration,
 * maximum performance for single-process deployments.
 *
 * Not suitable for multi-process deployments: events are delivered only
 * to subscribers within the same process. For horizontal scaling, replace
 * with a Redis-backed adapter implementing the same interfaces.
 *
 * @see {@link createSingleNodeAdapter} for the composite factory.
 */
import { EventEmitter } from "node:events";
import type { Store } from "./types";
import type { ServerAdapter, ServerPubSub, ServerSequencer } from "./adapter-types";

export function createSingleNodePubSub(): ServerPubSub {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(Infinity);
  return {
    subscribe(scopeId, handler) {
      emitter.on(scopeId, handler);
      return () => {
        emitter.off(scopeId, handler);
      };
    },
    publish(scopeId, message) {
      emitter.emit(scopeId, message);
    },
  };
}

export function createSingleNodeSequencer(): ServerSequencer {
  const seqs = new Map<string, number>();
  return {
    next(scopeId) {
      const next = (seqs.get(scopeId) ?? 0) + 1;
      seqs.set(scopeId, next);
      return next;
    },
  };
}

export function createSingleNodeAdapter(storage: Store): ServerAdapter {
  return {
    storage,
    pubsub: createSingleNodePubSub(),
    sequencer: createSingleNodeSequencer(),
  };
}
