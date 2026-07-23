# Framework architecture

Status: normative target and live gap analysis.

This document defines the end state of the framework and records the distance
between that state and the current repository. The target sections are
normative. The gap ledger describes the implementation as audited on
2026-07-23; a gap is not complete until its stated evidence exists.

The framework is a portable TypeScript product language. One company repository
describes a complete System made from reusable Features. Features co-locate
logic for Programs that run in different Environments, and Programs interact
with authority outside their own code through typed Dependencies. Platform
Adapters turn that meaning into hot-reloadable development processes and
optimized production artifacts.

The framework should make product code semantic, type-safe, portable, and easy
to compose. It should not make every product author understand compiler,
deployment, transport, native-language, or adapter plumbing.

## North star

The final model is:

```text
Workspace
`- System
   |- shared Features
   |  `- Program contributions
   |- App Features
   |  |- private Features
   |  `- platform-interface Features
   |     |- Components and routes
   |     |- Presentation selection
   |     `- platform installation metadata
   `- compiled Programs
      `- live Processes
```

The essential flow is:

```text
typed TypeScript product source
  -> one canonical, versioned System IR
  -> linked Program IR
  -> selected Platform Adapters
       |- development sessions with hot replacement
       `- optimized production artifacts
```

The architectural invariants are:

1. **Feature is the only composition unit.** Shared domain behavior, Apps,
   platform interfaces, and optional product groupings are all Features or
   reusable Feature factories. Core does not need a second composition tree.
2. **System is the only root.** A System describes the complete company-level
   composition compiled and developed together.
3. **App is not a new core primitive.** An App is a specialized Feature made by
   an app Feature factory. One App may contain web, native, desktop, and other
   platform interfaces.
4. **Program is the deployment unit.** Same-named contributions from the
   Feature tree link into one Program. A live replica of that artifact is a
   Process.
5. **Dependency is the interaction boundary.** Product code uses typed
   Dependencies for external authority and shared semantic APIs. Concrete
   hosts, protocols, databases, and native libraries remain behind providers
   or Platform Adapters.
6. **Adapters own realization.** Core carries no Vite, Node.js, Rust, Swift,
   browser, database, transport, SSR, PWA, or deployment implementation.
7. **UI meaning remains platform-specific.** JSX is shared syntax, while
   structural primitives, accessibility, navigation, observations, and
   Presentation declarations belong to a UI Platform.
8. **Presentation depends on behavior, never the reverse.** A Presentation may
   read typed Component meaning and enrich Elements, but it cannot mutate
   product behavior or invoke actions.
9. **There is one semantic compile per source revision.** Adapters consume the
   resulting IR; they do not create independent TypeScript compiler graphs for
   the same revision.
10. **The physical tree mirrors architectural ownership.** A file exists for
    one clear concept or one substantial implementation unit. Empty symmetry,
    mechanical splitting, and residue are not architecture.

## Vocabulary

These names are precise and non-overlapping.

### Workspace

A Workspace is the source repository and development boundary. It contains one
System, shared Features, Apps, shared Presentations, tests, and configuration.
Workspace is a tooling term, not product meaning and not part of core IR.

### System

A System is the complete compilation and development root. It owns metadata and
one Feature tree. It does not contain adapter instances, infrastructure wiring,
or a global Presentation registry.

The current `Application` type has the responsibilities of this future System
and should be renamed rather than supplemented with another root abstraction.

### Feature

A Feature is a reusable vertical slice and the sole recursive composition
primitive. A Feature may:

- compose child Features;
- contribute to one or more named Programs;
- require typed Dependencies;
- provide semantic Dependencies;
- define state, actions, Components, and routes for a UI Program;
- expose a domain-focused API;
- provide specialized testing support when its domain needs it.

A Feature receives only the APIs and Dependencies it declares. There is no
ambient, untyped access to the whole System. A composition Feature coordinates
siblings explicitly when coordination is product meaning.

### App

An App is a product-level experience represented by a specialized Feature. It
is not synonymous with web, mobile, or a deployment artifact. One App can have
several platform interfaces and can consume System-shared Features.

Examples are an operations app and a customer app. Each may provide a web PWA
and a native interface while sharing identity, tasks, billing, and server
Programs.

### Program and Process

A Program is all same-named Feature contributions linked into one independently
realizable artifact for one Environment. Logical Program roles inside reusable
factories may be placed into concrete Program names at composition.

A Process is one running instance or replica of a Program. Horizontal scaling
creates more Processes from the same artifact. Replication, sharding,
coordination, and remote communication are expressed through Dependencies and
adapter configuration, not through a second Program model.

### Environment and Platform

An Environment names the execution context of a Program and selects one
Platform. Examples include a browser main thread, browser service worker,
owned server, user-hosted server, iOS foreground process, and iOS background
process.

A Platform defines the public authoring language for a related family of
Environments. Every Platform supports headless Processes; a Platform may also
define a UI language.

### Dependency

A Dependency is a typed API through which a Program accesses authority or
meaning not implemented at the call site. It can be synchronous, asynchronous,
streaming, stateful, pure, or effectful.

There are exactly two provider origins:

1. A Feature contribution provides a portable semantic Dependency.
2. A Platform Adapter provides a Dependency still unresolved after linking.

For each Program, the linker rejects missing or duplicate providers,
incompatible contracts, and cycles. One Process creates one provider scope;
consumers share each binding in that scope and disposal follows reverse
ownership order. A provider may connect every Process to shared distributed
infrastructure, so process-local instantiation does not imply system-local
state.

### Component and Presentation

A Component owns UI behavior: props, state, synchronous actions, hierarchy,
listeners, accessibility, lifecycle, and named Elements. Rendering is a pure
projection of current props and state. Effects and external authority remain in
Program code and Dependencies.

A Presentation is a typed, platform-specific mapping from Component meaning to
visual and experiential declarations. It can use props, state, Elements,
environment observations, explicit parameters, and declarative temporal
meaning. It cannot change structure or product behavior unless the Platform's
public UI contract explicitly models that meaning.

### Platform Adapter

A Platform Adapter is the top-level implementation contract for one Platform.
It owns:

- source extensions for the Platform language;
- development execution and hot replacement;
- production artifact generation;
- unresolved Environment Dependency implementations;
- UI and Presentation realization when the Platform supports UI.

JavaScript, Vite, Rust, Swift, Cargo, SwiftPM, SQLite, NATS, the DOM, CSS, and
graphics engines are implementation details below this boundary.

## Composition semantics

### One System, many Apps

The System Feature tree contains shared Features and App Features as siblings.
Shared domain Features are instantiated once in source. Their same-named server
contributions link once into shared server Programs. App Features consume their
semantic APIs without copying their providers.

An App contains private Features and platform-interface Features. A web
interface Feature owns its web routes, metadata, installation manifest, service
worker contribution, selected Presentation, and browser Program contribution.
A native interface Feature owns equivalent native meaning. Neither web nor
native is itself an App.

This model supports:

- multiple Apps in one company Workspace;
- several platform interfaces per App;
- one shared backend used by several Apps;
- App-private backend contributions;
- several independently named server Programs;
- several replicas of any Program in production;
- focused development or build of one App while preserving its shared
  dependencies.

The settled composition syntax is:

```ts
const shared = createFeature<SharedContract>({ programs: { api: {} } });

