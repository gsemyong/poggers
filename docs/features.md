# Reusable Feature Factories

This document is the source of truth for building reusable product languages
from Kit's substrate. It records the target convention, the current gap, and
the migration gates. It does not introduce another composition primitive.

## Foundation

The irreducible product-language concepts are:

1. A **Program** describes executable meaning for one Environment.
2. A **Dependency** describes the typed boundary through which a Program
   reaches authority outside its own implementation.
3. A **Feature** collocates contributions to any number of Programs and composes
   child Features.
4. A **System** is the one composition, compilation, and realization root.
5. A **Platform** supplies the authoring and realization contract for the
   Environments it owns.

A Platform may expose only a headless Program language. A visual Platform also
owns its structural primitives and Presentation language. Structure is
Presentation-independent, not necessarily Platform-independent: a web
Component, native Component, and GPU scene may expose different primitives.
Presentation depends on the exact structural contract and enriches it with the
information needed by that Platform's realization.

A reusable Feature factory is an ordinary TypeScript function built from these
concepts. It may define a complete programming paradigm, as `createActor`
does, without adding a second compiler, runtime, or composition model.

## Factory Convention

There is no `createFeatureFactory` wrapper and no compiler registry of factory
names. A factory is a normal function whose generic contract carries semantic
meaning and whose result retains one `Feature` contract:

```ts
type Inventory = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Methods: {
    reserve: Actor.Method<{ quantity: number }, { remaining: number }>;
  };
}>;

export const inventory = createActor<Inventory>({
  state: () => ({ available: 10 }),
  methods: {
    reserve({ state, input }) {
      state.available -= input.quantity;
      return { remaining: state.available };
    },
  },
});
```

The generic contract is the single source of semantic information. The
implementation fills only behavior that TypeScript cannot infer. Names,
operation shapes, state, inputs, results, failures, Dependencies, and generated
APIs must not be repeated as runtime metadata merely because JavaScript erases
types.

The TypeScript compiler frontend must remain factory-agnostic. It discovers the
retained `Feature` contract and statically readable Feature value, then lowers
ordinary Program contributions. Compiler intrinsics such as type-literal and
type-schema materialization are implementation tools for factory authors; they
must not require feature-specific Rust translation or compiler branches.

Every factory must:

- accept one semantic generic contract;
- infer its implementation context and result from that contract;
- return one directly mountable Feature, even when it contributes to several
  Programs or Platforms;
- keep private child Features and generated Dependency names internal;
- expose a semantic typed API to other Features through Dependencies;
- lower all portable behavior through the generic TypeScript subset;
- package any Feature-owned Dependency providers;
- provide a focused typed testing API;
- document compatibility and migration meaning when persisted state or calls
  survive source revisions.

Returning `{ server, browser }`, exposing generated Dependency names, or
requiring a consumer to place each internal contribution separately is not the
target convention. Program placement remains available on the resulting
Feature when a System intentionally maps a logical role to a concrete Program.

## Source Organization

The target repository has a small number of semantic owners:

```text
src/
  core/          Program, Dependency, Feature, System, and shared UI meaning
  compiler/      TypeScript frontend, portable IR, and linking
  execution/     canonical Program, Process, state, and Dependency semantics
  platforms/     one vertical module per Platform
  features/      one vertical module per shipped Feature factory
  deployment.ts  deployment language and whole-release operations
  deployment/    concrete deployment realizations
  cli.ts         command boundary
  testing.ts     public testing facade
  index.ts       ordinary product facade
```

`core/` contains the authoring language, not browsers, Node.js, Rust, native
providers, deployment, feature-specific behavior, or realization policy.
`compiler/` and `execution/` are separate because translation and live
execution are genuine universal stages, not Feature slices. Everything
extensible is organized vertically under its semantic owner.

Portable product meaning for one Feature factory remains in one TypeScript
implementation file:

```text
src/features/
  actor.ts
  actor.spec.ts
  actor.typecheck.ts
  data.ts
  data.spec.ts
```

The file collocates the semantic model, implementation projection, Program
contributions, Dependencies, state, actions, Components, Presentation
contributions, public API projection, and testing helpers. Program and
Environment boundaries are represented in the Feature contract, not repeated
as source directories.

