# Ideal Development Experience

## Goal

An application describes one product once. The same Feature, Program, Component, Presentation, and
Capability meaning runs through a hot-reloadable development realization and the framework's
optimized production realization. Application source and application tests do not select, import,
or orchestrate either backend.

## Product Surface

Application authors work with five concepts:

1. **Application** composes Features and Presentations.
2. **Feature** packages one vertical slice and exposes a semantic API.
3. **Program** contributes logic to a named execution environment.
4. **Component** exposes reactive state and actions as UI structure.
5. **Capability** is the only boundary through which a Program exercises host authority.

`browser` and `server` are meaningful environments and may appear in product definitions. `Node`,
`native`, `Rust`, `Cargo`, compiler IR, development hosts, and production builders are realization
details and must not appear in application source or application tests.

The canonical project structure is:

```text
src/
|-- app.tsx
|-- app.spec.ts
|-- features/
|   |-- identity.tsx
|   |-- shell.tsx
|   `-- tasks.tsx
`-- presentations/
    `-- clean.ts
```

`app.tsx` contains only product metadata and composition:

```ts
export default {
  metadata: { name: "Poggers Operations" },
  features: { identity, shell, tasks },
  presentations: { clean },
} satisfies Application<App>;
```

Reusable Feature factories own their protocol, Programs, required and provided Capabilities,
reactive client state, and focused testing fixture. Instantiation supplies domain meaning, not
transport, persistence, process startup, or backend selection.

## Realization Boundary

The framework owns both execution paths:

```text
                         +-> development adapters -> live sessions and HMR
authored TypeScript -> IR|
                         +-> production adapters  -> optimized artifacts
```

`poggers dev` realizes every required Platform for development. `poggers build` realizes the same
Application for production. Adapter selection is determined from Application meaning and the
framework registry. There is no application-level development/production switch.

Application tests state observable product behavior once. The framework test harness runs that
same specification through every required realization. Backend-specific startup, temporary
configuration, process spawning, artifact construction, readiness, restart, and disposal remain in
the harness and adapter conformance tests.

## Work Plan

### 1. Audit and freeze the boundary

- [x] Inventory application and Feature imports that expose compiler, host, adapter, or backend
      implementation details.
- [x] Inventory public exports and distinguish product authoring from adapter authoring.
- [x] Add enforceable dependency-boundary checks for application source and tests.

**Gate:** no application or Feature source imports compiler internals, host constructors, native
builders, or platform adapter implementations.

### 2. Introduce one application realization API

- [x] Extract CLI realization discovery so development, build, and testing use one implementation.
- [x] Model a framework-owned live application session with locations, readiness, restart, and
      deterministic disposal.
- [x] Keep adapter-specific options and environment setup inside realization infrastructure.
- [x] Ensure `poggers dev` and `poggers build` remain the only normal execution commands.

**Gate:** development and production are selected by the framework without changing or wrapping
the Application definition.

### 3. Introduce backend-agnostic application testing

- [x] Add one public testing entry point with no adapter or compiler parameters.
- [x] Run one black-box specification against development and production realizations.
- [x] Provide only observable application controls: public locations and restart; cleanup is owned.
- [x] Move backend construction assertions into adapter or compiler conformance tests.
- [x] Rewrite authenticated CRUD `app.spec.ts` to contain product behavior only.

**Gate:** authenticated CRUD proves authentication, authorization, persistence across restart,
idempotency, live updates, browser assets, and deep links in both realizations without importing or
naming either realization.

### 4. Reduce Feature instantiation plumbing

- [x] Remove redundant aliases and application-specific adapter vocabulary from example Features.
- [x] Keep explicit Program placement only where it communicates meaningful deployment topology.
- [x] Let reusable factories derive all APIs and contracts from their semantic generic model.
- [x] Keep UI render functions limited to reactive state, actions, composed Components, and native
      platform elements.

**Gate:** identity and entity factory instances contain domain definitions and meaningful topology,
not transport, persistence, host setup, or backend wiring.

### 5. Tighten public exports and project convention

- [x] Add a focused testing export and package it correctly.
- [x] Remove native build and host implementation details from product-facing adapter exports.
- [x] Update the template to include a minimal application test using the same convention.
- [x] Update architecture, organization, and README documentation to show only the canonical path.

**Gate:** a generated project type-checks, tests, develops, and builds without importing an adapter,
compiler, host, or backend module.

### 6. Verify the complete experience

- [x] Run formatting, linting, root and example type checks, unit tests, application conformance
      tests, package build, and template creation checks.
- [x] Build authenticated CRUD through `poggers build` and launch the produced application through
      framework-owned test infrastructure.
- [x] Search application and template sources for forbidden realization vocabulary and imports.
- [x] Remove superseded helpers, tests, documentation, and exports after migration.

**Final gate:** one authored Application and one product test specification have matching observable
behavior in hot-reloadable development and optimized production, with no backend mechanics exposed
to application authors.

## Non-goals

- Hiding meaningful deployment topology such as distinct browser, service-worker, server, or worker
  Programs.
- Translating platform UI source through the portable server backend.
- Treating arbitrary TypeScript as portable.
- Keeping a second compatibility API after the canonical path is migrated.

## Verification Record

- Root and both example TypeScript projects pass strict type checking.
- Oxlint and oxfmt pass across framework, scripts, examples, and template.
- All 43 test files and 326 tests pass.
- Authenticated CRUD passes one unchanged product specification against development and production,
  including deep links, browser assets, authentication, authorization, idempotency, live updates,
  and durable restart recovery.
- The generated template passes formatting, linting, type checking, semantic compilation, and
  production build gates.
- `npm pack --dry-run` contains the built testing entry, declarations, template test, and no raw
  repository `src/` tree.
