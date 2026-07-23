# Architecture migration

## North star

Poggers is a portable TypeScript product language for applications composed from
Features. Features co-locate Program contributions for different Environments,
communicate through typed Dependencies, and may define platform-native user
interfaces.

The repository must make that architecture visible without requiring knowledge
of implementation history:

- Core defines product meaning and no realization technology.
- The compiler extracts and links that meaning into canonical, versioned IR.
- The reference runtime executes the same semantics during development and
  testing.
- Platforms define public authoring languages for their Environments.
- Platform Adapters realize those languages in development and production.
- Features contain reusable vertical slices and portable Dependency providers.
- Native languages are private production details of Platform Adapters.
- A file exists only for one clear architectural concept or one substantial
  implementation unit.

The migration is complete only when the physical tree, import graph, package
exports, tests, documentation, and generated artifacts all enforce this model.

## Product concepts

### Application

An Application composes Feature instances and Presentations. It contains product
metadata but does not select or construct implementation adapters.

### Feature

A Feature is a reusable vertical slice. It may:

- contribute to multiple named Programs;
- compose child Features;
- require typed Dependencies;
- provide typed Dependencies;
- define state, actions, Components, and platform-specific UI;
- provide specialized testing support.

### Program

A Program is authored logic assembled from every same-named Feature
contribution. One compiled Program is one independently realizable deployment
artifact.

### Environment

An Environment is one execution context for a Program. It selects exactly one
Platform and may opt into the Platform's UI language. It does not redeclare
Dependencies: Program contributions are their single semantic source.

Examples include a browser main thread, browser service worker, owned server,
user-hosted server, iOS foreground process, and iOS background process.

### Platform

A Platform is a public product language for a related family of Environments.
It defines platform-specific structure, navigation, presentation, and host
Dependency contracts without implementing them.

### Process

A Process is one live instance of one compiled Program. Each Process owns one
Dependency scope. Replicas are independent Processes built from the same
artifact.

### Dependency

A Dependency is a typed API used by a Program to access authority or meaning not
implemented directly at that call site. A Dependency may be synchronous,
asynchronous, streaming, stateful, pure, or effectful.

There are exactly two provider origins:

1. A Feature Program provides a semantic Dependency from its `start`
   implementation.
2. A Platform Adapter implements a Dependency left unresolved after linking the
   Program's contributions.

### Component and Presentation

A Component owns UI behavior: state, actions, hierarchy, lifetime,
accessibility, listeners, and named Elements.

A Presentation consumes Component meaning and enriches those Elements with a
platform-specific visual and experiential declaration. Presentation cannot
change product behavior.

### Adapter

A Platform Adapter is the sole top-level realization contract. It owns:

- source extensions for its public Platform language;
- development execution and hot replacement;
- production artifact generation;
- implementation of unresolved Environment Dependencies;
- UI realization when the Platform supports UI.

Rust, Swift, JavaScript, Node.js, Cargo, SwiftPM, Vite, and concrete UI engines
are adapter implementation details, not framework concepts.

## Dependency resolution

For each named Program, the compiler and linker:

1. collect every Feature contribution;
2. validate each required and provided Dependency contract;
3. reject duplicate providers, incompatible contracts, and provider cycles;
4. order Feature providers before their consumers;
5. classify requirements with no Feature provider as external;
6. pass the linked external contracts to the selected Platform Adapter;
7. require the Adapter to bind each exact contract once before execution.

At Process startup:

1. the Platform Adapter creates one external Dependency scope;
2. Feature providers start in dependency order;
3. each provided binding is instantiated once and shared by local consumers;
4. the Program starts with the complete dependency graph;
5. disposal runs exactly once in reverse ownership order.

Feature-provided implementations are portable Program code and are translated
from the same source for every production target. They are never reimplemented
manually in Rust or Swift.

If an operation cannot be expressed in the portable language, it remains an
Environment Dependency. Its development and production implementations live in
the corresponding Platform Adapter.

## Target source tree

```text
src/
  core/
    application.ts
    program.ts
    dependency.ts
    stream.ts
    ui/
      language.ts
      component.ts
      presentation.ts

  compiler/
    extension.ts
    ir.ts
    source.ts
    linker.ts
    presentation.ts

  runtime/
    process.ts
    state.ts
    interpreter.ts
    presentation.ts

  jsx/
    runtime.ts
    development.ts

  contracts/
    platform.ts

  platforms/
    server/
      platform.ts
    web/
      platform.ts
      routing.ts
      ui.ts
      presentation.ts
      presentation/
        dynamics.ts

  adapters/
    registry.ts
    integration/
      web-server.ts
    server/
      adapter.ts
      development/
        host.ts
        runtime.ts
        session.ts
      production/
        compiler.ts
        dependencies.ts
        program.ts
        dependencies/
          authentication/
          events/
            sqlite/
            jetstream/
        runtime/
    web/
      adapter.ts
      compiler.ts
      document.ts
      host.ts
      installation.ts
      pipeline.ts
      routing.ts
      development/
        cache.ts
        server.ts
      production/
        build.ts
      ui/

  features/
    entity.ts
    entity.spec.ts
    entity.testing.ts
    identity.ts
    identity.spec.ts

  realization.ts
  testing.ts
  cli.ts
  index.ts
```