const web = createWebInterface<WebContract>({
  programs: { browser: webProgram },
  presentation,
  installation,
});

const operations = createApp<OperationsContract>({
  features: { web },
});

export default createSystem({
  metadata: { name: "Company" },
  features: { shared, operations },
});
```

`createFeature` retains the contract that `satisfies` can validate but cannot
preserve in an inferred value. `createApp` and `createWebInterface` only enrich
that same Feature contract with type-level ownership. `createSystem` infers the
complete root contract from those values, so the Feature map is never repeated
as a root generic type argument.

### Cross-Feature communication

Reusable Feature factories expose an ideal domain API and lower it to the core
Feature, Program, and Dependency contracts. Product authors consume the domain
API rather than wiring transports or hosts.

Feature-to-Feature communication has one rule:

- direct composition uses an explicitly exposed typed child API;
- authority, asynchronous communication, or separately realized Programs use a
  typed Dependency.

There is no service locator, global dependency bag, hidden event bus, or
adapter import in product code.

### Program assembly

The compiler recursively collects contributions from the complete System
Feature tree. Contributions with the same concrete Program name and compatible
Environment link into one Program. Different names produce independent
artifacts.

App and platform Feature factories may use logical Program role names
internally. Composition maps those roles to concrete names once. This permits
two Apps to share one server Program or to isolate their server workloads
without changing the reusable Feature factory.

## UI and Presentation ownership

Shared JSX remains one TypeScript syntax dispatcher so a source file can use
different Platform JSX vocabularies. JSX does not imply a universal DOM or one
cross-platform primitive set.

Each UI Platform defines:

- primitive Elements and structural properties;
- events, accessibility, and navigation meaning;
- target handles and platform observations;
- its Presentation declaration language;
- the adapter contract that realizes those declarations.

Presentation ownership moves from the System root to the platform-interface
Feature that owns the Component tree. This is necessary because two Apps may
have unrelated trees, and one App may have web and native interfaces with
different Presentation languages.

Presentation reuse has three explicit levels:

1. **Parameters and assets** share brand values, icons, fonts, audio, and other
   typed inputs.
2. **Recipes** share pure declaration constructors for compatible Element and
   state contracts.
3. **Presentation factories** create a complete typed Presentation for a
   concrete platform-interface contract.

A concrete Presentation is directly reusable only when the Component contract
is compatible. Different trees reuse parameters, recipes, or a generic factory.
Factories and recipes are ordinary typed pure functions. Object literals
assemble their results. A duplicate direct property is a TypeScript error;
object spread is the sole explicit override mechanism, and its source order
states precedence. Core adds no implicit inheritance, cascade, deep merge, or
last-writer-wins registry.

The existing generic Presentation type is a strong foundation: it already
binds a Presentation to the exact Component hierarchy, props, state, events,
Elements, environment observations, parameters, and Platform language. The
ownership and reusable factory API need adjustment, not a second presentation
model.

## Adapter and language model

The stable adapter shape remains conceptually:

```ts
type PlatformAdapter<Platform> = {
  name: Platform["Name"];
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
  ui?: UIAdapter<Platform["UI"], unknown, unknown>;
};
```

Both profiles consume the same linked IR:

- Development prioritizes immediate startup, state-preserving hot replacement,
  source diagnostics, and inspection. A JavaScript runtime is an implementation
  choice, not product meaning.
- Production prioritizes deterministic, minimal, optimized artifacts. An
  adapter may lower portable Program code to Rust, Swift, JavaScript, or several
  languages.

Compiler-derived Dependency IR is the source of truth. A TypeScript development
host, generated Rust trait, or generated Swift protocol must be checked against
that same contract. Product operation signatures are never maintained manually
in several languages.

Adding an iOS Platform should require additions under `platforms/ios` and
`adapters/ios`, plus registry and export changes. It must not require changing
System, Feature, Program, Dependency, Component, Presentation, or generic IR
semantics.

## Web Platform ownership

Web-specific concerns remain entirely in the web Platform and adapter:

- typed routes, params, search, navigation, redirects, and metadata;
- browser, service-worker, and server Program integration;
- client rendering, server rendering, caching, hydration, and code splitting;
- documents, assets, styles, and Presentation compilation;
- PWA manifests, installation, offline behavior, and service workers;
- development HMR and production browser/server artifacts.

Each web interface Feature owns one independently addressable web output and
its installation metadata. A System may therefore build several PWAs without a
global manifest or global route namespace. Shared server Programs remain shared
rather than starting once per PWA.

Rendering policy is a web Feature concern and compiler input, not a generic core
concept. The web adapter may optimize that meaning into cached HTML, streamed
responses, client-only navigation, selective hydration, and crawler artifacts
without leaking those mechanisms into core.

## Target authoring Workspace

Every generated company Workspace follows one convention:

```text
src/
  system.ts
  features/
    identity.ts
    tasks.ts
  presentations/
    company-web.ts
  apps/
    operations/
      app.tsx
      features/
        dashboard.tsx
      presentations/
        operations-web.ts
    customer/
      app.tsx
      features/
        account.tsx
      presentations/
        customer-web.ts
