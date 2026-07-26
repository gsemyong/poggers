# Authenticated CRUD

This is the repository's one representative end-to-end System. It proves that
independently reusable Identity and Entity factories can be mounted directly,
combined with application-owned UI, and realized by the ordinary web and
server adapters without System-level transport or provider wiring.

```text
src/
  apps/           customer and operations Apps
  features/       identity, tasks, and shell vertical slices
  presentations/  the web Presentation
  deployment.ts   local deployment definition
  system.ts       the only compilation root
```

Run it from the repository root:

```sh
nub run dev:example
```

Open `http://localhost:3000/auth`. Development data is retained under `.data/`.

Build the production System with:

```sh
nub src/cli.ts build --dir examples/authenticated-crud
```

The System specification covers authentication, authorization isolation,
optimistic local-first CRUD, synchronization, persistence across restart,
validated routing, production rendering, and generated native execution. The
adjacent task specification tests the Entity semantics directly without HTTP
or credentials.

See [Architecture](../../docs/architecture.md) and
[Feature Factories](../../docs/features.md) for the framework contracts.
