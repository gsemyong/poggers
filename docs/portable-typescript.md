# Portable TypeScript

Kit accepts a deliberately small TypeScript profile for code that must run through more than
one backend. TypeScript supplies syntax, inference, and resolved symbols. The Kit IR, rather
than JavaScript, defines the runtime meaning.

## Boundary

Portable code may contain:

- `boolean`, IEEE-754 binary64 `number`, Unicode `string`, `null`, and `undefined` represented by
  an optional value;
- immutable records, tuples, arrays, and string-literal unions;
- local `const` and `let` bindings;
- record and array construction, property reads, arithmetic, comparisons, boolean operators, and
  string concatenation;
- `if`, `while`, numeric `for`, array `for...of`, stream `for await...of`, `return`, `throw`, and
  `try`/`catch`/`finally`;
- local assignment and array `push`;
- statically resolved calls and closures over authored portable functions, including specialized
  generic helpers;
- awaited `Promise.all`, `Promise.race`, and `Promise.allSettled` over one inline array of direct
  portable asynchronous function, closure, Dependency, or compiler-known resource-method calls;
- structured errors and declared Dependency calls, synchronously, with `await`, or as streams.

Static imports are allowed when every reachable value is portable. Types erased by TypeScript do
not become runtime dependencies.

Recursive data values, a generic cancellation primitive, independently detached tasks,
persistent Program-local state, generators, and general resource-valued operations are not in
profile v0. A Feature factory may expose a typed lifecycle value with compiler-known meaning;
Workflow cancellation branches are one such value and still lower through ordinary portable
callbacks. Unsupported resource shapes are rejected.

The profile excludes ambient globals, dynamic imports and property access, classes, prototypes,
reflection, `eval`, generators, shared mutable module state, and unbounded JavaScript
coercion. UI implementations are Platform-owned source and are not portable in this profile.
Unsupported Program code is classified with a source-located diagnostic in System IR. A Platform
whose production backend requires portable meaning must reject that classification during
semantic compilation, before starting development or invoking its native toolchain. The shipped
server Platform does so. A Platform such as web may deliberately own TypeScript source for its
runtime. Production generation never silently falls back to executing application source.
Invalid authority, contracts, or unresolved symbols remain immediate compile errors.

## Canonical Semantics

- Evaluation is strict and left to right. Record fields and array items preserve source order.
- Numbers use IEEE-754 binary64 behavior. `NaN`, infinities, and signed zero are preserved by the
  execution model. Cross-process conformance traces encode them as `{ "$number": "nan" }`,
  `positive-infinity`, `negative-infinity`, or `negative-zero` rather than letting JSON collapse
  them.
- `+` accepts either two numbers or two strings. It never performs implicit conversion.
- Arithmetic and ordered comparison accept numbers. Numeric equality follows IEEE comparison
  (`NaN` is unequal to itself and signed zeroes are equal). Equality compares records and arrays
  structurally rather than using JavaScript object identity.
- Conditions and boolean operators accept booleans. There is no general truthiness conversion.
- Property access requires a declared field on a record or tuple. Missing fields are not silently
  converted to `undefined`.
- `for...of` iterates an array snapshot from index zero to length minus one. `for await...of`
  advances one declared asynchronous stream in delivery order.
- `while` evaluates one boolean condition before every iteration. It has no
  backend-specific scheduling or implicit yield point.
- A function returns `void` when control reaches the end. `return` exits only the current function.
- Profile v0 rejects local-name shadowing, which keeps lexical binding identity identical in every
  backend without exposing generated names.
- Dependency arguments are evaluated before the call. An awaited call resumes with its declared
  result or a structured Dependency failure. A synchronous call must not return a promise.
- A portable Promise composition evaluates and starts its operations in source order.
  `Promise.all` returns values in source order and rejects on the first observed rejection.
  `Promise.race` returns the first observed settlement and rejects an empty input at compilation.
  `Promise.allSettled` returns source-ordered standard `fulfilled` or `rejected` records. Losing or
  no-longer-awaited operations continue unless the owning product language explicitly cancels
  them.
- Portable Promise composition is always awaited and accepts one inline array without spreads.
  Each item must directly call a portable function, closure, Dependency operation, or
  compiler-known asynchronous resource method. Floating promises and general promise-valued data
  remain outside the profile.
- Dependency operations are the only authority/effect boundary. Pure helpers and local data
  structures lower directly.
- Owned resources returned by a Program or Feature-provided Dependency are disposed exactly once
  in reverse acquisition order.

## Translation

The frontend resolves symbols and generic substitutions with the TypeScript compiler API, then
lowers executable meaning statement by statement:

```text
typed TypeScript AST -> canonical Kit IR -> development or production backend
```

This is not textual TypeScript-to-Rust rewriting. Backends may inline, monomorphize, or otherwise
optimize the IR, but must preserve its canonical observations: returned value, Dependency request
order and data, structured failure, final state, and resource disposal order.

## Diagnostics

Every executable IR node carries its TypeScript source span and resolved result type. Frontend
classification is explicit:

- `portable`: completely represented by canonical IR;
- `platform-ui`: intentionally owned by a UI adapter;
- `host-source`: valid target source outside the current portable profile,
  carrying the diagnostic a portable-only adapter must reject.

Adding syntax requires first specifying its canonical meaning, then differential tests for every
backend. Backend convenience is not sufficient reason to broaden the language.
