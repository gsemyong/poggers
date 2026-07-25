# Portable Promise Composition

Portable Programs can now use standard Promise composition directly:

```ts
const [left, right] = await Promise.all([
  dependencies.values.read({ key: "left" }),
  dependencies.values.read({ key: "right" }),
]);
```

The supported forms are awaited `Promise.all`, `Promise.race`, and
`Promise.allSettled` over one inline array of direct portable asynchronous
function, closure, Dependency, or compiler-known resource-method calls. Do not
introduce a framework-specific parallel helper.

Operations start in source order. `all` and `allSettled` retain source order;
`race` returns the first observed settlement and requires at least one
operation. A race does not cancel its losing operations. Floating promises,
spread arrays, and promise values stored for later use remain unsupported.

System IR version 20 adds the canonical concurrent expression. Artifacts
containing older IR must be rebuilt from their TypeScript source.
