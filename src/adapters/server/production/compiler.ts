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
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

import { planWebRouteLoaders, type WebRouteLoaderPlan } from "@/adapters/integration/web-server";
import {
  resolveServerProductionDependencies,
  serverProductionDependencies,
  type ResolvedServerProductionDependency,
  type ServerProductionDependency,
} from "@/adapters/server/production/dependencies";
import {
  generateRustProgram,
  type RustProgramFunctionExport,
} from "@/adapters/server/production/program";
import type { SystemIR, LinkedProgramIR, ProgramIR, TypeIR } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";

const SERVER_PRODUCTION_VERSION = 7;

export type ServerProductionBuild = Readonly<{
  executable: string;
  semanticHash: string;
  cache: "hit" | "miss";
  workspace: string;
  compiledCrates: readonly string[];
  durationMs: number;
}>;

/** Builds one linked server Program as a standalone Rust executable. */
export async function buildServerProgram(input: {
  system: string;
  ir?: SystemIR;
  dependencies?: readonly ServerProductionDependency[];
  cache?: string;
  directory: string;
  /** Runs strict Clippy verification in addition to the production build. */
  lint?: boolean;
  output: string;
  program: ProgramIR;
}): Promise<ServerProductionBuild> {
  const started = performance.now();
  const web = rustWebLoaders(planWebRouteLoaders(input.program, input.ir));
  const linked = linkProgram({
    ...input.program,
    contributions: [...input.program.contributions, ...web.contributions],
  });
  assertPortableProgram(linked);
  const overrides = new Set((input.dependencies ?? []).map(({ dependency }) => dependency));
  const dependencies = resolveServerProductionDependencies({
    dependencies: linked.external,
    implementations: [
      ...serverProductionDependencies.filter(({ dependency }) => !overrides.has(dependency)),
      ...(input.dependencies ?? []),
    ],
  });
  const generated = await generateRustWorkspace(linked, dependencies, web);
  const toolchain = await rustToolchain();
  const semanticHash = digest(
    JSON.stringify({
      version: SERVER_PRODUCTION_VERSION,
      target: `${process.platform}-${process.arch}`,
      toolchain,
      files: [...generated.files].sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
  const cacheRoot = resolve(
    input.cache ?? process.env.KIT_PRODUCTION_CACHE ?? resolve(homedir(), ".cache/kit/production"),
  );
  const project = digest(
    JSON.stringify({
      system: input.system,
      program: semanticProgram(linked),
      dependencies: dependencies.map(({ implementation }) => ({
        name: implementation.name,
        package: implementation.crate.package,
      })),
    }),
  ).slice(0, 16);
  const workspace = resolve(cacheRoot, "workspaces", project, fileName(input.program.name));
  const cached = resolve(cacheRoot, "artifacts", semanticHash, fileName(input.program.name));
  const lintedMarker = resolve(cacheRoot, "checks", `${semanticHash}.clippy`);
  await mkdir(dirname(input.output), { recursive: true });
  const artifactCached = await exists(cached);
  if (artifactCached && (!input.lint || (await exists(lintedMarker)))) {
    await copyExecutable(cached, input.output);
    return result("hit", [], started, input.output, semanticHash, workspace);
  }

  for (const file of generated.files) {
    const path = resolve(workspace, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeGeneratedFile(workspace, path, file);
  }
  const dependencyGraphHash = digest(
    JSON.stringify(generated.files.filter(({ path }) => path.endsWith("Cargo.toml"))),
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
  const environment = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "1" };
  if (input.lint) {
    const lintArguments = ["clippy", "--release", "--message-format=json"];
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
    return result("hit", [], started, input.output, semanticHash, workspace);
  }
  const buildArguments = ["build", "--release", "--message-format=json"];
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
  const executable = resolve(workspace, "target/release", generated.binary);
  await mkdir(dirname(cached), { recursive: true });
  const temporary = `${cached}.${process.pid}.tmp`;
  await copyFile(executable, temporary);
  await rename(temporary, cached).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    if (!(await exists(cached))) throw error;
  });
  await copyExecutable(cached, input.output);
  return result(
    "miss",
    compiledCrates([built.stdout], generated.packages),
    started,
    input.output,
    semanticHash,
    workspace,
  );
}

function assertPortableProgram(linked: LinkedProgramIR): void {
  for (const { contribution } of linked.contributions) {
    if (contribution.implementation.kind !== "source") continue;
    const { span } = contribution.implementation;
    throw new Error(
      `${span.file}:${span.line}:${span.column}: Program contribution ` +
        `${JSON.stringify(contribution.id)} is source, not production-realizable product meaning.`,
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
  packages: readonly string[];
}>;

type RustWebLoaders = Readonly<{
  contributions: WebRouteLoaderPlan["contributions"];
  exports: readonly RustProgramFunctionExport[];
  routes: readonly Readonly<{ id: string; function: string }>[];
}>;

function rustWebLoaders(plan: WebRouteLoaderPlan): RustWebLoaders {
  return {
    contributions: plan.contributions,
    exports: plan.loaders.map((loader) => ({
      name: loader.export,
      contribution: loader.contribution,
      function: loader.implementation.entry.id,
      dependencies: loader.dependencies,
    })),
    routes: plan.loaders.map((loader) => ({ id: loader.route, function: loader.export })),
  };
}

async function generateRustWorkspace(
  linked: LinkedProgramIR,
  dependencies: readonly ResolvedServerProductionDependency[],
  web: RustWebLoaders,
): Promise<RustWorkspace> {
  duplicate(
    dependencies.map(({ implementation }) => implementation.crate.package),
    "production Cargo package",
  );
  const binary = packageName(linked.program.name);
  const runtimeDirectory = resolve(import.meta.dirname, "runtime");
  const files: GeneratedFile[] = [
    ...(await crateFiles(runtimeDirectory, "crates/runtime")),
    {
      path: "Cargo.toml",
      source: cargoManifest(binary, dependencies),
    },
    {
      path: "src/main.rs",
      source: rustMain(dependencies, web.routes.length > 0),
    },
    {
      path: "src/program.rs",
      source: `${generateRustProgram(linked, web.exports)}\n${rustWebLoaderDispatch(web.routes)}`,
    },
  ];
  for (const { implementation } of dependencies) {
    files.push(
      ...(await crateFiles(
        implementation.crate.directory,
        productionDependencyDestination(implementation),
      )),
    );
  }
  return {
    binary,
    files,
    packages: [
      binary,
      "kit-server-runtime",
      ...dependencies.map(({ implementation }) => implementation.crate.package),
    ],
  };
}

function semanticProgram(linked: LinkedProgramIR): unknown {
  return stripSourceSpans({
    ...linked.program,
    contributions: linked.contributions.map(({ contribution }) => contribution),
  });
}

function stripSourceSpans(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSourceSpans);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== "span")
      .map(([name, child]) => [name, stripSourceSpans(child)]),
  );
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
  dependencies: readonly ResolvedServerProductionDependency[],
): string {
  const cargoDependencies = dependencies
    .map(
      ({ implementation }) =>
        `${implementation.crate.package} = { path = ${JSON.stringify(
          productionDependencyDestination(implementation),
        )} }`,
    )
    .join("\n");
  return `[package]
name = ${JSON.stringify(binary)}
version = "0.0.0"
edition = "2024"

[dependencies]
kit-server-runtime = { path = "crates/runtime" }
serde_json = "1.0.145"
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread", "signal"] }
${cargoDependencies}${cargoDependencies ? "\n" : ""}`;
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
  dependencies: readonly ResolvedServerProductionDependency[],
  webLoaders: boolean,
): string {
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
  return `use std::{collections::BTreeMap, sync::Arc};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeResult${
      dependencies.length
        ? ", ContractDependency, FieldContract, OperationContract, TypeContract"
        : ""
    }${webLoaders ? ", NativeFunction, Value" : ""},
};

mod program;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> NativeResult<()> {
    let engine = Engine::new();
    let mut bindings: BTreeMap<String, Arc<dyn Dependency>> = BTreeMap::new();
    ${wiring}

    ${
      webLoaders
        ? `let loader = NativeFunction::new(|engine, arguments| {
        let input = arguments.into_iter().next().unwrap_or(Value::Undefined);
        program::load_web_route(engine, input)
    });
    let registration = engine.call_dependency(
        "http",
        "@web-loader",
        Value::record(BTreeMap::from([("handle".to_owned(), Value::Function(loader))])),
    ).await?;
    engine.retain(registration);`
        : ""
    }

    if let Err(error) = program::start(engine.clone()).await {
        let _ = engine.shutdown().await;
        return Err(error);
    }
    if engine.has_live_resources() {
        tokio::signal::ctrl_c()
            .await
            .map_err(|error| NativeError::new("SignalFailure", error.to_string()))?;
    }
    engine.shutdown().await
}
`;
}

function rustWebLoaderDispatch(
  routes: readonly Readonly<{ id: string; function: string }>[],
): string {
  if (!routes.length) return "";
  return `pub fn load_web_route(engine: Engine, input: Value) -> NativeFuture<Value> {
    Box::pin(async move {
        let route = input.property("route", false)?.string()?;
        match route.as_str() {
${routes
  .map(({ id, function: name }) => `            ${rustString(id)} => ${name}(engine, input).await,`)
  .join("\n")}
            _ => Err(NativeError::new("UnknownWebRoute", format!("Unknown web Route {route:?}."))),
        }
    })
}
`;
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
        return `TypeContract::LiteralNumber(${String(type.value)})`;
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

function result(
  cache: ServerProductionBuild["cache"],
  compiled: readonly string[],
  started: number,
  executable: string,
  semanticHash: string,
  workspace: string,
): ServerProductionBuild {
  return {
    executable,
    semanticHash,
    cache,
    workspace,
    compiledCrates: compiled,
    durationMs: Math.round(performance.now() - started),
  };
}

async function copyExecutable(source: string, output: string): Promise<void> {
  await copyFile(source, output);
  await chmod(output, 0o755);
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
