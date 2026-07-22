# Poggers architecture

Poggers is a TypeScript product language for applications made of portable
Programs, typed Capabilities, and platform-native user interfaces. It owns the
authoring model and adapter boundaries. It does not prescribe storage,
transport, synchronization, authentication, topology, or deployment.

## Product model

- **Application** composes the complete product from reusable Features.
- **Feature** is a vertical slice that may contribute to several Programs and
  compose child Features.
- **Program** is authored logic assembled from every same-named Feature
  contribution.
- **Environment** is one execution context for a Program. It belongs to exactly
  one Platform and may opt into that Platform's UI.
- **Platform** is one technical realization family. Every Platform realizes
  Processes; some also define one UI language.
- **Process** is one live Program execution.
- **Capability** is typed external authority. Host APIs, communication, and
  effects cross this boundary.
- **Component** owns UI state, actions, lifetime, hierarchy, native listeners,
  accessibility, and composition.
- **Element** is a named structural endpoint exposed by a Component.
- **Presentation** enriches Elements from Component input and state without
  changing behavior.

```text
Application
`- Features
   `- Program contributions
      |- Environment -> Platform
      |- required and provided Capabilities
      `- optional UI
         `- Components -> named Elements -> Presentation declarations
```

Generic contract parameters carry product meaning and contextual type safety.
Wrapper functions are not required only to recover inference.

```tsx
import type { Application, Feature, Program } from "@poggers/kit";
import type { BrowserMainThread } from "@poggers/kit/web";

type OrdersFeature = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: { orders: Orders; navigation: Navigation };
        State: { orders: readonly Order[]; status: "loading" | "ready" };
        Actions: {
          refresh(): Promise<void>;
          open(input: { id: string }): void;
        };
        Components: {
          OrderList: { Elements: { Root: "main"; Row: "button"; Name: "span" } };
        };
      }
    >;
  };
};

const orders = {
  programs: {
    browser: {
      state: { orders: [], status: "loading" },
      actions: {
        async refresh({ capabilities, state }) {
          state.orders = await capabilities.orders.list();
          state.status = "ready";
        },
        open({ capabilities }, input) {
          capabilities.navigation.navigate({ path: `/orders/${input.id}` });
        },
      },
      start({ actions, capabilities }) {
        actions.refresh();
        return capabilities.orders.subscribe(actions.refresh);
      },
      components: {
        OrderList: {
          view({ elements: { Root, Row, Name }, feature }) {
            return (
              <Root>
                {feature.orders.map((order) => (
                  <Row onPointerDown={() => feature.open({ id: order.id })}>
                    <Name>{order.name}</Name>
                  </Row>
                ))}
              </Root>
            );
          },
        },
      },
      root: "OrderList",
    },
  },
} satisfies Feature<OrdersFeature>;

type App = { Features: { orders: OrdersFeature }; Presentations: "clean" };

export default {
  features: { orders },
  presentations: { clean },
} satisfies Application<App>;
```

Reusable Feature factories name logical Program roles such as `server` and
`browser`. The consuming application assigns those roles to its concrete
Program names once, at composition:

```ts
const tasks = placePrograms(createEntity<Tasks>(definition), {
  server: "api",
  browser: "browser",
});
```

Placement applies recursively through the Feature tree and preserves the
factory's semantic API. Two logical roles cannot be mapped to the same name in
one Feature. After placement, ordinary same-named Program assembly is the only
composition rule; factories do not gain a second runtime or communication
mechanism.

`start` establishes long-lived Program relationships. Actions handle finite
input. Returned disposables, async disposables, async iterables, and promises
resolving to owned resources are disposed once in reverse acquisition order.
Features coordinate through Capabilities; direct APIs exposed to Components
are assembled only from contributions to the same Program.

For each named Program, all Feature requirements and providers form one capability graph. The
selected Platform Adapter creates the external host scope once per Process instance; applications
do not wire host dependencies. The runtime validates that scope against compiler-derived meaning,
orders Feature providers before dependants, and owns external and Feature-provided resources
exactly once. Cross-Program communication is an ordinary semantic Capability implementation, such
as a local object or an HTTP client; it is not a second framework mechanism.

## UI boundary

Each UI-capable Platform defines its own JSX Elements, native properties,
and Child type. Components therefore retain full access to native
structure and accessibility without a lowest-common-denominator widget layer.
Several platform JSX languages may extend the same project-wide JSX registry.

