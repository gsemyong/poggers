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
import { dirname, resolve } from "node:path";

import type { ProgramContributionIR, ProgramIR } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { generateRustProgram } from "@/compiler/rust/lowering";

type RustVerificationSource = Readonly<{
  name: string;
  manifest: string;
  main: string;
  program: string;
}>;

type RustVerificationProfile = "debug" | "release";

const VERIFICATION_CACHE_VERSION = 1;
const VERIFICATION_CACHE_ENTRIES = 8;
const VERIFICATION_CACHE_HARD_LIMIT = 32;
const VERIFICATION_CACHE_GRACE_MS = 5 * 60 * 1000;

/**
 * Builds a test harness around the exact Rust Program lowering used by
 * production. The harness supplies scripted external Dependencies and records
 * calls in the same canonical format as the reference interpreter.
 */
export async function buildRustProgram(
  contribution: ProgramContributionIR,
  output: string,
  options: Readonly<{ profile?: RustVerificationProfile }> = {},
): Promise<string> {
  const generated = generateVerificationSource(contribution);
  const profile = options.profile ?? "debug";
  const cache = resolve(
    process.env.KIT_PRODUCTION_CACHE ?? resolve(homedir(), ".cache/kit/production"),
  );
  const identity = createHash("sha256")
    .update(
      JSON.stringify({
        version: VERIFICATION_CACHE_VERSION,
        target: `${process.platform}-${process.arch}`,
        toolchain: await rustToolchain(),
        generated: { ...generated, program: canonicalRustSource(generated.program) },
      }),
    )
    .digest("hex");
  const directory = resolve(cache, "conformance/workspaces", identity);
  const artifact = resolve(cache, "conformance/artifacts", identity, profile, generated.name);
  const target = resolve(cache, "target");
  await Promise.all([
    writeIfChanged(resolve(directory, "Cargo.toml"), generated.manifest),
    writeIfChanged(resolve(directory, "src/main.rs"), generated.main),
    writeIfChanged(resolve(directory, "src/program.rs"), generated.program),
  ]);
  await touch(directory);
  if (await exists(artifact)) {
    await touch(artifact);
    await copyExecutable(artifact, output);
    return output;
  }

  const environment = { ...process.env, CARGO_TARGET_DIR: target };
  const format = await command("cargo", ["fmt", "--all", "--", "--check"], directory);
  if (format.code !== 0) {
    const formatted = await command("cargo", ["fmt", "--all"], directory);
    if (formatted.code !== 0) {
      throw new Error(`Generated Rust formatting failed:\n${formatted.stderr}`);
    }
  }
  const release = profile === "release" ? ["--release"] : [];
  const lint = await command(
    "cargo",
    ["clippy", ...release, "--quiet", "--", "-D", "warnings"],
    directory,
    undefined,
    environment,
  );
  if (lint.code !== 0) {
    throw new Error(`Generated Rust failed linting:\n${lint.stderr || lint.stdout}`);
  }
  const built = await command(
    "cargo",
    ["build", ...release, "--quiet"],
    directory,
    undefined,
    environment,
  );
  if (built.code !== 0) {
    throw new Error(`Generated Rust failed to build:\n${built.stderr || built.stdout}`);
  }
  await mkdir(dirname(artifact), { recursive: true });
  const temporary = `${artifact}.${process.pid}.tmp`;
  await copyFile(resolve(target, profile, generated.name), temporary);
  await rename(temporary, artifact).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    if (!(await exists(artifact))) throw error;
  });
  await copyExecutable(artifact, output);
  await retainVerificationCache(cache, identity);
  return output;
}

export async function runRustProgram(executable: string, scenario: unknown): Promise<unknown> {
  const result = await command(
    executable,
    [],
    dirname(executable),
    `${JSON.stringify(scenario)}\n`,
  );
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(singleFrame(result.stdout));
}

