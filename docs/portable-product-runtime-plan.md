# Portable product runtime plan

Status: complete

This is the living design, implementation checklist, and evidence log for the
runtime migration. There is no backward compatibility. A checked item means
the source, public types, focused tests, generated artifacts, and maintained
documentation agree.

## Objective

Poggers is a small TypeScript product language with two authored forms:

- a headless **Program** performs persistent procedural work for a declared
  **Runtime**;
- a platform UI Program adds reactive state, actions, Components, a root, and
  Presentations for a UI Runtime.

Applications compose reusable vertical Features. Every dependency, effect,
external state source, native service, and communication channel crosses a
typed semantic Capability. A target adapter supplies those Capabilities and
runs the Program in development or production.

The compiler extracts deterministic, versioned Poggers IR from an explicit
portable TypeScript subset. Node executes that IR for development and tests.
The Rust backend generates a native headless Program and a typed Capability
trait. Web UI stays a direct-DOM Vite target.

Poggers does not prescribe HTTP, storage, synchronization, authentication,
queues, topology, or distributed-state semantics. Those can be implemented as
Capabilities without adding them to core.

## Laws

1. There is one Application, Feature, Program, Capability, Component, and
   Presentation model.
2. Generic contract parameters are the source of contextual type safety. A
   `defineX` wrapper never exists only to recover inference.
3. Features may contribute to several named Programs and compose child
   Features. Programs with the same name form one Process and must require the
   same Runtime.
4. A Program is authored product meaning. A Process is its running instance and
   is not part of authored contracts.
5. Capabilities are the only effect and dependency boundary.
6. Components and Presentations cannot call Capabilities. Program actions and
   `start` connect Capabilities to reactive UI state.
7. State values are values; actions are functions.
8. Components own native hierarchy, accessibility, listeners, local interaction
   state, and composition. Presentations own every visual and motion decision.
9. The runtime owns persistent resource cleanup. Product code does not register
   mechanical `onDispose` callbacks.
10. Development and production consume the same typed IR. Backend choices do
    not alter product meaning.
11. Unsupported portable TypeScript is rejected at its source location. There
    is no silent JavaScript fallback for a Rust target.
12. Generated files live under `.poggers` or an explicit output directory and
    are never source.
13. The removed sync, substrate, workflow, host, migration, and legacy Feature
    machinery stays removed.
14. The web adapter uses direct DOM and fine-grained signals, not a virtual DOM.

## Final architecture

```text
Application
`- Features
   |- named Programs
   |  |- Runtime requirement
   |  |- required/provided Capability contracts
   |  |- one scoped start lifecycle
   |  `- optional platform UI
   |     |- reactive state and actions
   |     |- Components and one root
   |     `- Presentations through named Parts
   `- child Features

TypeScript source
`- TypeScript diagnostics and semantic frontend
   `- versioned, dependency-free Poggers IR
      |- Node executor for portable headless logic
      |- Vite web development/production adapter
      `- Rust headless production adapter
```

A Runtime is semantic product metadata, for example `server`, `web-main`,
`web-service-worker`, or an application-defined runtime. A target adapter
selects which Program to run and how its Capabilities are resolved. Core does
not auto-launch every declared Runtime or invent deployment topology.

The maintained authored shape is:

```tsx
type Orders = {
  Programs: {
    cloud: Program<Server, { Requires: { store: Store }; Provides: { orders: OrdersAPI } }>;
    browser: Program<
      WebMain,
      {
        Requires: { orders: OrdersAPI; navigation: Navigation };
        State: { orders: readonly Order[]; status: "loading" | "ready" };
        Actions: { refresh(): Promise<void>; open(input: { id: string }): void };
        Components: { OrderList: OrderListContract };
      }
    >;
  };
};

