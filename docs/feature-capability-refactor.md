# Feature and Capability Refactor

## Status

This document is the source of truth for the refactor. A checked item has passed its stated
verification gate; it is not merely implemented.

## Goal

Make Poggers a small contract-first product language with four authored concepts:

- **Application** composes Features.
- **Feature** is a reusable vertical slice that may contribute Programs, Components, and
  Capabilities.
- **Program** is application logic that runs in one declared execution context.
- **Capability** is the typed boundary through which a Program observes or changes anything
  outside its own pure state and logic.

The implementation must make the correct ownership natural:

- A Feature declares capability requirements and capability providers.
- A Feature does not choose shared infrastructure.
- The Application selects each external capability implementation once for each Program and
  build profile.
- One Process receives one capability graph and owns its resources exactly once.
- Features coordinate through semantic capabilities. UI composition may reference Components;
  it must not become a second service locator.
- A reusable factory produces an ordinary Feature. It cannot introduce another lifecycle,
  dependency-injection model, or transport model.

The authenticated CRUD example is the proof: identity and tasks are separate Features; tasks are
durably event sourced; the browser receives real-time updates; the administration UI is mountable
under typed URL navigation; and all infrastructure can be replaced in tests.

## Non-goals

- Implementing a Rust backend in this refactor.
- Inventing a mandatory network protocol for every application.
- Making infrastructure libraries part of feature contracts.
- Adding aliases such as service, port, dependency, provider, binding, and adapter for the same
  Capability concept.
- Hiding arbitrary TypeScript behind an IR that falsely claims to be portable.

## Architectural invariants

### One vocabulary

| Meaning                               | Name        | Not another authored concept |
| ------------------------------------- | ----------- | ---------------------------- |
| Product                               | Application | container, module graph      |
| Reusable vertical slice               | Feature     | module, plugin               |
| Executing logic                       | Program     | worker, service, activity    |
| External or cross-feature interface   | Capability  | port, dependency, service    |
| Running Program instance              | Process     | runtime definition           |
| Technical realization of a Program/UI | Adapter     | feature implementation       |

Build profile (`development` or `production`) is selection data, not a new product concept.
Execution context remains type information on a Program. It is not a folder hierarchy or an
application-level service locator.

### Capability ownership

For a named Program, let:

- `required` be the union of Capabilities required by all Feature contributions;
- `provided` be the union of Capabilities provided by Feature contributions;
- `external` be `required` minus `provided`.

The Application must supply exactly `external`, once. The runtime must reject:

- a missing external Capability;
- multiple Features providing the same Capability;
- an external implementation shadowing a Feature-provided Capability;
- a provider cycle;
- incompatible Program execution contexts under one Program name.

The runtime starts providers in dependency order, then dependants. It disposes in reverse order.
An external resource and a Feature-provided resource are each adopted exactly once.

### Communication

- Same Process: a required Capability receives the exact object provided by another Feature.
- Different Process: a capability implementation may be a generated or handwritten proxy. The
  product code sees the same semantic contract.
- Tests: a capability implementation may be an in-memory deterministic model.
- Development and production: each profile implements the same inferred external contract.

Transport, persistence, Better Auth, SQLite, HTTP, and future Rust implementations do not occur in
the semantic Feature contract.

### Portability

The compiler must preserve:

- Application and Feature composition;
- Program placement;
- required and provided Capability signatures;
- serializable domain contracts used by a recognized feature factory;
- factory behavior that is genuinely represented in semantic IR.

Opaque JavaScript remains executable in JavaScript development, but is explicitly marked opaque.
The compiler must never emit an apparently portable artifact after silently dropping behavior.

## Target authoring surface

Capability contracts are ordinary TypeScript types. There is no `defineCapability` wrapper.

```ts
type Authentication = Readonly<{
  session(input: { headers: Headers }): Promise<Session | undefined>;
}>;

type EventStore<Event> = Readonly<{
  read(input: { stream: string; after?: number }): Promise<readonly StoredEvent<Event>[]>;
  append(input: {
    stream: string;
    expectedRevision: number;
    events: readonly Event[];
  }): Promise<readonly StoredEvent<Event>[]>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent<Event>>;
}>;
```

A Feature contract describes meaning. Its implementation fills the corresponding lowercase
fields and uses `satisfies Feature<Contract, App>`.

```tsx
type Tasks = {
  Name: "tasks";
  Credentials: CookieCredentials;
  Principal: User;
  Entity: Task;
  Create: { title: string };
  Update: { title?: string; completed?: boolean };
  Query: { completed?: boolean };
};

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
});
```

The factory generates ordinary Program requirements/providers and a typed public API. Its input is
domain implementation only: no database, HTTP route, Better Auth instance, or lifecycle hook.

Application Features are flat and application composition is explicit:

```tsx
export type App = Readonly<{
  Features: {
    identity: Identity;
    tasks: Tasks;
    shell: Shell;
  };
}>;

export const app = {
  metadata: { name: "Operations" },
  features: { identity, tasks, shell },
  presentations: { clean },
} satisfies Application<App>;
```

External implementations are selected once per Program. The plain object is checked against the
contract inferred from the complete Application:

```ts
export default {
  development() {
    const database = openDevelopmentDatabase();
    return {
      authentication: createBetterAuthCapability(database),
      events: createSqliteEventStore(database),
      clock: systemClock,
      identifiers: randomIdentifiers,
    };
  },
  production() {
    return createProductionCapabilities();
  },
} satisfies ProgramCapabilities<App, "server">;
```

The function boundary is required because a Process owns live resources. It is not a factory for
each Feature: it is called once for the Program instance.

Feature-provided Capabilities remain inside the Feature implementation:

```ts
const identity = {
  programs: {
    server: {
      start({ capabilities }) {
        return { identity: createIdentity(capabilities.authentication) };
      },
    },
  },
} satisfies Feature<Identity, App>;
```

Navigation is semantic Feature state exposed through a typed capability. A web binding may encode
the same destination as a path, search parameter, or local state. The tasks administration UI owns
`list | create | edit(id)`; its mount chooses the URL mapping without changing tasks behavior.

## Target repository structure

```text
src/
  core/
    application.ts
    capability.ts
    component.ts
    development.ts
    presentation.ts
    process.ts
    state.ts
    ui.ts
    compiler/
    jsx/
  features/
    entity/
      feature.ts
      feature.spec.ts
      testing.ts
  contracts/
    platform.ts
  adapters/
    registry.ts
    server/
    web/
  cli.ts
  cli.spec.ts
  index.ts
```

`core/capability.ts` owns capability typing because Capability composition is part of the core
product model. `contracts/platform.ts` remains a technical adapter contract. Reusable feature
factories live under `features`; they depend only on core contracts.

```text
examples/authenticated-crud/
  README.md
  tsconfig.json
  src/
    app.tsx
    app.spec.ts
    capabilities/
      browser.ts
      server.ts
    features/
      identity.tsx
      identity.spec.ts
      tasks.tsx
      tasks.spec.ts
      shell.tsx
    presentations/
      clean.ts
```

Files in `capabilities/` are Program composition boundaries and are loaded only for their target.
They are not called adapters. Better Auth and SQLite belong there because they implement semantic
Capabilities for this application. A reusable implementation may later move into the kit without
changing the Feature contract.

## Execution plan

### 1. Freeze the contract

- [x] Add type-level derivation of required, provided, and external Capabilities per Program.
- [x] Add `ProgramCapabilities<Application, ProgramName>` with `development` and `production`
      implementations of the same inferred contract.
- [x] Permit Feature definitions to be checked with awareness of the complete Application without
      weakening their own contract.
- [x] Add compile-time fixtures for missing, incompatible, unknown, and satisfied capabilities;
      verify exact excess rejection at the runtime boundary because TypeScript is structurally
      typed across function returns.

Gate: TypeScript accepts complete, compatible Program capability implementations and preserves
Feature factory inference without explicit casts; runtime validation rejects missing and excess
keys before user code starts.

### 2. Make Process ownership correct

- [x] Replace contribution-level `CapabilityResolver` with one Program capability object.
- [x] Build and validate the Feature provider dependency graph before starting any contribution.
- [x] Start in topological order and dispose in exact reverse order.
- [x] Adopt shared external resources once and provider results once.
- [x] Produce actionable errors for missing, duplicate, shadowed, cyclic, and failed providers.
- [x] Keep UI action batching and reactive state lifecycle intact.

Gate: focused unit and property tests prove deterministic ordering, exact-once construction and
disposal, failure rollback, cycle diagnostics, and permutation invariance.

### 3. Align adapters and compiler

- [x] Load `src/capabilities/<program>.ts` instead of app-local adapter files.
- [x] Start development with `development()` and generated production entries with `production()`.
- [x] Keep application capability modules out of unrelated browser/server bundles.
- [x] Preserve factory capability contracts structurally in IR; mark implementation code as
      portable or source-backed instead of adding compiler knowledge of individual factories.
- [x] Update CLI diagnostics and documentation to use the settled vocabulary.

Gate: development starts both Programs, production build emits runnable target entries, and source
IR retains the factory contract and behavior rather than silently omitting it.

### 4. Build the reusable entity Feature

- [x] Move the generic entity contract/factory/testing model into `src/features/entity`.
- [x] Keep domain command decisions separate from pure event replay inside the factory.
- [x] Require identity, event persistence, clock, and identifier Capabilities semantically.
- [x] Provide a typed entity API with reads, commands, and a cancellable real-time stream.
- [x] Supply a deterministic testing harness owned by the factory.
- [x] Test authorization, optimistic revision conflicts, replay equivalence, event ordering,
      subscription cleanup, and invalid commands with generated cases.

Gate: the same feature definition passes model tests and runs against memory and SQLite capability
implementations without feature changes.

### 5. Rebuild the authenticated CRUD example

- [x] Make identity, tasks, and shell flat, separate Features.
- [x] Keep Better Auth behind the authentication Capability.
- [x] Replace memory CRUD persistence with a durable SQLite event store and restart recovery test.
- [x] Implement cross-Program task and identity proxies as browser Capabilities without leaking HTTP
      into Features.
- [x] Add typed, mountable URL navigation with deep-link and browser history behavior.
- [x] Reorganize files exactly as the target tree and remove obsolete blobs and duplicate helpers.
- [x] Build a quiet, responsive administration workspace with complete empty, loading, error,
      create, edit, delete, authenticated, and unauthenticated states.

Gate: a real server/browser test signs up, signs in, creates/updates/deletes tasks, observes a live
update, reloads from persistence, deep-links to edit, navigates back, and signs out.

### 6. Final verification and cleanup

- [x] Remove obsolete resolver exports, compatibility paths, dead tests, and stale documentation.
- [x] Run formatting, lint, type checking, focused tests, complete tests, and production build.
- [x] Inspect development and production dependency graphs for target leakage.
- [x] Dogfood desktop and mobile layouts in a browser and capture screenshots.
- [x] Re-read the public exports and repository tree against this document.

Gate: `nub run check` and the production build pass; browser E2E passes without console errors;
the example contains no app-specific infrastructure in Feature files; every exported concept maps
to one architectural responsibility.

## Completion criteria

This plan is complete only when all gates above pass. A visually running demo is insufficient, as
is a type-only facade over the old resolver. The final report must state any remaining production
limitation plainly, particularly unsupported Rust lowering or a handwritten cross-Program proxy.
