# Spec-First Style Compiler Plan

## Purpose

Create a Poggers-native styling system that is not a thin typed layer over CSS.

The target is a compiler-backed system where:

- One generic `App` spec drives data hooks, navigation hooks, UI style hooks, presets, theme params, and type safety.
- Application code does not contain styling.
- Components describe semantic structure and bind typed style slots.
- Presets define the complete visual language and can be switched at runtime.
- Styling is authored in TypeScript object syntax and compiled to CSS plus a tiny runtime only where needed.
- CSS classes, generated selectors, container queries, CSS variables, and motion internals are compiler output, not the user-facing API.

This is a long-term replacement for Tailwind as the primary styling model. Tailwind can remain as a bridge until the Poggers style compiler is strong enough.

## Non-Goals

- Do not create a new CSS-like file format.
- Do not introduce runtime CSS-in-JS as the primary styling mechanism.
- Do not require checked-in generated hook files.
- Do not put concrete preset implementation inside `app.tsx`.
- Do not make `class`, `className`, `style`, or `css` the conceptual app styling API.
- Do not add separate value-level contract builders when the generic `App` spec can describe the surface.

## Target App Structure

Every app should stay simple:

```text
types.ts
app.tsx
styles.ts
components/
helpers/
```

Optional subfolders:

```text
components/
  primitives/
  layout/
  screens/
  domain/
helpers/
  deps/
  ids/
  parsers/
```

`hooks.ts` should not be required in normal apps. The compiler should provide typed virtual modules instead.

## File Responsibilities

### `types.ts`

Owns the single source of truth:

- Resources.
- Navigation.
- Environments and dependency types.
- UI style selectors.
- UI slots.
- UI variants.
- UI state.
- Preset names.
- Theme parameter names and ranges.

It should not contain concrete style implementation.

### `app.tsx`

Owns app composition:

- `defineApp<App>(...)`.
- Resources.
- Programs.
- Root UI.

It must not contain styling primitives, raw classes, inline style objects, preset definitions, or imports from the style package.

### `styles.ts`

Owns the visual system:

- `defineStyles<App>(...)`.
- Presets.
- Theme parameter defaults/ranges.
- Semantic style recipes for each UI selector and slot.
- Motion definitions.

It can be hot-reloaded independently from app data/resource logic.

### `components/`

Owns semantic structure:

- Components import `api` and `ui` from compiler virtual modules.
- Components call data hooks when they own a data workflow.
- Design-system primitives call style hooks like `ui.useButton`.
- Components bind style slots with spread props.
- Components do not define concrete visual rules.

## Generic App Spec

The app spec should drive the full surface:

```ts
export type App = {
  Resources: {
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Events: ChatEvents;
      Views: ChatViews;
      Commands: ChatCommands;
    };
  };

  Navigation: {
    home: {};
    chat: { sessionId: string };
  };

  UI: {
    Presets: "system" | "soft" | "dense";

    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.45 };
        roundness: { min: 0; max: 1; default: 0.6 };
        contrast: { min: 0; max: 1; default: 0.7 };
        motion: { min: 0; max: 1; default: 0.5 };
        hue: { min: 0; max: 360; default: 220 };
      };
    };

    Styles: {
      Button: {
        Variants: {
          tone: "neutral" | "primary" | "danger";
          size: "sm" | "md" | "lg";
          emphasis: "ghost" | "soft" | "solid";
        };
        State: {
          disabled: boolean;
          loading: boolean;
          pressed: boolean;
        };
        Slots: {
          root: "button";
          icon: "span";
          label: "span";
        };
      };

      Panel: {
        Variants: {
          tone: "neutral" | "raised" | "inset";
          density: "compact" | "comfortable";
        };
        State: {};
        Slots: {
          root: "section";
          header: "header";
          body: "div";
        };
      };
    };
  };
};
```

The exact naming can still be tuned, but the important rule is that `App["UI"]` is the contract. Presets implement it. Components consume it.

## Authoring API

### Components

Components should use semantic hook namespaces:

```tsx
import { ui } from "@poggers/app";
import type { Child } from "@poggers/kit/ui";

export function Button(props: {
  tone?: "neutral" | "primary" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  children?: Child;
}) {
  const button = ui.useButton({
    variants: {
      tone: props.tone ?? "neutral",
      size: props.size ?? "md",
      emphasis: "solid",
    },
    state: {
      disabled: props.disabled ?? false,
      loading: false,
      pressed: false,
    },
  });

  return (
    <button {...button.root} disabled={props.disabled}>
      <span {...button.label}>{props.children}</span>
    </button>
  );
}
```

