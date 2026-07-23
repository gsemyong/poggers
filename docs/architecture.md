# Poggers architecture

Poggers is a portable TypeScript product language. An Application composes
reusable Features; each Feature contributes logic to named Programs, and each
Program runs in one Environment through a Platform Adapter. Programs interact
with authority outside their own code only through typed Dependencies.

The framework deliberately does not prescribe storage, transport,
synchronization, authentication, deployment topology, or a universal UI. Those
are expressed by Features and realized by adapters.

## Product model

```text
Application
|- Features
|  `- named Program contributions
|     |- require Dependencies
|     |- provide semantic Dependencies
|     `- may define state, actions, Components, and UI
`- Presentations

compiled Program
|- one contribution from every participating Feature
|- one Environment and Platform
`- one linked Dependency graph

Process
|- one live instance or replica of a compiled Program
|- one adapter-owned external Dependency scope
`- one instance of every Feature-provided Dependency
```

- **Application** is the composition root and product metadata.
- **Feature** is a reusable vertical slice. It may compose child Features and
  contribute to several Programs.
- **Program** is all same-named Feature contributions assembled into one
  independently realizable artifact.
- **Environment** names the execution context of a Program and selects one
  Platform.
- **Platform** defines the public authoring language for a related family of
  Environments. UI support is optional.
- **Process** is one running Program instance. Horizontal replicas are
  independent Processes built from the same artifact.
- **Dependency** is a typed API through which a Program accesses authority or
  shared meaning not implemented at the call site.
- **Component** owns UI behavior: state, actions, hierarchy, lifetime,
  accessibility, listeners, and named Elements.
- **Presentation** maps Component meaning onto the visual and experiential
  vocabulary of one UI Platform without changing behavior.
- **Platform Adapter** realizes a Platform in development and production.

These are the complete architectural concepts. Rust, Swift, JavaScript,
Node.js, Vite, Cargo, SQLite, NATS, the DOM, and animation engines are
implementation choices below an adapter or Dependency boundary.

## Application convention

Every application uses the same shape, regardless of size:

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

- `app.tsx` composes Feature instances and Presentations.
- `features/<name>.tsx` contains one application-owned Feature or instantiates
  one reusable Feature factory.
- `features/<name>.spec.ts` tests that slice through its semantic API.
- `presentations/<name>.ts` contains one complete platform-specific
  Presentation.
- `app.spec.ts` states black-box product behavior once. The testing surface
  runs it through development and production realizations.

Tests and assets exist only when needed. Applications do not contain adapter,
compiler, runtime, host, or Dependency-wiring directories.

## Feature factories

Core `Feature`, `Program`, and `Dependency` contracts are the lowering target
for factory authors. Application authors normally consume a factory's domain
language.

One semantic model should derive:

1. the public API;
2. Program requirements and provisions;
3. state, actions, and Components when the Feature owns UI;
4. implementation checks;
5. specialized testing support when the domain needs it.

The implementation fills in business decisions without repeating the model:

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

Reusable factories use one semantic stem:

```text
src/features/
  entity.ts
  entity.spec.ts
  entity.testing.ts
  identity.ts
  identity.spec.ts
```

`<name>.testing.ts` exists only for a public domain-specific testing surface.
Files are not mechanically split into `types`, `factory`, `runtime`, or
`helpers`.

## Dependency ownership

There are exactly two provider origins:

1. A Feature contribution provides a semantic Dependency from its `start`
   implementation.
2. A Platform Adapter implements a Dependency still unresolved after Program
   linking.

For each named Program, the linker validates contracts, rejects duplicate
providers and cycles, orders providers before consumers, and emits the exact
external Dependency contracts. At Process startup, the adapter creates one
external scope, Feature providers start in dependency order, each binding is
shared by local consumers, and disposal runs once in reverse ownership order.

Static Feature composition selects a provider definition; it does not create a
global singleton. Each Process replica receives an independent scope. A
Dependency implementation may itself address shared or distributed
infrastructure.

If an implementation is private to one Feature, it remains private code. If
other Features consume it, it becomes a semantic Dependency provided by that
Feature. Applications compose providers; they do not manually construct
implementation objects.

## UI boundary

Every UI-capable Platform defines its own JSX Elements, structural properties,
target handles, observations, and Presentation declarations. Shared JSX is a
syntax dispatcher, not a universal DOM or retained virtual tree.

A Component receives:

- its typed props and mutable local state;
- synchronous actions;
- child Feature APIs and composed Components;
- the JSX vocabulary of its Environment.

Rendering is a pure projection of state and props. Effects and external
authority remain in Program `start` code and Dependencies. The framework owns
subscription and disposal lifetimes.

A Presentation receives Component state, props, action lifecycle, Elements,
shared environment observations, and explicit parameters. It returns
platform-specific declarations. It cannot invoke product actions or mutate
behavior. Presentation helper functions are pure constructors for declaration
meaning; concrete CSS, media, animation, or graphics realization belongs to
the UI adapter.

## Compilation and realization

```text
typed TypeScript source
  -> canonical, versioned Application and Program IR
  -> Dependency linking and Platform extension lowering
  -> Platform Adapter
       |- development session and hot replacement
       `- production artifacts
```

