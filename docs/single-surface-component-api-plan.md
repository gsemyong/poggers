# Single Surface Component API Plan

## Goal

Replace the current mixed UI surface with one coherent application API:

- resource data is accessed with generated `useX` functions;
- renderable UI contracts are created with generated `createX` functions;
- component DOM wiring is implemented once in `defineApp<App>()`;
- visual presets style component parts directly;
- no `api.*` namespace, no `ui.*` namespace, no `ui.useX`, no style-only selectors, no heuristic DOM inference, and no backwards compatibility path.

The design is inspired by Zag's boundary, not Zag's public surface: component logic has a controller/connector layer, but userland UI renders generated JSX parts instead of spreading `getPartProps()` results.

## Final API

### `src/types.ts`

`App` is the single type-level source of truth. The generic type parameter drives every generated API.

```ts
export type App = {
  Resources: {
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Presence: ChatPresence;
      Events: ChatEvents;
      Views: ChatViews;
      Commands: ChatCommands;
    };
  };

  Environments: {
    server: {
      Deps: ChatProgramDeps;
    };
  };

  Components: {
    ChatLayout: {
      Parts: {
        Root: "div";
        Topbar: "header";
        Brand: "div";
        Messages: "main";
        Composer: "div";
      };
    };

    Composer: {
      State: {
        value: string;
      };
      Derived: {
        canSubmit: boolean;
        busy: boolean;
      };
      Actions: {
        change(value: string): void;
        submit(): void;
        clear(): void;
      };
      Parts: {
        Root: "form";
        Input: "textarea";
        Send: "button";
      };
    };

    ChatMessage: {
      Input: {
        role: "user" | "assistant";
        streaming: boolean;
      };
      Parts: {
        Root: "article";
        Role: "div";
        Content: "div";
      };
    };
  };

  Styles: {
    Presets: "paper" | "terminal";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
      };
    };
  };
};
```

Rules:

- `Components` is top-level. There is no `UI.Components`.
- `Styles` is top-level app styling metadata. There is no `UI.Styles`.
- `Parts` are PascalCase because they become JSX components.
- `Actions` are TypeScript function signatures, not tuple-only declarations.
- `Input` is immutable per-instance input from the render site.
- `State` is mutable component-local state.
- `Derived` is computed from `input`, `state`, generated resource hooks, and other local context.

### `src/app.tsx`

`defineApp<App>()` owns runtime implementation. Component implementation connects generated semantic state/actions/parts to real DOM props and events.

```tsx
import { defineApp } from "@poggers/kit";
import { Root } from "./components/Root";
import type { App } from "./types";

export default defineApp<App>({
  version: 1,

  app: {
    name: "Poggers Chat",
  },

  resources: {
    chat: {
      // event-sourced resource implementation
    },
  },

  programs: {
    async server({ events }, deps) {
      // background program implementation
    },
  },

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
  },

  ui: Root,
});
```

Rules:

- DOM event details live here, not in normal application UI.
- Style-only components do not appear in `defineApp.components`; their parts are generated from the app spec automatically.
- There are no wrapper helpers such as `button()`, `textarea()`, `command()`, or `event()`.
- Component controller return values are plain typed DOM props for declared parts.
- The framework always adds stable `data-pg-component`, `data-pg-part`, preset, class, ref, and style-state metadata.
- User-provided JSX props compose with generated controller props by default.

### `src/styles.ts`

Visual presets target component parts directly.

```ts
import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  defaultPreset: "paper",
  presets: {
    paper: {
      Composer: {
        Root: { display: "grid", gap: 8 },
        Input: ({ derived }) => ({
          opacity: derived.busy ? 0.7 : 1,
        }),
        Send: ({ derived }) => ({
          cursor: derived.canSubmit ? "pointer" : "default",
        }),
      },
    },
  },
});
```

Rules:

- Styles use component names and `Parts`.
- There is no separate style selector contract.
- Style functions can read typed `input`, `state`, `derived`, `theme`, and `preset`.
- Runtime preset switching remains `setPreset(next)`.

### `src/components/*.tsx`

Application UI imports generated functions directly from `@poggers/app`.

