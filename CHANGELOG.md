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
- Made Workflow identity compiler-derived, normalized Workflow callbacks to
  one object argument, and moved retry policy to typed Dependency operations.
- Added durable deferred Activity completion through the generic Dependency
  provider envelope, with restart-safe and idempotent Workflow completion in
  JavaScript and generated Rust.
- Added typed external Activity heartbeat and failure commands with durable
  retry context and JavaScript/generated-Rust differential evidence.
- Added canonical relative and absolute Workflow timers plus durable pure
  conditions, deterministic Workflow time, and composable timer replacement
  with restart and JavaScript/generated-Rust differential evidence.
- Added awaited `Promise.all`, `Promise.race`, and `Promise.allSettled` to the
  portable TypeScript profile with canonical source-order semantics and
  JavaScript/generated-Rust differential evidence.
- Added Workflow protocol 8 cancellation requests and inherited, shielded, and
  timed cancellation scopes with linked command cancellation, restart
  recovery, and JavaScript/generated-Rust differential evidence.
- Added protocol-9 Workflow execution identity, one run-aware control surface,
  and run-scoped deferred Activity completion in JavaScript and generated Rust.