The spread binding is deliberate. `button.root` is a typed slot binding, not a class name. Internally it can contain class, data attributes, CSS variables, refs, motion handlers, or other runtime wiring.

### Screens

Screens use data hooks and semantic components:

```tsx
import { api } from "@poggers/app";
import { Button } from "../primitives/Button";

export function ChatScreen() {
  const chat = api.useChat({ sessionId: "main" });

  return (
    <Button tone="primary" disabled={chat.status() !== "idle"}>
      Send
    </Button>
  );
}
```

### App

`app.tsx` remains styling-free:

```tsx
import { defineApp } from "@poggers/kit";
import { Root } from "./components/Root";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,
  resources: {},
  ui(ctx) {
    return <Root ctx={ctx} />;
  },
});
```

### Styles

`styles.ts` defines presets:

```ts
import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  defaultPreset: "system",

  presets: {
    system: {
      Button: {
        root(ctx) {
          return {
            layout: ctx.layout.inlineCenter(),
            surface: ctx.surface.action({
              tone: ctx.variants.tone,
              emphasis: ctx.variants.emphasis,
              state: ctx.state,
            }),
            size: ctx.controlSize(ctx.variants.size),
            motion: ctx.motion.pressable(),
          };
        },
        label(ctx) {
          return {
            typography: ctx.typography.control(ctx.variants.size),
          };
        },
      },
    },

    dense: {
      Button: {
        root(ctx) {
          return {
            layout: ctx.layout.inlineCenter(),
            surface: ctx.surface.action({
              tone: ctx.variants.tone,
              emphasis: ctx.variants.emphasis,
              state: ctx.state,
            }),
            size: ctx.controlSize("sm"),
            motion: ctx.motion.pressable(),
          };
        },
      },
    },
  },
});
```

The style object returned from a slot should be higher-level than raw CSS. It should use semantic concepts like layout, surface, size, typography, shape, elevation, and motion. The compiler lowers those concepts to CSS.

## Virtual Modules

The Bun plugin should expose:

```ts
import { api, ui } from "@poggers/app";
```

Optional focused imports:

```ts
import { api } from "@poggers/app/api";
import { ui } from "@poggers/app/ui";
```

The generated API should include:

```ts
api.useChat(...)
api.useTask(...)
api.useScreen()
api.nav.chat(...)
```

The generated UI API should include:

```ts
ui.useButton(...)
ui.usePanel(...)
ui.usePreset()
ui.setPreset("dense")
ui.useTheme()
ui.setThemeParam("density", 0.6)
```

All names and argument types must derive from `App`.

## Runtime Preset Switching

All presets compile ahead of time.

Switching preset should be runtime-cheap:

```ts
ui.setPreset("dense");
```

Under the hood, the runtime can update a root-scoped attribute:

```html
<div data-poggers-app data-poggers-preset="dense"></div>
```

or:

```html
<html data-poggers-preset="dense"></html>
```

Theme params should be reactive and lower to CSS variables:

```ts
ui.setThemeParam("roundness", 0.75);
```

The current preset and theme params must survive style hot reload when possible.

## Compiler Architecture

### Plugin Responsibilities

The Bun plugin should:

- Locate the app root.
- Resolve `app.tsx`.
- Resolve the generic type passed to `defineApp<App>()`.
- Resolve `types.ts` and `App["UI"]`.
- Resolve `styles.ts`.
- Typecheck `defineStyles<App>(...)` against the UI spec.
- Compile style presets to CSS.
- Compile variant/state combinations to stable binding metadata.
- Generate virtual modules for `@poggers/app`, `@poggers/app/api`, and `@poggers/app/ui`.
- Inject generated CSS into dev and production builds.
- Support hot replacement of style registry and CSS.
- Trigger full reload when the UI spec shape changes.

### Dev Mode

Hot reload rules:

- Editing components should hot reload components.
- Editing `styles.ts` should hot-swap CSS, preset metadata, and motion metadata.
- Editing theme defaults should hot-swap where possible.
- Editing `types.ts` UI shape can trigger typecheck plus full reload.
- Editing resources/schema can trigger server restart or full reload.

