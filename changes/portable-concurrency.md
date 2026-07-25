kind: feature
summary: Add canonical portable Promise composition across development and production backends.

# Portable Promise Composition

Portable Programs may await `Promise.all`, `Promise.race`, and
`Promise.allSettled` over one inline array of direct portable asynchronous
function, closure, Dependency, or compiler-known resource-method calls.
Operations start in source order, ordered combinators retain source order, and
a race settles from the first observed completion. Race losers continue unless
an owning product language explicitly cancels them.

The TypeScript frontend, canonical IR, JavaScript interpreter, and generated
Rust runtime share these semantics. Floating promises, spread inputs, empty
races, and general promise-valued data remain unsupported.

See
[`docs/migrations/0005-portable-concurrency.md`](../docs/migrations/0005-portable-concurrency.md).
