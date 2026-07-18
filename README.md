# Poggers

Poggers is a TypeScript product language for portable Programs, typed
Capabilities, platform Components, and complete Presentations. Applications
compose reusable Features; platform adapters own rendering and native behavior.

## Create An Application

```sh
nub x @poggers/kit create my-app
cd my-app
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
behavior. A Presentation owns visual decisions. Small projects may add more
files to those two folders without changing the architecture.

## Develop The Kit

This repository contains the framework package and its canonical template. It
does not maintain separate example applications.

```sh
nub install
nub run check
nub run build
```

See [the architecture document](docs/architecture.md) for the product model,
adapter boundaries, repository organization, and testing convention.
