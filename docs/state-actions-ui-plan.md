# State and Actions UI Migration

Status: complete

## Objective

Replace the component statechart surface and the remaining lifecycle DSL with one behavioral model for every Program and Component:

- `state` contains reactive values.
- `actions` are the only authored functions that mutate state or initiate finite work.
- optional `start` connects long-lived external sources to actions.
- `view` describes hierarchy and binds native platform properties and events.
- Presentations read reactive state, own visual styling and motion, and invoke typed semantic actions when visual work completes.

The migration is intentionally breaking. There is no compatibility layer, deprecated syntax, statechart translation, or second way to express the same behavior.

## Laws

- **One mutation boundary:** authored state changes happen only inside actions.
- **Values are values:** state and presentation parameters are reactive values, never function wrappers.
- **Actions are functions:** commands exposed to views and Presentations are functions with contract-declared arguments and results.
- **Generic contracts drive types:** application authors provide the contract through generic parameters; runtime helpers do not exist merely to recover inference.
- **Native platform access stays native:** JSX accepts the platform's properties, ARIA attributes, refs, and event listeners directly.
- **Effects are capabilities:** network, storage, clocks, schedules, observers, and subscriptions cross a typed Capability boundary.
- **Lifecycle is owned:** resources returned by Capabilities are adopted by the nearest Program or Component owner and disposed exactly once.
- **Visuals stay visual:** springs, gestures, layout animation, presence, interruption, and settlement are Presentation concerns.
- **Semantic completion is explicit:** a Presentation may invoke a typed action such as `finishClosing`; it does not mutate state or drive a hidden statechart.
- **Fine-grained by default:** reading one state field subscribes only to that field; actions batch synchronous writes; native bindings update without a virtual DOM render.
- **No authored cleanup ceremony:** authors return `Disposable`, `AsyncDisposable`, promises resolving to resources, or async iterators; the runtime owns teardown.
- **No hidden browser DSL:** native listeners remain in JSX or native refs. `start` is only for relationships that outlive one event callback.

## Target Surface

### Program

```tsx
type Chat = {
  Programs: {
    browser: Program<
      WebMain,
      {
        Requires: { chat: ChatPort };
        State: { messages: readonly Message[]; sending: boolean };
        Actions: {
          receive(input: { messages: readonly Message[] }): void;
          send(input: { text: string }): Promise<void>;
        };
        Components: { Composer: ComposerContract };
      }
    >;
  };
};

const chat: Feature<Chat> = {
  programs: {
    browser: {
      state: { messages: [], sending: false },
      actions: {
        receive({ state }, { messages }) {
          state.messages = messages;
        },
        async send({ state, capabilities }, { text }) {
          state.sending = true;
          try {
            await capabilities.chat.send({ text });
          } finally {
            state.sending = false;
          }
        },
      },
      start({ actions, capabilities }) {
        return capabilities.chat.subscribe((messages) => actions.receive({ messages }));
      },
      components: {/* ... */},
    },
  },
};
```

`start` cannot mutate Program state directly. It receives bound actions and capabilities. This makes every external update follow the same mutation path as UI input.

### Component

```tsx
type Drawer = {
  State: {
    phase: "closed" | "opening" | "open" | "closing";
    view: "default" | "phrase" | "remove";
    dragOffset: VisualValue<"length">;
    dragVelocity: number;
  };
  Actions: {
    open(): void;
    close(): void;
    finishOpening(): void;
    finishClosing(): void;
    drag(input: { offset: number; velocity: number }): void;
  };
  Parts: { Root: "div"; Dialog: "dialog"; Surface: "section" };
};

const Drawer = {
  state: {
    phase: "closed",
    view: "default",
    dragOffset: 0,
    dragVelocity: 0,
  },
  actions: {
    open({ state }) {
      if (state.phase === "closed" || state.phase === "closing") state.phase = "opening";
    },
    close({ state }) {
      if (state.phase === "open" || state.phase === "opening") state.phase = "closing";
    },
    finishOpening({ state }) {
      if (state.phase === "opening") state.phase = "open";
    },
    finishClosing({ state }) {
      if (state.phase === "closing") state.phase = "closed";
    },
    drag({ state }, { offset, velocity }) {
      state.dragOffset = offset;
      state.dragVelocity = velocity;
    },
  },
  start({ actions, capabilities, parts }) {
    return capabilities.drag.observe(parts.Surface.element, actions.drag);
  },
  view({ state, actions, parts: { Root, Dialog, Surface } }) {
    return (
      <Root>
        <Dialog open={state.phase !== "closed"} onCancel={actions.close}>
          <Surface />
        </Dialog>
      </Root>
    );
  },
};
```

