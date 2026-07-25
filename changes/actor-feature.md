kind: feature
summary: Add a typed durable Actor Feature factory compiled through ordinary Programs and Dependencies.

# Durable Actors

`createActor` defines durable keyed state, typed commands and queries, Actor
references, one-shot timers, migrations, deduplicated invocation, and bounded
admission as an ordinary reusable Feature.

Actor business logic is portable TypeScript. Development executes it through
the TypeScript runtime and production compiles the same Programs through the
generic Rust backend; there is no Actor-specific compiler or native handler.
