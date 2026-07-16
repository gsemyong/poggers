# Poggers architecture

Poggers is a batteries-included TypeScript framework for local-first
applications. This document is the maintained architecture contract; completed
plans and historical research remain in Git history.

## Model

The framework has seven product concepts:

- **Application** composes functionality, navigation, metadata, and Presets.
- **Feature** is the reusable vertical composition unit.
- **Resource** is a keyed state, authorization, ordering, synchronization, and
  scale boundary.
- **Program** is durable asynchronous work over committed Resource events.
- **Dependency** is a Feature's named semantic requirement.
- **Component** owns platform hierarchy, behavior, state, and accessibility.
- **Preset** owns an application's visual, motion, and interaction decisions.

Two runtimes execute this model. The substrate runs Resources and Programs. A
platform UI runtime runs Components and Presets. The web platform exists today;
future platforms may use different structures and components while preserving
the same separation between behavior and presentation.

The generic Application and Feature contracts are the authoring source of
truth. `kernel/manifest.ts` is their canonical dependency-free projection: it
records Resource wire and persistence schemas plus Feature, Program,
Dependency, Component, navigation, endpoint, API, and Preset topology. The
TypeScript compiler extracts it without evaluating application or vendor
modules. Executable reducers, commands, Programs, component behavior, and
dependency implementations remain host behavior; serializing a function body
is not portability.

This is also the portability boundary. Today it carries complete Resource wire
schemas and the remaining application topology; it is not yet a complete
cross-language ABI for dependency methods or executable behavior. A future
non-TypeScript host can consume this boundary as it is extended with explicit
portable contracts. It must not parse kit implementation source or treat
arbitrary TypeScript as portable.

## Boundaries

A port is a vendor-free semantic contract owned by its consumer. A dependency
is one named use of that contract. An adapter is a concrete implementation.
Code is organized by the semantic owner, never by vendor name or by a generic
`adapters` file kind.

One `SubstrateAdapter` enters the server host. It owns four narrow internal
contracts: Resource authority, the committed-event source, durable Program
progress, and Program coordination. Application and Feature code never
assembles these facets and never names a database, file, source split, cursor,
lease, worker, or storage shard. Deployment tooling selects the adapter.

The production single-node adapter uses SQLite internally. Its physical
Journal, schema, transaction, checkpoint, backup, and retention machinery are
implementation details below the adapter. The in-memory adapter implements the
same laws and the exported testing contract suite can be run unchanged against
another adapter.

The browser has a separate `ReplicaStore`, implemented by
`replica.indexeddb.ts`, and the web host has a `SyncTransport`, implemented by
`host/sync.websocket.ts`. These are platform boundaries, not pieces applications
mount themselves.

The same rule applies in the web UI. `drag.ts` owns the semantic drag contract
and lifecycle; `drag.anime.ts` is its normal Anime.js implementation.
`machine.xstate.ts` adapts the framework statechart contract to XState without
exposing XState through the application surface.

Search, authentication, analytics, AI, and other product capabilities are not
substrate concerns. An application Feature declares the semantic dependency it
needs and co-locates its normal implementation. A future kit-owned capability
must first have a reviewed semantic contract and factory surface; its vendor
implementation stays private to that owner.

Programs are at least once. Stable invocation identities, attempts, fencing,
checkpoints, and uncertain prior outcomes are durable. External operations must
be idempotent, reconcile unknown outcomes, or compensate explicitly.

## Program runtime

A Program is a statically named definition in one execution environment. An
event Program declares a non-empty typed event source and handles one durable
delivery. A service Program is an unrestricted lifecycle-managed function. The
canonical durable identity is derived from the application or mounted Feature
path, environment, and Program name; deployment instance names never change
it.

```ts
programs: {
  server: {
    updateSearch: {
      source: {
        events: ["documents.created", "documents.changed"],
        replay: "all",
        version: 1,
        keyBy: "resource",
      },
      async handle({ api, delivery, event, signal }, dependencies) {
        // Unrestricted TypeScript for one at-least-once delivery.
      },
    },
  },
}
```

The generic application contract types event names, the handler union,
dependencies, local Resource APIs, and the complete semantic application API.
The compiler extracts identity, source selection, replay policy, definition
version, and ordering policy without executing application code. Startup
compares that manifest with runtime definitions exactly before adapter
validation and Program initialization. Duplicate identity, incompatible
definition, unavailable replay history, and unsupported deployment topology
fail the ready gate.

