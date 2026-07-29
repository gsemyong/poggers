import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  validateProgramAttachmentIR,
  type ProductionServiceRequirement,
  type ProgramAttachmentBinding,
  type ProgramAttachmentIR,
} from "@/adapter";
import {
  collectDependencyOperations,
  dependencyContractIdentity,
  dependencyOperationIdentity,
  selectDependencyProviders,
  type DependencyOperationIR,
  type LinkedProgramIR,
  type ProgramContributionIR,
  type ProgramIR,
  type SystemIR,
  type TypeIR,
} from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import {
  generateRustProgram,
  type PortableProgramProjection,
  type RustProgramFunctionExport,
} from "@/compiler/rust/lowering";
import type { ServerProviderConfiguration } from "@/platforms/server";
import { serverProgramExecution } from "@/platforms/server/adapter";
import {
  defineServerProductionDependency,
  resolveServerProductionDependencies,
  serverProductionDependencies,
  type ResolvedServerProductionDependency,
  type ServerProductionDependency,
} from "@/platforms/server/adapter/rust/providers";

const SERVER_PRODUCTION_VERSION = 12;
const DEFAULT_CACHE_ENTRIES = 8;
const MAX_CACHE_ENTRIES = 32;
const DEFAULT_TARGET_CACHE_BYTES = 6 * 1024 * 1024 * 1024;
const CACHE_WORKSPACE_GRACE_MS = 5 * 60 * 1000;
const CACHE_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

export type ServerProductionBuild = Readonly<{
  executable: string;
  semanticHash: string;
  cache: "hit" | "miss";
  profile: ServerProductionProfile;
  workspace: string;
  compiledCrates: readonly string[];
  durationMs: number;
  requirements: readonly ServerProductionRequirement[];
}>;

export type ServerProductionRequirement = Readonly<{
  dependency: string;
  implementation: string;
  configuration: readonly ServerProviderConfiguration[];
  services: readonly ProductionServiceRequirement[];
}>;

export type ServerProductionProfile = "debug" | "release";

