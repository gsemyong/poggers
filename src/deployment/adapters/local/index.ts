import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";

import type {
  DeploymentAdapter,
  DeploymentArtifactState,
  DeploymentPlan,
  DeploymentProcessState,
  DeploymentState,
  ReleaseArtifact,
} from "@/deployment";

export type LocalDeploymentConfiguration = Readonly<{
  artifacts: string;
  state: string;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
}>;

type LocalGatewayState = Readonly<{
  identity: string;
  pid: number;
  version: number;
  location: string;
  hosts: readonly string[];
  targets: readonly string[];
  logs: Readonly<{ stdout: string; stderr: string }>;
}>;

export type LocalServiceImplementation = Readonly<{
  executable: string;
  arguments(
    input: Readonly<{
      directory: string;
      features: readonly string[];
      endpoints: Readonly<Record<string, Readonly<{ host: string; port: number }>>>;
    }>,
  ): readonly string[];
}>;

type LocalServiceState = Readonly<{
  service: string;
  pid: number;
  version: string;
  endpoints: readonly Readonly<{ name: string; location: string; port: number }>[];
  logs: Readonly<{ stdout: string; stderr: string }>;
}>;

type PreparedLocalGateway = Omit<LocalGatewayState, "pid" | "targets"> &
  Readonly<{
    exposure?: ReleaseArtifact["exposure"];
    pid?: number;
    root: string;
    targets: readonly string[];
  }>;

const LOCAL_GATEWAY_VERSION = 5;

export type LocalDeploymentState = DeploymentState &
  Readonly<{
    gateways: readonly LocalGatewayState[];
    services: readonly LocalServiceState[];
  }>;

export type LocalDeploymentAdapterOptions = Readonly<{
  artifacts?: string;
  state?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  resolveSecret?(name: string): string | undefined | Promise<string | undefined>;
  services?: Readonly<Record<string, LocalServiceImplementation>>;
}>;

