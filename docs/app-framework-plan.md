# App Framework API Surface Plan

## Goal

Turn the current event-sourced TypeScript framework into a small full-stack framework for applications.

The app-author mental model should stay simple:

```txt
api.ts
app.tsx
worker.ts
```

The framework owns server boot, browser bundling, sync, persistence, worker lifecycle, and single-binary build output. App authors define the event-sourced API once, build React UI with semantic hooks derived from that API, and write backend effects in a dependency-injected worker closure.

## Design Constraints

- Keep the generic-first `defineApp<...>(...)` model.
- Do not introduce helper DSLs like `defineResource`, `command`, `event`, or `type`.
- Hide `Actor` and `identify` for apps.
- Derive semantic APIs from resources instead of hard-coding hooks like `useChat`.
- Avoid checked-in generated source files, especially empty generated client files.
- Avoid an app-owned server bootstrap.
- Keep migrations quiet until a second API version exists.
- Preserve event sourcing: commands emit immutable events, state is rebuilt from snapshots plus events, and views are projections.
- Workers own side effects and are testable through dependency injection.
- Use Bun and React. Remove Vite/Ripple from the target path.

## Target File Surface

### Small App

```txt
my-app/
  api.ts
  app.tsx
  worker.ts
```

### App With Migrations

```txt
my-app/
  api/
    index.ts
    v1.ts
    v2.ts
  app.tsx
  worker.ts
```

`app.tsx` and `worker.ts` always import from `./api`, so adding migrations does not change the UI or worker import path.

```ts
import { api } from "./api";
```

## Package Surface

Poggers Kit should be consumable without a global install.

- Runtime package: `@poggers/kit`
- Initializer package: `create-poggers`
- Local CLI bin installed by the runtime package: `poggers`
- App creation: `bun create poggers@latest my-app`
- Direct initializer fallback: `bunx create-poggers@latest my-app`

Generated apps should import only the public package surface:

```ts
import { defineApp } from "@poggers/kit";
import { defineUI } from "@poggers/kit/react";
import { defineWorker } from "@poggers/kit/worker";
```

Generated scripts should use the app-local `poggers` binary from `node_modules/.bin`, so the user's project stays reproducible:

```json
{
  "scripts": {
    "dev": "poggers dev",
    "build": "poggers build --outfile dist/app",
    "start": "./dist/app"
  }
}
```

React is the first UI adapter, not the identity of the framework. The core API, server, sync, event log, worker runtime, and migrations stay UI-agnostic. A future first-party UI layer can be added as another adapter without changing `defineApp` or the worker API.

## Target API Definition

The default app API keeps `defineApp`, but makes actor identity an internal framework concern.

```ts
import { defineApp } from "@poggers/kit";

type ChatState = {
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  status: "idle" | "generating" | "error";
};

type ChatEvents = {
  messageSent: { messageId: string; text: string; timestamp: number };
  generationCompleted: { messageId: string; text: string; timestamp: number };
};

type ChatViews = {
  messages: ChatState["messages"];
  status: ChatState["status"];
};

type ChatCommands = {
  sendMessage: {
    args: [text: string];
    event: "messageSent";
    error: "empty";
  };
  completeGeneration: {
    args: [data: { messageId: string; text: string; timestamp: number }];
    event: "generationCompleted";
    error: "duplicate";
  };
};

export const api = defineApp<{
  Resources: {
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Events: ChatEvents;
      Views: ChatViews;
      Commands: ChatCommands;
    };
  };
}>({
  version: 1,
  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
      },
      events: {
        messageSent({ state, payload }) {
          state.messages.push({
            id: payload.messageId,
            role: "user",
            content: payload.text,
          });
          state.status = "generating";
        },
        generationCompleted({ state, payload }) {
          state.messages.push({
            id: payload.messageId,
            role: "assistant",
            content: payload.text,
          });
          state.status = "idle";
        },
      },
      views: {
        messages({ state }) {
          return state.messages;
        },
        status({ state }) {
          return state.status;
        },
      },
      commands: {
        sendMessage(ctx, text) {
          if (!text.trim()) return ctx.error("empty");
          return ctx.event.messageSent({
            messageId: ctx.id(),
            text,
            timestamp: ctx.now(),
          });
        },
        completeGeneration(ctx, data) {
          if (ctx.state.messages.some((message) => message.id === data.messageId)) {
            return ctx.error("duplicate");
          }
          return ctx.event.generationCompleted(data);
        },
      },
    },
  },
});
```

### Internal Compatibility

