# Reliability Closure Plan

## Goal

Move the infra layer from broadly tested and mostly reliable to reliable under event gaps, reconnects, storage failures, partial commits, malformed protocol messages, and recovery.

## Target Semantics

| Area                 | Contract                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Event sequencing     | Clients apply only contiguous events and never advance cursor past unapplied state.                        |
| Sync gaps            | On a gap, the client marks the scope stale/syncing and re-subscribes from the last applied cursor.         |
| Commands             | Commands carry stable IDs, are acknowledged by the server, and are deduplicated server-side.               |
| Delivery guarantee   | Transport is at-least-once; visible server effects are exactly-once per command ID.                        |
| Multi-event commands | A command commits all produced events or none.                                                             |
| Server durability    | Event batches persist before in-memory state is swapped and before broadcasts are sent.                    |
| Client persistence   | Failed snapshot/outbox persistence is retried.                                                             |
| Corrupt logs         | Recovery uses the valid prefix only and ignores everything after the first corrupt or discontinuous point. |
| Invalid protocol     | Invalid messages are rejected deterministically and never create undefined resource state.                 |

## Phase 1: Fix Current Correctness Holes

| Task                           | Implementation                                                                                                                                                              | Tests                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client synced cursor gaps      | In `client.ts`, if synced events stop at a gap, do not accept `msg.cursor`; keep cursor at the last applied event, mark stale/syncing, and send subscribe from that cursor. | Assert cursor, stale, syncing, and re-subscribe message.                                     |
| Unknown server resources       | In `server.ts`, reject/ignore subscribe and command for unknown resources before `loadScope`.                                                                               | Unknown subscribe does not send bogus snapshot; unknown command does not create scope state. |
| Presence side-effect atomicity | Buffer presence patches while running a command; apply/broadcast them only after the command completes successfully.                                                        | Command that calls `presence()` then throws should not update presence.                      |
| Weak E2E assertions            | Replace `expect(true).toBe(true)` with assertions against actual presence/session state.                                                                                    | Presence E2E asserts remote session status directly.                                         |
| Fixed sleeps                   | Replace sleeps with `poll()` wherever there is an observable condition.                                                                                                     | Async tests fail on the missing condition, not a timing guess.                               |

## Phase 2: Atomic Server Commands

| Task                             | Implementation                                                                                  | Tests                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Assign command event batch       | Collect command events, assign final server sequences, and build a committed event batch.       | Multi-event command gets contiguous server seqs.                                              |
| Apply to clone first             | Clone the current state and apply all committed events to the clone before touching live state. | Event handler throw aborts the command with no state, storage, buffer, or broadcast mutation. |
| Durable append before swap       | Append the full batch to storage, then swap state, update seq, update buffer, and broadcast.    | `appendEvents` failure leaves state/cursor unchanged.                                         |
| All-or-none multi-event commands | Do not expose event 1 if event 2 fails apply or persist.                                        | Failing multi-event command has zero visible effects.                                         |

## Phase 3: Durable Event Batch Storage

| Task                   | Implementation                                                                                              | Tests                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Define batch semantics | Treat `Store.appendEvents(key, events)` as all-or-nothing for one command batch.                            | Contract test: thrown append leaves no partial events.                                |
| FS event batches       | Store one JSONL record per batch, for example `{ "type": "events", "events": [...] }`, and flatten on read. | Corrupt tail ignores only the partial batch; corrupt middle stops after valid prefix. |
| Memory event batches   | Make existing atomic behavior explicit in the contract.                                                     | Shared storage contract covers it.                                                    |
| Recovery continuity    | Server replay requires contiguous seqs and complete batches.                                                | Snapshot plus batch log with gaps/duplicates behaves predictably.                     |

## Phase 4: Command Ack, Retry, And Dedup

| Task                  | Implementation                                                                    | Tests                                                           |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Add `commandId`       | Client command messages include stable command IDs.                               | Protocol validator requires valid command ID.                   |
| Add `commandAck`      | Server sends `{ type: "commandAck", commandId, ok, cursor? }`.                    | Client removes outbox entry only after ack.                     |
| Keep unacked commands | Client outbox retains sent-but-unacked commands across reconnect.                 | Socket closes after send before ack; reconnect resends.         |
| Server dedup          | Server records command IDs per actor/scope and ignores duplicate commands.        | Duplicate command sent twice produces one visible state change. |
| Dedup after restart   | Rebuild command ID set from persisted event batches or explicit command receipts. | Duplicate after server restart does not reapply.                |
| Persist client outbox | Include pending outbox in the client snapshot.                                    | Reloaded client with pending command eventually sends it.       |

### Command API Decision

| Option                                        | Meaning                                                                                | Recommendation              |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| Keep command methods synchronous              | Preserves API continuity, but client crash before persistence can still lose commands. | Acceptable short term.      |
| Make command methods return a promise/receipt | Allows persist-before-send and stronger client crash durability.                       | Best long-term reliability. |

