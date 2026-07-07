# Environment Programs And Native UI Plan

## Goal

Move Poggers Kit from "React UI plus one worker file" toward one app specification that can describe resources, environment dependency types, persistent environment programs, and a native signal-driven UI.

The target developer experience:

- The app is described by one generic type parameter.
- Dependencies are typed per environment, not as framework capabilities.
- Each environment has one persistent program script.
- Programs are ordinary async TypeScript and can organize logic however they want.
- Durable app event reactions are consumed through event streams inside the program, not declared in a separate trigger table.
- UI code maps live data to DOM and calls actions; it should not need effects for app data synchronization.
- React remains a compatibility adapter during migration, but the core UI target becomes Poggers JSX plus fine-grained signals.

## First Principles

### What The Framework Owns

- App resource definitions.
- Event log, snapshots, migrations, and sync.
- Typed semantic resource handles.
- Durable event streams for environment programs.
- Environment runtime startup and shutdown.
- Checkpoints and idempotency for durable event consumers.
- Native JSX rendering and data binding.

### What The User Owns

- The app spec.
- Resource behavior.
- Environment dependency construction.
- Program organization.
- Long-running background logic.
- UI composition.

### What We Avoid

- No `task.on.created` style property-chained event APIs.
- No separate declarative worker trigger table.
- No fake capability registry.
- No framework wrappers for ordinary program loops.
- No required React hooks/effects for app data.
- No app-owned Vite/Ripple path.

## Target App Shape

The most compact app can eventually be one `app.tsx`:

```tsx
import { defineApp } from "@poggers/kit";

type App = {
  Resources: {
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Events: {
        messageSent: { messageId: string; text: string };
        generationCompleted: { messageId: string; text: string };
      };
      Views: {
        messages: Message[];
        status: "idle" | "generating";
      };
      Commands: {
        sendMessage: {
          args: [text: string];
          event: "messageSent";
          error: "empty";
        };
        completeGeneration: {
          args: [data: { messageId: string; text: string }];
          event: "generationCompleted";
          error: never;
        };
      };
    };
  };

  Environments: {
    browser: {
      Deps: {
        ai: {
          complete(messages: Message[]): Promise<string>;
        };
      };
    };
  };
};

export default defineApp<App>({
  version: 1,

  resources: {
    chat: { ... },
  },

  programs: {
    async browser({ events, useChat, signal }, deps) {
      await Promise.all([
        respondToMessages({ events, signal }, deps),
      ]);
    },
  },

  ui({ useChat }) {
    const chat = useChat({ sessionId: "main" });

    return (
      <main>
        <For each={chat.messages}>
          {(message) => <p>{message.content}</p>}
        </For>
        <button onClick={() => chat.sendMessage("hello")}>Send</button>
      </main>
    );
  },
});

async function respondToMessages({ events, signal }, deps) {
  for await (const { chat, event } of events("chat.messageSent", {
    id: "generate-reply",
    signal,
  })) {
    const text = await deps.ai.complete(chat.messages());
    await chat.completeGeneration({
      messageId: `assistant:${event.id}`,
      text,
    });
  }
}
```

For serious apps, users can still split the same app into normal TypeScript modules:

```text
app.tsx
resources/chat.ts
programs/browser.ts
ui/App.tsx
```

The split is organization only. It should not create new framework concepts.

## Environment Programs

### Model

One environment program is a persistent async script owned by the app spec.

```ts
programs: {
  async browser(ctx, deps) {
    await Promise.all([
      syncInbox(ctx, deps),
      respondToMessages(ctx, deps),
      watchExternalSource(ctx, deps),
    ]);
  },
}
```

The runtime starts the program for the selected environment:

```ts
await run(app, {
  env: "browser",
  deps: createBrowserDeps(),
});
```

The program receives:

```ts
type ProgramContext<App, Env> = {
  signal: AbortSignal;
  events: TypedDurableEventStream<App>;
  useChat(key): ChatHandle;
  useTask(key): TaskHandle;
};
```

Dependencies are inferred from:

```ts
App["Environments"][Env]["Deps"];
```

### Event Stream API

Workers are persistent scripts. Durable app reactions use async iterables:

```ts
for await (const item of events("chat.messageSent", {
  id: "generate-reply",
  signal,
})) {
  item.event;
  item.key;
  item.chat;
}
```

Why this shape:

- It matches idiomatic TypeScript and platform APIs better than property-chained event names.
- It composes with normal `for await`, `Promise.all`, helpers, and cancellation.
- It keeps event subscriptions inside program logic.
- It gives the runtime a stable durable consumer id.

The first version should require `id` for durable consumers. If we later infer ids safely, that can be sugar.

### Durable Semantics

For every `events(name, { id })` consumer, runtime stores:

- environment name
- consumer id
- event name
- per-scope cursor/checkpoint
- completed event ids when needed for idempotency

Rules:

- On startup, replay matching events from the event tail after the consumer checkpoint.
- On live events, enqueue matching events into the consumer stream.
- Checkpoint only after the consumer loop advances successfully.
- If the process dies, replay uncheckpointed events.
- If the consumer throws, keep the event available and retry after restart or explicit runtime retry.
- Compaction must preserve events needed by any environment consumer checkpoint.

### External Persistent Work

Long-running external loops are just normal TypeScript:

```ts
for await (const file of deps.files.watch({ signal })) {
  await useFile({ path: file.path }).changed(file);
}
```

The framework does not wrap this in `loop()`. If an external source must be durable, the dependency must provide a durable source, or the program must store its own cursor through the app.

## Native UI

### Goal

The UI should be a pure mapping from live resource views to DOM plus action handlers.

No data-layer effects should be needed in user UI code.

```tsx
const chat = useChat({ sessionId: "main" });

return (
  <main>
    <For each={chat.messages}>{(message) => <Message message={message} />}</For>
    <button onClick={() => chat.sendMessage(text())}>Send</button>
  </main>
);
```

### Data Reactivity

Resource views become signal-backed values.

The renderer tracks reads during rendering:

- `chat.messages`
- `chat.status`
- derived expressions

When sync applies a snapshot/event:

- only dependent DOM updates run
- command methods remain stable
- no React state/effect bridge is needed

### UI Effects

Data sync effects are hidden in the runtime.

UI-only effects remain as an escape hatch:

- focus after mount
- scroll to bottom
- element measurement
- keyboard shortcuts
- third-party widgets
- browser APIs not modeled as app resources

This should be explicit and rare. The first native UI pass can provide:

```ts
effect(() => { ... });
onMount(() => { ... });
```

But generated apps should not need these for app data.

### JSX Runtime

Add a native JSX runtime to the kit:

```text
@poggers/kit/ui
@poggers/kit/jsx-runtime
```

Implementation direction:

- Use `alien-signals` or a similarly tiny signal core.
- Provide `jsx`, `jsxs`, `Fragment`.
- Provide DOM rendering.
- Provide `<For>`, `<Show>`, and event/action binding.
- Keep React adapter as `@poggers/kit/react` during migration.
- Generated apps eventually use native Poggers JSX by default.

## Public Surface

### Runtime Package Exports

Target package exports:

```json
{
  ".": "./src/index.ts",
  "./app": "./src/app.ts",
  "./program": "./src/program.ts",
  "./ui": "./src/ui.ts",
  "./jsx-runtime": "./src/jsx-runtime.ts",
  "./react": "./src/react.ts",
  "./testing": "./src/testing.ts"
}
```

### CLI

`poggers dev` should load the app and start:

- server
- browser bundle
- selected environment program
- default deps if exported by the app

Explicit environment script:

```ts
import app from "./app";
import { run } from "@poggers/kit/program";

await run(app, {
  env: "browser",
  deps: createBrowserDeps(),
});
```

Generated small app can export deps from the app file:

```ts
export function createBrowserDeps() {
  return { ... };
}
```

## Migration Strategy

### Compatibility

Keep current surfaces while building the new ones:

- `api.ts` + `app.tsx` + `worker.ts`
- `defineUI`
- `defineWorker`
- React adapter

Introduce new surfaces beside them:

- `defineApp({ ui, programs })`
- `@poggers/kit/program`
- `@poggers/kit/ui`
- `@poggers/kit/jsx-runtime`

