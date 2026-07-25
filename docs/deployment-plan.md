# Deployment Realization

Status: complete

Current milestone: D6 — complete

This is the living source of truth for making Kit Systems deployable without
adding deployment concepts to product code. Checked items record verified
evidence, not intention. Keep the current milestone, gap ledger, decisions,
verification evidence, and progress log accurate as implementation proceeds.

## North Star

An author defines one System from Features. Features contribute Programs and
typed Dependencies. Platform adapters develop and compile those Programs. A
Deployment adapter then realizes the resulting immutable release on a local
machine, a container runtime, bare metal, or a cloud provider:

```text
System
  |
  +-- Features
  |     `-- Programs + Dependency contracts
  |
  v
generic semantic compilation
  |
  +-- Platform adapter: server -> native Program artifacts
  +-- Platform adapter: web    -> browser/interface artifacts
  `-- future Platform adapters
  |
  v
immutable, content-addressed Release
  |
  v
Deployment definition
  |
  `-- one selected Deployment adapter
          +-- local Processes
          +-- OCI/container runtime
          +-- bare metal / Flatcar
          `-- provider implementation
```

Product source contains no machine, container, provider, replica, credential,
load balancer, or rollout vocabulary. Deployment source contains no business
logic. The same built meaning can be realized by different Deployment adapters
without modifying Features or Programs.

The first useful implementation must prove this model on one machine with
genuinely independent Processes. It must then package the same artifacts using
OCI conventions. It must not disguise a hardcoded test harness as deployment
or begin a custom cloud control plane before the contract is proven.

## Success Definition

This goal is complete only when:

- one versioned, deterministic Release manifest describes every production
  artifact and its runtime requirements without Docker or provider vocabulary;
- one minimal, type-safe Deployment definition references a System once and
  infers its Programs and public interfaces without duplicated names or magic
  strings;
- Deployment adapters implement one lifecycle contract for planning, applying,
  inspecting, and removing a Deployment; replacement and scaling use that same
  path rather than separate commands;
- credentials and secret values remain outside source, release manifests,
  plans, persisted non-secret state, and framework diagnostics;
- a local adapter runs independent OS Processes, assigns unique Process
  identities, binds shared Dependencies once, and exposes health, readiness,
  drain, logs, and observed status;
- the unchanged native server artifact runs through one-to-many-to-one replicas
  while the existing distribution layer preserves routing, ownership, fencing,
  durable state, and accepted work;
- abrupt failure, graceful drain, restart, rolling replacement, rollback, and
  dependency outage are verified;
- an autoscaling reference controller changes only desired replica count and
  is proven with deterministic metrics, bounds, hysteresis, cooldown, and safe
  scale-in;
- an OCI realization produces reproducible content-addressed image layouts
  from the same Release, and a focused compatible Linux fixture is imported
  and executed by a real OCI runtime;
- the public gateway boundary maps declared interfaces to externally reachable
  locations without moving HTTP, routing, authentication, or product protocol
  logic into deployment;
- focused iteration does not run native release compilation, containers,
  browser checks, or the complete repository gate unnecessarily;
- one final production gate proves release-profile artifacts and one complete
  repository gate preserves every existing guarantee.

## Architectural Invariants

1. `System`, `Feature`, `Program`, `Process`, `Environment`, and `Dependency`
   remain the complete product and execution substrate.
2. A Program is authored and compiled once. A Process is one running replica
   of that Program artifact.
3. Features organize product behavior. Deployment policy is not a Feature.
4. Platform adapters answer how one Platform's meaning is developed and built.
   Deployment adapters answer where and how built artifacts run.
5. Deployment never introduces a feature-specific compiler, IR node, native
   application implementation, or alternate Program API.
6. The generic TypeScript-to-native compiler remains unaware of deployment,
   Actor, Data, Workflow, container, or provider vocabulary.
7. Runtime distribution, Actor placement, sharding, ownership, leases, and
   fencing remain ordinary Dependency/runtime behavior. Deployment only
   creates, replaces, and removes Processes.
