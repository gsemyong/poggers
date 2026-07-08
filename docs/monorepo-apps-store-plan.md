# Poggers Kit Monorepo, Apps, And Store Plan

## Goal

Turn the current repo into a clean Bun workspace for building, testing, dogfooding, documenting, and publishing Poggers Kit.

The target shape:

- `packages/kit` is the framework package: `@poggers/kit`.
- `packages/create-poggers` is the initializer package: `create-poggers`.
- `apps/*` are runnable private apps that use the kit like external users would.
- `apps/site` is the documentation and marketing site, built with Poggers Kit itself.
- `apps/chat` is the dogfood/example app.
- The store layer has a filesystem server store, an IndexedDB browser snapshot store, and memory test stores.
- Durable truth is latest snapshot plus the event tail after that snapshot.

## Non-Goals

- Do not add multiple UI frameworks or redundant UI adapters.
- Do not expose a storage adapter zoo as public API.
- Do not keep old Vite, Ripple, or app-owned server bootstrap paths.
- Do not keep app code inside the kit package source tree.
- Do not make the API surface larger than `api`, `app`, and `worker` for app authors.

## Final Repository Shape

```txt
package.json
bun.lock
tsconfig.json

packages/
  kit/
    package.json
    src/
      index.ts
      app.ts
      react.ts
      worker.ts
      testing.ts
      infra/
        app.ts
        client.ts
        protocol.ts
        react.tsx
        runtime.ts
        server.ts
        store/
          types.ts
          fs.ts
          idb.ts
          single-node.ts
        worker.ts
        testing.ts

  create-poggers/
    package.json
    src/
      index.js

apps/
  chat/
    package.json
    api/
      index.ts
      v1.ts
    app.tsx
    worker.ts

  site/
    package.json
    api.ts
    app.tsx
    worker.ts
    content/

docs/
  app-framework-plan.md
  monorepo-apps-store-plan.md
```

## Package Naming

### Published Packages

- `@poggers/kit`: framework/runtime package.
- `create-poggers`: initializer package used by `bun create poggers@latest`.

### Private Apps

Apps are workspace packages, but private and not published.

Recommended names:

- `@poggers/chat`
- `@poggers/site`

Each app depends on `@poggers/kit` through the workspace.

```json
{
  "private": true,
  "dependencies": {
    "@poggers/kit": "workspace:*"
  }
}
```

## Public App Surface

Every app should still feel like three files:

```txt
api.ts or api/index.ts
app.tsx
worker.ts
```

The generated app imports the public package only:

```ts
import { defineApp } from "@poggers/kit";
import { defineUI } from "@poggers/kit/react";
import { defineWorker } from "@poggers/kit/worker";
```

Generated package scripts:

```json
{
  "scripts": {
    "dev": "poggers dev",
    "build": "poggers build --outfile dist/app",
    "start": "./dist/app",
    "typecheck": "tsc --noEmit"
  }
}
```

## Root Workspace Responsibilities

The root package is private orchestration only.

Checklist:

- [ ] Set root `package.json` to `private: true`.
- [ ] Set root workspaces to `packages/*` and `apps/*`.
- [ ] Move `@poggers/kit` metadata from root to `packages/kit/package.json`.
- [ ] Move `create-poggers` metadata to `packages/create-poggers/package.json`.
- [ ] Add root scripts that delegate to packages/apps.
- [ ] Keep `bun.lock` at the repo root.
- [ ] Keep generated artifacts ignored: `.app`, `dist`, app-specific build output.

Suggested root scripts:

```json
{
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck",
    "lint": "bun run --filter '@poggers/kit' lint",
    "test": "bun test",
    "build:chat": "bun --cwd apps/chat run build",
    "build:site": "bun --cwd apps/site run build"
  }
}
```

## Migration Phases

### Phase 0: Baseline And Safety

Checklist:

- [ ] Record current `git status --short`.
- [ ] Verify no generated `.app` or `dist` artifacts are tracked.
- [ ] Run current baseline checks before moving files.
- [ ] Do not revert unrelated user edits.
- [ ] Keep old app deletions intact unless they are part of generated output cleanup.

Verification:

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `git diff --check`

### Phase 1: Move Kit Into `packages/kit`

Checklist:

- [ ] Create `packages/kit/src`.
- [ ] Move root `src/index.ts`, `src/react.ts`, `src/worker.ts`, `src/testing.ts`, `src/app.ts` into `packages/kit/src`.
- [ ] Move kit implementation files into `packages/kit/src`.
- [ ] Move root package export map into `packages/kit/package.json`.
- [ ] Preserve the `poggers` bin at `packages/kit/src/cli.ts`.
- [ ] Update internal relative imports after the move.
- [ ] Update TypeScript paths:
  - [ ] `@poggers/kit` -> `packages/kit/src/index.ts`
  - [ ] `@poggers/kit/*` -> `packages/kit/src/*`
- [ ] Remove root `src` once empty.
- [ ] Keep kit package files limited to kit source and no app code.

Verification:

- [ ] `bun run typecheck`
- [ ] `bun test packages/kit/tests`
- [ ] `npm pack --dry-run --json` inside `packages/kit` includes only kit files.

### Phase 2: Move Chat Into `apps/chat`

Checklist:

- [ ] Create `apps/chat`.
- [ ] Move `src/apps/chat/api` to `apps/chat/api`.
- [ ] Move `src/apps/chat/app.tsx` to `apps/chat/app.tsx`.
- [ ] Move `src/apps/chat/worker.ts` to `apps/chat/worker.ts`.
- [ ] Add `apps/chat/package.json`.
- [ ] Make chat depend on `@poggers/kit`, `react`, `react-dom`, and app-only worker dependencies.
- [ ] Move AI dependencies out of kit package and into chat app package if they are only used by chat.
- [ ] Update root scripts to run chat through its package scripts.
- [ ] Remove remaining `src/apps` if empty.

Suggested `apps/chat/package.json`:

```json
{
  "name": "@poggers/chat",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "poggers dev",
    "build": "poggers build --outfile dist/chat",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@poggers/kit": "workspace:*",
    "ai": "^7.0.16",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "zod": "^4.4.3"
  }
}
```

Verification:

- [ ] `bun --cwd apps/chat run typecheck`
- [ ] `POGGERS_FAKE_AI="Fake response" bun --cwd apps/chat run build`
- [ ] Start `bun --cwd apps/chat run dev` and verify the app in browser.
- [ ] Confirm no `src/apps/chat` remains.

### Phase 3: Keep `create-poggers` As A Package

Checklist:

- [ ] Keep `packages/create-poggers`.
- [ ] Update its template to generate apps that depend on `@poggers/kit`.
- [ ] Ensure generated app package is independent from this repo.
- [ ] Keep generated app surface to:
  - [ ] `api.ts`
  - [ ] `app.tsx`
  - [ ] `worker.ts`
  - [ ] `package.json`
  - [ ] `tsconfig.json`
  - [ ] `.gitignore`
- [ ] Do not generate hidden framework boilerplate.
- [ ] Do not generate Vite, Ripple, or app-owned server files.

Verification:

- [ ] `npm pack --dry-run --json` inside `packages/create-poggers`.
- [ ] Generate a temp app with local kit version.
- [ ] Install temp app dependencies.
- [ ] Run temp app `typecheck`.
- [ ] Build temp app binary.
- [ ] Start temp app binary and fetch `/`.

### Phase 4: Add `apps/site`

Goal: write the docs and website using Poggers Kit itself.

Checklist:

- [ ] Create `apps/site/package.json`.
- [ ] Create `apps/site/api.ts`.
- [ ] Create `apps/site/app.tsx`.
- [ ] Create `apps/site/worker.ts`.
- [ ] Add `apps/site/content` for public website/docs content.
- [ ] Keep architectural docs in root `docs`.
- [ ] Decide whether website content is loaded from markdown files or defined as typed data first.
- [ ] Start with minimal routing in app state if full framework routing is not ready.
- [ ] Add a home page, getting started page, API surface page, and store/migrations page.
- [ ] Dogfood semantic hooks in the site.

Verification:

- [ ] `bun --cwd apps/site run typecheck`
- [ ] `bun --cwd apps/site run build`
- [ ] Start site dev server and verify in browser.
- [ ] Verify generated binary serves docs HTML.

## Store Vision

### Truth Model

Events should not grow forever. Durable truth is:

```txt
snapshot(stream, seq N) + events(stream, seq > N)
```

Snapshots are not merely cache. Once events through sequence `N` are compacted, the snapshot at `N` is part of the canonical source of truth.

Required invariants:

- [ ] A stream can always be rebuilt from latest snapshot plus event tail.
- [ ] A snapshot records the API version it was written with.
- [ ] A snapshot records the stream sequence it covers.
- [ ] Events record the API version they were written with.
- [ ] Event replay applies only events after the snapshot sequence.
- [ ] Migration can restore old snapshots and upcast old events.
- [ ] Compaction never removes events newer than the snapshot sequence.

### Naming

Use `store`, not `storage`, in framework code.

Recommended names:

- `Store`: durable single-node engine.
- `MemoryStore`: in-memory test implementation.
- `LocalStore`: blessed production implementation.
- `Stream`: one resource instance, `resource + key`.
- `StreamId`: stable serialized stream identifier.
- `EventLog`: durable event tail.
- `Snapshot`: durable checkpoint through a sequence.
- `Writer`: serialized write queue for a stream.
- `Compaction`: writing a snapshot and pruning covered events.

### Production Store Decision

We should have one server persistence store.

Recommendation:

- Use filesystem JSONL/snapshot persistence as the product runtime.
- Keep IndexedDB for browser client snapshots.
- Keep memory stores for tests.
- Reconsider an embedded database only if a measured workload proves the filesystem store is insufficient.

### Store API Shape

Replace low-level `Store` with stream-aware operations.

Target shape:

```ts
export type StreamId = string;

export type StoredSnapshot = {
  version: number;
  seq: number;
  data: unknown;
};

export type StoredEvent = {
  id: string;
  seq: number;
  at: number;
  version: number;
  actor: unknown;
  name: string;
  payload: unknown;
};

export type Store = {
  loadStream(streamId: StreamId): {
    snapshot: StoredSnapshot | null;
    events: StoredEvent[];
    commandIds: Set<string>;
  };

  append(
    streamId: StreamId,
    batch: {
      commandId?: string;
      events: StoredEvent[];
    },
  ): void;

  compact(
    streamId: StreamId,
    compaction: {
      snapshot: StoredSnapshot;
      throughSeq: number;
    },
  ): void;

  hasCommand(streamId: StreamId, commandId: string): boolean;
  close?(): void;
};
```

Important: compaction must remove only events with `seq <= throughSeq`.

### Writer Model

Write parallelism should be handled above the store.

Target:

```txt
resource + key -> stream id -> stream writer queue -> durable append
```

Checklist:

- [ ] Introduce `StreamWriter`.
- [ ] Serialize commands per stream.
- [ ] Allow different streams to execute concurrently at the runtime level.
- [ ] Batch append events per command.
- [ ] Keep sequence assignment deterministic inside a stream.
- [ ] Do not depend on concurrent write transactions inside the embedded store.
- [ ] Add optional partitioning later if one LMDB write transaction becomes a measured bottleneck.

Clarification:

- "One writer per resource" should mean one writer per resource stream, not one writer per resource type.
- `chat:{sessionId:"a"}` and `chat:{sessionId:"b"}` should not block each other in command execution.
- The underlying store may still serialize final disk commits, but work before commit can be parallelized and commits can be batched.

### Snapshot And Compaction Flow

Previous rough flow:

```txt
saveSnapshot()
remove all events
```

Target flow:

```txt
compute snapshot from in-memory stream state at seq N
store.compact(streamId, { snapshot, throughSeq: N })
```

Safety rules:

- [ ] Snapshot must be written before covered events are removed.
- [ ] Removing events must be bounded by `throughSeq`.
- [ ] If compaction fails after snapshot write, retry must be safe.
- [ ] If compaction is interrupted, recovery must still rebuild state.
- [ ] A new write racing with compaction must not be deleted by compaction.

### Migration And Compaction

Migration must work for both canonical truth pieces:

```txt
old snapshot + old event tail -> current state -> current snapshot
```

Checklist:

- [ ] Keep `previous` and `migrate` in `defineApp`.
- [ ] Snapshot restore migrates through version chain.
- [ ] Event replay upcasts through version chain.
- [ ] Worker replay sees upcast current-version events.
- [ ] When an old snapshot is loaded and migrated, the next compaction writes a current-version snapshot.
- [ ] Compaction after migration can remove old-version events only after they are included in a current-version snapshot.
- [ ] Tests cover v1 snapshot plus v1/v2 tail loaded by v3 API.

## Implementation Checklist

### Monorepo

- [x] Root package becomes private workspace.
- [x] `packages/kit` contains all kit code.
- [x] `packages/create-poggers` remains initializer code.
- [x] `apps/chat` contains chat app.
- [x] `apps/site` contains website/docs app.
- [x] Root `src` is removed.
- [x] App code is not published in the kit tarball.

