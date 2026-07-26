# Changes

This is the single history of externally observable framework changes. Update
it whenever public behavior, declarations, generated artifacts, or migration
requirements change.

## Unreleased

- Added a typed durable Actor Feature with keyed state, methods, reminders,
  migrations, bounded admission, distribution, and generic native lowering.
- Added a reusable local-first Data Feature with authorized event-sourced
  records, typed queries, full-text search, and live results.
- Added deterministic Releases and one type-safe Deployment lifecycle.
- Made reusable factory results directly mountable Features with inferred
  semantic metadata and Feature-owned providers.
- Replaced the single-Application model with one System containing reusable
  Feature-composed Apps and platform interfaces.
- Removed redundant authoring and configuration surfaces while retaining the
  Program, Feature, System, and adapter architecture.
- Renamed the private logical package to `kit` and the command to
  `kit`.
- Isolated generic UI authoring under `kit/ui`.
- Added ordered System revisions for safe adapter hot replacement.
- Added awaited `Promise.all`, `Promise.race`, and `Promise.allSettled` to the
  portable TypeScript profile with canonical source-order semantics and
  JavaScript/generated-Rust differential evidence.
- Required server Programs to lower completely through portable TypeScript
  instead of falling back to development-only JavaScript execution.
- Added semantic Presentation condition, container, grid, scroll, and
  typography composition.
- Removed the pre-release Workflow factory. Future durable orchestration can be
  built as a reusable Feature over Actors and ordinary Dependencies.
- Organized Features, Platforms, adapters, deployment, and Rust providers by
  semantic ownership, and added reusable Dependency conformance suites for
  development and production providers.
- Consolidated project creation around one shared scaffold and selectable,
  executable example Systems.
