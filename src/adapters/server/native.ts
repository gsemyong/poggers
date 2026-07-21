import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { generateEntityDomain, generateIdentityDomain } from "@/adapters/server/native/domain";
import {
  linkProgram,
  type CapabilityIR,
  type EntityFeatureImplementationIR,
  type IdentityFeatureImplementationIR,
  type ProgramIR,
  type TypeIR,
} from "@/core/compiler/ir";
import { generateRustProductionProgram } from "@/core/compiler/rust";

const NATIVE_ADAPTER_VERSION = 2;
const nativeRuntime = resolve(import.meta.dirname, "native");
const SERVER_RUNTIME_MANIFEST = readFileSync(resolve(nativeRuntime, "Cargo.toml"), "utf8");
const SERVER_RUNTIME_SOURCE = readFileSync(resolve(nativeRuntime, "src/lib.rs"), "utf8");

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
  cache?: string;
  directory: string;
  /** Runs strict Clippy verification in addition to the production build. */
  lint?: boolean;
  output: string;
  program: ProgramIR;
}): Promise<NativeServerBuild> {
  const started = performance.now();
  const linked = linkProgram(input.program);
  const unknown = linked.external
    .map(({ name }) => name)
    .filter((name) => !Object.hasOwn(HOST_CONTRACTS, name));
  if (unknown.length) {
    throw new Error(
      `Server native adapter does not implement external Capabilities: ${unknown.join(", ")}.`,
    );
  }
  linked.external.forEach(validateHostCapability);
  const only =
    linked.contributions.length === 1 ? linked.contributions[0]!.contribution : undefined;
  const generated = linked.contributions.every(
    ({ contribution }) => contribution.implementation.kind === "none",
  )
    ? generateEmptyWorkspace(input.program.name)
    : only?.implementation.kind === "portable" &&
        only.provides.length === 0 &&
        linked.external.length === 0
      ? generatePortableWorkspace(only)
      : generateFeatureWorkspace(input.application, input.program.name, linked.contributions);
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
      program: input.program.name,
      contributions: linked.contributions.map(({ contribution }) => ({
        feature: contribution.feature,
        requires: contribution.requires,
        provides: contribution.provides,
        implementation:
          contribution.implementation.kind === "portable-feature"
            ? stripFeatureFunctions(contribution.implementation.feature)
            : contribution.implementation.kind,
      })),
    }),
  ).slice(0, 16);
  const workspace = resolve(cacheRoot, "workspaces", project, fileName(input.program.name));
  const cached = resolve(cacheRoot, "artifacts", semanticHash, fileName(input.program.name));
  const lintedMarker = resolve(cacheRoot, "checks", `${semanticHash}.clippy`);
  await mkdir(dirname(input.output), { recursive: true });
  const artifactCached = await exists(cached);
  if (artifactCached && (!input.lint || (await exists(lintedMarker)))) {
    await copyFile(cached, input.output);
    await chmod(input.output, 0o755);
    return {
      executable: input.output,
      semanticHash,
      cache: "hit",
      workspace,
      compiledCrates: [],
      durationMs: Math.round(performance.now() - started),
    };
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
  const environment = {
    ...process.env,
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "1",
  };
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
    await copyFile(cached, input.output);
    await chmod(input.output, 0o755);
    return {
      executable: input.output,
      semanticHash,
      cache: "hit",
      workspace,
      compiledCrates: [],
      durationMs: Math.round(performance.now() - started),
    };
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
  await copyFile(cached, input.output);
  await chmod(input.output, 0o755);
  return {
    executable: input.output,
    semanticHash,
    cache: "miss",
    workspace,
    compiledCrates: compiledCrates([built.stdout], generated.packages),
    durationMs: Math.round(performance.now() - started),
  };
}

function stripFeatureFunctions(
  feature: IdentityFeatureImplementationIR | EntityFeatureImplementationIR,
): object {
  return feature.kind === "identity"
    ? { kind: feature.kind, name: feature.name, principal: feature.principal }
    : {
        kind: feature.kind,
        name: feature.name,
        principal: feature.principal,
        value: feature.value,
        createInput: feature.createInput,
        updateInput: feature.updateInput,
        filter: feature.filter,
      };
}