8. Shared infrastructure Dependencies are bound once per Deployment scope and
   injected into every Process that requires them. They are not instantiated
   independently per Feature.
9. A Deployment adapter may provision a Dependency or bind an existing one,
   but the semantic Dependency contract does not change.
10. OCI is a packaging and interchange standard, not Kit's deployment model.
    Docker, Podman, containerd, Compose, Flatcar, and cloud APIs are adapter
    implementation choices.
11. Desired state and observed state are distinct. Apply is idempotent,
    concurrent mutation is fenced, and status never pretends convergence.
12. Traffic is withdrawn before graceful termination. Readiness, liveness, and
    drain have distinct meanings.
13. Secret references may be present in authored Deployment configuration;
    secret values may not be serialized into release, plan, state, or framework
    diagnostic artifacts. Programs remain responsible for not logging values
    they receive.
14. Autoscaling cannot repair a hot-key serialization ceiling or unavailable
    shared Dependency. It changes Process capacity only.
15. Local verification uses the same Release and Deployment contracts as
    production. It is not a second orchestration API.
16. No raw provider manifest is a public escape hatch or competing deployment
    language.

## Existing Evidence And Gap Ledger

### Proven Foundation

- [x] One System compiler selects Programs and interfaces by Platform.
- [x] Platform adapters share one `develop` / `build` lifecycle.
- [x] Server production emits a generic native executable for each selected
      Program.
- [x] Web production emits browser/interface artifacts.
- [x] Server host Dependencies declare semantic identity, configuration
      fields, native package, native type, and constructor.
- [x] The generic distribution layer implements membership, deterministic
      placement, virtual partitions, ownership leases, fencing, drain, and
      rebalance.
- [x] The native NATS realization exposes status, readiness, capacity,
      ownership, drain, and rebalance controls.
- [x] Existing native fixtures run unchanged Programs as independent Processes
      and prove scale-out, owner loss, total NATS outage, recovery, and scale-in.
- [x] Development and production tests can already start generated artifacts
      as black-box child Processes.

### Missing Deployment Meaning

- [x] `ProductionArtifacts` carries digests, entrypoints, files, runtime
      requirements, configuration schemas, interfaces, and lifecycle controls.
- [x] A versioned Release manifest joins all Platform outputs.
- [x] Release identity is a deterministic digest of semantic input and emitted
      content.
- [x] Dependency implementation requirements are visible at the release /
      deployment handoff without leaking native implementation details into core.
- [x] There is one public Deployment definition and one adapter contract.
- [x] Deployment names, Program identities, and interface identities are
      inferred and statically checked.
- [x] Fixed replica intent is the only universal resource policy. Resource
      classes, placement, metric interpretation, DNS/TLS, and provider rollout
      controls remain in typed adapter configuration; readiness-gated
      replacement and declared interface exposure remain universal lifecycle
      semantics.
- [x] Desired replica policy and Dependency
      bindings have minimal target-independent meanings.
- [x] Secret references are modeled separately from ordinary configuration.
- [x] A deterministic planner computes create, replace, scale, and
      remove operations from desired and observed state.
- [x] Adapter state is versioned, atomically persisted, and concurrency-fenced.
- [x] The CLI can plan, apply, inspect, and remove through the same contract.
- [x] A local adapter supervises independent Processes and isolated execution
      state.
- [x] A reference autoscaler is deterministic and adapter-independent.
- [x] OCI packaging is reproducible and verified by digest.
- [x] A container runtime gate runs a compatible Linux OCI result.
- [x] Gateway/ingress realization is connected to declared Platform
      interfaces.
- [x] Rollback and compatibility behavior is defined and tested.

## Canonical Concepts

### Release

A `Release` is an immutable, versioned, content-addressed result of building
one selected System or App. It contains facts, not desired operational policy.

The canonical manifest must describe:

- System/App identity and semantic digest;
- each artifact's stable identity, Platform, Environment, kind, content digest,
  files, entrypoint, and architecture constraints;
