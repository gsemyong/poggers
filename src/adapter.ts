import type { SourceCompilerExtension } from "@/compiler/extension";
import type {
  PortableProgramExecutionIR,
  PlatformInterfaceIR,
  ProgramContributionIR,
  ProgramIR,
  SystemCompilationWork,
  SystemIR,
  SystemOutputSources,
} from "@/compiler/ir";
import type { PlatformContract } from "@/core/program";

export type { ApplicationInterfaceKind, ProgramDefinitionKind } from "@/core/program";

/** Adapter-owned runtime configuration required by one production artifact. */
export type ProductionConfiguration = Readonly<{
  dependency: string;
  implementation: string;
  name: string;
  binding: Readonly<{ kind: "environment"; name: string }>;
  required: boolean;
  default?: string;
  sensitive?: true;
  allocation?:
    | Readonly<{ kind: "port" }>
    | Readonly<{
        kind: "storage";
        name: string;
        scope: "deployment" | "process";
        type: "directory" | "file";
      }>;
  source?:
    | Readonly<{ kind: "process-location" }>
    | Readonly<{
        kind: "assets";
        artifact?: "interface" | "program";
        platform?: string;
        format: "single" | "interfaces";
      }>;
}>;

export type ProductionLifecycle = Readonly<{
  shutdown?: Readonly<{ kind: "signal"; signal: "SIGINT" | "SIGTERM" }>;
  status?: Readonly<{ kind: "file"; environment: string }>;
}>;

export type ProductionTarget = Readonly<{
  operatingSystem: string;
  architecture: string;
}>;

export type HttpAssetExposure = Readonly<{
  kind: "http-assets";
  fallback?: string;
  headers?: Readonly<Record<string, string>>;
  files: readonly Readonly<{
    path: string;
    cacheControl: string;
  }>[];
  responses: readonly Readonly<{
    path: string;
    status: number;
    headers: Readonly<Record<string, string>>;
    body: string;
    substitutions?: readonly "origin"[];
  }>[];
}>;

/** Adapter-neutral public delivery requirements attached to one artifact. */
export type ProductionExposure = HttpAssetExposure;

export const PROGRAM_ATTACHMENT_IR_VERSION = 1 as const;

/** One portable contribution projected by an extension onto another Program. */
export type ProgramAttachmentContribution = Readonly<{
  contribution: ProgramContributionIR;
  execution: PortableProgramExecutionIR;
}>;

/** One named portable function made available to an adapter-owned host binding. */
export type ProgramAttachmentExport = Readonly<{
  name: string;
  contribution: string;
  function: string;
  dependencies: readonly string[];
}>;

/**
 * Adapter-neutral host binding for exported portable functions.
 *
 * The source extension owns the dependency operation and input selector
 * semantics; the target Program adapter only performs the declared binding.
 */
export type ProgramAttachmentBinding = Readonly<{
  dependency: string;
  operation: string;
  field: string;
  selector: string;
}>;

/** Versioned portable meaning contributed by one extension to one Program. */
export type ProgramAttachmentIR = Readonly<{
  version: typeof PROGRAM_ATTACHMENT_IR_VERSION;
  owner: string;
  contributions: readonly ProgramAttachmentContribution[];
  exports: readonly ProgramAttachmentExport[];
  bindings: readonly ProgramAttachmentBinding[];
}>;

