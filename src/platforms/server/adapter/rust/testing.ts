import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import type { DependencyContract } from "@/core/dependency";
import type { ServerProductionDependency } from "@/platforms/server/adapter/rust/providers";
import type {
  DependencyConformanceInstance,
  DependencyConformanceTarget,
} from "@/testing/dependency";

type Configuration = Readonly<{
  values: Readonly<Record<string, string>>;
  dispose?(): void | PromiseLike<void>;
}>;

const HOST_VERSION = 1;
const MAX_CACHED_PROVIDERS = 20;
type NonAsynchronousOperation<Api> = {
  [Name in keyof Api]-?: Api[Name] extends (...arguments_: infer _Arguments) => infer Result
    ? Result extends PromiseLike<unknown>
      ? never
      : Name
    : never;
}[keyof Api];
type AsynchronousDependency<Api extends DependencyContract> = [
  NonAsynchronousOperation<Api>,
] extends [never]
  ? Api
  : never;

/**
 * Exposes one asynchronous JSON Dependency provider through the ordinary
 * TypeScript conformance target. Callback, stream, and synchronous contracts
 * use generated-Program conformance instead. Exact source matches reuse a
 * content-addressed executable.
 */
export function rustServerDependencyTarget<Api extends DependencyContract>(
  input: {
    name: string;
    provider: ServerProductionDependency;
    configuration(): Configuration | PromiseLike<Configuration>;
  } & ([Api] extends [AsynchronousDependency<Api>] ? object : never),
): DependencyConformanceTarget<Api> {
  let executable: Promise<string> | undefined;
  return {
    name: input.name,
    tags: ["provider"],
    timeout: 240_000,
    async create() {
      const executablePath = await (executable ??= buildProviderHost(input.provider));
      const configuration = await input.configuration();
      const session = createSession(executablePath, configuration.values);
      return {
        api: dependencyClient<Api>(session),
        async dispose() {
          await session.dispose();
          await configuration.dispose?.();
        },
      } satisfies DependencyConformanceInstance<Api>;
    },
  };
}

async function buildProviderHost(provider: ServerProductionDependency): Promise<string> {
  const runtime = resolve(import.meta.dirname, "../../../../compiler/rust/runtime");
  const source = providerHost(provider);
  const hash = createHash("sha256")
    .update(String(HOST_VERSION))
    .update(source)
    .update(await sourceDigest(runtime))
    .update(await sourceDigest(provider.crate.directory))
    .digest("hex");
  const cache = resolve(
    process.env.KIT_PRODUCTION_CACHE ?? resolve(homedir(), ".cache/kit/production"),
    "providers",
    hash,
  );
  const providers = dirname(cache);
  const workspace = resolve(cache, "workspace");
  const artifact = resolve(cache, "provider");
  if (await exists(artifact)) {
    await touch(cache);
    return artifact;
  }

  await mkdir(resolve(workspace, "src"), { recursive: true });
  await writeFile(
    resolve(workspace, "Cargo.toml"),
    `[package]
name = "kit_provider_conformance"
version = "0.0.0"
edition = "2024"

[dependencies]
kit-server-runtime = { path = ${JSON.stringify(runtime)} }
${provider.crate.package} = { path = ${JSON.stringify(resolve(provider.crate.directory))} }
serde_json = "1"
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread"] }
`,
  );
  await writeFile(resolve(workspace, "src/main.rs"), source);
  const target = resolve(
    process.env.KIT_PRODUCTION_CACHE ?? resolve(homedir(), ".cache/kit/production"),
    "target",
  );
  const built = await command("cargo", ["build", "--quiet"], workspace, {
    ...process.env,
    CARGO_TARGET_DIR: target,
  });
  if (built.code !== 0) {
    throw new Error(`Rust Dependency conformance host failed to build:\n${built.stderr}`);
  }
  await mkdir(dirname(artifact), { recursive: true });
  const temporary = `${artifact}.${process.pid}.tmp`;
  await copyFile(resolve(target, "debug/kit_provider_conformance"), temporary);
  await chmod(temporary, 0o755);
  await rename(temporary, artifact).catch(async (error: unknown) => {
    await rm(temporary, { force: true });
    if (!(await exists(artifact))) throw error;
  });
  await retainRecent(providers, MAX_CACHED_PROVIDERS);
  return artifact;
}

