kind: feature
summary: Add a typed durable Actor Feature factory compiled through ordinary Programs and Dependencies.

# Durable Actors

`createActor` defines durable keyed state, one inferred method API, locally
bound Actor references, typed product failures, one-shot reminders,
migrations, deduplicated invocation, bounded admission, snapshots, and
retention as an ordinary reusable Feature.

Actor business logic is portable TypeScript. Development executes it through
the TypeScript runtime and production compiles the same Programs through the
generic Rust backend; there is no Actor-specific compiler or native handler.
Generic Process distribution supplies virtual partitioning, fenced ownership,
remote Dependency transport, relocation, draining, failover, and durable
reminder delivery without exposing topology in Actor source.