Tests remain beside the implementation they prove. A directory or additional
file is created only when a real implementation has more than one substantial,
independently understandable unit. Empty symmetry and mechanical `types`,
`helpers`, `utils`, `internal`, and barrel files are forbidden.

## File responsibilities

### Core

- `core/application.ts` defines Application and Feature composition only.
- `core/program.ts` defines Platform, Environment, Program, placement, and
  authoring contexts.
- `core/dependency.ts` defines semantic Dependency projections and identities.
  It imports neither compiler IR nor runtime implementation.
- `core/stream.ts` defines portable stream transformations used by Program
  source.
- `core/ui/language.ts` defines the shared UI, Element, target, and child
  contracts.
- `core/ui/component.ts` defines Component behavior and composition.
- `core/ui/presentation.ts` defines generic Presentation meaning and compiler
  intrinsics, without a web or animation-engine vocabulary.

### Compiler

- `compiler/extension.ts` defines the adapter-facing source-extension contract.
- `compiler/ir.ts` contains serializable canonical IR and version validation.
  It does not perform linking or generate a target language.
- `compiler/source.ts` extracts product meaning through the TypeScript compiler
  API.
- `compiler/linker.ts` assembles Programs, resolves Dependencies, and links
  Platform extension output into complete Program IR.
- `compiler/presentation.ts` extracts generic Presentation meaning.

### Runtime and JSX

- `runtime/process.ts` owns Process, Dependency, provider, and disposal
  lifecycle.
- `runtime/state.ts` implements the reference reactive-state semantics.
- `runtime/interpreter.ts` executes portable IR as the reference realization.
- `runtime/presentation.ts` owns only generic Presentation and action-event
  lifecycle required by every UI adapter.
- `jsx/runtime.ts` and `jsx/development.ts` are the conventional shared JSX
  package entry points. They retain only an explicit, stateless renderer
  dispatch registration for the active Platform realm; Component,
  Presentation, and Application state is owned by each mounted UI instance.

### Platforms and contracts

- `contracts/platform.ts` is the implementation contract satisfied by every
  Platform Adapter.
- `platforms/<name>/` is public authoring language, never concrete runtime code.
- A Platform folder exists even when its first implementation needs one file,
  because it is a stable public package boundary and grows without moving its
  entry point.

### Adapters

- `adapters/<platform>/adapter.ts` assembles the complete adapter.
- Development and production are the primary implementation profiles.
- Platform-specific source lowering remains inside the adapter.
- Dependency implementations are grouped by semantic Dependency inside their
  owning profile.
- If one Dependency has multiple substantial implementations, technology names
  appear only below that semantic Dependency, such as
  `dependencies/events/{sqlite,jetstream}`.
- Language-specific layout follows that language's conventions below the
  production boundary.
- One implementation file may contain several trivial bindings. A separate
  module or native package requires independent complexity, dependencies,
  caching, testing, or distribution.

### Features

- `features/<name>.ts` contains one reusable semantic factory, its domain type
  helper, derived API, portable Program contributions, and private lowering.
- `features/<name>.testing.ts` exists only for a public domain-specific testing
  surface.
- `features/<name>.spec.ts` proves semantics and difficult lifecycle behavior.
- Application-owned Features remain `src/features/<name>.tsx`; they do not copy
  factory internals or implementation wiring.

## Production language organization

There is no generic `native` architecture directory.

The server production adapter currently emits Rust, so its implementation may
use:

```text
adapters/server/production/
  compiler.ts
  program.ts
  runtime/
    Cargo.toml
    src/
  dependencies/
    authentication/
    events/
    http/
```

An iOS adapter may emit Swift:

```text
platforms/ios/
  platform.ts
  ui.ts
  presentation.ts

adapters/ios/
  adapter.ts
  compiler.ts
  development/
  production/
    compiler.ts
    Package.swift
    Sources/
      Runtime/
      Dependencies/
```

The architectural responsibilities are parallel; Cargo and SwiftPM internals
are not forced into identical file shapes.

The compiler-derived Dependency contract is the single source of truth:

- a development TypeScript implementation is structurally checked against it;
- Rust production generates a trait or equivalent binding checked by `rustc`;
- Swift production generates a protocol or equivalent binding checked by
  `swiftc`;
- operation signatures are not repeated manually in TypeScript adapter
  descriptors.

## Import graph

Production imports must follow these directions:

```text
core -> core
compiler -> core
runtime -> core + compiler IR
jsx -> core UI + runtime
contracts -> core + compiler contracts + compiler IR
platforms -> core
features -> core + public platforms
adapters -> own platform + contracts + compiler + runtime
realization -> contracts + compiler
```

Forbidden:

- core importing compiler implementations, runtime, Platforms, or Adapters;
- public Platforms importing concrete Adapters;
- Adapters importing Features;
- one Adapter importing another Adapter's implementation;
- generic contracts containing Rust, Swift, Node.js, browser, or Cargo meaning;
- generated or production code importing application-specific Feature types.

Cross-Platform lowering, such as web route loaders becoming server Program
contributions, is owned explicitly by `adapters/integration/`; neither concrete
Adapter imports the other. Integration output is ordinary Program IR before
either Adapter starts a Process.

## Package exports

| Export                         | Ownership                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `@poggers/kit`                 | Portable Application, Feature, Program, Component, Presentation, and reusable Feature APIs |
| `@poggers/kit/server`          | Public server Platform and Environment language                                            |
| `@poggers/kit/web`             | Public web Platform, routing, UI, and Presentation language                                |
| `@poggers/kit/adapter`         | Platform Adapter authoring contract                                                        |
| `@poggers/kit/adapters/server` | Concrete shipped server Platform Adapter                                                   |
| `@poggers/kit/adapters/web`    | Concrete shipped web Platform Adapter                                                      |
| `@poggers/kit/testing`         | Public testing support                                                                     |
| JSX runtime exports            | TypeScript JSX toolchain entry points                                                      |
| `@poggers/kit/cli`             | Command-line realization entry point                                                       |
| `@poggers/kit/tsconfig`        | Shared TypeScript authoring configuration                                                  |

## Migration

### 1. Freeze the boundaries

- [x] Add directory-wide import-boundary verification for the target graph.
- [x] Record the current package export surface and classify every export.
- [x] Prevent new Feature imports from Adapters and new cross-Adapter imports.

### 2. Separate semantic core

- [x] Split Program, Platform, and Environment from `core/application.ts`.
- [x] Move UI contracts into `core/ui/`.
- [x] Remove compiler and runtime behavior from `core/dependency.ts`.
- [x] Split semantic and runtime Presentation responsibilities.
- [x] Replace the ambiguous `portable` module with its precise `stream` owner.

### 3. Establish compiler and runtime layers

- [x] Move canonical compiler modules to `src/compiler/`.
- [x] Move dependency linking from IR and core into `compiler/linker.ts`.
- [x] Move reference execution from `core/development.ts` to
      `runtime/interpreter.ts`.
- [x] Move Process and state implementations to `src/runtime/`.
- [x] Move shared JSX entry points to `src/jsx/`.
- [x] Keep JSX dispatch stateless and scope every mutable UI value to its mount.

### 4. Separate public Platforms from Adapters

- [x] Move server authoring contracts to `platforms/server/`.
- [x] Move web Platform, routing, UI, and Presentation language to
      `platforms/web/`.
- [x] Point public `./server` and `./web` package exports at Platforms.
- [x] Ensure Features import only public Platform modules.

### 5. Correct Adapter ownership

- [x] Remove Feature imports from the server development host.
- [x] Replace server-to-web implementation imports with an explicit integration owner.
- [x] Organize server implementation by development and production profiles.
- [x] Organize web implementation around adapter, compiler, development,
      production, document, routing, and UI responsibilities.
- [x] Keep internal drivers private rather than naming each one an Adapter.

### 6. Correct production and Dependency realization

- [x] Remove the generic `contracts/native.ts` abstraction.
- [x] Consolidate the two Rust Program generators into one production path.
- [x] Move Rust generation and runtime under server production.
- [x] Group production Dependency implementations semantically.
- [x] Derive implementation contracts from `DependencyIR`.
- [x] Remove handwritten operation-schema duplication.
- [x] Verify development and Rust implementations against the same contracts.
- [x] Prove the design admits an iOS/Swift adapter without changing core,
      compiler IR, or the Platform Adapter contract.

### 7. Tighten public and repository surfaces