```tsx
import { createChatLayout, createComposer, setPreset, useChat, usePreset } from "@poggers/app";

export function Root() {
  const chat = useChat({ sessionId: "default" });
  const Layout = createChatLayout();
  const Composer = createComposer({
    state: {
      value: "",
    },

    derived({ state }) {
      return {
        get busy() {
          return chat.status() === "generating";
        },

        get canSubmit() {
          return state.value.trim().length > 0 && !this.busy;
        },
      };
    },

    actions({ state }) {
      return {
        change(value) {
          state.value = value;
        },

        submit() {
          const text = state.value.trim();
          if (!text) return;
          void chat.sendMessage(text);
          state.value = "";
        },

        clear() {
          state.value = "";
        },
      };
    },
  });

  return (
    <Layout.Root>
      <Layout.Messages />
      <Layout.Composer>
        <Composer.Root>
          <Composer.Input placeholder="Message..." />
          <Composer.Send>Send</Composer.Send>
        </Composer.Root>
      </Layout.Composer>
    </Layout.Root>
  );
}
```

Rules:

- `createX(...)` is the only way to render semantic UI contracts.
- `useX(...)` is only for resources.
- `createX(...)` receives instance-specific values only: `input`, `state`, `derived`, and `actions`.
- DOM mapping never appears in `createX(...)`.
- UI code may pass normal typed DOM props to generated part components.
- JSX `key` is the state identity mechanism for repeated component instances.

### Generated `@poggers/app`

The generated module is the single app import surface.

```ts
export { Root } from "@poggers/app";

export function useChat(key: App["Resources"]["chat"]["Key"]): ChatResource;

export function createChatLayout(input?: CreateChatLayoutInput): ChatLayoutInstance;
export function createComposer(input: CreateComposerInput): ComposerInstance;
export function createChatMessage(input: CreateChatMessageInput): ChatMessageInstance;

export function usePreset(): App["Styles"]["Presets"];
export function setPreset(preset: App["Styles"]["Presets"]): void;
export function useTheme(): ThemeValues<App>;
export function setThemeParam<Param extends ThemeParamName<App>>(
  param: Param,
  value: ThemeParamValue<App, Param>,
): void;

export function useScreen(): AppScreen<App>;
export const nav: AppNavigation<App>;
export function start(): void;
```

Removed generated/public surfaces:

- `api`
- `ui`
- `ui.useX`
- `useResource` in app UI as a normal public API
- `Style`/`Styles` pseudo-components
- convention-based automatic DOM binding
- heuristic element inference from slot names

## Implementation Plan

### 1. Type Model

- [x] Move the app spec shape from nested `UI` to top-level `Components` and `Styles`.
- [x] Rename component `Slots` to `Parts`.
- [x] Make part names PascalCase end-to-end.
- [x] Add `Input` support for component instances.
- [x] Change `Actions` extraction to accept function signatures as the canonical API.
- [x] Keep tuple extraction only as internal migration scaffolding while editing, then remove it.
- [x] Define component controller types:
  - [x] `ComponentControllerContext`
  - [x] `ComponentControllerResult`
  - [x] `ComponentInstanceInput`
  - [x] `ComponentInstanceResult`
- [x] Define style preset context over component `Input`, `State`, `Derived`, `Parts`, theme, and preset.

### 2. `defineApp` Runtime Contract

- [x] Extend `defineApp<App>()` to accept a `components` object.
- [x] Store component controllers on the app definition.
- [x] Allow declared components to omit controllers when they only need generated parts.
- [x] Allow controllers to return only the parts they customize.
- [x] Ensure controller part props are typed against their declared intrinsic element.
- [x] Ensure controller functions can read plain `state.value` and `derived.canSubmit`.
- [x] Ensure controller functions call semantic actions without event payload leakage unless the controller itself chooses to read the DOM event.

### 3. Component Instance Runtime

- [x] Replace `ui.createX` with direct generated `createX`.
- [x] Remove `ui.useX` and `createStyleBinding`.
- [x] Remove convention-based `createAutomaticSlotBindings`.
- [x] Remove heuristic `elementNameForSlot`.
- [x] Build component instances from generated component metadata:
  - [x] part names;
  - [x] part element names;
  - [x] optional controller function;
  - [x] style class/data metadata.
- [x] Read optional controller props at render time with current state/derived/action handles.
- [x] Merge framework metadata, controller props, and user JSX props in a deterministic order.
- [x] Compose event handlers unless a future explicit override policy is added.
- [x] Preserve ref collection for each part.
- [x] Preserve hot-refresh state with existing render ownership and JSX `key` semantics.

### 4. Generated Module

- [x] Generate direct named resource hooks:
  - [x] `useChat`
  - [x] one `useX` per resource.
- [x] Generate direct named component factories:
  - [x] `createComposer`
  - [x] one `createX` per component.
- [x] Generate direct style/theme exports:
  - [x] `usePreset`
  - [x] `setPreset`
  - [x] `useTheme`
  - [x] `setThemeParam`
