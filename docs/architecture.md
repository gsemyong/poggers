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
          capabilities.navigation.open(input);
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

`start` establishes long-lived Program relationships. Actions handle finite
input. Returned disposables, async disposables, async iterables, and promises
resolving to owned resources are disposed once in reverse acquisition order.
Features coordinate through Capabilities; direct APIs exposed to Components
are assembled only from contributions to the same Program.

## UI boundary

Each UI-capable Platform defines its own JSX Elements, native properties,
targets, and Child type. Components therefore retain full access to native
structure and accessibility without a lowest-common-denominator widget layer.
Several platform JSX languages may extend the same project-wide JSX registry.

The JSX runtime invokes Components directly and delegates intrinsic creation
to the active UI adapter. It has no virtual DOM and retains no tree. Renderer
activation is owned by the live UI and removed on disposal.

Presentation is a pure, platform-specific enrichment stage:

```text
parameters + Component props + Feature/Component state + symbolic targets
`- Presentation
   `- declarations in the Platform's Presentation language
```

Core does not define themes, tokens, color, motion, audio, haptics, or layout.
A Presentation receives an arbitrary parameter object, so one definition can
produce several themes or configurations. The adapter decides which
declarations exist and how they map to native APIs. Presentation cannot invoke
actions or mutate behavior. Adapter-defined passive feedback may observe a
semantic interaction such as activation, but it cannot cancel, reorder, or
replace the Component action.

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

Adapter scratch work belongs to the operating-system temp directory and is
owned by its live session or build operation. Generated applications contain
only authored source and requested production artifacts.

Adapter selection uses Platform identities extracted into IR. Environment
names never select implementations. A missing or mismatched adapter fails
before native work starts. Product source can mention semantic Platform and UI
types but cannot access adapter implementations.

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

Web motion follows the same boundary. Components own semantic state, actions,
native listeners, gesture samples, and accessibility. Presentation supplies
only desired visual values and immutable spring parameters:

```ts
Panel: {
  motion: {
    transform: {
      value: { translate: { y: state.dragOffset } },
      velocity: { translate: { y: state.dragVelocity } },
      transition: state.dragging ? undefined : parameters.motion.return,
    },
    layout: { identity: "sheet-panel", transition: parameters.motion.layout },
    presence: {
      enter: { from: { opacity: 0 }, transition: parameters.motion.enter },
      exit: { to: { opacity: 0 }, transition: parameters.motion.exit },
    },
  },
}
```

An absent transition is a direct native assignment, which is the only path for
pointer-coupled values. A spring is one analytical position-and-velocity
trajectory. The adapter renders it with sampled Web Animations when available
and one shared frame scheduler otherwise. Interruption samples the renderer's
actual timeline and starts the replacement trajectory from that value and
velocity. Static CSS and frame-rate values have disjoint ownership.

Layout uses one document-scoped FLIP transaction. It snapshots the canonical
pre-update visual boxes, lets every fine-grained Structure and Presentation
mutation settle, realizes cold CSS before measurement, reads final boxes
together, and then writes native transforms. This avoids measuring either an
unstyled variant or a partially updated text tree. Presence integrates with the
retained Structure lifecycle, so exit completion, immediate reversal, focus,
inertness, and cleanup have one owner.

View Transitions are not an authored motion mode. Snapshot-to-live handoff is a
valid private optimization only for adapter-owned, passive, bounded captures
whose intermediate pose can be materialized. Hit-testable and continuously
retargetable surfaces remain live DOM. Ordinary wrapping uses browser layout and
container FLIP; predictive line animation would be a private text driver, not a
second public motion language.

Development performs one exhaustive semantic compilation at startup. A
Presentation edit is classified from semantic source ownership plus Vite's
module graph, patches the live Presentation definition, and does not build or
evaluate a temporary server bundle. Full updates retain the incremental
TypeScript program, validate the changed source, and use transactional
candidate replacement with compatible state snapshots. Unsupported web
Environments receive a precise diagnostic rather than a partial realization.

Product code imports the browser-safe web language from `@poggers/kit/web` and
its Presentation language from `@poggers/kit/web/presentation`. Concrete
realization is isolated at `@poggers/kit/adapters/web`; application source does
not need or receive that implementation entry.

## Source graph

```text
src/
  core/
    application.ts
    process.ts
    component.ts
    ui.ts
    presentation.ts
    development.ts
    compiler/
    jsx/
  contracts/
    capability.ts
    platform.ts
  adapters/
    index.ts
    web/
      index.ts
      public.ts
      platform.ts
      toolchain.ts
      ui-adapter.ts
      component/
      presentation/
  cli.ts
  index.ts
```

Core contains product meaning and technology-independent machinery. Contracts
are extension boundaries. Adapters co-locate everything for one concrete
Platform and never import one another. The CLI depends on an explicit adapter
map and contains no per-adapter branch.

Files are split only for an independent contract, translation, lifecycle, or
substantial testable engine. `template/` is the canonical generated
application. `examples/` contains focused executable pressure cases and does
not replace the template.

## Verification

- TypeScript checks public inference and compile-only negative contracts.
- Vitest checks focused core invariants, generic adapter selection, concrete
  adapter translation and lifecycle, and the canonical generated application.
- fast-check covers sequence-heavy invariants where shrinking adds evidence,
  including fine-grained state mutation and Presentation commit traces.
- Oxlint and Oxfmt enforce one source convention.
- The package build emits declarations and runtime entries from public exports.
- Real-browser acceptance verifies development, interaction, Presentation,
  replacement, cleanup, and production equivalence.
- The opt-in benchmark reports p50/p95 work for state, 10,000-leaf updates,
  propagation, and cold/warm Presentation realization; wall-clock timings do
  not make correctness tests flaky.
