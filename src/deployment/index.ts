import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  ProductionArtifact,
  ProductionArtifacts,
  ProductionConfiguration,
  ProductionLifecycle,
  ProductionTarget,
} from "@/adapter";
import type { ProgramExternalDependencies, ProgramName } from "@/core/dependency";
import type { FeatureContract } from "@/core/feature";
import type { System, SystemContract, SystemContractOf } from "@/core/system";

declare const deploymentAdapterContract: unique symbol;
declare const dependencyBindingContract: unique symbol;
declare const secretReferenceContract: unique symbol;

type Empty = Record<never, never>;
type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] };
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type ProgramNames<Contract extends FeatureContract> = Extract<ProgramName<Contract>, string>;

type ExternalDependencyContributions<Contract extends FeatureContract> = {
  [Name in ProgramNames<Contract>]: ProgramExternalDependencies<Contract, Name>;
}[ProgramNames<Contract>];

type ExternalDependencies<Contract extends FeatureContract> = [
  ExternalDependencyContributions<Contract>,
] extends [never]
  ? Empty
  : Simplify<
      UnionToIntersection<ExternalDependencyContributions<Contract>> extends infer Dependencies
        ? Dependencies extends object
          ? Dependencies
          : Empty
        : Empty
    >;

export const RELEASE_MANIFEST_VERSION = 1 as const;

export type ReleaseFile = Readonly<{
  path: string;
  digest: string;
  size: number;
  executable: boolean;
}>;

export type ReleaseArtifact = Readonly<{
  identity: string;
  kind: "interface" | "program";
  deployment: "asset" | "process";
  platform: string;
  environment: string;
  digest: string;
  root: string;
  files: readonly string[];
  entrypoint?: string;
  dependencies: readonly string[];
  configuration: readonly ProductionConfiguration[];
  lifecycle?: ProductionLifecycle;
  target?: ProductionTarget;
}>;

/** Immutable, content-addressed production output for one selected System/App. */
export type Release = Readonly<{
  version: typeof RELEASE_MANIFEST_VERSION;
  system: string;
  app?: string;
  digest: string;
  files: readonly ReleaseFile[];
  artifacts: readonly ReleaseArtifact[];
}>;

export type DeploymentArtifactState = Readonly<{
  identity: string;
  kind: "interface" | "program";
  digest: string;
  replicas?: number;
  processes?: readonly DeploymentProcessState[];
  locations?: readonly string[];
}>;

export type DeploymentProcessState = Readonly<{
  id: string;
  status: "starting" | "ready" | "draining" | "stopped" | "failed";
  healthy: boolean;
  ready: boolean;
  version: string;
  pid?: number;
  locations?: readonly string[];
  shutdown?: "SIGINT" | "SIGTERM";
  logs?: Readonly<{ stdout: string; stderr: string }>;
  interfaces?: readonly Readonly<{ identity: string; location: string }>[];
}>;

export type DeploymentFailure = Readonly<{
  operation?: string;
  code: string;
  message: string;
}>;

/** Target-independent observed state returned by every Deployment adapter. */
export type DeploymentState = Readonly<{
  revision: number;
  release?: string;
  desired?: string;
  runtime?: string;
  converged: boolean;
  artifacts: readonly DeploymentArtifactState[];
  failures: readonly DeploymentFailure[];
}>;

export type DeploymentOperation =
  | Readonly<{
      type: "create";
      artifact: ReleaseArtifact;
      replicas?: number;
    }>
  | Readonly<{
      type: "replace";
      artifact: ReleaseArtifact;
      previous: DeploymentArtifactState;
      replicas?: number;
    }>
  | Readonly<{
      type: "scale";
      artifact: ReleaseArtifact;
      from: number;
      to: number;
    }>
  | Readonly<{
      type: "remove";
      artifact: DeploymentArtifactState;
    }>;

export type DeploymentDependencyPlan = Readonly<{
  name: string;
  implementation: string;
  configuration: Readonly<object>;
}>;

export type DeploymentTarget = Readonly<{
  adapter: string;
  configuration: Readonly<object>;
}>;

export type ReplicaPolicy = Readonly<{
  minimum: number;
  maximum: number;
  scaleUp?: Readonly<{ cooldownMs?: number; maximumStep?: number }>;
  scaleDown?: Readonly<{ cooldownMs?: number; maximumStep?: number }>;
}>;

