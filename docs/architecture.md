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

```text
src/
  core/         product-language contracts
  compiler/     TypeScript meaning, IR, and linking
  runtime/      platform-neutral interpretation and Process scopes
  jsx/          shared JSX dispatch
  contracts/    adapter contracts
  platforms/    platform authoring languages
  features/     shipped reusable Feature factories
  adapters/     development and production realizations
```

Top-level source files are public facades or whole-System orchestration:

- `index.ts`, `ui.ts`, and platform modules define package entry points;
- `realization.ts` coordinates one compiled System with selected adapters;
- `testing.ts` verifies complete development and production realizations;
- `cli.ts` exposes the command boundary.

Adapter implementations organize by Platform, then by lifecycle:

```text
adapters/
  server/
    development/
    production/
  web/
    development/
    production/
    ui/
```

Adapter-root modules contain only coordination shared by concrete adapters:
registry wiring, public-package source resolution, and the explicit web/server
route-loader bridge.

Native-language code lives under the production profile that owns it.
Dependency implementations group by semantic Dependency, adding a technology
subdirectory only when several real implementations exist.

## Public Surface

Ordinary product code uses:

```text
kit
kit/ui
kit/web
kit/server
kit/testing
```

Adapter authors use the explicit advanced entries:

```text
kit/adapter
kit/adapters/web
kit/adapters/server
```

Compiler and runtime implementation modules remain private. Public declarations
are recorded in `docs/api.json`; an intentional change requires a file under
`changes/`.

## Verification

`nub run check` is the repository acceptance gate. It verifies declarations,
portable source, architecture boundaries, deterministic compiler behavior,
runtime and adapter contracts, web artifacts, Rust production crates, package
API drift, formatting, and linting.

`kit/testing` runs the same black-box System specification against development
and production realizations. Browser inspection is used for end-to-end product
behavior; committed tests verify framework semantics rather than browser
implementations.

Generated databases, caches, native targets, build output, and temporary source
are ignored and never part of the architecture.
