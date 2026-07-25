kind: feature
summary: Add a reusable local-first Data Feature factory.

# Data Feature

`createData` defines authorized event-sourced records with typed queries,
full-text search, live result streams, and local Turso projections. Its browser
Feature retains optimistic Entity reconciliation while its server Feature
enforces principal-scoped authorization.

The factory provides semantic Dependencies to other Programs and keeps storage,
events, synchronization, and Turso APIs behind Platform Adapters.
