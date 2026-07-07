# Component Instance Bindings Plan

## Goal

Move the UI component API from generated `ui.useX(...)` hooks that return spreadable slot prop bags to generated verb-named factories such as `ui.createComposer(...)` that return a typed component instance:

```tsx
const Composer = ui.createComposer({
  state: { value: "" },
  actions({ state }) {
    return {
      input(value: string) {
        state.value = value;
      },
      submit() {
        const text = state.value.trim();
        if (!text) return;
        void chat.sendMessage(text);
        state.value = "";
      },
    };
  },
});

return (
  <Composer.Root>
    <Composer.Input placeholder="Message..." />
    <Composer.Send>Send</Composer.Send>
  </Composer.Root>
);
```

The app spec remains the source of truth. State identity comes from the owning JSX/component instance and normal JSX `key`; state factories do not require tautological string names.

## API Decisions

- Keep the resource API surface unchanged for this plan:
  - `api.useChat(...)`
  - `api.useResource(...)`
  - `api.nav.*(...)`
  - `api.screen()`
- Rename only the UI component creation surface:
  - Current: `ui.useComposer(...)`
  - Target: `ui.createComposer(...)`
- Keep non-component UI utilities as verbs/accessors:
  - `ui.usePreset()`
  - `ui.setPreset(...)`
  - `ui.useTheme()`
  - `ui.setThemeParam(...)`
- Component instance variables should be capitalized by user convention because they expose JSX slot components:
  - `const Composer = ui.createComposer(...)`
  - `<Composer.Root />`
- Do not pass string instance names by default.
- Do not pass component instance keys into the factory by default.
- Use normal JSX `key` on the owning component/list item when a repeated component needs stable identity.
- Allow an explicit factory `key` only as an advanced escape hatch if implementation proves it is required, not as the primary API.

## Spec Shape

The existing `App["UI"]["Components"]` shape should continue to drive type safety:

```ts
type App = {
  UI: {
    Components: {
      Composer: {
        State: {
          value: string;
        };
        Derived: {
          canSubmit: boolean;
        };
        Actions: {
          input: [value: string];
          submit: [];
          clear: [];
        };
        Slots: {
          Root: "form";
          Input: "textarea";
          Send: "button";
        };
        Bindings: {
          Root: {
            onSubmit: "submit";
          };
          Input: {
            value: "value";
            onInput: "input";
          };
          Send: {
            onClick: "submit";
            disabled: "canSubmit";
          };
        };
      };
    };
  };
};
```

`Bindings` can be introduced incrementally. The first implementation may support convention-based defaults for common slot names, then add explicit typed bindings.

## Runtime Semantics

Each `ui.createX(...)` returns a component instance with:

- `state`: a tracked object with normal property reads and writes.
- `derived`: computed values, exposed directly on the instance when ergonomic.
- `actions`: generated callable actions.
- `Slot` components for every declared slot.
- typed native element props for each slot.
- style metadata for preset lookup.

Example target instance:

```ts
const Composer = ui.createComposer(...);

Composer.state.value;      // string
Composer.actions.submit(); // void
Composer.canSubmit;        // boolean or reactive readable
Composer.Root;             // JSX component for form
Composer.Input;            // JSX component for textarea
Composer.Send;             // JSX component for button
```

Internally, state may still use Alien Signals. User code should not need `state.value()` or signal wrappers for component-local state.

## Action Semantics

Actions receive scoped state through an action factory, not through the component variable:

```ts
actions({ state, derived, api }) {
  return {
    submit() {
      const text = state.value.trim();
      state.value = "";
    },
  };
}
```

This follows the useful ideas from Zustand and XState Store:

- state and actions live together;
- actions are scoped to the store/component instance;
- actions receive current state through a stable API;
- user code does not reach outward to mutate the owning instance.

## Binding Semantics

Common DOM binding should be automatic:

- `Input.value -> state.value`
- `Input.onInput -> actions.input(value)`
- `Root.onSubmit -> actions.submit()`
- `Send.onClick -> actions.submit()`
- `Send.disabled -> !derived.canSubmit` or explicit binding, depending on final binding spec.

Manual props remain possible:

```tsx
<Composer.Input placeholder="Message..." />
<Composer.Send aria-label="Send message">Send</Composer.Send>
```

Manual handlers should compose with generated handlers instead of replacing them unless the prop uses an explicit override form.

## Implementation Checklist

- [x] Add type-level `CreateName<Name>` mapping from `Composer` to `createComposer`.
- [x] Keep `useX` temporarily as compatibility while apps migrate.
- [x] Add `ComponentInstanceInput` with `state`, `derived`, `actions`, and `slots`.
- [x] Add `ComponentInstanceResult` with `state`, `actions`, derived accessors, and PascalCase slot components.
- [x] Implement tracked object state on top of existing signal storage.
- [x] Implement action factory context so actions receive scoped `{ state, refs, preset, theme }`.
- [x] Implement slot component generation that returns JSX components instead of spreadable binding objects.
- [x] Preserve style data attributes and preset resolution for generated slot components.
- [x] Add convention-based automatic bindings for input value, submit, and submit-button basics.
- [ ] Follow-up: add explicit `Bindings` type support in `App["UI"]["Components"]`.
- [x] Update generated `@poggers/app` types to expose `ui.createX`.
- [x] Update fallback `@poggers/app` declarations to expose `createX` safely before typegen.
- [x] Update chat app from `ui.useComposer` and spread slots to `ui.createComposer` and JSX slots.
- [x] Retain style-only usages such as layout/message parts as `ui.useX`.
- [x] Confirm site app has no stateful component migration.
- [x] Confirm starter template currently emits only style selectors.
- [x] Update current architecture docs for `ui.createX`.

## Compatibility Gates

- [x] `ui.useX` continues to work for compatibility and style-only selectors.
- [x] Typegen emits precise `ui.createX` types.
- [ ] Cold editor fallback does not report `Cannot find module '@poggers/app'`.
- [x] Existing style presets apply to generated slot components.
- [ ] Hot reload preserves component-local state after unrelated edits.
- [ ] Follow-up: JSX `key` on repeated parent components controls repeated state identity.
- [x] No required string instance name is exposed in the happy path.

## End-To-End Verification

- [ ] `rm -rf apps/chat/.app apps/site/.app`
- [ ] cold `bunx tsc -p apps/chat/tsconfig.json --noEmit` reaches fallback behavior without missing-module errors.
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run fmt:check`
- [ ] `bun test`
- [ ] `bun run --filter @poggers/chat build`
- [ ] `bun run --filter @poggers/site build`
- [ ] generated starter smoke:
  - [ ] create temp app with `bun packages/create-poggers/src/index.js`
  - [ ] run `bun run typecheck` inside the generated app
- [ ] browser smoke with the in-app browser:
  - [ ] run `bun run --filter @poggers/chat dev`
  - [ ] open `http://localhost:3000`
  - [ ] type into the composer
  - [ ] save/edit a component and verify local text state survives expected hot refresh behavior
  - [ ] send a message and verify the command path still works
  - [ ] toggle presets and verify generated slot components receive styles

## Non-Goals For This Pass

- Do not rename the resource API.
- Do not replace `api.useChat` or worker APIs.
- Do not introduce `defineApp.components`.
- Do not require string names for component instances.
- Do not make keys part of normal component state creation.
- Do not remove `usePreset` / `useTheme` in this pass.
- Do not implement compiler-emitted slot metadata or explicit `Bindings` yet.
- Do not rework native JSX ownership/keyed state identity yet.