An optional same-name companion directory exists only for artifacts that
cannot live in the portable TypeScript module:

```text
src/features/
  data.ts
  data.spec.ts
  data/
    native/
      Cargo.toml
      src/
        lib.rs
```

This does not split the Feature implementation by environment. It isolates a
real foreign-language and build boundary while retaining one obvious semantic
owner. A completely portable factory has no companion directory.

The same convention applies to Platforms:

```text
src/platforms/
  web.ts
  web.spec.ts
  web/
    development.ts
    production.ts
  server.ts
  server.spec.ts
  server/
    development.ts
    production.ts
    native/
```

The named TypeScript file is the semantic surface. Its companion directory
contains only independently realized implementation artifacts. Generic
`contract.ts`, `adapter.ts`, `platform.ts`, `index.ts`, `programs/`,
`dependencies/`, and `providers/` subdivisions are not created mechanically.
A file is split only when the extracted part has an independent semantic
owner, lifecycle, output artifact, or toolchain.

## Dependencies And Providers

A **Dependency** is a semantic contract. A **provider** is one implementation
of that contract. There is one Dependency model; "platform Dependency" and
"feature Dependency" are not different invocation systems.

Provider ownership determines placement:

- a general host primitive belongs to its Platform;
- a provider that exists specifically for one Feature factory belongs to that
  Feature;
- portable providers stay in the owner's TypeScript file;
- native providers use the owner's optional companion directory;
- a provider that becomes an independently reusable semantic subsystem becomes
  its own Feature factory rather than entering a global provider registry.

A provider bundle may contain:

- a TypeScript development implementation for immediate hot replacement;
- a native production implementation for the same contract;
- one implementation reached through a stable native process in development
  when duplicating it in TypeScript would be incorrect;
- configuration and lifecycle meaning that cannot be inferred from the
  Dependency contract.

The contract itself remains the only source of operation names, inputs,
results, failures, heartbeat data, and reference projections. A native server
provider implements a Rust trait generated from the generic Dependency IR.
Feature Program code is translated by the universal TypeScript-to-Rust
compiler; no Feature-specific translation is allowed.

Provider selection and mounting are realization concerns:

1. The compiler collects provider contributions from Features and Platforms.
2. Linking resolves each required Dependency once for one concrete Program.
3. A Feature-provided provider satisfies its matching requirement before the
   host is asked for an external provider.
4. The selected Platform supplies unresolved host providers.
5. Identical provider contributions are deduplicated.
6. Missing, conflicting, cyclic, or incompatible providers fail before a
   Process starts.
7. Each Process receives a provider scope and disposes it in reverse ownership
   order.

One provider instance per Process does not imply process-local data. Each
replica may hold a client for the same durable external service.

The application should not manually wire a factory's default providers. It may
select an explicit alternative through the factory's semantic options or the
System realization when replacement is part of the supported contract.

## Testing Convention

Every Feature factory owns a semantic testing API. Test helpers live in the
same implementation module but are exported to users only through
`kit/testing`. The product entry point exports only product APIs.

Testing helpers:

- accept the defined Feature rather than exposed `.server` or `.browser`
  fragments;
- mount Programs through one public generic Feature fixture primitive;
- provide deterministic in-memory implementations of required host
  Dependencies;
- expose the factory's semantic API, state, actions, and controlled fault
  points;
- support alternate principals, time, retries, restart, and persistence where
  those concepts belong to the factory;
- run without HTTP, credentials, native compilation, or a complete System
  unless those boundaries are the behavior under test.

The factory specification exercises semantic behavior through that API. A
separate type fixture is retained only when compile-only positive and negative
evidence cannot live clearly in the runtime specification.

Provider conformance runs the same contract scenarios against development and
native implementations. Generic TypeScript-to-Rust differential tests belong
to the compiler and execution substrate; every Feature edit must not rebuild
Rust merely to repeat already-proven translation guarantees.

Verification follows affected ownership:

| Change                           | Inner gate                                         |
| -------------------------------- | -------------------------------------------------- |
| Feature behavior                 | adjacent source specification                      |
| Feature public types             | adjacent type fixture and affected examples        |
| Dependency contract              | contract, provider, and compatibility conformance  |
| TypeScript subset or IR          | compiler and JS/Rust differential conformance      |
| Native provider                  | targeted Cargo check/test and provider conformance |
| Web structure or Presentation    | web type, lowering, and browser conformance        |
| Platform development realization | targeted Platform development tests                |
| Platform production realization  | targeted production artifact smoke                 |
| Public package surface           | API and example checks                             |

The complete repository and release gates run after a coherent milestone, not
after every Feature edit.

## Current State

### Strong Foundation

- `createFeature` retains exact contracts, and the compiler extracts Features
  through that retained type rather than recognizing a fixed list of factory
  names.
- Program contributions already collocate by Feature and link by logical
  Program name.
- Required and provided Dependencies already resolve over the Feature tree.
- The generic compiler supports type-literal and type-schema materialization
  inside portable Programs.
- `createActor` is the closest current reference: one generic model supplies
  the Actor name and method definitions; one implementation object supplies
  behavior; the result is one mountable Feature with a semantic Dependency.
- Actor Program behavior follows the generic portable compiler and generated
  Rust path rather than Actor-specific native translation.

### Gaps And Redundancies

1. `createEntity`, `createData`, and `createIdentity` require `name` even though
   their generic model already contains `Name`.
2. Those factories return separate server and browser Features, exposing
   placement and composition plumbing to consumers.
3. Entity and Data expose generated Dependency-name strings and require
   application code to place and mount their internal fragments.
4. Entity and Data provide overlapping public CRUD surfaces. Data currently
   wraps Entity as a private event-sourced source, but both remain public ways
   to author substantially the same product capability.
5. Platform host APIs are mostly plain object types while Actor references use
   the richer branded Dependency definition. The compiler therefore supports
   more than one authoring shape for what is semantically one boundary.
6. Production server providers are selected from one centralized hardcoded
   registry. Feature-owned Data, authentication, event, and Actor-support
   providers lose their semantic owner there.
7. Web and server realizations detect magic Dependency names such as
   `dataStore` and `authentication` to install providers and realization
   requirements. A Feature-owned provider cannot currently contribute those
   requirements through its own contract.
8. Native providers implement one dynamic string-dispatched Rust trait and
   manually repeat operation names, input decoding, and output encoding. The
   Dependency IR validates calls at the runtime boundary, but it does not yet
   generate an exact provider trait that makes drift a Rust compilation error.
9. Factory implementations frequently use broad `as Feature` or
   `as unknown as` assertions instead of one validated retained Feature
   definition.
10. Data and Entity testing APIs live in separate `.testing.ts` implementations
    and manually assemble Program contributions through runtime internals.
11. Actor has extensive internal fixtures but no focused public semantic fixture
    exported through `kit/testing`.
12. Identity has no factory-specific testing surface.
13. `kit/testing` mixes lightweight factory fixtures with complete development
    and native production System orchestration.
14. The root package exports low-level compiler intrinsics, adapter contracts,
    deployment machinery, and product factories together, making the normal
    product surface larger than necessary.
15. The repository still groups code under `contracts/`, `runtime/`, and
    `adapters/` according to technical role rather than semantic ownership.
16. The authenticated CRUD example manually exports and places identity and
    entity server/browser fragments. It demonstrates the legacy factory
    plumbing rather than the target Feature-factory experience.
17. Existing documentation says that factory layout changes with size. The
    target is instead one portable implementation file plus only genuine
    companion artifacts.

## Migration

### F1: Freeze The Factory Contract

- [x] Compiler fixtures prove that arbitrary ordinary functions may
      return retained Features without compiler name registration.
- [x] Compiler fixtures prove that resolved generic literal and structural type
      information may materialize inside portable Program contributions without
      repeated runtime metadata.
- [ ] Define the minimal public authoring primitives required by Feature
      factory authors; do not add a `createFeatureFactory` wrapper.
- [ ] Replace avoidable broad assertions in one representative factory with a
      checked retained Feature definition.

Gate: source compiler, Feature type fixtures, and the representative factory
specification.

### F2: Unify Dependency Authoring And Provider Contributions

- [ ] Define one canonical Dependency contract shape for platform-, Feature-,
      provided-, and externally implemented Dependencies.