The JSX runtime invokes Components directly and delegates intrinsic creation
to the active UI adapter. It has no virtual DOM and retains no tree. Renderer
activation is owned by the live UI and removed on disposal.

Presentation is a pure, platform-specific enrichment stage:

```text
Application scope  { parameters, environment, state, events }
`- Feature scope   { state, events }
   `- Component    { props, state, events, elements }
      `- complete declarations in the Platform's Presentation language
```

Core defines only `Animation<Source, Output, Velocity>`, the compiler intrinsic
`animate(source, animation)`, `velocity(value)`, `settled(value)`, and read-only
ordered `Event<Payload>`. It does not define a spring, gesture, layout, CSS,
asset, audio, haptic, or scene vocabulary. Each UI adapter defines its own
primitive-indexed declarations and observations, immutable Animation
constructors, and any useful pure equation helpers.

A configured Presentation pairs one pure definition with typed `parameters`.
Parameters may contain constants, assets, and immutable Animation descriptions;
the kernel does not rename them themes or tokens. The mounted adapter supplies
one live read-only Environment per UI boundary. Application and Feature
animations are shared through ordinary lexical closure, while Component
animations are isolated by mounted and keyed structural identity.

Presentation observes correlated action start/completion/failure Events but
cannot invoke actions, emit or subscribe to Events, mutate Behavior, perform
I/O, schedule work, or access native handles. A Component receives only its
typed props, merged reactive state, read-only Events, and named Elements enriched
with primitive-specific observations. It returns one complete declaration frame
for those Elements. Ordinary TypeScript is the equation language; retained
temporal state is allocated only by a directly named `const value = animate(...)`.

## Realization

```text
TypeScript Application source
`- semantic compiler
   `- deterministic, versioned Application IR
      `- explicit Platform Adapter map
         |- develop -> owned DevelopmentSession
         `- build   -> deterministic ProductionArtifacts