Once dogfood apps are migrated, generated apps can switch to the new default.

### Dogfood Migration

Move chat first:

- Convert worker logic into `programs.browser`.
- Replace `defineWorker` usage with `events("chat.messageSent", { id })`.
- Keep React UI initially.
- Then move chat UI to native Poggers JSX.

Move site second:

- Use native UI first because it is mostly static data/action mapping.
- Keep an empty browser program if no background logic is needed.

## Implementation Phases

### Phase 0: Research And API Freeze

- [ ] Read current worker runtime and identify reusable durability pieces.
- [ ] Confirm Alien Signals API from primary source before coding.
- [ ] Confirm TypeScript JSX runtime requirements.
- [ ] Write type sketches for `AppSpec["Environments"]`, `Programs`, and `ProgramContext`.
- [ ] Decide whether durable `events()` requires `id` in v1. Recommended: yes.
- [ ] Decide final native UI package names. Recommended: `@poggers/kit/ui` and `@poggers/kit/jsx-runtime`.

Gate:

- [ ] API examples typecheck in a temporary spec test.
- [ ] No new wrappers beyond `defineApp`.

### Phase 1: Type-Level Environment Programs

- [ ] Extend `AppSpec` with optional `Environments`.
- [ ] Add typed `ProgramContext`.
- [ ] Add typed `Programs<Spec>`.
- [ ] Add `programs` field to `defineApp` while preserving existing app behavior.
- [ ] Generate semantic `use<Resource>` handles for program context.
- [ ] Add compile-time tests for deps inference by environment.
- [ ] Add compile-time tests that one environment cannot access another environment's deps.

Gate:

- [ ] `bun run typecheck`
- [ ] App surface tests cover `Environments` and `programs`.

### Phase 2: Durable Event Streams

- [ ] Implement `events(name, { id, signal })` as `AsyncIterable`.
- [ ] Type event names as `"resource.event"` from the app spec.
- [ ] Type yielded item as `{ event, key, resourceHandle }`.
- [ ] Reuse current worker durability store concepts for cursors/completion.
- [ ] Add runtime queue per durable consumer.
- [ ] Replay missed events on startup.
- [ ] Support multiple consumers for the same event using different ids.
- [ ] Abort streams on program shutdown.
- [ ] Preserve checkpoint-aware compaction.

Gate:

- [ ] Unit test: stream receives live event.
- [ ] Unit test: stream replays missed event after restart.
- [ ] Unit test: same event with two consumer ids runs twice independently.
- [ ] Unit test: same consumer id is idempotent after restart.
- [ ] Unit test: abort signal closes async iterator.
- [ ] E2E test: chat assistant program catches up after being offline.

### Phase 3: Program Runtime And CLI

- [ ] Add `@poggers/kit/program` export.
- [ ] Add `run(app, { env, deps })`.
- [ ] Update `serveApp`/runtime to start selected environment program.
- [ ] Update CLI to discover app-level `create<Env>Deps` exports.
- [ ] Keep current `worker.ts` loading for compatibility.
- [ ] Add cleanup/shutdown semantics with `AbortController`.
- [ ] Ensure program errors are surfaced but do not corrupt event state.

Gate:

- [ ] Existing chat worker tests still pass.
- [ ] New environment program tests pass.
- [ ] `poggers dev` starts app program.
- [ ] Binary build embeds and starts app program.

### Phase 4: Native Signal Core

- [ ] Add `alien-signals` dependency if chosen after research.
- [ ] Implement internal signal wrappers for resource views.
- [ ] Convert client resource cache to expose signal-backed reads for native UI.
- [ ] Add tests for signal updates on snapshot/event.
- [ ] Add tests for derived reads.
- [ ] Keep React adapter using current compatibility path.

Gate:

- [ ] Updating one resource event invalidates only subscribed signal reads.
- [ ] No UI code effect is required to receive server data.

### Phase 5: JSX Runtime

