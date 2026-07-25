import type {
  ProductionConfiguration,
  ProductionLifecycle,
  ProductionTarget,
} from "@/contracts/production";
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

/**
 * One configured implementation of the Deployment lifecycle.
 *
 * Configuration remains owned by the adapter that constructs this value.
 */
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

/**
 * An adapter-owned realization of one semantic Dependency contract.
 *
 * Product authors receive bindings from adapter/provider packages; they do not
 * construct this marker or provide raw environment maps.
 */
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

/**
 * Binds one System to one configured Deployment adapter.
 *
 * Program and Dependency names are inferred recursively from the System.
 */
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