/** Keeps one production-lowering verification host alive across a property suite. */
export async function createRustProgramSession(
  executable: string,
): Promise<AsyncDisposable & Readonly<{ run(scenario: unknown): Promise<unknown> }>> {
  const child = spawn(executable, [], { cwd: dirname(executable), stdio: "pipe" });
  const pending: Array<{
    resolve(value: unknown): void;
    reject(error: unknown): void;
  }> = [];
  let stdout = "";
  let stderr = "";
  let closed: unknown;
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    for (let boundary = stdout.indexOf("\0"); boundary >= 0; boundary = stdout.indexOf("\0")) {
      const frame = stdout.slice(0, boundary);
      stdout = stdout.slice(boundary + 1);
      const request = pending.shift();
      if (!request) continue;
      try {
        request.resolve(JSON.parse(frame));
      } catch (error) {
        request.reject(error);
      }
    }
  });
  child.once("error", (error) => {
    closed = error;
    for (const request of pending.splice(0)) request.reject(error);
  });
  child.once("exit", (code) => {
    if (code === 0 && !pending.length) return;
    closed = new Error(stderr || `Rust verification host exited with ${code}.`);
    for (const request of pending.splice(0)) request.reject(closed);
  });
  return {
    run(scenario) {
      if (closed) return Promise.reject(closed);
      return new Promise((resolvePromise, reject) => {
        pending.push({ resolve: resolvePromise, reject });
        child.stdin.write(`${JSON.stringify(scenario)}\n`);
      });
    },
    async [Symbol.asyncDispose]() {
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) {
        await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
      }
    },
  };
}

function generateVerificationSource(contribution: ProgramContributionIR): RustVerificationSource {
  const program: ProgramIR = {
    id: "program/verification",
    name: "verification",
    logicalName: "verification",
    environment: { name: "server", platform: "server" },
    contributions: [contribution],
  };
  const linked = linkProgram(program);
  const source = generateRustProgram(linked);
  const name = `kit_${createHash("sha256")
    .update(canonicalRustSource(source))
    .digest("hex")
    .slice(0, 16)}`;
  const runtime = resolve(import.meta.dirname, "../../../../../compiler/rust/runtime").replaceAll(
    "\\",
    "/",
  );
  return {
    name,
    manifest: `[package]
name = ${JSON.stringify(name)}
version = "0.0.0"
edition = "2024"

[dependencies]
kit-server-runtime = { path = ${JSON.stringify(runtime)} }
serde_json = "1"
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread"] }
`,
    main: verificationMain(linked.external.map(({ name: dependency }) => dependency)),
    program: source,
  };
}

function verificationMain(dependencies: readonly string[]): string {
  const registrations = dependencies
    .map(
      (dependency) => `engine.register(
            ${rustString(dependency)},
            Arc::new(FixtureDependency {
                name: ${rustString(dependency)},
                state: state.clone(),
            }),
        )?;`,
    )
    .join("\n        ");
  return `use std::{
    collections::{HashMap, VecDeque},
    io::{self, BufRead, Write},
    sync::{Arc, Mutex},
};

use kit_server_runtime::{
    Dependency, DependencyInvocation, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use serde_json::{json, Value as JsonValue};

mod program;

struct FixtureState {
    responses: HashMap<String, VecDeque<JsonValue>>,
    calls: Vec<JsonValue>,
}

struct FixtureDependency {
    name: &'static str,
    state: Arc<Mutex<FixtureState>>,
}

impl Dependency for FixtureDependency {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let name = self.name;
        let operation = operation.to_owned();
        let state = self.state.clone();
        Box::pin(async move {
            let key = format!("{name}.{operation}");
            let mut state = lock(&state);
            state.calls.push(json!({
                "dependency": name,
                "operation": operation,
                "input": input.canonical_json()?,
            }));
            let response = state
                .responses
                .get_mut(&key)
                .and_then(VecDeque::pop_front)
                .ok_or_else(|| NativeError::new(
                    "FixtureFailure",
                    format!("missing fixture response for {key}"),
                ))?;
            if let Some(value) = response.get("ok") {
                return Ok(Value::from_canonical_json(value));
            }
            let error = response
                .get("error")
                .and_then(JsonValue::as_object)
                .ok_or_else(|| NativeError::new("FixtureFailure", "invalid fixture response"))?;
            let message = error
                .get("message")
                .and_then(JsonValue::as_str)
                .unwrap_or("fixture Dependency failed");
            let mut failure = NativeError::new("FixtureFailure", message);
            if let Some(data) = error.get("data") {
                failure = failure.with_field("data", Value::from_canonical_json(data));
            }
            Err(failure)
        })
    }
}

#[tokio::main]
async fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.expect("read scenario");
        if line.trim().is_empty() {
            continue;
        }
        let scenario: JsonValue = serde_json::from_str(&line).expect("parse scenario");
        let responses = scenario
            .get("responses")
            .and_then(JsonValue::as_object)
            .into_iter()
            .flat_map(|responses| responses.iter())
            .map(|(name, values)| {
                let values = values
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .collect();
                (name.clone(), values)
            })
            .collect();
        let state = Arc::new(Mutex::new(FixtureState {
            responses,
            calls: Vec::new(),
        }));
        let engine = Engine::new();
        let outcome: NativeResult<()> = async {
        ${registrations}
            program::start(engine.clone()).await
        }
        .await;
        let result = match outcome {
            Ok(()) => json!({ "ok": null }),
            Err(error) => {
                let mut failure = json!({ "message": error.message });
                if let Some(data) = error.fields.get("data") {
                    failure["data"] = data.canonical_json().expect("canonical error data");
                }
                json!({ "error": failure })
            }
        };
        let calls = lock(&state).calls.clone();
        let _ = engine.shutdown().await;
        write!(stdout, "{}\\0", json!({ "calls": calls, "result": result }))
            .expect("write result");
        stdout.flush().expect("flush result");
    }
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
`;
}