`replay: "all"` and `replay: "new"` apply only on first registration. Ordering
defaults to the Resource address. A custom semantic key requires its own
positive version; changing source or key meaning requires explicit reset,
rename, replay, or removal. Worker count, key groups, source splits, and storage
placement are runtime concerns and do not appear in the Program definition.

Committed events have stable identities independent of source location.
Adapter cursors are opaque and split-scoped. Program progress is persisted per
Program, source split, and stable key group, so one assignment can never advance
another. Claims expose a stable delivery identity, attempt, uncertain prior
attempts, and a monotonic completion epoch. Fenced owners cannot complete or
advance, and no checkpoint can cross unfinished work. External effects remain
at least once and must use the supplied stable idempotency identity, reconcile
uncertainty, or compensate.

The executor bounds pending records and bytes, preserves same-key serial order,
allows independent keys to run concurrently, and uses one cancellation path
for failure, restart, and shutdown. Feature composition preserves mounted
Program identity and combines service cleanup exactly once.

Definitions, assignment checkpoints, attempts, uncertainty, and ownership are
reserved substrate metadata, never product Resources. Administration can list,
reset, rename, or remove stopped Programs. Logical retention is explicit: a
cursor below the retained floor produces `cursor-expired`; protected progress
blocks deletion; Resource heads and permanent command receipts survive history
reclamation; and a new `replay: "all"` Program is rejected when its history is
gone. Physical compaction and backup remain adapter-private.

The current production executor deliberately accepts one committed-event source
split and the single-node adapter accepts one application instance. Both reject
unsupported topology before Programs start. The SPI, opaque topology model,
split lineage validation, deterministic key-group allocation, assignment
isolation, and fencing laws are in place for a future clustered adapter, but
horizontal deployment is not claimed until both adapter and executor satisfy
the same contract and adversarial suites.

## Features

The low-level Feature representation can compose Resources, nested Features,
semantic API, Programs, dependencies, service endpoints, migrations, and
headless Components. A Feature with UI is authored in TSX. Application screens
and route placement remain application-owned; a reusable Feature declares named
navigation requirements that the application maps to its own destinations.

The historical `f/na` module system established useful requirements: one model
generic, contextual typing, path-scoped composition, semantic API projection,
program placement, typed service routes, TSX components, and test-time
dependency replacement. It also deliberately deleted its module families in
commit `734073a3` because that factory API was not considered final.

Poggers follows the same discipline. The kit exposes the Feature building block,
shared test host, and one production workflow factory whose Inngest-compatible
surface, durability, recovery, composition, type cost, and single-node behavior
have been stress-tested. Auth, CRUD, search, notification, and analytics
factories remain experiments until their product surfaces pass the same gates.

## Component data flow

Components have one data and behavior path:

1. A Feature API closes over Resource keys and exposes product operations and
   reactive reads. Components never address Resources directly.
2. A component statechart owns discrete behavior and private `Context`. Its
   synchronous, verb-named `Actions` are the only input surface exposed to the
   hierarchy.
3. State-bound tasks are the effect boundary. They may use the Feature API,
   browser dependencies, navigation, and appearance controls, and are cancelled
   with their owning state.
4. One `state` projection derives the exact public semantic `State` from Feature
   API reads, input, private Context, the finite phase, screen, appearance, and
   Preset parameters. The result has stable identity and property-level reactive
   reads.
5. `view` receives only `state`, `actions`, `slots`, and the destructured
   lowercase `parts`, `components`, and `features` namespaces. JSX describes
   hierarchy, accessibility, native platform attributes, composition, and
   native-listener-to-Action wiring.
6. Preset component factories receive the same State shape as typed reactive
   expressions, symbolic Action and Part references, geometry, interaction, and
   environment conditions. They own tokens, styles, responsive conditions,
   motion, gesture configuration, and visual parameters.

There is no public component `Data`, `Events`, presentation `Values`, `select`,
`computeValues`, raw statechart snapshot, or vendor API. `Context` remains
private. A Preset may route a visual interaction to a declared Action, but it
cannot call Feature APIs or mutate component behavior directly. The normative
surface and lifecycle semantics are in
[`component-api.md`](./component-api.md).

## Source layout

The package tree mirrors runtime ownership:

```text
packages/kit/
  scripts/
    build.ts
  src/
    kernel/       application and Feature contracts and composition
    substrate/    Resource, Program, sync, and persistence runtime
    ui/
      compiler/   Application, Preset, and StyleX compilation
      web/        web renderer, interaction, style, and motion runtime
    host/         browser, server, and transport implementations
    testing/      public Feature and substrate test support
    tooling/      CLI, application build, migrations, and scaffolding
  tsconfig.app.json
  tsconfig.json
```

