# Strict App Structure, PWA, Tailwind, And UI Runtime Plan

## Purpose

Make the simple Poggers use case excellent:

- One service binary runs on a laptop or personal server.
- The app is opened from desktop or mobile through the served web UI.
- Mobile access can be private through Tailscale Serve without requiring Poggers to solve mesh networking first.
- Every app uses the same strict file structure.
- The primary authoring surface is generic-first `defineApp<Spec>()`.
- The app can be installed as a PWA.
- UI authors keep full JSX control, client-side transitions, spring motion, and layout animations.
- AI-generated code stays coherent because the framework enforces conventions.

This plan intentionally resets scope away from native bundles and multi-machine consensus. Mesh, iroh, and fleets remain future infrastructure. This phase is about making one laptop/server feel like a polished personal application platform.

## Implementation Status

Completed in this pass:

- Generic-first `defineApp<Spec>()` now accepts embedded `app`, `pwa`, `navigation`, `deps`, `programs`, and `ui(ctx)` fields.
- Embedded UI receives semantic resource hooks, typed `screen`, and typed `nav` helpers derived from the generic spec.
- The runtime can load new strict apps from `app.tsx` while preserving `api.ts`, `api/index.ts`, `defineUI`, and worker-file compatibility.
- The server emits PWA app-shell HTML, manifest, service worker, generated fallback icon, bundled CSS, static assets, and browser-style SPA fallback.
- Tailwind v4 is compiled by the kit build pipeline from `styles.css` or `components/theme.css`.
- `create-poggers` generates the strict `types.ts`, `app.tsx`, `components/`, `helpers/`, and `styles.css` structure without empty folders.
- `apps/chat` and `apps/site` now dogfood the strict structure.
- Architecture and testing docs now describe the strict structure as the primary path.

Verified gates:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `git diff --check`
- `bun test`
- generated app create/install/typecheck/build/run route probes
- generated app in-app browser smoke: root render, command update, Settings navigation, reload on `/settings`, return Home
- docs site in-app browser smoke: root render and docs navigation
- chat in-app browser smoke with fake AI deps: send message and receive fake assistant response

Future gates not claimed by this pass:

- HTTPS reverse-proxy installability checks.
- Offline-after-first-visit PWA behavior.
- Mobile viewport screenshot and visual-overlap audit.
- Rich motion primitives beyond the generated `Transition` starter.

## Target App Structure

Every Poggers app must use this structure. There is no tiny-app exception.

```text
types.ts
app.tsx
components/
helpers/
```

Recommended component subfolders:

```text
components/
  primitives/
  layout/
  motion/
  screens/
  domain/
```

Recommended helper subfolders:

```text
helpers/
  deps/
  env/
  format/
  ids/
  parsers/
```

The initializer should create these folders even when they only contain a `.gitkeep` or starter file. Empty dangling folders are not allowed after generation; each folder must contain either a real starter file or be omitted by a documented convention. Because we want the same structure for every app, starter files are preferred.

## File Responsibilities

### `types.ts`

Owns app type information:

- `App` generic spec type.
- Resource state, presence, event, view, and command types.
- Navigation/screen types.
- Environment dependency types.
- Domain model types.
- Shared data contracts used by UI, programs, helpers, and tests.

It must not contain runtime resource handlers, UI components, service startup, or dependency construction.

### `app.tsx`

Owns app composition:

- `export default defineApp<App>({...})`.
- App metadata.
- PWA metadata.
- Resources.
- Programs.
- Navigation mapping.
- Root UI composition.

It may import components from `components/` and helpers from `helpers/`.

### `components/`

Owns the local application design system.

The goal is not a generic library. It is the app's visual and interaction language:

- Primitives: buttons, inputs, tabs, menus, sheets, toolbars.
- Layout: shells, panes, sidebars, stacks, scroll regions.
- Motion: presence, spring transition wrappers, shared layout pieces.
- Screens: top-level application states.
- Domain: resource-specific widgets like chat threads, agent run cards, task rows.

Components may use Tailwind classes, framework state primitives, and framework motion primitives. Components must not own durable data mutations except by calling semantic resource actions passed in as props or obtained from the UI context.

### `helpers/`

Owns implementation details:

- Dependency factories.
- AI clients.
- File helpers.
- Formatting helpers.
- ID factories.
- Clock helpers.
- Pure parsers.
- Environment adapters.

Helpers must not import UI components. Helpers may import `types.ts`.

## Public App Surface

The desired primary surface is:

```tsx
import { defineApp } from "@poggers/kit";
import type { App } from "./types";
import { Root } from "./components/root";

export default defineApp<App>({
  version: 1,

  app: {
    name: "My App",
  },

  pwa: {
    name: "My App",
    shortName: "My App",
    themeColor: "#0f172a",
    backgroundColor: "#ffffff",
    display: "standalone",
    icons: {
      any: "./assets/icon.png",
      maskable: "./assets/icon-maskable.png",
    },
  },

  navigation: {
    home: "/",
    chat: "/chat/:sessionId",
    settings: "/settings",
  },

  resources: {
    // Existing ResourceDef shape.
  },

  programs: {
    async server(ctx, deps) {
      // Persistent app program.
    },
  },

  ui(ctx) {
    return <Root ctx={ctx} />;
  },
});
```

Server dependency construction lives in root `deps.ts`, outside `src`, and exports names such as `createServerDeps`.

Important constraints:

- `defineApp<Spec>()` remains generic-first.
- Do not introduce public `resource()`, `command()`, `event()`, or `type()` wrappers.
- Keep the current resource definition shape unless a change is necessary for type inference or app organization.
- `defineUI(api, ...)` remains as a compatibility adapter, but new apps should use `ui` inside `defineApp`.
- `defineWorker` remains compatibility for existing worker-file apps. New apps should prefer `programs` inside `defineApp`.
- Existing `api/v1.ts` version-folder apps remain supported for larger versioned APIs.

## Generic Spec Shape

The generic type parameter should continue to describe the application as much as possible:

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
      Deps: ServerDeps;
    };
  };

  Navigation: {
    home: {};
    chat: { sessionId: string };
    settings: {};
  };
};
```

Navigation names, params, and `nav` helpers should derive from `Spec["Navigation"]`.

Environment dependency types should continue to derive from `Spec["Environments"]`.

Resource hooks should continue to derive from `Spec["Resources"]`.

## Navigation And UI

Navigation should exist because we need:

- Real URLs.
- Browser back/forward.
- PWA launch restore.
- Deep links.
- Typed params.
- Screen-level layout transitions.
- Shared element/layout animation boundaries.

Navigation should not become a separate page-file framework. It should be a typed API delivered to `ui`.

The UI context should expose:

- `screen`: current screen name and typed params.
- `nav`: typed navigation functions.
- Semantic resource hooks like `useChat`.
- Motion helpers if the root needs route-level transitions.

Example:

```tsx
ui({ screen, nav, useChat }) {
  return (
    <AppShell>
      <SharedLayout value={screen.name}>
        {screen.name === "home" && <HomeScreen nav={nav} />}
        {screen.name === "chat" && (
          <ChatScreen chat={useChat({ sessionId: screen.params.sessionId })} />
        )}
      </SharedLayout>
    </AppShell>
  );
}
```

## PWA Requirements

The framework should generate and serve:

- `manifest.webmanifest`.
- Service worker.
- PWA icon routes/assets.
- Offline app shell fallback.
- Static asset cache.
- Runtime cache for app shell and generated bundles.

The framework should make PWA metadata first-class on `defineApp`:

```ts
pwa: {
  name: string;
  shortName?: string;
  description?: string;
  themeColor: string;
  backgroundColor: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  orientation?: string;
  startUrl?: string;
  scope?: string;
  icons: {
    any: string;
    maskable?: string;
  };
}
```

Installability gates:

- Manifest is reachable.
- Manifest includes valid name, icons, start URL, display, theme color, and background color.
- Service worker registers on HTTPS or localhost.
- App shell works after reload.
- App shell has a fallback when offline.
- IndexedDB client state restores before sync completes.

Tailscale guidance:

- The framework should document that mobile PWA install requires a secure context.
- Localhost works on the laptop.
- Mobile should use Tailscale Serve or another HTTPS reverse proxy.
- Poggers should not require Tailscale in the framework runtime.

## Tailwind Decision

Bake in Tailwind CSS v4 as the default styling pipeline.

Rationale:

- Tailwind v4 is CSS-first with `@import "tailwindcss"`.
- Theme tokens are CSS variables through `@theme`.
- Class detection generates only used utilities.
- It gives AI-generated UI a constrained styling vocabulary.
- It avoids inventing a styling language before the framework is mature.

Tailwind docs:

- https://tailwindcss.com/docs
- https://tailwindcss.com/docs/theme
- https://tailwindcss.com/docs/detecting-classes-in-source-files

Framework convention:

- The app owns a single stylesheet, generated as `components/theme.css` or `styles.css`.
- The stylesheet imports Tailwind and defines app tokens with `@theme`.
- Components use Tailwind utilities.
- Reusable visual decisions are represented by primitive component props.
- Arbitrary values are allowed sparingly for precise UI, not as the default.
- Global CSS is only for tokens, base document rules, complex selectors, and motion primitives.

Starter stylesheet:

```css
@import "tailwindcss";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --color-surface: oklch(0.99 0.01 250);
  --color-ink: oklch(0.18 0.02 250);
  --radius-control: 0.5rem;
}

