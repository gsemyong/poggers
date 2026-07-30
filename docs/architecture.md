# Architecture

Kit is an extensible substrate for portable product languages. A company
Workspace describes one System made from reusable Features and independently
addressable Applications. Features contribute Programs for specific
Environments, and Programs interact with everything outside their own logic
through typed Dependencies.

The substrate owns composition, identity, dependency direction, and compiler
extension points. It does not prescribe one universal Program body. The
Environment selected by a Program chooses a statically registered authoring
language and Platform realization. Web UI, server processes, service workers,
native UI, actors, and future Program kinds may therefore expose different
optimal APIs while remaining composable through the same System, Feature,
Program, and Dependency model.

```text
TypeScript product source
  -> adapter-owned semantic extensions
  -> one linked System and Program graph
  -> Platform Adapters
       |- live development realizations
       `- production artifacts
  -> Deployment Adapter
       `- placement, exposure, and scaling
```

## Invariants

1. **System is the only root.** It is the complete compilation and development
   boundary for one Workspace.
2. **Feature is the only recursive behavior-composition unit.** A Feature
   co-locates contributions for several Program kinds without coupling those
   Program languages to each other.
3. **Program is the authored deployment unit.** Same-named, contract-identical
   contributions link into one Program. A live replica is a Process.
4. **Dependency is the interaction boundary.** A Dependency is provided either
   by another Feature contribution or by the selected Platform Adapter.
5. **Application is an addressable interface composition.** It requires Feature
   contracts and contributes only Platform-owned interface meaning. Concrete
   Feature instances remain owned once by the System.
6. **Environment selects a Program language.** The selected Platform owns the
   Program's additional type-level contract, implementation shape, compiler
   extension, development realization, and production realization.
7. **Adapters own realization.** Core contains no browser, DOM, native UI,
   routing, Presentation, Node.js, Vite, Rust, database, transport, deployment,
   or protocol policy.
8. **UI is conditional Platform meaning.** JSX dispatch may be shared
   infrastructure, but structural primitives, Components, navigation,
   accessibility, Presentation declarations, and lifecycle semantics belong to
   the selected UI-capable Platform.
9. **Deployment is downstream.** It consumes immutable Program and interface
   artifacts plus placement requirements; it does not participate in Feature
   behavior or Platform authoring languages.
10. **One source revision has one semantic compilation.** Every adapter consumes
    the same versioned IR.
11. **The physical tree follows ownership.** Files split at real architectural,
    lifecycle, or distribution boundaries, not for mechanical symmetry.
12. **Portability is adapter-declared and frontend-enforced.** A Platform whose
    backend consumes portable IR rejects target source during semantic
    compilation. A source-native Platform may own source without weakening
    another Platform's invariant.

## Vocabulary

### Workspace

The source repository and development boundary. It contains one `src/system.ts`,
shared Features, Applications, Presentations, tests, and configuration. It is a
tooling convention, not an IR primitive.

### System

The company-level composition root. It contains metadata, standalone Features,
and Applications. It contains no adapter instances, host wiring, Program
placement, or global Presentation registry.

```ts
type Company = {
  Features: { shared: SharedFeature };
  Applications: { customer: Customer; operations: Operations };
};

export default createSystem<Company>({
  metadata: { name: "Company" },
  features: { shared },
  applications: { customer, operations },
});
```

### Feature

The reusable vertical slice and sole recursive composition primitive. A Feature
may compose child Features and contribute to several Programs. A reusable
factory exposes a domain language while lowering it to Feature, Program, and
Dependency contracts.

```ts
export const tasks = createFeature<Tasks>({
  programs: {
    server: { start({ dependencies }) {} },
    browser: { state, actions, components, routes },
  },
});
```

A Feature sees only its declared children and Dependencies. It has no ambient
access to the consuming System.

The generic contract declares Program Environments, Dependencies, and child
Feature contracts directly. The selected Program language contributes any
additional fields such as lifecycle, state, actions, Components, or Routes.
There is no `Program<...>` authoring wrapper: the implementation object fills
the behavior required by the resulting contract.

