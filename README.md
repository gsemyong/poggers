# Poggers

Poggers is a TypeScript product language for portable Programs, typed
Dependencies, platform Components, and complete Presentations. A System
composes reusable Features; Platform Adapters own realization.

## Current System Workflow

```sh
nub x @poggers/kit create my-app
cd my-app
mise install
nub install
nub run dev
```

The CLI creates one System workspace:

```text
src/
  features/
    shell.tsx
  presentations/
    clean.ts
  system.spec.ts
  system.ts
```

`system.ts` is the compilation root. The System composes App Features, each App
composes platform-interface Features, and an interface owns its Presentation
and installation meaning. Ordinary Features own product behavior and can
contribute to Programs in several Environments.

## Develop The Kit

This repository currently contains the framework package, its packaged starter,
and focused examples that pressure-test individual adapter surfaces.

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
both assets without changing Structure or remounting its platform Elements. Its
sheet demonstrates direct drag following, velocity-aware spring release,
rubber-band overscroll, interruptible presence, contextual crossfade, keyed
reorder and layout continuity, repeated action feedback, shared environment
observations, reduced motion, frame inspection, and deterministic realization
of each frame.

See [the architecture document](docs/architecture.md) for the normative target,
the audited current state, the live gap ledger, and the verification gates. The
active migration is tracked in the
[System implementation ledger](docs/system-implementation.md).
Headless code intended for both JavaScript development and optimized production
follows the deliberately small
[Portable TypeScript profile](docs/portable-typescript.md); unsupported host
code is identified in IR and can never become a silent production fallback.
