# Automatic Component Parts Plan

## Goal

Remove tautological component controllers from the Poggers app API.

The framework already knows each component and part from the generic app spec:

```ts
type App = {
  Components: {
    Composer: {
      State: { value: string };
      Derived: { canSubmit: boolean };
      Actions: { submit(): void; change(value: string): void };
      Parts: {
        Root: "form";
        Input: "textarea";
        Send: "button";
      };
    };
  };
};
```

That spec must be enough to generate `createComposer()` and every JSX part. App authors should not repeat:

```ts
Root() {
  return part.Root.attrs;
}
```

Generated metadata, refs, classes, and style hooks are framework internals.

## Final API

### Components Without Behavior

If a component only needs generated parts and styles, it is declared in `App["Components"]` and styled in `styles.ts`. It does not appear in `defineApp.components`.

```tsx
const Layout = createChatLayout();

return (
  <Layout.Root>
    <Layout.Topbar />
    <Layout.Messages />
  </Layout.Root>
);
```

### Components With Behavior

`defineApp.components` is an optional override table. A controller returns only DOM props for the parts it customizes.

```tsx
components: {
  Composer({ state, derived, actions }) {
    return {
      Root: {
        onSubmit(event) {
          event.preventDefault();
          actions.submit();
        },
      },
      Input: {
        value: state.value,
        disabled: derived.busy,
        onInput(event) {
          actions.change(event.currentTarget.value);
        },
      },
      Send: {
        type: "submit",
        disabled: !derived.canSubmit,
      },
    };
  },
}
```

Rules:

- `defineApp.components` is optional.
- Each component controller is optional.
- Each returned part override is optional.
- Controller returns plain objects, not part functions.
- Generated base props are merged automatically before controller props.
- JSX props are merged last.
- Event handlers compose in base -> controller -> JSX order.
- App code never spreads `part.X.attrs`.

## Implementation Checklist

### 1. Type Surface

- [x] Make `ComponentControllers<Spec>` partial by component name.
- [x] Make `ComponentControllerResult` partial by part name.
- [x] Change controller part values from functions to plain DOM prop objects.
- [x] Remove public `part`/`attrs` plumbing from `ComponentControllerContext`.
- [x] Remove `ComponentPartContext` from public exports.
- [x] Keep DOM prop type safety per part element.
- [x] Ensure no-op components do not need controllers.

### 2. Runtime

- [x] Always generate part components from `App["Components"][X]["Parts"]`.
- [x] Treat missing component controller as `{}`.
- [x] Treat missing part override as `{}`.
- [x] Merge generated base props, controller props, and JSX props.
- [x] Re-read controller props reactively for state/derived-driven DOM values.
- [x] Preserve generated metadata:
  - [x] `data-pg-component`
  - [x] `data-pg-part`
  - [x] `data-pg-preset`
  - [x] generated class name
  - [x] ref collection
  - [x] state/derived data attributes.
- [x] Preserve hot-refresh state behavior.

### 3. App Migration

- [x] Remove tautological `ChatLayout`, `ChatMessage`, and `AIPart` controllers.
- [x] Rewrite `Composer` controller to return only `Root`, `Input`, and `Send` overrides.
- [x] Remove all site controllers because they are style-only.
- [x] Remove tautological starter controllers.
- [x] Keep starter `Button` controller only for behavior.

### 4. Tests

- [x] Update runtime tests to assert generated parts work without controllers.
- [x] Update typecheck tests to assert controllers are optional and override-only.
- [x] Add/keep assertions that invalid part names fail typecheck.
- [x] Add/keep assertions that part DOM props remain element-specific.
- [x] Verify state/derived controller props update reactively.

### 5. Docs

- [x] Update architecture docs to show override-only controllers.
- [x] Update single-surface plan notes so the canonical API does not mention `part.X.attrs`.
- [x] Document that style-only components are declared in `App["Components"]`, not `defineApp.components`.

## End-To-End Verification Gates

### Static Gates

- [x] `bun run fmt:check`
- [x] `bun run lint`
- [x] `bun run typecheck`
- [x] `bun test`
- [x] `bun test packages/kit/src/infra/style.spec.ts`
- [x] `bun test packages/kit/src/infra/runtime-style.spec.ts`

### Build Gates

- [x] `bun run --filter @poggers/chat build`
- [x] `bun run --filter @poggers/site build`
- [x] Create a fresh app with `packages/create-poggers`.
- [x] Run `bun install` in the fresh app.
- [x] Run `bun run typecheck` in the fresh app.
- [x] Run `bun run build` in the fresh app.
- [x] Start the compiled chat binary and verify `/` returns the PWA shell.

### Browser Gates

- [x] Start `POGGERS_FAKE_AI=... bun run --filter @poggers/chat dev`.
- [x] Open `http://localhost:3000` in browser automation.
- [x] Verify no page errors or console errors.
- [x] Verify style-only generated components render without controllers.
- [x] Type into the composer and verify `Send` enables from derived state.
- [x] Touch an unrelated TSX component and verify hot refresh preserves composer text.
- [x] Send a message and verify fake worker response renders.
- [x] Toggle presets and verify `data-pg-preset` changes.
- [x] Inspect DOM and verify generated parts still carry `data-pg-component` and `data-pg-part`.

## Done Means

- App authors do not write no-op component controllers.
- `defineApp.components` contains behavior only.
- `part.X.attrs` is no longer part of the canonical authoring model.
- The demos, starter, tests, and docs all show one API surface.