- [ ] Add `@poggers/kit/jsx-runtime`.
- [ ] Add `@poggers/kit/ui`.
- [ ] Implement DOM renderer.
- [ ] Implement text, elements, attributes, event listeners, and cleanup.
- [ ] Implement `<For>` and `<Show>`.
- [ ] Implement `render(App, root)`.
- [ ] Add tsconfig/jsx settings for generated apps.
- [ ] Add browser bundle support for native JSX entrypoints.

Gate:

- [ ] Unit DOM test: text updates from signal.
- [ ] Unit DOM test: keyed list updates correctly.
- [ ] Unit DOM test: button action calls resource command.
- [ ] Bundle test: native UI app builds without React.

### Phase 6: Dogfood Apps

- [ ] Migrate `apps/site` to native UI.
- [ ] Migrate `apps/chat` program logic to environment program.
- [ ] Migrate `apps/chat` UI to native UI after site is stable.
- [ ] Keep React adapter tests to prevent breakage during transition.
- [ ] Update docs and generated app template.

Gate:

- [ ] `apps/site` runs with native UI.
- [ ] `apps/chat` sends message and receives assistant response through environment program.
- [ ] Generated app uses native UI by default.

### Phase 7: Generated App And Package Shape

- [ ] Update `create-poggers` template to one-file `app.tsx` default.
- [ ] Include optional environment deps export.
- [ ] Remove generated `worker.ts` from default template.
- [ ] Ensure generated app can split files manually without framework changes.
- [ ] Keep package tarballs free of app code and tests.

Gate:

- [ ] Generate temp app.
- [ ] Install temp app against local `@poggers/kit`.
- [ ] Temp app typechecks.
- [ ] Temp app dev server starts.
- [ ] Temp app binary builds.
- [ ] Temp app binary serves HTML.

## End-To-End Verification Gates

### Workspace Gate

- [ ] `bun install --lockfile-only`
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run fmt:check`
- [ ] `bun test`
- [ ] `git diff --check`

### Package Gate

- [ ] `npm pack --dry-run --json` in `packages/kit`
- [ ] `npm pack --dry-run --json` in `packages/create-poggers`
- [ ] Kit tarball contains no app code.
- [ ] Create package tarball contains only initializer files.
- [ ] Native UI exports are included.
- [ ] React remains optional/adapter-scoped.

### Program Runtime Gate

- [ ] Program starts when environment starts.
- [ ] Program receives only that environment's deps.
- [ ] Program handles live app events.
- [ ] Program replays missed app events.
- [ ] Program shutdown aborts event streams.
- [ ] Multiple durable consumers for one app event are independent.
- [ ] Compaction waits for environment program checkpoints.

### Native UI Gate

- [ ] Data renders without React.
- [ ] Data updates without user-authored data effects.
- [ ] Actions call resource commands.
- [ ] Lists render and update correctly.
- [ ] UI-only effects remain available as explicit escape hatches.
- [ ] Native UI bundle does not include React.

### Browser Gate

Use the in-app browser for all browser gates.

- [ ] Start generated app dev server.
- [ ] Browser loads generated app root.
- [ ] Click an action and observe DOM update.
- [ ] Restart server and verify state recovery.
- [ ] Start `apps/site`.
- [ ] Browser verifies home and API/docs navigation.
- [ ] Start `apps/chat`.
- [ ] Browser sends chat message.
- [ ] Browser verifies environment program response.
- [ ] Browser verifies recovery after app restart.
- [ ] Capture at least one screenshot per native UI dogfood app.

### Binary Gate

- [ ] Build generated app binary.
- [ ] Binary serves native UI HTML.
- [ ] Build site binary.
- [ ] Site binary serves docs.
- [ ] Build chat binary with fake deps.
- [ ] Chat binary serves UI and program responds.

## Definition Of Done

- [ ] One generic app spec can describe resources, environments, programs, and UI.
- [ ] Environment deps are inferred from the spec.
- [ ] Environment programs are persistent async scripts.
- [ ] Durable app event reactions are expressed as async event streams inside programs.
- [ ] No named worker trigger table is required.
- [ ] UI app data rendering is signal-driven and effect-free for app authors.
- [ ] Generated app defaults to native Poggers UI.
- [ ] React adapter still works as compatibility.
- [ ] Browser, binary, generated app, package, and full workspace gates pass.
