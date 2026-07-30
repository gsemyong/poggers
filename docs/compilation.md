# Compilation

## North Star

Kit compiles each distinct piece of semantic meaning once, stores it once, and
reuses it everywhere that meaning remains valid.

The optimization order is:

1. avoid work;
2. avoid duplicated meaning;
3. parallelize independent remaining work;
4. optimize the implementation of unavoidable work.

Development remains TypeScript-only. Native generation and Cargo are explicit
production or native-conformance concerns. Exact semantic cache hits invoke
neither lowering nor Cargo.

## Invariants

- Core remains unaware of Feature-factory, Platform, Actor, Workflow, web, and
  deployment-specific meaning.
- A Platform compiler owns its Program language and serializable extension IR.
- The generic portable-TypeScript frontend owns syntax and canonical execution
  semantics, not a particular Feature factory.
- Types are retained once at observable Dependency and Program boundaries.
  Internal expression types are interned, referenced compactly, and erased
  after the final backend phase that needs them.
- Shared runtime functions are represented once per Program and referenced by
  Feature contributions.
- Source spans and debug maps are optional side artifacts and never duplicate
  executable meaning.
- Generated files are immutable by content and are not rewritten when
  unchanged.
- Cache validity derives from complete semantic inputs, never timestamps.
- Cache misses and invalidation are observable and explainable.

## Target Graph

```text
source files
  -> retained TypeScript Program
  -> Feature semantic units
  -> Platform-owned contribution meaning
  -> Program-wide shared function/type/constant modules
  -> linked Program manifests
  -> development realization
  -> generated native contribution crates
  -> thin Program assembly crates
  -> production artifacts
```

Every arrow is an independently cacheable stage. Outputs are immutable and
addressed by a hash of their complete semantic inputs.

## Cache Keys

Each stage includes only the inputs that can change its output:

- normalized source meaning and imported public signatures;
- TypeScript, Kit IR, compiler-extension, and backend versions;
- resolved generic arguments and Dependency contracts;
- Platform, target, profile, and semantics-affecting compiler flags;
- shared runtime and native Dependency-provider identities.

Formatting and comments do not alter semantic identities. Implementation-only
changes do not invalidate consumers when the exported signature is stable.

## Native Organization

The generated Rust workspace uses stable compilation boundaries:

- one portable runtime crate;
- reusable Feature-factory runtime crates when their translated meaning is
  shared;
- independently versioned native Dependency-provider crates;
- content-addressed contribution crates where independent reuse outweighs
  Cargo overhead;
- thin Program assembly and executable crates.

Crate count is an empirical optimization, not a goal. The compiler may
coalesce tiny leaf contributions when benchmarks show that process and metadata
overhead exceeds incremental reuse. It must not combine independently changing
shared runtimes into every executable.

## Development Invalidation

1. Ignore duplicate notifications and unchanged content.
2. Reuse TypeScript syntax trees, module resolution, and the type checker.
3. Diagnose the changed file and TypeScript-affected dependants.
4. Compare exported semantic signatures.
5. Re-extract only invalid Feature units.
6. Reassemble cheap manifests from retained artifacts.
7. Notify only affected Platform outputs.
8. Let HMR update the smallest valid runtime boundary.

Whole-project type checking remains a milestone gate, not an HMR prerequisite.

## Verification Matrix

Correctness gates:

- clean and incremental compilations serialize to equivalent System meaning;
- compact and expanded portable IR execute identically;
- TypeScript and generated Rust produce equivalent calls, journals, results,
  failures, and disposal;
- cache corruption or incomplete identities fail closed;
- debug and release production smoke preserve the same semantics.

Work-avoidance gates:

- exact restart performs zero Feature extraction and zero native work;
- an implementation-only edit recompiles its owner but not signature-only
  consumers;
- a public contract edit invalidates exactly its typed dependants;
- a web-only edit performs no server or Rust work;
- adding a Workflow does not duplicate Actor or Workflow runtime functions;
- exact generated-Program hits do not invoke Cargo;
- unchanged generated sources retain their contents and modification times.

Size gates:

- every portable type node occurs once in its owning Program module;
- every identical portable function occurs once in its owning Program module;
- a Feature contribution stores references rather than shared runtime bodies;
- adding another trivial Workflow grows by its definition and specialization,
  not by another complete runtime;
- compiler cache manifests remain small and load artifacts lazily.

Performance measurements report cold and warm results separately for:

- root TypeScript checking;
- exact development restart;
- implementation-only Feature edit;
- public-contract edit;
- one Workflow semantic compilation;
- Workflow TypeScript/Rust conformance;
- targeted native check;
- complete repository gate;
- production release smoke.

Counts of parsed files, diagnosed files, compiled/reused Feature units, lowered
functions, generated files, Cargo invocations, and compiled crates accompany
wall-clock measurements.

## Implementation Checklist

### Compact portable meaning

- [x] Measure the original Workflow expansion and identify repeated types and
      runtime functions.
- [x] Store one recursively interned type table per portable contribution.
- [ ] Add round-trip, corruption, deterministic identity, and size tests.
- [ ] Move the type table to the Program-wide module so contributions share it.
- [ ] Erase expression types from production artifacts after Rust lowering no
      longer needs them.

### Shared Program modules

- [ ] Add a minimal Platform-extension assembly hook and opaque Program-level
      extension field.
- [ ] Let the server Platform intern identical functions, constants, types, and
      strings across contributions.
- [ ] Retain contribution-local entry points and references only.
- [ ] Prove a new Program kind still requires one extension registration and
      no edits to existing adapters.

### Incremental TypeScript

- [ ] Record file diagnostics, public signatures, Feature inputs, and work
      counters.
- [ ] Use TypeScript affected-file information instead of complete diagnostics
      for ordinary edits.
- [ ] Persist content-addressed Feature units independently.
- [ ] Keep one small compiler manifest and lazily load referenced units.
- [ ] Bound and garbage-collect unreachable artifacts.

### Native generation

- [ ] Separate shared runtime, contribution, provider, assembly, and executable
      identities.
- [ ] Do not rewrite unchanged generated files.
- [ ] Build only affected packages against one persistent target directory.
- [ ] Verify exact artifact hits bypass Cargo.
- [ ] Benchmark crate partitioning before introducing automatic coalescing.

### Product proof

- [ ] Restore Workflow to the authenticated local-first example.
- [ ] Verify cold start, warm restart, one implementation edit, one contract
      edit, HMR, synchronization, and production Rust.
- [ ] Run focused gates while iterating.
- [ ] Run the complete repository and release gates once after stabilization.

## Recorded Baseline

Before compact portable types, two Workflow definitions compiled in about
10.6 seconds and embedded roughly 336 MB of server contribution JSON. One
Workflow expanded into approximately 5.2 MB of facade meaning, 95.9 MB of
execution-runtime meaning, and 68.2 MB of schedule-runtime meaning.

The first compact-type pass retains the same behavior and reduces the
two-Workflow System IR to approximately 14.4 MB. One Workflow still carries
roughly 708 facade/runtime/schedule functions, so this is an intermediate
representation correction rather than completion.
