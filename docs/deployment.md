# Deployment

Kit separates product meaning from production realization:

```text
System -> Platform adapters -> immutable Release -> Deployment adapter
```

Features author Programs and semantic Dependencies. Platform adapters develop
and build each Program once. A Deployment adapter decides where the resulting
artifacts run, how many Processes exist, how external Dependencies are bound,
and where declared interfaces are reachable.

## Authoring

A workspace has one `src/deployment.ts`:

```ts
import { createDeployment } from "kit";
import { createLocalDeploymentAdapter } from "kit/adapters/deployment/local";

import system from "@/system";

export default createDeployment(system, {
  adapter: createLocalDeploymentAdapter(),
  programs: {
    api: { replicas: 3 },
  },
});
```

Program and Dependency names are inferred from the composed System. Adapter
packages construct typed Dependency bindings, so product code does not provide
environment maps, provider manifests, or transport configuration.

Use `secret("name")` when an adapter configuration or Dependency binding needs
a secret. The reference is safe to retain in source and plans; its value is
resolved only by the selected adapter.

## Lifecycle

The command surface is deliberately small:

```sh
kit deploy --plan
kit deploy
kit deploy --status
kit deploy --remove
```

`kit build` creates one deterministic, content-addressed Release. `deploy`
compares that Release and the desired definition with observed state, then
applies the resulting create, replace, scale, or remove operations. Applying
the same desired state is idempotent. Applying an older immutable Release is
the rollback path.

Every adapter implements the same lifecycle:

- inspect structured observed state;
- apply one concurrency-fenced plan;
- remove the owned realization.

Replacement candidates must become ready before old Processes are drained.
Target mismatch or failed readiness leaves the previous ready set in place.

## Adapter Boundary

The local adapter is a production-shaped single-machine realization. It runs
independent detached operating-system Processes, persists non-secret observed
state, allocates ports and storage, exposes interface gateways, and verifies
failure recovery and replica changes without a cloud account.

`kit/adapters/deployment/oci` packages the same Release into a deterministic
OCI image layout. It is a building block for container, bare-metal, and cloud
Deployment adapters, not a second deployment language.

OCI conformance has two levels. The ordinary focused test verifies canonical
layout, layer contents, target metadata, non-root execution, and every
descriptor digest without starting a container. The production runtime smoke
is opt-in and requires a compatible Linux Rust target plus a Docker-compatible
`image load`/`run` command:

```sh
KIT_OCI_RUNTIME=/path/to/container \
  nub exec vitest run src/adapters/deployment/oci.spec.ts
```

The runtime smoke compiles a minimal static Linux fixture, packages it through
the same Release-to-OCI path, imports it, executes it, checks its output, and
removes the test image. It proves the OCI realization. It does not substitute
for a Platform adapter that builds the application's Programs for Linux.

Provider adapters may provision or bind infrastructure, but Programs continue
to see only their semantic Dependency APIs. Provider-specific regions,
credentials, placement, resource classes, DNS, certificates, and autoscaling
metrics stay in the selected adapter's typed configuration. They do not enter
Features, Programs, the portable compiler, or the generic Release format.

Replica recommendation is metric-specific and adapter-owned. The framework's
`reconcileReplicas` utility applies only universal safety constraints such as
bounds, cooldown, bounded steps, and unavailable-capacity protection. A changed
replica count then follows the ordinary plan/apply path.

## Guarantees And Limits

- A Program is built once; every replica runs the same artifact with a unique
  Process identity.
- Shared state, messaging, sharding, leases, and fencing remain Dependency
  behavior. Deployment does not duplicate those protocols.
- Secret values are absent from Release manifests, plans, persisted adapter
  state, and framework diagnostics. Programs remain responsible for not logging
  values they receive.
- The local adapter proves lifecycle and distribution on one machine. It does
  not claim multi-machine scheduling, DNS, certificate issuance, cloud
  provisioning, or multi-region consensus.
- OCI packaging is reproducible and digest-verified. Running an OCI image still
  requires a compatible target artifact and an OCI runtime supplied by a
  concrete Deployment adapter.
- The current native server adapter emits for its build host. A general
  cross-target Linux production build and a multi-machine container Deployment
  adapter remain separate future work; neither is hidden inside OCI packaging.