- each Program's required Dependency contracts and configuration schema;
- public interface identities and adapter-declared protocols/endpoints;
- adapter-supported health, readiness, drain, status, and control operations;
- compatibility/version information required for rolling replacement;
- no secret values, local absolute paths, Dockerfile instructions, provider
  identifiers, or desired replica counts.

The current `ProductionArtifacts` path list is a compatibility input to this
work, not the final contract.

### Deployment

A `Deployment` is the desired realization of one Release on one selected
target. It owns operational choices:

- Process replica bounds or fixed count;
- resource reservations and limits when the adapter supports them;
- rolling replacement and rollback policy;
- public interface exposure;
- shared Dependency implementation/binding choices;
- ordinary configuration and secret references;
- optional autoscaling policy;
- target adapter and its strictly target-specific configuration.

The definition references the System once. Program and interface names are
inferred from that System and validated statically. It may override defaults
only where operational intent differs.

The exact public syntax is not frozen in this document. D0 must compare
type-level fixtures and retain the smallest form that satisfies these rules:

```ts
export default createDeployment(system, {
  programs: {
    server: {
      replicas: { minimum: 1, maximum: 4 },
    },
  },
  using: local({
    state: ".kit/deployments/local",
  }),
});
```

This is a pressure-test shape, not permission to add all shown vocabulary.
`system` appears once, `server` must be inferred from it, defaults must remove
unnecessary configuration, and adapter-specific fields belong only under the
selected adapter.

### Deployment Adapter

A Deployment adapter converts desired Deployment meaning into one target's
operations. The minimal lifecycle is:

- **plan**: compare a Release and desired policy with observed/persisted state;
- **apply**: execute a reviewed plan idempotently;
- **inspect**: return structured observed state and convergence;
- **remove**: gracefully withdraw and delete owned realization state.

Scaling and replacement are changes to desired Deployment meaning followed by
the same plan/apply path, not separate orchestration systems. Internal adapter
utilities may be richer, but the public contract must not grow one method per
provider operation.

The framework owns adapter cleanup and cancellation. Authored deployment
definitions do not receive `AbortSignal`, process handles, or lifecycle
callbacks.

### Desired And Observed State

Desired state identifies the Release and operational policy. Observed state
reports what exists now:

- active and ready Process counts;
- release/version per Process;
- health, readiness, drain, and in-flight state;
- bound Dependency and interface locations without secret material;
- pending operations and failures;
- last successful convergence and current revision.

Plan/apply use compare-and-swap or equivalent fencing on a monotonically
versioned state record. A lost deployer cannot overwrite a newer plan.

### Dependencies

Programs continue to see only semantic Dependency APIs. Deployment may:

1. bind an externally managed implementation;
2. provision an implementation owned by the Deployment adapter; or
3. use an implementation embedded by the Platform adapter.

These are realization choices for the same semantic contract. The release
manifest states requirements; the Deployment definition selects or configures
bindings; the adapter supplies values to Processes. Configuration values use
typed schemas already emitted by Platform adapters. Secrets use opaque
references resolved only during apply or Process startup.

Changing EventStore, messaging, network, or storage providers must not change
Program source. A provider that cannot satisfy a required semantic guarantee is
rejected before apply.

### Process Lifecycle And Scaling

Each running replica receives:

- the same immutable Program artifact;
- one unique Process identity;
- one deployment/cluster identity;
- compatible Dependency bindings;
- isolated temporary/execution state;
- shared durable resources where required.

The local adapter must exercise:

```text
build once
  -> start one Process
  -> establish readiness
  -> scale to three independent Processes
  -> route and preserve state
  -> drain or kill an owner
  -> recover ownership and accepted work
  -> replace a version gradually
  -> scale back to one
```

The existing distribution runtime handles placement and fencing. Deployment
must not duplicate or reinterpret its sharding algorithm.

Autoscaling is a small controller over observed capacity and desired replica
bounds. Its reference algorithm must be deterministic and testable without
Processes or containers. Local integration then proves that scale decisions
become safe Process lifecycle changes. Provider-native autoscalers may replace
the controller behind the same adapter contract.