### Imports

- [x] Kit internals use relative imports.
- [x] Apps use `@poggers/kit`.
- [x] Tests use either package imports or clear local test aliases.
- [x] No app imports `packages/kit/src` directly.
- [x] No source imports `/kit`.
- [x] No source imports old repo code names.

### Store

- [x] Rename `storage` folder to `store`.
- [x] Use the simple `Store` name for the server store type.
- [x] Use `createFileStore` for the local server store.
- [ ] Move test memory store into kit test helpers or `store/memory.ts`.
- [x] Keep filesystem store as the production runtime.
- [x] Replace event clearing with sequence-bounded compaction.
- [x] Add stream writer scheduling.
- [x] Make worker durability checkpoint-aware per scope.

### Apps

- [x] Chat runs from `apps/chat`.
- [x] Site runs from `apps/site`.
- [x] Both apps use the same public package imports a user would use.
- [x] Both apps build to a single binary.
- [x] Both apps can run through `poggers dev`.

### Docs

- [x] Keep this plan in `docs`.
- [x] Add a short architecture doc for snapshots and compaction.
- [x] Add getting started docs in the site app.
- [x] Add API surface docs in the site app.
- [x] Add store/migrations docs in the site app.

## End-To-End Verification Gates

### Gate 1: Workspace Health

- [ ] `bun install --lockfile-only`
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `git diff --check`
- [ ] Scoped `oxfmt --check` for changed files

### Gate 2: Package Publishing Shape

- [ ] `npm pack --dry-run --json` in `packages/kit`
- [ ] `npm pack --dry-run --json` in `packages/create-poggers`
- [ ] Kit tarball contains no `apps/*`.
- [ ] Kit tarball contains no tests unless intentionally included.
- [ ] Create package tarball contains only initializer files.

### Gate 3: Generated App

- [ ] Generate temp app with `create-poggers`.
- [ ] Install temp app against local packed `@poggers/kit`.
- [ ] Temp app typechecks.
- [ ] Temp app dev server starts.
- [ ] Browser loads temp app root.
- [ ] Temp app binary builds.
- [ ] Temp app binary serves HTML.

### Gate 4: Chat App

- [ ] `bun --cwd apps/chat run typecheck`
- [ ] `POGGERS_FAKE_AI="Fake response" bun --cwd apps/chat run build`
- [ ] Start `bun --cwd apps/chat run dev`.
- [ ] Browser loads chat app.
- [ ] Send a chat message.
- [ ] Worker produces fake response.
- [ ] Restart server and verify state recovery.

### Gate 5: Site App

- [ ] `bun --cwd apps/site run typecheck`
- [ ] `bun --cwd apps/site run build`
- [ ] Start `bun --cwd apps/site run dev`.
- [ ] Browser loads home page.
- [ ] Browser loads docs/API page.
- [ ] Binary serves site HTML.

### Gate 6: Store Correctness

- [ ] Append events to a stream.
- [ ] Snapshot at seq N.
- [ ] Compact through seq N.
- [ ] Reload stream and verify state from snapshot plus tail.
- [ ] Concurrent commands against different streams do not block command execution.
- [ ] Commands against the same stream preserve sequence order.
- [ ] Duplicate command id is idempotent after restart.
- [ ] Compaction failure is retryable.
- [ ] Append failure is all-or-nothing.
- [ ] Migration from old snapshot plus old tail works.
- [ ] Worker replay after migration is idempotent.

### Gate 7: Naming Cleanliness

- [x] No redundant domain adjectives in package/source identifiers.
- [x] No old repo code names in package/source identifiers.
- [ ] No `Vite` or `Ripple` runtime path.
- [ ] No app code under kit package source.
- [ ] No generated app boilerplate checked in outside apps.

## Definition Of Done

- [ ] Repo is a coherent Bun workspace.
- [ ] Published packages live under `packages`.
- [ ] Runnable apps live under `apps`.
- [ ] `apps/site` documents Poggers Kit using Poggers Kit.
- [ ] The kit package can be packed and consumed by a generated app.
- [ ] The initializer can create an app without global install.
- [ ] The store model uses snapshot plus event tail as canonical truth.
- [ ] Compaction is sequence-bounded and migration-aware.
- [ ] All end-to-end gates pass.