Rules:

1. The kernel imports no vendor implementation and no application Feature.
   Its sole outward edge is the type-only web JSX declaration contract used by
   the current platform-specific Component hierarchy.
2. Substrate implementations stay with the substrate contract they implement.
3. Platform code stays below the UI or host system that owns it.
4. A semantic capability owns its contract, implementation, tests, and fixture
   vocabulary together.
5. Tooling orchestrates owners but contains no product semantics.
6. Tests live beside their owner.
7. A directory or extra file requires a distinct responsibility.
8. Private source paths do not become public exports accidentally.

Applications use one shape:

```text
src/
  app.tsx
  features/
    <feature>.tsx
    <feature>.spec.ts
  presets/
    <preset>.ts
```

Directories are omitted when unused. Types, dependencies, and small helpers
remain with their owner. Applications add no barrels or declaration files.

## Package

The public roles are:

- `@poggers/kit` for the deliberately small Application and Feature type
  surface: `AppDef`, `AppScreen`, `AppSpec`, `Submission`, `FeatureDef`,
  `FeatureSpec`, and `Migration`, plus the reviewed workflow factory and its
  product-facing types.
- `@poggers/kit/ui` for Component hierarchy and interaction.
- `@poggers/kit/preset` for visual implementation.
- `@poggers/kit/testing` for deterministic test hosts.
- `@poggers/kit/tsconfig` for the complete application TypeScript config.

JSX and `host/*` exports are compiler contracts. `host/browser` and
`host/server` compose the framework for those execution environments; application
source does not import them directly. Physical source paths do not determine
package exports.

Kit source imports use package-private architectural import maps. Specifiers such as
`#kernel/app`, `#substrate/journal`, and `#ui/web/runtime` name architectural
owners and resolve consistently in TypeScript, Bun, declarations, and published
JavaScript. Application source continues to use its distributed `src/*` alias.

`scripts/build.ts` has one purpose: emit the declaration boundary used by
consumer IntelliSense and executable JavaScript for package consumers. The
source condition keeps compiler-controlled workspace development direct;
normal public package resolution executes `dist` and published consumers do
not typecheck the framework implementation as application source.

`tsconfig.app.json` is the distributed application config. The kit's own
`tsconfig.json` extends it, adds the workspace source condition, and changes its
include set. Applications need one `tsconfig.json` that extends
`@poggers/kit/tsconfig`.

## Testing

- Owner specs cover behavior and state transitions beside source.
- Contract suites run the same laws against reference and production
  implementations when multiple implementations exist.
- Property tests generate operation traces for Resource authority, adapter
  topology, Replica, protocol, Program, state-machine, Presence, and motion
  invariants.
- Boundary tests exercise SQLite, IndexedDB, WebSocket, process, and browser
  behavior.
- Type contracts retain inference and rejected programs.
- `tooling/create.spec.ts` packs the real package and proves that an isolated
  consumer and generated application install, typecheck, execute, and build.

Browser review covers visual quality, accessibility, touch, focus, responsive
behavior, interruption, and hot reload. It complements deterministic tests.

## Verification

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun packages/kit/scripts/workflow-evidence.ts all --output=/tmp/poggers-workflow-evidence.json
bun packages/kit/scripts/primitive-evidence.ts \
  '--verify-evidence=/tmp/poggers-primitives-equivalent-final.json,/tmp/poggers-resource-equivalent-current.json,/tmp/poggers-program-equivalent-current.json,/tmp/poggers-composition-equivalent-final.json'
```

A structural change is complete only when source ownership, exports,
declarations, packed consumption, maintained applications, and generated-file
hygiene all agree with this document.

The workflow harness runs each phase in an isolated process and merges its JSON
records so the 1,000-run production matrix cannot bias later compiler or
reference measurements through allocator retention. Primitive evidence compares
the framework against dependency-free semantic references and verifies 53
locked overhead and scaling budgets.

The proven production boundary is one SQLite-backed `SubstrateAdapter` with
strict durability, Resource authority, static Programs, assignment progress,
logical retention, backup and restore, WebSocket synchronization, client
projection, restart, and killed-writer recovery. Production cluster ownership
transfer and a complete executable cross-language ABI remain explicit limits;
they are not implied by the topology model or single-node evidence.