- [x] Generate `Root`, `nav`, `useScreen`, and `start`.
- [x] Remove generated `api.ts` and `ui.ts` as public surfaces.
- [x] Keep any internal helper module private and not importable from app code.
- [x] Update fallback `@poggers/app` declarations so cold editors do not show missing-module errors.

### 5. Styles Compiler

- [x] Update `defineStyles<App>()` to consume top-level `Components` and `Styles`.
- [x] Compile selectors from component parts only.
- [x] Emit `data-pg-component` and `data-pg-part`.
- [x] Remove support for `data-pg-style` as a separate selector namespace.
- [x] Allow style callbacks to read typed `input`, `state`, `derived`, `theme`, and `preset`.
- [x] Migrate chat presets to `ChatLayout`, `Composer`, `ChatMessage`, and `AIPart` components.
- [x] Migrate site presets to top-level components.

### 6. Demo App Migration

- [x] Update `apps/chat/src/types.ts` to top-level `Components` and `Styles`.
- [x] Move `ChatLayout`, `ChatMessage`, and `AIPart` out of `UI.Styles` into `Components`.
- [x] Expand `Composer` parts to include `Root`, `Input`, and `Send`.
- [x] Keep only behaviorful chat component controllers in `apps/chat/src/app.tsx`.
- [x] Replace `import { api, ui } from "@poggers/app"` with direct named imports.
- [x] Replace `ui.useChatLayout` with `createChatLayout`.
- [x] Replace message style hooks with `createChatMessage` and `createAIPart`.
- [x] Replace preset calls with direct `usePreset` and `setPreset`.
- [x] Update `apps/site` to the same structure.
- [x] Update `packages/create-poggers` template to emit the final API only.

### 7. Docs And Conventions

- [x] Update architecture docs to document the final API as the only API.
- [x] Update app conventions to forbid:
  - [x] importing `api` or `ui` from `@poggers/app`;
  - [x] `ui.use*`;
  - [x] `UI.Styles`;
  - [x] lowercase component part names;
  - [x] styling in app UI files outside generated component parts.
- [x] Add examples for:
  - [x] stateful component;
  - [x] stateless layout component;
  - [x] component with `Input`;
  - [x] preset switching;
  - [x] typed DOM controller event handling.

## End-To-End Verification Gates

### Static Gates

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run fmt:check`
- [x] `bun test`
- [x] `bun test packages/kit/tests/style.spec.ts`
- [x] `bun test packages/kit/tests/app-surface.spec.ts`

### Build Gates

- [x] `bun run --filter @poggers/chat build`
- [x] `bun run --filter @poggers/site build`
- [x] generated starter smoke:
  - [x] create a temp app with `bun packages/create-poggers/src/index.js`;
  - [x] run `bun run typecheck`;
  - [x] run `bun run build`.
- [x] binary smoke:
  - [x] run `poggers build --outfile <tmp>/chat`;
  - [x] start the compiled binary;
  - [x] verify HTTP 200 for `/`;
  - [x] stop the binary cleanly.

### Browser Gates

- [x] Start `bun run --filter @poggers/chat dev`.
- [x] Open `http://localhost:3000` in browser automation.
- [x] Verify the page renders with no console errors.
- [x] Type text into the composer.
- [x] Save an unrelated component edit and verify hot refresh preserves composer text.
- [x] Send a message and verify the resource command path still works.
- [x] Restart with `POGGERS_DEPS=mock POGGERS_FAKE_AI=...` and verify the worker completion path without a third-party service.
- [x] Toggle between presets and verify the whole app visual style changes without component code changes.
- [x] Inspect DOM and verify parts have `data-pg-component` and `data-pg-part`.

### API Shape Gates

- [x] App code imports generated functions directly from `@poggers/app`.
- [x] No app code imports `api` or `ui` from `@poggers/app`.
- [x] No app code calls `ui.useX`.
- [x] No framework code exposes `ui.useX`.
- [x] No framework code uses slot-name heuristics to choose DOM elements.
- [x] No app type contains `UI.Styles`.
- [x] Every renderable semantic contract is under top-level `Components`.

## Done Means

- The demos and starter use the final API only.
- The old API does not typecheck in app code.
- Components are controlled by one path: `App["Components"]` -> `defineApp.components` -> generated `createX` -> JSX parts.
- Styling is controlled by one path: `App["Components"][X]["Parts"]` -> `defineStyles` presets -> generated part metadata.
- Resource data is controlled by one path: `App["Resources"]` -> generated `useX`.
