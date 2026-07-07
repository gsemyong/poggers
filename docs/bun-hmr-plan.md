# Bun HMR Plan

## Goal

Make `poggers dev` use Bun's real development-server HMR for browser code instead of the current live-reload shim. Saving UI or style files should update the running page without a full browser reload whenever Bun can accept the change safely.

## Status

Implemented. `poggers dev` now serves a generated Bun HTML route with Bun's HMR client, keeps the existing Poggers `/ws` app protocol, hot-swaps generated CSS without a document reload, and rerenders the Poggers root for app/component source changes without navigating the page. Native JSX component edits currently remount the root, so local component state is not preserved for component-code edits yet; CSS/style edits preserve local browser state.

## Principles

- Keep Poggers as a Bun-first framework.
- Keep the app API server, event stream, snapshots, PWA routes, and `/ws` protocol in the existing server runtime.
- Move browser assets onto Bun's HTML route pipeline in dev, because Bun's HMR is attached to `Bun.serve({ development, routes })`.
- Treat full-page reload as a fallback, not the normal path.
- Do not complicate user application structure. App authors should keep writing `types.ts`, `app.tsx`, `components/**`, `helpers/**`, and optional generated framework files stay inside `.app`.

## Current Problem

- `poggers dev` generates a browser entrypoint and serves a JS bundle created with `Bun.build()` inside our own fetch handler.
- A file watcher tells the browser to call `location.reload()`.
- This is live reload. It restarts the page and loses local browser state.
- Bun HMR cannot participate because the page is not served as a Bun HTML route with `development.hmr`.

## Target Behavior

- `styles.ts` changes:
  - Regenerate `styles.generated.css`.
  - Let Bun's dev asset pipeline update CSS without reloading the page.
  - The browser keeps DOM/runtime state.
- Component/UI changes:
  - Bun re-evaluates the affected modules through `import.meta.hot`.
  - Poggers root rerenders into the existing root without replacing the whole document.
  - The app websocket/client runtime should stay connected when possible.
- API/spec/worker/server changes:
  - Regenerate virtual modules/types.
  - Prefer controlled root remount if frontend-only imports changed.
  - Allow full browser reload or dev-server restart for contract/server changes until we have safe server HMR.

## Implementation Checklist

- [x] Add a dev browser asset mode that writes `.app/dev/index.html` instead of serving an opaque bundle.
- [x] Change the dev entrypoint to be HMR-aware:
  - [x] Import generated CSS from a stable file path.
  - [x] Reuse the root runtime through `import.meta.hot.data`.
  - [x] Call `import.meta.hot.accept()` directly so Bun sees a hot boundary.
  - [x] Call `import.meta.hot.dispose()` to clean up effects only when the module is actually replaced.
- [x] Teach `serve()` to accept a Bun `HTMLBundle` route for `/` and SPA fallback routes while preserving:
  - [x] `/ws`
  - [x] `/manifest.webmanifest`
  - [x] `/_poggers/icon.svg`
  - [x] `/service-worker.js`
  - [x] user-defined server routes
- [x] Enable Bun dev mode:
  - [x] `development: { hmr: true, console: true }`
  - [x] Disable service worker registration in dev by serving the generated Bun dev HTML instead of the production/PWA shell.
- [x] Replace the current live-reload client with an HMR bridge:
  - [x] Keep file scanning only for generated artifacts that Bun does not see directly.
  - [x] Do not call `location.reload()` for UI/style changes.
  - [x] Hot-swap generated CSS for `styles.ts` changes.
  - [x] Ask Poggers to rerender the root for app/component source changes.
- [x] Ensure `@poggers/app` imports resolve in Bun's dev asset pipeline through generated real files and app `tsconfig` paths.
- [x] Preserve production behavior:
  - [x] `poggers bundle`
  - [x] `poggers build`
  - [x] compiled single binary

## Testing Checklist

- [x] Unit/runtime tests:
  - [x] Generated dev HTML is served through Bun's HMR client.
  - [x] Generated dev entrypoint contains direct `import.meta.hot.accept()`.
  - [x] Generated dev entrypoint stores reusable runtime in `import.meta.hot.data`.
  - [x] Dev server is configured with Bun `development.hmr`.
  - [x] Production bundle path does not include HMR code as framework behavior.
- [x] Integration tests:
  - [x] `poggers dev` serves `/`.
  - [x] `/ws` still upgrades and syncs resources.
  - [x] PWA assets still respond.
  - [x] SPA fallback still serves the app.
- [x] Browser E2E gate:
  - [x] Start `apps/chat` with `poggers dev`.
  - [x] Open the app in a browser.
  - [x] Put typed text in the chat input.
  - [x] Edit `apps/chat/styles.ts`.
  - [x] Verify computed style changes.
  - [x] Verify `performance.getEntriesByType("navigation").length` does not increase.
  - [x] Verify the typed text remains for style/CSS HMR.
  - [x] Edit a component label in `ChatScreen.tsx`.
  - [x] Verify visible text changes without a full navigation.
  - [x] Document that local component state resets on component-code rerender.
  - [x] Restore edited files.

## Verification Gates

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run fmt:check`
- [x] `bun test`
- [x] `bun run --filter @poggers/chat build`
- [x] Browser E2E evidence for no full reload on style changes.
- [x] Browser E2E evidence for no full reload on accepted UI changes, with documented native JSX root-remount behavior.

## Known Risk

Bun's HMR API is still marked work-in-progress. If HTML route HMR cannot accept Poggers' generated virtual module setup directly, we should still land the structural migration to Bun's dev asset pipeline and then add the smallest Poggers-specific hot boundary around the root renderer.