export const orders = {
  programs: {
    cloud: {
      start({ capabilities }) {
        return { orders: createOrders(capabilities.store) };
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
          view({ parts: { Root, Row, Name }, process }) {
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
} satisfies Feature<Orders>;
```

`start` establishes long-lived relationships. Actions handle finite input.
Components render state and call actions. Capability handles remain semantic;
normal teardown is automatic.

## Portable subset

The initial Rust-capable subset is intentionally small and complete:

- boolean, number, string, void, and literal types;
- records, arrays, tuples, optional values, promises, and string-literal unions;
- literals, records, arrays, property access, unary and binary expressions;
- local `let` bindings and `=`, `+=`, `-=`, `*=`, `/=` assignment;
- `if`, `for..of`, early return, and finite portable process bodies;
- awaited direct calls to declared Capability operations;
- async `start` functions.

The frontend rejects undeclared runtime calls, ambient I/O, `any`, dynamic
code, unsupported coercions, arbitrary local calls or closures, classes,
generators, exceptions, reflection, dynamic imports, and unsupported control
flow. The subset grows only when its TypeScript meaning, IR, Node execution,
Rust lowering, diagnostics, and differential tests land together.

TypeScript 7/`tsgo` is the authoritative checker. Its stable programmatic API is
not available yet, so one private frontend boundary uses the maintained
TypeScript 6 API for semantic extraction. TypeScript compiler objects do not
leak into IR, runtimes, backends, or public exports.

## Lifecycle contract

Each Process contribution owns an internal scope. Capability calls made during
`start` are scoped automatically. The scope adopts:

- `Disposable` and `AsyncDisposable` values;
- promises resolving to owned resources;
- active async iterators;
- fine-grained `observe` effects;
- resources returned through provided Capability objects.

Teardown is idempotent, reverse ordered, and aggregates failures after all
cleanup runs. Product-driven early cancellation uses the semantic handle
returned by a Capability; it is distinct from automatic lifecycle cleanup.

## Hot-update contract

Vite owns the module graph, transforms, update detection, and transport.
Poggers owns semantic replacement and the live state registry. There are two
deliberate update classes:

1. **Presentation update.** Compiled visual definitions are swapped in place.
   Existing Component instances and exact DOM nodes remain mounted. A change
   that alters collection mounting semantics falls back to class 2.
2. **Structural or behavioral update.** The candidate is compiled and prepared
   in isolation. Compatible declared state, keyed values, focus/selection,
   scroll, and native dialog state are captured and restored around one direct
   DOM replacement. The old revision remains live if compilation or activation
   fails.

The coordinator serializes updates, validates state schemas, supports additive
and removed fields, rejects changed field types, rolls back failed activation,
and owns exactly one live revision. Exact DOM identity is guaranteed for class
1, not falsely claimed for class 2.

## Toolchain

- Node `24.18.0` is pinned in `.node-version`.
- Nub `0.4.13` is the package manager, script runner, and TypeScript runner.
- `nub.lock` is the committed lockfile.
- Vite 8/Rolldown owns browser development and production builds.
- Vitest owns focused unit and integration tests.
- TypeScript 7 owns typechecking.
- Oxfmt and Oxlint own formatting and linting.
- Cargo owns native Rust builds.
- Bun, Turbo, polling reload, custom reload WebSockets, and Playwright are not
  part of the repository.

## Implementation workbench

### 1. Product language

- [x] Flatten UI fields into their owning UI Program; remove nested `ui`.
- [x] Keep headless Programs free of UI fields.
- [x] Contextually type Programs, Features, actions, `start`, Components, and
      child Feature surfaces from generic contract parameters.
- [x] Preserve nested Feature composition, repeated instance isolation,
      Component composition, roots, Parts, and Presentations.
- [x] Reject UI on headless Runtimes and conflicting Runtime contributions.
- [x] Remove legacy aliases and helper wrappers used only for inference.

### 2. Runtime lifecycle

- [x] Implement reactive UI surfaces and scoped Program contributions.
- [x] Implement automatic resource, promise, async iterator, and observation
      ownership.
- [x] Implement reverse teardown, idempotence, cleanup aggregation, and stale
      async-write protection.
- [x] Keep product cancellation separate from automatic cleanup.
- [x] Resolve and publish Capabilities through one `ProgramAdapter` boundary.

### 3. Compiler and IR

- [x] Define deterministic versioned IR with source spans and semantic IDs.
- [x] Isolate the TypeScript Compiler API behind the frontend.
- [x] Extract Feature composition, Programs, Runtimes, Capability contracts, UI
      schemas, Component identities, and supported portable bodies without
      executing application source.
- [x] Reject every unsupported construct before backend execution.
- [x] Add byte-stability, declaration-reordering, negative, and side-effect
      fixtures.

### 4. Node, Nub, and Vite

- [x] Pin Node/Nub and replace Bun/Turbo metadata, commands, tests, and locks.
- [x] Move browser transforms, virtual modules, StyleX, fonts, assets, and HMR
      transport to Vite 8.
- [x] Preserve Vite default client/server conditions after adding
      `poggers-source`, so dependency optimization selects ESM correctly.
- [x] Keep generated applications free of per-app Vite configuration and
      generated declaration files.

### 5. Semantic HMR

- [x] Implement serialized candidate prepare/activate/dispose transactions.
- [x] Keep the last valid revision live after compile or activation failure.
- [x] Patch Presentation/token updates without remounting Components.
- [x] Restore compatible Program/Component state and native UI state for full
      replacements.
- [x] Propagate full source modules through Vite as well as the generated
      candidate, preventing stale logic with fresh state.
- [x] Coalesce ResizeObserver-driven geometry writes to animation frames.
- [x] Verify 100 synthetic replacements with one live scope.

### 6. Rust backend

- [x] Generate a Cargo project for one selected portable headless Program.
- [x] Lower the documented subset and generate exact typed Capability traits.
- [x] Expose one production adapter contract: `create() -> impl Capabilities`.
- [x] Keep JSON fixtures test-only and reject missing fixtures before Cargo.
- [x] Differentially verify success, branching, loops, async Capability order,
      and Capability failure under Node and Rust.
- [x] Run Cargo format, check, clippy with denied warnings, and release builds.
- [x] Keep browser UI on the web target and native artifacts free of JavaScript.

### 7. Product evidence

- [x] Keep Chat as the small Feature/Component composition application.
- [x] Keep Visual Lab as the direct-DOM Presentation, responsive motion, and
      gesture application.
- [x] Represent server, web-main, service-worker, and custom Runtimes in type
      and IR fixtures; leave artifact selection to target adapters.
- [x] Exercise a real Rust Capability adapter through the public CLI build path.
- [x] Update the generated scaffold to the final API and toolchain.
- [x] Verify Chat navigation, input, asynchronous response, and retained state
      in a real browser.
- [x] Verify Visual Lab desktop/mobile presentation switching, native dialog,
      keyboard close/focus restoration, drag/snap/dismiss/reopen, and clean
      browser diagnostics.
- [x] Verify in-place Presentation HMR, failed-compile isolation, and full-update
      state restoration in a real browser.

### 8. Final audit

- [x] Remove generated caches, old Turbo residue, and dangling directories.
- [x] Run frozen install, TypeScript, Oxlint, Oxfmt, Vitest, package build, both
      web application builds, and Rust release evidence from clean outputs.
- [x] Inspect package dry-run contents and public exports deliberately.
- [x] Search source and metadata for Bun, `onDispose`, `location.reload`, polling
      watchers, nested Program `ui`, and removed substrate compatibility names.
- [x] Review the final tree and diff for overlapping concepts or unexplained
      files.
- [x] Set this document to complete with exact final evidence.

## Acceptance gates

- [x] Generic type fixtures cover server, web main, service worker, custom
      Runtime, multiple Programs, child Features, composition, and invalid
      contracts.
- [x] Lifecycle tests use deterministic promises/resources rather than sleeps.
- [x] IR is dependency-free, versioned, deterministic, and does not execute
      application behavior.
- [x] Node and Rust agree on the supported portable success and failure cases.
- [x] Presentation-only HMR retains exact dialog and heading DOM identities.
- [x] Full HMR applies changed source while retaining open native dialog and
      compatible Component state.
- [x] Failed Presentation compilation leaves the previous dialog interactive.
- [x] Mobile drag produces intermediate geometry, snap-back, velocity dismissal,
      immediate trigger hit testing, and no ResizeObserver loop error.
- [x] Every repository, package, application-build, source-search, and clean-tree
      gate passes together.

## Evidence log

- Focused suite before final audit: 10 files, 84 tests.
- Rust evidence: fixture differential, failure differential, typed real adapter,
  Cargo format/check/clippy/release, and no JS runtime in the artifact.
- Cold Vite evidence: Chat renders on an empty optimizer cache and Vite selects
  ESM entries for StyleX, TanStack Virtual, Alien Signals, XState, and Anime.js.
- Presentation HMR evidence: one update, same dialog object, same heading object,
  one native dialog, preserved Private Key view, preserved scroll lock.
- Failed-compile evidence: syntax error reported by the server while the exact
  previous dialog and heading remained mounted, open, and interactive.
- Full-update evidence: changed `app.tsx` text rendered after one HMR update;
  Private Key state and native-open dialog survived; reverse edit restored it.
- Mobile evidence: 390x844 bottom sheet, measurable drag transform, snap-back,
  velocity dismissal, immediate reopen, Escape close, and focus restoration.
- Clean-install evidence: all workspace `node_modules` directories were removed;
  `nub install --frozen-lockfile` realized 114 packages with no Playwright,
  Turbo, or native-preview binary.
- Final repository gate: `nub run check && nub run build` passed after that clean
  install. TypeScript 7 checked the kit, Chat, and Visual Lab; Oxlint and Oxfmt
  passed; Vitest passed 10 files and 84 tests; the kit and both Vite web
  applications built successfully.
- Distribution evidence: `nub pack --dry-run --json` contains 88 files, including
  runtime JS, declarations, source-condition files, and the shared tsconfig,
  with zero specs, typecheck fixtures, generated application files, or app
  residue.
- Packed-app evidence: a real tarball was installed into a new generated app;
  its own `nub run check` passed and its production build emitted `app.js`,
  `styles.css`, `index.html`, and `product.ir.json`.
- Final cleanup evidence: no empty source directory, `.turbo`, `.poggers`, app
  build output, relevant listening dev server, or diff whitespace error remains.