Hooks must stay stable. They should resolve through a replaceable registry rather than close over a frozen preset object.

### Production Mode

Production build should:

- Compile all presets.
- Minify CSS.
- Tree-shake unused style helpers.
- Emit no checked-in generated files.
- Keep only the tiny runtime needed for current preset/theme switching and motion.

## Style Runtime

The style runtime should provide:

- A style registry.
- Current preset signal.
- Theme param signals.
- Slot binding resolver.
- CSS injection or stylesheet replacement in dev.
- Motion runtime only when a compiled style uses motion that CSS cannot handle alone.

Initial runtime can be simple. The authoring API should leave room for compiler optimization later.

## Type System

Required derived types:

- `ResourceHooks<App>` from `App["Resources"]`.
- `NavigationHooks<App>` from `App["Navigation"]`.
- `StyleHooks<App>` from `App["UI"]["Styles"]`.
- `PresetName<App>` from `App["UI"]["Presets"]`.
- `ThemeParamName<App>` from `App["UI"]["Theme"]["Params"]`.
- `StyleSlotBinding<App, Component, Slot>` from slot element type.

Style hook example:

```ts
ui.useButton({
  variants: {
    tone: "primary",
    size: "md",
    emphasis: "solid",
  },
  state: {
    disabled: false,
    loading: false,
    pressed: false,
  },
});
```

Type errors must catch:

- Unknown style selectors.
- Unknown slots.
- Unknown variants.
- Invalid variant values.
- Missing required state fields when strict mode is enabled.
- Invalid preset names.
- Invalid theme param names.
- Theme param values outside static range when literal values are used.
- Slot bindings spread onto the wrong element where feasible.

## Lint Rules

Add Poggers-specific linting or static checks:

- `app.tsx` cannot use `class`, `className`, `style`, `css`, style hooks, or imports from `@poggers/kit/style`.
- `app.tsx` should not use raw DOM tags except fragments and root components.
- `styles.ts` cannot import app runtime/data helpers.
- Components cannot define concrete style rules.
- Screens should not call style hooks unless explicitly allowed.
- Design-system primitive folders can call `ui.useX`.
- No Tailwind utility classes in new strict apps once the style compiler is enabled.

## Migration Strategy

### Phase 1: Type Surface

- [ ] Extend `AppSpec` with optional `UI`.
- [ ] Add derived style selector, variant, state, slot, preset, and theme types.
- [ ] Add compile-time tests for style hook names.
- [ ] Add compile-time tests for preset and theme hooks.
- [ ] Preserve existing JSX typing.

### Phase 2: Runtime Prototype

- [ ] Add `@poggers/kit/style` exports.
- [ ] Implement `defineStyles<App>(...)`.
- [ ] Implement `createHooks<App>()` as an internal/fallback API.
- [ ] Return `{ api, ui }` namespaces.
- [ ] Implement preset signal and theme param signal.
- [ ] Implement slot binding resolver returning spreadable props.
- [ ] Compile minimal style output without a plugin first, if needed for tests.

### Phase 3: Virtual Modules

- [ ] Add Bun plugin integration.
- [ ] Implement virtual `@poggers/app`.
- [ ] Implement virtual `@poggers/app/api`.
- [ ] Implement virtual `@poggers/app/ui`.
- [ ] Wire virtual hooks into the app browser entry.
- [ ] Keep non-plugin fallback for tests.

### Phase 4: Style Compiler

- [ ] Parse/extract `styles.ts`.
- [ ] Compile presets to CSS.
- [ ] Generate stable class/data bindings.
- [ ] Generate CSS variables for theme params.
- [ ] Generate root preset scoping.
- [ ] Support container-aware semantic layout primitives.
- [ ] Support state and variant selectors.

### Phase 5: Hot Reload

- [ ] Hot-swap generated CSS in dev.
- [ ] Replace style registry without remounting app.
- [ ] Preserve current preset across style updates.
- [ ] Preserve theme params across style updates.
- [ ] Full reload on UI spec shape changes.

### Phase 6: Motion

- [ ] Define motion primitives in style objects.
- [ ] Compile simple enter/exit/keyframe motion to CSS.
- [ ] Add tiny runtime for spring and interruptible motion.
- [ ] Support reduced-motion behavior.
- [ ] Verify route transitions and pressable controls.