html,
body,
#root {
  min-height: 100%;
}
```

## State Conventions

Default state hierarchy:

- Durable resource state: event-sourced in resources.
- Presence: ephemeral per-session/worker UI or process state.
- Local component state: transient UI state.
- Derived state: computed from resource views and local component state.
- State machines: only for explicit workflows.

State machines should be used for:

- Multi-step onboarding.
- Pairing/connect flows.
- Install/update flows.
- Agent run lifecycle views.
- Complex modal/wizard flows.

State machines should not be required for:

- Basic form fields.
- Simple open/closed UI.
- Tabs.
- Menus.
- Common screen switching.

## Motion Conventions

The UI layer should support client-side JavaScript transitions, spring animation, and layout-based animation.

Framework should provide first-party primitives:

- `Presence`
- `Transition`
- `Spring`
- `SharedLayout`
- `useSpring`
- `useReducedMotion`

Motion rules:

- Motion belongs in UI components, not resources.
- Resource events describe durable facts, not animations.
- Route transitions use `screen.name` or route identity.
- Shared layout transitions need stable layout IDs.
- Reduced-motion preferences must be respected.
- Components must be usable without animation for tests and accessibility.

## Initializer Requirements

`create-poggers` should generate:

```text
deps.ts
src/types.ts
src/app.tsx
src/styles.ts
src/components/root.tsx
src/components/app-shell.tsx
src/components/button.tsx
src/components/counter-panel.tsx
src/components/home-screen.tsx
src/components/settings-screen.tsx
src/components/transition.tsx
```

Generated app behavior:

- Builds without edits.
- Runs as a service.
- Serves a PWA.
- Has a typed resource.
- Has typed navigation.
- Has a local design-system primitive.
- Uses Tailwind classes.
- Has a server program example if useful, but no fake background complexity by default.

## Runtime Requirements

The kit runtime should support:

- Loading default export `defineApp<Spec>()` from `app.tsx`.
- Serving UI from `def.ui`.
- Serving generated PWA assets.
- Serving generated manifest.
- Serving generated service worker.
- Starting `programs.server` in the same Bun process.
- Loading environment deps from `def.deps.server` or app helper exports.
- Keeping existing `api.ts` + `app.tsx` + `worker.ts` compatibility.
- Keeping existing migration chain support.

## Documentation Requirements

Update docs to explain:

- The strict app structure.
- Why every app has the same structure.
- `types.ts` responsibilities.
- `app.tsx` responsibilities.
- `components/` conventions.
- `helpers/` conventions.
- Generic-first `defineApp<Spec>()`.
- Embedded UI in `defineApp`.
- Embedded programs in `defineApp`.
- Navigation API.
- PWA setup and install behavior.
- Tailwind conventions.
- Motion conventions.
- State conventions.
- Testing conventions.
- Tailscale Serve guidance for mobile private access.

Docs should avoid presenting multiple equally blessed app shapes. Compatibility paths can be documented separately as legacy or advanced.

## Implementation Checklist

### Phase 1: Type Surface

- [ ] Extend `AppSpec` with optional `Navigation`.
- [ ] Add typed `Screen` and `Nav` derivation from `Spec["Navigation"]`.
- [ ] Extend `AppDef` with optional `app`, `pwa`, `navigation`, `ui`, and `deps` fields.
- [ ] Ensure fields are generic-first and do not require wrapper helpers.
- [ ] Add compile-time tests for typed navigation params.
- [ ] Add compile-time tests for semantic hooks inside embedded `ui`.
- [ ] Add compile-time tests for environment deps inside embedded `programs`.
- [ ] Preserve existing `defineUI` compatibility.
- [ ] Preserve existing `defineWorker` compatibility.

### Phase 2: UI Runtime

- [ ] Create embedded UI context type.
- [ ] Derive semantic UI hooks from app resources for embedded `ui`.
- [ ] Add current screen parsing from URL.
- [ ] Add typed `nav` helpers that update browser history.
- [ ] Handle back/forward navigation.
- [ ] Handle unknown paths with a documented fallback.
- [ ] Ensure UI can render from `defineApp` default export.
- [ ] Keep existing standalone `app.tsx` UI loader working during migration.

### Phase 3: PWA Runtime

- [ ] Add manifest generation from `def.pwa`.
- [ ] Add service worker generation.
- [ ] Add static asset cache.
- [ ] Add app shell offline fallback.
- [ ] Add PWA icon serving/copying.
- [ ] Add HTML head metadata for PWA/mobile.
- [ ] Add tests for manifest content.
- [ ] Add tests for service worker route content.
- [ ] Add tests for offline fallback response.

### Phase 4: Tailwind Pipeline

- [ ] Add Tailwind v4 dependencies to the relevant package/app templates.
- [ ] Decide whether Tailwind processing lives in kit bundler or generated app build config.
- [ ] Add default `styles.css`.
- [ ] Ensure class detection includes `app.tsx`, `components/**/*.tsx`, and any generated JSX files.
- [ ] Make generated app compile Tailwind CSS in dev and build.
- [ ] Document allowed CSS patterns.
- [ ] Add lint/docs convention for avoiding unmanaged global CSS.

### Phase 5: Motion Primitives

- [ ] Add minimal motion primitives under kit UI runtime or generated `components/motion`.
- [ ] Start with `Presence`, `Transition`, and `useReducedMotion`.
- [ ] Add spring primitive only after API shape is tested in an app.
- [ ] Ensure primitives are independent from resource state.
- [ ] Add browser visual verification for a route transition.

### Phase 6: Initializer

- [ ] Update `create-poggers` template to strict structure.
- [ ] Generate `types.ts`.
- [ ] Generate `app.tsx` with embedded resources, PWA, navigation, programs, and UI.
- [ ] Generate component folders with starter files.
- [ ] Generate helper folders with starter files.
- [ ] Generate stylesheet.
- [ ] Remove old multi-file default template as the primary path.
- [ ] Keep advanced examples available in docs, not default generation.

### Phase 7: Dogfood Apps

- [ ] Migrate `apps/chat` to `types.ts`, `app.tsx`, `components/`, `helpers/`.
- [ ] Move chat UI pieces into `components/`.
- [ ] Move chat deps and parsing helpers into `helpers/`.
- [ ] Embed chat UI in `defineApp`.
- [ ] Embed chat program in `defineApp` or keep compatibility only where needed.
- [ ] Add PWA metadata to chat.
- [ ] Add Tailwind styling convention to chat.
- [ ] Migrate `apps/site` to the same structure.
- [ ] Ensure docs site does not use a divergent app shape.

### Phase 8: Documentation

- [ ] Update `docs/architecture.md` to make strict structure primary.
- [ ] Update `docs/testing.md` with app, UI, PWA, and browser gates.
- [ ] Add a conventions section for components.
- [ ] Add a conventions section for helpers.
- [ ] Add Tailwind conventions.
- [ ] Add motion conventions.
- [ ] Add PWA/Tailscale guidance.
- [ ] Mark old `api.ts` + `app.tsx` + `worker.ts` as compatibility/advanced.

## Testing Gates

### Static Gates

- [ ] `bun install --lockfile-only`
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run fmt:check`
- [ ] `bun test`
- [ ] `git diff --check`

