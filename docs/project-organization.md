# Feature composition and project organization

## Goal

Poggers applications describe products with three author-facing concepts:

- **Program** is executable logic for one named execution target.
- **Capability** is a typed API required or provided by a Program.
- **Feature** is a vertical slice that co-locates its Program contributions, semantic Capability
  implementations, state, actions, Components, and specialized testing support.

An Application composes Feature instances and Presentations. It does not implement or manually wire
Capabilities. A Platform Adapter realizes each compiled Program instance and supplies only the
irreducible authority of its host environment.

```text
Application source
`- Features
   `- Program contributions
      |- require typed Capabilities
      `- provide typed semantic Capabilities

Compiled Program
`- one contribution from every participating Feature

Program instance / replica
|- one adapter-provided host Capability scope
|- one instance of each Feature-provided Capability
`- all contributions wired in dependency order
```

Static Feature composition selects one logical provider definition. It does not imply one global
runtime object. Every replica of a compiled Program receives its own Capability scope. A local
binding may itself address shared or distributed infrastructure.

## Application convention

Every application uses the same source shape:

```text
src/
  app.tsx
  app.spec.ts
  features/
    identity.tsx
    identity.spec.ts
    tasks.tsx
    tasks.spec.ts
  presentations/
    clean.ts
    clean.spec.ts
    assets/
```

Only `app.tsx`, `features/`, and `presentations/` are structural concepts. Tests and assets exist
only when needed. Applications do not contain a `capabilities/` directory.

- `app.tsx` composes Feature instances and Presentations and declares product metadata.
- `features/<name>.tsx` contains one application-owned vertical slice or instantiates one reusable
  semantic Feature factory.
- `features/<name>.spec.ts` tests that Feature through its semantic API or its factory-provided test
  fixture.
- `presentations/<name>.ts` contains one complete platform-specific Presentation.
- `app.spec.ts` verifies application composition and selected real adapters end to end.

Files remain stem-based rather than moving into size-dependent subdirectories. Complexity should
first be removed into a reusable semantic Feature factory.

## Capability ownership

Capabilities are plain typed APIs. There is no application Capability registration API and no
Capability implementation module.

There are exactly two provider origins:

1. **Platform providers** grant host authority such as network access, persistence backends, time,
   randomness, DOM, browser history, authentication backends, or operating-system APIs.
2. **Feature providers** use host or other semantic Capabilities to provide product-facing APIs such
   as storage, HTTP routing, identity, entities, workflows, or search.

The compiler combines every same-named Feature Program contribution, derives its dependency graph,
and verifies that each requirement has one compatible logical provider. At instance startup, the
selected Platform Adapter creates host bindings once for that Program instance. The runtime then
starts Feature providers in dependency order and shares each local binding with every consumer in
the instance. Disposal follows the reverse order.

If an implementation is private to one Feature, it remains ordinary private code. If several
Features consume it, it becomes a semantic Capability provided by its own Feature. Applications
select provider Features; they never construct their implementation objects.

## Semantic Feature factories

Core `Program`, `Capability`, and `Feature` contracts are the lowering target for factory authors.
Application authors should normally use a factory's domain language.

Every reusable factory follows one conceptual shape:

```text
Semantic type helper
`- validates one domain definition
   |- derives the public semantic API
   |- derives Program requirements and provisions
   |- derives Components when the factory owns UI
   `- derives a specialized testing surface

create<Meaning>(implementation)
`- returns one ordinary typed Feature
```

For example, the entity factory should expose a validated semantic model and derive its complete
API without duplicated interfaces:

```ts
type Tasks = EntityModel<{
  Name: "tasks";
  Principal: User;
  Value: Task;
  Create: { title: string };
  Update: { title?: string; completed?: boolean };
  Filter: { completed?: boolean };
}>;

const tasks = createEntity<Tasks>({
  name: "tasks",
  create({ id, principal, input }) {
    return { id, ownerId: principal.id, title: input.title, completed: false };
  },
  update({ previous, input }) {
    return { ...previous, ...input };
  },
  authorize({ principal, entity }) {
    return principal.id === entity.ownerId;
  },
});
```

When a factory owns client state, Components consume it through the child Feature API. For the
entity factory this is `features.tasks.entities`, `features.tasks.synchronization`, and synchronous
`features.tasks.create/update/remove` actions. The factory owns persistence, optimistic replay,
reconciliation, retries, and subscriptions; parent Features do not mirror that state or mount
transport loops.

