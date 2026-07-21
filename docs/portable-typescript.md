# Portable TypeScript

Poggers accepts a deliberately small TypeScript profile for code that must run through more than
one backend. TypeScript supplies syntax, inference, and resolved symbols. The Poggers IR, rather
than JavaScript, defines the runtime meaning.

## Boundary

Portable code may contain:

- `boolean`, IEEE-754 binary64 `number`, Unicode `string`, `null`, and `undefined` represented by
  an optional value;
- immutable records, tuples, arrays, and string-literal unions;
- local `const` and `let` bindings;
- record and array construction, property reads, arithmetic, comparisons, boolean operators, and
  string concatenation;
- `if`, bounded `for...of`, and `return`;
- statically resolved calls to authored pure portable functions, including specialized generic
  helpers;
- declared Capability calls, synchronously or with `await`.

Static imports are allowed when every reachable value is portable. Types erased by TypeScript do
not become runtime dependencies.

Tagged unions, recursive values, streams, cancellation, concurrent tasks, persistent Program
state, and resource-valued Capability operations are not in profile v0. Their contracts may be
extracted as application meaning, but a native backend must reject executable code that depends on
semantics not yet represented by IR.

The profile excludes ambient globals, dynamic imports and property access, classes, prototypes,
reflection, exceptions, `eval`, generators, shared mutable module state, and unbounded JavaScript
coercion. UI implementations are platform-native source and are not portable in this profile.
Unsupported portable code is classified with a source-located diagnostic in Application IR;
native generation rejects that classification and never falls back to executing application
source. Invalid authority, contracts, or unresolved symbols remain immediate compile errors.

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
- `for...of` iterates arrays from index zero to length minus one. A loop observes the
  immutable value captured when it starts.
- A function returns `void` when control reaches the end. `return` exits only the current function.
- Profile v0 rejects local-name shadowing, which keeps lexical binding identity identical in every
  backend without exposing generated names.
- Capability arguments are evaluated before the call. An awaited call resumes with its declared
  result or a structured Capability failure. A synchronous call must not return a promise.
- Capability operations are the only authority/effect boundary. Pure helpers and local data
  structures lower directly.
- Resources acquired through future resource-valued Capability operations are owned by the current
  Program activation and disposed in reverse acquisition order. Resource values are not part of
  profile v0 until this shape is represented explicitly in IR.

## Translation

The frontend resolves symbols and generic substitutions with the TypeScript compiler API, then
lowers executable meaning statement by statement:

```text
typed TypeScript AST -> canonical Poggers IR -> JavaScript or native backend
```

This is not textual TypeScript-to-Rust rewriting. Backends may inline, monomorphize, or otherwise
optimize the IR, but must preserve its canonical observations: returned value, Capability request
order and data, structured failure, final state, and resource disposal order.

## Diagnostics

Every executable IR node carries its TypeScript source span and resolved result type. Frontend
classification is explicit:

- `portable`: completely represented by canonical IR;
- `platform-ui`: intentionally native to a UI adapter;
- `host-source`: valid JavaScript host logic outside the current portable profile, carrying the
  diagnostic that prevents native realization.

Adding syntax requires first specifying its canonical meaning, then differential tests for every
backend. Backend convenience is not sufficient reason to broaden the language.