```

`PlatformAdapter` is the only top-level implementation contract. A
process-only adapter implements development and production. A UI-capable
adapter additionally owns one `UIAdapter`, which pairs Component and
Presentation realization. Adapter-specific engines are private drivers, not
additional framework concepts.

Application authors select neither path. `poggers dev` resolves every Platform
required by the Application and owns its live sessions and hot replacement.
`poggers build` resolves the same Application into optimized artifacts.
`testApplication` states one black-box specification and lets the framework run
it against both realizations; application tests never import compiler, host,
adapter, process-launch, Cargo, or native-builder APIs.

Adapter scratch work belongs to the operating-system temp directory and is
owned by its live session or build operation. Generated applications contain
only authored source and requested production artifacts.

Adapter selection uses Platform identities extracted into IR. Environment
names never select implementations. A missing or mismatched adapter fails
before native work starts. Product source can mention semantic Platform and UI
types but cannot access adapter implementations.

The compiler emits exactly one descriptor for each named Program, assembled
from every same-named Feature contribution. In development, an adapter starts
one owned Process for each descriptor. A compatible source update replaces only
the affected Processes transactionally; a browser-only edit therefore cannot
restart an unrelated server Process. In production, each descriptor becomes an
independently deployable `ProductionArtifact` identified by its Program and
Environment.

Portable headless logic is intended to follow a stricter realization path. The TypeScript compiler
API resolves authored types, symbols, generic specializations, factory object construction, and
executable syntax without running source. The frontend lowers supported meaning statement by
statement into typed IR with source spans and a reachable pure-function graph.

Capabilities are the only effect boundary. Pure helpers and local data lower to direct generated
Rust control flow. External Capability adapters are selected by recursively matching the semantic
contract extracted from the Program; missing, ambiguous, incompatible, and cyclic bindings fail
before Cargo. Generated wiring names each concrete Rust type and constructor, then erases it behind
one stable dynamic `Value` Capability ABI. This keeps independently distributed adapters possible.
It is not yet whole-program monomorphization, and no performance claim should imply otherwise.

Platform UI remains intentionally platform source. Host logic outside the portable profile is
recorded as `host-source` with its diagnostic, so JavaScript development remains available while
native generation fails instead of embedding JavaScript. The generic native path is complete for
the documented profile: compiler and runtime contain no knowledge of shipped Feature factories,
and authenticated CRUD plus an unrelated factory lower through the same IR and generator. The
normative subset lives in [portable-typescript.md](./portable-typescript.md); its executable gates
are recorded in [native-runtime-correction.md](./native-runtime-correction.md).

The web production adapter emits browser assets plus a versioned `WebDocumentIR`. It evaluates only
the deterministic initial Component state: Program starts, Component mounts, Capabilities, native
listeners, refs, observations, and feedback remain inert. The server production adapter embeds a
checked-in Rust renderer and, when `POGGERS_WEB_ROOT` is set, renders that document for every
document request while serving immutable assets separately. The browser adopts the exact server
nodes and attaches reactivity and listeners; a shape mismatch is diagnosed once and recovers with
one clean client render. This is deliberately **initial-state SSR**. Request-derived authenticated
SSR requires a future typed render-input Capability and is not implied by this mode.

Stable native source is ordinary checked-in Rust and does not invoke JavaScript. The runtime owns
only values, calls, streams, failures, and lifecycle. HTTP, authentication, clock, identifiers,
SQLite events, and JetStream events are separate checked-in Capability adapters. Product routes,
authorization, entity commands, and Feature composition exist only in translated Program code.

Running one artifact once creates one Process. Running the same artifact more
than once creates independent replicas with fresh host-capability scopes.
Replica count, placement, supervision, load balancing, and horizontal scaling
belong to deployment and the selected Capability implementations. Product code
does not acquire topology syntax. Contributions inside one Program communicate
through its assembled local capability graph; Programs communicate only through
ordinary external Capabilities such as HTTP, queues, or shared storage.

The Node host can select SQLite for a single process or JetStream for a network-authoritative
`EventStore`. JetStream stores one atomic append batch per encoded logical-stream subject and uses
expected last-subject sequence as compare-and-append. Ordered consumers provide complete reads and
continuations; they are not shared work queues. The replica suite starts two separately assembled
Programs on different ports and with independent capability scopes, then proves cross-replica
reads, principal isolation, compare-and-append contention, live continuation, and restart catch-up.
Rendezvous placement is a deployment helper with property-tested stability and bounded remapping;
it does not add topology syntax to Features. The native adapter has an independently selectable
JetStream implementation and a multi-process acceptance test for contention, catch-up, and live
delivery. These are single-machine broker tests; they do not claim multi-node broker failover.

The shipped web adapter owns browser Environments, DOM JSX, direct fine-grained
updates, Vite development and production, and the web Presentation language.
Alien Signals is the single reactive graph. Fixed root state uses direct signal
cells; nested records and arrays create property cells lazily. Actions are the
batch boundary, primitive text retains its native Text node, and native writes
are equality-guarded.

Canonical web style declarations compile to deterministic CSS classes.
Previously realized classes remain warm for the live document, multiple
sessions share one microtask-coordinated stylesheet flush, and unchanged output
does not rewrite the stylesheet. The same language can substitute typed image
assets on semantic `img` Elements and declare passive `feedback`.
`createImageAsset` and `createAudioAsset` create inert parameter data; the
adapter owns native source mutation, delegated activation observation, one lazy
AudioContext per document, encoded/decoded asset caches, playback nodes, and
disposal. Structure retains accessibility and behavior. Authored Presentation
declarations contain no event callbacks.

Web temporal presentation follows the same boundary. Components own semantic
state, actions, native listeners, gesture samples, accessibility, and desired
membership. The web adapter supplies immutable scalar Animation constructors;
pure utilities such as `clamp` and `rubberBand` remain ordinary functions:

```ts
const clean = (({ parameters, environment, events }) => {
  const confirmation = animate(events.save.completed, parameters.confirmation);

  return {
    Sheet({ state, elements }) {
      const travel = Math.max(elements.Panel.box.blockSize, 1);
      const target = state.dragging
        ? rubberBand(state.dragOffset, travel)
        : state.open
          ? 0
          : travel;
      const position = animate(
        target,
        state.dragging ? follow(state.dragVelocity, { relative: true }) : parameters.sheet,
      );
      const openness = clamp(1 - position / travel, 0, 1);

      return {
        Backdrop: { paint: { opacity: 0.3 * openness } },
        Panel: { transform: { translate: { y: position } } },
        Status: { paint: { opacity: confirmation } },
      };
    },
  };
}) satisfies Presentation<App, WebPresentationLanguage, Parameters>;
```

The web constructors currently cover direct following, analytical springs,
bounded inertial decay, finite/repeating/autoreversing tween tracks, sampled
tracks, and repeated Event pulses. Retargeting starts from the displayed value
and compatible velocity. Reduced motion resolves deterministically to the
semantic destination. Ordinary equations derive stagger, overlap, crossfade,
rubber-band response, velocity blur, and Element declarations from one or more
animated coordinates. A different Animation domain can be added by extending
the web adapter without changing the shared kernel contract.

One frame host belongs to each mounted Presentation root. It schedules at most
one native animation frame, gives every active Component the same timestamp,
and stops when no Animation or layout transaction remains active. Every affected
Element in a Component commits from one invocation. Independent roots remain
isolated. Long finite frame gaps are sampled analytically rather than integrated
through invented intermediate frames. The Application scope owns shared lexical
animations. Compiler-derived consumers ensure adapter-owned frames reevaluate
only affected Feature scopes and Components; authored state or Presentation
replacement still reevaluates the complete graph.

`continuity` opts a web Element into root-owned layout continuity. The adapter
flushes new CSS, removes authored and runtime transforms, reads every target
geometry in one batch, and restores authored transform layers before publishing
an immutable FLIP correction to the current frame. The layout host never owns a
persistent visual mutation: the Presentation session merges that correction
with its declarations and performs the sole DOM commit. An optional identity connects structural
replacement. Interruption begins from displayed geometry and velocity.
Resize, scroll, font-loading, and media-loading notifications schedule the same
geometry transaction, so intrinsic changes do not require a behavior update.
Zero-size axes retain scale one; a target without native style or finite DOM
geometry fails at the adapter boundary instead of silently jumping.
Viewport geometry is canonical. Nested scroll is a direct coordinate-frame
change and updates the baseline without animation. Axis-aligned ancestor scaling
is converted to the target's local transform coordinates while public samples
remain in viewport coordinates. The current web driver rejects rotated or
skewed ancestors precisely; supporting them is an isolated future quad/matrix
driver improvement, not a second Presentation mechanism.
`presence` is a presentation-authored visual-retention declaration. Semantic modality,
accessibility, focus, and hit testing change immediately; retained outgoing DOM
is inert and removed exactly when presence settles at zero.

Static and frame-dependent declarations share this authoring surface. The web
adapter compiles static meaning to stable classes and frame-dependent numeric
channels to a stable CSS template with equality-guarded custom-property writes.
Compositor properties use individual transforms and stable variables; paint is
updated only when its sample changes; layout continuity uses the batched FLIP
host as a pure geometry and trajectory source. Layout uses the same canonical
dynamics and root logical clock, not a second authored controller API. Every
committed frame is inspectable as one immutable record containing behavior
input, observations, Event consumption ranges, animation identities and
samples, declarations, and final native class/property output.

The analytical frame evaluator is the reference execution path. Compiler-owned
temporal slices let the adapter sample only retained numeric channels, without
replaying authored Presentation code. A bounded planner lowers equivalent
opacity and transform traces to WAAPI; layout-active, unsupported, or
over-budget output remains on the shared frame host with an inspectable reason.
Both paths preserve the canonical displayed value and velocity for
interruption, and native completion commits the semantic destination before
removing fill. Reduced motion never starts native work.

View Transitions are not an active execution path. Their captured snapshots do
not provide the continuously interruptible geometry required by this contract.
Ordinary text remains browser-shaped and participates in staged geometry
invalidation for text, font, media, resize, and scroll changes. A predictive
text driver is deferred until it can declare and prove an exact supported
domain; it is not a second authored animation mechanism. Backend selection is
never authored.

Development performs one exhaustive semantic compilation at startup. A
Presentation edit is classified from semantic source ownership plus Vite's
module graph, patches the live Presentation definition, and does not build or
evaluate a temporary server bundle. Full updates retain the incremental
TypeScript program, validate the changed source, and use transactional
candidate replacement with compatible state snapshots. Unsupported web
Environments receive a precise diagnostic rather than a partial realization.

Product code imports the complete browser-safe structure and Presentation
language from `@poggers/kit/web`. Concrete realization is isolated at
`@poggers/kit/adapters/web`; application source does not need or receive that
implementation entry.

Every concrete adapter shares one minimal shape. A Platform adapter owns
development and production realization. A UI-capable Platform additionally
owns one paired Component and Presentation realization. The Component result
must render the Platform UI's `Child` type. Presentation declarations and
observations must cover exactly the same primitive Elements, and its native
target must accept every target exposed by those Elements. TypeScript rejects
crossed halves before an adapter can be registered.

Private runtime mechanisms are not part of this convention. A process-only
adapter has no `ui/` directory. A UI adapter may add native animation, layout,
media, graphics, or observation machinery beneath its own runtime when those
concepts have independent lifecycle and invariants.

## Source graph

```text
src/
  core/
    application.ts
    capability.ts
    process.ts
    component.ts
    ui.ts
    presentation.ts
    development.ts
    compiler/
    jsx/
  contracts/
    platform.ts       # Platform realization contract
    native.ts         # native Capability adapter contract
  adapters/
    registry.ts
    server/
      adapter.ts
      host.ts
      native.ts       # whole-Program workspace generation, caching, and build
      placement.ts    # deployment-only deterministic shard placement
      native/
        program.ts    # canonical Program IR to direct Rust control flow
        capabilities.ts # shipped adapter descriptors
        runtime/      # generic Value, Capability, stream, and lifecycle ABI
        capabilities/
          authentication/
          clock/
          events/     # SQLite single-node authority
          events-jetstream/
          http/
          identifiers/
      platform.ts
      runtime.ts
    web/
      adapter.ts        # concrete Platform adapter
      document.ts       # canonical initial-state SSR artifact
      platform.ts       # web UI language and public API
      toolchain.ts      # development and production realization
      ui/
        adapter.ts      # paired Component and Presentation realization
        presence.ts     # shared structural and visual retention
        component/
          adapter.ts    # Feature and Component composition
          compiler.ts   # component source transform
          interaction.ts # browser interaction primitives
          language.ts   # DOM JSX language
          runtime.ts    # fine-grained DOM runtime
        presentation/
          adapter.ts    # declaration evaluation and native commit
          compiler.ts   # CSS and artifact compilation
          dynamics.ts   # public immutable Animation descriptions
          language.ts   # public web Presentation language
          runtime/
            animation.ts    # temporal state and shared frame clock
            execution.ts    # canonical-to-WAAPI planning
            layout.ts       # layout continuity
            observations.ts # browser observations
  features/
    entity.ts          # reusable event-sourced entity Feature factory
    entity.testing.ts  # factory-owned deterministic test harness
    identity.ts        # reusable authenticated identity Feature factory
  cli.ts
  index.ts
