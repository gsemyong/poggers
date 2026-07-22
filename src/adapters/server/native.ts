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

import { nativeServerCapabilities } from "@/adapters/server/native/capabilities";
import { generateNativeProgram } from "@/adapters/server/native/program";
import {
  resolveNativeCapabilityAdapters,
  type NativeCapabilityAdapter,
  type ResolvedNativeCapability,
} from "@/contracts/native";
import { linkProgram, type LinkedProgramIR, type ProgramIR } from "@/core/compiler/ir";

const NATIVE_ADAPTER_VERSION = 5;

export type NativeServerBuild = Readonly<{
  executable: string;
  semanticHash: string;
  cache: "hit" | "miss";
  workspace: string;
  compiledCrates: readonly string[];
  durationMs: number;
}>;

/** Builds one linked server Program as a standalone Rust executable. */
export async function buildNativeServerProgram(input: {
  application: string;
  adapters?: readonly NativeCapabilityAdapter[];
  cache?: string;
  directory: string;
  /** Runs strict Clippy verification in addition to the production build. */
  lint?: boolean;
  output: string;
  program: ProgramIR;
}): Promise<NativeServerBuild> {
  const started = performance.now();
  const linked = linkProgram(input.program);
  assertNativeProgram(linked);
  const overrides = new Set(
    (input.adapters ?? []).map(({ contract, platform }) => `${platform}\0${contract.name}`),
  );
  const adapters = resolveNativeCapabilityAdapters({
    platform: input.program.environment.platform,
    capabilities: linked.external,
    adapters: [
      ...nativeServerCapabilities.filter(
        ({ contract, platform }) => !overrides.has(`${platform}\0${contract.name}`),
      ),
      ...(input.adapters ?? []),
    ],
  });
  const generated = await generateNativeWorkspace(linked, adapters);
  const toolchain = await rustToolchain();
  const semanticHash = digest(
    JSON.stringify({
      version: NATIVE_ADAPTER_VERSION,
      target: `${process.platform}-${process.arch}`,
      toolchain,
      files: [...generated.files].sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
  const cacheRoot = resolve(
    input.cache ?? process.env.POGGERS_NATIVE_CACHE ?? resolve(homedir(), ".cache/poggers/native"),
  );
  const project = digest(
    JSON.stringify({
      application: input.application,
      program: semanticProgram(linked),
      adapters: adapters.map(({ adapter }) => ({
        name: adapter.name,
        package: adapter.crate.package,
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
  const lockMarker = resolve(workspace, ".poggers/Cargo.lock.source");
  const dependencyGraphChanged =
    (await readFile(lockMarker, "utf8").catch(() => undefined)) !== dependencyGraphHash;
  const formatted = await command("cargo", ["fmt", "--all", "--", "--check"], workspace);
  if (formatted.code !== 0) {
    const format = await command("cargo", ["fmt", "--all"], workspace);
    if (format.code !== 0) {
      throw new Error(`Generated native server formatting failed:\n${format.stderr}`);
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
      throw new Error(`Generated native server failed linting:\n${cargoErrors(linted)}`);
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
  if (process.env.POGGERS_NATIVE_TIMINGS === "1") buildArguments.push("--timings");
  const built = await command("cargo", buildArguments, workspace, environment);
  if (built.code !== 0) {
    throw new Error(`Generated native server failed to build:\n${cargoErrors(built)}`);
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

function assertNativeProgram(linked: LinkedProgramIR): void {
  for (const { contribution } of linked.contributions) {
    if (contribution.implementation.kind !== "source") continue;
    const { span } = contribution.implementation;
    throw new Error(
      `${span.file}:${span.line}:${span.column}: Program contribution ` +
        `${JSON.stringify(contribution.id)} is source, not native-realizable product meaning.`,
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

type NativeFile = Readonly<{ path: string; source: string }>;
type NativeWorkspace = Readonly<{
  binary: string;
  files: readonly NativeFile[];
  packages: readonly string[];
}>;

async function generateNativeWorkspace(
  linked: LinkedProgramIR,
  capabilities: readonly ResolvedNativeCapability[],
): Promise<NativeWorkspace> {
  duplicate(
    capabilities.map(({ adapter }) => adapter.crate.package),
    "native Cargo package",
  );
  const binary = packageName(linked.program.name);
  const runtimeDirectory = resolve(import.meta.dirname, "native/runtime");
  const files: NativeFile[] = [
    ...(await crateFiles(runtimeDirectory, "crates/runtime")),
    {
      path: "Cargo.toml",
      source: nativeManifest(binary, capabilities),
    },
    {
      path: "src/main.rs",
      source: nativeMain(capabilities),
    },
    {
      path: "src/program.rs",
      source: generateNativeProgram(linked),
    },
  ];
  for (const { adapter } of capabilities) {
    files.push(
      ...(await crateFiles(
        adapter.crate.directory,
        `crates/capabilities/${fileName(adapter.crate.package)}`,
      )),
    );
  }
  return {
    binary,
    files,
    packages: [
      binary,
      "poggers-native-runtime",
      ...capabilities.map(({ adapter }) => adapter.crate.package),
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

async function crateFiles(directory: string, destination: string): Promise<NativeFile[]> {
  const files: NativeFile[] = [];
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
        throw new Error(`Native crate ${JSON.stringify(path)} contains an unsupported entry.`);
      }
    }
  };
  await visit(directory);
  if (!files.some(({ path }) => path === `${destination}/Cargo.toml`)) {
    throw new Error(`Native crate ${JSON.stringify(directory)} has no Cargo.toml.`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function nativeManifest(binary: string, capabilities: readonly ResolvedNativeCapability[]): string {
  const dependencies = capabilities
    .map(
      ({ adapter }) =>
        `${adapter.crate.package} = { path = ${JSON.stringify(
          `crates/capabilities/${fileName(adapter.crate.package)}`,
        )} }`,
    )
    .join("\n");
  return `[package]
name = ${JSON.stringify(binary)}
version = "0.0.0"
edition = "2024"

[dependencies]
poggers-native-runtime = { path = "crates/runtime" }
serde_json = "1.0.145"
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread", "signal"] }
${dependencies}${dependencies ? "\n" : ""}`;
}

function nativeMain(capabilities: readonly ResolvedNativeCapability[]): string {
  const wiring = capabilities
    .map(({ capability, adapter }, index) => {
      const configuration = adapter.configuration
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
      const dependencies = (adapter.requires ?? [])
        .map(
          (name) =>
            `(${rustString(name)}.to_owned(), adapters.get(${rustString(
              name,
            )}).cloned().ok_or_else(|| NativeError::new("MissingCapability", ${rustString(
              `Missing native adapter dependency ${name}.`,
            )}))?),`,
        )
        .join("\n    ");
      return `let configuration = BTreeMap::from([
        ${configuration}
    ]);
    let dependencies = BTreeMap::from([
        ${dependencies}
    ]);
    let implementation: ${adapter.rust.type} = ${adapter.rust.constructor}(CapabilityContext {
        name: ${rustString(capability.name)}.to_owned(),
        configuration,
        dependencies,
    }).await?;
    let capability_${index}: Arc<dyn Capability> = Arc::new(implementation);
    engine.register(${rustString(capability.name)}, capability_${index}.clone())?;
    adapters.insert(${rustString(capability.name)}.to_owned(), capability_${index});`;
    })
    .join("\n\n    ");
  return `use std::{collections::BTreeMap, sync::Arc};

use poggers_native_runtime::{
    Capability, CapabilityContext, Engine, NativeError, NativeResult,
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
    let mut adapters: BTreeMap<String, Arc<dyn Capability>> = BTreeMap::new();
    ${wiring}

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

function rustString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\\u2028", "\\u{2028}")
    .replaceAll("\\u2029", "\\u{2029}");
}

function result(
  cache: NativeServerBuild["cache"],
  compiled: readonly string[],
  started: number,
  executable: string,
  semanticHash: string,
  workspace: string,
): NativeServerBuild {
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
  return `poggers_${rustName(program)}`;
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
  file: NativeFile,
): Promise<boolean> {
  if (!file.path.endsWith(".rs")) return writeIfChanged(path, file.source);
  const marker = resolve(workspace, ".poggers", `${digest(file.path)}.source`);
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
