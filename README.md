# Kit

Kit is a private TypeScript product language for portable Programs, typed
Dependencies, and platform user interfaces. A System composes reusable
Features; adapters realize its Programs for development and production.

## Create A Workspace

```sh
kit create my-app --package <private-package-location>
cd my-app
mise install
nub install
nub run dev
```

It creates the canonical System workspace:

```text
src/
  features/
    shell.tsx
  presentations/
    clean.ts
  system.spec.ts
  system.ts
```

`system.ts` is the only compilation root. Apps and their platform interfaces
are Features; ordinary Features may be shared by several Apps. The compiler
builds the System graph once and adapters realize only the requested outputs.

## Develop The Kit

This repository contains the framework, its canonical starter, and focused
examples:

```sh
mise install
nub install
nub run check
nub run build
```

Run the presentation lab or the multi-App authenticated example:

```sh
nub run dev:example
nub run dev:crud
```

See the [architecture](docs/architecture.md), [Feature convention](docs/features.md),
[compatibility policy](docs/compatibility.md), and
[Portable TypeScript profile](docs/portable-typescript.md). The active
verification ledger is [docs/system-implementation.md](docs/system-implementation.md).