/** Builds one linked server Program as a standalone native executable. */
export async function buildServerProgram(input: {
  system: string;
  ir?: SystemIR;
  dependencies?: readonly ServerProductionDependency[];
  cache?: string;
  directory: string;
  /** Runs strict Clippy verification in addition to compilation. */
  lint?: boolean;
  output: string;
  attachments?: readonly ProgramAttachmentIR[];
  /** Debug is the conformance default. Production adapters must request release explicitly. */
  profile?: ServerProductionProfile;
  program: ProgramIR;
}): Promise<ServerProductionBuild> {
  const started = performance.now();
  const profile = input.profile ?? "debug";
  const nativeRoot = await packageNativeSourceRoot();
  const attachments = rustProgramAttachments(input.attachments ?? []);
  const linked = linkProgram({
    ...input.program,
    contributions: [...input.program.contributions, ...attachments.contributions],
  });
  assertPortableProgram(linked, attachments.project);
  const featureDependencies = input.ir
    ? featureProductionDependencies(
        input.ir,
        input.program,
        linked.external,
        input.directory,
        nativeRoot,
      )
    : [];
  const overrides = new Set((input.dependencies ?? []).map(({ dependency }) => dependency));
  const featureProvided = new Set(featureDependencies.map(({ dependency }) => dependency));
  const dependencies = resolveServerProductionDependencies({
    dependencies: linked.external,
    implementations: [
      ...serverProductionDependencies.filter(
        ({ dependency }) => !overrides.has(dependency) && !featureProvided.has(dependency),
      ),
      ...featureDependencies.filter(({ dependency }) => !overrides.has(dependency)),
      ...(input.dependencies ?? []),
    ].map((implementation) => canonicalProductionDependency(implementation, nativeRoot)),
  });
  validateProgramAttachmentBindings(dependencies, attachments.bindings);
  const requirements = dependencies.map(({ dependency, implementation }) => ({
    dependency: dependency.name,
    implementation: implementation.name,
    configuration: implementation.configuration,
    services: implementation.services ?? [],
  }));
  const seed = await generateRustWorkspace(
    linked,
    dependencies,
    attachments,
    packageName(input.program.name),
    nativeRoot,
  );
  const project = digest(JSON.stringify(canonicalGeneratedInputs(seed.inputs))).slice(0, 16);
  const generated = await generateRustWorkspace(
    linked,
    dependencies,
    attachments,
    packageName(`${input.program.name}_${project}`),
    nativeRoot,
  );
  const toolchain = await rustToolchain();
  const semanticHash = digest(
    JSON.stringify({
      version: SERVER_PRODUCTION_VERSION,
      target: `${process.platform}-${process.arch}`,
      toolchain,
      files: canonicalGeneratedInputs(generated.inputs),
    }),
  );
  const cacheRoot = resolve(
    input.cache ?? process.env.KIT_PRODUCTION_CACHE ?? resolve(homedir(), ".cache/kit/production"),
  );
  const workspace = resolve(cacheRoot, "workspaces", project, fileName(input.program.name));
  const cached = resolve(
    cacheRoot,
    "artifacts",
    semanticHash,
    profile,
    fileName(input.program.name),
  );
  const lintedMarker = resolve(cacheRoot, "checks", `${semanticHash}.${profile}.clippy`);
  for (const file of generated.files) {
    const path = resolve(workspace, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeGeneratedFile(workspace, path, file);
  }
  // Retention uses workspace mtime as its cross-process active-build fence.
  await touch(workspace);
  await mkdir(dirname(input.output), { recursive: true });
  const artifactCached = await exists(cached);
  if (artifactCached && (!input.lint || (await exists(lintedMarker)))) {
    await touch(cached);
    await touch(workspace);
    await copyExecutable(cached, input.output);
    return result("hit", [], started, input.output, semanticHash, profile, workspace, requirements);
  }

  const dependencyGraphHash = digest(
    JSON.stringify(generated.inputs.filter(({ path }) => path.endsWith("Cargo.toml"))),
  );
  const lockMarker = resolve(workspace, ".kit/Cargo.lock.source");
  const dependencyGraphChanged =
    (await readFile(lockMarker, "utf8").catch(() => undefined)) !== dependencyGraphHash;
  const formatted = await command("cargo", ["fmt", "--all", "--", "--check"], workspace);
  if (formatted.code !== 0) {
    const format = await command("cargo", ["fmt", "--all"], workspace);
    if (format.code !== 0) {
      throw new Error(`Generated server production formatting failed:\n${format.stderr}`);
    }
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "1",
  };
  environment.CARGO_TARGET_DIR = resolve(cacheRoot, "target");
  if (input.lint) {
    const lintArguments = ["clippy", "--message-format=json"];
    if (profile === "release") lintArguments.splice(1, 0, "--release");
    if (!dependencyGraphChanged && (await exists(resolve(workspace, "Cargo.lock")))) {
      lintArguments.push("--locked");
    }
    lintArguments.push("--", "-D", "warnings");
    const linted = await command("cargo", lintArguments, workspace, environment);
    if (linted.code !== 0) {
      throw new Error(`Generated server production failed linting:\n${cargoErrors(linted)}`);
    }
    await mkdir(dirname(lintedMarker), { recursive: true });
    await writeFile(lintedMarker, "");
  }
  if (artifactCached) {
    await copyExecutable(cached, input.output);
    return result("hit", [], started, input.output, semanticHash, profile, workspace, requirements);
  }
  const buildArguments = ["build", "--message-format=json"];
  if (profile === "release") buildArguments.splice(1, 0, "--release");
  if (!dependencyGraphChanged && (await exists(resolve(workspace, "Cargo.lock")))) {
    buildArguments.push("--locked");
  }
  if (process.env.KIT_PRODUCTION_TIMINGS === "1") buildArguments.push("--timings");
  const built = await command("cargo", buildArguments, workspace, environment);
  if (built.code !== 0) {
    throw new Error(`Generated server production failed to build:\n${cargoErrors(built)}`);
  }
  await mkdir(dirname(lockMarker), { recursive: true });
  await writeFile(lockMarker, dependencyGraphHash);
  const executable = resolve(cacheRoot, "target", profile, generated.binary);
  await mkdir(dirname(cached), { recursive: true });
  const temporary = `${cached}.${process.pid}.tmp`;
  await copyFile(executable, temporary);
  await rename(temporary, cached).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    if (!(await exists(cached))) throw error;
  });
  await copyExecutable(cached, input.output);
  const builtResult = result(
    "miss",
    compiledCrates([built.stdout], generated.packages),
    started,
    input.output,
    semanticHash,
    profile,
    workspace,
    requirements,
  );
  await retainCache(cacheRoot, workspace, semanticHash);
  return builtResult;
}

function featureProductionDependencies(
  ir: SystemIR,
  program: ProgramIR,
  dependencies: readonly Readonly<{ name: string }>[],
  directory: string,
  nativeRoot: string,
): readonly ServerProductionDependency[] {
  return selectDependencyProviders(
    ir,
    program,
    dependencies.map(({ name }) => name),
  ).map((provider) => {
    if (!provider.production || typeof provider.production !== "object") {
      throw new Error(
        `Feature ${JSON.stringify(provider.feature)} has no production provider for ` +
          `Dependency ${JSON.stringify(provider.dependency)}.`,
      );
    }
    const production = provider.production as unknown as Omit<
      ServerProductionDependency,
      "name" | "dependency"
    >;
    if (
      !production.crate ||
      typeof production.crate.package !== "string" ||
      typeof production.crate.directory !== "string"
    ) {
      throw new Error(
        `Feature ${JSON.stringify(provider.feature)} has invalid production crate meaning for ` +
          `Dependency ${JSON.stringify(provider.dependency)}.`,
      );
    }
    const source = isAbsolute(provider.span.file)
      ? provider.span.file
      : resolve(directory, provider.span.file);
    return defineServerProductionDependency({
      ...production,
      name: featureProviderName(provider.feature, provider.dependency),
      dependency: provider.dependency,
      services: featureProviderServices(provider),
      crate: {
        ...production.crate,
        directory: canonicalNativeDirectory(
          resolve(dirname(source), production.crate.directory),
          nativeRoot,
        ),
      },
    });
  });
}