/** Realizes one Deployment as independent operating-system Processes. */
export function createLocalDeploymentAdapter(
  options: LocalDeploymentAdapterOptions = {},
): DeploymentAdapter<"local", LocalDeploymentConfiguration, LocalDeploymentState> {
  const configuration = Object.freeze({
    artifacts: options.artifacts ?? "dist",
    state: options.state ?? ".kit/deployments/local",
    startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000,
  });
  assertDuration(configuration.startupTimeoutMs, "startupTimeoutMs");
  assertDuration(configuration.shutdownTimeoutMs, "shutdownTimeoutMs");
  const artifacts = resolve(configuration.artifacts);
  const stateDirectory = resolve(configuration.state);
  const stateFile = resolve(stateDirectory, "state.json");

  return {
    name: "local",
    configuration,
    async inspect() {
      const state = await readState(stateFile);
      return state ? refreshState(state, stateDirectory) : undefined;
    },
    async apply({ plan }) {
      return withStateLock(stateDirectory, async () => {
        const current = await readState(stateFile);
        assertRevision(current, plan.expectedRevision);
        const observed = current ? await refreshState(current, stateDirectory) : undefined;
        const nextRevision = plan.expectedRevision + 1;
        let candidates: readonly DeploymentProcessState[] = [];
        let serviceCandidates: readonly LocalServiceState[] = [];
        try {
          const services = await realizeServices({
            plan,
            observed,
            stateDirectory,
            implementations: {
              nats: natsServiceImplementation,
              ...options.services,
            },
            startupTimeoutMs: configuration.startupTimeoutMs,
          });
          serviceCandidates = services.started;
          const gatewayPlan = await prepareGateways(plan, observed, artifacts, stateDirectory);
          const realization = await realizePlan({
            artifacts,
            gateways: gatewayPlan.desired,
            services: services.desired,
            changedServices: services.changed,
            stateDirectory,
            plan,
            observed,
            options,
          });
          candidates = realization.started;
          const activeGateways = await realizeGateways({
            desired: gatewayPlan.desired,
            stateDirectory,
            artifacts: realization.artifacts,
            startupTimeoutMs: configuration.startupTimeoutMs,
          });
          await Promise.allSettled([
            ...realization.retired.map((process) =>
              stopProcess(process, configuration.shutdownTimeoutMs),
            ),
            ...gatewayPlan.retired.map((gateway) =>
              stopGateway(gateway, configuration.shutdownTimeoutMs),
            ),
            ...services.retired.map((service) =>
              stopService(service, configuration.shutdownTimeoutMs),
            ),
          ]);
          const nextArtifacts = publicArtifactLocations(realization.artifacts, activeGateways);
          const state = deploymentState({
            revision: nextRevision,
            release: plan.release.digest,
            desired: plan.desired,
            runtime: plan.runtime,
            artifacts: nextArtifacts,
            gateways: activeGateways,
            services: services.desired,
          });
          await writeState(stateFile, state);
          return state;
        } catch (error) {
          await Promise.allSettled([
            ...candidates.map((process) => stopProcess(process, configuration.shutdownTimeoutMs)),
            ...serviceCandidates.map((service) =>
              stopService(service, configuration.shutdownTimeoutMs),
            ),
          ]);
          const state = deploymentState({
            revision: nextRevision,
            release: observed?.release,
            desired: observed?.desired,
            runtime: observed?.runtime,
            converged: false,
            artifacts: (await refreshArtifacts(observed?.artifacts ?? [], stateDirectory)).filter(
              ({ processes }) => !processes || processes.some(({ healthy }) => healthy),
            ),
            gateways: observed?.gateways ?? [],
            services: observed?.services ?? [],
            failures: [
              {
                code: "ApplyFailed",
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          });
          await writeState(stateFile, state);
          return state;
        }
      });
    },
    async remove({ expectedRevision }) {
      return withStateLock(stateDirectory, async () => {
        const current = await readState(stateFile);
        assertRevision(current, expectedRevision);
        for (const gateway of current?.gateways ?? []) {
          await stopGateway(gateway, configuration.shutdownTimeoutMs);
        }
        for (const process of current?.artifacts.flatMap(({ processes = [] }) => processes) ?? []) {
          await stopProcess(process, configuration.shutdownTimeoutMs);
        }
        for (const service of current?.services ?? []) {
          await stopService(service, configuration.shutdownTimeoutMs);
        }
        const state = deploymentState({
          revision: expectedRevision + 1,
          artifacts: [],
          gateways: [],
          services: [],
        });
        await writeState(stateFile, state);
        return state;
      });
    },
  };
}

const natsServiceImplementation: LocalServiceImplementation = Object.freeze({
  executable: "nats-server",
  arguments({ directory, endpoints }) {
    const client = endpoints.client;
    if (!client) throw new Error("The local NATS service requires a client endpoint.");
    return ["-js", "-sd", resolve(directory, "data"), "-a", client.host, "-p", String(client.port)];
  },
});

async function realizeServices(input: {
  plan: DeploymentPlan;
  observed?: LocalDeploymentState;
  stateDirectory: string;
  implementations: Readonly<Record<string, LocalServiceImplementation>>;
  startupTimeoutMs: number;
}): Promise<
  Readonly<{
    desired: readonly LocalServiceState[];
    retired: readonly LocalServiceState[];
    started: readonly LocalServiceState[];
    changed: ReadonlySet<string>;
  }>
> {
  const previous = new Map(
    (input.observed?.services ?? []).map((service) => [service.service, service]),
  );
  const desired: LocalServiceState[] = [];
  const started: LocalServiceState[] = [];
  const retired: LocalServiceState[] = [];
  const changed = new Set<string>();
  try {
    for (const requirement of input.plan.services) {
      const current = previous.get(requirement.service);
      previous.delete(requirement.service);
      const version = JSON.stringify(requirement);
      if (current?.version === version && (await serviceAvailable(current))) {
        desired.push(current);
        continue;
      }
      changed.add(requirement.service);
      if (current) retired.push(current);
      const implementation = input.implementations[requirement.service];
      if (!implementation) {
        throw new Error(
          `Local Deployment has no implementation for required service ${JSON.stringify(requirement.service)}.`,
        );
      }
      const service = await startService({
        requirement,
        implementation,
        stateDirectory: input.stateDirectory,
        startupTimeoutMs: input.startupTimeoutMs,
        version,
      });
      desired.push(service);
      started.push(service);
    }
  } catch (error) {
    await Promise.allSettled(started.map((service) => stopService(service, 1_000)));
    throw error;
  }
  for (const service of previous.values()) {
    changed.add(service.service);
    retired.push(service);
  }
  return Object.freeze({
    desired: Object.freeze(
      desired.sort((left, right) => left.service.localeCompare(right.service)),
    ),
    retired: Object.freeze(retired),
    started: Object.freeze(started),
    changed,
  });
}

async function startService(input: {
  requirement: DeploymentPlan["services"][number];
  implementation: LocalServiceImplementation;
  stateDirectory: string;
  startupTimeoutMs: number;
  version: string;
}): Promise<LocalServiceState> {
  const directory = resolve(
    input.stateDirectory,
    "services",
    readableIdentity(input.requirement.service),
  );
  const stdoutPath = resolve(directory, "stdout.log");
  const stderrPath = resolve(directory, "stderr.log");
  await mkdir(directory, { recursive: true });
  const endpointValues = await Promise.all(
    input.requirement.endpoints.map(
      async ({ name }) =>
        [name, Object.freeze({ host: "127.0.0.1", port: await availablePort() })] as const,
    ),
  );
  const endpoints = Object.freeze(Object.fromEntries(endpointValues));
  const stdout = await open(stdoutPath, "a");
  const stderr = await open(stderrPath, "a");
  let child;
  try {
    child = spawn(
      input.implementation.executable,
      input.implementation.arguments({
        directory,
        features: input.requirement.features,
        endpoints,
      }),
      {
        cwd: directory,
        detached: true,
        env: process.env,
        stdio: ["ignore", stdout.fd, stderr.fd],
      },
    );
    await waitForSpawn(child);
  } finally {
    await Promise.all([close(stdout), close(stderr)]);
  }
  if (!child.pid) {
    throw new Error(
      `Local service ${JSON.stringify(input.requirement.service)} did not expose a pid.`,
    );
  }
  child.unref();
  try {
    await Promise.all(
      Object.values(endpoints).map(({ host, port }) =>
        waitForTcp(host, port, child.pid!, input.startupTimeoutMs),
      ),
    );
  } catch (error) {
    await stopService(
      {
        service: input.requirement.service,
        pid: child.pid,
        version: input.version,
        endpoints: [],
        logs: { stdout: stdoutPath, stderr: stderrPath },
      },
      1_000,
    );
    throw error;
  }
  return Object.freeze({
    service: input.requirement.service,
    pid: child.pid,
    version: input.version,
    endpoints: Object.freeze(
      input.requirement.endpoints.map(({ name, scheme }) => {
        const endpoint = endpoints[name]!;
        return Object.freeze({
          name,
          port: endpoint.port,
          location: `${scheme}://${endpoint.host}:${endpoint.port}`,
        });
      }),
    ),
    logs: Object.freeze({ stdout: stdoutPath, stderr: stderrPath }),
  });
}

async function waitForTcp(
  host: string,
  port: number,
  pid: number,
  timeoutMs: number,
): Promise<void> {
  const started = performance.now();
  while (performance.now() - started <= timeoutMs) {
    if (!processAlive(pid)) throw new Error(`Service process ${pid} exited before becoming ready.`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Service endpoint ${host}:${port} did not become ready.`);
}

async function stopService(service: LocalServiceState, timeoutMs: number): Promise<void> {
  await stopProcess(
    {
      id: `service/${service.service}`,
      pid: service.pid,
      status: "ready",
      healthy: true,
      ready: true,
      version: service.version,
      shutdown: "SIGTERM",
    },
    timeoutMs,
  );
}

async function serviceAvailable(service: LocalServiceState): Promise<boolean> {
  if (!processAlive(service.pid)) return false;
  const endpoints = await Promise.all(
    service.endpoints.map(
      ({ port }) =>
        new Promise<boolean>((resolve) => {
          const socket = createConnection({ host: "127.0.0.1", port });
          const timeout = setTimeout(() => {
            socket.destroy();
            resolve(false);
          }, 100);
          socket.once("connect", () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => {
            clearTimeout(timeout);
            socket.destroy();
            resolve(false);
          });
        }),
    ),
  );
  return endpoints.every(Boolean);
}

async function realizePlan(input: {
  artifacts: string;
  gateways: readonly PreparedLocalGateway[];
  services: readonly LocalServiceState[];
  changedServices: ReadonlySet<string>;
  stateDirectory: string;
  plan: DeploymentPlan;
  observed?: DeploymentState;
  options: LocalDeploymentAdapterOptions;
}): Promise<
  Readonly<{
    artifacts: readonly DeploymentArtifactState[];
    retired: readonly DeploymentProcessState[];
    started: readonly DeploymentProcessState[];
  }>
> {
  const desired = new Set(input.plan.artifacts.map(({ identity }) => identity));
  const retired: DeploymentProcessState[] = [];
  for (const artifact of input.observed?.artifacts ?? []) {
    if (desired.has(artifact.identity)) continue;
    retired.push(...(artifact.processes ?? []));
  }

  const observed = new Map(
    (input.observed?.artifacts ?? []).map((artifact) => [artifact.identity, artifact]),
  );
  const release = new Map(
    input.plan.release.artifacts.map((artifact) => [artifact.identity, artifact]),
  );
  const states: DeploymentArtifactState[] = [];
  const started: DeploymentProcessState[] = [];
  try {
    for (const desiredArtifact of input.plan.artifacts) {
      const artifact = release.get(desiredArtifact.identity);
      if (!artifact) {
        throw new Error(
          `Deployment plan references missing Release artifact ${JSON.stringify(desiredArtifact.identity)}.`,
        );
      }
      if (artifact.deployment === "asset") {
        states.push(desiredArtifact);
        continue;
      }
      assertLocalTarget(artifact);
      const previous = observed.get(artifact.identity);
      const version = localProcessVersion(artifact, input.plan.release.artifacts, input.gateways);
      const serviceChanged = artifact.configuration.some(
        ({ source }) =>
          source?.kind === "service-location" && input.changedServices.has(source.service),
      );
      const replacing = Boolean(
        previous &&
        (previous.digest !== artifact.digest ||
          (previous.processes ?? []).some((process) => process.version !== version) ||
          input.observed?.runtime !== input.plan.runtime ||
          serviceChanged),
      );
      const retained =
        previous?.digest === artifact.digest &&
        (previous.processes ?? []).every((process) => process.version === version) &&
        input.observed?.runtime === input.plan.runtime &&
        !serviceChanged
          ? (previous.processes ?? []).filter(({ healthy }) => healthy)
          : [];
      const failed = (previous?.processes ?? []).filter(({ healthy }) => !healthy);
      let processes = retained;
      const replicas = desiredArtifact.replicas ?? 1;
      while (processes.length > replicas) {
        const process = processes.at(-1)!;
        retired.push(process);
        processes = processes.slice(0, -1);
      }
      while (processes.length < replicas) {
        const replaced = failed.shift();
        const process = await startProcess({
          artifact,
          artifacts: input.artifacts,
          gateways: input.gateways,
          services: input.services,
          release: input.plan.release.artifacts,
          dependencies: input.plan.dependencies,
          stateDirectory: input.stateDirectory,
          startupTimeoutMs: input.options.startupTimeoutMs ?? 5_000,
          resolveSecret: input.options.resolveSecret,
          system: input.plan.release.system,
          version,
          ...(replaced ? { replaced } : {}),
        });
        started.push(process);
        processes = [...processes, process];
      }
      if (replacing) {
        retired.push(...(previous?.processes ?? []));
      }
      states.push(Object.freeze({ ...desiredArtifact, processes: Object.freeze(processes) }));
    }
  } catch (error) {
    await Promise.allSettled(
      started.map((process) => stopProcess(process, input.options.shutdownTimeoutMs ?? 10_000)),
    );
    throw error;
  }
  return Object.freeze({
    artifacts: Object.freeze(
      states.sort((left, right) => left.identity.localeCompare(right.identity)),
    ),
    retired: Object.freeze(retired),
    started: Object.freeze(started),
  });
}

async function startProcess(input: {
  artifact: ReleaseArtifact;
  artifacts: string;
  gateways: readonly PreparedLocalGateway[];
  services: readonly LocalServiceState[];
  release: readonly ReleaseArtifact[];
  dependencies: DeploymentPlan["dependencies"];
  stateDirectory: string;
  startupTimeoutMs: number;
  resolveSecret: LocalDeploymentAdapterOptions["resolveSecret"];
  system: string;
  version: string;
  replaced?: DeploymentProcessState;
}): Promise<DeploymentProcessState> {
  if (!input.artifact.entrypoint) {
    throw new Error(
      `Process artifact ${JSON.stringify(input.artifact.identity)} has no entrypoint.`,
    );
  }
  const id = `${readableIdentity(input.artifact.identity)}-${randomUUID()}`;
  const directory = resolve(input.stateDirectory, "processes", id);
  const statusFile = resolve(directory, "status.json");
  const stdoutPath = resolve(directory, "stdout.log");
  const stderrPath = resolve(directory, "stderr.log");
  await mkdir(directory, { recursive: true });
  const configuration = await processEnvironment(
    input.artifact,
    input.dependencies,
    {
      KIT_PROCESS_CLUSTER: input.system,
      KIT_PROCESS_ID: id,
      KIT_PROCESS_STATUS_FILE: statusFile,
      KIT_PROCESS_VERSION: input.version,
    },
    input.resolveSecret,
    input.release,
    input.artifacts,
    directory,
    input.stateDirectory,
    input.gateways,
    input.services,
    input.replaced,
  );
  const stdout = await open(stdoutPath, "a");
  const stderr = await open(stderrPath, "a");
  let child;
  try {
    child = spawn(resolve(input.artifacts, input.artifact.entrypoint), [], {
      cwd: directory,
      detached: true,
      env: { ...process.env, ...configuration.environment },
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
    await waitForSpawn(child);
  } finally {
    await Promise.all([close(stdout), close(stderr)]);
  }
  if (!child.pid) throw new Error(`Process ${JSON.stringify(id)} did not expose a pid.`);
  child.unref();
  const status = await waitForReady(
    id,
    child.pid,
    input.artifact.lifecycle?.status ? statusFile : undefined,
    input.startupTimeoutMs,
  );
  if (!status.ready) {
    await stopProcess(status, 1_000);
    throw new Error(`Process ${JSON.stringify(id)} did not become ready.`);
  }
  return Object.freeze({
    ...status,
    version: input.version,
    ...(input.artifact.lifecycle?.shutdown
      ? { shutdown: input.artifact.lifecycle.shutdown.signal }
      : {}),
    ...(configuration.locations.length
      ? { locations: Object.freeze(configuration.locations) }
      : {}),
    ...(configuration.interfaces.length
      ? { interfaces: Object.freeze(configuration.interfaces) }
      : {}),
    logs: Object.freeze({ stdout: stdoutPath, stderr: stderrPath }),
  });
}

function localProcessVersion(
  artifact: ReleaseArtifact,
  release: readonly ReleaseArtifact[],
  gateways: readonly PreparedLocalGateway[],
): string {
  const sources = artifact.configuration.flatMap(({ source }) =>
    source?.kind === "assets" ? [source] : [],
  );
  const usesGatewayLocations = artifact.configuration.some(
    ({ source }) =>
      source?.kind === "process-location" ||
      (source?.kind === "assets" && source.format === "interfaces"),
  );
  if (!sources.length && !usesGatewayLocations) return artifact.digest;
  const assets = release
    .filter(
      (candidate) =>
        candidate.deployment === "asset" &&
        sources.some(
          (source) =>
            (!source.artifact || source.artifact === candidate.kind) &&
            (!source.platform || source.platform === candidate.platform),
        ),
    )
    .map(({ identity, digest }) => ({ identity, digest }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const locations = usesGatewayLocations
    ? gateways
        .map(({ identity, location }) => ({ identity, location }))
        .sort((left, right) => left.identity.localeCompare(right.identity))
    : [];
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ artifact: artifact.digest, assets, locations }))
    .digest("hex")}`;
}

async function processEnvironment(
  artifact: ReleaseArtifact,
  dependencies: DeploymentPlan["dependencies"],
  framework: Readonly<Record<string, string>>,
  resolveSecret: LocalDeploymentAdapterOptions["resolveSecret"],
  release: readonly ReleaseArtifact[],
  artifacts: string,
  processDirectory: string,
  stateDirectory: string,
  gateways: readonly PreparedLocalGateway[],
  services: readonly LocalServiceState[],
  replaced?: DeploymentProcessState,
): Promise<
  Readonly<{
    environment: Readonly<Record<string, string>>;
    locations: readonly string[];
    interfaces: readonly Readonly<{ identity: string; location: string }>[];
  }>
> {
  const bindings = new Map(dependencies.map((dependency) => [dependency.name, dependency]));
  const environment: Record<string, string> = { ...framework };
  const locations: string[] = [];
  const reusablePorts = (replaced?.locations ?? []).flatMap((location) => {
    const port = Number(new URL(location).port);
    return Number.isSafeInteger(port) && port > 0 ? [port] : [];
  });
  const deferred: ReleaseArtifact["configuration"][number][] = [];
  for (const field of artifact.configuration) {
    const binding = bindings.get(field.dependency);
    let value = binding ? Reflect.get(binding.configuration, field.name) : undefined;
    if (value === undefined && field.allocation) {
      if (field.allocation.kind === "port") {
        value = reusablePorts.shift() ?? (await availablePort());
      } else {
        const root =
          field.allocation.scope === "deployment"
            ? resolve(stateDirectory, "storage")
            : resolve(processDirectory, "storage");
        value = resolve(root, field.allocation.name);
        await mkdir(field.allocation.type === "directory" ? value : dirname(value), {
          recursive: true,
        });
      }
    }
    if (value === undefined && field.source) {
      deferred.push(field);
      continue;
    }
    if (isSecretReference(value)) {
      const name = value.name;
      value = await resolveSecret?.(name);
      if (value === undefined) {
        throw new Error(`Deployment secret ${JSON.stringify(name)} could not be resolved.`);
      }
    }
    value ??= field.default;
    if (value === undefined) {
      if (field.required) {
        throw new Error(
          `Process ${JSON.stringify(artifact.identity)} is missing ${JSON.stringify(field.dependency)} configuration ${JSON.stringify(field.name)}.`,
        );
      }
      continue;
    }
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(
        `Process ${JSON.stringify(artifact.identity)} configuration ${JSON.stringify(field.name)} is not an environment scalar.`,
      );
    }
    environment[field.binding.name] = String(value);
    if (field.allocation?.kind === "port") {
      const host = environment.HOST ?? "127.0.0.1";
      locations.push(`http://${host}:${value}`);
    }
  }
  const interfaces = interfaceLocations(
    release.filter(
      ({ deployment, kind, platform }) =>
        deployment === "asset" &&
        deferred.some(
          ({ source }) =>
            source?.kind === "assets" &&
            (!source.artifact || source.artifact === kind) &&
            (!source.platform || source.platform === platform),
        ),
    ),
    locations[0],
  );
  for (const field of deferred) {
    const source = field.source!;
    let value: string | undefined;
    if (source.kind === "process-location") {
      value = gateways[0]?.location ?? locations[0];
    } else if (source.kind === "service-location") {
      value = services
        .find(({ service }) => service === source.service)
        ?.endpoints.find(({ name }) => name === source.endpoint)?.location;
      if (!value) {
        throw new Error(
          `Process ${JSON.stringify(artifact.identity)} requires unavailable service endpoint ` +
            `${JSON.stringify(`${source.service}.${source.endpoint}`)}.`,
        );
      }
    } else {
      const selected = release.filter(
        ({ deployment, kind, platform }) =>
          deployment === "asset" &&
          (!source.artifact || source.artifact === kind) &&
          (!source.platform || source.platform === platform),
      );
      if (source.format === "single" && selected.length === 1) {
        value = resolve(artifacts, selected[0]!.root);
      } else if (source.format === "interfaces" && selected.length > 1) {
        value = JSON.stringify(
          selected.map((asset) => ({
            identity: asset.identity,
            origin:
              gateways.find(({ identity }) => identity === asset.identity)?.location ??
              interfaces.find(({ identity }) => identity === asset.identity)?.location,
            root: resolve(artifacts, asset.root),
          })),
        );
      }
    }
    if (value !== undefined) environment[field.binding.name] = value;
  }
  return Object.freeze({
    environment: Object.freeze(environment),
    locations: Object.freeze(locations),
    interfaces: Object.freeze(interfaces),
  });
}

function interfaceLocations(
  artifacts: readonly ReleaseArtifact[],
  processLocation: string | undefined,
): readonly Readonly<{ identity: string; location: string }>[] {
  if (!processLocation) return [];
  if (artifacts.length === 1) {
    return [{ identity: artifacts[0]!.identity, location: processLocation }];
  }
  return artifacts.map(({ identity }, index) => {
    const location = new URL(processLocation);
    location.hostname = `web-${index + 1}.localhost`;
    return { identity, location: location.origin };
  });
}

async function prepareGateways(
  plan: DeploymentPlan,
  observed: LocalDeploymentState | undefined,
  artifacts: string,
  stateDirectory: string,
): Promise<
  Readonly<{
    desired: readonly PreparedLocalGateway[];
    retired: readonly LocalGatewayState[];
  }>
> {
  const previous = new Map(
    (observed?.gateways ?? []).map((gateway) => [gateway.identity, gateway]),
  );
  const interfaces = new Map(
    plan.interfaces.map((interface_) => [interface_.identity, interface_]),
  );
  const desired = await Promise.all(
    plan.release.artifacts
      .filter(({ deployment, kind }) => deployment === "asset" && kind === "interface")
      .sort((left, right) => left.identity.localeCompare(right.identity))
      .map(async (artifact, index): Promise<PreparedLocalGateway> => {
        const current = previous.get(artifact.identity);
        previous.delete(artifact.identity);
        const hosts = Object.freeze([...(interfaces.get(artifact.identity)?.hosts ?? [])]);
        const reusable =
          current?.version === LOCAL_GATEWAY_VERSION &&
          JSON.stringify(current.hosts) === JSON.stringify(hosts) &&
          processAlive(current.pid)
            ? current
            : undefined;
        const location =
          current?.version === LOCAL_GATEWAY_VERSION
            ? current.location
            : `http://${hosts[0] ?? `web-${index + 1}.localhost`}:${await availablePort()}`;
        const directory = resolve(stateDirectory, "gateways", readableIdentity(artifact.identity));
        return Object.freeze({
          identity: artifact.identity,
          version: LOCAL_GATEWAY_VERSION,
          location,
          hosts,
          root: resolve(artifacts, artifact.root),
          ...(artifact.exposure ? { exposure: artifact.exposure } : {}),
          targets: reusable?.targets ?? [],
          ...(reusable ? { pid: reusable.pid } : {}),
          logs: Object.freeze({
            stdout: resolve(directory, "stdout.log"),
            stderr: resolve(directory, "stderr.log"),
          }),
        });
      }),
  );
  const retained = new Set(desired.flatMap(({ pid }) => (pid ? [pid] : [])));
  const retired = [...previous.values(), ...(observed?.gateways ?? [])].filter(
    ({ pid }, index, gateways) =>
      !retained.has(pid) && gateways.findIndex((candidate) => candidate.pid === pid) === index,
  );
  return Object.freeze({
    desired: Object.freeze(desired),
    retired: Object.freeze(retired),
  });
}

async function realizeGateways(input: {
  desired: readonly PreparedLocalGateway[];
  stateDirectory: string;
  artifacts: readonly DeploymentArtifactState[];
  startupTimeoutMs: number;
}): Promise<readonly LocalGatewayState[]> {
  const source = resolve(input.stateDirectory, "gateway.mjs");
  await mkdir(input.stateDirectory, { recursive: true });
  await writeFile(source, localGatewaySource());
  const realized: LocalGatewayState[] = [];
  const started: LocalGatewayState[] = [];
  try {
    for (const gateway of input.desired) {
      const result = await realizeGateway(gateway, input.artifacts, source, input.startupTimeoutMs);
      realized.push(result.state);
      if (result.started) started.push(result.state);
    }
    return Object.freeze(realized);
  } catch (error) {
    await Promise.allSettled(started.map((gateway) => stopGateway(gateway, 1_000)));
    throw error;
  }
}

async function realizeGateway(
  gateway: PreparedLocalGateway,
  artifacts: readonly DeploymentArtifactState[],
  source: string,
  startupTimeoutMs: number,
): Promise<Readonly<{ state: LocalGatewayState; started: boolean }>> {
  const targets = artifacts
    .flatMap(({ processes = [] }) => processes)
    .filter(({ healthy, ready }) => healthy && ready)
    .flatMap(({ interfaces = [] }) => interfaces)
    .filter(({ identity }) => identity === gateway.identity)
    .map(({ location }) => location)
    .filter((location, index, values) => values.indexOf(location) === index)
    .sort();
  const directory = dirname(gateway.logs.stdout);
  const configuration = resolve(directory, "gateway.json");
  const status = resolve(directory, "status.json");
  await mkdir(directory, { recursive: true });
  await writeJson(configuration, {
    ...(gateway.exposure ? { exposure: gateway.exposure } : {}),
    root: gateway.root,
    targets,
  });
  let pid = gateway.pid;
  let started = false;
  if (!pid || !processAlive(pid)) {
    await rm(status, { force: true });
    const stdout = await open(gateway.logs.stdout, "a");
    const stderr = await open(gateway.logs.stderr, "a");
    let child;
    try {
      child = spawn(process.execPath, [source], {
        cwd: directory,
        detached: true,
        env: {
          ...process.env,
          KIT_GATEWAY_CONFIGURATION: configuration,
          KIT_GATEWAY_HOST: new URL(gateway.location).hostname,
          KIT_GATEWAY_PORT: new URL(gateway.location).port,
          KIT_GATEWAY_STATUS_FILE: status,
        },
        stdio: ["ignore", stdout.fd, stderr.fd],
      });
      await waitForSpawn(child);
    } finally {
      await Promise.all([close(stdout), close(stderr)]);
    }
    if (!child.pid) {
      throw new Error(`Local gateway ${JSON.stringify(gateway.identity)} did not expose a pid.`);
    }
    child.unref();
    const ready = await waitForReady(gateway.identity, child.pid, status, startupTimeoutMs);
    if (!ready.ready) {
      await stopProcess(ready, 1_000);
      throw new Error(`Local gateway ${JSON.stringify(gateway.identity)} did not become ready.`);
    }
    pid = child.pid;
    started = true;
  }
  return Object.freeze({
    started,
    state: Object.freeze({
      identity: gateway.identity,
      pid,
      version: LOCAL_GATEWAY_VERSION,
      location: gateway.location,
      hosts: gateway.hosts,
      targets: Object.freeze(targets),
      logs: gateway.logs,
    }),
  });
}

function publicArtifactLocations(
  artifacts: readonly DeploymentArtifactState[],
  gateways: readonly LocalGatewayState[],
): readonly DeploymentArtifactState[] {
  const locations = new Map(
    gateways.map((gateway) => [gateway.identity, gatewayLocations(gateway)]),
  );
  return Object.freeze(
    artifacts.map((artifact) => {
      const assigned = locations.get(artifact.identity);
      return assigned ? Object.freeze({ ...artifact, locations: assigned }) : artifact;
    }),
  );
}

function gatewayLocations(
  gateway: Pick<LocalGatewayState, "hosts" | "location">,
): readonly string[] {
  if (!gateway.hosts.length) return Object.freeze([gateway.location]);
  const base = new URL(gateway.location);
  return Object.freeze(
    gateway.hosts.map((host) => {
      const location = new URL(base);
      location.hostname = host;
      return location.origin;
    }),
  );
}

async function stopGateway(gateway: LocalGatewayState, timeoutMs: number): Promise<void> {
  await stopProcess(
    {
      id: gateway.identity,
      pid: gateway.pid,
      status: "ready",
      healthy: true,
      ready: true,
      version: String(gateway.version),
      shutdown: "SIGINT",
    },
    timeoutMs,
  );
}

async function refreshState(
  state: LocalDeploymentState,
  stateDirectory: string,
): Promise<LocalDeploymentState> {
  const artifacts = await refreshArtifacts(state.artifacts, stateDirectory);
  const processFailures = artifacts.flatMap(({ identity, processes = [] }) =>
    processes
      .filter(({ healthy, ready }) => !healthy || !ready)
      .map((process) => ({
        operation: process.id,
        code: "ProcessUnavailable",
        message: `Process ${JSON.stringify(process.id)} for ${JSON.stringify(identity)} is not ready.`,
      })),
  );
  const gateways = Object.freeze(state.gateways ?? []);
  const gatewayFailures = gateways.flatMap(({ identity, pid, version }) => {
    if (!processAlive(pid)) {
      return [
        {
          operation: identity,
          code: "GatewayUnavailable",
          message: `Local gateway for ${JSON.stringify(identity)} is unavailable.`,
        },
      ];
    }
    return version === LOCAL_GATEWAY_VERSION
      ? []
      : [
          {
            operation: identity,
            code: "GatewayOutdated",
            message: `Local gateway for ${JSON.stringify(identity)} must be replaced.`,
          },
        ];
  });
  const expectedGateways = artifacts
    .filter(({ kind }) => kind === "interface")
    .map(({ identity }) => identity);
  const missingGateways = expectedGateways
    .filter((identity) => !gateways.some((gateway) => gateway.identity === identity))
    .map((identity) => ({
      operation: identity,
      code: "GatewayMissing",
      message: `Local gateway for ${JSON.stringify(identity)} has not been realized.`,
    }));
  const services = Object.freeze(state.services ?? []);
  const serviceHealth = await Promise.all(
    services.map(async (service) => ({
      service: service.service,
      available: await serviceAvailable(service),
    })),
  );
  const serviceFailures = serviceHealth
    .filter(({ available }) => !available)
    .map(({ service }) => ({
      operation: service,
      code: "ServiceUnavailable",
      message: `Local service ${JSON.stringify(service)} is unavailable.`,
    }));
  const unavailable = [
    ...processFailures,
    ...gatewayFailures,
    ...missingGateways,
    ...serviceFailures,
  ];
  return Object.freeze({
    ...state,
    converged: state.converged && unavailable.length === 0,
    artifacts,
    gateways,
    services,
    failures: unavailable.length ? Object.freeze(unavailable) : state.failures,
  });
}

async function refreshArtifacts(
  artifacts: readonly DeploymentArtifactState[],
  stateDirectory: string,
): Promise<readonly DeploymentArtifactState[]> {
  return Promise.all(
    artifacts.map(async (artifact) =>
      artifact.processes
        ? Object.freeze({
            ...artifact,
            processes: Object.freeze(
              await Promise.all(
                artifact.processes.map((process) => refreshProcess(process, stateDirectory)),
              ),
            ),
          })
        : artifact,
    ),
  );
}

async function refreshProcess(
  process: DeploymentProcessState,
  stateDirectory: string,
): Promise<DeploymentProcessState> {
  if (!process.pid || !processAlive(process.pid)) {
    return Object.freeze({ ...process, status: "failed", healthy: false, ready: false });
  }
  const path = resolve(stateDirectory, "processes", process.id, "status.json");
  const status = await readProcessStatus(path);
  return Object.freeze({
    ...process,
    ...(status ? { status } : {}),
    healthy: true,
    ready: status ? status === "ready" : process.ready,
  });
}

async function waitForReady(
  id: string,
  pid: number,
  statusFile: string | undefined,
  timeoutMs: number,
): Promise<DeploymentProcessState> {
  const started = performance.now();
  while (performance.now() - started <= timeoutMs) {
    if (!processAlive(pid)) {
      return { id, pid, status: "failed", healthy: false, ready: false, version: "" };
    }
    const status = statusFile ? await readProcessStatus(statusFile) : undefined;
    if (status === "ready" || (!statusFile && performance.now() - started >= 50)) {
      return { id, pid, status: "ready", healthy: true, ready: true, version: "" };
    }
    if (status === "failed" || status === "stopped") {
      return { id, pid, status, healthy: false, ready: false, version: "" };
    }
    await delay(20);
  }
  return { id, pid, status: "starting", healthy: true, ready: false, version: "" };
}

async function stopProcess(state: DeploymentProcessState, timeoutMs: number): Promise<void> {
  if (!state.pid || !processAlive(state.pid)) return;
  try {
    process.kill(state.pid, state.shutdown ?? "SIGINT");
  } catch (error) {
    if (!hasCode(error, "ESRCH")) throw error;
    return;
  }
  const started = performance.now();
  while (processAlive(state.pid) && performance.now() - started <= timeoutMs) {
    await delay(20);
  }
  if (processAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGKILL");
    } catch (error) {
      if (!hasCode(error, "ESRCH")) throw error;
    }
  }
}

async function readProcessStatus(
  path: string,
): Promise<DeploymentProcessState["status"] | undefined> {
  const value = await readFile(path, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!value) return undefined;
  const status = Reflect.get(JSON.parse(value) as object, "status");
  return ["starting", "ready", "draining", "stopped", "failed"].includes(status)
    ? (status as DeploymentProcessState["status"])
    : undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    throw error;
  }
}

async function readState(path: string): Promise<LocalDeploymentState | undefined> {
  const value = await readFile(path, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  });
  if (!value) return undefined;
  const state = JSON.parse(value) as DeploymentState & Partial<LocalDeploymentState>;
  return Object.freeze({
    ...state,
    gateways: Object.freeze(state.gateways ?? []),
    services: Object.freeze(state.services ?? []),
  });
}

