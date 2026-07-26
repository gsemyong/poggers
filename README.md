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

This repository keeps three workspace roles distinct:

- `template/` is the single source copied by `kit create`;
- `playground/` is the interactive lab for developing Features and
  Presentations;
- `examples/authenticated-crud/` is the one representative end-to-end System.

They are not alternate project shapes. All three use the same public API and
source convention.

Develop the framework with:

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

Run the playground or the authenticated example:

```sh
nub run dev
nub run dev:example
```

See the [architecture](docs/architecture.md), [Feature convention](docs/features.md),
and [Portable TypeScript profile](docs/portable-typescript.md).