```

Ownership is:

- `src/system.ts` composes the complete System.
- `src/features/` contains System-shared Feature instances.
- `src/presentations/` contains shared Presentation factories, recipes,
  parameters, and assets.
- `src/apps/<name>/app.tsx` defines one App Feature and its platform interfaces.
- `src/apps/<name>/features/` contains App-private Feature instances.
- `src/apps/<name>/presentations/` contains App-private Presentations.

The `features` and `presentations` directories are stable conventions at both
shared and App scope. Tests stay beside the subject they prove and exist only
when they protect meaningful behavior. Product Workspaces do not contain
adapter, compiler, runtime, host, or manual Dependency-wiring directories.

## Target framework repository

The framework remains one package:

```text
src/
  core/          portable product meaning
  compiler/      TypeScript extraction, canonical IR, and linking
  runtime/       reference Process and UI execution
  jsx/           shared JSX toolchain entry points
  contracts/     Platform Adapter contracts
  platforms/     public platform authoring languages
  adapters/      concrete platform realizations
  features/      reusable semantic Feature factories
  realization.ts
  testing.ts
  cli.ts
  index.ts
examples/
  basic/         canonical runnable starter used by create
  authenticated-crud/
playground/      mutable Feature and adapter development laboratory
docs/
changes/
scripts/
  build.ts
