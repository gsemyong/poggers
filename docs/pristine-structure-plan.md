# Pristine Structure Plan

## Goal

Make the repository small, boring, and easy to reason about:

- One server persistence implementation.
- One browser persistence implementation.
- No public adapter abstraction for runtime modes we do not support.
- App-local generated declarations for editor stability, kept out of formatter churn.
- No fake root TypeScript project pretending it can typecheck app-local generated modules.
- A small set of tests named after product surfaces, not arbitrary layers.
- Turbo, Oxlint, and Oxfmt wired in the least surprising way.

## Target Shape

```txt
package.json
turbo.json
.oxlintrc.json

apps/
  chat/
    package.json
    tsconfig.json
    src/
  site/
    package.json
    tsconfig.json
    src/

packages/
  kit/
    package.json
    tsconfig.json
    src/
      index.ts
      cli.ts
      app.ts
      client.ts
      server.ts
      storage.ts
      protocol.ts
      runtime.ts
      worker.ts
      ui.ts
      style.ts
      testing.ts
      jsx-runtime.ts
      jsx-dev-runtime.ts
      jsx-types.ts

    tests/
      *.spec.ts
      helpers/

  create-poggers/
    package.json
    src/index.js
```

Ignored generated output:

```txt
apps/*/.app/build/
apps/*/dist/
```

## Decisions

- Keep filesystem storage for server persistence.
- Keep IndexedDB storage for browser client snapshots.
- Remove LMDB from the product until we intentionally design a batched LMDB storage engine.
- Remove the public `single-node` adapter concept; single-process pubsub and sequence allocation are server internals.
- Remove package-level `app-types`; `@poggers/app` is app-specific and generated per app as `src/poggers-app.d.ts`.
- Keep `jsxImportSource` only in the distributed app TypeScript config, because app JSX must compile through `@poggers/kit` rather than React.
- Do not run root `tsc` over app source that imports `@poggers/app`; app typechecking must run through `poggers typecheck`.

## Phase 0: Baseline And Safety

- [x] Confirm current worktree status and identify unrelated user changes.
- [x] Run current gates once to capture a baseline:
  - [x] `bun run check`
  - [x] `bun run build`
  - [x] generated app smoke: create, install, typecheck, build
- [x] Save any performance numbers used for storage decisions in the final summary.
- [x] Confirm no generated `.app`, `dist`, or `.turbo` output is tracked.

Verification gate:

- [x] `git status --short` is understood before edits continue.
- [x] All failures are classified as pre-existing or introduced.

## Phase 1: Storage Simplification

Intent: keep one server store and one browser store.

- [x] Delete LMDB implementation.
- [x] Remove `lmdb` dependency from `packages/kit/package.json`.
- [x] Remove LMDB tests.
- [x] Merge server filesystem store and browser IndexedDB store into `packages/kit/src/storage.ts`.
- [x] Export only intentionally public storage types/functions.
- [x] Keep memory stores test-only.
- [x] Update docs that list LMDB as supported.
- [x] Update lockfile with `bun install`.

Target public concepts:

- `createFileStore(...)` for server persistence.
- `createBrowserStore(...)` for browser snapshots.
- Test-only memory storage helpers hidden behind `testing.ts` or local specs.

Verification gate:

- [x] `rg -n "lmdb|createLocalStore|LMDB" packages apps package.json bun.lock` has no product references.
- [x] `bun test packages/kit/tests/storage.spec.ts`
- [x] `bun run typecheck`

## Phase 2: Remove Adapter Topology

Intent: stop advertising runtime modes we do not support.

- [x] Delete `single-node.ts`.
- [x] Remove the in-memory pubsub and per-scope sequencer as public concepts.
- [x] Replace `ServerAdapter` with explicit server-local state.
- [x] Change server options to accept storage directly when tests need custom persistence.
- [x] Update tests to pass storage or failure hooks instead of building adapters.
- [x] Remove `ServerPubSub`, `ServerSequencer`, and `ServerAdapter` exports.
- [x] Remove runtime topology language from source.

