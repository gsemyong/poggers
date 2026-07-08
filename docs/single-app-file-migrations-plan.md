# Single App File And Migration Convention Plan

## Goal

Adopt one app authoring convention:

- `src/types.ts` is the latest typed contract.
- `src/app.ts` is the current app implementation and includes config, resources, semantic component behavior, styles, programs, and the root UI function reference.
- `src/deps.ts` is the only separate app source entrypoint for dependency provider config, because production adapters pull heavy third-party SDK types and must stay out of app/UI IntelliSense.
- `src/ui/` contains actual JSX screens and widgets.
- `src/deps.ts` contains dependency implementations and provider config.
- `src/migrations/` contains reviewed migration edges and generated snapshots only when persisted app shape changes.

There must be one documented path for new apps. Compatibility paths can remain in the runtime while existing users migrate, but they must not appear in templates or primary docs.

## Source Inspiration

Jazz's migration model has three useful ideas to adopt:

- Current schema is the source of truth; old schemas are stored as snapshots.
- Migration files are reviewed edges between two structural schema versions.
- Data is interpreted through a migration chain rather than relying on manual version folders.

References:

- https://jazz.tools/docs/schemas/migrations
- https://jazz.tools/docs/schemas/defining-tables
- https://jazz.tools/docs/concepts/branches

## Target App Shape

```text
src/
  types.ts
  app.ts
  deps.ts

  ui/
    root.tsx
    chat-screen.tsx
    message.tsx
    part-list.tsx

  lib/
    ai.ts

  migrations/
    snapshots/
      <hash>.ts
    <date>-<name>-<fromHash>-<toHash>.ts
```

Small apps still use the same shape. If there are no migrations, `src/migrations/` does not exist.

## Target Authoring Surface

`src/app.ts` is the single current app definition:

```ts
import type { AppDefinition } from "@poggers/app";
import { Root } from "ui/root";

export default {
  version: 1,

  app: {
    name: "Poggers Chat",
  },

  pwa: {
    name: "Poggers Chat",
    shortName: "Chat",
    themeColor: "#22252a",
    backgroundColor: "#f7f3ea",
    display: "standalone",
  },

  resources: {
    chat: {
      state: {},
      events: {},
      views: {},
      commands: {},
    },
  },

  components: {
    ChatLayout() {
      return {};
    },
  },

  styles: {
    defaultPreset: "paper",
    presets: {
      paper: {},
    },
  },

  programs: {
    async server(ctx, deps) {},
  },

  root: Root,
} satisfies AppDefinition;
```

`src/deps.ts` stays separate and uses the package dependency-config type plus the app's dependency contract:

```ts
import type { DependencyConfig } from "@poggers/kit/deps";
import type { ServerDeps } from "./types";

const productionClock: ServerDeps["clock"] = { now: () => Date.now() };
const mockClock: ServerDeps["clock"] = { now: () => 0 };

export default {
  clock: {
    production: productionClock,
    mock: mockClock,
  },
} satisfies DependencyConfig<ServerDeps>;
```

## Migration Convention

Current version:

- `src/types.ts`
- `src/app.ts`

Historical versions:

- generated snapshots under `src/migrations/snapshots/`
- reviewed migration edges under `src/migrations/`

No version folders. No manual `previous: v1`. No app assembly files.

Example migration edge:

```ts
import type { Migration } from "@poggers/app";
import type { App as From } from "./snapshots/a1b2c3";
import type { App as To } from "./snapshots/d4e5f6";

export default {
  from: "a1b2c3",
  to: "d4e5f6",
  migrate: {
    chat: {
      state(old) {
        return {
          ...old,
          understanding: null,
        };
      },
      event(name, payload) {
        return { name, payload };
      },
    },
  },
} satisfies Migration<From, To>;
```

The migration type must make the previous and next shapes visible:

- `state(old)` receives the previous resource state and must return the next resource state.
- `event(name, payload)` receives previous event names and payloads and must return a next event name and payload.
- Dropped fields require explicit decisions.
- Renames require explicit decisions.
- Generated draft migrations must fail `poggers typecheck` or `poggers migrations check` until reviewed.

## Phase 0: Baseline And Guardrails

- [x] Confirm the current dirty worktree and classify existing unrelated changes.
- [x] Run baseline gates:
  - [x] `bun run check`
  - [x] `bun run build`
  - [x] `bunx tsc --noEmit --extendedDiagnostics -p apps/chat/tsconfig.json`
  - [x] `bunx tsc --noEmit --extendedDiagnostics -p apps/site/tsconfig.json`
- [x] Record app diagnostics before migration work.
- [x] Confirm generated `.poggers` files are ignored and app-local declaration files are not tracked.

Verification gate:

- [x] Baseline failures, if any, are written down before edits continue.
- [x] App IntelliSense instantiations are known before changing the app shape.

## Phase 1: One App File Convention

Intent: make `src/app.ts` the single current app definition.