### Gateway And Public Interfaces

Product HTTP routes, authentication, browser contracts, and protocols remain
Programs and Dependencies. A Release exposes typed interface facts. Deployment
maps selected public interfaces to addresses, TLS, load balancing, and gateway
implementations.

The first implementation needs only enough ingress meaning to:

- expose one web/interface artifact and one server HTTP interface locally;
- report canonical public locations;
- route only to ready Processes;
- stop routing before drain.

Managed DNS, certificate issuance, CDN policy, WAF policy, and multi-region edge
orchestration remain future adapter concerns.

## Contract And File Organization

Keep implementation units substantial and architecture-shaped:

```text
src/
  contracts/
    platform.ts             Platform build/development contract
    deployment.ts           Deployment adapter contract
  deployment.ts             Release, desired/observed state, planning semantics
  realization.ts            System -> Platform artifact coordination
  adapters/
    deployment/
      local.ts              independent local Process realization
      oci.ts                OCI packaging/runtime realization
```

Tests remain beside their implementation. Add a directory only when an adapter
has multiple cohesive implementation units; do not split every type, planner,
operation, or lifecycle phase into a separate file.

Platform-specific release metadata originates in each Platform adapter.
Target-specific execution belongs under `adapters/deployment`. Generic release
and plan meaning does not move into server, web, Actor, or Feature directories.

## Milestones

### D0 — Contract Pressure Test

- [x] Inventory every fact currently available to `buildSystem`, server/web
      build adapters, Dependency descriptors, distribution controls, and tests.
- [x] Write type-only fixtures for one server Program, several named Programs,
      one web App plus server Programs, optional overrides, shared Dependency
      binding, secret references, and two Deployment adapters.
- [x] Falsify the proposed API against local, OCI, existing-infrastructure,
      bare-metal, and provider-managed targets.
- [x] Remove repeated System/Program names, magic strings, callback lifecycle,
      raw environment maps, and target leakage.
- [x] Freeze terminology and one public authoring form.

Gate:

```sh
nub run typecheck
nub exec vitest run src/deployment.spec.ts
```

No native compilation, package build, container, browser, API snapshot, or
complete repository gate belongs in D0 iteration.

### D1 — Deterministic Release

- [x] Replace path-only production output with versioned artifact metadata.
- [x] Compute content digests from emitted files and semantic identity.
- [x] Join Platform outputs into one canonical Release manifest.
- [x] Emit Dependency configuration schemas and runtime lifecycle controls.
- [x] Exclude secrets, absolute build paths, timestamps, and nondeterministic
      ordering.
- [x] Verify two identical builds produce byte-identical manifests and digests.
- [x] Preserve existing `kit build` behavior while exposing the manifest.

Gate:

```sh
nub exec vitest run src/realization.spec.ts \
  src/adapters/server/adapter.spec.ts \
  src/adapters/web/adapter.spec.ts
```

Use debug native compilation only for the one fixture whose executable metadata
must be inspected.

### D2 — Deployment Contract And Planner

- [x] Add the minimal Deployment definition and adapter SPI.
- [x] Validate Deployment definitions against Release requirements.
- [x] Implement deterministic desired/observed diff planning.
- [x] Make apply idempotent and state revisions concurrency-fenced.
- [x] Model opaque secret references and redact every diagnostic form.
- [x] Define structured operation, status, convergence, and failure results.
- [x] Add the one CLI path for plan/apply/status/remove.
- [x] Export only the reviewed public contract.

Gate:

```sh
nub run typecheck
nub exec vitest run src/deployment.spec.ts src/cli.spec.ts
```

Run `nub run api:check` only after the public shape is intentionally updated.

### D3 — Local Process Adapter

- [x] Build each Program once and start replicas from that artifact.
- [x] Allocate unique Process identities, runtime directories, and log
      streams.
- [x] Resolve each Release Dependency binding once per apply and inject the
      resulting process configuration into every requiring replica.
- [x] Implement health, readiness, graceful drain, force stop,
      status, and cleanup.
