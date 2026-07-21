# Poggers

Poggers is a TypeScript product language for portable Programs, typed
Capabilities, platform Components, and complete Presentations. Applications
compose reusable Features; adapters own native realization.

## Create An Application

```sh
nub x @poggers/kit create my-app
cd my-app
mise install
nub install
nub run dev
```

The generated project is the canonical application convention:

```text
src/
  app.tsx
  features/
    shell.tsx
  presentations/
    clean.ts
```

`app.tsx` is only the composition root. A Feature owns product structure and
behavior. A Presentation owns adapter-defined user-facing decisions, including
visuals, assets, and motion on the web. Every project retains this organization
as it grows; Feature and Presentation paths do not change with project size.

## Develop The Kit

This repository contains the framework package, its canonical template, and
focused examples that pressure-test individual adapter surfaces.

```sh
mise install
nub install
nub run check
nub run build
nub run benchmark
```

Run the web Presentation example with:

```sh
nub run dev:example
```

The example demonstrates direct fine-grained state updates, semantic
Presentation HMR with preserved DOM, state, temporal values, and Event cursors;
container-aware styling; and parameterized control sound and icon assets.
Switching the accent changes
both assets without changing Structure or remounting its native Elements. Its
sheet demonstrates direct drag following, velocity-aware spring release,
rubber-band overscroll, interruptible presence, contextual crossfade, keyed
reorder and layout continuity, repeated action feedback, shared environment
observations, reduced motion, frame inspection, and deterministic realization
of each frame.

See [the architecture document](docs/architecture.md) for the product model and
adapter boundaries, and [the project organization](docs/project-organization.md)
for the application and reusable Feature conventions. Headless code intended
for both JavaScript development and native production follows the deliberately
small [Portable TypeScript profile](docs/portable-typescript.md); unsupported
host code is identified in IR and can never become a silent native source
fallback. The [native production plan](docs/native-production-plan.md) records
the whole-Program realization gates and measured cache behavior.