function providerHost(provider: ServerProductionDependency): string {
  return `use std::{
    collections::BTreeMap,
    env,
    io::{self, BufRead, Write},
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, Value,
};
use serde_json::{json, Value as JsonValue};

#[tokio::main]
async fn main() {
    let configuration: BTreeMap<String, String> = serde_json::from_str(
        &env::var("KIT_CONFORMANCE_CONFIGURATION").expect("configuration"),
    )
    .expect("parse configuration");
    let dependency = ${provider.rust.constructor}(DependencyContext {
        name: ${JSON.stringify(provider.dependency)}.to_owned(),
        configuration,
        dependencies: BTreeMap::new(),
    })
    .await
    .expect("create Dependency provider");
    let engine = Engine::new();
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let frame: JsonValue = serde_json::from_str(&line.expect("read request"))
            .expect("parse request");
        let operation = frame["operation"].as_str().expect("operation");
        let input = Value::from_json(&frame["input"]);
        let invocation = DependencyInvocation::direct(
            ${JSON.stringify(provider.dependency)},
            operation,
            1,
        )
        .expect("invocation");
        let response = match dependency.call(engine.clone(), operation, input, invocation).await {
            Ok(value) if value.is_undefined() => json!({ "undefined": true }),
            Ok(value) => json!({ "ok": value.to_json().expect("serialize result") }),
            Err(error) => json!({
                "error": {
                    "name": error.name,
                    "message": error.message,
                }
            }),
        };
        write!(stdout, "{}\\0", response).expect("write response");
        stdout.flush().expect("flush response");
    }
    let _ = engine.shutdown().await;
}
`;
}

function dependencyClient<Api extends DependencyContract>(session: ProviderSession): Api {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return (input: unknown) => session.call(property, input);
    },
  }) as Api;
}

type ProviderSession = Readonly<{
  call(operation: string, input: unknown): Promise<unknown>;
  dispose(): Promise<void>;
}>;

function createSession(
  executable: string,
  configuration: Readonly<Record<string, string>>,
): ProviderSession {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      KIT_CONFORMANCE_CONFIGURATION: JSON.stringify(configuration),
    },
    stdio: "pipe",
  });
  const pending: Array<{
    resolve(value: unknown): void;
    reject(reason: unknown): void;
  }> = [];
  let output = "";
  let diagnostics = "";
  let closed: Error | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
    for (let boundary = output.indexOf("\0"); boundary >= 0; boundary = output.indexOf("\0")) {
      const frame = output.slice(0, boundary);
      output = output.slice(boundary + 1);
      const request = pending.shift();
      if (!request) continue;
      const response = JSON.parse(frame) as {
        ok?: unknown;
        undefined?: true;
        error?: Readonly<{ name: string; message: string }>;
      };
      if (response.error) {
        const error = new Error(response.error.message);
        error.name = response.error.name;
        request.reject(error);
      } else if (response.undefined) {
        request.resolve(undefined);
      } else {
        request.resolve(response.ok);
      }
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (diagnostics += chunk));
  child.once("error", fail);
  child.once("exit", (code) => {
    if (code === 0 && pending.length === 0) return;
    fail(new Error(diagnostics || `Rust Dependency conformance host exited with ${code}.`));
  });
  return {
    call(operation, input) {
      if (closed) return Promise.reject(closed);
      return new Promise((resolvePromise, reject) => {
        pending.push({ resolve: resolvePromise, reject });
        child.stdin.write(`${JSON.stringify({ operation, input })}\n`);
      });
    },
    async dispose() {
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) await exited(child);
    },
  };

  function fail(error: Error): void {
    closed = error;
    for (const request of pending.splice(0)) request.reject(error);
  }
}

async function sourceDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await sourceFiles(directory)) {
    hash.update(path.slice(directory.length));
    hash.update(await readFile(path));
  }
  return hash.digest("hex");
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "target") files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && (entry.name === "Cargo.toml" || entry.name.endsWith(".rs"))) {
      files.push(path);
    }
  }
  return files.sort();
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function touch(path: string): Promise<void> {
  const marker = resolve(path, ".used");
  await writeFile(marker, String(Date.now()));
}

async function retainRecent(directory: string, maximum: number): Promise<void> {
  if (!(await exists(directory))) return;
  const entries = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        const marker = resolve(path, ".used");
        return {
          path,
          used: await stat(marker)
            .then(({ mtimeMs }) => mtimeMs)
            .catch(() => stat(path).then(({ mtimeMs }) => mtimeMs)),
        };
      }),
  );
  for (const entry of entries.sort((left, right) => right.used - left.used).slice(maximum)) {
    await rm(entry.path, { force: true, recursive: true });
  }
}

function command(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<Readonly<{ code: number; stderr: string }>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd, env: environment, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
}

function exited(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolvePromise) => child.once("exit", () => resolvePromise()));
}