- [ ] Add typed provider contributions for development and production without
      repeating Dependency operations or names.
- [ ] Let providers declare realization requirements such as cross-origin
      isolation, configuration, assets, storage allocation, and native crate
      inputs without Platform code recognizing the Dependency's name.
- [ ] Collect providers from compiled Features and Platforms.
- [ ] Validate missing, duplicate, incompatible, and cyclic providers.
- [ ] Generate and verify an exact native Rust provider trait and typed
      input/output conversion from Dependency IR; remove manually repeated
      operation dispatch where generated code can enforce it.
- [ ] Retain only genuinely server-owned providers in the Server Platform.
- [ ] Move Feature-owned native providers beside their factories.
- [ ] Delete the centralized hardcoded server provider registry after all
      providers migrate.

Gate: Dependency type/runtime tests, provider-linking tests, one development
provider conformance fixture, and one native provider conformance fixture.

### F3: Establish Factory-Owned Testing

- [ ] Expose one generic Feature fixture primitive through `kit/testing`.
- [ ] Add a semantic Actor fixture without exposing Program fragments.
- [ ] Move Data and Entity testing helpers into their owning implementation
      modules and remove direct runtime-internal assembly.
- [ ] Add an Identity fixture.
- [ ] Run the same provider contract scenarios against development and native
      implementations.
- [ ] Keep complete System realization as a separate milestone and release
      gate.

Gate: focused factory specifications and `kit/testing` API verification; no
native build unless a native provider changed.

### F4: Migrate Legacy Factories

- [ ] Make Identity one directly mountable Feature and remove repeated `name`.
- [ ] Make Data one directly mountable Feature and remove repeated `name`,
      `.server`, `.browser`, and `.dependency`.
- [ ] Decide the one public CRUD language: keep Entity as an internal Data
      building block or justify its distinct public semantics with
      non-overlapping pressure fixtures.
- [ ] Hide private source Features and generated Dependencies.
- [ ] Preserve local-first state, synchronous actions, authorization,
      synchronization, and query behavior.
- [ ] Migrate authenticated CRUD to consume only semantic factory results.

Gate: Identity/Data focused behavior and type fixtures, authenticated CRUD type
check, then one browser development check. Native production runs after the
portable behavior is stable.

### F5: Align Physical Ownership And Public Surface

- [ ] Move Platform semantic surfaces to named Platform modules and keep
      development, production, and native artifacts in their companion
      directories.
- [ ] Replace global `contracts/`, `runtime/`, and `adapters/` buckets with
      language, execution, Platform, Feature, and deployment ownership.
- [ ] Keep public imports semantic and stable through package entry points.
- [ ] Move factory-authoring intrinsics and adapter-author APIs out of the
      ordinary product entry point where compatibility permits.
- [ ] Remove superseded test helpers, aliases, registry entries, examples, and
      documentation in the same migration that replaces them.

Gate: architecture dependency tests, root type check, lint/format, API
verification, affected examples, and one complete repository gate after all
focused gates are green.

## Non-Goals

- No second Feature composition tree.
- No feature-specific compiler or Rust lowering.
- No directory per Program, Environment, Dependency, Component, or provider.
- No factory-name registry in the compiler.
- No mandatory native implementation when portable TypeScript is sufficient.
- No global service locator or application dependency-wiring file.
- No duplicate "simple" and "advanced" factory APIs.
- No broad implementation rewrite of Actor merely to make files symmetrical.
- No complete production build during ordinary factory iteration.

## Closure Criteria

The migration is complete when:

1. Actor, Data, and Identity each expose one generic semantic factory returning
   one directly mountable Feature.
2. A new programming paradigm can define its model, implementation projection,
   generated Dependency API, portable Programs, providers, testing fixture,
   and compatibility policy without compiler special cases.
3. Feature and Platform providers are discovered from their semantic owners;
   no centralized provider list remains.
4. Every native provider implements a trait generated from the same Dependency
   IR used in development.
5. The authenticated CRUD System contains no factory-internal placement,
   transport, or provider wiring.
6. `kit/testing` provides lightweight semantic fixtures while complete
   development and production realization remains an explicit higher gate.
7. Source organization follows semantic ownership with one portable
   implementation file per factory and no mechanical subdivision.
