# Poggers

Poggers is a batteries-included TypeScript framework for local-first
applications. The repository contains one framework package and five maintained
applications.

## Develop

```sh
bun install
bun run dev:chat
bun run dev:site
bun run dev:visual-lab
```

Run the complete repository gate with:

```sh
bun run check
bun run build
```

The framework package is `@poggers/kit`. Create an application with
`bunx @poggers/kit create`.

## Documentation

- [Architecture](docs/architecture.md): product vocabulary, source ownership,
  public boundaries, substrate semantics, and verification policy.
- [Component API](docs/component-api.md): the normative State, Actions,
  hierarchy, task, Preset, and lifecycle contract.
