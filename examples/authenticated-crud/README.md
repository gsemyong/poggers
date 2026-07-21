# Authenticated, event-sourced CRUD

This example composes three vertical slices without application dependency plumbing:

- `identity.tsx` instantiates the reusable identity factory;
- `tasks.tsx` instantiates the reusable entity factory and adds its browser UI;
- `shell.tsx` composes the feature Components;
- `app.tsx` only names the product and composes Features and Presentations.

The selected web and server adapters create their host Capability scopes automatically. Identity
owns its authentication protocol, entity owns its CRUD protocol, and the application contains no
HTTP client, route handler, credentials, database, or profile module.

Run it with `nub run dev:crud`, then open `http://localhost:3000`. Development data is retained in
`.data/application.sqlite` and the server listens at `http://localhost:3010`.

Build and run the complete production application with:

```sh
nub src/cli.ts build --dir examples/authenticated-crud
cd examples/authenticated-crud
PORT=3000 \
POGGERS_DATABASE="$PWD/.data/production.sqlite" \
POGGERS_WEB_ROOT="$PWD/dist/web" \
./dist/server/api
```

Open `http://localhost:3000`. `dist/server/api` is a standalone native executable; it serves the
built browser assets and renders its deterministic initial-state document in Rust when
`POGGERS_WEB_ROOT` is set; otherwise it exposes only the API. The browser reactivates the server
nodes in place. Authenticated request-data SSR is intentionally not claimed yet. A CDN or reverse
proxy may serve `dist/web` instead, provided same-origin `/api` requests reach the native Program.

## Semantic model

One generic model supplies all domain types. The implementation fills only domain behavior:

```ts
export type Tasks = EntityModel<{
  Name: "tasks";
  Principal: User;
  Value: Task;
  Create: Readonly<{ title: string }>;
  Update: Readonly<{ title?: string; completed?: boolean }>;
  Filter: Readonly<{ completed?: boolean }>;
}>;

export const taskEntity = createEntity<Tasks>({
  name: "tasks",
  create: ({ id, principal, input }) => ({
    id,
    ownerId: principal.id,
    title: input.title,
    completed: false,
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
  matches: ({ entity, filter }) =>
    filter.completed === undefined || entity.completed === filter.completed,
});
```

The factory derives synchronous local-first state and actions for UI structure:

```ts
function view({ features: { tasks } }) {
  tasks.entities; // committed state with pending local commands replayed over it
  tasks.revision;
  tasks.synchronization; // signed-out | loading | synchronizing | synchronized | offline
  tasks.mutations; // pending and rejected command lifecycle

  tasks.create({ title: "Ship it" });
  tasks.update({ id, changes: { completed: true } });
  tasks.remove({ id });
}
```

Programs that need cross-Feature communication request the same factory's semantic Capability:

```ts
type TasksApi = EntityApi<Tasks>;

await tasks.list({ completed: false });
await tasks.create({ title: "Ship it" });
```

The factory owns optimistic replay, an IndexedDB outbox, command identity, retries, reconciliation,
and the live server stream. Application UI neither subscribes nor copies entity data into another
state. The server remains authoritative, and transport and persistence stay behind factory and
adapter boundaries.

## Application

```ts
export type App = Readonly<{
  Features: {
    identity: IdentityFeature;
    shell: ShellFeature;
    tasks: TasksFeature;
  };
  Presentations: "clean";
}>;

export default {
  metadata: { name: "Poggers Operations" },
  features: { identity, shell, tasks },
  presentations: { clean },
} satisfies Application<App>;
```

The task Feature owns navigation beneath `/tasks`, including deep links and history changes. The
shell only mounts `<Tasks.Admin />`.

## Verification

- factory tests use the semantic entity fixture without HTTP or credential setup;
- type tests prove exact API inference and reject invalid models and calls;
- the application test runs Better Auth, HTTP, SQLite persistence, live updates, authorization
  isolation, malformed credentials, restart recovery, and sign-out against both JavaScript
  development and native production;
- the factory test loses a response after a successful commit, restores the pending command from
  local storage, retries it, and proves the server appends exactly one event;
- adapter tests prove one host scope per Process instance and exact cleanup.

Better Auth is the private development implementation of the identity contract. Native production
implements the same product-facing HTTP and session semantics without embedding JavaScript. Their
private authentication tables and password formats are intentionally not a migration contract;
moving existing production identity data between implementations requires an explicit identity
adapter migration rather than direct database reuse.
