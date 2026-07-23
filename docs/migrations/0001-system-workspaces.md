# System Workspaces

## Imports

Replace the former package locator with `kit`. Use the root for
Systems, Features, Programs, Dependencies, and shipped semantic factories.
Import generic UI authoring from `kit/ui`; import platform contracts
from their explicit platform subpaths.

## Composition

Replace a single Application root with:

1. one `createSystem(...)` compilation root;
2. App Features created with `createApp(...)`;
3. platform-interface Features mounted by each App;
4. ordinary reusable Features shared by any App.

The compiler builds the System graph once. A focused App build filters the
realized outputs; it does not define a second graph.

## Workspace

Use `src/system.ts`, `src/features/`, `src/apps/`, and
`src/presentations/`. The CLI creates the canonical minimal form from
`examples/basic`; examples are not alternate templates.

## Terminology

Use **Dependency** for typed interaction with a host or another Feature.
Capability is no longer a framework concept. Use `kit` as the command and
`.kit/` for generated development state.
