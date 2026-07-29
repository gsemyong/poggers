# Authenticated Workspace

This is the repository's representative compositional System. Its task domain
combines the shipped Identity, Aggregate, Projection, and Replica factories
behind a browser program. The same task Feature instance is mounted into two
Applications, while the System remains the only compilation root.

```text
src/
  apps/           customer and operations Applications
  features/       identity, tasks, and shell vertical slices
  presentations/  the web Presentation
  deployment.ts   local deployment definition
  system.ts       the only compilation root
```

In a workspace created from this example, run:

```sh
nub run dev
```

Open `http://localhost:3000/auth`. Development data is retained under `.kit/data/`.

Build the production System with `nub run build`.

While contributing to Kit itself, run the example from the repository root:

```sh
nub src/cli.ts dev --dir examples/authenticated-crud
```

Creating and editing a task is optimistic and local-first. The event-sourced
Aggregate retains domain decisions; the Projection and Replica deliver each
result to every live browser and retain it for the next offline or restarted
session.

The System specification runs the same black-box contract against development
and generated-Rust production. It covers authentication, authorization
isolation, optimistic commands, realtime synchronization, restart recovery,
validated routing, rendering, and packaged assets. The adjacent task
specification tests domain decisions and replay directly without HTTP or
credentials.
