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

Creation combines the shared project scaffold with one executable example.
`basic` is the default; select any shipped example explicitly:

```sh
nubx -y -p "$package" kit create my-system --package "$package" --example basic
nubx -y -p "$package" kit create my-system --package "$package" --example authenticated-crud
nubx -y -p "$package" kit create my-system --package "$package" --example presentation
```

`system.ts` is the only compilation root. Apps and their platform interfaces
are Features; ordinary Features may be shared by several Apps. The compiler
builds the System graph once and adapters realize only the requested outputs.

## Develop The Kit

This repository keeps two source roles distinct:

- `template/` contains only package and toolchain setup shared by every System;
- `examples/` contains complete Systems used for development, composition,
  verification, and selectable project creation.

Examples are not throwaway demos. They are the canonical runnable compositions
we test and polish, and the exact source overlaid by `kit create --example`.

Develop the framework with:

```sh
mise install
nub install
nub run check:source
nub run build
```

`check:source` is the routine TypeScript milestone. Use `nub run check` only
for the complete compiler, provider, package, example, distribution, and
production acceptance gate.

Verify or publish a release from a clean, pushed commit:

```sh
nub run release -- 0.1.0 --dry-run
nub run release -- 0.1.0
```

Run any example:

```sh
nub run dev
nub src/cli.ts dev --dir examples/authenticated-crud
nub src/cli.ts dev --dir examples/presentation
```

Reference: [architecture](docs/architecture.md), [Feature factories](docs/features.md),
[Portable TypeScript](docs/portable-typescript.md), [Actors](docs/actors.md),
[Data](docs/data.md), [web](docs/web.md), [Presentation](docs/presentation.md), and
[Deployment](docs/deployment.md).