- [x] Persist adapter state outside temporary Process execution directories.
- [x] Recover or reconcile after the deploying CLI itself restarts.
- [x] Prove apply and remove are repeatable without leaked Processes.
- [x] Reuse the local adapter in black-box testing instead of maintaining a
      deployment-shaped test harness.

Gate:

```sh
nub exec vitest run src/adapters/deployment/local.spec.ts
```

One generated debug executable is shared by the topology scenarios. Separate
executables are allowed only when compilation isolation is itself under test.

### D4 — Distribution, Rollout, And Autoscaling

- [x] Drive the existing distribution control plane through the local adapter.
- [x] Prove one-to-three-to-one scaling with unchanged Program source.
- [x] Prove readiness-gated traffic and graceful drain before termination.
- [x] Prove abrupt owner loss, Dependency outage, recovery, and no stale-owner
      commit.
- [x] Prove rolling compatible replacement and blocked incompatible
      replacement.
- [x] Implement deterministic replica reconciliation with min/max, cooldown,
      bounded steps, unavailable-capacity handling, and safe scale-in. Metric
      interpretation remains adapter/provider-specific.
- [x] Property-test policy bounds and unavailable-capacity behavior.
- [x] State the hot-key and shared-Dependency limits honestly.

Gate:

```sh
nub exec vitest run src/adapters/deployment/local.spec.ts \
  src/runtime/distribution.spec.ts
```

The genuine NATS multi-Process fixture runs once at milestone closure, not
after ordinary TypeScript edits.

### D5 — OCI Realization

- [x] Produce a standards-conforming OCI image layout from Release artifacts.
- [x] Use content-addressed blobs, canonical configuration, explicit
      architecture/OS, non-root execution where supported, and minimal layers.
- [x] Keep Process configuration and secrets out of image layers.
- [x] Keep runtime configuration out of image content so a concrete Deployment
      adapter can resolve bindings and secrets at Process startup.
- [x] Verify reproducibility and validate every descriptor digest and size.
- [x] Run a focused local container smoke using an installed OCI-compatible
      engine.
- [ ] Future: prove the same scale/drain/status contract through a container
      Deployment adapter. This is not part of the current local/OCI foundation.
- [x] Do not install a container desktop or virtualization stack merely for a
      packaging test. The optional runtime was installed through Mise on a
      compatible host and was not added to the cross-platform project template.

Gate:

```sh
nub exec vitest run src/adapters/deployment/oci.spec.ts
```

Container execution runs only when OCI/deployment realization changes or at
the production gate.

### D6 — Gateway And Production Closure

- [x] Bind declared interfaces to local public locations.
- [x] Route only to ready Processes and withdraw before drain.
- [x] Verify web and server artifacts are jointly represented by one Release.
- [x] Verify restart, rollback, state reconciliation, and complete removal.
- [x] Document how future bare-metal/Flatcar and provider adapters consume the
      same Release and Deployment contracts.
- [x] Remove superseded deployment-shaped helpers and experimental residue.
- [x] Review file organization, public exports, diagnostics, and documentation.
- [x] Record focused timing and retained operational limitations.

Focused production gate:

```sh
nub run build
KIT_NATIVE_PROFILE=release nub exec vitest run \
  src/adapters/deployment/local.spec.ts \
  src/adapters/deployment/oci.spec.ts
```

Complete repository gate, once after the focused production gate is stable:

```sh
nub run check
git diff --check
```

Browser verification runs only if public web locations, generated browser
assets, or gateway behavior changed.

## Verification Strategy

### Fast Inner Loop

- pure release/planner and type-level tests;
- root TypeScript checking;
- targeted adapter tests;
- no package build unless emitted package shape changed;
- no Rust for authored Deployment or planner changes;
- no browser for headless deployment changes.

### Milestone Checks

- debug native executable for local multi-Process behavior;
- real NATS only for distribution/failure milestones;
- OCI validation and container execution only for OCI changes;
- API snapshot only for deliberate public API changes;
- example checks only when public types or example source changes.