function featureProviderServices(
  provider: ReturnType<typeof selectDependencyProviders>[number],
): readonly ProductionServiceRequirement[] {
  if (provider.requirements === undefined) return [];
  if (!provider.requirements || typeof provider.requirements !== "object") {
    throw new Error(
      `Feature ${JSON.stringify(provider.feature)} has invalid server provider requirements for ` +
        `Dependency ${JSON.stringify(provider.dependency)}.`,
    );
  }
  const services = Reflect.get(provider.requirements, "services");
  if (!Array.isArray(services)) {
    throw new Error(
      `Feature ${JSON.stringify(provider.feature)} server provider requirements for ` +
        `Dependency ${JSON.stringify(provider.dependency)} must declare services.`,
    );
  }
  return services as readonly ProductionServiceRequirement[];
}

function featureProviderName(feature: string, dependency: string): string {
  return `feature-${feature}-${dependency}`
    .replaceAll(/[^A-Za-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-");
}

function assertPortableProgram(linked: LinkedProgramIR, project: PortableProgramProjection): void {
  for (const { contribution } of linked.contributions) {
    const implementation = project(contribution);
    if (implementation.kind !== "source") continue;
    const { span } = implementation;
    throw new Error(
      `${span.file}:${span.line}:${span.column}: Program contribution ` +
        `${JSON.stringify(contribution.id)} is source, not production-realizable product meaning: ` +
        (implementation.diagnostic?.message ?? "target source has no diagnostic"),
    );
  }
}

let rustToolchainResult: Promise<string> | undefined;

function rustToolchain(): Promise<string> {
  rustToolchainResult ??= command("rustc", ["-vV"], process.cwd()).then((value) => {
    if (value.code !== 0) throw new Error(`Cannot inspect Rust toolchain:\n${value.stderr}`);
    return value.stdout.trim();
  });
  return rustToolchainResult;
}

type GeneratedFile = Readonly<{ path: string; source: string }>;
type RustWorkspace = Readonly<{
  binary: string;
  files: readonly GeneratedFile[];
  inputs: readonly GeneratedFile[];
  packages: readonly string[];
}>;

type RustProgramAttachments = Readonly<{
  contributions: readonly ProgramContributionIR[];
  project: PortableProgramProjection;
  exports: readonly RustProgramFunctionExport[];
  dispatch: readonly Readonly<{ name: string; function: string }>[];
  bindings: readonly ProgramAttachmentBinding[];
}>;

type RustDistributionContract = Readonly<{
  name: string;
  identity: string;
  bindings: readonly string[];
  operations: readonly DependencyOperationIR[];
}>;

function rustProgramAttachments(plans: readonly ProgramAttachmentIR[]): RustProgramAttachments {
  plans = plans.map((plan) => validateProgramAttachmentIR(plan));
  const contributions = plans.flatMap((plan) =>
    plan.contributions.map(({ contribution }) => contribution),
  );
  const executions = new Map(
    plans.flatMap((plan) =>
      plan.contributions.map(
        ({ contribution, execution }) => [contribution.id, execution] as const,
      ),
    ),
  );
  duplicate(
    contributions.map(({ id }) => id),
    "portable Program attachment contribution",
  );
  const exported = plans.flatMap((plan) => plan.exports);
  duplicate(
    exported.map(({ name }) => name),
    "portable Program attachment export",
  );
  const exports = exported.map((definition, index) => ({
    name: `program_export_${index}`,
    contribution: definition.contribution,
    function: definition.function,
    dependencies: definition.dependencies,
  }));
  return {
    contributions,
    project: (contribution) =>
      executions.get(contribution.id) ?? serverProgramExecution(contribution),
    exports,
    dispatch: exported.map(({ name }, index) => ({ name, function: exports[index]!.name })),
    bindings: plans.flatMap(({ bindings }) => bindings),
  };
}

async function generateRustWorkspace(
  linked: LinkedProgramIR,
  dependencies: readonly ResolvedServerProductionDependency[],
  attachments: RustProgramAttachments,
  binary: string,
  nativeRoot: string,
): Promise<RustWorkspace> {
  const crates = productionCrates(dependencies);
  const runtimeDirectory = resolve(nativeRoot, "compiler/rust/runtime");
  const distributionDirectory = resolve(nativeRoot, "platforms/server/adapter/rust/distribution");
  const distribution = rustDistributionContracts(linked);
  const nativeInputs = [
    ...(await crateFiles(runtimeDirectory, "native/runtime")),
    ...(distribution.length ? await crateFiles(distributionDirectory, "native/distribution") : []),
    ...(
      await Promise.all(
        crates.map((implementation) =>
          crateFiles(
            implementation.crate.directory,
            `native/${productionDependencyDestination(implementation)}`,
          ),
        ),
      )
    ).flat(),
  ];
  const files: GeneratedFile[] = [
    {
      path: "Cargo.toml",
      source: cargoManifest(
        binary,
        runtimeDirectory,
        distribution.length ? distributionDirectory : undefined,
        dependencies,
      ),
    },
    {
      path: "src/main.rs",
      source: rustMain(linked.program.name, dependencies, distribution, attachments.bindings),
    },
    {
      path: "src/program.rs",
      source: `${generateRustProgram(linked, attachments.project, attachments.exports)}\n${rustProgramAttachmentDispatch(attachments.dispatch)}`,
    },
  ];
  return {
    binary,
    files,
    inputs: [...files, ...nativeInputs],
    packages: [
      binary,
      "kit-server-runtime",
      ...(distribution.length ? ["kit-server-distribution"] : []),
      ...crates.map(({ crate }) => crate.package),
    ],
  };
}

function rustDistributionContracts(linked: LinkedProgramIR): readonly RustDistributionContract[] {
  return linked.dependencies
    .filter((dependency) => dependency.provider !== undefined && dependency.reference !== undefined)
    .map((dependency) => {
      const operations = collectDependencyOperations(dependency);
      const synchronous = operations.find(({ mode }) => mode === "synchronous");
      if (synchronous) {
        throw new Error(
          `Identity-bound Dependency ${JSON.stringify(dependency.name)} operation ` +
            `${JSON.stringify(synchronous.name)} is synchronous and cannot cross a Process boundary.`,
        );
      }
      const contract = {
        name: dependency.name,
        operations,
        reference: dependency.reference,
      };
      return {
        name: dependency.name,
        identity: dependencyContractIdentity(contract),
        bindings: dependency.reference!.bindings,
        operations,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function canonicalGeneratedInputs(files: readonly GeneratedFile[]): readonly GeneratedFile[] {
  return files
    .map((file) => ({
      ...file,
      source: file.source.replaceAll(/^\s*\/\/ TypeScript: .+:\d+:\d+\s*$/gm, ""),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function crateFiles(directory: string, destination: string): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if ([".git", "target"].includes(entry.name) || entry.name === "Cargo.lock") continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        files.push({
          path: `${destination}/${relative(directory, path).replaceAll("\\", "/")}`,
          source: await readFile(path, "utf8"),
        });
      } else {
        throw new Error(`Production crate ${JSON.stringify(path)} contains an unsupported entry.`);
      }
    }
  };
  await visit(directory);
  if (!files.some(({ path }) => path === `${destination}/Cargo.toml`)) {
    throw new Error(`Production crate ${JSON.stringify(directory)} has no Cargo.toml.`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function cargoManifest(
  binary: string,
  runtimeDirectory: string,
  distributionDirectory: string | undefined,
  dependencies: readonly ResolvedServerProductionDependency[],
): string {
  const cargoDependencies = productionCrates(dependencies)
    .map(
      (implementation) =>
        `${implementation.crate.package} = { path = ${JSON.stringify(
          resolve(implementation.crate.directory),
        )} }`,
    )
    .join("\n");
  return `[package]
name = ${JSON.stringify(binary)}
version = "0.0.0"
edition = "2024"

[profile.dev]
debug = 0

[dependencies]
kit-server-runtime = { path = ${JSON.stringify(resolve(runtimeDirectory))} }
${distributionDirectory ? `kit-server-distribution = { path = ${JSON.stringify(resolve(distributionDirectory))} }\n` : ""}serde_json = "1.0.145"
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread", "signal"] }
${cargoDependencies}${cargoDependencies ? "\n" : ""}`;
}

function productionCrates(
  dependencies: readonly ResolvedServerProductionDependency[],
): readonly ServerProductionDependency[] {
  const crates = new Map<string, ServerProductionDependency>();
  for (const { implementation } of dependencies) {
    const package_ = implementation.crate.package;
    const existing = crates.get(package_);
    if (
      existing !== undefined &&
      resolve(existing.crate.directory) !== resolve(implementation.crate.directory)
    ) {
      throw new Error(
        `production Cargo package ${JSON.stringify(package_)} has conflicting sources.`,
      );
    }
    if (existing === undefined) crates.set(package_, implementation);
  }
  return [...crates.values()];
}

function productionDependencyDestination(implementation: ServerProductionDependency): string {
  const root = import.meta.dirname;
  const directory = relative(root, resolve(implementation.crate.directory)).replaceAll("\\", "/");
  if (
    directory &&
    !directory.startsWith("../") &&
    directory.split("/").every((part) => part && part !== "." && part !== "..")
  ) {
    return `crates/${directory}`;
  }
  return `crates/dependencies/${fileName(implementation.crate.package)}`;
}

function rustMain(
  program: string,
  dependencies: readonly ResolvedServerProductionDependency[],
  distribution: readonly RustDistributionContract[],
  bindings: readonly ProgramAttachmentBinding[],
): string {
  const providerAdapters = dependencies
    .map(({ dependency, implementation, operations }, index) =>
      rustProviderAdapter(index, dependency.name, implementation.rust.type, operations),
    )
    .join("\n\n");
  const wiring = dependencies
    .map(({ dependency, implementation, operations }, index) => {
      const configuration = implementation.configuration
        .map((field) => {
          const value = field.required
            ? `std::env::var(${rustString(field.environment)}).map_err(|_| NativeError::new(\
                "MissingConfiguration", ${rustString(`Missing ${field.environment}.`)}))?`
            : field.default === undefined
              ? `std::env::var(${rustString(field.environment)}).unwrap_or_default()`
              : `std::env::var(${rustString(field.environment)})\
                  .unwrap_or_else(|_| ${rustString(field.default)}.to_owned())`;
          return `(${rustString(field.name)}.to_owned(), ${value}),`;
        })
        .join("\n    ");
      const dependencies = (implementation.requires ?? [])
        .map(
          (name) =>
            `(${rustString(name)}.to_owned(), bindings.get(${rustString(
              name,
            )}).cloned().ok_or_else(|| NativeError::new("MissingDependency", ${rustString(
              `Missing production Dependency ${name}.`,
            )}))?),`,
        )
        .join("\n    ");
      return `let configuration = BTreeMap::from([
        ${configuration}
    ]);
    let dependencies = BTreeMap::from([
        ${dependencies}
    ]);
    let implementation: ${implementation.rust.type} = ${implementation.rust.constructor}(DependencyContext {
        name: ${rustString(dependency.name)}.to_owned(),
        configuration,
        dependencies,
    }).await?;
    let implementation = NativeDependency${index} { implementation };
    let implementation = ContractDependency::new(
        ${rustString(dependency.name)},
        vec![
${operations.map((operation) => `            ${rustOperationContract(operation)},`).join("\n")}
        ],
        implementation,
    )?;
    let dependency_${index}: Arc<dyn Dependency> = Arc::new(implementation);
    engine.register(${rustString(dependency.name)}, dependency_${index}.clone())?;
    bindings.insert(${rustString(dependency.name)}.to_owned(), dependency_${index});`;
    })
    .join("\n\n    ");
  const distributed = distribution.length
    ? `kit_server_distribution::start(
        engine.clone(),
        ${rustString(program)},
        &std::env::var("KIT_PROCESS_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_owned()),
        vec![
${distribution.map((contract) => rustDistributionContract(contract)).join("\n")}
        ],
    ).await?;`
    : "";
  return `use std::{collections::BTreeMap, sync::Arc};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeResult${
      dependencies.length ? ", ContractDependency, OperationContract" : ""
    }${dependencies.length ? ", DependencyInvocation, NativeFuture" : ""}${
      dependencies.length || distribution.length ? ", FieldContract, TypeContract" : ""
    }${bindings.length ? ", NativeFunction, Value" : ""}${
      dependencies.length && !bindings.length ? ", Value" : ""
    }
};

${providerAdapters}

mod program;

#[tokio::main]
async fn main() {
    write_process_status("starting");
    if let Err(error) = run().await {
        write_process_status("failed");
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn write_process_status(status: &str) {
    let Ok(path) = std::env::var("KIT_PROCESS_STATUS_FILE") else {
        return;
    };
    let temporary = format!("{path}.{}.tmp", std::process::id());
    let contents = format!(
        r#"{{"status":"{status}","pid":{}}}"#,
        std::process::id(),
    );
    if std::fs::write(&temporary, contents).is_ok() {
        let _ = std::fs::rename(temporary, path);
    }
}

async fn run() -> NativeResult<()> {
    let engine = Engine::new();
    let mut bindings: BTreeMap<String, Arc<dyn Dependency>> = BTreeMap::new();
    ${wiring}

    ${bindings.map((binding, index) => rustProgramAttachmentBinding(binding, index)).join("\n\n    ")}

    if let Err(error) = engine.start_dependencies().await {
        let _ = engine.shutdown().await;
        return Err(error);
    }
    if let Err(error) = program::start(engine.clone()).await {
        let _ = engine.shutdown().await;
        return Err(error);
    }
    ${distributed}
    write_process_status("ready");
    if engine.has_live_resources() {
        tokio::signal::ctrl_c()
            .await
            .map_err(|error| NativeError::new("SignalFailure", error.to_string()))?;
    }
    write_process_status("draining");
    let result = engine.shutdown().await;
    if result.is_ok() {
        write_process_status("stopped");
    }
    result
}
`;
}

function rustProviderAdapter(
  index: number,
  dependency: string,
  implementation: string,
  operations: readonly DependencyOperationIR[],
): string {
  const methods = new Set<string>();
  for (const operation of operations) {
    const method = rustProviderOperation(operation.name);
    if (methods.has(method)) {
      throw new Error(
        `Dependency ${JSON.stringify(dependency)} operations collide as native method ${JSON.stringify(method)}.`,
      );
    }
    methods.add(method);
  }
  return `struct NativeDependency${index} {
    implementation: ${implementation},
}

impl Dependency for NativeDependency${index} {
    fn start(&self, engine: Engine) -> NativeFuture<()> {
        Dependency::start(&self.implementation, engine)
    }

    fn call(
        &self,
        engine: Engine,
        operation: &str,
        input: Value,
        invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        match operation {
${operations
  .map(
    (operation) =>
      `            ${rustString(operation.name)} => ${implementation}::${rustProviderOperation(
        operation.name,
      )}(&self.implementation, engine, input, invocation),`,
  )
  .join("\n")}
            operation if operation.starts_with('@') => {
                Dependency::call(&self.implementation, engine, operation, input, invocation)
            }
            operation => {
                let operation = operation.to_owned();
                Box::pin(async move {
                    Err(NativeError::new(
                        "UnknownOperation",
                        format!(
                            "Dependency {} has no operation {:?}.",
                            ${rustString(dependency)},
                            operation,
                        ),
                    ))
                })
            }
        }
    }

    fn shutdown(&self) -> NativeFuture<()> {
        Dependency::shutdown(&self.implementation)
    }
}`;
}

function rustProviderOperation(operation: string): string {
  return `operation_${rustName(operation)}`;
}

function rustDistributionContract(contract: RustDistributionContract): string {
  return `            kit_server_distribution::DistributionContract {
                name: ${rustString(contract.name)},
                identity: ${rustString(contract.identity)},
                bindings: vec![${contract.bindings.map(rustString).join(", ")}],
                operations: vec![
${contract.operations
  .map(
    (operation) => `                    kit_server_distribution::DistributionOperation {
                        name: ${rustString(operation.name)},
                        identity: ${rustString(dependencyOperationIdentity(operation))},
                        mode: kit_server_distribution::DistributionOperationMode::${
                          operation.mode === "stream" ? "Stream" : "Asynchronous"
                        },
                        input: ${rustTypeContract(operation.input)},
                        output: ${rustTypeContract(operation.output)},
                        heartbeat: ${
                          operation.heartbeat
                            ? `Some(${rustTypeContract(operation.heartbeat)})`
                            : "None"
                        },
                        failures: ${rustFailureContracts(operation.failures)},
                    },`,
  )
  .join("\n")}
                ],
            },`;
}

function rustFailureContracts(type: TypeIR | undefined): string {
  if (!type) return "BTreeMap::new()";
  if (type.kind !== "record") {
    throw new Error("Dependency failures must be a record of named failures.");
  }
  return `BTreeMap::from([${[...type.fields]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, type: failure }) => `(${rustString(name)}, ${rustTypeContract(failure)})`)
    .join(", ")}])`;
}

function rustProgramAttachmentDispatch(
  exports: readonly Readonly<{ name: string; function: string }>[],
): string {
  if (!exports.length) return "";
  return `pub fn invoke_program_export(
    engine: Engine,
    selector: &'static str,
    input: Value,
) -> NativeFuture<Value> {
    Box::pin(async move {
        let export = input.property(selector, false)?.string()?;
        match export.as_str() {
${exports
  .map(
    ({ name, function: functionName }) =>
      `            ${rustString(name)} => ${functionName}(engine, input).await,`,
  )
  .join("\n")}
            _ => Err(NativeError::new(
                "UnknownProgramExport",
                format!("Unknown Program export {export:?}."),
            )),
        }
    })
}
`;
}

function rustProgramAttachmentBinding(binding: ProgramAttachmentBinding, index: number): string {
  for (const [name, value] of Object.entries(binding)) {
    if (!value.trim()) {
      throw new Error(`Portable Program attachment binding ${JSON.stringify(name)} is empty.`);
    }
  }
  return `let attachment_${index} = NativeFunction::new(|engine, arguments| {
        let input = arguments.into_iter().next().unwrap_or(Value::Undefined);
        program::invoke_program_export(engine, ${rustString(binding.selector)}, input)
    });
    let registration_${index} = engine.call_dependency(
        ${rustString(binding.dependency)},
        ${rustString(binding.operation)},
        Value::record(BTreeMap::from([(
            ${rustString(binding.field)}.to_owned(),
            Value::Function(attachment_${index}),
        )])),
    ).await?;
    engine.retain(registration_${index});`;
}

function validateProgramAttachmentBindings(
  dependencies: readonly ResolvedServerProductionDependency[],
  bindings: readonly ProgramAttachmentBinding[],
): void {
  for (const binding of bindings) {
    const dependency = dependencies.find(
      ({ dependency }) => dependency.name === binding.dependency,
    );
    if (!dependency) {
      throw new Error(
        `Portable Program attachment requires missing production Dependency ` +
          `${JSON.stringify(binding.dependency)}.`,
      );
    }
    if (!dependency.implementation.bindings?.includes(binding.operation)) {
      throw new Error(
        `Production Dependency ${JSON.stringify(dependency.implementation.name)} does not ` +
          `support Program attachment binding ${JSON.stringify(binding.operation)}.`,
      );
    }
  }
}

function rustString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\\u2028", "\\u{2028}")
    .replaceAll("\\u2029", "\\u{2029}");
}

function rustOperationContract(
  operation: ResolvedServerProductionDependency["operations"][number],
): string {
  return `OperationContract {
                name: ${rustString(operation.name)},
                input: ${rustTypeContract(operation.input)},
                output: ${rustTypeContract(
                  operation.mode === "stream"
                    ? { kind: "stream", element: operation.output }
                    : operation.output,
                )},
            }`;
}

function rustTypeContract(type: TypeIR): string {
  switch (type.kind) {
    case "primitive":
      return `TypeContract::Primitive(${rustString(type.name)})`;
    case "opaque":
      return `TypeContract::Opaque(${rustString(type.name)})`;
    case "literal":
      if (typeof type.value === "boolean") {
        return `TypeContract::LiteralBoolean(${String(type.value)})`;
      }
      if (typeof type.value === "number") {
        return `TypeContract::LiteralNumber(${rustNumber(type.value)})`;
      }
      return `TypeContract::LiteralString(${rustString(type.value)})`;
    case "array":
      return `TypeContract::Array(Box::new(${rustTypeContract(type.element)}))`;
    case "tuple":
      return `TypeContract::Tuple(vec![${type.elements.map(rustTypeContract).join(", ")}])`;
    case "option":
      return `TypeContract::Option(Box::new(${rustTypeContract(type.value)}))`;
    case "union":
      return `TypeContract::Union(vec![${type.variants.map(rustTypeContract).join(", ")}])`;
    case "record":
      return `TypeContract::Record(vec![${type.fields
        .map(
          (field) =>
            `FieldContract { name: ${rustString(field.name)}, optional: ${String(
              field.optional,
            )}, value: ${rustTypeContract(field.type)} }`,
        )
        .join(", ")}])`;
    case "promise":
      return rustTypeContract(type.value);
    case "stream":
      return `TypeContract::Stream(Box::new(${rustTypeContract(type.element)}))`;
    case "function":
      return "TypeContract::Function";
  }
}

export function rustNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Rust production cannot represent a non-finite number literal.");
  }
  return `${String(value)}f64`;
}

function result(
  cache: ServerProductionBuild["cache"],
  compiled: readonly string[],
  started: number,
  executable: string,
  semanticHash: string,
  profile: ServerProductionProfile,
  workspace: string,
  requirements: readonly ServerProductionRequirement[],
): ServerProductionBuild {
  return {
    executable,
    semanticHash,
    cache,
    profile,
    workspace,
    compiledCrates: compiled,
    durationMs: Math.round(performance.now() - started),
    requirements,
  };
}

async function copyExecutable(source: string, output: string): Promise<void> {
  await copyFile(source, output);
  await chmod(output, 0o755);
}

async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now).catch(() => undefined);
}

async function retainCache(
  cacheRoot: string,
  currentWorkspace: string,
  currentArtifact: string,
): Promise<void> {
  const configured = Number(process.env.KIT_PRODUCTION_CACHE_ENTRIES ?? DEFAULT_CACHE_ENTRIES);
  const entries =
    Number.isSafeInteger(configured) && configured > 1 ? configured : DEFAULT_CACHE_ENTRIES;
  await touch(currentWorkspace);
  await touch(resolve(cacheRoot, "artifacts", currentArtifact));
  await retainDirectories(resolve(cacheRoot, "artifacts"), entries * 2, currentArtifact);
  const project = relative(resolve(cacheRoot, "workspaces"), currentWorkspace).split("/")[0];
  await retainDirectories(
    resolve(cacheRoot, "workspaces"),
    entries,
    project,
    async (directory) => {
      await cleanGeneratedPackages(directory, resolve(cacheRoot, "target"));
    },
    CACHE_WORKSPACE_GRACE_MS,
  );
  await retainTargetCache(cacheRoot, currentWorkspace);
}

async function retainDirectories(
  directory: string,
  limit: number,
  preserve: string | undefined,
  beforeRemove?: (directory: string) => Promise<void>,
  minimumAgeMs = 0,
  hardLimit = MAX_CACHE_ENTRIES,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const maximum = Math.max(limit, hardLimit);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== preserve)
      .map(async (entry) => ({
        name: entry.name,
        path: resolve(directory, entry.name),
        used: (await stat(resolve(directory, entry.name))).mtimeMs,
      })),
  );
  const total = entries.filter((entry) => entry.isDirectory()).length;
  const expired = candidates
    .filter(({ used }) => Date.now() - used >= minimumAgeMs)
    .sort((left, right) => left.used - right.used);
  const selected = expired.slice(0, Math.max(0, total - limit));
  const selectedNames = new Set(selected.map(({ name }) => name));
  selected.push(
    ...candidates
      .filter(({ name }) => !selectedNames.has(name))
      .sort((left, right) => left.used - right.used)
      .slice(0, Math.max(0, total - selected.length - maximum)),
  );
  for (const candidate of selected) {
    await beforeRemove?.(candidate.path);
    await rm(candidate.path, { force: true, recursive: true });
  }
}

async function cleanGeneratedPackages(directory: string, target: string): Promise<void> {
  for (const workspace of await generatedWorkspaces(directory)) {
    const source = await readFile(resolve(workspace, "Cargo.toml"), "utf8");
    const packageName = source.match(/\nname = "([^"]+)"/)?.[1];
    if (!packageName) continue;
    await command(
      "cargo",
      [
        "clean",
        "--manifest-path",
        resolve(workspace, "Cargo.toml"),
        "--target-dir",
        target,
        "-p",
        packageName,
      ],
      workspace,
    );
  }
}

async function generatedWorkspaces(directory: string): Promise<readonly string[]> {
  const workspaces: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "Cargo.toml")) {
      workspaces.push(current);
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => visit(resolve(current, entry.name))),
    );
  };
  await visit(directory);
  return workspaces;
}

