import type { App, AppSpec, JsonValue } from "#kernel/app";
import { scopeId, type CommittedEvent, type Snapshot } from "#substrate/protocol";

export function computeSync<Spec extends AppSpec>(
  resource: string,
  key: JsonValue,
  cursor: number,
  eventBuffers: Map<string, unknown[]>,
  states: Map<string, unknown>,
  instanceSeqs: Map<string, number>,
  app: App<Spec>,
  generation: string,
): { snapshot?: Snapshot; events?: unknown[]; cursor: number } {
  const id = scopeId(resource, key);
  const events = (eventBuffers.get(id) as CommittedEvent[]) ?? [];
  const currentSequence = instanceSeqs.get(id) ?? 0;
  const firstRetainedSequence = events[0]?.seq ?? 0;
  const firstAfterCursor = events.find((event) => event.seq > cursor);
  const hasGap = firstAfterCursor !== undefined && firstAfterCursor.seq > cursor + 1;
  const needsSnapshot =
    cursor === 0 ||
    cursor < firstRetainedSequence ||
    (events.length === 0 && cursor !== currentSequence) ||
    hasGap;

  if (needsSnapshot) {
    if (states.has(id)) {
      return {
        snapshot: { ...app.snapshot(states.get(id), currentSequence), generation },
        cursor: currentSequence,
      };
    }
    const state = app.createState(resource);
    states.set(id, state);
    instanceSeqs.set(id, 0);
    return {
      snapshot: { ...app.snapshot(state, 0), generation },
      cursor: 0,
    };
  }

  const delta = events.filter((event) => event.seq > cursor);
  return delta.length > 0
    ? { events: delta, cursor: delta[delta.length - 1]!.seq }
    : { cursor: currentSequence };
}

export type SyncTransportState = "connecting" | "open" | "closed";

export type SyncTransportHandlers = Readonly<{
  open(): void;
  close(): void;
  frame(data: string): void | Promise<void>;
  error(error: unknown): void;
}>;

/** Carries framed data only. Ordering, retries, cursors, and Resources belong to sync. */
export interface SyncTransport {
  readonly state: SyncTransportState;
  readonly bufferedBytes: number;
  send(frame: string): void;
  close(code?: number, reason?: string): void;
}

export type SyncTransportFactory = (
  url: string,
  handlers: SyncTransportHandlers,
  signal?: AbortSignal,
) => SyncTransport;
