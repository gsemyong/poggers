kind: feature
summary: Add deterministic Releases and one type-safe Deployment lifecycle.

# Deployment

Systems now build into immutable, content-addressed Release manifests. A
Deployment binds one System to one configured adapter, with Program names and
external Dependency contracts inferred from that System.

The target-independent lifecycle plans, applies, inspects, and removes desired
state through one concurrency-fenced contract. The first local adapter realizes
the same Release as independent operating-system Processes, persists observed
state, reports readiness, recovers after adapter restart, and supports
idempotent scaling, replacement, failure healing, and removal.

`kit deploy` applies by default and supports `--plan`, `--status`, and
`--remove` without introducing target-specific commands.