async function retainTargetCache(cacheRoot: string, workspace: string): Promise<void> {
  const marker = resolve(cacheRoot, ".retained");
  const previous = await stat(marker).catch(() => undefined);
  if (previous && Date.now() - previous.mtimeMs < CACHE_RETENTION_INTERVAL_MS) return;
  const lock = resolve(cacheRoot, ".retention-lock");
  if (!(await acquireRetentionLock(lock))) return;
  try {
    const retained = await stat(marker).catch(() => undefined);
    if (retained && Date.now() - retained.mtimeMs < CACHE_RETENTION_INTERVAL_MS) return;
    const target = resolve(cacheRoot, "target");
    const configured = Number(
      process.env.KIT_PRODUCTION_TARGET_CACHE_BYTES ?? DEFAULT_TARGET_CACHE_BYTES,
    );
    const limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_TARGET_CACHE_BYTES;
    if ((await directoryBytes(target)) > limit) {
      const cleaned = await command(
        "cargo",
        ["clean", "--manifest-path", resolve(workspace, "Cargo.toml"), "--target-dir", target],
        workspace,
      );
      if (cleaned.code !== 0) {
        throw new Error(`Cannot retain the generated native cache:\n${cleaned.stderr}`);
      }
    }
    await writeFile(marker, String(Date.now()));
  } finally {
    await rm(lock, { force: true, recursive: true });
  }
}