### Application

An Application is one named, independently addressable product experience. Its
contract declares the Feature roles it requires and the Platform interfaces it
exposes. It owns no Programs, providers, state, Components, or concrete Feature
instances.

```ts
type Customer = {
  Features: {
    identity: FeatureContractOf<typeof identity>;
    shell: ShellFeature;
    tasks: FeatureContractOf<typeof tasks>;
  };
  Interfaces: WebPlatform<{
    Mounts: {
      shell: {
        Path: "";
        Route: "workspace";
        Children: {
          tasks: { Path: "tasks"; Route: "root" };
        };
      };
    };
  }>;
};

export const customer = createApplication<Customer>({
  interfaces: {
    web: {
      presentation: customerWeb,
      installation: customerInstallation,
    },
  },
});

export default createSystem({
  features: { identity, shell, tasks },
  applications: { customer },
});
```

The System resolves each Application Feature role to exactly one matching
concrete Feature in its Feature graph. Missing and ambiguous roles are
compilation errors. A factory call creates a Feature instance; reusing that
exact value exposes one semantic instance through several Applications without
copying its Programs or providers. Calling the factory again creates another
instance, whose returned contract must retain enough type-level identity to
disambiguate it when both instances are visible.

An interface is not another Feature tree. It contains only Platform-owned
configuration such as a web Presentation, route mounts, and installation policy. A web and
native interface of the same Application therefore receive the same domain composition,
while each Platform retains its own structure, navigation, accessibility, and
Presentation language. An Application has at most one interface for a given Platform;
independently addressable experiences with different route, loading, security,
or installation lifecycles are separate Applications that may reuse the same Feature
values.

### Program And Process

A Program is the linked result of every contract-identical contribution with the same
semantic name and Environment. Different names produce independently realizable
artifacts. Feature and Application composition never rewrites Program names.

A Process is one running Program instance. Replication creates more Processes
from the same artifact. Deployment selects replica policy; coordination,
sharding, persistence, and communication are expressed through Dependencies
rather than a second execution model.

### Environment And Platform

An Environment names one execution context, such as `browser-main`,
`browser-service-worker`, or `server`, and selects one Platform-owned Program
language.

A Platform is a statically pluggable authoring and realization family. It may
define several Environments with different Program contracts. The core does not
assume that every Program has `start`, state, actions, Components, Routes, or a
UI. Those fields are projected from the selected Program language into the
Feature implementation and checked through the Environment's contract.

One complete Platform extension owns:

1. the generic type-level contract authors place in a Program declaration;
2. the implementation fields that fill the contract's runtime gaps;
3. compiler extraction into versioned, serializable extension IR;
4. development execution, diagnostics, and hot replacement;
5. production lowering and artifact generation;
6. conformance evidence shared by development and production.

The web Platform, for example, may own browser-main, worker, and service-worker
Program languages; web routes, destinations, metadata, delivery, installation,
and caching; and one or more matching UI realizations. A DOM realization owns
HTML structure and its Presentation language. A future Canvas or WebGPU
realization may expose different structural and Presentation primitives without
changing Feature, Program, Dependency, Application, or System.

The web adapter derives loading work rather than exposing bundler controls.
Only the entry and its shared dependencies are critical. Other Route modules
load on navigation intent. An installed service worker retains the start and
offline documents during installation, then warms the remaining public
documents and immutable application assets after the first frame. It skips
background work on constrained or data-saving connections. Non-installed
applications retain feature-only assets on demand. An Interface proven to
contain no state, actions, lifecycle, Dependencies, workers, installation,
deferred rendering, unresolved views, or temporal Presentation emits static
HTML and CSS without a client script or hydration markers.

Installation and background warming belong to one web Interface. A public
static surface and an authenticated offline application should therefore be
separate Applications when they have different loading and security lifecycles. Their
web interfaces may remain in the same System, reuse the exact same Feature
values and Presentation, and receive separate hostnames from Deployment. This
avoids auth-specific rendering switches and prevents an installable
application's heavy assets from entering a public surface's critical path.