export type ReplicaObservation = Readonly<{
  current: number;
  ready: number;
  recommended: number;
  now: number;
  changedAt?: number;
}>;

export type ReplicaDecision = Readonly<{
  replicas: number;
  reason: "stable" | "bounded" | "cooldown" | "unavailable" | "scale-up" | "scale-down";
}>;

/** Deterministic change set from one observed revision to one Release. */
export type DeploymentPlan = Readonly<{
  digest: string;
  desired: string;
  runtime: string;
  release: Release;
  target: DeploymentTarget;
  expectedRevision: number;
  artifacts: readonly DeploymentArtifactState[];
  operations: readonly DeploymentOperation[];
  dependencies: readonly DeploymentDependencyPlan[];
}>;

/** One configured implementation of the Deployment lifecycle. */
export type DeploymentAdapter<
  Name extends string = string,
  Configuration extends object = Empty,
  State extends DeploymentState = DeploymentState,
> = Readonly<{
  name: Name;
  configuration: Readonly<Configuration>;
  inspect(): Promise<State | undefined>;
  apply(input: Readonly<{ plan: DeploymentPlan }>): Promise<State>;
  remove(input: Readonly<{ expectedRevision: number }>): Promise<State>;
  [deploymentAdapterContract]?: Name;
}>;

/** An adapter-owned realization of one semantic Dependency contract. */
export type DependencyBinding<
  API extends object = object,
  Configuration extends object = object,
> = Readonly<{
  implementation: string;
  configuration: Readonly<Configuration>;
  [dependencyBindingContract]: (api: API) => API;
}>;

export type DeploymentProgram = Readonly<{
  replicas?: number;
}>;

export type DeploymentPrograms<Contract extends FeatureContract> = Readonly<
  Partial<{
    [Name in ProgramNames<Contract>]: DeploymentProgram;
  }>
>;

export type DeploymentDependencies<Contract extends FeatureContract> = Readonly<
  Partial<{
    [Name in keyof ExternalDependencies<Contract>]: ExternalDependencies<Contract>[Name] extends object
      ? DependencyBinding<ExternalDependencies<Contract>[Name]>
      : never;
  }>
>;

/** An opaque secret name resolved by a Deployment adapter at apply time. */
export type SecretReference<Name extends string = string> = Readonly<{
  kind: "secret";
  name: Name;
  [secretReferenceContract]: Name;
}>;

export type DeploymentDefinition<
  Contract extends FeatureContract,
  Adapter extends DeploymentAdapter,
> = Readonly<{
  adapter: Adapter;
  programs?: DeploymentPrograms<Contract>;
  dependencies?: DeploymentDependencies<Contract>;
}>;

export type Deployment<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
> = DeploymentDefinition<SystemContractOf<SystemValue>, Adapter> &
  Readonly<{ system: SystemValue }>;

/** Binds one System to one configured Deployment adapter. */
export function createDeployment<
  const SystemValue extends System<SystemContract>,
  const Adapter extends DeploymentAdapter,
>(
  system: SystemValue,
  definition: DeploymentDefinition<SystemContractOf<SystemValue>, Adapter>,
): Deployment<SystemValue, Adapter> {
  if (!definition.adapter.name.trim()) {
    throw new TypeError("Deployment adapter name cannot be empty.");
  }
  for (const [name, program] of Object.entries(definition.programs ?? {}) as [
    string,
    DeploymentProgram,
  ][]) {
    const replicas = program.replicas;
    if (replicas !== undefined && (!Number.isSafeInteger(replicas) || replicas < 0)) {
      throw new TypeError(
        `Deployment Program ${JSON.stringify(name)} replicas must be a non-negative safe integer.`,
      );
    }
  }
  return Object.freeze({ system, ...definition });
}

/** Refers to a secret without reading or serializing its value. */
export function secret<const Name extends string>(name: Name): SecretReference<Name> {
  if (!name.trim()) throw new TypeError("Deployment secret name cannot be empty.");
  return Object.freeze({ kind: "secret", name }) as SecretReference<Name>;
}

