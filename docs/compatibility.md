# Compatibility

Kit has three compatibility boundaries:

1. **Semantic source** is the portable TypeScript accepted by the compiler.
2. **Feature APIs** are the product-facing contracts exposed by reusable
   Feature factories.
3. **Adapter contracts** connect semantic meaning to development and production
   realizations.

A supported adapter version must accept the current semantic IR version and
implement every platform contract it declares. Development and production
realizations are required to pass the same contract suites. Unsupported
portable syntax is a compilation error; it is never a silent runtime fallback.

The package is private and currently pre-1.0. Public declaration changes still
require a change record and an updated [`api.json`](api.json), so consumers can
review compatibility before updating a Git revision.