### Unit Gates

- [ ] `defineApp` accepts embedded `ui`.
- [ ] `defineApp` accepts embedded `pwa`.
- [ ] `defineApp` accepts typed `navigation`.
- [ ] Navigation params infer from `Spec["Navigation"]`.
- [ ] `nav.chat({ sessionId })` is typed.
- [ ] Missing route params fail type tests.
- [ ] Resource hooks still derive from `Spec["Resources"]`.
- [ ] Program deps still derive from `Spec["Environments"]`.
- [ ] Existing migration tests pass.
- [ ] Existing worker durability tests pass.

### Runtime Gates

- [ ] App loads from only `app.tsx` plus `types.ts/components/helpers`.
- [ ] Server starts `programs.server`.
- [ ] UI can call resource commands.
- [ ] Resource state syncs to browser.
- [ ] Browser reload restores from snapshot/cache.
- [ ] Unknown route falls back predictably.
- [ ] Back/forward updates `screen`.

### PWA Gates

- [ ] `/manifest.webmanifest` returns valid JSON.
- [ ] `/service-worker.js` returns JavaScript.
- [ ] App registers the service worker.
- [ ] Manifest icon paths return assets.
- [ ] App is installable on localhost.
- [ ] App is installable through HTTPS reverse proxy.
- [ ] Offline app shell loads after first visit.

