# Testing

## Commands

```bash
bun run typecheck
bun run lint
bun run fmt:check
bun test
bun run check
```

Focused gates:

```bash
bun test packages/kit/src/infra
bun test packages/kit/src/infra/store tests/contracts
bun test tests/integration
bun test tests/e2e
```

Generated app gate:

```bash
rm -rf .app/generated-strict
bun packages/create-poggers/src/index.js .app/generated-strict --no-install --force --kit-version file:$PWD/packages/kit
bun install --cwd .app/generated-strict
bun --cwd .app/generated-strict run typecheck
bun --cwd .app/generated-strict run build
PORT=4127 .app/generated-strict/dist/app
```

While the generated binary is running, verify:

```bash
curl -fsS http://localhost:4127/
curl -fsS http://localhost:4127/manifest.webmanifest
curl -fsS http://localhost:4127/service-worker.js
curl -fsS http://localhost:4127/client.css
```

Browser gate:

- Open the generated app in the in-app browser.
- Confirm the first screen renders with styles.
- Click the counter actions and confirm the UI updates.
- Navigate to Settings and back.
- Reload on `/settings` and confirm the SPA fallback restores the screen.
- Check the manifest and service worker routes return 200.

## Organization

| Path                           | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `packages/kit/src/infra`       | Runtime unit tests beside source        |
| `packages/kit/src/infra/store` | File, browser, LMDB, and adapter tests  |
| `tests/contracts`              | Shared store/pubsub/sequencer contracts |
| `tests/integration`            | Fake-WebSocket client/server tests      |
| `tests/e2e`                    | Real Bun.serve WebSocket tests          |
| `tests/helpers`                | Shared memory stores and test utilities |

## Main Guarantees

Protocol tests cover scope ids, runtime validators, snapshots, sessions, events, and malformed messages.

App tests cover state cloning, snapshot/restore, command context, generated ids/timestamps, migrations, and unknown resources/commands.

Client tests cover reconnect, outbox resend, local snapshot persistence, stale/gap handling, subscriptions, sessions, and command acknowledgements.

Server tests cover sync snapshots vs deltas, resource isolation, command idempotency, snapshot recovery, and event replay.

Store contracts cover snapshots, append order, sequence-bounded compaction, command ids, key isolation, corruption handling, and persistence.

Worker tests cover semantic hooks, dependency injection, missed-event replay, durable handler completion, upcasting, and checkpoint-aware compaction.

App surface tests cover embedded `defineApp` UI, typed navigation, PWA metadata, environment dependencies, and generated semantic hooks.

Dogfood app gates:

```bash
bun --cwd apps/chat run typecheck
POGGERS_FAKE_AI="Fake response" bun --cwd apps/chat run build
bun --cwd apps/site run typecheck
bun --cwd apps/site run build
```

## Failure Helpers

Use the memory helpers for isolated tests:

```ts
import {
  createFailingClientStore,
  createFailingMemoryStore,
  createMemoryClientStore,
  createMemoryStore,
} from "tests/helpers/memory-storage";
```

For store failures, prefer targeted failure modes such as `appendEvents`, `saveSnapshot`, or `compactEvents`.