/** Applies target-independent safety policy to one metric-specific recommendation. */
export function reconcileReplicas(
  policy: ReplicaPolicy,
  observation: ReplicaObservation,
): ReplicaDecision {
  assertCount(policy.minimum, "Replica minimum");
  assertCount(policy.maximum, "Replica maximum");
  if (policy.minimum > policy.maximum) {
    throw new TypeError("Replica minimum cannot exceed maximum.");
  }
  assertCount(observation.current, "Current replica count");
  assertCount(observation.ready, "Ready replica count");
  assertCount(observation.recommended, "Recommended replica count");
  assertTimestamp(observation.now, "Replica observation time");
  if (observation.changedAt !== undefined) {
    assertTimestamp(observation.changedAt, "Replica last-change time");
    if (observation.changedAt > observation.now) {
      throw new TypeError("Replica last-change time cannot be in the future.");
    }
  }
  validateScalePolicy(policy.scaleUp, "scale-up");
  validateScalePolicy(policy.scaleDown, "scale-down");

  const target = Math.max(policy.minimum, Math.min(policy.maximum, observation.recommended));
  if (target === observation.current) {
    return Object.freeze({
      replicas: target,
      reason: target === observation.recommended ? "stable" : "bounded",
    });
  }
  const direction = target > observation.current ? "scale-up" : "scale-down";
  if (direction === "scale-down" && observation.ready < observation.current) {
    return Object.freeze({ replicas: observation.current, reason: "unavailable" });
  }
  const settings = direction === "scale-up" ? policy.scaleUp : policy.scaleDown;
  const cooldown = settings?.cooldownMs ?? 0;
  if (observation.changedAt !== undefined && observation.now - observation.changedAt < cooldown) {
    return Object.freeze({ replicas: observation.current, reason: "cooldown" });
  }
  const difference = Math.abs(target - observation.current);
  const step = Math.min(difference, settings?.maximumStep ?? difference);
  return Object.freeze({
    replicas: observation.current + (direction === "scale-up" ? step : -step),
    reason: direction,
  });
}

/** Computes one deterministic desired/observed change set. */
export function planDeployment<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
>(
  deployment: Deployment<SystemValue, Adapter>,
  release: Release,
  observed?: DeploymentState,
): DeploymentPlan {
  validateObservedState(observed);
  const expectedRevision = observed?.revision ?? 0;
  const observedArtifacts = new Map(
    (observed?.artifacts ?? []).map((artifact) => [artifact.identity, artifact]),
  );
  const processArtifacts = new Map(
    release.artifacts
      .filter(({ deployment: mode }) => mode === "process")
      .map((artifact) => [programName(artifact.identity), artifact]),
  );
  for (const name of Object.keys(deployment.programs ?? {})) {
    if (!processArtifacts.has(name)) {
      throw new Error(
        `Deployment Program ${JSON.stringify(name)} is not a deployer-managed Process in this Release.`,
      );
    }
  }

  const operations: DeploymentOperation[] = [];
  const desiredArtifacts: DeploymentArtifactState[] = [];
  for (const artifact of release.artifacts) {
    const previous = observedArtifacts.get(artifact.identity);
    observedArtifacts.delete(artifact.identity);
    const replicas =
      artifact.deployment === "process"
        ? ((deployment.programs as Readonly<Record<string, DeploymentProgram>> | undefined)?.[
            programName(artifact.identity)
          ]?.replicas ?? 1)
        : undefined;
    desiredArtifacts.push(
      Object.freeze({
        identity: artifact.identity,
        kind: artifact.kind,
        digest: artifact.digest,
        ...(replicas === undefined ? {} : { replicas }),
      }),
    );
    if (!previous) {
      operations.push(
        replicas === undefined
          ? { type: "create", artifact }
          : { type: "create", artifact, replicas },
      );
    } else if (previous.kind !== artifact.kind || previous.digest !== artifact.digest) {
      operations.push(
        replicas === undefined
          ? { type: "replace", artifact, previous }
          : { type: "replace", artifact, previous, replicas },
      );
    } else if (replicas !== undefined && observedReplicas(previous) !== replicas) {
      operations.push({
        type: "scale",
        artifact,
        from: observedReplicas(previous),
        to: replicas,
      });
    }
  }
  for (const artifact of observedArtifacts.values()) {
    operations.push({ type: "remove", artifact });
  }
  operations.sort(compareDeploymentOperations);
  desiredArtifacts.sort((left, right) => left.identity.localeCompare(right.identity));

  const dependencies = deploymentDependencyPlan(deployment, release);
  const target = Object.freeze({
    adapter: deployment.adapter.name,
    configuration: canonicalDeploymentObject(
      deployment.adapter.configuration,
      `Deployment adapter ${JSON.stringify(deployment.adapter.name)} configuration`,
    ),
  });
  const runtime = digest({
    target,
    dependencies,
  });
  const desired = digest({
    release: release.digest,
    runtime,
    artifacts: desiredArtifacts,
  });
  const meaning = {
    desired,
    runtime,
    release,
    target,
    expectedRevision,
    artifacts: Object.freeze(desiredArtifacts),
    operations: Object.freeze(operations),
    dependencies,
  };
  return Object.freeze({ ...meaning, digest: digest(meaning) });
}

