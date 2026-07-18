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
- **Presentation** owns every visual, responsive, gesture, and motion decision
  through named Component Parts.

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
   |     `- named Parts styled by Presentations
   `- child Features

TypeScript source
`- compiler frontend
   `- versioned, dependency-free product IR
      |- Node/Vite development adapter
      |- Vite web production adapter
      `- Rust headless production adapter
```

## Product language

Generic contract parameters provide contextual type safety. No `defineX`
wrapper exists merely to recover inference. UI fields are flattened into their
owning Program; there is no second `ui` object.

```tsx
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
          view({ parts, process }) {
            const { Root, Row, Name } = parts;
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
   listeners, slots, and Component composition.
4. Named Parts expose presentation endpoints backed by native elements.
5. Presentations own styling, conditions, responsive behavior, gestures, and
   motion.

The web adapter uses fine-grained signals and direct DOM updates. It has no
virtual DOM. Statecharts are available for interactions that benefit from
explicit states and transitions; they are not the global application model.

## Compilation

The compiler reads the generic contracts and implementations without executing
application behavior. It emits deterministic, versioned product IR containing
Feature composition, Programs, Runtime requirements, Capability contracts, UI
schemas, stable Component identities, and the supported portable process body.

Development uses pinned Node and Nub with Vite 8. Poggers owns transactional
semantic replacement on top of Vite HMR: compatible Program and Component state,
focus, selection, scroll, and native dialog state survive replacement; failed
compilation or activation leaves the previous revision live.

Web production uses Vite/Rolldown. A selected portable headless Program can be
built from the same IR with:

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
packages/kit/
  scripts/build.ts
  src/
    application.ts
    runtime.ts
    compiler/
    tooling/
    ui/
      compiler/
      web/
  tsconfig.app.json

apps/<name>/src/
  app.tsx
  features/<feature>.tsx
  presentations/<presentation>.ts
```

Tests are colocated with the contract or translation they protect. Generated
artifacts live under `.poggers` or an explicit output directory and are never
source. Public files exist only for durable architectural concepts.