Request-independent literal Routes are materialized at build time. Other
content Routes use the same document IR at request time; public cache duration
and stale-revalidation are one cache policy, not separate rendering modes.
Immutable assets are content-addressed. Mutable documents are validated or
replaced through the selected Deployment adapter's delivery implementation.

### Dependency

A typed API for authority or meaning not implemented at the call site. It may
be synchronous, asynchronous, streaming, stateful, pure, or effectful.

There are two provider origins:

1. another Feature contribution provides a portable semantic API;
2. a Platform Adapter provides a host API still unresolved after linking.

The linker rejects missing, duplicate, different, and cyclic providers. Each
Process owns one provider scope and disposes it in reverse ownership order.
Process-local instantiation does not imply process-local data: a provider may
connect every replica to shared infrastructure.

### Component And Presentation

Component and Presentation are not mandatory universal Program concepts. They
belong to a UI-capable Program language.

Such a language may define Components with props, state, actions, slots,
hierarchy, accessibility, lifecycle, and named structural Elements. JSX is a
shared syntax and dispatch mechanism; the selected adapter determines which
primitives exist and what their semantics are.

A matching Presentation language maps the exact structural contract to that
target's experiential declarations. It may read typed behavior meaning and
target observations, but behavior cannot depend on Presentation. Another UI
adapter may replace both structure and Presentation syntax while retaining the
same neutral composition substrate.

### Platform Adapter

The implementation contract for one Platform:

```ts
type PlatformAdapter<Platform> = {
  name: Platform["Name"];
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
};
```

Development prioritizes fast startup, diagnostics, and state-preserving hot
replacement. Production prioritizes deterministic, minimal artifacts. Both
consume the same linked IR and may use different implementation languages.
Platform-private UI renderers, host libraries, and compilers may refine this
type, but the neutral realization coordinator sees only this contract.

## Extension Boundary

Pluggable means statically replaceable behind checked contracts. It does not
mean a runtime service locator, untyped plugin bag, or dynamically discovered
framework callback.

The compiler has two kinds of meaning:

1. **neutral graph meaning**: Systems, Feature ownership, Program identity,
   Environments, required and provided Dependencies, Applications, interfaces,
   and output ownership;
2. **adapter-owned dialect meaning**: the fields, operations, validation, and
   IR required by one Program or Application-interface language.

The generic frontend discovers registered dialects, gives each dialect only its
owned declaration and implementation, preserves its versioned IR, and links the
neutral graph. It does not interpret web Routes, DOM Elements, Presentation
properties, actor commands, or server lifecycle operations. A Platform adapter
consumes its own dialect IR and the relevant neutral graph projection.

The generic portable-TypeScript backend translates supported procedural
semantics without recognizing Feature factories or Platform concepts.
Platform-specific host behavior remains behind Dependencies or adapter-owned
lowering. Tightening the portable subset is preferable to adding
Feature-specific code generation.

Application interfaces use the same extension mechanism as Programs. Core
knows that an Application has a named interface for a Platform; the Platform
defines the interface contract. Web therefore owns route mounts, Presentation,
installation, and delivery meaning. Another Platform may define an entirely
different interface language.

Dependency contracts remain semantic ports. Providers may come from another
Feature or from a Platform adapter, and development and production providers
must pass the same TypeScript-authored conformance suite. A Program never
imports another adapter's runtime to communicate.

Deployment is a separate downstream extension:

```text
linked System
  -> Platform artifacts and requirements
  -> Deployment plan
  -> Deployment adapter
  -> machines, processes, public endpoints, storage, and scaling
```

It may use Program identities, resource requirements, public interface
artifacts, and semantic scaling declarations. It must not inspect Component,
Route, or Presentation implementation details.

### Change-locality gate

The boundary is complete only when ordinary changes remain with their owner:

| Change                             | Expected ownership                                                |
| ---------------------------------- | ----------------------------------------------------------------- |
| Add a web Route capability         | web Platform contract, compiler extension, adapter, and web tests |
| Add a DOM Presentation declaration | DOM Presentation language, realization, and conformance tests     |
| Add a service-worker event         | web service-worker Program language and adapter                   |
| Add a native UI primitive          | that native Platform extension only                               |
| Add a new Program kind             | its Platform extension plus one registration boundary             |
| Change Feature composition         | core Feature/System compiler and cross-adapter contract tests     |
| Change portable TypeScript         | generic frontend/backend and differential corpus                  |
| Change placement or scaling        | deployment contract and selected deployment adapter               |

Adding a normal web capability must not require teaching core or the generic
portable backend about that capability. If it does, either the extension
contract is insufficient or platform meaning has leaked into the substrate.

### Boundary invariants

`platforms/index.ts` is the package's single static registration point for
shipped Platforms. Adding a Program kind adds its extension and one
registration without changing an existing adapter.

`ProductionExposure` is the neutral delivery protocol shared by Platform and
Deployment adapters. Adding an exposure protocol may change that contract and
the Deployment adapters that support it; adding an ordinary Route,
Presentation declaration, or Component does not.

The neutral `kit` entry exports only substrate concepts. Reusable Feature
factories use explicit `kit/features/*` entries, while each Platform owns its
complete product language under its own entry. Importing the substrate cannot
evaluate an unrelated Feature, provider, or adapter.

### Resulting dependency graph

```text
core
  <- compiler neutral graph and TypeScript frontend
  <- adapter realization contracts

jsx/runtime
  <- UI-capable Platform languages

compiler extension contract
  <- server compiler dialect
  <- web compiler dialect
  <- future Platform dialects

realization coordinator
  -> selected Platform adapters
  -> immutable release artifacts

platforms/web
  -> web Program and Application languages
  -> routing, UI, Presentation, SSR, PWA, HMR, delivery, native web HTTP

platforms/server
  -> headless Program language
  -> TypeScript development and generated-Rust production
  -> generic server Dependency providers

platforms/index.ts
  -> the one shipped-Platform registration and explicit web/server attachment

deployment
  <- Platform artifacts, requirements, and generic exposure protocols only
  -> local or future target adapters
```

No arrow from core, the generic compiler IR, generic Rust lowering, the server
implementation, or Deployment points into web product meaning.

### Acceptance criteria

- A headless Program language can omit every UI concept.
- Two UI Platforms can define different structural and Presentation languages
  in one System without global JSX or TypeScript configuration conflicts.
- One Feature can co-locate Programs from several Platforms.
- Program implementations receive only declared Dependencies.
- Application interface syntax is fully Platform-owned.
- Development and production consume equivalent versioned meaning.
- A mock adapter can run the same semantic contract tests without browser,
  native, or deployment infrastructure.
- Adding an adapter requires no edits to existing adapters.
- Removing an adapter removes no neutral core capability.
- Deployment consumes artifacts and requirements without importing product UI
  semantics.

## Research Basis

This architecture combines established ideas rather than inventing an
unbounded plugin mechanism:

- Ports and Adapters isolates application logic behind purposeful,
  substitutable interfaces:
  https://alistair.cockburn.us/hexagonal-architecture
- The WebAssembly Component Model composes components by matching explicit
  required and provided interfaces:
  https://component-model.bytecodealliance.org/design/worlds.html
- MLIR dialects demonstrate extensible domain-owned IR with explicit legality
  and lowering boundaries:
  https://mlir.llvm.org/docs/DefiningDialects/
  https://mlir.llvm.org/docs/DialectConversion/
- Bazel separates target Platforms and Toolchains from the rules that consume
  them:
  https://bazel.build/extending/platforms
  https://bazel.build/versions/7.6.0/extending/toolchains
- Domain-driven bounded contexts support cohesive vertical ownership while
  allowing one domain model to span several physical services:
  https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model

## Composition

The compiler walks the Feature tree once, links Program contributions, resolves
Dependencies, and records exact output ownership. This supports:

- several Applications in one System;
- several platform interfaces per Application;
- shared and Application-private backend Programs;
- focused Application development without duplicating shared Programs;
- independent Program replicas in production.

Feature composition and cross-Feature communication are intentionally
different operations:

- the System and recursive Features own concrete Feature values;
- an Application declares typed roles over that graph and composes only its
  Platform interfaces;
- a UI-capable Program language may use JSX to compose visible Components;
- separately realized Programs communicate through typed Dependencies;
- a matching Presentation language enriches the exact structural contract
  owned by its Platform.

The compiler assigns every concrete Feature value a stable source identity.
When the same value contributes the same headless Program through several Applications,
linking retains one contribution and records all owning Applications. UI contributions
are assigned to the interface whose Platform matches their Environment. This
is semantic sharing, not heuristic deduplication by similar type or name.

Cross-Feature communication has one rule: composition reads an explicitly
exposed child API, while authority or communication across separately realized
Programs uses a typed Dependency. There is no service locator, global
dependency bag, hidden event bus, or adapter import in product code.

## Source Layout

The physical tree follows semantic ownership. One architectural unit owns one
directory. Its `index.ts` is the semantic boundary; implementations and tests
are nested beneath the same owner. A peer file and same-named directory never
represent one unit.

```text
Cargo.toml                    shared Rust verification workspace
Cargo.lock

src/
  core/          universal product-language meaning
  compiler/      TypeScript frontend, canonical IR, linking, and backends
  execution/     platform-neutral Process and Dependency semantics
  jsx/           shared JSX dispatch
  features/      shipped reusable Feature factories
  platforms/     Platform contracts and adapters
  deployment/    deployment contract, adapters, and artifact formats
  adapter.ts     Platform Adapter authoring contract
  factory.ts     Feature-factory compiler intrinsics
  index.ts       ordinary product facade
```

`execution/` is a genuine universal stage, not a technical catch-all: it owns
live interpretation of linked Program meaning, Process scopes, state, and
Dependency transport. Contracts are not collected in a global `contracts/`
directory: each contract stays beside the concept that owns it. Rust workspace
files live at the repository root because they coordinate repository tooling,
not TypeScript product source.

Top-level source entries are public contracts or whole-System coordination:

- `index.ts`, `factory.ts`, `deployment/index.ts`, and Platform modules define
  package entry points;
- `realization.ts` coordinates one compiled System with selected adapters;
- `testing/index.ts` verifies complete development and production realizations;
- `cli.ts` exposes the command boundary.

A Platform directory contains its contract and each complete adapter. An
adapter may use several implementation languages, but development and
production are adapter operations rather than source-ownership categories:

```text
platforms/
  server/
    index.ts
    adapter/
      index.ts
      adapter.spec.ts
      typescript/
      rust/
  web/
    index.ts
    adapter/
      index.ts
      adapter.spec.ts
      development.ts
      production.ts
      presentation/
      ui/
```

Generic TypeScript-to-Rust lowering is a compiler backend. It never recognizes
a Feature factory or platform-specific Dependency:

```text
compiler/
  rust/
    lowering.ts
    runtime/
```

A shipped Feature factory owns one directory. Its public model, factory,
portable Programs, UI, and TypeScript provider implementations remain
co-located in `index.ts`. Reusable test projections use `testing.ts`. Source in
another implementation language is organized first by Platform and then by
language:

```text
features/
  data/
    index.ts
    feature.spec.ts
    feature.typecheck.ts
    testing.ts
    providers/
      server/
        rust/
          Cargo.toml
          src/lib.rs
  identity/
    index.ts
    feature.spec.ts
    testing.ts
    providers/
      server/
        rust/
```

General host Dependency implementations live under their Platform. A provider
created specifically for a Feature lives with that Feature. A provider that
becomes independently reusable becomes its own Feature rather than entering a
global registry. `native` is not an ownership category: foreign source always
names both its Platform and implementation language.

Deployment follows the same ownership rule:

```text
deployment/
  index.ts
  adapters/
    local/
      index.ts
      adapter.spec.ts
  artifacts/
    oci/
      index.ts
      artifact.spec.ts
```