```

This is already close to the current `src/` layout. The target does not justify
a broad directory reshuffle.

Directory rules:

- one substantial implementation unit may remain a large file;
- split only at a real ownership, dependency, testing, caching, or distribution
  boundary;
- do not create generic `internal`, `native`, `types`, `helpers`, or `utils`
  directories;
- development and production are the primary adapter profiles;
- language-specific source lives under the profile that owns it;
- Dependency implementations are grouped by semantic Dependency, with a
  technology subdirectory only when several real implementations exist;
- generated artifacts, caches, databases, and native build output are ignored
  and never committed.

## External developer experience

### Creation and commands

The canonical starter is `examples/basic`; there is no separate drifting
`template/` copy. The CLI copies that example and rewrites only project-local
identity and package location.

The intended command vocabulary is:

```text
kit create <workspace>
kit dev
kit dev <app>
kit build
kit build <app>
kit check
```

`kit` is the intended neutral command name in this document. The eventual
package locator may differ, but branding is not allowed to leak into IR,
generated identifiers, cache keys, or architectural names.

`kit dev` starts shared Programs once and every App interface. `kit dev <app>`
focuses the requested App while retaining the shared Programs it needs.
Equivalent rules apply to builds.

### Public API

Ordinary product authors should see semantic composition and reusable Feature
factories, not compiler or adapter plumbing. Public entry points should be
small and intentional:

```text
kit
kit/web
kit/<feature-factory>
kit/testing
```

Adapter authoring may use an explicit advanced contract entry point. Concrete
shipped adapters may be public for framework assembly, but compiler and runtime
implementation modules remain private. The package root must not expose
low-level implementation APIs merely because they are used internally.

### Feature factories

Feature instances belong in the company Workspace. New reusable kinds of
Feature factory belong in the central framework repository. A factory should
provide:

- one semantic type model with validation helpers;
- one inferred domain API;
- portable Program contributions and Dependency contracts;
- optional Components and platform interfaces;
- focused domain testing support when useful;
- no app-specific host wiring.

Entity, identity, workflow, search, and other factories can expose very
different domain languages while lowering to the same small core.

### Change management

The package has one version. Feature factories are not independently versioned
inside it.

Before version 1, the repository needs:

- a root `CHANGELOG.md`;
- change fragments grouped by affected public entry point or Feature factory;
- `docs/migrations/` for every breaking public change;
- a compatibility and deprecation policy;
- Feature factory authoring guidelines;
- generated public API manifests for every exported subpath.

CI should require a change fragment when a public API manifest changes and a
migration document when the change is breaking.

## Development performance model

Development should use one retained semantic graph for the System:

```text
one TypeScript graph
  -> one System IR per revision
  -> affected Program and App-interface slices
  -> concurrently started Adapter sessions
  -> state-preserving HMR
