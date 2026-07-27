import type { FeatureContract } from "@/core/feature";
import type { System } from "@/core/system";
import {
  createDeployment,
  secret,
  type DependencyBinding,
  type DeploymentAdapter,
  type DeploymentDependencies,
  type DeploymentPrograms,
} from "@/deployment";
import type { ServerProcess } from "@/platforms/server";
import type { BrowserMainThread, WebPlatform } from "@/platforms/web";

type Clock = Readonly<{ now(input: {}): number }>;
type Store = Readonly<{ read(input: { key: string }): Promise<string | undefined> }>;
type Session = Readonly<{ current(input: {}): string | undefined }>;

type Infrastructure = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Provides: { session: Session };
    };
  };
}>;

type Product = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: { clock: Clock; store: Store; session: Session };
    };
  };
}>;

type PortalFeature = Readonly<{
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: { clock: Clock };
    };
  };
}>;

type PortalApplication = Readonly<{
  Features: { portal: PortalFeature };
  Interfaces: WebPlatform;
}>;
type Contract = Readonly<{
  Features: {
    infrastructure: Infrastructure;
    product: Product;
    portal: PortalFeature;
  };
  Applications: { portal: PortalApplication };
}>;

declare const system: System<Contract>;
declare const clock: DependencyBinding<Clock>;
declare const store: DependencyBinding<Store>;
declare const session: DependencyBinding<Session>;

const lifecycle = {
  async inspect() {
    return undefined;
  },
  async apply({ plan }: Parameters<DeploymentAdapter["apply"]>[0]) {
    return {
      revision: plan.expectedRevision + 1,
      release: plan.release.digest,
      converged: true,
      artifacts: plan.artifacts,
      failures: [],
    };
  },
  async remove({ expectedRevision }: Parameters<DeploymentAdapter["remove"]>[0]) {
    return {
      revision: expectedRevision + 1,
      converged: true,
      artifacts: [],
      failures: [],
    };
  },
} satisfies Pick<DeploymentAdapter, "inspect" | "apply" | "remove">;

const local = {
  name: "local",
  configuration: { state: ".kit/deployments/local" },
  ...lifecycle,
} satisfies DeploymentAdapter<"local", { state: string }>;
const provider = {
  name: "provider",
  configuration: {
    region: "eu-central",
    credential: secret("provider/deployment"),
  },
  ...lifecycle,
} satisfies DeploymentAdapter<
  "provider",
  { region: string; credential: ReturnType<typeof secret> }
>;
const oci = {
  name: "oci",
  configuration: { architecture: "arm64" as const },
  ...lifecycle,
} satisfies DeploymentAdapter<"oci", { architecture: "arm64" | "amd64" }>;
const existing = {
  name: "existing",
  configuration: { endpoint: "https://orchestrator.internal" },
  ...lifecycle,
} satisfies DeploymentAdapter<"existing", { endpoint: string }>;
const bareMetal = {
  name: "bare-metal",
  configuration: { image: "flatcar-stable" },
  ...lifecycle,
} satisfies DeploymentAdapter<"bare-metal", { image: string }>;

const programs = {
  server: { replicas: 3 },
  browser: {},
} satisfies DeploymentPrograms<Contract>;

const dependencies = {
  clock,
  store,
} satisfies DeploymentDependencies<Contract>;

const localDeployment = createDeployment(system, {
  adapter: local,
  programs,
  dependencies,
  interfaces: {
    portal: {
      web: { hosts: ["portal.example.com"] },
    },
  },
});
const providerDeployment = createDeployment(system, {
  adapter: provider,
  programs: { server: { replicas: 2 } },
  dependencies: { clock, store },
});
createDeployment(system, { adapter: oci });
createDeployment(system, { adapter: existing });
createDeployment(system, { adapter: bareMetal });

localDeployment.adapter.name satisfies "local";
providerDeployment.adapter.name satisfies "provider";
providerDeployment.adapter.configuration.region satisfies string;

const invalidProvider = {
  name: "provider",
  configuration: {
    region: "eu-central",
    // @ts-expect-error Secret values must be created as opaque references.
    credential: { kind: "secret", name: "provider/deployment" },
  },
  ...lifecycle,
} satisfies DeploymentAdapter<
  "provider",
  { region: string; credential: ReturnType<typeof secret> }
>;
void invalidProvider;

createDeployment(system, {
  adapter: local,
  programs: {
    // @ts-expect-error Deployment Program names come from the composed System.
    worker: { replicas: 1 },
  },
});

createDeployment(system, {
  adapter: local,
  programs: {
    // @ts-expect-error Replica counts are numeric desired Process counts.
    server: { replicas: "many" },
  },
});

createDeployment(system, {
  adapter: local,
  dependencies: {
    // @ts-expect-error Feature-provided Dependencies are not host bindings.
    session,
  },
});

createDeployment(system, {
  adapter: local,
  interfaces: {
    // @ts-expect-error Interface names come from the composed System.
    unknown: { web: { hosts: ["unknown.example.com"] } },
  },
});

createDeployment(system, {
  adapter: local,
  dependencies: {
    // @ts-expect-error Unknown Dependency names cannot be bound.
    queue: store,
  },
});

createDeployment(system, {
  adapter: local,
  dependencies: {
    // @ts-expect-error Bindings retain the semantic Dependency API.
    store: clock,
  },
});

type EmptyContract = Readonly<Record<never, never>> & FeatureContract;
declare const emptySystem: System<EmptyContract>;
createDeployment(emptySystem, { adapter: local });
