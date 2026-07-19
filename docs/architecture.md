# Poggers architecture

Poggers is a portable TypeScript product language. An Application composes
reusable Features into Programs for explicit Environments. Everything outside
authored product logic crosses a typed Capability contract.

Poggers does not prescribe storage, transport, synchronization,
authentication, queues, topology, or distributed-state semantics. Those are
Capabilities supplied when a Program becomes a running Process.

## Language

- **Application** is the complete authored composition.
- **Feature** is a reusable vertical product slice. It can contribute to
  several Programs and compose child Features.
- **Environment** is an authored execution-context kind. `browser-main`,
  `browser-service-worker`, and an application-defined `cloud` are examples.
- **Program** is prepared application logic assembled from every same-named
  Feature contribution targeting one Environment.
- **Process** is one running Program instance.
- **Capability** is typed authority crossing the product boundary. Host APIs,
  effects, communication, and external systems enter only through
  Capabilities.
- **Component** owns local state, actions, mount lifetime, native hierarchy,
  accessibility, listeners, and composition.
- **Element** is a named structural endpoint exposed by a Component.
- **Presentation** maps adapter-defined parameters plus Component props and
  state to declarations for named Elements.
- **UI Platform** is a compatible pair of Component primitives and a
  Presentation language.
- **Adapter** realizes an explicit contract.

`Program` and `Process` retain their conventional distinction: source logic is
a Program; one live execution is a Process. Runtime placement and topology are
not core nouns. A Capability can expose those facts when a product needs them.

```text
Application
`- Features
   `- Program contributions targeting Environments
      |- required and provided Capabilities
      `- optional Components
         |- state + actions + mount
         |- platform-native JSX
         `- named Elements
            `- parameterized Presentation declarations

Application source -> Application IR -> development or production realization
```

## Programs

Generic contract parameters supply contextual type safety. Wrapper functions
are not required merely to recover inference.

```tsx
import type { Application, Feature, Program } from "@poggers/kit";
import type { BrowserMainThread } from "@poggers/kit/web";

type Cloud = { readonly Name: "cloud" };

type OrdersFeature = {
  Programs: {
    cloud: Program<
      Cloud,
      {
        Requires: { database: OrdersDatabase };
        Provides: { orders: Orders };
      }
    >;
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
          OrderList: {
            Elements: { Root: "main"; Row: "button"; Name: "span" };
          };
        };
      }
    >;
  };
};

const orders = {
  programs: {
    cloud: {
      start({ capabilities }) {
        return { orders: createOrders(capabilities.database) };
      },
    },
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

`start` establishes a Program contribution's long-lived relationships.
Actions handle finite input. Capability resources, subscriptions, promises
resolving to resources, and async iterators are owned by a `ResourceScope` and
disposed in reverse order. A `CapabilityResolver` supplies external
Capabilities; Feature-provided Capabilities are assembled inside the Process.

Child Feature Components are exposed through capitalized namespaces. Features
coordinate through typed Capabilities rather than reaching into sibling or host
internals. Navigation is therefore a Capability supplied by a Feature or
adapter, not a universal router.

## Components

The Component boundary has one data direction:

1. Program state and actions form the Feature API available to Components.
2. Component state and actions coordinate one mounted interaction.
3. `mount` owns Component-lifetime resources.
4. `view` defines platform-native JSX, accessibility, listeners, slots, and
   Component composition.
5. Named Elements expose exact structural endpoints to Presentation.

The shared JSX runtime invokes Components directly and delegates intrinsic
creation to the active UI Platform. It has no DOM dependency and retains no
virtual tree. Different UI Platforms can therefore be authored in one TSX
project without a platform-neutral widget abstraction.

## Presentation

Presentation is the universal enrichment stage, not a universal styling
taxonomy. Core knows only that a Presentation:

- is configured by an arbitrary parameter object;
- receives typed Component props, merged Feature and Component state, and
  symbolic Element targets;
- returns declarations indexed by the platform's primitive names; and
- cannot call actions or mutate behavior.

```ts
type Parameters = Readonly<{ canvas: OklchColor }>;
const parameters = { canvas: { l: 0.98, c: 0.004, h: 250 } } satisfies Parameters;

const presentation = ((parameters) => ({
  Orders: {
    OrderList({ state }) {
      return {
        Root: { paint: { fill: parameters.canvas } },
        Row: { motion: { opacity: state.status === "ready" ? 1 : 0.6 } },
      };
    },
  },
})) satisfies WebPresentation<App, Parameters>;

export const clean = presentation(parameters);
```

Core does not define themes, tokens, motion, style, audio, or rendering. A web
Presentation can choose design-token-shaped parameters; another adapter can
define audio, haptic, scene-graph, terminal, or native declarations. Ordinary
function application creates multiple configured Presentations from the same
program.

The UI Platform adapter pairs two implementations:

```text
UI Platform adapter
|- Component adapter    JSX primitives, native events, lifecycle, hierarchy
`- Presentation adapter declaration realization, replacement, disposal
```

The web adapter uses fine-grained signals and direct DOM writes. Its
Presentation language owns web-specific style, assets, responsive conditions,
fonts, and motion. Those concepts do not leak into generic contracts.

## Compilation

```text
TypeScript Application source
`- compiler/source.ts
   `- deterministic, versioned Application IR
      |- compiler/development.ts -> interpretation and semantic HMR
      `- compiler/production.ts  -> current optimized production realization
```

The source compiler reads generic contracts and implementations without
executing application behavior. Development and production are realization
modes, not output languages. The current web realization uses Vite/Rolldown;
the current headless production realization emits a selected Program as Rust.
Future adapters can emit other artifacts without changing product source.

TypeScript 7 provides the native `tsc` used by project checks. TypeScript 7.0
does not yet expose a programmatic API, so the source compiler deliberately uses
the official `@typescript/typescript6` compatibility package until the new API
ships. The two dependencies therefore own different, non-overlapping jobs.

Mise installs Nub and Rust. Nub owns the Node pin in `.node-version`. Poggers
adds transactional semantic replacement over Vite HMR: compatible Program and
Component state plus native UI state survive replacement, while failed
compilation or activation leaves the previous revision live.

## Repository

```text
src/
  application.ts
  process.ts
  cli.ts
  compiler/
    source.ts
    ir.ts
    development.ts
    production.ts
  ui/
    component.ts
    platform.ts
    presentation.ts
    jsx/
    web/
      platform.ts
      toolchain.ts
      component/
        adapter.ts
        compiler.ts
        elements.ts
        interaction.ts
        presence.ts
        runtime.ts
      presentation/
        adapter.ts
        fonts.ts
        language.ts
        motion.ts
        style.ts
template/
```

Generic modules never import web. Files exist only for an independent contract,
lifecycle, translation, or focused test. `template/` is the canonical generated
application; the repository maintains no residue examples.

## Verification

- `tsc --noEmit` checks the entire product language and compile-only
  `*.typecheck.ts(x)` contracts.
- Vitest runs colocated `*.spec.ts` behavior, integration, and adapter tests.
- fast-check properties cover lifecycle ownership, deterministic IR,
  interruption-safe motion, and other sequence-heavy invariants with shrinking.
- Oxlint and Oxfmt enforce one source convention.
- The CLI integration test generates a fresh application, typechecks it, builds
  development and production artifacts, and checks the emitted IR.
- Real-browser acceptance verifies loading, interaction, Presentation,
  disposal, HMR preservation, production equivalence, and console cleanliness.