### Tailwind Gates

- [ ] Generated app includes Tailwind CSS.
- [ ] Tailwind utilities in `components/` appear in built CSS.
- [ ] Theme tokens from `@theme` are available.
- [ ] Production CSS is generated during binary/build pipeline.
- [ ] No Vite dependency is reintroduced unless intentionally accepted.

### Browser Gates

Use browser automation against the running app.

- [ ] Open app root.
- [ ] Verify root screen renders.
- [ ] Navigate to second screen with typed `nav`.
- [ ] Verify URL changes.
- [ ] Verify back button returns to previous screen.
- [ ] Verify route transition does not blank the UI.
- [ ] Verify resource command updates visible state.
- [ ] Verify manifest is linked in document head.
- [ ] Verify service worker is registered.
- [ ] Capture desktop screenshot.
- [ ] Capture mobile viewport screenshot.
- [ ] Check no visible text overlap on mobile.

### Generated App Gates

- [ ] Run `bunx create-poggers` or local equivalent.
- [ ] Generated app has exact strict structure.
- [ ] Generated app typechecks.
- [ ] Generated app lints.
- [ ] Generated app builds web assets.
- [ ] Generated app builds service binary.
- [ ] Generated app runs locally.
- [ ] Browser verifies generated app root.
- [ ] Browser verifies generated app PWA manifest and service worker.

### Dogfood Gates

- [ ] Chat app typechecks.
- [ ] Chat app tests pass.
- [ ] Chat app builds.
- [ ] Chat app binary builds.
- [ ] Chat app browser smoke sends a message.
- [ ] Chat app PWA routes are present.
- [ ] Site app typechecks.
- [ ] Site app builds.
- [ ] Site app browser smoke opens docs.

## End-To-End Acceptance

The plan is complete when:

- A new app generated by `create-poggers` uses only the strict structure.
- The generated app default export is `defineApp<Spec>()`.
- Resources, programs, navigation, PWA metadata, and UI are all organized through `defineApp`.
- The generated app uses Tailwind v4 by default.
- The generated app is installable as a PWA on localhost or HTTPS.
- The generated app can be served by a single Bun service binary.
- Existing chat and site dogfood apps use the same structure.
- Existing compatibility paths still pass tests.
- Browser automation proves route navigation, command sync, PWA metadata, service worker registration, and mobile layout.

## Explicit Non-Goals

- No native desktop bundling.
- No iroh mesh implementation.
- No multi-node consensus.
- No cloud fleet placement.
- No public authority API.
- No new resource wrapper DSL.
- No framework-owned generic component library beyond necessary runtime primitives.
- No required Tailscale integration.

## Follow-Up After This Plan

After the single-node PWA path is polished, revisit:

- Encrypted hosted browser doorway.
- Iroh transport for node-to-node sync.
- Multi-node app deployment.
- Resource/scope placement as infrastructure.
- Signed updates across service nodes.