An OCI packager is an artifact implementation, not a Deployment adapter.
Cross-system verification has an explicitly named `integration.spec.ts`; test
names never encode incidental technologies through suffixes such as
`.native.spec.ts`, `.full.spec.ts`, or `.extra.spec.ts`.

The repository separates shared project setup from executable product source:

```text
config/                           shared TypeScript, test, lint, and format policy
template/                         package and toolchain scaffold
examples/basic/                   smallest complete System
examples/authenticated-crud/      representative multi-Feature System
examples/presentation/             difficult web Presentation fixture
```

Every example is a canonical runnable composition used for development,
verification, and `kit create --example`. Creation overlays one selected
example onto the scaffold, so there is no separate demo implementation to
drift. The repository and its examples extend `config/tsconfig.json` directly.
Generated workspaces consume the same package-owned policy through
`kit/tsconfig`.

`.kit/` is the sole framework-owned local state root. Persistent development
data lives under `.kit/data/`; deployment state and generated caches use their
own children beneath the same root. It is ignored because none of that state is
product source.

Platform adapters turn Program meaning into development sessions or immutable
production artifacts. Deployment adapters consume those artifacts and realize
them on a target. Deployment is therefore separate from both product Features
and Platform compilation; see [`deployment.md`](./deployment.md).

## Public Surface

Ordinary product code uses:

```text
kit
kit/web
kit/server
kit/features/actor
kit/features/aggregate
kit/features/identity
kit/features/model
kit/features/projection
kit/features/replica
kit/features/workflow
```

Feature-factory authors, tests, and deployment definitions use explicit
semantic entries:

```text
kit/factory
kit/testing
kit/deployment
```

Adapter authors use the explicit implementation entries:

```text
kit/adapter
kit/adapters/web
kit/adapters/server
kit/adapters/deployment/local
kit/deployment/oci
```

Compiler and runtime implementation modules remain private. Public declarations
are covered by type fixtures, example compilation, package verification, and
release smoke tests. GitHub releases retain the human-readable change history.

## Verification

Semantic verification is authored once in TypeScript. A Dependency owns a
reusable TypeScript conformance suite beside its contract. Asynchronous JSON
providers run that suite directly against TypeScript and Rust. Synchronous,
callback, and streaming contracts instead run a TypeScript-authored portable
Program or complete System specification through both realizations; converting
those calls into asynchronous subprocess IPC would change their semantics.
Rust-local tests are reserved for implementation-internal safety such as
persistence, fencing, parser behavior, and cache bounds.

Feature factories expose typed fixtures for concrete Features produced from
them. Those fixtures use deterministic in-memory Dependencies by default and
support controlled time, identity, faults, persistence, restart, and
synchronization only when the Feature owns those concepts. Application
developers never need Cargo or native source to test product behavior.

The verification ladder follows ownership:

| Change                 | Required verification                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Feature behavior       | adjacent TypeScript `feature.spec.ts`                            |
| Feature public types   | adjacent `feature.typecheck.ts` and root typecheck               |
| Dependency contract    | its TypeScript conformance suite against the reference provider  |
| TypeScript provider    | the owning Dependency conformance suite                          |
| Rust provider          | direct conformance or generated-Program conformance, as required |
| Portable subset or IR  | compiler tests and combined TypeScript/Rust differential corpus  |
| Rust compiler backend  | lowering tests, targeted Cargo check, differential corpus        |
| Platform adapter       | adjacent adapter contract suite                                  |
| Web UI or Presentation | focused web tests and browser verification                       |
| Deployment adapter     | deployment contract suite against that adapter                   |
| Public package meaning | type fixtures, affected examples, and package verification       |
| Release                | complete repository gate and focused release-mode smoke          |

Use the validation ladder while editing:

```sh
nub exec vitest run path/to/feature.spec.ts -t "changed behavior"
nub run typecheck
nub run check:source
nub run check:workflow
nub run check:compiler
nub run check:providers
nub run check:presentation
nub run check:production
```