- Internally keep an actor type for protocol/session/presence.
- If `Actor` and `identify` are omitted, supply a default local actor.
- Existing collaborative/authenticated apps can keep explicit `Actor` and `identify` if needed, but that should not be the app happy path.

## Target UI Definition

Rename the closure API to `defineUI`.

```tsx
import { defineUI } from "@poggers/kit/react";
import { api } from "./api";

export default defineUI(api, ({ useChat }) => {
  return function App() {
    const chat = useChat({ sessionId: "default" });

    return (
      <main>
        {chat.messages.map((message) => (
          <p key={message.id}>{message.content}</p>
        ))}
        <button onClick={() => void chat.sendMessage("hello")}>Send</button>
      </main>
    );
  };
});
```

### UI Checklist

- [ ] Add `defineUI(api, closure)` to the React adapter.
- [ ] Derive `use${Capitalize<ResourceName>}` hooks from `api.def.resources`.
- [ ] Preserve `useResource(resource, key)` as the lower-level primitive.
- [ ] Return typed views, commands, `sync`, and `raw` from each semantic hook.
- [ ] Provide the app client/provider internally so app authors do not write a hooks boilerplate file.
- [ ] Remove hard-coded app hooks like `src/apps/chat/web/src/hooks.ts`.
- [ ] Make the default export from `app.tsx` the UI root produced by `defineUI`.

## Target Worker Definition

Use `defineWorker` as a closure that receives semantic backend accessors derived from the same API.

```ts
import { defineWorker } from "@poggers/kit/worker";
import { api } from "./api";

type Deps = {
  ai: {
    stream(messages: Array<{ role: "user" | "assistant"; content: string }>): AsyncIterable<string>;
  };
  clock: { now(): number };
  ids: { create(): string };
};

export default defineWorker(api)<Deps>(({ useChat, on }, deps) => {
  const chat = useChat({ sessionId: "default" });

  on(chat.events.messageSent, async ({ event, view }) => {
    await chat.startStreaming?.();

    let text = "";
    for await (const chunk of deps.ai.stream(view.messages)) {
      text += chunk;
      await chat.streamChunk?.(text);
    }

    await chat.completeGeneration({
      messageId: `assistant:${event.id}`,
      text,
      timestamp: deps.clock.now(),
    });
  });
});
```

### Worker Checklist

- [ ] Add `defineWorker(api)<Deps>(closure)`.
- [ ] Derive backend semantic resource functions from the same generic API spec.
- [ ] Expose current views and commands to worker handlers.
- [ ] Expose event subscriptions as typed event selectors, for example `chat.events.messageSent`.
- [ ] Support dependency injection as the primary path for external services.
- [ ] Provide default dependency helpers for clocks and ids, but keep third-party clients app-owned.
- [ ] Ensure workers can run in the same Bun process as the server.
- [ ] Ensure workers can be tested without WebSocket or third-party services.

## Worker Idempotency And Restart Semantics

Workers are durable event consumers.

Delivery guarantee: at least once.

The framework must make repeat delivery safe by combining durable cursors with an effect ledger.

### Event Processing Flow

1. Worker starts and loads its last durable cursor/checkpoint.
2. Worker subscribes to the event log from that cursor.
3. Missed events are replayed in order.
4. Each matching handler receives the migrated current event shape and current view.
5. The framework checks whether the handler already completed this event.
6. If not completed, the handler runs.
7. Handler commands are emitted back through the API.
8. The handler execution is marked done only after it succeeds.
9. The worker cursor advances after all required handlers for the event are done.

### Idempotency Key

Use a stable key:

```txt
workerId + handlerId + resource + key + eventId
```

Handler IDs should be automatically derived where possible and explicitly configurable where necessary.

```ts
on(chat.events.messageSent, { id: "chat.generate-response" }, async (ctx) => {
  // effect
});
```

### Idempotency Checklist

- [ ] Add a durable worker checkpoint store.
- [ ] Add a durable worker effect ledger.
- [ ] Skip handler execution when the ledger says the event-handler pair is done.
- [ ] Treat duplicate app commands as success when the command is idempotent by deterministic IDs.
- [ ] Encourage injected third-party clients to accept idempotency keys.
- [ ] Add restart tests proving missed events are replayed.
- [ ] Add crash/retry tests proving completed effects are not duplicated.

## Migration Surface

The current migration kernel should be preserved.

Existing supported mechanisms:

- `previous`: points to the previous API version.
- `migrate.state`: transitions old snapshots.
- `migrate.event`: upcasts old stored events into the current event shape.

Target versioned layout:

```ts
// api/index.ts
export { api } from "./v2";
export type { Api } from "./v2";
```