async function writeState(path: string, state: LocalDeploymentState): Promise<void> {
  await writeJson(path, state);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function withStateLock<Value>(
  stateDirectory: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  await mkdir(stateDirectory, { recursive: true });
  const lock = resolve(stateDirectory, "lock");
  const started = performance.now();
  while (true) {
    try {
      await mkdir(lock);
      await writeFile(resolve(lock, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      await clearStaleLock(lock);
      if (performance.now() - started > 10_000) {
        throw new Error(`Timed out waiting for local Deployment lock ${JSON.stringify(lock)}.`);
      }
      await delay(20);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function clearStaleLock(lock: string): Promise<void> {
  const owner = Number(await readFile(resolve(lock, "owner"), "utf8").catch(() => ""));
  if (Number.isSafeInteger(owner) && owner > 0 && processAlive(owner)) return;
  const metadata = await stat(lock).catch(() => undefined);
  if (metadata && Date.now() - metadata.mtimeMs < 5_000) return;
  await rm(lock, { recursive: true, force: true });
}

function assertRevision(state: DeploymentState | undefined, expected: number): void {
  if ((state?.revision ?? 0) !== expected) {
    throw new Error(
      `Stale Deployment revision ${expected}; current revision is ${state?.revision ?? 0}.`,
    );
  }
}

function deploymentState(input: {
  revision: number;
  release?: string;
  desired?: string;
  runtime?: string;
  converged?: boolean;
  artifacts: readonly DeploymentArtifactState[];
  gateways: readonly LocalGatewayState[];
  services: readonly LocalServiceState[];
  failures?: DeploymentState["failures"];
}): LocalDeploymentState {
  return Object.freeze({
    revision: input.revision,
    ...(input.release ? { release: input.release } : {}),
    ...(input.desired ? { desired: input.desired } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    converged: input.converged ?? true,
    artifacts: Object.freeze(input.artifacts),
    gateways: Object.freeze(input.gateways),
    services: Object.freeze(input.services),
    failures: Object.freeze(input.failures ?? []),
  });
}

function localGatewaySource(): string {
  return `import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer, request as createRequest } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const configurationFile = process.env.KIT_GATEWAY_CONFIGURATION;
const statusFile = process.env.KIT_GATEWAY_STATUS_FILE;
const host = process.env.KIT_GATEWAY_HOST || "127.0.0.1";
const port = Number(process.env.KIT_GATEWAY_PORT);
if (!configurationFile || !statusFile || !Number.isSafeInteger(port)) {
  throw new Error("Local gateway configuration is incomplete.");
}
let cursor = 0;

const status = async (value) => {
  const temporary = statusFile + "." + process.pid + ".tmp";
  await writeFile(temporary, JSON.stringify({ status: value, pid: process.pid }) + "\\n");
  await rename(temporary, statusFile);
};

const configuration = async () => JSON.parse(await readFile(configurationFile, "utf8"));
const publicOrigin = (incoming) => {
  const value = incoming.headers.host;
  const authority = Array.isArray(value) ? value[0] : value;
    return new URL("http://" + (authority || host + ":" + port)).origin;
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const current = await configuration();
    const url = new URL(incoming.url || "/", "http://localhost");
    const fixed = current.exposure?.responses?.find(({ path }) => path === url.pathname);
    if (fixed) {
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        outgoing.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const body = fixed.substitutions?.includes("origin")
        ? fixed.body.replaceAll("{{origin}}", publicOrigin(incoming))
        : fixed.body;
      outgoing.writeHead(fixed.status, {
        ...current.exposure?.headers,
        ...fixed.headers,
        "content-length": Buffer.byteLength(body),
      });
      if (incoming.method === "HEAD") outgoing.end();
      else outgoing.end(body);
      return;
    }
    if (current.targets.length) {
      const target = new URL(current.targets[cursor++ % current.targets.length]);
      const headers = { ...incoming.headers };
      headers["x-forwarded-host"] = incoming.headers.host || "";
      headers["x-forwarded-proto"] = "http";
      const upstream = createRequest(
        new URL(incoming.url || "/", target),
        { method: incoming.method, headers },
        (response) => {
          outgoing.writeHead(response.statusCode || 502, {
            ...response.headers,
            ...current.exposure?.headers,
          });
          response.pipe(outgoing);
        },
      );
      upstream.on("error", (error) => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end(error.message);
      });
      incoming.pipe(upstream);
      return;
    }
    let file = resolve(current.root, "." + decodeURIComponent(url.pathname));
    const boundary = relative(resolve(current.root), file);
    if (boundary === ".." || boundary.startsWith(".." + sep)) {
      outgoing.writeHead(400).end();
      return;
    }
    const metadata = await stat(file).catch(() => undefined);
    if (metadata?.isDirectory()) file = resolve(file, "index.html");
    if (
      !metadata &&
      current.exposure?.fallback &&
      (incoming.headers.accept || "").includes("text/html")
    ) {
      file = resolve(current.root, current.exposure.fallback);
    }
    const selected = await stat(file).catch(() => undefined);
    if (!selected?.isFile()) {
      outgoing.writeHead(404).end();
      return;
    }
    const types = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
      ".webmanifest": "application/manifest+json",
    };
    const immutable = /^\\/(?:assets|workers)\\/.+-[A-Za-z0-9_-]{8,}\\.[^/]+$/.test(url.pathname);
    const artifactPath = relative(current.root, file).split(sep).join("/");
    const cacheControl =
      current.exposure?.files?.find(({ path }) => path === artifactPath)?.cacheControl ??
      (immutable ? "public, max-age=31536000, immutable" : "no-cache");
    outgoing.writeHead(200, {
      ...current.exposure?.headers,
      "cache-control": cacheControl,
      "content-length": selected.size,
      "content-type": types[extname(file)] || "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (incoming.method === "HEAD") outgoing.end();
    else createReadStream(file).pipe(outgoing);
  } catch (error) {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end(error instanceof Error ? error.message : String(error));
  }
});

server.on("upgrade", async (incoming, socket, head) => {
  try {
    const current = await configuration();
    if (!current.targets.length) {
      socket.end("HTTP/1.1 503 Service Unavailable\\r\\nConnection: close\\r\\n\\r\\n");
      return;
    }
    const target = new URL(current.targets[cursor++ % current.targets.length]);
    const headers = { ...incoming.headers };
    headers["x-forwarded-host"] = incoming.headers.host || "";
    headers["x-forwarded-proto"] = "http";
    const upstream = createRequest(new URL(incoming.url || "/", target), {
      method: incoming.method,
      headers,
    });
    upstream.once("upgrade", (response, connection, upstreamHead) => {
      const responseHeaders = [];
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        responseHeaders.push(response.rawHeaders[index] + ": " + response.rawHeaders[index + 1]);
      }
      socket.write(
        "HTTP/1.1 " +
          (response.statusCode || 101) +
          " " +
          (response.statusMessage || "Switching Protocols") +
          "\\r\\n" +
          responseHeaders.join("\\r\\n") +
          "\\r\\n\\r\\n",
      );
      if (head.length) connection.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      connection.on("error", () => socket.destroy());
      socket.on("error", () => connection.destroy());
      connection.pipe(socket);
      socket.pipe(connection);
    });
    upstream.once("response", (response) => {
      socket.write(
        "HTTP/1.1 " +
          (response.statusCode || 502) +
          " " +
          (response.statusMessage || "Bad Gateway") +
          "\\r\\nConnection: close\\r\\n\\r\\n",
      );
      response.pipe(socket);
    });
    upstream.once("error", () => socket.destroy());
    socket.once("error", () => upstream.destroy());
    upstream.end();
  } catch {
    socket.destroy();
  }
});

const shutdown = async () => {
  await status("draining");
  server.close(async () => {
    await status("stopped");
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.listen(port, host, async () => status("ready"));
server.on("error", async (error) => {
  await status("failed");
  throw error;
});
`;
}

function readableIdentity(identity: string): string {
  return (
    identity
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "process"
  );
}

function isSecretReference(value: unknown): value is Readonly<{ kind: "secret"; name: string }> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Reflect.get(value as object, "kind") === "secret" &&
    typeof Reflect.get(value as object, "name") === "string"
  );
}

function assertDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Local Deployment ${name} must be a non-negative safe integer.`);
  }
}

function assertLocalTarget(artifact: ReleaseArtifact): void {
  if (!artifact.target) return;
  const { operatingSystem, architecture } = artifact.target;
  if (operatingSystem === process.platform && architecture === process.arch) return;
  throw new Error(
    `Process artifact ${JSON.stringify(artifact.identity)} targets ${JSON.stringify(
      `${operatingSystem}/${architecture}`,
    )}, but the local adapter runs ${JSON.stringify(`${process.platform}/${process.arch}`)}.`,
  );
}

function waitForSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
}

async function close(file: FileHandle): Promise<void> {
  await file.close().catch(() => undefined);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a local Process port.");
  }
  return address.port;
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