Verification gate:

- [x] `rg -n "ServerAdapter|ServerPubSub|ServerSequencer|single-node|horizontal|adapter" packages/kit/src packages/kit/tests apps` only finds intentional non-runtime wording.
- [x] `bun run typecheck`
- [x] `bun test packages/kit/tests/server.spec.ts packages/kit/tests/storage.spec.ts`

## Phase 3: Generated App Types

Intent: `@poggers/app` should be truthful: generated per app, never approximated by package fallback declarations.

- [x] Delete `packages/kit/app-types`.
- [x] Remove `./app-types` package export.
- [x] Remove fallback `@poggers/app` path entries that point into package static declarations.
- [x] Make `poggers typecheck`, `poggers dev`, and `poggers build` generate `src/poggers-app.d.ts` before TypeScript needs it.
- [x] Ensure generated declarations contain all app-specific resource, component, navigation, preset, and theme exports.
- [x] Remove the root project path that hid missing generated app types.
- [x] Update scaffold and docs to use the supported typecheck command.

Verification gate:

- [x] `rm -rf apps/site/.app apps/chat/.app`
- [x] `bun run typecheck` from `apps/site`
- [x] `bun run typecheck` from `apps/chat`
- [x] `bunx tsc --noEmit -p apps/site/tsconfig.json --pretty false` passes after generation.
- [x] `rg -n "app-types|@poggers/kit/app-types" packages apps package.json bun.lock` has no product references.

## Phase 4: TypeScript Config Ownership

Intent: app configs are tiny, package configs are honest, and root config does not produce fake app errors.

- [x] Keep app `tsconfig.json` files as one-line extends from `@poggers/kit/tsconfig`.
- [x] Keep `jsxImportSource` in the exported app config.
- [x] Remove root `paths` aliases for `tests/*` and `infra/*` after test layout is collapsed.
- [x] Remove root `tsconfig.json`; root `tsc` is not a supported command.
- [x] Ensure package `tsconfig.json` typechecks kit source and tests without needing app-generated modules.
- [x] Ensure app typecheck happens only through app/package scripts.
- [x] Remove `ignoreDeprecations` once TypeScript 7 no longer needs it.

Verification gate:

- [x] `bun run typecheck`
- [x] `bun run typecheck` from `apps/site`
- [x] `bun run typecheck` from `apps/chat`
- [x] Raw root `bunx tsc --noEmit --pretty false` is not a supported command because there is no root TS project.

## Phase 5: Test Suite Collapse

Intent: fewer files, better names, less indirection.

Previous suite:

- 24 spec files.
- About 7,900 lines.
- Separate root `contracts`, `integration`, `e2e`, and `helpers` folders.

Target suite:

- Production-only `src`.
- A flat package-local `tests/` folder for package specs and cross-module flows.
- No root `tests/` tree.
- No arbitrary `contracts`, `integration`, or `e2e` directory hierarchy.

Checklist:

- [x] Move storage contract coverage into `storage.spec.ts`.
- [x] Delete pubsub/sequencer assertions with the removed adapter layer.
- [x] Flatten client protocol and reconnect/outbox tests into package-local product-surface specs.
- [x] Flatten real WebSocket, storage recovery, server failure, worker, and program flows into package-local product-surface specs.
- [x] Keep reusable fixtures only in `packages/kit/tests/helpers` because they are shared by many files.
- [x] Keep root `tests/` deleted.
- [x] Remove `tests/*` path alias.

Verification gate:

- [x] Spec count is 17; exception justified by keeping large cross-module flows split by product surface instead of creating massive files.
- [x] `bun test packages/kit/tests`
- [x] `bun run typecheck`

## Phase 6: File Layout Flattening

Intent: package source should not require reading an `infra` tree to understand the framework.