/** Applies the current Release through one configured adapter. */
export async function applyDeployment<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
>(
  deployment: Deployment<SystemValue, Adapter>,
  release: Release,
): Promise<Readonly<{ plan: DeploymentPlan; state: Awaited<ReturnType<Adapter["apply"]>> }>> {
  const observed = await deployment.adapter.inspect();
  const plan = planDeployment(deployment, release, observed);
  if (
    observed?.converged &&
    observed.release === release.digest &&
    observed.desired === plan.desired &&
    plan.operations.length === 0
  ) {
    return { plan, state: observed as Awaited<ReturnType<Adapter["apply"]>> };
  }
  const state = await deployment.adapter.apply({ plan });
  validateAppliedState(plan, state);
  return { plan, state: state as Awaited<ReturnType<Adapter["apply"]>> };
}

/** Returns the latest adapter observation without building or mutating. */
export function inspectDeployment<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
>(deployment: Deployment<SystemValue, Adapter>): ReturnType<Adapter["inspect"]> {
  return deployment.adapter.inspect() as ReturnType<Adapter["inspect"]>;
}

/** Removes the current realization idempotently. */
export async function removeDeployment<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
>(deployment: Deployment<SystemValue, Adapter>): Promise<DeploymentState> {
  const observed = await deployment.adapter.inspect();
  if (!observed) return emptyDeploymentState();
  if (observed.converged && observed.artifacts.length === 0) return observed;
  const state = await deployment.adapter.remove({ expectedRevision: observed.revision });
  validateObservedState(state);
  if (state.revision <= observed.revision) {
    throw new Error("Deployment adapter removal did not advance observed revision.");
  }
  if (state.artifacts.length || !state.converged) {
    throw new Error("Deployment adapter removal did not converge to an empty realization.");
  }
  return state;
}

function observedReplicas(artifact: DeploymentArtifactState): number {
  return artifact.processes
    ? artifact.processes.filter(({ healthy, ready }) => healthy && ready).length
    : (artifact.replicas ?? 0);
}

function deploymentDependencyPlan<
  SystemValue extends System<SystemContract>,
  Adapter extends DeploymentAdapter,
>(
  deployment: Deployment<SystemValue, Adapter>,
  release: Release,
): readonly DeploymentDependencyPlan[] {
  const requirements = new Map<
    string,
    Readonly<{ implementations: Set<string>; configuration: ProductionConfiguration[] }>
  >();
  const known = new Set<string>();
  for (const artifact of release.artifacts) {
    for (const dependency of artifact.dependencies) known.add(dependency);
    for (const field of artifact.configuration) {
      known.add(field.dependency);
      const requirement = requirements.get(field.dependency) ?? {
        implementations: new Set<string>(),
        configuration: [],
      };
      requirement.implementations.add(field.implementation);
      requirement.configuration.push(field);
      requirements.set(field.dependency, requirement);
    }
  }
  const bindings = Object.entries(deployment.dependencies ?? {}) as [string, DependencyBinding][];
  const result: DeploymentDependencyPlan[] = [];
  for (const [name, binding] of bindings.sort(([left], [right]) => left.localeCompare(right))) {
    if (!known.has(name)) {
      throw new Error(`Deployment binds unknown Dependency ${JSON.stringify(name)}.`);
    }
    if (!binding || typeof binding !== "object" || !binding.implementation?.trim()) {
      throw new TypeError(
        `Deployment Dependency ${JSON.stringify(name)} has no implementation identity.`,
      );
    }
    const requirement = requirements.get(name);
    if (
      requirement?.implementations.size &&
      !requirement.implementations.has(binding.implementation)
    ) {
      throw new Error(
        `Deployment Dependency ${JSON.stringify(name)} uses ${JSON.stringify(
          binding.implementation,
        )}, but this Release embeds ${[...requirement.implementations]
          .sort()
          .map((implementation) => JSON.stringify(implementation))
          .join(", ")}.`,
      );
    }
    const configuration = canonicalDeploymentObject(
      binding.configuration,
      `Dependency ${JSON.stringify(name)} configuration`,
    );
    for (const field of requirement?.configuration ?? []) {
      const value = Reflect.get(configuration, field.name);
      if (field.required && field.default === undefined && value === undefined) {
        throw new Error(
          `Deployment Dependency ${JSON.stringify(name)} is missing required configuration ${JSON.stringify(field.name)}.`,
        );
      }
      if (field.sensitive && value !== undefined && !isSecretReference(value)) {
        throw new Error(
          `Deployment Dependency ${JSON.stringify(name)} configuration ${JSON.stringify(field.name)} must be a secret reference.`,
        );
      }
    }
    result.push(
      Object.freeze({
        name,
        implementation: binding.implementation,
        configuration,
      }),
    );
  }
  for (const [name, requirement] of requirements) {
    if (bindings.some(([binding]) => binding === name)) continue;
    const missing = requirement.configuration.find(
      ({ required, default: fallback }) => required && fallback === undefined,
    );
    if (missing) {
      throw new Error(
        `Deployment Dependency ${JSON.stringify(name)} requires a binding for ${JSON.stringify(missing.name)}.`,
      );
    }
  }
  return Object.freeze(result);
}

