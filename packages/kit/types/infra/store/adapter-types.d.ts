/**
 * Server adapter interfaces for pluggable storage, pub/sub, and sequencing.
 *
 * The adapter pattern decouples the server from its backing infrastructure.
 * Two implementations are expected:
 *  - Single-node (in-process EventEmitter + local counter): for dev and small deployments.
 *  - Horizontal (Redis pub/sub + INCR): for multi-process production deployments.
 *
 * The default {@link ServerAdapter} is constructed via {@link createSingleNodeAdapter}.
 */
import type { Store } from "./types";
/**
 * Cross-process publish/subscribe for event forwarding between server instances.
 *
 * In a single-node deployment, this is backed by an in-process EventEmitter.
 * In a horizontal deployment, this is backed by Redis PUB/SUB or similar.
 *
 * Messages are scoped by `scopeId` — each resource scope is an independent channel.
 * Subscribe returns an unsubscribe function; messages are delivered synchronously
 * (single-node) or asynchronously (horizontal).
 */
export interface ServerPubSub {
  /** Subscribe to messages for a scope channel. Returns unsubscribe function. */
  subscribe(scopeId: string, handler: (message: unknown) => void): () => void;
  /** Publish a message to all subscribers of a scope channel. */
  publish(scopeId: string, message: unknown): void;
}
/**
 * Globally-ordered sequence number allocator for event log entries.
 *
 * Each scope has an independent monotonic counter. The allocator must be atomic —
 * two concurrent calls for the same scope must never return the same number.
 *
 * In single-node, this is a local Map<string, number>.
 * In horizontal, this is Redis INCR per scope key.
 */
export interface ServerSequencer {
  /** Allocate the next sequence number for a scope. Must be monotonic and atomic. */
  next(scopeId: string): Promise<number> | number;
}
/**
 * Composite server adapter bundling storage, pub/sub, and sequencing.
 *
 * Implementations:
 *  - {@link createSingleNodeAdapter} — in-process, zero configuration.
 *  - Horizontal adapter (future) — Redis-backed, for multi-process scaling.
 */
export interface ServerAdapter {
  /** Persistent snapshot and event log storage. */
  storage: Store;
  /** Cross-process event forwarding. */
  pubsub: ServerPubSub;
  /** Global sequence number allocation. */
  sequencer: ServerSequencer;
}
