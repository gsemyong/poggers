# Changes

Unreleased changes are recorded as one file per intentional change in
[`changes/`](changes/README.md). Stable releases fold those records into this
file.

## Unreleased

- Replaced the single-Application model with one System containing reusable
  Feature-composed Apps and platform interfaces.
- Renamed the private logical package to `kit` and the command to
  `kit`.
- Isolated generic UI authoring under `kit/ui`.
- Added awaited `Promise.all`, `Promise.race`, and `Promise.allSettled` to the
  portable TypeScript profile with canonical source-order semantics and
  JavaScript/generated-Rust differential evidence.
- Added typed durable Actors with keyed state, method calls, reminders,
  migrations, bounded admission, distribution, and generic native lowering.
- Removed the pre-release Workflow factory. Future durable orchestration can be
  built as a reusable Feature over Actors and ordinary Dependencies.