```ts
// api/v2.ts
import { defineApp } from "@poggers/kit";
import { api as v1 } from "./v1";

export const api = defineApp<
  {
    Resources: {
      chat: {
        Key: { sessionId: string };
        State: ChatStateV2;
        Events: ChatEventsV2;
        Views: ChatViewsV2;
        Commands: ChatCommandsV2;
      };
    };
  },
  typeof v1
>({
  version: 2,
  previous: v1,
  migrate: {
    state: {
      chat(old) {
        return {
          ...old,
          archived: false,
        };
      },
    },
    event: {
      chat(name, payload) {
        if (name === "messageSent") {
          return {
            name: "messageSent",
            payload: { ...payload, source: "user" },
          };
        }
        return { name, payload };
      },
    },
  },
  resources: {
    chat: {
      // current resource definition
    },
  },
});
```

### Migration Checklist

- [ ] Keep `previous` and `migrate` in `defineApp`.
- [ ] Preserve snapshot state migration through version chains.
- [ ] Preserve event upcasting through version chains.
- [ ] Add `version` to stored `CommittedEvent`.
- [ ] Write `version: app.def.version` when committing new events.
- [ ] Replay events with `app.applyEvent(resource, state, event, event.version)`.
- [ ] Validate event `version` in protocol validators.
- [ ] Add regression tests for snapshot v1 plus event v2 replay.
- [ ] Add worker tests proving old missed events are upcast before handlers see them.

## Runtime And Build Surface

The framework should own the executable entrypoint.

Target commands:

```bash
bun create poggers@latest my-app
cd my-app
bun dev
bun run build
./my-app
```

Runtime responsibilities:

- Load `api` from the app directory.
- Load default export from `app.tsx`.
- Load default export from `worker.ts`.
- Start one Bun server process.
- Serve the React app.
- Run worker effects in-process.
- Persist server snapshots, event log, worker checkpoints, and worker ledger.
- Compile to one Bun binary.

### Runtime Checklist

- [ ] Add a framework app loader for `api`, `app.tsx`, and `worker.ts`.
- [ ] Remove app-owned `src/apps/chat/server/main.ts` from the target app surface.
- [ ] Remove checked-in browser build output from source.
- [ ] Remove `src/apps/chat/server/client.generated.ts`.
- [ ] Remove `scripts/embed-chat-client.ts` unless replaced by a non-source build artifact.
- [ ] Serve a virtual or build-time browser bundle without committing generated source.
- [ ] Keep a dev path with dynamic Bun browser bundling.
- [ ] Keep a build path that embeds the browser bundle into the compiled server binary.
- [ ] Ensure no Vite or Ripple dependency is needed for the target path.

## Testing Primitives

### API Tests

API tests should run the event-sourced app without network or browser.

```ts
test("sendMessage appends a user message", async () => {
  const app = testApp(api);
  const chat = app.resource("chat", { sessionId: "test" });

  const receipt = await chat.sendMessage("hello");

  expect(receipt.ok).toBe(true);
  expect(chat.events()).toMatchObject([{ name: "messageSent", payload: { text: "hello" } }]);
  expect(chat.view.messages).toHaveLength(1);
  expect(chat.view.status).toBe("generating");
});
```

### Worker Tests

Worker tests should use fake dependencies and an in-memory event store.

```ts
test("worker completes generation", async () => {
  const runtime = testWorker(api, worker, {
    deps: {
      ai: fakeAI(["hello back"]),
      clock: fakeClock(1000),
      ids: fakeIds(["assistant-1"]),
    },
  });

  const chat = runtime.resource("chat", { sessionId: "test" });

  await chat.sendMessage("hello");
  await runtime.drain();

  expect(chat.view.messages).toMatchObject([
    { role: "user", content: "hello" },
    { role: "assistant", content: "hello back" },
  ]);
});
```

### Testing Checklist

- [ ] Add `testApp(api)` for pure command/event/view assertions.
- [ ] Add `testApp(api).resource(name, key)` typed resource handles.
- [ ] Add `events()` inspection for emitted event assertions.
- [ ] Add `view` inspection for projected state assertions.
- [ ] Add `testWorker(api, worker, { deps, store })`.
- [ ] Add `runtime.drain()` for deterministic async worker tests.
- [ ] Add `runtime.restart()` or reusable `memoryStore()` for restart scenarios.
- [ ] Add fake helpers for AI, clock, ids, filesystem, and other common effects.
- [ ] Keep all third-party service calls behind injected deps.

## Verification Gates

### Static Gates

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `git diff --check`
- [ ] `bun run fmt:check`, with any existing unrelated failures documented

### Migration Gates