### Phase 7: Lint And Enforcement

- [ ] Add app styling ban checks for `app.tsx`.
- [ ] Add import boundary checks.
- [ ] Add style hook usage boundary checks.
- [ ] Add no-Tailwind-in-strict-mode check.
- [ ] Add docs for allowed exceptions.

### Phase 8: Initializer And Dogfood

- [ ] Update `create-poggers` to generate `styles.ts`.
- [ ] Remove Tailwind as the primary starter styling path once ready.
- [ ] Generate components that use `ui.useButton` and similar hooks.
- [ ] Migrate `apps/site`.
- [ ] Migrate `apps/chat`.
- [ ] Keep Tailwind compatibility documented as legacy/bridge.

## Verification Gates

### Static Gates

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run fmt:check`
- [ ] `git diff --check`
- [ ] `bun test`

### Type Gates

- [ ] `api.useResourceName` derives from resources.
- [ ] `ui.useStyleName` derives from `App["UI"]["Styles"]`.
- [ ] `ui.setPreset` accepts only `App["UI"]["Presets"]`.
- [ ] `ui.setThemeParam` accepts only valid theme params.
- [ ] Style hook variants reject invalid values.
- [ ] Style hook state rejects invalid fields.
- [ ] Slot bindings are typed by slot element.
- [ ] Components cannot accidentally pass unknown DOM props under stricter JSX typing.

### Compiler Gates

- [ ] Virtual `@poggers/app` resolves in dev.
- [ ] Virtual `@poggers/app` resolves in production build.
- [ ] Generated CSS contains all presets.
- [ ] Generated CSS scopes rules by current preset.
- [ ] Theme params lower to CSS variables.
- [ ] No generated files are checked into the app.
- [ ] Production binary includes compiled styles.

### Runtime Gates

- [ ] App renders using `api` and `ui` virtual hooks.
- [ ] Data resource hook still syncs with the server.
- [ ] Style hook returns spreadable slot bindings.
- [ ] Preset switch updates visible UI without remounting.
- [ ] Theme param update changes visible UI without remounting.
- [ ] Style registry hot-swap keeps current preset.
- [ ] Unknown preset is rejected at compile time and guarded at runtime.

### Lint Gates

- [ ] `app.tsx` with `class` fails.
- [ ] `app.tsx` with `style` fails.
- [ ] `app.tsx` importing `@poggers/kit/style` fails.
- [ ] `styles.ts` importing data helpers fails.
- [ ] Screen calling `ui.useButton` fails or warns according to configured boundary.

### Generated App Gates

- [ ] `create-poggers` generates `types.ts`, `app.tsx`, `styles.ts`, `components/`, `helpers/`.
- [ ] Generated app has no `hooks.ts`.
- [ ] Generated app imports `api` and `ui` from `@poggers/app`.
- [ ] Generated app typechecks.
- [ ] Generated app builds a single binary.
- [ ] Generated app runs locally.
- [ ] Browser verifies preset switch.
- [ ] Browser verifies theme param change.
- [ ] Browser verifies data command update.

### Dogfood Gates

- [ ] `apps/site` uses the style compiler.
- [ ] `apps/site` can switch presets in browser.
- [ ] `apps/chat` uses the style compiler.
- [ ] `apps/chat` can send a fake-AI message.
- [ ] Both apps build binaries.

### Browser Gates

- [ ] Open generated app root.
- [ ] Verify semantic component styles render.
- [ ] Switch preset and verify visible change.
- [ ] Change theme param and verify visible change.
- [ ] Trigger a command and verify data update.
- [ ] Verify route navigation still works.
- [ ] Verify hot style update in dev.
- [ ] Capture desktop screenshot.
- [ ] Capture mobile viewport screenshot.
- [ ] Verify no visible overlap at mobile and desktop sizes.

## Open Design Questions

- Final names for `Styles`, `Variants`, `State`, and `Slots`.
- Whether state fields should be required or optional by default.
- Whether screen components may call `ui.*` hooks, or only primitives/layout components.
- Whether `api.nav` belongs under `api` or a separate `router` key.
- Whether theme param ranges should be encoded as `{ min; max; default }` or a more compact type.
- How much of the semantic style object should be compiler-only versus runtime-interpretable in the first implementation.
- How strict slot-to-element binding should be in TypeScript before compiler support.