let rustToolchainResult: Promise<string> | undefined;

function rustToolchain(): Promise<string> {
  rustToolchainResult ??= command("rustc", ["-vV"], process.cwd()).then((result) => {
    if (result.code !== 0) throw new Error(`Cannot inspect Rust toolchain:\n${result.stderr}`);
    return result.stdout.trim();
  });
  return rustToolchainResult;
}

type NativeFile = Readonly<{ path: string; source: string }>;
type NativeWorkspace = Readonly<{
  binary: string;
  files: readonly NativeFile[];
  packages: readonly string[];
}>;

function generateEmptyWorkspace(program: string): NativeWorkspace {
  const binary = packageName(program);
  return {
    binary,
    packages: [binary],
    files: [
      {
        path: "Cargo.toml",
        source: `[package]\nname = ${JSON.stringify(binary)}\nversion = "0.0.0"\nedition = "2024"\n`,
      },
      { path: "src/main.rs", source: "fn main() {}\n" },
    ],
  };
}

function generatePortableWorkspace(
  contribution: Extract<ProgramIR["contributions"][number], { implementation: unknown }>,
): NativeWorkspace {
  if (contribution.implementation.kind !== "portable") {
    throw new Error("Expected a portable Program contribution.");
  }
  const generated = generateRustProductionProgram(contribution);
  return {
    binary: generated.name,
    packages: [generated.name],
    files: [
      { path: "Cargo.toml", source: generated.manifest },
      { path: "src/main.rs", source: generated.source },
    ],
  };
}

function generateFeatureWorkspace(
  application: string,
  program: string,
  contributions: ReturnType<typeof linkProgram>["contributions"],
): NativeWorkspace {
  const features = contributions.map(({ contribution }) => {
    if (contribution.implementation.kind !== "portable-feature") {
      throw new Error(
        `Program ${JSON.stringify(program)} contribution ${JSON.stringify(contribution.feature)} ` +
          `is ${contribution.implementation.kind}, not native-realizable Feature meaning.`,
      );
    }
    return { address: contribution.feature, feature: contribution.implementation.feature };
  });
  const identities = features.filter(
    (value): value is Readonly<{ address: string; feature: IdentityFeatureImplementationIR }> =>
      value.feature.kind === "identity",
  );
  const entities = features.filter(
    (value): value is Readonly<{ address: string; feature: EntityFeatureImplementationIR }> =>
      value.feature.kind === "entity",
  );
  if (identities.length !== 1) {
    throw new Error(
      `Server native adapter requires exactly one identity Feature; received ${identities.length}.`,
    );
  }
  if (!entities.length) {
    throw new Error("Server native adapter requires at least one entity Feature.");
  }

  const identity = featureCrate(identities[0]!.address);
  const entityCrates = entities.map(({ address, feature }) => ({
    ...featureCrate(address),
    feature,
  }));
  const binary = packageName(program);
  const members = [
    "runtime",
    identity.path,
    ...entityCrates.map(({ path }) => path),
    `programs/${fileName(program)}`,
  ];
  const featureManifest = (name: string) => `[package]
name = ${JSON.stringify(name)}
version = "0.0.0"
edition = "2024"

[dependencies]
serde_json = "1.0.145"
`;
  const dependencies = [identity, ...entityCrates]
    .map(({ name, path }) => `${name} = { path = ${JSON.stringify(`../../${path}`)} }`)
    .join("\n");
  const programManifest = `[package]
name = ${JSON.stringify(binary)}
version = "0.0.0"
edition = "2024"

[dependencies]
poggers_server_runtime = { path = "../../runtime" }
tokio = { version = "1.48.0", features = ["macros", "rt-multi-thread"] }
${dependencies}
`;
  const entitySpecs = entityCrates
    .map(
      ({ name, feature }) => `        EntitySpec {
            name: ${JSON.stringify(feature.name)},
            create: ${name}::create,
            update: ${name}::update,
            authorize: ${name}::authorize,
            matches: ${feature.matches ? `Some(${name}::matches)` : "None"},
        },`,
    )
    .join("\n");
  const main = `use poggers_server_runtime::{EntitySpec, IdentitySpec};

#[tokio::main]
async fn main() {
    let identity = IdentitySpec {
        name: ${JSON.stringify(identities[0]!.feature.name)},
        project: ${identity.name}::project,
    };
    let entities = [
${entitySpecs}
    ];
    poggers_server_runtime::serve(
        ${JSON.stringify(application)},
        ${JSON.stringify(program)},
        identity,
        &entities,
    )
    .await;
}
`;
  return {
    binary,
    packages: [
      "poggers_server_runtime",
      identity.name,
      ...entityCrates.map(({ name }) => name),
      binary,
    ],
    files: [
      {
        path: "Cargo.toml",
        source: `[workspace]\nresolver = "3"\nmembers = ${JSON.stringify(members)}\n`,
      },
      { path: "runtime/Cargo.toml", source: SERVER_RUNTIME_MANIFEST },
      { path: "runtime/src/lib.rs", source: SERVER_RUNTIME_SOURCE },
      { path: `${identity.path}/Cargo.toml`, source: featureManifest(identity.name) },
      {
        path: `${identity.path}/src/lib.rs`,
        source: generateIdentityDomain(identities[0]!.feature),
      },
      ...entityCrates.flatMap(({ name, path, feature }) => [
        { path: `${path}/Cargo.toml`, source: featureManifest(name) },
        { path: `${path}/src/lib.rs`, source: generateEntityDomain(feature) },
      ]),
      { path: `programs/${fileName(program)}/Cargo.toml`, source: programManifest },
      { path: `programs/${fileName(program)}/src/main.rs`, source: main },
    ],
  };
}

