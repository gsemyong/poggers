# Poggers architecture

Poggers is a small TypeScript product language for portable Programs and
direct, platform-native user interfaces. An Application composes reusable
Features. Each Feature may contribute to several named Programs and compose
child Features. Everything outside pure product logic crosses a typed
Capability contract.

Poggers deliberately does not prescribe storage, transport, synchronization,
authentication, queues, deployment topology, or distributed-state semantics.
Those are semantic Capabilities supplied by a Runtime adapter.

## Concepts

- **Application** composes Features and Presentations into one product.
- **Feature** is a reusable vertical product slice.
- **Program** is a static contribution to one named product participant.
- **Runtime** identifies the environment required by a Program, such as a
  server, web main thread, or service worker.
- **Process** is one running instance assembled from all contributions to a
  named Program. It is not an authored contract.
- **Capability** is a typed semantic ability. It is the only effect,
  dependency, and communication boundary.
- **Component** defines native hierarchy, accessibility, listeners, local
  interaction state, and composition.
- **Presentation** owns every visual, responsive, asset, and motion decision
  through named Component Elements.

```text
Application
`- Features
   |- named Programs
   |  |- Runtime
   |  |- required/provided Capabilities
   |  |- start lifecycle
   |  `- optional platform UI
   |     |- reactive state and actions
   |     |- Components and one root
   |     `- named Elements styled by Presentations
   `- child Features

TypeScript source
`- compiler frontend
   `- versioned, dependency-free product IR
      |- development backend
      `- production backend
```

## Product language

Generic contract parameters provide contextual type safety. No `defineX`
wrapper exists merely to recover inference. UI fields are flattened into their
owning Program; there is no second `ui` object.

```tsx
import type { Feature, Program, Server } from "@poggers/kit";
import { For, type WebMain } from "@poggers/kit/web";

type OrdersFeature = {
  Programs: {
    cloud: Program<
      Server,
      {
        Requires: { database: OrdersDatabase };
        Provides: { orders: Orders };
      }
    >;
    browser: Program<
      WebMain,
      {
        Requires: { orders: Orders; navigation: Navigation };
        State: { orders: readonly Order[]; status: "loading" | "ready" };
        Actions: {
          refresh(): Promise<void>;
          open(input: { id: string }): void;
        };
        Components: { OrderList: OrderListContract };
      }
    >;
  };
};

export const orders = {
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
        capabilities.orders.subscribe(actions.refresh);
      },
      components: {
        OrderList: {
          view({ elements, process }) {
            const { Root, Row, Name } = elements;
            return (
              <Root>
                <For each={process.orders} by="id">
                  {(order) => (
                    <Row onPointerDown={() => process.open({ id: order.id })}>
                      <Name>{order.name}</Name>
                    </Row>
                  )}
                </For>
              </Root>
            );
          },
        },
      },
      root: "OrderList",
    },
  },
} satisfies Feature<OrdersFeature>;
```

`start` establishes long-lived relationships. Actions handle finite input.
Components render reactive state and call actions. Capability objects,
subscriptions, promises resolving to resources, and async iterators created by
`start` are owned and disposed automatically in reverse order.

Child Feature Components are exposed through capitalized namespaces. A parent
composes them like ordinary Components. Features communicate behavior through
Capabilities rather than reaching into sibling or host internals. Navigation is
an application integration Feature plus a platform Capability, not a universal
core routing language.

## UI ownership

The UI layers have non-overlapping responsibilities:

1. Program state and actions coordinate platform-level product behavior.
2. Component state and actions coordinate one mounted interaction.
3. Component views define JSX hierarchy, native attributes, accessibility,
   listeners, gestures, slots, and Component composition.
4. Named Elements expose presentation endpoints backed by native elements.
5. Presentations own styling, conditions, responsive behavior, gestures, and
   motion.

The web platform uses fine-grained signals and direct DOM updates. It has no
virtual DOM. State and actions are the single interaction model at both Program
and Component scope. `start` is the lifecycle boundary for subscriptions and
other long-lived platform work.

## Compilation

The compiler frontend reads the generic contracts and implementations without
executing application behavior. It emits deterministic, versioned product IR
containing Feature composition, Programs, Runtime requirements, Capability
contracts, UI schemas, stable Component identities, and the supported portable
process body.

The development backend turns that meaning into a live, replaceable system. The
production backend turns the same meaning into optimized artifacts. Either
backend may emit or embed any implementation language; those choices do not
change the product language or repository architecture.

Development uses pinned Node and Nub with Vite 8. Poggers owns transactional
semantic replacement on top of Vite HMR: compatible Program and Component state,
focus, selection, scroll, and native dialog state survive replacement; failed
compilation or activation leaves the previous revision live.

The current web production implementation uses Vite/Rolldown. The current
headless production implementation can emit a selected Program as Rust with:

```sh
poggers build --target rust --program <name-or-id> \
  --adapter path/to/adapter.rs
```

The adapter exports `create() -> impl Capabilities`; the generated trait is the
target-specific implementation contract. The Rust target rejects unsupported
product source before Cargo runs and Cargo verifies that the adapter implements
every operation with its exact semantic types. JSON Capability fixtures exist
only for deterministic compiler differential tests. The release artifact has
no JavaScript runtime. Browser UI remains a web target.

## Repository convention

```text
poggers/
  package.json             # the one publishable @poggers/kit package
  scripts/build.ts
  template/                # the canonical generated application
  src/
    application.ts
    execution.ts
    cli.ts
    compiler/
      frontend.ts
      ir.ts
      backend/
        development.ts
        production.ts
    ui/
      component.ts
      platform.ts
      presentation.ts
      web/
        platform.ts
        backend.ts
        jsx/
        structure/
        presentation/
  tsconfig.app.json

generated-application/
  src/
    app.tsx                # composition only
    features/
      <feature>.tsx        # one vertical product slice
    presentations/
      <presentation>.ts    # one complete visual system
```

Top-level files in `ui` are durable platform-neutral concepts and cannot import
a concrete platform. Each platform is a sibling of `ui/web` and owns its JSX
protocol, structural language and runtime, Presentation language and runtime,
and development/production realization. Interaction helpers stay under
structure; animation, style, and asset helpers stay under Presentation.
Experimental platforms are not shipped as framework surface.

The repository does not contain sample applications. `template` is the single
maintained application example and the source copied by `poggers create`. Its
exact files are tested through formatting, lint, type safety, compiler
extraction, and a production build.

Executable behavior and contract checks use colocated `*.spec.ts` files.
`*.typecheck.ts(x)` is reserved for compile-only assertions that cannot execute
as a test module, such as intentionally invalid JSX. Generated artifacts live
under `.poggers` or an explicit output directory and are never source. Public
files exist only for durable architectural concepts.