- [x] Extend generated `AppDefinition` to include optional `styles`.
- [x] Make runtime style compilation read `app.styles` when `src/styles.ts` is absent.
- [x] Make generated `@poggers/app` browser module use `app.styles` when no separate style file exists.
- [x] Keep `src/styles.ts` as a compatibility loader only, not as the template or dogfood convention.
- [x] Move chat styles into `apps/chat/src/app.ts`.
- [x] Move site styles into `apps/site/src/app.ts`.
- [x] Delete dogfood `src/styles.ts` files.
- [x] Update `create-poggers` to generate styles inside `src/app.ts`.
- [x] Update runtime tests to cover an app with only `types.ts`, `app.ts`, `deps.ts`, and `ui/`.

Verification gate:

- [x] `rg -n "src/styles\\.ts|defineStyles|StyleDefinition" apps packages/create-poggers/src docs/architecture.md docs/app-conventions-pwa-plan.md` has no primary-convention references.
- [x] `bun run check`
- [x] `bun run build`
- [x] app diagnostics do not regress beyond the agreed budget.

## Phase 2: Rename Visual JSX Area To `ui`

Intent: make the language clear.

- [x] Move `apps/chat/src/components/*` to `apps/chat/src/ui/*`.
- [x] Move `apps/site/src/components/*` to `apps/site/src/ui/*`.
- [x] Keep semantic component definitions inside `app.ts.components`.
- [x] Update convention linting:
  - [x] `src/ui` files must be kebab-case.
  - [x] nested `src/ui` folders are flagged unless explicitly allowed by a future convention.
  - [x] raw styling bans apply to `src/ui/**/*.tsx`.
- [x] Update generated template to use `src/ui`.
- [x] Update docs to say `ui/` is actual JSX and `app.ts.components` is semantic behavior.

Verification gate:

- [x] `find apps -path '*/src/components/*' -print` is empty for dogfood apps.
- [x] `find apps -path '*/src/ui/*' -print` shows the dogfood UI modules.
- [x] `bun run check`
- [x] `bun run build`

## Phase 3: Migration Type Surface

Intent: add type-safe migration edge definitions without requiring app authors to write version folders.

- [x] Add generated/public migration helper types:
  - [x] `Migration<From, To>`
  - [x] `ResourceState<Spec, Resource>`
  - [x] `ResourceEventName<Spec, Resource>`
  - [x] `ResourceEventPayload<Spec, Resource, Event>`
  - [x] `MigratedEvent<Spec, Resource>`
- [x] Generate those helpers into `.poggers/types/app.d.ts`.
- [x] Ensure migration helper types do not expand into app/UI authoring hovers.
- [x] Add unit typecheck fixtures for:
  - [x] state migration from old shape to new shape
  - [x] event rename
  - [x] event payload expansion
  - [x] invalid returned state fails
  - [x] invalid returned event fails

Verification gate:

- [x] targeted migration typecheck fixtures fail before correction and pass after correction.
- [x] app diagnostics remain below budget.
- [x] `bun run check`

## Phase 4: Structural Snapshots And Hashing

Intent: make old versions addressable without manual naming.

- [x] Implement a structural snapshot generator from `src/types.ts`.
- [x] Normalize the structural snapshot before hashing so formatting changes do not change the hash.
- [x] Write snapshots to `src/migrations/snapshots/<hash>.ts`.
- [x] Snapshot files export:
  - [x] `export type App = ...`
  - [x] `export const hash = "<hash>"`
- [x] Store the current structural hash in generated app types.
- [x] Add a CLI command:
  - [x] `poggers migrations snapshot`
- [x] Add tests proving equivalent formatting produces the same hash.
- [x] Add tests proving real structural changes produce a new hash.

Verification gate:

- [x] `poggers migrations snapshot` creates exactly one snapshot for the current contract in the temp migration fixture; dogfood apps intentionally do not get migrations without a real persisted shape change.
- [x] rerunning the command without structural changes is idempotent.
- [x] `bun test packages/kit/tests/migrations.spec.ts`
- [x] `bun run check`

## Phase 5: Migration Creation Workflow

Intent: give app authors a Jazz-like migration workflow.

- [x] Add CLI command:
  - [x] `poggers migrations create <name>`
- [x] The command finds the latest local snapshot and compares it to the current structural hash.
- [x] If there is no latest snapshot, it creates the initial snapshot and no migration edge.
- [x] If the hash changed, it creates:
  - [x] a new snapshot
  - [x] a migration stub named `<date>-<name>-<fromHash>-<toHash>.ts`
- [x] The stub imports `From` and `To` snapshot types.
- [x] The stub is marked as draft until reviewed.
- [x] `poggers typecheck` fails on draft migrations.
- [x] Add helpful messages for:
  - [x] no structural change
  - [x] missing initial snapshot
  - [x] migration already exists
  - [x] ambiguous structural change

Verification gate:

- [x] create initial snapshot for a temp app.
- [x] change `types.ts`, run migration creation, and inspect generated edge.
- [x] draft edge fails the migration check.
- [x] reviewed edge passes after replacing draft marker.
- [x] `bun run check`

## Phase 6: Runtime Migration Chain

Intent: replace manual `previous` app chains with convention-loaded migration edges.

- [x] Load migration edges from `src/migrations/` by convention.
- [x] Generate a `.poggers/migrations.generated.ts` registry for build-safe imports.
- [x] Build a directed graph from `from` to `to`.
- [x] Resolve a path from stored snapshot/event hash to current hash.
- [x] Apply state migrations in order when restoring snapshots.
- [x] Apply event migrations in order before event replay/handler matching.
- [x] Keep numeric `version` compatibility during the transition.
- [x] Store structural hash in new snapshots and events.
- [x] Read old numeric-version data through the old path until existing tests are migrated.
- [x] Fail loudly when persisted data has no migration path to the current hash.

Verification gate:

- [x] unit test single-hop state migration.
- [x] unit test multi-hop state migration.
- [x] unit test event rename migration.
- [x] unit test missing path error.
- [x] integration test app restart with old snapshot migrated to current.
- [x] integration test old event log upcast before replay.
- [x] `bun run check`
- [x] `bun run build`

## Phase 7: TypeScript Performance Boundary

Intent: migration history must not poison app/UI IntelliSense.

- [x] Exclude `src/migrations/**/*.ts` from the default app TS project.
- [x] Keep `src/deps.ts` excluded from the default app TS project.
- [x] Add a separate generated migration typecheck project under `.poggers/typecheck.migrations.tsconfig.json`.
- [x] Make `poggers typecheck` run:
  - [x] app/UI project
  - [x] deps project
  - [x] migrations project
- [x] Record diagnostics before and after adding migration files.

Verification gate:

- [x] chat app diagnostics remain near the current low-instantiation baseline.
- [x] site app diagnostics remain near the current low-instantiation baseline.
- [x] migration type errors are still caught by `poggers typecheck`.
- [x] `bun run check`

## Phase 8: Dogfood Migration

Intent: prove the convention with the real apps.

- [x] Migrate chat to:
  - [x] `src/types.ts`
  - [x] `src/app.ts`
  - [x] `src/deps.ts`
  - [x] `src/ui/`
- [x] Migrate site to:
  - [x] `src/types.ts`
  - [x] `src/app.ts`
  - [x] `src/ui/`
- [x] Remove dogfood `src/styles.ts`.
- [x] Add at least one migration fixture app under tests to exercise old data.
- [x] Do not invent dogfood migrations unless a real persisted shape change exists.

Verification gate:

- [x] dogfood apps build and typecheck.
- [x] generated template app typechecks and builds.
- [x] migration fixture proves old data reads through a reviewed edge.
- [x] no empty directories remain.
- [x] `bun run check`
- [x] `bun run build`

## Phase 9: Docs And Template Cleanup

Intent: remove all conflicting public guidance.

- [x] Update architecture docs with the single convention.
- [x] Update create app docs/template.
- [x] Update testing docs with migration fixture guidance.
- [x] Mark `defineApp`, `defineStyles`, `src/styles.ts`, and manual `previous` chains as compatibility/legacy.
- [x] Remove primary docs that suggest config/resources/styles split files.
- [x] Add a migration workflow guide:
  - [x] edit `types.ts`
  - [x] update `app.ts`
  - [x] run `poggers migrations create <name>`
  - [x] review the generated edge
  - [x] run `poggers typecheck`

Verification gate:

- [x] `rg -n "config\\.ts|resources\\.ts|components\\.ts|src/styles\\.ts|previous:|defineApp<|defineStyles<" docs packages/create-poggers/src apps` only finds compatibility notes or historical plans.
- [x] `bun run fmt:check`
- [x] `bun run check`

## Final Acceptance Gates

- [x] New apps generated by `create-poggers` use the single convention.
- [x] Dogfood apps use the single convention.
- [x] `src/app.ts` can contain resources, semantic components, styles, programs, and the root UI function reference.
- [x] `src/deps.ts` stays separately typechecked.
- [x] `src/ui` is the only dogfood location for actual JSX UI modules.
- [x] Migration snapshots are hash-addressed.
- [x] Migration edges are type-safe from previous snapshot type to next snapshot type.
- [x] Missing migration paths fail with a useful message.
- [x] Draft migrations fail until reviewed.
- [x] Runtime migrates old snapshots.
- [x] Runtime upcasts old events.
- [x] Main app/UI IntelliSense performance remains pristine.
- [x] `bun run check`
- [x] `bun run build`
- [x] `bunx tsc --noEmit --extendedDiagnostics -p apps/chat/tsconfig.json`
- [x] `bunx tsc --noEmit --extendedDiagnostics -p apps/site/tsconfig.json`
