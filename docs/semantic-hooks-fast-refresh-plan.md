# Semantic Hooks And Fast Refresh Plan

## Goal

Make Poggers UI code feel semantic, stateful, and fast by default:

- App authors compose generated hooks such as `api.useChat`, `ui.useComposer`, `ui.useTextArea`, and `ui.useButton`.
- Those hooks expose slots, state, derived values, actions, and imperative methods.
- Alien Signals stays internal as the reactive engine.
- Component edits use framework-aware Fast Refresh and preserve compatible hook state instead of remounting everything from scratch.
- Rendering moves toward Solid-style fine-grained DOM updates and React-Compiler-style automatic optimization without asking app authors to write low-level memo/effect/state primitives.

## Design Principles

- Public API is semantic hooks, not raw reactive primitives.
- The app spec remains the source of type truth.
- UI hooks are full behavior bindings, not only style bindings.
- Component-local state belongs to hook instances and semantic identities.
- CSS/style edits must preserve all browser state.
- Component edits must preserve compatible semantic hook state.
- Full reload remains acceptable for API/schema/server contract changes.
- Compiler features should reduce ceremony, not create a new file format.

## Target Authoring Shape

```tsx
const chat = api.useChat({ sessionId: "default" });
const composer = ui.useComposer({
  disabled: chat.status() === "generating",
  onSubmit: chat.sendMessage,
});

return (
  <form {...composer.root}>
    <textarea {...composer.input} />
    <button {...composer.submit}>Send</button>
  </form>
);
```

The hook result may expose:

```ts
composer.value;
composer.focused;
composer.canSubmit;
composer.clear();
composer.focus();
composer.submit();
composer.root;
composer.input;
composer.submit;
```

## Proposed Spec Shape

Keep existing `UI.Styles` valid. Add richer `UI.Components` as the semantic surface:

```ts
type App = {
  UI: {
    Components: {
      Composer: {
        Slots: {
          root: "form";
          input: "textarea";
          submit: "button";
        };
        State: {
          value: string;
          focused: boolean;
          status: "idle" | "submitting";
        };
        Derived: {
          canSubmit: boolean;
        };
        Actions: {
          clear: [];
          focus: [];
          submit: [];
        };
        Variants: {
          tone: "plain" | "elevated";
        };
      };
    };
  };
};
```

`ui.useComposer()` should combine:

- typed slots from `Slots`
- style selectors from `Styles` or component defaults
- internal state signals from `State`
- computed values from `Derived`
- generated imperative methods from `Actions`
- event handlers and accessibility bindings

## Runtime Architecture

### Reactive Core

- Wrap Alien Signals behind Poggers-owned internals.
- Expose semantic hooks publicly.
- Keep low-level primitives available only as escape hatches or internal APIs.
- Add owner scopes so all effects/signals created by a component/hook are associated with an instance.

### Hook Identity

- Every component render has an owner.
- Every hook call receives a stable slot within that owner.
- Semantic hooks may also use explicit identity:
  - component name
  - call index
  - optional `key`
  - resource key
  - slot name
- Fast Refresh reuses hook state when:
  - component identity is compatible
  - hook order is compatible
  - semantic hook type is compatible

### Rendering

- Current runtime milestone:
  - preserve signal/hook state across hot root rerenders
  - remount DOM for component edits if needed
  - avoid document navigation
- Next compiler milestone:
  - compile JSX into static DOM templates
  - bind dynamic attributes/text to fine-grained effects
  - update only touched DOM nodes
  - reconcile keyed lists precisely
  - avoid rerunning components on signal updates

### Activity

Add an Activity/View primitive inspired by React Activity:

- hidden views keep DOM and hook state
- visual display is disabled
- effects/subscriptions can pause
- background work is lower priority
- navigation restores scroll, inputs, and component state

### Scheduler

Add a small scheduler on top of Alien Signals:

- urgent lane for input, focus, pointer, keyboard
- normal lane for ordinary data updates
- transition lane for expensive derived UI
- idle lane for pre-render and background preparation
- batched flushes for multiple signal writes

## Research Anchors

- React Fast Refresh preserves compatible hook state when hook order remains stable, and resets when compatibility is unsafe: https://reactnative.dev/docs/fast-refresh
- React Activity keeps hidden UI mounted so DOM and state can survive view switches, while hidden work can be deprioritized: https://react.dev/reference/react/Activity
- Solid's model updates the specific computations and DOM bindings that depend on changed signals, instead of rerunning broad component trees: https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity
- Alien Signals gives us a compact push-pull signal core to hide behind Poggers-owned semantic hooks: https://github.com/stackblitz/alien-signals