async function acquireRetentionLock(lock: string): Promise<boolean> {
  try {
    await mkdir(lock);
    return true;
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  const existing = await stat(lock).catch(() => undefined);
  if (existing && Date.now() - existing.mtimeMs < CACHE_RETENTION_INTERVAL_MS) return false;
  await rm(lock, { force: true, recursive: true });
  try {
    await mkdir(lock);
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  }
}

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

function compiledCrates(
  outputs: readonly string[],
  packages: readonly string[],
): readonly string[] {
  const expected = new Set(packages.map((name) => name.replaceAll("-", "_")));
  const compiled = new Set<string>();
  for (const line of outputs.flatMap((output) => output.split("\n"))) {
    try {
      const message = JSON.parse(line) as {
        reason?: string;
        fresh?: boolean;
        target?: { name?: string };
      };
      const name = message.target?.name;
      if (
        message.reason === "compiler-artifact" &&
        message.fresh === false &&
        name &&
        expected.has(name)
      ) {
        compiled.add(name);
      }
    } catch {
      // Cargo may mix human-readable status lines into the JSON stream.
    }
  }
  return [...compiled].sort();
}

function cargoErrors(value: Readonly<{ stdout: string; stderr: string }>): string {
  const rendered: string[] = [];
  for (const line of value.stdout.split("\n")) {
    try {
      const message = JSON.parse(line) as {
        reason?: string;
        message?: { rendered?: string };
      };
      if (message.reason === "compiler-message" && message.message?.rendered) {
        rendered.push(message.message.rendered);
      }
    } catch {
      // Preserve Cargo's stderr below when a line is not JSON.
    }
  }
  return rendered.join("\n") || value.stderr || value.stdout;
}

function packageName(program: string): string {
  return `kit_${rustName(program)}`;
}

function fileName(value: string): string {
  return rustName(value).replaceAll("_", "-") || "program";
}

async function packageNativeSourceRoot(): Promise<string> {
  let directory = import.meta.dirname;
  while (true) {
    if (await exists(resolve(directory, "package.json"))) {
      for (const source of [resolve(directory, "src"), resolve(directory, "dist/source")]) {
        if (await exists(resolve(source, "compiler/rust/runtime/Cargo.toml"))) return source;
      }
      throw new Error(`Package ${JSON.stringify(directory)} has no native compiler source tree.`);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Cannot locate the package root for native compilation.");
    }
    directory = parent;
  }
}

function canonicalProductionDependency(
  implementation: ServerProductionDependency,
  nativeRoot: string,
): ServerProductionDependency {
  return defineServerProductionDependency({
    ...implementation,
    crate: {
      ...implementation.crate,
      directory: canonicalNativeDirectory(implementation.crate.directory, nativeRoot),
    },
  });
}

function canonicalNativeDirectory(directory: string, nativeRoot: string): string {
  const root = nativeRoot.endsWith("/dist/source")
    ? dirname(dirname(nativeRoot))
    : dirname(nativeRoot);
  const absolute = resolve(directory);
  for (const source of [
    resolve(root, "src"),
    resolve(root, "dist/source"),
    resolve(root, "dist/src"),
  ]) {
    const path = relative(source, absolute);
    if (path === "") return nativeRoot;
    if (!path.startsWith("../") && !isAbsolute(path)) return resolve(nativeRoot, path);
  }
  return absolute;
}

function rustName(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const name = normalized || "value";
  return /^[0-9]/.test(name) ? `value_${name}` : name;
}

function duplicate(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} ${JSON.stringify(value)} is duplicated.`);
    seen.add(value);
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeIfChanged(path: string, value: string): Promise<boolean> {
  const previous = await readFile(path, "utf8").catch(() => undefined);
  if (previous === value) return false;
  await writeFile(path, value);
  return true;
}

async function writeGeneratedFile(
  workspace: string,
  path: string,
  file: GeneratedFile,
): Promise<boolean> {
  if (!file.path.endsWith(".rs")) return writeIfChanged(path, file.source);
  const marker = resolve(workspace, ".kit", `${digest(file.path)}.source`);
  const sourceHash = digest(file.source);
  if (
    (await readFile(marker, "utf8").catch(() => undefined)) === sourceHash &&
    (await exists(path))
  ) {
    return false;
  }
  await writeFile(path, file.source);
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, sourceHash);
  return true;
}

function command(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd, env: environment, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => (stdout += value));
    child.stderr.setEncoding("utf8").on("data", (value: string) => (stderr += value));
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}
