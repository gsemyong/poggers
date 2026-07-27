# Feature Factories

A Feature is Kit's unit of vertical composition. It may contribute to several
Programs and Platforms while keeping one product concern, its Dependencies,
UI, providers, and tests together.

## Foundation

Kit's substrate has two concepts:

1. A **Program** describes executable meaning for one Environment.
2. A **Dependency** is the typed boundary through which a Program reaches
   authority outside its own implementation.

Three composition boundaries organize that meaning:

1. A **Feature** collocates Program contributions and composes child Features.
2. An **Application** declares typed Feature roles and exposes Platform interfaces.
3. A **System** is the one company-level compilation and realization root.

Platforms extend Program and Application authoring at typed adapter boundaries;
they are not another composition tree.

A reusable Feature factory is an ordinary TypeScript function built from these
concepts. It may implement a complete programming model, such as durable
Actors, without adding another compiler, runtime, or composition tree.

## Authoring

One generic model supplies semantic meaning. The implementation fills only the
behavior TypeScript cannot infer:

```ts
type Inventory = Actor<{
  Name: "inventory";
  Key: string;
  State: { available: number };
  Methods: {
    reserve: Actor.Method<{ quantity: number }, { remaining: number }>;
  };
}>;

export const inventory = createActor<Inventory>({
  state: () => ({ available: 10 }),
  methods: {
    reserve({ state, input }) {
      state.available -= input.quantity;
      return { remaining: state.available };
    },
  },
});
```

Names, operation shapes, state, inputs, results, failures, Dependencies, and
generated APIs are authored once in the generic contract. Runtime metadata must
not repeat information solely because JavaScript erases types.

Every factory:

- accepts one semantic generic contract;
- infers implementation contexts and its result from that contract;
- returns one directly mountable Feature;
- keeps child Features and generated Dependency names private;
- exposes cross-Feature interaction through a semantic typed Dependency;
- lowers portable behavior through the generic TypeScript subset;
- packages Feature-owned Dependency providers;
- exposes a focused testing fixture when direct semantic testing is useful;
- rejects persisted state or calls that do not match the current contract.

There is no `createFeatureFactory` wrapper and no compiler registry of factory
names. The compiler discovers the retained Feature contract and ordinary
Program contributions. Factory-authoring intrinsics in `kit/factory` may
materialize erased literals and schemas, but may not introduce
Feature-specific translation.

## Organization

Portable product meaning for a shipped factory remains in one TypeScript file:

```text
src/features/
  actor/
    index.ts
    feature.spec.ts
    feature.typecheck.ts
  data/
    index.ts
    feature.spec.ts
    feature.typecheck.ts
    testing.ts
```

`index.ts` owns the model, implementation projection, Program contributions,
Dependencies, state, actions, Components, public API, and lightweight fixture.
Reusable Dependency conformance belongs in `testing.ts`. Program and
Environment boundaries live in the Feature contract, not in parallel source
directories.

Artifacts that cannot live in portable TypeScript remain nested under their
semantic owner, first by Platform and then by implementation language:

```text
src/features/
  data/
    index.ts
    providers/
      server/
        rust/
          Cargo.toml
          src/lib.rs
```

Feature-owned providers stay beside the Feature. Platform-wide providers stay
under their Platform. The root `Cargo.toml` coordinates Rust verification; it
does not own product behavior.

Application workspaces use the same convention at every scale:

```text
src/
  apps/
    customer.tsx
    operations.tsx
  features/
    identity.tsx
    tasks.tsx
  presentations/
    web.ts
    ios.ts
  deployment.ts
  system.ts
  system.spec.ts       optional cross-System behavior
```

One Application occupies one file until its own semantic content justifies a
directory. The Application declares typed Feature roles and adapter-owned
interfaces over them; the System owns and resolves each concrete Feature value
once. Presentations are grouped by Platform because their authoring languages
are Platform-specific. Reusable parameters, recipes, and typed Feature
fragments stay in that Platform file until they become a genuine independently
owned design system.

Feature files are named by product meaning, such as `identity.tsx` or
`tasks.tsx`; a mechanical `feature.tsx` layer adds no information. Feature
behavior stays in adjacent Feature tests. `system.spec.ts` exists only when a
guarantee genuinely spans Programs or realizations.

## Dependencies

A Dependency is one semantic operation contract with two projections:

- Programs consume its product-facing API;
- providers implement the same operations with runtime-owned invocation
  context.

Feature providers are declared by the owning Feature and selected by Platform
adapters. A provider may include a development implementation, production
requirements, and owner-collocated native sources. A System does not maintain
a dependency-wiring file, and Platforms do not recognize Feature names.

The compiler derives operation names, modes, inputs, outputs, failures,
heartbeats, references, and exact contract identities from the Dependency
contract. Plain operation records are rejected instead of being interpreted as
Dependencies. Generated native Programs call the exact required provider
methods; a missing method fails native compilation. No Feature-specific Rust
lowering is allowed.

Development executes authored TypeScript when a provided Dependency promises a
truly synchronous operation. Async-only portable Programs may execute through
the IR interpreter. Production lowers the same Program meaning to generated
native code.

Cross-Feature communication uses Dependencies, whether the provider is local,
remote, Feature-owned, or Platform-owned. Transport, persistence, placement,
and scaling remain realizations of those contracts rather than alternate
Feature APIs.

## Testing

Factory behavior is tested through its semantic API, not through generated
Dependency names or internal Program fragments. `kit/testing` supplies the
generic lightweight Feature fixture; a factory may project a more specific
fixture from it.

Focused tests should:

- expose semantic state, actions, calls, and controlled fault points;
- inject principals, time, retries, restart, and persistence only when the
  factory owns those concepts;
- avoid HTTP, credentials, native compilation, and a complete System unless
  those boundaries are the behavior under test.

The repository-wide verification ladder and focused commands are defined once
in [`architecture.md`](./architecture.md#verification).

## Non-Goals

- no second Feature composition tree;
- no factory-name registry or Feature-specific compiler path;
- no directory per Program, Environment, Dependency, Component, or provider;
- no global service locator or application dependency-wiring file;
- no mandatory native provider when portable TypeScript is sufficient;
- no duplicate simple and advanced factory APIs.