function singleFrame(output: string): string {
  const boundary = output.indexOf("\0");
  if (boundary < 0 || output.slice(boundary + 1).trim()) {
    throw new Error("Rust verification host returned an invalid response frame.");
  }
  return output.slice(0, boundary);
}

function rustString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\\u2028", "\\u{2028}")
    .replaceAll("\\u2029", "\\u{2029}");
}

function canonicalRustSource(source: string): string {
  return source.replaceAll(/^\s*\/\/ TypeScript: .+:\d+:\d+\s*$/gm, "");
}

let rustToolchainResult: Promise<string> | undefined;

function rustToolchain(): Promise<string> {
  rustToolchainResult ??= command("rustc", ["-vV"], process.cwd()).then((value) => {
    if (value.code !== 0) throw new Error(`Cannot inspect Rust toolchain:\n${value.stderr}`);
    return value.stdout.trim();
  });
  return rustToolchainResult;
}

async function writeIfChanged(path: string, source: string): Promise<void> {
  if ((await readFile(path, "utf8").catch(() => undefined)) === source) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

async function copyExecutable(source: string, output: string): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await copyFile(source, output);
  await chmod(output, 0o755);
}

async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now).catch(() => undefined);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function retainVerificationCache(cache: string, preserve: string): Promise<void> {
  const workspaceRoot = resolve(cache, "conformance/workspaces");
  const artifactRoot = resolve(cache, "conformance/artifacts");
  const entries = await readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== preserve)
      .map(async (entry) => ({
        name: entry.name,
        used: (await stat(resolve(workspaceRoot, entry.name))).mtimeMs,
      })),
  );
  const excess = Math.max(
    0,
    entries.filter((entry) => entry.isDirectory()).length - VERIFICATION_CACHE_ENTRIES,
  );
  const expired = candidates
    .filter(({ used }) => Date.now() - used >= VERIFICATION_CACHE_GRACE_MS)
    .sort((left, right) => left.used - right.used);
  const selected = expired.slice(0, excess);
  const selectedNames = new Set(selected.map(({ name }) => name));
  selected.push(
    ...candidates
      .filter(({ name }) => !selectedNames.has(name))
      .sort((left, right) => left.used - right.used)
      .slice(
        0,
        Math.max(
          0,
          entries.filter((entry) => entry.isDirectory()).length -
            selected.length -
            VERIFICATION_CACHE_HARD_LIMIT,
        ),
      ),
  );
  for (const { name } of selected) {
    await Promise.all([
      rm(resolve(workspaceRoot, name), { force: true, recursive: true }),
      rm(resolve(artifactRoot, name), { force: true, recursive: true }),
    ]);
  }
}

function command(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  input?: string,
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
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}
