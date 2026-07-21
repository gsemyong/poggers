# Authenticated, event-sourced CRUD

This example proves the complete Feature and Capability convention with a real browser and server:

- `identity.tsx` adapts an external authentication Capability into the semantic identity Capability;
- `tasks.tsx` instantiates the reusable event-sourced entity Feature and contributes its UI;
- `api.tsx` maps semantic server Capabilities onto HTTP;
- `shell.tsx` composes the browser Components;
- `capabilities/server.ts` selects Better Auth, SQLite, HTTP, identifiers, and time once for the
  server Program;
- `capabilities/browser.ts` selects authentication, task, and URL-navigation clients once for the
  browser Program.

Run it with:

```sh
nub run dev:crud
```

Open `http://localhost:3000`. The server listens at `http://localhost:3010`, and development data
is retained in `.data/application.sqlite`.

## Feature contract

The domain contract is one generic argument. The definition fills only domain behavior:

```ts
export type Tasks = Readonly<{
  Name: "tasks";
  Credentials: CookieCredentials;
  Principal: User;
  Entity: Task;
  Create: Readonly<{ title: string }>;
  Update: Readonly<{ title?: string; completed?: boolean }>;
  Query: Readonly<{ completed?: boolean }>;
}>;

export const createTasks = defineEntityFeature<Tasks>({
  name: "tasks",
  create: ({ id, principal, value }) => ({
    id,
    ownerId: principal.id,
    title: value.title,
    completed: false,
  }),
  update: ({ previous, value }) => ({ ...previous, ...value }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
  matches: ({ entity, query }) =>
    query.completed === undefined || entity.completed === query.completed,
});
```

The factory produces an ordinary server Feature. It requires `identity`, `events`, `identifiers`,
and `clock`, and provides the named `tasks` Capability. The Feature neither imports nor accepts a
database.

## Application composition

Application Features remain flat and explicit:

```ts
export type App = Readonly<{
  Features: {
    api: ApiFeature;
    identity: IdentityFeature;
    shell: ShellFeature;
    tasks: TasksFeature;
  };
  Presentations: "clean";
}>;

export default {
  metadata: { name: "Poggers Operations" },
  features: { api, identity, shell, tasks },
  presentations: { clean },
} satisfies Application<App>;
```

The shell composes `<Tasks.Admin />`. Program behavior coordinates through typed Capabilities, not
through Component references.

## Capability selection

Each Program has one application-owned capability module:

```ts
export default {
  development: () => createServerCapabilities(),
  production: () => createServerCapabilities(productionOptions),
} satisfies ProgramCapabilities<App, "server">;
```

The inferred contract excludes Capabilities supplied by Features. The runtime validates the exact
external set before starting user code, orders Feature providers, and owns every resulting resource
once.

The task UI depends on semantic `tasks` and `navigation` Capabilities. Its destinations are typed as
`list | create | edit(id)`; the browser implementation maps them to `/tasks`, `/tasks/new`, and
`/tasks/:id`, including history navigation and deep links.

## Verification

- `identity.spec.ts` tests the Feature-provided identity Capability in isolation.
- `tasks.spec.ts` tests the generated entity API with the factory-owned deterministic harness.
- `app.spec.ts` runs Better Auth, HTTP, SQLite event persistence, two principals, authorization,
  live updates, restart recovery, and sign-out end to end.
- Core property tests compare generated entity command sequences with a reference model and verify
  capability graph ordering across random permutations.

The compiler preserves all capability signatures. Program code outside the portable subset is
explicitly marked `source` in IR and is supported by the current JavaScript adapters; a future
non-JavaScript backend must either lower it or reject it explicitly.