- [ ] Existing migration tests still pass.
- [ ] New event-version tests pass.
- [ ] Snapshot v1 restored by current API produces current state.
- [ ] Old event replay produces current state.
- [ ] Worker receives current event shape after replay of old events.

### Worker Gates

- [ ] Worker processes live events.
- [ ] Worker processes missed events after restart.
- [ ] Worker does not duplicate a completed handler after restart.
- [ ] Worker can run entirely with fake deps.
- [ ] Worker tests make no third-party network calls.

### Build Gates

- [ ] Dev server starts from the app directory with the framework entrypoint.
- [ ] Browser bundle is served without checked-in generated source.
- [ ] Single Bun binary compile succeeds.
- [ ] Compiled binary serves the UI and runs the worker.

### Browser Gates

Use the in-app browser for local verification.

- [ ] Start the framework dev server.
- [ ] Open the local app URL in the in-app browser.
- [ ] Verify the first screen renders the React UI, not a landing page or blank bundle.
- [ ] Type a chat message and submit it.
- [ ] Verify the message appears in the UI.
- [ ] Verify worker-generated output appears when fake/test deps are configured.
- [ ] Reload the page and verify state rehydrates.
- [ ] Stop and restart the server, then verify the UI rehydrates from persisted state.
- [ ] Run at least one browser interaction against the compiled binary.

## Implementation Phases

### Phase 1: Clean Current Branch Artifacts

- [ ] Remove hard-coded semantic hook source.
- [ ] Remove empty generated client source.
- [ ] Remove generated dist assets from source.
- [ ] Remove old Ripple/Vite app files from the target path.
- [ ] Keep `defineApp` generic-first and undo any helper DSL additions.

### Phase 2: `defineApp` Surface

- [ ] Make `Actor` optional in the app generic.
- [ ] Make `identify` optional with a default local actor.
- [ ] Keep explicit actor support available for advanced/collaborative apps.
- [ ] Update types without requiring app authors to mention `Actor`.
- [ ] Add tests for app definitions without `Actor` or `identify`.

### Phase 3: `defineUI`

- [ ] Implement `defineUI`.
- [ ] Generate semantic hooks from resource names at runtime and in TypeScript types.
- [ ] Update chat UI to default export `defineUI(api, ...)`.
- [ ] Remove app-owned hooks boilerplate.
- [ ] Verify UI type inference for views and commands.

### Phase 4: Event Version Metadata

- [ ] Add event version to protocol and storage types.
- [ ] Commit current app version with every event.
- [ ] Replay using per-event version.
- [ ] Preserve backward compatibility for old stored events with missing versions where possible.
- [ ] Add migration regression tests.

### Phase 5: `defineWorker` And DI

- [ ] Implement `defineWorker`.
- [ ] Implement backend semantic accessors.
- [ ] Implement typed event subscriptions.
- [ ] Add dependency injection.
- [ ] Port chat backend to `worker.ts`.
- [ ] Add pure worker tests with fake AI/clock/ids.

### Phase 6: Worker Durability

- [ ] Add checkpoint persistence.
- [ ] Add effect ledger persistence.
- [ ] Replay missed events after restart.
- [ ] Skip completed handler executions.
- [ ] Add restart/idempotency tests.

### Phase 7: Framework Runtime

- [ ] Add app loader.
- [ ] Add dev entrypoint.
- [ ] Add build entrypoint.
- [ ] Remove app-owned server bootstrap from the target app.
- [ ] Run UI and worker in one Bun process.
- [ ] Compile into one Bun binary.

### Phase 8: End-To-End Verification

- [ ] Run static gates.
- [ ] Run API tests.
- [ ] Run worker tests.
- [ ] Run migration tests.
- [ ] Run real WebSocket tests.
- [ ] Run browser gates against dev server.
- [ ] Run browser gates against compiled binary.

## Acceptance Criteria

- App authors can build a app with only `api.ts`, `app.tsx`, and `worker.ts`.
- `api.ts` uses `defineApp<...>(...)` and does not require `Actor` or `identify`.
- `app.tsx` uses `defineUI` and receives semantic hooks derived from the API.
- `worker.ts` uses `defineWorker`, receives semantic backend accessors, and supports injected deps.
- API migrations continue to support snapshot transition and event upcasting.
- Stored events carry version metadata.
- Worker restart catches up on missed events.
- Worker handlers are idempotent across restart/retry.
- Tests cover API behavior, worker behavior, migrations, and idempotency without third-party services.
- Browser verification confirms the React UI, live commands, rehydration, and compiled binary path.
- No Vite/Ripple app path remains in the target framework surface.
- No checked-in empty generated files remain.