The targeted test and incremental typecheck are the application and
Feature-factory inner loop. They never invoke Cargo. `check:source` is the
routine TypeScript milestone: typecheck, lint, formatting, and source tests
whose fixtures do not perform semantic System compilation. `check:workflow`
owns the compiler-backed Workflow conformance matrix and its focused debug
TypeScript/Rust differential evidence. It isolates runtime, compiler-backed,
and canonical-IR groups in separate Vitest processes so TypeScript compiler
graphs are released between them. Compiler, provider, adapter, browser, and
production gates run only for changes to their owned surfaces. `check`
remains the complete repository acceptance gate and builds the package at most
once. It runs `check:source`, Workflow conformance, generic compiler
differential conformance, provider/native conformance, one package build,
examples/package consumption, distribution typing, and focused release-mode
production smoke in that order. It is not an edit-loop command.

`kit dev` does not run `tsc`, package builds, or native compilation. It retains
one TypeScript semantic graph, ignores duplicate file notifications, computes
the affected outputs, and asks only their Platform Adapters to update. Adapters
report semantic updates and diagnostics through one framework event stream;
the CLI owns how those facts are rendered. Web generated sources and Vite
artifacts remain under `.kit/cache/web`, while repeated `kit typecheck` and
`nub run typecheck` calls reuse `.kit/cache/typescript.tsbuildinfo`.

Development and production adapters emit structured phase, diagnostic, update,
and artifact facts; they never format terminal output. In an interactive
terminal the CLI renders one transient status row and durable results. Redirected
output remains line-oriented, and `--json` emits the same facts as JSON Lines
for agents and automation. The renderer performs no timed redraw loop, so
terminal polish adds no work to compilation or hot replacement.

An exact restart reuses compiled System meaning from `.kit/cache/compiler`.
The cache is accepted only when the resolved TypeScript graph, relevant
configuration and package manifests, lockfile, TypeScript/compiler versions,
and Platform compiler extensions have identical content. External package
contents are represented by their manifests and the lockfile instead of being
rehashed file by file. TypeScript's language service is initialized lazily
after a cache hit: Presentation bodies and UI `view`, `actions`, and `start`
bodies can update from retained semantic meaning, while a structural edit
creates the semantic Program and falls back to the complete compiler.

The retained compiler stores independently hashed Feature and Presentation
units. A stale restart discards only units whose source closure changed, and
every incremental compiler test compares the resulting IR with a clean
compilation. Web HMR also distinguishes authored UI bodies from Presentation
bodies: the former preserves Program state only while the complete structural
manifest remains identical; the latter explicitly reconfigures the mounted
Presentation graph and its generated styles without rebuilding the Program.
Any structural manifest change reloads the web Program.

Generated native verification is similarly staged. Exact semantic matches use
the bounded content-addressed cache without invoking Cargo. IR and lowering
tests emit no executable, behavioral conformance defaults to debug artifacts,
and release compilation is reserved for production smoke, performance, and
release gates. The compilation graph, cache identities, work-avoidance
invariants, and active optimization checklist are defined in
[`compilation.md`](./compilation.md).

In a consuming Workspace, `kit typecheck` and `kit check` also compile
`src/system.ts` semantically after TypeScript succeeds. The selected compiler
extensions enforce each Platform's realization contract. Unsupported server
syntax therefore fails without invoking Cargo, while source-native web Programs
remain TypeScript.

`kit/testing` runs the same black-box System specification against development
and production realizations. Browser inspection is used for end-to-end product
behavior; committed tests verify framework semantics rather than browser
implementations.

Generated databases, caches, Rust targets, build output, and temporary source
are ignored and never part of the architecture.

## Exact Version Policy

Kit accepts only the current source, semantic IR, Feature API, persisted
Feature format, adapter contract, and wire protocol. There are no deprecated
aliases, migration hooks, upcasters, version negotiation paths, or additive
contract rollouts. A changed contract fails before execution and must be
replaced as one coordinated revision.

Development and production realizations pass the same current-contract suites.
Unsupported portable syntax, stale persisted data, stale generated IR, and
changed remote contracts are explicit errors. HMR retains state only when the
Platform-owned structural manifest is exactly unchanged.

The package is private and pre-1.0. Public changes require the affected type,
package, example, and release checks.