Short-term recommendation: keep synchronous commands, add command IDs, acks, retries, dedup, and persisted outbox. Revisit an async command API once those guarantees are in place.

## Phase 5: Client Persistence Reliability

| Task                         | Implementation                                                                  | Tests                                                   |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Catch `loadSnapshot` failure | `connect()` proceeds with empty state when storage load throws or rejects.      | Failing client storage load still connects.             |
| Retry failed save            | Set `dirty = false` only after save succeeds. Async rejection keeps dirty true. | Failed save retries on the next interval.               |
| Handle in-flight persist     | Track `persistInFlight`; if state changes during save, schedule another save.   | Later state is not lost when save races with an update. |
| Console suppression helper   | Use `withSuppressedConsole("error", "warn", fn)` with `try`/`finally`.          | Console methods are restored even if a test throws.     |

## Phase 6: Protocol Hardening

| Task                | Implementation                                                                                  | Tests                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Strict JSON values  | Require command args to be valid JSON values.                                                   | Reject `undefined`, functions, symbols, and other invalid values.                  |
| Snapshot validation | Validate snapshot `version`, `seq`, and object shape.                                           | Reject synced message with malformed snapshot.                                     |
| Event validation    | Require integer positive seq, finite `at`, string `id`, and string `name`.                      | Reject malformed events inside `synced.events`, not only top-level event messages. |
| Session validation  | Require session object with string `id`; likely actor object with string `id`.                  | Reject malformed `session` and malformed `init.sessions`.                          |
| Non-finite keys     | Make `scopeId` throw on `NaN`, `Infinity`, and `-Infinity` instead of returning a colliding ID. | Tests assert throws for non-finite keys.                                           |

## Phase 7: Broadcast Robustness

| Task                     | Implementation                                                  | Tests                                                      |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Safe send                | Wrap each WebSocket `send` in `try/catch`.                      | One bad subscriber does not block others.                  |
| Evict failed sockets     | Remove failed sockets from `wsClients` and all subscriber sets. | Failed socket is not retried forever.                      |
| Idempotent close cleanup | Make close path safe to run after send failure cleanup.         | Closing after failed send does not double-broadcast leave. |

## Phase 8: Server Snapshot And Compaction Reliability

| Task                                   | Implementation                                                    | Tests                                                          |
| -------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Separate snapshot and compaction flags | Track snapshot persistence separately from event-tail compaction. | `compactEvents` failure retries without invalidating snapshot. |
| Partial scope save                     | Retry failed scopes without losing successful snapshots.          | Multi-scope snapshot failure recovers correctly.               |
| Compaction failure                     | `compactEvents` throw should not crash or lose state.             | Failure is logged/suppressed in tests and retried.             |

## Phase 9: Test Suite Cleanup

| Task                   | Implementation                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Remove weak assertions | Replace `expect(true).toBe(true)` with real state assertions.                                           |
| Reduce sleeps          | Use `poll()` for all async state conditions. Keep sleeps only when verifying absence, and isolate them. |
| Add console helper     | Add a shared helper for temporary console suppression with `try/finally`.                               |
| Naming pass            | Ensure tests state exact semantics rather than vague “does not crash” behavior.                         |
| Flake pass             | Run `bun test` repeatedly or add a local stress script.                                                 |

## Phase 10: Coverage And CI Gates

| Task               | Implementation                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| Coverage threshold | Add a coverage threshold script or documented manual gate.                             |
| CI workflow        | Run `bun install`, `bun run check`, and coverage.                                      |
| Suite split        | Keep `check` fast; run E2E in CI while preserving targeted local scripts.              |
| Testing docs       | Add docs for contracts, guarantees, known non-goals, and how to add reliability tests. |

## Acceptance Criteria

- `bun run check` passes.
- Coverage remains at or above current level, ideally with thresholds.
- Expected error paths produce no noisy test output.
- No accidental `.only`.
- Client never advances cursor past unapplied events.
- Multi-event command commits all events or none.
- Duplicate command delivery produces one visible state change, including after server restart.
- Failed storage append/save does not mutate state incorrectly.
- Corrupt logs recover only safe prefixes.
- Bad sockets cannot block broadcasts to healthy sockets.
- Protocol validators reject malformed snapshots, events, sessions, and invalid keys.

## Execution Order

1. Complete Phase 1 first because it fixes current correctness holes.
2. Complete Phases 2 and 3 together because atomic commands depend on durable batch semantics.
3. Complete Phase 4 next because command reliability changes protocol and client/server behavior.
4. Complete Phases 5, 6, 7, and 8 after command semantics are stable.
5. Complete Phases 9 and 10 last, once behavior and guarantees are stable.
