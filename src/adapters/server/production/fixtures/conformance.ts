import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { generateRustProgram } from "@/adapters/server/production/program";
import type { ProgramContributionIR, ProgramIR } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";

type RustVerificationSource = Readonly<{
  name: string;
  manifest: string;
  main: string;
  program: string;
}>;

/**
 * Builds a test harness around the exact Rust Program lowering used by
 * production. The harness supplies scripted external Dependencies and records
 * calls in the same canonical format as the reference interpreter.
 */
export async function buildRustProgram(
  contribution: ProgramContributionIR,
  output: string,
): Promise<string> {
  const generated = generateVerificationSource(contribution);
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-rust-"));
  const target = resolve(tmpdir(), "poggers-rust-target-v2");
  try {
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "Cargo.toml"), generated.manifest);
    await writeFile(resolve(directory, "src/main.rs"), generated.main);
    await writeFile(resolve(directory, "src/program.rs"), generated.program);
    const format = await command("cargo", ["fmt", "--all"], directory);
    if (format.code !== 0) throw new Error(`Generated Rust formatting failed:\n${format.stderr}`);
    const lint = await command(
      "cargo",
      ["clippy", "--release", "--quiet", "--", "-D", "warnings"],
      directory,
      undefined,
      { ...process.env, CARGO_TARGET_DIR: target },
    );
    if (lint.code !== 0) {
      throw new Error(`Generated Rust failed linting:\n${lint.stderr || lint.stdout}`);
    }
    const built = await command("cargo", ["build", "--release", "--quiet"], directory, undefined, {
      ...process.env,
      CARGO_TARGET_DIR: target,
    });
    if (built.code !== 0) {
      throw new Error(`Generated Rust failed to build:\n${built.stderr || built.stdout}`);
    }
    await mkdir(dirname(output), { recursive: true });
    await copyFile(resolve(target, "release", generated.name), output);
    await chmod(output, 0o755);
    return output;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
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
    environment: { name: "server", platform: "server" },
    contributions: [contribution],
  };
  const linked = linkProgram(program);
  const source = generateRustProgram(linked);
  const name = `poggers_${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
  const runtime = resolve(import.meta.dirname, "../runtime").replaceAll("\\", "/");
  return {
    name,
    manifest: `[package]
name = ${JSON.stringify(name)}
version = "0.0.0"
edition = "2024"

[dependencies]
poggers-server-runtime = { path = ${JSON.stringify(runtime)} }
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

use poggers_server_runtime::{
    Dependency, Engine, NativeError, NativeFuture, NativeResult, Value,
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
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
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