## Implementation Checklist

### Milestone 1: State-Preserving Fast Refresh

- [x] Add owner-level state slots to the native UI runtime.
- [x] Make `signal()` reuse previous hot state when called in a compatible owner slot.
- [x] Store hot render state in generated dev entrypoint `import.meta.hot.data`.
- [x] Preserve component-local signal state across component-code HMR.
- [x] Keep CSS HMR state-preserving.
- [x] Do not preserve state on normal full page load.
- [x] Add focused tests or browser gates for textarea state preservation.

### Milestone 2: Semantic Hook State Foundation

- [x] Extend `AppSpec.UI` with `Components` while keeping `Styles` backward-compatible.
- [x] Add type extraction helpers:
  - [x] `ComponentName`
  - [x] `ComponentSlots`
  - [x] `ComponentState`
  - [x] `ComponentActions`
  - [x] `ComponentVariants`
- [x] Generate `ui.useX` hooks from `UI.Components`.
- [x] Return slot bindings plus state/actions from each semantic hook.
- [x] Allow slot binding to carry:
  - [x] DOM props
  - [x] event handlers
  - [x] accessibility attributes
  - [x] style selector data attributes
  - [x] ref capture for imperative actions
- [x] Keep existing style-only hooks working.

### Milestone 3: State Machines

- [ ] Add optional component state machine metadata to the spec.
- [ ] Generate typed transitions/actions.
- [ ] Support derived state and guarded transitions.
- [ ] Ensure transitions are signal writes batched into one flush.
- [ ] Test that impossible transitions fail at type level or runtime with useful errors.

### Milestone 4: Compiler Runtime

- [ ] Add a Bun plugin/compiler pass for Poggers JSX.
- [ ] Hoist static DOM templates.
- [ ] Compile dynamic JSX expressions into fine-grained bindings.
- [ ] Compile spread semantic slot bindings efficiently.
- [ ] Generate keyed list reconciliation for `For`.
- [ ] Generate show/switch DOM anchors without recreating unrelated nodes.
- [ ] Add source maps and readable dev output.

### Milestone 5: Activity And Scheduling

- [ ] Add `Activity`/`View` primitive.
- [ ] Preserve DOM/state for hidden views.
- [ ] Pause or lower priority for effects in hidden views.
- [ ] Add transition/deferred update helpers internally.
- [ ] Integrate navigation with view preservation.
- [ ] Add browser tests for input/scroll preservation across navigation.

### Milestone 6: Fast Refresh Compatibility Rules

- [ ] Track component and semantic hook signatures in dev.
- [ ] Preserve state when signatures are compatible.
- [ ] Reset only affected owner subtree when incompatible.
- [ ] Show a useful dev console reason for refresh resets.
- [ ] Preserve resource/API hook state across compatible UI edits.
- [ ] Never preserve state across incompatible API/schema changes.

## Verification Gates

### Static Gates

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run fmt:check`
- [x] `bun test`
- [x] `bun run --filter @poggers/chat build`

### Runtime Gates

- [x] `poggers dev` serves Bun HMR client.
- [x] `/ws` still upgrades to the app protocol.
- [x] PWA assets still respond.
- [x] SPA fallback still responds.
- [x] CSS edit changes computed styles without navigation.
- [x] CSS edit preserves textarea text.
- [x] Component edit updates visible text without navigation.
- [x] Component edit preserves compatible `signal()` state.
- [x] Component edit preserves semantic `ui.useX` state.
- [ ] Incompatible hook signature change resets only the affected subtree.

### Browser Gate Scenario

1. Start `apps/chat` with `poggers dev`.
2. Open the app in a browser.
3. Type `keep me through fast refresh` into the textarea.
4. Edit a style in `apps/chat/styles.ts`.
5. Verify computed style changes and textarea value remains.
6. Edit a visible label in `ChatScreen.tsx`.
7. Verify visible label changes, navigation count remains `1`, and textarea value remains.
8. Restore edited files.

## Completion Criteria

This plan is complete when app authors can keep writing semantic Poggers UI code, edits to styles and compatible components update without page navigation, and component-local/semantic-hook state survives Fast Refresh without exposing raw signals as the primary app API.