Component actions receive mutable local `state`, readonly `input`, the containing Program `process`, Presentation `parameters`, mounted `parts`, and the Program's typed `capabilities`. The `view` receives readonly state and bound actions. Component `start` runs after the component and its Parts mount, receives bound actions plus readonly context, and cannot mutate state directly.

### Presentation

```ts
createComponent(({ tokens, createRecipe, createMotion }) => {
  const surface = createRecipe(/* static and conditional visual rules */);

  return ({ state, actions, parts }) => {
    surface(parts.Surface, { phase: state.phase });
    createMotion(parts.Surface, {
      value: state.phase,
      enter: { spring: tokens.motion.sheet, complete: actions.finishOpening },
      exit: { spring: tokens.motion.sheet, complete: actions.finishClosing },
    });
  };
});
```

The exact compiled motion shape may differ, but its contract must preserve these semantics: state selects visual intent; Presentation configuration selects trajectory; completion calls a typed action; cancellation never calls the stale completion.

## Runtime Semantics

1. Materialize initial state into one fine-grained signal per field.
2. Create bound actions. Each invocation checks liveness, batches synchronous writes, and adopts returned resources.
3. Render the view once and mount Parts using direct DOM bindings.
4. Mount the Presentation and connect reactive visual reads.
5. Run Component `start` after Parts exist. Adopt every returned resource.
6. On interruption, cancel superseded visual work before starting its replacement.
7. On component removal or hot replacement, stop Presentation work, dispose Component resources in reverse order, clear Parts, and invalidate actions.
8. Program lifecycle follows the same action and resource rules. Child Feature Programs start before parents so provided Capabilities can be injected deterministically.

## Scope

### 1. Contract and type surface

- [x] Remove `Output`, `Tasks`, `Writable`, statechart nodes, transitions, task invocations, and machine-specific phase types from `ComponentContract`.
- [x] Keep `VisualValue<Kind>` only as a semantic numeric unit marker for Presentation compilation.
- [x] Add contract-derived Component action definitions and Component `start` scopes.
- [x] Make Component action results match their declared contract instead of always returning `void`.
- [x] Expose typed Program capabilities to Component actions and `start` without adding another dependency declaration.
- [x] Remove `observe` from the public Program start scope.
- [x] Remove direct mutable Program state from Program `start`.
- [x] Add negative type fixtures proving `machine`, `tasks`, direct `start` state mutation, and undeclared action/capability access fail.

**Gate A:** TypeScript accepts the target examples and rejects every removed surface without casts or wrapper-based inference.

### 2. Unified lifecycle runtime

- [x] Extract one internal owner scope used by Program and Component instances.
- [x] Adopt `Disposable`, `AsyncDisposable`, promises resolving to either, and async iterators returned by `start`, actions, and Capability calls.
- [x] Batch synchronous action writes and prevent stale asynchronous continuations from mutating disposed state.
- [x] Start Component lifecycle only after Parts mount and dispose it exactly once in reverse acquisition order.
- [x] Preserve component and Program state across compatible HMR updates while replacing action and `start` implementations.
- [x] Remove public cleanup callbacks and runtime `observe` sugar.

**Gate B:** Unit tests cover mount, action, subscription, interruption, hot replacement, and disposal traces; generated traces contain no duplicate start, stale mutation, or leaked resource.

### 3. Presentation coordination

- [x] Replace statechart settlement with typed action completion owned by the Presentation motion coordinator.
- [x] Ensure superseded enter/exit/layout/gesture animations are cancellable and cannot emit stale completion actions.
- [x] Preserve drag velocity and live visual values through interrupted transitions.
- [x] Keep Presentation parameters reactive and available to Component actions where behavior legitimately depends on preset UX thresholds.
- [x] Keep all trajectories, durations, springs, transforms, opacity, layout, and presence choices out of Component behavior.
- [x] Remove machine path matching from compiled visual conditions; compile semantic state conditions directly.

**Gate C:** Fast deterministic tests prove open/close/open interruption, drag/release/dismiss, layout interruption, and completion ordering for at least two Presentations.

### 4. Application migration