```

Core contains product meaning and technology-independent machinery. Contracts
are extension boundaries. Adapters co-locate everything for one concrete
Platform and never import one another. The CLI depends on an explicit adapter
map and contains no per-adapter branch.

Files are split only for an independent contract, translation, or substantial
testable engine. `platform.ts`, `adapter.ts`, and `toolchain.ts` are the common
Platform convention; `ui/` exists only when the Platform defines a UI.
`language.ts` and `adapter.ts` are the common UI subsystem convention, while
compiler and runtime modules exist only when required by that implementation.
Package exports point directly at real modules; there are no forwarding
entrypoint files. `template/` is the canonical generated application.
`examples/` contains focused executable pressure cases and does not replace
the template.

Generated applications and executable examples follow the single convention in
[Project organization](project-organization.md). That convention is independent
of application size and is verified by the CLI test suite.

## Verification

- TypeScript checks public inference and compile-only negative contracts.
- Vitest checks focused core invariants, generic adapter selection, concrete
  adapter translation and lifecycle, and the canonical generated application.
- fast-check covers sequence-heavy invariants where shrinking adds evidence,
  including fine-grained state mutation and Presentation frame traces.
- Oxlint and Oxfmt enforce one source convention.
- The package build emits declarations and runtime entries from public exports.
- Real-browser acceptance verifies development, interaction, Presentation,
  replacement, cleanup, and production equivalence.
- The opt-in benchmark reports p50/p95 work for state, 10,000-leaf updates,
  propagation, and cold/warm Presentation realization; wall-clock timings do
  not make correctness tests flaky.
