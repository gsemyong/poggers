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
visuals, assets, and motion on the web. Small projects may add more files to
those two folders without changing the architecture.

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
Presentation HMR with preserved DOM and state, container-aware styling, and a
Presentation-parameterized control sound and icon. Switching the accent changes
both assets without changing Structure or remounting its native Elements. Its
motion sheet demonstrates direct drag values, velocity-aware spring release,
interruptible presence, coordinated wrapping/layout changes, shared layout
identity, reduced motion, and native Web Animation realization.

See [the architecture document](docs/architecture.md) for the product model,
adapter boundaries, repository organization, and testing convention.
