# Data Feature

`createData` packages an authorized entity log and a typed local query
projection behind one semantic Dependency. Product code describes records,
mutations, indexes, and searchable text. Platform Adapters supply storage.

## Define

```ts
import { createData, type DataModel } from "kit";

type Principal = Readonly<{ id: string }>;

type Notes = DataModel<{
  Name: "notes";
  Principal: Principal;
  Record: {
    id: string;
    owner: string;
    title: string;
    body: string;
    archived: boolean;
  };
  Create: { title: string; body: string };
  Update: { title?: string; body?: string; archived?: boolean };
}>;

export const notes = createData<Notes>({
  name: "notes",
  indexes: ["owner", "archived"],
  search: ["title", "body"],
  create: ({ id, principal, input }) => ({
    id,
    owner: principal.id,
    ...input,
    archived: false,
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, record }) => record.owner === principal.id,
});
```

`search` accepts only string fields. `indexes`, query conditions, ordering,
creates, and updates are checked against the model.

The result contains two Features:

```ts
notes.server;
notes.browser;
```

Compose them into the matching server and browser branches of a reusable
Feature. Both provide a Dependency named by `Name`, here `notes`.

## Use

Server code receives the established principal explicitly:

```ts
const current = await dependencies.notes.query({
  principal,
  query: {
    where: { archived: false },
    order: [{ field: "title", direction: "ascending" }],
  },
});
```

The browser Dependency is already bound to its authenticated principal:

```ts
await dependencies.notes.create({
  title: "Projection boundaries",
  body: "The event log remains authoritative.",
});

const matches = await dependencies.notes.search({
  text: "event log",
  where: { archived: false },
  limit: 20,
});
```

Use `watch` or `watchSearch` in a browser Program to maintain UI state. A
Component never awaits Data during rendering:

```ts
for await (const snapshot of dependencies.notes.watch({
  where: { archived: false },
})) {
  state.notes = snapshot.records;
}
```

UI actions call a synchronous Program action. That action starts the async
mutation; the private Entity source publishes its optimistic snapshot
immediately and reconciles if the server rejects it.

## Semantics

The private Entity Feature is authoritative:

- accepted mutations append events;
- browser mutations are optimistic;
- expected revisions reject conflicting authoritative writes;
- authorization runs on the server;
- rejection restores the authoritative result without dropping later intent.

The Data store is a projection:

- each principal has a distinct server collection;
- a browser database contains only the browser principal's visible snapshot;
- projection revisions are monotonic;
- replacing the same revision is a no-op;
- query streams suppress unchanged results;
- deleting the projection does not delete authoritative history.

The current implementation replaces the complete visible projection when the
source revision advances. It does not use Turso Cloud synchronization.

## Realizations

Development uses the embedded `@tursodatabase/database` engine. The browser
realization uses its WASM build and OPFS; the server uses a local database file.
Generated production Programs use the native Rust Turso Dependency.

The web adapter detects a linked `dataStore` Dependency and emits COOP/COEP
headers in development and production. This makes `SharedArrayBuffer` available
for Turso's threaded WASM. A custom web host must preserve those headers.

Configure the server database path with `KIT_DATA_DATABASE`. Tests can use
`createDataBrowserFixture` or `createMemoryDataStore` from `kit/testing`.

## Limits

- Search matches are deterministic, but `score` is not yet a portable relevance
  ranking guarantee.
- Incremental projection updates, schema migrations, and event upcasters remain
  future work.
- Physical cross-device Turso push/pull is intentionally not part of this
  Feature. Entity owns synchronization, identity, authorization, and rejection.