The public definition must not contain HTTP paths, Requests, credentials extracted from Requests,
serialization, database construction, or adapter configuration. Those are implementation details
owned by the factory's Program contributions and provider Features.

The package uses one semantic stem per factory:

```text
src/features/
  entity.ts
  entity.spec.ts
  entity.testing.ts
  identity.ts
  identity.spec.ts
  workflows.ts
  workflows.spec.ts
  workflows.testing.ts
```

- `<name>.ts` contains the semantic type helper, derived API types, factory input, factory, and
  private lowering implementation.
- `<name>.spec.ts` tests type-independent semantics, lowering, lifecycle, and difficult runtime
  behavior.
- `<name>.testing.ts` exists only for a public, domain-specific testing API.
- `<name>.typecheck.ts` exists only when a positive or negative invariant cannot be demonstrated by
  ordinary TypeScript compilation of a spec.
- Files are not mechanically split into `types`, `factory`, `runtime`, and `helpers`.

## Type-safety gates

Every semantic factory enforces three layers from one domain definition:

1. **Definition validity** rejects malformed domain meaning while preserving literal identities.
2. **Implementation validity** requires complete operations with exact inputs and outputs.
3. **Composition validity** proves every Program requirement has one compatible Feature or Platform
   provider and rejects missing providers, conflicts, and cycles.

The factory may export derived API types for other factory authors, but application consumers should
receive those APIs through inferred Program contexts. No public interface is manually repeated.

## Target package boundaries

```text
src/
  core/          Program, Capability, Feature, Component, Presentation, compiler, runtime
  contracts/     contracts implemented by Platform Adapters
  adapters/      concrete host and UI realizations grouped by Platform
  features/      reusable semantic Feature factories
  index.ts       intentional public surface
```

Platform-specific imports remain under `adapters/<platform>/`. Reusable Features depend on semantic
host contracts, never on a concrete adapter. Application Features import only public package
surfaces.

## Execution plan

- [x] Extend the Platform Adapter contract with a per-Program-instance host Capability provider.
- [x] Make development and production entries obtain host bindings from the selected adapter rather
      than discovering `src/capabilities/<program>.ts`.
- [x] Remove `ProgramCapabilities`, `ProgramCapabilityModule`, and application capability-path
      conventions once no runtime path depends on them.
- [x] Make the Node and web adapters allocate the exact compiler-derived host Capability scope;
      package product-facing providers as reusable semantic Features.
- [x] Keep Better Auth behind the authentication host contract and package its browser/server
      product protocol inside the identity Feature factory.
- [x] Refine entity into the canonical validated semantic model, derived API, provider Feature, and
      specialized fixture without Request, credentials, or route configuration in application code.
- [x] Refactor authenticated CRUD so `app.tsx` only composes Features and Presentations and its
      `src/capabilities/` directory no longer exists.
- [x] Update the template, exports, README, architecture documentation, and examples to show exactly
      one convention.
- [x] Remove superseded helpers, tests, generated residue, and documentation rather than preserving
      compatibility with the rejected structure.
- [x] Verify static contracts, dependency planning, one binding per Program instance, cleanup,
      development, production, persistence, authentication, authorization, subscriptions, and UI.

## Acceptance gates

- [x] `find examples template -path '*/src/capabilities/*'` returns no files.
- [x] `rg 'src/capabilities|resolveProgramCapabilities|resolveCapabilities|ProgramCapabilities' src
examples template` returns no obsolete application realization convention.
- [x] Platform Adapter tests prove a fresh host Capability scope is created and disposed exactly once
      for each Program instance.
- [x] Process tests prove one Feature-provided binding per instance is shared by all local consumers,
      while two instances receive independent bindings.
- [x] Entity type tests reject invalid values and implementations and infer exact semantic client and
      server APIs from one definition.
- [x] The authenticated CRUD source contains no handwritten HTTP client, HTTP handler, credential
      extraction, database construction, or environment profile module.
- [x] Authenticated CRUD proves sign-up, session restoration, authorization isolation, durable entity
      persistence, live updates, restart recovery, and sign-out through public semantic APIs.
- [x] The generated template has only `app.tsx`, `features/`, and `presentations/` as framework source
      concepts and passes typecheck, tests, development startup, and production build.
- [x] `nub run check` and `nub run build` pass.
- [x] Both examples pass production builds, and browser E2E reports no runtime errors.