The compiler extracts resolved TypeScript meaning into serializable IR. The
reference runtime executes that IR for development and differential tests.
Production backends may optimize or generate another language but must preserve
the same observable semantics.

Portable Program code follows the profile in
[Portable TypeScript](portable-typescript.md). Unsupported code fails with a
source-located diagnostic; production never silently falls back to embedding
application JavaScript.

The server adapter currently lowers portable Programs to Rust. Compiler-derived
Dependency IR is the only API contract: the TypeScript development host is
checked against it, and Rust traits and bindings are generated from it. Rust
operation signatures are not repeated in adapter descriptors.

The web adapter owns web routing, documents, caching, installation, workers,
DOM Components, Presentation compilation, development HMR, and production
browser artifacts. Each development session owns its generated source and Vite
optimizer cache, so independently running Applications cannot trigger each
other's reload lifecycle. Those concerns do not appear in generic core
contracts.

## Adapter contract

Every Platform Adapter has one top-level shape:

```ts
type PlatformAdapter<Platform> = {
  name: Platform["Name"];
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
  ui?: UIAdapter<Platform["UI"], unknown, unknown>;
};
```

An adapter owns:

- source extensions for its public Platform language;
- development execution and hot replacement;
- production artifact generation;
- external Environment Dependency implementations;
- Component and Presentation realization when its Platform supports UI.

A future iOS adapter can add `platforms/ios/` and `adapters/ios/`, use Swift or
another implementation language, and expose foreground, background, and widget
Environments without changing core, compiler IR, or the adapter contract.

## Repository shape

```text
src/
  core/          portable product meaning
  compiler/      extension contract, TypeScript extraction, IR, and linking
  runtime/       reference Process, state, IR, and Presentation execution
  jsx/           shared JSX toolchain entry points
  contracts/     contracts implemented by Platform Adapters
  platforms/     public platform authoring languages
  adapters/      concrete platform realizations
  features/      reusable semantic Feature factories
  realization.ts
  testing.ts
  cli.ts
  index.ts
```

Within an adapter, development and production are the primary profiles.
Language-specific source stays under the production profile that owns it.
Dependency implementations are grouped under their semantic Dependency;
multiple implementations use one further technology-specific level, such as
`dependencies/events/{sqlite,jetstream}`.
Files are split only for substantial, independently understandable
responsibilities. Empty symmetry and generic `internal`, `types`, `helpers`,
`utils`, compatibility, or technology-wide `native` directories are forbidden.

Production imports follow one direction:

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

Focused architecture tests enforce these boundaries.

## Public package surface

| Export                         | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `@poggers/kit`                 | Portable product and reusable Feature authoring             |
| `@poggers/kit/server`          | Public server Platform language                             |
| `@poggers/kit/web`             | Public web Platform, routing, UI, and Presentation language |
| `@poggers/kit/adapter`         | Platform Adapter authoring contract                         |
| `@poggers/kit/adapters/server` | Shipped server adapter                                      |
| `@poggers/kit/adapters/web`    | Shipped web adapter                                         |
| `@poggers/kit/testing`         | Public product and Feature testing support                  |
| JSX runtime exports            | TypeScript JSX entry points                                 |
| `@poggers/kit/cli`             | Application creation, development, and production builds    |
| `@poggers/kit/tsconfig`        | Shared authoring configuration                              |

Compiler and runtime implementation modules are private. The active migration,
verification record, and final acceptance gates are tracked in
[Architecture migration](architecture-migration.md).
