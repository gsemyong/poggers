# Poggers

Poggers is a small TypeScript product language and fine-grained UI framework.
Applications compose reusable Features into Runtime-tagged Programs with
explicit Capabilities, platform Components, and complete Presentations. A
Process is one running instance of a Program, not an authored state container.

## Develop

```sh
nub install --frozen-lockfile
nub run dev:chat
nub run dev:visual-lab
```

Run the complete repository gate with:

```sh
nub run check
nub run build
```

The framework package is `@poggers/kit`. Create an application with:

```sh
nub x @poggers/kit create my-app
```

The generated project contains one `src/app.tsx`, the complete TypeScript and
lint configuration, and no generated declaration files.

## Documentation

- [Architecture](docs/architecture.md) defines the maintained product model,
  ownership boundaries, package surface, and verification policy.
- [Portable runtime plan](docs/portable-product-runtime-plan.md) records the
  active implementation gates and evidence.
