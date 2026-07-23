kind: feature
summary: Add reusable local-first Data and durable Workflow Feature factories.

# Data And Workflow Features

`createData` defines authorized event-sourced records with typed queries,
full-text search, live result streams, and local Turso projections. Its browser
Feature retains optimistic Entity reconciliation while its server Feature
enforces principal-scoped authorization.

`createWorkflow` defines procedural durable workflows with typed Dependencies,
retries, timers, signals, queries, cancellation, history replay checks, and
single-writer recovery.

Both factories provide semantic Dependencies to other Programs and keep
storage, journals, timers, leases, and Turso APIs behind Platform Adapters.