- [x] Export authoring APIs, Platforms, Adapters, and testing intentionally.
- [x] Stop exporting private runtime and compiler machinery from the root.
- [x] Update path aliases and package build entry points after moves.
- [x] Remove superseded compatibility exports and files.
- [x] Consolidate architecture documentation and remove obsolete plan residue.
- [x] Remove generated build, Cargo, example database, and fixture residue.

### 8. Verify end to end

- [x] Typecheck the package, template, and every example.
- [x] Pass Oxlint and Oxfmt.
- [x] Pass focused unit, property, contract, and lifecycle tests.
- [x] Build the package distribution and inspect its exact contents.
- [x] Develop and hot-reload every example.
- [x] Build and run every production example.
- [x] Exercise authenticated CRUD in a browser with no runtime, style,
      hydration, routing, focus, or reload errors.
- [x] Run the Rust production artifact and verify persistence,
      authentication, authorization, subscriptions, and restart recovery.

## Acceptance gates

The final architecture is accepted only when all of the following are true:

- [x] The physical source tree matches the documented ownership model.
- [x] Every production file has one explainable architectural owner.
- [x] No ambiguous `native`, `internal`, generic `utils`, or compatibility
      directory remains.
- [x] Core contains no compiler backend, host, adapter, or platform code.
- [x] Public Platforms contain no concrete realization code.
- [x] Features contain no concrete adapter imports.
- [x] Adapters contain no application or Feature-specific type imports.
- [x] Adapters do not import sibling Adapter implementations.
- [x] Every external Dependency is declared once by a Program contribution and
      resolved exactly once per Process by its Platform Adapter.
- [x] Every Feature provider is instantiated once per Process and shared by its
      consumers.
- [x] Missing, duplicate, incompatible, and cyclic Dependency graphs fail before
      execution.
- [x] Rust and development execute the same portable Program fixtures.
- [x] No production Dependency API is manually duplicated from its TypeScript
      semantic contract.
- [x] Adding the modeled iOS/Swift adapter requires additions under
      `platforms/ios` and `adapters/ios`, not edits to core semantics.
- [x] Package exports expose the intended product language and no private
      implementation surface.
- [x] The package, template, examples, development sessions, production builds,
      browser E2E, and Rust production E2E all pass.
- [x] `nub run check` and `nub run build` pass from a clean checkout.

## Progress

| Phase                      | Status   | Evidence                                                               |
| -------------------------- | -------- | ---------------------------------------------------------------------- |
| Boundary freeze            | Complete | Import-graph test and Oxlint restrictions pass                         |
| Semantic core              | Complete | Program/UI ownership and Dependency purity typechecked                 |
| Compiler and runtime       | Complete | IR/linker/runtime/JSX split and contract conformance tests pass        |
| Public Platforms           | Complete | Public Platform modules have no Adapter/compiler/runtime imports       |
| Adapter ownership          | Complete | Server/web profiles, Feature isolation, and integration ownership pass |
| Production Dependencies    | Complete | One Rust lowering and shared IR-derived contracts pass                 |
| Public surface and cleanup | Complete | Exports, documentation, obsolete integrations, and residue audited     |
| End-to-end verification    | Complete | Clean-checkout, distribution, browser, HMR, and Rust gates pass        |

## Verification record

Completed on 2026-07-23:

- An isolated source snapshot with no dependencies, builds, databases, or Cargo
  target installed from the frozen lockfile and passed `nub run check`.
- The final suite passed 49 Vitest files and 392 tests. It covers unit,
  property-based, type, contract, lifecycle, routing, rendering, hydration,
  presentation, replica, and production conformance behavior.
- The Rust workspace built cold and passed every runtime and Dependency test,
  including authentication, SQLite persistence, JetStream ordering, HTTP
  rendering and cache behavior, identifiers, and Process disposal.
- Authenticated CRUD passed in development and Rust production on Chromium,
  Firefox, and WebKit. Its production test verifies authentication,
  authorization isolation, idempotent commands, real-time subscriptions,
  persistence, and restart recovery.
- Manual browser verification confirmed auth redirects, styled direct loads,
  styled UUID-route reloads, create/edit/complete/delete, stable edit focus,
  synchronization settlement, sign-out routing, and an empty browser error log.
- Both examples hot-reloaded source without a document navigation and preserved
  live UI or authentication state. Each temporary verification edit was
  restored.
- Both examples produced and ran their production artifacts. The standalone web
  Presentation bundle handled state changes and its modal interaction with no
  browser errors.
- The packed package contains 219 intentional files and no implementation
  specs, typecheck fixtures, targets, Cargo locks, databases, or legacy paths
  outside the intentionally shipped starter template.
- A project created from that tarball installed independently, passed its own
  typecheck, lint, format, and tests, and produced its production web bundle.
- `nub outdated` reports that every declared dependency is current.