function canonicalDeploymentObject(value: object, label: string): Readonly<object> {
  const canonical = canonicalDeploymentValue(value, label);
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return Object.freeze(canonical);
}

function canonicalDeploymentValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return value;
  }
  if (isSecretReference(value)) {
    return Object.freeze({ kind: "secret", name: value.name });
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => canonicalDeploymentValue(item, `${label}[${index}]`)),
    );
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} contains a non-plain object.`);
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, item]) => {
            if (item === undefined) {
              throw new TypeError(`${label}.${name} cannot be undefined.`);
            }
            return [name, canonicalDeploymentValue(item, `${label}.${name}`)];
          }),
      ),
    );
  }
  throw new TypeError(`${label} contains unsupported ${typeof value} data.`);
}

function isSecretReference(value: unknown): value is SecretReference {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Reflect.get(value as object, "kind") === "secret" &&
    typeof Reflect.get(value as object, "name") === "string" &&
    Boolean(Reflect.get(value as object, "name").trim())
  );
}

function programName(identity: string): string {
  if (!identity.startsWith("program/")) {
    throw new Error(`Process artifact ${JSON.stringify(identity)} is not a Program.`);
  }
  return identity.slice("program/".length);
}

function compareDeploymentOperations(
  left: DeploymentOperation,
  right: DeploymentOperation,
): number {
  const priority = { create: 0, replace: 1, scale: 2, remove: 3 } as const;
  return (
    priority[left.type] - priority[right.type] ||
    left.artifact.identity.localeCompare(right.artifact.identity)
  );
}

function validateObservedState(state: DeploymentState | undefined): void {
  if (!state) return;
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error("Deployment observed revision must be a non-negative safe integer.");
  }
  const identities = state.artifacts.map(({ identity }) => identity);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Deployment observed state contains duplicate artifacts.");
  }
  for (const artifact of state.artifacts) {
    if (
      artifact.replicas !== undefined &&
      (!Number.isSafeInteger(artifact.replicas) || artifact.replicas < 0)
    ) {
      throw new Error(
        `Deployment artifact ${JSON.stringify(artifact.identity)} has an invalid replica count.`,
      );
    }
  }
}

function validateAppliedState(plan: DeploymentPlan, state: DeploymentState): void {
  validateObservedState(state);
  if (state.revision <= plan.expectedRevision) {
    throw new Error("Deployment adapter apply did not advance observed revision.");
  }
  if (state.converged) {
    if (state.release !== plan.release.digest) {
      throw new Error("Converged Deployment state does not identify the planned Release.");
    }
    if (state.desired !== plan.desired) {
      throw new Error("Converged Deployment state does not identify the planned realization.");
    }
    if (state.runtime !== plan.runtime) {
      throw new Error("Converged Deployment state does not identify the planned runtime.");
    }
    if (state.failures.length || !sameArtifactStates(plan.artifacts, state.artifacts)) {
      throw new Error("Deployment adapter claimed convergence with unapplied operations.");
    }
  }
}

function sameArtifactStates(
  expected: readonly DeploymentArtifactState[],
  observed: readonly DeploymentArtifactState[],
): boolean {
  const canonical = (values: readonly DeploymentArtifactState[]) =>
    [...values]
      .sort((left, right) => left.identity.localeCompare(right.identity))
      .map(({ identity, kind, digest: value, replicas }) => [
        identity,
        kind,
        value,
        replicas ?? null,
      ]);
  return JSON.stringify(canonical(expected)) === JSON.stringify(canonical(observed));
}

function emptyDeploymentState(): DeploymentState {
  return Object.freeze({
    revision: 0,
    converged: true,
    artifacts: Object.freeze([]),
    failures: Object.freeze([]),
  });
}

/** @internal Seals Platform build outputs into one deterministic Release. */
export async function createRelease(input: {
  directory: string;
  system: string;
  app?: string;
  artifacts: Readonly<Record<string, ProductionArtifacts>>;
}): Promise<Release> {
  const root = resolve(input.directory);
  await mkdir(root, { recursive: true });
  const files = new Map<string, ReleaseFile>();
  const identities = new Set<string>();
  const artifacts: ReleaseArtifact[] = [];

  for (const [platform, output] of Object.entries(input.artifacts).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const artifact of [...output.entries].sort((left, right) =>
      left.identity.localeCompare(right.identity),
    )) {
      if (identities.has(artifact.identity)) {
        throw new Error(
          `Release contains duplicate artifact ${JSON.stringify(artifact.identity)}.`,
        );
      }
      identities.add(artifact.identity);
      const artifactFiles = await collectArtifactFiles(root, artifact.path);
      const artifactRoot = releasePath(root, resolve(artifact.path));
      for (const file of artifactFiles) {
        const retained = files.get(file.path);
        if (retained && retained.digest !== file.digest) {
          throw new Error(`Release path ${JSON.stringify(file.path)} has conflicting contents.`);
        }
        files.set(file.path, retained ?? file);
      }
      const paths = Object.freeze(artifactFiles.map(({ path }) => path).sort());
      const entrypoint = artifact.entrypoint
        ? releasePath(root, resolve(artifact.entrypoint))
        : undefined;
      if (entrypoint && !paths.includes(entrypoint)) {
        throw new Error(
          `Artifact ${JSON.stringify(artifact.identity)} entrypoint is not one of its files.`,
        );
      }
      const dependencies = Object.freeze([...new Set(artifact.dependencies ?? [])].sort());
      const configuration = Object.freeze(
        [...(artifact.configuration ?? [])]
          .map(canonicalConfiguration)
          .sort((left, right) =>
            configurationIdentity(left).localeCompare(configurationIdentity(right)),
          ),
      );
      const configurationIdentities = configuration.map(configurationIdentity);
      if (new Set(configurationIdentities).size !== configurationIdentities.length) {
        throw new Error(
          `Artifact ${JSON.stringify(artifact.identity)} contains duplicate runtime configuration.`,
        );
      }
      const target = artifact.target
        ? {
            operatingSystem: artifact.target.operatingSystem,
            architecture: artifact.target.architecture,
          }
        : undefined;
      const lifecycle = artifact.lifecycle?.shutdown
        ? canonicalLifecycle(artifact.lifecycle)
        : artifact.lifecycle?.status
          ? canonicalLifecycle(artifact.lifecycle)
          : undefined;
      const meaning = {
        identity: artifact.identity,
        kind: artifact.kind,
        deployment: artifact.deployment,
        platform,
        environment: artifact.environment,
        root: artifactRoot,
        files: paths,
        ...(entrypoint ? { entrypoint } : {}),
        dependencies,
        configuration,
        ...(lifecycle ? { lifecycle } : {}),
        ...(target ? { target } : {}),
      };
      artifacts.push(
        Object.freeze({
          ...meaning,
          digest: digest({ ...meaning, content: artifactFiles }),
        }),
      );
    }
  }

  artifacts.sort((left, right) => left.identity.localeCompare(right.identity));
  const manifestFiles = Object.freeze(
    [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
  );
  const meaning = {
    version: RELEASE_MANIFEST_VERSION,
    system: input.system,
    ...(input.app ? { app: input.app } : {}),
    files: manifestFiles,
    artifacts: Object.freeze(artifacts),
  };
  const release = Object.freeze({ ...meaning, digest: digest(meaning) });
  await writeFile(resolve(root, "release.json"), `${JSON.stringify(release, undefined, 2)}\n`);
  return release;
}

async function collectArtifactFiles(root: string, artifactPath: string): Promise<ReleaseFile[]> {
  const path = resolve(artifactPath);
  releasePath(root, path);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Release artifact ${JSON.stringify(path)} cannot be a symbolic link.`);
  }
  if (metadata.isFile()) return [await releaseFile(root, path)];
  if (!metadata.isDirectory()) {
    throw new Error(`Release artifact ${JSON.stringify(path)} is not a file or directory.`);
  }
  const files: ReleaseFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const current = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release artifact ${JSON.stringify(current)} cannot be a symbolic link.`);
      }
      if (entry.isDirectory()) {
        await visit(current);
      } else if (entry.isFile()) {
        files.push(await releaseFile(root, current));
      } else {
        throw new Error(`Release artifact ${JSON.stringify(current)} is not a regular file.`);
      }
    }
  };
  await visit(path);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function releaseFile(root: string, path: string): Promise<ReleaseFile> {
  const metadata = await lstat(path);
  const contents = await readFile(path);
  return Object.freeze({
    path: releasePath(root, path),
    digest: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    size: metadata.size,
    executable: (metadata.mode & 0o111) !== 0,
  });
}

function releasePath(root: string, path: string): string {
  const value = relative(root, path);
  if (!value || isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    throw new Error(
      `Release artifact ${JSON.stringify(path)} must be inside its output directory.`,
    );
  }
  return value.split(sep).join("/");
}

function configurationIdentity(configuration: ProductionConfiguration): string {
  return `${configuration.dependency}\0${configuration.implementation}\0${configuration.name}`;
}

function canonicalConfiguration(configuration: ProductionConfiguration): ProductionConfiguration {
  return Object.freeze({
    dependency: configuration.dependency,
    implementation: configuration.implementation,
    name: configuration.name,
    binding: Object.freeze({
      kind: configuration.binding.kind,
      name: configuration.binding.name,
    }),
    required: configuration.required,
    ...(configuration.default === undefined ? {} : { default: configuration.default }),
    ...(configuration.sensitive ? { sensitive: true as const } : {}),
    ...(configuration.allocation
      ? { allocation: canonicalAllocation(configuration.allocation) }
      : {}),
    ...(configuration.source
      ? {
          source: Object.freeze(
            configuration.source.kind === "process-location"
              ? { kind: configuration.source.kind }
              : {
                  kind: configuration.source.kind,
                  format: configuration.source.format,
                  ...(configuration.source.platform
                    ? { platform: configuration.source.platform }
                    : {}),
                },
          ),
        }
      : {}),
  });
}

function canonicalAllocation(
  allocation: NonNullable<ProductionConfiguration["allocation"]>,
): NonNullable<ProductionConfiguration["allocation"]> {
  if (allocation.kind === "port") return Object.freeze({ kind: "port" });
  return Object.freeze({
    kind: "storage",
    name: allocation.name,
    scope: allocation.scope,
    type: allocation.type,
  });
}

function canonicalLifecycle(
  lifecycle: NonNullable<ProductionArtifact["lifecycle"]>,
): NonNullable<ProductionArtifact["lifecycle"]> {
  return Object.freeze({
    ...(lifecycle.shutdown
      ? {
          shutdown: Object.freeze({
            kind: lifecycle.shutdown.kind,
            signal: lifecycle.shutdown.signal,
          }),
        }
      : {}),
    ...(lifecycle.status
      ? {
          status: Object.freeze({
            kind: lifecycle.status.kind,
            environment: lifecycle.status.environment,
          }),
        }
      : {}),
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function validateScalePolicy(
  policy: ReplicaPolicy["scaleUp"] | ReplicaPolicy["scaleDown"],
  name: string,
): void {
  if (!policy) return;
  if (policy.cooldownMs !== undefined) {
    assertTimestamp(policy.cooldownMs, `Replica ${name} cooldown`);
  }
  if (policy.maximumStep !== undefined) {
    if (!Number.isSafeInteger(policy.maximumStep) || policy.maximumStep < 1) {
      throw new TypeError(`Replica ${name} maximum step must be a positive safe integer.`);
    }
  }
}

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number.`);
  }
}
