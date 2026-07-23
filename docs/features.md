# Reusable Features

A Feature is the only composition primitive. It owns a vertical product slice:
semantic contracts, Programs, optional Components and routes, and the
Dependencies it provides or requires.

## Convention

Reusable factories live in `src/features/<name>.ts` until their implementation
needs several files, then in `src/features/<name>/`. App-specific
Features follow the same convention in a workspace. Size changes layout, not
meaning.

A factory should:

- infer its public API from semantic type parameters and its implementation;
- expose product operations instead of transport or persistence plumbing;
- declare Program contributions and Dependencies without selecting a host
  implementation;
- keep render functions pure over state and expose synchronous UI actions;
- include a focused contract test that can run against any valid realization.

Cross-Feature communication uses typed Dependencies. A System realization
collects every Program contribution for a target and resolves each required
Dependency once per Program instance. A Feature never imports another
Feature's implementation.

Use [`examples/authenticated-crud`](../examples/authenticated-crud) for a
multi-Feature pressure test and [`examples/basic`](../examples/basic) as the
canonical workspace created by the CLI.