- [x] Move `packages/kit/src/infra/app.ts` to `packages/kit/src/app.ts`.
- [x] Move `client.ts`, `server.ts`, `protocol.ts`, `runtime.ts`, `worker.ts`, `ui.ts`, `style.ts`, `jsx-types.ts`, and `testing.ts` to `packages/kit/src`.
- [x] Move specs and typecheck fixtures into `packages/kit/tests`.
- [x] Update package exports.
- [x] Update imports to local relative imports or package exports consistently.
- [x] Delete empty `infra` folder.

Verification gate:

- [x] `find packages/kit/src -maxdepth 2 -type d`
- [x] `rg -n "src/infra|from \"\\.\\/infra|from \"infra/" packages apps package.json turbo.json` has no product references.
- [x] `bun run check`

## Phase 7: Turbo, Oxlint, And Oxfmt

Intent: one boring way to run quality gates.

Docs basis:

- Turborepo runs package scripts matching `turbo.json` task names in parallel.
- Root-only tasks should use `//#task` when orchestrated by Turbo.
- Oxfmt respects `.gitignore` and config `ignorePatterns`.
- Oxlint supports nested configs, but ignores are preferred when only exclusions differ.

Checklist:

- [x] Keep package `lint` scripts only where package-specific linting is needed.
- [x] Keep existing root `fmt` / `fmt:check` naming intentionally.
- [x] Rely on `.gitignore` for Oxfmt ignores unless formatter behavior needs to be independent from Git.
- [x] Ensure `turbo.json` has no fake outputs for tasks that do not emit files.
- [x] Ensure `build` outputs list only real generated output.
- [x] Ensure `dev` is persistent and uncached.

Verification gate:

- [x] `bun run lint`
- [x] `bun run fmt:check`
- [x] `bun run build`

## Phase 8: Scaffold And Dogfood Apps

Intent: new apps and existing apps use the same conventions.

- [x] Update `create-poggers` template after the package structure changes.
- [x] Ensure generated app scripts match dogfood app scripts.
- [x] Ensure generated app imports only public kit APIs.
- [x] Ensure components remain kebab-case and directly under `src/components`.
- [x] Ensure no event-handler-in-component regressions are introduced.
- [x] Ensure `apps/chat` and `apps/site` still build and typecheck.

Verification gate:

- [x] `rm -rf .app/generated-pristine`
- [x] `bun packages/create-poggers/src/index.js .app/generated-pristine --no-install --force --kit-version file:$PWD/packages/kit`
- [x] `bun install --cwd .app/generated-pristine`
- [x] `bun run typecheck` from `.app/generated-pristine`
- [x] `bun run build` from `.app/generated-pristine`
- [x] `bun run typecheck` from `apps/site`
- [x] `bun run build` via workspace build for `apps/site`
- [x] `bun run typecheck` from `apps/chat`
- [x] `bun run build` via workspace build for `apps/chat`

## Final Verification

- [x] `bun install`
- [x] `bun run check`
- [x] `bun run build`
- [x] Generated app smoke gate passes.
- [x] No dangling empty folders:

```bash
find . -type d -empty \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './.turbo/*' \
  -not -path './.cache/*'
```

- [x] No generated app/build output remains after cleanup:

```bash
find apps packages -path '*/.app' -type d -print -o -path '*/dist' -type d -print
```

- [x] Source scan is clean:

```bash
rg -n "lmdb|createLocalStore|ServerAdapter|single-node|@poggers/kit/react|app-types|packages/kit/types|packages/kit/tests|^tests/" packages apps docs package.json turbo.json
```

Any remaining hit must be intentional and documented.

## Completion Criteria

- [x] Repository structure matches the target shape or every deviation is documented.
- [x] The number of top-level kit source concepts is lower than before.
- [x] Test files are reduced to a product-surface set.
- [x] Typechecking is app-aware and does not produce false root-project errors.
- [x] Package metadata exposes only supported commands and supported public APIs.
- [x] All final verification gates pass.
