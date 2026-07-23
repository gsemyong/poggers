# Kit

Kit is a private TypeScript product language for portable Programs, typed
Dependencies, and platform user interfaces. A System composes reusable
Features; adapters realize its Programs for development and production.

## Create A Workspace

Install [Mise](https://mise.jdx.dev/) once, then run the packaged CLI directly
from a GitHub release:

```sh
mise use -g github:nubjs/nub@0.4.13
version=0.1.0
package="https://github.com/gsemyong/poggers/releases/download/v${version}/kit-${version}.tgz"
nubx -y -p "$package" kit create my-system --package "$package"
cd my-system
mise install
nub run dev
```

`nubx` is Nub's equivalent of `npx`: it downloads the requested package,
executes its `kit` binary, and caches it. `kit create` also installs the new
workspace. Passing the same immutable package URL to `--package` pins the
generated System to the framework release that created it.

The command creates the canonical System workspace:

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

Verify or publish a release from a clean, pushed commit:

```sh
nub run release -- 0.1.0 --dry-run
nub run release -- 0.1.0
```

Run the presentation lab or the multi-App authenticated example:

```sh
nub run dev:example
nub run dev:crud
```

See the [architecture](docs/architecture.md), [Feature convention](docs/features.md),
[compatibility policy](docs/compatibility.md), and
[Portable TypeScript profile](docs/portable-typescript.md).