/** Validates adapter-to-adapter portable meaning before any realization consumes it. */
export function validateProgramAttachmentIR(
  plan: ProgramAttachmentIR,
  expectedOwner?: string,
): ProgramAttachmentIR {
  if (plan.version !== PROGRAM_ATTACHMENT_IR_VERSION) {
    throw new Error(`Unsupported Program attachment IR version ${JSON.stringify(plan.version)}.`);
  }
  if (!plan.owner.trim() || (expectedOwner !== undefined && plan.owner !== expectedOwner)) {
    throw new Error(
      `Program attachment owner ${JSON.stringify(plan.owner)} does not match ` +
        `${JSON.stringify(expectedOwner ?? "a non-empty owner")}.`,
    );
  }
  assertUnique(
    plan.contributions.map(({ contribution }) => contribution.id),
    "Program attachment contribution",
  );
  assertUnique(
    plan.exports.map(({ name }) => name),
    "Program attachment export",
  );
  assertUnique(
    plan.bindings.map(
      ({ dependency, operation, field, selector }) =>
        `${dependency}\0${operation}\0${field}\0${selector}`,
    ),
    "Program attachment binding",
  );

  const contributions = new Map(
    plan.contributions.map((attachment) => [attachment.contribution.id, attachment]),
  );
  for (const exported of plan.exports) {
    const attachment = contributions.get(exported.contribution);
    if (!attachment || attachment.execution.kind !== "portable") {
      throw new Error(
        `Program attachment export ${JSON.stringify(exported.name)} references a missing or ` +
          "non-portable contribution.",
      );
    }
    const functions = [attachment.execution.entry, ...attachment.execution.functions];
    assertUnique(
      functions.map(({ id }) => id),
      `Program attachment ${JSON.stringify(exported.contribution)} function`,
    );
    if (!functions.some(({ id }) => id === exported.function)) {
      throw new Error(
        `Program attachment export ${JSON.stringify(exported.name)} references missing function ` +
          `${JSON.stringify(exported.function)}.`,
      );
    }
    const dependencies = new Set(attachment.contribution.requires.map(({ name }) => name));
    for (const dependency of exported.dependencies) {
      if (!dependencies.has(dependency)) {
        throw new Error(
          `Program attachment export ${JSON.stringify(exported.name)} uses undeclared Dependency ` +
            `${JSON.stringify(dependency)}.`,
        );
      }
    }
  }
  for (const binding of plan.bindings) {
    for (const [name, value] of Object.entries(binding)) {
      if (!value.trim()) {
        throw new Error(`Program attachment binding ${JSON.stringify(name)} is empty.`);
      }
    }
  }
  return plan;
}

/** Projects extension-owned meaning onto one target Program without adapter coupling. */
export type ProgramAttachmentSource = Readonly<{
  name: string;
  project(program: ProgramIR, system: SystemIR): ProgramAttachmentIR;
}>;

/** Private development transport for the same portable exports used in production. */
export type DevelopmentProgramAttachments = Readonly<{
  register(
    input: Readonly<{
      system: string;
      program: string;
      plan: ProgramAttachmentIR;
      dependencies: Readonly<Record<string, unknown>>;
    }>,
  ): Disposable;
  invoke(system: string, input: Readonly<{ export: string; value: unknown }>): Promise<unknown>;
}>;

export type PlatformInput<Platform extends PlatformContract = PlatformContract> = Readonly<{
  directory: string;
  system: string;
  ir: SystemIR;
  app?: string;
  programs: readonly ProgramIR[];
  interfaces: readonly PlatformInterfaceIR[];
  platform: Platform["Name"];
}>;

export type SystemCompilationChange = Readonly<{
  source: string;
  outputs: readonly string[];
}>;

export type SystemCompilationRevision = Readonly<{
  revision: number;
  ir: SystemIR;
  outputSources: SystemOutputSources;
  sourceFiles: readonly string[];
  cache: "hit" | "miss";
  work: SystemCompilationWork;
  change?: SystemCompilationChange;
}>;

/** The one incremental semantic compiler shared by every development adapter. */
export type SystemRevisionSource = Readonly<{
  readonly current: SystemCompilationRevision;
  compile(changedFile: string): SystemCompilationRevision;
}>;

