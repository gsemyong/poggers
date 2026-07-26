# Architecture

Kit is a portable TypeScript product language. A company Workspace describes
one System made from reusable Features. Features contribute Programs for
specific Environments, and Programs interact with authority outside their own
logic through typed Dependencies. Platform Adapters realize that meaning for
development and production.

```text
TypeScript product source
  -> System IR
  -> linked Programs
  -> Platform Adapters
       |- live development sessions
       `- production artifacts
```

## Invariants

1. **System is the only root.** It is the complete compilation and development
   boundary for one Workspace.
2. **Feature is the only recursive composition unit.** Apps and platform
   interfaces are marked Features, not parallel composition systems.
3. **Program is the authored deployment unit.** Same-named compatible
   contributions link into one Program. A live replica is a Process.
4. **Environment selects one Platform.** The Platform owns its authoring
   language and optional UI language; Environments do not repeat that meaning.
5. **Dependency is the interaction boundary.** A Dependency is provided either
   by another Feature contribution or by the selected Platform Adapter.
6. **Adapters own realization.** Core contains no browser, Node.js, Vite, Rust,
   database, transport, deployment, or protocol policy.
7. **Component owns UI behavior and structure.** Its view is a pure projection
   of state and props; actions mutate state and Programs perform effects.
8. **Presentation depends on Component meaning, never the reverse.** It may
   enrich named Elements with platform-specific experiential declarations but
   cannot mutate product behavior.
9. **One source revision has one semantic compilation.** Every adapter consumes
   the same versioned IR.
10. **The physical tree follows ownership.** Files split at real architectural,
    lifecycle, or distribution boundaries, not for mechanical symmetry.
11. **Portability is adapter-declared and frontend-enforced.** A Platform whose
    backend consumes portable IR rejects target source during semantic
    compilation. A source-native Platform may own source without weakening
    another Platform's invariant.

## Vocabulary

### Workspace

The source repository and development boundary. It contains one `src/system.ts`,
shared Features, App Features, Presentations, tests, and configuration. It is a
tooling convention, not an IR primitive.

### System

The company-level composition root. It contains metadata and named Features.
It contains no adapter instances, host wiring, or global Presentation registry.

```ts
export default createSystem({
  metadata: { name: "Company" },
  features: { identity, tasks, operations, customer },
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
    api: { start({ dependencies }) {} },
    browser: { state, actions, components },
  },
});
```

A Feature sees only its declared children and Dependencies. It has no ambient
access to the consuming System.

### App

A product experience marked by `createApp`. It remains an ordinary Feature and
may contain several platform-interface Features.

```ts
export const operations = createApp({
  features: { web, ios },
});
```

Web and iOS are interfaces of the App, not separate Apps. Shared domain Features
remain System siblings so several Apps can consume one backend contribution.

### Program And Process

A Program is the linked result of every compatible contribution with the same
concrete name. Different names produce independently realizable artifacts.
`placePrograms` maps logical roles used by a reusable factory to concrete names
at composition.

A Process is one running Program instance. Replication creates more Processes
from the same artifact. Coordination, sharding, persistence, and communication
are expressed through Dependencies rather than a second execution model.

### Environment And Platform

An Environment names one execution context, such as `browser-main`,
`browser-service-worker`, or `server`, and selects one Platform.

A Platform defines the authoring and realization family. Every Platform can run
headless Programs; some also own a UI language. The web Platform, for example,
owns browser structure, routes, navigation, metadata, rendering policy,
installation, service-worker meaning, and its Presentation language.

### Dependency

A typed API for authority or meaning not implemented at the call site. It may
be synchronous, asynchronous, streaming, stateful, pure, or effectful.

There are two provider origins:

1. another Feature contribution provides a portable semantic API;
2. a Platform Adapter provides a host API still unresolved after linking.

The linker rejects missing, duplicate, incompatible, and cyclic providers. Each
Process owns one provider scope and disposes it in reverse ownership order.
Process-local instantiation does not imply process-local data: a provider may
connect every replica to shared infrastructure.

### Component And Presentation

A Component declares props, state, synchronous actions, slots, hierarchy,
accessibility, lifecycle, and named Elements. Components compose through JSX
while platform primitives remain platform-specific.

A Presentation maps the exact Component contract to one Platform's experiential
declarations. It may read props, state, named Elements, observations, and typed
parameters. Reuse comes from pure recipes and factories; object spread is the
only explicit override mechanism.

### Platform Adapter

The implementation contract for one Platform:

```ts
type PlatformAdapter<Platform> = {
  name: Platform["Name"];
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
  ui?: UIAdapter<Platform["UI"], unknown, unknown>;
};
```

Development prioritizes fast startup, diagnostics, and state-preserving hot
replacement. Production prioritizes deterministic, minimal artifacts. Both
consume the same linked IR and may use different implementation languages.

## Composition

The compiler walks the Feature tree once, links Program contributions, resolves
Dependencies, and records exact output ownership. This supports:

- several Apps in one System;
- several interfaces per App;
- shared and App-private backend Programs;
- focused App development without duplicating shared Programs;
- independent Program replicas in production.

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

Top-level source entries are public facades or whole-System coordination:

- `index.ts`, `ui.ts`, `factory.ts`, `deployment/index.ts`, and Platform modules
  define package entry points;
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
kit/ui
kit/web
kit/server
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
nub run test
nub run check:compiler
nub run check:providers
nub run check:presentation
nub run check:production
```

The first two commands are the application and Feature-factory inner loop.
They never invoke Cargo. `test` is the complete TypeScript development
milestone and does not compile generated Programs. Compiler, provider, adapter,
browser, and production gates run only for changes to their owned surfaces.
`check` remains the complete repository acceptance gate and builds the package
at most once.

`kit dev` does not run `tsc`, package builds, or native compilation. It retains
one TypeScript semantic graph, ignores duplicate file notifications, computes
the affected outputs, and asks only their Platform Adapters to update. Adapters
report semantic updates and diagnostics through one framework event stream;
the CLI owns how those facts are rendered. Web generated sources and Vite
artifacts remain under `.kit/cache/web`, while repeated `kit typecheck` and
`nub run typecheck` calls reuse `.kit/cache/typescript.tsbuildinfo`.

Generated native verification is similarly staged. Exact semantic matches use
the bounded content-addressed cache without invoking Cargo. IR and lowering
tests emit no executable, behavioral conformance defaults to debug artifacts,
and release compilation is reserved for production smoke, performance, and
release gates.

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

## Compatibility

Kit has three compatibility boundaries:

1. portable TypeScript accepted by the compiler;
2. product-facing APIs exposed by Feature factories;
3. adapter contracts connecting semantic meaning to realizations.

An adapter must accept the current semantic IR version and implement every
Platform contract it declares. Development and production realizations pass
the same contract suites. Unsupported portable syntax is a compilation error,
never a silent runtime fallback.

The package is private and pre-1.0. Public changes require the affected type,
package, example, and release checks.