### Production And Release

- one release-profile native artifact;
- deterministic release digest;
- clean-state deploy, rolling update, rollback, and removal;
- one OCI runtime smoke when a compatible target build and runtime are
  available;
- complete repository gate once.

All failures must retain enough structured evidence to distinguish build,
configuration, dependency, placement, health, rollout, and cleanup failures.

## Standards And Research Basis

The contract borrows stable meanings, not public syntax, from:

- [OCI Image Specification](https://github.com/opencontainers/image-spec) for
  content-addressed portable image artifacts;
- [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec)
  for digest-addressed distribution;
- [Compose Specification](https://github.com/compose-spec/compose-spec) for a
  single-machine reference vocabulary around services, health, dependencies,
  secrets, and replica counts;
- [Nomad job and update specifications](https://developer.hashicorp.com/nomad/docs/job-specification)
  as a pressure test for readiness, drain, rolling updates, health deadlines,
  resources, placement, and observed lifecycle;
- [NATS monitoring and system services](https://docs.nats.io/running-a-nats-service/nats_admin/monitoring)
  for the shared messaging Dependency's health and operational evidence;
- [Flatcar provisioning](https://www.flatcar.org/docs/latest/provisioning/) for
  a future declarative immutable-host adapter using Ignition.

None of these systems is a required public dependency of the Deployment
contract.

## Non-Goals

- Kubernetes support or Kubernetes-shaped core concepts.
- A custom multi-machine scheduler or cloud control plane in the first
  implementation.
- Provisioning real cloud resources or accepting cloud credentials.
- Managing DNS, CDN, WAF, certificate issuance, billing, or provider accounts.
- Replacing NATS, the generic distribution runtime, or Actor placement.
- Embedding topology or scaling policy in Feature/Program source.
- Recompiling TypeScript separately for each replica.
- Translating deployment configuration into product Rust code.
- Claiming multi-region consensus, zero-downtime incompatible upgrades, or
  exactly-once external effects.
- Raw Dockerfiles, Compose YAML, Terraform, provider manifests, shell hooks, or
  environment maps as a second public deployment API.
- Treating Flatcar or containers as the only production realization.

## Progress Log

- 2026-07-25: Confirmed the pre-deployment repository is clean at
  `851c9b0`, with the Workflow implementation removed and generic
  TypeScript-to-native translation protected from Actor/Workflow vocabulary.
- 2026-07-25: Audited Platform build output, server/web adapters, native
  Dependency descriptors, CLI, local black-box testing, NATS distribution,
  Process controls, and existing multi-replica native fixtures.
- 2026-07-25: Confirmed no container engine is currently installed; local
  Process realization is therefore the first executable proof, while OCI
  packaging and runtime verification remain a focused later milestone.
- 2026-07-25: Standards review supported a separate Deployment adapter
  boundary and an immutable Release manifest rather than extending Platform
  adapters or exposing Docker/provider syntax.
- 2026-07-25: Closed D0 with one `createDeployment(system, definition)`
  authoring form. Recursive Program names and external Dependency bindings are
  inferred from the System; Feature-provided Dependencies are excluded; adapter
  configuration remains adapter-owned; secret references are opaque; and
  local, OCI, existing-infrastructure, bare-metal, and provider configurations
  require no target vocabulary in core. Root type checking and the five
  focused authoring tests pass without a package build, Rust, NATS, a
  container, or a browser.
- 2026-07-25: Closed D1 with a versioned Release manifest emitted by the normal
  `buildSystem` path. The manifest contains canonical release-relative files,
  SHA-256 content and artifact identities, Platform and Environment ownership,
  entrypoints, external Dependency names, adapter runtime configuration,
  graceful shutdown controls, and native target information. Equivalent
  outputs with different adapter/configuration ordering produce equal
  manifests; payload changes alter the correct digests; duplicate identities,
  escaped paths, and invalid entrypoints fail sealing. Root type checking and
  23 focused Release, realization, server, and web adapter tests pass.
- 2026-07-25: Closed D2 with deterministic desired/observed planning, typed
  target and Dependency configuration, opaque secret references, revision
  fencing, convergence validation, idempotent apply/remove, reviewed package
  exports, and one `kit deploy` path for plan, apply, status, and removal.
  Root type checking and 33 focused Release, planner, adapter, and CLI tests
  pass; the public API manifest records `changes/deployment.md`.
- 2026-07-25: Began D3 with the local adapter. Its focused black-box fixture
  proves independent detached Processes, unique identities and execution
  directories, persisted recovery, scale-out, abrupt-loss healing,
  replacement, stale-revision rejection, secret resolution without
  persistence, graceful removal, and repeatable cleanup.
- 2026-07-25: Closed D3. Runtime configuration now carries semantic
  process-port and built-asset sources, allowing the local adapter to allocate
  unique replica locations, inject interface artifacts into the native HTTP
  host, and report public interface locations without hardcoded environment
  names. Replacement starts and verifies candidates before draining old
  replicas; failed candidates are cleaned up while the old set remains. Three
  focused local tests cover concurrent revision fencing, restart recovery,
  logs, readiness, scale, abrupt loss, secret safety, replacement, and
  cleanup.
- 2026-07-25: Began D4 with an adapter-independent replica reconciler. It takes
  a metric-specific recommendation and applies only universal safety policy:
  bounds, cooldown, bounded steps, and blocked scale-in while capacity is
  unavailable. Unit and property tests keep metric vocabulary out of core.
- 2026-07-25: Closed D4. A real portable Actor Program is compiled once and
  driven through the local Deployment adapter across one-to-three scaling,
  typed Dependency rebinding, forced Process loss and healing, and scale-in.
  The separate native NATS conformance fixture proves distribution, fencing,
  owner loss, total transport outage, recovery, mixed versions, and drain. The
  generic compiler contains no Actor, Deployment, NATS, OCI, or provider
  lowering; an accidental Node-backed Deployment import was removed from the
  root product entry point.
- 2026-07-25: Began D5. OCI packaging emits one
  minimal deterministic layer per Process artifact, includes only explicitly
  required interface assets, runs as a non-root identity, omits runtime
  configuration and secrets, and verifies every descriptor digest and size.
  The host initially had neither a Linux Rust target nor an OCI engine, so
  structural conformance was kept distinct from runtime evidence.
- 2026-07-25: Began D6 with an adapter-owned local gateway. Declared interface
  artifacts receive stable public locations; requests stream to ready Process
  targets or fall back to immutable static assets. Target configuration changes
  before old Processes drain, and public locations survive scaling,
  replacement, recovery, and rollback. The authenticated CRUD production
  Release was exercised through that gateway with styling, navigation,
  authentication, mutation, and durable data surviving full removal and
  redeployment.
- 2026-07-25: Re-reviewed the public vocabulary. Fixed replica count,
  Dependency binding, declared interfaces, and desired/observed lifecycle are
  the complete target-independent deployment meaning currently justified by
  evidence. Resource classes, provider placement, metrics, DNS/TLS, and
  provider rollout controls remain typed adapter configuration instead of
  speculative core concepts.
- 2026-07-25: Closed D5 with a real OCI runtime gate. A static Linux fixture
  built for the host architecture is sealed as an ordinary Release, packaged
  by the same deterministic OCI realization, imported into Apple `container`,
  executed as the declared non-root user, and removed. The warm gate takes
  about two seconds. Apple `container` remains an optional Mise-installed
  verifier rather than a framework or starter-template dependency.
- 2026-07-25: Closed D6 and the deployment foundation. Focused
  deployment/architecture checks take about ten seconds, the warm
  release-profile native distribution gate about four seconds, production
  authenticated CRUD deployment about four seconds, and the complete
  repository gate 171 seconds. The complete gate passed 61 test files and 575
  tests plus all native workspace, package, example, API, Presentation,
  distribution, and production checks. A general Linux application target,
  multi-machine scheduler, and provider/container Deployment adapters remain
  explicit future packages rather than hidden claims of this goal.