- [x] Migrate Chat submission from machine task to Component actions calling the Program action.
- [x] Migrate Visual Lab presentation switching to state/actions with typed completion.
- [x] Migrate the drawer's open, close, view, gesture, measurement, and settlement behavior without a statechart.
- [x] Move `ResizeObserver` lifetime from an inline ad hoc helper into Component `start` or an owned native ref resource.
- [x] Remove all machine-only imports, declarations, files, tests, dependencies, and package entries.

**Gate D:** Repository search finds no authored `machine`, XState, statechart task, settlement DSL, `Writable`, or public `observe` surface.

### 5. Compiler and HMR

- [x] Teach the component compiler to extract `state`, `actions`, `start`, `view`, Parts, and semantic visual value kinds.
- [x] Reject mutable state writes outside action definitions.
- [x] Emit deterministic metadata for action names, state fields, capabilities, Parts, and visual units.
- [x] Preserve state when contracts remain compatible; remount cleanly when state or Part shape is incompatible.
- [x] Verify style and action implementation edits hot-reload without duplicate listeners or lost interaction.

**Gate E:** Compiler snapshots are deterministic; HMR tests and a real browser session prove state preservation, action replacement, style replacement, and single subscription ownership.

### 6. Verification and cleanup

- [x] Run format, lint, TypeScript, unit tests, and production builds from a frozen Nub install.
- [x] Pack `@poggers/kit`, create a generated application from the packed artifact, install, typecheck, and build it.
- [x] Use the real in-app browser/agent browser, not Playwright, to verify Chat and Visual Lab on desktop and mobile widths.
- [x] Exercise rapid repeated input, open/close/open interruption, drag cancellation, view switching, Presentation switching, and disposal.
- [x] Inspect browser console output and confirm there are no runtime errors, stale backdrops, dead hit targets, duplicate subscriptions, or unresponsive actions.
- [x] Remove obsolete files and empty directories and confirm the package exports only the supported surface.

**Gate F:** `nub run check && nub run build` passes, package consumption passes, and browser verification demonstrates correct interaction and HMR end to end.

## Required Tests

- Program actions are the only Program mutation path.
- Component actions are the only Component mutation path.
- Action return values and promise types match the generic contract.
- Synchronous multi-field writes notify dependents once per batch.
- High-frequency visual values update direct bindings without rerendering component hierarchy.
- Component `start` sees mounted Parts and typed capabilities.
- Program and Component subscriptions dispose once and in reverse acquisition order.
- Resources returned directly or through promises are adopted.
- Async actions cannot mutate after disposal or incompatible hot replacement.
- Repeated mount/unmount and HMR do not accumulate native listeners.
- Cancelled visual work never fires completion; completed work fires exactly once.
- Rapid alternating actions converge to the latest semantic state.
- Presentation parameters are reactive, typed, and scoped to the selected Presentation.
- Native JSX listeners, refs, ARIA, keyboard, pointer, dialog, and focus behavior remain available without framework wrappers.

## Verification Evidence

- Frozen `nub install`, TypeScript, Oxlint, Oxfmt, 9 test files with 91 tests, and all three production builds pass.
- Compiler tests cover deterministic Component state, action, parameter, Part, lifecycle, and visual-unit metadata. HMR tests reject incompatible Component state, parameter, visual-unit, and Part changes while accepting compatible implementation changes.
- Runtime tests cover batched writes, exact reverse disposal, direct and promised resources, async iterators, cancellation, stale async actions, Feature composition, and 100 serialized hot revisions.
- Motion tests cover stale-completion suppression, latest-intent completion, replacement, cancellation, drag trajectories, layout interruption, and adapter settlement.
- A generated application installed, typechecked, tested, and built against the packed `@poggers/kit` tarball.
- Agent Browser verified Chat and both Visual Lab Presentations on desktop and mobile: submission, navigation, open/close/open interruption, view switching, Presentation switching, live drag transform, spring return/dismissal, clean exit, viewport containment, and zero browser errors.
- Compatible action and style edits hot-reloaded in place with state preserved and no duplicate listeners. An incompatible native Part edit caused a clean reload and remount instead of restoring stale Component state.

## Completion Criteria

This plan is complete only when:

- Programs and Components visibly share the same `state + actions + optional start` grammar.
- No statechart or lifecycle DSL remains in the public or internal component path.
- Capabilities are the only route to external finite or long-lived work.
- Presentations retain complete control of visual motion and cannot mutate state directly.
- Complex drawer behavior, drag interruption, visual settlement, Chat submission, and HMR work in the browser.
- All verification gates pass from a clean dependency install and a packed consumer application.
- This document's status is changed to `complete` and every checklist item is checked only after its evidence exists.
