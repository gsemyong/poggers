kind: feature
summary: Development adapters receive ordered System revisions and finalize hot swaps safely.

# Incremental System Revisions

`SystemCompilationRevision` now includes a monotonic `revision` number. Each
adapter can independently consume one shared semantic revision exactly once,
including Systems with several interfaces on the same Platform.

Hot activations may also define `resume()`. The coordinator invokes it only
after the previous activation is disposed, allowing adapters to restore
interaction state without racing old lifecycle cleanup.