```

The compiler owns incremental source meaning. Adapters receive IR and affected
source information; they must not compile the System again. Web development
uses a persistent Workspace cache and one coordinated Vite graph or equivalent
multi-entry graph where feasible. Generated virtual modules are preferred when
writing a temporary source tree provides no semantic value.

A shared Feature edit updates every affected App and Program. An App-private
edit does not rebuild unrelated Apps. Shared server Programs start once.

Performance gates measure phases separately:

- source discovery;
- TypeScript graph creation or update;
- semantic extraction and linking;
- adapter preparation;
- development server readiness;
- first browser response;
- HMR propagation.

Absolute budgets should be recorded after the target pipeline exists. Until
then, structural gates are mandatory: one semantic compile, persistent caches,
concurrent independent startup, and no Program or backend duplication caused by
the number of Apps.

## Current state

The current repository already has useful foundations:

- one package with clear top-level `core`, `compiler`, `runtime`, `contracts`,
  `platforms`, `adapters`, and `features` ownership;
- recursive Features, named Program contributions, typed Dependencies,
  linking, Process scopes, and Program placement;
- shared JSX dispatch with platform-specific UI languages;
- a generic, exact, typed Presentation contract;
- server and web Platform Adapter contracts;
- TypeScript compiler extraction and canonical Application IR;
- JavaScript development and Rust production work for server Programs;
- reusable entity and identity Feature factories;
- focused unit, property, type, adapter, and end-to-end tests for the existing
  single-Application model.

Those foundations should be evolved, not replaced.

The current root is nevertheless one `Application` with one global
Presentation registry and optional global web installation. Source discovery
loads exactly one `src/app.tsx` or `src/app.ts`. Application IR contains one
application record. Realization selects adapters for that one root. The web
pipeline selects one browser UI root and one installation. The CLI accepts one
directory and the packaged starter lives in a separate `template/`.

The audit evidence is:

- [`core/application.ts`](../src/core/application.ts) defines
  `ApplicationContract`, global Presentations, and the complete Application
  root.
- [`compiler/source.ts`](../src/compiler/source.ts) resolves and compiles one
  Application entry.
- [`compiler/ir.ts`](../src/compiler/ir.ts) serializes one `application` record
  and global Presentations in `ApplicationIR`.
- [`realization.ts`](../src/realization.ts) realizes one Application and starts
  selected adapters serially.
- [`platforms/web/routing.ts`](../src/platforms/web/routing.ts) refines the
  Application with one optional web installation.
- [`adapters/web/pipeline.ts`](../src/adapters/web/pipeline.ts) creates its own
  compiler graph and realizes one web Application contract.
- [`adapters/server/development/session.ts`](../src/adapters/server/development/session.ts)
  creates another compiler graph for server development.
- [`cli.ts`](../src/cli.ts) targets one directory, finds `template/`, and exposes
  the current branded command.
- [`package.json`](../package.json) publishes the current branded package,
  low-level adapter entry points, and the separate template.

## Gap ledger

| ID  | Area                         | Current state                                                                                                                  | Required end state                                                                                                   | Status     |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------- |
| G01 | Root meaning                 | `Application` is the single composition root.                                                                                  | Rename that responsibility to `System`; do not add a parallel root abstraction.                                      | Missing    |
| G02 | Apps                         | No first-class reusable App Feature factory or App registry exists.                                                            | Apps are marked Features discoverable for focused dev/build and output ownership.                                    | Missing    |
| G03 | Multiple platform interfaces | Web installation and UI ownership are global to one Application.                                                               | Every App can own several platform-interface Features and several independent outputs.                               | Missing    |
| G04 | Presentation ownership       | Presentations live on `ApplicationContract` and Application values.                                                            | Presentation selection belongs to each UI platform interface; shared reuse is explicit.                              | Missing    |
| G05 | Compiler entry               | `resolveApplication` discovers one `src/app.ts(x)`.                                                                            | Discover one `src/system.ts` and recursively identify App and interface Features.                                    | Missing    |
| G06 | Canonical IR                 | `ApplicationIR` has one application record and global presentations.                                                           | Versioned `SystemIR` records the Feature tree, Apps, interfaces, ownership, and Programs.                            | Missing    |
| G07 | Realization                  | One Application is compiled, then adapter sessions start serially.                                                             | Compile once; select affected Programs/interfaces; start independent sessions concurrently.                          | Partial    |
| G08 | Shared backend               | Same-named Programs link within one Application, but multi-App ownership is absent.                                            | Shared Programs link once across all Apps; focused App mode retains required shared Programs.                        | Partial    |
| G09 | Web output                   | One browser root, one manifest, one service-worker installation, one web output.                                               | One independently routed and installable web output per web interface Feature.                                       | Missing    |
| G10 | Presentation reuse           | Exact typing exists; no settled public factory/recipe composition convention.                                                  | Explicit parameters, recipes, and factories with typed collision/override rules.                                     | Partial    |
| G11 | Development graph            | Root, server, and web paths can create separate compiler graphs; web uses fresh temporary Vite cache; adapters start serially. | One retained compiler graph, persistent cache, shared web graph where possible, and incremental affected-output HMR. | Missing    |
| G12 | Starter and examples         | A separate `template/` can drift from two examples; no canonical `basic` example or playground exists.                         | `examples/basic` is both golden starter and runnable test; add stable examples and one mutable playground.           | Missing    |
| G13 | CLI                          | Commands target one Application directory and use product branding.                                                            | Neutral commands understand a System, all Apps, and focused App dev/build.                                           | Missing    |
| G14 | Public package surface       | Root and subpaths expose low-level Platform, Adapter, and implementation APIs under `@poggers/kit`.                            | Product users receive semantic factories and composition; advanced adapter APIs are isolated and intentional.        | Partial    |
| G15 | Branding                     | `Poggers` appears in package name, CLI, IR version symbols, caches, generated code, examples, and copy.                        | Choose a neutral external name and perform one atomic rename without architectural leakage.                          | Missing    |
| G16 | Change governance            | No change-fragment workflow, public API manifests, compatibility policy, or migration directory.                               | Public changes are machine-detected, documented, and accompanied by migrations.                                      | Missing    |
| G17 | Target conformance tests     | Existing tests prove the old single-Application contract.                                                                      | Tests prove System composition, multi-App ownership, focused builds, shared Programs, interface isolation, and HMR.  | Missing    |
| G18 | Runtime evidence             | Historical browser and production claims do not establish the new model and must not be treated as current acceptance.         | Fresh in-app browser development and production evidence covers every supported example and target invariant.        | Unverified |

## Migration sequence

The order prevents adapter work from defining core semantics accidentally.

### 1. Freeze the target contract

- [ ] Add type-level fixtures for System, App Feature, shared Features, two Apps,
      two web interfaces, and one App with web plus native interfaces.
- [ ] Settle the exact inferred App Feature factory syntax without adding a core
      App primitive.
- [ ] Settle explicit Presentation factory and recipe composition rules.
- [ ] Record current public API manifests and startup phase measurements.

### 2. Rename and generalize the root

- [ ] Rename Application semantic responsibility to System across core,
      compiler, runtime, realization, tests, and generated identifiers.
- [ ] Preserve Feature, Program, Process, Dependency, Environment, Platform,
      Component, and Presentation semantics.
- [ ] Remove Presentations from the System contract.
- [ ] Add typed App and platform-interface Feature markers through reusable
      factories.

### 3. Lower the complete System

- [ ] Resolve `src/system.ts`.
- [ ] Introduce a versioned System IR that preserves Feature, App, interface,
      Program, and Presentation ownership.
- [ ] Link same-named compatible Program contributions once across the System.
- [ ] Reject duplicate App/interface identities, incompatible Program
      Environments, route collisions within one interface, and invalid
      Presentation ownership.
- [ ] Emit deterministic affected-output relationships for incremental builds.

### 4. Correct realization and adapters

- [ ] Pass one compiled System IR to every selected adapter.
- [ ] Remove per-adapter compiler construction for the same revision.
- [ ] Start independent adapter sessions concurrently and dispose them
      deterministically.
- [ ] Let adapters return artifacts and locations keyed by Program and
      platform-interface identity.
- [ ] Ensure focused App mode starts only the App, its interfaces, and required
      shared Programs.

### 5. Make web multi-interface

- [ ] Move routes, metadata, rendering policy, Presentation selection,
      installation, and service-worker ownership into a web interface Feature.
- [ ] Generate isolated route namespaces, browser entries, manifests, caches,
      and service workers per interface.
- [ ] Share server Programs and generated assets when their semantic owner is
      shared.
- [ ] Preserve direct loads, client navigation, redirects, hydration, styling,
      focus, and HMR for nested Feature routes.

### 6. Establish the external Workspace

- [ ] Replace `template/` with `examples/basic`.
- [ ] Add the System, shared Feature, shared Presentation, and `apps/`
      convention to the starter.
- [ ] Add a mutable `playground/`.
- [ ] Teach create, dev, build, test, and check commands about all Apps and
      focused App selection.
- [ ] Keep generated Workspaces one package unless a real distribution boundary
      requires otherwise.

### 7. Tighten the package and repository

- [ ] Choose and apply the neutral package and CLI name atomically.
- [ ] Reduce ordinary public exports to semantic composition, shipped Feature
      factories, Platform authoring, and testing.
- [ ] Isolate adapter authoring and concrete adapter entry points.
- [ ] Remove superseded examples, benchmarks, generated residue, and duplicate
      setup only after their replacement gates pass.
- [ ] Add change governance and Feature factory authoring guidance.

### 8. Optimize and prove

- [ ] Instrument every development startup and HMR phase.
- [ ] Use one retained semantic graph and persistent caches.
- [ ] Verify shared Feature changes update all affected Apps without restarting
      unrelated Programs.
- [ ] Run the complete verification matrix below from a clean checkout.
- [ ] Mark gaps complete only with linked automated evidence.

## Verification gates

### Semantic and type gates

- A two-App System infers every shared and private Feature API without casts.
- One App can contain web and native interface Features.
- A reusable Feature factory remains unaware of the System that consumes it.
- Missing, duplicate, incompatible, and cyclic Dependency providers fail at
  compile or link time with source-located diagnostics.
- Same-named compatible Program contributions merge; incompatible Environments
  fail.
- App and route identities are isolated and deterministic.
- Presentation factories cannot target incompatible Component contracts.
- Core imports no Platform, Adapter, compiler implementation, native language,
  or web concern.

### Compiler and artifact gates

- Exactly one semantic compile occurs for an initial revision.
- System IR serialization is deterministic across repeated builds.
- Development and production consume the same linked Program and Dependency IR.
- `kit build` emits all shared Programs and App interfaces exactly once.
- `kit build <app>` emits the selected App plus required shared artifacts only.
- Two web interfaces produce independent browser entries, manifests, route
  maps, cache namespaces, and service workers.
- No product-specific Feature type or hand-written operation schema appears in
  generated native runtime code.

### Runtime gates

- Two Apps use one shared identity and task server Program.
- App-private Programs remain isolated.
- Multiple Process replicas receive independent scopes while shared external
  infrastructure preserves intended coordination.
- Startup, partial failure, and disposal are deterministic.
- Development and Rust production pass the same portable Program behavior
  fixtures.

### Browser gates

Use the in-app browser as the end-to-end verification surface against
development and production. Do not add a committed Chromium, Firefox, or WebKit
test matrix; the purpose is to verify framework behavior, not browser-engine
behavior.

- direct loading and refreshing every nested route is styled and correct;
- typed params, search, navigation, redirects, and metadata are correct;
- authentication redirects to the correct URL rather than rendering the wrong
  route in place;
- create, edit, complete, delete, and subscription flows retain focus and
  settle without reload loops;
- each PWA has the correct manifest, offline fallback, service worker, and cache
  isolation;
- shared Feature HMR updates every affected App without full-page navigation;
- App-private HMR leaves unrelated Apps and shared server Processes running;
- browser console, uncaught errors, hydration diagnostics, and failed network
  requests are empty.

### Performance gates

- Startup instrumentation proves one compiler graph and no per-adapter
  recompilation.
- Independent adapters begin concurrently.
- Vite or equivalent cache paths are stable across restarts.
- HMR rebuilds only affected Programs and interfaces.
- Adding a second App does not duplicate shared backend startup or compilation.
- Recorded cold-start, warm-start, first-response, and HMR budgets do not
  regress without an explicit accepted change.

### Repository gates

- `nub run check` and `nub run build` pass from a clean checkout.
- The packed package contains only intentional public files.
- A project created from `examples/basic` installs, checks, develops, builds,
  and runs independently.
- No generated database, cache, native target, build output, or temporary
  application source is tracked.
- Documentation, public API manifests, changelog, and migration records match
  the shipped package.

## Deliberately open API decision

The architecture and composition syntax are settled without pretending that
branding is settled. The final neutral package locator and CLI name remain
open.

That decision must not change semantic identifiers or introduce a second
composition unit, global Presentation ownership, implicit dependency lookup, or
adapter concerns in core.

## Definition of done

The repository reaches this end state only when:

- the target vocabulary maps one-to-one to code and directories;
- one System composes several Apps and shared Features;
- each App can own several platform interfaces;
- compiler, adapters, CLI, examples, and public exports use that model;
- development is incremental and production artifacts preserve the same
  semantics;
- browser and native production paths pass the verification gates;
- the old single-Application path and duplicate starter are removed;
- no compatibility residue remains unless a published compatibility policy
  explicitly requires it;
- every gap in this document is supported by current automated evidence.