/** Framework development facts emitted by Platform Adapters without choosing a renderer. */
export type DevelopmentEvent =
  | Readonly<{
      kind: "phase";
      phase: "compile" | "start";
      status: "started" | "completed";
      platform?: string;
      durationMs?: number;
      cache?: "hit" | "miss";
      work?: SystemCompilationWork;
    }>
  | Readonly<{
      kind: "update";
      platform: string;
      scope: "interface" | "program";
      mode?: string;
      outputs: readonly string[];
      durationMs: number;
    }>
  | Readonly<{
      kind: "diagnostic";
      platform: string;
      severity: "error" | "warning";
      message: string;
    }>;

export type DevelopmentReporter = (event: DevelopmentEvent) => void;

/** Framework production facts emitted by Platform Adapters without choosing a renderer. */
export type ProductionEvent =
  | Readonly<{
      kind: "phase";
      phase: "compile" | "build" | "release";
      status: "started" | "completed";
      platform?: string;
      durationMs?: number;
    }>
  | Readonly<{
      kind: "artifact";
      platform: string;
      identity: string;
      path: string;
      cache?: "hit" | "miss";
      durationMs?: number;
    }>
  | Readonly<{
      kind: "diagnostic";
      platform?: string;
      severity: "error" | "warning";
      message: string;
    }>;

export type ProductionReporter = (event: ProductionEvent) => void;

export type PlatformDevelopmentInput<Platform extends PlatformContract = PlatformContract> =
  PlatformInput<Platform> &
    Readonly<{
      revisions: SystemRevisionSource;
      report?: DevelopmentReporter;
    }>;

export type PlatformProductionInput<Platform extends PlatformContract = PlatformContract> =
  PlatformInput<Platform> & Readonly<{ output: string; report?: ProductionReporter }>;

/** A live development realization with one framework-owned cleanup path. */
export type DevelopmentSession = AsyncDisposable &
  Readonly<{
    locations: Readonly<Record<string, readonly string[]>>;
  }>;

export type ProductionArtifact = Readonly<{
  identity: string;
  kind: "interface" | "program";
  deployment: "asset" | "process";
  environment: string;
  path: string;
  entrypoint?: string;
  dependencies?: readonly string[];
  configuration?: readonly ProductionConfiguration[];
  lifecycle?: ProductionLifecycle;
  target?: ProductionTarget;
  exposure?: ProductionExposure;
}>;

/** Deterministic files emitted by one Platform Adapter. */
export type ProductionArtifacts = Readonly<{
  directory: string;
  entries: readonly ProductionArtifact[];
}>;

/** The sole top-level implementation contract for one Platform. */
export type PlatformAdapter<Platform extends PlatformContract> = Readonly<{
  name: Platform["Name"];
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
}>;

/** An exact adapter binding for a known union of Platforms. */
export type PlatformAdapters<Platforms extends PlatformContract> = Readonly<{
  [Platform in Platforms as Platform["Name"]]: PlatformAdapter<Platform>;
}>;

export type PlatformAdapterImplementation = Readonly<{
  name: string;
  compiler?: readonly SourceCompilerExtension[];
  develop(input: PlatformDevelopmentInput): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput): Promise<ProductionArtifacts>;
}>;

/** Selects every required adapter exactly once from deterministic System meaning. */
export function selectPlatformAdapters<Adapter extends PlatformAdapterImplementation>(
  platforms: readonly string[],
  adapters: Readonly<Record<string, Adapter>>,
): readonly Adapter[] {
  const names = [...new Set(platforms)].sort();
  if (names.length !== platforms.length) {
    throw new Error("System output selection contains duplicate Platforms.");
  }
  return names.map((name) => {
    const adapter = adapters[name];
    if (!adapter) throw new Error(`No Platform Adapter is registered for ${JSON.stringify(name)}.`);
    if (adapter.name !== name) {
      throw new Error(
        `Platform Adapter ${JSON.stringify(name)} identifies itself as ${JSON.stringify(adapter.name)}.`,
      );
    }
    return adapter;
  });
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} ${JSON.stringify(value)} is duplicated.`);
    seen.add(value);
  }
}