function featureCrate(address: string): Readonly<{ name: string; path: string }> {
  const suffix = digest(address).slice(0, 8);
  const name = `poggers_feature_${rustName(address)}_${suffix}`;
  return { name, path: `features/${fileName(address)}-${suffix}` };
}

function compiledCrates(
  outputs: readonly string[],
  packages: readonly string[],
): readonly string[] {
  const expected = new Set(packages);
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

function cargoErrors(result: Readonly<{ stdout: string; stderr: string }>): string {
  const rendered: string[] = [];
  for (const line of result.stdout.split("\n")) {
    try {
      const value = JSON.parse(line) as {
        reason?: string;
        message?: { rendered?: string };
      };
      if (value.reason === "compiler-message" && value.message?.rendered) {
        rendered.push(value.message.rendered);
      }
    } catch {
      // Preserve Cargo's stderr below when a line is not JSON.
    }
  }
  return rendered.join("\n") || result.stderr || result.stdout;
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

type TypePattern =
  | "any"
  | TypeIR["kind"]
  | Readonly<{ kind: "primitive" | "opaque"; name: string }>
  | Readonly<{ kind: "array" | "stream"; element: TypePattern }>
  | Readonly<{ kind: "option" | "promise"; value: TypePattern }>
  | Readonly<{
      kind: "function";
      parameters: readonly TypePattern[];
      result: TypePattern;
    }>
  | Readonly<{
      kind: "record";
      fields: Readonly<Record<string, TypePattern | readonly [TypePattern, "optional"]>>;
    }>;

const stringType = { kind: "primitive", name: "string" } as const;
const numberType = { kind: "primitive", name: "number" } as const;
const requestType = { kind: "opaque", name: "Request" } as const;
const responseType = { kind: "opaque", name: "Response" } as const;
const routeHandler = {
  kind: "function",
  parameters: [requestType],
  result: { kind: "promise", value: responseType },
} as const;
const streamInput = {
  kind: "record",
  fields: { after: [numberType, "optional"], stream: stringType },
} as const;
const storedEvent = {
  kind: "record",
  fields: { event: "any", revision: numberType, stream: stringType },
} as const;
const storedEvents = { kind: "array", element: storedEvent } as const;
const HOST_CONTRACTS: Readonly<Record<string, TypePattern>> = {
  authentication: {
    kind: "record",
    fields: {
      authenticate: {
        kind: "function",
        parameters: [{ kind: "record", fields: { cookie: [stringType, "optional"] } }],
        result: {
          kind: "promise",
          value: {
            kind: "option",
            value: {
              kind: "record",
              fields: { email: stringType, id: stringType, name: stringType },
            },
          },
        },
      },
      handle: {
        kind: "function",
        parameters: [{ kind: "record", fields: { path: stringType, request: requestType } }],
        result: { kind: "promise", value: responseType },
      },
    },
  },
  clock: {
    kind: "record",
    fields: { now: { kind: "function", parameters: [], result: numberType } },
  },
  events: {
    kind: "record",
    fields: {
      append: {
        kind: "function",
        parameters: [
          {
            kind: "record",
            fields: {
              events: { kind: "array", element: "any" },
              expectedRevision: numberType,
              stream: stringType,
            },
          },
        ],
        result: { kind: "promise", value: { kind: "option", value: storedEvents } },
      },
      read: {
        kind: "function",
        parameters: [streamInput],
        result: { kind: "promise", value: storedEvents },
      },
      subscribe: {
        kind: "function",
        parameters: [streamInput],
        result: { kind: "stream", element: storedEvent },
      },
    },
  },
  http: {
    kind: "record",
    fields: {
      route: {
        kind: "function",
        parameters: [{ kind: "record", fields: { handle: routeHandler, path: stringType } }],
        result: { kind: "opaque", name: "Disposable" },
      },
    },
  },
  identifiers: {
    kind: "record",
    fields: { create: { kind: "function", parameters: [], result: stringType } },
  },
};

function validateHostCapability(capability: CapabilityIR): void {
  const pattern = HOST_CONTRACTS[capability.name];
  if (!pattern || matchesPattern(capability.type, pattern)) return;
  throw new Error(
    `Server native adapter cannot bind Capability ${JSON.stringify(capability.name)} because its ` +
      "contract is incompatible with the adapter implementation.",
  );
}

function matchesPattern(type: TypeIR, pattern: TypePattern): boolean {
  if (pattern === "any") return true;
  if (typeof pattern === "string") return type.kind === pattern;
  if (type.kind !== pattern.kind) return false;
  if (pattern.kind === "primitive" || pattern.kind === "opaque") {
    return type.kind === pattern.kind && type.name === pattern.name;
  }
  if (pattern.kind === "array" || pattern.kind === "stream") {
    return (
      (type.kind === "array" || type.kind === "stream") &&
      matchesPattern(type.element, pattern.element)
    );
  }
  if (pattern.kind === "option" || pattern.kind === "promise") {
    return (
      (type.kind === "option" || type.kind === "promise") &&
      matchesPattern(type.value, pattern.value)
    );
  }
  if (pattern.kind === "function") {
    return (
      type.kind === "function" &&
      type.parameters.length === pattern.parameters.length &&
      type.parameters.every(
        (parameter, index) =>
          !parameter.optional && matchesPattern(parameter.type, pattern.parameters[index]!),
      ) &&
      matchesPattern(type.result, pattern.result)
    );
  }
  if (pattern.kind === "record") {
    if (type.kind !== "record") return false;
    const expected = Object.entries(pattern.fields);
    if (type.fields.length !== expected.length) return false;
    return expected.every(([name, fieldPattern]) => {
      const field = type.fields.find((value) => value.name === name);
      if (!field) return false;
      const optional = Array.isArray(fieldPattern);
      const valuePattern = optional ? fieldPattern[0] : fieldPattern;
      return field.optional === optional && matchesPattern(field.type, valuePattern as TypePattern);
    });
  }
  return false;
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
  if (!file.path.endsWith(".rs")) {
    return writeIfChanged(path, file.source);
  }
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
